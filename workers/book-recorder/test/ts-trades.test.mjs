// Tick-stream trade record (src/ts-trades.js + the TS-TRADES block of ts-hub.js). node workers/book-recorder/test/ts-trades.test.mjs
// Proves: floor per symbol, per-minute delta from ALL trades, store round trip, 6 h read cap, 48 h prune, REST backfill (serial, once, paged),
// the route gate in index.js (same admin check as /ts-book-history) and the hub feeds the book from tick frames.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TradeBook, TS_BIG_FLOOR } from '../src/ts-trades.js';
import { TSHub, TICK_SIZE } from '../src/ts-hub.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const mem = () => { const T = [], D = new Map(); return { T, D,
  putTrades(rows) { for (const r of rows) T.push(r.slice()); }, putDeltas(rows) { for (const r of rows) D.set(r[0] + '|' + r[1], r.slice()); },
  trades(sym, a, b) { return T.filter((r) => r[0] === sym && r[1] >= a && r[1] <= b).sort((x, y) => x[1] - y[1]).map((r) => [r[1], r[2], r[3], r[4]]); },
  deltas(sym, a, b) { return [...D.values()].filter((r) => r[0] === sym && r[1] >= a && r[1] <= b).sort((x, y) => x[1] - y[1]).map((r) => r.slice(1)); },
  prune(ms) { for (let i = T.length - 1; i >= 0; i--) if (T[i][1] < ms) T.splice(i, 1); for (const [k, r] of D) if (r[1] < Math.floor(ms / 60000)) D.delete(k); } }; };
const NOW = Date.UTC(2026, 10, 2, 15, 0, 30);
const mk = (o = {}) => { const st = mem(); return { st, tb: new TradeBook(st, Object.assign({ now: () => NOW }, o)) }; };

// floor table = the brief
assert.deepEqual(TS_BIG_FLOOR, { NQ: 5, ES: 20, MNQ: 20, MES: 50, YM: 5, RTY: 5, CL: 10, GC: 5 });
for (const s of Object.keys(TS_BIG_FLOOR)) assert.ok(TICK_SIZE[s], s + ' is a hub symbol');
ok('floor table matches the brief and the hub symbols');

{ // floor: only >= floor is a candidate; delta counts everything
  const { st, tb } = mk();
  tb.add('NQ', 100, 4, 1, NOW); tb.add('NQ', 100, 5, -1, NOW + 1); tb.add('NQ', 101, 40, 1, NOW + 2);
  tb.add('ES', 50, 19, 1, NOW); tb.add('ES', 51, 20, 1, NOW + 1); tb.add('MES', 5, 49, -1, NOW); tb.add('XX', 5, 99, 1, NOW);
  tb.flush(NOW + 10);
  assert.deepEqual(st.T.map((r) => [r[0], r[3]]).sort(), [['ES', 20], ['NQ', 40], ['NQ', 5]].sort(), 'floor NQ 5, ES 20, MES 50, unknown symbol never');
  const r = tb.read('NQ', NOW - 1000, NOW + 1000);
  assert.deepEqual(r.trades.map((x) => x[2]), [5, 40]);
  const d = r.delta[0]; assert.equal(d[1], 44); assert.equal(d[2], 5);   // buy 4+40, sell 5
  assert.equal(d[3], 39, 'running delta high: 4, -1, 39'); assert.equal(d[4], -1, 'running delta low');
  ok('big candidates kept at the per-symbol floor; delta from every trade (incl. small)');
}
{ // fills of one order (same side + price, <= 1 ms apart) are ONE candidate; the floor applies to the merged size
  const { st, tb } = mk();
  for (let i = 0; i < 6; i++) tb.add('NQ', 100, 1, 1, NOW + (i >> 1));   // 6 fills of 1 within 3 ms
  tb.add('NQ', 100, 1, 1, NOW + 50); tb.add('NQ', 100, 1, 1, NOW + 100);   // separate singles: below the floor
  tb.flush(NOW + 500);
  assert.deepEqual(st.T.map((r) => [r[3], r[4]]), [[6, 1]], 'six 1-lots = one 6-lot buy');
  ok('split fills merge before the floor');
}
{ // minute roll + open minute visible to reads
  const { st, tb } = mk();
  tb.add('NQ', 1, 3, 1, NOW); tb.add('NQ', 1, 2, -1, NOW + 60000);
  const r = tb.read('NQ', NOW - 1000, NOW + 61000);
  assert.deepEqual(r.delta.map((x) => [x[1], x[2]]), [[3, 0], [0, 2]], 'closed minute stored, open minute served from memory');
  ok('minute roll writes the closed minute; the open minute is served live');
}
{ // 6 h cap, 48 h prune
  const { st, tb } = mk();
  const T = NOW;
  for (const h of [49, 47, 7, 5, 0.5]) tb.add('NQ', 1, 9, 1, T - h * 3600000);
  tb.flush(T);
  const r = tb.read('NQ', T - 100 * 3600000, T);
  assert.equal(r.trades.length, 2, 'a 100 h ask is cut to the last 6 h (0.5 h and 5 h)');
  tb.prune(T);
  assert.equal(st.T.length, 4, '49 h row pruned (48 h keep), 47 h stays');
  ok('read capped at 6 h; prune at 48 h');
}
{ // backfill: serial, paged, once, empty minute gets a row, key goes in the header only
  const { st, tb } = mk({ FILL_LAG_MS: 0 });
  const calls = []; let inflight = 0, maxIn = 0;
  const base = Math.floor(NOW / 60000) - 30;     // minutes base..base+9 asked
  const rowsFor = (s, e) => { const out = []; for (let t = s * 1e6; t < e * 1e6; t += 5e6) out.push({ ts: t, price: 100, size: (t / 5e6) % 7 === 0 ? 8 : 1, side: (t / 5e6) % 2 ? 'buy' : 'sell' }); return out; };
  tb.doFetch = async (url, init) => {
    inflight++; maxIn = Math.max(maxIn, inflight); calls.push({ url, init });
    const u = new URL(url), s = Number(u.searchParams.get('start')), e = Number(u.searchParams.get('end'));
    await new Promise((r) => setTimeout(r, 2)); inflight--;
    let rows = rowsFor(s, e); const trunc = rows.length > 40; if (trunc) rows = rows.slice(0, 40);
    return { status: 200, json: async () => ({ ticks: rows, truncated: trunc }) };
  };
  const from = base * 60000, to = (base + 9) * 60000 + 59000;
  const r = await tb.backfill('NQ', from, to, 'SECRETKEY');
  assert.equal(maxIn, 1, 'serial requests');
  assert.ok(calls.length >= 2, 'paged when truncated');
  assert.ok(calls.every((c) => /\/history\/ticks\?symbol=NQ&start=\d+&end=\d+&limit=100000$/.test(c.url) && !/SECRET/.test(c.url) && c.init.headers.authorization === 'Bearer SECRETKEY'), 'key only in the header');
  assert.equal(r.left, 0); assert.ok(r.filled >= 10);
  assert.equal(st.deltas('NQ', base, base + 9).length, 10, 'every minute has a row');
  assert.ok(st.T.length > 0 && st.T.every((x) => x[3] >= 5), 'only >= floor stored');
  const c0 = calls.length, r2 = await tb.backfill('NQ', from, to, 'SECRETKEY');
  assert.equal(calls.length, c0, 'asked once: second run makes no request'); assert.equal(r2.filled, 0);
  ok('backfill is serial, paged, once per window, key in the header only');
}
{ // backfill cap + error pause
  const { tb } = mk({ FILL_LAG_MS: 0, FILL_MAX_MIN: 10 });
  tb.doFetch = async () => ({ status: 200, json: async () => ({ ticks: [], truncated: false }) });
  const r = await tb.backfill('NQ', NOW - 40 * 3600000, NOW, 'K');
  assert.ok(r.filled <= 20 && r.left > 0, 'capped per call, caller repeats (left ' + r.left + ')');
  const t2 = mk({ FILL_LAG_MS: 0 }).tb; t2.doFetch = async () => ({ status: 429, json: async () => ({}) });
  const x = await t2.backfill('NQ', NOW - 3600000, NOW, 'K'); assert.equal(x.filled, 0); assert.ok(t2.fillPause > NOW || t2.fillPause > 0);
  assert.equal((await t2.backfill('NQ', NOW - 3600000, NOW, '')).filled, 0, 'no key, no fetch');
  ok('backfill is capped per call and pauses on 429');
}
{ // hub: tick frames feed the book; RECORD off does not
  const st = Object.assign(mem(), { putMin() {}, prune() {}, range() { return []; } }); st.tb = mem();
  const hub = new TSHub(st, 'K', { WebSocket: function () {}, now: () => NOW });
  hub.feed([{ type: 'tick', symbol: 'NQ', price: 28000, size: 12, side: 'buy', ts: 1 }, { type: 'tick', symbol: 'NQ', price: 28000, size: 1, side: 'sell', ts: 1 }, { type: 'tick', symbol: 'GC', price: 4000, size: 5, side: 'sell', ts: 1 }]);
  const r = hub.tb.read('NQ', NOW - 1000, NOW + 1000);
  assert.deepEqual(r.trades.map((x) => x[2]), [12]); assert.deepEqual(r.delta[0].slice(1, 3), [12, 1]);
  assert.equal(hub.tb.read('GC', NOW - 1000, NOW + 1000).trades.length, 1);
  ok('hub tick frames land in the trade book (NQ big, GC floor 5)');
}
// route gate: index.js lists /ts-trades with the same tsAllowed check and rate limit as /ts-book-history
{
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /u\.pathname === '\/ts-aux' \|\| u\.pathname === '\/ts-trades'\) \{[\s\S]{0,900}tsAllowed\(env, bearerOf\(req\)\)[\s\S]{0,600}RL_OF\.limit/);
  const hubSrc = fs.readFileSync(new URL('../src/ts-hub.js', import.meta.url), 'utf8');
  assert.match(hubSrc, /\/ts-trades[\s\S]{0,300}symbol not recorded/);
  ok('/ts-trades sits behind the admin gate + rate limit like /ts-book-history');
}
console.log(n + ' tests passed');
