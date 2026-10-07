// Stryker Trading Academy — Charts WATCHLIST panel (charts.html only) — ES module
// Depends on: the Vela workspace (window.STRYKER_VELA: ws.feed, ws.active, ws.on) and helpers
// handed in by assets/vela-chart.js (toast, Core = Vela index.js for categoricalColor, the
// SymbolPicker class from Vela's widget build, rith); assets/chart-data-dot.js
// (window.STRYKER_DATA_DOT.statusOf, the same amber/green/grey dot as the chart legend);
// assets/chart-alerts.js (window.__stkAlerts.open / .add / .tick); firebase compat SDKs +
// assets/auth.js; style.css (.stkw-*).
//
// Owner order 2026-10-06 04:15 IST: "add a watchlist feature on charts" (TradingView's
// right-side Watchlist). Right panel with a slim icon rail (the chart resizes, no overlap on
// desktop), resizable by its left edge; phones (<= 700 px) get a full-screen sheet from a
// Watchlist button on the chart bar.
//
// DATA (no new paid data): every price comes from the SAME provider instance the chart uses,
// read through ws.feed.providerInstance(<provider>).getBars(ticker, 'D', { limit: 2 }):
//   futures: our /api/chart/bars (Yahoo, delayed; the dot says so), crypto: the public exchange
//   REST feeds Vela already uses. Last = newest daily bar close, Chg = vs the previous daily
//   bar's close (previous session), Volume = the session's volume. Polled every POLL_MS, only
//   while the panel is open and the tab is visible. When a member's Rithmic connection is on
//   (flag-gated, off today) the futures provider instance IS the Rithmic-wrapped one, so the
//   watchlist follows it with no extra code (rith hook: providerOf()).
//   Extended Hours (futures only): last vs the close of the most recent regular session
//   (RTH map from assets/chart-events.js), from 5-minute bars; fetched only when that column
//   is on. "—" during regular hours and for crypto (no separate session).
//
// STORAGE: signed-in → students/{uid}/watchlists/{id} { name, items[], collapsed[], view{},
//   shared, updatedAt } (owner only; caps 20 lists × 200 symbols, enforced here); a shared list
//   → watchlistShared/{id} { ownerUid, name, items, updatedAt } (get by id for any signed-in
//   member, never list; Share off deletes it so the link dies). Same approach as chartShared.
//   Guests → localStorage. items[] is TradingView's flat export shape: "###NAME" starts a
//   section, anything else is a Vela symbol string ("futures:NQ1!", "binance:BTCUSDT").
//
// OWNER RULES: no buying/selling anywhere (no order or trade buttons), no engine/vendor names
// in the UI, "Education only. Not financial advice." in the panel footer.

const MAX_LISTS = 20;
const MAX_SYMBOLS = 200;
const MAX_ITEMS = 260;          // symbols + section markers
const NAME_MAX = 60;
const POLL_MS = 25000;
const W_MIN = 260, W_MAX = 560, W_DEF = 340;
const PHONE_MAX = 700;
const SEC = '###';
const DEFAULT_ITEMS = ['###FUTURES', 'futures:NQ1!', 'futures:ES1!', 'futures:YM1!', 'futures:RTY1!', 'futures:GC1!', 'futures:CL1!',
  '###FOREX', 'fx:EURUSD', 'fx:GBPUSD', 'fx:USDJPY', '###CRYPTO', 'binance:BTCUSDT', 'binance:ETHUSDT'];
const VIEW_DEF = { table: true, last: true, chg: true, chgp: true, vol: false, ext: false, logo: true, disp: 'symbol' };
const FUT_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'RTY', 'M2K', 'GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG', 'CL', 'MCL', 'NG', 'ZN', 'ZB', '6E'];
// Spot forex pairs (the "fx" provider, mirrors FX_PAIRS in assets/chart-futures-provider.js).
const FX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF',
  'EURAUD', 'EURCAD', 'AUDJPY', 'CADJPY', 'CHFJPY', 'GBPCHF', 'AUDNZD'];
const RTH = {   // mirrors assets/chart-events.js RTH (New York minutes)
  index: [570, 960], metals: [500, 810], energy: [540, 870], rates: [500, 900], fx: [500, 900]
};
const ROOT_MARKET = { NQ: 'index', MNQ: 'index', ES: 'index', MES: 'index', YM: 'index', MYM: 'index', RTY: 'index', M2K: 'index',
  GC: 'metals', MGC: 'metals', SI: 'metals', SIL: 'metals', HG: 'metals', MHG: 'metals', CL: 'energy', MCL: 'energy', NG: 'energy', ZN: 'rates', ZB: 'rates', '6E': 'fx' };

// ---------------------------------------------------------------- helpers
const fbOk = () => (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length);
function user(){ try { return fbOk() && firebase.auth().currentUser; } catch (e) { return null; } }
const db = () => firebase.firestore();
const col = () => db().collection('students').doc(user().uid).collection('watchlists');
const sharedDoc = (id) => db().collection('watchlistShared').doc(id);
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const tsMs = (v) => (v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const isSec = (s) => typeof s === 'string' && s.startsWith(SEC);
const secName = (s) => s.slice(SEC.length);
const tickerOf = (sym) => String(sym || '').replace(/^[a-z]+:/i, '');
const provOf = (sym) => { const m = /^([a-z]+):/i.exec(String(sym || '')); return m ? m[1].toLowerCase() : ''; };
const isFut = (sym) => provOf(sym) === 'futures';
const rootOf = (sym) => tickerOf(sym).toUpperCase().replace(/1!$/, '');
const rid = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(20)); for (const x of r) s += a[x % 62]; return s; };

function el(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
}
const svg = (inner, w) => '<svg width="' + (w || 18) + '" height="' + (w || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
const I = {
  list: svg('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  table: svg('<rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M3.5 9h17M10 9v11M15.5 9v11"/>'),
  dots: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  chev: svg('<path d="M6 9l6 6 6-6"/>', 14),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  alert: svg('<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2 2M5 4 2.5 6.5M19 4l2.5 2.5"/>', 16),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 16),
  pen: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 16),
  sec: svg('<path d="M4 7h16M4 17h16"/><path d="M4 12h4M10 12h4M16 12h4"/>', 16),
  broom: svg('<path d="M14 4l6 6M12 6l6 6-6 8H6l-2-2 8-12z"/>', 16),
  newl: svg('<path d="M5 4h10l4 4v12H5z"/><path d="M12 10v6M9 13h6"/>', 16),
  up: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>', 16),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 16),
  trash: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', 16),
  down: svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>', 16),
  sort: svg('<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>', 16),
  hide: svg('<path d="M15 6l6 6-6 6M3 12h17"/>', 16)
};

function fmtNum(v, dec){
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function decFor(sym, price){
  const r = rootOf(sym);
  const tick = { NQ: 2, MNQ: 2, ES: 2, MES: 2, YM: 0, MYM: 0, RTY: 1, M2K: 1, GC: 1, MGC: 1, SI: 3, SIL: 3, HG: 4, MHG: 4, CL: 2, MCL: 2, NG: 3, ZN: 4, ZB: 4, '6E': 5 };
  if (isFut(sym) && tick[r] != null) return tick[r];
  if (provOf(sym) === 'fx') return /JPY$/.test(r) ? 3 : 5;
  if (!Number.isFinite(price)) return 2;
  const a = Math.abs(price);
  return a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
}
function fmtVol(v){
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return String(Math.round(v));
}
let nyFmt = null;
function nyMin(ms){
  if (!nyFmt) nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const o = {}; nyFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { min: (+o.hour % 24) * 60 + (+o.minute), dow: o.weekday };
}

let _idx = null, _idxN = -1;
function symIndex(feed){
  let all = [];
  try { all = (feed && feed.symbols()) || []; } catch (e) {}
  if (_idx && _idxN === all.length) return _idx;
  _idx = new Map(); _idxN = all.length;
  for (const d of all) {
    if (!d || !d.ticker) continue;
    const p = String(d.provider || '').toLowerCase();
    if (p) _idx.set(p + ':' + String(d.ticker).toUpperCase(), d);
  }
  return _idx;
}

// Normalise anything a member types or uploads to one of OUR symbols, or null.
// Accepts "NQ1!", "NQ", "CME_MINI:NQ1!", "futures:NQ1!", "BTCUSDT", "BINANCE:BTCUSDT", "binance:BTCUSDT".
export function normalizeSymbol(raw, feed){
  let s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  const m = /^([A-Za-z_]+):(.+)$/.exec(s);
  let pre = m ? m[1].toLowerCase() : '';
  let t = (m ? m[2] : s).trim().toUpperCase();
  if (pre === 'futures' || !pre || /^(cme|cme_mini|cbot|cbot_mini|comex|comex_mini|nymex|nymex_mini)$/.test(pre)) {
    const r = t.replace(/1!$/, '');
    if (FUT_ROOTS.includes(r)) return 'futures:' + r + '1!';
    if (pre === 'futures') return null;
  }
  // Spot forex: "EURUSD", "EUR/USD", "FX:EURUSD", "FX_IDC:EURUSD", "OANDA:EURUSD", "fx:EURUSD".
  if (!pre || /^(fx|fx_idc|oanda|forexcom|fxcm|saxo|pepperstone|icmarkets)$/.test(pre)) {
    const p = t.replace(/[\/_\s]/g, '');
    if (FX_PAIRS.includes(p)) return 'fx:' + p;
    if (pre && pre.startsWith('fx')) return null;
  }
  const venues = ['binance', 'coinbase', 'hyperliquid'];
  if (pre && !venues.includes(pre)) pre = '';
  // Membership is checked against the providers' own symbol lists (a prefixed resolve
  // would accept any ticker for a registered venue).
  const idx = symIndex(feed);
  const tryOne = (v, tk) => { const d = idx.get(v + ':' + tk); return d ? v + ':' + d.ticker : null; };
  if (!feed || !/^[A-Z0-9._\-/]{1,30}$/.test(t)) return null;
  // A bare coin ("ETH") means the main USDT pair (BTCUSDT, ETHUSDT) before any venue's bare ticker.
  const cands = !pre && !/(USDT|USDC|USD|EUR|PERP|-)/.test(t) ? [t + 'USDT', t] : [t];
  if (pre && !/(USDT|USDC|USD|EUR|PERP|-)/.test(t)) cands.push(t + 'USDT');
  for (const tk of cands) {
    if (pre) { const s = tryOne(pre, tk); if (s) return s; continue; }
    for (const v of venues) { const s = tryOne(v, tk); if (s) return s; }
  }
  return null;
}

// Parse an uploaded .txt / .csv (TradingView export: comma-separated, "###SECTION" markers).
export function parseUpload(text, feed){
  const toks = String(text || '').split(/[\s,;\t]+/).map((x) => x.trim()).filter(Boolean);
  const items = [], bad = [];
  const seen = new Set();
  for (const tk of toks) {
    if (tk.startsWith(SEC)) { const n = tk.slice(3).replace(/[_]+/g, ' ').trim().slice(0, 40); if (n) items.push(SEC + n.toUpperCase()); continue; }
    if (/^(symbol|ticker|name)$/i.test(tk)) continue;   // a CSV header
    const s = normalizeSymbol(tk, feed);
    if (!s) { bad.push(tk); continue; }
    if (seen.has(s)) continue;
    seen.add(s); items.push(s);
  }
  return { items, bad };
}

// ---------------------------------------------------------------- storage
function localStore(){
  const K = 'stryker_watchlists_guest';
  const all = () => { const v = lsGet(K, []); return Array.isArray(v) ? v : []; };
  const put = (v) => lsSet(K, v);
  return {
    kind: 'local',
    async list(){ return all(); },
    async get(id){ return all().find((x) => x.id === id) || null; },
    async save(d){ const v = all(); const i = v.findIndex((x) => x.id === d.id); const doc = Object.assign({}, d, { updatedAt: Date.now() }); if (i >= 0) v[i] = doc; else v.push(doc); put(v); return doc; },
    async remove(id){ put(all().filter((x) => x.id !== id)); }
  };
}
function cloudStore(){
  const shape = (d) => ({ name: d.name, items: d.items, collapsed: d.collapsed || [], view: Object.assign({}, VIEW_DEF, d.view || {}), shared: !!d.shared, updatedAt: ts() });
  return {
    kind: 'cloud',
    async list(){
      const s = await col().get();
      return s.docs.map((x) => { const d = x.data() || {}; return { id: x.id, name: d.name || 'Watchlist', items: Array.isArray(d.items) ? d.items : [], collapsed: Array.isArray(d.collapsed) ? d.collapsed : [], view: Object.assign({}, VIEW_DEF, d.view || {}), shared: !!d.shared, updatedAt: tsMs(d.updatedAt) }; });
    },
    async save(d){
      await col().doc(d.id).set(shape(d));
      if (d.shared) await sharedDoc(d.id).set({ ownerUid: user().uid, name: d.name, items: d.items, updatedAt: ts() });
      return Object.assign({}, d, { updatedAt: Date.now() });
    },
    async remove(id, wasShared){
      if (wasShared) { try { await sharedDoc(id).delete(); } catch (e) {} }
      await col().doc(id).delete();
    }
  };
}

// ---------------------------------------------------------------- module
export function mountWatchlist(ws, o){
  const toast = (o && o.toast) || (() => {});
  const Core = o && o.Core;
  const SymbolPicker = o && o.SymbolPicker;
  const panelHost = document.querySelector('.stkchart-panel');
  const velaHost = document.getElementById('vela-chart');
  const barL = document.getElementById('stkc-bar-l');
  if (!panelHost || !velaHost) return null;

  const uidKey = () => (user() ? user().uid : 'guest');
  const K = {
    open: 'stryker_wl_open', width: 'stryker_wl_width',
    active: () => 'stryker_wl_active_' + uidKey(), recent: () => 'stryker_wl_recent_' + uidKey()
  };

  let store = localStore();
  let lists = [];          // [{id,name,items,collapsed,view,shared,updatedAt}]
  let cur = null;          // the open list (a member of lists, or the read-only shared one)
  let viewing = null;      // { id, name, ownerUid } while a shared link is open
  let sel = null;          // selected symbol (row focus, Delete key)
  let selSet = new Set();  // multi-select (Ctrl/Shift click) for "Add alert on the list"
  const quotes = new Map();   // sym -> { last, prev, vol, ext, at, err }
  let saveTimer = null;
  let pollTimer = null;
  let loading = true;

  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const view = () => Object.assign({}, VIEW_DEF, (cur && cur.view) || {});

  // ---- DOM: rail + panel ----
  const railBtn = el('button', { type: 'button', class: 'stkw-railbtn', title: 'Watchlist', 'aria-label': 'Watchlist', 'aria-pressed': 'false', html: I.list });
  const rail = el('div', { class: 'stkw-rail', role: 'toolbar', 'aria-label': 'Right panels' }, [railBtn]);
  const titleBtn = el('button', { type: 'button', class: 'stkw-title', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const addBtn = el('button', { type: 'button', class: 'stkw-ib', title: 'Add symbol', 'aria-label': 'Add symbol', html: I.plus });
  const colBtn = el('button', { type: 'button', class: 'stkw-ib', title: 'Columns and display', 'aria-label': 'Columns and display', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: I.table });
  const moreBtn = el('button', { type: 'button', class: 'stkw-ib', title: 'More', 'aria-label': 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: I.dots });
  const closeBtn = el('button', { type: 'button', class: 'stkw-ib stkw-close', title: 'Close', 'aria-label': 'Close watchlist', html: I.close });
  const head = el('div', { class: 'stkw-hd' }, [titleBtn, el('span', { class: 'stkw-hsp' }), addBtn, colBtn, moreBtn, closeBtn]);
  const thead = el('div', { class: 'stkw-th', role: 'row' });
  const body = el('div', { class: 'stkw-body', role: 'grid', 'aria-label': 'Watchlist symbols', tabindex: '0' });
  const banner = el('div', { class: 'stkw-banner', hidden: true });
  const foot = el('p', { class: 'stkw-foot', text: 'Futures prices are delayed (the dot shows the data status). Education only. Not financial advice.' });
  const grip = el('div', { class: 'stkw-grip', title: 'Drag to resize', 'aria-hidden': 'true' });
  const panel = el('aside', { class: 'stkw', id: 'stkw', 'aria-label': 'Watchlist', hidden: true }, [grip, head, banner, thead, body, foot]);
  panelHost.appendChild(panel);
  panelHost.appendChild(rail);
  panelHost.classList.add('stkw-host');
  // Phone: a Watchlist button on the chart bar opens the sheet.
  const phoneBtn = el('button', { type: 'button', class: 'stkc-btn stkw-phonebtn', title: 'Watchlist', 'aria-label': 'Watchlist', html: I.list + '<span class="stkc-btn-l">Watchlist</span>' });
  const barR = document.querySelector('.stkc-bar-r');
  if (barR) barR.insertBefore(phoneBtn, barR.firstChild); else if (barL) barL.appendChild(phoneBtn);

  // ---- popover menus (our own: they sit inside the panel) ----
  const menus = [];
  function menu(btn, build){
    const pop = el('div', { class: 'stkw-menu', role: 'menu', hidden: true });
    document.body.appendChild(pop);
    const set = (open) => {
      if (open) { menus.forEach((m) => m.set(false)); pop.innerHTML = ''; build(pop); pop.hidden = false; place(btn, pop); }
      else pop.hidden = true;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); set(pop.hidden); });
    pop.addEventListener('click', (e) => e.stopPropagation());
    const m = { pop, set };
    menus.push(m);
    return m;
  }
  function place(anchor, pop){
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = r.left; if (left + w > window.innerWidth - 8) left = Math.max(8, r.right - w);
    let top = r.bottom + 4; if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = Math.round(left) + 'px'; pop.style.top = Math.round(top) + 'px';
  }
  const closeMenus = () => menus.forEach((m) => m.set(false));
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); hideCtx(); } });
  window.addEventListener('resize', closeMenus, { passive: true });

  function mi(icon, label, run, opts){
    const b = el('button', { type: 'button', class: 'stkw-mi', role: 'menuitem', disabled: opts && opts.disabled ? true : null },
      [el('span', { class: 'stkw-mic', html: icon || '' }), el('span', { class: 'stkw-mil', text: label }), opts && opts.kbd ? el('kbd', { text: opts.kbd }) : null]);
    b.addEventListener('click', () => { closeMenus(); hideCtx(); run(); });
    return b;
  }
  const hr = () => el('hr', { class: 'stkw-hr' });
  function swRow(label, on, disabled, fn, tip){
    const cb = el('input', { type: 'checkbox', role: 'switch', class: 'stkw-sw' });
    cb.checked = !!on; cb.disabled = !!disabled;
    cb.addEventListener('change', () => fn(cb.checked, cb));
    return el('label', { class: 'stkw-swrow', title: tip || null }, [el('span', { text: label }), cb]);
  }
  function chk(label, on, fn, type, name){
    const cb = el('input', { type: type || 'checkbox', name: name || null });
    cb.checked = !!on;
    cb.addEventListener('change', () => fn(cb.checked));
    return el('label', { class: 'stkw-chk' }, [cb, el('span', { text: label })]);
  }

  // LIST MENU (ref 1)
  const listMenu = menu(titleBtn, (pop) => {
    const signed = !!user();
    if (viewing) {
      pop.appendChild(el('p', { class: 'stkw-note', text: 'Read-only: a list shared by another member.' }));
      pop.appendChild(mi(I.copy, 'Make a copy…', () => askName('Make a copy', viewing.name + ' (copy)', copyCur)));
      pop.appendChild(mi(I.close, 'Close shared list', leaveShared));
      return;
    }
    pop.appendChild(swRow('Share list', cur && cur.shared, !signed || !cur, (v, cb) => setShared(v, cb),
      signed ? 'Anyone signed in with the link can view this list (read-only)' : 'Sign in to share lists'));
    if (cur && cur.shared) pop.appendChild(mi(I.copy, 'Copy link', copyLink));
    pop.appendChild(mi(I.alert, 'Add alert on the list…', alertListDialog, { disabled: !cur || !symbolsOf(cur).length }));
    pop.appendChild(mi(I.copy, 'Make a copy…', () => askName('Make a copy', (cur ? cur.name : 'Watchlist') + ' (copy)', copyCur)));
    pop.appendChild(mi(I.pen, 'Rename', () => askName('Rename list', cur.name, renameCur), { disabled: !cur }));
    pop.appendChild(mi(I.sec, 'Add section', () => askName('Add section', 'NEW SECTION', (n) => addSection(n, 0), 'Section name', 40)));
    pop.appendChild(mi(I.broom, 'Clear list', clearList, { disabled: !cur || !cur.items.length }));
    pop.appendChild(hr());
    pop.appendChild(mi(I.newl, 'Create new list…', () => askName('Create new list', 'New list', createList)));
    pop.appendChild(mi(I.up, 'Upload list…', uploadDialog));
    pop.appendChild(hr());
    pop.appendChild(mi(I.folder, 'Open list…', openDialog, { kbd: 'Shift + W' }));
    const rec = lsGet(K.recent(), []).filter((id) => id !== (cur && cur.id)).map((id) => lists.find((l) => l.id === id)).filter(Boolean).slice(0, 4);
    if (rec.length) {
      pop.appendChild(el('p', { class: 'stkw-mh', text: 'RECENTLY USED' }));
      rec.forEach((l) => pop.appendChild(mi('', l.name, () => openList(l.id))));
    }
    if (!signed) pop.appendChild(el('p', { class: 'stkw-note', text: 'Saved in this browser. Sign in to keep lists on your account and share them.' }));
  });

  // COLUMNS MENU (ref 2)
  menu(colBtn, (pop) => {
    const v = view();
    const setV = (k, val) => { if (!cur || viewing) { tmpView[k] = val; render(); return; } cur.view = Object.assign({}, view(), { [k]: val }); render(); dirty(); if (k === 'ext' && val) refresh(true); };
    pop.appendChild(swRow('Table view', v.table, false, (on) => setV('table', on)));
    pop.appendChild(hr());
    pop.appendChild(el('p', { class: 'stkw-mh', text: 'CUSTOMIZE COLUMNS' }));
    pop.appendChild(chk('Last', v.last, (on) => setV('last', on)));
    pop.appendChild(chk('Change', v.chg, (on) => setV('chg', on)));
    pop.appendChild(chk('Change %', v.chgp, (on) => setV('chgp', on)));
    pop.appendChild(chk('Volume', v.vol, (on) => setV('vol', on)));
    pop.appendChild(chk('Extended Hours', v.ext, (on) => setV('ext', on)));
    pop.appendChild(hr());
    pop.appendChild(el('p', { class: 'stkw-mh', text: 'SYMBOL DISPLAY' }));
    pop.appendChild(chk('Logo', v.logo, (on) => setV('logo', on)));
    pop.appendChild(chk('Symbol', v.disp === 'symbol', () => setV('disp', 'symbol'), 'radio', 'stkw-disp'));
    pop.appendChild(chk('Name', v.disp === 'name', () => setV('disp', 'name'), 'radio', 'stkw-disp'));
  });
  const tmpView = {};

  // ··· MENU
  menu(moreBtn, (pop) => {
    pop.appendChild(mi(I.sort, 'Sort by symbol', () => sortBy('sym'), { disabled: !cur || viewing }));
    pop.appendChild(mi(I.sort, 'Sort by change %', () => sortBy('chgp'), { disabled: !cur || viewing }));
    pop.appendChild(mi(I.down, 'Export list (.txt)', exportList, { disabled: !cur }));
    pop.appendChild(hr());
    pop.appendChild(mi(I.hide, 'Hide watchlist', () => setOpen(false)));
  });

  // ---- open / close / width ----
  let open = false;
  function applyWidth(px){
    px = Math.max(W_MIN, Math.min(W_MAX, Math.round(px) || W_DEF));
    // Volume / Extended Hours columns need room: each column past three adds 60 px.
    const extra = typeof cols === 'function' ? Math.max(0, cols().length - 3) * 60 : 0;
    panelHost.style.setProperty('--stkw-w', Math.min(W_MAX + 120, px + extra) + 'px');
    return px;
  }
  let width = applyWidth(lsGet(K.width, W_DEF));
  function setOpen(v, opts){
    open = !!v;
    panel.hidden = !open;
    panelHost.classList.toggle('stkw-open', open);
    document.documentElement.classList.toggle('stkw-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    railBtn.classList.toggle('on', open);
    phoneBtn.classList.toggle('on', open);
    if (!(opts && opts.noSave) && !isPhone()) lsSet(K.open, open);
    if (open) { render(); refresh(true); schedulePoll(); } else { clearTimeout(pollTimer); closeMenus(); hideCtx(); }
    nudgeChart();
  }
  function nudgeChart(){
    // Vela watches its host with a ResizeObserver; a resize event as well covers older paths.
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  window.addEventListener('resize', () => { document.documentElement.classList.toggle('stkw-sheet', open && isPhone()); }, { passive: true });

  grip.addEventListener('pointerdown', (e) => {
    if (isPhone()) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    grip.setPointerCapture(e.pointerId);
    panelHost.classList.add('stkw-resizing');
    const mv = (ev) => { width = applyWidth(w0 + (x0 - ev.clientX)); };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); panelHost.classList.remove('stkw-resizing'); lsSet(K.width, width); nudgeChart(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });

  // ---- symbol metadata (name + logo) ----
  function meta(sym){
    return symIndex(ws.feed).get(provOf(sym) + ':' + tickerOf(sym).toUpperCase()) || null;
  }
  setTimeout(() => { if (open) render(); }, 4000);
  function nameOf(sym){
    const d = meta(sym);
    let n = d && d.description;
    if (!n && !isFut(sym) && provOf(sym) !== 'fx') { const t = tickerOf(sym); n = t.replace(/(USDT|USDC|USD)$/i, ' / $1'); }
    return n || tickerOf(sym);
  }
  function logo(sym){
    const t = tickerOf(sym).toUpperCase();
    const base = isFut(sym) ? rootOf(sym) : t.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, '') || t;
    const wrap = el('span', { class: 'stkw-logo', 'aria-hidden': 'true' });
    const fallback = () => {
      wrap.replaceChildren();
      try { wrap.style.background = Core && Core.categoricalColor ? Core.categoricalColor(t) : '#2962ff'; } catch (e) { wrap.style.background = '#2962ff'; }
      wrap.textContent = base.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?';
    };
    let url = null;
    try { url = ws.feed.symbolIcon(sym); } catch (e) {}
    if (!url) { fallback(); return wrap; }
    const img = el('img', { alt: '', src: url, loading: 'lazy' });
    img.addEventListener('error', fallback, { once: true });
    wrap.appendChild(img);
    return wrap;
  }

  // ---- quotes ----
  function providerOf(sym){
    // Rithmic hook: when the flag is on, vela-chart.js registers the Rithmic-wrapped futures
    // provider under the same name, so this instance is already the member's live feed.
    try { return ws.feed.providerInstance(provOf(sym)); } catch (e) { return null; }
  }
  async function quote(sym){
    const p = providerOf(sym);
    if (!p || !p.getBars) throw new Error('no provider');
    const bars = await p.getBars(tickerOf(sym), 'D', { limit: 2 });
    if (!bars || !bars.length) throw new Error('no bars');
    const b = bars[bars.length - 1], a = bars.length > 1 ? bars[bars.length - 2] : null;
    const q = { last: b.close, prev: a ? a.close : null, vol: b.volume, at: Date.now(), ext: null };
    if (isFut(sym) && view().ext) q.ext = await extQuote(sym, p, b.close).catch(() => null);
    return q;
  }
  // Extended hours (futures): last vs the most recent regular-session close, from 5m bars.
  async function extQuote(sym, p, last){
    const mk = RTH[ROOT_MARKET[rootOf(sym)]];
    if (!mk) return null;
    const now = nyMin(Date.now());
    if (now.min >= mk[0] && now.min < mk[1] && now.dow !== 'Sat' && now.dow !== 'Sun') return null;   // in regular hours
    const bars = await p.getBars(tickerOf(sym), '5', { limit: 600 });
    for (let i = bars.length - 1; i >= 0; i--) {
      const m = nyMin(bars[i].time + 5 * 60000);
      if (m.min > mk[0] && m.min <= mk[1] && m.dow !== 'Sat' && m.dow !== 'Sun') {
        const rc = bars[i].close;
        return { chg: last - rc, pct: rc ? (last - rc) / rc * 100 : null };
      }
    }
    return null;
  }
  let refreshing = false;
  async function refresh(force){
    if (!open || document.hidden || !cur || refreshing) return;
    refreshing = true;
    const syms = symbolsOf(cur);
    const todo = syms.filter((s) => force || !quotes.has(s) || Date.now() - quotes.get(s).at > POLL_MS - 2000);
    // Batched, at most 4 in flight.
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const s = todo[i++];
        try {
          const q = await quote(s);
          const old = quotes.get(s);
          q.flash = old && Number.isFinite(old.last) && q.last !== old.last ? (q.last > old.last ? 'up' : 'dn') : '';
          quotes.set(s, q);
          try { if (window.__stkAlerts && window.__stkAlerts.tick) window.__stkAlerts.tick(s, q.last); } catch (e) {}
        } catch (e) { const old = quotes.get(s); quotes.set(s, Object.assign({}, old || {}, { at: Date.now(), err: true })); }
        paintRow(s);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    refreshing = false;
    // A failed fetch (the data source sometimes answers 502 for a moment) is retried soon,
    // not at the next 25 s poll; at most twice in a row per symbol.
    const failed = todo.filter((s) => { const q = quotes.get(s); return q && q.err && !Number.isFinite(q.last); });
    if (failed.length && (retryN++ < 2)) setTimeout(() => { failed.forEach((s) => quotes.delete(s)); refresh(false); }, 3000);
    else if (!failed.length) retryN = 0;
  }
  let retryN = 0;
  function schedulePoll(){
    clearTimeout(pollTimer);
    if (!open) return;
    pollTimer = setTimeout(async () => { if (!document.hidden) await refresh(false); schedulePoll(); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && open) { refresh(false); schedulePoll(); } });

  // ---- render ----
  const symbolsOf = (l) => (l ? l.items.filter((s) => !isSec(s)) : []);
  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return null; } };
  function cols(){
    const v = Object.assign(view(), tmpView);
    if (!v.table) return [['last', 'Last'], ['chgp', 'Chg%']];
    const c = [];
    if (v.last) c.push(['last', 'Last']);
    if (v.chg) c.push(['chg', 'Chg']);
    if (v.chgp) c.push(['chgp', 'Chg%']);
    if (v.vol) c.push(['vol', 'Vol']);
    if (v.ext) c.push(['ext', 'Ext']);
    return c;
  }
  function render(){
    if (!open) return;
    const v = Object.assign(view(), tmpView);
    titleBtn.innerHTML = '';
    titleBtn.append(el('span', { class: 'stkw-tn', text: viewing ? viewing.name : (cur ? cur.name : 'Watchlist') }), el('span', { class: 'stkw-tc', html: I.chev }));
    titleBtn.setAttribute('aria-label', 'Watchlist menu: ' + (cur ? cur.name : ''));
    addBtn.disabled = !!viewing;
    panel.classList.toggle('stkw-compact', !v.table);
    panel.style.setProperty('--stkw-cols', String(cols().length));
    applyWidth(width);
    const C = cols();
    thead.innerHTML = '';
    thead.hidden = !v.table;
    thead.appendChild(el('span', { class: 'stkw-c0', text: 'Symbol', role: 'columnheader' }));
    C.forEach(([k, l]) => thead.appendChild(el('span', { class: 'stkw-cn stkw-' + k, text: l, role: 'columnheader', title: k === 'ext' ? 'Extended hours: change since the last regular-session close (futures, outside regular hours)' : null })));
    body.innerHTML = '';
    if (loading) { body.appendChild(el('p', { class: 'stkw-empty', text: 'Loading…' })); return; }
    if (!cur) { body.appendChild(el('p', { class: 'stkw-empty', text: 'No list.' })); return; }
    if (!cur.items.length) body.appendChild(el('p', { class: 'stkw-empty', text: viewing ? 'This list is empty.' : 'This list is empty. Use + to add a symbol.' }));
    const act = activeSym();
    let collapsed = false, secIdx = -1;
    cur.items.forEach((it, idx) => {
      if (isSec(it)) {
        secIdx = idx;
        collapsed = (cur.collapsed || []).includes(secName(it));
        const tog = el('button', { type: 'button', class: 'stkw-sec' + (collapsed ? ' shut' : ''), 'aria-expanded': collapsed ? 'false' : 'true', 'data-idx': String(idx), draggable: viewing ? null : 'true' },
          [el('span', { class: 'stkw-secc', html: I.chev }), el('span', { text: secName(it) })]);
        tog.addEventListener('click', () => toggleSection(secName(it)));
        tog.addEventListener('contextmenu', (e) => { e.preventDefault(); secCtx(e, idx); });
        dnd(tog, idx);
        body.appendChild(tog);
        return;
      }
      if (collapsed) return;
      const row = el('div', { class: 'stkw-row' + (it === act ? ' act' : '') + (it === sel || selSet.has(it) ? ' sel' : ''), role: 'row', 'data-sym': it, 'data-idx': String(idx), tabindex: '-1', draggable: viewing || isPhone() ? null : 'true' });
      const name = v.disp === 'name' ? nameOf(it) : tickerOf(it);
      const c0 = el('span', { class: 'stkw-c0', role: 'gridcell', title: tickerOf(it) + ' · ' + nameOf(it) }, [
        v.logo ? logo(it) : null,
        el('span', { class: 'stkw-sym', text: name }),
        el('i', { class: 'stkw-dd', 'aria-hidden': 'true' })
      ]);
      row.appendChild(c0);
      C.forEach(([k]) => row.appendChild(el('span', { class: 'stkw-cn stkw-' + k, role: 'gridcell' })));
      row.addEventListener('click', (e) => clickRow(it, e));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); sel = it; markSel(); rowCtx(e, it, idx); });
      dnd(row, idx);
      body.appendChild(row);
      paintRow(it, row);
    });
  }
  function paintRow(sym, row){
    const rows = row ? [row] : body.querySelectorAll('.stkw-row[data-sym="' + CSS.escape(sym) + '"]');
    const q = quotes.get(sym);
    let st = null;
    try { st = window.STRYKER_DATA_DOT && window.STRYKER_DATA_DOT.statusOf(sym); } catch (e) {}
    rows.forEach((r) => {
      const dd = r.querySelector('.stkw-dd');
      if (dd) { dd.dataset.s = st ? st.s : ''; dd.title = st ? st.text : ''; dd.hidden = !st; }
      const has = q && Number.isFinite(q.last);
      const chg = has && Number.isFinite(q.prev) ? q.last - q.prev : NaN;
      const pct = has && Number.isFinite(q.prev) && q.prev ? chg / q.prev * 100 : NaN;
      const dec = decFor(sym, has ? q.last : NaN);
      const dir = chg > 0 ? 'up' : chg < 0 ? 'dn' : '';
      const set = (k, txt, d) => { const c = r.querySelector('.stkw-' + k); if (!c) return; c.textContent = txt; c.dataset.dir = d || ''; };
      set('last', has ? fmtNum(q.last, dec) : (q && q.err ? '—' : '…'), '');
      set('chg', Number.isFinite(chg) ? (chg > 0 ? '+' : '') + fmtNum(chg, dec) : '—', dir);
      set('chgp', Number.isFinite(pct) ? (pct > 0 ? '+' : '') + pct.toFixed(2) + '%' : '—', dir);
      set('vol', has ? fmtVol(q.vol) : '—', '');
      const e = q && q.ext;
      set('ext', e && Number.isFinite(e.pct) ? (e.pct > 0 ? '+' : '') + e.pct.toFixed(2) + '%' : '—', e ? (e.chg > 0 ? 'up' : e.chg < 0 ? 'dn' : '') : '');
      const last = r.querySelector('.stkw-last');
      if (last && q && q.flash) { last.dataset.flash = q.flash; setTimeout(() => { if (last) last.dataset.flash = ''; }, 900); q.flash = ''; }
      r.title = q && q.err ? 'Price not available right now' : '';
    });
  }
  function markSel(){
    body.querySelectorAll('.stkw-row').forEach((r) => r.classList.toggle('sel', r.dataset.sym === sel || selSet.has(r.dataset.sym)));
  }
  function markActive(){
    const a = activeSym();
    body.querySelectorAll('.stkw-row').forEach((r) => r.classList.toggle('act', r.dataset.sym === a));
  }
  ['cell:active', 'state:changed', 'layout:changed'].forEach((ev) => { try { ws.on(ev, () => { if (open) setTimeout(markActive, 0); }); } catch (e) {} });

  function clickRow(sym, e){
    if (e && (e.ctrlKey || e.metaKey)) { if (selSet.has(sym)) selSet.delete(sym); else selSet.add(sym); sel = sym; markSel(); return; }
    if (e && e.shiftKey && sel) {
      const syms = visibleSyms(); const a = syms.indexOf(sel), b = syms.indexOf(sym);
      if (a >= 0 && b >= 0) { selSet = new Set(syms.slice(Math.min(a, b), Math.max(a, b) + 1)); markSel(); return; }
    }
    selSet = new Set(); sel = sym; markSel();
    try { ws.active.setSymbol(sym); } catch (err) { console.warn('Stryker watchlist: load', err); }
    setTimeout(markActive, 50);
    body.focus({ preventScroll: true });
    if (isPhone()) setOpen(false);
  }
  const visibleSyms = () => [...body.querySelectorAll('.stkw-row')].map((r) => r.dataset.sym);

  // keyboard: Delete removes, arrows move + load, Shift+W opens lists
  body.addEventListener('keydown', (e) => {
    if (viewing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && (sel || selSet.size)) { e.preventDefault(); removeSyms(selSet.size ? [...selSet] : [sel]); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const syms = visibleSyms(); if (!syms.length) return;
      e.preventDefault();
      let i = syms.indexOf(sel); i = e.key === 'ArrowDown' ? Math.min(syms.length - 1, i + 1) : Math.max(0, i - 1);
      clickRow(syms[i]);
      const r = body.querySelector('.stkw-row[data-sym="' + CSS.escape(syms[i]) + '"]');
      if (r) { const top = r.offsetTop, bot = top + r.offsetHeight; if (top < body.scrollTop) body.scrollTop = top; else if (bot > body.scrollTop + body.clientHeight) body.scrollTop = bot - body.clientHeight; }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'W' && e.code !== 'KeyW')) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    if (!open) setOpen(true);
    openDialog();
  });

  // ---- drag & drop ----
  let dragIdx = -1;
  function dnd(node, idx){
    if (viewing) return;
    node.addEventListener('dragstart', (e) => { dragIdx = idx; node.classList.add('drag'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (err) {} });
    node.addEventListener('dragend', () => { dragIdx = -1; node.classList.remove('drag'); body.querySelectorAll('.drop-b,.drop-a').forEach((x) => x.classList.remove('drop-b', 'drop-a')); });
    node.addEventListener('dragover', (e) => {
      if (dragIdx < 0) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      node.classList.toggle('drop-a', after); node.classList.toggle('drop-b', !after);
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-b', 'drop-a'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      node.classList.remove('drop-b', 'drop-a');
      if (dragIdx < 0 || dragIdx === idx) return;
      moveItem(dragIdx, idx + (after ? 1 : 0));
      dragIdx = -1;
    });
  }
  function moveItem(from, to){
    const items = cur.items.slice();
    const it = items[from];
    let block = [it];
    if (isSec(it)) {   // a section moves with its rows
      let j = from + 1; while (j < items.length && !isSec(items[j])) j++;
      block = items.slice(from, j);
      if (to > from && to < j) return;
    }
    items.splice(from, block.length);
    if (to > from) to -= block.length;
    items.splice(Math.max(0, Math.min(items.length, to)), 0, ...block);
    cur.items = items; render(); dirty();
  }

  // ---- context menus ----
  const ctx = el('div', { class: 'stkw-menu stkw-ctx', role: 'menu', hidden: true });
  document.body.appendChild(ctx);
  ctx.addEventListener('click', (e) => e.stopPropagation());
  function hideCtx(){ ctx.hidden = true; }
  document.addEventListener('click', hideCtx);
  function showCtx(e, build){
    if (viewing) return;
    closeMenus();
    ctx.innerHTML = ''; build(ctx); ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.round(Math.min(e.clientX, window.innerWidth - w - 8)) + 'px';
    ctx.style.top = Math.round(Math.min(e.clientY, window.innerHeight - h - 8)) + 'px';
  }
  function rowCtx(e, sym, idx){
    showCtx(e, (m) => {
      const q = quotes.get(sym);
      m.appendChild(mi(I.alert, 'Add alert on ' + tickerOf(sym) + '…', () => {
        try { window.__stkAlerts.open({ symbol: sym, cond: 'crossing', price: q && Number.isFinite(q.last) ? q.last : '' }); }
        catch (err) { toast('Alerts are not ready yet. Try again in a moment.', 'error'); }
      }));
      m.appendChild(mi(I.sec, 'Add section above', () => askName('Add section', 'NEW SECTION', (n) => addSection(n, idx), 'Section name', 40)));
      m.appendChild(hr());
      m.appendChild(mi(I.trash, selSet.size > 1 && selSet.has(sym) ? 'Remove ' + selSet.size + ' symbols' : 'Remove from list', () => removeSyms(selSet.size > 1 && selSet.has(sym) ? [...selSet] : [sym]), { kbd: 'Del' }));
    });
  }
  function secCtx(e, idx){
    const nm = secName(cur.items[idx]);
    showCtx(e, (m) => {
      m.appendChild(mi(I.pen, 'Rename section', () => askName('Rename section', nm, (n) => { cur.items[idx] = SEC + n.toUpperCase(); cur.collapsed = (cur.collapsed || []).filter((x) => x !== nm); render(); dirty(); }, 'Section name', 40)));
      m.appendChild(mi(I.sec, 'Add section above', () => askName('Add section', 'NEW SECTION', (n) => addSection(n, idx), 'Section name', 40)));
      m.appendChild(hr());
      m.appendChild(mi(I.trash, 'Remove section (keep symbols)', () => { cur.items.splice(idx, 1); render(); dirty(); }));
    });
  }

  // ---- list operations ----
  function dirty(){
    if (viewing || !cur) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow(){
    clearTimeout(saveTimer);
    if (viewing || !cur) return;
    try { const d = await store.save(cur); cur.updatedAt = d.updatedAt; }
    catch (e) { console.warn('Stryker watchlist: save', e); toast('Could not save the watchlist. Check your connection.', 'error'); }
  }
  function addSymbol(sym){
    if (!cur || viewing) return;
    if (cur.items.includes(sym)) { toast(tickerOf(sym) + ' is already in this list.'); sel = sym; render(); return; }
    if (symbolsOf(cur).length >= MAX_SYMBOLS) { toast('A list holds up to ' + MAX_SYMBOLS + ' symbols.', 'error'); return; }
    // Insert after the selected row (TradingView behaviour), else at the end.
    let at = sel ? cur.items.indexOf(sel) : -1;
    if (at >= 0) cur.items.splice(at + 1, 0, sym); else cur.items.push(sym);
    sel = sym;
    render(); dirty(); refresh(false);
  }
  function removeSyms(syms){
    if (!cur || viewing || !syms.length) return;
    const set = new Set(syms);
    const vis = visibleSyms(); const i = vis.indexOf(syms[0]);
    cur.items = cur.items.filter((x) => !set.has(x));
    selSet = new Set();
    const rest = vis.filter((x) => !set.has(x));
    sel = rest[Math.min(i, rest.length - 1)] || null;
    render(); dirty();
    toast(syms.length === 1 ? tickerOf(syms[0]) + ' removed' : syms.length + ' symbols removed');
  }
  function addSection(name, at){
    if (!cur || viewing) return;
    const n = String(name).replace(/#/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 40);
    if (!n) return;
    if (cur.items.length >= MAX_ITEMS) { toast('This list is full.', 'error'); return; }
    cur.items.splice(Math.max(0, Math.min(cur.items.length, at)), 0, SEC + n);
    render(); dirty();
  }
  function toggleSection(name){
    if (!cur) return;
    const c = new Set(cur.collapsed || []);
    if (c.has(name)) c.delete(name); else c.add(name);
    cur.collapsed = [...c].slice(0, 50);
    render(); if (!viewing) dirty();
  }
  function clearList(){
    if (!cur || !window.confirm('Remove every symbol and section from "' + cur.name + '"?')) return;
    cur.items = []; cur.collapsed = []; sel = null; selSet = new Set();
    render(); dirty();
  }
  function sortBy(k){
    if (!cur) return;
    // Sort inside each section; sections keep their order.
    const out = []; let block = [];
    const keyOf = (s) => { if (k === 'sym') return tickerOf(s); const q = quotes.get(s); return q && Number.isFinite(q.prev) && q.prev ? -(q.last - q.prev) / q.prev : Infinity; };
    const flush = () => { block.sort((a, b) => { const x = keyOf(a), y = keyOf(b); return typeof x === 'string' ? x.localeCompare(y) : x - y; }); out.push(...block); block = []; };
    cur.items.forEach((s) => { if (isSec(s)) { flush(); out.push(s); } else block.push(s); });
    flush();
    cur.items = out; render(); dirty();
  }
  function exportList(){
    if (!cur) return;
    const txt = cur.items.map((s) => (isSec(s) ? s : tickerOf(s).toUpperCase().endsWith('1!') ? tickerOf(s) : provOf(s).toUpperCase() + ':' + tickerOf(s))).join(',');
    const a = el('a', { href: URL.createObjectURL(new Blob([txt + '\n'], { type: 'text/plain' })), download: (cur.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'watchlist') + '.txt' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function touchRecent(id){
    const r = lsGet(K.recent(), []).filter((x) => x !== id);
    r.unshift(id); lsSet(K.recent(), r.slice(0, 8));
  }
  function setCur(l){
    cur = l; sel = null; selSet = new Set();
    if (l && !viewing) { lsSet(K.active(), l.id); touchRecent(l.id); }
    render(); refresh(false);
  }
  async function newDoc(name, items, extra){
    if (lists.length >= MAX_LISTS) { toast('You have ' + MAX_LISTS + ' lists. Delete one to make another.', 'error'); return null; }
    const d = Object.assign({ id: rid(), name: String(name).slice(0, NAME_MAX), items: items.slice(0, MAX_ITEMS), collapsed: [], view: Object.assign({}, view()), shared: false }, extra || {});
    try { const s = await store.save(d); lists.push(s); return s; }
    catch (e) { console.warn('Stryker watchlist: create', e); toast('Could not create the list.', 'error'); return null; }
  }
  async function createList(name){
    await saveNow();
    const d = await newDoc(name, []);
    if (d) { if (viewing) endViewing(); setCur(d); toast('Created "' + d.name + '"'); }
  }
  async function copyCur(name){
    const src = cur;
    if (!src) return;
    if (!user() && viewing) { toast('Sign in to copy a shared list.', 'error'); return; }
    if (viewing) {
      // From a shared (read-only) list: leave the read-only view at once and show the copy;
      // the first cloud write can take a few seconds, so it saves in the background.
      if (lists.length >= MAX_LISTS) { toast('You have ' + MAX_LISTS + ' lists. Delete one to make another.', 'error'); return; }
      const d = { id: rid(), name: String(name).slice(0, NAME_MAX), items: src.items.slice(0, MAX_ITEMS), collapsed: (src.collapsed || []).slice(), view: Object.assign({}, view()), shared: false, updatedAt: Date.now() };
      stash = null; lists.push(d); endViewing(); setCur(d);
      try { const sv = await store.save(d); d.updatedAt = sv.updatedAt || d.updatedAt; toast('Saved as "' + d.name + '"'); }
      catch (e) {
        console.warn('Stryker watchlist: copy', e);
        lists = lists.filter((l) => l !== d); setCur(lists[0] || null);
        toast('Could not save the copy. Check your connection.', 'error');
      }
      return;
    }
    const d = await newDoc(name, src.items, { collapsed: (src.collapsed || []).slice() });
    if (d) { setCur(d); toast('Saved as "' + d.name + '"'); }
  }
  async function renameCur(name){
    if (!cur) return;
    cur.name = name.slice(0, NAME_MAX); render(); await saveNow(); toast('Renamed');
  }
  async function openList(id){
    await saveNow();
    if (viewing) endViewing();
    const l = lists.find((x) => x.id === id);
    if (!l) { toast('That list no longer exists.', 'error'); return; }
    setCur(l);
  }
  async function deleteList(id){
    const l = lists.find((x) => x.id === id);
    if (!l || !window.confirm('Delete the list "' + l.name + '"? This cannot be undone.')) return false;
    try { await store.remove(id, l.shared); } catch (e) { toast('Could not delete the list.', 'error'); return false; }
    lists = lists.filter((x) => x.id !== id);
    lsSet(K.recent(), lsGet(K.recent(), []).filter((x) => x !== id));
    if (cur && cur.id === id) {
      if (!lists.length) { const d = await newDoc('Watchlist', DEFAULT_ITEMS); setCur(d); }
      else setCur(lists[0]);
    }
    toast('List deleted');
    return true;
  }

  // ---- sharing ----
  function linkOf(id){ return location.origin + location.pathname.replace(/\.html$/, '') + '?watchlist=' + encodeURIComponent(id); }
  async function copyLink(){
    if (!cur || !cur.shared) return;
    const url = linkOf(cur.id);
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { window.prompt('Copy this link', url); }
  }
  async function setShared(on, cb){
    if (!cur || !user()) return;
    try {
      if (on) { cur.shared = true; await store.save(cur); }
      else { await sharedDoc(cur.id).delete(); cur.shared = false; await store.save(cur); }
      toast(on ? 'Sharing on. The link is copied.' : 'Sharing off. The link no longer works.');
      if (on) copyLink();
      listMenu.set(false);
    } catch (e) {
      console.warn('Stryker watchlist: share', e);
      cur.shared = !on; if (cb) cb.checked = !on;
      toast('Could not change sharing.', 'error');
    }
  }
  let stash = null;
  async function openShared(id){
    if (!/^[A-Za-z0-9]{20,40}$/.test(id)) { toast('That watchlist link is not valid.', 'error'); return; }
    if (!user()) { toast('Sign in to open a shared watchlist.', 'error'); return; }
    let snap = null;
    try { snap = await sharedDoc(id).get(); } catch (e) { snap = null; }
    if (!snap || !snap.exists) { toast('This shared watchlist is no longer available.', 'error'); dropParam(); return; }
    const x = snap.data() || {};
    if (x.ownerUid === user().uid) { dropParam(); return openList(id); }
    const items = (Array.isArray(x.items) ? x.items : []).filter((s) => typeof s === 'string' && (isSec(s) || /^(futures|fx|binance|coinbase|hyperliquid):[A-Za-z0-9!._\-/]{1,30}$/.test(s))).slice(0, MAX_ITEMS);
    stash = cur;
    viewing = { id, name: String(x.name || 'Shared list').slice(0, NAME_MAX), ownerUid: x.ownerUid };
    cur = { id, name: viewing.name, items, collapsed: [], view: Object.assign({}, stash ? stash.view : VIEW_DEF), shared: false };
    banner.hidden = false;
    banner.replaceChildren(el('span', { text: 'Shared by another member. Read-only.' }),
      el('button', { type: 'button', class: 'stkw-bb', text: 'Make a copy', onclick: () => askName('Make a copy', viewing.name + ' (copy)', copyCur) }),
      el('button', { type: 'button', class: 'stkw-bl', text: 'Close', onclick: leaveShared }));
    setOpen(true, { noSave: true });
    render(); refresh(true);
  }
  function dropParam(){ try { const u = new URL(location.href); if (u.searchParams.has('watchlist')) { u.searchParams.delete('watchlist'); history.replaceState(null, '', u.pathname + u.search + u.hash); } } catch (e) {} }
  function endViewing(){ viewing = null; banner.hidden = true; banner.replaceChildren(); dropParam(); }
  function leaveShared(){ endViewing(); setCur(stash || lists[0] || null); stash = null; }

  // ---- dialogs ----
  function modal(title, bodyEl, footEl){
    const back = el('div', { class: 'stkw-back' });
    const box = el('div', { class: 'stkw-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const x = el('button', { type: 'button', class: 'stkw-ib', 'aria-label': 'Close', html: I.close });
    box.append(el('div', { class: 'stkw-dhd' }, [el('h2', { text: title }), x]), bodyEl);
    if (footEl) box.appendChild(footEl);
    back.appendChild(box);
    const done = () => { back.remove(); document.removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    x.addEventListener('click', done);
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
    document.addEventListener('keydown', esc, true);
    document.body.appendChild(back);
    return { box, done };
  }
  function askName(title, init, fn, label, max){
    max = max || NAME_MAX;
    const inp = el('input', { type: 'text', class: 'stkw-in', maxlength: String(max), 'aria-label': label || 'List name' });
    inp.value = String(init || '').slice(0, max);
    const ok = el('button', { type: 'button', class: 'stkw-pbtn', text: 'Save' });
    const err = el('p', { class: 'stkw-err', hidden: true });
    const m = modal(title, el('div', { class: 'stkw-dbody' }, [inp, err]), el('div', { class: 'stkw-dft' }, [ok]));
    const go = async () => {
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, max);
      if (!v) { err.hidden = false; err.textContent = 'Enter a name.'; inp.focus(); return; }
      m.done(); await fn(v);
    };
    ok.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  function openDialog(){
    const q = el('input', { type: 'search', class: 'stkw-in', placeholder: 'Search lists', 'aria-label': 'Search lists' });
    const ul = el('ul', { class: 'stkw-ll', role: 'listbox', 'aria-label': 'Your watchlists' });
    const m = modal('Open list', el('div', { class: 'stkw-dbody' }, [q, ul]), el('div', { class: 'stkw-dft' }, [el('span', { class: 'stkw-note', text: lists.length + ' / ' + MAX_LISTS + ' lists' + (user() ? '' : ' · saved in this browser') })]));
    const rec = lsGet(K.recent(), []);
    const paint = () => {
      const s = q.value.trim().toLowerCase();
      ul.innerHTML = '';
      const f = lists.filter((l) => !s || l.name.toLowerCase().includes(s) || symbolsOf(l).some((x) => tickerOf(x).toLowerCase().includes(s)))
        .sort((a, b) => { const ra = rec.indexOf(a.id), rb = rec.indexOf(b.id); return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || b.updatedAt - a.updatedAt; });
      if (!f.length) ul.appendChild(el('li', { class: 'stkw-empty', text: 'No lists match.' }));
      f.forEach((l) => {
        const b = el('button', { type: 'button', class: 'stkw-lrow' + (cur && cur.id === l.id ? ' on' : ''), role: 'option', 'aria-selected': cur && cur.id === l.id ? 'true' : 'false' },
          [el('b', { text: l.name }), l.shared ? el('em', { text: 'shared' }) : null, el('small', { text: symbolsOf(l).length + ' symbols' })]);
        b.addEventListener('click', () => { m.done(); openList(l.id); });
        const del = el('button', { type: 'button', class: 'stkw-ib stkw-del', title: 'Delete', 'aria-label': 'Delete ' + l.name, html: I.trash });
        del.addEventListener('click', async () => { if (await deleteList(l.id)) paint(); });
        ul.appendChild(el('li', { class: 'stkw-li' }, [b, del]));
      });
    };
    q.addEventListener('input', paint);
    paint();
    setTimeout(() => q.focus(), 0);
  }
  function uploadDialog(){
    const file = el('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', class: 'stkw-file', 'aria-label': 'Choose a .txt or .csv file' });
    const info = el('p', { class: 'stkw-note', text: 'A .txt or .csv of symbols, separated by commas or new lines (TradingView exports work). "###NAME" starts a section. Futures we carry: ' + FUT_ROOTS.join(', ') + '; forex pairs: ' + FX_PAIRS.join(', ') + '; crypto pairs from our exchange feeds.' });
    const out = el('div', { class: 'stkw-upout' });
    const nameIn = el('input', { type: 'text', class: 'stkw-in', maxlength: String(NAME_MAX), 'aria-label': 'New list name', placeholder: 'New list name' });
    const ok = el('button', { type: 'button', class: 'stkw-pbtn', text: 'Create list', disabled: true });
    const m = modal('Upload list', el('div', { class: 'stkw-dbody' }, [info, file, nameIn, out]), el('div', { class: 'stkw-dft' }, [ok]));
    let parsed = null;
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 200000) { out.textContent = 'That file is too big (200 KB max).'; return; }
      const text = await f.text();
      parsed = parseUpload(text, ws.feed);
      const n = parsed.items.filter((x) => !isSec(x)).length;
      if (n > MAX_SYMBOLS) { parsed.items = trimTo(parsed.items, MAX_SYMBOLS); }
      if (!nameIn.value) nameIn.value = f.name.replace(/\.(txt|csv)$/i, '').slice(0, NAME_MAX);
      out.replaceChildren(el('p', { class: 'stkw-ok', text: Math.min(n, MAX_SYMBOLS) + ' symbol' + (n === 1 ? '' : 's') + ' found' + (n > MAX_SYMBOLS ? ' (only the first ' + MAX_SYMBOLS + ' are kept)' : '') + '.' }));
      if (parsed.bad.length) {
        out.appendChild(el('p', { class: 'stkw-err', text: parsed.bad.length + ' not recognised and NOT added:' }));
        out.appendChild(el('p', { class: 'stkw-bad', text: parsed.bad.slice(0, 60).join(', ') + (parsed.bad.length > 60 ? ' …' : '') }));
      }
      ok.disabled = !n;
    });
    ok.addEventListener('click', async () => {
      if (!parsed) return;
      const name = nameIn.value.replace(/\s+/g, ' ').trim() || 'Uploaded list';
      m.done();
      await saveNow();
      const d = await newDoc(name, parsed.items);
      if (d) { if (viewing) endViewing(); setCur(d); toast('Uploaded "' + d.name + '"' + (parsed.bad.length ? ' (' + parsed.bad.length + ' not recognised)' : '')); }
    });
  }
  function trimTo(items, n){ const out = []; let c = 0; for (const s of items) { if (!isSec(s)) { if (c >= n) continue; c++; } out.push(s); } return out; }

  // "Add alert on the list…": one price-crossing alert per selected symbol, at a price the member sets
  // (prefilled with the last price). Alerts run in this browser while the Charts page is open.
  function alertListDialog(){
    const syms = selSet.size ? symbolsOf(cur).filter((s) => selSet.has(s)) : symbolsOf(cur);
    const cond = el('select', { class: 'stkw-in', 'aria-label': 'Condition' }, [
      el('option', { value: 'crossing', text: 'Crossing' }), el('option', { value: 'crossing_up', text: 'Crossing up' }),
      el('option', { value: 'crossing_down', text: 'Crossing down' }), el('option', { value: 'greater', text: 'Greater than' }), el('option', { value: 'less', text: 'Less than' })]);
    const rows = syms.map((s) => {
      const q = quotes.get(s);
      const cb = el('input', { type: 'checkbox' }); cb.checked = true;
      const pin = el('input', { type: 'number', step: 'any', class: 'stkw-in stkw-pin', 'aria-label': 'Price for ' + tickerOf(s) });
      if (q && Number.isFinite(q.last)) pin.value = String(+q.last.toFixed(decFor(s, q.last)));
      return { s, cb, pin, node: el('label', { class: 'stkw-arow' }, [cb, el('span', { text: tickerOf(s) }), pin]) };
    });
    const ok = el('button', { type: 'button', class: 'stkw-pbtn', text: 'Create ' + syms.length + ' alert' + (syms.length === 1 ? '' : 's') });
    const upd = () => { const n = rows.filter((r) => r.cb.checked).length; ok.textContent = 'Create ' + n + ' alert' + (n === 1 ? '' : 's'); ok.disabled = !n; };
    rows.forEach((r) => r.cb.addEventListener('change', upd));
    const m = modal('Add alert on the list', el('div', { class: 'stkw-dbody' }, [
      el('p', { class: 'stkw-note', text: 'One price alert per symbol' + (selSet.size ? ' (the rows you selected)' : '') + ', starting at its last price. Alerts work while the Charts page is open. Education only. Not financial advice.' }),
      el('label', { class: 'stkw-arow stkw-acond' }, [el('span', { text: 'Condition' }), cond]),
      el('div', { class: 'stkw-alist' }, rows.map((r) => r.node))
    ]), el('div', { class: 'stkw-dft' }, [ok]));
    ok.addEventListener('click', async () => {
      const A = window.__stkAlerts;
      if (!A || !A.add) { toast('Alerts are not ready yet. Try again in a moment.', 'error'); return; }
      ok.disabled = true;
      let made = 0, failed = 0;
      for (const r of rows) {
        if (!r.cb.checked) continue;
        const p = parseFloat(r.pin.value);
        if (!Number.isFinite(p)) { failed++; continue; }
        try { await A.add({ symbol: r.s, cond: cond.value, price: p, message: '', freq: 'once', active: true }); made++; }
        catch (e) { failed++; if (e && e.full) break; }
      }
      m.done();
      toast(made + ' alert' + (made === 1 ? '' : 's') + ' created' + (failed ? ', ' + failed + ' not created' : ''), failed && !made ? 'error' : 'success');
    });
  }

  // ---- "+" symbol search (the chart's own symbol search) ----
  let picker = null;
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (viewing) return;
    if (!SymbolPicker) { toast('Symbol search is not ready.', 'error'); return; }
    if (!picker) {
      picker = new SymbolPicker({
        host: document.getElementById('vela-chart'),
        iconFor: (d) => { try { return ws.feed.symbolIconOf(d); } catch (err) { return undefined; } },
        onSelect: (raw) => {
          const s = normalizeSymbol(raw, ws.feed) || (/^[a-z]+:/i.test(raw) ? raw : null);
          if (s) addSymbol(s); else toast('That symbol is not available here.', 'error');
        }
      });
      picker.setSource(() => ws.feed.symbols());
    }
    picker.open('');
  });

  // ---- boot ----
  async function loadAll(){
    loading = true; render();
    store = user() ? cloudStore() : localStore();
    try { lists = await store.list(); }
    catch (e) { console.warn('Stryker watchlist: load', e); lists = []; toast('Could not load your watchlists.', 'error'); }
    loading = false;
    if (!lists.length) {
      const d = await newDoc('Watchlist', DEFAULT_ITEMS);
      if (!d) lists = [{ id: rid(), name: 'Watchlist', items: DEFAULT_ITEMS.slice(), collapsed: [], view: Object.assign({}, VIEW_DEF), shared: false }];
    }
    const want = lsGet(K.active(), null);
    if (!viewing) setCur(lists.find((l) => l.id === want) || lists[0]);
  }
  let lastUid = undefined;
  const sharedTried = new Set();   // one attempt per link per page load (no duplicate toasts)
  const onAuth = async () => {
    const u = user(); const id = u ? u.uid : null;
    if (id === lastUid) return;
    lastUid = id;
    await loadAll();
    let sid = null;
    try { sid = new URL(location.href).searchParams.get('watchlist'); } catch (e) {}
    if (sid && u && !sharedTried.has(sid)) { sharedTried.add(sid); openShared(sid); }
  };
  try { firebase.auth().onAuthStateChanged(onAuth); } catch (e) { onAuth(); }
  if (!isPhone() && lsGet(K.open, false)) setOpen(true, { noSave: true });
  window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });

  const api = {
    get open(){ return open; }, setOpen, get current(){ return cur; }, get lists(){ return lists; }, get viewing(){ return viewing; },
    quotes, refresh, addSymbol, removeSyms, addSection, moveItem, toggleSection, openList, createList, copyCur, renameCur, deleteList,
    setShared, openShared, leaveShared, linkOf, parseUpload: (t) => parseUpload(t, ws.feed), normalize: (s) => normalizeSymbol(s, ws.feed),
    saveNow, select: (s) => { sel = s; markSel(); }, selectMany: (a) => { selSet = new Set(a); markSel(); }, alertListDialog, uploadDialog, openDialog,
    get store(){ return store.kind; }
  };
  window.STRYKER_WATCHLIST = api;
  return api;
}
