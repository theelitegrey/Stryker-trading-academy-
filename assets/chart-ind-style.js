// TradeZoro — Charts: indicator Style tab (one shared style layer for every indicator) — ES module
// Imported by assets/vela-chart.js: installIndStyle(Core) before the workspace is built (state
// persistence), mountIndStyle(ws) once it exists.
//
// Owner 2026-10-24: "add extended and full option to change every aspect of how indicator is shown
// like text size, bold, italic etc, line size, line type, circle or box or diamond etc. basically
// everything that is visible to user." Target: TradingView's Settings → Style tab, more complete.
// Audit + notes: stryker-notes/reports/workers/t3-ind-style.md.
//
// HOW
//   1. Model layer. Every indicator (Pine on both engines, Vela built-ins, our natives) reaches the
//      renderer through EngineOrchestrator.applyModel(id, model). That method is wrapped ONCE per
//      prototype: the raw model is kept on the record and, when the indicator has style overrides,
//      a restyled COPY is passed on. No overrides = the very same model object, untouched (Pine
//      sources and their look stay byte-identical; Liquidity Master looks the same until changed).
//      A style edit re-applies the kept raw model as a structural mount, no script re-run.
//   2. Canvas layers. Our order-flow tools draw on renderer layer canvases. Each layer instance's
//      render() is wrapped; while it paints for an indicator with layer overrides, its 2D context
//      rewrites font size / bold / italic / family, line width, line dash and opacity, or skips the
//      paint when the drawing is switched off.
//   3. UI. Vela's indicator settings dialog (IndicatorInputsDialog, both versions) gets two extra
//      tabs: "Style" (one collapsible group per visual element, named by the script's titles, with
//      Labels / Lines / Boxes / Tables fallbacks) and "Visibility" (timeframes). Defaults per
//      indicator: Save as default / Use default / Reset style. Cancel reverts style edits too.
//   4. Persistence: ext['stryker.indstyle'] in the workspace document (same place, same signed-in
//      sync as the inputs). Old layouts have no such key and load unchanged.
// The pure helpers are exported for tools/tests/chart-ind-style.test.mjs.

export const PERSIST_KEY = 'stryker.indstyle';
export const DEFAULTS_KEY = 'stryker.indstyle.defaults';
export const PLOT_KINDS = [['line', 'Line'], ['step', 'Step line'], ['histogram', 'Histogram'], ['columns', 'Columns'], ['area', 'Area'], ['circles', 'Circles'], ['cross', 'Cross']];
export const SHAPES = [['circle', 'Circle'], ['square', 'Square / box'], ['diamond', 'Diamond'], ['triangleup', 'Triangle up'], ['triangledown', 'Triangle down'], ['cross', 'Cross'], ['xcross', 'X'], ['arrowup', 'Arrow up'], ['arrowdown', 'Arrow down'], ['label_down', 'Label'], ['flag', 'Flag']];
export const SIZES = ['tiny', 'small', 'normal', 'large', 'huge'];
export const POSITIONS = ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'];
export const TIMEFRAME_BANDS = [['s', 'Seconds'], ['m', 'Minutes'], ['h', 'Hours'], ['D', 'Days'], ['W', 'Weeks'], ['M', 'Months']];
const LABEL_PLACE = { above: 'label_down', below: 'label_up', left: 'label_right', right: 'label_left', inside: 'label_center' };

// ── colours ─────────────────────────────────────────────────────────────────
export function parseColor(c){
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export function toHex(c){ const p = parseColor(c); return p ? '#' + hex2(p.r) + hex2(p.g) + hex2(p.b) : '#2962ff'; }
export function alphaOf(c){ const p = parseColor(c); return p ? p.a : 1; }
// Colour with the override applied: colour (hex) and/or opacity (0-100, absolute like TradingView).
export function styleColor(orig, color, opacity){
  if (color == null && opacity == null) return orig;
  const base = parseColor(color != null ? color : orig);
  if (!base) return orig;
  const a = opacity != null ? Math.max(0, Math.min(100, +opacity)) / 100 : (color != null ? (parseColor(orig) ? parseColor(orig).a : 1) : base.a);
  return 'rgba(' + base.r + ',' + base.g + ',' + base.b + ',' + (+a.toFixed(3)) + ')';
}

// ── element catalogue (what the Style tab lists) ────────────────────────────
// Pine ids are `${instance}:${kind}:${slug}#${ordinal}`; label.new/line.new/box.new slugs are the
// object's numeric id, so those fall back to one group per kind.
export function slugOf(id){
  const m = /^[^:]*:[^:]+:(.*)$/.exec(String(id || ''));
  if (!m) return '';
  let s = m[1];
  while (/#\d+$/.test(s)) s = s.replace(/#\d+$/, '');
  return /^\d*$/.test(s) ? '' : s;
}
const nice = (s) => { const t = String(s || '').replace(/[-_]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const FALLBACK = { label: 'Labels', line: 'Lines', box: 'Boxes', table: 'Tables', polyline: 'Polylines', linefill: 'Line fills', fill: 'Fills', background: 'Background', hline: 'Horizontal lines' };
const ARR = { label: 'labels', line: 'lines', box: 'boxes', table: 'tables', polyline: 'polylines', linefill: 'linefills', fill: 'fills', background: 'backgrounds', hline: 'priceLines' };
// Group key + display name for one element.
export function groupOf(kind, el){
  if (kind === 'series') return { key: 's:' + (el.title || el.id), name: el.displayTitle || el.title || 'Plot' };
  if (kind === 'hline' && el.title) return { key: 'h:' + el.title, name: el.title };
  const slug = slugOf(el.id);
  if (slug && kind !== 'table') return { key: kind[0] + ':' + slug, name: nice(slug) + (kind === 'label' ? '' : ' (' + FALLBACK[kind].toLowerCase() + ')') };
  return { key: kind, name: FALLBACK[kind] };
}
export function catalog(model){
  const out = [], seen = new Map();
  if (!model) return out;
  const add = (kind, el) => {
    const g = groupOf(kind, el);
    let e = seen.get(g.key);
    if (!e) { e = { key: g.key, name: g.name, kind, count: 0, sample: el }; seen.set(g.key, e); out.push(e); }
    e.count++;
  };
  (model.series || []).forEach((s) => { if (s.kind !== 'candle' && s.kind !== 'bar' && s.kind !== 'markers') add('series', s); });
  Object.keys(ARR).forEach((k) => (model[ARR[k]] || []).forEach((el) => add(k, el)));
  return out;
}

// ── applying overrides to a model ───────────────────────────────────────────
// style = { el: { [groupKey]: {...props} }, layer: {...}, z: 'front'|'back'|'', tf: { on, bands: {m:[1,60]} } }
export function hasStyle(st){
  if (!st || typeof st !== 'object') return false;
  if (st.z) return true;
  if (st.tf && st.tf.on) return true;
  if (st.layer && Object.keys(st.layer).length) return true;
  return !!(st.el && Object.keys(st.el).some((k) => st.el[k] && Object.keys(st.el[k]).length));
}
// Timeframe string (Vela: "1", "60", "1D", "1W", "1M", "5S") -> band + count.
export function tfBand(tf){
  const m = /^(\d*)([SDWM]?)$/i.exec(String(tf || '').trim());
  if (!m) return null;
  const n = Number(m[1] || 1), u = m[2];
  if (u === 'S' || u === 's') return { band: 's', n };
  if (u === 'D' || u === 'd') return { band: 'D', n };
  if (u === 'W' || u === 'w') return { band: 'W', n };
  if (u === 'M') return { band: 'M', n };
  return n % 60 === 0 && n >= 60 ? { band: 'h', n: n / 60 } : { band: 'm', n };
}
// True when the indicator should show on this timeframe (Visibility tab).
export function shownOnTf(st, tf){
  if (!st || !st.tf || !st.tf.on) return true;
  const b = tfBand(tf);
  if (!b) return true;
  const r = st.tf.bands && st.tf.bands[b.band];
  if (!r) return true;
  if (r.off) return false;
  const lo = +r[0] || 1, hi = +r[1] || 1e9;
  return b.n >= lo && b.n <= hi;
}
const num = (v, lo, hi) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined; };
function styleSeries(s, o){
  const out = Object.assign({}, s, { style: Object.assign({}, s.style) });
  if (o.color != null || o.opacity != null) {
    out.style.color = styleColor(s.style && s.style.color, o.color, o.opacity);
    if (o.color != null) out.points = (s.points || []).map((p) => (p && p.color ? Object.assign({}, p, { color: out.style.color }) : p));
    else out.points = (s.points || []).map((p) => (p && p.color ? Object.assign({}, p, { color: styleColor(p.color, null, o.opacity) }) : p));
  }
  if (o.width != null) out.style.width = num(o.width, 1, 6);
  if (o.lineStyle) out.style.lineStyle = o.lineStyle;
  if (o.kind && PLOT_KINDS.some((k) => k[0] === o.kind)) {
    out.kind = o.kind;
    if ((o.kind === 'histogram' || o.kind === 'columns') && out.style.base == null) out.style.base = 0;
  }
  const disp = Object.assign({ pane: true, legend: true, dataWindow: true, priceScale: true }, s.display || {});
  if (s.visible === false && !s.display) disp.pane = false;
  let touched = false;
  if (o.visible === false) { disp.pane = false; out.visible = false; touched = true; }
  else if (o.visible === true) { disp.pane = true; out.visible = true; touched = true; }
  if (o.priceScale != null) { disp.priceScale = !!o.priceScale; touched = true; }
  if (o.statusLine != null) { disp.legend = !!o.statusLine; disp.dataWindow = !!o.statusLine; touched = true; }
  if (touched) out.display = disp;
  return out;
}
function styleLine(ln, o){
  const out = Object.assign({}, ln);
  if (o.color != null || o.opacity != null) out.color = styleColor(ln.color, o.color, o.opacity);
  if (o.width != null) out.width = num(o.width, 1, 6);
  if (o.lineStyle) out.style = o.lineStyle;
  if (o.extendRight != null) out.extend = o.extendRight ? (ln.extend === 'left' || ln.extend === 'both' ? 'both' : 'right') : (ln.extend === 'both' || ln.extend === 'left' ? 'left' : 'none');
  return out;
}
function styleBox(bx, o){
  const out = Object.assign({}, bx);
  if (o.color != null || o.opacity != null) out.bgColor = styleColor(bx.bgColor || 'rgba(41,98,255,0.2)', o.color, o.opacity);
  if (o.border === false) out.borderWidth = 0;
  else {
    if (o.borderColor != null || o.borderOpacity != null) out.borderColor = styleColor(bx.borderColor || bx.bgColor || '#2962ff', o.borderColor, o.borderOpacity);
    if (o.borderWidth != null) out.borderWidth = num(o.borderWidth, 0, 6);
    if (o.border === true && !(out.borderWidth > 0)) out.borderWidth = 1;
  }
  if (o.lineStyle) out.borderStyle = o.lineStyle;
  if (o.extendRight != null) out.extend = o.extendRight ? (bx.extend === 'left' || bx.extend === 'both' ? 'both' : 'right') : (bx.extend === 'both' || bx.extend === 'left' ? 'left' : 'none');
  textProps(out, o, '__stkPx');
  return out;
}
function textProps(out, o, sizeKey){
  if (o.textColor != null || o.textOpacity != null) out.textColor = styleColor(out.textColor || '#d1d4dc', o.textColor, o.textOpacity);
  if (o.fontPx != null) out[sizeKey] = num(o.fontPx, 8, 24);
  if (o.bold != null) out.bold = !!o.bold;
  if (o.italic != null) out.italic = !!o.italic;
  if (o.font) out.fontFamily = o.font === 'mono' ? 'monospace' : 'default';
}
function styleLabel(lb, o){
  const out = Object.assign({}, lb);
  if (o.color != null || o.opacity != null) { out.color = styleColor(lb.color || '#2962ff', o.color, o.opacity); out.noFill = false; }
  if (o.shape) out.style = o.shape;
  if (o.size && SIZES.includes(o.size)) out.size = o.size;
  if (o.place) {
    if (lb.yloc === 'abovebar' || lb.yloc === 'belowbar') { if (o.place === 'above') out.yloc = 'abovebar'; else if (o.place === 'below') out.yloc = 'belowbar'; }
    if (String(out.style || '').startsWith('label_') && LABEL_PLACE[o.place]) out.style = LABEL_PLACE[o.place];
  }
  textProps(out, o, '__stkPx');
  return out;
}
function styleTable(t, o){
  const out = Object.assign({}, t);
  if (o.position && POSITIONS.includes(o.position)) out.position = o.position;
  if (o.color != null || o.opacity != null) out.bgColor = styleColor(t.bgColor || '#131722', o.color, o.opacity);
  if (o.borderColor != null) { out.frameColor = styleColor(t.frameColor || '#363a45', o.borderColor, o.borderOpacity); out.borderColor = out.frameColor; }
  if (o.border === false) { out.frameWidth = 0; out.borderWidth = 0; }
  const cellTouch = o.textColor != null || o.textOpacity != null || o.fontPx != null || o.bold != null || o.italic != null || o.font || o.cellColor != null || o.cellOpacity != null;
  if (cellTouch) out.cells = (t.cells || []).map((row) => (row || []).map((c) => {
    if (!c) return c;
    const n = Object.assign({}, c);
    textProps(n, o, 'textSize');
    if (o.cellColor != null || o.cellOpacity != null) n.bgColor = styleColor(c.bgColor || t.bgColor || '#131722', o.cellColor, o.cellOpacity);
    return n;
  }));
  return out;
}
function styleSimple(el, o, key){
  const out = Object.assign({}, el);
  if (o.color != null || o.opacity != null) {
    if (key === 'fill' && Array.isArray(el.colors)) out.colors = el.colors.map((c) => (c ? styleColor(c, o.color, o.opacity) : c));
    if (el.color != null || key !== 'fill' || !Array.isArray(el.colors)) out.color = styleColor(el.color || '#2962ff', o.color, o.opacity);
    if (key === 'polyline') { out.lineColor = styleColor(el.lineColor || el.color, o.color, o.opacity); if (el.fillColor) out.fillColor = styleColor(el.fillColor, o.color, Math.min(+o.opacity || 20, 100)); }
  }
  if (o.width != null) { out.width = num(o.width, 1, 6); if (key === 'polyline') out.lineWidth = out.width; }
  if (o.lineStyle) out.lineStyle = o.lineStyle;
  return out;
}
const STYLERS = { label: styleLabel, line: styleLine, box: styleBox, table: styleTable, polyline: (e, o) => styleSimple(e, o, 'polyline'), linefill: (e, o) => styleSimple(e, o, 'linefill'), fill: (e, o) => styleSimple(e, o, 'fill'), background: (e, o) => styleSimple(e, o, 'background'), hline: (e, o) => styleSimple(e, o, 'hline') };
// Returns the model to draw: the SAME object when there is nothing to change.
export function applyStyle(model, st, tf){
  if (!model || !hasStyle(st)) return model;
  const hidden = !shownOnTf(st, tf);
  const el = st.el || {};
  if (!hidden && !Object.keys(el).length) return model;
  const out = Object.assign({}, model);
  out.series = (model.series || []).map((s) => {
    if (s.kind === 'candle' || s.kind === 'bar' || s.kind === 'markers') return hidden ? Object.assign({}, s, { visible: false, display: { pane: false, legend: false, dataWindow: false, priceScale: false } }) : s;
    const o = hidden ? { visible: false, statusLine: false, priceScale: false } : el[groupOf('series', s).key];
    return o && Object.keys(o).length ? styleSeries(s, o) : s;
  });
  Object.keys(ARR).forEach((k) => {
    const arr = model[ARR[k]];
    if (!Array.isArray(arr) || !arr.length) return;
    if (hidden) { out[ARR[k]] = []; return; }
    let changed = false;
    const res = [];
    for (const e of arr) {
      const o = el[groupOf(k, e).key];
      if (!o || !Object.keys(o).length) { res.push(e); continue; }
      changed = true;
      if (o.visible === false) continue;
      res.push(STYLERS[k](e, o));
    }
    if (changed) out[ARR[k]] = res;
  });
  if (hidden) out.barColors = undefined;
  return out;
}

// ── canvas layer overrides ──────────────────────────────────────────────────
const FONT_RE = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|small-caps|\d{3})\s+)*)(\d+(?:\.\d+)?)px(\/\S+)?\s+(.+)$/i;
export function rewriteFont(font, o){
  if (!o) return font;
  const m = FONT_RE.exec(String(font || ''));
  if (!m) return font;
  let pre = m[1].trim().split(/\s+/).filter(Boolean);
  let px = +m[2], fam = m[4];
  if (o.fontPx != null) px = num(o.fontPx, 8, 24);
  if (o.bold != null) { pre = pre.filter((w) => !/^(bold|bolder|lighter|normal|\d{3})$/i.test(w)); if (o.bold) pre.push('bold'); }
  if (o.italic != null) { pre = pre.filter((w) => !/^(italic|oblique)$/i.test(w)); if (o.italic) pre.unshift('italic'); }
  if (o.font === 'mono') fam = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  else if (o.font === 'site') fam = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
  return (pre.length ? pre.join(' ') + ' ' : '') + px + 'px' + (m[3] || '') + ' ' + fam;
}
const DASHES = { solid: [], dashed: [6, 4], dotted: [2, 3] };
const ctxState = new WeakMap();
function patchCtx(g){
  if (!g || ctxState.has(g)) return ctxState.get(g);
  const st = { o: null };
  ctxState.set(g, st);
  const P = Object.getPrototypeOf(g);
  const d = (k) => { let p = P; while (p && !Object.getOwnPropertyDescriptor(p, k)) p = Object.getPrototypeOf(p); return p && Object.getOwnPropertyDescriptor(p, k); };
  const fd = d('font'), wd = d('lineWidth'), ad = d('globalAlpha');
  const origDash = g.setLineDash;
  try {
    Object.defineProperty(g, 'font', { configurable: true, get(){ return fd.get.call(this); }, set(v){ fd.set.call(this, st.o ? rewriteFont(v, st.o) : v); } });
    Object.defineProperty(g, 'lineWidth', { configurable: true, get(){ return wd.get.call(this); }, set(v){ wd.set.call(this, st.o && st.o.width != null && v >= 1 ? +st.o.width : v); } });
    Object.defineProperty(g, 'globalAlpha', { configurable: true, get(){ return ad.get.call(this); }, set(v){ ad.set.call(this, st.o && st.o.opacity != null ? v * Math.max(0, Math.min(100, +st.o.opacity)) / 100 : v); } });
    g.setLineDash = function (seg){ return origDash.call(this, st.o && st.o.lineStyle ? DASHES[st.o.lineStyle] || seg : seg); };
  } catch (e) { return st; }
  return st;
}
function wrapLayerEntry(entry, ownerOf){
  if (!entry || !entry.instance || entry.instance.__stkStyle) return;
  const inst = entry.instance, orig = inst.render;
  if (typeof orig !== 'function') return;
  inst.__stkStyle = true;
  inst.render = function (args){
    let o = null;
    try { const st = ownerOf(entry, args); o = st && st.layer && Object.keys(st.layer).length ? st.layer : null; if (st && st.__hiddenTf) o = Object.assign({}, o, { visible: false }); } catch (e) {}
    if (!o) return orig.apply(this, arguments);
    const g = entry.canvas && entry.canvas.getContext && entry.canvas.getContext('2d');
    if (o.visible === false) { if (g) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, entry.canvas.width, entry.canvas.height); } return; }
    const cs = patchCtx(g);
    if (cs) cs.o = o;
    try {
      if (g && o.opacity != null) g.globalAlpha = 1;
      return orig.apply(this, arguments);
    } finally { if (cs) cs.o = null; if (g) { try { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g), 'globalAlpha') && (g.globalAlpha = 1); } catch (e) {} } }
  };
}

// ── store ───────────────────────────────────────────────────────────────────
const recs = new Map();        // record -> { orch, style }
const orchs = new Set();
const pending = new WeakMap(); // orchestrator -> [{ k, i, s }] from a restored layout
let wsRef = null;
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
function identity(rec){
  if (rec.native) return 'n:' + rec.native.type;
  const m = rec.model || rec.__stkRaw;
  return 'p:' + String((m && m.title) || rec.title || 'Indicator').slice(0, 80);
}
function indexOf(orch, rec){
  const k = identity(rec);
  let i = 0;
  for (const r of orch.registry.all()) { if (r === rec) return i; if (identity(r) === k) i++; }
  return i;
}
function loadDefaults(){ try { return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveDefaults(d){ try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)); } catch (e) {} }
export function sanitize(st){
  if (!st || typeof st !== 'object') return null;
  const out = {};
  const prim = (v) => ['string', 'number', 'boolean'].includes(typeof v);
  const obj = (o) => { const r = {}; Object.keys(o || {}).slice(0, 40).forEach((k) => { if (prim(o[k]) && String(o[k]).length < 200) r[k] = o[k]; }); return r; };
  if (st.el && typeof st.el === 'object') { out.el = {}; Object.keys(st.el).slice(0, 200).forEach((k) => { if (k.length < 200 && st.el[k] && typeof st.el[k] === 'object') { const r = obj(st.el[k]); if (Object.keys(r).length) out.el[k] = r; } }); }
  if (st.layer && typeof st.layer === 'object') out.layer = obj(st.layer);
  if (st.z === 'front' || st.z === 'back') out.z = st.z;
  if (st.tf && typeof st.tf === 'object') {
    out.tf = { on: !!st.tf.on, bands: {} };
    TIMEFRAME_BANDS.forEach(([b]) => { const r = st.tf.bands && st.tf.bands[b]; if (r && typeof r === 'object') out.tf.bands[b] = r.off ? { off: true } : [num(r[0], 1, 1e6) || 1, num(r[1], 1, 1e6) || 1e6]; });
  }
  return hasStyle(out) ? out : null;
}
function entryOf(orch, rec){
  let e = recs.get(rec);
  if (!e) {
    e = { orch, style: null };
    recs.set(rec, e);
    // restored layout first, then the user's saved default for this indicator
    const list = pending.get(orch);
    const k = identity(rec), i = indexOf(orch, rec);
    if (list) { const j = list.findIndex((x) => x.k === k && x.i === i); if (j >= 0) { e.style = sanitize(list[j].s); list.splice(j, 1); } }
    if (!e.style && !rec.__stkRestoring) { const d = loadDefaults()[k]; if (d) e.style = sanitize(d); }
  }
  return e;
}
function tfOf(orch){ try { return orch.config.market.timeframe; } catch (e) { return ''; } }
function rendererOf(orch){ return orch && orch.renderer; }
function nativeRenderer(orch){ const r = rendererOf(orch); if (r && r.extLayers) return r; if (r && r.renderer && r.renderer.extLayers) return r.renderer; return null; }
function wrapLayers(orch){
  const R = nativeRenderer(orch);
  if (!R || !Array.isArray(R.extLayers)) return;
  R.extLayers.forEach((l) => wrapLayerEntry(l, (entry) => layerStyle(orch, entry)));
}
function layerRec(orch, entry){
  try {
    if (entry.owner != null) return orch.registry.get(entry.owner) || null;
    return orch.registry.all().find((r) => r.native && r.native.type === entry.def.id && !r.native.channel) || null;
  } catch (e) { return null; }
}
function layerStyle(orch, entry){
  const rec = layerRec(orch, entry);
  if (!rec) return null;
  const e = recs.get(rec);
  if (!e || !e.style) return null;
  return shownOnTf(e.style, tfOf(orch)) ? e.style : Object.assign({ __hiddenTf: true }, e.style);
}
function applyZ(orch, rec, st){
  const z = st && st.z;
  if (!z) return;
  try { const R = nativeRenderer(orch) || rendererOf(orch); if (R && typeof R.set === 'function') R.set('seriesOrder', { id: rec.id, to: z }); } catch (e) {}
}
// Pine label / box text size: the scene draws from named sizes; an override in px rides on
// el.__stkPx and is swapped into the font while that element is drawn (both engines).
function patchSceneProto(orch){
  try {
    const R = nativeRenderer(orch);
    const sl = R && R.indicatorSlices;
    const sc = sl && sl.drawScene;
    const proto = sc && Object.getPrototypeOf(sc);
    if (!proto || proto.__stkIndStyle) return;
    proto.__stkIndStyle = true;
    if (typeof proto.labelFont === 'function') {
      const o = proto.labelFont;
      proto.labelFont = function (lb, px){ return o.call(this, lb, lb && lb.__stkPx ? lb.__stkPx : px); };
    }
    if (typeof proto.drawBoxText === 'function') {
      const o = proto.drawBoxText;
      proto.drawBoxText = function (ctx, bx){
        if (!bx || !bx.__stkPx) return o.apply(this, arguments);
        const cs = patchCtx(ctx);
        const prev = cs && cs.o;
        if (cs) cs.o = { fontPx: bx.__stkPx };
        try { return o.apply(this, arguments); } finally { if (cs) cs.o = prev; }
      };
    }
  } catch (e) {}
}
function wrapOrchestrator(orch){
  if (!orch || orchs.has(orch)) return;
  orchs.add(orch);
  const proto = Object.getPrototypeOf(orch);
  if (!proto || proto.__stkIndStyle || typeof proto.applyModel !== 'function') return;
  proto.__stkIndStyle = true;
  const orig = proto.applyModel;
  proto.applyModel = function (id, model){
    let out = model;
    try {
      orchs.add(this);
      const rec = this.registry.get(id);
      if (rec && model) {
        rec.__stkRaw = model;
        const e = entryOf(this, rec);
        if (e.style) out = applyStyle(model, e.style, tfOf(this));
      }
    } catch (err) { out = model; }
    const r = orig.call(this, id, out);
    try { patchSceneProto(this); const rec = this.registry.get(id); wrapLayers(this); const e = rec && recs.get(rec); if (e && e.style && e.style.z && !rec.__stkZ) { rec.__stkZ = 1; applyZ(this, rec, e.style); } } catch (err) {}
    return r;
  };
}
// Re-draw one indicator from its kept raw model (no script re-run).
function redraw(orch, rec){
  if (!rec || rec.hidden || !rec.renderHandle) return;
  const raw = rec.__stkRaw;
  try {
    if (raw) { rec.pendingStructural = true; orch.applyModel(rec.id, raw); }
    applyZ(orch, rec, (recs.get(rec) || {}).style);
    const R = nativeRenderer(orch);
    if (R && R.scheduler && typeof R.scheduler.invalidate === 'function') R.scheduler.invalidate(4);
    else if (R && typeof R.render === 'function') R.render();
  } catch (e) { console.warn('TradeZoro: indicator style redraw', e); }
}
function changed(){ try { if (wsRef) wsRef.context().stateChanged(); } catch (e) {} }
export function setStyle(orch, rec, st){
  const e = entryOf(orch, rec);
  const prevZ = e.style && e.style.z;
  e.style = sanitize(st);
  if (prevZ && !(e.style && e.style.z)) { try { const R = nativeRenderer(orch); R && R.set && R.set('seriesOrder', { id: rec.id, to: 'front' }); } catch (x) {} }
  redraw(orch, rec);
  changed();
}
export function getStyle(orch, rec){ return clone(entryOf(orch, rec).style || {}); }

// ── persistence ─────────────────────────────────────────────────────────────
let installed = false;
export function installIndStyle(Core){
  if (installed) return;
  installed = true;
  try {
    Core.registerStatePersistence({
      key: PERSIST_KEY, scope: 'cell',
      serialize(ctx){
        const orch = ctx.chart && ctx.chart.orchestrator;
        if (!orch) return undefined;
        wrapOrchestrator(orch);
        const out = [];
        try {
          orch.registry.all().forEach((rec) => { const e = recs.get(rec); if (e && e.style) out.push({ k: identity(rec), i: indexOf(orch, rec), s: e.style }); });
          // restored entries whose indicator has not drawn yet stay in the document
          (pending.get(orch) || []).forEach((x) => out.push(x));
        } catch (e) {}
        return out.length ? out : undefined;
      },
      restore(payload, ctx){
        const orch = ctx.chart && ctx.chart.orchestrator;
        if (!orch) return;
        wrapOrchestrator(orch);
        const list = Array.isArray(payload) ? payload.filter((x) => x && typeof x.k === 'string' && sanitize(x.s)).slice(0, 60).map((x) => ({ k: x.k.slice(0, 90), i: Math.max(0, x.i | 0), s: sanitize(x.s) })) : [];
        pending.set(orch, list);
        // indicators already drawn (template applied over a live cell): restyle them now
        try {
          orch.registry.all().forEach((rec) => {
            const k = identity(rec), i = indexOf(orch, rec), j = list.findIndex((x) => x.k === k && x.i === i);
            const e = recs.get(rec);
            if (j >= 0) { const s = list.splice(j, 1)[0].s; if (e) { e.style = s; redraw(orch, rec); } else recs.set(rec, { orch, style: s }); }
          });
        } catch (e) {}
      }
    });
  } catch (e) { console.warn('TradeZoro: indicator style persistence', e); }
}

// ── dialog UI ───────────────────────────────────────────────────────────────
const CSS = `
.stk-is{padding:10px 16px 14px;overflow:auto;box-sizing:border-box;min-height:0;flex:1 1 auto;font-size:13px;color:var(--vela-fg-bright,#e6e9ef);scrollbar-width:thin;scrollbar-color:rgba(128,128,128,.35) transparent;}
.stk-is::-webkit-scrollbar{width:6px;height:6px}.stk-is::-webkit-scrollbar-thumb{background:rgba(128,128,128,.35);border-radius:6px}.stk-is::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.6)}.stk-is::-webkit-scrollbar-track{background:transparent}
.stk-is-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:2px 0 10px;}
.stk-is-top .stk-is-lbl{color:var(--vela-fg-muted,#8b93a7);margin-right:2px;font-size:12px}
.stk-is-g{border:1px solid var(--vela-border,rgba(128,128,128,.25));border-radius:8px;margin:0 0 8px;overflow:hidden;}
.stk-is-gh{display:flex;align-items:center;gap:8px;min-height:38px;padding:0 10px;cursor:pointer;user-select:none;background:transparent;border:0;width:100%;color:inherit;font:inherit;text-align:left;}
.stk-is-gh:hover{background:var(--vela-hover,rgba(128,128,128,.08));}
.stk-is-chev{flex:none;width:14px;transition:transform .15s;color:var(--vela-fg-muted,#8b93a7)}
.stk-is-g.open .stk-is-chev{transform:rotate(90deg)}
.stk-is-gn{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.stk-is-gc{flex:none;color:var(--vela-fg-muted,#8b93a7);font-size:11px}
.stk-is-sw{flex:none;width:16px;height:16px;border-radius:4px;border:1px solid rgba(128,128,128,.4)}
.stk-is-gb{display:none;padding:4px 10px 10px;}
.stk-is-g.open .stk-is-gb{display:block}
.stk-is-r{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:36px;flex-wrap:wrap;}
.stk-is-r > span:first-child{color:var(--vela-fg-muted,#a3aabb);font-size:12.5px;flex:0 0 auto;min-width:96px}
.stk-is-c{display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end;}
.stk-is-p{height:28px;min-width:30px;padding:0 9px;border-radius:999px;border:1px solid var(--vela-border-strong,rgba(128,128,128,.35));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;}
.stk-is-p:hover{border-color:var(--vela-fg-muted,#8b93a7)}
.stk-is-p.on{background:rgba(3,201,136,.16);border-color:#03c988;color:#03c988}
.stk-is-p svg{display:block}
.stk-is-sel{height:30px;max-width:180px;padding:0 26px 0 10px;border-radius:8px;border:1px solid var(--vela-border-strong,rgba(128,128,128,.35));background:var(--vela-bg,#131722) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238b93a7' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 9px center;color:inherit;font:inherit;font-size:12.5px;appearance:none;-webkit-appearance:none;cursor:pointer;}
.stk-is-col{width:30px;height:28px;border-radius:8px;border:1px solid var(--vela-border-strong,rgba(128,128,128,.35));cursor:pointer;padding:3px;background:transparent;}
.stk-is-col i{display:block;width:100%;height:100%;border-radius:5px;background-image:linear-gradient(45deg,#8883 25%,transparent 25%,transparent 75%,#8883 75%),linear-gradient(45deg,#8883 25%,transparent 25%,transparent 75%,#8883 75%);background-size:8px 8px;background-position:0 0,4px 4px;position:relative}
.stk-is-col i b{position:absolute;inset:0;border-radius:5px}
.stk-is-rng{-webkit-appearance:none;appearance:none;width:110px;height:4px;border-radius:4px;background:linear-gradient(90deg,rgba(128,128,128,.25),#03c988);outline:none;cursor:pointer}
.stk-is-rng::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #03c988;cursor:pointer}
.stk-is-rng::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #03c988;cursor:pointer}
.stk-is-num{width:34px;text-align:right;color:var(--vela-fg-muted,#8b93a7);font-size:12px}
.stk-is-pop{position:fixed;z-index:2147483000;background:var(--vela-bg,#1e222d);border:1px solid var(--vela-border-strong,rgba(128,128,128,.35));border-radius:10px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);width:220px;}
.stk-is-pal{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-bottom:8px}
.stk-is-pal button{width:100%;aspect-ratio:1;border-radius:4px;border:1px solid rgba(128,128,128,.35);cursor:pointer;padding:0}
.stk-is-hex{width:100%;box-sizing:border-box;height:30px;border-radius:8px;border:1px solid var(--vela-border-strong,rgba(128,128,128,.35));background:transparent;color:inherit;font:inherit;padding:0 8px;margin-bottom:8px}
.stk-is-note{color:var(--vela-fg-muted,#8b93a7);font-size:11.5px;margin:4px 0 8px;line-height:1.4}
.stk-is-tfr{display:flex;align-items:center;gap:8px;min-height:36px;flex-wrap:wrap}
.stk-is-tfr input[type=number]{width:56px;height:28px;border-radius:8px;border:1px solid var(--vela-border-strong,rgba(128,128,128,.35));background:transparent;color:inherit;font:inherit;padding:0 6px}
.stk-is-tfr .stk-is-gn{min-width:80px;flex:0 0 auto}
html.stk-day .stk-is-sel{background-color:#fff}
@media (max-width:700px){ .stk-is{padding:8px 10px 12px} .stk-is-r > span:first-child{min-width:80px} .stk-is-p{height:32px;min-width:34px} .stk-is-sel{height:34px;max-width:150px} .stk-is-gh{min-height:44px} }
`;
const PALETTE = ['#ffffff', '#d1d4dc', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#000000', '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63', '#f7525f', '#ffb74d', '#fff176', '#81c784', '#03c988', '#4dd0e1', '#5b9cf6', '#9575cd'];
const DASH_SVG = (k) => '<svg width="26" height="8" viewBox="0 0 26 8"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="2" ' + (k === 'dashed' ? 'stroke-dasharray="6 4"' : k === 'dotted' ? 'stroke-dasharray="2 3" stroke-linecap="round"' : '') + '/></svg>';
const CHEV = '<svg class="stk-is-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>';
function h(tag, cls, html){ const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function ensureCss(){ if (document.getElementById('stk-is-css')) return; const s = document.createElement('style'); s.id = 'stk-is-css'; s.textContent = CSS; document.head.appendChild(s); }

let pop = null;
function closePop(){ if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', popAway, true); } }
function popAway(e){ if (pop && !pop.contains(e.target)) closePop(); }
function colorPop(anchor, cur, onPick){
  closePop();
  pop = h('div', 'stk-is-pop');
  const pal = h('div', 'stk-is-pal');
  PALETTE.forEach((c) => { const b = h('button'); b.type = 'button'; b.style.background = c; b.title = c; b.addEventListener('click', () => { onPick(c); closePop(); }); pal.appendChild(b); });
  const hex = h('input', 'stk-is-hex'); hex.value = toHex(cur); hex.spellcheck = false; hex.setAttribute('aria-label', 'Hex colour');
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (/^#[0-9a-f]{6}$/i.test(hex.value.trim())) { onPick(hex.value.trim()); closePop(); } } e.stopPropagation(); });
  pop.append(pal, hex);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const W = 220, H = pop.offsetHeight || 170;
  pop.style.left = Math.max(6, Math.min(window.innerWidth - W - 6, r.right - W)) + 'px';
  pop.style.top = (r.bottom + H + 8 < window.innerHeight ? r.bottom + 6 : Math.max(6, r.top - H - 6)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', popAway, true), 0);
}

// Builds the Style + Visibility tab bodies for one indicator.
function buildPanel(orch, rec, kind){
  const st = getStyle(orch, rec);
  st.el = st.el || {};
  const save = () => setStyle(orch, rec, st);
  const root = h('div', 'stk-is');
  root.dataset.stkIs = kind;
  const row = (label, ...ctrls) => { const r = h('div', 'stk-is-r'); const l = h('span'); l.textContent = label; const c = h('div', 'stk-is-c'); ctrls.forEach((x) => x && c.appendChild(x)); r.append(l, c); return r; };
  const pills = (opts, cur, onSet, cls) => { const w = h('div', 'stk-is-c'); const btns = opts.map(([v, lab, title]) => { const b = h('button', 'stk-is-p' + (cur === v ? ' on' : ''), lab); b.type = 'button'; b.dataset.v = String(v); if (title) { b.title = title; b.setAttribute('aria-label', title); } if (cls) b.classList.add(cls); b.addEventListener('click', () => { const was = b.classList.contains('on'); btns.forEach((x) => x.classList.remove('on')); if (!was || !cls) b.classList.add('on'); onSet(was && cls ? undefined : v); }); return b; }); btns.forEach((b) => w.appendChild(b)); return w; };
  const toggle = (label, cur, onSet) => { const b = h('button', 'stk-is-p' + (cur ? ' on' : ''), label); b.type = 'button'; b.setAttribute('aria-pressed', cur ? 'true' : 'false'); b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-pressed', v ? 'true' : 'false'); onSet(v); }); return b; };
  const select = (opts, cur, onSet, aria) => { const s = h('select', 'stk-is-sel'); if (aria) s.setAttribute('aria-label', aria); const d = h('option'); d.value = ''; d.textContent = 'As script'; s.appendChild(d); opts.forEach(([v, lab]) => { const o = h('option'); o.value = v; o.textContent = lab; s.appendChild(o); }); s.value = cur == null ? '' : String(cur); s.addEventListener('change', () => onSet(s.value === '' ? undefined : s.value)); return s; };
  const color = (cur, onSet, aria) => { const b = h('button', 'stk-is-col'); b.type = 'button'; if (aria) b.setAttribute('aria-label', aria); const i = h('i'); const f = h('b'); f.style.background = cur || 'transparent'; i.appendChild(f); b.appendChild(i); b.addEventListener('click', () => colorPop(b, cur, (c) => { cur = c; f.style.background = c; onSet(c); })); return b; };
  const range = (cur, onSet, aria) => { const w = h('div', 'stk-is-c'); const r = h('input', 'stk-is-rng'); r.type = 'range'; r.min = '0'; r.max = '100'; r.step = '5'; r.value = cur == null ? '100' : String(cur); if (aria) r.setAttribute('aria-label', aria); const n = h('span', 'stk-is-num'); n.textContent = (cur == null ? 'auto' : cur + '%'); r.addEventListener('input', () => { n.textContent = r.value + '%'; }); r.addEventListener('change', () => onSet(+r.value)); w.append(r, n); return w; };
  const setter = (o, k) => (v) => { if (v === undefined || v === null || v === '') delete o[k]; else o[k] = v; save(); };
  const widthPills = (o) => pills([1, 2, 3, 4, 5, 6].map((n) => [n, String(n), 'Width ' + n]), o.width, setter(o, 'width'), 'x');
  const dashPills = (o, k) => pills(['solid', 'dashed', 'dotted'].map((d) => [d, DASH_SVG(d), d.charAt(0).toUpperCase() + d.slice(1)]), o[k || 'lineStyle'], setter(o, k || 'lineStyle'), 'x');
  const textRows = (body, o) => {
    body.appendChild(row('Text size', select(Array.from({ length: 17 }, (_, i) => [String(i + 8), (i + 8) + ' px']), o.fontPx, (v) => setter(o, 'fontPx')(v == null ? v : +v), 'Text size')));
    body.appendChild(row('Text style', toggle('<b>B</b>', o.bold, setter(o, 'bold')), toggle('<i>I</i>', o.italic, setter(o, 'italic'))));
    body.appendChild(row('Font', pills([['site', 'Site'], ['mono', 'Mono']], o.font, setter(o, 'font'), 'x')));
  };

  if (kind === 'visibility') {
    st.tf = st.tf || { on: false, bands: {} };
    const tf = st.tf;
    root.appendChild(h('div', 'stk-is-note', 'Pick the timeframes this indicator shows on. Off = shows on every timeframe.'));
    root.appendChild(row('Limit timeframes', toggle(tf.on ? 'On' : 'Off', tf.on, (v) => { tf.on = v; save(); })));
    const lim = { s: 59, m: 59, h: 24, D: 366, W: 52, M: 12 };
    TIMEFRAME_BANDS.forEach(([b, name]) => {
      const r = tf.bands[b] || [1, lim[b]];
      const line = h('div', 'stk-is-tfr');
      const n = h('span', 'stk-is-gn'); n.textContent = name;
      const on = toggle(r.off ? 'Hidden' : 'Shown', !r.off, (v) => { tf.bands[b] = v ? [+lo.value || 1, +hi.value || lim[b]] : { off: true }; on.textContent = v ? 'Shown' : 'Hidden'; save(); });
      const lo = h('input'); lo.type = 'number'; lo.min = '1'; lo.max = String(lim[b]); lo.value = r.off ? 1 : r[0]; lo.setAttribute('aria-label', name + ' from');
      const hi = h('input'); hi.type = 'number'; hi.min = '1'; hi.max = String(lim[b]); hi.value = r.off ? lim[b] : Math.min(r[1], lim[b]); hi.setAttribute('aria-label', name + ' to');
      const upd = () => { if (!on.classList.contains('on')) return; tf.bands[b] = [Math.max(1, +lo.value || 1), Math.max(+lo.value || 1, +hi.value || lim[b])]; save(); };
      lo.addEventListener('change', upd); hi.addEventListener('change', upd);
      const dash = h('span', 'stk-is-gc', 'to');
      line.append(n, on, lo, dash, hi);
      root.appendChild(line);
    });
    return root;
  }

  // Style tab
  const top = h('div', 'stk-is-top');
  top.appendChild(h('span', 'stk-is-lbl', 'Draw'));
  top.appendChild(pills([['back', 'Below candles'], ['front', 'Above candles']], st.z, (v) => { if (v) st.z = v; else delete st.z; save(); }, 'x'));
  const sp = h('span'); sp.style.flex = '1'; top.appendChild(sp);
  const k = identity(rec);
  const bSave = h('button', 'stk-is-p', 'Save as default'); bSave.type = 'button';
  bSave.addEventListener('click', () => { const d = loadDefaults(); const cur = sanitize(st); if (cur) d[k] = cur; else delete d[k]; saveDefaults(d); bSave.textContent = 'Saved'; setTimeout(() => { bSave.textContent = 'Save as default'; }, 1400); });
  const bReset = h('button', 'stk-is-p', 'Reset style'); bReset.type = 'button'; bReset.dataset.stkReset = '1';
  top.append(bSave, bReset);
  root.appendChild(top);
  const groups = h('div');
  root.appendChild(groups);
  const raw = rec.__stkRaw || rec.model;
  const cat = catalog(raw);
  const hasLayer = (() => { try { const R = nativeRenderer(orch); return !!(R && R.extLayers && R.extLayers.some((l) => layerRec(orch, l) === rec)); } catch (e) { return false; } })();
  const phone = window.innerWidth < 700;
  const mkGroup = (name, count, swatch, build, startOpen) => {
    const g = h('div', 'stk-is-g' + (startOpen ? ' open' : ''));
    const head = h('button', 'stk-is-gh'); head.type = 'button';
    head.innerHTML = CHEV;
    const sw = h('span', 'stk-is-sw'); sw.style.background = swatch || 'transparent';
    const n = h('span', 'stk-is-gn'); n.textContent = name;
    head.append(sw, n);
    if (count > 1) head.appendChild(h('span', 'stk-is-gc', String(count)));
    head.setAttribute('aria-expanded', startOpen ? 'true' : 'false');
    const body = h('div', 'stk-is-gb');
    let built = false;
    const ensure = () => { if (!built) { built = true; build(body); } };
    if (startOpen) ensure();
    head.addEventListener('click', () => { ensure(); const o = g.classList.toggle('open'); head.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    g.append(head, body);
    groups.appendChild(g);
    return g;
  };
  if (hasLayer) {
    st.layer = st.layer || {};
    const o = st.layer;
    mkGroup('Chart drawing (cells, zones, levels, labels)', 1, '', (body) => {
      body.appendChild(row('Visible', toggle(o.visible === false ? 'Off' : 'On', o.visible !== false, (v) => { o.visible = v ? undefined : false; if (v) delete o.visible; save(); })));
      body.appendChild(row('Opacity', range(o.opacity, setter(o, 'opacity'), 'Opacity')));
      body.appendChild(row('Line width', widthPills(o)));
      body.appendChild(row('Line style', dashPills(o)));
      textRows(body, o);
      body.appendChild(h('div', 'stk-is-note', 'Colours of this drawing are in the Inputs tab.'));
    }, !cat.length);
  }
  cat.forEach((c, idx) => {
    const o = st.el[c.key] = st.el[c.key] || {};
    const s = c.sample || {};
    const baseColor = c.kind === 'series' ? s.style && s.style.color : c.kind === 'box' ? s.bgColor || s.borderColor : c.kind === 'table' ? s.bgColor : c.kind === 'polyline' ? s.lineColor || s.color : s.color;
    mkGroup(c.name, c.count, o.color || baseColor, (body) => {
      const vis = toggle(o.visible === false ? 'Off' : 'On', o.visible !== false, (v) => { vis.textContent = v ? 'On' : 'Off'; if (v) delete o.visible; else o.visible = false; save(); });
      body.appendChild(row('Visible', vis));
      const colorLabel = c.kind === 'box' ? 'Fill' : c.kind === 'table' ? 'Background' : c.kind === 'label' ? 'Colour (shape / label)' : 'Colour';
      body.appendChild(row(colorLabel, color(o.color || toHex(baseColor), setter(o, 'color'), colorLabel)));
      body.appendChild(row('Opacity', range(o.opacity != null ? o.opacity : Math.round(alphaOf(baseColor) * 100), setter(o, 'opacity'), 'Opacity')));
      if (c.kind === 'series') {
        body.appendChild(row('Plot type', select(PLOT_KINDS, o.kind, setter(o, 'kind'), 'Plot type')));
        body.appendChild(row('Line width', widthPills(o)));
        body.appendChild(row('Line style', dashPills(o)));
        body.appendChild(row('Price scale label', toggle(o.priceScale === false ? 'Off' : 'On', o.priceScale !== false, (v) => setter(o, 'priceScale')(v ? undefined : false))));
        body.appendChild(row('Status line value', toggle(o.statusLine === false ? 'Off' : 'On', o.statusLine !== false, (v) => setter(o, 'statusLine')(v ? undefined : false))));
      }
      if (c.kind === 'hline' || c.kind === 'line' || c.kind === 'polyline') { body.appendChild(row('Line width', widthPills(o))); body.appendChild(row('Line style', dashPills(o))); }
      if (c.kind === 'line') body.appendChild(row('Extend right', toggle(o.extendRight ? 'On' : 'Off', !!o.extendRight, setter(o, 'extendRight'))));
      if (c.kind === 'label') {
        body.appendChild(row('Shape', select(SHAPES, o.shape, setter(o, 'shape'), 'Shape')));
        body.appendChild(row('Shape size', pills(SIZES.map((z) => [z, z.charAt(0).toUpperCase() + z.slice(1)]), o.size, setter(o, 'size'), 'x')));
        body.appendChild(row('Placement', pills([['above', 'Above'], ['below', 'Below'], ['inside', 'Inside'], ['left', 'Left'], ['right', 'Right']], o.place, setter(o, 'place'), 'x')));
        body.appendChild(row('Text colour', color(o.textColor || toHex(s.textColor || '#d1d4dc'), setter(o, 'textColor'), 'Text colour')));
        textRows(body, o);
      }
      if (c.kind === 'box') {
        body.appendChild(row('Border', toggle(o.border === false ? 'Off' : 'On', o.border !== false, (v) => setter(o, 'border')(v ? undefined : false))));
        body.appendChild(row('Border colour', color(o.borderColor || toHex(s.borderColor || baseColor), setter(o, 'borderColor'), 'Border colour')));
        body.appendChild(row('Border width', pills([0, 1, 2, 3, 4, 5, 6].map((n) => [n, String(n), 'Border ' + n]), o.borderWidth, setter(o, 'borderWidth'), 'x')));
        body.appendChild(row('Border style', dashPills(o)));
        body.appendChild(row('Extend right', toggle(o.extendRight ? 'On' : 'Off', !!o.extendRight, setter(o, 'extendRight'))));
        body.appendChild(row('Text colour', color(o.textColor || toHex(s.textColor || '#d1d4dc'), setter(o, 'textColor'), 'Text colour')));
        textRows(body, o);
      }
      if (c.kind === 'table') {
        body.appendChild(row('Position', select(POSITIONS.map((p) => [p, nice(p)]), o.position, setter(o, 'position'), 'Table position')));
        body.appendChild(row('Cell background', color(o.cellColor || toHex(baseColor || '#131722'), setter(o, 'cellColor'), 'Cell background')));
        body.appendChild(row('Frame', toggle(o.border === false ? 'Off' : 'On', o.border !== false, (v) => setter(o, 'border')(v ? undefined : false))));
        body.appendChild(row('Frame colour', color(o.borderColor || toHex(s.frameColor || '#363a45'), setter(o, 'borderColor'), 'Frame colour')));
        body.appendChild(row('Text colour', color(o.textColor || '#d1d4dc', setter(o, 'textColor'), 'Text colour')));
        textRows(body, o);
      }
    }, !phone && idx === 0 && !hasLayer);
  });
  if (!cat.length && !hasLayer) groups.appendChild(h('div', 'stk-is-note', 'This indicator has drawn nothing yet. Its parts show here once it has drawn.'));
  return root;
}

function cellsOf(){ try { return wsRef.context().cells || []; } catch (e) { return []; } }
function nativeOfChart(chart){ const r = chart && chart.renderer; if (r && r.inputsUI) return r; if (r && r.renderer && r.renderer.inputsUI) return r.renderer; return null; }
function orchForDialog(dlg, id){
  for (const c of cellsOf()) {
    const n = nativeOfChart(c.chart);
    const o = c.chart && c.chart.orchestrator;
    if (n && n.inputsUI && n.inputsUI.inputsDialog === dlg && o) return o;
  }
  for (const o of orchs) { try { if (o.registry.get(id)) return o; } catch (e) {} }
  return null;
}
// Adds the Style + Visibility tabs to the open dialog.
function inject(dlg){
  const row = dlg.row, ui = dlg.uiDialog;
  if (!row || !ui || !ui.body) return;
  const orch = orchForDialog(dlg, row.id);
  const rec = orch && orch.registry.get(row.id);
  if (!rec) return;
  ensureCss();
  const tabsRow = [...ui.body.children].find((el) => el.querySelector && el.querySelector('.vela-ind-tab'));
  if (!tabsRow) return;
  const origTabs = [...tabsRow.querySelectorAll('.vela-ind-tab')];
  const origBodies = [...ui.body.children].filter((el) => el !== tabsRow);
  const mine = [];
  const show = (which) => {
    origBodies.forEach((b) => { if (which) { if (b.style.display !== 'none') b.dataset.stkWas = b.style.display; b.style.display = 'none'; } });
    origTabs.forEach((t) => { if (which) { t.style.borderBottomColor = 'transparent'; t.style.color = 'var(--vela-fg-muted)'; t.classList.remove('vela-ind-tab-active'); } });
    mine.forEach((m) => { const on = m.kind === which; m.body.style.display = on ? 'block' : 'none'; m.tab.style.borderBottomColor = on ? 'var(--vela-fg-bright)' : 'transparent'; m.tab.style.color = on ? 'inherit' : 'var(--vela-fg-muted)'; m.tab.classList.toggle('vela-ind-tab-active', on); });
  };
  origTabs.forEach((t) => t.addEventListener('click', () => show(null)));
  [['style', 'Style'], ['visibility', 'Visibility']].forEach(([kind, label]) => {
    const tab = document.createElement('div');
    tab.className = 'vela-ind-tab stk-is-tab';
    tab.dataset.stkTab = kind;
    tab.textContent = label;
    tab.style.cssText = 'padding:0 0 8px;margin-bottom:-1px;border-bottom:2px solid transparent;cursor:pointer;color:var(--vela-fg-muted);';
    const body = buildPanel(orch, rec, kind);
    body.style.display = 'none';
    tabsRow.appendChild(tab);
    ui.body.appendChild(body);
    const m = { kind, tab, body };
    mine.push(m);
    tab.addEventListener('click', () => {
      if (kind === 'style') { const nb = buildPanel(orch, rec, 'style'); nb.style.display = m.body.style.display; m.body.replaceWith(nb); m.body = nb; wireReset(); }
      show(kind);
    });
  });
  const wireReset = () => { const b = mine[0].body.querySelector('[data-stk-reset]'); if (b && !b.__w) { b.__w = 1; b.addEventListener('click', () => { const keepTf = getStyle(orch, rec).tf; setStyle(orch, rec, keepTf ? { tf: keepTf } : null); const nb = buildPanel(orch, rec, 'style'); nb.style.display = 'block'; mine[0].body.replaceWith(nb); mine[0].body = nb; wireReset(); }); } };
  wireReset();
  tabsRow.style.overflowX = 'auto'; tabsRow.style.scrollbarWidth = 'none';
  dlg.__stkStyleSnap = { orch, rec, style: getStyle(orch, rec) };
  if (dlg.__stkOpenTab) { const t = mine.find((m) => m.kind === dlg.__stkOpenTab); dlg.__stkOpenTab = null; if (t) t.tab.click(); }
}
function patchDialogProto(dlg){
  const proto = dlg && Object.getPrototypeOf(dlg);
  if (!proto || proto.__stkIndStyle) return !!(proto && proto.__stkIndStyle);
  const buildName = typeof proto.build === 'function' ? 'build' : 'open';
  if (typeof proto[buildName] !== 'function') return false;
  proto.__stkIndStyle = true;
  const origBuild = proto[buildName];
  proto[buildName] = function (row){
    const keep = this.__stkStyleSnap && this.row && row && this.row.id === row.id ? this.__stkStyleSnap : null;
    const r = origBuild.apply(this, arguments);
    try { if (this.dialog) { inject(this); if (keep) this.__stkStyleSnap = keep; } } catch (e) { console.warn('TradeZoro: Style tab', e); }
    return r;
  };
  const origRevert = proto.revertAndClose;
  if (typeof origRevert === 'function') proto.revertAndClose = function (){
    const s = this.__stkStyleSnap;
    this.__stkStyleSnap = null;
    try { if (s) { const now = JSON.stringify(getStyle(s.orch, s.rec)); if (now !== JSON.stringify(s.style)) setStyle(s.orch, s.rec, s.style); } } catch (e) {}
    closePop();
    return origRevert.apply(this, arguments);
  };
  const origReset = proto.resetToDefaults;
  if (typeof origReset === 'function') proto.resetToDefaults = function (){
    try { const s = this.__stkStyleSnap; if (s) setStyle(s.orch, s.rec, null); } catch (e) {}
    return origReset.apply(this, arguments);
  };
  const origClose = proto.close;
  if (typeof origClose === 'function') proto.close = function (){ closePop(); return origClose.apply(this, arguments); };
  return true;
}

export function mountIndStyle(ws){
  wsRef = ws;
  const apply = () => {
    cellsOf().forEach((c) => {
      const o = c.chart && c.chart.orchestrator;
      if (o) { wrapOrchestrator(o); wrapLayers(o); }
      const n = nativeOfChart(c.chart);
      if (n && n.inputsUI && n.inputsUI.inputsDialog) patchDialogProto(n.inputsUI.inputsDialog);
    });
  };
  apply();
  try { ws.on('layout:changed', () => setTimeout(apply, 0)); } catch (e) {}
  try { ws.on('state:changed', apply); } catch (e) {}
  // A timeframe switch re-runs most indicators; re-apply Visibility for the ones that do not.
  let lastTf = new Map();
  setInterval(() => {
    for (const o of orchs) {
      const tf = tfOf(o);
      if (lastTf.get(o) === tf) continue;
      lastTf.set(o, tf);
      try { o.registry.all().forEach((rec) => { const e = recs.get(rec); if (e && e.style && e.style.tf && e.style.tf.on) redraw(o, rec); }); } catch (e) {}
    }
  }, 1000);
  const api = {
    styleOf: (id) => { for (const o of orchs) { const r = o.registry.get(id); if (r) return getStyle(o, r); } return null; },
    setStyleById: (id, st) => { for (const o of orchs) { const r = o.registry.get(id); if (r) { setStyle(o, r, st); return true; } } return false; },
    catalogOf: (id) => { for (const o of orchs) { const r = o.registry.get(id); if (r) return catalog(r.__stkRaw || r.model).map((c) => ({ key: c.key, name: c.name, kind: c.kind, count: c.count })); } return null; },
    drawnModel: (id) => { for (const o of orchs) { const r = o.registry.get(id); if (r) return r.model; } return null; },
    rawModel: (id) => { for (const o of orchs) { const r = o.registry.get(id); if (r) return r.__stkRaw; } return null; },
    openTab: (dlg, kind) => { dlg.__stkOpenTab = kind; },
    applyStyle, catalog
  };
  window.STRYKER_IND_STYLE = api;
  return api;
}
