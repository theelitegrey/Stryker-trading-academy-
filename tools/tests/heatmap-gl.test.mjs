// Unit test: ring-buffer column mapping + colour ramp texture bytes (assets/chart-heatmap-gl.js). node tools/tests/heatmap-gl.test.mjs
import assert from 'assert';
globalThis.location = { search: '' };
const GL = await import('../../assets/chart-heatmap-gl.js?v=793').catch(async () => import('../../assets/chart-heatmap-gl.js'));
const { RING_COLS: N, ringSlot, ringRuns, rampBytes, p97Of } = GL;
assert.equal(ringSlot(0), 0); assert.equal(ringSlot(N), 0); assert.equal(ringSlot(N + 5), 5); assert.equal(ringSlot(-1), N - 1);
assert.deepEqual(ringRuns(10, 3), [[10, 3]]);
assert.deepEqual(ringRuns(N - 2, 5), [[N - 2, 2], [0, 3]]);          // wraps once
assert.deepEqual(ringRuns(N * 3, N + 50), [[0, N]]);                 // never more than one lap
assert.equal(ringRuns(7, 0).length, 0);
const r = rampBytes('bookmap');
assert.equal(r.length, 1024);
assert.deepEqual([...r.slice(0, 4)], [6, 12, 44, 255]);              // t=0 -> first ramp stop, opaque (RGBA byte order)
assert.deepEqual([...r.slice(1020, 1024)], [255, 255, 255, 255]);    // t=1 -> white
assert.equal(p97Of([], 0.97), 1);
assert.ok(Math.abs(p97Of([{ v: new Float32Array(100).fill(50), wt: 1 }], 0.97) - 50) < 5);
console.log('heatmap-gl unit OK');
