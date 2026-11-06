// Unit test: the heatmap "Smooth" setting (assets/chart-bookmap.js smoothHist / smoothPick / smoothMsOf). node tools/tests/heat-smooth.test.mjs
// Checks: Off returns the same array (identical pixels), the average equals a brute-force trailing mean, no lookahead (future samples
// never change a past output), fine layer averaged too, step change restarts, picked output = the same samples unpicked, memo invalidates.
import assert from 'assert';
const { smoothHist, smoothPick, smoothMsOf, SMOOTH_INPUT } = await import('../../assets/chart-bookmap.js');

// a flickering book: 40 rows, sizes re-quoted every sample, bids + below row 20, asks - above
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const mk = (n, dt = 1000, t0 = 1e12) => Array.from({ length: n }, (_, k) => {
  const i0 = 100 + (k % 3), v = Float32Array.from({ length: 40 }, (_, r) => (rnd() < 0.3 ? 0 : Math.round(rnd() * 50)) * (r < 20 ? 1 : -1));
  const fv = Float32Array.from({ length: 12 }, () => Math.round(rnd() * 9));
  return { ts: t0 + k * dt, step: 2.5, i0, v, fs: 0.25, fi0: 1000 + (k % 2), fv };
});
// brute force: mean over samples with ts in (t - ms, t] at absolute row index
function brute(h, k, ms, kS = 'step', kI = 'i0', kV = 'v') {
  const s = h[k], win = h.filter((x) => x.ts > s.ts - ms && x.ts <= s.ts && x[kS] === s[kS]), m = new Map(), sg = new Map();
  for (const x of win) x[kV].forEach((a, r) => { if (a) { m.set(x[kI] + r, (m.get(x[kI] + r) || 0) + Math.abs(a)); sg.set(x[kI] + r, Math.sign(a)); } });
  return (row) => (m.get(row) || 0) / win.length * (sg.get(row) || 0);
}
const at = (z, row, kI = 'i0', kV = 'v') => { const r = row - z[kI]; return r >= 0 && r < z[kV].length ? z[kV][r] : 0; };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, msg + ': ' + a + ' vs ' + b);

const H = mk(300);
// 1. Off: the very same array and objects
assert.strictEqual(smoothHist(H, 0), H); assert.strictEqual(smoothHist(H, undefined), H);
assert.equal(smoothMsOf('Off'), 0); assert.equal(smoothMsOf(undefined), 0); assert.equal(smoothMsOf('nonsense'), 0);
assert.equal(smoothMsOf('15 s'), 15000); assert.equal(smoothMsOf('30 s'), 30000); assert.equal(smoothMsOf('60 s'), 60000); assert.equal(smoothMsOf('2 min'), 120000);
assert.equal(SMOOTH_INPUT.defval, 'Off'); assert.deepEqual(SMOOTH_INPUT.options, ['Off', '15 s', '30 s', '60 s', '2 min']); assert.equal(SMOOTH_INPUT.group, 'Filter');

// 2. equals the brute-force trailing mean, coarse and fine layer
for (const ms of [15000, 30000, 120000]) {
  const S = smoothHist(H, ms);
  assert.equal(S.length, H.length);
  for (const k of [0, 1, 14, 15, 16, 77, 150, 299]) {
    const b = brute(H, k, ms), bf = brute(H, k, ms, 'fs', 'fi0', 'fv');
    for (let row = 95; row < 150; row++) close(at(S[k], row), b(row), 'coarse ms ' + ms + ' k ' + k + ' row ' + row);
    for (let row = 995; row < 1020; row++) close(at(S[k], row, 'fi0', 'fv'), bf(row), 'fine ms ' + ms + ' k ' + k + ' row ' + row);
    assert.equal(S[k].ts, H[k].ts); assert.equal(S[k].step, H[k].step);
  }
}
assert.ok(H.every((s, k) => s.i0 === 100 + (k % 3) && s.v.length === 40), 'input not mutated');

// 3. no lookahead: changing / adding FUTURE samples never changes a past output
const S1 = smoothHist(H, 60000).map((z) => Array.from(z.v));
const H2 = H.map((s, k) => (k > 200 ? Object.assign({}, s, { v: s.v.map((x) => x * 10) }) : s)).concat(mk(50, 1000, H[299].ts + 1000));
const S2 = smoothHist(H2, 60000);
for (let k = 0; k <= 200; k++) assert.deepEqual(Array.from(S2[k].v), S1[k], 'sample ' + k + ' changed by the future');

// 4. step change restarts the window (no mixing of row sizes)
const St = H.slice(0, 30).concat(H.slice(30, 60).map((s) => Object.assign({}, s, { step: 5 })));
const Ss = smoothHist(St, 60000);
const b31 = brute(St, 31, 60000); for (let row = 95; row < 150; row++) close(at(Ss[31], row), b31(row), 'step change row ' + row);

// 5. picked output = the same samples when computed in full; smoothPick keeps the last sample of each bucket
const full = smoothHist(H, 30000), pk = smoothPick(H, 5000), picked = smoothHist(H, 30000, pk);
const idx = H.map((_, k) => k).filter(pk);
assert.equal(picked.length, idx.length); assert.ok(idx.length < H.length && idx.includes(H.length - 1));
idx.forEach((k, n) => assert.deepEqual(Array.from(picked[n].v), Array.from(full[k].v), 'pick ' + k));
assert.equal(smoothPick(H, 500), null);                                    // finer than 1 s a pixel: every sample drawn
const fresh = smoothHist(H, 30000, pk); fresh.forEach((z, n) => assert.strictEqual(z, picked[n], 'memo reuse'));

// 6. memo: a sample merged into the window (older data arrived) recomputes; the same input returns the same objects
const late = H.slice(0, 100).concat([Object.assign({}, H[100], { ts: H[100].ts - 500 })], H.slice(100)).sort((a, b) => a.ts - b.ts);
const Sl = smoothHist(late, 30000), kL = late.indexOf(H[110]), bl = brute(late, kL, 30000);
for (let row = 95; row < 150; row++) close(at(Sl[kL], row), bl(row), 'late merge row ' + row);

// 7. perf: 1 h of 1 s samples (3600, ~800 rows), 2 min window, under a phone-ish budget on this server
const big = Array.from({ length: 3600 }, (_, k) => ({ ts: 1e12 + k * 1000, step: 0.25, i0: 80000 + (k % 5), v: Float32Array.from({ length: 800 }, (_, r) => (r % 7) * (r < 400 ? 1 : -1) + (k % 3)) }));
let t0 = performance.now(); smoothHist(big, 120000); const ms1 = performance.now() - t0;
t0 = performance.now(); smoothHist(big, 120000); const ms2 = performance.now() - t0;
console.log('perf 1 h x 800 rows, 2 min: first ' + ms1.toFixed(0) + ' ms, memo ' + ms2.toFixed(1) + ' ms');
assert.ok(ms1 < 1500 && ms2 < 20);
console.log('heat-smooth unit OK');
