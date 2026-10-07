// Stryker Trading Academy — Charts: "Stryker GEX Levels" indicator (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls installGexLevels(Core) BEFORE the workspace is built,
// so a persisted session can restore it); Vela 0.6.17's plugin SDK (registerNativeIndicator,
// registerRendererLayer, registerStatePersistence), passed in as `Core`; the public, read-only
// GEX API GET /api/gex/levels/:name?dte=N (functions/api/gex/*, NOT edited here);
// assets/plan-limits.js (window.strykerPlanTier, optional).
//
// WHAT IT DOES (Owner order 2026-10-07: "one indicator for charts module, when selected shows
// GEX levels"; parity order build 461: "the gex page has more stuff like Value area high/low"):
// draws every line the GEX page chart draws (assets/gex.js collectLines, read only) with the
// same names, colours and line styles: CALL WALL, ZERO GAMMA, PUT WALL, IV +68% / IV -68%, and
// the market levels pVAH, pPOC, pVAL, ONH, ONL (on by default, as on the GEX page). Optional
// extras: the GEX page's text-panel levels (IV ±80%, prior RTH high/low, prior close, RTH
// open/high/low), a shaded 68% band, and the next 3 biggest-|GEX| strikes from the ladder.
// Labels of levels within a few px of each other merge into one tag ("pPOC · ZERO GAMMA").
//
// SYMBOL MAPPING
//   SPX, SPY (index/ETF symbols)   -> that market's own levels, as published.
//   ES / MES futures                -> SPX levels converted to that contract with the API's
//                                      own futures block (futures.ES / futures.MES .levels;
//                                      ladder strikes use the same ratio + basis).
//   NQ / MNQ futures, QQQ           -> QQQ levels (converted with futures.NQ / futures.MNQ).
//   anything else                   -> a small note, nothing drawn.
//
// PLAN: the same split as the GEX page (assets/plan-limits.js applyGex): Free = SPX, 0DTE, no
// strike table; Pro = every symbol and expiry. So Free members get SPX and ES/MES (SPX-derived)
// levels at 0DTE; NQ/MNQ/QQQ/SPY show an "Unlock NQ GEX with Pro" pill (/#pricing) instead, and
// the strikes extra stays off. Client-side only, like the GEX page (the API itself is public).
// Unknown plan after a few seconds fails open, as plan-guard.js does.
//
// DATA: fetched every 5 minutes while the page is visible (paused when hidden), cached per
// API market + expiry and shared by every chart cell. The lines are painted by a renderer
// layer from the last pushed data only: no network, DOM or layout reads per frame or per
// mouse move. The status reads "GEX updated X min ago" (from the API's market data time /
// fetched_at). Never "live" / "real-time". Education only. Not financial advice.

const TYPE = 'stk_gex';
const API = '/api/gex/levels/';
const REFRESH_MS = 5 * 60 * 1000;
const TIER_WAIT_MS = 8000;
const PRICING = '/#pricing';
export const GEX_COLORS = { call: '#ef4444', zero: '#f59e0b', put: '#22c55e', strike: '#94a3b8', em: '#8b7cf6',
  iv: '#8b7cf6', va: '#38bdf8', on: '#64748b', rth: '#8b7cf6' };

// Every level the GEX page (assets/gex.js) can show, read-only parity list (build 461):
//   chart lines (collectLines): CALL WALL, ZERO GAMMA, PUT WALL, IV +68% / IV -68%, and with
//   "Market levels: ON" pVAH, pPOC, pVAL, ONH, ONL (DATA.session[fut]).
//   text panels only (renderLevels / renderMarket): IV 80% range, PRIOR RTH HIGH/LOW,
//   PRIOR CLOSE, RTH OPEN, RTH HIGH, RTH LOW (and SPOT, which the candles already show).
// The chart ones are on by default with the GEX page's names, colours and line styles; the
// text-panel ones are optional extras (off). Session levels exist for futures charts only
// (the API computes them for ES/MES/NQ/MNQ).
// src: 'lv' = GEX level (futures-converted on futures charts), 'ses' = DATA.session[fut].
export const LEVEL_DEFS = [
  { id: 'call', on: 'showCall', col: 'callColor', label: 'CALL WALL', f: 'call_wall', src: 'lv', dash: 'solid', w: 2 },
  { id: 'zero', on: 'showZero', col: 'zeroColor', label: 'ZERO GAMMA', f: 'zero_gamma', src: 'lv', dash: 'dashed', w: 2 },
  { id: 'put', on: 'showPut', col: 'putColor', label: 'PUT WALL', f: 'put_wall', src: 'lv', dash: 'solid', w: 2 },
  { id: 'ivhi', on: 'showIv', col: 'ivColor', label: 'IV +68%', f: 'iv68_hi', src: 'lv', dash: 'dashed', w: 1 },
  { id: 'ivlo', on: 'showIv', col: 'ivColor', label: 'IV -68%', f: 'iv68_lo', src: 'lv', dash: 'dashed', w: 1 },
  { id: 'iv80hi', on: 'showIv80', col: 'ivColor', label: 'IV +80%', f: 'iv80_hi', src: 'lv', dash: 'dotted', w: 1 },
  { id: 'iv80lo', on: 'showIv80', col: 'ivColor', label: 'IV -80%', f: 'iv80_lo', src: 'lv', dash: 'dotted', w: 1 },
  { id: 'vah', on: 'showVah', col: 'vahColor', label: 'pVAH', f: 'prior_vah', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'poc', on: 'showPoc', col: 'pocColor', label: 'pPOC', f: 'prior_poc', src: 'ses', dash: 'solid', w: 1 },
  { id: 'val', on: 'showVal', col: 'valColor', label: 'pVAL', f: 'prior_val', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'onh', on: 'showOnh', col: 'onhColor', label: 'ONH', f: 'overnight_high', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'onl', on: 'showOnl', col: 'onlColor', label: 'ONL', f: 'overnight_low', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'prth_hi', on: 'showPrth', col: 'rthColor', label: 'PRIOR RTH HIGH', f: 'prior_rth_high', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'prth_lo', on: 'showPrth', col: 'rthColor', label: 'PRIOR RTH LOW', f: 'prior_rth_low', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'pclose', on: 'showPclose', col: 'rthColor', label: 'PRIOR CLOSE', f: 'prior_close', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'rth_open', on: 'showRthOpen', col: 'rthColor', label: 'RTH OPEN', f: 'rth_open', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'rth_hi', on: 'showRth', col: 'rthColor', label: 'RTH HIGH', f: 'rth_high', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'rth_lo', on: 'showRth', col: 'rthColor', label: 'RTH LOW', f: 'rth_low', src: 'ses', dash: 'dotted', w: 1 }
];

const G1 = 'GEX levels', G2 = 'Market levels', G3 = 'More session levels', G4 = 'Style';
const tog = (key, title, defval, group, inline) => ({ key, title, type: 'bool', defval, group, inline });
const col = (key, defval, group, inline) => ({ key, title: '', type: 'color', defval, group, inline });
const SCHEMA = [
  { key: 'dte', title: 'Expiry (Pro: all)', type: 'string', defval: '0', options: ['0', '1', '7', '30'],
    tooltip: '0 = same day (0DTE), 1 = next day, 7 = one week, 30 = one month. The Free plan covers 0DTE.' },
  tog('showCall', 'Call wall', true, G1, 'call'), col('callColor', GEX_COLORS.call, G1, 'call'),
  tog('showZero', 'Zero gamma (flip)', true, G1, 'zero'), col('zeroColor', GEX_COLORS.zero, G1, 'zero'),
  tog('showPut', 'Put wall', true, G1, 'put'), col('putColor', GEX_COLORS.put, G1, 'put'),
  tog('showIv', 'IV ±68%', true, G1, 'iv'), col('ivColor', GEX_COLORS.iv, G1, 'iv'),
  tog('showStrikes', 'Next 3 big strikes (Pro)', false, G1, 'strk'), col('strikeColor', GEX_COLORS.strike, G1, 'strk'),
  tog('showEm', 'Shade 68% band', false, G1, 'em'), col('emColor', GEX_COLORS.em, G1, 'em'),
  tog('showVah', 'pVAH', true, G2, 'vah'), col('vahColor', GEX_COLORS.va, G2, 'vah'),
  tog('showPoc', 'pPOC', true, G2, 'poc'), col('pocColor', GEX_COLORS.va, G2, 'poc'),
  tog('showVal', 'pVAL', true, G2, 'val'), col('valColor', GEX_COLORS.va, G2, 'val'),
  tog('showOnh', 'ONH', true, G2, 'onh'), col('onhColor', GEX_COLORS.on, G2, 'onh'),
  tog('showOnl', 'ONL', true, G2, 'onl'), col('onlColor', GEX_COLORS.on, G2, 'onl'),
  tog('showIv80', 'IV ±80%', false, G3),
  tog('showPrth', 'Prior RTH high / low', false, G3),
  tog('showPclose', 'Prior close', false, G3),
  tog('showRthOpen', 'RTH open', false, G3),
  tog('showRth', 'RTH high / low', false, G3),
  { key: 'rthColor', title: 'Session level colour', type: 'color', defval: GEX_COLORS.rth, group: G3 },
  { key: 'labels', title: 'Labels and price tags', type: 'bool', defval: true, group: G4 },
  { key: 'lineStyle', title: 'Line style', type: 'string', defval: 'as GEX page', options: ['as GEX page', 'solid', 'dashed', 'dotted'], group: G4 },
  { key: 'width', title: 'Line width (0 = as GEX page)', type: 'int', defval: 0, min: 0, max: 4, step: 1, group: G4 }
];

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d) => (typeof v === 'string' && v !== '' ? v : d);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- symbol -> GEX source ---------------------------------------------------------------
// Returns { api, fut|null, label, pro } or null when the symbol has no GEX levels.
export function gexSource(symbol, provider) {
  let ticker = String(symbol || ''), prov = String(provider || '');
  const m = /^([a-z]+):(.+)$/i.exec(ticker);
  if (m) { if (!prov) prov = m[1].toLowerCase(); ticker = m[2]; }
  const root = ticker.toUpperCase().replace(/[0-9]?!$/, '').replace(/^\^/, '');
  if (root === 'ES' || root === 'MES') return { api: 'SPX', fut: root, label: root + ' (from SPX)', pro: false };
  if (root === 'NQ' || root === 'MNQ') return { api: 'QQQ', fut: root, label: root + ' (from QQQ)', pro: true };
  if (prov === 'futures') return null;
  if (root === 'SPX' || root === 'SPXW') return { api: 'SPX', fut: null, label: 'SPX', pro: false };
  if (root === 'SPY') return { api: 'SPY', fut: null, label: 'SPY', pro: true };
  if (root === 'QQQ') return { api: 'QQQ', fut: null, label: 'QQQ', pro: true };
  return null;
}

// ---- API data -> level list ---------------------------------------------------------------
export function fmtLevel(v) {
  if (!isNum(v)) return '';
  return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2);
}
// Pure: the levels to draw for one source, from one API response. opts = the indicator's inputs
// (show* keys; a missing key falls back to its schema default). Futures prices come from the
// API's own conversion (futures[fut].levels); ladder strikes use its ratio + basis; session
// levels come from data.session[fut] (already in futures prices).
const DEF_ON = Object.fromEntries(SCHEMA.filter((x) => x.type === 'bool').map((x) => [x.key, x.defval]));
export function buildLevels(data, src, opts) {
  opts = opts || {};
  const on = (k) => (typeof opts[k] === 'boolean' ? opts[k] : DEF_ON[k]);
  if (!data || data.error) return { err: 'GEX levels are not available right now.' };
  let conv = (v) => v, L, S = null;
  if (src.fut) {
    const f = data.futures && data.futures[src.fut];
    if (!f || f.error || !f.levels) return { err: 'No ' + src.fut + ' conversion in the GEX data right now.' };
    const ratio = num(f.ratio, null), basis = num(f.basis, 0);
    L = f.levels;
    conv = (v) => (ratio == null ? null : v * ratio + basis);
    const ses = data.session && data.session[src.fut];
    if (ses && !ses.error) S = ses;
  } else {
    const e = data.expected || {}, e68 = e['68%'] || [], e80 = e['80%'] || [];
    L = { call_wall: data.call_wall, put_wall: data.put_wall, zero_gamma: data.zero_gamma,
      iv68_lo: e68[0], iv68_hi: e68[1], iv80_lo: e80[0], iv80_hi: e80[1] };
  }
  // API values are shown as published (2 dp), the same numbers the GEX page prints.
  const r = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
  const out = { lines: [], band: null, noSession: false };
  const srcNote = (raw) => (src.fut && isNum(raw) ? ' (' + src.api + ' ' + fmtLevel(Math.round(raw * 100) / 100) + ')' : '');
  for (const d of LEVEL_DEFS) {
    if (!on(d.on)) continue;
    if (d.src === 'ses') { if (!S) { out.noSession = true; continue; } }
    const v = d.src === 'ses' ? S[d.f] : L[d.f];
    if (!isNum(v)) continue;
    const note = (d.id === 'call' || d.id === 'zero' || d.id === 'put') ? srcNote(data[d.f]) : '';
    out.lines.push({ id: d.id, label: d.label, price: r(v), note, col: d.col, dash: d.dash, w: d.w });
  }
  if (on('showEm') && isNum(L.iv68_lo) && isNum(L.iv68_hi)) out.band = { lo: r(L.iv68_lo), hi: r(L.iv68_hi) };
  if (on('showStrikes') && Array.isArray(data.ladder)) {
    const skip = new Set([data.call_wall, data.put_wall].filter(isNum));
    data.ladder.filter((x) => x && isNum(x.strike) && isNum(x.gex) && x.gex !== 0 && !skip.has(x.strike))
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 3)
      .forEach((x, i) => {
        const p = conv(x.strike);
        if (isNum(p)) out.lines.push({ id: 'strike' + i, label: 'GEX strike', price: r(p), note: src.fut ? ' (' + src.api + ' ' + fmtLevel(x.strike) + ')' : '', col: 'strikeColor', dash: 'dotted', w: 1 });
      });
  }
  return out;
}
// Data time in epoch seconds: the market block's newest data stamp, else fetched_at.
export function dataTime(data) {
  if (!data) return null;
  const m = data.market || {};
  return num(m.data_ts, null) || num(data.fetched_at, null);
}
export function agoText(tsSec, nowMs) {
  if (!isNum(tsSec)) return 'GEX updated time unknown';
  const min = Math.max(0, Math.floor(((nowMs || Date.now()) / 1000 - tsSec) / 60));
  if (min < 1) return 'GEX updated just now';
  if (min < 120) return 'GEX updated ' + min + ' min ago';
  const h = Math.floor(min / 60);
  if (h < 48) return 'GEX updated ' + h + ' h ago';
  return 'GEX updated ' + Math.floor(h / 24) + ' days ago';
}

// ---- shared fetch cache (one per API market + expiry) ------------------------------------
const cache = new Map();      // key -> { data, at, p }
const subs = new Set();       // natives to nudge when data lands
function key(api, dte) { return api + ':' + dte; }
export function gexFetch(api, dte, force) {
  const k = key(api, dte);
  const e = cache.get(k) || {};
  if (e.p) return e.p;
  if (!force && e.data && Date.now() - e.at < REFRESH_MS - 5000) return Promise.resolve(e.data);
  const p = fetch(API + api + '?dte=' + dte, { headers: { accept: 'application/json' } })
    .then((r) => r.json().then((j) => (r.ok ? j : { error: (j && j.error) || ('HTTP ' + r.status) })))
    .catch((err) => ({ error: String(err && err.message || err) }))
    .then((j) => {
      const prev = cache.get(k) || {};
      const good = j && !j.error;
      cache.set(k, { data: good ? j : (prev.data || j), at: good ? Date.now() : (prev.at || 0), p: null });
      return good ? j : (prev.data || j);
    });
  cache.set(k, Object.assign({}, e, { p }));
  return p;
}
export function gexCached(api, dte) { const e = cache.get(key(api, dte)); return e ? e.data : null; }

let timer = 0;
function wantedKeys() {
  const ks = new Map();
  subs.forEach((n) => { const w = n.want(); if (w) ks.set(key(w.api, w.dte), w); });
  return [...ks.values()];
}
function tick() {
  if (document.visibilityState === 'hidden') return;
  wantedKeys().forEach((w) => gexFetch(w.api, w.dte).then(() => subs.forEach((n) => n.refresh())));
  subs.forEach((n) => n.statusTick());
}
function startTimer() {
  if (timer || !subs.size) return;
  timer = setInterval(tick, 60 * 1000);   // status text each minute; data only when 5 min old
}
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopTimer();
    else if (subs.size) { startTimer(); tick(); }
  });
}

// ---- plan tier ----------------------------------------------------------------------------
let tierP = null;
export function gexTier() {
  if (tierP) return tierP;
  tierP = new Promise((resolve) => {
    const t = setTimeout(() => resolve({ free: false, unknown: true }), TIER_WAIT_MS);
    try {
      if (typeof window.strykerPlanTier !== 'function') { clearTimeout(t); resolve({ free: false, unknown: true }); return; }
      window.strykerPlanTier().then((r) => { clearTimeout(t); resolve(r || { free: false }); }, () => { clearTimeout(t); resolve({ free: false }); });
    } catch (e) { clearTimeout(t); resolve({ free: false }); }
  });
  return tierP;
}

// ---- the native indicator -------------------------------------------------------------
function resolveSrc(ctx) {
  let provider = '';
  try { const r = ctx.data.resolve(ctx.symbol); if (r) provider = r.provider; } catch (e) {}
  return gexSource(ctx.symbol, provider);
}
class GexNative {
  constructor() { this.inputs = {}; this.ctx = null; this.tier = null; this.sig = ''; this.status = ''; }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = inputs || {};
    subs.add(this); startTimer();
    gexTier().then((t) => { this.tier = t; this.load(); });
    this.load();
  }
  want() {
    if (!this.ctx || !this.tier) return null;   // the plan decides which expiry may load
    const src = resolveSrc(this.ctx);
    if (!src) return null;
    if (src.pro && (!this.tier || this.tier.free)) return null;
    return { api: src.api, dte: this.dte() };
  }
  dte() {
    const d = parseInt(str(this.inputs.dte, '0'), 10);
    if (this.tier && this.tier.free) return 0;
    return [0, 1, 7, 30].includes(d) ? d : 0;
  }
  load() {
    const w = this.want();
    this.refresh();
    if (w && document.visibilityState !== 'hidden') gexFetch(w.api, w.dte).then(() => this.refresh());
  }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.load(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { subs.delete(this); if (!subs.size) stopTimer(); try { this.ctx.pushData(null); this.ctx.emit({ priceLines: [], tables: [] }); } catch (e) {} }
  statusTick() { this.refresh(); }
  // Build the payload for the layer; push only when it changed (no repaint otherwise).
  refresh() {
    if (!this.ctx) return;
    const src = resolveSrc(this.ctx);
    const i = this.inputs;
    let payload;
    if (!src) payload = { note: 'GEX levels available for SPX, ES, NQ' };
    else if (!this.tier) payload = { note: 'Loading GEX levels…' };
    else if (src.pro && this.tier.free) payload = { pill: 'Unlock ' + (src.api === 'QQQ' ? 'NQ' : src.api) + ' GEX with Pro', href: PRICING };
    else {
      const dte = this.dte();
      const data = gexCached(src.api, dte);
      if (!data) payload = { note: 'Loading GEX levels…' };
      else {
        const opts = Object.assign({}, i);
        if (this.tier && this.tier.free) opts.showStrikes = false;
        const lv = buildLevels(data, src, opts);
        if (lv.err) payload = { note: lv.err };
        else {
          const sty = str(i.lineStyle, 'as GEX page'), wd = Math.round(num(i.width, 0));
          const color = (k) => { const s = SCHEMA.find((x) => x.key === k); return str(i[k], s ? s.defval : GEX_COLORS.strike); };
          payload = {
            lines: lv.lines.map((l) => ({ id: l.id, price: l.price, color: color(l.col), name: l.label, text: l.label + ' ' + fmtLevel(l.price) + (l.note || ''),
              dash: (l.id.startsWith('strike') || !['solid', 'dashed', 'dotted'].includes(sty)) ? l.dash : sty,
              w: wd >= 1 ? Math.min(4, wd) : l.w })),
            band: lv.band ? { lo: lv.band.lo, hi: lv.band.hi, color: color('emColor') } : null,
            labels: i.labels !== false,
            status: agoText(dataTime(data)) + ' · ' + src.label + ' ' + (dte === 0 ? '0DTE' : dte + 'DTE') + (data.stale ? ' · last saved copy' : '') + (lv.noSession && !src.fut ? ' · market levels on ES/NQ charts' : '')
          };
        }
      }
    }
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (e) {}
  }
}

// ---- renderer layer: lines + right-edge price tags + status chip ---------------------------
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
const TAG_H = 16, MERGE_PX = 6;
// Pure: tags [{y, l}] sorted by y -> groups whose lines sit within MERGE_PX share one label.
export function mergeTags(tags) {
  const out = [];
  [...tags].sort((p, q) => p.y - q.y).forEach((t) => {
    const g = out[out.length - 1];
    if (g && t.y - g.y0 <= MERGE_PX) { g.items.push(t); return; }
    out.push({ y0: t.y, items: [t] });
  });
  return out.map((g) => {
    const it = g.items, l0 = it[0].l;
    const names = it.map((x) => x.l.name || x.l.text);
    const prices = [...new Set(it.map((x) => fmtLevel(x.l.price)))];
    const text = it.length === 1 ? l0.text : names.join(' · ') + ' ' + prices.join(' / ');
    const y = it.reduce((s2, x) => s2 + x.y, 0) / it.length;
    return { y, yc: y, axisY: it[0].y, axisText: fmtLevel(l0.price), text, color: l0.color, ids: it.map((x) => x.l.id) };
  });
}
// Pure: push stacked tags apart so no two boxes overlap, inside [top, bot].
export function layoutTags(groups, top, bot) {
  let prev = -Infinity;
  for (const t of groups) { t.yc = Math.max(t.y, prev + TAG_H + 1, top + TAG_H / 2); prev = t.yc; }
  // pushed past the bottom: walk back up
  let next = Infinity;
  for (let i = groups.length - 1; i >= 0; i--) { const t = groups[i]; t.yc = Math.min(t.yc, next - TAG_H - 1, bot - TAG_H / 2); next = t.yc; }
  return groups;
}
function gexLayer() {
  let canvas = null, chip = null, last = '', lastTags = [];
  function ensureChip() {
    if (chip || !canvas || !canvas.parentElement) return chip;
    chip = document.createElement('div');
    chip.className = 'stk-gex-chip';
    chip.hidden = true;
    canvas.parentElement.appendChild(chip);
    return chip;
  }
  function paintChip(d, rightPx, bottomPx) {
    const c = ensureChip();
    if (!c) return;
    const k = d ? JSON.stringify([d.note, d.pill, d.status, rightPx, bottomPx]) : '';
    if (k === last) return;
    last = k;
    if (!d || !(d.note || d.pill || d.status)) { c.hidden = true; return; }
    c.hidden = false;
    c.style.right = rightPx + 'px';
    c.style.bottom = bottomPx + 'px';
    c.textContent = '';
    if (d.pill) {
      const a = document.createElement('a');
      a.className = 'stk-gex-pill'; a.href = d.href || PRICING; a.textContent = d.pill;
      c.appendChild(a);
    } else {
      c.classList.toggle('is-note', !!d.note);
      c.appendChild(document.createTextNode(d.note || d.status));
    }
  }
  return {
    mount(cv) { canvas = cv; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const dpr = a.coords.dpr || 1;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data;
      const W = a.coords.width;
      const fullW = canvas.width / dpr, fullH = canvas.height / dpr;
      paintChip(d, Math.max(0, fullW - W) + 8, Math.max(0, fullH - (a.bounds.top + a.bounds.height)) + 8);
      if (!d || !d.lines) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = a.bounds.top, bot = top + a.bounds.height;
      const Y = (p) => a.coords.priceToY(p, a.scale, a.bounds);
      g.save();
      g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      if (d.band) {
        const y1 = Y(d.band.hi), y2 = Y(d.band.lo);
        g.fillStyle = hexA(d.band.color, 0.07);
        g.fillRect(0, Math.min(y1, y2), W, Math.abs(y2 - y1));
        g.strokeStyle = hexA(d.band.color, 0.55); g.lineWidth = 1; g.setLineDash([2, 3]);
        [y1, y2].forEach((y) => { const yy = Math.round(y) + 0.5; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); });
      }
      const font = '600 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
      g.font = font; g.textBaseline = 'middle';
      const tags = [];
      for (const l of d.lines) {
        const y = Math.round(Y(l.price)) + 0.5;
        if (!(y >= top && y <= bot)) continue;
        g.strokeStyle = l.color; g.lineWidth = l.w || d.width || 1;
        g.setLineDash(l.dash === 'dashed' ? [6, 4] : l.dash === 'dotted' ? [2, 3] : []);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        if (d.labels) tags.push({ y, l });
      }
      g.setLineDash([]);
      // Right-edge tags. Levels within MERGE_PX of each other share ONE tag ("pPOC · ZERO GAMMA
      // 7881"), so labels never draw on top of each other; the rest are nudged apart (stacked).
      const groups = mergeTags(tags);
      layoutTags(groups, top, bot);
      for (const t of groups) {
        const w = Math.ceil(g.measureText(t.text).width) + 10;
        const x = Math.max(2, W - w - 2);
        t.box = { x, y: t.yc - TAG_H / 2, w, h: TAG_H };
        g.fillStyle = t.color;
        g.fillRect(x, t.yc - TAG_H / 2, w, TAG_H);
        g.fillStyle = '#0b0b0b';
        g.fillText(t.text, x + 5, t.yc + 0.5);
      }
      lastTags = groups.map((t) => ({ text: t.text, ids: t.ids, box: t.box, axis: t.axisY }));
      canvas.__stkGexTags = lastTags;   // test hook (a plain property: no DOM write)
      g.restore();
      // Price tags on the right price axis (outside the plot clip), at the exact line price.
      const axW = fullW - W;
      if (axW > 24) {
        g.save();
        g.beginPath(); g.rect(W, top, axW, a.bounds.height); g.clip();
        g.font = font; g.textBaseline = 'middle';
        for (const t of groups) {
          g.fillStyle = t.color;
          g.fillRect(W + 1, t.axisY - 8, axW - 2, 16);
          g.fillStyle = '#0b0b0b';
          g.fillText(t.axisText, W + 6, t.axisY + 0.5);
        }
        g.restore();
      }
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; },
    // Test hook: the label boxes painted last frame.
    tags() { return lastTags; }
  };
}

// ---- registration + persistence ---------------------------------------------------------
const PERSIST_KEY = 'stryker.gex';
let installed = false;
export function installGexLevels(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: TYPE, placement: 'above-data', create: gexLayer });
  Core.registerNativeIndicator({
    type: TYPE, title: 'Stryker GEX Levels', shortTitle: 'GEX Levels', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new GexNative()
  });
  // Vela persists which natives are on a chart but not their settings: keep them in the
  // workspace document (session + templates), like the volume tools do.
  Core.registerStatePersistence({
    key: PERSIST_KEY, scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === TYPE) out.push(h.inputValues()); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators().filter((h) => h.nativeType === TYPE); } catch (e) { return; }
      payload.slice(0, 4).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        // Settings saved before build 461 (no market-level keys) carry the old defaults
        // solid / width 1, which would flatten the GEX page's line styles: drop those two.
        if (!('showVah' in vals)) { if (vals.lineStyle === 'solid') delete vals.lineStyle; if (vals.width === 1) delete vals.width; }
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
}
export const GEX_TYPE = TYPE;
export const GEX_DESC = 'Call wall, put wall, zero gamma, IV ±68% and market levels (pVAH, pPOC, pVAL, ONH, ONL) from the GEX page, on SPX, ES and NQ charts.';
