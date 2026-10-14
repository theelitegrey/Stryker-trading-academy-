// Unit tests for functions-src/paperLeaderboard.js (Paper trading leaderboard, 2026-10-14).
// Node only, no network, no Firebase: firebase-functions / firebase-admin are stubbed via the
// module cache and Firestore is a tiny in-memory fake.
// Run: node tools/tests/paper-leaderboard.test.js
const path = require('path');
const Module = require('module');
const assert = require('assert');
const fs = require('fs');

const FN = path.join(__dirname, '..', '..', 'functions-src');
// ---- stub the two SDK modules the function requires ----
let scheduled = null;
const chain = { region() { return chain; }, runWith() { return chain; }, pubsub: { schedule(s) { scheduled = s; return { timeZone() { return { onRun(fn) { return { __run: fn }; } }; } }; } } };
const adminStub = { apps: [1], initializeApp() {}, firestore: Object.assign(() => { throw new Error('not in tests'); }, { FieldValue: { serverTimestamp: () => '__ts__' } }) };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { if (req === 'firebase-functions/v1' || req === 'firebase-admin') return req; return origResolve.call(this, req, ...a); };
require.cache['firebase-functions/v1'] = { id: 'f', filename: 'f', loaded: true, exports: chain };
require.cache['firebase-admin'] = { id: 'a', filename: 'a', loaded: true, exports: adminStub };

const mod = require(path.join(FN, 'paperLeaderboard.js'));
const T = mod._paperLeaderboardTest;

let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } }

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);          // Wed 14 Oct 2026
const DAY = 86400000;
// a consistent closed trade (pnl matches prices, so it passes the integrity check)
function tr(i, pnl, o) {
  o = o || {};
  const exitAt = o.exitAt != null ? o.exitAt : NOW - DAY + i * 60000;
  const entry = 100, qty = 1, mult = 1;
  return Object.assign({ id: 't' + i, symbol: 'BTCUSD', side: 'buy', qty, entry, exit: entry + pnl / (qty * mult), pnl, fees: 0, pointValue: mult,
    entryAt: exitAt - (o.hold != null ? o.hold : 600000), exitAt, sl0: 99, run: RESET, src: 'paper', lev: o.lev || 1 }, o.extra || {});
}
// engine shape: resetAt = start of the current run; each trade carries run = the resetAt it was made under
const RESET = NOW - 60 * DAY;
function acct(trades, extra) { return Object.assign({ v: 1, startBalance: 100000, balance: 100000, resetAt: RESET, trades }, extra || {}); }
const ten = (pnl, o) => Array.from({ length: 10 }, (_, i) => tr(i, pnl, o));

(async () => {
  await test('functions-src/paper-stats.js is a byte copy of assets/paper-review-stats.js', () => {
    assert.strictEqual(fs.readFileSync(path.join(FN, 'paper-stats.js'), 'utf8'), fs.readFileSync(path.join(FN, '..', 'assets', 'paper-review-stats.js'), 'utf8'));
  });
  await test('exported as a 15-minute schedule and wired in index.js', () => {
    assert.strictEqual(scheduled, 'every 15 minutes');
    assert.ok(mod.paperLeaderboard && mod.paperLeaderboard.__run);
    assert.ok(/exports\.paperLeaderboard = require\('\.\/paperLeaderboard'\)\.paperLeaderboard/.test(fs.readFileSync(path.join(FN, 'index.js'), 'utf8')));
  });
  await test('key is a one-way 16-hex hash, stable per uid', () => {
    assert.ok(/^[0-9a-f]{16}$/.test(T.keyOf('alice')));
    assert.strictEqual(T.keyOf('alice'), T.keyOf('alice'));
    assert.notStrictEqual(T.keyOf('alice'), T.keyOf('bob'));
  });
  await test('display names: trimmed, 2-24 safe chars, no emails or markup', () => {
    assert.strictEqual(T.cleanName('  Alice   T. '), 'Alice T.');
    assert.strictEqual(T.cleanName('a@b.co'), null);
    assert.strictEqual(T.cleanName('<b>x</b>'), null);
    assert.strictEqual(T.cleanName('A'), null);
    assert.strictEqual(T.cleanName('x'.repeat(25)), null);
  });
  await test('ranks by % return, min 10 trades, rows carry no uid / email / balances', () => {
    const out = T.build([
      { uid: 'alice', displayName: 'Alice', state: acct(ten(100)) },     // +1.00%
      { uid: 'bob', displayName: 'Bob', state: acct(ten(300)) },         // +3.00%
      { uid: 'cara', displayName: 'Cara', state: acct(ten(50).slice(0, 9)) }, // 9 trades: unranked
      { uid: 'dan', displayName: 'a@b.co', state: acct(ten(900)) },      // bad name: skipped
    ], NOW);
    const w = out.week;
    assert.deepStrictEqual(w.rows.map((r) => [r.rank, r.name, r.returnPct]), [[1, 'Bob', 3], [2, 'Alice', 1]]);
    assert.strictEqual(w.ranks[T.keyOf('alice')].rank, 2);
    assert.deepStrictEqual(w.ranks[T.keyOf('cara')], { need: 1, trades: 9 });
    assert.ok(!w.ranks[T.keyOf('dan')]);
    const json = JSON.stringify(out);
    for (const bad of ['"alice"', 'bob"', 'balance', 'startBalance', 'BTCUSD', '@']) assert.ok(!json.includes(bad), 'leaks ' + bad);
    assert.deepStrictEqual(Object.keys(w.rows[0]).sort(), ['flagged', 'key', 'maxDDPct', 'name', 'rank', 'returnPct', 'trades', 'winRate']);
    assert.ok(/Demo account\. Simulated results, not real trading\. Education only\. Not financial advice\./.test(w.disclaimer));
  });
  await test('anti-gaming: replay trades, < 5 s holds, old runs and doctored P&L never count', () => {
    const good = ten(100);
    const junk = [
      tr(20, 5000, { extra: { src: 'replay' } }),
      tr(21, 5000, { hold: 3000 }),
      tr(22, 5000, { extra: { run: RESET - DAY } }),          // a previous run
      Object.assign(tr(23, 100), { pnl: 50000 }),                         // pnl does not match prices
    ];
    const out = T.build([{ uid: 'alice', displayName: 'Alice', state: acct(good.concat(junk)) }], NOW);
    assert.strictEqual(out.all.rows[0].trades, 10);
    assert.strictEqual(out.all.rows[0].returnPct, 1);
  });
  await test('extreme leverage is flagged, not hidden', () => {
    const out = T.build([{ uid: 'alice', displayName: 'Alice', state: acct(ten(100, { lev: 50 })) }], NOW);
    assert.strictEqual(out.all.rows[0].flagged, true);
  });
  await test('periods: last month trades count for all-time only', () => {
    const old = ten(100, { exitAt: Date.UTC(2026, 8, 20) });
    const out = T.build([{ uid: 'alice', displayName: 'Alice', state: acct(old) }], NOW);
    assert.strictEqual(out.all.rows.length, 1);
    assert.strictEqual(out.month.rows.length, 0);
    assert.strictEqual(out.week.rows.length, 0);
  });
  await test('top 50 only in rows, but "your rank" for everybody in ranks', () => {
    const ms = Array.from({ length: 60 }, (_, i) => ({ uid: 'u' + i, displayName: 'Member ' + i, state: acct(ten(10 + i)) }));
    const w = T.build(ms, NOW).week;
    assert.strictEqual(w.rows.length, 50);
    assert.strictEqual(w.ranked, 60);
    assert.strictEqual(w.rows[0].name, 'Member 59');
    assert.strictEqual(w.ranks[T.keyOf('u0')].rank, 60);
  });

  // ---- collect() + run() against an in-memory Firestore ----
  function fakeDb(docs, opts) {
    opts = opts || {};
    const writes = {};
    const snap = (p) => ({ id: p.split('/').pop(), exists: p in docs, get: (k) => (docs[p] || {})[k], ref: ref(p) });
    function ref(p) {
      const parts = p.split('/');
      return { id: parts[parts.length - 1], path: p,
        get parent() { const cp = parts.slice(0, -1); return { id: cp[cp.length - 1], get parent() { return cp.length > 1 ? ref(cp.slice(0, -1).join('/')) : null; } }; },
        collection: (c) => ({ doc: (d) => Object.assign(ref(p + '/' + c + '/' + d), { get: async () => snap(p + '/' + c + '/' + d) }) }) };
    }
    return {
      writes,
      collectionGroup(name) {
        return { where(f, op, v) { return { limit() { return { async get() {
          if (opts.noIndex) { const e = new Error('9 FAILED_PRECONDITION: The query requires an index'); e.code = 9; throw e; }
          return { docs: Object.keys(docs).filter((p) => p.split('/').slice(-2, -1)[0] === name && docs[p][f] === v).map(snap) };
        } }; } }; } };
      },
      collection(c) {
        return { doc: (d) => ({ path: c + '/' + d }),
          async listDocuments() { return [...new Set(Object.keys(docs).filter((p) => p.startsWith(c + '/')).map((p) => p.split('/')[1]))].map((id) => ref(c + '/' + id)); } };
      },
      async getAll(...refs) { return refs.map((r) => snap(r.path)); },
      batch() { const b = []; return { set(r, v) { b.push([r.path, v]); }, async commit() { for (const [p, v] of b) writes[p] = v; } }; },
    };
  }
  const DOCS = {
    'students/alice/paperTrading/public': { optIn: true, displayName: 'Alice' },
    'students/alice/paperTrading/account': { state: JSON.stringify(acct(ten(100))) },
    'students/bob/paperTrading/public': { optIn: false, displayName: 'Bob' },              // opted out
    'students/bob/paperTrading/account': { state: JSON.stringify(acct(ten(900))) },
    'students/cara/paperTrading/account': { state: JSON.stringify(acct(ten(900))) },       // never opted in
    'students/dee/paperTrading/public': { optIn: true, displayName: 'Dee' },                // opted in, broken state
    'students/dee/paperTrading/account': { state: '{not json' },
  };
  await test('run(): only opted-in members, opted-out row removed, writes 3 docs', async () => {
    const db = fakeDb(DOCS);
    const r = await T.run(db, NOW);
    assert.strictEqual(r.members, 2);
    assert.deepStrictEqual(Object.keys(db.writes).sort(), ['leaderboards/paper-all', 'leaderboards/paper-month', 'leaderboards/paper-week']);
    const w = db.writes['leaderboards/paper-week'];
    assert.deepStrictEqual(w.rows.map((x) => x.name), ['Alice']);
    assert.strictEqual(w.generatedAt, '__ts__');
    assert.ok(!JSON.stringify(db.writes).includes('Bob'));
  });
  await test('run(): falls back to a students scan if the collection-group index is missing', async () => {
    const db = fakeDb(DOCS, { noIndex: true });
    const r = await T.run(db, NOW);
    assert.strictEqual(r.members, 2);
    assert.deepStrictEqual(db.writes['leaderboards/paper-all'].rows.map((x) => x.name), ['Alice']);
  });

  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
