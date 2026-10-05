// Stryker Trading Academy — Charts: volume and order-flow tools (charts.html) — ES module
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
const GROUP_TYPES = ['volume', 'vpvr', 'stk_svp', 'stk_pdvp', 'stk_avwap', 'vwap', 'stk_rvol',
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
        try { chart.addNativeIndicator('stk_avwap', { inputs: { anchor: t } }); } catch (e) { console.warn('Stryker: AVWAP', e); }
        try { c.refreshNativeCatalog(); } catch (e) {}
        try { ws.context().stateChanged(); } catch (e) {}
      }, 30);
    };
    setTimeout(() => { host.addEventListener('pointerup', onUp, true); document.addEventListener('keydown', onKey, true); }, 50);
  }
}
