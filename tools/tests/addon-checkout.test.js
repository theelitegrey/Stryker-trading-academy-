// Live Futures Data $5 add-on: server-side purchase flow against the REAL functions-src/stripe.js and razorpaySubs.js,
// with an in-memory Firestore and mocked Stripe / Razorpay HTTP. No network, no keys, no emulator needed.
//   node tools/tests/addon-checkout.test.js
// Proves: stripeCreateCheckout builds a $5 monthly subscription session (no trial / coupon, one at a time),
// the SIGNED webhook (checkout.session.completed, invoice.paid renew, invoice.payment_failed, subscription
// updated/deleted) writes students.liveData and never touches plan / paidThroughMillis, bad signatures are refused,
// duplicate events do nothing; Razorpay: subscribe, verify (signed), renewal charge, cancel, halted.
// NOT proven here: real Stripe/Razorpay hosted pages, real cards, real webhook delivery from the gateways.
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
    set: (ref, d, o) => ref.set(d, o)
  })
};
const admin = { apps: [1], initializeApp() {}, firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => TS, increment: (n) => n, arrayUnion: (...a) => a, delete: () => null }, Timestamp: { now: () => Date.now(), fromMillis: (m) => m } }) };
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

// ---------- mocked gateway HTTP ----------
const TEST_KEY = 'sk_test_' + 'x'.repeat(12);   // fake, never a real key
const WH_SECRET = 'whsec_' + crypto.randomBytes(8).toString('hex');
process.env.STRIPE_SECRET_KEY = TEST_KEY;
process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
const RZP_ID = 'rzp_test_fake', RZP_SECRET = crypto.randomBytes(8).toString('hex'), RZP_WH = crypto.randomBytes(8).toString('hex');
process.env.RAZORPAY_KEY_ID = RZP_ID; process.env.RAZORPAY_KEY_SECRET = RZP_SECRET; process.env.RAZORPAY_WEBHOOK_SECRET = RZP_WH;

const calls = [];
let periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const body = init.body ? String(init.body) : '';
  calls.push({ method: init.method || 'GET', url, body });
  const json = (o, st = 200) => ({ ok: st < 400, status: st, json: async () => o });
  if (url.startsWith('https://api.stripe.com/v1/')) {
    assert.ok(/^Bearer sk_test_/.test(init.headers.Authorization), 'test key only');
    const p = url.slice('https://api.stripe.com/v1/'.length).split('?')[0];
    if (p === 'products') return json({ id: 'prod_t1' });
    if (p === 'prices') return json({ id: 'price_t1' });
    if (p === 'customers') return json({ id: 'cus_t1' });
    if (p === 'checkout/sessions') return json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    if (p.startsWith('subscriptions/')) return json({ id: p.split('/')[1], status: 'active', cancel_at_period_end: false, current_period_end: periodEnd, latest_invoice: 'in_1', items: { data: [] } });
  }
  if (url.startsWith('https://api.razorpay.com/v1/')) {
    const p = url.slice('https://api.razorpay.com/v1/'.length);
    if (p === 'plans') return json({ id: 'plan_rz1' });
    if (p === 'subscriptions') return json({ id: 'sub_rz1' });
    if (/^subscriptions\/.+\/cancel$/.test(p)) return json({ id: 'sub_rz1', status: 'active' });
  }
  throw new Error('unexpected fetch ' + url);
};

const S = require(path.join(__dirname, '../../functions-src/stripe.js'));
const Z = require(path.join(__dirname, '../../functions-src/razorpaySubs.js'));

const get = (k) => clone(store.get(k));
const UID = 'uid-buyer';
const ctx = { auth: { uid: UID, token: { email: 'stryker-qa-buyer@example.com', name: 'QA Buyer' } } };
const results = [];
const ok = (name, cond, extra) => { assert.ok(cond, name + (extra ? ' :: ' + JSON.stringify(extra) : '')); results.push('PASS ' + name); };

function signedReq(event, secret = WH_SECRET, t = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.from(JSON.stringify(event));
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + raw.toString('utf8')).digest('hex');
  return { rawBody: raw, headers: { 'stripe-signature': 't=' + t + ',v1=' + sig } };
}
async function send(handler, req) {
  const res = { code: 0, body: '', status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  await handler(req, res); return res;
}
let evn = 0;
const ev = (type, object) => ({ id: 'evt_' + (++evn), type, livemode: false, data: { object } });

(async () => {
  // plan docs + member (Free member, also has an old Pro doc elsewhere is not needed)
  store.set('plans/LiveData', { name: 'Live Futures Data', price: 5, period: 'month', interval: 'month', rank: 0, addon: true, hidden: true });
  store.set('plans/pro', { name: 'Pro', price: 19, period: 'month', rank: 1 });
  store.set('students/' + UID, { name: 'QA Buyer', plan: 'Starter', planId: 'free' });
  store.set('settings/commerce', { stripeCheckout: true, usdInr: 88 });

  // ---------- STRIPE ----------
  const r1 = await S.stripeCreateCheckout({ planId: 'LiveData' }, ctx);
  ok('stripe: checkout returns hosted url', /^https:\/\/checkout\.stripe\.com\//.test(r1.url));
  ok('stripe: $5.00 monthly, no trial', r1.amountCents === 500 && r1.renewCents === 500 && r1.interval === 'month' && r1.trial === false, r1);
  const sessCall = calls.find((c) => c.url.endsWith('/checkout/sessions'));
  ok('stripe: session is a subscription with addon metadata', /mode=subscription/.test(sessCall.body) && /metadata%5Baddon%5D=1/.test(sessCall.body), sessCall.body.slice(0, 200));
  ok('stripe: price created for 500 cents usd monthly', calls.some((c) => c.url.endsWith('/prices') && /unit_amount=500/.test(c.body) && /recurring%5Binterval%5D=month/.test(c.body)));
  ok('stripe: session record has addon:true', get('stripeSessions/cs_test_1').addon === true);
  for (const [label, d] of [['trial', { planId: 'LiveData', trial: true }], ['coupon', { planId: 'LiveData', couponCode: 'SAVE' }]]) {
    let err = null; try { await S.stripeCreateCheckout(d, ctx); } catch (e) { err = e; }
    ok('stripe: add-on refuses ' + label, err && err.code === 'failed-precondition', err && err.message);
  }
  let notQa = null; try { await S.stripeCreateCheckout({ planId: 'LiveData' }, { auth: { uid: 'other', token: { email: 'real@person.com' } } }); } catch (e) { notQa = e; }
  ok('stripe: test-key mode blocks non-QA, non-admin members', notQa && /not open yet/.test(notQa.message));

  // webhook security
  const sess = { id: 'cs_test_1', mode: 'subscription', payment_status: 'paid', client_reference_id: UID, subscription: 'sub_t1', amount_total: 500, customer_details: { email: 'stryker-qa-buyer@example.com', name: 'QA Buyer' } };
  let bad = await send(S.stripeWebhook, signedReq(ev('checkout.session.completed', sess), 'whsec_wrong'));
  ok('webhook: wrong signature -> 400, nothing written', bad.code === 400 && !get('students/' + UID).liveData);
  const stale = await send(S.stripeWebhook, signedReq(ev('checkout.session.completed', sess), WH_SECRET, Math.floor(Date.now() / 1000) - 3600));
  ok('webhook: stale timestamp -> 400', stale.code === 400);
  const liveEv = Object.assign(ev('checkout.session.completed', sess), { livemode: true });
  const lm = await send(S.stripeWebhook, signedReq(liveEv));
  ok('webhook: live-mode event on a test key ignored', lm.code === 200 && /mismatch/.test(lm.body) && !get('students/' + UID).liveData);

  // PAY
  const payEv = ev('checkout.session.completed', sess);
  let res = await send(S.stripeWebhook, signedReq(payEv));
  let st = get('students/' + UID);
  ok('PAY: webhook 200', res.code === 200, res);
  ok('PAY: students.liveData written (active, source stripe, autopay, paidThrough = period end)', st.liveData && st.liveData.active === true && st.liveData.source === 'stripe' && st.liveData.autopay === true && st.liveData.paidThroughMillis === periodEnd * 1000 && st.liveData.stripeSubscriptionId === 'sub_t1', st.liveData);
  ok('PAY: plan / paidThroughMillis / status NOT touched', st.plan === 'Starter' && st.planId === 'free' && st.paidThroughMillis === undefined && st.subscriptionStatus === undefined, st);
  ok('PAY: order recorded as addon, $5 usd', [...store.entries()].some(([k, v]) => k.startsWith('orders/') && v.kind === 'addon' && v.amountUsd === 5 && v.studentUid === UID));
  ok('PAY: member notified', [...store.entries()].some(([k, v]) => k.startsWith('notifications/') && v.type === 'livedata_on'));
  ok('PAY: stripeSubs record flagged addon', get('stripeSubs/sub_t1').addon === true);
  const dup = await send(S.stripeWebhook, signedReq(payEv));
  ok('PAY: same event id twice -> duplicate, no double order', dup.body === 'duplicate' && [...store.keys()].filter((k) => k.startsWith('orders/')).length === 1);
  let dupBuy = null; try { await S.stripeCreateCheckout({ planId: 'LiveData' }, ctx); } catch (e) { dupBuy = e; }
  ok('PAY: second purchase while active refused (no double billing)', dupBuy && dupBuy.code === 'already-exists');

  // first invoice.paid arrives too (must not duplicate)
  const inv1 = { id: 'in_1', subscription: 'sub_t1', billing_reason: 'subscription_create', amount_paid: 500, currency: 'usd', customer_email: 'x@y.z', lines: { data: [{ period: { end: periodEnd } }] } };
  res = await send(S.stripeWebhook, signedReq(ev('invoice.paid', inv1)));
  ok('PAY: first invoice.paid is idempotent (no second order)', res.code === 200 && [...store.keys()].filter((k) => k.startsWith('orders/')).length === 1);

  // RENEW
  const oldEnd = periodEnd; periodEnd += 30 * 86400;
  const inv2 = { id: 'in_2', subscription: 'sub_t1', billing_reason: 'subscription_cycle', amount_paid: 500, currency: 'usd', customer_email: 'x@y.z', lines: { data: [{ period: { end: periodEnd } }] } };
  res = await send(S.stripeWebhook, signedReq(ev('invoice.paid', inv2)));
  st = get('students/' + UID);
  ok('RENEW: paidThroughMillis moved forward 30 days', res.code === 200 && st.liveData.paidThroughMillis === periodEnd * 1000 && periodEnd * 1000 > oldEnd * 1000, st.liveData);
  ok('RENEW: renewal order written once; plan still untouched', [...store.entries()].filter(([k, v]) => k.startsWith('orders/') && v.studentName === 'Auto-renewal').length === 1 && st.plan === 'Starter');
  const short = { id: 'in_2b', subscription: 'sub_t1', billing_reason: 'subscription_cycle', amount_paid: 100, currency: 'usd', lines: { data: [{ period: { end: periodEnd + 86400 * 30 } }] } };
  await send(S.stripeWebhook, signedReq(ev('invoice.paid', short)));
  ok('RENEW: underpaid invoice (less than $5) does not extend', get('students/' + UID).liveData.paidThroughMillis === periodEnd * 1000);

  // FAIL
  const before = get('students/' + UID).liveData.paidThroughMillis;
  res = await send(S.stripeWebhook, signedReq(ev('invoice.payment_failed', { id: 'in_3', subscription: 'sub_t1', attempt_count: 1, currency: 'usd' })));
  st = get('students/' + UID);
  ok('FAIL: no new access granted, paidThrough unchanged, still active until it runs out (+3 days grace in the gate)', res.code === 200 && st.liveData.paidThroughMillis === before && st.liveData.active === true);
  ok('FAIL: member told once; failure stamped on stripeSubs', [...store.values()].some((v) => v.type === 'payment_failed') && !!get('stripeSubs/sub_t1').lastFailedInvoice);

  // CANCEL (at period end), then DELETED
  res = await send(S.stripeWebhook, signedReq(ev('customer.subscription.updated', { id: 'sub_t1', status: 'active', cancel_at_period_end: true, current_period_end: periodEnd })));
  ok('CANCEL (at period end): autopay false, still active until paid date', get('students/' + UID).liveData.autopay === false && get('students/' + UID).liveData.active === true && get('students/' + UID).liveData.paidThroughMillis === before);
  res = await send(S.stripeWebhook, signedReq(ev('customer.subscription.deleted', { id: 'sub_t1', status: 'canceled', current_period_end: periodEnd })));
  ok('CANCEL (deleted): autopay false; access ends at paidThroughMillis + 3-day grace (server gate, rt-access.test)', get('students/' + UID).liveData.autopay === false && get('students/' + UID).plan === 'Starter');

  // ---------- RAZORPAY ----------
  const RUID = 'uid-rzp';
  store.set('students/' + RUID, { name: 'India Buyer', plan: 'Starter', planId: 'free' });
  const rctx = { auth: { uid: RUID, token: { email: 'in@example.com', name: 'India Buyer' } } };
  const sub = await Z.razorpaySubscribe({ planId: 'LiveData', currency: 'INR' }, rctx);
  ok('razorpay: subscribe returns subscription, INR monthly', sub.subscriptionId === 'sub_rz1' && sub.currency === 'INR' && sub.trial === false && sub.amountMinor === 5 * 88 * 100, sub);
  ok('razorpay: subscription record flagged addon', get('razorpaySubs/sub_rz1').addon === true);
  let rtrial = null; try { await Z.razorpaySubscribe({ planId: 'LiveData', currency: 'INR', trial: true }, rctx); } catch (e) { rtrial = e; }
  ok('razorpay: add-on refuses a trial', rtrial && rtrial.code === 'failed-precondition');
  let badSig = null; try { await Z.razorpaySubsVerify({ subscriptionId: 'sub_rz1', paymentId: 'pay_1', signature: 'deadbeef' }, rctx); } catch (e) { badSig = e; }
  ok('razorpay: bad payment signature refused, nothing granted', badSig && /verification failed/i.test(badSig.message) && !get('students/' + RUID).liveData);
  const sig = crypto.createHmac('sha256', RZP_SECRET).update('pay_1|sub_rz1').digest('hex');
  const v = await Z.razorpaySubsVerify({ subscriptionId: 'sub_rz1', paymentId: 'pay_1', signature: sig }, rctx);
  st = get('students/' + RUID);
  ok('razorpay PAY: verify -> students.liveData written (source razorpay, autopay, ~30 days)', v.addon === true && st.liveData.active === true && st.liveData.source === 'razorpay' && st.liveData.autopay === true && st.liveData.paidThroughMillis > Date.now() + 27 * 86400e3, st.liveData);
  ok('razorpay PAY: plan untouched', st.plan === 'Starter' && st.paidThroughMillis === undefined);
  let again = null; try { await Z.razorpaySubsVerify({ subscriptionId: 'sub_rz1', paymentId: 'pay_1', signature: sig }, rctx); } catch (e) { again = e; }
  ok('razorpay PAY: verifying twice refused', again && again.code === 'already-exists');

  const rzEvent = (event, pay, status) => { const raw = Buffer.from(JSON.stringify({ event, payload: { subscription: { entity: { id: 'sub_rz1', status: status || 'active' } }, payment: pay ? { entity: pay } : undefined } })); return { rawBody: raw, body: JSON.parse(raw.toString()), headers: { 'x-razorpay-signature': crypto.createHmac('sha256', RZP_WH).update(raw).digest('hex') } }; };
  const badWh = rzEvent('subscription.charged', { id: 'pay_2', amount: 44000, status: 'captured' }); badWh.headers['x-razorpay-signature'] = 'nope';
  ok('razorpay webhook: bad signature -> 400', (await send(Z.razorpayWebhook, badWh)).code === 400);
  const p1 = get('students/' + RUID).liveData.paidThroughMillis;
  await send(Z.razorpayWebhook, rzEvent('subscription.charged', { id: 'pay_1', amount: 44000, status: 'captured' }));
  ok('razorpay: first charge event (already covered by verify) does not extend twice', get('students/' + RUID).liveData.paidThroughMillis === p1);
  await send(Z.razorpayWebhook, rzEvent('subscription.charged', { id: 'pay_2', amount: 44000, status: 'captured' }));
  const p2 = get('students/' + RUID).liveData.paidThroughMillis;
  ok('razorpay RENEW: captured renewal extends paidThroughMillis', p2 > p1, { p1, p2 });
  const dupR = await send(Z.razorpayWebhook, rzEvent('subscription.charged', { id: 'pay_2', amount: 44000, status: 'captured' }));
  ok('razorpay RENEW: same payment twice -> duplicate', dupR.body === 'duplicate' && get('students/' + RUID).liveData.paidThroughMillis === p2);
  await send(Z.razorpayWebhook, rzEvent('subscription.charged', { id: 'pay_3', amount: 44000, status: 'failed' }));
  ok('razorpay FAIL: non-captured charge does not extend', get('students/' + RUID).liveData.paidThroughMillis === p2);
  await send(Z.razorpayWebhook, rzEvent('subscription.charged', { id: 'pay_4', amount: 100, status: 'captured' }));
  ok('razorpay FAIL: underpaid charge refused', get('students/' + RUID).liveData.paidThroughMillis === p2);
  const c = await Z.razorpaySubsCancel({ addon: true }, rctx);
  st = get('students/' + RUID);
  ok('razorpay CANCEL: cancel at cycle end, autopay false, access kept to paid date', c.ok && st.liveData.autopay === false && st.liveData.active === true && st.liveData.paidThroughMillis === p2 && calls.some((x) => /subscriptions\/sub_rz1\/cancel/.test(x.url) && /cancel_at_cycle_end":1/.test(x.body)));
  await send(Z.razorpayWebhook, rzEvent('subscription.halted', null, 'halted'));
  ok('razorpay HALTED: autopay false, plan untouched', get('students/' + RUID).liveData.autopay === false && get('students/' + RUID).plan === 'Starter');

  // keys never leaked
  ok('no fake key/secret printed in recorded request bodies', !calls.some((x) => x.body.includes(TEST_KEY) || x.body.includes(RZP_SECRET)));

  console.log(results.join('\n')); console.log('addon-checkout: ' + results.length + ' checks, all pass');
})().catch((e) => { console.log(results.join('\n')); console.error('FAIL', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e); process.exit(1); });
