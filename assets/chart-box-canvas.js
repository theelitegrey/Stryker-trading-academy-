// TradeZoro — Charts: BOX CANVASES (RAM round 2, member GK 11 Nov: "one chart tab ~4 GB").
// Imported by assets/vela-chart.js. No DOM work at import.
//
// Every order-flow layer (Big Trades, L2 profile, ladder, Session VP, ...) and the volume overlay draw
// on a canvas the size of the whole plot, but they ink a small part of it (measured on a 2-chart
// 1m layout: Big Trades 2-5 %, L2 VP 1 %, ladder 11 %, volume 12 % of the plot). An on-screen canvas
// costs about 4x its bitmap (renderer bitmap + GPU image + compositor copy), ~30-75 MB each at a
// 1350x1463 plot, whatever it holds.
//
// boxCanvas(canvas) keeps the code that draws exactly as it was: its 2d context now draws on a
// full-size OFF-SCREEN copy (CPU memory only, ~8 MB, and freed while blank). Every draw call's
// device-pixel bounds are tracked (path points, rects, text metrics, image rects, line width and
// shadow margins). After a render the on-screen canvas is resized to that box (snapped so it starts
// and ends on whole device AND layout pixels: same sampling, nothing is scaled) and the box is copied
// in 1:1 and placed with CSS left/top. So the picture on screen is pixel for pixel the same, from a
// canvas that is only as large as what it shows. Fallback to the full canvas when the box is large
// (> 60 %), a call's extent can't be bounded (Path2D, filter), or the pixel ratio can't be snapped.
//
// For everything else the canvas still looks full size: width/height read (and set) the full size,
// getContext('2d').getImageData reads the full picture, getBoundingClientRect is the plot's rect, and
// canvas.__stkBoxSrc is the full-size copy (the chart screenshot export draws that one).
// Self-check: node tools/tests/chart-box-canvas.test.mjs

const RP = typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null;
const HC = typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype : null;
const WD = HC && Object.getOwnPropertyDescriptor(HC, 'width'), HD = HC && Object.getOwnPropertyDescriptor(HC, 'height');
const MAX_FRAC = 0.6;   // a box bigger than this share of the plot saves little: use the full canvas

// [x0, y0, x1, y1] union; null = empty
export const union = (a, b) => !a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
// device-px bounds of points (x, y pairs) under matrix m, grown by margin g
export function boundsOf(m, pts, g = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = m.a * pts[i] + m.c * pts[i + 1] + m.e, y = m.b * pts[i] + m.d * pts[i + 1] + m.f;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 <= x1 ? [x0 - g, y0 - g, x1 + g, y1 + g] : null;
}
const rectPts = (x, y, w, h) => [x, y, x + w, y, x, y + h, x + w, y + h];
const scaleOf = (m) => Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
// a device-px start that is also a whole layout unit (1/64 CSS px): k = device px per CSS px. Searches
// downward from v (start) or upward (end) a few px; NaN when none (then the full canvas is used).
export function snap(v, k, up) {
  for (let i = 0; i < 16; i++) {
    const d = up ? v + i : v - i, c = d / k * 64;
    if (Math.abs(c - Math.round(c)) < 1e-6) return d;
  }
  return NaN;
}
// The box to show: whole device px, inside [0, W] x [0, H], snapped; null = nothing to show; 'full' = whole canvas
export function showBox(acc, W, H, k) {
  if (!acc || !W || !H) return null;
  let x0 = Math.max(0, Math.floor(acc[0])), y0 = Math.max(0, Math.floor(acc[1])), x1 = Math.min(W, Math.ceil(acc[2])), y1 = Math.min(H, Math.ceil(acc[3]));
  if (x1 <= x0 || y1 <= y0) return null;
  if ((x1 - x0) * (y1 - y0) > MAX_FRAC * W * H || !(k > 0)) return 'full';
  x0 = snap(x0, k, false); y0 = snap(y0, k, false); x1 = snap(x1, k, true); y1 = snap(y1, k, true);
  if (!(x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H)) return 'full';
  return [x0, y0, x1, y1];
}

export function boxCanvas(C) {
  if (!RP || !WD || !C || C.__stkBox) return C && C.__stkBox || null;
  const X = C.getContext('2d');
  if (!X) return null;
  let vw = WD.get.call(C), vh = HD.get.call(C);
  const S = document.createElement('canvas');
  WD.set.call(S, vw); HD.set.call(S, vh);
  const Y = S.getContext('2d', { willReadFrequently: true });   // software bitmap: no GPU copy of the off-screen picture
  if (!Y) return null;
  let acc = null, path = null, clips = [false], full = false;
  let inRender = 0, queued = false, mineW = '', cssW = 0;
  let Tm = null;   // cached current transform (getTransform allocates); dropped by every call that can change it
  const T = () => Tm || (Tm = RP.getTransform.call(Y));
  const add = (b) => { if (b) acc = union(acc, b); };
  const extra = () => {   // margin for shadows (not transformed); a filter can reach anywhere
    if (RP && Object.getOwnPropertyDescriptor(RP, 'filter') && Y.filter && Y.filter !== 'none') { full = true; return 0; }
    const sb = Y.shadowBlur || 0, ox = Y.shadowOffsetX || 0, oy = Y.shadowOffsetY || 0;
    return sb || ox || oy ? sb * 2 + Math.abs(ox) + Math.abs(oy) : 0;
  };
  const strokeG = (m) => (Y.lineWidth || 1) * scaleOf(m) * Math.max(Y.miterLimit || 10, 1) / 2;
  const touch = () => { if (!inRender && !queued) { queued = true; queueMicrotask(() => { queued = false; blit(); }); } };
  const resetAll = () => { acc = null; path = null; clips = [false]; full = false; };

  // forwarders: every method / property of the real 2d context, applied to the off-screen copy
  const fwd = {};
  for (const k of Object.getOwnPropertyNames(RP)) {
    if (k === 'constructor') continue;
    const d = Object.getOwnPropertyDescriptor(RP, k);
    if (typeof d.value === 'function') fwd[k] = function () { return d.value.apply(Y, arguments); };
    else if (d.get) Object.defineProperty(fwd, k, { configurable: true, enumerable: true, get: () => (k === 'canvas' ? C : d.get.call(Y)), set: d.set ? (v) => d.set.call(Y, v) : undefined });
  }
  const P = (k, fn) => { const f = RP[k]; if (typeof f === 'function') fwd[k] = function () { fn.apply(null, arguments); return f.apply(Y, arguments); }; };
  const pathAdd = (pts, g = 0) => { path = union(path, boundsOf(T(), pts, g)); };
  P('beginPath', () => { path = null; });
  P('moveTo', (x, y) => pathAdd([x, y]));
  P('lineTo', (x, y) => pathAdd([x, y]));
  P('rect', (x, y, w, h) => pathAdd(rectPts(x, y, w, h)));
  P('roundRect', (x, y, w, h) => pathAdd(rectPts(x, y, w, h)));
  P('arc', (x, y, r) => pathAdd(rectPts(x - r, y - r, 2 * r, 2 * r)));
  P('ellipse', (x, y, rx, ry) => { const r = Math.max(rx, ry); pathAdd(rectPts(x - r, y - r, 2 * r, 2 * r)); });
  P('arcTo', (x1, y1, x2, y2) => pathAdd([x1, y1, x2, y2]));
  P('quadraticCurveTo', (cx, cy, x, y) => pathAdd([cx, cy, x, y]));
  P('bezierCurveTo', (a, b, c, d, x, y) => pathAdd([a, b, c, d, x, y]));
  P('fill', (p) => { if (p && typeof p === 'object') full = true; else add(path && [path[0] - 2 - extra(), path[1] - 2 - extra(), path[2] + 2 + extra(), path[3] + 2 + extra()]); touch(); });
  P('stroke', (p) => { if (p && typeof p === 'object') full = true; else { const g = strokeG(T()) + 2 + extra(); add(path && [path[0] - g, path[1] - g, path[2] + g, path[3] + g]); } touch(); });
  P('fillRect', (x, y, w, h) => { add(boundsOf(T(), rectPts(x, y, w, h), 2 + extra())); touch(); });
  P('strokeRect', (x, y, w, h) => { const m = T(); add(boundsOf(m, rectPts(x, y, w, h), strokeG(m) + 2 + extra())); touch(); });
  const text = (stroke) => (t, x, y) => {
    const mt = RP.measureText.call(Y, String(t)), m = T();
    const l = x - (mt.actualBoundingBoxLeft || 0), r = x + (mt.actualBoundingBoxRight || mt.width || 0);
    const top = y - (mt.actualBoundingBoxAscent || 0), bot = y + (mt.actualBoundingBoxDescent || 0);
    add(boundsOf(m, [l, top, r, top, l, bot, r, bot], (stroke ? strokeG(m) : 0) + 3 + extra())); touch();
  };
  P('fillText', text(false));
  P('strokeText', text(true));
  P('drawImage', function (img) {
    const a = arguments, n = a.length;
    const dx = n >= 9 ? a[5] : a[1], dy = n >= 9 ? a[6] : a[2];
    const dw = n >= 9 ? a[7] : n >= 5 ? a[3] : (img.width || img.naturalWidth || img.videoWidth || img.displayWidth || 0);
    const dh = n >= 9 ? a[8] : n >= 5 ? a[4] : (img.height || img.naturalHeight || img.videoHeight || img.displayHeight || 0);
    add(boundsOf(T(), rectPts(dx, dy, dw, dh), 2 + extra())); touch();
  });
  P('putImageData', (img, dx, dy) => { add([dx, dy, dx + img.width, dy + img.height]); touch(); });
  for (const k of ['setTransform', 'resetTransform', 'transform', 'translate', 'scale', 'rotate']) P(k, () => { Tm = null; });
  P('save', () => { clips.push(clips[clips.length - 1]); });
  P('restore', () => { Tm = null; if (clips.length > 1) clips.pop(); });
  P('clip', (p) => { clips[clips.length - 1] = true; });
  P('reset', () => { Tm = null; resetAll(); touch(); });
  P('clearRect', (x, y, w, h) => {
    // a clear with no clip that covers everything drawn so far empties the box (a clip could limit it)
    const m = T();
    if (!clips[clips.length - 1] && m.b === 0 && m.c === 0 && acc) {
      const b = boundsOf(m, rectPts(x, y, w, h));
      if (b && b[0] <= acc[0] && b[1] <= acc[1] && b[2] >= acc[2] && b[3] >= acc[3]) { acc = null; full = false; }
    }
    touch();
  });
  Object.setPrototypeOf(X, fwd);

  // the element keeps reporting (and taking) the full size; its real bitmap is the box
  const setW = (v) => { Tm = null; vw = Math.max(0, Math.floor(+v) || 0); WD.set.call(S, vw); resetAll(); touch(); };
  const setH = (v) => { Tm = null; vh = Math.max(0, Math.floor(+v) || 0); HD.set.call(S, vh); resetAll(); touch(); };
  Object.defineProperty(C, 'width', { configurable: true, get: () => vw, set: setW });
  Object.defineProperty(C, 'height', { configurable: true, get: () => vh, set: setH });
  C.getBoundingClientRect = function () { const p = C.parentElement; return p ? p.getBoundingClientRect() : Element.prototype.getBoundingClientRect.call(C); };
  WD.set.call(C, 0); HD.set.call(C, 0);   // nothing drawn on the copy yet

  let shown = null;   // [x0, y0, x1, y1] on screen now
  function blit() {
    // full-size CSS width the engine gave the canvas (it writes it before each render); ours are box widths
    const sw = C.style.width;
    if (sw && sw !== mineW && /px$/.test(sw)) cssW = parseFloat(sw);
    if (!(cssW > 0)) { const p = C.parentElement; cssW = p ? p.getBoundingClientRect().width : 0; }
    const k = cssW > 0 ? vw / cssW : 0;
    let b = full ? 'full' : showBox(acc, vw, vh, k);
    if (b === 'full') b = [0, 0, vw, vh];
    if (!b || !vw || !vh) {
      if (WD.get.call(C)) { WD.set.call(C, 0); HD.set.call(C, 0); }
      shown = null; return;
    }
    const bw = b[2] - b[0], bh = b[3] - b[1];
    if (WD.get.call(C) !== bw || HD.get.call(C) !== bh) { WD.set.call(C, bw); HD.set.call(C, bh); }
    else RP.clearRect.call(X, 0, 0, bw, bh);
    RP.drawImage.call(X, S, b[0], b[1], bw, bh, 0, 0, bw, bh);
    const kk = k > 0 ? k : 1;
    const st = C.style;
    st.left = b[0] / kk + 'px'; st.top = b[1] / kk + 'px'; st.right = 'auto'; st.bottom = 'auto';
    mineW = bw / kk + 'px'; st.width = mineW; st.height = bh / kk + 'px';
    shown = b;
  }
  const ctl = {
    src: S,
    run(fn, self, args) { inRender++; try { return fn.apply(self, args); } finally { if (--inRender === 0) blit(); } },
    blit,
    state: () => ({ shown, acc, full, w: vw, h: vh, real: [WD.get.call(C), HD.get.call(C)] }),
  };
  C.__stkBox = ctl; C.__stkBoxSrc = S;
  return ctl;
}
