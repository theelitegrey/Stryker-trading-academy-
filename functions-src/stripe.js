/**
 * Stryker Trading Academy: Stripe subscriptions (every non-INR buyer).
 *
 * Razorpay stays the INR / India path, unchanged (razorpay.js, razorpaySubs.js).
 * Stripe takes everyone else: real recurring subscriptions in USD, monthly or
 * yearly, paid on Stripe's HOSTED Checkout page (cards, Apple Pay, Google Pay).
 * No card data ever touches this site, so we stay SAQ-A.
 *
 *   stripeCreateCheckout (callable) computes the price SERVER-SIDE with the exact
 *                        helpers razorpay.js uses (effective plan price, launch
 *                        sale, founding lock-for-life, coupons), reuses or
 *                        creates the member's Stripe Customer, and opens a
 *                        Checkout Session in mode=subscription. Returns { url }.
 *   stripeWebhook (HTTPS) verifies the Stripe-Signature over the raw body, then:
 *       checkout.session.completed   grant the plan, stamp the first period,
 *                                    write orders/ (gateway 'stripe'), claim
 *                                    the coupon seat, record the founding price
 *       invoice.paid                 extend paidThroughMillis to the invoice
 *                                    period end; renewals also write orders/
 *                                    (idempotent per invoice id)
 *       invoice.payment_failed       recorded + the member is told; access runs
 *                                    to paidThroughMillis while Stripe retries
 *       customer.subscription.updated / .deleted
 *                                    autopay on/off; the daily
 *                                    subscriptionSweep lapses the account
 *                                    naturally after paidThroughMillis + grace
 *   stripePortal (callable) opens a Billing Portal session (update card,
 *                           cancel at period end, invoices).
 *   stripeStatus (callable, admins only) reports whether Stripe is configured,
 *                           test or live, for commerce-admin.
 *
 * PRICES   One Stripe Product per site plan, one Price per (plan, amount,
 *          interval), cached in stripePrices/. A member's subscription is bound
 *          to the Price it started on, so a founding/launch price stays fixed
 *          for that member for as long as the subscription lives, and an admin
 *          price change only affects new subscribers.
 * COUPONS  100%-off coupons never get here (the client routes a $0 total to
 *          redeemFreeCheckout). Percent / fixed coupons become a Stripe coupon
 *          (duration 'once' = first payment only, the same meaning they have on
 *          a one-time Razorpay charge), created server-side and cached in
 *          stripeCoupons/. Founding (marksFounding) coupons grant lifetime
 *          access, which cannot be sold as a recurring subscription, so they are
 *          refused on this path with a clear message.
 *
 * ENV (functions .env, never in the repo):
 *   STRIPE_SECRET_KEY       sk_test_… / rk_live_… (restricted key: see DEPLOY.md)
 *   STRIPE_WEBHOOK_SECRET   whsec_… of the endpoint pointing at stripeWebhook
 *   STRIPE_PORTAL_CONFIG    optional bpc_… Billing Portal configuration id
 *   SITE_ORIGIN             optional, default https://strykertrading.com
 *
 * DEPLOY (name every function or the others get deleted):
 *   firebase deploy --only functions:stripeCreateCheckout,functions:stripeWebhook,functions:stripePortal,functions:stripeStatus
 *
 * Firestore (functions-only; default-deny covers all of them): stripeCustomers,
 * stripeSessions, stripeSubs, stripePrices, stripeCoupons, stripeEvents,
 * stripeInvoices. students gains stripeCustomerId / stripeSubscriptionId /
 * billingProvider, which the rules treat as privileged.
 *
 * No SDK: plain fetch() with form encoding and a pinned API version, the same
 * approach razorpay.js takes, so nothing new to npm install or audit.
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const STRIPE_API = 'https://api.stripe.com/v1/';
// Pinned for our own API calls. Webhook EVENTS arrive in the endpoint's (or the
// account's) API version, which may be newer (2025+ "basil"/"dahlia" moved
// invoice.subscription to invoice.parent.subscription_details and
// current_period_end onto subscription items), so everything read from an
// event goes through the version-tolerant helpers below.
const STRIPE_VERSION = '2024-06-20';

function invSubId(inv) {
  if (inv.subscription) return typeof inv.subscription === 'string' ? inv.subscription : inv.subscription.id;
  const d = inv.parent && inv.parent.subscription_details;
  return (d && (typeof d.subscription === 'string' ? d.subscription : d.subscription && d.subscription.id)) || null;
}
function invSubMeta(inv) {
  return (inv.subscription_details && inv.subscription_details.metadata) ||
    (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.metadata) || {};
}
function subPeriodEnd(sub) {
  if (sub.current_period_end) return sub.current_period_end;
  const ends = ((sub.items && sub.items.data) || []).map((i) => i.current_period_end).filter(Boolean);
  return ends.length ? Math.max.apply(null, ends) : null;
}
const SIG_TOLERANCE_S = 300;

// While the key is a TEST key the functions are deployed to production but
// must not be usable by real members: a test card would otherwise buy a real
// plan. In test mode only admins and QA throwaways (stryker-qa-*@example.com)
// may open a checkout. Live keys skip this entirely.
const QA_EMAIL = /^stryker-qa-[a-z0-9._-]+@example\.com$/i;
function isTestKey() { return /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || ''); }
async function testModeGate(uid, context) {
  if (!isTestKey()) {
    // Live: the site-wide switch must be on (admins may still test with it off).
    const com = await db.collection('settings').doc('commerce').get();
    if (com.exists && com.data().stripeCheckout === true) return;
    const adm = await db.collection('admins').doc(uid).get();
    if (adm.exists) return;
    throw new functions.https.HttpsError('failed-precondition', 'Card payments are not open yet.');
  }
  const email = String((context.auth.token && context.auth.token.email) || '');
  if (QA_EMAIL.test(email)) return;
  const adm = await db.collection('admins').doc(uid).get();
  if (adm.exists) return;
  throw new functions.https.HttpsError('failed-precondition', 'Card payments are not open yet.');
}

const siteOrigin = () => (process.env.SITE_ORIGIN || 'https://strykertrading.com').replace(/\/$/, '');

function requireAuth(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  }
  return context.auth.uid;
}

function stripeKey() {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) {
    throw new functions.https.HttpsError('failed-precondition',
      'Card payments are not configured on the server yet.');
  }
  return k;
}

// Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0][b]=v.
function formEncode(obj, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') formEncode(item, key + '[' + i + ']', out);
        else out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(String(item)));
      });
    } else if (typeof v === 'object') {
      formEncode(v, key, out);
    } else {
      out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
    }
  }
  return out.join('&');
}

async function stripe(method, path, params, idemKey) {
  const headers = {
    Authorization: 'Bearer ' + stripeKey(),
    'Stripe-Version': STRIPE_VERSION,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  let url = STRIPE_API + path;
  let body;
  if (params && method === 'GET') url += (url.includes('?') ? '&' : '?') + formEncode(params);
  else if (params) body = formEncode(params);
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json && json.error;
    // Never log the key; Stripe's error bodies don't contain it.
    console.error('Stripe ' + method + ' ' + path.split('?')[0] + ' failed:', res.status,
      (e && (e.type + ' ' + (e.code || '') + ' ' + (e.message || ''))) || '');
    const err = new functions.https.HttpsError(res.status === 401 ? 'permission-denied' : 'internal',
      res.status === 401 ? 'The card-payment gateway rejected our credentials.'
        : 'The card-payment gateway could not complete that request.');
    err.stripeStatus = res.status;
    err.stripeCode = e && e.code;
    throw err;
  }
  return json;
}

// ---- pricing (shared with the Razorpay path, never re-implemented) -----------
const R = () => require('./razorpay').__internals;
const L = () => require('./launchSale').__launchInternals;
const S = () => require('./subscriptions').__internals;

/**
 * The USD price this member pays for planId right now, before any coupon, and
 * after the live sale and their founding lock (a lock only ever lowers it).
 * Mirrors razorpayCreateOrder line for line.
 */
async function baseUsdFor(uid, plan, planId) {
  let price = R().effectivePlanPrice(plan);
  const lock = await L().foundingLock(uid, planId);
  if (lock && lock.usd != null && lock.usd < price) price = lock.usd;
  return price;
}

async function ensureProduct(plan, planId) {
  const ref = db.collection('stripePrices').doc('product_' + planId.replace(/[^A-Za-z0-9_-]/g, '_'));
  const snap = await ref.get();
  if (snap.exists && snap.data().productId) return snap.data().productId;
  const product = await stripe('POST', 'products', {
    name: (plan.name || planId) + ' (Stryker Trading Academy)',
    metadata: { sitePlanId: planId }
  }, 'product_' + planId);
  await ref.set({ productId: product.id, sitePlanId: planId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return product.id;
}

// One recurring Price per (plan, amount, interval), created once and cached.
async function ensurePrice(plan, planId, amountCents, interval) {
  const id = (planId + '_' + amountCents + '_usd_' + interval).replace(/[^A-Za-z0-9_-]/g, '_');
  const ref = db.collection('stripePrices').doc(id);
  const snap = await ref.get();
  if (snap.exists && snap.data().priceId) return snap.data().priceId;
  const productId = await ensureProduct(plan, planId);
  const price = await stripe('POST', 'prices', {
    product: productId,
    currency: 'usd',
    unit_amount: amountCents,
    recurring: { interval },
    metadata: { sitePlanId: planId }
  }, 'price_' + id);
  await ref.set({ priceId: price.id, productId, sitePlanId: planId, amountCents, interval,
    createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return price.id;
}

// A site coupon as a Stripe coupon: first payment only (duration 'once').
async function ensureStripeCoupon(code, coupon, planId) {
  const shape = coupon.type === 'percent'
    ? { percent_off: Math.min(100, parseFloat(coupon.value) || 0) }
    : { amount_off: Math.round((parseFloat(coupon.value) || 0) * 100), currency: 'usd' };
  const key = (code + '_' + coupon.type + '_' + (shape.percent_off != null ? shape.percent_off : shape.amount_off))
    .replace(/[^A-Za-z0-9_-]/g, '_');
  const ref = db.collection('stripeCoupons').doc(key);
  const snap = await ref.get();
  if (snap.exists && snap.data().stripeCouponId) return snap.data().stripeCouponId;
  const c = await stripe('POST', 'coupons', Object.assign({
    duration: 'once',
    name: String(code).slice(0, 40),
    metadata: { siteCoupon: code }
  }, shape), 'coupon_' + key);
  await ref.set({ stripeCouponId: c.id, code, planId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return c.id;
}

async function ensureCustomer(uid, token) {
  const ref = db.collection('stripeCustomers').doc(uid);
  const snap = await ref.get();
  if (snap.exists && snap.data().customerId) return snap.data().customerId;
  const customer = await stripe('POST', 'customers', {
    email: (token && token.email) || undefined,
    name: (token && token.name) || undefined,
    metadata: { uid }
  }, 'customer_' + uid);
  await ref.set({ customerId: customer.id, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return customer.id;
}

exports.stripeCreateCheckout = functions
  .runWith({ maxInstances: 30, timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    stripeKey();
    await testModeGate(uid, context);
    const planId = String((data && data.planId) || '');
    const couponCode = String((data && data.couponCode) || '').trim().toUpperCase() || null;

    const planDoc = await db.collection('plans').doc(planId).get();
    if (!planDoc.exists) throw new functions.https.HttpsError('not-found', 'That plan could not be found.');
    const plan = planDoc.data();
    const kind = S().periodKind(plan.period);
    if (kind === 'none') {
      throw new functions.https.HttpsError('failed-precondition', 'That plan does not renew, so it cannot be a subscription.');
    }

    // One live Stripe subscription per member: a second checkout would bill twice.
    const stu = await db.collection('students').doc(uid).get();
    const s = stu.exists ? stu.data() : {};
    if (s.stripeSubscriptionId && s.subscriptionAutopay && (s.paidThroughMillis || 0) > Date.now()) {
      throw new functions.https.HttpsError('already-exists',
        'You already have an active subscription. Manage it from Settings > Manage billing.');
    }

    const baseUsd = await baseUsdFor(uid, plan, planId);
    const baseCents = Math.round(baseUsd * 100);
    if (baseCents < 50) {   // Stripe's USD minimum; anything below is the free path
      throw new functions.https.HttpsError('failed-precondition', 'This plan is free, so no payment is needed.');
    }

    let discounts;
    let firstCents = baseCents;
    if (couponCode) {
      const cDoc = await db.collection('coupons').doc(couponCode).get();
      if (!cDoc.exists) throw new functions.https.HttpsError('failed-precondition', 'That coupon code doesn\'t exist.');
      const coupon = cDoc.data();
      const res = R().couponDiscount(coupon, baseUsd, planId);
      if (!res.ok) throw new functions.https.HttpsError('failed-precondition', res.why);
      if (coupon.marksFounding) {
        throw new functions.https.HttpsError('failed-precondition',
          'That founding coupon is for a one-time purchase and cannot be used on a subscription.');
      }
      firstCents = Math.round(Math.max(0, baseUsd - res.discount) * 100);
      if (firstCents < 50) {
        throw new functions.https.HttpsError('failed-precondition',
          'This order is free after the coupon, so complete it without payment.');
      }
      if (coupon.type === 'percent' || coupon.type === 'fixed') {
        discounts = [{ coupon: await ensureStripeCoupon(couponCode, coupon, planId) }];
      }
    }

    const priceId = await ensurePrice(plan, planId, baseCents, kind);
    const customerId = await ensureCustomer(uid, context.auth.token);
    const back = siteOrigin() + '/checkout.html?plan=' + encodeURIComponent(planId);
    const meta = { uid, sitePlanId: planId, lockUsd: String(baseUsd), coupon: couponCode || '' };

    const session = await stripe('POST', 'checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: priceId, quantity: 1 }],
      discounts,
      // Card + wallets (Apple Pay / Google Pay ride on 'card' in Checkout).
      payment_method_types: ['card'],
      billing_address_collection: 'auto',
      // USD only: Adaptive Pricing would show local currency with a ~4% FX fee
      // (India → Razorpay handles INR instead).
      adaptive_pricing: { enabled: 'false' },
      metadata: meta,
      subscription_data: { metadata: meta },
      // Stripe shows its own recurring-terms line; ours sits above the button.
      success_url: back + '&stripe=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: back + '&stripe=cancel'
    });

    await db.collection('stripeSessions').doc(session.id).set({
      uid, planId, planName: plan.name || planId, period: plan.period,
      couponCode, baseUsd, baseCents, firstCents, priceId, customerId,
      status: 'created', createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { url: session.url, sessionId: session.id, amountCents: firstCents, renewCents: baseCents, interval: kind };
  });

// ---- webhook -------------------------------------------------------------------

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]; HMAC-SHA256 of `${t}.${raw}`.
function verifySignature(rawBody, header, secret, nowSec) {
  if (!header || !secret || !rawBody) return false;
  const parts = String(header).split(',').map((p) => p.split('='));
  const t = (parts.find(([k]) => k === 't') || [])[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs((nowSec || Math.floor(Date.now() / 1000)) - Number(t)) > SIG_TOLERANCE_S) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody.toString('utf8')).digest('hex');
  const a = Buffer.from(expected);
  return sigs.some((s) => { const b = Buffer.from(String(s)); return b.length === a.length && crypto.timingSafeEqual(a, b); });
}

function notify(uid, type, message, link) {
  return db.collection('notifications').add({
    recipientUid: uid, type, message, link: link || null, read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch((e) => console.error('stripe notify failed', uid, e.message));
}

// Resolve the member + plan for a subscription: our own record first, then the
// metadata Stripe carries (set by stripeCreateCheckout), never anything else.
async function subRecord(subId, metaFallback) {
  if (!subId) return null;
  const snap = await db.collection('stripeSubs').doc(subId).get();
  if (snap.exists) return Object.assign({ ref: snap.ref }, snap.data());
  if (metaFallback && metaFallback.uid && metaFallback.sitePlanId) {
    const planSnap = await db.collection('plans').doc(metaFallback.sitePlanId).get();
    const plan = planSnap.exists ? planSnap.data() : {};
    return { ref: snap.ref, uid: metaFallback.uid, planId: metaFallback.sitePlanId,
      planName: plan.name || metaFallback.sitePlanId, period: plan.period || null, pending: true };
  }
  return null;
}

// Move paidThroughMillis forward to a Stripe period end (never backwards).
async function grantThrough(uid, planName, planId, periodEndSec, extra) {
  const ref = db.collection('students').doc(uid);
  const snap = await ref.get();
  const banked = snap.exists ? (snap.data().paidThroughMillis || 0) : 0;
  const patch = Object.assign({
    plan: planName, planId,
    paidThroughMillis: Math.max(banked, periodEndSec * 1000),
    subscriptionStatus: 'active',
    billingProvider: 'stripe'
  }, extra || {});
  await ref.set(patch, { merge: true });
  await db.collection('profiles').doc(uid).set({ plan: planName }, { merge: true }).catch(() => {});
  return patch.paidThroughMillis;
}

async function onCheckoutCompleted(session) {
  if (session.mode !== 'subscription') return 'ignored: mode ' + session.mode;
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return 'ignored: payment_status ' + session.payment_status;
  }
  const sRef = db.collection('stripeSessions').doc(session.id);
  // Double-grant guard: created -> paid exactly once.
  const rec = await db.runTransaction(async (tx) => {
    const doc = await tx.get(sRef);
    if (!doc.exists) return null;
    const r = doc.data();
    if (r.status === 'paid') return 'dup';
    // The session must belong to the member it was created for; checked before
    // the session is marked paid, so a mismatch can't burn a real one.
    if (session.client_reference_id && session.client_reference_id !== r.uid) return 'mismatch';
    tx.update(sRef, { status: 'paid', subscriptionId: session.subscription || null,
      paidAt: admin.firestore.FieldValue.serverTimestamp() });
    return r;
  });
  if (rec === 'dup') return 'duplicate session';
  if (rec === 'mismatch') { console.error('stripeWebhook: session', session.id, 'uid mismatch'); return 'uid mismatch'; }
  if (!rec) { console.error('stripeWebhook: unknown session', session.id); return 'unknown session'; }

  const sub = await stripe('GET', 'subscriptions/' + session.subscription);
  const amountPaid = Number(session.amount_total != null ? session.amount_total : rec.firstCents);

  await db.collection('stripeSubs').doc(sub.id).set({
    uid: rec.uid, planId: rec.planId, planName: rec.planName, period: rec.period,
    customerId: rec.customerId, priceId: rec.priceId, renewCents: rec.baseCents,
    baseUsd: rec.baseUsd, couponCode: rec.couponCode || null, sessionId: session.id,
    status: sub.status, cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    currentPeriodEnd: subPeriodEnd(sub), latestInvoice: sub.latest_invoice || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Coupon seat, same as razorpayVerifyPayment.
  if (rec.couponCode) {
    const cRef = db.collection('coupons').doc(rec.couponCode);
    await db.runTransaction(async (tx) => {
      const c = await tx.get(cRef);
      if (!c.exists) return;
      tx.update(cRef, { redemptionCount: (c.data().redemptionCount || 0) + 1 });
    }).catch(() => {});
  }

  // The money record. launchSaleOnOrder counts the seat from this doc.
  await db.collection('orders').add({
    studentUid: rec.uid,
    studentEmail: (session.customer_details && session.customer_details.email) || null,
    studentName: (session.customer_details && session.customer_details.name) || 'Trader',
    planId: rec.planId, planName: rec.planName, couponCode: rec.couponCode || null,
    finalAmount: amountPaid / 100, currency: 'USD', amountUsd: amountPaid / 100,
    gateway: 'stripe', provider: 'stripe',
    stripeSessionId: session.id, stripeSubscriptionId: sub.id,
    stripeInvoiceId: sub.latest_invoice || null,
    status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  // The first invoice is covered by this order; a later invoice.paid for it
  // must not write a second one.
  if (sub.latest_invoice) {
    await db.collection('stripeInvoices').doc(String(sub.latest_invoice)).create({
      uid: rec.uid, subscriptionId: sub.id, kind: 'first', createdAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  }

  await grantThrough(rec.uid, rec.planName, rec.planId, subPeriodEnd(sub), {
    subscriptionAutopay: !sub.cancel_at_period_end,
    stripeCustomerId: rec.customerId,
    stripeSubscriptionId: sub.id
  });

  await L().recordFoundingPrice(rec.uid, rec.planId, rec.baseUsd != null ? rec.baseUsd : null, null)
    .catch((e) => console.error('founding price not recorded', rec.uid, e.message));
  return 'granted ' + rec.planName + ' to ' + rec.uid;
}

async function onInvoicePaid(inv) {
  const subId = invSubId(inv);
  if (!subId) return 'ignored: no subscription';
  if (String(inv.currency || '').toLowerCase() !== 'usd') return 'ignored: currency ' + inv.currency;
  const rec = await subRecord(subId, invSubMeta(inv));
  if (!rec) { console.warn('stripeWebhook: invoice for unknown subscription', subId); return 'unknown subscription'; }

  // Latest service period on the invoice (the subscription line; prorations end earlier).
  const ends = ((inv.lines && inv.lines.data) || []).map((l) => l.period && l.period.end).filter(Boolean);
  const periodEnd = ends.length ? Math.max.apply(null, ends) : null;
  if (!periodEnd) return 'no period';

  // Renewals must be for what this subscription costs (a first invoice may be
  // lower because of a first-payment coupon).
  const isFirst = inv.billing_reason === 'subscription_create';
  if (!isFirst && rec.renewCents && Number(inv.amount_paid) < Number(rec.renewCents)) {
    console.error('stripeWebhook: invoice', inv.id, 'paid', inv.amount_paid, 'but subscription costs', rec.renewCents);
    return 'amount mismatch';
  }

  // Idempotent per invoice: exactly one delivery gets past create().
  let fresh = true;
  try {
    await db.collection('stripeInvoices').doc(inv.id).create({
      uid: rec.uid, subscriptionId: subId, kind: isFirst ? 'first' : 'renewal',
      amountPaid: inv.amount_paid, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) fresh = false;
    else throw e;
  }

  // Extending to the period end is harmless to repeat (max()), so it always runs.
  const through = await grantThrough(rec.uid, rec.planName, rec.planId, periodEnd,
    { subscriptionAutopay: true, stripeSubscriptionId: subId });
  if (rec.ref && !rec.pending) {
    await rec.ref.set({ currentPeriodEnd: periodEnd, lastPaidInvoice: inv.id, status: 'active',
      lastPaymentFailedAt: null }, { merge: true });
  }

  if (fresh && !isFirst) {
    await db.collection('orders').add({
      studentUid: rec.uid, studentEmail: inv.customer_email || null, studentName: 'Auto-renewal',
      planId: rec.planId, planName: rec.planName, couponCode: null,
      finalAmount: inv.amount_paid / 100, currency: 'USD', amountUsd: inv.amount_paid / 100,
      gateway: 'stripe', provider: 'stripe', stripeSubscriptionId: subId, stripeInvoiceId: inv.id,
      status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await notify(rec.uid, 'renewal_charged',
      'Your ' + rec.planName + ' subscription renewed automatically, so you\'re all set for another cycle.', 'settings.html');
  }
  return (fresh ? '' : 'repeat ') + 'paid through ' + new Date(through).toISOString();
}

async function onInvoiceFailed(inv) {
  const subId = invSubId(inv);
  if (!subId) return 'ignored: no subscription';
  const rec = await subRecord(subId, invSubMeta(inv));
  if (!rec) return 'unknown subscription';
  if (rec.ref && !rec.pending) {
    await rec.ref.set({ lastPaymentFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastFailedInvoice: inv.id, attemptCount: inv.attempt_count || null }, { merge: true });
  }
  // Tell the member once per invoice.
  const marker = db.collection('stripeInvoices').doc(inv.id + '_failed_' + (inv.attempt_count || 1));
  try { await marker.create({ uid: rec.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() }); }
  catch (e) { return 'failure already recorded'; }
  if ((inv.attempt_count || 1) === 1) {
    await notify(rec.uid, 'payment_failed',
      'We couldn\'t charge your card for ' + rec.planName + '. We\'ll retry automatically. Update your card in Settings > Manage billing to keep your access.',
      'settings.html');
  }
  return 'failure recorded (attempt ' + (inv.attempt_count || 1) + ')';
}

async function onSubscriptionChanged(sub, deleted) {
  const rec = await subRecord(sub.id, sub.metadata || {});
  if (!rec) return 'unknown subscription';
  const autopay = !deleted && !sub.cancel_at_period_end &&
    ['active', 'trialing', 'past_due'].includes(sub.status);
  if (rec.ref && !rec.pending) {
    await rec.ref.set({ status: deleted ? 'canceled' : sub.status, cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      currentPeriodEnd: subPeriodEnd(sub) }, { merge: true });
  }
  const stu = db.collection('students').doc(rec.uid);
  const snap = await stu.get();
  if (!snap.exists) return 'no student doc (account deleted?)';   // never create a stub doc
  const cur = snap.data();
  // Only touch the member's autopay flag if this is still their subscription.
  if (cur.stripeSubscriptionId && cur.stripeSubscriptionId !== sub.id) return 'stale subscription';
  if (cur.subscriptionAutopay !== autopay) {
    await stu.set({ subscriptionAutopay: autopay }, { merge: true });
    if (!autopay) {
      const until = cur.paidThroughMillis ? new Date(cur.paidThroughMillis).toISOString().slice(0, 10) : 'your paid date';
      await notify(rec.uid, 'autopay_stopped',
        'Auto-renewal for your ' + rec.planName + ' subscription is off. Your access runs until ' + until + '.',
        'checkout.html?plan=' + encodeURIComponent(rec.planId));
    }
  }
  return 'autopay ' + autopay + ' (' + (deleted ? 'deleted' : sub.status) + ')';
}

async function handleEvent(event) {
  const obj = event.data && event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return onCheckoutCompleted(obj);
    case 'invoice.paid':
      return onInvoicePaid(obj);
    case 'invoice.payment_failed':
      return onInvoiceFailed(obj);
    case 'customer.subscription.updated':
      return onSubscriptionChanged(obj, false);
    case 'customer.subscription.deleted':
      return onSubscriptionChanged(obj, true);
    default:
      return 'ignored: ' + event.type;
  }
}

exports.stripeWebhook = functions
  .runWith({ maxInstances: 30, timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) { res.status(500).send('webhook secret not configured'); return; }
    if (!verifySignature(req.rawBody, req.headers['stripe-signature'], secret)) {
      console.warn('stripeWebhook: bad signature');
      res.status(400).send('bad signature');
      return;
    }
    let event;
    try { event = JSON.parse(req.rawBody.toString('utf8')); } catch (e) { res.status(400).send('bad json'); return; }
    // Test-mode events must never touch a live deployment and vice versa.
    const liveKey = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '');
    if (event.livemode !== liveKey) { res.status(200).send('mode mismatch, ignored'); return; }

    // Event-level idempotency: a processed event id is acknowledged, not re-run.
    const evRef = db.collection('stripeEvents').doc(event.id);
    const seen = await evRef.get();
    if (seen.exists && seen.data().done) { res.status(200).send('duplicate'); return; }
    try {
      const result = await handleEvent(event);
      await evRef.set({ type: event.type, done: true, result: String(result).slice(0, 200),
        at: admin.firestore.FieldValue.serverTimestamp() });
      console.log('stripeWebhook', event.type, event.id, result);
      res.status(200).send('ok');
    } catch (err) {
      console.error('stripeWebhook failed', event.type, event.id, err.message);
      res.status(500).send('error');   // Stripe retries on 5xx
    }
  });

exports.stripePortal = functions
  .runWith({ maxInstances: 10, timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    // Read from the functions-only record, never from anything a client wrote.
    const snap = await db.collection('stripeCustomers').doc(uid).get();
    const customerId = snap.exists ? snap.data().customerId : null;
    if (!customerId) throw new functions.https.HttpsError('not-found', 'No card subscription on this account.');
    const session = await stripe('POST', 'billing_portal/sessions', {
      customer: customerId,
      return_url: siteOrigin() + '/settings.html',
      configuration: process.env.STRIPE_PORTAL_CONFIG || undefined
    });
    return { url: session.url };
  });

exports.stripeStatus = functions
  .runWith({ maxInstances: 5, timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const adminDoc = await db.collection('admins').doc(uid).get();
    if (!adminDoc.exists) throw new functions.https.HttpsError('permission-denied', 'Admins only.');
    const key = process.env.STRIPE_SECRET_KEY || '';
    const out = {
      configured: !!key,
      mode: /_live_/.test(key) ? 'live' : (/_test_/.test(key) ? 'test' : null),
      restrictedKey: /^rk_/.test(key),
      webhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
      portalConfigSet: !!process.env.STRIPE_PORTAL_CONFIG,
      reachable: false
    };
    if (key) {
      try { await stripe('GET', 'prices', { limit: 1 }); out.reachable = true; }
      catch (e) { out.error = e.stripeStatus === 401 ? 'key rejected' : 'unreachable'; }
    }
    return out;
  });

// Not a function (the loader ignores it): for the offline tests.
exports.__stripeInternals = { formEncode, verifySignature, handleEvent, baseUsdFor, STRIPE_VERSION };
