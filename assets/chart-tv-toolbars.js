// TradeZoro — Charts toolbars, TradingView layout (ES module, charts.html only)
// Owner order 2026-10-14, part 2: "make the horizontal and vertical toolbar same as tradingview"
// ("I SAID INSPIRED, NOT COPY PASTE": TradingView's layout and behaviour, our colours, our icons,
// none of TradingView's assets).
//
// The top row is arranged by assets/chart-onebar.js + style.css (CSS `order`). This module does
// the rest:
//   LEFT drawing column (Vela's .vela-dtb, built by Vela; we re-group it, nothing is rebuilt):
//     cursor | the 7 tool groups (each one button showing the last-used tool, a corner ▸ that
//     opens the group's flyout with names + shortcuts; a long press on the button opens it too) |
//     measure, zoom in (▸ zoom out) | magnet, stay in drawing mode, lock all, hide all |
//     eraser, remove drawings (trash ▸ menu) | sync drawings, favourites bar | collapse «.
//     Lock all / hide all: every drawing on every chart in the layout, plus the ones drawn while
//     the switch is on; switching off only undoes what the switch did (a drawing the member locked
//     or hid by hand stays that way). One undo step per chart.
//   RIGHT icon bar (the watchlist rail, assets/chart-watchlist.js): Vela's alert log, object tree
//     and data window move there from the top row (same buttons, same listeners).
//   TOP: a full-screen button (#stkc-fs-btn) next to settings (page full screen + the browser's).
// Phone: no left column (Vela hides it); the pencil in the top row opens Vela's drawings sheet
// (groups as tabs + search). See chart-onebar.js.
//
// Re-applied after Vela rebuilds the column (theme change) by a MutationObserver.
// Depends on: vela-chart.js (ws = VelaWorkspace: ws.root, ws.cells(), ws.cell(id).chart,
// ws.active), chart-onebar.js (bar), chart-watchlist.js (.stkw-rail), style.css (.stkt-* block).

import { UI_ICONS } from './chart-tool-icons.js?v=702';

const LS_LOCK = 'stkc_tv_lockall';
const LS_HIDE = 'stkc_tv_hideall';
const LONG_MS = 420;
const NS = 'http://www.w3.org/2000/svg';

// Icons: the ONE shared set (assets/chart-tool-icons.js, 28-unit grid, 1px strokes), so the
// column's own buttons match the drawing-tool icons. Vela's built-in column buttons (cursor,
// measure, magnet, stay, eraser, sync, collapse) get the same set in restyle() below.
const IC = {
  zoomIn: 'zoomIn', zoomOut: 'zoomOut', lock: 'lock', unlock: 'unlock', eye: 'eye', eyeOff: 'eyeOff', trash: 'trash',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fullOff: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  arrow: '<path d="M9 6l6 6-6 6"/>'
};
const sized = (markup, s) => markup.replace('width="1em" height="1em"', 'width="' + s + '" height="' + s + '"').replace('<svg ', '<svg aria-hidden="true" ');
const svg = (d, s) => (UI_ICONS[d] ? sized(UI_ICONS[d], s || 28) : '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>');
const hit = (d) => '<span class="vela-dtb-hit"><span class="stkt-ic">' + svg(d) + '</span></span>';
// Vela's own column buttons, found by their aria-label -> our icon
const VELA_BTNS = [[/^Cursor$/, 'cursor'], [/^Measure$/, 'measure'], [/^Eraser/, 'eraser'], [/^Stay in drawing/, 'stay'], [/^Sync drawings/, 'sync'], [/^Collapse toolbar$/, 'chevronsLeft']];

const lsGet = (k) => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, '1'); else localStorage.removeItem(k); } catch (e) {} };

export function mountTvToolbars(ws, opts){
  opts = opts || {};
  const toast = opts.toast || (() => {});
  if (!ws || !ws.root) return null;
  const root = ws.root;
  const cells = () => { try { return ws.cells().map((c) => (c && c.chart ? c : ws.cell(c.id))).filter((c) => c && c.chart); } catch (e) { return []; } };
  const activeChart = () => { try { return ws.cell(ws.active.id).chart; } catch (e) { try { return ws.active.chart; } catch (e2) { return null; } } };

  // ------------------------------------------------------------------ lock / hide all
  const st = { lock: lsGet(LS_LOCK), hide: lsGet(LS_HIDE) };
  // ids this switch changed, per chart object (only these are undone when it goes off)
  const touched = { lock: new WeakMap(), hide: new WeakMap() };
  const setOf = (kind, ch) => { let s = touched[kind].get(ch); if (!s) { s = new Set(); touched[kind].set(ch, s); } return s; };
  function applyAll(kind, on){
    cells().forEach(({ chart: ch }) => {
      let list = [];
      try { list = ch.drawings.all() || []; } catch (e) { return; }
      const mine = setOf(kind, ch);
      const patches = [];
      list.forEach((d) => {
        if (kind === 'lock') {
          if (on && !d.locked) { patches.push({ id: d.id, patch: { locked: true } }); mine.add(d.id); }
          if (!on && mine.has(d.id) && d.locked) patches.push({ id: d.id, patch: { locked: false } });
        } else {
          const vis = d.visible !== false;
          if (on && vis) { patches.push({ id: d.id, patch: { visible: false } }); mine.add(d.id); }
          if (!on && mine.has(d.id) && !vis) patches.push({ id: d.id, patch: { visible: true } });
        }
      });
      if (!on) mine.clear();
      if (patches.length) { try { ch.drawings.updateMany(patches); } catch (e) { console.warn('TradeZoro: drawings ' + kind, e); } }
    });
  }
  // drawings made while a switch is on follow it
  const wired = new WeakSet();
  function wire(){
    cells().forEach(({ chart: ch }) => {
      if (wired.has(ch)) return;
      wired.add(ch);
      try {
        ch.on('drawing:created', (e) => {
          const id = e && (e.id || (e.drawing && e.drawing.id));
          if (!id) return;
          setTimeout(() => {
            const p = {};
            if (st.lock) { p.locked = true; setOf('lock', ch).add(id); }
            if (st.hide) { p.visible = false; setOf('hide', ch).add(id); }
            if (Object.keys(p).length) { try { ch.drawings.update(id, p); } catch (err) {} }
          }, 0);
        });
      } catch (e) {}
    });
  }
  function setSwitch(kind, on){
    st[kind] = on;
    lsSet(kind === 'lock' ? LS_LOCK : LS_HIDE, on);
    applyAll(kind, on);
    paint();
  }
  function countDrawings(ch){ try { return (ch.drawings.all() || []).length; } catch (e) { return 0; } }

  // ------------------------------------------------------------------ zoom
  function zoom(factor){
    const ch = activeChart();
    if (!ch) return;
    try {
      const r = ch.getVisibleRange();
      if (!r) return;
      const span = Math.max(60000, (r.to - r.from) * factor);
      ch.setVisibleRange({ from: r.to - span, to: r.to });
    } catch (e) { console.warn('TradeZoro: zoom', e); }
  }

  // ------------------------------------------------------------------ left column
  let col = null;
  let lastZoom = 'in';
  let fly = null;          // our own open flyout { el, cell }
  const nodes = {};

  function tipFor(el, text){
    el.setAttribute('aria-label', text);
    el.title = text;
  }
  function btn(cls, icon, label, onClick){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vela-dtb-btn stkt-btn ' + cls;
    b.innerHTML = hit(icon);
    tipFor(b, label);
    b.addEventListener('click', onClick);
    return b;
  }
  function divider(){
    const d = document.createElement('div');
    d.className = 'stkt-div';
    d.setAttribute('aria-hidden', 'true');
    return d;
  }
  // A cell with its own ▸ flyout, same look as Vela's group cells.
  function cell(cls, label, icon, onIcon, items){
    const c = document.createElement('div');
    c.className = 'vela-dtb-cell stkt-cell ' + cls;
    const i = document.createElement('button');
    i.type = 'button';
    i.className = 'vela-dtb-icon';
    i.innerHTML = hit(icon);
    tipFor(i, label);
    i.addEventListener('click', onIcon);
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'vela-dtb-arrow';
    a.setAttribute('aria-label', label + ' — more');
    a.setAttribute('aria-haspopup', 'menu');
    a.innerHTML = '<span class="vela-dtb-hit vela-dtb-hit--arrow"><span style="width:11px;height:11px;display:flex;align-items:center;justify-content:center;">' + svg(IC.arrow, 11) + '</span></span>';
    a.addEventListener('click', (e) => { e.stopPropagation(); toggleFly(c, items); });
    c.append(i, a);
    return c;
  }
  function closeFly(){
    if (!fly) return;
    fly.el.remove();
    fly.cell.classList.remove('vela-open');
    fly = null;
  }
  function toggleFly(c, items){
    const was = fly && fly.cell === c;
    closeFly();
    try { if (ws.drawToolbar) ws.drawToolbar.closeFlyout(); } catch (e) {}
    if (was) return;
    const host = col.parentElement;
    const el = document.createElement('div');
    el.className = 'vela-dtb-flyout stkt-fly';
    el.setAttribute('role', 'menu');
    copyTokens(el);
    items().forEach((it) => {
      if (it.head) { const h = document.createElement('div'); h.className = 'stkt-fly-h'; h.textContent = it.head; el.appendChild(h); return; }
      const r = document.createElement('button');
      r.type = 'button';
      r.className = 'vela-dtb-item stkt-fly-i';
      r.setAttribute('role', 'menuitem');
      r.setAttribute('aria-label', it.label);
      if (it.disabled) r.disabled = true;
      r.innerHTML = (it.icon ? '<span class="stkt-fly-ic">' + svg(it.icon, 28) + '</span>' : '') + '<span class="stkt-fly-l"></span>' + (it.hint ? '<span class="vela-dtb-hint stkt-fly-k"></span>' : '');
      r.querySelector('.stkt-fly-l').textContent = it.label;
      if (it.hint) r.querySelector('.stkt-fly-k').textContent = it.hint;
      r.addEventListener('click', (e) => { e.stopPropagation(); closeFly(); it.run(); });
      el.appendChild(r);
    });
    host.appendChild(el);
    const cr = c.getBoundingClientRect(), colR = col.getBoundingClientRect(), hr = host.getBoundingClientRect();
    el.style.left = (colR.right - hr.left - 1) + 'px';
    el.style.top = Math.max(0, Math.min(cr.top - hr.top, hr.height - el.offsetHeight - 8)) + 'px';
    c.classList.add('vela-open');
    fly = { el, cell: c };
  }
  document.addEventListener('pointerdown', (e) => {
    if (fly && !fly.el.contains(e.target) && !fly.cell.contains(e.target)) closeFly();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFly(); });

  function copyTokens(el){
    const s = root.style;
    for (let i = 0; i < s.length; i++) { const k = s[i]; if (k.startsWith('--vela')) el.style.setProperty(k, s.getPropertyValue(k)); }
  }

  function build(){
    nodes.zoom = cell('stkt-zoom', 'Zoom in', IC.zoomIn, () => zoom(lastZoom === 'in' ? 0.8 : 1.25), () => [
      { label: 'Zoom in', icon: IC.zoomIn, hint: navigator.platform && /Mac/.test(navigator.platform) ? '⌘↑' : 'Ctrl+↑', run: () => { lastZoom = 'in'; paintZoom(); zoom(0.8); } },
      { label: 'Zoom out', icon: IC.zoomOut, hint: navigator.platform && /Mac/.test(navigator.platform) ? '⌘↓' : 'Ctrl+↓', run: () => { lastZoom = 'out'; paintZoom(); zoom(1.25); } }
    ]);
    nodes.lock = btn('stkt-lock', IC.lock, 'Lock all drawings', () => setSwitch('lock', !st.lock));
    nodes.hide = btn('stkt-hide', IC.eye, 'Hide all drawings', () => setSwitch('hide', !st.hide));
    nodes.trash = cell('stkt-trash', 'Remove drawings', IC.trash, () => removeDrawings(), () => {
      const ch = activeChart();
      const n = ch ? countDrawings(ch) : 0;
      const all = cells().reduce((s, c) => s + countDrawings(c.chart), 0);
      const out = [{ head: 'Remove' }, { label: 'Remove ' + n + ' drawing' + (n === 1 ? '' : 's') + ' (this chart)', icon: IC.trash, disabled: !n, run: () => removeDrawings() }];
      if (cells().length > 1) out.push({ label: 'Remove ' + all + ' drawing' + (all === 1 ? '' : 's') + ' (all charts)', icon: IC.trash, disabled: !all, run: () => removeDrawings(true) });
      return out;
    });
    nodes.d = [divider(), divider(), divider(), divider()];
  }
  function removeDrawings(every){
    const list = every ? cells().map((c) => c.chart) : [activeChart()].filter(Boolean);
    let n = 0;
    list.forEach((ch) => { n += countDrawings(ch); });
    if (!n) { toast('There are no drawings to remove.', 'info'); return; }
    list.forEach((ch) => {
      try { const ids = (ch.drawings.all() || []).map((d) => d.id); if (ids.length) ch.drawings.removeMany(ids); } catch (e) { console.warn('TradeZoro: remove drawings', e); }
    });
    toast(n + ' drawing' + (n === 1 ? '' : 's') + ' removed. Ctrl+Z brings them back.', 'info');
  }
  function paintZoom(){
    const b = nodes.zoom && nodes.zoom.querySelector('.vela-dtb-icon');
    if (!b) return;
    b.innerHTML = hit(lastZoom === 'in' ? IC.zoomIn : IC.zoomOut);
    tipFor(b, lastZoom === 'in' ? 'Zoom in' : 'Zoom out');
  }
  function paint(){
    if (nodes.lock) {
      nodes.lock.dataset.active = st.lock ? '1' : '';
      nodes.lock.innerHTML = hit(st.lock ? IC.lock : IC.unlock);
      tipFor(nodes.lock, st.lock ? 'Unlock all drawings' : 'Lock all drawings');
      nodes.lock.setAttribute('aria-pressed', st.lock ? 'true' : 'false');
    }
    if (nodes.hide) {
      nodes.hide.dataset.active = st.hide ? '1' : '';
      nodes.hide.innerHTML = hit(st.hide ? IC.eyeOff : IC.eye);
      tipFor(nodes.hide, st.hide ? 'Show all drawings' : 'Hide all drawings');
      nodes.hide.setAttribute('aria-pressed', st.hide ? 'true' : 'false');
    }
  }

  // Put the column in TradingView's order. Vela's own nodes are found by their labels.
  const byLabel = (re) => [...col.children].find((n) => {
    const l = n.getAttribute('aria-label') || (n.querySelector('.vela-dtb-icon') && n.querySelector('.vela-dtb-icon').getAttribute('aria-label')) || '';
    return re.test(l);
  });
  let arranging = false;
  function arrange(){
    col = root.querySelector('.vela-dtb');
    if (!col || arranging) return;
    arranging = true;
    try {
      if (!nodes.zoom) { build(); paint(); }
      col.classList.add('stkt-col');
      restyle();
      const collapse = col.querySelector('.vela-dtb-collapse');
      const measure = byLabel(/^Measure$/);
      const eraser = byLabel(/^Eraser/);
      const magnet = col.querySelector('.vela-dtb-cell:not(.stkt-cell) .vela-dtb-icon[aria-label^="Magnet"]');
      const magnetCell = magnet && magnet.parentElement;
      const stay = byLabel(/^Stay in drawing/);
      const sync = byLabel(/^Sync drawings/);
      const fav = col.querySelector('.stk-fb-tog');
      if (!collapse || !measure || !eraser || !magnetCell || !stay) return;
      const want = [measure, nodes.zoom, nodes.d[0], magnetCell, stay, nodes.lock, nodes.hide, nodes.d[1], eraser, nodes.trash, nodes.d[2], sync, fav].filter(Boolean);
      // where the tail starts: right after the divider that follows the last group
      let at = measure.previousElementSibling;
      let ok = true;
      let cur = at;
      for (const n of want) { cur = cur ? cur.nextElementSibling : null; if (cur !== n) { ok = false; break; } }
      if (ok && cur && cur.nextElementSibling === collapse) return;
      const frag = document.createDocumentFragment();
      want.forEach((n) => frag.appendChild(n));
      col.insertBefore(frag, collapse);
    } finally { arranging = false; }
  }
  // Vela's built-in buttons draw its own icon set; give them ours (the shared 28-grid set).
  function restyle(){
    if (!col) return;
    [...col.querySelectorAll('.vela-dtb-btn:not(.stkt-btn):not(.stk-fb-tog)')].forEach((b) => {
      const l = b.getAttribute('aria-label') || '';
      const hitEl = b.querySelector('.vela-dtb-hit');
      const m = VELA_BTNS.find(([re]) => re.test(l));
      if (!m || !hitEl || hitEl.dataset.stk === m[1]) return;
      hitEl.dataset.stk = m[1];
      hitEl.innerHTML = '<span class="stkt-ic' + (m[1] === 'chevronsLeft' ? ' stkt-ic-s' : '') + '">' + svg(m[1]) + '</span>';
    });
    const mag = col.querySelector('.vela-dtb-cell:not(.stkt-cell) .vela-dtb-icon[aria-label^="Magnet"] .vela-dtb-hit');
    if (mag && mag.dataset.stk !== 'magnet') { mag.dataset.stk = 'magnet'; mag.innerHTML = '<span class="stkt-ic">' + svg('magnet') + '</span>'; }
  }
  // Long press on a group button opens its flyout (TradingView's touch/mouse behaviour).
  let lpTimer = 0, lpFired = false, lpX = 0, lpY = 0;
  root.addEventListener('pointerdown', (e) => {
    const icon = e.target.closest && e.target.closest('.vela-dtb .vela-dtb-cell .vela-dtb-icon');
    lpFired = false;
    clearTimeout(lpTimer);
    if (!icon || e.button > 0) return;
    const arrow = icon.parentElement.querySelector('.vela-dtb-arrow');
    if (!arrow) return;
    lpX = e.clientX; lpY = e.clientY;
    lpTimer = setTimeout(() => { lpTimer = 0; arrow.click(); lpFired = true; }, LONG_MS);
  }, true);
  root.addEventListener('pointermove', (e) => { if (lpTimer && Math.hypot(e.clientX - lpX, e.clientY - lpY) > 8) clearTimeout(lpTimer); }, true);
  ['pointerup', 'pointercancel'].forEach((t) => root.addEventListener(t, () => clearTimeout(lpTimer), true));
  // the click that ends a long press must not also arm the tool
  document.addEventListener('click', (e) => {
    if (!lpFired) return;
    lpFired = false;
    if (e.target.closest && e.target.closest('.vela-dtb .vela-dtb-icon')) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.vela-dtb-cell')) e.preventDefault(); }, true);

  // Vela rebuilds the column's children (theme change); the favourites toggle is added late.
  const mo = new MutationObserver(() => { if (!arranging) arrange(); });
  const tbHost = root.querySelector('.vela-ws-toolbar');
  if (tbHost) mo.observe(tbHost, { childList: true, subtree: true });
  arrange();
  wire();
  try { ws.on('layout:changed', () => setTimeout(() => { wire(); if (st.lock) applyAll('lock', true); if (st.hide) applyAll('hide', true); }, 0)); } catch (e) {}
  // switches remembered from last visit apply once the drawings have loaded
  if (st.lock || st.hide) setTimeout(() => { if (st.lock) applyAll('lock', true); if (st.hide) applyAll('hide', true); }, 1500);

  // ------------------------------------------------------------------ top: tooltips
  // TradingView shows a tooltip on every toolbar control; Vela's symbol and Indicators have none.
  [['.vela-widget-symbol', 'Symbol search'], ['.vela-widget-indicators', 'Indicators, metrics and strategies (/)'], ['.vela-mb-symbol', 'Symbol search'],
   ['.vela-mb-tf', 'Interval'], ['.vela-mb-indicators', 'Indicators'], ['.vela-mb-drawings', 'Drawing tools'], ['.vela-mb-more', 'Chart menu']].forEach(([sel, t]) => {
    document.querySelectorAll(sel).forEach((b) => { if (!b.title) b.title = t; });
  });

  // ------------------------------------------------------------------ top: fullscreen
  // FULL SCREEN (Owner 2026-10-26, phone and desktop): hides everything except the chart and its
  // toolbar (site header, side menu, market strip, footnote, bottom nav: html.stk-chart-fs in
  // style.css) and, where the browser allows it, asks for real full screen too (Android Chrome,
  // desktop; iPhone Safari has none, the page mode alone still applies). Esc, the phone's back
  // gesture or the button exit. The choice is remembered (localStorage stk_chart_fs).
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  const LS_FS = 'stk_chart_fs';
  const html = document.documentElement;
  let fsBtn = null;
  if (barR && !document.getElementById('stkc-fs-btn')) {
    fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'stkc-ib stkt-fs';
    fsBtn.id = 'stkc-fs-btn';
    let native = false;   // did WE ask the browser for full screen
    const isOn = () => html.classList.contains('stk-chart-fs');
    const paintFs = () => {
      const on = isOn();
      fsBtn.innerHTML = svg(on ? IC.fullOff : IC.full, 16);
      fsBtn.title = on ? 'Exit full screen' : 'Full screen';
      fsBtn.setAttribute('aria-label', fsBtn.title);
      fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    const askNative = () => {
      try {
        if (!document.fullscreenElement && document.fullscreenEnabled && html.requestFullscreen) {
          html.requestFullscreen({ navigationUI: 'hide' }).then(() => { native = true; }).catch(() => {});
        }
      } catch (e) {}
    };
    const setFs = (on, opts) => {
      opts = opts || {};
      on = !!on;
      if (on !== isOn()) {
        html.classList.toggle('stk-chart-fs', on);
        try { if (on) localStorage.setItem(LS_FS, '1'); else localStorage.removeItem(LS_FS); } catch (e) {}
        // a history entry, so the phone's back gesture leaves full screen instead of the page
        if (on && !opts.fromHistory) { try { history.pushState(Object.assign({}, history.state, { stkFs: 1 }), ''); } catch (e) {} }
        if (!on && !opts.fromHistory && history.state && history.state.stkFs) { try { history.back(); } catch (e) {} }
        window.dispatchEvent(new Event('resize'));   // vela-chart.js re-measures the header / dock
      }
      if (on && opts.native) askNative();
      if (!on && document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
      if (!on) native = false;
      paintFs();
    };
    paintFs();
    fsBtn.addEventListener('click', () => setFs(!isOn(), { native: true }));
    document.addEventListener('fullscreenchange', () => {
      // Esc / the system back left the browser's full screen: leave ours too
      if (!document.fullscreenElement && native && isOn()) setFs(false);
      paintFs();
    });
    window.addEventListener('popstate', (e) => { if (isOn() && !(e.state && e.state.stkFs)) setFs(false, { fromHistory: true }); });
    // capture phase: the chart canvas handles Esc itself (cancels a drawing) and may stop it
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !isOn()) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      // an open menu / dialog takes Esc first
      if (document.querySelector('.stkc-pop:not([hidden]), .stkc-ob-pop:not([hidden]), .mclock-pop:not([hidden]), [role="dialog"]:not([hidden]) input:focus')) return;
      setFs(false);
    }, true);
    // remembered: back in full screen on load (page mode now; the browser's full screen needs a
    // tap, so it is asked on the first one)
    let remembered = false;
    try { remembered = localStorage.getItem(LS_FS) === '1'; } catch (e) {}
    if (remembered) {
      setFs(true);
      const once = () => { document.removeEventListener('pointerup', once, true); if (isOn()) askNative(); };
      document.addEventListener('pointerup', once, true);
    }
    window.__stkChartFs = { set: (on) => setFs(on, { native: true }), get on(){ return isOn(); } };
    const cog = document.getElementById('stkc-settings-btn');
    // on a phone the settings button can sit outside barR (in the more sheet): then append
    barR.insertBefore(fsBtn, cog && cog.parentNode === barR ? cog.nextSibling : null);
  }

  // ------------------------------------------------------------------ right icon bar
  let railDone = false;
  function fillRail(){
    if (railDone) return true;
    const rail = document.querySelector('.stkw-rail');
    const alerts = document.querySelector('.vela-widget-alerts');
    const panels = document.querySelector('.vela-widget-panels');
    if (!rail || (!alerts && !panels)) return false;
    copyTokens(rail);
    rail.classList.add('stkt-rail');
    const d = document.createElement('div');
    d.className = 'stkt-rdiv';
    d.setAttribute('aria-hidden', 'true');
    rail.appendChild(d);
    if (alerts) { alerts.classList.add('stkt-rbtn'); rail.appendChild(alerts); }
    if (panels) { panels.classList.add('stkt-rpanels'); rail.appendChild(panels); }
    railDone = true;
    try { if (window.__stkOneBar) window.__stkOneBar.fit(); } catch (e) {}
    return true;
  }
  if (!fillRail()) {
    const rmo = new MutationObserver(() => { if (fillRail()) rmo.disconnect(); });
    rmo.observe(document.querySelector('.stkchart-panel') || document.body, { childList: true, subtree: true });
    setTimeout(() => rmo.disconnect(), 30000);
  }
  new MutationObserver(() => copyTokens(document.querySelector('.stkw-rail') || document.createElement('i'))).observe(root, { attributes: true, attributeFilter: ['style'] });

  const api = {
    get lockAll(){ return st.lock; }, get hideAll(){ return st.hide; },
    setLockAll: (v) => setSwitch('lock', !!v), setHideAll: (v) => setSwitch('hide', !!v),
    removeDrawings, zoom, arrange, get railReady(){ return railDone; }
  };
  window.__stkTvBars = api;
  return api;
}
