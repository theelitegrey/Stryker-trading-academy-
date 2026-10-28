// TradeZoro — Charts: the DELTA suite (Owner order 2026-10-22: "Add and push live all variations
// and one can choose from them"). Two indicators in the "Order Flow" group of the Indicators dialog:
//   - "Delta" (stk_dsuite): drawn on the price chart. Its Style input picks one of the overlay
//     styles (H1 session delta profile by default). It can be added more than once (H1 + H5 ...).
//   - "Delta: pane" (stk_dpane): its own pane. V1 delta bars or V2 CVD candles + divergence.
// Data: the SAME real order flow as Footprint / Delta (trades) / CVD (assets/chart-footprint.js:
// the book-recorder Worker for NQ ES YM GC SI CL, micros on the mini; Binance trades for crypto),
// with the same plan + delay rules and the same refresh timers (no polling of its own). Nothing is
// estimated from candles: a symbol without trade data shows a note instead.
// Depends on: assets/chart-delta-suite-data.js (maths), hooks handed over by installFootprint().
import { STYLES, PANE_STYLES as SUITE_PANE, keyRows, absorption, styleId, deltaProfile, timeBlocks, divergences, bigDeltas, sessionStats, meanAbsDelta, cvdCandles, fmtK, fmtSigned } from './chart-delta-suite-data.js?v=709';

export const DS_TYPE = 'stk_dsuite';
export const DP_TYPE = 'stk_dpane';
const UP = '#03c988', UP2 = '#4fe3ac', SELL = '#9d4dff', CYAN = '#00adb5';   // sellers purple: the same as Big Trades / footprint
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const NO_DATA = 'Delta needs order-flow data. Available on futures (NQ, ES, YM, GC, SI, CL and their micros) and crypto.';
const ROW_STEPS = [1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 200, 400];

export const OVERLAY_STYLES = STYLES.filter((x) => !SUITE_PANE.includes(x));   // H1-H6, V3-V8 (V1, V2 are on "Delta: pane")
export const PANE_STYLES = ['V1 Delta bars', 'V2 CVD + divergence'];

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function light() { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } }
const when = (...ids) => ({ key: 'style', anyOf: OVERLAY_STYLES.filter((s) => ids.includes(styleId(s))) });

const DS_SCHEMA = [
  { key: 'style', title: 'Style', type: 'string', defval: OVERLAY_STYLES[0], options: OVERLAY_STYLES },
  { key: 'rowTicks', title: 'Row size (ticks, 0 = auto)', type: 'int', defval: 0, min: 0, max: 400, step: 1, when: when('H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'V5') },
  { key: 'widthPct', title: 'Profile width %', type: 'int', defval: 25, min: 5, max: 90, step: 1, when: when('H1', 'H2', 'H3', 'H4', 'H5') },
  { key: 'block', title: 'Block length', type: 'string', defval: '30m', options: ['30m', '1h'], when: when('H5') },
  { key: 'recentMin', title: 'Recent window (minutes)', type: 'int', defval: 30, min: 5, max: 240, step: 5, when: when('H4', 'H6') },
  { key: 'mult', title: 'Big / strong delta at (x average |delta|)', type: 'float', defval: 2.5, min: 1, max: 20, step: 0.1, when: when('V3', 'V6') },
  { key: 'keyRows', title: 'Key prices per candle', type: 'int', defval: 5, min: 3, max: 5, step: 1, when: when('V5') },
  { key: 'lastMin', title: 'Last N minutes', type: 'int', defval: 5, min: 1, max: 120, step: 1, when: when('V7') },
  { key: 'boxPos', title: 'Box position', type: 'string', defval: 'top right', options: ['top right', 'bottom right', 'top left'], when: when('V7') },
  { key: 'numbers', title: 'Show numbers', type: 'bool', defval: true },
  { key: 'buyColor', title: 'Buyers', type: 'color', defval: UP },
  { key: 'sellColor', title: 'Sellers', type: 'color', defval: SELL }
];
const DP_SCHEMA = [
  { key: 'style', title: 'Style', type: 'string', defval: PANE_STYLES[0], options: PANE_STYLES },
  { key: 'mult', title: 'Strong bar at (x average |delta|)', type: 'float', defval: 2, min: 1, max: 20, step: 0.1, when: { key: 'style', anyOf: [PANE_STYLES[0]] } },
  { key: 'reset', title: 'CVD reset', type: 'string', defval: 'session', options: ['session', 'day', 'none'], when: { key: 'style', anyOf: [PANE_STYLES[1]] } },
  { key: 'divs', title: 'Mark divergences', type: 'bool', defval: true, when: { key: 'style', anyOf: [PANE_STYLES[1]] } },
  { key: 'buyColor', title: 'Buyers', type: 'color', defval: UP },
  { key: 'sellColor', title: 'Sellers', type: 'color', defval: '#f23645' }
];
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));

function note(id, text, locked) {
  const day = light();
  return { id, paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: locked ? CYAN : (day ? '#334155' : '#a3a9b6'), hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}

let H = null;               // hooks from chart-footprint.js: { flowFor, rootOf, sessionOf, subscribe, unsubscribe, use, unuse, version }
const live = new Set();     // running "Delta" instances (Vela 0.6.17 has one layer canvas for all of them)
const VELA090 = typeof window !== 'undefined' && window.__stkVela090 === true;

class Base {
  constructor(schema) { this.schema = schema; this.inputs = defaults(schema); this.tm = 0; this.on = false; this.onAny = () => this.later(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(this.schema), inputs); this.on = true; H.use(); H.subscribe(this.onAny); this.started(); this.render(); }
  started() {}
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() { this.later(); }
  setInputs(i) { this.inputs = Object.assign(defaults(this.schema), i); this.render(); }
  suspend() { this.on = false; H.unsubscribe(this.onAny); this.render(); }
  resume() { this.on = true; H.subscribe(this.onAny); this.render(); }
  stop() { this.on = false; H.unsubscribe(this.onAny); clearTimeout(this.tm); H.unuse(); this.stopped(); }
  stopped() {}
  flow(bars) { return H.flowFor({ root: H.rootOf(this.ctx), timeframe: this.ctx.timeframe, bars, owner: this }); }
  msgs(f) {
    if (!H.rootOf(this.ctx)) return [note(this.type + '-msg', NO_DATA)];
    return f.note ? [note(this.type + '-msg', f.note, f.locked)] : [];
  }
}

// ---------------------------------------------------------------- "Delta" (price chart)
class SuiteNative extends Base {
  constructor() { super(DS_SCHEMA); this.type = DS_TYPE; this.cache = new Map(); }
  started() { live.add(this); }
  stopped() { live.delete(this); this.push(); }
  render() {
    if (!this.ctx) return;
    const bars = this.ctx.bars();
    const f = this.flow(bars);
    this.ctx.setStatus(f.loading ? 'loading' : 'idle');
    this.ctx.emit({ tables: this.msgs(f) });
    this.push();
  }
  push() {
    if (!this.ctx) return;
    try { this.ctx.pushData({ owner: this, all: !VELA090, v: H.version(), n: live.size, on: this.on, i: JSON.stringify(this.inputs) }); } catch (e) {}
  }
}

// Row size (ticks) for profiles: the input, else the smallest step whose row is >= 4 px tall.
function rowSize(I, tickPx, minPx = 12) {
  if (I.rowTicks > 0) return I.rowTicks;
  for (const s of ROW_STEPS) if (tickPx * s >= minPx) return s;
  return 400;
}
function fontPx(h, phone) { return clamp(Math.floor(h * 0.8), 9, phone ? 10 : 11); }
const sessKey = (f, t) => (f.crypto ? Math.floor(t / 86400000) : H.sessionOf(t));

// One horizontal delta bar per row. dir -1: grows LEFT from x (H1, on the price axis); +1: grows right (H5).
function deltaRows(g, a, p, f, x, span, dir, I, phone, opt = {}) {
  const co = a.coords, top = a.bounds.top, bot = top + a.bounds.height, tick = f.tick, m = p.m;
  const rowPx = Math.abs(co.priceToY(m * tick, a.scale, a.bounds) - co.priceToY(0, a.scale, a.bounds));
  const showNum = I.numbers !== false && rowPx >= (phone ? 12 : 11);
  const fs = fontPx(rowPx, phone);
  const dmax = opt.dmax || p.dmax || 1;
  g.textBaseline = 'middle';
  for (let k = 0; k < p.n; k++) {
    const d = p.delta[k];
    if (!d) continue;
    const r = p.r0 + k;
    const yT = co.priceToY((r + 1) * m * tick, a.scale, a.bounds), yB = co.priceToY(r * m * tick, a.scale, a.bounds);
    const y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (rowPx > 4 ? 1 : 0));
    if (y > bot || y + h < top) continue;
    const len = Math.max(1, span * Math.abs(d) / dmax);
    const col = d > 0 ? I.buyColor : I.sellColor;
    const hot = opt.hot && (r === p.topBuy || r === p.topSell);
    const x0 = dir < 0 ? x - len : x;
    g.fillStyle = rgba(col, hot ? 0.95 : 0.62);
    g.fillRect(x0, y, len, h);
    if (hot) { g.strokeStyle = d > 0 ? UP2 : '#d7c8ff'; g.lineWidth = 1.5; g.strokeRect(x0 + 0.5, y + 0.5, len - 1, h - 1); }
    if (showNum) {
      const txt = fmtK(d);
      g.font = (hot ? '700 ' : '600 ') + fs + 'px ' + MONO;
      const tw = g.measureText(txt).width;
      g.fillStyle = light() ? '#0f172a' : '#f4f4f6';
      if (dir < 0) { g.textAlign = 'right'; g.fillText(txt, x - 4, y + h / 2); }
      else if (tw + 6 <= len || !opt.room || tw + 8 + len <= opt.room) { g.textAlign = 'left'; g.fillText(txt, x + 3, y + h / 2); }
    }
  }
}

function drawH1(g, a, f, I, inst, phone) {
  const co = a.coords, vr = co.visibleLogicalRange();
  const i1 = clamp(Math.ceil(vr.to), 0, a.bars.length - 1);
  // the session of the last visible bar (the current one when the chart is at the right edge)
  const k = sessKey(f, a.bars[i1].time), tLast = a.bars[i1].time;
  const tickPx = Math.abs(co.priceToY(f.tick, a.scale, a.bounds) - co.priceToY(0, a.scale, a.bounds));
  const m = rowSize(I, tickPx);
  const ck = 'h1|' + k + '|' + m + '|' + tLast + '|' + f.list.length + '|' + (f.list.length && f.list[f.list.length - 1].vol);
  let p = inst.cache.get('h1');
  if (!p || p.ck !== ck) {
    const bars = f.list.filter((b) => b.t <= tLast && sessKey(f, b.t) === k);
    p = deltaProfile(bars, m) || { n: 0 };
    p.ck = ck; inst.cache.set('h1', p);
  }
  if (!p.n) return;
  const span = co.width * clamp(num(I.widthPct, 25), 5, 90) / 100 * (phone ? 0.8 : 1);
  deltaRows(g, a, p, f, co.width - 1, span, -1, I, phone, { hot: true });
  // the biggest buy / sell rows: a tag at the axis edge of the profile
  const tag = (r, d) => {
    if (r == null) return;
    const y = co.priceToY((r + 0.5) * m * f.tick, a.scale, a.bounds);
    if (y < a.bounds.top + 8 || y > a.bounds.top + a.bounds.height - 8) return;
    const txt = (d > 0 ? 'Top buy ' : 'Top sell ') + fmtSigned(d);
    g.font = '700 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
    const len = span * Math.abs(d) / (p.dmax || 1), x = co.width - len - 8;
    const w = g.measureText(txt).width + 8;
    g.fillStyle = light() ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.85)'; g.fillRect(x - w, y - 7, w, 14);
    g.fillStyle = d > 0 ? UP2 : '#c4b5fd'; g.fillText(txt, x - 4, y);
  };
  if (p.topBuy != null) tag(p.topBuy, p.delta[p.topBuy - p.r0]);
  if (p.topSell != null) tag(p.topSell, p.delta[p.topSell - p.r0]);
}

function drawH5(g, a, f, I, inst, phone) {
  const co = a.coords, vr = co.visibleLogicalRange(), ppb = co.pxPerBar();
  const i0 = clamp(Math.floor(vr.from), 0, a.bars.length - 1), i1 = clamp(Math.ceil(vr.to), 0, a.bars.length - 1);
  const t0 = a.bars[i0].time, t1 = a.bars[i1].time;
  const blockMin = I.block === '1h' ? 60 : 30;
  const tickPx = Math.abs(co.priceToY(f.tick, a.scale, a.bounds) - co.priceToY(0, a.scale, a.bounds));
  const m = rowSize(I, tickPx, 8);
  const vis = f.list.filter((b) => b.t >= t0 - blockMin * 60000 && b.t <= t1);
  const blocks = timeBlocks(vis, blockMin);
  const top = a.bounds.top;
  for (const bl of blocks) {
    const ck = bl.t + '|' + m + '|' + bl.bars.length + '|' + bl.bars[bl.bars.length - 1].vol;
    let p = inst.cache.get('h5|' + bl.t);
    if (!p || p.ck !== ck) { p = deltaProfile(bl.bars, m); if (!p) continue; p.ck = ck; inst.cache.set('h5|' + bl.t, p); }
    // block x span: from its first chart bar to its end
    const ia = idxOf(a.bars, bl.t), ib = idxOf(a.bars, bl.t + blockMin * 60000 - 1);
    if (ia < 0 || ib < 0) continue;
    const xa = co.logicalToX(ia) - ppb / 2, xb = co.logicalToX(ib) + ppb / 2;
    if (xb < 0 || xa > co.width) continue;
    const span = Math.max(8, (xb - xa) * clamp(num(I.widthPct, 25), 5, 90) / 100 * 2);
    g.strokeStyle = light() ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.10)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(xa) + 0.5, top); g.lineTo(Math.round(xa) + 0.5, top + a.bounds.height); g.stroke();
    deltaRows(g, a, p, f, xa + 1, Math.min(span, xb - xa - 2), 1, I, phone, { room: xb - xa - 2 });
    // the block's net delta above its high
    let hi = -Infinity; for (const b of bl.bars) hi = Math.max(hi, b.hi);
    const y = co.priceToY((hi + m) * f.tick, a.scale, a.bounds) - 9;
    if (I.numbers !== false && xb - xa >= 36 && y > top + 8) {
      const txt = fmtSigned(p.net);
      g.font = '700 ' + (phone ? 9 : 11) + 'px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'middle';
      const w = g.measureText(txt).width + 8;
      g.fillStyle = light() ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.82)'; g.fillRect(xa + 1, y - 8, w, 16);
      g.fillStyle = p.net >= 0 ? UP2 : '#c4b5fd'; g.fillText(txt, xa + 5, y);
    }
  }
  // keep the cache small
  if (inst.cache.size > 200) inst.cache.clear();
}

function idxOf(bars, t) {   // last chart bar with time <= t
  let lo = 0, hi = bars.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}

function drawV6(g, a, f, I, inst, phone) {
  const co = a.coords, vr = co.visibleLogicalRange();
  const i0 = clamp(Math.floor(vr.from), 0, a.bars.length - 1), i1 = clamp(Math.ceil(vr.to), 0, a.bars.length - 1);
  const vis = [], idx = [];
  for (let i = i0; i <= i1; i++) { const b = f.map.get(a.bars[i].time); if (b) { vis.push(b); idx.push(i); } }
  if (!vis.length) return;
  const { thr, hits } = bigDeltas(vis, clamp(num(I.mult, 2.5), 1, 20));
  const top = a.bounds.top, bot = top + a.bounds.height;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const h of hits) {
    const x = co.logicalToX(idx[h.i]), y = co.priceToY(h.pocTick * f.tick, a.scale, a.bounds);
    if (y < top - 30 || y > bot + 30) continue;
    const r = clamp(6 * Math.sqrt(Math.abs(h.delta) / thr), 5, phone ? 18 : 28);
    const col = h.delta > 0 ? I.buyColor : I.sellColor;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = rgba(col, 0.3); g.fill();
    g.lineWidth = 1.4; g.strokeStyle = col; g.stroke();
    if (I.numbers !== false && r >= 11) { g.font = '700 ' + clamp(Math.floor(r * 0.62), 9, 12) + 'px ' + MONO; g.fillStyle = light() ? '#0f172a' : '#f5f5f5'; g.fillText(fmtSigned(h.delta), x, y); }
  }
  // the threshold, small, bottom-left
  g.font = '600 10px ' + MONO; g.textAlign = 'left'; g.fillStyle = light() ? '#64748b' : '#8a90a0';
  g.fillText('Big delta \u2265 ' + fmtK(thr) + ' (' + clamp(num(I.mult, 2.5), 1, 20) + '\u00d7 avg)', 8, bot - 10);
}

function drawV7(g, a, f, I, inst, phone, slot) {
  const co = a.coords;
  const lastT = a.bars[a.bars.length - 1].time;
  const k = sessKey(f, lastT);
  const bars = f.list.filter((b) => b.t <= lastT && sessKey(f, b.t) === k);
  const st = sessionStats(bars, clamp(num(I.lastMin, 5), 1, 120) * 60000);
  if (!st) return;
  const day = light();
  const W = phone ? 150 : 196, rowH = phone ? 16 : 19, pad = 8;
  const rows = [['Session \u0394', st.delta], ['Last ' + clamp(num(I.lastMin, 5), 1, 120) + 'm \u0394', st.last], ['\u0394 at high', st.dHigh], ['\u0394 at low', st.dLow]];
  const Ht = pad * 2 + rowH * rows.length + 20;
  const left = I.boxPos === 'top left', low = I.boxPos === 'bottom right';
  const x = left ? 10 : co.width - W - 10;
  const y = low ? a.bounds.top + a.bounds.height - 44 - Ht - slot * (Ht + 8) : a.bounds.top + (left ? 64 : 34) + slot * (Ht + 8);
  g.fillStyle = day ? 'rgba(255,255,255,0.94)' : 'rgba(11,11,13,0.9)';
  g.strokeStyle = day ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  g.beginPath(); if (g.roundRect) g.roundRect(x, y, W, Ht, 6); else g.rect(x, y, W, Ht); g.fill(); g.stroke();
  const fs = phone ? 10 : 12;
  g.textBaseline = 'middle';
  rows.forEach(([lab, v], i) => {
    const yy = y + pad + rowH * i + rowH / 2;
    g.font = '500 ' + fs + 'px ' + MONO; g.textAlign = 'left'; g.fillStyle = day ? '#475569' : '#a3a9b6'; g.fillText(lab, x + pad, yy);
    g.font = '700 ' + fs + 'px ' + MONO; g.textAlign = 'right'; g.fillStyle = v > 0 ? I.buyColor : v < 0 ? I.sellColor : (day ? '#334155' : '#d7dbe2'); g.fillText(fmtSigned(v), x + W - pad, yy);
  });
  // buyers vs sellers %
  const by = y + pad + rowH * rows.length + 4, bw = W - pad * 2, bp = st.buyPct / 100;
  g.fillStyle = rgba(I.buyColor, 0.85); g.fillRect(x + pad, by, bw * bp, 6);
  g.fillStyle = rgba(I.sellColor, 0.85); g.fillRect(x + pad + bw * bp, by, bw * (1 - bp), 6);
  g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textBaseline = 'top';
  g.textAlign = 'left'; g.fillStyle = I.buyColor; g.fillText('Buy ' + st.buyPct.toFixed(0) + '%', x + pad, by + 8);
  g.textAlign = 'right'; g.fillStyle = I.sellColor; g.fillText((100 - st.buyPct).toFixed(0) + '% Sell', x + W - pad, by + 8);
}

// ---------------------------------------------------------------- batch 2
// rows of the visible range (H2 H3 H4 H6): one cached profile per (range, m, data version)
function visibleBars(a, f) {
  const vr = a.coords.visibleLogicalRange();
  const i0 = clamp(Math.floor(vr.from), 0, a.bars.length - 1), i1 = clamp(Math.ceil(vr.to), 0, a.bars.length - 1);
  const t0 = a.bars[i0].time, t1 = a.bars[i1].time;
  return { i0, i1, t0, t1, bars: f.list.filter((b) => b.t >= t0 && b.t <= t1) };
}
function cachedProfile(inst, key, bars, m) {
  const last = bars[bars.length - 1];
  const ck = key + '|' + m + '|' + bars.length + '|' + (bars.length && bars[0].t) + '|' + (last ? last.t + ':' + last.vol : '');
  let p = inst.cache.get(key);
  if (!p || p.ck !== ck) { p = deltaProfile(bars, m) || { n: 0 }; p.ck = ck; inst.cache.set(key, p); }
  return p;
}
function rowGeom(a, f, m) {
  const co = a.coords;
  const tickPx = Math.abs(co.priceToY(f.tick, a.scale, a.bounds) - co.priceToY(0, a.scale, a.bounds));
  return { tickPx, rowPx: tickPx * m };
}
function rowY(a, f, m, r) {
  const co = a.coords;
  const yT = co.priceToY((r + 1) * m * f.tick, a.scale, a.bounds), yB = co.priceToY(r * m * f.tick, a.scale, a.bounds);
  const y = Math.min(yT, yB), h = Math.abs(yB - yT);
  return { y, h: Math.max(1, h - (h > 4 ? 1 : 0)), mid: (yT + yB) / 2 };
}
const ink2 = () => (light() ? '#0f172a' : '#f4f4f6');
const dim2 = () => (light() ? '#64748b' : '#8a90a0');
function plate(g, x, y, w, h) { g.fillStyle = light() ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.85)'; g.fillRect(x, y, w, h); }
function header(g, x, y, txt, align) { g.font = '700 10px ' + MONO; g.textAlign = align || 'left'; g.textBaseline = 'middle'; g.fillStyle = dim2(); g.fillText(txt, x, y); }

// H2: sells to the left, buys to the right of a centre line near the price axis; delta number in the middle
function drawH2(g, a, f, I, inst, phone) {
  const co = a.coords, vb = visibleBars(a, f);
  if (!vb.bars.length) return;
  const m = rowSize(I, rowGeom(a, f, 1).tickPx), p = cachedProfile(inst, 'h2', vb.bars, m);
  if (!p.n) return;
  const { rowPx } = rowGeom(a, f, m);
  const half = co.width * clamp(num(I.widthPct, 25), 5, 90) / 100 * (phone ? 0.42 : 0.5);
  const gap = I.numbers !== false && rowPx >= 11 ? (phone ? 34 : 44) : 4;
  const cx = co.width - half - gap / 2 - 4;
  const showNum = I.numbers !== false && rowPx >= (phone ? 12 : 11), fs = fontPx(rowPx, phone);
  const vmax = Math.max(1, ...Array.from(p.buy), ...Array.from(p.sell));
  for (let k = 0; k < p.n; k++) {
    const b = p.buy[k], s = p.sell[k]; if (!b && !s) continue;
    const { y, h, mid } = rowY(a, f, m, p.r0 + k);
    if (y > a.bounds.top + a.bounds.height || y + h < a.bounds.top) continue;
    const ls = half * s / vmax, lb = half * b / vmax;
    g.fillStyle = rgba(I.sellColor, s > b * 1.5 ? 0.9 : 0.5); g.fillRect(cx - gap / 2 - ls, y, ls, h);
    g.fillStyle = rgba(I.buyColor, b > s * 1.5 ? 0.9 : 0.5); g.fillRect(cx + gap / 2, y, lb, h);
    if (showNum) { const d = b - s; g.font = '600 ' + fs + 'px ' + MONO; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = d > 0 ? I.buyColor : d < 0 ? '#c4b5fd' : dim2(); g.fillText(fmtK(d), cx, mid); }
  }
  g.strokeStyle = light() ? 'rgba(15,23,42,0.25)' : 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(Math.round(cx) + 0.5, a.bounds.top); g.lineTo(Math.round(cx) + 0.5, a.bounds.top + a.bounds.height); g.stroke();
  header(g, cx - gap / 2 - 4, a.bounds.top + 12, 'SELLS', 'right'); header(g, cx + gap / 2 + 4, a.bounds.top + 12, 'BUYS', 'left');
}

// H3: volume profile (amber in the value area, grey outside) with the delta as an inner coloured bar; POC / VAH / VAL
function drawH3(g, a, f, I, inst, phone) {
  const co = a.coords, vb = visibleBars(a, f);
  if (!vb.bars.length) return;
  const m = rowSize(I, rowGeom(a, f, 1).tickPx), p = cachedProfile(inst, 'h3', vb.bars, m);
  if (!p.n) return;
  const { rowPx } = rowGeom(a, f, m);
  const span = co.width * clamp(num(I.widthPct, 25), 5, 90) / 100 * (phone ? 0.8 : 1);
  const x1 = co.width - 1, showNum = I.numbers !== false && rowPx >= (phone ? 12 : 11), fs = fontPx(rowPx, phone);
  const dscale = Math.min(3, (p.vmax || 1) / (p.dmax || 1));   // delta drawn up to 3x the volume scale so it reads
  for (let k = 0; k < p.n; k++) {
    const v = p.buy[k] + p.sell[k]; if (!v) continue;
    const r = p.r0 + k, { y, h, mid } = rowY(a, f, m, r);
    if (y > a.bounds.top + a.bounds.height || y + h < a.bounds.top) continue;
    const lv = span * v / p.vmax, inVa = r >= p.val && r <= p.vah;
    g.fillStyle = r === p.poc ? 'rgba(245,179,1,0.55)' : inVa ? 'rgba(240,140,40,0.32)' : (light() ? 'rgba(100,116,139,0.25)' : 'rgba(160,165,180,0.2)');
    g.fillRect(x1 - lv, y, lv, h);
    const d = p.delta[k], ld = Math.min(lv, span * Math.abs(d) / p.vmax * dscale), ih = Math.max(1, h * 0.5);
    if (d) { g.fillStyle = rgba(d > 0 ? I.buyColor : I.sellColor, 0.95); g.fillRect(x1 - ld, y + (h - ih) / 2, ld, ih); }
    if (showNum) { g.font = '600 ' + fs + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = ink2(); g.fillText(fmtK(d), x1 - lv - 4, mid); }
  }
  const line = (r, col, dash, lab) => {
    const y = rowY(a, f, m, r).mid;
    g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = r === p.poc ? 1.5 : 1;
    g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(co.width, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]);
    g.font = '700 10px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = col; g.fillText(lab + ' ' + (r * m * f.tick).toFixed(f.tick < 1 ? 2 : 0), 6, y - 2);
  };
  line(p.poc, '#f5b301', [], 'POC'); line(p.vah, rgba(CYAN, 0.9), [4, 3], 'VAH'); line(p.val, rgba(CYAN, 0.9), [4, 3], 'VAL');
}

// H4: visible-range delta profile next to the last-30-minutes profile (same scale); shades the last 30 min
function drawH4(g, a, f, I, inst, phone) {
  const co = a.coords, vb = visibleBars(a, f);
  if (!vb.bars.length) return;
  const m = rowSize(I, rowGeom(a, f, 1).tickPx);
  const pv = cachedProfile(inst, 'h4v', vb.bars, m);
  const tl = vb.bars[vb.bars.length - 1].t, recent = vb.bars.filter((b) => b.t > tl - clamp(num(I.recentMin, 30), 5, 240) * 60000);
  const pr = cachedProfile(inst, 'h4r', recent, m);
  if (!pv.n) return;
  const w = co.width * clamp(num(I.widthPct, 25), 5, 90) / 100 * (phone ? 0.42 : 0.5);
  const dmax = Math.max(pv.dmax || 1, pr.dmax || 1);
  const xr = co.width - 2, xv = xr - w - 10;
  // shade the recent window on the chart
  const ia = idxOf(a.bars, recent.length ? recent[0].t : tl), ib = vb.i1;
  if (ia >= 0) { const xa = co.logicalToX(ia) - co.pxPerBar() / 2; g.fillStyle = light() ? 'rgba(0,173,181,0.06)' : 'rgba(0,173,181,0.07)'; g.fillRect(xa, a.bounds.top, co.logicalToX(ib) + co.pxPerBar() / 2 - xa, a.bounds.height); }
  deltaRows(g, a, pv, f, xv, w, -1, I, phone, { dmax, hot: true });
  if (pr.n) deltaRows(g, a, pr, f, xr, w, -1, I, phone, { dmax });
  g.strokeStyle = light() ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.14)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(Math.round(xv + 5) + 0.5, a.bounds.top); g.lineTo(Math.round(xv + 5) + 0.5, a.bounds.top + a.bounds.height); g.stroke();
  const lab = (x, t, net) => { const txt = t + ' ' + fmtSigned(net); g.font = '700 10px ' + MONO; const tw = g.measureText(txt).width + 8; plate(g, x - tw, a.bounds.top + 4, tw, 16); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = net >= 0 ? UP2 : '#c4b5fd'; g.fillText(txt, x - 4, a.bounds.top + 12); };
  lab(xv, 'VISIBLE', pv.net); if (pr.n) lab(xr, 'LAST ' + clamp(num(I.recentMin, 30), 5, 240) + 'm', pr.net);
}

// H6: DOM-style ladder at the right: price | sells | buys | delta, intensity cells, current price boxed
function drawH6(g, a, f, I, inst, phone) {
  const co = a.coords, vb = visibleBars(a, f);
  if (!vb.bars.length) return;
  const tl = vb.bars[vb.bars.length - 1].t;
  const bars = vb.bars.filter((b) => b.t > tl - clamp(num(I.recentMin, 30), 5, 240) * 60000);
  // rows at least ~15 px tall (a ladder must be readable)
  const tickPx = rowGeom(a, f, 1).tickPx;
  let m = I.rowTicks > 0 ? I.rowTicks : 400; if (!(I.rowTicks > 0)) for (const s of ROW_STEPS) if (tickPx * s >= (phone ? 14 : 15)) { m = s; break; }
  const p = cachedProfile(inst, 'h6', bars, m);
  if (!p.n) return;
  const cw = phone ? [52, 34, 34, 40] : [70, 48, 48, 56];
  const W = cw.reduce((x, y) => x + y, 0), x0 = co.width - W - 2;
  const vmax = Math.max(1, ...Array.from(p.buy), ...Array.from(p.sell));
  const last = vb.bars[vb.bars.length - 1], cur = Math.floor(last.c / m);
  const fs = phone ? 9 : 11, top = a.bounds.top, bot = top + a.bounds.height;
  plate(g, x0, top, W, a.bounds.height);
  g.textBaseline = 'middle';
  for (let k = 0; k < p.n; k++) {
    const r = p.r0 + k, { y, h, mid } = rowY(a, f, m, r);
    if (y > bot || y + h < top + 20) continue;
    const b = p.buy[k], s = p.sell[k], d = b - s;
    let x = x0;
    g.font = (r === cur ? '700 ' : '500 ') + fs + 'px ' + MONO; g.textAlign = 'right'; g.fillStyle = r === cur ? CYAN : dim2();
    g.fillText((r * m * f.tick).toFixed(f.tick < 1 ? 2 : 0), x + cw[0] - 5, mid); x += cw[0];
    g.fillStyle = rgba(I.sellColor, 0.12 + 0.7 * s / vmax); g.fillRect(x + 1, y, cw[1] - 2, h);
    g.fillStyle = ink2(); g.font = '600 ' + fs + 'px ' + MONO; if (s) g.fillText(fmtK(s), x + cw[1] - 4, mid); x += cw[1];
    g.fillStyle = rgba(I.buyColor, 0.12 + 0.7 * b / vmax); g.fillRect(x + 1, y, cw[2] - 2, h);
    g.fillStyle = ink2(); if (b) g.fillText(fmtK(b), x + cw[2] - 4, mid); x += cw[2];
    g.fillStyle = d > 0 ? I.buyColor : d < 0 ? '#c4b5fd' : dim2(); g.font = '700 ' + fs + 'px ' + MONO; g.fillText(fmtSigned(d), x + cw[3] - 4, mid);
    if (r === cur) { g.strokeStyle = CYAN; g.lineWidth = 1.5; g.strokeRect(x0 + 1, y - 0.5, W - 2, h + 1); }
  }
  plate(g, x0, top, W, 20);
  let x = x0;
  ['PRICE', 'SELL', 'BUY', '\u0394'].forEach((t, i) => { header(g, x + cw[i] - 5, top + 10, t, 'right'); x += cw[i]; });
}

// V3: the delta number under each candle; stronger colour when it's big
function drawV3(g, a, f, I, inst, phone) {
  const co = a.coords, ppb = co.pxPerBar(), vb = visibleBars(a, f);
  if (ppb < (phone ? 22 : 26)) { g.font = '600 10px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = dim2(); g.fillText('Delta numbers: zoom in to see them', 8, a.bounds.top + a.bounds.height - 10); return; }
  const list = []; for (let i = vb.i0; i <= vb.i1; i++) { const b = f.map.get(a.bars[i].time); if (b) list.push([i, b]); }
  const strong = clamp(num(I.mult, 2.5), 1, 20) * meanAbsDelta(list.map((x) => x[1]));
  const fs = clamp(Math.floor(ppb * 0.32), 9, phone ? 10 : 12);
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const [i, b] of list) {
    const x = co.logicalToX(i), y = co.priceToY(a.bars[i].low, a.scale, a.bounds) + 5;
    if (y > a.bounds.top + a.bounds.height - 4) continue;
    const big = strong > 0 && Math.abs(b.delta) >= strong;
    g.font = (big ? '800 ' : '600 ') + fs + 'px ' + MONO;
    g.fillStyle = rgba(b.delta >= 0 ? I.buyColor : I.sellColor, big ? 1 : 0.6);
    g.fillText(fmtSigned(b.delta), x, y);
  }
}

// V4: candles repainted by delta: colour = aggressor, brightness = |delta| / volume; grey + diamond
// where the candle closed against its delta (absorption). The base candles are faded (modulateBase).
function drawV4(g, a, f, I, inst, phone) {
  const co = a.coords, vb = visibleBars(a, f), ppb = co.pxPerBar(), bw = Math.max(1, Math.round(co.bodySpacing ? co.bodySpacing() * 0.7 : ppb * 0.7));
  const list = []; for (let i = vb.i0; i <= vb.i1; i++) { const b = f.map.get(a.bars[i].time); if (b) list.push([i, b]); }
  const minAbs = 0.5 * meanAbsDelta(list.map((x) => x[1]));
  for (const [i, fb] of list) {
    const cb = a.bars[i], x = Math.round(co.logicalToX(i));
    const yo = co.priceToY(cb.open, a.scale, a.bounds), yc = co.priceToY(cb.close, a.scale, a.bounds), yh = co.priceToY(cb.high, a.scale, a.bounds), yl = co.priceToY(cb.low, a.scale, a.bounds);
    const ab = absorption({ o: cb.open, c: cb.close, delta: fb.delta }, minAbs);
    const str = fb.vol ? clamp(Math.abs(fb.delta) / fb.vol * 3, 0.15, 1) : 0.15;
    const col = ab != null ? 'rgba(150,155,165,0.9)' : rgba(fb.delta >= 0 ? I.buyColor : I.sellColor, 0.25 + 0.75 * str);
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 0.5, yh); g.lineTo(x + 0.5, yl); g.stroke();
    g.fillStyle = col; g.fillRect(x - Math.floor(bw / 2), Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    if (ab != null) {
      const y = ab === 1 ? yl + 8 : yh - 8, r = phone ? 3.5 : 4.5;
      g.fillStyle = ab === 1 ? I.buyColor : I.sellColor; g.beginPath(); g.moveTo(x + 0.5, y - r); g.lineTo(x + 0.5 + r, y); g.lineTo(x + 0.5, y + r); g.lineTo(x + 0.5 - r, y); g.closePath(); g.fill();
    }
  }
}

// V5: footprint-lite: per candle sell x buy at the 3-5 key prices, POC box, stacked-imbalance bar
function drawV5(g, a, f, I, inst, phone) {
  const co = a.coords, ppb = co.pxPerBar(), vb = visibleBars(a, f);
  if (ppb < (phone ? 32 : 48)) { g.font = '600 10px ' + MONO; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = dim2(); g.fillText('Footprint-lite: zoom in to see the cells', 8, a.bounds.top + a.bounds.height - 10); return; }
  const tickPx = rowGeom(a, f, 1).tickPx;
  let m = I.rowTicks > 0 ? I.rowTicks : 400; if (!(I.rowTicks > 0)) for (const s of ROW_STEPS) if (tickPx * s >= 12) { m = s; break; }
  const fs = clamp(Math.floor(Math.min(ppb / 7, tickPx * m * 0.8)), 8, phone ? 9 : 11);
  for (let i = vb.i0; i <= vb.i1; i++) {
    const fb = f.map.get(a.bars[i].time); if (!fb) continue;
    const kr = keyRows(fb, m, { ratio: 3, max: clamp(Math.round(num(I.keyRows, 5)), 3, 5) });
    const x = co.logicalToX(i);
    for (const k of kr.keys) {
      const r = kr.rs[k], { y, h, mid } = rowY(a, f, m, Math.floor(r.p / m));
      const isPoc = k === kr.poc;
      plate(g, x - ppb * 0.45, y, ppb * 0.9, h);
      if (isPoc) { g.strokeStyle = '#f5b301'; g.lineWidth = 1.2; g.strokeRect(x - ppb * 0.45 + 0.5, y + 0.5, ppb * 0.9 - 1, h - 1); }
      g.font = '600 ' + fs + 'px ' + MONO; g.textBaseline = 'middle';
      g.textAlign = 'right'; g.fillStyle = kr.imb.sell[k] ? '#c4b5fd' : ink2(); g.fillText(fmtK(r.sell), x - 3, mid);
      g.textAlign = 'center'; g.fillStyle = dim2(); g.fillText('\u00d7', x, mid);
      g.textAlign = 'left'; g.fillStyle = kr.imb.buy[k] ? UP2 : ink2(); g.fillText(fmtK(r.buy), x + 3, mid);
    }
    for (const st of kr.stk) {
      const ya = rowY(a, f, m, Math.floor(kr.rs[st.k1].p / m)).y, yb = rowY(a, f, m, Math.floor(kr.rs[st.k0].p / m));
      g.fillStyle = st.side ? I.buyColor : I.sellColor; g.fillRect(x + ppb * 0.45 + 1, ya, 3, yb.y + yb.h - ya);
    }
  }
}

// V8: a thin strip under the price chart (one cell per bar, intensity = delta) + a CVD line on the right side
function drawV8(g, a, f, I, inst, phone) {
  const co = a.coords, ppb = co.pxPerBar(), vb = visibleBars(a, f);
  const list = []; for (let i = vb.i0; i <= vb.i1; i++) { const b = f.map.get(a.bars[i].time); if (b) list.push([i, b]); }
  if (!list.length) return;
  let mx = 1; for (const [, b] of list) mx = Math.max(mx, Math.abs(b.delta));
  const sh = phone ? 10 : 14, bot = a.bounds.top + a.bounds.height, ys = bot - sh - 2;
  for (const [i, b] of list) {
    const x = co.logicalToX(i);
    g.fillStyle = rgba(b.delta >= 0 ? I.buyColor : I.sellColor, 0.12 + 0.88 * Math.abs(b.delta) / mx);
    g.fillRect(x - ppb / 2 + (ppb > 3 ? 0.5 : 0), ys, Math.max(1, ppb - (ppb > 3 ? 1 : 0)), sh);
  }
  // CVD of the visible bars, scaled into the top 30% of the pane (its own right-side axis labels)
  const k0 = sessKey(f, a.bars[list[0][0]].time);
  let acc = 0; const pts = [];
  // start from the session CVD before the first visible bar so the line is the real session CVD
  for (const b of f.list) { if (b.t >= a.bars[list[0][0]].time) break; if (sessKey(f, b.t) === k0) acc += b.delta; }
  let key = k0;
  for (const [i, b] of list) { const kk = sessKey(f, b.t); if (kk !== key) { key = kk; acc = 0; } acc += b.delta; pts.push([co.logicalToX(i), acc]); }
  let lo = Infinity, hi = -Infinity; for (const [, v] of pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const yt = a.bounds.top + 26, yh = a.bounds.height * 0.28, Y = (v) => yt + yh * (1 - (v - lo) / (hi - lo));
  g.strokeStyle = rgba(CYAN, 0.95); g.lineWidth = 1.6; g.beginPath();
  pts.forEach(([x, v], n) => (n ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)))); g.stroke();
  g.font = '700 10px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
  const tagy = (v, t) => { const txt = t + fmtSigned(v); const w = g.measureText(txt).width + 8; plate(g, co.width - w - 2, Y(v) - 8, w, 16); g.fillStyle = CYAN; g.fillText(txt, co.width - 6, Y(v)); };
  tagy(hi, 'CVD hi '); tagy(lo, 'CVD lo '); tagy(pts[pts.length - 1][1], 'CVD ');
  g.textAlign = 'left'; g.fillStyle = dim2(); g.fillText('\u0394 strip', 6, ys - 7);
}

const DRAW = { H1: drawH1, H2: drawH2, H3: drawH3, H4: drawH4, H5: drawH5, H6: drawH6, V3: drawV3, V4: drawV4, V5: drawV5, V6: drawV6, V7: drawV7, V8: drawV8 };

function suiteLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = canvas && canvas.getContext('2d');
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data;
      if (!d || !d.owner || !a.bars || !a.bars.length) return;
      const insts = d.all ? [...live] : [d.owner];
      const dpr = a.coords.dpr || 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.save(); g.beginPath(); g.rect(0, a.bounds.top, a.coords.width, a.bounds.height); g.clip();
      const phone = a.coords.width < 520;
      let slot = 0;
      for (const inst of insts) {
        if (!inst.on || !inst.ctx) continue;
        const f = inst.flow(a.bars);
        if (!f.list || !f.list.length || !f.map) continue;
        const I = inst.inputs, id = styleId(I.style);
        const fn = DRAW[id];
        if (!fn) continue;
        try { fn(g, a, f, I, inst, phone, id === 'V7' ? slot++ : 0); } catch (e) { if (!inst.warned) { inst.warned = true; console.warn('TradeZoro: delta ' + id, e); } }
      }
      g.restore();
    },
    modulateBase(a) {
      const d = a && a.data;
      if (!d || !d.owner) return null;
      const insts = d.all ? [...live] : [d.owner];
      return insts.some((x) => x.on && styleId(x.inputs.style) === 'V4') ? { candleBodyAlpha: 0.08 } : null;
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------- "Delta: pane" (V1 / V2)
class PaneNative extends Base {
  constructor() { super(DP_SCHEMA); this.type = DP_TYPE; }
  render() {
    if (!this.ctx) return;
    const bars = this.ctx.bars();
    const f = this.flow(bars);
    const tables = this.msgs(f);
    this.ctx.setStatus(f.loading ? 'loading' : 'idle');
    const I = this.inputs, map = f.map || new Map();
    if (styleId(I.style) === 'V1') {
      const list = bars.map((b) => map.get(b.time)).filter(Boolean);
      const strong = clamp(num(I.mult, 2), 1, 20) * meanAbsDelta(list.slice(-400));
      const pts = bars.map((b) => {
        const x = map.get(b.time);
        if (!x) return { time: b.time, value: null };
        const big = strong > 0 && Math.abs(x.delta) >= strong;
        return { time: b.time, value: x.delta, color: rgba(x.delta >= 0 ? I.buyColor : I.sellColor, big ? 1 : 0.55) };
      });
      this.ctx.emit({ series: [{ id: 'dp-delta', title: 'Delta', paneId: '', kind: 'histogram', points: pts, style: { color: I.buyColor, width: 1, lineStyle: 'solid', base: 0 } }],
        priceLines: [{ id: 'dp-zero', paneId: '', price: 0, color: light() ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.3)', lineStyle: 'dashed', width: 1, title: '' }], tables });
      return;
    }
    // V2: CVD candles + price-vs-CVD divergence
    const list = (f.list || []).filter((b) => b.t >= bars[0].time - 60000);
    const cc = cvdCandles(list, f.crypto && I.reset === 'session' ? 'day' : I.reset, H.sessionOf);
    const byT = new Map(); cc.forEach((c) => byT.set(c.t, c));
    const cb = [], P = [];
    bars.forEach((b, i) => { const c = byT.get(b.time); if (c) { cb.push({ time: b.time, open: c.o, high: c.h, low: c.l, close: c.c }); P.push({ i, b, c }); } });
    if (!cb.length || f.partial) { this.ctx.emit({ tables }); return; }
    const series = [{ id: 'dp-cvd', title: 'CVD', paneId: '', kind: 'candle', bars: cb, style: { up: I.buyColor, down: I.sellColor } }];
    if (I.divs !== false && P.length > 30) {
      const tail = P.slice(-600);
      const ds = divergences(tail.map((x) => x.b.high), tail.map((x) => x.b.low), tail.map((x) => x.c.h), tail.map((x) => x.c.l));
      ds.forEach((d, n) => {
        const col = d.kind === 'bear' ? I.sellColor : I.buyColor;
        const A = tail[d.a], B = tail[d.b];
        const seg = (va, vb, overlay) => bars.map((b, i) => (i >= A.i && i <= B.i ? { time: b.time, value: va + (vb - va) * (i - A.i) / Math.max(1, B.i - A.i) } : { time: b.time, value: null }));
        series.push({ id: 'dp-div-c' + n, title: d.kind === 'bear' ? 'Bear div (CVD)' : 'Bull div (CVD)', paneId: '', kind: 'line', points: seg(d.ca, d.cb), style: { color: col, width: 2, lineStyle: 'solid' } });
        series.push({ id: 'dp-div-p' + n, title: d.kind === 'bear' ? 'Bear div (price)' : 'Bull div (price)', paneId: '', overlay: true, kind: 'line', points: seg(d.pa, d.pb), style: { color: col, width: 2, lineStyle: 'dashed' } });
      });
    }
    this.ctx.emit({ series, tables });
  }
}

// ---------------------------------------------------------------- install (from installFootprint)
let installed = false;
export const DS_TYPES = [DS_TYPE, DP_TYPE];
export function installDeltaSuite(Core, hooks) {
  if (installed) return;
  installed = true;
  H = hooks;
  Core.registerRendererLayer({ id: DS_TYPE, placement: 'above-data', create: suiteLayer });
  Core.registerNativeIndicator({ type: DS_TYPE, title: 'Delta', shortTitle: 'Delta', paneHint: 'price', overlay: true, multiInstance: true,
    inputsSchema: () => DS_SCHEMA, defaultInputs: () => defaults(DS_SCHEMA), create: () => new SuiteNative() });
  Core.registerNativeIndicator({ type: DP_TYPE, title: 'Delta: pane (bars / CVD + divergence)', shortTitle: 'Delta pane', paneHint: 'new', overlay: false, multiInstance: true,
    inputsSchema: () => DP_SCHEMA, defaultInputs: () => defaults(DP_SCHEMA), create: () => new PaneNative() });
}
