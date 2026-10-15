// TradeZoro — Charts: ORDER FLOW from InsightSentry tick trades (futures). Owner-approved 2026-10-14.
// Depends on: assets/chart-footprint-data.js (decode + maths), Vela's plugin SDK passed in as `Core`
// (registerChartType, registerRendererLayer, registerNativeIndicator), window.__stkReplay
// (assets/chart-bar-replay.js) and window.strykerPlanTier (assets/plan-limits.js).
//
// Data: GET <recorder>/orderflow?sym=NQ&day=YYYY-MM-DD (1-minute footprint bars built on our server
// from every trade with its aggressor side: workers/book-recorder/of-feeder). Re-aggregated here to
// the chart's timeframe and to coarser price rows by zoom.
//
// What it adds:
//   - Chart type "Footprint" (stk_fp, next to Candles): per bar sell x buy (bid x ask) volume at each
//     price, the POC, diagonal imbalances (300% default), stacked imbalances, unfinished-auction
//     marks, delta + volume under each bar. Modes: bid x ask, delta, volume. Zoomed out it falls
//     back to candles coloured by the bar's delta.
//   - Indicators, group "Order Flow": Delta (trades), Cumulative Delta (trades, candles or line,
//     session reset), Big Trades (bubbles), Volume Profile (trades) and VWAP (trades, +-1/2 SD).
// No lookahead: in bar replay every tool uses only the 1-minute bars complete at the replay clock.
// Gating: free plan = NQ (and MNQ) only, the last 24 h; Pro = all six roots and the full history.
// Simulation / education only: nothing here places or suggests an order.
// Education only. Not financial advice.

import { decodeOrderflow, gunzipBody, aggregate, clipTo, rows, poc, imbalances, stacked, unfinished, cvdCandles, profile, vwapSeries } from './chart-footprint-data.js?v=566';

const RECORDER = 'https://book-recorder.theelitegrey.workers.dev';
const ROOTS = { NQ: 'NQ', MNQ: 'NQ', ES: 'ES', MES: 'ES', YM: 'YM', MYM: 'YM', GC: 'GC', MGC: 'GC', SI: 'SI', SIL: 'SI', CL: 'CL', MCL: 'CL' };
const FREE_ROOT = 'NQ';
const FREE_LOOKBACK_MS = 24 * 3600 * 1000;
const MAX_DAYS = 14;                 // UTC days fetched for one chart at most
const TODAY_REFRESH_MS = 30000;
const MAX_TF_MIN = 240;
export const FP_TYPE = 'stk_fp';
export const OF_GROUP = 'Order Flow';
const UP = '#03c988', UP2 = '#4fe3ac', DN = '#f23645', CYAN = '#00adb5';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISCLAIMER = 'Order flow from exchange trades. Education only. Not financial advice.';

// ---------------------------------------------------------------- small helpers
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function tfMin(tf) {
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) return +tf;
  const m = /^(\d+)([SDWM])$/i.exec(tf) || /^([DWM])$/i.exec(tf);
  if (!m) return null;
  const n = m.length === 3 ? +m[1] : 1, u = (m.length === 3 ? m[2] : m[1]).toUpperCase();
  return u === 'S' ? n / 60 : u === 'D' ? n * 1440 : u === 'W' ? n * 10080 : n * 43200;
}
function light() { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } }
function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'K';
  return String(Math.round(v));
}
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '-' : '') + fmt(Math.abs(v));
// The CME session (18:00 New York -> 17:00) a time belongs to, keyed by the NY date it ends on.
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
const sessCache = new Map();
export function sessionOf(ms) {
  const h = Math.floor(ms / 3600000);
  let k = sessCache.get(h);
  if (k === undefined) {
    const p = {};
    nyFmt.formatToParts(new Date(h * 3600000 + 6 * 3600000)).forEach((x) => { p[x.type] = x.value; });
    k = p.year + '-' + p.month + '-' + p.day;
    if (sessCache.size > 20000) sessCache.clear();
    sessCache.set(h, k);
  }
  return k;
}
// The replay clock (ms) while bar replay is on, else null.
const replayE = () => (window.__stkReplay && window.__stkReplay.on ? window.__stkReplay.E : null);

// The chart's futures root mapped to our recorded mini (MNQ -> NQ), or null.
function rootOf(ctx) {
  let provider = '', ticker = String(ctx.symbol || '');
  try { const r = ctx.data.resolve(ctx.symbol); if (r) { provider = r.provider; ticker = r.ticker; } } catch (e) {}
  if (!provider) { const m = /^([a-z]+):(.+)$/i.exec(ticker); if (m) { provider = m[1].toLowerCase(); ticker = m[2]; } }
  if (provider !== 'futures') return null;
  const root = ticker.toUpperCase().replace(/[0-9]*!$/, '').replace(/[FGHJKMNQUVXZ]\d{2,4}$/, '');
  return ROOTS[root] || null;
}

// ---------------------------------------------------------------- plan tier
let tierP = null;
function tier() {
  if (tierP) return tierP;
  tierP = new Promise((resolve) => {
    const t = setTimeout(() => resolve({ free: true, unknown: true }), 6000);
    try {
      if (typeof window.strykerPlanTier !== 'function') { clearTimeout(t); resolve({ free: true, unknown: true }); return; }
      window.strykerPlanTier().then((r) => { clearTimeout(t); resolve(r || { free: true }); }, () => { clearTimeout(t); resolve({ free: true }); });
    } catch (e) { clearTimeout(t); resolve({ free: true }); }
  });
  return tierP;
}
let tierNow = null;
tier().then((r) => { tierNow = r; listeners.forEach((fn) => { try { fn(); } catch (e) {} }); });
// Local test override only (127.0.0.1 / localhost): the browser suite checks the free plan. The
// recorder's data is public; this gate is the product's taste/upgrade line, not access control.
function testTier() {
  try { if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && window.__stkOfTestTier) return window.__stkOfTestTier; } catch (e) {}
  return null;
}

// ---------------------------------------------------------------- data store (per root, per UTC day)
// days: 'YYYY-MM-DD' -> { bars: [], at, loading, err }. One fetch per day; today refreshes.
const stores = new Map();
const listeners = new Set();
let version = 0;
const bump = () => { version++; listeners.forEach((fn) => { try { fn(); } catch (e) {} }); };
function store(root) {
  let s = stores.get(root);
  if (!s) { s = { root, days: new Map(), tick: 0, thr: 0, merged: null, mergedV: -1, v: 0 }; stores.set(root, s); }
  return s;
}
async function fetchDay(s, day) {
  let e = s.days.get(day);
  const today = day === utcDay(Date.now());
  if (e && (e.loading || (!today && e.bars && !(e.err && Date.now() - e.at > 60000)) || (today && e.at && Date.now() - e.at < TODAY_REFRESH_MS - 1000))) return;
  if (!e) { e = { bars: null, at: 0, loading: false, err: '' }; s.days.set(day, e); }
  e.loading = true;
  try {
    const r = await fetch(RECORDER + '/orderflow?sym=' + s.root + '&day=' + day);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let u8 = new Uint8Array(await r.arrayBuffer());
    if (r.headers.get('x-of-gzip') === '1') u8 = await gunzipBody(u8);
    const p = decodeOrderflow(u8);
    e.bars = p.bars; e.err = '';
    if (p.header) { s.tick = p.header.tick || s.tick; if (p.header.thr) s.thr = p.header.thr; }
  } catch (x) {
    e.err = 'Order-flow history is temporarily unavailable. It retries on its own.';
    if (!e.bars) e.bars = [];
  }
  e.at = Date.now(); e.loading = false; s.v++;
  bump();
}
// The 1-minute bars of a root over [fromMs, toMs], fetching missing days (async; returns what is here).
function minuteBars(root, fromMs, toMs, free) {
  const s = store(root);
  const now = Date.now();
  if (free) fromMs = Math.max(fromMs, now - FREE_LOOKBACK_MS);
  toMs = Math.min(toMs, now);
  if (!(toMs >= fromMs)) return { bars: [], s, loading: false };
  const d0 = Math.max(Math.floor(fromMs / 86400000), Math.floor(toMs / 86400000) - MAX_DAYS + 1), d1 = Math.floor(toMs / 86400000);
  let loading = false, err = '';
  const out = [];
  for (let d = d0; d <= d1; d++) {
    const day = utcDay(d * 86400000);
    void fetchDay(s, day);
    const e = s.days.get(day);
    if (!e || !e.bars) { loading = true; continue; }
    if (e.err) err = e.err;
    for (const b of e.bars) if (b.t >= fromMs - 60000 && b.t <= toMs) out.push(b);
  }
  return { bars: free ? out.filter((b) => b.t >= now - FREE_LOOKBACK_MS) : out, s, loading, err };
}
// Today's day refreshes on a timer while any chart uses order flow (not during replay).
let refreshTm = 0, users = 0;
function startRefresh() {
  if (refreshTm) return;
  refreshTm = setInterval(() => {
    if (replayE() != null || document.visibilityState === 'hidden') return;
    const day = utcDay(Date.now());
    stores.forEach((s) => { if (s.days.has(day)) void fetchDay(s, day); });
  }, TODAY_REFRESH_MS);
}
function stopRefresh() { if (users <= 0 && refreshTm) { clearInterval(refreshTm); refreshTm = 0; } }

// The order-flow bars matching a chart's bars (same timeframe, replay-clipped), keyed by time.
// Returns { map: Map(time -> bar), tick, thr, note, list } or { note } when the chart cannot show it.
const viewCache = new WeakMap();
export function flowFor(ctxLike) {
  const root = ctxLike.root;
  if (!root) return { note: 'Order flow from trades: NQ, ES, YM, GC, SI and CL futures (and their micros).' };
  const tf = tfMin(ctxLike.timeframe);
  if (tf == null || tf < 1 || tf > MAX_TF_MIN) return { note: 'Order flow works on 1-minute to 4-hour charts.' };
  const t = testTier() || tierNow;
  const free = !t || t.free;
  if (free && root !== FREE_ROOT && !(t && t.admin)) return { note: 'Order flow on ' + root + ' is part of Pro. The free plan shows it on NQ (last 24 h).', locked: true };
  const cb = ctxLike.bars;
  if (!cb.length) return { note: '' };
  const E = replayE();
  const toMs = Math.min(cb[cb.length - 1].time + tf * 60000, E == null ? Infinity : E);
  const got = minuteBars(root, cb[0].time, toMs, free);
  const key = root + '|' + tf + '|' + got.s.v + '|' + (E == null ? '' : Math.floor(E / 60000)) + '|' + cb[0].time + '|' + got.bars.length;
  const memo = viewCache.get(ctxLike.owner);
  if (memo && memo.key === key) return memo.out;
  const clipped = clipTo(got.bars, E);
  const agg = aggregate(clipped, tf * 60000);
  const map = new Map();
  for (const b of agg) map.set(b.t, b);
  const note = got.loading && !agg.length ? 'Loading order flow…' : got.err && !agg.length ? got.err : !agg.length ? (free ? 'No order flow in the last 24 h yet (free plan: NQ, last 24 h).' : 'No order flow for these bars yet. History starts ' + '6 days before 2026-10-14 and grows from there.') : '';
  const out = { map, list: agg, tick: got.s.tick || 0.25, thr: got.s.thr || 0, note, free, loading: got.loading };
  viewCache.set(ctxLike.owner, { key, out });
  return out;
}

// ---------------------------------------------------------------- footprint chart type
const FP_DEF = { fpMode: 'bidask', fpImb: 300, fpStack: 3, fpRows: 0, fpStats: true, fpPoc: true, fpUnfinished: true };
const fpSettings = new Map();      // chart engine -> settings
function fpConfig(v) {
  v = v || {};
  return {
    mode: ['bidask', 'delta', 'volume'].includes(v.fpMode) ? v.fpMode : 'bidask',
    imb: clamp(num(v.fpImb, 300), 110, 2000) / 100,
    stack: clamp(Math.round(num(v.fpStack, 3)), 2, 10),
    rows: clamp(Math.round(num(v.fpRows, 0)), 0, 400),
    stats: v.fpStats !== false, poc: v.fpPoc !== false, unf: v.fpUnfinished !== false
  };
}
class FootprintEngine {
  constructor() { this.cfg = fpConfig(FP_DEF); this.on = false; this.onAny = () => this.push(); }
  start(ctx) { this.ctx = ctx; this.on = true; users++; startRefresh(); listeners.add(this.onAny); this.push(); }
  onSettings(v) { this.cfg = fpConfig(v); this.push(); }
  onViewport() { this.push(); }
  suspend() { if (!this.on) return; this.on = false; users--; stopRefresh(); listeners.delete(this.onAny); }
  resume() { if (this.on) return; this.on = true; users++; startRefresh(); listeners.add(this.onAny); this.push(); }
  stop() { this.suspend(); }
  push() {
    if (!this.on || !this.ctx) return;
    this.ctx.pushData({ eng: this, root: rootOf(this.ctx), timeframe: this.ctx.timeframe, cfg: this.cfg, v: version });
  }
}

// Rows of `m` ticks per bar, cached per (bar object, m).
const rowCache = new WeakMap();
function rowsOf(bar, m) {
  let c = rowCache.get(bar);
  if (!c || c.m !== m) { const rs = rows(bar, m); c = { m, rs, poc: poc(rs) }; rowCache.set(bar, c); }
  return c;
}
const ROW_STEPS = [1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 200, 400];

function footprintLayer() {
  let canvas = null, on = false, lastMs = 0;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const t0 = performance.now();
      const g = canvas && canvas.getContext('2d');
      on = false;
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (a.priceStyle !== FP_TYPE || !a.data || !a.bars.length) return;
      const co = a.coords, dpr = co.dpr || 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = a.data, cfg = d.cfg;
      const f = flowFor({ root: d.root, timeframe: d.timeframe, bars: a.bars, owner: d.eng });
      const top = a.bounds.top, bot = top + a.bounds.height, day = light();
      const ink = day ? '#1f2937' : '#d7dbe2', dim = day ? '#64748b' : '#8a90a0';
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      if (f.note) {
        g.font = '12px ' + MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
        const w = g.measureText(f.note).width + 20;
        g.fillStyle = day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)';
        g.fillRect(co.width / 2 - w / 2, bot - 58, w, 24);
        g.fillStyle = f.locked ? CYAN : dim; g.fillText(f.note, co.width / 2, bot - 46);
      }
      if (!f.map || !f.map.size) { g.restore(); return; }
      const tick = f.tick;
      const bw = co.pxPerBar();
      const vr = co.visibleLogicalRange();
      const i0 = Math.max(0, Math.floor(vr.from) - 1), i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to) + 1);
      const tickPx = Math.abs(co.priceToY(a.scale.min + tick, a.scale, a.bounds) - co.priceToY(a.scale.min, a.scale, a.bounds));
      let m = cfg.rows || 1;
      if (!cfg.rows) for (const s of ROW_STEPS) { m = s; if (tickPx * s >= 13) break; }
      const rowPx = tickPx * m;
      const cells = bw >= 30 && rowPx >= 9;
      const statsH = cfg.stats && cells ? 30 : 0;
      if (!cells) {
        // zoomed out: candles coloured by the bar's delta (strength = |delta| / volume)
        for (let i = i0; i <= i1; i++) {
          const bar = a.bars[i], fb = f.map.get(bar.time);
          if (!fb || !fb.vol) continue;
          const x = co.logicalToX(i), w = Math.max(1, Math.floor(bw * 0.7));
          const yO = co.priceToY(bar.open, a.scale, a.bounds), yC = co.priceToY(bar.close, a.scale, a.bounds);
          const r = fb.delta / fb.vol;
          g.fillStyle = alpha(fb.delta >= 0 ? UP : DN, 0.35 + 0.65 * Math.min(1, Math.abs(r) * 2.5));
          g.fillRect(Math.round(x - w / 2), Math.min(yO, yC), w, Math.max(1, Math.abs(yC - yO)));
        }
        g.restore(); lastMs = performance.now() - t0; return;
      }
      on = true;
      const fs = clamp(Math.floor(Math.min(rowPx - 2, bw / 6.5)), 8, 13);
      const font = fs + 'px ' + MONO, bold = '600 ' + fs + 'px ' + MONO;
      g.textBaseline = 'middle';
      for (let i = i0; i <= i1; i++) {
        const bar = a.bars[i], fb = f.map.get(bar.time);
        if (!fb) continue;
        const { rs, poc: pk } = rowsOf(fb, m);
        if (!rs.length) continue;
        const x = co.logicalToX(i), w = Math.max(10, bw * 0.92), xl = x - w / 2;
        let max = 1;
        for (const r of rs) { const v = r.buy + r.sell; if (v > max) max = v; }
        const imb = imbalances(rs, cfg.imb);
        const st = stacked(imb, cfg.stack);
        const showText = rowPx >= 11 && bw >= 44;
        for (let k = 0; k < rs.length; k++) {
          const r = rs[k];
          const yT = co.priceToY((r.p + m) * tick, a.scale, a.bounds), yB = co.priceToY(r.p * tick, a.scale, a.bounds);
          const y = Math.min(yT, yB), h = Math.abs(yB - yT);
          if (y > bot || y + h < top) continue;
          const v = r.buy + r.sell, dl = r.buy - r.sell;
          if (cfg.mode === 'bidask') {
            // left half = sells (hit the bid), right half = buys (lifted the ask); shade by size
            g.fillStyle = alpha(DN, 0.06 + 0.5 * (r.sell / max) + (imb.sell[k] ? 0.25 : 0));
            g.fillRect(xl, y + 0.5, w / 2 - 0.5, Math.max(1, h - 1));
            g.fillStyle = alpha(UP, 0.06 + 0.5 * (r.buy / max) + (imb.buy[k] ? 0.25 : 0));
            g.fillRect(x + 0.5, y + 0.5, w / 2 - 0.5, Math.max(1, h - 1));
          } else {
            g.fillStyle = cfg.mode === 'delta' ? alpha(dl >= 0 ? UP : DN, 0.08 + 0.55 * Math.abs(dl) / max) : alpha(CYAN, 0.08 + 0.5 * v / max);
            g.fillRect(xl, y + 0.5, w, Math.max(1, h - 1));
          }
          if (cfg.poc && k === pk) { g.strokeStyle = day ? '#0f172a' : '#f5f5f5'; g.lineWidth = 1.2; g.strokeRect(xl + 0.5, y + 0.5, w - 1, Math.max(1, h - 1)); }
          if (!showText) continue;
          const yc = y + h / 2;
          if (cfg.mode === 'bidask') {
            g.textAlign = 'right'; g.font = imb.sell[k] ? bold : font; g.fillStyle = imb.sell[k] ? (day ? '#b91c1c' : '#ff6b7a') : ink;
            g.fillText(fmt(r.sell), x - 3, yc);
            g.textAlign = 'left'; g.font = imb.buy[k] ? bold : font; g.fillStyle = imb.buy[k] ? (day ? '#047857' : UP2) : ink;
            g.fillText(fmt(r.buy), x + 3, yc);
          } else {
            g.textAlign = 'center'; g.font = font;
            g.fillStyle = cfg.mode === 'delta' ? (dl >= 0 ? (day ? '#047857' : UP2) : (day ? '#b91c1c' : '#ff6b7a')) : ink;
            g.fillText(cfg.mode === 'delta' ? sgn(dl) : fmt(v), x, yc);
          }
        }
        // stacked imbalances: a bar on the buy (right) or sell (left) edge spanning the run
        for (const sx of st) {
          const yA = co.priceToY((rs[sx.k1].p + m) * tick, a.scale, a.bounds), yZ = co.priceToY(rs[sx.k0].p * tick, a.scale, a.bounds);
          g.fillStyle = sx.side ? UP : DN;
          g.fillRect(sx.side ? xl + w + 1 : xl - 4, Math.min(yA, yZ), 3, Math.abs(yZ - yA));
        }
        // unfinished auction: both sides traded at the extreme row -> amber tick past the edge
        if (cfg.unf) {
          const u = unfinished(rs);
          g.strokeStyle = '#f5b301'; g.lineWidth = 2;
          if (u.high) { const y = co.priceToY((rs[rs.length - 1].p + m) * tick, a.scale, a.bounds); g.beginPath(); g.moveTo(xl, y - 2); g.lineTo(xl + w, y - 2); g.stroke(); }
          if (u.low) { const y = co.priceToY(rs[0].p * tick, a.scale, a.bounds); g.beginPath(); g.moveTo(xl, y + 2); g.lineTo(xl + w, y + 2); g.stroke(); }
        }
        if (statsH) {
          const y0 = bot - statsH;
          g.fillStyle = day ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.88)';
          g.fillRect(xl - 1, y0, w + 2, statsH);
          g.textAlign = 'center'; g.font = bold;
          g.fillStyle = fb.delta >= 0 ? (day ? '#047857' : UP2) : (day ? '#b91c1c' : '#ff6b7a');
          g.fillText(sgn(fb.delta), x, y0 + 8);
          g.font = font; g.fillStyle = dim;
          g.fillText(fmt(fb.vol), x, y0 + 22);
        }
      }
      if (statsH) {
        g.font = '10px ' + MONO; g.textAlign = 'left'; g.fillStyle = dim;
        g.fillText('Δ', 4, bot - statsH + 8); g.fillText('Vol', 4, bot - statsH + 22);
      }
      g.restore();
      lastMs = performance.now() - t0;
      if (window.__stkFpStats) window.__stkFpStats.push(lastMs);
    },
    modulateBase(a) { return on && a && a.priceStyle === FP_TYPE ? { candleBodyScale: 0.1, candleBodyAlpha: 0.7 } : null; },
    destroy() { canvas = null; }
  };
}

const FP_ICON = '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="6" y="5" width="16" height="18" rx="1.5"/><path d="M14 5v18M6 11h16M6 17h16"/></svg>';

// ---------------------------------------------------------------- indicators (group "Order Flow")
const IND = {
  stk_of_delta: { title: 'Delta (trades)', short: 'Delta', pane: 'new', overlay: false, schema: [
    { key: 'upColor', title: 'Positive', type: 'color', defval: UP }, { key: 'downColor', title: 'Negative', type: 'color', defval: DN }] },
  stk_of_cvd: { title: 'Cumulative Delta (trades)', short: 'CVD', pane: 'new', overlay: false, schema: [
    { key: 'style', title: 'Show as', type: 'string', defval: 'candles', options: ['candles', 'line'] },
    { key: 'reset', title: 'Reset', type: 'string', defval: 'session', options: ['session', 'day', 'none'], tooltip: 'session = the CME day (18:00 New York).' },
    { key: 'upColor', title: 'Up', type: 'color', defval: UP }, { key: 'downColor', title: 'Down', type: 'color', defval: DN }] },
  stk_of_big: { title: 'Big Trades (trades)', short: 'Big Trades', pane: 'price', overlay: true, schema: [
    { key: 'minSize', title: 'Min size (contracts, 0 = auto)', type: 'int', defval: 0, min: 0, max: 100000, step: 1, tooltip: 'Auto = the 99.5th percentile of the previous session\'s orders for this symbol.' },
    { key: 'labels', title: 'Size labels', type: 'bool', defval: true }] },
  stk_of_vp: { title: 'Volume Profile (trades)', short: 'VP (trades)', pane: 'price', overlay: true, schema: [
    { key: 'range', title: 'Range', type: 'string', defval: 'session', options: ['session', 'visible'] },
    { key: 'rowTicks', title: 'Row size (ticks, 0 = auto)', type: 'int', defval: 0, min: 0, max: 400, step: 1 },
    { key: 'va', title: 'Value area %', type: 'int', defval: 70, min: 10, max: 100, step: 1 },
    { key: 'widthPct', title: 'Width %', type: 'int', defval: 30, min: 5, max: 100, step: 1 }] },
  stk_of_vwap: { title: 'VWAP (trades, ±1/2 SD)', short: 'VWAP (trades)', pane: 'price', overlay: true, schema: [
    { key: 'reset', title: 'Reset', type: 'string', defval: 'session', options: ['session', 'day'] },
    { key: 'bands', title: 'SD bands', type: 'string', defval: '1 and 2', options: ['none', '1', '1 and 2'] },
    { key: 'color', title: 'VWAP colour', type: 'color', defval: CYAN }] }
};
export const OF_TYPES = Object.keys(IND);
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));

function msgTable(id, text, locked) {
  const day = light();
  return { id, paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: locked ? CYAN : (day ? '#334155' : '#a3a9b6'), hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}

class OfNative {
  constructor(type) { this.type = type; this.inputs = {}; this.tm = 0; this.onAny = () => this.later(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(IND[this.type].schema), inputs); users++; startRefresh(); listeners.add(this.onAny); this.render(); }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() { this.later(); }
  onViewport() { if (this.type === 'stk_of_vp') this.render(); }
  setInputs(i) { this.inputs = Object.assign(defaults(IND[this.type].schema), i); this.render(); }
  suspend() { listeners.delete(this.onAny); }
  resume() { listeners.add(this.onAny); this.render(); }
  stop() { listeners.delete(this.onAny); clearTimeout(this.tm); users--; stopRefresh(); }
  render() {
    if (!this.ctx) return;
    const bars = this.ctx.bars();
    const f = flowFor({ root: rootOf(this.ctx), timeframe: this.ctx.timeframe, bars, owner: this });
    const tables = f.note ? [msgTable(this.type + '-msg', f.note, f.locked)] : [];
    this.ctx.setStatus(f.loading ? 'loading' : 'idle');
    const I = this.inputs, map = f.map || new Map();
    const t = this.type;
    if (t === 'stk_of_delta') {
      const pts = bars.map((b) => { const x = map.get(b.time); return x ? { time: b.time, value: x.delta, color: x.delta >= 0 ? I.upColor : I.downColor } : { time: b.time, value: null }; });
      this.ctx.emit({ series: [{ id: 'of-delta', title: 'Delta', paneId: '', kind: 'histogram', points: pts, style: { color: I.upColor, width: 1, lineStyle: 'solid', base: 0 } }], tables });
      return;
    }
    if (t === 'stk_of_cvd') {
      const list = f.list || [];
      const cc = cvdCandles(list, I.reset, sessionOf);
      const byT = new Map(); cc.forEach((c) => byT.set(c.t, c));
      if (I.style === 'line') {
        const pts = bars.map((b) => { const c = byT.get(b.time); return c ? { time: b.time, value: c.c } : { time: b.time, value: null }; });
        this.ctx.emit({ series: [{ id: 'of-cvd', title: 'CVD', paneId: '', kind: 'line', points: pts, style: { color: I.upColor, width: 2, lineStyle: 'solid' } }], tables });
      } else {
        const cb = bars.map((b) => { const c = byT.get(b.time); return c ? { time: b.time, open: c.o, high: c.h, low: c.l, close: c.c } : null; }).filter(Boolean); // null entries made Vela's modelToValuePatch throw on every render for bars without trades
        this.ctx.emit({ series: [{ id: 'of-cvd', title: 'CVD', paneId: '', kind: 'candle', bars: cb, style: { up: I.upColor, down: I.downColor } }], tables });
      }
      return;
    }
    if (t === 'stk_of_vwap') {
      const vw = vwapSeries(f.list || [], f.tick || 0.25, I.reset, sessionOf);
      const byT = new Map(); vw.forEach((v) => byT.set(v.t, v));
      const mk = (id, title, k, color, width, style) => ({ id, title, paneId: '', kind: 'line',
        points: bars.map((b) => { const v = byT.get(b.time); return v && v.vwap != null ? { time: b.time, value: v.vwap + k * v.sd } : { time: b.time, value: null }; }),
        style: { color, width, lineStyle: style } });
      const series = [mk('of-vwap', 'VWAP', 0, I.color, 2, 'solid')];
      if (I.bands !== 'none') { series.push(mk('of-u1', '+1 SD', 1, alpha(I.color, 0.7), 1, 'dashed'), mk('of-l1', '-1 SD', -1, alpha(I.color, 0.7), 1, 'dashed')); }
      if (I.bands === '1 and 2') { series.push(mk('of-u2', '+2 SD', 2, alpha(I.color, 0.45), 1, 'dotted'), mk('of-l2', '-2 SD', -2, alpha(I.color, 0.45), 1, 'dotted')); }
      this.ctx.emit({ series, tables });
      return;
    }
    // layer-drawn tools: push the inputs + a version; the layer reads flowFor itself
    this.ctx.emit({ tables });
    this.ctx.pushData({ owner: this, root: rootOf(this.ctx), timeframe: this.ctx.timeframe, inputs: I, v: version, vr: this.ctx.bars().length });
  }
}

function frame(canvas, a) {
  const g = canvas && canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!a.data || !a.bars.length) return null;
  const dpr = a.coords.dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}
function idxOf(bars, t) {   // last chart bar with time <= t
  let lo = 0, hi = bars.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}

function bigLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a);
      if (!g) return;
      const d = a.data, co = a.coords;
      const f = flowFor({ root: d.root, timeframe: d.timeframe, bars: a.bars, owner: d.owner });
      if (!f.list || !f.list.length) return;
      const thr = d.inputs.minSize > 0 ? d.inputs.minSize : (f.thr || 1);
      const vr = co.visibleLogicalRange();
      const t0 = a.bars[Math.max(0, Math.floor(vr.from))].time, t1 = a.bars[Math.min(a.bars.length - 1, Math.ceil(vr.to))].time + 1;
      const top = a.bounds.top, bot = top + a.bounds.height;
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const E = replayE();
      for (const b of f.list) {
        if (b.t + 86400000 < t0 || b.t > t1) continue;
        for (const [ms, pi, size, side] of b.bigs) {
          if (size < thr || (E != null && ms > E)) continue;
          const i = idxOf(a.bars, ms);
          if (i < 0) continue;
          const x = co.logicalToX(i), y = co.priceToY(pi * f.tick, a.scale, a.bounds);
          if (y < top - 30 || y > bot + 30) continue;
          const r = clamp(4 * Math.sqrt(size / thr), 4, 26);
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
          g.fillStyle = alpha(side ? UP : DN, 0.32); g.fill();
          g.lineWidth = 1.2; g.strokeStyle = side ? UP2 : '#ff6b7a'; g.stroke();
          if (d.inputs.labels && r >= 10) { g.font = '600 ' + clamp(Math.floor(r * 0.75), 9, 13) + 'px ' + MONO; g.fillStyle = light() ? '#0f172a' : '#f5f5f5'; g.fillText(fmt(size), x, y); }
        }
      }
      g.restore();
    },
    destroy() { canvas = null; }
  };
}

function vpLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a);
      if (!g) return;
      const d = a.data, co = a.coords, I = d.inputs;
      const f = flowFor({ root: d.root, timeframe: d.timeframe, bars: a.bars, owner: d.owner });
      if (!f.list || !f.list.length) return;
      const tick = f.tick, vr = co.visibleLogicalRange();
      const i0 = Math.max(0, Math.floor(vr.from)), i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to));
      const tickPx = Math.abs(co.priceToY(a.scale.min + tick, a.scale, a.bounds) - co.priceToY(a.scale.min, a.scale, a.bounds));
      let m = I.rowTicks || 1;
      if (!I.rowTicks) for (const s of ROW_STEPS) { m = s; if (tickPx * s >= 3) break; }
      const groups = [];
      if (I.range === 'visible') {
        const t0 = a.bars[i0].time, t1 = a.bars[i1].time;
        groups.push({ bars: f.list.filter((b) => b.t >= t0 && b.t <= t1), x0: co.logicalToX(i0), x1: co.width - 60, right: true });
      } else {
        let cur = null;
        for (let i = i0; i <= i1; i++) {
          const fb = f.map.get(a.bars[i].time);
          const k = sessionOf(a.bars[i].time);
          if (!cur || cur.k !== k) { cur = { k, bars: [], x0: co.logicalToX(i) - co.pxPerBar() / 2, x1: 0 }; groups.push(cur); }
          cur.x1 = co.logicalToX(i) + co.pxPerBar() / 2;
          if (fb) cur.bars.push(fb);
        }
      }
      const top = a.bounds.top;
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      for (const gr of groups) {
        const p = profile(gr.bars, m, I.va);
        if (!p) continue;
        let max = 1;
        for (let k = 0; k < p.n; k++) max = Math.max(max, p.buy[k] + p.sell[k]);
        const span = Math.max(20, gr.x1 - gr.x0) * I.widthPct / 100;
        for (let k = 0; k < p.n; k++) {
          const v = p.buy[k] + p.sell[k];
          if (!v) continue;
          const r = p.r0 + k;
          const yT = co.priceToY((r + 1) * m * tick, a.scale, a.bounds), yB = co.priceToY(r * m * tick, a.scale, a.bounds);
          const y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (tickPx * m > 3 ? 1 : 0));
          const inVa = r >= p.val && r <= p.vah;
          const ws = span * p.sell[k] / max, wb = span * p.buy[k] / max;
          const xs = gr.right ? gr.x1 - ws - wb : gr.x0;
          g.fillStyle = alpha(DN, inVa ? 0.55 : 0.28); g.fillRect(xs, y, ws, h);
          g.fillStyle = alpha(UP, inVa ? 0.55 : 0.28); g.fillRect(xs + ws, y, wb, h);
        }
        const line = (r, color, w, dash) => { const y = co.priceToY((r + 0.5) * m * tick, a.scale, a.bounds); g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(gr.x0, y); g.lineTo(gr.x1, y); g.stroke(); };
        line(p.poc, '#f5b301', 1.5, []);
        line(p.vah, alpha(CYAN, 0.8), 1, [4, 3]);
        line(p.val, alpha(CYAN, 0.8), 1, [4, 3]);
        g.setLineDash([]);
      }
      g.restore();
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------- install
let installed = false;
export function installFootprint(Core, flowMod) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: FP_TYPE, placement: 'above-data', create: footprintLayer });
  Core.registerChartType({
    id: FP_TYPE, label: 'Footprint', icon: FP_ICON,
    dataEngine: () => new FootprintEngine(),
    settings: {
      title: 'Footprint',
      rows: [
        { kind: 'select', key: 'fpMode', label: 'Cells show', defval: FP_DEF.fpMode, options: [['bidask', 'Bid x Ask (sell x buy)'], ['delta', 'Delta'], ['volume', 'Volume']] },
        { kind: 'number', key: 'fpImb', label: 'Imbalance ratio %', defval: FP_DEF.fpImb, min: 110, max: 2000, step: 10 },
        { kind: 'number', key: 'fpStack', label: 'Stacked imbalance rows', defval: FP_DEF.fpStack, min: 2, max: 10, step: 1 },
        { kind: 'number', key: 'fpRows', label: 'Row size in ticks (0 = auto by zoom)', defval: FP_DEF.fpRows, min: 0, max: 400, step: 1 },
        { kind: 'toggle', key: 'fpStats', label: 'Delta + volume under each bar', defval: true },
        { kind: 'toggle', key: 'fpPoc', label: 'Highlight the POC', defval: true },
        { kind: 'toggle', key: 'fpUnfinished', label: 'Unfinished-auction marks', defval: true }
      ]
    }
  });
  Core.registerRendererLayer({ id: 'stk_of_big', placement: 'above-data', create: bigLayer });
  Core.registerRendererLayer({ id: 'stk_of_vp', placement: 'below-data', create: vpLayer });
  for (const type of OF_TYPES) {
    const d = IND[type];
    Core.registerNativeIndicator({ type, title: d.title, shortTitle: d.short, paneHint: d.pane, overlay: d.overlay,
      reactsToViewport: type === 'stk_of_vp', inputsSchema: () => d.schema, defaultInputs: () => defaults(d.schema), create: () => new OfNative(type) });
    // the picker group + the "stryker" badge + settings persistence (assets/chart-orderflow.js)
    if (flowMod && Array.isArray(flowMod.OUR_TYPES) && !flowMod.OUR_TYPES.includes(type)) flowMod.OUR_TYPES.push(type);
  }
}
export const FP_DISCLAIMER = DISCLAIMER;
// Read-only handle for the browser suite (tools/tests/chart-footprint-browser.js) and debugging.
if (typeof window !== 'undefined') {
  window.__stkOrderflow = {
    minuteBars: (root, from, to) => minuteBars(root, from, to, false).bars,
    loaded: (root) => { const s = stores.get(root); return s ? [...s.days.entries()].map(([d, e]) => ({ d, n: e.bars ? e.bars.length : -1, err: e.err })) : []; },
    aggregate, rows, poc, tier: () => testTier() || tierNow, sessionOf, get version() { return version; }
  };
}
