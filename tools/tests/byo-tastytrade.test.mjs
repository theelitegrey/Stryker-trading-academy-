// Fixture tests for assets/byo-tastytrade.js. No real keys, no network. Run: node tools/tests/byo-tastytrade.test.mjs
import assert from 'node:assert/strict';
import { guardUrl, guardWs, SOURCES, Hub } from '../../assets/byo-core.js?v=873';
import { tastytrade as T, symbolOf, guardDx, accessToken } from '../../assets/byo-tastytrade.js?v=873';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const C = () => ({ clientId: 'CID', clientSecret: 'SECRETFAKE', refreshToken: 'REFRESHFAKE' });
const jwt = (scope) => 'h.' + Buffer.from(JSON.stringify({ scope })).toString('base64url') + '.s';
const URL_WS = 'wss://tasty-openapi-ws.dxfeed.com/realtime';
const calls = [];
const fetchOk = (scope = 'read') => async (url, init) => {
  calls.push({ url, init });
  const u = new URL(url);
  if (u.pathname === '/oauth/token') return { ok: true, status: 200, json: async () => ({ access_token: jwt(scope), expires_in: 900 }) };
  if (u.pathname === '/api-quote-tokens') return { ok: true, status: 200, json: async () => ({ data: { token: 'QT', 'dxlink-url': URL_WS, level: 'api' } }) };
  if (u.pathname === '/instruments/futures') return { ok: true, status: 200, json: async () => ({ data: { items: [
    { 'streamer-symbol': '/ESZ25:XCME', 'expiration-date': '2020-12-18', 'active-month': true }, { 'streamer-symbol': '/ESH99:XCME', 'expiration-date': '2099-03-20' }, { 'streamer-symbol': '/ESM99:XCME', 'expiration-date': '2099-06-20', 'active-month': true }] } }) };
  throw new Error('unexpected ' + url);
};
class WS {
  constructor(url) { this.url = url; this.sent = []; WS.all.push(this); setTimeout(() => this.onopen && this.onopen(), 0); }
  send(m) {
    const j = JSON.parse(m); this.sent.push(j);
    const r = (o) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(o) }), 0);
    if (j.type === 'SETUP') { r({ type: 'SETUP', channel: 0 }); r({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' }); }
    if (j.type === 'AUTH') r({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
    if (j.type === 'CHANNEL_REQUEST') r({ type: 'CHANNEL_OPENED', channel: 3 });
    if (j.type === 'FEED_SETUP') r({ type: 'FEED_CONFIG', channel: 3 });
    if (j.type === 'FEED_SUBSCRIPTION' && WS.onSub) WS.onSub(this, j, r);
  }
  emit(o) { this.onmessage({ data: JSON.stringify(o) }); }
  close() { this.onclose && this.onclose(); }
}
WS.all = [];

await t('guard: only token, quote token, futures lookup', () => {
  guardUrl('tastytrade', 'https://api.tastyworks.com/oauth/token', 'POST');
  guardUrl('tastytrade', 'https://api.tastyworks.com/api-quote-tokens');
  guardUrl('tastytrade', 'https://api.tastyworks.com/instruments/futures?product-code[]=ES');
  for (const p of ['/accounts', '/accounts/5WT00000/positions', '/accounts/5WT00000/orders', '/accounts/5WT00000/balances', '/orders', '/positions', '/customers/me', '/customers/me/accounts', '/sessions', '/api-quote-tokens/x', '/oauth/token/', '/instruments/equities', '/accounts/5WT00000/orders/dry-run', '/instruments/futures/../accounts'])
    assert.throws(() => guardUrl('tastytrade', 'https://api.tastyworks.com' + p), /byo-guard/, p);
  for (const m of ['POST', 'PUT', 'DELETE']) assert.throws(() => guardUrl('tastytrade', 'https://api.tastyworks.com/api-quote-tokens', m), /byo-guard/, m);
  assert.throws(() => guardUrl('tastytrade', 'https://api.cert.tastyworks.com/oauth/token', 'POST'), /byo-guard/);
  assert.throws(() => guardUrl('tastytrade', 'https://api.tastyworks.com.evil.test/oauth/token', 'POST'), /byo-guard/);
  assert.throws(() => guardUrl('tastytrade', 'http://api.tastyworks.com/api-quote-tokens'), /byo-guard/);
});
await t('guard: account streamer and odd socket urls refused; dxlink url checked strictly', () => {
  guardWs('tastytrade', URL_WS); guardWs('tastytrade', 'wss://tasty-openapi-ws.dxfeed.com/delayed');
  for (const u of ['wss://streamer.tastyworks.com', 'wss://tasty-openapi-ws.dxfeed.com.evil.test/realtime', 'wss://evil.example/realtime', 'ws://tasty-openapi-ws.dxfeed.com/realtime', 'wss://tasty-x.dxfeed.com/realtime?a=1', 'wss://u:p@tasty-x.dxfeed.com/realtime', 'wss://xn--tasty.dxfeed.com/realtime', 'wss://tasty-x.dxfeed.com:444/realtime'])
    assert.throws(() => guardWs('tastytrade', u), /byo-guard/, u);
});
await t('guard: DXLink messages limited to data frames', () => {
  guardDx({ type: 'SETUP', channel: 0, version: 'x' }); guardDx({ type: 'KEEPALIVE', channel: 0 });
  guardDx({ type: 'FEED_SUBSCRIPTION', channel: 3, add: [{ type: 'Candle', symbol: 'AAPL{=5m}' }, { type: 'Trade', symbol: '/ESZ25:XCME' }] });
  assert.throws(() => guardDx({ type: 'FEED_SUBSCRIPTION', channel: 3, add: [{ type: 'Order', symbol: 'AAPL' }] }), /byo-guard/);
  assert.throws(() => guardDx({ type: 'FEED_SUBSCRIPTION', channel: 3, add: [{ type: 'Trade', symbol: 'a b;' }] }), /byo-guard/);
  assert.throws(() => guardDx({ type: 'FEED_SUBSCRIPTION', channel: 9, add: [] }), /byo-guard/);
  assert.throws(() => guardDx({ type: 'CHANNEL_REQUEST', channel: 3, service: 'ACCOUNT', parameters: {} }), /byo-guard/);
  assert.throws(() => guardDx({ action: 'connect', value: ['5WT1'], 'auth-token': 'x' }), /byo-guard/);
  assert.throws(() => guardDx({ type: 'ORDER' }), /byo-guard/);
});
await t('symbols: AAPL, /ES, ES1!, byo: prefix; junk refused', () => {
  assert.equal(symbolOf('byo:aapl'), 'AAPL'); assert.equal(symbolOf('/ES'), '/ES'); assert.equal(symbolOf('ES1!'), '/ES'); assert.equal(symbolOf('byo:NQ1!'), '/NQ'); assert.equal(symbolOf('BRK.B'), 'BRK.B');
  assert.equal(symbolOf('../accounts'), null); assert.equal(symbolOf(''), null); assert.equal(symbolOf('EURUSD1234'), null);
});
await t('catalogue: tastytrade ready + Beta, no order words, steps link to tastytrade docs', () => {
  const s = SOURCES.find((x) => x.id === 'tastytrade');
  assert.equal(s.state, 'ready'); assert.equal(s.beta, true); assert.match(s.docs, /^https:\/\/developer\.tastytrade\.com\//);
  assert.ok(!/\b(orders?|positions?|balances?)\b/i.test(JSON.stringify([s.covers, s.help, s.manage, s.steps])));
});
await t('token: refresh grant body, cached, single flight, 15 min', async () => {
  calls.length = 0; const c = C(); const f = fetchOk();
  const [a, b] = await Promise.all([accessToken(c, { fetch: f }), accessToken(c, { fetch: f })]);
  assert.equal(a, b); assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { grant_type: 'refresh_token', refresh_token: 'REFRESHFAKE', client_secret: 'SECRETFAKE', client_id: 'CID' });
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.credentials, 'omit');
  await accessToken(c, { fetch: f }); assert.equal(calls.length, 1);
});
await t('token: trade-scope grant refused; bad secret gives fixed 401 message with no secret in it', async () => {
  await assert.rejects(() => T.check(C(), { fetch: fetchOk('read trade') }), /Read scope/);
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: 'SECRETFAKE leak' }) });
  await assert.rejects(() => T.check(C(), { fetch: bad }), (e) => e.status === 401 && !/SECRETFAKE|REFRESHFAKE/.test(e.message));
  await T.check(C(), { fetch: fetchOk('read openid') });
});
await t('history: Candle snapshot over DXLink -> sorted bars; futures symbol from the lookup (front month)', async () => {
  WS.all.length = 0; calls.length = 0;
  WS.onSub = (ws, j, r) => { if (j.add[0].type === 'Candle') r({ type: 'FEED_DATA', channel: 3, data: ['Candle', ['Candle', j.add[0].symbol, 0, 1700000060000, 101, 103, 100, 102, 12, 'Candle', j.add[0].symbol, 4, 1700000000000, 100, 102, 99, 101, 10] ] }); };
  const bars = await T.getBars(C(), '/ES', '1', { limit: 10 }, { fetch: fetchOk(), WS });
  assert.deepEqual(bars.map((b) => b.time), [1700000000000, 1700000060000]);
  assert.deepEqual(bars[1], { time: 1700000060000, open: 101, high: 103, low: 100, close: 102, volume: 12 });
  const sub = WS.all[0].sent.find((m) => m.type === 'FEED_SUBSCRIPTION');
  assert.equal(sub.add[0].symbol, '/ESM99:XCME{=1m}');   // expired 2020 skipped, active-month wins
  assert.equal(WS.all[0].url, URL_WS);
  assert.deepEqual(WS.all[0].sent.map((m) => m.type), ['SETUP', 'AUTH', 'CHANNEL_REQUEST', 'FEED_SETUP', 'FEED_SUBSCRIPTION']);
  assert.equal(WS.all[0].sent[1].token, 'QT');
  assert.ok(calls.every((x) => !/accounts|orders|positions/.test(x.url)));
  const stock = await T.getBars(C(), 'AAPL', '5', { limit: 10 }, { fetch: fetchOk(), WS });
  assert.equal(WS.all[1].sent.find((m) => m.type === 'FEED_SUBSCRIPTION').add[0].symbol, 'AAPL{=5m}'); assert.ok(stock.length);
});
await t('live: Trade events become ticks for the right chart symbol; refused login is fatal', async () => {
  WS.all.length = 0; WS.onSub = null;
  const st = []; const hub = T.hub(C(), (s, m) => st.push([s, m]), { fetch: fetchOk(), WS });
  const got = []; T.subscribe(hub, 'AAPL', '1', { time: Math.floor(Date.now() / 6e4) * 6e4, open: 1, high: 1, low: 1, close: 1, volume: 0 }, (b) => got.push(b));
  await new Promise((r) => setTimeout(r, 500));
  const ws = WS.all[0];
  assert.equal(ws.sent.find((m) => m.type === 'FEED_SUBSCRIPTION').add[0].symbol, 'AAPL');
  ws.emit({ type: 'FEED_DATA', channel: 3, data: ['Trade', ['Trade', 'AAPL', 210.5, 3]] });
  assert.equal(got.length, 1); assert.equal(got[0].close, 210.5);
  assert.ok(st.some((x) => x[0] === 'live'));
  hub.stop();
  const bad = async (u) => ({ ok: false, status: 401, json: async () => ({}) });
  const st2 = []; const hub2 = T.hub(C(), (s, m) => st2.push([s, m]), { fetch: bad, WS });
  hub2.add('AAPL', () => {}); await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(st2[st2.length - 1], ['error', 'tastytrade refused the login']); hub2.stop();
});
console.log(n + ' tests passed');
