// TradeZoro — "Dark Pool Prints" chart indicator (native overlay on the price pane, free for everyone) + the "Dark pool" list panel. ES module.
// Owner order 2026-11-07 ("Want this on tz"). Data check: stryker-notes/reports/workers/darkpool.md.
//
// DATA (real, per trade): the server feeder (workers/book-recorder/dp-feeder/dp_feeder.py) reads every SIP trade of the session and keeps
// the trades reported to a FINRA facility (TRF / ADF, i.e. done off the exchanges) worth >= $1M. One gzip JSON part per symbol:
// book-recorder GET /scan?part=dp_<ticker> -> { v, t (epoch s of the feeder run), sym, min, days, cols:[t,p,s,c], rows:[[t ms, price, shares, conditions]] }.
// Last 5 New York sessions, 29 US stocks / ETFs (DP_SYMS). The feeder runs every 2 hours on weekdays, so the copy says "updated X min ago".
// WHAT IS DRAWN: each print at its exact time and price, a dot sized by its $ value; $10M+ prints filled and highlighted; labels "$40M"
// where there is room (biggest first). Size filter: $1M / $5M / $10M / $25M (default $1M). Bar replay: hidden (would show the future).
// Conditions are kept: average-price, derivatively priced, contingent, prior-reference and out-of-sequence prints are not at the
// market price of that moment, and the card says so.
// Free for everyone, signed-out visitors included (Owner 2026-11-07). No plan gate, no lock card.
// Wording: never live / real-time / delayed; no vendor names. Education only. Not financial advice.
// Depends on: Vela plugin SDK via the legend-row Core (registerNativeIndicator, registerRendererLayer, registerStatePersistence),
// chart-watchlist.js (.stkw-rail, .stkchart-panel.stkw-host), style.css tokens (--ink-*, --line-soft, --bg-2).


import { FUT_ETF, futRoot, loadMapped } from './chart-darkpool-map.js?v=985';
import { contextOf, detailRows, levels, printType, sideText, SIDE_NOTE } from './chart-darkpool-detail.js?v=985';

export const DP_TYPE = 'stk_darkpool';
export const DP_DESC = 'Large off-exchange stock trades (dark pool prints) drawn at their exact price and time, sized by $ value; $10M+ highlighted. Size filter $1M to $25M. 29 US stocks and ETFs, updated every 2 hours. On ES, NQ, YM and RTY charts: the SPY, QQQ, DIA and IWM prints at the futures price';
export const DP_SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD', 'JPM', 'V', 'WMT', 'XOM', 'LLY',
  'BAC', 'DIS', 'COST', 'INTC', 'PLTR', 'BA', 'COIN', 'MSTR', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'TQQQ'];
export const SIZES = ['$1M', '$5M', '$10M', '$25M'];
export const BIG = 10e6;
export const LEVEL_SIZES = ['$10M', '$25M', '$50M', '$100M'];
const SCHEMA = [
  { key: 'minSize', title: 'Minimum print size', type: 'string', defval: '$1M', options: SIZES },
  { key: 'labels', title: 'Show $ labels', type: 'bool', defval: true },
  { key: 'futEtf', title: 'On futures (ES, NQ, YM, RTY): show the matching ETF prints', type: 'bool', defval: true },
  { key: 'offPrice', title: 'Show average-price / contingent prints', type: 'bool', defval: false },
  // DP-DETAIL: repeated prints at one price that day adding up to the size below -> a dashed line labelled with the total
  { key: 'levels', title: 'Show levels (repeated prints at one price)', type: 'bool', defval: true },
  { key: 'levelMin', title: 'Level minimum total', type: 'string', defval: '$25M', options: LEVEL_SIZES, when: { key: 'levels', equals: true } },
  { key: 'color', title: 'Prints colour', type: 'color', defval: '#00adb5' },
  { key: 'bigColor', title: '$10M+ colour', type: 'color', defval: '#03c988' },
  // Alerts (server-side, assets/chart-dp-alerts.js): students/{uid}/dpAlerts doc 'ind-<SYM>', checked by the alert engine with the chart closed
  { key: 'alertOn', title: 'Alert me on new prints', type: 'bool', defval: false, group: 'Alerts' },
  { key: 'alertMin', title: 'Alert minimum (Filter = size above)', type: 'string', defval: 'Filter', options: ['Filter'].concat(SIZES, ['Custom']), group: 'Alerts', when: { key: 'alertOn', equals: true } },
  { key: 'alertCustom', title: 'Custom size, $ millions', type: 'float', defval: 50, min: 1, max: 100000, step: 1, group: 'Alerts', when: [{ key: 'alertOn', equals: true }, { key: 'alertMin', equals: 'Custom' }] },
  { key: 'alertZone', title: 'Only prints inside a price zone', type: 'bool', defval: false, group: 'Alerts', when: { key: 'alertOn', equals: true } },
  { key: 'alertLo', title: 'Zone from', type: 'float', defval: 0, min: 0, max: 1000000, step: 0.01, group: 'Alerts', inline: 'zone', when: [{ key: 'alertOn', equals: true }, { key: 'alertZone', equals: true }] },
  { key: 'alertHi', title: 'to', type: 'float', defval: 0, min: 0, max: 1000000, step: 0.01, group: 'Alerts', inline: 'zone', when: [{ key: 'alertOn', equals: true }, { key: 'alertZone', equals: true }] },
  { key: 'alertOnce', title: 'Only once, then turn the alert off', type: 'bool', defval: false, group: 'Alerts', when: { key: 'alertOn', equals: true } }
];
const RECORDER = () => (typeof window !== 'undefined' && window.__STK_BOOK_RECORDER) || 'https://book-recorder.theelitegrey.workers.dev';
const MAX_AGE_MS = 5 * 60 * 1000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- pure (tools/tests/chart-darkpool.test.mjs) -------------------------------------------------------
// chart symbol ('stocks:AMEX:SPY', 'IDX:SPY', 'spy', 'futures:ES1!', 'BTCUSDT') -> covered ticker or ''
export function tickerOf(symbol) {
  const t = String(symbol || '').split(':').pop().toUpperCase().replace(/\s+/g, '');
  return DP_SYMS.includes(t) ? t : '';
}
// Could this symbol be a US stock / ETF at all? (for the note: "not covered yet" vs "stocks only")
export function looksStock(symbol) {
  const s = String(symbol || '');
  if (/^(futures|crypto|forex|fx|binance|coinbase|bybit|okx|kraken|hyperliquid)[:_]/i.test(s) || /\d!$/.test(s) || /(USDT|USDC|USD|BTC|ETH|PERP)$/i.test(s.split(':').pop()) || /=X$/i.test(s)) return false;
  return /^[A-Z][A-Z.\-]{0,5}$/.test(s.split(':').pop().toUpperCase());
}
export const sizeUsd = (label) => { const m = /^\$(\d+)M$/.exec(String(label || '')); return m ? +m[1] * 1e6 : 1e6; };
// $ value -> '$1.2M' / '$40M' / '$1.1B'
export function usd(v) {
  if (!isNum(v)) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
  if (v >= 1e6) return '$' + (v >= 1e7 ? Math.round(v / 1e6) : (v / 1e6).toFixed(1).replace(/\.0$/, '')) + 'M';
  return '$' + Math.round(v / 1e3) + 'K';
}
// part -> prints [{ t, p, s, v, c, big, d (estimated side, '' on old parts), k (day context, chart-darkpool-detail.js) }] at or above minUsd, time order
// marketOnly: drop prints whose price is not the market price of that moment (average-price, contingent, derivative, prior reference,
// late): e.g. on SPY 2026-11-06 one contingent trade was reported 24 times at 733.13, far from the market, which would draw a false level.
export function prints(part, minUsd, marketOnly) {
  const rows = part && Array.isArray(part.rows) ? part.rows : [];
  const out = [], ctx = contextOf(part);
  rows.forEach((r, i) => {
    if (!Array.isArray(r) || !isNum(r[0]) || !isNum(r[1]) || !isNum(r[2])) return;
    const v = r[1] * r[2], c = String(r[3] || '');
    if (v >= (minUsd || 0) && !(marketOnly && condNote(c).off.length)) out.push({ t: r[0], p: r[1], s: r[2], v, c, big: v >= BIG, d: typeof r[4] === 'string' ? r[4] : '', k: ctx[i] });
  });
  return out.sort((a, b) => a.t - b.t);
}
// bar length in ms from the bars themselves (smallest gap among the first 60)
export function barMs(bars) {
  let ms = Infinity;
  for (let i = 1; i < Math.min(bars.length, 60); i++) { const d = bars[i].time - bars[i - 1].time; if (d > 0 && d < ms) ms = d; }
  return Number.isFinite(ms) ? ms : 0;
}
// index of the bar that holds time t, or -1 (a print in a gap, e.g. extended hours on a regular-hours chart, belongs to no bar)
export function barIndex(bars, t, ms) {
  let lo = 0, hi = bars.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  return i >= 0 && t < bars[i].time + ms ? i : -1;
}
// prints -> per bar groups [{ i, list:[print], v (sum) }] for the bars in [from, to]; used for the "N prints in this bar" card
export function groupByBar(list, bars, ms, from = 0, to = bars.length - 1) {
  const map = new Map();
  for (const x of list) {
    const i = barIndex(bars, x.t, ms);
    if (i < from || i > to || i < 0) continue;
    const g = map.get(i) || { i, list: [], v: 0 };
    g.list.push(x); g.v += x.v; map.set(i, g);
  }
  return [...map.values()].sort((a, b) => a.i - b.i);
}
// dot radius: sqrt of value against the biggest in view, 3..rMax
export const radius = (v, max, rMax = 9) => 3 + (rMax - 3) * Math.sqrt(Math.max(0, v) / Math.max(1, max));
// conditions that mean the price is not the market price of that moment
const OFF_PRICE = { B: 'average price', W: 'average price', 4: 'derivatively priced', 7: 'contingent trade', V: 'contingent trade', P: 'prior reference price', Z: 'reported out of sequence', U: 'reported out of sequence', C: 'cash trade' };
export function condNote(c) {
  const out = [];
  for (const k of String(c || '')) if (OFF_PRICE[k] && !out.includes(OFF_PRICE[k])) out.push(OFF_PRICE[k]);
  const ext = /[TU]/.test(c || '');
  return { ext, off: out };
}
const fmtTime = (t) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(t)) + ' ET'; } catch (e) { return new Date(t).toISOString().slice(11, 19) + ' UTC'; } };
const fmtDay = (t) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t)); } catch (e) { return ''; } };
export function agoText(tsSec, nowMs) {
  if (!isNum(tsSec)) return '';
  const m = Math.max(0, Math.floor(((nowMs || Date.now()) / 1000 - tsSec) / 60));
  if (m < 1) return 'Updated just now';
  if (m < 60) return 'Updated ' + m + ' min ago';
  if (m < 48 * 60) return 'Updated ' + Math.floor(m / 60) + ' h ago';
  return 'Updated ' + Math.floor(m / 1440) + ' days ago';
}
export function tipRows(x) {
  const n = condNote(x.c);
  const f2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const px = x.fut ? ['', x.etf + ' ' + f2(x.ep) + ' · at ' + x.fut + ' ≈ ' + f2(x.p)] : ['Price', x.p.toLocaleString('en-US', { maximumFractionDigits: 4 })];
  const rows = [['Time', fmtDay(x.t) + ', ' + fmtTime(x.t)], px, ['Shares', x.s.toLocaleString('en-US')]];
  // DP-DETAIL: estimated side + type of print up top (value is in the title); day context below. Old parts: no side line.
  const side = sideText(x.d);
  return { title: (x.fut ? x.etf + ' ' : '') + (x.big ? (x.fut ? 'block print' : 'Block print') : (x.fut ? 'dark pool print' : 'Dark pool print')) + ' · ' + usd(x.v), rows,
    side, sideKey: x.d || '', type: printType(x.c, x.t, x.big), more: detailRows(x),
    note: 'One trade reported off the exchanges.' + (x.fut ? ' Shown at the ' + x.fut + ' price of that minute.' : '') + (n.off.length ? ' Its price may differ from the market price at that time.' : ''),
    sideNote: side ? SIDE_NOTE : '' };
}

// ---- data ---------------------------------------------------------------------------------------
const cache = new Map();   // ticker -> { at, part, err, p }
const subs = new Set();
async function fetchPart(sym) {
  const r = await fetch(RECORDER() + '/scan?part=dp_' + sym.toLowerCase(), { credentials: 'omit' });
  if (r.status === 404) return { rows: [], t: null, empty: true };
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (r.headers.get('x-scan-gzip') === '1' && typeof DecompressionStream === 'function') return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
  return r.json();
}
export function load(sym) {
  if (!sym) return Promise.resolve(null);
  const e = cache.get(sym);
  if (e && (e.p || Date.now() - e.at < MAX_AGE_MS)) return e.p || Promise.resolve(e.part);
  const n = { at: Date.now(), part: e && e.part, err: '', p: null };
  n.p = fetchPart(sym).then((j) => { n.part = j; n.err = ''; return j; }, () => { n.err = 'unavailable'; n.at = Date.now() - MAX_AGE_MS + 60000; return n.part; })
    .then((j) => { n.p = null; subs.forEach((f) => { try { f(sym); } catch (x) {} }); return j; });
  cache.set(sym, n);
  return n.p;
}
export const cached = (sym) => cache.get(sym) || null;
export const _setPart = (sym, j) => { cache.set(sym, { at: Date.now() + 1e12, part: j, err: '', p: null }); subs.forEach((f) => { try { f(sym); } catch (x) {} }); };   // test hook
// FUTURES: ES/MES -> SPY prints, NQ/MNQ -> QQQ, YM/MYM -> DIA, RTY/M2K -> IWM, each moved onto the futures price (assets/chart-darkpool-map.js).
// Returns { list, skipped } once the 1-minute bars are in, else null (and notifies the ETF's subscribers when done).
const mapped = new Map();   // root|part time|rows -> { res, p }
export function mappedFor(root, part) {
  const etf = FUT_ETF[root], k = root + '|' + (part.t || 0) + '|' + (part.rows || []).length;
  let m = mapped.get(k);
  if (!m) {
    m = { res: null }; if (mapped.size > 8) mapped.clear(); mapped.set(k, m);
    const done = (r) => { m.res = r; subs.forEach((f) => { try { f(etf); } catch (x) {} }); };
    loadMapped(root, prints(part, 0)).then((r) => done({ skipped: r.skipped, list: r.list.map((x) => Object.assign(x, { fut: root, etf })) }), () => done({ list: [], skipped: 0, err: true }));
  }
  return m.res;
}
// chart symbol -> the ETF whose prints it shows ('' = none): a covered stock / ETF itself, or the ETF matching a futures root
export const targetOf = (raw) => tickerOf(raw) || FUT_ETF[futRoot(raw)] || '';
const onData = (f) => { subs.add(f); return () => subs.delete(f); };

// ---- native + layer ------------------------------------------------------------------------------
const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
const hits = new WeakMap();
// ---- alerts glue (the module loads on demand: assets/chart-dp-alerts.js) ----
let WSREF = null, alertsP = null;
const alertsMod = () => alertsP || (alertsP = import('./chart-dp-alerts.js?v=985').catch((e) => { console.warn('TradeZoro: dark pool alerts', e); return new Promise(() => {}); }));
const chartKeys = new WeakMap(); let chartN = 0;
const chartKey = (c) => { if (!chartKeys.has(c)) chartKeys.set(c, ++chartN); return chartKeys.get(c); };
const stopped = new Set();   // instances stopped in the last seconds: Vela stops an instance BEFORE it fires 'indicator:removed'
// which chart (cell) owns this instance: the one whose indicator list has our id
function chartOf(inst) {
  if (inst.chart) return inst.chart;
  try { for (const c of WSREF.context().cells || []) { const ch = WSREF.cell(c.id).chart; if (ch.indicators().some((h) => h.nativeType === DP_TYPE && h.id === inst.id)) return (inst.chart = ch); } } catch (e) {}
  return null;
}
const hooked = new WeakSet();
function hookRemovals(ws) {
  const apply = () => (ws.context().cells || []).forEach((c) => {
    let ch = null; try { ch = ws.cell(c.id).chart; } catch (e) {}
    if (!ch || hooked.has(ch)) return; hooked.add(ch);
    ch.on('indicator:removed', (e) => {
      const id = e && e.id;
      for (const i of [...stopped, ...(i0 ? [...i0.instances] : [])]) if (i.id === id && i.chart === ch) { if (i0) i0.dropForIndicator(i.key, i.sym()); stopped.delete(i); }
    });
  });
  apply();
  try { ws.on('layout:changed', () => setTimeout(apply, 0)); ws.on('state:changed', apply); } catch (e) {}
}
let i0 = null;
let focusT = 0;   // a print picked in the list: ringed on the chart for a few seconds

class DpNative {
  constructor() { this.ctx = null; this.inputs = {}; this.sig = ''; this.timer = 0; this.off = null; }
  defaults() { return Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])); }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); this.id = ctx.id; this.chart = null;
    this.off = onData(() => this.refresh());
    alertsMod().then((m) => { if (this.dead) return; i0 = m; this.A = m; this.chart = chartOf(this); this.key = this.id + '@' + (this.chart ? chartKey(this.chart) : '?'); m.instances.add(this); this.syncAlert(true); });
    this.load();
    this.timer = setInterval(() => { if (!document.hidden) this.load(); }, 60000);
  }
  fut() { const r = this.ctx ? futRoot(this.ctx.symbol) : ''; return r && !tickerOf(this.ctx.symbol) && this.inputs.futEtf !== false ? r : ''; }
  sym() { return this.ctx ? (tickerOf(this.ctx.symbol) || FUT_ETF[this.fut()] || '') : ''; }
  load() { const s = this.sym(); if (s && !replayOn()) load(s); this.refresh(); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.refresh(); }
  onViewport() {}
  setInputs(i) { const was = this.alertSig(); this.inputs = Object.assign(this.defaults(), i); this.sig = ''; this.refresh(); if (this.alertSig() !== was) this.syncAlert(); }
  // ---- alert (one doc per indicator instance, id 'ind-<SYM>') ----
  alertSpec() {
    const I = this.inputs, A = this.A;
    return { key: this.key, symbol: this.sym(), on: !!I.alertOn, min: A ? A.effMin(sizeUsd(I.minSize), I.alertMin, I.alertCustom) : 1e6, freq: I.alertOnce === true ? 'once' : 'every',
      zone: I.alertZone === true, lo: Number(I.alertLo) || NaN, hi: Number(I.alertHi) || NaN };
  }
  alertSig() { const s = this.alertSpec(); return JSON.stringify([s.symbol, s.on, s.min, s.freq, s.zone, s.lo, s.hi]); }
  syncAlert(first) {
    if (!this.A) return; clearTimeout(this.at);
    const s = this.alertSpec();
    if (first && !s.on) return;   // loading a chart with the alert off writes nothing
    if (s.on && s.zone && !(s.lo > 0 && s.hi > 0)) return;   // half-filled zone: wait
    this.at = setTimeout(() => { this.A.syncAlert(s).then((r) => { if (r === 'signin' && s.on) { /* the note in the settings shows Sign in */ } }); }, first ? 0 : 700);
  }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() {
    clearInterval(this.timer); clearTimeout(this.at); if (this.off) this.off(); try { this.ctx.pushData(null); } catch (e) {}
    this.dead = true;
    // removing the indicator removes its alert (the 'indicator:removed' hook, hookRemovals); a symbol switch or layout rebuild stops instances too and keeps it
    if (this.A) { this.A.instances.delete(this); stopped.add(this); setTimeout(() => stopped.delete(this), 5000); }
  }
  push(p) {
    const sig = JSON.stringify(p && p.list ? { n: p.list.length, f: p.fut, b: p.bars, I: p.I, t: p.t, f: p.focus } : p);
    if (sig === this.sig) return; this.sig = sig;
    try { this.ctx.pushData(p); } catch (e) {}
  }
  refresh() {
    if (!this.ctx) return;
    const sym = this.sym(), raw = this.ctx.symbol;
    if (!sym && futRoot(raw) && !tickerOf(raw)) return this.push({ note: 'Dark pool prints: futures option is off (Settings)' });
    if (!sym) return this.push({ note: looksStock(raw) ? 'Dark pool prints: not covered for this symbol yet (SPY, QQQ, IWM, AAPL, NVDA and 24 more)' : 'Dark pool prints: US stocks and ETFs only' });
    if (replayOn()) return this.push({ note: 'Dark pool prints: hidden in replay' });
    const e = cached(sym);
    if (!e || (!e.part && !e.err)) return this.push({ note: 'Loading dark pool prints…' });
    if (!e.part) return this.push({ note: 'Dark pool prints are not available right now' });
    const bars = this.ctx.bars() || [];
    const fut = this.fut();
    if (fut) {
      const m = mappedFor(fut, e.part);
      if (!m) return this.push({ note: 'Loading dark pool prints…' });
      if (m.err || (!m.list.length && m.skipped)) return this.push({ note: 'Dark pool prints: no ' + fut + ' prices to place them on right now' });
    }
    const all = fut ? mappedFor(fut, e.part).list.filter((x) => x.v >= sizeUsd(this.inputs.minSize)) : prints(e.part, sizeUsd(this.inputs.minSize));
    const list = this.inputs.offPrice ? all : all.filter((x) => !condNote(x.c).off.length || x.t === focusT);
    try { window.__stkDarkpool = { sym, fut, skipped: fut ? (mappedFor(fut, e.part) || {}).skipped : 0, n: all.length, big: all.filter((x) => x.big).length, drawn: list.length, min: sizeUsd(this.inputs.minSize) }; } catch (x) {}
    const lv = this.inputs.levels !== false ? levels(list, sizeUsd(this.inputs.levelMin || '$25M')) : [];
    this.push({ list, lv, sym, fut, t: e.part.t, I: this.inputs, bars: bars.length ? bars[0].time + '|' + bars[bars.length - 1].time + '|' + bars.length : '', ago: agoText(e.part.t), focus: focusT });
  }
}

function layer() {
  let canvas = null, chip = null, chipKey = '';
  function setChip(text, parent) {
    if (text === chipKey) return;
    chipKey = text;
    if (!text) { if (chip) chip.hidden = true; return; }
    if (!chip) { chip = document.createElement('div'); chip.className = 'stk-dp-chip'; parent.appendChild(chip); }
    chip.hidden = false; chip.textContent = text;
  }
  return {
    mount(c) { canvas = c; c.dataset.stkDp = '1'; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d'), co = a.coords, dpr = co.dpr || 1, d = a.data;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const boxes = []; hits.set(canvas, boxes);
      if (!d) return setChip('', canvas.parentElement);
      if (d.note) return setChip(d.note, canvas.parentElement);
      const bars = a.bars, I = d.I, day = light(), W = co.width, ms = barMs(bars);
      let v0 = 0, v1 = bars.length - 1;
      try { const vr = co.visibleLogicalRange(); v0 = Math.max(0, Math.floor(vr.from)); v1 = Math.min(bars.length - 1, Math.ceil(vr.to)); } catch (e) {}
      const groups = groupByBar(d.list, bars, ms, v0, v1);
      const vis = []; groups.forEach((gr) => gr.list.forEach((x) => vis.push({ x, i: gr.i })));
      setChip(vis.length ? d.sym + ': ' + vis.length + ' dark pool print' + (vis.length === 1 ? '' : 's') + ' ≥ ' + I.minSize + (d.fut ? ', shown at ' + d.fut + ' price' : '') + ' · ' + d.ago : 'No dark pool prints ≥ ' + I.minSize + ' in view · ' + d.ago, canvas.parentElement);
      const top = a.bounds.top, bot = top + a.bounds.height, max = vis.reduce((m, o) => Math.max(m, o.x.v), 1), rMax = W < 520 ? 7 : 9;
      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      // levels (repeated prints at one price): dashed line from the first print to the right edge, total at the right; under the dots
      const lvBoxes = [];   // level labels: dot labels keep clear of them
      if (d.lv && d.lv.length && vis.length) {
        const tA = bars[v0].time, tB = bars[v1].time + ms, lt = [];
        g.font = '500 11px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif'; g.textBaseline = 'middle';
        for (const L of d.lv) {
          if (L.t0 >= tB || lt.length >= (W < 520 ? 4 : 8)) continue;
          const y = co.priceToY(L.p, a.scale, a.bounds); if (!Number.isFinite(y) || y < top || y > bot) continue;
          const i0 = L.t0 < tA ? -1 : barIndex(bars, L.t0, ms), x0 = i0 < 0 ? 0 : Math.max(0, co.timeToX(bars[i0].time));
          const txt = usd(L.v) + ' · ' + L.n + ' prints', w = g.measureText(txt).width + 8, lx = W - w - 4;
          g.globalAlpha = 0.7; g.setLineDash([4, 4]); g.lineWidth = 1; g.strokeStyle = I.bigColor;
          g.beginPath(); g.moveTo(x0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
          if (lt.some((b) => Math.abs(b - y) < 16)) continue;
          lt.push(y); lvBoxes.push({ x: lx, y: y - 8, w, h: 16, txt });
        }
      }
      // small first so big prints sit on top
      vis.sort((p, q) => p.x.v - q.x.v);
      const placed = [];
      for (const o of vis) {
        const bar = bars[o.i], x = co.timeToX(bar.time), y = co.priceToY(o.x.p, a.scale, a.bounds);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < -20 || x > W + 20 || y < top - 20 || y > bot + 20) continue;
        const r = radius(o.x.v, max, rMax), col = o.x.big ? I.bigColor : I.color;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        g.globalAlpha = o.x.big ? 0.85 : 0.3; g.fillStyle = col; g.fill();
        g.globalAlpha = 1; g.lineWidth = o.x.big ? 1.5 : 1; g.strokeStyle = o.x.big ? (day ? '#0b0b0d' : '#ffffff') : col; g.stroke();
        if (d.focus && o.x.t === d.focus) { g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = day ? '#1d1d1f' : '#ffffff'; g.stroke(); }
        boxes.push({ x, y, r: Math.max(r, 10), p: o.x });
        placed.push({ x, y, r, o });
      }
      if (I.labels !== false) {
        g.font = '600 11px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif'; g.textBaseline = 'middle';
        const taken = lvBoxes.slice(), nLv = taken.length;
        placed.sort((p, q) => q.o.x.v - p.o.x.v);
        for (const pl of placed) {
          const txt = (d.fut ? d.sym + ' ' : '') + usd(pl.o.x.v), w = g.measureText(txt).width + 8, h = 16, lx = pl.x + pl.r + 4, ly = pl.y - h / 2;
          if (lx + w > W - 2) continue;
          if (taken.some((b) => lx < b.x + b.w && lx + w > b.x && ly < b.y + b.h && ly + h > b.y)) continue;
          // labels: every $10M+ that fits; smaller ones only while there is room (fewer on a phone)
          if (!pl.o.x.big && taken.length - nLv >= (W < 520 ? 6 : 24)) continue;
          taken.push({ x: lx, y: ly, w, h });
          g.globalAlpha = 0.92; g.fillStyle = day ? '#ffffff' : '#131316'; g.beginPath();
          if (g.roundRect) g.roundRect(lx, ly, w, h, 4); else g.rect(lx, ly, w, h);
          g.fill(); g.globalAlpha = 1;
          g.lineWidth = 1; g.strokeStyle = pl.o.x.big ? I.bigColor : (day ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.08)'); g.stroke();
          g.fillStyle = pl.o.x.big ? (day ? '#047857' : I.bigColor) : (day ? '#1d1d1f' : 'rgba(255,255,255,.92)');
          g.fillText(txt, lx + 4, pl.y + 0.5);
        }
      }
      // level labels last, on top of the dots
      g.font = '500 11px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif'; g.textBaseline = 'middle';
      for (const b of lvBoxes) {
        g.globalAlpha = 0.96; g.fillStyle = day ? '#ffffff' : '#131316'; g.beginPath();
        if (g.roundRect) g.roundRect(b.x, b.y, b.w, b.h, 4); else g.rect(b.x, b.y, b.w, b.h);
        g.fill(); g.globalAlpha = 1; g.lineWidth = 1; g.strokeStyle = I.bigColor; g.stroke();
        g.fillStyle = day ? '#047857' : I.bigColor; g.fillText(b.txt, b.x + 4, b.y + 8.5);
      }
      g.restore();
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
  };
}

// ---- hover (mouse) and tap (touch) card ------------------------------------------------------------
let tip = null, pinned = false;
function find(e) {
  for (const cv of document.querySelectorAll('canvas[data-stk-dp]')) {
    const bx = hits.get(cv); if (!bx || !bx.length) continue;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    let best = null, bd = 1e9;
    for (const b of bx) { const dd = Math.hypot(b.x - x, b.y - y); if (dd <= b.r && (dd < bd || (dd === bd && b.p.v > best.b.p.v))) { best = { b, r }; bd = dd; } }
    if (best) return best;
  }
  return null;
}
function show(h) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'stk-dp-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  const t = tipRows(h.b.p);
  tip.textContent = '';
  const head = document.createElement('div'); head.className = 'stk-dp-h';
  const dot = document.createElement('i'); dot.className = h.b.p.big ? 'big' : '';
  head.append(dot, t.title); tip.appendChild(head);
  tip.appendChild(sideLine(t));
  const addRows = (list) => list.forEach(([k, v]) => { const r = document.createElement('div'); r.className = 'stk-dp-r' + (k ? '' : ' full'); const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; if (k) r.append(a, b); else r.append(b); tip.appendChild(r); });
  addRows(t.rows);
  if (t.more.length) { const hr = document.createElement('div'); hr.className = 'stk-dp-hr'; tip.appendChild(hr); addRows(t.more); }
  const n = document.createElement('div'); n.className = 'stk-dp-n'; n.textContent = t.note; tip.appendChild(n);
  if (t.sideNote) { const sn = document.createElement('div'); sn.className = 'stk-dp-n stk-dp-sn'; sn.innerHTML = IC_INFO; sn.append(t.sideNote); tip.appendChild(sn); }
  tip.hidden = false;
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, h.r.left + h.b.x - tip.offsetWidth / 2));
  let tp = h.r.top + h.b.y - tip.offsetHeight - h.b.r - 8; if (tp < 8) tp = h.r.top + h.b.y + h.b.r + 8;
  tip.style.left = left + 'px'; tip.style.top = tp + 'px';
}
const IC_INFO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
// "Likely buy (i) · Regular block": the estimated side (a word, colour only as a second cue) and the type of print
function sideLine(t) {
  const l = document.createElement('div'); l.className = 'stk-dp-side';
  if (t.side) { const b = document.createElement('b'); b.className = 'stk-dp-sd ' + (t.sideKey === 'b' || t.sideKey === 's' ? t.sideKey : 'u'); b.textContent = t.side; b.title = SIDE_NOTE; const i = document.createElement('i'); i.className = 'stk-dp-i'; i.innerHTML = IC_INFO; b.appendChild(i); l.appendChild(b); }
  const ty = document.createElement('span'); ty.textContent = (t.side ? ' · ' : '') + t.type; l.appendChild(ty);
  return l;
}
function onMove(e) { if (e.pointerType === 'touch' || pinned) return; const h = find(e); if (!h) { if (tip) tip.hidden = true; return; } show(h); }
function onDown(e) { const h = find(e); if (!h) { pinned = false; if (tip) tip.hidden = true; return; } pinned = e.pointerType === 'touch'; show(h); }

// list row second line: { side, cls, text } e.g. 'Likely buy' · 'Regular block · 3.2× typical · level $81M'
export function listLine(x) {
  const side = sideText(x.d), k = x.k || {}, bits = [printType(x.c, x.t, x.big).replace(/ \([^)]*\)/g, '')];   // the card spells out the brackets
  if (k.typ >= 2) bits.push((k.typ < 10 ? k.typ.toFixed(1) : Math.round(k.typ)) + '× typical');
  if (k.lvl) bits.push('level ' + usd(k.lvl.v));
  return { side, cls: x.d === 'b' || x.d === 's' ? x.d : 'u', text: bits.join(' · ') };
}
// ---- "Dark pool" list panel (right icon bar; phones: a sheet) ----------------------------------------
const IC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="15" r="3"/><circle cx="16" cy="8" r="4"/><circle cx="18" cy="18" r="2"/></svg>';
const IC_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const IC_BELL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const LS_PANEL = 'stkdkp.v1';
export function mountDarkPoolPanel(ws) {
  if (!ws || document.getElementById('stkdkp')) return null;
  WSREF = ws; hookRemovals(ws);
  import('./chart-dp-alerts.js?v=985').then((m) => { i0 = m; m.installDialogNote(ws); m.onChange(() => { try { render(); } catch (e) {} }); }).catch(() => {});
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= 700;
  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return ''; } };
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(LS_PANEL)) || {}; } catch (e) {}
  let open = false, minSize = SIZES.includes(saved.min) ? saved.min : '$1M';
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const railBtn = el('button', 'stkw-railbtn stkdkp-railbtn', IC); railBtn.type = 'button'; railBtn.title = 'Dark pool prints'; railBtn.setAttribute('aria-label', 'Dark pool prints'); railBtn.setAttribute('aria-pressed', 'false');
  const phoneBtn = el('button', 'stkc-btn stkdkp-phonebtn', IC.replace(/18/g, '16') + '<span class="stkc-btn-l">Dark pool</span>'); phoneBtn.type = 'button'; phoneBtn.setAttribute('aria-label', 'Dark pool prints');
  const panel = el('aside', 'stkdkp'); panel.id = 'stkdkp'; panel.hidden = true; panel.setAttribute('aria-label', 'Dark pool prints');
  panel.innerHTML = '<div class="stkdkp-grab" aria-hidden="true"></div><div class="stkdkp-hd"><span class="stkdkp-title">Dark pool</span><span class="stkdkp-sp"></span><button type="button" class="stkdkp-alert" hidden>' + IC_BELL + '<span>Alert me</span></button><button type="button" class="stkw-ib stkdkp-x" aria-label="Close dark pool prints">' + IC_X + '</button></div>' +
    '<div class="stkdkp-seg" role="group" aria-label="Minimum print size">' + SIZES.map((s) => '<button type="button" data-m="' + s + '" aria-pressed="false">' + s + '+</button>').join('') + '</div>' +
    '<div class="stkdkp-sub" hidden></div><div class="stkdkp-stat" aria-live="polite"></div><div class="stkdkp-cols" role="row"><span>Time</span><span>Price</span><span>Shares</span><span>Value</span></div><div class="stkdkp-list" role="table" aria-label="Dark pool prints"></div>' +
    '<p class="stkdkp-foot">Large trades reported off the exchanges, one row per trade. Education only. Not financial advice.</p>';
  host.appendChild(panel);
  const $ = (s) => panel.querySelector(s), list = $('.stkdkp-list'), stat = $('.stkdkp-stat'), sub = $('.stkdkp-sub'), cols = $('.stkdkp-cols'), seg = $('.stkdkp-seg');
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (barR) { const nb = barR.querySelector('.stkin-phonebtn') || barR.querySelector('.stknw-phonebtn') || barR.querySelector('.stkw-phonebtn'); barR.insertBefore(phoneBtn, nb ? nb.nextSibling : barR.firstChild); }
  function placeRail() {
    const rail = document.querySelector('.stkw-rail'); if (!rail) return false;
    if (railBtn.parentNode !== rail) { const after = rail.querySelector('.stkin-railbtn') || rail.querySelector('.stknw-railbtn') || rail.querySelector('.stkw-railbtn'); rail.insertBefore(railBtn, after ? after.nextSibling : rail.firstChild); }
    return true;
  }
  if (!placeRail()) { const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); }); mo.observe(host, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 30000); }
  const note = (text) => { list.textContent = ''; cols.hidden = true; const p = el('p', 'stkdkp-note'); p.textContent = text; list.appendChild(p); };
  function jump(x) {
    try {
      const chart = ws.active.chart, r = chart.getVisibleRange();
      const span = r && r.to > r.from ? r.to - r.from : 6 * 3600e3;
      chart.setVisibleRange({ from: x.t - span / 2, to: x.t + span / 2 });
    } catch (e) {}
    focusT = x.t;
    try { (ws.active.chart.indicators() || []).forEach((h) => { if (h.nativeType === DP_TYPE) h.setInputs(h.inputValues()); }); } catch (e) {}
    setTimeout(() => { if (focusT === x.t) { focusT = 0; try { (ws.active.chart.indicators() || []).forEach((h) => { if (h.nativeType === DP_TYPE) h.setInputs(h.inputValues()); }); } catch (e) {} } }, 6000);
    if (isPhone()) setOpen(false);
  }
  function render() {
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === minSize)));
    const raw = activeSym(), sym = targetOf(raw), fu = tickerOf(raw) ? '' : futRoot(raw);
    sub.hidden = !fu; sub.textContent = fu ? sym + ' prints, shown at ' + fu + ' price' : '';
    cols.children[1].textContent = fu ? fu + ' price' : 'Price';
    $('.stkdkp-title').textContent = 'Dark pool' + (sym ? ' · ' + sym : '');
    stat.textContent = '';
    seg.hidden = !sym;
    alertState(sym);
    if (!sym) return note(looksStock(raw) ? 'Dark pool prints are not covered for this symbol yet. Covered: ' + DP_SYMS.join(', ') + '.' : 'Dark pool prints are for US stocks and ETFs. Open SPY, QQQ, AAPL or another covered stock to see them.');
    const e = cached(sym);
    if (!e || (!e.part && !e.err)) { load(sym); return note('Loading…'); }
    if (!e.part) return note('Dark pool prints are temporarily unavailable. Try again in a minute.');
    let all = prints(e.part, sizeUsd(minSize)).reverse(), notPlaced = 0;
    if (fu) {
      const m = mappedFor(fu, e.part);
      if (!m) return note('Loading…');
      if (m.err || (!m.list.length && m.skipped)) return note('No ' + fu + ' prices to place the prints on right now. Try again in a minute.');
      const placed = m.list.filter((x) => x.v >= sizeUsd(minSize)).reverse(); notPlaced = all.length - placed.length; all = placed;
    }
    const nd = (e.part.days || []).length;
    stat.textContent = all.length + ' print' + (all.length === 1 ? '' : 's') + ' ≥ ' + minSize + ', ' + (nd > 1 ? 'last ' + nd + ' sessions' : 'last session') + ' · ' + agoText(e.part.t) + (notPlaced ? ' · ' + notPlaced + ' not placed (no ' + fu + ' price within 5 min)' : '');
    if (!all.length) return note('No dark pool prints of ' + minSize + ' or more in the stored sessions.');
    cols.hidden = false; list.textContent = '';
    let lastDay = '';
    const frag = document.createDocumentFragment();
    for (const x of all.slice(0, 600)) {
      const dd = fmtDay(x.t);
      if (dd !== lastDay) { lastDay = dd; const h = el('div', 'stkdkp-day'); h.textContent = dd; frag.appendChild(h); }
      const row = el('button', 'stkdkp-row' + (x.big ? ' big' : '')); row.type = 'button'; row.setAttribute('role', 'row');
      row.setAttribute('aria-label', fmtTime(x.t) + ', ' + (x.fut ? x.etf + ' ' : '') + usd(x.v) + ' at ' + x.p + ', ' + x.s + ' shares. Show on chart');
      const n = condNote(x.c);
      [fmtTime(x.t).replace(' ET', ''), x.p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), x.s.toLocaleString('en-US'), usd(x.v) + (n.off.length ? '*' : '')].forEach((v) => { const s = el('span'); s.textContent = v; row.appendChild(s); });
      // DP-DETAIL second line: estimated side · type of print · size vs typical · level
      const sub2 = listLine(x); if (sub2.text) { const s = el('span', 'stkdkp-l2'); if (sub2.side) { const b = el('b', 'stk-dp-sd ' + sub2.cls); b.textContent = sub2.side; s.appendChild(b); } s.append((sub2.side ? ' · ' : '') + sub2.text); row.appendChild(s); row.setAttribute('aria-label', row.getAttribute('aria-label').replace('. Show on chart', '. ' + (sub2.side ? sub2.side + ' (estimate), ' : '') + sub2.text + '. Show on chart')); }
      if (x.fut) row.title = x.etf + ' ' + x.ep.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' · at ' + x.fut + ' ≈ ' + x.p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (n.off.length) row.title = (row.title ? row.title + '. ' : '') + 'Price type: ' + n.off.join(', ');
      row.addEventListener('click', () => jump(x));
      frag.appendChild(row);
    }
    list.appendChild(frag);
    if (all.some((x) => condNote(x.c).off.length)) { const f = el('p', 'stkdkp-key'); f.textContent = '* average-price, contingent or late-reported trade: its price may differ from the market price at that time. Times are New York time.'; list.appendChild(f); }
    if (all.some((x) => x.d)) { const f = el('p', 'stkdkp-key'); f.textContent = 'Likely buy / sell: ' + SIDE_NOTE; list.appendChild(f); }
  }
  function closeOthers() {
    if (host.classList.contains('stkw-open')) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); }
    if (host.classList.contains('stknw-open') && window.__stkNews) window.__stkNews.close();
    if (window.__stkSymInfo && window.__stkSymInfo.isOpen) window.__stkSymInfo.close();
  }
  function setOpen(v) {
    open = !!v;
    if (open) { closeOthers(); if (tip) { tip.hidden = true; pinned = false; } }
    panel.hidden = !open;
    host.classList.toggle('stkdkp-open', open);
    document.documentElement.classList.toggle('stkdkp-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open)); railBtn.classList.toggle('on', open); phoneBtn.classList.toggle('on', open);
    if (open) render();
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  $('.stkdkp-x').addEventListener('click', () => setOpen(false));
  // Alerts live in the Dark Pool Prints indicator settings. The header shows their state; it opens that Alerts section (adds the indicator first if the chart has none).
  function alertState(sym) {
    const b = $('.stkdkp-alert'), lab = b.querySelector('span'), A = i0, a = A && sym ? A.forSymbol(sym) : null;
    b.hidden = !sym; b.classList.toggle('on', !!a);
    lab.textContent = a ? 'Alert on · ≥ ' + usd(a.min) : 'Set alert';
    b.setAttribute('aria-label', a ? sym + ' dark pool alert is on, at ' + usd(a.min) + ' or more. Open the alert settings' : 'Set a dark pool print alert on ' + sym + ' in the indicator settings');
  }
  $('.stkdkp-alert').addEventListener('click', () => { import('./chart-dp-alerts.js?v=985').then((m) => { if (m.openIndicatorAlerts(ws, true) && isPhone()) setOpen(false); }).catch((e) => console.warn('TradeZoro: dark pool alerts', e)); });
  seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (!b) return; minSize = b.dataset.m; try { localStorage.setItem(LS_PANEL, JSON.stringify({ min: minSize })); } catch (x) {} render(); });
  document.addEventListener('click', (e) => {
    if (!open || !e.target.closest) return;
    if (e.target.closest('.stkw-railbtn:not(.stkdkp-railbtn), .stkw-phonebtn, .stknw-phonebtn, .stkin-phonebtn')) setTimeout(() => { if (host.classList.contains('stkw-open') || host.classList.contains('stknw-open') || host.classList.contains('stkin-open')) setOpen(false); }, 0);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && isPhone()) setOpen(false); });
  window.addEventListener('resize', () => document.documentElement.classList.toggle('stkdkp-sheet', open && isPhone()), { passive: true });
  onData((s) => { if (open && s === targetOf(activeSym())) render(); });
  try { ws.on('state:changed', () => { if (open) render(); }); } catch (e) {}
  setInterval(() => { if (open && !document.hidden) { const s = targetOf(activeSym()); if (s) load(s); } }, 60000);
  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; } };
  window.__stkDarkPool = api;
  return api;
}

const CSS = `
.stk-dp-chip{ position:absolute; bottom:8px; left:50%; transform:translateX(-50%); z-index:6; pointer-events:none; max-width:90%; padding:4px 12px; border-radius:999px;
  font:400 11px/13px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  background:#131316; color:rgba(255,255,255,.64); border:1px solid rgba(255,255,255,.08); }
.stk-dp-chip[hidden], .stk-dp-tip[hidden]{ display:none; }
.stk-dp-tip{ position:fixed; z-index:9050; pointer-events:none; width:min(268px, calc(100vw - 16px)); padding:12px; border-radius:12px; background:#131316; color:rgba(255,255,255,.92);
  border:1px solid rgba(255,255,255,.08); font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; box-shadow:0 8px 24px rgba(0,0,0,.4); }
.stk-dp-h{ display:flex; align-items:center; gap:8px; font-weight:600; margin-bottom:8px; }
.stk-dp-h i{ width:8px; height:8px; border-radius:50%; flex:none; background:#00adb5; }
.stk-dp-h i.big{ background:#03c988; }
.stk-dp-r{ display:flex; justify-content:space-between; gap:12px; }
.stk-dp-r.full{ justify-content:flex-start; }
.stk-dp-r span{ color:rgba(255,255,255,.64); }
.stk-dp-n{ margin-top:8px; font-size:12px; line-height:16px; color:rgba(255,255,255,.64); }
.stk-dp-side{ margin:-4px 0 8px; font-size:12px; line-height:16px; color:rgba(255,255,255,.64); }
.stk-dp-sd{ display:inline-flex; align-items:center; gap:4px; font-weight:600; color:rgba(255,255,255,.92); }
.stk-dp-sd.b{ color:#03c988; } .stk-dp-sd.s{ color:#ff6b6b; }
.stk-dp-i{ display:inline-flex; opacity:.64; }
.stk-dp-hr{ height:1px; margin:8px 0; background:rgba(255,255,255,.08); }
.stk-dp-sn{ display:flex; gap:4px; align-items:flex-start; margin-top:4px; }
.stk-dp-sn svg{ flex:none; margin-top:2px; }
:root[data-theme="light"] .stk-dp-tip, :root[data-theme="light"] .stk-dp-chip{ background:#fff; color:#1d1d1f; border-color:rgba(0,0,0,.12); }
:root[data-theme="light"] .stk-dp-r span, :root[data-theme="light"] .stk-dp-n, :root[data-theme="light"] .stk-dp-chip, :root[data-theme="light"] .stk-dp-side{ color:#515154; }
:root[data-theme="light"] .stk-dp-sd{ color:#1d1d1f; } :root[data-theme="light"] .stk-dp-sd.b{ color:#047857; } :root[data-theme="light"] .stk-dp-sd.s{ color:#c62828; }
:root[data-theme="light"] .stk-dp-hr{ background:rgba(0,0,0,.08); }
.stkchart-panel.stkw-host.stkdkp-open #vela-chart{ right:calc(var(--stkw-rail) + var(--stkw-w)); }
.stkdkp{ position:absolute; top:0; bottom:0; right:var(--stkw-rail, 44px); width:var(--stkw-w, 340px); z-index:29; display:flex; flex-direction:column; min-width:0; background:var(--bg-0);
  border-left:1px solid var(--line-soft); font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; color:var(--ink-0); }
.stkdkp[hidden]{ display:none; }
.stkdkp-grab{ display:none; }
.stkdkp-hd{ flex:none; display:flex; align-items:center; gap:8px; padding:8px 8px 8px 12px; border-bottom:1px solid var(--line-soft); }
.stkdkp-title{ font-weight:600; font-size:13px; }
.stkdkp-sp{ flex:1; }
.stkdkp-seg[hidden]{ display:none; }
.stkdkp-seg{ flex:none; display:flex; margin:8px 12px 4px; padding:2px; border-radius:8px; background:var(--bg-2); }
.stkdkp-seg button{ flex:1; min-width:0; padding:0 4px; white-space:nowrap; min-height:28px; border:0; border-radius:6px; background:none; color:var(--ink-2); font:500 12px/16px inherit; font-family:inherit; cursor:pointer; font-variant-numeric:tabular-nums; }
.stkdkp-seg button[aria-pressed="true"]{ background:var(--bg-0, #050506); color:var(--ink-0); box-shadow:0 0 0 1px var(--line-soft); }
.stkdkp-seg button:focus-visible, .stkdkp-row:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkdkp-sub{ flex:none; padding:4px 12px 0; font-size:12px; line-height:16px; font-weight:600; color:var(--ink-0); }
.stkdkp-sub[hidden]{ display:none; }
.stkdkp-stat{ flex:none; padding:4px 12px 8px; font-size:12px; line-height:16px; color:var(--ink-2); }
.stkdkp-cols, .stkdkp-row{ display:grid; grid-template-columns:1.15fr 1fr 1fr .9fr; gap:4px; padding:0 12px; font-variant-numeric:tabular-nums; }
.stkdkp-cols{ flex:none; padding-bottom:4px; font-size:11px; line-height:13px; color:var(--ink-2); border-bottom:1px solid var(--line-soft); }
.stkdkp-cols[hidden]{ display:none; }
.stkdkp-cols span:nth-child(n+2), .stkdkp-row span:nth-child(n+2):not(.stkdkp-l2){ text-align:right; }
.stkdkp-list{ flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; }
.stkdkp-day{ position:sticky; top:0; z-index:1; padding:8px 12px 4px; font-size:11px; line-height:13px; font-weight:600; color:var(--ink-2); background:var(--bg-0); }
.stkdkp-row{ width:100%; min-height:32px; align-items:center; border:0; border-bottom:1px solid var(--line-soft); background:none; color:var(--ink-0); font:400 12px/16px inherit; font-family:inherit; cursor:pointer; text-align:left; }
.stkdkp-row:hover{ background:var(--bg-2); }
.stkdkp-row{ padding-top:4px; padding-bottom:4px; }
.stkdkp-l2{ grid-column:1 / -1; text-align:left !important; font-size:11px; line-height:13px; color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkdkp-l2 .stk-dp-sd{ font-weight:600; }
.stkdkp .stk-dp-sd{ color:var(--ink-0); } .stkdkp .stk-dp-sd.b{ color:#03c988; } .stkdkp .stk-dp-sd.s{ color:#ff6b6b; }
:root[data-theme="light"] .stkdkp .stk-dp-sd.b{ color:#047857; } :root[data-theme="light"] .stkdkp .stk-dp-sd.s{ color:#c62828; }
.stkdkp-row.big span:nth-child(4){ color:#03c988; font-weight:600; }
:root[data-theme="light"] .stkdkp-row.big span:nth-child(4){ color:#047857; }
.stkdkp-note{ margin:0; padding:16px 12px; color:var(--ink-2); font-size:12px; line-height:16px; }
.stkdkp-key{ margin:0; padding:8px 12px; font-size:11px; line-height:13px; color:var(--ink-2); }
.stkdkp-foot{ flex:none; margin:0; padding:8px 12px; border-top:1px solid var(--line-soft); font-size:11px; line-height:13px; color:var(--ink-2); }
.stkdkp-title{ white-space:nowrap; }
.stkdkp-alert{ flex:none; white-space:nowrap; display:inline-flex; align-items:center; gap:4px; min-height:32px; padding:0 10px 0 6px; border:1px solid var(--line-soft); border-radius:999px; background:none; color:var(--ink-0); font:500 13px/18px inherit; font-family:inherit; cursor:pointer; }
.stkdkp-alert[hidden]{ display:none; }
.stkdkp-alert:hover{ background:var(--bg-2); }
.stkdkp-alert.on{ color:#03c988; border-color:rgba(3,201,136,.45); }
:root[data-theme="light"] .stkdkp-alert.on{ color:#047857; border-color:rgba(4,120,87,.5); }
.stkdkp-alert:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkdkp-phonebtn{ display:none; }
.stkdkp-phonebtn.on{ color:var(--ink-0); background:var(--bg-2); }
@media (max-width:700px){
  .stkchart-panel.stkw-host.stkdkp-open #vela-chart{ right:0; }
  .stkdkp-phonebtn{ display:inline-flex; padding:0 8px; flex:none; }
  .stkdkp{ position:fixed; left:0; right:0; top:auto; bottom:var(--stkc-dock, 0px); width:auto; height:min(62vh, 520px); z-index:8000; border-left:0; border-top:1px solid var(--line-soft); border-radius:20px 20px 0 0; font-size:14px; box-shadow:0 -8px 24px rgba(0,0,0,.35); }
  .stkdkp-grab{ display:block; width:36px; height:4px; border-radius:2px; margin:8px auto 0; background:var(--line, rgba(255,255,255,.2)); }
  .stkdkp-x{ width:44px; height:44px; border-radius:50%; background:var(--bg-2); }
  .stkdkp-alert{ min-height:44px; padding:0 16px 0 12px; font-size:14px; }
  .stkdkp-seg button{ min-height:36px; font-size:13px; }
  .stkdkp-row{ min-height:44px; font-size:13px; }
  .stkdkp-foot{ padding-bottom:calc(8px + env(safe-area-inset-bottom)); }
}
`;

// ---- registration + persistence ---------------------------------------------------------------------
let installed = false;
export function installDarkPool(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: DP_TYPE, placement: 'above-data', create: layer });
  Core.registerNativeIndicator({
    type: DP_TYPE, title: 'Dark Pool Prints', shortTitle: 'Dark pool', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new DpNative(), legendNote: (d) => (!d ? '' : d.note || '')
  });
  Core.registerStatePersistence({
    key: 'stryker.darkpool', scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === DP_TYPE) out.push(h.inputValues()); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators().filter((h) => h.nativeType === DP_TYPE); } catch (e) { return; }
      payload.slice(0, 2).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
  if (typeof document !== 'undefined') {
    if (!document.getElementById('stk-dp-css')) { const st = document.createElement('style'); st.id = 'stk-dp-css'; st.textContent = CSS; document.head.appendChild(st); }
    document.addEventListener('pointermove', onMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', onDown, { capture: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tip) { tip.hidden = true; pinned = false; } }, true);
  }
}
