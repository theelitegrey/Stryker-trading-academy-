// TradeZoro — Charts PAPER TRADING (ES module, charts.html only)
// Owner order 2026-10-12: "Add complete full demo/paper trading feature inside the charts, like
// tradingview". Modelled on TradingView's Paper Trading, in our own look.
//
// SIMULATED TRADING WITH DEMO MONEY ONLY. Nothing here can reach a broker: there is no broker
// connection, no order endpoint and no Rithmic order routing. The only network traffic this
// module causes is (a) the market-data requests the chart already makes (provider getBars for a
// symbol that has a paper position/order but no chart open) and (b) the member's own paper
// account document in Firestore. tools/tests/chart-paper-trading-browser.js asserts that no
// request goes to any broker/order endpoint. Labelled everywhere "Paper trading · demo money ·
// simulated fills" + "Education only. Not financial advice."
//
// Depends on: assets/paper-engine.js (window.PaperEngine: account + fill rules, which reuse the
// conservative fill model of assets/replay-engine.js), assets/market-hours.js
// (window.StrykerMarketHours.futuresStatus: CME calendar, no fills while closed),
// assets/chart-sounds.js (window.StrykerChartSounds.simEvent), assets/toast.js (showToast),
// the Vela workspace from assets/vela-chart.js (ws), Vela's Core (registerRendererLayer,
// registerWidgetAction), firebase compat + assets/auth.js + assets/progress.js (db).
// The journal hook lazy-loads assets/journal-calc.js + assets/journal-data.js (saveTrade).
//
// HOW FILLS WORK: every 250 ms the newest bar of every chart cell (and, every 5 s, a 1-minute
// bar from the same provider for symbols with paper orders that are not on a chart) is turned
// into a price SEGMENT {o,h,l,c} = what traded since the previous look (a new bar's range, or the
// part of the forming bar's range that is new). The engine fills limits/stops/brackets against
// that segment with the replay engine's rules. Bars that arrive in a batch (after the tab was
// hidden) are replayed in order. Fills happen only in ONE tab: the Charts tabs of this browser
// elect a leader through localStorage; the others mirror its account through 'storage' events.
// Orders keep working ONLY while a Charts tab is open (said in the panel). No server.
//
// STORAGE: signed in → students/{uid}/paperTrading/account { state: JSON string, updatedAt }
// (owner-only, validated in firestore.rules — a NEW rules block, flagged for deploy) + a local
// copy; signed out → localStorage only. The newer copy (state.savedAt) wins at load.
//
// Education only. Not financial advice.

const PE = window.PaperEngine;
const LAYER = 'stk_paper';
const UI_KEY = 'stryker_paper_ui';
const LEADER_KEY = 'stryker_paper_leader';
const POLL_MS = 250, FEED_MS = 5000, LEADER_MS = 1500, LEADER_STALE = 5000;
const PHONE_MAX = 700;
const PANEL_H = 180, PANEL_MIN = 110;   // desktop panel body height (px): default, minimum
const LABEL = 'Paper trading · demo money · simulated fills';
const DISCLAIMER = 'Education only. Not financial advice.';
const TAB_ID = Math.random().toString(36).slice(2, 10);

let WS = null, CORE = null, acct = null, uid = null, toastFn = null;
let leader = false, ready = false;
const tracks = new Map();          // key -> { t, h, l, c } last bar seen per cell / feed
let ui = loadUi();
let panel = null, ticket = null;
const drag = { on: false };

// ------------------------------------------------------------------ small helpers
const $ = (sel, root) => (root || document).querySelector(sel);
function h(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return n;
}
const showSym = (s) => String(s || '').replace(/^[a-z]+:/i, '');
const isPhone = () => window.innerWidth <= PHONE_MAX;
function loadUi(){
  let u; try { u = Object.assign({ open: false, tab: 'positions', h: PANEL_H }, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { u = { open: false, tab: 'positions', h: PANEL_H }; }
  // phone: the sheet always starts as the slim bar; the member opens it when needed
  if (window.innerWidth <= PHONE_MAX) u.open = false;
  return u;
}
// desktop panel body height: remembered, kept between 110 px and 60% of the chart area
function panelMax(){ const m = document.querySelector('main.dash-main'); return Math.max(PANEL_MIN + 40, Math.round((m ? m.clientHeight : window.innerHeight) * 0.6)); }
function applyPanelH(){
  if (!panel) return;
  const hpx = Math.min(panelMax(), Math.max(PANEL_MIN, Number(ui.h) || PANEL_H));
  panel.style.setProperty('--stkpt-h', hpx + 'px');
}
function bindResize(grip){
  grip.addEventListener('pointerdown', (e) => {
    if (isPhone() || (e.button != null && e.button !== 0)) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = panel.querySelector('.stkpt-body').getBoundingClientRect().height;
    try { grip.setPointerCapture(e.pointerId); } catch (e2) {}
    panel.classList.add('resizing');
    let raf = 0;
    const move = (ev) => { ui.h = Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, h0 + (y0 - ev.clientY)))); if (!raf) raf = requestAnimationFrame(() => { raf = 0; applyPanelH(); window.dispatchEvent(new Event('resize')); }); };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); panel.classList.remove('resizing'); saveUi(); applyPanelH(); window.dispatchEvent(new Event('resize')); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); ui.h = Math.min(panelMax(), Math.max(PANEL_MIN, (Number(ui.h) || PANEL_H) + (e.key === 'ArrowUp' ? 20 : -20))); saveUi(); applyPanelH(); window.dispatchEvent(new Event('resize'));
  });
}
function saveUi(){ try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }
function money(n, sign){
  if (!Number.isFinite(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : (sign && n > 0 ? '+' : '')) + '$' + s;
}
function specOf(sym){ return acct ? acct.spec(sym) : PE.specOf(sym); }
function fmtP(sym, p){
  if (!Number.isFinite(p)) return '—';
  const sp = specOf(sym); const d = sp.ok ? Math.min(8, sp.decimals) : 2;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
// Paper toasts: our own compact stack in the chart's bottom-left corner (never over the price
// scale), at most 2 visible, each gone after ~4 s (errors 6 s). Click to dismiss.
const TOAST_MAX = 2, TOAST_MS = 4000;
const toastLog = [];
function toast(msg, type){
  type = type || 'success';
  toastLog.push({ type, msg: String(msg), at: Date.now() }); if (toastLog.length > 50) toastLog.shift();
  try {
    const host = document.querySelector('.stkchart-panel');
    if (!host) { if (toastFn) toastFn(msg, type); return; }
    let box = document.getElementById('stkpt-toasts');
    if (!box || box.parentElement !== host) { if (box) box.remove(); box = h('div', { id: 'stkpt-toasts', 'aria-live': 'polite', role: 'status' }); host.appendChild(box); }
    const el = h('div', { class: 'stkpt-toast ' + type, title: 'Dismiss' }, [h('i', { 'aria-hidden': 'true' }), h('span', { text: String(msg) })]);
    el.addEventListener('click', () => el.remove());
    box.appendChild(el);
    while (box.children.length > TOAST_MAX) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, type === 'error' ? 6000 : TOAST_MS);
  } catch (e) {}
}
function fbUser(){ try { return window.firebase && firebase.auth && firebase.auth().currentUser; } catch (e) { return null; } }
function cellOf(id){ try { return WS.cell(id); } catch (e) { return null; } }
function inner(cell){ try { return cell.chart.renderer.renderer; } catch (e) { return null; } }
function cells(){ try { return (WS.context().cells || []).map((c) => cellOf(c.id)).filter(Boolean); } catch (e) { return []; } }
function activeCell(){ try { return cellOf(WS.active.id) || WS.active; } catch (e) { return null; } }
function barsOf(cell){
  try { const b = cell.chart.orchestrator.rawBars; if (b && b.length) return b; } catch (e) {}
  try { const b = inner(cell).scene.bars; if (b && b.length) return b; } catch (e) {}
  return null;
}
function tickHint(sym){
  for (const c of cells()) if (c.symbol === sym) { try { const m = inner(c).scene.priceMintick; if (m > 0) return m; } catch (e) {} }
  return undefined;
}
function isOpen(sym, t){
  if (/^futures:/i.test(sym)) {
    const MH = window.StrykerMarketHours;
    try { return MH && MH.futuresStatus ? MH.futuresStatus(t || Date.now()).open : true; } catch (e) { return true; }
  }
  return true;                    // crypto trades 24/7
}
function dayStart(){ const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function sound(kind){
  if (!acct || !acct.settings.sounds) return;
  try { window.StrykerChartSounds && window.StrykerChartSounds.simEvent(kind, { source: 'paper' }); } catch (e) {}
}

// ------------------------------------------------------------------ storage
const lsKey = () => 'stryker_paper_' + (uid || 'guest');
const revKey = () => lsKey() + ':rev';      // tiny "who saved last" stamp, cheap to read every tick
function cloudDoc(){ return firebase.firestore().collection('students').doc(uid).collection('paperTrading').doc('account'); }
let cloudT = 0, cloudBusy = false, cloudAgain = false;
let myRev = '';
function save(localOnly){
  if (!acct) return;
  acct.state.savedAt = Date.now();
  const json = JSON.stringify(acct.state);
  myRev = TAB_ID + ':' + acct.state.savedAt + ':' + json.length;
  try { localStorage.setItem(lsKey(), json); localStorage.setItem(revKey(), myRev); } catch (e) { console.warn('TradeZoro paper: local save', e); }
  saveCount++;
  // debounce cloud writes by 1.2 s, but never starve them: a steady stream of saves still
  // reaches Firestore at least every 3 s
  if (uid && !localOnly) {
    clearTimeout(cloudT);
    if (!cloudFirstPending) cloudFirstPending = Date.now();
    const wait = Math.max(0, Math.min(1200, cloudFirstPending + 3000 - Date.now()));
    cloudT = setTimeout(() => { cloudFirstPending = 0; pushCloud(); }, wait);
  }
}
let saveCount = 0, cloudFirstPending = 0, cloudPushes = 0;
// Another Charts tab saved since we last saved/loaded: adopt its copy BEFORE acting or filling,
// so a tab never works from a stale account (a filled order coming back to life = double fill).
function syncFromLocal(){
  if (!acct) return;
  let rev = null; try { rev = localStorage.getItem(revKey()); } catch (e) {}
  if (!rev || rev === myRev) return;
  const st = parse(localStorage.getItem(lsKey()));
  myRev = rev;
  if (!st) return;
  const last = acct.last;
  acct = new PE.PaperAccount(st, { now: () => Date.now(), isOpen, tickOf: tickHint });
  acct.last = last;
}
async function pushCloud(){
  if (!uid || !acct) return;
  if (cloudBusy) { cloudAgain = true; return; }
  cloudBusy = true;
  cloudPushes++;
  try { await cloudDoc().set({ state: JSON.stringify(acct.state), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); }
  catch (e) { console.warn('TradeZoro paper: cloud save', e); }
  cloudBusy = false;
  if (cloudAgain) { cloudAgain = false; pushCloud(); }
}
function parse(s){ try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } }
async function load(){
  const u = fbUser();
  uid = u ? u.uid : null;
  let st = parse(localStorage.getItem(lsKey()));
  if (uid) {
    try {
      const snap = await cloudDoc().get();
      const c = snap && snap.exists ? parse((snap.data() || {}).state) : null;
      if (c && (!st || (Number(c.savedAt) || 0) >= (Number(st.savedAt) || 0))) st = c;
    } catch (e) { console.warn('TradeZoro paper: cloud load', e); }
  }
  const last = acct ? acct.last : {};
  acct = new PE.PaperAccount(st, { now: () => Date.now(), isOpen, tickOf: tickHint });
  acct.last = last;
  try { myRev = localStorage.getItem(revKey()) || ''; } catch (e) {}
  ready = true;
  // a brand-new account stays local until the member actually does something: opening Charts
  // must not cost a Firestore write for members who never use paper trading
  if (!st) save(true);
  renderAll();
}
window.addEventListener('storage', (e) => {
  if (!acct || e.key !== lsKey() || !e.newValue) return;
  const st = parse(e.newValue); if (!st) return;
  try { myRev = localStorage.getItem(revKey()) || myRev; } catch (e2) {}
  const last = acct.last;
  acct = new PE.PaperAccount(st, { now: () => Date.now(), isOpen, tickOf: tickHint });
  acct.last = last;
  renderAll();
});

// ------------------------------------------------------------------ leader election (fills in one tab)
function leaderTick(){
  let cur = null; try { cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null'); } catch (e) {}
  const now = Date.now();
  // Two-phase: a free/stale slot is CLAIMED on one tick and only LED on the next tick if the
  // claim is still ours. Two tabs that start together both claim, the last write wins, and both
  // read the same winner before either fills (one-phase "write = lead" let both fill for a tick).
  if (cur && cur.id === TAB_ID) {
    try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, at: now })); } catch (e) {}
    leader = true;
  } else {
    leader = false;
    if (!cur || now - (cur.at || 0) > LEADER_STALE) {
      try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, at: now })); } catch (e) {}
      setTimeout(leaderTick, 300);          // confirm soon, not a whole LEADER_MS later
    }
  }
}
window.addEventListener('pagehide', () => {
  try { const cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null'); if (cur && cur.id === TAB_ID) localStorage.removeItem(LEADER_KEY); } catch (e) {}
});

// ------------------------------------------------------------------ price feed -> segments
// Turn the newest bars into "what traded since the last look" segments.
function segmentsFrom(key, bars){
  const n = bars.length; if (!n) return [];
  const b = bars[n - 1];
  const T = (x) => (x.time != null ? x.time : x.t);
  const tr = tracks.get(key);
  const segs = [];
  if (!tr || T(b) < tr.t) {
    // first look (or the chart reloaded older data): no history replay, just the current price
    tracks.set(key, { t: T(b), h: b.high, l: b.low, c: b.close });
    return [{ t: T(b), o: b.close, h: b.close, l: b.close, c: b.close, seed: true }];
  }
  if (T(b) === tr.t) {
    const nh = b.high > tr.h, nl = b.low < tr.l;
    if (!nh && !nl && b.close === tr.c) return [];
    segs.push({ t: T(b), o: tr.c, h: Math.max(tr.c, b.close, nh ? b.high : -Infinity), l: Math.min(tr.c, b.close, nl ? b.low : Infinity), c: b.close });
  } else {
    // the bar rolled (maybe several, after a hidden tab): finish the old bar, then every newer bar in order
    let i = n - 1; while (i > 0 && T(bars[i - 1]) >= tr.t && n - i < 1000) i--;
    const prev = T(bars[i]) === tr.t ? bars[i] : null;
    if (prev && (prev.high > tr.h || prev.low < tr.l || prev.close !== tr.c)) {
      segs.push({ t: tr.t, o: tr.c, h: Math.max(tr.c, prev.close, prev.high > tr.h ? prev.high : -Infinity), l: Math.min(tr.c, prev.close, prev.low < tr.l ? prev.low : Infinity), c: prev.close });
    }
    for (let j = prev ? i + 1 : i; j < n; j++) { const x = bars[j]; if (T(x) > tr.t) segs.push({ t: T(x), o: x.open, h: x.high, l: x.low, c: x.close }); }
  }
  tracks.set(key, { t: T(b), h: b.high, l: b.low, c: b.close });
  return segs;
}
function feedSymbol(sym, segs){
  let events = [];
  for (const s of segs) {
    if (s.seed || !leader) { acct.setLast(sym, s.c); continue; }
    events = events.concat(acct.onSegment(sym, s));
  }
  return events;
}
function poll(){
  if (!acct || !ready) return;
  syncFromLocal();
  let events = [];
  const seen = new Set();
  for (const c of cells()) {
    const sym = c.symbol; if (!sym) continue;
    const bars = barsOf(c); if (!bars) continue;
    // one cell per symbol is enough (several cells of the same symbol carry the same trades)
    if (seen.has(sym)) continue; seen.add(sym);
    const key = 'cell:' + sym + ':' + (c.timeframe || '');
    events = events.concat(feedSymbol(sym, segmentsFrom(key, bars)));
  }
  if (events.length) onEvents(events);
  livePnl();
}
// Symbols with paper positions/orders but no chart open: 1-minute bars from the same provider.
let feedBusy = false;
async function feedOffChart(){
  if (!acct || !leader || feedBusy || document.hidden) return;
  syncFromLocal();
  const onChart = new Set(cells().map((c) => c.symbol));
  const need = new Set(Object.keys(acct.state.positions).concat(acct.state.orders.map((o) => o.symbol)).filter((s) => !onChart.has(s)));
  if (!need.size) return;
  feedBusy = true;
  try {
    for (const sym of need) {
      const m = /^([a-z]+):(.+)$/i.exec(sym); if (!m) continue;
      let p = null; try { p = WS.feed.providerInstance(m[1].toLowerCase()); } catch (e) {}
      if (!p || !p.getBars) continue;
      try {
        const bars = await p.getBars(m[2], '1', { limit: 5 });
        if (bars && bars.length) { const ev = feedSymbol(sym, segmentsFrom('feed:' + sym, bars)); if (ev.length) onEvents(ev); }
      } catch (e) { /* market data hiccup: try again next round */ }
    }
  } finally { feedBusy = false; }
  livePnl();
}

// ------------------------------------------------------------------ events -> sounds, toasts, journal
function onEvents(events){
  for (const ev of events) {
    const name = showSym(ev.symbol);
    const qty = ev.qty, px = fmtP(ev.symbol, ev.price);
    if (ev.type === 'open') {
      sound(ev.side === 'buy' ? 'long-opened' : 'short-opened');
      toast('Paper ' + (ev.side === 'buy' ? 'long' : 'short') + ' ' + qty + ' ' + name + ' filled @ ' + px + (ev.reversed ? ' (reversed)' : ''), 'success');
    } else if (ev.type === 'add') {
      sound(ev.side === 'buy' ? 'long-opened' : 'short-opened');
      toast('Paper ' + name + ': added ' + qty + ' @ ' + px, 'success');
    } else if (ev.type === 'tp' || ev.type === 'sl' || ev.type === 'close' || ev.type === 'reduce') {
      sound(ev.type === 'tp' ? 'take-profit' : ev.type === 'sl' ? 'stop-loss' : 'position-closed');
      const what = ev.type === 'tp' ? 'Take profit hit' : ev.type === 'sl' ? 'Stop loss hit' : ev.type === 'reduce' ? 'Reduced' : 'Closed';
      toast('Paper ' + name + ': ' + what + ' @ ' + px + ' · ' + money(ev.trade.pnl, true), ev.trade.pnl >= 0 ? 'success' : 'info');
      if (ev.trade) offerJournal(ev.trade);
    }
    try { window.dispatchEvent(new CustomEvent('stryker:paper', { detail: { type: ev.type, symbol: ev.symbol, side: ev.side, qty: ev.qty, price: ev.price, pnl: ev.trade ? ev.trade.pnl : null } })); } catch (e) {}
  }
  save();
  renderAll();
}

// Journal hook: assets/journal-data.js has an add-trade function, saveTrade(uid, raw, balance),
// but it always re-derives P&L as (exit - entry) x size with no contract point value, which would
// store an NQ paper trade at 1/20th of its P&L. So this writes the same document shape into the
// same collection (students/{uid}/journal, existing rules) the way the replay page does, with the
// derived fields from the journal's own journalComputeDerived (assets/journal-calc.js, lazy-loaded)
// and the paper P&L written over pnl. Tagged 'paper', account 'Paper'.
let journalLoad = null;
const journalBusy = new Set();     // trade ids being sent (a double click must not write two docs)
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function journalReady(){
  if (typeof window.journalComputeDerived === 'function') return Promise.resolve(true);
  if (!journalLoad) {
    const v = (document.querySelector('meta[name="stryker-build"]') || {}).content || '';
    journalLoad = loadScript('assets/journal-calc.js?v=' + v).then(() => true).catch(() => false);
  }
  return journalLoad;
}
async function sendToJournal(tradeId){
  const t = acct && acct.state.trades.find((x) => x.id === tradeId);
  if (!t) return;
  if (t.journaled) { toast('That paper trade is already in your journal.', 'info'); return; }
  if (!uid) { toast('Sign in to send paper trades to your Trade journal.', 'info'); return; }
  if (journalBusy.has(tradeId)) return;
  journalBusy.add(tradeId);
  try { await sendToJournalOnce(t); } finally { journalBusy.delete(tradeId); }
}
async function sendToJournalOnce(t){
  if (!(await journalReady()) || typeof window.journalComputeDerived !== 'function') { toast('The journal is not available right now.', 'error'); return; }
  const d = new Date(t.entryAt);
  const z = (n) => String(n).padStart(2, '0');
  const raw = {
    instrument: showSym(t.symbol).replace(/1!$/, ''), direction: t.side === 'buy' ? 'long' : 'short',
    date: d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()), time: z(d.getHours()) + ':' + z(d.getMinutes()),
    entryPrice: String(t.entry), exitPrice: String(t.exit), positionSize: String(t.qty), fees: String(t.fees || 0),
    stopLoss: t.sl != null ? String(t.sl) : null, takeProfit: t.tp != null ? String(t.tp) : null,
    setup: 'Paper trade', account: 'Paper', tags: ['paper'],
    notes: 'Paper trade on TradeZoro Charts (demo money, simulated fill). Exit: ' + ({ tp: 'take profit', sl: 'stop loss', manual: 'closed', reverse: 'reversed' }[t.reason] || t.reason) + '.',
    source: 'paper', paperTradeId: t.id
  };
  // Same write as the backtest replay's "Send to journal" (assets/replay.js): one new doc in
  // students/{uid}/journal. journalComputeDerived has no contract multiplier, so pnl / risk / R
  // are corrected with the paper point value, as assets/journal-lux.js does for imports.
  const pv = t.pointValue || 1;
  raw.pointValue = pv;
  try {
    const db = firebase.firestore();
    const derived = window.journalComputeDerived(raw, acct.state.startBalance);
    derived.pnl = t.pnl; derived.result = t.pnl > 0 ? 'Win' : (t.pnl < 0 ? 'Loss' : 'Breakeven');
    if (derived.riskAmount) { derived.riskAmount = derived.riskAmount * pv; derived.rMultiple = t.pnl / derived.riskAmount; derived.riskPercent = derived.riskAmount / acct.state.startBalance * 100; }
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('students').doc(uid).collection('journal').doc().set(Object.assign({}, raw, derived, { createdAt: ts, updatedAt: ts }));
    syncFromLocal(); acct.markJournaled(t.id); save(); renderAll();
    toast('Paper trade sent to your Trade journal.', 'success');
  } catch (e) { console.warn('TradeZoro paper: journal', e); toast('Could not send it to the journal. Try again from History.', 'error'); }
}
function offerJournal(trade){
  if (!acct.settings.askJournal || !uid) return;
  let box = document.getElementById('stkpt-offers');
  if (!box) { box = h('div', { id: 'stkpt-offers', 'aria-live': 'polite' }); document.body.appendChild(box); }
  while (box.children.length >= 2) box.firstChild.remove();
  const el = h('div', { class: 'stkpt-offer', role: 'status' }, [
    h('span', { text: showSym(trade.symbol) + ' ' + money(trade.pnl, true) + ' closed. Send it to your Trade journal?' }),
    h('button', { type: 'button', class: 'stkpt-b stkpt-b-pri', text: 'Send to Journal', onclick: () => { el.remove(); sendToJournal(trade.id); } }),
    h('button', { type: 'button', class: 'stkpt-x', 'aria-label': 'Dismiss', text: '×', onclick: () => el.remove() })
  ]);
  box.appendChild(el);
  setTimeout(() => el.remove(), 12000);
}

// ------------------------------------------------------------------ actions (UI -> engine)
function act(fn, okMsg){
  if (!acct) { toast('Paper trading is still loading.', 'info'); return null; }
  syncFromLocal();
  try {
    const r = fn();
    if (r && r.events && r.events.length) onEvents(r.events);
    else if (Array.isArray(r) && r.length) onEvents(r);
    else { save(); renderAll(); }
    if (okMsg) toast(okMsg, 'success');
    return r || true;
  } catch (e) {
    toast(e && e.message ? e.message : 'That paper order could not be placed.', 'error');
    renderAll();
    return null;
  }
}
export function placeOrder(o){
  const r = act(() => acct.placeOrder(o));
  if (r && r.order) toast('Paper ' + o.side + ' ' + o.type + ' ' + r.order.qty + ' ' + showSym(o.symbol) + ' @ ' + fmtP(o.symbol, r.order.price) + ' working', 'success');
  return r;
}
function closePos(sym){ return act(() => acct.closePosition(sym)); }
function reversePos(sym){ return act(() => acct.reversePosition(sym)); }
function flattenAll(){
  if (!acct) return;
  const r = act(() => { const x = acct.flattenAll(); return x.events; });
  const skipped = acct ? Object.keys(acct.state.positions) : [];
  if (skipped.length) toast('Still open (market closed): ' + skipped.map(showSym).join(', '), 'info');
  return r;
}
function cancelOrder(id){ return act(() => { acct.cancelOrder(id); return []; }); }

// ------------------------------------------------------------------ on-chart lines (renderer layer + DOM chips)
const COL = { buy: '#2962ff', sell: '#f23645', tp: '#089981', sl: '#f23645', pos: '#089981', neg: '#f23645', flat: '#787b86' };
function linesFor(sym){
  if (!acct || !acct.settings.lines) return [];
  const out = [];
  const p = acct.position(sym);
  if (p) {
    out.push({ id: 'pos', kind: 'pos', price: p.avg, side: p.side });
    if (p.tp != null) out.push({ id: 'ptp', kind: 'tp', price: p.tp, side: p.side, ref: p.avg, qty: p.qty });
    if (p.sl != null) out.push({ id: 'psl', kind: 'sl', price: p.sl, side: p.side, ref: p.avg, qty: p.qty });
  }
  for (const o of acct.state.orders) {
    if (o.symbol !== sym) continue;
    out.push({ id: 'o' + o.id, kind: 'ord', oid: o.id, price: o.price, side: o.side, type: o.type, qty: o.qty });
    if (o.tp != null) out.push({ id: 'o' + o.id + 'tp', kind: 'otp', oid: o.id, price: o.tp, side: o.side, ref: o.price, qty: o.qty });
    if (o.sl != null) out.push({ id: 'o' + o.id + 'sl', kind: 'osl', oid: o.id, price: o.sl, side: o.side, ref: o.price, qty: o.qty });
  }
  if (drag.on && drag.sym === sym) for (const l of out) if (l.id === drag.id) l.price = drag.price;
  if (drag.on && drag.sym === sym && drag.kind === 'new') out.push({ id: 'new', kind: drag.newKind, price: drag.price, side: drag.side, ref: drag.ref, qty: drag.qty });
  return out;
}
function lineColor(l){
  if (l.kind === 'tp' || l.kind === 'otp') return COL.tp;
  if (l.kind === 'sl' || l.kind === 'osl') return COL.sl;
  if (l.kind === 'pos') return l.side === 'buy' ? COL.buy : COL.sell;
  return l.side === 'buy' ? COL.buy : COL.sell;
}
function chipText(sym, l){
  const name = (l.side === 'buy' ? 'BUY' : 'SELL');
  if (l.kind === 'pos') {
    const p = acct.position(sym); if (!p) return ['', ''];
    return [(p.side === 'buy' ? 'LONG ' : 'SHORT ') + p.qty, money(acct.openPnl(p), true)];
  }
  if (l.kind === 'ord') return [name + ' ' + (l.type === 'limit' ? 'LMT' : 'STP') + ' ' + l.qty, fmtP(sym, l.price)];
  const v = acct.bracketValue(sym, l.side, l.qty, l.ref, l.price);
  return [(l.kind === 'tp' || l.kind === 'otp') ? 'TP' : 'SL', money(v, true)];
}
function layerFactory(){
  let canvas = null, overlay = null, last = null, lastYs = {};
  const inst = {
    get overlay(){ return overlay; },
    get args(){ return last; },
    get ys(){ return lastYs; },
    mount(c){
      canvas = c;
      overlay = h('div', { class: 'stkpt-ov' });
      (c.parentElement || c).appendChild(overlay);
      inst.cell = null;
    },
    render(a){
      if (!canvas) return;
      last = a;
      const co = a.coords, dpr = co.dpr || 1, W = co.width;
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = a.data; const lines = (d && d.lines) || [];
      const top = a.bounds.top, bot = top + a.bounds.height;
      const fullW = canvas.width / dpr;
      const ys = {};
      g.save();
      for (const l of lines) {
        const y = Math.round(co.priceToY(l.price, a.scale, a.bounds)) + 0.5;
        ys[l.id] = y; lastYs = ys;
        if (y < top || y > bot) continue;
        g.strokeStyle = l.color; g.lineWidth = 1; g.globalAlpha = l.kind === 'pos' ? 1 : 0.9;
        g.setLineDash(l.kind === 'pos' ? [] : l.kind === 'ord' ? [6, 3] : [3, 3]);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        g.setLineDash([]);
        // price tag on the axis
        if (fullW > W + 4) {
          g.globalAlpha = 1; g.fillStyle = l.color;
          g.fillRect(W, y - 9, fullW - W, 18);
          g.fillStyle = '#fff'; g.font = '11px -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,sans-serif'; g.textBaseline = 'middle';
          g.fillText(l.label, W + 4, y);
        }
      }
      g.restore();
      // DOM chips follow the lines
      if (overlay) {
        // A line outside the visible price range keeps its chip, pinned to the top or bottom
        // edge of the price pane with an arrow, so a far TP/SL is never invisible.
        // Chips whose lines are closer than a chip's height sit side by side (the later one moves
        // left of the earlier one) instead of on top of each other. Widths are read in one pass
        // before any write, so this costs one layout per frame at most.
        let nUp = 0, nDn = 0;
        const chips = [...overlay.querySelectorAll('.stkpt-chip')];
        const widths = chips.map((c) => c.offsetWidth);
        const placed = [];
        const baseRight = Math.round(fullW - W + 56);
        chips.forEach((chip, i) => {
          const y = ys[chip.dataset.id];
          if (y == null) { chip.style.visibility = 'hidden'; return; }
          let cy = y - 11, pin = '';
          if (y < top + 12) { pin = 'up'; cy = top + 4 + 26 * nUp++; }
          else if (y > bot - 12) { pin = 'down'; cy = bot - 26 - 26 * nDn++; }
          let right = baseRight;
          const clash = () => placed.some((p) => Math.abs(p.cy - cy) < 24 && right < p.right + p.w + 4 && p.right < right + widths[i] + 4);
          for (const p of placed) if (Math.abs(p.cy - cy) < 24 && right < p.right + p.w + 4) right = p.right + p.w + 4;
          if (right + widths[i] > fullW - 6) {
            // no room side by side (phone): stack it just above/below instead, at the base column
            right = baseRight;
            const dir = y > (top + bot) / 2 ? -1 : 1;
            for (let k = 0; k < 6 && clash(); k++) cy += dir * 24;
          }
          placed.push({ cy, right, w: widths[i] });
          if (chip.dataset.pin !== pin) chip.dataset.pin = pin;
          chip.style.visibility = '';
          chip.style.transform = 'translate3d(0,' + Math.round(cy) + 'px,0)';
          chip.style.right = right + 'px';
        });
      }
    },
    destroy(){ if (overlay) overlay.remove(); canvas = null; overlay = null; }
  };
  return inst;
}
function layerInst(R){ try { const l = R.extLayers.find((x) => x.def.id === LAYER); return l && l.instance; } catch (e) { return null; } }
const lineSig = new WeakMap();
function pushLines(force){
  if (!WS || !acct) return;
  for (const cell of cells()) {
    const R = inner(cell); if (!R || !R.setNativeData) continue;
    const inst = layerInst(R); if (!inst) continue;
    const sym = cell.symbol;
    const sp = specOf(sym);
    const lines = sp.ok ? linesFor(sym) : [];
    const data = lines.map((l) => ({ id: l.id, kind: l.kind, price: l.price, color: lineColor(l), label: fmtP(sym, l.price) }));
    syncChips(cell, inst, lines);
    const sig = JSON.stringify(data);
    if (!force && lineSig.get(R) === sig) continue;
    lineSig.set(R, sig);
    try { R.setNativeData(LAYER, { lines: data }); } catch (e) {}
  }
  oneClickAll();
}
function syncChips(cell, inst, lines){
  const ov = inst.overlay; if (!ov) return;
  inst.cell = cell;
  const have = new Map([...ov.querySelectorAll('.stkpt-chip')].map((c) => [c.dataset.id, c]));
  for (const l of lines) {
    let chip = have.get(l.id);
    if (!chip) {
      chip = h('div', { class: 'stkpt-chip', 'data-id': l.id, 'data-kind': l.kind }, [
        h('span', { class: 'stkpt-chip-a' }), h('span', { class: 'stkpt-chip-b' }),
        l.id === 'new' ? null : h('button', { type: 'button', class: 'stkpt-chip-x', 'aria-label': l.kind === 'pos' ? 'Close position' : l.kind === 'ord' ? 'Cancel order' : 'Remove', title: l.kind === 'pos' ? 'Close position' : l.kind === 'ord' ? 'Cancel order' : 'Remove', text: '×' })
      ]);
      chip.addEventListener('pointerdown', (e) => onChipDown(e, cell, inst, chip));
      const x = chip.querySelector('.stkpt-chip-x');
      if (x) { x.addEventListener('pointerdown', (e) => e.stopPropagation()); x.addEventListener('click', (e) => { e.stopPropagation(); onChipX(cell.symbol, chip.dataset.id); }); }
      chip.addEventListener('dblclick', (e) => { e.stopPropagation(); const k = chip.dataset.id; if (k.startsWith('o')) { const id = parseInt(k.slice(1), 10); const o = acct.state.orders.find((x2) => x2.id === id); if (o) openTicket({ modify: o }); } });
      ov.appendChild(chip);
    }
    have.delete(l.id);
    chip.dataset.kind = l.kind;
    chip.style.setProperty('--c', lineColor(l));
    const [a, b] = chipText(cell.symbol, l);
    const A = chip.querySelector('.stkpt-chip-a'), B = chip.querySelector('.stkpt-chip-b');
    if (A.textContent !== a) A.textContent = a;
    if (B.textContent !== b) B.textContent = b;
    if (l.kind === 'pos') { const p = acct.position(cell.symbol); chip.classList.toggle('neg', !!p && acct.openPnl(p) < 0); }
    chip.title = l.kind === 'pos' ? 'Drag up/down to add a take profit or stop loss' : l.kind === 'ord' ? 'Drag to move the order · double-click to edit' : 'Drag to move';
  }
  for (const [, chip] of have) chip.remove();
}
function livePnl(){
  if (!acct) return;
  for (const cell of cells()) {
    const inst = layerInst(inner(cell)); if (!inst || !inst.overlay) continue;
    const p = acct.position(cell.symbol);
    for (const chip of inst.overlay.querySelectorAll('.stkpt-chip[data-kind="pos"]')) {
      if (!p) continue;
      const v = money(acct.openPnl(p), true), B = chip.querySelector('.stkpt-chip-b');
      if (B.textContent !== v) B.textContent = v;
      chip.classList.toggle('neg', acct.openPnl(p) < 0);
    }
    const oc = inst.overlay.querySelector('.stkpt-1c'); if (oc) refreshOneClick(oc, cell);
  }
  renderSummaryLive();
}
function onChipX(sym, id){
  if (id === 'pos') return closePos(sym);
  if (id === 'ptp') return act(() => { acct.modifyPosition(sym, { tp: null }); return []; });
  if (id === 'psl') return act(() => { acct.modifyPosition(sym, { sl: null }); return []; });
  const m = /^o(\d+)(tp|sl)?$/.exec(id); if (!m) return;
  const oid = parseInt(m[1], 10);
  if (!m[2]) return cancelOrder(oid);
  return act(() => { acct.modifyOrder(oid, { [m[2]]: null }); return []; });
}
// DRAG TO MODIFY (TradingView-style): TP/SL/order chips move their line; releasing commits.
// Dragging the position chip into profit creates a take profit, into loss a stop loss.
function onChipDown(e, cell, inst, chip){
  if (e.button != null && e.button !== 0) return;
  const id = chip.dataset.id, sym = cell.symbol;
  const a = inst.args; if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const R = inner(cell);
  const canvas = R && R.input && R.input.el;
  const rect = (canvas || inst.overlay).getBoundingClientRect();
  const sp = specOf(sym); if (!sp.ok) return;
  const p = acct.position(sym);
  const startPrice = (() => { const l = linesFor(sym).find((x) => x.id === id); return l ? l.price : null; })();
  if (startPrice == null) return;
  Object.assign(drag, { on: true, sym, id, kind: 'move', price: startPrice, moved: false, y0: e.clientY });
  if (id === 'pos' && p) Object.assign(drag, { kind: 'new', id: 'new', side: p.side, ref: p.avg, qty: p.qty, newKind: 'tp' });
  try { chip.setPointerCapture(e.pointerId); } catch (e2) {}
  chip.classList.add('dragging');
  let raf = 0;
  const move = (ev) => {
    if (Math.abs(ev.clientY - drag.y0) < 3 && !drag.moved) return;
    drag.moved = true;
    const args = inst.args || a;
    const y = ev.clientY - rect.top;
    let price = args.coords.yToPrice(y, args.scale, args.bounds);
    price = PE.roundTick(price, sp.tick);
    drag.price = price;
    if (drag.kind === 'new') {
      const last = acct.last[sym] || p.avg, dir = p.side === 'buy' ? 1 : -1;
      drag.newKind = (price - last) * dir > 0 ? 'tp' : 'sl';
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; pushLines(); });
  };
  const up = () => {
    chip.removeEventListener('pointermove', move); chip.removeEventListener('pointerup', up); chip.removeEventListener('pointercancel', up);
    chip.classList.remove('dragging');
    const d = Object.assign({}, drag); drag.on = false;
    if (raf) cancelAnimationFrame(raf);
    if (!d.moved) { pushLines(true); return; }
    commitDrag(sym, d);
  };
  chip.addEventListener('pointermove', move); chip.addEventListener('pointerup', up); chip.addEventListener('pointercancel', up);
}
function commitDrag(sym, d){
  const r = (() => {
    if (d.kind === 'new') return act(() => { acct.modifyPosition(sym, { [d.newKind]: d.price }); return []; });
    if (d.id === 'ptp') return act(() => { acct.modifyPosition(sym, { tp: d.price }); return []; });
    if (d.id === 'psl') return act(() => { acct.modifyPosition(sym, { sl: d.price }); return []; });
    const m = /^o(\d+)(tp|sl)?$/.exec(d.id); if (!m) return null;
    const oid = parseInt(m[1], 10);
    return act(() => { acct.modifyOrder(oid, m[2] ? { [m[2]]: d.price } : { price: d.price }); return []; });
  })();
  if (r) toast('Paper ' + showSym(sym) + ': moved to ' + fmtP(sym, d.price), 'success');
  pushLines(true);
}

// ------------------------------------------------------------------ one-click trading (top-left of each chart)
function oneClickAll(){
  for (const cell of cells()) {
    const inst = layerInst(inner(cell)); if (!inst || !inst.overlay) continue;
    let oc = inst.overlay.querySelector('.stkpt-1c');
    const show = !!acct && acct.settings.oneClick && specOf(cell.symbol).ok;
    if (!show) { if (oc) oc.remove(); continue; }
    if (!oc) {
      oc = h('div', { class: 'stkpt-1c', role: 'group', 'aria-label': 'One-click paper trading' }, [
        h('button', { type: 'button', class: 'stkpt-1c-s', 'data-k': 'sell', title: 'Paper SELL at market (one click)' }, [h('small', { text: 'SELL' }), h('b')]),
        h('input', { class: 'stkpt-1c-q', type: 'number', min: '0', step: 'any', inputmode: 'decimal', 'aria-label': 'Quantity' }),
        h('button', { type: 'button', class: 'stkpt-1c-b', 'data-k': 'buy', title: 'Paper BUY at market (one click)' }, [h('small', { text: 'BUY' }), h('b')])
      ]);
      for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'dblclick']) oc.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' || ev === 'touchstart' });
      oc.querySelector('.stkpt-1c-s').onclick = () => oneClick(oc, 'sell');
      oc.querySelector('.stkpt-1c-b').onclick = () => oneClick(oc, 'buy');
      const q = oc.querySelector('input');
      q.addEventListener('change', () => { const sym = oc.dataset.sym; if (acct && sym) { syncFromLocal(); acct.setQty(sym, q.value); save(); q.value = acct.qtyFor(sym); } });
      q.addEventListener('keydown', (e) => e.stopPropagation());
      inst.overlay.appendChild(oc);
    }
    if (oc.dataset.sym !== cell.symbol) { oc.dataset.sym = cell.symbol; oc.querySelector('input').value = acct.qtyFor(cell.symbol); }
    oc.dataset.cell = cell.id;
    refreshOneClick(oc, cell);
    placeOneClick(oc, cell, inst.overlay);
  }
}
function refreshOneClick(oc, cell){
  const sym = cell.symbol, last = acct && acct.last[sym];
  const t = Number.isFinite(last) ? fmtP(sym, last) : '—';
  for (const b of oc.querySelectorAll('b')) if (b.textContent !== t) b.textContent = t;
}
// Under the legend's first row (symbol · interval · OHLC), like TradingView. Measured every 2 s
// (oneClickAll), not per tick, so the 250 ms price refresh never forces a layout.
function placeOneClick(oc, cell, ov){
  // Re-measure only when the cell size or its legend rows change: the full scan below forces a
  // layout, and running it every 2 s on every chart was a cost even with paper trading unused.
  let sig = '';
  try { sig = ov.clientWidth + 'x' + ov.clientHeight + ':' + cell.host.querySelectorAll('.vela-statusline ~ *, .vela-ind-fold *').length + ':' + (cell.symbol || ''); } catch (e) {}
  if (sig && oc.dataset.psig === sig) return;
  oc.dataset.psig = sig;
  let top = 30;
  try {
    const or = ov.getBoundingClientRect();
    // below every legend row of the price pane: the status line (symbol + OHLC), then the
    // indicator rows (Volume, …) and their fold toggle, which have no stable class
    let bottom = 0;
    for (const e of cell.host.querySelectorAll('.vela-statusline, .vela-statusline ~ *, .vela-ind-fold, .vela-ind-fold *')) {
      if (e.closest('.stkpt-ov, .vela-ws-toolbar, .vela-dtb, .vela-watermark')) continue;
      const r = e.getBoundingClientRect();
      if (!r.height || r.height > 40 || r.left < or.left || r.left - or.left > 260 || r.top - or.top > 140 || r.top < or.top) continue;
      bottom = Math.max(bottom, r.bottom);
    }
    for (const e of cell.host.querySelectorAll('div, span, button')) {
      if (bottom > 0 && e.childElementCount > 6) continue;
      if (e.closest('.stkpt-ov, .vela-ws-toolbar, .vela-dtb, .vela-watermark')) continue;
      const r = e.getBoundingClientRect();
      if (!r.height || r.height > 40 || r.width > 600 || r.left < or.left || r.left - or.left > 260 || r.top < or.top + 20 || r.top - or.top > 140) continue;
      if (!(e.textContent || '').trim() && !e.querySelector('svg')) continue;
      bottom = Math.max(bottom, r.bottom);
    }
    if (bottom) top = Math.max(26, Math.round(bottom - or.top) + 6);
  } catch (e) {}
  const v = top + 'px';
  if (oc.style.top !== v) oc.style.top = v;
}
function oneClick(oc, side){
  const sym = oc.dataset.sym; if (!sym) return;
  const q = parseFloat(oc.querySelector('input').value);
  placeOrder({ symbol: sym, side, type: 'market', qty: q });
}

// ------------------------------------------------------------------ order ticket
const tk = { side: 'buy', type: 'market', sym: '', modify: null, tpOn: false, slOn: false, tpUnit: 'ticks', slUnit: 'ticks' };
export function openTicket(pre){
  pre = pre || {};
  if (!acct) { toast('Paper trading is still loading.', 'info'); return; }
  const c = activeCell();
  if (pre.modify) {
    const o = pre.modify;
    Object.assign(tk, { modify: o.id, sym: o.symbol, side: o.side, type: o.type, tpOn: o.tp != null, slOn: o.sl != null, tpUnit: 'price', slUnit: 'price' });
  } else {
    Object.assign(tk, { modify: null, sym: pre.symbol || (c && c.symbol) || '', side: pre.side || tk.side, type: pre.type || 'market' });
  }
  const sp = specOf(tk.sym);
  if (!sp.ok) { toast(sp.reason, 'info'); return; }
  if (!ticket) buildTicket();
  const f = ticket.querySelector('form');
  f.qty.value = pre.modify ? pre.modify.qty : (pre.qty || acct.qtyFor(tk.sym));
  f.qty.step = sp.kind === 'futures' ? '1' : 'any';
  f.price.step = String(sp.tick);
  const last = acct.last[tk.sym];
  if (pre.modify) f.price.value = pre.modify.price;
  else if (pre.price != null) f.price.value = PE.roundTick(pre.price, sp.tick);
  else if (Number.isFinite(last)) f.price.value = PE.roundTick(last + (tk.type === 'stop' ? 1 : -1) * (tk.side === 'buy' ? 1 : -1) * 10 * sp.tick, sp.tick);
  f.tpv.value = pre.modify && pre.modify.tp != null ? pre.modify.tp : (tk.tpUnit === 'ticks' ? 40 : '');
  f.slv.value = pre.modify && pre.modify.sl != null ? pre.modify.sl : (tk.slUnit === 'ticks' ? 20 : '');
  if (!pre.modify) { f.tpu.value = tk.tpUnit; f.slu.value = tk.slUnit; } else { f.tpu.value = 'price'; f.slu.value = 'price'; }
  f.tpon.checked = tk.tpOn; f.slon.checked = tk.slOn;
  ticket.hidden = false;
  renderTicket();
  setTimeout(() => { try { f.qty.focus({ preventScroll: true }); f.qty.select(); } catch (e) {} }, 30);
}
function closeTicket(){ if (ticket) ticket.hidden = true; }
function buildTicket(){
  ticket = h('div', { id: 'stkpt-tk', hidden: true });
  ticket.innerHTML = `
  <div class="stkpt-tk-box" role="dialog" aria-modal="true" aria-labelledby="stkpt-tk-h">
    <div class="stkpt-tk-head"><div><h2 id="stkpt-tk-h">Paper order</h2><p class="stkpt-tag"></p></div><button type="button" class="stkpt-x" data-k="close" aria-label="Close">×</button></div>
    <form novalidate>
      <div class="stkpt-sides" role="radiogroup" aria-label="Side">
        <button type="button" class="stkpt-side stkpt-sell" data-side="sell" role="radio">Sell<small></small></button>
        <button type="button" class="stkpt-side stkpt-buy" data-side="buy" role="radio">Buy<small></small></button>
      </div>
      <div class="stkpt-types" role="tablist" aria-label="Order type">
        <button type="button" role="tab" data-type="market">Market</button><button type="button" role="tab" data-type="limit">Limit</button><button type="button" role="tab" data-type="stop">Stop</button>
      </div>
      <label class="stkpt-f stkpt-pricef">Price<input name="price" type="number" inputmode="decimal" step="any"></label>
      <label class="stkpt-f">Quantity<span class="stkpt-qrow"><button type="button" class="stkpt-step" data-q="-1" aria-label="Less">−</button><input name="qty" type="number" inputmode="decimal" min="0" step="any"><button type="button" class="stkpt-step" data-q="1" aria-label="More">+</button></span><small class="stkpt-qhint"></small></label>
      <div class="stkpt-br">
        <label class="stkpt-chk"><input type="checkbox" name="tpon"> Take profit</label>
        <span class="stkpt-brrow"><input name="tpv" type="number" inputmode="decimal" step="any" aria-label="Take profit value"><select name="tpu" aria-label="Take profit unit"><option value="ticks">Ticks</option><option value="price">Price</option><option value="usd">$</option></select></span>
        <small class="stkpt-brh" data-k="tp"></small>
        <label class="stkpt-chk"><input type="checkbox" name="slon"> Stop loss</label>
        <span class="stkpt-brrow"><input name="slv" type="number" inputmode="decimal" step="any" aria-label="Stop loss value"><select name="slu" aria-label="Stop loss unit"><option value="ticks">Ticks</option><option value="price">Price</option><option value="usd">$</option></select></span>
        <small class="stkpt-brh" data-k="sl"></small>
      </div>
      <p class="stkpt-sum"></p>
      <p class="stkpt-mk" role="status"></p>
      <button type="submit" class="stkpt-go"></button>
      <p class="stkpt-fine">Simulated fill on demo money. Nothing is sent to any broker. ${DISCLAIMER}</p>
    </form>
  </div>`;
  document.body.appendChild(ticket);
  ticket.querySelector('.stkpt-tag').textContent = LABEL;
  const f = ticket.querySelector('form');
  ticket.addEventListener('click', (e) => { if (e.target === ticket) closeTicket(); });
  ticket.querySelector('[data-k=close]').onclick = closeTicket;
  ticket.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeTicket(); });
  for (const b of ticket.querySelectorAll('[data-side]')) b.onclick = () => { if (tk.modify) return; tk.side = b.dataset.side; renderTicket(true); };
  for (const b of ticket.querySelectorAll('[data-type]')) b.onclick = () => { if (tk.modify) return; tk.type = b.dataset.type; renderTicket(true); };
  for (const b of ticket.querySelectorAll('[data-q]')) b.onclick = () => { const sp = specOf(tk.sym); const st = sp.kind === 'futures' ? 1 : Math.max(sp.minQty, (parseFloat(f.qty.value) || 0) >= 1 ? 1 : 0.01); f.qty.value = Math.max(sp.minQty, +((parseFloat(f.qty.value) || 0) + st * Number(b.dataset.q)).toFixed(4)); renderTicket(); };
  f.addEventListener('input', () => { tk.tpOn = f.tpon.checked; tk.slOn = f.slon.checked; renderTicket(); });
  f.tpu.addEventListener('change', () => { convertUnit(f, 'tp'); });
  f.slu.addEventListener('change', () => { convertUnit(f, 'sl'); });
  f.addEventListener('submit', (e) => { e.preventDefault(); submitTicket(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ticket && !ticket.hidden) closeTicket(); });
}
function entryRef(f){
  const last = acct.last[tk.sym];
  return tk.type === 'market' ? last : parseFloat(f.price.value);
}
// bracket input -> absolute price (null when off / invalid)
function bracketPrice(f, leg){
  const on = f[leg + 'on'].checked; if (!on) return null;
  const v = parseFloat(f[leg + 'v'].value); if (!Number.isFinite(v)) return NaN;
  const u = f[leg + 'u'].value, sp = specOf(tk.sym), ref = entryRef(f), qty = parseFloat(f.qty.value) || 0;
  if (u === 'price') return PE.roundTick(v, sp.tick);
  if (!Number.isFinite(ref)) return NaN;
  const dir = (tk.side === 'buy' ? 1 : -1) * (leg === 'tp' ? 1 : -1);
  if (u === 'ticks') return PE.roundTick(ref + dir * Math.abs(v) * sp.tick, sp.tick);
  if (!(qty > 0)) return NaN;
  return PE.roundTick(ref + dir * Math.abs(v) / (qty * sp.pointValue), sp.tick);
}
function convertUnit(f, leg){
  // keep the same level when the unit changes
  const prevUnit = leg === 'tp' ? tk.tpUnit : tk.slUnit;
  const newUnit = f[leg + 'u'].value;
  f[leg + 'u'].value = prevUnit;
  const p = bracketPrice(f, leg);
  f[leg + 'u'].value = newUnit;
  if (leg === 'tp') tk.tpUnit = newUnit; else tk.slUnit = newUnit;
  const sp = specOf(tk.sym), ref = entryRef(f), qty = parseFloat(f.qty.value) || 0;
  if (Number.isFinite(p) && p != null && Number.isFinite(ref)) {
    const dist = Math.abs(p - ref);
    f[leg + 'v'].value = newUnit === 'price' ? p : newUnit === 'ticks' ? Math.round(dist / sp.tick) : PE.round2(dist * qty * sp.pointValue);
  }
  renderTicket();
}
function renderTicket(retarget){
  if (!ticket || !acct) return;
  const f = ticket.querySelector('form'), sp = specOf(tk.sym), sym = tk.sym;
  const last = acct.last[sym];
  ticket.querySelector('#stkpt-tk-h').textContent = (tk.modify ? 'Modify paper order · ' : 'Paper order · ') + showSym(sym);
  for (const b of ticket.querySelectorAll('[data-side]')) { const on = b.dataset.side === tk.side; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.disabled = !!tk.modify && !on; b.querySelector('small').textContent = Number.isFinite(last) ? fmtP(sym, last) : '—'; }
  for (const b of ticket.querySelectorAll('[data-type]')) { const on = b.dataset.type === tk.type; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.disabled = !!tk.modify && !on; }
  if (retarget && tk.type !== 'market' && Number.isFinite(last)) f.price.value = PE.roundTick(last + (tk.type === 'stop' ? 1 : -1) * (tk.side === 'buy' ? 1 : -1) * 10 * sp.tick, sp.tick);
  ticket.querySelector('.stkpt-pricef').hidden = tk.type === 'market';
  const qty = parseFloat(f.qty.value) || 0;
  ticket.querySelector('.stkpt-qhint').textContent = sp.kind === 'futures' ? ('1 contract = ' + money(sp.pointValue) + ' per point · tick ' + sp.tick + ' = ' + money(sp.tick * sp.pointValue)) : 'Units of ' + showSym(sym) + ' · P&L in USD';
  const ref = entryRef(f);
  const tp = bracketPrice(f, 'tp'), sl = bracketPrice(f, 'sl');
  const hint = (leg, p) => {
    const el = ticket.querySelector('.stkpt-brh[data-k=' + leg + ']');
    const on = f[leg + 'on'].checked;
    f[leg + 'v'].disabled = !on; f[leg + 'u'].disabled = !on;
    if (!on) { el.textContent = ''; return; }
    if (!Number.isFinite(p) || !Number.isFinite(ref)) { el.textContent = 'Enter a value'; return; }
    el.textContent = '@ ' + fmtP(sym, p) + ' · ' + money(acct.bracketValue(sym, tk.side, qty, ref, p), true);
  };
  hint('tp', tp); hint('sl', sl);
  const risk = Number.isFinite(sl) && sl != null && Number.isFinite(ref) ? Math.abs(acct.bracketValue(sym, tk.side, qty, ref, sl)) : null;
  const rew = Number.isFinite(tp) && tp != null && Number.isFinite(ref) ? Math.abs(acct.bracketValue(sym, tk.side, qty, ref, tp)) : null;
  const notional = Number.isFinite(ref) ? ref * qty * sp.pointValue : null;
  ticket.querySelector('.stkpt-sum').textContent = [
    notional != null ? 'Notional ' + money(notional) : null,
    risk != null ? 'Risk ' + money(risk) : null,
    rew != null ? 'Reward ' + money(rew) : null,
    risk && rew ? 'R:R 1:' + (rew / risk).toFixed(2) : null
  ].filter(Boolean).join(' · ');
  const open = isOpen(sym, Date.now());
  const mk = ticket.querySelector('.stkpt-mk');
  mk.textContent = !Number.isFinite(last) ? 'Waiting for a price for ' + showSym(sym) + '…' : !open ? 'Market closed: market orders are rejected until it reopens; limit and stop orders wait and fill after the open.' : '';
  mk.hidden = !mk.textContent;
  const go = ticket.querySelector('.stkpt-go');
  go.className = 'stkpt-go ' + (tk.side === 'buy' ? 'buy' : 'sell');
  go.textContent = tk.modify ? 'Modify order' : (tk.side === 'buy' ? 'Buy ' : 'Sell ') + (qty || '') + ' ' + showSym(sym) + ' ' + (tk.type === 'market' ? 'Market' : (tk.type === 'limit' ? 'Limit' : 'Stop') + (Number.isFinite(parseFloat(f.price.value)) ? ' @ ' + fmtP(sym, parseFloat(f.price.value)) : ''));
}
function submitTicket(){
  const f = ticket.querySelector('form');
  const tp = bracketPrice(f, 'tp'), sl = bracketPrice(f, 'sl');
  if (Number.isNaN(tp) || Number.isNaN(sl)) { toast('Enter the take profit / stop loss, or untick them.', 'error'); return; }
  if (tk.modify) {
    const r = act(() => { acct.modifyOrder(tk.modify, { price: parseFloat(f.price.value), qty: parseFloat(f.qty.value), tp, sl }); return []; }, 'Paper order modified');
    if (r) closeTicket();
    return;
  }
  const o = { symbol: tk.sym, side: tk.side, type: tk.type, qty: parseFloat(f.qty.value), price: parseFloat(f.price.value), tp, sl };
  const r = placeOrder(o);
  if (r) { syncFromLocal(); acct.setQty(tk.sym, o.qty); save(); closeTicket(); }
}

// ------------------------------------------------------------------ right-click on the chart -> limit/stop at that price
const ctxAt = { cell: null, price: null };
function captureContext(e){
  ctxAt.cell = null; ctxAt.price = null;
  for (const cell of cells()) {
    if (!cell.host || !cell.host.contains(e.target)) continue;
    const inst = layerInst(inner(cell)); const a = inst && inst.args; if (!a) return;
    const R = inner(cell); const cv = R && R.input && R.input.el; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || x > a.coords.width || y < a.bounds.top || y > a.bounds.top + a.bounds.height) return;
    const sp = specOf(cell.symbol); if (!sp.ok) return;
    ctxAt.cell = cell; ctxAt.price = PE.roundTick(a.coords.yToPrice(y, a.scale, a.bounds), sp.tick);
    return;
  }
}
function ctxOrder(side){
  const cell = ctxAt.cell, price = ctxAt.price; if (!cell || price == null || !acct) return null;
  const sym = cell.symbol, last = acct.last[sym];
  if (!Number.isFinite(last)) return null;
  const type = side === 'buy' ? (price < last ? 'limit' : 'stop') : (price > last ? 'limit' : 'stop');
  return { symbol: sym, side, type, price, qty: acct.qtyFor(sym) };
}
function ctxLabel(side){
  const o = ctxOrder(side);
  if (!o) return side === 'buy' ? 'Paper buy…' : 'Paper sell…';
  return 'Paper ' + (side === 'buy' ? 'Buy ' : 'Sell ') + (o.type === 'limit' ? 'limit' : 'stop') + ' ' + o.qty + ' @ ' + fmtP(o.symbol, o.price);
}
function registerContextActions(){
  if (!CORE || !CORE.registerWidgetAction) return;
  const when = () => !!(ctxAt.cell && ctxAt.price != null && acct && Number.isFinite(acct.last[ctxAt.cell.symbol]));
  CORE.registerWidgetAction({ id: 'stryker.paper-buy', target: 'context:body', order: 900, get label(){ return ctxLabel('buy'); }, when,
    run: () => { const o = ctxOrder('buy'); if (o) placeOrder(o); } });
  CORE.registerWidgetAction({ id: 'stryker.paper-sell', target: 'context:body', order: 901, get label(){ return ctxLabel('sell'); }, when,
    run: () => { const o = ctxOrder('sell'); if (o) placeOrder(o); } });
  CORE.registerWidgetAction({ id: 'stryker.paper-ticket', target: 'context:body', order: 902, label: 'Paper order ticket…', when: () => !!ctxAt.cell,
    run: () => { const c = ctxAt.cell; openTicket({ symbol: c.symbol, type: 'limit', price: ctxAt.price }); } });
}

// ------------------------------------------------------------------ bottom panel
export function openPanel(tab){ ui.open = true; if (tab) ui.tab = tab; saveUi(); renderPanel(); }
function togglePanel(){ ui.open = !ui.open; saveUi(); renderPanel(); }
function buildPanel(){
  const main = document.querySelector('main.dash-main') || document.body;
  panel = h('section', { id: 'stkpt', class: 'stkpt', 'aria-label': 'Paper trading' });
  panel.innerHTML = `
    <div class="stkpt-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the Paper trading panel" tabindex="0" title="Drag to resize"></div>
    <div class="stkpt-head">
      <button type="button" class="stkpt-toggle" aria-expanded="false" aria-controls="stkpt-body"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg><b>Paper trading</b></button>
      <span class="stkpt-badge" title="${LABEL}">Demo</span>
      <span class="stkpt-hsum" aria-live="off"></span>
      <span class="stkpt-hsp"></span>
      <button type="button" class="stkpt-b stkpt-b-pri stkpt-trade" title="New paper order">Trade</button>
    </div>
    <div class="stkpt-body" id="stkpt-body">
      <div class="stkpt-tabs" role="tablist" aria-label="Paper trading">
        <button type="button" role="tab" data-tab="positions">Positions <i></i></button>
        <button type="button" role="tab" data-tab="orders">Orders <i></i></button>
        <button type="button" role="tab" data-tab="history">History</button>
        <button type="button" role="tab" data-tab="account">Account</button>
        <span class="stkpt-tabsp"></span>
        <button type="button" class="stkpt-b stkpt-flat" title="Close every paper position and cancel every order">Flatten all</button>
      </div>
      <div class="stkpt-view" role="tabpanel"></div>
      <p class="stkpt-foot"></p>
    </div>`;
  const chartPanel = main.querySelector('.stkchart-panel');
  if (chartPanel && chartPanel.nextSibling) main.insertBefore(panel, chartPanel.nextSibling); else main.appendChild(panel);
  panel.querySelector('.stkpt-foot').textContent = LABEL + '. Orders work only while a Charts tab is open in this browser; nothing runs on a server. No broker, no real orders. ' + DISCLAIMER;
  bindResize(panel.querySelector('.stkpt-grip'));
  applyPanelH();
  panel.querySelector('.stkpt-toggle').onclick = togglePanel;
  panel.querySelector('.stkpt-hsum').onclick = () => { if (!ui.open) togglePanel(); };
  panel.querySelector('.stkpt-trade').onclick = () => openTicket();
  panel.querySelector('.stkpt-flat').onclick = () => {
    if (!acct || (!Object.keys(acct.state.positions).length && !acct.state.orders.length)) { toast('Nothing to flatten.', 'info'); return; }
    if (window.confirm('Close every paper position and cancel every working paper order?')) flattenAll();
  };
  for (const b of panel.querySelectorAll('[data-tab]')) b.onclick = () => { ui.tab = b.dataset.tab; saveUi(); renderPanel(); };
  panel.addEventListener('keydown', (e) => e.stopPropagation());
}
function renderPanel(){
  if (!panel) return;
  const wasOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !!ui.open);
  applyPanelH();
  if (wasOpen !== !!ui.open) setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
  panel.querySelector('.stkpt-toggle').setAttribute('aria-expanded', ui.open ? 'true' : 'false');
  document.documentElement.classList.toggle('stkpt-sheet-open', !!ui.open && isPhone());
  for (const b of panel.querySelectorAll('[data-tab]')) { const on = b.dataset.tab === ui.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
  if (!acct) { panel.querySelector('.stkpt-view').textContent = 'Loading…'; return; }
  const np = Object.keys(acct.state.positions).length, no = acct.state.orders.length;
  panel.querySelector('[data-tab=positions] i').textContent = np ? String(np) : '';
  panel.querySelector('[data-tab=orders] i').textContent = no ? String(no) : '';
  renderSummaryLive();
  if (!ui.open) return;
  const v = panel.querySelector('.stkpt-view');
  v.textContent = '';
  if (ui.tab === 'orders') v.appendChild(viewOrders());
  else if (ui.tab === 'history') v.appendChild(viewHistory());
  else if (ui.tab === 'account') v.appendChild(viewAccount());
  else v.appendChild(viewPositions());
}
function renderSummaryLive(){
  if (!panel || !acct) return;
  const s = acct.summary(dayStart());
  const el = panel.querySelector('.stkpt-hsum');
  const parts = [['Equity', money(s.equity)], ['Open P&L', money(s.unrealized, true), s.unrealized], ['Day', money(s.dayPnl, true), s.dayPnl]];
  const sig = parts.map((p) => p[1]).join('|');
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig; el.textContent = '';
    for (const [k, val, n] of parts) el.appendChild(h('span', { class: n == null ? '' : n > 0 ? 'up' : n < 0 ? 'down' : '' }, [h('em', { text: k }), ' ' + val]));
  }
  if (ui.open && ui.tab === 'positions') {
    for (const row of panel.querySelectorAll('[data-sym]')) {
      const p = acct.position(row.dataset.sym); if (!p) continue;
      const pnl = acct.openPnl(p), c = row.querySelector('.pnl'), l = row.querySelector('.last');
      const t = money(pnl, true); if (c && c.textContent !== t) { c.textContent = t; c.className = 'pnl ' + (pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''); }
      const lt = fmtP(p.symbol, acct.last[p.symbol]); if (l && l.textContent !== lt) l.textContent = lt;
    }
  }
  if (ui.open && ui.tab === 'account') {
    const a = panel.querySelector('.stkpt-acct'); if (a) fillAccount(a, s);
  }
}
function table(head, rows, empty){
  const wrap = h('div', { class: 'stkpt-tw' });
  if (!rows.length) { wrap.appendChild(h('p', { class: 'stkpt-empty', text: empty })); return wrap; }
  const t = h('table', { class: 'stkpt-t' });
  t.appendChild(h('thead', null, [h('tr', null, head.map((x) => h('th', { text: x })))]));
  const tb = h('tbody'); rows.forEach((r) => tb.appendChild(r)); t.appendChild(tb);
  wrap.appendChild(t);
  return wrap;
}
const td = (txt, cls) => h('td', { class: cls || null, text: txt });
const sideTd = (side) => h('td', { class: side === 'buy' ? 'up' : 'down', text: side === 'buy' ? 'Long' : 'Short' });
function goSym(sym){ const c = activeCell(); try { if (c && c.symbol !== sym) (WS.cell(c.id) || c).setSymbol(sym); } catch (e) {} }
// Phone: a two-line card per row instead of a 9-column table (no sideways scroll).
function card(sym, l1, pnl, l2, acts){
  return h('div', { class: 'stkpt-card', 'data-sym': sym || null }, [
    h('div', { class: 'stkpt-card-l1' }, l1), pnl || h('span'),
    h('div', { class: 'stkpt-card-l2' }, l2), h('div', { class: 'stkpt-acts' }, acts)
  ]);
}
const kv2 = (k, v, cls) => h('span', { class: cls || null }, [k + ' ', h('b', { text: v })]);
function cards(list, empty){
  const w = h('div', { class: 'stkpt-cards' });
  if (!list.length) w.appendChild(h('p', { class: 'stkpt-empty', text: empty }));
  list.forEach((c) => w.appendChild(c));
  return w;
}
function viewPositions(){
  if (isPhone()) {
    return cards(Object.keys(acct.state.positions).map((k) => {
      const p = acct.state.positions[k], pnl = acct.openPnl(p);
      return card(k,
        [h('button', { type: 'button', class: 'stkpt-sym', text: showSym(k), onclick: () => goSym(k) }), h('span', { class: p.side === 'buy' ? 'up' : 'down', text: p.side === 'buy' ? 'Long' : 'Short' }), h('span', { class: 'q', text: p.qty + ' @ ' + fmtP(k, p.avg) })],
        h('span', { class: 'pnl ' + (pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''), text: money(pnl, true) }),
        [kv2('TP', p.tp != null ? fmtP(k, p.tp) : '—'), kv2('SL', p.sl != null ? fmtP(k, p.sl) : '—'), h('span', null, ['Last ', h('b', { class: 'last', text: fmtP(k, acct.last[k]) })])],
        [h('button', { type: 'button', class: 'stkpt-b', text: 'Reverse', onclick: () => reversePos(k) }), h('button', { type: 'button', class: 'stkpt-b', text: 'Close', onclick: () => closePos(k) })]);
    }), 'No open paper positions. Tap Trade to place one.');
  }
  const rows = Object.keys(acct.state.positions).map((k) => {
    const p = acct.state.positions[k], pnl = acct.openPnl(p);
    const tr = h('tr', { 'data-sym': k }, [
      h('td', null, [h('button', { type: 'button', class: 'stkpt-sym', title: 'Show on the chart', text: showSym(k), onclick: () => goSym(k) })]),
      sideTd(p.side), td(String(p.qty)), td(fmtP(k, p.avg)), td(fmtP(k, acct.last[k]), 'last'),
      td(p.tp != null ? fmtP(k, p.tp) : '—'), td(p.sl != null ? fmtP(k, p.sl) : '—'),
      td(money(pnl, true), 'pnl ' + (pnl > 0 ? 'up' : pnl < 0 ? 'down' : '')),
      h('td', { class: 'stkpt-acts' }, [
        h('button', { type: 'button', class: 'stkpt-b', text: 'Reverse', title: 'Flip to the other side at market', onclick: () => reversePos(k) }),
        h('button', { type: 'button', class: 'stkpt-b', text: 'Close', onclick: () => closePos(k) })
      ])
    ]);
    return tr;
  });
  return table(['Symbol', 'Side', 'Qty', 'Avg price', 'Last', 'Take profit', 'Stop loss', 'Open P&L', ''], rows, 'No open paper positions. Use Trade, the one-click Buy/Sell on the chart, or right-click the chart.');
}
function viewOrders(){
  if (isPhone()) {
    return cards(acct.state.orders.slice().sort((a, b) => b.placedAt - a.placedAt).map((o) => card(null,
      [h('button', { type: 'button', class: 'stkpt-sym', text: showSym(o.symbol), onclick: () => goSym(o.symbol) }), h('span', { class: o.side === 'buy' ? 'up' : 'down', text: (o.side === 'buy' ? 'Buy ' : 'Sell ') + (o.type === 'limit' ? 'limit' : 'stop') }), h('span', { class: 'q', text: o.qty + ' @ ' + fmtP(o.symbol, o.price) })],
      h('span', { class: 'pnl', text: isOpen(o.symbol, Date.now()) ? 'Working' : 'Waiting' }),
      [kv2('TP', o.tp != null ? fmtP(o.symbol, o.tp) : '—'), kv2('SL', o.sl != null ? fmtP(o.symbol, o.sl) : '—')],
      [h('button', { type: 'button', class: 'stkpt-b', text: 'Modify', onclick: () => openTicket({ modify: o }) }), h('button', { type: 'button', class: 'stkpt-b', text: 'Cancel', onclick: () => cancelOrder(o.id) })])), 'No working paper orders.');
  }
  const rows = acct.state.orders.slice().sort((a, b) => b.placedAt - a.placedAt).map((o) => h('tr', null, [
    h('td', null, [h('button', { type: 'button', class: 'stkpt-sym', text: showSym(o.symbol), onclick: () => goSym(o.symbol) })]),
    h('td', { class: o.side === 'buy' ? 'up' : 'down', text: o.side === 'buy' ? 'Buy' : 'Sell' }),
    td(o.type === 'limit' ? 'Limit' : 'Stop'), td(String(o.qty)), td(fmtP(o.symbol, o.price)),
    td(o.tp != null ? fmtP(o.symbol, o.tp) : '—'), td(o.sl != null ? fmtP(o.symbol, o.sl) : '—'),
    td(isOpen(o.symbol, Date.now()) ? 'Working' : 'Waiting (market closed)'),
    h('td', { class: 'stkpt-acts' }, [
      h('button', { type: 'button', class: 'stkpt-b', text: 'Modify', onclick: () => openTicket({ modify: o }) }),
      h('button', { type: 'button', class: 'stkpt-b', text: 'Cancel', onclick: () => cancelOrder(o.id) })
    ])
  ]));
  return table(['Symbol', 'Side', 'Type', 'Qty', 'Price', 'Take profit', 'Stop loss', 'Status', ''], rows, 'No working paper orders.');
}
function viewHistory(){
  const f = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const frag = h('div');
  const trades = acct.state.trades.slice().reverse().slice(0, 100);
  frag.appendChild(h('h3', { class: 'stkpt-h3', text: 'Closed trades' }));
  frag.appendChild(table(['Closed', 'Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'Exit by', 'Fees', 'P&L', ''], trades.map((t) => h('tr', null, [
    td(f.format(new Date(t.exitAt))), td(showSym(t.symbol)), sideTd(t.side), td(String(t.qty)), td(fmtP(t.symbol, t.entry)), td(fmtP(t.symbol, t.exit)),
    td({ tp: 'Take profit', sl: 'Stop loss', manual: 'Closed', reverse: 'Reversed' }[t.reason] || t.reason), td(money(t.fees)),
    td(money(t.pnl, true), t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : ''),
    h('td', { class: 'stkpt-acts' }, [t.journaled ? h('span', { class: 'stkpt-ok', text: '✓ Journal' }) : (uid ? h('button', { type: 'button', class: 'stkpt-b', text: 'Journal', title: 'Send to your Trade journal', onclick: () => sendToJournal(t.id) }) : null)])
  ])), 'No closed paper trades yet.'));
  const ev = acct.state.history.filter((x) => x.kind !== 'fill').slice().reverse().slice(0, 60);
  frag.appendChild(h('h3', { class: 'stkpt-h3', text: 'Cancelled, rejected and resets' }));
  frag.appendChild(table(['Time', 'Event', 'Symbol', 'Order', 'Note'], ev.map((x) => h('tr', null, [
    td(f.format(new Date(x.at))), td({ cancel: 'Cancelled', reject: 'Rejected', reset: 'Account reset' }[x.kind] || x.kind), td(x.symbol ? showSym(x.symbol) : '—'),
    td(x.side ? (x.side === 'buy' ? 'Buy ' : 'Sell ') + (x.type || '') + ' ' + (x.qty || '') + (x.price ? ' @ ' + fmtP(x.symbol, x.price) : '') : '—'), td(x.note || '')
  ])), 'Nothing yet.'));
  return frag;
}
function fillAccount(a, s){
  const set = (k, val, n) => { const el = a.querySelector('[data-v=' + k + ']'); if (!el) return; if (el.textContent !== val) el.textContent = val; if (n !== undefined) el.className = n > 0 ? 'up' : n < 0 ? 'down' : ''; };
  set('balance', money(s.balance)); set('equity', money(s.equity)); set('unrealized', money(s.unrealized, true), s.unrealized);
  set('realized', money(s.realized, true), s.realized); set('day', money(s.dayPnl, true), s.dayPnl); set('fees', money(s.fees)); set('start', money(s.startBalance));
  set('ret', ((s.equity - s.startBalance) / s.startBalance * 100).toFixed(2) + '%', s.equity - s.startBalance);
}
function viewAccount(){
  const s = acct.summary(dayStart()), st = acct.settings;
  const kv = (k, label) => h('div', { class: 'stkpt-kv' }, [h('em', { text: label }), h('b', { 'data-v': k })]);
  const a = h('div', { class: 'stkpt-acct' }, [
    h('div', { class: 'stkpt-kvs' }, [kv('balance', 'Balance'), kv('equity', 'Equity'), kv('unrealized', 'Unrealized P&L'), kv('realized', 'Realized P&L'), kv('day', 'Day P&L (since 00:00)'), kv('fees', 'Commissions'), kv('start', 'Starting balance'), kv('ret', 'Return on start')]),
    h('div', { class: 'stkpt-set' }, [
      h('h3', { class: 'stkpt-h3', text: 'Settings' }),
      h('label', { class: 'stkpt-f' }, ['Commission per contract / unit, per side ($)', h('input', { type: 'number', min: '0', max: '100', step: '0.01', 'data-s': 'commission', value: String(st.commission) })]),
      h('label', { class: 'stkpt-f' }, ['Market-order slippage (ticks)', h('input', { type: 'number', min: '0', max: '50', step: '1', 'data-s': 'slippage', value: String(st.slippage) })]),
      h('label', { class: 'stkpt-chk' }, [h('input', { type: 'checkbox', 'data-s': 'oneClick', checked: st.oneClick }), ' One-click Buy/Sell on the chart']),
      h('label', { class: 'stkpt-chk' }, [h('input', { type: 'checkbox', 'data-s': 'lines', checked: st.lines }), ' Position and order lines on the chart']),
      h('label', { class: 'stkpt-chk' }, [h('input', { type: 'checkbox', 'data-s': 'sounds', checked: st.sounds }), ' Sounds (fills, take profit, stop loss)']),
      h('label', { class: 'stkpt-chk' }, [h('input', { type: 'checkbox', 'data-s': 'askJournal', checked: st.askJournal }), ' Offer "Send to Journal" when a trade closes' + (uid ? '' : ' (sign in)')])
    ]),
    h('div', { class: 'stkpt-set' }, [
      h('h3', { class: 'stkpt-h3', text: 'Reset account' }),
      h('label', { class: 'stkpt-f' }, ['Starting balance (USD)', h('input', { type: 'number', min: String(PE.MIN_BALANCE), max: String(PE.MAX_BALANCE), step: '1000', 'data-k': 'bal', value: String(acct.state.startBalance) })]),
      h('button', { type: 'button', class: 'stkpt-b stkpt-b-warn', 'data-k': 'reset', text: 'Reset account' }),
      h('p', { class: 'stkpt-note', text: 'Reset closes nothing at the market: it wipes positions, orders and history and starts again at this balance. ' + (uid ? 'Saved to your account.' : 'Saved in this browser. Sign in to keep it on your account.') })
    ])
  ]);
  fillAccount(a, s);
  for (const inp of a.querySelectorAll('[data-s]')) {
    inp.addEventListener('change', () => {
      const k = inp.dataset.s; syncFromLocal(); acct.setSettings({ [k]: inp.type === 'checkbox' ? inp.checked : inp.value });
      save(); pushLines(true); renderPanel();
    });
  }
  a.querySelector('[data-k=reset]').onclick = () => {
    const bal = parseFloat(a.querySelector('[data-k=bal]').value);
    if (!(bal >= PE.MIN_BALANCE && bal <= PE.MAX_BALANCE)) { toast('Pick a starting balance between $' + PE.MIN_BALANCE.toLocaleString() + ' and $' + PE.MAX_BALANCE.toLocaleString() + '.', 'error'); return; }
    if (!window.confirm('Reset the paper account to ' + money(bal) + '? Positions, orders and history are wiped.')) return;
    syncFromLocal(); acct.reset(bal); tracks.clear(); save(); renderAll(); toast('Paper account reset to ' + money(bal), 'success');
  };
  return a;
}

// ------------------------------------------------------------------ toolbar button
function mountToolbar(bar){
  if (!bar || document.getElementById('stkc-paper-btn')) return;
  const b = h('button', { type: 'button', id: 'stkc-paper-btn', class: 'stkc-btn', title: 'Paper trading (demo money, simulated fills)', 'aria-label': 'Paper trading: new order' });
  b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg><span class="stkc-btn-l">Trade</span>';
  b.onclick = () => openTicket();
  bar.insertBefore(b, bar.firstChild);
}

function renderAll(){ pushLines(); renderPanel(); if (ticket && !ticket.hidden) renderTicket(); }

const CSS = `
.stkpt{ flex:none; margin:0; padding:0; min-height:0; max-width:none; border-radius:0; position:relative; z-index:35; display:flex; flex-direction:column; background:var(--bg-0); border-top:1px solid var(--line-soft); color:var(--ink-1); font:13px/1.4 var(--font-body, Archivo, system-ui, sans-serif); }
.stkpt-head{ display:flex; align-items:center; gap:10px; min-height:36px; padding:3px 8px; min-width:0; }
.stkpt-toggle{ display:inline-flex; align-items:center; gap:6px; border:0; background:none; color:var(--ink-0); font:inherit; cursor:pointer; padding:4px 6px; border-radius:6px; white-space:nowrap; }
.stkpt-toggle svg{ transition:transform .18s ease; }
.stkpt.open .stkpt-toggle svg{ transform:rotate(180deg); }
.stkpt-toggle:hover{ background:var(--bg-2); }
.stkpt-badge{ font:700 10px/1 var(--font-mono, monospace); letter-spacing:.06em; text-transform:uppercase; color:#f7a600; border:1px solid rgba(247,166,0,.45); border-radius:999px; padding:3px 7px; }
.stkpt-hsum{ display:flex; gap:14px; min-width:0; overflow:hidden; white-space:nowrap; font-family:var(--font-mono, monospace); font-size:12px; cursor:default; }
.stkpt-hsum em{ font-style:normal; color:var(--ink-3); font-family:var(--font-body, sans-serif); }
.stkpt .up{ color:#089981; } .stkpt .down{ color:#f23645; }
.stkpt-hsp,.stkpt-tabsp{ flex:1; }
.stkpt-b{ display:inline-flex; align-items:center; justify-content:center; height:28px; padding:0 11px; border:1px solid var(--line); border-radius:7px; background:transparent; color:var(--ink-1); font:600 12px/1 var(--font-body, sans-serif); cursor:pointer; white-space:nowrap; }
.stkpt-b:hover{ border-color:var(--gold); color:var(--ink-0); }
.stkpt-b-pri{ background:#03c988; border-color:#03c988; color:#07110d; }
.stkpt-b-pri:hover{ background:#05dd97; color:#07110d; }
.stkpt-b-warn{ border-color:rgba(242,54,69,.55); color:#f23645; }
.stkpt-body{ display:none; flex-direction:column; height:var(--stkpt-h, 180px); min-height:0; border-top:1px solid var(--line-soft); }
.stkpt-grip{ display:none; position:absolute; left:0; right:0; top:-4px; height:8px; cursor:ns-resize; z-index:2; touch-action:none; }
.stkpt.open .stkpt-grip{ display:block; }
.stkpt-grip::after{ content:""; position:absolute; left:50%; top:3px; width:36px; height:3px; margin-left:-18px; border-radius:2px; background:var(--line); opacity:0; transition:opacity .15s; }
.stkpt-grip:hover::after,.stkpt-grip:focus-visible::after,.stkpt.resizing .stkpt-grip::after{ opacity:1; background:#03c988; }
.stkpt.resizing{ user-select:none; }
#stkpt-toasts{ position:absolute; left:12px; bottom:34px; z-index:30; display:flex; flex-direction:column; gap:6px; max-width:min(340px, calc(100% - 110px)); pointer-events:none; }
.stkpt-toast{ pointer-events:auto; display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:8px; background:rgba(19,23,34,.94); color:#d1d4dc; border:1px solid var(--line); font:500 12px/1.35 var(--font-body, sans-serif); box-shadow:0 6px 18px rgba(0,0,0,.4); cursor:pointer; animation:stkpt-in .18s ease; transition:opacity .2s; }
.stkpt-toast.out{ opacity:0; }
.stkpt-toast i{ flex:none; width:7px; height:7px; border-radius:50%; background:#03c988; }
.stkpt-toast.error i{ background:#f23645; } .stkpt-toast.info i{ background:#f7a600; }
.stkpt-toast span{ min-width:0; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
:root[data-theme="light"] .stkpt-toast{ background:rgba(255,255,255,.96); color:#131722; }
@keyframes stkpt-in{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:none; } }
/* phone position / order cards (two lines, no sideways scroll) */
.stkpt-cards{ display:flex; flex-direction:column; }
.stkpt-card{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 10px; padding:8px 2px; border-bottom:1px solid var(--line-soft); align-items:center; }
.stkpt-card-l1{ display:flex; align-items:baseline; gap:6px; min-width:0; white-space:nowrap; overflow:hidden; font-size:12.5px; }
.stkpt-card-l1 .q{ font-family:var(--font-mono, monospace); font-size:12px; color:var(--ink-2); overflow:hidden; text-overflow:ellipsis; }
.stkpt-card .pnl{ font:600 13px var(--font-mono, monospace); text-align:right; }
.stkpt-card-l2{ font:11.5px var(--font-mono, monospace); color:var(--ink-3); min-width:0; display:flex; flex-wrap:wrap; gap:2px 10px; }
.stkpt-card-l2 b{ font-weight:500; color:var(--ink-1); }
.stkpt-card .stkpt-acts{ display:flex; gap:6px; justify-content:flex-end; }
.stkpt.open .stkpt-body{ display:flex; }
.stkpt-tabs{ flex:none; display:flex; align-items:center; gap:2px; padding:4px 8px; border-bottom:1px solid var(--line-soft); overflow-x:auto; }
.stkpt-tabs [role=tab]{ border:0; background:none; color:var(--ink-2); font:600 12.5px/1 var(--font-body, sans-serif); padding:8px 10px; border-radius:6px; cursor:pointer; white-space:nowrap; }
.stkpt-tabs [role=tab] i{ font-style:normal; color:var(--ink-3); margin-left:2px; }
.stkpt-tabs [role=tab].on{ color:var(--ink-0); background:var(--bg-2); box-shadow:inset 0 -2px 0 #03c988; }
.stkpt-view{ flex:1 1 auto; min-height:0; overflow:auto; padding:6px 8px; }
.stkpt-foot{ flex:none; margin:0; padding:4px 10px; font-size:10.5px; color:var(--ink-3); border-top:1px solid var(--line-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkpt-tw{ overflow-x:auto; }
.stkpt-t{ width:100%; border-collapse:collapse; font-size:12.5px; white-space:nowrap; }
.stkpt-t th{ text-align:left; font-weight:600; font-size:11px; color:var(--ink-3); padding:6px 8px; border-bottom:1px solid var(--line-soft); position:sticky; top:0; background:var(--bg-0); }
.stkpt-t td{ padding:6px 8px; border-bottom:1px solid var(--line-soft); font-family:var(--font-mono, monospace); font-size:12px; }
.stkpt-t td.stkpt-acts{ text-align:right; display:flex; gap:6px; justify-content:flex-end; font-family:inherit; }
.stkpt-sym{ border:0; background:none; color:var(--ink-0); font:600 12.5px var(--font-body, sans-serif); cursor:pointer; padding:0; }
.stkpt-sym:hover{ color:#03c988; }
.stkpt-ok{ color:#089981; font-size:12px; }
.stkpt-empty{ color:var(--ink-3); margin:14px 4px; }
.stkpt-h3{ margin:10px 4px 4px; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); }
.stkpt-acct{ display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr); gap:14px; }
.stkpt-kvs{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; align-content:start; }
.stkpt-kv{ display:flex; flex-direction:column; gap:2px; background:var(--bg-1); border:1px solid var(--line-soft); border-radius:10px; padding:8px 10px; }
.stkpt-kv em{ font-style:normal; font-size:11px; color:var(--ink-3); }
.stkpt-kv b{ font:600 14px var(--font-mono, monospace); color:var(--ink-0); }
.stkpt-kv b.up{ color:#089981; } .stkpt-kv b.down{ color:#f23645; }
.stkpt-set{ display:flex; flex-direction:column; gap:8px; }
.stkpt-f{ display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--ink-2); }
.stkpt-f[hidden]{ display:none; }
.stkpt input[type=number],#stkpt-tk input[type=number],#stkpt-tk select{ background:var(--bg-1); color:var(--ink-0); border:1px solid var(--line); border-radius:8px; padding:7px 9px; font:13px var(--font-mono, monospace); min-width:0; }
.stkpt-chk{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--ink-1); cursor:pointer; }
.stkpt-chk input{ accent-color:#03c988; width:15px; height:15px; margin:0; }
.stkpt-note{ font-size:11.5px; color:var(--ink-3); margin:0; }
#stkpt-offers{ position:fixed; left:50%; transform:translateX(-50%); bottom:calc(var(--stkc-dock, 0px) + 56px); z-index:9050; display:flex; flex-direction:column; gap:8px; width:min(520px, calc(100vw - 24px)); }
.stkpt-offer{ display:flex; align-items:center; gap:10px; background:var(--bg-2); color:var(--ink-0); border:1px solid rgba(3,201,136,.4); border-radius:12px; padding:9px 10px 9px 12px; box-shadow:0 12px 30px rgba(0,0,0,.45); font:13px/1.35 var(--font-body, sans-serif); }
.stkpt-offer span{ flex:1; min-width:0; }
.stkpt-x{ border:0; background:none; color:inherit; font-size:20px; line-height:1; cursor:pointer; padding:2px 6px; }
/* on-chart */
.stkpt-ov{ position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:5; }
.stkpt-chip{ position:absolute; top:0; right:64px; height:22px; display:flex; align-items:stretch; pointer-events:auto; cursor:ns-resize; user-select:none; touch-action:none;
  font:600 11px/22px -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,sans-serif; border:1px solid var(--c); border-radius:4px; overflow:hidden; background:#131722; color:#d1d4dc; box-shadow:0 1px 4px rgba(0,0,0,.35); will-change:transform; }
:root[data-theme="light"] .stkpt-chip{ background:#fff; color:#131722; }
.stkpt-chip-a{ background:var(--c); color:#fff; padding:0 7px; white-space:nowrap; }
.stkpt-chip-b{ padding:0 7px; white-space:nowrap; font-family:var(--font-mono, monospace); font-weight:500; }
.stkpt-chip[data-kind="pos"] .stkpt-chip-b{ color:#089981; }
.stkpt-chip[data-kind="pos"].neg .stkpt-chip-b{ color:#f23645; }
.stkpt-chip-x{ border:0; border-left:1px solid var(--c); background:none; color:inherit; width:22px; padding:0; cursor:pointer; font-size:14px; line-height:20px; }
.stkpt-chip-x:hover{ background:var(--c); color:#fff; }
.stkpt-chip[data-pin=up] .stkpt-chip-a::before{ content:"↑ "; }
.stkpt-chip[data-pin=down] .stkpt-chip-a::before{ content:"↓ "; }
.stkpt-chip[data-pin=up],.stkpt-chip[data-pin=down]{ border-style:dashed; opacity:.92; }
.stkpt-chip.dragging{ box-shadow:0 0 0 2px var(--c); }
.stkpt-chip[data-kind="new"],.stkpt-chip[data-id="new"]{ opacity:.85; }
.stkpt-1c{ position:absolute; left:8px; top:30px; display:flex; align-items:stretch; height:36px; pointer-events:auto; border-radius:6px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.35); font-family:-apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,sans-serif; }
.stkpt-1c button{ border:0; min-width:74px; padding:0 8px; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; color:#fff; line-height:1.1; }
.stkpt-1c small{ font-size:10px; font-weight:700; letter-spacing:.05em; opacity:.92; }
.stkpt-1c b{ font:600 12px var(--font-mono, monospace); }
.stkpt-1c-s{ background:#f23645; } .stkpt-1c-s:hover{ background:#ff4a57; }
.stkpt-1c-b{ background:#2962ff; } .stkpt-1c-b:hover{ background:#3d73ff; }
.stkpt-1c-q{ width:58px; border:0; border-radius:0 !important; text-align:center; background:#1e222d !important; color:#d1d4dc !important; font:600 13px var(--font-mono, monospace) !important; padding:0 4px !important; -moz-appearance:textfield; }
:root[data-theme="light"] .stkpt-1c-q{ background:#fff !important; color:#131722 !important; }
.stkpt-1c-q::-webkit-outer-spin-button,.stkpt-1c-q::-webkit-inner-spin-button{ -webkit-appearance:none; margin:0; }
/* ticket */
#stkpt-tk{ position:fixed; inset:0; z-index:9000; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:16px; }
#stkpt-tk[hidden]{ display:none; }
.stkpt-tk-box{ width:min(400px,100%); max-height:calc(100dvh - 32px); overflow:auto; background:var(--bg-1, #0b0b0d); color:var(--ink-1); border:1px solid var(--line); border-radius:16px; padding:14px 16px 12px; box-shadow:0 24px 80px rgba(0,0,0,.6); font:13px/1.4 var(--font-body, sans-serif); }
.stkpt-tk-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.stkpt-tk-head h2{ margin:0; font-size:16px; color:var(--ink-0); }
.stkpt-tag{ margin:2px 0 0; font-size:11px; color:#f7a600; }
#stkpt-tk form{ display:flex; flex-direction:column; gap:10px; margin-top:10px; }
.stkpt-sides{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stkpt-side{ display:flex; flex-direction:column; align-items:center; gap:2px; padding:8px; border-radius:10px; border:1px solid var(--line); background:transparent; color:var(--ink-1); font:700 14px var(--font-body, sans-serif); cursor:pointer; }
.stkpt-side small{ font:500 12px var(--font-mono, monospace); opacity:.85; }
.stkpt-sell.on{ background:#f23645; border-color:#f23645; color:#fff; }
.stkpt-buy.on{ background:#2962ff; border-color:#2962ff; color:#fff; }
.stkpt-side:disabled,.stkpt-types button:disabled{ opacity:.35; cursor:default; }
.stkpt-types{ display:grid; grid-template-columns:repeat(3,1fr); background:var(--bg-2); border-radius:9px; padding:3px; gap:3px; }
.stkpt-types button{ border:0; background:none; color:var(--ink-2); padding:7px 0; border-radius:7px; font:600 12.5px var(--font-body, sans-serif); cursor:pointer; }
.stkpt-types button.on{ background:var(--bg-0); color:var(--ink-0); box-shadow:0 1px 3px rgba(0,0,0,.35); }
.stkpt-qrow{ display:flex; gap:6px; }
.stkpt-qrow input{ flex:1; text-align:center; }
.stkpt-step{ width:36px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--ink-0); font-size:16px; cursor:pointer; }
.stkpt-qhint,.stkpt-brh{ font-size:11px; color:var(--ink-3); }
.stkpt-br{ display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; align-items:center; }
.stkpt-brrow{ display:flex; gap:6px; min-width:0; }
.stkpt-brrow input{ flex:1; width:0; }
.stkpt-brrow select{ flex:none; width:78px; }
.stkpt-brh{ grid-column:2; margin-top:-3px; }
.stkpt-sum{ margin:0; font-size:12px; color:var(--ink-2); min-height:16px; }
.stkpt-mk{ margin:0; font-size:12px; color:#f7a600; }
.stkpt-mk[hidden]{ display:none; }
.stkpt-go{ height:42px; border:0; border-radius:10px; color:#fff; font:700 14px var(--font-body, sans-serif); cursor:pointer; }
.stkpt-go.buy{ background:#2962ff; } .stkpt-go.sell{ background:#f23645; }
.stkpt-fine{ margin:0; font-size:11px; color:var(--ink-3); text-align:center; }
@media (max-width:980px){ .stkpt-acct{ grid-template-columns:1fr 1fr; } .stkpt-kvs{ grid-column:1/-1; grid-template-columns:repeat(4,minmax(0,1fr)); } }
/* phone: a thumb-friendly bottom sheet */
@media (max-width:700px){
  .stkpt-head{ min-height:40px; gap:8px; padding:2px 8px; }
  .stkpt:not(.open) .stkpt-trade{ height:30px; }
  #stkc-paper-btn{ display:none; }
  #stkpt-toasts{ left:8px; top:132px; bottom:auto; max-width:calc(100% - 90px); }
  .stkpt-toast{ font-size:11.5px; padding:5px 9px; }
  .stkpt-badge{ display:none; }
  .stkpt-hsum{ gap:10px; font-size:11.5px; flex:1 1 auto; }
  .stkpt-hsum span:nth-child(n+2){ display:none; }
  .stkpt-tabs{ gap:0; padding:4px 4px; }
  .stkpt-tabs [role=tab]{ padding:11px 8px; }
  .stkpt-flat{ padding:0 9px; }
  .stkpt-hsp{ display:none; }
  .stkpt-trade{ height:34px; padding:0 14px; }
  .stkpt-view{ padding:2px 10px; }
  .stkpt.open{ position:fixed; left:0; right:0; bottom:var(--stkc-dock, 0px); z-index:8800; max-height:72dvh; border-radius:16px 16px 0 0; border:1px solid var(--line); box-shadow:0 -18px 50px rgba(0,0,0,.55); }
  .stkpt.open .stkpt-head::before{ content:""; position:absolute; left:50%; top:5px; width:38px; height:4px; margin-left:-19px; border-radius:2px; background:var(--line); }
  .stkpt-body{ height:min(56dvh, 460px); }
  .stkpt-tabs [role=tab]{ padding:11px 12px; }
  .stkpt-b{ height:36px; padding:0 13px; }
  .stkpt-acct{ grid-template-columns:1fr; }
  .stkpt-kvs{ grid-template-columns:1fr 1fr; }
  .stkpt-foot{ white-space:normal; }
  #stkpt-tk{ align-items:flex-end; padding:0; }
  .stkpt-tk-box{ width:100%; border-radius:18px 18px 0 0; max-height:92dvh; padding-bottom:calc(14px + env(safe-area-inset-bottom)); }
  .stkpt-go{ height:48px; }
  .stkpt-1c{ height:34px; top:28px; }
  .stkpt-1c button{ min-width:62px; }
  .stkpt-1c-q{ width:46px; }
  .stkpt-chip{ right:58px; }
  #stkc-paper-btn .stkc-btn-l{ display:none; }
}
@media (prefers-reduced-motion:reduce){ .stkpt-toggle svg{ transition:none; } }
`;

// ------------------------------------------------------------------ install / mount
export function installPaper(Core){
  CORE = Core;
  try { Core.registerRendererLayer({ id: LAYER, placement: 'above-data', create: layerFactory }); } catch (e) { console.warn('TradeZoro paper: layer', e); }
  try { registerContextActions(); } catch (e) { console.warn('TradeZoro paper: context menu', e); }
}
export function mountPaper(ws, opts){
  if (!PE) { console.warn('TradeZoro paper: engine missing'); return; }
  WS = ws; toastFn = (opts && opts.toast) || null;
  if (!document.getElementById('stkpt-css')) { const st = document.createElement('style'); st.id = 'stkpt-css'; st.textContent = CSS; document.head.appendChild(st); }
  buildPanel();
  mountToolbar(opts && opts.bar);
  renderPanel();
  window.addEventListener('contextmenu', captureContext, true);
  window.addEventListener('resize', () => renderPanel(), { passive: true });
  leaderTick();
  setInterval(leaderTick, LEADER_MS);
  setInterval(poll, POLL_MS);
  setInterval(feedOffChart, FEED_MS);
  setInterval(() => pushLines(), 2000);       // new cells / symbol switches pick up their lines
  try { ws.on('state:changed', () => setTimeout(() => pushLines(true), 0)); } catch (e) {}
  try { ws.on('layout:changed', () => setTimeout(() => pushLines(true), 0)); } catch (e) {}
  let started = false;
  const start = () => { if (started) return; started = true; load(); };
  try { firebase.auth().onAuthStateChanged(() => { started = true; load(); }); } catch (e) { start(); }
  setTimeout(start, 4000);                    // no auth answer: run as a guest
  window.__stkPaper = {
    get account(){ return acct; }, get leader(){ return leader; }, get uid(){ return uid; },
    openTicket, openPanel, placeOrder, closePos, reversePos, flattenAll, cancelOrder, poll, pushLines, sendToJournal,
    ctxAt, ctxOrder, commitDrag, label: LABEL, toasts: toastLog, get saves(){ return { saves: saveCount, pushes: cloudPushes, busy: cloudBusy, pending: cloudFirstPending }; }
  };
}
