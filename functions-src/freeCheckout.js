/**
 * TradeZoro — free / fully-discounted checkout, server side
 *
 * WHY THIS EXISTS
 *
 * The coupon checkout path used to run entirely in the browser: assets/
 * checkout.js validated the coupon, then wrote plan, planId, paidThroughMillis,
 * subscriptionStatus and foundingMember straight onto students/{uid}. Anything
 * a browser writes, a browser can be made to write with different values — so
 * that path was, in effect, a button that granted any account any plan for
 * free, permanently in the foundingMember case (subscriptions.js exempts
 * founding members from expiry for good).
 *
 * The paid path was always correct: razorpayVerifyPayment checks Razorpay's
 * HMAC and grants the plan with the Admin SDK. This function is the same shape
 * for orders where nothing is owed. The client now asks for the grant and is
 * told what happened; it never writes the entitlement itself.
 *
 * WHAT IT ENFORCES (none of which the client can influence)
 *   - the plan's price comes from the plans collection, not the request
 *   - the coupon comes from the coupons collection, and its discount must
 *     actually bring the total to zero
 *   - one redemption per coupon per account, recorded in couponRedemptions
 *   - the coupon's maxRedemptions cap, claimed in the same transaction as the
 *     per-user record so two tabs cannot both take the last seat
 *   - accessMonths, when present, is a server-validated integer from the
 *     coupon document; legacy coupons still use the plan's own billing period
 *   - an existing future paid-through date is extended, never shortened
 *
 * DEPLOY (name every function or the others get deleted):
 *   firebase deploy --only functions:redeemFreeCheckout
 *
 * AFTER DEPLOYING, tighten the Firestore rules so students/{uid} rejects
 * client writes to plan, planId, paidThroughMillis, subscriptionStatus,
 * foundingMember and foundingCoupon. This function uses the Admin SDK, which
 * bypasses rules, so locking those fields costs it nothing and closes the
 * hole for good. Until the rules change, this function reduces the attack to
 * "the client could still write those fields directly" — the rules are what
 * finishes the job.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const rzp = require('./razorpay').__internals;
const couponAccess = require('./couponAccess');
const GEO = require('./geoBlock');

function couponHttpsError(err){
  if (err instanceof couponAccess.CouponAccessError) {
    const code = err.code === 'already-exists' ? 'already-exists' : 'failed-precondition';
    return new functions.https.HttpsError(code, err.message);
  }
  return err;
}

function requireAuth(context){
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  }
  return context.auth.uid;
}

// Keep free-text fields that end up in an admin's order list bounded and
// single-line. They are escaped at render time as well; this stops a 2 MB
// display name from ever reaching the document.
function clean(value, max){
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max || 200);
}

// The billing address the client collected. Stored as supplied but bounded,
// because it is display-only data that no server decision depends on.
function cleanBilling(billing){
  if (!billing || typeof billing !== 'object' || Array.isArray(billing)) return null;
  const out = {};
  ['name', 'email', 'phone', 'line1', 'line2', 'city', 'state', 'postalCode', 'country', 'taxId']
    .forEach((k) => {
      if (billing[k] === undefined || billing[k] === null) return;
      out[k] = clean(billing[k], 200);
    });
  return Object.keys(out).length ? out : null;
}

exports.redeemFreeCheckout = functions
  .runWith({ maxInstances: 20, timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const planId = String((data && data.planId) || '').trim();
    const couponCode = String((data && data.couponCode) || '').trim().toUpperCase() || null;
    const billing = cleanBilling(data && data.billing);

    if (!/^[A-Za-z0-9_-]{1,120}$/.test(planId)) {
      throw new functions.https.HttpsError('invalid-argument', 'That plan id is not valid.');
    }
    if (couponCode && !/^[A-Za-z0-9_-]{1,60}$/.test(couponCode)) {
      throw new functions.https.HttpsError('invalid-argument', 'That coupon code is not valid.');
    }

    const planDoc = await db.collection('plans').doc(planId).get();
    if (!planDoc.exists) throw new functions.https.HttpsError('not-found', 'That plan could not be found.');
    const plan = planDoc.data();
    if (plan.addon === true) throw new functions.https.HttpsError('failed-precondition', 'Live Futures Data is a monthly subscription; it cannot be bought as a one-time payment or a plan change.');
    // Sanctions geo-block (Owner order 09 Nov 2026): no purchase for a blocked or unconfirmed residence (functions-src/geoBlock.js).
    const geoStu = await db.collection('students').doc(uid).get();
    GEO.assertCanBuy(functions, geoStu.exists ? geoStu.data() : {}, billing && billing.country);

    // Price and discount are computed here, from stored data, using the same
    // helpers the paid path uses.
    const listPrice = parseFloat(plan.price) || 0;
    const price = rzp.effectivePlanPrice(plan);

    let coupon = null;
    let discount = 0;
    let grant = { permanent: false, accessMonths: null, paidThroughMillis: null };
    let studentPatch = {
      plan: plan.name || planId,
      planId
    };

    if (couponCode) {
      // Claim the coupon and grant access in one transaction. The coupon is
      // re-read here and every entitlement decision below uses this snapshot,
      // never client values or an earlier browser read.
      const redemptionRef = db.collection('couponRedemptions').doc(couponCode + '__' + uid);
      const couponRef = db.collection('coupons').doc(couponCode);
      const studentRef = db.collection('students').doc(uid);
      let outcome;
      try {
        outcome = await db.runTransaction(async (tx) => {
          const [rDoc, cDoc, studentDoc] = await Promise.all([
            tx.get(redemptionRef), tx.get(couponRef), tx.get(studentRef)
          ]);
          const c = cDoc.exists ? cDoc.data() : null;
          const now = Date.now();
          GEO.assertCanBuy(functions, studentDoc.exists ? studentDoc.data() : {}, billing && billing.country);
          const decision = couponAccess.validateCouponRedemption({
            coupon: c,
            student: studentDoc.exists ? studentDoc.data() : {},
            redemptionExists: rDoc.exists,
            price,
            planId,
            nowMillis: now
          });
          const total = Math.max(0, price - decision.discount);
          if (total > 0.009) {
            throw new functions.https.HttpsError('failed-precondition',
              'This order still has an amount due — complete it through the payment flow.');
          }

          const currentStudent = studentDoc.exists ? studentDoc.data() : {};
          const currentGrant = couponAccess.computeCouponGrant({
            coupon: c,
            plan,
            listPrice,
            nowMillis: now,
            currentPaidThroughMillis: currentStudent.paidThroughMillis
          });
          const patch = { plan: plan.name || planId, planId };
          if (currentGrant.permanent) {
            patch.foundingMember = true;
            patch.foundingCoupon = couponCode;
            // Founding access is permanent; leave no stale expiry that could
            // be mistaken for the entitlement boundary by another system.
            patch.paidThroughMillis = admin.firestore.FieldValue.delete();
          } else if (currentGrant.paidThroughMillis) {
            patch.paidThroughMillis = currentGrant.paidThroughMillis;
            patch.subscriptionStatus = 'active';
          }

          tx.create(redemptionRef, {
            couponCode,
            uid,
            planId,
            accessMonths: currentGrant.accessMonths,
            paidThroughMillis: currentGrant.paidThroughMillis,
            permanentAccess: currentGrant.permanent,
            redeemedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          tx.update(couponRef, { redemptionCount: decision.used + 1 });
          tx.set(studentRef, patch, { merge: true });
          return { coupon: c, discount: decision.discount, grant: currentGrant, studentPatch: patch };
        });
      } catch (err) {
        throw couponHttpsError(err);
      }
      coupon = outcome.coupon;
      discount = outcome.discount;
      grant = outcome.grant;
      studentPatch = outcome.studentPatch;
    } else {
      // No coupon is valid only for a genuinely free plan. Paid orders must go
      // through the signed payment path.
      if (price > 0.009) {
        throw new functions.https.HttpsError('failed-precondition',
          'This plan is not free. A valid coupon is required.');
      }
      await db.collection('students').doc(uid).set(studentPatch, { merge: true });
    }

    const profilePatch = { plan: studentPatch.plan };
    if (studentPatch.foundingMember) profilePatch.foundingMember = true;
    await db.collection('profiles').doc(uid).set(profilePatch, { merge: true }).catch(() => {});

    // The order record. Identity comes from the verified auth token, not from
    // whatever the client claimed its own name and email were.
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    await db.collection('orders').add({
      studentUid: uid,
      studentName: clean((authUser && authUser.displayName) ||
                         (authUser && authUser.email ? authUser.email.split('@')[0] : 'Trader'), 120),
      studentEmail: clean(authUser && authUser.email, 200) || null,
      planId,
      planName: plan.name || planId,
      listPrice,
      originalPrice: price,
      couponCode: couponCode || null,
      accessMonths: grant.accessMonths,
      paidThroughMillis: grant.paidThroughMillis,
      permanentAccess: grant.permanent,
      discountApplied: discount,
      finalAmount: 0,
      currency: 'USD',
      gateway: 'coupon',
      billing,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('redeemFreeCheckout:', uid, '→', planId, couponCode ? 'coupon ' + couponCode : '(free plan)');

    return {
      ok: true,
      planName: studentPatch.plan,
      foundingMember: grant.permanent,
      accessMonths: grant.accessMonths,
      paidThroughMillis: grant.paidThroughMillis
    };
  });
