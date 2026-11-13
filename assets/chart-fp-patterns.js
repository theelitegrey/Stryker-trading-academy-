// TradeZoro — Charts: FOOTPRINT PATTERNS indicator (Owner order 2026-11-10). Overlay on ANY chart style (candles too).
// Two types, same drawing, same maths (assets/chart-fp-patterns-data.js):
//   stk_fpat     Footprint Patterns        crypto (Binance trades) and futures on the trades feed (the L1 road)
//   stk_fpat_l2  Footprint Patterns (L2)   futures on the L2 footprint feed (the same flow the Footprint (L2) chart style reads)
// Data: the footprint's own per-bar, per-price bid / ask volume (flowFor() / fpFlow()); no second aggregator, no feed of its own.
// Finished bars are cached by the maths module; only the forming bar is recomputed per tick.
// Marks (number 1-6 chip + optional short name, green / red by side): 1 Absorption, 2 Exhaustion, 3 Stacked imbalances (zone),
// 4 Unfinished auction (line), 5 Delta divergence (connector), 6 Trapped traders (box). Pro (order flow), like the footprint.
// Describes what a pattern is. Never a trade instruction. Education only. Not financial advice.
import { registerFeed } from './chart-feeds.js?v=965';
import { L2_TYPES } from './chart-futures-l2.js?v=965';
import { analyze, DEFAULTS, KINDS, NUM, NAMES, TIPS, titleOf } from './chart-fp-patterns-data.js?v=965';

export const FPAT_TYPE = 'stk_fpat', FPAT_L2 = 'stk_fpat_l2';
export const FPAT_TYPES = [FPAT_TYPE, FPAT_L2];
const UP = '#03c988', DN = '#f23645';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Segoe UI", system-ui, sans-serif';
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
// darker text colour for the light theme (AA contrast on white)
function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgb(' + Math.round((n >> 16 & 255) * k) + ',' + Math.round((n >> 8 & 255) * k) + ',' + Math.round((n & 255) * k) + ')';
}
function idxOf(bars, t) { let lo = 0, hi = bars.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function note(id, text) {
  const day = light();
  return { id, paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: day ? '#334155' : '#a3a9b6', hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}

// ---------------------------------------------------------------- settings
const D = DEFAULTS;
const SCHEMA = [
  { key: 'showAbs', title: '1 Absorption', type: 'bool', defval: true, tooltip: TIPS.abs },
  { key: 'showExh', title: '2 Exhaustion', type: 'bool', defval: true, tooltip: TIPS.exh },
  { key: 'showStk', title: '3 Stacked imbalances', type: 'bool', defval: true, tooltip: TIPS.stk },
  { key: 'showUnf', title: '4 Unfinished auction', type: 'bool', defval: true, tooltip: TIPS.unf },
  { key: 'showDiv', title: '5 Delta divergence', type: 'bool', defval: true, tooltip: TIPS.div },
  { key: 'showTrap', title: '6 Trapped traders', type: 'bool', defval: true, tooltip: TIPS.trap },
  { key: 'labels', title: 'Text labels', type: 'bool', defval: false, tooltip: 'Add a short name next to each number.' },
  { key: 'maxBars', title: 'Look back (bars)', type: 'int', defval: D.maxBars, min: 20, max: 2000, step: 10 },
  { key: 'rowTicks', title: 'Row size (ticks)', type: 'int', defval: D.rowTicks, min: 1, max: 100, step: 1, tooltip: 'Price rows are this many ticks tall, like the Footprint chart\'s Rows setting.' },
  { key: 'absMult', title: 'Absorption: extreme rows at least (x the bar\'s average row)', type: 'float', defval: D.absMult, min: 1, max: 20, step: 0.1 },
  { key: 'absRows', title: 'Absorption: extreme rows counted', type: 'int', defval: D.absRows, min: 1, max: 10, step: 1 },
  { key: 'exhRows', title: 'Exhaustion: rows looked at', type: 'int', defval: D.exhRows, min: 3, max: 10, step: 1 },
  { key: 'exhPct', title: 'Exhaustion: last row at most (% of the first row in)', type: 'int', defval: D.exhPct, min: 1, max: 100, step: 1 },
  { key: 'ratio', title: 'Imbalance ratio %', type: 'int', defval: D.ratio, min: 110, max: 2000, step: 10, tooltip: 'Diagonal: buys at a price vs sells one row lower (and sells vs buys one row higher). Same rule as the Footprint chart.' },
  { key: 'stack', title: 'Stacked imbalance rows (at least)', type: 'int', defval: D.stack, min: 2, max: 10, step: 1 },
  { key: 'divLen', title: 'Divergence: swing strength (bars each side)', type: 'int', defval: D.divLen, min: 1, max: 20, step: 1 },
  { key: 'divDrop', title: 'Divergence: delta lower by at least (%)', type: 'int', defval: D.divDrop, min: 1, max: 100, step: 1 },
  { key: 'divGap', title: 'Divergence: swings at most this many bars apart', type: 'int', defval: D.divGap, min: 5, max: 500, step: 5 },
  { key: 'trapMult', title: 'Trapped: top rows at least (x the bar\'s average row)', type: 'float', defval: D.trapMult, min: 1, max: 20, step: 0.1 },
  { key: 'trapRows', title: 'Trapped: rows in the zone', type: 'int', defval: D.trapRows, min: 1, max: 10, step: 1 },
  { key: 'trapBars', title: 'Trapped: a close beyond within (bars)', type: 'int', defval: D.trapBars, min: 1, max: 30, step: 1 },
  { key: 'buyColor', title: 'Green side (buyers in control)', type: 'color', defval: UP },
  { key: 'sellColor', title: 'Red side (sellers in control)', type: 'color', defval: DN }
];
const defaults = () => Object.fromEntries(SCHEMA.map((i) => [i.key, i.defval]));
const dataOpts = (I) => ({
  rowTicks: clamp(Math.round(num(I.rowTicks, D.rowTicks)), 1, 100), absMult: clamp(num(I.absMult, D.absMult), 1, 20), absRows: clamp(Math.round(num(I.absRows, D.absRows)), 1, 10),
  exhRows: clamp(Math.round(num(I.exhRows, D.exhRows)), 3, 10), exhPct: clamp(num(I.exhPct, D.exhPct), 1, 100), ratio: clamp(num(I.ratio, D.ratio), 110, 2000),
  stack: clamp(Math.round(num(I.stack, D.stack)), 2, 10), divLen: clamp(Math.round(num(I.divLen, D.divLen)), 1, 20), divDrop: clamp(num(I.divDrop, D.divDrop), 1, 100),
  divGap: clamp(num(I.divGap, D.divGap), 5, 500), trapMult: clamp(num(I.trapMult, D.trapMult), 1, 20), trapRows: clamp(Math.round(num(I.trapRows, D.trapRows)), 1, 10),
  trapBars: clamp(Math.round(num(I.trapBars, D.trapBars)), 1, 30), maxBars: clamp(Math.round(num(I.maxBars, D.maxBars)), 20, 2000)
});
const ON_KEY = { abs: 'showAbs', exh: 'showExh', stk: 'showStk', unf: 'showUnf', div: 'showDiv', trap: 'showTrap' };

// ---------------------------------------------------------------- native indicator
let H = null;   // hooks from chart-footprint.js
class FpNative {
  constructor(type) { this.type = type; this.l2 = type === FPAT_L2; this.inputs = defaults(); this.tm = 0; this.on = false; this.l2own = {}; this.l2m = undefined; this.cache = new Map(); this.stat = { events: 0, draws: 0 };
    this.onAny = () => this.later(); this.onL2 = () => this.later(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(), inputs); this.on = true; H.use(); H.subscribe(this.onAny); this.render(); }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() { this.later(); }
  onViewport() { this.push(); }
  setInputs(i) { this.inputs = Object.assign(defaults(), i); this.cache.clear(); this.memo = null; this.render(); }
  suspend() { this.on = false; H.unsubscribe(this.onAny); this.dropL2(); this.push(); }
  resume() { this.on = true; H.subscribe(this.onAny); this.render(); }
  stop() { if (this.on) { H.unsubscribe(this.onAny); H.unuse(); } this.on = false; clearTimeout(this.tm); this.dropL2(); this.push(); }   // a last frame with on=false clears the layer
  dropL2() { if (this.l2m) this.l2m.fpDrop(this.l2own); }
  // the footprint's flow for this chart: { map, list, mins, tick, note } (futures L2: the Footprint (L2) feed; else the trades feed)
  flow(bars) {
    const ctx = this.ctx, root = H.rootOf(ctx), tf = H.tfMin(ctx.timeframe);
    if (this.l2) {
      if (!root || (typeof root === 'string' && /^[a-z]+:/i.test(root))) return { note: 'Footprint Patterns (L2) is for futures. On crypto use Footprint Patterns.' };
      if (tf == null || tf < 1 || tf > 240) return { note: 'Order flow works on 1-minute to 4-hour charts.' };
      if (this.l2m === undefined) {
        this.l2m = null;
        import('./chart-l2-flow.js?v=965').then((m) => { this.l2m = m; this.later(); }, () => { this.l2m = false; this.later(); });
      }
      if (this.l2m === null) return { note: 'Loading order flow…', loading: true };
      if (!this.l2m) return H.flowFor({ root, timeframe: ctx.timeframe, bars, owner: this });
      return this.l2m.fpFlow(this.l2own, ctx, bars, tf * 60000, H.replayE(), this.onL2) || H.flowFor({ root, timeframe: ctx.timeframe, bars, owner: this });
    }
    return H.flowFor({ root, timeframe: ctx.timeframe, bars, owner: this });
  }
  render() {
    if (!this.ctx) return;
    const f = this.flow(this.ctx.bars());
    this.ctx.setStatus(f.loading ? 'loading' : 'idle');
    this.ctx.emit({ tables: f.note ? [note(this.type + '-msg', f.note)] : [] });
    this.push();
  }
  push() { try { this.ctx.pushData({ owner: this, v: H.version(), on: this.on, i: JSON.stringify(this.inputs), n: this.ctx.bars().length, t: Date.now() }); } catch (e) {} }
}

// ---------------------------------------------------------------- layer
const hits = new WeakMap();   // canvas -> [{ x, y, r, e }] of the last frame, for the tooltip
let tipEl = null, tipOn = false;
const tipCanvases = new Set();
function tipMove(e) {
  let best = null, bd = 1e9;
  for (const canvas of tipCanvases) {
    const L = hits.get(canvas); if (!L || !L.length || !canvas.isConnected) continue;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    for (const m of L) { const d = Math.hypot(m.x - x, m.y - y); if (d <= m.r + 4 && d < bd) { bd = d; best = m; } }
  }
  if (!best) { if (tipEl) tipEl.hidden = true; return; }
  if (!tipEl) {
    tipEl = document.createElement('div'); tipEl.className = 'stk-fpat-tip'; tipEl.setAttribute('role', 'tooltip');
    tipEl.style.cssText = 'position:fixed;z-index:60;max-width:260px;padding:12px 16px;border-radius:12px;font:12px/16px ' + SANS + ';pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.35)';
    document.body.appendChild(tipEl);
  }
  const day = light();
  tipEl.style.background = day ? '#ffffff' : '#131316'; tipEl.style.color = day ? '#1d1d1f' : 'rgba(255,255,255,0.92)'; tipEl.style.border = '1px solid ' + (day ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)');
  const t = document.createElement('div'), p = document.createElement('div');
  t.style.cssText = 'font-weight:600;margin-bottom:4px'; t.textContent = best.e.title + (best.e.forming ? ' (forming)' : '');
  p.style.cssText = 'opacity:.72'; p.textContent = TIPS[best.e.kind];
  tipEl.replaceChildren(t, p); tipEl.hidden = false;
  tipEl.style.left = clamp(e.clientX + 12, 4, innerWidth - 270) + 'px'; tipEl.style.top = clamp(e.clientY + 12, 4, innerHeight - 110) + 'px';
}
function installTip(canvas) {
  tipCanvases.add(canvas);
  if (tipOn) return; tipOn = true;
  document.addEventListener('pointermove', tipMove, true); document.addEventListener('pointerdown', tipMove, true);
}

function layer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; installTip(c); },
    render(a) {
      const g = canvas && canvas.getContext('2d');
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      hits.set(canvas, []);
      const d = a.data;
      if (!d || !d.owner || !d.owner.on || !d.owner.ctx || !a.bars || !a.bars.length) { if (d && d.owner) d.owner.stat.shown = 0; return; }
      const inst = d.owner, I = inst.inputs, co = a.coords, dpr = co.dpr || 1, phone = co.width < 520;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.save(); g.beginPath(); g.rect(0, a.bounds.top, co.width, a.bounds.height); g.clip();
      try {
        const f = inst.flow(a.bars);
        const L = f.list || [];
        if (!L.length || !f.tick) return;
        const tick = f.tick, tfMs = (H.tfMin(inst.ctx.timeframe) || 1) * 60000, E = H.replayE();
        const last = L[L.length - 1], nowMs = E == null ? Date.now() : E;
        const forming = last.t + tfMs > nowMs ? L.length - 1 : -1;
        const key = L.length + '|' + L[0].t + '|' + last.t + '|' + last.vol + '|' + last.c + '|' + last.lo + '|' + last.hi + '|' + forming + '|' + d.i;
        let st = inst.memo;
        if (!st || st.key !== key) {
          st = { key, ev: analyze(L, dataOpts(I), inst.cache, forming) };
          inst.memo = st; inst.stat.events = st.ev.length;
          if (inst.cache.size > 3000) inst.cache.clear();
        }
        draw(g, a, co, I, st.ev, L, tick, forming, phone, hits.get(canvas));
        inst.stat.draws++; window.__stkFpat = { events: st.ev.map((e) => ({ kind: e.kind, i: e.i, t: e.t, dir: e.dir, forming: e.forming })), draws: inst.stat.draws, shown: inst.stat.shown, by: inst.stat.by };
      } finally { g.restore(); }
    },
    destroy() { if (canvas) { tipCanvases.delete(canvas); hits.delete(canvas); } canvas = null; }
  };
}

function draw(g, a, co, I, ev, L, tick, forming, phone, hitList) {
  const Y = (p) => co.priceToY(p, a.scale, a.bounds), top = a.bounds.top, bot = top + a.bounds.height;
  const ppb = co.pxPerBar(), vr = co.visibleLogicalRange(), n = a.bars.length;
  const i0 = Math.floor(vr.from) - 2, i1 = Math.ceil(vr.to) + 2;
  const day = light(), ring = day ? '#ffffff' : '#0b0b0d';
  const colOf = (dir) => (dir > 0 ? (I.buyColor || UP) : (I.sellColor || DN));
  const total = Math.max(1, L.length - 1);
  const fade = (i) => 0.45 + 0.55 * (i / total);   // old marks fade toward 45 %
  const shownKinds = KINDS.filter((k) => I[ON_KEY[k]] !== false);
  const bx = (t) => { const i = idxOf(a.bars, t); return i < 0 ? -1 : i; };
  const r = phone ? 8 : 9;
  let shown = 0;
  const by = {};
  const slot = new Map(), chips = [];
     // bar x|side -> chips stacked so far, so two marks on one bar never overlap
  const chip = (e, x, y, side) => {   // side +1 above the price, -1 below
    const k = Math.round(x) + '|' + side, s = slot.get(k) || 0;
    slot.set(k, s + 1);
    const cy = y + side * (-(r + 4) - s * (2 * r + 2));
    if (cy < top - r || cy > bot + r) return;
    const col = colOf(e.dir), al = fade(e.i);
    g.save();
    g.globalAlpha = al;
    g.fillStyle = col; g.strokeStyle = ring; g.lineWidth = 1.5;
    if (e.forming) g.setLineDash([2, 2]);
    g.beginPath(); g.arc(x, cy, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffffff'; g.font = '700 ' + (phone ? 10 : 11) + 'px ' + SANS; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(NUM[e.kind]), x, cy + 0.5);
    chips.push({ x, y: cy, e });
    g.restore();
    shown++; by[e.kind] = (by[e.kind] || 0) + 1;
    hitList.push({ x, y: cy, r, e: Object.assign({ title: titleOf(e) }, e) });
  };
  const zone = (e, p0, p1, endT) => {
    const i = bx(e.t); if (i < 0) return;
    const x0 = co.logicalToX(i) - ppb / 2, x1 = endT == null ? co.width : co.logicalToX(bx(endT)) + ppb / 2;
    const y0 = Y(p1), y1 = Y(p0), h = Math.max(3, Math.abs(y1 - y0)), yT = Math.min(y0, y1);
    if (yT > bot || yT + h < top || x1 < 0 || x0 > co.width) return;
    const col = colOf(e.dir), open = endT == null, al = fade(e.i) * (open ? 1 : 0.4);
    g.fillStyle = rgba(col, 0.16 * al); g.fillRect(x0, yT, Math.max(2, x1 - x0), h);
    g.strokeStyle = rgba(col, 0.8 * al); g.lineWidth = 1; g.strokeRect(x0 + 0.5, yT + 0.5, Math.max(1, x1 - x0 - 1), Math.max(1, h - 1));
  };
  for (const e of ev) {
    if (!shownKinds.includes(e.kind)) continue;
    // flow-list index -> chart-bar index by time (the chart may hold more bars than the flow, or fewer)
    const ci = bx(e.t);
    if (ci < 0) continue;
    const endI = e.kind === 'stk' || e.kind === 'unf' ? (e.end < 0 ? n : bx(L[e.end].t)) : e.kind === 'trap' ? bx(L[e.j].t) : ci;
    const ei = e.kind === 'div' ? bx(L[e.from].t) : ci;
    if ((ci < i0 && endI < i0) || ei > i1 || ci > i1 + 1) continue;
    if (e.kind === 'stk') {
      zone(e, e.lo * tick, e.hi * tick, e.end < 0 ? null : L[e.end].t);
      chip(e, co.logicalToX(ci), Y((e.dir > 0 ? e.lo : e.hi) * tick), e.dir > 0 ? -1 : 1);
    } else if (e.kind === 'trap') {
      zone(e, e.lo * tick, e.hi * tick, L[e.j].t);
      chip(e, co.logicalToX(ci), Y((e.dir < 0 ? e.hi : e.lo) * tick), e.dir < 0 ? 1 : -1);
    } else if (e.kind === 'unf') {
      const x = co.logicalToX(ci), y = Y(e.p * tick + tick / 2), xe = e.end < 0 ? co.width : co.logicalToX(bx(L[e.end].t));
      g.save(); g.globalAlpha = fade(e.i) * (e.end < 0 ? 1 : 0.5); g.strokeStyle = colOf(e.dir); g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(Math.max(x, xe), y); g.stroke(); g.restore();
      if (e.end < 0) chip(e, x, y, e.at === 'hi' ? 1 : -1);   // once price has been back the line fades out and the number goes (keeps busy charts readable)
    } else if (e.kind === 'div') {
      const ia = bx(L[e.from].t); if (ia < 0) continue;
      const hi = e.at === 'hi', xa = co.logicalToX(ia), xb = co.logicalToX(ci), ya = Y(e.pa * tick + tick / 2), yb = Y(e.p * tick + tick / 2);
      g.save(); g.globalAlpha = fade(e.i); g.strokeStyle = colOf(e.dir); g.lineWidth = 1.5; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(xa, ya + (hi ? -(r + 4) : r + 4)); g.lineTo(xb, yb + (hi ? -(r + 4) : r + 4)); g.stroke(); g.restore();
      chip(Object.assign({}, e, { forming: false }), xa, ya, hi ? 1 : -1);
      chip(e, xb, yb, hi ? 1 : -1);
    } else {   // abs, exh: one chip at the extreme price
      chip(e, co.logicalToX(ci), Y(e.p * tick + tick / 2), e.at === 'hi' ? 1 : -1);
    }
  }
  if (I.labels === true) {   // names after every number: a name that would cover a number or another name is skipped (its number stays)
    g.font = '600 ' + (phone ? 10 : 11) + 'px ' + SANS; g.textAlign = 'left'; g.textBaseline = 'middle';
    const lab = [];
    for (const c of chips.slice().reverse()) {   // newest first
      const txt = NAMES[c.e.kind][phone ? 1 : 0] + (c.e.forming ? '…' : ''), w = g.measureText(txt).width + 8, x0 = c.x + r + 2;
      const hit = (q) => x0 < q.x1 && x0 + w > q.x0 && c.y - 8 < q.y1 && c.y + 8 > q.y0;
      if (x0 + w > co.width || lab.some(hit) || chips.some((o) => o !== c && hit({ x0: o.x - r, x1: o.x + r, y0: o.y - r, y1: o.y + r }))) continue;
      lab.push({ x0, x1: x0 + w, y0: c.y - 8, y1: c.y + 8 });
      g.save(); g.globalAlpha = fade(c.e.i); g.fillStyle = day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.85)'; g.fillRect(x0, c.y - 8, w, 16);
      g.fillStyle = day ? shade(colOf(c.e.dir), 0.68) : colOf(c.e.dir); g.fillText(txt, x0 + 4, c.y + 0.5); g.restore();
    }
  }
  const inst = a.data.owner; inst.stat.shown = shown; inst.stat.by = by;
  void forming;
}

// ---------------------------------------------------------------- install (from installFootprint)
let installed = false;
export function installFpPatterns(Core, hooks) {
  if (installed) return;
  installed = true;
  H = hooks;
  for (const t of FPAT_TYPES) Core.registerRendererLayer({ id: t, placement: 'above-data', create: layer });
  if (!L2_TYPES.includes(FPAT_L2)) L2_TYPES.push(FPAT_L2);
  registerFeed(FPAT_TYPE, { needs: 'L2', title: 'Footprint Patterns' });
  registerFeed(FPAT_L2, { needs: 'L2', title: 'Footprint Patterns (L2)' });
  const reg = (type, title, short) => Core.registerNativeIndicator({ type, title, shortTitle: short, paneHint: 'price', overlay: true, reactsToViewport: true,
    inputsSchema: () => SCHEMA, defaultInputs: defaults, create: () => new FpNative(type) });
  reg(FPAT_TYPE, 'Footprint Patterns', 'Footprint Patterns');
  reg(FPAT_L2, 'Footprint Patterns (L2)', 'Footprint Patterns L2');
}
if (typeof window !== 'undefined') window.__stkFpatTypes = FPAT_TYPES;
