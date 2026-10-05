// Unit tests for the Charts futures bars API (functions/api/chart/_bars.js + bars/[sym].js).
// Pure node, no network:  node tools/tests/chart-bars-test.mjs
// Fakes Yahoo (globalThis.fetch) and the Cloudflare edge cache (globalThis.caches).
import assert from 'node:assert/strict';
import { TIMEFRAMES, pageOf, pageBounds, parseYahoo, aggregateHours, nyOffset, globexOpen, ttlFor, normSym, normTf } from '../../functions/api/chart/_bars.js';
import { onRequestGet } from '../../functions/api/chart/bars/[sym].js';

let n = 0;
const ok = (name) => { n++; console.log('PASS', name); };

// --- fake edge cache -------------------------------------------------------------------
class FakeCache {
  constructor() { this.m = new Map(); }
  async match(req) { const r = this.m.get(req.url); return r ? r.clone() : undefined; }
  async put(req, res) { this.m.set(req.url, res.clone()); }
}
globalThis.caches = { default: new FakeCache() };

// --- fake Yahoo ------------------------------------------------------------------------
const calls = [];
let mode = 'ok';
function yahooBody(p1, p2, stepSec) {
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  for (let t = Math.ceil(p1 / stepSec) * stepSec; t < p2; t += stepSec) {
    if (!globexOpen(t)) continue;
    ts.push(t); o.push(100); h.push(101); l.push(99); c.push(100.5); v.push(10);
  }
  return { chart: { result: [{ meta: {}, timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }], error: null } };
}
const IV_STEP = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '60m': 3600, '1d': 86400, '1wk': 7 * 86400, '1mo': 30 * 86400 };
globalThis.fetch = async (url) => {
  calls.push(url);
  const u = new URL(url);
  if (mode === 'fail') return new Response('boom', { status: 503 });
  if (mode === 'hang') return new Promise(() => {});
  const p1 = Number(u.searchParams.get('period1')), p2 = Number(u.searchParams.get('period2'));
  const step = IV_STEP[u.searchParams.get('interval')];
  return new Response(JSON.stringify(yahooBody(p1, p2, step)), { status: 200 });
};

const call = async (path) => {
  const url = new URL('https://strykertrading.com' + path);
  const sym = decodeURIComponent(url.pathname.split('/').pop());
  const res = await onRequestGet({ request: new Request(url), params: { sym } });
  return { status: res.status, body: await res.json(), cc: res.headers.get('cache-control') };
};

// --- pure helpers ------------------------------------------------------------------------
assert.equal(normSym('nq'), 'NQ'); assert.equal(normSym('NQ1!'), 'NQ'); assert.equal(normSym('6e'), '6E');
assert.equal(normSym('AAPL'), null); assert.equal(normSym('__proto__'), null); assert.equal(normSym('constructor'), null);
assert.equal(normTf('1h'), '60'); assert.equal(normTf('4h'), '240'); assert.equal(normTf('1D'), 'D'); assert.equal(normTf('7'), null);
ok('symbol + timeframe normalisation, allow-list rejects unknown and prototype keys');

assert.equal(nyOffset(Date.UTC(2026, 9, 5) / 1000), -4 * 3600);   // October: EDT
assert.equal(nyOffset(Date.UTC(2026, 11, 24) / 1000), -5 * 3600); // December: EST
assert.equal(nyOffset(Date.UTC(2026, 2, 8, 6, 59) / 1000), -5 * 3600);  // 01:59 EST just before the switch
assert.equal(nyOffset(Date.UTC(2026, 2, 8, 7, 0) / 1000), -4 * 3600);
ok('New York offset incl. DST switch');

assert.equal(globexOpen(Date.UTC(2026, 9, 3, 16) / 1000), false); // Saturday
assert.equal(globexOpen(Date.UTC(2026, 9, 4, 21, 30) / 1000), false); // Sun 17:30 ET
assert.equal(globexOpen(Date.UTC(2026, 9, 4, 22, 30) / 1000), true);  // Sun 18:30 ET
assert.equal(globexOpen(Date.UTC(2026, 9, 5, 21, 30) / 1000), false); // Mon 17:30 ET break
assert.equal(globexOpen(Date.UTC(2026, 9, 5, 14) / 1000), true);
ok('Globex schedule');

for (const tf of Object.keys(TIMEFRAMES)) {
  const t = Date.UTC(2026, 9, 5, 14) / 1000;
  const p = pageOf(tf, t);
  if (TIMEFRAMES[tf].page) { const [a, b] = pageBounds(tf, p); assert.ok(a <= t && t < b, tf); }
}
ok('page bounds contain their time for every timeframe');

// 4h bars align to 18:00 ET (22:00 UTC in EDT): 22, 02, 06, 10, 14, 18 UTC
{
  const rows = [];
  for (let t = Date.UTC(2026, 9, 4, 22) / 1000; t < Date.UTC(2026, 9, 5, 14) / 1000; t += 3600) rows.push([t, 1, 2, 0.5, 1.5, 1]);
  const agg = aggregateHours(rows, 4);
  assert.deepEqual(agg.map((r) => new Date(r[0] * 1000).getUTCHours()), [22, 2, 6, 10]);
  assert.equal(agg[0][5], 4);
  ok('4h aggregation aligned to the 18:00 ET Globex open');
}

// Yahoo's trailing "latest tick" row folds into the forming bar
{
  const base = Date.UTC(2026, 9, 5, 14) / 1000;
  const body = { chart: { result: [{ timestamp: [base, base + 900, base + 950], indicators: { quote: [{
    open: [1, 2, 3], high: [1, 2, 9], low: [1, 2, 0.5], close: [1, 2, 3], volume: [5, 5, 0] }] } }] } };
  const rows = parseYahoo(body, '15');
  assert.equal(rows.length, 2); assert.equal(rows[1][2], 9); assert.equal(rows[1][3], 0.5); assert.equal(rows[1][4], 3);
  ok('trailing latest-tick point merged into the forming bar');
}

// --- endpoint ---------------------------------------------------------------------------
const now = Math.floor(Date.now() / 1000);
for (const tf of ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M', '1h', '4h', '1D']) {
  const r = await call(`/api/chart/bars/NQ?tf=${encodeURIComponent(tf)}`);
  assert.equal(r.status, 200, tf);
  assert.ok(Array.isArray(r.body.bars), tf);
  for (let i = 1; i < r.body.bars.length; i++) assert.ok(r.body.bars[i][0] > r.body.bars[i - 1][0], `${tf} ascending`);
  console.log(`   tf ${tf.padEnd(3)} -> ${r.body.tf} page ${r.body.page} bars ${r.body.bars.length} cache ${r.cc}`);
}
ok('every timeframe answers 200 with ascending bars');

// paging back: three older 15m pages, contiguous and non-overlapping
{
  const cur = pageOf('15', now);
  let prevStart = Infinity;
  for (let p = cur; p > cur - 3; p--) {
    const r = await call(`/api/chart/bars/ES?tf=15&page=${p}`);
    assert.equal(r.status, 200);
    const [a, b] = pageBounds('15', p);
    for (const bar of r.body.bars) assert.ok(bar[0] >= a && bar[0] < b && bar[0] < prevStart);
    if (r.body.bars.length) prevStart = r.body.bars[0][0];
  }
  ok('paging back returns contiguous, non-overlapping pages');
}

// out-of-range pages return [] without an upstream call
{
  calls.length = 0;
  const old1m = pageOf('1', now - 60 * 86400);
  let r = await call(`/api/chart/bars/NQ?tf=1&page=${old1m}`);
  assert.equal(r.status, 200); assert.deepEqual(r.body.bars, []);
  r = await call(`/api/chart/bars/NQ?tf=60&page=${pageOf('60', now - 900 * 86400)}`);
  assert.deepEqual(r.body.bars, []);
  r = await call(`/api/chart/bars/NQ?tf=15&page=${pageOf('15', now) + 5}`);
  assert.deepEqual(r.body.bars, []);
  assert.equal(calls.length, 0);
  ok('pages older than the source depth / in the future -> [] with no upstream call');
}

// unknown symbol 404, bad timeframe/page 400
{
  assert.equal((await call('/api/chart/bars/AAPL?tf=15')).status, 404);
  assert.equal((await call('/api/chart/bars/BTCUSDT')).status, 404);
  assert.equal((await call('/api/chart/bars/NQ?tf=7')).status, 400);
  assert.equal((await call('/api/chart/bars/NQ?tf=15&page=-1')).status, 400);
  assert.equal((await call('/api/chart/bars/NQ?tf=15&page=abc')).status, 400);
  ok('unknown symbol 404, bad timeframe/page 400 (no open proxy)');
}

// edge cache hit: second identical request makes no upstream call
{
  globalThis.caches = { default: new FakeCache() };
  calls.length = 0;
  await call('/api/chart/bars/CL?tf=5');
  const first = calls.length;
  await call('/api/chart/bars/CL?tf=5');
  assert.equal(calls.length, first);
  ok('edge cache serves the repeat request');
}

// upstream failure -> last-good; nothing cached -> 502
{
  const fake = new FakeCache();
  globalThis.caches = { default: fake };
  const r1 = await call('/api/chart/bars/GC?tf=60');
  assert.ok(r1.body.bars.length > 0);
  // expire the fresh entry, keep the last-good one
  for (const k of [...fake.m.keys()]) if (k.includes('k=fresh')) fake.m.delete(k);
  mode = 'fail';
  const r2 = await call('/api/chart/bars/GC?tf=60');
  assert.equal(r2.status, 200); assert.equal(r2.body.stale, true); assert.equal(r2.body.bars.length, r1.body.bars.length);
  const r3 = await call('/api/chart/bars/SI?tf=60');
  assert.equal(r3.status, 502);
  mode = 'ok';
  ok('upstream failure -> last-good served (stale), no last-good -> 502');
}

// in-flight de-dupe: concurrent identical requests share one upstream fetch
{
  globalThis.caches = { default: new FakeCache() };
  calls.length = 0;
  await Promise.all([call('/api/chart/bars/ZN?tf=30'), call('/api/chart/bars/ZN?tf=30'), call('/api/chart/bars/ZN?tf=30')]);
  assert.equal(calls.length, 1);
  ok('in-flight de-dupe');
}

// TTLs: closed page a day, current page short while Globex is open
{
  const openT = Date.UTC(2026, 9, 5, 14) / 1000;
  assert.equal(ttlFor('15', pageOf('15', openT) - 2, openT), 86400);
  assert.equal(ttlFor('15', pageOf('15', openT), openT), 15);
  assert.equal(ttlFor('15', pageOf('15', Date.UTC(2026, 9, 3, 16) / 1000), Date.UTC(2026, 9, 3, 16) / 1000), 300);
  ok('cache TTLs');
}

console.log(`\n${n} checks passed`);
process.exit(0);
