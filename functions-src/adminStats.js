// Stryker Trading Academy — admin analytics snapshot
//
// WHY THIS EXISTS
// The admin overview used to call db.collection('students').get() in the
// browser: every student document (names, emails, progress) downloaded to
// the admin's tab on every page load, just to show a handful of totals. That
// grows linearly with signups in both read cost and load time, and it puts
// every student's personal data in the browser for no reason.
//
// This function does the counting on the server and writes ONE small
// aggregate document the dashboard reads instead:
//
//   adminStats/current              latest snapshot (dashboard reads this)
//   adminStats/daily-YYYY-MM-DD     last snapshot of each UTC day (history)
//
// Neither contains any per-student data: counts, a plan histogram and
// per-chapter completion counts only. Rules: admin read, no client writes.
//
// TWO ENTRY POINTS
//   adminStatsScheduled  hourly
//   adminStatsRefresh    callable "Refresh now" button; admin only, checked
//                        server-side against admins/{uid} (never a client
//                        claim), and throttled so repeated clicks can't turn
//                        into repeated full scans.
//
// HOW THE NUMBERS ARE MADE
// Totals, new-user and active-user counts use aggregation count() queries,
// which are billed at one read per 1,000 index entries and never load a
// document. The plan histogram, MRR and chapter completion need per-student
// fields, so those come from ONE projected scan: select() asks Firestore for
// just plan + completedChapters, so names/emails never even reach this
// function's memory.
//
// TIME ZONE CAVEAT
// students.lastActiveDate is written by progress.js todayStr(), which uses
// the STUDENT'S LOCAL date, as a 'YYYY-MM-DD' string. The windows here are
// computed in UTC. "Active today" therefore means "last active date is
// today's UTC date", which can be off by a day for someone near midnight in
// a far-off time zone. Totals are unaffected; the edges of each window can
// shift by up to a day. Documented in the handback and data-sources.md.

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'us-central1';
const REFRESH_MIN_INTERVAL_MS = 60 * 1000;   // throttle for the manual button
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- pure helpers (unit-tested in tools/tests/admin-analytics/stats-unit.js)

function utcDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// First day of an N-day window that ends today (UTC), as YYYY-MM-DD.
// N=1 → today, N=7 → today and the 6 days before.
function windowStartStr(now, days) {
  return utcDateStr(new Date(now.getTime() - (days - 1) * DAY_MS));
}

// Start of an N-day window as a Date at 00:00 UTC, for createdAt timestamps.
function windowStartDate(now, days) {
  return new Date(windowStartStr(now, days) + 'T00:00:00.000Z');
}

// ---- Bot records
//
// The trading-floor bots (functions-src/marketBots.js, mirrorTweets.js) write
// profile/post records under a generated `bot-<id>` uid, and one of those ids
// had also ended up in students/, where it was counted as a user. Bots are not
// people, so the aggregation skips them entirely: they must be invisible to
// every derived number, not subtracted from one line.
//
// PREFIX ONLY, deliberately. The rule is exactly the generated prefix and
// nothing else — no regex over the whole id, no name/email matching, no
// "looks like a test" heuristic. An id that merely CONTAINS "bot-" (robot-abc,
// xbot-1) is a real user and still counts. This mirrors the existing browser
// helper in assets/team-identity.js (`uid.indexOf('bot-') === 0`).
const BOT_UID_PREFIX = 'bot-';

function isBotUid(id) {
  return typeof id === 'string' && id.indexOf(BOT_UID_PREFIX) === 0;
}

// Window counts derived from the same projected scan the plan/MRR figures
// use, rather than from count() aggregations.
//
// WHY NOT count(): an aggregation cannot skip documents by id prefix, so with
// count() a bot record would still land in totalUsers/new*/active* even though
// it is filtered out of everything else — exactly the "subtracted from one
// line" outcome this change exists to avoid. The projected scan already reads
// every student document, so deriving the windows from it adds no document
// reads (it removes seven queries) and lets one filter govern every number.
//
// Field semantics mirror the queries this replaces, so the numbers do not
// move for real users: `createdAt >= <Timestamp>` matched only documents whose
// createdAt is a Timestamp, and `lastActiveDate >= '<YYYY-MM-DD>'` matched only
// string values. Documents missing the field, or holding another type, were
// never matched by those queries and are not counted here either.
function countWindows(rows, now) {
  const out = { totalUsers: rows.length, new1: 0, new7: 0, new30: 0, active1: 0, active7: 0, active30: 0 };
  const createdCut = { 1: windowStartDate(now, 1).getTime(), 7: windowStartDate(now, 7).getTime(), 30: windowStartDate(now, 30).getTime() };
  const activeCut = { 1: windowStartStr(now, 1), 7: windowStartStr(now, 7), 30: windowStartStr(now, 30) };
  rows.forEach((s) => {
    const c = s.createdAt;
    const ms = c && typeof c.toMillis === 'function' ? c.toMillis()
      : (c instanceof Date ? c.getTime() : null);
    if (ms !== null) {
      [1, 7, 30].forEach((d) => { if (ms >= createdCut[d]) out['new' + d] += 1; });
    }
    const la = s.lastActiveDate;
    if (typeof la === 'string') {
      [1, 7, 30].forEach((d) => { if (la >= activeCut[d]) out['active' + d] += 1; });
    }
  });
  return out;
}

// Same price parsing as the old browser renderAdminStats: strip everything
// but digits and the decimal point. Returns a map of lower-cased plan NAME
// to price (students store their plan as a name string).
function planPriceMap(plans) {
  const map = {};
  (plans || []).forEach((p) => {
    if (!p || !p.name) return;
    const price = parseFloat(String(p.price || '0').replace(/[^0-9.]/g, '')) || 0;
    map[String(p.name).toLowerCase()] = price;
  });
  return map;
}

// ---- THE PAID RULE -------------------------------------------------------
//
// This is the rule. The code below implements it; read the rule, not the code.
//
// A student counts as PAID only if BOTH hold:
//   (a) there is a real gateway record proving money moved — an active/valid
//       Stripe subscription, OR an active Razorpay subscription, OR a paid
//       order with a non-zero COLLECTED amount; AND
//   (b) paidThroughMillis is in the future.
//
// The following are NOT paid, full stop:
//   - a free / zero-value coupon (WELCOME, BETA, FREE, or any coupon whose
//     type is 'free' or whose value is 0)
//   - a zero-amount order (freeCheckout.js writes finalAmount:0, gateway
//     'coupon' — an order row is therefore NOT by itself proof of payment)
//   - foundingMember
//   - a hand-set plan label with no gateway record anywhere
//   - expired or grace entitlements, whether or not they once counted
//
// Why this exists: MRR and the paid count used to be derived from the plan
// LABEL alone, so every comped, founding and free-checkout account was
// reported at full list price. The 2026-09-28 revenue audit measured the
// damage: 29 of 30 "paid" members had never paid anything, and $3,741 of a
// reported $3,870 MRR was free access.
//
// A student is reported in exactly ONE of three buckets, and the dashboard
// shows all three rather than a single blended "paid" figure:
//   payingMembers      — meets the rule above
//   freeAccessMembers  — paid-looking label, no payment evidence (with the
//                        reason, where known)
//   expiredMembers     — had an entitlement, paidThroughMillis now in the past
//
// MONEY IS COUNTED IN USD. Gateway charges are converted, never summed
// unitless across currencies: Razorpay orders carry amountUsd (razorpay.js),
// and an order with a foreign currency but NO amountUsd is excluded from MRR
// and counted in mrrUnconvertible rather than guessed at with an fx rate.

const FREE_GATEWAYS = ['coupon', 'free', 'manual', 'admin'];

// A coupon proves free access when the catalogue says it is free/zero-value.
function isFreeCoupon(code, couponsByCode) {
  if (!code) return false;
  const c = couponsByCode[String(code).toUpperCase()] || couponsByCode[String(code)];
  if (!c) return false;
  return String(c.type).toLowerCase() === 'free' || Number(c.value) === 0;
}

// The USD amount an order actually COLLECTED, or null when it cannot be known.
// null is deliberate: it means "unconvertible", not "zero".
function collectedUsd(order) {
  const final = Number(order && order.finalAmount);
  if (!(final > 0)) return 0;                       // zero-amount order: no money moved
  if (order.amountUsd != null && Number(order.amountUsd) > 0) return Number(order.amountUsd);
  if (String(order.currency || '').toUpperCase() === 'USD') return final;
  return null;                                      // foreign currency, no amountUsd
}

// When an order was placed, in millis; 0 when unknown so it sorts last.
function orderMillis(order) {
  const c = order && order.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (typeof c === 'number') return c;
  const p = Date.parse(c);
  return Number.isFinite(p) ? p : 0;
}

// Does this order prove money moved? Gateway must be a real one, the amount
// must be non-zero, and a free coupon disqualifies it whatever else it says.
function orderProvesPayment(order, couponsByCode) {
  if (!order) return false;
  const gw = String(order.gateway || order.provider || '').toLowerCase();
  if (!gw || FREE_GATEWAYS.indexOf(gw) !== -1) return false;
  if (isFreeCoupon(order.couponCode, couponsByCode)) return false;
  const status = String(order.status || '').toLowerCase();
  if (status && ['failed', 'cancelled', 'canceled', 'refunded', 'created'].indexOf(status) !== -1) return false;
  return Number(order.finalAmount) > 0;
}

// Classifies ONE student against the rule. Returns the bucket plus the
// evidence that decided it, so the dashboard can show a reason and a human
// can audit the number without re-deriving it.
function classifyPayment(row, evidence, couponsByCode, nowMs) {
  const listPrice = evidence.listPrice || 0;
  if (!(listPrice > 0)) return { bucket: 'unpaidPlan' };   // Starter/no plan: not a revenue question

  const orders = (evidence.orders || []).filter((o) => orderProvesPayment(o, couponsByCode));
  const subActive = !!evidence.stripeSubActive || !!evidence.razorpaySubActive;
  const hasGatewayProof = subActive || orders.length > 0;
  const paidThrough = Number(row.paidThroughMillis);
  const currentPeriod = Number.isFinite(paidThrough) && paidThrough > nowMs;

  if (!hasGatewayProof) {
    let reason = 'hand-set label, no gateway record';
    if (row.foundingMember) reason = 'founding grant';
    else if (row.foundingCoupon) reason = 'free coupon ' + row.foundingCoupon;
    else {
      const freeCoupon = (evidence.orders || [])
        .map((o) => o.couponCode).filter((c) => isFreeCoupon(c, couponsByCode))[0];
      if (freeCoupon) reason = 'free coupon ' + freeCoupon;
      else if ((evidence.orders || []).length) reason = 'zero-amount order';
    }
    return { bucket: 'freeAccess', reason: reason };
  }
  if (!currentPeriod) return { bucket: 'expired', reason: 'paid once, entitlement expired' };

  // Paid. MRR is the CURRENT RECURRING charge, not lifetime revenue: summing
  // every order a member ever placed would report six months of $19 as $114
  // of monthly recurring. So take the most recent qualifying order — the one
  // that bought the period we are currently in — and use its collected USD.
  const sorted = orders.slice().sort((a, b) => orderMillis(b) - orderMillis(a));
  const latest = sorted[0];
  const usd = collectedUsd(latest);
  if (usd === null) {
    // Foreign currency with no amountUsd: a paying member whose amount we
    // refuse to guess. Counted as an exception, contributing 0 to MRR.
    return { bucket: 'paying', amount: 0, unconvertible: 1 };
  }
  let amount = usd;
  // A live subscription with no convertible order still counts as a paying
  // member; its recurring amount is the sale/list price of the plan.
  if (!amount && subActive) amount = evidence.chargePrice || listPrice;
  return { bucket: 'paying', amount: amount, unconvertible: 0 };
}

// Folds the projected student rows into the plan / MRR / completion figures.
// rows: [{ plan, completedChapters }]; plans: [{ name, price }];
// chapters: [{ id, num, title }]
function summarise(rows, plans, chapters, payment) {
  const prices = planPriceMap(plans);
  const pay = payment || {};
  const couponsByCode = pay.couponsByCode || {};
  const ordersByUid = pay.ordersByUid || {};
  const subsByUid = pay.subsByUid || {};
  const nowMs = pay.nowMs || Date.now();
  const byPlan = {};
  let paid = 0;
  let mrr = 0;
  let payingMembers = 0;
  let freeAccessMembers = 0;
  let expiredMembers = 0;
  let mrrUnconvertible = 0;
  const freeAccessReasons = {};
  const chapterCompletions = {};
  const chapterTitles = {};
  (chapters || []).forEach((ch) => {
    const id = String(ch.num || ch.id);
    chapterCompletions[id] = 0;
    chapterTitles[id] = ch.title || ('Chapter ' + id);
  });
  const totalChapters = (chapters && chapters.length) || 42;

  let started = 0;
  let completionSum = 0;
  rows.forEach((s) => {
    const plan = s.plan ? String(s.plan) : 'No plan';
    byPlan[plan] = (byPlan[plan] || 0) + 1;
    const price = s.plan ? (prices[String(s.plan).toLowerCase()] || 0) : 0;

    // THE PAID RULE (see the block above). The plan label alone decides
    // nothing about revenue: it only tells us whether this student is a
    // revenue question at all. Payment evidence decides the rest.
    const uid = s.__uid || s.uid;
    const verdict = classifyPayment(s, {
      listPrice: price,
      chargePrice: price,
      orders: ordersByUid[uid] || [],
      stripeSubActive: !!(subsByUid[uid] && subsByUid[uid].stripe),
      razorpaySubActive: !!(subsByUid[uid] && subsByUid[uid].razorpay)
    }, couponsByCode, nowMs);

    if (verdict.bucket === 'paying') {
      payingMembers += 1;
      mrr += verdict.amount || 0;
      mrrUnconvertible += verdict.unconvertible || 0;
      paid += 1;                       // legacy key: now means PAYING, never a grant
    } else if (verdict.bucket === 'freeAccess') {
      freeAccessMembers += 1;
      freeAccessReasons[verdict.reason] = (freeAccessReasons[verdict.reason] || 0) + 1;
    } else if (verdict.bucket === 'expired') {
      expiredMembers += 1;
    }

    // Only chapters that exist in the catalogue count, so a stale id in a
    // student's array can't invent a chapter row or push completion past
    // 100%. (With no catalogue loaded, fall back to the raw array.)
    const raw = Array.isArray(s.completedChapters) ? s.completedChapters.map(String) : [];
    const known = chapters && chapters.length
      ? raw.filter((id) => Object.prototype.hasOwnProperty.call(chapterCompletions, id))
      : raw;
    const done = Array.from(new Set(known));
    if (done.length) {
      started += 1;
      completionSum += Math.min(1, done.length / totalChapters);
    }
    done.forEach((id) => {
      if (Object.prototype.hasOwnProperty.call(chapterCompletions, id)) chapterCompletions[id] += 1;
    });
  });

  return {
    scanned: rows.length,
    paid: paid,
    free: rows.length - paid,
    // The three numbers that must never be blended into one "paid" figure.
    payingMembers: payingMembers,
    freeAccessMembers: freeAccessMembers,
    expiredMembers: expiredMembers,
    freeAccessReasons: freeAccessReasons,
    byPlan: byPlan,
    mrr: Math.round(mrr * 100) / 100,
    mrrCurrency: 'USD',
    // Orders in a foreign currency with no amountUsd: excluded from mrr and
    // counted here rather than guessed at with an fx rate.
    mrrUnconvertible: mrrUnconvertible,
    startedCount: started,
    // null, not 0, when nobody has started: "no data" is not "0% completion".
    avgCompletion: started ? Math.round((completionSum / started) * 100) : null,
    chapterCompletions: chapterCompletions,
    chapterTitles: chapterTitles
  };
}

// ---- Firestore work

async function countOf(query) {
  const snap = await query.count().get();
  return snap.data().count;
}

async function buildStats(db, now) {
  const students = db.collection('students');
  const ts = (d) => admin.firestore.Timestamp.fromDate(d);

  const upcomingSessions = await countOf(
    db.collection('liveSessions').where('startsAt', '>', ts(now))
  );

  // Small collections: read whole, as the dashboard already did.
  // orders/coupons/razorpaySubs are the PAYMENT EVIDENCE the paid rule needs:
  // the plan label cannot prove money moved. orders is projected with select()
  // so only the money fields leave the database, never names or emails.
  const [planSnap, chapterSnap, rowSnap, orderSnap, couponSnap, rzSubSnap] = await Promise.all([
    db.collection('plans').get(),
    db.collection('chapters').get(),
    // Projection: only these fields leave the database. createdAt and
    // lastActiveDate are dates, not personal data, and they let the window
    // counts honour the bot filter (see countWindows). The payment fields
    // are what the paid rule tests condition (b) and the free-access
    // reasons against.
    students.select('plan', 'completedChapters', 'createdAt', 'lastActiveDate',
      'paidThroughMillis', 'subscriptionStatus', 'foundingMember', 'foundingCoupon').get(),
    db.collection('orders').select('studentUid', 'finalAmount', 'currency', 'amountUsd',
      'gateway', 'provider', 'status', 'couponCode', 'stripeSubscriptionId',
      'razorpayPaymentId', 'createdAt').get(),
    db.collection('coupons').select('type', 'value').get(),
    db.collection('razorpaySubs').select('uid', 'status').get()
  ]);
  const plans = planSnap.docs.map((d) => d.data());
  const chapters = chapterSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

  // ---- payment evidence, indexed by uid ----
  const couponsByCode = {};
  couponSnap.docs.forEach((d) => { couponsByCode[String(d.id).toUpperCase()] = d.data(); });

  const ordersByUid = {};
  orderSnap.docs.forEach((d) => {
    const o = d.data();
    const uid = o.studentUid;
    if (!uid) return;
    (ordersByUid[uid] = ordersByUid[uid] || []).push(o);
  });

  // An active Stripe subscription is proved by a completed order carrying a
  // stripeSubscriptionId: stripe.js writes that row only after the payment
  // succeeds, and stripeSubs/stripeInvoices do not exist in this database.
  const subsByUid = {};
  orderSnap.docs.forEach((d) => {
    const o = d.data();
    if (o.studentUid && o.stripeSubscriptionId &&
        String(o.gateway || o.provider || '').toLowerCase() === 'stripe') {
      subsByUid[o.studentUid] = Object.assign({}, subsByUid[o.studentUid], { stripe: true });
    }
  });
  rzSubSnap.docs.forEach((d) => {
    const s = d.data();
    const live = ['active', 'authenticated', 'completed', 'charged'].indexOf(
      String(s.status || '').toLowerCase()) !== -1;
    if (s.uid && live) {
      subsByUid[s.uid] = Object.assign({}, subsByUid[s.uid], { razorpay: true });
    }
  });

  // THE bot filter. Applied once, here, before anything is derived, so a bot
  // record reaches no number at all. The doc id is carried through as __uid
  // so the paid rule can find each student's payment evidence.
  const rows = rowSnap.docs
    .filter((d) => !isBotUid(d.id))
    .map((d) => Object.assign({ __uid: d.id }, d.data()));

  const windows = countWindows(rows, now);
  const sum = summarise(rows, plans, chapters, {
    couponsByCode: couponsByCode,
    ordersByUid: ordersByUid,
    subsByUid: subsByUid,
    nowMs: now.getTime()
  });
  return Object.assign({
    upcomingSessions,
    tz: 'UTC',
    day: utcDateStr(now)
  }, windows, sum);   // summarise() sets mrrCurrency: 'USD'
}

async function writeSnapshot(db, trigger) {
  const now = new Date();
  const stats = await buildStats(db, now);
  const col = db.collection('adminStats');
  const currentRef = col.doc('current');

  // seriesStart = the first day any daily doc was written. Kept on the
  // current doc so the dashboard can say "Trend starts <date>" without
  // scanning the collection.
  const prev = await currentRef.get();
  const seriesStart = (prev.exists && prev.data().seriesStart) || stats.day;

  const doc = Object.assign({}, stats, {
    seriesStart: seriesStart,
    trigger: trigger,
    generatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const batch = db.batch();
  batch.set(currentRef, doc);
  batch.set(col.doc('daily-' + stats.day), doc);
  await batch.commit();
  return { day: stats.day, totalUsers: stats.totalUsers };
}

exports.adminStatsScheduled = functions
  .region(REGION)
  .runWith({ maxInstances: 1, timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 60 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const out = await writeSnapshot(admin.firestore(), 'schedule');
    console.log('adminStatsScheduled wrote', out.day, 'totalUsers', out.totalUsers);
    return null;
  });

exports.adminStatsRefresh = functions
  .region(REGION)
  .runWith({ maxInstances: 1, timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    const db = admin.firestore();
    const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
    if (!adminDoc.exists) {
      throw new functions.https.HttpsError('permission-denied', 'Admins only.');
    }
    // Throttle: a fresh snapshot is returned as-is instead of re-scanning.
    const cur = await db.collection('adminStats').doc('current').get();
    const at = cur.exists && cur.data().generatedAt && cur.data().generatedAt.toMillis
      ? cur.data().generatedAt.toMillis() : 0;
    if (at && Date.now() - at < REFRESH_MIN_INTERVAL_MS) {
      return { ok: true, throttled: true };
    }
    const out = await writeSnapshot(db, 'manual');
    return { ok: true, throttled: false, day: out.day };
  });

// Exported for the unit test only.
exports._test = { summarise, planPriceMap, windowStartStr, windowStartDate, utcDateStr, isBotUid, countWindows, buildStats, classifyPayment, orderProvesPayment, collectedUsd, isFreeCoupon };
