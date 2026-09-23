/**
 * Stryker Trading Academy: launch sale (build 319).
 *
 *   PRICES   plans may carry fixed rupee prices (priceInr / salePriceInr).
 *            inrEffective(plan) is the rupee twin of effectivePlanPrice():
 *            same sale rules, same end-date handling. razorpay.js and
 *            razorpaySubs.js charge it for INR buyers when it is set, and
 *            fall back to USD x rate when it is not (unchanged behaviour).
 *
 *   FOUNDING the first `limit` paying members on a launch plan keep the
 *            price they joined at for as long as they stay subscribed.
 *            recordFoundingPrice() stores it after a verified payment in
 *            foundingPrices/{uid} (functions-only: default-deny covers it,
 *            so a student can never write their own price). foundingLock()
 *            returns it at the next checkout for the same plan while the
 *            account is paid up (a short grace period covers late renewals).
 *            A lock only ever LOWERS a price; it never raises one.
 *
 *   COUNTER  launchSaleOnOrder (orders/{id} onCreate) recounts the distinct
 *            members who paid real money for a launch plan since startAt and
 *            publishes { taken, limit, active } on settings/commerce.launchSale,
 *            the doc the site already reads signed-out (no rule change).
 *            Excluded: $0 / free-coupon orders, excludeUids (test accounts),
 *            excludeCoupons (TEST*). At 90 and 100 an alert doc is written to
 *            launchSaleAlerts/{90|100} (functions-only). Prices never change
 *            automatically.
 *
 * CONFIG launchSaleConfig/main (Admin SDK only; default-deny for clients):
 *   { active, startAt (Timestamp), limit: 100, planIds: [...],
 *     excludeUids: [...], excludeCoupons: [...] }
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;   // late renewal still keeps the lock

function num(v) {
  const n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

// Rupee price actually due for a plan, or null when it has no fixed rupee
// price. Mirrors effectivePlanPrice(): sale when salePriceInr parses, is below
// priceInr and saleEndsAt (whole-day inclusive) hasn't passed.
function inrEffective(plan) {
  const full = num(plan && plan.priceInr);
  if (full === null) return null;
  const sale = num(plan.salePriceInr);
  if (sale === null || sale < 0 || sale >= full || full <= 0) return Math.round(full);
  if (plan.saleEndsAt) {
    const d = new Date(plan.saleEndsAt);
    if (!isNaN(d.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(plan.saleEndsAt))) d.setHours(23, 59, 59, 999);
      if (Date.now() > d.getTime()) return Math.round(full);
    }
  }
  return Math.round(sale);
}

async function config() {
  const snap = await db.collection('launchSaleConfig').doc('main').get().catch(() => null);
  return snap && snap.exists ? snap.data() : null;
}

// The founding price for (uid, planId) if the member still qualifies:
// { usd, inr } (either may be null), or null.
async function foundingLock(uid, planId) {
  const [lockSnap, stuSnap] = await Promise.all([
    db.collection('foundingPrices').doc(uid).get().catch(() => null),
    db.collection('students').doc(uid).get().catch(() => null)
  ]);
  const lock = lockSnap && lockSnap.exists ? (lockSnap.data().plans || {})[planId] : null;
  if (!lock) return null;
  const paidThrough = stuSnap && stuSnap.exists ? (stuSnap.data().paidThroughMillis || 0) : 0;
  if (paidThrough + GRACE_MS < Date.now()) return null;   // lapsed: the lock is gone
  return { usd: num(lock.usd), inr: num(lock.inr) };
}

// After a verified payment: remember the price if this is a launch-plan
// purchase while seats remain. Never overwrites an existing lock.
async function recordFoundingPrice(uid, planId, baseUsd, baseInr) {
  const cfg = await config();
  if (!cfg || cfg.active !== true || !(cfg.planIds || []).includes(planId)) return false;
  const pub = await db.collection('settings').doc('commerce').get().catch(() => null);
  const taken = pub && pub.exists ? ((pub.data().launchSale || {}).taken || 0) : 0;
  if (taken >= (cfg.limit || 100)) return false;
  const ref = db.collection('foundingPrices').doc(uid);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const plans = cur.exists ? (cur.data().plans || {}) : {};
    if (plans[planId]) return false;
    plans[planId] = {
      usd: baseUsd != null ? baseUsd : null,
      inr: baseInr != null ? baseInr : null,
      lockedAt: admin.firestore.Timestamp.now()
    };
    tx.set(ref, { plans }, { merge: true });
    return true;
  }).catch((e) => { console.error('recordFoundingPrice', uid, e.message); return false; });
}

async function recount() {
  const cfg = await config();
  if (!cfg || !cfg.startAt) return null;
  const limit = cfg.limit || 100;
  const planIds = new Set(cfg.planIds || []);
  const exU = new Set(cfg.excludeUids || []);
  const exC = (cfg.excludeCoupons || []).map((c) => String(c).toUpperCase());
  const snap = await db.collection('orders').where('createdAt', '>=', cfg.startAt).get();
  const members = new Set();
  snap.forEach((d) => {
    const o = d.data();
    if (o.status !== 'completed' || !planIds.has(o.planId) || exU.has(o.studentUid)) return;
    if (!(Number(o.finalAmount) > 0)) return;                // free-coupon grants don't count
    const code = String(o.couponCode || '').toUpperCase();
    if (code && exC.some((c) => c.endsWith('*') ? code.startsWith(c.slice(0, -1)) : code === c)) return;
    members.add(o.studentUid);
  });
  const taken = Math.min(members.size, limit);
  await db.collection('settings').doc('commerce').set({
    launchSale: {
      active: cfg.active === true, limit, taken,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }
  }, { merge: true });
  for (const mark of [90, 100]) {
    if (members.size < mark) continue;
    const ref = db.collection('launchSaleAlerts').doc(String(mark));
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return;
      tx.set(ref, { mark, taken: members.size, at: admin.firestore.FieldValue.serverTimestamp() });
      console.warn('LAUNCH SALE: ' + members.size + ' of ' + limit + ' launch spots taken');
    });
  }
  return taken;
}

exports.launchSaleOnOrder = functions
  .runWith({ maxInstances: 1, timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('orders/{id}')
  .onCreate(async () => { await recount(); return null; });

// Not a function (the loader ignores it): shared with the payment files.
exports.__launchInternals = { inrEffective, foundingLock, recordFoundingPrice, recount };
