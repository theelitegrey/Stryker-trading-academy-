// ADMIN-ONLY order TEST routes for the Finatic integration (Owner exception 2026-11-04). POST {op, accountId, ...}.
//   schema -> GET  /accounts/{id}/order-schemas?action=place|modify|cancel
//   place  -> POST /accounts/{id}/orders          cancel -> DELETE /accounts/{id}/orders/{orderId}          modify -> PATCH /accounts/{id}/orders/{orderId}
// Guards, in order: not configured 503 · origin/JSON/IP limit · unsigned 401 · non-admin 403 · live without FINATIC_LIVE_ORDERS=1 403 "Live orders are off"
// · 10 orders/min per admin · body whitelist (unknown fields dropped, qty cap) · audit row written BEFORE the order (no audit, no order).
import { gate, readBody, fin, startSession, sessionHeaders, ordersBlocked, envMode, json, fail, UUID, ID } from './_fin.js';
import { openAudit } from './_audit.js';

export const MAX_FUT = 2, MAX_EQ = 100, ORDERS_PER_MIN = 10;
const TYPES = ['market', 'limit', 'stop'], TIFS = ['day', 'gtc', 'ioc', 'fok'], ASSETS = ['future', 'equity'];
const SYMBOL = /^[A-Z0-9][A-Z0-9._\-]{0,19}$/;
const mem = new Map();
export async function orderRateLimited(env, uid) {
  const min = Math.floor(Date.now() / 60000), key = 'rl:finorder:' + uid + ':' + min;
  try {
    if (env.PASSKEYS) { const n = Number(await env.PASSKEYS.get(key)) || 0; if (n >= ORDERS_PER_MIN) return true; await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 }); return false; }
    for (const k of mem.keys()) if (!k.endsWith(':' + min)) mem.delete(k);
    const n = (mem.get(key) || 0) + 1; mem.set(key, n); return n > ORDERS_PER_MIN;
  } catch (e) { return true; }
}
export const _resetRate = () => mem.clear();

// -> { order } | { error }. Only whitelisted fields leave this function.
export function cleanOrder(b, { partial } = {}) {
  const o = {};
  const asset = b.assetType === undefined && partial ? undefined : String(b.assetType || 'future').toLowerCase();
  if (asset !== undefined) { if (!ASSETS.includes(asset)) return { error: 'assetType must be future or equity' }; o.assetType = asset; }
  if (!partial) {
    const symbol = String(b.symbol || '').toUpperCase().trim(); if (!SYMBOL.test(symbol)) return { error: 'symbol invalid' }; o.symbol = symbol;
    const side = String(b.side || '').toLowerCase(); if (side !== 'buy' && side !== 'sell') return { error: 'side must be buy or sell' }; o.action = side;
    const type = String(b.type || '').toLowerCase(); if (!TYPES.includes(type)) return { error: 'type must be market, limit or stop' }; o.orderType = type;
  } else if (b.type !== undefined) { const type = String(b.type).toLowerCase(); if (!TYPES.includes(type)) return { error: 'type must be market, limit or stop' }; o.orderType = type; }
  if (!partial || b.qty !== undefined) {
    const q = Number(b.qty), cap = (o.assetType || 'future') === 'equity' ? MAX_EQ : MAX_FUT;
    if (!Number.isInteger(q) || q < 1) return { error: 'qty must be a positive whole number' };
    if (q > cap) return { error: 'qty is capped at ' + cap + (cap === 2 ? ' contracts' : ' shares') };
    o.orderQty = q;
  }
  const price = (v, name) => { const n = Number(v); return isFinite(n) && n > 0 && n < 1e7 ? n : null; };
  if (b.limitPrice !== undefined && b.limitPrice !== '') { const n = price(b.limitPrice); if (n === null) return { error: 'limitPrice invalid' }; o.limitPrice = n; }
  if (b.stopPrice !== undefined && b.stopPrice !== '') { const n = price(b.stopPrice); if (n === null) return { error: 'stopPrice invalid' }; o.stopPrice = n; }
  if (o.orderType === 'limit' && o.limitPrice === undefined) return { error: 'limit order needs limitPrice' };
  if (o.orderType === 'stop' && o.stopPrice === undefined) return { error: 'stop order needs stopPrice' };
  if (o.orderType === 'market') { delete o.limitPrice; delete o.stopPrice; }
  if (o.orderType === 'limit') { o.price = o.limitPrice; delete o.limitPrice; }   // Finatic/Tradovate limit orders require `price` (422 on limitPrice alone, found in sandbox)
  if (b.timeInForce !== undefined || !partial) { const t = String(b.timeInForce || 'day').toLowerCase(); if (!TIFS.includes(t)) return { error: 'timeInForce invalid' }; o.timeInForce = t; }
  return { order: o };
}

export async function handle(request, env, deps = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const g = await gate(request, env, deps, 'finatic-order');
  if (g instanceof Response) return g;
  const b = await readBody(request);
  if (!b || typeof b !== 'object') return fail(400, 'Bad request');
  const op = b.op;
  if (op === 'env') return json({ env: envMode(env), enabled: ordersBlocked(env) === null });   // for the badge; admin only (gate above)
  const blocked = ordersBlocked(env); if (blocked) return blocked;
  if (op !== 'schema' && op !== 'place' && op !== 'cancel' && op !== 'modify') return fail(400, 'Not allowed');
  if (!(typeof b.accountId === 'string' && UUID.test(b.accountId))) return fail(400, 'accountId missing');
  if ((op === 'cancel' || op === 'modify') && !(typeof b.orderId === 'string' && ID.test(b.orderId))) return fail(400, 'orderId missing');
  if (op === 'schema' && !['place', 'modify', 'cancel'].includes(b.action)) return fail(400, 'action invalid');
  let order = null;
  if (op === 'place' || op === 'modify') { const c = cleanOrder(b, { partial: op === 'modify' }); if (c.error) return fail(400, c.error); order = c.order; if (op === 'modify' && Object.keys(order).length < 2) return fail(400, 'nothing to change'); }
  if (op !== 'schema' && await orderRateLimited(env, g.uid)) return fail(429, 'Order limit: 10 a minute');

  let userId = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
  if (!userId) return json({ error: 'Not connected yet', needsConnect: true }, 409);
  const s = await startSession(env, deps, userId);
  if (!s || !s.authenticated) return json({ error: 'Not connected yet', needsConnect: true }, 409);
  const h = sessionHeaders(s);
  const A = '/api/v1/accounts/' + encodeURIComponent(b.accountId);

  if (op === 'schema') {
    const r = await fin(env, deps, 'GET', A + '/order-schemas', { headers: h, query: { action: b.action } });
    return r.ok ? json({ data: r.data, env: envMode(env) }) : fail(r.status === 403 ? 403 : 502, r.status === 403 ? 'Trading is not enabled for this account yet' : 'Broker data is unavailable right now');
  }

  const entry = { uid: g.uid, env: envMode(env), op, account: b.accountId, symbol: order ? (order.symbol || '') : '', side: order ? (order.action || '') : '', qty: order && order.orderQty ? order.orderQty : 0, type: order ? (order.orderType || '') : '', orderId: b.orderId || '' };
  let audit;
  try { audit = await openAudit(env, deps, entry); } catch (e) { return fail(503, 'Audit log unavailable, order not sent'); }
  const idem = (deps.uuid || (() => crypto.randomUUID()))();
  const sandbox = envMode(env) === 'sandbox';
  let r;
  if (op === 'place') r = await fin(env, deps, 'POST', A + '/orders', { headers: { ...h, 'Idempotency-Key': idem }, body: { order, paperTradeConfirmed: sandbox } });
  else if (op === 'modify') r = await fin(env, deps, 'PATCH', A + '/orders/' + encodeURIComponent(b.orderId), { headers: { ...h, 'Idempotency-Key': idem }, body: { order, paperTradeConfirmed: sandbox } });
  else r = await fin(env, deps, 'DELETE', A + '/orders/' + encodeURIComponent(b.orderId), { headers: { ...h, 'Idempotency-Key': idem }, query: { paperTradeConfirmed: sandbox ? 'true' : undefined } });
  const res = r.data && r.data.order ? r.data : (r.data || {});
  const brokerOrderId = String((res.order && (res.order.orderId || res.order.brokerOrderId)) || b.orderId || '');
  const accepted = r.ok && res.accepted !== false;
  await audit.finish({ result: accepted ? 'accepted' : 'rejected', httpStatus: r.status, brokerOrderId, message: String(res.message || '').slice(0, 200) });
  if (!accepted) return fail(r.status === 403 ? 403 : r.status === 429 ? 429 : 502, r.status === 403 ? 'Trading is not enabled for this account yet' : (res.message ? String(res.message).slice(0, 200) : 'The broker did not accept the order'));
  return json({ ok: true, op, env: envMode(env), orderId: brokerOrderId, status: res.order && res.order.status || '', accepted: true });
}
export const onRequest = ({ request, env }) => handle(request, env);
