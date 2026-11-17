// TradeZoro — Charts WORKSPACES (charts.html) — ES module
// Depends on: assets/chart-workspaces-core.js (index logic), assets/chart-layouts.js (api handed in as L:
// adopt, fetchDoc, saveNow, saveAsNew, current, dirty, viewing), assets/vela-chart.js (ws = VelaWorkspace,
// bindPopover, sheetHead, toast, grid), the right-side panels' test/API hooks (window.STRYKER_WATCHLIST,
// __stkBookPanel, __stkNews, __stkGexLadder, __stkSymInfo, __stkDarkPool, __stkHeatmapPanel), firebase compat
// (optional), style.css (.stkws-*).
//
// Owner feature 2026-11-14 ("add workspace feature"): a WORKSPACE is the whole screen — the chart grid, every
// chart's symbol / interval / indicators / drawings, plus the open side panels and their widths.
//   - Top bar: a Workspaces button (current name) opens the list: switch, New, Duplicate, Rename, Close, Delete,
//     drag to reorder. Phones: the same list as a bottom sheet.
//   - Desktop: a slim tab strip (shown from 2 workspaces) under the toolbar; Ctrl/Cmd+1..9 switch.
//   - Switching is instant for the last few (their chart documents stay in memory) and saves the one you leave.
// Storage builds on LAYOUTS: signed in, each workspace's chart is one saved layout (students/{uid}/chartLayouts,
// created the first time you leave the workspace, then kept by the layout autosave); the index (names, order,
// layout ids, panels) is in localStorage and synced to students/{uid}/chartPrefs/workspaces (rules block in
// functions-src/firestore.rules). Signed out: index and chart documents in localStorage.
// Closing a tab (x, middle-click, menu) only hides it: the workspace and its chart stay saved under "Closed workspaces"
// in the Workspaces list, one click reopens it. Delete is a separate action with a confirm.
// Crash safety: the screen itself is restored by the chart's own on-device save; the index says which
// workspace it is. Deleting a workspace never deletes its saved layout.
import * as C from './chart-workspaces-core.js?v=1096';

const REMOTE_MS = 1500;
let remoteRead = false;
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
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  pin: '<path d="M12 16v5M8.5 3h7l-1 6 3 3.5V15h-11v-2.500L9.500 9z"/>',
  unpin: '<path d="M12 16v5M8.5 3h7l-1 6 3 3.5V15h-11v-2.500L9.500 9zM4 4l16 16"/>',
  home: '<path d="M4 11l8-7 8 7M6 9.500V20h12V9.500"/>',
  palette: '<circle cx="12" cy="12" r="8.500"/><circle cx="8.500" cy="11" r="1"/><circle cx="12" cy="7.800" r="1"/><circle cx="15.500" cy="11" r="1"/>',
  tpl: '<path d="M5 4h14v16H5zM5 9h14M10 9v11"/>',
  share: '<circle cx="18" cy="5.500" r="2.500"/><circle cx="6" cy="12" r="2.500"/><circle cx="18" cy="18.500" r="2.500"/><path d="M8.200 10.800l7.600-4.100M8.200 13.200l7.600 4.100"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  reset: '<path d="M4 12a8 8 0 1 1 2.500 5.800M4 19v-5h5"/>',
  star: '<path d="M12 4l2.400 5 5.600.8-4 3.900 1 5.500-5-2.700-5 2.700 1-5.500-4-3.900 5.600-.8z"/>',
  bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  chart: '<path d="M4 19V5M4 19h16M8 15l3-4 3 3 5-7"/>',
  flame: '<path d="M12 3c1 4 5 5.500 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.500"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5s-1.1 6.100-3.6 8.500c-2.5-2.400-3.600-5.200-3.600-8.500S9.500 5.900 12 3.500z"/>'
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
  const K = { ix: () => 'stryker_ws_ix_' + uid(), doc: (id) => 'stryker_ws_doc_' + uid() + '_' + id,
    scr: () => 'stryker_ws_scr_' + uid(),        // which workspace the engine's own saved screen (vela-workspace) belongs to
    snap: () => 'stryker_ws_snap_' + uid(),     // this tab's own latest screen (sessionStorage: never shared with other tabs)
    stamp: () => 'stryker_ws_stamp_' + uid(),   // which tab changed the shared engine screen last
    tab: () => 'stryker_ws_tab_' + uid() };      // this browser tab's active workspace (sessionStorage: survives a reload, never shared with other tabs)
  // markScreen: the engine's saved screen now belongs to workspace `id`. The engine writes it ~0.5 s after a change and
  // a document shown through adopt() does not always start that timer (phones), so it is written here too.
  const markScreen = (id) => { if (safe()) return;   // safe mode (phone, after a crash) writes no saved screen: nothing to claim
    lsSet(K.scr(), id); const w = () => { try { ws.persistNow && ws.persistNow(); } catch (e) {} }; w(); setTimeout(w, 900); };
  const docs = C.lru(C.CACHE_N);      // workspace id -> chart document (instant switching)
  const pending = new Map();          // workspace id -> promise of its first layout save
  let ix = null, busy = null, want = null, remoteT = null;
  // Every tab has its own id. The engine's saved screen (vela-workspace) is ONE per browser, so a tab may only trust it
  // when it was the last tab to change it; otherwise (another tab wrote it) it restores its own snapshot / workspace doc.
  let myTab = null; try { myTab = sessionStorage.getItem('stryker_ws_tabid'); if (!myTab) sessionStorage.setItem('stryker_ws_tabid', myTab = Math.random().toString(36).slice(2, 10)); } catch (e) { myTab = 'x' + Math.random(); }
  const stampMe = () => { try { localStorage.setItem(K.stamp(), myTab); } catch (e) {} };
  let snapT = null;
  const snapNow = () => { if (!ix || busy || safe() || L.viewing) return;
    try { sessionStorage.setItem(K.snap(), JSON.stringify({ ws: ix.active, st: screenState() })); } catch (e) {}
    // signed out (or never saved as a layout) a new tab has nothing else to open this workspace from
    const it = cur(); if (it && (!user() || !it.layoutId)) lsSet(K.doc(it.id), screenState()); };
  try { ws.on('state:changed', () => { stampMe(); clearTimeout(snapT); snapT = setTimeout(snapNow, 800); }); } catch (e) {}

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
    try { sessionStorage.setItem(K.tab(), ix.active); } catch (e) {}
    paint();
    if (!user() || !s || !remoteRead) return;   // never push before the account copy is read: a new device would overwrite it
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
    if (C.find(ix, id).closed) C.reopen(ix, id);   // opening a closed workspace brings its tab back
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
      markScreen(to.id); stampMe(); snapNow();
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
    if (!it) { toast('You have ' + C.MAX + ' workspaces (open and closed). Delete one to add another.', 'error'); return; }
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
    if (ix.items.length <= 1 || (!it.closed && C.openItems(ix).length <= 1)) { toast('Keep at least one workspace open.', 'error'); return false; }
    const kept = user() && it.layoutId ? ' Its chart stays in your saved layouts.' : '';
    if (!window.confirm('Delete the workspace "' + it.name + '"?' + kept)) return false;
    const wasActive = ix.active === id;
    const open = C.openItems(ix), i = open.findIndex((x) => x.id === id);
    if (wasActive) await switchTo((open[i + 1] || open[i - 1]).id);
    C.remove(ix, id);
    docs.delete(id);
    if (!user()) lsDel(K.doc(id));
    persist();
    toast('Workspace deleted');
    return true;
  }
  // Delete several at once (Close others / to the right). One confirm; pinned tabs are never in `ids`.
  async function removeMany(ids, what){
    ids = ids.filter((id) => C.find(ix, id));
    if (!ids.length) { toast('Nothing to close.'); return false; }
    if (ids.length >= C.openItems(ix).length) return false;
    const names = ids.map((id) => C.find(ix, id).name);
    if (!window.confirm('Delete ' + ids.length + ' workspace' + (ids.length > 1 ? 's' : '') + ' (' + what + ')?\n' + names.join(', ').slice(0, 200) + '\nPinned tabs stay.' + (user() ? ' Their charts stay in your saved layouts.' : ''))) return false;
    if (ids.includes(ix.active)) { const keep = C.openItems(ix).find((x) => !ids.includes(x.id)); await switchTo(keep.id); }
    ids.forEach((id) => { C.remove(ix, id); docs.delete(id); if (!user()) lsDel(K.doc(id)); });
    persist(); toast(ids.length + ' workspaces deleted');
    return true;
  }
  // Close = hide the tab, keep everything saved. No confirm: nothing is lost.
  async function closeWs(id){
    const it = C.find(ix, id);
    if (!it || it.closed) return false;
    if (C.openItems(ix).length <= 1) { toast('Keep at least one workspace open.', 'error'); return false; }
    const open = C.openItems(ix), i = open.findIndex((x) => x.id === id);
    if (ix.active === id) await switchTo((open[i + 1] || open[i - 1]).id);
    C.close(ix, id);
    persist(); toast('Closed "' + it.name + '". Reopen it from the Workspaces list.');
    return true;
  }
  async function closeMany(ids){
    ids = ids.filter((id) => { const x = C.find(ix, id); return x && !x.closed; });
    if (!ids.length || ids.length >= C.openItems(ix).length) return false;
    if (ids.includes(ix.active)) await switchTo(C.openItems(ix).find((x) => !ids.includes(x.id)).id);
    ids.forEach((id) => C.close(ix, id));
    persist(); toast(ids.length + ' workspaces closed');
    return true;
  }
  async function reopenWs(id){ if (C.reopen(ix, id)) { persist(); await switchTo(id); } }
  function reorder(ids){
    const by = new Map(ix.items.map((x) => [x.id, x]));
    const next = ids.map((x) => by.get(x)).filter(Boolean).concat(C.closedItems(ix));   // closed ones keep their place at the end
    if (next.length !== ix.items.length || next.every((x, i) => x === ix.items[i])) return;
    ix.items = next; C.pinFirst(ix.items); persist();
  }

  // ---------------------------------------------------------------- UI: top-bar button + list
  const btn = el('button', { type: 'button', class: 'stkc-btn stkws-btn', id: 'stkws-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Workspaces: switch, add and arrange whole screens' });
  const pop = el('div', { class: 'stkc-pop stkc-sheet stkws-pop', id: 'stkws-pop', role: 'dialog', 'aria-label': 'Workspaces', hidden: '' });
  const wrap = el('div', { class: 'stkc-menu stkws-menu' }, [btn, pop]);
  // Owner 15 Nov: workspaces live in the TOP bar right after the logo, as browser-style tabs.
  // Desktop: [layout icon ▾ = the menu] [tab][tab]… [+] [▾ overflow]. Phone: the same button is a "name ▾" pill.

  const strip = el('div', { class: 'stkws-strip', id: 'stkws-strip' });
  // phones hide the site top bar (the chart toolbar is the only bar): the pill starts the toolbar there (as before)
  const place = () => {
    const host = document.querySelector('.mobile-topnav .topnav-left');
    if (isPhone() || !host) barL.insertBefore(wrap, barL.firstChild);
    else { if (!strip.parentNode) host.appendChild(strip); strip.insertBefore(wrap, strip.firstChild); }
  };
  place(); window.addEventListener('resize', () => { if (wrap.parentNode !== (isPhone() ? barL : strip)) place(); });
  const setOpen = bindPopover(btn, pop, () => renderList());

  const live = el('div', { class: 'sr-only', 'aria-live': 'polite' });
  document.body.appendChild(live);
  function announce(name){ live.textContent = 'Workspace: ' + name; }

  function paintBtn(){
    const it = cur();
    btn.innerHTML = svg('ws', 16) + '<span class="stkws-name"></span>' + svg('chev', 12);
    btn.querySelector('.stkws-name').textContent = it.name;
    btn.setAttribute('aria-label', 'Workspaces. Current: ' + it.name);
  }

  function renderList(){
    pop.innerHTML = '';
    syncLayout(cur());
    try { cur().sub = C.subOf(screenState()); } catch (e) {}
    if (sheetHead) pop.appendChild(sheetHead(pop, 'Workspaces', C.openItems(ix).length + ' open' + (C.closedItems(ix).length ? ', ' + C.closedItems(ix).length + ' closed' : '') + ' · ' + (user() ? 'synced to your account' : 'on this device')));
    pop.appendChild(el('p', { class: 'stkc-pop-h stkws-h', text: 'Workspaces' }));
    const ul = el('ul', { class: 'stkws-list', role: 'listbox', 'aria-label': 'Workspaces' });
    const openL = C.openItems(ix);
    openL.forEach((it, i) => {
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
        if (to < 0 || to >= openL.length) return;
        if (C.move(ix, it.id, ix.items.indexOf(openL[to]))) { persist(); renderList(); const b = pop.querySelector('[data-id="' + it.id + '"] .stkws-row'); if (b) b.focus(); }
      });
      li.appendChild(grip); li.appendChild(row);
      dragSort(grip, li, ul, '.stkws-li', 'y');
      ul.appendChild(li);
    });
    pop.appendChild(ul);
    const shut = C.closedItems(ix);
    if (shut.length) {   // closed workspaces: saved, hidden from the tabs, one click brings one back
      pop.appendChild(el('div', { class: 'stkws-sep', role: 'separator' }));
      pop.appendChild(el('p', { class: 'stkc-pop-h stkws-h', text: 'Closed workspaces' }));
      const cl = el('ul', { class: 'stkws-list stkws-closed', role: 'list', 'aria-label': 'Closed workspaces' });
      shut.forEach((it) => {
        const li = el('li', { class: 'stkws-li stkws-cli', 'data-id': it.id });
        const row = el('button', { type: 'button', class: 'stkws-row', title: 'Reopen ' + it.name }, [
          el('span', { class: 'stkws-t' }, [el('span', { class: 'stkws-l', text: it.name }), it.sub ? el('small', { class: 'stkws-s', text: it.sub }) : null]),
          el('span', { class: 'stkws-reopen', text: 'Reopen' })]);
        row.addEventListener('click', () => { setOpen(false); reopenWs(it.id); });
        const del = el('button', { type: 'button', class: 'stkws-cdel', 'aria-label': 'Delete ' + it.name + '…', title: 'Delete…', html: svg('del', 16) });
        del.addEventListener('click', () => { setOpen(false); removeWs(it.id); });
        li.appendChild(row); li.appendChild(del); cl.appendChild(li);
      });
      pop.appendChild(cl);
    }
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
    item('Close', 'close', () => closeWs(ix.active), { disabled: C.openItems(ix).length <= 1 });
    item('Delete…', 'del', () => removeWs(ix.active), { danger: true, disabled: C.openItems(ix).length <= 1 });
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
  const tabs = el('div', { class: 'stkws-tabs', id: 'stkws-tabs', role: 'tablist', 'aria-label': 'Workspaces' });
  const tabRow = el('div', { class: 'stkws-tabrow' });
  const newWs = () => askName('New workspace', C.uniqueName(ix, 'Workspace ' + (ix.items.length + 1)), createNew);
  const plus = el('button', { type: 'button', class: 'stkws-plus', title: 'New workspace', 'aria-label': 'New workspace', html: svg('add', 16) });
  plus.addEventListener('click', newWs);
  const more = el('button', { type: 'button', class: 'stkws-more', title: 'More workspaces', 'aria-label': 'More workspaces', 'aria-haspopup': 'true', hidden: '', html: svg('chev', 14) });
  const morePop = el('div', { class: 'stkc-pop stkws-ctx stkws-morepop', role: 'menu', hidden: '' });
  tabs.appendChild(tabRow); tabs.appendChild(plus); tabs.appendChild(more);
  strip.appendChild(tabs);
  // small floating menu (right-click on a tab, and the overflow list)
  function ctxMenu(box, x, y, rows){
    box.innerHTML = '';
    rows.forEach((r) => {
      const b = el('button', { type: 'button', role: 'menuitem', class: 'stkws-ci' + (r.danger ? ' stkws-danger' : '') + (r.on ? ' on' : ''), text: r.label });
      if (r.disabled) b.disabled = true;
      b.addEventListener('click', () => { box.hidden = true; r.run(); });
      box.appendChild(b);
    });
    box.hidden = false;
    box.style.left = Math.max(4, Math.min(x, window.innerWidth - box.offsetWidth - 4)) + 'px';
    box.style.top = y + 'px';
    const off = (e) => { if (box.contains(e.target)) return; box.hidden = true; document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') off({ target: document.body }); };
    document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', esc, true);
  }
  const ctxBox = el('div', { class: 'stkc-pop stkws-ctx', role: 'menu', hidden: '' });
  document.body.appendChild(ctxBox); document.body.appendChild(morePop);
  more.addEventListener('click', () => {
    const r = more.getBoundingClientRect();
    ctxMenu(morePop, r.left, r.bottom + 4, C.openItems(ix).map((it) => ({ label: it.name, on: it.id === ix.active, run: () => switchTo(it.id) }))
      .concat(C.closedItems(ix).map((it) => ({ label: 'Reopen: ' + it.name, run: () => reopenWs(it.id) }))));
  });
  function fitTabs(){
    // overflow: tabs that do not fit are hidden; the ▾ lists every workspace
    const tt = [...tabRow.children];
    tt.forEach((t) => { t.hidden = false; });
    more.hidden = true;
    const room = tabs.clientWidth - plus.offsetWidth - 40;
    if (tabRow.scrollWidth <= room) return;
    more.hidden = false;
    const aIdx = tt.findIndex((t) => t.classList.contains('on'));
    let used = 0; const keep = new Set();
    const order = [aIdx, ...tt.map((_, i) => i).filter((i) => i !== aIdx)];
    order.forEach((i) => { const w = tt[i].offsetWidth + 2; if (used + w <= room) { used += w; keep.add(i); } });
    tt.forEach((t, i) => { t.hidden = !keep.has(i); });
  }
  function paintTabs(){
    tabRow.innerHTML = '';
    C.openItems(ix).forEach((it, i) => {
      const on = it.id === ix.active;
      const x = it.pinned ? null : el('span', { class: 'stkws-x', role: 'button', 'aria-label': 'Close workspace ' + it.name, title: 'Close (stays saved)', html: svg('close', 12) });
      const t = el('button', { type: 'button', class: 'stkws-tab' + (on ? ' on' : '') + (it.pinned ? ' pinned' : '') + (it.color ? ' c-' + it.color : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', 'data-id': it.id,
        title: it.name + (it.sub ? ' · ' + it.sub : '') + (i < 9 ? ' (' + keyName(i) + ')' : '') + '. Right-click for options. Double-click to rename, drag to reorder.' },
        [el('span', { class: 'stkws-gl', html: svg(it.glyph || 'globe', 16) }), el('span', { class: 'stkws-tn', text: it.name }), x]);
      t.dataset.dflt = ix.def === it.id ? '1' : '';
      t.addEventListener('click', (e) => { if (e.target.closest('.stkws-x')) { e.stopPropagation(); closeWs(it.id); return; } if (!dragged) switchTo(it.id); });
      t.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeWs(it.id); } });
      t.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
      t.addEventListener('dblclick', () => askName('Rename workspace', it.name, (n) => renameWs(it.id, n)));
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const r = t.getBoundingClientRect(), kb = e.detail === 0 && !e.clientX && !e.clientY;
        openMenu(it.id, kb ? r.left + 8 : e.clientX, kb ? r.bottom : e.clientY, kb);
      });
      t.addEventListener('keydown', (e) => {
        if (e.key === 'F2') { e.preventDefault(); askName('Rename workspace', it.name, (n) => renameWs(it.id, n)); }
        else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); stepWs(it.id, e.key === 'ArrowLeft' ? -1 : 1, true); }
      });
      dragSort(t, t, tabRow, '.stkws-tab', 'x');
      tabRow.appendChild(t);
    });
    fitTabs();
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }
  window.addEventListener('resize', () => { if (ix) fitTabs(); });
  let shownTabs = null;
  function paint(){
    paintBtn();
    const sig = JSON.stringify([ix.active, ix.items.map((x) => [x.id, x.name, x.sub, x.pinned, x.color, x.glyph, x.closed]), ix.def]);
    if (sig !== shownTabs) { shownTabs = sig; paintTabs(); }
    if (!pop.hidden) renderList();
  }


  // ---------------------------------------------------------------- UI: tab right-click menu (phone: long-press the pill -> bottom sheet)
  // Close hides a tab (kept saved); Delete is separate, with a confirm.
  async function stepWs(id, dir, keepFocus){
    if (!C.step(ix, id, dir)) return;
    persist();
    if (keepFocus) { const b = tabRow.querySelector('[data-id="' + id + '"]'); if (b) b.focus(); }
  }
  async function onIt(id){ if (ix.active !== id) await switchTo(id); return C.find(ix, id); }
  async function saveTemplate(id){
    const T = window.StrykerChartTemplates;
    if (!T) { toast('Templates are not available here.', 'error'); return; }
    if (safe()) { toast('Turn the indicators back on first, so the template has them.', 'error'); return; }
    const it = await onIt(id); if (!it) return;
    askName('Save as template', it.name, async (n) => {
      try { await T.save(n, screenState()); toast('Template saved. Find it in Templates.'); }
      catch (e) { toast((e && e.message) || 'Could not save the template.', 'error'); }
    });
  }
  async function shareLink(id){
    const it = await onIt(id); if (!it || !user()) return;
    if (!L.current && !L.viewing) { const r = await L.saveAsNew(it.name, { quiet: true }); if (r && r.id) { it.layoutId = r.id; it.layoutName = r.name; persist(); } }
    const c = L.current; if (!c) { toast('Could not make a link yet. Try again in a moment.', 'error'); return; }
    if (!c.shared) {
      if (!window.confirm('Turn on sharing for "' + it.name + '"? Anyone with the link can view it (read-only). You can turn it off any time from the layout menu.')) return;
      await L.setShared(true); return;   // copies the link itself
    }
    const url = L.linkOf(c.id);
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { window.prompt('Copy this link', url); }
  }
  async function resetLayout(id){
    const it = await onIt(id); if (!it) return;
    if (!window.confirm('Reset "' + it.name + '" to a single chart? The workspace stays.')) return;
    try { window.STRYKER_CHART_UI.setLayout('1'); } catch (e) { toast('Could not reset the layout.', 'error'); return; }
    setTimeout(() => { try { it.sub = C.subOf(screenState()); } catch (e) {} persist(); }, 600);
    toast('Layout reset to one chart');
  }
  function setLook(id, k, v){ const it = C.find(ix, id); if (!it) return; it[k] = it[k] === v ? '' : v; persist(); }

  let cm = null;   // the open menu: { box, close }
  function closeMenu(refocus){ if (cm) { const c = cm; cm = null; c.close(refocus); } }
  function menuModel(id){
    const it = C.find(ix, id), n = C.openItems(ix).length;
    const others = C.othersOf(ix, id), right = C.rightOf(ix, id);
    const ren = () => askName('Rename workspace', it.name, (nm) => renameWs(id, nm));
    const g = [];
    g.push([
      { label: it.pinned ? 'Unpin tab' : 'Pin tab', icon: it.pinned ? 'unpin' : 'pin', run: () => { C.setPinned(ix, id, !it.pinned); persist(); } },
      { label: ix.def === id ? 'Unset default workspace' : 'Set as default workspace', icon: 'home', run: () => { C.setDefault(ix, id); persist(); toast(ix.def === id ? 'Opens on load' : 'No default workspace'); } },
      { swatch: 'color', icon: 'palette', label: 'Tab colour', opts: C.COLORS, cur: it.color },
      { swatch: 'glyph', icon: 'ws', label: 'Tab icon', opts: C.GLYPHS, cur: it.glyph }]);
    const g2 = [
      { label: 'Rename', icon: 'rename', kbd: 'Double-click', run: ren },
      { label: 'Duplicate', icon: 'copy', run: async () => { await onIt(id); duplicate(); } },
      { label: 'Save as template…', icon: 'tpl', run: () => saveTemplate(id) }];
    if (user()) g2.push({ label: 'Copy share link', icon: 'share', run: () => shareLink(id) });
    g.push(g2);
    g.push([
      { label: 'Move left', icon: 'left', kbd: isMac ? '⌥←' : 'Alt+←', disabled: !C.canStep(ix, id, -1), run: () => stepWs(id, -1) },
      { label: 'Move right', icon: 'right', kbd: isMac ? '⌥→' : 'Alt+→', disabled: !C.canStep(ix, id, 1), run: () => stepWs(id, 1) },
      { label: 'Open in new window', icon: 'ext', run: () => { persist(); window.open(location.pathname + '?ws=' + encodeURIComponent(id), '_blank', 'noopener'); } }]);
    g.push([
      { label: 'Reset layout…', icon: 'reset', run: () => resetLayout(id) },
      { label: 'Close workspace', icon: 'close', disabled: n <= 1, run: () => closeWs(id) },
      { label: 'Close other workspaces', icon: 'close', disabled: !others.length || others.length >= n, run: () => closeMany(others) },
      { label: 'Close workspaces to the right', icon: 'close', disabled: !right.length || right.length >= n, run: () => closeMany(right) }]);
    g.push([
      { label: 'Delete other workspaces…', icon: 'close', disabled: !others.length || others.length >= n, run: () => removeMany(others, 'all except this one and pinned') },
      { label: 'Delete workspaces to the right…', icon: 'close', disabled: !right.length || right.length >= n, run: () => removeMany(right, 'to the right of this one') },
      { label: 'Delete workspace…', icon: 'del', danger: true, disabled: n <= 1, run: () => removeWs(id) }]);
    return g;
  }
  function openMenu(id, x, y, byKey){
    closeMenu(false);
    if (!C.find(ix, id)) return;
    const sheet = isPhone();
    const prevFocus = document.activeElement;
    const box = el('div', { class: 'stkws-cm' + (sheet ? ' sheet' : ''), role: 'menu', tabindex: '-1', 'aria-label': 'Workspace options: ' + C.find(ix, id).name });
    const rows = [];   // focusable rows, in order; a swatch row holds its own buttons
    menuModel(id).forEach((grp, gi) => {
      if (gi) box.appendChild(el('div', { class: 'stkws-cm-sep', role: 'separator' }));
      grp.forEach((r) => {
        const ic = el('span', { class: 'stkws-cm-ic', html: svg(r.icon, 16) });
        if (r.swatch) {
          const row = el('div', { class: 'stkws-cm-row stkws-cm-sw', role: 'group', 'aria-label': r.label }, [ic]);
          const sw = el('span', { class: 'stkws-cm-opts' });
          r.opts.forEach((o) => {
            const b = el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': r.cur === o ? 'true' : 'false', 'aria-label': r.label + ': ' + o, 'data-o': o,
              class: 'stkws-cm-o ' + (r.swatch === 'color' ? 'c-' + o + ' dot' : 'gl') + (r.cur === o ? ' on' : ''), tabindex: '-1',
              html: r.swatch === 'color' ? '<i></i>' : svg(o, 16) });
            b.addEventListener('click', () => { setLook(id, r.swatch, o); closeMenu(true); });
            sw.appendChild(b);
          });
          row.appendChild(sw); box.appendChild(row); rows.push({ sw: [...sw.children] });
          return;
        }
        const b = el('button', { type: 'button', role: 'menuitem', class: 'stkws-cm-row stkws-cm-it' + (r.danger ? ' danger' : ''), tabindex: '-1' },
          [ic, el('span', { class: 'stkws-cm-l', text: r.label }), r.kbd ? el('span', { class: 'stkws-cm-k', text: r.kbd }) : null]);
        if (r.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
        else b.addEventListener('click', () => { closeMenu(false); r.run(); });
        box.appendChild(b); if (!r.disabled) rows.push({ b });
      });
    });
    const scrim = el('div', { class: 'stkws-cm-scrim' + (sheet ? ' sheet' : '') });
    document.body.appendChild(scrim); document.body.appendChild(box);
    if (!sheet) {   // open at the cursor, flip / clamp so it stays on screen
      const w = box.offsetWidth, h = box.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      box.style.left = Math.max(8, Math.min(x, vw - w - 8)) + 'px';
      box.style.top = Math.max(8, y + h + 8 <= vh ? y : (y - h >= 8 ? y - h : vh - h - 8)) + 'px';
      box.style.transformOrigin = (x > vw - w - 8 ? 'right' : 'left') + ' ' + (y + h + 8 <= vh ? 'top' : 'bottom');
    }
    requestAnimationFrame(() => { box.classList.add('open'); scrim.classList.add('open'); });
    const focusRow = (k) => { const r = rows[k]; if (!r) return; (r.sw ? (r.sw.find((b) => b.classList.contains('on')) || r.sw[0]) : r.b).focus(); };
    const at = () => rows.findIndex((r) => r.sw ? r.sw.includes(document.activeElement) : r.b === document.activeElement);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
      if (e.key === 'Tab') { closeMenu(false); return; }
      const k = at();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); focusRow(k < 0 ? (e.key === 'ArrowDown' ? 0 : rows.length - 1) : (k + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length); }
      else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
      else if (e.key === 'End') { e.preventDefault(); focusRow(rows.length - 1); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && k >= 0 && rows[k].sw) {
        e.preventDefault(); const a = rows[k].sw, j = a.indexOf(document.activeElement); a[(j + (e.key === 'ArrowRight' ? 1 : -1) + a.length) % a.length].focus();
      }
    };
    const out = (e) => { if (!box.contains(e.target)) closeMenu(false); };
    const gone = () => closeMenu(false);
    box.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', out, true);
    window.addEventListener('resize', gone); window.addEventListener('blur', gone); window.addEventListener('scroll', gone, true);
    scrim.addEventListener('contextmenu', (e) => { e.preventDefault(); closeMenu(false); });
    const refocus = (rf) => { if (rf && prevFocus && prevFocus.isConnected) try { prevFocus.focus(); } catch (e) {} };
    cm = { box, close(rf) {
      document.removeEventListener('pointerdown', out, true);
      window.removeEventListener('resize', gone); window.removeEventListener('blur', gone); window.removeEventListener('scroll', gone, true);
      box.classList.remove('open'); scrim.classList.remove('open');
      refocus(rf);
      const rm = () => { box.remove(); scrim.remove(); };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) rm(); else setTimeout(rm, 160);
    } };
    (byKey ? () => focusRow(0) : () => box.focus({ preventScroll: true }))();
  }
  // phone: long-press the workspace pill -> the same menu as a bottom sheet (a tap still opens the list)
  let lp = null, lpFired = false;
  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !isPhone()) return;
    lpFired = false; clearTimeout(lp);
    lp = setTimeout(() => { lpFired = true; setOpen(false); openMenu(ix.active, 0, 0, false); }, 480);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => btn.addEventListener(n, () => clearTimeout(lp)));
  btn.addEventListener('click', (e) => { if (lpFired) { lpFired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  btn.addEventListener('contextmenu', (e) => { if (isPhone()) { e.preventDefault(); if (!cm) { setOpen(false); openMenu(ix.active, 0, 0, false); } } });

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
    const op = ix ? C.openItems(ix) : [];
    if (i < 0 || i >= op.length) return;
    e.preventDefault(); e.stopPropagation();
    switchTo(op[i].id);
  }, true);
  window.addEventListener('beforeunload', () => {
    if (!ix) return;
    const it = cur(); syncLayout(it);
    if (!isPhone()) it.panels = capturePanels();
    try { it.sub = C.subOf(screenState()); } catch (e) {}
    try { if (!busy) { ws.persistNow && ws.persistNow(); stampMe(); snapNow(); } } catch (e) {}   // the engine's saved screen = this workspace's chart, even when closed within its 0.5 s write delay
    const s = C.serialize(Object.assign({}, ix, { t: Date.now() }));
    if (s) { try { localStorage.setItem(K.ix(), s); } catch (e) {} }
  });

  // Another tab changed the shared workspace list (names, layout ids, new / deleted workspaces): take its list but keep
  // THIS tab's active workspace, so our next persist() does not write a stale copy over its changes.
  window.addEventListener('storage', (e) => {
    if (!ix || e.key !== K.ix() || !e.newValue) return;
    const r = C.sanitize(e.newValue);
    if (!r || r.t <= ix.t || !C.find(r, ix.active)) return;
    const here = C.find(r, ix.active), mine = cur();
    Object.assign(here, { layoutId: mine.layoutId, layoutName: mine.layoutName, shared: mine.shared, closed: false });
    r.active = ix.active; ix = r; paint();
  });

  // ---------------------------------------------------------------- boot
  const saved = C.sanitize(lsGet(K.ix()));
  ix = saved || C.fresh('Workspace 1', user() ? L.current : null);   // fresh: t = 0, so any account copy wins over it
  if (!C.find(ix, ix.active)) ix.active = ix.items[0].id;
  // Which workspace does THIS tab have open? The index is shared by every tab of the browser (last writer wins), so a
  // tab used on workspace 2 would reopen on whatever another tab left active. The tab's own choice wins.
  let tabId = null; try { tabId = sessionStorage.getItem(K.tab()); } catch (e) {}
  if (saved && tabId && C.find(ix, tabId)) ix.active = tabId;
  // The engine's saved screen and the open layout are also shared per browser. When they were last written for another
  // workspace than the one opening now, they are NOT this workspace's chart: restore its own document instead of
  // treating the screen as its own (that is how workspace 2 ended up showing, and then saving over, workspace 1).
  const scr = saved ? lsGet(K.scr()) : null;
  let noScreen = false; try { noScreen = !!window.__stkPersistKey && !localStorage.getItem(window.__stkPersistKey); } catch (e) {}
  const lay = user() && L.current ? L.current.id : null;   // the open layout (also one per browser) is another workspace's
  let snap = null; try { snap = JSON.parse(sessionStorage.getItem(K.snap()) || 'null'); } catch (e) {}
  if (!snap || snap.ws !== ix.active || !snap.st || typeof snap.st !== 'object') snap = null;
  let stamp = null; try { stamp = localStorage.getItem(K.stamp()); } catch (e) {}
  // another tab changed the shared screen after this one did (or no tab did since this one opened): not this tab's chart
  const otherTab = !!stamp && stamp !== myTab;
  const foreign = !!saved && (noScreen || otherTab || (typeof scr === 'string' && scr !== ix.active && !!C.find(ix, scr)) || (!!lay && ix.items.some((x) => x.id !== ix.active && x.layoutId === lay)));
  if (!foreign) { syncLayout(cur()); markScreen(ix.active); stampMe(); }
  paint();
  if (saved) persist();
  if (foreign) {
    const it = cur();
    busy = (async () => {
      let r; try { r = await load(it); } catch (e) { r = { doc: defaultDoc(), meta: null, fresh: true }; }
      if (ix.active !== it.id) return;
      // this tab's own last screen beats the workspace's saved copy (it can be seconds newer than the autosave)
      if (snap) r = { doc: snap.st, meta: r.meta || (it.layoutId ? { id: it.layoutId, name: it.layoutName || it.name, shared: !!it.shared } : null) };
      // nothing of this workspace saved anywhere and no snapshot: keep what is on screen rather than replace it with a blank chart
      else if (r.fresh) { markScreen(it.id); stampMe(); return; }
      L.adopt(r.doc, r.meta);
      if (r.meta) { it.layoutId = r.meta.id; it.layoutName = r.meta.name; it.shared = !!r.meta.shared; }
      docs.set(it.id, r.doc); markScreen(it.id); stampMe();
      if (!isPhone()) applyPanels(it.panels);
      persist();
    })().finally(() => { busy = null; });
  }
  // signed in: the account copy wins when it is newer (another device changed the list)
  if (user()) {
    remoteRef().get().then((d) => {
      setTimeout(bootDefault, 400);
      remoteRead = true;
      const r = d && d.exists ? C.sanitize((d.data() || {}).index) : null;
      if (!r || C.pickNewer(ix, r) !== r) { persist(); return; }
      const here = C.find(r, ix.active);
      if (here) { r.active = ix.active; here.closed = false; Object.assign(here, { layoutId: cur().layoutId, layoutName: cur().layoutName, shared: cur().shared }); ix = r; persist(); return; }
      const target = r.active; ix = r; ix.active = null;
      // the screen belongs to a workspace this account no longer has: open the account's active one (no save: it was not ours)
      (async () => { const it = C.find(ix, target) || ix.items[0]; ix.active = it.id; const x = await load(it); L.adopt(x.doc, x.meta); markScreen(it.id); persist(); })();
    }).catch((e) => console.warn('TradeZoro: workspaces sync', e && e.code));
  }

  // "Set as default workspace": it opens on load (once, after the account copy is read)
  let defDone = false;
  const bootDefault = () => { if (defDone) return; defDone = true; const q = new URLSearchParams(location.search).get('ws'), to = C.find(ix, q) ? q : ix.def;   // ?ws=<id> (Open in new window) beats the default
    if (ix && to && to !== ix.active && C.find(ix, to)) switchTo(to); };
  if (user()) setTimeout(() => { if (!defDone) bootDefault(); }, 2500); else setTimeout(bootDefault, 0);

  const api = { switchTo, openMenu, closeMenu, removeMany, saveTemplate, createNew, duplicate, rename: renameWs, remove: removeWs, close: closeWs, reopen: reopenWs, reorder,
    get index(){ return JSON.parse(JSON.stringify(ix)); }, get active(){ return cur(); }, get cached(){ return docs.keys(); },
    get busy(){ return !!busy; }, capturePanels };
  window.STRYKER_WORKSPACES = api;
  return api;
}
