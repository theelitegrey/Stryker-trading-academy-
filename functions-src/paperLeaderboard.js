// TradeZoro — PAPER TRADING LEADERBOARD (scheduled, every 15 minutes)
//
// Owner order 2026-10-14: "Paper trading leaderboard + trade review". Opt-in, privacy first,
// demo money only. The CLIENT NEVER WRITES A RANK: members only write their own opt-in profile
// (students/{uid}/paperTrading/public { optIn, displayName, updatedAt }, rules-validated). This
// job reads the paper account of every opted-in member with the Admin SDK and writes three
// public read-only docs:
//
//   leaderboards/paper-week    this week  (Monday 00:00 UTC ->)
//   leaderboards/paper-month   this month (the 1st 00:00 UTC ->)
//   leaderboards/paper-all     all time (the current run)
//
// Each doc: { period, from, generatedAt, minTrades, rows: [top 50], ranks: { <key>: {rank} or
// {need, trades} }, disclaimer }. A row carries ONLY: rank, the display name the member typed,
// % return on the starting demo balance, trade count, win rate, max drawdown %, a leverage flag,
// and key = sha256(uid) first 16 hex chars, so a signed-in member's browser finds "your rank" by
// hashing its own uid. One-way: it does not reveal the uid. No email, no real name, no balances,
// no symbols, no trades.
//
// SCORING + ANTI-GAMING: functions-src/paper-stats.js, a byte-for-byte copy of
// assets/paper-review-stats.js (tools/tests/paper-review-stats.test.js asserts they match), so the
// review page and the leaderboard agree:
//   - % return on the starting demo balance of the CURRENT run (a reset starts a new run);
//   - bar-replay trades never count (they are tagged src='replay' and never reach the cloud doc);
//   - trades held < 5 s are excluded; trades whose P&L does not match their own prices are
//     excluded (a hand-edited state cannot add money); trades "closed in the future" excluded;
//   - over 20x notional / balance flags the row ("High leverage") instead of ranking silently;
//   - minimum 10 eligible closed trades in the period to be ranked.
// Opting out: the member's public doc says optIn false (or is deleted); the next run (within
// 15 minutes) drops the row. The client hides its own row at once.
//
// Cost: one query on the collection group 'paperTrading' filtered optIn == true (single-field
// index, automatic), then one doc read per opted-in member. Capped at MAX_MEMBERS per run.
//
// Demo account. Simulated results, not real trading. Education only. Not financial advice.
// Leaderboard numbers are never used in marketing (Owner rule: results need the Owner's signature).

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const S = require('./paper-stats');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'us-central1';
const PERIODS = ['week', 'month', 'all'];
const TOP = 50;
const MAX_MEMBERS = 5000;
const NAME_RE = /^[\p{L}\p{N} ._'-]{2,24}$/u;

function keyOf(uid) { return crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 16); }
function cleanName(n) {
  const s = String(n || '').replace(/\s+/g, ' ').trim();
  return NAME_RE.test(s) ? s : null;
}

/**
 * Pure: members = [{ uid, displayName, state (parsed object) }] -> { week, month, all } docs.
 * Exported for tests (tools/tests/paper-leaderboard.test.js).
 */
function build(members, now) {
  const out = {};
  for (const period of PERIODS) {
    const rows = [], ranks = {};
    for (const m of members) {
      const name = cleanName(m.displayName);
      if (!name || !m.state) continue;
      const sc = S.score(m.state, period, now);
      if (!sc) continue;
      const key = keyOf(m.uid);
      const row = { key, name, returnPct: sc.returnPct, trades: sc.trades, winRate: sc.winRate, maxDDPct: sc.maxDDPct, flagged: sc.flagged, ranked: sc.ranked };
      if (sc.ranked) rows.push(row);
      else ranks[key] = { need: sc.need, trades: sc.trades };
    }
    const ranked = S.rank(rows);
    for (const r of ranked) ranks[r.key] = { rank: r.rank };
    out[period] = {
      period, from: S.periodStart(period, now), minTrades: S.MIN_TRADES, minHoldMs: S.MIN_HOLD_MS, levFlag: S.LEV_FLAG,
      ranked: ranked.length, members: members.length,
      rows: ranked.slice(0, TOP).map((r) => ({ rank: r.rank, key: r.key, name: r.name, returnPct: r.returnPct, trades: r.trades, winRate: r.winRate, maxDDPct: r.maxDDPct, flagged: r.flagged })),
      // "your rank" beyond the top 50 (and how many trades an unranked member still needs)
      ranks,
      disclaimer: S.DISCLAIMER
    };
  }
  return out;
}

// Opted-in profile docs. Fast path: a collection-group query on optIn (needs the collection-group
// single-field index on paperTrading.optIn, see DEPLOY.md). If that index is missing Firestore
// answers FAILED_PRECONDITION; then fall back to listing students and reading each 'public' doc
// (one read per student, still correct, just dearer) so the board never silently goes empty.
async function optedIn(db) {
  try {
    const snap = await db.collectionGroup('paperTrading').where('optIn', '==', true).limit(MAX_MEMBERS).get();
    return snap.docs;
  } catch (e) {
    if (!(e && (e.code === 9 || /FAILED_PRECONDITION|index/i.test(String(e.message))))) throw e;
    console.warn('paperLeaderboard: collection-group index missing, scanning students instead');
    const refs = await db.collection('students').listDocuments();
    const out = [];
    for (let i = 0; i < refs.length; i += 300) {
      const docs = await db.getAll(...refs.slice(i, i + 300).map((r) => r.collection('paperTrading').doc('public')));
      for (const d of docs) if (d.exists && d.get('optIn') === true) out.push(d);
      if (out.length >= MAX_MEMBERS) break;
    }
    return out;
  }
}

async function collect(db) {
  const docs = await optedIn(db);
  const members = [];
  for (const d of docs) {
    if (d.id !== 'public') continue;
    const studentRef = d.ref.parent.parent;           // students/{uid}
    if (!studentRef || studentRef.parent.id !== 'students') continue;
    const uid = studentRef.id;
    let state = null;
    try {
      const acc = await studentRef.collection('paperTrading').doc('account').get();
      const raw = acc.exists ? acc.get('state') : null;
      state = typeof raw === 'string' && raw.length <= 400000 ? JSON.parse(raw) : null;
    } catch (e) { state = null; }
    members.push({ uid, displayName: d.get('displayName'), state });
  }
  return members;
}

async function run(db, now) {
  const members = await collect(db);
  const docs = build(members, now);
  const batch = db.batch();
  for (const p of PERIODS) batch.set(db.collection('leaderboards').doc('paper-' + p), Object.assign({}, docs[p], { generatedAt: admin.firestore.FieldValue.serverTimestamp() }));
  await batch.commit();
  return { members: members.length, ranked: PERIODS.map((p) => p + ':' + docs[p].ranked).join(' ') };
}

exports.paperLeaderboard = functions
  .region(REGION)
  .runWith({ maxInstances: 1, timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 15 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const out = await run(admin.firestore(), Date.now());
    console.log('paperLeaderboard', out.members, 'opted in;', out.ranked);
    return null;
  });

exports._paperLeaderboardTest = { build, keyOf, cleanName, collect, optedIn, run };
