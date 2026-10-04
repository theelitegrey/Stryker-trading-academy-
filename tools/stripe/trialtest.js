#!/usr/bin/env node
// 7-day free trial: offline test (Stripe + Razorpay, card required).
//
//   node tools/stripe/trialtest.js
//
// Loads the real functions-src/trial.js, stripe.js and razorpaySubs.js against
// an in-memory Firestore and mocked Stripe / Razorpay APIs (harness copied
// from stripetest.js). Covers: eligibility rules, the site switch, the Stripe
// trial session params, webhook grant to trial_end, the $0 trial order, the
// trial_will_end reminder, conversion on day 8, card failure at trial end,
// cancel during the trial, repeat-trial attempts (same account, same card,
// same UPI handle), and the Razorpay start_at trial. Exits 1 on any failure.
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

const RS = require(FN + 'razorpaySubs');
const SUBS = require(FN + 'subscriptions');
const TR = require(FN + 'trial');
const T = TR.__trialInternals;

// Extra mock routes the trial path uses (wrapping the stripetest mock).
const CARD_FP = {};          // pm id -> card fingerprint
const RZP_PAY = {};          // razorpay payment id -> payment entity
const baseFetch = global.fetch;
global.fetch = async (url, o) => {
  if (url.startsWith('https://api.razorpay.com/v1/payments/')) {
    const id = decodeURIComponent(url.split('/payments/')[1]);
    sent.push({ gw: 'rzp', path: 'payments/' + id, b: null });
    return { ok: true, status: 200, json: async () => RZP_PAY[id] || { id } };
  }
  if (url.startsWith('https://api.stripe.com/v1/payment_methods/')) {
    const id = url.split('/payment_methods/')[1].split('?')[0];
    sent.push({ gw: 'stripe', method: o.method, path: 'payment_methods/' + id, b: {} });
    return { ok: true, status: 200, json: async () => ({ id, card: { fingerprint: CARD_FP[id] } }) };
  }
  return baseFetch(url, o);
};

// ---- fixtures (new pricing: Pro $39/mo, $349/yr) ------------------------------
const PRO = { name: 'Pro', period: 'month', price: '39' };
const PROY = { name: 'Pro', period: 'year', price: '349', hidden: true };
function reset(trialOn = true) {
  DB = {
    'settings/commerce': { usdInr: 88.2, trialEnabled: trialOn, stripeCheckout: true },
    'plans/PRO': Object.assign({}, PRO),
    'plans/PROY': Object.assign({}, PROY),
    'plans/FREE': { name: 'Starter', displayName: 'Free', period: 'month', price: '0' },
    'plans/LIFE': { name: 'Lifetime', period: 'lifetime', price: '299' },
    'coupons/HALF': { type: 'percent', value: 50, appliesToPlan: 'all' }
  };
  STRIPE_SUBS = {};
}
const ctx = (uid) => ({ auth: { uid, token: { email: 'stryker-qa-' + uid.toLowerCase() + '@example.com', name: 'U ' + uid } } });
let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label.padEnd(62) + ' ' + JSON.stringify(got) + (ok ? '' : '   (want ' + JSON.stringify(want) + ')'));
}
async function rejects(label, p, codeWant) {
  let code = 'resolved';
  try { await p; } catch (e) { code = e.code || e.message; }
  check(label, code, codeWant);
}
async function deliver(event) {
  const raw = Buffer.from(JSON.stringify(event));
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(t + '.' + raw.toString('utf8')).digest('hex');
  let status = 0, text = '';
  const res = { status(s) { status = s; return this; }, send(x) { text = x; } };
  await ST.stripeWebhook({ rawBody: raw, headers: { 'stripe-signature': 't=' + t + ',v1=' + sig } }, res);
  return status + ' ' + text;
}
let evN = 0;
const ev = (type, object) => ({ id: 'evt_t' + (++evN), type, livemode: false, data: { object } });
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
const ordersFor = (uid) => Object.entries(DB).filter(([p, v]) => p.startsWith('orders/') && v.studentUid === uid).map(([, v]) => v);
const notesFor = (uid) => Object.entries(DB).filter(([p, v]) => p.startsWith('notifications/') && v.recipientUid === uid).map(([, v]) => v);

async function stripeTrialCheckout(uid, planId = 'PRO') {
  sent = [];
  const r = await ST.stripeCreateCheckout({ planId, trial: true }, ctx(uid));
  return { r, sess: sent.find((s) => s.path === 'checkout/sessions') };
}
function trialCompleted(sessId, uid, subId, trialEnd, pm, invId) {
  STRIPE_SUBS[subId] = { id: subId, status: 'trialing', cancel_at_period_end: false, trial_end: trialEnd,
    current_period_end: trialEnd, latest_invoice: invId, default_payment_method: pm, metadata: { uid, sitePlanId: 'PRO', trial: '1' } };
  return ev('checkout.session.completed', { id: sessId, object: 'checkout.session', mode: 'subscription',
    payment_status: 'no_payment_required', client_reference_id: uid, subscription: subId, amount_total: 0,
    customer_details: { email: uid + '@example.com', name: 'U ' + uid } });
}
function invoice(id, subId, amountPaid, periodEnd, reason, attempt) {
  return { id, object: 'invoice', subscription: subId, currency: 'usd', amount_paid: amountPaid,
    billing_reason: reason, customer_email: 'x@example.com', attempt_count: attempt || 1,
    subscription_details: { metadata: {} }, lines: { data: [{ period: { start: periodEnd - 30 * DAY, end: periodEnd } }] } };
}

// Razorpay checkout signature for a subscription (payment_id|subscription_id).
const rzpSig = (pay, sub) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(pay + '|' + sub).digest('hex');
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_whsec_offline';
async function rzpHook(body) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  let status = 0, text = '';
  const res = { status(s) { status = s; return this; }, send(x) { text = x; } };
  await RS.razorpayWebhook({ rawBody: raw, body, headers: { 'x-razorpay-signature': sig } }, res);
  return status + ' ' + text;
}

(async () => {
  console.log('== Eligibility (pure rule) ==');
  const D = T.decideEligibility;
  check('new account, Pro monthly: eligible', D({}, PRO, [], Date.now()).eligible, true);
  check('trial already used', D({ trialUsedAt: 1 }, PRO, []).reason, 'trial-used');
  check('had a Stripe subscription', D({ stripeSubscriptionId: 'sub_x' }, PRO, []).reason, 'had-subscription');
  check('had a Razorpay subscription', D({ razorpaySubscriptionId: 'sub_r' }, PRO, []).reason, 'had-subscription');
  check('currently on a paid period', D({ paidThroughMillis: Date.now() + 1e7 }, PRO, [], Date.now()).reason, 'already-paid');
  check('ever paid an order (lapsed since)', D({ paidThroughMillis: 1 }, PRO, [{ finalAmount: 39 }], Date.now()).reason, 'paid-before');
  check('only a $0 coupon order: still eligible', D({}, PRO, [{ finalAmount: 0 }]).eligible, true);
  check('founding member', D({ foundingMember: true }, PRO, []).reason, 'founding-member');
  check('free plan', D({}, { period: 'month', price: '0' }, []).reason, 'plan-is-free');
  check('lifetime plan', D({}, { period: 'lifetime', price: '299' }, []).reason, 'plan-does-not-renew');

  console.log('\n== Eligibility callable + switch ==');
  reset(false);
  check('switch OFF: not eligible', (await TR.trialEligibility({ planId: 'PRO' }, ctx('e1'))).reason, 'trials-off');
  reset(true);
  check('switch ON, new member: eligible, 7 days', await TR.trialEligibility({ planId: 'PRO' }, ctx('e1')), { eligible: true, days: 7, reason: 'ok' });
  check('signed out: not eligible', (await TR.trialEligibility({ planId: 'PRO' }, {})).eligible, false);
  DB['orders/x1'] = { studentUid: 'e2', finalAmount: 39 };
  check('member with a paid order: not eligible', (await TR.trialEligibility({ planId: 'PRO' }, ctx('e2'))).reason, 'paid-before');
  DB['trialClaims/e3'] = { uid: 'e3' };
  check('member with a trial claim: not eligible', (await TR.trialEligibility({ planId: 'PRO' }, ctx('e3'))).reason, 'trial-used');
  check('unknown plan: not eligible', (await TR.trialEligibility({ planId: 'NOPE' }, ctx('e1'))).eligible, false);

  console.log('\n== Stripe: trial Checkout Session ==');
  reset(true);
  let c = await stripeTrialCheckout('s1');
  check('trial_period_days = 7', c.sess.b['subscription_data[trial_period_days]'], '7');
  check('payment_method_collection = always (card required)', c.sess.b.payment_method_collection, 'always');
  check('no card on file at trial end -> cancel', c.sess.b['subscription_data[trial_settings][end_behavior][missing_payment_method]'], 'cancel');
  check('price is the full $39/month', [sent.find((s) => s.path === 'prices').b.unit_amount, sent.find((s) => s.path === 'prices').b['recurring[interval]']], ['3900', 'month']);
  check('returns trial:true, $0 today, $39 renew', [c.r.trial, c.r.amountCents, c.r.renewCents], [true, 0, 3900]);
  check('success url marks trial', /trial=1&stripe=success/.test(c.sess.b.success_url), true);
  sent = [];
  const plain = await ST.stripeCreateCheckout({ planId: 'PRO' }, ctx('s1'));
  const ps = sent.find((s) => s.path === 'checkout/sessions');
  check('no trial asked: no trial params (regression)', [ps.b['subscription_data[trial_period_days]'], ps.b.payment_method_collection, plain.trial], [undefined, undefined, false]);
  c = await stripeTrialCheckout('s1', 'PROY');
  check('yearly: trial on $349/year price', [c.sess.b['subscription_data[trial_period_days]'], sent.find((s) => s.path === 'prices').b.unit_amount], ['7', '34900']);
  await rejects('trial + coupon refused', ST.stripeCreateCheckout({ planId: 'PRO', trial: true, couponCode: 'HALF' }, ctx('s1')), 'failed-precondition');
  DB['settings/commerce'].trialEnabled = false;
  await rejects('switch OFF: trial checkout refused (client cannot force it)', ST.stripeCreateCheckout({ planId: 'PRO', trial: true }, ctx('s9')), 'failed-precondition');
  DB['settings/commerce'].trialEnabled = true;
  DB['orders/p1'] = { studentUid: 's2', finalAmount: 39 };
  await rejects('member who paid before: trial refused', ST.stripeCreateCheckout({ planId: 'PRO', trial: true }, ctx('s2')), 'failed-precondition');

  console.log('\n== Stripe webhook: trial start ==');
  reset(true);
  c = await stripeTrialCheckout('s3');
  const te = nowS() + 7 * DAY;
  CARD_FP.pm_a = 'fp_card_A';
  check('checkout.session.completed (trialing) accepted', await deliver(trialCompleted(c.r.sessionId, 's3', 'sub_t1', te, 'pm_a', 'in_t0')), '200 ok');
  let st = DB['students/s3'];
  check('Pro granted until trial_end', [st.plan, st.paidThroughMillis], ['Pro', te * 1000]);
  check('status trialing, autopay on, provider stripe', [st.subscriptionStatus, st.subscriptionAutopay, st.billingProvider], ['trialing', true, 'stripe']);
  check('trialUsedAt + trialEndsAt recorded', [!!st.trialUsedAt, st.trialEndsAt], [true, te * 1000]);
  let o = ordersFor('s3');
  check('one $0 order, kind trial', o.map((x) => [x.finalAmount, x.kind, x.gateway]), [[0, 'trial', 'stripe']]);
  check('trial claim + card fingerprint claimed', [!!DB['trialClaims/s3'], !!DB['trialFingerprints/' + T.fingerprintId('card', 'fp_card_A')]], [true, true]);
  check('Stripe customer marked trialUsedAt', sent.some((s) => /^customers\/cus_/.test(s.path) && s.b['metadata[trialUsedAt]']), true);
  check('no founding price recorded for a trial', !!DB['foundingPrices/s3'], false);
  await LS.launchSaleOnOrder().catch(() => {});
  check('$0 trial order does not take a launch seat', ((DB['settings/commerce'].launchSale || {}).taken || 0), 0);
  check('$0 trial invoice.paid grants nothing extra', await deliver(ev('invoice.paid', invoice('in_t0', 'sub_t1', 0, te, 'subscription_create'))), '200 ok');
  check('still one order, still to trial_end', [ordersFor('s3').length, DB['students/s3'].paidThroughMillis], [1, te * 1000]);
  check('re-delivered completion: no second grant', await deliver(trialCompleted(c.r.sessionId, 's3', 'sub_t1', te, 'pm_a', 'in_t0')), '200 ok');
  check('still one order', ordersFor('s3').length, 1);
  check('now ineligible for another trial', (await TR.trialEligibility({ planId: 'PRO' }, ctx('s3'))).eligible, false);

  console.log('\n== Stripe: reminder, conversion, failure, cancel ==');
  check('trial_will_end -> in-app notification', await deliver(ev('customer.subscription.trial_will_end', STRIPE_SUBS.sub_t1)), '200 ok');
  let n = notesFor('s3').filter((x) => x.type === 'trial_ending');
  check('reminder says date, $39 per month, how to cancel', n.length === 1 && /ends on \d{4}-\d{2}-\d{2}.*\$39 per month.*cancel/.test(n[0].message), true);
  await deliver(ev('customer.subscription.trial_will_end', STRIPE_SUBS.sub_t1));
  check('reminder sent once', notesFor('s3').filter((x) => x.type === 'trial_ending').length, 1);
  const pe2 = te + 30 * DAY;
  check('day 8: invoice.paid $39 (subscription_cycle)', await deliver(ev('invoice.paid', invoice('in_t1', 'sub_t1', 3900, pe2, 'subscription_cycle'))), '200 ok');
  st = DB['students/s3'];
  check('converted: paid through +1 month, status active', [st.paidThroughMillis, st.subscriptionStatus], [pe2 * 1000, 'active']);
  check('converted: $39 order written', ordersFor('s3').map((x) => x.finalAmount), [0, 39]);
  check('conversion message (not "renewed")', notesFor('s3').some((x) => x.type === 'renewal_charged' && /free trial has ended/.test(x.message)), true);

  // card fails at trial end
  reset(true);
  c = await stripeTrialCheckout('s4');
  CARD_FP.pm_b = 'fp_card_B';
  await deliver(trialCompleted(c.r.sessionId, 's4', 'sub_t2', te, 'pm_b', 'in_u0'));
  check('card fails at trial end: recorded', await deliver(ev('invoice.payment_failed', invoice('in_u1', 'sub_t2', 0, te + 30 * DAY, 'subscription_cycle'))), '200 ok');
  check('access NOT extended past trial_end', DB['students/s4'].paidThroughMillis, te * 1000);
  check('member told (trial-ended wording)', notesFor('s4').some((x) => x.type === 'payment_failed' && /free trial/.test(x.message)), true);
  const inGrace = SUBS.__internals.decide({ plan: 'Pro', paidThroughMillis: te * 1000 }, { period: 'month', price: 39 }, te * 1000 + DAY * 1000);
  const after = SUBS.__internals.decide({ plan: 'Pro', paidThroughMillis: te * 1000 }, { period: 'month', price: 39 }, te * 1000 + 4 * DAY * 1000);
  check('sweep: grace 1 day after, lapses after 3-day grace', [inGrace.action, after.action], ['grace', 'expire']);

  // cancel during trial (portal cancel_at_period_end)
  STRIPE_SUBS.sub_t2.cancel_at_period_end = true;
  check('cancel in trial -> subscription.updated', await deliver(ev('customer.subscription.updated', STRIPE_SUBS.sub_t2)), '200 ok');
  check('autopay off, access still to trial_end', [DB['students/s4'].subscriptionAutopay, DB['students/s4'].paidThroughMillis], [false, te * 1000]);
  check('no charge order written for the cancel', ordersFor('s4').map((x) => x.finalAmount), [0]);
  check('trialCancelledAt stamped', !!DB['students/s4'].trialCancelledAt, true);
  const cs = Object.assign({}, DB['students/s4'], { plan: 'Pro' });
  check('sweep: cancelled trial lapses right after trial_end (no grace)',
    SUBS.__internals.decide(cs, { period: 'month', price: 39 }, te * 1000 + 3600e3).action, 'expire');
  check('sweep: cancelled trial untouched before trial_end',
    SUBS.__internals.decide(cs, { period: 'month', price: 39 }, te * 1000 - 5 * DAY * 1000).action, 'none');
  check('cancelled: no trial_will_end reminder', await deliver(ev('customer.subscription.trial_will_end', STRIPE_SUBS.sub_t2)).then(() => notesFor('s4').filter((x) => x.type === 'trial_ending').length), 0);

  console.log('\n== Repeat-trial attempts ==');
  // same card on another account
  c = await stripeTrialCheckout('s5');
  CARD_FP.pm_c = 'fp_card_B';   // same card as s4
  sent = [];
  check('second account, SAME card: webhook ok', await deliver(trialCompleted(c.r.sessionId, 's5', 'sub_t3', te, 'pm_c', 'in_v0')), '200 ok');
  check('subscription cancelled at Stripe (DELETE)', sent.some((s) => s.method === 'DELETE' && s.path === 'subscriptions/sub_t3'), true);
  check('no plan granted, no order', [!!(DB['students/s5'] && DB['students/s5'].plan), ordersFor('s5').length], [false, 0]);
  check('member told the trial was refused', notesFor('s5').some((x) => x.type === 'trial_refused'), true);
  check('that account cannot retry a trial with another card', (await TR.trialEligibility({ planId: 'PRO' }, ctx('s5'))).eligible, false);
  sent = [];
  const paidAfter = await ST.stripeCreateCheckout({ planId: 'PRO' }, ctx('s5'));
  check('...but can still subscribe paid', !!paidAfter.url, true);
  // same account, two sessions opened before either completed
  reset(true);
  const c1 = await stripeTrialCheckout('s6');
  const c2 = await stripeTrialCheckout('s6');
  CARD_FP.pm_d = 'fp_D'; CARD_FP.pm_e = 'fp_E';
  await deliver(trialCompleted(c1.r.sessionId, 's6', 'sub_t4', te, 'pm_d', 'in_w0'));
  sent = [];
  await deliver(trialCompleted(c2.r.sessionId, 's6', 'sub_t5', te, 'pm_e', 'in_x0'));
  check('two trial sessions, same account: 2nd cancelled', sent.some((s) => s.method === 'DELETE' && s.path === 'subscriptions/sub_t5'), true);
  check('only one trial order', ordersFor('s6').length, 1);
  check('student still on the first subscription', DB['students/s6'].stripeSubscriptionId, 'sub_t4');

  console.log('\n== Razorpay (INR): trial with start_at ==');
  reset(true);
  sent = [];
  const t0 = Date.now();
  const rs = await RS.razorpaySubscribe({ planId: 'PRO', currency: 'INR', trial: true }, ctx('r1'));
  const subCall = sent.find((s) => s.gw === 'rzp' && s.path === 'subscriptions');
  check('start_at ~ now + 7 days', Math.abs(subCall.b.start_at - Math.floor((t0 + 7 * DAY * 1000) / 1000)) <= 2, true);
  check('expire_by set (authorise now)', subCall.b.expire_by > nowS() && subCall.b.expire_by <= nowS() + 7200, true);
  check('INR amount = round(39 x 88.2) = Rs 3440', rs.amountMinor, 344000);
  check('callable returns trial + trialEndMillis', [rs.trial, Math.abs(rs.trialEndMillis - (t0 + 7 * DAY * 1000)) < 2000], [true, true]);
  sent = [];
  await RS.razorpaySubscribe({ planId: 'PRO', currency: 'INR' }, ctx('r1'));
  check('no trial asked: no start_at (regression)', sent.find((s) => s.path === 'subscriptions').b.start_at, undefined);
  DB['settings/commerce'].trialEnabled = false;
  await rejects('switch OFF: Razorpay trial refused', RS.razorpaySubscribe({ planId: 'PRO', currency: 'INR', trial: true }, ctx('r9')), 'failed-precondition');
  DB['settings/commerce'].trialEnabled = true;

  RZP_PAY.pay_auth1 = { id: 'pay_auth1', amount: 500, vpa: 'r1@okaxis', customer_id: 'cust_1' };
  const v = await RS.razorpaySubsVerify({ subscriptionId: rs.subscriptionId, paymentId: 'pay_auth1', signature: rzpSig('pay_auth1', rs.subscriptionId) }, ctx('r1'));
  check('verify (auth payment): ok, trial', [v.ok, v.trial], [true, true]);
  let r1 = DB['students/r1'];
  check('Pro to trial end, trialing, autopay on', [r1.plan, r1.paidThroughMillis === rs.trialEndMillis, r1.subscriptionStatus, r1.subscriptionAutopay], ['Pro', true, 'trialing', true]);
  check('$0 trial order (not the Rs 5 auth)', ordersFor('r1').map((x) => [x.finalAmount, x.kind, x.currency]), [[0, 'trial', 'INR']]);
  check('UPI handle fingerprint claimed', !!DB['trialFingerprints/' + T.fingerprintId('vpa', 'r1@okaxis')], true);
  check('webhook subscription.authenticated after verify: no double grant',
    await rzpHook({ event: 'subscription.authenticated', payload: { subscription: { entity: { id: rs.subscriptionId, status: 'authenticated' } }, payment: { entity: { id: 'pay_auth1' } } } }), '200 ok');
  check('still one order', ordersFor('r1').length, 1);
  // day 8 charge
  check('day 8: subscription.charged Rs 3440 captured',
    await rzpHook({ event: 'subscription.charged', payload: { subscription: { entity: { id: rs.subscriptionId } }, payment: { entity: { id: 'pay_c1', amount: 344000, status: 'captured' } } } }), '200 ok');
  r1 = DB['students/r1'];
  check('converted: one month past trial end, active', [r1.paidThroughMillis === SUBS.__internals.extendPeriod(rs.trialEndMillis, 'month'), r1.subscriptionStatus], [true, 'active']);
  check('orders: 0 then 3440', ordersFor('r1').map((x) => x.finalAmount), [0, 3440]);
  check('conversion message', notesFor('r1').some((x) => /free trial has ended/.test(x.message)), true);

  console.log('\n== Razorpay: webhook-only start, cancel, failure, repeat ==');
  const rs2 = await RS.razorpaySubscribe({ planId: 'PRO', currency: 'INR', trial: true }, ctx('r2'));
  RZP_PAY.pay_auth2 = { id: 'pay_auth2', vpa: 'r2@okhdfc' };
  check('browser lost: subscription.authenticated starts trial',
    await rzpHook({ event: 'subscription.authenticated', payload: { subscription: { entity: { id: rs2.subscriptionId } }, payment: { entity: { id: 'pay_auth2' } } } }), '200 ok');
  check('granted via webhook', [DB['students/r2'].plan, DB['students/r2'].subscriptionStatus], ['Pro', 'trialing']);
  sent = [];
  await RS.razorpaySubsCancel({}, ctx('r2'));
  const cancelCall = sent.find((s) => s.gw === 'rzp' && /cancel$/.test(s.path));
  check('cancel during trial: immediate (cancel_at_cycle_end 0)', cancelCall.b.cancel_at_cycle_end, 0);
  check('access stays to trial end, autopay off', [DB['students/r2'].paidThroughMillis === rs2.trialEndMillis, DB['students/r2'].subscriptionAutopay], [true, false]);
  check('trialCancelledAt stamped (Razorpay)', !!DB['students/r2'].trialCancelledAt, true);
  // failed debit on day 8 -> halted
  const rs3 = await RS.razorpaySubscribe({ planId: 'PRO', currency: 'INR', trial: true }, ctx('r3'));
  RZP_PAY.pay_auth3 = { id: 'pay_auth3', vpa: 'r3@ybl' };
  await RS.razorpaySubsVerify({ subscriptionId: rs3.subscriptionId, paymentId: 'pay_auth3', signature: rzpSig('pay_auth3', rs3.subscriptionId) }, ctx('r3'));
  check('day-8 debit fails -> subscription.halted',
    await rzpHook({ event: 'subscription.halted', payload: { subscription: { entity: { id: rs3.subscriptionId, status: 'halted' } } } }), '200 ok');
  check('autopay off, access not extended past trial end', [DB['students/r3'].subscriptionAutopay, DB['students/r3'].paidThroughMillis === rs3.trialEndMillis], [false, true]);
  check('failed (non-captured) charge never extends',
    await rzpHook({ event: 'subscription.charged', payload: { subscription: { entity: { id: rs3.subscriptionId } }, payment: { entity: { id: 'pay_f', amount: 344000, status: 'failed' } } } }), '200 not captured');
  // same UPI handle on a new account
  const rs4 = await RS.razorpaySubscribe({ planId: 'PRO', currency: 'INR', trial: true }, ctx('r4'));
  RZP_PAY.pay_auth4 = { id: 'pay_auth4', vpa: 'R1@okaxis' };   // r1's handle, other case
  sent = [];
  await rejects('new account, SAME UPI handle: verify refuses', RS.razorpaySubsVerify({ subscriptionId: rs4.subscriptionId, paymentId: 'pay_auth4', signature: rzpSig('pay_auth4', rs4.subscriptionId) }, ctx('r4')), 'failed-precondition');
  check('Razorpay subscription cancelled immediately', sent.some((s) => s.gw === 'rzp' && s.path === 'subscriptions/' + rs4.subscriptionId + '/cancel' && s.b.cancel_at_cycle_end === 0), true);
  check('no plan, no order for r4', [!!(DB['students/r4'] && DB['students/r4'].plan), ordersFor('r4').length], [false, 0]);
  await rejects('r1 asks for a second trial: refused at subscribe', RS.razorpaySubscribe({ planId: 'PRO', currency: 'INR', trial: true }, ctx('r1')), 'failed-precondition');
  await rejects('verify by another uid refused', RS.razorpaySubsVerify({ subscriptionId: rs.subscriptionId, paymentId: 'pay_auth1', signature: rzpSig('pay_auth1', rs.subscriptionId) }, ctx('zz')), 'permission-denied');

  console.log('\n== Sweep reminder for a Razorpay trial ==');
  reset(true);
  const endMs = Date.now() + 2 * DAY * 1000;
  DB['students/w1'] = { plan: 'Pro', planId: 'PRO', paidThroughMillis: endMs, subscriptionStatus: 'trialing', subscriptionAutopay: true, trialProvider: 'razorpay' };
  DB['students/w2'] = { plan: 'Pro', planId: 'PRO', paidThroughMillis: endMs, subscriptionStatus: 'trialing', subscriptionAutopay: true, trialProvider: 'stripe' };
  await SUBS.subscriptionSweep();
  check('razorpay trial: "you will be charged unless you cancel"', notesFor('w1').map((x) => x.type), ['trial_ending']);
  check('stripe trial: sweep stays quiet (Stripe event does it)', notesFor('w2').length, 0);
  check('status kept trialing', DB['students/w1'].subscriptionStatus, 'trialing');

  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
