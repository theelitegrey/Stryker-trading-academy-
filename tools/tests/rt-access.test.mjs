// Real-time futures access gate (Owner order 2026-10-16). Run: node tools/tests/rt-access.test.mjs
// Uses a throwaway RSA key and stubbed Google endpoints; no real token or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../functions/api/chart/_rt.js';
import * as B from '../../workers/book-recorder/src/rt-auth.js';
import { redactFutures } from '../../workers/book-recorder/src/terminal.js';
import { delayRows, onRequestGet as barsGet } from '../../functions/api/chart/bars/[sym].js';
import { onRequestGet as streamGet } from '../../functions/api/chart/stream/[sym].js';
import { onRequestGet as rtGet } from '../../functions/api/chart/rt.js';

// the worker copy must be the same code
assert.equal(readFileSync(new URL('../../functions/api/chart/_rt.js', import.meta.url), 'utf8'), readFileSync(new URL('../../workers/book-recorder/src/rt-auth.js', import.meta.url), 'utf8'), 'rt-auth.js copies differ');

const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (b) => Buffer.from(b).toString('base64url');
async function mint(over = {}, key = kp.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'uid-admin', iat: now - 5, exp: now + 3600, ...over }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}
const studentDocs = { 'uid-demo': { demo: { booleanValue: true } }, 'uid-demo-false': { demo: { booleanValue: false } }, 'uid-demo-str': { demo: { stringValue: 'true' } }, 'uid-pro': { plan: { stringValue: 'Pro' } } };
let adminUids = new Set(['uid-admin']), fsDown = false, fsCalls = 0;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }));
  if (url.includes('firestore.googleapis.com')) {
    fsCalls++;
    if (fsDown) return new Response('x', { status: 503 });
    if (url.includes('/students/')) {
      const su = decodeURIComponent(url.split('/students/')[1]);
      if (fsDown) return new Response('x', { status: 503 });
      if (!(su in studentDocs)) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ fields: studentDocs[su] }), { status: 200 });
    }
    const uid = decodeURIComponent(url.split('/admins/')[1]);
    assert.ok(/^Bearer /.test(init.headers.authorization));
    return adminUids.has(uid) ? new Response('{}', { status: 200 }) : new Response('{}', { status: 403 });
  }
  throw new Error('unexpected fetch ' + url);
};

for (const M of [A, B]) {
  M._resetForTests();
  assert.equal(await M.verifyIdToken(await mint()), 'uid-admin');
  assert.equal(await M.verifyIdToken(await mint({ exp: 1 })), null, 'expired');
  assert.equal(await M.verifyIdToken(await mint({ aud: 'other' })), null, 'aud');
  assert.equal(await M.verifyIdToken(await mint({ iss: 'https://evil' })), null, 'iss');
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  assert.equal(await M.verifyIdToken(await mint({}, other.privateKey)), null, 'forged signature');
  const t = await mint(); const [h, p, s] = t.split('.');
  assert.equal(await M.verifyIdToken(h + '.' + b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'uid-evil', exp: 9e9, iat: 1 })) + '.' + s), null, 'tampered payload');
  assert.equal(await M.verifyIdToken(''), null); assert.equal(await M.verifyIdToken('a.b.c'), null);
  assert.equal(await M.isAdminToken(await mint()), true, 'admin');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-free' })), false, 'free user');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-pro' })), false, 'pro user');
  assert.equal(await M.isAdminToken(''), false, 'signed out');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo' })), true, 'demo account gets real-time');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-demo' })), false, 'demo is not admin');
  for (const u of ['uid-demo-false', 'uid-demo-str', 'uid-pro', 'uid-none']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), false, 'no real-time for ' + u);
  assert.equal(await M.isRealtimeToken(''), false, 'signed out');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo', exp: 1 })), false, 'expired demo token');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo' }, kp.privateKey).then((t) => t.slice(0, -4) + 'AAAA')), false, 'bad signature');
  assert.equal(await M.isRealtimeToken(await mint()), true, 'admin still real-time');
  fsDown = true; M._resetForTests();
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo' })), false, 'outage fails closed (demo)');
  assert.equal(await M.isAdminToken(await mint()), false, 'Firestore outage fails closed');
  fsDown = false;
}
assert.equal(A.wsTokenOf(new Request('https://x/', { headers: { 'sec-websocket-protocol': 'tz-auth, abc.def.ghi' } })), 'abc.def.ghi');
assert.equal(A.wsTokenOf(new Request('https://x/')), '');
assert.equal(A.bearerOf(new Request('https://x/', { headers: { authorization: 'Bearer tok' } })), 'tok');

// stream: refused without an admin token (no upstream is opened)
const env = { INSIGHTSENTRY_WEBSOCKET_API_KEY: 'x'.repeat(8) };
const wsReq = (hd) => new Request('https://tradezoro.com/api/chart/stream/NQ?tf=1', { headers: { upgrade: 'websocket', origin: 'https://tradezoro.com', ...hd } });
A._resetForTests();
assert.equal((await streamGet({ request: wsReq({}), params: { sym: 'NQ' }, env })).status, 403, 'signed-out stream');
assert.equal((await streamGet({ request: wsReq({ 'sec-websocket-protocol': 'tz-auth, ' + await mint({ sub: 'uid-pro' }) }), params: { sym: 'NQ' }, env })).status, 403, 'non-admin stream');
assert.equal((await streamGet({ request: wsReq({ 'sec-websocket-protocol': 'tz-auth, junk' }), params: { sym: 'NQ' }, env })).status, 403, 'junk token');

// /api/chart/rt
const rtRes = async (tok) => (await rtGet({ request: new Request('https://x/api/chart/rt', { headers: tok ? { authorization: 'Bearer ' + tok } : {} }) })).json();
assert.deepEqual(await rtRes(''), { admin: false });
assert.deepEqual(await rtRes(await mint()), { admin: true });

// bars: nothing newer than now - 10 min
const now = 1_800_000_000;
const rows = [[now - 1200, 1, 1, 1, 1, 1], [now - 600, 1, 1, 1, 1, 1], [now - 599, 1, 1, 1, 1, 1], [now - 60, 1, 1, 1, 1, 1], [now, 1, 1, 1, 1, 1]];
assert.deepEqual(delayRows(rows, now).map((r) => r[0]), [now - 1200, now - 600]);

// recorder: market map / brief futures prices hidden for non-admins
const map = { groups: [{ id: 'commodities', rows: [{ ticker: 'CLUSD', price: 95.66 }] }, { id: 'fx', rows: [{ ticker: 'EURUSD', price: 1.12 }] }] };
redactFutures('market-map', map);
assert.equal(map.groups[0].rows[0].price, null); assert.equal(map.groups[1].rows[0].price, 1.12);
const brief = { bullets: [{ title: 'Dollar and commodities: crude -1%', text: 'Currencies: EUR/USD 1.1247. Commodities, front-month futures: WTI crude 95.66 (-1.94%).' }] };
redactFutures('market-brief', brief);
assert.ok(!/95\.66|front-month/.test(JSON.stringify(brief)), JSON.stringify(brief));
assert.ok(/EUR\/USD 1\.1247/.test(brief.bullets[0].text));
console.log('rt-access: all ok');
