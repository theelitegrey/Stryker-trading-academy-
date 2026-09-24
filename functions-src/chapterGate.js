/**
 * Chapter gate — keeps the server-side access data for paid chapter text.
 *
 *   chapters/{id}       catalog (title, level, lesson titles, teaser): any member
 *   chapterBodies/{id}  the text itself; Firestore rules allow a read when
 *                       minRank == 0 or the reader's plan rank >= minRank
 *   settings/planAccess { rankByPlan: { <plan name or id>: rank } }
 *
 * The rules can't parse a plan's "chapterAccess" string ("1-7", "all"), so the
 * answer is precomputed here into each body's minRank:
 *   minRank = the lowest rank of any plan that the client-side gate
 *             (roles.js hasChapterNumberAccess + the chapter's own minRole)
 *             would let read the chapter.
 * It is recomputed whenever a plan changes and whenever a body is written,
 * so an admin editing plans or chapters can't leave the two gates disagreeing.
 *
 *   syncPlanAccess     firestore — plans/{id} written        → planAccess + all minRanks
 *   chapterBodyMinRank firestore — chapterBodies/{id} written → that body's minRank
 */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Same parsing as roles.js chapterLimitOf: "all"/blank/unknown → no limit.
function chapterLimit(raw) {
  if (!raw || typeof raw !== 'string') return Infinity;
  const t = raw.trim().toLowerCase();
  if (!t || t === 'all') return Infinity;
  let m = t.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return parseInt(m[2], 10);
  m = t.match(/^(\d+)$/);
  if (m) return parseInt(m[1], 10);
  return Infinity;
}

function planList(snap) {
  const plans = [];
  snap.forEach((d) => {
    const p = d.data() || {};
    plans.push({ id: d.id, name: p.name || d.id, rank: Number(p.rank) || 0, limit: chapterLimit(p.chapterAccess) });
  });
  return plans;
}

function rankByPlan(plans) {
  const out = {};
  // Students store the plan NAME; a few older docs store the id. Map both.
  // Where two plans share a name (Pro monthly + hidden Pro yearly) the lower
  // rank wins, which is the conservative reading.
  for (const p of plans) {
    for (const k of [p.name, p.id]) {
      if (!(k in out) || p.rank < out[k]) out[k] = p.rank;
    }
  }
  return out;
}

// id "08" → 8; track ids like "VP-01" have no number, so a finite chapter
// limit never covers them (they need a plan with chapterAccess "all").
function minRankFor(id, minRole, plans, ranks) {
  const n = /^\d+$/.test(id) ? parseInt(id, 10) : Infinity;
  const roleRank = minRole ? (ranks[minRole] ?? 0) : 0;
  const ok = plans.filter((p) => p.rank >= roleRank && n <= p.limit).map((p) => p.rank);
  if (ok.length) return Math.min(...ok);
  // No plan qualifies: only admins may read it.
  return plans.length ? Math.max(...plans.map((p) => p.rank)) + 1 : 99;
}

async function loadPlans(db) {
  const plans = planList(await db.collection('plans').get());
  return { plans, ranks: rankByPlan(plans) };
}

exports.syncPlanAccess = onDocumentWritten({ document: 'plans/{id}', region: 'us-central1', maxInstances: 1 }, async () => {
  const db = admin.firestore();
  const { plans, ranks } = await loadPlans(db);
  await db.doc('settings/planAccess').set({ rankByPlan: ranks, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const bodies = await db.collection('chapterBodies').get();
  const batch = db.batch();
  let n = 0;
  bodies.forEach((d) => {
    const want = minRankFor(d.id, d.get('minRole'), plans, ranks);
    if (d.get('minRank') !== want) { batch.update(d.ref, { minRank: want }); n++; }
  });
  if (n) await batch.commit();
  console.log('syncPlanAccess: ranks', JSON.stringify(ranks), '| minRank changed on', n, 'bodies');
});

exports.chapterBodyMinRank = onDocumentWritten({ document: 'chapterBodies/{id}', region: 'us-central1', maxInstances: 2 }, async (event) => {
  const after = event.data && event.data.after;
  if (!after || !after.exists) return;
  const db = admin.firestore();
  const { plans, ranks } = await loadPlans(db);
  const want = minRankFor(event.params.id, after.get('minRole'), plans, ranks);
  if (after.get('minRank') !== want) {
    await after.ref.update({ minRank: want });
    console.log('chapterBodyMinRank:', event.params.id, '→', want);
  }
});

exports._test = { chapterLimit, rankByPlan, minRankFor };
