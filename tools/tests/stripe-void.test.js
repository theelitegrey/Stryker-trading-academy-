// Ended subscriptions stop retrying (Owner billing bug, 20 Nov 2026): the REAL functions-src/stripe.js webhook
// against an in-memory Firestore and a stubbed Stripe API. No network, no real key.
//   node tools/tests/stripe-void.test.js
// Proves: subscription.deleted voids the sub's OPEN invoice and never touches a paid one or another sub's;
// a void error (key lacks Invoices: Write) writes an adminTasks billing alert and the webhook still answers 200;
// a cancel while past_due ends the sub now and voids; a normal cancel-at-period-end on an active sub voids nothing;
// a failed-payment retry on an already cancelled sub is voided. No refund, no charge, no amount change is ever sent.
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const store = new Map();
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
function docRef(col, id) {
  const key = col + '/' + id;
  return {
    id, path: key,
    get: async () => ({ exists: store.has(key), id, data: () => clone(store.get(key)), ref: docRef(col, id) }),
    set: async (d, o) => { store.set(key, merge(o && o.merge ? (clone(store.get(key)) || {}) : {}, d)); },
    update: async (d) => { store.set(key, merge(clone(store.get(key)) || {}, d)); },
    create: async (d) => { if (store.has(key)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }); store.set(key, merge({}, d)); },
    delete: async () => { store.delete(key); }
  };
}
const db = {
  collection: (col) => ({
    doc: (id) => docRef(col, id || 'auto' + (++autoId)),
    add: async (d) => { const id = 'auto' + (++autoId); store.set(col + '/' + id, merge({}, d)); return docRef(col, id); }
  })
};
const admin = { apps: [1], initializeApp() {}, firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => TS } }) };
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const chain = () => new Proxy(function () {}, {
  get: (t, p) => (p === 'onCall' || p === 'onRequest' || p === 'onRun' ? (h) => h : p === 'HttpsError' ? HttpsError : chain()),
  apply: () => chain()
});
const functionsStub = new Proxy({}, { get: (t, p) => (p === 'https' ? { HttpsError, onCall: (h) => h, onRequest: (h) => h } : chain()) });
const origLoad = Module._load;
Module._load = function (req, parent, ...r) {
  if (req === 'firebase-functions' || req.startsWith('firebase-functions/')) return functionsStub;
  if (req === 'firebase-admin' || req.startsWith('firebase-admin/')) return admin;
  return origLoad.call(this, req, parent, ...r);
};

const TEST_KEY = 'sk_test_' + 'x'.repeat(12);   // fake, never a real key
const WH_SECRET = 'whsec_' + crypto.randomBytes(8).toString('hex');
process.env.STRIPE_SECRET_KEY = TEST_KEY;
process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;

// Stubbed Stripe: invoices + subscriptions it knows about.
const INV = {};   // id -> { id, status, subscription, amount_due }
const SUBS = {};  // id -> { deleted }
let voidFails = false;   // simulate a key without Invoices: Write
let cancelFails = false;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET'; const body = init.body ? String(init.body) : '';
  calls.push({ method, url, body });
  const json = (o, st = 200) => ({ ok: st < 400, status: st, json: async () => o });
  assert.ok(url.startsWith('https://api.stripe.com/v1/'), 'unexpected fetch ' + url);
  assert.ok(/^Bearer sk_test_/.test(init.headers.Authorization), 'test key only');
  const u = new URL(url); const p = u.pathname.replace('/v1/', '');
  if (method === 'GET' && p === 'invoices') {
    const sub = u.searchParams.get('subscription'); const status = u.searchParams.get('status');
    // Real Stripe filters server-side; return a paid one too so the code's own guard is exercised.
    return json({ data: Object.values(INV).filter((i) => i.subscription === sub && (!status || i.status === status || i.status === 'paid')).map(clone), has_more: false });
  }
  const m = p.match(/^invoices\/([^/]+)\/void$/);
  if (method === 'POST' && m) {
    if (voidFails) return json({ error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions' } }, 403);
    const inv = INV[m[1]];
    if (!inv || inv.status !== 'open') return json({ error: { type: 'invalid_request_error', message: 'not open' } }, 400);
    inv.status = 'void'; return json(clone(inv));
  }
  if (method === 'DELETE' && p.startsWith('subscriptions/')) {
    if (cancelFails) return json({ error: { type: 'invalid_request_error', message: 'permission' } }, 403);
    const id = p.split('/')[1]; SUBS[id] = { deleted: true }; return json({ id, status: 'canceled' });
  }
  throw new Error('unexpected stripe call ' + method + ' ' + p);
};

const S = require(path.join(__dirname, '../../functions-src/stripe.js'));
const get = (k) => clone(store.get(k));
let n = 0;
const ok = (name, cond, extra) => { assert.ok(cond, name + (extra ? ' :: ' + JSON.stringify(extra) : '')); n++; console.log('PASS ' + name); };
function signedReq(event) {
  const raw = Buffer.from(JSON.stringify(event)); const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WH_SECRET).update(t + '.' + raw.toString('utf8')).digest('hex');
  return { rawBody: raw, headers: { 'stripe-signature': 't=' + t + ',v1=' + sig } };
}
let evn = 0;
async function send(type, object) {
  const res = { code: 0, body: '', status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  const id = 'evt_' + (++evn);
  await S.stripeWebhook(signedReq({ id, type, livemode: false, data: { object } }), res);
  return Object.assign(res, { result: (get('stripeEvents/' + id) || {}).result });
}
const voidsOf = (id) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/invoices/' + id + '/void')).length;
const alerts = () => [...store.entries()].filter(([k]) => k.startsWith('adminTasks/billing_')).map(([k, v]) => Object.assign({ key: k }, v));
const member = (uid, sub, status) => {
  store.set('students/' + uid, { plan: 'Pro', stripeSubscriptionId: sub, subscriptionAutopay: true, paidThroughMillis: Date.now() + 86400e3 });
  store.set('stripeSubs/' + sub, { uid, planId: 'pro', planName: 'Pro', status: status || 'active' });
};

(async () => {
  // 1. deleted sub with 1 open renewal invoice + 1 paid invoice + another sub's open invoice
  member('u1', 'sub_1', 'past_due');
  INV.in_open = { id: 'in_open', status: 'open', subscription: 'sub_1', amount_due: 1900 };
  INV.in_paid = { id: 'in_paid', status: 'paid', subscription: 'sub_1', amount_due: 1900 };
  INV.in_other = { id: 'in_other', status: 'open', subscription: 'sub_x', amount_due: 1900 };
  let r = await send('customer.subscription.deleted', { id: 'sub_1', status: 'canceled', metadata: { uid: 'u1', sitePlanId: 'pro' } });
  ok('deleted sub: webhook 200', r.code === 200, r);
  ok('deleted sub: open invoice voided once', INV.in_open.status === 'void' && voidsOf('in_open') === 1, r.result);
  ok('deleted sub: paid invoice untouched', INV.in_paid.status === 'paid' && voidsOf('in_paid') === 0);
  ok('deleted sub: other subscription\'s invoice untouched', INV.in_other.status === 'open' && voidsOf('in_other') === 0);
  ok('deleted sub: autopay off as before', get('students/u1').subscriptionAutopay === false && /voided 1/.test(r.result), r.result);
  ok('deleted sub: no alert on success', alerts().length === 0, alerts());

  // 2. void error (key lacks Invoices: Write) -> alert row, 200, autopay still recorded
  member('u2', 'sub_2', 'past_due');
  INV.in_2 = { id: 'in_2', status: 'open', subscription: 'sub_2', amount_due: 1900 };
  voidFails = true;
  r = await send('customer.subscription.deleted', { id: 'sub_2', status: 'canceled', metadata: {} });
  voidFails = false;
  const a2 = alerts().find((a) => a.key === 'adminTasks/billing_void_in_2');
  ok('void error: webhook still 200 + event marked done', r.code === 200 && get('stripeEvents/evt_' + evn).done === true, r);
  ok('void error: admin alert row written with sub + invoice', a2 && a2.invoiceId === 'in_2' && a2.subscriptionId === 'sub_2' && a2.uid === 'u2' && /403/.test(a2.error) && /void it/.test(a2.text), a2);
  ok('void error: invoice still open (nothing else attempted)', INV.in_2.status === 'open');
  ok('void error: member state still updated', get('students/u2').subscriptionAutopay === false);

  // 3. cancel while past_due (portal sets cancel_at_period_end) -> ended now + voided
  member('u3', 'sub_3', 'past_due');
  INV.in_3 = { id: 'in_3', status: 'open', subscription: 'sub_3', amount_due: 1900 };
  r = await send('customer.subscription.updated', { id: 'sub_3', status: 'past_due', cancel_at_period_end: true, metadata: {} });
  ok('past_due cancel: sub ended now + open invoice voided, 200', r.code === 200 && SUBS.sub_3 && SUBS.sub_3.deleted && INV.in_3.status === 'void', r.result);

  // 3b. cancelling fails -> alert, still voids, 200
  member('u3b', 'sub_3b', 'past_due');
  INV.in_3b = { id: 'in_3b', status: 'open', subscription: 'sub_3b', amount_due: 1900 };
  cancelFails = true;
  r = await send('customer.subscription.updated', { id: 'sub_3b', status: 'past_due', cancel_at_period_end: true, metadata: {} });
  cancelFails = false;
  ok('past_due cancel failure: alert + void + 200', r.code === 200 && alerts().some((a) => a.key === 'adminTasks/billing_cancel_sub_3b') && INV.in_3b.status === 'void', r.result);

  // 4. normal cancel at period end on an ACTIVE sub: nothing voided, nothing cancelled
  member('u4', 'sub_4', 'active');
  INV.in_4 = { id: 'in_4', status: 'open', subscription: 'sub_4', amount_due: 1900 };
  const before = calls.length;
  r = await send('customer.subscription.updated', { id: 'sub_4', status: 'active', cancel_at_period_end: true, metadata: {} });
  ok('active cancel-at-period-end: no Stripe call, invoice untouched', r.code === 200 && calls.length === before && INV.in_4.status === 'open', r.result);

  // 5. retry on an already cancelled sub (invoice.payment_failed) -> voided
  INV.in_5 = { id: 'in_5', status: 'open', subscription: 'sub_1', amount_due: 1900 };
  r = await send('invoice.payment_failed', { id: 'in_5', subscription: 'sub_1', attempt_count: 3, subscription_details: { metadata: {} } });
  ok('retry on cancelled sub: voided, member not re-notified', r.code === 200 && INV.in_5.status === 'void' && /subscription canceled/.test(r.result), r.result);

  // 6. listing fails -> alert, 200
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('/v1/invoices?') ? { ok: false, status: 500, json: async () => ({ error: { type: 'api_error' } }) } : orig(url, init));
  member('u6', 'sub_6');
  r = await send('customer.subscription.deleted', { id: 'sub_6', status: 'canceled', metadata: {} });
  globalThis.fetch = orig;
  ok('list error: alert row + 200', r.code === 200 && alerts().some((a) => a.key === 'adminTasks/billing_void_list_sub_6'), r.result);

  ok('never a refund, charge, or invoice update/pay call', !calls.some((c) => /\/refunds|\/charges|\/payment_intents|\/pay$|\/invoices\/[^/]+$/.test(c.url.split('?')[0]) && c.method !== 'GET'));
  ok('no fake key in request bodies', !calls.some((c) => c.body.includes(TEST_KEY)));
  console.log('stripe-void: ' + n + ' checks, all pass');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
