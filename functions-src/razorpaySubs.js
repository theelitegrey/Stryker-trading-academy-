/**
 * Stryker Trading Academy — Razorpay Subscriptions (auto-debit)
 *
 * True recurring billing for Indian customers on top of the stage-1
 * foundation (subscriptions.js): the first checkout sets up a UPI AutoPay /
 * card e-mandate, Razorpay then auto-debits every billing cycle anchored to
 * the signup date, and the charge webhook keeps paidThroughMillis moving —
 * the daily subscriptionSweep needs no changes, it just keeps enforcing the
 * date like it does for one-time renewals.
 *
 *   razorpaySubscribe   — creates (and caches) a Razorpay billing plan for
 *                         the site plan's locked-in price, then a
 *                         subscription; the client opens Razorpay checkout
 *                         with the subscription_id to authorize the mandate.
 *   razorpaySubsVerify  — verifies the mandate checkout signature
 *                         (HMAC(payment_id|subscription_id)), grants the
 *                         plan, stamps the first period, records the order.
 *   razorpayWebhook     — HTTPS endpoint Razorpay calls on every cycle:
 *                         subscription.charged extends paidThroughMillis and
 *                         records the renewal order (idempotent per payment
 *                         id); halted/cancelled/paused mark autopay off and
 *                         let the sweep lapse the account naturally.
 *   razorpaySubsCancel  — the student switches auto-renewal off (cancel at
 *                         cycle end); access runs to paidThroughMillis.
 *
 * DEPLOY (name every function or the others get deleted):
 *   firebase deploy --only functions:razorpaySubscribe,functions:razorpaySubsVerify,functions:razorpayWebhook,functions:razorpaySubsCancel
 *
 * ENV (functions .env): RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (existing),
 * plus RAZORPAY_WEBHOOK_SECRET — set the same value in the Razorpay
 * dashboard when creating the webhook (events: subscription.charged,
 * subscription.halted, subscription.cancelled, subscription.paused).
 *
 * SCOPE: INR only. Mandates need Indian payment rails; USD buyers use the
 * one-time flow with stage-1 renewals. The price is locked at signup (a
 * mandate debits a fixed amount) — an admin price change affects new
 * subscribers only. Coupons don't combine with mandates; a couponed
 * checkout falls back to the one-time flow client-side.
 *
 * Firestore (all functions-only, covered by default-deny): razorpayPlans
 * (site-plan+amount → Razorpay plan id cache), razorpaySubs (subscription
 * records), razorpaySubCharges (webhook idempotency markers).
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const subs = require('./subscriptions').__internals;

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function rzpAuthHeader(){
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) {
    throw new functions.https.HttpsError('failed-precondition',
      'Payments are not configured on the server yet (Razorpay keys missing).');
  }
  return 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
}

function requireAuth(context){
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  }
  return context.auth.uid;
}

async function rzp(path, body){
  const res = await fetch('https://api.razorpay.com/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: rzpAuthHeader(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = (json && json.error && json.error.description) || ('HTTP ' + res.status);
    console.error('Razorpay ' + path + ' failed:', res.status, JSON.stringify(json).slice(0, 400));
    throw new functions.https.HttpsError(res.status === 401 ? 'permission-denied' : 'internal',
      'Razorpay: ' + why);
  }
  return json;
}

// Mirror of razorpay.js — the live sale price is what gets locked in.
function effectivePlanPrice(plan){
  const num = (v) => {
    const n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  };
  const full = num(plan.price) || 0;
  const sale = num(plan.salePrice);
  if (sale === null || sale < 0 || sale >= full || full <= 0) return full;
  if (plan.saleEndsAt) {
    const d = new Date(plan.saleEndsAt);
    if (!isNaN(d.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(plan.saleEndsAt))) d.setHours(23, 59, 59, 999);
      if (Date.now() > d.getTime()) return full;
    }
  }
  return sale;
}

// The admin-set USD→INR rate — the same settings/commerce doc the client
// reads before rendering prices, so both sides convert identically.
//
// SECURITY: this value decides what a buyer is actually charged, so it is
// bounded here the same way fxRate.js bounds it when it writes the doc. Any
// rate outside a plausible band (a mistyped 0.5, or a tampered settings doc)
// would otherwise sell a 200-dollar plan for about one rupee. Out of band =>
// fall back to the hard-coded default rather than trusting it.
const FX_BOUNDS = { min: 40, max: 200 };

async function usdInrRate(){
  try {
    const doc = await db.collection('settings').doc('commerce').get();
    const r = doc.exists ? parseFloat(doc.data().usdInr) : NaN;
    if (isFinite(r) && r >= FX_BOUNDS.min && r <= FX_BOUNDS.max) return r;
    if (isFinite(r)) {
      console.error('usdInrRate: settings/commerce.usdInr is out of bounds (' + r +
        ') — falling back to 88. Check the Billing admin page.');
    }
  } catch (e) { /* fall through to the default */ }
  return 88;
}

// One Razorpay billing plan per (site plan, amount) — created once, cached,
// so price changes make a NEW Razorpay plan for new subscribers while old
// mandates keep debiting what their holders agreed to.
async function ensureRazorpayPlan(sitePlan, sitePlanId, amountMinor, kind){
  const cacheId = (sitePlanId + '_' + amountMinor + '_INR_' + kind).replace(/[^A-Za-z0-9_-]/g, '_');
  const cacheRef = db.collection('razorpayPlans').doc(cacheId);
  const cached = await cacheRef.get();
  if (cached.exists) return cached.data().razorpayPlanId;

  const plan = await rzp('plans', {
    period: kind === 'year' ? 'yearly' : 'monthly',
    interval: 1,
    item: {
      name: (sitePlan.name || sitePlanId) + ' — Stryker Trading Academy',
      amount: amountMinor,
      currency: 'INR'
    }
  });
  await cacheRef.set({
    razorpayPlanId: plan.id, sitePlanId, amountMinor, currency: 'INR', kind,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return plan.id;
}

exports.razorpaySubscribe = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const planId = String((data && data.planId) || '');
    const currency = String((data && data.currency) || '').toUpperCase();
    if (currency !== 'INR') {
      throw new functions.https.HttpsError('failed-precondition',
        'Auto-debit mandates are available for INR only — use the one-time payment instead.');
    }

    const planDoc = await db.collection('plans').doc(planId).get();
    if (!planDoc.exists) throw new functions.https.HttpsError('not-found', 'That plan could not be found.');
    const plan = planDoc.data();
    const kind = subs.periodKind(plan.period);
    if (kind === 'none') {
      throw new functions.https.HttpsError('failed-precondition', 'That plan does not renew — buy it once instead.');
    }

    const priceUsd = effectivePlanPrice(plan);
    const rate = await usdInrRate();
    const amountMinor = Math.round(priceUsd * rate) * 100;   // whole rupees, same as one-time
    if (amountMinor < 100) {
      throw new functions.https.HttpsError('failed-precondition', 'This plan is free — no subscription needed.');
    }

    const razorpayPlanId = await ensureRazorpayPlan(plan, planId, amountMinor, kind);
    const sub = await rzp('subscriptions', {
      plan_id: razorpayPlanId,
      // A mandate needs a fixed horizon: ten years of months / of years.
      total_count: kind === 'year' ? 10 : 120,
      customer_notify: 1,
      notes: { uid, planId }
    });

    await db.collection('razorpaySubs').doc(sub.id).set({
      uid, planId,
      planName: plan.name || planId,
      period: plan.period,
      amountMinor, currency: 'INR',
      razorpayPlanId,
      status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      subscriptionId: sub.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: plan.name || planId,
      amountMinor, currency: 'INR'
    };
  });

exports.razorpaySubsVerify = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const subscriptionId = String((data && data.subscriptionId) || '');
    const paymentId = String((data && data.paymentId) || '');
    const signature = String((data && data.signature) || '');
    if (!subscriptionId || !paymentId || !signature) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing payment fields.');
    }

    // Subscription checkout signs payment_id|subscription_id — the reverse
    // of the one-time orders flow.
    // Fail closed: an empty key would produce a signature anyone can forge.
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('razorpaySubsVerify: RAZORPAY_KEY_SECRET is not set — refusing to verify.');
      throw new functions.https.HttpsError('failed-precondition',
        'Payments are not configured. Please contact support.');
    }

    const expected = crypto.createHmac('sha256', keySecret)
      .update(paymentId + '|' + subscriptionId).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('Razorpay subscription signature mismatch for', subscriptionId, 'uid', uid);
      throw new functions.https.HttpsError('failed-precondition', 'Payment verification failed.');
    }

    const subRef = db.collection('razorpaySubs').doc(subscriptionId);
    const record = await db.runTransaction(async (tx) => {
      const doc = await tx.get(subRef);
      if (!doc.exists) throw new functions.https.HttpsError('not-found', 'Unknown subscription.');
      const s = doc.data();
      if (s.uid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your subscription.');
      if (s.status === 'active') throw new functions.https.HttpsError('already-exists', 'This subscription was already activated.');
      tx.update(subRef, {
        status: 'active', firstPaymentId: paymentId,
        activatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return s;
    });

    // First charge: order record + plan grant + the subscription clock.
    await db.collection('orders').add({
      studentUid: uid,
      studentEmail: (context.auth.token && context.auth.token.email) || null,
      studentName: (context.auth.token && context.auth.token.name) ||
        ((context.auth.token && context.auth.token.email) ? context.auth.token.email.split('@')[0] : 'Trader'),
      planId: record.planId, planName: record.planName,
      couponCode: null,
      finalAmount: record.amountMinor / 100, currency: 'INR',
      gateway: 'razorpay-subscription',
      razorpaySubscriptionId: subscriptionId, razorpayPaymentId: paymentId,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const studentDoc = await db.collection('students').doc(uid).get().catch(() => null);
    const banked = studentDoc && studentDoc.exists ? (studentDoc.data().paidThroughMillis || 0) : 0;
    await db.collection('students').doc(uid).set({
      plan: record.planName, planId: record.planId,
      paidThroughMillis: subs.extendPeriod(Math.max(Date.now(), banked), record.period),
      subscriptionStatus: 'active',
      subscriptionAutopay: true,
      razorpaySubscriptionId: subscriptionId
    }, { merge: true });
    await db.collection('profiles').doc(uid).set({ plan: record.planName }, { merge: true }).catch(() => {});

    return { ok: true, planName: record.planName };
  });

exports.razorpayWebhook = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) { res.status(500).send('webhook secret not configured'); return; }

    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (!signature || signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))) {
      console.warn('razorpayWebhook: bad signature');
      res.status(400).send('bad signature');
      return;
    }

    const event = req.body && req.body.event;
    const subEntity = req.body && req.body.payload && req.body.payload.subscription &&
                      req.body.payload.subscription.entity;
    const payEntity = req.body && req.body.payload && req.body.payload.payment &&
                      req.body.payload.payment.entity;
    if (!subEntity || !subEntity.id) { res.status(200).send('ignored'); return; }

    const subDoc = await db.collection('razorpaySubs').doc(subEntity.id).get();
    if (!subDoc.exists) {
      console.warn('razorpayWebhook: unknown subscription', subEntity.id);
      res.status(200).send('unknown subscription');
      return;
    }
    const record = subDoc.data();

    try {
      if (event === 'subscription.charged' && payEntity && payEntity.id) {
        // Only a captured payment extends a plan. Razorpay also emits this
        // event for authorized-but-not-captured and failed payments, and
        // acting on those grants access for money that never arrived.
        if (payEntity.status && payEntity.status !== 'captured') {
          console.warn('razorpayWebhook: ignoring', event, 'with payment status', payEntity.status);
          res.status(200).send('not captured');
          return;
        }

        // The charge must be for what this subscription actually costs. A
        // mismatch means the event does not belong to this mandate (or the
        // mandate was changed behind our back), so it is logged and refused
        // rather than silently granting a cycle.
        const chargedMinor = Number(payEntity.amount);
        const expectedMinor = Number(record.amountMinor);
        if (isFinite(chargedMinor) && isFinite(expectedMinor) && expectedMinor > 0 &&
            chargedMinor < expectedMinor) {
          console.error('razorpayWebhook: charge', payEntity.id, 'was', chargedMinor,
            'but subscription', subEntity.id, 'costs', expectedMinor, '— refusing to extend.');
          res.status(200).send('amount mismatch');
          return;
        }

        // Idempotent per payment: Razorpay retries webhooks, and two retries
        // can arrive at once. create() fails if the marker already exists, so
        // exactly one delivery gets past this line — a get-then-set could let
        // both through and extend the plan twice.
        const marker = db.collection('razorpaySubCharges').doc(payEntity.id);
        try {
          await marker.create({
            subscriptionId: subEntity.id, uid: record.uid,
            amount: payEntity.amount, createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) {
          if (e && e.code === 6) { res.status(200).send('duplicate'); return; }  // ALREADY_EXISTS
          throw e;
        }

        // The mandate's own first charge also arrives here; the verify
        // callable already granted that period, and extending from the
        // banked date makes a double-arrival harmless (max() below only
        // moves the clock forward from what it already is).
        const studentRef = db.collection('students').doc(record.uid);
        const studentDoc = await studentRef.get();
        const banked = studentDoc.exists ? (studentDoc.data().paidThroughMillis || 0) : 0;
        const alreadyCovered = record.status === 'active' && payEntity.id === record.firstPaymentId;
        if (!alreadyCovered) {
          await studentRef.set({
            plan: record.planName, planId: record.planId,
            paidThroughMillis: subs.extendPeriod(Math.max(Date.now(), banked), record.period),
            subscriptionStatus: 'active', subscriptionAutopay: true
          }, { merge: true });
          await db.collection('orders').add({
            studentUid: record.uid, studentEmail: null, studentName: 'Auto-renewal',
            planId: record.planId, planName: record.planName, couponCode: null,
            finalAmount: (payEntity.amount || record.amountMinor) / 100, currency: 'INR',
            gateway: 'razorpay-subscription', razorpaySubscriptionId: subEntity.id,
            razorpayPaymentId: payEntity.id, status: 'completed',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
          await db.collection('notifications').add({
            recipientUid: record.uid, type: 'renewal_charged',
            message: 'Your ' + record.planName + ' subscription renewed automatically — you\'re all set for another cycle.',
            link: 'settings.html', read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        console.log('razorpayWebhook: charged', subEntity.id, 'payment', payEntity.id);

      } else if (['subscription.halted', 'subscription.cancelled', 'subscription.paused',
                  'subscription.completed', 'subscription.expired'].includes(event)) {
        // Auto-debit stopped: mark it, tell the student, and let the daily
        // sweep lapse the account when paidThroughMillis + grace runs out.
        await subDoc.ref.set({ status: subEntity.status || event.split('.')[1] }, { merge: true });
        await db.collection('students').doc(record.uid).set({ subscriptionAutopay: false }, { merge: true });
        await db.collection('notifications').add({
          recipientUid: record.uid, type: 'autopay_stopped',
          message: 'Auto-renewal for your ' + record.planName + ' subscription has stopped (' +
            (subEntity.status || 'cancelled') + '). Your access runs until your paid date — renew manually to continue.',
          link: 'checkout.html?plan=' + encodeURIComponent(record.planId), read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('razorpayWebhook:', event, subEntity.id);
      }
      res.status(200).send('ok');
    } catch (err) {
      console.error('razorpayWebhook failed:', err);
      res.status(500).send('error');   // Razorpay retries on 5xx
    }
  });

exports.razorpaySubsCancel = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const studentDoc = await db.collection('students').doc(uid).get();
    const subId = studentDoc.exists ? studentDoc.data().razorpaySubscriptionId : null;
    if (!subId) throw new functions.https.HttpsError('not-found', 'No auto-renewing subscription on this account.');

    const subDoc = await db.collection('razorpaySubs').doc(subId).get();
    if (!subDoc.exists || subDoc.data().uid !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Not your subscription.');
    }

    await rzp('subscriptions/' + subId + '/cancel', { cancel_at_cycle_end: 1 });
    await subDoc.ref.set({ status: 'cancel-at-cycle-end' }, { merge: true });
    await db.collection('students').doc(uid).set({ subscriptionAutopay: false }, { merge: true });
    return { ok: true };
  });
