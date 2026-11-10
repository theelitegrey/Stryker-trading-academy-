// TradeZoro — Charts: Zscript glue (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls installZscript(Core, wsGetter) before the workspace is built and
// mountZscript(ws, opts) after mountPine); assets/zs-editor/* (code editor, examples, My scripts store); the Zscript engine
// assets/zs/ (Zscript stream 1: runner.js, catalog.js), loaded on first use.
//
// WHAT IT IS: our own indicator language, Zscript, on the chart. A Vela scripting engine for language id 'zscript'
// (ZsEngine below), registered as a default engine so every chart cell can run Zscript indicators; a "Zscript" tab in
// the chart's script editor panel (the panel where Pine Script lives, switched with a segmented control in its header);
// and the Zscript rows of the indicator window (assets/chart-indicator-window.js reads window.STRYKER_ZS).
// Pine Script support (assets/chart-pine*.js) is separate and unchanged.
//
// SAFETY: member scripts never run on the page. Compile and run happen in the engine's sandboxed module worker
// (assets/zs/runner.js -> assets/zs/worker.js, Zscript stream 1: no network, no storage, hard time and memory limits; the
// runner kills a worker that runs too long). This file only turns the engine's plain-data output (SPEC.md 11.4) into
// Vela's indicator model, re-validating every colour, number and size on the way.
//
// PERSISTENCE: cell-scope handler 'stryker.zscript' stores [{ name, source, inputs }] in the workspace state, so
// sessions, templates and saved layouts keep Zscript indicators. A Zscript source starts with //@zscript 1; Pine's
// handle list skips those (chart-pine.js pineHandles).

import { ZS_EXAMPLES } from './zs-editor/examples.js?v=940';
import * as Store from './zs-editor/store.js?v=940';

const LANG = 'zscript';
const EXT_KEY = 'stryker.zscript';
const MAX_PER_CELL = 8;
const SRC_MAX = 65536;
const MAX_INPUTS = 200;
const HEADER = /^\s*\/\/@zscript\s+1\b/;
const NEW_SRC = '//@zscript 1\nindicator("My script", overlay=true)\nlen = input.int(20, "Length", minval=1)\nplot(ta.sma(close, len), "SMA", color=color.teal, linewidth=2)\n';

export const isZscript = (src) => typeof src === 'string' && HEADER.test(src.replace(/^\s*\n/, ''));
export function titleOf(src){
  const m = /^\s*indicator\s*\(\s*(?:title\s*=\s*)?(["'])((?:\\.|(?!\1).)*)\1/m.exec(String(src || ''));
  return (m && m[2].trim().slice(0, 80)) || 'Zscript';
}

// ---------- the engine (Zscript stream 1: assets/zs/runner.js + index.js, SPEC.md section 11) ----------
// Loaded on first use. Every compile and run happens in a sandboxed module worker (ZsRunner), never on the page.
let engineP = null;
function engine(){
  if (!engineP) engineP = import('./zs/runner.js?v=940').catch((e) => { engineP = null; throw e; });
  return engineP;
}
const NO_ENGINE = { code: 'E000', line: 1, col: 1, severity: 'error', message: 'The Zscript engine did not load.', hint: 'Check your connection and reload the page.' };
let compiler = null;
async function compileIn(source){
  try { const { ZsRunner } = await engine(); if (!compiler) compiler = new ZsRunner(); return await compiler.compile(source); }
  catch (e) { return { ok: false, diagnostics: [NO_ENGINE] }; }
}

// ---------- built-in names for autocomplete / hover (the engine's catalog) ----------
let builtinsP = null;
const sigOf = (f) => f.name + '(' + (f.params || []).map((p) => p.name + (p.def ? '=' + (p.def.var || JSON.stringify(p.def.v)) : '')).join(', ') + (f.variadic ? ', …' : '') + ')' + (f.ret && f.ret !== 'void' ? ' → ' + f.ret : '');
export function loadBuiltins(){
  if (!builtinsP) {
    builtinsP = import('./zs/catalog.js?v=940').then((m) => {
      const c = m.catalogJSON(), out = [], seen = new Set();
      const add = (o) => { if (!seen.has(o.name)) { seen.add(o.name); out.push(o); } };
      c.keywords.forEach((k) => add({ name: k, kind: 'keyword', sig: k, doc: '' }));
      c.types.forEach((k) => add({ name: k, kind: 'type', sig: k, doc: '' }));
      c.functions.forEach((f) => add({ name: f.name, kind: 'function', sig: sigOf(f), doc: (f.doc || '') + (f.data ? ' Uses order book, order flow, GEX or options data: na when your plan or the symbol does not have it.' : '') }));
      c.variables.forEach((v) => add({ name: v.name, kind: 'variable', sig: v.name + ': ' + v.type, doc: v.doc || '' }));
      c.constants.forEach((v) => add({ name: v.name, kind: 'constant', sig: v.name, doc: v.doc || '' }));
      out.slice().forEach((o) => { const p = o.name.split('.'); for (let i = 1; i < p.length; i++) add({ name: p.slice(0, i).join('.'), kind: 'namespace', sig: p.slice(0, i).join('.'), doc: '' }); });
      return out;
    }).catch(() => []);
  }
  return builtinsP;
}

// ---------- diagnostics ----------
const diagText = (d) => (d ? 'Line ' + (d.line || 1) + ':' + (d.col || 1) + ' ' + d.message + (d.hint ? ' ' + d.hint : '') : '');
function zsError(d){ const e = new Error(diagText(d)); e.diag = d; return e; }
const firstError = (list) => (list || []).find((d) => d && d.severity !== 'warning');

// ---------- engine output (SPEC 11.4) -> Vela indicator model ----------
const KIND = { line: 'line', linebr: 'line', stepline: 'step', histogram: 'histogram', columns: 'columns', area: 'area', areabr: 'area', circles: 'circles', cross: 'cross' };
const SHAPE = { labelup: 'label_up', labeldown: 'label_down' };
const SIZES = new Set(['tiny', 'small', 'normal', 'large', 'huge', 'auto']);
const STYLES = ['solid', 'dashed', 'dotted'];
const okColor = (c) => (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) ? c : undefined);
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cap = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
const str = (s, n) => (s == null ? undefined : String(s).slice(0, n || 500));
const width = (w, d) => Math.max(1, Math.min(10, fin(w) || d || 1));

export function toModel(out, bars, id, prepared, inputValues){
  out = out || {};
  const n = bars.time.length, T = (i) => (i >= 0 && i < n ? bars.time[i] : null);
  const step = n > 1 ? bars.time[n - 1] - bars.time[n - 2] : 60000;
  const series = [], priceLines = [], fills = [], backgrounds = [], labels = [], lines = [], boxes = [], tables = [], barColors = [];
  const ref = new Map();   // 'plot:<id>' | 'hline:<id>' -> series id (fills join series)
  const colorAt = (p, i) => okColor(p.colors ? p.colors[i] : p.color);
  cap(out.plots, 64).forEach((p) => {
    const vals = p.values || [], off = Math.trunc(fin(p.offset) || 0), hidden = p.display === 'none';
    if (p.kind === 'bgcolor' || p.kind === 'barcolor') {
      for (let i = 0; i < n; i++) {
        const c = Number.isNaN(vals[i]) ? undefined : colorAt(p, i);
        if (!c || hidden) continue;
        if (p.kind === 'barcolor') { barColors.push({ time: T(i), color: c }); continue; }
        let e = i; while (e + 1 < n && !Number.isNaN(vals[e + 1]) && colorAt(p, e + 1) === c) e++;
        backgrounds.push({ id: id + ':bg:' + p.id + ':' + i, paneId: 'unrouted', from: T(i) + off * step, to: T(e) + (off + 1) * step, color: c });
        i = e;
      }
      return;
    }
    if (p.kind === 'shape' || p.kind === 'char' || p.kind === 'arrow') {
      let k = 0;
      for (let i = 0; i < n && k < 5000; i++) {
        if (Number.isNaN(vals[i]) || hidden) continue;
        const up = p.kind === 'arrow' ? vals[i] > 0 : null;
        const loc = p.kind === 'arrow' ? (up ? 'belowbar' : 'abovebar') : ({ abovebar: 'abovebar', belowbar: 'belowbar', top: 'top', bottom: 'bottom', absolute: 'price' }[p.location] || 'abovebar');
        const style = p.kind === 'char' ? 'none' : p.kind === 'arrow' ? (up ? 'arrowup' : 'arrowdown') : (SHAPE[p.style] || p.style || 'circle');
        const text = p.kind === 'char' ? str(p.char, 4) + (p.text ? '\n' + str(p.text, 200) : '') : str(p.text, 200);
        labels.push({ id: id + ':s:' + p.id + ':' + (k++), paneId: 'unrouted', xloc: 'bar_time', x: T(i) + off * step, y: loc === 'price' ? vals[i] : 0, yloc: loc,
          text, style, color: colorAt(p, i) || '#089981ff', textColor: okColor(p.textcolor) || colorAt(p, i), size: SIZES.has(p.size) ? p.size : 'small', textAlign: 'center', fontFamily: 'default' });
      }
      return;
    }
    const kind = KIND[p.kind];
    if (!kind) return;   // shortcut: plotcandle / plotbar are not drawn yet; add when Vela gets an OHLC series kind
    const sid = id + ':p:' + p.id;
    ref.set('plot:' + p.id, sid);
    const points = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      const pt = { time: T(i) + off * step, value: Number.isFinite(v) ? v : null };
      if (p.colors) { const c = okColor(p.colors[i]); if (c) pt.color = c; }
      points[i] = pt;
    }
    const style = { color: okColor(p.color) || '#089981ff', width: width(p.linewidth), lineStyle: 'solid' };
    if (fin(p.histbase) != null && (kind === 'histogram' || kind === 'columns' || kind === 'area')) style.base = p.histbase;
    series.push({ id: sid, title: str(p.title, 80) || 'Plot ' + (p.id + 1), paneId: 'unrouted', kind, points, style, visible: !hidden });
  });
  cap(out.hlines, 64).forEach((h) => {
    const price = fin(h.price); if (price == null) return;
    priceLines.push({ id: id + ':h:' + h.id, paneId: 'unrouted', price, color: okColor(h.color) || '#787b86ff', lineStyle: STYLES.includes(h.linestyle) ? h.linestyle : 'dashed', title: str(h.title, 80) || '', width: width(h.linewidth) });
  });
  const hlineSeries = (hid) => {
    const key = 'hline:' + hid;
    if (ref.has(key)) return ref.get(key);
    const h = (out.hlines || []).find((x) => x.id === hid);
    if (!h || fin(h.price) == null) return null;
    const sid = id + ':hf:' + hid;
    ref.set(key, sid);
    series.push({ id: sid, title: '', paneId: 'unrouted', kind: 'line', points: bars.time.map((t) => ({ time: t, value: h.price })), style: { color: 'rgba(0,0,0,0)', width: 1, lineStyle: 'solid' }, visible: false });
    return sid;
  };
  cap(out.fills, 32).forEach((f) => {
    const a = f.between === 'hline' ? hlineSeries(f.a) : ref.get('plot:' + f.a);
    const b = f.between === 'hline' ? hlineSeries(f.b) : ref.get('plot:' + f.b);
    if (!a || !b) return;
    const o = { id: id + ':f:' + f.id, paneId: 'unrouted', fromSeriesId: a, toSeriesId: b };
    if (Array.isArray(f.colors)) o.colors = f.colors.slice(0, n).map((c) => okColor(c) || null); else o.color = okColor(f.color) || '#0899811f';
    fills.push(o);
  });
  const xl = (v) => (v === 'bar_time' ? 'bar_time' : 'bar_index');
  cap(out.labels, 500).forEach((l) => {
    const x = fin(l.x); if (x == null) return;
    labels.push({ id: id + ':l:' + l.id, paneId: 'unrouted', xloc: xl(l.xloc), x, y: fin(l.y) || 0, yloc: l.yloc === 'abovebar' || l.yloc === 'belowbar' ? l.yloc : 'price',
      text: str(l.text, 500), style: l.style || 'label_down', color: okColor(l.color) || '#2196f3ff', textColor: okColor(l.textcolor) || '#ffffffff',
      size: SIZES.has(l.size) ? l.size : 'normal', textAlign: ['left', 'right'].includes(l.textalign) ? l.textalign : 'center', tooltip: str(l.tooltip, 500), fontFamily: 'default' });
  });
  cap(out.lines, 500).forEach((l) => {
    const v = [l.x1, l.y1, l.x2, l.y2].map(fin); if (v.some((x) => x == null)) return;
    lines.push({ id: id + ':ln:' + l.id, paneId: 'unrouted', xloc: xl(l.xloc), x1: v[0], y1: v[1], x2: v[2], y2: v[3], extend: ['left', 'right', 'both'].includes(l.extend) ? l.extend : 'none',
      color: okColor(l.color) || '#2196f3ff', invisible: false, width: width(l.width), style: STYLES.includes(l.style) ? l.style : 'solid',
      arrowLeft: l.style === 'arrow_left' || l.style === 'arrow_both', arrowRight: l.style === 'arrow_right' || l.style === 'arrow_both' });
  });
  cap(out.boxes, 500).forEach((b) => {
    const v = [b.left, b.top, b.right, b.bottom].map(fin); if (v.some((x) => x == null)) return;
    boxes.push({ id: id + ':bx:' + b.id, paneId: 'unrouted', xloc: xl(b.xloc), left: v[0], top: v[1], right: v[2], bottom: v[3], extend: ['left', 'right', 'both'].includes(b.extend) ? b.extend : 'none',
      bgColor: okColor(b.bgcolor), borderColor: okColor(b.border_color), borderWidth: Math.max(0, Math.min(10, fin(b.border_width) ?? 1)), borderStyle: STYLES.includes(b.border_style) ? b.border_style : 'solid',
      text: str(b.text, 500), textColor: okColor(b.text_color), textSize: SIZES.has(b.text_size) ? b.text_size : 'auto', hAlign: 'center', vAlign: 'center', wrap: false, fontFamily: 'default', bold: false, italic: false });
  });
  const POS = ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'];
  cap(out.tables, 20).forEach((t) => {
    const cols = Math.max(0, Math.min(50, fin(t.columns) || 0)), rows = Math.max(0, Math.min(100, fin(t.rows) || 0));
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
    cap(t.cells, 5000).forEach((c) => {
      if (!(c.r >= 0 && c.r < rows && c.c >= 0 && c.c < cols)) return;
      grid[c.r][c.c] = { text: str(c.text, 500), textColor: okColor(c.text_color), bgColor: okColor(c.bgcolor), hAlign: ['left', 'right'].includes(c.text_halign) ? c.text_halign : 'center', vAlign: 'center', textSize: SIZES.has(c.text_size) ? c.text_size : 'normal', fontFamily: 'default', bold: false, italic: false, merged: false };
    });
    tables.push({ id: id + ':t:' + t.id, paneId: 'unrouted', position: POS.includes(t.position) ? t.position : 'top_right', columns: cols, rows,
      bgColor: okColor(t.bgcolor), frameColor: okColor(t.frame_color), frameWidth: Math.max(0, fin(t.frame_width) || 0), borderColor: okColor(t.border_color), borderWidth: Math.max(0, fin(t.border_width) || 0), cells: grid, merges: [] });
  });
  const meta = prepared.meta;
  const model = { id, title: meta.title, overlay: meta.overlay, paneHint: meta.overlay ? 'price' : 'new', series, fills, backgrounds, priceLines, lines, boxes, labels, polylines: [], linefills: [], tables,
    barColors: barColors.length ? barColors : undefined, inputs: prepared.inputs, inputValues: Object.assign({}, defaultsOf(prepared.inputs), inputValues || {}) };
  if (n) model.anchorTime = bars.time[0];
  return model;
}
const defaultsOf = (inputs) => { const o = {}; (inputs || []).forEach((i) => { o[i.key] = i.defval; }); return o; };
// engine input descriptors (SPEC 11.1) -> the chart's settings dialog inputs; key = the engine's input id
const INPUT_TYPES = { int: 'int', float: 'float', price: 'float', bool: 'bool', string: 'string', text_area: 'string', color: 'color', source: 'source', timeframe: 'timeframe' };
function cleanInputs(list){
  return cap(list, MAX_INPUTS).filter((i) => i && Number.isInteger(i.id) && INPUT_TYPES[i.kind]).map((i) => {
    const o = { key: String(i.id), title: str(i.title, 80) || 'Input ' + (i.id + 1), type: INPUT_TYPES[i.kind], defval: i.kind === 'color' && typeof i.defval === 'string' ? i.defval.slice(0, 7) : i.defval };
    [['minval', 'min'], ['maxval', 'max'], ['step', 'step']].forEach(([k, to]) => { if (fin(i[k]) != null) o[to] = i[k]; });
    if (Array.isArray(i.options) && i.options.length) o.options = i.options.slice(0, 100).map(String);
    if (i.group) o.group = str(i.group, 80);
    if (i.tooltip) o.tooltip = str(i.tooltip, 300);
    return o;
  });
}
const runInputs = (vals) => { const o = {}; Object.keys(vals || {}).forEach((k) => { if (/^\d+$/.test(k)) o[k] = vals[k]; }); return o; };

// ---------- the Vela engine: one per chart cell; one sandboxed worker per indicator ----------
const notified = new Set();   // one-time notices (per page)
function notice(text, upgrade){
  if (!text || notified.has(text)) return;
  notified.add(text);
  const action = upgrade === 'of' || upgrade === 'gex' ? { label: 'See plans', onClick: () => { import('./chart-pro-gate.js?v=940').then((m) => m.upgrade(upgrade)).catch(() => {}); } } : undefined;
  try { window.showToast && window.showToast('info', String(text).slice(0, 300), { duration: 6000, action }); } catch (e) {}
}

// ---------- data hub (Zscript stream 3, assets/zs/data/hub.js) ----------
// One hub session per running script: it reads what the chart already holds (book, trades, GEX, options) and posts per-bar
// frames to the script's worker; request.security goes through the same session (the chart's own fetchSeries + series cache).
let secSeq = 0;
async function openHub(req, runner, uses, onFrames){
  const { getHub } = await import('./zs/data/hub.js?v=940');
  const mk = req.market || {}, waits = new Map();
  let ready = null, again = 0; const readyP = new Promise((r) => { ready = r; setTimeout(r, 6000); });
  const sess = getHub().open({
    sessionId: 'zs' + (++secSeq), symbol: mk.symbol || '', timeframe: mk.timeframe || '', uses,
    fetchSeries: req.fetchSeries ? (sym, tf, range) => req.fetchSeries(sym, tf, range) : undefined,
    post: (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.kind === 'zs.sec.res') { const w = waits.get(m.reqId); waits.delete(m.reqId); if (w) w(m); return; }
      runner.post(m);
      if (m.kind === 'zs.data.init') ready();
      else if (m.kind === 'zs.data.frames' && !m.reset && Array.isArray(m.frames)) {
        // history grew after the first run (book history landed, GEX rows arrived): run again, at most every 2 s.
        // The forming bar alone does not count: its frame changes all the time and reaches the worker as zs.data.live.
        const b = sess.bars, lastT = b && b.length ? b[b.length - 1].time : null;
        if (m.frames.some((r) => r && r[0] !== lastT) && !again) again = setTimeout(() => { again = 0; onFrames(); }, 2000);
      }
    },
  });
  const security = (q) => new Promise((res) => { const reqId = ++secSeq; waits.set(reqId, res); sess.security(Object.assign({ reqId }, q)); });
  return { sess, ready: readyP, security };
}
// meta.securities [{id, symbol:{v}|{input}, timeframe}] -> { [id]: { bars: [[t,o,h,l,c,v]...] } } for run()
async function loadSecurities(hub, tok, inputs, chartSym, chartTf, bars){
  const out = {}, n = bars.time.length;
  if (!n) return out;
  const fixed = (v) => (!v ? '' : typeof v.v === 'string' ? v.v : Number.isInteger(v.input) && typeof inputs[String(v.input)] === 'string' ? inputs[String(v.input)] : '');
  const prefix = (/^([a-z_]+):/i.exec(chartSym) || [])[1];
  await Promise.all((tok.securities || []).map(async (s) => {
    let sym = fixed(s.symbol); const tf = fixed(s.timeframe) || tfStr(chartTf);
    if (!sym || sym === chartSym || sym === tickerOf(chartSym)) { if (tf === tfStr(chartTf)) return; sym = chartSym; }
    else if (prefix && !/^[a-z_]+:/i.test(sym)) sym = prefix + ':' + sym;
    const r = await hub.security({ sym, tf, from: bars.time[0], to: bars.time[n - 1] + 1 });
    if (r && Array.isArray(r.bars) && r.bars.length) out[s.id] = { bars: r.bars };
    else if (r && r.error) notice(r.error);
  }));
  return out;
}

// ---------- library scripts (Zscript stream 4, assets/zs-library.js ZSLib.get) ----------
// A protected script is added as a stub source "//@zscript 1 / //@lib <sid>": the program comes sealed to the worker's own key, is opened
// and kept INSIDE the worker (runner.open), and never reaches the page. Access is checked by the server on every load.
const LIB_RE = /^\s*\/\/@zscript 1\s*\n\/\/@lib ([A-Za-z0-9]{20})\b/;
const libOf = (src) => { const m = LIB_RE.exec(String(src || '')); return m ? m[1] : null; };
export const libStub = (sid, name) => '//@zscript 1\n//@lib ' + sid + '\nindicator("' + String(name || 'Library script').replace(/["\\\n\r]/g, '').slice(0, 60) + '")\n';
// The library script and what its Publish sheet needs (Creator Hub config + payments switch + styles), loaded on first use.
const addScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
const addCss = (href) => { if (document.querySelector('link[href="' + href + '"]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
let libP = null;
function zsLib(){
  if (window.ZSLib) return Promise.resolve(window.ZSLib);
  if (!libP) {
    addCss('/assets/creator.css?v=940'); addCss('/assets/zs-library.css?v=940');
    libP = (window.CREATOR_CONFIG ? Promise.resolve() : addScript('/assets/creator-config.js?v=940'))
      .then(() => (window.CP ? null : addScript('/assets/creator-pay.js?v=940')))
      .then(() => addScript('/assets/zs-library.js?v=940'))
      .then(() => { if (!window.ZSLib) throw new Error('library'); return window.ZSLib; })
      .catch((e) => { libP = null; throw e; });
  }
  return libP;
}
async function openLib(runner, sid){
  const pub = await runner.session();
  let d;
  try { d = await (await zsLib()).get(sid, pub); }
  catch (e) { throw Object.assign(new Error(String((e && e.message) || 'You cannot run this script.').slice(0, 200)), { zsUser: true }); }
  if (!d || !d.sealed) throw Object.assign(new Error('This script could not be opened.'), { zsUser: true });
  const o = await runner.open(d.sealed);
  if (!o || !o.ok) throw Object.assign(new Error('This script could not be opened.'), { zsUser: true });
  return o.meta || {};
}
async function libMeta(sid){
  const { ZsRunner } = await engine(); const r = new ZsRunner();
  try { return { ok: true, diagnostics: [], program: null, meta: await openLib(r, sid) }; }
  catch (e) { return { ok: false, diagnostics: [{ line: 1, col: 1, severity: 'error', message: (e && e.zsUser && e.message) || 'This script could not be opened.' }] }; }
  finally { r.dispose(); }
}
const tfStr = (tf) => String(tf || '').replace(/^(\d+)m$/, '$1');
const tickerOf = (sym) => String(sym || '').replace(/^[a-z]+:/i, '');
const typeOf = (sym) => (/^futures:/i.test(sym) ? 'futures' : /^(binance|bybit|okx|kraken|bitget|hyperliquid|coinbase|vest|crypto):/i.test(sym) ? 'crypto' : 'stock');
function columns(all){
  const n = all.length, b = { time: new Array(n), open: new Array(n), high: new Array(n), low: new Array(n), close: new Array(n), volume: new Array(n) };
  for (let i = 0; i < n; i++) { const x = all[i]; b.time[i] = x.time; b.open[i] = x.open; b.high[i] = x.high; b.low[i] = x.low; b.close[i] = x.close; b.volume[i] = x.volume || 0; }
  return b;
}

export class ZsEngine {
  constructor(){
    this.language = LANG;
    this.capabilities = { streaming: false, visibleRange: false, inputs: true, props: false };
  }
  async prepare(source, instanceId){
    if (String(source).length > SRC_MAX) throw zsError({ line: 1, col: 1, message: 'This script is longer than 64 KB.' });
    const lib = libOf(source);
    const r = lib ? await libMeta(lib) : await compileIn(source);
    if (!r.ok || firstError(r.diagnostics)) throw zsError(firstError(r.diagnostics) || { line: 1, col: 1, message: 'The script did not compile.' });
    const m = r.meta || {};
    const meta = { title: str(m.title, 80) || titleOf(source), overlay: !!m.overlay };
    if (m.shorttitle) meta.shorttitle = str(m.shorttitle, 40);
    return { language: LANG, inputs: cleanInputs(m.inputs), meta, reactsToViewport: false, token: { source, instanceId, program: r.program, lib, needs: m.needs || {}, securities: cap(m.securities, 16) } };
  }
  execute(req, handlers){
    let runner = null, stopped = false, busy = false, dirty = false, hasRun = false, last = null;
    let inputs = Object.assign({}, req.inputs || {});
    const tok = req.prepared.token, alertSess = { primed: false, seen: new Set() };
    const fail = (d) => { if (stopped) return; stopped = true; if (hub) { hub.sess.close(); hub = null; } if (runner) runner.dispose(); try { handlers.onError && handlers.onError(zsError(d)); } catch (e) {} };
    const mk = () => req.market || {};
    const uses = Object.keys(tok.needs || {}).filter((k) => tok.needs[k]);
    let hub = null;   // S3 data hub session: frames go straight to the worker (assets/zs/frames.js turns them into SPEC 11.3 arrays)
    const emit = (out, bars) => {
      let model;
      try { model = toModel(out, bars, tok.instanceId, req.prepared, inputs); }
      catch (e) { console.warn('TradeZoro: Zscript model', e); fail({ line: 1, col: 1, message: 'The script produced output the chart cannot draw.' }); return false; }
      try { handlers.onModel(model); } catch (e) { console.warn('TradeZoro: Zscript model', e); }
      cap(out.notices, 5).forEach(notice);
      return true;
    };
    const run = async () => {
      if (stopped) return;
      if (busy) { dirty = true; return; }
      busy = true; dirty = false;
      try {
        if (!runner) {
          const { ZsRunner } = await engine();
          runner = new ZsRunner({
            onNotice: (m) => notice(m.text, m.upgrade),
            onLive: (out) => { if (!stopped && out && out.ok !== false && last) emit(out, columns((req.getBars ? req.getBars() : req.bars) || [])); },
          });
          if (tok.lib) await openLib(runner, tok.lib);
        }
        if (!hub && (uses.length || (tok.securities || []).length)) hub = await openHub(req, runner, uses, () => { if (!stopped) { hasRun = false; run(); } });
        const all = (req.getBars ? req.getBars() : req.bars) || [];
        if (hub) hub.sess.setBars(all);
        if (hub && uses.length) await hub.ready;
        const bars = columns(all);
        const n = bars.time.length;
        let out;
        // live tick: same history, only the forming bar changed (or one new bar) -> update() reruns the last bar
        if (hasRun && last && n && bars.time[0] === last.first && (n === last.n || n === last.n + 1) && JSON.stringify(inputs) === last.inputs) {
          const i = n - 1;
          out = await runner.update({ bar: { time: bars.time[i], open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i], volume: bars.volume[i] } });
        } else {
          const sym = mk().symbol || '';
          // data / allowed left empty: the worker fills them from the hub's frames (frames.js framesToData, SPEC 11.3 arrays)
          const securities = hub ? await loadSecurities(hub, tok, inputs, sym, mk().timeframe, bars) : {};
          if (stopped) return;
          out = await runner.run({ program: tok.lib ? undefined : tok.program, held: !!tok.lib, bars, symbol: { ticker: tickerOf(sym), tickerid: sym, type: typeOf(sym) }, timeframe: tfStr(mk().timeframe), inputs: runInputs(inputs), allowed: {}, data: {}, securities });
        }
        if (stopped) return;
        if (!out || out.ok === false) { fail((out && out.error) || { line: 1, col: 1, message: 'The script stopped with an error.' }); return; }
        hasRun = true; last = { first: bars.time[0], n, inputs: JSON.stringify(inputs) };
        if (!emit(out, bars)) return;
        routeAlerts(req, alertSess, out, bars);
      } catch (e) {
        if (!stopped) { hasRun = false; if (runner) { runner.dispose(); runner = null; } fail(e && e.message === 'disposed' ? null : e && e.zsUser ? { line: 1, col: 1, message: e.message } : { line: 1, col: 1, message: 'The Zscript engine stopped. Remove the script and add it again.' }); }
      } finally {
        busy = false;
        if (dirty && !stopped) setTimeout(run, 0);
      }
    };
    run();
    return {
      getContext: () => Promise.resolve(null),
      stop: () => { stopped = true; if (hub) hub.sess.close(); hub = null; if (runner) runner.dispose(); runner = null; },
      update: (vals) => { inputs = Object.assign({}, vals || {}); hasRun = false; run(); },
      setVisibleRange: () => {},
      notifyBars: (reason) => { if (reason === 'backfill') hasRun = false; run(); }
    };
  }
  terminate(){ if (compiler) { compiler.dispose(); compiler = null; } }
}

// alertcondition()/alert() hits on the LAST bar go to the chart alerts module, which fires only alerts the member created
// for this indicator (same path as Pine, assets/chart-alerts.js window.__stkIndAlerts).
function routeAlerts(req, sess, out, bars){
  const R = window.__stkIndAlerts; if (!R || !R.event) return;
  const n = bars.time.length, t = bars.time[n - 1];
  try {
    R.event({ req, alert: null, sess, kind: 'model' });
    cap(out.alertconditions, 50).forEach((a) => { if (a.values && a.values[n - 1]) R.event({ req, sess, kind: 'alert', alert: { id: 'alertcondition:' + a.id, title: str(a.title, 120), message: str(a.message, 500) || '', time: t } }); });
    cap(out.alerts, 500).forEach((a) => { if (a.time === t || a.bar === n - 1) R.event({ req, sess, kind: 'alert', alert: { id: 'alert:', title: 'alert()', message: str(a.message, 500) || '', time: t } }); });
  } catch (e) {}
}

// ---------- chart side ----------
let getWs = () => null;
const zsHandles = (chart) => { try { return chart.indicators().filter((h) => isZscript(h.source) && !h.nativeType); } catch (e) { return []; } };
function changed(){ try { const ws = getWs(); if (ws) ws.context().stateChanged(); } catch (e) {} }
function snapshot(h){ let inputs = {}; try { inputs = h.inputValues() || {}; } catch (e) {} const o = { name: titleOf(h.source), source: h.source, inputs }; if (h.visible === false) o.hidden = true; return o; }
function cleanEntry(x){
  if (!x || typeof x !== 'object' || !isZscript(x.source) || x.source.length > SRC_MAX) return null;
  const inputs = {};
  if (x.inputs && typeof x.inputs === 'object') Object.keys(x.inputs).slice(0, MAX_INPUTS).forEach((k) => {
    const v = x.inputs[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 4096)) inputs[k] = v;
  });
  const o = { name: typeof x.name === 'string' ? x.name.slice(0, 80) : 'Zscript', source: x.source, inputs };
  if (x.hidden === true) o.hidden = true;   // hidden with the legend eye: comes back hidden
  return o;
}

// Called by vela-chart.js BEFORE the workspace is constructed.
export function installZscript(core, wsGetter){
  getWs = wsGetter;
  try { core.registerDefaultEngine(LANG, () => new ZsEngine()); } catch (e) { console.warn('TradeZoro: Zscript engine', e); }
  try {
    core.registerStatePersistence({
      key: EXT_KEY,
      scope: 'cell',
      serialize(ctx){ const l = zsHandles(ctx.chart).map(snapshot); return l.length ? l : undefined; },
      restore(payload, ctx){
        const chart = ctx.chart;
        zsHandles(chart).forEach((h) => { try { h.remove(); } catch (e) {} });   // a template over a cell: replace, never stack
        if (!Array.isArray(payload)) return;
        payload.map(cleanEntry).filter(Boolean).slice(0, MAX_PER_CELL).forEach((x) => {
          try { const h = chart.addIndicator(x.source, { language: LANG, inputs: x.inputs }); if (h && x.hidden) h.setVisible(false); } catch (e) { console.warn('TradeZoro: Zscript restore', e); }
        });
      }
    });
  } catch (e) { console.warn('TradeZoro: Zscript persistence', e); }
}

// Run a source on a chart. Resolves { ok, handle } or { ok:false, msg, diag }.
export async function runOnChart(chart, source){
  if (!isZscript(source)) return { ok: false, msg: 'A Zscript file starts with the line //@zscript 1.', diag: { line: 1, col: 1, message: 'A Zscript file starts with the line //@zscript 1.', hint: 'Add //@zscript 1 as the first line.' } };
  if (source.length > SRC_MAX) return { ok: false, msg: 'This script is longer than 64 KB.' };
  if (zsHandles(chart).length >= MAX_PER_CELL) return { ok: false, msg: 'This chart already has ' + MAX_PER_CELL + ' Zscript indicators. Remove one first.' };
  const kill = () => document.querySelectorAll('.vela-toast[data-type="error"][data-open]').forEach((t) => { delete t.dataset.open; });
  const res = await chart.runIndicator(source, { language: LANG });
  if (!res.ok) {
    kill(); setTimeout(kill, 60); setTimeout(kill, 400);   // the editor shows the error with its line; drop Vela's pill
    const d = res.error && res.error.diag;
    return { ok: false, msg: d ? diagText(d) : String((res.error && res.error.message) || 'The script did not run.'), diag: d };
  }
  changed();
  return { ok: true, handle: res.handle };
}

// ---------- editor panel ----------
const icon = (inner, size) => '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
function el(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const LANG_PREF = 'stryker_script_lang';
const prefZs = () => { try { return localStorage.getItem(LANG_PREF) === 'zs'; } catch (e) { return false; } };
const setPref = (zs) => { try { localStorage.setItem(LANG_PREF, zs ? 'zs' : 'pine'); } catch (e) {} };

// Segmented control [Pine Script | Zscript] for the header of both editor panels.
function langSwitch(active, onPick){
  const seg = el('div', { class: 'stkc-langseg', role: 'tablist', 'aria-label': 'Script language' });
  [['pine', 'Pine Script'], ['zs', 'Zscript']].forEach(([k, label]) => {
    const on = k === active;
    seg.appendChild(el('button', { type: 'button', role: 'tab', class: 'stkc-langseg-b' + (on ? ' on' : ''), 'aria-selected': on ? 'true' : 'false', tabindex: on ? '0' : '-1', text: label, onclick: () => { if (!on) onPick(k); } }));
  });
  seg.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const b = seg.querySelector('.stkc-langseg-b:not(.on)'); if (b) { b.click(); } } });
  return seg;
}

export function mountZscript(ws, opts){
  const toast = (opts && opts.toast) || (() => {});
  const tfLabel = (opts && opts.tfLabel) || ((t) => t);
  const host = document.querySelector('.stkchart-panel') || document.body;
  const pinePanel = document.getElementById('stkc-pine');
  const pineBtn = document.getElementById('stkc-pine-btn');
  const P = () => window.STRYKER_PINE;

  const panel = el('div', { class: 'stkc-pine stkc-zs', id: 'stkc-zs', role: 'dialog', 'aria-label': 'Zscript editor', hidden: '' });
  const target = el('span', { class: 'stkc-pine-target' });
  const closeBtn = el('button', { type: 'button', class: 'stkc-ib stkc-zs-x', 'aria-label': 'Close the Zscript editor', title: 'Close', html: icon('<path d="M6 6l12 12M18 6L6 18"/>') });
  const nameIn = el('input', { type: 'text', class: 'stkc-in', maxlength: '60', placeholder: 'Script name', 'aria-label': 'Script name' });
  const edHost = el('div', { class: 'stkc-pine-ed stkc-zs-ed' }, [el('div', { class: 'stkc-zs-loading', text: 'Loading editor…' })]);
  const errBox = el('div', { class: 'stkc-pine-err stkc-zs-err', role: 'alert', hidden: '' });
  const addBtn = el('button', { type: 'button', class: 'stkc-sbtn stkc-zs-run', html: icon('<path d="M7 5l11 7-11 7z"/>', 16) + '<span>Add to chart</span>' });
  const checkBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'Check' });
  const saveBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'Save' });
  const newBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'New' });
  const pubBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'Publish' });
  const onChart = el('ul', { class: 'stkc-tlist' });
  const mine = el('ul', { class: 'stkc-tlist' });
  const examples = el('ul', { class: 'stkc-tlist' });
  const listNote = el('p', { class: 'stkc-empty' });
  const lib = el('details', { class: 'stkc-pine-lib' }, [
    el('summary', { text: 'Scripts and examples' }),
    el('p', { class: 'stkc-pop-h', text: 'On this chart' }), onChart,
    el('p', { class: 'stkc-pop-h', text: 'My scripts' }), listNote, mine,
    el('p', { class: 'stkc-pop-h', text: 'Examples' }), examples,
    el('p', { class: 'stkc-note', text: 'Zscript runs in your browser on the chart\'s bars, in a sandbox with no access to your account. Order book, order flow, GEX and options data follow your plan. Education only. Not financial advice.' })
  ]);
  const hd = el('header', { class: 'stkc-pine-hd' }, [el('div', { class: 'stkc-zs-hl' }, [langSwitch('zs', (k) => switchTo(k)), target]), closeBtn]);
  panel.appendChild(hd);
  panel.appendChild(el('div', { class: 'stkc-pine-body' }, [el('div', { class: 'stkc-saverow' }, [nameIn]), edHost, errBox, lib]));
  panel.appendChild(el('div', { class: 'stkc-pine-acts' }, [addBtn, checkBtn, saveBtn, newBtn, pubBtn]));
  host.appendChild(panel);
  lib.open = !window.matchMedia('(max-width:700px)').matches;

  // the same switch in the Pine panel's header (above its title)
  if (pinePanel) {
    const phd = pinePanel.querySelector('.stkc-pine-hd > div');
    if (phd) { phd.classList.add('stkc-zs-hl'); phd.insertBefore(langSwitch('pine', (k) => switchTo(k)), phd.firstChild); const h2 = phd.querySelector('h2'); if (h2) h2.classList.add("sr-only"); }
  }

  let ed = null, edP = null, editingId = null, busy = false, draft = null;
  const isPhone = () => window.innerWidth <= 700;
  function activeCell(){
    const cells = (() => { try { return ws.context().cells; } catch (e) { return []; } })();
    let id = null; try { id = ws.active.id; } catch (e) {}
    const i = Math.max(0, cells.findIndex((c) => c.id === id));
    return { cell: cells[i], index: i, count: cells.length };
  }
  function renderTarget(){
    const a = activeCell();
    if (!a.cell) { target.textContent = ''; return; }
    const sym = String(a.cell.symbol || '').replace(/^[a-z]+:/i, '').replace(/1!$/, '');
    target.textContent = 'Adds to ' + (a.count > 1 ? 'chart ' + (a.index + 1) + ': ' : '') + sym + ' ' + tfLabel(a.cell.timeframe);
  }
  // compile-as-you-type: the shared sandboxed compiler (diagnostics with line:col and a "did you mean" hint)
  async function lint(src){ const r = await compileIn(src); return r.diagnostics || []; }
  function stopLint(){ if (compiler) { compiler.dispose(); compiler = null; } }

  function ensureEditor(){
    if (!edP) {
      edP = Promise.all([import('./zs-editor/editor.js?v=940'), loadBuiltins()]).then(([m, builtins]) => {
        edHost.innerHTML = '';
        ed = m.createZsEditor(edHost, { doc: draft != null ? draft : ZS_EXAMPLES[0].source, builtins, lint, onRun: () => addToChart(), onChange: () => { if (!errBox.hidden) showErr(null); } });
        if (draft == null) nameIn.value = ZS_EXAMPLES[0].name;
        return ed;
      }).catch((e) => { edP = null; edHost.innerHTML = ''; edHost.appendChild(el('div', { class: 'stkc-zs-loading', text: 'The editor did not load. Check your connection and reopen it.' })); throw e; });
    }
    return edP;
  }
  function showErr(d, text){
    if (!d && !text) { errBox.hidden = true; errBox.textContent = ''; if (ed) ed.showDiagnostics([]); return; }
    errBox.hidden = false;
    errBox.textContent = d ? diagText(d) : text;
    if (d && ed) { ed.showDiagnostics([d]); ed.goto(d.line, d.col); }
  }
  async function load(name, source, id){
    nameIn.value = name || ''; editingId = id || null; draft = source || '';
    const e = await ensureEditor(); e.set(source || ''); showErr(null);
  }

  async function addToChart(){
    if (busy) return;
    const e = await ensureEditor();
    const src = e.get();
    if (!src.trim()) { showErr(null, 'The script is empty.'); return; }
    const a = activeCell(); if (!a.cell) return;
    busy = true; addBtn.disabled = true; addBtn.lastChild.textContent = 'Running…'; showErr(null);
    try {
      const r = await runOnChart(a.cell.chart, src);
      if (r.ok) { toast('Added ' + titleOf(src) + ' to the chart'); if (isPhone()) setOpen(false); }
      else showErr(r.diag, r.msg);
    } catch (err) { console.warn('TradeZoro: Zscript run', err); showErr(null, 'The Zscript engine did not start. Reload the page and try again.'); }
    busy = false; addBtn.disabled = false; addBtn.lastChild.textContent = isPhone() ? 'Run' : 'Add to chart';
    renderLists();
  }
  async function check(){
    const e = await ensureEditor();
    checkBtn.disabled = true;
    try {
      const list = (await lint(e.get())).filter((d) => d && d.severity !== 'warning');
      if (list.length) showErr(list[0]); else { showErr(null); toast('No errors found'); }
    } catch (err) { showErr(null, 'The check did not run.'); }
    checkBtn.disabled = false;
  }
  addBtn.addEventListener('click', addToChart);
  checkBtn.addEventListener('click', check);
  newBtn.addEventListener('click', () => { load('', NEW_SRC, null).then(() => ed.focus()); });
  saveBtn.addEventListener('click', async () => {
    const e = await ensureEditor();
    let name = nameIn.value.trim();
    if (!name) { name = titleOf(e.get()); if (name === 'Zscript') name = ''; nameIn.value = name; }
    if (!name) { nameIn.focus(); showErr(null, 'Give the script a name first.'); return; }
    saveBtn.disabled = true;
    try { editingId = await Store.save(name, e.get(), editingId); toast('Script saved'); showErr(null); }
    catch (err) { showErr(null, (err && err.userMessage) || 'Could not save the script.'); console.warn('TradeZoro: Zscript save', err); }
    saveBtn.disabled = false;
    renderLists();
  });
  nameIn.addEventListener('keydown', (e) => e.stopPropagation());
  // Publish to the Script Library (assets/zs-library.js): compiles here first so a broken script never goes out.
  pubBtn.addEventListener('click', async () => {
    const e = await ensureEditor(), src = e.get();
    if (libOf(src)) { showErr(null, 'This is a library script. Publish new versions from its library page.'); return; }
    pubBtn.disabled = true;
    try {
      const r = await compileIn(src), d = firstError(r.diagnostics);
      if (!r.ok || d) { showErr(d || null, d ? null : 'The script did not compile.'); return; }
      showErr(null);
      const L = await zsLib();
      await L.openPublish({ source: src, program: r.program, title: nameIn.value.trim() || titleOf(src), onDone: (sid) => toast('Published. Open it in the Script Library: /script-library?s=' + sid) });
    } catch (err) { console.warn('TradeZoro: Zscript publish', err); showErr(null, 'The publish form did not open. Reload the page and try again.'); }
    finally { pubBtn.disabled = false; }
  });

  const ib = (label, svg, fn, cls) => el('button', { type: 'button', class: 'stkc-ib' + (cls ? ' ' + cls : ''), title: label, 'aria-label': label, html: icon(svg, 16), onclick: fn });
  const ICON_DEL = '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', ICON_REN = '<path d="M4 20h4L19 9l-4-4L4 16z"/>', ICON_ADD = '<path d="M12 5v14M5 12h14"/>';
  function row(label, badge, actions, onOpen){
    const li = el('li', { class: 'stkc-trow' });
    const b = el('button', { type: 'button', class: 'stkc-tname', title: 'Open in the editor', onclick: onOpen }, [el('span', { text: label })]);
    if (badge) b.appendChild(el('span', { class: 'stkc-badge', text: badge }));
    li.appendChild(b);
    const acts = el('span', { class: 'stkc-tacts' }); actions.forEach((x) => acts.appendChild(x)); li.appendChild(acts);
    return li;
  }
  async function renderLists(){
    renderTarget();
    onChart.innerHTML = '';
    const a = activeCell();
    const hs = a.cell ? zsHandles(a.cell.chart) : [];
    if (!hs.length) onChart.appendChild(el('li', { class: 'stkc-empty', text: 'No Zscript indicators on this chart.' }));
    hs.forEach((h) => onChart.appendChild(row(titleOf(h.source), null, [ib('Remove ' + titleOf(h.source) + ' from the chart', ICON_DEL, () => { try { h.remove(); } catch (e) {} changed(); renderLists(); }, 'stkc-del')], () => load(titleOf(h.source), h.source, null))));
    examples.innerHTML = '';
    ZS_EXAMPLES.forEach((x) => examples.appendChild(row(x.name, 'Example', [ib('Add ' + x.name + ' to the chart', ICON_ADD, () => { load(x.name, x.source, null).then(addToChart); })], () => load(x.name, x.source, null))));
    let r = { items: [] };
    try { r = await Store.list(); } catch (e) { r = { items: [], note: 'Could not load your scripts.' }; }
    mine.innerHTML = '';
    listNote.textContent = r.note || (r.items.length ? '' : 'None saved yet.');
    listNote.hidden = !listNote.textContent;
    r.items.forEach((t) => mine.appendChild(row(t.name, null, [
      ib('Add ' + t.name + ' to the chart', ICON_ADD, () => { load(t.name, t.source, t.id).then(addToChart); }),
      ib('Rename ' + t.name, ICON_REN, async () => { const v = window.prompt('Rename the script', t.name); if (!v || !v.trim()) return; try { await Store.rename(t.id, v); if (editingId === t.id) nameIn.value = v.trim(); } catch (e) { showErr(null, 'Could not rename.'); } renderLists(); }),
      ib('Delete ' + t.name, ICON_DEL, async () => { if (!window.confirm('Delete the script "' + t.name + '"? It stays on any chart it is already on.')) return; try { await Store.remove(t.id); if (editingId === t.id) editingId = null; } catch (e) { showErr(null, 'Could not delete.'); } renderLists(); }, 'stkc-del')
    ], () => load(t.name, t.source, t.id))));
  }

  function setOpen(open){
    panel.hidden = !open;
    document.body.classList.toggle('stkc-pine-open', open || (pinePanel && !pinePanel.hidden));
    if (pineBtn) pineBtn.setAttribute('aria-expanded', open || (pinePanel && !pinePanel.hidden) ? 'true' : 'false');
    if (open) {
      addBtn.lastChild.textContent = isPhone() ? 'Run' : 'Add to chart';
      renderLists();
      ensureEditor().then((e) => { if (!isPhone()) e.focus(); }).catch(() => {});
    } else stopLint();
  }
  function switchTo(k){
    setPref(k === 'zs');
    if (k === 'zs') { if (P()) P().close(); setOpen(true); panel.querySelector('.stkc-langseg-b.on').focus(); }
    else { setOpen(false); if (P()) { P().open(); const b = pinePanel && pinePanel.querySelector('.stkc-langseg-b.on'); if (b) b.focus(); } }
  }
  // The toolbar's script editor button opens the language used last.
  if (pineBtn) pineBtn.addEventListener('click', (e) => {
    if (!panel.hidden) { e.stopImmediatePropagation(); setOpen(false); return; }
    if (prefZs() && pinePanel && pinePanel.hidden) { e.stopImmediatePropagation(); setOpen(true); }
  }, true);
  closeBtn.addEventListener('click', () => { setOpen(false); if (pineBtn) pineBtn.focus(); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); setOpen(false); if (pineBtn) pineBtn.focus(); } });
  try { ws.on('cell:active', () => { if (!panel.hidden) setTimeout(renderLists, 0); }); } catch (e) {}
  try { ws.on('state:changed', () => { if (!panel.hidden) renderTarget(); }); } catch (e) {}

  // Indicator window (assets/chart-indicator-window.js): add an example / saved script without opening the editor.
  async function addSource(name, source){
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    const r = await runOnChart(a.cell.chart, source);
    if (r.ok) { toast('Added ' + (name || titleOf(source)) + ' to the chart'); if (!panel.hidden) renderLists(); }
    return r;
  }
  // /charts?zs=<sid> (Script Library "Add to chart"): load the script through the library and add it to the active chart.
  const qsid = (() => { try { const v = new URLSearchParams(location.search).get('zs'); return /^[A-Za-z0-9]{20}$/.test(v || '') ? v : null; } catch (e) { return null; } })();
  async function addLibrary(sid){
    let L; try { L = await zsLib(); } catch (e) { return { ok: false, msg: 'The Script Library did not load.' }; }
    let meta;
    try { meta = await L.get(sid, (await (async () => { const { ZsRunner } = await engine(); const r = new ZsRunner(); try { return await r.session(); } finally { r.dispose(); } })())); }
    catch (e) { const msg = String((e && e.message) || 'You cannot run this script.'); toast(msg); return { ok: false, msg }; }
    // open-source: the real source goes on the chart (readable, as the author chose); protected: the stub, opened in the worker
    const src = meta.access === 'open' && typeof meta.source === 'string' ? meta.source : libStub(sid, meta.name);
    const r = await addSource(meta.name, src);
    if (!r.ok) toast(r.msg || 'The script did not run.');
    return r;
  }
  if (qsid) setTimeout(() => { addLibrary(qsid).finally(() => { try { const u = new URL(location.href); u.searchParams.delete('zs'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } catch (e) {} }); }, 0);
  window.STRYKER_ZS = {
    open: (src, name) => { setPref(true); if (P()) P().close(); setOpen(true); if (src != null) load(name || '', src, null); },
    openNew: () => { setPref(true); if (P()) P().close(); setOpen(true); load('', NEW_SRC, null); },
    close: () => setOpen(false), load, addToChart, addSource, addLibrary, libStub, runOnChart, handles: zsHandles, titleOf, isZscript, examples: ZS_EXAMPLES, store: Store, toModel
  };
  return { setOpen };
}
