import assert from 'node:assert/strict';
import * as S from '../../functions/connect/finatic/session.js';
import * as D from '../../functions/connect/finatic/data.js';
import * as O from '../../functions/connect/finatic/order.js';
import { webcrypto, generateKeyPairSync, createSign } from 'node:crypto';

// Real RS256 token + fake Google cert/Firestore answers (same method as the other connect tests).
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid: 'k1' });
  const p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 });
  const sig = createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url');
  return h + '.' + p + '.' + sig;
}

const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const ADMINS = new Set(['admin1']);
const verifyFetch = async (url) => {
  if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  const m = String(url).match(/admins\/([^/?]+)$/);
  if (m) return ADMINS.has(decodeURIComponent(m[1])) ? new Response('{}', { status: 200 }) : new Response('{}', { status: 404 });
  return new Response('{}', { status: 500 });
};
const calls = []; const envHdr = [];
const finFetch = async (url, init) => {
  if (init.body) calls._lastBody = init.body;
  const u = new URL(url); envHdr.push(init.headers['X-Finatic-Environment']); calls.push({ method: init.method, path: u.pathname, key: init.headers['x-api-key'] });
  const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 'sess1', company_id: 'c1', csrf_token: 'x', status: 'active', user_id: JSON.parse(init.body || '{}').user_id || 'u-new' });
  if (u.pathname === '/api/v1/session/portal') return ok({ portal_url: 'https://portal.finatic.dev/?t=secret' });
  if (u.pathname.endsWith('/user')) return ok({ userId: '0aaa1111-2222-3333-4444-555566667777' });
  if (u.pathname.endsWith('/fills')) return ok([{ fillId: 'f1' }]);
  if (u.pathname.endsWith('/orders') && init.method === 'POST') return ok({ action: 'PLACE', accepted: true, order: { orderId: 'ord-1', status: 'PENDING' } });
  if (u.pathname.includes('/orders/') && init.method === 'DELETE') return ok({ action: 'CANCEL', accepted: true, order: { orderId: 'ord-1', status: 'CANCELLED' } });
  if (u.pathname.includes('/orders/') && init.method === 'PATCH') return ok({ action: 'MODIFY', accepted: true, order: { orderId: 'ord-1', status: 'PENDING' } });
  if (u.pathname.endsWith('/order-schemas')) return ok({ orderSchema: {} });
  return ok([{ accountId: 'a' }]);
};
const audits = [];
const audit = async (e) => { const row = { ...e }; audits.push(row); return { id: 'a' + audits.length, finish: async (r) => Object.assign(row, r) }; };
const deps = { verifyFetch, finFetch, audit };
const env = { FINATIC_API_KEY: 'fk_test_SECRET', DEV: '0' };
let ipn = 1;
const ACC = '123e4567-e89b-12d3-a456-426614174000';
const req = (body, tok, { method = 'POST', url = 'https://tradezoro.com/connect/finatic/data' } = {}) => new Request(url, { method, headers: { 'cf-connecting-ip': '10.0.' + (ipn++ % 250) + '.' + Math.floor(ipn / 250), origin: 'https://tradezoro.com', 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const status = async (p) => (await p).status;


const sbEnv = { FINATIC_API_KEY: 'fntc_sandbox_FAKE', DEV: '0' };
const liveEnv = { FINATIC_API_KEY: 'fntc_live_FAKE', DEV: '0' };
const US = '0aaa1111-2222-3333-4444-555566667777';
const buy = { op: 'place', accountId: ACC, userId: US, symbol: 'mesz6', side: 'buy', qty: 1, type: 'market' };
const send = (b, tok, e) => O.handle(req(b, tok, { url: 'https://tradezoro.com/connect/finatic/order' }), e, deps);
const upstreamOrders = () => calls.filter((c) => /\/orders/.test(c.path) && c.method !== 'GET');
O._resetRate();
// unsigned 401, non-admin 403, bad origin 403, not set up 503, GET 405 — no upstream, no audit
assert.equal(await status(send(buy, null, sbEnv)), 401);
assert.equal(await status(send(buy, token('member9'), sbEnv)), 403);
assert.equal(await status(send(buy, token('admin1'), {})), 503);
assert.equal((await O.handle(new Request('https://tradezoro.com/x'), sbEnv, deps)).status, 405);
assert.equal(upstreamOrders().length, 0); assert.equal(audits.length, 0);
// live blocked without the switch (key says live, or FINATIC_ENV=live), allowed only with FINATIC_LIVE_ORDERS=1
let r = await send(buy, token('admin1'), liveEnv); assert.equal(r.status, 403); assert.equal((await r.json()).error, 'Live orders are off');
assert.equal(await status(send(buy, token('admin1'), { FINATIC_API_KEY: 'x', FINATIC_ENV: 'live' })), 403);
assert.equal(await status(send(buy, token('admin1'), { FINATIC_API_KEY: 'mystery' })), 403, 'unknown env is treated as live');
assert.equal(await status(send(buy, token('admin1'), { ...liveEnv, FINATIC_LIVE_ORDERS: '0' })), 403);
assert.equal(upstreamOrders().length, 0);
r = await send({ op: 'env' }, token('admin1'), sbEnv); assert.deepEqual(await r.json(), { env: 'sandbox', enabled: true });
r = await send({ op: 'env' }, token('admin1'), liveEnv); assert.deepEqual(await r.json(), { env: 'live', enabled: false });
assert.equal(await status(send({ op: 'env' }, token('member9'), sbEnv)), 403);
// sandbox place: fields whitelisted, unknown fields stripped, qty cap, bad input
r = await send({ ...buy, evil: 'x', order: { hack: 1 }, orderId: 'zz', limitPrice: 5, accountNumber: '9' }, token('admin1'), sbEnv); assert.equal(r.status, 200);
let up = upstreamOrders().pop(); assert.equal(up.method, 'POST');
const sent = JSON.parse(calls._lastBody);
assert.deepEqual(Object.keys(sent).sort(), ['order', 'paperTradeConfirmed']); assert.equal(sent.paperTradeConfirmed, true);
assert.deepEqual(sent.order, { assetType: 'future', symbol: 'MESZ6', action: 'buy', orderType: 'market', orderQty: 1, timeInForce: 'day' });
for (const q of [3, 0, -1, 1.5, '2x', null]) assert.equal(await status(send({ ...buy, qty: q }, token('admin1'), sbEnv)), 400, 'qty ' + q);
assert.equal(await status(send({ ...buy, assetType: 'equity', qty: 101 }, token('admin1'), sbEnv)), 400);
assert.equal(await status(send({ ...buy, assetType: 'equity', qty: 100 }, token('admin1'), sbEnv)), 200);
assert.equal(await status(send({ ...buy, qty: 2 }, token('admin1'), sbEnv)), 200);
for (const bad of [{ side: 'hold' }, { type: 'trailing' }, { symbol: '../x' }, { type: 'limit' }, { type: 'stop' }, { timeInForce: 'forever' }, { limitPrice: -1, type: 'limit' }]) assert.equal(await status(send({ ...buy, ...bad }, token('admin1'), sbEnv)), 400, JSON.stringify(bad));
// unit: only whitelisted keys leave cleanOrder
const c = O.cleanOrder({ symbol: 'es', side: 'sell', qty: 1, type: 'limit', limitPrice: '5000.25', timeInForce: 'gtc', evil: 1, account: 'x', order: {} });
assert.deepEqual(Object.keys(c.order).sort(), ['action', 'assetType', 'limitPrice', 'orderQty', 'orderType', 'symbol', 'timeInForce']);
assert.equal(O.cleanOrder({ ...buy, limitPrice: 9 }).order.limitPrice, undefined, 'market drops prices');
// cancel + modify + schema, ids validated, correct methods
const n = calls.length;
r = await send({ op: 'cancel', accountId: ACC, userId: US, orderId: 'ord-1' }, token('admin1'), sbEnv); assert.equal(r.status, 200); assert.equal(calls.slice(n).pop().method, 'DELETE');
r = await send({ op: 'modify', accountId: ACC, userId: US, orderId: 'ord-1', limitPrice: 100, type: 'limit' }, token('admin1'), sbEnv); assert.equal(r.status, 200); assert.equal(calls.slice(-1)[0].method, 'PATCH');
assert.equal(await status(send({ op: 'modify', accountId: ACC, userId: US, orderId: 'ord-1' }, token('admin1'), sbEnv)), 400);
assert.equal(await status(send({ op: 'cancel', accountId: ACC, userId: US, orderId: '../x' }, token('admin1'), sbEnv)), 400);
r = await send({ op: 'schema', action: 'place', accountId: ACC, userId: US }, token('admin1'), sbEnv); assert.equal(r.status, 200); assert.equal(calls.slice(-1)[0].method, 'GET');
for (const op of ['orders', 'accounts', 'revoke', 'placeOrder', 'delete', '']) assert.equal(await status(send({ op, accountId: ACC, userId: US }, token('admin1'), sbEnv)), 400, op);
// the read endpoint still cannot place anything
assert.equal(await status(D.handle(req({ op: 'place', accountId: ACC, userId: US }, token('admin1')), sbEnv, deps)), 400);
// audit: one row per attempt, with the result, no secrets
assert.ok(audits.length >= 5); assert.ok(audits.every((a) => a.uid === 'admin1' && a.env === 'sandbox' && a.account === ACC));
assert.ok(audits.filter((a) => a.op === 'place').every((a) => a.result === 'accepted' && a.brokerOrderId === 'ord-1'));
assert.ok(!JSON.stringify(audits).includes('FAKE') && !JSON.stringify(audits).includes('Bearer'));
// audit down -> no order sent
{ const n0 = upstreamOrders().length; const d2 = { ...deps, audit: async () => { throw new Error('x'); } };
  const rr = await O.handle(req(buy, token('admin1'), { url: 'https://tradezoro.com/connect/finatic/order' }), sbEnv, d2); assert.equal(rr.status, 503); assert.equal(upstreamOrders().length, n0); }
// rejected by broker -> audited as rejected, 403 text for "trading not enabled"
{ const d3 = { ...deps, finFetch: async (url, init) => { const u = new URL(url); if (u.pathname.endsWith('/orders') && init.method === 'POST') return new Response(JSON.stringify({ error: { code: 'TRADE_ACCESS_DENIED' } }), { status: 403 }); return finFetch(url, init); } };
  const rr = await O.handle(req(buy, token('admin1'), { url: 'https://tradezoro.com/connect/finatic/order' }), sbEnv, d3); assert.equal(rr.status, 403); assert.equal(audits.at(-1).result, 'rejected'); }
// rate limit: 10 orders a minute per admin, others unaffected
O._resetRate();
let ok = 0, lim = 0; for (let i = 0; i < 13; i++) { const st = await status(send(buy, token('admin1'), sbEnv)); if (st === 200) ok++; else if (st === 429) lim++; }
assert.equal(ok, 10); assert.equal(lim, 3);
console.log('finatic orders: ok');
