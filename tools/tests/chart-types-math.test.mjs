// Extra chart types: hand-computed worked examples (see stryker-notes/reports/workers/chart-types.md).  node tools/tests/chart-types-math.test.mjs
import assert from 'node:assert/strict';
import { renko, range, lineBreak, kagi, pnf, heikin, hollowLook, atr, nice } from '../../assets/chart-types-math.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const cl = (arr) => arr.map((c, i) => ({ time: 1000 + i * 60, open: c, high: c, low: c, close: c }));
const oc = (r) => r.map((b) => [b.open, b.close]);

// Renko, brick 2: 50 -> 52.5 makes 50-52; 56.1 makes 52-54 and 54-56; 55 and 53.9 do nothing; 52 (two bricks back) makes 54-52
assert.deepEqual(oc(renko(cl([50, 52.5, 56.1, 55, 53.9, 52]), 2, 'close')), [[50, 52], [52, 54], [54, 56], [54, 52]]);
ok('Renko: several bricks from one close, reversal needs two bricks of move, corners touch');
assert.deepEqual(oc(renko(cl([50, 51.9, 50.1]), 2, 'close')), []); ok('Renko: moves smaller than a brick add nothing');

// Line break (3 lines): 10 11 12 13 | 12.5 inside | 9.5 breaks the low of the last 3 lines (10) | 14 breaks the high of the last 3 (13)
assert.deepEqual(oc(lineBreak(cl([10, 11, 12, 13, 12.5, 9.5, 14]), 3)), [[10, 11], [11, 12], [12, 13], [12, 9.5], [12, 14]]);
ok('Line break x3: continuation opens at last close, reversal opens at last open, inside closes add nothing');
assert.deepEqual(oc(lineBreak(cl([10, 11, 12, 13, 10.5]), 3)), [[10, 11], [11, 12], [12, 13]]); ok('Line break x3: a close back to 10.5 is not below the 3-line low (10) -> no reversal');

// Kagi, reversal 2 (close source)
const k = kagi(cl([10, 12, 13, 12, 10.5, 11, 14, 12, 10]), 2, 'close');
assert.deepEqual(oc(k), [[10, 13], [13, 10.5], [10.5, 14], [14, 10]]);
assert.deepEqual(k.map((x) => [x.thick0, x.brk, x.thick1]), [[true, null, true], [true, null, true], [true, 13, true], [true, 10.5, false]]);
ok('Kagi: reversals, shoulder 13 broken -> stays yang, waist 10.5 broken -> turns yin');

// P&F, box 1, 3-box reversal
const p = pnf(cl([10.5, 11.2, 13.0, 12.5, 10.2, 9.5, 12.1]), 1, 3, 'close');
assert.deepEqual(p.map((c) => [c.up, c.low, c.high]), [[true, 10, 14], [false, 9, 13], [true, 10, 13]]);
ok('P&F 1x3: X 10-14, 3-box reversal to O one box below the X top, then back to X');
assert.equal(pnf(cl([10.5, 11.2, 13.0, 11.5]), 1, 3, 'close').length, 1); ok('P&F: a 1.5-box pullback is no reversal');

// Range, size 4
const rb = range([{ time: 1, open: 10, high: 12, low: 9, close: 11 }, { time: 2, open: 11, high: 15, low: 10, close: 14 }], 4);
assert.deepEqual(rb.map((b) => [b.open, b.high, b.low, b.close]), [[10, 13, 9, 13], [13, 15, 13, 14]]);
ok('Range 4: closes at exactly 4, next opens at that close, last bar is the forming one');

// Heikin Ashi first two bars
const h = heikin([{ time: 1, open: 10, high: 14, low: 8, close: 12 }, { time: 2, open: 12, high: 16, low: 11, close: 15 }]);
assert.deepEqual([h[0].open, h[0].close], [11, 11]); assert.deepEqual([h[1].open, h[1].close, h[1].high, h[1].low], [11, 13.5, 16, 11]);
ok('Heikin Ashi: seed (O+C)/2, close (O+H+L+C)/4, open (prev o + prev c)/2');

// Hollow candles: the 4 looks
assert.deepEqual(hollowLook({ open: 10, close: 12 }, 11), { hollow: true, up: true });    // green hollow
assert.deepEqual(hollowLook({ open: 12, close: 11.5 }, 11), { hollow: false, up: true }); // green filled
assert.deepEqual(hollowLook({ open: 10, close: 11 }, 12), { hollow: true, up: false });   // red hollow
assert.deepEqual(hollowLook({ open: 12, close: 10 }, 11), { hollow: false, up: false });  // red filled
ok('Hollow candles: hollow = close>open, colour = close vs previous close');

// ATR: constant TR of 2 -> ATR 2; size rounding
assert.equal(atr(Array.from({ length: 20 }, (_, i) => ({ time: i, open: 10, high: 12, low: 10, close: 10 })), 14), 2);
assert.equal(nice(12.3456), 12); assert.equal(nice(0.0123), 0.012); ok('ATR + brick size rounding');
console.log(n + ' passed');
