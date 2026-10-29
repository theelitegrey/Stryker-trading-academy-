// TradeZoro — Charts: ORDER FLOW PRO tools (Owner order 2026-10-23, "features like" the desktop
// order-flow platforms; our own design, names and colours). Four indicators in the "Order Flow" group:
//   - Absorption (stk_of_abs): bars where heavy aggressive volume hit a price and price did not move
//     (high volume, dense volume per tick of range, delta against the close). A small marker at the
//     absorbed price and a level line that extends right until a bar closes through it.
//   - Imbalance Zones (stk_of_imb): stacked diagonal buy / sell imbalances (3+ rows, 300% default)
//     drawn as zones that extend right until price trades through them, then fade.
//   - Market Profile (stk_of_tpo): TPO per session (RTH for futures, the UTC day for crypto): letters
//     or blocks per 30 minutes, initial balance, POC, value area, single prints.
//   - Effort vs Result (stk_of_evr): its own pane. Effort = volume vs its average, result = range vs
//     its average; flags high-effort / low-result bars (and the reverse).
//   - Stop Runs / Sweeps (stk_of_sweep, batch 2, 2026-10-24): a bar that pokes beyond a recent swing
//     high / low on a volume spike and closes back inside. A small triangle at the wick, a dotted line
//     from the swing to the sweep, and a short label. Real traded volume where order flow exists,
//     the chart's own volume elsewhere (so it works on every symbol with volume).
// Big Trades and the swing / session Volume Profile + naked POC live in assets/chart-footprint.js.
// Data: the SAME real order flow as the footprint (the book-recorder Worker for NQ ES YM GC SI CL and
// their micros; Binance trades for crypto) with the same plan + delay rules and refresh timers (hooks
// from installFootprint()); no feed of its own. TPO needs only the chart's candles (time at price).
// Depends on: assets/chart-of-pro-data.js (maths). Education only. Not financial advice.
import { absorptionEvents, levelBreaks, imbalanceZones, tpoProfile, tpoLetter, autoRow, effortResult, rthKey, sweepEvents } from './chart-of-pro-data.js?v=725';

export const ABS_TYPE = 'stk_of_abs', IMB_TYPE = 'stk_of_imb', TPO_TYPE = 'stk_of_tpo', EVR_TYPE = 'stk_of_evr', SWP_TYPE = 'stk_of_sweep';
export const PRO_TYPES = [ABS_TYPE, IMB_TYPE, TPO_TYPE, EVR_TYPE, SWP_TYPE];
const UP = '#03c988', DN = '#f23645', AMBER = '#f5b301', CYAN = '#00adb5', VIOLET = '#9b7bff';
// drawing palette shared with Big Trades / footprint / VP (chart-footprint.js): buyers green, sellers
// purple, TPO grey value area + teal outside, magenta POC, light-cyan value-area lines
const SELL = '#9d4dff', TPO_IN = '#9aa3ad', TPO_OUT = '#3f8f9a', MAG = '#e040fb', VA_LN = '#8fd8dc';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const NO_DATA = 'Needs order-flow data: futures (NQ, ES, YM, GC, SI, CL and their micros) and crypto.';

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function light() { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } }
const ink = () => (light() ? '#0f172a' : '#f4f4f6');
const dim = () => (light() ? '#64748b' : '#8a90a0');
const plateC = () => (light() ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.85)');
function fmtK(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'K';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return Number.isInteger(v) || a >= 100 ? String(Math.round(v)) : String(+v.toFixed(2));
}
function tfMin(tf) {
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) return +tf;
  const m = /^(\d+)([SDWM])$/i.exec(tf) || /^([DWM])$/i.exec(tf);
  if (!m) return null;
  const n = m.length === 3 ? +m[1] : 1, u = (m.length === 3 ? m[2] : m[1]).toUpperCase();
  return u === 'S' ? n / 60 : u === 'D' ? n * 1440 : u === 'W' ? n * 10080 : n * 43200;
}
function idxOf(bars, t) {   // last chart bar with time <= t
  let lo = 0, hi = bars.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}
function note(id, text, locked) {
  const day = light();
  return { id, paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: locked ? CYAN : (day ? '#334155' : '#a3a9b6'), hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}

// ---------------------------------------------------------------- settings
const ABS_SCHEMA = [
  { key: 'volMult', title: 'Volume at least (x average)', type: 'float', defval: 1.2, min: 1, max: 10, step: 0.1, tooltip: 'Against the previous 30 one-minute bars.' },
  { key: 'densMult', title: 'Volume per tick of range at least (x average)', type: 'float', defval: 1.3, min: 1, max: 10, step: 0.1, tooltip: 'A lot traded for the distance price covered.' },
  { key: 'minDeltaPct', title: 'Delta at least (% of the bar volume)', type: 'int', defval: 8, min: 1, max: 100, step: 1, tooltip: 'The aggressive side was clearly one way, yet the bar closed the other way.' },
  { key: 'breakTicks', title: 'Broken when a bar closes beyond by (ticks)', type: 'int', defval: 2, min: 0, max: 200, step: 1 },
  { key: 'broken', title: 'Show broken levels (faded; off = hide them)', type: 'bool', defval: true },
  { key: 'labels', title: 'Labels', type: 'bool', defval: true },
  { key: 'supColor', title: 'Sellers absorbed (support)', type: 'color', defval: UP },
  { key: 'resColor', title: 'Buyers absorbed (resistance)', type: 'color', defval: SELL }
];
const IMB_SCHEMA = [
  { key: 'ratio', title: 'Imbalance ratio %', type: 'int', defval: 300, min: 110, max: 2000, step: 10, tooltip: 'Diagonal: buys at a price vs sells one row lower (and sells vs buys one row higher).' },
  { key: 'stack', title: 'Stacked rows (at least)', type: 'int', defval: 3, min: 2, max: 10, step: 1 },
  { key: 'rowTicks', title: 'Row size (ticks)', type: 'int', defval: 1, min: 1, max: 100, step: 1 },
  { key: 'filled', title: 'Filled zones', type: 'string', defval: 'faded', options: ['faded', 'hidden'] },
  { key: 'buyColor', title: 'Buy imbalance zone', type: 'color', defval: UP },
  { key: 'sellColor', title: 'Sell imbalance zone', type: 'color', defval: SELL }
];
const TPO_SCHEMA = [
  { key: 'session', title: 'Session', type: 'string', defval: 'auto', options: ['auto', 'rth', 'full'], tooltip: 'auto = RTH 09:30-16:00 New York for futures, the UTC day for crypto. full = the CME day (18:00 New York).' },
  { key: 'period', title: 'Period (minutes per letter)', type: 'int', defval: 30, min: 5, max: 120, step: 5 },
  { key: 'style', title: 'Show as', type: 'string', defval: 'auto', options: ['auto', 'letters', 'blocks'], tooltip: 'auto = letters when they fit, else blocks.' },
  { key: 'rowTicks', title: 'Row size (ticks, 0 = auto)', type: 'int', defval: 0, min: 0, max: 2000, step: 1 },
  { key: 'va', title: 'Value area %', type: 'int', defval: 70, min: 10, max: 100, step: 1 },
  { key: 'ib', title: 'Initial balance (periods)', type: 'int', defval: 2, min: 1, max: 8, step: 1 },
  { key: 'widthPct', title: 'Width % of the session', type: 'int', defval: 70, min: 10, max: 100, step: 1 },
  { key: 'color', title: 'Value area', type: 'color', defval: TPO_IN },
  { key: 'outColor', title: 'Outside value area', type: 'color', defval: TPO_OUT },
  { key: 'pocColor', title: 'POC', type: 'color', defval: MAG },
  { key: 'vaLineColor', title: 'VAH / VAL lines', type: 'color', defval: VA_LN }
];
const EVR_SCHEMA = [
  { key: 'lookback', title: 'Average over (bars)', type: 'int', defval: 20, min: 5, max: 200, step: 1 },
  { key: 'minEffort', title: 'Flag when effort at least (x average)', type: 'float', defval: 1.5, min: 1, max: 10, step: 0.1 },
  { key: 'ratio', title: 'and effort / result at least', type: 'float', defval: 2, min: 1.1, max: 10, step: 0.1 },
  { key: 'reverse', title: 'Also flag low effort / high result', type: 'bool', defval: true },
  { key: 'effortColor', title: 'Effort (volume)', type: 'color', defval: '#5b6474' },
  { key: 'resultColor', title: 'Result (range)', type: 'color', defval: CYAN },
  { key: 'flagColor', title: 'High effort, low result', type: 'color', defval: AMBER },
  { key: 'revColor', title: 'Low effort, high result', type: 'color', defval: VIOLET }
];
const SWP_SCHEMA = [
  { key: 'len', title: 'Swing strength (bars each side)', type: 'int', defval: 5, min: 2, max: 50, step: 1, tooltip: 'A swing high / low is the extreme of this many bars on both sides.' },
  { key: 'volMult', title: 'Volume spike at least (x average)', type: 'float', defval: 1.5, min: 1, max: 10, step: 0.1 },
  { key: 'lookback', title: 'Average volume over (bars)', type: 'int', defval: 20, min: 5, max: 200, step: 1 },
  { key: 'maxAge', title: 'Swings older than (bars) are ignored', type: 'int', defval: 300, min: 20, max: 2000, step: 10 },
  { key: 'lines', title: 'Line from the swing to the sweep', type: 'bool', defval: true },
  { key: 'labels', title: 'Labels', type: 'bool', defval: true },
  { key: 'hiColor', title: 'Swing high swept', type: 'color', defval: DN },
  { key: 'loColor', title: 'Swing low swept', type: 'color', defval: UP }
];
const SCHEMA = { [ABS_TYPE]: ABS_SCHEMA, [IMB_TYPE]: IMB_SCHEMA, [TPO_TYPE]: TPO_SCHEMA, [EVR_TYPE]: EVR_SCHEMA, [SWP_TYPE]: SWP_SCHEMA };

// ---------------------------------------------------------------- natives
let H = null;   // hooks from chart-footprint.js
class ProNative {
  constructor(type) { this.type = type; this.schema = SCHEMA[type]; this.inputs = defaults(this.schema); this.tm = 0; this.on = false; this.memo = new Map(); this.onAny = () => this.later(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(this.schema), inputs); this.on = true; H.use(); H.subscribe(this.onAny); this.render(); }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() { this.later(); }
  onViewport() { if (this.type === TPO_TYPE || this.type === SWP_TYPE) this.push(); }
  setInputs(i) { this.inputs = Object.assign(defaults(this.schema), i); this.memo.clear(); this.render(); }
  suspend() { this.on = false; H.unsubscribe(this.onAny); this.push(); }
  resume() { this.on = true; H.subscribe(this.onAny); this.render(); }
  stop() { this.on = false; H.unsubscribe(this.onAny); clearTimeout(this.tm); H.unuse(); this.push(); }   // a last frame with on=false clears the layer
  flow(bars) { return H.flowFor({ root: H.rootOf(this.ctx), timeframe: this.ctx.timeframe, bars, owner: this }); }
  render() {
    if (!this.ctx) return;
    const bars = this.ctx.bars();
    if (this.type === TPO_TYPE) { this.renderTpo(bars); return; }
    if (this.type === SWP_TYPE) { this.renderSweep(bars); return; }
    const f = this.flow(bars);
    const tables = !H.rootOf(this.ctx) ? [note(this.type + '-msg', NO_DATA)] : f.note ? [note(this.type + '-msg', f.note, f.locked)] : [];
    this.ctx.setStatus(f.loading ? 'loading' : 'idle');
    if (this.type === EVR_TYPE) { this.renderEvr(bars, f, tables); return; }
    this.ctx.emit({ tables });
    this.push();
  }
  push() { try { this.ctx.pushData({ owner: this, v: H.version(), on: this.on, i: JSON.stringify(this.inputs), n: this.ctx.bars().length }); } catch (e) {} }
  renderTpo(bars) {
    const tf = tfMin(this.ctx.timeframe);
    const tables = tf == null || tf > num(this.inputs.period, 30) ? [note('stk_of_tpo-msg', 'Market Profile needs a chart timeframe of ' + num(this.inputs.period, 30) + ' minutes or less.')] : [];
    this.ctx.setStatus('idle');
    this.ctx.emit({ tables });
    this.push();
  }
  // Stop runs: works on any symbol with volume (order-flow volume preferred, see sweepBars).
  renderSweep(bars) {
    if (H.rootOf(this.ctx)) this.flow(bars);   // starts the order-flow load where it exists
    const tables = bars.length && !bars.some((b) => b.volume > 0) && !H.rootOf(this.ctx) ? [note('stk_of_sweep-msg', 'Stop Runs / Sweeps needs bars with volume.')] : [];
    this.ctx.setStatus('idle');
    this.ctx.emit({ tables });
    this.push();
  }
  // Effort vs Result: real traded volume per bar where order flow exists, else the feed's volume.
  renderEvr(bars, f, tables) {
    const I = this.inputs, map = f.map || new Map();
    const items = bars.map((b) => {
      const x = map.get(b.time);
      return x ? { vol: x.vol, range: (x.hi - x.lo + 1) * (f.tick || 1) } : { vol: b.volume || 0, range: Math.max(b.high - b.low, 0) };
    });
    const flowOk = !!map.size;
    const er = effortResult(items, { lookback: clamp(Math.round(num(I.lookback, 20)), 5, 200), minEffort: num(I.minEffort, 1.5), ratio: num(I.ratio, 2) });
    const eff = [], res = [];
    bars.forEach((b, i) => {
      const x = er[i];
      if (x.e == null) { eff.push({ time: b.time, value: null }); res.push({ time: b.time, value: null }); return; }
      const fl = x.flag === 1 ? I.flagColor : x.flag === 2 && I.reverse !== false ? I.revColor : rgba(I.effortColor, 0.85);
      eff.push({ time: b.time, value: +x.e.toFixed(3), color: fl });
      res.push({ time: b.time, value: +x.r.toFixed(3) });
    });
    if (!flowOk && !bars.some((b) => b.volume > 0)) tables = [note('stk_of_evr-msg', 'Effort vs Result needs volume.')];
    else if (!flowOk) tables = [];   // candle volume works everywhere: no order-flow note needed
    this.ctx.emit({
      series: [
        { id: 'evr-effort', title: 'Effort (volume x avg)', paneId: '', kind: 'histogram', points: eff, style: { color: I.effortColor, width: 1, lineStyle: 'solid', base: 0 } },
        { id: 'evr-result', title: 'Result (range x avg)', paneId: '', kind: 'line', points: res, style: { color: I.resultColor, width: 2, lineStyle: 'solid' } }
      ],
      priceLines: [{ id: 'evr-one', paneId: '', price: 1, color: light() ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.28)', lineStyle: 'dashed', width: 1, title: '' }],
      tables
    });
  }
}

// ---------------------------------------------------------------- layers
function frame(canvas, a) {
  const g = canvas && canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const d = a.data;
  if (!d || !d.owner || !d.owner.on || !d.owner.ctx || !a.bars || !a.bars.length) return null;
  const dpr = a.coords.dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.save(); g.beginPath(); g.rect(0, a.bounds.top, a.coords.width, a.bounds.height); g.clip();
  return g;
}
const Y = (a, p) => a.coords.priceToY(p, a.scale, a.bounds);
function tag(g, x, y, txt, col, phone, avoid, out) {
  g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textBaseline = 'middle'; g.textAlign = 'right';
  const w = g.measureText(txt).width + 8;
  // Phone (Owner 2026-10-26): step aside for the GEX tags and the indicators' Pine text at the right
  // edge (they come from chart-gex-levels.js / chart-pine-tv-style.js via the plot element): slide
  // left along the row past whatever it meets, else move one row up or down. Desktop: unchanged.
  if (phone && avoid && avoid.length) {
    const hit = (xr, yy) => avoid.some((q) => xr - w < q.right + 2 && q.left - 2 < xr && yy - 7 < q.bottom && q.top < yy + 7);
    let xr = x, k = 0;
    while (hit(xr, y) && k++ < 6) { const h = avoid.filter((q) => xr - w < q.right + 2 && q.left - 2 < xr && y - 7 < q.bottom && q.top < y + 7); xr = Math.min(...h.map((q) => q.left)) - 3; }
    if (hit(xr, y) || xr - w < x * 0.35) {
      xr = x;
      for (const dy of [-16, 16, -32, 32]) if (!hit(x, y + dy)) { y += dy; break; }
    }
    x = xr;
  }
  g.fillStyle = plateC(); g.fillRect(x - w, y - 7, w, 14);
  g.fillStyle = col; g.fillText(txt, x - 4, y);
  if (out) out.push({ left: x - w, top: y - 7, right: x, bottom: y + 7, text: txt });
}

// Absorption: events on the 1-minute bars (same on every chart timeframe), mapped to chart bars.
function absLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a);
      if (!g) return;
      try {
        const inst = a.data.owner, I = inst.inputs, co = a.coords, phone = co.width < 520;
        const f = inst.flow(a.bars);
        const M = f.mins || [];
        if (!M.length) return;
        const last = M[M.length - 1];
        const key = M.length + '|' + M[0].t + '|' + last.t + '|' + last.vol + '|' + I.volMult + '|' + I.densMult + '|' + I.minDeltaPct + '|' + I.breakTicks;
        let st = inst.memo.get('abs');
        if (!st || st.key !== key) {
          const ev = absorptionEvents(M, { volMult: num(I.volMult, 1.2), densMult: num(I.densMult, 1.3), minDeltaPct: num(I.minDeltaPct, 8) });
          const br = levelBreaks(ev, M, clamp(Math.round(num(I.breakTicks, 2)), 0, 200));
          st = { key, ev: ev.map((e, k) => ({ t: e.t, side: e.side, price: e.level * f.tick, vol: e.vol, brokeT: br[k] < 0 ? null : M[br[k]].t })) };
          inst.memo.set('abs', st);
        }
        const vr = co.visibleLogicalRange(), ppb = co.pxPerBar();
        const tA = a.bars[clamp(Math.floor(vr.from), 0, a.bars.length - 1)].time;
        const top = a.bounds.top, bot = top + a.bounds.height;
        // phone: the right-edge tags avoid the GEX tags + Pine text (rects hung on the plot element)
        const pl = phone ? canvas.parentElement : null;
        const avoid = pl ? [].concat(pl.__stkGexBoxes || [], pl.__stkPineRects || []) : null;
        const tagsOut = phone ? [] : null;
        for (const e of st.ev) {
          if (e.brokeT != null && (e.brokeT < tA || I.broken === false)) continue;
          const i = idxOf(a.bars, e.t);
          if (i < 0) continue;
          const x = co.logicalToX(i), y = Y(a, e.price);
          if (y < top - 10 || y > bot + 10) continue;
          const col = e.side ? (I.resColor || SELL) : (I.supColor || UP);
          const held = e.brokeT == null;
          const xe = held ? co.width : co.logicalToX(idxOf(a.bars, e.brokeT)) + ppb / 2;
          // level line
          g.setLineDash(held ? [] : [3, 3]); g.lineWidth = 1; g.strokeStyle = rgba(col, held ? 0.7 : 0.35);
          g.beginPath(); g.moveTo(x, y); g.lineTo(Math.max(x, xe), y); g.stroke(); g.setLineDash([]);
          // marker: a small square turned 45 degrees at the absorbed price
          const r = phone ? 5 : 6;
          g.fillStyle = rgba(col, held ? 1 : 0.7); g.strokeStyle = light() ? '#ffffff' : '#0b0b0d'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke();
          if (held && I.labels !== false) { tag(g, co.width - 2, y, 'ABS ' + fmtK(e.vol), col, phone, avoid && avoid.concat(tagsOut), tagsOut); }
        }
        canvas.__stkAbsTags = tagsOut;   // test hook (phone only)
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// Imbalance zones on the chart's own bars (stacked imbalances per bar), extending until filled.
function imbLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a);
      if (!g) return;
      try {
        const inst = a.data.owner, I = inst.inputs, co = a.coords, phone = co.width < 520;
        const f = inst.flow(a.bars);
        const L = f.list || [];
        if (!L.length) return;
        const m = clamp(Math.round(num(I.rowTicks, 1)), 1, 100), ratio = clamp(num(I.ratio, 300), 110, 2000) / 100, stack = clamp(Math.round(num(I.stack, 3)), 2, 10);
        const last = L[L.length - 1];
        const key = L.length + '|' + L[0].t + '|' + last.t + '|' + last.vol + '|' + m + '|' + ratio + '|' + stack;
        let st = inst.memo.get('imb');
        if (!st || st.key !== key) {
          const zs = imbalanceZones(L, { m, ratio, stack });
          st = { key, zs: zs.map((z) => ({ t: z.t, side: z.side, lo: z.lo * f.tick, hi: (z.hi + 1) * f.tick, vol: z.vol, fillT: z.fill < 0 ? null : L[z.fill].t })) };
          inst.memo.set('imb', st);
        }
        const vr = co.visibleLogicalRange(), ppb = co.pxPerBar();
        const tA = a.bars[clamp(Math.floor(vr.from), 0, a.bars.length - 1)].time, tB = a.bars[clamp(Math.ceil(vr.to), 0, a.bars.length - 1)].time;
        const top = a.bounds.top, bot = top + a.bounds.height;
        const faded = I.filled !== 'hidden';
        // filled first (underneath), then the open ones
        for (const pass of [0, 1]) {
          for (const z of st.zs) {
            const open = z.fillT == null;
            if ((pass === 1) !== open) continue;
            if (!open && (!faded || z.fillT < tA)) continue;
            if (z.t > tB) continue;
            const i = idxOf(a.bars, z.t);
            if (i < 0) continue;
            const x0 = co.logicalToX(i) - ppb / 2, x1 = open ? co.width : co.logicalToX(idxOf(a.bars, z.fillT)) + ppb / 2;
            const y0 = Y(a, z.hi), y1 = Y(a, z.lo);
            const hh = Math.abs(y1 - y0), h = Math.max(3, hh), yT = Math.min(y0, y1) - (h - hh) / 2;
            if (yT > bot || yT + h < top || x1 < 0) continue;
            const col = z.side ? (I.buyColor || UP) : (I.sellColor || SELL);
            // a flat slab in the zone colour (solid on the first bar, then faint), no outline box
            g.fillStyle = rgba(col, open ? 0.16 : 0.05); g.fillRect(x0, yT, Math.max(2, x1 - x0), h);
            if (open) {
              g.fillStyle = rgba(col, 0.85); g.fillRect(x0, yT, Math.max(2, Math.min(ppb, x1 - x0)), h);
              g.strokeStyle = rgba(col, 0.75); g.lineWidth = 1;
              const ye = z.side ? yT + h - 0.5 : yT + 0.5;   // buy zone: its low edge; sell zone: its high edge
              g.beginPath(); g.moveTo(x0, ye); g.lineTo(x1, ye); g.stroke();
            }
          }
        }
        // tags for the open zones nearest price (at most 6, so the axis stays readable)
        const lastP = a.bars[a.bars.length - 1].close;
        const opens = st.zs.filter((z) => z.fillT == null).sort((p, q) => Math.abs((p.lo + p.hi) / 2 - lastP) - Math.abs((q.lo + q.hi) / 2 - lastP)).slice(0, phone ? 4 : 6);
        const used = [];
        for (const z of opens) {
          const y = Y(a, (z.lo + z.hi) / 2);
          if (y < top + 6 || y > bot - 6 || used.some((u) => Math.abs(u - y) < 15)) continue;
          used.push(y);
          tag(g, co.width - 2, y, (z.side ? 'Buy imb ' : 'Sell imb ') + fmtK(z.vol), z.side ? (I.buyColor || UP) : (I.sellColor || SELL), phone);
        }
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// Market Profile (TPO). Sessions from the chart's bars (time at price needs no volume).
function niceTick(price) {
  const raw = Math.abs(price) * 0.00005;
  if (!(raw > 0)) return 0.01;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
// Auto row: about 40 rows over the session, made coarser until a row is at least minRowPx tall.
const STEPS = [1, 2, 2.5, 4, 5, 10, 20, 25, 40, 50, 100, 200, 250, 400, 500, 1000, 2000, 2500, 5000, 10000];
function rowFor(range, tick, tickPx, minRowPx) {
  const base = autoRow(range, tick, 40);
  for (const s of STEPS) { const r = s * tick; if (r + 1e-12 >= base && (r / tick) * tickPx >= minRowPx) return r; }
  return STEPS[STEPS.length - 1] * tick;
}
function tpoSessions(bars, mode, futures) {
  const out = [];
  let cur = null;
  bars.forEach((b, i) => {
    let k;
    if (mode === 'rth' || (mode === 'auto' && futures)) k = rthKey(b.time);
    else if (mode === 'full') k = H.sessionOf(b.time);
    else k = Math.floor(b.time / 86400000);
    if (k == null) { cur = null; return; }
    if (!cur || cur.k !== k) { cur = { k, i0: i, i1: i }; out.push(cur); } else cur.i1 = i;
  });
  return out;
}
function tpoLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a);
      if (!g) return;
      try {
        const inst = a.data.owner, I = inst.inputs, co = a.coords, phone = co.width < 520;
        const tf = tfMin(inst.ctx.timeframe), periodMin = clamp(Math.round(num(I.period, 30)), 5, 120);
        if (tf == null || tf > periodMin) return;
        const root = H.rootOf(inst.ctx);
        const futures = !!root && !/^binance:/.test(root);
        const f = root ? inst.flow(a.bars) : {};
        const lastPx = a.bars[a.bars.length - 1].close;
        const tick = f.tick || niceTick(lastPx);
        const vr = co.visibleLogicalRange(), ppb = co.pxPerBar();
        const i0 = clamp(Math.floor(vr.from), 0, a.bars.length - 1), i1 = clamp(Math.ceil(vr.to), 0, a.bars.length - 1);
        const tickPx = Math.abs(Y(a, tick) - Y(a, 0));
        const letters0 = I.style !== 'blocks';
        const minRowPx = letters0 ? (phone ? 9 : 11) : 4;
        const sessKey = 'sess|' + (I.session || 'auto') + '|' + a.bars.length + '|' + a.bars[0].time + '|' + futures;
        let ss = inst.memo.get('sess');
        if (!ss || ss.key !== sessKey) { ss = { key: sessKey, list: tpoSessions(a.bars, I.session || 'auto', futures) }; inst.memo.set('sess', ss); }
        const top = a.bounds.top, bot = top + a.bounds.height;
        for (const s of ss.list) {
          if (s.i1 < i0 || s.i0 > i1) continue;
          const sb = a.bars.slice(s.i0, s.i1 + 1);
          let hi = -Infinity, lo = Infinity;
          for (const b of sb) { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); }
          let row;
          if (I.rowTicks > 0) row = I.rowTicks * tick;
          else row = rowFor(hi - lo, tick, tickPx, minRowPx);
          const pk = s.k + '|' + row + '|' + sb.length + '|' + sb[sb.length - 1].close + '|' + periodMin + '|' + I.va + '|' + I.ib;
          let p = inst.memo.get('tpo|' + s.k);
          if (!p || p.pk !== pk) { p = tpoProfile(sb, { periodMs: periodMin * 60000, row, va: num(I.va, 70), ibPeriods: clamp(Math.round(num(I.ib, 2)), 1, 8) }); if (!p) continue; p.pk = pk; inst.memo.set('tpo|' + s.k, p); }
          const xs = co.logicalToX(s.i0) - ppb / 2, x1 = co.logicalToX(s.i1) + ppb / 2;
          if (x1 < 0 || xs > co.width) continue;
          const x0 = Math.max(xs, 8);   // the session began off-screen: the profile sticks to the left edge
          const maxC = Math.max(...p.counts);
          const span = Math.max(24, (x1 - x0) * clamp(num(I.widthPct, 70), 10, 100) / 100);
          const rowPx = Math.abs(Y(a, row) - Y(a, 0));
          const cellW = Math.min(phone ? 9 : 11, span / Math.max(1, maxC));
          const letters = letters0 && rowPx >= minRowPx && cellW >= (phone ? 6 : 7);
          const col = I.color || TPO_IN, outC = I.outColor || TPO_OUT, pocC = I.pocColor || MAG, vaL = I.vaLineColor || VA_LN;
          const last = s.i1 >= a.bars.length - 1;   // the developing session: lines run to the right edge
          const fs = clamp(Math.floor(Math.min(rowPx * 0.85, cellW * 1.2)), 7, phone ? 9 : 11);
          if (letters) { g.font = '600 ' + fs + 'px ' + MONO; g.textAlign = 'center'; g.textBaseline = 'middle'; }
          // IB bar at the left edge
          const yIbT = Y(a, p.ibHi), yIbB = Y(a, p.ibLo);
          g.fillStyle = rgba('#2f6bff', 0.95); g.fillRect(x0 - 4, Math.min(yIbT, yIbB), 3, Math.max(2, Math.abs(yIbB - yIbT)));
          for (let k = 0; k < p.n; k++) {
            const cnt = p.counts[k];
            if (!cnt) continue;
            const yT = Y(a, (p.r0 + k + 1) * row), yB = Y(a, (p.r0 + k) * row);
            const y = Math.min(yT, yB), h = Math.abs(yB - yT);
            if (y > bot || y + h < top) continue;
            const inVa = k >= p.val && k <= p.vah, isPoc = k === p.poc, single = p.singles.includes(k);
            const c = isPoc ? pocC : inVa ? col : outC;
            if (letters) {
              // a block per period with its letter on it
              p.cols[k].forEach((per, j) => {
                g.fillStyle = rgba(c, isPoc ? 0.95 : inVa ? 0.55 : 0.6);
                g.fillRect(x0 + cellW * j + 0.5, y + 0.5, Math.max(1, cellW - 1), Math.max(1, h - 1));
                g.fillStyle = isPoc ? '#ffffff' : light() ? '#0f172a' : '#e8ecf1';
                g.fillText(tpoLetter(per), x0 + cellW * (j + 0.5), y + h / 2);
              });
            } else {
              g.fillStyle = rgba(c, isPoc ? 0.95 : inVa ? 0.6 : 0.6);
              g.fillRect(x0, y + (h > 3 ? 0.5 : 0), cellW * cnt, Math.max(1, h - (h > 3 ? 1 : 0)));
            }
            if (single) { g.fillStyle = rgba(VIOLET, 0.8); g.fillRect(x0 - 7, y, 3, Math.max(1, h)); }
          }
          // POC / VAH / VAL across the session
          const xEnd = last ? co.width : x1;
          const line = (k, c, w, dash) => { const y = Y(a, (p.r0 + k + 0.5) * row); g.setLineDash(dash); g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y); g.lineTo(xEnd, y); g.stroke(); g.setLineDash([]); return y; };
          const yP = line(p.poc, rgba(pocC, 0.9), 1.5, []);
          const yH = line(p.vah, rgba(vaL, 0.7), 1, [4, 3]);
          const yL = line(p.val, rgba(vaL, 0.7), 1, [4, 3]);
          // pill labels on the developing session, just right of its profile
          if (last && !phone) {
            const px = Math.min(co.width - 64, x0 + span + 10);
            const pill = (y, txt, bg, fg) => { if (y < top + 8 || y > bot - 8) return; g.font = '600 10px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'middle'; const w = g.measureText(txt).width + 12; g.fillStyle = bg; g.beginPath(); if (g.roundRect) g.roundRect(px, y - 7, w, 14, 7); else g.rect(px, y - 7, w, 14); g.fill(); g.fillStyle = fg; g.fillText(txt, px + 6, y + 0.5); };
            pill(yH, 'VAH', rgba(vaL, 0.85), '#0b0b0d'); pill(yP, 'TPOC', rgba(pocC, 0.95), '#ffffff'); pill(yL, 'VAL', rgba(vaL, 0.85), '#0b0b0d');
          }
          if (x1 - x0 > 90) {
            g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = dim();
            const yb = Math.min(bot - 2, Y(a, p.r0 * row) + 14);
            g.fillText('TPO ' + p.periods + ' x ' + periodMin + 'm  IB ' + fmtK(+(p.ibHi - p.ibLo).toFixed(2)), x0, yb);
          }
        }
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// Stop runs / sweeps on the chart's own bars. Volume per bar = the real traded volume from order flow
// when this chart has it for that bar, else the feed's volume.
export function sweepBars(bars, map) {
  return bars.map((b) => { const x = map && map.get(b.time); return { high: b.high, low: b.low, close: b.close, vol: x ? x.vol : (b.volume || 0) }; });
}
function sweepLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a);
      if (!g) return;
      try {
        const inst = a.data.owner, I = inst.inputs, co = a.coords, phone = co.width < 520;
        const f = H.rootOf(inst.ctx) ? inst.flow(a.bars) : {};
        const map = f.map || null;
        const last = a.bars[a.bars.length - 1];
        const key = a.bars.length + '|' + a.bars[0].time + '|' + last.time + '|' + last.high + '|' + last.low + '|' + last.close + '|' + (map ? map.size + ':' + H.version() : 0) + '|' + I.len + '|' + I.volMult + '|' + I.lookback + '|' + I.maxAge;
        let st = inst.memo.get('swp');
        if (!st || st.key !== key) {
          const sb = sweepBars(a.bars, map);
          // the newest bar is still forming: it is not judged until it closes
          const ev = sweepEvents(sb.slice(0, -1), { len: clamp(Math.round(num(I.len, 5)), 2, 50), lookback: clamp(Math.round(num(I.lookback, 20)), 5, 200), volMult: num(I.volMult, 1.5), maxAge: clamp(Math.round(num(I.maxAge, 300)), 20, 2000) });
          st = { key, ev, flow: !!(map && map.size) };
          inst.memo.set('swp', st);
          inst.lastSweeps = ev.length;
        }
        const vr = co.visibleLogicalRange();
        const i0 = Math.floor(vr.from) - 1, i1 = Math.ceil(vr.to) + 1;
        const top = a.bounds.top, bot = top + a.bounds.height;
        const vis = st.ev.filter((e) => e.i >= i0 && e.i <= i1);
        const r = phone ? 4.5 : 5.5, used = [];
        const maxLab = phone ? 6 : 14;
        let labs = 0;
        for (let k = vis.length - 1; k >= 0; k--) {   // newest first: labels go to the latest
          const e = vis[k], col = e.side ? (I.hiColor || DN) : (I.loColor || UP);
          const x = co.logicalToX(e.i), yL = Y(a, e.level), yX = Y(a, e.extreme);
          if (I.lines !== false) {
            const xp = co.logicalToX(e.p);
            g.setLineDash([2, 3]); g.strokeStyle = rgba(col, 0.75); g.lineWidth = 1;
            g.beginPath(); g.moveTo(xp, yL); g.lineTo(x, yL); g.stroke(); g.setLineDash([]);
          }
          // a triangle beyond the wick, pointing back inside (down above a swept high, up below a swept low)
          const off = r + 3, ty = e.side ? yX - off : yX + off;
          if (ty < top - 10 || ty > bot + 10) continue;
          g.fillStyle = col; g.strokeStyle = light() ? '#ffffff' : '#0b0b0d'; g.lineWidth = 1;
          g.beginPath();
          if (e.side) { g.moveTo(x - r, ty - r); g.lineTo(x + r, ty - r); g.lineTo(x, ty + r * 0.6); }
          else { g.moveTo(x - r, ty + r); g.lineTo(x + r, ty + r); g.lineTo(x, ty - r * 0.6); }
          g.closePath(); g.fill(); g.stroke();
          if (I.labels === false || labs >= maxLab) continue;
          const txt = (phone ? (e.side ? 'Sweep H' : 'Sweep L') : (e.side ? 'Swept high ' : 'Swept low ') + e.volX.toFixed(1) + 'x');
          g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textBaseline = 'middle'; g.textAlign = 'center';
          const w = g.measureText(txt).width + 8, ly = e.side ? ty - r - 10 : ty + r + 10;
          if (ly < top + 7 || ly > bot - 7 || used.some((u) => Math.abs(u.y - ly) < 15 && Math.abs(u.x - x) < (u.w + w) / 2 + 2)) continue;
          used.push({ x, y: ly, w }); labs++;
          g.fillStyle = plateC(); g.fillRect(x - w / 2, ly - 7, w, 14);
          g.fillStyle = col; g.fillText(txt, x, ly);
        }
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------- install (from installFootprint)
let installed = false;
export function installOfPro(Core, hooks) {
  if (installed) return;
  installed = true;
  H = hooks;
  Core.registerRendererLayer({ id: ABS_TYPE, placement: 'above-data', create: absLayer });
  Core.registerRendererLayer({ id: IMB_TYPE, placement: 'below-data', create: imbLayer });
  Core.registerRendererLayer({ id: TPO_TYPE, placement: 'below-data', create: tpoLayer });
  Core.registerRendererLayer({ id: SWP_TYPE, placement: 'above-data', create: sweepLayer });
  const reg = (type, title, short, pane, overlay, extra) => Core.registerNativeIndicator(Object.assign({ type, title, shortTitle: short, paneHint: pane, overlay,
    inputsSchema: () => SCHEMA[type], defaultInputs: () => defaults(SCHEMA[type]), create: () => new ProNative(type) }, extra || {}));
  reg(ABS_TYPE, 'Absorption (levels until broken)', 'Absorption', 'price', true);
  reg(IMB_TYPE, 'Imbalance Zones (stacked, until filled)', 'Imbalance Zones', 'price', true);
  reg(TPO_TYPE, 'Market Profile (TPO)', 'TPO', 'price', true, { reactsToViewport: true });
  reg(EVR_TYPE, 'Effort vs Result', 'Effort vs Result', 'new', false);
  reg(SWP_TYPE, 'Stop Runs / Sweeps (swing high / low + volume spike)', 'Sweeps', 'price', true, { reactsToViewport: true });
}
// Read-only handle for the browser suite.
if (typeof window !== 'undefined') window.__stkOfPro = { PRO_TYPES };
