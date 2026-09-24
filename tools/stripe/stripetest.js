#!/usr/bin/env node
// Stripe subscriptions: offline test.
//
//   node tools/stripe/stripetest.js
//
// Loads the real functions-src/stripe.js (plus razorpay.js / launchSale.js /
// subscriptions.js, which it prices with) against an in-memory Firestore and a
// mocked Stripe API. Asserts the amounts sent to Stripe, the webhook grants,
// idempotency, renewals, failures, cancellation and signature checks. Nothing
// touches the network, Firestore or Stripe. Exits 1 on any failure.
//
// The real-Stripe half (test cards, 3DS, test-clock renewals) is
// tools/stripe/live-test-mode.js, which needs a TEST key.
'use strict';
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const origLoad = Module._load;

// ---- in-memory Firestore (same shape as tools/launch-sale/paytest.js) --------
let DB = {};
let autoId = 0;
const snapOf = (p) => ({ id: p.split('/').pop(), ref: docRef(p), exists: p in DB, data: () => DB[p] });
function deepMerge(a, b) {
  const out = Object.assign({}, a);
  for (const k of Object.keys(b)) {
    out[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object')
      ? deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}
function docRef(p) {
  return {
    path: p,
    get: async () => snapOf(p),
    set: async (v, o) => { DB[p] = (o && o.merge) ? deepMerge(DB[p] || {}, v) : Object.assign({}, v); },
    update: async (v) => { DB[p] = Object.assign({}, DB[p], v); },
    create: async (v) => {
      if (p in DB) { const e = new Error('6 ALREADY_EXISTS: Document already exists'); e.code = 6; throw e; }
      DB[p] = Object.assign({}, v);
    }
  };
}
function query(c, filters) {
  return {
    where: (f, op, v) => query(c, filters.concat([[f, op, v]])),
    get: async () => {
      const docs = Object.keys(DB).filter((p) => p.startsWith(c + '/') && p.split('/').length === 2)
        .filter((p) => filters.every(([f, op, v]) => op === '>=' ? DB[p][f] >= v : op === '==' ? DB[p][f] === v : true))
        .map(snapOf);
      return { empty: !docs.length, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
    }
  };
}
const fakeDb = {
  collection: (c) => Object.assign(query(c, []), {
    doc: (id) => docRef(c + '/' + id),
    add: async (v) => { const p = c + '/auto' + (++autoId); DB[p] = v; return docRef(p); }
  }),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o), update: (r, v) => r.update(v) })
};
let clock = 1000;
const admin = {
  apps: [1], initializeApp() {},
  firestore: Object.assign(() => fakeDb, {
    FieldValue: { serverTimestamp: () => ++clock, delete: () => null, increment: (n) => n },
    Timestamp: { now: () => ++clock }
  })
};
const fx = {
  https: { onCall: (f) => f, onRequest: (f) => f,
    HttpsError: class extends Error { constructor(c, m) { super(c + ': ' + m); this.code = c; } } },
  runWith() { return this; }, region() { return this; },
  firestore: { document: () => ({ onCreate: (f) => f, onWrite: (f) => f }) },
  pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (f) => f }), onRun: (f) => f }) },
  auth: { user: () => ({ onCreate: (f) => f }) },
  config: () => ({})
};
Module._load = function (r, ...a) {
  if (r === 'firebase-admin') return admin;
  if (r === 'firebase-functions' || r === 'firebase-functions/v1') return fx;
  return origLoad.call(this, r, ...a);
};
process.env.RAZORPAY_KEY_ID = 'rzp_test_offline';
process.env.RAZORPAY_KEY_SECRET = 'offline';
process.env.STRIPE_SECRET_KEY = 'sk_test_offline';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_offline';

// ---- mocked Stripe (and Razorpay, for the regression half) --------------------
let sent = [];
let STRIPE_SUBS = {};       // the mock's own subscription objects
let nextFail = null;        // force the next Stripe call to fail
function parseForm(body) {
  const out = {};
  if (!body) return out;
  for (const kv of body.split('&')) {
    const [k, v] = kv.split('=').map(decodeURIComponent);
    out[k] = v;
  }
  return out;
}
global.fetch = async (url, o) => {
  if (url.startsWith('https://api.razorpay.com/')) {
    const b = o && o.body ? JSON.parse(o.body) : null;
    sent.push({ gw: 'rzp', path: url.split('/v1/')[1], b });
    return { ok: true, status: 200, json: async () => ({ id: 'rzp_' + (++autoId) }), text: async () => '' };
  }
  const p = url.replace('https://api.stripe.com/v1/', '').split('?')[0];
  const b = parseForm(o && o.body);
  sent.push({ gw: 'stripe', method: o.method, path: p, b, headers: o.headers });
  if (nextFail) { const f = nextFail; nextFail = null;
    return { ok: false, status: f, json: async () => ({ error: { type: 'api_error', message: 'mock' } }) }; }
  let body = {};
  if (p === 'products') body = { id: 'prod_' + (++autoId) };
  else if (p === 'prices') body = { id: 'price_' + (++autoId), unit_amount: +b.unit_amount };
  else if (p === 'coupons') body = { id: 'co_' + (++autoId) };
  else if (p === 'customers') body = { id: 'cus_' + (++autoId) };
  else if (p === 'checkout/sessions') {
    const id = 'cs_test_' + (++autoId);
    body = { id, url: 'https://checkout.stripe.com/c/pay/' + id };
  } else if (p.startsWith('subscriptions/')) body = STRIPE_SUBS[p.split('/')[1]];
  else if (p === 'billing_portal/sessions') body = { url: 'https://billing.stripe.com/p/session/test_' + (++autoId) };
  return { ok: true, status: 200, json: async () => body };
};

const FN = path.join(__dirname, '../../functions-src/');
const ST = require(FN + 'stripe');
const R = require(FN + 'razorpay');
const LS = require(FN + 'launchSale');
const I = ST.__stripeInternals;

// ---- fixtures -----------------------------------------------------------------
const PRO = { name: 'Pro', period: 'month', price: '49', salePrice: '19', priceInr: '2499', salePriceInr: '699', saleEndsAt: '' };
const PRO_Y = { name: 'Pro', period: 'year', price: '490', salePrice: '149', priceInr: '24990', salePriceInr: '5499', saleEndsAt: '' };
const ELITE = { name: 'Elite', period: 'month', price: '129', salePrice: '49', priceInr: '5999', salePriceInr: '1999', saleEndsAt: '' };
function reset() {
  DB = {
    'settings/commerce': { usdInr: 88.2 },
    'plans/PRO': Object.assign({}, PRO),
    'plans/PROY': Object.assign({}, PRO_Y),
    'plans/ELITE': Object.assign({}, ELITE),
    'plans/LIFE': { name: 'Lifetime', period: 'lifetime', price: '299' },
    'plans/FREE': { name: 'Starter', period: 'month', price: '0' },
    'coupons/HALF': { type: 'percent', value: 50, appliesToPlan: 'all' },
    'coupons/FIVE': { type: 'fixed', value: 5, appliesToPlan: 'all' },
    'coupons/FOUND': { type: 'percent', value: 50, appliesToPlan: 'all', marksFounding: true },
    'coupons/OLD': { type: 'percent', value: 10, appliesToPlan: 'all', active: false },
    'launchSaleConfig/main': { active: true, startAt: 1, limit: 100, planIds: ['PRO', 'PROY', 'ELITE'], excludeUids: [], excludeCoupons: ['TEST*'] }
  };
  STRIPE_SUBS = {};
}
const ctx = (uid) => ({ auth: { uid, token: { email: 'stryker-qa-' + uid.toLowerCase() + '@example.com', name: 'U ' + uid } } });

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label.padEnd(58) + ' ' + JSON.stringify(got) + (ok ? '' : '   (want ' + JSON.stringify(want) + ')'));
}
async function rejects(label, p, codeWant) {
  let code = 'resolved';
  try { await p; } catch (e) { code = e.code || e.message; }
  check(label, code, codeWant);
}
async function checkout(data, uid = 'u1') {
  sent = [];
  const r = await ST.stripeCreateCheckout(data, ctx(uid));
  const sess = sent.find((s) => s.path === 'checkout/sessions');
  const price = sent.find((s) => s.path === 'prices');
  return { r, sess, price };
}
// Deliver a signed event to the real webhook handler.
async function deliver(event, opts = {}) {
  const raw = Buffer.from(JSON.stringify(event));
  const t = opts.t || Math.floor(Date.now() / 1000);
  const secret = opts.secret || process.env.STRIPE_WEBHOOK_SECRET;
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + raw.toString('utf8')).digest('hex');
  let status = 0, text = '';
  const res = { status(s) { status = s; return this; }, send(x) { text = x; } };
  await ST.stripeWebhook({ rawBody: raw, headers: { 'stripe-signature': ('header' in opts) ? opts.header : ('t=' + t + ',v1=' + sig) } }, res);
  return status + ' ' + text;
}
let evN = 0;
const ev = (type, object, extra) => Object.assign({ id: 'evt_' + (++evN), type, livemode: false, data: { object } }, extra || {});
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
function completeSession(sessId, uid, subId, amountTotal, periodEnd, invId) {
  STRIPE_SUBS[subId] = { id: subId, status: 'active', cancel_at_period_end: false, current_period_end: periodEnd, latest_invoice: invId };
  return ev('checkout.session.completed', {
    id: sessId, object: 'checkout.session', mode: 'subscription', payment_status: 'paid',
    client_reference_id: uid, subscription: subId, amount_total: amountTotal,
    customer_details: { email: uid + '@example.com', name: 'U ' + uid }
  });
}
function invoice(id, subId, amountPaid, periodEnd, reason, meta) {
  return { id, object: 'invoice', subscription: subId, currency: 'usd', amount_paid: amountPaid,
    billing_reason: reason, customer_email: 'x@example.com', attempt_count: 1,
    subscription_details: { metadata: meta || {} },
    lines: { data: [{ period: { start: periodEnd - 30 * DAY, end: periodEnd } }] } };
}
const ordersFor = (uid) => Object.entries(DB).filter(([p, v]) => p.startsWith('orders/') && v.studentUid === uid).map(([, v]) => v);

(async () => {
  console.log('== Amounts sent to Stripe (launch sale live) ==');
  reset();
  let c = await checkout({ planId: 'PRO' });
  check('Pro monthly: recurring price $19.00 / month', [c.price.b.unit_amount, c.price.b['recurring[interval]'], c.price.b.currency], ['1900', 'month', 'usd']);
  check('session mode=subscription, client_reference_id', [c.sess.b.mode, c.sess.b.client_reference_id], ['subscription', 'u1']);
  check('session metadata uid / sitePlanId / lockUsd', [c.sess.b['metadata[uid]'], c.sess.b['metadata[sitePlanId]'], c.sess.b['metadata[lockUsd]']], ['u1', 'PRO', '19']);
  check('subscription_data carries the same metadata', c.sess.b['subscription_data[metadata][uid]'], 'u1');
  check('success URL has the session placeholder', /stripe=success&session_id=\{CHECKOUT_SESSION_ID\}$/.test(c.sess.b.success_url), true);
  check('hosted page: no card data in our request', Object.keys(c.sess.b).some((k) => /card\[|number|cvc/.test(k)), false);
  check('pinned Stripe-Version header', c.sess.headers['Stripe-Version'], I.STRIPE_VERSION);
  check('returned url is the hosted Checkout page', c.r.url.startsWith('https://checkout.stripe.com/'), true);
  check('customer created with uid metadata', sent.find((s) => s.path === 'customers').b['metadata[uid]'], 'u1');
  c = await checkout({ planId: 'PRO' });
  check('second checkout reuses customer + cached price', [sent.some((s) => s.path === 'customers'), sent.some((s) => s.path === 'prices')], [false, false]);
  c = await checkout({ planId: 'PROY' });
  check('Pro yearly twin: $149.00 / year', [c.price.b.unit_amount, c.price.b['recurring[interval]']], ['14900', 'year']);
  c = await checkout({ planId: 'ELITE' });
  check('Elite monthly: $49.00', c.price.b.unit_amount, '4900');
  c = await checkout({ planId: 'PRO', couponCode: 'half' });
  check('50% coupon -> Stripe coupon, first payment only', [sent.find((s) => s.path === 'coupons').b.percent_off, sent.find((s) => s.path === 'coupons').b.duration], ['50', 'once']);
  check('50% coupon: renewal price stays $19', c.r.renewCents, 1900);
  check('50% coupon: first charge $9.50', c.r.amountCents, 950);
  check('coupon applied via discounts[]', !!c.sess.b['discounts[0][coupon]'], true);
  c = await checkout({ planId: 'PRO', couponCode: 'FIVE' });
  check('$5 coupon -> amount_off 500 usd', [sent.find((s) => s.path === 'coupons').b.amount_off, sent.find((s) => s.path === 'coupons').b.currency], ['500', 'usd']);
  await rejects('founding (lifetime) coupon refused on a subscription', checkout({ planId: 'PRO', couponCode: 'FOUND' }), 'failed-precondition');
  await rejects('inactive coupon refused', checkout({ planId: 'PRO', couponCode: 'OLD' }), 'failed-precondition');
  await rejects('unknown coupon refused', checkout({ planId: 'PRO', couponCode: 'NOPE' }), 'failed-precondition');
  await rejects('free plan refused (goes to the free path)', checkout({ planId: 'FREE' }), 'failed-precondition');
  await rejects('non-renewing plan refused', checkout({ planId: 'LIFE' }), 'failed-precondition');
  await rejects('unknown plan', checkout({ planId: 'NOPE' }), 'not-found');
  await rejects('signed out', ST.stripeCreateCheckout({ planId: 'PRO' }, {}), 'unauthenticated');
  const k = process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY;
  await rejects('no key configured: clean failed-precondition', checkout({ planId: 'PRO' }), 'failed-precondition');
  process.env.STRIPE_SECRET_KEY = k;
  nextFail = 401;
  await rejects('Stripe rejects the key: permission-denied', checkout({ planId: 'PRO' }, 'u8'), 'permission-denied');

  console.log('\n== Founding lock (after the sale ends) ==');
  reset();
  DB['plans/PRO'] = Object.assign({}, PRO, { salePrice: '' });
  DB['foundingPrices/u1'] = { plans: { PRO: { usd: 19, inr: 699 } } };
  DB['students/u1'] = { paidThroughMillis: Date.now() + DAY * 1000 };
  c = await checkout({ planId: 'PRO' });
  check('founding member, paid up: $19 price', c.price.b.unit_amount, '1900');
  DB['students/u2'] = {};
  c = await checkout({ planId: 'PRO' }, 'u2');
  check('new member after sale: $49 price', c.price.b.unit_amount, '4900');
  DB['students/u1'] = { paidThroughMillis: Date.now() - 10 * DAY * 1000 };
  c = await checkout({ planId: 'PRO' });
  check('founding member LAPSED: back to $49 (cached price reused)', [c.r.renewCents, sent.some((s) => s.path === 'prices')], [4900, false]);

  console.log('\n== Webhook: first purchase ==');
  reset();
  c = await checkout({ planId: 'PRO' }, 'u5');
  const sess1 = c.r.sessionId;
  const pe1 = now() + 30 * DAY;
  check('checkout.session.completed accepted', await deliver(completeSession(sess1, 'u5', 'sub_1', 1900, pe1, 'in_1')), '200 ok');
  let s5 = DB['students/u5'];
  check('plan granted', [s5.plan, s5.planId], ['Pro', 'PRO']);
  check('paidThroughMillis = Stripe period end', s5.paidThroughMillis, pe1 * 1000);
  check('autopay on, provider stripe, ids stored', [s5.subscriptionAutopay, s5.billingProvider, s5.stripeSubscriptionId, !!s5.stripeCustomerId], [true, 'stripe', 'sub_1', true]);
  check('profile plan', DB['profiles/u5'].plan, 'Pro');
  let o5 = ordersFor('u5');
  check('one order: $19 USD, gateway stripe', o5.map((o) => [o.finalAmount, o.currency, o.gateway]), [[19, 'USD', 'stripe']]);
  check('founding price recorded ($19)', DB['foundingPrices/u5'].plans.PRO.usd, 19);
  await LS.launchSaleOnOrder();
  check('launch seat counted once', DB['settings/commerce'].launchSale.taken, 1);
  const evDup = completeSession(sess1, 'u5', 'sub_1', 1900, pe1, 'in_1');
  check('same session re-sent (new event id): no second grant', await deliver(evDup), '200 ok');
  check('still one order', ordersFor('u5').length, 1);
  check('replayed event id acknowledged, not re-run', await deliver(evDup), '200 duplicate');
  check('first invoice.paid (subscription_create) does not add an order', await deliver(ev('invoice.paid', invoice('in_1', 'sub_1', 1900, pe1, 'subscription_create'))), '200 ok');
  check('still one order after first invoice', ordersFor('u5').length, 1);
  await LS.launchSaleOnOrder();
  check('seat counter still 1', DB['settings/commerce'].launchSale.taken, 1);

  console.log('\n== Webhook: renewal (test-clock equivalent) ==');
  const pe2 = pe1 + 30 * DAY;
  check('invoice.paid renewal accepted', await deliver(ev('invoice.paid', invoice('in_2', 'sub_1', 1900, pe2, 'subscription_cycle'))), '200 ok');
  check('access extended to the new period end', DB['students/u5'].paidThroughMillis, pe2 * 1000);
  check('renewal order written ($19)', ordersFor('u5').map((o) => o.finalAmount), [19, 19]);
  check('renewal notification', Object.values(DB).some((v) => v && v.type === 'renewal_charged' && v.recipientUid === 'u5'), true);
  check('same invoice again (new event id)', await deliver(ev('invoice.paid', invoice('in_2', 'sub_1', 1900, pe2, 'subscription_cycle'))), '200 ok');
  check('idempotent per invoice id: still 2 orders', ordersFor('u5').length, 2);
  check('underpaid renewal refused', await deliver(ev('invoice.paid', invoice('in_3', 'sub_1', 500, pe2 + 30 * DAY, 'subscription_cycle'))), '200 ok');
  check('underpaid: access NOT extended', DB['students/u5'].paidThroughMillis, pe2 * 1000);
  check('non-USD invoice ignored', await deliver(ev('invoice.paid', Object.assign(invoice('in_4', 'sub_1', 1900, pe2 + 60 * DAY, 'subscription_cycle'), { currency: 'eur' }))), '200 ok');
  check('non-USD: access NOT extended', DB['students/u5'].paidThroughMillis, pe2 * 1000);
  // Locked price across renewal: after the sale ends the member's Stripe Price is unchanged.
  DB['plans/PRO'] = Object.assign({}, PRO, { salePrice: '' });
  check('lock persists: renewal at $19 after the sale ends is accepted', await deliver(ev('invoice.paid', invoice('in_5', 'sub_1', 1900, pe2 + 30 * DAY, 'subscription_cycle'))), '200 ok');
  check('lock persists: extended', DB['students/u5'].paidThroughMillis, (pe2 + 30 * DAY) * 1000);
  c = await checkout({ planId: 'PRO' }, 'u5b');
  check('while a brand-new member pays $49', c.r.renewCents, 4900);
  DB['plans/PRO'] = Object.assign({}, PRO);

  console.log('\n== Webhook: payment failed, cancel, delete ==');
  const before = DB['students/u5'].paidThroughMillis;
  check('invoice.payment_failed recorded', await deliver(ev('invoice.payment_failed', invoice('in_6', 'sub_1', 0, pe2 + 60 * DAY, 'subscription_cycle'))), '200 ok');
  check('failure: access unchanged (runs to paidThrough)', DB['students/u5'].paidThroughMillis, before);
  check('failure: plan unchanged', DB['students/u5'].plan, 'Pro');
  check('failure: member notified once', Object.values(DB).filter((v) => v && v.type === 'payment_failed' && v.recipientUid === 'u5').length, 1);
  check('failure: stripeSubs marked', !!DB['stripeSubs/sub_1'].lastPaymentFailedAt, true);
  check('customer.subscription.updated cancel_at_period_end', await deliver(ev('customer.subscription.updated',
    { id: 'sub_1', object: 'subscription', status: 'active', cancel_at_period_end: true, current_period_end: pe2 + 30 * DAY, metadata: {} })), '200 ok');
  check('cancel at period end: autopay off, access kept', [DB['students/u5'].subscriptionAutopay, DB['students/u5'].plan, DB['students/u5'].paidThroughMillis], [false, 'Pro', before]);
  check('autopay-stopped notification', Object.values(DB).some((v) => v && v.type === 'autopay_stopped' && v.recipientUid === 'u5'), true);
  check('un-cancel (resume) turns autopay back on', await deliver(ev('customer.subscription.updated',
    { id: 'sub_1', object: 'subscription', status: 'active', cancel_at_period_end: false, current_period_end: pe2 + 30 * DAY, metadata: {} })), '200 ok');
  check('autopay on again', DB['students/u5'].subscriptionAutopay, true);
  check('customer.subscription.deleted', await deliver(ev('customer.subscription.deleted',
    { id: 'sub_1', object: 'subscription', status: 'canceled', cancel_at_period_end: false, current_period_end: pe2 + 30 * DAY, metadata: {} })), '200 ok');
  check('deleted: autopay off; plan left for the daily sweep', [DB['students/u5'].subscriptionAutopay, DB['students/u5'].plan], [false, 'Pro']);
  const sw = require(FN + 'subscriptions').__internals;
  const planInfo = { period: 'month', price: 19 };
  check('sweep: inside paid period -> none', sw.decide(DB['students/u5'], planInfo, before - 5 * DAY * 1000).action, 'none');
  check('sweep: after paid date + grace -> expire', sw.decide(DB['students/u5'], planInfo, before + 4 * DAY * 1000).action, 'expire');

  console.log('\n== Webhook: security ==');
  reset();
  c = await checkout({ planId: 'ELITE' }, 'u6');
  const e6 = completeSession(c.r.sessionId, 'u6', 'sub_6', 4900, now() + 30 * DAY, 'in_61');
  check('bad signature -> 400', await deliver(e6, { secret: 'whsec_wrong' }), '400 bad signature');
  check('stale timestamp (10 min) -> 400', await deliver(e6, { t: now() - 600 }), '400 bad signature');
  check('missing header -> 400', await deliver(e6, { header: '' }), '400 bad signature');
  check('nothing granted by rejected events', !!DB['students/u6'], false);
  check('livemode event on a test key -> ignored', await deliver(Object.assign({}, e6, { id: 'evt_live', livemode: true })), '200 mode mismatch, ignored');
  check('nothing granted by a live event on test', !!DB['students/u6'], false);
  const forged = completeSession(c.r.sessionId, 'attacker', 'sub_6', 4900, now() + 30 * DAY, 'in_61');
  check('session with a different client_reference_id', await deliver(forged), '200 ok');
  check('... grants nothing to either uid', [!!DB['students/attacker'], !!DB['students/u6']], [false, false]);
  check('the genuine session still grants afterwards', await deliver(completeSession(c.r.sessionId, 'u6', 'sub_6', 4900, now() + 30 * DAY, 'in_61')), '200 ok');
  check('... Elite to u6', DB['students/u6'] && DB['students/u6'].plan, 'Elite');
  const unpaid = ev('checkout.session.completed', { id: 'cs_x', mode: 'subscription', payment_status: 'unpaid', client_reference_id: 'u6', subscription: 'sub_x' });
  check('unpaid session ignored', await deliver(unpaid), '200 ok');
  check('unknown session grants nothing', await deliver(completeSession('cs_unknown', 'u7', 'sub_7', 1900, now() + 30 * DAY, 'in_7')), '200 ok');
  check('... no student doc for u7', !!DB['students/u7'], false);
  const k2 = process.env.STRIPE_WEBHOOK_SECRET; delete process.env.STRIPE_WEBHOOK_SECRET;
  check('webhook secret missing -> 500 (Stripe retries later)', await deliver(e6, { secret: 'whsec_offline' }), '500 webhook secret not configured');
  process.env.STRIPE_WEBHOOK_SECRET = k2;
  check('verifySignature accepts one of several v1 values', I.verifySignature(Buffer.from('{}'), 't=' + now() + ',v1=abc,v1=' +
    crypto.createHmac('sha256', 'k').update(now() + '.{}').digest('hex'), 'k'), true);

  console.log('\n== Portal + one active subscription per member ==');
  reset();
  await rejects('portal with no Stripe customer', ST.stripePortal({}, ctx('u9')), 'not-found');
  c = await checkout({ planId: 'PRO' }, 'u9');
  await deliver(completeSession(c.r.sessionId, 'u9', 'sub_9', 1900, now() + 30 * DAY, 'in_9'));
  sent = [];
  const portal = await ST.stripePortal({}, ctx('u9'));
  check('portal session for the stored customer', [portal.url.startsWith('https://billing.stripe.com/'), sent[0].b.customer], [true, DB['stripeCustomers/u9'].customerId]);
  check('portal returns to settings', /\/settings\.html$/.test(sent[0].b.return_url), true);
  await rejects('second checkout while subscribed is refused', checkout({ planId: 'ELITE' }, 'u9'), 'already-exists');
  await rejects('stripeStatus is admin-only', ST.stripeStatus({}, ctx('u9')), 'permission-denied');
  // Test-mode gate: a real member can't buy with a test key; QA throwaways and admins can.
  {
    let msg = '';
    try { await ST.stripeCreateCheckout({ planId: 'PRO' }, { auth: { uid: 'realmember', token: { email: 'someone@gmail.com' } } }); }
    catch (e) { msg = e.message; }
    check('test key: real member refused', /not open yet/.test(msg), true);
    DB['admins/admgate'] = { x: 1 };
    let ok = false;
    try { const r = await ST.stripeCreateCheckout({ planId: 'PRO' }, { auth: { uid: 'admgate', token: { email: 'owner@gmail.com' } } }); ok = !!r.url; } catch (e) { ok = e.message; }
    check('test key: admin allowed', ok, true);
  }
  // Live key: the settings/commerce.stripeCheckout switch gates real members.
  {
    const k = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = 'rk_live_offline';
    const com = DB['settings/commerce']; DB['settings/commerce'] = Object.assign({}, com, { stripeCheckout: false });
    let msg = '';
    try { await ST.stripeCreateCheckout({ planId: 'PRO' }, { auth: { uid: 'livemember', token: { email: 'someone@gmail.com' } } }); } catch (e) { msg = e.message; }
    check('live key + switch OFF: member refused', /not open yet/.test(msg), true);
    DB['settings/commerce'].stripeCheckout = true; msg = '';
    try { await ST.stripeCreateCheckout({ planId: 'PRO' }, { auth: { uid: 'livemember', token: { email: 'someone@gmail.com' } } }); } catch (e) { msg = e.message; }
    check('live key + switch ON: member passes the gate', /not open yet/.test(msg), false);
    DB['settings/commerce'] = com; process.env.STRIPE_SECRET_KEY = k;
  }
  DB['admins/adm'] = { x: 1 };
  sent = [];
  const st = await ST.stripeStatus({}, ctx('adm'));
  check('stripeStatus for an admin: configured, test, reachable, no key echoed', [st.configured, st.mode, st.reachable, JSON.stringify(st).includes('offline')], [true, 'test', true, false]);

  console.log('\n== Razorpay INR path untouched ==');
  reset();
  sent = [];
  await R.razorpayCreateOrder({ planId: 'PRO', currency: 'INR' }, ctx('r1'));
  const ro = sent.find((s) => s.gw === 'rzp' && s.path === 'orders');
  check('Razorpay Pro INR still Rs 699', ro.b.amount / 100 + ' ' + ro.b.currency, '699 INR');
  check('no Stripe call on the Razorpay path', sent.some((s) => s.gw === 'stripe'), false);

  console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
