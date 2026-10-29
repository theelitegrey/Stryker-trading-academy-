// TradeZoro — "ZoroTide" chart indicator (native, lower pane): options money flow, calls vs puts. ES module.
// Owner order 2026-10-29. Two lines since the 9:30 ET open: net call premium (green) and net put premium (red), in $.
// Data: the book-recorder Worker GET /tide?u=SPX|SPY|QQQ&days=6 (workers/book-recorder/src/tide.js; samples built from the
// Cboe chains by gex-feeder/tide.py; edge-cached 30 s; never InsightSentry from the browser).
// Symbol map (like GEX): ES / MES -> SPX, NQ / MNQ -> QQQ; SPX, SPY, QQQ direct. PLAN: Pro on every symbol (charts-pro-gate kind
// 'tide': Free sees the PRO tag and the upgrade modal). Bar replay: nothing is drawn (the day's totals would leak the future).
// METHOD (help text on the GEX+ tab, same words): new volume per contract = volume now - previous sample; premium = new volume
// x price x 100 (last trade, else mid); last trade in the top 25 % of the bid-ask spread = bought, bottom 25 % = sold, between =
// half and half; net = bought - sold; the lines add the samples up from the open.
// Wording: "Estimated from options volume and quotes. Updated X min ago." Never live / real-time / delayed. Education only.
// Depends on: Vela plugin SDK via the legend-row Core (registerNativeIndicator, registerStatePersistence); window.strykerPlanTier (optional).

export const TIDE_TYPE = 'stk_tide';
export const TIDE_DESC = 'Options money flow: net call premium (green) and net put premium (red) since the open, in a lower pane (SPX, SPY, QQQ, ES, NQ)';
const API = 'https://book-recorder.theelitegrey.workers.dev/tide?days=6&u=';
const REFRESH_MS = 60 * 1000;
const GAP_MS = 20 * 60 * 1000;     // no line across a hole in the samples longer than this
const SCHEMA = [
  { key: 'callColor', title: 'Net call premium colour', type: 'color', defval: '#22c55e' },
  { key: 'putColor', title: 'Net put premium colour', type: 'color', defval: '#ef4444' },
  { key: 'lineWidth', title: 'Line width', type: 'number', defval: 2, min: 1, max: 4 },
  { key: 'showStatus', title: 'Status', type: 'bool', defval: true }
];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- symbol -> options source (pure) ---------------------------------------------------------
export function tideSource(symbol, provider) {
  let ticker = String(symbol || ''), prov = String(provider || '');
  const m = /^([a-z_]+):(.+)$/i.exec(ticker);
  if (m) { if (!prov) prov = m[1].toLowerCase(); ticker = m[2]; }
  const root = ticker.toUpperCase().replace(/[0-9]?!$/, '').replace(/^\^/, '');
  if (root === 'ES' || root === 'MES') return { u: 'SPX', label: root + ' (from SPX)' };
  if (root === 'NQ' || root === 'MNQ') return { u: 'QQQ', label: root + ' (from QQQ)' };
  if (prov === 'futures') return null;
  if (root === 'SPX' || root === 'SPXW') return { u: 'SPX', label: 'SPX' };
  if (root === 'SPY') return { u: 'SPY', label: 'SPY' };
  if (root === 'QQQ') return { u: 'QQQ', label: 'QQQ' };
  return null;
}

// ---- samples -> running totals per day (pure) ---------------------------------------------------
// days = the /tide reply's days[] (columns). Returns [{ day, t: ms[], cn[], pn[], cp[], pp[] }] with the sums since the open.
export function runningTotals(days) {
  return (days || []).map((d) => {
    let a = 0, b = 0, c = 0, e = 0;
    const cn = [], pn = [], cp = [], pp = [];
    for (let i = 0; i < d.t.length; i++) { a += d.cn[i]; b += d.pn[i]; c += d.cp[i]; e += d.pp[i]; cn.push(a); pn.push(b); cp.push(c); pp.push(e); }
    return { day: d.day, t: d.t.map((x) => x * 1000), cn, pn, cp, pp };
  }).filter((d) => d.t.length);
}
// The running totals at a chart bar: the last sample at or before the bar's END (a bar sees only what had happened by then).
// null when no sample, or the nearest one is older than GAP_MS.
export function valueAt(series, barStartMs, barMs) {
  const end = barStartMs + barMs;
  for (const d of series) {
    if (end < d.t[0] || barStartMs > d.t[d.t.length - 1] + GAP_MS) continue;
    let lo = 0, hi = d.t.length - 1, best = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (d.t[m] <= end) { best = m; lo = m + 1; } else hi = m - 1; }
    if (best < 0) continue;
    if (end - d.t[best] > GAP_MS) return null;
    return { cn: d.cn[best], pn: d.pn[best], cp: d.cp[best], pp: d.pp[best], t: d.t[best] };
  }
  return null;
}
export function tfMin(tf) {
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) return +tf;
  const m = /^(\d+)([SDWM])$/i.exec(tf) || /^([DWM])$/i.exec(tf);
  if (!m) return null;
  const n = m.length === 3 ? +m[1] : 1, u = (m.length === 3 ? m[2] : m[1]).toUpperCase();
  return u === 'S' ? n / 60 : u === 'D' ? n * 1440 : u === 'W' ? n * 10080 : n * 43200;
}
export function agoText(tsSec, nowMs) {
  if (!isNum(tsSec)) return '';
  const m = Math.max(0, Math.floor(((nowMs || Date.now()) / 1000 - tsSec) / 60));
  if (m < 1) return 'Updated just now.';
  if (m < 60) return 'Updated ' + m + ' min ago.';
  const h = Math.floor(m / 60);
  return h < 24 ? 'Updated ' + h + ' h ago.' : 'Updated ' + Math.floor(h / 24) + ' days ago.';
}
export function money(v) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v), s = v < 0 ? '−' : '+';
  return s + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0));
}

// ---- shared fetch cache (one per underlying) ---------------------------------------------------
const cache = new Map();
const subs = new Set();
const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
function tideFetch(u) {
  const e = cache.get(u) || {};
  if (e.p) return e.p;
  if (e.data && Date.now() - e.at < REFRESH_MS - 5000) return Promise.resolve(e.data);
  const p = fetch(API + u, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((j) => {
      const prev = cache.get(u) || {};
      const data = j && Array.isArray(j.days) ? Object.assign(j, { series: runningTotals(j.days) }) : (prev.data || null);
      cache.set(u, { data, at: j ? Date.now() : (prev.at || 0), p: null });
      return data;
    });
  cache.set(u, Object.assign({}, e, { p }));
  return p;
}
let timer = 0;
function tick() {
  if (document.visibilityState === 'hidden') return;
  const us = new Set();
  subs.forEach((n) => { const w = n.want(); if (w) us.add(w); });
  us.forEach((u) => tideFetch(u).then(() => subs.forEach((n) => n.render())));
}
function startTimer() { if (!timer && subs.size) timer = setInterval(tick, REFRESH_MS); }
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopTimer();
    else if (subs.size) { startTimer(); tick(); }
  });
}

// ---- the native ----------------------------------------------------------------------------------
function light() { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } }
function msgTable(id, text) {
  const day = light();
  return { id, paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: day ? '#334155' : '#a3a9b6', hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}
function srcOf(ctx) {
  let provider = '';
  try { const r = ctx.data.resolve(ctx.symbol); if (r) provider = r.provider; } catch (e) {}
  return tideSource(ctx.symbol, provider);
}
class TideNative {
  constructor() { this.inputs = {}; this.ctx = null; this.sig = ''; }
  defaults() { return Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); subs.add(this); startTimer(); this.load(); }
  want() { if (!this.ctx || replayOn()) return null; const s = srcOf(this.ctx); return s ? s.u : null; }
  load() { this.render(); const u = this.want(); if (u && document.visibilityState !== 'hidden') tideFetch(u).then(() => this.render()); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.render(); }
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(this.defaults(), i); this.sig = ''; this.render(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { subs.delete(this); if (!subs.size) stopTimer(); try { this.ctx.emit({ series: [], tables: [] }); } catch (e) {} }
  note(text) {
    const k = 'n|' + text;
    if (k === this.sig) return;
    this.sig = k;
    this.ctx.setStatus('idle');
    this.ctx.emit({ tables: [msgTable('tide-msg', text)] });
  }
  render() {
    if (!this.ctx) return;
    const I = this.inputs, ctx = this.ctx;
    if (replayOn()) return this.note('ZoroTide is hidden during bar replay');
    const src = srcOf(ctx);
    if (!src) return this.note('ZoroTide: SPX, SPY, QQQ, ES, NQ');
    const ms = (tfMin(ctx.timeframe) || 0) * 60000;
    if (!ms || ms >= 86400000) return this.note('ZoroTide shows intraday charts (1 minute to 4 hours)');
    const e = cache.get(src.u), data = e && e.data;
    if (!data) return this.note('Loading ZoroTide…');
    const bars = ctx.bars();
    const callPts = [], putPts = [];
    let lastT = 0;
    for (const b of bars) {
      const v = valueAt(data.series, b.time, ms);
      if (v) { callPts.push({ time: b.time, value: v.cn }); putPts.push({ time: b.time, value: v.pn }); if (v.t > lastT) lastT = v.t; }
      else { callPts.push({ time: b.time, value: null }); putPts.push({ time: b.time, value: null }); }
    }
    const status = 'ZoroTide ' + src.label + ': estimated from options volume and quotes. ' + agoText(lastT / 1000);
    const tables = I.showStatus === false || !lastT ? [] : [msgTable('tide-msg', status)];
    const sig = 'd|' + src.u + '|' + bars.length + '|' + (bars.length ? bars[0].time + '|' + bars[bars.length - 1].time : '') + '|' + lastT + '|' + JSON.stringify(I) + '|' + status;
    if (sig === this.sig) return;
    this.sig = sig;
    ctx.setStatus('idle');
    const w = Math.min(4, Math.max(1, Number(I.lineWidth) || 2));
    ctx.emit({
      series: [
        { id: 'tide-put', title: 'Net put premium', paneId: '', kind: 'line', points: putPts, style: { color: I.putColor, width: w, lineStyle: 'solid' } },
        { id: 'tide-call', title: 'Net call premium', paneId: '', kind: 'line', points: callPts, style: { color: I.callColor, width: w, lineStyle: 'solid' } }
      ],
      priceLines: [{ id: 'tide-zero', paneId: '', price: 0, color: light() ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.3)', lineStyle: 'dashed', width: 1, title: '' }],
      tables
    });
  }
}

// ---- registration + persistence ------------------------------------------------------------------
const PERSIST_KEY = 'stryker.tide';
let installed = false;
export function installZoroTide(Core) {
  if (installed) return;
  installed = true;
  Core.registerNativeIndicator({
    type: TIDE_TYPE, title: 'ZoroTide (options money flow: calls vs puts)', shortTitle: 'ZoroTide', paneHint: 'new', overlay: false,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new TideNative()
  });
  Core.registerStatePersistence({
    key: PERSIST_KEY, scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === TIDE_TYPE) out.push(h.inputValues()); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators().filter((h) => h.nativeType === TIDE_TYPE); } catch (e) { return; }
      payload.slice(0, 2).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
}
