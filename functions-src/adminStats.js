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

// Folds the projected student rows into the plan / MRR / completion figures.
// rows: [{ plan, completedChapters }]; plans: [{ name, price }];
// chapters: [{ id, num, title }]
function summarise(rows, plans, chapters) {
  const prices = planPriceMap(plans);
  const byPlan = {};
  let paid = 0;
  let mrr = 0;
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
    if (price > 0) { paid += 1; mrr += price; }

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
    byPlan: byPlan,
    mrr: Math.round(mrr * 100) / 100,
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

  const [totalUsers, new1, new7, new30, active1, active7, active30,
         upcomingSessions] = await Promise.all([
    countOf(students),
    countOf(students.where('createdAt', '>=', ts(windowStartDate(now, 1)))),
    countOf(students.where('createdAt', '>=', ts(windowStartDate(now, 7)))),
    countOf(students.where('createdAt', '>=', ts(windowStartDate(now, 30)))),
    countOf(students.where('lastActiveDate', '>=', windowStartStr(now, 1))),
    countOf(students.where('lastActiveDate', '>=', windowStartStr(now, 7))),
    countOf(students.where('lastActiveDate', '>=', windowStartStr(now, 30))),
    countOf(db.collection('liveSessions').where('startsAt', '>', ts(now)))
  ]);

  // Small collections: read whole, as the dashboard already did.
  const [planSnap, chapterSnap, rowSnap] = await Promise.all([
    db.collection('plans').get(),
    db.collection('chapters').get(),
    // Projection: only these two fields leave the database.
    students.select('plan', 'completedChapters').get()
  ]);
  const plans = planSnap.docs.map((d) => d.data());
  const chapters = chapterSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const rows = rowSnap.docs.map((d) => d.data());

  const sum = summarise(rows, plans, chapters);
  return Object.assign({
    totalUsers, new1, new7, new30, active1, active7, active30, upcomingSessions,
    tz: 'UTC',
    day: utcDateStr(now),
    mrrCurrency: null   // plan prices are stored as display strings; see handback
  }, sum);
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
exports._test = { summarise, planPriceMap, windowStartStr, windowStartDate, utcDateStr };
