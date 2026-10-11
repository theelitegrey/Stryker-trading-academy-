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

const GROUP = 'Volume & Order flow';
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
    if (!r || r.err) { this.ctx.emit({ priceLines: [], tables: [message('stk_pdvp-msg', (r && r.err) || 'Waiting for bars.', pageIsDay(), 'top_right')] }); return; }
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
    if (f.status === 'error') return f.err || 'Trade data unavailable.';
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
// The 1 bucket either side of the mid is skipped (best bid / ask churn). Thin levels below the
// chosen percentile of all sizes in view are hidden. Indicator only: it describes resting
// orders, it predicts nothing and offers nothing to trade.
const BOOK_MAX_LEVELS = 1000;
const BOOK_SAMPLE_MS = 1000;
const BOOK_HISTORY_MAX = 2400;
const bookFeeds = new Map();
const BOOK_NEEDS_BINANCE = 'Crypto DOM needs a Binance crypto symbol.';
const DOM_VIEWS = ['Combined (heatmap + depth + walls)', 'Heatmap only', 'Depth bars only', 'Walls only'];
const DOM_SCHEMA = [
  { key: 'style', title: 'Style', type: 'string', defval: DOM_VIEWS[0], options: DOM_VIEWS },
  { key: 'showHeat', title: 'Show heatmap (Combined)', type: 'bool', defval: true },
  { key: 'showDepth', title: 'Show depth bars (Combined)', type: 'bool', defval: true },
  { key: 'showWalls', title: 'Show walls (Combined)', type: 'bool', defval: true },
  { key: 'wallTopPct', title: 'Wall threshold (top % of sizes)', type: 'float', defval: 2.5, min: 0.5, max: 20, step: 0.5 },
  { key: 'wallMinSec', title: 'Wall min lifetime (seconds)', type: 'int', defval: 12, min: 0, max: 600, step: 1 },
  { key: 'showWallSizes', title: 'Show wall sizes', type: 'bool', defval: true },
  { key: 'hidePct', title: 'Hide thin levels below (percentile)', type: 'int', defval: 60, min: 0, max: 95, step: 5 },
  { key: 'bucketUsd', title: 'Price bucket size (0 = auto)', type: 'float', defval: 0, min: 0, max: 100000, step: 0.5 },
  { key: 'historyMin', title: 'History window (minutes)', type: 'int', defval: 90, min: 5, max: 360, step: 5 },
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
function domConfig(inputs) {
  const i = inputs || {};
  const vi = i.style === 'right ladder' ? 2 : DOM_VIEWS.indexOf(i.style);
  const view = ['combined', 'heat', 'depth', 'walls'][vi < 0 ? 0 : vi];
  const combined = view === 'combined';
  return {
    view,
    heat: view === 'heat' || (combined && i.showHeat !== false),
    depth: view === 'depth' || (combined && i.showDepth !== false),
    walls: view === 'walls' || (combined && i.showWalls !== false),
    twoTone: view !== 'heat',
    wallTop: clamp(num(i.wallTopPct, 2.5), 0.5, 20) / 100,
    wallMinMs: clamp(Math.round(num(i.wallMinSec, 12)), 0, 600) * 1000,
    wallSizes: i.showWallSizes !== false,
    hide: clamp(num(i.hidePct, 60), 0, 95) / 100,
    bucket: Math.max(0, num(i.bucketUsd, 0)),
    historyMin: clamp(Math.round(num(i.historyMin, 90)), 5, 360),
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
function bookKey(provider, ticker) { return provider + '|' + String(ticker || '').toUpperCase(); }
function binanceBookSource(ticker, onBook, onStatus) {
  const perp = /\.P$/i.test(ticker);
  const sym = ticker.replace(/\.P$/i, '').toUpperCase();
  const rest = perp ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
  const wsBase = perp ? 'wss://fstream.binance.com/ws/' : 'wss://stream.binance.com:9443/ws/';
  let stopped = false, ws = null, tm = 0, retry = 0, refresh = 0;
  let bids = new Map(), asks = new Map();
  const emit = () => {
    let bestBid = null, bestAsk = null;
    bids.forEach((q, p) => { if (q > 0 && (bestBid == null || p > bestBid)) bestBid = p; });
    asks.forEach((q, p) => { if (q > 0 && (bestAsk == null || p < bestAsk)) bestAsk = p; });
    onBook({ bids, asks, bestBid, bestAsk, ts: Date.now() });
  };
  const apply = (side, arr) => {
    const m = side === 'b' ? bids : asks;
    for (const row of arr || []) {
      const p = Number(row[0]), q = Number(row[1]);
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
      if (q <= 0) m.delete(p); else m.set(p, q);
    }
    if (m.size > BOOK_MAX_LEVELS * 2) {
      const sorted = [...m.keys()].sort((a, b) => side === 'b' ? b - a : a - b).slice(BOOK_MAX_LEVELS);
      sorted.forEach(p => m.delete(p));
    }
  };
  async function snapshot() {
    try {
      onStatus('loading');
      const r = await fetch(rest + '/depth?symbol=' + encodeURIComponent(sym) + '&limit=' + BOOK_MAX_LEVELS);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      bids = new Map(); asks = new Map();
      apply('b', d.bids); apply('a', d.asks);
      emit(); onStatus('live');
    } catch (e) {
      onStatus('error', 'Could not load Binance order book.');
    }
  }
  function open() {
    if (stopped) return;
    try {
      ws = new WebSocket(wsBase + sym.toLowerCase() + '@depth@100ms');
      ws.onopen = () => { retry = 0; onStatus('live'); };
      ws.onmessage = (e) => { try { const d = JSON.parse(e.data); apply('b', d.b); apply('a', d.a); emit(); } catch (x) {} };
      ws.onclose = () => { if (stopped) return; onStatus('reconnecting'); tm = setTimeout(open, Math.min(15000, 1000 * Math.pow(2, ++retry))); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    } catch (e) { onStatus('error', 'Could not open Binance depth stream.'); }
  }
  snapshot(); open();
  refresh = setInterval(snapshot, 30000);
  return () => { stopped = true; clearTimeout(tm); clearInterval(refresh); try { if (ws) ws.close(); } catch (e) {} };
}
// One sample = the book at a moment, packed small (phones keep up to BOOK_HISTORY_MAX of them):
// only a band around the mid (the nearest BOOK_BAND_LEVELS per side or +-BOOK_BAND_PCT of the
// mid, whichever is fewer levels), prices as Float32 offsets from the mid (o = p - mid), signed
// sizes (+ bid, - ask). Order: nb bids from the mid outward (o falling), then the asks from the
// mid outward (o rising), so binning is one linear pass with no Map and no sort.
// ~6.4 KB per sample at 800 levels, vs ~36 KB for the full Float64 book + a cached bins Map.
const BOOK_BAND_LEVELS = 400;
const BOOK_BAND_PCT = 0.03;
function bookMid(bestBid, bestAsk) {
  return bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk || 0);
}
// The book's price grid: the fewest decimals d that every listed price has (Binance prices are
// decimal strings, so this is the tick or finer). Float32 offsets are exact to ~6e-8 of their
// size, far inside half of 10^-d, so mid + offset rounded to this grid gives the price back.
function bookTick(bp, ap) {
  const ps = [];
  for (const s of [bp, ap]) for (let k = 0; k < Math.min(s.length, 48); k++) ps.push(s[k]);
  if (!ps.length) return 0;
  for (let d = 0; d <= 8; d++) {
    const m = Math.pow(10, d);
    if (ps.every(p => Math.abs(p * m - Math.round(p * m)) < 1e-6 * Math.max(1, p * m * 1e-9))) return 1 / m;
  }
  return 0;
}
// bp/bq: bid prices/sizes sorted by price DESC; ap/aq: asks sorted ASC (any array-likes).
function packSides(bp, bq, ap, aq, mid, tick) {
  const lo = mid * (1 - BOOK_BAND_PCT), hi = mid * (1 + BOOK_BAND_PCT);
  let nb = 0, na = 0;
  while (nb < bp.length && nb < BOOK_BAND_LEVELS && bp[nb] >= lo) nb++;
  while (na < ap.length && na < BOOK_BAND_LEVELS && ap[na] <= hi) na++;
  const o = new Float32Array(nb + na), q = new Float32Array(nb + na);
  for (let k = 0; k < nb; k++) { o[k] = bp[k] - mid; q[k] = bq[k]; }
  for (let k = 0; k < na; k++) { o[nb + k] = ap[k] - mid; q[nb + k] = -aq[k]; }
  return { o, q, nb, mid, tick: tick || 0, bins: null, binStep: 0, binFrame: 0 };
}
function bookSides(book) {
  const b = [], a = [];
  book.bids.forEach((size, price) => { if (size > 0 && price > 0) b.push(price); });
  book.asks.forEach((size, price) => { if (size > 0 && price > 0) a.push(price); });
  b.sort((x, y) => y - x); a.sort((x, y) => x - y);
  return { bp: b, bq: b.map(p => book.bids.get(p)), ap: a, aq: a.map(p => book.asks.get(p)) };
}
function packBook(book) {
  const mid = bookMid(book.bestBid, book.bestAsk);
  if (!(mid > 0)) return packSides([], [], [], [], 0, 0);
  const s = bookSides(book);
  return packSides(s.bp, s.bq, s.ap, s.aq, mid, bookTick(s.bp, s.ap));
}
// Append one sample: 6 h max age, then over the cap the oldest half is thinned to every other
// sample (recent detail stays at 1 s).
function pushBookSample(history, s) {
  history.push(s);
  const cutoff = s.ts - 6 * 60 * 60 * 1000;
  while (history[0] && history[0].ts < cutoff) history.shift();
  if (history.length > BOOK_HISTORY_MAX) {
    const half = Math.floor(history.length / 2);
    return history.slice(0, half).filter((x, i) => i % 2 === 0).concat(history.slice(half));
  }
  return history;
}
class BookFeed {
  constructor(provider, ticker) {
    this.provider = provider; this.ticker = ticker; this.key = bookKey(provider, ticker);
    this.base = baseAsset(ticker);
    this.status = 'loading'; this.err = ''; this.version = 0; this.refs = 0; this.listeners = new Set(); this.closeTm = 0;
    this.book = { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ts: 0 };
    this.history = []; this.lastSample = 0;
    this.stop = binanceBookSource(ticker, (book) => { this.book = book; this.sample(); this.bump(); }, (st, err) => { this.status = st; this.err = err || ''; this.bump(); });
  }
  sample() {
    const now = Date.now();
    if (now - this.lastSample < BOOK_SAMPLE_MS) return;
    this.lastSample = now;
    const s = packBook(this.book);
    if (!s.o.length) return;
    s.ts = now; s.bestBid = this.book.bestBid; s.bestAsk = this.book.bestAsk;
    this.history = pushBookSample(this.history, s);
  }
  bump() { this.version++; this.listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
}
function acquireBookFeed(provider, ticker, fn) {
  const key = bookKey(provider, ticker);
  let f = bookFeeds.get(key);
  if (!f) { f = new BookFeed(provider, ticker); bookFeeds.set(key, f); }
  clearTimeout(f.closeTm); f.refs++; f.listeners.add(fn);
  return { feed: f, release() {
    f.listeners.delete(fn);
    if (--f.refs > 0) return;
    f.closeTm = setTimeout(() => { if (f.refs <= 0) { try { f.stop(); } catch (e) {} bookFeeds.delete(key); } }, 10000);
  } };
}
// Bucket one sample by price step -> { i: Int32Array bucket indices, v: Float32Array signed size
// (+ bid, - ask) }. Bids only fall in buckets <= the mid's bucket and asks in buckets >= it, and
// the touch (1 bucket either side of the mid) is skipped, so a bucket never holds both sides.
// The levels are already sorted outward from the mid, so this is one linear pass. Only ONE step
// is cached per sample, and the renderer drops the cache of samples it no longer draws
// (binFrame), so at most the drawn columns hold bins at any time.
function binSample(s, step) {
  if (s.bins && s.binStep === step) return s.bins;
  const o = s.o, q = s.q, nb = s.nb, n = o.length, mid = s.mid, tk = s.tick;
  const mi = Math.floor(mid / step + 1e-9);
  const ii = new Int32Array(n), vv = new Float32Array(n);
  let m = 0, cur = 0, acc = 0, has = false;
  const flush = () => { if (has && Math.abs(cur - mi) > 1 && acc !== 0) { ii[m] = cur; vv[m++] = acc; } };
  for (let k = 0; k < n; k++) {
    if (k === nb) { flush(); has = false; acc = 0; }
    const p = tk > 0 ? Math.round((mid + o[k]) / tk) * tk : mid + o[k];
    const i = Math.floor(p / step + 1e-9);
    if (!has || i !== cur) { flush(); cur = i; acc = 0; has = true; }
    acc += q[k];
  }
  flush();
  s.bins = { i: m < n ? ii.slice(0, m) : ii, v: m < n ? vv.slice(0, m) : vv };
  s.binStep = step;
  return s.bins;
}
let domFrame = 0, domStep = 0, domRebinMs = null, domRebinCols = 0;
const domBinned = new Set(); // samples currently holding a bins cache
const quant = (sorted, f) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * f)))] : 0;
let domLast = null; // last frame summary, for the browser test (window.__stkFlow.domDebug())
export function domDebug() { return domLast; }
// Test hook: fill every open book feed's history to BOOK_HISTORY_MAX samples (1 s apart,
// ending at the oldest real sample) built from its current book with a small random walk, so
// the real indicator draws a full-cap history. binLast: also bin the newest binLast samples at
// binStep (what the renderer caches for its drawn columns), to measure the worst case
// synchronously. Returns the feed's sample count and bytes.
export function domDebugFill(n, binLast, binStep) {
  const out = [];
  bookFeeds.forEach((f) => {
    const mid0 = bookMid(f.book.bestBid, f.book.bestAsk);
    if (!(mid0 > 0)) return;
    const sd = bookSides(f.book), tick = bookTick(sd.bp, sd.ap) || mid0 * 1e-6;
    const want = Math.min(BOOK_HISTORY_MAX, n || BOOK_HISTORY_MAX) - f.history.length;
    const t0 = f.history.length ? f.history[0].ts : Date.now();
    const syn = [];
    let shift = 0;
    for (let k = want; k >= 1; k--) {
      shift += Math.round((Math.random() - 0.5) * mid0 * 0.0002 / tick) * tick;
      const bp = sd.bp.map(p => p + shift), ap = sd.ap.map(p => p + shift);
      const bq = sd.bq.map(x => x * (0.6 + Math.random() * 0.8)), aq = sd.aq.map(x => x * (0.6 + Math.random() * 0.8));
      const s = packSides(bp, bq, ap, aq, mid0 + shift, tick);
      s.ts = t0 - k * BOOK_SAMPLE_MS; s.bestBid = bp[0]; s.bestAsk = ap[0];
      syn.push(s);
    }
    f.history = syn.concat(f.history);
    if (binLast > 0 && binStep > 0) f.history.slice(-binLast).forEach((s) => { binSample(s, binStep); s.binFrame = domFrame; domBinned.add(s); });
    f.bump();
    out.push(Object.assign({ key: f.key, levelsInBook: sd.bp.length + sd.ap.length }, domDebugBytes(f)));
  });
  return out;
}
export function domDebugBytes(f) {
  let samples = 0, bytes = 0, levels = 0, bins = 0;
  (f ? [f] : [...bookFeeds.values()]).forEach((x) => x.history.forEach((s) => {
    samples++; levels += s.o.length; bytes += s.o.byteLength + s.q.byteLength + 96;
    if (s.bins) { bins++; bytes += s.bins.i.byteLength + s.bins.v.byteLength + 48; }
  }));
  return { samples, avgLevels: samples ? Math.round(levels / samples) : 0, binned: bins, bytes };
}
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
      // Price bucket: manual size, or "auto" = a nice step of ~1/120 of the visible range, at
      // least 3 px tall so phones still get readable rows.
      let step = cfg.bucket;
      if (!(step > 0)) {
        step = niceStep(span / 120);
        const midP = (a.scale.min + a.scale.max) / 2;
        const pxStep = Math.abs(yOf(midP + step) - yOf(midP));
        if (pxStep < 3) step = niceStep(step * 3 / Math.max(pxStep, 0.01));
      }
      if (Math.abs(yOf(a.scale.min) - yOf(a.scale.min + step)) < 1) step = niceStep(span / 300);
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
      const stat = { view: cfg.view, step, samples: 0, columns: 0, cells: 0, depthBars: 0, walls: [], base: f.base, width: W };

      // ---- history -> pixel columns (>= 2 px wide), x from the chart's own time axis ----
      const now = Date.now();
      const hist = (f.history || []).filter(h => now - h.ts <= cfg.historyMin * 60000);
      stat.samples = hist.length; stat.histFrom = hist.length ? hist[0].ts : 0;
      const cols = [];
      if (cfg.heat || cfg.walls) {
        for (let k = 0; k < hist.length; k++) {
          const s = hist[k];
          const x0 = co.timeToX(s.ts);
          const x1 = k + 1 < hist.length ? co.timeToX(hist[k + 1].ts) : co.timeToX(s.ts + BOOK_SAMPLE_MS);
          if (!Number.isFinite(x0) || x1 < 0 || x0 > right) continue;
          const last = cols[cols.length - 1];
          if (last && x0 - last.x0 < 2) { last.x1 = x1; last.s = s; last.ts1 = s.ts; continue; }
          cols.push({ x0, x1, s, ts0: s.ts, ts1: s.ts });
        }
      }
      // visible values (all columns + the current book) -> percentiles
      const curBins = binSample(packBook(f.book), step);
      const vals = [];
      const frame = ++domFrame;
      const colBins = cols.map(c => {
        const bn = binSample(c.s, step), out = [];
        c.s.binFrame = frame; domBinned.add(c.s);
        for (let k = 0; k < bn.i.length; k++) { const i = bn.i[k]; if (i >= iLo && i <= iHi) { const v = bn.v[k]; out.push(i, v); vals.push(Math.abs(v)); } }
        return out;
      });
      // free the bins of every sample not drawn in this frame (scrolled away, thinned, or other step)
      domBinned.forEach(s => { if (s.binFrame !== frame) { s.bins = null; s.binStep = 0; domBinned.delete(s); } });
      const curRows = [];
      for (let k = 0; k < curBins.i.length; k++) { const i = curBins.i[k]; if (i >= iLo && i <= iHi) curRows.push([i, curBins.v[k]]); }
      if (!vals.length) curRows.forEach(r => vals.push(Math.abs(r[1])));
      vals.sort((x, y) => x - y);
      const qLo = quant(vals, cfg.hide), cap = Math.max(qLo * 1.0001, quant(vals, 0.985));
      stat.columns = cols.length; stat.heatX0 = cols.length ? Math.round(Math.max(0, cols[0].x0)) : null;

      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();

      // ---- heatmap: run-length merged cells per bucket ----
      if (cfg.heat && cols.length) {
        g.save(); g.beginPath(); g.rect(0, top, Math.max(0, right), a.bounds.height); g.clip();
        const open = new Map(); // bucket -> { x0, x1, key, style }
        const flush = (i, r) => {
          const [y, h] = rowY(i);
          if (y > bot || y + h < top) return;
          g.fillStyle = r.style; g.fillRect(r.x0, y, Math.max(1, r.x1 - r.x0 + 0.5), h + 0.5); stat.cells++;
        };
        const styleOf = (v) => {
          const n = Math.pow(Math.max(0, (Math.abs(v) - qLo) / (cap - qLo)), 0.75);
          if (n < 0.04) return null;
          if (cfg.twoTone) { const al = Math.round(cfg.opacity * Math.min(1, n * 1.3) * 20) / 20; return al > 0 ? 'rgba(' + (v > 0 ? bidRgb : askRgb) + ',' + al + ')' : null; }
          const nq = Math.round(n * 24) / 24; const c = domRamp(nq);
          return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (cfg.opacity * Math.min(1, 0.25 + nq)).toFixed(2) + ')';
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
        if (cfg.view === 'heat' && cfg.showScale) {
          // top-right corner (the chart legend owns the top-left), on a small backing box
          g.font = '10px ' + font; g.textAlign = 'left';
          const sw = 8, sh = Math.min(72, a.bounds.height - 40), bw = sw + 10 + g.measureText('More').width;
          const bx = W - bw - 8, sx = bx + 4, sy = top + 10;
          g.fillStyle = light ? 'rgba(255,255,255,.88)' : 'rgba(5,5,6,.85)'; g.fillRect(bx, sy - 4, bw + 4, sh + 8);
          const grd = g.createLinearGradient(0, sy + sh, 0, sy);
          DOM_RAMP.forEach((c, k) => grd.addColorStop(k / (DOM_RAMP.length - 1), 'rgb(' + c.join(',') + ')'));
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
            if (!w) { w = { i: arr[k], side, t0: col.ts0, t1: col.ts1, x0: col.x0, x1: col.x1, max: 0 }; seen.set(key, w); }
            w.t1 = col.ts1; w.x1 = col.x1; w.max = Math.max(w.max, Math.abs(v));
          }
        }
        const list = [...seen.values()].filter(w => w.t1 - w.t0 >= cfg.wallMinMs).sort((x, y) => y.max - x.max).slice(0, 12);
        const mxv = list.length ? list[0].max : 1;
        const used = [];
        const fs = 11, maxLabels = W < 500 ? 6 : 12; // phones: fewer labels, biggest first
        g.font = 'bold ' + fs + 'px ' + font;
        g.textAlign = 'left'; g.textBaseline = 'middle';
        for (const w of list) {
          const y = Math.round(yOf((w.i + 0.5) * step)) + 0.5;
          if (y < top || y > bot) continue;
          const rgb = w.side > 0 ? bidRgb : askRgb;
          g.strokeStyle = 'rgba(' + rgb + ',' + (cfg.heat ? 0.95 : 0.85) + ')';
          g.lineWidth = 1.5 + 4 * (w.max / mxv);
          g.beginPath(); g.moveTo(Math.max(0, w.x0), y); g.lineTo(Math.min(right, w.x1), y); g.stroke();
          const lab = fmtSize(w.max) + ' ' + f.base;
          const rec = { label: lab, side: w.side > 0 ? 'bid' : 'ask', price: (w.i + 0.5) * step, drawn: false };
          stat.walls.push(rec);
          if (!cfg.wallSizes || used.length >= maxLabels || y < top + 10 || y > bot - 8 || used.some(u => Math.abs(u - y) < 15)) continue;
          used.push(y);
          const tw = g.measureText(lab).width, tx = right - tw - 8;
          if (tx < 4) continue;
          g.fillStyle = light ? 'rgba(255,255,255,.88)' : 'rgba(5,5,6,.85)';
          g.fillRect(tx - 3, y - 8, tw + 6, 16);
          g.fillStyle = 'rgb(' + rgb + ')';
          g.fillText(lab, tx, y + 0.5);
          rec.drawn = true;
        }
        g.textBaseline = 'alphabetic';
      }

      // ---- depth bars: the CURRENT book only, sqrt(size / max) ----
      if (cfg.depth && curRows.length) {
        let mx = 0;
        curRows.forEach(r => { if (Math.abs(r[1]) > mx) mx = Math.abs(r[1]); });
        const x0 = depthX, wmax = depthW - 4;
        for (const [i, v] of curRows) {
          const [y, h] = rowY(i);
          if (y > bot || y + h < top) continue;
          const w = Math.max(1, Math.sqrt(Math.abs(v) / mx) * wmax);
          g.fillStyle = 'rgba(' + (v > 0 ? bidRgb : askRgb) + ',0.75)';
          g.fillRect(x0, y + (h > 3 ? 0.5 : 0), w, Math.max(1, h - (h > 3 ? 1 : 0)));
          stat.depthBars++;
        }
        if (depthW >= 64) {
          g.font = '10px ' + font; g.textAlign = 'left';
          const tw = g.measureText('RESTING').width;
          g.fillStyle = light ? 'rgba(255,255,255,.88)' : 'rgba(5,5,6,.85)'; g.fillRect(x0, top + 2, tw + 6, 14);
          g.fillStyle = light ? 'rgba(71,85,105,.95)' : 'rgba(139,147,160,.95)'; g.fillText('RESTING', x0 + 3, top + 12);
        }
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
      stat.ms = Math.round(ms * 10) / 10; stat.rebinMs = domRebinMs; stat.rebinCols = domRebinCols; stat.binned = domBinned.size;
      domLast = stat;
    },
    destroy() { canvas = null; }
  };
}
class CryptoDomNative {
  constructor() { this.inputs = {}; this.h = null; this.tm = 0; this.onTheme = () => this.render(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; window.addEventListener('stryker:theme', this.onTheme); this.attach(); }
  attach() {
    if (!this.ctx) return;
    this.detach();
    const mk = marketOf(this.ctx);
    this.block = mk.provider === 'binance' ? '' : BOOK_NEEDS_BINANCE;
    if (!this.block) this.h = acquireBookFeed('binance', mk.ticker, () => this.later());
    this.render();
  }
  detach() { if (this.h) { this.h.release(); this.h = null; } clearTimeout(this.tm); this.tm = 0; }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() {}
  onViewport() {}
  setInputs(i) { this.inputs = i; this.render(); }
  suspend() { this.detach(); }
  resume() { this.attach(); }
  stop() { this.detach(); window.removeEventListener('stryker:theme', this.onTheme); }
  note() {
    if (this.block) return this.block;
    const f = this.h && this.h.feed;
    if (!f || f.status === 'loading') return 'Loading Binance order book…';
    if (f.status === 'error') return f.err || 'Order book unavailable.';
    if (f.status === 'reconnecting') return 'Reconnecting to Binance order book…';
    const cfg = domConfig(this.inputs);
    if ((cfg.heat || cfg.walls) && f.history.length < 15) return 'Building order book history…';
    return '';
  }
  render() {
    if (!this.ctx) return;
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
const GROUP_TYPES = ['volume', 'vpvr', 'stk_svp', 'stk_pdvp', 'stk_avwap', 'vwap', 'stk_rvol', 'stk_vbubble', 'stk_vheatmap', 'stk_lth', 'stk_crypto_dom',
  'stk_footprint', 'stk_delta', 'stk_cvd', 'stk_estcvd'];
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
  reg(Core, { type: 'stk_footprint', title: 'Footprint (bid x ask, real trades)', shortTitle: 'Footprint', paneHint: 'price', overlay: true,
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
    const group = [], rest = [];
    base.forEach((r, i) => {
      const gi = r.native ? GROUP_TYPES.indexOf(r.nativeType) : -1;
      if (gi >= 0) group.push({ r: Object.assign({}, r, { category: GROUP }), i, gi });
      else rest.push({ r, i });
    });
    group.sort((a, b) => a.gi - b.gi);
    const rows = group.map((g) => ({ r: g.r, i: g.i }));
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
