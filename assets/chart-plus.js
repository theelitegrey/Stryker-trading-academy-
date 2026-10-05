// Stryker Trading Academy — Charts "+" price-axis menu (ES module, charts.html only)
// Owner order 2026-10-06 ("plus button along the price, and when clicked these options").
// Depends on: assets/chart-alerts.js (openAlerts, chartPlots); the Vela workspace (ws) built by
// assets/vela-chart.js. Does NOT touch the GEX files.
//
// WHAT IT DOES
//   - A small "+" sits at the right edge of the price pane, just left of the crosshair price
//     label, and follows the crosshair (mouse over the chart or the price axis). On touch it
//     shows while the long-press crosshair is active and stays a few seconds after release so
//     it can be tapped.
//   - Click/tap opens a context menu at that price (rounded to the instrument's tick size):
//       Add alert on <SYMBOL> at <price>        Alt+A  → alert dialog, Crossing, that price
//       Add alert on <first indicator>                → alert dialog, source = its main plot
//         (+ "More indicators…" submenu when there are several)
//       Buy / Sell 1 <SYMBOL> @ <price> limit|stop, Add order…  → SHOWN DISABLED:
//         "Connect your broker to trade (coming soon)". There is NO order code here at all:
//         we do not route orders (Owner decision; Rithmic routing needs their approval).
//       Draw horizontal line at <price>         Alt+H  → Vela's own hline drawing (editable,
//         saved with the workspace, layouts and templates)
//   - Alt+A / Alt+H go through Vela's keymap, so they only fire while the chart has focus and
//     never inside inputs. Every cell of a multi-chart layout gets its own "+".
// Education only. Not financial advice.

import { openAlerts, chartPlots } from './chart-alerts.js?v=424';

const BTN = 18;                    // button size (px)
let WS = null;
const wired = new WeakMap();       // cell host element -> per-cell controller
let menu = null, menuSub = null;

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------
const R_of = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };
const showSym = (s) => String(s || '').replace(/^[a-z0-9_-]+:/i, '');
function tickOf(R, price){
  const m = R && R.scene && R.scene.priceMintick;
  if (typeof m === 'number' && m > 0) return m;
  const a = Math.abs(price || 0);           // fallback for feeds without a tick size
  return a >= 1000 ? 0.01 : a >= 1 ? 0.01 : a >= 0.01 ? 0.0001 : 0.00000001;
}
function decimals(t){ const s = String(t); if (/e-/.test(s)) return Number(s.split('e-')[1]); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
function roundTo(price, t){ const d = decimals(t); return Number((Math.round(price / t) * t).toFixed(d)); }
function fmtP(price, t){ const d = decimals(t); return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function lastClose(R){ try { const b = R.bars; return b && b.length ? b[b.length - 1].close : null; } catch (e) { return null; } }
function lastTime(R){ try { const b = R.bars; return b && b.length ? b[b.length - 1].time : null; } catch (e) { return null; } }
function cellOfHost(host){ try { for (const c of WS.context().cells || []) { const cell = WS.cell(c.id); if (cell && cell.host === host) return cell; } } catch (e) {} return null; }

// ---------------------------------------------------------------------------------------
// actions (shared by the menu and the shortcuts)
// ---------------------------------------------------------------------------------------
function priceCtx(cell, rawPrice){
  const R = R_of(cell); if (!R || !Number.isFinite(rawPrice)) return null;
  const t = tickOf(R, rawPrice);
  const price = roundTo(rawPrice, t);
  return { cell, R, t, price, label: fmtP(price, t), sym: cell.symbol, name: showSym(cell.symbol), last: lastClose(R) };
}
function addPriceAlert(c){ openAlerts({ symbol: c.sym, cond: 'crossing', price: c.price }); }
function addIndAlert(c, ind){
  openAlerts({ symbol: c.sym, cond: 'crossing', price: c.price, src: { title: ind.title, plot: 0, plotTitle: ind.plots.length > 1 ? ind.plots[0].title : '', vs: 'close' } });
}
function addHLine(c, time){
  try {
    const d = c.cell.chart.drawings;
    if (!d || d.supported === false) return;
    d.add('hline', { anchors: [{ time: time != null ? time : lastTime(c.R), price: c.price }] });
    try { WS.markStateDirty(); } catch (e) {}
  } catch (e) { console.warn('Stryker +: hline', e); }
}

// ---------------------------------------------------------------------------------------
// menu
// ---------------------------------------------------------------------------------------
const ICON = {
  alert: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="13" r="6.5"/><path d="M11 9.5V13l2 1.6M4.5 5 2.5 7M17.5 5l2 2M18 15.5v5M15.5 18h5"/></svg>',
  buy: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14.5 12 9l6 5.5"/></svg>',
  sell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5 12 15l6-5.5"/></svg>',
  order: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="14" height="14" rx="2"/><path d="m6.5 14 3-3 2 2 3.5-4M19 15v6M16 18h6"/></svg>',
  hline: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 12h6.5M15 12h6.5"/><circle cx="12" cy="12" r="2.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17 9 11l4 3 7-8"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
};
function item(icon, label, opts){
  const o = opts || {};
  const b = document.createElement('button'); b.type = 'button'; b.className = 'stkp-it' + (o.cls ? ' ' + o.cls : ''); b.setAttribute('role', 'menuitem');
  b.innerHTML = '<span class="stkp-ic">' + ICON[icon] + '</span><span class="stkp-lb"></span><span class="stkp-kb"></span>';
  b.querySelector('.stkp-lb').textContent = label;
  b.querySelector('.stkp-kb').innerHTML = o.chev ? ICON.chev : '';
  if (o.kb) b.querySelector('.stkp-kb').textContent = o.kb;
  if (o.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.title = 'Connect your broker to trade (coming soon)'; }
  if (o.run) b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); o.run(); });
  return b;
}
function sep(){ const d = document.createElement('div'); d.className = 'stkp-sep'; d.setAttribute('role', 'separator'); return d; }
function closeMenu(){
  if (menu) { menu.remove(); menu = null; }
  if (menuSub) { menuSub.remove(); menuSub = null; }
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onMenuKey, true);
  window.removeEventListener('resize', closeMenu);
}
function outside(e){ if ((menu && menu.contains(e.target)) || (menuSub && menuSub.contains(e.target)) || (e.target.closest && e.target.closest('.stkp-plus'))) return; closeMenu(); }
function onMenuKey(e){
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const root = (menuSub && menuSub.contains(document.activeElement)) ? menuSub : menu; if (!root) return;
    const its = [...root.querySelectorAll('.stkp-it:not([disabled])')]; if (!its.length) return;
    const i = its.indexOf(document.activeElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % its.length : (i - 1 + its.length) % its.length;
    e.preventDefault(); its[n].focus();
  }
}
function place(el, x, y, alignRight){
  const vw = innerWidth, vh = innerHeight, r = el.getBoundingClientRect();
  let left = alignRight ? x - r.width : x;
  left = Math.max(8, Math.min(left, vw - r.width - 8));
  let top = Math.max(8, Math.min(y, vh - r.height - 8));
  el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(top) + 'px';
}
function openSub(anchor, inds, c){
  if (menuSub) { menuSub.remove(); menuSub = null; }
  menuSub = document.createElement('div'); menuSub.className = 'stkp-menu stkp-sub'; menuSub.setAttribute('role', 'menu');
  for (const ind of inds) menuSub.appendChild(item('alert', 'Add alert on ' + ind.title, { run: () => addIndAlert(c, ind) }));
  document.body.appendChild(menuSub);
  const r = anchor.getBoundingClientRect();
  const phone = innerWidth < 560;
  if (phone) place(menuSub, r.left, r.bottom + 2, false);
  else {
    const w = menuSub.getBoundingClientRect().width;
    // open to the left of the main menu (the menu itself sits left of the price axis)
    const x = r.left - w - 4 >= 8 ? r.left - w - 4 : r.right + 4;
    place(menuSub, x, r.top - 6, false);
  }
}
export function openMenu(c, x, y){
  closeMenu();
  if (!c) return;
  menu = document.createElement('div'); menu.className = 'stkp-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Chart actions at ' + c.label);
  menu.appendChild(item('alert', 'Add alert on ' + c.name + ' at ' + c.label, { kb: 'Alt + A', run: () => addPriceAlert(c) }));
  const inds = chartPlots(c.R);
  if (inds.length) {
    menu.appendChild(item('alert', 'Add alert on ' + inds[0].title, { run: () => addIndAlert(c, inds[0]) }));
    if (inds.length > 1) {
      const more = item('more', 'More indicators\u2026', { chev: true, cls: 'stkp-more' });
      more.setAttribute('aria-haspopup', 'menu');
      const go = (e) => { if (e) e.stopPropagation(); openSub(more, inds.slice(1), c); };
      more.addEventListener('click', go);
      more.addEventListener('mouseenter', () => { if (matchMedia('(hover:hover)').matches) go(); });
      menu.appendChild(more);
    }
  }
  menu.appendChild(sep());
  const above = c.last != null && c.price > c.last;
  menu.appendChild(item('buy', 'Buy 1 ' + c.name + ' @ ' + c.label + (above ? ' stop' : ' limit'), { disabled: true }));
  menu.appendChild(item('sell', 'Sell 1 ' + c.name + ' @ ' + c.label + (above ? ' limit' : ' stop'), { disabled: true }));
  menu.appendChild(item('order', 'Add order on ' + c.name + ' at ' + c.label + '\u2026', { disabled: true }));
  const hint = document.createElement('div'); hint.className = 'stkp-hint'; hint.textContent = 'Connect your broker to trade (coming soon)'; menu.appendChild(hint);
  menu.appendChild(sep());
  menu.appendChild(item('hline', 'Draw horizontal line at ' + c.label, { kb: 'Alt + H', run: () => addHLine(c, c.time) }));
  menu.addEventListener('mouseover', (e) => { const it = e.target.closest && e.target.closest('.stkp-it'); if (it && !it.classList.contains('stkp-more') && menuSub) { menuSub.remove(); menuSub = null; } });
  document.body.appendChild(menu);
  // anchored left of the "+", top-aligned with it (TradingView), kept on screen
  place(menu, x, y, true);
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('resize', closeMenu);
  }, 0);
  const first = menu.querySelector('.stkp-it:not([disabled])'); if (first && matchMedia('(hover:hover)').matches) first.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------
// per-cell "+" button
// ---------------------------------------------------------------------------------------
function wire(cell){
  const host = cell.host, R = R_of(cell);
  if (!host || !R || wired.has(host)) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'stkp-plus'; btn.hidden = true;
  btn.setAttribute('aria-label', 'Chart actions at this price');
  btn.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 5.5v7M5.5 9h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  host.appendChild(btn);
  const st = { price: null, time: null, y: 0, hideT: 0, touch: false, over: false };
  const geo = () => {
    const cv = R.input && R.input.el; if (!cv) return null;
    const hr = host.getBoundingClientRect(), cr = cv.getBoundingClientRect();
    return { ox: cr.left - hr.left, oy: cr.top - hr.top, cr, plotW: R.coords.width, fullW: cr.width };
  };
  const show = (yPlot, price, time) => {
    const g = geo(); if (!g) return;
    clearTimeout(st.hideT);
    st.price = price; st.time = time; st.y = yPlot;
    btn.style.left = Math.round(g.ox + g.plotW - BTN - 3) + 'px';
    btn.style.top = Math.round(g.oy + yPlot - BTN / 2) + 'px';
    btn.hidden = false;
  };
  const hideSoon = (ms) => { clearTimeout(st.hideT); st.hideT = setTimeout(() => { if (!st.over && !(menu && menu.__host === host)) btn.hidden = true; }, ms); };
  const pricePane = (y) => { try { const p = R.paneNodeAtY(y); return p && p.kind === 'price' ? p : null; } catch (e) { return null; } };
  // plot area: Vela's crosshair (mouse hover, and the touch long-press crosshair)
  const off = R.onCrosshairMove((e) => {
    const ch = R.scene && R.scene.crosshair;
    if (e && e.price != null && e.paneKind === 'price' && ch) { show(ch.y, e.price, e.time); return; }
    if (e && e.price != null && ch) { hideSoon(0); return; }        // a sub-pane: no "+"
    hideSoon(st.touch ? 4000 : 160);                                  // left the plot (axis hover may re-show)
  });
  // price axis strip: Vela draws no crosshair there, so we read the price ourselves
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    st.touch = false;
    const g = geo(); if (!g) return;
    const x = e.clientX - g.cr.left, y = e.clientY - g.cr.top;
    if (x <= g.plotW || x > g.fullW) return;
    const p = pricePane(y); if (!p) { hideSoon(160); return; }
    try { show(y, R.coords.yToPrice(y, p.scale, p.bounds), lastTime(R)); } catch (e2) {}
  };
  const onDown = (e) => { st.touch = e.pointerType === 'touch'; };
  const onLeave = () => { if (!st.touch) hideSoon(160); };
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('pointerleave', onLeave);
  btn.addEventListener('pointerenter', () => { st.over = true; clearTimeout(st.hideT); });
  btn.addEventListener('pointerleave', () => { st.over = false; if (!st.touch) hideSoon(220); });
  btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { WS.setActiveCell(cell.id); } catch (e2) {}
    const c = priceCtx(cell, st.price); if (!c) return;
    c.time = st.time;
    const r = btn.getBoundingClientRect();
    openMenu(c, r.left - 4, r.top);
    if (menu) { menu.__host = host; }
    clearTimeout(st.hideT);
  });
  wired.set(host, { btn, off, st });
}
function wireAll(){
  if (!WS) return;
  try { for (const c of WS.context().cells || []) { const cell = WS.cell(c.id); if (cell) wire(cell); } } catch (e) {}
}

// ---------------------------------------------------------------------------------------
// shortcuts (Vela keymap: only while the chart has focus, never inside inputs)
// ---------------------------------------------------------------------------------------
function cursorCtx(){
  let cell = null; try { cell = WS.active; } catch (e) {}
  if (!cell) return null;
  const R = R_of(cell);
  const p = cell.lastCrossPrice != null ? cell.lastCrossPrice : lastClose(R);
  const c = priceCtx(cell, p); if (c) c.time = cell.lastCrossTime;
  return c;
}
function keys(){
  const km = WS && WS.keymap; if (!km || !km.register) return false;
  km.register({ id: 'stryker.alert-cursor', keys: 'alt+a', label: 'Add alert at the cursor price', category: 'Alerts',
    run: () => { const c = cursorCtx(); if (c) addPriceAlert(c); } });
  // Replaces Vela's own alt+H (same id) so the line lands on a tick-rounded price.
  km.register({ id: 'drawings.hline-cursor', keys: 'alt+h', label: 'Horizontal line at the cursor price', category: 'Drawings',
    run: () => { const c = cursorCtx(); if (c) addHLine(c, c.time); } });
  return true;
}

const CSS = `
.stkp-plus{ position:absolute; z-index:6; width:${BTN}px; height:${BTN}px; padding:0; margin:0; border:0; border-radius:4px; display:flex; align-items:center; justify-content:center;
  background:#2a2e39; color:#d1d4dc; cursor:pointer; box-shadow:0 0 0 1px rgba(0,0,0,.25); }
.stkp-plus[hidden]{ display:none; }
.stkp-plus:hover,.stkp-plus:focus-visible{ background:#363a45; color:#fff; outline:none; }
:root[data-theme="light"] .stkp-plus{ background:#f0f3fa; color:#131722; box-shadow:0 0 0 1px #d1d4dc; }
:root[data-theme="light"] .stkp-plus:hover{ background:#e0e3eb; }
.stkp-menu{ position:fixed; z-index:8900; min-width:260px; max-width:calc(100vw - 16px); padding:6px 0; background:#1e222d; color:#d1d4dc; border-radius:6px;
  box-shadow:0 2px 4px rgba(0,0,0,.2),0 8px 24px rgba(0,0,0,.45); font:14px/1.3 -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif; }
:root[data-theme="light"] .stkp-menu{ background:#fff; color:#131722; box-shadow:0 2px 4px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.18); }
.stkp-it{ display:flex; align-items:center; gap:12px; width:100%; min-height:36px; padding:0 14px 0 12px; background:none; border:0; color:inherit; font:inherit; text-align:left; cursor:pointer; white-space:nowrap; }
.stkp-it:hover:not([disabled]),.stkp-it:focus-visible{ background:#2a2e39; outline:none; }
:root[data-theme="light"] .stkp-it:hover:not([disabled]),:root[data-theme="light"] .stkp-it:focus-visible{ background:#f0f3fa; }
.stkp-it[disabled]{ cursor:not-allowed; opacity:.45; }
.stkp-ic{ display:flex; width:20px; justify-content:center; flex:none; }
.stkp-lb{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.stkp-kb{ display:flex; margin-left:24px; color:#787b86; font-size:12.5px; flex:none; }
.stkp-sep{ height:1px; margin:6px 0; background:#363a45; }
:root[data-theme="light"] .stkp-sep{ background:#e0e3eb; }
.stkp-hint{ padding:2px 14px 4px 44px; font-size:12px; color:#787b86; white-space:normal; }
@media (pointer:coarse){
  .stkp-plus{ width:28px; height:28px; border-radius:6px; }
  .stkp-plus svg{ width:20px; height:20px; }
  .stkp-it{ min-height:44px; }
  .stkp-kb:not(:empty){ display:none; }
}
@media (max-width:560px){ .stkp-menu{ min-width:0; width:calc(100vw - 16px); } .stkp-it{ white-space:normal; } .stkp-kb{ margin-left:10px; } }
`;

export function mountChartPlus(ws){
  WS = ws;
  if (!document.getElementById('stkp-css')) { const s = document.createElement('style'); s.id = 'stkp-css'; s.textContent = CSS; document.head.appendChild(s); }
  wireAll();
  try { ws.on('layout:changed', () => { closeMenu(); setTimeout(wireAll, 0); }); } catch (e) {}
  try { ws.on('state:changed', () => setTimeout(wireAll, 0)); } catch (e) {}
  setInterval(wireAll, 2000);                        // cells rebuilt by templates / layouts
  if (keys()) window.__stkPlusKeys = true;           // chart-alerts.js then leaves Alt+A to the keymap
  window.__stkPlus = { open: openMenu, ctx: priceCtx, cursorCtx, wireAll, close: closeMenu };
}
