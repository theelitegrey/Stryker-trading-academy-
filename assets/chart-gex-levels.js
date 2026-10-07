// Stryker Trading Academy — Charts: "Stryker GEX Levels" indicator (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls installGexLevels(Core) BEFORE the workspace is built,
// so a persisted session can restore it); Vela 0.6.17's plugin SDK (registerNativeIndicator,
// registerRendererLayer, registerStatePersistence), passed in as `Core`; the public, read-only
// GEX API GET /api/gex/levels/:name?dte=N (functions/api/gex/*, NOT edited here);
// assets/plan-limits.js (window.strykerPlanTier, optional).
//
// WHAT IT DOES (Owner order 2026-10-07: "one indicator for charts module, when selected shows
// GEX levels"): draws the GEX page's call wall, put wall and zero gamma (flip) as labelled
// horizontal lines with price tags at the right edge of the plot, in the GEX page's colours
// (assets/gex.css .gex-level.call/.zero/.put). Optional: the 68% expected-move band and the
// next 3 biggest-|GEX| strikes from the API's ladder.
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
export const GEX_COLORS = { call: '#ef4444', zero: '#f59e0b', put: '#22c55e', strike: '#94a3b8', em: '#38bdf8' };

const SCHEMA = [
  { key: 'dte', title: 'Expiry (Pro: all)', type: 'string', defval: '0', options: ['0', '1', '7', '30'],
    tooltip: '0 = same day (0DTE), 1 = next day, 7 = one week, 30 = one month. The Free plan covers 0DTE.' },
  { key: 'showCall', title: 'Call wall', type: 'bool', defval: true },
  { key: 'showPut', title: 'Put wall', type: 'bool', defval: true },
  { key: 'showZero', title: 'Zero gamma (flip)', type: 'bool', defval: true },
  { key: 'showEm', title: 'Expected move band (68%)', type: 'bool', defval: false },
  { key: 'showStrikes', title: 'Next 3 big strikes (Pro)', type: 'bool', defval: false },
  { key: 'labels', title: 'Labels and price tags', type: 'bool', defval: true },
  { key: 'lineStyle', title: 'Line style', type: 'string', defval: 'solid', options: ['solid', 'dashed', 'dotted'] },
  { key: 'width', title: 'Line width', type: 'int', defval: 1, min: 1, max: 4, step: 1 },
  { key: 'callColor', title: 'Call wall colour', type: 'color', defval: GEX_COLORS.call },
  { key: 'putColor', title: 'Put wall colour', type: 'color', defval: GEX_COLORS.put },
  { key: 'zeroColor', title: 'Zero gamma colour', type: 'color', defval: GEX_COLORS.zero },
  { key: 'emColor', title: 'Expected move colour', type: 'color', defval: GEX_COLORS.em },
  { key: 'strikeColor', title: 'Strike colour', type: 'color', defval: GEX_COLORS.strike }
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
// Pure: the levels to draw for one source, from one API response. Futures prices come from
// the API's own conversion (futures[fut].levels); ladder strikes use its ratio + basis.
export function buildLevels(data, src, opts) {
  opts = opts || {};
  if (!data || data.error) return { err: 'GEX levels are not available right now.' };
  let conv = (v) => v, L = data;
  if (src.fut) {
    const f = data.futures && data.futures[src.fut];
    if (!f || f.error || !f.levels) return { err: 'No ' + src.fut + ' conversion in the GEX data right now.' };
    const ratio = num(f.ratio, null), basis = num(f.basis, 0);
    L = { call_wall: f.levels.call_wall, put_wall: f.levels.put_wall, zero_gamma: f.levels.zero_gamma,
      iv68_lo: f.levels.iv68_lo, iv68_hi: f.levels.iv68_hi };
    conv = (v) => (ratio == null ? null : v * ratio + basis);
  } else {
    const e = data.expected && data.expected['68%'];
    L = { call_wall: data.call_wall, put_wall: data.put_wall, zero_gamma: data.zero_gamma, iv68_lo: e && e[0], iv68_hi: e && e[1] };
  }
  // API values are shown as published (2 dp), the same numbers the GEX page prints.
  const r = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
  const out = { lines: [], band: null };
  const srcNote = (raw) => (src.fut && isNum(raw) ? ' (' + src.api + ' ' + fmtLevel(Math.round(raw * 100) / 100) + ')' : '');
  if (opts.call !== false && isNum(L.call_wall)) out.lines.push({ id: 'call', label: 'Call wall', price: r(L.call_wall), note: srcNote(data.call_wall) });
  if (opts.zero !== false && isNum(L.zero_gamma)) out.lines.push({ id: 'zero', label: 'Zero gamma', price: r(L.zero_gamma), note: srcNote(data.zero_gamma) });
  if (opts.put !== false && isNum(L.put_wall)) out.lines.push({ id: 'put', label: 'Put wall', price: r(L.put_wall), note: srcNote(data.put_wall) });
  if (opts.em && isNum(L.iv68_lo) && isNum(L.iv68_hi)) out.band = { lo: r(L.iv68_lo), hi: r(L.iv68_hi) };
  if (opts.strikes && Array.isArray(data.ladder)) {
    const skip = new Set([data.call_wall, data.put_wall].filter(isNum));
    data.ladder.filter((x) => x && isNum(x.strike) && isNum(x.gex) && x.gex !== 0 && !skip.has(x.strike))
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 3)
      .forEach((x, i) => {
        const p = conv(x.strike);
        if (isNum(p)) out.lines.push({ id: 'strike' + i, label: 'GEX strike', price: r(p), note: src.fut ? ' (' + src.api + ' ' + fmtLevel(x.strike) + ')' : '' });
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
        const lv = buildLevels(data, src, { call: i.showCall !== false, put: i.showPut !== false, zero: i.showZero !== false,
          em: i.showEm === true, strikes: i.showStrikes === true && !(this.tier && this.tier.free) });
        if (lv.err) payload = { note: lv.err };
        else {
          const col = { call: str(i.callColor, GEX_COLORS.call), put: str(i.putColor, GEX_COLORS.put), zero: str(i.zeroColor, GEX_COLORS.zero), strike: str(i.strikeColor, GEX_COLORS.strike) };
          payload = {
            lines: lv.lines.map((l) => ({ price: l.price, color: col[l.id] || col.strike, text: l.label + ' ' + fmtLevel(l.price) + (l.note || ''), dash: l.id.startsWith('strike') ? 'dotted' : str(i.lineStyle, 'solid') })),
            band: lv.band ? { lo: lv.band.lo, hi: lv.band.hi, color: str(i.emColor, GEX_COLORS.em) } : null,
            labels: i.labels !== false, width: Math.min(4, Math.max(1, Math.round(num(i.width, 1)))),
            status: agoText(dataTime(data)) + ' · ' + src.label + ' ' + (dte === 0 ? '0DTE' : dte + 'DTE') + (data.stale ? ' · last saved copy' : '')
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
function gexLayer() {
  let canvas = null, chip = null, last = '';
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
        g.strokeStyle = l.color; g.lineWidth = d.width || 1;
        g.setLineDash(l.dash === 'dashed' ? [6, 4] : l.dash === 'dotted' ? [2, 3] : []);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        if (d.labels) tags.push({ y, l });
      }
      g.setLineDash([]);
      // Right-edge tags; nudged apart so close levels stay readable.
      tags.sort((p, q) => p.y - q.y);
      let prev = -Infinity;
      for (const t of tags) {
        const h = 16, w = Math.ceil(g.measureText(t.l.text).width) + 10;
        let yc = Math.max(t.y, prev + h + 1);
        yc = Math.min(yc, bot - h / 2);
        prev = yc;
        const x = Math.max(2, W - w - 2);
        g.fillStyle = t.l.color;
        g.fillRect(x, yc - h / 2, w, h);
        g.fillStyle = '#0b0b0b';
        g.fillText(t.l.text, x + 5, yc + 0.5);
      }
      g.restore();
      // Price tags on the right price axis (outside the plot clip), at the exact line price.
      const axW = fullW - W;
      if (axW > 24) {
        g.save();
        g.beginPath(); g.rect(W, top, axW, a.bounds.height); g.clip();
        g.font = font; g.textBaseline = 'middle';
        for (const t of tags) {
          g.fillStyle = t.l.color;
          g.fillRect(W + 1, t.y - 8, axW - 2, 16);
          g.fillStyle = '#0b0b0b';
          g.fillText(fmtLevel(t.l.price), W + 6, t.y + 0.5);
        }
        g.restore();
      }
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
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
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
}
export const GEX_TYPE = TYPE;
export const GEX_DESC = 'Call wall, put wall and zero gamma from the GEX page, drawn on SPX, ES and NQ charts.';
