// tailOf (assets/chart-pine-next.js): on a tick the Pine worker gets only the changed tail, never a wrong splice.
//   node tools/tests/chart-pine-tail.test.mjs
import assert from 'node:assert/strict';
import { tailOf } from '../../assets/chart-pine-next.js';

const bars = (n, t0 = 0) => Array.from({ length: n }, (_, i) => ({ time: t0 + i * 60, close: i }));
const sent = (b) => ({ sent: { n: b.length, first: b[0].time, last: b[b.length - 1].time } });
const b = bars(100), s = sent(b);

// same bar updated: resend the last bar only
assert.deepEqual(tailOf(s, b, undefined), { from: 99, tail: [b[99]] });
// one new bar: the last known bar + the new one
const b1 = bars(101);
assert.deepEqual(tailOf(s, b1, undefined), { from: 99, tail: b1.slice(99) });
// full resend: a reason, nothing sent yet, history prepended, 3+ new bars, fewer bars, last bar time changed
assert.equal(tailOf(s, b1, 'backfill'), null);
assert.equal(tailOf({}, b1), null);
assert.equal(tailOf(s, bars(101, -60)), null);
assert.equal(tailOf(s, bars(103)), null);
assert.equal(tailOf(s, bars(99)), null);
const moved = bars(100); moved[99] = { time: 99 * 60 + 1, close: 0 };
assert.equal(tailOf(s, moved), null);
console.log('chart-pine-tail: ok');
