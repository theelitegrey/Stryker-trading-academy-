// TradeZoro — Charts: "Camarilla Pivots" (native overlay, price pane, Free for every plan). Maths: assets/chart-camarilla-data.js.
// Draws, for each of the last N sessions, the Camarilla levels of the PRIOR session (R5 R4 RB3 R3 R2 R1, Y-High / Y-Close / Y-Low,
// S1 S2 S3 SB3 S4 S5) as horizontal segments from the session start to its end (today's runs to the right edge), the R3-RB3 zone
// shaded red and the S3-SB3 zone shaded green, a name tag at the right end and a price tag on the price axis for the newest set.
// Computed from this chart's own bars (nothing is fetched). Daily / Weekly / Monthly. Intraday charts (a Daily set on a daily or
// longer chart, a Weekly set on a weekly chart ...) show only the newest set. Education only. Not financial advice.
// Depends on: Vela plugin SDK (registerNativeIndicator / registerRendererLayer / registerStatePersistence), as chart-market-stats.js.
import * as D from './chart-camarilla-data.js?v=970';

const TYPE = 'stk_camarilla';
const PERIODS = { Daily: 'D', Weekly: 'W', Monthly: 'M' };
const SCHEMA = [
  { key: 'period', title: 'Timeframe', type: 'string', defval: 'Daily', options: Object.keys(PERIODS) },
  { key: 'days', title: 'Past sessions to show', type: 'int', defval: 5, min: 1, max: 30, step: 1 },
  { key: 'g5', title: 'R5 / S5', type: 'bool', defval: true },
  { key: 'g4', title: 'R4 / S4', type: 'bool', defval: true },
  { key: 'g3', title: 'R3 / S3 (and RB3 / SB3)', type: 'bool', defval: true },
  { key: 'bands', title: 'Shade the R3-RB3 and S3-SB3 zones', type: 'bool', defval: true },
  { key: 'g2', title: 'R2 / S2', type: 'bool', defval: true },
  { key: 'g1', title: 'R1 / S1', type: 'bool', defval: true },
  { key: 'yh', title: 'Y-High', type: 'bool', defval: true },
  { key: 'yc', title: 'Y-Close', type: 'bool', defval: true },
  { key: 'yl', title: 'Y-Low', type: 'bool', defval: true },
  { key: 'labels', title: 'Labels', type: 'bool', defval: true },
  { key: 'priceTags', title: 'Price tags on the axis', type: 'bool', defval: true },
  { key: 'width', title: 'Line width', type: 'int', defval: 1, min: 1, max: 4, step: 1 },
  { key: 'lineColor', title: 'R / S line colour', type: 'color', defval: '#4a5bd4' },
  { key: 'yhColor', title: 'Y-High colour', type: 'color', defval: '#1fa35a' },
  { key: 'ycColor', title: 'Y-Close colour', type: 'color', defval: '#f08c1b' },
  { key: 'ylColor', title: 'Y-Low colour', type: 'color', defval: '#e5484d' },
  { key: 'rZone', title: 'Resistance zone colour', type: 'color', defval: '#ff7a59' },
  { key: 'sZone', title: 'Support zone colour', type: 'color', defval: '#2fbf5b' }
];
const defaults = () => Object.fromEntries(SCHEMA.map((s) => [s.key, s.defval]));
const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

// chart timeframe -> ms per bar (null when unknown)
export function tfMs(tf) {
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) return +tf * 60000;
  const m = /^(\d*)([SDWM])$/i.exec(tf);
  if (!m) return null;
  const n = m[1] ? +m[1] : 1, u = m[2].toUpperCase();
  return n * { S: 1000, D: 86400000, W: 7 * 86400000, M: 30 * 86400000 }[u];
}
const PERIOD_MS = { D: 86400000, W: 7 * 86400000, M: 28 * 86400000 };
export function fmtPrice(p, dec) { return p.toFixed(dec != null ? dec : p < 1 ? 6 : p < 10 ? 5 : 2); }

// The lines of one level set for the current inputs (pure).
export function visibleLevels(levels, I) {
  const out = [];
  for (const id of D.LEVEL_ORDER) {
    if (I[D.LEVEL_GROUP[id]] === false) continue;
    out.push({ id, label: D.LEVEL_LABEL[id], price: levels[id] });
  }
  return out;
}

class CamNative {
  constructor() { this.ctx = null; this.inputs = defaults(); this.sig = ''; this.tick = 0; this.tickFor = ''; }
  // the symbol's min-move (async; re-pushes once known) so every level is rounded to the tick, as the price axis does
  loadTick() {
    const sym = this.ctx.symbol;
    if (this.tickFor === sym) return;
    this.tickFor = sym; this.tick = 0;
    try { Promise.resolve(this.ctx.data.symbolInfo(sym)).then((si) => { if (this.tickFor !== sym || !si) return; const t = si.mintick > 0 ? si.mintick : si.minmove > 0 && si.pricescale > 0 ? si.minmove / si.pricescale : 0; if (t > 0) { this.tick = t; this.push(); } }).catch(() => {}); } catch (e) {}
  }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(), inputs); this.push(); this.kick(); }
  kick() { try { setTimeout(() => { const c = window.STRYKER_VELA.active.chart; c.__stkPager && c.__stkPager.kick(); }, 0); } catch (e) {} }   // history pager: load the bars the levels need
  onBars() { this.push(); }
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(defaults(), i); this.sig = ''; this.push(); this.kick(); }
  suspend() {}
  resume() { this.sig = ''; this.push(); }
  stop() { try { this.ctx.pushData(null); } catch (e) {} }
  push() {
    if (!this.ctx) return;
    this.loadTick();
    const I = this.inputs, period = PERIODS[I.period] || 'D';
    let payload = { note: 'Loading bars…' };
    try {
      const bars = this.ctx.bars() || [], ms = tfMs(this.ctx.timeframe);
      let provider = '';
      try { const r = this.ctx.data.resolve(this.ctx.symbol); if (r) provider = r.provider; } catch (e) {}
      if (bars.length && ms) {
        if (ms > PERIOD_MS[period]) payload = { note: 'Camarilla ' + I.period + ' needs a chart shorter than ' + (period === 'D' ? 'daily' : period === 'W' ? 'weekly' : 'monthly') };
        else {
          // a chart whose bars are as long as the period shows only the newest level set
          const days = ms >= PERIOD_MS[period] * 0.9 ? 1 : num(I.days, 5, 1, 30);
          const sets = D.levelSets(bars, period, provider === 'futures', ms, days);
          payload = sets.length ? { sets: sets.map((s) => ({ start: s.start, end: s.end, last: s.last, lines: visibleLevels(s.levels, I).map((l) => ({ ...l, price: D.roundTick(l.price, this.tick) })) })) } : { note: 'Not enough history for the previous ' + I.period.toLowerCase() + ' session yet' };
        }
      }
    } catch (e) { payload = { note: 'Camarilla: waiting for bars' }; }
    if (payload.sets) Object.assign(payload, { opt: { dec: this.tick > 0 ? D.tickDecimals(this.tick) : null, bands: I.bands !== false, g3: I.g3 !== false, labels: I.labels !== false, priceTags: I.priceTags !== false, width: num(I.width, 1, 1, 4),
      c: { line: I.lineColor, YH: I.yhColor, YC: I.ycColor, YL: I.ylColor, rz: I.rZone, sz: I.sZone } } });
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (e) {}
  }
}

// ---- renderer layer -----------------------------------------------------------------------------
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
const isLight = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
const TAG_H = 16;
// Push tags apart so none overlaps (top to bottom), keeping order.
export function spread(ys, gap, top, bot) {
  const out = ys.slice();
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1] + gap) out[i] = out[i - 1] + gap;
  const over = out.length ? out[out.length - 1] - bot : 0;
  if (over > 0) { for (let i = out.length - 1; i >= 0; i--) { const lim = i === out.length - 1 ? bot : out[i + 1] - gap; out[i] = Math.min(out[i], lim); } }
  return out.map((y) => Math.max(top, y));
}
function layer() {
  let canvas = null, chip = null, last = '', axis = null;
  // The price axis is painted after the layer canvases (it would cover tags drawn on them), so the axis tags get their own canvas on top.
  function axisCanvas() {
    if (!axis && canvas && canvas.parentElement) {
      axis = document.createElement('canvas');
      axis.style.cssText = 'position:absolute;inset:0;width:' + canvas.style.width + ';height:' + canvas.style.height + ';pointer-events:none;z-index:4';
      canvas.parentElement.appendChild(axis);
    }
    if (axis) { axis.style.width = canvas.style.width; axis.style.height = canvas.style.height; if (axis.width !== canvas.width) axis.width = canvas.width; if (axis.height !== canvas.height) axis.height = canvas.height; }
    return axis;
  }
  function paintChip(text) {
    if (!chip && canvas && canvas.parentElement && text) {
      chip = document.createElement('div');
      chip.className = 'stk-gex-chip stk-cam-chip';
      chip.hidden = true;
      canvas.parentElement.appendChild(chip);
    }
    if (!chip || text === last) return;
    last = text; chip.hidden = !text;
    chip.style.right = 'auto'; chip.style.left = '8px'; chip.style.bottom = '32px';
    chip.classList.add('is-note'); chip.textContent = text;
  }
  return {
    mount(cv) { canvas = cv; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const co = a.coords, dpr = co.dpr || 1;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      const ax = axisCanvas(), ag = ax && ax.getContext('2d');
      if (ag) { ag.setTransform(1, 0, 0, 1, 0, 0); ag.clearRect(0, 0, ax.width, ax.height); }
      const d = a.data;
      paintChip(d && d.note ? d.note : '');
      canvas.__stkCam = [];
      if (!d || !d.sets) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = co.width, top = a.bounds.top, H = a.bounds.height, bot = top + H;
      const fullW = canvas.width / dpr, o = d.opt, light = isLight();
      const Y = (p) => co.priceToY(p, a.scale, a.bounds);
      const colorOf = (id) => (id === 'YH' || id === 'YC' || id === 'YL' ? o.c[id] : o.c.line);
      g.save(); g.beginPath(); g.rect(0, top, W, H); g.clip();
      const font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Segoe UI", sans-serif';
      g.font = font; g.textBaseline = 'middle';
      let newest = null;
      for (const s of d.sets) {
        const x0 = Math.max(0, co.timeToX(s.start)), x1 = s.last ? W : Math.min(W, co.timeToX(s.end));
        if (!(x1 > x0)) continue;
        const P = {}; s.lines.forEach((l) => { P[l.id] = l.price; });
        if (o.bands && o.g3) {
          [['RB3', 'R3', o.c.rz], ['SB3', 'S3', o.c.sz]].forEach(([p, q, c]) => {
            if (P[p] == null || P[q] == null) return;
            const ya = Y(P[p]), yb = Y(P[q]);
            g.fillStyle = rgba(c, light ? 0.3 : 0.32);
            g.fillRect(x0, Math.min(ya, yb), x1 - x0, Math.abs(yb - ya));
          });
        }
        for (const l of s.lines) {
          const y = Math.round(Y(l.price)) + 0.5;
          if (!(y >= top - 2 && y <= bot + 2)) continue;
          g.strokeStyle = colorOf(l.id); g.lineWidth = o.width;
          g.setLineDash(l.id === 'YH' || l.id === 'YC' || l.id === 'YL' ? [6, 4] : []);
          g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
        }
        g.setLineDash([]);
        if (s.last) newest = s;
      }
      // name tags (right end) and axis price tags for the newest set, nudged apart
      const painted = [];
      if (newest) {
        const items = newest.lines.map((l) => ({ l, y: Math.round(Y(l.price)) })).filter((t) => t.y >= top && t.y <= bot).sort((p, q) => p.y - q.y);
        const ys = spread(items.map((t) => t.y), TAG_H - 2, top + TAG_H / 2, bot - TAG_H / 2);
        items.forEach((t, i) => { t.ty = ys[i]; });
        if (o.labels) {
          for (const t of items) {
            const w = Math.ceil(g.measureText(t.l.label).width) + 10, x = Math.max(2, W - w - 4);
            g.fillStyle = rgba(colorOf(t.l.id), 0.95); g.fillRect(x, t.ty - TAG_H / 2, w, TAG_H);
            g.fillStyle = '#ffffff'; g.fillText(t.l.label, x + 5, t.ty + 0.5);
          }
        }
        painted.push(...items.map((t) => ({ id: t.l.id, price: t.l.price, y: t.y })));
      }
      g.restore();
      const axW = fullW - W;
      if (newest && o.priceTags && axW > 24 && ag) {
        ag.setTransform(dpr, 0, 0, dpr, 0, 0);
        ag.save(); ag.beginPath(); ag.rect(W, top, axW, H); ag.clip(); ag.font = font; ag.textBaseline = 'middle';
        for (const l of newest.lines) {
          const y = Y(l.price);
          if (!(y >= top && y <= bot)) continue;
          ag.fillStyle = colorOf(l.id); ag.fillRect(W + 1, y - 8, axW - 2, 16);
          ag.fillStyle = '#ffffff'; ag.fillText(fmtPrice(l.price, o.dec), W + 6, y + 0.5);
        }
        ag.restore();
      }
      canvas.__stkCam = painted; canvas.__stkCamDim = { W, fullW, axW };   // test hook
    },
    destroy() { if (chip) chip.remove(); if (axis) axis.remove(); chip = null; axis = null; canvas = null; }
  };
}

// ---- registration + persistence ---------------------------------------------------------------
let installed = false;
export function installCamarilla(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: TYPE, placement: 'above-data', create: layer });
  Core.registerNativeIndicator({
    type: TYPE, title: 'Camarilla Pivots', shortTitle: 'Camarilla', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: defaults, create: () => new CamNative(),
    legendNote: (d) => (d && d.note ? d.note : '')
  });
  Core.registerStatePersistence({
    key: 'stryker.camarilla', scope: 'cell',
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
export const CAM_TYPE = TYPE;
