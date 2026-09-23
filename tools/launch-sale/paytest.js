#!/usr/bin/env node
// Launch sale: offline payment-amount test.
//
//   node tools/launch-sale/paytest.js
//
// Loads the real functions-src/razorpay.js, razorpaySubs.js and launchSale.js
// with firebase-admin / firebase-functions replaced by an in-memory stub and
// fetch() mocked, then asserts the EXACT amount each path would send to
// Razorpay. Nothing touches the network, Firestore or Razorpay. Exits 1 on any
// failure.
'use strict';
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const origLoad = Module._load;

// ---- in-memory Firestore ---------------------------------------------------
let DB = {};
let autoId = 0;
const snapOf = (p) => ({ id: p.split('/').pop(), exists: p in DB, data: () => DB[p], get: (k) => (DB[p] || {})[k] });
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
    update: async (v) => { DB[p] = Object.assign({}, DB[p], v); }
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
  config: () => ({})
};
Module._load = function (r, ...a) {
  if (r === 'firebase-admin') return admin;
  if (r === 'firebase-functions' || r === 'firebase-functions/v1') return fx;
  return origLoad.call(this, r, ...a);
};
process.env.RAZORPAY_KEY_ID = 'rzp_test_offline';
process.env.RAZORPAY_KEY_SECRET = 'offline';

// ---- mocked Razorpay ---------------------------------------------------------
let sent = [];
global.fetch = async (url, o) => {
  const b = o && o.body ? JSON.parse(o.body) : null;
  sent.push({ path: url.split('/v1/')[1], b });
  return { ok: true, status: 200, json: async () => ({ id: 'rzp_' + sent.length + '_' + (++autoId) }), text: async () => '' };
};

const FN = path.join(__dirname, '../../functions-src/');
const R = require(FN + 'razorpay');
const S = require(FN + 'razorpaySubs');
const LS = require(FN + 'launchSale');
const L = LS.__launchInternals;

// ---- fixtures ----------------------------------------------------------------
const PRO = { name: 'Pro', period: 'month', price: '49', salePrice: '19', priceInr: '2499', salePriceInr: '699', onSale: true, saleEndsAt: '' };
const ELITE = { name: 'Elite', period: 'month', price: '129', salePrice: '49', priceInr: '5999', salePriceInr: '1999', onSale: true, saleEndsAt: '' };
function reset() {
  DB = {
    'settings/commerce': { usdInr: 88.2 },
    'plans/PRO': Object.assign({}, PRO),
    'plans/ELITE': Object.assign({}, ELITE),
    // No rupee price and an expired sale: exactly the pre-launch behaviour.
    'plans/OLD': { name: 'Old', period: 'month', price: '65', salePrice: '29', onSale: true, saleEndsAt: '2026-09-12' },
    'coupons/HALF': { type: 'percent', value: 50, appliesToPlan: 'all' },
    'coupons/FIVE': { type: 'fixed', value: 5, appliesToPlan: 'all' }
  };
}
const ctx = (uid) => ({ auth: { uid, token: { email: uid + '@example.com' } } });

let fails = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label.padEnd(50) + ' ' + got + (ok ? '' : '   (want ' + want + ')'));
}
async function orderAmount(data, uid = 'u1') {
  sent = [];
  await R.razorpayCreateOrder(data, ctx(uid));
  const o = sent.find((s) => s.path === 'orders');
  return o.b.currency + ' ' + o.b.amount / 100;
}
async function subsAmount(data, uid = 'u1') {
  sent = [];
  await S.razorpaySubscribe(data, ctx(uid));
  // The debit amount lives on the Razorpay billing plan (created, or reused
  // from the razorpayPlans cache) and on the razorpaySubs record.
  const rec = Object.entries(DB).filter(([p]) => p.startsWith('razorpaySubs/')).pop()[1];
  const planCall = sent.find((s) => s.path === 'plans');
  return 'INR ' + rec.amountMinor / 100 + (planCall ? ' (new rzp plan ' + planCall.b.item.amount / 100 + ')' : ' (cached rzp plan)');
}

(async () => {
  console.log('== Amounts sent to Razorpay during the sale (usdInr 88.2) ==');
  reset();
  check('Pro one-time USD', await orderAmount({ planId: 'PRO', currency: 'USD' }), 'USD 19');
  check('Pro one-time INR', await orderAmount({ planId: 'PRO', currency: 'INR' }), 'INR 699');
  check('Elite one-time USD', await orderAmount({ planId: 'ELITE', currency: 'USD' }), 'USD 49');
  check('Elite one-time INR', await orderAmount({ planId: 'ELITE', currency: 'INR' }), 'INR 1999');
  check('Pro INR + 50% coupon', await orderAmount({ planId: 'PRO', currency: 'INR', couponCode: 'HALF' }), 'INR 350');
  check('Pro INR + $5 coupon (5 x 88.2 = Rs 441 off)', await orderAmount({ planId: 'PRO', currency: 'INR', couponCode: 'FIVE' }), 'INR 258');
  check('Pro USD + $5 coupon', await orderAmount({ planId: 'PRO', currency: 'USD', couponCode: 'FIVE' }), 'USD 14');
  check('Old plan INR, no priceInr (65 x 88.2, unchanged)', await orderAmount({ planId: 'OLD', currency: 'INR' }), 'INR 5733');
  check('Old plan USD, no priceInr (unchanged)', await orderAmount({ planId: 'OLD', currency: 'USD' }), 'USD 65');
  check('Pro AutoPay INR (subscription)', await subsAmount({ planId: 'PRO', currency: 'INR' }), 'INR 699 (new rzp plan 699)');
  check('Old plan AutoPay INR (unchanged USD x rate)', await subsAmount({ planId: 'OLD', currency: 'INR' }), 'INR 5733 (new rzp plan 5733)');

  console.log('\n== After the sale ends (Pro back to $49 / Rs 2,499) ==');
  DB['plans/PRO'] = Object.assign({}, PRO, { salePrice: '', salePriceInr: '', onSale: false });
  DB['foundingPrices/u1'] = { plans: { PRO: { usd: 19, inr: 699 } } };
  DB['students/u1'] = { paidThroughMillis: Date.now() + 86400000 };
  check('founding member, paid up: USD', await orderAmount({ planId: 'PRO', currency: 'USD' }), 'USD 19');
  check('founding member, paid up: INR', await orderAmount({ planId: 'PRO', currency: 'INR' }), 'INR 699');
  check('founding member, paid up: AutoPay', await subsAmount({ planId: 'PRO', currency: 'INR' }), 'INR 699 (cached rzp plan)');
  DB['students/u1'] = { paidThroughMillis: Date.now() - 2 * 86400000 };
  check('founding member, 2 days late (grace): USD', await orderAmount({ planId: 'PRO', currency: 'USD' }), 'USD 19');
  DB['students/u1'] = { paidThroughMillis: Date.now() - 10 * 86400000 };
  check('founding member, LAPSED: USD', await orderAmount({ planId: 'PRO', currency: 'USD' }), 'USD 49');
  check('founding member, LAPSED: INR', await orderAmount({ planId: 'PRO', currency: 'INR' }), 'INR 2499');
  check('new member after sale: INR', await orderAmount({ planId: 'PRO', currency: 'INR' }, 'u9'), 'INR 2499');
  check('new member after sale: USD', await orderAmount({ planId: 'PRO', currency: 'USD' }, 'u9'), 'USD 49');
  DB['students/u1'] = { paidThroughMillis: Date.now() + 86400000 };
  check('a Pro lock does not touch Elite', await orderAmount({ planId: 'ELITE', currency: 'USD' }), 'USD 49');
  DB['foundingPrices/u1'] = { plans: { PRO: { usd: 99, inr: 9999 } } };
  check('a lock above today\'s price never raises it', await orderAmount({ planId: 'PRO', currency: 'INR' }), 'INR 2499');

  console.log('\n== Recording the founding price ==');
  reset();
  DB['launchSaleConfig/main'] = { active: true, limit: 100, planIds: ['PRO', 'ELITE'] };
  check('recorded after a verified payment', await L.recordFoundingPrice('u2', 'PRO', 19, 699), true);
  check('stored values', JSON.stringify({ usd: DB['foundingPrices/u2'].plans.PRO.usd, inr: DB['foundingPrices/u2'].plans.PRO.inr }), '{"usd":19,"inr":699}');
  check('second payment does not overwrite', await L.recordFoundingPrice('u2', 'PRO', 49, 2499), false);
  check('still the first price', DB['foundingPrices/u2'].plans.PRO.inr, 699);
  check('not a launch plan: not recorded', await L.recordFoundingPrice('u2', 'OLD', 65, null), false);
  DB['settings/commerce'].launchSale = { taken: 100 };
  check('sold out: not recorded', await L.recordFoundingPrice('u3', 'PRO', 19, 699), false);
  DB['launchSaleConfig/members'] = { uids: ['u4'] };
  check('sold out but took the LAST seat: recorded', await L.recordFoundingPrice('u4', 'PRO', 19, 699), true);
  DB['settings/commerce'].launchSale = { taken: 3 };
  DB['launchSaleConfig/main'].active = false;
  check('sale switched off: not recorded', await L.recordFoundingPrice('u5', 'PRO', 19, 699), false);

  console.log('\n== End to end: create order -> verify -> counter ==');
  reset();
  DB['launchSaleConfig/main'] = { active: true, startAt: 1, limit: 100, planIds: ['PRO', 'ELITE'], excludeUids: [], excludeCoupons: ['TEST*'] };
  await R.razorpayCreateOrder({ planId: 'PRO', currency: 'INR' }, ctx('u7'));
  const oid = Object.keys(DB).find((p) => p.startsWith('razorpayOrders/')).split('/')[1];
  const sig = crypto.createHmac('sha256', 'offline').update(oid + '|pay_1').digest('hex');
  await R.razorpayVerifyPayment({ orderId: oid, paymentId: 'pay_1', signature: sig }, ctx('u7'));
  const ord = Object.values(DB).find((v) => v && v.studentUid === 'u7' && v.status === 'completed');
  check('orders record written (finalAmount currency)', ord ? ord.finalAmount + ' ' + ord.currency : 'none', '699 INR');
  check('founding price recorded for u7', DB['foundingPrices/u7'] && DB['foundingPrices/u7'].plans.PRO.inr, 699);
  let replay = 'accepted';
  try { await R.razorpayVerifyPayment({ orderId: oid, paymentId: 'pay_1', signature: sig }, ctx('u7')); } catch (e) { replay = 'rejected'; }
  check('replayed verify is rejected', replay, 'rejected');
  await LS.launchSaleOnOrder();
  check('counter after one real order', DB['settings/commerce'].launchSale.taken, 1);

  console.log('\n== launchSaleOnOrder counting (mocked orders) ==');
  reset();
  DB['launchSaleConfig/main'] = { active: true, startAt: 100, limit: 100, planIds: ['PRO', 'ELITE'],
    excludeUids: ['OWNER'], excludeCoupons: ['TEST*'] };
  const add = (o) => { const n = ++autoId; DB['orders/o' + n] = Object.assign({ status: 'completed', createdAt: 200 + n, couponCode: null }, o); };
  add({ studentUid: 'a', planId: 'PRO', finalAmount: 699 });                        // counts
  add({ studentUid: 'b', planId: 'ELITE', finalAmount: 49 });                       // counts
  add({ studentUid: 'a', planId: 'PRO', finalAmount: 699 });                        // same uid again
  add({ studentUid: 'c', planId: 'PRO', finalAmount: 0, couponCode: 'WELCOME' });   // $0 coupon grant
  add({ studentUid: 'd', planId: 'PRO', finalAmount: 19, couponCode: 'TESTPRO' });  // TEST* coupon
  add({ studentUid: 'OWNER', planId: 'ELITE', finalAmount: 49 });                   // Owner test uid
  add({ studentUid: 'e', planId: 'OLD', finalAmount: 65 });                         // not a launch plan
  add({ studentUid: 'f', planId: 'PRO', finalAmount: 19, status: 'created' });      // not completed
  add({ studentUid: 'g', planId: 'PRO', finalAmount: 19, createdAt: 50 });          // before startAt
  await LS.launchSaleOnOrder();
  check('taken = paid, distinct, real only', DB['settings/commerce'].launchSale.taken, 2);
  check('seat holders', JSON.stringify(DB['launchSaleConfig/members'].uids), '["a","b"]');
  check('no alert below 90', !!DB['launchSaleAlerts/90'], false);
  for (let i = 0; i < 88; i++) add({ studentUid: 'm' + i, planId: 'PRO', finalAmount: 19 });
  await LS.launchSaleOnOrder();
  check('taken at 90', DB['settings/commerce'].launchSale.taken, 90);
  check('90 alert fired', DB['launchSaleAlerts/90'] && DB['launchSaleAlerts/90'].mark, 90);
  const at90 = DB['launchSaleAlerts/90'].at;
  add({ studentUid: 'n1', planId: 'PRO', finalAmount: 19 });
  await LS.launchSaleOnOrder();
  check('90 alert not re-fired', DB['launchSaleAlerts/90'].at, at90);
  check('no 100 alert at 91', !!DB['launchSaleAlerts/100'], false);
  for (let i = 0; i < 9; i++) add({ studentUid: 'p' + i, planId: 'ELITE', finalAmount: 49 });
  await LS.launchSaleOnOrder();
  check('taken at 100', DB['settings/commerce'].launchSale.taken, 100);
  check('100 alert fired', DB['launchSaleAlerts/100'] && DB['launchSaleAlerts/100'].mark, 100);
  const at100 = DB['launchSaleAlerts/100'].at;
  add({ studentUid: 'late', planId: 'PRO', finalAmount: 19 });
  await LS.launchSaleOnOrder();
  check('101st buyer: taken stays 100', DB['settings/commerce'].launchSale.taken, 100);
  check('100 alert not re-fired', DB['launchSaleAlerts/100'].at, at100);
  check('101st buyer is not a seat holder', DB['launchSaleConfig/members'].uids.includes('late'), false);
  check('100th buyer is a seat holder', DB['launchSaleConfig/members'].uids.includes('p8'), true);
  check('counter never changes prices', DB['plans/PRO'].salePrice + '/' + DB['plans/PRO'].salePriceInr, '19/699');

  console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
