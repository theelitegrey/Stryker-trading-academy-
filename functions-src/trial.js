/**
 * Stryker Trading Academy: 7-day free trial of a paid, renewing plan (Pro).
 *
 * Owner order 2026-10-05: "Add 7 day free trial but they have to add card
 * while subscribing to free trial. Like most website do". So a trial is a
 * REAL subscription with a payment method on file whose first charge is
 * pushed 7 days out:
 *
 *   Stripe (non-INR)   stripeCreateCheckout({ trial: true }) adds
 *                      subscription_data.trial_period_days = 7 and
 *                      payment_method_collection = 'always' (stripe.js).
 *   Razorpay (INR)     razorpaySubscribe({ trial: true }) creates the
 *                      subscription with start_at = now + 7 days; the mandate
 *                      is authorised at signup with Razorpay's refundable
 *                      authentication payment, nothing is charged until
 *                      start_at (razorpaySubs.js).
 *
 * This file owns the RULES both gateways share. The client never decides
 * eligibility; it only asks trialEligibility to choose a button label.
 *
 *   trialEligibility (callable)  { eligible, days, reason } for the signed-in
 *                                member and an optional planId.
 *
 * ELIGIBLE when ALL hold (checked again server-side at checkout AND at grant):
 *   - settings/commerce.trialEnabled === true (the site-wide switch, default off)
 *   - the plan renews (month/year) and costs money
 *   - students/{uid}: no trialUsedAt, not a founding member, never had a
 *     Stripe or Razorpay subscription, not currently on a paid period
 *   - no orders/ for this uid with a real amount (anyone who ever paid)
 *   - trialClaims/{uid} does not exist (the once-per-account lock)
 * At grant time the payment fingerprint is claimed too: trialFingerprints/
 * {sha256(kind:value)} is create()d with the uid; a fingerprint that already
 * belongs to ANOTHER account means the trial is refused and the subscription
 * cancelled before any access is granted (one trial per card / UPI handle).
 *
 * Firestore (functions-only; default-deny covers both): trialClaims,
 * trialFingerprints. students gains trialUsedAt, trialEndsAt, trialProvider
 * (privileged fields, written only here and by the payment functions).
 *
 * DEPLOY: firebase deploy --only functions:trialEligibility (plus the payment
 * functions; see DEPLOY-TRIAL.md for the full list).
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function periodKind(period) {
  const p = String(period || '').toLowerCase();
  if (/month/.test(p)) return 'month';
  if (/year|annual/.test(p)) return 'year';
  return 'none';
}
function priceNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

async function trialSwitchOn() {
  try {
    const d = await db.collection('settings').doc('commerce').get();
    return !!(d.exists && d.data().trialEnabled === true);
  } catch (e) { return false; }
}

/**
 * Pure part of the rule, for tests: the student doc, the plan doc (or null)
 * and the member's orders. Returns { eligible, reason }.
 */
function decideEligibility(student, plan, orders, nowMs) {
  const s = student || {};
  if (plan) {
    if (periodKind(plan.period) === 'none') return { eligible: false, reason: 'plan-does-not-renew' };
    if (!(priceNum(plan.price) > 0)) return { eligible: false, reason: 'plan-is-free' };
    if (plan.archived === true) return { eligible: false, reason: 'plan-archived' };
  }
  if (s.trialUsedAt) return { eligible: false, reason: 'trial-used' };
  if (s.foundingMember) return { eligible: false, reason: 'founding-member' };
  if (s.stripeSubscriptionId || s.razorpaySubscriptionId) return { eligible: false, reason: 'had-subscription' };
  if ((s.paidThroughMillis || 0) > (nowMs || Date.now())) return { eligible: false, reason: 'already-paid' };
  const paid = (orders || []).some((o) => o && o.kind !== 'trial' &&
    Number(o.finalAmount || o.amountUsd || 0) > 0);
  if (paid) return { eligible: false, reason: 'paid-before' };
  return { eligible: true, reason: 'ok' };
}

/** Full server-side check. Never throws: anything unexpected = not eligible. */
async function checkEligibility(uid, planId, opts) {
  try {
    if (!(opts && opts.ignoreSwitch) && !(await trialSwitchOn())) return { eligible: false, reason: 'trials-off' };
    let plan = null;
    if (planId) {
      const p = await db.collection('plans').doc(String(planId)).get();
      if (!p.exists) return { eligible: false, reason: 'no-plan' };
      plan = p.data();
    }
    const [stu, claim, ordersSnap] = await Promise.all([
      db.collection('students').doc(uid).get(),
      db.collection('trialClaims').doc(uid).get(),
      db.collection('orders').where('studentUid', '==', uid).get()
    ]);
    if (claim.exists) return { eligible: false, reason: 'trial-used' };
    const orders = [];
    ordersSnap.forEach((d) => orders.push(d.data()));
    return decideEligibility(stu.exists ? stu.data() : {}, plan, orders, Date.now());
  } catch (e) {
    console.error('trial eligibility check failed', uid, e.message);
    return { eligible: false, reason: 'error' };
  }
}

function fingerprintId(kind, value) {
  return crypto.createHash('sha256').update(String(kind) + ':' + String(value).trim().toLowerCase()).digest('hex');
}

/**
 * Take the once-per-account lock and every available payment fingerprint for
 * this trial. Returns { ok:true } or { ok:false, reason }. Re-delivery for the
 * SAME subscription is ok (idempotent); a different subscription is refused.
 * fingerprints: [{ kind:'card', value:'<stripe fingerprint>' }, ...]
 */
async function claimTrial(uid, subRef, fingerprints) {
  const claimRef = db.collection('trialClaims').doc(uid);
  try {
    await claimRef.create({ uid, subRef, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    const cur = await claimRef.get();
    if (!(cur.exists && cur.data().subRef === subRef)) return { ok: false, reason: 'trial-used' };
  }
  for (const f of (fingerprints || [])) {
    if (!f || !f.value) continue;
    const ref = db.collection('trialFingerprints').doc(fingerprintId(f.kind, f.value));
    try {
      await ref.create({ uid, kind: f.kind, subRef, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
      const cur = await ref.get();
      if (cur.exists && cur.data().uid !== uid) {
        // The account lock stays (no second attempt with another card); paid
        // subscriptions never look at it, so the member can still subscribe.
        await claimRef.set({ refusedFingerprint: f.kind, refusedSubRef: subRef }, { merge: true })
          .catch(() => {});
        return { ok: false, reason: 'fingerprint-used' };
      }
    }
  }
  return { ok: true };
}

function trialEndLabel(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

exports.trialEligibility = functions
  .runWith({ maxInstances: 20, timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) return { eligible: false, days: TRIAL_DAYS, reason: 'signed-out' };
    const planId = data && data.planId ? String(data.planId) : null;
    const r = await checkEligibility(context.auth.uid, planId);
    return { eligible: r.eligible, days: TRIAL_DAYS, reason: r.reason };
  });

exports.__trialInternals = {
  TRIAL_DAYS, DAY_MS, decideEligibility, checkEligibility, claimTrial, fingerprintId, trialEndLabel, trialSwitchOn
};
