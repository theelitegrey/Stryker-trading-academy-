// Swing VWAP + Profile (L2) maths (assets/chart-swing-vwap-data.js + swingModel in chart-swing-vwap.js): legs, VWAP, POC / VAH / VAL, no repaint, cache.
//   node tools/tests/swing-vwap.test.mjs
import assert from 'node:assert/strict';
const D = await import('../../assets/chart-swing-vwap-data.js');
const { swingModel } = await import('../../assets/chart-swing-vwap.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const near = (a, b, m) => ok(Math.abs(a - b) < 1e-9, m + ' (' + a + ' vs ' + b + ')');

// zigzag path: up to 20, down to 8, up to 24, down to 12, up to 18 (open), one point per bar, +-1 range
const path = []; const wp = [[0, 10], [10, 20], [20, 8], [30, 24], [40, 12], [50, 18]];
for (let s = 0; s + 1 < wp.length; s++) { const [i0, p0] = wp[s], [i1, p1] = wp[s + 1]; for (let i = i0; i < i1; i++) path.push(p0 + (p1 - p0) * (i - i0) / (i1 - i0)); }
path.push(18);
const mk = (k) => path.slice(0, k).map((p, i) => ({ time: i * 60000, open: p, high: p + 0.5, low: p - 0.5, close: p, volume: 100 + (i % 7) }));
const full = mk(path.length), hl = (b) => [b.map((x) => x.high), b.map((x) => x.low)];

// 1. pivots alternate, legs chain, last leg is open
{ const L = D.buildLegs(...hl(full), 3);
  ok(L.pivots.length >= 4, 'finds the swings', L.pivots.map((p) => p.i + p.kind));
  ok(L.pivots.every((p, i) => !i || p.kind !== L.pivots[i - 1].kind), 'pivots alternate high / low');
  ok(L.legs.every((g, i) => !i || g.a === L.legs[i - 1].b), 'each leg starts where the last ended');
  ok(L.legs.every((g, i) => g.dir === (g.dir > 0 ? 1 : -1) && (!i || g.dir === -L.legs[i - 1].dir)), 'legs alternate up / down');
  const last = L.legs[L.legs.length - 1]; ok(last.open && last.b === full.length - 1, 'last leg is open and runs to the current bar');
  ok(L.legs.filter((g) => g.open).length === 1, 'only one open leg');
  ok(L.legs[0].dir === 1 || L.legs[0].dir === -1, 'dir set'); }

// 2. open leg updates with every bar; confirmed legs keep their shape (no repaint)
{ let seenOpenEnds = new Set();
  for (let k = 40; k <= full.length; k++) {
    const A = D.buildLegs(...hl(mk(k)), 3), B = D.buildLegs(...hl(mk(k + 1 > full.length ? k : k + 1)), 3);
    const open = A.legs[A.legs.length - 1]; if (open) seenOpenEnds.add(open.b);
    if (k + 1 <= full.length) for (const g of A.legs.filter((x) => x.final)) { const h = B.legs.find((x) => x.a === g.a); assert.ok(h && h.b === g.b && h.dir === g.dir && h.final, 'frozen leg changed at bar ' + k); }
  }
  ok(seenOpenEnds.size > 5, 'the open leg end moves with each new bar', seenOpenEnds.size);
  ok(true, 'frozen legs (final=true) never change when a later bar arrives'); }

// 3. VWAP by hand: tp = (h + l + c) / 3 ; volumes 100, 200, 100
{ const b = [{ high: 12, low: 10, close: 11, volume: 100 }, { high: 15, low: 11, close: 13, volume: 200 }, { high: 16, low: 12, close: 14, volume: 100 }];
  const V = D.legVwap(b, 0, 2);
  near(V.vwap[0], 11, 'vwap bar 0 = 11'); near(V.vwap[1], (11 * 100 + 13 * 200) / 300, 'vwap bar 1 = 12.3333'); near(V.vwap[2], 12.75, 'vwap bar 2 = 12.75');
  near(V.sd[0], 0, 'sd bar 0 = 0'); near(V.sd[1], Math.sqrt(8 / 9), 'sd bar 1 = sqrt(8/9)');
  const z = D.legVwap([{ high: 5, low: 4, close: 4, volume: 0 }, { high: 6, low: 5, close: 6, volume: 10 }], 0, 1);
  ok(z.vwap[0] === null && z.vwap[1] === 17 / 3, 'zero volume so far = no line, then starts', z.vwap); }

// 4. profile by hand: ticks 10..14 volumes 10 / 30 / 40 / 15 / 5 = 100. POC 12. 70%: up side 20 vs down side 40, go down -> 80 >= 70 -> VA = 10..12
{ const tab = new Map([[10, [5, 5, 0]], [11, [10, 20, 0]], [12, [30, 10, 0]], [13, [15, 0, 0]], [14, [0, 5, 0]]]);
  const P = D.buildProfile(tab, 1, 70);
  ok(P.total === 100 && P.n === 5 && P.r0 === 10, 'rows and total', [P.total, P.n, P.r0]);
  ok(P.poc === 2 && D.rowPrice(P, P.poc, 0.25) === 3, 'POC = tick 12 (price 3.00 at 0.25)', P.poc);
  ok(P.vaLo === 0 && P.vaHi === 2, 'value area 70% = ticks 10..12', [P.vaLo, P.vaHi]);
  const P2 = D.buildProfile(tab, 1, 40); ok(P2.vaLo === 2 && P2.vaHi === 2, 'value area 40% = the POC row only');
  const P3 = D.buildProfile(tab, 1, 100); ok(P3.vaLo === 0 && P3.vaHi === 4, 'value area 100% = everything');
  // rows of 2 ticks: (10,11)=40 (12,13)=55 (14)=5 -> POC row 1 (ticks 12-13), centre price tick 12.5
  const P4 = D.buildProfile(tab, 2, 70); ok(P4.n === 3 && P4.poc === 1 && D.rowPrice(P4, 1, 1) === 12.5, '2-tick rows: POC row 12-13, centre 12.5', [P4.n, P4.poc]);
  ok(D.buildProfile(new Map(), 1, 70) === null, 'no data = no profile'); }

// 5. data per case: exact minutes vs bar-volume fallback
{ const tf = 60000 * 5, bars = [0, 1, 2].map((i) => ({ time: i * tf, high: 102, low: 100, close: 101, volume: 90 }));   // ticks 400..408 at tick 0.25 -> 9 ticks
  const fb = { from: 2 * tf, bars: [{ t: 2 * tf, lo: 400, buy: [3, 0, 1], sell: [1, 2, 0] }, { t: 2 * tf + 60000, lo: 401, buy: [5], sell: [0] }] };
  const T = D.legTab(bars, 0, 2, tf, fb, 0.25);
  ok(T.approxBars === 2 && T.exactBars === 1 && T.approx, 'bars before the feed are approx, the rest exact', [T.approxBars, T.exactBars]);
  ok(T.tab.get(400)[0] === 3 && T.tab.get(401)[0] === 5 && T.tab.get(402)[0] === 1 && T.tab.get(401)[1] === 2, 'exact buy / sell per price from the trade minutes');
  ok(Math.abs(T.tab.get(404)[2] - 2 * 90 / 9) < 1e-9 && T.tab.get(404)[0] === 0, 'approx: bar volume spread evenly over the bar range, no side');
  const E = D.legTab(bars, 2, 2, tf, fb, 0.25); ok(!E.approx, 'a leg fully inside the feed is not approx');
  const X = D.legTab(bars, 2, 2, tf, { from: 2 * tf, bars: [{ t: 2 * tf, lo: 2000, buy: [9], sell: [9] }] }, 0.25); ok(X.approx && X.exactBars === 0 && !X.tab.has(2000), 'trade minutes far outside the bar range are ignored (bar falls back to approx)');
  const N = D.legTab(bars, 0, 2, tf, null, 0.25); ok(N.approxBars === 3 && N.exactBars === 0, 'no feed at all = all approx'); }

// 6. swingModel: caching, newest-first limit, open leg moves, frozen legs are the same objects of work
{ const tf = 60000, fb = { from: 0, bars: [] }, I = { len: 3, legs: 3, va: 70 }, cache = new Map();
  const m1 = swingModel(mk(full.length - 2), tf, I, fb, 0.25, cache);
  ok(m1.legs.length === 3, 'legs limited to N, newest kept', m1.legs.length);
  const m2 = swingModel(mk(full.length - 1), tf, I, fb, 0.25, cache), m3 = swingModel(mk(full.length), tf, I, fb, 0.25, cache);
  ok(m2.legs.length === 3 && m3.legs.length === 3 && m3.computed <= 2, 'a new bar recomputes at most the open leg and the not-yet-final one', [m2.computed, m3.computed]);
  const fin = m3.legs.filter((l) => l.final); ok(fin.length >= 1 && fin.every((l) => cache.size > 0), 'final legs are cached');
  ok(m3.legs[m3.legs.length - 1].b > m1.legs[m1.legs.length - 1].b, 'open leg end moved on new data');
  const big = swingModel(full, tf, { len: 3, legs: 30 }, fb, 0.25, new Map()); ok(big.legs.length === Math.min(30, D.buildLegs(...hl(full), 3).legs.length), 'max 30 legs honoured');
  ok(m3.legs.every((l) => l.approx && l.P && l.poc > 0 && l.vah >= l.val), 'no trade feed: every leg says approx and still has POC / VAH / VAL'); }
console.log(n + ' checks passed');
