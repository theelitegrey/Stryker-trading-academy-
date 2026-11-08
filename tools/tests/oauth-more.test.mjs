// Alpaca + tastytrade sign-in tests: scope guards, token functions, refresh, bearer data calls. No real keys, no network.
// Run: node tools/tests/oauth-more.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { webcrypto as C } from 'node:crypto';
import { handle as alpacaH } from '../../functions/connect/alpaca/token.js';
import { handle as tastyH } from '../../functions/connect/tastytrade/token.js';
import * as oa from '../../assets/byo-oauth.js?v=919';
import { SOURCES, alpaca } from '../../assets/byo-core.js?v=919';
import { tastytrade } from '../../assets/byo-tastytrade.js?v=919';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const SECRET = 'SECRETFAKE-abc123';
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const kp = await C.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await C.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const now = Math.floor(Date.now() / 1000);
const mk = async () => { const h = b({ alg: 'RS256', kid: 'k1' }), pl = b({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'u1', iat: now, exp: now + 600 }); return h + '.' + pl + '.' + Buffer.from(await C.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(h + '.' + pl))).toString('base64url'); };
const verifyFetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=300' } });
const good = await mk();
const SRC = { alpaca: { h: alpacaH, up: 'https://api.alpaca.markets/oauth/token', env: { ALPACA_CLIENT_ID: 'CLIENTID123', ALPACA_CLIENT_SECRET: SECRET }, form: true, refresh: false },
  tastytrade: { h: tastyH, up: 'https://api.tastyworks.com/oauth/token', env: { TASTY_CLIENT_ID: 'CLIENTID123', TASTY_CLIENT_SECRET: SECRET }, form: false, refresh: true } };

for (const [id, S] of Object.entries(SRC)) {
  const treq = (o = {}) => new Request(`https://tradezoro.com/connect/${id}/token` + (o.q || ''), { method: o.method || 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + good, ...(o.h || {}) }, body: (o.method || 'POST') === 'POST' ? (o.body ?? JSON.stringify({ grant: 'code', code: 'CODEFAKE12345' })) : undefined });
  let upstream = null;
  const fetchImpl = async (u, o) => { upstream = { u, o }; return new Response(JSON.stringify({ access_token: 'ACCESSFAKE1', refresh_token: 'REFRESHFAKE1', expires_in: 900, token_type: 'Bearer', scope: 'x', id_token: 'LEAK', extra: 'y' }), { status: 200 }); };
  const call = (r, env = S.env, deps = {}) => S.h(r, env, { verifyFetch, fetchImpl, ...deps });
  await t(id + ' token fn: probe, method, origin, content-type, auth, body, nothing upstream on a bad call', async () => {
    assert.deepEqual(await (await call(treq({ method: 'GET', q: '?probe=1' }))).json(), { configured: true, client_id: 'CLIENTID123' });
    assert.equal((await call(treq({ method: 'GET', q: '?probe=1' }), {})).status, 503);
    assert.equal((await call(treq({ method: 'GET' }))).status, 404);
    assert.equal((await call(treq(), {})).status, 503);
    assert.equal((await call(treq({ method: 'PUT' }))).status, 405);
    assert.equal((await call(treq({ h: { origin: 'https://evil.example.com' } }))).status, 403);
    assert.equal((await call(treq({ h: { origin: '' } }))).status, 403);
    assert.equal((await call(treq({ h: { 'content-type': 'text/plain' } }))).status, 415);
    assert.equal((await call(treq({ h: { authorization: '' } }))).status, 401);
    assert.equal((await call(treq({ body: '{"grant":"code","code":"bad code"}' }))).status, 400);
    assert.equal((await call(treq({ body: '{"grant":"x"}' }))).status, 400);
    assert.equal(upstream, null);
  });
  await t(id + ' token fn: POST to the broker only, fixed redirect, secret server-side, trimmed reply, nothing logged', async () => {
    const logs = []; const o = [console.log, console.error, console.warn]; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
    const r = await call(treq()); const j = await r.json(); [console.log, console.error, console.warn] = o;
    assert.equal(r.status, 200); assert.equal(j.access_token, 'ACCESSFAKE1'); assert.equal(j.id_token, undefined); assert.equal(j.extra, undefined);
    assert.ok(Object.keys(j).every((k) => ['access_token', 'refresh_token', 'expires_in', 'token_type', 'scope'].includes(k)));
    assert.equal(upstream.u, S.up); assert.equal(upstream.o.method, 'POST'); assert.equal(upstream.o.redirect, 'error');
    const body = S.form ? Object.fromEntries(new URLSearchParams(upstream.o.body)) : JSON.parse(upstream.o.body);
    assert.match(upstream.o.headers['Content-Type'], S.form ? /x-www-form-urlencoded/ : /json/);
    assert.equal(body.grant_type, 'authorization_code'); assert.equal(body.code, 'CODEFAKE12345'); assert.equal(body.client_secret, SECRET); assert.equal(body.client_id, 'CLIENTID123');
    assert.equal(body.redirect_uri, `https://tradezoro.com/connect/${id}/callback`);
    assert.ok(!logs.join('').match(/ACCESSFAKE|REFRESHFAKE|SECRETFAKE/));
    assert.equal(j.refresh_token, S.refresh ? 'REFRESHFAKE1' : undefined, 'refresh token only where the broker has one');
    // client can never choose the redirect
    await call(treq({ body: JSON.stringify({ grant: 'code', code: 'CODEFAKE12345', redirect_uri: 'https://evil.example.com' }) }));
    const b2 = S.form ? Object.fromEntries(new URLSearchParams(upstream.o.body)) : JSON.parse(upstream.o.body); assert.equal(b2.redirect_uri, `https://tradezoro.com/connect/${id}/callback`);
    const bad = await call(treq(), S.env, { fetchImpl: async () => new Response(JSON.stringify({ error: 'x', error_description: SECRET }), { status: 400 }) });
    assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('SECRETFAKE'));
    assert.equal((await call(treq(), S.env, { fetchImpl: async () => { throw new Error('boom ' + SECRET); } })).status, 502);
  });
  await t(id + ' token fn: refresh grant ' + (S.refresh ? 'works' : 'is refused (no refresh at this broker)'), async () => {
    upstream = null;
    const r = await call(treq({ body: JSON.stringify({ grant: 'refresh', refresh_token: 'REFRESHFAKE1' }) }));
    if (!S.refresh) { assert.equal(r.status, 400); assert.equal(upstream, null); return; }
    assert.equal(r.status, 200);
    const body = JSON.parse(upstream.o.body); assert.equal(body.grant_type, 'refresh_token'); assert.equal(body.refresh_token, 'REFRESHFAKE1'); assert.equal(body.redirect_uri, undefined); assert.equal(body.client_secret, SECRET);
  });
}

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
await t('OAuth URLs: ONLY the data-only scope, fixed redirect, single-use state bound to source + user', () => {
  const st = mem();
  let u = new URL(oa.oauthAuthUrl('alpaca', 'CID_1', 'u1', st));
  assert.equal(u.origin + u.pathname, 'https://app.alpaca.markets/oauth/authorize'); assert.equal(u.searchParams.get('scope'), 'data'); assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/alpaca/callback');
  const s = u.searchParams.get('state'); assert.ok(s.length >= 20);
  assert.equal(oa.takeOauthState('tastytrade', s, 'u1', st), null, 'wrong source'); 
  oa.oauthAuthUrl('alpaca', 'C', 'u1', st); const s2 = JSON.parse(st.getItem('tz-oauth-state')).state;
  assert.equal(oa.takeOauthState('alpaca', s2, 'u2', st), null, 'other user');
  oa.oauthAuthUrl('alpaca', 'C', 'u1', st); const s3 = JSON.parse(st.getItem('tz-oauth-state')).state;
  assert.ok(oa.takeOauthState('alpaca', s3, 'u1', st)); assert.equal(oa.takeOauthState('alpaca', s3, 'u1', st), null, 'single use');
  u = new URL(oa.oauthAuthUrl('tastytrade', 'CID_2', 'u1', st));
  assert.equal(u.origin + u.pathname, 'https://my.tastytrade.com/auth.html'); assert.equal(u.searchParams.get('scope'), 'read'); assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/tastytrade/callback'); assert.equal(u.searchParams.get('client_id'), 'CID_2');
  assert.throws(() => oa.oauthAuthUrl('alpaca', 'C', null, st), /Sign in/); assert.throws(() => oa.oauthAuthUrl('schwab', 'C', 'u1', st), /Unknown/);
  assert.equal(oa.OA.alpaca.SCOPE, 'data'); assert.equal(oa.OA.tastytrade.SCOPE, 'read');
});
await t('trading / account-write scope words appear nowhere in the sign-in code, pages or URLs', () => {
  const words = ['scope=trading', 'scope=trade', 'account:write', "SCOPE: 'trading'", "SCOPE: 'trade'", 'scope=data+', 'scope=read+', 'scope=data%20', 'scope=read%20', 'scope=data,', 'scope=read,'];
  const files = ['assets/byo-oauth.js', 'assets/oauth-callback.js', 'oauth-callback.html', 'assets/byo-ui.js', 'assets/byo-core.js', 'assets/byo-tastytrade.js', 'functions/connect/_token.js', 'functions/connect/alpaca/token.js', 'functions/connect/tastytrade/token.js', '_redirects', '_headers'];
  for (const p of files) { const s = readFileSync(new URL('../../' + p, import.meta.url), 'utf8'); for (const w of words) assert.ok(!s.includes(w), p + ' has ' + w); }
  const walk = (d) => readdirSync(d).flatMap((x) => { const p = d + '/' + x; return statSync(p).isDirectory() ? (['node_modules', '.git', 'vendor'].includes(x) ? [] : walk(p)) : /\.(js|mjs|html)$/.test(x) ? [p] : []; });
  for (const p of [...walk(new URL('../../assets', import.meta.url).pathname), ...walk(new URL('../../functions', import.meta.url).pathname)]) { const s = readFileSync(p, 'utf8'); assert.ok(!/account:write/.test(s), p); assert.ok(!/authorize\?[^'"`]*scope=(trad|account)/.test(s), p); }
  // the grant check: a token that carries a trading scope is refused
  const fetchBad = (scope) => async () => new Response(JSON.stringify({ access_token: 'A'.repeat(20), scope }), { status: 200 });
  return Promise.all(['trade', 'read trade', 'trading', 'data account:write'].map((sc) => assert.rejects(oa.oauthTokenCall('alpaca', { grant: 'code', code: 'x' }, 'IDT', { fetch: fetchBad(sc) }), /place trades/)))
    .then(() => oa.oauthTokenCall('alpaca', { grant: 'code', code: 'x' }, 'IDT', { fetch: fetchBad('data') }));
});
await t('catalogue: both rows stay paste-a-key until the probe says configured; probe flips them', async () => {
  const al = SOURCES.find((s) => s.id === 'alpaca'), ty = SOURCES.find((s) => s.id === 'tastytrade');
  assert.ok(!al.oauth && !ty.oauth && al.fields && ty.fields, 'today: key forms, no sign-in');
  assert.equal(await oa.enableOauthIfConfigured({ fetch: async () => new Response('{"configured":false}', { status: 503 }) }), false); assert.ok(!al.oauth);
  assert.equal(await oa.enableOauthIfConfigured({ fetch: async (u) => new Response(String(u).includes('alpaca') ? '{"configured":true,"client_id":"ALP_ID_1"}' : '{"configured":false}', { status: String(u).includes('alpaca') ? 200 : 503 }) }), true);
  assert.ok(al.oauth && al.keyAlt && al.clientId === 'ALP_ID_1' && al.fields, 'alpaca on, key form kept'); assert.ok(!ty.oauth);
  assert.equal(await oa.enableOauthIfConfigured({ fetch: async () => new Response('{"configured":true,"client_id":"bad id!"}') }), false, 'odd client id refused');
  assert.match(oa.OA.tastytrade.note, /two-factor/i);
});
await t('alpaca: bearer headers for sign-in, key headers for pasted keys; data calls go to data.alpaca.markets only', async () => {
  assert.deepEqual(alpaca.headers({ oauth: true, access: 'TOK1' }), { Authorization: 'Bearer TOK1' });
  assert.deepEqual(alpaca.headers({ key: 'K', secret: 'S' }), { 'APCA-API-KEY-ID': 'K', 'APCA-API-SECRET-KEY': 'S' });
  let seen; const d = { fetch: async (u, o) => { seen = { u, o }; return new Response(JSON.stringify({ bars: [{ t: '2026-11-03T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 9 }] }), { status: 200 }); } };
  const bars = await alpaca.getBars({ oauth: true, access: 'TOK1', feed: 'iex' }, 'SPY', '1D', { limit: 1 }, d);
  assert.equal(bars.length, 1); assert.equal(new URL(seen.u).hostname, 'data.alpaca.markets'); assert.equal(seen.o.headers.Authorization, 'Bearer TOK1'); assert.equal(seen.o.headers['APCA-API-SECRET-KEY'], undefined); assert.equal(seen.o.redirect, 'error');
  // websocket: authenticates with key "oauth"
  const sent = []; class WS { constructor() { WS.i = this; setTimeout(() => this.onmessage({ data: '[{"T":"success","msg":"connected"}]' }), 0); } send(s) { sent.push(JSON.parse(s)); if (sent.length === 1) setTimeout(() => this.onmessage({ data: '[{"T":"success","msg":"authenticated"}]' }), 0); } close() {} }
  const st = []; const hub = alpaca.hub({ oauth: true, access: 'TOK1' }, (s, m) => st.push(m), { WS }); const stop = alpaca.subscribe(hub, 'SPY', '1', null, () => {});
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(sent[0], { action: 'auth', key: 'oauth', secret: 'TOK1' }); assert.equal(sent[1].action, 'subscribe'); stop(); hub.stop();
  // a 401 with a sign-in says Reconnect
  const sent2 = []; class WS2 { constructor() { setTimeout(() => this.onmessage({ data: '[{"T":"success","msg":"connected"}]' }), 0); } send(s) { sent2.push(s); setTimeout(() => this.onmessage({ data: '[{"T":"error","code":402,"msg":"auth failed"}]' }), 0); } close() {} }
  let msg = ''; const h2 = alpaca.hub({ oauth: true, access: 'T' }, (s, m) => { if (s === 'error') msg = m; }, { WS: WS2 }); const s2 = alpaca.subscribe(h2, 'SPY', '1', null, () => {});
  await new Promise((r) => setTimeout(r, 600)); assert.equal(msg, 'Reconnect Alpaca'); s2(); h2.stop();
});
await t('tastytrade: sign-in token is used as bearer, refreshed ~2 min before the 15-min end, one refresh at a time, no secret in the browser', async () => {
  const calls = []; let tok = 0;
  const d = { idToken: async () => 'IDT', fetch: async (u, o) => {
    calls.push({ u: String(u), o });
    if (String(u).startsWith('/connect/tastytrade/token')) return new Response(JSON.stringify({ access_token: 'ACCESS' + (++tok), refresh_token: 'RT_NEW', expires_in: 900, scope: 'read' }), { status: 200 });
    return new Response(JSON.stringify({ data: { token: 'QT', 'dxlink-url': 'wss://tasty-openapi-ws.dxfeed.com/realtime' } }), { status: 200 });
  } };
  const c = { oauth: true, access: 'ACCESS0', refresh: 'RT_OLD', exp: Date.now() + 15 * 60000 };
  await tastytrade.check(c, d);
  const api = calls.filter((x) => x.u.startsWith('https://api.tastyworks.com'));
  assert.equal(api.length, 1); assert.equal(new URL(api[0].u).pathname, '/api-quote-tokens'); assert.equal(api[0].o.headers.Authorization, 'Bearer ACCESS0');
  assert.ok(!calls.some((x) => /oauth\/token/.test(x.u) && x.u.startsWith('https')), 'browser never calls the broker token URL on sign-in');
  assert.equal(calls.filter((x) => x.u.startsWith('/connect/')).length, 0, 'fresh token: no refresh yet');
  // 90 s before the end -> refresh through OUR function, in one flight even with many callers
  c.exp = Date.now() + 90000;
  const c2 = { ...c }; Object.keys(c).forEach(() => {});
  await Promise.all([oa.freshOauth('tastytrade', c, d), oa.freshOauth('tastytrade', c, d), oa.freshOauth('tastytrade', c, d)]);
  const fn = calls.filter((x) => x.u.startsWith('/connect/tastytrade/token'));
  assert.equal(fn.length, 1, 'single refresh'); assert.equal(fn[0].o.method, 'POST'); assert.equal(JSON.parse(fn[0].o.body).refresh_token, 'RT_OLD'); assert.equal(fn[0].o.headers.Authorization, 'Bearer IDT');
  assert.equal(c.access, 'ACCESS1'); assert.equal(c.refresh, 'RT_NEW'); assert.ok(c.exp - Date.now() > 14 * 60000);
  assert.ok(!JSON.stringify(calls).match(/client_secret/), 'no client secret in the browser');
  // refused refresh -> Reconnect
  const dead = { oauth: true, access: 'A', refresh: 'R', exp: Date.now() + 1000 };
  await assert.rejects(oa.freshOauth('tastytrade', dead, { idToken: async () => 'IDT', fetch: async () => new Response('{}', { status: 400 }) }), (e) => e.reconnect === true && /Reconnect tastytrade/.test(e.message));
  await assert.rejects(oa.freshOauth('tastytrade', { oauth: true, access: 'A', exp: Date.now() + 1000 }, d), (e) => e.reconnect === true, 'no refresh token');
  // a read token carrying trade scope is refused even on refresh
  await assert.rejects(oa.freshOauth('tastytrade', { oauth: true, access: 'A', refresh: 'R', exp: Date.now() + 1000 }, { idToken: async () => 'I', fetch: async () => new Response(JSON.stringify({ access_token: 'A'.repeat(12), scope: 'read trade' }), { status: 200 }) }), /place trades/);
  // 401/403 on a data call is not retried (existing rule)
  const c3 = { oauth: true, access: 'AX', refresh: 'R', exp: Date.now() + 15 * 60000 }; let hits = 0;
  await assert.rejects(tastytrade.check(c3, { idToken: async () => 'I', fetch: async () => { hits++; return new Response('{}', { status: 403 }); } }), (e) => e.status === 403);
  assert.equal(hits, 1, 'no retry after 403');
});
await t('tastytrade: paste-a-key path unchanged (refresh token swapped in the browser, trade scope refused)', async () => {
  const c = { clientId: 'C', clientSecret: 'S', refreshToken: 'R' }; const seen = [];
  const d = { fetch: async (u, o) => { seen.push(String(u)); if (String(u).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'x.y.z', expires_in: 900, scope: 'read trade' }), { status: 200 }); return new Response('{}', { status: 200 }); } };
  await assert.rejects(tastytrade.check(c, d), /place trades/); assert.deepEqual(seen, ['https://api.tastyworks.com/oauth/token']);
});
console.log('ALL PASS', n); process.exit(0);
