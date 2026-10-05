// Stryker Trading Academy — Charts settings window (ES module, charts.html only)
// Depends on: the self-hosted Vela 0.6.17 build (passed in as `Core` = index.js and `VelaChunk` =
// the main chunk, for its TIMEZONES list), and the live workspace from assets/vela-chart.js.
//
// Owner order 2026-10-06 ("Build all"): a TradingView-style settings window. Vela already ships a
// chart-settings dialog (Symbol / Status line / Scales and lines / Canvas / Advanced tabs, opened
// by the in-chart gear, the bottom-bar gear and right-click → "Settings…"), and it already edits
// candles (body / borders / wick with up + down colours), chart type, time zone, RTH/ETH session,
// watermark on/off, status-line parts, price-scale mode / invert / last-price line + label /
// countdown, crosshair, background, text colour + size, grid. So this module REUSES that dialog:
//   - it adds our extra rows through Vela's host-settings seam (renderer.setSettingsSections),
//     then moves them into the matching Vela tab when the dialog opens;
//   - it adds the TradingView footer: Template ⌄ (Save as default / Apply defaults / Reset to
//     Stryker defaults), Apply to all, Cancel (restores the snapshot taken when the dialog
//     opened), Ok;
//   - it adds a gear button to our top bar;
//   - our own values live per chart cell in the workspace document under
//     ext['stryker.settings'] (registerStatePersistence), so the persisted session, saved
//     templates and layouts carry them;
//   - time zone default for members: (UTC+5:30) Kolkata (one-time, versioned flag).
// Rows that need a patched Vela build (stage 2) are shown disabled with a short tooltip.
// Nothing here touches data, trading or accounts.

const EXT_KEY = 'stryker.settings';
const DEFAULT_KEY = 'stryker_chart_settings_default';
const TZ_FLAG = 'stryker_chart_tz_kolkata';
const STYLE_ID = 'stk-chart-settings-css';
const MARK = ' ·';   // our host tabs are titled "<Vela tab> ·" and folded into that tab

const DEFAULTS = Object.freeze({
  wmMode: 'Symbol + interval',   // Hidden / Symbol / Symbol + interval
  wmColor: '',                   // '' = Vela's own
  bgType: 'Solid',               // Solid / Gradient
  bg2: '#1e222d',
  slBg: false,
  slBgColor: 'rgba(15,15,15,0.6)',
  nav: 'Visible on mouse over',  // Always visible / Visible on mouse over / Always invisible
  paneBtns: 'Visible on mouse over',
  precision: 'Default',
  rightBars: '6',
  prevClose: false,        // s2 patch: colour bars on previous close
  marginTop: '10',         // s2 patch: % of the pane height (TradingView default 10 / 8)
  marginBottom: '8',
  h12: false,              // s2 patch: 12-hour clock on the time axis + crosshair
  dow: true                // s2 patch: weekday in the crosshair date
});
const MARGINS = ['0', '2', '4', '6', '8', '10', '12', '15', '20', '25', '30'];
const VIS = ['Always visible', 'Visible on mouse over', 'Always invisible'];
const PRECISIONS = ['Default', '1', '0.1', '0.01', '0.001', '0.0001', '0.25 (quarter tick)', '0.5'];
const RIGHT_BARS = ['0', '2', '4', '6', '10', '15', '20', '30', '50'];

// Rows that need the stage-2 Vela patch (or a data feed we don't have). Shown, not active.
const SOON = 'Coming in the next Charts update';
const DISABLED = {
  'Hollow candles': SOON,
  'Adjust for contract changes': 'Not available on this data feed yet',
  'Volume value': SOON,
  'Price scale on the left': SOON,
  'Previous day close line': SOON,
  'High and low price labels': SOON,
  'Indicator labels on the price scale': SOON,
  'Currency and unit label': SOON
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const store = new Map();             // cellId -> settings object (our part)
let WS = null;
let toastFn = () => {};

function S(id){
  if (!store.has(id)) store.set(id, Object.assign({}, DEFAULTS));
  return store.get(id);
}
function sanitize(p){
  const out = Object.assign({}, DEFAULTS);
  if (!p || typeof p !== 'object') return out;
  for (const k of Object.keys(DEFAULTS)) {
    const v = p[k];
    if (typeof v === typeof DEFAULTS[k] && (typeof v !== 'string' || v.length <= 80)) out[k] = v;
  }
  if (!['Hidden', 'Symbol', 'Symbol + interval'].includes(out.wmMode)) out.wmMode = DEFAULTS.wmMode;
  if (!['Solid', 'Gradient'].includes(out.bgType)) out.bgType = 'Solid';
  if (!VIS.includes(out.nav)) out.nav = DEFAULTS.nav;
  if (!VIS.includes(out.paneBtns)) out.paneBtns = DEFAULTS.paneBtns;
  if (!PRECISIONS.includes(out.precision)) out.precision = 'Default';
  if (!RIGHT_BARS.includes(out.rightBars)) out.rightBars = DEFAULTS.rightBars;
  if (!MARGINS.includes(out.marginTop)) out.marginTop = DEFAULTS.marginTop;
  if (!MARGINS.includes(out.marginBottom)) out.marginBottom = DEFAULTS.marginBottom;
  return out;
}
const isDefault = (s) => Object.keys(DEFAULTS).every((k) => s[k] === DEFAULTS[k]);

// ---------------------------------------------------------------------------------------
// install (before the workspace boots): persistence + the Kolkata label
// ---------------------------------------------------------------------------------------
export function installChartSettings(Core, VelaChunk){
  try {
    const tz = VelaChunk && VelaChunk.TIMEZONES;
    const k = tz && tz.find((t) => t.value === 'Asia/Kolkata');
    if (k) k.label = 'Kolkata';
  } catch (e) { console.warn('Stryker settings: tz label', e); }
  Core.registerStatePersistence({
    key: EXT_KEY, scope: 'cell',
    serialize(ctx){ const s = store.get(ctx.cellId); return s && !isDefault(s) ? Object.assign({}, s) : undefined; },
    restore(payload, ctx){
      store.set(ctx.cellId, sanitize(payload));
      if (WS) setTimeout(() => applyCell(ctx.cellId), 0);
    }
  });
}

// ---------------------------------------------------------------------------------------
// applying our values to one cell
// ---------------------------------------------------------------------------------------
const cellOf = (id) => { try { return WS.cell(id); } catch (e) { return null; } };
const inner = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };

function hookCell(cell){
  if (!cell || !cell.chart) return;
  const id = cell.id;
  const rc = cell.chart.renderer;
  // Flag on the renderer control: a cell that rebuilds its chart gets hooked again.
  if (rc.__stkSettings) return;
  rc.__stkSettings = true;
  // Keep our host sections next to the cell's own whenever the cell re-pushes them.
  const origSet = rc.setSettingsSections.bind(rc);
  rc.setSettingsSections = (secs) => origSet([...(secs || []), ...ourSections(id)]);
  const R = inner(cell);
  if (R) {
    // Gradient background: re-applied after Vela paints its solid one.
    const origBg = R.applyBackground.bind(R);
    R.applyBackground = () => { origBg(); paintBg(cell); };
    // Precision: our choice wins over the symbol's mintick; "Default" hands it back.
    const origPrec = R.setPricePrecision.bind(R);
    R.__stkOrigPrec = origPrec;
    R.setPricePrecision = (m) => { R.__stkSymTick = m; const s = S(id); origPrec(s.precision === 'Default' ? m : precValue(s.precision)); };
  }
  if (cell.watermark && !cell.watermark.__stk) {
    const wm = cell.watermark;
    wm.__stk = true;
    const origUp = wm.update.bind(wm);
    wm.__stkOrig = origUp;
    wm.update = (sym, tf) => { origUp(sym, tf); wmText(cell); };
  }
  try { cell.chart.on('load:end', () => setTimeout(() => applyRight(cell), 0)); } catch (e) {}
  // Vela's own "Symbol watermark" on/off is replaced by our Hidden / Symbol / Symbol + interval row.
  try { rc.setSettingsVisibility({ hidden: ['watermark'] }); } catch (e) {}
  try { cell.pushSettingsSections(); } catch (e) {}
}
const precValue = (p) => parseFloat(p);

function wmText(cell){
  const wm = cell.watermark; if (!wm || !wm.text) return;
  const s = S(cell.id);
  if (s.wmMode === 'Symbol') wm.text.textContent = wm.text.textContent.split(' \u00b7 ')[0];
  else if (wm.__stkOrig && !wm.text.textContent.includes(' \u00b7 ')) { try { wm.__stkOrig(cell.symbol, cell.timeframe); } catch (e) {} }
  wm.el.style.color = s.wmColor || '';
  try { wm.fit(); } catch (e) {}
}
function paintBg(cell){
  const R = inner(cell); if (!R || !R.wrapper) return;
  const s = S(cell.id);
  if (s.bgType === 'Gradient') {
    let top = ''; try { top = cell.chart.renderer.getConfig().layout.background; } catch (e) {}
    R.wrapper.style.background = 'linear-gradient(180deg, ' + top + ', ' + s.bg2 + ')';
  }
}
function applyRight(cell){
  const R = inner(cell); if (!R || !R.coords) return;
  const n = Number(S(cell.id).rightBars);
  try {
    const vp = R.coords.getViewport();
    if (vp && Math.abs(vp.rightOffset - n) > 0.01 && vp.rightOffset >= 0 && vp.rightOffset < 60) R.applyViewport({ barSpacing: vp.barSpacing, rightOffset: n });
  } catch (e) {}
}
function applyCell(id){
  const cell = cellOf(id); if (!cell) return;
  hookCell(cell);
  const s = S(id);
  try { cell.setWatermarkVisible(s.wmMode !== 'Hidden'); } catch (e) {}
  wmText(cell);
  const R = inner(cell);
  if (R) { try { R.applyBackground(); } catch (e) {} }
  if (R && R.__stkOrigPrec) R.__stkOrigPrec(s.precision === 'Default' ? R.__stkSymTick : precValue(s.precision));
  const sl = cell.host && cell.host.querySelector('.vela-statusline');
  if (sl) {
    sl.style.background = s.slBg ? s.slBgColor : '';
    sl.style.borderRadius = s.slBg ? '6px' : '';
    sl.style.paddingRight = s.slBg ? '6px' : '';
  }
  if (cell.host) {
    cell.host.dataset.stkNav = s.nav === VIS[0] ? 'always' : s.nav === VIS[2] ? 'never' : 'hover';
    cell.host.dataset.stkPane = s.paneBtns === VIS[0] ? 'always' : s.paneBtns === VIS[2] ? 'never' : 'hover';
  }
  applyRight(cell);
  applyStk(cell);
}
// s2 Vela patch options live on the renderer's scene as scene.stk.
// Margins: TradingView gives % of the pane height; Vela pads by a fraction of the data span.
// With top t and bottom b (as fractions of the pane), span fractions are t/(1-t-b) and b/(1-t-b).
function applyStk(cell){
  const R = inner(cell); if (!R || !R.scene) return;
  const s = S(cell.id);
  const t = Number(s.marginTop) / 100, b = Number(s.marginBottom) / 100, rest = Math.max(0.2, 1 - t - b);
  R.scene.stk = { prevClose: !!s.prevClose, h12: !!s.h12, noDow: !s.dow, marginTop: t / rest, marginBottom: b / rest };
  try { R.scheduler && R.scheduler.invalidate(4); } catch (e) {}
}
function setVal(id, key, v){
  S(id)[key] = v;
  applyCell(id);
  try { WS.markStateDirty(); } catch (e) {}
}

// ---------------------------------------------------------------------------------------
// our rows (Vela host-settings rows), folded into Vela's tabs when the dialog opens
// ---------------------------------------------------------------------------------------
function ourSections(id){
  const g = (k) => () => S(id)[k];
  const st = (k) => (v) => setVal(id, k, v);
  const off = (label) => ({ kind: 'toggle', label, get: () => false, set: () => {}, id: 'stk-off-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
  return [
    { title: 'Symbol' + MARK, id: 'stk-symbol', placement: 'end', rows: [
      { kind: 'heading', label: 'Candles' },
      { kind: 'toggle', label: 'Color bars based on previous close', id: 'prev-close', get: g('prevClose'), set: st('prevClose') },
      off('Hollow candles'),
      { kind: 'heading', label: 'Data modification' }, off('Adjust for contract changes'),
      { kind: 'select', label: 'Precision', id: 'precision', options: PRECISIONS, get: g('precision'), set: st('precision') },
      { kind: 'heading', label: 'Watermark' },
      { kind: 'select', label: 'Watermark', id: 'wm-mode', options: ['Hidden', 'Symbol', 'Symbol + interval'], get: g('wmMode'), set: st('wmMode') },
      { kind: 'color', label: 'Watermark color', id: 'wm-color', get: () => S(id).wmColor || 'rgba(209,212,220,0.06)', set: st('wmColor') }
    ] },
    { title: 'Status line' + MARK, id: 'stk-status', placement: 'end', rows: [
      { kind: 'heading', label: 'More' }, off('Volume value'),
      { kind: 'toggle', label: 'Background behind status line', id: 'sl-bg', get: g('slBg'), set: st('slBg') },
      { kind: 'color', label: 'Status line background', id: 'sl-bg-color', get: g('slBgColor'), set: st('slBgColor') }
    ] },
    { title: 'Scales and lines' + MARK, id: 'stk-scales', placement: 'end', rows: [
      { kind: 'heading', label: 'More' }, off('Price scale on the left'), off('Previous day close line'), off('High and low price labels'),
      off('Indicator labels on the price scale'), off('Currency and unit label'),
      { kind: 'heading', label: 'Time scale' },
      { kind: 'toggle', label: 'Day of week on labels', id: 'dow', get: g('dow'), set: st('dow') },
      { kind: 'toggle', label: '12-hour time (am/pm)', id: 'h12', get: g('h12'), set: st('h12') }
    ] },
    { title: 'Canvas' + MARK, id: 'stk-canvas', placement: 'end', rows: [
      { kind: 'heading', label: 'Background style' },
      { kind: 'select', label: 'Background', id: 'bg-type', options: ['Solid', 'Gradient'], get: g('bgType'), set: st('bgType') },
      { kind: 'color', label: 'Gradient bottom color', id: 'bg2', get: g('bg2'), set: st('bg2') },
      { kind: 'heading', label: 'Buttons' },
      { kind: 'select', label: 'Navigation', id: 'nav', options: VIS, get: g('nav'), set: st('nav') },
      { kind: 'select', label: 'Pane buttons', id: 'pane-btns', options: VIS, get: g('paneBtns'), set: st('paneBtns') },
      { kind: 'heading', label: 'Margins' }, 
      { kind: 'select', label: 'Top margin %', id: 'margin-top', options: MARGINS, get: g('marginTop'), set: st('marginTop') },
      { kind: 'select', label: 'Bottom margin %', id: 'margin-bottom', options: MARGINS, get: g('marginBottom'), set: st('marginBottom') },
      { kind: 'select', label: 'Right margin (bars)', id: 'right-bars', options: RIGHT_BARS, get: g('rightBars'), set: st('rightBars') }
    ] }
  ];
}

// ---------------------------------------------------------------------------------------
// snapshot / restore (Cancel, templates, Apply to all)
// ---------------------------------------------------------------------------------------
// Copyable cosmetics: everything except draw order and chart-type bags tied to that chart.
function cosmetic(cfg){
  const c = clone(cfg || {});
  delete c.stacking;
  const style = c.series && c.series.style;
  if (c.series) delete c.series.style;
  return { cfg: c, style };
}
function snapshot(id){
  const cell = cellOf(id);
  if (!cell) return null;
  let cfg = null, status = null;
  try { cfg = cell.chart.renderer.getConfig(); } catch (e) {}
  try { status = cell.statusPrefs(); } catch (e) {}
  let tz = 'Etc/UTC'; try { tz = WS.getState().timezone || tz; } catch (e) {}
  return { cfg: clone(cfg), status: clone(status), ours: Object.assign({}, S(id)), style: cell.priceStyle, tz, wm: cell.watermarkOn };
}
function restore(id, snap, opts){
  const cell = cellOf(id); if (!cell || !snap) return;
  const o = opts || {};
  if (snap.cfg) {
    const { cfg, style } = cosmetic(snap.cfg);
    try { cell.chart.renderer.applyConfig(cfg); } catch (e) { console.warn(e); }
    const want = snap.style || style;
    if (want && want !== cell.priceStyle) { try { cell.setPriceStyle(want); } catch (e) {} }
  }
  if (snap.status) { try { cell.applyStatusPrefs(snap.status); } catch (e) {} }
  if (snap.ours) store.set(id, sanitize(snap.ours));
  if (o.tz && snap.tz) { try { WS.setTimezone(snap.tz); } catch (e) {} }
  applyCell(id);
  try { WS.markStateDirty(); } catch (e) {}
}
function stykerDefaults(id){
  const cell = cellOf(id); const R = inner(cell);
  const f = R && R.factoryConfig ? clone(R.factoryConfig) : null;
  return { cfg: f, status: { parts: { logo: true, name: true, market: true, ohlc: true, change: true }, indicatorTitles: true, indicatorValues: true },
    ours: Object.assign({}, DEFAULTS), style: 'candles', tz: 'Asia/Kolkata' };
}

// ---------------------------------------------------------------------------------------
// dialog: fold our tabs in, disable stage-2 rows, footer
// ---------------------------------------------------------------------------------------
let dlgCell = null;     // cell the open dialog edits
let dlgSnap = null;     // its snapshot when the dialog opened

function foldTabs(dlg){
  const rail = dlg.querySelector('.vela-sd-rail');
  const paneHost = dlg.querySelector('.vela-sd-pane');
  if (!rail || !paneHost) return;
  const tabs = [...rail.querySelectorAll('.vela-sd-tab')];
  const panes = [...paneHost.children];
  if (tabs.length !== panes.length) return;
  tabs.forEach((t, i) => {
    const title = t.textContent || '';
    if (!title.endsWith(MARK) || t.dataset.stkFolded) return;
    t.dataset.stkFolded = '1';
    const base = title.slice(0, -MARK.length);
    const j = tabs.findIndex((x) => x.textContent === base);
    t.style.display = 'none';
    if (j < 0) { t.textContent = base; t.style.display = ''; return; }
    const src = panes[i], dst = panes[j];
    // our pane = a field grid with a section title; move its grid under Vela's.
    [...src.children].forEach((ch) => { ch.classList.add('stk-sd-extra'); dst.appendChild(ch); });
  });
  dlg.querySelectorAll('.stk-sd-extra .vela-field-label').forEach((lab) => {
    const why = DISABLED[lab.textContent];
    if (!why) return;
    const row = lab.closest('.vela-field-span') || lab.parentElement;
    if (!row || row.classList.contains('stk-sd-off')) return;
    row.classList.add('stk-sd-off');
    row.title = why;
    lab.textContent = lab.textContent + ' (soon)';
    const sw = row.querySelector('button'); if (sw) { sw.disabled = true; sw.setAttribute('aria-disabled', 'true'); sw.tabIndex = -1; }
  });
}

function footer(dlg){
  const foot = dlg.querySelector('.vela-dialog-footer');
  if (!foot || foot.querySelector('.stk-sd-foot')) return;
  [...foot.children].forEach((b) => { if (/Reset defaults/.test(b.textContent)) b.style.display = 'none'; });
  const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vela-sd-btn ' + (cls || ''); b.textContent = txt; b.addEventListener('click', fn); return b; };
  const wrap = document.createElement('div'); wrap.className = 'stk-sd-foot';
  const tplWrap = document.createElement('div'); tplWrap.className = 'stk-sd-tpl';
  const menu = document.createElement('div'); menu.className = 'stk-sd-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  const tplBtn = mk('Template \u2304', 'stk-sd-tplbtn', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; tplBtn.setAttribute('aria-expanded', String(!menu.hidden)); });
  tplBtn.setAttribute('aria-haspopup', 'true'); tplBtn.setAttribute('aria-expanded', 'false');
  const item = (txt, fn) => { const b = mk(txt, 'stk-sd-mi', () => { menu.hidden = true; fn(); }); b.setAttribute('role', 'menuitem'); menu.appendChild(b); };
  item('Save as default', () => {
    const s = snapshot(dlgCell); if (!s) return;
    try { localStorage.setItem(DEFAULT_KEY, JSON.stringify({ cfg: cosmetic(s.cfg).cfg, status: s.status, ours: s.ours, style: s.style })); toastFn('Saved as your default chart settings'); }
    catch (e) { toastFn('Could not save the default.', 'error'); }
  });
  item('Apply defaults', () => {
    let d = null; try { d = JSON.parse(localStorage.getItem(DEFAULT_KEY) || 'null'); } catch (e) {}
    if (!d) { toastFn('No saved default yet. Use "Save as default" first.', 'info'); return; }
    restore(dlgCell, d); reopen();
  });
  item('Reset to Stryker defaults', () => { restore(dlgCell, stykerDefaults(dlgCell), { tz: true }); reopen(); });
  tplWrap.appendChild(tplBtn); tplWrap.appendChild(menu);
  const allBtn = mk('Apply to all', '', () => {
    const s = snapshot(dlgCell); if (!s) return;
    let n = 0;
    (WS.context().cells || []).forEach((c) => { if (c.id !== dlgCell) { restore(c.id, s); n++; } });
    toastFn(n ? 'Applied to all ' + (n + 1) + ' charts' : 'Only one chart in this layout');
  });
  const cancel = mk('Cancel', '', () => { const id = dlgCell, snap = dlgSnap; dlgSnap = null; restore(id, snap, { tz: true }); close(); });
  const ok = mk('Ok', 'stk-sd-ok', () => { dlgSnap = null; close(); });
  wrap.append(tplWrap, allBtn, cancel, ok);
  foot.appendChild(wrap);
  dlg.addEventListener('click', (e) => { if (!tplWrap.contains(e.target)) menu.hidden = true; });
}
function close(){ const c = cellOf(dlgCell); try { c.chart.renderer.closeDialogs(); } catch (e) {} }
function reopen(){
  // Rebuild the open dialog so its controls show the restored values (snapshot kept).
  const c = cellOf(dlgCell); if (!c) return;
  const keep = dlgSnap;
  const tab = document.querySelector('.vela-dialog--settings .vela-sd-tab.on');
  const title = tab ? tab.textContent : undefined;
  try { c.chart.renderer.closeDialogs(); } catch (e) {}
  setTimeout(() => {
    try { if (!document.querySelector('.vela-dialog--settings')) c.chart.renderer.openSettings(title); } catch (e) {}
    dlgSnap = keep; dlgCell = c.id;
  }, 60);
  dlgSnap = keep;
}

function watchDialogs(){
  let seen = null;
  const scan = () => {
    const dlg = document.querySelector('.vela-dialog--settings');
    if (!dlg) { seen = null; return; }
    if (dlg !== seen) {
      seen = dlg;
      let id = null; try { id = WS.active.id; } catch (e) {}
      if (!dlgSnap || id !== dlgCell) { dlgCell = id; dlgSnap = snapshot(id); }
    }
    foldTabs(dlg);
    footer(dlg);
  };
  let raf = 0;
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; scan(); }); })
    .observe(document.body, { childList: true, subtree: true });
}

const CSS = `
.vela-dialog--settings .vela-dialog-footer{ flex-wrap:wrap; flex:0 0 auto; }
/* Keep the whole window (and its footer) inside the chart area, however short it is. */
.vela-dialog-positioner:has(> .vela-dialog--settings:not(.vela-sd-mobile *)){ padding-top:min(8vh, 24px) !important; }
.vela-dialog--settings{ max-height:calc(100% - 32px); display:flex; flex-direction:column; }
.vela-dialog--settings .vela-dialog-body{ min-height:0; flex:1 1 auto; display:flex; flex-direction:column; }
.vela-dialog--settings .vela-dialog-body > div{ min-height:0 !important; }
.stk-sd-foot{ display:flex; align-items:center; gap:8px; flex:1 1 auto; justify-content:flex-end; flex-wrap:wrap; }
.stk-sd-tpl{ position:relative; margin-right:auto; }
.stk-sd-menu{ position:absolute; bottom:calc(100% + 6px); left:0; z-index:5; min-width:210px; display:flex; flex-direction:column; gap:2px;
  padding:6px; border-radius:8px; border:1px solid rgba(128,128,128,.28); background:var(--vela-surface, #1e222d); box-shadow:0 12px 32px -8px rgba(0,0,0,.55); }
.stk-sd-menu[hidden]{ display:none; }
.stk-sd-menu .stk-sd-mi{ text-align:left; width:100%; justify-content:flex-start; }
.vela-dialog--settings .stk-sd-ok{ background:#2962ff; color:#fff; border-color:#2962ff; }
.stk-sd-off{ opacity:.45; cursor:not-allowed; }
.stk-sd-off button{ pointer-events:none; }
.vela-dialog--settings .vela-sd-pane, .vela-dialog--settings .vela-sd-rail{ scrollbar-width:thin; scrollbar-color:rgba(128,128,128,.35) transparent; }
.vela-dialog--settings .vela-sd-pane::-webkit-scrollbar, .vela-dialog--settings .vela-sd-rail::-webkit-scrollbar{ width:6px; height:6px; }
.vela-dialog--settings .vela-sd-pane::-webkit-scrollbar-thumb, .vela-dialog--settings .vela-sd-rail::-webkit-scrollbar-thumb{ background:rgba(128,128,128,.35); border-radius:6px; }
.vela-dialog--settings .vela-sd-pane::-webkit-scrollbar-thumb:hover{ background:rgba(128,128,128,.6); }
.vela-dialog--settings .vela-sd-pane::-webkit-scrollbar-track{ background:transparent; }
.vela-cell[data-stk-nav="always"] div:has(> .vela-cc-btn){ display:flex !important; }
.vela-cell[data-stk-nav="never"] div:has(> .vela-cc-btn){ display:none !important; }
.vela-cell[data-stk-pane="always"] div:has(> .vela-axis-btn){ display:flex !important; }
.vela-cell[data-stk-pane="never"] div:has(> .vela-axis-btn){ display:none !important; }
`;

// ---------------------------------------------------------------------------------------
// mount (after the workspace exists)
// ---------------------------------------------------------------------------------------
export function mountChartSettings(ws, opts){
  WS = ws;
  toastFn = (opts && opts.toast) || toastFn;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  const hookAll = () => { (ws.context().cells || []).forEach((c) => applyCell(c.id)); };
  hookAll();
  try { ws.on('layout:changed', () => setTimeout(hookAll, 0)); } catch (e) {}
  try { ws.on('state:changed', () => (ws.context().cells || []).forEach((c) => { const cell = cellOf(c.id); if (cell && cell.chart && !cell.chart.renderer.__stkSettings) applyCell(c.id); })); } catch (e) {}
  watchDialogs();

  // Members default to Kolkata time (once). A member's later choice is kept.
  try {
    if (localStorage.getItem(TZ_FLAG) !== '1') {
      const tz = ws.getState().timezone;
      if (!tz || tz === 'Etc/UTC' || tz === 'UTC') ws.setTimezone('Asia/Kolkata');
      localStorage.setItem(TZ_FLAG, '1');
    }
  } catch (e) {}

  // Gear on our top bar.
  const bar = opts && opts.bar;
  if (bar && !document.getElementById('stkc-settings-btn')) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'stkc-ib'; b.id = 'stkc-settings-btn'; b.title = 'Chart settings'; b.setAttribute('aria-label', 'Chart settings');
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      try { const c = ws.cell(ws.active.id); c.chart.renderer.openSettings(); } catch (err) { console.warn(err); }
    });
    bar.insertBefore(b, bar.firstChild);
  }
  window.__stkSettings = { store, snapshot, restore, applyCell, DEFAULTS };
}
