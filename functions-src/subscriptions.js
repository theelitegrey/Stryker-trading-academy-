/**
 * Stryker Trading Academy — subscription lifecycle
 *
 * Turns the one-time plan purchases into real subscriptions. Every paid
 * purchase stamps students/{uid}.paidThroughMillis one billing period out
 * (done in razorpay.js and checkout.js, which call the helpers here); this
 * file owns everything that happens AFTER the money:
 *
 *   subscriptionSweep — scheduled daily. For every student on a paid,
 *   periodic plan (founding members and lifetime/one-time plans are exempt):
 *
 *     backfill  a student granted a plan before subscriptions existed gets a
 *               paidThroughMillis derived from their most recent order (one
 *               period from that payment), or one period from today if there
 *               is no order at all (an admin grant) — nobody is cut off
 *               retroactively.
 *     remind    3 days before expiry: one renewal notification per cycle.
 *     grace     expiry has passed but within the 3-day grace window: access
 *               continues, status flips to 'grace', one warning notification.
 *     downgrade grace exhausted: the plan drops to the entry tier, the
 *               public profile syncs, a lapse notification is sent, and any
 *               TradingView indicator access is revoked (best effort — the
 *               site record is cleared regardless, since entitlement follows
 *               the plan).
 *
 * DEPLOY (name every function or the others get deleted):
 *   firebase deploy --only functions:subscriptionSweep,functions:razorpayCreateOrder,functions:razorpayVerifyPayment
 *
 * WHY THE PLAN FIELD STAYS THE SINGLE SOURCE OF TRUTH: every access gate on
 * the site (chapters, pages, live sessions, indicators) already reads the
 * student's plan. The sweep changes THE PLAN when a subscription lapses, so
 * enforcement needs no second mechanism and can never disagree with itself.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;    // access continues 3 days past expiry
const REMIND_MS = 3 * 24 * 60 * 60 * 1000;   // renewal reminder 3 days before expiry

// 'month' / 'year' periods expire; anything else — forever, one-time,
// lifetime, blank — never does. Matches the client (assets/plan-price.js).
function periodKind(period){
  const p = String(period || '').toLowerCase();
  if (/month/.test(p)) return 'month';
  if (/year|annual/.test(p)) return 'year';
  return 'none';
}

// One billing period past `fromMillis`, calendar-aware (Jan 31 + 1 month
// lands on the last day of February rather than overflowing into March).
function extendPeriod(fromMillis, period){
  const kind = periodKind(period);
  if (kind === 'none') return null;
  const d = new Date(fromMillis);
  const day = d.getUTCDate();
  if (kind === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0);   // clamp to month end
  return d.getTime();
}

/**
 * Pure decision for one student on one sweep pass — exported for tests.
 * Returns { action } where action is one of:
 *   'skip'     not subject to expiry (no plan, founding, non-periodic plan)
 *   'backfill' paying plan but no paidThroughMillis yet
 *   'remind'   inside the reminder window, not yet reminded this cycle
 *   'grace'    past expiry, inside grace, not yet warned this cycle
 *   'expire'   past expiry + grace — downgrade now
 *   'none'     healthy, nothing to do
 */
function decide(student, planInfo, nowMs){
  if (!student || !student.plan || !planInfo) return { action: 'skip' };
  if (student.foundingMember) return { action: 'skip' };
  if (periodKind(planInfo.period) === 'none' || !(planInfo.price > 0)) return { action: 'skip' };
  if (planInfo.isEntry) return { action: 'skip' };   // nothing below to drop to

  const paidThrough = student.paidThroughMillis || 0;
  if (!paidThrough) return { action: 'backfill' };

  if (nowMs > paidThrough + GRACE_MS) return { action: 'expire' };
  if (nowMs > paidThrough) {
    const warned = (student.lastGraceNoticeMillis || 0) > paidThrough;
    return { action: 'grace', notify: !warned };
  }
  if (paidThrough - nowMs <= REMIND_MS) {
    const reminded = (student.lastRenewalReminderMillis || 0) >= paidThrough - REMIND_MS;
    return { action: 'remind', notify: !reminded };
  }
  return { action: 'none' };
}

function notify(uid, type, message, link){
  return db.collection('notifications').add({
    recipientUid: uid, type, message, link: link || null,
    read: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch((err) => console.error('subscriptionSweep: notification failed for', uid, err.message));
}

function dayLabel(ms){
  return new Date(ms).toISOString().slice(0, 10);
}

// Server-side effective price (mirror of assets/plan-price.js, same as
// razorpay.js uses) — a plan priced 0 never expires anyone.
function planPriceNum(v){
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

exports.subscriptionSweep = functions
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub.schedule('every 24 hours')
  .timeZone('UTC')
  .onRun(async () => {
    const plansSnap = await db.collection('plans').get();
    const plans = [];
    plansSnap.forEach((doc) => plans.push(Object.assign({ id: doc.id }, doc.data())));
    if (!plans.length) { console.log('subscriptionSweep: no plans'); return null; }

    // The entry tier is where lapsed accounts land — the lowest rank, same
    // resolution assets/roles.js uses for new signups.
    plans.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const entry = plans[0];
    const planByName = {};
    plans.forEach((p) => {
      planByName[String(p.name || '').toLowerCase()] = {
        id: p.id, name: p.name, period: p.period,
        price: planPriceNum(p.price),
        isEntry: p.id === entry.id
      };
    });

    const studentsSnap = await db.collection('students').get();
    const now = Date.now();
    let backfilled = 0, reminded = 0, graced = 0, expired = 0;

    for (const doc of studentsSnap.docs) {
      const s = doc.data();
      const info = planByName[String(s.plan || '').toLowerCase()];
      const d = decide(Object.assign({ uid: doc.id }, s), info, now);

      try {
        if (d.action === 'backfill') {
          // One period from their latest payment; an admin-granted account
          // with no order gets a full period from today.
          const orders = await db.collection('orders').where('studentUid', '==', doc.id).get();
          let latest = 0;
          orders.forEach((o) => {
            const t = o.data().createdAt;
            const ms = t && typeof t.toMillis === 'function' ? t.toMillis() : 0;
            if (ms > latest) latest = ms;
          });
          const from = latest || now;
          let paidThrough = extendPeriod(from, info.period);
          // A payment so old the period already ran out still deserves the
          // grace path, not an instant cut — start their clock from today.
          if (paidThrough <= now) paidThrough = extendPeriod(now, info.period);
          await doc.ref.set({ paidThroughMillis: paidThrough, subscriptionStatus: 'active' }, { merge: true });
          backfilled++;

        } else if (d.action === 'remind' && d.notify) {
          await doc.ref.set({ lastRenewalReminderMillis: now, subscriptionStatus: 'active' }, { merge: true });
          await notify(doc.id, 'renewal_due',
            'Your ' + info.name + ' subscription renews by ' + dayLabel(s.paidThroughMillis) +
            ' — renew now to keep uninterrupted access.',
            'checkout.html?plan=' + encodeURIComponent(info.id));
          reminded++;

        } else if (d.action === 'grace') {
          const patch = { subscriptionStatus: 'grace' };
          if (d.notify) patch.lastGraceNoticeMillis = now;
          await doc.ref.set(patch, { merge: true });
          if (d.notify) {
            await notify(doc.id, 'renewal_grace',
              'Your ' + info.name + ' payment is due — access pauses on ' +
              dayLabel(s.paidThroughMillis + GRACE_MS) + ' unless you renew.',
              'checkout.html?plan=' + encodeURIComponent(info.id));
          }
          graced++;

        } else if (d.action === 'expire') {
          await doc.ref.set({
            plan: entry.name, planId: entry.id,
            subscriptionStatus: 'expired',
            lapsedFromPlan: info.name, lapsedAtMillis: now,
            tradingViewAccessGranted: false
          }, { merge: true });
          await db.collection('profiles').doc(doc.id).set({ plan: entry.name }, { merge: true }).catch(() => {});
          await notify(doc.id, 'plan_lapsed',
            'Your ' + info.name + ' subscription has ended and your account moved to ' + entry.name +
            '. Renew any time to get everything back.',
            'checkout.html?plan=' + encodeURIComponent(info.id));

          // Best-effort TradingView revocation — the site record above is
          // already cleared either way, since entitlement follows the plan.
          if (s.tradingViewAccessGranted && s.tradingViewUsername) {
            try {
              const tv = require('./tvAccess').__internals;
              const res = await tv.revokeAllForUsername(s.tradingViewUsername);
              console.log('subscriptionSweep: TV revoke for', s.tradingViewUsername, JSON.stringify(res));
            } catch (err) {
              console.error('subscriptionSweep: TV revoke failed for', s.tradingViewUsername, err.message);
            }
          }
          expired++;
        }
      } catch (err) {
        console.error('subscriptionSweep: failed for', doc.id, err.message);
      }
    }

    console.log('subscriptionSweep: backfilled ' + backfilled + ', reminded ' + reminded +
                ', grace ' + graced + ', expired ' + expired + ' of ' + studentsSnap.size + ' students');
    return null;
  });

// Used by razorpay.js when a payment verifies, and by tests.
exports.__internals = { periodKind, extendPeriod, decide, GRACE_MS, REMIND_MS };
