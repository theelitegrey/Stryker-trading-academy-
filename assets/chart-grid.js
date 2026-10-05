// Stryker Trading Academy — Charts multi-chart GRID PICKER + SYNC IN LAYOUT (charts.html)
// ES module, imported by assets/vela-chart.js. Depends on: the self-hosted Vela
// workspace build (passed in as W = workspace.js, Core = index.js); style.css (.stkg-*).
//
// Owner order 2026-10-06 ("Build all"): TradingView's grid picker. Shapes for 1, 2
// (side / stacked), 3 (columns, rows, one big + two), 4 (2x2, 4 columns, 4 rows, 1 + 3),
// 5, 6 and 8 charts. Caps: 8 on desktop (performance), 4 on tablets AND phones (phones
// still show one chart at a time through the switcher in vela-chart.js). 10/12/14/16 are
// shown greyed with "Up to 8 charts on our site for smooth performance".
//
// SYNC IN LAYOUT: separate switches for Symbol, Interval, Crosshair, Time (Vela's
// 'symbol' / 'timeframe' / 'crosshair' / 'viewport' links) and Date range (ours): a
// range chip (1D, 7D, 1M ... in the bottom bar) picked on one chart is applied to every
// chart. All five persist inside the workspace document (Vela keeps its own four in
// state.sync; Date range rides state.ext['stryker.grid']), so a saved layout or
// template restores them.
//
// When a layout is wider than the device cap (an 8-chart layout opened on a tablet),
// the grid drops to the widest allowed shape; capFrom() reports the original id so a
// layout autosave never overwrites the member's 8-chart layout with the capped one.

const EXT_KEY = 'stryker.grid';

// Layout definitions. Ids '1', '2h', '2v', '4', '8' are Vela built-ins; '3l' predates this
// module (persisted sessions use it), so it keeps its id and shape.
const DEFS = [
  { id: '3c', label: '3 columns', cols: [1, 1, 1], rows: [1], n: 3 },
  { id: '3r', label: '3 rows', cols: [1], rows: [1, 1, 1], n: 3 },
  { id: '3l', label: '1 big + 2', cols: [2, 1], rows: [1, 1], areas: ['main a', 'main b'], cells: ['main', 'a', 'b'] },
  { id: '4c', label: '4 columns', cols: [1, 1, 1, 1], rows: [1], n: 4 },
  { id: '4r', label: '4 rows', cols: [1], rows: [1, 1, 1, 1], n: 4 },
  { id: '4l', label: '1 big + 3', cols: [2, 1], rows: [1, 1, 1], areas: ['main a', 'main b', 'main c'], cells: ['main', 'a', 'b', 'c'] },
  { id: '5a', label: '3 + 2', cols: [1, 1, 1, 1, 1, 1], rows: [1, 1], areas: ['a a b b c c', 'd d d e e e'], cells: ['a', 'b', 'c', 'd', 'e'] },
  { id: '5l', label: '1 big + 4', cols: [2, 1, 1], rows: [1, 1], areas: ['main a b', 'main c d'], cells: ['main', 'a', 'b', 'c', 'd'] },
  { id: '6', label: '3 x 2', cols: [1, 1, 1], rows: [1, 1], n: 6 },
  { id: '6r', label: '2 x 3', cols: [1, 1], rows: [1, 1, 1], n: 6 },
  { id: '8r', label: '2 x 4', cols: [1, 1], rows: [1, 1, 1, 1], n: 8 }
];

// Picker rows: [count, [[id, label], ...]]
const GROUPS = [
  [1, [['1', '1 chart']]],
  [2, [['2h', '2 side by side'], ['2v', '2 stacked']]],
  [3, [['3c', '3 columns'], ['3r', '3 rows'], ['3l', '1 big + 2']]],
  [4, [['4', '2 x 2 grid'], ['4c', '4 columns'], ['4r', '4 rows'], ['4l', '1 big + 3']]],
  [5, [['5a', '3 on top, 2 below'], ['5l', '1 big + 4']]],
  [6, [['6', '3 x 2 grid'], ['6r', '2 x 3 grid']]],
  [8, [['8', '4 x 2 grid'], ['8r', '2 x 4 grid']]]
];
const GREY = [10, 12, 14, 16];

const SYNCS = [
  ['symbol', 'Symbol', 'Changing the symbol on one chart changes it on all charts'],
  ['timeframe', 'Interval', 'Changing the interval on one chart changes it on all charts'],
  ['crosshair', 'Crosshair', 'Show the crosshair on every chart at the same time'],
  ['viewport', 'Time', 'Scrolling or zooming one chart moves all charts to the same time'],
  ['dateRange', 'Date range', 'Picking a date range (1D, 7D, 1M ...) on one chart applies it to all charts']
];

let dateRange = false;
let rangeBusy = false;
let getWs = () => null;
let onSync = () => {};

// ---------------------------------------------------------------- shapes
function cellsOf(def){ return def.cells ? def.cells.map((id) => ({ id, area: id })) : Array.from({ length: def.n }, (_, i) => ({ id: 'c' + (i + 1) })); }
// Every shape as a list of [col, row, colSpan, rowSpan] tiles for the SVG icon.
function tilesOf(id){
  const reg = DEFS.find((d) => d.id === id);
  const builtin = { '1': [1, 1], '2h': [2, 1], '2v': [1, 2], '4': [2, 2], '8': [4, 2] }[id];
  if (builtin) return grid(builtin[0], builtin[1]);
  if (!reg) return grid(1, 1);
  if (!reg.areas) return grid(reg.cols.length, reg.rows.length);
  const rows = reg.areas.map((r) => r.trim().split(/\s+/));
  const out = [];
  reg.cells.forEach((name) => {
    let c0 = 99, r0 = 99, c1 = -1, r1 = -1;
    rows.forEach((row, r) => row.forEach((n, c) => { if (n === name) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); } }));
    // translate the 'fr' weights of cols/rows into fractions
    const cw = reg.cols, rh = reg.rows;
    const sum = (a, i, j) => a.slice(i, j).reduce((s, x) => s + x, 0);
    out.push([sum(cw, 0, c0) / sum(cw, 0, cw.length), sum(rh, 0, r0) / sum(rh, 0, rh.length), sum(cw, c0, c1 + 1) / sum(cw, 0, cw.length), sum(rh, r0, r1 + 1) / sum(rh, 0, rh.length)]);
  });
  return out;
}
function grid(cols, rows){
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c / cols, r / rows, 1 / cols, 1 / rows]);
  return out;
}
function iconSvg(id, n){
  const tiles = n ? gridFor(n) : tilesOf(id);
  const W = 26, H = 20, g = 1.5;
  const rects = tiles.map(([x, y, w, h]) => {
    const rx = 1 + x * W + g / 2, ry = 1 + y * H + g / 2;
    return '<rect x="' + rx.toFixed(2) + '" y="' + ry.toFixed(2) + '" width="' + Math.max(1, w * W - g).toFixed(2) + '" height="' + Math.max(1, h * H - g).toFixed(2) + '" rx="1.4"/>';
  }).join('');
  return '<svg width="28" height="22" viewBox="0 0 28 22" fill="currentColor" aria-hidden="true">' + rects + '</svg>';
}
function gridFor(n){ return { 10: grid(5, 2), 12: grid(4, 3), 14: grid(7, 2), 16: grid(4, 4) }[n] || grid(1, 1); }

export function countOf(id){
  if (id === '1') return 1;
  const b = { '2h': 2, '2v': 2, '4': 4, '8': 8 }[id];
  if (b) return b;
  const d = DEFS.find((x) => x.id === id);
  if (d) return d.cells ? d.cells.length : d.n;
  const g = /^g([1-4])x([1-4])$/.exec(String(id || ''));
  return g ? (+g[1]) * (+g[2]) : 1;
}
export function labelOf(id){
  for (const [, items] of GROUPS) { const f = items.find((x) => x[0] === id); if (f) return f[1]; }
  return countOf(id) + ' charts';
}

// Device cap: desktop 8; tablets and phones 4.
export function maxCells(){
  const dev = document.documentElement.getAttribute('data-device');
  if (dev === 'mobile' || dev === 'tablet') return 4;
  if (window.innerWidth <= 1024) return 4;
  return 8;
}
// Widest allowed fallback for an over-cap layout.
function fallbackFor(id){ const cap = maxCells(); return cap >= 8 ? id : (countOf(id) > cap ? '4' : id); }

// ---------------------------------------------------------------- install (before boot)
export function installGrid(W, Core, wsGetter){
  getWs = wsGetter || getWs;
  DEFS.forEach((d) => {
    try {
      const def = { id: d.id, label: d.label, cols: d.cols, rows: d.rows, cells: cellsOf(d) };
      if (d.areas) def.areas = d.areas;
      W.registerLayout(def);
    } catch (e) { console.warn('Stryker: grid layout', d.id, e); }
  });
  // Date-range sync rides the workspace document, so layouts/templates keep it.
  try {
    Core.registerStatePersistence({
      key: EXT_KEY, scope: 'global',
      serialize(){ return dateRange ? { dateRange: true } : undefined; },
      restore(v){ dateRange = !!(v && v.dateRange); onSync(); }
    });
  } catch (e) { console.warn('Stryker: grid persistence', e); }
  // A range chip applies to the ACTIVE cell only (Vela). With Date range on, fan it out.
  try {
    const proto = W.ChartCell && W.ChartCell.prototype;
    if (proto && typeof proto.applyRange === 'function' && !proto.__stkRange) {
      const orig = proto.applyRange;
      proto.applyRange = function (preset){
        orig.call(this, preset);
        if (!dateRange || rangeBusy) return;
        const ws = getWs();
        if (!ws) return;
        rangeBusy = true;
        try {
          ws.cells().forEach((c) => { if (c !== this && c.id !== this.id) { try { orig.call(c, preset); } catch (e) {} } });
        } finally { rangeBusy = false; }
      };
      proto.__stkRange = true;
    }
  } catch (e) { console.warn('Stryker: date-range sync', e); }
}

// ---------------------------------------------------------------- picker UI
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

let capFromId = null;

/**
 * Build the grid button + popover. opts.bindPopover(btn, pop, onOpen) is vela-chart.js'
 * popover helper (so every toolbar menu closes the others); opts.onStructural() runs
 * after a layout switch (theme, switcher, etc).
 */
export function mountGrid(ws, opts){
  getWs = () => ws;
  const btn = el('button', { type: 'button', class: 'stkc-btn stkg-btn', id: 'stkc-layout-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Chart grid and sync' });
  const pop = el('div', { class: 'stkc-pop stkg-pop', id: 'stkc-layout-pop', role: 'dialog', 'aria-label': 'Chart grid', hidden: '' });
  const wrap = el('div', { class: 'stkc-menu' }, [btn, pop]);
  const items = {};

  const gridBox = el('div', { class: 'stkg-grid', role: 'group', 'aria-label': 'Charts in the layout' });
  GROUPS.forEach(([n, list]) => {
    const row = el('div', { class: 'stkg-row', 'data-n': String(n) }, [el('span', { class: 'stkg-n', text: String(n) })]);
    list.forEach(([id, label]) => {
      const b = el('button', { type: 'button', class: 'stkg-ic', 'data-layout': id, 'aria-pressed': 'false', 'aria-label': label, title: label, html: iconSvg(id),
        onclick: () => { if (b.getAttribute('aria-disabled') === 'true') return; setLayout(id); } });
      items[id] = b; row.appendChild(b);
    });
    gridBox.appendChild(row);
  });
  const greyRow = el('div', { class: 'stkg-row stkg-greyrow' });
  GREY.forEach((n) => {
    greyRow.appendChild(el('span', { class: 'stkg-ic stkg-off', role: 'img', tabindex: '0', 'aria-label': n + ' charts: up to 8 charts on our site for smooth performance', title: 'Up to 8 charts on our site for smooth performance',
      html: '<b>' + n + '</b>' + iconSvg(null, n) }));
  });
  gridBox.appendChild(greyRow);
  const capNote = el('p', { class: 'stkg-note', hidden: '' });
  pop.appendChild(el('p', { class: 'stkc-pop-h', text: 'Charts in layout' }));
  pop.appendChild(gridBox);
  pop.appendChild(capNote);

  const syncHead = el('p', { class: 'stkc-pop-h', text: 'Sync in layout' });
  pop.appendChild(syncHead);
  const boxes = {};
  SYNCS.forEach(([kind, label, tip]) => {
    const cb = el('input', { type: 'checkbox', role: 'switch', class: 'stkg-sw', 'data-sync': kind });
    cb.addEventListener('change', () => {
      if (kind === 'dateRange') { dateRange = cb.checked; try { ws.context().stateDirty(); } catch (e) {} }
      else { try { ws.sync.set(kind, cb.checked ? true : false); } catch (e) { console.warn(e); } }
      refresh();
    });
    boxes[kind] = cb;
    pop.appendChild(el('label', { class: 'stkg-swrow', title: tip }, [el('span', { text: label }), cb]));
  });
  const setOpen = opts.bindPopover(btn, pop, refresh);
  onSync = () => refresh();

  function setLayout(id){
    capFromId = null;
    try { ws.maximizeCell(null); } catch (e) {}
    try { ws.setLayout(id); } catch (e) { console.warn('Stryker: setLayout', e); }
    if (opts.onStructural) opts.onStructural();
    refresh();
  }

  function refresh(){
    let id = '1';
    try { id = ws.layout.id; } catch (e) {}
    const cap = maxCells();
    const shown = capFromId || id;
    btn.innerHTML = iconSvg(shown) + '<span class="stkc-btn-l">' + (countOf(shown) > 1 ? countOf(shown) + ' charts' : '1 chart') + '</span>';
    btn.setAttribute('aria-label', 'Chart grid: ' + labelOf(shown));
    Object.keys(items).forEach((k) => {
      const b = items[k];
      b.setAttribute('aria-pressed', k === id ? 'true' : 'false');
      const over = countOf(k) > cap;
      b.setAttribute('aria-disabled', over ? 'true' : 'false');
      b.title = over ? 'Up to ' + cap + ' charts on this device' : labelOf(k);
    });
    capNote.hidden = !(cap < 8 || capFromId);
    capNote.textContent = capFromId
      ? 'This layout has ' + countOf(capFromId) + ' charts; this device shows up to ' + cap + '.'
      : 'Up to ' + cap + ' charts on this device' + (window.innerWidth <= 700 ? ', one at a time on a phone.' : '.');
    let st = {};
    try { st = ws.sync.state() || {}; } catch (e) {}
    const multi = countOf(id) > 1;
    SYNCS.forEach(([k]) => {
      boxes[k].checked = k === 'dateRange' ? dateRange : !!st[k];
      boxes[k].disabled = !multi;
    });
    syncHead.textContent = multi ? 'Sync in layout' : 'Sync in layout (needs 2+ charts)';
  }

  // Over-cap layout (restored session, template, saved layout) -> widest allowed shape.
  function enforceCap(){
    let id = '1';
    try { id = ws.layout.id; } catch (e) { return; }
    const fb = fallbackFor(id);
    if (fb !== id) {
      try { ws.maximizeCell(null); ws.setLayout(fb); } catch (e) {}
      capFromId = id;
    } else if (countOf(id) <= maxCells() && capFromId && id !== '4') {
      capFromId = null;
    }
    refresh();
  }

  try { ws.on('layout:changed', () => setTimeout(refresh, 0)); } catch (e) {}
  refresh();
  return {
    el: wrap, refresh, enforceCap, setLayout, close: () => setOpen(false),
    // The layout id to SAVE: the member's own one, not a device-capped stand-in.
    capFrom: () => capFromId,
    syncState: () => { let st = {}; try { st = ws.sync.state() || {}; } catch (e) {} return Object.assign({}, st, { dateRange }); },
    setDateRange: (on) => { dateRange = !!on; refresh(); }
  };
}

export const GRID_IDS = GROUPS.flatMap(([, list]) => list.map((x) => x[0]));
