// cTrader sign-in tests: allow-list, token function, relay with a fake upstream, adapter (candles from spots), OAuth URL.
// No real keys, no network. Run: node tools/tests/ctrader.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { webcrypto as C } from 'node:crypto';
import { checkClientFrame, createRelay, CLIENT_ALLOW } from '../../functions/connect/ctrader/_relay.js';
import { handle as tokenHandle } from '../../functions/connect/ctrader/token.js';
import { handle as wsHandle } from '../../functions/connect/ctrader/ws.js';
import * as ct from '../../assets/byo-ctrader.js?v=917';
import { SOURCES } from '../../assets/byo-core.js?v=917';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const f = (o) => JSON.stringify(o);
const A = { ctidTraderAccountId: 77 };

// ---- allow-list ----
await t('allow-list: every trading / account payloadType is refused (one assert per type)', () => {
  const refused = { 2100: 'ApplicationAuth', 2104: 'Version', 2106: 'NewOrder', 2108: 'CancelOrder', 2109: 'AmendOrder', 2110: 'AmendPositionSLTP', 2111: 'ClosePosition', 2112: 'AssetList', 2118: 'SymbolsForConversion', 2121: 'Trader', 2124: 'Reconcile', 2133: 'DealList', 2139: 'ExpectedMargin', 2143: 'CashFlowHistoryList', 2151: 'GetCtidProfileByToken', 2153: 'AssetClassList', 2160: 'SymbolCategory', 2162: 'AccountLogout', 2167: 'MarginCallList', 2169: 'MarginCallUpdate', 2173: 'RefreshToken', 2175: 'OrderList', 2177: 'GetDynamicLeverage', 2179: 'DealListByPositionId', 2181: 'OrderDetails', 2183: 'OrderListByPositionId', 2185: 'DealOffsetList', 2187: 'GetPositionUnrealizedPnL', 2142: 'ErrorRes', 2103: 'AccountAuthRes', 2131: 'SpotEvent', 1: 'x', 0: 'x', 99999: 'x' };
  for (const [ty, name] of Object.entries(refused)) assert.equal(checkClientFrame(f({ payloadType: +ty, payload: { ...A, symbolId: 1 } })).ok, false, name);
  assert.deepEqual(Object.keys(CLIENT_ALLOW).map(Number).sort((a, b) => a - b), [51, 2102, 2114, 2116, 2127, 2129, 2135, 2136, 2137, 2145, 2149, 2156, 2158]);
});
await t('allow-list: good frames pass and are REBUILT; bad shapes refused', () => {
  const ok = checkClientFrame(f({ clientMsgId: 'a1', payloadType: 2137, payload: { ...A, symbolId: 5, period: 1, fromTimestamp: 1, toTimestamp: 2, count: 10 } }));
  assert.ok(ok.ok); assert.equal(JSON.parse(ok.frame).payloadType, 2137);
  assert.ok(checkClientFrame(f({ payloadType: 51 })).ok);
  // duplicate key smuggling: the last key wins in JS and the frame we send is rebuilt, so 2106 can never ride along
  const dup = checkClientFrame('{"payloadType":2137,"payloadType":2106,"payload":{"ctidTraderAccountId":77,"symbolId":5,"period":1}}');
  assert.equal(dup.ok, false);
  const dup2 = checkClientFrame('{"payloadType":2106,"payloadType":2137,"payload":{"ctidTraderAccountId":77,"symbolId":5,"period":1}}');
  assert.ok(dup2.ok); assert.equal(JSON.parse(dup2.frame).payloadType, 2137); assert.equal((dup2.frame.match(/payloadType/g) || []).length, 1);
  for (const bad of ['{"payloadType":"2137","payload":{}}', '{"payloadType":2137.0,"payload":{"ctidTraderAccountId":"77","symbolId":5,"period":1}}', '{"payloadType":2137,"payload":{"ctidTraderAccountId":77,"symbolId":5,"period":99}}',
    '{"payloadType":2137,"payload":{"ctidTraderAccountId":77,"symbolId":5,"period":1,"volume":1}}', '{"payloadType":2137,"payload":{"ctidTraderAccountId":77,"symbolId":5,"period":1,"count":9999}}',
    '{"payloadType":2137,"payload":{"symbolId":5,"period":1}}', '{"payloadType":2137,"extra":1,"payload":{"ctidTraderAccountId":77,"symbolId":5,"period":1}}', '{"clientMsgId":"a b","payloadType":51}',
    '[]', 'null', 'x', '{"payloadType":2127,"payload":{"ctidTraderAccountId":77,"symbolId":[]}}', '{"payloadType":2127,"payload":{"ctidTraderAccountId":77,"symbolId":[{"a":1}]}}', '{"payloadType":2149,"payload":{"accessToken":"short"}}', 'x'.repeat(20000)])
    assert.equal(checkClientFrame(bad).ok, false, bad.slice(0, 80));
  assert.equal(checkClientFrame(Buffer.from('{"payloadType":51}')).ok, false, 'binary refused');
});

// ---- relay with a fake upstream ----
const SECRET = 'SECRETFAKE-abc123';
const mkRelay = (extra = {}) => {
  const c = [], u = [], st = { cc: null, uc: null };
  const r = createRelay({ client: { send: (x) => c.push(x), close: (code, why) => { st.cc = [code, why]; } }, up: { send: (x) => u.push(x), close: () => { st.uc = true; } }, clientId: 'CID1', clientSecret: SECRET, ...extra });
  return { r, c, u, st };
};
const login = (m) => {   // app auth, account list, account auth
  m.r.start(); m.r.onUp(f({ payloadType: 2101, payload: {} }));
  m.r.onClient(f({ clientMsgId: 'x1', payloadType: 2149, payload: { accessToken: 'ACCESSTOKEN1' } }));
  m.r.onUp(f({ clientMsgId: 'x1', payloadType: 2150, payload: { ctidTraderAccount: [{ ctidTraderAccountId: 77, isLive: true }] } }));
  m.r.onClient(f({ clientMsgId: 'x2', payloadType: 2102, payload: { ctidTraderAccountId: 77, accessToken: 'ACCESSTOKEN1' } }));
  m.r.onUp(f({ clientMsgId: 'x2', payloadType: 2103, payload: { ctidTraderAccountId: 77 } }));
};
await t('relay: injects app auth with the env secret; secret never reaches the client', () => {
  const m = mkRelay(); login(m);
  assert.deepEqual(JSON.parse(m.u[0]), { payloadType: 2100, payload: { clientId: 'CID1', clientSecret: SECRET } });
  assert.ok(!m.c.join('').includes(SECRET)); assert.ok(!m.c.join('').includes('2101'), 'app auth reply stays inside');
  // an upstream frame that echoes the secret (plain, escaped or base64) is dropped
  const before = m.c.length;
  m.r.onUp(f({ payloadType: 2142, payload: { description: 'bad ' + SECRET } }));
  m.r.onUp(f({ payloadType: 2142, payload: { description: Buffer.from(SECRET).toString('base64') } }));
  assert.equal(m.c.length, before);
  assert.ok(!m.c.join('').includes(SECRET));
});
await t('relay: client app auth 2100 and every trading frame closes the socket (1008) and nothing goes upstream', () => {
  for (const ty of [2100, 2106, 2108, 2109, 2111, 2121, 2124, 2133, 2143, 2173]) {
    const m = mkRelay(); login(m); const up = m.u.length;
    m.r.onClient(f({ payloadType: ty, payload: { ...A, symbolId: 1 } }));
    assert.equal(m.st.cc[0], 1008, 'type ' + ty); assert.equal(m.u.length, up, 'nothing forwarded for ' + ty); assert.ok(m.st.uc, 'upstream closed');
  }
});
await t('relay: account binding, token binding, subscription cap, rate limit', () => {
  let m = mkRelay(); login(m); m.r.onClient(f({ payloadType: 2114, payload: { ctidTraderAccountId: 99 } })); assert.equal(m.st.cc[0], 1008, 'unauthorised account');
  m = mkRelay(); m.r.start(); m.r.onUp(f({ payloadType: 2101 })); m.r.onClient(f({ payloadType: 2149, payload: { accessToken: 'ACCESSTOKEN1' } }));
  m.r.onClient(f({ payloadType: 2149, payload: { accessToken: 'OTHERTOKEN99' } })); assert.equal(m.st.cc[0], 1008, 'second token');
  m = mkRelay(); m.r.start(); m.r.onUp(f({ payloadType: 2101 })); m.r.onClient(f({ payloadType: 2102, payload: { ctidTraderAccountId: 77, accessToken: 'ACCESSTOKEN1' } })); assert.equal(m.st.cc[0], 1008, 'account auth before the account list');
  m = mkRelay(); login(m); for (let i = 0; i < 5; i++) m.r.onClient(f({ payloadType: 2127, payload: { ...A, symbolId: Array.from({ length: 10 }, (_, k) => i * 10 + k + 1) } })); assert.equal(m.st.cc[0], 1008, 'too many subscriptions');
  let now = 1e12; m = mkRelay({ now: () => now }); login(m);
  for (let i = 0; i < 6; i++) m.r.onClient(f({ payloadType: 2137, payload: { ...A, symbolId: 1, period: 1 } })); assert.equal(m.st.cc[0], 1008, 'history rate');
  now += 5; m = mkRelay({ now: () => now }); login(m); for (let i = 0; i < 45; i++) m.r.onClient(f({ payloadType: 51 })); assert.equal(m.st.cc[0], 1008, 'message rate');
  m = mkRelay({ now: () => now }); login(m); now += 61000; m.r.tick(); assert.equal(m.st.cc[0], 1001, 'idle'); 
});
await t('relay: client messages wait for app auth; upstream error before app auth closes; only wanted types come back', () => {
  const m = mkRelay(); m.r.start(); m.r.onClient(f({ payloadType: 2149, payload: { accessToken: 'ACCESSTOKEN1' } })); assert.equal(m.u.length, 1, 'queued');
  m.r.onUp(f({ payloadType: 2101 })); assert.equal(m.u.length, 2); assert.equal(JSON.parse(m.u[1]).payloadType, 2149);
  const c0 = m.c.length; m.r.onUp(f({ payloadType: 2106, payload: {} })); m.r.onUp(f({ payloadType: 2126, payload: {} })); m.r.onUp('not json'); assert.equal(m.c.length, c0, 'order events and junk are not passed on');
  const e = mkRelay(); e.r.start(); e.r.onUp(f({ payloadType: 2142, payload: { errorCode: 'CH_CLIENT_AUTH_FAILURE' } })); assert.equal(e.st.cc[0], 1011);
});
await t('relay: a live spot reaches the client unchanged', () => {
  const m = mkRelay(); login(m); const spot = { payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 5, bid: 108500, ask: 108520 } };
  m.r.onUp(f(spot)); assert.deepEqual(JSON.parse(m.c[m.c.length - 1]), spot);
});

// ---- ws.js entry checks (no upgrade completes here: those are the early-exit paths) ----
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const kp = await C.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await C.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const now = Math.floor(Date.now() / 1000);
const mk = async (p = {}) => { const h = b({ alg: 'RS256', kid: 'k1' }), pl = b({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'u1', iat: now, exp: now + 600, ...p }); return h + '.' + pl + '.' + Buffer.from(await C.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(h + '.' + pl))).toString('base64url'); };
const verifyFetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=300' } });
const good = await mk();
const ENV = { CTRADER_CLIENT_ID: 'CLIENTID123', CTRADER_CLIENT_SECRET: SECRET };
const wreq = (o = {}) => new Request('https://tradezoro.com/connect/ctrader/ws', { headers: { upgrade: 'websocket', origin: 'https://tradezoro.com', 'sec-websocket-protocol': 'tz-auth, ' + good, ...(o.h || {}) } });
await t('ws: 503 unconfigured, 426 no upgrade, 403 bad origin, 401 no/bad token, 405 POST', async () => {
  const call = (r, env = ENV) => wsHandle(r, env, { verifyFetch, connect: async () => { throw new Error('no upstream'); } });
  assert.equal((await call(wreq(), {})).status, 503);
  assert.equal((await call(wreq({ h: { upgrade: '' } }))).status, 426);
  assert.equal((await call(wreq({ h: { origin: 'https://evil.example.com' } }))).status, 403);
  assert.equal((await call(wreq({ h: { origin: '' } }))).status, 403);
  assert.equal((await call(wreq({ h: { 'sec-websocket-protocol': 'tz-auth, nope.nope.nope' } }))).status, 401);
  assert.equal((await call(wreq({ h: { 'sec-websocket-protocol': '' } }))).status, 401);
  assert.equal((await call(new Request('https://tradezoro.com/connect/ctrader/ws', { method: 'POST' }))).status, 405);
  assert.equal((await call(wreq())).status, 502, 'good request reaches the upstream step');
});

// ---- token function ----
const treq = (o = {}) => new Request('https://tradezoro.com/connect/ctrader/token' + (o.q || ''), { method: o.method || 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + good, ...(o.h || {}) }, body: o.method === 'GET' ? undefined : (o.body ?? JSON.stringify({ grant: 'code', code: 'CODEABCDEFGH' })) });
let upstream = null;
const fetchImpl = async (u, o) => { upstream = { u, o }; return new Response(JSON.stringify({ accessToken: 'ACCESSFAKE1', refreshToken: 'REFRESHFAKE1', expiresIn: 2628000, tokenType: 'bearer', errorCode: null, description: null, extra: 'x' }), { status: 200 }); };
const tcall = (r, env = ENV, deps = {}) => tokenHandle(r, env, { verifyFetch, fetchImpl, ...deps });
await t('token fn: probe, method, origin, content-type, auth, body', async () => {
  assert.deepEqual(await (await tcall(treq({ method: 'GET', q: '?probe=1' }))).json(), { configured: true, client_id: 'CLIENTID123' });
  const off = await tcall(treq({ method: 'GET', q: '?probe=1' }), {}); assert.equal(off.status, 503);
  assert.equal((await tcall(treq(), {})).status, 503);
  assert.equal((await tcall(treq({ method: 'PUT' }))).status, 405);
  assert.equal((await tcall(treq({ h: { origin: 'https://evil.example.com' } }))).status, 403);
  assert.equal((await tcall(treq({ h: { origin: '' } }))).status, 403);
  assert.equal((await tcall(treq({ h: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await tcall(treq({ h: { authorization: '' } }))).status, 401);
  assert.equal((await tcall(treq({ body: '{"grant":"code","code":"bad code"}' }))).status, 400);
  assert.equal((await tcall(treq({ body: '{"grant":"x"}' }))).status, 400);
  assert.equal(upstream, null, 'nothing reached cTrader for a bad call');
});
await t('token fn: swap + refresh go to cTrader only, redirect fixed, reply trimmed, nothing logged', async () => {
  const logs = []; const o = [console.log, console.error, console.warn]; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  const r = await tcall(treq()); const j = await r.json(); [console.log, console.error, console.warn] = o;
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(j).sort(), ['access_token', 'expires_in', 'refresh_token', 'token_type']); assert.equal(j.access_token, 'ACCESSFAKE1');
  const u = new URL(upstream.u); assert.equal(u.origin + u.pathname, 'https://openapi.ctrader.com/apps/token'); assert.equal(upstream.o.method, 'GET');
  assert.equal(u.searchParams.get('grant_type'), 'authorization_code'); assert.equal(u.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/ctrader/callback'); assert.equal(u.searchParams.get('client_secret'), SECRET); assert.equal(u.searchParams.get('client_id'), 'CLIENTID123');
  await tcall(treq({ body: JSON.stringify({ grant: 'refresh', refresh_token: 'REFRESHFAKE1', redirect_uri: 'https://evil.example.com' }) }));
  const u2 = new URL(upstream.u); assert.equal(u2.searchParams.get('grant_type'), 'refresh_token'); assert.equal(u2.searchParams.get('refresh_token'), 'REFRESHFAKE1'); assert.equal(u2.searchParams.get('redirect_uri'), null);
  assert.ok(!logs.join('').match(/ACCESSFAKE|REFRESHFAKE|SECRETFAKE/));
  const bad = await tcall(treq(), ENV, { fetchImpl: async () => new Response(JSON.stringify({ errorCode: 'ACCESS_DENIED', description: 'SECRETFAKE-abc123' }), { status: 200 }) });
  assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('SECRETFAKE'));
  assert.equal((await tcall(treq(), ENV, { fetchImpl: async () => { throw new Error('boom ' + SECRET); } })).status, 502);
});

// ---- browser side: OAuth URL, scope, adapter ----
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
await t('OAuth URL: scope=accounts only, fixed redirect, single-use state', () => {
  const st = mem(); const url = new URL(ct.ctraderAuthUrl('CID_1', 'u1', st));
  assert.equal(url.origin + url.pathname, 'https://id.ctrader.com/my/settings/openapi/grantingaccess/');
  assert.equal(url.searchParams.get('scope'), 'accounts'); assert.equal(url.searchParams.get('product'), 'web'); assert.equal(url.searchParams.get('client_id'), 'CID_1');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/ctrader/callback');
  const s = url.searchParams.get('state'); assert.ok(s.length >= 20);
  assert.equal(ct.takeCtraderState('x', 'u1', st), null, 'consumed on a miss'); ct.ctraderAuthUrl('C', 'u1', st); const s2 = JSON.parse(st.getItem(ct.CT.STATE_KEY)).state;
  assert.equal(ct.takeCtraderState(s2, 'u2', st), null, 'other user'); ct.ctraderAuthUrl('C', 'u1', st); const s3 = JSON.parse(st.getItem(ct.CT.STATE_KEY)).state;
  assert.ok(ct.takeCtraderState(s3, 'u1', st)); assert.equal(ct.takeCtraderState(s3, 'u1', st), null, 'single use');
  assert.throws(() => ct.ctraderAuthUrl('C', null, st), /Sign in/);
});
await t('the trading scope word appears nowhere in cTrader code, pages or this app', () => {
  const bad = 'scope=' + 'trading';
  const files = ['assets/byo-ctrader.js', 'assets/ctrader-callback.js', 'ctrader-callback.html', 'assets/byo-ui.js', 'assets/byo-core.js', 'functions/connect/ctrader/ws.js', 'functions/connect/ctrader/token.js', 'functions/connect/ctrader/_relay.js', '_redirects', '_headers'];
  for (const p of files) assert.ok(!readFileSync(new URL('../../' + p, import.meta.url), 'utf8').includes(bad), p);
  assert.ok(!ct.ctraderAuthUrl('C', 'u1', mem()).includes(bad));
  assert.equal(ct.CT.SCOPE, 'accounts');
  assert.ok(!/trading/i.test(JSON.stringify({ ...SOURCES.find((s) => s.id === 'ctrader') })), 'catalogue copy has no trading word');
  const walk = (d) => readdirSync(d).flatMap((x) => { const p = d + '/' + x; return statSync(p).isDirectory() ? (x === 'node_modules' || x === '.git' || x === 'vendor' ? [] : walk(p)) : /\.(js|mjs|html)$/.test(x) && x !== 'ctrader.test.mjs' ? [p] : []; });
  for (const p of [...walk(new URL('../../assets', import.meta.url).pathname), ...walk(new URL('../../functions', import.meta.url).pathname)]) assert.ok(!readFileSync(p, 'utf8').includes(bad), p);
});
await t('browser guard: only market-data messages may be sent', () => {
  for (const ty of ct.SEND_OK) ct.guardCt({ payloadType: ty });
  for (const ty of [2100, 2106, 2108, 2109, 2111, 2121, 2124, 2133, 2143]) assert.throws(() => ct.guardCt({ payloadType: ty }), /byo-guard/, String(ty));
});
await t('symbols + catalogue', () => {
  assert.equal(ct.symbolOf('EURUSD'), 'EURUSD'); assert.equal(ct.symbolOf('fx:eur/usd'), 'EURUSD'); assert.equal(ct.symbolOf('byo:BTCUSD'), 'BTCUSD'); assert.equal(ct.symbolOf('XAUUSD'), 'XAUUSD');
  assert.equal(ct.symbolOf('AAPL'), null); assert.equal(ct.symbolOf('../x'), null); assert.equal(ct.symbolOf(''), null);
  const row = SOURCES.find((s) => s.id === 'ctrader'); assert.equal(row.state, 'soon'); assert.equal(row.beta, true); assert.match(row.noteText, /secure relay; nothing is stored/);
  assert.ok(!SOURCES.filter((s) => !['ctrader', 'dhan'].includes(s.id)).some((s) => s.noteText), 'other sources keep the default line');
});
await t('adapter: history, then a live spot becomes a candle (fake relay socket)', async () => {
  const sent = [];
  class FakeWS {
    constructor(url, protos) { this.url = url; this.protos = protos; this.readyState = 1; FakeWS.last = this; setTimeout(() => { this.onmessage({ data: f({ relay: 'ready' }) }); }, 0); }
    send(s) {
      const m = JSON.parse(s); sent.push(m); const rep = (ty, payload) => setTimeout(() => this.onmessage({ data: f({ clientMsgId: m.clientMsgId, payloadType: ty, payload }) }), 0);
      if (m.payloadType === 2149) rep(2150, { ctidTraderAccount: [{ ctidTraderAccountId: 77, isLive: true }] });
      else if (m.payloadType === 2102) rep(2103, { ctidTraderAccountId: 77 });
      else if (m.payloadType === 2114) rep(2115, { symbol: [{ symbolId: 5, symbolName: 'EUR/USD', enabled: true }, { symbolId: 6, symbolName: 'GBP/USD', enabled: true }] });
      else if (m.payloadType === 2137) rep(2138, { trendbar: [{ low: 108000, deltaOpen: 100, deltaHigh: 300, deltaClose: 200, volume: 10, utcTimestampInMinutes: 28000000 }] });
      else if (m.payloadType === 2127) rep(2128, {});
    }
    close() { this.readyState = 3; }
  }
  const creds = { access: 'ACCESSTOKEN1', refresh: 'R', exp: Date.now() + 9 * 864e5, accountId: 77, isLive: true };
  const d = { WS: FakeWS, idToken: async () => 'IDTOKEN', location: { protocol: 'https:', host: 'tradezoro.com' } };
  await ct.ctrader.check(creds, d);
  assert.equal(FakeWS.last.url, 'wss://tradezoro.com/connect/ctrader/ws?env=live'); assert.deepEqual(FakeWS.last.protos, ['tz-auth', 'IDTOKEN']);
  const bars = await ct.ctrader.getBars(creds, 'EURUSD', '1', { limit: 10 }, d);
  assert.equal(bars.length, 1); assert.deepEqual(bars[0], { time: 28000000 * 60000, open: 1.081, high: 1.083, low: 1.08, close: 1.082, volume: 10 });
  assert.ok(sent.every((m) => ct.SEND_OK.has(m.payloadType)), 'only market-data messages were sent');
  assert.ok(!JSON.stringify(sent).includes('clientSecret'), 'no secret in browser frames');
  // live
  const got = []; let status = '';
  const hub = ct.ctrader.hub(creds, (s) => { status = s; }, d);
  const stop = ct.ctrader.subscribe(hub, 'EURUSD', '1', bars[0], (c) => got.push(c));
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(status, 'live');
  const ts = Math.floor(Date.now() / 60000) * 60000 + 1000;
  FakeWS.last.onmessage({ data: f({ payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 5, bid: 108400, ask: 108420, timestamp: ts } }) });
  FakeWS.last.onmessage({ data: f({ payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 5, bid: 108500, timestamp: ts + 1000 } }) });
  assert.equal(got.length, 2); assert.equal(got[1].close, 1.085); assert.equal(got[1].open, 1.084); assert.equal(got[1].high, 1.085); assert.equal(got[1].low, 1.084);
  stop(); hub.stop();
});

console.log('ALL PASS', n);
process.exit(0);
