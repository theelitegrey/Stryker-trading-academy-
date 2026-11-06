// TradeZoro — Charts: Zscript glue (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls installZscript(Core, wsGetter) before the workspace is built and
// mountZscript(ws, opts) after mountPine); assets/zs-editor/* (code editor, examples, My scripts store, preview
// engine, fallback built-ins list); the Zscript engine worker assets/zs/worker.js (Zscript stream 1) when present.
//
// WHAT IT IS: our own indicator language, Zscript, on the chart. A Vela scripting engine for language id 'zscript'
// (ZsEngine below), registered as a default engine so every chart cell can run Zscript indicators; a "Zscript" tab in
// the chart's script editor panel (the panel where Pine Script lives, switched with a segmented control in its header);
// and the Zscript rows of the indicator window (assets/chart-indicator-window.js reads window.STRYKER_ZS).
// Pine Script support (assets/chart-pine*.js) is separate and unchanged.
//
// SAFETY: member scripts never run on the page. The source goes to a dedicated Web Worker (assets/zs/worker.js, or the
// preview engine assets/zs-editor/stub-worker.js while the engine is not in the repo) that returns plain data: plots,
// shapes, levels, drawings. This file only turns that data into Vela's indicator model. A first run that takes longer
// than RUN_LIMIT_MS terminates the cell's worker and fails the indicator; later runs (new bars) get LIVE_LIMIT_MS.
// Worker protocol: /root/projects/stryker-notes/reports/workers/zscript/contract.md ("S2 -> S1").
//
// PERSISTENCE: cell-scope handler 'stryker.zscript' stores [{ name, source, inputs }] in the workspace state, so
// sessions, templates and saved layouts keep Zscript indicators. A Zscript source starts with //@zscript 1; Pine's
// handle list skips those (chart-pine.js pineHandles).

import { ZS_EXAMPLES } from './zs-editor/examples.js?v=895';
import * as Store from './zs-editor/store.js?v=895';

const LANG = 'zscript';
const EXT_KEY = 'stryker.zscript';
const RUN_LIMIT_MS = 20000;
const LIVE_LIMIT_MS = 5000;
const MAX_PER_CELL = 8;
const SRC_MAX = 65536;
const MAX_INPUTS = 200;
const HEADER = /^\s*\/\/@zscript\s+1\b/;
const ENGINE_URL = new URL('./zs/worker.js?v=895', import.meta.url);
const STUB_URL = new URL('./zs-editor/stub-worker.js?v=895', import.meta.url);
const BUILTINS_URL = new URL('./zs/builtins.json?v=895', import.meta.url);
const NEW_SRC = '//@zscript 1\nindicator("My script", overlay=true)\nlen = input.int(20, "Length", minval=1)\nplot(ta.sma(close, len), "SMA", color=color.teal, linewidth=2)\n';

export const isZscript = (src) => typeof src === 'string' && HEADER.test(src.replace(/^\s*\n/, ''));
export function titleOf(src){
  const m = /^\s*indicator\s*\(\s*(?:title\s*=\s*)?(["'])((?:\\.|(?!\1).)*)\1/m.exec(String(src || ''));
  return (m && m[2].trim().slice(0, 80)) || 'Zscript';
}

// ---------- which worker: the real engine when it is deployed, else the preview engine ----------
let workerUrlP = null;
function workerUrl(){
  if (!workerUrlP) {
    workerUrlP = fetch(ENGINE_URL, { method: 'HEAD', cache: 'no-store' })
      .then((r) => (r.ok && /javascript/.test(r.headers.get('content-type') || '') ? ENGINE_URL : STUB_URL))
      .catch(() => STUB_URL);
  }
  return workerUrlP;
}
export const usingPreview = async () => (await workerUrl()) === STUB_URL;
async function spawn(){
  const url = await workerUrl();
  // The real engine is a module worker (contract); the preview engine is a classic script, which also runs as a module.
  return new Worker(url, { type: 'module', name: url === STUB_URL ? 'zscript-preview' : 'zscript' });
}

// ---------- built-in names for autocomplete / hover ----------
let builtinsP = null;
export function loadBuiltins(){
  if (!builtinsP) {
    builtinsP = fetch(BUILTINS_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => (Array.isArray(j) && j.length ? j : import('./zs-editor/builtins-fallback.js?v=895').then((m) => m.BUILTINS)));
  }
  return builtinsP;
}

// ---------- diagnostics ----------
const diagText = (d) => (d ? 'Line ' + (d.line || 1) + ':' + (d.col || 1) + ' ' + d.message + (d.hint ? ' ' + d.hint : '') : '');
function zsError(d){ const e = new Error(diagText(d)); e.diag = d; return e; }

// ---------- output -> Vela indicator model ----------
const LOC = { abovebar: 'abovebar', belowbar: 'belowbar', absolute: 'price', top: 'top', bottom: 'bottom' };
const KIND = { line: 'line', stepline: 'step', step: 'step', histogram: 'histogram', columns: 'columns', area: 'area', circles: 'circles', cross: 'cross' };
const SHAPE = { labelup: 'label_up', labeldown: 'label_down' };
const SIZES = new Set(['tiny', 'small', 'normal', 'large', 'huge', 'auto']);
const okColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([^)]{1,40}\))$/i.test(c.trim()) ? c.trim() : undefined);
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cap = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
const str = (s, n) => (s == null ? undefined : String(s).slice(0, n || 500));

export function toModel(out, bars, id, prepared, inputValues){
  out = out || {};
  const n = bars.length, T = (i) => (i >= 0 && i < n ? bars[i].time : null);
  const step = n > 1 ? bars[n - 1].time - bars[n - 2].time : 60000;
  const series = [], priceLines = [], fills = [], backgrounds = [], labels = [], lines = [], boxes = [], tables = [];
  const seriesId = new Map();
  cap(out.plots, 64).forEach((p, k) => {
    const sid = id + ':p:' + (p.id || k);
    seriesId.set(String(p.id), sid);
    const vals = Array.isArray(p.values) ? p.values : [];
    const cols = Array.isArray(p.colors) ? p.colors : null;
    const off = Math.trunc(fin(p.offset) || 0);
    const points = [];
    for (let i = 0; i < n; i++) {
      const pt = { time: bars[i].time + off * step, value: fin(vals[i]) };
      const c = cols && okColor(cols[i]); if (c) pt.color = c;
      points.push(pt);
    }
    const style = { color: okColor(p.color) || '#089981', width: Math.max(1, Math.min(10, fin(p.linewidth) || 1)), lineStyle: ['solid', 'dashed', 'dotted'].includes(p.linestyle) ? p.linestyle : 'solid' };
    const kind = KIND[p.style] || 'line';
    if (fin(p.histbase) != null && (kind === 'histogram' || kind === 'columns' || kind === 'area')) style.base = p.histbase;
    series.push({ id: sid, title: str(p.title, 80) || 'Plot ' + (k + 1), paneId: 'unrouted', kind, points, style, visible: p.display !== 'none' });
  });
  const hl = new Map();
  cap(out.hlines, 64).forEach((h, k) => {
    const price = fin(h.price); if (price == null) return;
    hl.set(String(h.id), h);
    priceLines.push({ id: id + ':h:' + (h.id || k), paneId: 'unrouted', price, color: okColor(h.color) || '#787B86', lineStyle: ['solid', 'dashed', 'dotted'].includes(h.linestyle) ? h.linestyle : 'dashed', title: str(h.title, 80) || '', width: Math.max(1, Math.min(10, fin(h.linewidth) || 1)) });
  });
  // fill between two hlines (or a plot and an hline): Vela fills join SERIES, so an hline in a fill gets a hidden constant series
  const ref = (key) => {
    key = String(key);
    if (seriesId.has(key)) return seriesId.get(key);
    const h = hl.get(key); if (!h) return null;
    const sid = id + ':hf:' + key;
    if (!seriesId.has('hf:' + key)) {
      seriesId.set('hf:' + key, sid);
      series.push({ id: sid, title: str(h.title, 80) || '', paneId: 'unrouted', kind: 'line', points: bars.map((b) => ({ time: b.time, value: h.price })), style: { color: 'rgba(0,0,0,0)', width: 1, lineStyle: 'solid' }, visible: false });
    }
    return sid;
  };
  cap(out.fills, 32).forEach((f, k) => {
    const a = ref(f.a), b = ref(f.b);
    if (!a || !b) return;
    const o = { id: id + ':f:' + (f.id || k), paneId: 'unrouted', fromSeriesId: a, toSeriesId: b };
    if (Array.isArray(f.colors)) o.colors = f.colors.slice(0, n).map((c) => okColor(c) || null); else o.color = okColor(f.color) || 'rgba(8,153,129,.12)';
    fills.push(o);
  });
  // bgcolor: runs of the same colour become one background span
  const bg = (cap(out.bgcolors, 200000).filter((x) => T(x.i) != null && okColor(x.color))).sort((a, b) => a.i - b.i);
  for (let j = 0; j < bg.length;) {
    let e = j; while (e + 1 < bg.length && bg[e + 1].i === bg[e].i + 1 && bg[e + 1].color === bg[j].color) e++;
    backgrounds.push({ id: id + ':bg:' + j, paneId: 'unrouted', from: T(bg[j].i), to: T(bg[e].i) + step, color: okColor(bg[j].color) });
    j = e + 1;
  }
  const barColors = cap(out.barcolors, 200000).filter((x) => T(x.i) != null && okColor(x.color)).map((x) => ({ time: T(x.i), color: okColor(x.color) }));
  cap(out.shapes, 64).forEach((s, k) => cap(s.marks, 5000).forEach((m, j) => {
    const t = T(m.i); if (t == null) return;
    const loc = LOC[m.location] || 'abovebar';
    labels.push({ id: id + ':s:' + (s.id || k) + ':' + j, paneId: 'unrouted', xloc: 'bar_time', x: t, y: fin(m.y) || 0, yloc: loc,
      text: m.char ? str(m.char, 4) + (m.text ? '\n' + str(m.text, 200) : '') : str(m.text, 200), style: m.char ? 'none' : (SHAPE[m.shape] || m.shape || 'circle'),
      color: okColor(m.color) || '#089981', textColor: okColor(m.textcolor), size: SIZES.has(m.size) ? m.size : 'small', textAlign: 'center', fontFamily: 'default' });
  }));
  const xl = (v) => (v === 'bar_time' ? 'bar_time' : 'bar_index');
  cap(out.labels, 500).forEach((l, k) => {
    const x = fin(l.x); if (x == null) return;
    labels.push({ id: id + ':l:' + (l.id || k), paneId: 'unrouted', xloc: xl(l.xloc), x, y: fin(l.y) || 0, yloc: l.yloc === 'abovebar' || l.yloc === 'belowbar' ? l.yloc : 'price',
      text: str(l.text, 500), style: SHAPE[l.style] || l.style || 'label_down', color: okColor(l.color) || '#2196F3', textColor: okColor(l.textcolor) || '#FFFFFF',
      size: SIZES.has(l.size) ? l.size : 'normal', textAlign: 'center', tooltip: str(l.tooltip, 500), fontFamily: 'default' });
  });
  cap(out.lines, 500).forEach((l, k) => {
    const v = [l.x1, l.y1, l.x2, l.y2].map(fin); if (v.some((x) => x == null)) return;
    lines.push({ id: id + ':ln:' + (l.id || k), paneId: 'unrouted', xloc: xl(l.xloc), x1: v[0], y1: v[1], x2: v[2], y2: v[3], extend: ['left', 'right', 'both'].includes(l.extend) ? l.extend : 'none',
      color: okColor(l.color) || '#2196F3', invisible: false, width: Math.max(1, Math.min(10, fin(l.width) || 1)), style: ['dashed', 'dotted'].includes(l.style) ? l.style : 'solid', arrowLeft: false, arrowRight: false });
  });
  cap(out.boxes, 500).forEach((b, k) => {
    const v = [b.left, b.top, b.right, b.bottom].map(fin); if (v.some((x) => x == null)) return;
    boxes.push({ id: id + ':bx:' + (b.id || k), paneId: 'unrouted', xloc: xl(b.xloc), left: v[0], top: v[1], right: v[2], bottom: v[3], extend: 'none',
      bgColor: okColor(b.bgcolor), borderColor: okColor(b.border_color), borderWidth: Math.max(0, Math.min(10, fin(b.border_width) ?? 1)), borderStyle: 'solid',
      text: str(b.text, 500), textColor: okColor(b.text_color), textSize: 'auto', hAlign: 'center', vAlign: 'center', wrap: false, fontFamily: 'default', bold: false, italic: false });
  });
  const POS = ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'];
  cap(out.tables, 20).forEach((t, k) => {
    const rows = cap(t.cells, 100).map((r) => cap(r, 50).map((c) => (c ? { text: str(c.text, 500), textColor: okColor(c.text_color), bgColor: okColor(c.bgcolor), hAlign: 'center', vAlign: 'center', textSize: SIZES.has(c.text_size) ? c.text_size : 'normal', fontFamily: 'default', bold: false, italic: false, merged: false } : null)));
    tables.push({ id: id + ':t:' + (t.id || k), paneId: 'unrouted', position: POS.includes(t.position) ? t.position : 'top_right', columns: Math.max(0, Math.min(50, fin(t.columns) || 0)), rows: Math.max(0, Math.min(100, fin(t.rows) || 0)),
      bgColor: okColor(t.bgcolor), frameColor: undefined, frameWidth: 0, borderColor: okColor(t.border_color), borderWidth: Math.max(0, fin(t.border_width) || 0), cells: rows, merges: [] });
  });
  const meta = prepared.meta;
  const model = { id, title: meta.title, overlay: meta.overlay, paneHint: meta.overlay ? 'price' : 'new', series, fills, backgrounds, priceLines, lines, boxes, labels, polylines: [], linefills: [], tables,
    barColors: barColors.length ? barColors : undefined, inputs: prepared.inputs, inputValues: Object.assign({}, defaultsOf(prepared.inputs), inputValues || {}) };
  if (n) model.anchorTime = bars[0].time;
  return model;
}
const defaultsOf = (inputs) => { const o = {}; (inputs || []).forEach((i) => { o[i.key] = i.defval; }); return o; };
const INPUT_TYPES = new Set(['int', 'float', 'bool', 'string', 'color', 'source', 'timeframe']);
function cleanInputs(list){
  return cap(list, MAX_INPUTS).filter((i) => i && typeof i.key === 'string' && INPUT_TYPES.has(i.type)).map((i) => {
    const o = { key: i.key.slice(0, 64), title: str(i.title, 80) || i.key, type: i.type, defval: i.defval };
    ['min', 'max', 'step'].forEach((k) => { if (fin(i[k]) != null) o[k] = i[k]; });
    if (Array.isArray(i.options)) o.options = i.options.slice(0, 100).map(String);
    if (i.group) o.group = str(i.group, 80);
    if (i.tooltip) o.tooltip = str(i.tooltip, 300);
    return o;
  });
}

// ---------- the Vela engine: one per chart cell, one worker per engine ----------
const notified = new Set();   // one-time notices (per page)
function notice(text){
  if (!text || notified.has(text)) return;
  notified.add(text);
  try { window.showToast && window.showToast('info', String(text).slice(0, 300), { duration: 6000 }); } catch (e) {}
}

export class ZsEngine {
  constructor(){
    this.language = LANG;
    this.capabilities = { streaming: false, visibleRange: false, inputs: true, props: false };
    this.worker = null; this.reqId = 0; this.sid = 0;
    this.waits = new Map(); this.sessions = new Map();
  }
  async w(){
    if (!this.worker) {
      this.worker = spawn().then((w) => {
        w.addEventListener('message', (e) => this.onMessage(e.data || {}));
        w.addEventListener('error', (e) => { e.preventDefault && e.preventDefault(); this.crash('The Zscript engine failed to start.'); });
        return w;
      });
    }
    return this.worker;
  }
  async post(m){ (await this.w()).postMessage(m); }
  crash(msg){
    const err = zsError({ line: 1, col: 1, severity: 'error', message: msg });
    this.waits.forEach((p) => p.reject(err)); this.waits.clear();
    this.sessions.forEach((s) => s.fail(err));
    this.kill();
  }
  kill(){ const w = this.worker; this.worker = null; if (w) w.then((x) => x.terminate()).catch(() => {}); }
  compile(source){
    const reqId = ++this.reqId;
    return new Promise((resolve, reject) => { this.waits.set(reqId, { resolve, reject }); this.post({ kind: 'compile', reqId, source }).catch(reject); });
  }
  async prepare(source, instanceId){
    if (String(source).length > SRC_MAX) throw zsError({ line: 1, col: 1, message: 'This script is longer than 64 KB.' });
    const r = await this.compile(source);
    const errs = (r.diagnostics || []).filter((d) => d.severity !== 'warning');
    if (!r.ok || errs.length) throw zsError(errs[0] || { line: 1, col: 1, message: 'The script did not compile.' });
    const meta = { title: str(r.meta && r.meta.title, 80) || titleOf(source), overlay: !!(r.meta && r.meta.overlay) };
    if (r.meta && r.meta.shorttitle) meta.shorttitle = str(r.meta.shorttitle, 40);
    return { language: LANG, inputs: cleanInputs(r.inputs), meta, reactsToViewport: false, token: { source, instanceId, program: r.program } };
  }
  execute(req, handlers){
    const sessionId = ++this.sid;
    const self = this;
    const s = { req, handlers, inputs: Object.assign({}, req.inputs || {}), first: true, busy: false, dirty: false, timer: 0, bars: null, alertSess: { primed: false, seen: new Set() }, stopped: false,
      fail(err){ clearTimeout(s.timer); if (!s.stopped) { s.stopped = true; self.sessions.delete(sessionId); try { handlers.onError && handlers.onError(err); } catch (e) {} } } };
    this.sessions.set(sessionId, s);
    const run = () => {
      if (s.stopped) return;
      if (s.busy) { s.dirty = true; return; }
      s.busy = true; s.dirty = false;
      const all = (req.getBars ? req.getBars() : req.bars) || [];
      s.bars = all.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }));
      const limit = s.first ? RUN_LIMIT_MS : LIVE_LIMIT_MS;
      s.timer = setTimeout(() => {
        // a run over the limit: replace the worker (every script on this cell restarts on the next bar) and fail this one
        self.kill();
        s.fail(zsError({ line: 1, col: 1, message: 'Script stopped: it took longer than ' + limit / 1000 + ' seconds.', hint: 'Use fewer bars of history or simpler loops.' }));
        self.sessions.forEach((o) => { o.busy = false; o.first = true; setTimeout(o.rerun, 0); });
      }, limit);
      const mk = req.market || {};
      this.post({ kind: 'run', sessionId, program: req.prepared.token.program, source: req.prepared.token.source, bars: s.bars, inputs: s.inputs, market: { symbol: mk.symbol, timeframe: mk.timeframe } })
        .catch((e) => s.fail(zsError({ line: 1, col: 1, message: 'The Zscript engine failed to start.' })));
    };
    s.rerun = run;
    s.done = (output) => {
      clearTimeout(s.timer); s.busy = false;
      if (s.stopped) return;
      s.first = false;
      let model;
      try { model = toModel(output, s.bars, req.prepared.token.instanceId, req.prepared, s.inputs); }
      catch (e) { s.fail(zsError({ line: 1, col: 1, message: 'The script produced output the chart cannot draw.' })); return; }
      try { handlers.onModel(model); } catch (e) { console.warn('TradeZoro: Zscript model', e); }
      cap(output && output.notices, 5).forEach(notice);
      routeAlerts(req, s, output);
      if (s.dirty) setTimeout(run, 0);
    };
    run();
    return {
      getContext: () => Promise.resolve(null),
      stop: () => { s.stopped = true; clearTimeout(s.timer); this.sessions.delete(sessionId); this.post({ kind: 'stop', sessionId }).catch(() => {}); },
      update: (inputs) => { s.inputs = Object.assign({}, inputs || {}); run(); },
      setVisibleRange: () => {},
      notifyBars: (reason) => { if (reason !== 'backfill') run(); }
    };
  }
  onMessage(m){
    if (m.kind === 'compiled') {
      const p = this.waits.get(m.reqId); if (!p) return;
      this.waits.delete(m.reqId); p.resolve(m);
    } else if (m.kind === 'result') {
      const s = this.sessions.get(m.sessionId); if (s) s.done(m.output);
    } else if (m.kind === 'error') {
      if (m.reqId != null && this.waits.has(m.reqId)) { const p = this.waits.get(m.reqId); this.waits.delete(m.reqId); p.reject(zsError(m.diag)); return; }
      const s = this.sessions.get(m.sessionId); if (s) { clearTimeout(s.timer); s.fail(zsError(m.diag || { line: 1, col: 1, message: 'The script stopped with an error.' })); }
    } else if (typeof m.kind === 'string' && m.kind.startsWith('data')) {
      // order book / order flow / GEX / options data requests: served by the data stream's adapter (assets/zs/data)
      const D = window.StrykerZsData;
      const s = this.sessions.get(m.sessionId) || [...this.sessions.values()][0];
      const mk = (s && s.req.market) || {};
      if (D && D.handle) { try { D.handle(m, { symbol: mk.symbol, timeframe: mk.timeframe, post: (reply) => this.post(reply) }); } catch (e) { console.warn('TradeZoro: Zscript data', e); } }
      else this.post({ kind: 'dataResult', reqId: m.reqId, sessionId: m.sessionId, error: 'unavailable' }).catch(() => {});
    }
  }
  terminate(){ this.kill(); }
}

// alertcondition()/alert() hits on the LAST bar go to the chart alerts module, which fires only alerts the member created
// for this indicator (same path as Pine, assets/chart-alerts.js window.__stkIndAlerts).
function routeAlerts(req, s, output){
  const R = window.__stkIndAlerts; if (!R || !R.event) return;
  try {
    R.event({ req, alert: null, sess: s.alertSess, kind: 'model' });
    const last = s.bars.length - 1;
    cap(output && output.alerts, 50).forEach((a) => {
      if (a.i !== last) return;
      R.event({ req, sess: s.alertSess, kind: 'alert', alert: { id: (a.kind === 'alert' ? 'alert' : 'alertcondition') + ':' + (a.id || ''), title: str(a.title, 120), message: str(a.message, 500) || '', time: s.bars[last].time } });
    });
  } catch (e) {}
}

// ---------- chart side ----------
let getWs = () => null;
const zsHandles = (chart) => { try { return chart.indicators().filter((h) => isZscript(h.source) && !h.nativeType); } catch (e) { return []; } };
function changed(){ try { const ws = getWs(); if (ws) ws.context().stateChanged(); } catch (e) {} }
function snapshot(h){ let inputs = {}; try { inputs = h.inputValues() || {}; } catch (e) {} return { name: titleOf(h.source), source: h.source, inputs }; }
function cleanEntry(x){
  if (!x || typeof x !== 'object' || !isZscript(x.source) || x.source.length > SRC_MAX) return null;
  const inputs = {};
  if (x.inputs && typeof x.inputs === 'object') Object.keys(x.inputs).slice(0, MAX_INPUTS).forEach((k) => {
    const v = x.inputs[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 4096)) inputs[k] = v;
  });
  return { name: typeof x.name === 'string' ? x.name.slice(0, 80) : 'Zscript', source: x.source, inputs };
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
          try { chart.addIndicator(x.source, { language: LANG, inputs: x.inputs }); } catch (e) { console.warn('TradeZoro: Zscript restore', e); }
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
  const previewNote = el('p', { class: 'stkc-zs-preview', hidden: '', text: 'Preview engine: plots are drawn only for simple averages and RSI until the Zscript engine is switched on.' });
  const addBtn = el('button', { type: 'button', class: 'stkc-sbtn stkc-zs-run', html: icon('<path d="M7 5l11 7-11 7z"/>', 16) + '<span>Add to chart</span>' });
  const checkBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'Check' });
  const saveBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'Save' });
  const newBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'New' });
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
  panel.appendChild(el('div', { class: 'stkc-pine-body' }, [el('div', { class: 'stkc-saverow' }, [nameIn]), edHost, errBox, previewNote, lib]));
  panel.appendChild(el('div', { class: 'stkc-pine-acts' }, [addBtn, checkBtn, saveBtn, newBtn]));
  host.appendChild(panel);
  lib.open = !window.matchMedia('(max-width:700px)').matches;

  // the same switch in the Pine panel's header (above its title)
  if (pinePanel) {
    const phd = pinePanel.querySelector('.stkc-pine-hd > div');
    if (phd) { phd.classList.add('stkc-zs-hl'); phd.insertBefore(langSwitch('pine', (k) => switchTo(k)), phd.firstChild); const h2 = phd.querySelector('h2'); if (h2) h2.classList.add("sr-only"); }
  }

  let ed = null, edP = null, lintW = null, editingId = null, busy = false, draft = null;
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
  // a separate worker for compile-as-you-type, alive while the panel is open
  let lintSeq = 0; const lintWaits = new Map();
  async function lint(src){
    if (!lintW) { lintW = spawn().then((w) => { w.addEventListener('message', (e) => { const m = e.data || {}; const r = lintWaits.get(m.reqId); if (r) { lintWaits.delete(m.reqId); r(m); } }); return w; }); }
    const w = await lintW, reqId = ++lintSeq;
    const m = await new Promise((resolve) => { lintWaits.set(reqId, resolve); w.postMessage({ kind: 'compile', reqId, source: src }); setTimeout(() => { if (lintWaits.delete(reqId)) resolve({ diagnostics: [] }); }, 4000); });
    return m.kind === 'error' ? [m.diag] : (m.diagnostics || []);
  }
  function stopLint(){ if (lintW) lintW.then((w) => w.terminate()).catch(() => {}); lintW = null; lintWaits.forEach((r) => r({ diagnostics: [] })); lintWaits.clear(); }

  function ensureEditor(){
    if (!edP) {
      edP = Promise.all([import('./zs-editor/editor.js?v=895'), loadBuiltins()]).then(([m, builtins]) => {
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
      usingPreview().then((p) => { previewNote.hidden = !p; });
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
  window.STRYKER_ZS = {
    open: (src, name) => { setPref(true); if (P()) P().close(); setOpen(true); if (src != null) load(name || '', src, null); },
    openNew: () => { setPref(true); if (P()) P().close(); setOpen(true); load('', NEW_SRC, null); },
    close: () => setOpen(false), load, addToChart, addSource, runOnChart, handles: zsHandles, titleOf, isZscript, examples: ZS_EXAMPLES, store: Store, toModel
  };
  return { setOpen };
}
