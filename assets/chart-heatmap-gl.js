// TradeZoro — Charts: order book heatmap on the graphics card (WebGL2). ES module. Owner order 2026-11-03.
// A drop-in twin of drawBookmap(g, view) in chart-bookmap.js (same `view`, same STYLES / colour ramp, same picture).
//   const r = gl.draw(g, view)   -> a result object, or null when the GPU path cannot run (the caller then calls drawBookmap)
// Data lives on the GPU: the book history is an R32F texture (one texture column per book sample, one row per price row, a RING:
// a new sample = ONE texSubImage2D column, old slots are overwritten), the colour ramp is a 256x1 texture, the normalisation and
// the pan / zoom are uniforms and per-column x spans (a few floats per visible column). Nothing is re-uploaded on pan / zoom.
// The p97 normalisation runs in a Web Worker (debounced); the first frame computes it once on the main thread.
// The GL canvas sits right before the chart's 2D layer canvas, so it is part of the same 'below-data' layer (no copy, no drawImage).
import * as BM from './chart-bookmap.js?v=797';

export const RING_COLS = 8192;
export const ringSlot = (seq, cap = RING_COLS) => ((seq % cap) + cap) % cap;
// contiguous texture runs for `count` sequence numbers starting at `seq`: [[slot, length], ...] (at most two: the ring wraps once)
export function ringRuns(seq, count, cap = RING_COLS) {
  const out = []; let s = ringSlot(seq, cap), left = Math.min(count, cap);
  while (left > 0) { const n = Math.min(left, cap - s); out.push([s, n]); left -= n; s = 0; }
  return out;
}
// 256x1 RGBA8 bytes of a ramp (R, G, B, A per entry) from the packed ABGR table chart-bookmap.js builds
export const rampBytes = (name) => (BM.lutOf ? new Uint8Array(BM.lutOf(name).buffer.slice(0)) : null);

// p97 (S.cap) of |size| over the visible columns, each weighted by its pixel width. Pure; the Worker runs the same source.
export function p97Of(cols, cap) {
  const BINS = 400, LMAX = 16, hist = new Float64Array(BINS); let total = 0;
  for (const c of cols) { const wt = c.wt, v = c.v; for (let k = 0; k < v.length; k++) { const a = v[k] < 0 ? -v[k] : v[k]; if (a > 0) { const b = Math.min(BINS - 1, (Math.log(a + 1) / LMAX * BINS) | 0); hist[b] += wt; total += wt; } } }
  if (!total) return 1;
  let acc = 0; const want = total * cap;
  for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc >= want) return Math.exp((b + 1) / BINS * LMAX) - 1; }
  return 1;
}
const WORKER_SRC = 'const P=' + p97Of.toString() + ';const M=new Map();onmessage=(e)=>{const m=e.data;' +
  'if(m.t==="add"){M.set(m.id,m.v);return;}' +
  'for(const k of M.keys()){if(k<m.min)M.delete(k);else break;}' +
  'const cols=[];for(const x of m.ids){const v=M.get(x[0]);if(v)cols.push({v,wt:x[1]});}' +
  'postMessage({req:m.req,p97:P(cols,m.cap)});};';

const VS = `#version 300 es
in vec4 iSpan; in vec2 iRow;           // xa, xb (device px), ring slot, rows | i0, step
uniform vec2 uCanvas; uniform vec2 uY;  // canvas size, heat area y0..y1 (device px)
flat out vec4 vSpan; flat out vec2 vRow;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = vec2(mix(iSpan.x, iSpan.y, c.x), mix(uY.x, uY.y, c.y));
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
  vSpan = iSpan; vRow = iRow;
}`;
const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
flat in vec4 vSpan; flat in vec2 vRow;
uniform sampler2D uBook; uniform sampler2D uRamp;
uniform float uH, uTy0, uTop, uDpr, uP0, uDp, uInvDen, uGam, uFloor;
out vec4 o;
void main() {
  float row = floor(uH - gl_FragCoord.y) - uTy0;                  // device pixel row inside the heat area
  float price = uP0 + (uTop + (row + 0.5) / uDpr) * uDp;          // price at the pixel centre (priceOfY is linear)
  int k = int(floor(price / vRow.y + 1e-9)) - int(vRow.x);
  if (k < 0 || k >= int(vSpan.w)) discard;
  float a = abs(texelFetch(uBook, ivec2(int(vSpan.z), k), 0).r);
  if (a <= 0.0) discard;
  float t = log(1.0 + a) * uInvDen; t = t > 1.0 ? 1.0 : pow(t, uGam);
  t = uFloor + (1.0 - uFloor) * t;
  o = vec4(texelFetch(uRamp, ivec2(int(floor(min(1.0, t) * 255.0 + 0.5)), 0), 0).rgb, 1.0);
}`;

let probe = null;
// true when a WebGL2 context can be made, chart-bookmap.js exports the ramp, and ?hm2d=1 (debug: old 2D path) is not set
export function heatmapGLOk() {
  if (probe === null) {
    probe = false;
    try {
      if (!BM.lutOf || /[?&]hm2d=1/.test(location.search)) return probe;
      const c = document.createElement('canvas'), x = c.getContext('webgl2');
      probe = !!x; if (x) { const e = x.getExtension('WEBGL_lose_context'); e && e.loseContext(); }
    } catch (e) { probe = false; }
  }
  return probe;
}

export function createHeatmapGL(host) {   // host = the chart layer's 2D canvas; the GL canvas is inserted right before it
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true'); cv.dataset.stkHeatmapGl = '1';
  let gl = null, prog = null, tex = null, rampTex = null, vbo = null, vao = null, loc = null, texH = 0, maxTex = 0;
  let seq = 0, owner = new Map(), slotV = new Array(RING_COLS), rampName = '', lost = false, dead = false;
  let worker = null, p97 = 0, p97Style = '', req = 0, timer = 0, wantKey = '', sentKey = '', inst = new Float32Array(6 * 256);
  const stats = { uploads: 0, uploadedCols: 0, texH: 0, p97Msgs: 0 };

  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  function init() {
    gl = cv.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    loc = {}; for (const n of ['uCanvas', 'uY', 'uBook', 'uRamp', 'uH', 'uTy0', 'uTop', 'uDpr', 'uP0', 'uDp', 'uInvDen', 'uGam', 'uFloor']) loc[n] = gl.getUniformLocation(prog, n);
    vao = gl.createVertexArray(); gl.bindVertexArray(vao); vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (const [n, size, off] of [['iSpan', 4, 0], ['iRow', 2, 16]]) { const a = gl.getAttribLocation(prog, n); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, 24, off); gl.vertexAttribDivisor(a, 1); }
    rampTex = gl.createTexture(); tex = null; texH = 0; rampName = '';
    owner = new Map(); slotV = new Array(RING_COLS); seq = 0; sentKey = ''; if (worker) { worker.terminate(); worker = null; }
  }
  function growTo(rows) {   // (re)allocate the book texture: RING_COLS x rows, R32F. Everything is re-uploaded afterwards.
    let h = Math.max(128, texH || 128); while (h < rows) h *= 2; h = Math.min(h, maxTex);
    if (tex) gl.deleteTexture(tex);
    tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, Math.min(RING_COLS, maxTex), h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    texH = stats.texH = h; owner = new Map(); slotV = new Array(RING_COLS); seq = 0; sentKey = '';
    if (worker) { worker.terminate(); worker = null; }
  }
  function setRamp(name) {
    const b = rampBytes(name); if (!b) throw new Error('no ramp');
    gl.bindTexture(gl.TEXTURE_2D, rampTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    rampName = name;
  }
  function getWorker() {
    if (worker || worker === false) return worker;
    try { worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))); worker.onmessage = (e) => { if (e.data.req === req) { p97 = e.data.p97; stats.p97Msgs++; } }; worker.onerror = () => { worker = false; }; }
    catch (e) { worker = false; }
    return worker;
  }
  // upload every sample of `list` the ring does not hold yet; one texSubImage2D per contiguous run of new columns
  function upload(list, gl2) {
    const need = list.filter((s) => owner.get(s.v) === undefined || slotV[owner.get(s.v)] !== s.v);
    if (!need.length) return;
    let rows = 0; for (const s of need) rows = Math.max(rows, s.v.length);
    if (rows > texH) { growTo(rows); return upload(list, gl2); }
    // newest RING_COLS only (more than the ring holds on screen is thinned history nobody can see)
    const take = need.slice(-RING_COLS), w = RING_COLS;
    const ids = []; let at = 0;
    for (const [slot, n] of ringRuns(seq, take.length)) {
      const buf = new Float32Array(n * texH);   // column-major in the staging block: texel (x, y) = buf[y * n + x]
      for (let j = 0; j < n; j++) { const s = take[at + j], v = s.v, m = Math.min(v.length, texH); for (let k = 0; k < m; k++) buf[k * n + j] = v[k] < 0 ? -v[k] : v[k]; }
      gl2.bindTexture(gl2.TEXTURE_2D, tex); gl2.pixelStorei(gl2.UNPACK_ALIGNMENT, 4);
      gl2.texSubImage2D(gl2.TEXTURE_2D, 0, slot, 0, n, texH, gl2.RED, gl2.FLOAT, buf);
      stats.uploads++;
      for (let j = 0; j < n; j++) { const s = take[at + j], old = slotV[slot + j]; if (old) owner.delete(old); slotV[slot + j] = s.v; owner.set(s.v, slot + j); ids.push([seq + at + j, s.v]); }
      at += n;
    }
    stats.uploadedCols += take.length;
    const wk = getWorker();
    for (const [id, v] of ids) { sid.set(v, id); if (wk) wk.postMessage({ t: 'add', id, v: Float32Array.from(v) }); }
    seq += take.length; void w;
  }
  const sid = new WeakMap();   // v -> its sequence id (the Worker's key)

  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  cv.addEventListener('webglcontextrestored', () => { try { init(); lost = false; } catch (err) { dead = true; } });
  try { init(); } catch (e) { dead = true; }

  function draw(g, view) {
    if (dead || lost || !gl || gl.isContextLost()) { cv.style.display = 'none'; return null; }
    const S = BM.STYLES[view.look] || BM.STYLES.bookmap;
    if (S.anchors || !(S.floor >= 0) || !S.pow) { cv.style.display = 'none'; return null; }   // a newer style table (rank colouring): the 2D path until this twin learns it
    const t0 = performance.now();
    const par = host.parentElement; if (!par) return null;
    const dpr = Math.min(view.dpr || 1, 2), cssW = parseFloat(host.style.width) || host.width / (view.dpr || 1), cssH = parseFloat(host.style.height) || host.height / (view.dpr || 1);
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    cv.style.cssText = host.style.cssText + ';pointer-events:none;display:block'; if (!host.style.cssText) { cv.style.position = 'absolute'; cv.style.left = host.offsetLeft + 'px'; cv.style.top = host.offsetTop + 'px'; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; }
    if (host.previousSibling !== cv) par.insertBefore(cv, host);
    const x0 = Math.floor(view.x0), x1 = Math.ceil(view.x1), top = Math.floor(view.top), bot = Math.ceil(view.bot), w = Math.max(0, x1 - x0), h = Math.max(0, bot - top);
    const ty0 = Math.round(top * dpr), ty1 = Math.min(H, Math.round(bot * dpr)), tx0 = Math.round(x0 * dpr);
    const fullX1 = Math.min(W, Math.round((x0 + w + (view.fullW ? view.fullW - x1 : 0)) * dpr));
    gl.viewport(0, 0, W, H); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!w || !h) return { cells: 0, columns: 0, ms: 0, rows: 0, gl: true };
    // the visible samples and their pixel spans (the same carry-forward rule as drawBookmap)
    const hs = view.hist, cols = [];
    for (let k = 0; k < hs.length; k++) {
      const s = hs[k]; if (!s.v || !s.v.length || !(s.step > 0)) continue;
      const next = k + 1 < hs.length ? hs[k + 1] : null;
      let end = next ? Math.min(next.ts, s.ts + S.hold) : view.now + 1;
      if (!next && view.now - s.ts > S.hold) end = s.ts + S.hold;
      let xa = view.tsToX(s.ts), xb = next && next.ts <= s.ts + S.hold ? view.tsToX(next.ts) : view.tsToX(end);
      if (!next && view.now - s.ts <= S.hold) xb = x1;
      if (!(xb > xa) || xb < x0 || xa > x1) continue;
      cols.push({ s, xa: Math.max(x0, Math.floor(xa)), xb: Math.min(x1, Math.ceil(xb)) });
    }
    upload(cols.map((c) => c.s), gl);
    if (rampName !== S.ramp) setRamp(S.ramp);
    // normalisation: first time on this thread, then the Worker, debounced on the visible set
    const wl = cols.map((c) => ({ v: c.s.v, wt: Math.max(1, c.xb - c.xa) }));
    if (!p97 || p97Style !== view.look) { p97 = p97Of(wl, S.cap); p97Style = view.look; sentKey = ''; }
    wantKey = cols.length + ':' + (cols.length ? sid.get(cols[0].s.v) + ':' + sid.get(cols[cols.length - 1].s.v) : '') + ':' + Math.round(cols.reduce((a, c) => a + c.xb - c.xa, 0));
    if (wantKey !== sentKey) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sentKey = wantKey; const ids = cols.map((c) => [sid.get(c.s.v), Math.max(1, c.xb - c.xa)]), wk = getWorker(); req++;
        if (wk) wk.postMessage({ t: 'q', req, ids, cap: S.cap, min: seq - RING_COLS });
        else if (!dead) p97 = p97Of(wl, S.cap);   // no Worker (CSP / old browser): one cheap histogram pass, still debounced
      }, 150);
    }
    // instances
    if (inst.length < cols.length * 6) inst = new Float32Array(cols.length * 6 * 2);
    let nI = 0, cells = 0;
    for (const c of cols) {
      const xa = Math.max(0, Math.round((c.xa - x0) * dpr) + tx0), xb = Math.min(fullX1, Math.round((c.xb - x0) * dpr) + tx0);
      const sl = owner.get(c.s.v); if (xb <= xa || sl === undefined) continue;
      const o = nI++ * 6, s = c.s; inst[o] = xa; inst[o + 1] = xb; inst[o + 2] = sl; inst[o + 3] = Math.min(s.v.length, texH); inst[o + 4] = s.i0; inst[o + 5] = s.step; cells += s.v.length;
    }
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, nI * 6), gl.STREAM_DRAW);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rampTex);
    gl.uniform1i(loc.uBook, 0); gl.uniform1i(loc.uRamp, 1);
    // the field: opaque bg over the whole heat area (also under the depth-bar strip to the right, like fullW in 2D)
    gl.scissor(tx0, H - ty1, Math.max(0, fullX1 - tx0), Math.max(0, ty1 - ty0)); gl.clearColor(S.bg[0] / 255, S.bg[1] / 255, S.bg[2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    // price is linear in y: price(y) = p0 + y * dp
    const pa = view.priceOfY(0), dp = view.priceOfY(1) - pa;
    gl.uniform2f(loc.uCanvas, W, H); gl.uniform2f(loc.uY, ty0, ty1); gl.uniform1f(loc.uH, H); gl.uniform1f(loc.uTy0, ty0); gl.uniform1f(loc.uTop, top);
    gl.uniform1f(loc.uDpr, dpr); gl.uniform1f(loc.uP0, pa); gl.uniform1f(loc.uDp, dp);
    gl.uniform1f(loc.uInvDen, 1 / Math.log1p(p97 * 2.5)); gl.uniform1f(loc.uGam, S.pow / Math.max(0.3, view.gamma || 1)); gl.uniform1f(loc.uFloor, S.floor);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nI);
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    return { cells, columns: nI, ms, rows: ty1 - ty0, p97: Math.round(p97), gl: true, uploads: stats.uploads };
  }
  function destroy() {
    dead = true; clearTimeout(timer);
    if (worker) { worker.terminate(); worker = null; }
    try { if (gl && !gl.isContextLost()) { tex && gl.deleteTexture(tex); rampTex && gl.deleteTexture(rampTex); vbo && gl.deleteBuffer(vbo); prog && gl.deleteProgram(prog); const e = gl.getExtension('WEBGL_lose_context'); e && e.loseContext(); } } catch (e) {}
    owner = new Map(); slotV = []; cv.remove(); gl = null;
  }
  return { draw, destroy, canvas: cv, stats };
}
