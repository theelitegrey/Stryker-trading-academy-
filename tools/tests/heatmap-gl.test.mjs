// Unit test: ring-buffer column mapping + colour ramp texture bytes (assets/chart-heatmap-gl.js). node tools/tests/heatmap-gl.test.mjs
import assert from 'assert';
globalThis.location = { search: '' };
const GL = await import('../../assets/chart-heatmap-gl.js?v=982').catch(async () => import('../../assets/chart-heatmap-gl.js'));
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
// ---- Split style: side pick, ramp textures, style switch ----
const BMm = await import('../../assets/chart-bookmap.js');
const { sideOf, boundOf, rampTexBytes, styleFor, BID, ASK } = BMm;
assert.equal(sideOf(105, 100, 5), ASK); assert.equal(sideOf(95, 100, -5), BID);        // the boundary wins over the stored sign
assert.equal(sideOf(100, 100, 5), BID);                                                // at the boundary = bid side
assert.equal(sideOf(95, 0, -5), ASK); assert.equal(sideOf(95, 0, 5), BID);              // no boundary: the stored sign
assert.equal(boundOf({ bb: 99.5, ba: 100.5, mid: 90 }), 100); assert.equal(boundOf({ mid: 90 }), 90); assert.equal(boundOf({}), 0);
const sp = styleFor({ look: 'split', colorBy: 'side' }), ht = styleFor({ look: 'split', colorBy: 'heat' });
assert.equal(sp.sided, true); assert.equal(ht.sided, false); assert.equal(styleFor({ look: 'bookmap' }).sided, false);
const tx = rampTexBytes(sp);
assert.equal(tx.length, 256 * 2 * 4);
assert.deepEqual([...tx.slice(0, 4)], [5, 7, 13, 255]); assert.deepEqual([...tx.slice(1024, 1028)], [5, 7, 13, 255]);  // thin = the field
assert.deepEqual([...tx.slice(1020, 1024)], [201, 255, 214, 255]);                      // bid row, heaviest: near-white green
assert.deepEqual([...tx.slice(2044, 2048)], [230, 200, 255, 255]);                      // ask row, heaviest: near-white lilac
const gC = (b, o) => b[o + 1], rC = (b, o) => b[o];
assert.ok(gC(tx, 4 * 200) > rC(tx, 4 * 200) && rC(tx, 1024 + 4 * 200) > gC(tx, 1024 + 4 * 200));   // bid reads green, ask reads violet
const th = rampTexBytes(ht);
assert.deepEqual([...th.slice(0, 1024)], [...th.slice(1024)]);                          // heat: both rows are the same ramp
assert.deepEqual([...th.slice(1020, 1024)], [236, 30, 30, 255]);                        // heaviest = red
console.log('split unit OK');
// ---- Zoro: Bookmap ramp without blue ----
{
  const z = rampTexBytes(styleFor({ look: 'zoro' })), bmr = rampTexBytes(styleFor({ look: 'bookmap' }));
  assert.equal(z.length, 256 * 2 * 4);
  let blue = 0, bmBlue = 0;
  for (let k = 0; k < 256; k++) { const o = k * 4; if (z[o + 2] > z[o] + 20 && z[o + 2] > z[o + 1] + 20) blue++; if (bmr[o + 2] > bmr[o] + 20 && bmr[o + 2] > bmr[o + 1] + 20) bmBlue++; }
  assert.equal(blue, 0); assert.ok(bmBlue > 40);                       // Bookmap has a blue half, Zoro none
  assert.deepEqual([...z.slice(0, 4)], [5, 7, 13, 255]);               // thin = the field
  assert.deepEqual([...z.slice(1020, 1024)], [...bmr.slice(1020, 1024)]);   // heaviest = white, as Bookmap
  const k = 200 * 4; assert.deepEqual([...z.slice(k, k + 4)], [...bmr.slice(k, k + 4)]);   // the warm part is identical
  assert.equal(styleFor({ look: 'zoro' }).sided, false);
  assert.deepEqual(styleFor({ look: 'zoro' }).anchors, styleFor({ look: 'bookmap' }).anchors);
}
console.log('zoro unit OK');
// ---- Split v2: mid brightness, thin 30% near black, wall line settings ----
{
  const S2 = styleFor({ look: 'split', colorBy: 'side' }), t2 = rampTexBytes(S2), A = S2.anchors;
  const posOf = (rank) => { for (let k = 1; k < A.length; k++) if (rank <= A[k][0]) return A[k - 1][1] + (A[k][1] - A[k - 1][1]) * (rank - A[k - 1][0]) / (A[k][0] - A[k - 1][0]); return 1; };
  const at = (row, rank) => { const o = row * 1024 + Math.round(posOf(rank) * 255) * 4; return Math.max(t2[o], t2[o + 1], t2[o + 2]); };
  assert.ok(at(0, 0.3) < 50 && at(1, 0.3) < 50);                         // the thinnest 30% stay near black
  assert.ok(at(0, 0.5) >= 255 * 0.35 && at(1, 0.5) >= 255 * 0.35);      // the median reads 35%+ bright
  assert.ok(at(0, 0.9) >= 250 && at(1, 0.9) >= 250);                     // p90 = full neon
  assert.ok(S2.lineHalf > 0 && S2.liveHold === 10000 && S2.glowFrom <= Math.round(posOf(0.9) * 255));
}
console.log('split v2 unit OK');
