// TradeZoro — Charts: "Bar Stats" indicator (Owner 17 Nov 2026), group Order Flow. Works on every chart style.
// The table drawing and the per-bar maths are shared with the Footprint chart's "Bar stats table" (assets/chart-bar-stats.js),
// the data is the Footprint's own per-bar order flow (same engine, same bars, so the numbers match). A bar without order flow
// shows a dash; a symbol without order flow shows one short note. Nothing is estimated from candles.
// Education only. Not financial advice.
import { TABLE_ROWS, TOP_OFF, TOP_OFF_PHONE, drawTable, drawNote, NOTE_H } from './chart-bar-stats.js?v=1104';

export const BS_TYPE = 'stk_barstats';
export const BS_TYPES = [BS_TYPE];
const UP = '#03c988', DN = '#f23645', MIN_BW = 30;   // narrower bars: the numbers cannot be read, so a hint replaces the table
const ROW_KEY = { vol: 'showVol', delta: 'showDelta', dpct: 'showDpct', buy: 'showBuy', sell: 'showSell', trd: 'showTrd' };
const SCHEMES = { 'Heat map (default)': { up: UP, dn: DN, vol: '#00adb5' }, 'Blue / orange': { up: '#38bdf8', dn: '#fb923c', vol: '#8a90a0' }, 'Grey volume': { up: UP, dn: DN, vol: '#64748b' } };
const SIZES = { Small: -1, Normal: 0, Large: 2, 'Extra large': 4 };
export const SCHEMA = [
  ...TABLE_ROWS.map(([k, name]) => ({ key: ROW_KEY[k], title: 'Row: ' + name, type: 'bool', defval: true })),
  { key: 'position', title: 'Position', type: 'string', defval: 'Bottom', options: ['Bottom', 'Top'] },
  { key: 'labelSide', title: 'Row labels', type: 'string', defval: 'Right', options: ['Right', 'Left'] },
  { key: 'scheme', title: 'Colour scheme', type: 'string', defval: 'Heat map (default)', options: Object.keys(SCHEMES) },
  { key: 'textSize', title: 'Text size', type: 'string', defval: 'Normal', options: Object.keys(SIZES) },
  { key: 'opacity', title: 'Opacity %', type: 'int', defval: 100, min: 20, max: 100, step: 5 }
];
const defaults = () => Object.fromEntries(SCHEMA.map((i) => [i.key, i.defval]));
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
export function cfgOf(I) {
  const sc = SCHEMES[I.scheme] || SCHEMES['Heat map (default)'], op = Number(I.opacity);
  return { adj: SIZES[I.textSize] != null ? SIZES[I.textSize] : 0, tblPos: (I.position === 'Top' ? 't' : 'b') + (I.labelSide === 'Left' ? 'l' : 'r'),
    tblHide: TABLE_ROWS.filter((r) => I[ROW_KEY[r[0]]] === false).map((r) => r[0]), dash: true, allRows: true, deltaSym: true, volC: sc.vol,
    opacity: Number.isFinite(op) ? Math.min(1, Math.max(0.2, op / 100)) : 1, up: sc.up, dn: sc.dn };
}

let H = null;   // hooks from chart-footprint.js: { makeEngine, flowOf, rootOf, tfMin, use, unuse, subscribe, unsubscribe, version }
class BarStats {
  constructor() { this.inputs = defaults(); this.on = false; this.tm = 0; this.resTm = 0; this.prev = {}; this.stat = {}; this.onAny = () => this.later(); }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = Object.assign(defaults(), inputs); this.on = true; H.use(); H.subscribe(this.onAny);
    this.eng = H.makeEngine(ctx, () => this.later()); this.push();
  }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.push(); }, 250); }
  onBars() { this.later(); }
  onViewport() { this.push(); }
  setInputs(i) { this.inputs = Object.assign(defaults(), i); this.push(); }
  suspend() { if (!this.on) return; this.on = false; H.unsubscribe(this.onAny); this.release(); this.push(); }
  resume() { if (this.on) return; this.on = true; H.subscribe(this.onAny); this.push(); }
  stop() { if (this.on) { H.unsubscribe(this.onAny); H.unuse(); } this.on = false; clearTimeout(this.tm); this.release(); this.push(); }   // a last frame with on=false clears the layer
  release() { this.reserve(0, 0, 0, true); this.reserve(0, 0, 0); if (this.eng) this.eng.dropL2(); }
  push() { try { this.ctx.pushData({ owner: this, on: this.on, v: H.version(), i: JSON.stringify(this.inputs), n: this.ctx.bars().length, t: Date.now() }); } catch (e) {} }
  // Keep the table's height free at the edge of the price pane (the chart's own margin, % of the pane) so no candle sits under it.
  // The member's own margin is remembered here and put back when the table goes (off, hidden, removed, or changed edge).
  reserve(Hb, ph, Ht, now) {
    const run = () => {
      this.resTm = 0;
      let R; try { const ws = window.STRYKER_VELA, r0 = ws && ws.chart && ws.chart.renderer; R = r0 && (r0.applyConfig ? r0 : r0.renderer); } catch (e) { return; }
      if (!R || !R.applyConfig || !R.getConfig) return;
      let cm; try { cm = R.getConfig().margins; } catch (e) { return; }
      const patch = {};
      for (const [edge, h] of [['bottom', Hb], ['top', Ht]]) {
        const need = h > 0 && ph > 0 ? Math.min(40, Math.ceil((h + 18) / ph * 100)) : 0, prev = this.prev[edge];
        if (need > 0 && (cm[edge] < need - 0.5 || (prev != null && Math.abs(cm[edge] - need) > 1 && cm[edge] > need))) { patch[edge] = need; if (prev == null) this.prev[edge] = cm[edge]; }
        else if (need === 0 && prev != null) { patch[edge] = prev; delete this.prev[edge]; }
      }
      if (Object.keys(patch).length) { try { R.applyConfig({ margins: patch }); } catch (e) {} }
    };
    if (now) { clearTimeout(this.resTm); run(); } else if (!this.resTm) this.resTm = setTimeout(run, 0);
  }
}

function layer() {
  let canvas = null, owns = false;
  // the Fit price / Latest pills move to the top of the pane while a bottom table is up (same class the footprint uses)
  const pills = (want) => { const h = canvas && canvas.closest && canvas.closest('.vela-cell'); if (!h || want === owns) return; h.classList.toggle('stk-fp-stats', want); owns = want; };
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = canvas && canvas.getContext('2d');
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data, dbg = window.__stkBarStatsDebug = window.__stkBarStatsDebug || {};
      dbg.table = null; pills(false);
      if (d && d.owner && !d.owner.on && d.owner.ctx) d.owner.reserve(0, 0, 0);   // hidden / removed: give the margin back
      if (!d || !d.owner || !d.owner.on || !d.owner.ctx || !a.bars || !a.bars.length) return;
      const inst = d.owner, I = inst.inputs, cfg = cfgOf(I), co = a.coords, dpr = co.dpr || 1, day = light(), plotR = co.width - 56, phone = co.width < 520;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = a.bounds.top, bot = top + a.bounds.height, atTop = cfg.tblPos[0] === 't';
      const vr = co.visibleLogicalRange(), i0 = Math.max(0, Math.floor(vr.from) - 1), i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to) + 1), bw = co.pxPerBar();
      const X = { g, co, a, cfg, i0, i1, bw, bot, day, plotR, UP: cfg.up, DN: cfg.dn, dbg, tblY: atTop ? top + (phone ? TOP_OFF_PHONE : TOP_OFF) : null };
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      let Hh = 0;
      try {
        const ctx = inst.ctx, root = H.rootOf(ctx), tfm = H.tfMin(ctx.timeframe), f = H.flowOf(inst.eng, ctx, a.bars, (a.bars[i0] || {}).time);
        const has = f && f.map && f.map.size > 0;
        let msg = '';
        if (!root || (tfm != null && (tfm < 1 || tfm > 240))) msg = !root ? 'Order flow not available for this symbol' : 'Order flow works on 1-minute to 4-hour charts';
        else if (!has) msg = f && /^(Loading|Waiting)/.test(f.note || '') ? f.note : 'Order flow not available for this symbol';
        else if (bw < MIN_BW) msg = 'Zoom in to see bar stats';
        X.f = f;
        if (msg) Hh = drawNote(X, msg); else Hh = drawTable(X);
        dbg.bw = bw; dbg.msg = msg;
      } finally { g.restore(); }
      pills(!atTop && Hh > 0);
      inst.reserve(atTop ? 0 : Hh, a.bounds.height, atTop ? (phone ? TOP_OFF_PHONE : TOP_OFF) + Hh : 0);
    }
  };
}

let installed = false;
export function installBarStats(Core, hooks) {
  if (installed) return;
  installed = true; H = hooks;
  Core.registerRendererLayer({ id: BS_TYPE, placement: 'above-data', create: layer });
  Core.registerNativeIndicator({ type: BS_TYPE, title: 'Bar Stats', shortTitle: 'Bar Stats', paneHint: 'price', overlay: true, reactsToViewport: true,
    inputsSchema: () => SCHEMA, defaultInputs: defaults, create: () => new BarStats() });
}
