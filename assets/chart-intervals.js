// Stryker Trading Academy — Charts interval picker (ES module)
// Depends on: the Vela workspace built in assets/vela-chart.js (ws: active cell, setActiveTimeframe,
// on('cell:active' | 'state:changed'), its topbar .vela-widget-tf-group and the phone bar
// .vela-mb-tf); assets/toast.js through opts.toast. Styles are injected here (#stk-iv-css).
//
// Owner order 2026-10-06: "add timeframe and interval feature like this" (TradingView's picker).
//   - Top bar: a row of the member's STARRED intervals in time order, the active one as a grey pill,
//     then a caret that opens the full menu. Narrow widths and phones show only the active interval
//     plus the caret (no sideways scroll). Vela's own chips and caret are hidden, not removed.
//   - Menu: sections Ticks / Seconds / Minutes / Hours / Days, each collapsible (state remembered),
//     a star per row to add or remove it from the top row, the active row as a white pill.
//   - Favourites, custom intervals and collapsed sections: localStorage for guests; signed-in members
//     sync them to students/{uid}/chartPrefs/intervals (owner-only, shape-checked rules block
//     "Charts: interval prefs"; the sibling favToolbar doc is assets/chart-fav-toolbar.js). The first
//     sign-in with no cloud doc copies this browser's lists up; after that the account wins.
// DATA (honest about each source, never fake bars):
//   - Minutes / hours / days work everywhere. wrapProvider() builds intervals a source does not
//     serve natively by aggregating the nearest smaller native interval: futures 2m 3m 10m 45m 3h
//     (buckets anchored to the 18:00 New York Globex open, like functions/api/chart/_bars.js
//     aggregateHours) and 3M 6M 12M everywhere (calendar quarters / halves / years). Crypto venues
//     already aggregate their own missing minute intervals.
//   - SECONDS (stage 2): Binance spot from its native 1-second candles (5-45 s aggregated from 1 s,
//     forming bar polled every second). Binance perps, and futures while the member's Rithmic
//     connection is up, build seconds from the live trade stream. Coinbase / Hyperliquid: not offered.
//   - TICKS (stage 2): N trades per bar, from the trade stream the order-flow tools already use
//     (assets/chart-orderflow.js openTradeSource). Binance has a short backfill of recent trades;
//     a Rithmic connection has none, so its tick bars build from now (a note says so).
//   - Futures without Rithmic: seconds/tick rows carry a "Rithmic" tag; clicking says "Needs a
//     Rithmic connection (real-time data)" and never switches the chart. If an interval still ends
//     up on a chart that cannot draw it (Interval sync, a saved layout) or no bars arrive, that cell
//     goes back to 1m with a toast: never a blank chart.
//   - Vela's timeframeToMs() reads S and T ids as 1 h, so its live-gap heal only fires after a
//     90-minute silence; the providers here own the forming bar (poll or trade stream) instead.
// CUSTOM INTERVALS: "+ Add custom interval…" (number + unit), listed in their section with a remove
// button, starred on add. TYPED INTERVALS: a digit or "," on the chart opens a small box ("5",
// "4h", "1D", "15s", "100t") and Enter applies it; keys inside inputs are never taken.
// No order or trade button anywhere here (Owner rule: no buying/selling on the website).

const LS_FAVS = 'stryker_chart_iv_favs';
const LS_COLLAPSED = 'stryker_chart_iv_collapsed';
const LS_CUSTOM = 'stryker_chart_iv_custom';
const MAX_CUSTOM = 20;
const DEFAULT_FAVS = ['1', '5', '15', '60', '240', 'D'];
const PHONE_MAX = 700;
const NARROW_BAR = 760;          // topbar narrower than this: collapse the row to the active interval
const H = 3600000, MIN = 60000;
const NEED_RITHMIC = 'Needs a Rithmic connection (real-time data)';

export const SECTIONS = [
  { id: 'ticks', label: 'Ticks', rows: ['1T', '10T', '100T', '1000T'] },
  { id: 'seconds', label: 'Seconds', rows: ['1S', '5S', '10S', '15S', '30S', '45S'] },
  { id: 'minutes', label: 'Minutes', rows: ['1', '2', '3', '5', '10', '15', '30', '45'] },
  { id: 'hours', label: 'Hours', rows: ['60', '120', '180', '240'] },
  { id: 'days', label: 'Days', rows: ['D', 'W', 'M', '3M', '6M', '12M'] }
];

export function sectionOf(tf) {
  const p = parseIv(tf);
  if (!p) return null;
  if (p.kind === 'tick') return 'ticks';
  if (p.kind === 'sec') return 'seconds';
  if (p.kind === 'min') return p.n % 60 === 0 ? 'hours' : 'minutes';
  return 'days';
}
// ---------------- interval ids ----------------
// '15' minutes, '15S' seconds, '100T' ticks, 'D' 'W' 'M', '3M' months.
export function parseIv(tf) {
  tf = String(tf || '').trim();
  let m;
  if (/^\d+$/.test(tf)) return { kind: 'min', n: +tf, ms: +tf * MIN };
  if ((m = /^(\d+)S$/i.exec(tf))) return { kind: 'sec', n: +m[1], ms: +m[1] * 1000 };
  if ((m = /^(\d+)T$/i.exec(tf))) return { kind: 'tick', n: +m[1], ms: -1e9 + +m[1] };
  if (tf === 'D' || tf === '1D') return { kind: 'day', n: 1, ms: 864e5 };
  if (tf === 'W' || tf === '1W') return { kind: 'week', n: 1, ms: 6048e5 };
  if ((m = /^(\d+)D$/.exec(tf))) return { kind: 'day', n: +m[1], ms: +m[1] * 864e5 };
  if ((m = /^(\d+)W$/.exec(tf))) return { kind: 'week', n: +m[1], ms: +m[1] * 6048e5 };
  if (tf === 'M') return { kind: 'month', n: 1, ms: 2592e6 };
  if ((m = /^(\d+)M$/.exec(tf))) return { kind: 'month', n: +m[1], ms: +m[1] * 2592e6 };
  return null;
}
export function ivShort(tf) {
  const p = parseIv(tf);
  if (!p) return String(tf);
  if (p.kind === 'tick') return p.n + 'T';
  if (p.kind === 'sec') return p.n + 's';
  if (p.kind === 'min') return p.n % 60 === 0 ? (p.n / 60) + 'h' : p.n + 'm';
  if (p.kind === 'day') return p.n === 1 ? 'D' : p.n + 'D';
  if (p.kind === 'week') return p.n === 1 ? 'W' : p.n + 'W';
  return p.n === 1 ? 'M' : p.n + 'M';
}
export function ivLong(tf) {
  const p = parseIv(tf);
  if (!p) return String(tf);
  const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  if (p.kind === 'tick') return pl(p.n, 'tick');
  if (p.kind === 'sec') return pl(p.n, 'second');
  if (p.kind === 'min') return p.n % 60 === 0 ? pl(p.n / 60, 'hour') : pl(p.n, 'minute');
  if (p.kind === 'day') return pl(p.n, 'day');
  if (p.kind === 'week') return pl(p.n, 'week');
  return pl(p.n, 'month');
}
// Interval id from a count + unit, or null when out of range (custom dialog + typed box).
const UNIT_MAX = { tick: 100000, sec: 59, min: 1439, hour: 23, day: 365, week: 52, month: 12 };
export function ivFrom(n, unit) {
  n = Math.floor(+n);
  if (!(n >= 1) || !UNIT_MAX[unit] || n > UNIT_MAX[unit]) return null;
  if (unit === 'tick') return n + 'T';
  if (unit === 'sec') return n + 'S';
  if (unit === 'min') return String(n);
  if (unit === 'hour') return String(n * 60);
  if (unit === 'day') return n === 1 ? 'D' : n + 'D';
  if (unit === 'week') return n === 1 ? 'W' : n + 'W';
  return n === 1 ? 'M' : n + 'M';
}
// Typed text -> id. Lower-case m = minutes, upper-case M = months (TradingView's convention).
export function parseTyped(text) {
  const m = /^\s*(\d*)\s*([a-zA-Z]*)\s*$/.exec(String(text || ''));
  if (!m || (!m[1] && !m[2])) return null;
  const n = m[1] ? +m[1] : 1;
  const u = m[2];
  const map = { '': 'min', m: 'min', min: 'min', h: 'hour', s: 'sec', t: 'tick', d: 'day', w: 'week', mo: 'month' };
  const unit = u === 'M' ? 'month' : map[u.toLowerCase()];
  if (!unit) return null;
  if (unit === 'min' && n >= 60 && n % 60 === 0 && n < 1440) return String(n);
  return ivFrom(n, unit);
}
const ivMs = (tf) => { const p = parseIv(tf); return p ? p.ms : Infinity; };
export const sortIvs = (list) => list.slice().sort((a, b) => ivMs(a) - ivMs(b));

// ---------------- aggregation (pure, exported for tests) ----------------
// New York UTC offset (ms), US DST rules (mirrors chart-futures-provider.js nyOffset).
function nthSunday(y, m, n) { const f = Date.UTC(y, m, 1); const dow = new Date(f).getUTCDay(); return f + (((7 - dow) % 7) + 7 * (n - 1)) * 864e5; }
function nyOffsetMs(t) {
  const y = new Date(t).getUTCFullYear();
  const s = nthSunday(y, 2, 2) + 7 * H, e = nthSunday(y, 10, 1) + 6 * H;
  return t >= s && t < e ? -4 * H : -5 * H;
}
// Bucket key: N-minute bars anchored to 18:00 New York (the Globex open), so for any size that
// divides 24 h every session starts a fresh bar (45m: 18:00, 18:45 ... ; 3h: 18, 21, 00 ...).
// Spot forex passes anchor 17 (its trading day opens 17:00 New York).
export function sessionKey(t, sizeMs, anchor = 18) {
  const shift = nyOffsetMs(t) + (24 - anchor) * H;
  const open = Math.floor((t + shift) / 864e5) * 864e5 - shift; // latest 18:00 New York at or before t
  return open + Math.floor((t - open) / sizeMs) * sizeMs;
}
export const utcKey = (t, sizeMs) => Math.floor(t / sizeMs) * sizeMs;
export function monthKey(t, n) {
  const d = new Date(t + 12 * H); // monthly bars stamped near midnight of the 1st: stay in that month
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
  return Math.floor(idx / n) * n;
}
export function aggregateBars(bars, keyOf) {
  const out = [];
  let cur = null, curKey = null;
  for (const b of bars) {
    const k = keyOf(b.time);
    if (cur && k === curKey) {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume = (cur.volume || 0) + (b.volume || 0);
    } else {
      curKey = k;
      cur = { time: typeof k === 'number' && k > 1e11 ? k : b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
      out.push(cur);
    }
  }
  return out;
}

// Which intervals a source serves natively (others are built by wrapProvider).
const NATIVE_FUT_MIN = [1, 5, 15, 30, 60, 120, 240];
// How to build `tf` for this provider, or null when the inner provider serves it itself.
export function planFor(provider, tf) {
  const p = parseIv(tf);
  if (!p) return null;
  if (p.kind === 'month' && p.n > 1) return { base: 'M', ratio: p.n, key: (t) => monthKey(t, p.n) };
  if (p.kind === 'day' && p.n > 1) return { base: 'D', ratio: p.n, key: (t) => Math.floor(Math.floor((t + 12 * H) / 864e5) / p.n) };
  if (p.kind === 'week' && p.n > 1) return { base: 'W', ratio: p.n, key: (t) => Math.floor(Math.floor((t + 3.5 * 864e5) / 6048e5) / p.n) };
  if ((provider !== 'futures' && provider !== 'fx') || p.kind !== 'min' || NATIVE_FUT_MIN.includes(p.n)) return null;
  if (p.n >= 1440) return null;
  const base = NATIVE_FUT_MIN.filter((m) => m < p.n && p.n % m === 0).pop() || 1;
  const size = p.n * MIN;
  const anchor = provider === 'fx' ? 17 : 18;
  return { base: String(base), ratio: p.n / base, key: (t) => sessionKey(t, size, anchor) };
}

// ---------------- seconds + ticks ----------------
let Flow = null;                   // assets/chart-orderflow.js (trade sources), set by useTrades()
const tradeListeners = new Set();
export function useTrades(flow) {
  Flow = flow;
  try { flow.onTradeSourcesChanged(() => tradeListeners.forEach((cb) => { try { cb(); } catch (e) {} })); } catch (e) {}
}
const hasTrades = (provider) => { try { return !!(Flow && Flow.hasTradeSource(provider)); } catch (e) { return false; } };
const isPerp = (ticker) => /\.P$/i.test(ticker);

// What a source can draw for seconds / ticks: '' (yes) or the reason it cannot.
export function secTickBlock(tf, provider, ticker) {
  const p = parseIv(tf);
  if (!p || (p.kind !== 'sec' && p.kind !== 'tick')) return '';
  if (provider === 'futures') return hasTrades('futures') ? '' : NEED_RITHMIC;
  if (provider === 'binance') return (p.kind === 'tick' || isPerp(ticker || '')) && !hasTrades('binance') ? 'Live trades are not available right now.' : '';
  return (p.kind === 'sec' ? 'Seconds' : 'Tick') + ' charts need Binance data. Pick a Binance symbol for this interval.';
}

const SPOT_REST = ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3'];
async function spotKlines1s(sym, params) {
  let err;
  for (const b of SPOT_REST) {
    const u = new URL(b + '/klines');
    u.searchParams.set('symbol', sym); u.searchParams.set('interval', '1s');
    Object.keys(params).forEach((k) => params[k] != null && u.searchParams.set(k, String(params[k])));
    try { const r = await fetch(u.toString()); if (r.ok) { const d = await r.json(); return Array.isArray(d) ? d : []; } err = new Error('HTTP ' + r.status); }
    catch (e) { err = e; }
  }
  throw err;
}
// Binance spot seconds bars from native 1 s candles (n > 1 aggregated on epoch-aligned buckets;
// a first bucket that starts before the fetched window is dropped, so no bar is half-filled).
export async function binanceSeconds(ticker, n, range = {}) {
  const sym = ticker.toUpperCase();
  const size = n * 1000;
  const need = Math.min(((range.limit != null ? range.limit : 500) + 1) * n, 5000);
  let rows = [];
  if (range.from != null) {
    let cursor = range.from;
    const to = range.to != null ? range.to : Date.now();
    while (cursor < to && rows.length < need) {
      const c = await spotKlines1s(sym, { startTime: cursor, endTime: to, limit: 1000 });
      if (!c.length) break;
      rows = rows.concat(c);
      cursor = Number(c[c.length - 1][0]) + 1000;
      if (c.length < 1000) break;
    }
  } else {
    let end = range.to != null ? range.to : null;
    while (rows.length < need) {
      const c = await spotKlines1s(sym, { endTime: end, limit: Math.min(1000, need - rows.length) });
      if (!c.length) break;
      rows = c.concat(rows);
      end = Number(c[0][0]) - 1;
      if (c.length < 1000) break;
    }
  }
  const sub = rows.map((k) => ({ time: Number(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
  let out = n === 1 ? sub : aggregateBars(sub, (t) => utcKey(t, size));
  if (n > 1 && out.length && sub.length && out[0].time < sub[0].time) out = out.slice(1);
  if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
  return out;
}

// Bars built from a live trade stream: mode 'tick' (n trades per bar) or 'time' (n-second buckets).
// One builder per provider|ticker|interval, shared by getBars and subscribe, closed 15 s after
// its last user. Trades: { time, price, size, n? } (n = exchange trades in one aggregate trade).
const MAX_TRADE_BARS = 2000;
const builders = new Map();
class TradeBars {
  constructor(provider, ticker, mode, n) {
    this.key = provider + '|' + ticker + '|' + mode + n;
    this.mode = mode; this.n = n; this.size = n * 1000;
    this.bars = []; this.cur = null; this.count = 0; this.skipKey = null;
    this.status = 'loading'; this.history = false; this.listeners = new Set(); this.users = 0; this.idle = 0;
    this.ready = new Promise((res) => { this.markReady = res; });
    setTimeout(() => this.markReady(), 10000);
    this.stop = (Flow && Flow.openTradeSource(provider, ticker, (ts, backfill) => this.add(ts, backfill), (st) => {
      this.status = st;
      if (st === 'live' || st === 'error' || st === 'waiting') this.markReady();
    })) || (() => {});
    if (!Flow || !Flow.hasTradeSource(provider)) { this.status = 'error'; this.markReady(); }
  }
  add(ts, backfill) {
    if (!ts || !ts.length) return;
    if (backfill) this.history = true;
    const changed = [];
    for (const t of ts) {
      if (!(t.price > 0)) continue;
      if (this.mode === 'time') {
        const k = utcKey(t.time, this.size);
        if (this.skipKey == null) this.skipKey = k;   // first bucket was entered part-way: never shown
        if (k === this.skipKey) continue;
        if (this.cur && this.cur.time !== k) { this.push(); }
        if (!this.cur) this.cur = { time: k, open: t.price, high: t.price, low: t.price, close: t.price, volume: 0 };
      } else if (!this.cur) {
        const last = this.bars.length ? this.bars[this.bars.length - 1].time : 0;
        this.cur = { time: Math.max(t.time, last + 1), open: t.price, high: t.price, low: t.price, close: t.price, volume: 0 };
      }
      const c = this.cur;
      if (t.price > c.high) c.high = t.price;
      if (t.price < c.low) c.low = t.price;
      c.close = t.price;
      c.volume += t.size > 0 ? t.size : 0;
      if (this.mode === 'tick') {
        this.count += t.n > 0 ? t.n : 1;
        if (this.count >= this.n) { changed.push({ ...c }); this.push(); }
      }
    }
    if (this.cur) changed.push({ ...this.cur });
    if (this.mode === 'time' && this.bars.length) changed.unshift({ ...this.bars[this.bars.length - 1] });
    if (!backfill) changed.forEach((b) => this.listeners.forEach((cb) => { try { cb(b); } catch (e) {} }));
  }
  push() {
    this.bars.push(this.cur);
    if (this.bars.length > MAX_TRADE_BARS) this.bars.shift();
    this.cur = null; this.count = 0;
  }
  all() { return this.cur ? this.bars.concat([this.cur]) : this.bars.slice(); }
  use() { this.users++; clearTimeout(this.idle); }
  release() {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) { clearTimeout(this.idle); this.idle = setTimeout(() => { if (!this.users) { try { this.stop(); } catch (e) {} builders.delete(this.key); } }, 15000); }
  }
}
function builderFor(provider, ticker, mode, n) {
  const key = provider + '|' + ticker + '|' + mode + n;
  let b = builders.get(key);
  if (!b) { b = new TradeBars(provider, ticker, mode, n); builders.set(key, b); }
  return b;
}
// True when the newest builder for this chart has no history (Rithmic): tick bars build from now.
export function tradeHistoryState(provider, ticker, tf) {
  const p = parseIv(tf);
  if (!p) return null;
  const b = builders.get(provider + '|' + ticker + '|' + (p.kind === 'tick' ? 'tick' : 'time') + p.n);
  return b ? { history: b.history, status: b.status, bars: b.all().length } : null;
}
function secTickGetBars(provider, ticker, p, range) {
  if (provider === 'binance' && p.kind === 'sec' && !isPerp(ticker)) return binanceSeconds(ticker, p.n, range);
  const b = builderFor(provider, ticker, p.kind === 'tick' ? 'tick' : 'time', p.n);
  b.use();
  return b.ready.then(() => {
    let out = b.all();
    if (range.to != null) out = out.filter((x) => x.time <= range.to);
    if (range.from != null) out = out.filter((x) => x.time >= range.from);
    if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
    return out.map((x) => ({ ...x }));
  }).finally(() => b.release());
}
function secTickSubscribe(provider, ticker, p, onBar) {
  if (provider === 'binance' && p.kind === 'sec' && !isPerp(ticker)) {
    // Forming bar: re-read the newest 1 s candles every second (paused while the tab is hidden).
    let stopped = false, timer = null;
    const tick = async () => {
      timer = null;
      if (stopped) return;
      if (typeof document === 'undefined' || !document.hidden) {
        try { const bars = await binanceSeconds(ticker, p.n, { limit: 2 }); if (!stopped) bars.forEach((x) => onBar(x)); } catch (e) { /* next poll */ }
      }
      if (!stopped) timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 1000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }
  const b = builderFor(provider, ticker, p.kind === 'tick' ? 'tick' : 'time', p.n);
  b.use();
  b.listeners.add(onBar);
  return () => { b.listeners.delete(onBar); b.release(); };
}

// Wrap a Vela DataProvider so the intervals above can be built from a native one. Everything else
// passes straight through to the inner provider.
export function wrapProvider(inner, name, pollMs) {
  const getBars = async (ticker, timeframe, range = {}) => {
    const sp = parseIv(timeframe);
    if (sp && (sp.kind === 'sec' || sp.kind === 'tick')) return secTickBlock(timeframe, name, ticker) ? [] : secTickGetBars(name, ticker, sp, range);
    const plan = planFor(name, timeframe);
    if (!plan) return inner.getBars(ticker, timeframe, range);
    const lim = range.limit != null ? range.limit * plan.ratio + plan.ratio : undefined;
    const sub = await inner.getBars(ticker, plan.base, { ...range, limit: lim });
    let out = aggregateBars(sub || [], plan.key);
    if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
    return out;
  };
  const subscribe = (ticker, timeframe, onBar, opts) => {
    const sp = parseIv(timeframe);
    if (sp && (sp.kind === 'sec' || sp.kind === 'tick')) return secTickBlock(timeframe, name, ticker) ? () => {} : secTickSubscribe(name, ticker, sp, onBar);
    if (!planFor(name, timeframe)) return inner.subscribe ? inner.subscribe(ticker, timeframe, onBar, opts) : () => {};
    // Built interval: re-read the newest two built bars (the forming one moves), paused while hidden.
    let stopped = false, timer = null;
    const tick = async () => {
      timer = null;
      if (stopped) return;
      if (typeof document === 'undefined' || !document.hidden) {
        try { const bars = await getBars(ticker, timeframe, { limit: 2 }); if (!stopped) bars.forEach((b) => onBar(b)); } catch (e) { /* next poll */ }
      }
      if (!stopped) timer = setTimeout(tick, pollMs);
    };
    timer = setTimeout(tick, pollMs);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  };
  return new Proxy(inner, {
    get(t, prop) {
      if (prop === 'getBars') return getBars;
      if (prop === 'subscribe') return subscribe;
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}
export const wrapFactory = (factory, name, pollMs) => () => wrapProvider(factory(), name, pollMs || (name === 'futures' || name === 'fx' ? 20000 : 5000));

// ---------------- UI ----------------
const CSS = `
.vela-widget-tf-group > .vela-widget-tf-chips, .vela-widget-tf-group > .vela-widget-tf-caret{display:none!important}
.stk-iv-row{display:inline-flex;align-items:center;gap:2px}
.stk-iv-b{all:unset;box-sizing:border-box;height:30px;min-width:30px;padding:0 7px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:6px;cursor:pointer;font-size:13px;font-weight:550;color:#d1d4dc;white-space:nowrap}
.stk-iv-b:hover{background:rgba(255,255,255,.08);color:#fff}
.stk-iv-b.on{background:#2a2e39;color:#fff}
.stk-iv-b:focus-visible{outline:2px solid #2962ff;outline-offset:-2px}
.stk-iv-caret{min-width:20px;padding:0 3px;color:#b2b5be}
.stk-iv-caret svg{width:16px;height:16px;transition:transform .15s}
.stk-iv-caret[aria-expanded="true"] svg{transform:rotate(180deg)}
:root[data-theme="light"] .stk-iv-b{color:#131722}
:root[data-theme="light"] .stk-iv-b:hover{background:#f0f3fa;color:#131722}
:root[data-theme="light"] .stk-iv-b.on{background:#e0e3eb;color:#131722}
.stk-iv-menu{position:fixed;z-index:2147483000;width:250px;max-height:min(560px,calc(100vh - 80px));overflow-y:auto;overscroll-behavior:contain;
  background:#1e222d;color:#d1d4dc;border:1px solid #363a45;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:6px 0;
  font:13px/1.2 -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif;user-select:none}
.stk-iv-menu[hidden]{display:none}
.stk-iv-menu.sheet{left:0!important;right:0;top:auto!important;bottom:0;width:auto;max-height:72vh;border-radius:14px 14px 0 0;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
.stk-iv-add{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:9px 14px;cursor:pointer;color:#d1d4dc}
.stk-iv-add:hover{background:#2a2e39}
.stk-iv-add[aria-disabled="true"]{color:#787b86;cursor:default}
.stk-iv-add[aria-disabled="true"]:hover{background:none}
.stk-iv-sep{height:1px;background:#363a45;margin:5px 0}
.stk-iv-h{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;width:100%;padding:9px 14px 6px;cursor:pointer;
  color:#787b86;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.stk-iv-h:hover{color:#b2b5be}
.stk-iv-h svg{width:14px;height:14px;transition:transform .15s}
.stk-iv-h[aria-expanded="false"] svg{transform:rotate(180deg)}
.stk-iv-list{margin:0;padding:0 6px;list-style:none}
.stk-iv-list[hidden]{display:none}
.stk-iv-r{display:flex;align-items:center;gap:6px;height:34px;padding:0 6px 0 10px;border-radius:6px;cursor:pointer}
.stk-iv-r:hover{background:#2a2e39}
.stk-iv-r.on{background:#fff;color:#131722}
.stk-iv-r .l{flex:1}
.stk-iv-r .tag{font-size:10px;font-weight:600;letter-spacing:.04em;padding:2px 5px;border-radius:4px;background:rgba(41,98,255,.18);color:#82a6ff}
.stk-iv-r.on .tag{background:#e0e3eb;color:#2962ff}
.stk-iv-r.na .l{color:#787b86}
.stk-iv-r.na.on .l{color:#131722}
.stk-iv-star{all:unset;box-sizing:border-box;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;color:#787b86;visibility:hidden}
.stk-iv-star svg{width:16px;height:16px}
.stk-iv-r:hover .stk-iv-star,.stk-iv-star.fav,.stk-iv-star:focus-visible{visibility:visible}
.stk-iv-star.fav{color:#f5a623}
.stk-iv-star:hover{color:#f5a623}
@media (hover:none){.stk-iv-star{visibility:visible}}
:root[data-theme="light"] .stk-iv-menu{background:#fff;color:#131722;border-color:#e0e3eb;box-shadow:0 8px 24px rgba(0,0,0,.18)}
:root[data-theme="light"] .stk-iv-add{color:#131722}
:root[data-theme="light"] .stk-iv-add:hover,:root[data-theme="light"] .stk-iv-r:hover{background:#f0f3fa}
:root[data-theme="light"] .stk-iv-r.on{background:#131722;color:#fff}
:root[data-theme="light"] .stk-iv-r.na.on .l{color:#fff}
:root[data-theme="light"] .stk-iv-r.on .tag{background:#363a45;color:#82a6ff}
:root[data-theme="light"] .stk-iv-sep{background:#e0e3eb}
.stk-iv-x{all:unset;box-sizing:border-box;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;color:#787b86;font-size:15px;line-height:1}
.stk-iv-x:hover{color:#f23645;background:rgba(242,54,69,.12)}
.stk-iv-dlg{position:fixed;z-index:2147483001;left:50%;top:22%;transform:translateX(-50%);width:min(300px,calc(100vw - 24px));box-sizing:border-box;
  background:#1e222d;color:#d1d4dc;border:1px solid #363a45;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.55);padding:14px;
  font:13px/1.3 -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif}
.stk-iv-dlg[hidden]{display:none}
.stk-iv-dlg h3{margin:0 0 10px;font-size:15px;font-weight:600;color:#fff}
.stk-iv-dlg .f{display:flex;gap:8px}
.stk-iv-dlg input,.stk-iv-dlg select{box-sizing:border-box;height:34px;border-radius:6px;border:1px solid #434651;background:#131722;color:#d1d4dc;padding:0 10px;font:inherit;min-width:0}
.stk-iv-dlg input{flex:0 0 90px}
.stk-iv-dlg select{flex:1}
.stk-iv-dlg input:focus,.stk-iv-dlg select:focus{outline:none;border-color:#2962ff}
.stk-iv-dlg .msg{min-height:18px;margin:8px 0 2px;color:#787b86;font-size:12px}
.stk-iv-dlg .msg.bad{color:#f23645}
.stk-iv-dlg .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.stk-iv-dlg button{all:unset;box-sizing:border-box;height:32px;padding:0 14px;border-radius:6px;cursor:pointer;font-weight:600}
.stk-iv-dlg .ok{background:#2962ff;color:#fff}
.stk-iv-dlg .ok:hover{background:#1e53e5}
.stk-iv-dlg .no{color:#d1d4dc;border:1px solid #434651}
.stk-iv-dlg .no:hover{background:#2a2e39}
.stk-iv-dlg.quick{top:30%;width:220px;padding:12px;text-align:center}
.stk-iv-dlg.quick input{width:100%;height:40px;font-size:18px;text-align:center}
:root[data-theme="light"] .stk-iv-dlg{background:#fff;color:#131722;border-color:#e0e3eb;box-shadow:0 12px 32px rgba(0,0,0,.2)}
:root[data-theme="light"] .stk-iv-dlg h3{color:#131722}
:root[data-theme="light"] .stk-iv-dlg input,:root[data-theme="light"] .stk-iv-dlg select{background:#fff;color:#131722;border-color:#d1d4dc}
:root[data-theme="light"] .stk-iv-dlg .no{color:#131722;border-color:#d1d4dc}
:root[data-theme="light"] .stk-iv-dlg .no:hover{background:#f0f3fa}
.stk-iv-note{position:absolute;z-index:20;top:34px;right:70px;padding:3px 8px;border-radius:4px;background:rgba(41,98,255,.16);color:#82a6ff;
  font:600 11px/1.3 -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif;pointer-events:auto;white-space:nowrap}
:root[data-theme="light"] .stk-iv-note{background:rgba(41,98,255,.1);color:#2962ff}
.stk-iv-scrim{position:fixed;inset:0;z-index:2147482999;background:rgba(0,0,0,.45)}
.stk-iv-scrim[hidden]{display:none}
`;

const SVG = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
const CHEV_DOWN = SVG('<path d="M6 9l6 6 6-6"/>');
const CHEV_UP = SVG('<path d="M6 15l6-6 6 6"/>');
const STAR = (on) => SVG('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"' + (on ? ' fill="currentColor"' : '') + '/>');

function readLs(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : fallback; } catch (e) { return fallback; }
}
function writeLs(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
const providerOf = (sym) => { const m = /^([a-z]+):/i.exec(String(sym || '')); return m ? m[1].toLowerCase() : ''; };

// ---------------- account sync ----------------
const DOC_ID = 'intervals';
const MAX_FAVS = 40;
const clean = (list, max, ok) => (Array.isArray(list) ? list : []).filter((x, i, a) => typeof x === 'string' && x.length <= 12 && ok(x) && a.indexOf(x) === i).slice(0, max);
export function prefsDoc(p) {
  return {
    favs: clean(p.favs, MAX_FAVS, (x) => !!parseIv(x)),
    custom: clean(p.custom, MAX_CUSTOM, (x) => !!parseIv(x)),
    collapsed: clean(p.collapsed, 5, (x) => SECTIONS.some((sec) => sec.id === x))
  };
}
function prefRef(uid) { return firebase.firestore().collection('students').doc(uid).collection('chartPrefs').doc(DOC_ID); }
function startCloudSync(api) {
  let uid = null, timer = 0, ready = false;
  const push = (p) => {
    if (!uid || !ready) return;
    clearTimeout(timer);
    const u = uid;
    timer = setTimeout(() => {
      const d = prefsDoc(p);
      d.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      prefRef(u).set(d).catch((e) => console.warn('Stryker: interval prefs save', e));
    }, 600);
  };
  const onAuth = async (u) => {
    uid = u ? u.uid : null; ready = false;
    if (!uid) return;
    try {
      const snap = await prefRef(uid).get();
      if (uid !== (u && u.uid)) return;
      if (snap.exists) {
        const d = snap.data() || {};
        api.setPrefs({ favs: d.favs, custom: d.custom, collapsed: d.collapsed });
        ready = true;
      } else {
        ready = true;
        push({ favs: api.favs(), custom: api.custom(), collapsed: api.collapsed() }); // first sign-in: copy local up
      }
    } catch (e) { console.warn('Stryker: interval prefs load', e); ready = false; }
  };
  const hook = () => {
    try { if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return false; firebase.auth().onAuthStateChanged(onAuth); return true; } catch (e) { return false; }
  };
  if (!hook()) { let n = 0; const t = setInterval(() => { if (hook() || ++n > 40) clearInterval(t); }, 250); }
  return push;
}

export function mountIntervals(ws, opts) {
  opts = opts || {};
  const toast = opts.toast || (() => {});
  if (!document.getElementById('stk-iv-css')) { const st = document.createElement('style'); st.id = 'stk-iv-css'; st.textContent = CSS; document.head.appendChild(st); }

  const known = new Set(SECTIONS.flatMap((s) => s.rows));
  let favs = readLs(LS_FAVS, DEFAULT_FAVS).filter((t) => typeof t === 'string' && parseIv(t));
  let collapsed = readLs(LS_COLLAPSED, []).filter((s) => typeof s === 'string');
  let custom = readLs(LS_CUSTOM, []).filter((t) => typeof t === 'string' && parseIv(t) && !known.has(t)).slice(0, MAX_CUSTOM);
  const tickerOf = (sym) => String(sym || '').replace(/^[a-z]+:/i, '');
  let cloudPush = null;
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const activeCell = () => { try { return ws.active; } catch (e) { return null; } };
  const activeTf = () => { const c = activeCell(); return c ? String(c.timeframe || '') : ''; };
  const activeSym = () => { const c = activeCell(); return c ? String(c.symbol || '') : ''; };

  // Why an interval cannot open on the active chart right now, or '' when it can.
  function blocked(tf, sym) {
    sym = sym == null ? activeSym() : sym;
    return secTickBlock(tf, providerOf(sym), tickerOf(sym));
  }
  function apply(tf) {
    if (!parseIv(tf)) { toast('That is not an interval.', 'error'); return false; }
    const why = blocked(tf);
    if (why) { toast(why, 'info'); return false; }
    try { ws.setActiveTimeframe(tf); } catch (e) { console.warn('Stryker: interval', e); toast('That interval could not be opened on this chart.', 'error'); return false; }
    setTimeout(render, 0);
    let id = null; try { id = ws.active.id; } catch (e) {}
    if (id) watchCell(id, tf);
    return true;
  }
  // Never a blank chart: a cell left on an interval it cannot draw (Interval sync, a saved layout,
  // a symbol switch) or that gets no bars goes back to 1 minute with a message. Trade-built bars
  // with no history (a Rithmic connection) are allowed to start empty: they build from now.
  const watching = new Map();
  function watchCell(id, tf) {
    clearTimeout(watching.get(id));
    watching.set(id, setTimeout(() => {
      watching.delete(id);
      const c = (() => { try { return ws.cell(id); } catch (e) { return null; } })();
      if (!c || String(c.timeframe) !== tf) return;
      let n = 0; try { n = c.chart.orchestrator.rawBars.length; } catch (e) { return; }
      if (n > 0) return;
      const h = tradeHistoryState(providerOf(c.symbol), tickerOf(c.symbol), tf);
      if (h && !h.history && h.status !== 'error') return;
      try { c.setTimeframe('1'); } catch (e) {}
      toast(ivLong(tf) + ' bars are not available for ' + tickerOf(c.symbol) + ' right now. Showing 1 minute.', 'info');
    }, 15000));
  }
  function guardCells() {
    let cells = [];
    try { cells = ws.cells(); } catch (e) { return; }
    cells.forEach((c) => {
      const tf = String(c.timeframe || '');
      const why = parseIv(tf) ? blocked(tf, c.symbol) : '';
      if (why) {
        try { c.setTimeframe('1'); } catch (e) {}
        toast(tickerOf(c.symbol) + ': ' + why + ' Showing 1 minute.', 'info');
      }
      const p = parseIv(tf);
      if (p && (p.kind === 'sec' || p.kind === 'tick') && !watching.has(c.id)) watchCell(c.id, tf);
      noteFor(c, tf);
    });
  }
  // "Building from now" note on trade-built charts that have no history.
  function noteFor(c, tf) {
    const host = document.querySelector('#vela-chart .vela-cell[data-cell-id="' + c.id + '"]');
    if (!host) return;
    let note = host.querySelector(':scope > .stk-iv-note');
    const p = parseIv(tf);
    const h = p && (p.kind === 'tick' || p.kind === 'sec') ? tradeHistoryState(providerOf(c.symbol), tickerOf(c.symbol), tf) : null;
    const text = !h ? '' : !h.history ? 'Building from now' : (p.kind === 'tick' ? 'Built from recent trades' : '');
    if (!text) { if (note) note.remove(); return; }
    if (!note) { note = document.createElement('div'); note.className = 'stk-iv-note'; host.appendChild(note); }
    note.textContent = text;
    note.title = !h.history ? 'No tick history on this connection: bars are built from the live trades since you opened this chart.' : 'History is limited to the most recent trades the exchange returns; new bars build live.';
  }
  function saved() { writeLs(LS_FAVS, favs); writeLs(LS_COLLAPSED, collapsed); writeLs(LS_CUSTOM, custom); if (cloudPush) { try { cloudPush({ favs, collapsed, custom }); } catch (e) {} } }
  function toggleFav(tf) {
    favs = favs.includes(tf) ? favs.filter((f) => f !== tf) : favs.concat(tf);
    saved();
    render();
    renderMenu();
  }
  function addCustom(tf) {
    if (!parseIv(tf)) return 'That is not an interval.';
    if (!known.has(tf) && !custom.includes(tf)) {
      if (custom.length >= MAX_CUSTOM) return 'You can keep up to ' + MAX_CUSTOM + ' custom intervals.';
      custom = custom.concat(tf);
    }
    if (!favs.includes(tf)) favs = favs.concat(tf);
    const sec = sectionOf(tf);
    collapsed = collapsed.filter((x) => x !== sec);
    saved(); render(); renderMenu();
    return '';
  }
  function removeCustom(tf) {
    custom = custom.filter((x) => x !== tf);
    favs = favs.filter((x) => x !== tf);
    saved(); render(); renderMenu();
  }
  // Cloud sync (assets/chart-intervals.js setPrefs) replaces the three lists in place.
  function setPrefs(p) {
    if (!p) return;
    if (Array.isArray(p.favs)) favs = p.favs.filter((t) => typeof t === 'string' && parseIv(t));
    if (Array.isArray(p.collapsed)) collapsed = p.collapsed.filter((x) => typeof x === 'string');
    if (Array.isArray(p.custom)) custom = p.custom.filter((t) => typeof t === 'string' && parseIv(t) && !known.has(t)).slice(0, MAX_CUSTOM);
    writeLs(LS_FAVS, favs); writeLs(LS_COLLAPSED, collapsed); writeLs(LS_CUSTOM, custom);
    render(); renderMenu();
  }

  // ---- top-bar row ----
  const row = document.createElement('span');
  row.className = 'stk-iv-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Chart interval');
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'stk-iv-b stk-iv-caret';
  caret.setAttribute('aria-haspopup', 'true');
  caret.setAttribute('aria-expanded', 'false');
  caret.title = 'Intervals';
  caret.innerHTML = CHEV_DOWN;
  const chips = document.createElement('span');
  chips.className = 'stk-iv-row';
  row.append(chips, caret);

  let narrow = false;
  function render() {
    const cur = activeTf();
    let list = narrow ? [] : sortIvs(favs.filter((f, i, a) => a.indexOf(f) === i));
    if (cur && !list.includes(cur)) list = sortIvs(list.concat(cur));
    chips.innerHTML = '';
    list.forEach((tf) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stk-iv-b' + (tf === cur ? ' on' : '');
      b.textContent = ivShort(tf);
      b.title = ivLong(tf);
      b.dataset.iv = tf;
      if (tf === cur) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', (e) => { e.stopPropagation(); if (narrow && tf === cur) toggleMenu(); else if (tf !== cur) apply(tf); });
      chips.appendChild(b);
    });
  }

  let topbar = null;
  let ro = null;
  function attach() {
    const group = document.querySelector('#vela-chart .vela-widget-tf-group');
    if (!group) return false;
    if (row.parentElement !== group) group.appendChild(row);
    const tb = group.closest('.vela-widget-topbar');
    if (tb && tb !== topbar) {
      topbar = tb;
      if (ro) ro.disconnect();
      ro = new ResizeObserver(() => {
        const n = isPhone() || topbar.getBoundingClientRect().width < NARROW_BAR;
        if (n !== narrow) { narrow = n; render(); }
      });
      ro.observe(topbar);
    }
    narrow = isPhone() || (topbar ? topbar.getBoundingClientRect().width < NARROW_BAR : false);
    render();
    return true;
  }

  // ---- menu ----
  const menu = document.createElement('div');
  menu.className = 'stk-iv-menu';
  menu.id = 'stk-iv-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Intervals');
  menu.hidden = true;
  const scrim = document.createElement('div');
  scrim.className = 'stk-iv-scrim';
  scrim.hidden = true;
  document.body.append(scrim, menu);
  menu.addEventListener('click', (e) => e.stopPropagation());
  scrim.addEventListener('click', () => setOpen(false));

  function renderMenu() {
    if (menu.hidden) return;
    const keepScroll = menu.scrollTop;
    const cur = activeTf();
    const fut = providerOf(activeSym()) === 'futures';
    menu.innerHTML = '';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'stk-iv-add';
    add.innerHTML = '<span aria-hidden="true">+</span><span>Add custom interval…</span>';
    add.addEventListener('click', () => { setOpen(false); openCustom(); });
    menu.appendChild(add);
    SECTIONS.forEach((sec) => {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'stk-iv-sep' }));
      const open = !collapsed.includes(sec.id);
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'stk-iv-h';
      h.setAttribute('aria-expanded', open ? 'true' : 'false');
      h.setAttribute('aria-controls', 'stk-iv-sec-' + sec.id);
      h.innerHTML = '<span>' + sec.label + '</span>' + CHEV_UP;
      h.addEventListener('click', () => {
        collapsed = open ? collapsed.concat(sec.id) : collapsed.filter((s) => s !== sec.id);
        saved();
        renderMenu();
      });
      menu.appendChild(h);
      const ul = document.createElement('ul');
      ul.className = 'stk-iv-list';
      ul.id = 'stk-iv-sec-' + sec.id;
      ul.hidden = !open;
      sortIvs(sec.rows.concat(custom.filter((t) => sectionOf(t) === sec.id))).forEach((tf) => {
        const why = blocked(tf);
        const li = document.createElement('li');
        li.className = 'stk-iv-r' + (tf === cur ? ' on' : '') + (why ? ' na' : '');
        li.dataset.iv = tf;
        li.setAttribute('role', 'button');
        li.tabIndex = 0;
        if (why) li.title = why;
        const l = document.createElement('span');
        l.className = 'l';
        l.textContent = ivLong(tf);
        li.appendChild(l);
        if (why && fut && why === NEED_RITHMIC) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = 'Rithmic';
          tag.title = NEED_RITHMIC;
          li.appendChild(tag);
        }
        const fav = favs.includes(tf);
        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'stk-iv-star' + (fav ? ' fav' : '');
        star.setAttribute('aria-pressed', fav ? 'true' : 'false');
        star.setAttribute('aria-label', (fav ? 'Remove from favourites: ' : 'Add to favourites: ') + ivLong(tf));
        star.innerHTML = STAR(fav);
        star.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(tf); });
        li.appendChild(star);
        if (custom.includes(tf)) {
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'stk-iv-x';
          x.textContent = '×';
          x.setAttribute('aria-label', 'Remove custom interval ' + ivLong(tf));
          x.title = 'Remove';
          x.addEventListener('click', (e) => { e.stopPropagation(); removeCustom(tf); });
          li.appendChild(x);
        }
        const go = () => { if (apply(tf)) setOpen(false); };
        li.addEventListener('click', go);
        li.addEventListener('keydown', (e) => { if (e.target === li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); } });
        ul.appendChild(li);
      });
      menu.appendChild(ul);
    });
    menu.scrollTop = keepScroll;
  }

  let anchor = caret;
  function place() {
    if (isPhone()) { menu.classList.add('sheet'); scrim.hidden = false; return; }
    menu.classList.remove('sheet');
    scrim.hidden = true;
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 250;
    menu.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left)) + 'px';
    menu.style.top = Math.round(r.bottom + 4) + 'px';
  }
  function setOpen(open, from) {
    if (open) {
      anchor = from || caret;
      menu.hidden = false;
      renderMenu();
      place();
      const on = menu.querySelector('.stk-iv-r.on');
      if (on && !isPhone()) {
        const mr = menu.getBoundingClientRect(), orr = on.getBoundingClientRect();
        if (orr.bottom > mr.bottom || orr.top < mr.top) menu.scrollTop += orr.top - mr.top - mr.height / 2;
      }
    } else {
      menu.hidden = true;
      scrim.hidden = true;
    }
    caret.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function toggleMenu(from) { setOpen(menu.hidden, from); }
  caret.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', () => { if (!menu.hidden) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setOpen(false); });
  window.addEventListener('resize', () => { if (!menu.hidden) place(); }, { passive: true });

  // Phone bar: its interval button opens this menu (as a bottom sheet) instead of Vela's drawer.
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('#vela-chart .vela-mb-tf');
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleMenu(b);
  }, true);

  // ---- "+ Add custom interval…" dialog ----
  const UNITS = [['tick', 'ticks'], ['sec', 'seconds'], ['min', 'minutes'], ['hour', 'hours'], ['day', 'days'], ['week', 'weeks'], ['month', 'months']];
  const dlg = document.createElement('div');
  dlg.className = 'stk-iv-dlg';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'stk-iv-dlg-h');
  dlg.hidden = true;
  dlg.innerHTML = '<h3 id="stk-iv-dlg-h">Add custom interval</h3><div class="f"><input type="number" inputmode="numeric" min="1" step="1" value="1" aria-label="Number"><select aria-label="Unit">'
    + UNITS.map(([v, l]) => '<option value="' + v + '"' + (v === 'min' ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
    + '<p class="msg" role="status"></p><div class="acts"><button type="button" class="no">Cancel</button><button type="button" class="ok">Add</button></div>';
  document.body.appendChild(dlg);
  const dIn = dlg.querySelector('input'), dSel = dlg.querySelector('select'), dMsg = dlg.querySelector('.msg');
  const dPreview = () => {
    const tf = ivFrom(dIn.value, dSel.value);
    dMsg.classList.toggle('bad', !tf);
    dMsg.textContent = tf ? ivLong(tf) + (known.has(tf) || custom.includes(tf) ? ' (already in the list: it will be starred)' : '') : 'Enter a whole number from 1 to ' + UNIT_MAX[dSel.value] + '.';
    return tf;
  };
  const closeCustom = () => { dlg.hidden = true; scrim.hidden = true; };
  const okCustom = () => {
    const tf = dPreview();
    if (!tf) { dIn.focus(); return; }
    const err = addCustom(tf);
    if (err) { dMsg.textContent = err; dMsg.classList.add('bad'); return; }
    closeCustom();
    toast(ivLong(tf) + ' added to your intervals.', 'success');
  };
  function openCustom() {
    dlg.hidden = false; scrim.hidden = false;
    dPreview();
    setTimeout(() => { dIn.focus(); dIn.select(); }, 0);
  }
  dIn.addEventListener('input', dPreview);
  dSel.addEventListener('change', dPreview);
  dlg.querySelector('.ok').addEventListener('click', okCustom);
  dlg.querySelector('.no').addEventListener('click', closeCustom);
  dlg.addEventListener('click', (e) => e.stopPropagation());
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); okCustom(); }
    if (e.key === 'Escape') { e.preventDefault(); closeCustom(); }
  });
  scrim.addEventListener('click', () => { if (!dlg.hidden) closeCustom(); });

  // ---- typed interval box: a digit or "," on the chart ----
  const quick = document.createElement('div');
  quick.className = 'stk-iv-dlg quick';
  quick.setAttribute('role', 'dialog');
  quick.setAttribute('aria-label', 'Change interval');
  quick.hidden = true;
  quick.innerHTML = '<input type="text" spellcheck="false" autocomplete="off" aria-label="Interval"><p class="msg" role="status"></p>';
  document.body.appendChild(quick);
  const qIn = quick.querySelector('input'), qMsg = quick.querySelector('.msg');
  const qHint = () => {
    const raw = qIn.value.trim();
    const tf = parseTyped(raw);
    qMsg.classList.toggle('bad', !!raw && !tf);
    qMsg.textContent = !raw ? 'e.g. 5, 4h, D, 15s, 100t' : tf ? ivLong(tf) : 'Not an interval';
    return tf;
  };
  const closeQuick = () => { quick.hidden = true; };
  function openQuick(seed) {
    quick.hidden = false;
    qIn.value = seed || '';
    qHint();
    setTimeout(() => { qIn.focus(); qIn.setSelectionRange(qIn.value.length, qIn.value.length); }, 0);
  }
  qIn.addEventListener('input', qHint);
  qIn.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeQuick(); }
    if (e.key === 'Enter') { e.preventDefault(); const tf = qHint(); if (tf) { closeQuick(); apply(tf); } }
  });
  qIn.addEventListener('blur', () => setTimeout(closeQuick, 120));
  quick.addEventListener('click', (e) => e.stopPropagation());
  const editable = (t) => !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t.closest && t.closest('[contenteditable="true"],[role="textbox"]'))));
  // Capture phase on window, so this runs before Vela's own quick box (which it replaces).
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (!/^[0-9,]$/.test(e.key)) return;
    const t = e.target;
    if (editable(t)) return;
    if (!dlg.hidden || !quick.hidden) return;
    if (document.querySelector('.vela-dialog-layer:not([hidden]) .vela-dialog, [role="dialog"][aria-modal="true"]:not([hidden]):not(.stk-iv-dlg)')) return;
    const onChart = t === document.body || t === document.documentElement || (t.closest && t.closest('#vela-chart'));
    if (!onChart) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openQuick(e.key === ',' ? '' : e.key);
  }, true);

  const refresh = () => { if (!row.isConnected) attach(); render(); renderMenu(); guardCells(); };
  tradeListeners.add(() => { renderMenu(); guardCells(); });
  try { ws.on('cell:active', () => setTimeout(refresh, 0)); } catch (e) {}
  try { ws.on('state:changed', () => refresh()); } catch (e) {}
  try { ws.on('layout:changed', () => setTimeout(refresh, 0)); } catch (e) {}
  if (!attach()) { let n = 0; const t = setInterval(() => { if (attach() || ++n > 40) clearInterval(t); }, 250); }

  setInterval(() => { try { ws.cells().forEach((c) => noteFor(c, String(c.timeframe || ''))); } catch (e) {} }, 3000);
  setTimeout(guardCells, 1500);
  const api = { open: () => setOpen(true), close: () => setOpen(false), favs: () => favs.slice(), custom: () => custom.slice(), collapsed: () => collapsed.slice(), toggleFav, addCustom, removeCustom, openCustom, openQuick, setPrefs, apply, known };
  window.__stkIntervals = api;
  try { cloudPush = startCloudSync(api); } catch (e) { console.warn('Stryker: interval prefs sync', e); }
  return api;
}
