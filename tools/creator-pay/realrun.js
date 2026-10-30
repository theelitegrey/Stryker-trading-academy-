#!/usr/bin/env node
// REAL Stripe sandbox run of creatorPay.js (in-memory Firestore, real api.stripe.com with the TEST key read from stripe.env, never printed).
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


const fs = require('fs');
const env = {};
for (const l of fs.readFileSync('/root/.hermes/profiles/chief-of-staff/scripts/stripe.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
if (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '')) { console.error('not a test key, refusing'); process.exit(2); }
process.env.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
const WHSEC = 'whsec_realrun_' + crypto.randomBytes(6).toString('hex');
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WHSEC;
const realFetch = global.fetch;
const KEY = env.STRIPE_SECRET_KEY;
async function S(method, p, params, acct) {  // direct v1 helper for the test driver (acts as Stripe / the buyer)
  const enc = (o, pre) => Object.entries(o || {}).flatMap(([k, v]) => v && typeof v === 'object' ? enc(v, pre ? pre + '[' + k + ']' : k) : [encodeURIComponent(pre ? pre + '[' + k + ']' : k) + '=' + encodeURIComponent(v)]).join('&');
  const h = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' }; if (acct) h['Stripe-Account'] = acct;
  const r = await realFetch('https://api.stripe.com/v1/' + p + (method === 'GET' && params ? '?' + enc(params) : ''), { method, headers: h, body: method === 'GET' ? undefined : enc(params) });
  const j = await r.json(); if (!r.ok) throw new Error(method + ' ' + p + ': ' + (j.error && j.error.message)); return j;
}
async function V2(method, p, body) {
  const r = await realFetch('https://api.stripe.com/v2/' + p, { method, headers: { Authorization: 'Bearer ' + KEY, 'Stripe-Version': '2026-09-30.endive', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error('v2 ' + p + ': ' + JSON.stringify(j.error).slice(0, 300)); return j;
}
const FN = path.join(__dirname, '../../functions-src/');
const CP = require(FN + 'creatorPay');
let pass = 0, failN = 0;
const LOG = [];
function ok(c, n, x) { if (c) pass++; else failN++; LOG.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 250))); console.log(LOG[LOG.length - 1]); }
const ctx = (uid, email) => ({ auth: { uid, token: { email, name: uid } } });
const call = (uid, data, email) => CP.creatorPay(data, ctx(uid, email));
function signed(evt) { const raw = JSON.stringify(evt), t = Math.floor(Date.now() / 1000); return { raw: Buffer.from(raw), header: 't=' + t + ',v1=' + crypto.createHmac('sha256', WHSEC).update(t + '.' + raw).digest('hex') }; }
async function hook(evt) { const s = signed(evt); let code = 0; await CP.creatorConnectWebhook({ rawBody: s.raw, headers: { 'stripe-signature': s.header } }, { status(c) { code = c; return this; }, send() { return this; } }); return code; }
// Turn the newest real events on the connected account into signed webhook deliveries (what a registered Connect endpoint would send).
const seen = new Set();
async function pump(acct, types) {
  const ev = await S('GET', 'events', { limit: 40 }, acct);
  const fresh = ev.data.filter((e) => !seen.has(e.id) && (!types || types.includes(e.type))).reverse();
  for (const e of fresh) { const o = Object.assign({}, e, { account: acct }); const c = await hook(o); if (c === 200) seen.add(e.id); LOG.push('  event ' + e.type + ' -> ' + c); }   // 500 = Stripe would retry: not marked seen, replayed on the next pump
  return fresh.map((e) => e.type);
}
const QA = 'stryker-qa-creator@example.com';
const qaBuyer = (n) => 'stryker-qa-buyer' + n + '@example.com';
const IDS = {};

(async () => {
  DB = {}; DB['admins/tz'] = {}; DB['settings/commerce'] = { creatorPayments: false, creatorFeePct: 0 };
  DB['communities/qa-desk'] = { ownerUid: 'ana', ownerName: 'QA Creator', name: 'QA Desk', status: 'active', visibility: 'public', memberCount: 1, refundRule: '7 days, ask by email.' };
  DB['communities/qa-desk/members/ana'] = { uid: 'ana', role: 'owner', status: 'active', source: 'owner' };
  DB['communities/qa-desk/plans/p1'] = { name: 'Monthly', status: 'live', joinMode: 'open', price: { amount: 29, currency: 'USD', interval: 'month' }, trialDays: 0, order: 0 };
  DB['communities/qa-desk/plans/p2'] = { name: 'Lifetime', status: 'live', joinMode: 'open', price: { amount: 49, currency: 'USD', interval: 'lifetime' }, trialDays: 0, order: 1 };
  // 1. onboarding through OUR code (real v2 create + real account link)
  const ob = await call('ana', { action: 'onboard', cid: 'qa-desk', country: 'US', agree: true }, QA);
  const acct = DB['creatorAccounts/ana'].acct; IDS.connectedAccount = acct;
  ok(/^acct_/.test(acct) && /connect\.stripe\.com/.test(ob.url), 'real v2 account created via our onboard action + Stripe-hosted link', { acct });
  const real = await S('GET', 'accounts/' + acct);
  ok(real.controller.losses.payments === 'stripe' && real.controller.fees.payer === 'account' && real.controller.stripe_dashboard.type === 'full' && real.controller.requirement_collection === 'stripe', 'controller props on the real account: Stripe collects losses, account pays fees, full dashboard, Stripe collects requirements', real.controller);
  ok(DB['creatorAccounts/ana'].status === 'incomplete', 'status incomplete until onboarding is done');
  fs.writeFileSync(__dirname + '/.last-onboard-url', ob.url);   // for the browser step (not committed)
  console.log('ONBOARD_ACCT', acct);
  // the browser step finishes hosted onboarding out of process; this script continues only if the account is active
  if (process.env.REAL_ACCT) {   // an ACTIVE sandbox account (hosted-onboarded, or API-onboarded fixture) takes over for the payment steps
    DB['creatorAccounts/ana'] = Object.assign({}, DB['creatorAccounts/ana'], { acct: process.env.REAL_ACCT, live: false });
    IDS.paymentAccount = process.env.REAL_ACCT;
  }
  const acctUse = DB['creatorAccounts/ana'].acct;
  const st = await call('ana', { action: 'status' }, QA);
  IDS.statusAfterOnboardStart = st.account.status;
  if (st.account.status !== 'active') { console.log('ACCOUNT NOT ACTIVE YET:', st.account.status, JSON.stringify(st.account.currentlyDue)); fs.writeFileSync('/tmp/t7-realrun-state.json', JSON.stringify({ DB, acct })); console.log(pass + '/' + (pass + failN) + ' so far'); return process.exit(failN ? 1 : 3); }
  require('./realrun-part2')({ S, V2, call, hook, pump, ok, acct: acctUse, IDS, QA, qaBuyer, LOG, CP, signed, getDB: () => DB, done: () => { console.log(pass + '/' + (pass + failN) + ' passed'); fs.writeFileSync('/tmp/t7-realrun-ids.json', JSON.stringify(IDS, null, 1)); process.exit(failN ? 1 : 0); } });
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
