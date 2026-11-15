// /ts-* hardening (security review 2026-11-14, ALL TOOLS FREE follow-up): src/ts-route.js + its wiring in src/index.js.
//   1. a faked Upgrade header cannot skip the 10-min delay: live vs history comes from the path, an upgrade on a history route is a 400
//   2. history responses: Cache-Control private, no-store + Vary: Authorization, Origin (refusals too)
//   3. query params allow-listed per route and value-checked; tier / lane / cut / junk from the client are dropped
// node workers/book-recorder/test/ts-route.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tsKind, tsForwardUrl, TS_NO_CACHE, TS_PARAMS, TS_HISTORY } from '../src/ts-route.js';

let n = 0; const ok = (m) => { n++; console.log('PASS ' + m); };
const H = (o) => new Headers(o || {});
const CUT = 1763100000000;

// ---- 1. header tricks
for (const p of ['/ts-book-history', '/ts-aux', '/ts-trades']) {
  assert.equal(tsKind(p, H()), 'history');
  assert.equal(tsKind(p, H({ upgrade: 'websocket' })), 'bad_upgrade');
  assert.equal(tsKind(p, H({ upgrade: 'WebSocket', connection: 'Upgrade' })), 'bad_upgrade');
  assert.equal(tsKind(p, H({ upgrade: 'h2c' })), 'bad_upgrade');
  assert.equal(tsKind(p, H({ 'sec-websocket-protocol': 'tz-auth, x' })), 'history', 'a subprotocol header alone changes nothing');
}
ok('history routes: any Upgrade header -> bad_upgrade (refused), never the socket path');
assert.equal(tsKind('/ts-live', H({ upgrade: 'websocket' })), 'live');
assert.equal(tsKind('/ts-live', H()), 'ws_required');
ok('/ts-live is the only socket route and needs the upgrade');
for (const p of ['/ts-live/', '/ts-book-history/', '/TS-AUX', '/ts-aux%2F', '/ts-trades/x', '/do/ts-aux']) assert.equal(tsKind(p, H({ upgrade: 'websocket' })), null, p);
ok('look-alike paths are not /ts-* routes (fall through, never reach the hub gate-free)');

// the wiring: index.js uses tsKind, refuses bad_upgrade before any gate, and the delayed/live call is the token check only
const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const b0 = src.indexOf("if (u.pathname === '/ts-live' || u.pathname === '/ts-book-history'");
const blk = src.slice(b0, src.indexOf('// TICK ENGINE (src/tick-engine.js)', b0));
assert.ok(blk.length > 500);
assert.match(blk, /const kind = tsKind\(u\.pathname, req\.headers\);/);
assert.match(blk, /kind === 'bad_upgrade'\) return new Response\('bad request', \{ status: 400/);
assert.match(blk, /const ws = kind === 'live';/);
assert.ok(!/const ws = u\.pathname === '\/ts-live'/.test(blk) && !/req\.headers\.get\('upgrade'\)/.test(blk), 'no raw Upgrade header read decides anything');
assert.match(blk, /const hist = ws \? null : await tsHistoryAccess\(env, bearerOf\(req\), u\.pathname\);/);
assert.ok(blk.indexOf("kind === 'bad_upgrade'") < blk.indexOf('tsHistoryAccess('), 'refused before the gate');
ok('index.js: path-only kind, upgrade-on-history refused before the gate, live/delayed from tsHistoryAccess (token + plan) only');

// ---- 2. caching
assert.equal(TS_NO_CACHE['cache-control'], 'private, no-store');
assert.match(TS_NO_CACHE.vary, /Authorization/); assert.match(TS_NO_CACHE.vary, /Origin/);
ok('TS_NO_CACHE = private, no-store + Vary: Authorization, Origin');
assert.match(blk, /'forbidden', \{ status: 403, headers: Object\.assign\(\{\}, h, TS_NO_CACHE\)/);
assert.match(blk, /return new Response\(r\.body, \{ status: r\.status, headers: Object\.assign\(\{\}, TS_NO_CACHE, \{[\s\S]*?\}, h, \{ vary: TS_NO_CACHE\.vary \}\) \}\);/);
assert.ok(!/caches\.default/.test(blk), 'no edge cache on the /ts-* history block');
ok('index.js: history responses and refusals carry no-store; Vary is set after cors() so Authorization is not lost');
// simulate the header merge exactly as index.js does it (cors() puts vary: Origin)
const cors = { vary: 'Origin', 'access-control-allow-origin': 'https://tradezoro.com' };
const merged = Object.assign({}, TS_NO_CACHE, { 'content-type': 'application/json' }, cors, { vary: TS_NO_CACHE.vary });
assert.equal(merged['cache-control'], 'private, no-store'); assert.equal(merged.vary, 'Authorization, Origin');
ok('merged response headers keep no-store and Vary: Authorization, Origin');

// ---- 3. param allow-list
const fwd = (path, qs, o) => new URL(tsForwardUrl(new URL('https://x' + path + '?' + qs), o));
let f = fwd('/ts-book-history', 'symbol=nq&from=1763090000000&to=1763099000000&fill=0&tier=book&lane=live&cut=0&admin=1&x=1', { tier: 'book', cutMs: 0 });
assert.deepEqual([...f.searchParams.keys()].sort(), ['fill', 'from', 'symbol', 'tier', 'to']);
assert.equal(f.searchParams.get('symbol'), 'NQ'); assert.equal(f.searchParams.get('tier'), 'book');
ok('book history: only symbol/from/to/fill pass; client tier/lane/cut/admin/junk dropped; our tier set');
f = fwd('/ts-aux', 'symbol=ES&from=1&to=2&fill=1&levels=20&sym=NQ', { tier: 'book', cutMs: 0 });
assert.deepEqual([...f.searchParams.keys()].sort(), ['from', 'symbol', 'tier', 'to']);
f = fwd('/ts-trades', 'sym=NQ&from=1&to=2&fill=0&lane=live', { tier: 'book', cutMs: 0 });
assert.deepEqual([...f.searchParams.keys()].sort(), ['fill', 'from', 'sym', 'tier', 'to']);
f = fwd('/ts-live', 'symbol=NQ&levels=20&tier=book&who=admin', { tier: 'trades', cutMs: 0 });
assert.deepEqual([...f.searchParams.keys()].sort(), ['levels', 'symbol', 'tier']); assert.equal(f.searchParams.get('tier'), 'trades');
ok('per-route allow-lists (aux, trades, live) drop everything else, a client tier never survives');
for (const bad of ['1e20', 'Infinity', 'NaN', '-5', '0x10', '1.5', ' 12', '9999999999999999']) {
  f = fwd('/ts-book-history', 'symbol=NQ&to=' + encodeURIComponent(bad), { tier: 'book', cutMs: 0 });
  assert.equal(f.searchParams.has('to'), false, bad);
}
for (const bad of ['NQ;drop', '../x', 'NQ%00', 'AAAAAAAAAAAA', '']) assert.equal(fwd('/ts-aux', 'symbol=' + encodeURIComponent(bad), { tier: 'book' }).searchParams.has('symbol'), false, bad);
for (const bad of ['1', 'true', '00']) assert.equal(fwd('/ts-trades', 'sym=NQ&fill=' + bad, { tier: 'book' }).searchParams.has('fill'), false, bad);
for (const bad of ['0', '201', '1e2', '-1']) assert.equal(fwd('/ts-live', 'symbol=NQ&levels=' + bad, { tier: 'book' }).searchParams.has('levels'), false, bad);
ok('value checks: bad numbers, symbols, fill and levels are dropped');
f = fwd('/ts-book-history', 'symbol=NQ&to=1&to=' + (CUT + 999999), { tier: 'book' });
assert.equal(f.searchParams.getAll('to').length, 1); assert.equal(f.searchParams.get('to'), '1');
ok('duplicate params: first value only, one value forwarded');

// delayed: to is clamped to the cut whatever the client sends; fill forced 0; from never past to
for (const [qs, want] of [['to=' + (CUT + 3600000), CUT], ['to=1e20', CUT], ['', CUT], ['to=' + (CUT - 5000), CUT - 5000], ['to=abc', CUT]]) {
  f = fwd('/ts-book-history', 'symbol=NQ&' + qs, { tier: 'book', cutMs: CUT });
  assert.equal(Number(f.searchParams.get('to')), want, qs); assert.equal(f.searchParams.get('fill'), '0', qs);
  assert.ok(Number(f.searchParams.get('to')) <= CUT);
}
f = fwd('/ts-aux', 'symbol=NQ&from=' + (CUT + 60000) + '&to=' + (CUT + 120000), { tier: 'book', cutMs: CUT });
assert.ok(Number(f.searchParams.get('from')) <= Number(f.searchParams.get('to')) && Number(f.searchParams.get('to')) === CUT);
f = fwd('/ts-trades', 'sym=NQ&fill=0', { tier: 'book', cutMs: CUT });
assert.equal(Number(f.searchParams.get('to')), CUT);
ok('delayed reads: to <= cut for every input (incl. 1e20, empty, junk), fill = 0, from <= to');
f = fwd('/ts-book-history', 'symbol=NQ&to=' + (CUT + 3600000), { tier: 'book', cutMs: 0 });
assert.equal(Number(f.searchParams.get('to')), CUT + 3600000); assert.equal(f.searchParams.has('fill'), false);
ok('live (paid) reads keep their own to');
for (const p of TS_HISTORY) assert.ok(TS_PARAMS[p], p);
ok('every history route has an allow-list');

// ---- end to end through the real Worker fetch (src/index.js), real token verification, stubbed Firestore + DO.
// The DO stub echoes the URL it was given, so we see exactly what reaches the hub.
{
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const mint = async (over = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const p = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'uid-free', iat: now - 5, exp: now + 3600, firebase: { sign_in_provider: 'password' }, ...over }));
    return h + '.' + p + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p)));
  };
  const admins = new Set(['uid-admin']);
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }));
    if (url.includes('/documents/plans')) return new Response(JSON.stringify({ documents: [{ name: 'x/plans/Sj1', fields: { name: { stringValue: 'Pro' }, rank: { integerValue: '1' } } }] }));
    if (url.includes('/students/')) return new Response(JSON.stringify({ fields: { plan: { stringValue: 'Starter' } } }));
    if (url.includes('/admins/')) return new Response('{}', { status: admins.has(decodeURIComponent(url.split('/admins/')[1])) ? 200 : 403 });
    return new Response('{}', { status: 404 });
  };
  const { default: worker } = await import('../src/index.js');
  let seen = null;
  const env = { TS_ACCESS: 'pro', RL_OF: { limit: async () => ({ success: true }) },
    RECORDER: { idFromName: () => 'id', get: () => ({ fetch: async (rq) => { seen = new URL(rq.url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); } }) } };
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
  const W = (path, hdr) => { seen = null; return worker.fetch(new Request('https://w.dev' + path, { headers: hdr }), env, ctx); };
  const free = await mint(), admin = await mint({ sub: 'uid-admin' }), anon = await mint({ sub: 'uid-anon', firebase: { sign_in_provider: 'anonymous' } });
  const far = Date.now() + 3600000, cutMax = Date.now() - 10 * 60000;

  for (const p of ['/ts-book-history', '/ts-aux', '/ts-trades']) {
    const q = (p === '/ts-trades' ? '?sym=NQ' : '?symbol=NQ') + '&from=1&to=' + far + '&tier=book&lane=live';
    let r = await W(p + q, { authorization: 'Bearer ' + free, upgrade: 'websocket', connection: 'Upgrade' });
    assert.equal(r.status, 400, p + ' free + faked upgrade'); assert.equal(seen, null, 'never reaches the hub');
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    r = await W(p + q, { authorization: 'Bearer ' + admin, upgrade: 'websocket' });
    assert.equal(r.status, 400, p + ' even a payer cannot upgrade a history route');
    r = await W(p + q, { authorization: 'Bearer ' + free });
    assert.equal(r.status, 200, p + ' free member reads history');
    assert.ok(Number(seen.searchParams.get('to')) <= cutMax, p + ' free: to clamped to now - 11 min (' + seen.searchParams.get('to') + ')');
    assert.equal(seen.searchParams.get('fill'), '0'); assert.equal(seen.searchParams.get('tier'), 'book'); assert.equal(seen.searchParams.has('lane'), false);
    assert.equal(r.headers.get('cache-control'), 'private, no-store'); assert.match(r.headers.get('vary'), /Authorization/); assert.match(r.headers.get('vary'), /Origin/);
    assert.ok(Number(r.headers.get('x-ts-delayed')) > 0);
    r = await W(p + q, { authorization: 'Bearer ' + admin });
    assert.equal(r.status, 200); assert.equal(Number(seen.searchParams.get('to')), far, p + ' payer: live, to kept'); assert.equal(r.headers.get('x-ts-delayed'), '0');
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    for (const hdr of [{}, { authorization: 'Bearer ' + anon }, { authorization: 'Bearer junk' }]) {
      r = await W(p + q, hdr); assert.equal(r.status, 403, p + ' refused ' + JSON.stringify(Object.keys(hdr))); assert.equal(seen, null);
      assert.equal(r.headers.get('cache-control'), 'private, no-store'); assert.match(r.headers.get('vary'), /Authorization/);
    }
  }
  ok('Worker e2e: faked Upgrade on history = 400 (free and payer), free = delayed + clamped + no-store/Vary, payer = live, none/anon/junk = 403');
  const r = await W('/ts-live?symbol=NQ', { authorization: 'Bearer ' + free });
  assert.equal(r.status, 426, '/ts-live without upgrade');
  ok('Worker e2e: /ts-live without an upgrade = 426');
}

console.log('ts-route: ' + n + ' passed');
