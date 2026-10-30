#!/usr/bin/env node
// Creator payments (Stripe Connect): offline test.
//
//   node tools/creator-pay/paytest.js
//
// Loads the real functions-src/creatorPay.js against an in-memory Firestore and a mocked Stripe API (every call is
// recorded with its Stripe-Account header). Feeds the webhook with SIGNED fixture events (same HMAC Stripe uses) and
// checks: the switch/gate, onboarding (controller properties, India / unsupported country, rules tick), direct charges
// on the creator's account, the fee setting (0 = no fee param; 10 = fee sent), price/trial limits, membership grant,
// renewal, failure + 3-day grace, cancel, delete, refund, dispute, account.updated, idempotency, signature refusal,
// missing secret refusal, wrong-account events, admin suspend + list. Nothing touches the network. Exits 1 on failure.
'use strict';
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

// ---- in-memory Firestore --------------------------------------------------------------------------------------
let DB = {}, autoId = 0, clk = 1000;
const INC = Symbol('inc');
function applyVal(cur, v) {
  if (v && v[INC] !== undefined) return (cur || 0) + v[INC];
  return v;
}
function merge(a, b) {
  const o = Object.assign({}, a);
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && v[INC] === undefined && !(v instanceof TS) && a && a[k] && typeof a[k] === 'object' && !(a[k] instanceof TS)) o[k] = merge(a[k], v);
    else o[k] = applyVal(a && a[k], v);
  }
  return o;
}
class TS { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } toDate() { return new Date(this.ms); } }
const snapOf = (p) => ({ id: p.split('/').pop(), ref: docRef(p), exists: p in DB, data: () => DB[p] });
function docRef(p) {
  return {
    path: p, id: p.split('/').pop(),
    collection: (c) => col(p + '/' + c),
    get: async () => snapOf(p),
    set: async (v, o) => { DB[p] = (o && o.merge) ? merge(DB[p] || {}, v) : merge({}, v); },
    update: async (v) => { if (!(p in DB)) throw new Error('NOT_FOUND ' + p); DB[p] = merge(DB[p], v); },
    create: async (v) => { if (p in DB) { const e = new Error('6 ALREADY_EXISTS'); e.code = 6; throw e; } DB[p] = merge({}, v); }
  };
}
function query(c, f, lim) {
  return {
    where: (a, op, v) => query(c, f.concat([[a, op, v]]), lim),
    limit: (n) => query(c, f, n),
    get: async () => {
      const depth = c.split('/').length + 1;
      let docs = Object.keys(DB).filter((p) => p.startsWith(c + '/') && p.split('/').length === depth)
        .filter((p) => f.every(([a, op, v]) => DB[p][a] === v)).map(snapOf);
      if (lim) docs = docs.slice(0, lim);
      return { empty: !docs.length, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
    }
  };
}
function col(c) { return Object.assign(query(c, []), { doc: (id) => docRef(c + '/' + id), add: async (v) => { const p = c + '/auto' + (++autoId); DB[p] = v; return docRef(p); } }); }
const fakeDb = {
  collection: col,
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v, o) => { r.set(v, o); }, update: (r, v) => { r.update(v); } })
};
const FieldValue = { serverTimestamp: () => ++clk, increment: (n) => ({ [INC]: n }) };
const admin = { apps: [1], initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue, Timestamp: { fromMillis: (ms) => new TS(ms), now: () => new TS(Date.now()) } }) };
class HttpsError extends Error { constructor(c, m) { super(c + ': ' + m); this.code = c; this.msg = m; } }
const fx = { https: { onCall: (f) => f, onRequest: (f) => f, HttpsError }, runWith() { return this; },
  firestore: { document: () => ({ onCreate: (f) => f, onWrite: (f) => f }) }, pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (f) => f }), onRun: (f) => f }) } };
const origLoad = Module._load;
Module._load = function (r, ...a) { if (r === 'firebase-admin') return admin; if (r === 'firebase-functions') return fx; return origLoad.call(this, r, ...a); };

// ---- mocked Stripe --------------------------------------------------------------------------------------------
let CALLS = [], ACCOUNTS = {}, SUBS = {}, FAILNEXT = null, seq = 0;
const nid = (p) => p + '_' + (++seq);
function parseForm(body) {
  const o = {};
  for (const kv of String(body || '').split('&').filter(Boolean)) { const [k, v] = kv.split('='); o[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
  return o;
}
const PERIOD = 30 * 86400;
const V2CALLS = [];
global.fetch = async (url, init) => {
  const u = new URL(url), isV2 = /\/v2\//.test(u.pathname), p = u.pathname.replace(/^\/v[12]\//, ''), m = isV2 ? 'V2' + init.method : init.method;
  if (isV2) init.json = JSON.parse(init.body);
  const f = isV2 ? {} : parseForm(init.body);
  const acct = init.headers['Stripe-Account'] || null;
  CALLS.push({ m, p, f, acct, idem: init.headers['Idempotency-Key'] || null });
  const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  const bad = (s, msg) => ({ ok: false, status: s, json: async () => ({ error: { type: 'invalid_request_error', message: msg } }) });
  if (FAILNEXT && FAILNEXT.test(m + ' ' + p)) { FAILNEXT = null; return bad(400, 'mock failure'); }
  if (m === 'POST' && p === 'accounts') return bad(400, 'Stripe no longer recommends Accounts v1 for new Connect integrations. Create connected accounts with POST /v2/core/accounts instead.');
  if (m === 'V2POST' && p === 'core/accounts') {
    const id = nid('acct'), f = init.json;
    V2CALLS.push(f);
    ACCOUNTS[id] = { id, country: f.identity.country, charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: ['external_account', 'individual.dob.day'], past_due: [], pending_verification: [], errors: [], disabled_reason: 'requirements.past_due' } };
    return ok(ACCOUNTS[id]);
  }
  if (m === 'GET' && /^accounts\/acct_/.test(p)) return ok(ACCOUNTS[p.split('/')[1]]);
  if (m === 'POST' && p === 'account_links') return ok({ url: 'https://connect.stripe.com/setup/s/' + f.account });
  if (m === 'POST' && /login_links$/.test(p)) return bad(400, 'not an express account');
  if (m === 'POST' && p === 'products') return ok({ id: nid('prod') });
  if (m === 'POST' && p === 'prices') return ok({ id: nid('price') });
  if (m === 'POST' && p === 'customers') return ok({ id: nid('cus') });
  if (m === 'POST' && p === 'checkout/sessions') return ok({ id: nid('cs_test'), url: 'https://checkout.stripe.com/c/pay/x' });
  if (m === 'GET' && /^subscriptions\//.test(p)) return ok(SUBS[p.split('/')[1]]);
  if (m === 'POST' && /^subscriptions\//.test(p)) { const s = SUBS[p.split('/')[1]]; s.cancel_at_period_end = f.cancel_at_period_end === 'true'; return ok(s); }
  if (m === 'DELETE' && /^subscriptions\//.test(p)) { const s = SUBS[p.split('/')[1]]; s.status = 'canceled'; return ok(s); }
  if (m === 'POST' && p === 'billing_portal/sessions') return f.configuration || acct === 'acct_hascfg' ? ok({ url: 'https://billing.stripe.com/p/session/x' }) : bad(400, 'No configuration provided');
  if (m === 'POST' && p === 'billing_portal/configurations') return ok({ id: nid('bpc') });
  if (m === 'GET' && /^charges\//.test(p)) return ok(CHARGES[p.split('/')[1]]);
  return bad(404, 'mock: unhandled ' + m + ' ' + p);
};
const CHARGES = {};

process.env.STRIPE_SECRET_KEY = 'sk_test_offline_mock';
const WHSEC = 'whsec_offline_' + crypto.randomBytes(6).toString('hex');
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WHSEC;

const FN = path.join(__dirname, '../../functions-src/');
const CP = require(FN + 'creatorPay');
const I = CP.__creatorPayInternals;

// ---- harness --------------------------------------------------------------------------------------------------
let pass = 0, failN = 0;
function ok(cond, name, extra) { if (cond) pass++; else { failN++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } }
async function throws(fn, code, name, msgRe) {
  try { await fn(); ok(false, name + ' (no throw)'); }
  catch (e) { ok(e.code === code && (!msgRe || msgRe.test(e.msg || e.message)), name, { code: e.code, msg: e.msg || e.message }); }
}
const ctx = (uid, email) => ({ auth: { uid, token: { email: email || uid + '@example.com', name: uid } } });
const call = (uid, data, email) => CP.creatorPay(data, ctx(uid, email));
function signed(evt, secret, t) {
  const raw = JSON.stringify(evt); t = t || Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret || WHSEC).update(t + '.' + raw).digest('hex');
  return { raw: Buffer.from(raw), header: 't=' + t + ',v1=' + sig };
}
async function hook(evt, opt) {
  opt = opt || {};
  const s = signed(evt, opt.secret, opt.t);
  let code = 0, body = '';
  const res = { status(c) { code = c; return this; }, send(b) { body = b; return this; } };
  await CP.creatorConnectWebhook({ rawBody: s.raw, headers: { 'stripe-signature': 'header' in opt ? opt.header : s.header } }, res);
  return { code, body, result: DB['creatorEvents/' + evt.id] && DB['creatorEvents/' + evt.id].result };
}
let evN = 0;
const ev = (type, obj, account) => ({ id: 'evt_' + (++evN), type, account, livemode: false, data: { object: obj } });

function seed() {
  DB = {}; CALLS = []; V2CALLS.length = 0; ACCOUNTS = {}; SUBS = {}; seq = 0;
  DB['admins/tz'] = {};
  DB['settings/commerce'] = { creatorPayments: false, creatorFeePct: 0 };
  DB['communities/alpha-desk'] = { ownerUid: 'ana', ownerName: 'Ana', name: 'Alpha Desk', slug: 'alpha-desk', status: 'active', visibility: 'public', memberCount: 1, refundRule: '7 days, no questions asked.' };
  DB['communities/alpha-desk/members/ana'] = { uid: 'ana', role: 'owner', status: 'active', source: 'owner' };
  DB['communities/alpha-desk/plans/p1'] = { name: 'Pro', status: 'live', joinMode: 'open', price: { amount: 29, currency: 'USD', interval: 'month' }, trialDays: 0, order: 0 };
  DB['communities/alpha-desk/plans/p2'] = { name: 'Lifetime', status: 'live', joinMode: 'open', price: { amount: 199, currency: 'USD', interval: 'lifetime' }, trialDays: 0, order: 1 };
  DB['communities/alpha-desk/plans/p3'] = { name: 'Yearly', status: 'live', joinMode: 'open', price: { amount: 290, currency: 'USD', interval: 'year' }, trialDays: 7, order: 2 };
  DB['communities/alpha-desk/plans/p4'] = { name: 'Huge', status: 'live', joinMode: 'open', price: { amount: 5000, currency: 'USD', interval: 'month' }, trialDays: 0, order: 3 };
  DB['communities/alpha-desk/plans/p5'] = { name: 'Rupee', status: 'live', joinMode: 'open', price: { amount: 500, currency: 'INR', interval: 'month' }, trialDays: 0, order: 4 };
  DB['communities/alpha-desk/plans/p6'] = { name: 'Weekly', status: 'live', joinMode: 'open', price: { amount: 5, currency: 'USD', interval: 'week' }, trialDays: 0, order: 5 };
  DB['communities/alpha-desk/plans/p7'] = { name: 'Draft', status: 'draft', joinMode: 'open', price: { amount: 9, currency: 'USD', interval: 'month' }, trialDays: 0, order: 6 };
  DB['communities/beta/members/bo'] = { uid: 'bo', role: 'owner' };
  DB['communities/beta'] = { ownerUid: 'bo', ownerName: 'Bo', name: 'Beta', status: 'active', visibility: 'public', memberCount: 1 };
}
const lastCall = (re) => CALLS.filter((c) => re.test(c.m + ' ' + c.p)).pop();
const QA = 'stryker-qa-buyer1@example.com';
const QA2 = 'stryker-qa-creator@example.com';

(async () => {
  // ---------------------------------------------------------------------- pure helpers
  ok(I.feePctOf({ creatorFeePct: 0 }) === 0 && I.feePctOf({}) === 0 && I.feePctOf({ creatorFeePct: 10 }) === 10 && I.feePctOf({ creatorFeePct: 80 }) === 0 && I.feePctOf({ creatorFeePct: 'x' }) === 0, 'feePctOf bounds');
  ok(I.accountState({ id: 'a', charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: {} }).status === 'active', 'state active');
  ok(I.accountState({ id: 'a', details_submitted: false, requirements: { currently_due: ['x'] } }).status === 'incomplete', 'state incomplete');
  ok(I.accountState({ id: 'a', details_submitted: true, requirements: { disabled_reason: 'requirements.pending_verification', pending_verification: ['id'] } }).status === 'pending', 'state pending');
  ok(I.accountState({ id: 'a', details_submitted: true, requirements: { disabled_reason: 'requirements.past_due', past_due: ['dob'] } }).status === 'restricted', 'state restricted');
  ok(I.accountState({ id: 'a', details_submitted: true, requirements: { disabled_reason: 'rejected.fraud' } }).status === 'disabled', 'state disabled');
  // client country list matches server list
  const cfgSrc = require('fs').readFileSync(path.join(__dirname, '../../assets/creator-config.js'), 'utf8');
  const mm = cfgSrc.match(/PAYOUT_COUNTRIES:\s*\[([^\]]*)\]/);
  const clientList = mm ? mm[1].match(/'([A-Z]{2})'/g).map((x) => x.slice(1, 3)) : [];
  ok(JSON.stringify(clientList.slice().sort()) === JSON.stringify(I.PAYOUT_COUNTRIES.slice().sort()), 'creator-config PAYOUT_COUNTRIES == server list', clientList.length);
  ok(I.PAYOUT_COUNTRIES.indexOf('IN') < 0, 'India not in payout countries');

  // ---------------------------------------------------------------------- gate (switch off)
  seed();
  await throws(() => call('ana', { action: 'onboard', cid: 'alpha-desk', country: 'US', agree: true }), 'failed-precondition', 'switch off: creator refused', /opens soon/);
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }), 'failed-precondition', 'switch off: buyer refused', /opens soon/);
  DB['settings/commerce'].creatorPayments = true;
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }), 'failed-precondition', 'test key + switch on: real user still refused', /opens soon/);
  DB['settings/commerce'].creatorPayments = false;
  const st0 = await call('ana', { action: 'status' });
  ok(st0.account.status === 'none' && st0.countries.length > 10, 'status works with switch off (no money moves)');
  await throws(() => call('ana', { action: 'adminList' }), 'permission-denied', 'adminList: non-admin refused');
  await throws(() => call('ana', { action: 'suspend', cid: 'alpha-desk', suspend: true }), 'permission-denied', 'suspend: non-admin refused');
  await throws(() => CP.creatorPay({ action: 'status' }, {}), 'unauthenticated', 'signed out refused');
  await throws(() => call('ana', { action: 'nope' }), 'invalid-argument', 'unknown action refused');

  // ---------------------------------------------------------------------- onboarding (QA creator)
  DB['communities/alpha-desk'].ownerUid = 'ana';
  await throws(() => call('ana', { action: 'onboard', cid: 'alpha-desk', country: 'US', agree: false }, QA2), 'failed-precondition', 'onboard: rules not ticked', /Creator Rules/);
  await throws(() => call('ana', { action: 'onboard', cid: 'alpha-desk', country: 'IN', agree: true }, QA2), 'failed-precondition', 'onboard: India refused with honest text', /India/);
  await throws(() => call('ana', { action: 'onboard', cid: 'alpha-desk', country: 'ZZ', agree: true }, QA2), 'failed-precondition', 'onboard: unsupported country', /country yet/);
  await throws(() => call('ana', { action: 'onboard', cid: 'beta', country: 'US', agree: true }, QA2), 'permission-denied', 'onboard: not my community');
  ok(!V2CALLS.length && !CALLS.some((c) => c.p === 'accounts'), 'no Stripe account created by refused onboards');
  const ob = await call('ana', { action: 'onboard', cid: 'alpha-desk', country: 'US', agree: true }, QA2);
  const ac = V2CALLS[V2CALLS.length - 1];
  ok(ac && ac.dashboard === 'full' && ac.defaults.responsibilities.fees_collector === 'stripe' && ac.defaults.responsibilities.losses_collector === 'stripe', 'v2 account: dashboard full, Stripe collects fees + losses (platform not liable)', ac);
  ok(ac && ac.configuration.merchant.capabilities.card_payments.requested === true && ac.metadata.uid === 'ana' && ac.identity.country === 'US' && ac.contact_email === QA2, 'v2 account: merchant card_payments, country, contact_email, metadata');
  ok(/connect\.stripe\.com/.test(ob.url), 'onboard returns Stripe-hosted link');
  const al = lastCall(/account_links/);
  ok(al && /\/creator\?c=alpha-desk/.test(al.f.return_url) && /payouts=refresh/.test(al.f.refresh_url) && al.f.type === 'account_onboarding', 'account link return/refresh URLs');
  const acctId = DB['creatorAccounts/ana'].acct;
  ok(DB['creatorAccounts/ana'].status === 'incomplete' && DB['creatorAccounts/ana'].live === false && DB['creatorAccounts/ana'].rulesVersion, 'creatorAccounts record incomplete + rules stamp');
  ok(DB['communities/alpha-desk'].sellerReady === false && DB['communities/alpha-desk'].sellerStatus === 'incomplete', 'community mirrors seller status');
  const n0 = V2CALLS.length;
  await call('ana', { action: 'onboard', cid: 'alpha-desk', country: 'US', agree: true }, QA2);
  ok(V2CALLS.length === n0, 'second onboard reuses the account (new link only)');
  const dsh = await call('ana', { action: 'dashboard' }, QA2);
  ok(/dashboard\.stripe\.com\/test/.test(dsh.url), 'dashboard: full-dashboard account -> stripe.com dashboard');

  // buyer cannot buy while creator not active
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, QA), 'failed-precondition', 'checkout: seller not active', /can't take payments/);

  // account.updated -> pending -> active
  ACCOUNTS[acctId] = Object.assign(ACCOUNTS[acctId], { details_submitted: true, requirements: { currently_due: [], past_due: [], pending_verification: ['individual.verification.document'], disabled_reason: 'requirements.pending_verification', errors: [] } });
  let r = await hook(ev('account.updated', ACCOUNTS[acctId], acctId));
  ok(r.code === 200 && DB['creatorAccounts/ana'].status === 'pending', 'account.updated -> pending', r);
  ACCOUNTS[acctId] = Object.assign(ACCOUNTS[acctId], { charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [], past_due: [], pending_verification: [], errors: [], disabled_reason: null } });
  r = await hook(ev('account.updated', ACCOUNTS[acctId], acctId));
  ok(DB['creatorAccounts/ana'].status === 'active' && DB['communities/alpha-desk'].sellerReady === true, 'account.updated -> active, community sellerReady', r);
  r = await hook(ev('account.updated', { id: 'acct_stranger', charges_enabled: true }, 'acct_stranger'));
  ok(r.result === 'unknown account', 'account.updated for an account we did not create: ignored', r);

  // ---------------------------------------------------------------------- checkout
  await throws(() => call('ana', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, QA2), 'failed-precondition', 'checkout: own community');
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p4' }, QA), 'failed-precondition', 'checkout: $5000 above $999', /\$1 to \$999/);
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p5' }, QA), 'failed-precondition', 'checkout: INR refused', /US dollars/);
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p6' }, QA), 'failed-precondition', 'checkout: weekly refused');
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p7' }, QA), 'not-found', 'checkout: draft plan');
  await throws(() => call('zed', { action: 'checkout', cid: 'Bad Slug', planId: 'p1' }, QA), 'invalid-argument', 'checkout: bad cid');
  DB['communities/alpha-desk'].refundRule = '';
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, QA), 'failed-precondition', 'checkout: no refund rule set', /refund rule/);
  DB['communities/alpha-desk'].refundRule = '7 days, no questions asked.';

  const co = await call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, QA);
  const cs = lastCall(/checkout\/sessions/);
  ok(cs.acct === acctId && cs.f.mode === 'subscription' && cs.f.client_reference_id === 'zed', 'monthly: session ON creator account (direct charge)', cs);
  ok(!('subscription_data[application_fee_percent]' in cs.f), 'monthly: fee 0 -> no application_fee_percent sent');
  ok(/Refunds: ask the creator first; their refund rule: 7 days/.test(cs.f['custom_text[submit][message]']) && /Sold by Ana, an independent creator/.test(cs.f['custom_text[submit][message]']), 'checkout shows seller + refund rule line');
  ok(CALLS.filter((c) => /^(products|prices|customers)$/.test(c.p)).every((c) => c.acct === acctId), 'products/prices/customers created on creator account');
  const pc = lastCall(/^POST prices$/);
  ok(pc.f.unit_amount === '2900' && pc.f['recurring[interval]'] === 'month' && pc.f.currency === 'usd', 'price $29/month');
  ok(/success_url|/.test('') && /\/c\/alpha-desk\?paid=1/.test(cs.f.success_url), 'success URL back to community');
  const nPrices = CALLS.filter((c) => c.p === 'prices').length;
  await call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, QA);
  ok(CALLS.filter((c) => c.p === 'prices').length === nPrices && CALLS.filter((c) => c.p === 'customers').length === 1, 'price + customer cached per account+mode');

  // fee setting 10%
  DB['settings/commerce'].creatorFeePct = 10;
  await call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p2' }, QA);
  let cs2 = lastCall(/checkout\/sessions/);
  ok(cs2.f.mode === 'payment' && cs2.f['payment_intent_data[application_fee_amount]'] === '1990', 'one-time with fee 10%: application_fee_amount = round(19900*0.10)', cs2.f);
  await call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p3' }, QA);
  cs2 = lastCall(/checkout\/sessions/);
  ok(cs2.f['subscription_data[application_fee_percent]'] === '10' && cs2.f['subscription_data[trial_period_days]'] === '7' && cs2.f.payment_method_collection === 'always', 'yearly + 7-day trial + fee percent 10', cs2.f);
  DB['settings/commerce'].creatorFeePct = 0;
  DB['communities/alpha-desk/plans/p3'].trialDays = 90;
  await call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p3' }, QA);
  ok(lastCall(/checkout\/sessions/).f['subscription_data[trial_period_days]'] === '30', 'trial capped at 30 days');
  DB['communities/alpha-desk/plans/p3'].trialDays = 7;
  await call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p2' }, QA);
  ok(!('payment_intent_data[application_fee_amount]' in lastCall(/checkout\/sessions/).f), 'one-time with fee 0: no application fee sent');

  // ---------------------------------------------------------------------- webhook: subscription lifecycle
  const sessId = co.sessionId;
  const subId = 'sub_test_1', t0 = Math.floor(Date.now() / 1000);
  SUBS[subId] = { id: subId, status: 'active', cancel_at_period_end: false, current_period_end: t0 + PERIOD, metadata: { buyerUid: 'zed', cid: 'alpha-desk', planId: 'p1' } };
  const sess = { id: sessId, mode: 'subscription', payment_status: 'paid', client_reference_id: 'zed', subscription: subId, customer_details: { name: 'Zed', email: QA }, amount_total: 2900 };
  // signature failures first
  r = await hook(ev('checkout.session.completed', sess, acctId), { secret: 'whsec_wrong' });
  ok(r.code === 400 && !DB['communities/alpha-desk/members/zed'], 'bad signature -> 400, nothing granted');
  r = await hook(ev('checkout.session.completed', sess, acctId), { header: '' });
  ok(r.code === 400, 'unsigned event -> 400');
  r = await hook(ev('checkout.session.completed', sess, acctId), { t: Math.floor(Date.now() / 1000) - 3600 });
  ok(r.code === 400, 'stale timestamp -> 400');
  const keep = process.env.STRIPE_CONNECT_WEBHOOK_SECRET; delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  r = await hook(ev('checkout.session.completed', sess, acctId));
  ok(r.code === 500 && !DB['communities/alpha-desk/members/zed'], 'no secret configured -> refused (500)');
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = keep;
  const live = ev('checkout.session.completed', sess, acctId); live.livemode = true;
  r = await hook(live);
  ok(r.code === 200 && /mode mismatch/.test(r.body) && !DB['communities/alpha-desk/members/zed'], 'livemode event on test deploy ignored');
  r = await hook(ev('checkout.session.completed', sess, 'acct_other'));
  ok(r.result === 'ignored: unknown account' && !DB['communities/alpha-desk/members/zed'], 'event from an account we do not know: ignored');
  r = await hook(ev('checkout.session.completed', Object.assign({}, sess, { client_reference_id: 'mallory' }), acctId));
  ok(/mismatch/.test(r.result) && !DB['communities/alpha-desk/members/zed'], 'client_reference_id mismatch refused', r);
  r = await hook(ev('checkout.session.completed', Object.assign({}, sess, { payment_status: 'unpaid' }), acctId));
  ok(/payment_status/.test(r.result) && !DB['communities/alpha-desk/members/zed'], 'unpaid session: no grant', r);

  const evDone = ev('checkout.session.completed', sess, acctId);
  r = await hook(evDone);
  let mz = DB['communities/alpha-desk/members/zed'];
  ok(r.code === 200 && mz && mz.source === 'paid' && mz.status === 'active' && mz.planId === 'p1' && mz.pay.subId === subId && mz.pay.status === 'active', 'checkout.session.completed -> member added with plan', r);
  ok(mz && mz.expiresAt.toMillis() === (t0 + PERIOD) * 1000 + I.GRACE_MS && mz.pay.periodEnd === (t0 + PERIOD) * 1000, 'expiresAt = period end + 3-day grace');
  ok(DB['communities/alpha-desk'].memberCount === 2, 'memberCount +1');
  r = await hook(evDone);
  ok(r.body === 'duplicate' && DB['communities/alpha-desk'].memberCount === 2, 'same event twice: idempotent');
  r = await hook(ev('checkout.session.completed', sess, acctId));
  ok(r.result === 'duplicate session' && DB['communities/alpha-desk'].memberCount === 2, 'same session, new event id: no double grant');
  await throws(() => call('zed', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, QA), 'already-exists', 'second checkout while subscribed refused');

  // first invoice + renewal
  const inv1 = { id: 'in_1', subscription: subId, billing_reason: 'subscription_create', amount_paid: 2900, currency: 'usd', charge: 'ch_1', payment_intent: 'pi_1', customer_email: QA, lines: { data: [{ period: { end: t0 + PERIOD } }] } };
  r = await hook(ev('invoice.paid', inv1, acctId));
  ok(DB['creatorSales/inv_in_1'] && DB['creatorSales/inv_in_1'].amountCents === 2900 && DB['creatorSales/inv_in_1'].creatorUid === 'ana' && DB['creatorSales/inv_in_1'].kind === 'first', 'first invoice -> creatorSales record', r);
  r = await hook(ev('invoice.paid', inv1, acctId));
  ok(/repeat/.test(r.result) && Object.keys(DB).filter((k) => k.startsWith('creatorSales/')).length === 1, 'invoice.paid replay: no duplicate sale', r);
  const inv2 = { id: 'in_2', subscription: subId, billing_reason: 'subscription_cycle', amount_paid: 2900, currency: 'usd', charge: 'ch_2', payment_intent: 'pi_2', lines: { data: [{ period: { end: t0 + 2 * PERIOD } }] } };
  r = await hook(ev('invoice.paid', inv2, acctId));
  mz = DB['communities/alpha-desk/members/zed'];
  ok(mz.expiresAt.toMillis() === (t0 + 2 * PERIOD) * 1000 + I.GRACE_MS && DB['creatorSales/inv_in_2'].kind === 'renewal', 'renewal extends access + renewal sale', r);

  // failure -> past_due, grace (no extension)
  const inv3 = { id: 'in_3', subscription: subId, billing_reason: 'subscription_cycle', attempt_count: 1, amount_paid: 0, lines: { data: [{ period: { end: t0 + 3 * PERIOD } }] } };
  r = await hook(ev('invoice.payment_failed', inv3, acctId));
  mz = DB['communities/alpha-desk/members/zed'];
  ok(mz.pay.status === 'past_due' && mz.status === 'active' && mz.expiresAt.toMillis() === (t0 + 2 * PERIOD) * 1000 + I.GRACE_MS && mz.pay.graceUntil === mz.expiresAt.toMillis(), 'payment_failed -> past_due, access to period end + 3 days, not extended', r);
  ok(Object.keys(DB).some((k) => /^notifications\//.test(k) && DB[k].type === 'creator_payment_failed' && DB[k].recipientUid === 'zed'), 'buyer told about the failed payment');
  // recovered
  r = await hook(ev('invoice.paid', Object.assign({}, inv3, { amount_paid: 2900, charge: 'ch_3', payment_intent: 'pi_3' }), acctId));
  mz = DB['communities/alpha-desk/members/zed'];
  ok(mz.pay.status === 'active' && mz.pay.graceUntil === null && mz.expiresAt.toMillis() === (t0 + 3 * PERIOD) * 1000 + I.GRACE_MS, 'retry paid -> active again', r);

  // portal (creates a config on first use) + cancel/resume
  const po = await call('zed', { action: 'portal', cid: 'alpha-desk' }, QA);
  ok(/billing\.stripe\.com/.test(po.url) && lastCall(/billing_portal\/sessions/).acct === acctId && DB['creatorAccounts/ana'].portalConfig, 'portal on creator account (config auto-created)');
  await throws(() => call('mallory', { action: 'portal', cid: 'alpha-desk' }, 'stryker-qa-m@example.com'), 'not-found', 'portal: someone without a subscription');
  let cc = await call('zed', { action: 'cancel', cid: 'alpha-desk' }, QA);
  ok(cc.cancelAtPeriodEnd === true && lastCall(/^POST subscriptions\//).acct === acctId && DB['communities/alpha-desk/members/zed'].pay.cancelAtPeriodEnd === true && DB['communities/alpha-desk/members/zed'].status === 'active', 'cancel at period end, access kept');
  cc = await call('zed', { action: 'cancel', cid: 'alpha-desk', resume: true }, QA);
  ok(cc.cancelAtPeriodEnd === false && DB['communities/alpha-desk/members/zed'].pay.cancelAtPeriodEnd === false, 'resume subscription');
  // subscription.updated from Stripe (portal cancel)
  r = await hook(ev('customer.subscription.updated', Object.assign({}, SUBS[subId], { cancel_at_period_end: true }), acctId));
  ok(DB['communities/alpha-desk/members/zed'].pay.cancelAtPeriodEnd === true, 'subscription.updated cancel flag', r);
  // deleted -> ended
  r = await hook(ev('customer.subscription.deleted', Object.assign({}, SUBS[subId], { status: 'canceled' }), acctId));
  mz = DB['communities/alpha-desk/members/zed'];
  ok(mz.status === 'expired' && mz.pay.status === 'ended' && mz.expiresAt.toMillis() <= Date.now(), 'subscription.deleted -> membership ended', r);
  r = await hook(ev('customer.subscription.deleted', SUBS[subId], 'acct_other'));
  ok(r.result === 'ignored: unknown account', 'deleted from foreign account ignored');

  // ---------------------------------------------------------------------- one-time + refund
  const co2 = await call('yan', { action: 'checkout', cid: 'alpha-desk', planId: 'p2' }, 'stryker-qa-yan@example.com');
  const s2 = { id: co2.sessionId, mode: 'payment', payment_status: 'paid', client_reference_id: 'yan', payment_intent: 'pi_one', customer_details: { name: 'Yan' }, amount_total: 19900 };
  r = await hook(ev('checkout.session.completed', s2, acctId));
  let my = DB['communities/alpha-desk/members/yan'];
  ok(my && my.expiresAt === null && my.pay.kind === 'one_time' && DB['creatorSales/pi_pi_one'].amountCents === 19900, 'one-time: lifetime access + sale', r);
  r = await hook(ev('charge.refunded', { id: 'ch_one', payment_intent: 'pi_one', amount: 19900, amount_refunded: 5000, refunded: false }, acctId));
  ok(DB['creatorSales/pi_pi_one'].status === 'partially_refunded' && DB['communities/alpha-desk/members/yan'].status === 'active', 'partial refund: access kept', r);
  r = await hook(ev('charge.refunded', { id: 'ch_one', payment_intent: 'pi_one', amount: 19900, amount_refunded: 19900, refunded: true }, acctId));
  my = DB['communities/alpha-desk/members/yan'];
  ok(DB['creatorSales/pi_pi_one'].status === 'refunded' && my.status === 'expired' && my.pay.status === 'refunded', 'full refund of one-time: access ended', r);
  r = await hook(ev('charge.refunded', { id: 'ch_2', invoice: 'in_2', amount: 2900, amount_refunded: 2900, refunded: true }, acctId));
  ok(DB['creatorSales/inv_in_2'].status === 'refunded', 'subscription invoice refund recorded on the sale', r);

  // ---------------------------------------------------------------------- dispute
  const co3 = await call('xi', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'stryker-qa-xi@example.com');
  SUBS.sub_x = { id: 'sub_x', status: 'active', cancel_at_period_end: false, current_period_end: t0 + PERIOD, metadata: {} };
  await hook(ev('checkout.session.completed', { id: co3.sessionId, mode: 'subscription', payment_status: 'paid', client_reference_id: 'xi', subscription: 'sub_x' }, acctId));
  await hook(ev('invoice.paid', { id: 'in_x', subscription: 'sub_x', billing_reason: 'subscription_create', amount_paid: 2900, currency: 'usd', charge: 'ch_x', payment_intent: 'pi_x', lines: { data: [{ period: { end: t0 + PERIOD } }] } }, acctId));
  CHARGES.ch_x = { id: 'ch_x', invoice: 'in_x', payment_intent: 'pi_x', amount: 2900 };
  r = await hook(ev('charge.dispute.created', { id: 'dp_1', charge: 'ch_x', reason: 'fraudulent' }, acctId));
  const mx = DB['communities/alpha-desk/members/xi'];
  ok(DB['creatorSales/inv_in_x'].status === 'disputed' && mx.status === 'expired' && mx.pay.status === 'disputed' && SUBS.sub_x.status === 'canceled' && lastCall(/^DELETE subscriptions/).acct === acctId, 'dispute: sale disputed, access ended, subscription cancelled on creator account', r);
  ok(Object.keys(DB).some((k) => /^notifications\//.test(k) && DB[k].type === 'creator_dispute' && DB[k].recipientUid === 'ana'), 'creator told about the dispute');

  // ---------------------------------------------------------------------- suspend + banned + admin list
  DB['communities/alpha-desk/members/ban'] = { uid: 'ban', status: 'banned', role: 'member' };
  await throws(() => call('ban', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'stryker-qa-ban@example.com'), 'permission-denied', 'banned member cannot buy');
  DB['communities/alpha-desk/bans/stryker-qa-ban2@example.com'] = { email: 'x' };
  await throws(() => call('ban2', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'stryker-qa-ban2@example.com'), 'permission-denied', 'email-banned person cannot buy');
  const co4 = await call('wu', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'stryker-qa-wu@example.com');
  SUBS.sub_w = { id: 'sub_w', status: 'active', cancel_at_period_end: false, current_period_end: t0 + PERIOD, metadata: {} };
  await hook(ev('checkout.session.completed', { id: co4.sessionId, mode: 'subscription', payment_status: 'paid', client_reference_id: 'wu', subscription: 'sub_w' }, acctId));
  const sus = await call('tz', { action: 'suspend', cid: 'alpha-desk', suspend: true, reason: 'review' });
  ok(sus.status === 'suspended' && sus.renewalsStopped === 1 && SUBS.sub_w.cancel_at_period_end === true && DB['communities/alpha-desk/members/wu'].status === 'active', 'admin suspend: renewals stop at period end, access kept', sus);
  await throws(() => call('vic', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'stryker-qa-vic@example.com'), 'failed-precondition', 'suspended community: no new sales', /not taking/);
  await call('tz', { action: 'suspend', cid: 'alpha-desk', suspend: false });
  ok(DB['communities/alpha-desk'].status === 'active', 'admin unsuspend');
  const al2 = await call('tz', { action: 'adminList' });
  ok(al2.creators.length === 1 && al2.creators[0].status === 'active' && al2.creators[0].uid === 'ana' && al2.mode === 'test', 'admin list shows creator payout status', al2);

  // restricted state with Stripe's own reason
  ACCOUNTS[acctId] = Object.assign(ACCOUNTS[acctId], { charges_enabled: false, requirements: { currently_due: ['individual.id_number'], past_due: ['individual.id_number'], errors: [{ code: 'verification_failed_id_number_match', reason: 'The ID number does not match.', requirement: 'individual.id_number' }], disabled_reason: 'requirements.past_due', pending_verification: [] } });
  await hook(ev('account.updated', ACCOUNTS[acctId], acctId));
  const stR = await call('ana', { action: 'status' });
  ok(stR.account.status === 'restricted' && stR.account.errors[0].reason === 'The ID number does not match.' && stR.account.currentlyDue[0] === 'individual.id_number' && DB['communities/alpha-desk'].sellerReady === false, 'restricted: Stripe reason passed through, selling stops', stR.account);
  await throws(() => call('tom', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'stryker-qa-tom@example.com'), 'failed-precondition', 'restricted creator: checkout refused');

  // live key + switch semantics
  process.env.STRIPE_SECRET_KEY = 'rk_live_offline_mock';
  DB['settings/commerce'].creatorPayments = false;
  await throws(() => call('pat', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'pat@gmail.com'), 'failed-precondition', 'live + switch off: member refused', /opens soon/);
  DB['settings/commerce'].creatorPayments = true;
  const stL = await call('ana', { action: 'status' });
  ok(stL.account.status === 'none', 'live mode does not reuse a test-mode account record');
  process.env.STRIPE_SECRET_KEY = 'sk_test_offline_mock';

  // ---------------------------------------------------------------------- LIVE GATE: switch on is not enough
  {
    const LC = require(FN + 'creatorLive');
    const TESTKEY = 'sk_' + 'test_offline_mock';
    const realFetch = global.fetch;
    let PROBE = 'allow';   // allow: every probe 200/404 | deny: 403 on one permission
    const probeFetch = async (url, init) => {
      const isProbe = /limit=1/.test(url) || /_0000000000000000/.test(url) || /account_links$|login_links$/.test(url);
      if (!isProbe) return realFetch(url, init);
      if (PROBE === 'deny' && /disputes/.test(url)) return { ok: false, status: 403, json: async () => ({ error: { message: 'The provided key does not have the required permissions for this endpoint.' } }) };
      if (/_0000000000000000/.test(url) || /account_links$|login_links$/.test(url)) return { ok: false, status: 400, json: async () => ({ error: { message: 'No such object' } }) };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'acct_probe' }] }) };
    };
    const wrapped = (f) => { global.fetch = f; };
    process.env.STRIPE_SECRET_KEY = 'rk_live_offline_mock';
    DB['settings/commerce'] = Object.assign(DB['settings/commerce'] || {}, { creatorPayments: true });
    wrapped(probeFetch);

    // (a) key fails a permission -> paid actions refused with the friendly state, status says switchingOn
    PROBE = 'deny'; LC.resetCache();
    await throws(() => call('pat', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'pat@gmail.com'), 'failed-precondition', 'live gate: key permission missing -> refused', /being switched on/);
    await throws(() => call('ana', { action: 'onboard', cid: 'alpha-desk', country: 'US', agree: true }, 'ana@gmail.com'), 'failed-precondition', 'live gate: onboarding also waits', /being switched on/);
    const stSw = await call('ana', { action: 'status' }, 'ana@gmail.com');
    ok(stSw.switchingOn === true && stSw.legalName === 'Gaurav Singh LLC', 'status tells the UI payouts are being switched on + legal name', stSw);
    const pr = await LC.probe('rk_live_offline_mock', probeFetch);
    ok(!pr.ok && pr.results.filter((x) => !x.pass).map((x) => x.id).join() === 'disputes', 'probe: exactly the denied permission fails', pr.results.filter((x) => !x.pass));
    ok(!JSON.stringify(pr).includes('rk_live'), 'probe output carries no key');

    // (b) key passes but webhook secret missing -> still refused
    PROBE = 'allow'; LC.resetCache();
    const keepSec = process.env.STRIPE_CONNECT_WEBHOOK_SECRET; delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    await throws(() => call('pat', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'pat@gmail.com'), 'failed-precondition', 'live gate: webhook secret missing -> refused', /being switched on/);
    const rdy0 = await I.payReady(); ok(rdy0.ready === false && rdy0.reason === 'webhook_secret_missing', 'payReady: no secret -> not ready', rdy0);

    // (c) both fine -> gate opens (checkout proceeds past the gate; seller state decides after that)
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = keepSec; LC.resetCache();
    const rdy1 = await I.payReady(); ok(rdy1.ready === true, 'payReady: key ok + secret set -> ready', rdy1);
    let gateErr = null; try { await call('pat', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'pat@gmail.com'); } catch (e) { gateErr = e; }
    ok(!gateErr || !/being switched on|opens soon/.test(gateErr.message), 'live gate: open when ready (no gate message)', gateErr && gateErr.message);

    // (d) switch off still wins; admin/QA bypass untouched
    PROBE = 'deny'; LC.resetCache(); DB['settings/commerce'].creatorPayments = false;
    await throws(() => call('pat', { action: 'checkout', cid: 'alpha-desk', planId: 'p1' }, 'pat@gmail.com'), 'failed-precondition', 'switch off: still "opens soon"', /opens soon/);
    DB['settings/commerce'].creatorPayments = true;
    // test mode never calls the live probe
    process.env.STRIPE_SECRET_KEY = TESTKEY; LC.resetCache();
    const rdyT = await I.payReady(); ok(rdyT.ready === true && rdyT.reason === 'test', 'test mode: gate does not use the live probe');

    // (e) webhook: live secret and test secret both accepted, none refused, wrong refused
    const cryptoW = require('crypto'), raw = JSON.stringify({ id: 'evt_gate1', type: 'noop.test', livemode: false, data: { object: {} } });
    const sigOf = (sec) => { const t = Math.floor(Date.now() / 1000); return 't=' + t + ',v1=' + cryptoW.createHmac('sha256', sec).update(t + '.' + raw).digest('hex'); };
    const hit = async (sec) => { let code = 0; await I.webhookHandler({ rawBody: Buffer.from(raw), headers: { 'stripe-signature': sigOf(sec) } }, { status: (c) => ({ send: () => { code = c; } }) }); return code; };
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_live_secret_x'; process.env.STRIPE_CONNECT_WEBHOOK_SECRET_TEST = 'whsec_test_secret_y';
    ok((await hit('whsec_live_secret_x')) === 200, 'webhook: live Connect secret accepted');
    DB = Object.assign(DB, {}); for (const k of Object.keys(DB)) if (k.indexOf('creatorEvents/') === 0) delete DB[k];
    ok((await hit('whsec_test_secret_y')) === 200, 'webhook: separate test secret accepted');
    ok((await hit('whsec_wrong')) === 400, 'webhook: wrong secret refused (400)');
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET; delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET_TEST;
    ok((await hit('whsec_live_secret_x')) === 500, 'webhook: no secret set -> refused (500)');
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = keepSec;
    global.fetch = realFetch;

    // legal name is one setting
    ok(I.legalNameOf({}) === 'Gaurav Singh LLC' && I.legalNameOf({ creatorPlatformLegalName: '  Tradezoro   LLC ' }) === 'Tradezoro LLC' && I.legalNameOf({ creatorPlatformLegalName: 'x'.repeat(200) }) === 'Gaurav Singh LLC', 'legal name: default, trimmed, length-capped');
    ok(/operated by Tradezoro LLC\.$/.test(I.platformLine(I.legalNameOf({ creatorPlatformLegalName: 'Tradezoro LLC' }))), 'platform line uses the setting');
  }

  // nothing ever printed the key
  ok(!CALLS.some((c) => JSON.stringify(c).includes('offline_mock')), 'Stripe key never in a request body/record');

  console.log(pass + '/' + (pass + failN) + ' passed');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
