// Broker sync failure paths (Owner bug 15 Nov: red "Request failed" after the sandbox -> live key switch).
// Every reply must be JSON {error, code}; a stale (sandbox) user id must give 409 needsConnect; a live key must
// never send X-Finatic-Environment: sandbox; nothing secret in any reply or log line.
import assert from 'node:assert/strict';
import * as S from '../../functions/connect/finatic/session.js';
import * as D from '../../functions/connect/finatic/data.js';
import * as O from '../../functions/connect/finatic/order.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid: 'k1' });
  const p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 });
  return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url');
}
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => {
  if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  if (/admins\/admin1$/.test(String(url))) return new Response('{}', { status: 200 });
  return new Response('{}', { status: 404 });
};
const KEY = 'fntc_live_TESTSECRETKEY';
const env = { FINATIC_API_KEY: KEY, FINATIC_LIVE_ORDERS: '1', DEV: '0' };
const STALE = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
let ipn = 1;
const req = (body, url = 'https://tradezoro.com/connect/finatic/data') => new Request(url, { method: 'POST', headers: { 'cf-connecting-ip': '10.9.' + (ipn++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: JSON.stringify(body) });

// Capture console output: no key, token or URL may be logged.
const logs = []; for (const k of ['log', 'warn', 'error']) { const o = console[k]; console[k] = (...a) => { logs.push(a.join(' ')); if (k === 'log') o(...a); }; }

const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
// Upstream double: behaviour switched per case.
let mode = 'stale'; const envHdr = [];
const finFetch = async (url, init) => {
  const u = new URL(url); envHdr.push(init.headers['X-Finatic-Environment']);
  if (mode === 'throw') throw new TypeError('network down https://api.finatic.dev/?k=' + KEY);
  if (mode === 'html') return new Response('<!doctype html><title>502 Bad Gateway</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (mode === 'html502') return new Response('<html>error code: 1101</html>', { status: 502 });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') {
    const uid = JSON.parse(init.body || '{}').user_id;
    if (mode === 'stale' && uid === STALE) return new Response(JSON.stringify({ data: null, errors: [{ message: 'user not found' }] }), { status: 404 });
    if (mode === 'start500') return new Response('{"errors":[{"message":"x"}]}', { status: 500 });
    return ok({ session_id: 's1', status: 'active', user_id: uid || 'u-new' });
  }
  if (u.pathname.endsWith('/user')) return new Response(JSON.stringify({ errors: [{ message: 'no such session' }] }), { status: 404 });
  if (u.pathname === '/api/v1/session/portal') return ok({ portal_url: 'https://portal.finatic.dev/?t=x' });
  return ok([{ accountId: 'a' }]);
};
const deps = { verifyFetch, finFetch, audit: async () => ({ finish: async () => {} }) };
const body = async (r) => { const t = await r.text(); assert.ok(!t.includes(KEY), 'key never in a reply'); return JSON.parse(t); };   // throws on non-JSON

// 1. stale sandbox user id on live -> 409 needsConnect (data + order), not an error page
mode = 'stale';
let r = await D.handle(req({ op: 'accounts', userId: STALE }), env, deps);
assert.equal(r.status, 409); let j = await body(r); assert.equal(j.needsConnect, true); assert.equal(j.code, 'needs_connect');
r = await O.handle(req({ op: 'schema', action: 'place', accountId: ACC, userId: STALE }, 'https://tradezoro.com/connect/finatic/order'), env, deps);
assert.equal(r.status, 409); assert.equal((await body(r)).needsConnect, true);
// a portal session that has no user yet -> 409 too
r = await D.handle(req({ op: 'accounts', sessionId: 'sess-unknown' }), env, deps);
assert.equal(r.status, 409); assert.equal((await body(r)).needsConnect, true);
// a fresh connect still works after that (session -> portal)
r = await S.handle(req({ mode: 'dark' }, 'https://tradezoro.com/connect/finatic/session'), env, deps);
assert.equal(r.status, 200); assert.ok((await body(r)).portalUrl.startsWith('https://portal.finatic.dev/'));

// 2. upstream answers HTML / garbage -> JSON 502 with a message (session, data, order)
for (const m of ['html', 'html502', 'start500']) {
  mode = m;
  for (const [h, b, u] of [[S, { mode: 'dark' }, 'session'], [D, { op: 'accounts', userId: STALE }, 'data'], [O, { op: 'schema', action: 'place', accountId: ACC, userId: STALE }, 'order']]) {
    r = await h.handle(req(b, 'https://tradezoro.com/connect/finatic/' + u), env, deps);
    assert.equal(r.status, 502, m + ' ' + u); j = await body(r);
    assert.equal(j.code, 'upstream'); assert.ok(typeof j.error === 'string' && j.error.length > 20 && !/request failed/i.test(j.error), m + ' ' + u);
  }
}
// upstream fetch throws (network / timeout) -> JSON 502
mode = 'throw';
r = await S.handle(req({}, 'https://tradezoro.com/connect/finatic/session'), env, deps); assert.equal(r.status, 502); assert.equal((await body(r)).code, 'upstream');

// 3. exception anywhere in the handler -> JSON 500 (no Cloudflare HTML page)
mode = 'stale';
for (const [h, u, b] of [[S, 'session', {}], [D, 'data', { op: 'accounts' }], [O, 'order', { op: 'env' }]]) {
  // throwing deps object getter: forces an exception inside the handler body
  const evil = new Proxy(deps, { get: (t, k) => { if (k === 'verifyFetch') throw new Error('getter ' + KEY); return t[k]; } });
  r = await h.handle(req(b, 'https://tradezoro.com/connect/finatic/' + u), env, evil);
  assert.equal(r.status, 500, u); j = await body(r); assert.equal(j.code, 'server_error'); assert.ok(j.error.length > 20);
  assert.equal(r.headers.get('content-type').split(';')[0], 'application/json');
}
// wrong method -> JSON 405
r = await D.handle(new Request('https://tradezoro.com/connect/finatic/data'), env, deps); assert.equal(r.status, 405); assert.equal((await body(r)).code, 'method');

// 4. live key wins: FINATIC_ENV=sandbox is ignored with a live key; a sandbox key still sends it
mode = 'stale'; envHdr.length = 0;
await D.handle(req({ op: 'accounts', userId: ACC }), { ...env, FINATIC_ENV: 'sandbox' }, deps);
assert.ok(envHdr.length > 0 && envHdr.every((h) => h === undefined), 'no sandbox header with a live key');
assert.ok(logs.some((l) => /FINATIC_ENV=sandbox ignored/.test(l)), 'warning logged');
envHdr.length = 0;
await D.handle(req({ op: 'accounts', userId: ACC }), { ...env, FINATIC_API_KEY: 'fntc_sandbox_X', FINATIC_ENV: 'sandbox' }, deps);
assert.ok(envHdr.length > 0 && envHdr.every((h) => h === 'sandbox'));

// 5. logs carry no key, token or URL
assert.ok(logs.length > 0);
for (const l of logs) { assert.ok(!l.includes(KEY) && !l.includes('TESTSECRET'), 'no key in logs'); assert.ok(!/https?:\/\//.test(l), 'no url in logs: ' + l); assert.ok(!/eyJ/.test(l), 'no token in logs'); }
console.log('finatic failures: ok');
