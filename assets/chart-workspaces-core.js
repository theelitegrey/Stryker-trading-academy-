// TradeZoro — Charts WORKSPACES: pure logic (no DOM, no Firebase). ES module.
// Used by assets/chart-workspaces.js; unit tests: tools/tests/chart-workspaces.test.mjs.
//
// A WORKSPACE is the whole screen: the chart document (grid, every chart's symbol, interval,
// indicators, drawings: the same Vela state a LAYOUT saves) plus the open side panels and their
// widths. The chart document lives in the layout system (signed in: students/{uid}/chartLayouts,
// one layout per workspace; signed out: this device). This file only handles the INDEX: an
// ordered list of workspaces { id, name, layoutId, layoutName, panels, sub } + the active id.

export const MAX = 12;          // workspaces per member
export const NAME_MAX = 40;
export const INDEX_MAX = 20000; // chars of the stored index (Firestore rules cap)
export const CACHE_N = 3;       // chart documents kept in memory for instant switching
export const PANEL_IDS = ['watchlist', 'book', 'news', 'gex', 'info', 'darkpool', 'heatmap'];

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
  return {
    id: x.id, name,
    layoutId: LID_RE.test(String(x.layoutId || '')) ? x.layoutId : null,
    layoutName: x.layoutId ? String(x.layoutName || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60) : '',
    shared: !!(x.layoutId && x.shared === true),   // the layout's share switch, so a save after switching back keeps it
    panels: cleanPanels(x.panels),
    sub: String(x.sub || '').slice(0, 60)
  };
}

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
  const active = seen.has(o.active) ? o.active : items[0].id;
  return { v: 1, active, items, t: Number.isFinite(+o.t) ? +o.t : 0 };
}

export function fresh(name, layout){
  const id = newId();
  return { v: 1, active: id, t: 0, items: [cleanItem({ id, name: cleanName(name) || 'Workspace 1', layoutId: layout ? layout.id : null, layoutName: layout ? layout.name : '', shared: !!(layout && layout.shared), panels: null, sub: '' })] };
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
// Delete: never the last one. Returns the id to switch to when the active one went (else null), or false.
export function remove(ix, id){
  if (ix.items.length <= 1) return false;
  const i = ix.items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  ix.items.splice(i, 1);
  if (ix.active !== id) return null;
  const next = ix.items[Math.min(i, ix.items.length - 1)].id;
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
  const s = JSON.stringify({ v: 1, active: ix.active, t: ix.t || 0, items: ix.items });
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
