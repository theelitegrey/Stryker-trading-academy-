// TradeZoro — Charts: "Bookmap" heatmap style for the futures L2 book (ES module). Owner order 2026-11-03.
// Heatmap only: an opaque near-black field, one horizontal band per price row, columns carried forward until the next sample
// (a gap longer than HOLD_MS goes dark), a blue -> cyan -> yellow -> orange -> red -> white ramp on log(size) against the p97
// of what is on screen. No bubbles, no wall labels. Used by chart-orderflow.js cryptoDomLayer when look === 'bookmap'.
//
// Perf: the picture is built as ONE ImageData at CSS-pixel size (a pixel loop, no per-cell fillRect) on an offscreen canvas,
// cached by view + data version, and blitted. Pan / zoom / new data change the key and rebuild it (<= 4 ms at 390 on the fixture).
//
// STYLES is the style table: more looks (a name, a ramp and a scale) are added there, not as new branches.
import { hfSize, hfCutOf } from './chart-heat-filter.js?v=943';
export const BM_BG = [5, 7, 13];
export const HOLD_MS = 5 * 60000;
const RAMPS = {
  bookmap: [[0, [6, 12, 44]], [0.16, [14, 40, 140]], [0.34, [18, 96, 205]], [0.5, [0, 196, 224]], [0.64, [150, 232, 70]], [0.74, [250, 226, 40]],
    [0.84, [250, 140, 20]], [0.93, [232, 40, 30]], [1, [255, 255, 255]]],
  // Zoro: Bookmap with the blue half of the ramp swapped for black -> charcoal; the warm half is identical
  zoro: [[0, [5, 7, 13]], [0.16, [26, 26, 26]], [0.34, [46, 46, 46]], [0.5, [64, 74, 56]], [0.64, [150, 232, 70]], [0.74, [250, 226, 40]],
    [0.84, [250, 140, 20]], [0.93, [232, 40, 30]], [1, [255, 255, 255]]],
  // Split: colour by SIDE. Asks violet, bids green; thin = nearly the field, heavy = neon, the heaviest near-white
  splitAsk: [[0, [5, 7, 13]], [0.12, [30, 12, 45]], [0.45, [120, 40, 190]], [0.7, [165, 64, 235]], [0.85, [192, 77, 255]], [0.95, [222, 150, 255]], [1, [230, 200, 255]]],
  splitBid: [[0, [5, 7, 13]], [0.12, [9, 30, 17]], [0.45, [22, 125, 54]], [0.7, [34, 190, 80]], [0.85, [57, 255, 106]], [0.95, [150, 255, 175]], [1, [201, 255, 214]]],
  // Split / Heat: one ramp for size, thin -> heavy: black, dark blue, blue, white, yellow, orange, red
  splitHeat: [[0, [5, 7, 13]], [0.2, [10, 24, 92]], [0.4, [30, 80, 232]], [0.6, [255, 255, 255]], [0.75, [255, 228, 40]], [0.88, [255, 140, 20]], [1, [236, 30, 30]]],
  // Depth Heatmap (L2): deep navy -> blue -> light blue / cyan (thin book, a visible soft texture) -> white -> yellow -> orange -> red (walls)
  depth: [[0, [6, 16, 34]], [0.14, [10, 40, 78]], [0.3, [18, 78, 128]], [0.44, [34, 126, 182]], [0.56, [82, 186, 228]], [0.64, [190, 232, 250]],
    [0.7, [255, 255, 255]], [0.77, [255, 232, 64]], [0.87, [255, 146, 26]], [1, [232, 36, 22]]]
};
// rank -> ramp position for Split: the thin book stays near the field, only real walls light up
// thinnest 30% near the field, median ~45% brightness, p90 and up full neon
const SPLIT_ANCHORS = [[0, 0], [0.3, 0.12], [0.5, 0.45], [0.75, 0.65], [0.9, 0.85], [0.97, 0.95], [1, 1]];
export const STYLES = {
  bookmap: { ramp: 'bookmap', bg: BM_BG, anchors: [[0, 0.13], [0.5, 0.2], [0.75, 0.32], [0.9, 0.5], [0.97, 0.74], [0.99, 0.88], [1, 1]], hold: HOLD_MS, cap: 0.97 },
  zoro: { ramp: 'zoro', bg: BM_BG, anchors: [[0, 0.13], [0.5, 0.2], [0.75, 0.32], [0.9, 0.5], [0.97, 0.74], [0.99, 0.88], [1, 1]], hold: HOLD_MS, cap: 0.97 },
  // sided: the ramp is picked by the row's side (bid 0 / ask 1); walls: a row at ramp index >= glowFrom draws as a lineHalf*2 px full-neon line across the middle of its row, a 1.2 px halo (glow x) and a dimmer body (also glow x); liveHold: the newest column goes dark after 10 s without a sample
  // Depth Heatmap (L2): rank -> ramp. The thinnest rows still sit on a dim blue texture (0.1), the median is dark blue, p92 mid blue,
  // p96 light blue, p97.5 white, the top ~2 % yellow / orange / red: most of the book reads blue, a few walls burn.
  depth: { ramp: 'depth', bg: [7, 16, 32], anchors: [[0, 0.06], [0.5, 0.16], [0.8, 0.28], [0.92, 0.42], [0.96, 0.56], [0.975, 0.68], [0.988, 0.8], [0.996, 0.92], [1, 1]], hold: HOLD_MS, cap: 0.97 },
  split: { id: 'split', ramps: ['splitBid', 'splitAsk'], sided: true, glow: 0.55, glowFrom: 215, lineHalf: 1.5, liveHold: 10000, bg: BM_BG, anchors: SPLIT_ANCHORS, hold: HOLD_MS, cap: 0.97,
    heat: { id: 'splitHeat', ramps: ['splitHeat'], sided: false } }
};
// the table row for a view: Split + colorBy 'heat' swaps the two side ramps for the single size ramp
export function styleFor(view) {
  const S = STYLES[view.look] || STYLES.bookmap;
  if (!S.ramps) return Object.assign({ id: view.look, ramps: [S.ramp], sided: false }, S);
  return view.colorBy === 'heat' && S.heat ? Object.assign({}, S, S.heat) : S;
}
export const BID = 0, ASK = 1;
// side of a row: above the column's boundary (mid of best bid / ask) = ask; no boundary known -> the sign the book stores (bid +, ask -)
export const sideOf = (rowPrice, bound, signed) => (bound > 0 ? (rowPrice > bound ? ASK : BID) : (signed < 0 ? ASK : BID));
export const boundOf = (s) => (s.bb > 0 && s.ba > 0 ? (s.bb + s.ba) / 2 : s.mid > 0 ? s.mid : 0);
// ramp texture rows for the GPU: 256 x 2 RGBA (row 0 bid, row 1 ask; the heat ramp fills both)
export function rampTexBytes(S) {
  const out = new Uint8Array(256 * 2 * 4);
  for (let r = 0; r < 2; r++) out.set(new Uint8Array(lutOf(S.ramps[Math.min(r, S.ramps.length - 1)]).buffer.slice(0)), r * 1024);
  return out;
}
const lutCache = new Map();
function lutOf(name) {   // 256 entries of packed ABGR (little endian) for the ramp
  let l = lutCache.get(name); if (l) return l;
  const st = RAMPS[name], u = new Uint32Array(256);
  for (let k = 0; k < 256; k++) {
    const t = k / 255; let j = 0; while (j < st.length - 2 && t > st[j + 1][0]) j++;
    const a = st[j], b = st[j + 1], f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    const c = [0, 1, 2].map((i) => Math.round(a[1][i] + (b[1][i] - a[1][i]) * f));
    u[k] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  lutCache.set(name, l = u); return l;
}
// SMOOTH (Owner 2026-11-07 "add a smooth setting"): from 5 Nov 20:25 UTC the provider's book re-quotes most resting sizes every few
// seconds (before: ~2 % of levels changed in 15 s, after: ~50 % in 3 s), so raw samples draw as speckle. With Smooth on, each sample is
// drawn as the trailing average of every price row over the last `ms` (samples in (ts - ms, ts], only PAST samples: no lookahead in replay;
// an absent row counts 0; the sign is the newest non-zero one). Both layers are averaged: the coarse rows (step, i0, v) and the fine layer
// (fs, fi0, fv) when the sample has one. Colours only: the ladder, walls, trades and depth bars read the raw book. ms <= 0 returns `hist`
// itself (Off = identical pixels). Perf: a sliding sum per layer (add the new sample, drop the leaving one: O(rows) a sample), and a memo
// per sample object keyed by ms + the window's first sample, so a live frame only works out the new samples and the GPU ring keeps its
// uploads (stable v identity).
const smMemo = new WeakMap();
const LAYERS = [['step', 'i0', 'v'], ['fs', 'fi0', 'fv']];
// running sum over absolute row indices for one layer [stepKey, i0Key, vKey]; q = the samples in the sum, oldest first
function slider([kS, kI, kV]) {
  let step = 0, base = 0, sum = null, sg = null; const q = [];
  const fit = (lo, hi) => {   // make rows [lo, hi) addressable
    if (sum && lo >= base && hi <= base + sum.length) return;
    const nb = (sum ? Math.min(base, lo) : lo) - 64, ne = (sum ? Math.max(base + sum.length, hi) : hi) + 64;
    const s2 = new Float64Array(ne - nb), g2 = new Int8Array(ne - nb);
    if (sum) { s2.set(sum, base - nb); g2.set(sg, base - nb); }
    sum = s2; sg = g2; base = nb;
  };
  const acc = (h, sign) => { const v = h[kV], off = h[kI] - base; for (let r = 0; r < v.length; r++) { const x = v[r]; if (x) { sum[off + r] += sign * (x < 0 ? -x : x); if (sign > 0) sg[off + r] = x < 0 ? -1 : 1; } } };
  return {
    has: (h) => h[kS] > 0 && !!h[kV] && h[kV].length > 0,
    push(h) {   // a step change restarts the layer from this sample
      if (h[kS] !== step) { step = h[kS]; sum = null; sg = null; q.length = 0; }
      fit(h[kI], h[kI] + h[kV].length); acc(h, 1); q.push(h);
    },
    dropTo(cut) { let n = 0; while (n < q.length && q[n].ts <= cut) acc(q[n++], -1); if (n) q.splice(0, n); },
    avg() {   // { i0, v } of the window average, trimmed to the rows that hold size
      const n = q.length; if (!n) return null;
      let a = 0, b = sum.length; while (a < b && !(sum[a] > 1e-9)) a++; while (b > a && !(sum[b - 1] > 1e-9)) b--;
      const v = new Float32Array(b - a); for (let r = a; r < b; r++) v[r - a] = sum[r] > 1e-9 ? sum[r] / n * sg[r] : 0;
      return { i0: base + a, v };
    }
  };
}
// hist sorted by ts -> its samples replaced by their window averages (new objects; hist is never mutated). pick(k) (optional) = which
// samples to return (the rest only feed the window), so a zoomed-out view does not build one array per hidden sample.
export function smoothHist(hist, ms, pick) {
  if (!(ms > 0) || !hist || hist.length < 2) return hist;
  const out = [];
  let sl = null, at = -1, j = 0;   // sl holds the samples (hist[at].ts - ms, hist[at].ts]
  for (let k = 0; k < hist.length; k++) {
    if (pick && !pick(k)) continue;
    const s = hist[k];
    while (hist[j].ts <= s.ts - ms) j++;
    const m = smMemo.get(s);
    if (m && m.ms === ms && m.first === hist[j] && m.n === k - j && m.v === s.v && m.fv === s.fv) { out.push(m.s); continue; }   // n: a sample merged into the window recomputes
    if (!(s.step > 0) || !s.v || !s.v.length) { out.push(s); continue; }
    if (!sl || at >= k || at < j - 1) { sl = LAYERS.map(slider); at = j - 1; }   // (re)build from the window start
    for (let q = at + 1; q <= k; q++) { const h = hist[q]; sl.forEach((x) => { if (x.has(h)) x.push(h); }); }
    at = k; sl.forEach((x) => x.dropTo(s.ts - ms));
    const z = Object.assign({}, s);
    LAYERS.forEach(([, kI, kV], li) => { if (!sl[li].has(s)) return; const r = sl[li].avg(); if (r) { z[kI] = r.i0; z[kV] = r.v; } });
    smMemo.set(s, { ms, first: hist[j], n: k - j, v: s.v, fv: s.fv, s: z }); out.push(z);
  }
  return out;
}
// pick for a view at msPerPx: the last sample of each time bucket (nested buckets: a coarser zoom picks a subset, so memos are reused)
export function smoothPick(hist, msPerPx) {
  const b = [60000, 30000, 15000, 5000, 1000].find((x) => x <= msPerPx) || 0;
  return b ? (k) => k === hist.length - 1 || Math.floor(hist[k + 1].ts / b) !== Math.floor(hist[k].ts / b) : null;
}
// the "Smooth" input (Filter group): label -> window ms. Anything else (older saved charts have no key) = Off
export const SMOOTH_OPTS = [['Off', 0], ['15 s', 15000], ['30 s', 30000], ['60 s', 60000], ['2 min', 120000]];
export const smoothMsOf = (label) => { const o = SMOOTH_OPTS.find((x) => x[0] === label); return o ? o[1] : 0; };
export const SMOOTH_INPUT = { group: 'Filter', key: 'heatSmooth', title: 'Smooth', type: 'string', defval: 'Off', options: SMOOTH_OPTS.map((x) => x[0]),
  tooltip: 'Averages each price level over the last N seconds for a calmer picture. Sizes shown are averages.' };
const cache = { key: '', canvas: null, ms: 0, p97: 0 };
export const bmStats = () => ({ key: cache.key, ms: cache.ms, p97: cache.p97 });

// Draw into g (CSS px, already scaled by dpr). view = { x0, x1 (heat area), top, bot, dpr, hist: [{ts,step,i0,v}], tsToX(ts), yToPrice(y)
// via priceOfY(y), version, from, to, gamma, look, now }. Returns { cells, columns, ms, rows } for the test hook.
export function drawBookmap(g, view) {
  const t0 = performance.now(), S = styleFor(view);
  const x0 = Math.floor(view.x0), x1 = Math.ceil(view.x1), top = Math.floor(view.top), bot = Math.ceil(view.bot), dpr = view.dpr || 1;
  const w = Math.max(0, x1 - x0), h = Math.max(0, bot - top);
  g.fillStyle = 'rgb(' + S.bg.join(',') + ')'; g.fillRect(x0, top, w + (view.fullW ? view.fullW - x1 : 0), h);
  if (!w || !h) return { cells: 0, columns: 0, ms: 0, rows: 0 };
  const key = [view.version, view.look, view.colorBy, w, h, dpr, Math.round(view.priceTop * 100), Math.round(view.priceBot * 100), Math.round(view.tsToX(view.now - 3600000) * 4), Math.round(view.tsToX(view.now) * 4), view.gamma, view.hf ? view.hf.key : '', view.smooth || 0, view.hist.length, Math.floor(view.now / 5000)].join('|');
  if (cache.key === key && cache.canvas) { g.drawImage(cache.canvas, x0, top, w, h); return Object.assign({ ms: 0, cached: true }, cache.stat); }
  // samples in view, each with its pixel span [xa, xb): carried forward to the next sample, at most `hold`, the newest to the right edge
  const hs = view.hist, cols = [];
  for (let k = 0; k < hs.length; k++) {
    const s = hs[k]; if (!s.v || !s.v.length || !(s.step > 0)) continue;
    const next = k + 1 < hs.length ? hs[k + 1] : null;
    const lh = S.liveHold || S.hold;
    let end = next ? Math.min(next.ts, s.ts + S.hold) : view.now + 1;   // the live column runs to the edge while fresh
    if (!next && view.now - s.ts > lh) end = s.ts + lh;
    let xa = view.tsToX(s.ts), xb = next && next.ts <= s.ts + S.hold ? view.tsToX(next.ts) : view.tsToX(end);
    if (!next && view.now - s.ts <= lh) xb = x1;
    if (!(xb > xa) || xb < x0 || xa > x1) continue;
    cols.push({ s, xa: Math.max(x0, Math.floor(xa)), xb: Math.min(x1, Math.ceil(xb)) });
  }
  // price of each pixel row (centre), and the log histogram of what is visible -> p97
  const py = new Float64Array(h); for (let y = 0; y < h; y++) py[y] = view.priceOfY(top + y + 0.5);
  const BINS = 400, LMAX = 16, hist = new Float64Array(BINS); let total = 0;
  // each column counts by the pixels it covers, so ~1 live sample a second (a few px each) cannot outvote a 5-min archive column
  // (Owner 2026-11-03: history was hot while the live column was dark blue)
  for (const c of cols) { const wt = Math.max(1, c.xb - c.xa), v = c.s.v; for (let k = 0; k < v.length; k++) { const a = v[k] < 0 ? -v[k] : v[k]; if (a > 0) { const b = Math.min(BINS - 1, (Math.log(a + 1) / LMAX * BINS) | 0); hist[b] += wt; total += wt; } } }
  // RANK colouring (CoS 2026-11-03): a row's colour follows its percentile among the VISIBLE rows (history + live column together, each
  // weighted by the pixels it covers), not its raw size: the median row is dark blue, p75 medium blue, p90 cyan, p97 yellow, p99 orange/red,
  // the biggest white. Most of the field therefore reads blue and only real walls glow. `contrast` bends the rank (gamma).
  const cdf = new Float64Array(BINS); { let acc = 0; for (let b = 0; b < BINS; b++) { cdf[b] = total ? (acc + hist[b] / 2) / total : 0; acc += hist[b]; } }
  let maxSz = 1, p97 = 1; for (let b = BINS - 1; b >= 0; b--) if (hist[b] > 0) { maxSz = Math.exp((b + 1) / BINS * LMAX) - 1; break; }
  for (let b = 0; b < BINS; b++) if (cdf[b] >= S.cap) { p97 = Math.exp((b + 1) / BINS * LMAX) - 1; break; }
  const luts = S.ramps.map(lutOf), gam = Math.max(0.3, view.gamma || 1);
  const tmap = new Uint8Array(1024);   // size -> ramp index, quantised (the pixel loop does one lookup)
  const qmax = maxSz * 1.0001 / 1023;
  const rankT = (r) => { const A = S.anchors; if (r <= A[0][0]) return A[0][1]; for (let k = 1; k < A.length; k++) if (r <= A[k][0]) return A[k - 1][1] + (A[k][1] - A[k - 1][1]) * (r - A[k - 1][0]) / (A[k][0] - A[k - 1][0]); return 1; };
  for (let q = 0; q < 1024; q++) { const a = q * qmax; const b = Math.min(BINS - 1, (Math.log(a + 1) / LMAX * BINS) | 0); let r = cdf[b]; if (q === 1023) r = 1; r = Math.pow(r, 1 / gam); tmap[q] = Math.round(Math.min(1, rankT(r)) * 255); }
  let cv = cache.canvas;
  if (!cv || cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv = cache.canvas = document.createElement('canvas'); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const cg = cv.getContext('2d'), W = cv.width, H = cv.height;
  const img = cg.createImageData(W, H), px = new Uint32Array(img.data.buffer), bg = (255 << 24) | (S.bg[2] << 16) | (S.bg[1] << 8) | S.bg[0];
  px.fill(bg);
  const rowPrice = new Float64Array(H); for (let y = 0; y < H; y++) rowPrice[y] = view.priceOfY(top + (y + 0.5) / dpr);
  const tiA = new Int16Array(H), sdA = new Uint8Array(H);
  let cells = 0, blue = 0, tot = 0; const scale = 1023 / (maxSz * 1.0001);
  const hf = view.hf && view.hf.on ? view.hf : null, hfMinTi = hf ? Math.ceil(hf.p * 255 - 1e-9) : 0;   // display filter: hides cells only, the colours above are unfiltered
  // one value of column ci at a price row index (same step), 0 when outside / empty
  const at = (ci, ri) => { if (ci < 0 || ci >= cols.length) return 0; const q = cols[ci].s; if (q.step !== cols[Math.max(0, Math.min(cols.length - 1, ci))].s.step) return 0; const k = ri - q.i0; return k >= 0 && k < q.v.length ? q.v[k] : 0; };
  for (let ci = 0; ci < cols.length; ci++) {
    const c = cols[ci];
    const s = c.s, v = s.v, step = s.step, i0 = s.i0, n = v.length;
    const xa = Math.max(0, Math.round((c.xa - x0) * dpr)), xb = Math.min(W, Math.round((c.xb - x0) * dpr));
    if (xb <= xa) continue;
    // ramp index + side per pixel row for this column (-1 = empty), then the span is filled across its x range
    const bound = S.sided ? boundOf(s) : 0, hfCutV = hf && hf.top ? hfCutOf(hf.top, v) : 0;
    for (let y = 0; y < H; y++) {
      let k = Math.floor(rowPrice[y] / step + 1e-9) - i0, a = 0, sg = 0;
      if (y > 0 && y < H - 1) {   // rows thinner than a device pixel: the pixel shows the biggest row it covers
        const kA = Math.floor((rowPrice[y] + rowPrice[y - 1]) / 2 / step + 1e-9) - i0, kB = Math.floor((rowPrice[y] + rowPrice[y + 1]) / 2 / step + 1e-9) - i0;
        const lo = Math.max(0, Math.min(kA, kB)), hi = Math.min(n - 1, Math.max(kA, kB));
        if (hi > lo) { for (let m = lo; m <= hi; m++) { const z = v[m] < 0 ? -v[m] : v[m]; if (z > a) { a = z; sg = v[m]; } } k = lo; }
      }
      if (a === 0 && k >= 0 && k < n) { a = v[k]; sg = a; if (a < 0) a = -a; }
      if (a === 0) {   // hold: Bookmap keeps the last known size until it changes; a one-sample hole (size before AND after) is not a gap
        const ri = Math.floor(rowPrice[y] / step + 1e-9), pv = at(ci - 1, ri), nx = at(ci + 1, ri);
        if (pv !== 0 && nx !== 0 && (pv > 0) === (nx > 0)) { a = pv < 0 ? -pv : pv; sg = pv; } else { tiA[y] = -1; continue; }
      }
      if (hf && (!hfSize(hf, a) || a < hfCutV)) { tiA[y] = -1; continue; }
      const q = a * scale; tiA[y] = tmap[q > 1023 ? 1023 : q | 0]; if (tiA[y] < hfMinTi) { tiA[y] = -1; continue; } sdA[y] = S.sided ? sideOf(rowPrice[y], bound, sg) : 0;
    }
    const rowPx = H > 1 ? step / Math.abs(rowPrice[1] - rowPrice[0]) : 0, lineOn = S.lineHalf && rowPx > 4;
    for (let y = 0; y < H; y++) {
      let ti = tiA[y]; const sd = sdA[y];
      if (lineOn && ti >= S.glowFrom) {   // a wall: crisp line in the middle of its row, halo, dimmer body
        const fr = rowPrice[y] / step, d = Math.abs(fr - Math.floor(fr + 1e-9) - 0.5) * rowPx;
        if (d > S.lineHalf) ti = (ti * S.glow) | 0;
      }
      if (ti < 0) continue;
      const col = luts[sd][ti], o = y * W;
      if (ti < 128) blue += xb - xa; tot += xb - xa;
      for (let x = xa; x < xb; x++) px[o + x] = col;
      cells++;
    }
  }
  cg.putImageData(img, 0, 0);
  g.drawImage(cv, x0, top, w, h);
  cache.key = key; cache.ms = performance.now() - t0; cache.p97 = p97; cache.maxSz = maxSz; cache.stat = { blueShare: tot ? Math.round(blue / tot * 100) : 0, cells, columns: cols.length, rows: H, p97: Math.round(p97) };
  return Object.assign({ ms: Math.round(cache.ms * 10) / 10 }, cache.stat);
}
export { lutOf, hfCutOf };   // for chart-heatmap-gl.js (the colour ramp texture)
