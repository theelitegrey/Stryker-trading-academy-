// Offline test: exact amounts razorpayCreateOrder / razorpaySubscribe send to Razorpay.
const Module = require('module'); const orig = Module._load;
const DB = {};
function doc(path){ return { get: async () => ({ exists: path in DB, data: () => DB[path], get: (k) => (DB[path]||{})[k] }),
  set: async (v) => { DB[path] = Object.assign({}, DB[path], v); }, update: async (v) => { DB[path] = Object.assign({}, DB[path], v); } }; }
const fakeDb = { collection: (c) => ({ doc: (id) => doc(c + '/' + id), add: async (v) => { DB[c + '/auto' + Math.random()] = v; } }),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v) => r.set(v), update: (r, v) => r.update(v) }) };
const admin = { apps: [1], initializeApp(){}, firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => 'ts', delete: () => null }, Timestamp: { now: () => 'now' } }) };
const fx = { https: { onCall: (f) => f, onRequest: (f) => f, HttpsError: class extends Error { constructor(c, m){ super(c + ': ' + m); } } },
  runWith(){ return this; }, firestore: { document: () => ({ onCreate: (f) => f }) }, pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (f) => f }) }) } };
Module._load = function (r, ...a) { if (r === 'firebase-admin') return admin; if (r === 'firebase-functions') return fx; return orig.call(this, r, ...a); };
process.env.RAZORPAY_KEY_ID = 'k'; process.env.RAZORPAY_KEY_SECRET = 's';
let sent = [];
global.fetch = async (url, o) => { const b = JSON.parse(o.body); sent.push({ url: url.split('/v1/')[1], b });
  return { ok: true, status: 200, json: async () => ({ id: 'x' + sent.length }), text: async () => '' }; };
const R = require(require('path').join(__dirname,'../../functions-src/razorpay')), S = require(require('path').join(__dirname,'../../functions-src/razorpaySubs'));
DB['settings/commerce'] = { usdInr: 88.2 };
DB['plans/PRO'] = { name: 'Pro', period: 'month', price: '49', salePrice: '19', priceInr: '2499', salePriceInr: '699', onSale: true, saleEndsAt: '' };
DB['plans/OLD'] = { name: 'Old', period: 'month', price: '65', salePrice: '29', saleEndsAt: '2026-09-12' };  // no rupee price, expired sale
DB['coupons/HALF'] = { type: 'percent', value: 50, appliesToPlan: 'all' };
DB['coupons/FIVE'] = { type: 'fixed', value: 5, appliesToPlan: 'all' };
const ctx = { auth: { uid: 'u1', token: {} } };
(async () => {
  const run = async (label, f) => { sent = []; try { await f(); } catch (e) { console.log(label, 'ERR', e.message); return; }
    const o = sent.find((s) => s.url === 'orders'); const p = sent.find((s) => s.url === 'plans');
    console.log(label.padEnd(34), o ? o.b.currency + ' ' + o.b.amount / 100 : '', p ? 'rzp plan INR ' + p.b.item.amount / 100 : ''); };
  await run('Pro USD', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'USD' }, ctx));
  await run('Pro INR', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'INR' }, ctx));
  await run('Pro INR + 50% coupon', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'INR', couponCode: 'HALF' }, ctx));
  await run('Pro INR + $5 coupon', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'INR', couponCode: 'FIVE' }, ctx));
  await run('Pro USD + $5 coupon', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'USD', couponCode: 'FIVE' }, ctx));
  await run('Old plan INR (no priceInr; unchanged)', () => R.razorpayCreateOrder({ planId: 'OLD', currency: 'INR' }, ctx));
  await run('Pro autopay INR', () => S.razorpaySubscribe({ planId: 'PRO', currency: 'INR' }, ctx));
  // founding lock: member paid 699/19, later price rises
  DB['foundingPrices/u1'] = { plans: { PRO: { usd: 19, inr: 699 } } };
  DB['students/u1'] = { paidThroughMillis: Date.now() + 86400000 };
  DB['plans/PRO'] = Object.assign({}, DB['plans/PRO'], { salePrice: '', salePriceInr: '' });   // sale over: 49 / 2499
  await run('after sale, founding member USD', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'USD' }, ctx));
  await run('after sale, founding member INR', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'INR' }, ctx));
  await run('after sale, founding autopay', () => S.razorpaySubscribe({ planId: 'PRO', currency: 'INR' }, ctx));
  DB['students/u1'] = { paidThroughMillis: Date.now() - 10 * 86400000 };   // lapsed
  await run('after sale, LAPSED member USD', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'USD' }, ctx));
  delete DB['foundingPrices/u1'];
  await run('after sale, new member INR', () => R.razorpayCreateOrder({ planId: 'PRO', currency: 'INR' }, ctx));
  // founding price recorded after verify (sale active, seats left)
  DB['launchSaleConfig/main'] = { active: true, limit: 100, planIds: ['PRO'] };
  const L = require(require('path').join(__dirname,'../../functions-src/launchSale')).__launchInternals;
  console.log('record lock:', await L.recordFoundingPrice('u2', 'PRO', 19, 699), JSON.stringify(DB['foundingPrices/u2']).slice(0, 80));
  console.log('record again (no overwrite):', await L.recordFoundingPrice('u2', 'PRO', 49, 2499));
  DB['settings/commerce'].launchSale = { taken: 100 };
  console.log('record when sold out:', await L.recordFoundingPrice('u3', 'PRO', 19, 699));
})();
