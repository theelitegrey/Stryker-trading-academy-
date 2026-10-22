// Delta suite maths (assets/chart-delta-suite-data.js) on REAL recorded NQ order flow
// (book-recorder /orderflow, 2026-10-20 + 2026-10-21, gzipped in fixtures/orderflow/).
//   node tools/tests/chart-delta-suite.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
globalThis.window = globalThis.window || {};
const D = await import('../../assets/chart-footprint-data.js');
const S = await import('../../assets/chart-delta-suite-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const load = (day) => D.decodeOrderflow(new Uint8Array(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/orderflow/NQ-' + day + '.bin.gz', import.meta.url))))).bars;
const rth = (bars) => bars.filter((b) => { const m = (b.t / 60000) % 1440; return m >= 13 * 60 + 30 && m < 16 * 60; });
const sum = (a) => a.reduce((x, y) => x + y, 0);
const A = rth(load('2026-10-20')), B = rth(load('2026-10-21'));
ok(A.length > 140 && B.length > 140, 'fixtures: 2 NY opens of 1m bars', [A.length, B.length]);
ok(S.STYLES.length === 14 && S.styleId(S.STYLES[0]) === 'H1' && S.styleId('V7 Session delta box') === 'V7', '14 styles, ids');

// H1: delta by price = buy - sell per row; rows sum to the session delta; topBuy/topSell are the extremes
for (const m of [1, 4, 8]) {
  const p = S.deltaProfile(A, m);
  const net = sum(A.map((b) => b.delta));
  ok(p.net === net, 'H1 m=' + m + ': rows sum to the session delta ' + net, p.net);
  let mx = -Infinity, mn = Infinity;
  for (let k = 0; k < p.n; k++) { assert.equal(p.delta[k], p.buy[k] - p.sell[k]); mx = Math.max(mx, p.delta[k]); mn = Math.min(mn, p.delta[k]); }
  ok(p.delta[p.topBuy - p.r0] === mx && p.delta[p.topSell - p.r0] === mn && p.dmax === Math.max(mx, -mn), 'H1 m=' + m + ': top buy ' + mx + ' / top sell ' + mn);
  // per-price check against the raw bars for one row
  const k = p.topBuy - p.r0; let bb = 0, ss = 0;
  for (const b of A) for (let j = 0; j < b.buy.length; j++) if (Math.floor((b.lo + j) / m) === p.topBuy) { bb += b.buy[j]; ss += b.sell[j]; }
  ok(bb - ss === p.delta[k], 'H1 m=' + m + ': top-buy row re-counted from the bars');
}
ok(S.deltaProfile([], 4) === null, 'H1: no bars -> null');

// H5: 30-minute blocks partition the bars; block deltas sum to the total
for (const len of [30, 60]) {
  const bl = S.timeBlocks(A, len);
  ok(sum(bl.map((x) => x.bars.length)) === A.length && bl.every((x) => x.t % (len * 60000) === 0 && x.bars.every((b) => b.t >= x.t && b.t < x.t + len * 60000)), 'H5 ' + len + 'm: ' + bl.length + ' clock-aligned blocks cover every bar');
  ok(sum(bl.map((x) => S.deltaProfile(x.bars, 4).net)) === sum(A.map((b) => b.delta)), 'H5 ' + len + 'm: block nets sum to the session delta');
}
ok(S.timeBlocks(A, 30).length === 5, 'H5: 09:30-12:00 NY = 5 half-hour blocks');

// V1: per-bar delta = sum(buy) - sum(sell) (what the histogram plots)
ok(A.every((b) => b.delta === sum([...b.buy]) - sum([...b.sell])), 'V1: bar delta = buys - sells on every bar');

// V2: CVD candles chain; divergence on 21 Oct (price higher high, CVD lower high, as in the mockup)
const cc = S.cvdCandles(B, 'none');
ok(cc.every((c, i) => c.c - c.o === B[i].delta && (i === 0 || c.o === cc[i - 1].c)), 'V2: CVD candles chain bar deltas');
const ds = S.divergences(B.map((b) => b.hi * 0.25), B.map((b) => b.lo * 0.25), cc.map((c) => c.h), cc.map((c) => c.l));
ok(ds.length >= 1, 'V2: 21 Oct NY open has a divergence', ds.length);
for (const d of ds) {
  if (d.kind === 'bear') ok(d.pb > d.pa && d.cb < d.ca, 'V2 bear: price HH ' + d.pa + ' -> ' + d.pb + ', CVD LH ' + d.ca + ' -> ' + d.cb);
  else ok(d.pb < d.pa && d.cb > d.ca, 'V2 bull: price LL ' + d.pa + ' -> ' + d.pb + ', CVD HL ' + d.ca + ' -> ' + d.cb);
}
const flat = S.divergences([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
ok(flat.length === 0, 'V2: a straight trend has no divergence');

// V6: big delta = |delta| >= mult x mean |delta|
const mean = sum(A.map((b) => Math.abs(b.delta))) / A.length;
const bd = S.bigDeltas(A, 2.5);
ok(Math.abs(bd.thr - 2.5 * mean) < 1e-9 && bd.hits.length > 0 && bd.hits.length === A.filter((b) => Math.abs(b.delta) >= 2.5 * mean).length, 'V6: ' + bd.hits.length + ' bars >= 2.5x avg |delta| (' + bd.thr.toFixed(0) + ')');
ok(bd.hits.every((h) => h.pocTick >= A[h.i].lo && h.pocTick <= A[h.i].hi), 'V6: bubble sits on the bar\'s POC');
ok(S.bigDeltas(A, 20).hits.length < bd.hits.length, 'V6: higher multiplier, fewer bubbles');

// V7: session box
const st = S.sessionStats(A, 5 * 60000);
const buys = sum(A.map((b) => sum([...b.buy])));
ok(st.delta === sum(A.map((b) => b.delta)) && Math.abs(st.buyPct - buys / sum(A.map((b) => b.vol)) * 100) < 1e-9, 'V7: session delta ' + st.delta + ', buyers ' + st.buyPct.toFixed(1) + '%');
ok(st.last === sum(A.slice(-5).map((b) => b.delta)), 'V7: last 5m delta = last 5 bars', st.last);
const hiBar = A.reduce((m, b, i) => (b.hi > A[m].hi ? i : m), 0), loBar = A.reduce((m, b, i) => (b.lo < A[m].lo ? i : m), 0);
ok(st.dHigh === A[hiBar].delta && st.dLow === A[loBar].delta, 'V7: delta at the high ' + st.dHigh + ' / low ' + st.dLow);

// later styles: V4 absorption + V5 key rows
const ab = A.filter((b) => S.absorption(b, 1) != null);
ok(ab.every((b) => (b.c < b.o && b.delta > 0) || (b.c > b.o && b.delta < 0)), 'V4: ' + ab.length + ' absorption bars closed against their delta');
const kr = S.keyRows(A[60], 1);
ok(kr.keys.length <= 5 && kr.keys.includes(kr.poc), 'V5: key rows include the POC');

ok(S.fmtK(-872) === '\u2212872' && S.fmtK(1400) === '1.4K' && S.fmtK(-1800) === '\u22121.8K' && S.fmtSigned(412) === '+412', 'labels: -872, 1.4K, -1.8K, +412');
console.log(n + ' passed');
