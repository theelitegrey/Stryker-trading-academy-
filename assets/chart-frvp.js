// TradeZoro — Fixed Range Volume Profile fixes + extras (member report 11 Nov), as a WRAPPER over Vela 0.9.0's own drawing
// (FixedRangeVolumeProfile in vendor chunk-YRCL3WMD.js, painted by DrawingPainter.paintFixedRangeVp in chunk-XIRSR3D6.js).
// Nothing in the vendor folder is edited: the class is exported (prototype patched before the workspace is built) and the
// painter's prototype is reached through a live renderer (installed right after the workspace exists).
//   1. Line end: POC / VAH / VAL stop at the range's right edge, and never run past the newest candle when B was dropped in
//      the empty space right of it. New setting "Extend lines right" runs them to the chart's right edge.
//   2. Hit-testing: Vela grabbed the pointer on the WHOLE histogram box (anchor to 35 % of the span, full price height), so a
//      click on a candle inside it moved the drawing. Now only its drawn bars, its lines (within the usual 6 px), its delta
//      bars and VWAP lines, and its handles (when shown) take the pointer. Same path for touch.
//   3. "Show thin rows": rows under 2 % of the biggest row (empty ones too) draw as a 1 px line, so the profile reads as one shape.
//   4. "Delta bars": buy minus sell per row, mirrored on the other side of the profile's anchor (left of A for the default
//      left anchor). Data = the footprint's own order flow (chart-footprint.js flowFor = the recorded trades with their
//      aggressor side; or an already-open L2 hub's trades when the footprint's Data source is L2): never estimated from candles. "Anchored VWAP" from A with optional +-1 / +-2 SD bands.
// SAVED DRAWINGS keep their look: a drawing saved before this has none of the new keys, and a missing key means the old
// behaviour (lines to B, no thin rows, no delta, no VWAP). New drawings get extendRight:false and thinRows:true when placed.
// Education only. Not financial advice.
import { flowFor, rootOf } from './chart-footprint.js?v=958';
import { isFree } from './chart-pro-gate.js?v=958';
import { deltaRows, anchoredVwap } from './chart-frvp-data.js?v=958';

const THIN = 0.02;                    // a row under 2 % of the biggest row is a "thin" row
const UP = '#089981', DN = '#f23645', VW = '#5b9cf6', BAND = '#9aa0ad';
const MAX_TF_MIN = 240;
const hhmm = (ms) => { try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return ''; } };
function clear(c) {
  const s = String(c || '').trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(s)) return s.endsWith('00');
  const m = /rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(s);
  return m ? parseFloat(m[1]) === 0 : !s;
}
function ink(bg) {   // the drawing's default POC colour: black on a light background, white on a dark one (as Vela's contrastColor)
  const m = /^#?([0-9a-f]{6})/i.exec(String(bg || '')); if (!m) return '#ffffff';
  const n = parseInt(m[1], 16), lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255) > 0.55 ? '#000000' : '#ffffff';
}

// ---------------------------------------------------------------- geometry shared by paint and hit-test
function spanBars(d, proj) {
  const a = d.anchors[0], b = d.anchors[1];
  if (!a || !b || !proj.barsInRange) return [];
  return proj.barsInRange(Math.min(a.time, b.time), Math.max(a.time, b.time)) || [];
}
// x where POC / VAH / VAL stop. Saved drawings (no extendRight key): B, as before.
function lineEnd(d, proj, L) {
  const e = d.frvp.extendRight;
  if (e === true) return Math.max(L.x1, proj.width || L.x1);
  if (e !== false) return L.x1;
  const bars = spanBars(d, proj), last = bars[bars.length - 1];
  return last ? Math.min(L.x1, Math.max(L.x0, proj.xOf(last.time))) : L.x1;
}
// one rect per drawn histogram row: [x, y, w, h, thin]
function rowRects(d, L) {
  const s = d.frvp, P = L.profile, out = [];
  const thin = s.thinRows === true;
  for (let k = 0; k < P.rows.length; k++) {
    const r = P.rows[k], total = r.up + r.down;
    const yA = L.yEdges[k], yB = L.yEdges[k + 1], yTop = Math.min(yA, yB), hh = Math.abs(yB - yA);
    const w = total / P.maxTotal * L.maxW;
    if (thin && total < THIN * P.maxTotal) {
      const tw = Math.max(2, w);
      out.push([L.grow === 1 ? L.anchorX : L.anchorX - tw, Math.round(yTop + hh / 2) - 0.5, tw, 1, true, k]);
    } else if (total > 0) out.push([L.grow === 1 ? L.anchorX : L.anchorX - w, yTop, w, Math.max(1, hh - 1), false, k]);
  }
  return out;
}

// ---------------------------------------------------------------- data: order flow for the delta bars
const holders = new Map();            // drawing id -> flowFor owner + memo
function hostOf(painter) {
  try {
    for (const c of window.STRYKER_VELA.context().cells) {
      const r = c.chart.renderer, R = r && r.userDrawings ? r : r && r.renderer;
      if (R && R.userDrawings && R.userDrawings.painter === painter) return { chart: c.chart, R };
    }
  } catch (e) {}
  return null;
}
function tfMin(tf) {
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) return +tf;
  const m = /^(\d+)?([SDWM])$/i.exec(tf); if (!m) return null;
  const n = m[1] ? +m[1] : 1, u = m[2].toUpperCase();
  return u === 'S' ? n / 60 : u === 'D' ? n * 1440 : u === 'W' ? n * 10080 : n * 43200;
}
// A one-line reason when this chart has no order flow for delta bars, else ''. Fetches nothing.
function whyNoDelta(host) {
  if (!host) return 'Delta bars need the chart this profile is on.';
  const ctx = { symbol: host.chart.market.symbol, data: host.chart.data };
  if (!rootOf(ctx)) return 'Delta bars need order flow: crypto, or NQ, ES, YM, GC, SI or CL futures.';
  if (isFree()) return 'Delta bars use order flow, which is part of Pro.';
  const tf = tfMin(host.chart.market.timeframe);
  if (tf == null || tf < 1 || tf > MAX_TF_MIN) return 'Delta bars work on 1-minute to 4-hour charts.';
  return '';
}
// { mins, tick, loading } (or { why }) for the drawing's span on this chart.
function flowOf(d, host, bars) {
  const why = whyNoDelta(host);
  if (why) return { why };
  const ctx = { symbol: host.chart.market.symbol, data: host.chart.data }, root = rootOf(ctx), tf = tfMin(host.chart.market.timeframe);
  if (!bars.length) return { loading: true };
  const h = holders.get(d.id) || (holders.set(d.id, { own: {} }), holders.get(d.id));
  const from = bars[0].time;
  // futures with the footprint's Data source = L2 (its default): read the L2 hub's trade minutes when a hub for this root is ALREADY
  // open (footprint / L2 tools on the chart) and reaches back to the range start. Never opens a book socket of its own.
  let src = 'l2';
  try { const ct = host.R.scene.style.chartTypes.stk_fp; if (ct && ct.fpSrc === 'l1') src = 'l1'; } catch (e) {}
  if (src === 'l2' && !/:/.test(root)) {
    try {
      for (const [k, hub] of window.__stkL2FlowHubs || []) {
        if (!/^f\|/.test(k) || hub.spec.root !== root) continue;
        const fb = hub.footBars();
        if (fb.bars.length && fb.tick && fb.bars[0].t <= from + 60000) return { mins: fb.bars, tick: fb.tick, src: 'L2' };
      }
    } catch (e) {}
  }
  const f = flowFor({ root, timeframe: host.chart.market.timeframe, bars, owner: h.own });
  if (!f.map) return { why: f.note || 'No order flow for this symbol.' };
  return { mins: f.mins || [], tick: f.tick, loading: !!f.loading || (!f.list.length && /Loading|Waiting/.test(f.note || '')), src: 'L1' };
}
let repaintTm = 0;
function repaintSoon(host) {
  if (repaintTm || !host) return;
  repaintTm = setTimeout(() => { repaintTm = 0; try { host.R.scheduler.invalidate(4); } catch (e) {} }, 900);
}

// ---------------------------------------------------------------- the painter (a copy of Vela's paintFixedRangeVp + the four changes)
function paintFrvp(ctx, d, proj, theme) {
  const L = d.layout(proj);
  if (!L) return;
  const s = d.frvp, P = L.profile;
  if (P.maxTotal <= 0 || L.maxW <= 0) return;
  const avail = d.__stkAvail || (d.__stkAvail = {});
  for (const [x, y, w, h, thin, k] of rowRects(d, L)) {
    const r = P.rows[k], total = r.up + r.down, inVa = k >= P.vaFrom && k <= P.vaTo;
    const upC = inVa ? s.vaUpColor : s.upColor, dnC = inVa ? s.vaDownColor : s.downColor;
    if (thin) { ctx.fillStyle = r.up >= r.down ? upC : dnC; ctx.fillRect(x, y, w, h); continue; }
    const upW = r.up / total * w;
    if (upW > 0) { ctx.fillStyle = upC; ctx.fillRect(x, y, upW, h); }
    if (w - upW > 0) { ctx.fillStyle = dnC; ctx.fillRect(x + upW, y, w - upW, h); }
  }
  const xe = lineEnd(d, proj, L), lw = d.style.lineWidth;
  const hLine = (show, color, style, y) => {
    if (!show || y == null || clear(color)) return;
    this.stroke(ctx, { lineColor: color, lineWidth: lw, lineStyle: style }, () => { ctx.moveTo(L.x0, y); ctx.lineTo(xe, y); });
  };
  hLine(s.showVah, s.vahColor, s.vahStyle, L.vahY);
  hLine(s.showVal, s.valColor, s.valStyle, L.valY);
  hLine(s.showPoc, s.pocColor ?? ink(theme.background), s.pocStyle, L.pocY);
  const devW = Math.max(1, lw);
  if (s.showDevelopingPoc) this.strokePolyline(ctx, L.developingPoc, { lineColor: s.developingPocColor, lineWidth: devW, lineStyle: s.developingPocStyle });
  if (s.showDevelopingVa) {
    const ds = { lineColor: s.developingVaColor, lineWidth: devW, lineStyle: s.developingVaStyle };
    this.strokePolyline(ctx, L.developingVaHigh, ds); this.strokePolyline(ctx, L.developingVaLow, ds);
  }
  const needDelta = s.deltaBars === 'left', needVwap = s.vwap === true;
  d.__stkDelta = null; d.__stkVwap = null;
  const host = hostOf(this), bars = spanBars(d, proj);
  avail.delta = whyNoDelta(host);
  avail.vwap = bars.length && !bars.some((b) => b.volume > 0) ? 'Anchored VWAP needs volume, and this symbol has none.' : '';
  // anchored VWAP: from A over the span's own candles (the profile's data), through the newest candle when the lines extend
  if (needVwap && !avail.vwap && bars.length) {
    const vw = anchoredVwap(s.extendRight === true && proj.barsInRange ? proj.barsInRange(bars[0].time, Infinity) : bars) || [];
    const line = (k) => vw.map((p) => [proj.xOf(p.time), proj.yOf(p.vwap + k * p.sd, d.paneId)]).filter((q) => q[1] != null);
    const polys = [[line(0), VW, 1.5, 'solid']];
    if (s.vwapSd1 === true) polys.push([line(1), BAND, 1, 'solid'], [line(-1), BAND, 1, 'solid']);
    if (s.vwapSd2 === true) polys.push([line(2), BAND, 1, 'dashed'], [line(-2), BAND, 1, 'dashed']);
    for (const [pl, c, w, st] of polys) this.strokePolyline(ctx, pl, { lineColor: c, lineWidth: w, lineStyle: st });
    d.__stkVwap = polys.map((p) => p[0]);
  }
  // delta bars
  if (!needDelta || avail.delta) return;
  const fl = flowOf(d, host, bars);
  if (fl.why) return;
  if (fl.loading && (!fl.mins || !fl.mins.length)) { label(ctx, theme, L, 'Delta: loading order flow…'); repaintSoon(host); return; }
  const h = holders.get(d.id), tfMs = (tfMin(host.chart.market.timeframe) || 1) * 60000;
  const from = Math.floor(bars[0].time / 60000) * 60000, to = bars[bars.length - 1].time + tfMs;
  const key = [fl.mins, fl.mins.length, fl.tick, P.min, P.rowH, P.rows.length, from, to].map(String).join('|');
  if (h.dk !== key || h.dm !== fl.mins) { h.dk = key; h.dm = fl.mins; h.dr = deltaRows(fl.mins, fl.tick, P.min, P.rowH, P.rows.length, from, to); }
  const D = h.dr;
  if (!D.used) { label(ctx, theme, L, 'Delta: no order flow for this range yet'); if (fl.loading) repaintSoon(host); return; }
  let mx = 0; for (const v of D.d) mx = Math.max(mx, Math.abs(v));
  const rects = [], maxDW = L.maxW * 0.6, side = -L.grow, gap = 2;
  if (mx > 0) for (let k = 0; k < D.d.length; k++) {
    const v = D.d[k]; if (!v) continue;
    const yA = L.yEdges[k], yB = L.yEdges[k + 1], w = Math.max(1, Math.abs(v) / mx * maxDW), h2 = Math.max(1, Math.abs(yB - yA) - 1);
    const x = side < 0 ? L.anchorX - gap - w : L.anchorX + gap;
    ctx.fillStyle = (v > 0 ? UP : DN) + 'BF'; ctx.fillRect(x, Math.min(yA, yB), w, h2);
    rects.push([x, Math.min(yA, yB), w, h2]);
  }
  d.__stkDelta = rects;
  const cover = D.first > from + 2 * 60000 ? 'Delta from ' + hhmm(D.first) : '';
  if (cover) label(ctx, theme, L, cover);
}
function label(ctx, theme, L, text) {
  const x = L.grow === 1 ? L.anchorX - 4 : L.anchorX + 4, y = Math.min(L.yEdges[0], L.yEdges[L.yEdges.length - 1]) - 4;
  ctx.save();
  ctx.font = '10px ' + (theme.fontFamily || 'sans-serif'); ctx.textAlign = L.grow === 1 ? 'right' : 'left'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = theme.textColor || '#9aa0ad'; ctx.globalAlpha = 0.75; ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------- hit-test: only what is drawn
function hitFrvp(px, py, proj, tol) {
  const L = this.layout(proj);
  if (!L) return false;
  const inR = (r, pad) => px >= r[0] - pad && px <= r[0] + r[2] + pad && py >= r[1] - pad && py <= r[1] + r[3] + pad;
  for (const r of rowRects(this, L)) if (inR(r, r[4] ? 2 : 0.5)) return true;
  const s = this.frvp, xe = lineEnd(this, proj, L);
  for (const [show, y] of [[s.showVah, L.vahY], [s.showVal, L.valY], [s.showPoc, L.pocY]]) {
    if (show !== false && y != null && px >= L.x0 - tol && px <= xe + tol && Math.abs(py - y) <= tol) return true;
  }
  const near = (poly) => { for (let i = 1; i < poly.length; i++) if (seg(px, py, poly[i - 1], poly[i]) <= tol) return true; return false; };
  if (s.showDevelopingPoc && near(L.developingPoc)) return true;
  if (s.showDevelopingVa && (near(L.developingVaHigh) || near(L.developingVaLow))) return true;
  if (s.deltaBars === 'left' && this.__stkDelta) for (const r of this.__stkDelta) if (inR(r, 0.5)) return true;
  if (s.vwap === true && this.__stkVwap) for (const pl of this.__stkVwap) if (near(pl)) return true;
  return false;
}
function seg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 > 1e-9 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// ---------------------------------------------------------------- settings rows (Vela's settings panel lists extra schema fields itself)
// Labels stay short: the panel's generic label column is 96 px and cuts longer text (the full text is in each row's tooltip).
// Paths go through `frvpx`, an alias of the drawing's own `frvp` object: the panel's own Profile block only handles "frvp.*", so these
// land in its generic block, and the values are saved with the drawing's other profile settings.
function extraFields(d) {
  const a = d.__stkAvail || {}, f = [];
  f.push({ path: 'frvpx.extendRight', label: 'Extend right', kind: 'boolean' });
  f.push({ path: 'frvpx.thinRows', label: 'Thin rows', kind: 'boolean' });
  f.push(a.delta ? { path: 'frvpx.deltaBars', label: 'Delta bars', kind: 'select', options: [{ value: d.frvp.deltaBars || 'off', label: a.delta }] }
    : { path: 'frvpx.deltaBars', label: 'Delta bars', kind: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'left', label: 'Left side' }] });
  if (a.vwap) f.push({ path: 'frvpx.vwap', label: 'VWAP', kind: 'select', options: [{ value: String(d.frvp.vwap === true), label: a.vwap }] });
  else {
    f.push({ path: 'frvpx.vwap', label: 'VWAP', kind: 'boolean' });
    f.push({ path: 'frvpx.vwapSd1', label: '\u00b11 SD bands', kind: 'boolean', when: { path: 'frvpx.vwap', in: [true] } });
    f.push({ path: 'frvpx.vwapSd2', label: '\u00b12 SD bands', kind: 'boolean', when: { path: 'frvpx.vwap', in: [true] } });
  }
  return f;
}

// Before the workspace is built: the drawing class (restored drawings and new ones are its instances).
export function installFrvpClass(FRVP) {
  const P = FRVP && FRVP.prototype;
  if (!P || P.__stkFrvp || typeof P.layout !== 'function') return false;
  P.__stkFrvp = true;
  Object.defineProperty(P, 'frvpx', { configurable: true, get() { return this.frvp; } });
  P.hitTest = hitFrvp;
  const schema = P.schema;
  P.schema = function () { const s = schema.call(this); s.fields = s.fields.concat(extraFields(this)); return s; };
  const onPlaced = P.onPlaced;
  P.onPlaced = function (proj) {   // a NEW drawing: the new defaults (saved drawings never pass here)
    if (onPlaced) onPlaced.call(this, proj);
    if (this.frvp.extendRight === undefined) this.frvp.extendRight = false;
    if (this.frvp.thinRows === undefined) this.frvp.thinRows = true;
    if (this.frvp.vwapSd1 === undefined) this.frvp.vwapSd1 = true;
    if (this.frvp.vwapSd2 === undefined) this.frvp.vwapSd2 = true;
  };
  return true;
}
// After the workspace exists: the painter (one prototype shared by every chart cell).
export function installFrvpPainter(ws) {
  try {
    for (const c of ws.context().cells) {
      const r = c.chart.renderer, R = r && r.userDrawings ? r : r && r.renderer, pt = R && R.userDrawings && R.userDrawings.painter;
      const proto = pt && Object.getPrototypeOf(pt);
      if (!proto || typeof proto.paintFixedRangeVp !== 'function') continue;
      if (!proto.__stkFrvp) { proto.__stkFrvp = true; proto.paintFixedRangeVp = paintFrvp; }
      try { R.scheduler.invalidate(4); } catch (e) {}
      return true;
    }
  } catch (e) { console.warn('TradeZoro: FRVP painter', e); }
  return false;
}
