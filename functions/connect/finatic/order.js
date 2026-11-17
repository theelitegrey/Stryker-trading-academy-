// ADMIN-ONLY order TEST routes for the Finatic integration (Owner exception 2026-11-04). POST {op, accountId, ...}.
//   schema -> GET  /accounts/{id}/order-schemas?action=place|modify|cancel
//   place  -> POST /accounts/{id}/orders          cancel -> DELETE /accounts/{id}/orders/{orderId}          modify -> PATCH /accounts/{id}/orders/{orderId}
// Guards, in order: not configured 503 · origin/JSON/IP limit · unsigned 401 · non-admin 403 · live without FINATIC_LIVE_ORDERS=1 403 "Live orders are off"
// · 10 orders/min per admin · body whitelist (unknown fields dropped, qty cap) · audit row written BEFORE the order (no audit, no order).
// CHART LIVE ORDERS (Owner order 2026-11-15, src:'chart' from assets/chart-live.js), on top of every guard above:
// · live env: the kill switch settings/liveTrading must not say enabled:false (unreadable = refused) · idemKey required: it is the
//   Idempotency-Key AND the audit doc id, so a repeated key is answered 409 duplicate and never reaches the broker twice
// · contract whitelist (NQ/ES/MNQ/MES, the two nearest live quarters; assets/chart-live-core.js, the same code the chart uses)
// · market, limit, stop, stop limit (2026-11-17; was market + limit); modify = the one price of a limit or stop order
// · stop loss + take profit: market entries only, one group per account + contract (brokerBrackets), children placed by op 'bracket'
//   after the fill, one-cancels-other done here (syncBracket); see the section at the end of this file · a FRESH positions + orders read before every place: worst-case net exposure
//   (position + working orders + this order) stays within 2 contracts, unreadable = refused
// · flatten runs here, not in the browser: cancel the contract's working orders, re-read until they are gone, re-read the position,
//   then ONE market order for the net (refused above 2); deterministic key from the position snapshot, so a double tap is deduped
// · no answer from the broker = code 'unknown' (the chart blocks new orders until a read settles it).
// SPEED (Owner order 2026-11-16): independent pre-send steps run in parallel (order rate limit, kill switch, Finatic session), the session
// is cached per isolate (_fin.js cachedSession, 2 min) and the poll / 'env' call warm it, the fresh read fetches positions and orders
// in parallel WITH the audit 'attempt' row (both must succeed before anything is sent), and the audit result row is written after the
// reply (deps.defer = ctx.waitUntil). Every reply carries Server-Timing (rl, auth, admin, gate, sess, read, audit, fin, total).
import { gate, readBody, cachedSession, finSession, ordersBlocked, envMode, json, fail, needsConnect, methodNotAllowed, safe, pagesEntry, deferOf, UPSTREAM_MSG, UUID, ID } from './_fin.js';
import { openAudit, liveSwitchOn, getBracket, putBracket, delBracket, logBracket } from './_audit.js';
import { validContract, workingOrders, netPosition, exposureError, flattenPlan, IDEM, MAX_QTY, groupId, bracketCheck, bracketPlan } from '../../../assets/chart-live-core.js';

export const MAX_FUT = 2, MAX_EQ = 100, ORDERS_PER_MIN = 10;
const TYPES = ['market', 'limit', 'stop', 'stop_limit'], TIFS = ['day', 'gtc', 'ioc', 'fok'], ASSETS = ['future', 'equity'];
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
    const type = String(b.type || '').toLowerCase(); if (!TYPES.includes(type)) return { error: 'type must be market, limit, stop or stop_limit' }; o.orderType = type;
  } else if (b.type !== undefined) { const type = String(b.type).toLowerCase(); if (!TYPES.includes(type)) return { error: 'type must be market, limit, stop or stop_limit' }; o.orderType = type; }
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
  if ((o.orderType === 'stop' || o.orderType === 'stop_limit') && o.stopPrice === undefined && !partial) return { error: 'stop order needs stopPrice' };
  if (o.orderType === 'stop_limit' && o.limitPrice === undefined && !partial) return { error: 'stop limit order needs limitPrice' };
  if (o.orderType === 'stop') delete o.limitPrice;
  if (o.orderType === 'market') { delete o.limitPrice; delete o.stopPrice; }
  if ((o.orderType === 'limit' || o.orderType === 'stop_limit') && o.limitPrice !== undefined) { o.price = o.limitPrice; delete o.limitPrice; }   // Finatic/Tradovate limit orders require `price` (422 on limitPrice alone, found in sandbox)
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
  if (op !== 'schema' && op !== 'place' && op !== 'cancel' && op !== 'modify' && !((op === 'flatten' || op === 'bracket') && chart)) return fail(400, 'Not allowed');
  if (!(typeof b.accountId === 'string' && UUID.test(b.accountId))) return fail(400, 'accountId missing');
  if ((op === 'cancel' || op === 'modify') && !(typeof b.orderId === 'string' && ID.test(b.orderId))) return fail(400, 'orderId missing');
  if (op === 'schema' && !['place', 'modify', 'cancel'].includes(b.action)) return fail(400, 'action invalid');
  const now = (deps.now || Date.now)();
  let bracket = null;
  if (chart && op !== 'schema') {
    if (op !== 'bracket' && !(typeof b.idemKey === 'string' && IDEM.test(b.idemKey))) return fail(400, 'idemKey missing');
    if ((op === 'place' || op === 'flatten' || op === 'bracket') && !validContract(b.symbol, now)) return fail(400, 'Not a tradable contract');
    const ty = String(b.type || '').toLowerCase();
    if (op === 'place' && !CHART_TYPES.includes(ty)) return fail(400, 'Market, limit, stop or stop limit only');
    if (op === 'modify') {   // one price per order type: limit -> limitPrice, stop -> stopPrice; never the quantity or the side
      const mt = String(b.type || 'limit').toLowerCase();
      if (b.qty !== undefined || (mt === 'limit' && b.stopPrice !== undefined) || (mt === 'stop' && b.limitPrice !== undefined) || (mt !== 'limit' && mt !== 'stop')) return fail(400, 'Only the order price can be changed');
    }
    // stop loss / take profit (2026-11-17): market entries only; one bracket per account + contract (checked under the lock below)
    if (op === 'place' && b.bracket !== undefined && b.bracket !== null) {
      if (ty !== 'market') return fail(400, 'Stop loss and take profit go with market orders only');
      const bc = bracketCheck({ side: String(b.side || '').toLowerCase(), ref: 0, sl: b.bracket.sl, tp: b.bracket.tp, code: String(b.symbol).toUpperCase() });
      if (bc.error) return fail(400, bc.error);
      bracket = bc;
    }
  }
  let order = null;
  if (op === 'place' || op === 'modify') { const c = cleanOrder(b, { partial: op === 'modify' }); if (c.error) return fail(400, c.error); order = c.order; if (op === 'modify' && Object.keys(order).length < 2) return fail(400, 'nothing to change'); }
  // moving a stop loss / take profit (drag on the chart): it must stay on its side of the other one (advisor: same checks as place)
  let modGroup = null;
  if (chart && op === 'modify' && typeof b.symbol === 'string' && validContract(b.symbol, now)) {
    try { modGroup = await getBracket(env, deps, groupId(b.accountId, String(b.symbol).toUpperCase())); } catch (e) { return fail(503, 'Could not read the stop loss / take profit record, nothing sent', 'bracket_unreadable'); }
    if (modGroup && (modGroup.slId === b.orderId || modGroup.tpId === b.orderId)) {
      const isSl = modGroup.slId === b.orderId, np = isSl ? order.stopPrice : order.price;
      if (!(np > 0) || (isSl ? order.orderType !== 'stop' : order.orderType !== 'limit')) return fail(400, isSl ? 'Move the stop loss with a stop price' : 'Move the take profit with a limit price');
      const chk = bracketCheck({ side: modGroup.side, ref: 0, sl: isSl ? np : modGroup.sl, tp: isSl ? modGroup.tp : np, code: modGroup.code });
      if (chk.error) return fail(400, chk.error);
    } else modGroup = null;
  }
  let userId = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
  const t = deps.t, defer = deps.defer || deferOf(null), live = envMode(env) === 'live';
  // independent checks in parallel; each verdict is applied below in the old order (rate limit, kill switch, session)
  const [limited, sw, s0] = await t.step('gate', Promise.all([
    op === 'bracket' ? syncLimited(g.uid) : op !== 'schema' ? orderRateLimited(env, g.uid, defer) : false,
    op !== 'schema' && live ? liveSwitchOn(env, deps).then((v) => ({ v }), () => ({ err: true })) : { v: true },   // kill switch, fails closed
    userId ? cachedSession(env, deps, userId) : null,
  ]));
  if (limited) return fail(429, op === 'bracket' ? 'Too many checks, try again in a moment' : 'Order limit: 10 a minute');
  // the bracket sync still runs with the switch off (or unreadable): it may only CANCEL then (the protective one-cancels-other),
  // never place a new order (syncBracket gets killed = true)
  if (op !== 'bracket' && sw.err) return fail(503, 'Live trading switch could not be read, order not sent', 'switch_unreadable');
  if (op !== 'bracket' && !sw.v) return fail(403, 'Live trading is switched off', 'switched_off');
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
  if (op === 'bracket') {
    if (renewFail) return needsConnect();
    const release = await t.step('queue', acquire(b.accountId));
    try { return await syncBracket(env, deps, { uid: g.uid, account: b.accountId, code: String(b.symbol).toUpperCase(), A, call, read, killed: !!(sw.err || !sw.v), sandbox: envMode(env) === 'sandbox', env: envMode(env) }); }
    finally { release(); }
  }

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
    if (bracket) {   // one stop loss / take profit group per account + contract
      let old; try { old = await getBracket(env, deps, groupId(b.accountId, order.symbol)); } catch (e) { audit.finish({ result: 'rejected', message: 'bracket read failed' }); return fail(503, 'Could not read the stop loss / take profit record, order not sent', 'bracket_unreadable'); }
      if (old) { audit.finish({ result: 'rejected', message: 'bracket exists' }); return fail(409, 'A stop loss / take profit is already set on ' + order.symbol + '. Flatten or wait for it to finish first.', 'bracket_exists'); }
    }
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
  let br;
  if (bracket && op === 'place') {   // the children go in after the fill (op 'bracket'); the group is the server's record of them
    const gid = groupId(b.accountId, order.symbol);
    const grp = { uid: g.uid, account: b.accountId, code: order.symbol, side: order.action, qty: order.orderQty, sl: bracket.sl, tp: bracket.tp, entryId: brokerOrderId, key: b.idemKey, state: 'pending', slId: '', tpId: '', why: '', at: new Date(now).toISOString() };
    try { await putBracket(env, deps, gid, grp); br = viewGroup(grp); logBracket(env, deps, { uid: g.uid, env: envMode(env), op: 'bracket-open', account: b.accountId, symbol: order.symbol, side: order.action, qty: order.orderQty, type: 'bracket', result: 'pending', brokerOrderId, message: 'sl ' + bracket.sl + ' tp ' + bracket.tp });
    } catch (e) { br = { state: 'unrecorded', why: 'The order was sent, but the stop loss and take profit could not be recorded. Set them at your broker.' }; }
  }
  if (op === 'modify' && modGroup) {   // a moved stop loss / take profit: keep the record in step
    const gid = groupId(b.accountId, String(b.symbol).toUpperCase());
    try { const grp = modGroup; if (grp) { if (grp.slId === b.orderId) grp.sl = order.stopPrice; else grp.tp = order.price; await putBracket(env, deps, gid, grp); br = viewGroup(grp); } } catch (e) {}
  }
  return json({ ok: true, op, env: envMode(env), orderId: brokerOrderId, status: res.order && res.order.status || '', accepted: true, strategy: res.executionStrategy || '', superseded: res.supersededOrderId || '', ...(br ? { bracket: br } : {}) });
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
  const dropGroup = () => delBracket(env, deps, groupId(b.accountId, code)).catch(() => {});   // its children were cancelled above
  if (!plan.close) { await dropGroup(); return done('accepted', { cancelled }, json({ ok: true, op: 'flatten', cancelled, closed: null })); }
  const order = { assetType: 'future', symbol: code, action: plan.close.side, orderType: 'market', orderQty: plan.close.qty, timeInForce: 'day' };
  const r = await send('POST', A + '/orders', b.idemKey + '-x', { order, paperTradeConfirmed: sandbox });
  const res = r.data && r.data.order ? r.data : (r.data || {});
  const accepted = r.ok && res.accepted !== false, unknown = r.status === 0 || r.status >= 500 || r.bad;
  const brokerOrderId = String((res.order && (res.order.orderId || res.order.brokerOrderId)) || '');
  audit.finish({ result: accepted ? 'accepted' : unknown ? 'unknown' : 'rejected', httpStatus: r.status, brokerOrderId, side: order.action, qty: order.orderQty, type: 'market', cancelled });
  if (!accepted) return fail(unknown ? 502 : 409, unknown ? 'No clear answer from the broker for the closing order. Checking positions.' : (res.message ? String(res.message).slice(0, 200) : 'The broker did not accept the closing order'), unknown ? 'unknown' : 'rejected');
  await dropGroup();
  return json({ ok: true, op: 'flatten', cancelled, closed: plan.close, orderId: brokerOrderId });
}

// ---- stop loss + take profit (Owner order 2026-11-17) ----------------------------------------------------------------------
// The broker link has no native bracket / OCO order, so: the entry goes out alone, then op 'bracket' (called by the chart after every
// positions read while a group is open) places the stop loss (STOP) and the take profit (LIMIT), GTC, once the entry has filled, and
// when one of them fills cancels the other. The decisions are the pure L.bracketPlan (unit-tested); this function only carries them
// out, under the per-account lock, with deterministic Idempotency-Keys (group key + '-sl' / '-tp' / '-oc…'), so a repeated sync never
// sends a child twice. With the kill switch off it only cancels. Every action is logged to brokerOrderAudit (src 'chart-bracket').
const CHART_TYPES = ['market', 'limit', 'stop', 'stop_limit'];
const syncMem = new Map();
function syncLimited(uid) {   // 40 syncs a minute per admin (the chart polls every 10 s plus a few fast reads after each write)
  const min = Math.floor(Date.now() / 60000), k = uid + ':' + min;
  for (const x of syncMem.keys()) if (!x.endsWith(':' + min)) syncMem.delete(x);
  const n = (syncMem.get(k) || 0) + 1; syncMem.set(k, n); return n > 40;
}
export const viewGroup = (g) => (g ? { code: g.code, side: g.side, qty: g.qty, sl: g.sl, tp: g.tp, state: g.state, slId: g.slId || '', tpId: g.tpId || '', entryId: g.entryId || '', why: g.why || '' } : null);
async function syncBracket(env, deps, x) {
  const { code, account, A, call, read, killed, sandbox } = x;
  const gid = groupId(account, code), sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let grp;
  try { grp = await getBracket(env, deps, gid); } catch (e) { return fail(503, 'Could not read the stop loss / take profit record', 'bracket_unreadable'); }
  if (!grp) return json({ ok: true, group: null });
  const log = (what, extra) => logBracket(env, deps, { uid: x.uid, env: x.env, op: 'bracket-' + what, account, symbol: code, type: 'bracket', ...extra });
  const send = (method, path, key, body) => call(method, path, { headers: { 'Idempotency-Key': key }, ...(body ? { body } : { query: { paperTradeConfirmed: sandbox ? 'true' : undefined } }) });
  const answer = (did) => json({ ok: true, group: viewGroup(grp), did });
  const save = async () => { try { await putBracket(env, deps, gid, grp); } catch (e) {} };
  const drop = async (why) => { try { await delBracket(env, deps, gid); } catch (e) {} log('closed', { result: 'closed', message: why }); const v = viewGroup(grp); v.state = 'closed'; v.why = why; return json({ ok: true, group: v, did: 'closed' }); };
  const cancelIds = async (ids, tag) => { let ok = 0; for (const id of ids) { const r = await send('DELETE', A + '/orders/' + encodeURIComponent(id), grp.key + '-' + tag + '-' + id); if (r.ok) ok++; } return ok === ids.length; };
  let st = await read();
  if (!st) return json({ ok: true, group: viewGroup(grp), did: 'unread' });
  let plan = bracketPlan(grp, st.positions, st.orders);
  if (plan.act === 'flatcheck') {   // flat with both children still working: make sure on a second read a moment later (advisor)
    await sleep(2000); st = await read();
    if (!st) return answer('unread');
    plan = bracketPlan(grp, st.positions, st.orders);
  }
  if (plan.act === 'wait' || plan.act === 'ok') return answer(plan.act);
  if (plan.act === 'drop') return drop(plan.why);
  if (plan.act === 'oco' || plan.act === 'flatcheck') {
    const ok = await cancelIds(plan.cancel, 'oc');
    log('oco', { result: ok ? 'accepted' : 'partial', message: plan.why + '; cancelled ' + plan.cancel.join(',') });
    if (ok) return drop(plan.why);
    grp.why = 'The other order could not be cancelled. Check your broker.'; grp.state = 'unprotected'; await save(); return answer('oco_failed');
  }
  if (plan.act === 'resize') {   // a child part-filled: the other one must not be bigger than what is left of the position
    const r = await send('PATCH', A + '/orders/' + encodeURIComponent(plan.id), grp.key + '-rs-' + plan.id + '-' + plan.qty, { order: { orderQty: plan.qty }, paperTradeConfirmed: sandbox });
    log('resize', { result: r.ok ? 'accepted' : 'rejected', brokerOrderId: plan.id, qty: plan.qty, httpStatus: r.status });
    return answer('resize');
  }
  if (plan.act === 'alarm') {
    if (grp.state !== 'unprotected' || grp.why !== plan.why) { grp.state = 'unprotected'; grp.why = plan.why; await save(); log('alarm', { result: 'unprotected', message: plan.why }); }
    return answer('alarm');
  }
  if (plan.act === 'place') {
    if (killed) { const w = 'Live trading is switched off, so the stop loss and take profit were not placed. Switch it back on, flatten, or set them at your broker.'; if (grp.why !== w) { grp.why = w; await save(); log('blocked', { result: 'rejected', message: 'kill switch' }); } return answer('blocked'); }   // stays pending: placed once the switch is back on
    const chk = bracketCheck({ side: grp.side, ref: plan.ref, sl: grp.sl, tp: grp.tp, code, pct: 0.05 });
    if (chk.error) { grp.state = 'unprotected'; grp.why = chk.error.replace(/\.$/, '') + ' at the fill price, so it was not placed. Flatten, or set them at your broker.'; await save(); log('blocked', { result: 'rejected', message: chk.error }); return answer('blocked'); }
    const base = { assetType: 'future', symbol: code, action: plan.exitSide, orderQty: plan.qty, timeInForce: 'gtc' };
    const legs = [];
    if (grp.sl != null && !grp.slId) legs.push(['sl', { ...base, orderType: 'stop', stopPrice: grp.sl }]);
    if (grp.tp != null && !grp.tpId) legs.push(['tp', { ...base, orderType: 'limit', price: grp.tp }]);
    for (const [k, order] of legs) {   // stop loss first; if it is refused, no take profit (a lone target with no stop is worse)
      // no audit, no order (same rule as every other write). A repeat of the same child (an earlier answer was unclear) finds its row
      // already there: it is re-sent with the SAME Idempotency-Key, so the broker never takes it twice.
      try { await openAudit(env, deps, { uid: x.uid, env: x.env, op: 'bracket-child', src: 'chart-bracket', account, symbol: code, side: order.action, qty: order.orderQty, type: order.orderType, message: k }, grp.key + '-' + k); }
      catch (e) { if (!e.duplicate) { grp.why = 'Audit log unavailable, the ' + (k === 'sl' ? 'stop loss' : 'take profit') + ' was not sent yet. Retrying.'; await save(); return answer('audit'); } }
      const r = await send('POST', A + '/orders', grp.key + '-' + k, { order, paperTradeConfirmed: sandbox });
      const res = r.data && r.data.order ? r.data : (r.data || {});
      const id = String((res.order && (res.order.orderId || res.order.brokerOrderId)) || '');
      const unknown = r.status === 0 || r.status >= 500 || r.bad, accepted = r.ok && res.accepted !== false && !!id;
      log('child', { result: accepted ? 'accepted' : unknown ? 'unknown' : 'rejected', side: order.action, qty: order.orderQty, type: order.orderType, brokerOrderId: id, httpStatus: r.status, message: k });
      if (accepted) { grp[k + 'Id'] = id; continue; }
      if (unknown) { grp.why = 'No clear answer from the broker for the ' + (k === 'sl' ? 'stop loss' : 'take profit') + '. Checking again.'; await save(); return answer('unknown'); }   // same key next time: never sent twice
      grp.state = 'unprotected'; grp.why = 'The broker did not accept the ' + (k === 'sl' ? 'stop loss' : 'take profit') + (res.message ? ' (' + String(res.message).slice(0, 120) + ')' : '') + '. Flatten, or set it at your broker.';
      await save(); return answer('rejected');
    }
    grp.state = 'active'; grp.why = ''; await save();
    return answer('placed');
  }
  return answer('ok');
}
export const handle = safe('order', run);
export const onRequest = pagesEntry(handle, { retryHere: false });
