// TradeZoro — Charts: Depth Heatmap (L2). ES module. Owner order 2026-11-07 ("create a new heatmap indicator").
// Depends on: chart-orderflow.js (installDepthHeatmap(Core, H, reg) from installOrderflow; H = its book feed / trade helpers),
// chart-bookmap.js (the 'depth' style: ramp + rank anchors), chart-heatmap-gl.js (graphics-card path), chart-futures-l2.js (L2 hub,
// gate), chart-liquidity-map.js (sphere + order-book ladder drawing). Pro, like the other L2 tools.
//
// One picture on its own dark field (also in the light theme), drawn above the candles:
//   - resting liquidity: deep navy -> blue -> light blue for the thin book (a soft visible texture) -> white -> yellow -> orange -> red
//     for the biggest resting orders, coloured by RANK among the visible book (auto contrast: most of the book blue, a few walls red);
//   - CONTINUITY: each price row is (1) averaged over the trailing Smooth window (only past samples: no lookahead in replay) and
//     (2) held at its last drawn size until it changes by more than HOLD_TOL or is removed (draw-until-changed), so a wall that rests
//     is one solid bar even when the provider re-quotes sizes every few seconds;
//   - traded volume as shaded spheres on the price path, split green (buy) / red (sell) by the aggressor share, plus a thin price trace;
//   - right side: the current book per price row (red asks above, green bids below, sizes) and an optional cumulative column;
//   - bottom: buy / sell volume bars per bar; a last-price line and the best bid / ask sizes at the right edge.
// Display only. It describes resting orders and prints; it predicts nothing. Education only. Not financial advice.
import { drawBookmap, STYLES, SMOOTH_OPTS } from './chart-bookmap.js?v=912';
import { createHeatmapGL, heatmapGLOk } from './chart-heatmap-gl.js?v=912';
import { l2Root, l2Source, l2Badge, rootState, L2_TYPES, l2Closed, closedNote } from './chart-futures-l2.js?v=912';
import { sphere, drawLadder } from './chart-liquidity-map.js?v=912';
import { getVenue } from './orderflow-venues.js?v=912';

export const DH_TYPE = 'stk_depth_heat';
export const DH_TITLE = 'Depth Heatmap (L2)';
export { SMOOTH_OPTS };   // the same Smooth choices as the main heatmap (chart-bookmap.js); here the default is 30 s and the window feeds draw-until-changed
export const HOLD_TOL = 0.3;   // a held row is redrawn only when its (smoothed) size moves by more than 30 %, flips side or is gone
export const DH_SCHEMA = [
  { key: 'heatSmooth', title: 'Smooth', type: 'string', defval: '30 s', options: SMOOTH_OPTS.map((x) => x[0]),
    tooltip: 'Averages each price level over the last N seconds (past only), so a choppy book reads as calm bands. Sizes in the heatmap are averages.' },
  { key: 'contrastMode', title: 'Contrast', type: 'string', defval: 'Auto', options: ['Auto', 'Manual'],
    tooltip: 'Auto: colours follow the sizes in view, so most of the book is blue and only the biggest walls turn yellow, orange and red.' },
  { key: 'contrast', title: 'Manual contrast', type: 'float', defval: 1, min: 0.5, max: 2.5, step: 0.1, when: { key: 'contrastMode', anyOf: ['Manual'] },
    tooltip: 'Higher = more of the book lights up. Lower = only the biggest walls stand out.' },
  { key: 'cutoffPct', title: 'Lower cutoff (hide below %)', type: 'int', defval: 0, min: 0, max: 95, step: 5,
    tooltip: 'Hide the thinnest levels: the smallest N % of the sizes in view. 0 shows everything.' },
  { key: 'showBubbles', title: 'Volume bubbles', type: 'bool', defval: true,
    tooltip: 'Each ball is the volume traded in a short time. Size = volume. Green part = aggressive buying, red part = aggressive selling.' },
  { key: 'bubbleScale', title: 'Bubble size %', type: 'int', defval: 100, min: 40, max: 200, step: 10 },
  { key: 'showBook', title: 'Book bars (right side)', type: 'bool', defval: true, tooltip: 'The size resting at each price now: red above the price (asks), green below (bids).' },
  { key: 'showCum', title: 'Cumulative column', type: 'bool', defval: true, tooltip: 'The running total of resting size from the best price outward.' },
  { key: 'showVolume', title: 'Volume bars', type: 'bool', defval: true, tooltip: 'Traded volume per bar along the bottom, green = buying, red = selling.' },
  { key: 'gpuHeatmap', title: 'Graphics card (smoother)', type: 'bool', defval: true }
];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const smoothMsOf = (label) => { const o = SMOOTH_OPTS.find((x) => x[0] === label); return o ? o[1] : 30000; };   // missing (older saved chart) = the default
// rank -> ramp position with the style's anchors (the same curve the renderer colours with)
function rankT(r) { const A = STYLES.depth.anchors; if (r <= A[0][0]) return A[0][1]; for (let k = 1; k < A.length; k++) if (r <= A[k][0]) return A[k - 1][1] + (A[k][1] - A[k - 1][1]) * (r - A[k - 1][0]) / (A[k][0] - A[k - 1][0]); return 1; }
export function dhConfig(i) {
  i = i || {};
  const cut = clamp(Math.round(num(i.cutoffPct, 0)), 0, 95), p = cut > 0 ? rankT(cut / 100) : 0;
  return {
    smooth: smoothMsOf(i.heatSmooth), gamma: i.contrastMode === 'Manual' ? clamp(num(i.contrast, 1), 0.5, 2.5) : 1,
    hf: { p, min: 0, max: 0, top: 0, on: p > 0, key: p > 0 ? String(p) : '' }, cut,
    bubbles: i.showBubbles !== false, bubbleScale: clamp(num(i.bubbleScale, 100), 40, 200) / 100,
    book: i.showBook !== false, cum: i.showCum !== false, volume: i.showVolume !== false, gpu: i.gpuHeatmap !== false
  };
}

// ---------------------------------------------------------------------------------------- smoothing + draw-until-changed
// hist (sorted by ts, signed rows: bid +, ask -) -> new sample objects with v = the held trailing average. Causal: sample k only reads
// samples with ts in (ts_k - ms, ts_k] and the outputs before it. st is per-feed state: a live frame that only appended samples
// processes the new ones; any other change (older history arrived, thinning) re-runs the pass but keeps the old output OBJECT when a
// sample's result is unchanged, so the graphics-card ring does not re-upload it.
function rowsBuf() {   // a growable signed row array addressed by absolute row index
  let base = 0, a = null;
  return {
    fit(lo, hi) { if (a && lo >= base && hi <= base + a.length) return; const nb = (a ? Math.min(base, lo) : lo) - 64, ne = (a ? Math.max(base + a.length, hi) : hi) + 64, b = new Float64Array(ne - nb); if (a) b.set(a, base - nb); a = b; base = nb; },
    get: (r) => (a && r >= base && r < base + a.length ? a[r - base] : 0),
    add(r, x) { a[r - base] += x; },
    set(r, x) { a[r - base] = x; }
  };
}
function freshState(st, ms, tol) { Object.assign(st, { ms, tol, inp: [], out: [], q: [], qh: 0, sum: null, sgn: null, held: null, step: 0 }); }
export function dhProcess(hist, ms, tol, st) {
  st = st || {};
  if (st.ms !== ms || st.tol !== tol || !st.memo) { st.memo = new WeakMap(); freshState(st, ms, tol); }
  // the same samples, maybe fewer at the front (the view moved right) and new ones at the end: keep the outputs, process the new ones
  const j = hist.length ? st.inp.indexOf(hist[0]) : -1, n0 = st.inp.length - Math.max(0, j);
  const append = j >= 0 && hist.length >= n0 && hist[n0 - 1] === st.inp[st.inp.length - 1];
  if (!append) freshState(st, ms, tol);
  const out = append ? st.out.slice(j) : [];
  for (let k = append ? n0 : 0; k < hist.length; k++) out.push(step1(hist[k], st));
  st.inp = hist.slice(); st.out = out;
  return out;
}
function step1(s, st) {
  if (!s || !s.v || !s.v.length || !(s.step > 0)) return s;
  if (s.step !== st.step) { st.step = s.step; st.q = []; st.qh = 0; st.sum = rowsBuf(); st.sgn = rowsBuf(); st.held = rowsBuf(); }
  const acc = (h, sign) => { const v = h.v; st.sum.fit(h.i0, h.i0 + v.length); st.sgn.fit(h.i0, h.i0 + v.length); for (let r = 0; r < v.length; r++) { const x = v[r]; if (!x) continue; st.sum.add(h.i0 + r, sign * Math.abs(x)); if (sign > 0) st.sgn.set(h.i0 + r, x < 0 ? -1 : 1); } };
  acc(s, 1); st.q.push(s);
  while (st.qh < st.q.length - 1 && !(st.q[st.qh].ts > s.ts - st.ms)) acc(st.q[st.qh++], -1);   // ms 0: the window is the sample itself
  if (st.qh > 256) { st.q = st.q.slice(st.qh); st.qh = 0; }
  // rows covered by the window
  let lo = Infinity, hi = -Infinity;
  for (let j = st.qh; j < st.q.length; j++) { const h = st.q[j]; if (h.i0 < lo) lo = h.i0; if (h.i0 + h.v.length > hi) hi = h.i0 + h.v.length; }
  const n = st.q.length - st.qh, v = new Float32Array(hi - lo);
  st.held.fit(lo, hi);
  for (let r = lo; r < hi; r++) {
    const m = st.sum.get(r), c = m > 1e-9 ? m / n * st.sgn.get(r) : 0, h = st.held.get(r);
    // draw-until-changed: keep the drawn size while the new one is within tol of it and on the same side
    const keep = c !== 0 && h !== 0 && (c > 0) === (h > 0) && Math.abs(c - h) <= st.tol * Math.abs(h);
    const x = keep ? h : c; st.held.set(r, x); v[r - lo] = x;
  }
  // old cells outside this window's rows are gone
  const old = st.memo.get(s);
  if (old && old.i0 === lo && old.v.length === v.length && old.v.every((x, k) => x === v[k])) return old;
  const z = { ts: s.ts, mid: s.mid, bb: s.bb, ba: s.ba, step: s.step, i0: lo, v, span: s.span };
  st.memo.set(s, z);
  return z;
}

// ---------------------------------------------------------------------------------------- trades
// [[t, price, size, side +1 buy / -1 sell], ...] sorted by t in [from, to]. Futures: the hub's tick ring (this page's live ticks), and
// before it the recorded 1-minute footprint (one buy and one sell print at the minute's middle). Crypto: the venue's trades by minute.
let lastTradeFeed = null;
export const dhDebugTrades = () => lastTradeFeed;   // test hook: the crypto trade feed the bubbles read
export function tradesIn(f, H, from, to) {
  const out = [];
  if (f.custom && f.custom.trades) {
    const tf = f.custom.trades(), ring = tf.ring || [], r0 = ring.length ? ring[0][0] : Infinity, tick = tf.tick || 0.25;
    for (const b of tf.bars()) {
      if (b.t + 60000 > r0 || b.t + 60000 < from || b.t > to) continue;
      let bv = 0, sv = 0, pv = 0;
      for (let j = 0; j < b.buy.length; j++) { const p = (b.lo + j) * tick; bv += b.buy[j]; sv += b.sell[j]; pv += p * (b.buy[j] + b.sell[j]); }
      const vw = bv + sv > 0 ? pv / (bv + sv) : 0, t = Math.min(to, b.t + 30000);
      if (bv > 0) out.push([t, vw, bv, 1]); if (sv > 0) out.push([t, vw, sv, -1]);
    }
    for (const x of ring) if (x[0] >= from && x[0] <= to) out.push([x[0], x[1], x[2], x[3] > 0 ? 1 : -1]);
    return out;
  }
  const tf = H.feedTrades(f);
  lastTradeFeed = tf;
  if (!tf || !tf.mins) return out;
  for (const [mt, m] of tf.mins) {
    if (mt + 60000 < from || mt > to) continue;
    for (const x of m.trades) if (x[4] >= from && x[4] <= to) out.push([x[4], x[1], x[2], x[3] ? 1 : -1]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}
const niceTime = (ms) => { for (const s of [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000]) if (s >= ms) return s; return 3600000; };
// one bubble per time interval tb: volume-weighted time and price, buy / sell split
export function bubblesOf(trades, tb) {
  const m = new Map();
  for (const [t, p, q, s] of trades) {
    const k = Math.floor(t / tb); let e = m.get(k);
    if (!e) { e = { t: 0, p: 0, b: 0, s: 0, w: 0 }; m.set(k, e); }
    e.t += t * q; e.p += p * q; e.w += q; if (s > 0) e.b += q; else e.s += q;
  }
  const out = []; m.forEach((e) => out.push({ t: e.t / e.w, p: e.p / e.w, b: e.b, s: e.s, v: e.w }));
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------------------- the layer
const replayNow = () => { try { const r = window.__stkReplay; return r && r.on ? r.now() : 0; } catch (e) { return 0; } };
let dhLast = null;
export const dhDebug = () => dhLast;
// the book at a moment: live = the feed's book (futures: the tick-exact snap near the price, the whole-book rows beyond it);
// replay = the last recorded sample at or before the replay clock
function bookAt(f, now, replay, hist) {
  if (replay) {
    let s = null; for (let k = hist.length - 1; k >= 0; k--) if (hist[k].ts <= now) { s = hist[k]; break; }
    if (!s) return null;
    const b = { bids: new Map(), asks: new Map(), bestBid: s.bb, bestAsk: s.ba };
    // a row's size sits at its centre; the rows holding the best bid / ask are keyed at those prices so the right-edge marker finds them
    const ib = s.bb > 0 ? Math.floor(s.bb / s.step + 1e-9) : NaN, ia = s.ba > 0 ? Math.floor(s.ba / s.step + 1e-9) : NaN;
    for (let k = 0; k < s.v.length; k++) { const x = s.v[k], i = s.i0 + k; if (!x) continue; const p = (i + 0.5) * s.step; if (x > 0) b.bids.set(i === ib ? s.bb : p, x); else b.asks.set(i === ia ? s.ba : p, -x); }
    return b;
  }
  const bk = f.book; if (!bk) return null;
  const root = f.custom ? f.ticker : null, snap = root ? rootState(root).snap : null;
  if (!snap || !snap.bids || !snap.asks || !snap.bids.length || !snap.asks.length) return bk;
  const loB = snap.bids[snap.bids.length - 1][0], hiA = snap.asks[snap.asks.length - 1][0];
  const b = { bids: new Map(), asks: new Map(), bestBid: snap.bids[0][0], bestAsk: snap.asks[0][0] };
  bk.bids.forEach((q, p) => { if (p < loB) b.bids.set(p, q); }); bk.asks.forEach((q, p) => { if (p > hiA) b.asks.set(p, q); });
  for (const [p, q] of snap.bids) b.bids.set(p, q); for (const [p, q] of snap.asks) b.asks.set(p, q);
  return b;
}
export function dhLayer(H) {
  let canvas = null, glr = null;
  const st = new Map();   // feed key -> dhProcess state
  let fitted = false;
  return {
    mount(c) { canvas = c; },
    destroy() { if (glr) glr.destroy(); glr = null; canvas = null; },
    render(a) {
      const co = a.coords, g = H.beginFrame(canvas, co);
      if (glr) glr.canvas.style.display = 'none';   // draw() shows it again
      if (!g || !a.data || a.data.off || !a.bars.length) return;
      const f = H.bookFeeds.get(a.data.feed);
      if (!f) return;
      const t0 = performance.now(), cfg = a.data.cfg, rp = replayNow(), now = rp || Date.now();
      const W = co.width, top = a.bounds.top, H0 = a.bounds.height, bot = top + H0, phone = W < 520;
      const font = (a.theme && a.theme.fontFamily) || 'sans-serif';
      const yOf = (p) => co.priceToY(p, a.scale, a.bounds);
      const labW = phone ? 34 : 54, c1W = phone ? 32 : 54, c2W = cfg.cum ? (phone ? 32 : 54) : 0, ladW = cfg.book ? labW + c1W + c2W : 0, plotR = W - ladW;
      const stat = { feed: f.key, width: W, phone, bubbles: 0, ladderRows: 0, replay: !!rp };
      // first paint (live, not replay): room right of the newest bar for the book column, so "now" is not under it (once; later zoom /
      // scroll is the member's). The same fit as the Liquidity Map.
      if (ladW && !fitted && !rp && a.bars.length > 5) {
        fitted = true;
        try {
          const vp = co.getViewport(), want = Math.ceil(ladW / Math.max(1, co.pxPerBar())) + 2;
          const ws = window.STRYKER_VELA, rr = ws && ws.chart && ws.chart.renderer, ctl = rr && (rr.applyViewport ? rr : rr.renderer);
          if (ctl && ctl.applyViewport && vp.rightOffset < want) ctl.applyViewport({ barSpacing: vp.barSpacing, rightOffset: want });
        } catch (e) {}
      }
      // ---- visible window, history (+ the smoothing lookback), no sample after the clock ----
      const bars = a.bars, nb = bars.length;
      let lo = 0, hi = nb - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (co.timeToX(bars[m].time) < 0) lo = m + 1; else hi = m; }
      const visFrom = bars[lo] ? bars[lo].time : now;
      f.needRemote(visFrom - cfg.smooth, nb ? bars[nb - 1].time + (nb > 1 ? Math.max(1000, bars[nb - 1].time - bars[nb - 2].time) : 60000) : now);   // market closed: the first read starts at the last bar
      const from = visFrom - 5 * 60000 - cfg.smooth;
      const raw = f.allHistory().filter((h) => h.ts >= from && h.ts <= now);
      let s0 = st.get(f.key); if (!s0) st.set(f.key, s0 = {});
      const hist = dhProcess(raw, cfg.smooth, HOLD_TOL, s0);
      stat.samples = hist.length;
      g.save(); g.beginPath(); g.rect(0, top, W, H0); g.clip();
      // ---- heatmap (graphics card when it can, else the 2D pixel loop) ----
      const bmv = { hf: cfg.hf, look: 'depth', colorBy: '', x0: 0, x1: Math.max(0, plotR), fullW: plotR, top, bot, dpr: co.dpr || 1, hist, now,
        version: f.version + ':' + hist.length + ':' + cfg.smooth, gamma: cfg.gamma, priceTop: a.scale.max, priceBot: a.scale.min, tsToX: (t) => co.timeToX(t),
        priceOfY: (y) => { const yH = yOf(a.scale.max), yL = yOf(a.scale.min); return a.scale.max + (y - yH) / (yL - yH) * (a.scale.min - a.scale.max); } };
      const wantGl = cfg.gpu && heatmapGLOk(); if (wantGl && !glr) glr = createHeatmapGL(canvas); else if (!wantGl && glr) { glr.destroy(); glr = null; }
      const r = (glr && glr.draw(g, bmv)) || drawBookmap(g, bmv);
      stat.heat = { cells: r.cells, columns: r.columns, gl: !!r.gl, p97: r.p97, blueShare: r.blueShare };
      // ---- trades: price trace, bubbles, volume ----
      const pxPerMs = Math.abs(co.timeToX(now) - co.timeToX(now - 60000)) / 60000, msPerPx = pxPerMs > 0 ? 1 / pxPerMs : 1000;
      const tLeft = visFrom - 60000, tr = tradesIn(f, H, tLeft, now);
      const tfMs = nb > 1 ? Math.max(1000, bars[nb - 1].time - bars[nb - 2].time) : 60000;
      g.save(); g.beginPath(); g.rect(0, top, plotR, H0); g.clip();
      // price trace: bar closes before the first trade, the trades after (thinned to ~1.5 px)
      const pts = [], firstTr = tr.length ? tr[0][0] : Infinity;
      for (let i = Math.max(0, lo - 2); i < nb && bars[i].time <= now; i++) { if (bars[i].time + tfMs > firstTr) break; pts.push([co.timeToX(bars[i].time + tfMs / 2), yOf(bars[i].close)]); }
      let lastX = -1e9;
      for (let k = 0; k < tr.length; k++) { const x = co.timeToX(tr[k][0]); if (x - lastX < 1.5 && k < tr.length - 1) continue; lastX = x; pts.push([x, yOf(tr[k][1])]); }
      if (!pts.length && nb) pts.push([co.timeToX(bars[nb - 1].time), yOf(bars[nb - 1].close)]);
      if (pts.length > 1) {
        g.lineJoin = 'round'; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 3; g.stroke(); g.strokeStyle = 'rgba(255,240,170,.95)'; g.lineWidth = 1.2; g.stroke();
      }
      stat.tracePoints = pts.length;
      const lastP = tr.length ? tr[tr.length - 1][1] : (nb ? bars[nb - 1].close : 0);
      if (cfg.bubbles && tr.length) {
        const tb = Math.max(1000, niceTime(msPerPx * (phone ? 10 : 12))), bl = bubblesOf(tr, tb);
        const vs = bl.map((b) => b.v).sort((x, y) => x - y), vmax = vs.length ? vs[Math.floor((vs.length - 1) * 0.97)] : 0;   // p97: one huge print does not shrink the rest
        const rMax = (phone ? 10 : 16) * cfg.bubbleScale, rMin = 1.5 * Math.min(1.4, cfg.bubbleScale);
        for (const b of bl) {
          const x = co.timeToX(b.t), y = yOf(b.p), rr = clamp(rMin + (rMax - rMin) * Math.sqrt(b.v / Math.max(1e-12, vmax)), rMin, rMax * 1.15);
          if (x < -rr || x > plotR + rr || y < top - rr || y > bot + rr) continue;
          sphere(g, x, y, rr, b.v > 0 ? b.b / b.v : 0.5); stat.bubbles++;
        }
        stat.bubbleMs = tb;
      }
      g.restore();
      if (cfg.volume) {
        const vh = Math.min(phone ? 40 : 70, H0 * 0.14), base = bot - 2, split = new Map();
        for (const [t, , q, s] of tr) { const bt = Math.floor(t / tfMs) * tfMs; let e = split.get(bt); if (!e) split.set(bt, e = [0, 0]); e[s > 0 ? 0 : 1] += q; }
        const bw = Math.max(1, co.pxPerBar ? co.pxPerBar() * 0.8 : 3), draw = []; let vmax = 0;
        for (let i = lo; i < nb && bars[i].time <= now; i++) {
          const b = bars[i], x = co.timeToX(b.time); if (x > plotR) break;
          const e = split.get(b.time); let bv, sv;
          if (e) { bv = e[0]; sv = e[1]; } else { const v = Number(b.volume || 0); bv = b.close >= b.open ? v : 0; sv = v - bv; }
          if (bv + sv > vmax) vmax = bv + sv; draw.push([x, bv, sv]);
        }
        g.save(); g.beginPath(); g.rect(0, top, plotR, H0); g.clip();
        if (vmax > 0) for (const [x, bv, sv] of draw) {
          const hs = vh * sv / vmax, hb = vh * bv / vmax;
          g.fillStyle = 'rgba(226,64,70,.85)'; g.fillRect(x - bw / 2, base - hs, bw, hs);
          g.fillStyle = 'rgba(52,196,120,.85)'; g.fillRect(x - bw / 2, base - hs - hb, bw, hb);
        }
        g.restore(); stat.volBars = draw.length;
      }
      // ---- last-price line ----
      const ly = Math.round(yOf(lastP)) + 0.5;
      if (lastP > 0 && ly > top && ly < bot) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, ly); g.lineTo(plotR, ly); g.stroke(); g.setLineDash([]); stat.lastPrice = lastP; }
      // ---- book bars + cumulative column + best bid / ask (the Liquidity Map ladder) ----
      if (cfg.book) {
        const book = bookAt(f, now, !!rp, raw);
        const tick = f.custom ? (f.custom.trades && f.custom.trades().tick) || 0.25 : 0;
        if (book) drawLadder(g, a, { book, tick, whole: !!f.custom }, { lx: plotR, labW, c1W, c2W, top, bot, H0, phone, font, yOf, stat, W });
      }
      g.restore();
      stat.ms = Math.round((performance.now() - t0) * 10) / 10;
      dhLast = stat;
    }
  };
}

// ---------------------------------------------------------------------------------------- the native indicator
const NEED = 'Depth Heatmap (L2) works on NQ, ES, YM, RTY, CL and GC futures and on crypto charts.';
const NOT_YET = 'Needs L2 (full order book). It is part of Pro.';
export function installDepthHeatmap(Core, H, reg) {
  class DepthNative {
    constructor() { this.inputs = {}; this.h = null; this.tm = 0; this.hidden = false; this.block = ''; }
    start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; this.attach(); }
    attach() {
      if (!this.ctx) return;
      const mk = H.btBook(H.marketOf(this.ctx)), root = mk.futures ? l2Root(mk.ticker) : null;   // Replay One: the session's real market
      const pv = !mk.futures && (mk.provider === 'binance' || getVenue(mk.provider)) ? mk.provider : '';
      if (root && !this.tierFn) { this.tierFn = () => this.attach(); window.addEventListener('stryker:l2tier', this.tierFn); }
      if (root && !l2Badge()) { this.detach(); this.block = NOT_YET; this.render(); return; }
      const want = root ? 'tsl2|' + root : pv ? H.bookKey(pv, mk.ticker) : '';
      if (this.h && this.h.feed.key === want) { this.render(); return; }
      this.detach();
      this.block = want ? '' : NEED;
      if (root) this.h = H.acquireBookFeed('tsl2', root, () => this.later(), l2Source(root));
      else if (pv) { this.h = H.acquireBookFeed(pv, mk.ticker, () => this.later()); this.h.want({ bucket: 0, range: 0.02 }); H.feedTrades(this.h.feed); }   // starts the trade feed for the bubbles
      this.render();
    }
    detach() { if (this.h) { this.h.release(); this.h = null; } clearTimeout(this.tm); this.tm = 0; }
    later() { if (!this.tm && !this.hidden) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
    onBars() { this.later(); }
    onViewport() {}
    setInputs(i) { this.inputs = i; this.render(); }
    suspend() { this.hidden = true; clearTimeout(this.tm); this.tm = 0; }
    resume() { this.hidden = false; this.attach(); }
    stop() { if (this.tierFn) { window.removeEventListener('stryker:l2tier', this.tierFn); this.tierFn = null; } this.detach(); try { this.ctx.pushData({ off: true }); } catch (e) {} }
    note() {
      if (this.block === NOT_YET) return '';   // the feed note (chart-feeds.js) says this
      if (this.block) return this.block;
      const f = this.h && this.h.feed;
      if (f && replayNow() && H.replayNote) return H.replayNote(f);   // bar replay: the recorded book, not the live feed state
      if (!f || f.status === 'loading') return 'Loading the order book…';
      if (f.status === 'error') return f.err || 'Order book unavailable.';
      if (f.status === 'reconnecting') return f.custom && l2Closed(f.ticker) ? closedNote() : 'Reconnecting to the order book…';
      if (f.history.length < 15 && f.remote.length < 2) return 'Building order book history…';
      return '';
    }
    render() {
      if (!this.ctx || this.hidden) return;
      const msg = this.note(), f = this.h && this.h.feed;
      window.__stkDhNote = msg;   // test hook (tools/tests/heatmap-closed-browser.js)
      this.ctx.setStatus(!f || this.block ? 'idle' : f.status === 'live' ? 'live' : f.status === 'error' ? 'idle' : 'loading');
      this.ctx.emit({ tables: msg ? [H.message('stk_dh-msg', msg, H.pageIsDay(), 'top_right')] : [] });
      this.ctx.pushData(f && !this.block ? { feed: f.key, v: f.version, cfg: dhConfig(this.inputs) } : { off: true });
    }
  }
  Core.registerRendererLayer({ id: DH_TYPE, placement: 'above-data', create: () => dhLayer(H) });
  reg(Core, { type: DH_TYPE, title: DH_TITLE, shortTitle: 'Depth Heatmap', paneHint: 'price', overlay: true, inputsSchema: () => DH_SCHEMA, create: () => new DepthNative() });
  if (!L2_TYPES.includes(DH_TYPE)) L2_TYPES.push(DH_TYPE);
}
