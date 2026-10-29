// TradeZoro — Charts: Liquidity Map (resting order-book heatmap, trade bubbles, order-book ladder, volume bars) — ES module
// Depends on: assets/chart-orderflow.js (calls installLiquidityMap(Core, H, reg) from installOrderflow; H = its helpers:
// the Binance book feed + recorder history, bucketing maths, the trade sources, time helpers). No other imports.
//
// WHAT IT IS (Owner order 2026-10-29, "an indicator that shows resting liquidity"): one indicator, PRO, under Order Flow.
//   - Heatmap over the whole chart area: the size resting at each price, over time, as a glow (dark navy where nothing
//     rests, deep blue -> light blue for small / medium size, yellow -> orange -> red for the biggest walls, white-hot
//     for the very largest). A wall that is pulled or filled simply stops: its band ends there.
//   - A thin yellow price line through it (the book's mid / the trades), drawn INSTEAD of the candles when
//     "Hide candles" is on (default): the layer sits above the candles and paints an opaque background.
//   - Trade bubbles: spheres sized by traded volume, split green (aggressive buying) / red (aggressive selling)
//     by their share of the volume, sitting on the price line.
//   - Right side: two narrow COB columns (current size per price, and the running total from the best price outward),
//     red above the price, green below, and the price labels; the current price row highlighted.
//   - Bottom: volume bars per time bucket, split green / red.
// Data: crypto (Binance BTC / ETH...) = the page's own book feed (REST snapshot + 100 ms diff stream, assets/chart-
// orderflow.js BookFeed) + the 24 h book recorder, and the aggTrade stream. Futures = the member's OWN Rithmic order
// book (market depth, under their entitlement), built in this browser from the moment they connect: nothing is stored
// on a server or relayed. Futures depth is admin-only until RITHMIC_FLAG.depthForAll is turned on.
// INDICATOR ONLY: no order buttons, no click-to-trade. It describes resting orders and prints; it predicts nothing.
// Education only. Not financial advice.

const RAMP = [[0, 4, 10, 24], [0.10, 5, 34, 74], [0.25, 8, 92, 150], [0.42, 60, 160, 205], [0.55, 200, 230, 240], [0.66, 250, 236, 70], [0.80, 255, 150, 25], [0.92, 238, 44, 24], [1, 255, 238, 225]];
export const LM_RAMP = RAMP;
export function lmColor(n) {
  n = Math.min(1, Math.max(0, n));
  let a = RAMP[0], b = RAMP[RAMP.length - 1];
  for (let i = 1; i < RAMP.length; i++) if (n <= RAMP[i][0]) { a = RAMP[i - 1]; b = RAMP[i]; break; }
  const f = (n - a[0]) / Math.max(1e-9, b[0] - a[0]);
  return [Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), Math.round(a[3] + (b[3] - a[3]) * f)];
}
const LUT_N = 1024;
const lutCache = new Map();
// index 0..LUT_N (share of the clip size) -> packed ABGR; the pow() lives here so recolouring is a table read per cell
function lutFor(expo) {
  const k = expo.toFixed(3);
  let l = lutCache.get(k);
  if (l) return l;
  l = new Uint32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const n = Math.pow(i / LUT_N, expo), c = lmColor(n), a = Math.round(255 * Math.min(1, n / 0.05));
    l[i] = ((a << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
  }
  if (lutCache.size > 12) lutCache.clear();
  lutCache.set(k, l);
  return l;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const RING_SAMPLES = 7200 + 600;          // futures book: 2 h at 1 s columns per symbol (+ slack), oldest dropped
const TRADES_MAX = 60000;                 // trade ring per symbol
const decimalsOf = (step) => clamp(Math.ceil(-Math.log10(Math.max(1e-9, step)) - 1e-9), 0, 6);

export const LM_SCHEMA = [
  { key: 'hideCandles', title: 'Hide candles (show a price line)', type: 'bool', defval: true,
    tooltip: 'On: the map covers the chart and a thin yellow line shows the price. Off: the map is see-through, candles stay visible.' },
  { key: 'showHeat', title: 'Resting liquidity heatmap', type: 'bool', defval: true,
    tooltip: 'Each band is size resting in the order book at a price. Blue = small, yellow and orange = large, red and white = the biggest. A band ends where the orders were pulled or traded.' },
  { key: 'contrast', title: 'Contrast', type: 'float', defval: 1, min: 0.3, max: 3, step: 0.1,
    tooltip: 'Higher = more of the map lights up. Lower = only the biggest sizes stand out. The colours are scaled to the sizes in view (the largest 1.5% are clipped), so it adapts as you scroll.' },
  { key: 'minSize', title: 'Min size (0 = show all)', type: 'float', defval: 0, min: 0, max: 1000000, step: 0.1,
    tooltip: 'Hide resting sizes below this. Crypto: in coins (BTC, ETH). Futures: in contracts.' },
  { key: 'historyMinutes', title: 'History (minutes)', type: 'int', defval: 120, min: 10, max: 1440, step: 10,
    tooltip: 'How far back the map reaches. Crypto uses the stored order book history plus this page. Futures builds from the moment you connect, up to 2 hours.' },
  { key: 'showBubbles', title: 'Trade bubbles', type: 'bool', defval: true,
    tooltip: 'Each ball is the volume traded in a short time at one price. Size = volume. The green part is aggressive buying, the red part aggressive selling.' },
  { key: 'minBubble', title: 'Min bubble size (0 = biggest on screen)', type: 'float', defval: 0, min: 0, max: 1000000, step: 0.1,
    tooltip: 'Hide bubbles with less volume than this (coins for crypto, contracts for futures). 0 keeps the biggest ones that fit.' },
  { key: 'bubbleScale', title: 'Bubble size %', type: 'int', defval: 100, min: 40, max: 200, step: 10 },
  { key: 'showLadder', title: 'Order book ladder (right side)', type: 'bool', defval: true,
    tooltip: 'Left column: the size resting at each price now (red above the price = asks, green below = bids). Right column: the running total from the best price outward. Display only.' },
  { key: 'showVolume', title: 'Volume bars', type: 'bool', defval: true, tooltip: 'Traded volume per time bucket along the bottom, green = buying, red = selling.' },
  { key: 'showGrid', title: 'Time grid', type: 'bool', defval: true },
  { key: 'showLegend', title: 'Colour scale (blue = small, yellow = large, red = biggest)', type: 'bool', defval: true,
    tooltip: 'Draws the colour scale with the sizes it stands for at the top left.' }
];
export function lmConfig(i) {
  i = i || {};
  return {
    hide: i.hideCandles !== false, heat: i.showHeat !== false,
    contrast: clamp(num(i.contrast, 1), 0.3, 3), minSize: Math.max(0, num(i.minSize, 0)),
    histMin: clamp(Math.round(num(i.historyMinutes, 120)), 10, 1440),
    bubbles: i.showBubbles !== false, minBubble: Math.max(0, num(i.minBubble, 0)), bubbleScale: clamp(num(i.bubbleScale, 100), 40, 200) / 100,
    ladder: i.showLadder !== false, volume: i.showVolume !== false, grid: i.showGrid !== false, legend: i.showLegend !== false
  };
}

// ---------------------------------------------------------------------------------------- trades (per symbol, shared)
// [{ t, p, q, s: 1 buy / -1 sell }] sorted by t; the order is kept when a backfill batch lands.
const tradeStores = new Map();
class TradeStore {
  constructor(H, provider, ticker) {
    this.key = provider + '|' + ticker; this.list = []; this.version = 0; this.refs = 0; this.status = 'loading'; this.closeTm = 0; this.listeners = new Set();
    this.first = Infinity;
    const src = H.openTradeSource(provider, ticker, (ts, backfill) => this.add(ts, backfill), (st) => { this.status = st; });
    this.stop = src || (() => {});
    this.none = !src;
  }
  add(ts, backfill) {
    if (!ts || !ts.length) return;
    const out = [];
    for (const x of ts) { if (x && x.size > 0 && x.price > 0 && x.side) out.push({ t: x.time, p: x.price, q: x.size, s: x.side === 'buy' ? 1 : -1, id: x.id }); }
    if (!out.length) return;
    if (backfill) {
      out.sort((a, b) => a.t - b.t);
      const first = out[0].t;
      const keep = this.list.filter((x) => x.t > out[out.length - 1].t || x.t < first);
      // a trade seen live and again in the backfill: the backfill wins (same id)
      const ids = new Set(out.map((x) => x.id).filter((x) => x != null));
      this.list = keep.filter((x) => x.id == null || !ids.has(x.id)).concat(out).sort((a, b) => a.t - b.t);
    } else {
      const last = this.list.length ? this.list[this.list.length - 1].t : 0;
      let sorted = true;
      for (const x of out) { if (x.t < last) sorted = false; this.list.push(x); }
      if (!sorted) this.list.sort((a, b) => a.t - b.t);
    }
    if (this.list.length > TRADES_MAX) this.list.splice(0, this.list.length - TRADES_MAX);
    this.first = this.list.length ? this.list[0].t : Infinity;
    this.version++;
    this.listeners.forEach((f) => { try { f(); } catch (e) {} });
  }
}
function acquireTrades(H, provider, ticker, fn) {
  const key = provider + '|' + ticker;
  let s = tradeStores.get(key);
  if (!s) { s = new TradeStore(H, provider, ticker); tradeStores.set(key, s); }
  clearTimeout(s.closeTm); s.refs++; s.listeners.add(fn);
  return { store: s, release() {
    s.listeners.delete(fn);
    if (--s.refs > 0) return;
    s.closeTm = setTimeout(() => { if (s.refs <= 0) { try { s.stop(); } catch (e) {} tradeStores.delete(key); } }, 10000);
  } };
}

// ---------------------------------------------------------------------------------------- futures book (browser only)
const futFeeds = new Map();
class FutBook {
  constructor(H, ticker, tick) {
    this.H = H; this.ticker = ticker; this.key = 'futures|' + ticker; this.tick = tick || 0.25; this.base = ticker;
    this.status = 'waiting'; this.err = ''; this.version = 0; this.refs = 0; this.closeTm = 0; this.listeners = new Set();
    this.book = { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ts: 0 };
    this.history = []; this.startedAt = 0; this.remote = []; this.remoteState = 'none'; this.last = 0;
    const src = window.__stkBookSources && window.__stkBookSources.futures;
    this.stop = src ? src(ticker, (ev) => this.onEv(ev), (st, err) => { if (st === 'error') { this.status = 'error'; this.err = err || ''; } this.bump(); }) : () => {};
    if (!src) { this.status = 'error'; this.err = 'Connect your Rithmic account to see the futures order book.'; }
    this.tm = setInterval(() => this.sample(), 1000);
  }
  onEv(ev) {
    if (ev.kind === 'nobook') { this.status = 'nobook'; this.bump(); return; }
    if (ev.kind !== 'book') return;
    const b = this.book;
    if (ev.full || ev.clear) { b.bids.clear(); b.asks.clear(); }
    for (const [p, q] of ev.bids) { if (q > 0) b.bids.set(p, q); else b.bids.delete(p); }
    for (const [p, q] of ev.asks) { if (q > 0) b.asks.set(p, q); else b.asks.delete(p); }
    let bb = null, ba = null;
    b.bids.forEach((q, p) => { if (bb == null || p > bb) bb = p; });
    b.asks.forEach((q, p) => { if (ba == null || p < ba) ba = p; });
    b.bestBid = bb; b.bestAsk = ba; b.ts = Date.now();
    if (!this.startedAt && (b.bids.size || b.asks.size)) this.startedAt = Date.now();
    if (b.bids.size || b.asks.size) this.status = 'live';
    this.bump();
  }
  sample() {
    const b = this.book;
    if (this.status !== 'live' || !(b.bestBid > 0) || !(b.bestAsk > 0)) return;
    const now = Date.now();
    const s = this.H.bucketBook({ bids: b.bids, asks: b.asks, bestBid: b.bestBid, bestAsk: b.bestAsk, ts: now }, this.tick, 0.02);
    if (!s || !s.v.length) return;
    s.ts = now; this.history.push(s);
    if (this.history.length > RING_SAMPLES) this.history.splice(0, this.history.length - RING_SAMPLES);
    this.bump();
  }
  allHistory() { return this.history; }
  storeStep() { return this.tick; }
  fineStep() { return 0; }
  needRemote() {}
  bump() { this.version++; this.listeners.forEach((f) => { try { f(); } catch (e) {} }); }
  close() { clearInterval(this.tm); try { this.stop(); } catch (e) {} }
}
function acquireFut(H, ticker, tick, fn) {
  const key = 'futures|' + ticker;
  let f = futFeeds.get(key);
  if (!f) { f = new FutBook(H, ticker, tick); futFeeds.set(key, f); }
  clearTimeout(f.closeTm); f.refs++; f.listeners.add(fn);
  return { feed: f, want() {}, release() {
    f.listeners.delete(fn);
    if (--f.refs > 0) return;
    f.closeTm = setTimeout(() => { if (f.refs <= 0) { f.close(); futFeeds.delete(key); } }, 10000);
  } };
}

// ---------------------------------------------------------------------------------------- the layer
let lmLast = null;
export function lmDebug() { return lmLast; }
const quantile = (a, f) => a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * f)))] : 0;
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440].map((m) => m * 60000);

export function makeLayer(H) {
  let canvas = null;
  // heat texture state
  let tex = null, tctx = null, img = null, px32 = null, grid = null;
  let T = null;     // { c0, B, cols, rows, iHi, S, sig, lastTs, lo, cap, expo }
  const ag = { key: '', ver: -1, at: 0, bubbles: [], bars: new Map(), tb: 0 };
  let capAt = 0, capTs = 0;

  function ensureTex(cols, rows) {
    if (!tex) tex = document.createElement('canvas');
    if (tex.width !== cols || tex.height !== rows) {
      tex.width = cols; tex.height = rows; tctx = tex.getContext('2d');
      img = tctx.createImageData(cols, rows); px32 = new Uint32Array(img.data.buffer); grid = new Float32Array(cols * rows);
    } else { grid.fill(0); px32.fill(0); }
  }
  // paint one sample's rows into columns [ca, cb] of the grid
  function paint(s, ca, cb, T, f, tmp) {
    tmp.length = 0;
    H.sampleRows(s, T.S, T.iLo, T.iHi, tmp);
    ca = Math.max(0, ca); cb = Math.min(T.cols - 1, cb);
    if (cb < ca) return;
    // a column the sample covers is replaced as a whole (a pulled order must disappear), then its rows are written
    for (let c = ca; c <= cb; c++) for (let r = 0; r < T.rows; r++) grid[r * T.cols + c] = 0;
    for (let k = 0; k < tmp.length; k += 2) {
      const r = T.iHi - tmp[k];
      if (r < 0 || r >= T.rows) continue;
      const v = Math.abs(tmp[k + 1]);
      for (let c = ca; c <= cb; c++) grid[r * T.cols + c] += v;
    }
  }
  function colour(T, ca, cb) {
    const lut = lutFor(T.expo), span = Math.max(1e-12, T.cap - T.lo), n = T.cols;
    ca = Math.max(0, ca); cb = Math.min(n - 1, cb);
    for (let r = 0; r < T.rows; r++) {
      const o = r * n;
      for (let c = ca; c <= cb; c++) {
        const v = grid[o + c];
        if (v <= T.lo) { px32[o + c] = 0; continue; }
        const x = (v - T.lo) / span;
        px32[o + c] = lut[x >= 1 ? LUT_N : (x * LUT_N) | 0];
      }
    }
  }
  const putCols = (ca, cb) => { ca = Math.max(0, ca); cb = Math.min(T.cols - 1, cb); if (cb >= ca) tctx.putImageData(img, 0, 0, ca, 0, cb - ca + 1, T.rows); };

  return {
    mount(c) { canvas = c; },
    destroy() { canvas = null; tex = null; grid = null; px32 = null; img = null; },
    render(a) {
      const co = a.coords, g = H.beginFrame(canvas, co);
      if (!g || !a.data || a.data.off || !a.bars.length) return;
      const tStart = performance.now();
      const d = a.data, cfg = d.cfg, top = a.bounds.top, H0 = a.bounds.height, bot = top + H0, W = co.width;
      const src = d.kind === 'fut' ? futFeeds.get(d.key) : H.bookFeeds.get(d.key);
      const ts = tradeStores.get(d.tkey);
      if (!src) return;
      const font = (a.theme && a.theme.fontFamily) || 'sans-serif';
      const phone = W < 520;
      const now = Date.now();
      const yOf = (p) => co.priceToY(p, a.scale, a.bounds);
      const span = Math.max(1e-12, a.scale.max - a.scale.min);
      const stat = { kind: d.kind, width: W, phone, cells: 0, bubbles: 0, ladderRows: 0, hide: cfg.hide };
      // ---- ladder width: price labels + two columns (on the right, over the price scale's left side) ----
      const labW = phone ? 40 : 56, c1W = phone ? 38 : 56, c2W = phone ? 38 : 56;
      const ladW = cfg.ladder ? labW + c1W + c2W : 0;
      const lx = W - ladW;
      const plotR = lx;                       // heat / price line / bubbles / volume end where the ladder starts
      g.save(); g.beginPath(); g.rect(0, top, W, H0); g.clip();
      // ---- background: the map covers the candles (hide on) or is a see-through overlay ----
      if (cfg.hide) { g.fillStyle = '#040a16'; g.fillRect(0, top, plotR, H0); }

      // ---- price rows for the texture: ~3 px, a whole multiple of the stored rows ----
      const mid0 = H.bookMid(src.book.bestBid, src.book.bestAsk);
      const sst = src.storeStep() || (src.history.length ? src.history[src.history.length - 1].step : 0);
      let step = niceStep(span / Math.max(40, H0 / 3));
      const fst = d.kind === 'crypto' && mid0 > 0 ? src.fineStep(mid0) : 0;
      const unit = sst > 0 && step < sst * 0.999 && fst > 0 && fst < sst / 1.5 ? fst : sst;
      if (unit > 0) step = step <= unit * 1.0001 ? unit : unit * Math.max(1, Math.round(step / unit));
      // texture rows: the visible price range plus a margin, capped
      const pad = span * 0.5;
      let iLo = Math.floor((a.scale.min - pad) / step), iHi = Math.ceil((a.scale.max + pad) / step);
      let rows = iHi - iLo + 1;
      while (rows > 1400) { step *= 2; iLo = Math.floor((a.scale.min - pad) / step); iHi = Math.ceil((a.scale.max + pad) / step); rows = iHi - iLo + 1; }
      const histMs = cfg.histMin * 60000;
      // columns: ~1.5 s at the 2 h default, widening so the texture stays under ~3.5 M cells
      let B = 1000;
      while ((histMs * 1.25 / B) * rows > 3.5e6) B *= 2;
      const cols = Math.ceil(histMs * 1.25 / B);

      // ---- history -> texture (rebuilt when its shape / the stored history changes, else appended) ----
      let lo = 0, hi = a.bars.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (co.timeToX(a.bars[m].time) < 0) lo = m + 1; else hi = m; }
      const visFrom = a.bars[lo] ? a.bars[lo].time : now;
      if (cfg.heat) src.needRemote(Math.max(visFrom, now - histMs));
      const all = src.allHistory();
      const rem = src.remote || [], loc = src.history;
      const sigStatic = [step, iLo, iHi, B, cols, d.key, rem.length, rem.length ? rem[0].ts : 0, loc.length ? loc[0].ts : 0, histMs].join('|');
      let hist = null;
      const histOf = () => (hist || (hist = all.filter((h) => now - h.ts <= histMs * 1.25)));
      if (cfg.heat) {
        const tmp = [];
        const fresh = !T || T.sig !== sigStatic || now - T.c0 * B >= cols * B - 2000;
        if (fresh) {
          const hs = histOf();
          const c0 = Math.floor((now - histMs) / B);
          ensureTex(cols, rows);
          T = { c0, B, cols, rows, iHi, iLo, S: step, sig: sigStatic, lastTs: 0, lo: 0, cap: 1, expo: 0.5, capKey: '' };
          for (let k = 0; k < hs.length; k++) {
            const s = hs[k];
            const tEnd = k + 1 < hs.length ? Math.min(hs[k + 1].ts, s.ts + (s.span || 10000)) : s.ts + (s.span || 1000);
            const ca = Math.floor(s.ts / B) - c0, cb = Math.max(ca, Math.ceil(tEnd / B) - c0 - 1);
            if (cb < 0 || ca >= cols) continue;
            paint(s, ca, cb, T, src, tmp);
            T.lastTs = s.ts;
          }
          T.full = true;
        } else {
          // new samples only: columns from the last painted sample to the new one, then recolour them
          let c1 = Infinity, c2 = -1;
          for (let k = loc.length - 1; k >= 0 && loc[k].ts > T.lastTs; k--) {
            const s = loc[k];
            const ca = Math.floor(s.ts / B) - T.c0, cb = Math.max(ca, Math.floor((s.ts + 1000) / B) - T.c0 - 1);
            paint(s, ca, cb, T, src, tmp);
            c1 = Math.min(c1, ca); c2 = Math.max(c2, cb);
          }
          if (c2 >= 0) { T.lastTs = loc[loc.length - 1].ts; T.dirty = [Math.min(c1, T.dirty ? T.dirty[0] : c1), Math.max(c2, T.dirty ? T.dirty[1] : c2)]; }
        }
        // ---- clip size from the VISIBLE part (percentile), recoloured only when it moved > 8% (or the inputs changed) ----
        const xL = Math.max(0, Math.floor(co.timeToX(T.c0 * B)));
        const cA = clamp(Math.floor(invTime(co, 0) / B) - T.c0, 0, T.cols - 1);
        const cB = clamp(Math.ceil(now / B - T.c0), 0, T.cols - 1);
        const rTop = clamp(T.iHi - Math.ceil(a.scale.max / T.S), 0, T.rows - 1), rBot = clamp(T.iHi - Math.floor(a.scale.min / T.S), 0, T.rows - 1);
        const nowMs = performance.now();
        const need = T.full || !T.capKey || nowMs - capAt > 400;
        let newCap = T.cap;
        if (need && cB >= cA && rBot >= rTop) {
          capAt = nowMs;
          const vals = [];
          const stepR = Math.max(1, Math.floor(((rBot - rTop + 1) * (cB - cA + 1)) / 24000));
          for (let r = rTop; r <= rBot; r += 1) {
            const o = r * T.cols;
            for (let c = cA + ((r * 7) % stepR); c <= cB; c += stepR) { const v = grid[o + c]; if (v > 0) vals.push(v); }
          }
          vals.sort((x, y) => x - y);
          newCap = vals.length ? Math.max(quantile(vals, 0.985), 1e-9) : 1;
          stat.visValues = vals.length;
        }
        const expo = 0.5 / cfg.contrast, lo2 = cfg.minSize;
        const capMoved = !T.capKey || Math.abs(newCap / T.cap - 1) > 0.08;
        const inKey = expo + '|' + lo2;
        if (T.full || capMoved || T.capKey !== inKey) {
          T.cap = newCap; T.expo = expo; T.lo = Math.min(lo2, T.cap * 0.999); T.capKey = inKey;
          colour(T, 0, T.cols - 1); putCols(0, T.cols - 1); T.full = false; T.dirty = null; stat.recoloured = true;
        } else if (T.dirty) { colour(T, T.dirty[0], T.dirty[1]); putCols(T.dirty[0], T.dirty[1]); T.dirty = null; }
        // ---- draw: texture columns -> x from the chart's own time axis, rows -> y ----
        const xa = co.timeToX(T.c0 * B), xb = co.timeToX((T.c0 + T.cols) * B);
        const yT = yOf((T.iHi + 1) * T.S), yB = yOf((T.iHi - T.rows + 1) * T.S);
        g.save(); g.beginPath(); g.rect(0, top, plotR, H0); g.clip();
        g.imageSmoothingEnabled = false;
        if (!cfg.hide) g.globalAlpha = 0.62;
        // the newest sample stands until now: stretch the last column to the right edge of "now"
        g.drawImage(tex, 0, 0, T.cols, T.rows, xa, Math.min(yT, yB), xb - xa, Math.abs(yB - yT));
        g.restore();
        stat.cells = T.cols * T.rows; stat.cap = T.cap; stat.step = T.S; stat.cols = T.cols; stat.rows = T.rows; stat.B = B;
        stat.samples = histOf().length; stat.histFrom = histOf().length ? histOf()[0].ts : 0;
      }

      // ---- time grid + labels (thin dotted lines) ----
      const pxPerMs = Math.abs(co.timeToX(now) - co.timeToX(now - 60000)) / 60000;
      const tz = H.chartTz();
      if (cfg.grid && pxPerMs > 0) {
        let gs = TIME_STEPS[TIME_STEPS.length - 1];
        for (const s of TIME_STEPS) if (s * pxPerMs >= (phone ? 64 : 92)) { gs = s; break; }
        const tL = now - (co.timeToX(now) - 0) / pxPerMs - gs, tR = now + 3 * gs;
        g.save(); g.beginPath(); g.rect(0, top, plotR, H0); g.clip();
        g.strokeStyle = 'rgba(170,200,235,.22)'; g.lineWidth = 1; g.setLineDash([1, 3]);
        g.font = '10px ' + font; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = 'rgba(190,210,235,.85)';
        const t0 = Math.ceil(tL / gs) * gs, off = tzOffsetMs(tz, t0);
        const labels = [];
        for (let t = t0 - ((t0 + off) % gs + gs) % gs + 0; t <= tR; t += gs) {
          const x = Math.round(co.timeToX(t)) + 0.5;
          if (x < 0 || x > plotR) continue;
          g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke();
          labels.push([x, H.hhmm(t, tz)]);
        }
        g.setLineDash([]);
        labels.forEach(([x, s]) => g.fillText(s, x, bot - 3));
        g.restore();
        stat.gridLines = labels.length; stat.gridLabels = labels.map((l) => l[1]).slice(0, 6);
      }

      // ---- trades -> bubbles + volume per bucket + price trail (cached; rebuilt at most ~3 times a second) ----
      const bars = a.bars, nb = bars.length;
      const tfMs = nb > 1 ? Math.max(1000, bars[nb - 1].time - bars[nb - 2].time) : 60000;
      const trList = ts ? ts.list : [];
      const msPerPx = pxPerMs > 0 ? 1 / pxPerMs : 1000;
      const bubPx = (phone ? 14 : 18);
      const tb = Math.max(1000, niceTime(msPerPx * bubPx));
      const rowPx = bubPx * 0.7;
      const pb = Math.max(1e-9, niceStep(span / (H0 / rowPx)));
      const aKey = [tb, pb, tfMs, d.tkey].join('|');
      if (ts && (ag.key !== aKey || ag.ver !== ts.version) && performance.now() - ag.at > 350) {
        ag.at = performance.now(); ag.key = aKey; ag.ver = ts.version; ag.tb = tb;
        const bm = new Map(), bars2 = new Map();
        for (let k = 0; k < trList.length; k++) {
          const x = trList[k];
          const bi = Math.floor(x.t / tb) * 1e6 + Math.round(x.p / pb);
          let e = bm.get(bi);
          if (!e) { e = { t: 0, pv: 0, b: 0, s: 0, n: 0, w: 0 }; bm.set(bi, e); }
          e.t += x.t * x.q; e.pv += x.p * x.q; e.w += x.q; if (x.s > 0) e.b += x.q; else e.s += x.q; e.n++;
          const bt = Math.floor(x.t / tfMs) * tfMs;
          let v = bars2.get(bt);
          if (!v) { v = { b: 0, s: 0 }; bars2.set(bt, v); }
          if (x.s > 0) v.b += x.q; else v.s += x.q;
        }
        const list = [];
        bm.forEach((e) => list.push({ t: e.t / e.w, p: e.pv / e.w, b: e.b, s: e.s, v: e.b + e.s }));
        list.sort((x, y) => x.t - y.t);
        ag.bubbles = list; ag.bars = bars2;
      }

      // ---- price line (thin yellow): the trades' price where they cover, the candle closes before that ----
      const lineCol = 'rgba(255,226,92,.96)';
      const pts = [];
      const firstTr = trList.length ? trList[0].t : Infinity;
      for (let i = Math.max(0, lo - 2); i < nb; i++) {
        const bt = bars[i].time;
        if (bt + tfMs > firstTr) break;
        pts.push([co.timeToX(bt + tfMs / 2), yOf(bars[i].close)]);
      }
      if (trList.length) {
        let k0 = 0, l = 0, h2 = trList.length - 1;
        const tL2 = now - (co.timeToX(now) / Math.max(1e-9, pxPerMs)) - 2000;
        while (l < h2) { const m = (l + h2) >> 1; if (trList[m].t < tL2) l = m + 1; else h2 = m; }
        k0 = l;
        let lastX = -1e9, lastP = 0;
        for (let k = k0; k < trList.length; k++) {
          const x = co.timeToX(trList[k].t);
          if (x - lastX < 1.5 && k < trList.length - 1) { lastP = trList[k].p; continue; }
          lastX = x; pts.push([x, yOf(trList[k].p)]);
        }
      } else if (!pts.length || a.bars[nb - 1]) {
        pts.push([co.timeToX(bars[nb - 1].time + tfMs / 2), yOf(bars[nb - 1].close)]);
      }
      g.save(); g.beginPath(); g.rect(0, top, plotR, H0 - 0); g.clip();
      if (pts.length > 1) {
        g.strokeStyle = lineCol; g.lineWidth = 1.2; g.lineJoin = 'round'; g.beginPath();
        pts.forEach((p, i) => { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
        g.stroke();
      }
      stat.linePoints = pts.length;

      // ---- bubbles: spheres on the line, size by volume, green / red by share ----
      if (cfg.bubbles && ts) {
        const bl = ag.bubbles, tLeft = now - (co.timeToX(now) / Math.max(1e-9, pxPerMs)) - tb, tRight = now + tb;
        const vis = [];
        for (let i = 0; i < bl.length; i++) { const b = bl[i]; if (b.t < tLeft) continue; if (b.t > tRight) break; vis.push(b); }
        let vmax = 0; vis.forEach((b) => { if (b.v > vmax) vmax = b.v; });
        const maxN = phone ? 140 : 320;
        let pool = vis;
        if (cfg.minBubble > 0) pool = vis.filter((b) => b.v >= cfg.minBubble);
        if (pool.length > maxN) { const sorted = pool.map((b) => b.v).sort((x, y) => y - x); const cut = sorted[maxN - 1]; pool = pool.filter((b) => b.v >= cut); }
        const rMax = (phone ? 13 : 20) * cfg.bubbleScale, rMin = 3 * Math.min(1.4, cfg.bubbleScale);
        // radius ~ sqrt(volume) against the biggest in view, so the sizes read like the volume
        for (const b of pool) {
          const x = co.timeToX(b.t), y = yOf(b.p);
          if (x < -rMax || x > plotR + rMax || y < top - rMax || y > bot + rMax) continue;
          const r = clamp(rMin + (rMax - rMin) * Math.sqrt(b.v / Math.max(1e-12, vmax)), rMin, rMax);
          sphere(g, x, y, r, b.v > 0 ? b.b / b.v : 0.5);
          stat.bubbles++;
        }
        stat.bubbleCandidates = vis.length; stat.vmax = vmax;
      }
      g.restore();

      // ---- volume bars along the bottom, split green / red ----
      if (cfg.volume) {
        const vh = Math.min(phone ? 40 : 64, H0 * 0.14), base = bot - (cfg.grid ? 15 : 3);
        let vmax2 = 0; const draw = [];
        const bw = Math.max(1, Math.abs(co.timeToX(bars[Math.min(nb - 1, lo + 1)].time) - co.timeToX(bars[lo].time)) || 3);
        for (let i = lo; i < nb; i++) {
          const b = bars[i], x = co.timeToX(b.time);
          if (x > plotR) break;
          const t = ag.bars.get(b.time);
          let bv = 0, sv = 0;
          if (t && ts && b.time >= ts.first - 1) { bv = t.b; sv = t.s; }
          else { const v = Number(b.volume || 0); if (b.close >= b.open) bv = v; else sv = v; }
          if (bv + sv > vmax2) vmax2 = bv + sv;
          draw.push([x, bv, sv]);
        }
        const gap = bw > 4 ? 1 : 0;
        g.save(); g.beginPath(); g.rect(0, top, plotR, H0); g.clip();
        for (const [x, bv, sv] of draw) {
          if (!(vmax2 > 0)) break;
          const hs = vh * sv / vmax2, hb = vh * bv / vmax2;
          g.fillStyle = 'rgba(226,64,70,.82)'; g.fillRect(x - bw / 2 + gap / 2, base - hs, Math.max(1, bw - gap), hs);
          g.fillStyle = 'rgba(52,196,120,.82)'; g.fillRect(x - bw / 2 + gap / 2, base - hs - hb, Math.max(1, bw - gap), hb);
        }
        g.restore();
        stat.volBars = draw.length;
      }

      // ---- ladder: price | COB (size now) | COB (running total) ----
      if (cfg.ladder) drawLadder(g, a, src, { lx, labW, c1W, c2W, top, bot, H0, phone, font, yOf, stat, W, d });

      // ---- legend (top left) + notes ----
      let ny = top + 6;
      if (cfg.legend && T) {
        const lw = phone ? 96 : 150, lh = 8, x = 8;
        const gr = g.createLinearGradient(x, 0, x + lw, 0);
        for (const s of RAMP) gr.addColorStop(s[0], 'rgb(' + s[1] + ',' + s[2] + ',' + s[3] + ')');
        g.fillStyle = 'rgba(4,10,22,.78)'; g.fillRect(x - 4, ny - 3, lw + 8, 30);
        g.fillStyle = gr; g.fillRect(x, ny, lw, lh);
        g.font = '9px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = 'rgba(200,215,235,.92)';
        g.fillText(fmtQty(T.lo), x, ny + lh + 10);
        g.textAlign = 'right'; g.fillText(fmtQty(T.cap) + (src.base && d.kind === 'crypto' ? ' ' + src.base : ''), x + lw, ny + lh + 10);
        ny += 34;
      }
      const note = d.note;
      if (note) {
        g.font = '10px ' + font; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        const tw = g.measureText(note).width;
        g.fillStyle = 'rgba(4,10,22,.78)'; g.fillRect(4, ny - 3, tw + 10, 16);
        g.fillStyle = 'rgba(210,222,240,.95)'; g.fillText(note, 9, ny + 9);
        stat.note = note;
      }
      g.restore();
      stat.ms = Math.round((performance.now() - tStart) * 10) / 10;
      lmLast = stat;
    }
  };

  function invTime(co, x) { const t1 = Date.now(), x1 = co.timeToX(t1), x2 = co.timeToX(t1 - 60000); const pp = (x1 - x2) / 60000; return t1 - (x1 - x) / Math.max(1e-9, pp); }
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function niceTime(ms) {
  for (const s of [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000]) if (s >= ms) return s;
  return 3600000;
}
function fmtQty(v) {
  if (!(v > 0)) return '0';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
// offset (ms) of the chart's time zone at t, so grid lines fall on whole hours / minutes there
const tzOffs = new Map();
function tzOffsetMs(tz, t) {
  try {
    let f = tzOffs.get(tz);
    if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); tzOffs.set(tz, f); }
    const p = {}; f.formatToParts(new Date(t)).forEach((x) => { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  } catch (e) { return 0; }
}

// A shaded sphere split green / red by the buy share (buy on top).
function sphere(g, x, y, r, buyShare) {
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  const sp = y - r + 2 * r * clamp(buyShare, 0, 1);
  g.fillStyle = '#e0484f'; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  if (buyShare > 0) { g.fillStyle = '#35c878'; g.fillRect(x - r, y - r, 2 * r, sp - (y - r)); }
  if (r >= 5) {
    const gr = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r * 1.02);
    gr.addColorStop(0, 'rgba(255,255,255,.78)'); gr.addColorStop(0.3, 'rgba(255,255,255,.12)');
    gr.addColorStop(0.62, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.6; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}

function drawLadder(g, a, src, o) {
  const { lx, labW, c1W, c2W, top, bot, phone, font, yOf, stat } = o;
  const book = src.book;
  const ladW = labW + c1W + c2W, W = o.W;
  g.save();
  g.fillStyle = 'rgba(8,14,26,.94)'; g.fillRect(lx, top, ladW, bot - top);
  g.strokeStyle = 'rgba(120,150,190,.28)'; g.lineWidth = 1; g.beginPath(); g.moveTo(lx + 0.5, top); g.lineTo(lx + 0.5, bot); g.stroke();
  const span = a.scale.max - a.scale.min;
  const rowPxWanted = phone ? 11 : 12;
  let step = niceStep(span / Math.max(4, (bot - top) / rowPxWanted));
  const tick = src.tick || 0;
  if (tick > 0) step = Math.max(tick, Math.round(step / tick) * tick);
  const dec = decimalsOf(step);
  const bb = book.bestBid, ba = book.bestAsk;
  if (!(bb > 0 || ba > 0)) { g.restore(); return; }
  const midP = bb > 0 && ba > 0 ? (bb + ba) / 2 : (bb || ba);
  const midRow = Math.floor(midP / step + 1e-9);
  // rows: ask side -> rows above (and including) the one holding the best ask; bid side -> rows below
  const askRows = new Map(), bidRows = new Map();
  const bidTop = bb > 0 ? Math.floor(bb / step + 1e-9) : midRow - 1;
  book.asks.forEach((q, p) => { if (q > 0) { let i = Math.floor(p / step + 1e-9); if (i <= bidTop) i = bidTop + 1; askRows.set(i, (askRows.get(i) || 0) + q); } });
  book.bids.forEach((q, p) => { if (q > 0) { let i = Math.floor(p / step + 1e-9); bidRows.set(i, (bidRows.get(i) || 0) + q); } });
  const iTopV = Math.ceil(a.scale.max / step) + 1, iBotV = Math.floor(a.scale.min / step) - 1;
  // cumulative from the best price outward
  const cumA = new Map(), cumB = new Map();
  let c = 0;
  for (let i = bidTop + 1; i <= iTopV; i++) { c += askRows.get(i) || 0; cumA.set(i, c); }
  c = 0;
  for (let i = bidTop; i >= iBotV; i--) { c += bidRows.get(i) || 0; cumB.set(i, c); }
  let maxS = 0, maxC = 0;
  for (let i = iBotV; i <= iTopV; i++) { const v = (askRows.get(i) || 0) + (bidRows.get(i) || 0); if (v > maxS) maxS = v; const cc = cumA.get(i) || cumB.get(i) || 0; if (cc > maxC) maxC = cc; }
  g.beginPath(); g.rect(lx, top + 14, ladW, bot - top - 14); g.clip();
  const x1 = lx + labW, x2 = x1 + c1W;
  const fs = phone ? 8.5 : 9.5;
  g.font = fs + 'px ' + MONO; g.textBaseline = 'middle';
  let rowsDrawn = 0;
  const midPxRow = Math.abs(yOf(step) - yOf(0));
  const rh = Math.max(1, midPxRow);
  for (let i = iBotV; i <= iTopV; i++) {
    const yT = yOf((i + 1) * step), yB = yOf(i * step), y0 = Math.min(yT, yB), h = Math.abs(yB - yT), cy = y0 + h / 2;
    if (y0 > bot || y0 + h < top + 14) continue;
    const isAsk = i > bidTop, v = isAsk ? (askRows.get(i) || 0) : (bidRows.get(i) || 0), cu = isAsk ? (cumA.get(i) || 0) : (cumB.get(i) || 0);
    const col = isAsk ? '230,72,78' : '52,196,120';
    const best = i === bidTop || i === bidTop + 1 && ba > 0 && i === Math.floor(ba / step + 1e-9);
    if (best) { g.fillStyle = 'rgba(255,255,255,.13)'; g.fillRect(lx + 1, y0, ladW - 1, Math.max(1, h)); }
    if (v > 0 && maxS > 0) { g.fillStyle = 'rgba(' + col + ',.72)'; g.fillRect(x1 + 1, y0 + 0.5, Math.max(1, (c1W - 2) * v / maxS), Math.max(1, h - 1)); }
    if (cu > 0 && maxC > 0) { g.fillStyle = 'rgba(' + col + ',.55)'; g.fillRect(x2 + 1, y0 + 0.5, Math.max(1, (c2W - 2) * cu / maxC), Math.max(1, h - 1)); }
    if (h >= 9) {
      g.textAlign = 'left'; g.fillStyle = best ? '#fff' : 'rgba(176,192,214,.95)';
      g.fillText((i * step).toFixed(dec), lx + 3, cy + 0.5);
      if (v > 0) { g.fillStyle = '#fff'; g.fillText(fmtQty(v), x1 + 3, cy + 0.5); }
      if (cu > 0 && c2W >= 36) { g.fillStyle = 'rgba(255,255,255,.92)'; g.fillText(fmtQty(cu), x2 + 3, cy + 0.5); }
    }
    rowsDrawn++;
  }
  g.restore();
  // headers
  g.save();
  g.fillStyle = 'rgba(8,14,26,1)'; g.fillRect(lx + 1, top, ladW - 1, 14);
  g.font = '8.5px ' + MONO; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = 'rgba(190,205,228,.95)';
  g.fillText('COB', x1 + c1W / 2, top + 7); g.fillText('TOTAL', x2 + c2W / 2, top + 7);
  g.restore();
  // best bid / ask sizes at the price, joined to the ladder by a dashed line
  const bidQ = bb > 0 ? (book.bids.get(bb) || 0) : 0, askQ = ba > 0 ? (book.asks.get(ba) || 0) : 0;
  const yMid = yOf(midP);
  if (yMid > top + 14 && yMid < bot) {
    g.save();
    g.setLineDash([4, 3]); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.max(0, lx - 90), Math.round(yMid) + 0.5); g.lineTo(lx, Math.round(yMid) + 0.5); g.stroke(); g.setLineDash([]);
    const txt = fmtQty(bidQ) + ' | ' + fmtQty(askQ);
    g.font = 'bold ' + (phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
    const tw = g.measureText(txt).width;
    g.fillStyle = 'rgba(4,10,22,.88)'; g.fillRect(lx - tw - 10, yMid - 8, tw + 8, 16);
    g.fillStyle = '#fff'; g.fillText(txt, lx - 6, yMid + 0.5);
    g.restore();
  }
  stat.ladderRows = rowsDrawn; stat.ladderStep = step; stat.bestBidSize = bidQ; stat.bestAskSize = askQ; stat.ladderMaxSize = maxS; stat.ladderMaxTotal = maxC;
}

// ---------------------------------------------------------------------------------------- the native indicator
const NEED_SYMBOL = 'Liquidity Map needs a Binance crypto symbol (BTC, ETH) or a futures symbol connected through Rithmic.';
export function makeNative(H) {
  return class LiquidityMapNative {
    constructor() { this.inputs = {}; this.ctx = null; this.h = null; this.tr = null; this.tm = 0; this.hidden = false; this.kind = ''; }
    start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; this.srcEvt = () => this.attach(); window.addEventListener('stryker:booksource', this.srcEvt); window.addEventListener('stryker:tradesource', this.srcEvt); this.attach(); }
    attach() {
      if (!this.ctx) return;
      const mk = H.marketOf(this.ctx);
      let kind = '', key = '';
      if (mk.provider === 'binance') { kind = 'crypto'; key = H.bookKey('binance', mk.ticker); }
      else if (mk.futures && mk.tick) {
        kind = 'fut'; key = 'futures|' + mk.ticker;
        // the futures order book is visible only to members whose Rithmic connection offers it (admins until depthForAll)
        const has = window.__stkBookSources && window.__stkBookSources.futures;
        if (!has) { this.detach(); this.block = H.rithmicDepthOn() ? 'Connect your Rithmic account (Connect broker) to see the futures order book.' : 'The futures order book is not available yet.'; this.kind = 'fut'; this.render(); return; }
      }
      if (this.h && this.key === key) { this.render(); return; }
      this.detach();
      this.block = kind ? '' : NEED_SYMBOL;
      if (kind) {
        this.kind = kind; this.key = key; this.mk = mk;
        const fn = () => this.later();
        this.h = kind === 'crypto' ? H.acquireBookFeed('binance', mk.ticker, fn) : acquireFut(H, mk.ticker, mk.tick, fn);
        this.tkey = (kind === 'crypto' ? 'binance' : 'futures') + '|' + mk.ticker;
        this.tr = acquireTrades(H, kind === 'crypto' ? 'binance' : 'futures', mk.ticker, fn);
        if (kind === 'crypto') this.h.want({ bucket: 0, range: 0.02 });
      }
      this.render();
    }
    detach() { if (this.h) { this.h.release(); this.h = null; } if (this.tr) { this.tr.release(); this.tr = null; } this.key = ''; clearTimeout(this.tm); this.tm = 0; }
    later() { if (!this.tm && !this.hidden) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
    onBars() {}
    onViewport() {}
    setInputs(i) { this.inputs = i; this.render(); }
    suspend() { this.hidden = true; clearTimeout(this.tm); this.tm = 0; }
    resume() { this.hidden = false; this.attach(); }
    stop() { this.detach(); window.removeEventListener('stryker:booksource', this.srcEvt); window.removeEventListener('stryker:tradesource', this.srcEvt); }
    note() {
      const f = this.h && this.h.feed;
      if (this.block) return { msg: this.block, off: true };
      if (!f) return { msg: '', off: true };
      const tz = H.chartTz();
      if (this.kind === 'fut') {
        if (f.status === 'nobook') return { msg: 'Your data account has no order book (market depth). Ask your prop firm or broker.', off: true };
        if (f.status === 'error') return { msg: f.err || 'Order book unavailable.', off: true };
        if (f.status === 'waiting') return { msg: 'Waiting for the order book from Rithmic…', off: false };
        return { msg: f.startedAt ? 'Building since ' + H.hhmm(f.startedAt, tz) + ' · connect stays open' : '', off: false };
      }
      if (f.status === 'loading') return { msg: 'Loading the order book…', off: false };
      if (f.status === 'error') return { msg: f.err || 'Order book unavailable.', off: true };
      if (f.status === 'reconnecting') return { msg: 'Reconnecting to the order book…', off: false };
      const first = f.allHistory()[0];
      if (f.history.length < 15 && f.remote.length < 2) return { msg: 'Building order book history…', off: false };
      return { msg: first ? 'Order book history from ' + H.hhmm(first.ts, tz) : '', off: false };
    }
    render() {
      if (!this.ctx || this.hidden) return;
      const n = this.note(), f = this.h && this.h.feed;
      this.ctx.setStatus(!f || n.off ? 'idle' : 'live');
      // a plain message while there is nothing to draw (no symbol / no depth); otherwise the layer draws the note itself
      this.ctx.emit({ tables: n.off && n.msg ? [H.message('stk_lm-msg', n.msg, H.pageIsDay(), 'top_right')] : [] });
      this.ctx.pushData(f && !n.off ? { kind: this.kind, key: f.key, tkey: this.tkey, v: f.version + ':' + (this.tr ? this.tr.store.version : 0), cfg: lmConfig(this.inputs), note: n.msg } : { off: true });
    }
  };
}

// ---------------------------------------------------------------------------------------- registration
export function installLiquidityMap(Core, H, reg) {
  Core.registerRendererLayer({ id: 'stk_liqmap', placement: 'above-data', create: () => makeLayer(H) });
  const Native = makeNative(H);
  reg(Core, { type: 'stk_liqmap', title: 'Liquidity Map (order book heatmap)', shortTitle: 'Liquidity Map', paneHint: 'price', overlay: true,
    inputsSchema: () => LM_SCHEMA, create: () => new Native() });
}
// Test hooks
export function lmDebugFeeds() { return { fut: [...futFeeds.keys()], trades: [...tradeStores.keys()].map((k) => [k, tradeStores.get(k).list.length]) }; }
