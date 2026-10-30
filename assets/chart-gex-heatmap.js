// TradeZoro — Charts: "TradeZoro GEX Heatmap" indicator (charts.html) — ES module
// Owner-approved 2026-10-14 (GEX heatmap + history). Own design, own colours.
//
// Depends on: assets/gex-heat-core.js (window.StrykerGexHeat: history fetch, base image, colour
// ramp; imported here for its side effect), assets/chart-gex-levels.js (gexSource symbol mapping,
// gexTier plan, gexFetch for the API's NQ/QQQ ratio), Vela 0.6.17 plugin SDK passed in as Core
// (registerNativeIndicator via chart-legend-rows legendCore, registerRendererLayer,
// registerStatePersistence).
//
// WHAT IT DRAWS: behind the candles of the main price pane, the net GEX at every strike (rows)
// for every 2-min snapshot the recorder kept (columns): mint/teal ramp for positive, red/magenta
// for negative, transparent near zero. Opacity is a setting.
//
// SYMBOLS (same mapping as the GEX Levels indicator):
//   SPX / SPY / QQQ          -> that market's own strikes, as recorded.
//   ES / MES                 -> SPX strikes, ratio 1 (the engine's kFixed) + basis.
//   NQ / MNQ                 -> QQQ strikes x the API's NQ ratio (futures.NQ.ratio, NDX/QQQ) + basis;
//                               before the API answered, the last ratio seen on this device, else
//                               the plain futures/spot ratio.
//   Re-anchor: the basis is taken PER SNAPSHOT from this chart's own bars:
//     basis(t) = chart close of the bar at the snapshot's chain time - ratio x spot(t)
//   so the heat follows the futures the chart draws, with no lag from a separate futures quote.
//
// PLAN: Free = SPX-family (SPX, ES, MES) at 0DTE; everything else Pro (pill to /#pricing), the
// same rule as the GEX page and the GEX Levels indicator.
//
// PERFORMANCE: the history is turned into one tiny offscreen image per session (gex-heat-core
// build(): one pixel per 2-min slot x strike row). It is rebuilt only when new snapshots land, the
// days/expiry/opacity change, or the bar replay clock passes a new snapshot. Each frame draws one
// drawImage per visible 2-min column (the chart's time axis is bar-indexed, so columns cannot be
// stretched as one image); no network, DOM or layout reads per frame. canvas.__stkGexHeatMs keeps
// the last frame time for the tests (budget 8 ms).
//
// BAR REPLAY (window.__stkReplay, assets/chart-bar-replay.js; read only): while replay is on the
// heat is built only from snapshots with chain time <= the replay clock (no lookahead) and the
// history request ends at the replay clock. Before the history begins the chart reads
// "No GEX history for this time".
//
// Wording: "updated X min ago" only. Education only. Not financial advice.
import './gex-heat-core.js?v=748';
import { gexSource, gexTier, gexFetch } from './chart-gex-levels.js?v=748';

const TYPE = 'stk_gexheat';
const PRICING = '/#pricing';
const DAY_S = 86400;
const POLL_MS = 2 * 60 * 1000;
const K_KEY = 'stryker_gex_heat_k';
const G1 = 'GEX heatmap';
const SCHEMA = [
  { key: 'dte', title: 'Expiry (Pro: 1DTE)', type: 'string', defval: '0', options: ['0', '1'], group: G1 },
  { key: 'days', title: 'Sessions shown', type: 'int', defval: 3, min: 1, max: 5, step: 1, group: G1 },
  { key: 'opacity', title: 'Opacity', type: 'float', defval: 0.55, min: 0.1, max: 1, step: 0.05, group: G1 },
  { key: 'showStatus', title: 'Status note', type: 'bool', defval: true, group: G1 }
];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const H = () => window.StrykerGexHeat;
const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
const replayNowS = () => (replayOn() ? Math.floor(window.__stkReplay.E / 1000) : null);

// ---- pure helpers (exported for tests) ------------------------------------------------------
// The futures ratio for a source: ES/MES 1 (SPX kFixed), NQ/MNQ the API's ratio, else null.
export function futRatio(src, apiData) {
  if (!src || !src.fut) return null;
  if (src.api === 'SPX') return 1;
  const f = apiData && apiData.futures && apiData.futures[src.fut];
  return f && isNum(f.ratio) && f.ratio > 0 ? f.ratio : null;
}
// bars [{time ms, close}] sorted; returns the close of the last bar opened at or before tSec,
// within maxGapS of it, else null.
export function closeAt(bars, tSec, maxGapS) {
  let lo = 0, hi = bars.length - 1, best = -1;
  const tm = tSec * 1000;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= tm) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0) return null;
  if ((tm - bars[best].time) / 1000 > maxGapS) return null;
  const c = bars[best].close;
  return isNum(c) ? c : null;
}
// Per-snapshot conversion strike -> chart price: { mul, add } for each row (null = no bar to anchor).
export function conversions(rows, src, ratio, bars, tfSec) {
  if (!src.fut) return rows.map(() => ({ mul: 1, add: 0 }));
  const gap = Math.max(180, (tfSec || 60) + 120);
  return rows.map((r) => {
    const c = bars && bars.length ? closeAt(bars, r.t, gap) : null;
    if (!isNum(c) || !isNum(r.s) || r.s <= 0) return null;
    const k = isNum(ratio) ? ratio : c / r.s;
    return { mul: k, add: c - k * r.s };
  });
}
// The rows a frame may use: every row with t <= until (no lookahead).
export function upTo(rows, until) {
  if (until == null) return rows;
  let n = rows.length;
  while (n && rows[n - 1].t > until) n--;
  return n === rows.length ? rows : rows.slice(0, n);
}
function tfSeconds(tf) {
  const s = String(tf || '');
  if (/^\d+$/.test(s)) return +s * 60;
  const m = /^(\d+)([SHDWM])$/i.exec(s);
  if (m) return +m[1] * ({ S: 1, H: 3600, D: DAY_S, W: 7 * DAY_S, M: 30 * DAY_S }[m[2].toUpperCase()]);
  if (/^[DWM]$/i.test(s)) return { D: DAY_S, W: 7 * DAY_S, M: 30 * DAY_S }[s.toUpperCase()];
  return 60;
}
function agoText(sec) {
  if (!isNum(sec)) return '';
  const min = Math.max(0, Math.floor((Date.now() / 1000 - sec) / 60));
  if (min < 1) return 'updated just now';
  if (min < 120) return 'updated ' + min + ' min ago';
  const h = Math.floor(min / 60);
  return h < 48 ? 'updated ' + h + ' h ago' : 'updated ' + Math.floor(h / 24) + ' days ago';
}
function loadK() { try { return JSON.parse(localStorage.getItem(K_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveK(fut, k) { try { const o = loadK(); o[fut] = k; localStorage.setItem(K_KEY, JSON.stringify(o)); } catch (e) {} }

// ---- history per underlying + expiry (shared by every chart cell) ---------------------------
// key -> { rows (oldest first), from, to, at, p, sessions }
const store = new Map();
const subs = new Set();
function hkey(api, dte) { return api + ':' + dte; }
// Make sure rows cover [from, to]; returns a promise of the entry. Live: appends new snapshots
// every 2 min. Replay: `to` is the replay clock (a request never asks past it).
function ensure(api, dte, days, toSec) {
  const k = hkey(api, dte);
  let e = store.get(k);
  if (!e) { e = { rows: [], from: Infinity, to: 0, at: 0, p: null, sessions: null, sesAt: 0 }; store.set(k, e); }
  if (e.p) return e.p;
  const live = toSec == null, nowS = Math.floor(Date.now() / 1000);
  // Replay: fetch in 4-hour blocks ahead of the clock (the frames only ever use rows <= the clock,
  // upTo() below), so stepping does not hit the network every bar.
  if (!live && e.to && toSec <= e.to && toSec >= e.from) return Promise.resolve(e);
  const to = live ? nowS : Math.min(nowS, Math.ceil((toSec + 4 * 3600) / 7200) * 7200);
  const core = H();
  const ses = (!e.sessions || Date.now() - e.sesAt > 10 * 60000) ? core.sessions(api, dte).catch(() => []) : Promise.resolve(e.sessions);
  e.p = ses.then((list) => {
    e.sessions = Array.isArray(list) ? list : []; e.sesAt = Date.now();
    // the first `days` sessions that start at or before `to`, newest first
    const before = e.sessions.filter((s) => s.t0 <= (live ? to : toSec)).slice(0, days);
    if (!before.length) return e;
    const from = Math.max(before[before.length - 1].t0, to - 8 * DAY_S + 60);
    const jobs = [];
    if (from < e.from) jobs.push([from, Math.min(to, e.from === Infinity ? to : e.from - 1)]);
    if (e.to && to > e.to && (live ? Date.now() - e.at > POLL_MS - 5000 : true)) jobs.push([Math.max(e.to + 1, from), to]);
    if (!e.to && !jobs.length) jobs.push([from, to]);
    if (!jobs.length) return e;
    return Promise.all(jobs.map(([a, b]) => core.history(api, dte, a, b).catch(() => null))).then((parts) => {
      const byT = new Map(e.rows.map((r) => [r.t, r]));
      parts.forEach((rs) => (rs || []).forEach((r) => byT.set(r.t, r)));
      e.rows = [...byT.values()].sort((a, b) => a.t - b.t);
      if (e.rows.length > 2500) e.rows = e.rows.slice(-2500);
      e.from = Math.min(e.from, from); e.to = Math.max(e.to, to); e.at = Date.now(); e.ver = (e.ver || 0) + 1;
      return e;
    });
  }).catch(() => e).then((x) => { e.p = null; return x; });
  return e.p;
}
let timer = 0;
function tick() {
  if (document.visibilityState === 'hidden' || replayOn()) return;
  subs.forEach((n) => n.poll());
}
function startTimer() { if (!timer && subs.size) timer = setInterval(tick, 30000); }
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }

// ---- the native indicator ------------------------------------------------------------------
function resolveSrc(ctx) {
  let provider = '';
  try { const r = ctx.data.resolve(ctx.symbol); if (r) provider = r.provider; } catch (e) {}
  return gexSource(ctx.symbol, provider);
}
let uid = 0;
class HeatNative {
  constructor() { this.id = ++uid; this.inputs = {}; this.ctx = null; this.tier = null; this.sig = ''; this.heat = null; this.ratio = null; }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = inputs || {};
    subs.add(this); startTimer();
    gexTier().then((t) => { this.tier = t; this.load(); });
    this.load();
  }
  opt(k) { const s = SCHEMA.find((x) => x.key === k); const v = this.inputs[k]; return v === undefined || v === null || v === '' ? s.defval : v; }
  dte() { return this.tier && this.tier.free ? 0 : (String(this.opt('dte')) === '1' ? 1 : 0); }
  days() { const d = Math.round(Number(this.opt('days'))); return d >= 1 && d <= 5 ? d : 3; }
  locked(src) { return !!(src && this.tier && this.tier.free && src.pro); }
  load() {
    const src = this.ctx && resolveSrc(this.ctx);
    this.build();
    if (!src || !this.tier || this.locked(src) || document.visibilityState === 'hidden' || !H()) return;
    const dte = this.dte(), rp = replayNowS();
    if (src.fut && src.api !== 'SPX' && !rp) gexFetch(src.api, 0).then((d) => { const k = futRatio(src, d); if (k) { this.ratio = k; saveK(src.fut, k); this.build(); } }).catch(() => {});
    ensure(src.api, dte, this.days(), rp).then(() => this.build());
  }
  poll() { this.load(); }
  onBars() {
    const s = String(this.ctx && this.ctx.symbol) + '|' + (this.ctx && this.ctx.timeframe);
    if (s !== this.lastSym) { this.lastSym = s; this.load(); return; }
    // replay: a step may pass a new snapshot (or need more history)
    const rp = replayNowS();
    if (rp != null && rp !== this.lastRp) { this.lastRp = rp; this.load(); return; }
    if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.build(); }, 400);
  }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.load(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { subs.delete(this); if (!subs.size) stopTimer(); if (this.tm) clearTimeout(this.tm); try { this.ctx.pushData(null); } catch (e) {} }
  // Turn the stored rows into per-session images + per-column conversions; push when changed.
  build() {
    if (!this.ctx) return;
    const src = resolveSrc(this.ctx);
    let payload;
    const core = H();
    if (!src) payload = { note: 'GEX heatmap available for SPX, SPY, QQQ, ES, NQ and gold (GC)' };
    else if (!core) payload = { note: 'GEX heatmap could not load' };
    else if (!this.tier) payload = { note: 'Loading GEX heatmap…' };
    else if (this.locked(src)) payload = { pill: 'Unlock ' + (src.api === 'QQQ' ? 'NQ' : src.api === 'GLD' ? 'gold' : src.api) + ' GEX heatmap with Pro', href: PRICING };
    else {
      const dte = this.dte(), e = store.get(hkey(src.api, dte));
      const rp = replayNowS();
      const rows = e ? upTo(e.rows, rp) : [];
      const label = (src.fut ? src.fut + ' (from ' + src.api + ')' : src.api) + ' ' + (dte ? '1DTE' : '0DTE');
      if (!e || (!e.to && e.p)) payload = { note: 'Loading GEX heatmap…' };
      else if (!rows.length) payload = { note: rp != null ? 'No GEX history for this time' : (src.api === 'GLD' ? 'Gold GEX heatmap: building history, first columns appear within minutes of the next session · ' : 'No GEX history recorded yet · ') + label };
      else {
        let bars = [];
        try { bars = this.ctx.bars() || []; } catch (err) {}
        const k = src.fut ? (this.ratio || (src.api === 'SPX' ? 1 : loadK()[src.fut]) || null) : null;
        const conv = conversions(rows, src, k, bars, tfSeconds(this.ctx.timeframe));
        const op = Math.max(0.1, Math.min(1, Number(this.opt('opacity')) || 0.55));
        const ver = [src.api, dte, e.ver, rows.length, rows[rows.length - 1].t].join('|');
        if (!this.heat || this.heat.ver !== ver) this.heat = { ver, imgs: buildDays(rows, rp) };
        const convSig = conv.map((c) => (c ? c.mul.toFixed(4) + ',' + c.add.toFixed(2) : '-')).join(';');
        const last = rows[rows.length - 1];
        payload = {
          heatId: this.id, ver, convSig, opacity: op,
          showStatus: this.opt('showStatus') !== false,
          status: 'GEX heatmap · ' + label + (rp != null ? ' · as of replay time' : ' · ' + agoText(last.fa || last.t)),
          unanchored: src.fut ? conv.filter((c) => !c).length : 0
        };
        heats.set(this.id, { imgs: this.heat.imgs, rows, conv });
      }
    }
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (err) {}
  }
}
// id -> { imgs: [{ heat, rows }], rows, conv } read by the layer (no copies through pushData)
const heats = new Map();
// one base image per ET session, colour scale shared by all shown days
function buildDays(rows, until) {
  const core = H();
  const byDay = new Map();
  rows.forEach((r) => { const d = r.day || core.etDay(r.t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); });
  const all = [];
  rows.forEach((r) => r.g.forEach((v) => { if (isNum(v)) all.push(Math.abs(v)); }));
  all.sort((a, b) => a - b);
  const vmax = all.length ? all[Math.min(all.length - 1, Math.floor(all.length * 0.995))] || 1 : 1;
  const out = [];
  byDay.forEach((rs, day) => {
    const w = core.sessionWindow(day);
    const heat = core.build(rs, { x0: Math.min(w.x0, Math.floor(rs[0].t / core.SLOT) * core.SLOT), x1: Math.max(w.x1, rs[rs.length - 1].t + core.SLOT), overlay: true, vmax, until: until == null ? undefined : until });
    if (heat) out.push({ heat, rows: rs });
  });
  return out;
}

// ---- renderer layer ----------------------------------------------------------------------------
function heatLayer() {
  let canvas = null;
  return {
    mount(cv) { canvas = cv; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const t0 = performance.now();
      const dpr = a.coords.dpr || 1;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data;
      if (!d) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const co = a.coords, W = co.width, top = a.bounds.top, bh = a.bounds.height;
      const Y = (p) => co.priceToY(p, a.scale, a.bounds);
      let cols = 0;
      const h = d.heatId ? heats.get(d.heatId) : null;
      if (h) {
        g.save();
        g.beginPath(); g.rect(0, top, W, bh); g.clip();
        g.imageSmoothingEnabled = false;
        g.globalAlpha = d.opacity;
        const core = H();
        let ri = 0;   // walk the rows in time order alongside the columns
        for (const im of h.imgs) {
          const ht = im.heat;
          const xa = co.timeToX(ht.x0 * 1000), xb = co.timeToX((ht.x0 + ht.cols * ht.slot) * 1000);
          if (!(xb >= 0 && xa <= W)) continue;
          for (let c = 0; c < ht.cols; c++) {
            const t = ht.x0 + c * ht.slot;
            const x0 = co.timeToX(t * 1000), x1 = co.timeToX((t + ht.slot) * 1000);
            if (!(x1 > 0) || x0 > W || !(x1 > x0)) continue;
            // the snapshot this column stands for (latest t <= column end) -> its conversion
            while (ri + 1 < h.rows.length && h.rows[ri + 1].t < t + ht.slot) ri++;
            while (ri > 0 && h.rows[ri].t >= t + ht.slot) ri--;
            const cv = h.conv[ri];
            if (!cv || h.rows[ri].t < t - core.SLOT * 3) continue;
            const yT = Y((ht.kTop + ht.step / 2) * cv.mul + cv.add), yB = Y((ht.kMin - ht.step / 2) * cv.mul + cv.add);
            if (!isFinite(yT) || !isFinite(yB)) continue;
            g.drawImage(ht.canvas, c, 0, 1, ht.rowsN, x0, yT, Math.max(1, x1 - x0 + 0.5), yB - yT);
            cols++;
          }
        }
        g.restore();
      }
      // status / note / pill: a small tag at the top-left of the plot, under the legend rows
      const text = d.pill || (d.note && !document.documentElement.hasAttribute('data-stk-rh') ? d.note : '') || (d.showStatus ? d.status : '');
      if (text) {
        g.font = '600 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
        g.textBaseline = 'middle';
        const w = Math.ceil(g.measureText(text).width) + 12, y = top + bh - 52;
        g.fillStyle = d.pill ? 'rgba(20,184,166,.92)' : 'rgba(11,14,17,.78)';
        g.fillRect(8, y, w, 18);
        g.fillStyle = d.pill ? '#05110f' : '#c9d1d9';
        g.fillText(text, 14, y + 9.5);
      }
      const ms = performance.now() - t0;
      canvas.__stkGexHeat = { ms, cols, text };   // test hook (plain property, no DOM write)
    },
    destroy() { canvas = null; }
  };
}

// ---- registration + persistence ------------------------------------------------------------
const PERSIST_KEY = 'stryker.gexheat';
let installed = false;
export function installGexHeatmap(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: TYPE, placement: 'below-data', create: heatLayer });
  Core.registerNativeIndicator({
    type: TYPE, title: 'TradeZoro GEX Heatmap', shortTitle: 'GEX Heatmap', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new HeatNative(),
    legendNote: (d) => (!d ? '' : d.pill || d.note || String(d.status || '').replace(/^GEX heatmap · /, ''))
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
      payload.slice(0, 2).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
  try { window.__stkGexHeat = { store, heats, upTo, closeAt, conversions }; } catch (e) {}   // test hook (read only)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopTimer(); else if (subs.size) { startTimer(); tick(); } });
  }
}
export const GEX_HEAT_TYPE = TYPE;
// test hooks
export const _test = { store, heats, ensure };
