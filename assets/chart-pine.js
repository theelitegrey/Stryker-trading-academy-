// Stryker Trading Academy — Charts: Pine Script glue (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls installPine before the workspace is built and
// mountPine after); assets/chart-pine-scripts.js (window.StrykerPineScripts: saved scripts
// + the three example scripts); the import map in charts.html ("pinets",
// "@luxalgo/vela/plugin").
//
// WHAT THIS FILE IS: the only Stryker code that touches the Pine Script engine. It wires
// the engine into the Vela chart cells and draws the editor panel. Nothing else.
//
// LICENCE (AGPL-3.0): Pine Script support comes from two LuxAlgo packages that are
// AGPL-3.0-only: @luxalgo/vela-pinets (the Vela engine adapter) and pinets (the PineTS
// runtime). They are loaded UNMODIFIED from jsDelivr at exact pinned versions, lazily
// (only when a member opens the Pine editor or a chart/template carries a Pine
// indicator), and never copied into this repo. Source links are in the (i) Credits
// popover (charts.html #stkc-credits), together with a link to this file's source.
// Never vendor, patch or minify-in their code; if a fix is needed, pin another version.
//
// VERSIONS: Vela is 0.6.17. vela-pinets 0.2.11 is the newest release whose peer range
// accepts it (^0.6.11 || ^0.7.0); 0.2.12+ need Vela 0.7.x/0.8.x. pinets (import map, used by the in-process fallback engine) is pinned in charts.html; 0.9.33 was the
// newest runtime published before vela-pinets 0.2.11 (it was built against ^0.9.32).
// The worker engine inlines its own PineTS copy, so the main-thread pinets is only used
// for module resolution.
//
// FALLBACK (build 404): the worker inlines its own PineTS from vela-pinets' build (0.9.3x),
// which lacks newer built-ins such as `scale.*`. A script the worker rejects with
// "X is not defined" is retried once on the in-process PineEngine, which runs the newer
// pinets pinned in charts.html' import map; such scripts are recorded as engine:'main'.
// The in-process engine runs on the page thread, so the 20 s cap can't interrupt it
// mid-run; PineTS' own loop guard still applies.
//
// HOW IT RUNS: PineWorkerEngine — each chart cell gets its own Web Worker, so a heavy
// script never blocks the page. A first run that takes longer than RUN_LIMIT_MS is
// stopped: the indicator is removed, that cell's worker is terminated and replaced,
// and the member sees "Script stopped: took too long". PineTS itself aborts runaway
// loops ("Loop exceeded maximum iterations").
//
// PERSISTENCE: Vela's shell does not persist script indicators added through the
// public API, so a cell-scope persistence handler ('stryker.pine') writes each cell's
// Pine indicators (name, source, inputs) into the workspace document. That puts them in
// the persist:true session AND in saved templates, and restores them on load.

const PINE_PKG = 'https://cdn.jsdelivr.net/npm/@luxalgo/vela-pinets@0.2.11/dist/index.js';
const RUN_LIMIT_MS = 20000;
const MAX_PER_CELL = 8;
const SRC_MAX = 65536;
const EXT_KEY = 'stryker.pine';

let enginePromise = null;   // resolves to the vela-pinets module
let Core = null;
let getWs = () => null;
const engines = new WeakMap(); // chart -> PineWorkerEngine
const mainEngines = new WeakMap(); // chart -> in-process PineEngine (fallback)
const onMain = new WeakSet();      // handles running on the in-process engine
// Community scripts on a chart: handle -> { id, version, openSource, ownerUid, name }.
// They always run on the Web Worker engine (never the in-page fallback) and are checked by
// StrykerPineGuard first; see assets/chart-pine-guard.js for why.
const libOf = new WeakMap();
const guardOk = (src) => { try { return !!(window.StrykerPineGuard && window.StrykerPineGuard.check(src).ok); } catch (e) { return false; } };
// Language ids. LANG_MAIN is our own registry key for the in-process engine.
const LANG = 'pine';
const LANG_MAIN = 'pine-main';

function loadPine(){
  if (!enginePromise) {
    enginePromise = import(PINE_PKG).then((m) => {
      if (!m || !m.PineWorkerEngine) throw new Error('Pine engine did not load');
      // Cells created from now on (layout widened) get an engine automatically.
      try { Core.registerDefaultEngine(LANG, () => new m.PineWorkerEngine({ props: 'strategy' })); } catch (e) {}
      try { Core.registerDefaultEngine(LANG_MAIN, () => new m.PineEngine({ props: 'strategy' })); } catch (e) {}
      return m;
    }).catch((e) => { enginePromise = null; throw e; });
  }
  return enginePromise;
}

async function ensureEngine(chart){
  const m = await loadPine();
  if (!engines.has(chart)) {
    const eng = new m.PineWorkerEngine({ props: 'strategy' });
    chart.registerEngine(LANG, eng);
    engines.set(chart, eng);
  }
  if (!mainEngines.has(chart)) {
    const e2 = new m.PineEngine({ props: 'strategy' });
    chart.registerEngine(LANG_MAIN, e2);
    mainEngines.set(chart, e2);
  }
  return engines.get(chart);
}

// Add a restored/kept script on the engine it ran on before.
function addOn(chart, x){
  if (x.lib && !guardOk(x.source)) { console.warn('Stryker: shared Pine script failed the safety check, not restored'); return null; }
  const main = x.engine === 'main' && !x.lib;
  const h = chart.addIndicator(x.source, { language: main ? LANG_MAIN : LANG, inputs: x.inputs || {} });
  if (main && h) onMain.add(h);
  if (x.lib && h) libOf.set(h, x.lib);
  return h;
}

// Pine indicators on a chart = script handles (natives carry nativeType, no source).
function pineHandles(chart){
  try { return chart.indicators().filter((h) => typeof h.source === 'string' && !h.nativeType); } catch (e) { return []; }
}
// Vela 0.6.17 leaves a script handle's title at "Indicator"; read the declared one.
function titleOf(h){
  const m = /^\s*(?:indicator|strategy)\s*\(\s*(?:title\s*=\s*)?(["'])((?:\\.|(?!\1).)*)\1/m.exec(String((h && h.source) || ''));
  return (m && m[2].trim().slice(0, 80)) || (h && h.title) || 'Pine script';
}
function snapshot(h){
  let inputs = {};
  try { inputs = h.inputValues() || {}; } catch (e) {}
  const o = { name: titleOf(h), source: h.source, inputs };
  if (onMain.has(h)) o.engine = 'main';
  if (libOf.has(h)) o.lib = libOf.get(h);
  return o;
}
function cleanEntry(x){
  if (!x || typeof x !== 'object' || typeof x.source !== 'string' || !x.source.trim() || x.source.length > SRC_MAX) return null;
  const inputs = {};
  if (x.inputs && typeof x.inputs === 'object') {
    Object.keys(x.inputs).slice(0, 100).forEach((k) => {
      const v = x.inputs[k];
      if (['string', 'number', 'boolean'].includes(typeof v)) inputs[k] = v;
    });
  }
  const o = { name: typeof x.name === 'string' ? x.name.slice(0, 80) : 'Pine script', source: x.source, inputs };
  const L = x.lib;
  if (L && typeof L === 'object' && /^[A-Za-z0-9]{20,40}$/.test(String(L.id || ''))) {
    o.lib = { id: L.id, version: +L.version || 1, openSource: L.openSource !== false, ownerUid: String(L.ownerUid || '').slice(0, 128), name: String(L.name || '').slice(0, 60) };
  } else if (x.engine === 'main') o.engine = 'main';
  return o;
}

function changed(){ try { const ws = getWs(); if (ws) ws.context().stateChanged(); } catch (e) {} }

// Restart a cell's worker (after a run went over the time limit) and re-add the others.
async function resetCell(chart, keep){
  const old = engines.get(chart);
  pineHandles(chart).forEach((h) => { try { h.remove(); } catch (e) {} });
  try { if (old && old.terminate) old.terminate(); } catch (e) {}
  engines.delete(chart);
  await ensureEngine(chart);
  keep.forEach((k) => { try { addOn(chart, k); } catch (e) {} });
  changed();
}

// Real Pine built-in namespaces and functions (TradingView reference). A name on this
// list that the runtime doesn't know is a GAP in our engine, not a typo by the member.
const PINE_BUILTINS = new Set(('ta math str array matrix map color input request strategy label line box table polyline '
  + 'linefill chart syminfo timeframe barstate session ticker plot shape location size position hline display format '
  + 'scale xloc yloc extend text font order currency dayofweek alert alertcondition runtime log adjustment backadjustment '
  + 'dividends earnings splits settlement_as_close barmerge footprint volume_row '
  + 'plotshape plotchar plotarrow plotbar plotcandle bgcolor barcolor fill indicator library max_bars_back '
  + 'fixnan nz na time time_close timestamp year month weekofyear dayofmonth hour minute second '
  + 'last_bar_index last_bar_time bar_index').split(' '));
function isPineBuiltin(name){ return PINE_BUILTINS.has(String(name).split('.')[0]); }

// Turn engine errors into something a member can act on.
function explain(err, source){
  let msg = String((err && err.message) || err || 'Unknown error');
  msg = msg.replace(/^Error:\s*/, '');
  let line = null;
  let m = /\bat (?:line )?(\d+):(\d+)/.exec(msg) || /line (\d+)(?:, col(?:umn)? (\d+))?/i.exec(msg);
  if (m) line = +m[1];
  if (!line) {
    const nd = /^([A-Za-z_][\w.]*) is not defined/.exec(msg) || /^(?:\w+\.)?((?:ta|math|str|array|matrix|map|request|strategy|label|line|box|table|polyline|chart|ticker|input|color|timeframe|syminfo|log|runtime)\.[A-Za-z_]\w*) is not a function/.exec(msg);
    if (nd) {
      const name = nd[1];
      const lines = String(source).split('\n');
      const re = new RegExp('(^|[^\\w.])' + name.replace(/\./g, '\\.') + '\\b');
      const i = lines.findIndex((l) => !/^\s*\/\//.test(l) && re.test(l));
      if (i >= 0) line = i + 1;
      msg = isPineBuiltin(name)
        ? '"' + name + '" isn\'t supported on our charts yet.'
        : '"' + name + '" is not a known variable or function.';
    }
  }
  msg = msg.replace(/^Failed to transpile Pine Script version \d+:\s*/, 'Syntax error: ');
  if (/request\.security|getMarketData|fetchSeries/i.test(msg)) msg += ' (request.security works only for symbols this chart can load, e.g. futures:ES1! or a crypto pair.)';
  if (/Loop exceeded maximum iterations/i.test(msg)) msg = 'Script stopped: a loop ran too many times.';
  return { msg, line };
}

// Vela also flashes its own "[cell] message" error toast on the chart for a failed run.
// The editor shows the error (with its line), so close that pill: the failed instance
// itself is already removed by runIndicator.
function hideVelaErrorToast(){
  const kill = () => document.querySelectorAll('.vela-toast[data-type="error"][data-open]').forEach((t) => { delete t.dataset.open; });
  kill(); setTimeout(kill, 60); setTimeout(kill, 400);
}

async function runOnChart(chart, source, inputs, shared){
  await ensureEngine(chart);
  if (pineHandles(chart).length >= MAX_PER_CELL) return { ok: false, msg: 'This chart already has ' + MAX_PER_CELL + ' Pine scripts. Remove one first.' };
  const keep = pineHandles(chart).map(snapshot);
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r({ timedOut: true }), RUN_LIMIT_MS); });
  let res = await Promise.race([chart.runIndicator(source, { language: LANG, inputs: inputs || {} }), timeout]);
  let main = false;
  // The worker's built-in PineTS is older than the page's (vela-pinets 0.2.11 inlines
  // its own copy). When it doesn't know a name (e.g. `scale.right`), retry once on the
  // in-process engine, which runs the newer pinets pinned in charts.html.
  if (!shared && res && !res.timedOut && !res.ok && /is not defined/.test(String(res.error && res.error.message))) {
    hideVelaErrorToast();
    res = await Promise.race([chart.runIndicator(source, { language: LANG_MAIN, inputs: inputs || {} }), timeout]);
    main = true;
  }
  clearTimeout(timer);
  if (res && res.timedOut) {
    await resetCell(chart, keep);
    return { ok: false, msg: 'Script stopped: took too long (over ' + (RUN_LIMIT_MS / 1000) + ' seconds).' };
  }
  if (!res || !res.ok) {
    hideVelaErrorToast();
    const ex = explain(res && res.error, source);
    return { ok: false, msg: ex.msg, line: ex.line };
  }
  if (main && res.handle) onMain.add(res.handle);
  changed();
  return { ok: true, handle: res.handle, engine: main ? 'main' : 'worker' };
}

// Called by vela-chart.js BEFORE the workspace is constructed.
export function installPine(core, wsGetter){
  Core = core;
  getWs = wsGetter;
  try {
    core.registerStatePersistence({
      key: EXT_KEY,
      scope: 'cell',
      serialize(ctx){
        const list = pineHandles(ctx.chart).map(snapshot);
        return list.length ? list : undefined;
      },
      restore(payload, ctx){
        if (!Array.isArray(payload)) return;
        const list = payload.map(cleanEntry).filter(Boolean).slice(0, MAX_PER_CELL);
        const chart = ctx.chart;
        // A template applied over a cell that already runs Pine: replace, never stack.
        pineHandles(chart).forEach((h) => { try { h.remove(); } catch (e) {} });
        if (!list.length) return;
        ensureEngine(chart).then(() => {
          list.forEach((x) => { try { addOn(chart, x); } catch (e) { console.warn('Stryker: Pine restore', e); } });
        }).catch((e) => { console.warn('Stryker: Pine engine failed to load', e); });
      }
    });
  } catch (e) { console.warn('Stryker: Pine persistence', e); }
}

// Remove Pine indicators from every cell (before a template without Pine is applied).
export function clearAllPine(){
  const ws = getWs();
  if (!ws) return;
  try { ws.context().cells.forEach((c) => pineHandles(c.chart).forEach((h) => { try { h.remove(); } catch (e) {} })); } catch (e) {}
}

// Published state of a Community script on a chart: 'gone' (unpublished / hidden),
// the current version number, or null when unknown. Cached per page load.
const libCache = new Map();
function libStatus(L){
  if (!libCache.has(L.id)) {
    const p = window.StrykerPineLibrary ? window.StrykerPineLibrary.get(L.id).then((x) => (x && x.status === 'ok' ? x.version : 'gone')).catch(() => null) : Promise.resolve(null);
    libCache.set(L.id, p);
  }
  return libCache.get(L.id);
}

// ---------------- editor UI ----------------
const icon = (inner) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
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
const NEW_SRC = '//@version=5\nindicator("My script", overlay=true)\nplot(ta.sma(close, 20), "SMA 20", color=color.teal)\n';

// "Community scripts" row at the top of Vela's Indicators picker. Called by vela-chart.js
// AFTER mountOrderflow, so it wraps the order-flow grouping: our row is index 0 and every
// other index moves down by one.
export function mountCommunityPicker(ws){
  let cell;
  try { cell = ws.active; } catch (e) { return; }
  const proto = cell && Object.getPrototypeOf(cell);
  if (!proto || proto.__stkCommunity || typeof proto.libraryRows !== 'function') return;
  proto.__stkCommunity = true;
  const rows = proto.libraryRows, add = proto.addFromLibrary;
  proto.libraryRows = function () {
    return [{ name: 'Community scripts: browse, add, publish', category: 'Community', language: 'pine' }].concat(rows.call(this));
  };
  proto.addFromLibrary = function (index) {
    if (index === 0) {
      try { if (ws.indicatorPicker) ws.indicatorPicker.close(); } catch (e) {}
      if (window.StrykerPineLibrary) window.StrykerPineLibrary.openCommunity();
      return;
    }
    return add.call(this, index - 1);
  };
}

// Called by vela-chart.js after the workspace exists. barL = our toolbar's left group.
export function mountPine(ws, barL, opts){
  const S = window.StrykerPineScripts;
  const toast = (opts && opts.toast) || (() => {});
  const tfLabel = (opts && opts.tfLabel) || ((t) => t);

  const btn = el('button', { type: 'button', class: 'stkc-btn', id: 'stkc-pine-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'stkc-pine', title: 'Pine Script editor',
    html: icon('<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>') + '<span class="stkc-btn-l">Pine</span>' });
  barL.appendChild(btn);

  // A div, not a <section>: the site's global `section{padding:96px 0}` would push the
  // panel down and clip its footer.
  const panel = el('div', { class: 'stkc-pine', id: 'stkc-pine', role: 'dialog', 'aria-label': 'Pine Script editor', hidden: '' });
  const target = el('span', { class: 'stkc-pine-target' });
  const closeBtn = el('button', { type: 'button', class: 'stkc-ib', 'aria-label': 'Close the Pine editor', title: 'Close', html: icon('<path d="M6 6l12 12M18 6L6 18"/>') });
  const nameIn = el('input', { type: 'text', class: 'stkc-in', maxlength: '60', placeholder: 'Script name', 'aria-label': 'Script name' });
  const gutter = el('div', { class: 'stkc-pine-gutter', 'aria-hidden': 'true' });
  const ta = el('textarea', { class: 'stkc-pine-code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', 'aria-label': 'Pine Script source' });
  const editor = el('div', { class: 'stkc-pine-ed' }, [gutter, ta]);
  const errBox = el('div', { class: 'stkc-pine-err', role: 'alert', hidden: '' });
  const addBtn = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Add to chart' });
  const saveBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'Save' });
  const newBtn = el('button', { type: 'button', class: 'stkc-btn', text: 'New' });
  const onChart = el('ul', { class: 'stkc-tlist' });
  const mine = el('ul', { class: 'stkc-tlist' });
  const examples = el('ul', { class: 'stkc-tlist' });
  const listNote = el('p', { class: 'stkc-empty' });
  const libBody = el('details', { class: 'stkc-pine-lib' }, [
    el('summary', { text: 'Scripts and examples' }),
    el('p', { class: 'stkc-pop-h', text: 'On this chart' }), onChart,
    el('p', { class: 'stkc-pop-h', text: 'My scripts' }), listNote, mine,
    el('p', { class: 'stkc-pop-h', text: 'Examples' }), examples,
    el('p', { class: 'stkc-pop-h', text: 'Community' }),
    el('button', { type: 'button', class: 'stkc-btn stkc-comm-btn', text: 'Browse community scripts', onclick: () => { if (window.StrykerPineLibrary) window.StrykerPineLibrary.openCommunity(); } }),
    el('p', { class: 'stkc-note', text: 'Scripts run in your browser on the chart\'s bars. Pine Script support is partial: some built-ins may not work yet. Education only. Not financial advice.' })
  ]);
  panel.appendChild(el('header', { class: 'stkc-pine-hd' }, [
    el('div', {}, [el('h2', { text: 'Pine Script' }), target]), closeBtn
  ]));
  // Layout: header / body (name, editor that flexes, error, collapsible library) /
  // footer with the buttons pinned at the bottom, so they always fit the sheet.
  panel.appendChild(el('div', { class: 'stkc-pine-body' }, [
    el('div', { class: 'stkc-saverow' }, [nameIn]),
    editor, errBox, libBody
  ]));
  panel.appendChild(el('div', { class: 'stkc-pine-acts' }, [addBtn, saveBtn, newBtn]));
  libBody.open = !window.matchMedia('(max-width:700px)').matches;
  const host = document.querySelector('.stkchart-panel') || document.body;
  host.appendChild(panel);

  let editingId = null;   // saved script id the editor holds (null = new / example)
  let errLine = null;
  let busy = false;

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
  function renderGutter(){
    const n = Math.max(1, ta.value.split('\n').length);
    let h = '';
    for (let i = 1; i <= n; i++) h += '<span' + (i === errLine ? ' class="bad"' : '') + '>' + i + '</span>';
    gutter.innerHTML = h;
    gutter.scrollTop = ta.scrollTop;
  }
  function showErr(msg, line){
    errLine = line || null;
    errBox.hidden = !msg;
    errBox.textContent = msg ? (line ? 'Line ' + line + ': ' : '') + msg : '';
    renderGutter();
  }
  function load(name, source, id){
    nameIn.value = name || '';
    ta.value = source || '';
    editingId = id || null;
    showErr('');
    ta.scrollTop = 0;
  }

  ta.addEventListener('input', () => { if (errLine) errLine = null; renderGutter(); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText('    ', s, en, 'end');
      renderGutter();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addToChart(); }
    e.stopPropagation();   // keep Vela's chart shortcuts out of the editor
  });
  nameIn.addEventListener('keydown', (e) => e.stopPropagation());

  async function addToChart(){
    if (busy) return;
    const src = ta.value;
    if (!src.trim()) { showErr('The script is empty.'); return; }
    if (src.length > SRC_MAX) { showErr('This script is longer than 64 KB.'); return; }
    const a = activeCell();
    if (!a.cell) return;
    busy = true; addBtn.disabled = true; addBtn.textContent = enginePromise ? 'Running…' : 'Loading engine…';
    showErr('');
    try {
      const r = await runOnChart(a.cell.chart, src);
      if (r.ok) { toast('Added ' + titleOf(r.handle) + ' to the chart'); if (isPhone()) setOpen(false); }
      else showErr(r.msg, r.line);
    } catch (e) {
      console.warn('Stryker: Pine run', e);
      showErr("The Pine engine didn't load. Check your connection; an ad-blocker may be blocking cdn.jsdelivr.net.");
    }
    busy = false; addBtn.disabled = false; addBtn.textContent = 'Add to chart';
    renderLists();
  }
  addBtn.addEventListener('click', addToChart);
  newBtn.addEventListener('click', () => { load('', NEW_SRC, null); ta.focus(); });
  saveBtn.addEventListener('click', async () => {
    if (!S) return;
    let name = nameIn.value.trim();
    if (!name) { const m = /indicator\s*\(\s*(?:title\s*=\s*)?["']([^"']{1,60})/.exec(ta.value); name = m ? m[1] : ''; nameIn.value = name; }
    if (!name) { nameIn.focus(); showErr('Give the script a name first.'); return; }
    saveBtn.disabled = true;
    try { editingId = await S.save(name, ta.value, editingId); toast('Script saved'); showErr(''); }
    catch (e) { showErr((e && e.userMessage) || 'Could not save the script.'); console.warn('Stryker: Pine save', e); }
    saveBtn.disabled = false;
    renderLists();
  });

  function row(label, actions, onOpen, title){
    const li = el('li', { class: 'stkc-trow' });
    li.appendChild(el('button', { type: 'button', class: 'stkc-tname', title: title || 'Open in the editor', onclick: onOpen }, [el('span', { text: label })]));
    const acts = el('span', { class: 'stkc-tacts' });
    actions.forEach((a) => acts.appendChild(a));
    li.appendChild(acts);
    return li;
  }
  const ib = (label, svg, fn, cls) => el('button', { type: 'button', class: 'stkc-ib' + (cls ? ' ' + cls : ''), title: label, 'aria-label': label, html: icon(svg), onclick: fn });
  const ICON_DEL = '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>';
  const ICON_REN = '<path d="M4 20h4L19 9l-4-4L4 16z"/>';
  const ICON_ADD = '<path d="M12 5v14M5 12h14"/>';
  const ICON_SHARE = '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>';

  async function renderLists(){
    renderTarget();
    // On this chart (active cell)
    onChart.innerHTML = '';
    const a = activeCell();
    const hs = a.cell ? pineHandles(a.cell.chart) : [];
    if (!hs.length) onChart.appendChild(el('li', { class: 'stkc-empty', text: 'No Pine scripts on this chart.' }));
    const me = (() => { try { return firebase.auth().currentUser.uid; } catch (e) { return null; } })();
    hs.forEach((h) => {
      const L = libOf.get(h);
      const hidden = L && !L.openSource && L.ownerUid !== me;
      const li = row((L ? L.name || titleOf(h) : titleOf(h)), [
        ib('Remove ' + titleOf(h) + ' from the chart', ICON_DEL, () => { try { h.remove(); } catch (e) {} changed(); renderLists(); }, 'stkc-del')
      ], () => { if (hidden) showErr('Code hidden in the editor: the author shares this script without its source.'); else load(L ? L.name : titleOf(h), h.source, null); },
      hidden ? 'Code hidden in the editor' : 'Open its code in the editor');
      if (L) {
        const tag = el('span', { class: 'stkc-badge', text: 'Community v' + L.version + (hidden ? ' \u00b7 code hidden' : '') });
        li.querySelector('.stkc-tname').appendChild(tag);
        libStatus(L).then((st) => { if (st === 'gone') { tag.textContent = 'No longer published'; tag.classList.add('is-warn'); } else if (st > L.version) tag.textContent += ' \u00b7 v' + st + ' available'; });
      }
      onChart.appendChild(li);
    });
    // Examples
    examples.innerHTML = '';
    (S ? S.EXAMPLES : []).forEach((x) => examples.appendChild(row(x.name, [
      ib('Add ' + x.name + ' to the chart', ICON_ADD, () => { load(x.name, x.source, null); addToChart(); })
    ], () => load(x.name, x.source, null))));
    // My scripts
    if (!S) { listNote.textContent = 'Saving is unavailable.'; return; }
    let r = { items: [] };
    try { r = await S.list(); } catch (e) { r = { items: [], note: 'Could not load your scripts.' }; }
    mine.innerHTML = '';
    listNote.textContent = r.note || (r.items.length ? '' : (S.signedIn() ? 'None saved yet.' : 'None saved yet. Sign in to keep them on your account.'));
    listNote.hidden = !listNote.textContent;
    r.items.forEach((t) => mine.appendChild(row(t.name, [
      ib('Add ' + t.name + ' to the chart', ICON_ADD, () => { load(t.name, t.source, t.id); addToChart(); }),
      ib('Rename ' + t.name, ICON_REN, async () => {
        const v = window.prompt('Rename the script', t.name);
        if (!v || !v.trim()) return;
        try { await S.rename(t.id, v); if (editingId === t.id) nameIn.value = v.trim(); } catch (e) { showErr('Could not rename.'); }
        renderLists();
      }),
      ib('Publish or share ' + t.name, ICON_SHARE, () => {
        if (window.StrykerPineLibrary) window.StrykerPineLibrary.openPublish({ name: t.name, source: t.source });
        else showErr('Publishing is unavailable.');
      }),
      ib('Delete ' + t.name, ICON_DEL, async () => {
        if (!window.confirm('Delete the script "' + t.name + '"? It stays on any chart it is already on.')) return;
        try { await S.remove(t.id); if (editingId === t.id) editingId = null; } catch (e) { showErr('Could not delete.'); }
        renderLists();
      }, 'stkc-del')
    ], () => load(t.name, t.source, t.id))));
  }

  const isPhone = () => window.innerWidth <= 700;
  function setOpen(open){
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('stkc-pine-open', open);
    if (open) {
      if (!ta.value) load(S && S.EXAMPLES[0] ? S.EXAMPLES[0].name : '', S && S.EXAMPLES[0] ? S.EXAMPLES[0].source : NEW_SRC, null);
      renderGutter();
      renderLists();
      loadPine().catch(() => {});   // warm the engine while the member reads
      if (!isPhone()) setTimeout(() => ta.focus(), 0);
    }
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });
  closeBtn.addEventListener('click', () => { setOpen(false); btn.focus(); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.focus(); } });
  try { ws.on('cell:active', () => { if (!panel.hidden) setTimeout(renderLists, 0); }); } catch (e) {}
  try { ws.on('state:changed', () => { if (!panel.hidden) renderTarget(); }); } catch (e) {}

  // Add a Community script (s = pineLibrary item) to the active chart: safety
  // check, Web Worker engine only, and its library id rides the chart state.
  async function addShared(s){
    if (!guardOk(s.source)) return { ok: false, msg: 'This script failed the safety check, so it won\'t run.' };
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    try {
      const r = await runOnChart(a.cell.chart, s.source, {}, true);
      if (!r.ok) return { ok: false, msg: r.msg };
      libOf.set(r.handle, { id: s.id, version: s.version, openSource: s.openSource, ownerUid: s.ownerUid, name: s.name });
      changed();
      toast('Added ' + s.name + ' to the chart');
      if (!panel.hidden) renderLists();
      return { ok: true };
    } catch (e) {
      console.warn('Stryker: shared Pine run', e);
      return { ok: false, msg: "The Pine engine didn't load. Check your connection." };
    }
  }

  // Run a Pine source (Stryker example or one of My scripts) on the active chart, the same
  // engine path as the editor's Add to chart, without opening the editor. Used by the
  // Indicators window (assets/chart-indicator-window.js).
  async function addSource(name, source){
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    if (!source || !String(source).trim()) return { ok: false, msg: 'The script is empty.' };
    if (source.length > SRC_MAX) return { ok: false, msg: 'This script is longer than 64 KB.' };
    try {
      const r = await runOnChart(a.cell.chart, source);
      if (!r.ok) return { ok: false, msg: (r.line ? 'Line ' + r.line + ': ' : '') + r.msg };
      toast('Added ' + (name || titleOf(r.handle)) + ' to the chart');
      if (!panel.hidden) renderLists();
      return { ok: true };
    } catch (e) {
      console.warn('Stryker: Pine run', e);
      return { ok: false, msg: "The Pine engine didn't load. Check your connection." };
    }
  }

  window.STRYKER_PINE = { open: () => setOpen(true), close: () => setOpen(false), load, addToChart, addShared, addSource, runOnChart, pineHandles, titleOf, explain, renderLists, toast, libOf, RUN_LIMIT_MS };
  return { setOpen };
}
