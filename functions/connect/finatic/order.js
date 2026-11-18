// ADMIN-ONLY order TEST routes for the Finatic integration (Owner exception 2026-11-04). POST {op, accountId, ...}.
//   schema -> GET  /accounts/{id}/order-schemas?action=place|modify|cancel
//   place  -> POST /accounts/{id}/orders          cancel -> DELETE /accounts/{id}/orders/{orderId}          modify -> PATCH /accounts/{id}/orders/{orderId}
// Guards, in order: not configured 503 · origin/JSON/IP limit · unsigned 401 · non-admin 403 · live without FINATIC_LIVE_ORDERS=1 403 "Live orders are off"
// · 10 orders/min per admin · body whitelist (unknown fields dropped, qty cap) · audit row written BEFORE the order (no audit, no order).
// CHART LIVE ORDERS (Owner order 2026-11-15, src:'chart' from assets/chart-live.js), on top of every guard above:
// · live env: the kill switch settings/liveTrading must not say enabled:false (unreadable = refused) · idemKey required: it is the
//   Idempotency-Key AND the audit doc id, so a repeated key is answered 409 duplicate and never reaches the broker twice
// · contract whitelist (NQ/ES/MNQ/MES, the two nearest live quarters; assets/chart-live-core.js, the same code the chart uses)
// · market + limit only; modify = limit price only · a FRESH positions + orders read before every place: worst-case net exposure
//   (position + working orders + this order) stays within 2 contracts, unreadable = refused
// · flatten runs here, not in the browser: cancel the contract's working orders, re-read until they are gone, re-read the position,
//   then ONE market order for the net (refused above 2); deterministic key from the position snapshot, so a double tap is deduped
// · no answer from the broker = code 'unknown' (the chart blocks new orders until a read settles it).
// SPEED (Owner order 2026-11-16): independent pre-send steps run in parallel (order rate limit, kill switch, Finatic session), the session
// is cached per isolate (_fin.js cachedSession, 2 min) and the poll / 'env' call warm it, the fresh read fetches positions and orders
// in parallel WITH the audit 'attempt' row (both must succeed before anything is sent), and the audit result row is written after the
// reply (deps.defer = ctx.waitUntil). Every reply carries Server-Timing (rl, auth, admin, gate, sess, read, audit, fin, total).
import { gate, readBody, cachedSession, finSession, ordersBlocked, envMode, json, fail, needsConnect, methodNotAllowed, safe, pagesEntry, deferOf, UPSTREAM_MSG, UUID, ID } from './_fin.js';
import { openAudit, liveSwitchOn } from './_audit.js';
import { validContract, workingOrders, netPosition, exposureError, flattenPlan, IDEM, MAX_QTY } from '../../../assets/chart-live-core.js';

export const MAX_FUT = 2, MAX_EQ = 100, ORDERS_PER_MIN = 10;
const TYPES = ['market', 'limit', 'stop'], TIFS = ['day', 'gtc', 'ioc', 'fok'], ASSETS = ['future', 'equity'];
const SYMBOL = /^[A-Z0-9][A-Z0-9._\-]{0,19}$/;
const mem = new Map();
// 10 orders a minute per admin. The in-isolate count is checked FIRST (exact for this isolate, no wait); the KV count (shared across
// isolates) is read too and its write goes out after the reply. Both must be under the limit.
export async function orderRateLimited(env, uid, defer) {
  const min = Math.floor(Date.now() / 60000), key = 'rl:finorder:' + uid + ':' + min;
  try {
    if (env.PASSKEYS) {
      for (const k of mem.keys()) if (!k.endsWith(':' + min)) mem.delete(k);
      const local = (mem.get(key) || 0) + 1; mem.set(key, local); if (local > ORDERS_PER_MIN) return true;
      const n = Number(await env.PASSKEYS.get(key)) || 0; if (n >= ORDERS_PER_MIN) return true;
      const w = env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 }); if (defer) defer(w); else await w; return false;
    }
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

async function run(request, env, deps) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const g = await gate(request, env, deps, 'finatic-order');
  if (g instanceof Response) return g;
  const b = await readBody(request);
  if (!b || typeof b !== 'object') return fail(400, 'Bad request');
  const op = b.op;
  if (op === 'env') {   // for the badge; admin only (gate above). Also the chart's pre-warm when the panel opens: starts the Finatic
    // session for this user (cached 2 min) and reads the kill switch (cached 5 s) after the reply, so the first order skips both.
    const u = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
    if (u && ordersBlocked(env) === null) (deps.defer || deferOf(null))(Promise.all([cachedSession(env, deps, u), envMode(env) === 'live' ? liveSwitchOn(env, deps) : null]));
    return json({ env: envMode(env), enabled: ordersBlocked(env) === null });
  }
  const blocked = ordersBlocked(env); if (blocked) return blocked;
  const chart = b.src === 'chart';
  if (op !== 'schema' && op !== 'place' && op !== 'cancel' && op !== 'modify' && !(op === 'flatten' && chart)) return fail(400, 'Not allowed');
  if (!(typeof b.accountId === 'string' && UUID.test(b.accountId))) return fail(400, 'accountId missing');
  if ((op === 'cancel' || op === 'modify') && !(typeof b.orderId === 'string' && ID.test(b.orderId))) return fail(400, 'orderId missing');
  if (op === 'schema' && !['place', 'modify', 'cancel'].includes(b.action)) return fail(400, 'action invalid');
  const now = (deps.now || Date.now)();
  if (chart && op !== 'schema') {
    if (!(typeof b.idemKey === 'string' && IDEM.test(b.idemKey))) return fail(400, 'idemKey missing');
    if ((op === 'place' || op === 'flatten') && !validContract(b.symbol, now)) return fail(400, 'Not a tradable contract');
    if (op === 'place' && !['market', 'limit'].includes(String(b.type || '').toLowerCase())) return fail(400, 'Market or limit only');
    if (op === 'modify' && (String(b.type || 'limit').toLowerCase() !== 'limit' || b.qty !== undefined || b.stopPrice !== undefined)) return fail(400, 'Only the limit price can be changed');
  }
  let order = null;
  if (op === 'place' || op === 'modify') { const c = cleanOrder(b, { partial: op === 'modify' }); if (c.error) return fail(400, c.error); order = c.order; if (op === 'modify' && Object.keys(order).length < 2) return fail(400, 'nothing to change'); }
  let userId = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
  const t = deps.t, defer = deps.defer || deferOf(null), live = envMode(env) === 'live';
  // independent checks in parallel; each verdict is applied below in the old order (rate limit, kill switch, session)
  const [limited, sw, s0] = await t.step('gate', Promise.all([
    op !== 'schema' ? orderRateLimited(env, g.uid, defer) : false,
    op !== 'schema' && live ? liveSwitchOn(env, deps).then((v) => ({ v }), () => ({ err: true })) : { v: true },   // kill switch, fails closed
    userId ? cachedSession(env, deps, userId) : null,
  ]));
  if (limited) return fail(429, 'Order limit: 10 a minute');
  if (sw.err) return fail(503, 'Live trading switch could not be read, order not sent', 'switch_unreadable');
  if (!sw.v) return fail(403, 'Live trading is switched off', 'switched_off');
  if (!userId) return needsConnect();
  let s = s0;
  if (s.failed) return s.staleUser ? needsConnect() : fail(502, UPSTREAM_MSG, 'upstream');
  if (!s.authenticated) return needsConnect();
  const A = '/api/v1/accounts/' + encodeURIComponent(b.accountId);
  // one call on the (maybe cached) session; a 401 from a cached session renews it once (finSession)
  let renewFail = false;
  const call = async (method, path, opts) => { const x = await finSession(env, deps, userId, s, method, path, opts); if (x.s !== s) { if (x.s.failed || !x.s.authenticated) renewFail = true; else s = x.s; } return x.r; };

  if (op === 'schema') {
    const r = await call('GET', A + '/order-schemas', { query: { action: b.action } });
    return r.ok ? json({ data: r.data, env: envMode(env) }) : fail(r.status === 403 ? 403 : 502, r.status === 403 ? 'Trading is not enabled for this account yet' : 'Broker data is unavailable right now');
  }
  const read = async () => {
    const [p, o] = await Promise.all([call('GET', A + '/positions', { query: { limit: 200 } }), call('GET', A + '/orders', { query: { limit: 200 } })]);
    return p.ok && o.ok ? { positions: Array.isArray(p.data) ? p.data : [], orders: Array.isArray(o.data) ? o.data : [] } : null;
  };

  const entry = { uid: g.uid, env: envMode(env), op, src: chart ? 'chart' : 'journal', account: b.accountId, symbol: order ? (order.symbol || '') : (op === 'flatten' ? String(b.symbol).toUpperCase() : ''), side: order ? (order.action || '') : '', qty: order && order.orderQty ? order.orderQty : 0, type: order ? (order.orderType || '') : '', orderId: b.orderId || '' };
  // audit 'attempt' row: written before anything is sent (no audit, no order; also the duplicate guard for the idemKey).
  // For a chart place / flatten it runs in parallel with the fresh read that has to happen anyway.
  const opened = t.step('audit', openAudit(env, deps, entry, chart ? b.idemKey : undefined).then((a) => ({ a }), (e) => ({ e })));
  const needRead = chart && (op === 'place' || op === 'flatten');
  // single flight per account in this isolate: a second place/flatten waits for the first to answer, so both cannot pass the exposure
  // check on the same read (advisor review 16 Nov). Costs nothing for one order at a time.
  const release = needRead ? await t.step('queue', acquire(b.accountId)) : () => {};
  try {
  const [au, st0] = await Promise.all([opened, needRead ? t.step('read', read()) : null]);
  if (au.e) return au.e && au.e.duplicate ? json({ error: 'This order was already sent once. Nothing new was sent.', code: 'duplicate', duplicate: true }, 409) : fail(503, 'Audit log unavailable, order not sent');
  const audit = { id: au.a.id, finish: (res) => defer(au.a.finish(res)) };   // the result row goes out after the reply, never skipped
  if (renewFail) { audit.finish({ result: 'rejected', message: 'session renew failed' }); return needsConnect(); }
  if (chart && op === 'place') {   // fresh read, worst-case exposure
    if (!st0) { audit.finish({ result: 'rejected', message: 'read failed' }); return fail(503, 'Could not read positions and orders, order not sent', 'read_failed'); }
    const err = exposureError(netPosition(st0.positions, order.symbol).qty, workingOrders(st0.orders, order.symbol), order.action, order.orderQty);
    if (err) { audit.finish({ result: 'rejected', message: 'exposure' }); return fail(409, err, 'exposure'); }
  }
  const idem = chart ? b.idemKey : (deps.uuid || (() => crypto.randomUUID()))();
  const sandbox = envMode(env) === 'sandbox';
  const send = (method, path, key, body) => call(method, path, { headers: { 'Idempotency-Key': key }, ...(body ? { body } : { query: { paperTradeConfirmed: sandbox ? 'true' : undefined } }) });

  if (op === 'flatten') return await flatten(env, deps, b, A, send, read, audit, sandbox, st0);
  let r;
  if (op === 'place') r = await send('POST', A + '/orders', idem, { order, paperTradeConfirmed: sandbox });
  else if (op === 'modify') r = await send('PATCH', A + '/orders/' + encodeURIComponent(b.orderId), idem, { order, paperTradeConfirmed: sandbox });
  else r = await send('DELETE', A + '/orders/' + encodeURIComponent(b.orderId), idem);
  const res = r.data && r.data.order ? r.data : (r.data || {});
  const brokerOrderId = String((res.order && (res.order.orderId || res.order.brokerOrderId)) || b.orderId || '');
  const unknown = r.status === 0 || r.status >= 500 || r.bad;   // timeout / network / garbage: it may or may not have reached the broker
  const accepted = r.ok && res.accepted !== false;
  audit.finish({ result: accepted ? 'accepted' : unknown ? 'unknown' : 'rejected', httpStatus: r.status, brokerOrderId, message: String(res.message || '').slice(0, 200) });
  if (!accepted && unknown && chart) return fail(502, 'No clear answer from the broker. The order may or may not have gone through. Checking positions and orders.', 'unknown');
  if (!accepted) return fail(r.status === 403 ? 403 : r.status === 429 ? 429 : 502, r.status === 403 ? 'Trading is not enabled for this account yet' : (res.message ? String(res.message).slice(0, 200) : 'The broker did not accept the order'));
  return json({ ok: true, op, env: envMode(env), orderId: brokerOrderId, status: res.order && res.order.status || '', accepted: true, strategy: res.executionStrategy || '', superseded: res.supersededOrderId || '' });
  } finally { release(); }
}
const locks = new Map();
// -> release(). Waits for the previous holder (max 15 s, then goes ahead: a stuck request must not block the account forever).
function acquire(key) {
  const prev = locks.get(key) || Promise.resolve();
  let rel; const mine = new Promise((r) => { rel = r; });
  const chain = prev.then(() => mine); locks.set(key, chain);
  let tm; const cap = new Promise((r) => { tm = setTimeout(r, 15000); });
  return Promise.race([prev, cap]).then(() => { clearTimeout(tm); return () => { rel(); if (locks.get(key) === chain) locks.delete(key); }; });
}

async function flatten(env, deps, b, A, send, read, audit, sandbox, first) {
  const code = String(b.symbol).toUpperCase(), sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const done = async (result, extra, resp) => { audit.finish({ result, ...extra }); return resp; };
  let st = first;
  if (!st) return done('rejected', { message: 'read failed' }, fail(503, 'Could not read positions and orders, nothing sent', 'read_failed'));
  const plan0 = flattenPlan(netPosition(st.positions, code).qty, workingOrders(st.orders, code));
  let cancelled = 0;
  for (let i = 0; i < plan0.cancel.length; i++) {
    const r = await send('DELETE', A + '/orders/' + encodeURIComponent(plan0.cancel[i]), b.idemKey + '-c' + i);
    if (r.ok) cancelled++;
  }
  // the close order goes out only once a fresh read shows no working order left (a resting order could otherwise fill on top of it)
  for (let t = 0; t < 4; t++) {
    if (plan0.cancel.length || t) await sleep(800);
    st = await read();
    if (st && !workingOrders(st.orders, code).length) break;
    st = st && workingOrders(st.orders, code).length ? Object.assign(st, { busy: true }) : st;
  }
  if (!st) return done('partial', { message: 'read failed after cancel', cancelled }, fail(503, 'Orders were cancelled but positions could not be read. Nothing else was sent; check the broker.', 'read_failed'));
  if (st.busy) return done('partial', { cancelled }, fail(409, 'Orders are still cancelling. Nothing else was sent; try Flatten again in a moment.', 'cancelling'));
  const pos = netPosition(st.positions, code).qty, plan = flattenPlan(pos, []);
  if (plan.tooBig) return done('rejected', { cancelled, message: 'position ' + pos }, fail(409, 'The position is more than ' + MAX_QTY + ' contracts. Close it at the broker.', 'too_big'));
  if (!plan.close) return done('accepted', { cancelled }, json({ ok: true, op: 'flatten', cancelled, closed: null }));
  const order = { assetType: 'future', symbol: code, action: plan.close.side, orderType: 'market', orderQty: plan.close.qty, timeInForce: 'day' };
  const r = await send('POST', A + '/orders', b.idemKey + '-x', { order, paperTradeConfirmed: sandbox });
  const res = r.data && r.data.order ? r.data : (r.data || {});
  const accepted = r.ok && res.accepted !== false, unknown = r.status === 0 || r.status >= 500 || r.bad;
  const brokerOrderId = String((res.order && (res.order.orderId || res.order.brokerOrderId)) || '');
  audit.finish({ result: accepted ? 'accepted' : unknown ? 'unknown' : 'rejected', httpStatus: r.status, brokerOrderId, side: order.action, qty: order.orderQty, type: 'market', cancelled });
  if (!accepted) return fail(unknown ? 502 : 409, unknown ? 'No clear answer from the broker for the closing order. Checking positions.' : (res.message ? String(res.message).slice(0, 200) : 'The broker did not accept the closing order'), unknown ? 'unknown' : 'rejected');
  return json({ ok: true, op: 'flatten', cancelled, closed: plan.close, orderId: brokerOrderId });
}
export const handle = safe('order', run);
export const onRequest = pagesEntry(handle, { retryHere: false });
