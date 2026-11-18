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
export function buildPlace({ code, side, qty, type, price }, now) {
  if (!validContract(code, now)) return { error: 'No live contract for this chart.' };
  if (side !== 'buy' && side !== 'sell') return { error: 'Pick Buy or Sell.' };
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: 'Quantity is 1 or 2 contracts.' };
  if (type !== 'market' && type !== 'limit') return { error: 'Market or limit only.' };
  const body = { op: 'place', symbol: code, side, qty, type, assetType: 'future', timeInForce: 'day' };
  if (type === 'limit') {
    const tick = ROOTS[rootOfCode(code)].tick;
    if (!(Number(price) > 0)) return { error: 'Enter a limit price.' };
    body.limitPrice = Number(roundTick(Number(price), tick).toFixed(2));
  }
  return { body };
}
export function buildModify({ id, price, code }) {
  if (!id) return { error: 'Order missing.' };
  const tick = ROOTS[rootOfCode(code)] ? ROOTS[rootOfCode(code)].tick : 0.25;
  if (!(Number(price) > 0)) return { error: 'Price invalid.' };
  return { body: { op: 'modify', orderId: id, type: 'limit', limitPrice: Number(roundTick(Number(price), tick).toFixed(2)) } };
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
  const price = body.type === 'limit' ? Number(body.limitPrice) : Number(last);
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
// Balances: Finatic returns a list (one row per currency / balance kind), each value a number OR a numeric string. Total money =
// net liquidation / account value first, then total cash, then cash, then current, then available. Open P&L when given.
const VAL_KEYS = ['netLiquidationValue', 'net_liquidation_value', 'netLiquidation', 'accountValue', 'account_value', 'totalValue', 'total_value', 'equity',
  'totalCashValue', 'total_cash_value', 'cashBalance', 'cash_balance', 'currentBalance', 'current_balance', 'balance', 'availableBalance', 'available_balance'];
const UPL_KEYS = ['unrealizedPnl', 'unrealized_pnl', 'unrealizedProfitLoss', 'unrealized_profit_loss', 'openPnl', 'open_pnl', 'totalUnrealizedPnl', 'openTradeEquity', 'open_trade_equity'];
const numOf = (v) => { if (v == null || v === '' || typeof v === 'boolean') return null; if (typeof v === 'object') v = v.amount != null ? v.amount : v.value; const n = Number(String(v).replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : null; };
export function balanceOf(rows, cur) {
  const list = (Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : []).filter((r) => r && typeof r === 'object');
  if (!list.length) return null;
  const want = str(cur).toUpperCase() || 'USD';
  const curOf = (r) => str(r.currencyCode || r.currency_code || r.currency).toUpperCase();
  list.sort((a, b) => (curOf(b) === want) - (curOf(a) === want));
  for (const k of VAL_KEYS) for (const r of list) {
    const n = numOf(r[k]); if (n == null) continue;
    let upl = null; for (const u of UPL_KEYS) { const x = numOf(r[u]); if (x != null) { upl = x; break; } }
    return { amount: n, currency: curOf(r) || want, upl, kind: k };
  }
  return null;
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
