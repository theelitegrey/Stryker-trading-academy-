// Stryker Trading Academy — Charts LAYOUT MENU (charts.html) — ES module
// Depends on: firebase compat SDKs (app/auth/firestore) + assets/auth.js; the Vela
// workspace (window.STRYKER_VELA) and helpers handed in by assets/vela-chart.js
// (bindPopover, toast, ui = window.STRYKER_CHART_UI, grid, Pine); assets/chart-pine-guard.js
// (window.StrykerPineGuard); style.css (.stkl-*).
//
// Owner order 2026-10-06 ("Build all"): TradingView's layout menu.
//   Save layout (Ctrl/Cmd+S) · Autosave (default ON, 2 s after any change) · Make a copy… ·
//   Rename… · Create new layout… · Open layout… (search, symbol + interval, last modified,
//   delete) · Recently used (last 5) · Share layout + Copy link · Download chart data… (CSV)
//
// A LAYOUT is a whole saved chart: the Vela workspace document (getState/applyState, the
// same document templates save). TEMPLATES stay reusable style/indicator presets.
//
// Storage (rules: functions-src/firestore.rules, chartLayouts + chartShared blocks):
//   students/{uid}/chartLayouts/{id}  { name 1-60, state JSON string <= 200000, symbol,
//                                       interval, shared bool, updatedAt }   owner only
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

const NAME_MAX = 60;
const STATE_MAX = 200000;
const MAX_COUNT = 50;
const AUTOSAVE_MS = 2000;
const RECENT_MAX = 5;

function fb(){ return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null; }
function user(){ const f = fb(); try { return f && f.auth().currentUser; } catch (e) { return null; } }
function db(){ return fb().firestore(); }
function col(){ return db().collection('students').doc(user().uid).collection('chartLayouts'); }
function sharedDoc(id){ return db().collection('chartShared').doc(id); }
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const tsMs = (v) => (v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

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
function ago(ms){
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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

  let cur = null;          // { id, name, shared, updatedAt }
  let viewing = null;      // { id, name, ownerUid } while a shared link is open read-only
  let dirty = false;
  let saving = null;
  let autoTimer = null;
  let suppress = 0;        // ignore state:changed bursts caused by our own applyState
  let cache = null;        // last list

  // ---- toolbar button + menu ----
  const btn = el('button', { type: 'button', class: 'stkc-btn stkl-btn', id: 'stkl-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    title: 'Layouts: whole saved charts (grid, symbols, drawings, indicators). Templates are reusable style and indicator presets.' });
  const pop = el('div', { class: 'stkc-pop stkl-pop', id: 'stkl-pop', role: 'menu', 'aria-label': 'Layout', hidden: '' });
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

  function item(label, opts){
    const b = el('button', { type: 'button', class: 'stkc-item stkl-item', role: 'menuitem' }, [el('span', { text: label }), opts && opts.kbd ? el('kbd', { text: opts.kbd }) : null]);
    if (opts && opts.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
    b.addEventListener('click', () => { setOpen(false); opts.run(); });
    return b;
  }
  function sw(label, on, disabled, fn, tip){
    const cb = el('input', { type: 'checkbox', role: 'switch', class: 'stkg-sw' });
    cb.checked = !!on; cb.disabled = !!disabled;
    cb.addEventListener('change', () => fn(cb.checked, cb));
    return el('label', { class: 'stkg-swrow', title: tip || '' }, [el('span', { text: label }), cb]);
  }

  function renderMenu(){
    pop.innerHTML = '';
    const signed = !!user();
    if (viewing) {
      pop.appendChild(el('p', { class: 'stkl-view', text: 'Read-only: a layout shared by another member. Make a copy to keep it.' }));
      pop.appendChild(item('Make a copy…', { run: () => askName('Make a copy', viewing.name + ' (copy)', saveAsNew) }));
      pop.appendChild(item('Leave shared layout', { run: leaveShared }));
      pop.appendChild(el('hr', { class: 'stkl-hr' }));
    } else {
      pop.appendChild(item('Save layout', { kbd: isMac ? '⌘S' : 'Ctrl+S', run: () => saveNow(true), disabled: !signed }));
      pop.appendChild(sw('Autosave', auto(), !signed, (v) => { lsSet(K.auto(), v); if (v && dirty) schedule(); }, 'Save the open layout 2 seconds after any change'));
      pop.appendChild(el('hr', { class: 'stkl-hr' }));
      pop.appendChild(item('Make a copy…', { run: () => askName('Make a copy', (cur ? cur.name : 'My layout') + ' (copy)', saveAsNew), disabled: !signed }));
      pop.appendChild(item('Rename…', { run: () => askName('Rename layout', cur.name, renameCur), disabled: !signed || !cur }));
      pop.appendChild(item('Create new layout…', { run: () => askName('Create new layout', 'New layout', createNew), disabled: !signed }));
      pop.appendChild(item('Open layout…', { run: openDialog, disabled: !signed }));
      const rec = lsGet(K.recent(), []).filter((r) => r && r.id && (!cur || r.id !== cur.id)).slice(0, RECENT_MAX);
      if (rec.length) {
        pop.appendChild(el('p', { class: 'stkc-pop-h', text: 'Recently used' }));
        rec.forEach((r) => {
          const b = el('button', { type: 'button', class: 'stkc-item stkl-item stkl-rec', role: 'menuitem' }, [el('span', { text: r.name }), el('small', { text: (r.sub || '') })]);
          b.addEventListener('click', () => { setOpen(false); openById(r.id); });
          pop.appendChild(b);
        });
      }
      pop.appendChild(el('hr', { class: 'stkl-hr' }));
      pop.appendChild(sw('Share layout', cur && cur.shared, !signed || !cur, (v, cb) => setShared(v, cb),
        cur ? 'Anyone signed in with the link can view this layout (read-only)' : 'Save the layout first'));
      const copyB = item('Copy link', { run: copyLink, disabled: !(cur && cur.shared) });
      copyB.classList.add('stkl-sub');
      pop.appendChild(copyB);
    }
    pop.appendChild(el('hr', { class: 'stkl-hr' }));
    pop.appendChild(item('Download chart data…', { run: csvDialog }));
    pop.appendChild(el('p', { class: 'stkc-note stkl-tip', text: 'Layouts save whole charts. Templates are reusable style and indicator presets.' }));
    if (!signed) pop.appendChild(el('p', { class: 'stkc-err', text: 'Sign in to save layouts to your account.' }));
  }

  // ---- data ----
  function pack(){
    const st = ws.getState();
    const from = grid && grid.capFrom && grid.capFrom();
    if (from) st.layout = from;   // device-capped view: keep the member's own grid
    const s = JSON.stringify(st);
    const bytes = new Blob([s]).size;
    if (bytes > STATE_MAX) { const e = new Error('big'); e.userMessage = 'This layout is too big to save (' + Math.round(bytes / 1024) + ' KB, limit ' + Math.round(STATE_MAX / 1024) + ' KB). Remove some drawings and try again.'; throw e; }
    let a = null; try { a = ws.active; } catch (e) {}
    return { state: s, symbol: String((a && a.symbol) || '').slice(0, 80), interval: String((a && a.timeframe) || '').slice(0, 10) };
  }
  const subOf = (d) => [symLabel(d.symbol), tfLabel(d.interval)].filter(Boolean).join(' · ');

  async function list(){
    const snap = await col().get();
    const out = [];
    snap.forEach((d) => { const x = d.data() || {}; out.push({ id: d.id, name: x.name || 'Untitled', symbol: x.symbol || '', interval: x.interval || '', shared: !!x.shared, updatedAt: tsMs(x.updatedAt) }); });
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    cache = out;
    return out;
  }
  function touchRecent(d){
    const r = lsGet(K.recent(), []).filter((x) => x && x.id !== d.id);
    r.unshift({ id: d.id, name: d.name, sub: subOf(d) });
    lsSet(K.recent(), r.slice(0, RECENT_MAX + 1));
  }
  function setCur(d){
    cur = d ? { id: d.id, name: d.name, shared: !!d.shared, updatedAt: d.updatedAt || Date.now() } : null;
    lsSet(K.cur(), cur ? { id: cur.id, name: cur.name, shared: cur.shared } : null);
    if (cur) touchRecent(Object.assign({}, cur, d));
    dirty = false; paintBtn();
  }

  async function writeShared(id, name, state){
    await sharedDoc(id).set({ ownerUid: user().uid, name, state, updatedAt: ts() });
  }

  async function saveNow(manual){
    if (viewing || !user()) return;
    if (!cur) { askName('Save layout', 'My layout', saveAsNew); return; }
    if (saving) { await saving.catch(() => {}); }
    clearTimeout(autoTimer);
    let p;
    try { p = pack(); } catch (e) { toast(e.userMessage || 'Could not save the layout.', 'error'); return; }
    const id = cur.id, name = cur.name, shared = cur.shared;
    saving = (async () => {
      await col().doc(id).set({ name, state: p.state, symbol: p.symbol, interval: p.interval, shared, updatedAt: ts() });
      if (shared) await writeShared(id, name, p.state);
    })();
    try {
      await saving;
      if (cur && cur.id === id) { dirty = false; cur.updatedAt = Date.now(); touchRecent({ id, name, symbol: p.symbol, interval: p.interval }); paintBtn(); }
      if (manual) toast('Layout saved');
    } catch (e) {
      console.warn('Stryker: layout save', e);
      toast('Could not save the layout. Check your connection.', 'error');
    } finally { saving = null; }
  }

  async function saveAsNew(name){
    if (!user()) return;
    let p;
    try { p = pack(); } catch (e) { toast(e.userMessage || 'Could not save.', 'error'); return; }
    try {
      const all = cache || await list();
      if (all.length >= MAX_COUNT) { toast('You have ' + MAX_COUNT + ' layouts. Delete one to save another.', 'error'); return; }
      const ref = col().doc();
      await ref.set({ name, state: p.state, symbol: p.symbol, interval: p.interval, shared: false, updatedAt: ts() });
      cache = null;
      if (viewing) endViewing();
      setCur({ id: ref.id, name, shared: false, symbol: p.symbol, interval: p.interval });
      toast('Saved as "' + name + '"');
    } catch (e) { console.warn('Stryker: layout save as', e); toast('Could not save the layout.', 'error'); }
  }

  async function renameCur(name){
    if (!cur) return;
    try {
      await col().doc(cur.id).update({ name, updatedAt: ts() });
      if (cur.shared) await sharedDoc(cur.id).update({ name, updatedAt: ts() });
      cur.name = name; cache = null; setCur(Object.assign({}, cur));
      toast('Renamed');
    } catch (e) { console.warn('Stryker: layout rename', e); toast('Could not rename.', 'error'); }
  }

  async function createNew(name){
    // A fresh single chart, saved straight away under the new name.
    if (cur && dirty && auto()) await saveNow(false);
    apply({ version: 1, layout: '1', charts: [{ id: 'A', symbol: 'futures:NQ1!', timeframe: '15' }] });
    cur = null;
    await new Promise((r) => setTimeout(r, 50));
    await saveAsNew(name);
  }

  function apply(doc){
    suppress = Date.now() + 1500;
    try { grid && grid.setDateRange && grid.setDateRange(false); } catch (e) {}
    ui.applySaved({ state: doc });
  }

  async function openById(id){
    if (viewing) endViewing();
    if (cur && dirty && auto()) await saveNow(false);
    try {
      const d = await col().doc(id).get();
      if (!d.exists) { toast('That layout no longer exists.', 'error'); dropRecent(id); return; }
      const x = d.data();
      let doc; try { doc = JSON.parse(x.state); } catch (e) { doc = null; }
      if (!doc) { toast('That layout could not be read.', 'error'); return; }
      apply(doc);
      setCur({ id, name: x.name, shared: !!x.shared, symbol: x.symbol, interval: x.interval, updatedAt: tsMs(x.updatedAt) });
    } catch (e) { console.warn('Stryker: layout open', e); toast('Could not open the layout.', 'error'); }
  }
  function dropRecent(id){ lsSet(K.recent(), lsGet(K.recent(), []).filter((x) => x && x.id !== id)); }

  async function remove(id, name){
    if (!window.confirm('Delete the layout "' + name + '"? This cannot be undone.')) return false;
    try {
      const was = (cache || []).find((x) => x.id === id);
      if (was && was.shared) { try { await sharedDoc(id).delete(); } catch (e) {} }
      await col().doc(id).delete();
      dropRecent(id); cache = null;
      if (cur && cur.id === id) setCur(null);
      toast('Layout deleted');
      return true;
    } catch (e) { console.warn('Stryker: layout delete', e); toast('Could not delete.', 'error'); return false; }
  }

  async function setShared(on, cb){
    if (!cur) return;
    try {
      if (on) {
        if (dirty) await saveNow(false);
        const p = pack();
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
      console.warn('Stryker: layout share', e);
      if (cb) cb.checked = !on;
      toast(e.userMessage || 'Could not change sharing.', 'error');
    }
  }
  function linkOf(id){ return location.origin + location.pathname.replace(/\.html$/, '') + '?layout=' + encodeURIComponent(id); }
  async function copyLink(quiet){
    if (!cur || !cur.shared) return;
    const url = linkOf(cur.id);
    try { await navigator.clipboard.writeText(url); if (quiet !== true) toast('Link copied'); }
    catch (e) { window.prompt('Copy this link', url); }
  }

  // ---- shared (read-only) view ----
  let stash = null;
  async function openShared(id){
    if (!/^[A-Za-z0-9]{20,40}$/.test(id)) { toast('That layout link is not valid.', 'error'); return; }
    if (!user()) { toast('Sign in to open a shared layout.', 'error'); return; }
    let snap;
    try { snap = await sharedDoc(id).get(); }
    catch (e) { snap = null; }
    if (!snap || !snap.exists) { toast('This shared layout is no longer available.', 'error'); return; }
    const x = snap.data() || {};
    if (x.ownerUid === user().uid) {   // your own link: open your own copy
      return openById(id);
    }
    let doc; try { doc = JSON.parse(x.state); } catch (e) { doc = null; }
    const s = sanitizeShared(doc);
    if (!s) { toast('This shared layout could not be read.', 'error'); return; }
    if (cur && dirty && auto()) await saveNow(false);
    // Read-only: pause Vela's own localStorage persistence so the viewer's session is kept.
    stash = { persistKey: ws.persistKey, cur };
    ws.persistKey = null;
    viewing = { id, name: String(x.name || 'Shared layout').slice(0, NAME_MAX), ownerUid: x.ownerUid };
    cur = null;
    apply(s.doc);
    paintBtn();
    banner(true);
    if (s.dropped) toast(s.dropped + ' Pine script(s) in this layout failed our safety check and were not loaded.', 'error');
  }
  function endViewing(){
    if (!viewing) return;
    viewing = null;
    if (stash) ws.persistKey = stash.persistKey;
    banner(false);
    try { const u = new URL(location.href); u.searchParams.delete('layout'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
  }
  function leaveShared(){
    const back = stash && stash.cur;
    endViewing();
    stash = null;
    if (back) openById(back.id);
    else { try { const raw = localStorage.getItem('vela-workspace'); if (raw) apply(JSON.parse(raw)); } catch (e) {} paintBtn(); }
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
    const note = el('p', { class: 'stkc-empty', text: 'Loading…' });
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
    if (!cur || viewing || !auto() || !user()) return;
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
      e.preventDefault();
      if (viewing) askName('Make a copy', viewing.name + ' (copy)', saveAsNew);
      else saveNow(true);
    }
  }, true);
  window.addEventListener('beforeunload', () => { if (cur && dirty && auto() && !viewing) { try { saveNow(false); } catch (e) {} } });

  // ---- boot ----
  const ready = (window.StrykerChartTemplates && window.StrykerChartTemplates.ready) || Promise.resolve();
  paintBtn();
  ready.then(async () => {
    const c = lsGet(K.cur(), null);
    if (c && c.id) { cur = { id: c.id, name: c.name, shared: !!c.shared }; paintBtn(); }
    let sid = null;
    try { sid = new URL(location.href).searchParams.get('layout'); } catch (e) {}
    if (sid) await openShared(sid);
  });

  const api = { saveNow, saveAsNew, renameCur, createNew, openById, remove, setShared, list, openShared, leaveShared, csv: () => chartCsv(ws.active, ws.timezone, true),
    get current(){ return cur; }, get viewing(){ return viewing; }, get dirty(){ return dirty; }, linkOf };
  window.STRYKER_LAYOUTS = api;
  return api;
}
