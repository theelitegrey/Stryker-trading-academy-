/**
 * Stryker Trading Academy: welcome email series for new free accounts.
 *
 *   welcomeEmailTick   scheduled hourly. Enrols free accounts created after
 *                      emailSeriesConfig/welcome.launchAt, and sends each one the
 *                      next due email: day 0, 2, 5, 9, 14 (emailTemplates.js).
 *   emailUnsubscribe   public HTTPS endpoint behind the footer link. One
 *                      click (GET) or the RFC 8058 List-Unsubscribe-Post
 *                      (POST) stops the series for good.
 *
 * STATE: emailSeries/{uid}: { email, step (next to send, 0..5), nextAt,
 * status: active|done|stopped, stopReason, unsubToken, sent: {day0: ts…} }.
 * Daily send counts: emailSeriesDaily/{YYYY-MM-DD}. Config:
 * emailSeriesConfig/welcome { enabled, testOnly, testRecipients[], launchAt,
 * postalAddress, offerPlanId, from }. Kept out of settings/ on purpose:
 * settings/* is readable by every signed-in user, and this holds the test
 * addresses.
 * Written only here with the Admin SDK. No client rule allows access, so
 * the Firestore rules need no change (the catch-all deny covers it).
 *
 * STOPS: the series ends and never restarts when the account
 *   - unsubscribes (link or one-click header)
 *   - is on any plan other than the entry (free) plan, or has paid time left
 *   - is deleted, banned, or its email bounces / is marked spam (bounces:
 *     Resend's dashboard; not wired to a webhook yet)
 *
 * SAFETY (every one must hold, or nothing is sent):
 *   - emailSeriesConfig/welcome.enabled === true
 *   - emailSeriesConfig/welcome.postalAddress is set (anti-spam law footer)
 *   - the rendered email has no [COPY PENDING]/[PRICE] placeholder left
 *   - the RESEND_API_KEY secret exists (it's read from Secret Manager, never
 *     from code or chat)
 *   - the address is verified (password accounts must click the verify link;
 *     Google accounts are verified from the start)
 *   - at most DAILY_CAP emails a day (Resend free tier: 100/day, 3,000/month)
 * With emailSeriesConfig/welcome.testOnly = true, mail goes only to addresses in
 * emailSeriesConfig/welcome.testRecipients.
 *
 * DEPLOY (by name, after the secret exists):
 *   firebase deploy --only functions:welcomeEmailTick,functions:emailUnsubscribe
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const T = require('./emailTemplates');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_CAP = 90;          // stays under Resend's free 100/day
const PER_RUN_CAP = 40;
const UNSUB_URL = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/emailUnsubscribe';

function unsubUrl(uid, token) {
  return UNSUB_URL + '?u=' + encodeURIComponent(uid) + '&t=' + encodeURIComponent(token);
}

function priceNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : null;
}
function usd(n) { return '$' + (Math.round(n * 100) / 100).toString(); }

// Live price of the offered plan: sale price only while a sale is running
// (same rule as assets/plan-price.js: no end date, or end date not passed).
function offerFor(plan) {
  if (!plan) return null;
  const base = priceNum(plan.price);
  const sale = priceNum(plan.salePrice);
  let saleOn = sale != null && base != null && sale < base;
  if (saleOn && plan.saleEndsAt) {
    const end = new Date(plan.saleEndsAt);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(plan.saleEndsAt))) end.setUTCHours(23, 59, 59, 999);
    if (!isNaN(end) && end.getTime() < Date.now()) saleOn = false;
  }
  if (base == null) return null;
  return {
    planId: plan.id, planName: plan.name,
    priceLabel: usd(saleOn ? sale : base),
    wasLabel: saleOn ? usd(base) : null
  };
}

async function sendViaResend(apiKey, msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('resend ' + r.status + ' ' + (body.message || body.name || ''));
  return body.id;
}

exports.welcomeEmailTick = functions
  .runWith({ maxInstances: 1, timeoutSeconds: 300, memory: '256MB', secrets: ['RESEND_API_KEY'] })
  .pubsub.schedule('every 60 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const cfgSnap = await db.collection('emailSeriesConfig').doc('welcome').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (cfg.enabled !== true) { console.log('welcomeEmailTick: disabled'); return null; }
    if (!cfg.postalAddress) { console.warn('welcomeEmailTick: no postal address set, not sending'); return null; }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { console.warn('welcomeEmailTick: RESEND_API_KEY missing'); return null; }
    const from = cfg.from || 'Stryker Trading Academy <hello@send.strykertrading.com>';
    const launchAt = cfg.launchAt && cfg.launchAt.toDate ? cfg.launchAt.toDate() : null;
    if (!launchAt) { console.warn('welcomeEmailTick: no launchAt, not enrolling'); return null; }
    const testOnly = cfg.testOnly !== false;
    const testSet = new Set((cfg.testRecipients || []).map((e) => String(e).toLowerCase()));

    // Plans: the entry tier is "free"; the offer plan is configured by id.
    const plans = [];
    (await db.collection('plans').get()).forEach((d) => plans.push(Object.assign({ id: d.id }, d.data())));
    plans.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const entry = plans[0];
    const offer = offerFor(plans.find((p) => p.id === cfg.offerPlanId));

    // 1. Enrol new free accounts created since launch.
    const fresh = await db.collection('students').where('createdAt', '>=', launchAt).get();
    const refs = fresh.docs.map((s) => db.collection('emailSeries').doc(s.id));
    const have = new Set();
    if (refs.length) (await db.getAll(...refs)).forEach((x) => { if (x.exists) have.add(x.id); });
    let enrolled = 0;
    for (const s of fresh.docs) {
      if (have.has(s.id)) continue;
      const ref = db.collection('emailSeries').doc(s.id);
      const created = await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return false;
        const createdAt = s.get('createdAt') && s.get('createdAt').toDate ? s.get('createdAt').toDate() : new Date();
        tx.set(ref, {
          email: s.get('email') || null, step: 0, status: 'active',
          nextAt: admin.firestore.Timestamp.fromDate(createdAt),
          signupAt: admin.firestore.Timestamp.fromDate(createdAt),
          unsubToken: crypto.randomBytes(18).toString('base64url'),
          sent: {}, createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
      });
      if (created) enrolled++;
    }

    // 2. Daily cap.
    const dayKey = new Date().toISOString().slice(0, 10);
    const capRef = db.collection('emailSeriesDaily').doc(dayKey);
    let sentToday = ((await capRef.get()).data() || {}).sent || 0;

    // 3. Send what's due.
    // Only active records carry nextAt (it's removed on done/stop), so this
    // single-field range query needs no composite index.
    const due = await db.collection('emailSeries')
      .where('nextAt', '<=', admin.firestore.Timestamp.now())
      .orderBy('nextAt').limit(PER_RUN_CAP).get();
    let sent = 0, stopped = 0, held = 0;
    for (const d of due.docs) {
      if (sentToday >= DAILY_CAP) break;
      const rec = d.data();
      const uid = d.id;
      if (rec.status !== 'active') { await d.ref.update({ nextAt: admin.firestore.FieldValue.delete() }); continue; }
      const later = (h) => d.ref.update({ nextAt: admin.firestore.Timestamp.fromMillis(Date.now() + h * 3600 * 1000) });
      const stop = (reason) => d.ref.update({ status: 'stopped', stopReason: reason,
        nextAt: admin.firestore.FieldValue.delete(),
        stoppedAt: admin.firestore.FieldValue.serverTimestamp() }).then(() => { stopped++; });

      const stu = await db.collection('students').doc(uid).get();
      if (!stu.exists) { await stop('account-deleted'); continue; }
      const sd = stu.data();
      if (sd.banned) { await stop('banned'); continue; }
      const paidLeft = (sd.paidThroughMillis || 0) > Date.now();
      const onEntry = !sd.plan || !entry || String(sd.plan).toLowerCase() === String(entry.name).toLowerCase();
      if (!onEntry || paidLeft) { await stop('upgraded'); continue; }

      let user;
      try { user = await admin.auth().getUser(uid); } catch (e) { await stop('account-deleted'); continue; }
      const email = user.email;
      if (!email) { await stop('no-email'); continue; }
      if (!user.emailVerified) {
        // Hold until verified; give up once the whole series window has passed.
        const signup = rec.signupAt.toMillis();
        if (Date.now() - signup > 15 * DAY_MS) await stop('never-verified');
        else { await later(6); held++; }
        continue;
      }
      if (testOnly && !testSet.has(email.toLowerCase())) { await later(6); held++; continue; }

      const step = rec.step;
      const url = unsubUrl(uid, rec.unsubToken);
      const r = T.render(step, {
        firstName: (user.displayName || sd.displayName || '').split(' ')[0] || 'trader',
        unsubscribeUrl: url, postalAddress: cfg.postalAddress, offer
      });
      if (T.hasPlaceholders(r)) { console.error('welcomeEmailTick: step ' + step + ' still has placeholders; not sending'); break; }

      // Claim the step first so a retry can never double-send.
      const claimed = await db.runTransaction(async (tx) => {
        const cur = await tx.get(d.ref);
        if (!cur.exists || cur.get('status') !== 'active' || cur.get('step') !== step) return false;
        const next = step + 1;
        const upd = { step: next, ['sent.day' + T.DAYS[step]]: admin.firestore.FieldValue.serverTimestamp() };
        if (next >= T.DAYS.length) { upd.status = 'done'; upd.nextAt = admin.firestore.FieldValue.delete(); }
        else upd.nextAt = admin.firestore.Timestamp.fromMillis(rec.signupAt.toMillis() + T.DAYS[next] * DAY_MS);
        tx.update(d.ref, upd);
        return true;
      });
      if (!claimed) continue;
      try {
        await sendViaResend(apiKey, {
          from, to: [email], subject: r.subject, html: r.html, text: r.text,
          headers: {
            'List-Unsubscribe': '<' + url + '>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
          tags: [{ name: 'series', value: 'welcome' }, { name: 'day', value: String(T.DAYS[step]) }]
        });
        sent++; sentToday++;
      } catch (e) {
        // Sending failed after the claim: roll the step back so it's retried next hour.
        console.error('welcomeEmailTick: send failed for', uid, e.message);
        await d.ref.update({ step, status: 'active', nextAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600 * 1000),
          ['sent.day' + T.DAYS[step]]: admin.firestore.FieldValue.delete() });
      }
    }
    if (sent) await capRef.set({ sent: sentToday }, { merge: true });
    console.log(`welcomeEmailTick: enrolled ${enrolled}, sent ${sent}, stopped ${stopped}, held ${held}, today ${sentToday}`);
    return null;
  });

function page(title, msg) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${title}</title></head>` +
    `<body style="margin:0;background:#0b0b0d;color:#c9cdd3;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">` +
    `<div style="max-width:480px;margin:12vh auto;padding:28px;background:#131316;border:1px solid #2c2c32;border-radius:14px;">` +
    `<h1 style="color:#eee;font-size:22px;margin:0 0 12px;">${title}</h1><p style="line-height:1.6;margin:0 0 20px;">${msg}</p>` +
    `<a href="https://strykertrading.com/" style="color:#03c988;">Back to strykertrading.com</a></div></body></html>`;
}

exports.emailUnsubscribe = functions
  .runWith({ maxInstances: 5 })
  .https.onRequest(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
    const uid = String(req.query.u || '');
    const token = String(req.query.t || '');
    res.set('Cache-Control', 'no-store');
    if (!/^[A-Za-z0-9]{10,40}$/.test(uid) || token.length < 10) {
      res.status(400).send(page('Link not recognised', 'This unsubscribe link is incomplete. Reply to any of our emails and we will remove you by hand.'));
      return;
    }
    const ref = db.collection('emailSeries').doc(uid);
    const snap = await ref.get();
    const a = Buffer.from(token), b = Buffer.from(String(snap.exists ? snap.get('unsubToken') || '' : ''));
    if (!snap.exists || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(404).send(page('Link not recognised', 'We could not match this link to a subscription. Reply to any of our emails and we will remove you by hand.'));
      return;
    }
    if (snap.get('status') !== 'stopped' || snap.get('stopReason') !== 'unsubscribed') {
      await ref.update({ status: 'stopped', stopReason: 'unsubscribed', nextAt: admin.firestore.FieldValue.delete(),
        stoppedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    if (req.method === 'POST') { res.status(200).send('ok'); return; }
    res.status(200).send(page('You are unsubscribed', "You won't get any more welcome-series emails from Stryker Trading Academy. Your account and access are unchanged."));
  });

// Not a function, so the Functions loader ignores it; named so it can't
// collide with subscriptions.js's __internals in index.js's Object.assign.
exports.__welcomeInternals = { offerFor, unsubUrl };
