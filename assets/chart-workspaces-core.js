// TradeZoro — Charts WORKSPACES: pure logic (no DOM, no Firebase). ES module.
// Used by assets/chart-workspaces.js; unit tests: tools/tests/chart-workspaces.test.mjs.
//
// A WORKSPACE is the whole screen: the chart document (grid, every chart's symbol, interval,
// indicators, drawings: the same Vela state a LAYOUT saves) plus the open side panels and their
// widths. The chart document lives in the layout system (signed in: students/{uid}/chartLayouts,
// signed out: this device). This file only handles the INDEX: an ordered list of workspaces
// { id, name, wsDoc, layoutId, layoutName, panels, sub } + the active id.
// Owner 17 Nov ("layouts are different stuff and workspace is different stuff"): two separate ids per workspace.
//   wsDoc    = the workspace's OWN chart doc (students/{uid}/chartLayouts, kind 'workspace'). Never listed as a layout.
//   layoutId = a real saved LAYOUT the member opened or saved inside this workspace (null when none).
// Older indexes kept the own doc in layoutId; migrate() moves it to wsDoc once (see below).

export const MAX = 12;          // workspaces per member
export const NAME_MAX = 40;
export const INDEX_MAX = 20000; // chars of the stored index (Firestore rules cap)
export const CACHE_N = 3;       // chart documents kept in memory for instant switching
export const PANEL_IDS = ['watchlist', 'book', 'news', 'gex', 'info', 'darkpool', 'heatmap'];

// tab colour + glyph choices (stored as these keys only; anything else is dropped)
export const COLORS = ['blue', 'green', 'red', 'amber', 'purple', 'teal'];
export const GLYPHS = ['globe', 'star', 'bolt', 'chart', 'flame', 'target'];

const ID_RE = /^w[a-z0-9]{4,16}$/;
const LID_RE = /^[A-Za-z0-9]{10,40}$/;

export const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
export function newId(rnd){
  rnd = rnd || Math.random;
  let s = 'w';
  for (let i = 0; i < 8; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 36)];
  return s;
}

// panels: { open: [ids], w: { watchlist: px, book: px } } — only known ids and sane widths survive
export function cleanPanels(p){
  const out = { open: [], w: {} };
  if (!p || typeof p !== 'object') return out;
  (Array.isArray(p.open) ? p.open : []).forEach((x) => { if (PANEL_IDS.includes(x) && !out.open.includes(x)) out.open.push(x); });
  const w = p.w && typeof p.w === 'object' ? p.w : {};
  ['watchlist', 'book'].forEach((k) => { const n = Math.round(+w[k]); if (Number.isFinite(n) && n >= 160 && n <= 1200) out.w[k] = n; });
  return out;
}
export const samePanels = (a, b) => JSON.stringify(cleanPanels(a)) === JSON.stringify(cleanPanels(b));

function cleanItem(x){
  if (!x || typeof x !== 'object' || !ID_RE.test(String(x.id))) return null;
  const name = cleanName(x.name);
  if (!name) return null;
  x = migrate(x);
  return {
    id: x.id, name,
    wsDoc: LID_RE.test(String(x.wsDoc || '')) ? x.wsDoc : null,
    layoutId: LID_RE.test(String(x.layoutId || '')) ? x.layoutId : null,
    layoutName: x.layoutId ? String(x.layoutName || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60) : '',
    shared: !!(x.layoutId && x.shared === true),   // the layout's share switch, so a save after switching back keeps it
    panels: cleanPanels(x.panels),
    sub: String(x.sub || '').slice(0, 60),
    pinned: x.pinned === true,
    closed: x.closed === true,   // closed tab: kept saved, listed under "Closed workspaces", reopened from the menu
    color: COLORS.includes(x.color) ? x.color : '',
    glyph: GLYPHS.includes(x.glyph) ? x.glyph : ''
  };
}

// One-time backfill for indexes written before wsDoc existed (no wsDoc key at all): the layout a workspace made for itself
// was saved under the workspace's name and renamed along with it, so layoutName === name marks it as the workspace's own
// doc. A real layout the member opened / saved into the workspace has its own name and stays a layout.
// (A member's real layout literally named like the workspace is read as the workspace's doc: still shown in that workspace.)
export function migrate(x){
  if (!x || typeof x !== 'object' || 'wsDoc' in x) return x;
  const own = !!x.layoutId && cleanName(x.layoutName) === cleanName(x.name);
  return own ? Object.assign({}, x, { wsDoc: x.layoutId, layoutId: null, layoutName: '', shared: false }) : Object.assign({}, x, { wsDoc: null });
}
// every workspace's own doc id (these are never shown as layouts)
// (+ `hid`: the docs of deleted workspaces, kept in the account but still not layouts)
export const wsDocIds = (ix) => (ix && Array.isArray(ix.items) ? ix.items.map((x) => x.wsDoc).filter(Boolean).concat(Array.isArray(ix.hid) ? ix.hid : []) : []);
export const HID_MAX = 60;
const cleanHid = (a) => [...new Set((Array.isArray(a) ? a : []).filter((x) => LID_RE.test(String(x || ''))))].slice(-HID_MAX);

// Untrusted (localStorage / Firestore) -> a valid index, or null when nothing usable is in it.
export function sanitize(raw){
  let o = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return null; } }
  if (!o || typeof o !== 'object' || !Array.isArray(o.items)) return null;
  const seen = new Set(), items = [];
  for (const x of o.items) {
    const c = cleanItem(x);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id); items.push(c);
    if (items.length >= MAX) break;
  }
  if (!items.length) return null;
  if (items.every((x) => x.closed)) items[0].closed = false;   // never a screen with no open workspace
  const active = (items.find((x) => x.id === o.active && !x.closed) || items.find((x) => !x.closed)).id;
  pinFirst(items);
  return { v: 1, active, items, def: seen.has(o.def) ? o.def : '', t: Number.isFinite(+o.t) ? +o.t : 0, hid: cleanHid(o.hid) };
}
// pinned tabs always sit left (stable: order inside each group is kept)
export function pinFirst(items){
  const a = items.filter((x) => x.pinned), b = items.filter((x) => !x.pinned);
  items.splice(0, items.length, ...a, ...b);
  return items;
}
export function setPinned(ix, id, on){
  const it = find(ix, id); if (!it) return false;
  it.pinned = !!on; pinFirst(ix.items); return true;
}
// Move one step inside its own group (pinned never cross unpinned). Returns true when it moved.
const stepTo = (ix, i, dir) => { let j = i + dir; while (ix.items[j] && ix.items[j].closed) j += dir; return j; };   // closed tabs are skipped
export function step(ix, id, dir){
  const i = ix.items.findIndex((x) => x.id === id); if (i < 0) return false;
  const j = stepTo(ix, i, dir < 0 ? -1 : 1), o = ix.items[j];
  if (!o || o.pinned !== ix.items[i].pinned) return false;
  [ix.items[i], ix.items[j]] = [o, ix.items[i]]; return true;
}
export const canStep = (ix, id, dir) => { const i = ix.items.findIndex((x) => x.id === id), o = i < 0 ? null : ix.items[stepTo(ix, i, dir < 0 ? -1 : 1)]; return !!o && o.pinned === ix.items[i].pinned; };
// open / closed views of the index (items keeps both; a closed workspace keeps its place and its saved chart)
export const openItems = (ix) => ix.items.filter((x) => !x.closed);
export const closedItems = (ix) => ix.items.filter((x) => x.closed);
// Close a tab without deleting it. Never the last open one. Returns the id to show next when the active one closed (else null), or false.
export function close(ix, id){
  const open = openItems(ix), i = open.findIndex((x) => x.id === id);
  if (i < 0 || open.length <= 1) return false;
  find(ix, id).closed = true;
  if (ix.active !== id) return null;
  ix.active = (open[i + 1] || open[i - 1]).id;
  return ix.active;
}
export function reopen(ix, id){ const it = find(ix, id); if (!it || !it.closed) return false; it.closed = false; return true; }
// ids "Close other tabs" / "Close tabs to the right" would delete: never the tab itself, never a pinned tab
export const othersOf = (ix, id) => ix.items.filter((x) => x.id !== id && !x.pinned && !x.closed).map((x) => x.id);
export function rightOf(ix, id){
  const i = ix.items.findIndex((x) => x.id === id);
  return i < 0 ? [] : ix.items.slice(i + 1).filter((x) => !x.pinned && !x.closed).map((x) => x.id);
}
export function setDefault(ix, id){ ix.def = ix.def === id ? '' : (find(ix, id) ? id : ix.def); return ix.def; }

export function fresh(name, layout){
  const id = newId();
  return { v: 1, active: id, def: '', t: 0, hid: [], items: [cleanItem({ id, name: cleanName(name) || 'Workspace 1', wsDoc: null, layoutId: layout ? layout.id : null, layoutName: layout ? layout.name : '', shared: !!(layout && layout.shared), panels: null, sub: '' })] };
}

export const find = (ix, id) => ix.items.find((x) => x.id === id) || null;
export const activeItem = (ix) => find(ix, ix.active) || ix.items[0];

// a name that is not already used ("NQ scalping" -> "NQ scalping 2")
export function uniqueName(ix, want){
  const base = cleanName(want) || 'Workspace';
  const used = new Set(ix.items.map((x) => x.name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) { const n = (base.slice(0, NAME_MAX - 3) + ' ' + i); if (!used.has(n.toLowerCase())) return n; }
  return base;
}

// Returns the new item, or null at the limit.
export function add(ix, name, extra){
  if (ix.items.length >= MAX) return null;
  const it = cleanItem(Object.assign({ id: newId(), name: uniqueName(ix, name), panels: { open: [], w: {} } }, extra || {}, { name: uniqueName(ix, name) }));
  if (!it) return null;
  let id = it.id; while (find(ix, id)) id = newId();
  it.id = id;
  ix.items.push(it);
  return it;
}
export function rename(ix, id, name){
  const it = find(ix, id), n = cleanName(name);
  if (!it || !n) return false;
  it.name = n; return true;
}
// Delete: never the last open one. Returns the id to switch to when the active one went (else null), or false.
export function remove(ix, id){
  const i = ix.items.findIndex((x) => x.id === id);
  if (i < 0 || ix.items.length <= 1) return false;
  if (ix.active === id && openItems(ix).length <= 1) return false;
  const [gone] = ix.items.splice(i, 1);
  if (gone.wsDoc) ix.hid = cleanHid((ix.hid || []).concat(gone.wsDoc));   // its chart doc stays in the account, still not a layout
  if (ix.def === id) ix.def = '';
  if (ix.active !== id) return null;
  const open = openItems(ix), next = (open.find((x) => ix.items.indexOf(x) >= i) || open[open.length - 1]).id;
  ix.active = next;
  return next;
}
// Drag to reorder: move item `id` to position `to` (0-based, in the list after removal).
export function move(ix, id, to){
  const i = ix.items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [it] = ix.items.splice(i, 1);
  to = Math.max(0, Math.min(ix.items.length, Math.round(+to) || 0));
  ix.items.splice(to, 0, it);
  return i !== to;
}

// Ctrl/Cmd + 1..9 -> workspace index, or -1. Shift/Alt combos are left to other shortcuts.
export function hotkeyIndex(e){
  if (!e || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return -1;
  const m = /^Digit([1-9])$/.exec(e.code || '') || /^([1-9])$/.exec(e.key || '');
  return m ? +m[1] - 1 : -1;
}

// "NQ1! · 15m · 2 charts" from a Vela state document
export function subOf(st){
  const ch = st && Array.isArray(st.charts) ? st.charts.filter(Boolean) : [];
  if (!ch.length) return '';
  const a = ch.find((c) => c.id === st.activeCellId) || ch[0];
  const sym = String(a.symbol || '').replace(/^[a-z]+:/i, '');
  let tf = String(a.timeframe || '');
  if (/^\d+$/.test(tf)) { const n = +tf; tf = n % 60 === 0 && n >= 60 ? (n / 60) + 'h' : n + 'm'; }
  const n = layoutCount(st, ch.length);
  return [sym, tf, n > 1 ? n + ' charts' : ''].filter(Boolean).join(' · ').slice(0, 60);
}
// charts actually on screen: the grid id says it ("2h", "4", "3l"...); Vela keeps extra pooled charts in the list
function layoutCount(st, fallback){
  const m = /^(\d+)/.exec(String(st.layout || ''));
  return m ? Math.min(+m[1], fallback) : fallback;
}

// Local vs account copy: the newer one wins (t = ms of the last change on the device that wrote it).
export function pickNewer(local, remote){
  if (!remote) return local;
  if (!local) return remote;
  return (remote.t || 0) > (local.t || 0) ? remote : local;
}

export function serialize(ix){
  const s = JSON.stringify({ v: 1, active: ix.active, def: ix.def || '', t: ix.t || 0, items: ix.items, hid: cleanHid(ix.hid) });
  return s.length <= INDEX_MAX ? s : null;
}

// Small LRU of chart documents (id -> state), so the last few workspaces switch without a fetch.
export function lru(n){
  const m = new Map();
  return {
    get(k){ if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v){ m.delete(k); m.set(k, v); while (m.size > n) m.delete(m.keys().next().value); },
    has: (k) => m.has(k), delete: (k) => m.delete(k), keys: () => [...m.keys()], get size(){ return m.size; }
  };
}
