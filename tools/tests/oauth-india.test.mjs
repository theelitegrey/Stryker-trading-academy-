// Upstox + Fyers sign-in tests: allow-list refusals (one per refused path), token functions, expiry -> Reconnect, symbols, protobuf decode. No real keys, no network.
// Run: node tools/tests/oauth-india.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto as C } from 'node:crypto';
import { handle as upH } from '../../functions/connect/upstox/token.js';
import { handle as fyH } from '../../functions/connect/fyers/token.js';
import * as oa from '../../assets/byo-oauth.js?v=942';
import { SOURCES, ALLOW, guardUrl, guardWs, guardWsMessage, activate, statusOf, forget } from '../../assets/byo-core.js?v=942';
import * as ind from '../../assets/byo-india.js?v=942';
import { alpaca } from '../../assets/byo-core.js?v=942';
import { symbolOf as tastySym } from '../../assets/byo-tastytrade.js?v=942';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const SECRET = 'SECRETFAKE-abc123', APPID = 'ABCD1234-100';
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const kp = await C.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await C.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const now = Math.floor(Date.now() / 1000);
const h0 = b({ alg: 'RS256', kid: 'k1' }), pl = b({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'u1', iat: now, exp: now + 600 });
const good = h0 + '.' + pl + '.' + Buffer.from(await C.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(h0 + '.' + pl))).toString('base64url');
const verifyFetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=300' } });

// ---------- token functions ----------
const SRC = {
  upstox: { h: upH, up: 'https://api.upstox.com/v2/login/authorization/token', env: { UPSTOX_CLIENT_ID: APPID, UPSTOX_CLIENT_SECRET: SECRET }, form: true },
  fyers: { h: fyH, up: 'https://api-t1.fyers.in/api/v3/validate-authcode', env: { FYERS_CLIENT_ID: APPID, FYERS_CLIENT_SECRET: SECRET }, form: false }
};
for (const [id, S] of Object.entries(SRC)) {
  const treq = (o = {}) => new Request(`https://tradezoro.com/connect/${id}/token` + (o.q || ''), { method: o.method || 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + good, ...(o.h || {}) }, body: (o.method || 'POST') === 'POST' ? (o.body ?? JSON.stringify({ grant: 'code', code: 'CODEFAKE12345' })) : undefined });
  let upstream = null;
  const reply = { access_token: 'ACCESSFAKE1', refresh_token: 'REFRESHFAKE1', extended_token: 'EXTLEAK', email: 'a@b.c', user_id: 'UCC1', user_name: 'Name', id_token: 'LEAK', s: 'ok', code: 200, expires_in: 100 };
  const fetchImpl = async (u, o) => { upstream = { u, o }; return new Response(JSON.stringify(reply), { status: 200 }); };
  const call = (r, env = S.env, deps = {}) => S.h(r, env, { verifyFetch, fetchImpl, ...deps });
  await t(id + ' token fn: probe, method, origin, content-type, auth, body; nothing upstream on a bad call', async () => {
    assert.deepEqual(await (await call(treq({ method: 'GET', q: '?probe=1' }))).json(), { configured: true, client_id: APPID });
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
  await t(id + ' token fn: POST to the broker only, fixed redirect, trimmed reply (no profile, no extended token, no refresh), nothing logged', async () => {
    const logs = []; const o = [console.log, console.error, console.warn]; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
    const r = await call(treq()); const j = await r.json(); [console.log, console.error, console.warn] = o;
    assert.equal(r.status, 200); assert.equal(j.access_token, 'ACCESSFAKE1');
    assert.ok(Object.keys(j).every((k) => ['access_token', 'expires_in', 'token_type', 'scope'].includes(k)), JSON.stringify(Object.keys(j)));
    assert.equal(upstream.u, S.up); assert.equal(upstream.o.method, 'POST'); assert.equal(upstream.o.redirect, 'error');
    const body = S.form ? Object.fromEntries(new URLSearchParams(upstream.o.body)) : JSON.parse(upstream.o.body);
    assert.ok(!logs.join('').match(/ACCESSFAKE|REFRESHFAKE|SECRETFAKE/));
    if (S.form) { assert.equal(body.grant_type, 'authorization_code'); assert.equal(body.code, 'CODEFAKE12345'); assert.equal(body.client_secret, SECRET); assert.equal(body.client_id, APPID); assert.equal(body.redirect_uri, 'https://tradezoro.com/connect/upstox/callback'); }
    else {
      assert.deepEqual(Object.keys(body).sort(), ['appIdHash', 'code', 'grant_type']);
      assert.equal(body.appIdHash, createHash('sha256').update(APPID + ':' + SECRET).digest('hex'), 'appIdHash = sha256(app_id:secret), built on the server');
      assert.equal(body.grant_type, 'authorization_code'); assert.equal(body.code, 'CODEFAKE12345');
      assert.ok(!upstream.o.body.includes(SECRET), 'the secret itself is never sent, only its hash');
    }
    await call(treq({ body: JSON.stringify({ grant: 'code', code: 'CODEFAKE12345', redirect_uri: 'https://evil.example.com' }) }));
    assert.ok(!upstream.o.body.includes('evil.example.com'), 'client cannot choose the redirect');
    const bad = await call(treq(), S.env, { fetchImpl: async () => new Response(JSON.stringify({ error: 'x', message: SECRET }), { status: 400 }) });
    assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('SECRETFAKE'));
    assert.equal((await call(treq(), S.env, { fetchImpl: async () => { throw new Error('boom ' + SECRET); } })).status, 502);
    assert.equal((await call(treq(), S.env, { fetchImpl: async () => new Response(JSON.stringify({ s: 'error', code: -1, message: 'bad' }), { status: 200 }) })).status, 400, 'a 200 without a token is a failure');
  });
  await t(id + ' token fn: no refresh grant (member reconnects daily)', async () => {
    upstream = null;
    assert.equal((await call(treq({ body: JSON.stringify({ grant: 'refresh', refresh_token: 'REFRESHFAKE1' }) }))).status, 400); assert.equal(upstream, null);
  });
}

// ---------- allow-list: every refused path has its own assertion ----------
const T = (src, u, m) => assert.throws(() => guardUrl(src, u, m), /byo-guard/, src + ' ' + (m || 'GET') + ' ' + u);
const OK = (src, u) => assert.equal(typeof guardUrl(src, u), 'string', u);
const KEY = 'NSE_EQ%7CINE002A01018';
await t('upstox allow-list: price history, instrument search and the feed address pass', () => {
  OK('upstox', `https://api.upstox.com/v3/historical-candle/${KEY}/days/1/2026-11-03/2026-10-01`);
  OK('upstox', 'https://api.upstox.com/v3/historical-candle/NSE_INDEX%7CNifty%2050/minutes/5/2026-11-03/2026-10-20');
  OK('upstox', 'https://api.upstox.com/v3/historical-candle/intraday/MCX_FO%7C579304/minutes/1');
  OK('upstox', 'https://api.upstox.com/v2/instruments/search?query=RELIANCE&exchanges=NSE&segments=EQ');
  OK('upstox', 'https://api.upstox.com/v3/feed/market-data-feed/authorize');
  OK('upstox-master', 'https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz');
});
const UP_REFUSED = {
  'place order': '/v2/order/place', 'place order v3': '/v3/order/place', 'modify order': '/v2/order/modify', 'cancel order': '/v2/order/cancel', 'multi order': '/v2/order/multi/place', 'order book': '/v2/order/retrieve-all',
  'order details': '/v2/order/details', 'order history': '/v2/order/history', 'trades': '/v2/order/trades/get-trades-for-day', 'GTT order': '/v3/order/gtt/place', 'exit all positions': '/v2/order/positions/exit',
  'positions': '/v2/portfolio/short-term-positions', 'holdings': '/v2/portfolio/long-term-holdings', 'convert position': '/v2/portfolio/convert-position', 'mutual funds': '/v2/mf/orders', 'trade P&L': '/v2/trade/profit-loss/data',
  'funds': '/v2/user/get-funds-and-margin', 'profile': '/v2/user/profile', 'static IP': '/v2/user/ip', 'kill switch': '/v2/user/kill-switch', 'charges': '/v2/charges/brokerage', 'margin': '/v2/charges/margin',
  'token swap (our own function only)': '/v2/login/authorization/token', 'login dialog': '/v2/login/authorization/dialog', 'logout': '/v2/logout', 'portfolio stream feed address': '/v2/feed/portfolio-stream-feed/authorize',
  'v2 feed authorize': '/v2/feed/market-data-feed/authorize', 'market quote (not used)': '/v2/market-quote/quotes', 'option chain (not used)': '/v2/option/chain', 'instrument file path on the api host': '/v2/instruments/complete.json.gz'
};
for (const [name, p] of Object.entries(UP_REFUSED)) await t('upstox refuses ' + name + ' ' + p, () => { T('upstox', 'https://api.upstox.com' + p); T('upstox', 'https://api.upstox.com' + p, 'POST'); });
await t('upstox refuses sneaks: wrong host, http, port, userinfo, encoded dots, double slash, odd instrument keys, POST on data paths, order word hidden in the key', () => {
  T('upstox', 'https://evil.example.com/v3/historical-candle/' + KEY + '/days/1/2026-11-03/2026-10-01');
  T('upstox', 'http://api.upstox.com/v3/feed/market-data-feed/authorize'); T('upstox', 'https://api.upstox.com:8443/v3/feed/market-data-feed/authorize');
  T('upstox', 'https://u:p@api.upstox.com/v3/feed/market-data-feed/authorize');
  T('upstox', 'https://api.upstox.com/v3/historical-candle/%2e%2e/v2/order/place');
  T('upstox', 'https://api.upstox.com/v3/historical-candle/' + KEY + '/days/1/2026-11-03/2026-10-01/../../../../v2/order/place');
  T('upstox', 'https://api.upstox.com//v3/feed/market-data-feed/authorize');
  T('upstox', 'https://api.upstox.com/v3/historical-candle/NSE_EQ%7C..%2F..%2Fv2%2Forder/days/1/2026-11-03/2026-10-01');
  T('upstox', 'https://api.upstox.com/v3/historical-candle/XYZ_EQ%7CABC/days/1/2026-11-03/2026-10-01');
  T('upstox', 'https://api.upstox.com/v3/historical-candle/NSE_EQ%7CINE002A01018/seconds/1/2026-11-03/2026-10-01');
  T('upstox', 'https://api.upstox.com/v3/feed/market-data-feed/authorize', 'POST'); T('upstox', 'https://api.upstox.com/v2/instruments/search', 'DELETE');
  T('upstox-master', 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz');   // 2 MB: not fetched on a phone
  T('nope', 'https://api.upstox.com/v3/feed/market-data-feed/authorize');
});
await t('upstox socket: only the feeder address, only "sub"/"unsub" of last-price (ltpc) with sane keys', () => {
  const U = 'wss://wsfeeder-api.upstox.com/market-data-feeder/v3/upstox-developer-api/feeds?requestId=2f646f57-a097-4402-bb36-c44085c5f8e7&code=9355b100-25cf-4fa7-b038-06d27ddb4823';
  assert.equal(guardWs('upstox', U), U);
  for (const bad of ['wss://evil.example.com/market-data-feeder/v3/upstox-developer-api/feeds?requestId=2f646f57-a097&code=9355b100-25cf', 'ws://wsfeeder-api.upstox.com/market-data-feeder/v3/upstox-developer-api/feeds?requestId=2f646f57-a097&code=9355b100-25cf',
    'wss://api.upstox.com.evil.com/market-data-feeder/v3/upstox-developer-api/feeds?requestId=2f646f57-a097&code=9355b100-25cf', 'wss://api.upstox.com/portfolio-stream-feeder/v2/feeds?requestId=2f646f57-a097&code=9355b100-25cf']) assert.throws(() => guardWs('upstox', bad), /byo-guard/, bad);
  const sub = (o) => JSON.stringify({ guid: 'g', ...o });
  assert.ok(guardWsMessage('upstox', sub({ method: 'sub', data: { mode: 'ltpc', instrumentKeys: ['NSE_INDEX|Nifty 50', 'NSE_FO|45450'] } })));
  assert.ok(guardWsMessage('upstox', sub({ method: 'unsub', data: { mode: 'ltpc', instrumentKeys: ['NSE_EQ|INE002A01018'] } })));
  for (const bad of [{ method: 'change_mode', data: { mode: 'full', instrumentKeys: ['NSE_EQ|INE002A01018'] } }, { method: 'sub', data: { mode: 'full', instrumentKeys: ['NSE_EQ|INE002A01018'] } },
    { method: 'sub', data: { mode: 'option_greeks', instrumentKeys: ['NSE_EQ|INE002A01018'] } }, { method: 'sub', data: { mode: 'ltpc', instrumentKeys: [] } }, { method: 'sub', data: { mode: 'ltpc', instrumentKeys: ['../order'] } },
    { method: 'sub', data: { mode: 'ltpc', instrumentKeys: new Array(101).fill('NSE_EQ|X') } }, { method: 'place_order', data: {} }, { action: 'auth' }, {}])
    assert.throws(() => guardWsMessage('upstox', sub(bad)), /byo-guard/, JSON.stringify(bad).slice(0, 80));
  assert.throws(() => guardWsMessage('upstox', 'not json'), /byo-guard/);
});
await t('fyers allow-list: price history and quotes pass', () => {
  OK('fyers', 'https://api-t1.fyers.in/data/history?symbol=NSE%3ASBIN-EQ&resolution=D&date_format=1&range_from=2026-01-01&range_to=2026-10-01');
  OK('fyers', 'https://api-t1.fyers.in/data/quotes?symbols=NSE%3ASBIN-EQ');
});
const FY_REFUSED = {
  'profile': '/api/v3/profile', 'funds': '/api/v3/funds', 'holdings': '/api/v3/holdings', 'positions': '/api/v3/positions', 'orders (book)': '/api/v3/orders', 'place order': '/api/v3/orders/sync', 'place order (data host)': '/data/orders',
  'multi order': '/api/v3/multi-order/sync', 'multileg': '/api/v3/multileg/orders/sync', 'GTT': '/api/v3/gtt/orders/sync', 'smart orders': '/api/v3/smartorder/create', 'trades': '/api/v3/tradebook', 'exit positions': '/api/v3/positions/exit',
  'convert position': '/api/v3/positions/convert', 'margin calculator': '/api/v3/span_margin', 'logout': '/api/v3/logout', 'token swap (our own function only)': '/api/v3/validate-authcode', 'auth code': '/api/v3/generate-authcode',
  'refresh token': '/api/v3/validate-refresh-token', 'market status': '/data/market-status', 'market depth (not used)': '/data/depth', 'option chain (not used)': '/data/options-chain-v3', 'futures chain (not used)': '/data/futures-chain', 'price alerts': '/api/v3/price-alerts', 'edis': '/api/v3/tpin'
};
for (const [name, p] of Object.entries(FY_REFUSED)) await t('fyers refuses ' + name + ' ' + p, () => { T('fyers', 'https://api-t1.fyers.in' + p); T('fyers', 'https://api-t1.fyers.in' + p, 'POST'); });
await t('fyers refuses sneaks: other hosts, http, POST on data paths, encoded path, no websocket at all', () => {
  T('fyers', 'https://api.fyers.in/data/history'); T('fyers', 'http://api-t1.fyers.in/data/history'); T('fyers', 'https://api-t1.fyers.in/data/history', 'POST'); T('fyers', 'https://api-t1.fyers.in/data/%68istory');
  T('fyers', 'https://api-t1.fyers.in/data/history/../../api/v3/orders'); T('fyers', 'https://api-t1.fyers.in//api/v3/orders');
  T('fyers', 'https://public.fyers.in/sym_details/NSE_FO.csv');   // 15 MB: never fetched
  assert.throws(() => guardWs('fyers', 'wss://socket.fyers.in/hsm/v1-5/prod'), /byo-guard/); assert.throws(() => guardWs('fyers', 'wss://socket.fyers.in/trade/v3'), /byo-guard/);
  assert.throws(() => guardWsMessage('fyers', '{"action":"subscribe"}'), /byo-guard/);
});

// ---------- sign-in plumbing ----------
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
await t('sign-in URLs: official authorize URLs, fixed redirect, single-use state; no scope parameter (none exists at these brokers)', () => {
  const st = mem();
  let u = new URL(oa.oauthAuthUrl('upstox', 'UP-ID-1', 'u1', st));
  assert.equal(u.origin + u.pathname, 'https://api.upstox.com/v2/login/authorization/dialog'); assert.equal(u.searchParams.get('response_type'), 'code'); assert.equal(u.searchParams.get('client_id'), 'UP-ID-1');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/upstox/callback'); assert.equal(u.searchParams.has('scope'), false); const s = u.searchParams.get('state'); assert.ok(s.length >= 20);
  assert.equal(oa.takeOauthState('fyers', s, 'u1', st), null, 'wrong source'); 
  oa.oauthAuthUrl('upstox', 'C', 'u1', st); const s2 = JSON.parse(st.getItem('tz-oauth-state')).state; assert.ok(oa.takeOauthState('upstox', s2, 'u1', st)); assert.equal(oa.takeOauthState('upstox', s2, 'u1', st), null, 'single use');
  u = new URL(oa.oauthAuthUrl('fyers', 'FY-ID-1', 'u1', st));
  assert.equal(u.origin + u.pathname, 'https://api-t1.fyers.in/api/v3/generate-authcode'); assert.equal(u.searchParams.get('response_type'), 'code'); assert.equal(u.searchParams.get('client_id'), 'FY-ID-1');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/fyers/callback'); assert.equal(u.searchParams.has('scope'), false);
  assert.throws(() => oa.oauthAuthUrl('upstox', 'C', null, st), /Sign in/);
});
await t('catalogue: Upstox + Fyers stay "Coming soon" until the probe says configured, then become sign-in only (no key form)', async () => {
  const up = SOURCES.find((s) => s.id === 'upstox'), fy = SOURCES.find((s) => s.id === 'fyers');
  assert.ok(up.state === 'soon' && fy.state === 'soon' && !up.fields && !fy.fields);
  assert.equal(await oa.enableOauthIfConfigured({ fetch: async () => new Response('{"configured":false}', { status: 503 }) }), false); assert.equal(up.state, 'soon');
  assert.equal(await oa.enableOauthIfConfigured({ fetch: async (u) => String(u).includes('/upstox/') ? new Response('{"configured":true,"client_id":"UP_ID_9"}') : new Response('{}', { status: 503 }) }), true);
  assert.ok(up.state === 'ready' && up.signin && up.oauth && up.clientId === 'UP_ID_9' && !up.keyAlt && up.cta === 'Sign in with Upstox'); assert.equal(fy.state, 'soon');
  assert.match(oa.OA.upstox.note, /every night/); assert.match(oa.OA.fyers.note, /every morning/);
  up.state = 'soon'; delete up.signin; delete up.oauth;
});
await t('expiry: daily end = 3:30 AM IST (Upstox) / 6:30 AM IST (Fyers); creds carry it; no refresh path', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(oa.nextDaily([3, 30], at('2026-11-03T12:00:00+05:30')), at('2026-11-04T03:30:00+05:30'));
  assert.equal(oa.nextDaily([3, 30], at('2026-11-04T01:00:00+05:30')), at('2026-11-04T03:30:00+05:30'));
  assert.equal(oa.nextDaily([3, 30], at('2026-11-04T03:30:00+05:30')), at('2026-11-05T03:30:00+05:30'));
  assert.equal(oa.nextDaily([6, 30], at('2026-11-03T06:29:59+05:30')), at('2026-11-03T06:30:00+05:30'));
  assert.equal(oa.nextDaily([6, 30], at('2026-12-31T23:00:00+05:30')), at('2027-01-01T06:30:00+05:30'));
  const c = oa.oauthCreds('upstox', { access_token: 'A'.repeat(20), refresh_token: 'IGNORED', extended_token: 'X' }, null, at('2026-11-03T12:00:00+05:30'));
  assert.equal(c.exp, at('2026-11-04T03:30:00+05:30')); assert.equal(c.daily, true); assert.equal(c.oauth, true); assert.equal(c.extended_token, undefined);
  assert.equal(oa.OA.upstox.refresh, false); assert.equal(oa.OA.fyers.refresh, false);
});
const mkRows = (rows) => async (u) => { rows.push(String(u)); return new Response('{}', { status: 200 }); };
await t('expiry: an ended sign-in makes NO broker call and says Reconnect; a 401 / Fyers -8 -15 -16 -17 says Reconnect too', async () => {
  const calls = []; const d = { fetch: mkRows(calls), now: () => 2000 };
  await assert.rejects(ind.upstox.getBars({ access: 'T', exp: 1000 }, 'NSE:RELIANCE-EQ', 'D', {}, d), (e) => e.reconnect === true && /Reconnect Upstox/.test(e.message));
  await assert.rejects(ind.fyers.getBars({ access: 'T', appId: 'A', exp: 1000 }, 'NSE:RELIANCE-EQ', 'D', {}, d), (e) => e.reconnect === true && /Reconnect Fyers/.test(e.message));
  await assert.rejects(ind.upstox.check({ access: 'T', exp: 1000 }, d), (e) => e.reconnect); assert.equal(calls.length, 0, 'no request after the end');
  await assert.rejects(ind.upstox.check({ access: 'T', exp: 9e9 }, { now: () => 2000, fetch: async () => new Response('{}', { status: 401 }) }), (e) => e.reconnect);
  for (const code of [-8, -15, -16, -17]) await assert.rejects(ind.fyers.check({ access: 'T', appId: 'A', exp: 9e9 }, { now: () => 2000, fetch: async () => new Response(JSON.stringify({ s: 'error', code, message: 'x' }), { status: 200 }) }), (e) => e.reconnect, 'code ' + code);
  await assert.rejects(ind.fyers.check({ access: 'T', appId: 'A', exp: 9e9 }, { now: () => 2000, fetch: async () => new Response('{}', { status: 429 }) }), (e) => e.status === 429 && !e.reconnect);
});
await t('expiry: a live row flips to "Reconnect Upstox" when the time passes (activate timer)', async () => {
  const d = { fetch: async () => new Response('{}', { status: 200 }), WS: class { close() {} } };
  activate('upstox', { oauth: true, daily: true, access: 'T', exp: Date.now() - 1000 }, d);
  assert.deepEqual(statusOf('upstox'), { status: 'error', msg: 'Reconnect Upstox' });
  await forget('upstox').catch(() => {});
});

// ---------- symbols ----------
await t('symbol mapping: Fyers-style tickers, index aliases, front month, MCX; US tickers are not claimed by the India brokers and vice versa', () => {
  const S = ind.symbolOf;
  assert.equal(S('byo:NSE:RELIANCE-EQ'), 'NSE:RELIANCE-EQ'); assert.equal(S('NSE:RELIANCE'), 'NSE:RELIANCE-EQ'); assert.equal(S('NSE:NIFTY50-INDEX'), 'NSE:NIFTY50-INDEX');
  assert.equal(S('NSE:NIFTY-INDEX'), 'NSE:NIFTY50-INDEX'); assert.equal(S('NSE:BANKNIFTY'), 'NSE:NIFTYBANK-INDEX'); assert.equal(S('NSE:NIFTYBANK-INDEX'), 'NSE:NIFTYBANK-INDEX');
  assert.equal(S('NSE:NIFTY1!'), 'NSE:NIFTY1!'); assert.equal(S('NSE:BANKNIFTY1!'), 'NSE:BANKNIFTY1!'); assert.equal(S('MCX:GOLD1!'), 'MCX:GOLD1!'); assert.equal(S('MCX:CRUDEOIL26NOVFUT'), 'MCX:CRUDEOIL26NOVFUT'); assert.equal(S('NSE:NIFTY26NOVFUT'), 'NSE:NIFTY26NOVFUT');
  assert.equal(S('NSE:M&M-EQ'), 'NSE:M&M-EQ'); assert.equal(S('NSE:BAJAJ-AUTO-EQ'), 'NSE:BAJAJ-AUTO-EQ');
  for (const bad of ['AAPL', 'byo:AAPL', 'ES1!', 'MCX:GOLD', 'MCX:GOLD-EQ', 'NSE:', 'NSE:../order', 'NSE:A B', 'BSE:RELIANCE', '', null, 'NSE:' + 'A'.repeat(40) + '-EQ']) assert.equal(S(bad), null, String(bad));
  assert.equal(alpaca.symbolOf('NSE:RELIANCE-EQ'), null); assert.equal(alpaca.symbolOf('byo:AAPL'), 'AAPL'); assert.equal(tastySym('NSE:NIFTY1!'), null); assert.equal(tastySym('byo:ES1!'), '/ES');
  assert.deepEqual(ind.monthSyms('NSE', 'NIFTY', Date.parse('2026-11-03T12:00:00Z')).slice(0, 3), ['NSE:NIFTY26NOVFUT', 'NSE:NIFTY26DECFUT', 'NSE:NIFTY27JANFUT']);
});
const gz = async (obj) => new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
await t('upstox: instrument keys (index fixed, equity by search, front month by earliest unexpired expiry, MCX from the small file) and candles', async () => {
  const NOW = Date.parse('2026-11-03T12:00:00+05:30'), calls = [];
  const fut = (key, exp) => ({ instrument_type: 'FUT', underlying_symbol: 'NIFTY', instrument_key: key, expiry: Date.parse(exp) });
  const d = { now: () => NOW, fetch: async (u) => {
    u = String(u); calls.push(u);
    if (u.includes('/instruments/search') && u.includes('segments=EQ')) return new Response(JSON.stringify({ data: [{ segment: 'BSE_EQ', trading_symbol: 'RELIANCE', instrument_type: 'A', instrument_key: 'BSE_EQ|500325' }, { segment: 'NSE_EQ', trading_symbol: 'RELIANCE', instrument_type: 'EQ', instrument_key: 'NSE_EQ|INE002A01018' }] }));
    if (u.includes('/instruments/search')) return new Response(JSON.stringify({ data: [fut('NSE_FO|DEC', '2026-12-29T15:30:00+05:30'), fut('NSE_FO|OLD', '2026-10-27T15:30:00+05:30'), fut('NSE_FO|NOV', '2026-11-24T15:30:00+05:30')] }));
    if (u.includes('MCX.json.gz')) return new Response(await gz([{ instrument_type: 'FUT', underlying_symbol: 'GOLD', instrument_key: 'MCX_FO|G2', expiry: Date.parse('2027-02-05T23:00:00+05:30') }, { instrument_type: 'FUT', underlying_symbol: 'GOLD', instrument_key: 'MCX_FO|G1', expiry: Date.parse('2026-12-04T23:00:00+05:30') }, { instrument_type: 'OPT', underlying_symbol: 'GOLD', instrument_key: 'MCX_FO|O', expiry: Date.parse('2026-11-04T23:00:00+05:30') }]));
    if (u.includes('/historical-candle/intraday/')) return new Response(JSON.stringify({ status: 'success', data: { candles: [['2026-11-03T09:16:00+05:30', 11, 12, 10, 11.5, 100, 0], ['2026-11-03T09:15:00+05:30', 10, 11, 9, 10.5, 90, 0]] } }));
    if (u.includes('/historical-candle/')) return new Response(JSON.stringify({ status: 'success', data: { candles: [['2026-11-02T09:15:00+05:30', 8, 9, 7, 8.5, 80, 0], ['2026-11-01T09:15:00+05:30', 7, 8, 6, 7.5, 70, 0]] } }));
    return new Response('{}', { status: 404 }); } };
  const c = { access: 'TOK', exp: NOW + 36e5 };
  assert.equal(await ind.upstoxKey(c, 'NSE:NIFTY50-INDEX', d), 'NSE_INDEX|Nifty 50'); assert.equal(await ind.upstoxKey(c, 'NSE:NIFTYBANK-INDEX', d), 'NSE_INDEX|Nifty Bank');
  assert.equal(await ind.upstoxKey(c, 'NSE:RELIANCE-EQ', d), 'NSE_EQ|INE002A01018');
  assert.equal(await ind.upstoxKey(c, 'NSE:NIFTY1!', d), 'NSE_FO|NOV'); assert.equal(await ind.upstoxKey(c, 'NSE:NIFTY26DECFUT', d), 'NSE_FO|DEC'); assert.equal(await ind.upstoxKey(c, 'MCX:GOLD1!', d), 'MCX_FO|G1');
  const bars = await ind.upstox.getBars(c, 'NSE:RELIANCE-EQ', '1', {}, d);
  assert.deepEqual(bars.map((x) => x.close), [7.5, 8.5, 10.5, 11.5], 'oldest first, history + today'); assert.equal(bars[0].time, Date.parse('2026-11-01T09:15:00+05:30'));
  assert.ok(calls.every((u) => { try { guardUrl(u.includes('assets.upstox') ? 'upstox-master' : 'upstox', u); return true; } catch (e) { return false; } }), 'every call the adapter made passes its own allow-list');
  assert.ok(!calls.some((u) => /order|portfolio|funds|holding|position|profile/i.test(new URL(u).pathname)));
  assert.equal((await ind.upstox.getBars(c, 'AAPL', '1', {}, d)).length, 0); assert.equal((await ind.upstox.getBars(c, 'NSE:RELIANCE-EQ', '7', {}, d)).length, 0);
});
await t('fyers: candles (epoch seconds, App-ID:token header), front month via quotes, only allowed paths', async () => {
  const NOW = Date.parse('2026-11-03T12:00:00+05:30'), calls = [];
  const d = { now: () => NOW, fetch: async (u, o) => {
    u = String(u); calls.push({ u, h: o.headers.Authorization });
    if (u.includes('/data/history')) return new Response(JSON.stringify({ s: 'ok', candles: [[1793600000, 1, 2, 0.5, 1.5, 10], [1793600060, 1.5, 2, 1, 1.8, 11]] }));
    if (u.includes('/data/quotes')) return new Response(JSON.stringify({ s: 'ok', code: 200, d: [{ n: 'NSE:NIFTY26NOVFUT', s: 'ok', v: { lp: 24100.5 } }, { n: 'NSE:NIFTY26DECFUT', s: 'ok', v: { lp: 24200 } }] }));
    return new Response('{}', { status: 404 }); } };
  const c = { access: 'TOK', appId: 'APP-100', exp: NOW + 36e5 };
  assert.equal(await ind.fyersSym(c, 'NSE:NIFTY1!', d), 'NSE:NIFTY26NOVFUT');
  const bars = await ind.fyers.getBars(c, 'NSE:NIFTY1!', '1', { limit: 2 }, d);
  assert.deepEqual(bars.map((x) => [x.time, x.close]), [[1793600000000, 1.5], [1793600060000, 1.8]]);
  assert.ok(calls.every((x) => x.h === 'APP-100:TOK')); assert.ok(calls.every((x) => { try { guardUrl('fyers', x.u); return true; } catch (e) { return false; } }));
  // hub: polls quotes every POLL_MS, ticks the chart; stops on Reconnect
  const ticks = [], st = [];
  const hub = ind.fyers.hub(c, (s, m) => st.push(s + ':' + m), { ...d, WS: null });
  const stop = ind.fyers.subscribe(hub, 'NSE:NIFTY26NOVFUT', '1', null, (bar) => ticks.push(bar.close));
  await new Promise((r) => setTimeout(r, 900)); stop(); hub.stop();
  assert.ok(ticks.includes(24100.5), JSON.stringify(ticks)); assert.ok(ind.POLL_MS >= 10000, 'slow enough for the Standard plan (50 data calls a minute)');
});

// ---------- protobuf: bytes made by Google protobuf from the official .proto ----------
await t('Market Data Feed V3 protobuf decode (official schema fixtures): ltpc, full feed (stock + index), initial feed with market info, junk', () => {
  const hex = (h) => Uint8Array.from(Buffer.from(h, 'hex')).buffer;
  const a = ind.decodeFeed(hex('080112270a0d4d43585f464f7c3537393330341216121412120a10090000000080ccf24010e8a0c4dcd43212330a124e53455f494e4445587c4e69667479203530121d0a1b090000000010edd74010d39ec4dcd432184b210000000020d4d740122f0a0c4e53455f464f7c3435343530121f121d0a1b0a10099a99999999696b40108099c4dcd43229000000000000164018d786c5dcd432')); const by = Object.fromEntries(a.ticks.map((x) => [x.key, x]));
  assert.equal(a.type, 1); assert.equal(by['NSE_INDEX|Nifty 50'].ltp, 24500.25); assert.equal(by['NSE_INDEX|Nifty 50'].ltt, 1740729552723); assert.equal(by['NSE_INDEX|Nifty 50'].ltq, 75);
  assert.equal(by['NSE_FO|45450'].ltp, 219.3); assert.equal(by['MCX_FO|579304'].ltp, 77000); assert.equal(a.ticks.length, 3);
  const b2 = ind.decodeFeed(hex('12220a134e53455f45517c494e45303032413031303138120b0a090900000000008a9340220c0a0a0a064e53455f45511002')); assert.equal(b2.type, 0); assert.deepEqual(b2.ticks.map((x) => [x.key, x.ltp]), [['NSE_EQ|INE002A01018', 1250.5]]);
  assert.deepEqual(ind.decodeFeed(new Uint8Array(0).buffer).ticks, []);
  assert.throws(() => ind.decodeFeed(Uint8Array.from([0x12, 0x7f, 1, 2]).buffer));
  assert.ok(readFileSync(new URL('../../assets/vendor/upstox/MarketDataFeed.proto', import.meta.url), 'utf8').includes('message FeedResponse'));
});
await t('upstox hub: asks for the feed address, opens only that wss URL, subscribes ltpc binary, ticks the chart', async () => {
  const sent = []; let opened = '';
  class WS { constructor(u) { opened = u; WS.i = this; setTimeout(() => this.onopen(), 0); } send(x) { sent.push(x); setTimeout(() => this.onmessage({ data: Uint8Array.from(Buffer.from('080112270a0d4d43585f464f7c3537393330341216121412120a10090000000080ccf24010e8a0c4dcd43212330a124e53455f494e4445587c4e69667479203530121d0a1b090000000010edd74010d39ec4dcd432184b210000000020d4d740122f0a0c4e53455f464f7c3435343530121f121d0a1b0a10099a99999999696b40108099c4dcd43229000000000000164018d786c5dcd432', 'hex')).buffer }), 0); } close() {} }
  const NOW = Date.now(), URL_ = 'wss://wsfeeder-api.upstox.com/market-data-feeder/v3/upstox-developer-api/feeds?requestId=2f646f57-a097-4402-bb36-c44085c5f8e7&code=9355b100-25cf-4fa7-b038-06d27ddb4823';
  const fetched = [];
  const d = { WS, now: () => NOW, fetch: async (u) => { fetched.push(String(u)); return new Response(JSON.stringify({ status: 'success', data: { authorized_redirect_uri: URL_ } })); } };
  const hub = ind.upstox.hub({ access: 'T', exp: NOW + 36e5 }, () => {}, d); const got = [];
  const stop = ind.upstox.subscribe(hub, 'NSE:NIFTY50-INDEX', '1', null, (bar) => got.push(bar.close));
  await new Promise((r) => setTimeout(r, 900)); stop(); hub.stop();
  assert.equal(opened, URL_); assert.deepEqual(fetched, ['https://api.upstox.com/v3/feed/market-data-feed/authorize']);
  assert.equal(sent.length, 1); const msg = JSON.parse(new TextDecoder().decode(sent[0])); assert.equal(msg.method, 'sub'); assert.equal(msg.data.mode, 'ltpc'); assert.deepEqual(msg.data.instrumentKeys, ['NSE_INDEX|Nifty 50']);
  assert.ok(got.includes(24500.25), JSON.stringify(got));
});

// ---------- no secrets / no account words in the browser code ----------
await t('browser code never holds a secret or hash and never mentions an order / account call', () => {
  const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  for (const p of ['assets/byo-india.js', 'assets/byo-oauth.js', 'assets/oauth-callback.js', 'assets/byo-ui.js']) {
    const s = read(p);
    assert.ok(!/appIdHash|client_secret|sha-?256|crypto\.subtle\.digest/i.test(s.replace(/\/\/.*$/gm, '')), p + ' must not hold the hash / secret');
  }
  const s = read('assets/byo-india.js').replace(/\/\/.*$/gm, '');
  assert.ok(!/\/order|portfolio|holdings|positions|\/funds|\/profile|user\/|\/charges|validate-authcode|login\/authorization\/token|place_order/i.test(s), 'byo-india.js names no order / account path');
  assert.ok(/appIdHash/.test(read('functions/connect/fyers/token.js')) && /crypto\.subtle\.digest/.test(read('functions/connect/fyers/token.js')), 'the hash is built server side');
  assert.ok(!/console\.(log|error|warn)/.test(read('functions/connect/fyers/token.js') + read('functions/connect/upstox/token.js') + read('functions/connect/_token.js')), 'token functions log nothing');
});
console.log('ALL PASS', n); process.exit(0);
