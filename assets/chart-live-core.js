// TradeZoro — LIVE broker orders from ZoroCharts: pure logic (ES module, no DOM, no network). ADMIN ONLY feature (Owner order 2026-11-15).
// Used by the browser (assets/chart-live.js) AND the server (functions/connect/finatic/order.js), so the contract whitelist, the
// exposure cap and the flatten plan are the same code on both sides. Unit tests: tests/finatic/chart-live-core.test.mjs.
//
// Symbols: only the four CME equity-index futures charts NQ1! / ES1! / MNQ1! / MES1! (any exchange prefix) can route live.
// Contract = the quarterly front month (H M U Z), rolled 8 days before the third-Friday expiry, written root + month + one-digit
// year (NQZ6), the form the broker test accepted (MESZ6). If the account already holds a position in that root, that contract
// is used instead (so a flatten / add never lands in a different month). Point values are the exchange contract specs.
// Education only. Not financial advice.

export const ROOTS = { NQ: { pv: 20, tick: 0.25 }, MNQ: { pv: 2, tick: 0.25 }, ES: { pv: 50, tick: 0.25 }, MES: { pv: 5, tick: 0.25 } };
export const MAX_QTY = 2;                       // contracts per order AND max net exposure (position + working orders), server-checked
const MONTHS = [[3, 'H'], [6, 'M'], [9, 'U'], [12, 'Z']];
const CODE = /^(MNQ|MES|NQ|ES)([HMUZ])(\d{1,2})$/;
const WORKING = /^(CREATED|SUBMITTED|RECEIVED|NEW|PARTIALLY_FILLED|PENDING_CANCEL|PENDING|OPEN|WORKING|ACCEPTED|PENDING_NEW|PENDING_REPLACE)$/;
export const ROLL_DAYS = 8;

// "CME_MINI:NQ1!", "rithmic:MNQ1!", "futures:ES1!", "NQ1!" -> "NQ" ; anything else -> ''
export function chartRoot(sym) {
  const s = String(sym || '').replace(/^[^:]+:/, '').toUpperCase().trim();
  const m = /^(MNQ|MES|NQ|ES)1!$/.exec(s);
  return m ? m[1] : '';
}
// third Friday of month m (1-12) in year y, 00:00 UTC
export function thirdFriday(y, m) {
  const d = new Date(Date.UTC(y, m - 1, 1)); const dow = d.getUTCDay();
  return Date.UTC(y, m - 1, 1 + ((5 - dow + 7) % 7) + 14);
}
// quarterly contracts still trading at `now`, nearest first: [{ code, month, year, expiry, rollAt }]
export function liveContracts(root, now, n = 2) {
  if (!ROOTS[root]) return [];
  const out = []; const y0 = new Date(now).getUTCFullYear();
  for (let y = y0; y <= y0 + 2 && out.length < n; y++) for (const [m, L] of MONTHS) {
    const expiry = thirdFriday(y, m) + 14.5 * 3600000;    // CME equity-index last trade 09:30 ET on the third Friday (~13:30-14:30 UTC)
    if (expiry <= now) continue;
    out.push({ code: root + L + (y % 10), month: m, year: y, expiry, rollAt: thirdFriday(y, m) - ROLL_DAYS * 864e5 });
    if (out.length >= n) break;
  }
  return out;
}
// front month: the nearest contract unless we are inside its roll window, then the next one
export function frontMonth(root, now) {
  const c = liveContracts(root, now, 2); if (!c.length) return null;
  return now >= c[0].rollAt && c[1] ? c[1] : c[0];
}
// server whitelist: a contract code that is one of the two nearest live quarters of the four roots
export function validContract(code, now) {
  const m = CODE.exec(String(code || '').toUpperCase()); if (!m) return false;
  return liveContracts(m[1], now, 2).some((c) => c.code === m[0]);
}
export const rootOfCode = (code) => { const m = CODE.exec(String(code || '').toUpperCase()); return m ? m[1] : ''; };

// ---- reading the broker's (normalised) records ---------------------------------------------------------------------------
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function symsOf(o) {
  const out = [], add = (v) => { if (v) out.push(String(v).toUpperCase()); };
  if (!o) return out;
  add(o.securityId); add(o.symbol); add(o.brokerProvidedSymbol); add(o.contractCode);
  const ins = o.instrument || {}; add(ins.displaySymbol); add(ins.providerSymbol); add(ins.future && ins.future.contractCode);
  return out;
}
// a record's contract in our short form when it is one of ours (NQZ6 / NQZ26 / "NQZ6.CME" -> NQZ6), else ''
export function contractOf(rec) {
  for (const s of symsOf(rec)) {
    const m = /^(MNQ|MES|NQ|ES)([HMUZ])(\d{1,2})\b/.exec(s.replace(/^[^:]+:/, ''));
    if (m) return m[1] + m[2] + (m[3].length === 2 ? m[3][1] : m[3]);
  }
  return '';
}
// signed net position (contracts) for one contract, from Finatic positions (quantity may be signed, or side=SHORT with a positive qty)
export function netPosition(positions, code) {
  let q = 0, avgN = 0, avgD = 0, upl = null, updated = '';
  for (const p of Array.isArray(positions) ? positions : []) {
    if (!p || String(p.status || 'OPEN').toUpperCase() === 'CLOSED') continue;
    if (contractOf(p) !== code) continue;
    let n = num(p.quantity != null ? p.quantity : p.units);
    if (String(p.side || '').toUpperCase() === 'SHORT' && n > 0) n = -n;
    if (!n) continue;
    q += n;
    const avg = num(n > 0 ? (p.averageBuyPrice || p.averagePrice || p.avgPrice) : (p.averageSellPrice || p.averagePrice || p.avgPrice)) || (num(p.costBasis) && Math.abs(num(p.costBasis) / n)) || 0;
    if (avg) { avgN += avg * Math.abs(n); avgD += Math.abs(n); }
    if (p.unrealizedProfitLoss != null && p.unrealizedProfitLoss !== '') upl = (upl || 0) + num(p.unrealizedProfitLoss);
    const u = p.positionUpdatedAt || p.snapshotDate || ''; if (u > updated) updated = u;
  }
  return { qty: q, avg: avgD ? avgN / avgD : null, upl, updated };
}
// the contract of an open position in this root (first non-zero), '' when flat
export function heldContract(positions, root) {
  const seen = new Set();
  for (const p of Array.isArray(positions) ? positions : []) { const c = contractOf(p); if (c && rootOfCode(c) === root) seen.add(c); }
  for (const c of seen) if (netPosition(positions, c).qty) return c;
  return '';
}
// contract to trade for a chart: held position's contract, else the front month
export function contractFor(sym, positions, now) {
  const root = chartRoot(sym); if (!root) return null;
  const fm = frontMonth(root, now); if (!fm) return null;
  const held = heldContract(positions, root);
  return { root, code: held || fm.code, front: fm.code, held: !!held && held !== fm.code, pv: ROOTS[root].pv, tick: ROOTS[root].tick };
}
// working (not final) orders for a contract -> [{ id, side, qty, type, price, status }]
export function workingOrders(orders, code) {
  const out = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || !WORKING.test(String(o.status || '').toUpperCase())) continue;
    const leg = (o.legs || [])[0] || {};
    if (contractOf(leg) !== code && contractOf(o) !== code) continue;
    const qty = num(leg.remainingQuantity != null && leg.remainingQuantity !== '' ? leg.remainingQuantity : leg.quantity != null ? leg.quantity : o.orderQty);
    const type = String(o.orderType || leg.orderType || '').toLowerCase();
    const price = num(leg.limitPrice != null ? leg.limitPrice : o.limitPrice != null ? o.limitPrice : o.price) || num(leg.stopPrice != null ? leg.stopPrice : o.stopPrice) || null;
    out.push({ id: String(o.orderId || o.id || ''), side: String(leg.side || o.side || o.action || '').toLowerCase() === 'sell' ? 'sell' : 'buy', qty, type, price, status: String(o.status || '').toUpperCase(), cancelling: /PENDING_CANCEL/i.test(o.status || '') });
  }
  return out.filter((o) => o.id);
}
// Exposure cap: the worst-case net position if every working order AND the new one filled must stay within MAX_QTY.
// -> null when allowed, else a plain reason.
export function exposureError(pos, working, side, qty, cap = MAX_QTY) {
  let longW = 0, shortW = 0;
  for (const o of working || []) { if (o.side === 'buy') longW += o.qty; else shortW += o.qty; }
  if (side === 'buy') longW += qty; else shortW += qty;
  const worstLong = pos + longW, worstShort = pos - shortW;
  if (worstLong > cap || worstShort < -cap) return 'That would allow more than ' + cap + ' contracts (position plus working orders). Cancel an order or reduce the position first.';
  if ((working || []).length + 1 > 2 * cap) return 'Too many working orders on this contract.';
  return null;
}

// ---- building commands ---------------------------------------------------------------------------------------------------
export const roundTick = (p, tick) => Math.round(p / tick) * tick;
// panel / ladder order -> body for POST /connect/finatic/order. -> { body } | { error }
export function buildPlace({ code, side, qty, type, price, stopPrice, limitPrice, sl, tp, last }, now) {
  if (!validContract(code, now)) return { error: 'No live contract for this chart.' };
  if (side !== 'buy' && side !== 'sell') return { error: 'Pick Buy or Sell.' };
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: 'Quantity is 1 or 2 contracts.' };
  if (!['market', 'limit', 'stop', 'stop_limit'].includes(type)) return { error: 'Market, limit or stop only.' };
  const body = { op: 'place', symbol: code, side, qty, type, assetType: 'future', timeInForce: 'day' };
  const tick = ROOTS[rootOfCode(code)].tick, r = (v) => Number(roundTick(Number(v), tick).toFixed(2));
  if (type === 'limit' || type === 'stop_limit') { const lp = type === 'limit' ? price : limitPrice; if (!(Number(lp) > 0)) return { error: 'Enter a limit price.' }; body.limitPrice = r(lp); }
  if (type === 'stop' || type === 'stop_limit') { const sp = type === 'stop' ? price : stopPrice; if (!(Number(sp) > 0)) return { error: 'Enter a stop price.' }; body.stopPrice = r(sp); }
  if (sl != null || tp != null) {   // stop loss / take profit: market entries only (placed by the server after the fill)
    if (type !== 'market') return { error: 'Stop loss and take profit go with market orders only.' };
    const bc = bracketCheck({ side, ref: last, sl, tp, code }); if (bc.error) return { error: bc.error };
    body.bracket = { sl: bc.sl, tp: bc.tp };
  }
  return { body };
}
// drag / edit one working order: a limit moves its limit price, a stop its stop price (code = the contract, sent so the server can
// match a stop loss / take profit of a bracket group)
export function buildModify({ id, price, code, type = 'limit' }) {
  if (!id) return { error: 'Order missing.' };
  const tick = ROOTS[rootOfCode(code)] ? ROOTS[rootOfCode(code)].tick : 0.25;
  if (!(Number(price) > 0)) return { error: 'Price invalid.' };
  const p = Number(roundTick(Number(price), tick).toFixed(2));
  if (type === 'stop') return { body: { op: 'modify', orderId: id, type: 'stop', stopPrice: p, symbol: code } };
  if (type !== 'limit') return { error: 'Only limit and stop orders can be moved.' };
  return { body: { op: 'modify', orderId: id, type: 'limit', limitPrice: p, symbol: code } };
}
// DOM ladder click: ALWAYS a limit at the clicked price (never a market order from a misclick). A click at / through the touch is
// a marketable limit; the confirm says so. -> { side, type:'limit', price, marketable } | null
export function ladderOrder(cell, price, bid, ask) {
  if ((cell !== 'bid' && cell !== 'ask') || !(price > 0)) return null;
  const side = cell === 'bid' ? 'buy' : 'sell';
  const marketable = side === 'buy' ? (ask > 0 && price >= ask) : (bid > 0 && price <= bid);
  return { side, type: 'limit', price, marketable };
}
// limits and stops must be near the market (fat-finger band): 2% of the last price
export function priceBandError(price, last, pct = 0.02) {
  if (!(last > 0) || !(price > 0)) return null;
  return Math.abs(price - last) / last > pct ? 'Price is more than ' + Math.round(pct * 100) + '% away from the market.' : null;
}
// flatten plan from a FRESH read: cancel every working order of the contract, then close the net position at market
export function flattenPlan(pos, working, cap = MAX_QTY) {
  const cancel = (working || []).filter((o) => !o.cancelling).map((o) => o.id);
  if (!pos) return { cancel, close: null };
  if (Math.abs(pos) > cap) return { cancel, close: null, tooBig: true };
  return { cancel, close: { side: pos > 0 ? 'sell' : 'buy', qty: Math.abs(pos) } };
}
// deterministic key for one flatten of one position snapshot: a double tap / second tab maps to the same key (deduped server-side)
export function flattenKey(account, code, qty, stamp) {
  const s = 'flat|' + account + '|' + code + '|' + qty + '|' + (stamp || '');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return 'fl-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + '-' + code.toLowerCase();
}
export const IDEM = /^[A-Za-z0-9-]{16,64}$/;
// Reads gate new orders: a read must have STARTED after the last write and be no older than maxAge; an unknown write result blocks.
export function readsOk({ lastOkStart, lastWriteAt, unknown, now, maxAge = 20000 }) {
  if (unknown) return { ok: false, why: 'The last order result is unknown. Checking the broker…' };
  if (!lastOkStart) return { ok: false, why: 'Reading positions and orders…' };
  if (lastWriteAt && lastOkStart <= lastWriteAt) return { ok: false, why: 'Waiting for the broker to confirm the last order…' };
  if (now - lastOkStart > maxAge) return { ok: false, why: 'Positions and orders could not be read. New orders are blocked.' };
  return { ok: true, why: '' };
}
// ---- speed (Owner order 2026-11-16) --------------------------------------------------------------------------------------
// Server-Timing header -> { name: ms }  ("fin;dur=58, total;dur=71, placement;desc=\"remote-IAD\"" -> { fin: 58, total: 71, placement: 'remote-IAD' })
export function parseTiming(h) {
  const out = {};
  for (const part of String(h || '').split(',')) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*(?:;(.*))?$/.exec(part); if (!m) continue;
    const d = /dur=([\d.]+)/.exec(m[2] || ''), s = /desc="?([^";]*)"?/.exec(m[2] || '');
    out[m[1]] = d ? Math.round(Number(d[1])) : s ? s[1] : true;
  }
  return out;
}
// footer line for the last write: "Order sent in 182 ms (broker 61 ms)" ; '' when nothing measured
export function rttText(t) {
  if (!t || !(t.ms >= 0)) return '';
  const what = t.op === 'cancel' ? 'Cancel' : t.op === 'modify' ? 'Move' : t.op === 'flatten' ? 'Flatten' : 'Order';
  const fin = t.server && Number.isFinite(t.server.fin) ? ' (broker ' + t.server.fin + ' ms)' : '';
  return what + (t.ok ? ' sent in ' : ' answered in ') + Math.round(t.ms) + ' ms' + fin + '.';
}
// after a write: read again quickly so the fill / working order shows (then the normal 10 s poll)
export const FAST_READS_MS = [250, 900, 2000, 4000];
// a "sending" line drawn the moment the order is confirmed (limit price, or the last price for a market order); removed on the answer
export function pendingLine(body, last) {
  const price = body.type === 'limit' ? Number(body.limitPrice) : /stop/.test(body.type) ? Number(body.stopPrice) : Number(last);
  if (!(price > 0)) return null;
  return { id: 'P' + body.idemKey, kind: 'ord', live: true, pending: true, code: body.symbol, price, side: body.side, type: body.type, qty: body.qty };
}

// ---- account identity, balances, labels (Owner order 2026-11-16: "account number is wrong, add total money") ----------------
// Finatic's v1 account record carries its own UUID (accountId / id) plus the broker's fields. Which broker field holds the number
// the broker SHOWS differs by broker and API version, so we read the candidates in this order and never fall back to a UUID:
//   accountNumber / account_number / brokerAccountNumber  (the number on the broker's statement, e.g. "APEX-123456-01")
//   accountDisplayName / account_display_name / accountName / account_name / displayName / display_name / name / nickname
// brokerAccountId / broker_account_id is NOT shown: for Tradovate it is the broker's INTERNAL numeric id, not the account name
// the broker shows (showing its last 4 was the "…2029" bug). It is only used to match a grant and to skip an equal "number".
const UUIDISH = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const NUM_KEYS = ['accountNumber', 'account_number', 'brokerAccountNumber', 'broker_account_number'];
const NAME_KEYS = ['accountDisplayName', 'account_display_name', 'accountName', 'account_name', 'displayName', 'display_name', 'name', 'nickname'];
const ID_KEYS = ['brokerAccountId', 'broker_account_id'];
const str = (v) => (v == null || typeof v === 'object' ? '' : String(v).trim());
export function brokerNice(b) {
  const s = str(b) || 'Broker';
  const fix = { ibkr: 'IBKR', interactivebrokers: 'Interactive Brokers', tastytrade: 'tastytrade', ninjatrader: 'NinjaTrader', ninja_trader: 'NinjaTrader', tradestation: 'TradeStation', topstepx: 'TopstepX', projectx: 'ProjectX', tasty_trade: 'tastytrade' };
  const k = s.toLowerCase().replace(/[^a-z_]/g, '');
  return fix[k] || fix[k.replace(/_/g, '')] || s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
// the account number as the broker shows it ('' when Finatic gave none); never a UUID or our own id
export function acctNumber(x, ownId) {
  if (!x) return '';
  const ok = (v) => v && v.length <= 64 && !UUIDISH.test(v) && v !== ownId;
  const internal = ID_KEYS.map((k) => str(x[k])).find(Boolean) || '';
  const cands = [...NUM_KEYS, ...NAME_KEYS].map((k) => str(x[k])).filter(ok);
  // a "number" that is just the broker's internal id again (Tradovate: accountNumber == brokerAccountId) loses to a real name
  const best = cands.find((v) => v !== internal) || cands[0];
  return best || '';   // never the internal id alone: it is not a number the broker shows (that was the "…2029" bug)
}
// one Finatic account record -> what the menu needs
export function acctInfo(x) {
  const id = str(x && (x.accountId || x.id));
  const broker = brokerNice(x && (x.brokerName || x.broker_name || x.brokerDisplayName || x.brokerId || x.broker_id || x.institutionName || x.broker));
  const number = acctNumber(x, id);
  const alnum = number.replace(/[^A-Za-z0-9]/g, '');
  return { id, broker, number, last4: alnum.slice(-4), text: number ? broker + ' ' + number : broker,
    brokerId: str(x && (x.brokerId || x.broker_id)).toLowerCase(), brokerAccountId: str(x && (x.brokerAccountId || x.broker_account_id)),
    grantId: str(x && (x.grantId || x.grant_id || x.accountGrantId || x.account_grant_id)), currency: str(x && (x.currencyCode || x.currency_code || x.currency)).toUpperCase() };
}
// back-compat wrapper (old callers pass { broker, number|name, id })
export function acctLabel(a) {
  const i = acctInfo({ brokerName: a.broker || a.brokerName || a.brokerId, accountNumber: a.number || a.accountNumber, accountName: a.name || a.accountName, brokerAccountId: a.brokerAccountId, id: a.id });
  return { broker: i.broker, last4: i.last4, text: i.text, number: i.number };
}
// The grant that gave us this account (Disconnect revokes it). Exact link first, then the broker account id, then "the only active
// grant for this broker", then "the only active grant". '' when it can't be told apart (the UI then says so instead of guessing).
export function grantFor(acct, grants) {
  const live = (Array.isArray(grants) ? grants : []).filter((g) => g && g.id && !g.revokedAt && !/revoked/i.test(String(g.status || '')));
  if (acct.grantId && live.some((g) => g.id === acct.grantId)) return acct.grantId;
  const byAcct = live.filter((g) => acct.brokerAccountId && String(g.brokerAccountId || '') === acct.brokerAccountId);
  if (byAcct.length === 1) return byAcct[0].id;
  const bk = (acct.brokerId || acct.broker).toLowerCase().replace(/[^a-z]/g, '');
  const byBroker = live.filter((g) => String(g.brokerId || '').toLowerCase().replace(/[^a-z]/g, '') === bk);
  if (byBroker.length === 1) return byBroker[0].id;
  return live.length === 1 ? live[0].id : '';
}
// Balances (Owner bug 2026-11-19 "the balance is not updated"): the broker link's balances endpoint is a LIST of balance SNAPSHOTS
// (LegacyBrokerBalance: one row per sync and balance kind, each stamped balanceCreatedAt "as-of" + lastUpdated), not one live row.
// The old code took the first row that had a value, i.e. whichever snapshot the list happened to start with, and never looked at its
// date. Now: only rows of the account's currency, the NEWEST snapshot wins (by its own timestamp; undated rows lose to dated ones),
// and inside that snapshot the field order is:
//   1 net liquidation / account value / equity (includes realised and open P&L as of the snapshot)   kind 'netliq'
//   2 total cash / cash / current balance                                                              kind 'cash'
//   3 available balance (last resort)                                                                  kind 'available'
// A cumulative "total realised" field is never added on top (its period is not stated, it would double count). What moves the
// figure between snapshots is liveBalance() below: the snapshot plus the realised P&L of the broker's own fills AFTER the snapshot.
// Values may be numbers or numeric strings. Returns { amount, currency, upl, kind, key, at (ms | null), realized (day field | null) }.
const NETLIQ_KEYS = ['netLiquidationValue', 'net_liquidation_value', 'netLiquidation', 'netLiq', 'accountValue', 'account_value', 'totalValue', 'total_value', 'equity', 'totalEquity'];
const CASH_KEYS = ['totalCashValue', 'total_cash_value', 'cashBalance', 'cash_balance', 'currentBalance', 'current_balance', 'balance'];
const AVAIL_KEYS = ['availableBalance', 'available_balance', 'availableToWithdraw'];
const RPL_KEYS = ['realizedPnlToday', 'dayRealizedPnl', 'todayRealizedPnl', 'dailyRealizedPnl'];   // explicitly today's only
const UPL_KEYS = ['unrealizedPnl', 'unrealized_pnl', 'unrealizedProfitLoss', 'unrealized_profit_loss', 'openPnl', 'openPnL', 'open_pnl', 'totalUnrealizedPnl', 'openTradeEquity', 'open_trade_equity'];
const TS_KEYS = ['lastUpdated', 'last_updated', 'updatedAt', 'updated_at', 'balanceUpdatedAt', 'asOf', 'as_of', 'balanceCreatedAt', 'balance_created_at', 'snapshotDate', 'createdAt', 'timestamp'];
const numOf = (v) => { if (v == null || v === '' || typeof v === 'boolean') return null; if (typeof v === 'object') v = v.amount != null ? v.amount : v.value; const n = Number(String(v).replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : null; };
const firstNum = (r, ks) => { for (const k of ks) { const n = numOf(r[k]); if (n != null) return [n, k]; } return null; };
// a record's own time in ms (newest of its stamps), null when it has none. Date-only strings count as that day 00:00 UTC.
export function stampOf(r) {
  let best = null;
  for (const k of TS_KEYS) { const v = r && r[k]; if (v == null || v === '') continue; const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v)); if (Number.isFinite(t) && (best == null || t > best)) best = t; }
  return best;
}
export function balanceOf(rows, cur) {
  let list = (Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : []).filter((r) => r && typeof r === 'object');
  if (!list.length) return null;
  const want = str(cur).toUpperCase() || 'USD';
  const curOf = (r) => str(r.currencyCode || r.currency_code || r.currency).toUpperCase();
  if (list.some((r) => curOf(r) === want)) list = list.filter((r) => curOf(r) === want || !curOf(r));
  // newest snapshot first; undated rows keep their order behind the dated ones
  list = list.map((r, i) => ({ r, i, t: stampOf(r) })).sort((a, b) => (b.t != null) - (a.t != null) || (b.t || 0) - (a.t || 0) || a.i - b.i).map((x) => x.r);
  const out = (r, amount, kind, key, realized) => { const u = firstNum(r, UPL_KEYS); return { amount, currency: curOf(r) || want, upl: u ? u[0] : null, kind, key, at: stampOf(r), realized: realized == null ? null : realized }; };
  // the newest snapshot that carries any balance figure decides; an older snapshot never beats it
  for (const r of list) {
    const rp = (firstNum(r, RPL_KEYS) || [null])[0];
    const nl = firstNum(r, NETLIQ_KEYS); if (nl) return out(r, nl[0], 'netliq', nl[1], rp);
    const c = firstNum(r, CASH_KEYS); if (c) return out(r, c[0], 'cash', c[1], rp);
    const av = firstNum(r, AVAIL_KEYS); if (av) return out(r, av[0], 'available', av[1], rp);
  }
  return null;
}
// The figure to show. snap = balanceOf(); fills = the broker's fills (any day); positions = current positions.
// When the snapshot is dated and the broker filled orders AFTER it, the realised P&L of those fills (FIFO, net of their commission)
// is added, provided the account was flat in those contracts at the snapshot (else the cost of the carried position is unknown and
// the snapshot is shown as is, with its age). -> { amount, at, adjusted, fillsAfter, why }
export function liveBalance(snap, fills, positions) {
  if (!snap) return null;
  const base = { amount: snap.amount, at: snap.at, adjusted: false, fillsAfter: 0, why: '' };
  if (!(snap.at > 0)) return base;
  const after = (Array.isArray(fills) ? fills : []).filter((f) => { const t = fillTime(f); return t != null && t > snap.at; });
  if (!after.length) return base;
  const r = dayRealized(after, positions, snap.at + 1);
  if (!r.complete) return Object.assign(base, { fillsAfter: r.fills, why: r.why });
  // netliq at a flat snapshot = cash then; now = that + realised since (open P&L is shown separately as UP&L)
  return { amount: Math.round((snap.amount + r.value) * 100) / 100, at: snap.at, adjusted: true, fillsAfter: r.fills, why: '' };
}
// "updated 3 min ago" when the snapshot is older than `after` ms (default 2 min), else ''. Never "delayed" / "real-time".
export function ageText(at, now, after = 120000) {
  if (!(at > 0) || !(now > 0)) return '';
  const d = now - at; if (d < after) return '';
  const m = Math.floor(d / 60000);
  if (m < 60) return 'updated ' + m + ' min ago';
  const h = Math.floor(m / 60); if (h < 48) return 'updated ' + h + ' h ago';
  return 'updated ' + Math.floor(h / 24) + ' days ago';
}

// ---- today's realised P&L from the broker's fills (header strip RP&L for live accounts, 2026-11-19) ------------------------
// fills: FDXBrokerOrderFill rows { fillId, orderId, securityId, side, quantity, price, executedAt, commission }. Matched FIFO per
// contract (point value from ROOTS); commissions of today's fills are subtracted (net, like paper's day P&L). The position held at the
// start of the day is netNow - (today's signed fills): when it is not flat its cost is unknown, so the result is marked incomplete and
// the caller falls back to the broker's own realised figure. -> { value, fills, complete, why }
const fillTime = (f) => { for (const k of ['executedAt', 'executed_at', 'filledAt', 'fillTime', 'timestamp', 'time', 'createdAt']) { const v = f && f[k]; if (v != null && v !== '') { const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v)); if (Number.isFinite(t)) return t; } } return null; };
export function dayRealized(fills, positions, dayStartMs) {
  const seen = new Set(), by = new Map();
  let fees = 0, n = 0, unknown = 0;
  for (const f of Array.isArray(fills) ? fills : []) {
    if (!f || typeof f !== 'object') continue;
    const id = String(f.fillId || f.id || f.executionId || '') || (String(f.orderId) + '|' + fillTime(f) + '|' + f.price + '|' + f.quantity);
    if (seen.has(id)) continue; seen.add(id);
    const t = fillTime(f); if (t == null) { unknown++; continue; }
    if (t < dayStartMs) continue;
    const code = contractOf(f), pv = (ROOTS[rootOfCode(code)] || {}).pv;
    const q = Math.abs(num(f.quantity != null ? f.quantity : f.qty)), px = num(f.price != null ? f.price : f.fillPrice);
    if (!code || !pv || !q || !(px > 0)) { unknown++; continue; }
    const side = String(f.side || f.action || '').toLowerCase().startsWith('s') ? -1 : 1;
    if (!by.has(code)) by.set(code, []);
    by.get(code).push({ t, q: side * q, px, pv });
    fees += Math.abs(num(f.commission)); n++;
  }
  let value = 0, complete = unknown === 0;
  for (const [code, list] of by) {
    list.sort((a, b) => a.t - b.t);
    const today = list.reduce((s, x) => s + x.q, 0), start = netPosition(positions, code).qty - today;
    if (start) complete = false;   // carried in from an earlier day: its cost basis is not in today's fills
    const lots = [];   // open lots { q (signed), px }
    for (const x of list) {
      let q = x.q;
      while (q && lots.length && Math.sign(lots[0].q) !== Math.sign(q)) {
        const m = Math.min(Math.abs(q), Math.abs(lots[0].q));
        value += (x.px - lots[0].px) * m * Math.sign(lots[0].q) * x.pv;
        lots[0].q -= Math.sign(lots[0].q) * m; q -= Math.sign(q) * m;
        if (!lots[0].q) lots.shift();
      }
      if (q) lots.push({ q, px: x.px });
    }
  }
  value = Math.round((value - fees) * 100) / 100;
  return { value, fills: n, complete, why: complete ? '' : unknown ? 'Some fills could not be read.' : 'A position was carried in from an earlier day.' };
}
// broker's own realised P&L of positions closed / updated today (fallback when fills can't give it) -> number | null
export function positionsRealized(positions, dayStartMs) {
  let s = null;
  for (const p of Array.isArray(positions) ? positions : []) {
    const r = numOf(p && (p.realizedProfitLossWithCommission != null ? p.realizedProfitLossWithCommission : p.realizedProfitLoss)); if (r == null) continue;
    const t = stampOf({ updatedAt: p.positionClosedAt || p.positionUpdatedAt || p.snapshotDate }); if (t == null || t < dayStartMs) continue;
    s = (s || 0) + r;
  }
  return s == null ? null : Math.round(s * 100) / 100;
}
// open P&L of every open position: (last - avg) x qty x point value per contract; lastOf(root) gives the chart's last price.
// Falls back to the broker's per-position figure; null when a position can't be priced either way. -> { value, open }
export function openTotal(positions, lastOf) {
  const codes = new Set(); for (const p of Array.isArray(positions) ? positions : []) { const c = contractOf(p); if (c) codes.add(c); }
  let v = 0, open = 0, missing = false;
  for (const code of codes) {
    const n = netPosition(positions, code); if (!n.qty) continue; open++;
    const root = rootOfCode(code), last = lastOf ? lastOf(root) : undefined;
    const x = openPnl(n.qty, n.avg, Number.isFinite(last) ? last : null, (ROOTS[root] || {}).pv, n.upl);
    if (x == null || !Number.isFinite(x)) missing = true; else v += x;
  }
  // positions in symbols we can't map (not one of the four roots) count as missing
  for (const p of Array.isArray(positions) ? positions : []) if (p && !contractOf(p) && num(p.quantity != null ? p.quantity : p.units) && String(p.status || 'OPEN').toUpperCase() !== 'CLOSED') { open++; missing = true; }
  return { value: missing ? null : Math.round(v * 100) / 100, open };
}
// "$50,312.40" / "€1,200.00" / "-$12.50"; '' for nothing; sign option for P&L ("+$120.00")
export function fmtMoney(n, cur, sign) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const c = /^[A-Z]{3}$/.test(str(cur).toUpperCase()) ? str(cur).toUpperCase() : 'USD';
  let t; try { t = new Intl.NumberFormat('en-US', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n)); } catch (e) { t = c + ' ' + Math.abs(n).toFixed(2); }
  return (n < 0 ? '-' : sign && n > 0 ? '+' : '') + t;
}
// ---- per-account notes the admin adds (pencil): label, prop firm, account type -------------------------------------------
export const FIRMS = ['Apex', 'Topstep', 'Tradeify', 'Take Profit Trader', 'My Funded Futures', 'Lucid', 'Bulenox', 'Alpha Futures', 'Elite Trader Funding', 'Earn2Trade', 'The Trading Pit', 'Own account'];
export const TYPES = [['eval', 'Evaluation'], ['funded', 'Funded'], ['live', 'Live'], ['sim', 'Sim']];
const clip = (v, n) => str(v).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').slice(0, n).trim();
// -> { label, firm, type } with every field cleaned ('' when empty); the same limits are in firestore.rules
export function cleanMeta(m) {
  const o = m && typeof m === 'object' ? m : {};
  const type = TYPES.some(([k]) => k === o.type) ? o.type : '';
  return { label: clip(o.label, 40), firm: clip(o.firm, 40), type };
}
export const typeName = (k) => { const t = TYPES.find(([x]) => x === k); return t ? t[1] : ''; };
// row / button wording: name = label or broker; full = "Apex eval 1 · Apex · Tradovate APEX-123456-01"
export function acctTitle(a, meta) {
  const m = cleanMeta(meta);
  const name = m.label || a.broker;
  const full = [m.label, m.firm, a.text].filter(Boolean).join(' · ');
  return { name, full, firm: m.firm, type: typeName(m.type) };
}
// open P&L estimate from the chart's last price (contract spec point value), or the broker's figure when no price
export function openPnl(pos, avg, last, pv, brokerUpl) {
  if (pos && avg > 0 && last > 0) return (last - avg) * pos * pv;
  return brokerUpl == null ? null : brokerUpl;
}

// ---- stop loss / take profit on live market entries (Owner order 2026-11-17) ----------------------------------------------
// The broker link has no native bracket / OCO order (its OCO / BRACKET classes are read-only labels), but it takes STOP orders
// (order type enum MARKET | LIMIT | STOP | STOP_LIMIT | TRAILING_STOP; what an account really takes is in its place schema,
// supportedOrderTypesByAssetClass). So a bracket is: the market entry, then after it fills a protective STOP (stop loss) and a LIMIT
// (take profit), both GTC, and when one fills the server cancels the other. The group lives server-side (Firestore brokerBrackets,
// one per account + contract) so the server only ever touches ids it recorded itself.
// order types an account's place schema allows for an asset class -> ['market', 'limit', 'stop', ...] | null (schema doesn't say)
export function orderTypesFor(schema, asset = 'future') {
  const norm = (a) => (Array.isArray(a) ? a.map((x) => String(x).toLowerCase().replace(/[^a-z]/g, '_')) : null);
  const seen = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 6 || seen.has(o)) return null; seen.add(o);
    const s = o.supportedOrderTypesByAssetClass || o.supported_order_types_by_asset_class;
    if (s && typeof s === 'object') {
      for (const k of Object.keys(s)) if (new RegExp('^' + asset + 's?$', 'i').test(k)) return norm(s[k]);
      return [];
    }
    for (const k of Object.keys(o)) { const r = walk(o[k], d + 1); if (r) return r; }
    return null;
  };
  const byClass = walk(schema, 0); if (byClass) return byClass;
  // fallback: a JSON-schema enum for orderType
  const en = (o, d) => { if (!o || typeof o !== 'object' || d > 8) return null; for (const k of Object.keys(o)) { if (/^order_?type$/i.test(k) && o[k] && Array.isArray(o[k].enum)) return norm(o[k].enum); const r = en(o[k], d + 1); if (r) return r; } return null; };
  return en(schema, 0);
}
export const stopsSupported = (schema) => { const t = orderTypesFor(schema); return !!t && t.includes('stop'); };
// one bracket group per account + contract (Firestore doc id)
export const groupId = (account, code) => String(account) + '_' + String(code).toUpperCase();
// FDX order status families
export const FILLED = /^(FILLED)$/;
export const FINAL_NOT_FILLED = /^(CANCELLED|CANCELED|REJECTED|EXPIRED|FAILED|REPLACED)$/;
export const isWorking = (status) => WORKING.test(String(status || '').toUpperCase());
// the broker's record for one order id (any status) -> { id, status, type, price, qty } | null
export function orderById(orders, id) {
  if (!id) return null;
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || String(o.orderId || o.id || '') !== String(id)) continue;
    const leg = (o.legs || [])[0] || {};
    return { id: String(id), status: String(o.status || '').toUpperCase(), type: String(o.orderType || leg.orderType || '').toLowerCase(), qty: num(leg.quantity != null ? leg.quantity : o.orderQty), filled: num(leg.filledQuantity != null ? leg.filledQuantity : o.filledQuantity) };
  }
  return null;
}
// SL / TP for an entry: side 'buy' = long (SL below the reference, TP above), 'sell' = short. ref = last price (browser) or the
// fill price (server). Rounded to the tick; each leg within `pct` of the reference. -> { sl, tp } | { error }
export function bracketCheck({ side, ref, sl, tp, code, pct = 0.03 }) {
  const tick = ROOTS[rootOfCode(code)] ? ROOTS[rootOfCode(code)].tick : 0.25;
  const out = {};
  const r = (v) => (v == null || v === '' ? null : Number(roundTick(Number(v), tick).toFixed(2)));
  out.sl = r(sl); out.tp = r(tp);
  if (out.sl == null && out.tp == null) return { error: 'Set a stop loss or a take profit.' };
  for (const k of ['sl', 'tp']) if (out[k] != null && !(out[k] > 0 && out[k] < 1e7)) return { error: (k === 'sl' ? 'Stop loss' : 'Take profit') + ' price is not valid.' };
  const long = side === 'buy';
  if (out.sl != null && out.tp != null && (long ? out.sl >= out.tp : out.sl <= out.tp)) return { error: long ? 'For a buy, the stop loss must be below the take profit.' : 'For a sell, the stop loss must be above the take profit.' };
  if (ref > 0) {
    if (out.sl != null && (long ? out.sl >= ref : out.sl <= ref)) return { error: 'The stop loss must be ' + (long ? 'below' : 'above') + ' the price (' + ref.toFixed(2) + ').' };
    if (out.tp != null && (long ? out.tp <= ref : out.tp >= ref)) return { error: 'The take profit must be ' + (long ? 'above' : 'below') + ' the price (' + ref.toFixed(2) + ').' };
    for (const k of ['sl', 'tp']) if (out[k] != null && Math.abs(out[k] - ref) / ref > pct) return { error: (k === 'sl' ? 'Stop loss' : 'Take profit') + ' is more than ' + Math.round(pct * 100) + '% away from the price.' };
  }
  return out;
}
// What the server's bracket sync should do now, from a fresh read. g = the server's group record. -> { act, ... }
//   wait      entry still working (or part-filled)            place  entry filled: place the children (qty, exitSide, ref = avg)
//   oco       one child filled: cancel the other (cancel[])   flatcheck  flat but children still working: cancel them (2nd read first)
//   resize    a child part-filled: shrink the other (id, qty) alarm  position open and no working stop loss (why)
//   drop      nothing left to manage (why)                    ok     all good
export function bracketPlan(g, positions, orders) {
  const P = netPosition(positions, g.code), pos = P.qty, long = g.side === 'buy';
  const rem = (o) => Math.max(0, o.qty - o.filled);
  if (g.state === 'pending') {
    const e = orderById(orders, g.entryId);
    if (e && e.status === 'PARTIALLY_FILLED') return { act: 'wait' };
    if (e && isWorking(e.status)) return { act: 'wait' };
    const filled = e ? FILLED.test(e.status) : (long ? pos > 0 : pos < 0);
    if (!filled) return e && FINAL_NOT_FILLED.test(e.status) ? { act: 'drop', why: 'The entry order was not filled.' } : { act: 'wait' };
    if (long ? pos <= 0 : pos >= 0) return { act: 'drop', why: 'The position was already closed.' };
    return { act: 'place', qty: Math.min(g.qty, Math.abs(pos)), exitSide: long ? 'sell' : 'buy', ref: P.avg || 0 };
  }
  const s = orderById(orders, g.slId), t = orderById(orders, g.tpId);
  const sW = !!(s && isWorking(s.status)), tW = !!(t && isWorking(t.status));
  if (s && FILLED.test(s.status)) return { act: 'oco', cancel: tW ? [g.tpId] : [], why: 'Stop loss filled.' };
  if (t && FILLED.test(t.status)) return { act: 'oco', cancel: sW ? [g.slId] : [], why: 'Take profit filled.' };
  if (!pos) return sW || tW ? { act: 'flatcheck', cancel: [sW ? g.slId : '', tW ? g.tpId : ''].filter(Boolean), why: 'The position was closed.' } : { act: 'drop', why: 'The position was closed.' };
  if (long ? pos < 0 : pos > 0) return { act: 'alarm', why: 'The position is now the other way round. Check your broker.' };
  if (g.sl != null && !sW) return { act: 'alarm', why: g.slId ? 'The stop loss is no longer working at the broker. The position has no stop.' : 'No stop loss is working. The position has no stop.' };
  for (const [o, id] of [[s, g.slId], [t, g.tpId]]) if (o && isWorking(o.status) && rem(o) > Math.abs(pos)) return { act: 'resize', id, qty: Math.abs(pos) };
  return { act: 'ok' };
}
