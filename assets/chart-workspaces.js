// TradeZoro — Charts WORKSPACES (charts.html) — ES module
// Depends on: assets/chart-workspaces-core.js (index logic), assets/chart-layouts.js (api handed in as L:
// adopt, fetchDoc, saveNow, saveAsNew, current, dirty, viewing), assets/vela-chart.js (ws = VelaWorkspace,
// bindPopover, sheetHead, toast, grid), the right-side panels' test/API hooks (window.STRYKER_WATCHLIST,
// __stkBookPanel, __stkNews, __stkGexLadder, __stkSymInfo, __stkDarkPool, __stkHeatmapPanel), firebase compat
// (optional), style.css (.stkws-*).
//
// Owner feature 2026-11-14 ("add workspace feature"): a WORKSPACE is the whole screen — the chart grid, every
// chart's symbol / interval / indicators / drawings, plus the open side panels and their widths.
//   - Top bar: a Workspaces button (current name) opens the list: switch, New, Duplicate, Rename, Delete,
//     drag to reorder. Phones: the same list as a bottom sheet.
//   - Desktop: a slim tab strip (shown from 2 workspaces) under the toolbar; Ctrl/Cmd+1..9 switch.
//   - Switching is instant for the last few (their chart documents stay in memory) and saves the one you leave.
// Storage builds on LAYOUTS: signed in, each workspace's chart is one saved layout (students/{uid}/chartLayouts,
// created the first time you leave the workspace, then kept by the layout autosave); the index (names, order,
// layout ids, panels) is in localStorage and synced to students/{uid}/chartPrefs/workspaces (rules block in
// functions-src/firestore.rules). Signed out: index and chart documents in localStorage.
// Crash safety: the screen itself is restored by the chart's own on-device save; the index says which
// workspace it is. Deleting a workspace never deletes its saved layout.
import * as C from './chart-workspaces-core.js?v=1001';

const REMOTE_MS = 1500;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const isPhone = () => window.innerWidth <= 700;
function fb(){ return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null; }
function user(){ const f = fb(); try { return f && f.auth().currentUser; } catch (e) { return null; } }
const lsGet = (k) => { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
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
const IC = {
  ws: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M9 9v10.5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>'
};
const svg = (k, s) => '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>';
const keyName = (i) => (isMac ? '⌘' : 'Ctrl+') + (i + 1);

// ---- the side panels a workspace remembers (each: is it open, open/close, optional width) ----
const PANELS = {
  watchlist: { api: () => window.STRYKER_WATCHLIST, on: (a) => a.open, set: (a, v) => a.setOpen(v) },
  book: { api: () => window.__stkBookPanel },
  news: { api: () => window.__stkNews },
  gex: { api: () => window.__stkGexLadder },
  info: { api: () => window.__stkSymInfo },
  darkpool: { api: () => window.__stkDarkPool },
  heatmap: { api: () => window.__stkHeatmapPanel }
};
function panelOpen(id){ const p = PANELS[id], a = p.api(); try { return !!(a && (p.on ? p.on(a) : a.isOpen)); } catch (e) { return false; } }
function panelSet(id, v){ const p = PANELS[id], a = p.api(); if (!a) return; try { if (p.set) p.set(a, v); else if (v) a.open(); else a.close(); } catch (e) { console.warn('TradeZoro: workspace panel', id, e); } }
export function capturePanels(){
  const out = { open: C.PANEL_IDS.filter((id) => PANELS[id] && panelOpen(id)), w: {} };
  try { const a = window.STRYKER_WATCHLIST; if (a && a.width) out.w.watchlist = a.width; } catch (e) {}
  try { const a = window.__stkBookPanel; if (a && a.width) out.w.book = a.width; } catch (e) {}
  return C.cleanPanels(out);
}
function applyPanels(p){
  p = C.cleanPanels(p);
  try { const a = window.STRYKER_WATCHLIST; if (a && a.setWidth && p.w.watchlist && a.width !== p.w.watchlist) a.setWidth(p.w.watchlist); } catch (e) {}
  try { const a = window.__stkBookPanel; if (a && a.setWidth && p.w.book && a.width !== p.w.book) a.setWidth(p.w.book); } catch (e) {}
  C.PANEL_IDS.forEach((id) => { if (!p.open.includes(id) && panelOpen(id)) panelSet(id, false); });
  p.open.forEach((id) => { if (!panelOpen(id)) panelSet(id, true); });
}

export function mountWorkspaces(ws, o){
  const { L, barL, bindPopover, sheetHead, toast, grid } = o;
  if (!ws || !L || !barL || document.getElementById('stkws-btn')) return null;
  const uid = () => (user() ? user().uid : 'guest');
  const K = { ix: () => 'stryker_ws_ix_' + uid(), doc: (id) => 'stryker_ws_doc_' + uid() + '_' + id };
  const docs = C.lru(C.CACHE_N);      // workspace id -> chart document (instant switching)
  const pending = new Map();          // workspace id -> promise of its first layout save
  let ix = null, busy = null, want = null, remoteT = null;

  // ---------------------------------------------------------------- state
  const safe = () => !!(window.__stkSafe && window.__stkSafe.active);
  function screenState(){
    const st = ws.getState();
    const from = grid && grid.capFrom && grid.capFrom();
    if (from) st.layout = from;   // device-capped view: keep the member's own grid
    return st;
  }
  const cur = () => C.activeItem(ix);
  // the open layout belongs to the open workspace (opening another layout from the layout menu moves the workspace to it)
  function syncLayout(it){
    if (!user() || L.viewing) return;
    const c = L.current;
    if (c) { it.layoutId = c.id; it.layoutName = c.name; it.shared = !!c.shared; }
    else if (!pending.has(it.id)) { it.layoutId = null; it.layoutName = ''; it.shared = false; }
  }
  function persist(){
    ix.t = Date.now();
    const s = C.serialize(ix);
    if (s) { try { localStorage.setItem(K.ix(), s); } catch (e) {} }
    paint();
    if (!user() || !s) return;
    clearTimeout(remoteT);
    remoteT = setTimeout(() => remoteRef().set({ index: s, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch((e) => console.warn('TradeZoro: workspaces sync', e && e.code)), REMOTE_MS);
  }
  const remoteRef = () => firebase.firestore().collection('students').doc(user().uid).collection('chartPrefs').doc('workspaces');
  function defaultDoc(){
    let a = null; try { a = ws.active; } catch (e) {}
    return { version: 1, layout: '1', charts: [{ id: 'A', symbol: (a && a.symbol) || 'futures:NQ1!', timeframe: (a && a.timeframe) || '15' }] };
  }

  // Save the workspace being left: its chart (layout or this device) and its panels. Never blocks the switch.
  function leave(it){
    syncLayout(it);
    if (!isPhone()) it.panels = capturePanels();   // phones show panels as sheets: keep the desktop setup
    if (L.viewing || safe()) return;               // a shared read-only layout / indicators paused: nothing of ours to save
    const st = screenState();
    it.sub = C.subOf(st);
    docs.set(it.id, st);
    if (!user()) { if (!lsSet(K.doc(it.id), st)) keepLocal(it, st); return; }
    if (L.current) { L.saveNow(false, st); return; }
    // shortcut: its first save is still running; this newer state is kept in memory + on this device only, the account
    // copy catches up at the next autosave there. Upgrade if members report seconds-old charts after a quick reload.
    if (pending.has(it.id)) { lsSet(K.doc(it.id), st); return; }
    // first time away from a workspace with no saved layout: save one under the workspace's name
    const p = Promise.resolve(L.saveAsNew(it.name, { st, quiet: true, attach: () => false })).then((r) => {
      if (r && r.id) { it.layoutId = r.id; it.layoutName = r.name; it.shared = false; }
      else if (!lsSet(K.doc(it.id), st)) keepLocal(it, st);
      pending.delete(it.id); persist();
    }, () => { pending.delete(it.id); lsSet(K.doc(it.id), st); });
    pending.set(it.id, p);
  }
  function keepLocal(it, st){ try { window.StrykerStateCodec && window.StrykerStateCodec.backup('workspace:' + uid() + ':' + it.id, it.name, JSON.stringify(st)); } catch (e) {} }

  async function load(it){
    if (pending.has(it.id)) await pending.get(it.id);
    const c = docs.get(it.id);
    const meta = it.layoutId ? { id: it.layoutId, name: it.layoutName || it.name, shared: !!it.shared } : null;
    if (c) return { doc: JSON.parse(JSON.stringify(c)), meta };   // a copy: applyState must never alter the cached one
    if (user() && it.layoutId) {
      try { const r = await L.fetchDoc(it.layoutId); if (r) return r; } catch (e) { console.warn('TradeZoro: workspace layout', e); }
    }
    const d = lsGet(K.doc(it.id));
    if (d && typeof d === 'object') return { doc: d, meta: null };
    return { doc: defaultDoc(), meta: null, fresh: true };
  }

  async function switchTo(id){
    if (!ix || !C.find(ix, id)) return;
    if (busy) { want = id; return busy; }
    if (id === ix.active) return;
    busy = (async () => {
      const from = cur(), to = C.find(ix, id);
      leave(from);
      ix.active = to.id; persist();
      let r;
      try { r = await load(to); } catch (e) { r = { doc: defaultDoc(), meta: null }; }
      if (ix.active !== to.id) return;            // deleted / switched meanwhile
      L.adopt(r.doc, r.meta);
      if (r.meta) { to.layoutId = r.meta.id; to.layoutName = r.meta.name; to.shared = !!r.meta.shared; }
      docs.set(to.id, r.doc);
      if (!isPhone()) applyPanels(to.panels);
      persist();
      announce(to.name);
    })();
    try { await busy; } finally { busy = null; }
    if (want && want !== ix.active) { const w = want; want = null; return switchTo(w); }
    want = null;
  }

  // a new / duplicated workspace opens at once; signed in, it becomes a saved layout straight away (so autosave runs)
  async function openNew(name, doc){
    const it = C.add(ix, name);
    if (!it) { toast('You have ' + C.MAX + ' workspaces. Delete one to add another.', 'error'); return; }
    docs.set(it.id, doc);
    await switchTo(it.id);
    if (user() && ix.active === it.id && !safe()) {
      const p = Promise.resolve(L.saveAsNew(it.name, { quiet: true, attach: () => ix.active === it.id })).then((r) => {
        if (r && r.id) { it.layoutId = r.id; it.layoutName = r.name; it.shared = false; }
        pending.delete(it.id); persist();
      }, () => pending.delete(it.id));
      pending.set(it.id, p);
    }
    return it;
  }
  const createNew = (name) => openNew(name, defaultDoc());
  function duplicate(){
    if (safe()) { toast('Turn the indicators back on first, so the copy has them.', 'error'); return; }
    return openNew(cur().name + ' (copy)', screenState());
  }
  // the layout a workspace made for itself (same name) follows the rename; a layout the member named themselves keeps its name
  async function renameWs(id, name){
    const it = C.find(ix, id); if (!it) return;
    const old = it.name;
    if (!C.rename(ix, id, name)) return;
    if (pending.has(id)) await pending.get(id);
    if (user() && it.layoutId && it.layoutName === old && L.renameId) { try { await L.renameId(it.layoutId, it.name); it.layoutName = it.name; } catch (e) {} }
    else toast('Renamed');
    persist();
  }
  async function removeWs(id){
    const it = C.find(ix, id);
    if (!it) return false;
    if (ix.items.length <= 1) { toast('This is your only workspace.', 'error'); return false; }
    const kept = user() && it.layoutId ? ' Its chart stays in your saved layouts.' : '';
    if (!window.confirm('Delete the workspace "' + it.name + '"?' + kept)) return false;
    const wasActive = ix.active === id;
    const i = ix.items.findIndex((x) => x.id === id);
    if (wasActive) await switchTo(ix.items[i + 1] ? ix.items[i + 1].id : ix.items[i - 1].id);
    C.remove(ix, id);
    docs.delete(id);
    if (!user()) lsDel(K.doc(id));
    persist();
    toast('Workspace deleted');
    return true;
  }
  function reorder(ids){
    const by = new Map(ix.items.map((x) => [x.id, x]));
    const next = ids.map((x) => by.get(x)).filter(Boolean);
    if (next.length !== ix.items.length || next.every((x, i) => x === ix.items[i])) return;
    ix.items = next; persist();
  }

  // ---------------------------------------------------------------- UI: top-bar button + list
  const btn = el('button', { type: 'button', class: 'stkc-btn stkws-btn', id: 'stkws-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Workspaces: switch, add and arrange whole screens' });
  const pop = el('div', { class: 'stkc-pop stkc-sheet stkws-pop', id: 'stkws-pop', role: 'dialog', 'aria-label': 'Workspaces', hidden: '' });
  const wrap = el('div', { class: 'stkc-menu stkws-menu' }, [btn, pop]);
  barL.insertBefore(wrap, barL.firstChild);
  const setOpen = bindPopover(btn, pop, () => renderList());

  const live = el('div', { class: 'sr-only', 'aria-live': 'polite' });
  document.body.appendChild(live);
  function announce(name){ live.textContent = 'Workspace: ' + name; }

  function paintBtn(){
    const it = cur();
    btn.innerHTML = svg('ws', 16) + '<span class="stkws-name"></span>' + svg('chev', 10);
    btn.querySelector('.stkws-name').textContent = it.name;
    btn.setAttribute('aria-label', 'Workspaces. Current: ' + it.name);
  }

  function renderList(){
    pop.innerHTML = '';
    syncLayout(cur());
    try { cur().sub = C.subOf(screenState()); } catch (e) {}
    if (sheetHead) pop.appendChild(sheetHead(pop, 'Workspaces', ix.items.length + ' saved · ' + (user() ? 'synced to your account' : 'on this device')));
    pop.appendChild(el('p', { class: 'stkc-pop-h stkws-h', text: 'Workspaces' }));
    const ul = el('ul', { class: 'stkws-list', role: 'listbox', 'aria-label': 'Workspaces' });
    ix.items.forEach((it, i) => {
      const on = it.id === ix.active;
      const li = el('li', { class: 'stkws-li' + (on ? ' on' : ''), 'data-id': it.id });
      const grip = el('span', { class: 'stkws-grip', title: 'Drag to reorder', 'aria-hidden': 'true', html: svg('grip', 16) });
      const row = el('button', { type: 'button', class: 'stkws-row', role: 'option', 'aria-selected': on ? 'true' : 'false',
        title: i < 9 ? keyName(i) : '' }, [
        el('span', { class: 'stkws-t' }, [el('span', { class: 'stkws-l', text: it.name }), it.sub ? el('small', { class: 'stkws-s', text: it.sub }) : null]),
        i < 9 ? el('kbd', { class: 'stkws-kbd', text: keyName(i) }) : null,
        el('span', { class: 'stkws-ck', html: on ? svg('check', 18) : '' })]);
      row.addEventListener('click', () => { if (dragged) return; setOpen(false); switchTo(it.id); });
      row.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const to = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= ix.items.length) return;
        if (C.move(ix, it.id, to)) { persist(); renderList(); const b = pop.querySelector('[data-id="' + it.id + '"] .stkws-row'); if (b) b.focus(); }
      });
      li.appendChild(grip); li.appendChild(row);
      dragSort(grip, li, ul, '.stkws-li', 'y');
      ul.appendChild(li);
    });
    pop.appendChild(ul);
    pop.appendChild(el('div', { class: 'stkws-sep', role: 'separator' }));
    const item = (label, icon, run, opts) => {
      const b = el('button', { type: 'button', class: 'stkc-item stkc-mi stkws-act' + (opts && opts.danger ? ' stkws-danger' : '') }, [
        el('span', { class: 'stkc-mi-ic', html: svg(icon) }), el('span', { class: 'stkc-mi-t' }, [el('span', { class: 'stkc-mi-l', text: label })])]);
      if (opts && opts.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      b.addEventListener('click', () => { setOpen(false); run(); });
      pop.appendChild(b);
    };
    item('New workspace…', 'add', () => askName('New workspace', C.uniqueName(ix, 'Workspace ' + (ix.items.length + 1)), createNew));
    item('Duplicate', 'copy', duplicate);
    item('Rename…', 'rename', () => askName('Rename workspace', cur().name, (n) => renameWs(ix.active, n)));
    item('Delete…', 'del', () => removeWs(ix.active), { danger: true, disabled: ix.items.length <= 1 });
    if (!isPhone()) pop.appendChild(el('p', { class: 'stkws-foot', text: 'Switch with ' + (isMac ? '⌘' : 'Ctrl') + '+1 to 9. Drag to reorder.' }));
  }

  // pointer drag-to-reorder for list rows (axis y, from the grip) and tabs (axis x, the tab itself)
  let dragged = false;
  function dragSort(handle, node, box, sel, axis){
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p0 = axis === 'y' ? e.clientY : e.clientX;
      let moving = false;
      const mv = (ev) => {
        const p = axis === 'y' ? ev.clientY : ev.clientX;
        if (!moving && Math.abs(p - p0) < 5) return;
        if (!moving) { moving = true; dragged = true; node.classList.add('stkws-drag'); try { handle.setPointerCapture(e.pointerId); } catch (er) {} }
        ev.preventDefault();
        const sibs = [...box.querySelectorAll(sel)].filter((n) => n !== node);
        const after = sibs.find((n) => { const r = n.getBoundingClientRect(); return p < (axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2); });
        if (after) { if (node.nextSibling !== after) box.insertBefore(node, after); }
        else if (box.querySelector(sel + ':last-of-type') !== node) { const last = sibs[sibs.length - 1]; if (last) last.after(node); }
      };
      const up = () => {
        document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        node.classList.remove('stkws-drag');
        if (moving) { reorder([...box.querySelectorAll(sel)].map((n) => n.dataset.id)); setTimeout(() => { dragged = false; }, 0); }
      };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  }

  // ---------------------------------------------------------------- UI: desktop tab strip
  const tabs = el('div', { class: 'stkws-tabs', id: 'stkws-tabs', role: 'tablist', 'aria-label': 'Workspaces', hidden: '' });
  const tabRow = el('div', { class: 'stkws-tabrow' });
  const plus = el('button', { type: 'button', class: 'stkws-plus', title: 'New workspace', 'aria-label': 'New workspace', html: svg('add', 16) });
  plus.addEventListener('click', () => askName('New workspace', C.uniqueName(ix, 'Workspace ' + (ix.items.length + 1)), createNew));
  tabs.appendChild(tabRow); tabs.appendChild(plus);
  { const bar = document.getElementById('stkc-bar'); if (bar && bar.parentNode) bar.parentNode.insertBefore(tabs, bar.nextSibling); }
  function paintTabs(){
    tabs.hidden = ix.items.length < 2;
    tabRow.innerHTML = '';
    ix.items.forEach((it, i) => {
      const on = it.id === ix.active;
      const t = el('button', { type: 'button', class: 'stkws-tab' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', 'data-id': it.id,
        title: it.name + (it.sub ? ' · ' + it.sub : '') + (i < 9 ? ' (' + keyName(i) + ')' : '') + '. Double-click to rename, drag to reorder.' }, [el('span', { text: it.name })]);
      t.addEventListener('click', () => { if (!dragged) switchTo(it.id); });
      t.addEventListener('dblclick', () => askName('Rename workspace', it.name, (n) => renameWs(it.id, n)));
      dragSort(t, t, tabRow, '.stkws-tab', 'x');
      tabRow.appendChild(t);
    });
    // keep the active tab in view (scrollLeft on the strip itself, never scrollIntoView)
    const a = tabRow.querySelector('.stkws-tab.on');
    if (a) { const l = a.offsetLeft, r = l + a.offsetWidth; if (l < tabRow.scrollLeft) tabRow.scrollLeft = l; else if (r > tabRow.scrollLeft + tabRow.clientWidth) tabRow.scrollLeft = r - tabRow.clientWidth; }
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}   // the chart gives the strip its height
  }
  let shownTabs = null;
  function paint(){
    paintBtn();
    const sig = JSON.stringify([ix.active, ix.items.map((x) => [x.id, x.name, x.sub])]);
    if (sig !== shownTabs) { shownTabs = sig; paintTabs(); }
    if (!pop.hidden) renderList();
  }

  // ---------------------------------------------------------------- name dialog (same look as the layout dialogs)
  function askName(title, init, fn){
    const inp = el('input', { type: 'text', class: 'stkc-in', maxlength: String(C.NAME_MAX), 'aria-label': 'Workspace name', placeholder: 'e.g. NQ scalping' });
    inp.value = String(init || '').slice(0, C.NAME_MAX);
    const err = el('p', { class: 'stkc-err', hidden: '' });
    const cancel = el('button', { type: 'button', class: 'stkws-ghost', text: 'Cancel' });
    const ok = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Save' });
    const back = el('div', { class: 'stkl-back' });
    const close = el('button', { type: 'button', class: 'stkc-ib', 'aria-label': 'Close', html: svg('close', 16) });
    const box = el('div', { class: 'stkl-dlg stkws-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'stkl-hd' }, [el('h2', { text: title }), close]),
      el('div', { class: 'stkl-body' }, [inp, err]),
      el('div', { class: 'stkl-ft' }, [cancel, ok])]);
    back.appendChild(box);
    const done = () => { back.remove(); document.removeEventListener('keydown', esc, true); btn.focus(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    const go = () => {
      const v = C.cleanName(inp.value);
      if (!v) { err.hidden = false; err.textContent = 'Give the workspace a name.'; inp.focus(); return; }
      done(); fn(v);
    };
    close.addEventListener('click', done); cancel.addEventListener('click', done); ok.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
    document.addEventListener('keydown', esc, true);
    document.body.appendChild(back);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }

  // ---------------------------------------------------------------- keyboard + unload
  document.addEventListener('keydown', (e) => {
    const i = C.hotkeyIndex(e);
    if (i < 0 || !ix || i >= ix.items.length) return;
    e.preventDefault(); e.stopPropagation();
    switchTo(ix.items[i].id);
  }, true);
  window.addEventListener('beforeunload', () => {
    if (!ix) return;
    const it = cur(); syncLayout(it);
    if (!isPhone()) it.panels = capturePanels();
    try { it.sub = C.subOf(screenState()); } catch (e) {}
    const s = C.serialize(Object.assign({}, ix, { t: Date.now() }));
    if (s) { try { localStorage.setItem(K.ix(), s); } catch (e) {} }
  });

  // ---------------------------------------------------------------- boot
  ix = C.sanitize(lsGet(K.ix())) || C.fresh('Workspace 1', user() ? L.current : null);
  if (!C.find(ix, ix.active)) ix.active = ix.items[0].id;
  syncLayout(cur());
  paint();
  persist();
  // signed in: the account copy wins when it is newer (another device changed the list)
  if (user()) {
    remoteRef().get().then((d) => {
      const r = d && d.exists ? C.sanitize((d.data() || {}).index) : null;
      if (!r || C.pickNewer(ix, r) !== r) return;
      const here = C.find(r, ix.active);
      if (here) { r.active = ix.active; Object.assign(here, { layoutId: cur().layoutId, layoutName: cur().layoutName, shared: cur().shared }); ix = r; persist(); return; }
      const target = r.active; ix = r; ix.active = null;
      // the screen belongs to a workspace this account no longer has: open the account's active one (no save: it was not ours)
      (async () => { const it = C.find(ix, target) || ix.items[0]; ix.active = it.id; const x = await load(it); L.adopt(x.doc, x.meta); persist(); })();
    }).catch((e) => console.warn('TradeZoro: workspaces sync', e && e.code));
  }

  const api = { switchTo, createNew, duplicate, rename: renameWs, remove: removeWs, reorder,
    get index(){ return JSON.parse(JSON.stringify(ix)); }, get active(){ return cur(); }, get cached(){ return docs.keys(); },
    get busy(){ return !!busy; }, capturePanels };
  window.STRYKER_WORKSPACES = api;
  return api;
}
