// TradeZoro — LIVE broker orders from ZoroCharts (ES module). ADMIN ONLY (Owner order 2026-11-15: "why we testing on journalX, why not
// on charts?"). Loaded by assets/chart-paper.js only after the signed-in user's admins/{uid} doc exists; the server
// (functions/connect/finatic/order.js + data.js) re-checks admin on every call and refuses everyone else with 403.
//
// What it adds to the Paper trading panel: an account picker (Paper = default, every reload starts on Paper; plus the admin's connected
// broker accounts, "Tradovate …1234"; plus "Connect a broker…", which opens the SAME connect flow as JournalX: finatic-journal-ui.js).
// With a live account picked: a big red LIVE badge in the panel and on every chart; the panel shows an order form (Buy/Sell, Market/
// Limit, 1 or 2 contracts), the live position (P&L from the chart's last price x the contract's point value) and working orders (Cancel);
// the chart draws the position and working-order lines (drag a working order = modify, or cancel + new when the broker can't modify);
// DOM ladder clicks (assets/chart-book-panel.js) send LIMIT orders at the clicked price (a click at/through the touch is a marketable
// limit, never a market order). Every paper surface that could be mistaken for live is switched off meanwhile (chart-paper.js).
//
// SAFETY (advisor-reviewed design, 2026-11-15):
// - Symbols: only NQ1!/ES1!/MNQ1!/MES1! charts; front-month contract (assets/chart-live-core.js), the held contract wins; shown in every
//   confirm. The server re-checks the contract list.
// - Confirm: the FIRST order for an account+contract in this page session needs the contract code typed; every order then needs a
//   confirm tap. "Skip the tap for this session" can be ticked after the typed confirm; it never applies to flatten, drag moves or
//   cancel+new, and it is cleared by a reject, an unknown result, an account switch or a reload.
// - Reads: positions + orders every POLL_MS while live is picked and the tab is visible, and right after every write. New orders are
//   blocked unless a read STARTED after the last write and is younger than STALE_MS; an unknown write result blocks until a read lands.
// - One write in flight at a time. Every write carries a fresh idempotency key (= the server's audit doc id: a repeat is refused).
//   Flatten runs on the server with a key derived from the read it was based on, so a double tap is one flatten.
// - One live tab per account (Web Locks). Idle 15 min or hidden 2 min -> back to Paper. Kill switch: "Turn off live trading" writes
//   settings/liveTrading {enabled:false}; the server refuses live writes while it is off.
// - Qty cap 2 contracts and max 2 contracts worst-case exposure: server-side (order.js), also enforced here.
// Tests: tests/finatic/chart-live.test.mjs (core + server, mocked broker), tools/tests/chart-live-browser.js (mocked endpoints only).
// Education only. Not financial advice.
import * as L from './chart-live-core.js?v=1057';

const POLL_MS = 10000, STALE_MS = 25000, IDLE_MS = 15 * 60000, HIDDEN_MS = 2 * 60000;
const DISCLAIMER = 'Education only. Not financial advice.';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n, sign) => { if (n == null || !Number.isFinite(n)) return '—'; const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + '$' + s; };
const px = (n) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14));
const TEST = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? window.__stkLiveTest : null;   // test hooks: localhost only
const now = () => (TEST && TEST.now ? TEST.now() : Date.now());

let P = null, uid = '', toastFn = null;
const S = {
  accounts: [], acct: null, userId: '', env: null, loaded: false, loadErr: '',
  data: { positions: [], orders: [] }, lastOkStart: 0, lastWriteAt: 0, unknown: false, readErr: '', reading: false,
  busy: false, typed: new Set(), skip: false, form: { side: 'buy', type: 'market', qty: 1, price: '' }, modifyOk: null,
  placeSchema: null, placeErr: '', killed: null, lastAct: Date.now(), hiddenAt: 0, lock: null, msg: ''
};
window.__stkLive = { get state() { return S; } };

function toast(m, type) { try { if (toastFn) toastFn(m, type || 'info'); else if (window.showToast) window.showToast(type === 'error' ? 'error' : type === 'success' ? 'success' : 'info', m); } catch (e) {} }
const lsUserKey = () => 'stryker_broker_sync_user_' + uid;
const lsUser = () => { try { return localStorage.getItem(lsUserKey()) || ''; } catch (e) { return ''; } };

async function call(url, body) {
  let t; try { t = await firebase.auth().currentUser.getIdToken(); } catch (e) { const er = new Error('Sign in again.'); er.status = 401; throw er; }
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body), cache: 'no-store' }); }
  catch (e) { const er = new Error('No answer from TradeZoro.'); er.status = 0; er.network = true; throw er; }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error((j && j.error) || 'Request failed (code ' + r.status + ').'); e.status = r.status; e.code = j && j.code; e.needsConnect = !!(j && j.needsConnect); throw e; }
  return j || {};
}
const data = (op, extra) => call('/connect/finatic/data', Object.assign({ op, userId: S.userId }, extra || {}));
const order = (b) => call('/connect/finatic/order', Object.assign({ src: 'chart', userId: S.userId, accountId: S.acct.id }, b));

// ------------------------------------------------------------------------------------------ accounts
async function loadAccounts() {
  S.userId = lsUser(); S.loadErr = '';
  if (!S.userId) { S.accounts = []; S.loaded = true; render(); return; }
  try {
    const r = await data('accounts');
    if (r.userId && r.userId !== S.userId) { S.userId = r.userId; try { localStorage.setItem(lsUserKey(), r.userId); } catch (e) {} }
    S.accounts = (Array.isArray(r.data) ? r.data : []).map((x) => {
      const id = x.accountId || x.id; const lb = L.acctLabel({ broker: x.brokerName || x.brokerId || x.institutionName, number: x.accountNumber || x.brokerAccountId || x.accountName || x.name, id });
      return { id, label: lb.text, broker: lb.broker, last4: lb.last4, name: x.accountName || x.name || '' };
    }).filter((a) => a.id);
  } catch (e) { S.accounts = []; if (!e.needsConnect) S.loadErr = e.message; }
  S.loaded = true; render();
}
function connect() {
  import('./finatic-journal-ui.js?v=1057').then((m) => m.openBrokerSync({ uid, mode: 'chart', onConnected: () => { loadAccounts().then(() => toast('Broker connected. Pick the account in the panel.', 'success')); } }))
    .catch(() => toast('Could not open the broker connection.', 'error'));
}

// ------------------------------------------------------------------------------------------ pick / leave live
export const active = () => !!S.acct;
async function pick(id) {
  if (!id) return leave();
  const a = S.accounts.find((x) => x.id === id); if (!a) return;
  if (S.acct && S.acct.id === id) return;
  await leave(true);
  // one live tab per account
  if (navigator.locks && navigator.locks.request) {
    const got = await new Promise((res) => { navigator.locks.request('stryker-live-' + id, { ifAvailable: true }, (lk) => { if (!lk) { res(false); return; } res(true); return new Promise((rel) => { S.lock = rel; }); }).catch(() => res(true)); });
    if (!got) { toast('This live account is open in another ZoroCharts tab. Use that tab, or close it first.', 'error'); render(); return; }
  }
  S.acct = a; S.data = { positions: [], orders: [] }; S.lastOkStart = 0; S.lastWriteAt = 0; S.unknown = false; S.readErr = ''; S.skip = false; S.modifyOk = null; S.placeSchema = null; S.placeErr = ''; S.lastAct = Date.now();
  try { const r = await order({ op: 'env' }); S.env = r; } catch (e) { S.env = { env: '', enabled: false }; }
  readKill();
  schemaCheck();
  render(); read();
}
async function leave(quiet) {
  const had = !!S.acct;
  S.acct = null; S.skip = false; S.data = { positions: [], orders: [] }; S.lastOkStart = 0;
  if (S.lock) { try { S.lock(); } catch (e) {} S.lock = null; }
  closeConfirm();
  if (had && !quiet) toast('Back on Paper. No live orders from this tab.', 'info');
  render();
}
async function schemaCheck() {
  const id = S.acct && S.acct.id;
  // place schema: the broker's required fields for a new order; if it can't be read (trading not enabled) new orders stay blocked
  try { const r = await order({ op: 'schema', action: 'place' }); if (S.acct && S.acct.id === id) { S.placeSchema = (r && r.data) || {}; S.placeErr = ''; } }
  catch (e) { if (S.acct && S.acct.id === id) { S.placeSchema = null; S.placeErr = e.message || 'Order fields could not be read'; } }
  render();
  try { const r = await order({ op: 'schema', action: 'modify' }); if (S.acct && S.acct.id === id) S.modifyOk = !!(r && r.data && Object.keys(r.data).length); }
  catch (e) { if (S.acct && S.acct.id === id) S.modifyOk = false; }
}
async function readKill() {
  try { const d = await firebase.firestore().collection('settings').doc('liveTrading').get(); S.killed = d.exists && d.data().enabled === false; } catch (e) { S.killed = null; }
  render();
}
async function setKill(off) {
  try { await firebase.firestore().collection('settings').doc('liveTrading').set({ enabled: !off, by: uid, at: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); S.killed = off; toast(off ? 'Live trading is switched off. The server refuses every live order until it is switched back on.' : 'Live trading switched back on.', off ? 'info' : 'success'); }
  catch (e) { toast('Could not change the live trading switch: ' + (e && e.message || e), 'error'); }
  render();
}

// ------------------------------------------------------------------------------------------ reads
async function read() {
  if (!S.acct || S.reading) return;
  S.reading = true; const start = now(), id = S.acct.id;
  try {
    const r = await data('live', { accountId: id });
    if (!S.acct || S.acct.id !== id) return;
    S.data = { positions: (r.data && r.data.positions) || [], orders: (r.data && r.data.orders) || [] };
    S.lastOkStart = start; S.readErr = '';
    if (S.unknown && start > S.lastWriteAt) S.unknown = false;
  } catch (e) { if (S.acct && S.acct.id === id) S.readErr = e.message || 'Read failed.'; if (e.needsConnect) S.readErr = 'The broker connection needs to be renewed. Connect a broker again.'; }
  finally { S.reading = false; }
  render();
}
setInterval(() => {
  if (!S.acct) return;
  if (document.hidden) { if (!S.hiddenAt) S.hiddenAt = Date.now(); else if (Date.now() - S.hiddenAt > HIDDEN_MS) leave(); return; }
  S.hiddenAt = 0;
  if (Date.now() - S.lastAct > IDLE_MS) { leave(); toast('Live account left after 15 minutes without use.', 'info'); return; }
  read();
}, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.acct) { S.hiddenAt = 0; read(); } });
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true, capture: true }));

function gate() { return L.readsOk({ lastOkStart: S.lastOkStart, lastWriteAt: S.lastWriteAt, unknown: S.unknown, now: now(), maxAge: STALE_MS }); }
function blockReason() {
  if (!S.acct) return 'No live account picked.';
  if (S.env && !S.env.enabled) return 'Live orders are off on the server.';
  if (S.killed) return 'Live trading is switched off.';
  if (S.placeErr) return S.placeErr + '. New orders are blocked.';
  if (!S.placeSchema) return 'Loading the broker’s order fields…';
  if (S.busy) return 'Sending…';
  const g = gate(); if (!g.ok) return S.readErr ? 'Positions and orders could not be read (' + S.readErr + '). New orders are blocked.' : g.why;
  return '';
}

// ------------------------------------------------------------------------------------------ per chart
function info(sym) {
  const c = L.contractFor(sym, S.data.positions, now()); if (!c) return null;
  const pos = L.netPosition(S.data.positions, c.code), working = L.workingOrders(S.data.orders, c.code);
  let last = P && P.lastPrice ? P.lastPrice(sym) : undefined;
  if (!Number.isFinite(last) && TEST && TEST.last) last = TEST.last(sym);   // browser test fixture only (localhost)
  const pnl = L.openPnl(pos.qty, pos.avg, Number.isFinite(last) ? last : null, c.pv, pos.upl);
  return { ...c, pos, working, last, pnl };
}
export function badgeFor(sym) {
  if (!S.acct) return '';
  const i = info(sym);
  return envWord() + ' ' + S.acct.label + (i ? ' · ' + i.code : ' · this chart can’t trade live');
}
const envWord = () => (S.env && S.env.env === 'sandbox' ? 'SANDBOX' : 'LIVE');
export function lines(sym) {
  const i = info(sym); if (!i) return [];
  const out = [];
  if (i.pos.qty && i.pos.avg) out.push({ id: 'pos', kind: 'pos', live: true, price: i.pos.avg, side: i.pos.qty > 0 ? 'buy' : 'sell', qty: Math.abs(i.pos.qty), pnl: i.pnl });
  for (const o of i.working) if (o.price) out.push({ id: 'L' + o.id, oid: o.id, kind: 'ord', live: true, price: o.price, side: o.side, type: o.type, qty: o.qty });
  return out;
}
export function chipText(sym, l) {
  const i = info(sym);
  if (l.kind === 'pos') return ['LIVE ' + (l.side === 'buy' ? 'LONG ' : 'SHORT ') + l.qty + ' ' + (i ? i.code : '') + ' @ ' + px(l.price), money(i ? i.pnl : null, true)];
  return ['LIVE ' + (l.side === 'buy' ? 'BUY ' : 'SELL ') + (/stop/.test(l.type) ? 'STP ' : 'LMT ') + l.qty, px(l.price)];
}
export const tickOf = (sym) => { const r = L.chartRoot(sym); return r ? L.ROOTS[r].tick : 0.25; };

// ------------------------------------------------------------------------------------------ confirm sheet
let cf = null;
function closeConfirm(v) { if (cf) { const r = cf.resolve; cf.el.remove(); document.removeEventListener('keydown', cf.key, true); cf = null; r(v === true); } }
// d: { title, lines:[...], code, go, side, noSkip, marketable }
function confirmSheet(d) {
  closeConfirm(false);
  return new Promise((resolve) => {
    const key = S.acct.id + '|' + d.code, needType = !S.typed.has(key), canSkip = !d.noSkip;
    if (!needType && canSkip && S.skip) { resolve(true); return; }
    const el = document.createElement('div'); el.id = 'stklv-cf';
    el.innerHTML = '<div class="stklv-cf-box" role="alertdialog" aria-modal="true" aria-labelledby="stklv-cf-h" aria-describedby="stklv-cf-d">' +
      '<div class="stklv-grab" aria-hidden="true"></div>' +
      '<div class="stklv-cf-head"><span class="stklv-badge">' + esc(envWord() + ' ' + S.acct.label) + '</span><button type="button" class="stklv-x" data-k="no" aria-label="Cancel">×</button></div>' +
      '<h2 id="stklv-cf-h">' + esc(d.title) + '</h2>' +
      '<div id="stklv-cf-d" class="stklv-cf-lines">' + d.lines.map((x) => '<p>' + x + '</p>').join('') + '</div>' +
      (needType ? '<label class="stklv-cf-type"><span>First live order for ' + esc(d.code) + ' in this session. Type <b>' + esc(d.code) + '</b> to confirm.</span><input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Type the contract code to confirm"></label>' : '') +
      (canSkip && !needType ? '<label class="stklv-chk"><input type="checkbox" data-k="skip"> Skip this tap for the rest of this session</label>' : '') +
      '<div class="stklv-cf-btns"><button type="button" class="stklv-btn" data-k="no">Cancel</button><button type="button" class="stklv-btn stklv-go ' + (d.side === 'sell' ? 'sell' : 'buy') + '" data-k="yes"' + (needType ? ' disabled' : '') + '>' + esc(d.go) + '</button></div>' +
      '<p class="stklv-fine">Real order at your broker. Max 2 contracts. Every attempt is logged. ' + DISCLAIMER + '</p></div>';
    document.body.appendChild(el);
    const yes = el.querySelector('[data-k=yes]'), inp = el.querySelector('.stklv-cf-type input');
    if (inp) { inp.addEventListener('input', () => { const ok = inp.value.trim().toUpperCase() === d.code; yes.disabled = !ok; inp.setAttribute('aria-invalid', inp.value && !ok ? 'true' : 'false'); }); setTimeout(() => inp.focus(), 30); }
    else setTimeout(() => el.querySelector('[data-k=no]').focus(), 30);
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeConfirm(false); } else if (e.key === 'Enter' && !yes.disabled && document.activeElement !== el.querySelector('[data-k=no]')) { e.preventDefault(); e.stopPropagation(); yes.click(); } else e.stopPropagation(); };
    document.addEventListener('keydown', k, true);
    el.addEventListener('mousedown', (e) => { if (e.target === el) closeConfirm(false); });
    el.querySelectorAll('[data-k=no]').forEach((b) => b.addEventListener('click', () => closeConfirm(false)));
    yes.addEventListener('click', () => { if (yes.disabled) return; S.typed.add(key); const sk = el.querySelector('[data-k=skip]'); if (sk && sk.checked) S.skip = true; closeConfirm(true); });
    cf = { el, resolve, key: k };
  });
}

// ------------------------------------------------------------------------------------------ writes
async function write(body, what) {
  S.busy = true; S.lastWriteAt = now(); render();
  try { const r = await order(body); toast(what + ' sent. ' + (r.status ? 'Broker status: ' + r.status + '.' : ''), 'success'); return r; }
  catch (e) {
    S.skip = false;
    if (e.code === 'unknown' || e.network) { S.unknown = true; toast('No clear answer from the broker. The order may or may not be live. Check the working orders before sending again.', 'error'); }
    else toast(what + ' refused: ' + e.message, 'error');
    return null;
  } finally { S.busy = false; S.lastWriteAt = now(); render(); setTimeout(read, 600); }
}
const sideWord = (s) => (s === 'buy' ? 'BUY' : 'SELL');
function contractLine(i) { return 'Contract <b>' + esc(i.code) + '</b>' + (i.held ? ' (your open position’s month; front month is ' + esc(i.front) + ')' : ' (front month of ' + esc(i.root) + ')'); }
async function place(sym, o, src) {
  const why = blockReason(); if (why) { toast(why, 'error'); return null; }
  const i = info(sym); if (!i) { toast('Live orders work on NQ, ES, MNQ and MES charts only.', 'error'); return null; }
  const qty = Math.min(L.MAX_QTY, Math.max(1, Math.round(o.qty || 1)));
  const ex = L.exposureError(i.pos.qty, i.working, o.side, qty); if (ex) { toast(ex, 'error'); return null; }
  if (o.type === 'limit') { const band = L.priceBandError(Number(o.price), i.last); if (band) { toast(band, 'error'); return null; } }
  const b = L.buildPlace({ code: i.code, side: o.side, qty, type: o.type, price: o.price }, now()); if (b.error) { toast(b.error, 'error'); return null; }
  const desc = sideWord(o.side) + ' ' + qty + ' ' + i.code + ' ' + (o.type === 'market' ? 'MARKET' : 'LIMIT @ ' + px(b.body.limitPrice));
  const ok = await confirmSheet({ title: desc, code: i.code, side: o.side, go: 'Send ' + sideWord(o.side) + ' ' + qty,
    lines: [contractLine(i), 'Account <b>' + esc(S.acct.label) + '</b>', o.marketable ? '<span class="stklv-warn">This limit is at or through the market: it fills now at ' + esc(px(b.body.limitPrice)) + ' or better.</span>' : (o.type === 'market' ? '<span class="stklv-warn">Market order: fills at the next available price.</span>' : ''), 'Position now: ' + posText(i)].filter(Boolean), noSkip: false });
  if (!ok) return null;
  return write(Object.assign(b.body, { idemKey: uuid() }), desc + (src ? ' (' + src + ')' : ''));
}
const posText = (i) => (i.pos.qty ? (i.pos.qty > 0 ? 'long ' : 'short ') + Math.abs(i.pos.qty) + (i.pos.avg ? ' @ ' + px(i.pos.avg) : '') : 'flat') + (i.working.length ? ', ' + i.working.length + ' working order' + (i.working.length === 1 ? '' : 's') : '');
export async function cancel(oid) {
  if (!S.acct || S.busy) return null;
  const o = S.data.orders.find((x) => String(x.orderId) === String(oid));
  return write({ op: 'cancel', orderId: String(oid), idemKey: uuid() }, 'Cancel' + (o ? '' : ''));
}
export async function flatten(sym) {
  if (!S.acct || S.busy) return null;
  if (S.env && !S.env.enabled) { toast('Live orders are off on the server.', 'error'); return null; }
  if (!S.lastOkStart) { toast('Positions are still loading.', 'error'); return null; }
  const i = info(sym); if (!i) { toast('Open the NQ, ES, MNQ or MES chart of the position to flatten it.', 'error'); return null; }
  if (!i.pos.qty && !i.working.length) { toast('Nothing to flatten on ' + i.code + '.', 'info'); return null; }
  const ok = await confirmSheet({ title: 'Flatten ' + i.code, code: i.code, side: i.pos.qty > 0 ? 'sell' : 'buy', go: 'Flatten ' + i.code, noSkip: true,
    lines: [contractLine(i), 'Cancels ' + i.working.length + ' working order' + (i.working.length === 1 ? '' : 's') + ', then closes the position at market (' + posText(i) + ').', 'The server re-reads the position first and closes what it finds there.'] });
  if (!ok) return null;
  return write({ op: 'flatten', symbol: i.code, idemKey: L.flattenKey(S.acct.id, i.code, i.pos.qty, String(S.lastOkStart)) }, 'Flatten ' + i.code);
}
// drag a working order line to a new price
export async function drag(sym, d) {
  const oid = String(d.id).replace(/^L/, ''); const i = info(sym); if (!i) return;
  const o = i.working.find((x) => x.id === oid); if (!o) { toast('That order is no longer working.', 'info'); return; }
  const why = blockReason(); if (why) { toast(why, 'error'); return; }
  if (o.type && o.type !== 'limit') { toast('Only limit orders can be moved here.', 'info'); return; }
  const band = L.priceBandError(d.price, i.last); if (band) { toast(band, 'error'); return; }
  const m = L.buildModify({ id: oid, price: d.price, code: i.code }); if (m.error) { toast(m.error, 'error'); return; }
  const native = S.modifyOk !== false;
  const ok = await confirmSheet({ title: 'Move ' + sideWord(o.side) + ' ' + o.qty + ' ' + i.code + ' to ' + px(m.body.limitPrice), code: i.code, side: o.side, go: native ? 'Move order' : 'Cancel and send new', noSkip: true,
    lines: [contractLine(i), 'From ' + px(o.price) + ' to <b>' + px(m.body.limitPrice) + '</b>', native ? '' : '<span class="stklv-warn">This broker can’t change an order in place. The order is cancelled first; the new one is sent only after the cancel is confirmed.</span>'].filter(Boolean) });
  if (!ok) return;
  if (native) {
    const r = await write(Object.assign(m.body, { idemKey: uuid() }), 'Move');
    if (r) return;
    if (S.unknown) return;
  }
  // cancel + new: cancel, wait for a read showing it gone, then the new order (exposure re-checked on the server)
  const c = await write({ op: 'cancel', orderId: oid, idemKey: uuid() }, 'Cancel');
  if (!c) return;
  for (let t = 0; t < 5; t++) { await new Promise((r) => setTimeout(r, 1200)); S.reading = false; await read(); const still = L.workingOrders(S.data.orders, i.code).some((x) => x.id === oid); if (!still && S.lastOkStart > S.lastWriteAt) break; if (t === 4) { toast('The cancel is not confirmed yet. No new order was sent.', 'error'); return; } }
  const filled = (S.data.orders.find((x) => String(x.orderId) === oid) || {}).status;
  if (/FILL/i.test(filled || '')) { toast('The order filled before the cancel. No new order was sent.', 'error'); return; }
  const b = L.buildPlace({ code: i.code, side: o.side, qty: o.qty, type: 'limit', price: m.body.limitPrice }, now());
  if (b.error || blockReason()) { toast(b.error || blockReason(), 'error'); return; }
  await write(Object.assign(b.body, { idemKey: uuid() }), 'New ' + sideWord(o.side) + ' limit');
}
// DOM ladder click (assets/chart-book-panel.js): always a limit at the clicked price
export function ladder(sym, cell, price, bid, ask, qty) {
  const o = L.ladderOrder(cell, price, bid, ask); if (!o) return null;
  return place(sym, Object.assign(o, { qty }), 'DOM');
}
export function domState(sym) {
  const i = info(sym); if (!i) return null;
  return { live: true, code: i.code, orders: i.working.filter((o) => o.price).map((o) => ({ id: o.id, side: o.side, qty: o.qty, price: o.price })), pos: i.pos.qty ? { side: i.pos.qty > 0 ? 'buy' : 'sell', qty: Math.abs(i.pos.qty), avg: i.pos.avg || 0 } : null, pnl: i.pnl, sp: { ok: true, kind: 'futures', minQty: 1, symbol: i.code }, block: blockReason(), label: envWord() + ' ' + S.acct.label };
}
export function chipX(sym, id) { if (id === 'pos') return flatten(sym); return cancel(String(id).replace(/^L/, '')); }
export function flattenActive() { return flatten(P.activeSymbol()); }
export function openTicket(pre) {
  pre = pre || {};
  if (pre.side) S.form.side = pre.side;
  if (pre.price != null) { S.form.type = 'limit'; S.form.price = String(pre.price); }
  P.openPanel();
  setTimeout(() => { const f = document.querySelector('.stklv-form [data-f=price], .stklv-form .stklv-send'); if (f) f.focus(); }, 30);
}

// ------------------------------------------------------------------------------------------ panel rendering (called by chart-paper.js)
export function renderHead(slot) {
  if (!slot) return;
  const sig = [S.loaded, S.acct && S.acct.id, S.accounts.map((a) => a.id + a.label).join(','), envWord(), S.userId].join('|');
  if (slot.dataset.sig !== sig) {
    slot.dataset.sig = sig;
    const opts = '<option value="">Paper</option>' + S.accounts.map((a) => '<option value="' + esc(a.id) + '"' + (S.acct && S.acct.id === a.id ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('') + '<option value="__connect">' + (S.accounts.length ? 'Connect another broker…' : 'Connect a broker…') + '</option>';
    slot.innerHTML = '<label class="stklv-pick"><span class="stklv-vh">Trading account</span><select aria-label="Trading account">' + opts + '</select><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></label>' +
      (S.acct ? '<span class="stklv-badge" role="status" aria-label="' + esc(envWord() + ' ' + S.acct.label) + '"><span class="stklv-full">' + esc(envWord() + ' ' + S.acct.label) + '</span><span class="stklv-short" aria-hidden="true">' + esc(envWord() + ' …' + S.acct.last4) + '</span></span>' : '');
    const sel = slot.querySelector('select');
    sel.addEventListener('change', () => { const v = sel.value; if (v === '__connect') { sel.value = S.acct ? S.acct.id : ''; connect(); return; } pick(v); });
    for (const ev of ['pointerdown', 'keydown']) slot.addEventListener(ev, (e) => e.stopPropagation());
  }
}
export function renderSummary(el) {
  if (!el || !S.acct) return;
  const i = info(P.activeSymbol());
  const t = i ? i.code + ' · ' + (i.pos.qty ? (i.pos.qty > 0 ? 'Long ' : 'Short ') + Math.abs(i.pos.qty) : 'Flat') + ' · Open P&L ' + money(i.pnl, true) : 'Open an NQ, ES, MNQ or MES chart to trade live';
  if (el.textContent !== t) { el.textContent = ''; const s = document.createElement('span'); s.className = i && i.pnl > 0 ? 'up' : i && i.pnl < 0 ? 'down' : ''; s.textContent = t; el.appendChild(s); }
}
export const foot = () => (S.acct ? envWord() + ' account ' + S.acct.label + ': real orders at your broker, max 2 contracts, every attempt logged. Positions refresh every ' + POLL_MS / 1000 + ' s. ' + DISCLAIMER : '');
let viewSig = '';
export function renderView(v) {
  if (!v || !S.acct) return;
  const sym = P.activeSymbol(), i = info(sym), why = blockReason(), F = S.form;
  const sig = JSON.stringify([sym, i && [i.code, i.pos, i.working, i.held], Math.round((i && i.pnl) || 0), why, F, S.busy, S.killed, S.env, S.modifyOk]);
  const existing = v.querySelector('.stklv-view');
  if (existing && viewSig === sig) return;
  if (existing && existing.contains(document.activeElement) && document.activeElement.matches('input')) { const st = existing.querySelector('.stklv-status'); if (st) st.textContent = why || 'Ready. Positions and orders read ' + Math.max(0, Math.round((now() - S.lastOkStart) / 1000)) + ' s ago.'; return; }
  viewSig = sig;
  const seg = (k, val, opts) => '<div class="stklv-seg" role="radiogroup" aria-label="' + k + '">' + opts.map(([v2, t, cls]) => '<button type="button" role="radio" data-' + k + '="' + v2 + '" aria-checked="' + (String(val) === String(v2)) + '" class="' + (cls || '') + '">' + t + '</button>').join('') + '</div>';
  const blocked = !!why || !i;
  const posRows = i ? (i.pos.qty ? '<div class="stklv-row"><span class="stklv-sym">' + esc(i.code) + '</span><span class="' + (i.pos.qty > 0 ? 'up' : 'down') + '">' + (i.pos.qty > 0 ? 'Long ' : 'Short ') + Math.abs(i.pos.qty) + '</span><span class="m">@ ' + px(i.pos.avg) + '</span><span class="m ' + (i.pnl > 0 ? 'up' : i.pnl < 0 ? 'down' : '') + '">' + money(i.pnl, true) + '</span><button type="button" class="stklv-btn sm warn" data-a="flat">Flatten</button></div>' : '<p class="stklv-empty">No position in ' + esc(i.code) + '.</p>') : '';
  const ordRows = i ? (i.working.length ? i.working.map((o) => '<div class="stklv-row"><span class="stklv-sym">' + esc(i.code) + '</span><span class="' + (o.side === 'buy' ? 'up' : 'down') + '">' + sideWord(o.side) + ' ' + o.qty + '</span><span class="m">' + (o.type || '').toUpperCase() + (o.price ? ' @ ' + px(o.price) : '') + '</span><span class="m">' + esc(o.status.replace(/_/g, ' ').toLowerCase()) + '</span><button type="button" class="stklv-btn sm" data-cancel="' + esc(o.id) + '">Cancel</button></div>').join('') : '<p class="stklv-empty">No working orders.</p>') : '';
  v.innerHTML = '<div class="stklv-view">' +
    '<form class="stklv-form" novalidate>' +
      (i ? '<p class="stklv-ctr">' + esc(L.chartRoot(sym) + '1!') + ' → <b>' + esc(i.code) + '</b>' + (i.held ? ' <span class="stklv-warn">(open position’s month)</span>' : '') + '</p>' : '<p class="stklv-ctr stklv-warn">This chart can’t trade live. Open NQ1!, ES1!, MNQ1! or MES1!.</p>') +
      seg('side', F.side, [['buy', 'Buy', 'buy'], ['sell', 'Sell', 'sell']]) +
      '<div class="stklv-two">' + seg('type', F.type, [['market', 'Market'], ['limit', 'Limit']]) + seg('qty', F.qty, [[1, '1'], [2, '2']]) + '</div>' +
      (F.type === 'limit' ? '<label class="stklv-f"><span>Limit price</span><input data-f="price" type="text" inputmode="decimal" autocomplete="off" value="' + esc(F.price || (i && Number.isFinite(i.last) ? i.last.toFixed(2) : '')) + '"></label>' : '') +
      '<button type="submit" class="stklv-btn stklv-send ' + F.side + '"' + (blocked ? ' disabled' : '') + '>Review ' + sideWord(F.side) + ' ' + F.qty + (i ? ' ' + esc(i.code) : '') + '</button>' +
      '<p class="stklv-status' + (why ? ' bad' : '') + '" role="status">' + esc(why || 'Ready. Positions and orders read ' + Math.max(0, Math.round((now() - S.lastOkStart) / 1000)) + ' s ago.') + '</p>' +
    '</form>' +
    '<div class="stklv-lists"><h3 class="stklv-h3">Position</h3>' + posRows + '<h3 class="stklv-h3">Working orders</h3>' + ordRows +
      '<div class="stklv-tools"><button type="button" class="stklv-btn sm" data-a="refresh">Refresh</button>' + (S.killed ? '<button type="button" class="stklv-btn sm" data-a="killon">Switch live trading back on</button>' : '<button type="button" class="stklv-btn sm warn" data-a="kill">Turn off live trading</button>') + '<button type="button" class="stklv-btn sm" data-a="paper">Back to Paper</button></div></div>' +
  '</div>';
  const root = v.querySelector('.stklv-view');
  for (const ev of ['keydown', 'pointerdown']) root.addEventListener(ev, (e) => e.stopPropagation());
  root.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { F.side = b.dataset.side; render(); }));
  root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { F.type = b.dataset.type; render(); }));
  root.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => { F.qty = +b.dataset.qty; render(); }));
  const pin = root.querySelector('[data-f=price]'); if (pin) pin.addEventListener('input', () => { F.price = pin.value; });
  root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); if (pin) F.price = pin.value; place(sym, { side: F.side, type: F.type, qty: F.qty, price: F.type === 'limit' ? Number(String(F.price).replace(/[, ]/g, '')) : undefined }, 'panel'); });
  root.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => cancel(b.dataset.cancel)));
  const act = (a, fn) => { const b = root.querySelector('[data-a=' + a + ']'); if (b) b.addEventListener('click', fn); };
  act('flat', () => flatten(sym)); act('refresh', () => read()); act('paper', () => leave());
  act('kill', () => { if (window.confirm('Turn off live trading? The server will refuse every live order (all tabs, all devices) until it is switched back on.')) setKill(true); });
  act('killon', () => { const t = window.prompt('Type LIVE to switch live trading back on.'); if (t && t.trim().toUpperCase() === 'LIVE') setKill(false); });
}
function render() { try { P.renderAll(); } catch (e) {} }

// ------------------------------------------------------------------------------------------ CSS (TradeZoro tokens; 4-pt grid; dark + light)
const CSS = `
.stkpt-acctslot{ display:inline-flex; align-items:center; gap:8px; min-width:0; }
.stkpt.is-live .stkpt-head{ gap:8px; }
.stkpt-acctslot:empty{ display:none; }
.stkpt.is-live .stkpt-badge{ display:none; }
.stkpt.is-live .stkpt-trade,.stkpt-trade[hidden]{ display:none !important; }
.stklv-short{ display:none; }
.stklv-vh{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
.stklv-pick{ position:relative; display:inline-flex; align-items:center; height:28px; }
.stklv-pick select{ appearance:none; -webkit-appearance:none; height:28px; padding:0 28px 0 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-1); color:var(--ink-0); font:600 12px/16px var(--font-body, sans-serif); cursor:pointer; max-width:220px; text-overflow:ellipsis; }
.stklv-pick select:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stklv-pick svg{ position:absolute; right:10px; pointer-events:none; color:var(--ink-2); }
.stklv-badge{ display:inline-flex; align-items:center; height:28px; padding:0 12px; border-radius:999px; background:#d92d20; color:#fff; font:700 12px/16px var(--font-body, sans-serif); letter-spacing:.04em; white-space:nowrap; box-shadow:0 0 0 2px rgba(217,45,32,.28); }
.stklv-cbadge{ position:absolute; right:80px; top:8px; z-index:6; height:28px; padding:0 16px; display:flex; align-items:center; border-radius:999px; background:#d92d20; color:#fff; font:700 12px/16px -apple-system,BlinkMacSystemFont,Roboto,sans-serif; letter-spacing:.04em; white-space:nowrap; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.35); max-width:calc(100% - 96px); overflow:hidden; text-overflow:ellipsis; }
.stkpt-chip[data-live]{ border-width:2px; }
.stkpt-chip[data-live] .stkpt-chip-a{ font-weight:700; }
.stklv-view{ display:grid; grid-template-columns:minmax(260px,320px) minmax(0,1fr); gap:16px; padding:8px 4px; align-items:start; }
.stklv-form{ display:flex; flex-direction:column; gap:8px; }
.stklv-ctr{ margin:0; font:500 13px/18px var(--font-body, sans-serif); color:var(--ink-2); }
.stklv-ctr b{ color:var(--ink-0); }
.stklv-warn{ color:#f5a524; }
:root[data-theme="light"] .stklv-warn{ color:#8a5a00; }
.stklv-seg{ display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:4px; padding:4px; border-radius:12px; background:var(--bg-2); }
.stklv-seg button{ height:32px; border:0; border-radius:8px; background:transparent; color:var(--ink-2); font:600 13px/18px var(--font-body, sans-serif); cursor:pointer; }
.stklv-seg button[aria-checked="true"]{ background:var(--bg-0); color:var(--ink-0); box-shadow:0 1px 3px rgba(0,0,0,.3); }
.stklv-seg button.buy[aria-checked="true"]{ background:#2962ff; color:#fff; } .stklv-seg button.sell[aria-checked="true"]{ background:#f23645; color:#fff; }
.stklv-seg button:focus-visible,.stklv-btn:focus-visible,.stklv-f input:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stklv-two{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stklv-f{ display:flex; flex-direction:column; gap:4px; font:500 12px/16px var(--font-body, sans-serif); color:var(--ink-2); }
.stklv-f input{ height:40px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-1); color:var(--ink-0); font:500 15px/20px var(--font-mono, monospace); font-variant-numeric:tabular-nums; }
.stklv-btn{ display:inline-flex; align-items:center; justify-content:center; height:40px; padding:0 16px; border:1px solid var(--line); border-radius:12px; background:transparent; color:var(--ink-0); font:600 13px/18px var(--font-body, sans-serif); cursor:pointer; white-space:nowrap; }
.stklv-btn.sm{ height:32px; padding:0 12px; border-radius:8px; font-size:12px; }
.stklv-btn.warn{ border-color:rgba(242,54,69,.55); color:#f23645; }
.stklv-btn:disabled{ opacity:.4; cursor:not-allowed; }
.stklv-send.buy,.stklv-go.buy{ background:#2962ff; border-color:#2962ff; color:#fff; } .stklv-send.sell,.stklv-go.sell{ background:#f23645; border-color:#f23645; color:#fff; }
.stklv-status{ margin:0; font:400 12px/16px var(--font-body, sans-serif); color:var(--ink-3); }
.stklv-status.bad{ color:#f23645; font-weight:600; }
.stklv-lists{ min-width:0; display:flex; flex-direction:column; }
.stklv-h3{ margin:8px 0 4px; font:600 11px/16px var(--font-body, sans-serif); letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); }
.stklv-h3:first-child{ margin-top:0; }
.stklv-row{ display:grid; grid-template-columns:72px 72px minmax(0,1fr) minmax(0,1fr) auto; align-items:center; gap:8px; min-height:44px; border-bottom:1px solid var(--line-soft); font:500 13px/18px var(--font-body, sans-serif); }
.stklv-row .m{ font-family:var(--font-mono, monospace); font-variant-numeric:tabular-nums; color:var(--ink-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stklv-sym{ font-weight:600; color:var(--ink-0); }
.stklv-row .up,.stklv-view .up{ color:#089981; } .stklv-row .down,.stklv-view .down{ color:#f23645; }
.stklv-empty{ margin:4px 0 8px; font:400 13px/18px var(--font-body, sans-serif); color:var(--ink-3); }
.stklv-tools{ display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
#stklv-cf{ position:fixed; inset:0; z-index:9100; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:16px; }
.stklv-cf-box{ width:min(420px,100%); max-height:calc(100dvh - 32px); overflow:auto; background:var(--bg-1, #0b0b0d); color:var(--ink-1); border:2px solid #d92d20; border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:12px; font:400 14px/20px var(--font-body, sans-serif); box-shadow:0 24px 80px rgba(0,0,0,.6); }
.stklv-grab{ display:none; }
.stklv-cf-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.stklv-x{ width:32px; height:32px; border:0; border-radius:999px; background:var(--bg-2); color:var(--ink-1); font-size:18px; line-height:32px; cursor:pointer; }
.stklv-cf-box h2{ margin:0; font:700 17px/22px var(--font-body, sans-serif); color:var(--ink-0); font-variant-numeric:tabular-nums; }
.stklv-cf-lines{ display:flex; flex-direction:column; gap:4px; }
.stklv-cf-lines p{ margin:0; font-size:14px; line-height:20px; } .stklv-cf-lines b{ color:var(--ink-0); }
.stklv-cf-type{ display:flex; flex-direction:column; gap:8px; font-size:13px; line-height:18px; color:var(--ink-1); }
.stklv-cf-type input{ height:48px; padding:0 12px; border:1px solid var(--line); border-radius:12px; background:var(--bg-0); color:var(--ink-0); font:600 16px/20px var(--font-mono, monospace); letter-spacing:.08em; text-transform:uppercase; }
.stklv-cf-type input[aria-invalid="true"]{ border-color:#f23645; }
.stklv-chk{ display:flex; align-items:center; gap:8px; min-height:32px; font-size:13px; color:var(--ink-1); cursor:pointer; } .stklv-chk input{ width:16px; height:16px; margin:0; accent-color:#03c988; }
.stklv-cf-btns{ display:grid; grid-template-columns:1fr 1.4fr; gap:8px; } .stklv-cf-btns .stklv-btn{ height:48px; font-size:15px; }
.stklv-fine{ margin:0; font-size:12px; line-height:16px; color:var(--ink-3); }
@media (max-width:980px){ .stklv-view{ grid-template-columns:1fr; } }
@media (max-width:700px){
  .stklv-pick select{ max-width:132px; height:32px; } .stklv-pick{ height:32px; }
  .stkpt.is-live .stkpt-hsum{ display:none; }
  .stkpt-head .stklv-badge{ height:32px; padding:0 12px; }
  .stkpt-head .stklv-full{ display:none; } .stkpt-head .stklv-short{ display:inline; }
  .stklv-pick select{ max-width:128px; }
  .stklv-view{ padding:8px 0; gap:12px; }
  .stklv-seg button{ height:40px; } .stklv-btn{ height:44px; } .stklv-btn.sm{ height:36px; }
  .stklv-f input{ height:48px; font-size:16px; }
  .stklv-row{ grid-template-columns:56px 64px minmax(0,1fr) auto; } .stklv-row .m:nth-of-type(4){ display:none; }
  #stklv-cf{ align-items:flex-end; padding:0; }
  .stklv-cf-box{ width:100%; border-radius:20px 20px 0 0; border-width:2px 0 0; max-height:92dvh; padding:8px 16px calc(16px + env(safe-area-inset-bottom)); }
  .stklv-grab{ display:block; width:36px; height:4px; margin:0 auto 4px; border-radius:2px; background:var(--line); }
  .stklv-cbadge{ top:120px; right:auto; left:50%; transform:translateX(-50%); height:32px; max-width:calc(100% - 32px); }
}
`;

export function mountLive(paperApi, opts) {
  P = paperApi; uid = opts.uid; toastFn = opts.toast || null;
  if (!document.getElementById('stklv-css')) { const st = document.createElement('style'); st.id = 'stklv-css'; st.textContent = CSS; document.head.appendChild(st); }
  P.setLiveHook({ active, lines, chipText, badgeFor, tickOf, chipX, drag, flattenActive, openTicket, renderHead, renderSummary, renderView, foot, ladder, domState, cancel, flatten });
  loadAccounts();
  window.addEventListener('storage', (e) => { if (e.key === lsUserKey()) loadAccounts(); });
  Object.assign(window.__stkLive, { connect, pick, leave, read, loadAccounts, info, confirmSheet, get blockReason() { return blockReason(); } });
}
