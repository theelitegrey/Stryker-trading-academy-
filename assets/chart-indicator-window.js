// Stryker Trading Academy — Charts: "Indicators, metrics, and strategies" window (ES module)
// Depends on: assets/vela-chart.js (calls mountIndicatorWindow(ws, opts) after the
// order-flow group and the Community row are installed); assets/chart-pine.js
// (window.STRYKER_PINE.addSource: runs a Pine source on the active cell);
// assets/chart-pine-scripts.js (window.StrykerPineScripts: My scripts + examples);
// assets/chart-pine-library.js (window.StrykerPineLibrary: Community scripts, boosts,
// Editors' picks); the global firebase compat SDK (favourites).
//
// WHAT IT IS (Owner order 2026-10-06 "Build all"): a TradingView-style indicator window
// that replaces Vela's small picker. It takes over ws.indicatorPicker.open/close/sync, so
// the topbar "Indicators" button and the "/" shortcut open this window instead.
//   PERSONAL   Favorites (starred items from every source), My scripts, On this chart
//   BUILT-IN   Technicals, grouped: Stryker (GEX Levels), Moving averages, Oscillators, Volatility,
//              Volume & Order flow, Trend, Levels (Vela built-ins + our order-flow tools
//              + the Stryker Pine examples); Stryker (every Stryker script, derived from
//              STRYKER_PICKS + PICKER_SCRIPTS section 'picks', so new ones appear by themselves)
//   COMMUNITY  Editors' picks (default: every Stryker script, then admin-picked community
//              scripts), Top and Trending (member-published public scripts plus every
//              third-party built-in, PICKER_SCRIPTS section 'community', credited to its
//              author; built-ins without stats follow, alphabetical). Owner order 2026-10-08:
//              no separate "Community indicators" tab, and no boost counts or "Boosts" text
//              in this window (the stats still order Top/Trending silently).
// Columns NAME · AUTHOR, a star on every row, a lock on code-hidden scripts.
// Search covers every source at once. Phone: full-screen sheet, sidebar becomes tabs.
//
// ADD-TO-CHART is unchanged: built-ins go through the active cell's addFromLibrary(i)
// (the same index space Vela's picker used, including the order-flow wrapper), Pine
// sources through STRYKER_PINE.addSource, Community scripts through
// StrykerPineLibrary.addItem (safety guard + Web Worker engine). Always the ACTIVE cell,
// so multi-chart layouts work per cell.
//
// FAVOURITES: students/{uid}/chartFavorites/{key with ':' -> '_'} = { key, name, at }.
// Private to the member (rules block "Charts: indicator favourites"). Signed out:
// localStorage only. Keys: b:<nativeType> built-in, p:<id> drawing-tool row,
// x:<id> Stryker example, m:<id> My script, c:<id> Community script, o:<name> other.
//
// No Vela / LuxAlgo wording anywhere in view (Owner order 2026-10-05).

import { PICKER_SCRIPTS, STRYKER_PICKS, builtinSource } from './chart-pine-builtins.js?v=469';

const PHONE_MAX = 700;
const FAV_LS = 'stryker_chart_favs';
const GROUP_FLOW = 'Volume & Order flow';
const GROUP_STRYKER = 'Stryker';
const CATS = [GROUP_STRYKER, 'Moving averages', 'Oscillators', 'Volatility', GROUP_FLOW, 'Trend', 'Levels'];
const SECTIONS = [
  ['PERSONAL', [['fav', 'Favorites'], ['mine', 'My scripts'], ['onchart', 'On this chart']]],
  ['BUILT-IN', [['tech', 'Technicals'], ['stryker', 'Stryker']]],
  ['COMMUNITY', [['picks', "Editors' picks"], ['top', 'Top'], ['trending', 'Trending']]]
];

function catOf(name){
  const n = String(name || '');
  if (/Moving Average|Dynamic Average|Regression Curve|Alligator|EMA|SMA\b/i.test(n)) return 'Moving averages';
  if (/Bollinger|Keltner|Donchian|Average True Range|Volatility|Standard Deviation|Ulcer|Mass Index|Choppiness|Chandelier|Squeeze/i.test(n)) return 'Volatility';
  if (/SuperTrend|Parabolic|Aroon|Directional|Vortex|ZigZag|Kroll|Ichimoku/i.test(n)) return 'Trend';
  if (/Pivot|52 Week|Fractal|High\/Low|high\/low|Previous day/i.test(n)) return 'Levels';
  if (/Volume|VWAP|Balance Volume|Accumulation|Money Flow|Ease of Movement|Force Index|Klinger|Intraday Intensity|Chaikin Oscillator|Price Volume|Order flow|Footprint|Delta|CVD/i.test(n)) return GROUP_FLOW;
  return 'Oscillators';
}

export function fmtCount(n){
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) { const k = n / 1000; return (k < 100 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'K'; }
  const m = n / 1e6; return (m < 100 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)) + 'M';
}

const SVG = (inner, w) => '<svg width="' + (w || 16) + '" height="' + (w || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
const I_STAR = '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>';
const I_LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const I_TRASH = '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>';
const I_INFO = '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>';
const I_SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>';
const I_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';

function h(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return n;
}

function fbUser(){ try { return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase.auth().currentUser : null; } catch (e) { return null; } }
function favCol(u){ return firebase.firestore().collection('students').doc(u.uid).collection('chartFavorites'); }
const favDocId = (key) => key.replace(/:/g, '_');

// ---------------- favourites store ----------------
const Favs = {
  map: new Map(),   // key -> name
  uid: undefined,
  loading: null,
  load(){
    const u = fbUser();
    const uid = u ? u.uid : null;
    if (this.loading && this.uid === uid) return this.loading;
    this.uid = uid;
    this.loading = (async () => {
      const m = new Map();
      if (u) {
        try {
          const s = await favCol(u).limit(300).get();
          s.forEach((d) => { const x = d.data() || {}; if (x.key) m.set(x.key, x.name || x.key); });
        } catch (e) { console.warn('Stryker: favourites', e); }
      } else {
        try { (JSON.parse(localStorage.getItem(FAV_LS) || '[]') || []).forEach((x) => { if (x && x.key) m.set(x.key, x.name || x.key); }); } catch (e) {}
      }
      this.map = m;
      return m;
    })();
    return this.loading;
  },
  has(key){ return this.map.has(key); },
  async toggle(key, name){
    const on = !this.map.has(key);
    const u = fbUser();
    name = String(name || key).slice(0, 80);
    if (on) this.map.set(key, name); else this.map.delete(key);
    try {
      if (u) {
        const ref = favCol(u).doc(favDocId(key));
        if (on) await ref.set({ key, name, at: firebase.firestore.FieldValue.serverTimestamp() });
        else await ref.delete();
      } else {
        localStorage.setItem(FAV_LS, JSON.stringify([...this.map].map(([k, n]) => ({ key: k, name: n }))));
      }
    } catch (e) {
      if (on) this.map.delete(key); else this.map.set(key, name);
      throw e;
    }
    return on;
  }
};

// ---------------- the window ----------------
export function mountIndicatorWindow(ws, opts){
  const toast = (opts && opts.toast) || (() => {});
  const tfLabel = (opts && opts.tfLabel) || ((t) => t);
  const picker = ws && ws.indicatorPicker;
  if (!picker || picker.__stkWindow) return null;
  picker.__stkWindow = true;

  let ov = null, els = null, section = 'tech', authorFilter = null, isAdmin = false;
  let community = null, communityErr = false, mine = null;
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const L = () => window.StrykerPineLibrary;
  const S = () => window.StrykerPineScripts;
  const P = () => window.STRYKER_PINE;
  const me = () => { const u = fbUser(); return u ? u.uid : null; };

  function activeCell(){
    try {
      const cells = ws.context().cells, id = ws.active.id;
      const i = Math.max(0, cells.findIndex((c) => c.id === id));
      return { cell: cells[i], index: i, count: cells.length };
    } catch (e) { return { cell: null, index: 0, count: 1 }; }
  }
  function targetText(){
    const a = activeCell();
    if (!a.cell) return '';
    const sym = String(a.cell.symbol || '').replace(/^[a-z]+:/i, '').replace(/1!$/, '');
    return 'Adds to ' + (a.count > 1 ? 'chart ' + (a.index + 1) + ': ' : '') + sym + ' ' + tfLabel(a.cell.timeframe);
  }

  // ---- items from every source ----
  function builtins(){
    let rows = [];
    try { rows = ws.active.libraryRows(); } catch (e) {}
    const out = [];
    rows.forEach((r, i) => {
      if (!r || r.category === 'Community') return;
      let key, author = 'Built-in', cat;
      if (r.pseudo) { key = 'p:' + r.pseudo; author = 'Stryker'; cat = GROUP_FLOW; }
      else if (r.native) { key = 'b:' + r.nativeType; if (/^stk_/.test(r.nativeType)) author = 'Stryker'; cat = r.category === GROUP_FLOW ? GROUP_FLOW : catOf(r.name); }
      else { key = 'o:' + String(r.name).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60); cat = catOf(r.name); author = 'Stryker'; }
      // Stryker GEX Levels (assets/chart-gex-levels.js) heads its own "Stryker" group.
      let desc = '';
      if (r.native && r.nativeType === 'stk_gex') { cat = GROUP_STRYKER; desc = 'Call wall, put wall, zero gamma, IV ±68% and market levels (pVAH/pPOC/pVAL, ONH/ONL) from the GEX page (SPX, ES, NQ)'; }
      out.push({ key, name: r.name, author, cat, kind: 'builtin', beta: !!r.beta, desc });
    });
    const ex = (S() && S().EXAMPLES) || [];
    ex.forEach((x) => out.push({ key: 'x:' + String(x.id).replace(/^example:/, ''), name: x.name, author: 'Stryker', cat: catOf(x.name), kind: 'example', source: x.source }));
    // Pine scripts from assets/chart-pine-builtins.js (next-gen engine). section 'picks' = the
    // Owner's own (Stryker group + BUILT-IN > Stryker); 'community' = third-party, listed in
    // COMMUNITY > Top and Trending with the script's own author, never as Stryker.
    PICKER_SCRIPTS.forEach((b) => {
      const third = b.section !== 'picks';
      out.push({ key: 'x:' + b.id, name: b.name, author: third ? (b.author || 'Community') : 'Stryker', cat: third ? null : GROUP_STRYKER,
        kind: 'example', builtinId: b.id, desc: b.desc, third });
    });
    return out;
  }
  function mineItems(){
    return (mine || []).map((t) => ({ key: 'm:' + t.id, name: t.name, author: 'You', kind: 'mine', source: t.source, id: t.id }));
  }
  function commItems(){
    return (community || []).map((s) => ({ key: 'c:' + s.id, name: s.name, author: s.authorName, authorUid: s.ownerUid, kind: 'community', s,
      boosts: s.boostCount || 0, locked: !s.openSource }));
  }
  function allItems(){ return builtins().concat(mineItems(), commItems()); }

  async function loadData(){
    const tasks = [Favs.load()];
    if (S()) tasks.push(S().list().then((r) => { mine = r.items || []; }).catch(() => { mine = []; }));
    if (L() && fbUser()) {
      tasks.push(L().listPublic().then((a) => { community = a; communityErr = false; }).catch((e) => { console.warn('Stryker: community list', e); community = []; communityErr = true; }));
      tasks.push(L().isAdmin().then((a) => { isAdmin = a; }));
    } else { community = []; }
    await Promise.all(tasks);
  }

  // ---- add / remove ----
  async function addItem(it, rowEl){
    const a = activeCell();
    if (!a.cell) { toast('No chart to add it to.', 'error'); return; }
    if (rowEl) rowEl.classList.add('is-busy');
    try {
      if (it.kind === 'builtin') {
        const rows = ws.active.libraryRows();
        const idx = rows.findIndex((r) => r && r.category !== 'Community' && (
          (it.key.startsWith('p:') && r.pseudo === it.key.slice(2)) ||
          (it.key.startsWith('b:') && r.native && r.nativeType === it.key.slice(2)) ||
          (it.key.startsWith('o:') && !r.native && !r.pseudo && r.name === it.name)));
        if (idx < 0) { toast('That indicator is not available on this chart.', 'error'); return; }
        const pseudo = it.key.startsWith('p:');
        if (pseudo) close();   // the drawing-tool rows need the chart
        ws.active.addFromLibrary(idx);
        if (!pseudo) toast('Added ' + it.name + ' to the chart');
      } else if (it.kind === 'example' || it.kind === 'mine') {
        if (!P() || !P().addSource) { toast('The chart is still loading. Try again in a moment.', 'error'); return; }
        let src = it.source, opts;
        if (it.builtinId) {
          try { src = await builtinSource(it.builtinId); } catch (e) { toast('Could not load ' + it.name + '. Check your connection.', 'error'); return; }
          opts = { engine: 'next' };
        }
        const r = await P().addSource(it.name, src, opts);
        if (!r.ok) toast(r.msg || 'Could not add the script.', 'error');
      } else if (it.kind === 'community') {
        if (!L() || !L().addItem) return;
        const r = await L().addItem(it.s);
        if (!r.ok) toast(r.msg || 'Could not add the script.', 'error');
      }
    } catch (e) {
      console.warn('Stryker: add from window', e);
      toast('Could not add it to the chart.', 'error');
    } finally {
      if (rowEl) rowEl.classList.remove('is-busy');
    }
    if (ov && section === 'onchart') render();
    if (ov && isPhone() && it.kind !== 'builtin') close();
  }

  // ---- open / close ----
  function build(){
    const search = h('input', { type: 'search', class: 'stkiw-search', placeholder: 'Search', 'aria-label': 'Search indicators, metrics and strategies', autocomplete: 'off', spellcheck: 'false' });
    const side = h('nav', { class: 'stkiw-side stkc-scroll', 'aria-label': 'Indicator groups' });
    const list = h('div', { class: 'stkiw-list stkc-scroll', role: 'list' });
    const head = h('div', { class: 'stkiw-cols', 'aria-hidden': 'true' }, [h('span', { class: 'stkiw-c-name', text: 'Script name' }), h('span', { class: 'stkiw-c-auth', text: 'Author' })]);
    const title = h('h2', { class: 'stkiw-sect' });
    const target = h('span', { class: 'stkiw-target' });
    const foot = h('div', { class: 'stkiw-foot' }, [
      target,
      h('span', { class: 'stkiw-foot-r' }, [
        h('button', { type: 'button', class: 'stkiw-link', text: 'Publish or manage community scripts', onclick: () => { close(); if (L()) L().openCommunity(); } }),
        h('span', { class: 'stkiw-note', text: 'Education only. Not financial advice.' })
      ])
    ]);
    SECTIONS.forEach(([label, items]) => {
      side.appendChild(h('p', { class: 'stkiw-side-h', text: label }));
      items.forEach(([k, name]) => side.appendChild(h('button', { type: 'button', class: 'stkiw-tab', 'data-k': k, role: 'tab', text: name, onclick: () => { section = k; authorFilter = null; search.value = ''; render(); } })));
    });
    const card = h('div', { class: 'stkiw-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Indicators, metrics, and strategies' }, [
      h('div', { class: 'stkiw-hd' }, [
        h('h2', { text: 'Indicators, metrics, and strategies' }),
        h('button', { type: 'button', class: 'stkiw-x', 'aria-label': 'Close', title: 'Close', html: SVG(I_CLOSE, 18), onclick: () => close() })
      ]),
      h('div', { class: 'stkiw-sr' }, [h('span', { class: 'stkiw-sicon', html: SVG(I_SEARCH) }), search]),
      h('div', { class: 'stkiw-body' }, [side, h('div', { class: 'stkiw-main' }, [title, head, list])]),
      foot
    ]);
    const o = h('div', { class: 'stkiw-ov', onclick: (e) => { if (e.target === o) close(); } }, [card]);
    o.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    search.addEventListener('input', () => render());
    list.addEventListener('scroll', () => { if (isPhone()) search.blur(); }, { passive: true });
    els = { search, side, list, title, target, head, card };
    return o;
  }

  async function open(){
    if (ov) return;
    ov = build();
    document.body.appendChild(ov);
    document.body.classList.add('stkiw-open');
    document.addEventListener('keydown', onDocKey, true);
    try { if (ws.trackDialog) ws.trackDialog(true); } catch (e) {}
    authorFilter = null;
    els.list.innerHTML = '';
    els.list.appendChild(h('p', { class: 'stkiw-empty', text: 'Loading\u2026' }));
    if (!isPhone()) setTimeout(() => els && els.search.focus(), 0);
    paint();
    await loadData();
    if (!Favs.map.size && section === 'fav') section = 'tech';
    render();
  }
  // Escape closes even when focus fell back to <body> (e.g. after a disabled button).
  function onDocKey(e){ if (e.key === 'Escape' && ov && !document.querySelector('.stkc-dialog')) { e.stopPropagation(); e.preventDefault(); close(); } }
  function close(){
    if (!ov) return;
    ov.remove(); ov = null; els = null;
    document.body.classList.remove('stkiw-open');
    document.removeEventListener('keydown', onDocKey, true);
    try { if (ws.trackDialog) ws.trackDialog(false); } catch (e) {}
  }

  function paint(){
    if (!els) return;
    els.side.querySelectorAll('.stkiw-tab').forEach((b) => b.setAttribute('aria-selected', !authorFilter && !els.search.value.trim() && b.dataset.k === section ? 'true' : 'false'));
    els.target.textContent = targetText();
  }

  // ---- rendering ----
  function row(it){
    const fav = Favs.has(it.key);
    const star = h('button', { type: 'button', class: 'stkiw-star' + (fav ? ' on' : ''), 'aria-pressed': fav ? 'true' : 'false',
      'aria-label': (fav ? 'Remove ' : 'Add ') + it.name + (fav ? ' from' : ' to') + ' favorites', title: fav ? 'Remove from favorites' : 'Add to favorites', html: SVG(I_STAR) });
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      star.disabled = true;
      try {
        const on = await Favs.toggle(it.key, it.name);
        star.classList.toggle('on', on); star.setAttribute('aria-pressed', on ? 'true' : 'false');
        star.title = on ? 'Remove from favorites' : 'Add to favorites';
        if (section === 'fav' && !on && !els.search.value.trim()) render();
      } catch (err) { console.warn('Stryker: favourite', err); toast('Could not save the favourite.', 'error'); }
      star.disabled = false;
    });
    const name = h('button', { type: 'button', class: 'stkiw-name', title: it.gone ? 'No longer published' : 'Add to chart' }, [
      h('span', { class: 'stkiw-nm', text: it.name }),
      it.desc ? h('span', { class: 'stkiw-desc', text: it.desc }) : null,
      it.locked ? h('span', { class: 'stkiw-lock', title: 'Code hidden in the editor', 'aria-label': 'code hidden', html: SVG(I_LOCK, 13) }) : null,
      it.s && it.s.picked ? h('span', { class: 'stkiw-pick', text: "Editors' pick" }) : null,
      it.beta ? h('span', { class: 'stkiw-pick', text: 'beta' }) : null,
      it.third ? h('span', { class: 'stkiw-pick is-third', text: 'Community \u00b7 third-party' }) : null,
      it.gone ? h('span', { class: 'stkiw-pick is-warn', text: 'No longer published' }) : null,
      h('span', { class: 'stkiw-sub', text: it.author || '' })
    ]);
    const li = h('div', { class: 'stkiw-row', role: 'listitem', 'data-key': it.key });
    if (it.kind === 'onchart') { name.disabled = true; name.title = ''; }
    else if (!it.gone) name.addEventListener('click', () => addItem(it, li));
    else name.disabled = true;
    let auth;
    if (it.kind === 'community' && it.authorUid) {
      auth = h('button', { type: 'button', class: 'stkiw-auth is-link', text: it.author, title: 'Public scripts by ' + it.author,
        onclick: (e) => { e.stopPropagation(); authorFilter = { uid: it.authorUid, name: it.author }; els.search.value = ''; render(); } });
    } else auth = h('span', { class: 'stkiw-auth', text: it.author || '' });
    const extra = h('span', { class: 'stkiw-x2' });
    if (it.kind === 'community' && it.s) extra.appendChild(h('button', { type: 'button', class: 'stkiw-ib', 'aria-label': 'Details for ' + it.name, title: 'Details, code, report',
      html: SVG(I_INFO, 15), onclick: (e) => { e.stopPropagation(); close(); L().openCommunity('all', it.name); } }));
    if (it.kind === 'onchart') {
      extra.appendChild(h('button', { type: 'button', class: 'stkiw-ib stkc-del', 'aria-label': 'Remove ' + it.name + ' from the chart', title: 'Remove from the chart', html: SVG(I_TRASH, 15),
        onclick: (e) => { e.stopPropagation(); try { if (it.handle) it.handle.remove(); else ws.active.removeFromChart(it.index); } catch (err) {} try { ws.context().stateChanged(); } catch (err) {} render(); } }));
    }
    [star, name, auth, extra].forEach((n) => li.appendChild(n));
    return li;
  }

  // Built-ins from Vela's on-chart list, plus Pine scripts (added through the public
  // addIndicator seam, so Vela's list doesn't carry them).
  function onChartItems(){
    let rows = [];
    try { rows = ws.active.onChartRows(); } catch (e) {}
    const out = rows.map((r, i) => ({ key: 'z:' + i, name: r.name, author: r.native ? (r.language === 'stryker' ? 'Stryker' : 'Built-in') : 'Script', kind: 'onchart', index: i }));
    const a = activeCell();
    const pine = P();
    if (a.cell && pine && pine.pineHandles) {
      pine.pineHandles(a.cell.chart).forEach((hd, i) => {
        const lib = pine.libOf && pine.libOf.get(hd);
        out.push({ key: 'zp:' + i, name: lib ? lib.name : pine.titleOf(hd), author: lib ? 'Community' : 'Pine script', kind: 'onchart', handle: hd, locked: !!(lib && !lib.openSource) });
      });
    }
    return out;
  }

  function favItems(all){
    const by = new Map(all.map((x) => [x.key, x]));
    const out = [];
    Favs.map.forEach((name, key) => {
      const it = by.get(key);
      if (it) out.push(it);
      else if (key.startsWith('c:') || key.startsWith('m:')) out.push({ key, name, author: '', kind: 'gone', gone: true });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const day = () => Math.floor(Date.now() / 86400000);
  function week(ring){ const t = day(); let n = 0; if (ring && typeof ring === 'object') Object.keys(ring).forEach((k) => { const v = ring[k]; if (v && v.d > t - 7 && v.d <= t + 1) n += Number(v.n) || 0; }); return n; }

  // Every Stryker-made script: the natives/examples named in STRYKER_PICKS, then every
  // PICKER_SCRIPTS entry with section 'picks'. Future entries appear with no extra wiring.
  function strykerItems(all){
    const by = new Map(all.map((x) => [x.key, x])), seen = new Set();
    return STRYKER_PICKS.concat(PICKER_SCRIPTS.filter((b) => b.section === 'picks').map((b) => 'x:' + b.id))
      .filter((k) => !seen.has(k) && seen.add(k)).map((k) => by.get(k)).filter(Boolean);
  }
  // Third-party built-ins (PICKER_SCRIPTS section 'community'): no usage stats, so they
  // follow the member scripts in Top and Trending, alphabetical.
  function thirdItems(all){ return all.filter((x) => x.third).sort((a, b) => a.name.localeCompare(b.name)); }

  function sectionItems(all){
    const comm = all.filter((x) => x.kind === 'community');
    if (authorFilter) return { title: 'Scripts by ' + authorFilter.name, items: comm.filter((x) => x.authorUid === authorFilter.uid).sort((a, b) => b.boosts - a.boosts) };
    switch (section) {
      case 'fav': return { title: 'Favorites', items: favItems(all), empty: 'Star any indicator or script to keep it here.' };
      case 'mine': return { title: 'My scripts', items: all.filter((x) => x.kind === 'mine'), empty: S() && S().signedIn() ? 'No saved scripts yet. Write one in the Pine editor and press Save.' : 'Sign in to keep scripts on your account.' };
      case 'onchart': return { title: 'On this chart', items: onChartItems(), empty: 'Nothing on this chart yet.' };
      case 'stryker': return { title: 'Stryker', note: 'every Stryker indicator', items: strykerItems(all), empty: 'No Stryker indicators yet.' };
      case 'picks': {
        // Default: every Stryker script (same derived list as the Stryker tab), then
        // admin-picked community scripts. Curate later by changing strykerItems' source.
        return { title: "Editors' picks", note: 'Stryker indicators', items: strykerItems(all).concat(comm.filter((x) => x.s.picked).sort((a, b) => (b.s.pickedAt || 0) - (a.s.pickedAt || 0))), empty: 'No picks yet.' };
      }
      case 'top': return { title: 'Top', note: 'community and third-party scripts', items: comm.slice().sort((a, b) => (b.boosts - a.boosts) || (b.s.addCount - a.s.addCount)).concat(thirdItems(all)), empty: 'No community scripts yet.' };
      case 'trending': {
        const sc = (x) => week(x.s.boostRing) + week(x.s.addRing);
        return { title: 'Trending', note: 'last 7 days', items: comm.filter((x) => sc(x) > 0).sort((a, b) => (sc(b) - sc(a)) || (b.boosts - a.boosts)).concat(thirdItems(all)), empty: 'Nothing trending this week.' };
      }
      default: return { title: 'Technicals', grouped: true, items: all.filter((x) => (x.kind === 'builtin' || x.kind === 'example') && !x.third) };
    }
  }

  function render(){
    if (!els) return;
    paint();
    const all = allItems();
    const q = els.search.value.trim().toLowerCase();
    const list = els.list;
    list.innerHTML = '';
    let view;
    if (q) {
      const hit = (x) => x.name.toLowerCase().includes(q) || String(x.author || '').toLowerCase().includes(q) || (x.s && (x.s.tags || []).some((t) => t.includes(q)));
      const parts = [['My scripts', all.filter((x) => x.kind === 'mine' && hit(x))], ['Technicals', all.filter((x) => (x.kind === 'builtin' || x.kind === 'example') && !x.third && hit(x))],
        ['Community \u00b7 third-party', all.filter((x) => x.third && hit(x))],
        ['Community', all.filter((x) => x.kind === 'community' && hit(x)).sort((a, b) => b.boosts - a.boosts)]];
      els.title.textContent = 'Results for \u201c' + els.search.value.trim() + '\u201d';
      let n = 0;
      parts.forEach(([t, a]) => { if (!a.length) return; n += a.length; list.appendChild(h('p', { class: 'stkiw-grp', text: t })); a.forEach((x) => list.appendChild(row(x))); });
      if (!n) list.appendChild(h('p', { class: 'stkiw-empty', text: 'Nothing matches.' }));
      return;
    }
    view = sectionItems(all);
    els.title.textContent = view.title;
    if (view.note) els.title.appendChild(h('small', { text: ' \u00b7 ' + view.note }));
    if (authorFilter) els.title.appendChild(h('button', { type: 'button', class: 'stkiw-link', text: 'Clear', onclick: () => { authorFilter = null; render(); } }));
    // Top/Trending: third-party built-ins always list; member scripts need sign-in + the library.
    if (['top', 'trending'].includes(section) && !authorFilter && communityErr) list.appendChild(h('p', { class: 'stkiw-empty', text: 'Could not load member scripts. Check your connection.' }));
    else if (['top', 'trending'].includes(section) && !authorFilter && !fbUser()) list.appendChild(h('p', { class: 'stkiw-empty', text: 'Sign in to see member-published scripts too.' }));
    if (view.grouped) {
      CATS.forEach((c) => {
        const a = view.items.filter((x) => x.cat === c);
        if (!a.length) return;
        if (c !== GROUP_FLOW && c !== GROUP_STRYKER) a.sort((x, y) => x.name.localeCompare(y.name));
        list.appendChild(h('p', { class: 'stkiw-grp', text: c }));
        a.forEach((x) => list.appendChild(row(x)));
      });
    } else {
      view.items.forEach((x) => list.appendChild(row(x)));
    }
    if (!view.items.length) list.appendChild(h('p', { class: 'stkiw-empty', text: view.empty || 'Nothing here yet.' }));
  }

  // Take over Vela's picker: topbar button + "/" shortcut open this window.
  picker.open = () => { open(); };
  picker.close = () => { close(); };
  // Vela calls sync() when a cell's catalog lands late (new cell, symbol change).
  let syncT = 0;
  picker.sync = () => { if (ov && !els.search.value.trim() && (section === 'onchart' || section === 'tech' || section === 'fav')) { clearTimeout(syncT); syncT = setTimeout(render, 120); } };
  try { ws.on('cell:active', () => { if (ov) render(); }); } catch (e) {}
  window.addEventListener('resize', () => { if (ov) paint(); });

  const api = { open, close, render, Favs, fmtCount, ws };
  window.StrykerIndicatorWindow = api;
  return api;
}
