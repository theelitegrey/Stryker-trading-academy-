// node tools/tests/chart-box-canvas.test.mjs — pure helpers of assets/chart-box-canvas.js (box maths)
import assert from 'node:assert/strict';
import { union, boundsOf, snap, showBox } from '../../assets/chart-box-canvas.js';
const I = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
assert.deepEqual(boundsOf(I, [10, 20, 30, 5]), [20, 10, 60, 40]);
assert.deepEqual(boundsOf(I, [10, 20], 3), [17, 37, 23, 43]);
assert.equal(boundsOf(I, []), null);
assert.deepEqual(union(null, [1, 2, 3, 4]), [1, 2, 3, 4]);
assert.deepEqual(union([0, 5, 3, 9], [1, 2, 8, 4]), [0, 2, 8, 9]);
// dpr 2: every device px is a whole layout unit
assert.equal(snap(101, 2, false), 101);
// dpr 1.25: device px must be a multiple of 5 to be a whole 1/64 CSS px (x / 1.25 * 64 = 51.2 x)
assert.equal(snap(103, 1.25, false), 100);
assert.equal(snap(103, 1.25, true), 105);
// boxes
assert.equal(showBox(null, 100, 100, 2), null);
assert.equal(showBox([10, 10, 9, 20], 100, 100, 2), null);
assert.deepEqual(showBox([10.4, 20.6, 30.2, 40.1], 100, 100, 2), [10, 20, 31, 41]);
assert.deepEqual(showBox([-5, -5, 10, 10], 100, 100, 2), [0, 0, 10, 10]);
assert.equal(showBox([0, 0, 90, 90], 100, 100, 2), 'full');   // > 60 % of the plot
assert.equal(showBox([1, 1, 5, 5], 100, 100, 0), 'full');      // unknown pixel ratio
console.log('chart-box-canvas: ok');
