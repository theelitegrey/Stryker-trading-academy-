// TradeZoro — ZoroCharts ORDER PANEL (ES module, charts.html). Owner order 2026-11-16: "create better order panel".
// Lazy-loaded by assets/chart-paper.js (Trade button in the chart's top bar, openOrder(), the live module's openTicket).
//
// ONE floating panel for PAPER (every member) and LIVE broker orders (admins, assets/chart-live.js). It replaces the old bottom
// "Live trading" strip; while a live account is picked only a small status chip stays on the chart (click = open the panel).
//   Header (Owner order 2026-11-17): row 1 = tabs Scalp | DOM | Order (segmented) left, window buttons right (Dock right, Float,
//           expand, minimise, close). Row 2 = symbol details bar: root + full name ("MNQ · Micro Nasdaq-100 E-mini", never cut),
//           the contract (MNQZ6), last price + change vs the previous daily close, best bid / ask.
//           FLOAT: drag by the header, resize from the bottom-right corner. DOCK RIGHT: a full-height side panel at the chart's right
//           edge (left of the icon rail and any open rail panel); the chart gives up that width (#vela-chart margin-right), width
//           dragged on the left edge (280-480). Mode, position, size, dock width, tab, open/minimised and the B/S hotkey switch are
//           remembered per user (localStorage 'stryker_op_<uid>').
//   Scalp:  Buy (market) · quantity stepper · Sell (market); Join Bid = buy LIMIT at the best bid, Join Ask = sell LIMIT at the best
//           ask. Bid/ask: futures from the live L2 book (chart-futures-l2.js; never the 10-min delayed book), crypto from the exchange's
//           public book (book-panel-sources.js). No live book = the Join buttons stay disabled with the reason.
//   Order:  Buy / Sell cards (live BID / ASK), Market | Limit | Stop, price (market = the live price; limit / stop editable, rounded to
//           the tick), quantity, Stop loss (price <-> ticks, Trail, presets 10/25/50/100 ticks), Take profit (price <-> ticks, presets),
//           Confirm in the side's colour + Cancel. Paper: SL/TP ride on the order as a bracket (paper-engine.js). LIVE: the chart's
//           live order route takes market + limit only (functions/connect/finatic/order.js: no stop, no bracket), so Stop, SL, TP and
//           Trail are shown disabled with that reason. Nothing is ever sent as a bracket the server would not check.
//   DOM:    the existing Book panel ladder (assets/chart-book-panel.js api.embed): bid cell = buy limit, ask cell = sell limit (live: always
//           a limit, through the live confirm), the same code path as the side panel.
//   Footer: the account picked in the Trade menu as a read-only label ("Paper · DEMO"; admins live: "LIVE · Tradovate …2029" in red)
//           + "Change" (opens the Trade menu; no account picker in the panel), position + open P&L, working orders, Flatten, and
//           (live) "Turn off live trading" (the kill switch). Members never see a broker name.
//   Phone (<= 700 px): a bottom sheet with Scalp + Order only.
// SAFETY: every live order goes through chart-live.js place(): admin-only module, typed contract on the first live order then a tap,
// 2-contract cap + worst-case exposure, 10 orders a minute (client + server), fresh-read gate, kill switch, back to Paper after 15 min
// idle, every attempt audited on the server. This file never calls the order endpoint itself.
// Hotkeys: B = Buy, S = Sell (market, Scalp quantity) — OFF by default, only while the panel is open and not typing in a field.
// TRADE INSTRUMENT (2026-11-18, roadmap card trade-instrument): the header's mini / micro switch (NQ | MNQ, ES | MES, YM | MYM,
//           RTY | M2K, GC | MGC, CL | MCL, SI | SIL) picks what the panel trades; it starts on the chart symbol and is kept per chart
//           root (chart-paper.js tradeSym). Orders, the footer position / P&L and the DOM tab all use it; the chart never changes.
// TWO TARGETS (Order tab): Stop loss, TP1 (close N contracts or N %), Take profit = TP2 (the rest), "Stop to break-even after TP1"
//           (+ offset ticks), "Size from risk" ($ or % of the balance + the stop distance -> contracts, rounded down, min 1, capped at
//           the max size). Paper: everything (paper-engine.js). LIVE: one stop loss + one take profit per contract is what the server's
//           guarded route keeps (functions/connect/finatic/order.js), so TP1 and break-even are hidden there with a plain note;
//           risk sizing still works (capped at the live max).
// Tests: tools/tests/chart-live-browser.js (live + member paper, mocked endpoints only), tools/tests/chart-paper-trading-browser.js.
// Education only. Not financial advice.
import * as L from './chart-live-core.js?v=1133';
import { acquire, rootState, l2Root, l2Delayed } from './chart-futures-l2.js?v=1133';
import { openSource, SOURCES } from './book-panel-sources.js?v=1133';
import { pairOf } from './book-panel-core.js?v=1133';
import { futRoot } from './chart-sym.js?v=1133';   // one futures test for every symbol form (CME_MINI:MNQ1!, MNQZ6 ...)

const PHONE_MAX = 700, W_MIN = 352, W_MAX = 640, DW_MIN = 280, DW_MAX = 480, DW_DEF = 340, H_MIN = 300, W_DEF = 360, H_DEF = 640, PRESETS = [10, 25, 50, 100], QUOTE_MAX_AGE = 15000;
const DISCLAIMER = 'Education only. Not financial advice.';
const EXCH = { YM: 'CBOT', MYM: 'CBOT', ZB: 'CBOT', ZN: 'CBOT', ZF: 'CBOT', ZT: 'CBOT', ZC: 'CBOT', ZS: 'CBOT', ZW: 'CBOT', CL: 'NYMEX', MCL: 'NYMEX', NG: 'NYMEX', GC: 'COMEX', MGC: 'COMEX', SI: 'COMEX', HG: 'COMEX' };
const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const TEST = () => (isLocal ? window.__stkOpTest || null : null);   // localhost test hooks only
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isPhone = () => window.innerWidth <= PHONE_MAX;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return Number.isFinite(n) ? n : NaN; };
const svg = (d) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const ICON = {
  max: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  restore: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  min: svg('<path d="M5 12h14"/>'),
  open: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  dock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
  float: svg('<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 2.4"/><rect x="9" y="9" width="9" height="7" rx="1.5"/>')
};
export const TRADE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const money = (n, sign) => { if (n == null || !Number.isFinite(n)) return '—'; const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + '$' + s; };
const decOf = (tick) => { const s = String(tick); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(8, s.length - i - 1); };
const roundTick = (p, t) => Math.round(p / t) * t;

let P = null, el = null, bodyEl = null, footEl = null, infoEl = null, chipEl = null, meta = { sym: '', desc: '', prev: null }, dockRO = null, prefs = null, prefKey = '', viewSig = '', footSig = '', open = false, lastQty = '';
const F = { side: 'buy', type: 'market', qty: '1', price: '', priceKey: '', trail: false,
  sl: { on: false, price: '', ticks: '20', src: 'ticks' }, tp: { on: false, price: '', ticks: '40', src: 'ticks' },
  tp1: { on: false, price: '', ticks: '20', src: 'ticks', size: '1', unit: 'qty' }, be: { on: false, ticks: '0' },
  risk: { on: false, mode: 'usd', v: '' } };
const LIVE_TWO = 'TP1 and break-even are paper only for now. Live orders carry one stop loss and one take profit.';

// ------------------------------------------------------------------------------------------------ prefs (per user)
function loadPrefs() {
  const uid = (P && P.uid) || 'guest'; prefKey = 'stryker_op_' + uid;
  let p = {}; try { p = JSON.parse(localStorage.getItem(prefKey)) || {}; } catch (e) {}
  prefs = { x: Number.isFinite(p.x) ? p.x : null, y: Number.isFinite(p.y) ? p.y : null, w: clamp(+p.w || W_DEF, W_MIN, W_MAX), h: Math.max(H_MIN, +p.h || H_DEF),
    tab: ['scalp', 'dom', 'order'].includes(p.tab) ? p.tab : 'scalp', min: !!p.min, max: !!p.max, hk: p.hk === true, open: !!p.open,
    mode: p.mode === 'dock' ? 'dock' : 'float', dw: clamp(+p.dw || DW_DEF, DW_MIN, DW_MAX) };
}
function savePrefs() { try { localStorage.setItem(prefKey, JSON.stringify(prefs)); } catch (e) {} }

// ------------------------------------------------------------------------------------------------ what is on the chart
function ctx() {
  const chartSym = P.activeSymbol() || '';
  const lv = P.live || null;
  const PE0 = window.PaperEngine;
  // the TRADE instrument (chart symbol or its mini / micro partner). Live (admins): only pairs the live route trades (NQ / MNQ, ES / MES).
  let fam = PE0 && PE0.familyOf ? PE0.familyOf(chartSym) : null;
  if (lv && fam && !(L.ROOTS[fam.mini] && L.ROOTS[fam.micro])) fam = null;
  const sym = (fam && P.tradeSym ? P.tradeSym(chartSym) : chartSym) || '';
  const a = P.account;
  const PE = window.PaperEngine;
  const sp = a ? a.spec(sym) : PE ? PE.specOf(sym) : { ok: false, reason: 'Loading…' };
  const m = /^([^:]+):(.+)$/.exec(sym); const prov = m ? m[1].toLowerCase() : '', tk = (m ? m[2] : sym).toUpperCase();
  const croot = L.chartRoot(sym);
  const li = lv ? lv.opInfo(sym) : null;
  const fm = croot ? L.frontMonth(croot, Date.now()) : null;
  const fut = sp.ok ? sp.kind === 'futures' : /1!$/.test(tk);
  const rootName = fut ? String(sp.ok ? sp.root : tk).replace(/[12]!$/, '') : '';
  const label = fut ? (EXCH[rootName] || 'CME') + ':' + rootName : sym ? tk : '—';
  const exName = !fut && prov ? ((SOURCES.find((s) => s.id === prov) || {}).name || prov.toUpperCase()) : '';
  const code = li && li.code ? li.code : fm ? fm.code : exName;
  const tick = lv ? (li ? li.tick : lv.tickOf(sym)) : sp.ok ? sp.tick : 0.01;
  const last = lv ? (li && Number.isFinite(li.last) ? li.last : P.lastPrice(sym)) : (a && Number.isFinite(a.last[sp.symbol]) ? a.last[sp.symbol] : P.lastPrice(sym));
  const chartRootName = fam ? String((PE.specOf(chartSym) || {}).root || '') : '';
  return { sym, chartSym, fam, chartRootName, lv, li, a, sp, prov, tk, fut, rootName, label, code, tick: tick || 0.01, dec: decOf(tick || 0.01), last: Number.isFinite(last) && last > 0 ? last : null, live: !!lv };
}
const fmt = (c, p) => (p == null || !Number.isFinite(p) ? '—' : p.toLocaleString('en-US', { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec }));
const fmtIn = (c, p) => (Number.isFinite(p) ? p.toFixed(c.dec) : '');

// ------------------------------------------------------------------------------------------------ best bid / ask
let qs = null;   // { key, kind:'f'|'c', root, h|stop, book }
function quoteKey(c) {
  if (!open || isTestQuote()) return '';
  if (c.fut) { const r = l2Root(futRoot(c.sym) || c.tk); return r ? 'f|' + r : ''; }
  if (c.sp.ok && c.sp.kind === 'crypto') return 'c|' + c.prov + '|' + c.tk;
  return '';
}
const isTestQuote = () => { const t = TEST(); return !!(t && t.quote); };
function stopQuote() { if (!qs) return; try { qs.h ? qs.h.release() : qs.stop && qs.stop(); } catch (e) {} qs = null; }
function wantQuote(c) {
  const key = quoteKey(c);
  if ((qs ? qs.key : '') === key) return;
  stopQuote(); if (!key) return;
  if (key[0] === 'f') { const root = key.slice(2); qs = { key, kind: 'f', root, h: acquire(root, () => {}, 10) }; return; }
  const id = SOURCES.some((s) => s.id === c.prov) ? c.prov : 'binance', q = qs = { key, kind: 'c', book: null, at: 0 };
  q.stop = openSource(id, pairOf(c.tk), { book: (b) => { q.book = b; q.at = Date.now(); }, trades: () => {}, status: () => {} });
}
function bestOf(bids, asks) {
  let bb = 0, ba = Infinity;
  if (bids instanceof Map) { bids.forEach((v, p) => { if (v > 0 && p > bb) bb = p; }); asks.forEach((v, p) => { if (v > 0 && p < ba) ba = p; }); }
  else { for (const x of bids || []) if (x[1] > 0 && x[0] > bb) bb = x[0]; for (const x of asks || []) if (x[1] > 0 && x[0] < ba) ba = x[0]; }
  return bb > 0 && ba < Infinity && ba > bb ? { bid: bb, ask: ba } : null;
}
function quote(c) {
  const t = TEST(); if (t && t.quote) { const r = t.quote(c.sym); return r && r.bid > 0 && r.ask > 0 ? { bid: r.bid, ask: r.ask, note: '' } : null; }
  if (!qs) return null;
  if (qs.kind === 'f') {
    const r = rootState(qs.root), s = r.snap;
    if (r.status !== 'live' || !s || s.delayed || l2Delayed() || !r.lastFrame || Date.now() - r.lastFrame > QUOTE_MAX_AGE) return null;
    const b = bestOf(s.bids, s.asks); if (!b) return null;
    return { bid: b.bid, ask: b.ask, note: qs.root !== c.rootName ? 'Bid / ask from the ' + qs.root + ' book' : '' };
  }
  if (!qs.book || Date.now() - qs.at > QUOTE_MAX_AGE) return null;
  const b = bestOf(qs.book.bids, qs.book.asks); return b ? { bid: b.bid, ask: b.ask, note: '' } : null;
}
const noQuoteWhy = (c) => (c.fut && l2Delayed() ? 'Join Bid / Join Ask need the live order book (yours is 10 min delayed).' : 'Waiting for the live bid and ask…');

// ------------------------------------------------------------------------------------------------ quantities, brackets
function qtyRules(c) {
  if (c.live) return { min: 1, max: L.MAX_QTY, step: 1, int: true };
  if (!c.sp.ok) return { min: 1, max: 1, step: 1, int: true };
  if (c.sp.kind === 'futures') return { min: 1, max: c.sp.maxQty || 500, step: 1, int: true };
  return { min: c.sp.minQty || 0.0001, max: c.sp.maxQty || 1e6, step: 0, int: false };
}
function cleanQty(c, v) {
  const r = qtyRules(c); let q = num(v); if (!(q > 0)) q = r.min;
  if (r.int) q = Math.round(q);
  return clamp(q, r.min, r.max);
}
function stepQty(c, dir) {
  const r = qtyRules(c), q = cleanQty(c, F.qty);
  if (r.step) return clamp(q + dir * r.step, r.min, r.max);
  const st = Math.pow(10, Math.floor(Math.log10(Math.max(q, r.min))));
  return clamp(Math.round((q + dir * st) * 1e8) / 1e8, r.min, r.max);
}
// entry reference: market = the touch you would trade into (ask for a buy, bid for a sell) or the last price; limit / stop = the price field
function entryRef(c, qt) {
  if (F.type === 'market') return qt ? (F.side === 'buy' ? qt.ask : qt.bid) : c.last;
  const p = num(F.price); return p > 0 ? roundTick(p, c.tick) : null;
}
// keep each leg's price and ticks in step with the entry (the side the member typed in last is the source)
function legSync(c, ref, k) {
  const g = F[k], dir = (F.side === 'buy' ? 1 : -1) * (k === 'tp' || k === 'tp1' ? 1 : -1);
  if (!(ref > 0)) return null;
  if (g.src === 'price') { const p = num(g.price); if (!(p > 0)) return null; const t = Math.round(Math.abs(p - ref) / c.tick); g.ticks = String(t); return roundTick(p, c.tick); }
  const t = Math.abs(Math.round(num(g.ticks))); if (!(t > 0)) return null;
  const p = roundTick(ref + dir * t * c.tick, c.tick); g.price = fmtIn(c, p); return p;
}
function caps(c) {
  if (!c.live) return { stop: true, bracket: true, trail: F.type === 'market', two: true, why: '' };
  const k = c.lv.caps();
  // live stop loss / take profit: market entries only (the server places them after the fill); never TP1 / break-even (one group)
  const mo = !!k.bracket && F.type !== 'market';
  return { stop: !!k.stop, bracket: !!k.bracket && !mo, trail: false, two: false, why: mo ? k.marketOnly : k.why };
}
// risk-based size -> { qty, risk, over, capped, amt } | { error } | null (off / not applicable)
function riskSize(c, k, ref, sl) {
  if (!F.risk.on || !k.bracket) return null;
  if (!F.sl.on || !(sl > 0)) return { error: 'Turn on the stop loss: the size comes from its distance.' };
  const v = num(F.risk.v); if (!(v > 0)) return { error: F.risk.mode === 'pct' ? 'Enter the % of the balance to risk.' : 'Enter the $ amount to risk.' };
  let bal = null;
  if (F.risk.mode === 'pct') {
    if (c.live) { const L2 = window.__stkLive, a = L2 && L2.state && L2.state.acct, b = a && L2.balance ? L2.balance(a.id) : null; bal = b && b.state === 'ok' ? b.amount : null; }
    else bal = c.a ? c.a.state.balance : null;
    if (!(bal > 0)) return { error: 'The balance isn’t known yet. Use a $ amount.' };
    if (v > 100) return { error: 'Risk % is 100 or less.' };
  }
  const amt = F.risk.mode === 'pct' ? bal * v / 100 : v;
  const r = qtyRules(c);
  const spec = c.live ? { ok: true, kind: 'futures', pointValue: c.li ? c.li.pv : 0, qtyStep: 1, minQty: 1, maxQty: r.max } : c.sp;
  if (!(spec.pointValue > 0)) return { error: 'No contract value for this symbol.' };
  const s0 = window.PaperEngine.sizeForRisk(spec, amt, ref, sl, r.max);
  return s0.error ? s0 : Object.assign(s0, { amt });
}

// ------------------------------------------------------------------------------------------------ actions
const LIVE_CHART_ONLY = 'This chart can’t trade live. Open NQ1!, ES1!, MNQ1! or MES1!.';
function blockOf(c) {
  if (c.live) return !c.li ? LIVE_CHART_ONLY : c.li.block || '';
  if (!P.enabled) return 'Paper trading is off.';
  if (!c.a) return 'Paper trading is still loading.';
  if (!c.sp.ok) return c.sp.reason;
  if (!c.last) return 'Waiting for a price for ' + c.label + '…';
  return '';
}
function send(c, o, src) {
  const qty = cleanQty(c, F.qty);
  if (c.live) {
    return c.lv.placeTicket(c.sym, { side: o.side, type: o.type, qty, price: o.price, marketable: o.marketable, sl: o.sl, tp: o.tp }, src);
  }
  const r = P.placeOrder(Object.assign({ symbol: c.sym, qty }, o));
  if (r && o.trail && o.type === 'market' && o.sl != null) P.setTrailing(c.sym);
  update(); return r;
}
function scalp(side) {
  const c = ctx(), why = blockOf(c); if (why) { P.toast(why, 'error'); return; }
  send(c, { side, type: 'market' }, 'Scalp');
}
function join(side) {
  const c = ctx(), why = blockOf(c); if (why) { P.toast(why, 'error'); return; }
  const qt = quote(c); if (!qt) { P.toast(noQuoteWhy(c), 'info'); return; }
  send(c, { side, type: 'limit', price: side === 'buy' ? qt.bid : qt.ask }, side === 'buy' ? 'Join Bid' : 'Join Ask');
}
function confirmOrder() {
  const c = ctx(), why = blockOf(c); if (why) { P.toast(why, 'error'); return; }
  const k = caps(c), qt = quote(c);
  if (F.type === 'stop' && !k.stop) { P.toast(k.why, 'error'); return; }
  let price;
  if (F.type !== 'market') { price = roundTick(num(F.price), c.tick); if (!(price > 0)) { P.toast('Enter the ' + F.type + ' price.', 'error'); return; } F.price = fmtIn(c, price); }
  const ref = entryRef(c, qt);
  const o = { side: F.side, type: F.type, price };
  if (k.bracket) {
    const legs = ['sl', 'tp'].concat(k.two && F.tp1.on ? ['tp1'] : []), nm = { sl: 'stop loss', tp: 'take profit', tp1: 'TP1' };
    for (const leg of legs) if (F[leg].on) { const p = legSync(c, ref, leg); if (!(p > 0)) { P.toast('Enter the ' + nm[leg] + ' price or ticks, or untick it.', 'error'); return; } o[leg] = p; }
    if (o.tp1 != null) {
      const n = num(F.tp1.size); if (!(n > 0)) { P.toast('Enter how much TP1 closes.', 'error'); return; }
      if (F.tp1.unit === 'pct') o.tp1Pct = n; else o.tp1Qty = n;
      if (F.be.on) { const b = Math.round(num(F.be.ticks)); o.be = b >= 0 ? b : 0; }
    }
    if (F.trail && F.sl.on && k.trail) o.trail = true;
    const rs = riskSize(c, k, ref, o.sl);
    if (rs && rs.error) { P.toast(rs.error, 'error'); return; }
    if (rs) F.qty = String(rs.qty);
  }
  if (c.live && F.type === 'limit' && qt) o.marketable = F.side === 'buy' ? price >= qt.ask : price <= qt.bid;
  send(c, o, 'Order');
}
function flatten() {
  const c = ctx();
  if (c.live) { if (!c.li) { P.toast(LIVE_CHART_ONLY, 'error'); return; } c.lv.flatten(c.sym); return; }
  if (!c.a || !c.sp.ok) return;
  const pos = c.a.position(c.sym), n = c.a.state.orders.filter((o) => o.symbol === c.sp.symbol).length;
  if (!pos && !n) { P.toast('Nothing to flatten on ' + c.label + '.', 'info'); return; }
  P.flattenSym(c.sym); update();
}

// ------------------------------------------------------------------------------------------------ build
function build() {
  el = document.createElement('div');
  el.id = 'stkop'; el.className = 'stkop'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'stkop-sym');
  el.innerHTML =
    '<div class="stkop-grab" aria-hidden="true"></div>' +
    '<div class="stkop-hd">' +
      '<div class="stkop-tabs" role="tablist" aria-label="Order panel view"><button type="button" role="tab" data-tab="scalp">Scalp</button><button type="button" role="tab" data-tab="dom">DOM</button><button type="button" role="tab" data-tab="order">Order</button></div>' +
      '<div class="stkop-hbtns">' +
        '<button type="button" class="stkop-ib stkop-mode" data-a="dock" aria-label="Dock the panel to the right of the chart" title="Dock right">' + ICON.dock + '</button>' +
        '<button type="button" class="stkop-ib stkop-mode" data-a="float" aria-label="Float the panel over the chart" title="Float">' + ICON.float + '</button>' +
        '<button type="button" class="stkop-ib" data-a="max"></button><button type="button" class="stkop-ib" data-a="min"></button><button type="button" class="stkop-ib" data-a="close" aria-label="Close the order panel" title="Close">' + ICON.close + '</button></div>' +
    '</div>' +
    '<div class="stkop-info">' +
      '<div class="stkop-il"><p class="stkop-sym" id="stkop-sym"><b data-k="root"></b><span class="stkop-nm" data-k="name"></span></p><span class="stkop-code" data-k="code"></span>' +
        '<span class="stkop-inst" role="radiogroup" aria-label="Trade instrument (mini or micro)" data-k="inst" hidden></span></div>' +
      '<div class="stkop-il"><span class="stkop-last" data-k="last">—</span><span class="stkop-chg" data-k="chg"></span><span class="stkop-sp"></span>' +
        '<span class="stkop-ba"><span>Bid <b class="bid" data-k="bid">—</b></span><span>Ask <b class="ask" data-k="ask">—</b></span></span></div>' +
    '</div>' +
    '<div class="stkop-alert" data-k="alert" role="status" hidden><p class="stkop-alt" data-k="alt"></p><button type="button" class="stkop-b" data-a="retry" hidden>Retry</button></div>' +
    '<div class="stkop-body"></div><div class="stkop-ft"></div>' +
    '<i class="stkop-rs" aria-hidden="true" title="Resize"></i><i class="stkop-dl" aria-hidden="true" title="Drag to resize"></i>';
  document.body.appendChild(el);
  bodyEl = el.querySelector('.stkop-body'); footEl = el.querySelector('.stkop-ft'); infoEl = el.querySelector('.stkop-info');
  for (const ev of ['keydown', 'keyup', 'wheel']) el.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') { if (isPhone()) close(); else e.target.blur && e.target.blur(); } }, { passive: ev === 'wheel' });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('focusout', onBlur);
  el.addEventListener('submit', (e) => { e.preventDefault(); confirmOrder(); });
  bindDrag(); bindResize(); bindDockResize();
  window.addEventListener('resize', () => { if (open) { layout(); update(); } }, { passive: true });
  window.addEventListener('keydown', onHotkey, true);
  window.addEventListener('stkbp:unembedded', () => { if (open && prefs.tab === 'dom') { viewSig = ''; update(); } });
}
function onClick(e) {
  const t = e.target.closest('button, [data-pre]'); if (!t || t.disabled) return;
  const c = () => ctx();
  if (t.dataset.tab) { setTab(t.dataset.tab); return; }
  if (t.dataset.inst) { const x = c(); if (P.setTradeSym && x.fam) { P.setTradeSym(x.chartSym, 'futures:' + t.dataset.inst + '1!'); F.priceKey = ''; viewSig = ''; update(); } return; }
  if (t.dataset.unit) { F.tp1.unit = t.dataset.unit; update(); return; }
  if (t.dataset.rmode) { F.risk.mode = t.dataset.rmode; update(); return; }
  const a = t.dataset.a;
  if (a === 'close') { close(); return; }
  if (a === 'min') { prefs.min = !prefs.min; savePrefs(); viewSig = ''; layout(); update(); return; }
  if (a === 'max') { prefs.max = !prefs.max; prefs.min = false; savePrefs(); viewSig = ''; layout(); update(); return; }
  if (a === 'dock' || a === 'float') { setMode(a); return; }
  if (a === 'change') { if (P.openTradeMenu) P.openTradeMenu(); return; }
  if (a === 'buy' || a === 'sell') { scalp(a); return; }
  if (a === 'jbid') { join('buy'); return; }
  if (a === 'jask') { join('sell'); return; }
  if (a === 'cancel') { close(); return; }
  if (a === 'flat') { flatten(); return; }
  if (a === 'kill') { const x = c(); if (x.lv) x.lv.kill(); return; }
  if (a === 'retry') { const x = c(); if (x.lv && x.lv.retryEnv) x.lv.retryEnv(); return; }
  if (a === 'killon') { const x = c(); if (x.lv) x.lv.killOn(); return; }
  if (a === 'paperon') { P.setEnabled(true); viewSig = ''; update(); return; }
  if (a === 'dom-here') { viewSig = ''; update(); return; }
  if (t.dataset.q) { F.qty = String(stepQty(c(), +t.dataset.q)); update(); return; }
  if (t.dataset.side) { F.side = t.dataset.side; F.priceKey = ''; update(); return; }
  if (t.dataset.type) { F.type = t.dataset.type; F.priceKey = ''; if (F.type !== 'market') F.trail = false; update(); return; }
  if (t.dataset.pre) { const g = F[t.dataset.leg]; g.on = true; g.ticks = t.dataset.pre; g.src = 'ticks'; update(); }
}
function onInput(e) {
  const f = e.target.dataset && e.target.dataset.f; if (!f) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (f === 'qty') F.qty = v;
  else if (f === 'price') F.price = v;
  else if (f === 'trail') F.trail = v;
  else if (f === 'hk') { prefs.hk = v; savePrefs(); }
  else if (f === 'tp1.size') F.tp1.size = v;
  else if (f === 'be.on') F.be.on = v;
  else if (f === 'be.ticks') F.be.ticks = v;
  else if (f === 'risk.on') F.risk.on = v;
  else if (f === 'risk.v') F.risk.v = v;
  else { const [leg, k] = f.split('.'); if (!(leg === 'sl' || leg === 'tp' || leg === 'tp1') || !k) return;   // the embedded DOM ladder's own fields
    if (k === 'on') F[leg].on = v; else { F[leg][k] = v; F[leg].src = k; } }
  update();
}
function onBlur(e) {
  const f = e.target.dataset && e.target.dataset.f; if (!f) return;
  const c = ctx();
  if (f === 'qty') { F.qty = String(cleanQty(c, F.qty)); e.target.value = F.qty; }
  if (f === 'price') { const p = num(F.price); if (p > 0) { F.price = fmtIn(c, roundTick(p, c.tick)); e.target.value = F.price; } }
  if (/\.price$/.test(f)) { const g = F[f.split('.')[0]], p = num(g.price); if (p > 0) { g.price = fmtIn(c, roundTick(p, c.tick)); e.target.value = g.price; } }
  update();
}
function onHotkey(e) {
  if (!open || !prefs.hk || prefs.min || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const k = String(e.key || '').toLowerCase(); if (k !== 'b' && k !== 's') return;
  const t = e.target; if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName) || (t.closest && t.closest('[role=dialog]:not(#stkop), .vela-dialog, #stklv-cf')))) return;
  if (document.getElementById('stklv-cf')) return;
  e.preventDefault(); e.stopPropagation();
  scalp(k === 'b' ? 'buy' : 'sell');
}

// ------------------------------------------------------------------------------------------------ drag / resize / layout
function chartRect() { const n = document.querySelector('.stkchart-panel'); const r = n ? n.getBoundingClientRect() : null; return r && r.width > 0 ? r : { left: 0, top: 56, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight - 56 }; }
function bindDrag() { bindDragOn(el.querySelector('.stkop-hd')); bindDragOn(el.querySelector('.stkop-info')); }
function bindDragOn(hd) {
  hd.addEventListener('pointerdown', (e) => {
    if (isPhone() || prefs.max || docked() || e.button !== 0 || e.target.closest('button, select, input, a')) return;
    e.preventDefault(); const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    hd.setPointerCapture(e.pointerId); el.classList.add('dragging');
    const mv = (ev) => { prefs.x = Math.round(ev.clientX - dx); prefs.y = Math.round(ev.clientY - dy); layout(); };
    const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); el.classList.remove('dragging'); savePrefs(); };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  });
}
function bindResize() {
  const g = el.querySelector('.stkop-rs');
  g.addEventListener('pointerdown', (e) => {
    if (isPhone() || prefs.max || docked()) return;
    e.preventDefault(); e.stopPropagation(); const r = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    g.setPointerCapture(e.pointerId); el.classList.add('sizing');
    const mv = (ev) => { prefs.w = clamp(Math.round(r.width + ev.clientX - x0), W_MIN, W_MAX); if (prefs.tab !== 'scalp') prefs.h = Math.max(H_MIN, Math.round(r.height + ev.clientY - y0)); layout(); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); el.classList.remove('sizing'); savePrefs(); update(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });
}
// docked: a full-height side panel; the chart (#vela-chart, absolute left/right) gives up the width through margin-right, so it
// works next to whatever rail panel (Watchlist, News, ...) is open. Desktop / tablet only (phones: the bottom sheet).
const docked = () => !!(prefs && prefs.mode === 'dock' && !isPhone());
function hostEl() { return document.querySelector('.stkchart-panel'); }
function applyDock() {
  const h = hostEl(), on = open && docked() && !!h;
  if (h) {
    const was = h.classList.contains('stkop-docked'), w = h.style.getPropertyValue('--stkop-dw');
    h.classList.toggle('stkop-docked', on); h.style.setProperty('--stkop-dw', prefs.dw + 'px');
    if (was !== on || (on && w !== prefs.dw + 'px')) requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  const vc = document.getElementById('vela-chart');
  if (on && vc && typeof ResizeObserver === 'function' && !dockRO) { dockRO = new ResizeObserver(() => { if (open && docked()) place(); }); dockRO.observe(vc); dockRO.observe(h); }
  if (!on && dockRO) { dockRO.disconnect(); dockRO = null; }
  return on;
}
function setMode(m) {
  if (prefs.mode === m) return;
  prefs.mode = m; prefs.min = false; prefs.max = false; savePrefs(); viewSig = ''; layout(); update(); layout();
}
function bindDockResize() {
  const g = el.querySelector('.stkop-dl');
  g.addEventListener('pointerdown', (e) => {
    if (!docked() || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); const w0 = prefs.dw, x0 = e.clientX;
    g.setPointerCapture(e.pointerId); el.classList.add('sizing');
    const mv = (ev) => { const w = clamp(Math.round(w0 - (ev.clientX - x0)), DW_MIN, DW_MAX); if (w !== prefs.dw) { prefs.dw = w; layout(); } };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); el.classList.remove('sizing'); savePrefs(); update(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  });
}
// docked position: right next to the chart's (shrunk) right edge, the chart's full height
function place() {
  const vc = document.getElementById('vela-chart'), r = vc ? vc.getBoundingClientRect() : null;
  if (!r || !(r.height > 0)) return;
  const x = Math.round(r.right), y = Math.round(r.top), w = prefs.dw, h = Math.round(r.height);
  if (el.style.left !== x + 'px') el.style.left = x + 'px';
  if (el.style.top !== y + 'px') el.style.top = y + 'px';
  el.style.width = w + 'px'; el.style.height = h + 'px';
}
function layout() {
  if (!el) return;
  const ph = isPhone(), tab = shownTab(), dk = docked();
  el.classList.toggle('is-sheet', ph); el.classList.toggle('is-min', !ph && !dk && prefs.min); el.classList.toggle('is-max', !ph && !dk && prefs.max);
  el.classList.toggle('is-dock', dk);
  el.dataset.tab = tab;
  document.documentElement.classList.toggle('stkop-sheet', open && ph);
  applyDock();
  if (ph) { for (const k of ['left', 'top', 'width', 'height']) el.style[k] = ''; return; }
  if (dk) { place(); return; }
  const R = chartRect(), vw = innerWidth, vh = innerHeight;
  let w = prefs.w, h = tab === 'scalp' || prefs.min ? null : prefs.h, x = prefs.x, y = prefs.y;
  if (prefs.max) { w = Math.min(W_MAX, Math.max(W_MIN, Math.round(R.width * 0.4))); h = Math.max(H_MIN, Math.round(Math.min(R.bottom, vh) - Math.max(R.top, 0) - 16)); x = Math.round(R.right - w - 8); y = Math.round(Math.max(R.top, 0) + 8); }
  if (x == null || y == null) { x = Math.round(R.right - w - 72); y = Math.round(R.top + 48); }
  w = Math.min(w, vw - 16);
  if (h != null) h = Math.min(h, vh - 16);
  el.style.width = w + 'px'; el.style.height = h == null ? '' : h + 'px';
  const eh = h == null ? el.offsetHeight || 200 : h;
  x = clamp(x, 8, Math.max(8, vw - w - 8)); y = clamp(y, 8, Math.max(8, vh - Math.min(eh, vh - 16) - 8));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  if (!prefs.max && prefs.x != null) { prefs.x = x; prefs.y = y; }
}
const shownTab = () => (isPhone() && prefs.tab === 'dom' ? 'scalp' : prefs.tab);
function setTab(t) {
  if (t === prefs.tab && !prefs.min) return;
  prefs.tab = t; prefs.min = false; savePrefs(); viewSig = ''; layout(); update(); layout();
}

// ------------------------------------------------------------------------------------------------ views
const pillBtn = (cls, a, text) => '<button type="button" class="stkop-pill ' + cls + '" data-a="' + a + '">' + text + '</button>';
const stepper = (unit) => '<div class="stkop-qty" role="group" aria-label="Quantity"><button type="button" data-q="-1" aria-label="One less">−</button><label><input data-f="qty" type="text" inputmode="decimal" autocomplete="off" aria-label="Quantity"><span class="stkop-unit">' + esc(unit) + '</span></label><button type="button" data-q="1" aria-label="One more">+</button></div>';
function viewScalp(c) {
  return '<div class="stkop-scalp">' +
    '<div class="stkop-trio">' + pillBtn('buy', 'buy', 'Buy') + stepper(c.fut || c.live ? 'lots' : 'qty') + pillBtn('sell', 'sell', 'Sell') + '</div>' +
    '<div class="stkop-joins"><button type="button" class="stkop-join bid" data-a="jbid"><span>Join Bid</span><b data-k="bid">—</b></button><button type="button" class="stkop-join ask" data-a="jask"><span>Join Ask</span><b data-k="ask">—</b></button></div>' +
    '<div class="stkop-srow"><p class="stkop-status" role="status" data-k="status"></p><label class="stkop-hk" title="B = Buy, S = Sell at market with this quantity, while this panel is open"><input type="checkbox" data-f="hk"> B / S keys</label></div>' +
  '</div>';
}
function leg(k, title, trail) {
  return '<fieldset class="stkop-br" data-leg="' + k + '"><legend class="stkop-vh">' + title + '</legend>' +
    '<div class="stkop-brh"><label class="stkop-chk"><input type="checkbox" data-f="' + k + '.on"> ' + title + '</label>' + (trail ? '<label class="stkop-chk stkop-trail"><input type="checkbox" data-f="trail"> Trail</label>' : '') + '</div>' +
    '<div class="stkop-pair"><label><input data-f="' + k + '.price" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="' + title + ' price"><span>Price</span></label><label><input data-f="' + k + '.ticks" type="text" inputmode="numeric" autocomplete="off" aria-label="' + title + ' in ticks"><span>Ticks</span></label></div>' +
    '<div class="stkop-pre" role="group" aria-label="' + title + ' presets">' + PRESETS.map((n) => '<button type="button" data-pre="' + n + '" data-leg="' + k + '" aria-label="' + title + ' ' + n + ' ticks">' + n + '</button>').join('') + '</div>' +
  '</fieldset>';
}
// TP1: close part at the first target (contracts or %), then optionally move the stop to break-even (+ offset ticks)
function legTp1() {
  return '<fieldset class="stkop-br" data-leg="tp1"><legend class="stkop-vh">Take profit 1</legend>' +
    '<div class="stkop-brh"><label class="stkop-chk"><input type="checkbox" data-f="tp1.on"> TP1 · close part</label></div>' +
    '<div class="stkop-pair"><label><input data-f="tp1.price" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="TP1 price"><span>Price</span></label><label><input data-f="tp1.ticks" type="text" inputmode="numeric" autocomplete="off" aria-label="TP1 in ticks"><span>Ticks</span></label></div>' +
    '<div class="stkop-t1q"><span class="stkop-lbl">Close</span><label class="stkop-t1n"><input data-f="tp1.size" type="text" inputmode="decimal" autocomplete="off" aria-label="TP1 closes this much"></label>' +
      '<div class="stkop-seg" role="radiogroup" aria-label="TP1 size unit"><button type="button" role="radio" data-unit="qty" data-k="unitq">Lots</button><button type="button" role="radio" data-unit="pct">%</button></div></div>' +
    '<div class="stkop-t1q stkop-be"><label class="stkop-chk"><input type="checkbox" data-f="be.on"> Stop to break-even after TP1</label><label class="stkop-t1n"><input data-f="be.ticks" type="text" inputmode="numeric" autocomplete="off" aria-label="Break-even offset in ticks"><span>+ticks</span></label></div>' +
    '<p class="stkop-t1s" data-k="t1sum"></p>' +
  '</fieldset>';
}
function viewRisk() {
  return '<fieldset class="stkop-br stkop-risk" data-leg="risk"><legend class="stkop-vh">Size from risk</legend>' +
    '<div class="stkop-brh"><label class="stkop-chk"><input type="checkbox" data-f="risk.on"> Size from risk</label>' +
      '<div class="stkop-seg" role="radiogroup" aria-label="Risk unit"><button type="button" role="radio" data-rmode="usd">$</button><button type="button" role="radio" data-rmode="pct">% bal</button></div></div>' +
    '<div class="stkop-t1q"><label class="stkop-t1n stkop-rv"><input data-f="risk.v" type="text" inputmode="decimal" autocomplete="off" aria-label="Amount to risk" placeholder="0"><span data-k="runit">USD</span></label><p class="stkop-t1s" data-k="rsum"></p></div>' +
  '</fieldset>';
}
function viewOrder(c) {
  return '<form class="stkop-order" novalidate><div class="stkop-oscroll">' +
    '<div class="stkop-sides" role="radiogroup" aria-label="Side"><button type="button" role="radio" class="stkop-side buy" data-side="buy"><b>Buy</b><span>BID <em data-k="bid">—</em></span></button><button type="button" role="radio" class="stkop-side sell" data-side="sell"><b>Sell</b><span>ASK <em data-k="ask">—</em></span></button></div>' +
    '<div class="stkop-otype"><span class="stkop-lbl">Order type</span><div class="stkop-seg" role="radiogroup" aria-label="Order type"><button type="button" role="radio" data-type="market">Market</button><button type="button" role="radio" data-type="limit">Limit</button><button type="button" role="radio" data-type="stop">Stop</button></div></div>' +
    '<div class="stkop-sec">' +
      '<div class="stkop-f"><span class="stkop-lbl" data-k="plabel">Market price</span><b class="stkop-mkt" data-k="mkt">—</b><input class="stkop-in" data-f="price" type="text" inputmode="decimal" autocomplete="off" aria-label="Order price"></div>' +
      '<div class="stkop-f"><span class="stkop-lbl">Quantity</span>' + stepper(c.fut || c.live ? 'lots' : 'qty') + '</div>' +
    '</div>' +
    '<div class="stkop-sec dash">' + leg('sl', 'Stop loss', true) + legTp1() + leg('tp', 'Take profit', false) + '<p class="stkop-why" data-k="why" hidden></p>' + viewRisk() + '</div>' +
    '<p class="stkop-sum" data-k="sum"></p>' +
  '</div>' +
  '<div class="stkop-go"><p class="stkop-status" role="status" data-k="status"></p><button type="submit" class="stkop-pill stkop-confirm buy" data-k="confirm">Confirm</button><button type="button" class="stkop-pill ghost" data-a="cancel">Cancel</button></div>' +
  '</form>';
}
function viewDom() { return '<div class="stkop-dom"><p class="stkop-empty" data-k="domnote" hidden></p></div>'; }
function viewOff(c) {
  return '<div class="stkop-off"><p>' + (c.live ? '' : 'Paper trading is off. Turn it on to place simulated orders with demo money.') + '</p><button type="button" class="stkop-pill ghost" data-a="paperon">Turn on paper trading</button></div>';
}

function setText(sel, t) { const n = el.querySelector('[data-k=' + sel + ']'); if (n && n.textContent !== t) n.textContent = t; return n; }
function setVal(f, v) { for (const n of el.querySelectorAll('[data-f="' + f + '"]')) if (document.activeElement !== n && n.value !== v) n.value = v; }

// row 2 of the header: root + full name, contract, last + change vs the previous daily close, best bid / ask (filled in update())
function wantMeta(c) {
  if (meta.sym === c.sym) return;
  meta = { sym: c.sym, desc: '', prev: null };
  const s = c.sym; if (!s || !P.symMeta) return;
  P.symMeta(s).then((m) => { if (meta.sym !== s || !m) return; meta.desc = m.desc || ''; meta.prev = Number.isFinite(m.prev) && m.prev > 0 ? m.prev : null; update(); }, () => {});
}
const cleanDesc = (d) => String(d || '').replace(/\s+futures?$/i, '').replace(/\s*\(\$\d+\)$/, '').trim();
function renderInfo(c) {
  wantMeta(c);
  const root = c.fut ? c.rootName : c.tk || '—';
  const name = cleanDesc(meta.desc) || (c.fut ? '' : c.code);
  setText('root', root);
  const nm = setText('name', name); if (nm) nm.hidden = !name;
  const code = c.fut ? c.code || '' : '';
  const ce = setText('code', code); if (ce) ce.hidden = !code;
  const ie = el.querySelector('[data-k=inst]');
  if (ie) {
    const f = c.fam, sig = f ? f.mini + '|' + f.micro + '|' + c.rootName + '|' + c.chartRootName : '';
    if (ie.dataset.sig !== sig) {
      ie.dataset.sig = sig; ie.hidden = !f;
      ie.innerHTML = f ? [f.mini, f.micro].map((r) => '<button type="button" role="radio" data-inst="' + r + '" aria-checked="' + (r === c.rootName) + '" class="' + (r === c.rootName ? 'on' : '') + '" title="' + (r === c.chartRootName ? 'Trade ' + r + ' (the chart symbol)' : 'Trade ' + r + ' on this ' + c.chartRootName + ' chart (same prices)') + '">' + r + '</button>').join('') : '';
    }
  }
  setText('last', fmt(c, c.last));
  const ch = el.querySelector('[data-k=chg]');
  if (ch) {
    const d = c.last != null && meta.prev ? c.last - meta.prev : null;
    const t = d == null ? '' : (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(c, Math.abs(d)) + ' (' + (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d / meta.prev * 100).toFixed(2) + '%)';
    if (ch.textContent !== t) ch.textContent = t;
    ch.className = 'stkop-chg' + (d > 0 ? ' up' : d < 0 ? ' down' : '');
    ch.title = d == null ? '' : 'Change since the previous daily close';
  }
}
// the account comes from the Trade menu (top bar); the panel only shows it. Members: "Paper · DEMO", never a broker name.
function acctLabel(c) {
  if (!c.live) return { t: 'Paper · DEMO', live: false };
  const L2 = window.__stkLive && window.__stkLive.state, a = L2 && L2.acct;
  const env = c.li && c.li.env ? c.li.env : 'LIVE';
  return { t: env + (a ? ' · ' + (a.broker || 'Broker') + (a.last4 ? ' …' + a.last4 : '') : ''), live: true };
}
function renderFoot(c) {
  const al = acctLabel(c);
  const sig = JSON.stringify([al.t, c.live, c.li && c.li.killed, !!P.openTradeMenu]);
  if (footSig === sig) return; footSig = sig;
  footEl.innerHTML =
    '<div class="stkop-fr">' +
      '<span class="stkop-acct' + (al.live ? ' live' : '') + '" data-k="acct" title="Trading account (pick it in the Trade menu)"><span class="stkop-vh">Trading account: </span>' + esc(al.t) + '</span>' +
      (P.openTradeMenu ? '<button type="button" class="stkop-link" data-a="change" aria-label="Change the trading account in the Trade menu">Change</button>' : '') +
      '<span class="stkop-sp"></span><button type="button" class="stkop-b warn" data-a="flat">Flatten</button>' +
    '</div>' +
    '<div class="stkop-fr">' +
      '<span class="stkop-pos" data-k="pos">Flat</span><span class="stkop-pnl" data-k="pnl"></span><span class="stkop-wk" data-k="wk"></span><span class="stkop-sp"></span>' +
      (c.live ? (c.li && c.li.killed ? '<button type="button" class="stkop-b" data-a="killon">Switch live trading on</button>' : '<button type="button" class="stkop-b warn" data-a="kill">Turn off live trading</button>') : '') +
    '</div>' +
    '<p class="stkop-fine" data-k="fine"></p>';
}

// one pass: (re)build what changed, then fill every number / state
export function update() {
  if (!el) return;
  const c = ctx();
  renderChip(c);
  if (!open) { stopQuote(); return; }
  wantQuote(c);
  const ph = isPhone(), tab = shownTab(), paperOff = !c.live && !P.enabled;
  const dk = docked(), sig = [tab, c.live, ph, paperOff, c.fut, prefs.min && !dk, dk, tab === 'dom' ? c.sym : ''].join('|');
  el.classList.toggle('is-live', c.live);
  if (viewSig !== sig) {
    viewSig = sig;
    const b = window.__stkBookPanel;
    if (tab !== 'dom' && b && b.embedded) b.unembed();
    const mn0 = prefs.min && !ph && !dk;
    bodyEl.innerHTML = mn0 ? '' : paperOff ? viewOff(c) : tab === 'order' ? viewOrder(c) : tab === 'dom' ? viewDom() : viewScalp(c);
    if (tab === 'dom' && !paperOff && !mn0) {
      const box = bodyEl.querySelector('.stkop-dom');
      if (b && b.embed) b.embed(box); else { const n = box.querySelector('[data-k=domnote]'); n.hidden = false; n.textContent = 'The DOM ladder is not available on this page.'; }
    }
    for (const t of el.querySelectorAll('[data-tab]')) { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', String(on)); t.classList.toggle('on', on); t.tabIndex = on ? 0 : -1; }
    const mx = el.querySelector('[data-a=max]'), mn = el.querySelector('[data-a=min]');
    mx.innerHTML = prefs.max ? ICON.restore : ICON.max; mx.setAttribute('aria-label', prefs.max ? 'Restore the panel size' : 'Expand the panel'); mx.title = prefs.max ? 'Restore' : 'Expand';
    mn.innerHTML = prefs.min ? ICON.open : ICON.min; mn.setAttribute('aria-label', prefs.min ? 'Show the panel' : 'Minimise the panel'); mn.title = prefs.min ? 'Show' : 'Minimise';
    for (const b of el.querySelectorAll('.stkop-mode')) { const on = b.dataset.a === (dk ? 'dock' : 'float'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    requestAnimationFrame(layout);
  }
  renderFoot(c);
  // symbol details bar (row 2)
  const qt = quote(c), why = blockOf(c);
  renderInfo(c);
  el.setAttribute('aria-label', 'Order panel ' + c.label + (c.live ? ', LIVE account' : ', paper trading'));
  // quantity (cap + integer rules follow the mode)
  const qn = cleanQty(c, F.qty); if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f === 'qty') {} else if (String(qn) !== F.qty) F.qty = String(qn);
  setVal('qty', F.qty);
  const r = qtyRules(c);
  for (const b of el.querySelectorAll('[data-q]')) b.disabled = +b.dataset.q < 0 ? qn <= r.min : qn >= r.max;
  // bid / ask
  for (const n of el.querySelectorAll('[data-k=bid]')) { const t = qt ? fmt(c, qt.bid) : '—'; if (n.textContent !== t) n.textContent = t; }
  for (const n of el.querySelectorAll('[data-k=ask]')) { const t = qt ? fmt(c, qt.ask) : '—'; if (n.textContent !== t) n.textContent = t; }
  // scalp
  for (const b of el.querySelectorAll('.stkop-scalp [data-a=buy], .stkop-scalp [data-a=sell]')) b.disabled = !!why;
  for (const b of el.querySelectorAll('.stkop-join')) { b.disabled = !!why || !qt; b.title = why || (!qt ? noQuoteWhy(c) : (b.dataset.a === 'jbid' ? 'Buy limit at the best bid' : 'Sell limit at the best ask')); }
  const hk = el.querySelector('[data-f=hk]'); if (hk) hk.checked = !!prefs.hk;
  // order form
  const form = el.querySelector('.stkop-order');
  if (form) {
    const k = caps(c);
    if (F.type === 'stop' && !k.stop) F.type = 'market';
    for (const b of form.querySelectorAll('[data-side]')) { const on = b.dataset.side === F.side; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); }
    for (const b of form.querySelectorAll('[data-type]')) { const on = b.dataset.type === F.type; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); b.disabled = b.dataset.type === 'stop' && !k.stop; b.title = b.disabled ? k.why : ''; }
    // price
    const pk = c.sym + '|' + F.type + '|' + F.side;
    if (F.type !== 'market' && F.priceKey !== pk) {
      F.priceKey = pk;
      const base = F.type === 'limit' && qt ? (F.side === 'buy' ? qt.bid : qt.ask) : c.last != null ? roundTick(c.last + (F.type === 'stop' ? 1 : -1) * (F.side === 'buy' ? 1 : -1) * 10 * c.tick, c.tick) : null;
      F.price = base != null ? fmtIn(c, base) : '';
    }
    setText('plabel', F.type === 'market' ? 'Market price' : F.type === 'limit' ? 'Limit price' : 'Stop price');
    const mkt = form.querySelector('[data-k=mkt]'), pin = form.querySelector('[data-f=price]');
    mkt.hidden = F.type !== 'market'; pin.hidden = F.type === 'market';
    const mp = qt ? (F.side === 'buy' ? qt.ask : qt.bid) : c.last;
    if (mkt.textContent !== fmt(c, mp)) mkt.textContent = fmt(c, mp);
    setVal('price', F.price);
    // brackets
    const ref = entryRef(c, qt);
    const sl = k.bracket && F.sl.on ? legSync(c, ref, 'sl') : (legSync(c, ref, 'sl'), null), tp = k.bracket && F.tp.on ? legSync(c, ref, 'tp') : (legSync(c, ref, 'tp'), null);
    const two = k.bracket && k.two, tp1 = two && F.tp1.on ? legSync(c, ref, 'tp1') : (legSync(c, ref, 'tp1'), null);
    for (const lg of ['sl', 'tp', 'tp1']) {
      const fs = form.querySelector('[data-leg=' + lg + ']'), on = F[lg].on && k.bracket && (lg !== 'tp1' || two);
      if (lg === 'tp1') { fs.hidden = !k.two; if (!k.two) continue; }
      fs.classList.toggle('on', on); fs.classList.toggle('na', !k.bracket);
      const cb = fs.querySelector('[data-f="' + lg + '.on"]'); cb.checked = on; cb.disabled = !k.bracket;
      for (const i of fs.querySelectorAll('.stkop-pair input')) i.disabled = !on;
      for (const b of fs.querySelectorAll('[data-pre]')) { b.disabled = !k.bracket; b.classList.toggle('on', on && F[lg].src === 'ticks' && F[lg].ticks === b.dataset.pre); }
      setVal(lg + '.price', F[lg].price); setVal(lg + '.ticks', F[lg].ticks);
    }
    // TP1 size / unit / break-even, and the TP leg's name (TP2 = the rest while TP1 is on)
    const t1on = two && F.tp1.on;
    { const tl = form.querySelector('[data-leg=tp] .stkop-chk'); const want = t1on ? ' Take profit 2 · rest' : ' Take profit'; if (tl && tl.lastChild.textContent !== want) tl.lastChild.textContent = want; }
    if (k.two) {
      const f1 = form.querySelector('[data-leg=tp1]');
      for (const i of f1.querySelectorAll('.stkop-t1q input')) i.disabled = !t1on;
      for (const b of f1.querySelectorAll('[data-unit]')) { const o2 = b.dataset.unit === F.tp1.unit; b.classList.toggle('on', o2); b.setAttribute('aria-checked', String(o2)); b.disabled = !t1on; }
      const uq = f1.querySelector('[data-k=unitq]'); if (uq) uq.textContent = c.fut || c.live ? 'Lots' : 'Qty';
      const be = f1.querySelector('[data-f="be.on"]'); be.checked = F.be.on; be.disabled = !t1on;
      f1.querySelector('[data-f="be.ticks"]').disabled = !t1on || !F.be.on;
      setVal('tp1.size', F.tp1.size); setVal('be.ticks', F.be.ticks);
    }
    // risk-based size (sets the quantity; the stepper is locked while it is on)
    const rs = riskSize(c, k, ref, sl);
    const rf = form.querySelector('[data-leg=risk]');
    { const cb = rf.querySelector('[data-f="risk.on"]'); cb.checked = F.risk.on && k.bracket; cb.disabled = !k.bracket; rf.classList.toggle('na', !k.bracket); rf.classList.toggle('on', F.risk.on && k.bracket);
      for (const b of rf.querySelectorAll('[data-rmode]')) { const o2 = b.dataset.rmode === F.risk.mode; b.classList.toggle('on', o2); b.setAttribute('aria-checked', String(o2)); b.disabled = !(F.risk.on && k.bracket); }
      rf.querySelector('[data-f="risk.v"]').disabled = !(F.risk.on && k.bracket); setVal('risk.v', F.risk.v);
      setText('runit', F.risk.mode === 'pct' ? '%' : 'USD');
      const rt = !rs ? '' : rs.error ? rs.error : (rs.over ? 'Min size: ' + rs.qty + ' risks ' + money(rs.risk) + ', more than ' + money(rs.amt) : rs.qty + (c.fut || c.live ? (rs.qty === 1 ? ' lot' : ' lots') : '') + ' · risk ' + money(rs.risk) + (rs.capped ? ' (max size)' : ''));
      const re = setText('rsum', rt); if (re) re.classList.toggle('bad', !!(rs && (rs.error || rs.over)));
    }
    if (rs && !rs.error && String(rs.qty) !== F.qty) { F.qty = String(rs.qty); setVal('qty', F.qty); }
    for (const b of form.querySelectorAll('.stkop-qty button')) if (rs && !rs.error) b.disabled = true;
    { const qi = form.querySelector('.stkop-qty [data-f=qty]'); if (qi) qi.readOnly = !!(rs && !rs.error); }
    const tr = form.querySelector('[data-f=trail]'); if (tr) { tr.disabled = !(k.trail && F.sl.on); if (tr.disabled) F.trail = false; tr.checked = F.trail; tr.closest('label').title = k.trail ? 'Keeps the stop the same distance behind the best price (simulated)' : c.live ? k.why : 'Trail works on market orders'; }
    const wh = form.querySelector('[data-k=why]'); const w2 = !k.bracket ? k.why : c.live ? LIVE_TWO : ''; wh.hidden = !w2; if (wh.textContent !== w2) wh.textContent = w2;
    // risk / reward summary (paper point value; live contract spec)
    const pv = c.live ? (c.li ? c.li.pv : 0) : c.sp.ok ? c.sp.pointValue : 0;
    const qty = cleanQty(c, F.qty), parts = [];
    // TP1 size in lots (from % rounded down, like the engine)
    let q1 = null;
    if (tp1 != null) { const n = num(F.tp1.size), st = c.sp.ok ? c.sp.qtyStep : 1; q1 = F.tp1.unit === 'pct' ? Math.floor(qty * Math.min(100, Math.max(0, n)) / 100 / st + 1e-9) * st : n; q1 = Number.isFinite(q1) ? Number(q1.toFixed(6)) : null; }
    const q2 = q1 != null && q1 > 0 && q1 < qty ? Number((qty - q1).toFixed(6)) : qty;
    if (k.two) {
      const t1 = !t1on ? '' : !(q1 > 0) ? 'Enter how much TP1 closes.' : !(q1 < qty) ? 'TP1 must close less than ' + qty + '; TP2 takes the rest.' : 'TP1 closes ' + q1 + ', TP2 ' + (tp != null ? 'closes ' : 'leaves ') + q2 + (F.be.on ? '. Then the stop moves to entry' + (num(F.be.ticks) > 0 ? ' + ' + Math.round(num(F.be.ticks)) + ' ticks' : '') : '') + '.';
      const te = setText('t1sum', t1); if (te) te.classList.toggle('bad', !!t1on && !(q1 > 0 && q1 < qty));
    }
    if (sl != null && ref) parts.push('Risk ' + money(Math.abs(ref - sl) * qty * pv));
    const rw = (tp1 != null && q1 > 0 && q1 < qty ? Math.abs(tp1 - ref) * q1 : 0) + (tp != null ? Math.abs(tp - ref) * (tp1 != null && q1 > 0 && q1 < qty ? q2 : qty) : 0);
    if ((tp != null || tp1 != null) && ref && rw > 0) parts.push('Reward ' + money(rw * pv));
    if (sl != null && (tp != null || tp1 != null) && ref && Math.abs(ref - sl) > 0 && rw > 0) parts.push('R:R 1:' + (rw / (Math.abs(ref - sl) * qty)).toFixed(2));
    setText('sum', parts.join(' · '));
    const go = form.querySelector('[data-k=confirm]');
    go.className = 'stkop-pill stkop-confirm ' + F.side; go.disabled = !!why;
    const gt = 'Confirm ' + (F.side === 'buy' ? 'buy' : 'sell') + ' ' + qty; if (go.textContent !== gt) go.textContent = gt;
  }
  // status
  const st = why || (qt && qt.note) || (c.live ? ((c.li && c.li.rtt ? c.li.rtt + ' ' : '') + 'Ready. Real orders at your broker, you confirm each one.') : '');
  for (const n of el.querySelectorAll('[data-k=status]')) { if (n.textContent !== st) n.textContent = st; n.classList.toggle('bad', !!why); }
  renderAlert(c);
  // footer numbers
  let posT = 'Flat', pnl = null, wk = 0;
  if (c.live && c.li) { const q = c.li.pos.qty; posT = q ? (q > 0 ? 'Long ' : 'Short ') + Math.abs(q) + ' ' + c.li.code + (c.li.pos.avg ? ' @ ' + fmt(c, c.li.pos.avg) : '') : 'Flat ' + c.li.code; pnl = q ? c.li.pnl : null; wk = c.li.working.length; }
  else if (!c.live && c.a && c.sp.ok) { const p = c.a.position(c.sym); if (p) { posT = (p.side === 'buy' ? 'Long ' : 'Short ') + p.qty + ' @ ' + fmt(c, p.avg); pnl = c.a.openPnl(p); } wk = c.a.state.orders.filter((o) => o.symbol === c.sp.symbol).length; }
  setText('pos', posT);
  const pe = setText('pnl', pnl == null ? '' : money(pnl, true)); if (pe) pe.className = 'stkop-pnl' + (pnl > 0 ? ' up' : pnl < 0 ? ' down' : '');
  setText('wk', wk + ' working');
  const fl = el.querySelector('[data-a=flat]'); if (fl) fl.disabled = c.live ? !c.li || (!c.li.pos.qty && !c.li.working.length) : !(c.a && c.sp.ok && (c.a.position(c.sym) || wk));
  setText('fine', c.live ? 'Real orders at your broker. Max 2 contracts. Every attempt is logged. ' + DISCLAIMER : (P.label || 'Paper trading · demo money · simulated fills') + '. ' + DISCLAIMER);
}

// live strip under the symbol row (2026-11-17): the broker link could not be reached (Retry), or the stop loss / take profit state
// (red when the position has no working stop). Hidden on paper and when there is nothing to say.
function renderAlert(c) {
  const box = el.querySelector('[data-k=alert]'); if (!box) return;
  const li = c.live ? c.li : null, g = li && li.group;
  let t = '', kind = '', retry = false;
  if (li && li.retry) { t = li.block; kind = 'bad'; retry = true; }
  else if (li && li.alarm) { t = li.alarm; kind = 'bad'; }
  else if (g) {
    const p = (v) => (v == null ? '' : fmt(c, v));
    const legs = [g.sl != null ? 'Stop loss ' + p(g.sl) : '', g.tp != null ? 'Take profit ' + p(g.tp) : ''].filter(Boolean).join(' · ');
    t = (g.state === 'pending' ? 'Waiting for the fill, then sending ' : 'Working at your broker: ') + legs + (g.why ? '. ' + g.why : '. Keep this tab open.');
    kind = g.why ? 'warn' : 'info';
  }
  box.hidden = !t; box.className = 'stkop-alert' + (kind ? ' ' + kind : '');
  setText('alt', t);
  const rb = box.querySelector('[data-a=retry]'); rb.hidden = !retry;
}

// LIVE status chip on the chart (replaces the old bottom strip): click = open the panel
function renderChip(c) {
  const host = document.querySelector('.stkchart-panel');
  if (!c.live || !host) { if (chipEl) { chipEl.remove(); chipEl = null; } return; }
  if (!chipEl || chipEl.parentNode !== host) {
    if (chipEl) chipEl.remove();
    chipEl = document.createElement('button'); chipEl.type = 'button'; chipEl.className = 'stkop-lchip'; chipEl.innerHTML = '<i aria-hidden="true"></i><span></span>';
    chipEl.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
    chipEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.appendChild(chipEl);
  }
  const L2 = window.__stkLive && window.__stkLive.state, last4 = L2 && L2.acct ? L2.acct.last4 : '';
  const t = (c.li ? c.li.env : 'LIVE') + ' …' + last4 + (c.li ? ' · ' + c.li.code + ' · ' + (c.li.pos.qty ? (c.li.pos.qty > 0 ? 'Long ' : 'Short ') + Math.abs(c.li.pos.qty) + ' ' + money(c.li.pnl, true) : 'Flat') : ' · not tradable here');
  const s = chipEl.querySelector('span'); if (s.textContent !== t) s.textContent = t;
  chipEl.setAttribute('aria-label', t + '. Open the order panel');
  chipEl.dataset.pnl = c.li && c.li.pnl > 0 ? 'up' : c.li && c.li.pnl < 0 ? 'down' : '';   // white text on the red chip; no global .up/.down colour
}

// ------------------------------------------------------------------------------------------------ open / close
let tmr = 0;
function openPanel(pre) {
  pre = pre || {};
  if (!el) build();
  const was = open; open = true; prefs.open = true;
  if (pre.tab || pre.side || pre.price != null || pre.type) { prefs.tab = pre.tab || (pre.price != null || pre.type ? 'order' : prefs.tab); prefs.min = false; }
  if (pre.side) F.side = pre.side === 'sell' ? 'sell' : 'buy';
  if (pre.type) F.type = pre.type;
  if (pre.price != null && Number.isFinite(+pre.price)) { F.type = pre.type || 'limit'; const c = ctx(); F.price = fmtIn(c, roundTick(+pre.price, c.tick)); F.priceKey = c.sym + '|' + F.type + '|' + F.side; }
  savePrefs();
  el.hidden = false; viewSig = ''; footSig = '';
  update(); layout(); requestAnimationFrame(() => { layout(); });
  if (!tmr) tmr = setInterval(() => { if (open && !document.hidden) update(); }, 250);
  if (!was) { const t = el.querySelector('.stkop-tabs .on'); if (t && !isPhone()) try { t.focus({ preventScroll: true }); } catch (e) {} }
  if (pre.focus && prefs.tab === 'order') setTimeout(() => { const f = el.querySelector('[data-f=price]:not([hidden]), [data-k=confirm]'); if (f) f.focus(); }, 30);
  updateTradeBtn();
}
function close() {
  if (!el) return;
  open = false; prefs.open = false; savePrefs();
  const b = window.__stkBookPanel; if (b && b.embedded) b.unembed();
  el.hidden = true; viewSig = ''; stopQuote();
  document.documentElement.classList.remove('stkop-sheet');
  applyDock();
  if (tmr) { clearInterval(tmr); tmr = 0; }
  update(); updateTradeBtn();
}
function updateTradeBtn() {
  if (P && P.tradeUi) P.tradeUi(open);   // trading UI (one-click box, paper strip) shows only while this panel is open
  const b = document.getElementById('stkc-paper-btn'); if (b && !b.hasAttribute('aria-haspopup')) b.setAttribute('aria-pressed', String(open));
  for (const r of document.querySelectorAll('.stkop-railbtn')) { r.classList.toggle('on', open); r.setAttribute('aria-pressed', String(open)); }
}
// chip refresh while the panel is closed (live only): once a second
setInterval(() => { if (!open && P && P.live && !document.hidden) update(); }, 1000);

export function mountOrderPanel(paperApi) {
  if (P) return api;
  P = paperApi; loadPrefs(); build();
  if (prefs.open) openPanel();
  window.__stkOrderPanel = api;
  return api;
}
const api = {
  open: openPanel, close, toggle: () => (open ? close() : openPanel()), update,
  get isOpen() { return open; }, get prefs() { return prefs; }, get form() { return F; }, setTab: (t) => { if (!open) openPanel({ tab: t }); else setTab(t); }, setMode,
  reloadPrefs: () => { loadPrefs(); if (open) { viewSig = ''; layout(); update(); } }
};
