// TradeZoro — Charts: the "Add to chart" indicator picker (ES module)
// Depends on: assets/vela-chart.js (calls mountIndicatorWindow(ws, opts) after the
// order-flow group and the Community row are installed); assets/chart-pine.js
// (window.STRYKER_PINE.addSource: runs a Pine source on the active cell);
// assets/chart-pine-scripts.js (window.StrykerPineScripts: My scripts + examples);
// assets/chart-pine-library.js (window.StrykerPineLibrary: Community scripts, boosts,
// Editors' picks); assets/indicator-picker.json (per-indicator slug, thumbnail, markets,
// inputs, summary, first release: written by tools/gen-indicator-pages.js);
// assets/indicator-explain.json ("What it shows"); assets/chart-community-disclaimer.js
// (reads .stkiw-list[data-sect] and the .stkiw-grp headings); the global firebase compat SDK (favourites).
//
// WHAT IT IS (Owner order 15 Nov 2026: "this indicator search looks exactly like tradingview,
// make it a bit different ... more appealing"). Replaces the build-415 TradingView-style window and
// still takes over ws.indicatorPicker.open/close/sync, so the topbar "Indicators" button and the
// "/" shortcut open it.
//   Header   "Add to chart" + a chip with the target chart (e.g. "NQ · 1m").
//   Search   one rounded field over every source: name, description, tags, aliases; typo tolerant,
//            plain-language words ("gamma levels", "volume spikes"), matches highlighted.
//   Rail     icons + counts: All, Favourites, On this chart, My scripts / My Zscripts, TradeZoro,
//            Order Flow, Options & GEX, Volume & Profile, Trend, Momentum, Volatility,
//            Levels & Events, Community (sub-tabs Top / Trending / Editors' picks / Your communities).
//   Rows     thumbnail (the indicator's own chart capture, else a category glyph; never made-up
//            numbers), name, one-line description, tag chips, markets badge, star, Add pill.
//   Detail   right pane on desktop, bottom sheet on a phone (tap a row): bigger preview, summary,
//            what it shows, inputs, "Works on", Add / Add & open settings, link to /indicators/<slug>.
//   Extras   multi-select ("Add 3"), sort Popular / A-Z / New, market filter chips, keyboard
//            (↑↓, Enter, Shift+Enter, Space, F, Esc), recently used at the top of All.
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
// x:<id> TradeZoro example, m:<id> My script, c:<id> Community script, o:<name> other.
// RECENTLY USED: localStorage stryker_ind_recent (last 8 built-in keys added from this window).
//
// "Popular" chips only where real numbers back them (community scripts with the most adds);
// built-ins have no usage stats, so the Popular sort lists TradeZoro's own first, then catalogue order.
// No Vela / LuxAlgo / TradingView wording anywhere in view (Owner order 2026-10-05).

import { PICKER_SCRIPTS, STRYKER_PICKS, builtinSource } from './chart-pine-builtins.js?v=1056';
import { entry as verEntry, fmtDate as verDate } from './indicator-versions.js?v=1056';
import { kindOf as proKind, locked as proLocked, upgrade as proUpgrade, proTag, onTier as onProTier, L1_TO_L2, GEX_TYPES } from './chart-pro-gate.js?v=1056';

const PHONE_MAX = 700;
const FAV_LS = 'stryker_chart_favs';
const RECENT_LS = 'stryker_ind_recent';
const GROUP_FLOW = 'Volume';
const GROUP_OF = 'Order Flow';   // every order-flow tool (rows come from chart-orderflow.js)
const GROUP_STRYKER = 'TradeZoro';
const CATS = [GROUP_STRYKER, 'Moving averages', 'Oscillators', 'Volatility', GROUP_OF, GROUP_FLOW, 'Trend', 'Levels'];
const MARKETS = ['Futures', 'Stocks', 'Crypto', 'Options'];
const ALL_MARKETS = ['Futures', 'Stocks', 'Crypto', 'Forex'];
const GEXT = new Set(GEX_TYPES.concat(['stk_tide']));
const NEW_DAYS = 21;

function catOf(name){
  const n = String(name || '');
  if (/Moving Average|Dynamic Average|Regression Curve|Alligator|EMA|SMA\b/i.test(n)) return 'Moving averages';
  if (/Bollinger|Keltner|Donchian|Average True Range|Volatility|Standard Deviation|Ulcer|Mass Index|Choppiness|Chandelier|Squeeze/i.test(n)) return 'Volatility';
  if (/SuperTrend|Parabolic|Aroon|Directional|Vortex|ZigZag|Kroll|Ichimoku/i.test(n)) return 'Trend';
  if (/Pivot|52 Week|Fractal|High\/Low|high\/low|Previous day/i.test(n)) return 'Levels';
  if (/Order flow|Footprint|Delta|CVD/i.test(n)) return GROUP_OF;
  if (/Volume|VWAP|Balance Volume|Accumulation|Money Flow|Ease of Movement|Force Index|Klinger|Intraday Intensity|Chaikin Oscillator|Price Volume/i.test(n)) return GROUP_FLOW;
  return 'Oscillators';
}

export function fmtCount(n){
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) { const k = n / 1000; return (k < 100 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'K'; }
  const m = n / 1e6; return (m < 100 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)) + 'M';
}

const SVG = (inner, w) => '<svg width="' + (w || 20) + '" height="' + (w || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
const I_STAR = '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>';
const I_LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const I_TRASH = '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>';
const I_SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>';
const I_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
const I_PLUS = '<path d="M12 5v14M5 12h14"/>';
const I_CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const I_EXT = '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>';
const I_SLIDERS = '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>';
// rail icons (one family: 24 grid, 1.8 stroke)
const RI = {
  all: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  fav: I_STAR,
  onchart: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  mine: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  stryker: '<path d="M6 6h12L6 18h12"/>',
  orderflow: '<rect x="4" y="4" width="6" height="4" rx="1"/><rect x="14" y="4" width="6" height="4" rx="1"/><rect x="4" y="10" width="6" height="4" rx="1"/><rect x="14" y="10" width="6" height="4" rx="1"/><rect x="4" y="16" width="6" height="4" rx="1"/><rect x="14" y="16" width="6" height="4" rx="1"/>',
  gex: '<path d="M4 6h10M4 10h16M4 14h7M4 18h13"/>',
  volume: '<path d="M5 20v-6M10 20V8M15 20v-9M20 20V4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  momentum: '<path d="M3 12c2.5-6 4.5-6 6 0s3.5 6 6 0 4-6 6 0"/>',
  volatility: '<path d="M3 8c4-3 7 3 9 0s6-3 9 0M3 16c4 3 7-3 9 0s6 3 9 0"/>',
  levels: '<path d="M4 7h16M4 12h16M4 17h16" stroke-dasharray="3 3"/>',
  community: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 19a4 4 0 0 1 6.5-3"/>'
};
// Card glyphs per group (64x40): a sketch of the kind of thing the indicator draws. No numbers, no data.
const GLYPH = {
  orderflow: '<g opacity=".9"><rect x="13" y="7" width="12" height="6" rx="1.5" fill="var(--gl-a)"/><rect x="27" y="7" width="12" height="6" rx="1.5" fill="var(--gl-b)"/><rect x="13" y="15" width="12" height="6" rx="1.5" fill="var(--gl-b)"/><rect x="27" y="15" width="12" height="6" rx="1.5" fill="var(--gl-a)"/><rect x="13" y="23" width="12" height="6" rx="1.5" fill="var(--gl-a)"/><rect x="27" y="23" width="12" height="6" rx="1.5" fill="var(--gl-a)"/><rect x="41" y="11" width="12" height="6" rx="1.5" fill="var(--gl-b)"/><rect x="41" y="19" width="12" height="6" rx="1.5" fill="var(--gl-a)"/><rect x="41" y="27" width="12" height="6" rx="1.5" fill="var(--gl-b)"/></g>',
  gex: '<g stroke-width="1.6"><path d="M8 10h44" stroke="var(--gl-a)"/><path d="M8 19h48" stroke="var(--gl-c)" stroke-dasharray="3 2"/><path d="M8 28h38" stroke="var(--gl-b)"/></g><g opacity=".55"><rect x="8" y="12" width="20" height="3" rx="1.5" fill="var(--gl-a)"/><rect x="8" y="21" width="11" height="3" rx="1.5" fill="var(--gl-c)"/><rect x="8" y="30" width="26" height="3" rx="1.5" fill="var(--gl-b)"/></g>',
  volume: '<g opacity=".9"><rect x="9" y="22" width="5" height="11" rx="1.5" fill="var(--gl-a)"/><rect x="17" y="13" width="5" height="20" rx="1.5" fill="var(--gl-b)"/><rect x="25" y="18" width="5" height="15" rx="1.5" fill="var(--gl-a)"/><rect x="33" y="8" width="5" height="25" rx="1.5" fill="var(--gl-a)"/><rect x="41" y="20" width="5" height="13" rx="1.5" fill="var(--gl-b)"/><rect x="49" y="15" width="5" height="18" rx="1.5" fill="var(--gl-a)"/></g>',
  trend: '<path d="M8 30C18 28 22 18 32 17s16-8 24-9" stroke="var(--gl-a)" stroke-width="2.2"/><path d="M8 33C18 32 23 24 33 23s15-7 23-8" stroke="var(--gl-c)" stroke-width="1.6" opacity=".8"/>',
  momentum: '<path d="M6 11h52M6 29h52" stroke="var(--gl-c)" stroke-dasharray="2 3" opacity=".7"/><path d="M6 24c5-14 9-14 13-2s8 12 12 0 8-14 13-6 8 8 12 2" stroke="var(--gl-a)" stroke-width="2.2"/>',
  volatility: '<path d="M6 12c10-6 16 4 26 0s16-6 26 0" stroke="var(--gl-a)" stroke-width="1.8"/><path d="M6 28c10 6 16-4 26 0s16 6 26 0" stroke="var(--gl-b)" stroke-width="1.8"/><path d="M6 20c10 0 16 2 26 0s16-2 26 0" stroke="var(--gl-c)" stroke-dasharray="3 2"/>',
  levels: '<path d="M6 11h52M6 20h52M6 29h52" stroke="var(--gl-c)" stroke-dasharray="4 3"/><path d="M8 26l8-10 7 6 9-12 8 9 8-4 8 6" stroke="var(--gl-a)" stroke-width="2.2"/>',
  community: '<path d="M22 12l-8 8 8 8M42 12l8 8-8 8" stroke="var(--gl-a)" stroke-width="2.2"/><path d="M35 10l-6 20" stroke="var(--gl-c)" stroke-width="2"/>',
  mine: '<path d="M22 12l-8 8 8 8M42 12l8 8-8 8" stroke="var(--gl-a)" stroke-width="2.2"/><path d="M28 30h10" stroke="var(--gl-c)" stroke-width="2"/>',
  onchart: '<path d="M32 8l20 8-20 8-20-8z" stroke="var(--gl-a)" stroke-width="2"/><path d="M12 22l20 8 20-8" stroke="var(--gl-c)" stroke-width="2"/>'
};
const glyphSvg = (k) => '<svg viewBox="0 0 64 40" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (GLYPH[k] || GLYPH.momentum) + '</svg>';

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

// ---------------- favourites store (unchanged data shape) ----------------
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
          s.forEach((d) => { const x = d.data() || {}; if (x.key && !String(x.key).startsWith('sym:')) m.set(x.key, x.name || x.key); });   // sym: = symbol-search favourites (assets/chart-search.js)
        } catch (e) { console.warn('TradeZoro: favourites', e); }
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

const Recent = {
  list(){ try { const a = JSON.parse(localStorage.getItem(RECENT_LS) || '[]'); return Array.isArray(a) ? a.filter((k) => typeof k === 'string').slice(0, 8) : []; } catch (e) { return []; } },
  push(key){ if (!/^[bpx]:/.test(key)) return; try { localStorage.setItem(RECENT_LS, JSON.stringify([key].concat(this.list().filter((k) => k !== key)).slice(0, 8))); } catch (e) {} }
};

// ---------------- search: words, synonyms, typos ----------------
const STOP = new Set('a an and the of for to with on in me show find i want my any that which what is are it its indicator indicators tool tools something like see'.split(' '));
const SYN = {
  gamma: ['gex'], gex: ['gamma'], spike: ['burst', 'big', 'surge', 'relative'], spikes: ['burst', 'big', 'surge', 'relative'], whale: ['big', 'large'], whales: ['big', 'large'],
  ma: ['moving'], vol: ['volume', 'volatility'], orderflow: ['footprint', 'delta', 'order'], dark: ['off-exchange', 'darkpool'], options: ['gex', 'gamma', 'option', 'calls'],
  stops: ['stop', 'sweep', 'liquidity'], fvg: ['ifvg', 'gap'], book: ['dom', 'depth', 'resting'], news: ['headline', 'events'],
  levels: ['level', 'walls', 'pivots'], momentum: ['oscillator', 'rsi'], profile: ['vpvr', 'poc', 'tpo']
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const words = (s) => norm(s).split(/[^a-z0-9%+]+/).filter(Boolean);
function lev(a, b, max){
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// How well one query word hits one field: whole word > word prefix > substring > typo. [score, word to highlight]
function tokHit(t, ws, str){
  if (ws.includes(t)) return [3, t];
  if (ws.some((w) => w.startsWith(t))) return [2.6, t];
  if (t.length >= 3 && str.includes(t)) return [2, t];
  if (t.length >= 4) {
    const max = t.length >= 7 ? 2 : 1;
    for (const w of ws) if (w.length >= 3 && (lev(t, w, max) <= max || (w.length > t.length && lev(t, w.slice(0, t.length), 1) <= 1))) return [1.4, w];
  }
  return [0, null];
}
export function queryTokens(q){ const t = words(q).filter((x) => !STOP.has(x)); return t.length ? t : words(q); }
// Score one item's index { n name words, ns name text, d desc words, ds, g tag words, gs } against the query words.
// Name hits weigh 3x, tags 2x, description 1x; with several words at least half must hit.
export function scoreOf(ix, toks){
  if (!toks.length) return { score: 0, marks: [] };
  let total = 0, hit = 0; const marks = [];
  for (const t of toks) {
    let best = 0;
    for (const alt of [t].concat(SYN[t] || [])) {
      const f = alt === t ? 1 : 0.75;
      const [a, wa] = tokHit(alt, ix.n, ix.ns); const [b] = tokHit(alt, ix.g, ix.gs); const [c, wc] = tokHit(alt, ix.d, ix.ds);
      best = Math.max(best, Math.max(a * 3, b * 2, c) * f);
      if (wa) marks.push(wa);
      if (wc) marks.push(wc);
    }
    if (best > 0) hit++;
    total += best;
  }
  if (hit < (toks.length === 1 ? 1 : Math.ceil(toks.length / 2))) return { score: 0, marks: [] };
  return { score: total + (hit === toks.length ? 4 : 0), marks: [...new Set(marks)] };
}
// Text with <mark> around every matched word (built as text nodes: safe for member-written names).
function marked(text, marks){
  const s = String(text || '');
  if (!marks || !marks.length) return document.createTextNode(s);
  const low = s.toLowerCase(); const rng = [];
  marks.forEach((m) => { let i = 0; while (m && (i = low.indexOf(m, i)) >= 0) { rng.push([i, i + m.length]); i += m.length; } });
  if (!rng.length) return document.createTextNode(s);
  rng.sort((a, b) => a[0] - b[0]);
  const f = document.createDocumentFragment(); let at = 0;
  rng.forEach(([a, b]) => { if (a < at) a = at; if (b <= a) return; f.appendChild(document.createTextNode(s.slice(at, a))); f.appendChild(h('mark', { text: s.slice(a, b) })); at = b; });
  f.appendChild(document.createTextNode(s.slice(at)));
  return f;
}

// ---------------- the window ----------------
export function mountIndicatorWindow(ws, opts){
  const toast = (opts && opts.toast) || (() => {});
  const tfLabel = (opts && opts.tfLabel) || ((t) => t);
  const picker = ws && ws.indicatorPicker;
  if (!picker || picker.__stkWindow) return null;
  picker.__stkWindow = true;

  let ov = null, els = null, section = 'all', csub = 'top', authorFilter = null, isAdmin = false;
  let community = null, communityErr = false, mine = null;
  let sortBy = 'popular', hiKey = null, sheetKey = null, view = [];
  const mk = new Set(), sel = new Map();   // market filter chips; multi-select key -> item
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const L = () => window.StrykerPineLibrary;
  const S = () => window.StrykerPineScripts;
  const P = () => window.STRYKER_PINE;

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
    return (a.count > 1 ? 'Chart ' + (a.index + 1) + ' \u00b7 ' : '') + sym + ' \u00b7 ' + tfLabel(a.cell.timeframe);
  }

  // per-key facts from tools/gen-indicator-pages.js (slug, thumbnail, markets, inputs, summary, release)
  let meta = {}, metaP = null, explainMap = null, explainP = null;
  function loadMeta(){
    if (!metaP) metaP = fetch('/assets/indicator-picker.json?v=1056').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((m) => { meta = m || {}; });
    return metaP;
  }
  function loadExplain(){
    if (!explainP) explainP = fetch('/assets/indicator-explain.json?v=1056').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((m) => { explainMap = m || {}; });
    return explainP;
  }

  // ---- items from every source ----
  function builtins(){
    let rows = [];
    try { rows = ws.active.libraryRows(); } catch (e) {}
    const out = [];
    rows.forEach((r) => {
      if (!r || r.category === 'Community') return;
      let key, author = 'Built-in', cat;
      if (r.pseudo) { key = 'p:' + r.pseudo; author = 'TradeZoro'; cat = GROUP_FLOW; }
      else if (r.native) { key = 'b:' + r.nativeType; if (/^stk_/.test(r.nativeType)) author = 'TradeZoro'; cat = r.category === GROUP_FLOW || r.category === GROUP_OF ? r.category : catOf(r.name); }
      else { key = 'o:' + String(r.name).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60); cat = catOf(r.name); author = 'TradeZoro'; }
      let desc = '';
      if (r.native && r.nativeType === 'stk_gex') { cat = GROUP_STRYKER; desc = 'Call wall, put wall, zero gamma, IV ±68% and market levels (pVAH/pPOC/pVAL, ONH/ONL) from the GEX page (SPX, SPY, QQQ, ES, NQ and gold GC)'; }
      if (r.native && r.nativeType === 'stk_gexheat') { cat = GROUP_STRYKER; desc = 'Net GEX at every strike through the session, drawn behind the candles (SPX, SPY, QQQ, ES, NQ and gold GC)'; }
      if (r.native && r.nativeType === 'stk_em') { cat = GROUP_STRYKER; desc = 'Options-implied expected move (ATM straddle) for 0DTE, 1DTE, weekly and monthly (SPX, SPY, QQQ, ES, NQ)'; }
      if (r.native && r.nativeType === 'stk_camarilla') { cat = 'Levels'; desc = 'Camarilla levels R5 to S5, Y-High / Y-Close / Y-Low and the R3-RB3 / S3-SB3 zones from the prior day, week or month'; }
      if (r.native && r.nativeType === 'stk_tide') { cat = GROUP_STRYKER; desc = 'Options money flow: net call premium (green) vs net put premium (red) since the open, in a lower pane (SPX, SPY, QQQ, ES, NQ)'; }
      if (r.native && r.nativeType === 'stk_zrange') { cat = GROUP_STRYKER; desc = 'Shaded Zoro Range bands (0DTE, 1DTE, weekly, monthly) from the ATM straddle'; }
      if (r.native && r.nativeType === 'stk_zzone') { cat = GROUP_STRYKER; desc = 'A faint tint above the Flip Line (Cushion) and below it (Swing)'; }
      if (r.native && r.nativeType === 'stk_ivrank') { cat = GROUP_STRYKER; desc = '30-day implied volatility with its 1-year low and high, IV rank and percentile'; }
      if (r.native && /^stk_(dex|vex|cex)$/.test(r.nativeType)) { cat = GROUP_STRYKER; desc = { stk_dex: 'Dealer delta exposure', stk_vex: 'Dealer vanna exposure', stk_cex: 'Dealer charm exposure' }[r.nativeType] + ' by strike on the price axis, with the 3 largest strikes as lines. All expiries, 0DTE or next expiry'; }
      if (r.native && r.nativeType === 'stk_zvol') { cat = GROUP_STRYKER; desc = 'Marks where a contract had Fresh Volume (volume above open interest) or a Volume Burst. Volume only, no buyer or seller side'; }
      if (r.native && r.nativeType === 'stk_optflow') { cat = GROUP_STRYKER; desc = 'Bubbles on the candles where call (green) or put (red) premium was large, sized by premium; hover or tap for details. Per-bar totals, not single trades (SPX, SPY, QQQ, ES, NQ)'; }
      if (r.native && r.nativeType === 'stk_offex') { cat = GROUP_STRYKER; desc = 'Daily off-exchange share of volume in a lower pane. FINRA data, updated daily'; }
      if (r.native && r.nativeType === 'stk_hlintel') { cat = GROUP_STRYKER; desc = 'Hyperliquid charts: tap a candle to see the wallets that traded it, plus liquidation and stop-order clusters of tracked wallets. Updated every few minutes'; }
      if (r.native && r.nativeType === 'stk_darkpool') { cat = GROUP_STRYKER; desc = 'Large off-exchange stock trades drawn at their exact price and time, sized by $ value; $10M+ highlighted. US stocks and ETFs, updated every 2 hours'; }
      if (r.native && r.nativeType === 'stk_offex_lv') { cat = GROUP_STRYKER; desc = 'Price levels where weekly off-exchange volume clustered (average price of the week). FINRA data, updated weekly'; }
      if (r.native && r.nativeType === 'stk_news') { cat = GROUP_STRYKER; desc = 'Headline markers on the time axis for the chart’s market; hover or tap to read them'; }
      if (r.native && r.nativeType === 'stk_earn') { cat = GROUP_STRYKER; desc = 'An “E” on the day a US company reports earnings, with the EPS estimate on hover. Data updated daily'; }
      if (r.native && r.nativeType === 'stk_econ') { cat = GROUP_STRYKER; desc = 'High-impact releases (CPI, FOMC, NFP, GDP…) as dashed lines, with a “CPI in 12 min” warning chip'; }
      out.push({ key, name: r.name, author, cat, kind: 'builtin', beta: !!r.beta, desc, hidden: !!r.hidden, aliases: (r.aliases || []).join(' ') });
    });
    const ex = (S() && S().EXAMPLES) || [];
    ex.forEach((x) => out.push({ key: 'x:' + String(x.id).replace(/^example:/, ''), name: x.name, author: 'TradeZoro', cat: catOf(x.name), kind: 'example', source: x.source }));
    // Pine scripts from assets/chart-pine-builtins.js (next-gen engine). section 'picks' = the
    // Owner's own (TradeZoro); 'community' = third-party, credited to its own author, never TradeZoro.
    PICKER_SCRIPTS.forEach((b) => {
      const third = b.section !== 'picks';
      out.push({ key: 'x:' + b.id, name: b.name, author: third ? (b.author || 'Community') : 'TradeZoro', cat: third ? (b.group === 'flow' ? GROUP_OF : null) : GROUP_STRYKER,
        kind: 'example', builtinId: b.id, desc: b.desc, third, rightOffset: b.rightOffset });
    });
    return out;
  }
  function mineItems(){
    return (mine || []).map((t) => ({ key: 'm:' + t.id, name: t.name, author: 'You', kind: 'mine', source: t.source, id: t.id, badge: 'Pine', desc: 'Your saved script' }));
  }
  function commItems(){
    return (community || []).map((s) => ({ key: 'c:' + s.id, name: s.name, author: s.authorName, authorUid: s.ownerUid, kind: 'community', s,
      boosts: s.boostCount || 0, adds: s.addCount || 0, locked: !s.openSource, desc: String(s.description || s.desc || '').slice(0, 240), tags: s.tags || [] }));
  }
  // Creator Hub indicators (assets/creator-ind-chart.js): usable ones run sealed; locked ones link to the community.
  let cinds = null, cindErr = false;
  const CI = () => window.StrykerCommunityInd;
  function cindItems(){
    return (cinds || []).map((x) => ({ key: 'ci:' + x.cid + '/' + x.iid, name: x.name, author: x.cname, kind: 'cind', ci: x, logo: x.logo, accent: x.accent,
      locked: !x.usable, desc: x.usable ? 'From ' + x.cname : 'You are in ' + x.cname + ', but your plan does not include this one.' }));
  }
  // Zscript (assets/chart-zscript.js, window.STRYKER_ZS): New Zscript, the Examples, the member's saved Zscripts.
  const Z = () => window.STRYKER_ZS;
  let zsMine = null;
  function zsItems(){
    if (!Z()) return [];
    return [{ key: 'zn:new', name: 'New Zscript', author: 'You', kind: 'zsnew', desc: 'Write your own indicator in Zscript, our indicator language. Opens the editor.' }]
      .concat(Z().examples.map((x) => ({ key: 'zx:' + x.id.replace(/^zs-example:/, ''), name: x.name, author: 'TradeZoro', kind: 'zsex', source: x.source, badge: 'Example', desc: 'A Zscript example: add it, or open it in the editor to learn from it' })))
      .concat((zsMine || []).map((t) => ({ key: 'zm:' + t.id, name: t.name, author: 'You', kind: 'zsmine', source: t.source, badge: 'Zscript', desc: 'Your saved Zscript' })));
  }
  let cacheAll = null;
  function allItems(){
    if (cacheAll) return cacheAll;
    const all = builtins().concat(mineItems(), commItems(), cindItems(), zsItems());
    const pop = new Set(all.filter((x) => x.kind === 'community' && x.adds > 0).sort((a, b) => b.adds - a.adds).slice(0, 5).map((x) => x.key));
    all.forEach((x) => decorate(x, pop));
    cacheAll = all;
    return all;
  }
  const invalidate = () => { cacheAll = null; };

  // rail group, markets, tags and search index for one item
  function railOf(it){
    if (it.kind === 'community' || it.kind === 'cind') return 'community';
    if (it.kind === 'mine' || /^z[nxm]:/.test(it.key)) return 'mine';
    const t = it.key.startsWith('b:') ? it.key.slice(2) : '';
    if (GEXT.has(t)) return 'gex';
    if (it.cat === GROUP_OF || t === 'stk_hlintel') return 'orderflow';
    if (it.third) return 'community';
    if (/^stk_(darkpool|offex|offex_lv)$/.test(t)) return 'volume';
    if (/^stk_(news|econ|earn|msess)$/.test(t)) return 'levels';
    if (it.cat === GROUP_FLOW) return 'volume';
    if (it.cat === 'Moving averages' || it.cat === 'Trend') return 'trend';
    if (it.cat === 'Volatility') return 'volatility';
    if (it.cat === 'Levels') return 'levels';
    if (it.cat === GROUP_STRYKER) return /ema|cross/i.test(it.name) ? 'trend' : /vwap/i.test(it.name) ? 'volume' : 'levels';
    return 'momentum';
  }
  const daysSince = (d) => (Date.now() - Date.parse(d + 'T00:00:00Z')) / 864e5;
  function decorate(it, pop){
    const m = meta[it.key];
    it.rail = railOf(it);
    it.markets = m && m.m ? m.m : (/^(community|example|mine|cind)$/.test(it.kind) || /^z/.test(it.key) ? ALL_MARKETS : null);
    it.released = m && m.r ? m.r : '';
    it.summary = (m && m.d) || '';
    if (!it.desc) it.desc = it.summary;
    const tags = [];
    if (it.rail === 'orderflow' && !it.third) tags.push('Order flow');
    if (it.rail === 'gex') tags.push('GEX');
    if (it.released && daysSince(it.released) <= NEW_DAYS) tags.push('NEW');
    if (pop.has(it.key)) tags.push('Popular');
    it.tagList = tags;
    const g = tags.join(' ') + ' ' + (RAIL_NAME[it.rail] || '') + ' ' + (it.markets || []).join(' ') + ' ' + (it.tags || []).join(' ') + ' ' + (it.author || '') + ' ' + (SEARCH_ALIAS[it.key] || '');
    it.ix = { n: words(it.name + ' ' + (it.aliases || '')), ns: norm(it.name + ' ' + (it.aliases || '')), d: words(it.desc + ' ' + it.summary), ds: norm(it.desc + ' ' + it.summary), g: words(g), gs: norm(g) };
  }
  // the L2 versions that already exist under another name (Owner 2026-11-03): typing the old name finds them
  const SEARCH_ALIAS = { 'b:stk_fut_imb': 'imbalance zones imbalance', 'b:stk_bk_track': 'absorption absorption (l2)' };

  async function loadData(){
    const tasks = [Favs.load(), loadMeta()];
    if (S()) tasks.push(S().list().then((r) => { mine = r.items || []; }).catch(() => { mine = []; }));
    if (Z()) tasks.push(Z().store.list().then((r) => { zsMine = r.items || []; }).catch(() => { zsMine = []; }));
    if (L() && fbUser()) {
      tasks.push(L().listPublic().then((a) => { community = a; communityErr = false; }).catch((e) => { console.warn('TradeZoro: community list', e); community = []; communityErr = true; }));
      tasks.push(L().isAdmin().then((a) => { isAdmin = a; }));
    } else { community = []; }
    if (CI() && fbUser()) tasks.push(CI().list().then((a) => { cinds = a; cindErr = false; }).catch((e) => { console.warn('TradeZoro: community indicators', e); cinds = []; cindErr = true; }));
    else cinds = [];
    await Promise.all(tasks);
    invalidate();
  }

  // ---- add / remove ----
  const canAdd = (it) => !it.gone && it.kind !== 'onchart' && it.kind !== 'zsnew' && !(it.kind === 'cind' && it.locked);
  const canMulti = (it) => canAdd(it) && !it.key.startsWith('p:');
  async function addItem(it, rowEl, o){
    o = o || {};
    const a = activeCell();
    if (!a.cell) { toast('No chart to add it to.', 'error'); return false; }
    if (it.kind === 'builtin' && it.key.startsWith('b:') && proLocked(proKind(it.key.slice(2)))) { close(); proUpgrade(proKind(it.key.slice(2))); return false; }
    if (rowEl) rowEl.classList.add('is-busy');
    let ok = false;
    try {
      if (it.kind === 'builtin') {
        const rows = ws.active.libraryRows();
        const idx = rows.findIndex((r) => r && r.category !== 'Community' && (
          (it.key.startsWith('p:') && r.pseudo === it.key.slice(2)) ||
          (it.key.startsWith('b:') && r.native && r.nativeType === it.key.slice(2)) ||
          (it.key.startsWith('o:') && !r.native && !r.pseudo && r.name === it.name)));
        if (idx < 0) { toast('That indicator is not available on this chart.', 'error'); return false; }
        const pseudo = it.key.startsWith('p:');
        if (pseudo) close();   // the drawing-tool rows need the chart
        ws.active.addFromLibrary(idx);
        ok = true;
        if (!pseudo && !o.quiet) toast('Added ' + it.name + ' to the chart');
      } else if (it.kind === 'example' || it.kind === 'mine') {
        if (!P() || !P().addSource) { toast('The chart is still loading. Try again in a moment.', 'error'); return false; }
        let src = it.source, so;
        if (it.builtinId) {
          try { src = await builtinSource(it.builtinId); } catch (e) { toast('Could not load ' + it.name + '. Check your connection.', 'error'); return false; }
          so = { engine: 'next', builtin: true, rightOffset: it.rightOffset };
        }
        const r = await P().addSource(it.name, src, so);
        ok = !!r.ok;
        if (!r.ok && !r.heavy) toast(r.msg || 'Could not add the script.', 'error');
      } else if (it.kind === 'zsnew') {
        close(); Z().openNew(); return false;
      } else if (it.kind === 'zsex' || it.kind === 'zsmine') {
        const r = await Z().addSource(it.name, it.source);
        if (!r.ok) { close(); Z().open(it.source, it.name); toast(r.msg || 'Could not add the script.', 'error'); return false; }
        ok = true;
      } else if (it.kind === 'cind') {
        if (it.locked) { close(); location.href = '/c/' + encodeURIComponent(it.ci.cid) + '?tab=indicators'; return false; }
        const r = await CI().add(it.ci);
        ok = !!r.ok;
        if (!r.ok && !r.heavy) toast(r.msg || 'Could not add the indicator.', 'error');
      } else if (it.kind === 'community') {
        if (!L() || !L().addItem) return false;
        const r = await L().addItem(it.s);
        ok = !!r.ok;
        if (!r.ok && !r.heavy) toast(r.msg || 'Could not add the script.', 'error');
      }
    } catch (e) {
      console.warn('TradeZoro: add from window', e);
      toast('Could not add it to the chart.', 'error');
    } finally {
      if (rowEl) rowEl.classList.remove('is-busy');
    }
    if (ok) Recent.push(it.key);
    if (o.batch) return ok;
    if (ov && section === 'onchart') render();
    if (ov && isPhone() && it.kind !== 'builtin') close();
    else if (ov && ok) { flash(it.key); paintCounts(); }
    return ok;
  }
  function flash(key){
    const r = rowOf(key);
    if (r) { r.classList.add('is-added'); setTimeout(() => r.classList.remove('is-added'), 1400); }
  }
  // Add, then open the new indicator's settings dialog on the chart.
  async function addWithSettings(it){
    const a = activeCell();
    if (!a.cell || !canMulti(it)) return;
    const ids = () => { try { return a.cell.chart.indicators().map((x) => x.id); } catch (e) { return []; } };
    const before = new Set(ids());
    const ok = await addItem(it, null, { batch: true, quiet: true });
    close();
    if (!ok) return;
    let id = null;
    for (let i = 0; i < 20 && !id; i++) { await new Promise((r) => setTimeout(r, 100)); id = ids().filter((x) => !before.has(x)).pop() || null; }
    const rd = a.cell.chart.renderer;
    if (id && rd && typeof rd.openIndicatorSettings === 'function') { try { rd.openIndicatorSettings(id); return; } catch (e) {} }
    toast('Added ' + it.name + '. Open its settings from the chart legend.');
  }
  async function addSelected(){
    const list = [...sel.values()].filter(canMulti);
    if (!list.length || !els) return;
    els.addSel.disabled = true;
    let n = 0;
    for (const it of list) if (await addItem(it, rowOf(it.key), { quiet: true, batch: true })) n++;
    sel.clear();
    if (n) toast('Added ' + n + ' indicator' + (n === 1 ? '' : 's') + ' to the chart');
    if (ov && isPhone()) close(); else if (ov) render();
  }

  // ---- open / close ----
  const RAIL_NAME = { all: 'All indicators', fav: 'Favourites', onchart: 'On this chart', mine: 'My scripts', zscript: 'My Zscripts', stryker: 'TradeZoro', orderflow: 'Order Flow', gex: 'Options & GEX',
    volume: 'Volume & Profile', trend: 'Trend', momentum: 'Momentum', volatility: 'Volatility', levels: 'Levels & Events', community: 'Community' };
  const RAIL = () => [['Yours', ['all', 'fav', 'onchart', Z() ? 'zscript' : 'mine']], ['Browse', ['stryker', 'orderflow', 'gex', 'volume', 'trend', 'momentum', 'volatility', 'levels']], ['Shared', ['community']]];
  const CSUBS = [['top', 'Top'], ['trending', 'Trending'], ['picks', "Editors' picks"], ['mycomm', 'Your communities']];
  const SORTS = [['popular', 'Popular'], ['az', 'A\u2013Z'], ['new', 'New']];
  const kbd = (k) => h('kbd', { text: k });

  function build(){
    const search = h('input', { type: 'search', class: 'stkiw-search', placeholder: 'Search indicators, or describe what you want', 'aria-label': 'Search indicators', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-controls': 'stkiw-list', 'aria-expanded': 'true', 'aria-autocomplete': 'list', enterkeyhint: 'search' });
    const rail = h('nav', { class: 'stkiw-side stkc-scroll', 'aria-label': 'Indicator groups' });
    const list = h('div', { class: 'stkiw-list stkc-scroll', id: 'stkiw-list', role: 'listbox', 'aria-label': 'Indicators', 'aria-multiselectable': 'true', tabindex: '-1' });
    const title = h('h3', { class: 'stkiw-sect' });
    // Community sub-tabs keep the old .stkiw-tab[data-k] hooks (top / trending / picks / mycomm) that other suites click.
    const ctabs = h('div', { class: 'stkiw-ctabs', role: 'tablist', 'aria-label': 'Community lists' });
    CSUBS.forEach(([k, n]) => ctabs.appendChild(h('button', { type: 'button', class: 'stkiw-tab stkiw-ctab', role: 'tab', 'data-k': k, text: n,
      onclick: () => { section = 'community'; csub = k; authorFilter = null; els.search.value = ''; hiKey = null; render(); els.list.scrollTop = 0; } })));
    const chips = h('div', { class: 'stkiw-chips', role: 'group', 'aria-label': 'Filter by market' });
    MARKETS.forEach((m) => chips.appendChild(h('button', { type: 'button', class: 'stkiw-chip', 'aria-pressed': 'false', 'data-m': m, text: m,
      onclick: (e) => { mk.has(m) ? mk.delete(m) : mk.add(m); e.currentTarget.setAttribute('aria-pressed', mk.has(m) ? 'true' : 'false'); render(); } })));
    const sort = h('div', { class: 'stkiw-seg', role: 'radiogroup', 'aria-label': 'Sort' });
    SORTS.forEach(([k, n]) => sort.appendChild(h('button', { type: 'button', role: 'radio', 'data-s': k, 'aria-checked': k === sortBy ? 'true' : 'false', text: n,
      onclick: () => { sortBy = k; sort.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.s === k ? 'true' : 'false')); render(); } })));
    const detail = h('aside', { class: 'stkiw-detail stkc-scroll', 'aria-label': 'Indicator details' });
    const chip = h('span', { class: 'stkiw-ctx', title: 'The chart it adds to' });
    const selN = h('span', { class: 'stkiw-seln' });
    const addSel = h('button', { type: 'button', class: 'stkiw-btn is-primary stkiw-addsel', onclick: () => addSelected() });
    const selbar = h('div', { class: 'stkiw-selbar', hidden: '' }, [selN, h('button', { type: 'button', class: 'stkiw-btn is-text', text: 'Clear', onclick: () => { sel.clear(); render(); } }), addSel]);
    const hints = h('div', { class: 'stkiw-hints', 'aria-hidden': 'true' }, [
      h('span', null, [kbd('\u2191'), kbd('\u2193'), ' Move']), h('span', null, [kbd('\u21b5'), ' Add']), h('span', null, [kbd('\u21e7\u21b5'), ' Add & settings']),
      h('span', null, [kbd('Space'), ' Select']), h('span', null, [kbd('F'), ' Favourite']), h('span', null, [kbd('Esc'), ' Close'])]);
    const foot = h('div', { class: 'stkiw-foot' }, [
      hints, selbar,
      h('span', { class: 'stkiw-foot-r' }, [
        h('button', { type: 'button', class: 'stkiw-link', text: 'Publish or manage community scripts', onclick: () => { close(); if (L()) L().openCommunity(); } }),
        h('span', { class: 'stkiw-note', text: 'Education only. Not financial advice.' })
      ])
    ]);
    const sheet = h('div', { class: 'stkiw-sheet', hidden: '', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Indicator details' });
    const card = h('div', { class: 'stkiw-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add to chart' }, [
      h('div', { class: 'stkiw-hd' }, [
        h('div', { class: 'stkiw-hd-l' }, [h('h2', { text: 'Add to chart' }), chip]),
        h('button', { type: 'button', class: 'stkiw-x', 'aria-label': 'Close', title: 'Close (Esc)', html: SVG(I_CLOSE, 20), onclick: () => close() })
      ]),
      h('div', { class: 'stkiw-sr' }, [h('span', { class: 'stkiw-sicon', html: SVG(I_SEARCH, 20) }), search]),
      h('div', { class: 'stkiw-tools' }, [chips, sort]),
      h('div', { class: 'stkiw-body' }, [rail, h('div', { class: 'stkiw-main' }, [title, ctabs, list]), detail]),
      foot, sheet
    ]);
    const o = h('div', { class: 'stkiw-ov', onclick: (e) => { if (e.target === o) close(); } }, [card]);
    o.addEventListener('keydown', onKey);
    search.addEventListener('input', () => { hiKey = null; render(); els.list.scrollTop = 0; });
    list.addEventListener('scroll', () => { if (isPhone()) search.blur(); }, { passive: true });
    els = { search, rail, list, title, ctabs, chips, sort, detail, chip, selbar, selN, addSel, hints, card, sheet };
    return o;
  }

  async function open(){
    if (ov) return;
    ov = build();
    document.body.appendChild(ov);
    document.body.classList.add('stkiw-open');
    document.addEventListener('keydown', onDocKey, true);
    try { if (ws.trackDialog) ws.trackDialog(true); } catch (e) {}
    authorFilter = null; sheetKey = null; sel.clear(); invalidate();
    els.list.innerHTML = '';
    if (window.skel) { const w = h('div'); w.innerHTML = skel.html('rows', 8, 2); els.list.appendChild(w); } else els.list.appendChild(h('p', { class: 'stkiw-empty', text: 'Loading\u2026' }));
    if (!isPhone()) setTimeout(() => els && els.search.focus(), 0);
    paint();
    try { window.STRYKER_PINE && window.STRYKER_PINE.warm(); window.__stkHeavyNow && window.__stkHeavyNow(); } catch (e) {}   // LAYOUT-PERF: engines load while the member picks
    loadExplain().then(() => { if (ov && hiKey && !isPhone()) highlight(hiKey, false); });
    await loadData();
    if (!ov) return;
    if (!Favs.map.size && section === 'fav') section = 'all';
    render();
  }
  // Escape closes the sheet, then the window, even when focus fell back to <body>.
  function onDocKey(e){
    if (e.key !== 'Escape' || !ov || document.querySelector('.stkc-dialog')) return;
    e.stopPropagation(); e.preventDefault();
    if (sheetKey) closeSheet(); else close();
  }
  function close(){
    if (!ov) return;
    ov.remove(); ov = null; els = null; sheetKey = null;
    document.body.classList.remove('stkiw-open');
    document.removeEventListener('keydown', onDocKey, true);
    try { if (ws.trackDialog) ws.trackDialog(false); } catch (e) {}
  }

  // ---- keyboard: ↑↓ move, Enter add, Shift+Enter add & settings, Space select, F favourite, Esc close ----
  function onKey(e){
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); if (sheetKey) closeSheet(); else close(); return; }
    if (!els || sheetKey) return;
    const inSearch = e.target === els.search;
    const inList = !!(e.target.closest && e.target.closest('.stkiw-list'));
    if (!inSearch && !inList) return;
    const i = view.findIndex((x) => x.key === hiKey);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!view.length) return;
      const n = i < 0 ? 0 : e.key === 'ArrowDown' ? Math.min(view.length - 1, i + 1) : Math.max(0, i - 1);
      highlight(view[n].key, true);
      return;
    }
    const it = view[i];
    if (e.key === 'Enter' && (it || sel.size)) {
      e.preventDefault();
      if (e.shiftKey && it) addWithSettings(it);
      else if (sel.size) addSelected();
      else if (canAdd(it) || it.kind === 'zsnew') addItem(it, rowOf(it.key));
      return;
    }
    if (inSearch) return;   // letters and space type in the search field
    if (e.key === ' ' && it) { e.preventDefault(); toggleSel(it); return; }
    if ((e.key === 'f' || e.key === 'F') && it && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFav(it); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) els.search.focus();   // typing on the list goes back to search
  }
  const rowOf = (key) => (els ? els.list.querySelector('.stkiw-row[data-key="' + CSS.escape(key) + '"]') : null);
  function highlight(key, focus){
    hiKey = key;
    if (!els) return;
    els.list.querySelectorAll('.stkiw-row.is-hi').forEach((r) => r.classList.remove('is-hi'));
    const r = rowOf(key);
    if (r) {
      r.classList.add('is-hi');
      els.search.setAttribute('aria-activedescendant', r.id);
      if (focus) {
        // keep the row in view inside the list only (never scrollIntoView: it scrolls every ancestor)
        const l = els.list, top = r.offsetTop;
        if (top < l.scrollTop + 8) l.scrollTop = top - 40; else if (top + r.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = top + r.offsetHeight - l.clientHeight + 8;
        if (document.activeElement !== els.search) r.focus({ preventScroll: true });
      }
    }
    const it = view.find((x) => x.key === key);
    if (it && !isPhone()) renderDetail(els.detail, it);
  }
  async function toggleFav(it, btn){
    if (it.kind === 'onchart' || it.kind === 'zsnew' || !els) return;
    try {
      const on = await Favs.toggle(it.key, it.name);
      if (!els) return;
      const r = rowOf(it.key);
      if (r && r.querySelector('.stkiw-star')) setStar(r.querySelector('.stkiw-star'), on, it.name);
      if (btn) setStar(btn, on, it.name);
      if (section === 'fav' && !on && !els.search.value.trim()) render(); else paintCounts();
      if (sheetKey === it.key) renderDetail(els.sheet.querySelector('.stkiw-sheet-bd'), it);
      else if (hiKey === it.key && !isPhone()) renderDetail(els.detail, it);
    } catch (err) { console.warn('TradeZoro: favourite', err); toast('Could not save the favourite.', 'error'); }
  }
  function setStar(b, on, name){
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Remove from favourites (F)' : 'Add to favourites (F)';
    b.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + name + (on ? ' from' : ' to') + ' favourites');
  }
  function toggleSel(it){
    if (!canMulti(it)) return;
    if (sel.has(it.key)) sel.delete(it.key); else sel.set(it.key, it);
    const r = rowOf(it.key);
    if (r) { r.classList.toggle('is-sel', sel.has(it.key)); r.setAttribute('aria-selected', sel.has(it.key) ? 'true' : 'false'); const c = r.querySelector('.stkiw-chk'); if (c) c.setAttribute('aria-checked', sel.has(it.key) ? 'true' : 'false'); }
    paintSel();
  }

  function paint(){
    if (!els) return;
    els.chip.textContent = targetText();
    els.chip.hidden = !els.chip.textContent;
    const n = cacheAll ? cacheAll.filter((x) => (x.kind === 'builtin' || x.kind === 'example') && !x.hidden && !x.key.startsWith('p:')).length : 0;
    const cnt = n >= 20 ? Math.floor(n / 10) * 10 + '+ ' : '';
    els.search.placeholder = isPhone() ? 'Search ' + cnt + 'indicators' : 'Search ' + cnt + 'indicators, or describe what you want (e.g. \u2018gamma levels\u2019, \u2018volume spikes\u2019)';
  }
  function paintSel(){
    if (!els) return;
    const n = sel.size;
    els.selbar.hidden = !n; els.hints.hidden = !!n;
    els.card.classList.toggle('has-sel', !!n);
    els.selN.textContent = n + ' selected';
    els.addSel.textContent = 'Add ' + n;
    els.addSel.disabled = !n;
  }

  // ---- lists ----
  // Built-ins from Vela's on-chart list, plus Pine scripts (added through the public
  // addIndicator seam, so Vela's list doesn't carry them).
  function onChartItems(){
    let rows = [];
    try { rows = ws.active.onChartRows(); } catch (e) {}
    const out = rows.map((r, i) => ({ key: 'z:' + i, name: r.name, author: r.native ? (r.language === 'stryker' ? 'TradeZoro' : 'Built-in') : 'Script', kind: 'onchart', index: i }));
    const a = activeCell();
    const pine = P();
    if (a.cell && pine && pine.pineHandles) {
      pine.pineHandles(a.cell.chart).forEach((hd, i) => {
        const lib = pine.libOf && pine.libOf.get(hd);
        const z = pine.sealOf && pine.sealOf.get(hd);
        out.push({ key: 'zp:' + i, name: z ? z.name : lib ? lib.name : pine.titleOf(hd), author: z ? 'From your communities' : lib ? 'Community' : 'Pine script', kind: 'onchart', handle: hd, locked: !!(z || (lib && !lib.openSource)) });
      });
    }
    if (a.cell && Z()) Z().handles(a.cell.chart).forEach((hd, i) => out.push({ key: 'zz:' + i, name: Z().titleOf(hd.source), author: 'Zscript', kind: 'onchart', handle: hd }));
    out.forEach((x) => { x.rail = 'onchart'; x.tagList = []; x.desc = 'On this chart now'; });
    return out;
  }
  function favItems(all){
    const by = new Map(all.map((x) => [x.key, x]));
    const out = [];
    Favs.map.forEach((name, key) => {
      const tw = key.startsWith('b:') && L1_TO_L2[key.slice(2)];   // a starred L1 order-flow tool hidden on futures: show its L2 twin (Owner 2026-11-06)
      const it = by.get(key) || (tw && by.get('b:' + tw));
      if (it && out.includes(it)) return;
      if (it) out.push(it);
      else if (key.startsWith('c:') || key.startsWith('m:')) out.push({ key, name, author: '', kind: 'gone', gone: true, rail: 'community', tagList: [], desc: '' });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const day = () => Math.floor(Date.now() / 86400000);
  function week(ring){ const t = day(); let n = 0; if (ring && typeof ring === 'object') Object.keys(ring).forEach((k) => { const v = ring[k]; if (v && v.d > t - 7 && v.d <= t + 1) n += Number(v.n) || 0; }); return n; }
  // Every TradeZoro-made script: the natives/examples named in STRYKER_PICKS, then every
  // PICKER_SCRIPTS entry with section 'picks'. Future entries appear with no extra wiring.
  function strykerItems(all){
    const by = new Map(all.map((x) => [x.key, x])), seen = new Set();
    return STRYKER_PICKS.concat(PICKER_SCRIPTS.filter((b) => b.section === 'picks').map((b) => 'x:' + b.id))
      .filter((k) => !seen.has(k) && seen.add(k)).map((k) => by.get(k)).filter(Boolean);
  }
  function thirdItems(all){ return all.filter((x) => x.third).sort((a, b) => a.name.localeCompare(b.name)); }
  const browsable = (x) => (x.kind === 'builtin' || x.kind === 'example') && !x.hidden;

  function sectionView(all){
    const comm = all.filter((x) => x.kind === 'community');
    if (section === 'community') {
      if (authorFilter) return { title: 'Scripts by ' + authorFilter.name, items: comm.filter((x) => x.authorUid === authorFilter.uid).sort((a, b) => b.boosts - a.boosts), keep: true };
      switch (csub) {
        case 'mycomm': return { title: 'Your communities', items: all.filter((x) => x.kind === 'cind'), keep: true,
          empty: !fbUser() ? 'Sign in to see indicators from your communities.' : cindErr ? 'Could not load them. Check your connection.' : 'No community indicators yet. Join a community on TradeZoro to use its indicators here.' };
        case 'picks': return { title: "Editors' picks", note: 'TradeZoro indicators', items: strykerItems(all).concat(comm.filter((x) => x.s.picked).sort((a, b) => (b.s.pickedAt || 0) - (a.s.pickedAt || 0))), empty: 'No picks yet.', keep: true };
        case 'trending': {
          const sc = (x) => week(x.s.boostRing) + week(x.s.addRing);
          return { title: 'Trending', note: 'last 7 days', items: comm.filter((x) => sc(x) > 0).sort((a, b) => (sc(b) - sc(a)) || (b.boosts - a.boosts)).concat(thirdItems(all)), empty: 'Nothing trending this week.', keep: true };
        }
        default: return { title: 'Top', note: 'community and third-party scripts', items: comm.slice().sort((a, b) => (b.boosts - a.boosts) || (b.adds - a.adds)).concat(thirdItems(all)), empty: 'No community scripts yet.', keep: true };
      }
    }
    switch (section) {
      case 'fav': return { title: 'Favourites', items: favItems(all), empty: 'Star any indicator to keep it here. On a computer, press F on a highlighted row.' };
      case 'onchart': return { title: 'On this chart', items: onChartItems(), empty: 'Nothing on this chart yet.', keep: true };
      case 'mine': case 'zscript': return { title: RAIL_NAME[section], note: Z() ? 'your Pine scripts and Zscripts' : null, items: all.filter((x) => x.rail === 'mine'), keep: true,
        empty: S() && S().signedIn() ? 'No saved scripts yet. Write one in the editor and press Save.' : 'Sign in to keep scripts on your account.' };
      case 'stryker': return { title: 'TradeZoro', note: 'made by TradeZoro', items: strykerItems(all), keep: true };
      case 'all': {
        const by = new Map(all.map((x) => [x.key, x]));
        return { title: 'All indicators', items: all.filter(browsable), recent: Recent.list().map((k) => by.get(k)).filter(Boolean), grouped: true };
      }
      default: return { title: RAIL_NAME[section] || '', items: all.filter((x) => browsable(x) && x.rail === section), empty: 'Nothing here yet.' };
    }
  }
  const marketOk = (x) => !mk.size || !x.markets || x.markets.some((m) => mk.has(m) || (m === 'Stocks' && mk.has('Options') && x.markets.includes('Options')));
  function sorted(a, keep){
    if (sortBy === 'az') return a.slice().sort((x, y) => x.name.localeCompare(y.name));
    if (sortBy === 'new') return a.slice().sort((x, y) => (y.released || '').localeCompare(x.released || '') || x.name.localeCompare(y.name));
    if (keep) return a;
    // Popular: TradeZoro's own first (GEX Levels, then the GEX Heatmap), then the catalogue order
    const rk = (x) => (x.key === 'b:stk_gex' ? 0 : x.key === 'b:stk_gexheat' ? 1 : x.author === 'TradeZoro' ? 2 : 3);
    return a.map((x, i) => [x, i]).sort((p, q) => (rk(p[0]) - rk(q[0])) || (p[1] - q[1])).map((p) => p[0]);
  }

  function paintRail(){
    const rail = els.rail;
    if (!rail.firstChild) RAIL().forEach(([label, keys]) => {
      rail.appendChild(h('p', { class: 'stkiw-side-h', text: label }));
      keys.forEach((k) => rail.appendChild(h('button', { type: 'button', class: 'stkiw-tab', 'data-k': k, role: 'tab', title: RAIL_NAME[k],
        onclick: () => { section = k; authorFilter = null; els.search.value = ''; hiKey = null; render(); els.list.scrollTop = 0; } },
        [h('span', { class: 'stkiw-ri', html: SVG(RI[k === 'zscript' ? 'mine' : k], 20) }), h('span', { class: 'stkiw-rl', text: RAIL_NAME[k] }), h('span', { class: 'stkiw-rc' })])));
    });
    paintCounts();
  }
  function paintCounts(){
    if (!els) return;
    const all = allItems();
    const n = {
      all: all.filter((x) => browsable(x) && marketOk(x)).length, fav: favItems(all).filter(marketOk).length, onchart: onChartItems().length,
      community: all.filter((x) => (x.kind === 'community' || x.kind === 'cind' || x.third) && marketOk(x)).length, stryker: strykerItems(all).filter(marketOk).length
    };
    n.mine = n.zscript = all.filter((x) => x.rail === 'mine' && x.kind !== 'zsnew').length;
    ['orderflow', 'gex', 'volume', 'trend', 'momentum', 'volatility', 'levels'].forEach((k) => { n[k] = all.filter((x) => browsable(x) && x.rail === k && marketOk(x)).length; });
    const q = els.search.value.trim();
    els.rail.querySelectorAll('.stkiw-tab').forEach((b) => {
      b.querySelector('.stkiw-rc').textContent = n[b.dataset.k] ? String(n[b.dataset.k]) : '';
      b.setAttribute('aria-selected', !q && b.dataset.k === section ? 'true' : 'false');
    });
    els.ctabs.querySelectorAll('.stkiw-ctab').forEach((b) => b.setAttribute('aria-selected', !q && section === 'community' && b.dataset.k === csub ? 'true' : 'false'));
  }

  function tagEl(t){ return h('span', { class: 'stkiw-pick' + (t === 'NEW' ? ' is-new' : t === 'Popular' ? ' is-pop' : t === 'GEX' ? ' is-gex' : t === 'Order flow' ? ' is-of' : ''), text: t }); }
  function fitText(m){
    if (!m) return '';
    if (ALL_MARKETS.every((x) => m.includes(x))) return 'All markets';
    return m.length === 1 ? m[0] + ' only' : m.join(' \u00b7 ');
  }
  function thumbEl(it, big){
    const m = meta[it.key];
    const w = h('span', { class: 'stkiw-thumb' + (big ? ' is-big' : ''), 'data-g': it.rail || 'momentum', 'aria-hidden': 'true' });
    if (it.kind === 'cind' && it.logo) w.appendChild(h('img', { src: it.logo, alt: '', loading: 'lazy', class: 'is-logo' }));
    else if (m && m.t) {
      const img = h('img', { src: m.t, alt: '', loading: 'lazy', decoding: 'async', width: '480', height: '270' });
      img.addEventListener('error', () => { img.remove(); w.insertAdjacentHTML('afterbegin', glyphSvg(it.rail)); });
      w.appendChild(img);
    } else w.innerHTML = glyphSvg(it.rail);
    return w;
  }

  let rowSeq = 0;
  function row(it, marks){
    const fav = Favs.has(it.key);
    const li = h('div', { class: 'stkiw-row', role: 'option', id: 'stkiw-o' + (++rowSeq), 'data-key': it.key, tabindex: '-1', 'aria-selected': sel.has(it.key) ? 'true' : 'false' });
    if (sel.has(it.key)) li.classList.add('is-sel');
    if (it.key === hiKey) li.classList.add('is-hi');
    const th = thumbEl(it);
    if (canMulti(it)) {
      const chk = h('button', { type: 'button', class: 'stkiw-chk', role: 'checkbox', 'aria-checked': sel.has(it.key) ? 'true' : 'false', 'aria-label': 'Select ' + it.name + ' to add several', title: 'Select to add several (Space)', html: SVG(I_CHECK, 14) });
      chk.addEventListener('click', (e) => { e.stopPropagation(); toggleSel(it); });
      th.appendChild(chk);
    }
    const l1 = h('span', { class: 'stkiw-l1' }, [
      h('span', { class: 'stkiw-nm' }, [marked(it.name, marks)]),
      it.locked ? h('span', { class: 'stkiw-lock', title: it.kind === 'cind' ? 'Not in your plan' : 'Code hidden in the editor', 'aria-label': it.kind === 'cind' ? 'locked' : 'code hidden', html: SVG(I_LOCK, 14) }) : null,
      (it.kind === 'builtin' && it.key.startsWith('b:') && proLocked(proKind(it.key.slice(2)))) ? proTag() : null
    ]);
    if (it.kind === 'community' && it.s && it.s.version) l1.appendChild(h('span', { class: 'stkiw-vtag', text: 'v' + it.s.version }));
    if (it.kind === 'cind' && it.ci && it.ci.version) l1.appendChild(h('span', { class: 'stkiw-vtag', text: 'v' + it.ci.version }));
    (it.tagList || []).forEach((t) => l1.appendChild(tagEl(t)));
    if (it.s && it.s.picked) l1.appendChild(tagEl("Editors' pick"));
    if (it.kind === 'cind' && !it.locked) l1.appendChild(tagEl('protected'));
    if (it.beta) l1.appendChild(tagEl('beta'));
    if (it.badge) l1.appendChild(tagEl(it.badge));
    if (it.third) l1.appendChild(h('span', { class: 'stkiw-pick is-third', text: 'Community \u00b7 third-party' }));
    if (it.gone) l1.appendChild(h('span', { class: 'stkiw-pick is-warn', text: 'No longer published' }));
    const fit = fitText(it.markets);
    const metaLine = h('span', { class: 'stkiw-meta' }, [
      it.author ? h('span', { class: 'stkiw-by' }, [it.kind === 'onchart' ? '' : 'by ', h('span', { class: 'stkiw-sub', text: it.author })]) : null,
      fit ? h('span', { class: 'stkiw-fit' + (fit === 'All markets' ? ' is-all' : ''), text: fit }) : null
    ]);
    const name = h('button', { type: 'button', class: 'stkiw-name', title: it.gone ? 'No longer published' : it.kind === 'cind' && it.locked ? 'Get access on the community page' : '' }, [
      l1, it.desc ? h('span', { class: 'stkiw-desc' }, [marked(it.desc, marks)]) : null, metaLine]);
    if (it.gone) name.disabled = true;
    name.addEventListener('click', (e) => {
      if (isPhone()) { openSheet(it); return; }          // phone: tap opens the detail sheet; the Add pill adds
      if (e.ctrlKey || e.metaKey || (sel.size && canMulti(it))) { toggleSel(it); return; }
      if (it.kind === 'onchart') return;
      addItem(it, li);
    });
    const acts = h('span', { class: 'stkiw-acts' });
    if (it.kind !== 'onchart' && it.kind !== 'zsnew') {
      const star = h('button', { type: 'button', class: 'stkiw-star' + (fav ? ' on' : ''), html: SVG(I_STAR, 20) });
      setStar(star, fav, it.name);
      star.addEventListener('click', async (e) => { e.stopPropagation(); star.disabled = true; await toggleFav(it, star); star.disabled = false; });
      acts.appendChild(star);
    }
    if (it.kind === 'cind' && it.locked) acts.appendChild(h('a', { class: 'stkiw-get', href: '/c/' + encodeURIComponent(it.ci.cid) + '?tab=indicators', text: 'Get access', onclick: (e) => e.stopPropagation() }));
    if (it.kind === 'onchart') {
      acts.appendChild(h('button', { type: 'button', class: 'stkiw-ib stkc-del', 'aria-label': 'Remove ' + it.name + ' from the chart', title: 'Remove from the chart', html: SVG(I_TRASH, 20),
        onclick: (e) => { e.stopPropagation(); try { if (it.handle) it.handle.remove(); else ws.active.removeFromChart(it.index); } catch (err) {} try { ws.context().stateChanged(); } catch (err) {} render(); } }));
    } else if (canAdd(it) || it.kind === 'zsnew') {
      acts.appendChild(h('button', { type: 'button', class: 'stkiw-add', 'aria-label': it.kind === 'zsnew' ? 'Open the Zscript editor' : 'Add ' + it.name + ' to the chart', title: it.kind === 'zsnew' ? 'Open the editor' : 'Add to chart (Enter)',
        onclick: (e) => { e.stopPropagation(); addItem(it, li); } }, [h('span', { class: 'stkiw-add-i', html: SVG(I_PLUS, 18) }), h('span', { class: 'stkiw-add-t', text: it.kind === 'zsnew' ? 'Open' : 'Add' })]));
    }
    [th, name, acts].forEach((n) => li.appendChild(n));
    li.addEventListener('mouseenter', () => { if (!isPhone() && hiKey !== it.key) highlight(it.key, false); });
    return li;
  }

  // ---- detail (right pane on desktop, bottom sheet on a phone) ----
  function renderDetail(box, it){
    if (!box) return;
    box.innerHTML = '';
    if (!it) { box.appendChild(h('p', { class: 'stkiw-empty', text: 'Point at an indicator to see what it draws.' })); return; }
    const m = meta[it.key] || null;
    box.appendChild(thumbEl(it, true));
    const ttl = h('div', { class: 'stkiw-d-ttl' }, [h('h3', { text: it.name })]);
    if (it.kind !== 'onchart' && it.kind !== 'zsnew' && !it.gone) {
      const st = h('button', { type: 'button', class: 'stkiw-star' + (Favs.has(it.key) ? ' on' : ''), html: SVG(I_STAR, 20) });
      setStar(st, Favs.has(it.key), it.name);
      st.addEventListener('click', async () => { st.disabled = true; await toggleFav(it, st); st.disabled = false; });
      ttl.appendChild(st);
    }
    box.appendChild(ttl);
    if (it.author) {
      const by = h('p', { class: 'stkiw-d-by' }, [it.kind === 'onchart' ? it.author : 'Published by ' + it.author]);
      if (it.kind === 'community' && it.authorUid) by.appendChild(h('button', { type: 'button', class: 'stkiw-link', text: 'More by ' + it.author,
        onclick: () => { authorFilter = { uid: it.authorUid, name: it.author }; section = 'community'; els.search.value = ''; closeSheet(); render(); } }));
      box.appendChild(by);
    }
    const tg = h('div', { class: 'stkiw-d-tags' });
    (it.tagList || []).forEach((t) => tg.appendChild(tagEl(t)));
    if (it.third) tg.appendChild(h('span', { class: 'stkiw-pick is-third', text: 'Community \u00b7 third-party' }));
    if (m && m.p === 'Pro') tg.appendChild(tagEl('Pro'));
    if (tg.childNodes.length) box.appendChild(tg);
    const text = (m && m.d) || it.desc;
    if (text) box.appendChild(h('p', { class: 'stkiw-d-desc', text }));
    if (it.markets) {
      box.appendChild(h('h4', { text: 'Works on' }));
      box.appendChild(h('div', { class: 'stkiw-d-mk' }, it.markets.map((x) => h('span', { class: 'stkiw-mk', text: x }))));
    }
    const ve = (it.kind === 'builtin' || it.kind === 'example') ? verEntry(it.key) : null;
    if (ve) { const cur = ve.versions[ve.versions.length - 1]; box.appendChild(h('p', { class: 'stkiw-ver' }, [h('b', { text: 'v' + cur.v }), verDate(cur.date) + ' \u00b7 latest'])); }
    const ex = explainMap && explainMap[it.key];
    if (ex && ex.shows && ex.shows.length) {
      box.appendChild(h('h4', { text: 'What it shows' }));
      box.appendChild(h('ul', { class: 'stkiw-d-ul' }, ex.shows.slice(0, 2).map((l) => h('li', { text: l }))));
    }
    if (m && m.i && m.i.length) {
      box.appendChild(h('h4', { text: 'Inputs' }));
      const ul = h('div', { class: 'stkiw-d-in' }, m.i.map((x) => h('span', { text: x })));
      if (m.n > m.i.length) ul.appendChild(h('span', { class: 'is-more', text: '+' + (m.n - m.i.length) + ' more' }));
      box.appendChild(ul);
    }
    const acts = h('div', { class: 'stkiw-d-acts' });
    if (it.kind === 'onchart') acts.appendChild(h('p', { class: 'stkiw-d-note', text: 'On this chart now. Change or remove it from the chart legend.' }));
    else if (it.kind === 'cind' && it.locked) acts.appendChild(h('a', { class: 'stkiw-btn is-primary', href: '/c/' + encodeURIComponent(it.ci.cid) + '?tab=indicators', text: 'Get access' }));
    else if (canAdd(it) || it.kind === 'zsnew') {
      acts.appendChild(h('button', { type: 'button', class: 'stkiw-btn is-primary stkiw-d-add', html: SVG(I_PLUS, 20) + '<span>' + (it.kind === 'zsnew' ? 'Open the editor' : 'Add to chart') + '</span>',
        onclick: () => { closeSheet(); addItem(it, rowOf(it.key)); } }));
      if (canMulti(it)) acts.appendChild(h('button', { type: 'button', class: 'stkiw-btn is-tonal stkiw-d-set', html: SVG(I_SLIDERS, 20) + '<span>Add & open settings</span>', onclick: () => addWithSettings(it) }));
    }
    if (m && m.s) acts.appendChild(h('a', { class: 'stkiw-btn is-text', href: '/indicators/' + encodeURIComponent(m.s), target: '_blank', rel: 'noopener', html: '<span>Full guide</span>' + SVG(I_EXT, 16) }));
    if (it.kind === 'community' && it.s) acts.appendChild(h('button', { type: 'button', class: 'stkiw-btn is-text', text: 'Details, code, report', onclick: () => { close(); L().openCommunity('all', it.name); } }));
    box.appendChild(acts);
  }
  function openSheet(it){
    if (!els) return;
    sheetKey = it.key;
    const s = els.sheet;
    s.innerHTML = '';
    const bd = h('div', { class: 'stkiw-sheet-bd stkc-scroll' });
    s.appendChild(h('div', { class: 'stkiw-sheet-scrim', onclick: () => closeSheet() }));
    s.appendChild(h('div', { class: 'stkiw-sheet-card' }, [h('div', { class: 'stkiw-grab', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'stkiw-x stkiw-sheet-x', 'aria-label': 'Close details', html: SVG(I_CLOSE, 20), onclick: () => closeSheet() }), bd]));
    renderDetail(bd, it);
    s.hidden = false;
  }
  function closeSheet(){ if (!els || !sheetKey) return; sheetKey = null; els.sheet.hidden = true; els.sheet.innerHTML = ''; }

  // ---- rendering ----
  function render(){
    if (!els) return;
    const all = allItems();
    paint();
    paintRail();
    const qraw = els.search.value.trim();
    const list = els.list;
    list.innerHTML = '';
    view = [];
    const put = (x, marks) => { view.push(x); list.appendChild(row(x, marks)); };
    const grp = (t, n) => list.appendChild(h('p', { class: 'stkiw-grp' }, [t, n != null ? h('span', { class: 'stkiw-grp-n', text: String(n) }) : null]));
    els.card.classList.toggle('is-comm', !qraw && section === 'community');
    if (qraw) {
      list.dataset.sect = 'search';
      const toks = queryTokens(qraw);
      const pool = all.filter((x) => (browsable(x) || /^(mine|community|cind)$/.test(x.kind) || /^z[nxm]:/.test(x.key)) && marketOk(x));
      const scored = pool.map((x) => [x, scoreOf(x.ix, toks)]).filter((p) => p[1].score > 0);
      const by = (a) => (sortBy === 'popular' ? a.sort((p, q) => q[1].score - p[1].score) : a.sort((p, q) => sortBy === 'az' ? p[0].name.localeCompare(q[0].name) : (q[0].released || '').localeCompare(p[0].released || '')));
      const mainHits = by(scored.filter((p) => p[0].rail !== 'community' || p[0].kind === 'cind'));
      const commHits = by(scored.filter((p) => p[0].rail === 'community' && p[0].kind !== 'cind'));
      els.title.textContent = 'Results for \u201c' + qraw + '\u201d';
      els.title.appendChild(h('small', { text: scored.length + ' found' }));
      if (mainHits.length) { grp('Best matches'); mainHits.forEach(([x, s]) => put(x, s.marks)); }
      if (commHits.length) { grp('Community'); commHits.forEach(([x, s]) => put(x, s.marks)); }
      if (!scored.length) list.appendChild(h('p', { class: 'stkiw-empty' }, [h('strong', { text: 'Nothing matches. ' }), mk.size ? 'Try clearing the market filters, or fewer words.' : 'Try fewer words or another spelling.']));
    } else {
      const v = sectionView(all);
      list.dataset.sect = section === 'community' ? csub : section;
      els.title.textContent = v.title;
      if (v.note) els.title.appendChild(h('small', { text: v.note }));
      if (authorFilter) els.title.appendChild(h('button', { type: 'button', class: 'stkiw-link', text: 'Clear', onclick: () => { authorFilter = null; render(); } }));
      if (section === 'community' && ['top', 'trending'].includes(csub) && !authorFilter && communityErr) list.appendChild(h('p', { class: 'stkiw-empty', text: 'Could not load member scripts. Check your connection.' }));
      else if (section === 'community' && ['top', 'trending'].includes(csub) && !authorFilter && !fbUser()) list.appendChild(h('p', { class: 'stkiw-empty', text: 'Sign in to see member-published scripts too.' }));
      const items = sorted(v.items.filter(marketOk), v.keep && sortBy === 'popular');
      if (v.grouped) {
        const rec = (v.recent || []).filter(marketOk);
        if (rec.length) { grp('Recently used'); rec.forEach((x) => put(x)); }
        const seen = new Set(rec);
        if (sortBy === 'popular') {
          ['gex', 'orderflow', 'volume', 'trend', 'momentum', 'volatility', 'levels', 'community'].forEach((k) => {
            const a = items.filter((x) => x.rail === k);
            if (!a.length) return;
            grp(k === 'community' ? 'Community \u00b7 third-party' : RAIL_NAME[k], a.length);
            a.forEach((x) => (seen.has(x) ? list.appendChild(row(x)) : put(x)));
          });
        } else { grp(sortBy === 'az' ? 'A\u2013Z' : 'Newest first', items.length); items.forEach((x) => (seen.has(x) ? list.appendChild(row(x)) : put(x))); }
      } else items.forEach((x) => put(x));
      if (!items.length) list.appendChild(h('p', { class: 'stkiw-empty', text: mk.size && v.items.length ? 'Nothing here for these markets. Clear a market filter.' : (v.empty || 'Nothing here yet.') }));
    }
    paintSel();
    if (!view.some((x) => x.key === hiKey)) hiKey = view.length ? view[0].key : null;
    if (hiKey) highlight(hiKey, false); else renderDetail(els.detail, null);
  }

  // Take over Vela's picker: topbar button + "/" shortcut open this window.
  picker.open = () => { open(); };
  picker.close = () => { close(); };
  // Vela calls sync() when a cell's catalog lands late (new cell, symbol change).
  let syncT = 0;
  picker.sync = () => { if (ov && !els.search.value.trim()) { clearTimeout(syncT); syncT = setTimeout(() => { invalidate(); render(); }, 120); } };
  try { ws.on('cell:active', () => { if (ov) { invalidate(); render(); } }); } catch (e) {}
  window.addEventListener('resize', () => { if (ov) paint(); });

  onProTier(() => { if (ov) render(); });

  // Add one row by its window key (b:<type>, p:<id>, x:<id>): the /indicators/<slug> "Add to chart" deep link.
  // Waits until the row's source is ready (built-ins: the cell's library; Pine: the engine).
  async function addByKey(key){
    for (let i = 0; i < 120; i++) {
      const it = builtins().find((x) => x.key === key);
      let ready = !!it;
      if (it && it.kind === 'builtin') { try { ready = ws.active.libraryRows().some((r) => r && ((r.native && 'b:' + r.nativeType === key) || (r.pseudo && 'p:' + r.pseudo === key))); } catch (e) { ready = false; } }
      if (it && it.kind === 'example') ready = !!(P() && P().addSource);
      if (ready) { await addItem(it, null); return true; }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }
  try {
    const u = new URL(location.href), k = u.searchParams.get('ind');
    if (k && /^[bpx]:[\w.-]{1,80}$/.test(k)) {
      u.searchParams.delete('ind'); history.replaceState(null, '', u.pathname + u.search + u.hash);
      addByKey(k).then((ok) => { if (!ok) toast('That indicator is not available on this chart.', 'error'); });
    }
  } catch (e) {}

  // The built-in list in the old window's groups, for tools/indicator-pages/dump-registry.js (the catalogue's
  // group names come from here, so they stay stable): Technicals by CATS, Order Flow, TradeZoro, Community.
  function catalog(){
    const all = builtins();
    const pick = (x, grp) => ({ key: x.key, name: x.name, author: x.author, desc: x.desc || '', third: !!x.third, beta: !!x.beta, grp });
    const tech = [];
    CATS.forEach((c) => {
      const a = all.filter((x) => (x.kind === 'builtin' || x.kind === 'example') && (!x.third || x.cat) && !x.hidden && x.cat !== GROUP_OF && x.cat === c);
      if (c !== GROUP_FLOW && c !== GROUP_STRYKER) a.sort((x, y) => x.name.localeCompare(y.name));
      if (c === GROUP_STRYKER) { const rk = (x) => (x.key === 'b:stk_gex' ? 0 : x.key === 'b:stk_gexheat' ? 1 : 2); a.sort((x, y) => rk(x) - rk(y)); }
      a.forEach((x) => tech.push(pick(x, c)));
    });
    return { tech, orderflow: all.filter((x) => x.cat === GROUP_OF && !x.hidden).map((x) => pick(x, 'Order Flow')),
      stryker: strykerItems(all).map((x) => pick(x, 'TradeZoro')), top: thirdItems(all).map((x) => pick(x, 'Community')) };
  }

  const api = { open, close, render, Favs, fmtCount, ws, addByKey, catalog };
  window.StrykerIndicatorWindow = api;
  return api;
}
