// TradeZoro — Charts LAYOUT MENU (charts.html) — ES module
// Depends on: firebase compat SDKs (app/auth/firestore) + assets/auth.js; the Vela
// workspace (window.STRYKER_VELA) and helpers handed in by assets/vela-chart.js
// (bindPopover, toast, ui = window.STRYKER_CHART_UI, grid, Pine); assets/chart-pine-guard.js
// (window.StrykerPineGuard); style.css (.stkl-*).
//
// Owner order 2026-10-06 ("Build all"): a pro-charting layout menu.
//   Save layout (Ctrl/Cmd+S) · Autosave (default ON, 2 s after any change) · Make a copy… ·
//   Rename… · Create new layout… · Open layout… (search, symbol + interval, last modified,
//   delete) · Recently used (last 5) · Share layout + Copy link · Download chart data… (CSV)
//
// A LAYOUT is a whole saved chart: the Vela workspace document (getState/applyState, the
// same document templates save). TEMPLATES stay reusable style/indicator presets.
//
// Storage (rules: functions-src/firestore.rules, chartLayouts + chartShared blocks):
//   students/{uid}/chartLayouts/{id}  { name 1-60, state <= 900000 chars: JSON, or 'tz1:'+base64(gzip(JSON)) when
//                                       the JSON is over 200000 (assets/chart-state-codec.js), symbol,
//                                       interval, shared bool, updatedAt }   owner only
//     The same collection also holds each WORKSPACE's own chart doc (assets/chart-workspaces.js): kind 'workspace',
//     ws = workspace id. Owner 17 Nov: "layouts are different stuff and workspace is different stuff": those docs are never
//     a layout here (no Recently used, Open layout, Library, counts, share). isWs() also hides the ones written before the
//     kind field existed, by the workspace index (setHidden).
//   chartShared/{id}                  { ownerUid, name, state, updatedAt }
//     id = the layout's own random 20-char Firestore id. Any signed-in member may GET it by
//     id (never list). Only the owner writes it. Share OFF deletes it, so the link dies.
// The shared link is charts?layout=<id>. It opens READ-ONLY: autosave and Vela's own
// localStorage persistence are paused, so neither the owner's copy nor the viewer's own
// session is changed; "Make a copy" saves it into the viewer's own layouts.
//
// SAFETY: a shared layout is someone else's document. Before applying it, Pine entries
// (ext 'stryker.pine') that fail StrykerPineGuard are dropped and none may run on the
// in-page engine (see assets/chart-pine-guard.js for why).
//
// Futures bars come from Yahoo Finance via /api/chart/bars, so the CSV dialog says
// "For personal use."
//
// LAYOUT LINKS (Owner feature 17 Nov 2026, roadmap "layout-links"): every saved layout gets one permanent
// 8-character id (assets/chart-layout-slug.js), e.g. VMW7HYSI, and the address bar shows /charts/<ID> while it is
// open (history.replaceState, no reload; _redirects serves /charts/* as the charts page, and charts.html has
// <base href="/"> so its relative URLs still load from the site root).
//   students/{uid}/chartLayouts/{id}.slug   the id. Written ONCE by ensureSlug() (a slug-only update the rules allow
//                                           without touching updatedAt), never changed after; rename keeps it.
//   chartLinks/{ID}                         { ownerUid, lid, createdAt }: the lookup /charts/<ID> resolves with. Any
//                                           signed-in member may GET one (never list); create-once, owner deletes.
// Existing layouts get their id the first time they are opened or saved. The id is written separately from the
// layout save, so a layout save never depends on it (with the old rules the id simply is not created yet).
// Signed out: the chart on this device gets an id kept in localStorage; on sign-in it moves to the account (same id)
// as a saved layout. /charts/<ID> opens: your own layout -> open, editable; another member's layout shared by link,
// or a public/community layout you may use -> read-only, like ?layout=; anything else -> your chart + a toast.

const NAME_MAX = 60;
const STATE_MAX = 900000;   // chars of the STORED string (rules cap). Big states are gzip-compressed first (assets/chart-state-codec.js).
const MAX_COUNT = 50;
const AUTOSAVE_MS = 2000;
const RECENT_MAX = 5;

function fb(){ return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null; }
function user(){ const f = fb(); try { return f && f.auth().currentUser; } catch (e) { return null; } }
function db(){ return fb().firestore(); }
function col(){ return db().collection('students').doc(user().uid).collection('chartLayouts'); }
function sharedDoc(id){ return db().collection('chartShared').doc(id); }
function linkDoc(s){ return db().collection('chartLinks').doc(s); }
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const tsMs = (v) => (v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const codec = () => window.StrykerStateCodec;
// stored state string (plain JSON or compressed) -> object, null when unreadable
export async function decodeState(s){
  if (codec()) return codec().decode(s);
  try { return JSON.parse(s); } catch (e) { return null; }
}
// JSON string -> stored string. Throws err.userMessage past STATE_MAX.
async function encodeState(json, setup){
  // a published SETUP stays plain JSON: the rules read it to refuse drawings in a setup
  if (codec() && !setup) return codec().encode(json);
  if (json.length > STATE_MAX) { const e = new Error('big'); e.big = true; e.userMessage = 'This layout is very large (' + Math.round(json.length / 1024) + ' KB) and could not be saved to your account. A copy is kept on this device.'; throw e; }
  return json;
}
export { encodeState };

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
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
function tfLabel(tf){
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) { const n = +tf; return n % 60 === 0 && n >= 60 ? (n / 60) + 'h' : n + 'm'; }
  return tf;
}
const symLabel = (s) => String(s || '').replace(/^[a-z]+:/i, '');
import { genSlug, isSlug, slugFromPath, isChartsPath } from './chart-layout-slug.js?v=1093';
function ago(ms){
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Panes and indicators of a saved workspace, for the library cards (volume is the default, not counted).
export function countOf(st){
  const ch = st && Array.isArray(st.charts) ? st.charts : [];
  let n = 0;
  ch.forEach((c) => {
    const i = (c && c.indicators) || {};
    n += (i.natives || []).filter((x) => x !== 'volume' && !(x && x.type === 'volume')).length + (i.manifest || []).length;
    const p = c && c.ext && c.ext['stryker.pine'];
    if (Array.isArray(p)) n += p.length;
  });
  return { panes: Math.max(1, Math.min(16, ch.length)), indicators: Math.min(200, n) };
}
// Card thumbnail: the active chart as a small webp data URL (<= 45000 chars; rules cap it at 60000). '' when unavailable.
export function thumbOf(cell){
  try {
    const src = cell.screenshotCanvas();
    if (!src || !src.width) return '';
    const w = 320, h = Math.max(1, Math.round(w * src.height / src.width));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    for (const q of [0.6, 0.4, 0.25]) { const u = c.toDataURL('image/webp', q); if (u.startsWith('data:image/webp') && u.length <= 45000) return u; }
  } catch (e) {}
  return '';
}

// ---------------------------------------------------------------- shared-doc safety
export function sanitizeShared(doc){
  if (!doc || typeof doc !== 'object') return null;
  const guard = window.StrykerPineGuard;
  const ok = (src) => { try { return !!(guard && guard.check(src).ok); } catch (e) { return false; } };
  let dropped = 0;
  (Array.isArray(doc.charts) ? doc.charts : []).forEach((c) => {
    if (!c || !c.ext || !Array.isArray(c.ext['stryker.pine'])) return;
    c.ext['stryker.pine'] = c.ext['stryker.pine'].filter((x) => {
      // a built-in by reference ({ builtin: id }, no source): the script is our own file, loaded from this site
      if (x && typeof x.source !== 'string' && typeof x.builtin === 'string' && /^[a-z0-9-]{2,80}$/.test(x.builtin)) return true;
      if (!x || typeof x.source !== 'string' || !ok(x.source)) { dropped++; return false; }
      delete x.engine;          // never the in-page engine
      return true;
    });
    if (!c.ext['stryker.pine'].length) delete c.ext['stryker.pine'];
  });
  return { doc, dropped };
}

// ---------------------------------------------------------------- CSV
export function chartCsv(cell, tz, withInd){
  const orch = cell.chart.orchestrator;
  const bars = (orch && (orch.bars && orch.bars.length ? orch.bars : orch.rawBars)) || [];
  const vr = cell.chart.getVisibleRange();
  const vis = vr ? bars.filter((b) => b.time >= vr.from && b.time <= vr.to) : bars.slice();
  const cols = [];
  if (withInd) {
    try {
      for (const rec of orch.registry.all()) {
        const m = rec.model;
        if (!m || rec.hidden) continue;
        (m.series || []).forEach((s) => {
          if (!Array.isArray(s.points)) return;
          const map = new Map();
          s.points.forEach((p) => { if (p && p.value != null && Number.isFinite(p.value)) map.set(p.time, p.value); });
          if (!map.size) return;
          const t = String(m.title || rec.title || 'Indicator') + (s.title && s.title !== m.title ? ': ' + s.title : '');
          cols.push({ title: t, map });
        });
      }
    } catch (e) { /* indicator values are a best effort */ }
  }
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Etc/UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch (e) { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Etc/UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  const when = (t) => fmt.format(new Date(t)).replace(',', '');
  const q = (s) => { s = String(s); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; };
  const lines = [['time (' + (tz || 'UTC') + ')', 'open', 'high', 'low', 'close', 'volume'].concat(cols.map((c) => c.title)).map(q).join(',')];
  vis.forEach((b) => {
    const row = [when(b.time), b.open, b.high, b.low, b.close, b.volume != null ? b.volume : ''];
    cols.forEach((c) => { const v = c.map.get(b.time); row.push(v == null ? '' : v); });
    lines.push(row.join(','));
  });
  return { csv: lines.join('\n') + '\n', rows: vis.length, indCols: cols.length };
}

// ---------------------------------------------------------------- the menu
export function mountLayouts(ws, o){
  const { barL, bindPopover, toast, ui, grid, Pine } = o;
  const uid = () => (user() ? user().uid : 'guest');
  const K = { cur: () => 'stryker_chart_layout_cur_' + uid(), recent: () => 'stryker_chart_layout_recent_' + uid(), auto: () => 'stryker_chart_layout_auto_' + uid() };

  let cur = null;          // { id, name, shared, updatedAt, slug }
  let viewing = null;      // { id, name, ownerUid, slug } while a shared link is open read-only
  let dirty = false;
  let saving = null;
  let autoTimer = null;
  let suppress = 0;        // ignore state:changed bursts caused by our own applyState
  let cache = null;        // last list
  let migrating = null;    // a signed-out chart's link id, kept in the address bar until it moves to the account
  let pendingLink = null;  // a /charts/<ID> link a signed-out visitor opened: kept so sign-in comes back to it
  let fromLink = false;    // this page load opened a layout named by its address (/charts/<ID>, ?layout=, ?openlayout=)

  // ---- toolbar button + menu ----
  const btn = el('button', { type: 'button', class: 'stkc-btn stkl-btn', id: 'stkl-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    title: 'Layout menu: save, share and open whole charts' });
  const pop = el('div', { class: 'stkc-pop stkc-sheet stkl-pop', id: 'stkl-pop', role: 'menu', 'aria-label': 'Layout', hidden: '' });
  const wrap = el('div', { class: 'stkc-menu stkl-menu' }, [btn, pop]);
  barL.insertBefore(wrap, barL.firstChild);
  const setOpen = bindPopover(btn, pop, () => renderMenu());

  function paintBtn(){
    const name = viewing ? viewing.name : (cur ? cur.name : 'Unsaved layout');
    btn.innerHTML = '<span class="stkl-name">' + '</span>' + (dirty && cur && !viewing ? '<i class="stkl-dot" title="Unsaved changes"></i>' : '') +
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    btn.querySelector('.stkl-name').textContent = (viewing ? 'Viewing: ' : '') + name;
    btn.setAttribute('aria-label', 'Layout menu: ' + name);
  }

  const auto = () => lsGet(K.auto(), true) !== false;

  // Menu rows (Owner 2026-11-01 "cleaner chart menus on phone"): leading icon, title, optional one-line
  // sub-label, grouped under small headers; a bottom sheet on phones (style.css .stkc-sheet).
  const IC = {
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    auto: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    lib: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
    link: '<path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    leave: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    signin: '<path d="M14 4h5v16h-5M10 8l4 4-4 4M14 12H4"/>',
    chev: '<path d="M9 6l6 6-6 6"/>'
  };
  const svg = (k) => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>';
  const lead = (k) => el('span', { class: 'stkc-mi-ic', html: svg(k) });
  const txt = (label, sub) => el('span', { class: 'stkc-mi-t' }, [el('span', { class: 'stkc-mi-l', text: label }), sub ? el('small', { class: 'stkc-mi-s', text: sub }) : null]);
  function item(label, opts){
    const b = el('button', { type: 'button', class: 'stkc-item stkc-mi stkl-item', role: 'menuitem' }, [opts.icon ? lead(opts.icon) : null, txt(label, opts.sub),
      opts.kbd ? el('kbd', { text: opts.kbd }) : null, opts.chev ? el('span', { class: 'stkc-mi-end', html: svg('chev') }) : null]);
    if (opts.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
    b.addEventListener('click', () => { setOpen(false); opts.run(); });
    return b;
  }
  function sw(label, on, disabled, fn, tip, icon, sub){
    const cb = el('input', { type: 'checkbox', role: 'switch', class: 'stkg-sw', 'aria-label': label });
    cb.checked = !!on; cb.disabled = !!disabled;
    cb.addEventListener('change', () => fn(cb.checked, cb));
    return el('label', { class: 'stkg-swrow stkc-mi', title: tip || '' }, [icon ? lead(icon) : null, txt(label, sub), cb]);
  }
  const head = (t) => el('p', { class: 'stkc-pop-h', text: t });

  function renderMenu(){
    pop.innerHTML = '';
    const signed = !!user();
    const name = viewing ? 'Viewing: ' + viewing.name : (cur ? cur.name : 'Unsaved layout');
    if (o.sheetHead) pop.appendChild(o.sheetHead(pop, 'Chart', name + (cur && dirty && !viewing ? ' · unsaved changes' : '')));
    if (viewing) {
      pop.appendChild(el('p', { class: 'stkl-view', text: 'Read-only: a layout shared by another member. Make a copy to keep it.' }));
      pop.appendChild(item('Make a copy…', { icon: 'copy', run: () => askName('Make a copy', viewing.name + ' (copy)', saveAsNew) }));
      pop.appendChild(item('Leave shared layout', { icon: 'leave', run: leaveShared }));
    } else if (!signed) {
      // Signed out: no greyed rows, one way forward.
      const a = el('a', { class: 'stkc-item stkc-mi stkl-item', role: 'menuitem', href: 'login.html?next=' + encodeURIComponent(location.pathname) }, [lead('signin'), txt('Sign in to save layouts', 'Keep charts on your account and share them')]);
      pop.appendChild(a);
    } else {
      pop.appendChild(head('This layout'));
      pop.appendChild(item('Save layout', { icon: 'save', kbd: isMac ? '⌘S' : 'Ctrl+S', sub: cur ? '' : 'Save first to rename or share it', run: () => saveNow(true) }));
      pop.appendChild(sw('Autosave', auto(), false, (v) => { lsSet(K.auto(), v); if (v && dirty) schedule(); }, 'Save the open layout 2 seconds after any change', 'auto', 'Saves changes automatically'));
      pop.appendChild(item('Make a copy…', { icon: 'copy', run: () => askName('Make a copy', (cur ? cur.name : 'My layout') + ' (copy)', saveAsNew) }));
      if (cur) {
        pop.appendChild(item('Rename…', { icon: 'rename', run: () => askName('Rename layout', cur.name, renameCur) }));
        pop.appendChild(item('Share link', { icon: 'share', sub: cur.shared ? 'On: anyone with the link can view' : 'Off', chev: true, run: shareSheet }));
      }
      pop.appendChild(head('Layouts'));
      pop.appendChild(item('Chart Library…', { icon: 'lib', run: () => lib && lib.open() }));
      pop.appendChild(item('Open layout…', { icon: 'open', run: openDialog }));
      pop.appendChild(item('Create new layout…', { icon: 'add', run: () => askName('Create new layout', 'New layout', createNew) }));
      const rec = lsGet(K.recent(), []).filter((r) => r && r.id && !isWs(r.id) && (!cur || r.id !== cur.id)).slice(0, RECENT_MAX);
      if (rec.length) {
        pop.appendChild(head('Recently used'));
        rec.forEach((r) => {
          const b = el('button', { type: 'button', class: 'stkc-item stkc-mi stkl-item stkl-rec', role: 'menuitem' }, [lead('recent'), txt(r.name, r.sub || '')]);
          b.addEventListener('click', () => { setOpen(false); openById(r.id); });
          pop.appendChild(b);
        });
      }
    }
    pop.appendChild(head('Data'));
    pop.appendChild(item('Download chart data…', { icon: 'dl', sub: 'Visible bars as CSV', run: csvDialog }));
  }

  // Share link: one small sheet (switch + link + Copy) instead of a switch with a dangling row.
  function shareSheet(){
    if (!cur) return;
    const url = el('input', { type: 'text', class: 'stkc-in', readonly: '', 'aria-label': 'Layout link' });
    const copyB = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Copy link' });
    const linkRow = el('div', { class: 'stkc-saverow stkl-linkrow' }, [url, copyB]);
    const paint = () => { const on = !!(cur && cur.shared); linkRow.hidden = !on; url.value = on ? linkOf(cur.id) : ''; if (on && !slugOf(cur.id)) ensureSlug(cur.id).then(() => { if (cur && cur.shared) url.value = linkOf(cur.id); }); };
    copyB.addEventListener('click', () => copyLink());
    const row = sw('Share with a link', cur.shared, false, async (v, cb) => { await setShared(v, cb); paint(); }, '', 'link',
      'Anyone signed in with the link can view (read-only)');
    modal('Share layout', el('div', { class: 'stkl-body' }, [row, linkRow,
      el('p', { class: 'stkc-note stkl-sharenote', text: 'Turning it off breaks the link. Your own copy never changes.' })]));
    paint();
  }

  // ---- data ----
  // st: a state captured earlier (a workspace switch saves the chart it is leaving); no thumbnail then, the old one stays
  async function pack(st0){
    const st = st0 || ws.getState();
    const from = grid && grid.capFrom && grid.capFrom();
    if (from) st.layout = from;   // device-capped view: keep the member's own grid
    const json = JSON.stringify(st);
    let s;
    try { s = await encodeState(json); }
    catch (e) { keepLocal(json); throw e; }
    let a = null; try { a = ws.active; } catch (e) {}
    const k = countOf(st);
    if (st0) { const c = (st.charts || []).find((x) => x && x.id === st.activeCellId) || (st.charts || [])[0] || {}; a = { symbol: c.symbol, timeframe: c.timeframe }; }
    return { state: s, json, symbol: String((a && a.symbol) || '').slice(0, 80), interval: String((a && a.timeframe) || '').slice(0, 10), panes: k.panes, indicators: k.indicators, thumb: a && !st0 ? thumbOf(a) : '' };
  }
  // A save that fails (size, offline, rules) keeps the chart on this device so nothing is lost.
  function keepLocal(json){
    if (!codec()) return;
    codec().backup('layout:' + uid() + ':' + (cur ? cur.id : 'unsaved'), cur ? cur.name : 'Unsaved layout', json);
  }
  const subOf = (d) => [symLabel(d.symbol), tfLabel(d.interval)].filter(Boolean).join(' · ');

  // ---- workspace docs are not layouts ----
  const wsKind = new Set();      // ids seen with kind 'workspace'
  let hiddenFn = null;           // () => ids of every workspace's own doc (the workspace index; set by chart-workspaces.js)
  const isWs = (id) => !!id && (wsKind.has(id) || (!!hiddenFn && hiddenFn().includes(id)));
  function setHidden(fn){
    hiddenFn = fn; cache = null;
    const r = lsGet(K.recent(), []), keep = r.filter((x) => x && !isWs(x.id));   // clean Recently used entries that point at a workspace
    if (keep.length !== r.length) lsSet(K.recent(), keep);
  }
  async function listRaw(){
    const snap = await col().get();
    const out = [];
    snap.forEach((d) => { const x = d.data() || {}; out.push({ id: d.id, name: x.name || 'Untitled', symbol: x.symbol || '', interval: x.interval || '', shared: !!x.shared, updatedAt: tsMs(x.updatedAt),
      thumb: x.thumb || '', panes: x.panes || 1, indicators: x.indicators || 0, vis: x.vis || (x.shared ? 'link' : 'private'), desc: x.desc || '', tags: x.tags || [], cid: x.cid || '', slug: isSlug(x.slug) ? x.slug : '' });
      if (isSlug(x.slug)) slugs.set(d.id, x.slug); });
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }
  // the member's LAYOUTS only (Open layout, Library, counts)
  async function list(){
    const out = (await listRaw()).filter((x) => !isWs(x.id));
    cache = out;
    return out;
  }
  function touchRecent(d){
    if (isWs(d.id)) return;
    const r = lsGet(K.recent(), []).filter((x) => x && x.id !== d.id);
    r.unshift({ id: d.id, name: d.name, sub: subOf(d) });
    lsSet(K.recent(), r.slice(0, RECENT_MAX + 1));
  }
  function setCur(d){
    const slug = d ? (isSlug(d.slug) ? d.slug : (slugs.get(d.id) || (cur && cur.id === d.id && cur.slug) || '')) : '';
    cur = d ? { id: d.id, name: d.name, shared: !!d.shared, updatedAt: d.updatedAt || Date.now(), slug } : null;
    lsSet(K.cur(), cur ? { id: cur.id, name: cur.name, shared: cur.shared, slug: cur.slug } : null);
    if (cur) touchRecent(Object.assign({}, cur, d));
    dirty = false; paintBtn();
    if (cur && slug) slugs.set(cur.id, slug);
    if (cur && !slug) giveSlug(cur.id);
    syncUrl();
  }

  // ---- layout links: /charts/<ID> ----
  const slugs = new Map();          // layout id -> link id (this account)
  const slugJobs = new Map();       // layout id -> pending ensureSlug()
  const K_GUEST = 'stryker_chart_layout_slug_guest';
  let linksOff = false;             // the rules for chartLinks are not live (permission denied): stop trying this session
  // the device chart of a signed-out visitor gets its id here; it moves to the account on sign-in
  function guestSlug(make){
    let s = lsGet(K_GUEST, null);
    if (!isSlug(s) && make) { s = genSlug(); lsSet(K_GUEST, s); }
    return isSlug(s) ? s : null;
  }
  // The layout's permanent id: read it, or create it once (checked free, then layout.slug + chartLinks/<ID> in one
  // batch; the rules refuse a taken id, so a race just retries with a new one). null when it cannot be made now.
  function ensureSlug(id, want){
    if (!user() || !id) return Promise.resolve(null);
    if (slugs.has(id)) return Promise.resolve(slugs.get(id));
    if (slugJobs.has(id)) return slugJobs.get(id);
    const job = (async () => {
      const ref = col().doc(id);
      const d = await ref.get();
      if (!d.exists) return null;
      const have = (d.data() || {}).slug;
      if (isSlug(have)) { slugs.set(id, have); return have; }
      if (linksOff) return null;
      for (let i = 0; i < 4; i++) {
        const s = i === 0 && isSlug(want) ? want : genSlug();
        let taken;
        try { taken = (await linkDoc(s).get()).exists; }
        catch (e) { if (e && e.code === 'permission-denied') { linksOff = true; return null; } throw e; }
        if (taken) continue;
        try {
          const b = db().batch();
          b.update(ref, { slug: s });
          b.set(linkDoc(s), { ownerUid: user().uid, lid: id, createdAt: ts() });
          await b.commit();
          slugs.set(id, s);
          return s;
        } catch (e) { console.warn('TradeZoro: layout link id', e && e.code); }
      }
      return null;
    })().catch((e) => { console.warn('TradeZoro: layout link id', e && e.code); return null; }).finally(() => slugJobs.delete(id));
    slugJobs.set(id, job);
    return job;
  }
  // backfill the open layout's id in the background, then show it in the address bar
  function giveSlug(id){
    ensureSlug(id).then((s) => {
      if (!s || !cur || cur.id !== id || cur.slug === s) return;
      cur.slug = s; lsSet(K.cur(), { id: cur.id, name: cur.name, shared: cur.shared, slug: s }); syncUrl();
    });
  }
  const slugOf = (id) => slugs.get(id) || (cur && cur.id === id && cur.slug) || '';
  // The address bar follows the open layout: /charts/<ID>, or /charts for an unsaved one. Other query params stay;
  // the one-shot ?layout= / ?openlayout= are dropped once a link id stands for them.
  function syncUrl(){
    try {
      if (!isChartsPath(location.pathname) && !/^\/charts\/[^/]+\/?$/.test(location.pathname)) return;
      if (pendingLink && !user()) return;     // a signed-out visitor's /charts/<ID>: kept, so signing in comes back to it
      let s = null;
      if (viewing) s = viewing.slug || null;
      else if (cur) s = cur.slug || null;
      else if (!user()) s = guestSlug(true);
      else s = migrating;
      if (viewing && !s) return;              // an old ?layout= link without an id: leave the address as it is
      const u = new URL(location.href);
      u.pathname = s ? '/charts/' + s : '/charts';
      if (s || !viewing) { u.searchParams.delete('layout'); u.searchParams.delete('openlayout'); }
      const next = u.pathname + u.search + u.hash;
      if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
    } catch (e) {}
  }

  async function writeShared(id, name, state){
    await sharedDoc(id).set({ ownerUid: user().uid, name, state, updatedAt: ts() });
  }

  // safe mode (assets/chart-safe-mode.js): the chart opened with its indicators paused; never save over the layout
  const safe = () => !!(window.__stkSafe && window.__stkSafe.active);
  async function saveNow(manual, st){
    if (viewing || !user()) return;
    if (safe()) { if (manual) toast('Turn the indicators back on first, so the layout is saved with them.', 'error'); return; }
    if (!cur) { askName('Save layout', 'My layout', saveAsNew); return; }
    const id = cur.id, name = cur.name, shared = cur.shared;   // before any await: a workspace switch changes cur right after calling this
    if (saving) { await saving.catch(() => {}); }
    clearTimeout(autoTimer);
    let p;
    try { p = await pack(st); } catch (e) { toast(e.userMessage || 'Could not save the layout.', 'error'); return; }
    saving = (async () => {
      await col().doc(id).set(Object.assign({ name, state: p.state, symbol: p.symbol, interval: p.interval, shared, updatedAt: ts(), panes: p.panes, indicators: p.indicators }, p.thumb ? { thumb: p.thumb } : {}), { merge: true });
      if (shared) await writeShared(id, name, p.state);
    })();
    try {
      await saving;
      if (cur && cur.id === id) { dirty = false; cur.updatedAt = Date.now(); touchRecent({ id, name, symbol: p.symbol, interval: p.interval }); paintBtn(); }
      if (manual) toast('Layout saved');
    } catch (e) {
      console.warn('TradeZoro: layout save', e);
      keepLocal(p.json);
      toast('Could not save the layout to your account. Check your connection; a copy is kept on this device.', 'error');
    } finally { saving = null; }
  }

  // Workspaces (assets/chart-workspaces.js): opts.st = save this captured state instead of the screen; opts.quiet = no
  // success toast; opts.attach() = false keeps the new layout off the screen (the member already switched away).
  // Returns { id, name, shared } or null.
  async function saveAsNew(name, opts){
    opts = opts || {};
    if (!user()) return;
    if (safe()) { toast('Turn the indicators back on first, so the layout is saved with them.', 'error'); return; }
    let p;
    try { p = await pack(opts.st); } catch (e) { toast(e.userMessage || 'Could not save.', 'error'); return; }
    try {
      const all = cache || await list();
      if (all.length >= MAX_COUNT) { toast('You have ' + MAX_COUNT + ' layouts. Delete one to save another.', 'error'); return null; }
      const ref = col().doc();
      await ref.set({ name, state: p.state, symbol: p.symbol, interval: p.interval, shared: false, updatedAt: ts(), panes: p.panes, indicators: p.indicators, thumb: p.thumb || '', vis: 'private' });
      cache = null;
      if (opts.attach && !opts.attach()) { ensureSlug(ref.id); return { id: ref.id, name, shared: false }; }
      const wasViewing = !!viewing;
      if (viewing) endViewing();
      // a copy of a read-only layout is now this browser's own screen: write it to the on-device save at once, so a
      // reload (or /charts/<ID>) does not find an empty screen and fall back to a default chart
      if (wasViewing) { try { ws.persistNow && ws.persistNow(); } catch (e) {} }
      // the first save of a signed-out chart keeps the id it already had on this device
      const want = migrating; migrating = null;
      if (want) { lsSet(K_GUEST, null); await ensureSlug(ref.id, want); }
      setCur({ id: ref.id, name, shared: false, symbol: p.symbol, interval: p.interval });
      if (!opts.quiet) toast('Saved as "' + name + '"');
      return { id: ref.id, name, shared: false };
    } catch (e) { console.warn('TradeZoro: layout save as', e); keepLocal(p.json); toast('Could not save the layout to your account. A copy is kept on this device.', 'error'); return null; }
  }

  async function renameId(id, name){
    try {
      const was = (cache || await list()).find((x) => x.id === id) || {};
      await col().doc(id).update({ name, updatedAt: ts() });
      if (was.shared) await sharedDoc(id).update({ name, updatedAt: ts() });
      if (was.vis === 'public' || was.vis === 'community') {
        const pd = await db().collection('publicLayouts').doc(id).get();
        if (pd.exists) { const x = pd.data(); await db().collection('publicLayouts').doc(id).update({ name, authorName: x.authorName, desc: x.desc, tags: x.tags, visibility: x.visibility, communityId: x.communityId, symbol: x.symbol, interval: x.interval, thumb: x.thumb, panes: x.panes, indicators: x.indicators, updatedAt: ts() }); }
      }
      if (cur && cur.id === id) { cur.name = name; setCur(Object.assign({}, cur)); }
      cache = null;
      toast('Renamed');
    } catch (e) { console.warn('TradeZoro: layout rename', e); toast('Could not rename.', 'error'); }
  }
  const renameCur = (name) => (cur ? renameId(cur.id, name) : null);

  async function duplicate(id){
    try {
      const all = cache || await list();
      if (all.length >= MAX_COUNT) { toast('You have ' + MAX_COUNT + ' layouts. Delete one to save another.', 'error'); return; }
      const d = await col().doc(id).get(); if (!d.exists) return;
      const x = d.data(); const ref = col().doc();
      await ref.set({ name: (x.name + ' (copy)').slice(0, NAME_MAX), state: x.state, symbol: x.symbol || '', interval: x.interval || '', shared: false, updatedAt: ts(), panes: x.panes || 1, indicators: x.indicators || 0, thumb: x.thumb || '', vis: 'private' });
      cache = null; toast('Duplicated');
    } catch (e) { console.warn('TradeZoro: layout duplicate', e); toast('Could not duplicate.', 'error'); }
  }

  // A layout from the library (another member's, or a community's): the Pine guard runs first, then it loads
  // into the chart as an UNSAVED layout. Save layout keeps it.
  // A SETUP (doc.setup) merges onto the open chart (ui.applySaved keeps symbol, interval, drawings) and
  // stays in the current layout; a whole chart replaces it as an unsaved layout.
  async function applyForeign(doc, name){
    const s = sanitizeShared(doc);
    if (!s) { toast('This layout could not be read.', 'error'); return false; }
    const setup = !!s.doc.setup;
    if (viewing) endViewing();
    if (!setup && cur && dirty && auto()) await saveNow(false);
    apply(s.doc);
    if (setup) { if (cur) { dirty = true; schedule(); } paintBtn(); }
    else { cur = null; lsSet(K.cur(), null); dirty = false; paintBtn(); syncUrl(); }
    if (s.dropped) toast(s.dropped + ' Pine script(s) in this layout failed our safety check and were not loaded.', 'error');
    else toast(setup ? 'Applied setup \"' + name + '\" to your chart.' : 'Applied \"' + name + '\". Save layout to keep it.');
    return true;
  }

  // A whole template / starter is about to replace the chart: save the open layout's own edits first, then
  // stop tracking it, so autosave can never write the template's symbol over that layout (BUG-TEMPLATES).
  async function detach(){
    if (viewing || !cur) return;
    if (dirty && auto()) await saveNow(false);
    clearTimeout(autoTimer); cur = null; lsSet(K.cur(), null); dirty = false; paintBtn(); syncUrl();
  }

  async function createNew(name){
    // A fresh single chart, saved straight away under the new name.
    if (cur && dirty && auto()) await saveNow(false);
    window.__stkFreshDoc = true;   // new layout = no saved style: it gets the default look (chart-settings.js)
    apply({ version: 1, layout: '1', charts: [{ id: 'A', symbol: 'futures:NQ1!', timeframe: '15' }] });
    cur = null;
    await new Promise((r) => setTimeout(r, 50));
    await saveAsNew(name);
  }

  // Workspaces (assets/chart-workspaces.js): show a chart document already in hand and track it as layout `meta`
  // (null = an unsaved layout), with no fetch; the layout being left must have been saved by the caller.
  function adopt(doc, meta){
    if (viewing) endViewing();
    clearTimeout(autoTimer);
    apply(doc);
    if (meta) setCur(meta); else { cur = null; lsSet(K.cur(), null); dirty = false; paintBtn(); syncUrl(); }
  }
  async function fetchDoc(id){
    const d = await col().doc(id).get();
    if (!d.exists) return null;
    const x = d.data(), doc = await decodeState(x.state);
    if (x.kind === 'workspace') wsKind.add(id);
    return doc ? { doc, meta: { id, name: x.name, shared: !!x.shared, symbol: x.symbol, interval: x.interval, updatedAt: tsMs(x.updatedAt) } } : null;
  }

  function apply(doc){
    suppress = Date.now() + 1500;
    try { grid && grid.setDateRange && grid.setDateRange(false); } catch (e) {}
    if (safe()) doc = window.__stkSafe.strip(doc);
    ui.applySaved({ state: doc });
  }

  async function openById(id){
    if (viewing) endViewing();
    if (cur && dirty && auto()) await saveNow(false);
    try {
      const d = await col().doc(id).get();
      if (!d.exists) { toast('That layout no longer exists.', 'error'); dropRecent(id); return; }
      const x = d.data();
      if (x.kind === 'workspace' || isWs(id)) { wsKind.add(id); dropRecent(id); toast('That is a workspace, not a layout. Open it from the Workspaces menu.', 'error'); return; }
      const doc = await decodeState(x.state);
      if (!doc) { toast('That layout could not be read.', 'error'); return; }
      apply(doc);
      setCur({ id, name: x.name, shared: !!x.shared, symbol: x.symbol, interval: x.interval, updatedAt: tsMs(x.updatedAt) });
    } catch (e) { console.warn('TradeZoro: layout open', e); toast('Could not open the layout.', 'error'); }
  }
  function dropRecent(id){ lsSet(K.recent(), lsGet(K.recent(), []).filter((x) => x && x.id !== id)); }

  async function remove(id, name){
    if (!window.confirm('Delete the layout "' + name + '"? This cannot be undone.')) return false;
    try {
      const was = (cache || []).find((x) => x.id === id);
      if (was && was.shared) { try { await sharedDoc(id).delete(); } catch (e) {} }
      if (was && (was.vis === 'public' || was.vis === 'community')) { try { const r = db().collection('publicLayouts').doc(id); await r.collection('data').doc('s').delete(); await r.delete(); } catch (e) {} }
      const lk = slugs.get(id) || (((cache || []).find((x) => x.id === id) || {}).slug);
      await col().doc(id).delete();
      if (isSlug(lk)) { slugs.delete(id); try { await linkDoc(lk).delete(); } catch (e) {} }   // the link dies with the layout
      dropRecent(id); cache = null;
      if (cur && cur.id === id) setCur(null);
      toast('Layout deleted');
      return true;
    } catch (e) { console.warn('TradeZoro: layout delete', e); toast('Could not delete.', 'error'); return false; }
  }

  async function setShared(on, cb){
    if (!cur) return;
    try {
      if (on) {
        if (dirty) await saveNow(false);
        const p = await pack();
        await writeShared(cur.id, cur.name, p.state);
        await col().doc(cur.id).update({ shared: true, updatedAt: ts() });
      } else {
        await sharedDoc(cur.id).delete();
        await col().doc(cur.id).update({ shared: false, updatedAt: ts() });
      }
      cur.shared = on; cache = null; setCur(Object.assign({}, cur));
      toast(on ? 'Sharing on. Copy the link to send it.' : 'Sharing off. The link no longer works.');
      if (on) copyLink(true);
      renderMenu();
    } catch (e) {
      console.warn('TradeZoro: layout share', e);
      if (cb) cb.checked = !on;
      toast(e.userMessage || 'Could not change sharing.', 'error');
    }
  }
  // https://tradezoro.com/charts/<ID>; the old ?layout=<id> form only while the id cannot be made (it still works)
  function linkOf(id){
    const s = slugOf(id);
    return s ? location.origin + '/charts/' + s : location.origin + '/charts?layout=' + encodeURIComponent(id);
  }
  async function copyLink(quiet){
    if (!cur || !cur.shared) return;
    await ensureSlug(cur.id);
    const url = linkOf(cur.id);
    try { await navigator.clipboard.writeText(url); if (quiet !== true) toast('Link copied'); }
    catch (e) { window.prompt('Copy this link', url); }
  }

  // ---- shared (read-only) view ----
  let stash = null;
  async function openShared(id, slug, linkOwner){
    if (!/^[A-Za-z0-9]{20,40}$/.test(id)) { toast('That layout link is not valid.', 'error'); return false; }
    if (!user()) { toast('Sign in to open a shared layout.', 'error'); return false; }
    let snap;
    try { snap = await sharedDoc(id).get(); }
    catch (e) { snap = null; }
    if (!snap || !snap.exists) { if (!slug) toast('This shared layout is no longer available.', 'error'); return false; }
    const x = snap.data() || {};
    if (linkOwner && x.ownerUid !== linkOwner) return false;   // a link id only ever stands for its own owner's layout
    if (x.ownerUid === user().uid) {   // your own link: open your own copy
      await openById(id); return true;
    }
    return viewReadOnly(id, x.name, x.ownerUid, x.state, slug);
  }
  // Another member's layout, read-only (a shared link, or a public / community library layout opened by its link).
  async function viewReadOnly(id, name, ownerUid, state, slug){
    const doc = await decodeState(state);
    const s = sanitizeShared(doc);
    if (!s) { toast('This shared layout could not be read.', 'error'); return false; }
    if (cur && dirty && auto()) await saveNow(false);
    // Read-only: pause Vela's own localStorage persistence so the viewer's session is kept.
    if (!viewing) stash = { persistKey: ws.persistKey, cur };
    ws.persistKey = null;
    viewing = { id, name: String(name || 'Shared layout').slice(0, NAME_MAX), ownerUid, slug: isSlug(slug) ? slug : '' };
    cur = null;
    apply(s.doc);
    paintBtn();
    banner(true);
    syncUrl();
    if (s.dropped) toast(s.dropped + ' Pine script(s) in this layout failed our safety check and were not loaded.', 'error');
    return true;
  }
  // /charts/<ID>: your own layout opens (editable); another member's shared / library layout opens read-only;
  // anything else (private, deleted, unknown) keeps your normal chart with a small toast. Never an error page.
  async function openLink(sl){
    const gone = () => { toast('That layout isn\'t available', 'info'); return false; };
    if (!user()) {
      if (sl === guestSlug(false)) return true;                      // this device's own chart
      pendingLink = sl; toast('Sign in to open this layout.', 'info'); return false;
    }
    if (sl === guestSlug(false) || sl === migrating) return true;   // this device's chart, moving to the account
    if (cur && cur.slug === sl) return true;                         // already open
    let m = null;
    try { const d = await linkDoc(sl).get(); m = d.exists ? d.data() : null; } catch (e) { m = null; }
    if (!m || typeof m.lid !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(m.lid)) return gone();
    if (m.ownerUid === user().uid) {
      slugs.set(m.lid, sl);
      if (cur && cur.id === m.lid) { cur.slug = sl; syncUrl(); return true; }
      try { const d = await col().doc(m.lid).get(); if (!d.exists) return gone(); } catch (e) { return gone(); }
      await openById(m.lid);
      return !!(cur && cur.id === m.lid);
    }
    if (await openShared(m.lid, sl, m.ownerUid)) return true;
    // a public / community layout from the library: read-only when the rules let this member use it
    try {
      const pc = await db().collection('publicLayouts').doc(m.lid).get();
      if (pc.exists) {
        const card = pc.data() || {};
        const st = await db().collection('publicLayouts').doc(m.lid).collection('data').doc('s').get();
        if (st.exists && card.kind !== 'setup' && card.ownerUid === m.ownerUid) return viewReadOnly(m.lid, card.name, card.ownerUid, (st.data() || {}).state, sl);
      }
    } catch (e) { /* not usable by this member */ }
    return gone();
  }
  function endViewing(){
    if (!viewing) return;
    viewing = null;
    if (stash) ws.persistKey = stash.persistKey;
    banner(false);
    try { const u = new URL(location.href); u.searchParams.delete('layout'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    syncUrl();
  }
  function leaveShared(){
    const back = stash && stash.cur;
    endViewing();
    stash = null;
    if (back) openById(back.id);
    else { try { const raw = localStorage.getItem(window.__stkPersistKey || 'vela-workspace'); if (raw) apply(JSON.parse(raw)); } catch (e) {} paintBtn(); }
  }
  let bannerEl = null;
  function banner(on){
    if (!on) { if (bannerEl) bannerEl.remove(); bannerEl = null; return; }
    if (bannerEl) bannerEl.remove();
    const copyB = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Make a copy' });
    copyB.addEventListener('click', () => askName('Make a copy', viewing.name + ' (copy)', saveAsNew));
    const leave = el('button', { type: 'button', class: 'stkl-link', text: 'Leave' });
    leave.addEventListener('click', leaveShared);
    bannerEl = el('div', { class: 'stkl-banner', role: 'status' }, [
      el('span', { text: 'Viewing "' + viewing.name + '", shared by another member. Read-only: your changes are not saved.' }), copyB, leave]);
    const bar = document.getElementById('stkc-bar');
    bar.parentNode.insertBefore(bannerEl, bar.nextSibling);
  }

  // ---- dialogs ----
  function modal(title, body, foot){
    const back = el('div', { class: 'stkl-back' });
    const box = el('div', { class: 'stkl-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const close = el('button', { type: 'button', class: 'stkc-ib', 'aria-label': 'Close', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>' });
    box.appendChild(el('div', { class: 'stkl-hd' }, [el('h2', { text: title }), close]));
    box.appendChild(body);
    if (foot) box.appendChild(foot);
    back.appendChild(box);
    const done = () => { back.remove(); document.removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    close.addEventListener('click', done);
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
    document.addEventListener('keydown', esc, true);
    document.body.appendChild(back);
    return { box, done };
  }

  function askName(title, init, fn){
    if (!user()) { toast('Sign in to save layouts.', 'error'); return; }
    const inp = el('input', { type: 'text', class: 'stkc-in', maxlength: String(NAME_MAX), 'aria-label': 'Layout name' });
    inp.value = String(init || '').slice(0, NAME_MAX);
    const ok = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Save' });
    const err = el('p', { class: 'stkc-err', hidden: '' });
    const m = modal(title, el('div', { class: 'stkl-body' }, [inp, err]), el('div', { class: 'stkl-ft' }, [ok]));
    const go = async () => {
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      if (!v) { err.hidden = false; err.textContent = 'Give the layout a name.'; inp.focus(); return; }
      ok.disabled = true; m.done(); await fn(v);
    };
    ok.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }

  async function openDialog(){
    const q = el('input', { type: 'search', class: 'stkc-in', placeholder: 'Search layouts', 'aria-label': 'Search layouts' });
    const ul = el('ul', { class: 'stkl-list', role: 'listbox', 'aria-label': 'Your layouts' });
    const note = el('p', { class: 'stkc-empty', text: 'Loading…' }); if (window.skel) note.innerHTML = skel.html('rows', 6, 2);
    const m = modal('Open layout', el('div', { class: 'stkl-body' }, [q, note, ul]));
    let items = [];
    try { items = await list(); } catch (e) { note.textContent = 'Could not load your layouts.'; return; }
    const paint = () => {
      const s = q.value.trim().toLowerCase();
      const f = items.filter((x) => !s || x.name.toLowerCase().includes(s) || symLabel(x.symbol).toLowerCase().includes(s));
      ul.innerHTML = '';
      note.textContent = items.length ? (f.length ? '' : 'No layouts match.') : 'No saved layouts yet. Use Save layout to keep this chart.';
      note.hidden = !note.textContent;
      f.forEach((x) => {
        const open = el('button', { type: 'button', class: 'stkl-row' + (cur && cur.id === x.id ? ' on' : ''), role: 'option', 'aria-selected': cur && cur.id === x.id ? 'true' : 'false' }, [
          el('span', { class: 'stkl-rn' }, [el('b', { text: x.name }), x.shared ? el('em', { text: 'shared' }) : null]),
          el('small', { text: subOf(x) }),
          el('span', { class: 'stkl-when', text: ago(x.updatedAt) })]);
        open.addEventListener('click', () => { m.done(); openById(x.id); });
        const del = el('button', { type: 'button', class: 'stkc-ib stkc-del', title: 'Delete', 'aria-label': 'Delete ' + x.name,
          html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>' });
        del.addEventListener('click', async () => { if (await remove(x.id, x.name)) { items = items.filter((y) => y.id !== x.id); paint(); } });
        ul.appendChild(el('li', { class: 'stkl-li' }, [open, del]));
      });
    };
    q.addEventListener('input', paint);
    paint();
    setTimeout(() => q.focus(), 0);
  }

  function csvDialog(){
    let cell; try { cell = ws.active; } catch (e) { return; }
    const tz = ws.timezone || 'Etc/UTC';
    const ind = el('input', { type: 'checkbox' }); ind.checked = true;
    const info = el('p', { class: 'stkl-info' });
    const upd = () => { const r = chartCsv(cell, tz, ind.checked); info.textContent = symLabel(cell.symbol) + ' · ' + tfLabel(cell.timeframe) + ' · ' + r.rows + ' bars in view · times in ' + tz + (ind.checked ? ' · ' + r.indCols + ' indicator column' + (r.indCols === 1 ? '' : 's') : ''); };
    ind.addEventListener('change', upd);
    const go = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Download CSV' });
    const m = modal('Download chart data', el('div', { class: 'stkl-body' }, [
      info,
      el('label', { class: 'stkc-check' }, [ind, el('span', { text: 'Include indicator values' })]),
      el('p', { class: 'stkc-note', text: 'The bars currently visible on the active chart. For personal use.' })
    ]), el('div', { class: 'stkl-ft' }, [go]));
    upd();
    go.addEventListener('click', () => {
      const r = chartCsv(cell, tz, ind.checked);
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
      const a = el('a', { href: URL.createObjectURL(blob), download: (symLabel(cell.symbol).replace(/[^A-Za-z0-9!_-]+/g, '') || 'chart') + '_' + tfLabel(cell.timeframe) + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      m.done();
    });
  }

  // ---- autosave + shortcut ----
  function schedule(){
    clearTimeout(autoTimer);
    if (!cur || viewing || !auto() || !user() || safe()) return;
    autoTimer = setTimeout(() => saveNow(false), AUTOSAVE_MS);
  }
  try {
    ws.on('state:changed', () => {
      if (Date.now() < suppress || viewing) return;
      if (cur) { if (!dirty) { dirty = true; paintBtn(); } schedule(); }
    });
  } catch (e) {}
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      if (e.target && e.target.closest && e.target.closest('.sed')) return;   // inside the script editor Ctrl+S saves the script (assets/chart-script-editor.js)
      e.preventDefault();
      if (viewing) askName('Make a copy', viewing.name + ' (copy)', saveAsNew);
      else saveNow(true);
    }
  }, true);
  window.addEventListener('beforeunload', () => { if (cur && dirty && auto() && !viewing) { try { saveNow(false); } catch (e) {} } });

  // ---- boot ----
  const ready = (window.StrykerChartTemplates && window.StrykerChartTemplates.ready) || Promise.resolve();
  paintBtn();
  const booted = ready.then(async () => {
    const c = lsGet(K.cur(), null);
    if (c && c.id) { cur = { id: c.id, name: c.name, shared: !!c.shared, slug: isSlug(c.slug) ? c.slug : '' }; if (cur.slug) slugs.set(cur.id, cur.slug); paintBtn(); }
    // a chart made while signed out moves to the account under the same id: saved as a layout on the first sign-in
    // here when no layout is open (with one open, the screen is that layout and the device id is simply retired)
    const gs = user() ? guestSlug(false) : null;
    const sl = slugFromPath(location.pathname);
    let sid = null;
    try { sid = new URL(location.href).searchParams.get('layout'); } catch (e) {}
    let linked = false;
    if (sl && !sid) linked = await openLink(sl);
    else if (!sl && /^\/charts\/[^/]+\/?$/.test(location.pathname)) toast('That layout isn\'t available', 'info');   // /charts/<not an id>
    if (sid) await openShared(sid);
    let ol = null; try { ol = new URL(location.href).searchParams.get('openlayout'); } catch (e) {}   // the dashboard's "Open" on a saved layout
    if (!sid && !linked && ol && /^[A-Za-z0-9]{20,40}$/.test(ol) && user()) { await openById(ol); linked = !!(cur && cur.id === ol); }
    if (sid && (viewing || cur)) linked = true;
    fromLink = linked;   // the address asked for this layout: workspaces (assets/chart-workspaces.js) keep it on screen
    let al = null; try { al = new URL(location.href).searchParams.get('applylayout'); } catch (e) {}
    if (al && /^[A-Za-z0-9]{20,40}$/.test(al)) libApi.open('browse').then(() => mounted && mounted.applyId(al));
    let room = null;                                  // null = unknown (offline): try again next load
    if (gs && !cur && !viewing && !al && !safe()) { try { room = (await list()).length < MAX_COUNT; } catch (e) {} }
    if (room === true) {
      migrating = gs;
      await saveAsNew('My chart', { quiet: true });
      if (migrating) { migrating = null; }          // could not save (offline): the id stays on this device, tried next load
    } else if (gs && (cur || room === false)) lsSet(K_GUEST, null);   // a layout is open already, or no room left: retire the device id
    if (cur && !cur.slug && !viewing) giveSlug(cur.id);
    if (!pendingLink) syncUrl();
  });

  // ---- library sheet (assets/chart-layouts-lib.js), loaded on first use ----
  let lib = null, mounted = null;
  const host = { decodeState, encodeState, user, db, col, saveAsNew, sharedDoc, writeShared, ts, tsMs, toast, list, pack, askName, modal, el, openById, remove, renameId, duplicate, applyForeign, linkOf,
    saveNow, createNew, sanitizeShared, countOf, setupOf: (st) => ui.setupOf(st), symLabel, tfLabel, ago, copyLink: async (id) => { await ensureSlug(id); try { await navigator.clipboard.writeText(linkOf(id)); toast('Link copied'); } catch (e) { window.prompt('Copy this link', linkOf(id)); } }, ensureSlug,
    get cur(){ return cur; }, get dirty(){ return dirty; }, refresh(id, patch){ cache = null; if (cur && cur.id === id && patch) { Object.assign(cur, patch); setCur(Object.assign({}, cur)); } } };
  const libApi = { open: (tab) => import('./chart-layouts-lib.js?v=1107').then((m) => { if (!mounted) mounted = m.mountLib(host); return mounted.open(tab); }).catch((e) => { console.warn('TradeZoro: layouts library', e); toast('Could not open the layouts library.', 'error'); }) };
  lib = libApi;

  const api = { detach, saveNow, adopt, fetchDoc, booted: booted.catch(() => {}), saveAsNew, renameCur, renameId, duplicate, applyForeign, library: libApi, createNew, openById, remove, setShared, list, openShared, leaveShared, csv: () => chartCsv(ws.active, ws.timezone, true),
    get current(){ return cur; }, get viewing(){ return viewing; }, get dirty(){ return dirty; }, linkOf, ensureSlug, openLink, syncUrl, get fromLink(){ return fromLink; } };
  window.STRYKER_LAYOUTS = api;
  return api;
}
