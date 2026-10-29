// TradeZoro — "Expected Move" chart indicator (native overlay, price pane).
// Owner-approved 2026-10-14 (InsightSentry options analytics). Draws the options-implied expected
// move (ATM straddle) for the chosen expiry as a shaded range box with dashed edge lines and
// right-edge tags, on SPX / SPY / QQQ charts and mapped to ES / MES (from SPX) and NQ / MNQ (from
// QQQ). Data: the book-recorder Worker GET /opt-analytics?u=SPX|QQQ|SPY (computed by
// workers/book-recorder/opt-feeder/opt_feeder.py, edge-cached 60 s; never InsightSentry from the
// browser). Plan: SPX / ES free, QQQ / NQ / SPY Pro (same split as the GEX page panel).
// Bar replay: nothing is drawn (the range is today's, it would leak the future into a replay).
// Status wording: "updated X min ago" only (GEX wording rules). Education only.
// Depends on: Vela plugin SDK (registerNativeIndicator / registerRendererLayer /
// registerStatePersistence) via the legend-row Core of assets/chart-legend-rows.js;
// window.strykerPlanTier (assets/plan-limits.js, optional).

const TYPE = 'stk_em';
const API = 'https://book-recorder.theelitegrey.workers.dev/opt-analytics?u=';
const REFRESH_MS = 5 * 60 * 1000;
const TIER_WAIT_MS = 8000;
const PRICING = '/#pricing';
export const EM_KEYS = ['0DTE', '1DTE', 'Weekly', 'Monthly'];
const COLORS = { '0DTE': '#00adb5', '1DTE': '#4fe3ac', Weekly: '#8b7cf6', Monthly: '#f59e0b' };

const SCHEMA = [
  { key: 'expiry', title: 'Expiry', type: 'string', defval: '0DTE', options: EM_KEYS },
  { key: 'showAll', title: 'Show every expiry', type: 'bool', defval: false },
  { key: 'fill', title: 'Shade the range', type: 'bool', defval: true },
  { key: 'labels', title: 'Labels', type: 'bool', defval: true },
  { key: 'showStatus', title: 'Status', type: 'bool', defval: true },
  { key: 'color', title: 'Colour (single expiry)', type: 'color', defval: '#00adb5' }
];

const str = (v, d) => (typeof v === 'string' && v !== '' ? v : d);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- symbol -> options source ---------------------------------------------------------------
// { u, fut|null, label, pro } or null when the symbol has no options analytics.
export function emSource(symbol, provider) {
  let ticker = String(symbol || ''), prov = String(provider || '');
  const m = /^([a-z_]+):(.+)$/i.exec(ticker);
  if (m) { if (!prov) prov = m[1].toLowerCase(); ticker = m[2]; }
  const root = ticker.toUpperCase().replace(/[0-9]?!$/, '').replace(/^\^/, '');
  if (root === 'ES' || root === 'MES') return { u: 'SPX', fut: 'ES', label: root + ' (from SPX)', pro: false };
  if (root === 'NQ' || root === 'MNQ') return { u: 'QQQ', fut: 'NQ', label: root + ' (from QQQ)', pro: true };
  if (root === 'GC' || root === 'MGC') return { u: 'GLD', fut: 'GC', label: root + ' (from GLD)', pro: true, noData: true };
  if (prov === 'futures') return null;
  if (root === 'SPX' || root === 'SPXW') return { u: 'SPX', fut: null, label: 'SPX', pro: false };
  if (root === 'SPY') return { u: 'SPY', fut: null, label: 'SPY', pro: true };
  if (root === 'QQQ') return { u: 'QQQ', fut: null, label: 'QQQ', pro: true };
  if (root === 'GLD') return { u: 'GLD', fut: null, label: 'GLD', pro: true, noData: true };
  return null;
}

// ---- data -> ranges (pure) --------------------------------------------------------------------
// The same expiry listed as Weekly and Monthly becomes one range named "Weekly / Monthly".
export function buildRanges(data, src, opts) {
  if (!data || !Array.isArray(data.em) || !data.em.length) return { err: 'No expected move yet' };
  const o = opts || {};
  const want = o.showAll ? EM_KEYS : [EM_KEYS.includes(o.expiry) ? o.expiry : '0DTE'];
  const out = [];
  for (const r of data.em) {
    if (!want.includes(r.k)) continue;
    let lo = r.lo, hi = r.hi, em = r.em;
    if (src.fut) {
      if (!r.fut || r.fut.root !== src.fut) continue;
      lo = r.fut.lo; hi = r.fut.hi; em = r.fut.em;
    }
    if (!isNum(lo) || !isNum(hi) || !(hi > lo)) continue;
    const prev = out.find((x) => x.x === r.x && x.lo === lo && x.hi === hi);
    if (prev) { prev.k += ' / ' + r.k; continue; }
    out.push({ k: r.k, x: r.x, lo, hi, em, color: o.showAll ? COLORS[r.k] : str(o.color, COLORS['0DTE']) });
  }
  if (!out.length) return { err: o.showAll ? 'No expected move yet' : 'No ' + want[0] + ' expiry today' };
  return { ranges: out };
}

export function agoText(tsSec, nowMs) {
  if (!isNum(tsSec)) return '';
  const m = Math.max(0, Math.floor(((nowMs || Date.now()) / 1000 - tsSec) / 60));
  if (m < 1) return 'updated just now';
  if (m < 60) return 'updated ' + m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return 'updated ' + h + ' h ago';
  return 'updated ' + Math.floor(h / 24) + ' days ago';
}

export function fmt(v) {
  if (!isNum(v)) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- shared fetch cache (one per underlying) ---------------------------------------------------
const cache = new Map();
const subs = new Set();
const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
function emFetch(u) {
  if (replayOn()) return Promise.resolve(null);
  const e = cache.get(u) || {};
  if (e.p) return e.p;
  if (e.data && Date.now() - e.at < REFRESH_MS - 5000) return Promise.resolve(e.data);
  const p = fetch(API + u, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => {
      const prev = cache.get(u) || {};
      cache.set(u, { data: j || prev.data || null, at: j ? Date.now() : (prev.at || 0), p: null });
      return j || prev.data || null;
    });
  cache.set(u, Object.assign({}, e, { p }));
  return p;
}
let timer = 0;
function tick() {
  if (document.visibilityState === 'hidden') return;
  const us = new Set();
  subs.forEach((n) => { const w = n.want(); if (w) us.add(w); });
  us.forEach((u) => emFetch(u).then(() => subs.forEach((n) => n.refresh())));
  subs.forEach((n) => n.refresh());
}
function startTimer() { if (!timer && subs.size) timer = setInterval(tick, 60 * 1000); }
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopTimer();
    else if (subs.size) { startTimer(); tick(); }
  });
}

let tierP = null;
function planTier() {
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

// ---- the native ----------------------------------------------------------------------------------
function resolveSrc(ctx) {
  let provider = '';
  try { const r = ctx.data.resolve(ctx.symbol); if (r) provider = r.provider; } catch (e) {}
  return emSource(ctx.symbol, provider);
}
class EmNative {
  constructor() { this.inputs = {}; this.ctx = null; this.tier = null; this.sig = ''; }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = inputs || {};
    subs.add(this); startTimer();
    planTier().then((t) => { this.tier = t; this.load(); });
    this.load();
  }
  want() {
    if (!this.ctx || !this.tier || replayOn()) return null;
    const src = resolveSrc(this.ctx);
    if (!src || src.noData || (src.pro && this.tier.free)) return null;
    return src.u;
  }
  load() {
    this.refresh();
    const u = this.want();
    if (u && document.visibilityState !== 'hidden') emFetch(u).then(() => this.refresh());
  }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.refresh(); }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.load(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { subs.delete(this); if (!subs.size) stopTimer(); try { this.ctx.pushData(null); } catch (e) {} }
  refresh() {
    if (!this.ctx) return;
    const src = resolveSrc(this.ctx), i = this.inputs;
    let payload;
    if (replayOn()) payload = { note: 'Expected move is hidden during bar replay' };
    else if (!src) payload = { note: 'Expected move available for SPX, SPY, QQQ, ES, NQ (gold: building history)' };
    else if (!this.tier) payload = { note: 'Loading expected move…' };
    else if (src.pro && this.tier.free) payload = { pill: 'Unlock ' + (src.u === 'QQQ' ? 'NQ / QQQ' : src.u === 'GLD' ? 'gold' : src.u) + ' expected move with Pro', href: PRICING };
    else if (src.noData) payload = { note: 'Gold expected move: building history. GEX levels show the IV bands.' };
    else {
      const e = cache.get(src.u), data = e && e.data;
      if (!data) payload = { note: 'Loading expected move…' };
      else {
        const b = buildRanges(data, src, i);
        if (b.err) payload = { note: b.err };
        else payload = {
          ranges: b.ranges, fill: i.fill !== false, labels: i.labels !== false, showStatus: i.showStatus !== false,
          status: 'Expected move ' + agoText(data.t) + ' · ' + src.label
        };
      }
    }
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (e) {}
  }
}

// ---- renderer layer ------------------------------------------------------------------------------
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function emLayer() {
  let canvas = null, chip = null, last = '';
  function paintChip(d, bottomPx) {
    if (!chip && canvas && canvas.parentElement) {
      chip = document.createElement('div');
      chip.className = 'stk-gex-chip stk-em-chip';
      chip.hidden = true;
      canvas.parentElement.appendChild(chip);
    }
    if (!chip) return;
    const k = d ? JSON.stringify([d.note, d.pill, d.showStatus === false ? '' : d.status, bottomPx]) : '';
    if (k === last) return;
    last = k;
    if (!d || !(d.note || d.pill || (d.showStatus !== false && d.status))) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.style.right = 'auto'; chip.style.left = '8px';
    // one row above the GEX chip, so both can be on the same chart
    chip.style.bottom = (bottomPx + 24) + 'px';
    chip.textContent = '';
    if (d.pill) {
      const a = document.createElement('a');
      a.className = 'stk-gex-pill'; a.href = d.href || PRICING; a.textContent = d.pill;
      chip.appendChild(a);
    } else {
      chip.classList.toggle('is-note', !!d.note);
      chip.appendChild(document.createTextNode(d.note || d.status));
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
      const fullH = canvas.height / dpr;
      paintChip(d, Math.max(0, fullH - (a.bounds.top + a.bounds.height)) + 8);
      canvas.__stkEm = [];
      if (!d || !d.ranges) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = a.coords.width, top = a.bounds.top, H = a.bounds.height;
      const Y = (p) => a.coords.priceToY(p, a.scale, a.bounds);
      g.save();
      g.beginPath(); g.rect(0, top, W, H); g.clip();
      g.font = '600 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
      g.textBaseline = 'middle';
      for (const r of d.ranges) {
        const yHi = Math.round(Y(r.hi)) + 0.5, yLo = Math.round(Y(r.lo)) + 0.5;
        canvas.__stkEm.push({ k: r.k, lo: r.lo, hi: r.hi, yHi, yLo });
        if (d.fill) { g.fillStyle = hexA(r.color, d.ranges.length > 1 ? 0.04 : 0.07); g.fillRect(0, Math.min(yHi, yLo), W, Math.abs(yLo - yHi)); }
        g.strokeStyle = hexA(r.color, 0.85); g.lineWidth = 1; g.setLineDash([6, 4]);
        [yHi, yLo].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); });
        g.setLineDash([]);
        if (d.labels) {
          [[yHi, 'EM ' + r.k + ' +' + fmt(r.em) + '  ' + fmt(r.hi)], [yLo, 'EM ' + r.k + ' −' + fmt(r.em) + '  ' + fmt(r.lo)]].forEach(([y, t]) => {
            if (y < top || y > top + H) return;
            const w = Math.ceil(g.measureText(t).width) + 10;
            // left of the right edge: the GEX tags sit at the right edge
            const x = Math.max(2, W - w - 140);
            g.fillStyle = hexA(r.color, 0.9); g.fillRect(x, y - 8, w, 16);
            g.fillStyle = '#0b0b0b'; g.fillText(t, x + 5, y + 0.5);
          });
        }
      }
      g.restore();
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
  };
}

// ---- registration + persistence ------------------------------------------------------------------
const PERSIST_KEY = 'stryker.em';
let installed = false;
export function installExpectedMove(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: TYPE, placement: 'above-data', create: emLayer });
  Core.registerNativeIndicator({
    type: TYPE, title: 'TradeZoro Expected Move', shortTitle: 'Expected Move', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new EmNative(),
    legendNote: (d) => (d ? (d.pill || d.note || String(d.status || '').replace(/^Expected move /, '')) : '')
  });
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
export const EM_TYPE = TYPE;
export const EM_DESC = 'Options-implied expected move (ATM straddle) for 0DTE, 1DTE, weekly and monthly, on SPX, SPY, QQQ, ES and NQ charts (gold: building history).';
