// Footprint Patterns maths (assets/chart-fp-patterns-data.js): one exact positive and one near-miss negative per pattern.
//   node tools/tests/fp-patterns.test.mjs
import assert from 'node:assert/strict';
import { barPatterns, analyze } from '../../assets/chart-fp-patterns-data.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
// rows low -> high as [buy, sell]; tick index of the lowest row = lo
const mk = (rs, { lo = 100, c, t = 0 } = {}) => {
  const buy = rs.map((r) => r[0]), sell = rs.map((r) => r[1]), sm = (a) => a.reduce((x, y) => x + y, 0);
  return { t, lo, hi: lo + rs.length - 1, o: lo, c: c == null ? lo + rs.length - 1 : c, buy, sell, vol: sm(buy) + sm(sell), delta: sm(buy) - sm(sell), mins: 1 };
};
const flat = [[10, 10], [10, 10], [10, 10], [10, 10]];

// 1 Absorption: heavy selling at the low, close back off it (green)
{ const rs = [[5, 140], [5, 60], [10, 10], [10, 10], [10, 10], [10, 10]];
  const a = barPatterns(mk(rs, { c: 104 })).abs;
  assert.ok(a && a.dir === 1 && a.at === 'lo' && a.p === 100, 'absorption'); ok('absorption: sellers absorbed at the low (green)');
  assert.equal(barPatterns(mk(rs, { c: 100 })).abs, null); ok('absorption near miss: bar closes at the low (no rejection)');
  const hi = barPatterns(mk(rs.slice().reverse().map(([b, s]) => [s, b]), { c: 100 })).abs;
  assert.ok(hi && hi.dir === -1 && hi.at === 'hi'); ok('absorption: mirror at the high is red'); }
// 2 Exhaustion: buying shrinks 80, 40, 20, 5 into the high
{ const rs = [[10, 10], [10, 10], [80, 10], [40, 10], [20, 10], [5, 10]];
  const e = barPatterns(mk(rs)).exh;
  assert.ok(e && e.dir === -1 && e.at === 'hi' && e.p === 105 && e.pct < 25); ok('exhaustion: buying fades into the high');
  const rs2 = [[10, 10], [10, 10], [80, 10], [60, 10], [40, 10], [25, 10]];
  assert.equal(barPatterns(mk(rs2)).exh, null); ok('exhaustion near miss: last row 31% of the row three levels in (limit 25%)'); }
// 3 Stacked imbalances: buy imbalances on 3 rows in a row; zone runs right until price trades through it
{ const rs = [[10, 10], [40, 10], [40, 10], [40, 10], [10, 10]];
  const s = barPatterns(mk(rs)).stk;
  assert.ok(s && s.dir === 1 && s.lo === 101 && s.hi === 104 && s.n === 3); ok('stacked: 3 buy imbalances in a row');
  assert.equal(barPatterns(mk([[10, 10], [40, 10], [40, 10], [20, 10], [10, 10]])).stk, null); ok('stacked near miss: only 2 in a row');
  const L = [mk(rs, { t: 0 }), mk(flat, { lo: 105, t: 1 }), mk(flat, { lo: 99, t: 2 })];
  const z = analyze(L, {}).find((e) => e.kind === 'stk');
  assert.equal(z.end, 2); ok('stacked: zone extends right until a bar trades below it');
  assert.equal(analyze(L.slice(0, 2), {}).find((e) => e.kind === 'stk').end, -1); ok('stacked: still open while price has not traded through'); }
// 4 Unfinished auction: bid and ask both traded at the high
{ const bad = [[0, 30], [10, 10], [10, 10], [20, 0]];
  assert.equal(barPatterns(mk(bad)).unf, null); ok('unfinished near miss: one-sided at both extremes');
  const u = barPatterns(mk([[0, 30], [10, 10], [10, 10], [20, 5]])).unf;
  assert.ok(u && u.at === 'hi' && u.p === 103 && u.dir === -1); ok('unfinished: both sides at the high');
  const L = [mk([[0, 30], [10, 10], [10, 10], [20, 5]], { t: 0 }), mk(flat, { lo: 98, t: 1 }), mk(flat, { lo: 101, t: 2 })];
  assert.equal(analyze(L, {}).find((e) => e.kind === 'unf' && e.i === 0).end, 2); ok('unfinished: line stops when a later bar revisits the price'); }
// 5 Delta divergence: swing highs 106 then 108, delta +330 then +16
{ const cs = [100, 102, 104, 106, 104, 102, 100, 102, 104, 106, 108, 106, 104, 102, 100];
  const L = cs.map((c, i) => mk(i === 3 ? [[110, 0], [110, 0], [110, 0]] : i === 10 ? [[6, 0], [5, 0], [5, 0]] : [[5, 5], [5, 5], [5, 5]], { lo: c - 1, t: i }));
  const ev = analyze(L, {}).filter((e) => e.kind === 'div');
  assert.equal(ev.length, 1); assert.ok(ev[0].i === 10 && ev[0].from === 3 && ev[0].dir === -1 && ev[0].da === 330 && ev[0].db === 16); ok('divergence: higher high, delta +330 then +16');
  L[10] = mk([[100, 0], [100, 0], [100, 0]], { lo: 107, t: 10 });
  assert.equal(analyze(L, {}).filter((e) => e.kind === 'div').length, 0); ok('divergence near miss: delta +300 (not lower enough)'); }
// 6 Trapped traders: heavy buying in the top 3 rows, a later bar closes below the whole zone
{ const top = mk([[10, 10], [10, 10], [10, 10], [80, 5], [80, 5], [80, 5]], { t: 0 });
  const ev = (nxt, o) => analyze([top, nxt], o).filter((e) => e.kind === 'trap');
  const t = ev(mk(flat, { lo: 99, c: 102, t: 1 }));
  assert.ok(t.length === 1 && t[0].dir === -1 && t[0].lo === 103 && t[0].hi === 106 && t[0].j === 1); ok('trapped: buyers at the high, a bar closes below the whole zone');
  assert.equal(ev(mk(flat, { lo: 99, c: 103, t: 1 })).length, 0); ok('trapped near miss: close only reaches the zone edge');
  const three = [top, mk(flat, { lo: 104, t: 1 }), mk(flat, { lo: 99, c: 102, t: 2 })];
  assert.equal(analyze(three, { trapBars: 1 }).filter((e) => e.kind === 'trap').length, 0); ok('trapped near miss: the close came after the K-bar window');
  assert.equal(analyze(three, { trapBars: 2 }).filter((e) => e.kind === 'trap').length, 1); ok('trapped: inside the window it counts'); }
// cache: finished bars are not recomputed, the forming bar is; maxBars caps the lookback
{ const cache = new Map(), L = [mk([[5, 140], [5, 60], [10, 10], [10, 10], [10, 10], [10, 10]], { c: 104, t: 0 }), mk(flat, { t: 1 })];
  analyze(L, {}, cache, 1); assert.equal(cache.size, 1); ok('cache: finished bar cached, forming bar not');
  const e = analyze(L, {}, cache, 1); assert.ok(e.some((x) => x.kind === 'abs' && !x.forming)); ok('cache: same events from the cache');
  const long = Array.from({ length: 50 }, (_, i) => mk(flat, { t: i })); analyze(long, { maxBars: 20 }, cache); assert.ok(cache.size <= 21); ok('max lookback limits what is analysed'); }
console.log(n + ' passed');
