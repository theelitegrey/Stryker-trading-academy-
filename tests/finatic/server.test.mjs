import assert from 'node:assert/strict';
import * as S from '../../functions/connect/finatic/session.js';
import * as D from '../../functions/connect/finatic/data.js';
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
  const u = new URL(url); envHdr.push(init.headers['X-Finatic-Environment']); calls.push({ method: init.method, path: u.pathname, key: init.headers['x-api-key'] });
  const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 'sess1', company_id: 'c1', csrf_token: 'x', status: 'active', user_id: JSON.parse(init.body || '{}').user_id || 'u-new' });
  if (u.pathname === '/api/v1/session/portal') return ok({ portal_url: 'https://portal.finatic.dev/?t=secret' });
  if (u.pathname.endsWith('/user')) return ok({ userId: '0aaa1111-2222-3333-4444-555566667777' });
  if (u.pathname.endsWith('/fills')) return ok([{ fillId: 'f1' }]);
  return ok([{ accountId: 'a' }]);
};
const deps = { verifyFetch, finFetch };
const env = { FINATIC_API_KEY: 'fk_test_SECRET', DEV: '0' };
let ipn = 1;
const ACC = '123e4567-e89b-12d3-a456-426614174000';
const req = (body, tok, { method = 'POST', url = 'https://tradezoro.com/connect/finatic/data' } = {}) => new Request(url, { method, headers: { 'cf-connecting-ip': '10.0.' + (ipn++ % 250) + '.' + Math.floor(ipn / 250), origin: 'https://tradezoro.com', 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const status = async (p) => (await p).status;

// probe
assert.deepEqual(await (await S.handle(new Request('https://tradezoro.com/connect/finatic/session?probe=1'), env, deps)).json(), { configured: true });
const miss = await S.handle(new Request('https://tradezoro.com/connect/finatic/session?probe=1'), {}, deps);
assert.equal(miss.status, 503); assert.deepEqual(await miss.json(), { configured: false });
assert.equal(await status(S.handle(new Request('https://tradezoro.com/connect/finatic/session'), env, deps)), 404);

// not set up
assert.equal(await status(S.handle(req({}, token('admin1')), {}, deps)), 503);
// unsigned 401, non-admin 403, bad origin 403
assert.equal(await status(S.handle(req({}, null), env, deps)), 401);
assert.equal(await status(S.handle(req({}, 'a.b.c'), env, deps)), 401);
assert.equal(await status(S.handle(req({}, token('member9')), env, deps)), 403);
assert.equal(await status(D.handle(req({ op: 'accounts' }, token('member9')), env, deps)), 403);
assert.equal(await status(D.handle(req({ op: 'accounts' }, null), env, deps)), 401);
assert.equal(calls.length, 0, 'non-admin never reaches the vendor');
assert.equal(await status(S.handle(new Request('https://tradezoro.com/x', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: '{}' }), env, deps)), 403);

// admin: session -> portal url (+ parent_origin), key never in the reply
let r = await S.handle(req({}, token('admin1')), env, deps); assert.equal(r.status, 200);
let txt = await r.text(); const j = JSON.parse(txt);
assert.ok(j.portalUrl.startsWith('https://portal.finatic.dev/') && j.portalUrl.includes('parent_origin=https%3A%2F%2Ftradezoro.com'));
assert.ok(!txt.includes('SECRET') || j.portalUrl.includes('t=secret')); assert.ok(!txt.includes('fk_test'));
assert.ok(calls.every((c) => c.key === 'fk_test_SECRET'));

// data: allow-list. trading / unknown ops refused before any vendor call
const before = calls.length;
for (const op of ['placeOrder', 'cancelOrder', 'createAccountOrder', 'modifyOrder', 'orders/../x', '__proto__', 'constructor', 'toString', '']) {
  assert.equal(await status(D.handle(req({ op, accountId: ACC, userId: '0aaa1111-2222-3333-4444-555566667777' }, token('admin1')), env, deps)), 400, op);
}
assert.equal(calls.length, before);
assert.deepEqual(Object.keys(D.OPS).sort(), ['accounts', 'balances', 'grants', 'orders', 'positions', 'transactions']);
// no write method / order-write path is ever used by any allowed op
for (const op of ['accounts', 'grants', 'orders', 'transactions', 'positions', 'balances']) {
  const n = calls.length;
  r = await D.handle(req({ op, accountId: ACC, userId: '0aaa1111-2222-3333-4444-555566667777' }, token('admin1')), env, deps); assert.equal(r.status, 200, op);
  calls.slice(n).filter((c) => !c.path.startsWith('/api/v1/session')).forEach((c) => { assert.equal(c.method, 'GET'); assert.ok(!/\/orders$/.test(c.path) || c.method === 'GET'); });
}
// fills (several order ids), revoke (the one POST), path-injection guards
const n0 = calls.length;
r = await D.handle(req({ op: 'fills', accountId: ACC, orderIds: ['o1', 'o2'], userId: '0aaa1111-2222-3333-4444-555566667777' }, token('admin1')), env, deps);
assert.equal(r.status, 200); assert.equal((await r.json()).data.length, 2);
assert.ok(calls.slice(n0).filter((c) => c.path.includes('/orders/')).every((c) => c.method === 'GET' && c.path.endsWith('/fills')));
assert.equal(await status(D.handle(req({ op: 'fills', accountId: ACC, orderIds: ['../x'], userId: '0aaa1111-2222-3333-4444-555566667777' }, token('admin1')), env, deps)), 400);
assert.equal(await status(D.handle(req({ op: 'orders', accountId: '../../x', userId: '0aaa1111-2222-3333-4444-555566667777' }, token('admin1')), env, deps)), 400);
const n1 = calls.length;
assert.equal(await status(D.handle(req({ op: 'revoke', grantId: ACC, userId: '0aaa1111-2222-3333-4444-555566667777' }, token('admin1')), env, deps)), 200);
const rv = calls.slice(n1).find((c) => c.path.endsWith('/revoke')); assert.equal(rv.method, 'POST');
// no Finatic user known -> needsConnect
assert.equal(await status(D.handle(req({ op: 'accounts' }, token('admin1')), env, deps)), 409);
// session id from the portal run resolves the user
r = await D.handle(req({ op: 'accounts', sessionId: 'sess1' }, token('admin1')), env, deps); assert.equal(r.status, 200); assert.equal((await r.json()).userId, '0aaa1111-2222-3333-4444-555566667777');
// GET on data refused
assert.equal(await status(D.handle(new Request('https://tradezoro.com/connect/finatic/data'), env, deps)), 405);
// POST/PATCH/PUT/DELETE as HTTP methods on the orders route: refused, nothing sent upstream
const n2 = calls.length;
for (const method of ['PATCH', 'PUT', 'DELETE', 'GET']) {
  const rr = await D.handle(new Request('https://tradezoro.com/connect/finatic/data', { method, headers: { origin: 'https://tradezoro.com', authorization: 'Bearer ' + token('admin1') } }), env, deps);
  assert.equal(rr.status, 405, method);
}
// trading verbs as ops, with order ids / bodies: 400, nothing upstream
for (const op of ['createOrder', 'POST /orders', 'DELETE', 'PATCH', 'modifyOrder', 'orders/create']) assert.equal(await status(D.handle(req({ op, accountId: ACC, orderId: 'o1', userId: ACC, order: { side: 'BUY' } }, token('admin1')), env, deps)), 400, op);
assert.equal(calls.length, n2);
// FINATIC_ENV -> X-Finatic-Environment header; unset -> none; junk ignored
envHdr.length = 0; await D.handle(req({ op: 'accounts', userId: ACC }, token('admin1')), { ...env, FINATIC_ENV: 'sandbox' }, deps);
assert.ok(envHdr.length > 0 && envHdr.every((h) => h === 'sandbox'));
envHdr.length = 0; await D.handle(req({ op: 'accounts', userId: ACC }, token('admin1')), { ...env, FINATIC_ENV: 'bogus' }, deps); assert.ok(envHdr.every((h) => h === undefined));
envHdr.length = 0; await D.handle(req({ op: 'accounts', userId: ACC }, token('admin1')), env, deps); assert.ok(envHdr.every((h) => h === undefined));
console.log('finatic server: ok');
