// Big Trades v2 (assets/chart-bigtrades.js): aggregator, filter intensities, absorption, cap, migration. node tools/tests/bigtrades.test.mjs
import assert from 'node:assert/strict';
import { aggregate, select, cap, migrate, schema, DEFAULTS, compact } from '../../assets/chart-bigtrades.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
// split fills -> one parent
{ const p = aggregate([[1000, 100, 3, 1], [1050, 100, 4, 1], [1100, 100, 5, 1]], {}); assert.equal(p.length, 1); assert.equal(p[0].size, 12); assert.equal(p[0].n, 3); assert.equal(p[0].vwap, 100); ok('split fills -> one parent'); }
// sweep through 4 levels -> one parent, range, vwap weighted
{ const p = aggregate([[0, 100, 10, 1], [20, 101, 10, 1], [40, 102, 10, 1], [60, 103, 10, 1], [80, 104, 10, 1]], {}); assert.equal(p.length, 1); assert.equal(p[0].ticks, 4); assert.equal(p[0].vwap, 102); ok('sweep through levels -> one parent'); }
// walking too far or a pause splits
{ assert.equal(aggregate([[0, 100, 5, 1], [10, 110, 5, 1]], {}).length, 2, 'jump 10 ticks'); assert.equal(aggregate([[0, 100, 5, 1], [400, 100, 5, 1]], {}).length, 2, 'pause 400 ms'); assert.equal(aggregate([[0, 100, 5, 1], [400, 100, 5, 1]], { burstMs: 500 }).length, 1, 'setting'); ok('gap and walk limits (settings) split orders'); }
// alternate sides stay separate; interleaved sides keep their own parent
{ const p = aggregate([[0, 100, 5, 1], [10, 100, 5, 0], [20, 100, 5, 1], [30, 100, 5, 0]], {}); assert.equal(p.length, 2); assert.deepEqual(p.map((x) => x.size), [10, 10]); const q = aggregate([[0, 100, 5, 1], [10, 100, 5, 0]], {}); assert.equal(q.length, 2); ok('opposite sides never merge'); }
assert.equal(aggregate([[0, 100, 5, 1], [10, 100, 5, 1]], { on: false }).length, 2);
// intensities: Low < Medium < Strong strictness
const rnd = (() => { let s = 3; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
const prints = []; for (let i = 0; i < 400; i++) prints.push([i * 5000, 1000 + Math.round(rnd() * 40), Math.max(1, Math.round(Math.exp(1 + rnd() * 3.5))), rnd() < 0.5 ? 1 : 0]);
{ const c = {}; for (const k of ['Low', 'Medium', 'Strong']) c[k] = select(prints, { intensity: k }, {}).list.length;
  assert.ok(c.Low > c.Medium && c.Medium > c.Strong && c.Strong > 0, JSON.stringify(c)); ok('auto intensity: Low > Medium > Strong markers ' + JSON.stringify(c)); }
{ const m = select(prints, { mode: 'Manual', minSize: 40, maxSize: 60 }, {}).list; assert.ok(m.length > 0 && m.every((p) => p.size >= 40 && p.size <= 60)); ok('manual min / max size band'); }
// absorption: big buy, price does not rise -> absorbed; big buy and price rises -> not
{ const mk = (close) => [{ time: 0, high: 1010, low: 990, close: 1000 }, { time: 60000, high: 1012, low: 995, close }, { time: 120000, high: 1012, low: 995, close }];
  const pr = [[10000, 1000, 80, 1], [500000, 1000, 5, 1], [600000, 1000, 5, 0]];
  const opt = { bars: null, tfMs: 60000, tick: 1, now: 1e9, floor: 50 };
  const flat = select(pr, { mode: 'Manual', minSize: 50 }, Object.assign({}, opt, { bars: mk(1000) })).list[0];
  const up = select(pr, { mode: 'Manual', minSize: 50 }, Object.assign({}, opt, { bars: mk(1008) })).list[0];
  const dn = select(pr, { mode: 'Manual', minSize: 50 }, Object.assign({}, opt, { bars: mk(992) })).list[0];
  assert.equal(flat.absorbed, true); assert.equal(up.absorbed, false); assert.equal(dn.absorbed, true); assert.ok(up.impact > flat.impact);
  const live = select(pr, { mode: 'Manual', minSize: 50 }, Object.assign({}, opt, { bars: mk(1008), now: 30000 })).list[0];
  assert.equal(live.pending, true); assert.equal(live.absorbed, false); ok('absorption flag: flat / against = yes, with = no, still forming = pending'); }
// cap: one per N px per side, biggest wins
{ const L = [{ side: 1, impact: 0.5, x: 0 }, { side: 1, impact: 0.9, x: 10 }, { side: 0, impact: 0.4, x: 11 }, { side: 1, impact: 0.3, x: 60 }];
  const k = cap(L, 22, (p) => p.x); assert.equal(k.length, 3); assert.ok(k.includes(L[1]) && !k.includes(L[0]) && k.includes(L[2])); ok('cap keeps the biggest per side per N px'); }
// old layouts
{ assert.deepEqual([migrate({ mult: 1, minSize: 0, labels: true, cluster: true })].map((x) => [x.mode, x.intensity, x.showSize]), [['Automatic', 'Medium', true]]);
  assert.equal(migrate({ minSize: 25 }).mode, 'Manual'); assert.equal(migrate({ mult: 2 }).intensity, 'Strong'); assert.equal(migrate({ mode: 'Manual', minSize: 3 }).minSize, 3); assert.equal(migrate({}).mode, undefined); ok('old stk_of_big settings map to the new ones'); }
// defaults: numbers off; schema grouped Data / Filter / Plot
{ assert.equal(DEFAULTS.showSize, false); assert.equal(DEFAULTS.showFills, false); const g = [...new Set(schema().map((x) => x.group))]; assert.deepEqual(g, ['Data', 'Filter', 'Plot']);
  for (const x of schema()) assert.ok(!/tick-?stream|insight/i.test(x.title + (x.tooltip || '')), x.title); assert.equal(compact(1234), '1.2k'); ok('numbers off by default; settings grouped; no vendor names'); }
console.log(n + ' tests passed');
