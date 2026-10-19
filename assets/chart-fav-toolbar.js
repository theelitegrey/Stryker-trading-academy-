// TradeZoro — Charts: floating FAVORITES drawing toolbar (ES module)
// Depends on: the Vela workspace built in assets/vela-chart.js (passed in as ws, plus Core
// for getDrawingType: tool labels + icons); Vela's left drawing toolbar (.vela-dtb, whose
// flyout rows already carry the ☆/★ favourite star: chart.drawings.setFavorite); the global
// firebase compat SDK (signed-in sync); assets/toast.js via opts.toast.
//
// Owner order 2026-10-06: "add a favourites bar, tools that get favorite get added to this,
// it is draggable and can be positioned anywhere on chart screen" (TradingView's floating
// Favorites toolbar). What it does:
//   - One dark rounded pill for the whole page: 6-dot drag handle, then one button per
//     starred drawing tool (order = order starred; drag an icon sideways to reorder).
//   - Click a button = arm that tool on the ACTIVE chart cell (the last one clicked), the
//     same call the left toolbar makes. The armed tool is highlighted.
//   - Drag the handle (mouse, pen or touch: pointer events) anywhere over the chart grid;
//     it is clamped inside it. Position is stored as fractions of the grid, so it survives
//     resizing. Default: top-centre, just under the first cell's legend.
//   - Hidden when nothing is starred. Right-click (or long-press) → "Hide favorites
//     toolbar"; a star button added at the bottom of the left drawing toolbar shows / hides it.
// Drawing tools only. "Long/Short Position" is a risk-reward MEASUREMENT drawing; there is
// no order or trade button anywhere here (Owner rule: no buying/selling on the website).
//
// PERSISTENCE: { tools: [type...], x, y (0..1 of the grid), visible }.
//   Signed in: students/{uid}/chartPrefs/favToolbar (owner-only, shape-validated rules
//   block "Charts: favorites toolbar"). Signed out: localStorage 'stryker_chart_favbar'.
//   The first sign-in with no cloud doc copies this browser's favourites up.
// No Vela / LuxAlgo wording in view (Owner order 2026-10-05).

import { toolIcon, UI_ICONS } from './chart-tool-icons.js?v=601';

const LS = 'stryker_chart_favbar';
const LS_ORIENT = 'stryker_chart_favbar_orient';   // 'v' = vertical (this browser only: the cloud doc's shape is fixed by the rules)
const DOC_ID = 'favToolbar';
const MAX_TOOLS = 40;
const PHONE_MAX = 700;
const LONG_MS = 520;
// Vela's own drawing shortcuts (the column flyouts show the same hints).
const FALLBACK_KEYS = { trendline: 'Alt+T', hline: 'Alt+H', vline: 'Alt+V' };

const CSS = `
.stk-fb{position:absolute;z-index:21;display:flex;align-items:center;gap:0;padding:2px;
  background:#1e222d;border:1px solid #363a45;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.45);
  color:#d1d4dc;user-select:none;-webkit-user-select:none;touch-action:none;flex-wrap:nowrap;box-sizing:border-box;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.stk-fb::-webkit-scrollbar{height:3px;width:3px}.stk-fb::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:3px}.stk-fb::-webkit-scrollbar-button{display:none}
:root[data-theme="light"] .stk-fb{scrollbar-color:rgba(0,0,0,.25) transparent}:root[data-theme="light"] .stk-fb::-webkit-scrollbar-thumb{background:rgba(0,0,0,.25)}
.stk-fb[hidden]{display:none}
.stk-fb.vert{flex-direction:column;overflow-x:hidden;overflow-y:auto}
.stk-fb-h{width:12px;height:34px;display:flex;align-items:center;justify-content:center;cursor:grab;color:#6a6e78;border-radius:4px;flex:none;touch-action:none}
.stk-fb.vert .stk-fb-h{width:34px;height:12px}
.stk-fb.vert .stk-fb-h svg{transform:rotate(90deg)}
.stk-fb-h:hover{color:#b2b5be;background:rgba(255,255,255,.06)}
.stk-fb.drag .stk-fb-h{cursor:grabbing}
.stk-fb-b{all:unset;box-sizing:border-box;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;color:inherit;flex:none;touch-action:none}
.stk-fb-b svg{width:28px;height:28px;display:block;font-size:28px}
.stk-fb-b:hover{background:rgba(255,255,255,.08);color:#fff}
.stk-fb-b:focus-visible{outline:2px solid #03c988;outline-offset:-2px}
.stk-fb-b.on{background:rgba(3,201,136,.16);color:#03c988}
.stk-fb-b.moving{opacity:.55;background:rgba(255,255,255,.12)}
.stk-fb-tip{position:absolute;z-index:24;pointer-events:none;display:flex;align-items:center;gap:10px;background:#131722;color:#fff;border:1px solid #363a45;font:12px/1.2 -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif;padding:6px 9px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.stk-fb-tip[hidden]{display:none}
.stk-fb-tip kbd{font:11px/1 'JetBrains Mono',ui-monospace,monospace;color:#9598a1;background:none;border:0;padding:0}
.stk-fb-menu{position:absolute;z-index:25;background:#1e222d;border:1px solid #363a45;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.5);padding:4px;min-width:190px}
.stk-fb-menu button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:7px 12px;border-radius:4px;color:#d1d4dc;font:13px -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif;cursor:pointer;white-space:nowrap}
.stk-fb-menu button:hover,.stk-fb-menu button:focus-visible{background:rgba(255,255,255,.08);color:#fff}
.stk-fb-menu hr{border:0;border-top:1px solid #363a45;margin:4px 2px}
.stk-fb-tog.on .vela-dtb-hit{color:#f5a623}
:root[data-theme="light"] .stk-fb{background:#fff;border-color:#e0e3eb;color:#131722;box-shadow:0 2px 10px rgba(0,0,0,.14)}
:root[data-theme="light"] .stk-fb-h{color:#9598a1}
:root[data-theme="light"] .stk-fb-h:hover{color:#131722;background:rgba(0,0,0,.05)}
:root[data-theme="light"] .stk-fb-b:hover{background:rgba(0,0,0,.06);color:#131722}
:root[data-theme="light"] .stk-fb-b.on{background:rgba(3,201,136,.14);color:#02a370}
:root[data-theme="light"] .stk-fb-tip{background:#131722;color:#fff;border-color:#131722}
:root[data-theme="light"] .stk-fb-menu{background:#fff;border-color:#e0e3eb;box-shadow:0 6px 18px rgba(0,0,0,.14)}
:root[data-theme="light"] .stk-fb-menu button{color:#131722}
:root[data-theme="light"] .stk-fb-menu button:hover{background:#f0f3fa}
:root[data-theme="light"] .stk-fb-menu hr{border-top-color:#e0e3eb}
@media (max-width:${PHONE_MAX}px){.stk-fb-b{width:40px;height:40px}.stk-fb-h{height:40px;width:16px}.stk-fb.vert .stk-fb-h{width:40px;height:16px}}
`;

const GRIP = '<svg width="6" height="14" viewBox="0 0 6 14" aria-hidden="true" fill="currentColor"><circle cx="1.5" cy="2" r="1.2"/><circle cx="4.5" cy="2" r="1.2"/><circle cx="1.5" cy="7" r="1.2"/><circle cx="4.5" cy="7" r="1.2"/><circle cx="1.5" cy="12" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/></svg>';
const STAR = UI_ICONS.star;

const clamp01 = (v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

function fbUser(){ try { return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase.auth().currentUser : null; } catch (e) { return null; } }
function prefRef(u){ return firebase.firestore().collection('students').doc(u.uid).collection('chartPrefs').doc(DOC_ID); }

export function mountFavToolbar(ws, Core, opts){
  opts = opts || {};
  const toast = opts.toast || (() => {});
  const host = document.getElementById('vela-chart');
  const panel = host && host.parentElement;
  if (!host || !panel) return null;
  if (!document.getElementById('stk-fb-css')) { const st = document.createElement('style'); st.id = 'stk-fb-css'; st.textContent = CSS; document.head.appendChild(st); }

  const meta = (t) => { try { return Core.getDrawingType(t) || null; } catch (e) { return null; } };
  const valid = (list) => (Array.isArray(list) ? list : []).filter((t, i, a) => typeof t === 'string' && meta(t) && a.indexOf(t) === i).slice(0, MAX_TOOLS);
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const iconOf = (t) => { const m = meta(t); return toolIcon(t) || (m && m.icon) || ''; };
  const keyOf = (t) => { try { const k = ws.drawToolbar && ws.drawToolbar.shortcuts && ws.drawToolbar.shortcuts.get(t); if (k) return k; } catch (e) {} return FALLBACK_KEYS[t] || ''; };

  // ---------------- state ----------------
  const st = { tools: [], x: null, y: null, visible: true };
  let vertical = false;
  try { vertical = localStorage.getItem(LS_ORIENT) === 'v'; } catch (e) {}
  let uid = null;            // signed-in member whose doc we sync, or null (guest)
  let applying = false;      // true while we push a list into Vela (ignore the echo)

  const cells = () => { try { return ws.cells(); } catch (e) { return []; } };
  const activeDrawings = () => { try { return ws.active.chart.drawings; } catch (e) { return null; } };
  const veloFavs = () => { const d = activeDrawings(); try { return d ? d.favorites() : []; } catch (e) { return []; } };

  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  // Vela keeps the favourite SET (its flyouts are grouped, so its order never shows); the
  // bar's order is ours alone.
  function pushToVela(list){
    applying = true;
    try { const d = activeDrawings(); if (d && !sameSet(d.favorites(), list)) d.setFavorites(list); }
    catch (e) { console.warn('TradeZoro: favorites push', e); }
    applying = false;
  }

  // ---------------- persistence ----------------
  function readLocal(){ try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } }
  function writeLocal(){ try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }
  let saveT = null;
  function save(){
    writeLocal();
    if (!uid) return;
    clearTimeout(saveT);
    const who = uid;
    saveT = setTimeout(() => {
      const u = fbUser();
      if (!u || u.uid !== who) return;
      const doc = { tools: st.tools.slice(0, MAX_TOOLS), visible: !!st.visible, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      if (st.x != null) doc.x = st.x;
      if (st.y != null) doc.y = st.y;
      prefRef(u).set(doc).catch((e) => console.warn('TradeZoro: favorites toolbar save', e));
    }, 600);
  }
  function adopt(d){
    if (!d) return false;
    st.tools = valid(d.tools);
    st.x = clamp01(d.x); st.y = clamp01(d.y);
    st.visible = d.visible !== false;
    return true;
  }

  // Guests (and the first paint for members): this browser's copy, else Vela's own saved favourites.
  if (!adopt(readLocal())) st.tools = valid(veloFavs());
  if (st.tools.length) pushToVela(st.tools);

  async function onAuth(u){
    uid = u ? u.uid : null;
    if (!u) return;
    try {
      const snap = await prefRef(u).get();
      if (uid !== u.uid) return;
      if (snap.exists) { adopt(snap.data()); writeLocal(); pushToVela(st.tools); render(); }
      else if (st.tools.length) save();      // first sign-in: copy this browser's favourites up
    } catch (e) { console.warn('TradeZoro: favorites toolbar load', e); }
  }
  try { if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) firebase.auth().onAuthStateChanged(onAuth); } catch (e) {}

  // ---------------- DOM ----------------
  const bar = document.createElement('div');
  bar.className = 'stk-fb';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Favorite drawing tools');
  bar.hidden = true;
  const handle = document.createElement('div');
  handle.className = 'stk-fb-h';
  handle.title = 'Drag to move';
  handle.setAttribute('aria-hidden', 'true');
  handle.innerHTML = GRIP;
  bar.appendChild(handle);
  panel.appendChild(bar);
  const tip = document.createElement('div');
  tip.className = 'stk-fb-tip'; tip.hidden = true;
  panel.appendChild(tip);

  const grid = () => host.querySelector('.vela-ws-grid') || host;
  function area(){
    const p = panel.getBoundingClientRect();
    const g = grid().getBoundingClientRect();
    return { left: g.left - p.left, top: g.top - p.top, w: g.width, h: g.height };
  }
  // Width of the active cell's price axis (the strip right of the plot), measured from the
  // renderer; a phone keeps the bar off it, as TradingView does.
  function axisW(){
    try {
      const R = ws.active.chart.renderer.renderer;
      const cv = R.input && R.input.el;
      const w = cv ? cv.getBoundingClientRect().width - R.coords.width : 0;
      if (w > 0 && w < 200) return Math.round(w);
    } catch (e) {}
    return 60;
  }
  const reserveR = () => (isPhone() ? axisW() + 2 : 0);
  function defaultPos(a, bw){
    // Under the active cell's legend (statusline + indicator rows), centred on the plot.
    let top = 44;
    try {
      const cellEl = host.querySelector('.vela-cell[data-active="1"]') || host.querySelector('.vela-cell');
      const legs = cellEl ? cellEl.querySelectorAll('.vela-statusline, .vela-legend') : [];
      const g = grid().getBoundingClientRect();
      legs.forEach((l) => { const r = l.getBoundingClientRect(); if (r.height && r.bottom - g.top < a.h / 2) top = Math.max(top, r.bottom - g.top + 6); });
      // the paper one-click Buy/Sell ticket sits under the legend too: the bar goes below it, never over it
      const tk = cellEl && cellEl.querySelector('.stkpt-1c');
      if (tk) { const r = tk.getBoundingClientRect(); if (r.height && r.bottom - g.top < a.h / 2) top = Math.max(top, r.bottom - g.top + 6); }
    } catch (e) {}
    return { left: (a.w - reserveR() - bw) / 2, top: Math.min(top, Math.max(0, a.h - 46)) };
  }
  function limits(a){
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const room = a.w - reserveR();
    return { maxL: Math.max(0, (room >= bw ? room : a.w) - bw), maxT: Math.max(0, a.h - bh) };
  }
  function place(){
    if (bar.hidden) return;
    const a = area();
    // one row: scrolls sideways instead of running off the chart (or onto the phone's price axis)
    bar.style.maxWidth = vertical ? '' : Math.max(60, a.w - reserveR() - 4) + 'px';
    bar.style.maxHeight = vertical ? Math.max(60, a.h - 4) + 'px' : '';
    const { maxL, maxT } = limits(a);
    let l, t;
    if (st.x == null || st.y == null) { const d = defaultPos(a, bar.offsetWidth); l = d.left; t = d.top; }
    else { l = st.x * a.w; t = st.y * a.h; }
    l = Math.min(maxL, Math.max(0, l)); t = Math.min(maxT, Math.max(0, t));
    bar.style.left = Math.round(a.left + l) + 'px';
    bar.style.top = Math.round(a.top + t) + 'px';
  }

  let activeTool = null;
  function readActive(){ const d = activeDrawings(); try { activeTool = d ? d.getTool() : null; } catch (e) { activeTool = null; } }
  function paintActive(){ bar.querySelectorAll('.stk-fb-b').forEach((b) => { const on = b.dataset.type === activeTool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }

  let key = '';
  function render(){
    const show = st.tools.length > 0 && st.visible;
    const k = st.tools.join(',');
    bar.classList.toggle('vert', vertical);
    bar.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
    if (k !== key) {
      key = k;
      bar.querySelectorAll('.stk-fb-b').forEach((b) => b.remove());
      st.tools.forEach((t) => {
        const m = meta(t); if (!m) return;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'stk-fb-b'; b.dataset.type = t;
        const kb = keyOf(t);
        b.setAttribute('aria-label', m.label + (kb ? ' (' + kb + ')' : ''));
        b.innerHTML = String(iconOf(t)).replace('<svg ', '<svg aria-hidden="true" ');
        bar.appendChild(b);
      });
    }
    bar.hidden = !show;
    readActive(); paintActive();
    paintToggle();
    if (show) place();
  }

  // ---------------- tooltip: name + shortcut ----------------
  let tipT = null;
  function showTip(b){
    const m = meta(b.dataset.type); if (!m) return;
    tip.textContent = '';
    const n = document.createElement('span'); n.textContent = m.label; tip.appendChild(n);
    const kb = keyOf(b.dataset.type);
    if (kb) { const k = document.createElement('kbd'); k.textContent = kb; tip.appendChild(k); }
    tip.hidden = false;
    const p = panel.getBoundingClientRect(), r = b.getBoundingClientRect();
    let l, t;
    if (vertical) {
      l = r.right - p.left + 6; t = r.top - p.top + r.height / 2 - tip.offsetHeight / 2;
      if (l + tip.offsetWidth > p.width) l = r.left - p.left - tip.offsetWidth - 6;
    } else {
      l = r.left - p.left + r.width / 2 - tip.offsetWidth / 2;
      t = r.bottom - p.top + 6;
      if (t + tip.offsetHeight > p.height) t = r.top - p.top - tip.offsetHeight - 6;
    }
    l = Math.max(2, Math.min(p.width - tip.offsetWidth - 2, l));
    tip.style.left = Math.round(l) + 'px'; tip.style.top = Math.round(t) + 'px';
  }
  bar.addEventListener('pointerover', (e) => { const b = e.target.closest('.stk-fb-b'); if (!b || e.pointerType === 'touch' || dragging || menu) return; clearTimeout(tipT); tipT = setTimeout(() => showTip(b), 350); });
  bar.addEventListener('pointerout', (e) => { const b = e.target.closest('.stk-fb-b'); if (b && b.contains(e.relatedTarget)) return; clearTimeout(tipT); tip.hidden = true; });

  // ---------------- arm a tool ----------------
  function arm(type){
    try {
      const d = activeDrawings(); if (!d) return;
      d.setTool(d.getTool() === type ? null : type);
      try { ws.refocusActive(); } catch (e) {}
    } catch (e) { console.warn('TradeZoro: favorites arm', e); }
    readActive(); paintActive();
  }

  // ---------------- drag (handle = move; icon = reorder); long press = menu ----------------
  let dragging = null;
  let lpTimer = 0;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const b = e.target.closest('.stk-fb-b');
    const onHandle = !!e.target.closest('.stk-fb-h');
    if (!b && !onHandle) return;
    hideMenu();
    tip.hidden = true; clearTimeout(tipT);
    const r = bar.getBoundingClientRect();
    const g = dragging = { id: e.pointerId, mode: onHandle ? 'move' : 'icon', btn: b, sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false, long: false };
    try { (onHandle ? handle : b).setPointerCapture(e.pointerId); } catch (x) {}
    if (onHandle) e.preventDefault();
    // touch / pen long press opens the same menu a right-click does
    clearTimeout(lpTimer);
    if (e.pointerType !== 'mouse') {
      lpTimer = setTimeout(() => {
        if (dragging !== g || g.moved) return;
        g.long = true;
        openMenu(g.sx, g.sy, b ? b.dataset.type : null);
      }, LONG_MS);
    }
  });
  bar.addEventListener('pointermove', (e) => {
    const g = dragging; if (!g || e.pointerId !== g.id || g.long) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    if (!g.moved) { g.moved = true; clearTimeout(lpTimer); bar.classList.add('drag'); if (g.mode === 'icon') g.btn.classList.add('moving'); }
    e.preventDefault();
    if (g.mode === 'move') {
      const a = area(), p = panel.getBoundingClientRect();
      const { maxL, maxT } = limits(a);
      let l = e.clientX - p.left - a.left - g.ox, t = e.clientY - p.top - a.top - g.oy;
      l = Math.min(maxL, Math.max(0, l)); t = Math.min(maxT, Math.max(0, t));
      bar.style.left = Math.round(a.left + l) + 'px'; bar.style.top = Math.round(a.top + t) + 'px';
      g.l = l; g.t = t;
    } else {
      // Reorder: drop the dragged icon before the first icon whose centre is past the pointer.
      const btns = [...bar.querySelectorAll('.stk-fb-b')].filter((x) => x !== g.btn);
      const before = btns.find((x) => {
        const rr = x.getBoundingClientRect();
        return vertical ? (e.clientY < rr.top + rr.height / 2) : (e.clientX < rr.left + rr.width / 2 && e.clientY < rr.bottom);
      });
      if (before) { if (g.btn.nextSibling !== before) bar.insertBefore(g.btn, before); }
      else if (bar.lastChild !== g.btn) bar.appendChild(g.btn);
    }
  });
  function endDrag(e){
    const g = dragging; if (!g || e.pointerId !== g.id) return;
    clearTimeout(lpTimer);
    dragging = null; bar.classList.remove('drag');
    if (g.mode === 'icon') g.btn.classList.remove('moving');
    if (g.long) return;                               // the long press opened the menu
    if (!g.moved) { if (g.mode === 'icon' && e.type === 'pointerup') arm(g.btn.dataset.type); return; }
    if (g.mode === 'move' && g.l != null) {
      const a = area();
      st.x = a.w ? +(g.l / a.w).toFixed(4) : 0; st.y = a.h ? +(g.t / a.h).toFixed(4) : 0;
      save();
    } else if (g.mode === 'icon') {
      const order = [...bar.querySelectorAll('.stk-fb-b')].map((x) => x.dataset.type);
      if (order.join(',') !== st.tools.join(',')) { st.tools = order; key = order.join(','); pushToVela(order); save(); }
    }
  }
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener('click', (e) => { if (e.detail === 0) { const b = e.target.closest('.stk-fb-b'); if (b) arm(b.dataset.type); } }); // keyboard Enter/Space

  // ---------------- context menu (right-click / long press) ----------------
  let menu = null;
  function hideMenu(){ if (menu) { menu.remove(); menu = null; } }
  function item(label, run){
    const it = document.createElement('button');
    it.type = 'button'; it.setAttribute('role', 'menuitem'); it.textContent = label;
    it.addEventListener('click', (ev) => { ev.stopPropagation(); hideMenu(); run(); });
    it.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    return it;
  }
  function openMenu(cx, cy, type){
    hideMenu();
    tip.hidden = true; clearTimeout(tipT);
    menu = document.createElement('div');
    menu.className = 'stk-fb-menu'; menu.setAttribute('role', 'menu');
    if (type && meta(type)) {
      menu.appendChild(item('Remove from favorites', () => removeFav(type)));
      menu.appendChild(document.createElement('hr'));
    }
    menu.appendChild(item(vertical ? 'Horizontal layout' : 'Vertical layout', () => setVertical(!vertical)));
    menu.appendChild(item('Hide favorites toolbar', () => setVisible(false)));
    panel.appendChild(menu);
    const p = panel.getBoundingClientRect();
    const l = Math.min(p.width - menu.offsetWidth - 4, Math.max(4, cx - p.left));
    const t = Math.min(p.height - menu.offsetHeight - 4, Math.max(4, cy - p.top));
    menu.style.left = Math.round(l) + 'px'; menu.style.top = Math.round(t) + 'px';
    const first = menu.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  bar.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dragging && (dragging.moved || dragging.long)) return;
    const b = e.target.closest('.stk-fb-b');
    if (menu && dragging && dragging.long) return;
    openMenu(e.clientX, e.clientY, b ? b.dataset.type : null);
  });
  document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target)) hideMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });

  function removeFav(type){
    if (!st.tools.includes(type)) return;
    st.tools = st.tools.filter((t) => t !== type);
    pushToVela(st.tools);
    save(); render();
    const m = meta(type);
    toast((m ? m.label : 'Tool') + ' removed from favorites.', 'info');
  }
  function setVertical(on){
    vertical = !!on;
    try { if (vertical) localStorage.setItem(LS_ORIENT, 'v'); else localStorage.removeItem(LS_ORIENT); } catch (e) {}
    render();
  }
  function setVisible(on){
    st.visible = !!on; save(); render();
    if (on && !st.tools.length) toast('Star a drawing tool (☆ in the left toolbar menus) to add it to the favorites toolbar.', 'info');
  }

  // ---------------- show / hide button in the left drawing toolbar ----------------
  let togBtn = null;
  function paintToggle(){
    if (!togBtn) return;
    const shown = st.visible && st.tools.length > 0;
    const lab = st.visible ? 'Hide favorites toolbar' : 'Show favorites toolbar';
    togBtn.setAttribute('aria-label', lab); togBtn.title = lab;
    togBtn.setAttribute('aria-pressed', shown ? 'true' : 'false');
    togBtn.classList.toggle('on', shown);
  }
  function ensureToggle(){
    const root = host.querySelector('.vela-dtb');
    if (!root) return;
    if (togBtn && root.contains(togBtn)) return;
    togBtn = document.createElement('button');
    togBtn.type = 'button';
    togBtn.className = 'vela-dtb-btn stk-fb-tog';
    togBtn.innerHTML = '<span class="vela-dtb-hit"><span style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;">' + STAR.replace('width="1em" height="1em"', 'width="22" height="22"') + '</span></span>';
    togBtn.addEventListener('click', () => setVisible(!st.visible));
    const col = root.querySelector('.vela-dtb-collapse');
    if (col) root.insertBefore(togBtn, col); else root.appendChild(togBtn);
    paintToggle();
  }
  const mo = new MutationObserver(() => ensureToggle());
  mo.observe(host, { childList: true, subtree: true });
  ensureToggle();

  // ---------------- follow Vela ----------------
  function onFavs(list){
    if (applying) return;
    list = valid(list);
    if (sameSet(list, st.tools)) return;
    const added = list.filter((t) => !st.tools.includes(t));
    // Keep the member's own order for tools that stay; new ones go on the end.
    st.tools = st.tools.filter((t) => list.includes(t)).concat(added);
    if (added.length) st.visible = true;   // starring a tool brings the bar back
    save(); render();
  }
  const wired = new WeakSet();
  function wire(){
    cells().forEach((c) => {
      const ch = c && c.chart; if (!ch || wired.has(ch)) return;
      wired.add(ch);
      try { ch.on('drawing:favorites', ({ favorites }) => onFavs(favorites)); } catch (e) {}
      try { ch.on('drawing:tool', () => { readActive(); paintActive(); }); } catch (e) {}
    });
  }
  wire();
  try { ws.on('cell:created', () => setTimeout(() => { wire(); if (st.tools.length) pushToVela(st.tools); }, 0)); } catch (e) {}
  try { ws.on('cell:active', () => setTimeout(() => { readActive(); paintActive(); }, 0)); } catch (e) {}
  try { ws.on('layout:changed', () => setTimeout(() => { wire(); place(); }, 50)); } catch (e) {}

  try { new ResizeObserver(() => place()).observe(grid()); } catch (e) { window.addEventListener('resize', place, { passive: true }); }
  window.addEventListener('resize', () => place(), { passive: true });
  setInterval(() => { if (st.x == null || st.y == null) place(); }, 2500);   // default spot follows the ticket / legend rows as they appear

  render();
  const api = { state: st, render, place, setVisible, setVertical, removeFav, get vertical(){ return vertical; }, el: bar };
  window.STRYKER_FAVBAR = api;
  return api;
}
