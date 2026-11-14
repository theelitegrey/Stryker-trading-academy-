// Heavy-activity limit scales with the timeframe; 2 h / 4 h futures order-flow bars line up with the chart's New York-anchored candles (GK 14 Nov).
//   node tools/tests/fp-tf-heavy.test.mjs
import assert from 'node:assert/strict';
const FD = await import('../../assets/chart-footprint-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const near = (a, b) => Math.abs(a - b) < 0.01;
ok(FD.heavyLimit([], 'fixed', 3, 100, 1) === 100 && FD.heavyLimit([], 'fixed', 3, 100) === 100, '1m fixed limit unchanged');
ok(near(FD.heavyLimit([], 'fixed', 3, 100, 15), 387.298) && near(FD.heavyLimit([], 'fixed', 3, 100, 60), 774.597) && near(FD.heavyLimit([], 'fixed', 3, 100, 240), 1549.193), 'fixed limit x sqrt(minutes) on 15m, 1h, 4h');
ok(FD.heavyLimit([10, 10, 0], 'avg', 3, 100, 240) === 30 && FD.heavyLimit([1], 'fixed', 3, 0, 15) === Infinity, 'avg mode and the off-case are not scaled');
// 4h bars: 18, 22, 02, 06, 10, 14 New York. Winter (EST, UTC-5) and summer (EDT, UTC-4).
const H = 3600000, T4 = 4 * H;
ok(FD.bucketNY(Date.UTC(2026, 0, 14, 23, 5), T4) === Date.UTC(2026, 0, 14, 23, 0), 'winter: 18:00 ET = 23:00 UTC starts a 4h bar');
ok(FD.bucketNY(Date.UTC(2026, 0, 15, 2, 59), T4) === Date.UTC(2026, 0, 14, 23, 0), 'winter: 21:59 ET sits in the 18:00 ET bar');
ok(FD.bucketNY(Date.UTC(2026, 6, 14, 22, 5), T4) === Date.UTC(2026, 6, 14, 22, 0), 'summer: 18:00 ET = 22:00 UTC starts a 4h bar');
ok(FD.bucketNY(Date.UTC(2026, 10, 13, 15, 0), T4) === Date.UTC(2026, 10, 13, 15, 0) && FD.bucketNY(Date.UTC(2026, 10, 13, 18, 59), T4) === Date.UTC(2026, 10, 13, 15, 0), 'Nov 13 (EST): 10:00 ET bar = 15:00 UTC');
// aggregate: 1m bars of one 4h bucket merge into ONE bar keyed on the NY bucket; the epoch default would split them
const mk = (t) => ({ t, lo: 1, hi: 1, o: 1, c: 1, buy: Int32Array.of(2), sell: Int32Array.of(1), vol: 3, delta: 1, dmax: 1, dmin: 0, trades: 1, bigs: [] });
const mins = []; for (let t = Date.UTC(2026, 10, 13, 15, 0); t < Date.UTC(2026, 10, 13, 19, 0); t += 60000) mins.push(mk(t));
const ny = FD.aggregate(mins, T4, true), ep = FD.aggregate(mins, T4);
ok(ny.length === 1 && ny[0].t === Date.UTC(2026, 10, 13, 15, 0) && ny[0].mins === 240 && ny[0].delta === 240, 'NY aggregate: one 4h bar, 240 minutes', ny.map((b) => [b.t, b.mins]));
ok(ep.length === 2, 'epoch aggregate splits that window (the old bug: bars never matched the chart candles)', ep.map((b) => b.t));
ok(FD.aggregate(mins.slice(0, 30), 15 * 60000, true).length === 2 && FD.aggregate(mins, T4 / 2, true).every((b) => b.t % (2 * H) !== undefined), 'sub-2h timeframes keep epoch buckets');
console.log(n + ' passed');
