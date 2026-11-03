// Delta (L2): per-price delta built from hub ticks (chart-futures-l2.js TickFeed) must equal an independent per-minute count of the same
// ticks, row for row, through the same maths the REST bars go through (rows() merge, deltaProfile, aggregate).  node tools/tests/delta-l2.test.mjs
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {}; globalThis.document = globalThis.document || { addEventListener() {}, hidden: false };
const L2 = await import('../../assets/chart-futures-l2.js');
const D = await import('../../assets/chart-footprint-data.js');
const S = await import('../../assets/chart-delta-suite-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const TICK = 0.25, T0 = Math.floor(Date.now() / 60000) * 60000 - 20 * 60000;
const ticks = [];   // hub frame shape: [price, size, 1|-1, ts_ms]
for (let i = 0; i < 6000; i++) ticks.push([Math.round((28650 + Math.sin(i / 300) * 12 + (rnd() - 0.5) * 6) / TICK) * TICK, 1 + Math.floor(rnd() * 9), rnd() < 0.5 ? 1 : -1, T0 + Math.floor(i * 19 * 60000 / 6000)]);
const feed = new L2.TickFeed('NQ');
for (let i = 0; i < ticks.length; i += 37) feed.add(ticks.slice(i, i + 37), false);   // arrives in frames
const bars = feed.bars();
// reference: minute -> price idx -> [buy, sell]
const ref = new Map();
for (const [p, sz, side, ts] of ticks) { const t = Math.floor(ts / 60000) * 60000, i = Math.floor(p / TICK + 1e-9); let m = ref.get(t); if (!m) ref.set(t, (m = new Map())); const e = m.get(i) || [0, 0]; e[side > 0 ? 0 : 1] += sz; m.set(i, e); }
ok(bars.length === ref.size, 'one bar per minute', [bars.length, ref.size]);
let rowsOk = 0;
for (const b of bars) {
  const m = ref.get(b.t); let vol = 0, d = 0;
  for (let j = 0; j < b.buy.length; j++) { const e = m.get(b.lo + j) || [0, 0]; assert.equal(b.buy[j], e[0]); assert.equal(b.sell[j], e[1]); vol += e[0] + e[1]; d += e[0] - e[1]; rowsOk++; }
  assert.equal(b.vol, vol); assert.equal(b.delta, d);
  assert.ok(b.o >= b.lo && b.o <= b.hi && b.c >= b.lo && b.c <= b.hi && b.dmax >= Math.max(0, d) && b.dmin <= Math.min(0, d) && b.trades > 0);
}
ok(rowsOk > 500, 'every price row matches the independent count (same buy/sell side rule)', rowsOk);
for (const m of [1, 4, 8]) {
  const p = S.deltaProfile(bars, m), net = bars.reduce((s, b) => s + b.delta, 0);
  ok(p.net === net, 'profile m=' + m + ' sums to the session delta ' + net);
  const sell = ticks.filter((t) => t[2] < 0).reduce((s, t) => s + t[1], 0), buy = ticks.filter((t) => t[2] > 0).reduce((s, t) => s + t[1], 0);
  ok(p.buy.reduce((a, b) => a + b, 0) === buy && p.sell.reduce((a, b) => a + b, 0) === sell, 'profile m=' + m + ' buy / sell totals');
}
// the REST row merge (rows(bar, m)) on a hub bar equals merging the reference by hand
const b = bars[5], rs = D.rows(b, 4), hand = new Map();
ref.get(b.t).forEach((e, i) => { const r = Math.floor(i / 4) * 4; const x = hand.get(r) || [0, 0]; x[0] += e[0]; x[1] += e[1]; hand.set(r, x); });
ok(rs.length === hand.size && rs.every((r) => hand.get(r.p)[0] === r.buy && hand.get(r.p)[1] === r.sell), 'row merge at 4 ticks matches');
const a5 = D.aggregate(bars, 5 * 60000);
ok(a5.reduce((s, x) => s + x.delta, 0) === bars.reduce((s, x) => s + x.delta, 0) && a5.every((x) => x.t % 300000 === 0), '5m aggregate keeps the delta');
// a live tick moves the forming bar at once; a server minute replaces ours only when it holds more
const v0 = feed.bars()[feed.bars().length - 1].vol; feed.add([[28650, 7, 1, ticks[ticks.length - 1][3]]], false);
ok(feed.bars()[feed.bars().length - 1].vol === v0 + 7, 'a new tick lands in the forming bar immediately');
const T = bars[3].t / 60000, before = bars[3].vol;
feed.seed([{ t: T, lv: [[28650, 1, 1]] }], true); ok(feed.bars()[3].vol === before, 'a smaller server minute does not shrink the bar');
feed.seed([{ t: T, lv: [[28650, before + 5, 0]] }], true); ok(feed.bars()[3].vol === before + 5, 'a bigger server minute (gap fill) replaces it');
console.log('delta-l2: ' + n + ' checks passed');
