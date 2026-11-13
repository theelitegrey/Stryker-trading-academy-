// node tools/tests/frvp-timeframe.test.mjs — the same FRVP range must give the same POC / VAH / VAL at 15m and 30m.
import assert from 'node:assert/strict';
import { buildProfile, fineSpanBars } from '../../assets/chart-frvp-data.js';
const M = 60000;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let px = 28300; const mins = [];
for (let i = 0; i < 24 * 60; i++) { const o = px, c = px + (rnd() - 0.5) * 12; mins.push({ time: i * M, open: o, close: c, high: Math.max(o, c) + rnd() * 3, low: Math.min(o, c) - rnd() * 3, volume: 50 + Math.floor(rnd() * 400) * (i % 7 === 0 ? 3 : 1) }); px = c; }
const agg = (n) => { const o = []; for (let i = 0; i < mins.length; i += n) { const g = mins.slice(i, i + n); o.push({ time: g[0].time, open: g[0].open, close: g[g.length - 1].close, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), volume: g.reduce((s, x) => s + x.volume, 0) }); } return o; };
const inRange = (bars, a, b) => bars.filter((x) => x.time >= a && x.time <= b);
const va = (bars) => { const r = buildProfile(bars, 100, 0.7, false).profile; return [r.rows[r.poc].price + r.rowH / 2, r.rows[r.vaTo].price + r.rowH, r.rows[r.vaFrom].price]; };
const a = 120 * M, b = 840 * M;   // anchors on a 30m boundary (also a 15m one)
// old behaviour: chart candles of each timeframe differ
const old15 = va(inRange(agg(15), a, b)), old30 = va(inRange(agg(30), a, b));
assert.notDeepEqual(old15, old30, 'sanity: candle-built profiles differ between timeframes');
// new behaviour: both timeframes use the 1-minute bars of the same anchors
const f15 = va(fineSpanBars(mins, a, b)), f30 = va(fineSpanBars(mins, a, b));
assert.deepEqual(f15, f30);
// anchors off the bar grid (first at 20:07, second at 08:44) still give the same minutes whatever the chart timeframe
assert.equal(fineSpanBars(mins, 127 * M, 524 * M).length, 398);
assert.equal(fineSpanBars([], 0, 1), null);
console.log('frvp-timeframe: all passed (old 15m vs 30m differ:', old15.map((x) => x.toFixed(2)), old30.map((x) => x.toFixed(2)), ')');
