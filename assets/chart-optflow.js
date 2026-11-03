// TradeZoro — "Options Flow Marks" chart indicator (native overlay on the price pane, Pro). ES module.
// Owner order 2026-11-04 ("Build everything").
//
// WHAT THE DATA IS (checked, not assumed): the same per-minute samples ZoroTide uses (book-recorder GET /tide, built from the
// option chain by gex-feeder/tide.py): { t, s, cn, pn, cp, pp, cv, pv } = per sample the net / gross CALL and PUT premium in $ and
// the number of new contracts, for SPX, SPY and QQQ. There is NO single trade, NO strike and NO expiry in it: the chain diff is added up
// over every contract. So this indicator marks per-bar TOTALS: on a bar with unusually large call (or put) premium a green bubble goes
// above (calls) or a red bubble below (puts) the candle, sized by the premium in that bar. The hover / tap card shows what is
// really known: calls or puts, premium, contracts, and the net bought-minus-sold estimate. It says plainly that strike and expiry are
// not in the data feed. Nothing is invented. Bar replay: nothing is drawn (the totals would leak the future).
// Wording: "Estimated from options volume and quotes." Never live / real-time. Education only. Not financial advice.
// Depends on: Vela plugin SDK via the legend-row Core (registerNativeIndicator, registerRendererLayer, registerStatePersistence).

import { tideSource, tfMin, tideFetch, cache, money, agoText } from './chart-zorotide.js?v=843';

export const OPTFLOW_TYPE = 'stk_optflow';
export const OPTFLOW_DESC = 'Bubbles on the candles where call (green, above) or put (red, below) premium was unusually large, sized by premium; hover or tap for premium and contracts. Per-bar totals from the options data feed, not single trades (SPX, SPY, QQQ, ES, NQ)';
const SCHEMA = [
  { key: 'sensitivity', title: 'Marks', type: 'string', defval: 'Medium', options: ['Few', 'Medium', 'Many'] },
  { key: 'minPremium', title: 'Smallest premium to mark ($)', type: 'integer', defval: 100000, minval: 0, maxval: 100000000 },
  { key: 'callColor', title: 'Calls colour', type: 'color', defval: '#22c55e' },
  { key: 'putColor', title: 'Puts colour', type: 'color', defval: '#ef4444' }
];
const KEEP = { Few: 0.05, Medium: 0.1, Many: 0.2 };   // share of bars (per side) that get a mark
const R_MIN = 4, R_MAX = 13;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- pure: samples -> per-bar totals ------------------------------------------------------------
// days = /tide reply days[] (t in epoch s). bars = [{ time(ms) }] sorted. ms = bar length.
// Returns an array aligned with bars: null or { cp, pp, cn, pn, cv, pv, n } (sums of the samples that fall inside the bar).
export function perBar(days, bars, ms) {
  const out = new Array(bars.length).fill(null);
  if (!(ms > 0) || !bars.length) return out;
  const t0 = bars[0].time, tN = bars[bars.length - 1].time + ms;
  for (const d of days || []) {
    for (let k = 0; k < d.t.length; k++) {
      const t = d.t[k] * 1000;
      if (t < t0 || t >= tN) continue;
      let lo = 0, hi = bars.length - 1, i = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { i = m; lo = m + 1; } else hi = m - 1; }
      if (i < 0 || t >= bars[i].time + ms) continue;   // a sample in a hole between bars belongs to no bar
      const o = out[i] || (out[i] = { cp: 0, pp: 0, cn: 0, pn: 0, cv: 0, pv: 0, n: 0 });
      o.cp += d.cp[k]; o.pp += d.pp[k]; o.cn += d.cn[k]; o.pn += d.pn[k]; o.cv += d.cv[k]; o.pv += d.pv[k]; o.n++;
    }
  }
  return out;
}
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q + 1e-9))] : 0);
// Which bars get a mark: per side, gross premium >= max(minPremium, the (1 - keep) quantile of that side's non-zero bars).
// Returns [{ i, side: 'C'|'P', prem, r, b }] (r = bubble radius px, scaled by sqrt of premium against the biggest mark).
export function pickMarks(agg, I = {}) {
  const keep = KEEP[I.sensitivity] || KEEP.Medium, floor = Math.max(0, Number(I.minPremium) || 0);
  const marks = [];
  for (const side of ['C', 'P']) {
    const key = side === 'C' ? 'cp' : 'pp';
    const vals = agg.map((b) => (b ? b[key] : 0)).filter((v) => v > 0).sort((a, b) => a - b);
    const th = Math.max(floor, quantile(vals, 1 - keep), 1);
    agg.forEach((b, i) => { if (b && b[key] >= th) marks.push({ i, side, prem: b[key], b }); });
  }
  const max = marks.reduce((m, x) => Math.max(m, x.prem), 0) || 1;
  marks.forEach((m) => { m.r = R_MIN + (R_MAX - R_MIN) * Math.sqrt(m.prem / max); });
  return marks;
}
export function tipRows(m) {
  const calls = m.side === 'C', net = calls ? m.b.cn : m.b.pn;
  return {
    title: (calls ? 'Calls' : 'Puts') + ' · large premium',
    rows: [
      ['Premium', money(m.prem).replace('+', '')],
      ['Contracts', String(calls ? m.b.cv : m.b.pv)],
      ['Net bought − sold', money(net)],
      ['Strike / expiry', 'not in the data']
    ],
    note: 'Total for this bar, estimated from options volume and quotes. Not a single trade.'
  };
}

// ---- native + layer ------------------------------------------------------------------------------
const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
const hits = new WeakMap();   // canvas -> [{ x, y, r, m }]
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };

class FlowNative {
  constructor() { this.ctx = null; this.inputs = {}; this.sig = ''; this.timer = 0; }
  defaults() { return Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); this.load(); this.timer = setInterval(() => { if (!document.hidden) this.load(); }, 60000); }
  src() { let p = ''; try { const r = this.ctx.data.resolve(this.ctx.symbol); if (r) p = r.provider; } catch (e) {} return tideSource(this.ctx.symbol, p); }
  load() {
    const s = this.ctx && !replayOn() && this.src();
    if (!s) return this.refresh();
    tideFetch(s.u).then(() => this.refresh());
  }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.refresh(); }
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(this.defaults(), i); this.sig = ''; this.refresh(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { clearInterval(this.timer); try { this.ctx.pushData(null); } catch (e) {} }
  push(p) { const sig = JSON.stringify(p && p.note ? p : { n: p && p.marks.length, last: p && p.last, I: p && p.I, b: p && p.bars }); if (sig === this.sig) return; this.sig = sig; try { this.ctx.pushData(p); } catch (e) {} }
  refresh() {
    if (!this.ctx) return;
    if (replayOn()) return this.push({ note: 'Options Flow Marks are hidden during bar replay' });
    const src = this.src();
    if (!src) return this.push({ note: 'Options Flow Marks: SPX, SPY, QQQ, ES, NQ' });
    const ms = (tfMin(this.ctx.timeframe) || 0) * 60000;
    if (!ms || ms >= 86400000) return this.push({ note: 'Options Flow Marks show intraday charts (1 minute to 4 hours)' });
    const e = cache.get(src.u), data = e && e.data;
    if (!data) return this.push({ note: 'Loading options flow…' });
    const bars = this.ctx.bars() || [];
    const agg = perBar(data.days, bars, ms);
    const marks = pickMarks(agg, this.inputs);
    const last = data.days.length && data.days[0].t.length ? data.days[0].t[data.days[0].t.length - 1] : 0;
    this.push({ marks, bars: bars.length ? bars[0].time + '|' + bars[bars.length - 1].time : '', last, I: this.inputs, label: src.label, ago: agoText(last) });
  }
}

function layer() {
  let canvas = null, chip = null, chipKey = '';
  function setChip(text, parent) {
    if (text === chipKey) return;
    chipKey = text;
    if (!text) { if (chip) chip.hidden = true; return; }
    if (!chip) { chip = document.createElement('div'); chip.className = 'stk-of-chip'; parent.appendChild(chip); }
    chip.hidden = false; chip.textContent = text;
  }
  return {
    mount(c) { canvas = c; c.dataset.stkOf = '1'; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d'), co = a.coords, dpr = co.dpr || 1, d = a.data;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const boxes = []; hits.set(canvas, boxes);
      if (!d) return setChip('', canvas.parentElement);
      if (d.note) return setChip(d.note, canvas.parentElement);
      setChip(d.marks.length ? d.label + ': per-bar options premium totals, estimated. ' + d.ago : 'No unusual options premium in the loaded bars', canvas.parentElement);
      const bars = a.bars, I = d.I, day = light();
      const top = a.bounds.top, bot = top + a.bounds.height, W = co.width;
      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      for (const m of d.marks) {
        const bar = bars[m.i]; if (!bar) continue;
        const x = co.timeToX(bar.time);
        if (!Number.isFinite(x) || x < -20 || x > W + 20) continue;
        const calls = m.side === 'C', y0 = co.priceToY(calls ? bar.high : bar.low, a.scale, a.bounds);
        const y = Math.min(bot - m.r, Math.max(top + m.r, y0 + (calls ? -(m.r + 4) : m.r + 4)));
        const col = calls ? I.callColor : I.putColor;
        g.beginPath(); g.arc(x, y, m.r, 0, Math.PI * 2);
        g.globalAlpha = 0.45; g.fillStyle = col; g.fill();
        g.globalAlpha = 1; g.lineWidth = 1.5; g.strokeStyle = day ? 'rgba(15,23,42,.55)' : col; g.stroke();
        boxes.push({ x, y, r: Math.max(m.r, 12), m });
      }
      g.restore();
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
  };
}

// ---- hover (mouse) and tap (touch) card ------------------------------------------------------------
let tip = null, pinned = false;
function find(e) {
  for (const cv of document.querySelectorAll('canvas[data-stk-of]')) {
    const bx = hits.get(cv); if (!bx || !bx.length) continue;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    let best = null, bd = 1e9;
    for (const b of bx) { const dd = Math.hypot(b.x - x, b.y - y); if (dd <= b.r && dd < bd) { best = { b, r }; bd = dd; } }
    if (best) return best;
  }
  return null;
}
function show(h) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'stk-of-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  const t = tipRows(h.b.m);
  tip.textContent = '';
  const head = document.createElement('div'); head.className = 'stk-of-h';
  const dot = document.createElement('i'); dot.style.background = h.b.m.side === 'C' ? '#22c55e' : '#ef4444';
  head.append(dot, t.title); tip.appendChild(head);
  t.rows.forEach(([k, v]) => { const r = document.createElement('div'); r.className = 'stk-of-r'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); tip.appendChild(r); });
  const n = document.createElement('div'); n.className = 'stk-of-n'; n.textContent = t.note; tip.appendChild(n);
  tip.hidden = false;
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, h.r.left + h.b.x - tip.offsetWidth / 2));
  let tp = h.r.top + h.b.y - tip.offsetHeight - h.b.r - 8; if (tp < 8) tp = h.r.top + h.b.y + h.b.r + 8;
  tip.style.left = left + 'px'; tip.style.top = tp + 'px';
}
function onMove(e) {
  if (e.pointerType === 'touch' || pinned) return;
  const h = find(e);
  if (!h) { if (tip) tip.hidden = true; return; }
  show(h);
}
function onDown(e) {
  const h = find(e);
  if (!h) { pinned = false; if (tip) tip.hidden = true; return; }
  pinned = e.pointerType === 'touch'; show(h);
}
const CSS = `
.stk-of-chip{ position:absolute; bottom:8px; left:50%; transform:translateX(-50%); z-index:6; pointer-events:none; max-width:90%; padding:4px 12px; border-radius:999px;
  font:400 11px/13px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  background:#131316; color:rgba(255,255,255,.64); border:1px solid rgba(255,255,255,.08); }
.stk-of-chip[hidden]{ display:none; }
.stk-of-tip{ position:fixed; z-index:9050; pointer-events:none; width:min(260px, calc(100vw - 16px)); padding:12px; border-radius:12px; background:#131316; color:rgba(255,255,255,.92);
  border:1px solid rgba(255,255,255,.08); font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; box-shadow:0 8px 24px rgba(0,0,0,.4); }
.stk-of-tip[hidden]{ display:none; }
.stk-of-h{ display:flex; align-items:center; gap:8px; font-weight:600; margin-bottom:8px; }
.stk-of-h i{ width:8px; height:8px; border-radius:50%; flex:none; }
.stk-of-r{ display:flex; justify-content:space-between; gap:12px; }
.stk-of-r span{ color:rgba(255,255,255,.64); }
.stk-of-n{ margin-top:8px; font-size:12px; line-height:16px; color:rgba(255,255,255,.64); }
:root[data-theme="light"] .stk-of-tip, :root[data-theme="light"] .stk-of-chip{ background:#fff; color:#1d1d1f; border-color:rgba(0,0,0,.12); }
:root[data-theme="light"] .stk-of-r span, :root[data-theme="light"] .stk-of-n, :root[data-theme="light"] .stk-of-chip{ color:#515154; }
`;

// ---- registration + persistence ---------------------------------------------------------------------
const PERSIST_KEY = 'stryker.optflow';
let installed = false;
export function installOptFlow(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: OPTFLOW_TYPE, placement: 'above-data', create: layer });
  Core.registerNativeIndicator({
    type: OPTFLOW_TYPE, title: 'Options Flow Marks', shortTitle: 'Options flow', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new FlowNative(), legendNote: (d) => (!d ? '' : d.note || (d.marks.length + ' marks'))
  });
  Core.registerStatePersistence({
    key: PERSIST_KEY, scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === OPTFLOW_TYPE) out.push(h.inputValues()); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators().filter((h) => h.nativeType === OPTFLOW_TYPE); } catch (e) { return; }
      payload.slice(0, 2).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
  if (typeof document !== 'undefined') {
    if (!document.getElementById('stk-of-css')) { const st = document.createElement('style'); st.id = 'stk-of-css'; st.textContent = CSS; document.head.appendChild(st); }
    document.addEventListener('pointermove', onMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', onDown, { capture: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tip) { tip.hidden = true; pinned = false; } });
  }
}
