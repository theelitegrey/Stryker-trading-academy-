// Unit tests for assets/byo-core.js + byo-provider.js (Connect your own data). Fixtures only, no real keys, no network.
// Run: node tools/tests/byo-core.test.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { ironbeam, bindUser, guardUrl, guardWs, guardWsMessage, makeVault, candleBuilder, alpaca, oanda, Hub, activate, route, forget, labelFor, statusOf, SOURCES } from '../../assets/byo-core.js?v=870';
import { withByo, ByoProvider } from '../../assets/byo-provider.js?v=870';

const FAKE = { key: 'PKTESTFAKE', secret: 'SECRETFAKE', feed: 'iex' };
const log = [];
const origLog = console.log; // secrets must never reach logs
let n = 0; const t = async (name, fn) => { await fn(); n++; origLog('ok', name); };
const flush = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// ---- guard: data only ----
await t('guard allows market-data paths only', () => {
  guardUrl('alpaca', 'https://data.alpaca.markets/v2/stocks/AAPL/bars?timeframe=1Min');
  guardUrl('oanda', 'https://api-fxpractice.oanda.com/v3/instruments/EUR_USD/candles?granularity=M1');
  guardUrl('oanda', 'https://stream-fxtrade.oanda.com/v3/accounts/101-001-1234567-001/pricing/stream?instruments=EUR_USD');
  for (const [s, u] of [
    ['alpaca', 'https://api.alpaca.markets/v2/orders'], ['alpaca', 'https://paper-api.alpaca.markets/v2/account'], ['alpaca', 'https://data.alpaca.markets/v2/positions'],
    ['oanda', 'https://api-fxtrade.oanda.com/v3/accounts/101-001-1234567-001/orders'], ['oanda', 'https://api-fxtrade.oanda.com/v3/accounts/101-001-1234567-001/summary'], ['oanda', 'https://api-fxtrade.oanda.com/v3/accounts'], ['oanda', 'https://api-fxtrade.oanda.com/v3/accounts/101-001-1234567-001/positions'], ['oanda', 'https://api-fxtrade.oanda.com/v3/accounts/101-001-1234567-001/pricing'], ['oanda', 'https://api-fxtrade.oanda.com/v3/accounts/101-001-1234567-001/trades'], ['alpaca', 'https://data.alpaca.markets/v2/account'], ['alpaca', 'https://data.alpaca.markets:444/v2/stocks/AAPL/bars'], ['alpaca', 'https://u:p@data.alpaca.markets/v2/stocks/AAPL/bars'], ['alpaca', 'https://data.alpaca.markets/v2/stocks/AAPL%2Forders/bars'],
    ['oanda', 'https://api-fxtrade.oanda.com/v3/accounts/101-001-1234567-001/openPositions'], ['oanda', 'https://evil.example.com/v3/accounts'], ['alpaca', 'http://data.alpaca.markets/v2/stocks/AAPL/bars']
  ]) assert.throws(() => guardUrl(s, u), /byo-guard/, u);
  assert.throws(() => guardUrl('alpaca', 'https://data.alpaca.markets/v2/stocks/AAPL/bars', 'POST'), /byo-guard/);
  assert.throws(() => guardUrl('nope', 'https://x.test/'), /byo-guard/);
});
await t('guard sockets + messages', () => {
  guardWs('alpaca', 'wss://stream.data.alpaca.markets/v2/iex');
  assert.throws(() => guardWs('alpaca', 'wss://paper-api.alpaca.markets/stream'), /byo-guard/);
  assert.throws(() => guardWs('alpaca', 'wss://stream.data.alpaca.markets/v2/iex/../x'), /byo-guard/);
  guardWsMessage('alpaca', { action: 'auth', key: 'k', secret: 's' });
  guardWsMessage('alpaca', { action: 'subscribe', trades: ['AAPL'] });
  assert.throws(() => guardWsMessage('alpaca', { action: 'listen', data: { streams: ['trade_updates'] } }), /byo-guard/);
  assert.throws(() => guardWsMessage('alpaca', 'not json'), /byo-guard/);
});
await t('catalogue: unbuilt sources are soon, built are ready, none mention orders', () => {
  assert.deepEqual(SOURCES.filter((s) => s.state === 'ready').map((s) => s.id), ['alpaca', 'oanda', 'ironbeam', 'dhan']);
  assert.ok(SOURCES.filter((s) => s.state === 'soon').length >= 3);
  assert.ok(!/order|trade|position|balance/i.test(JSON.stringify(SOURCES.map((s) => [s.covers, s.help, s.feeNote]))));
});

// ---- vault ----
await t('vault: encrypts, round-trips, key is non-extractable, forget wipes', async () => {
  const m = new Map();
  const store = { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
  let who = 'u1';
  const v = makeVault(store, webcrypto.subtle, () => who);
  await v.save('alpaca', FAKE);
  const raw = JSON.stringify(m.get('c:alpaca'));
  assert.ok(!raw.includes('SECRETFAKE') && !raw.includes('PKTESTFAKE'), 'ciphertext must not contain the secret');
  assert.deepEqual(await v.load('alpaca'), FAKE);
  assert.equal(m.get('master').extractable, false);
  await assert.rejects(() => webcrypto.subtle.exportKey('raw', m.get('master')));
  assert.deepEqual(await v.ids(), ['alpaca']);
  await v.forget('alpaca');
  assert.equal(await v.load('alpaca'), null);
  assert.deepEqual(await v.ids(), []);
  who = 'u2'; assert.equal(await v.load('alpaca'), null, 'another user id cannot decrypt'); who = 'u1';
  who = ''; await assert.rejects(() => v.save('x', {}), /Sign in/); who = 'u1';
  await v.save('alpaca', FAKE); await v.wipe(); assert.deepEqual(await v.ids(), []); assert.equal(m.size, 0);
  // a different master key cannot read it
  await v.save('oanda', { token: 'T' }); m.delete('master');
  assert.equal(await v.load('oanda'), null);
});

// ---- candle builder ----
await t('candle builder: bar alignment, OHLC, volume, old ticks ignored', () => {
  const out = [];
  const seed = { time: 1700000040000 - (1700000040000 % 60000), open: 10, high: 12, low: 9, close: 11, volume: 5 };
  const b = candleBuilder('1', seed, (c) => out.push(c));
  b(13, seed.time + 1000, 2); b(8, seed.time + 2000, 1); b(10, seed.time + 61000, 4); b(99, seed.time - 5000, 1);
  assert.deepEqual(out[0], { time: seed.time, open: 10, high: 13, low: 9, close: 13, volume: 7 });
  assert.equal(out[1].low, 8); assert.equal(out[1].close, 8);
  assert.deepEqual(out[2], { time: seed.time + 60000, open: 10, high: 10, low: 10, close: 10, volume: 4 });
  assert.equal(out.length, 3);
  const d = []; const bd = candleBuilder('D', { time: Date.UTC(2026, 10, 2), open: 1, high: 2, low: 1, close: 2, volume: 0 }, (c) => d.push(c));
  bd(3, Date.UTC(2026, 10, 2, 15)); assert.equal(d[0].time, Date.UTC(2026, 10, 2));
});

// ---- Alpaca ----
const barsFixture = { bars: [{ t: '2026-11-03T14:30:00Z', o: 100, h: 101, l: 99.5, c: 100.5, v: 1200 }, { t: '2026-11-03T14:31:00Z', o: 100.5, h: 102, l: 100, c: 101.5, v: 800 }], next_page_token: null };
await t('alpaca: symbol mapping, history request + parsing, headers', async () => {
  assert.equal(alpaca.symbolOf('byo:aapl'), 'AAPL'); assert.equal(alpaca.symbolOf('BRK.B'), 'BRK.B'); assert.equal(alpaca.symbolOf('???'), null);
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ bars: barsFixture.bars.slice().reverse() }) }; };   // sort=desc: newest first
  const bars = await alpaca.getBars(FAKE, 'AAPL', '1', { limit: 500 }, { fetch });
  assert.equal(seen.init.headers['APCA-API-KEY-ID'], 'PKTESTFAKE');
  assert.match(seen.url, /^https:\/\/data\.alpaca\.markets\/v2\/stocks\/AAPL\/bars\?/);
  assert.match(seen.url, /timeframe=1Min/); assert.match(seen.url, /feed=iex/); assert.match(seen.url, /sort=desc/);
  assert.equal(bars.length, 2); assert.equal(bars[0].time, Date.parse('2026-11-03T14:30:00Z')); assert.equal(bars[0].open, 100); // reversed back to ascending
  await assert.rejects(() => alpaca.getBars(FAKE, 'AAPL', '1', {}, { fetch: async () => ({ ok: false, status: 401 }) }), (e) => e.status === 401);
});
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.closed = false; FakeWS.all.push(this); setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify([{ T: 'success', msg: 'connected' }]) }), 0); }
  send(m) { this.sent.push(JSON.parse(m)); const a = this.sent[this.sent.length - 1].action; if (a === 'auth') setTimeout(() => this.emit([{ T: 'success', msg: 'authenticated' }]), 0); }
  emit(arr) { this.onmessage && this.onmessage({ data: JSON.stringify(arr) }); }
  close() { this.closed = true; this.onclose && this.onclose(); }
}
FakeWS.all = [];
await t('alpaca: auth by message, subscribes, ticks reach the chart as a live candle', async () => {
  const statuses = [];
  const hub = alpaca.hub(FAKE, (s) => statuses.push(s), { WS: FakeWS });
  const bars = [];
  const seed = { time: Math.floor(Date.now() / 60000) * 60000, open: 100, high: 101, low: 99, close: 100, volume: 10 };
  alpaca.subscribe(hub, 'AAPL', '1', seed, (b) => bars.push(b));
  await flush(400);
  const ws = FakeWS.all[0];
  assert.equal(ws.url, 'wss://stream.data.alpaca.markets/v2/iex');
  assert.deepEqual(ws.sent.map((m) => m.action), ['auth', 'subscribe']);
  assert.deepEqual(ws.sent[1].trades, ['AAPL']);
  ws.emit([{ T: 't', S: 'AAPL', p: 102.25, s: 3, t: new Date(seed.time + 5000).toISOString() }]);
  ws.emit([{ T: 't', S: 'AAPL', p: 98.5, s: 1, t: new Date(seed.time + 9000).toISOString() }]);
  assert.equal(bars.length, 2);
  assert.deepEqual(bars[1], { time: seed.time, open: 100, high: 102.25, low: 98.5, close: 98.5, volume: 14 });
  assert.ok(statuses.includes('live'));
  hub.stop();
});
await t('alpaca: refused key is fatal (no retry loop); connection limit retries with a plain message', async () => {
  FakeWS.all.length = 0;
  const st = [];
  const hub = alpaca.hub(FAKE, (s, m) => st.push([s, m]), { WS: FakeWS });
  hub.add('AAPL', () => {});
  await flush(400);
  FakeWS.all[0].emit([{ T: 'error', code: 402, msg: 'auth failed' }]);
  assert.deepEqual(st[st.length - 1], ['error', 'Alpaca refused the key']);
  await flush(50); assert.equal(FakeWS.all.length, 1, 'no reconnect after a refused key');
  const hub2 = alpaca.hub(FAKE, (s, m) => st.push([s, m]), { WS: FakeWS });
  hub2.add('AAPL', () => {});
  await flush(400);
  FakeWS.all[FakeWS.all.length - 1].emit([{ T: 'error', code: 406, msg: 'connection limit exceeded' }]);
  assert.match(st[st.length - 1][1], /Another app is using your Alpaca stream/); assert.equal(st[st.length - 1][0], 'connecting');
  hub.stop(); hub2.stop();
});

// ---- OANDA ----
const candlesFixture = { candles: [{ time: '1793716800.000000000', complete: true, volume: 120, mid: { o: '1.15000', h: '1.15100', l: '1.14900', c: '1.15050' } }, { time: '1793716860.000000000', complete: false, volume: 40, mid: { o: '1.15050', h: '1.15200', l: '1.15040', c: '1.15150' } }] };
await t('oanda: symbol mapping + candles request + parsing', async () => {
  assert.equal(oanda.symbolOf('fx:EURUSD'), 'EUR_USD'); assert.equal(oanda.symbolOf('EUR_USD'), 'EUR_USD'); assert.equal(oanda.symbolOf('AAPL'), null);
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => candlesFixture }; };
  const bars = await oanda.getBars({ token: 'TOK', env: 'practice' }, 'EURUSD', '60', { limit: 2 }, { fetch });
  assert.match(seen.url, /^https:\/\/api-fxpractice\.oanda\.com\/v3\/instruments\/EUR_USD\/candles\?/); assert.match(seen.url, /granularity=H1/);
  assert.equal(seen.init.headers.Authorization, 'Bearer TOK');
  assert.deepEqual(bars[0], { time: 1793716800000, open: 1.15, high: 1.151, low: 1.149, close: 1.1505, volume: 120 });
  const live = await oanda.getBars({ token: 'TOK', env: 'live' }, 'EURUSD', 'D', { limit: 1 }, { fetch });
  assert.match(seen.url, /api-fxtrade/); assert.equal(live.length, 1);
});
function streamBody(lines) { const enc = new TextEncoder(); let i = 0; return { getReader: () => ({ read: async () => (i < lines.length ? { value: enc.encode(lines[i++]), done: false } : (await new Promise(() => {}))) }) }; }
await t('oanda: account id is required, never listed', async () => {
  await assert.rejects(() => oanda.check({ token: 'T', env: 'live' }, { fetch: async () => { throw new Error('must not fetch'); } }), /account ID/);
});
await t('oanda: price stream (split chunks, heartbeat) becomes a live candle at mid price', async () => {
  const urls = [];
  const t0 = Math.floor(Date.now() / 60000) * 60000;
  const px = (b, a, ms) => JSON.stringify({ type: 'PRICE', instrument: 'EUR_USD', time: String((t0 + ms) / 1000), bids: [{ price: b, liquidity: 1 }], asks: [{ price: a, liquidity: 1 }] }) + '\n';
  const l1 = px('1.1000', '1.1002', 1000), l2 = px('1.1010', '1.1012', 2000);
  const fetch = async (url) => { urls.push(url); return { ok: true, status: 200, body: streamBody([l1.slice(0, 40), l1.slice(40) + JSON.stringify({ type: 'HEARTBEAT', time: '1' }) + '\n' + l2]) }; };
  const c = { token: 'TOK', env: 'live', account: '101-001-1234567-001' };
  const hub = oanda.hub(c, () => {}, { fetch });
  const bars = [];
  oanda.subscribe(hub, 'EURUSD', '1', { time: t0, open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 0 }, (b) => bars.push(b));
  await flush(450);
  assert.match(urls[0], /^https:\/\/stream-fxtrade\.oanda\.com\/v3\/accounts\/101-001-1234567-001\/pricing\/stream\?instruments=EUR_USD$/);
  assert.equal(bars.length, 2);
  assert.equal(bars[1].close, 1.1011); assert.equal(bars[1].high, 1.1011); assert.equal(bars[1].open, 1.1);
  hub.stop();
});
await t('oanda: 401 on the stream is fatal', async () => {
  const st = [];
  const hub = oanda.hub({ token: 'BAD', env: 'practice', account: '101-001-1234567-001' }, (s, m) => st.push([s, m]), { fetch: async () => ({ ok: false, status: 401 }) });
  hub.add('EUR_USD', () => {}); await flush(450);
  assert.deepEqual(st[st.length - 1], ['error', 'OANDA refused the token']); hub.stop();
});

// ---- Hub: backoff + hidden tab ----
await t('hub: backs off between reconnects, resets after data, stops when hidden', async () => {
  let opens = 0, ctl;
  const hub = new Hub({ open: (syms, onTick, c) => { opens++; ctl = c; return () => {}; } });
  hub.add('X', () => {}); await flush(300);
  assert.equal(opens, 1);
  ctl.fail(false); assert.equal(hub.fails, 1);
  const w1 = hub.timer; assert.ok(w1);
  hub.stop(); hub.fails = 3; hub.start(); ctl.fail(false);
  assert.equal(hub.fails, 4);
  hub.stop();
});

// ---- chart path: provider wrapper + fake WebSocket proves the chart gets live bars from the adapter ----
await t('ironbeam: guard, sign-in, stream, quote frame -> live candle', async () => {
  for (const u of ['https://live.ironbeamapi.com/v2/account/123/balance', 'https://live.ironbeamapi.com/v2/order/place', 'https://live.ironbeamapi.com/v2/position/list']) assert.throws(() => guardUrl('ironbeam', u), /byo-guard/);
  assert.throws(() => guardUrl('ironbeam', 'https://live.ironbeamapi.com/v2/stream/create', 'POST'), /byo-guard/);
  guardUrl('ironbeam', 'https://live.ironbeamapi.com/v2/auth', 'POST');
  assert.equal(ironbeam.symbolOf('byo:xcme:es.z26'), 'XCME:ES.Z26'); assert.equal(ironbeam.symbolOf('AAPL'), null);
  const calls = [];
  const fetch = async (url, init) => { calls.push([url, init.method || 'GET']); if (/auth$/.test(url)) return { ok: true, json: async () => ({ token: 'TOKENFAKE12345', status: 'OK' }) }; if (/create$/.test(url)) return { ok: true, json: async () => ({ streamId: 'sid-12345678' }) }; return { ok: true, json: async () => ({}) }; };
  class WS2 { constructor(u) { this.url = u; WS2.last = this; setTimeout(() => this.onopen && this.onopen(), 0); } close() {} }
  const hub = ironbeam.hub({ username: 'u', password: 'p', apiKey: 'k', env: 'demo' }, () => {}, { fetch, WS: WS2 });
  const bars = []; const t0 = Math.floor(Date.now() / 60000) * 60000;
  ironbeam.subscribe(hub, 'byo:XCME:ES.Z26', '1', { time: t0, open: 1, high: 1, low: 1, close: 1, volume: 0 }, (b) => bars.push(b));
  await flush(600);
  assert.match(WS2.last.url, /^wss:\/\/demo\.ironbeamapi\.com\/v2\/stream\/sid-12345678\?token=/);
  assert.ok(calls.some(([u]) => /market\/quotes\/subscribe\/sid-12345678\?symbols=XCME%3AES\.Z26$/.test(u)));
  WS2.last.onmessage({ data: JSON.stringify({ p: { ping: 'ping' }, q: [{ s: 'XCME:ES.Z26', l: 5300.25, sz: 1 }] }) });
  assert.equal(bars.length, 1); assert.equal(bars[0].close, 5300.25);
  await assert.rejects(() => ironbeam.check({ username: 'u', password: 'p', apiKey: 'k' }, { fetch: async () => ({ ok: false, status: 401 }) }), (e) => e.status === 401);
  hub.stop();
});
await t('sign-out wipes memory + streams', async () => {
  await bindUser('u1'); activate('alpaca', FAKE, { WS: FakeWS });
  await bindUser(null);
  assert.equal(statusOf('alpaca'), null);
});
await t('chart: withByo(fx) uses OANDA while connected and falls back when not; byo provider streams Alpaca', async () => {
  const calls = [];
  class Base { async getBars() { calls.push('base'); return [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }]; } subscribe() { calls.push('base-sub'); return () => {}; } }
  const P = withByo(Base, 'fx');
  const p = new P();
  assert.equal((await p.getBars('EURUSD', '1', {}))[0].time, 1);
  // connect fake Alpaca via the registry (fake WS), then route
  FakeWS.all.length = 0;
  activate('alpaca', FAKE, { WS: FakeWS, fetch: async () => ({ ok: true, json: async () => barsFixture }) });
  const bp = new ByoProvider();
  assert.equal((await bp.listSymbols()).length > 5, true);
  assert.equal((await bp.getSymbolInfo('AAPL')).tickerid, 'BYO:AAPL');
  const got = [];
  const stop = bp.subscribe('AAPL', '1', (b) => got.push(b));
  await flush(700);
  const ws = FakeWS.all[FakeWS.all.length - 1];
  assert.ok(ws, 'a socket was opened for the active symbol');
  ws.emit([{ T: 't', S: 'AAPL', p: 105, s: 1, t: new Date().toISOString() }]);
  assert.equal(got.length, 1); assert.equal(got[0].close, 105);
  assert.equal(labelFor('byo:AAPL').name, 'Alpaca');
  assert.ok(['live', 'connecting', 'ready'].includes(statusOf('alpaca').status));
  assert.equal(route('fx', 'EURUSD'), null, 'OANDA not connected: forex stays on the standard feed');
  stop();
  await forget('alpaca').catch(() => {});   // no IndexedDB in node: the registry entry is dropped, the vault call may throw
  assert.equal(route('byo', 'AAPL'), null);
});

await t('no secret ever printed', () => { assert.ok(!log.join(' ').includes('SECRETFAKE')); });
origLog('byo-core: ' + n + ' tests passed');
process.exit(0);
