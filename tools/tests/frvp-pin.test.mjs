// node tools/tests/frvp-pin.test.mjs — "Always visible": pinSessions moves the nearest off-screen profile on each side to the plot edge.
import assert from 'node:assert/strict';
import { pinSessions } from '../../assets/chart-frvp-data.js';
const xs = (s) => [s.a, s.b], W = 1000;
const L2 = { a: -900, b: -700 }, L1 = { a: -500, b: -300 }, vis = { a: 100, b: 400 }, R1 = { a: 1200, b: 1500 }, R2 = { a: 1600, b: 1800 };
const m = pinSessions([L2, L1, vis, R1, R2], xs, W);
assert.equal(m.size, 2); assert.deepEqual(m.get(L1), [4, 204]); assert.deepEqual(m.get(R1), [W - 4 - 300 > W / 2 ? W - 4 - 300 : W - 4 - 300, W - 4]);
assert.ok(!m.has(L2) && !m.has(R2) && !m.has(vis));
assert.equal(pinSessions([vis], xs, W).size, 0);                       // on screen: nothing moves
const big = pinSessions([{ a: -5000, b: -10 }], xs, W).values().next().value; assert.deepEqual(big, [4, 504]);   // width capped at half the plot
console.log('PASS frvp-pin');
