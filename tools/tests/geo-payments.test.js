// Sanctions geo-block, payments side (Owner order 09 Nov 2026): the REAL functions-src/stripe.js, freeCheckout.js,
// razorpay.js and razorpaySubs.js against an in-memory Firestore and a mocked Stripe API. No network, no keys.
//   node tools/tests/geo-payments.test.js
// Proves: every purchase callable refuses a blocked or unconfirmed residence (and a blocked client billing country
// on free checkout); Stripe sessions require the billing address; the SIGNED webhook, for a blocked card or billing
// country, locks the account, disables the login, cancels the subscription and refunds the charge exactly once,
// with no order and no grant, in every event order and on retries; an allowed payer is granted as before.
// NOT proven here: real Stripe delivery, real card countries, the deployed functions.
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

// ---------- in-memory Firestore ----------
const store = new Map();   // 'col/id' -> data
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const TS = { __ts: true };
function merge(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v === TS) dst[k] = Date.now();
    else if (v && typeof v === 'object' && !Array.isArray(v)) { dst[k] = (dst[k] && typeof dst[k] === 'object') ? dst[k] : {}; merge(dst[k], v); }
    else dst[k] = v;
  }
  return dst;
}
let autoId = 0;
const alreadyExists = () => Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
function docRef(col, id) {
  const key = col + '/' + id;
  return {
    id, path: key,
    get: async () => ({ exists: store.has(key), id, data: () => clone(store.get(key)), ref: docRef(col, id) }),
    set: async (d, o) => { if (o && o.merge) store.set(key, merge(clone(store.get(key)) || {}, d)); else store.set(key, merge({}, d)); },
    update: async (d) => { store.set(key, merge(clone(store.get(key)) || {}, d)); },
    create: async (d) => { if (store.has(key)) throw alreadyExists(); store.set(key, merge({}, d)); },
    delete: async () => { store.delete(key); }
  };
}
const colRef = (col) => ({
  doc: (id) => docRef(col, id || 'auto' + (++autoId)),
  add: async (d) => { const id = 'auto' + (++autoId); store.set(col + '/' + id, merge({}, d)); return docRef(col, id); },
  where: () => ({ get: async () => ({ empty: true, docs: [], forEach() {} }), limit() { return this; } }),
  get: async () => ({ empty: true, docs: [], forEach() {} })
});
const db = {
  collection: colRef,
  runTransaction: async (fn) => fn({
    get: (ref) => ref.get(),
    update: (ref, d) => ref.update(d),
    create: (ref, d) => ref.create(d),
    set: (ref, d, o) => ref.set(d, o)
  })
};
const authCalls = [];
const admin = { apps: [1], initializeApp() {}, auth: () => ({ updateUser: async (uid, p) => { authCalls.push([uid, p]); }, getUser: async () => ({ email: 'qa@example.com', displayName: 'QA' }) }), firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => TS, increment: (n) => n, arrayUnion: (...a) => a, delete: () => null }, Timestamp: { now: () => Date.now(), fromMillis: (m) => m } }) };
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const chain = () => new Proxy(function () {}, {
  get: (t, p) => (p === 'onCall' || p === 'onRequest' || p === 'onRun' ? (h) => h : p === 'HttpsError' ? HttpsError : p === 'https' ? Object.assign(chain(), { HttpsError }) : chain()),
  apply: () => chain()
});
const functionsStub = new Proxy({}, { get: (t, p) => (p === 'https' ? { HttpsError, onCall: (h) => h, onRequest: (h) => h } : p === 'config' ? () => ({}) : chain()) });
const origLoad = Module._load;
Module._load = function (req, parent, ...r) {
  if (req === 'firebase-functions') return functionsStub;
  if (req === 'firebase-admin') return admin;
  if (req === 'firebase-functions/v2' || req.startsWith('firebase-functions/') || req.startsWith('firebase-admin/')) return functionsStub;
  return origLoad.call(this, req, parent, ...r);
};

const TEST_KEY = 'sk_test_' + 'x'.repeat(12);   // fake, never a real key
const WH_SECRET = 'whsec_' + crypto.randomBytes(8).toString('hex');
process.env.STRIPE_SECRET_KEY = TEST_KEY;
process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
process.env.RAZORPAY_KEY_ID = 'rzp_test_fake'; process.env.RAZORPAY_KEY_SECRET = crypto.randomBytes(8).toString('hex');

// The "world" Stripe answers from: per subscription, the card + billing country; per charge, refund state.
const W = { subs: {}, charges: {}, invoices: {} };
const calls = [];
let periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
let failRefundOnce = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const body = init.body ? String(init.body) : '';
  const method = init.method || 'GET';
  calls.push({ method, url, body });
  const json = (o, st = 200) => ({ ok: st < 400, status: st, json: async () => o });
  assert.ok(url.startsWith('https://api.stripe.com/v1/'), 'unexpected fetch ' + url);
  assert.ok(/^Bearer sk_test_/.test(init.headers.Authorization), 'test key only');
  const p = url.slice('https://api.stripe.com/v1/'.length).split('?')[0];
  if (p === 'products') return json({ id: 'prod_t1' });
  if (p === 'prices') return json({ id: 'price_t1' });
  if (p === 'customers') return json({ id: 'cus_t1' });
  if (p === 'checkout/sessions') return json({ id: 'cs_test_' + calls.length, url: 'https://checkout.stripe.com/c/pay/x' });
  if (p === 'refunds') {
    if (failRefundOnce) { failRefundOnce = false; return json({ error: { type: 'api_error', message: 'boom' } }, 500); }
    const ch = W.charges[decodeURIComponent((body.match(/charge=([^&]+)/) || [])[1] || '')];
    if (!ch) return json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404);
    if (ch.refunded) return json({ error: { type: 'invalid_request_error', code: 'charge_already_refunded' } }, 400);
    ch.refunded = true; ch.amount_refunded = ch.amount; return json({ id: 're_' + ch.id });
  }
  if (p.startsWith('charges/')) { const ch = W.charges[p.split('/')[1]]; return ch ? json(ch) : json({}, 404); }
  if (p.startsWith('invoices/')) {
    const inv = W.invoices[p.split('/')[1]];
    return json(Object.assign({}, inv, { charge: inv && inv.charge ? W.charges[inv.charge] : null }));
  }
  if (p.startsWith('subscriptions/')) {
    const id = p.split('/')[1]; const w = W.subs[id] || {};
    if (method === 'DELETE') { if (w.deleted) return json({ error: { code: 'resource_missing' } }, 404); w.deleted = true; return json({ id, status: 'canceled' }); }
    const pm = { id: 'pm_' + id, card: { country: w.card || 'US', fingerprint: 'fp_' + id }, billing_details: { address: { country: w.billing || 'US', state: w.state || '' } } };
    return json({ id, status: w.trial ? 'trialing' : 'active', cancel_at_period_end: false, current_period_end: periodEnd, trial_end: periodEnd,
      latest_invoice: w.charge ? { id: 'in_' + id, charge: W.charges[w.charge] } : 'in_' + id, default_payment_method: pm, items: { data: [] },
      customer: { id: 'cus_t1', address: null, invoice_settings: {} }, metadata: w.meta || {} });
  }
  throw new Error('unexpected stripe path ' + method + ' ' + p);
};

const S = require(path.join(__dirname, '../../functions-src/stripe.js'));
const F = require(path.join(__dirname, '../../functions-src/freeCheckout.js'));
const RZ = require(path.join(__dirname, '../../functions-src/razorpay.js'));
const RZS = require(path.join(__dirname, '../../functions-src/razorpaySubs.js'));
const get = (k) => clone(store.get(k));
const results = [];
const ok = (name, cond, extra) => { assert.ok(cond, name + (extra ? ' :: ' + JSON.stringify(extra) : '')); results.push('PASS ' + name); console.log('PASS ' + name); };
const REGION = /TradeZoro isn't available in your region/;
async function refusal(fn) { try { await fn(); return null; } catch (e) { return e; } }

function signedReq(event, secret = WH_SECRET, t = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.from(JSON.stringify(event));
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + raw.toString('utf8')).digest('hex');
  return { rawBody: raw, headers: { 'stripe-signature': 't=' + t + ',v1=' + sig } };
}
async function send(event) {
  const res = { code: 0, body: '', status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  await S.stripeWebhook(signedReq(event), res); return res;
}
let evn = 0;
const ev = (type, object) => ({ id: 'evt_' + (++evn), type, livemode: false, data: { object } });
const ctxOf = (uid) => ({ auth: { uid, token: { email: 'stryker-qa-' + uid + '@example.com', name: 'QA' } } });
const refundsFor = (ch) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/refunds') && c.body.includes('charge=' + ch)).length;
const deletesFor = (sub) => calls.filter((c) => c.method === 'DELETE' && c.url.includes('/subscriptions/' + sub)).length;
const ordersFor = (uid) => [...store.entries()].filter(([k, v]) => k.startsWith('orders/') && v.studentUid === uid).length;

// A member who has a session created for them (the record stripeCreateCheckout would have written).
function member(uid, extra) {
  store.set('students/' + uid, Object.assign({ plan: 'Starter', residenceCountry: 'US', sanctionsAttest: true }, extra || {}));
}
function session(uid, sub, opts) {
  const o = opts || {};
  const cs = 'cs_' + uid;
  store.set('stripeSessions/' + cs, { uid, planId: 'pro', planName: 'Pro', period: 'month', baseUsd: 19, baseCents: 1900, firstCents: 1900,
    priceId: 'price_t1', customerId: 'cus_t1', trial: !!o.trial, addon: false, status: 'created' });
  W.subs[sub] = { card: o.card, billing: o.billing, state: o.state, trial: o.trial, charge: o.trial ? null : 'ch_' + sub, meta: { uid, sitePlanId: 'pro' } };
  if (!o.trial) W.charges['ch_' + sub] = { id: 'ch_' + sub, amount: 1900, amount_refunded: 0, refunded: false,
    payment_method_details: { card: { country: o.card || 'US' } }, billing_details: { address: { country: o.billing || 'US', state: o.state || '' } } };
  W.invoices['in_' + sub] = { id: 'in_' + sub, charge: o.trial ? null : 'ch_' + sub };
  return { id: cs, mode: 'subscription', payment_status: o.trial ? 'no_payment_required' : 'paid', client_reference_id: uid, subscription: sub,
    amount_total: o.trial ? 0 : 1900, customer_details: { email: 'x@example.com', name: 'X', address: { country: o.billing || 'US', state: o.state || '' } }, metadata: { uid } };
}
const invoice = (uid, sub, reason) => ({ id: 'in_' + sub + (reason === 'subscription_cycle' ? '_r' : ''), subscription: sub, currency: 'usd', amount_paid: 1900,
  billing_reason: reason || 'subscription_create', customer_address: null, subscription_details: { metadata: { uid, sitePlanId: 'pro' } },
  lines: { data: [{ period: { end: periodEnd } }] } });

(async () => {
  store.set('plans/pro', { name: 'Pro', price: 19, period: 'month', rank: 1 });
  store.set('plans/free', { name: 'Starter', price: 0, period: 'month', rank: 0 });
  store.set('settings/commerce', { stripeCheckout: true, usdInr: 88 });
  store.set('coupons/FREEPRO', { type: 'free', appliesToPlan: 'pro', active: true, accessMonths: 1, redemptionCount: 0 });

  // ---------- creation gates ----------
  for (const [label, doc] of [['blocked residence IR', { residenceCountry: 'IR', sanctionsAttest: true }], ['blocked region UA-43', { residenceCountry: 'UA-43' }],
    ['server lock', { residenceCountry: 'US', sanctionsAttest: true, sanctionsLocked: true }]]) {
    const uid = 'u-' + label.replace(/\W/g, '');
    store.set('students/' + uid, Object.assign({ plan: 'Starter' }, doc));
    const e1 = await refusal(() => S.stripeCreateCheckout({ planId: 'pro' }, ctxOf(uid)));
    ok('stripe checkout refused: ' + label, e1 && e1.code === 'failed-precondition' && REGION.test(e1.message), e1 && e1.message);
    const e2 = await refusal(() => F.redeemFreeCheckout({ planId: 'pro', couponCode: 'FREEPRO' }, ctxOf(uid)));
    ok('coupon (free checkout) refused: ' + label, e2 && REGION.test(e2.message), e2 && e2.message);
    const e3 = await refusal(() => F.redeemFreeCheckout({ planId: 'free' }, ctxOf(uid)));
    ok('free plan refused: ' + label, e3 && REGION.test(e3.message), e3 && e3.message);
    const e4 = await refusal(() => RZ.razorpayCreateOrder({ planId: 'pro', currency: 'INR' }, ctxOf(uid)));
    ok('razorpay order refused: ' + label, e4 && REGION.test(e4.message), e4 && e4.message);
    const e5 = await refusal(() => RZS.razorpaySubscribe({ planId: 'pro', currency: 'INR' }, ctxOf(uid)));
    ok('razorpay subscription refused: ' + label, e5 && REGION.test(e5.message), e5 && e5.message);
    ok('no grant for ' + label, get('students/' + uid).plan === 'Starter' && !get('couponRedemptions/FREEPRO__' + uid));
  }
  store.set('students/u-none', { plan: 'Starter' });
  const eN = await refusal(() => S.stripeCreateCheckout({ planId: 'pro' }, ctxOf('u-none')));
  ok('stripe checkout refused when residence not confirmed (residence_required)', eN && eN.code === 'failed-precondition' && /confirm your country of residence/.test(eN.message), eN && eN.message);
  const eN2 = await refusal(() => F.redeemFreeCheckout({ planId: 'pro', couponCode: 'FREEPRO' }, ctxOf('u-none')));
  ok('coupon refused when residence not confirmed', eN2 && /confirm your country of residence/.test(eN2.message));
  member('u-bill');
  const eB = await refusal(() => F.redeemFreeCheckout({ planId: 'pro', couponCode: 'FREEPRO', billing: { country: 'RU' } }, ctxOf('u-bill')));
  ok('free checkout refused for a blocked client billing country', eB && REGION.test(eB.message));
  member('u-ok', { residenceCountry: 'IN' });
  const cOk = await S.stripeCreateCheckout({ planId: 'pro' }, ctxOf('u-ok'));
  const sessCall = calls.filter((c) => c.url.endsWith('/checkout/sessions')).pop();
  ok('allowed member (IN) gets a session; billing address required', cOk.url && /billing_address_collection=required/.test(sessCall.body), sessCall.body.slice(0, 200));
  const fOk = await F.redeemFreeCheckout({ planId: 'pro', couponCode: 'FREEPRO', billing: { country: 'GB' } }, ctxOf('u-ok'));
  ok('allowed member redeems a free coupon', fOk.ok === true && get('students/u-ok').plan === 'Pro');
  member('u-ua', { residenceCountry: 'UA' });
  ok('UA (Kyiv) member gets a session', (await S.stripeCreateCheckout({ planId: 'pro' }, ctxOf('u-ua'))).url);

  // ---------- webhook: blocked card country ----------
  member('w-ru');
  let r = await send(ev('checkout.session.completed', session('w-ru', 'sub_ru', { card: 'RU', billing: 'US' })));
  let st = get('students/w-ru');
  ok('RU card: webhook 200', r.code === 200, r);
  ok('RU card: account locked (reason card), autopay off', st.sanctionsLocked === true && st.sanctionsLockReason === 'card' && st.subscriptionAutopay === false, st);
  ok('RU card: no plan granted, no order', st.plan === 'Starter' && !st.paidThroughMillis && ordersFor('w-ru') === 0);
  ok('RU card: subscription cancelled once, charge refunded once', deletesFor('sub_ru') === 1 && refundsFor('ch_sub_ru') === 1 && W.charges.ch_sub_ru.refunded);
  ok('RU card: login disabled', authCalls.some(([u, p]) => u === 'w-ru' && p.disabled === true));
  const log = get('sanctionsLog/sub_ru');
  ok('RU card: sanctionsLog written (codes only)', log && log.reason === 'card' && log.country === 'RU' && log.refund === 'refunded', log);
  ok('RU card: refund reason not "fraudulent"', calls.find((c) => c.url.endsWith('/refunds')).body.includes('reason=requested_by_customer'));
  // the invoice.paid for the same first invoice arrives afterwards: no second refund, no grant
  r = await send(ev('invoice.paid', invoice('w-ru', 'sub_ru')));
  ok('RU card: later invoice.paid -> no second refund, no grant', r.code === 200 && refundsFor('ch_sub_ru') === 1 && !get('students/w-ru').paidThroughMillis);
  // Stripe then sends subscription.deleted: nothing changes
  r = await send(ev('customer.subscription.deleted', { id: 'sub_ru', status: 'canceled', metadata: { uid: 'w-ru', sitePlanId: 'pro' } }));
  ok('RU card: subscription.deleted keeps the lock, writes no order', get('students/w-ru').sanctionsLocked === true && ordersFor('w-ru') === 0);

  // ---------- billing address in Crimea (UA), US card ----------
  member('w-cr');
  r = await send(ev('checkout.session.completed', session('w-cr', 'sub_cr', { card: 'US', billing: 'UA', state: 'Crimea' })));
  st = get('students/w-cr');
  ok('Crimea billing: locked (billing), refunded, cancelled, no grant', st.sanctionsLocked && st.sanctionsLockReason === 'billing' && refundsFor('ch_sub_cr') === 1 && deletesFor('sub_cr') === 1 && st.plan === 'Starter', st);

  // ---------- invoice.paid arrives BEFORE checkout.session.completed ----------
  member('w-by');
  const sBy = session('w-by', 'sub_by', { card: 'BY' });
  r = await send(ev('invoice.paid', invoice('w-by', 'sub_by')));
  ok('BY card, invoice first: locked + refunded, no grant', get('students/w-by').sanctionsLocked && refundsFor('ch_sub_by') === 1 && !get('students/w-by').paidThroughMillis);
  r = await send(ev('checkout.session.completed', sBy));
  ok('BY card, session second: still one refund, no grant, no order', refundsFor('ch_sub_by') === 1 && get('students/w-by').plan === 'Starter' && ordersFor('w-by') === 0);

  // ---------- refund fails once (500), Stripe retries the same event ----------
  member('w-sy');
  const evSy = ev('checkout.session.completed', session('w-sy', 'sub_sy', { card: 'SY' }));
  failRefundOnce = true;
  r = await send(evSy);
  ok('SY card: refund error -> 500 so Stripe retries; already locked', r.code === 500 && get('students/w-sy').sanctionsLocked === true);
  r = await send(evSy);
  ok('SY card: retry finishes the refund exactly once', r.code === 200 && W.charges.ch_sub_sy.refunded && get('geoRefunds/ch_sub_sy').status === 'refunded');
  r = await send(Object.assign({}, evSy, { id: 'evt_dup_sy' }));
  ok('SY card: a second delivery under a new id does not refund again', refundsFor('ch_sub_sy') === 2 /* the failed try + the one that worked */ && get('geoRefunds/ch_sub_sy').status === 'refunded');

  // ---------- trial started with a KP card: blocked at trial start (nothing to refund) ----------
  member('w-kp');
  r = await send(ev('checkout.session.completed', session('w-kp', 'sub_kp', { card: 'KP', trial: true })));
  st = get('students/w-kp');
  ok('KP card trial: locked, subscription cancelled, no trial granted', st.sanctionsLocked && deletesFor('sub_kp') === 1 && !st.trialUsedAt && st.plan === 'Starter', st);

  // ---------- renewal paid with a new IR card ----------
  member('w-ren');
  r = await send(ev('checkout.session.completed', session('w-ren', 'sub_ren', { card: 'US' })));
  const before = get('students/w-ren').paidThroughMillis;
  ok('US card: normal grant (Pro), order written, no refund', get('students/w-ren').plan === 'Pro' && before > Date.now() && ordersFor('w-ren') === 1 && refundsFor('ch_sub_ren') === 0);
  W.charges.ch_ren2 = { id: 'ch_ren2', amount: 1900, amount_refunded: 0, refunded: false, payment_method_details: { card: { country: 'IR' } }, billing_details: { address: { country: 'US' } } };
  W.invoices['in_sub_ren_r'] = { id: 'in_sub_ren_r', charge: 'ch_ren2' };
  periodEnd += 30 * 86400;
  r = await send(ev('invoice.paid', invoice('w-ren', 'sub_ren', 'subscription_cycle')));
  st = get('students/w-ren');
  ok('IR card renewal: cancelled + refunded, access NOT extended, no renewal order', st.sanctionsLocked && refundsFor('ch_ren2') === 1 && deletesFor('sub_ren') === 1 && st.paidThroughMillis === before && ordersFor('w-ren') === 1, st);

  // ---------- member who stored a blocked residence pays anyway (VPN + foreign card) ----------
  member('w-res', { residenceCountry: 'CU', sanctionsAttest: undefined });
  r = await send(ev('checkout.session.completed', session('w-res', 'sub_res', { card: 'US' })));
  ok('stored residence CU: refunded even with a US card', get('students/w-res').sanctionsLockReason === 'residence' && refundsFor('ch_sub_res') === 1);

  // ---------- allowed UA (Kyiv) payer ----------
  member('w-kyiv', { residenceCountry: 'UA' });
  r = await send(ev('checkout.session.completed', session('w-kyiv', 'sub_kyiv', { card: 'UA', billing: 'UA', state: 'Kyiv' })));
  ok('UA Kyiv payer: granted, no refund', get('students/w-kyiv').plan === 'Pro' && refundsFor('ch_sub_kyiv') === 0 && !get('students/w-kyiv').sanctionsLocked);

  ok('no fake key printed in request bodies', !calls.some((c) => c.body.includes(TEST_KEY)));
  console.log('geo-payments: ' + results.length + ' checks, all pass');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
