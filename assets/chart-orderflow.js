// TradeZoro — Charts: volume and order-flow tools (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls installOrderflow(Core) BEFORE the workspace is
// built, so persisted sessions can restore these indicators, and mountOrderflow(ws, ...)
// after); Vela 0.6.17's plugin SDK (registerNativeIndicator, registerRendererLayer,
// registerStatePersistence), passed in as `Core` (the self-hosted index.js).
//
// WHAT THIS ADDS (Owner order 2026-10-05, "order-flow indicators or tools like volume profile"):
// a "Volume & Order flow" group at the top of Vela's Indicators picker with:
//   - Vela's own natives: Volume, Visible Range Volume Profile, VWAP (listed again under the group).
//   - Session Volume Profile (ours): one profile per session, POC + 70% value area.
//   - Previous Day POC / VAH / VAL (ours): the same definition as the GEX page's pPOC / pVAH /
//     pVAL (functions/api/gex/_engine.js volumeProfile + sessionLevels: prior RTH session
//     09:30-16:00 New York, 5-minute bars, rows of 4 ticks, 70% value area grown from the POC
//     toward the larger neighbour), computed from this chart's bars.
//   - Anchored VWAP with ±1/2/3 standard-deviation bands (ours; click a bar to anchor).
//   - Fixed Range Volume Profile: Vela's own drawing tool (the picker row arms it).
//   - Relative Volume (ours): bar volume / average volume at the same time of day.
//   - Volume Bubble / Big Prints (ours): bubbles on high-volume bars, built from the chart feed volume.
//   - Volume Heatmap (ours): horizontal price-level heatmap from volume-at-price, like resting-order zones.
//   - Liquidity Trend Heatmap (ours): 26-row volume-at-price heat zones, POC and trend baseline.
//   - Crypto DOM Heatmap (ours): resting Binance order-book liquidity at price levels for crypto
//     symbols (Style: Combined heatmap + depth bars + walls, Heatmap only, Depth bars only, Walls only).
//   - Estimated CVD (from candles) (ours, off by default): NOT real order flow. Each candle's
//     volume is split by where it closed in its range. Always labelled "Estimated".
// Everything above is computed from OHLCV bars, so it is honest on every feed. Real order-flow
// tools (Footprint, Delta per bar, CVD from real trades, diagonal imbalances) live in the REAL
// ORDER FLOW section: Binance aggTrades for crypto now; futures only via a registered trade
// source (the member's Rithmic connection), else they say "Connect Rithmic (coming soon)".
//
// All volume numbers are whatever the feed reports (Yahoo futures volume, exchange volume
// for crypto). Nothing here predicts anything. Education only. Not financial advice.

import { deepColor, DEEP_RAMP, tradedAt, vanishKind, icebergEvents } from './chart-liquidity-data.js?v=717';
import { cryptoFeed } from './chart-footprint-crypto.js?v=717';
import * as ProGate from './chart-pro-gate.js?v=717';

const GROUP = 'Volume';   // Owner order 2026-10-28: order-flow tools moved to the Order Flow section; this is volume only
const NY_TZ = 'America/New_York';
const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;
const ETH_OPEN = 18 * 60;
const PREV_COLOR = '#38bdf8'; // the GEX page's pPOC/pVAH/pVAL colour (assets/gex.js)

// Futures tick sizes for our roots (CME specs). Used for profile row sizes.
export const TICK = {
  NQ: 0.25, MNQ: 0.25, ES: 0.25, MES: 0.25, RTY: 0.1, M2K: 0.1, YM: 1, MYM: 1,
  GC: 0.1, MGC: 0.1, SI: 0.005, CL: 0.01, MCL: 0.01, NG: 0.001, '6E': 0.00005,
  ZN: 0.015625, ZB: 0.03125
};

// ---------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d) => (typeof v === 'string' && v !== '' ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function tfMinutes(tf) {
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) return +tf;
  const m = /^(\d+)([SDWM])$/i.exec(tf) || /^([DWM])$/i.exec(tf);
  if (!m) return null;
  const n = m.length === 3 ? +m[1] : 1;
  const u = (m.length === 3 ? m[2] : m[1]).toUpperCase();
  if (u === 'S') return n / 60;
  if (u === 'D') return n * 1440;
  if (u === 'W') return n * 10080;
  return n * 43200;
}

// The market a chart shows: 'futures' (our Yahoo/Rithmic provider) or a crypto venue.
function marketOf(ctx) {
  let provider = '', ticker = String(ctx.symbol || '');
  try { const r = ctx.data.resolve(ctx.symbol); if (r) { provider = r.provider; ticker = r.ticker; } } catch (e) {}
  if (!provider) { const m = /^([a-z]+):(.+)$/i.exec(ticker); if (m) { provider = m[1].toLowerCase(); ticker = m[2]; } }
  const root = ticker.toUpperCase().replace(/1!$/, '').replace(/[0-9]!$/, '');
  const futures = provider === 'futures';
  return { provider, ticker, root, futures, tick: futures ? (TICK[root] || null) : null };
}

// New York wall-clock parts for an epoch-ms time; the UTC offset is cached per hour.
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const nyOff = new Map();
function nyOffsetMin(ms) {
  const h = Math.floor(ms / 3600000);
  let o = nyOff.get(h);
  if (o === undefined) {
    const p = {};
    nyFmt.formatToParts(new Date(h * 3600000)).forEach((x) => { p[x.type] = x.value; });
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    o = Math.round((asUtc - h * 3600000) / 60000);
    if (nyOff.size > 5000) nyOff.clear();
    nyOff.set(h, o);
  }
  return o;
}
// { day: 'YYYY-MM-DD' (NY date), min: minute of the NY day }
function nyParts(ms) {
  const local = ms + nyOffsetMin(ms) * 60000;
  const d = new Date(local);
  return { day: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const nextDay = (day) => new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Session key of a bar, or null when the bar is outside the chosen session.
//   rth: 09:30-16:00 NY.  eth: the overnight part (18:00 -> 09:30, keyed to the day it ends).
//   both: RTH and overnight as separate profiles.  day: the full CME trading day (18:00 -> 17:00).
// Crypto has no sessions: every mode becomes the UTC day.
function sessionKey(ms, mode, futures) {
  if (!futures) return utcDay(ms);
  const p = nyParts(ms);
  const rth = p.min >= RTH_OPEN && p.min < RTH_CLOSE;
  if (mode === 'rth') return rth ? p.day + 'R' : null;
  const ethDay = p.min >= ETH_OPEN ? nextDay(p.day) : p.day;
  const inEth = p.min >= ETH_OPEN || p.min < RTH_OPEN;
  if (mode === 'eth') return inEth ? ethDay + 'E' : null;
  if (mode === 'both') return rth ? p.day + 'R' : (inEth ? ethDay + 'E' : null);
  return ethDay + 'D';
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

// Volume profile — the GEX engine's algorithm (functions/api/gex/_engine.js volumeProfile):
// each bar's volume is spread evenly over the price rows its high-low range touches; the POC
// is the biggest row; the value area grows from the POC one row at a time toward the bigger
// neighbour (ties go up) until it holds `va` of the total. Rows are keyed by their price
// (row start rounded to the step), exactly like the GEX page.
export function volumeProfile(bars, step, va) {
  if (!bars.length || !(step > 0)) return null;
  const useVol = bars.some((b) => (b.volume || 0) > 0);
  const buckets = new Map();
  for (const r of bars) {
    const lo = Math.min(r.low, r.high), hi = Math.max(r.low, r.high);
    const n = Math.max(1, Math.round((hi - lo) / step) + 1);
    const w = (useVol ? (r.volume || 0) : 1) / n;
    for (let i = 0; i < n; i++) {
      const p = Math.round(Math.round((lo + i * step) / step) * step * 1e6) / 1e6;
      buckets.set(p, (buckets.get(p) || 0) + w);
    }
  }
  if (!buckets.size) return null;
  const prices = [...buckets.keys()].sort((a, b) => a - b);
  let poc = prices[0];
  for (const p of prices) if (buckets.get(p) > buckets.get(poc)) poc = p;
  let total = 0; buckets.forEach((v) => { total += v; });
  const target = total * va;
  let i = prices.indexOf(poc), lo = i, hi = i, acc = buckets.get(poc);
  while (acc < target && (lo > 0 || hi < prices.length - 1)) {
    const down = lo > 0 ? buckets.get(prices[lo - 1]) : -1;
    const up = hi < prices.length - 1 ? buckets.get(prices[hi + 1]) : -1;
    if (up >= down) { hi++; acc += up; } else { lo--; acc += down; }
  }
  let max = 0; buckets.forEach((v) => { if (v > max) max = v; });
  return { prices, buckets, poc, vah: prices[hi], val: prices[lo], step, max, useVol };
}

function themeIsLight(theme) {
  const bg = String((theme && theme.background) || '').toLowerCase();
  return bg === '#ffffff' || bg === '#fff' || bg === 'white' || /^#f[0-9a-f]{5}$/.test(bg);
}
// The page theme (theme.js sets data-theme="light" for day). Used for on-chart labels.
function pageIsDay() {
  try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; }
}
function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
// Prepare a layer canvas for one frame in media px. Returns the 2d context or null.
function beginFrame(canvas, coords) {
  const ctx = canvas && canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = coords.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
function message(id, text, light, pos) {
  return {
    id, paneId: '', position: pos || 'bottom_center', columns: 1, rows: 1,
    bgColor: light ? 'rgba(255,255,255,0.9)' : 'rgba(15,15,15,0.85)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: light ? '#334155' : '#cbd5e1', hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'default', bold: false, italic: false }]],
    merges: []
  };
}
const line = (id, title, bars, values, color, width, style) => ({
  id, title, paneId: '', kind: 'line',
  points: bars.map((b, i) => ({ time: b.time, value: values[i] != null && Number.isFinite(values[i]) ? values[i] : null })),
  style: { color, width: width || 1, lineStyle: style || 'solid' }
});

// ---------------------------------------------------------------------------------------
// Session Volume Profile (native indicator + renderer layer 'stk_svp')
// ---------------------------------------------------------------------------------------
const SVP_DEF = { session: 'rth', rowTicks: 4, rows: 40, valueAreaPct: 70, widthPct: 40, showVa: true, showPoc: true,
  color: '#5b9cf6', vaColor: '#5b9cf6', pocColor: '#ff9800' };
const SVP_SCHEMA = [
  { key: 'session', title: 'Sessions (futures)', type: 'string', defval: SVP_DEF.session, options: ['rth', 'eth', 'both', 'day'],
    tooltip: 'rth = 09:30-16:00 New York; eth = overnight 18:00-09:30; both = RTH and overnight separately; day = the full 18:00-17:00 trading day. Crypto always uses the UTC day.' },
  { key: 'rowTicks', title: 'Row size (ticks, futures)', type: 'int', defval: SVP_DEF.rowTicks, min: 1, max: 400, step: 1 },
  { key: 'rows', title: 'Rows per session (crypto)', type: 'int', defval: SVP_DEF.rows, min: 6, max: 200, step: 1 },
  { key: 'valueAreaPct', title: 'Value area %', type: 'int', defval: SVP_DEF.valueAreaPct, min: 10, max: 100, step: 1 },
  { key: 'widthPct', title: 'Width % of the session', type: 'int', defval: SVP_DEF.widthPct, min: 10, max: 100, step: 1 },
  { key: 'showVa', title: 'Value area lines (VAH / VAL)', type: 'bool', defval: true },
  { key: 'showPoc', title: 'Point of control (POC)', type: 'bool', defval: true },
  { key: 'color', title: 'Profile colour', type: 'color', defval: SVP_DEF.color },
  { key: 'vaColor', title: 'Value area colour', type: 'color', defval: SVP_DEF.vaColor },
  { key: 'pocColor', title: 'POC colour', type: 'color', defval: SVP_DEF.pocColor }
];
const svpConfig = (inputs, mk) => ({
  session: ['rth', 'eth', 'both', 'day'].includes(inputs.session) ? inputs.session : 'rth',
  rowTicks: clamp(Math.round(num(inputs.rowTicks, 4)), 1, 400),
  rows: clamp(Math.round(num(inputs.rows, 40)), 6, 200),
  va: clamp(num(inputs.valueAreaPct, 70), 10, 100) / 100,
  widthFrac: clamp(num(inputs.widthPct, 40), 10, 100) / 100,
  showVa: inputs.showVa !== false, showPoc: inputs.showPoc !== false,
  color: str(inputs.color, SVP_DEF.color), vaColor: str(inputs.vaColor, SVP_DEF.vaColor), pocColor: str(inputs.pocColor, SVP_DEF.pocColor),
  futures: !!mk.futures, tick: mk.tick || null, tf: mk.tf
});

class LayerNative {
  constructor(build) { this.build = build; this.inputs = {}; this.ctx = null; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; this.push(); }
  push() {
    const mk = marketOf(this.ctx); mk.tf = tfMinutes(this.ctx.timeframe);
    const out = this.build(this.inputs, mk, this.ctx);
    this.ctx.emit(out.emit || {});
    this.ctx.pushData(out.data);
  }
  onBars() {}
  onViewport() {}
  setInputs(inputs) { this.inputs = inputs; this.push(); }
  suspend() {}
  resume() { this.push(); }
  stop() {}
}

function svpBuild(inputs, mk) {
  const cfg = svpConfig(inputs, mk);
  if (cfg.tf != null && cfg.tf >= 1440) return { data: { off: true }, emit: { tables: [message('stk_svp-msg', 'Session Volume Profile works on intraday charts (1m to 4h).', pageIsDay())] } };
  return { data: cfg, emit: {} };
}

// Profiles per session, recomputed only when the bars change (the forming bar recomputes
// just its own session).
function computeSessions(bars, cfg, cache) {
  const sig = cfg.session + '|' + cfg.rowTicks + '|' + cfg.rows + '|' + cfg.va + '|' + cfg.futures + '|' + cfg.tick;
  const n = bars.length;
  if (!n) return [];
  const first = bars[0].time, last = bars[n - 1];
  const sameSet = cache.sig === sig && cache.first === first && cache.n === n;
  const lastSig = last.time + ':' + last.high + ':' + last.low + ':' + last.volume;
  if (sameSet && cache.lastSig === lastSig) return cache.sessions;
  let sessions;
  if (sameSet || (cache.sig === sig && cache.first === first && cache.n === n - 1 && cache.sessions.length)) {
    // only the newest session can change
    sessions = cache.sessions.slice(0, -1);
    const prevLast = cache.sessions[cache.sessions.length - 1];
    sessions.push(...groupSessions(bars, cfg, prevLast.i0));
  } else sessions = groupSessions(bars, cfg, 0);
  cache.sig = sig; cache.first = first; cache.n = n; cache.lastSig = lastSig; cache.sessions = sessions;
  return sessions;
}
function groupSessions(bars, cfg, from) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const span = bars.slice(cur.i0, cur.i1 + 1).filter((b, k) => cur.keep[k]);
    let step;
    if (cfg.futures && cfg.tick) step = cfg.tick * cfg.rowTicks;
    else {
      let hi = -Infinity, lo = Infinity;
      span.forEach((b) => { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; });
      step = niceStep((hi - lo) / cfg.rows);
    }
    const prof = volumeProfile(span, step, cfg.va);
    if (prof) out.push({ key: cur.key, i0: cur.i0, i1: cur.i1, t0: span[0].time, t1: span[span.length - 1].time, prof });
    cur = null;
  };
  for (let i = from; i < bars.length; i++) {
    const k = sessionKey(bars[i].time, cfg.session, cfg.futures);
    if (cur && k === cur.key) { cur.i1 = i; cur.keep.push(true); continue; }
    if (k === null) { if (cur) { cur.i1 = i; cur.keep.push(false); } continue; }
    flush();
    cur = { key: k, i0: i, i1: i, keep: [true] };
  }
  flush();
  // trailing excluded bars do not belong to the session
  return out;
}

function svpLayer() {
  let canvas = null;
  const cache = {};
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = beginFrame(canvas, a.coords);
      if (!g) return;
      const cfg = a.data;
      if (!cfg || cfg.off || !a.bars.length) return;
      const sessions = computeSessions(a.bars, cfg, cache);
      const co = a.coords, W = co.width;
      const half = co.pxPerBar() / 2;
      const top = a.bounds.top, bot = a.bounds.top + a.bounds.height;
      g.save();
      g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      const light = themeIsLight(a.theme);
      for (const s of sessions) {
        const x0 = co.timeToX(s.t0) - half, x1 = co.timeToX(s.t1) + half;
        if (x1 < 0 || x0 > W) continue;
        const p = s.prof;
        const maxW = Math.max(4, (x1 - x0) * cfg.widthFrac);
        for (const price of p.prices) {
          const v = p.buckets.get(price);
          const yA = co.priceToY(price + p.step, a.scale, a.bounds), yB = co.priceToY(price, a.scale, a.bounds);
          const y = Math.min(yA, yB), h = Math.max(1, Math.abs(yB - yA) - (Math.abs(yB - yA) > 3 ? 1 : 0));
          if (y > bot || y + h < top) continue;
          const inVa = price >= p.val && price <= p.vah;
          g.fillStyle = alpha(inVa ? cfg.vaColor : cfg.color, inVa ? (light ? 0.38 : 0.42) : (light ? 0.16 : 0.18));
          g.fillRect(x0, y, maxW * (v / p.max), h);
        }
        const hl = (price, color, dash) => {
          const y = Math.round(co.priceToY(price, a.scale, a.bounds)) + 0.5;
          g.strokeStyle = color; g.lineWidth = 1; g.setLineDash(dash || []);
          g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
        };
        // lines sit at the middle of their row, like the GEX page's level prices
        if (cfg.showVa) { hl(p.vah + p.step, alpha(cfg.vaColor, 0.85), [4, 3]); hl(p.val, alpha(cfg.vaColor, 0.85), [4, 3]); }
        if (cfg.showPoc) hl(p.poc + p.step / 2, cfg.pocColor);
      }
      g.setLineDash([]);
      g.restore();
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------------------------------
// Previous Day POC / VAH / VAL (series-free native: price lines)
// ---------------------------------------------------------------------------------------
const PD_SCHEMA = [
  { key: 'rowTicks', title: 'Row size (ticks, futures)', type: 'int', defval: 4, min: 1, max: 400, step: 1, tooltip: 'The GEX page uses 4 ticks.' },
  { key: 'valueAreaPct', title: 'Value area %', type: 'int', defval: 70, min: 10, max: 100, step: 1 },
  { key: 'color', title: 'Colour', type: 'color', defval: PREV_COLOR },
  { key: 'showPoc', title: 'pPOC', type: 'bool', defval: true },
  { key: 'showVa', title: 'pVAH / pVAL', type: 'bool', defval: true }
];
// 1m bars are rolled up to 5m first so the result matches the GEX page's 5-minute calc.
function to5m(bars) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.time / 300000) * 300000;
    const l = out[out.length - 1];
    if (l && l.time === t) { l.high = Math.max(l.high, b.high); l.low = Math.min(l.low, b.low); l.close = b.close; l.volume += b.volume || 0; }
    else out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 });
  }
  return out;
}
export function priorDayLevels(bars, mk, rowTicks, va) {
  if (!bars.length) return null;
  const tf = mk.tf;
  if (tf == null || tf > 60) return { err: 'Previous day levels need an intraday chart (1m to 1h).' };
  const src = tf < 5 ? to5m(bars) : bars;
  let groups = new Map(), order = [];
  const last = src[src.length - 1].time;
  const today = mk.futures ? nyParts(last).day : utcDay(last);
  for (const b of src) {
    let k;
    if (mk.futures) { const p = nyParts(b.time); if (p.min < RTH_OPEN || p.min >= RTH_CLOSE) continue; k = p.day; }
    else k = utcDay(b.time);
    if (k >= today) continue;
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(b);
  }
  const minBars = Math.max(3, Math.floor(60 / Math.max(5, tf)) * 1);
  let day = null;
  for (let i = order.length - 1; i >= 0; i--) if (groups.get(order[i]).length > Math.min(10, minBars * 2)) { day = order[i]; break; }
  if (!day) return { err: 'Not enough history for the previous session yet.' };
  const rows = groups.get(day);
  let step;
  if (mk.futures && mk.tick) step = mk.tick * rowTicks;
  else { let hi = -Infinity, lo = Infinity; rows.forEach((b) => { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); }); step = niceStep((hi - lo) / 50); }
  const p = volumeProfile(rows, step, va);
  if (!p) return { err: 'No volume in the previous session.' };
  return { day, poc: p.poc, vah: p.vah, val: p.val, useVol: p.useVol };
}
class PrevDayNative {
  constructor() { this.inputs = {}; this.sig = ''; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; this.compute(true); }
  onBars() { this.compute(false); }
  onViewport() {}
  setInputs(i) { this.inputs = i; this.compute(true); }
  suspend() {}
  resume() { this.compute(true); }
  stop() {}
  compute(force) {
    const bars = this.ctx.bars();
    if (!bars.length) return;
    const mk = marketOf(this.ctx); mk.tf = tfMinutes(this.ctx.timeframe);
    const sig = bars.length + ':' + bars[0].time + ':' + (mk.futures ? nyParts(bars[bars.length - 1].time).day : utcDay(bars[bars.length - 1].time));
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const r = priorDayLevels(bars, mk, clamp(Math.round(num(this.inputs.rowTicks, 4)), 1, 400), clamp(num(this.inputs.valueAreaPct, 70), 10, 100) / 100);
    const color = str(this.inputs.color, PREV_COLOR);
    if (!r || r.err) { if (r && r.err && document.documentElement.hasAttribute('data-stk-rh')) { this.ctx.emit({ priceLines: [], tables: [] }); return; }   // admin: hide replay markings (recording)
      this.ctx.emit({ priceLines: [], tables: [message('stk_pdvp-msg', (r && r.err) || 'Waiting for bars.', pageIsDay(), 'top_right')] }); return; }
    const lines = [];
    if (this.inputs.showVa !== false) {
      lines.push({ id: 'stk_pdvp-vah', paneId: '', price: r.vah, color, lineStyle: 'dashed', width: 1, title: 'pVAH' });
      lines.push({ id: 'stk_pdvp-val', paneId: '', price: r.val, color, lineStyle: 'dashed', width: 1, title: 'pVAL' });
    }
    if (this.inputs.showPoc !== false) lines.push({ id: 'stk_pdvp-poc', paneId: '', price: r.poc, color, lineStyle: 'solid', width: 1, title: 'pPOC' });
    this.ctx.emit({ priceLines: lines, tables: [] });
  }
}

// ---------------------------------------------------------------------------------------
// Anchored VWAP with ±1/2/3 sd bands
// ---------------------------------------------------------------------------------------
const AV_SCHEMA = [
  { key: 'anchor', title: 'Anchor (bar time)', type: 'time', defval: 0, tooltip: 'Empty = the start of the latest session. Use the picker row "click a bar" to set it on the chart.' },
  { key: 'b1', title: 'Band ±1 sd', type: 'bool', defval: true },
  { key: 'b2', title: 'Band ±2 sd', type: 'bool', defval: true },
  { key: 'b3', title: 'Band ±3 sd', type: 'bool', defval: true },
  { key: 'color', title: 'VWAP colour', type: 'color', defval: '#5b9cf6' },
  { key: 'bandColor', title: 'Band colour', type: 'color', defval: '#9aa0ad' }
];
function sessionStart(bars, futures) {
  if (!bars.length) return 0;
  const k = sessionKey(bars[bars.length - 1].time, 'day', futures);
  let i = bars.length - 1;
  while (i > 0 && sessionKey(bars[i - 1].time, 'day', futures) === k) i--;
  return bars[i].time;
}
export function anchoredVwap(bars, anchor) {
  const n = bars.length, mid = new Array(n).fill(null), sd = new Array(n).fill(null);
  let w = 0, pv = 0, p2v = 0;
  const useVol = bars.some((b) => (b.volume || 0) > 0);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (b.time < anchor) continue;
    const tp = (b.high + b.low + b.close) / 3, v = useVol ? Math.max(0, b.volume || 0) : 1;
    w += v; pv += tp * v; p2v += tp * tp * v;
    const m = w > 0 ? pv / w : tp;
    mid[i] = m; sd[i] = w > 0 ? Math.sqrt(Math.max(0, p2v / w - m * m)) : 0;
  }
  return { mid, sd };
}
let avSeq = 0;
class AvwapNative {
  constructor() { this.inputs = {}; this.tm = 0; this.uid = 'stk_avwap' + (++avSeq); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; this.compute(); }
  onBars() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.compute(); }, 120); }
  onViewport() {}
  setInputs(i) { this.inputs = i; this.compute(); }
  suspend() { clearTimeout(this.tm); this.tm = 0; }
  resume() { this.compute(); }
  stop() { this.suspend(); }
  compute() {
    const bars = this.ctx.bars();
    if (!bars.length) return;
    const mk = marketOf(this.ctx);
    const anchor = num(this.inputs.anchor, 0) > 0 ? this.inputs.anchor : sessionStart(bars, mk.futures);
    const { mid, sd } = anchoredVwap(bars, anchor);
    const c = str(this.inputs.color, '#5b9cf6'), bc = str(this.inputs.bandColor, '#9aa0ad');
    const u = this.uid;
    const series = [line(u + '-mid', 'VWAP', bars, mid, c, 2)];
    const fills = [];
    [1, 2, 3].forEach((k) => {
      if (this.inputs['b' + k] === false) return;
      series.push(line(u + '-u' + k, '+' + k + ' sd', bars, mid.map((m, i) => (m == null ? null : m + k * sd[i])), alpha(bc, 0.9 - k * 0.15), 1, k === 1 ? 'solid' : 'dashed'));
      series.push(line(u + '-l' + k, '-' + k + ' sd', bars, mid.map((m, i) => (m == null ? null : m - k * sd[i])), alpha(bc, 0.9 - k * 0.15), 1, k === 1 ? 'solid' : 'dashed'));
    });
    if (this.inputs.b1 !== false) fills.push({ id: u + '-f1', paneId: '', fromSeriesId: u + '-u1', toSeriesId: u + '-l1', color: alpha(c, 0.08) });
    this.ctx.emit({ series, fills });
  }
}

// ---------------------------------------------------------------------------------------
// Relative Volume
// ---------------------------------------------------------------------------------------
const RV_SCHEMA = [
  { key: 'days', title: 'Lookback (sessions / bars)', type: 'int', defval: 10, min: 2, max: 60, step: 1, tooltip: 'Intraday: the average volume of the same time of day over this many earlier days. Daily and above: a simple average of this many bars.' },
  { key: 'high', title: 'Highlight at or above (x)', type: 'float', defval: 2, min: 1, max: 20, step: 0.1 },
  { key: 'color', title: 'Colour', type: 'color', defval: '#787b86' },
  { key: 'hiColor', title: 'Highlight colour', type: 'color', defval: '#ff9800' }
];
export function relativeVolume(bars, tfMin, n) {
  const out = new Array(bars.length).fill(null);
  if (tfMin != null && tfMin < 1440) {
    const byTod = new Map();
    for (let i = 0; i < bars.length; i++) {
      const tod = bars[i].time % 86400000;
      const arr = byTod.get(tod) || [];
      if (arr.length >= 3) { const s = arr.slice(-n); const avg = s.reduce((x, y) => x + y, 0) / s.length; out[i] = avg > 0 ? (bars[i].volume || 0) / avg : null; }
      arr.push(bars[i].volume || 0);
      if (arr.length > n + 2) arr.shift();
      byTod.set(tod, arr);
    }
    // not enough same-time history (e.g. a short chart): fall back to a rolling average
    for (let i = 0; i < bars.length; i++) if (out[i] == null && i >= n) {
      let s = 0; for (let k = i - n; k < i; k++) s += bars[k].volume || 0;
      out[i] = s > 0 ? (bars[i].volume || 0) / (s / n) : null;
    }
  } else {
    for (let i = n; i < bars.length; i++) { let s = 0; for (let k = i - n; k < i; k++) s += bars[k].volume || 0; out[i] = s > 0 ? (bars[i].volume || 0) / (s / n) : null; }
  }
  return out;
}
class RvolNative {
  constructor() { this.inputs = {}; this.tm = 0; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; this.compute(); }
  onBars() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.compute(); }, 250); }
  onViewport() {}
  setInputs(i) { this.inputs = i; this.compute(); }
  suspend() { clearTimeout(this.tm); this.tm = 0; }
  resume() { this.compute(); }
  stop() { this.suspend(); }
  compute() {
    const bars = this.ctx.bars();
    const rv = relativeVolume(bars, tfMinutes(this.ctx.timeframe), clamp(Math.round(num(this.inputs.days, 10)), 2, 60));
    const hi = num(this.inputs.high, 2), c = str(this.inputs.color, '#787b86'), hc = str(this.inputs.hiColor, '#ff9800');
    const s = {
      id: 'stk_rvol-h', title: 'RVOL', paneId: '', kind: 'histogram',
      points: bars.map((b, i) => (rv[i] == null ? { time: b.time, value: null } : { time: b.time, value: Math.round(rv[i] * 100) / 100, color: rv[i] >= hi ? hc : c })),
      style: { color: c, width: 1, lineStyle: 'solid', base: 0 }
    };
    this.ctx.emit({ series: [s], priceLines: [{ id: 'stk_rvol-1', paneId: '', price: 1, color: '#787b86', lineStyle: 'dotted', width: 1 }] });
  }
}

// ---------------------------------------------------------------------------------------
// Volume Bubble / Big Prints — high-volume bubbles from chart-feed volume
// ---------------------------------------------------------------------------------------
const VB_SCHEMA = [
  { key: 'lookback', title: 'Average lookback', type: 'int', defval: 50, min: 5, max: 500, step: 1 },
  { key: 'threshold', title: 'Show above (x avg volume)', type: 'float', defval: 2, min: 1, max: 20, step: 0.1 },
  { key: 'maxBubbles', title: 'Max bubbles on screen', type: 'int', defval: 80, min: 10, max: 300, step: 5 },
  { key: 'minSize', title: 'Min bubble size', type: 'int', defval: 8, min: 3, max: 40, step: 1 },
  { key: 'maxSize', title: 'Max bubble size', type: 'int', defval: 42, min: 8, max: 120, step: 1 },
  { key: 'showLabels', title: 'Show size labels', type: 'bool', defval: true },
  { key: 'buyColor', title: 'Up candle colour', type: 'color', defval: '#22c55e' },
  { key: 'sellColor', title: 'Down candle colour', type: 'color', defval: '#ef4444' }
];
function vbConfig(inputs) {
  const minSize = clamp(Math.round(num(inputs.minSize, 8)), 3, 40);
  return {
    lookback: clamp(Math.round(num(inputs.lookback, 50)), 5, 500),
    threshold: clamp(num(inputs.threshold, 2), 1, 20),
    maxBubbles: clamp(Math.round(num(inputs.maxBubbles, 80)), 10, 300),
    minSize,
    maxSize: Math.max(minSize + 2, clamp(Math.round(num(inputs.maxSize, 42)), 8, 120)),
    showLabels: inputs.showLabels !== false,
    buy: str(inputs.buyColor, '#22c55e'),
    sell: str(inputs.sellColor, '#ef4444')
  };
}
function volumeBubbleLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = beginFrame(canvas, a.coords);
      if (!g || !a.data || a.data.off || !a.bars.length) return;
      const cfg = a.data, co = a.coords;
      const vr = co.visibleLogicalRange();
      const i0 = Math.max(0, Math.floor(vr.from) - cfg.lookback - 2);
      const i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to) + 2);
      const pts = [];
      for (let i = i0; i <= i1; i++) {
        const b = a.bars[i];
        const v = Number(b.volume || 0);
        if (!(v > 0) || i < cfg.lookback) continue;
        let sum = 0, n = 0;
        for (let k = Math.max(0, i - cfg.lookback); k < i; k++) { const x = Number(a.bars[k].volume || 0); if (x > 0) { sum += x; n++; } }
        const avg = n ? sum / n : 0;
        if (!(avg > 0)) continue;
        const ratio = v / avg;
        if (ratio < cfg.threshold) continue;
        pts.push({ i, b, v, ratio });
      }
      pts.sort((x, y) => y.ratio - x.ratio);
      const keep = new Set(pts.slice(0, cfg.maxBubbles).map(x => x.i));
      const draw = pts.filter(x => keep.has(x.i)).sort((x, y) => x.i - y.i);
      const light = themeIsLight(a.theme);
      const top = a.bounds.top, bot = top + a.bounds.height;
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const x of draw) {
        const b = x.b;
        const cx = co.logicalToX(x.i);
        const price = b.close >= b.open ? b.high : b.low;
        const cy = co.priceToY(price, a.scale, a.bounds);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || cy < top - 80 || cy > bot + 80) continue;
        const t = Math.min(1, Math.log(x.ratio / cfg.threshold + 1) / Math.log(6));
        const r = cfg.minSize + (cfg.maxSize - cfg.minSize) * t;
        const col = b.close >= b.open ? cfg.buy : cfg.sell;
        g.fillStyle = alpha(col, light ? 0.24 : 0.32);
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = alpha(col, light ? 0.82 : 0.95); g.lineWidth = Math.max(1, Math.min(3, r / 12));
        g.stroke();
        if (cfg.showLabels && r >= 10) {
          g.font = 'bold ' + clamp(Math.round(r * 0.42), 8, 14) + 'px ' + ((a.theme && a.theme.fontFamily) || 'sans-serif');
          g.fillStyle = light ? '#0f172a' : '#f8fafc';
          const label = x.ratio >= 10 ? x.ratio.toFixed(0) + 'x' : x.ratio.toFixed(1) + 'x';
          g.fillText(label, cx, cy);
        }
      }
      g.restore();
    },
    destroy() { canvas = null; }
  };
}
function vbBuild(inputs, mk, ctx) {
  const bars = ctx.bars();
  if (!bars.some(b => (b.volume || 0) > 0)) return { data: { off: true }, emit: { tables: [message('stk_vb-msg', 'Volume Bubble needs bars with volume.', pageIsDay())] } };
  return { data: vbConfig(inputs), emit: {} };
}

// ---------------------------------------------------------------------------------------
// Volume Heatmap — horizontal price-level volume intensity shaded behind price
// ---------------------------------------------------------------------------------------
const VH_SCHEMA = [
  { key: 'lookback', title: 'Average lookback', type: 'int', defval: 50, min: 5, max: 500, step: 1 },
  { key: 'threshold', title: 'Show rows above (% of max)', type: 'float', defval: 8, min: 1, max: 80, step: 1 },
  { key: 'rowTicks', title: 'Row size (ticks, futures)', type: 'int', defval: 4, min: 1, max: 200, step: 1 },
  { key: 'opacity', title: 'Max opacity %', type: 'int', defval: 42, min: 5, max: 85, step: 1 },
  { key: 'mode', title: 'Colour mode', type: 'string', defval: 'candle direction', options: ['candle direction', 'single colour'] },
  { key: 'upColor', title: 'Up heat colour', type: 'color', defval: '#03c988' },
  { key: 'downColor', title: 'Down heat colour', type: 'color', defval: '#e5484d' },
  { key: 'heatColor', title: 'Single heat colour', type: 'color', defval: '#38bdf8' }
];
function vhConfig(inputs) {
  const threshold = clamp(num(inputs.threshold, 8), 1, 80) / 100;
  return {
    lookback: clamp(Math.round(num(inputs.lookback, 50)), 5, 500),
    threshold,
    rowTicks: clamp(Math.round(num(inputs.rowTicks, 4)), 1, 200),
    opacity: clamp(num(inputs.opacity, 42), 5, 85) / 100,
    mode: inputs.mode === 'single colour' ? 'single' : 'direction',
    up: str(inputs.upColor, '#03c988'),
    down: str(inputs.downColor, '#e5484d'),
    heat: str(inputs.heatColor, '#38bdf8')
  };
}
function volumeHeatmapLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = beginFrame(canvas, a.coords);
      if (!g || !a.data || a.data.off || !a.bars.length) return;
      const cfg = a.data, co = a.coords;
      const vr = co.visibleLogicalRange();
      const i0 = Math.max(0, Math.floor(vr.from) - cfg.lookback - 2);
      const i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to) + 2);
      const top = a.bounds.top, bot = top + a.bounds.height;
      const midP = (a.scale.min + a.scale.max) / 2;
      let step = cfg.tick ? cfg.tick * cfg.rowTicks : null;
      if (!(step > 0)) {
        const span = Math.max(1e-9, a.scale.max - a.scale.min);
        step = niceStep(span / 80);
      }
      const pxStep = Math.abs(co.priceToY(midP + step, a.scale, a.bounds) - co.priceToY(midP, a.scale, a.bounds));
      let mult = 1;
      while (pxStep * mult < 3 && mult < 1000) mult *= 2;
      step *= mult;
      const buckets = new Map();
      let max = 0;
      for (let i = i0; i <= i1; i++) {
        const b = a.bars[i];
        const v = Number(b.volume || 0);
        if (!(v > 0)) continue;
        const lo = Math.min(b.low, b.high), hi = Math.max(b.low, b.high);
        const n = Math.max(1, Math.round((hi - lo) / step) + 1);
        const share = v / n;
        const dir = b.close >= b.open ? 1 : -1;
        for (let k = 0; k < n; k++) {
          const price = Math.round(Math.round((lo + k * step) / step) * step * 1e8) / 1e8;
          let row = buckets.get(price);
          if (!row) { row = { vol: 0, delta: 0 }; buckets.set(price, row); }
          row.vol += share;
          row.delta += share * dir;
          if (row.vol > max) max = row.vol;
        }
      }
      if (!(max > 0)) return;
      g.save();
      g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      const xLeft = Math.max(0, co.logicalToX(Math.max(0, i0)) || 0);
      const xRight = Math.min(co.width, co.logicalToX(Math.min(a.bars.length - 1, i1)) || co.width);
      const fullW = Math.max(40, xRight - xLeft + co.pxPerBar());
      buckets.forEach((row, price) => {
        const rel = row.vol / max;
        if (rel < cfg.threshold) return;
        const yA = co.priceToY(price + step, a.scale, a.bounds), yB = co.priceToY(price, a.scale, a.bounds);
        if (!Number.isFinite(yA) || !Number.isFinite(yB)) return;
        const y = Math.min(yA, yB), h = Math.max(2, Math.abs(yB - yA));
        if (y > bot || y + h < top) return;
        const col = cfg.mode === 'single' ? cfg.heat : (row.delta >= 0 ? cfg.up : cfg.down);
        const w = Math.max(24, fullW * (0.12 + 0.88 * rel));
        g.fillStyle = alpha(col, 0.06 + cfg.opacity * rel);
        g.fillRect(xRight - w, y, w, h);
        if (rel > 0.65) {
          g.fillStyle = alpha(col, 0.10 + cfg.opacity * 0.65);
          g.fillRect(xLeft, y, fullW, h);
        }
      });
      g.restore();
    },
    destroy() { canvas = null; }
  };
}
function vhBuild(inputs, mk, ctx) {
  const bars = ctx.bars();
  if (!bars.some(b => (b.volume || 0) > 0)) return { data: { off: true }, emit: { tables: [message('stk_vh-msg', 'Volume Heatmap needs bars with volume.', pageIsDay())] } };
  const cfg = vhConfig(inputs);
  cfg.tick = mk.tick || null;
  return { data: cfg, emit: {} };
}


// ---------------------------------------------------------------------------------------
// Liquidity Trend Heatmap — BigBeluga-inspired clean volume-at-price zones + POC + trend
// ---------------------------------------------------------------------------------------
const LTH_SCHEMA = [
  { key: 'lookback', title: 'Lookback bars', type: 'int', defval: 180, min: 30, max: 800, step: 10 },
  { key: 'levels', title: 'Price levels', type: 'int', defval: 26, min: 10, max: 80, step: 1 },
  { key: 'threshold', title: 'Show above (% of POC volume)', type: 'float', defval: 8, min: 0, max: 80, step: 1 },
  { key: 'opacity', title: 'Max opacity %', type: 'int', defval: 48, min: 5, max: 85, step: 1 },
  { key: 'extendPct', title: 'Zone extension % of chart', type: 'int', defval: 42, min: 10, max: 100, step: 1 },
  { key: 'nodeSize', title: 'Node size', type: 'int', defval: 18, min: 4, max: 46, step: 1 },
  { key: 'showPoc', title: 'Show POC', type: 'bool', defval: true },
  { key: 'showTrend', title: 'Show trend baseline', type: 'bool', defval: true },
  { key: 'trendLen', title: 'Trend length', type: 'int', defval: 55, min: 5, max: 300, step: 5 },
  { key: 'heatMode', title: 'Heat style', type: 'string', defval: 'blocks + nodes', options: ['blocks + nodes', 'blocks only', 'nodes only'] },
  { key: 'pocColor', title: 'POC colour', type: 'color', defval: '#f5c542' },
  { key: 'trendColor', title: 'Trend colour', type: 'color', defval: '#eeeeee' }
];
function lthConfig(inputs) {
  return {
    lookback: clamp(Math.round(num(inputs.lookback, 180)), 30, 800),
    levels: clamp(Math.round(num(inputs.levels, 26)), 10, 80),
    threshold: clamp(num(inputs.threshold, 8), 0, 80) / 100,
    opacity: clamp(num(inputs.opacity, 48), 5, 85) / 100,
    extendPct: clamp(num(inputs.extendPct, 42), 10, 100) / 100,
    nodeSize: clamp(Math.round(num(inputs.nodeSize, 18)), 4, 46),
    showPoc: inputs.showPoc !== false,
    showTrend: inputs.showTrend !== false,
    trendLen: clamp(Math.round(num(inputs.trendLen, 55)), 5, 300),
    heatMode: ['blocks only', 'nodes only'].includes(inputs.heatMode) ? inputs.heatMode : 'blocks + nodes',
    poc: str(inputs.pocColor, '#f5c542'),
    trend: str(inputs.trendColor, '#eeeeee')
  };
}
function liquidityTrendHeatmapLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = beginFrame(canvas, a.coords);
      if (!g || !a.data || a.data.off || !a.bars.length) return;
      const cfg = a.data, co = a.coords;
      const vr = co.visibleLogicalRange();
      const i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to) + 1);
      const i0 = Math.max(0, i1 - cfg.lookback + 1, Math.floor(vr.from) - 5);
      if (i1 <= i0) return;
      const top = a.bounds.top, bot = top + a.bounds.height;
      let lo = Infinity, hi = -Infinity, volOk = false;
      for (let i = i0; i <= i1; i++) {
        const b = a.bars[i];
        if (!b) continue;
        if (b.low < lo) lo = b.low;
        if (b.high > hi) hi = b.high;
        if ((b.volume || 0) > 0) volOk = true;
      }
      if (!volOk || !(hi > lo)) return;
      const step = (hi - lo) / cfg.levels;
      const rows = Array.from({ length: cfg.levels }, (_, k) => ({ k, price: lo + step * (k + 0.5), vol: 0, delta: 0 }));
      for (let i = i0; i <= i1; i++) {
        const b = a.bars[i];
        const v = Number(b.volume || 0);
        if (!(v > 0)) continue;
        const bl = Math.max(lo, Math.min(b.low, b.high));
        const bh = Math.min(hi, Math.max(b.low, b.high));
        const a0 = clamp(Math.floor((bl - lo) / step), 0, cfg.levels - 1);
        const a1 = clamp(Math.floor((bh - lo) / step), 0, cfg.levels - 1);
        const n = Math.max(1, a1 - a0 + 1);
        const share = v / n;
        const dir = b.close >= b.open ? 1 : -1;
        for (let k = a0; k <= a1; k++) { rows[k].vol += share; rows[k].delta += share * dir; }
      }
      let max = 0, poc = rows[0];
      rows.forEach(r => { if (r.vol > max) { max = r.vol; poc = r; } });
      if (!(max > 0)) return;
      const xRight = Math.min(co.width - 6, co.logicalToX(i1) + co.pxPerBar() * 1.5 || co.width - 6);
      const xLeft = Math.max(0, xRight - co.width * cfg.extendPct);
      const fullW = Math.max(40, xRight - xLeft);
      const light = themeIsLight(a.theme);
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      g.textBaseline = 'middle';
      for (const r of rows) {
        const rel = r.vol / max;
        if (rel < cfg.threshold) continue;
        const yA = co.priceToY(lo + step * (r.k + 1), a.scale, a.bounds);
        const yB = co.priceToY(lo + step * r.k, a.scale, a.bounds);
        if (!Number.isFinite(yA) || !Number.isFinite(yB)) continue;
        const y = Math.min(yA, yB), h = Math.max(3, Math.abs(yB - yA) - 1);
        if (y > bot || y + h < top) continue;
        const col = liquidityColor(rel, cfg.opacity);
        const w = Math.max(18, fullW * (0.16 + 0.84 * Math.sqrt(rel)));
        if (cfg.heatMode !== 'nodes only') {
          g.fillStyle = col;
          const rx = xRight - w;
          if (g.roundRect) { g.beginPath(); g.roundRect(rx, y, w, h, Math.min(7, h / 2)); g.fill(); }
          else g.fillRect(rx, y, w, h);
        }
        if (cfg.heatMode !== 'blocks only') {
          const n = Math.max(1, Math.round(1 + rel * 5));
          const size = Math.max(3, cfg.nodeSize * (0.35 + 0.85 * rel));
          for (let j = 0; j < n; j++) {
            const nx = xRight - 12 - j * (size * 0.95);
            const ny = y + h / 2;
            if (nx < xLeft) break;
            g.fillStyle = liquidityColor(rel, cfg.opacity * 1.15);
            g.beginPath(); g.arc(nx, ny, size / 2, 0, Math.PI * 2); g.fill();
          }
        }
      }
      if (cfg.showPoc && poc) {
        const y = Math.round(co.priceToY(poc.price, a.scale, a.bounds)) + 0.5;
        if (y >= top && y <= bot) {
          g.strokeStyle = cfg.poc; g.lineWidth = 1.5; g.setLineDash([7, 4]);
          g.beginPath(); g.moveTo(xLeft, y); g.lineTo(co.width, y); g.stroke(); g.setLineDash([]);
          g.fillStyle = alpha(cfg.poc, light ? 0.95 : 0.90);
          g.font = 'bold 11px ' + ((a.theme && a.theme.fontFamily) || 'sans-serif');
          g.fillText('POC ' + fmtPrice(poc.price), Math.max(12, xLeft + 8), y - 10);
        }
      }
      if (cfg.showTrend) {
        const vals = [];
        let sum = 0;
        for (let i = 0; i < a.bars.length; i++) {
          const c = Number(a.bars[i].close);
          sum += c;
          if (i >= cfg.trendLen) sum -= Number(a.bars[i - cfg.trendLen].close);
          vals[i] = i >= cfg.trendLen - 1 ? sum / cfg.trendLen : null;
        }
        g.strokeStyle = alpha(cfg.trend, light ? 0.65 : 0.55); g.lineWidth = 1.25; g.setLineDash([]);
        let open = false;
        for (let i = Math.max(0, Math.floor(vr.from) - 2); i <= Math.min(a.bars.length - 1, Math.ceil(vr.to) + 2); i++) {
          const v = vals[i];
          if (v == null) { if (open) { g.stroke(); open = false; } continue; }
          const x = co.logicalToX(i), y = co.priceToY(v, a.scale, a.bounds);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (!open) { g.beginPath(); g.moveTo(x, y); open = true; } else g.lineTo(x, y);
        }
        if (open) g.stroke();
      }
      g.restore();
    },
    destroy() { canvas = null; }
  };
}
function lthBuild(inputs, mk, ctx) {
  const bars = ctx.bars();
  if (!bars.some(b => (b.volume || 0) > 0)) return { data: { off: true }, emit: { tables: [message('stk_lth-msg', 'Liquidity Trend Heatmap needs bars with volume.', pageIsDay())] } };
  return { data: lthConfig(inputs), emit: {} };
}

// ---------------------------------------------------------------------------------------
// Estimated CVD (from candles) — NOT real order flow
// ---------------------------------------------------------------------------------------
const EST_SCHEMA = [
  { key: 'mode', title: 'Show', type: 'string', defval: 'cvd', options: ['cvd', 'delta'] },
  { key: 'reset', title: 'Reset CVD', type: 'string', defval: 'session', options: ['session', 'none'] },
  { key: 'upColor', title: 'Buying colour', type: 'color', defval: '#089981' },
  { key: 'downColor', title: 'Selling colour', type: 'color', defval: '#f23645' }
];
// Close-location split: a candle closing at its high counts as all buying, at its low as
// all selling. A rough guess from OHLCV only.
export function estimatedDelta(b) {
  const r = b.high - b.low;
  if (!(r > 0)) return 0;
  return (b.volume || 0) * ((b.close - b.low) - (b.high - b.close)) / r;
}
class EstCvdNative {
  constructor() { this.inputs = {}; this.tm = 0; this.onTheme = () => this.compute(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; window.addEventListener('stryker:theme', this.onTheme); this.compute(); }
  onBars() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.compute(); }, 250); }
  onViewport() {}
  setInputs(i) { this.inputs = i; this.compute(); }
  suspend() { clearTimeout(this.tm); this.tm = 0; }
  resume() { this.compute(); }
  stop() { this.suspend(); window.removeEventListener('stryker:theme', this.onTheme); }
  compute() {
    const bars = this.ctx.bars();
    const mk = marketOf(this.ctx);
    const up = str(this.inputs.upColor, '#089981'), dn = str(this.inputs.downColor, '#f23645');
    const d = bars.map(estimatedDelta);
    let s;
    if (this.inputs.mode === 'delta') {
      s = { id: 'stk_estcvd-d', title: 'Est. delta', paneId: '', kind: 'histogram',
        points: bars.map((b, i) => ({ time: b.time, value: Math.round(d[i]), color: d[i] >= 0 ? up : dn })), style: { color: up, width: 1, lineStyle: 'solid', base: 0 } };
    } else {
      let acc = 0, key = null;
      const reset = this.inputs.reset !== 'none';
      s = { id: 'stk_estcvd-c', title: 'Est. CVD', paneId: '', kind: 'line', style: { color: up, width: 2, lineStyle: 'solid' },
        points: bars.map((b, i) => {
          if (reset) { const k = sessionKey(b.time, 'day', mk.futures); if (k !== key) { key = k; acc = 0; } }
          acc += d[i];
          return { time: b.time, value: Math.round(acc), color: acc >= 0 ? up : dn };
        }) };
    }
    this.ctx.emit({ series: [s], tables: [message('stk_estcvd-msg', 'Estimated from candles, not real order flow', pageIsDay(), 'top_right')] });
  }
}


// =======================================================================================
// REAL ORDER FLOW (stage 2): footprint / bid x ask delta / CVD / imbalances from trades.
// =======================================================================================
// Data: every trade with its aggressor side.
//   - Binance (crypto, public, no key): REST /aggTrades backfill (a few pages, newest first)
//     then the live aggTrade WebSocket. `m` (buyer is the maker) = the SELLER hit the bid.
//   - futures: only through a registered trade source (the member's own Rithmic connection,
//     assets/rithmic-ui.js calls registerTradeSource('futures', ...)). Without one, the tools say
//     "Needs real trade data. Connect Rithmic (coming soon)" and draw nothing.
// Volume at the bid = sells by aggressors; at the ask = buys by aggressors. Delta = ask - bid.
// Only bars fully covered by trades are drawn; older bars stay plain candles.

const BACKFILL_PAGES = 6;          // x 1000 trades, newest first; weight 2 each on Binance (limit 6000/min)
const MAX_BARS_KEPT = 600;
const FLOW_MAX_TF = 15;            // minutes
const NEED_RITHMIC = 'Needs real trade data. Connect Rithmic (coming soon)';
const tradeSources = new Map();    // provider -> (ticker, onTrade, onStatus) => unsubscribe

const liveFlow = new Set();        // running FlowNative instances (re-attached when a source comes or goes)
export function registerTradeSource(provider, fn) { tradeSources.set(provider, fn); refreshFlow(); tellTradeListeners(); }
export function unregisterTradeSource(provider) {
  if (!tradeSources.delete(provider)) return;
  feeds.forEach((f, k) => { if (k.startsWith(provider + '|')) { try { f.stop(); } catch (e) {} feeds.delete(k); } });
  refreshFlow();
  tellTradeListeners();
}
export function refreshFlow() { liveFlow.forEach((n) => { try { n.attach(); } catch (e) {} }); }
// Raw trade access for assets/chart-intervals.js (tick bars, and seconds bars on venues without
// 1-second candles). openTradeSource returns an unsubscribe function, or null when there is none.
// The futures source exists only while the member's Rithmic connection is up (flag-gated).
const tradeSourceListeners = new Set();
const tellTradeListeners = () => tradeSourceListeners.forEach((cb) => { try { cb(); } catch (e) {} });
export function hasTradeSource(provider) { return tradeSources.has(provider); }
export function openTradeSource(provider, ticker, onTrade, onStatus) {
  const fn = tradeSources.get(provider);
  if (window.__stkReplay && window.__stkReplay.on) return null;   // bar replay: no live trades
  return fn ? fn(ticker, onTrade, onStatus || (() => {})) : null;
}
export function onTradeSourcesChanged(cb) { tradeSourceListeners.add(cb); return () => tradeSourceListeners.delete(cb); }

function binanceSource(ticker, onTrade, onStatus) {
  const perp = /\.P$/i.test(ticker);
  const sym = ticker.replace(/\.P$/i, '').toUpperCase();
  const rest = perp ? ['https://fapi.binance.com/fapi/v1'] : ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3'];
  const wsBase = perp ? ['wss://fstream.binance.com/ws/'] : ['wss://stream.binance.com:9443/ws/', 'wss://data-stream.binance.vision/ws/'];
  let stopped = false, ws = null, retry = 0, tm = 0;
  // n = exchange trades folded into this aggregate trade (tick bars count real trades).
  const conv = (t) => ({ time: t.T, price: +t.p, size: +t.q, side: t.m ? 'sell' : 'buy', id: t.a, n: t.l >= t.f ? t.l - t.f + 1 : 1 });
  async function get(qs) {
    let err;
    for (const b of rest) {
      try { const r = await fetch(b + '/aggTrades?symbol=' + sym + qs); if (r.ok) return r.json(); err = new Error('HTTP ' + r.status); }
      catch (e) { err = e; }
    }
    throw err;
  }
  (async () => {
    // live first (buffered) so no gap opens between the backfill and the stream
    const buf = [];
    let backfilled = false;
    const open = (i) => {
      if (stopped) return;
      ws = new WebSocket(wsBase[i % wsBase.length] + sym.toLowerCase() + '@aggTrade');
      ws.onmessage = (e) => { try { const t = conv(JSON.parse(e.data)); if (backfilled) onTrade([t], false); else buf.push(t); } catch (x) {} };
      ws.onopen = () => { retry = 0; };
      ws.onclose = () => { if (stopped) return; onStatus('reconnecting'); tm = setTimeout(() => open(++retry), Math.min(15000, 1000 * Math.pow(2, retry))); };
    };
    open(0);
    try {
      onStatus('loading');
      let page = await get('&limit=1000');
      const all = page.slice();
      for (let i = 1; i < BACKFILL_PAGES && page.length && !stopped; i++) {
        const from = page[0].a - 1000;
        if (from < 0) break;
        page = (await get('&limit=1000&fromId=' + from)).filter((t) => t.a < all[0].a);
        all.unshift(...page);
      }
      if (stopped) return;
      const lastId = all.length ? all[all.length - 1].a : -1;
      onTrade(all.map(conv), true);
      backfilled = true;
      onTrade(buf.filter((t) => t.id > lastId), false);
      buf.length = 0;
      onStatus('live');
    } catch (e) {
      backfilled = true;
      onTrade(buf, false); buf.length = 0;
      onStatus('error', 'Could not load recent trades from Binance.');
    }
  })();
  return () => { stopped = true; clearTimeout(tm); try { if (ws) ws.close(); } catch (e) {} };
}
tradeSources.set('binance', binanceSource);
// Other sources (the Rithmic connection, assets/rithmic-ui.js) arrive by event.
if (typeof window !== 'undefined') {
  const pending = window.__stkTradeSources || {};
  Object.keys(pending).forEach((k) => { if (pending[k]) tradeSources.set(k, pending[k]); });
  window.addEventListener('stryker:tradesource', (e) => {
    const d = e.detail || {};
    if (!d.provider || d.provider === 'binance') return;
    if (d.fn) registerTradeSource(d.provider, d.fn); else unregisterTradeSource(d.provider);
  });
}

// One feed per provider|ticker|timeframe: per-bar levels built from trades.
const feeds = new Map();
class TradeFeed {
  constructor(key, provider, ticker, tfMs, step) {
    this.key = key; this.tfMs = tfMs; this.fixedStep = step || 0; this.bars = new Map(); this.order = [];
    this.coverFrom = Infinity; this.status = 'loading'; this.err = ''; this.version = 0;
    this.listeners = new Set(); this.refs = 0; this.step = 0; this.closeTm = 0;
    if (window.__stkReplay && window.__stkReplay.on) { this.status = 'replay'; this.err = window.__stkBt ? 'No order-flow data for this day.' : 'Order flow needs live trades: not available in bar replay.'; this.stop = () => {}; return; }   // bar replay
    this.stop = tradeSources.get(provider)(ticker, (ts, backfill) => this.add(ts, backfill), (st, err) => { this.status = st; this.err = err || ''; this.bump(); });
  }
  stepFor(price) {
    if (!this.step) this.step = this.fixedStep || niceStep(price * 0.00005);
    return this.step;
  }
  add(ts, backfill) {
    if (!ts.length) return;
    for (const t of ts) {
      if (!(t.price > 0) || !(t.size > 0)) continue;
      const bt = Math.floor(t.time / this.tfMs) * this.tfMs;
      let b = this.bars.get(bt);
      if (!b) {
        b = { time: bt, levels: new Map(), buy: 0, sell: 0, maxLvl: 0 };
        this.bars.set(bt, b);
        if (!this.order.length || bt > this.order[this.order.length - 1]) this.order.push(bt);
        else { this.order.push(bt); this.order.sort((x, y) => x - y); }
        if (this.order.length > MAX_BARS_KEPT) this.bars.delete(this.order.shift());
      }
      const step = this.stepFor(t.price);
      const row = Math.round(Math.floor(t.price / step + 1e-9) * step * 1e8) / 1e8;
      let l = b.levels.get(row);
      if (!l) { l = [0, 0]; b.levels.set(row, l); }
      if (t.side === 'buy') { l[1] += t.size; b.buy += t.size; } else { l[0] += t.size; b.sell += t.size; }
    }
    if (backfill && this.order.length) {
      // the first bar is only partly covered: start the coverage at the next one
      this.coverFrom = this.order.length > 1 ? this.order[1] : this.order[0] + this.tfMs;
    } else if (this.coverFrom === Infinity && this.order.length) {
      this.coverFrom = this.order[0] + this.tfMs;   // live-only source: the first bar was seen part-way
    }
    if (this.status === 'waiting' && this.order.length > 1) this.status = 'live';
    this.bump();
  }
  bump() { this.version++; this.listeners.forEach((fn) => { try { fn(); } catch (e) {} }); }
  bar(t) { return t >= this.coverFrom ? this.bars.get(t) : undefined; }
}
function acquireFeed(provider, ticker, tfMs, fn, step) {
  const key = provider + '|' + ticker + '|' + tfMs;
  let f = feeds.get(key);
  if (!f) { f = new TradeFeed(key, provider, ticker, tfMs, step); feeds.set(key, f); }
  clearTimeout(f.closeTm);
  f.refs++; f.listeners.add(fn);
  return { feed: f, release() {
    f.listeners.delete(fn);
    if (--f.refs > 0) return;
    f.closeTm = setTimeout(() => { if (f.refs <= 0) { try { f.stop(); } catch (e) {} feeds.delete(key); } }, 10000);
  } };
}
export function flowFeeds() { return feeds; }

// Why a chart cannot show real order flow (or '' when it can).
function flowBlocker(mk, tfMin) {
  if (!tradeSources.has(mk.provider)) {
    if (mk.provider === 'futures') return NEED_RITHMIC;
    return 'Real order flow needs trade data: available on Binance symbols for now.';
  }
  if (tfMin == null || tfMin > FLOW_MAX_TF || tfMin < 1) return 'Order flow works on 1m to 15m charts.';
  return '';
}

// Base for the three trade-driven natives: acquires the shared feed, re-emits throttled.
class FlowNative {
  constructor(kind) { this.kind = kind; this.inputs = {}; this.h = null; this.tm = 0; this.onTheme = () => this.render(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; liveFlow.add(this); window.addEventListener('stryker:theme', this.onTheme); this.attach(); }
  attach() {
    if (!this.ctx) return;
    this.detach();
    const mk = marketOf(this.ctx), tf = tfMinutes(this.ctx.timeframe);
    this.block = flowBlocker(mk, tf);
    if (!this.block) {
      this.h = acquireFeed(mk.provider, mk.ticker, tf * 60000, () => this.later(), mk.tick);
      this.ctx.setStatus(this.h.feed.status === 'live' ? 'live' : 'loading');
    }
    this.render();
  }
  detach() { if (this.h) { this.h.release(); this.h = null; } clearTimeout(this.tm); this.tm = 0; }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, this.kind === 'footprint' ? 200 : 500); }
  onBars() {}
  onViewport() {}
  setInputs(i) { this.inputs = i; this.render(); }
  suspend() { this.detach(); }
  resume() { this.attach(); }
  stop() { this.detach(); liveFlow.delete(this); window.removeEventListener('stryker:theme', this.onTheme); }
  note() {
    if (this.block) return this.block;
    const f = this.h.feed;
    if (f.status === 'error' || f.status === 'replay') return f.err || 'Trade data unavailable.';
    if (f.status === 'loading') return 'Loading recent trades…';
    if (f.status === 'waiting') return 'Real trades from your Rithmic connection: building from now on.';
    return '';
  }
  render() {
    if (!this.ctx) return;
    const msg = this.note();
    const f = this.h && this.h.feed;
    this.ctx.setStatus(!f || this.block ? 'idle' : f.status === 'live' ? 'live' : f.status === 'error' ? 'idle' : 'loading');
    const tables = msg ? [message('stk_' + this.kind + '-msg', msg, pageIsDay(), this.kind === 'footprint' ? 'bottom_center' : 'top_right')] : [];
    if (this.kind === 'footprint') {
      this.ctx.emit({ tables });
      this.ctx.pushData(f && !this.block ? { feed: f.key, v: f.version, cfg: fpConfig(this.inputs) } : null);
      return;
    }
    const bars = this.ctx.bars();
    const up = str(this.inputs.upColor, '#089981'), dn = str(this.inputs.downColor, '#f23645');
    let pts;
    if (!f || this.block) pts = bars.map((b) => ({ time: b.time, value: null }));
    else if (this.kind === 'delta') {
      pts = bars.map((b) => { const x = f.bar(b.time); if (!x) return { time: b.time, value: null }; const d = x.buy - x.sell; return { time: b.time, value: round6(d), color: d >= 0 ? up : dn }; });
    } else {
      let acc = 0, key = null;
      const reset = this.inputs.reset === 'day';
      pts = bars.map((b) => {
        const x = f.bar(b.time);
        if (!x) return { time: b.time, value: null };
        if (reset) { const k = utcDay(b.time); if (k !== key) { key = k; acc = 0; } }
        acc += x.buy - x.sell;
        return { time: b.time, value: round6(acc), color: acc >= 0 ? up : dn };
      });
    }
    const s = this.kind === 'delta'
      ? { id: 'stk_delta-h', title: 'Delta', paneId: '', kind: 'histogram', points: pts, style: { color: up, width: 1, lineStyle: 'solid', base: 0 } }
      : { id: 'stk_cvd-l', title: 'CVD', paneId: '', kind: 'line', points: pts, style: { color: up, width: 2, lineStyle: 'solid' } };
    this.ctx.emit({ series: [s], tables });
  }
}
const round6 = (x) => Math.round(x * 1e6) / 1e6;

const FP_SCHEMA = [
  { key: 'mode', title: 'Cells show', type: 'string', defval: 'bidask', options: ['bidask', 'delta', 'volume'], tooltip: 'bidask = volume at the bid x volume at the ask per price row.' },
  { key: 'rowMult', title: 'Row size (x the base step)', type: 'int', defval: 1, min: 1, max: 50, step: 1 },
  { key: 'imbalance', title: 'Imbalance at (%)', type: 'int', defval: 300, min: 110, max: 2000, step: 10, tooltip: 'Diagonal: ask at a price vs bid one row below (and bid vs ask one row above).' },
  { key: 'minBarPx', title: 'Show cells from bar width (px)', type: 'int', defval: 44, min: 20, max: 200, step: 2 },
  { key: 'upColor', title: 'Buy colour', type: 'color', defval: '#089981' },
  { key: 'downColor', title: 'Sell colour', type: 'color', defval: '#f23645' }
];
const DC_SCHEMA = [
  { key: 'upColor', title: 'Positive colour', type: 'color', defval: '#089981' },
  { key: 'downColor', title: 'Negative colour', type: 'color', defval: '#f23645' }
];
const CVD_SCHEMA = [{ key: 'reset', title: 'Reset', type: 'string', defval: 'none', options: ['none', 'day'] }].concat(DC_SCHEMA);
function fpConfig(i) {
  return { mode: ['bidask', 'delta', 'volume'].includes(i.mode) ? i.mode : 'bidask', rowMult: clamp(Math.round(num(i.rowMult, 1)), 1, 50),
    imb: clamp(num(i.imbalance, 300), 110, 2000) / 100, minBarPx: clamp(num(i.minBarPx, 44), 20, 200),
    up: str(i.upColor, '#089981'), dn: str(i.downColor, '#f23645') };
}
// Price text for the Liquidity Trend Heatmap POC label (it called an undefined fmtPrice, so the label threw).
function fmtPrice(v) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v), d = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return String(Number(v.toFixed(d)));
}
function fmtVol(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(0) + 'K';
  if (v >= 1000) return (v / 1e3).toFixed(1) + 'K';
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v > 0 ? v.toFixed(3).replace(/^0/, '') : '0';
}

// Footprint layer: drawn over the candles when bars are wide enough; candles slim to a stick.
function footprintLayer() {
  let canvas = null, on = false;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = beginFrame(canvas, a.coords);
      on = false;
      if (!g || !a.data || !a.bars.length) return;
      const f = feeds.get(a.data.feed);
      if (!f) return;
      const cfg = a.data.cfg, co = a.coords;
      const bw = co.pxPerBar();
      if (bw < cfg.minBarPx) return;
      on = true;
      const light = themeIsLight(a.theme);
      const vr = co.visibleLogicalRange();
      const i0 = Math.max(0, Math.floor(vr.from) - 1), i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to) + 1);
      const base = f.step * cfg.rowMult;
      const midP = (a.scale.min + a.scale.max) / 2;
      const rowPx = Math.abs(co.priceToY(midP + base, a.scale, a.bounds) - co.priceToY(midP, a.scale, a.bounds));
      let mult = 1;
      while (rowPx * mult < 11 && mult < 1000) mult *= 2;
      const step = base * mult;
      const top = a.bounds.top, bot = top + a.bounds.height;
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      g.textBaseline = 'middle'; g.textAlign = 'center';
      const fs = clamp(Math.floor(Math.min(rowPx * mult - 2, bw / 7)), 8, 12);
      g.font = fs + 'px ' + ((a.theme && a.theme.fontFamily) || 'sans-serif');
      const ink = light ? '#1f2937' : '#d1d4dc';
      for (let i = i0; i <= i1; i++) {
        const bar = a.bars[i];
        const fb = f.bar(bar.time);
        if (!fb) continue;
        // merge levels into display rows
        const rows = new Map();
        fb.levels.forEach((l, p) => { const r = Math.round(Math.floor(p / step + 1e-9) * step * 1e8) / 1e8; const x = rows.get(r); if (x) { x[0] += l[0]; x[1] += l[1]; } else rows.set(r, [l[0], l[1]]); });
        let max = 0, poc = null;
        rows.forEach((l, p) => { const t = l[0] + l[1]; if (t > max) { max = t; poc = p; } });
        const x = co.logicalToX(i), w = bw * 0.9, xl = x - w / 2;
        const prices = [...rows.keys()].sort((p, q) => p - q);
        prices.forEach((p, k) => {
          const l = rows.get(p);
          const yA = co.priceToY(p + step, a.scale, a.bounds), yB = co.priceToY(p, a.scale, a.bounds);
          const y = Math.min(yA, yB), h = Math.abs(yB - yA);
          if (y > bot || y + h < top) return;
          const d = l[1] - l[0], t = l[0] + l[1];
          g.fillStyle = alpha(d >= 0 ? cfg.up : cfg.dn, 0.08 + 0.42 * (t / (max || 1)));
          g.fillRect(xl, y + 0.5, w, Math.max(1, h - 1));
          if (p === poc) { g.strokeStyle = light ? '#334155' : '#e5e7eb'; g.lineWidth = 1; g.strokeRect(xl + 0.5, y + 1, w - 1, Math.max(1, h - 2)); }
          if (h < 9) return;
          // diagonal imbalances: ask here vs bid one row below; bid here vs ask one row above
          const below = k > 0 ? rows.get(prices[k - 1]) : null, above = k < prices.length - 1 ? rows.get(prices[k + 1]) : null;
          const askImb = below ? l[1] >= cfg.imb * Math.max(below[0], 1e-12) && l[1] > 0 : false;
          const bidImb = above ? l[0] >= cfg.imb * Math.max(above[1], 1e-12) && l[0] > 0 : false;
          const yc = y + h / 2;
          if (cfg.mode === 'bidask') {
            g.textAlign = 'right'; g.fillStyle = bidImb ? cfg.dn : ink; g.font = (bidImb ? 'bold ' : '') + fs + 'px ' + ((a.theme && a.theme.fontFamily) || 'sans-serif');
            g.fillText(fmtVol(l[0]), x - 3, yc);
            g.textAlign = 'left'; g.fillStyle = askImb ? cfg.up : ink; g.font = (askImb ? 'bold ' : '') + fs + 'px ' + ((a.theme && a.theme.fontFamily) || 'sans-serif');
            g.fillText(fmtVol(l[1]), x + 3, yc);
            g.fillStyle = alpha(ink, 0.5); g.fillRect(x - 0.5, y + 2, 1, Math.max(1, h - 4));
          } else {
            g.textAlign = 'center'; g.fillStyle = cfg.mode === 'delta' ? (d >= 0 ? cfg.up : cfg.dn) : ink;
            g.font = fs + 'px ' + ((a.theme && a.theme.fontFamily) || 'sans-serif');
            g.fillText((cfg.mode === 'delta' && d > 0 ? '+' : cfg.mode === 'delta' && d < 0 ? '-' : '') + fmtVol(cfg.mode === 'delta' ? Math.abs(d) : t), x, yc);
          }
        });
        // bar delta under the bar
        const d = fb.buy - fb.sell;
        const yLow = co.priceToY(bar.low, a.scale, a.bounds) + fs + 4;
        if (yLow < bot) { g.textAlign = 'center'; g.fillStyle = d >= 0 ? cfg.up : cfg.dn; g.font = 'bold ' + fs + 'px ' + ((a.theme && a.theme.fontFamily) || 'sans-serif'); g.fillText((d >= 0 ? '+' : '-') + fmtVol(Math.abs(d)), x, yLow); }
      }
      g.restore();
    },
    modulateBase() { return on ? { candleBodyScale: 0.12, candleBodyAlpha: 0.8 } : null; },
    destroy() { canvas = null; }
  };
}

// =======================================================================================
// CRYPTO DOM / RESTING LIQUIDITY (Binance public depth, no key)
// =======================================================================================
// Resting limit orders at each price level, from Binance's public order book (REST snapshot
// + diff stream, see binanceBookSource). The feed samples the book once a second; the layer
// buckets every sample into price levels and draws, per the "Style" setting:
//   Combined (default): two-colour heatmap over time (bucket coloured by the side holding more
//     size; mint = bids, red = asks), depth bars of the CURRENT book on the right edge, and the
//     biggest persistent levels ("walls") as thick lines with their size in base-asset units.
//   Heatmap only: one-colour intensity ramp (Bookmap-like). Depth bars only. Walls only.
//   Deep heatmap (default since batch 2, 2026-10-24, Owner "features like deepcharts"): the dark single
//     scale (teal -> cyan -> yellow -> orange -> red, assets/chart-liquidity-data.js DEEP_RAMP), bid depth
//     green / ask depth purple, big resting levels with their size, and on a big level that VANISHED a
//     "pulled" or "filled" tag: filled = trades printed into it at that price (Binance aggTrades, the
//     crypto footprint feed) for >= 30% of its last size before it went; pulled = it went with less than
//     that traded there. No tag when the trades do not reach back that far. Plus an "ICE" hint where one
//     price kept trading several times its visible size while that size stayed small and kept refilling
//     (only on the minutes this page recorded at 1 sample a second; the recorder's 1-a-minute samples
//     cannot see a refill). Hints describe what printed; they predict nothing.
// The 1 bucket either side of the mid is skipped (best bid / ask churn). Thin levels below the
// chosen percentile of all sizes in view are hidden. Indicator only: it describes resting
// orders, it predicts nothing and offers nothing to trade.
// Book feed: the REST snapshot asks for Binance's deepest book (5000 levels a side on spot,
// 1000 on USD-M perps), then the @depth@100ms diff stream keeps it current. The diff stream
// also reports levels beyond the snapshot, so the in-memory book keeps up to BOOK_MAX_LEVELS
// a side (nearest the mid) and a refresh snapshot only replaces the price span it covers.
const BOOK_SNAPSHOT_SPOT = 5000, BOOK_SNAPSHOT_PERP = 1000;
const BOOK_MAX_LEVELS = 10000;
const BOOK_REFRESH_MS = 120000;     // 5000-level snapshot ~320 KB: every 2 min, not 30 s (phone data)
const BOOK_SAMPLE_MS = 1000;
const BOOK_KEEP_MS = 6 * 60 * 60 * 1000;   // history cap: 6 h, oldest dropped
const BOOK_FINE_MS = 30 * 60 * 1000;       // the newest 30 min keep 1 sample a second...
const BOOK_THIN_MS = 5000;                 // ...older samples keep 1 per 5 s
const BOOK_HISTORY_MAX = Math.ceil(BOOK_FINE_MS / BOOK_SAMPLE_MS) + Math.ceil((BOOK_KEEP_MS - BOOK_FINE_MS) / BOOK_THIN_MS);
const BOOK_ROWS_SIDE_MAX = 400;            // a finer manual bucket is coarsened to stay under this
const BOOK_AUTO_ROW = 0.0005;              // auto row = the nice step at or below 0.05% of the price
// Fine layer for close zooms: rows near 0.003% of the price (BTC: $2.50) over +-0.5% of the mid,
// kept for the newest 30 min only (older samples drop it when thinned, coarse rows stay).
const BOOK_FINE_ROW = 0.00003, BOOK_FINE_RANGE = 0.005;
const bookFeeds = new Map();
const BOOK_NEEDS_BINANCE = 'Crypto DOM needs a Binance crypto symbol.';
const DOM_VIEWS = ['Deep heatmap (heat + depth + sizes + pulled / filled)', 'Combined (heatmap + depth + walls)', 'Heatmap only', 'Depth bars only', 'Walls only'];
const DOM_SCHEMA = [
  { key: 'style', title: 'Style', type: 'string', defval: DOM_VIEWS[0], options: DOM_VIEWS },
  { key: 'showHeat', title: 'Show heatmap (Combined)', type: 'bool', defval: true },
  { key: 'showDepth', title: 'Show depth bars (Combined)', type: 'bool', defval: true },
  { key: 'showWalls', title: 'Show walls (Combined)', type: 'bool', defval: true },
  { key: 'wallTopPct', title: 'Wall threshold (top % of sizes)', type: 'float', defval: 2.5, min: 0.5, max: 20, step: 0.5 },
  { key: 'wallMinSec', title: 'Wall min lifetime (seconds)', type: 'int', defval: 12, min: 0, max: 600, step: 1 },
  { key: 'showWallSizes', title: 'Show wall sizes', type: 'bool', defval: true },
  { key: 'showVanish', title: 'Pulled / filled tags on vanished big levels (Deep)', type: 'bool', defval: true },
  { key: 'showIce', title: 'Iceberg hint (Deep; minutes this page recorded at 1 s)', type: 'bool', defval: true },
  { key: 'askDepthColor', title: 'Ask depth colour (Deep)', type: 'color', defval: '#8b5cf6' },
  { key: 'hidePct', title: 'Hide thin levels below (percentile)', type: 'int', defval: 60, min: 0, max: 95, step: 5 },
  { key: 'bucketUsd', title: 'Price bucket size (0 = auto)', type: 'float', defval: 0, min: 0, max: 100000, step: 0.5 },
  { key: 'bookRangePct', title: 'Book range %', type: 'float', defval: 2, min: 0.5, max: 5, step: 0.5 },
  { key: 'historyMinutes', title: 'History window (minutes)', type: 'int', defval: 1440, min: 5, max: 1440, step: 5 },
  { key: 'depthWidthPct', title: 'Depth bars width %', type: 'int', defval: 15, min: 5, max: 40, step: 1 },
  { key: 'maxOpacity', title: 'Max opacity %', type: 'int', defval: 85, min: 5, max: 100, step: 1 },
  { key: 'showBest', title: 'Best bid / ask lines', type: 'bool', defval: false },
  { key: 'showScale', title: 'Colour scale (Heatmap only)', type: 'bool', defval: true },
  { key: 'bidColor', title: 'Bid colour', type: 'color', defval: '#03c988' },
  { key: 'askColor', title: 'Ask colour', type: 'color', defval: '#e5484d' }
];
// Old saved charts (before build 503) carry style 'liquidity heatmap' -> Combined, or
// 'right ladder' -> Depth bars only. Their old keys (levels, minPct, widthPct, opacity) are
// ignored, so an old 32% opacity / 36% ladder width does not carry over to the new look.
// Build 505: the history window key is 'historyMins' (default 6 h, the whole recorded
// history); the old 'historyMin' (default 90 min) of earlier saved charts is ignored.
// Build 525: the key is 'historyMinutes' (default and max 24 h, the book recorder's span); the
// 6 h 'historyMins' of earlier saved charts is ignored so they pick up the recorder history.
function domConfig(inputs) {
  const i = inputs || {};
  const vi = i.style === 'right ladder' ? 3 : i.style === 'liquidity heatmap' ? 1 : DOM_VIEWS.indexOf(i.style);
  const view = ['deep', 'combined', 'heat', 'depth', 'walls'][vi < 0 ? 0 : vi];
  const combined = view === 'combined' || view === 'deep';
  return {
    view,
    heat: view === 'heat' || (combined && i.showHeat !== false),
    depth: view === 'depth' || (combined && i.showDepth !== false),
    walls: view === 'walls' || (combined && i.showWalls !== false),
    twoTone: view === 'combined' || view === 'depth' || view === 'walls',
    deep: view === 'deep',
    vanish: view === 'deep' && i.showVanish !== false,
    ice: view === 'deep' && i.showIce !== false,
    askDepth: str(i.askDepthColor, '#8b5cf6'),
    wallTop: clamp(num(i.wallTopPct, 2.5), 0.5, 20) / 100,
    wallMinMs: clamp(Math.round(num(i.wallMinSec, 12)), 0, 600) * 1000,
    wallSizes: i.showWallSizes !== false,
    hide: clamp(num(i.hidePct, 60), 0, 95) / 100,
    bucket: Math.max(0, num(i.bucketUsd, 0)),
    range: clamp(num(i.bookRangePct, 2), 0.5, 5) / 100,
    historyMin: clamp(Math.round(num(i.historyMinutes, 1440)), 5, 1440),
    widthPct: clamp(num(i.depthWidthPct, 15), 5, 40) / 100,
    opacity: clamp(num(i.maxOpacity, 85), 5, 100) / 100,
    showBest: i.showBest === true,
    showScale: i.showScale !== false,
    bid: str(i.bidColor, '#03c988'),
    ask: str(i.askColor, '#e5484d')
  };
}
// "Heatmap only" intensity ramp (the reference prototype's): dark -> teal -> mint -> amber -> white.
const DOM_RAMP = [[11, 11, 13], [0, 60, 70], [0, 173, 181], [3, 201, 136], [245, 197, 66], [255, 255, 255]];
// Liquidity Trend Heatmap colour ramp (purple -> teal -> yellow). Restored 2026-10-24: build 503 removed it
// while the heatmap still calls it, so the layer threw on every frame and drew nothing.
function liquidityColor(t, maxAlpha) {
  t = clamp(t, 0, 1);
  const stops = [
    [0.00, [72, 0, 86]],
    [0.28, [48, 74, 141]],
    [0.52, [32, 145, 140]],
    [0.76, [70, 205, 85]],
    [1.00, [245, 230, 20]]
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
  const f = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
  const r = Math.round(a[1][0] + (b[1][0] - a[1][0]) * f);
  const g = Math.round(a[1][1] + (b[1][1] - a[1][1]) * f);
  const bl = Math.round(a[1][2] + (b[1][2] - a[1][2]) * f);
  return 'rgba(' + r + ',' + g + ',' + bl + ',' + (0.05 + maxAlpha * (0.18 + 0.82 * Math.sqrt(t))).toFixed(3) + ')';
}
function domRamp(v) {
  v = clamp(v, 0, 1);
  const x = v * (DOM_RAMP.length - 1), i = Math.min(DOM_RAMP.length - 2, Math.floor(x)), f = x - i;
  return DOM_RAMP[i].map((c, k) => Math.round(c + (DOM_RAMP[i + 1][k] - c) * f));
}
function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
// Base asset of a Binance ticker: BTCUSDT / BTCUSDT.P -> BTC.
function baseAsset(ticker) {
  const s = String(ticker || '').toUpperCase().replace(/\.P$/, '').replace(/^[A-Z]+:/, '');
  const m = /^(.+?)(USDT|USDC|FDUSD|BUSD|TUSD|USD|DAI|EUR|TRY|BRL|JPY|BTC|ETH|BNB)$/.exec(s);
  return m ? m[1] : s;
}
function fmtSize(v) {
  if (v >= 1000) return fmtVol(v);
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}
// The largest nice step (1 / 2 / 2.5 / 5 x 10^n) at or below raw: BTC at $84k, 0.05% = $42 -> $25.
function nearNiceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let best = p;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p <= raw * 1.0001) best = m * p;
  return best;
}
// Storage step + band (pure; the book recorder Worker, workers/book-recorder/src/bucket.js
// storeRule, applies the same rule with no wants: auto step, +-2%).
function bookStoreRule(mid, autoStep, wants) {
  if (!autoStep || Math.abs(Math.log(autoStep / (mid * BOOK_AUTO_ROW))) > 1.1) autoStep = nearNiceStep(mid * BOOK_AUTO_ROW);
  let step = autoStep, range = 0;
  if (wants) wants.forEach((w) => { if (w.bucket > 0 && w.bucket < step) step = w.bucket; if (w.range > range) range = w.range; });
  if (!(range > 0)) range = 0.02;
  const floor = mid * range / BOOK_ROWS_SIDE_MAX;
  if (step < floor) step = niceStep(floor);
  return { step, range, autoStep };
}
function bookKey(provider, ticker) { return provider + '|' + String(ticker || '').toUpperCase(); }
function binanceBookSource(ticker, onBook, onStatus) {
  const perp = /\.P$/i.test(ticker);
  const sym = ticker.replace(/\.P$/i, '').toUpperCase();
  const rest = perp ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
  const wsBase = perp ? 'wss://fstream.binance.com/ws/' : 'wss://stream.binance.com:9443/ws/';
  const limit = perp ? BOOK_SNAPSHOT_PERP : BOOK_SNAPSHOT_SPOT;
  let stopped = false, ws = null, tm = 0, retry = 0, refresh = 0, ready = false, lastSnap = 0;
  const bids = new Map(), asks = new Map();
  let bestBid = null, bestAsk = null;
  const best = () => {
    bestBid = null; bestAsk = null;
    bids.forEach((q, p) => { if (q > 0 && (bestBid == null || p > bestBid)) bestBid = p; });
    asks.forEach((q, p) => { if (q > 0 && (bestAsk == null || p < bestAsk)) bestAsk = p; });
  };
  const emit = () => { if (ready) onBook({ bids, asks, bestBid, bestAsk, ts: Date.now() }); };
  const trim = (m, side) => {
    if (m.size <= BOOK_MAX_LEVELS * 1.2) return;
    const sorted = [...m.keys()].sort((a, b) => side === 'b' ? b - a : a - b).slice(BOOK_MAX_LEVELS);
    sorted.forEach(p => m.delete(p));
  };
  // Diff rows: keep best bid / ask up to date without a full scan per message.
  const apply = (side, arr) => {
    const m = side === 'b' ? bids : asks;
    let rescan = false;
    for (const row of arr || []) {
      const p = Number(row[0]), q = Number(row[1]);
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
      if (q <= 0) {
        m.delete(p);
        if (p === (side === 'b' ? bestBid : bestAsk)) rescan = true;
      } else {
        m.set(p, q);
        if (side === 'b') { if (bestBid == null || p > bestBid) bestBid = p; }
        else if (bestAsk == null || p < bestAsk) bestAsk = p;
      }
    }
    return rescan;
  };
  async function snapshot() {
    lastSnap = Date.now();
    try {
      if (!ready) onStatus('loading');
      const r = await fetch(rest + '/depth?symbol=' + encodeURIComponent(sym) + '&limit=' + limit);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (stopped) return;
      // Replace the span the snapshot covers; keep the farther levels the diff stream reported.
      const span = (rows, m, side) => {
        if (!rows || !rows.length) return;
        const far = Number(rows[rows.length - 1][0]);
        m.forEach((q, p) => { if (side === 'b' ? p >= far : p <= far) m.delete(p); });
        apply(side, rows);
      };
      span(d.bids, bids, 'b'); span(d.asks, asks, 'a');
      trim(bids, 'b'); trim(asks, 'a');
      best();
      ready = true;
      emit(); onStatus('live');
    } catch (e) {
      if (!ready) onStatus('error', 'Could not load Binance order book.');
    }
  }
  function open() {
    if (stopped) return;
    try {
      ws = new WebSocket(wsBase + sym.toLowerCase() + '@depth@100ms');
      ws.onopen = () => { retry = 0; if (ready) onStatus('live'); };
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          const r1 = apply('b', d.b), r2 = apply('a', d.a);
          trim(bids, 'b'); trim(asks, 'a');
          if (r1 || r2) best();
          emit();
        } catch (x) {}
      };
      ws.onclose = () => { if (stopped) return; onStatus('reconnecting'); tm = setTimeout(() => { open(); snapshot(); }, Math.min(15000, 1000 * Math.pow(2, ++retry))); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    } catch (e) { onStatus('error', 'Could not open Binance depth stream.'); }
  }
  // The ~320 KB snapshot only runs while the page is visible (a backgrounded phone tab would
  // keep pulling it every 2 min). Back on screen: one snapshot if the last is older than the
  // refresh period. The diff stream keeps running while hidden, so the book stays current.
  const tickSnap = () => { if (!stopped && !document.hidden) snapshot(); };
  const onVis = () => { if (!stopped && !document.hidden && Date.now() - lastSnap >= BOOK_REFRESH_MS) snapshot(); };
  document.addEventListener('visibilitychange', onVis);
  snapshot(); open();
  refresh = setInterval(tickSnap, BOOK_REFRESH_MS);
  const stop = () => { stopped = true; clearTimeout(tm); clearInterval(refresh); document.removeEventListener('visibilitychange', onVis); try { if (ws) ws.close(); } catch (e) {} };
  stop.tick = tickSnap; // test hooks: run one refresh-interval tick now; age the last snapshot
  stop.age = (ms) => { lastSnap -= ms; };
  return stop;
}
// ONE SAMPLE = the book bucketed AT STORE TIME into price rows of `step`, over +-range of the
// mid: { ts, mid, bb, ba, step, i0, v } where v is a dense Float32Array, row k = price bucket
// i0 + k ([ (i0+k)*step, (i0+k+1)*step )), value = summed size, + bids / - asks. The mid's
// own row is left empty (it would hold both sides), bids only sit below it and asks above.
// Leading / trailing empty rows are trimmed. BTC at $84k, $25 rows, +-2%: <= 136 rows ~ 540 B.
// Recent samples also carry a fine layer { fs, fi0, fv } (same layout; BTC: $2.50 rows over
// +-0.5%, <= 336 rows ~ 1.3 KB), dropped once the sample is older than 30 min.
function bookMid(bestBid, bestAsk) {
  return bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk || 0);
}
const rowOf = (p, step) => Math.floor(p / step + 1e-9);
function bucketBook(book, step, range) {
  const mid = bookMid(book.bestBid, book.bestAsk);
  if (!(mid > 0) || !(step > 0)) return null;
  const mi = rowOf(mid, step), lo = rowOf(mid * (1 - range), step), hi = rowOf(mid * (1 + range), step);
  const v = new Float32Array(hi - lo + 1);
  book.bids.forEach((q, p) => { if (q > 0) { const i = rowOf(p, step); if (i < mi && i >= lo) v[i - lo] += q; } });
  book.asks.forEach((q, p) => { if (q > 0) { const i = rowOf(p, step); if (i > mi && i <= hi) v[i - lo] -= q; } });
  let a = 0, b = v.length - 1;
  while (a <= b && v[a] === 0) a++;
  while (b >= a && v[b] === 0) b--;
  return { ts: book.ts || Date.now(), mid, bb: book.bestBid, ba: book.bestAsk, step, i0: lo + a, v: a > b ? new Float32Array(0) : (a > 0 || b < v.length - 1 ? v.slice(a, b + 1) : v) };
}
// Append one sample; drop samples older than 6 h; every 60 samples thin everything older than
// 30 min to one sample per 5 s (recent detail stays at 1 s).
function pushBookSample(history, s) {
  history.push(s);
  const cutoff = s.ts - BOOK_KEEP_MS;
  let k = 0;
  while (k < history.length && history[k].ts < cutoff) k++;
  if (k) history.splice(0, k);
  if (history.length % 60 === 0 || history.length > BOOK_HISTORY_MAX) return thinHistory(history, s.ts);
  return history;
}
function thinHistory(history, now) {
  const edge = now - BOOK_FINE_MS, out = [];
  let last = -Infinity;
  for (const h of history) {
    if (h.ts >= edge) { out.push(h); continue; }
    if (h.fv) { h.fv = null; h.fs = 0; h.fi0 = 0; }
    if (h.ts - last >= BOOK_THIN_MS - 50) { out.push(h); last = h.ts; }
  }
  return out;
}

// ---- persistence: bucketed history per symbol in IndexedDB (6 h cap, oldest dropped) ----
// Chunks of up to 30 samples, written every 30 s, when the tab hides and on pagehide. A reload
// or a later visit loads the chunks of the last 6 h and prepends them to the feed's history.
const DOM_DB = 'stryker_dom', DOM_STORE = 'chunks', DOM_FLUSH_MS = 30000;
let domDbP = null;
function domDb() {
  if (domDbP) return domDbP;
  domDbP = new Promise((resolve) => {
    try {
      if (!window.indexedDB) { resolve(null); return; }
      const req = window.indexedDB.open(DOM_DB, 1);
      req.onupgradeneeded = () => {
        const st = req.result.createObjectStore(DOM_STORE, { keyPath: 'id' });
        st.createIndex('key', 'key');
      };
      req.onsuccess = () => { domPruneAll(req.result); resolve(req.result); };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return domDbP;
}
// Once per page load (the db opens once): drop every chunk that ended more than 6 h ago, for
// ALL symbols. domSave only prunes the symbol it writes, so a symbol never reopened would keep
// its chunks forever. One cursor pass; a chunk is ~15-40 KB, a 6 h symbol ~720 chunks at most.
let domPruneP = null;
function domPruneAll(db) {
  if (domPruneP) return domPruneP;
  domPruneP = new Promise((resolve) => {
    let n = 0;
    try {
      const tx = db.transaction(DOM_STORE, 'readwrite'), old = Date.now() - BOOK_KEEP_MS;
      tx.objectStore(DOM_STORE).openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return;
        if (!(cur.value.t1 >= old)) { cur.delete(); n++; }
        cur.continue();
      };
      tx.oncomplete = () => resolve(n); tx.onerror = () => resolve(n); tx.onabort = () => resolve(n);
    } catch (e) { resolve(n); }
  });
  return domPruneP;
}
// Test hook: fire every book feed's 2-min snapshot ticker once (as if the interval elapsed).
export function domDebugSnapTick(ageMs) { let n = 0; bookFeeds.forEach((f) => { if (f.stop && f.stop.tick) { if (ageMs) f.stop.age(ageMs); f.stop.tick(); n++; } }); return n; }
// Test hook: open the db (which runs the page-load prune) and resolve with the deleted count.
export function domPruned() { return domDb().then((db) => (db ? domPruneAll(db) : 0)); }
function packChunk(key, list) {
  const n = list.length;
  let len = 0, flen = 0; list.forEach(s => { len += s.v.length; flen += s.fv ? s.fv.length : 0; });
  const ts = new Float64Array(n), mid = new Float64Array(n), bb = new Float64Array(n), ba = new Float64Array(n), step = new Float64Array(n);
  const i0 = new Int32Array(n), cnt = new Int32Array(n), v = new Float32Array(len);
  const fs = new Float64Array(n), fi0 = new Int32Array(n), fcnt = new Int32Array(n), fv = new Float32Array(flen);
  let o = 0, fo = 0;
  list.forEach((s, k) => {
    ts[k] = s.ts; mid[k] = s.mid; bb[k] = s.bb || 0; ba[k] = s.ba || 0; step[k] = s.step; i0[k] = s.i0; cnt[k] = s.v.length; v.set(s.v, o); o += s.v.length;
    if (s.fv) { fs[k] = s.fs; fi0[k] = s.fi0; fcnt[k] = s.fv.length; fv.set(s.fv, fo); fo += s.fv.length; }
  });
  const c = { id: key + '|' + list[0].ts, key, t0: list[0].ts, t1: list[n - 1].ts, ts, mid, bb, ba, step, i0, cnt, v };
  if (flen) Object.assign(c, { fs, fi0, fcnt, fv });
  return c;
}
function unpackChunk(c) {
  const out = [], fine = c.fv && c.t1 >= Date.now() - BOOK_FINE_MS;
  let o = 0, fo = 0;
  for (let k = 0; k < c.ts.length; k++) {
    const n = c.cnt[k];
    const s = { ts: c.ts[k], mid: c.mid[k], bb: c.bb[k] || null, ba: c.ba[k] || null, step: c.step[k], i0: c.i0[k], v: c.v.slice(o, o + n) };
    o += n;
    if (c.fv) {
      const fn = c.fcnt[k];
      if (fine && fn) { s.fs = c.fs[k]; s.fi0 = c.fi0[k]; s.fv = c.fv.slice(fo, fo + fn); }
      fo += fn;
    }
    out.push(s);
  }
  return out;
}
async function domSave(f) {
  if (!f.pending.length) return;
  const list = f.pending; f.pending = [];
  const db = await domDb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(DOM_STORE, 'readwrite'), st = tx.objectStore(DOM_STORE);
      st.put(packChunk(f.key, list));
      // drop this symbol's chunks that ended more than 6 h ago
      // and strip the fine layer from chunks older than 30 min (the coarse rows stay)
      const old = Date.now() - BOOK_KEEP_MS, fineOld = Date.now() - BOOK_FINE_MS;
      st.index('key').openCursor(IDBKeyRange.only(f.key)).onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return;
        const c = cur.value;
        if (c.t1 < old) cur.delete();
        else if (c.fv && c.t1 < fineOld) { delete c.fs; delete c.fi0; delete c.fcnt; delete c.fv; cur.update(c); }
        cur.continue();
      };
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    } catch (e) { resolve(); }
  });
}
async function domLoad(f) {
  const db = await domDb();
  if (!db) return [];
  const rows = await new Promise((resolve) => {
    try {
      const req = db.transaction(DOM_STORE, 'readonly').objectStore(DOM_STORE).index('key').getAll(IDBKeyRange.only(f.key));
      req.onsuccess = () => resolve(req.result || []); req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
  const cutoff = Date.now() - BOOK_KEEP_MS, out = [];
  rows.filter(c => c.t1 >= cutoff).sort((a, b) => a.t0 - b.t0).forEach(c => unpackChunk(c).forEach(s => { if (s.ts >= cutoff) out.push(s); }));
  out.sort((a, b) => a.ts - b.ts);
  // two tabs on one symbol both write: keep one sample per ~second
  return out.filter((s, k) => k === 0 || s.ts - out[k - 1].ts >= 500);
}
// Test hook (parity with the book recorder): a Binance /depth snapshot -> the sample a fresh
// feed with no manual bucket stores (book Maps built in snapshot order, like binanceBookSource).
export function domParity(d, ts) {
  const bids = new Map(), asks = new Map();
  for (const r of d.bids || []) { const p = Number(r[0]), q = Number(r[1]); if (Number.isFinite(p) && Number.isFinite(q) && q > 0) bids.set(p, q); }
  for (const r of d.asks || []) { const p = Number(r[0]), q = Number(r[1]); if (Number.isFinite(p) && Number.isFinite(q) && q > 0) asks.set(p, q); }
  let bestBid = null, bestAsk = null;
  bids.forEach((q, p) => { if (bestBid == null || p > bestBid) bestBid = p; });
  asks.forEach((q, p) => { if (bestAsk == null || p < bestAsk) bestAsk = p; });
  const book = { bids, asks, bestBid, bestAsk, ts };
  const mid = bookMid(bestBid, bestAsk);
  if (!(mid > 0)) return null;
  const { step, range } = bookStoreRule(mid, 0, null);
  return bucketBook(book, step, range);
}
// Test hook: write every feed's pending samples now (a reload test awaits this).
export function domFlush() { return Promise.all([...bookFeeds.values()].map(f => domSave(f))); }
let domPageHooks = false, domTzSeen = '';
function domHookPage() {
  if (domPageHooks) return;
  domPageHooks = true;
  domDb(); // opens the db now, which runs the all-symbol prune once per page load
  domTzSeen = chartTz();
  try {
    window.STRYKER_VELA.on('state:changed', () => {
      const tz = chartTz();
      if (tz !== domTzSeen) { domTzSeen = tz; bookFeeds.forEach((f) => f.bump()); }
    });
  } catch (e) {}
  const all = () => { bookFeeds.forEach(f => { domSave(f); }); };
  window.addEventListener('pagehide', all);
  document.addEventListener('visibilitychange', () => { if (document.hidden) all(); });
}

// ---- book recorder: 24 h of server-side history (workers/book-recorder) ----
// A Cloudflare Worker samples Binance's spot book once a minute per recorded symbol, 24/7, with
// the same bucketing as bucketBook (parity-tested), so on open the heatmap is filled across the
// visible chart instead of only from when this page started recording. Spot symbols only (the
// USD-M perp book is a different book). Any failure (offline, 404 for a symbol it does not
// record, blocked) is silent: the indicator then behaves exactly as without the recorder.
const BOOK_RECORDER_URL = 'https://book-recorder.theelitegrey.workers.dev';
const BOOK_REMOTE_KEEP_MS = 24 * 60 * 60 * 1000;
const BOOK_REMOTE_SPAN_MS = 60000;      // one recorder sample stands for the minute after it
const BOOK_REMOTE_ALIGN_MS = 15 * 60000; // 'from' rounded down to 15 min: viewers share the edge cache
const BOOK_REMOTE_RETRY_MS = 5 * 60000;
function recorderUrl() {
  try { if (typeof window !== 'undefined' && window.__STK_BOOK_RECORDER !== undefined) return window.__STK_BOOK_RECORDER; } catch (e) {}
  return BOOK_RECORDER_URL;
}
// Wire format of GET /book-history (little-endian):
//   'BKR1' | u32 count | per sample: f64 ts, f64 mid, f64 bb, f64 ba, f64 step, i32 i0, u32 n, n x f32
export function decodeBookHistory(buf) {
  if (!buf || buf.byteLength < 8) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x424B5231) return null;
  const n = dv.getUint32(4, true), out = [];
  let o = 8;
  for (let k = 0; k < n; k++) {
    if (o + 48 > buf.byteLength) return null;
    const len = dv.getUint32(o + 44, true);
    if (o + 48 + len * 4 > buf.byteLength) return null;
    const s = { ts: dv.getFloat64(o, true), mid: dv.getFloat64(o + 8, true), bb: dv.getFloat64(o + 16, true) || null, ba: dv.getFloat64(o + 24, true) || null,
      step: dv.getFloat64(o + 32, true), i0: dv.getInt32(o + 40, true), v: new Float32Array(len), span: BOOK_REMOTE_SPAN_MS, remote: true };
    o += 48;
    for (let j = 0; j < len; j++, o += 4) s.v[j] = dv.getFloat32(o, true);
    if (Number.isFinite(s.ts) && s.mid > 0 && s.step > 0) out.push(s);
  }
  return out;
}
// Recorder samples + this page's own samples (IndexedDB + live), sorted by time. Where both
// exist the page's own wins: a recorder sample is dropped when any local sample falls inside
// the minute it stands for (or up to 5 s before it). Both inputs sorted by ts.
export function mergeBookHistory(remote, local) {
  if (!remote || !remote.length) return local || [];
  if (!local || !local.length) return remote;
  const keep = [];
  let j = 0;
  for (const r of remote) {
    const span = r.span || BOOK_REMOTE_SPAN_MS;
    while (j < local.length && local[j].ts < r.ts - 5000) j++;
    if (j < local.length && local[j].ts < r.ts + span) continue;
    keep.push(r);
  }
  if (!keep.length) return local;
  const out = new Array(keep.length + local.length);
  let a = 0, b = 0, o = 0;
  while (a < keep.length || b < local.length) out[o++] = b >= local.length || (a < keep.length && keep[a].ts <= local[b].ts) ? keep[a++] : local[b++];
  return out;
}

class BookFeed {
  constructor(provider, ticker) {
    this.provider = provider; this.ticker = ticker; this.key = bookKey(provider, ticker);
    this.base = baseAsset(ticker);
    this.status = 'loading'; this.err = ''; this.version = 0; this.refs = 0; this.listeners = new Set(); this.closeTm = 0;
    this.book = { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ts: 0 };
    this.history = []; this.lastSample = 0; this.pending = [];
    this.wants = new Map(); // listener -> { bucket, range }: what each indicator on this symbol asks for
    this.autoStep = 0;
    this.loaded = false;
    // recorder history (24 h max), the earliest time asked for so far, fetch state
    this.remote = []; this.remoteFrom = Infinity; this.remoteHeld = 0; this.remoteBusy = false; this.remoteFailAt = 0; this.remoteState = 'none';
    this.mergedKey = ''; this.merged = [];
    domHookPage();
    domLoad(this).then((old) => {
      const first = this.history.length ? this.history[0].ts : Infinity;
      const pre = old.filter(s => s.ts < first - 500);
      if (pre.length) { this.history = thinHistory(pre.concat(this.history), Date.now()); }
      this.loaded = true; this.bump();
    });
    this.flushTm = setInterval(() => domSave(this), DOM_FLUSH_MS);
    this.stop = binanceBookSource(ticker, (book) => { this.book = book; this.sample(); this.bump(); }, (st, err) => { this.status = st; this.err = err || ''; this.bump(); });
  }
  // Storage step + band for new samples: the finest manual bucket any indicator on this symbol
  // asks for (else auto ~0.05% of the price), the widest range; never more than
  // BOOK_ROWS_SIDE_MAX rows a side.
  store(mid) {
    const r = bookStoreRule(mid, this.autoStep, this.wants);
    this.autoStep = r.autoStep;
    return r;
  }
  fineStep(mid) { return nearNiceStep(mid * BOOK_FINE_ROW); }
  addFine(s, step, mid) {
    const fs = this.fineStep(mid);
    if (!(fs < step / 1.5)) return;
    const fb = bucketBook(this.book, fs, BOOK_FINE_RANGE);
    if (fb && fb.v.length) { s.fs = fs; s.fi0 = fb.i0; s.fv = fb.v; }
  }
  storeStep() { const m = bookMid(this.book.bestBid, this.book.bestAsk); return m > 0 ? this.store(m).step : 0; }
  sample() {
    const now = Date.now();
    if (now - this.lastSample < BOOK_SAMPLE_MS) return;
    const mid = bookMid(this.book.bestBid, this.book.bestAsk);
    if (!(mid > 0)) return;
    this.lastSample = now;
    const { step, range } = this.store(mid);
    const s = bucketBook(this.book, step, range);
    if (!s || !s.v.length) return;
    s.ts = now;
    this.addFine(s, step, mid);
    this.history = pushBookSample(this.history, s);
    this.pending.push(s);
  }
  // Ask the recorder for history back to `fromMs` (the left edge of the visible chart). One
  // request in flight; only the part older than what is held; a failure waits 5 min.
  needRemote(fromMs) {
    if (/\.P$/i.test(this.ticker) || this.remoteBusy) return;
    const base = recorderUrl();
    if (!base) return;
    const now = Date.now();
    if (this.remoteFailAt && now - this.remoteFailAt < BOOK_REMOTE_RETRY_MS) return;
    const from = Math.max(Math.floor((now - BOOK_REMOTE_KEEP_MS) / 60000) * 60000 + 60000, Math.floor(fromMs / BOOK_REMOTE_ALIGN_MS) * BOOK_REMOTE_ALIGN_MS);
    if (!(from < this.remoteFrom - 60000)) return;
    const to = Number.isFinite(this.remoteFrom) ? this.remoteFrom : now;
    this.remoteBusy = true;
    const sym = this.ticker.replace(/^[A-Z]+:/i, '').toUpperCase();
    fetch(base + '/book-history?symbol=' + encodeURIComponent(sym) + '&from=' + from + '&to=' + Math.ceil(to / 60000) * 60000, { credentials: 'omit' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); const t = Number(r.headers.get('x-book-from')); if (t > 0) this.remoteHeld = t; return r.arrayBuffer(); })
      .then((buf) => {
        const got = decodeBookHistory(buf);
        if (!got) throw new Error('bad body');
        const cut = Date.now() - BOOK_REMOTE_KEEP_MS, seen = new Set(this.remote.map((x) => x.ts));
        this.remote = this.remote.concat(got.filter((x) => !seen.has(x.ts))).filter((x) => x.ts >= cut).sort((x, y) => x.ts - y.ts);
        this.remoteFrom = from; this.remoteFailAt = 0; this.remoteState = 'ok';
        this.bump();
      })
      .catch(() => { this.remoteFailAt = Date.now(); if (this.remoteState === 'none') this.remoteState = 'failed'; })
      .then(() => { this.remoteBusy = false; });
  }
  // recorder + local history, merged once per change (not per frame)
  allHistory() {
    const h = this.history, r = this.remote;
    const key = r.length + ':' + (r.length ? r[0].ts : 0) + ':' + h.length + ':' + (h.length ? h[0].ts + ':' + h[h.length - 1].ts : 0);
    if (key !== this.mergedKey) { this.mergedKey = key; this.merged = mergeBookHistory(r, h); }
    return this.merged;
  }
  bump() { this.version++; this.listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
  close() { try { this.stop(); } catch (e) {} clearInterval(this.flushTm); domSave(this); }
}
function acquireBookFeed(provider, ticker, fn) {
  const key = bookKey(provider, ticker);
  let f = bookFeeds.get(key);
  if (!f) { f = new BookFeed(provider, ticker); bookFeeds.set(key, f); }
  clearTimeout(f.closeTm); f.refs++; f.listeners.add(fn);
  return { feed: f,
    want(w) { f.wants.set(fn, w); },
    release() {
      f.listeners.delete(fn); f.wants.delete(fn);
      if (--f.refs > 0) return;
      f.closeTm = setTimeout(() => { if (f.refs <= 0) { f.close(); bookFeeds.delete(key); } }, 10000);
    } };
}
// One sample's rows at the frame step -> flat [bucket, value, ...] within [iLo, iHi]. Same step:
// read straight off. A coarser frame step (an integer multiple, see render) sums rows; a sample
// stored coarser than the frame (recorded before a finer manual bucket) spreads each row evenly
// over the frame rows it covers. The frame's mid row is skipped (it would mix both sides).
function rowsAt(s, step, iLo, iHi, out) {
  const v = s.v, n = v.length, ss = s.step, mi = rowOf(s.mid, step);
  if (Math.abs(ss - step) < 1e-9 * step) {
    for (let k = 0; k < n; k++) { const i = s.i0 + k, x = v[k]; if (x !== 0 && i >= iLo && i <= iHi && i !== mi) out.push(i, x); }
    return out;
  }
  if (ss < step) {
    let cur = 0, acc = 0, has = false;
    const flush = () => { if (has && acc !== 0 && cur >= iLo && cur <= iHi && cur !== mi) out.push(cur, acc); };
    for (let k = 0; k < n; k++) {
      if (v[k] === 0) continue;
      const i = Math.floor((s.i0 + k + 0.5) * ss / step);
      if (has && i !== cur) { flush(); acc = 0; }
      if (has && acc !== 0 && Math.sign(acc) !== Math.sign(v[k])) { flush(); acc = 0; }
      cur = i; has = true; acc += v[k];
    }
    flush();
    return out;
  }
  const per = Math.max(1, Math.round(ss / step));
  for (let k = 0; k < n; k++) {
    const x = v[k];
    if (x === 0) continue;
    const j0 = rowOf((s.i0 + k) * ss, step);
    for (let j = j0; j < j0 + per; j++) if (j >= iLo && j <= iHi && j !== mi) out.push(j, x / per);
  }
  return out;
}
// A sample's rows at the frame step, fine layer first: when the frame step is finer than the
// coarse rows and the sample has a fine layer, rows inside the fine band come from it and the
// rest from the coarse rows (spread evenly), so close zooms are sharp near the price and the
// far levels still show.
function sampleRows(s, step, iLo, iHi, out) {
  if (!s.fv || !(step < s.step) || s.fs > step * 1.0001) return rowsAt(s, step, iLo, iHi, out);
  const fLo = rowOf(s.fi0 * s.fs + s.fs * 0.5, step), fHi = rowOf((s.fi0 + s.fv.length) * s.fs - s.fs * 0.5, step);
  rowsAt({ mid: s.mid, step: s.fs, i0: s.fi0, v: s.fv }, step, Math.max(iLo, fLo), Math.min(iHi, fHi), out);
  if (iLo < fLo) rowsAt(s, step, iLo, fLo - 1, out);
  if (iHi > fHi) rowsAt(s, step, fHi + 1, iHi, out);
  return out;
}
let domStep = 0, domRebinMs = null, domRebinCols = 0;
const quant = (sorted, f) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * f)))] : 0;
let domLast = null; // last frame summary, for the browser test (window.__stkFlow.domDebug())
export function domDebug() { return domLast; }
// Test hook: fill every open book feed's history to the full 6 h cap (1 s samples for the newest
// 30 min, 5 s before that, ending at the oldest real sample), bucketed from its current book
// with a small random walk, so the real indicator draws a full-cap history. Returns the feed's
// sample count and bytes. (binLast / binStep are accepted for older callers and ignored: rows
// are bucketed at store time, nothing is cached per frame.)
// Test hook (tools/tests/chart-liquidity-browser.js): replace the page's recorded book with recorded samples
// ({ ts, mid, bb, ba, step, i0, v, fs, fi0, fv } with plain arrays), as if this page had recorded them.
export function domDebugLoad(samples) {
  let n = 0;
  bookFeeds.forEach((f) => {
    f.history = samples.map((s) => Object.assign({}, s, { v: Float32Array.from(s.v), fv: s.fv ? Float32Array.from(s.fv) : undefined }));
    f.bump(); n++;
  });
  return n;
}
export function domDebugFill() {
  const out = [];
  bookFeeds.forEach((f) => {
    const mid0 = bookMid(f.book.bestBid, f.book.bestAsk);
    if (!(mid0 > 0)) return;
    const { step, range } = f.store(mid0);
    const base = bucketBook(f.book, step, range);
    if (!base) return;
    const fs = f.fineStep(mid0), fb = fs < step / 1.5 ? bucketBook(f.book, fs, BOOK_FINE_RANGE) : null;
    const t0 = f.history.length ? f.history[0].ts : Date.now();
    const syn = [];
    let t = t0, shift = 0;
    const fineEdge = Date.now() - BOOK_FINE_MS;
    for (let k = 0; k < BOOK_HISTORY_MAX * 2 && t > Date.now() - BOOK_KEEP_MS + BOOK_THIN_MS; k++) {
      t -= t > fineEdge ? BOOK_SAMPLE_MS : BOOK_THIN_MS;
      shift += Math.round((Math.random() - 0.5) * 2) * step;
      const v = new Float32Array(base.v.length);
      for (let j = 0; j < v.length; j++) v[j] = base.v[j] * (0.6 + Math.random() * 0.8);
      const s = { ts: t, mid: mid0 + shift, bb: base.bb + shift, ba: base.ba + shift, step, i0: base.i0 + Math.round(shift / step), v };
      if (fb && t > fineEdge) { const w = new Float32Array(fb.v.length); for (let j = 0; j < w.length; j++) w[j] = fb.v[j] * (0.6 + Math.random() * 0.8); s.fs = fs; s.fi0 = fb.i0 + Math.round(shift / fs); s.fv = w; }
      syn.push(s);
    }
    syn.reverse();
    f.history = syn.concat(f.history);
    f.bump();
    out.push(Object.assign({ key: f.key, levelsInBook: f.book.bids.size + f.book.asks.size, step, rows: base.v.length }, domDebugBytes(f)));
  });
  return out;
}
// Bytes the history holds: row data + ~140 B per sample (object, Float32Array header, numbers).
export function domDebugBytes(f) {
  let samples = 0, bytes = 0, rows = 0;
  (f ? [f] : [...bookFeeds.values()]).forEach((x) => x.history.forEach((s) => {
    samples++; rows += s.v.length; bytes += s.v.byteLength + 140 + (s.fv ? s.fv.byteLength + 80 : 0);
  }));
  return { samples, avgLevels: samples ? Math.round(rows / samples) : 0, avgRows: samples ? Math.round(rows / samples) : 0, binned: 0, bytes };
}
// HH:MM for the book-history note in the CHART's timezone (the one its time axis and clock use: the
// workspace's timezone, WS.getState().timezone; default Etc/UTC), not the browser's.
function chartTz() {
  let tz = '';
  try { const w = window.STRYKER_VELA; tz = (w && w.timezone) || (w && w.getState && w.getState().timezone) || ''; } catch (e) {}
  return !tz || tz === 'UTC' ? 'Etc/UTC' : tz;
}
const tzFmt = new Map();
function hhmm(ms, tz) {
  let f = tzFmt.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Etc/UTC', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }); }
    tzFmt.set(tz, f);
  }
  const p = f.formatToParts(new Date(ms));
  const g = (k) => (p.find((x) => x.type === k) || {}).value || '00';
  return g('hour') + ':' + g('minute');
}
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
function cryptoDomLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = beginFrame(canvas, a.coords);
      if (!g || !a.data || a.data.off || !a.bars.length) return;
      const f = bookFeeds.get(a.data.feed);
      if (!f || !f.book) return;
      const tStart = performance.now();
      const cfg = a.data.cfg, co = a.coords, top = a.bounds.top, bot = top + a.bounds.height;
      const font = (a.theme && a.theme.fontFamily) || 'sans-serif';
      const light = themeIsLight(a.theme) || pageIsDay();
      const W = co.width;
      const span = Math.max(1e-12, a.scale.max - a.scale.min);
      const yOf = (p) => co.priceToY(p, a.scale, a.bounds);
      // Price row: manual size, or "auto" = a nice step of ~1/120 of the visible range, at least
      // 3 px tall. Never finer than the rows the history is stored in; a coarser frame step is a
      // whole multiple of the stored step, so stored rows sum exactly.
      const sst = f.storeStep() || (f.history.length ? f.history[f.history.length - 1].step : 0);
      let step = cfg.bucket;
      if (!(step > 0)) {
        step = niceStep(span / 120);
        const midP = (a.scale.min + a.scale.max) / 2;
        const pxStep = Math.abs(yOf(midP + step) - yOf(midP));
        if (pxStep < 3) step = niceStep(step * 3 / Math.max(pxStep, 0.01));
      }
      // Frame step: a whole multiple of the stored rows (coarse, or the fine layer when the frame
      // is finer than the coarse rows), so stored rows sum exactly.
      const mid0 = bookMid(f.book.bestBid, f.book.bestAsk);
      const fst = mid0 > 0 ? f.fineStep(mid0) : 0;
      const unit = sst > 0 && step < sst * 0.999 && fst > 0 && fst < sst / 1.5 ? fst : sst;
      if (unit > 0) step = step <= unit * 1.0001 ? unit : unit * Math.max(1, Math.round(step / unit));
      const iLo = Math.floor(a.scale.min / step) - 1, iHi = Math.ceil(a.scale.max / step) + 1;
      const rowY = (i) => { const y0 = yOf((i + 1) * step), y1 = yOf(i * step); return [Math.min(y0, y1), Math.abs(y1 - y0)]; };
      // Depth bars: ~widthPct of the chart, in the empty space right of "now" when the chart
      // has one (so they never sit on the newest candles), else against the price scale.
      // The heatmap and walls end where the depth bars start.
      let depthW = cfg.depth ? Math.max(36, Math.round(W * cfg.widthPct)) : 0;
      let depthX = W - depthW;
      if (cfg.depth) {
        const xNow = co.timeToX(Date.now()) + Math.max(3, co.pxPerBar ? co.pxPerBar() / 2 : 3) + 4;
        if (Number.isFinite(xNow) && xNow > depthX && xNow < W - 36) { depthX = xNow; depthW = W - xNow; }
      }
      const right = cfg.depth ? depthX - 2 : W;
      const bidRgb = rgbOf(cfg.bid).join(','), askRgb = rgbOf(cfg.ask).join(',');
      const stat = { view: cfg.view, step, storeStep: sst, fineStep: fst, samples: 0, columns: 0, cells: 0, depthBars: 0, walls: [], base: f.base, width: W,
        scaleMin: a.scale.min, scaleMax: a.scale.max };

      // ---- history -> pixel columns (>= 2 px wide), x from the chart's own time axis ----
      const now = Date.now();
      // left edge of the visible chart (first bar at x >= 0): the recorder is asked back to it
      let lo = 0, hi = a.bars.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (co.timeToX(a.bars[m].time) < 0) lo = m + 1; else hi = m; }
      const visFrom = a.bars[lo] ? a.bars[lo].time : now;
      if (cfg.heat || cfg.walls) f.needRemote(Math.max(visFrom, now - cfg.historyMin * 60000));
      const all = f.allHistory();
      const hist = all.filter(h => now - h.ts <= cfg.historyMin * 60000);
      stat.samples = hist.length; stat.histFrom = hist.length ? hist[0].ts : 0; stat.recordedFrom = f.history.length ? f.history[0].ts : 0;
      stat.remoteSamples = f.remote.length; stat.remoteFrom = f.remote.length ? f.remote[0].ts : 0; stat.remoteState = f.remoteState; stat.visFrom = visFrom;
      const newest = f.history[f.history.length - 1];
      if (newest) { stat.rowLo = newest.i0 * newest.step; stat.rowHi = (newest.i0 + newest.v.length) * newest.step; stat.mid = newest.mid; stat.rows = newest.v.length; }
      const cols = [];
      if (cfg.heat || cfg.walls) {
        for (let k = 0; k < hist.length; k++) {
          const s = hist[k];
          const x0 = co.timeToX(s.ts);
          // a column never stretches over a gap (page closed / thinned): at most 10 s wide, or the
          // minute a recorder sample stands for
          const tEnd = k + 1 < hist.length ? Math.min(hist[k + 1].ts, s.ts + (s.span || 10000)) : s.ts + (s.span || BOOK_SAMPLE_MS);
          const x1 = co.timeToX(tEnd);
          if (!Number.isFinite(x0) || x1 < 0 || x0 > right) continue;
          const last = cols[cols.length - 1];
          if (last && x0 - last.x0 < 2 && s.ts - last.ts1 < Math.max(10000, last.s.span || 0)) { last.x1 = x1; last.s = s; last.ts1 = s.ts; continue; }
          cols.push({ x0, x1, s, ts0: s.ts, ts1: s.ts });
        }
      }
      // visible values (all columns + the current book) -> percentiles
      const range = cfg.range;
      const curS = bucketBook(f.book, step, range);
      const curFlat = curS ? rowsAt(curS, step, iLo, iHi, []) : [];
      const vals = [];
      let rLo = Infinity, rHi = -Infinity;
      const colBins = cols.map(c => {
        const out = sampleRows(c.s, step, iLo, iHi, []);
        for (let k = 0; k < out.length; k += 2) { vals.push(Math.abs(out[k + 1])); if (out[k] < rLo) rLo = out[k]; if (out[k] > rHi) rHi = out[k]; }
        return out;
      });
      if (rHi >= rLo) { stat.dataLo = rLo * step; stat.dataHi = (rHi + 1) * step; }
      const curRows = [];
      for (let k = 0; k < curFlat.length; k += 2) curRows.push([curFlat[k], curFlat[k + 1]]);
      if (!vals.length) curRows.forEach(r => vals.push(Math.abs(r[1])));
      vals.sort((x, y) => x - y);
      const qLo = quant(vals, cfg.hide), cap = Math.max(qLo * 1.0001, quant(vals, 0.985));
      stat.columns = cols.length; stat.heatX0 = cols.length ? Math.round(Math.max(0, cols[0].x0)) : null;

      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();

      // ---- heatmap: run-length merged cells per bucket ----
      if (cfg.heat && cols.length) {
        g.save(); g.beginPath(); g.rect(0, top, Math.max(0, right), a.bounds.height); g.clip();
        const open = new Map(); // bucket -> { x0, x1, style }
        let hLo = Infinity, hHi = -Infinity;
        const flush = (i, r) => {
          const [y, h] = rowY(i);
          if (y > bot || y + h < top) return;
          g.fillStyle = r.style; g.fillRect(r.x0, y, Math.max(1, r.x1 - r.x0 + 0.5), h + 0.5); stat.cells++;
          if (i < hLo) hLo = i; if (i > hHi) hHi = i;
        };
        const styleOf = (v) => {
          const n = Math.pow(Math.max(0, (Math.abs(v) - qLo) / (cap - qLo)), 0.75);
          if (n < 0.04) return null;
          if (cfg.twoTone) { const al = Math.round(cfg.opacity * Math.min(1, n * 1.3) * 20) / 20; return al > 0 ? 'rgba(' + (v > 0 ? bidRgb : askRgb) + ',' + al + ')' : null; }
          // Deep: a steeper curve keeps ordinary size teal and saves yellow / red for the biggest resting orders
          const nq = Math.round((cfg.deep ? Math.pow(n, 1.7) : n) * 24) / 24; const c = deepColor(nq);
          return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (cfg.opacity * Math.min(1, 0.35 + nq)).toFixed(2) + ')';
        };
        for (let c = 0; c < cols.length; c++) {
          const col = cols[c], arr = colBins[c], seen = new Set();
          for (let k = 0; k < arr.length; k += 2) {
            const i = arr[k], v = arr[k + 1];
            if (Math.abs(v) < qLo) continue;
            const st = styleOf(v);
            if (!st) continue;
            seen.add(i);
            const r = open.get(i);
            if (r && r.style === st && col.x0 - r.x1 < 1.5) { r.x1 = col.x1; continue; }
            if (r) flush(i, r);
            open.set(i, { x0: col.x0, x1: col.x1, style: st });
          }
          open.forEach((r, i) => { if (!seen.has(i)) { flush(i, r); open.delete(i); } });
        }
        open.forEach((r, i) => flush(i, r));
        g.restore();
        if (hHi >= hLo) { stat.heatLo = hLo * step; stat.heatHi = (hHi + 1) * step; }
        if ((cfg.view === 'heat' || cfg.deep) && cfg.showScale && !(cfg.deep && cfg.depth)) {
          // top-right corner (the chart legend owns the top-left), on a small backing box
          g.font = '10px ' + font; g.textAlign = 'left';
          const sw = 8, sh = Math.min(72, a.bounds.height - 40), bw = sw + 10 + g.measureText('More').width;
          const bx = W - bw - 8, sx = bx + 4, sy = top + 10;
          g.fillStyle = light ? 'rgba(255,255,255,.88)' : 'rgba(5,5,6,.85)'; g.fillRect(bx, sy - 4, bw + 4, sh + 8);
          const grd = g.createLinearGradient(0, sy + sh, 0, sy);
          DEEP_RAMP.forEach((c, k) => grd.addColorStop(k / (DEEP_RAMP.length - 1), 'rgb(' + c.join(',') + ')'));
          g.fillStyle = grd; g.fillRect(sx, sy, sw, sh);
          g.fillStyle = light ? 'rgba(30,41,59,.9)' : 'rgba(226,232,240,.9)';
          g.fillText('More', sx + sw + 4, sy + 8); g.fillText('Less', sx + sw + 4, sy + sh);
        }
      }

      // ---- walls: top sizes that persisted, tracked per (bucket, side) ----
      if (cfg.walls && cols.length) {
        const thr = Math.max(qLo, quant(vals, 1 - cfg.wallTop));
        const seen = new Map();
        for (let c = 0; c < cols.length; c++) {
          const arr = colBins[c], col = cols[c];
          for (let k = 0; k < arr.length; k += 2) {
            const v = arr[k + 1];
            if (Math.abs(v) < thr) continue;
            const side = v > 0 ? 1 : -1, key = arr[k] * 2 + (side > 0 ? 1 : 0);
            let w = seen.get(key);
            if (!w) { w = { i: arr[k], side, t0: col.ts0, t1: col.ts1, x0: col.x0, x1: col.x1, max: 0, lastC: c, last: 0 }; seen.set(key, w); }
            w.t1 = col.ts1; w.x1 = col.x1; w.max = Math.max(w.max, Math.abs(v)); w.lastC = c; w.last = Math.abs(v);
          }
        }
        const list = [...seen.values()].filter(w => w.t1 - w.t0 >= cfg.wallMinMs).sort((x, y) => y.max - x.max).slice(0, 12);
        // Deep: did a big level vanish (pulled) or trade away (filled)? Only levels gone before the newest
        // column, checked against the crypto footprint trades at that price (null = trades do not reach back).
        if (cfg.vanish && list.length) {
          const tf = cryptoFeed('binance:' + f.ticker.toUpperCase());
          const mins = tf.bars(), tick = tf.tick || 0;
          const curMap = new Map(curRows);
          for (const w of list) {
            if (w.lastC >= cols.length - 1) continue;
            const nowV = curMap.get(w.i) || 0;
            if ((w.side > 0 ? nowV : -nowV) >= 0.25 * w.last) continue;   // it is back: not gone
            const nxt = cols[w.lastC + 1];
            const nv = (() => { const arr = colBins[w.lastC + 1]; for (let k = 0; k < arr.length; k += 2) if (arr[k] === w.i) return arr[k + 1]; return 0; })();
            if ((w.side > 0 ? nv : -nv) >= 0.25 * w.last) continue;
            w.goneAt = nxt.ts0;
            const traded = tick > 0 && mins.length ? tradedAt(mins, tick, w.i * step, (w.i + 1) * step, cols[w.lastC].ts0, nxt.ts1 + 1000, w.side, tf.coverFrom) : null;
            w.traded = traded; w.kind = vanishKind(w.last, traded);
          }
        }
        const mxv = list.length ? list[0].max : 1;
        const used = [];
        const fs = 11, maxLabels = W < 500 ? 6 : 12; // phones: fewer labels, biggest first
        g.font = 'bold ' + fs + 'px ' + font;
        g.textAlign = 'left'; g.textBaseline = 'middle';
        stat.vanished = [];
        for (const w of list) {
          const y = Math.round(yOf((w.i + 0.5) * step)) + 0.5;
          if (y < top || y > bot) continue;
          const rgb = w.side > 0 ? bidRgb : (cfg.deep ? rgbOf(cfg.askDepth).join(',') : askRgb);
          g.strokeStyle = 'rgba(' + rgb + ',' + (cfg.heat ? 0.95 : 0.85) + ')';
          g.lineWidth = cfg.deep ? 1 + 2 * (w.max / mxv) : 1.5 + 4 * (w.max / mxv);
          const xe = Math.min(right, w.x1);
          g.beginPath(); g.moveTo(Math.max(0, w.x0), y); g.lineTo(xe, y); g.stroke();
          const lab = fmtSize(w.max) + ' ' + f.base;
          const rec = { label: lab, side: w.side > 0 ? 'bid' : 'ask', price: (w.i + 0.5) * step, drawn: false, kind: w.kind || null };
          stat.walls.push(rec);
          if (w.kind) stat.vanished.push({ price: rec.price, kind: w.kind, last: w.last, traded: w.traded, side: rec.side });
          if (!cfg.wallSizes || used.length >= maxLabels || y < top + 10 || y > bot - 8) continue;
          const gone = cfg.deep && w.goneAt != null;
          const tag = gone && w.kind ? (w.kind === 'filled' ? ' FILLED' : ' PULLED') : '';
          const txt = lab + tag;
          const tw = g.measureText(txt).width;
          // a gone level is labelled where it ended, a live one at the right edge
          let tx = gone ? xe + 6 : right - tw - 8;
          if (gone && tx + tw > right - 4) tx = xe - tw - 8;
          if (tx < 4 || used.some(u => Math.abs(u.y - y) < 15 && tx < u.x1 + 4 && tx + tw > u.x0 - 4)) continue;
          used.push({ y, x0: tx, x1: tx + tw });
          g.fillStyle = light ? 'rgba(255,255,255,.88)' : 'rgba(5,5,6,.85)';
          g.fillRect(tx - 3, y - 8, tw + 6, 16);
          g.fillStyle = 'rgb(' + rgb + ')';
          g.fillText(lab, tx, y + 0.5);
          if (tag) {
            g.fillStyle = w.kind === 'filled' ? '#f5b301' : (light ? '#64748b' : '#a3a9b6');
            g.fillText(tag, tx + g.measureText(lab).width, y + 0.5);
            // a small end cap: a filled square = traded away, a hollow one = pulled
            g.strokeStyle = g.fillStyle; g.lineWidth = 1.2;
            if (w.kind === 'filled') g.fillRect(xe - 3, y - 3, 6, 6); else g.strokeRect(xe - 3, y - 3, 6, 6);
          }
          rec.drawn = true;
        }
        g.textBaseline = 'alphabetic';
      }

      // ---- iceberg hint (Deep): only on minutes this page recorded at 1 sample a second ----
      stat.ice = [];
      if (cfg.ice && cols.length) {
        const tf = cryptoFeed('binance:' + f.ticker.toUpperCase());
        const mins = tf.bars().filter((b) => b.t >= tf.coverFrom), tick = tf.tick || 0;
        const iStep = fst > 0 ? Math.max(fst, tick) : sst;
        const loc = f.history.filter((x) => x.ts >= visFrom);
        const ik = loc.length + ':' + (loc.length ? loc[loc.length - 1].ts : 0) + ':' + tf.v + ':' + iStep;
        if (f.iceKey !== ik) { f.iceKey = ik; f.iceEv = tick > 0 && loc.length ? icebergEvents(loc, mins, { step: iStep, tick }) : []; }
        const used = [];
        g.font = 'bold 9px ' + font; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const e of f.iceEv || []) {
          const x = co.timeToX(e.t + 30000), y = yOf(e.price + iStep / 2);
          if (!Number.isFinite(x) || x < 0 || x > right || y < top + 8 || y > bot - 8) continue;
          stat.ice.push({ t: e.t, price: e.price, side: e.side, traded: e.traded, visible: e.visible });
          if (used.some((u) => Math.abs(u.x - x) < 26 && Math.abs(u.y - y) < 12)) continue;
          used.push({ x, y });
          const tw = g.measureText('ICE').width + 6;
          g.fillStyle = light ? 'rgba(255,255,255,.92)' : 'rgba(5,5,6,.88)'; g.fillRect(x - tw / 2, y - 6, tw, 12);
          g.strokeStyle = '#38bdf8'; g.lineWidth = 1; g.strokeRect(x - tw / 2 + 0.5, y - 5.5, tw - 1, 11);
          g.fillStyle = '#38bdf8'; g.fillText('ICE', x, y + 0.5);
        }
        g.textBaseline = 'alphabetic';
      }

      // ---- depth bars: the CURRENT book only, sqrt(size / max) ----
      if (cfg.depth && curRows.length) {
        let mx = 0;
        curRows.forEach(r => { if (Math.abs(r[1]) > mx) mx = Math.abs(r[1]); });
        const x0 = depthX, wmax = depthW - 4;
        let dLo = Infinity, dHi = -Infinity;
        for (const [i, v] of curRows) {
          const [y, h] = rowY(i);
          if (y > bot || y + h < top) continue;
          const w = Math.max(1, Math.sqrt(Math.abs(v) / mx) * wmax);
          g.fillStyle = 'rgba(' + (v > 0 ? bidRgb : (cfg.deep ? rgbOf(cfg.askDepth).join(',') : askRgb)) + ',0.75)';
          g.fillRect(x0, y + (h > 3 ? 0.5 : 0), w, Math.max(1, h - (h > 3 ? 1 : 0)));
          stat.depthBars++;
          if (i < dLo) dLo = i; if (i > dHi) dHi = i;
        }
        if (dHi >= dLo) { stat.depthLo = dLo * step; stat.depthHi = (dHi + 1) * step; }
        if (depthW >= 64) {
          g.font = '10px ' + font; g.textAlign = 'left';
          const tw = g.measureText('RESTING').width;
          g.fillStyle = light ? 'rgba(255,255,255,.88)' : 'rgba(5,5,6,.85)'; g.fillRect(x0, top + 2, tw + 6, 14);
          g.fillStyle = light ? 'rgba(71,85,105,.95)' : 'rgba(139,147,160,.95)'; g.fillText('RESTING', x0 + 3, top + 12);
        }
      }

      // ---- coverage note by the heatmap's first column, so older candles with no heatmap are
      // explained honestly: "book history: 24 h" only when the recorder really holds 24 h
      // (its oldest sample, header x-book-from), else "book history from HH:MM" = the oldest
      // book data there is (the recorder's, or this page's own when the recorder is out) ----
      const remoteFirst = f.remote.length ? f.remote[0].ts : 0;
      const held = remoteFirst ? Math.min(remoteFirst, f.remoteHeld || remoteFirst) : 0;
      const full = held > 0 && held <= now - BOOK_REMOTE_KEEP_MS + 15 * 60000;
      if ((cfg.heat || cfg.walls) && cols.length && (cols[0].x0 > 2 || remoteFirst)) {
        const tz = chartTz();
        const lab = full ? 'book history: 24 h' : 'book history from ' + hhmm(held && held < cols[0].ts0 ? held : cols[0].ts0, tz);
        g.font = '10px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'middle';
        const tw = g.measureText(lab).width, x = Math.max(0, cols[0].x0);
        const tx = x - tw - 8 >= 2 ? x - tw - 6 : Math.min(x + 6, Math.max(2, right - tw - 4));
        const y = bot - 12;
        g.fillStyle = light ? 'rgba(255,255,255,.88)' : 'rgba(5,5,6,.85)'; g.fillRect(tx - 3, y - 7, tw + 6, 14);
        g.fillStyle = light ? 'rgba(71,85,105,.95)' : 'rgba(139,147,160,.95)'; g.fillText(lab, tx, y + 0.5);
        if (x > 2) {
          g.strokeStyle = light ? 'rgba(71,85,105,.5)' : 'rgba(139,147,160,.45)'; g.lineWidth = 1; g.setLineDash([2, 3]);
          g.beginPath(); g.moveTo(Math.round(x) + 0.5, top); g.lineTo(Math.round(x) + 0.5, bot); g.stroke(); g.setLineDash([]);
        }
        g.textBaseline = 'alphabetic';
        stat.since = lab; stat.sinceX = Math.round(tx); stat.sinceTs = cols[0].ts0; stat.sinceTz = tz;
      }

      if (cfg.showBest) {
        const lineAt = (price, col, label) => {
          if (!(price > 0)) return;
          const y = Math.round(yOf(price)) + 0.5;
          if (y < top || y > bot) return;
          g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(right, y); g.stroke();
          g.setLineDash([]); g.fillStyle = col; g.font = 'bold 10px ' + font; g.textAlign = 'left'; g.fillText(label, 8, y - 4);
        };
        lineAt(f.book.bestBid, cfg.bid, 'best bid');
        lineAt(f.book.bestAsk, cfg.ask, 'best ask');
      }
      g.restore();
      // timing of the frame where the bucket step changed (zoom / pan re-bins every drawn column)
      const ms = performance.now() - tStart;
      if (step !== domStep) { domStep = step; domRebinMs = Math.round(ms * 10) / 10; domRebinCols = cols.length; }
      stat.ms = Math.round(ms * 10) / 10; stat.rebinMs = domRebinMs; stat.rebinCols = domRebinCols; stat.binned = 0;
      domLast = stat;
    },
    destroy() { canvas = null; }
  };
}
// Hiding the indicator (eye) keeps the feed open, so the page keeps recording; only removing
// it, switching symbol or leaving the page stops recording for that symbol.
class CryptoDomNative {
  constructor() { this.inputs = {}; this.h = null; this.tm = 0; this.hidden = false; this.onTheme = () => this.render(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; window.addEventListener('stryker:theme', this.onTheme); this.attach(); }
  attach() {
    if (!this.ctx) return;
    const mk = marketOf(this.ctx);
    const want = mk.provider === 'binance' ? bookKey('binance', mk.ticker) : '';
    if (this.h && this.h.feed.key === want) { this.wantNow(); this.render(); return; }
    this.detach();
    this.block = want ? '' : BOOK_NEEDS_BINANCE;
    if (!this.block) { this.h = acquireBookFeed('binance', mk.ticker, () => this.later()); this.wantNow(); }
    this.render();
  }
  wantNow() { if (this.h) { const c = domConfig(this.inputs); this.h.want({ bucket: c.bucket, range: c.range }); } }
  detach() { if (this.h) { this.h.release(); this.h = null; } clearTimeout(this.tm); this.tm = 0; }
  later() { if (!this.tm && !this.hidden) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() {}
  onViewport() {}
  setInputs(i) { this.inputs = i; this.wantNow(); this.render(); }
  suspend() { this.hidden = true; clearTimeout(this.tm); this.tm = 0; }
  resume() { this.hidden = false; this.attach(); }
  stop() { this.detach(); window.removeEventListener('stryker:theme', this.onTheme); }
  note() {
    if (this.block) return this.block;
    const f = this.h && this.h.feed;
    if (!f || f.status === 'loading') return 'Loading Binance order book…';
    if (f.status === 'error') return f.err || 'Order book unavailable.';
    if (f.status === 'reconnecting') return 'Reconnecting to Binance order book…';
    const cfg = domConfig(this.inputs);
    if ((cfg.heat || cfg.walls) && f.history.length < 15 && f.remote.length < 2) return 'Building order book history…';
    return '';
  }
  render() {
    if (!this.ctx || this.hidden) return;
    const msg = this.note();
    const f = this.h && this.h.feed;
    this.ctx.setStatus(!f || this.block ? 'idle' : f.status === 'live' ? 'live' : f.status === 'error' ? 'idle' : 'loading');
    this.ctx.emit({ tables: msg ? [message('stk_dom-msg', msg, pageIsDay(), 'top_right')] : [] });
    this.ctx.pushData(f && !this.block ? { feed: f.key, v: f.version, cfg: domConfig(this.inputs) } : { off: true });
  }
}

// ---------------------------------------------------------------------------------------
// registration + picker group + persistence
// ---------------------------------------------------------------------------------------
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));
export const OUR_TYPES = [];
function reg(Core, d) {
  Core.registerNativeIndicator(Object.assign({ defaultInputs: () => defaults(d.inputsSchema()) }, d));
  OUR_TYPES.push(d.type);
}

// Picker group order: these types (Vela natives + ours), then the two drawing-tool rows.
const GROUP_TYPES = ['volume', 'vpvr', 'stk_svp', 'stk_pdvp', 'stk_avwap', 'vwap', 'stk_rvol', 'stk_vheatmap'];
// ORDER FLOW section (Owner order 2026-10-28), one list in this order. Types are unchanged, so saved
// charts, templates and favourites keep working. stk_delta / stk_cvd (older per-bar trades tools) are the
// same tool as stk_of_delta / stk_of_cvd, so they stay registered but are HIDDEN from the list (OF_HIDDEN).
const OF_GROUP = 'Order Flow';
const OF_GROUP_TYPES = ['stk_footprint', 'stk_of_delta', 'stk_of_cvd', 'stk_dsuite', 'stk_dpane', 'stk_of_big', 'stk_of_abs', 'stk_of_imb', 'stk_of_vp', 'stk_of_vwap',
  'stk_of_tpo', 'stk_of_evr', 'stk_of_sweep', 'stk_estcvd', 'stk_vbubble', 'stk_lth', 'stk_crypto_dom'];
const OF_HIDDEN = ['stk_delta', 'stk_cvd'];
const PSEUDO = [
  { id: 'avwap-click', name: 'Anchored VWAP: click a bar to anchor' },
  { id: 'frvp', name: 'Fixed Range Volume Profile (drag a range)' }
];
const PERSIST_KEY = 'stryker.volume';

let installed = false;
export function installOrderflow(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: 'stk_svp', placement: 'below-data', create: svpLayer });
  reg(Core, { type: 'stk_svp', title: 'Session Volume Profile', shortTitle: 'SVP', paneHint: 'price', overlay: true,
    inputsSchema: () => SVP_SCHEMA, create: () => new LayerNative(svpBuild) });
  reg(Core, { type: 'stk_pdvp', title: 'Previous Day POC / VAH / VAL', shortTitle: 'Prev day VP', paneHint: 'price', overlay: true,
    inputsSchema: () => PD_SCHEMA, create: () => new PrevDayNative() });
  reg(Core, { type: 'stk_avwap', title: 'Anchored VWAP (±1/2/3 sd bands)', shortTitle: 'AVWAP', paneHint: 'price', overlay: true, multiInstance: true,
    inputsSchema: () => AV_SCHEMA, create: () => new AvwapNative() });
  reg(Core, { type: 'stk_rvol', title: 'Relative Volume', shortTitle: 'RVOL', paneHint: 'new', overlay: false,
    inputsSchema: () => RV_SCHEMA, create: () => new RvolNative() });
  Core.registerRendererLayer({ id: 'stk_vbubble', placement: 'above-data', create: volumeBubbleLayer });
  reg(Core, { type: 'stk_vbubble', title: 'Volume Bubble / Big Prints', shortTitle: 'Volume Bubble', paneHint: 'price', overlay: true,
    inputsSchema: () => VB_SCHEMA, create: () => new LayerNative(vbBuild) });
  Core.registerRendererLayer({ id: 'stk_vheatmap', placement: 'below-data', create: volumeHeatmapLayer });
  reg(Core, { type: 'stk_vheatmap', title: 'Volume Heatmap', shortTitle: 'Volume Heatmap', paneHint: 'price', overlay: true,
    inputsSchema: () => VH_SCHEMA, create: () => new LayerNative(vhBuild) });
  Core.registerRendererLayer({ id: 'stk_lth', placement: 'below-data', create: liquidityTrendHeatmapLayer });
  reg(Core, { type: 'stk_lth', title: 'Liquidity Trend Heatmap', shortTitle: 'Liquidity Heatmap', paneHint: 'price', overlay: true,
    inputsSchema: () => LTH_SCHEMA, create: () => new LayerNative(lthBuild) });
  Core.registerRendererLayer({ id: 'stk_crypto_dom', placement: 'below-data', create: cryptoDomLayer });
  reg(Core, { type: 'stk_crypto_dom', title: 'Crypto DOM Heatmap (Binance)', shortTitle: 'Crypto DOM', paneHint: 'price', overlay: true,
    inputsSchema: () => DOM_SCHEMA, create: () => new CryptoDomNative() });
  Core.registerRendererLayer({ id: 'stk_footprint', placement: 'above-data', create: footprintLayer });
  reg(Core, { type: 'stk_footprint', title: 'Footprint (bid x ask)', shortTitle: 'Footprint', paneHint: 'price', overlay: true,
    inputsSchema: () => FP_SCHEMA, create: () => new FlowNative('footprint') });
  reg(Core, { type: 'stk_delta', title: 'Delta per bar (real trades)', shortTitle: 'Delta', paneHint: 'new', overlay: false,
    inputsSchema: () => DC_SCHEMA, create: () => new FlowNative('delta') });
  reg(Core, { type: 'stk_cvd', title: 'Cumulative Volume Delta (real trades)', shortTitle: 'CVD', paneHint: 'new', overlay: false,
    inputsSchema: () => CVD_SCHEMA, create: () => new FlowNative('cvd') });
  reg(Core, { type: 'stk_estcvd', title: 'Estimated CVD (from candles)', shortTitle: 'Est. CVD (from candles)', paneHint: 'new', overlay: false,
    inputsSchema: () => EST_SCHEMA, create: () => new EstCvdNative() });

  // Vela persists WHICH natives are on a chart but not their settings: keep the settings of
  // the volume tools (ours and Vela's) in the workspace document, so the persisted session
  // and saved templates restore them.
  const SAVE_TYPES = () => OUR_TYPES.concat(['vpvr', 'volume', 'vwap']);
  Core.registerStatePersistence({
    key: PERSIST_KEY, scope: 'cell',
    serialize(ctx) {
      const out = {};
      try {
        ctx.chart.indicators().forEach((h) => {
          if (!h.nativeType || !SAVE_TYPES().includes(h.nativeType)) return;
          (out[h.nativeType] = out[h.nativeType] || []).push(h.inputValues());
        });
      } catch (e) {}
      return Object.keys(out).length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!payload || typeof payload !== 'object') return;
      const apply = () => {
        let hs = [];
        try { hs = ctx.chart.indicators(); } catch (e) { return; }
        Object.keys(payload).forEach((type) => {
          if (!SAVE_TYPES().includes(type) || !Array.isArray(payload[type])) return;
          const mine = hs.filter((h) => h.nativeType === type);
          payload[type].slice(0, 20).forEach((vals, i) => {
            if (!mine[i] || !vals || typeof vals !== 'object') return;
            const clean = {};
            Object.keys(vals).slice(0, 40).forEach((k) => { const v = vals[k]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[k] = v; });
            try { mine[i].setInputs(clean); } catch (e) {}
          });
        });
      };
      apply();
    }
  });
}

// Put the group at the top of Vela's Indicators picker and wire the two tool rows.
export function mountOrderflow(ws, opts) {
  const toast = (opts && opts.toast) || (() => {});
  let cell;
  try { cell = ws.active; } catch (e) { return; }
  const proto = Object.getPrototypeOf(cell);
  if (!proto || proto.__stkVolume || typeof proto.libraryRows !== 'function') return;
  proto.__stkVolume = true;
  const origRows = proto.libraryRows, origAdd = proto.addFromLibrary;
  // Our order: group rows (natives present in the catalog) + pseudo rows, then the rest.
  function plan(self) {
    const base = origRows.call(self);
    const group = [], ofg = [], rest = [];
    base.forEach((r, i) => {
      const hid = r.native && OF_HIDDEN.indexOf(r.nativeType) >= 0;
      const oi = r.native ? OF_GROUP_TYPES.indexOf(r.nativeType) : -1;
      const gi = r.native ? GROUP_TYPES.indexOf(r.nativeType) : -1;
      if (hid) ofg.push({ r: Object.assign({}, r, { category: OF_GROUP, hidden: true }), i, gi: 999 });
      else if (oi >= 0) ofg.push({ r: Object.assign({}, r, { category: OF_GROUP }), i, gi: oi });
      else if (gi >= 0) group.push({ r: Object.assign({}, r, { category: GROUP }), i, gi });
      else rest.push({ r, i });
    });
    group.sort((a, b) => a.gi - b.gi);
    ofg.sort((a, b) => a.gi - b.gi);
    const rows = ofg.map((g) => ({ r: g.r, i: g.i })).concat(group.map((g) => ({ r: g.r, i: g.i })));
    PSEUDO.forEach((p) => rows.push({ r: { name: p.name, category: GROUP, pseudo: p.id }, pseudo: p.id }));
    return rows.concat(rest);
  }
  // Owner order 2026-10-05: no Vela/LuxAlgo wording in view (the licence credit stays in the
  // (i) Credits popover). The library's built-in studies are grouped as "Studies" instead of
  // "Vela", and no row carries the "vela" badge: ours say "stryker", built-ins show none.
  proto.libraryRows = function () {
    return plan(this).map((x) => (x.r.category === 'Vela' ? Object.assign({}, x.r, { category: 'Studies' }) : x.r));
  };
  const origOn = proto.onChartRows;
  proto.onChartRows = function () {
    return origOn.call(this).map((r) => (r.native ? Object.assign({}, r, { native: false, language: OUR_TYPES.includes(r.nativeType) ? 'stryker' : undefined }) : r));
  };
  proto.addFromLibrary = function (index) {
    const x = plan(this)[index];
    if (!x) return;
    if (x.pseudo) { runPseudo(this, x.pseudo); return; }
    if (x.r && x.r.native && ProGate.locked(ProGate.kindOf(x.r.nativeType))) { ProGate.upgrade(ProGate.kindOf(x.r.nativeType)); return; }
    // ONE footprint: the picker's "Footprint" row switches the chart to the Footprint chart type
    // (assets/chart-footprint.js), which reads the futures recorder or Binance trades by symbol.
    if (x.r && x.r.nativeType === 'stk_footprint') {
      try { this.setPriceStyle('stk_fp'); closePicker(); try { ws.context().stateChanged(); } catch (e) {} return; } catch (e) { console.warn('TradeZoro: footprint style', e); }
    }
    origAdd.call(this, x.i);
  };

  function closePicker() { try { if (ws.indicatorPicker) ws.indicatorPicker.close(); } catch (e) {} }

  function runPseudo(c, id) {
    const chart = c.chart || c.inner;
    if (!chart) return;
    closePicker();
    if (id === 'frvp') {
      try { chart.drawings.setTool('fixedrangevp'); toast('Drag across the bars you want to profile.', 'info'); }
      catch (e) { toast('The range tool is not available here.', 'error'); }
      return;
    }
    // Anchored VWAP: the next click/tap on this chart sets the anchor bar.
    let t = null;
    const off = chart.renderer.onCrosshairMove((e) => { if (e && e.time != null) t = e.time; });
    const host = c.host || document.getElementById('vela-chart');
    toast('Click a bar to anchor the VWAP.', 'info');
    const done = () => { host.removeEventListener('pointerup', onUp, true); document.removeEventListener('keydown', onKey, true); try { off(); } catch (e) {} };
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    const onUp = () => {
      setTimeout(() => {
        done();
        if (t == null) { toast('No bar under the pointer. Pick the row again and click a candle.', 'error'); return; }
        try { chart.addNativeIndicator('stk_avwap', { inputs: { anchor: t } }); } catch (e) { console.warn('TradeZoro: AVWAP', e); }
        try { c.refreshNativeCatalog(); } catch (e) {}
        try { ws.context().stateChanged(); } catch (e) {}
      }, 30);
    };
    setTimeout(() => { host.addEventListener('pointerup', onUp, true); document.addEventListener('keydown', onKey, true); }, 50);
  }
}
