// TradeZoro — Charts NEWS panel (charts.html only) — ES module
// Owner-approved 2026-10-14 (news + economic calendar job, part A1).
//
// A "News" button in the right icon bar (build 537 layout: assets/chart-tv-toolbars.js puts it
// under the Watchlist button) opens a right-hand panel the same size and place as the Watchlist
// (the two share the slot: opening one closes the other). Phones (<= 700 px): a News button on the
// chart bar (folded into ⋯ More by assets/chart-onebar.js when the row is full) opens a full-screen
// sheet.
//
// CONTENT: the latest headlines for the chart's symbol (NQ/MNQ -> NQ, ES/MES -> ES, YM/MYM -> YM,
// GC/MGC -> GC, SI/SIL -> SI, CL/MCL -> CL, BTC*, ETH*; each feed also carries the macro news that
// moves it) or "All markets", plus a search box. Each row: time, source, title, and the short
// summary the wire provides (never the full article). Tapping a row opens the source's article in
// a new tab (rel=noopener noreferrer); rows without a link expand the summary instead.
//
// DATA: GET <recorder>/news?sym=&q=&limit=&to= (workers/book-recorder, src/news-routes.js;
// edge-cached; the server feeder is the only thing that calls the news vendor, so no key here).
// Polled every POLL_MS only while the panel is open and the tab visible. Search is debounced.
// BAR REPLAY: while replay is on (window.__stkReplay), `to` = the replay clock, so no headline
// published after the replayed bar is ever shown; the list follows the clock as it moves.
//
// Free for every member. Education only. Not financial advice.
// Depends on: vela-chart.js (ws.active.symbol, ws.on), chart-watchlist.js (.stkw-rail,
// .stkchart-panel.stkw-host, .stkw-railbtn), chart-tv-toolbars.js (rail layout), style.css (.stknw-*).

export const RECORDER = 'https://book-recorder.theelitegrey.workers.dev';
const POLL_MS = 60000;
const LIMIT = 80;
const PHONE_MAX = 700;
const LS_TAB = 'stknw_tab';
const LS_OPEN = 'stknw_open';

const ROOTS = { NQ: 'NQ', MNQ: 'NQ', ES: 'ES', MES: 'ES', YM: 'YM', MYM: 'YM', GC: 'GC', MGC: 'GC', SI: 'SI', SIL: 'SI', CL: 'CL', MCL: 'CL',
  NDX: 'NQ', QQQ: 'NQ', SPX: 'ES', SPY: 'ES', DJI: 'YM', DIA: 'YM', XAUUSD: 'GC', XAGUSD: 'SI', USOIL: 'CL' };
// Vela symbol string ("futures:MNQ1!", "binance:BTCUSDT", "NQ1!") -> our news feed tag, or ''.
export function newsSymOf(symbol) {
  const t = String(symbol || '').split(':').pop().toUpperCase().replace(/\.P$/, '');
  if (/^BTC/.test(t) || /^XBT/.test(t)) return 'BTC';
  if (/^ETH/.test(t)) return 'ETH';
  const m = /^([A-Z]{1,4}?)(?:1!|[FGHJKMNQUVXZ]\d{1,2})$/.exec(t);
  if (m && ROOTS[m[1]]) return ROOTS[m[1]];
  return ROOTS[t] || '';
}
export const FEED_LABEL = { NQ: 'Nasdaq 100', ES: 'S&P 500', YM: 'Dow', GC: 'Gold', SI: 'Silver', CL: 'Crude oil', BTC: 'Bitcoin', ETH: 'Ethereum' };

// "now", "4m", "3h", "Tue 14:05", "12 Oct" relative to `nowMs` (the replay clock in replay).
export function agoLabel(tSec, nowMs) {
  const d = Math.max(0, Math.round(nowMs / 1000 - tSec));
  if (d < 60) return 'now';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  const dt = new Date(tSec * 1000);
  if (d < 6 * 86400) return dt.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export const replayNow = () => { try { const r = window.__stkReplay; return r && r.on ? r.now() : 0; } catch (e) { return 0; } };

// One shared fetch per URL (panel + markers ask for the same thing): 20 s memo.
const memo = new Map();
export function fetchNews(o) {
  const p = new URLSearchParams();
  p.set('sym', o.sym || '');
  if (o.q) p.set('q', o.q);
  p.set('limit', String(o.limit || LIMIT));
  if (o.from) p.set('from', String(Math.floor(o.from)));
  if (o.to) p.set('to', String(Math.floor(o.to)));
  const url = RECORDER + '/news?' + p.toString();
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 20000) return hit.p;
  const pr = fetch(url, { credentials: 'omit' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((j) => {
      // replay cut-off enforced here too, whatever the server rounding did
      const cut = o.to ? Number(o.to) : Infinity;
      return { items: (j.items || []).filter((x) => x.t <= cut), updated: j.updated };
    });
  memo.set(url, { at: Date.now(), p: pr });
  if (memo.size > 40) memo.delete(memo.keys().next().value);
  pr.catch(() => memo.delete(url));
  return pr;
}

const svg = (d, s) => '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const IC = {
  news: '<rect x="3.5" y="5" width="14" height="14" rx="1.5"/><path d="M17.5 9h2.5v8.5a1.5 1.5 0 0 1-3 0"/><path d="M6.5 8.5h8M6.5 12h8M6.5 15.5h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  ext: '<path d="M14 5h5v5M19 5l-8 8M10 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4"/>'
};
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}

export function mountNews(ws, opts) {
  opts = opts || {};
  if (!ws || document.getElementById('stknw')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return ''; } };

  let open = false, tab = 'sym', q = '', items = [], loading = false, err = '', pollT = 0, typeT = 0, lastKey = '', lastReplayMin = -1, updated = null;
  try { tab = localStorage.getItem(LS_TAB) === 'all' ? 'all' : 'sym'; } catch (e) {}

  // ---- DOM ----
  const railBtn = el('button', { type: 'button', class: 'stkw-railbtn stknw-railbtn', title: 'News', 'aria-label': 'News', 'aria-pressed': 'false', html: svg(IC.news) });
  const tabSym = el('button', { type: 'button', class: 'stknw-tab', role: 'tab', 'data-tab': 'sym' });
  const tabAll = el('button', { type: 'button', class: 'stknw-tab', role: 'tab', 'data-tab': 'all', text: 'All markets' });
  const closeBtn = el('button', { type: 'button', class: 'stkw-ib stknw-close', title: 'Close', 'aria-label': 'Close news', html: svg(IC.close) });
  const head = el('div', { class: 'stknw-hd' }, [el('span', { class: 'stknw-title', text: 'News' }), el('span', { class: 'stknw-sp' }), closeBtn]);
  const tabs = el('div', { class: 'stknw-tabs', role: 'tablist', 'aria-label': 'News feed' }, [tabSym, tabAll]);
  const input = el('input', { type: 'search', class: 'stknw-q', placeholder: 'Search headlines', 'aria-label': 'Search headlines', maxlength: '60', autocomplete: 'off', spellcheck: 'false' });
  const search = el('label', { class: 'stknw-search' }, [el('span', { class: 'stknw-qi', html: svg(IC.search, 15) }), input]);
  const note = el('div', { class: 'stknw-note', hidden: true });
  const list = el('div', { class: 'stknw-list', role: 'feed', 'aria-label': 'Headlines', 'aria-busy': 'false' });
  const foot = el('p', { class: 'stknw-foot', text: 'Headlines and short summaries from the news wires; tap to read the article at its source. Education only. Not financial advice.' });
  const panel = el('aside', { class: 'stknw', id: 'stknw', 'aria-label': 'News', hidden: true }, [head, tabs, search, note, list, foot]);
  host.appendChild(panel);
  const phoneBtn = el('button', { type: 'button', class: 'stkc-btn stknw-phonebtn', title: 'News', 'aria-label': 'News', html: svg(IC.news, 16) + '<span class="stkc-btn-l">News</span>' });
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (barR) { const wl = barR.querySelector('.stkw-phonebtn'); barR.insertBefore(phoneBtn, wl ? wl.nextSibling : barR.firstChild); }

  // the rail is built by chart-watchlist.js (async): place the button under the Watchlist button
  function placeRail() {
    const rail = document.querySelector('.stkw-rail');
    if (!rail) return false;
    if (railBtn.parentNode !== rail) { const wl = rail.querySelector('.stkw-railbtn:not(.stknw-railbtn)'); rail.insertBefore(railBtn, wl ? wl.nextSibling : rail.firstChild); }
    return true;
  }
  if (!placeRail()) {
    const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); });
    mo.observe(host, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 30000);
  }

  // ---- open / close (shares the Watchlist slot) ----
  const wlOpen = () => host.classList.contains('stkw-open');
  function closeWatchlist() {
    if (!wlOpen()) return;
    const b = document.querySelector('.stkw .stkw-close');
    if (b) b.click();
  }
  function setOpen(v) {
    open = !!v;
    if (open) closeWatchlist();
    panel.hidden = !open;
    host.classList.toggle('stknw-open', open);
    document.documentElement.classList.toggle('stknw-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open));
    railBtn.classList.toggle('on', open);
    phoneBtn.classList.toggle('on', open);
    if (!isPhone()) { try { if (open) localStorage.setItem(LS_OPEN, '1'); else localStorage.removeItem(LS_OPEN); } catch (e) {} }
    if (open) { render(); load(true); schedule(); } else clearTimeout(pollT);
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  // the Watchlist opening (rail or phone button) closes News
  document.addEventListener('click', (e) => {
    if (!open || !e.target.closest) return;
    if (e.target.closest('.stkw-railbtn:not(.stknw-railbtn), .stkw-phonebtn')) setTimeout(() => { if (wlOpen()) setOpen(false); }, 0);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && isPhone()) setOpen(false); });
  window.addEventListener('resize', () => document.documentElement.classList.toggle('stknw-sheet', open && isPhone()), { passive: true });

  // ---- tabs + search ----
  [tabSym, tabAll].forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    tab = b.dataset.tab;
    try { localStorage.setItem(LS_TAB, tab); } catch (e) {}
    render(); load(true);
  }));
  input.addEventListener('input', () => {
    clearTimeout(typeT);
    typeT = setTimeout(() => { const v = input.value.trim(); if (v === q) return; q = v; load(true); }, 400);
  });

  // ---- data ----
  function want() {
    const fs = newsSymOf(activeSym());
    const sym = tab === 'sym' && fs ? fs : '';
    const rn = replayNow();
    return { sym, q: q.length >= 2 ? q : '', to: rn ? Math.floor(rn / 1000) : 0, fs };
  }
  async function load(force) {
    if (!open) return;
    const w = want();
    const key = JSON.stringify([w.sym, w.q, w.to ? Math.floor(w.to / 60) : 0]);
    if (!force && key === lastKey) return;
    lastKey = key;
    loading = true; err = '';
    list.setAttribute('aria-busy', 'true');
    paintNote();
    if (!items.length) paintList();
    try {
      const r = await fetchNews({ sym: w.sym, q: w.q, to: w.to, limit: LIMIT });
      if (key !== lastKey) return;          // a newer request took over
      items = r.items; updated = r.updated;
    } catch (e) {
      if (key !== lastKey) return;
      err = 'News could not be loaded. It retries in a minute.';
    }
    loading = false;
    list.setAttribute('aria-busy', 'false');
    paintNote(); paintList();
  }
  function schedule() {
    clearTimeout(pollT);
    if (!open) return;
    // replay: follow the replay clock (cheap: only re-asks when it moved a minute)
    const rn = replayNow();
    const ms = rn ? 3000 : POLL_MS;
    pollT = setTimeout(() => {
      if (!document.hidden) {
        const r2 = replayNow();
        if (r2) { const m = Math.floor(r2 / 60000); if (m !== lastReplayMin) { lastReplayMin = m; load(false); } }
        else { lastReplayMin = -1; load(true); }
      }
      schedule();
    }, ms);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && open) load(false); });
  try { ws.on('state:changed', () => { if (open) { renderTabs(); load(false); } }); } catch (e) {}

  // ---- render ----
  function renderTabs() {
    const fs = newsSymOf(activeSym());
    tabSym.textContent = fs ? fs + ' · ' + FEED_LABEL[fs] : 'This chart';
    tabSym.disabled = !fs;
    tabSym.title = fs ? 'Headlines for ' + FEED_LABEL[fs] + ' plus the macro news that moves it' : 'No news feed for this symbol: showing all markets';
    const cur = fs && tab === 'sym' ? 'sym' : 'all';
    [tabSym, tabAll].forEach((b) => { const on = b.dataset.tab === cur; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  }
  function paintNote() {
    const rn = replayNow();
    let t = '';
    if (rn) t = 'Bar replay: headlines up to ' + new Date(rn).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' only.';
    else if (err) t = err;
    note.textContent = t;
    note.hidden = !t;
    note.classList.toggle('is-replay', !!rn);
  }
  function paintList() {
    list.textContent = '';
    if (!items.length) {
      list.appendChild(el('div', { class: 'stknw-empty', text: loading ? 'Loading headlines…' : (q ? 'No headlines match "' + q + '" in the last 7 days.' : 'No headlines yet.') }));
      return;
    }
    const now = replayNow() || Date.now();
    for (const x of items) {
      const when = new Date(x.t * 1000);
      const meta = el('div', { class: 'stknw-meta' }, [
        el('time', { datetime: when.toISOString(), title: when.toLocaleString(), text: agoLabel(x.t, now) }),
        x.s ? el('span', { class: 'stknw-src', text: x.s }) : null
      ]);
      const title = el('span', { class: 'stknw-h', text: x.h });
      const sum = x.m ? el('span', { class: 'stknw-m', text: x.m }) : null;
      let row;
      if (x.u) {
        row = el('a', { class: 'stknw-row', href: x.u, target: '_blank', rel: 'noopener noreferrer', title: 'Open the article at ' + (x.s || 'the source') + ' (new tab)' }, [meta, title, sum]);
        meta.appendChild(el('span', { class: 'stknw-ext', html: svg(IC.ext, 12) }));
      } else {
        row = el('button', { type: 'button', class: 'stknw-row is-nolink', 'aria-expanded': 'false' }, [meta, title, sum]);
        row.addEventListener('click', () => { const on = row.classList.toggle('is-open'); row.setAttribute('aria-expanded', String(on)); });
      }
      list.appendChild(row);
    }
  }
  function render() { renderTabs(); paintNote(); paintList(); }

  try { if (!isPhone() && localStorage.getItem(LS_OPEN) === '1') setTimeout(() => setOpen(true), 400); } catch (e) {}
  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; }, get items() { return items; }, get tab() { return tab; }, reload: () => load(true), newsSymOf };
  window.__stkNews = api;
  return api;
}
