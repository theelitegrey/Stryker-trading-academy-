// TradeZoro — Charts: data-feed badges L1 · L2 · L3 (Owner order 2026-11-03). One chip row on the chart + a tap-for-details sheet.
// Lit = in use on this chart now. Dim = not in use. Delayed = in use on the recorded book, 10 min delayed (ALL TOOLS FREE, Owner 2026-11-13:
// only the LIVE futures order book is a paid data feed). Locked = signed out (the tools need a free account).
// REGISTER AN INDICATOR OR PANEL (one line, from any module):
//   import { registerFeed } from './chart-feeds.js?v=1096';   registerFeed('stk_of_big', { needs: 'L1', title: 'Big Trades' });
//   (no module? window.STRYKER_FEEDS.register('stk_of_big', { needs: 'L1', title: 'Big Trades' }))
// Options: mkt 'futures' | 'crypto' (only counts on that market; default any). A panel that is not an indicator calls setPanel(id, true|false).
// Plain names only in the UI: no vendor names. Education only. Not financial advice.

import { isFree } from './chart-pro-gate.js?v=1096';
import { isFutures } from './chart-sym.js?v=1096';   // one futures test for every symbol form (CME_MINI:MNQ1!, MNQZ6 ...)

export const LEVELS = {
  L1: { name: 'L1', short: 'trades and best bid/ask', what: 'Every trade plus the best bid and ask.' },
  L2: { name: 'L2', short: 'full order book', what: 'The full order book: up to 400 prices each side.' },
  L3: { name: 'L3', short: 'individual orders', what: 'Every single order in the book.' }
};
export const L3_SOON = "Individual-order data (L3) isn't available yet.";

// WHY NOTES (Owner 2026-11-03): subtle reason shown every time a locked feed is on the chart, in the Unlock prompt and in the sheet. Edit the words here only.
// Plain English: no prices, no fee amounts, no vendor names except CME / "the exchange", no "required by law".
export const WHY = {
  futures: { short: 'Live order book · paid data', long: "Live futures order book data is a paid data feed. Exchange rules set it, so we can't give it free. Tools are free; this is the data. Without it the order book tools use the recorded book, 10 minutes delayed. Live trades, candles and best bid/ask (L1) are free once you sign the market data agreement." },
  crypto: { short: 'Full order book · free', long: 'Crypto order books are live and free for every member.' }
};
export const whyFor = (mkt, L) => (L === 'L3' ? null : mkt === 'crypto' ? WHY.crypto : mkt === 'futures' ? WHY.futures : null);

const reg = new Map();     // indicator type -> { needs, title, mkt }
const panels = new Map();  // panel id -> { needs, title, mkt }
export function registerFeed(type, o) {
  if (!type || !o || !LEVELS[o.needs]) throw new Error('registerFeed(type, { needs: L1|L2|L3, title })');
  reg.set(type, { needs: o.needs, title: o.title || type, mkt: o.mkt || '' });
  poke();
}
export const feedOf = (type) => reg.get(type) || null;
export function setPanel(id, on, o) { if (on) panels.set(id, Object.assign({ needs: 'L2', title: id, mkt: '' }, o || {})); else panels.delete(id); poke(); }

// What the plan includes, from the market kind + the existing gates (l2Visible for futures, Pro for crypto books). Never changes who gets what.
// l1 = the server grants live L1 (signed agreement, Owner 2026-11-04)
// ALL TOOLS FREE (2026-11-13): l2 = the tools may run (signed in), delayed = futures book without the paid live feed (10 min delayed)
export function haveFor({ mkt, l2, free, l1, delayed }) {
  return { L1: mkt === 'futures' ? (!free || !!l2 || !!l1) : true, L2: mkt === 'futures' ? !!l2 : mkt === 'crypto' ? !free : false, L3: false, delayed: mkt === 'futures' && !!l2 && !!delayed };
}
export const bestOf = (have) => (have.L2 ? 'L2' : 'L1');
export const reasonFor = (lvl, have) => (lvl === 'L3' ? L3_SOON : 'Sign in to use ' + lvl + ' tools. They are free.');
export const DELAYED = 'Order book 10 min delayed · live book is a paid data feed';

// used: [{ id, title, needs }]  ->  { show, L1: { state, users, locked }, L2, L3 }   state = 'lit' | 'dim' | 'locked'
export function feedState(used, have) {
  const out = { show: used.length > 0 };
  for (const L of ['L1', 'L2', 'L3']) {
    const users = used.filter((u) => u.needs === L);
    const implied = L === 'L1' && have.L1 && used.some((u) => u.needs === 'L2' && have.L2);   // the book feed carries the trades too
    const state = !users.length && !implied ? 'dim' : !have[L] ? 'locked' : L === 'L2' && have.delayed ? 'delayed' : 'lit';
    out[L] = { state, users: users.map((u) => u.title), locked: state === 'locked' ? reasonFor(L, have) : state === 'delayed' ? DELAYED : '' };
  }
  return out;
}
// L3 is shown only when something asks for it
export const visibleLevels = (st) => (st.L3.users.length ? ['L1', 'L2', 'L3'] : ['L1', 'L2']);

// ---------------------------------------------------------------------------------------- live part
const stats = {};   // mkt -> (symbol, nowMs) => { symbol, status: 'live'|'wait', ageMs, bookRate, tradeRate }
export function setStats(mkt, fn) { stats[mkt] = fn; }
let refresh = null;
const poke = () => { if (refresh) refresh(); };
const rate = (v) => (v == null ? '' : ' (~' + (v >= 10 ? Math.round(v) : v >= 0.95 ? Math.round(v * 10) / 10 : '<1') + '/s)');
const ago = (ms) => (ms < 60000 ? Math.round(ms / 1000) + ' s' : Math.round(ms / 60000) + ' min');
const mktOf = (sym) => (isFutures(sym) ? 'futures' : /^(binance|coinbase|hyperliquid|bybit|okx|bitget|kraken|vest):/i.test(sym) ? 'crypto' : '');
const cleanSym = (s) => String(s || '').replace(/^[a-z]+:/i, '');

// Right-now lines for one level (pure given the stats object s, which may be null)
export function nowLines(L, st, s, have, mkt, symbol) {
  if (st[L].state === 'locked') return [st[L].locked];
  if (st[L].state === 'delayed') return ['Symbol: ' + symbol, 'Status: Recorded order book, 10 min delayed', 'Live order book: a paid data feed'];
  if (st[L].state === 'dim') return ['Not in use on this chart.'];
  if (st[L].wait) return ['Symbol: ' + symbol, 'Status: ' + CONNECTING];
  const lines = ['Symbol: ' + symbol];
  if (mkt === 'futures' && !have.L2) { lines.push('Status: Standard feed, about 10 min delayed'); lines.push('Receiving: price candles'); return lines; }
  const live = !s || s.status === 'live';
  lines.push('Status: ' + (live ? (s && s.ageMs > 5000 ? 'Live · updated ' + ago(s.ageMs) + ' ago' : 'Live') : 'Reconnecting…'));
  if (L === 'L1') lines.push('Receiving: trades' + rate(s && s.tradeRate) + ', best bid/ask');
  else if (L === 'L2') lines.push('Receiving: book updates' + rate(s && s.bookRate));
  return lines;
}

const LOCK = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z"/></svg>';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// SAFETY (L2 lock fix 3): an admin, or a member the plan check answered as NOT Free, is never shown a lock: while their book connects
// they see "Connecting to the order book…" instead. Only a confirmed Free / signed-out member with no book frames sees Unlock.
const noLock = () => { try { if (window.tzRtState && window.tzRtState().admin && !isFree()) return true; } catch (e) {}   // rt 'admin' = any live member; a Free one (signed agreement, L1 only) can still be locked out of L2
  return window.__stkChartFree !== undefined && !isFree(); };   // __stkChartFree is set only once the plan check answered
export const CONNECTING = 'Connecting to the order book…';
export function mountFeedBadges(ws) {
  if (typeof document === 'undefined' || !ws || document.getElementById('stkfeeds')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel') || document.body;
  const row = document.createElement('div'); row.id = 'stkfeeds'; row.className = 'stkfeeds'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Data feeds'); row.hidden = true;
  const sheet = document.createElement('div'); sheet.id = 'stkfeed-sheet'; sheet.className = 'stkfeed-sheet'; sheet.setAttribute('role', 'dialog'); sheet.hidden = true;
  const note = document.createElement('div'); note.id = 'stkfeed-note'; note.className = 'stkfeed-note'; note.hidden = true;
  const wrap = document.createElement('div'); wrap.id = 'stkfeeds-wrap'; wrap.className = 'stkfeeds-wrap';   // chips + lock note + why in ONE normal-flow column: nothing inside can overlap another
  const arrow = document.createElement('i'); arrow.className = 'stkfeed-arrow'; arrow.hidden = true; arrow.setAttribute('aria-hidden', 'true');
  wrap.append(row, note); host.append(wrap, sheet, arrow);
  let whyOpen = false;
  let openL = '', last = null, cur = null;

  const usedNow = () => {
    let sym = '', types = [];
    try { sym = ws.active.symbol || ''; } catch (e) {}
    try { types = ws.chart.indicators().map((h) => h.nativeType).filter(Boolean); } catch (e) {}
    const mkt = mktOf(sym), used = [];
    types.forEach((t) => { const r = reg.get(t); if (r && (!r.mkt || r.mkt === mkt)) used.push({ id: t, title: r.title, needs: r.needs }); });
    panels.forEach((p, id) => { if (!p.mkt || p.mkt === mkt) used.push({ id, title: p.title, needs: p.needs }); });
    const free = isFree();
    let l2 = false; try { l2 = !!((window.STRYKER_L2_BADGE || window.STRYKER_L2_OK)()); } catch (e) {}
    // data is proof: book frames for this root arriving now = the member has L2 (the hub sends them to book-tier sockets only)
    try { if (window.STRYKER_L2_PROVEN && window.STRYKER_L2_PROVEN(sym)) l2 = true; } catch (e) {}
    let l1 = false; try { l1 = !!(window.tzRtState && window.tzRtState().admin); } catch (e) {}
    let delayed = false; try { delayed = !!(window.STRYKER_L2_DELAYED && window.STRYKER_L2_DELAYED()); } catch (e) {}
    return { sym, mkt, used, have: haveFor({ mkt, l2, free, l1, delayed }), sure: noLock() };
  };
  // signed out: the sign-in page; delayed futures book: the live-data paywall (assets/plan-modal.js); nothing else is sold (2026-11-13)
  const unlock = (reason, L) => {
    const st = last && last[L];
    if (!st || st.state !== 'delayed') { try { location.href = 'login.html?next=' + encodeURIComponent(location.pathname.replace(/^\//, '') + location.search); } catch (e) {} return; }
    if (typeof window.strykerLiveDataPaywall === 'function') window.strykerLiveDataPaywall();
    else if (typeof window.openPlanUpgradeModal === 'function') window.openPlanUpgradeModal(WHY.futures.long);
  };

  // Chips sit top-left, just under the symbol legend + indicator rows (they can fold), so the pencil FAB, GEX pill, Fit price / Latest and the delayed pill never cover them.
  function place() {
    const hr = host.getBoundingClientRect(); let b = 0;
    host.querySelectorAll('.vela-statusline, .vela-ind-fold, .stkpt-1c').forEach((e) => {   // .stkpt-1c = paper one-click BUY/SELL box: chips go under it
      const n = e.classList.contains('vela-ind-fold') ? e.parentElement : e;   // the fold button's own row block (the indicator rows)
      const r = n.getBoundingClientRect(); if (r.height && r.height < 300 && r.top - hr.top < 300) b = Math.max(b, r.bottom - hr.top);
    });
    const t = Math.round(b ? b + 4 : 48);
    wrap.style.top = t + 'px';
    anchor();
  }
  // The card sits ABOVE the pill it belongs to (below it when there is no room), centred on it, clamped inside the chart with 8px margin; the arrow points at the pill.
  function anchor() {
    if (!openL || sheet.hidden) { arrow.hidden = true; return; }
    const pill = row.querySelector('.stkfeed[data-l="' + openL + '"]'); if (!pill) return;
    const hr = host.getBoundingClientRect(), pr = pill.getBoundingClientRect(), sw = sheet.offsetWidth, sh = sheet.offsetHeight;
    const cx = pr.left + pr.width / 2 - hr.left;
    const left = Math.max(8, Math.min(cx - sw / 2, hr.width - sw - 8));
    const up = pr.top - hr.top - 10 - sh >= 8;
    const top = up ? pr.top - hr.top - 10 - sh : pr.bottom - hr.top + 10;
    Object.assign(sheet.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
    arrow.hidden = false; arrow.dataset.side = up ? 'up' : 'down';
    arrow.style.left = Math.round(cx - 6) + 'px'; arrow.style.top = Math.round(up ? top + sh - 6 : top - 6) + 'px';
  }
  // L1/L2 chips live in the chart's bottom status bar, left of the clock (Owner order 2026-11-15). Latency chip (other branch) can sit beside them.
  let docked = false;
  function dock() {
    const bar = host.querySelector('.vela-widget-bottombar'), anchor = bar && bar.querySelector('.vela-bb-tz');
    docked = !!(anchor && bar.offsetWidth);   // phone: the bar is hidden, chips fall back to the legend corner
    if (docked) { if (row.nextElementSibling !== anchor) anchor.before(row); }
    else if (row.parentElement !== wrap) wrap.prepend(row);
    sheet.classList.toggle('is-docked', docked);
    return bar;
  }
  function paint() {
    cur = usedNow();
    const st = feedState(cur.used, cur.have);
    // no hub / exchange book for this market (e.g. a stock): L2 is not a plan matter. Lit when the member's own connected feed streams
    // depth for it (chart-depth-source.js), else not in use; the tool itself says what would make it work.
    if (!cur.mkt && st.L2.state === 'locked') { const bs = window.__stkBookSources, pv = (/^([a-z0-9_-]+):/i.exec(cur.sym) || [])[1]; st.L2.state = bs && pv && typeof bs[pv.toLowerCase()] === 'function' ? 'lit' : 'dim'; st.L2.locked = ''; }
    if (cur.sure) for (const L of ['L1', 'L2']) if (st[L].state === 'locked') { st[L].state = 'lit'; st[L].locked = ''; st[L].wait = true; }
    last = st;
    row.hidden = !st.show;
    dock();
    place();
    wrap.hidden = !st.show;
    if (!st.show) { note.hidden = true; sheet.hidden = true; openL = ''; return; }
    const lv = visibleLevels(st);
    if (row.dataset.sig !== lv.join() + ['L1', 'L2', 'L3'].map((L) => st[L].state).join()) {
      row.dataset.sig = lv.join() + ['L1', 'L2', 'L3'].map((L) => st[L].state).join();
      row.innerHTML = lv.map((L) => {
        const s = st[L].state;
        return '<button type="button" class="stkfeed is-' + s + (openL === L ? ' on' : '') + '" data-l="' + L + '" aria-haspopup="dialog" aria-expanded="' + (openL === L) + '" aria-label="' + L + ' data feed, ' +
          (s === 'lit' ? 'in use' : s === 'delayed' ? 'in use, 10 minutes delayed' : s === 'locked' ? 'locked, sign in' : 'not in use') + '"><i class="stkfeed-dot" aria-hidden="true"></i><span>' + L + '</span>' + (s === 'locked' ? LOCK : s === 'delayed' ? '<small>10m delayed</small>' : '') + '</button>';
      }).join('');
    }
    // live dot colour on the lit chips: green when the feed is live, amber while it reconnects
    const s = stats[cur.mkt] && cur.have.L2 ? stats[cur.mkt](cur.sym, Date.now()) : null;
    row.classList.toggle('is-wait', !!(s && s.status !== 'live'));
    // brief reason on the chart for the first locked level (not L3: that one has no plan to unlock)
    const lk = lv.find((L) => (st[L].state === 'locked' || st[L].state === 'delayed') && L !== 'L3');
    if (lk && !openL) {
      const names = st[lk].users.join(', '), w = whyFor(cur.mkt, lk);
      const dl = st[lk].state === 'delayed';
      note.innerHTML = '<span class="stkfeed-reason">' + esc(st[lk].locked) + '</span><em>' + esc(names) + '</em><button type="button" class="stkfeed-unlock">' + (dl ? 'Get live data' : 'Sign in') + '</button>' +
        (w && dl ? '<div class="stkfeed-why"><span class="stkfeed-why-l"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM8 7.2v3.6"/><circle cx="8" cy="5" r=".9" fill="currentColor"/></svg>' + esc(w.short) +
        ' <button type="button" class="stkfeed-why-b" aria-expanded="' + whyOpen + '">Why?' + (whyOpen ? '' : ' →') + '</button></span>' + (whyOpen ? '<p class="stkfeed-why-t">' + esc(w.long) + '</p>' : '') + '</div>' : '');
      note.dataset.l = lk; note.hidden = false;
    } else if (!openL && lv.some((L) => st[L].wait)) { note.innerHTML = '<span class="stkfeed-reason">' + esc(CONNECTING) + '</span>'; note.dataset.l = ''; note.hidden = false; }
    else note.hidden = true;
    if (openL) paintSheet(st, s);
  }
  function paintSheet(st, s) {
    const L = openL, S = st[L];
    if (!S || (L === 'L3' && !S.users.length)) { close(); return; }
    const lines = nowLines(L, st, s, cur.have, cur.mkt, cleanSym(cur.sym));
    const who = S.users.length ? '<ul>' + S.users.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '<p class="stkfeed-mute">Nothing on this chart uses ' + L + ' right now.</p>';
    sheet.innerHTML = '<div class="stkfeed-hd"><b>' + L + ' · ' + esc(LEVELS[L].short.replace(/^./, (c) => c.toUpperCase())) + '</b><button type="button" class="stkfeed-x" aria-label="Close">×</button></div>' +
      '<p>' + (L === 'L3' ? esc(L3_SOON) : esc(LEVELS[L].what)) + '</p>' +
      (L === 'L3' ? '' : '<h4>Right now</h4><ul class="stkfeed-now">' + lines.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>') +
      '<h4>Used by</h4>' + who +
      (S.state === 'delayed' ? '<p class="stkfeed-why-t">' + esc(WHY.futures.long) + '</p><button type="button" class="stkfeed-unlock">Get live data</button>' : S.state === 'locked' && L !== 'L3' ? '<button type="button" class="stkfeed-unlock">Sign in</button>' : '');
    sheet.setAttribute('aria-label', L + ' data feed details'); sheet.hidden = false; anchor();
  }
  function openSheet(L, keep, hover) { viaHover = !!hover; openL = openL === L && !keep ? '' : L; row.dataset.sig = ''; if (!openL) { sheet.hidden = true; arrow.hidden = true; } paint(); }
  function close() { openL = ''; sheet.hidden = true; arrow.hidden = true; row.dataset.sig = ''; paint(); }
  // Hover (mouse only): opens after 150 ms, stays while the pointer is on the pill or the card, closes 200 ms after it leaves. Touch keeps tap; keyboard focus opens.
  let tin = 0, tout = 0, viaHover = false;
  const mouse = (e) => e.pointerType === 'mouse';
  row.addEventListener('pointerover', (e) => { const b = mouse(e) && e.target.closest('.stkfeed'); if (!b) return; clearTimeout(tout); clearTimeout(tin); if (openL !== b.dataset.l) tin = setTimeout(() => openSheet(b.dataset.l, true, true), 150); });
  const leave = (e) => { if (!mouse(e)) return; clearTimeout(tin); clearTimeout(tout); tout = setTimeout(() => { if (openL) close(); }, 200); };
  row.addEventListener('pointerleave', leave); sheet.addEventListener('pointerleave', leave);
  sheet.addEventListener('pointerenter', (e) => { if (mouse(e)) clearTimeout(tout); });
  row.addEventListener('focusin', (e) => { const b = e.target.closest('.stkfeed'); if (b && b.matches(':focus-visible') && openL !== b.dataset.l) openSheet(b.dataset.l, true); });
  // Hidden diagnostic: long-press (0.7 s) or 5 quick taps on the L2 chip -> a small panel to screenshot. Same data as window.tzL2Diag(). No tokens, 4-char prefixes only.
  let taps = [], lp = 0, dg = null, suppress = 0;
  const showDiag = () => {
    suppress = Date.now() + 600;
    if (!dg) { dg = document.createElement('pre'); dg.className = 'stkfeed-diag'; dg.style.cssText = 'position:absolute;left:8px;right:8px;top:60px;z-index:60;margin:0;padding:10px 12px;max-height:70%;overflow:auto;background:rgba(11,11,13,.96);color:#e6e8ee;border:1px solid #3a3f4b;border-radius:12px;font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all'; dg.addEventListener('click', () => { dg.hidden = true; }); host.appendChild(dg); }
    let t = ''; try { t = JSON.stringify(window.tzL2Diag ? window.tzL2Diag(cur && cur.sym) : { err: 'diag not loaded yet' }, null, 1); } catch (e) { t = 'diag error'; }
    dg.textContent = 'L2 diagnostic (tap to close)\n' + t; dg.hidden = false;
  };
  const isL2 = (e) => { const b = e.target.closest && e.target.closest('.stkfeed'); return b && b.dataset.l === 'L2'; };
  row.addEventListener('pointerdown', (e) => { if (isL2(e)) { clearTimeout(lp); lp = setTimeout(showDiag, 700); } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => row.addEventListener(n, () => clearTimeout(lp)));
  row.addEventListener('click', (e) => { if (!isL2(e)) return; const n = Date.now(); taps = taps.filter((x) => n - x < 2500); taps.push(n); if (taps.length >= 5) { taps = []; showDiag(); } }, true);
  row.addEventListener('click', (e) => { if (Date.now() < suppress) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  row.addEventListener('click', (e) => { const b = e.target.closest('.stkfeed'); if (b) { e.stopPropagation(); openSheet(b.dataset.l, viaHover && openL === b.dataset.l); } });
  sheet.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.stkfeed-x')) close();
    else if (e.target.closest('.stkfeed-unlock')) unlock(last && last[openL] ? last[openL].locked : '', openL);
  });
  note.addEventListener('click', (e) => { if (e.target.closest('.stkfeed-why-b')) { whyOpen = !whyOpen; paint(); return; } if (e.target.closest('.stkfeed-unlock')) unlock(last && last[note.dataset.l] ? last[note.dataset.l].locked : '', note.dataset.l); });
  document.addEventListener('click', (e) => { if (openL && !sheet.contains(e.target) && !row.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openL) close(); });
  refresh = paint;
  try { ws.on('state:changed', paint); } catch (e) {}
  window.addEventListener('stryker:l2tier', () => paint());   // the first book frame clears the lock at once, no reload
  const tm = setInterval(paint, 1000), tp = setInterval(place, 250);   // the legend reflows when rows are added / folded: follow it fast
  window.addEventListener('pagehide', () => { clearInterval(tm); clearInterval(tp); });
  paint();
  const api = { paint, open: openSheet, close, state: () => last, get isOpen() { return !!openL; } };
  window.__stkFeeds = api;
  return api;
}

if (typeof window !== 'undefined') window.STRYKER_FEEDS = { register: registerFeed, setPanel, of: feedOf };
