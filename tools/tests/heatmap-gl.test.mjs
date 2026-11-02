// Unit test: ring-buffer column mapping + colour ramp texture bytes (assets/chart-heatmap-gl.js). node tools/tests/heatmap-gl.test.mjs
import assert from 'assert';
globalThis.location = { search: '' };
const GL = await import('../../assets/chart-heatmap-gl.js?v=793').catch(async () => import('../../assets/chart-heatmap-gl.js'));
const { RING_COLS: N, ringSlot, ringRuns, rampBytes, normOf } = GL;
assert.equal(ringSlot(0), 0); assert.equal(ringSlot(N), 0); assert.equal(ringSlot(N + 5), 5); assert.equal(ringSlot(-1), N - 1);
assert.deepEqual(ringRuns(10, 3), [[10, 3]]);
assert.deepEqual(ringRuns(N - 2, 5), [[N - 2, 2], [0, 3]]);          // wraps once
assert.deepEqual(ringRuns(N * 3, N + 50), [[0, N]]);                 // never more than one lap
assert.equal(ringRuns(7, 0).length, 0);
const r = rampBytes('bookmap');
assert.equal(r.length, 1024);
assert.deepEqual([...r.slice(0, 4)], [6, 12, 44, 255]);              // t=0 -> first ramp stop, opaque (RGBA byte order)
assert.deepEqual([...r.slice(1020, 1024)], [255, 255, 255, 255]);    // t=1 -> white
const A = [[0, 0.13], [0.5, 0.2], [0.75, 0.32], [0.9, 0.5], [0.97, 0.74], [0.99, 0.88], [1, 1]];
const v = Float32Array.from({ length: 1000 }, (_, k) => (k % 2 ? -1 : 1) * (1 + k));   // 1..1000, mixed sign
const n = normOf([{ v, wt: 3 }], A, 0.97, 1);
assert.equal(n.tmap.length, 1024); assert.equal(n.tmap[1023], 255);                 // the biggest size is white
assert.ok(n.tmap[0] >= 33 - 2 && n.tmap[0] <= 40);                                  // rank 0 -> first anchor (0.13 * 255)
for (let q = 1; q < 1024; q++) assert.ok(n.tmap[q] >= n.tmap[q - 1]);               // monotonic
assert.ok(n.p97 > 900 && n.p97 < 1100 && n.maxSz > 1000);
assert.ok(normOf([], A, 0.97, 1).tmap[5] >= 0);                                     // empty view does not throw
console.log('heatmap-gl unit OK');
