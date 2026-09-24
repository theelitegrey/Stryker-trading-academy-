#!/usr/bin/env node
// Stripe TEST-mode end-to-end run (real Stripe, fake Firestore). TEST KEYS ONLY.
//
//   node tools/stripe/live-test-mode.js /path/to/stripe.env
//
// Reads STRIPE_SECRET_KEY from the env file (never printed). Refuses any key
// that isn't sk_test_/rk_test_. It drives the REAL functions-src/stripe.js
// against the real Stripe test API, with Firestore replaced by the in-memory
// stub, and feeds the webhook with events fetched back from Stripe's own /events
// log (re-signed locally with a local secret, because the real endpoint isn't
// deployed yet), so every payload shape is Stripe's own.
//
//   1. Checkout Session is created correctly (mode, price, metadata, url).
//   2. Subscription on a TEST CLOCK, card pm_card_visa (4242), with the Stripe
//      Price our function created: first invoice paid -> webhook grants.
//   3. Advance the clock one month -> invoice.paid renewal -> access extended,
//      renewal order, locked price unchanged.
//   4. Swap to pm_card_chargeCustomerFail (declines on charge), advance ->
//      invoice.payment_failed -> recorded, access unchanged.
//   5. cancel_at_period_end -> customer.subscription.updated -> autopay off.
//   6. Delete -> customer.subscription.deleted.
//   7. 3DS card 4000002500003155 (pm_card_threeDSecure2Required): first
//      invoice needs action (no grant), shown as requires_action.
//   8. Billing Portal session opens for the customer.
// Hosted-page card entry (4242 / 3DS / decline typed into Checkout) is the
// manual part: see tools/stripe/TEST-PLAN.md.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const envFile = process.argv[2] || '/root/.hermes/profiles/chief-of-staff/scripts/stripe.env';
const env = {};
for (const ln of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = ln.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const KEY = env.STRIPE_SECRET_KEY || env.STRIPE_TEST_SECRET_KEY;
if (!KEY || !/^(sk|rk)_test_/.test(KEY)) { console.error('Refusing: need a TEST key (sk_test_/rk_test_) in', envFile); process.exit(2); }
process.env.STRIPE_SECRET_KEY = KEY;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_' + crypto.randomBytes(8).toString('hex');
process.env.RAZORPAY_KEY_ID = 'rzp_test_offline'; process.env.RAZORPAY_KEY_SECRET = 'offline';

// ---- in-memory Firestore (as in stripetest.js) ----
let DB = {}; let autoId = 0;
const snapOf = (p) => ({ id: p.split('/').pop(), ref: docRef(p), exists: p in DB, data: () => DB[p] });
function deepMerge(a, b) { const o = Object.assign({}, a); for (const k of Object.keys(b)) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') ? deepMerge(a[k], b[k]) : b[k]; return o; }
function docRef(p) { return { path: p, get: async () => snapOf(p),
  set: async (v, o) => { DB[p] = (o && o.merge) ? deepMerge(DB[p] || {}, v) : Object.assign({}, v); },
  update: async (v) => { DB[p] = Object.assign({}, DB[p], v); },
  create: async (v) => { if (p in DB) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; } DB[p] = Object.assign({}, v); } }; }
function query(c, f) { return { where: (a, op, v) => query(c, f.concat([[a, op, v]])), get: async () => {
  const docs = Object.keys(DB).filter((p) => p.startsWith(c + '/') && p.split('/').length === 2).filter((p) => f.every(([a, op, v]) => op === '>=' ? DB[p][a] >= v : DB[p][a] === v)).map(snapOf);
  return { empty: !docs.length, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) }; } }; }
const fakeDb = { collection: (c) => Object.assign(query(c, []), { doc: (id) => docRef(c + '/' + id), add: async (v) => { const p = c + '/auto' + (++autoId); DB[p] = v; return docRef(p); } }),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o), update: (r, v) => r.update(v) }) };
let clk = 1000;
const admin = { apps: [1], initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => ++clk }, Timestamp: { now: () => ++clk } }) };
const fx = { https: { onCall: (f) => f, onRequest: (f) => f, HttpsError: class extends Error { constructor(c, m) { super(c + ': ' + m); this.code = c; } } },
  runWith() { return this; }, firestore: { document: () => ({ onCreate: (f) => f }) }, pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (f) => f }), onRun: (f) => f }) } };
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'firebase-admin') return admin; if (r === 'firebase-functions') return fx; return orig.call(this, r, ...a); };

const FN = path.join(__dirname, '../../functions-src/');
const ST = require(FN + 'stripe');
const LS = require(FN + 'launchSale');

// ---- direct Stripe helper for the test harness itself ----
function enc(o, pre, out = []) { for (const [k, v] of Object.entries(o)) { if (v == null) continue; const key = pre ? pre + '[' + k + ']' : k;
  if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'object' ? enc(x, key + '[' + i + ']', out) : out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(x)));
  else if (typeof v === 'object') enc(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v)); } return out.join('&'); }
async function S(method, p, params) {
  let url = 'https://api.stripe.com/v1/' + p; let body;
  if (params && method === 'GET') url += '?' + enc(params); else if (params) body = enc(params);
  const r = await fetch(url, { method, body, headers: { Authorization: 'Bearer ' + KEY, 'Stripe-Version': '2024-06-20', 'Content-Type': 'application/x-www-form-urlencoded' } });
  const j = await r.json();
  if (!r.ok) throw new Error(method + ' ' + p + ' -> ' + r.status + ' ' + (j.error && j.error.message));
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function deliver(event) {
  const raw = Buffer.from(JSON.stringify(event)); const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(t + '.' + raw).digest('hex');
  let st = 0, tx = ''; const res = { status(s) { st = s; return this; }, send(x) { tx = x; } };
  await ST.stripeWebhook({ rawBody: raw, headers: { 'stripe-signature': 't=' + t + ',v1=' + sig } }, res);
  return st + ' ' + tx;
}
const seen = new Set();
// Pull Stripe's own events for an object and deliver the new ones, oldest first.
async function pump(match, types) {
  await sleep(2500);
  const evs = (await S('GET', 'events', { limit: 50, types })).data.reverse();
  const out = [];
  for (const e of evs) {
    if (seen.has(e.id) || !match(e)) continue;
    seen.add(e.id);
    out.push(e.type + ' -> ' + await deliver(e));
  }
  return out;
}
async function advance(clockId, toSec) {
  await S('POST', 'test_helpers/test_clocks/' + clockId + '/advance', { frozen_time: toSec });
  for (let i = 0; i < 40; i++) { await sleep(3000); const c = await S('GET', 'test_helpers/test_clocks/' + clockId); if (c.status === 'ready') return; }
  throw new Error('test clock did not settle');
}

let fails = 0;
const check = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + l.padEnd(60) + ' ' + JSON.stringify(got) + (ok ? '' : '  (want ' + JSON.stringify(want) + ')')); };
const ctx = (uid) => ({ auth: { uid, token: { email: uid + '@example.com', name: 'Test ' + uid } } });
const ordersFor = (uid) => Object.entries(DB).filter(([p, v]) => p.startsWith('orders/') && v.studentUid === uid).map(([, v]) => v);

(async () => {
  const run = 't' + Date.now().toString(36);
  DB = { 'settings/commerce': { usdInr: 88.2 },
    'plans/PRO': { name: 'Pro', period: 'month', price: '49', salePrice: '19', priceInr: '2499', salePriceInr: '699', saleEndsAt: '' },
    'launchSaleConfig/main': { active: true, startAt: 1, limit: 100, planIds: ['PRO'], excludeUids: [], excludeCoupons: [] } };
  const uid = 'stripetest_' + run;
  console.log('run', run, '(TEST mode)');

  console.log('\n== 1. Checkout Session (real Stripe) ==');
  const out = await ST.stripeCreateCheckout({ planId: 'PRO' }, ctx(uid));
  const sess = await S('GET', 'checkout/sessions/' + out.sessionId, { 'expand[]': 'line_items' });
  check('session mode / status', [sess.mode, sess.status], ['subscription', 'open']);
  check('price $19.00 / month', [sess.line_items.data[0].price.unit_amount, sess.line_items.data[0].price.recurring.interval], [1900, 'month']);
  check('client_reference_id + metadata', [sess.client_reference_id, sess.metadata.uid, sess.metadata.sitePlanId, sess.metadata.lockUsd], [uid, uid, 'PRO', '19']);
  check('hosted url', out.url.startsWith('https://checkout.stripe.com/'), true);
  const priceId = DB['stripePrices/PRO_1900_usd_month'].priceId;
  const custId = DB['stripeCustomers/' + uid].customerId;

  console.log('\n== 2. Subscription on a test clock, card 4242 ==');
  const now = Math.floor(Date.now() / 1000);
  const clock = await S('POST', 'test_helpers/test_clocks', { frozen_time: now, name: 'stryker ' + run });
  const cust = await S('POST', 'customers', { email: uid + '@example.com', test_clock: clock.id, metadata: { uid } });
  DB['stripeCustomers/' + uid] = { customerId: cust.id };
  const pm = await S('POST', 'payment_methods/pm_card_visa/attach', { customer: cust.id });
  await S('POST', 'customers/' + cust.id, { 'invoice_settings[default_payment_method]': pm.id });
  const meta = { uid, sitePlanId: 'PRO', lockUsd: '19', coupon: '' };
  const sub = await S('POST', 'subscriptions', { customer: cust.id, items: [{ price: priceId }], metadata: meta, 'expand[]': 'latest_invoice' });
  check('subscription active, first invoice paid', [sub.status, sub.latest_invoice.status, sub.latest_invoice.amount_paid], ['active', 'paid', 1900]);
  // Our checkout.session.completed path needs a session; for the clock run the
  // session record is linked to this subscription and a completed-session
  // event is synthesized from Stripe's real subscription.
  DB['stripeSessions/cs_clock_' + run] = Object.assign({}, DB['stripeSessions/' + out.sessionId], { customerId: cust.id });
  const r1 = await deliver({ id: 'evt_local_' + run, type: 'checkout.session.completed', livemode: false, data: { object: {
    id: 'cs_clock_' + run, mode: 'subscription', payment_status: 'paid', client_reference_id: uid, subscription: sub.id,
    amount_total: sub.latest_invoice.amount_paid, customer_details: { email: uid + '@example.com', name: 'Test' } } } });
  check('webhook: checkout.session.completed', r1, '200 ok');
  check('granted Pro through Stripe period end', [DB['students/' + uid].plan, DB['students/' + uid].paidThroughMillis], ['Pro', sub.current_period_end * 1000]);
  console.log('   events:', (await pump((e) => e.data.object.subscription === sub.id || e.data.object.id === sub.id, ['invoice.paid'])).join(' | '));
  check('first invoice.paid adds no second order', ordersFor(uid).length, 1);
  await LS.launchSaleOnOrder();
  check('seat counter = 1', DB['settings/commerce'].launchSale.taken, 1);

  console.log('\n== 3. Renewal (advance the clock 1 month + 1 day) ==');
  DB['plans/PRO'].salePrice = '';   // the sale ends: the member's Price must not change
  await advance(clock.id, sub.current_period_end + 86400);
  console.log('   events:', (await pump((e) => e.data.object.subscription === sub.id, ['invoice.paid'])).join(' | '));
  const sub2 = await S('GET', 'subscriptions/' + sub.id);
  check('access extended to the new period end', DB['students/' + uid].paidThroughMillis, sub2.current_period_end * 1000);
  check('renewal order at the LOCKED $19', ordersFor(uid).map((o) => o.finalAmount), [19, 19]);
  await LS.launchSaleOnOrder();
  check('seat counter still 1 after renewal', DB['settings/commerce'].launchSale.taken, 1);

  console.log('\n== 4. Payment failure ==');
  const bad = await S('POST', 'payment_methods/pm_card_chargeCustomerFail/attach', { customer: cust.id });
  await S('POST', 'customers/' + cust.id, { 'invoice_settings[default_payment_method]': bad.id });
  await S('POST', 'subscriptions/' + sub.id, { default_payment_method: bad.id });
  const through = DB['students/' + uid].paidThroughMillis;
  await advance(clock.id, sub2.current_period_end + 86400);
  console.log('   events:', (await pump((e) => e.data.object.subscription === sub.id, ['invoice.payment_failed', 'invoice.paid'])).join(' | '));
  check('failure recorded', !!DB['stripeSubs/' + sub.id].lastPaymentFailedAt, true);
  check('access unchanged (runs to paidThrough)', DB['students/' + uid].paidThroughMillis, through);
  check('member notified', Object.values(DB).some((v) => v && v.type === 'payment_failed' && v.recipientUid === uid), true);

  console.log('\n== 5. Cancel at period end, then 6. delete ==');
  await S('POST', 'subscriptions/' + sub.id, { cancel_at_period_end: 'true' });
  console.log('   events:', (await pump((e) => e.data.object.id === sub.id, ['customer.subscription.updated'])).join(' | '));
  check('autopay off after cancel_at_period_end', DB['students/' + uid].subscriptionAutopay, false);
  await S('DELETE', 'subscriptions/' + sub.id);
  console.log('   events:', (await pump((e) => e.data.object.id === sub.id, ['customer.subscription.deleted'])).join(' | '));
  check('deleted recorded', DB['stripeSubs/' + sub.id].status, 'canceled');

  console.log('\n== 7. 3DS-required card: no grant until authenticated ==');
  const uid3 = uid + '_3ds';
  const c3 = await S('POST', 'customers', { email: uid3 + '@example.com', metadata: { uid: uid3 } });
  const pm3 = await S('POST', 'payment_methods/pm_card_threeDSecure2Required/attach', { customer: c3.id });
  const s3 = await S('POST', 'subscriptions', { customer: c3.id, items: [{ price: priceId }], default_payment_method: pm3.id,
    payment_behavior: 'default_incomplete', metadata: { uid: uid3, sitePlanId: 'PRO', lockUsd: '19', coupon: '' }, 'expand[]': 'latest_invoice.payment_intent' });
  check('3DS: subscription incomplete, needs action', [s3.status, s3.latest_invoice.payment_intent && s3.latest_invoice.payment_intent.status],
    ['incomplete', 'requires_payment_method']);
  console.log('   events:', (await pump((e) => e.data.object.subscription === s3.id, ['invoice.paid'])).join(' | ') || '(none)');
  check('3DS: nothing granted', !!(DB['students/' + uid3] && DB['students/' + uid3].plan), false);
  await S('DELETE', 'subscriptions/' + s3.id).catch(() => {});

  console.log('\n== 8. Billing Portal ==');
  DB['stripeCustomers/' + uid] = { customerId: custId };
  try { const p = await ST.stripePortal({}, ctx(uid)); check('portal url', p.url.startsWith('https://billing.stripe.com/'), true); }
  catch (e) { fails++; console.log('FAIL portal:', e.message, '(configure the Customer Portal in test mode: Settings > Billing > Customer portal)'); }

  await S('DELETE', 'test_helpers/test_clocks/' + clock.id).catch(() => {});
  console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
