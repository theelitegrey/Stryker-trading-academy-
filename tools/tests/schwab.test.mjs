// Schwab connect tests: guard, symbol map, OAuth state, token function, adapter on fixtures. No real keys, no network.
// Run: node tools/tests/schwab.test.mjs
import assert from 'node:assert/strict';
import { guardUrl, guardWs, guardWsMessage, schwab, schwabAuthUrl, takeSchwabState, streamerInfoOf, schwabCreds, SCHWAB, SOURCES, Hub } from '../../assets/byo-core.js?v=949';
import { handle } from '../../functions/connect/schwab/token.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

await t('guard: only pricehistory + userPreference; every account/order/position path refused', () => {
  guardUrl('schwab', 'https://api.schwabapi.com/marketdata/v1/pricehistory?symbol=AAPL');
  guardUrl('schwab', 'https://api.schwabapi.com/trader/v1/userPreference');
  for (const u of ['/trader/v1/accounts', '/trader/v1/accounts/accountNumbers', '/trader/v1/accounts/HASH/orders', '/trader/v1/orders', '/trader/v1/accounts/HASH/positions', '/trader/v1/positions', '/trader/v1/userPreference/x', '/trader/v1/transactions', '/marketdata/v1/quotes', '/marketdata/v1/chains', '/v1/oauth/token', '/trader/v1/userPreference%2F..%2Faccounts', '/trader/v1//accounts'])
    assert.throws(() => guardUrl('schwab', 'https://api.schwabapi.com' + u), /byo-guard/, u);
  assert.throws(() => guardUrl('schwab', 'https://api.schwabapi.com/trader/v1/userPreference', 'POST'), /byo-guard/);
  assert.throws(() => guardUrl('schwab', 'https://api.schwabapi.com/trader/v1/userPreference', 'DELETE'), /byo-guard/);
  assert.throws(() => guardUrl('schwab', 'https://evil.example.com/trader/v1/userPreference'), /byo-guard/);
});
await t('guard: streamer socket + messages', () => {
  guardWs('schwab', 'wss://streamer-api.schwab.com/ws');
  for (const u of ['wss://streamer-api.schwab.com/ws/x', 'wss://evil.example.com/ws', 'ws://streamer-api.schwab.com/ws']) assert.throws(() => guardWs('schwab', u), /byo-guard/);
  const m = (service, command) => ({ requests: [{ service, command }] });
  for (const [s, c] of [['ADMIN', 'LOGIN'], ['ADMIN', 'LOGOUT'], ['LEVELONE_EQUITIES', 'SUBS'], ['LEVELONE_FUTURES', 'ADD'], ['CHART_EQUITY', 'SUBS'], ['CHART_FUTURES', 'UNSUBS']]) guardWsMessage('schwab', m(s, c));
  for (const [s, c] of [['ACCT_ACTIVITY', 'SUBS'], ['ACCT_ACTIVITY', 'LOGIN'], ['LEVELONE_EQUITIES', 'LOGIN'], ['ADMIN', 'SUBS'], ['ORDERS', 'SUBS'], ['LEVELONE_EQUITIES', 'VIEW']]) assert.throws(() => guardWsMessage('schwab', m(s, c)), /byo-guard/, s + c);
  assert.throws(() => guardWsMessage('schwab', { requests: [m('LEVELONE_EQUITIES', 'SUBS').requests[0], m('ACCT_ACTIVITY', 'SUBS').requests[0]] }), /byo-guard/);
  assert.throws(() => guardWsMessage('schwab', { requests: [] }), /byo-guard/);
  assert.throws(() => guardWsMessage('schwab', 'x'), /byo-guard/);
});
await t('streamerInfoOf keeps only socket fields, refuses a foreign socket', () => {
  const ok = { accounts: [{ accountNumber: '123456789' }], streamerInfo: [{ streamerSocketUrl: 'wss://streamer-api.schwab.com/ws', schwabClientCustomerId: 'C', schwabClientCorrelId: 'R', schwabClientChannel: 'N9', schwabClientFunctionId: 'APIAPP' }] };
  const i = streamerInfoOf(ok); assert.deepEqual(Object.keys(i).sort(), ['channel', 'correl', 'customer', 'fn', 'url']);
  assert.ok(!JSON.stringify(i).includes('123456789'));
  assert.equal(streamerInfoOf({ streamerInfo: [{ ...ok.streamerInfo[0], streamerSocketUrl: 'wss://evil.example.com/ws' }] }), null);
  assert.equal(streamerInfoOf({}), null);
});
await t('symbol map', () => {
  const m = (x) => schwab.symbolOf(x);
  assert.equal(m('AAPL'), 'AAPL'); assert.equal(m('byo:brk.b'), 'BRK.B'); assert.equal(m('ES1!'), '/ES'); assert.equal(m('/ES'), '/ES'); assert.equal(m('/ESZ26'), '/ESZ26'); assert.equal(m('NQ1!'), '/NQ'); assert.equal(m('byo:MES1!'), '/MES');
  assert.equal(m('../x'), null); assert.equal(m(''), null); assert.equal(m('/ZZZ'), null);
});
await t('catalogue: schwab stays "soon" until the flag; no order words', () => {
  assert.equal(SOURCES.find((s) => s.id === 'schwab').state, 'soon');
  assert.ok(!/order|trade|position|balance/i.test(JSON.stringify(SOURCES.find((s) => s.id === 'schwab').help)));
});
await t('OAuth state: single use, same user, expiry, authorize URL', async () => {
  const st = mem(); const url = new URL(await schwabAuthUrl('CLIENTID123', 'u1', st));
  assert.equal(url.origin + url.pathname, 'https://api.schwabapi.com/v1/oauth/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/schwab/callback'); assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.get('client_id'), 'CLIENTID123');
  const s = url.searchParams.get('state'); assert.ok(s.length >= 20);
  assert.equal(takeSchwabState('wrong', 'u1', st), null); assert.equal(takeSchwabState(s, 'u1', st), null, 'consumed even on a miss');
  await schwabAuthUrl('C', 'u1', st); const s2 = JSON.parse(st.getItem(SCHWAB.STATE_KEY)).state;
  assert.equal(takeSchwabState(s2, 'u2', st), null, 'other user');
  await schwabAuthUrl('C', 'u1', st); const s3 = JSON.parse(st.getItem(SCHWAB.STATE_KEY)).state;
  assert.ok(takeSchwabState(s3, 'u1', st)); assert.equal(takeSchwabState(s3, 'u1', st), null, 'single use');
  await schwabAuthUrl('C', 'u1', st); const r = JSON.parse(st.getItem(SCHWAB.STATE_KEY)); r.exp = Date.now() - 1; st.setItem(SCHWAB.STATE_KEY, JSON.stringify(r));
  assert.equal(takeSchwabState(r.state, 'u1', st), null, 'expired');
  await assert.rejects(() => schwabAuthUrl('C', null, st), /Sign in/);
});

// ---- token function ----
const ENV = { SCHWAB_CLIENT_ID: 'CLIENTID123', SCHWAB_CLIENT_SECRET: 'SECRETFAKE' };
const req = (o = {}) => new Request('https://tradezoro.com/connect/schwab/token' + (o.q || ''), { method: o.method || 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer h.p.s', ...(o.h || {}) }, body: o.method === 'GET' ? undefined : (o.body ?? JSON.stringify({ grant: 'code', code: 'CODEABCDEFGH' })) });
// verifyIdToken is real; stub Google's cert fetch? Simpler: build a signed token.
import { webcrypto as C } from 'node:crypto';
const kp = await C.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await C.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const mk = async (p = {}) => { const h = b({ alg: 'RS256', kid: 'k1' }), pl = b({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'u1', iat: now, exp: now + 600, ...p }); return h + '.' + pl + '.' + Buffer.from(await C.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(h + '.' + pl))).toString('base64url'); };
const verifyFetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=300' } });
const good = await mk();
let upstream = null;
const fetchImpl = async (u, o) => { upstream = { u, o }; return new Response(JSON.stringify({ access_token: 'ACCESSFAKE1', refresh_token: 'REFRESHFAKE1', expires_in: 1800, id_token: 'IDT', token_type: 'Bearer', scope: 'api' }), { status: 200 }); };
const call = (r, env = ENV, deps = {}) => handle(r, env, { verifyFetch, fetchImpl, ...deps });
const logs = []; const oLog = console.log, oErr = console.error, oWarn = console.warn;
await t('token fn: probe + 503 when not configured', async () => {
  assert.deepEqual(await (await call(req({ method: 'GET', q: '?probe=1' }))).json(), { configured: true, client_id: 'CLIENTID123' });
  const off = await call(req({ method: 'GET', q: '?probe=1' }), {}); assert.equal(off.status, 503); assert.equal((await off.json()).configured, false);
  assert.equal((await call(req(), {})).status, 503);
  assert.equal((await call(req({ method: 'GET' }))).status, 404);
  assert.equal((await call(req({ method: 'PUT' }))).status, 405);
  assert.equal((await call(req({ method: 'DELETE' }))).status, 405);
});
await t('token fn: origin, content-type, auth, body checks', async () => {
  const h = { authorization: 'Bearer ' + good };
  assert.equal((await call(req({ h: { ...h, origin: 'https://evil.example.com' } }))).status, 403);
  assert.equal((await call(req({ h: { ...h, origin: 'https://www.tradezoro.com' } }))).status, 403);
  assert.equal((await call(req({ h: { ...h, origin: '' } }))).status, 403);
  assert.equal((await call(req({ h: { ...h, 'sec-fetch-site': 'cross-site' } }))).status, 403);
  assert.equal((await call(req({ h: { ...h, 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await call(req({ h: { authorization: 'Bearer nope.nope.nope' } }))).status, 401);
  assert.equal((await call(req({ h: { authorization: '' } }))).status, 401);
  assert.equal((await call(req({ h, body: '{"grant":"code","code":"bad code"}' }))).status, 400);
  assert.equal((await call(req({ h, body: '{"grant":"x"}' }))).status, 400);
  assert.equal((await call(req({ h, body: 'not json' }))).status, 400);
  assert.equal((await call(req({ h, body: JSON.stringify({ grant: 'code', code: 'x'.repeat(5000) }) }))).status, 400);
  assert.equal(upstream, null, 'nothing reached Schwab for a bad call');
});
await t('token fn: swap + refresh go only to Schwab token URL; reply is trimmed; nothing logged', async () => {
  console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  const h = { authorization: 'Bearer ' + good };
  const r = await call(req({ h })); const j = await r.json();
  console.log = oLog; console.error = oErr; console.warn = oWarn;
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(j).sort(), ['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type']);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(upstream.u, 'https://api.schwabapi.com/v1/oauth/token'); assert.equal(upstream.o.method, 'POST'); assert.equal(upstream.o.redirect, 'error');
  assert.equal(upstream.o.headers.Authorization, 'Basic ' + Buffer.from('CLIENTID123:SECRETFAKE').toString('base64'));
  const f = new URLSearchParams(upstream.o.body); assert.equal(f.get('grant_type'), 'authorization_code'); assert.equal(f.get('redirect_uri'), 'https://tradezoro.com/connect/schwab/callback'); assert.equal(f.get('code'), 'CODEABCDEFGH');
  await call(req({ h, body: JSON.stringify({ grant: 'refresh', refresh_token: 'REFRESHFAKE1' }) }));
  const f2 = new URLSearchParams(upstream.o.body); assert.equal(f2.get('grant_type'), 'refresh_token'); assert.equal(f2.get('refresh_token'), 'REFRESHFAKE1'); assert.equal(f2.get('redirect_uri'), null);
  assert.ok(!logs.join('').match(/ACCESSFAKE|REFRESHFAKE|SECRETFAKE/));
});
await t('token fn: Schwab errors become generic; rate limit', async () => {
  const h = { authorization: 'Bearer ' + good };
  const r400 = await call(req({ h }), ENV, { fetchImpl: async () => new Response('{"error":"invalid_grant","error_description":"SECRETFAKE"}', { status: 400 }) });
  assert.equal(r400.status, 400); assert.ok(!(await r400.text()).includes('SECRETFAKE'));
  assert.equal((await call(req({ h }), ENV, { fetchImpl: async () => { throw new Error('boom ACCESSFAKE'); } })).status, 502);
  assert.equal((await call(req({ h }), ENV, { fetchImpl: async () => new Response('<html>', { status: 500 }) })).status, 502);
  const kv = new Map(); const env = { ...ENV, PASSKEYS: { get: async (k) => kv.get(k), put: async (k, v) => kv.set(k, v) } };
  let last; for (let i = 0; i < 25; i++) last = await call(req({ h: { ...h, 'cf-connecting-ip': '1.2.3.4' } }), env);
  assert.equal(last.status, 429);
});

// ---- adapter on fixtures ----
const fresh = () => ({ access: 'ACC', refresh: 'REF', exp: Date.now() + 1800e3, rexp: Date.now() + 7 * 864e5 });
await t('getBars: pricehistory request + bars; 2h grouping; refused paths never fetched', async () => {
  const seen = [];
  const d = { fetch: async (u, o) => { seen.push(u); assert.equal(o.headers.Authorization, 'Bearer ACC'); assert.equal(o.redirect, 'error'); return new Response(JSON.stringify({ candles: [{ open: 1, high: 3, low: 1, close: 2, volume: 5, datetime: 1700000000000 - (1700000000000 % 7200000) }, { open: 2, high: 4, low: 0, close: 3, volume: 7, datetime: 1700000000000 - (1700000000000 % 7200000) + 1800000 }] }), { status: 200 }); } };
  const m = await schwab.getBars(fresh(), 'AAPL', '5', { limit: 10 }, d);
  assert.equal(m.length, 2); assert.equal(m[0].open, 1); assert.ok(seen[0].startsWith('https://api.schwabapi.com/marketdata/v1/pricehistory?')); assert.match(seen[0], /symbol=AAPL/); assert.match(seen[0], /frequencyType=minute/);
  const h = await schwab.getBars(fresh(), 'AAPL', '120', { limit: 10 }, d); assert.equal(h.length, 1); assert.deepEqual([h[0].open, h[0].high, h[0].low, h[0].close, h[0].volume], [1, 4, 0, 3, 12]);
  assert.match((seen.length, seen[seen.length - 1]), /frequency=30/);
  await schwab.getBars(fresh(), 'ES1!', '1D', { limit: 5 }, d); assert.match(seen[seen.length - 1], /symbol=%2FES/);
  assert.deepEqual(await schwab.getBars(fresh(), '../orders', '5', {}, d), []);
});
await t('refresh: near expiry calls our function, saves new tokens; expired refresh token => Reconnect', async () => {
  const c = { ...fresh(), exp: Date.now() + 60e3 }; let calls = 0;
  const d = { idToken: async () => 'IDT', fetch: async (u, o) => { calls++; assert.equal(u, '/connect/schwab/token'); assert.equal(JSON.parse(o.body).grant, 'refresh'); return new Response(JSON.stringify({ access_token: 'ACC2', expires_in: 1800 }), { status: 200 }); } };
  assert.equal(await schwab.fresh(c, d), 'ACC2'); assert.equal(c.refresh, 'REF', 'keeps the old refresh token if none returned'); assert.equal(calls, 1);
  assert.equal(await schwab.fresh(c, d), 'ACC2'); assert.equal(calls, 1, 'no second call while fresh');
  await assert.rejects(() => schwab.fresh({ ...fresh(), exp: 0, rexp: Date.now() - 1 }, d), (e) => e.reconnect === true);
  await assert.rejects(() => schwab.fresh({ ...fresh(), exp: 0 }, { idToken: async () => 'I', fetch: async () => new Response('{}', { status: 400 }) }), (e) => e.reconnect === true && e.message === 'Reconnect Schwab');
});
await t('streamer: userPreference is the only /trader call; login, subscribe, ticks -> hub', async () => {
  const paths = [];
  const d = { fetch: async (u) => { paths.push(new URL(u).pathname); return new Response(JSON.stringify({ accounts: [{ accountNumber: '999' }], streamerInfo: [{ streamerSocketUrl: 'wss://streamer-api.schwab.com/ws', schwabClientCustomerId: 'C', schwabClientCorrelId: 'R', schwabClientChannel: 'N9', schwabClientFunctionId: 'APIAPP' }] }), { status: 200 }); },
    WS: class { constructor(u) { this.url = u; this.sent = []; WS0.push(this); setTimeout(() => this.onopen && this.onopen(), 5); } send(m) { this.sent.push(JSON.parse(m)); const q = JSON.parse(m).requests[0]; if (q.command === 'LOGIN') setTimeout(() => this.onmessage({ data: JSON.stringify({ response: [{ service: 'ADMIN', command: 'LOGIN', content: { code: 0 } }] }) }), 5); } close() {} } };
  const WS0 = [];
  const ticks = [], hub = schwab.hub(fresh(), () => {}, d);
  const off = schwab.subscribe(hub, 'AAPL', '1', null, (b) => ticks.push(b)); schwab.subscribe(hub, 'ES1!', '1', null, () => {});
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(paths, ['/trader/v1/userPreference']); const ws = WS0[0];
  assert.equal(ws.url, 'wss://streamer-api.schwab.com/ws');
  const cmds = ws.sent.map((m) => m.requests[0].service + ':' + m.requests[0].command); assert.ok(cmds.includes('ADMIN:LOGIN') && cmds.includes('LEVELONE_EQUITIES:SUBS') && cmds.includes('CHART_EQUITY:SUBS') && cmds.includes('LEVELONE_FUTURES:SUBS') && cmds.includes('CHART_FUTURES:SUBS'));
  assert.ok(!cmds.some((c) => /ACCT|ORDER/.test(c)));
  assert.equal(ws.sent.find((m) => m.requests[0].service === 'LEVELONE_FUTURES').requests[0].parameters.keys, '/ES');
  ws.onmessage({ data: JSON.stringify({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'AAPL', 3: 190.5, 9: 100 }] }] }) });
  assert.equal(ticks.length, 1); assert.equal(ticks[0].close, 190.5);
  ws.onmessage({ data: JSON.stringify({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'AAPL', 1: 190.4 }] }] }) }); assert.equal(ticks.length, 1, 'update without last price is ignored');
  off(); hub.stop();
});
console.log(n + ' tests passed');
