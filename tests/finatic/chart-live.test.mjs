// Chart live orders: symbol mapping, payload building, exposure, flatten plan (pure) + the server's chart paths with a MOCKED broker.
// No real network: every fetch below is a stub. Run: node tests/finatic/chart-live.test.mjs
import assert from 'node:assert/strict';
import * as L from '../../assets/chart-live-core.js';
import * as O from '../../functions/connect/finatic/order.js';
import * as D from '../../functions/connect/finatic/data.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

const T = (s) => Date.parse(s);
// ---- symbol mapping ---------------------------------------------------------------------------------------------------
assert.equal(L.chartRoot('CME_MINI:NQ1!'), 'NQ'); assert.equal(L.chartRoot('rithmic:MNQ1!'), 'MNQ'); assert.equal(L.chartRoot('futures:ES1!'), 'ES');
assert.equal(L.chartRoot('MES1!'), 'MES'); assert.equal(L.chartRoot('NQ2!'), ''); assert.equal(L.chartRoot('BTCUSDT'), ''); assert.equal(L.chartRoot('CL1!'), ''); assert.equal(L.chartRoot(''), '');
assert.equal(new Date(L.thirdFriday(2026, 12)).toISOString().slice(0, 10), '2026-12-18');
assert.equal(new Date(L.thirdFriday(2027, 3)).toISOString().slice(0, 10), '2027-03-19');
assert.equal(L.frontMonth('NQ', T('2026-11-15T12:00:00Z')).code, 'NQZ6');
assert.equal(L.frontMonth('MES', T('2026-12-09T12:00:00Z')).code, 'MESZ6', 'before the roll window');
assert.equal(L.frontMonth('MES', T('2026-12-10T12:00:00Z')).code, 'MESH7', 'roll 8 days before expiry');
assert.equal(L.frontMonth('ES', T('2026-12-19T00:00:00Z')).code, 'ESH7', 'after expiry');
assert.equal(L.frontMonth('ES', T('2029-11-01T00:00:00Z')).code, 'ESZ9');
assert.equal(L.frontMonth('NQ', T('2029-12-20T00:00:00Z')).code, 'NQH0', 'decade wrap');
assert.ok(L.validContract('NQZ6', T('2026-11-15T00:00:00Z'))); assert.ok(L.validContract('nqh7', T('2026-11-15T00:00:00Z')));
for (const bad of ['NQM7', 'NQZ5', 'CLZ6', 'NQ', 'NQZ6;', '../x', '', 'MNQZ66']) assert.ok(!L.validContract(bad, T('2026-11-15T00:00:00Z')), bad);
// a held position's contract wins over the front month (shown as "held")
const NOW = T('2026-12-11T15:00:00Z');   // inside the Z6 roll window: front = H7
const posZ = [{ securityId: 'NQZ6', quantity: 1, averageBuyPrice: 21000, status: 'OPEN' }];
let c = L.contractFor('CME_MINI:NQ1!', posZ, NOW); assert.deepEqual([c.code, c.front, c.held, c.pv], ['NQZ6', 'NQH7', true, 20]);
c = L.contractFor('CME_MINI:NQ1!', [], NOW); assert.deepEqual([c.code, c.held], ['NQH7', false]);
assert.equal(L.contractFor('BTCUSDT', [], NOW), null);
assert.equal(L.contractOf({ instrument: { displaySymbol: 'MESZ26' } }), 'MESZ6'); assert.equal(L.contractOf({ securityId: 'NQZ6.CME' }), 'NQZ6'); assert.equal(L.contractOf({ securityId: 'AAPL' }), '');
assert.equal(L.contractOf({ securityId: 'MNQZ6' }), 'MNQZ6', 'MNQ never read as NQ');
// positions: signed qty, SHORT side with positive qty, closed rows ignored, average price
assert.deepEqual(L.netPosition([{ securityId: 'ESZ6', quantity: -2, averageSellPrice: 6000 }], 'ESZ6').qty, -2);
assert.equal(L.netPosition([{ securityId: 'ESZ6', quantity: 1, side: 'SHORT' }], 'ESZ6').qty, -1);
assert.equal(L.netPosition([{ securityId: 'ESZ6', quantity: 1, status: 'CLOSED' }], 'ESZ6').qty, 0);
assert.equal(L.netPosition([{ securityId: 'ESZ6', quantity: 2, averageBuyPrice: 6000 }], 'ESZ6').avg, 6000);
// working orders
const ords = [
  { orderId: 'w1', status: 'SUBMITTED', orderType: 'LIMIT', legs: [{ securityId: 'NQZ6', side: 'BUY', quantity: 1, limitPrice: 20900 }] },
  { orderId: 'w2', status: 'FILLED', legs: [{ securityId: 'NQZ6', side: 'BUY', quantity: 1 }] },
  { orderId: 'w3', status: 'PARTIALLY_FILLED', orderType: 'LIMIT', legs: [{ securityId: 'NQZ6', side: 'SELL', quantity: 2, remainingQuantity: 1, limitPrice: 21100 }] },
  { orderId: 'w4', status: 'SUBMITTED', legs: [{ securityId: 'ESZ6', side: 'SELL', quantity: 1 }] },
];
const w = L.workingOrders(ords, 'NQZ6'); assert.deepEqual(w.map((o) => [o.id, o.side, o.qty, o.price]), [['w1', 'buy', 1, 20900], ['w3', 'sell', 1, 21100]]);
// exposure: worst case of position + working + new within 2
assert.equal(L.exposureError(0, [], 'buy', 2), null);
assert.ok(L.exposureError(1, [], 'buy', 2)); assert.equal(L.exposureError(2, [], 'sell', 2), null, 'closing is fine');
assert.ok(L.exposureError(0, [{ side: 'buy', qty: 2 }], 'buy', 1), 'working orders count');
assert.equal(L.exposureError(-2, [], 'buy', 2), null); assert.ok(L.exposureError(-2, [], 'sell', 1));
// ---- payload building ---------------------------------------------------------------------------------------------------
const N = T('2026-11-15T15:00:00Z');
assert.deepEqual(L.buildPlace({ code: 'NQZ6', side: 'buy', qty: 1, type: 'market' }, N).body, { op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', assetType: 'future', timeInForce: 'day' });
assert.equal(L.buildPlace({ code: 'MESZ6', side: 'sell', qty: 2, type: 'limit', price: 6000.13 }, N).body.limitPrice, 6000.25, 'tick rounded');
for (const bad of [{ qty: 3 }, { qty: 0 }, { qty: 1.5 }, { side: 'hold' }, { type: 'stop' }, { type: 'limit', price: 0 }, { code: 'CLZ6' }, { code: 'NQM7' }])
  assert.ok(L.buildPlace(Object.assign({ code: 'NQZ6', side: 'buy', qty: 1, type: 'market' }, bad), N).error, JSON.stringify(bad));
assert.deepEqual(L.buildModify({ id: 'w1', price: 20901.1, code: 'NQZ6' }).body, { op: 'modify', orderId: 'w1', type: 'limit', limitPrice: 20901 });
// ladder: always a limit, flagged when marketable
assert.deepEqual(L.ladderOrder('bid', 100, 99.75, 100), { side: 'buy', type: 'limit', price: 100, marketable: true });
assert.deepEqual(L.ladderOrder('bid', 99.5, 99.75, 100), { side: 'buy', type: 'limit', price: 99.5, marketable: false });
assert.deepEqual(L.ladderOrder('ask', 99.75, 99.75, 100), { side: 'sell', type: 'limit', price: 99.75, marketable: true });
assert.equal(L.ladderOrder('price', 100, 1, 2), null);
assert.ok(L.priceBandError(22000, 21000)); assert.equal(L.priceBandError(21100, 21000), null);
// flatten plan + deterministic key
assert.deepEqual(L.flattenPlan(2, [{ id: 'a' }, { id: 'b', cancelling: true }]), { cancel: ['a'], close: { side: 'sell', qty: 2 } });
assert.deepEqual(L.flattenPlan(-1, []), { cancel: [], close: { side: 'buy', qty: 1 } });
assert.equal(L.flattenPlan(3, []).tooBig, true); assert.equal(L.flattenPlan(0, []).close, null);
const k1 = L.flattenKey('acc', 'NQZ6', 2, 'x'); assert.equal(k1, L.flattenKey('acc', 'NQZ6', 2, 'x')); assert.notEqual(k1, L.flattenKey('acc', 'NQZ6', 1, 'x')); assert.ok(L.IDEM.test(k1));
// read gate
assert.equal(L.readsOk({ lastOkStart: 1000, lastWriteAt: 0, now: 5000 }).ok, true);
assert.equal(L.readsOk({ lastOkStart: 1000, lastWriteAt: 2000, now: 5000 }).ok, false, 'read must start after the last write');
assert.equal(L.readsOk({ lastOkStart: 1000, now: 40000 }).ok, false, 'stale');
assert.equal(L.readsOk({ lastOkStart: 1000, now: 2000, unknown: true }).ok, false, 'unknown result blocks');
assert.equal(L.readsOk({ lastOkStart: 0, now: 2000 }).ok, false);
assert.deepEqual(L.acctLabel({ broker: 'tradovate', name: 'DEMO123456' }), { broker: 'Tradovate', last4: '3456', text: 'Tradovate DEMO123456', number: 'DEMO123456' });
// ---- account identity (Owner bug 2026-11-16: "…2029" was the broker's INTERNAL id, not the account number) -------------------
{
  const U = '123e4567-e89b-12d3-a456-426614174000';
  // Tradovate-like record: internal numeric id + the account name the broker shows
  const tv = L.acctInfo({ accountId: U, brokerId: 'tradovate', brokerName: 'Tradovate', brokerAccountId: '37552029', accountName: 'APEX-123456-01', accountType: 'futures', currencyCode: 'USD' });
  assert.equal(tv.number, 'APEX-123456-01', 'broker account name wins over the internal id');
  assert.equal(tv.text, 'Tradovate APEX-123456-01'); assert.equal(tv.id, U); assert.equal(tv.currency, 'USD'); assert.equal(tv.brokerAccountId, '37552029');
  // accountNumber present and equal to the internal id -> the display name wins
  assert.equal(L.acctInfo({ accountId: U, brokerName: 'tradovate', brokerAccountId: '37552029', accountNumber: '37552029', accountName: 'TOPSTEP50K-0042' }).number, 'TOPSTEP50K-0042');
  // a real broker account number wins
  assert.equal(L.acctInfo({ accountId: U, brokerName: 'ibkr', accountNumber: 'U1234567', accountName: 'Individual' }).number, 'U1234567');
  // snake_case grant-style shape
  assert.equal(L.acctInfo({ id: U, broker_id: 'ninja_trader', account_number: 'NT-778899', account_display_name: 'Sim101' }).number, 'NT-778899');
  assert.equal(L.acctInfo({ id: U, broker_id: 'ninja_trader', account_display_name: 'Sim101' }).text, 'NinjaTrader Sim101');
  // never a UUID, never our own id, never the internal id alone
  assert.equal(L.acctInfo({ accountId: U, brokerName: 'rithmic', accountName: U }).number, '');
  assert.equal(L.acctInfo({ accountId: U, brokerName: 'rithmic', accountNumber: '0f8fad5b-d9cb-469f-a165-70867728950e' }).number, '');
  assert.equal(L.acctInfo({ accountId: U, brokerName: 'tradovate', brokerAccountId: '37552029' }).number, '');
  assert.equal(L.acctInfo({ accountId: U, brokerName: 'tradovate', brokerAccountId: '37552029' }).text, 'Tradovate');
  assert.equal(L.acctInfo({ accountId: U, brokerName: 'tradovate', accountName: { x: 1 } }).number, '', 'objects ignored');
  assert.equal(L.brokerNice('ninja_trader'), 'NinjaTrader'); assert.equal(L.brokerNice('tasty_trade'), 'tastytrade'); assert.equal(L.brokerNice('interactive_brokers'), 'Interactive Brokers');
  // grant lookup for Disconnect
  const G = [{ id: 'g1', brokerId: 'tradovate', brokerAccountId: '37552029', status: 'ACTIVE' }, { id: 'g2', brokerId: 'rithmic', brokerAccountId: '99', status: 'ACTIVE' }, { id: 'g3', brokerId: 'tradovate', brokerAccountId: '11', revokedAt: '2026-01-01' }];
  assert.equal(L.grantFor(tv, G), 'g1', 'by broker account id');
  assert.equal(L.grantFor(L.acctInfo({ accountId: U, brokerId: 'rithmic', accountName: 'X' }), G), 'g2', 'only grant of that broker');
  assert.equal(L.grantFor(L.acctInfo({ accountId: U, brokerId: 'tradovate', accountName: 'X' }), G.concat([{ id: 'g4', brokerId: 'tradovate', brokerAccountId: '22' }])), '', 'two grants of one broker and no link: refuse to guess');
  assert.equal(L.grantFor(L.acctInfo({ accountId: U, grantId: 'g2', brokerId: 'x' }), G), 'g2', 'explicit link');
  assert.equal(L.grantFor(tv, []), '');
  // balances: numbers or numeric strings, value preference, currency, open P&L
  assert.deepEqual(L.balanceOf([{ currencyCode: 'USD', cashBalance: '50000', netLiquidationValue: '50312.4', unrealizedPnl: '-120.5' }]), { amount: 50312.4, currency: 'USD', upl: -120.5, kind: 'netLiquidationValue' });
  assert.equal(L.balanceOf([{ currency: 'USD', totalCashValue: 49870.25 }]).amount, 49870.25);
  assert.equal(L.balanceOf([{ balanceType: 'CASH', currentBalance: '1,250.00', currencyCode: 'EUR' }]).currency, 'EUR');
  assert.equal(L.balanceOf([{ currencyCode: 'EUR', cashBalance: 10 }, { currencyCode: 'USD', cashBalance: 20 }], 'USD').amount, 20, 'account currency row first');
  assert.equal(L.balanceOf({ cash_balance: 7 }).amount, 7, 'single object / snake_case');
  assert.equal(L.balanceOf([]), null); assert.equal(L.balanceOf([{ currencyCode: 'USD' }]), null); assert.equal(L.balanceOf(null), null);
  assert.equal(L.balanceOf([{ cashBalance: 'n/a' }]), null);
  assert.equal(L.fmtMoney(50312.4, 'USD'), '$50,312.40'); assert.equal(L.fmtMoney(-12.5, 'USD'), '-$12.50'); assert.equal(L.fmtMoney(120, 'USD', true), '+$120.00');
  assert.equal(L.fmtMoney(1200, 'EUR'), '€1,200.00'); assert.equal(L.fmtMoney(null, 'USD'), ''); assert.equal(L.fmtMoney(5, 'x'), '$5.00');
  // notes from the pencil
  assert.deepEqual(L.cleanMeta({ label: '  Apex   eval 1 ', firm: 'Apex', type: 'eval', evil: 1 }), { label: 'Apex eval 1', firm: 'Apex', type: 'eval' });
  assert.deepEqual(L.cleanMeta({ label: 'x'.repeat(60), firm: '<b>Firm</b>', type: 'lifetime' }), { label: 'x'.repeat(40), firm: 'bFirm/b', type: '' });
  assert.deepEqual(L.cleanMeta(null), { label: '', firm: '', type: '' });
  const ti = L.acctTitle(tv, { label: 'Apex eval 1', firm: 'Apex', type: 'eval' });
  assert.equal(ti.name, 'Apex eval 1'); assert.equal(ti.full, 'Apex eval 1 · Apex · Tradovate APEX-123456-01'); assert.equal(ti.type, 'Evaluation');
  assert.equal(L.acctTitle(tv, {}).name, 'Tradovate'); assert.equal(L.acctTitle(tv, {}).full, 'Tradovate APEX-123456-01');
  assert.ok(L.FIRMS.includes('Apex') && L.FIRMS.includes('Own account') && L.FIRMS.length === 12);
}
assert.equal(L.openPnl(1, 21000, 21010, 20, null), 200); assert.equal(L.openPnl(-2, 6000, 5990, 50, null), 1000); assert.equal(L.openPnl(1, null, 5, 2, -12), -12);

// ---- server chart paths, mocked broker + mocked auth ------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };
const B = { positions: [], orders: [], calls: [], fail: '' };
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const finFetch = async (url, init) => {
  const u = new URL(url); B.calls.push({ m: init.method, p: u.pathname, key: init.headers['Idempotency-Key'], body: init.body ? JSON.parse(init.body) : null });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 's', company_id: 'c', status: 'active', user_id: US });
  if (u.pathname.endsWith('/positions')) return B.fail === 'read' ? new Response('x', { status: 500 }) : ok(B.positions);
  if (u.pathname.endsWith('/orders') && init.method === 'GET') return ok(B.orders);
  if (u.pathname.endsWith('/orders') && init.method === 'POST') { if (B.fail === 'timeout') throw new Error('timeout'); return ok({ accepted: true, order: { orderId: 'new-1', status: 'SUBMITTED' } }); }
  if (u.pathname.includes('/orders/') && init.method === 'DELETE') { const id = u.pathname.split('/').pop(); B.orders = B.orders.map((o) => (o.orderId === id ? { ...o, status: 'CANCELLED' } : o)); return ok({ accepted: true, order: { orderId: id, status: 'CANCELLED' } }); }
  if (u.pathname.includes('/orders/') && init.method === 'PATCH') return ok({ accepted: true, executionStrategy: 'NATIVE_MODIFY', order: { orderId: 'w1', status: 'SUBMITTED' } });
  return ok([]);
};
const audits = new Map();
const audit = async (e, id) => { if (id && audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } const row = { ...e }; audits.set(id || 'r' + audits.size, row); return { finish: async (r) => Object.assign(row, r) }; };
let killOn = true;
const deps = { verifyFetch, finFetch, audit, liveSwitch: async () => { if (killOn === 'err') throw new Error('x'); return killOn; }, now: () => N, sleep: async () => {} };
const US = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1;
const req = (body, tok, url) => new Request(url || 'https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '10.9.' + (ip++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
const send = async (b, tok = token('admin1'), env = live) => { O._resetRate(); const r = await O.handle(req({ src: 'chart', accountId: ACC, userId: US, ...b }, tok), env, deps); return { status: r.status, j: await r.json() }; };
const writes = () => B.calls.filter((x) => x.m !== 'GET' && !x.p.includes('/session/'));
const key = (n) => 'k' + String(n).padStart(20, '0');

let r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(1) }, token('member9'));
assert.equal(r.status, 403, 'non-admin refused'); assert.equal(writes().length, 0);
r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market' }); assert.equal(r.status, 400, 'idemKey required');
r = await send({ op: 'place', symbol: 'CLZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(2) }); assert.equal(r.status, 400, 'contract whitelist');
r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'stop', stopPrice: 1, idemKey: key(3) }); assert.equal(r.status, 400, 'no stops from the chart');
r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 3, type: 'market', idemKey: key(4) }); assert.equal(r.status, 400, 'qty cap stays');
killOn = false; r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(5) }); assert.equal(r.status, 403); assert.equal(r.j.code, 'switched_off');
killOn = 'err'; r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(6) }); assert.equal(r.status, 503, 'kill switch unreadable = refused');
killOn = true; assert.equal(writes().length, 0, 'nothing reached the broker yet');
r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(7) }, token('admin1'), { FINATIC_API_KEY: 'fntc_live_FAKE', DEV: '0' }); assert.equal(r.status, 403, 'env switch still required');
// accepted place: the idemKey is the Idempotency-Key and the audit id
r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'limit', limitPrice: 20900, idemKey: key(8) });
assert.equal(r.status, 200); assert.equal(writes().at(-1).key, key(8)); assert.deepEqual(writes().at(-1).body.order, { assetType: 'future', symbol: 'NQZ6', action: 'buy', orderType: 'limit', orderQty: 1, price: 20900, timeInForce: 'day' });
assert.equal(writes().at(-1).body.paperTradeConfirmed, false); assert.equal(audits.get(key(8)).src, 'chart');
// same key again: 409 duplicate, broker not called
let n0 = writes().length; r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'limit', limitPrice: 20900, idemKey: key(8) });
assert.equal(r.status, 409); assert.equal(r.j.code, 'duplicate'); assert.equal(writes().length, n0);
// exposure from a FRESH read: long 1 + working buy 1 -> another buy refused, a sell allowed
B.positions = [{ securityId: 'NQZ6', quantity: 1, averageBuyPrice: 21000 }]; B.orders = [{ orderId: 'w1', status: 'SUBMITTED', legs: [{ securityId: 'NQZ6', side: 'BUY', quantity: 1, limitPrice: 20900 }] }];
r = await send({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(9) }); assert.equal(r.status, 409); assert.equal(r.j.code, 'exposure');
r = await send({ op: 'place', symbol: 'NQZ6', side: 'sell', qty: 1, type: 'market', idemKey: key(10) }); assert.equal(r.status, 200);
B.fail = 'read'; n0 = writes().length; r = await send({ op: 'place', symbol: 'NQZ6', side: 'sell', qty: 1, type: 'market', idemKey: key(11) }); assert.equal(r.status, 503); assert.equal(r.j.code, 'read_failed'); assert.equal(writes().length, n0, 'unreadable = not sent'); B.fail = '';
// timeout = unknown, audited as unknown
B.fail = 'timeout'; r = await send({ op: 'place', symbol: 'NQZ6', side: 'sell', qty: 1, type: 'market', idemKey: key(12) }); assert.equal(r.status, 503, 'edge-safe: never 502 (Cloudflare swaps the body)'); assert.equal(r.j.code, 'unknown'); assert.equal(audits.get(key(12)).result, 'unknown'); B.fail = '';
// modify: limit price only
r = await send({ op: 'modify', orderId: 'w1', type: 'limit', limitPrice: 20950, idemKey: key(13) }); assert.equal(r.status, 200); assert.equal(writes().at(-1).m, 'PATCH'); assert.deepEqual(writes().at(-1).body.order, { orderType: 'limit', price: 20950 });
r = await send({ op: 'modify', orderId: 'w1', type: 'limit', limitPrice: 20950, qty: 2, idemKey: key(14) }); assert.equal(r.status, 400);
// cancel
r = await send({ op: 'cancel', orderId: 'w1', idemKey: key(15) }); assert.equal(r.status, 200); assert.equal(writes().at(-1).m, 'DELETE'); assert.equal(writes().at(-1).key, key(15));
// flatten: cancels working orders, re-reads, ONE market order for the net; keys derived from the flatten key
B.positions = [{ securityId: 'NQZ6', quantity: 2, averageBuyPrice: 21000 }]; B.orders = [{ orderId: 'w5', status: 'SUBMITTED', legs: [{ securityId: 'NQZ6', side: 'SELL', quantity: 1, limitPrice: 21100 }] }, { orderId: 'w6', status: 'SUBMITTED', legs: [{ securityId: 'ESZ6', side: 'SELL', quantity: 1 }] }];
n0 = writes().length; r = await send({ op: 'flatten', symbol: 'NQZ6', idemKey: key(16) });
assert.equal(r.status, 200, JSON.stringify(r.j)); const fw = writes().slice(n0);
assert.deepEqual(fw.map((x) => [x.m, x.p.split('/').pop(), x.key]), [['DELETE', 'w5', key(16) + '-c0'], ['POST', 'orders', key(16) + '-x']]);
assert.deepEqual(fw[1].body.order, { assetType: 'future', symbol: 'NQZ6', action: 'sell', orderType: 'market', orderQty: 2, timeInForce: 'day' });
assert.equal(B.orders.find((o) => o.orderId === 'w6').status, 'SUBMITTED', 'other contracts untouched');
n0 = writes().length; r = await send({ op: 'flatten', symbol: 'NQZ6', idemKey: key(16) }); assert.equal(r.status, 409, 'double flatten deduped'); assert.equal(writes().length, n0);
B.positions = [{ securityId: 'NQZ6', quantity: -3 }]; B.orders = []; r = await send({ op: 'flatten', symbol: 'NQZ6', idemKey: key(17) }); assert.equal(r.status, 409); assert.equal(r.j.code, 'too_big');
B.positions = []; n0 = writes().length; r = await send({ op: 'flatten', symbol: 'NQZ6', idemKey: key(18) }); assert.equal(r.status, 200); assert.equal(r.j.closed, null); assert.equal(writes().length, n0, 'flat: nothing sent');
r = await send({ op: 'flatten', symbol: 'NQZ6', idemKey: key(19), src: 'journal' }); assert.equal(r.status, 400, 'flatten is a chart op only');
// the read endpoint's new 'live' op: GETs only
const dn = B.calls.length; const dr = await D.handle(req({ op: 'live', accountId: ACC, userId: US }, token('admin1'), 'https://tradezoro.com/connect/finatic/data'), live, deps);
assert.equal(dr.status, 200); const dj = await dr.json(); assert.ok(Array.isArray(dj.data.positions) && Array.isArray(dj.data.orders));
assert.ok(B.calls.slice(dn).every((x) => x.m === 'GET' || x.p.includes('/session/')));
assert.equal((await D.handle(req({ op: 'live', accountId: ACC, userId: US }, token('member9'), 'https://tradezoro.com/connect/finatic/data'), live, deps)).status, 403);
assert.ok(![...audits.values()].some((a) => JSON.stringify(a).includes('FAKE')), 'no key in audit');
console.log('chart live: ok');
