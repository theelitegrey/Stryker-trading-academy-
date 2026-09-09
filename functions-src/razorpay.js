/**
 * Stryker Trading Academy — Razorpay Standard Checkout
 *
 * Two callables driving card/UPI payment for plan purchases:
 *
 *   razorpayCreateOrder  — computes the price SERVER-SIDE (plan doc + live
 *                          sale + coupon), creates the Razorpay order, and
 *                          records it in razorpayOrders/{orderId}. The client
 *                          never chooses the amount, so a tampered page can't
 *                          buy Elite for a rupee.
 *   razorpayVerifyPayment— checks the HMAC-SHA256 signature, then (in a
 *                          transaction, so a replay can't double-grant) marks
 *                          the order paid, writes the same orders/{} record
 *                          the coupon checkout writes, grants the plan on the
 *                          student doc + public profile, and claims the
 *                          coupon seat if one was applied.
 *
 * DEPLOY (from the functions directory; name every function or the others
 * get deleted):
 *   cat >> .env << 'ENV'
 *   RAZORPAY_KEY_ID=rzp_test_...
 *   RAZORPAY_KEY_SECRET=...
 *   ENV
 *   firebase deploy --only functions:razorpayCreateOrder,functions:razorpayVerifyPayment
 *
 * CURRENCY: plan prices are stored as USD numbers. The client sends the
 * currency it DISPLAYED ('USD', or 'INR' for visitors in India — see
 * assets/plan-price.js); for INR the dollar total is converted with the
 * admin-set rate in settings/commerce.usdInr (fallback 88), rounded to whole
 * rupees with the exact same Math.round the client uses, so the page price
 * and the charge always match. If the Razorpay account can't accept a USD
 * order (international currency presentment not enabled), the order is
 * retried once in INR at the same rate — the Razorpay modal shows the buyer
 * the ₹ amount and currency before they pay, so nothing is hidden.
 *
 * No SDK dependency: the two REST calls Razorpay needs are plain fetch()
 * with basic auth (Node 20 has global fetch), so nothing new to npm install.
 *
 * Firestore: razorpayOrders is written ONLY by these functions (admin SDK
 * bypasses rules); no client rule is needed for it — leave it out of the
 * rules entirely and default-deny covers it.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

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

// Server-side mirror of the client's sale logic (assets/plan-price.js):
// a sale is live when salePrice parses, is below the list price, and the
// end date (whole-day inclusive) hasn't passed.
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

// Server-side mirror of assets/commerce.js coupon checks + discount math.
function couponDiscount(coupon, price, planId){
  if (!coupon || coupon.active === false) return { ok: false, why: 'That coupon is no longer active.' };
  if (coupon.expiresAt && coupon.expiresAt < new Date().toISOString().slice(0, 10)) {
    return { ok: false, why: 'That coupon has expired.' };
  }
  if (coupon.maxRedemptions && (coupon.redemptionCount || 0) >= coupon.maxRedemptions) {
    return { ok: false, why: 'That coupon has reached its redemption limit.' };
  }
  if (coupon.appliesToPlan !== 'all' && coupon.appliesToPlan !== planId) {
    return { ok: false, why: 'That coupon doesn\'t apply to this plan.' };
  }
  let discount = 0;
  if (coupon.type === 'free') discount = price;
  else if (coupon.type === 'percent') discount = Math.min(price, price * (parseFloat(coupon.value) || 0) / 100);
  else if (coupon.type === 'fixed') discount = Math.min(price, parseFloat(coupon.value) || 0);
  return { ok: true, discount };
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

// Exported so the free-checkout callable computes prices and coupon discounts
// with exactly the same code the paid path uses. Two copies of pricing logic
// is how a discount ends up meaning different things on two routes.
exports.__internals = { effectivePlanPrice, couponDiscount, usdInrRate, requireAuth };

exports.razorpayCreateOrder = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const planId = String((data && data.planId) || '');
    const couponCode = String((data && data.couponCode) || '').trim().toUpperCase() || null;
    const reqCurrency = String((data && data.currency) || '').toUpperCase();

    const planDoc = await db.collection('plans').doc(planId).get();
    if (!planDoc.exists) throw new functions.https.HttpsError('not-found', 'That plan could not be found.');
    const plan = planDoc.data();

    let price = effectivePlanPrice(plan);
    let coupon = null;
    if (couponCode) {
      const cDoc = await db.collection('coupons').doc(couponCode).get();
      if (!cDoc.exists) throw new functions.https.HttpsError('failed-precondition', 'That coupon code doesn\'t exist.');
      coupon = cDoc.data();
      const res = couponDiscount(coupon, price, planId);
      if (!res.ok) throw new functions.https.HttpsError('failed-precondition', res.why);
      price = Math.max(0, price - res.discount);
    }

    // `price` is the USD total after sale + coupon. The buyer pays it in the
    // currency their page displayed: dollars as-is, or whole rupees at the
    // admin rate — Math.round(usd * rate), matching planMoneyDisplay exactly.
    let currency = (reqCurrency === 'INR' || reqCurrency === 'USD') ? reqCurrency : 'USD';
    const rate = await usdInrRate();
    const minorFor = (cur) => cur === 'INR' ? Math.round(price * rate) * 100 : Math.round(price * 100);

    let amountMinor = minorFor(currency);
    if (amountMinor < 100) {
      // Fully (or nearly) discounted — the coupon checkout path handles free.
      throw new functions.https.HttpsError('failed-precondition',
        'This order is free after the coupon — complete it without payment.');
    }

    const createOrder = (cur, minor) => fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: rzpAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: minor,
        currency: cur,
        receipt: (uid.slice(0, 24) + '_' + Date.now()).slice(0, 40),
        notes: { uid, planId, coupon: couponCode || '' }
      })
    });

    let resp = await createOrder(currency, amountMinor);
    if (!resp.ok && resp.status !== 401 && currency === 'USD') {
      // A Razorpay account without international currency presentment rejects
      // USD orders outright. Rather than dead-ending every non-Indian buyer,
      // fall back to the INR equivalent at the same rate — the Razorpay modal
      // shows them the ₹ amount and currency before any card details go in.
      const body = await resp.text().catch(() => '');
      console.warn('USD order rejected, retrying in INR', resp.status, body.slice(0, 300));
      currency = 'INR';
      amountMinor = minorFor('INR');
      resp = await createOrder(currency, amountMinor);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('Razorpay order create failed', resp.status, body.slice(0, 500));
      throw new functions.https.HttpsError(resp.status === 401 ? 'permission-denied' : 'internal',
        resp.status === 401 ? 'Payment gateway credentials were rejected.' : 'The payment gateway could not create the order.');
    }
    const order = await resp.json();

    await db.collection('razorpayOrders').doc(order.id).set({
      uid,
      planId,
      planName: plan.name || planId,
      couponCode,
      amountMinor,
      currency,
      amountUsd: price,
      fxRate: currency === 'INR' ? rate : null,
      status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      orderId: order.id,
      amount: amountMinor,
      currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: plan.name || planId
    };
  });

exports.razorpayVerifyPayment = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const orderId = String((data && data.orderId) || '');
    const paymentId = String((data && data.paymentId) || '');
    const signature = String((data && data.signature) || '');
    if (!orderId || !paymentId || !signature) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing payment fields.');
    }

    // Fail closed. With no secret configured the HMAC below would be
    // computed against an empty key, which is a signature anyone can forge.
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('razorpayVerifyPayment: RAZORPAY_KEY_SECRET is not set — refusing to verify.');
      throw new functions.https.HttpsError('failed-precondition',
        'Payments are not configured. Please contact support.');
    }

    const expected = crypto.createHmac('sha256', keySecret)
      .update(orderId + '|' + paymentId).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('Razorpay signature mismatch for', orderId, 'uid', uid);
      throw new functions.https.HttpsError('failed-precondition', 'Payment verification failed.');
    }

    const orderRef = db.collection('razorpayOrders').doc(orderId);

    // The transaction is the double-grant guard: a verified order flips
    // created -> paid exactly once; replays hit 'paid' and fail cleanly.
    const order = await db.runTransaction(async (tx) => {
      const doc = await tx.get(orderRef);
      if (!doc.exists) throw new functions.https.HttpsError('not-found', 'Unknown order.');
      const o = doc.data();
      if (o.uid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your order.');
      if (o.status === 'paid') throw new functions.https.HttpsError('already-exists', 'This payment was already processed.');
      tx.update(orderRef, {
        status: 'paid',
        paymentId,
        paidAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return o;
    });

    // Coupon seat (partial-discount coupons ride along with a payment).
    let founding = false;
    if (order.couponCode) {
      const cRef = db.collection('coupons').doc(order.couponCode);
      await db.runTransaction(async (tx) => {
        const cDoc = await tx.get(cRef);
        if (!cDoc.exists) return;
        founding = !!cDoc.data().marksFounding;
        tx.update(cRef, { redemptionCount: (cDoc.data().redemptionCount || 0) + 1 });
      }).catch(() => {});
    }

    // The money record — same shape the coupon checkout writes, plus gateway.
    await db.collection('orders').add({
      studentUid: uid,
      studentEmail: (context.auth.token && context.auth.token.email) || null,
      studentName: (context.auth.token && context.auth.token.name) ||
        ((context.auth.token && context.auth.token.email) ? context.auth.token.email.split('@')[0] : 'Trader'),
      planId: order.planId,
      planName: order.planName,
      couponCode: order.couponCode,
      finalAmount: order.amountMinor / 100,
      currency: order.currency,
      amountUsd: order.amountUsd != null ? order.amountUsd : null,
      fxRate: order.fxRate || null,
      gateway: 'razorpay',
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // The access grant — with the subscription clock. A paid periodic plan
    // stamps paidThroughMillis one billing period past the later of now and
    // any time already banked (an early renewal stacks, never resets). The
    // daily subscriptionSweep (subscriptions.js) enforces the date.
    const patch = { plan: order.planName, planId: order.planId };
    if (founding) { patch.foundingMember = true; patch.foundingCoupon = order.couponCode; }

    const subs = require('./subscriptions').__internals;
    const planDoc2 = await db.collection('plans').doc(order.planId).get().catch(() => null);
    const period = planDoc2 && planDoc2.exists ? planDoc2.data().period : null;
    if (!founding && subs.periodKind(period) !== 'none') {
      const studentDoc = await db.collection('students').doc(uid).get().catch(() => null);
      const banked = studentDoc && studentDoc.exists ? (studentDoc.data().paidThroughMillis || 0) : 0;
      patch.paidThroughMillis = subs.extendPeriod(Math.max(Date.now(), banked), period);
      patch.subscriptionStatus = 'active';
    }
    await db.collection('students').doc(uid).set(patch, { merge: true });
    const profilePatch = { plan: order.planName };
    if (founding) profilePatch.foundingMember = true;
    await db.collection('profiles').doc(uid).set(profilePatch, { merge: true }).catch(() => {});

    return { ok: true, planName: order.planName };
  });
