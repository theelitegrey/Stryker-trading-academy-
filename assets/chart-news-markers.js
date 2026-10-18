// TradeZoro — Charts: "News markers" and "Economic events" indicators (ES module, charts.html).
// Owner-approved 2026-10-14 (news + economic calendar job, parts A2 and B2). Pro (plan-lock):
// Free members see an "Unlock with Pro" pill instead of the markers.
//
// NEWS MARKERS (native 'stk_news'): a small icon along the bottom of the price pane at each bar
// that had headlines for the chart's market (feed tags from assets/chart-news.js newsSymOf: NQ,
// ES, YM, GC, SI, CL, BTC, ETH; the server adds the macro news that moves each). Hover (desktop)
// shows the headlines; a tap/click opens a small list whose rows open the article at its source.
//
// ECONOMIC EVENTS (native 'stk_econ'): a dashed vertical line + label at each high-impact release
// (CPI, FOMC, NFP, GDP, PCE...) for the chosen countries (US by default), plus a warning chip in
// the chart header when the next one is close ("CPI in 12 min").
//
// BAR REPLAY (window.__stkReplay): nothing published after the replay clock is drawn. News after
// the clock is dropped (the request also carries to=<clock>); economic events after the clock are
// not drawn and never show an actual value; the warning chip counts down to the next scheduled
// release from the replay clock (the release TIME is public in advance; the number is not shown).
//
// DATA: book-recorder /news and /cal (edge-cached; the server feeder is the only caller of the
// vendor). Education only. Not financial advice.

import { RECORDER, newsSymOf, fetchNews, replayNow } from './chart-news.js?v=593';

const PRICING = '/#pricing';
const NEWS_TYPE = 'stk_news', ECON_TYPE = 'stk_econ';
const NEWS_POLL = 120000, CAL_POLL = 15 * 60000;

// ---- pure helpers (unit-tested: tools/tests/chart-news-unit.mjs) ------------------------------
// News items -> one marker per bar bucket at or before the cut-off (epoch ms; 0 = live).
// items: [{t (s), h, s, u, m}], tfMs: bar length. Newest headline first in each bucket.
export function bucketNews(items, tfMs, cutMs) {
  const by = new Map();
  for (const x of items || []) {
    const ms = x.t * 1000;
    if (cutMs && ms > cutMs) continue;
    const k = Math.floor(ms / tfMs) * tfMs;
    let b = by.get(k);
    if (!b) by.set(k, b = { t: k, items: [] });
    b.items.push(x);
  }
  const out = [...by.values()].sort((a, b) => a.t - b.t);
  out.forEach((b) => b.items.sort((p, q) => q.t - p.t));
  return out;
}
const SHORT = [
  [/\b(core )?(cpi|inflation rate)\b/i, (m) => (m[1] ? 'Core CPI' : 'CPI')],
  [/\bpce\b/i, () => 'PCE'], [/\bppi\b/i, () => 'PPI'],
  [/non.?farm payrolls|\bnfp\b/i, () => 'NFP'],
  [/fomc|fed interest rate decision|fed funds/i, () => 'FOMC'],
  [/\bgdp\b/i, () => 'GDP'], [/retail sales/i, () => 'Retail sales'],
  [/jobless claims/i, () => 'Jobless claims'], [/unemployment rate/i, () => 'Unemployment'],
  [/ism (manufacturing|services)/i, (m) => 'ISM ' + m[1].toLowerCase()], [/jolts/i, () => 'JOLTS'],
  [/michigan.*sentiment/i, () => 'UMich sentiment'], [/crude oil inventories|eia/i, () => 'EIA crude'],
  [/ecb.*rate|interest rate decision/i, (m) => null]
];
export function shortName(title, country) {
  const t = String(title || '');
  for (const [re, f] of SHORT) { const m = re.exec(t); if (m) { const v = f(m); if (v) return (country && country !== 'US' ? country + ' ' : '') + v; } }
  return (country && country !== 'US' ? country + ' ' : '') + (t.length > 26 ? t.slice(0, 25) + '…' : t);
}
export const COUNTRY_SETS = { 'US': ['US'], 'US + EU, UK, JP, CN': ['US', 'EU', 'EA', 'DE', 'GB', 'UK', 'JP', 'CN'] };
// Calendar rows -> the events this indicator draws (replay-safe: after the cut there is no actual).
export function pickEvents(rows, o) {
  const lv = o.level === 'High + medium' ? ['high', 'medium'] : ['high'];
  const cs = COUNTRY_SETS[o.countries] || COUNTRY_SETS.US;
  const cut = o.cutMs || 0;
  const out = [];
  for (const e of rows || []) {
    if (!lv.includes(e.i) || !cs.includes(e.c)) continue;
    const ev = { t: e.t, c: e.c, i: e.i, ti: e.ti, n: shortName(e.ti, e.c), f: e.f, p: e.p, u: e.u, sc: e.sc };
    if (!cut || e.t <= cut) { if (e.a !== undefined) ev.a = e.a; }
    out.push(ev);
  }
  return out.sort((a, b) => a.t - b.t);
}
// The warning chip: the next event within `mins` minutes of `nowMs`, or null.
export function nextWarning(evs, nowMs, mins) {
  const lim = nowMs + mins * 60000;
  const nx = (evs || []).filter((e) => e.t > nowMs && e.t <= lim);
  if (!nx.length) return null;
  const t = nx[0].t, same = nx.filter((e) => e.t === t);
  const m = Math.max(1, Math.ceil((t - nowMs) / 60000));
  const names = [...new Set(same.map((e) => e.n))];
  return { t, text: names.slice(0, 2).join(' + ') + (names.length > 2 ? ' +' + (names.length - 2) : '') + ' in ' + (m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min') };
}

// ---- plan tier (same rule as chart-gex-levels.js) ---------------------------------------------
let tierP = null;
function tier() {
  if (tierP) return tierP;
  tierP = new Promise((resolve) => {
    const t = setTimeout(() => resolve({ free: true, unknown: true }), 8000);
    try {
      if (typeof window.strykerPlanTier !== 'function') { clearTimeout(t); resolve({ free: true, unknown: true }); return; }
      window.strykerPlanTier().then((r) => { clearTimeout(t); resolve(r || { free: true }); }, () => { clearTimeout(t); resolve({ free: true }); });
    } catch (e) { clearTimeout(t); resolve({ free: true }); }
  });
  return tierP;
}
// Test hook: force a tier (tools/tests/chart-news-browser.js).
export function _setTier(v) { tierP = Promise.resolve(v); }

// ---- shared calendar cache --------------------------------------------------------------------
let calP = null, calAt = 0;
function calendar() {
  if (calP && Date.now() - calAt < CAL_POLL) return calP;
  calAt = Date.now();
  calP = fetch(RECORDER + '/cal?kind=events', { credentials: 'omit' }).then((r) => (r.ok ? r.json() : { items: [] })).then((j) => j.items || [])
    .catch(() => { calAt = 0; return []; });
  return calP;
}

// ---- natives ----------------------------------------------------------------------------------
const subs = new Set();
let timer = 0;
function startTimer() { if (!timer) timer = setInterval(() => { if (!document.hidden) subs.forEach((n) => n.tick()); }, 3000); }
function stopTimer() { if (timer && !subs.size) { clearInterval(timer); timer = 0; } }

class Base {
  constructor(kind) { this.kind = kind; this.inputs = {}; this.ctx = null; this.tier = null; this.sig = ''; this.lastLoad = 0; this.lastCutMin = -1; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs || {}; subs.add(this); startTimer(); tier().then((t) => { this.tier = t; this.load(true); }); this.refresh(); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(true); } else this.refresh(); }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.load(true); }
  suspend() {}
  resume() { this.sig = ''; this.load(true); }
  stop() { subs.delete(this); stopTimer(); try { this.ctx.pushData(null); } catch (e) {} }
  tick() {
    const rn = replayNow();
    const m = rn ? Math.floor(rn / 60000) : -1;
    if (m !== this.lastCutMin) { this.lastCutMin = m; this.load(true); return; }
    if (Date.now() - this.lastLoad > (this.kind === 'news' ? NEWS_POLL : 60000)) this.load(false);
    else if (this.kind === 'econ') this.refresh();   // countdown chip
  }
  push(payload) { const sig = JSON.stringify(payload); if (sig === this.sig) return; this.sig = sig; try { this.ctx.pushData(payload); } catch (e) {} }
}
class NewsNative extends Base {
  constructor() { super('news'); this.items = []; this.fs = ''; }
  load() {
    this.lastLoad = Date.now();
    if (!this.ctx || !this.tier) return this.refresh();
    if (this.tier.free) return this.refresh();
    const fs = newsSymOf(this.ctx.symbol);
    this.fs = fs;
    if (!fs) { this.items = []; return this.refresh(); }
    const rn = replayNow();
    fetchNews({ sym: fs, limit: 300, to: rn ? Math.floor(rn / 60000) * 60 : 0 }).then((r) => { if (fs === this.fs) { this.items = r.items; this.refresh(); } }, () => this.refresh());
  }
  refresh() {
    if (!this.ctx) return;
    if (!this.tier) return this.push({ note: 'Loading news…' });
    if (this.tier.free) return this.push({ pill: 'Unlock News markers with Pro', href: PRICING });
    if (!newsSymOf(this.ctx.symbol)) return this.push({ note: 'News markers: NQ, ES, YM, GC, SI, CL, BTC, ETH' });
    const rn = replayNow();
    this.push({ kind: 'news', cut: rn || 0, color: this.inputs.color || '#00adb5',
      items: this.items.filter((x) => !rn || x.t * 1000 <= rn).map((x) => ({ t: x.t, h: x.h, s: x.s, u: x.u || '' })) });
  }
}
class EconNative extends Base {
  constructor() { super('econ'); this.rows = []; }
  load() {
    this.lastLoad = Date.now();
    if (!this.ctx || !this.tier || this.tier.free) return this.refresh();
    calendar().then((rows) => { this.rows = rows; this.refresh(); });
  }
  refresh() {
    if (!this.ctx) return;
    if (!this.tier) return this.push({ note: 'Loading economic events…' });
    if (this.tier.free) return this.push({ pill: 'Unlock Economic events with Pro', href: PRICING });
    const rn = replayNow();
    const i = this.inputs;
    const all = pickEvents(this.rows, { level: i.level, countries: i.countries, cutMs: rn });
    const now = rn || Date.now();
    const warnMin = Math.max(0, Math.min(240, Number(i.warn) || 30));
    const w = i.chip === false ? null : nextWarning(all, now, warnMin);
    // replay: only events at or before the clock are drawn
    const evs = rn ? all.filter((e) => e.t <= rn) : all;
    this.push({ kind: 'econ', cut: rn || 0, evs, chip: w ? w.text : '', color: i.color || '#f23645', medColor: '#ff9800', labels: i.labels !== false });
  }
}

// ---- renderer layer -----------------------------------------------------------------------------
const hits = new WeakMap();   // canvas -> [{x, y, r, kind, data}]
function layer() {
  let canvas = null, chip = null, chipKey = '';
  function setChip(d, a) {
    if (!canvas || !canvas.parentElement) return;
    const want = d && (d.pill || d.note || d.chip);
    const k = want ? JSON.stringify([d.pill, d.note, d.chip, d.kind]) : '';
    if (k === chipKey) return;
    chipKey = k;
    if (!want) { if (chip) chip.hidden = true; return; }
    if (!chip) { chip = document.createElement('div'); chip.className = 'stk-nm-chip'; canvas.parentElement.appendChild(chip); }
    chip.hidden = false; chip.textContent = '';
    chip.classList.toggle('is-warn', !!d.chip && !d.pill && !d.note);
    chip.dataset.kind = d.kind || (d.pill && /Economic/.test(d.pill) ? 'econ' : 'news');
    if (d.pill) { const a2 = document.createElement('a'); a2.className = 'stk-nm-pill'; a2.href = d.href || PRICING; a2.textContent = d.pill; chip.appendChild(a2); }
    else chip.textContent = d.chip || d.note;
  }
  return {
    mount(c) { canvas = c; c.dataset.stkNm = '1'; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d');
      const co = a.coords, dpr = co.dpr || 1;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = a.data, boxes = [];
      hits.set(canvas, boxes);
      setChip(d, a);
      if (!d || !d.kind || !a.bars || a.bars.length < 2) return;
      const bars = a.bars;
      const tf = bars[bars.length - 1].time - bars[bars.length - 2].time;
      if (!(tf > 0 && tf <= 86400000)) return;
      const W = co.width, top = a.bounds.top;
      const plotBottom = Math.min(a.bounds.top + a.bounds.height, (co.dataHeight || co.height) - 2);
      const lastBar = bars[bars.length - 1].time;
      g.save(); g.beginPath(); g.rect(0, top, W, plotBottom - top); g.clip();
      if (d.kind === 'news') {
        const y = plotBottom - 24;
        for (const b of bucketNews(d.items, tf, d.cut)) {
          if (b.t > lastBar) continue;                     // never ahead of the last bar
          const x = co.timeToX(b.t);
          if (!Number.isFinite(x) || x < 6 || x > W - 6) continue;
          const xx = Math.round(x) + 0.5;
          g.fillStyle = d.color; g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1;
          g.beginPath(); g.roundRect ? g.roundRect(xx - 6, y - 6, 12, 12, 3) : g.rect(xx - 6, y - 6, 12, 12); g.fill(); g.stroke();
          g.fillStyle = '#04150e';
          if (b.items.length > 1) { g.font = '700 9px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.items.length > 9 ? '9+' : String(b.items.length), xx, y + 0.5); }
          else { g.fillRect(xx - 3, y - 2.5, 6, 1.2); g.fillRect(xx - 3, y - 0.3, 6, 1.2); g.fillRect(xx - 3, y + 1.9, 4, 1.2); }
          boxes.push({ x: xx, y, r: 8, kind: 'news', data: b });
        }
      } else if (d.kind === 'econ') {
        const groups = new Map();
        for (const e of d.evs) { const k = Math.floor(e.t / tf) * tf; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
        g.font = '600 10px system-ui,sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
        const rowEnd = [-Infinity, -Infinity];   // labels never overlap: 2 rows, else the line only
        for (const [k, list] of [...groups].sort((p, q) => p[0] - q[0])) {
          const x = co.timeToX(k);
          if (!Number.isFinite(x) || x < 2 || x > W - 2) continue;
          const xx = Math.round(x) + 0.5;
          const hi = list.some((e) => e.i === 'high');
          const col = hi ? d.color : d.medColor;
          g.strokeStyle = col; g.globalAlpha = k > lastBar ? 0.45 : 0.8; g.lineWidth = 1; g.setLineDash([4, 4]);
          g.beginPath(); g.moveTo(xx, top + 18); g.lineTo(xx, plotBottom); g.stroke(); g.setLineDash([]);
          g.globalAlpha = 1;
          if (d.labels) {
            const names = [...new Set(list.map((e) => e.n))];
            const txt = names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '');
            const tw = Math.ceil(g.measureText(txt).width) + 8;
            const lx = Math.min(W - tw - 2, Math.max(2, xx - tw / 2));
            const row = rowEnd[0] + 3 <= lx ? 0 : rowEnd[1] + 3 <= lx ? 1 : -1;
            if (row >= 0) {
              rowEnd[row] = lx + tw;
              const ly = top + 4 + row * 17;
              g.fillStyle = col; g.fillRect(lx, ly, tw, 14);
              g.fillStyle = '#0b0b0b'; g.fillText(txt, lx + 4, ly + 2);
              boxes.push({ x: lx + tw / 2, y: ly + 7, r: Math.max(9, tw / 2), ry: 9, kind: 'econ', data: list });
            }
          }
          boxes.push({ x: xx, y: plotBottom - 10, r: 7, kind: 'econ', data: list });
        }
      }
      g.restore();
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
  };
}

// ---- hover tooltip + tap popover ---------------------------------------------------------------
let tip = null, pop = null;
const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
function findHit(e) {
  for (const cv of document.querySelectorAll('canvas[data-stk-nm]')) {
    const bx = hits.get(cv);
    if (!bx || !bx.length) continue;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    for (const b of bx) if (Math.abs(b.x - x) <= b.r && Math.abs(b.y - y) <= (b.ry || b.r)) return { b, r };
  }
  return null;
}
function fill(node, h) {
  node.textContent = '';
  const b = h.b;
  if (b.kind === 'news') {
    node.appendChild(Object.assign(document.createElement('b'), { textContent: b.data.items.length + (b.data.items.length === 1 ? ' headline · ' : ' headlines · ') + fmt(b.data.t) }));
    b.data.items.slice(0, 6).forEach((x) => {
      const row = document.createElement(x.u && node === pop ? 'a' : 'div');
      row.className = 'stk-nm-row';
      if (row.tagName === 'A') { row.href = x.u; row.target = '_blank'; row.rel = 'noopener noreferrer'; }
      row.appendChild(Object.assign(document.createElement('span'), { className: 'stk-nm-src', textContent: new Date(x.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + ' · ' + (x.s || '') }));
      row.appendChild(Object.assign(document.createElement('span'), { textContent: x.h }));
      node.appendChild(row);
    });
    if (b.data.items.length > 6) node.appendChild(Object.assign(document.createElement('em'), { textContent: '+' + (b.data.items.length - 6) + ' more in the News panel' }));
  } else {
    node.appendChild(Object.assign(document.createElement('b'), { textContent: fmt(b.data[0].t) }));
    b.data.slice(0, 8).forEach((e) => {
      const row = document.createElement('div'); row.className = 'stk-nm-row';
      const nums = [e.a !== undefined ? 'Actual ' + e.a + (e.u || '') : '', e.f !== undefined ? 'Forecast ' + e.f + (e.u || '') : '', e.p !== undefined ? 'Previous ' + e.p + (e.u || '') : ''].filter(Boolean).join(' · ');
      row.appendChild(Object.assign(document.createElement('span'), { className: 'stk-nm-src', textContent: e.c + ' · ' + (e.i === 'high' ? 'High' : 'Medium') + ' impact' }));
      row.appendChild(Object.assign(document.createElement('span'), { textContent: e.ti }));
      if (nums) row.appendChild(Object.assign(document.createElement('span'), { className: 'stk-nm-num', textContent: nums }));
      node.appendChild(row);
    });
  }
}
function place(node, h) {
  const left = Math.min(window.innerWidth - node.offsetWidth - 8, Math.max(8, h.r.left + h.b.x - 140));
  let top = h.r.top + h.b.y - node.offsetHeight - 12;
  if (top < 8) top = h.r.top + h.b.y + 14;
  node.style.left = left + 'px'; node.style.top = top + 'px';
}
function onMove(e) {
  if (e.pointerType === 'touch') return;
  const h = findHit(e);
  if (!h) { if (tip) tip.hidden = true; return; }
  if (!tip) { tip = document.createElement('div'); tip.className = 'stk-nm-tip'; document.body.appendChild(tip); }
  if (tip.__b !== h.b) { tip.__b = h.b; fill(tip, h); }
  tip.hidden = false; place(tip, h);
}
function onDown(e) {
  if (pop && !pop.hidden && pop.contains(e.target)) return;
  const h = findHit(e);
  if (!h) { if (pop) pop.hidden = true; return; }
  e.stopPropagation(); e.preventDefault();
  if (tip) tip.hidden = true;
  if (!pop) { pop = document.createElement('div'); pop.className = 'stk-nm-tip stk-nm-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Headlines'); document.body.appendChild(pop); }
  fill(pop, h); pop.hidden = false; place(pop, h);
}

const CSS = `
.stk-nm-chip{ position:absolute; top:34px; left:50%; transform:translateX(-50%); z-index:6; pointer-events:none; max-width:70%;
  padding:3px 10px; border-radius:999px; font:600 11.5px/1.3 'JetBrains Mono',ui-monospace,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  background:rgba(19,19,22,.88); color:#9aa0aa; border:1px solid rgba(255,255,255,.08); }
.stk-nm-chip[data-kind="news"]{ top:58px; }
.stk-nm-chip[hidden]{ display:none; }
.stk-nm-chip.is-warn{ color:#fff; background:rgba(242,54,69,.92); border-color:#f23645; }
.stk-nm-pill{ pointer-events:auto; color:#03c988; text-decoration:none; }
.stk-nm-tip{ position:fixed; z-index:9050; pointer-events:none; width:min(320px, calc(100vw - 16px)); display:flex; flex-direction:column; gap:6px;
  background:#131316; color:#e6e7ea; border:1px solid #2e3036; border-radius:8px; padding:8px 10px; font:12px/1.35 Archivo,system-ui,sans-serif;
  box-shadow:0 8px 24px rgba(0,0,0,.5); max-height:60vh; overflow-y:auto; }
.stk-nm-tip[hidden]{ display:none; }
.stk-nm-pop{ pointer-events:auto; }
.stk-nm-tip b{ font-size:11px; color:#9aa0aa; font-weight:600; }
.stk-nm-row{ display:flex; flex-direction:column; gap:1px; color:inherit; text-decoration:none; }
a.stk-nm-row:hover span:last-child{ color:#4fe3ac; }
.stk-nm-src{ font:11px 'JetBrains Mono',ui-monospace,monospace; color:#00adb5; }
.stk-nm-num{ font:11px 'JetBrains Mono',ui-monospace,monospace; color:#9aa0aa; }
.stk-nm-tip em{ font-style:normal; color:#9aa0aa; font-size:11px; }
:root[data-theme="light"] .stk-nm-tip{ background:#fff; color:#131722; border-color:#e0e3eb; }
:root[data-theme="light"] .stk-nm-chip{ background:rgba(255,255,255,.92); color:#555; border-color:#e0e3eb; }
`;

// ---- registration -------------------------------------------------------------------------------
const NEWS_SCHEMA = [
  { key: 'color', title: 'Marker colour', type: 'color', defval: '#00adb5' }
];
const ECON_SCHEMA = [
  { key: 'level', title: 'Impact', type: 'string', defval: 'High', options: ['High', 'High + medium'] },
  { key: 'countries', title: 'Countries', type: 'string', defval: 'US', options: Object.keys(COUNTRY_SETS) },
  { key: 'warn', title: 'Warn before (minutes)', type: 'integer', defval: 30, minval: 0, maxval: 240 },
  { key: 'chip', title: 'Warning chip in the chart header', type: 'bool', defval: true },
  { key: 'labels', title: 'Event labels', type: 'bool', defval: true },
  { key: 'color', title: 'High-impact colour', type: 'color', defval: '#f23645' }
];
export const NEWS_DESC = 'Headline markers on the time axis for the chart’s market; hover or tap to read them (Pro)';
export const ECON_DESC = 'High-impact releases (CPI, FOMC, NFP, GDP…) as dashed lines, with a “CPI in 12 min” warning chip (Pro)';
let installed = false;
export function installNewsMarkers(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: NEWS_TYPE, placement: 'above-data', create: layer });
  Core.registerRendererLayer({ id: ECON_TYPE, placement: 'above-data', create: layer });
  const legend = (d) => (!d ? '' : d.pill || d.note || (d.kind === 'news' ? (d.items.length + ' headlines, 7 days') : (d.chip || d.evs.length + ' events')));
  Core.registerNativeIndicator({ type: NEWS_TYPE, title: 'TradeZoro News markers', shortTitle: 'News', paneHint: 'price', overlay: true,
    inputsSchema: () => NEWS_SCHEMA, defaultInputs: () => Object.fromEntries(NEWS_SCHEMA.map((x) => [x.key, x.defval])), create: () => new NewsNative(), legendNote: legend });
  Core.registerNativeIndicator({ type: ECON_TYPE, title: 'TradeZoro Economic events', shortTitle: 'Econ events', paneHint: 'price', overlay: true,
    inputsSchema: () => ECON_SCHEMA, defaultInputs: () => Object.fromEntries(ECON_SCHEMA.map((x) => [x.key, x.defval])), create: () => new EconNative(), legendNote: legend });
  Core.registerStatePersistence({
    key: 'stryker.newsmarkers', scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === NEWS_TYPE || h.nativeType === ECON_TYPE) out.push([h.nativeType, h.inputValues()]); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators(); } catch (e) { return; }
      for (const type of [NEWS_TYPE, ECON_TYPE]) {
        const mine = hs.filter((h) => h.nativeType === type), saved = payload.filter((p) => Array.isArray(p) && p[0] === type);
        const schema = type === NEWS_TYPE ? NEWS_SCHEMA : ECON_SCHEMA;
        saved.slice(0, 2).forEach((p, i) => {
          if (!mine[i] || !p[1] || typeof p[1] !== 'object') return;
          const clean = {};
          schema.forEach((s) => { const v = p[1][s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
          try { mine[i].setInputs(clean); } catch (e) {}
        });
      }
    }
  });
  if (typeof document !== 'undefined') {
    if (!document.getElementById('stk-nm-css')) { const st = document.createElement('style'); st.id = 'stk-nm-css'; st.textContent = CSS; document.head.appendChild(st); }
    // capture phase: the chart stops pointer events from bubbling
    document.addEventListener('pointermove', onMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', onDown, { capture: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) pop.hidden = true; });
  }
  window.__stkNewsMarkers = { _setTier, bucketNews, pickEvents, nextWarning, hits: (cv) => hits.get(cv) };
}
export { NEWS_TYPE, ECON_TYPE };
