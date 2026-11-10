// Dhan data source tests: packet decoder vs the OFFICIAL DhanHQ-py output, allow-list refusals, pass-through + partner + master functions, symbols, bars, live socket, no-order-words check.
// No real keys, no network. Run: node tools/tests/dhan.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto as C } from 'node:crypto';
import { decodePacket, decodeFrame, SEG_CODE } from '../../assets/dhan-feed.js';
import { guardUrl, guardWs, guardWsMessage, ADAPTERS, SOURCES } from '../../assets/byo-core.js?v=953';
import * as dh from '../../assets/byo-dhan.js?v=953';
import { handle as dataH, clean } from '../../functions/connect/dhan/data.js';
import { handle as keyH, ALLOWED } from '../../functions/connect/dhan/key.js';
import { handle as tokH } from '../../functions/connect/dhan/token.js';
import { handle as mastH, pick } from '../../functions/connect/dhan/master.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const hex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

// ---------- decoder vs official ----------
const FIX = JSON.parse(read('tools/tests/fixtures/dhan/packets.json'));
const near = (a, b) => assert.ok(Math.abs(a - Number(b)) < 0.0051, a + ' vs ' + b);
const hms = (s) => new Date(s * 1000).toISOString().slice(11, 19);
for (const f of FIX) await t('decoder matches official marketfeed.py: ' + f.name, () => {
  const o = f.official, p = decodePacket(hex(f.hex));
  if (o.type === 'disconnect') { assert.equal(p.type, 'disconnect'); assert.equal(p.code, o.code); assert.ok(p.message); return; }
  if (o === 'Markets Open') { assert.equal(p.type, 'status'); return; }
  assert.equal(p.seg, o.exchange_segment); assert.equal(p.id, o.security_id);
  const D = (a, b) => a.forEach((x, i) => { assert.equal(x.bidQty, b[i].bid_quantity); assert.equal(x.askQty, b[i].ask_quantity); assert.equal(x.bidOrders, b[i].bid_orders); assert.equal(x.askOrders, b[i].ask_orders); near(x.bidPrice, b[i].bid_price); near(x.askPrice, b[i].ask_price); });
  if (o.type === 'Ticker Data') { assert.equal(p.type, 'ticker'); near(p.ltp, o.LTP); assert.equal(hms(p.ltt), o.LTT); }
  else if (o.type === 'Previous Close') { assert.equal(p.type, 'prevClose'); near(p.prevClose, o.prev_close); assert.equal(p.prevOI, o.prev_OI); }
  else if (o.type === 'OI Data') { assert.equal(p.type, 'oi'); assert.equal(p.oi, o.OI); }
  else if (o.type === 'Market Depth') { assert.equal(p.type, 'depth'); near(p.ltp, o.LTP); D(p.depth, o.depth); }
  else {
    assert.equal(p.type, o.type === 'Quote Data' ? 'quote' : 'full'); near(p.ltp, o.LTP); assert.equal(p.ltq, o.LTQ); assert.equal(hms(p.ltt), o.LTT); near(p.avgPrice, o.avg_price);
    assert.equal(p.volume, o.volume); assert.equal(p.sellQty, o.total_sell_quantity); assert.equal(p.buyQty, o.total_buy_quantity);
    near(p.open, o.open); near(p.close, o.close); near(p.high, o.high); near(p.low, o.low);
    if (p.type === 'full') { assert.equal(p.oi, o.OI); assert.equal(p.oiHigh, o.oi_day_high); assert.equal(p.oiLow, o.oi_day_low); D(p.depth, o.depth); }
  }
});
await t('decoder: segments named, short / unknown / empty packets give null and never throw, joined packets split', () => {
  const tk = FIX.find((f) => f.name === 'ticker NSE_EQ'), q = FIX.find((f) => f.name === 'quote MCX_COMM');
  assert.equal(decodePacket(hex(tk.hex)).segment, 'NSE_EQ'); assert.equal(decodePacket(hex(q.hex)).segment, 'MCX_COMM');
  assert.equal(decodePacket(new Uint8Array(0)), null); assert.equal(decodePacket(hex(tk.hex).subarray(0, 15)), null); assert.equal(decodePacket(hex('63' + '00'.repeat(20))), null);
  for (const f of FIX) for (let i = 0; i < hex(f.hex).length; i++) assert.doesNotThrow(() => decodePacket(hex(f.hex).subarray(0, i)));
  const two = new Uint8Array([...hex(tk.hex), ...hex(q.hex)]); assert.deepEqual(decodeFrame(two).map((p) => p.type), ['ticker', 'quote']);
  assert.deepEqual(decodeFrame(new Uint8Array([...hex(tk.hex), 99, 1, 2])).map((p) => p.type), ['ticker']);
  assert.equal(decodeFrame(hex(tk.hex).buffer.slice(0)).length, 1, 'ArrayBuffer input');
  assert.deepEqual(SEG_CODE, { IDX_I: 0, NSE_EQ: 1, NSE_FNO: 2, NSE_CURRENCY: 3, BSE_EQ: 4, MCX_COMM: 5, BSE_CURRENCY: 7, BSE_FNO: 8 });
});

// ---------- allow-list ----------
const T = (src, u, m) => assert.throws(() => guardUrl(src, u, m), /byo-guard/, (m || 'GET') + ' ' + u);
globalThis.location = { hostname: 'tradezoro.com', origin: 'https://tradezoro.com', port: '' };
await t('dhan allow-list: only our two functions pass (data = POST, master = GET)', () => {
  assert.equal(typeof guardUrl('dhan', 'https://tradezoro.com/connect/dhan/data', 'POST'), 'string');
  assert.equal(typeof guardUrl('dhan', 'https://tradezoro.com/connect/dhan/master?seg=NSE_EQ'), 'string');
  T('dhan', 'https://tradezoro.com/connect/dhan/master', 'POST');
});
const DHAN_REFUSED = { 'place order': '/v2/orders', 'order slice': '/v2/orders/slicing', 'modify order': '/v2/orders/123', 'order book': '/v2/orders/list', 'trades': '/v2/trades', 'super order': '/v2/super/orders', 'forever order': '/v2/forever/orders',
  'conditional trigger': '/v2/alerts/orders', 'positions': '/v2/positions', 'convert position': '/v2/positions/convert', 'holdings': '/v2/holdings', 'funds': '/v2/fundlimit', 'margin calculator': '/v2/margincalculator', 'profile': '/v2/profile',
  'ledger': '/v2/ledger', 'trade history': '/v2/trades/2026-01-01/2026-02-01/0', 'kill switch': '/v2/killswitch', 'static IP': '/v2/ip/setIP', 'renew token': '/v2/RenewToken', 'EDIS': '/v2/edis/tpin',
  'historical direct': '/v2/charts/historical', 'intraday direct': '/v2/charts/intraday', 'market quote': '/v2/marketfeed/ltp', 'option chain': '/v2/optionchain', 'instrument file': '/v2/instrument/NSE_EQ' };
for (const [name, p] of Object.entries(DHAN_REFUSED)) await t('dhan refuses ' + name + ' ' + p, () => { for (const m of ['GET', 'POST']) { T('dhan', 'https://api.dhan.co' + p, m); T('dhan', 'https://tradezoro.com' + p, m); } });
await t('dhan refuses sneaks: auth host, other hosts, http, port, userinfo, encoded path, extra path, orders hidden next to our paths', () => {
  T('dhan', 'https://auth.dhan.co/app/generateAccessToken', 'POST'); T('dhan', 'https://auth.dhan.co/app/consumeApp-consent'); T('dhan', 'https://evil.example.com/connect/dhan/data', 'POST');
  T('dhan', 'http://tradezoro.com/connect/dhan/data', 'POST'); T('dhan', 'https://tradezoro.com:8443/connect/dhan/data', 'POST'); T('dhan', 'https://u:p@tradezoro.com/connect/dhan/data', 'POST');
  T('dhan', 'https://tradezoro.com/connect/dhan/%64ata', 'POST'); T('dhan', 'https://tradezoro.com/connect/dhan/data/../token', 'POST'); T('dhan', 'https://tradezoro.com/connect/dhan/token', 'POST');
  T('dhan', 'https://tradezoro.com/connect/dhan/data/orders', 'POST'); T('dhan', 'https://tradezoro.com//connect/dhan/data', 'POST'); T('dhan', 'https://tradezoro.com/connect/alpaca/token', 'POST'); T('nope', 'https://tradezoro.com/connect/dhan/data', 'POST');
});
await t('dhan socket: only the feed host with the right query; only ticker (15) / quote (17) subscribe messages with sane instruments', () => {
  const tok = 'a'.repeat(30) + '.' + 'b'.repeat(30), U = `wss://api-feed.dhan.co?version=2&token=${tok}&clientId=1000000001&authType=2`;
  assert.equal(guardWs('dhan', U), U);
  for (const bad of ['wss://evil.example.com?version=2&token=' + tok + '&clientId=1000000001&authType=2', 'ws://api-feed.dhan.co?version=2&token=' + tok + '&clientId=1000000001&authType=2',
    'wss://api-feed.dhan.co.evil.com?version=2&token=' + tok + '&clientId=1000000001&authType=2', 'wss://api-full-feed.dhan.co?version=2&token=' + tok + '&clientId=1000000001&authType=2',   // 20-level depth feed: not used
    'wss://api-order-update.dhan.co', 'wss://api-feed.dhan.co/x?version=2&token=' + tok + '&clientId=1000000001&authType=2', `wss://api-feed.dhan.co?version=2&token=${tok}&clientId=abc&authType=2`, 'wss://api-feed.dhan.co?version=2&token=short&clientId=1&authType=2'])
    assert.throws(() => guardWs('dhan', bad), /byo-guard/, bad.slice(0, 60));
  const ok = (code, list) => guardWsMessage('dhan', { RequestCode: code, InstrumentCount: list.length, InstrumentList: list });
  assert.ok(ok(17, [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }])); assert.ok(ok(15, [{ ExchangeSegment: 'IDX_I', SecurityId: '13' }, { ExchangeSegment: 'MCX_COMM', SecurityId: '495213' }]));
  for (const bad of [() => ok(21, [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }]), () => ok(19, [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }]), () => guardWsMessage('dhan', { RequestCode: 12 }), () => guardWsMessage('dhan', { RequestCode: 16, InstrumentCount: 1, InstrumentList: [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }] }),
    () => ok(17, []), () => ok(17, new Array(101).fill({ ExchangeSegment: 'NSE_EQ', SecurityId: '1' })), () => ok(17, [{ ExchangeSegment: 'NSE_CURRENCY', SecurityId: '1' }]), () => ok(17, [{ ExchangeSegment: 'NSE_EQ', SecurityId: '../x' }]),
    () => guardWsMessage('dhan', { RequestCode: 17, InstrumentCount: 2, InstrumentList: [{ ExchangeSegment: 'NSE_EQ', SecurityId: '1' }] }), () => guardWsMessage('dhan', { action: 'place_order' }), () => guardWsMessage('dhan', 'not json'), () => guardWsMessage('dhan', {})])
    assert.throws(bad, /byo-guard/);
});

// ---------- functions ----------
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const kp = await C.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await C.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const now = Math.floor(Date.now() / 1000), h0 = b({ alg: 'RS256', kid: 'k1' }), pl = b({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'u1', iat: now, exp: now + 600 });
const good = h0 + '.' + pl + '.' + Buffer.from(await C.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(h0 + '.' + pl))).toString('base64url');
const verifyFetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=300' } });
const TOK = 'eyJTESTTOKENFAKE' + 'x'.repeat(30), PARTNER = { DHAN_PARTNER_ID: 'PID123456', DHAN_PARTNER_SECRET: 'PSECRETFAKE-abc' };
const req = (path, o = {}) => new Request('https://tradezoro.com/connect/dhan/' + path + (o.q || ''), { method: o.method || 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + good, 'x-dhan-token': TOK, ...(o.h || {}) }, body: o.method === 'GET' ? undefined : o.body != null ? o.body : JSON.stringify(o.json || {}) });
const DAILY = { kind: 'daily', securityId: '13', exchangeSegment: 'IDX_I', instrument: 'INDEX', fromDate: '2026-10-01', toDate: '2026-11-04' };
const INTRA = { kind: 'intraday', securityId: '2885', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY', interval: 5, fromDate: '2026-11-02 00:00:00', toDate: '2026-11-04 00:00:00' };
await t('history pass-through: checks, forwards ONLY the two chart calls with the user token, replies prices only, stores/logs nothing', async () => {
  let up = null; const fetchImpl = async (u, o) => { up = { u, o }; return new Response(JSON.stringify({ open: [1], high: [2], low: [0.5], close: [1.5], volume: [10], timestamp: [1762167600], open_interest: [5], dhanClientName: 'LEAK', accessToken: 'LEAK' })); };
  const call = (r, env = {}) => dataH(r, env, { verifyFetch, fetchImpl });
  assert.equal((await call(req('data', { method: 'GET' }))).status, 404); assert.equal((await call(req('data', { method: 'PUT' }))).status, 405);
  assert.equal((await call(req('data', { json: DAILY, h: { origin: 'https://evil.example.com' } }))).status, 403); assert.equal((await call(req('data', { json: DAILY, h: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await call(req('data', { json: DAILY, h: { authorization: '' } }))).status, 401); assert.equal((await call(req('data', { json: DAILY, h: { 'x-dhan-token': '' } }))).status, 400);
  assert.equal((await call(req('data', { json: DAILY, h: { 'x-dhan-token': 'bad token!' } }))).status, 400);
  for (const bad of [{ ...DAILY, kind: 'orders' }, { ...DAILY, securityId: 'abc' }, { ...DAILY, exchangeSegment: 'NSE_CURRENCY' }, { ...DAILY, instrument: 'OPTIDX' }, { ...DAILY, fromDate: '2026-10-01 00:00:00' }, { ...INTRA, interval: 3 }, { ...INTRA, fromDate: '2026-11-02' }, { kind: 'daily' }, null])
    assert.equal((await call(req('data', { json: bad }))).status, 400, JSON.stringify(bad));
  assert.equal(up, null, 'nothing went upstream on a bad call');
  const r = await call(req('data', { json: DAILY })); const j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(j), ['open', 'high', 'low', 'close', 'volume', 'timestamp']); assert.equal(up.u, 'https://api.dhan.co/v2/charts/historical'); assert.equal(up.o.method, 'POST'); assert.equal(up.o.redirect, 'error'); assert.equal(up.o.headers['access-token'], TOK);
  assert.deepEqual(JSON.parse(up.o.body), { securityId: '13', exchangeSegment: 'IDX_I', instrument: 'INDEX', expiryCode: 0, oi: false, fromDate: '2026-10-01', toDate: '2026-11-04' });
  await call(req('data', { json: { ...INTRA, extra: 'x', oi: true } })); assert.equal(up.u, 'https://api.dhan.co/v2/charts/intraday'); assert.deepEqual(JSON.parse(up.o.body), { securityId: '2885', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY', interval: '5', oi: false, fromDate: '2026-11-02 00:00:00', toDate: '2026-11-04 00:00:00' });
  assert.equal((await call(req('data', { json: DAILY }), {})).status, 200, 'no secret needed: the member brings their own token');
  const logs = []; const o = [console.log, console.error, console.warn]; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  const run = async (fi) => (await dataH(req('data', { json: DAILY }), {}, { verifyFetch, fetchImpl: fi })).status;
  const s401 = await run(async () => new Response(JSON.stringify({ errorCode: 'DH-901' }), { status: 401 })), s902 = await run(async () => new Response(JSON.stringify({ errorCode: 'DH-902' }), { status: 400 })), s904 = await run(async () => new Response('{}', { status: 429 })), s500 = await run(async () => new Response('x', { status: 500 })), sx = await run(async () => { throw new Error('boom ' + TOK); });
  [console.log, console.error, console.warn] = o;
  assert.deepEqual([s401, s902, s904, s500, sx], [401, 402, 429, 502, 502]); assert.ok(!logs.join('').includes(TOK));
  const bad = await dataH(req('data', { json: DAILY }), {}, { verifyFetch, fetchImpl: async () => new Response(JSON.stringify({ errorMessage: TOK }), { status: 400 }) }); assert.ok(!(await bad.text()).includes(TOK));
  assert.ok(clean(DAILY) && !clean({ ...DAILY, securityId: '1; DROP' }));
});
await t('partner function: probe false until both secrets exist; consent steps; trimmed reply; nothing sent on a bad call', async () => {
  let ups = []; const fetchImpl = async (u, o) => { ups.push({ u, o }); return new Response(JSON.stringify(u.includes('generate-consent') ? { consentId: 'ab5aaab6-38cb-41fc-a074-c816e2f9a3e0', consentStatus: 'GENERATED' } : { dhanClientId: '1000000001', dhanClientName: 'JOHN DOE', dhanClientUcc: 'ABCD', givenPowerOfAttorney: true, accessToken: TOK, expiryTime: '2026-11-05T12:37:23' })); };
  const call = (r, env = PARTNER) => tokH(r, env, { verifyFetch, fetchImpl });
  const pr = (env) => call(new Request('https://tradezoro.com/connect/dhan/token?probe=1'), env);
  assert.deepEqual(await (await pr(PARTNER)).json(), { configured: true });
  for (const env of [{}, { DHAN_PARTNER_ID: 'x' }, { DHAN_PARTNER_SECRET: 'x' }]) { const r = await pr(env); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { configured: false }); }
  assert.equal((await call(new Request('https://tradezoro.com/connect/dhan/token'))).status, 404);
  const post = (o) => call(req('token', o)); assert.equal((await post({ json: { grant: 'start' } }, {})).status, 200);
  ups = [];
  assert.equal((await call(req('token', { json: { grant: 'start' } }), {})).status, 503); assert.equal((await post({ json: { grant: 'start' }, h: { origin: 'https://evil.example.com' } })).status, 403);
  assert.equal((await post({ json: { grant: 'start' }, h: { authorization: '' } })).status, 401); assert.equal((await post({ json: { grant: 'x' } })).status, 400); assert.equal((await post({ json: { grant: 'code', code: 'bad code' } })).status, 400);
  assert.equal(ups.length, 0);
  const s = await (await post({ json: { grant: 'start' } })).json();
  assert.deepEqual(s, { url: 'https://auth.dhan.co/consent-login?consentId=ab5aaab6-38cb-41fc-a074-c816e2f9a3e0' }); assert.equal(ups[0].u, 'https://auth.dhan.co/partner/generate-consent'); assert.equal(ups[0].o.method, 'POST'); assert.equal(ups[0].o.headers.partner_id, 'PID123456'); assert.equal(ups[0].o.headers.partner_secret, 'PSECRETFAKE-abc');
  const c = await (await post({ json: { grant: 'code', code: 'tokenid-1234567' } })).json();
  assert.deepEqual(Object.keys(c).sort(), ['access_token', 'client_id', 'expires_at']); assert.equal(c.access_token, TOK); assert.equal(c.client_id, '1000000001'); assert.equal(c.expires_at, Date.parse('2026-11-05T12:37:23+05:30'));
  assert.equal(ups[1].u, 'https://auth.dhan.co/partner/consume-consent?tokenId=tokenid-1234567'); assert.ok(!JSON.stringify(c).match(/JOHN|ABCD|PSECRET/));
  const bad = await tokH(req('token', { json: { grant: 'code', code: 'tokenid-1234567' } }), PARTNER, { verifyFetch, fetchImpl: async () => new Response(JSON.stringify({ message: 'PSECRETFAKE-abc' }), { status: 400 }) }); assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('PSECRET'));
  assert.equal((await tokH(req('token', { json: { grant: 'start' } }), PARTNER, { verifyFetch, fetchImpl: async () => { throw new Error('x'); } })).status, 502);
});
await t('symbol-list function: keeps stocks, indexes, futures only; quote-aware CSV; refuses unknown segments', async () => {
  const H = 'EXCH_ID,SEGMENT,SECURITY_ID,ISIN,INSTRUMENT,UNDERLYING_SECURITY_ID,UNDERLYING_SYMBOL,SYMBOL_NAME,DISPLAY_NAME,INSTRUMENT_TYPE,SERIES,LOT_SIZE,SM_EXPIRY_DATE';
  const eq = [H, 'NSE,E,2885,INE002A01018,EQUITY,,RELIANCE,RELIANCE INDUSTRIES LTD,"Reliance, Industries",ES,EQ,1.0,', 'NSE,E,10097,X,EQUITY,,SGBJUN30,SGB,SGB,GB,GB,1.0,', 'NSE,E,100,X,EQUITY,,ARE&M,A,B,ES,EQ,1.0,'].join('\n');
  assert.deepEqual(pick('NSE_EQ', eq), [[2885, 'RELIANCE', 'EQUITY', '', 'NSE'], [100, 'ARE&M', 'EQUITY', '', 'NSE']]);
  const fo = [H, 'NSE,D,54749,NA,FUTIDX,26000,NIFTY,N,N,FUT,NA,75.0,2027-01-25', 'NSE,D,1,NA,OPTIDX,26000,NIFTY,N,N,OP,NA,75.0,2027-01-25', 'NSE,D,2,NA,FUTSTK,2885,RELIANCE,N,N,FUT,NA,500,2026-11-24'].join('\n');
  assert.deepEqual(pick('NSE_FNO', fo), [[54749, 'NIFTY', 'FUTIDX', '2027-01-25', 'NSE'], [2, 'RELIANCE', 'FUTSTK', '2026-11-24', 'NSE']]);
  assert.equal(pick('IDX_I', [H, 'NSE,I,13,NA,INDEX,13,NIFTY,N,N,INDEX,NA,1.0,0001-01-01'].join('\n'))[0][1], 'NIFTY'); assert.equal(pick('NSE_EQ', 'a,b\n1,2'), null);
  const get = (q, fi) => mastH(new Request('https://tradezoro.com/connect/dhan/master' + q), {}, { fetchImpl: fi || (async () => new Response(eq)) });
  assert.equal((await get('?seg=NSE_CURRENCY')).status, 400); assert.equal((await get('')).status, 400); assert.equal((await get('?seg=../x')).status, 400);
  const r = await get('?seg=NSE_EQ'); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /max-age=21600/); assert.equal((await r.json()).length, 2);
  assert.equal((await get('?seg=NSE_EQ', async () => new Response('x', { status: 500 }))).status, 502); assert.equal((await mastH(new Request('https://tradezoro.com/connect/dhan/master?seg=NSE_EQ', { method: 'POST' }), {}, {})).status, 405);
});

// ---------- symbols, bars, live ----------
const ROWS = { IDX_I: [[13, 'NIFTY', 'INDEX', '', 'NSE'], [25, 'BANKNIFTY', 'INDEX', '', 'NSE'], [51, 'SENSEX', 'INDEX', '', 'BSE'], [21, 'INDIA VIX', 'INDEX', '', 'NSE']], NSE_EQ: [[2885, 'RELIANCE', 'EQUITY', '', 'NSE']], BSE_EQ: [[500325, 'RELIANCE', 'EQUITY', '', 'BSE']],
  NSE_FNO: [[61466, 'NIFTY', 'FUTIDX', '2026-11-24', 'NSE'], [58875, 'NIFTY', 'FUTIDX', '2026-12-29', 'NSE'], [1, 'NIFTY', 'FUTIDX', '2026-10-27', 'NSE'], [61697, 'RELIANCE', 'FUTSTK', '2026-11-24', 'NSE']], MCX_COMM: [[495213, 'GOLD', 'FUTCOM', '2026-12-04', 'MCX'], [569424, 'GOLD', 'FUTCOM', '2027-04-05', 'MCX']] };
const NOW = Date.parse('2026-11-04T06:00:00Z');
const mfetch = (log = []) => async (u, o) => { u = String(u); log.push({ u, o }); const m = /master\?seg=(\w+)/.exec(u); if (m) return new Response(JSON.stringify(ROWS[m[1]])); throw new Error('unexpected ' + u); };
await t('symbols: chart tickers accepted / refused, BSE added', () => {
  const S = dh.symbolOf;
  assert.equal(S('byo:NSE:RELIANCE-EQ'), 'NSE:RELIANCE-EQ'); assert.equal(S('byo:NSE:NIFTY-INDEX'), 'NSE:NIFTY50-INDEX'); assert.equal(S('byo:NSE:BANKNIFTY-INDEX'), 'NSE:NIFTYBANK-INDEX'); assert.equal(S('NSE:NIFTY1!'), 'NSE:NIFTY1!');
  assert.equal(S('byo:MCX:GOLD1!'), 'MCX:GOLD1!'); assert.equal(S('byo:BSE:RELIANCE-EQ'), 'BSE:RELIANCE-EQ'); assert.equal(S('byo:BSE:RELIANCE'), 'BSE:RELIANCE-EQ'); assert.equal(S('byo:BSE:SENSEX-INDEX'), 'BSE:SENSEX-INDEX'); assert.equal(S('byo:NSE:NIFTY26NOVFUT'), 'NSE:NIFTY26NOVFUT');
  for (const bad of ['AAPL', 'byo:AAPL', 'byo:NYSE:IBM', 'byo:BSE:', 'byo:BSE:A/B', 'byo:MCX:GOLD-EQ', '', null]) assert.equal(S(bad), null, String(bad));
});
await t('security-id lookup: equity, index, BSE, front month (skips expired), named month, MCX; unknown = null; list fetched once (cached)', async () => {
  const log = []; const d = { fetch: mfetch(log), now: () => NOW }; dh.resetMasters();
  assert.deepEqual(await dh.resolve('NSE:RELIANCE-EQ', d), { seg: 'NSE_EQ', id: '2885', ins: 'EQUITY' }); assert.deepEqual(await dh.resolve('BSE:RELIANCE-EQ', d), { seg: 'BSE_EQ', id: '500325', ins: 'EQUITY' });
  assert.deepEqual(await dh.resolve('NSE:NIFTY50-INDEX', d), { seg: 'IDX_I', id: '13', ins: 'INDEX' }); assert.deepEqual(await dh.resolve('NSE:NIFTYBANK-INDEX', d), { seg: 'IDX_I', id: '25', ins: 'INDEX' }); assert.deepEqual(await dh.resolve('BSE:SENSEX-INDEX', d), { seg: 'IDX_I', id: '51', ins: 'INDEX' });
  assert.deepEqual(await dh.resolve('NSE:INDIAVIX-INDEX', d), { seg: 'IDX_I', id: '21', ins: 'INDEX' });
  assert.deepEqual(await dh.resolve('NSE:NIFTY1!', d), { seg: 'NSE_FNO', id: '61466', ins: 'FUTIDX' }, 'the October contract has ended');
  assert.deepEqual(await dh.resolve('NSE:NIFTY26DECFUT', d), { seg: 'NSE_FNO', id: '58875', ins: 'FUTIDX' }); assert.equal(await dh.resolve('NSE:NIFTY27MARFUT', d), null);
  assert.deepEqual(await dh.resolve('MCX:GOLD1!', d), { seg: 'MCX_COMM', id: '495213', ins: 'FUTCOM' }); assert.deepEqual(await dh.resolve('NSE:RELIANCE1!', d), { seg: 'NSE_FNO', id: '61697', ins: 'FUTSTK' });
  assert.equal(await dh.resolve('NSE:NOPE-EQ', d), null);
  const segs = log.map((x) => x.u.split('seg=')[1]); assert.equal(new Set(segs).size, segs.length, 'each list once: ' + segs);
  assert.ok(log.every((x) => x.u.startsWith('https://tradezoro.com/connect/dhan/master?seg=')), 'the browser only asks our own function');
});
const candles = (n, t0, step) => ({ open: Array.from({ length: n }, (_, i) => 100 + i), high: Array.from({ length: n }, (_, i) => 101 + i), low: Array.from({ length: n }, (_, i) => 99 + i), close: Array.from({ length: n }, (_, i) => 100.5 + i), volume: Array.from({ length: n }, () => 10), timestamp: Array.from({ length: n }, (_, i) => t0 + i * step) });
const bars = async (tf, body, creds = { clientId: '1000000001', access: TOK, exp: NOW + 36e5 }) => {
  const log = []; const d = { now: () => NOW, idToken: async () => 'IDT', fetch: async (u, o) => { u = String(u); if (u.includes('/master')) return mfetch(log)(u, o); log.push({ u, o, body: JSON.parse(o.body) }); return new Response(JSON.stringify(body)); } };
  dh.resetMasters(); const out = await dh.dhan.getBars(creds, 'byo:NSE:RELIANCE-EQ', tf, { limit: 500 }, d); return { out, log: log.filter((x) => x.body) };
};
await t('history: daily goes to the pass-through with the user token + our sign-in, bars oldest first; no call after the token ended', async () => {
  const t0 = Date.parse('2026-10-01T00:00:00+05:30') / 1000, { out, log } = await bars('D', candles(5, t0, 86400));
  assert.equal(out.length, 5); assert.equal(out[0].time, t0 * 1000); assert.deepEqual(Object.keys(out[0]), ['time', 'open', 'high', 'low', 'close', 'volume']); assert.ok(out.every((x, i) => !i || x.time > out[i - 1].time));
  const c = log[0]; assert.equal(c.u, 'https://tradezoro.com/connect/dhan/data'); assert.equal(c.o.headers['x-dhan-token'], TOK); assert.equal(c.o.headers.Authorization, 'Bearer IDT'); assert.equal(c.body.kind, 'daily'); assert.equal(c.body.exchangeSegment, 'NSE_EQ'); assert.equal(c.body.securityId, '2885');
  await assert.rejects(() => bars('D', candles(1, t0, 1), { clientId: '1', access: TOK, exp: NOW - 1 }), (e) => e.reconnect === true);
});
await t('history: minutes use the intraday call; 30 / 120 / 240-minute bars are built from 15 / 60-minute candles; week and month from days', async () => {
  const day = Date.parse('2026-11-03T09:15:00+05:30') / 1000;
  let r = await bars('5', candles(3, day, 300)); assert.equal(r.log[0].body.kind, 'intraday'); assert.equal(r.log[0].body.interval, 5); assert.equal(r.out.length, 3);
  r = await bars('30', candles(4, day, 900)); assert.equal(r.log[0].body.interval, 15); assert.equal(r.out.length, 2); assert.equal(r.out[0].open, 100); assert.equal(r.out[0].close, 101.5); assert.equal(r.out[0].high, 102); assert.equal(r.out[0].low, 99); assert.equal(r.out[0].volume, 20);
  r = await bars('240', candles(6, day, 3600)); assert.equal(r.log[0].body.interval, 60); assert.equal(r.out.length, 2); assert.equal(r.out[0].volume, 40);
  const w = Date.parse('2026-10-26T00:00:00+05:30') / 1000;   // a Monday
  r = await bars('W', candles(10, w, 86400)); assert.equal(r.log[0].body.kind, 'daily'); assert.equal(r.out.length, 2); assert.equal(r.out[0].volume, 70);
  r = await bars('M', candles(10, Date.parse('2026-10-26T00:00:00+05:30') / 1000, 86400)); assert.equal(r.out.length, 2);
  assert.deepEqual((await bars('1', { open: [], high: [], low: [], close: [], volume: [], timestamp: [] })).out, []);
});
await t('connect check: needs a numeric Client ID and a token-shaped string; one harmless price call; 24-hour end time set; Data-plan and bad-token messages', async () => {
  const mk = (st, body) => ({ now: () => NOW, idToken: async () => 'IDT', fetch: async () => new Response(JSON.stringify(body || candles(1, 1, 1)), { status: st }) });
  await assert.rejects(() => dh.dhan.check({ clientId: 'abc', token: TOK }, mk(200)), /Client ID/); await assert.rejects(() => dh.dhan.check({ clientId: '1000000001', token: 'short' }, mk(200)), /access token/);
  const c = { clientId: ' 1000000001 ', token: TOK }; await dh.dhan.check(c, mk(200)); assert.equal(c.clientId, '1000000001'); assert.equal(c.access, TOK); assert.equal(c.token, undefined); assert.equal(c.exp, NOW + 24 * 36e5); assert.equal(c.expires, true);
  const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(NOW / 1000) + 3600 })).toString('base64url') + '.s'; assert.equal(dh.jwtExp(jwt), (Math.floor(NOW / 1000) + 3600) * 1000); assert.equal(dh.jwtExp('nope'), 0);
  const e1 = await dh.dhan.check({ clientId: '1000000001', token: TOK }, mk(402, { error: 'x' })).catch((e) => e); assert.match(e1.message, /Data plan/); assert.equal(e1.show, true);
  const e2 = await dh.dhan.check({ clientId: '1000000001', token: TOK }, { ...mk(401), fetch: async () => new Response(JSON.stringify({ error: 'Dhan did not accept this token' }), { status: 401 }) }).catch((e) => e); assert.match(e2.message, /did not accept/); assert.equal(e2.show, true);
  assert.equal(ADAPTERS.dhan, dh.dhan);
});
await t('live feed: opens only the guarded feed address, sends ONE quote subscribe, ticks reach the candle; ends say Reconnect (token) or no Data plan', async () => {
  const sent = []; let opened = null, inst = null;
  class WS { constructor(u) { opened = u; inst = this; setTimeout(() => { this.onopen && this.onopen(); }, 5); } send(m) { sent.push(m); setTimeout(() => this.onmessage({ data: hex(FIX.find((f) => f.name === 'quote NSE_FNO').hex).buffer }), 5); } close() {} }
  const d = { WS, now: () => NOW, fetch: mfetch() }; dh.resetMasters();
  const hub = dh.dhan.hub({ clientId: '1000000001', access: TOK, exp: NOW + 36e5 }, () => {}, d), got = [];
  const stop = dh.dhan.subscribe(hub, 'byo:NSE:NIFTY-INDEX', '1', null, (bar) => got.push(bar.close)); await new Promise((r) => setTimeout(r, 900)); stop(); hub.stop();
  assert.equal(opened, `wss://api-feed.dhan.co?version=2&token=${TOK}&clientId=1000000001&authType=2`); assert.equal(sent.length, 1); assert.deepEqual(JSON.parse(sent[0]), { RequestCode: 17, InstrumentCount: 1, InstrumentList: [{ ExchangeSegment: 'IDX_I', SecurityId: '13' }] });
  assert.equal(got.length, 0, 'the fixture quote is for another security id (54749): ignored'); void inst;
  const sent2 = []; let ws2; class WS2 { constructor() { ws2 = this; setTimeout(() => this.onopen(), 5); } send(m) { sent2.push(m); setTimeout(() => this.onmessage({ data: hex(FIX.find((f) => f.name === 'ticker IDX_I').hex).buffer }), 5); } close() {} }
  const hub2 = dh.dhan.hub({ clientId: '1000000001', access: TOK, exp: NOW + 36e5 }, () => {}, { WS: WS2, now: () => NOW, fetch: mfetch() }), got2 = [];
  const stop2 = dh.dhan.subscribe(hub2, 'byo:NSE:NIFTY-INDEX', '1', null, (bar) => got2.push(bar.close)); await new Promise((r) => setTimeout(r, 900)); stop2(); hub2.stop(); assert.ok(got2.includes(24500.25), JSON.stringify(got2)); void ws2;
  const end = async (code) => { const st = []; class W3 { constructor() { setTimeout(() => { this.onopen(); }, 5); } send() { setTimeout(() => this.onmessage({ data: new Uint8Array([50, 10, 0, 0, 0, 0, 0, 0, code & 255, code >> 8]).buffer }), 5); } close() {} }
    const h = dh.dhan.hub({ clientId: '1000000001', access: TOK, exp: NOW + 36e5 }, (s, m) => st.push([s, m]), { WS: W3, now: () => NOW, fetch: mfetch() }); const s = dh.dhan.subscribe(h, 'byo:NSE:NIFTY-INDEX', '1', null, () => {}); await new Promise((r) => setTimeout(r, 900)); s(); h.stop(); return st; };
  assert.ok((await end(807)).some(([s, m]) => s === 'error' && m === 'Reconnect Dhan')); assert.ok((await end(806)).some(([s, m]) => s === 'error' && /Data plan/.test(m)));
});
await t('partner one-tap client: start only accepts a Dhan sign-in address; finish needs the same user within 10 minutes, once', async () => {
  const mem = new Map(), store = { setItem: (k, v) => mem.set(k, v), getItem: (k) => mem.get(k) ?? null, removeItem: (k) => mem.delete(k) };
  const ok = { fetch: async (u, o) => new Response(JSON.stringify(JSON.parse(o.body).grant === 'start' ? { url: 'https://auth.dhan.co/consent-login?consentId=ab5aaab6-38cb-41fc-a074-c816e2f9a3e0' } : { access_token: TOK, client_id: '1000000001', expires_at: NOW + 1000 })), now: () => NOW };
  assert.match(await dh.dhanStart('u1', 'IDT', ok, store), /^https:\/\/auth\.dhan\.co\/consent-login\?consentId=/);
  await assert.rejects(() => dh.dhanStart('u1', 'IDT', { ...ok, fetch: async () => new Response(JSON.stringify({ url: 'https://evil.example.com/x' })) }, store), /not available/); await assert.rejects(() => dh.dhanStart('', 'IDT', ok, store));
  await dh.dhanStart('u1', 'IDT', ok, store); const c = await dh.dhanFinish('tokenid-1234567', 'u1', 'IDT', ok, store); assert.equal(c.access, TOK); assert.equal(c.clientId, '1000000001'); assert.equal(c.exp, NOW + 1000);
  await assert.rejects(() => dh.dhanFinish('tokenid-1234567', 'u1', 'IDT', ok, store), /expired/, 'once only');
  await dh.dhanStart('u1', 'IDT', ok, store); await assert.rejects(() => dh.dhanFinish('t', 'u2', 'IDT', ok, store), /expired/, 'another user');
  await dh.dhanStart('u1', 'IDT', ok, store); await assert.rejects(() => dh.dhanFinish('t', 'u1', 'IDT', { ...ok, now: () => NOW + 11 * 60000 }, store), /expired/);
  const f = async (j) => (await dh.probeDhan({ fetch: async () => new Response(JSON.stringify(j), { status: j.configured ? 200 : 503 }) })); assert.equal(await f({ configured: true }), true); assert.equal(await f({ configured: false }), false);
});
await t('card is in the list with the plain Data-plan words; real logo file exists; no vendor names on the card text', () => {
  const s = SOURCES.find((x) => x.id === 'dhan'); assert.equal(s.name, 'Dhan'); assert.equal(s.state, 'ready'); assert.equal(s.steps.length, 4); assert.match(s.feeNote, /Data plan/); assert.equal(s.fields.length, 2); assert.ok(readFileSync(new URL('../../assets/images/brokers/dhan.png', import.meta.url)).length > 1000);
  const text = [s.help, s.feeNote, s.covers, s.manage, s.noteText, ...s.steps].join(' ') + ' ' + read('assets/byo-ui.js').split('\n').filter((l) => /Dhan/.test(l)).join(' ');
  assert.ok(!/Upstox|Fyers|Alpaca|OANDA|Schwab|tastytrade|cTrader/i.test(s.help + s.feeNote + s.covers + s.manage + s.noteText + s.steps.join(' ')), 'no other vendor on the Dhan card');
});
await t('browser code never holds a partner secret, never names an order / account call, never logs; functions log nothing', () => {
  const code = ['assets/byo-dhan.js', 'assets/dhan-feed.js'].map((p) => read(p).replace(/\/\/.*$/gm, '')).join('\n');
  assert.ok(!/PARTNER_SECRET|partner_secret|app_secret|client_secret/i.test(code), 'no secret in the browser'); assert.ok(!/\/v2\/(orders|super|forever|positions|holdings|fundlimit|profile|killswitch|ip|trades|ledger|margincalculator|alerts|edis|RenewToken)|place_?order|api\.dhan\.co|auth\.dhan\.co\/(app|partner)/i.test(code), 'no order / account path in the browser');
  assert.ok(!/RequestCode:\s*(12|21|19)\b/.test(code)); assert.ok(!/console\.(log|error|warn)/.test(['functions/connect/dhan/data.js', 'functions/connect/dhan/token.js', 'functions/connect/dhan/master.js'].map(read).join('')), 'functions log nothing');
  assert.ok(/PARTNER_SECRET/.test(read('functions/connect/dhan/token.js')));
  for (const p of ['functions/connect/dhan/data.js']) assert.ok(!/\/v2\/(orders|super|forever|positions|holdings|fundlimit|profile)/.test(read(p)), 'pass-through names no order path');
});

// ---------- Mode C: own API key ----------
const KJ = (o) => ({ appId: 'appid-1234', appSecret: 'secret-APPSECRET-9', ...o });
await t('own-key function: allow-list is exactly two Dhan URLs; anything else refused', () => {
  assert.ok(ALLOWED('https://auth.dhan.co/app/generate-consent?client_id=1000000001')); assert.ok(ALLOWED('https://auth.dhan.co/app/consumeApp-consent?tokenId=abc'));
  for (const u of ['https://api.dhan.co/v2/orders', 'https://auth.dhan.co/app/generateAccessToken?pin=1', 'https://auth.dhan.co/app/RenewToken', 'https://auth.dhan.co/partner/consume-consent', 'https://auth.dhan.co/app/generate-consent/x', 'https://auth.dhan.co.evil.com/app/generate-consent', 'http://auth.dhan.co/app/generate-consent', 'https://evil.com/app/generate-consent', 'https://auth.dhan.co:444/app/generate-consent', 'https://u@auth.dhan.co/app/generate-consent', 'nonsense']) assert.ok(!ALLOWED(u), u);
});
await t('own-key function: unsigned user, wrong origin, bad body, bad method all refused with zero upstream calls', async () => {
  let ups = 0; const fetchImpl = async () => { ups++; return new Response('{}'); }; const call = (r) => keyH(r, {}, { verifyFetch, fetchImpl });
  const start = { grant: 'start', clientId: '1000000001' };
  assert.equal((await call(req('key', { json: KJ(start), h: { authorization: '' } }))).status, 401); assert.equal((await call(req('key', { json: KJ(start), h: { authorization: 'Bearer nope' } }))).status, 401);
  assert.equal((await call(req('key', { json: KJ(start), h: { origin: 'https://evil.example.com' } }))).status, 403); assert.equal((await call(req('key', { json: KJ(start), h: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await call(req('key', { method: 'GET' }))).status, 405);
  for (const b of [{ grant: 'start', clientId: '1000000001' }, KJ({ grant: 'start', clientId: 'abc' }), KJ({ grant: 'code', code: 'x y' }), KJ({ grant: 'orders', clientId: '1000000001' }), KJ({ grant: 'start', clientId: '1000000001', appId: 'bad id!' }), KJ({ grant: 'start', clientId: '1000000001', url: 'https://api.dhan.co/v2/orders' })].slice(0, 5)) assert.equal((await call(req('key', { json: b }))).status, 400, JSON.stringify(b));
  assert.equal(ups, 0);
});
await t('own-key function: step 1 and step 3 forward the member key for that call only; reply trimmed; nothing logged', async () => {
  const ups = [], logs = []; const orig = { log: console.log, error: console.error, warn: console.warn }; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  const fetchImpl = async (u, o) => { ups.push({ u, o }); return new Response(JSON.stringify(u.includes('generate-consent') ? { consentAppId: 'f1e2d3c4-aaaa-bbbb-cccc-123456789012', consentAppStatus: 'GENERATED' } : { dhanClientId: '1000000001', dhanClientName: 'JOHN DOE', dhanClientUcc: 'UCC1', givenPowerOfAttorney: true, accessToken: TOK, expiryTime: '2026-11-05T12:37:23' })); };
  const call = (b) => keyH(req('key', { json: b }), {}, { verifyFetch, fetchImpl });
  let a, c; try { a = await (await call(KJ({ grant: 'start', clientId: '1000000001' }))).json(); c = await (await call(KJ({ grant: 'code', code: 'tokenid-1234567' }))).json(); } finally { Object.assign(console, orig); }
  assert.deepEqual(a, { url: 'https://auth.dhan.co/login/consentApp-login?consentAppId=f1e2d3c4-aaaa-bbbb-cccc-123456789012' });
  assert.equal(ups[0].u, 'https://auth.dhan.co/app/generate-consent?client_id=1000000001'); assert.equal(ups[0].o.method, 'POST'); assert.equal(ups[0].o.headers.app_id, 'appid-1234'); assert.equal(ups[0].o.headers.app_secret, 'secret-APPSECRET-9');
  assert.equal(ups[1].u, 'https://auth.dhan.co/app/consumeApp-consent?tokenId=tokenid-1234567'); assert.equal(ups[1].o.method, 'GET'); assert.equal(ups[1].o.redirect, 'error');
  assert.deepEqual(Object.keys(c).sort(), ['access_token', 'client_id', 'expires_at']); assert.equal(c.expires_at, Date.parse('2026-11-05T12:37:23+05:30')); assert.ok(!JSON.stringify([a, c]).match(/JOHN|UCC1|APPSECRET/));
  assert.equal(logs.length, 0);
  const bad = await keyH(req('key', { json: KJ({ grant: 'code', code: 'tokenid-1234567' }) }), {}, { verifyFetch, fetchImpl: async () => new Response(JSON.stringify({ message: 'secret-APPSECRET-9' }), { status: 400 }) }); assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('APPSECRET'));
  assert.equal((await keyH(req('key', { json: KJ({ grant: 'start', clientId: '1000000001' }) }), {}, { verifyFetch, fetchImpl: async () => { throw new Error('x'); } })).status, 502);
});
await t('own-key function: rate limited, source has no logging and no order path', async () => {
  const src = read('functions/connect/dhan/key.js'); assert.match(src, /rateLimited\(env, request, 'dhan-key'\)/); assert.ok(!/console\./.test(src)); assert.ok(!/\/v2\//.test(src.replace(/\/\/.*$/gm, '')));
});
await t('own-key browser flow: guard allows only /connect/dhan/key; start stores a one-time state; finish swaps tokenId for a token; stale/other user/no keys refused', async () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  const KEYS = { clientId: '1000000001', appId: 'appid-1234', appSecret: 'secret-APPSECRET-9' };
  assert.ok(guardUrl('dhan', 'https://tradezoro.com/connect/dhan/key', 'POST')); assert.throws(() => guardUrl('dhan', 'https://tradezoro.com/connect/dhan/key?x=1'.replace('?x=1', '/x'), 'POST')); assert.throws(() => guardUrl('dhan', 'https://auth.dhan.co/app/generate-consent', 'POST'));
  assert.equal(dh.DHAN_REDIRECT, 'https://tradezoro.com/connect/dhan/callback'); assert.ok(dh.keyShape(KEYS)); assert.ok(!dh.keyShape({ ...KEYS, clientId: 'x' })); assert.ok(!dh.keyShape(null));
  const log = []; const fetch = async (u, o) => { log.push({ u: String(u), b: JSON.parse(o.body), o }); const g = JSON.parse(o.body).grant; return new Response(JSON.stringify(g === 'start' ? { url: 'https://auth.dhan.co/login/consentApp-login?consentAppId=f1e2d3c4-aaaa-bbbb' } : { access_token: TOK, client_id: '1000000001', expires_at: NOW + 864e5 })); };
  const d = { fetch, now: () => NOW }, st = mem();
  const url = await dh.dhanKeyStart(KEYS, 'u1', 'IDT', d, st); assert.match(url, /^https:\/\/auth\.dhan\.co\/login\/consentApp-login\?consentAppId=/);
  assert.equal(log[0].u, 'https://tradezoro.com/connect/dhan/key'); assert.equal(log[0].o.headers.Authorization, 'Bearer IDT'); assert.ok(!st.getItem('tz-dhan-state').includes('APPSECRET'), 'secret never in session storage');
  const creds = await dh.dhanKeyFinish('tokenid-1234567', KEYS, 'u1', 'IDT', d, st); assert.deepEqual(creds, { access: TOK, clientId: '1000000001', expires: true, exp: NOW + 864e5 }); assert.equal(log[1].b.code, 'tokenid-1234567');
  await assert.rejects(() => dh.dhanKeyFinish('tokenid-1234567', KEYS, 'u1', 'IDT', d, st), /expired/, 'single use');
  await dh.dhanKeyStart(KEYS, 'u1', 'IDT', d, st); await assert.rejects(() => dh.dhanKeyFinish('tokenid-1234567', KEYS, 'u2', 'IDT', d, st), /expired/);
  await dh.dhanKeyStart(KEYS, 'u1', 'IDT', d, st); await assert.rejects(() => dh.dhanKeyFinish('tokenid-1234567', KEYS, 'u1', 'IDT', { ...d, now: () => NOW + 11 * 60000 }, st), /expired/);
  await dh.dhanKeyStart(KEYS, 'u1', 'IDT', d, st); await assert.rejects(() => dh.dhanKeyFinish('tokenid-1234567', null, 'u1', 'IDT', d, st), /not saved/);
  await assert.rejects(() => dh.dhanKeyStart({ clientId: 'x' }, 'u1', 'IDT', d, st), /Client ID/); await assert.rejects(() => dh.dhanKeyStart(KEYS, '', 'IDT', d, st), /Sign in/);
  const evil = { fetch: async () => new Response(JSON.stringify({ url: 'https://evil.com/login' })) }; await assert.rejects(() => dh.dhanKeyStart(KEYS, 'u1', 'IDT', { ...evil, now: () => NOW }, st), /not available/);
  await assert.rejects(() => dh.dhanKeyStart(KEYS, 'u1', 'IDT', { fetch: async () => new Response('{}', { status: 400 }), now: () => NOW }, st), /did not accept/);
  assert.equal(srcFlag(), true);
});
function srcFlag() { return SOURCES.find((x) => x.id === 'dhan').keyLogin === true; }
console.log('ALL PASS', n); process.exit(0);
