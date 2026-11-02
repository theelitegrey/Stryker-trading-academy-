// TradeZoro — Charts: "Bookmap" heatmap style for the futures L2 book (ES module). Owner order 2026-11-03.
// Heatmap only: an opaque near-black field, one horizontal band per price row, columns carried forward until the next sample
// (a gap longer than HOLD_MS goes dark), a blue -> cyan -> yellow -> orange -> red -> white ramp on log(size) against the p97
// of what is on screen. No bubbles, no wall labels. Used by chart-orderflow.js cryptoDomLayer when look === 'bookmap'.
//
// Perf: the picture is built as ONE ImageData at CSS-pixel size (a pixel loop, no per-cell fillRect) on an offscreen canvas,
// cached by view + data version, and blitted. Pan / zoom / new data change the key and rebuild it (<= 4 ms at 390 on the fixture).
//
// STYLES is the style table: more looks (a name, a ramp and a scale) are added there, not as new branches.
export const BM_BG = [5, 7, 13];
export const HOLD_MS = 5 * 60000;
const RAMPS = {
  bookmap: [[0, [6, 12, 44]], [0.16, [14, 40, 140]], [0.34, [18, 96, 205]], [0.5, [0, 196, 224]], [0.64, [150, 232, 70]], [0.74, [250, 226, 40]],
    [0.84, [250, 140, 20]], [0.93, [232, 40, 30]], [1, [255, 255, 255]]]
};
export const STYLES = {
  bookmap: { ramp: 'bookmap', bg: BM_BG, floor: 0.1, empty: 14, pow: 1.7, hold: HOLD_MS, cap: 0.97 }
};
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
const cache = { key: '', canvas: null, ms: 0, p97: 0 };
export const bmStats = () => ({ key: cache.key, ms: cache.ms, p97: cache.p97 });

// Draw into g (CSS px, already scaled by dpr). view = { x0, x1 (heat area), top, bot, dpr, hist: [{ts,step,i0,v}], tsToX(ts), yToPrice(y)
// via priceOfY(y), version, from, to, gamma, look, now }. Returns { cells, columns, ms, rows } for the test hook.
export function drawBookmap(g, view) {
  const t0 = performance.now(), S = STYLES[view.look] || STYLES.bookmap;
  const x0 = Math.floor(view.x0), x1 = Math.ceil(view.x1), top = Math.floor(view.top), bot = Math.ceil(view.bot), dpr = view.dpr || 1;
  const w = Math.max(0, x1 - x0), h = Math.max(0, bot - top);
  g.fillStyle = 'rgb(' + S.bg.join(',') + ')'; g.fillRect(x0, top, w + (view.fullW ? view.fullW - x1 : 0), h);
  if (!w || !h) return { cells: 0, columns: 0, ms: 0, rows: 0 };
  const key = [view.version, view.look, w, h, dpr, Math.round(view.priceTop * 100), Math.round(view.priceBot * 100), Math.round(view.tsToX(view.now - 3600000) * 4), Math.round(view.tsToX(view.now) * 4), view.gamma, view.hist.length, Math.floor(view.now / 5000)].join('|');
  if (cache.key === key && cache.canvas) { g.drawImage(cache.canvas, x0, top, w, h); return Object.assign({ ms: 0, cached: true }, cache.stat); }
  // samples in view, each with its pixel span [xa, xb): carried forward to the next sample, at most `hold`, the newest to the right edge
  const hs = view.hist, cols = [];
  for (let k = 0; k < hs.length; k++) {
    const s = hs[k]; if (!s.v || !s.v.length || !(s.step > 0)) continue;
    const next = k + 1 < hs.length ? hs[k + 1] : null;
    let end = next ? Math.min(next.ts, s.ts + S.hold) : view.now + 1;   // the live column runs to the edge while fresh
    if (!next && view.now - s.ts > S.hold) end = s.ts + S.hold;
    let xa = view.tsToX(s.ts), xb = next && next.ts <= s.ts + S.hold ? view.tsToX(next.ts) : view.tsToX(end);
    if (!next && view.now - s.ts <= S.hold) xb = x1;
    if (!(xb > xa) || xb < x0 || xa > x1) continue;
    cols.push({ s, xa: Math.max(x0, Math.floor(xa)), xb: Math.min(x1, Math.ceil(xb)) });
  }
  // price of each pixel row (centre), and the log histogram of what is visible -> p97
  const py = new Float64Array(h); for (let y = 0; y < h; y++) py[y] = view.priceOfY(top + y + 0.5);
  const BINS = 400, LMAX = 16, hist = new Float64Array(BINS); let total = 0;
  // each column counts by the pixels it covers, so ~1 live sample a second (a few px each) cannot outvote a 5-min archive column
  // (Owner 2026-11-03: history was hot while the live column was dark blue)
  for (const c of cols) { const wt = Math.max(1, c.xb - c.xa), v = c.s.v; for (let k = 0; k < v.length; k++) { const a = v[k] < 0 ? -v[k] : v[k]; if (a > 0) { const b = Math.min(BINS - 1, (Math.log(a + 1) / LMAX * BINS) | 0); hist[b] += wt; total += wt; } } }
  let p97 = 1; if (total) { let acc = 0; const want = total * S.cap; for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc >= want) { p97 = Math.exp((b + 1) / BINS * LMAX) - 1; break; } } }
  // t = ln(1 + size) against ln(1 + 2.5 x p97), then a power > 1 so the many small levels stay in the blues: p97 lands in orange,
  // 2.5 x p97 and above is white. `contrast` (gamma) steepens or flattens it.
  const lut = lutOf(S.ramp), den = 1 / Math.log1p(p97 * 2.5), gam = S.pow / Math.max(0.3, view.gamma || 1);
  const tmap = new Uint8Array(1024);   // size -> ramp index, quantised (the pixel loop does one lookup)
  const qmax = p97 * 2.5 / 1023;
  for (let q = 0; q < 1024; q++) { let t = Math.log1p(q * qmax) * den; t = t > 1 ? 1 : Math.pow(t, gam); t = S.floor + (1 - S.floor) * t; tmap[q] = Math.round(Math.min(1, t) * 255); }
  let cv = cache.canvas;
  if (!cv || cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv = cache.canvas = document.createElement('canvas'); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const cg = cv.getContext('2d'), W = cv.width, H = cv.height;
  const img = cg.createImageData(W, H), px = new Uint32Array(img.data.buffer), bg = (255 << 24) | (S.bg[2] << 16) | (S.bg[1] << 8) | S.bg[0];
  px.fill(bg);
  const rowPrice = new Float64Array(H); for (let y = 0; y < H; y++) rowPrice[y] = view.priceOfY(top + (y + 0.5) / dpr);
  const emptyCol = lut[S.empty]; let cells = 0; const scale = 1023 / (p97 * 2.5);
  for (const c of cols) {
    const s = c.s, v = s.v, step = s.step, i0 = s.i0, n = v.length;
    const xa = Math.max(0, Math.round((c.xa - x0) * dpr)), xb = Math.min(W, Math.round((c.xb - x0) * dpr));
    if (xb <= xa) continue;
    // one colour per pixel row for this column, then the span is filled across its x range
    for (let y = 0; y < H; y++) {
      const k = Math.floor(rowPrice[y] / step + 1e-9) - i0;
      if (k < 0 || k >= n) continue;
      let a = v[k]; if (a < 0) a = -a;
      const q = a * scale, col = a === 0 ? emptyCol : lut[tmap[q > 1023 ? 1023 : q | 0]], o = y * W;
      for (let x = xa; x < xb; x++) px[o + x] = col;
      cells++;
    }
  }
  cg.putImageData(img, 0, 0);
  g.drawImage(cv, x0, top, w, h);
  cache.key = key; cache.ms = performance.now() - t0; cache.p97 = p97; cache.stat = { cells, columns: cols.length, rows: H, p97: Math.round(p97) };
  return Object.assign({ ms: Math.round(cache.ms * 10) / 10 }, cache.stat);
}
