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
// "Tradovate …1234": broker name + last 4 of the broker account number (falls back to the id)
export function acctLabel(a) {
  const broker = String(a.broker || a.brokerName || a.brokerId || 'Broker');
  const nice = broker.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const raw = String(a.number || a.brokerAccountId || a.accountNumber || a.name || a.accountName || a.id || '').replace(/[^A-Za-z0-9]/g, '');
  return { broker: nice, last4: raw.slice(-4), text: nice + ' …' + raw.slice(-4) };
}
// open P&L estimate from the chart's last price (contract spec point value), or the broker's figure when no price
export function openPnl(pos, avg, last, pv, brokerUpl) {
  if (pos && avg > 0 && last > 0) return (last - avg) * pos * pv;
  return brokerUpl == null ? null : brokerUpl;
}
