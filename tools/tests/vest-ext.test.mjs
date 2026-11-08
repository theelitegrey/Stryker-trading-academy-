// Zoro for Vest (extensions/vest): unit tests. Pure maths (sizing, points -> price, bracket, copy fan-out, rate limiter, change
// detection, settings caps, levels link) and the engine against a fake Vest gateway (no network, no real orders).
// Run: node tools/tests/vest-ext.test.mjs
import { createRequire } from 'module';
import assert from 'assert/strict';
const require = createRequire(import.meta.url);
const C = require('../../extensions/vest/src/core.js');
const Engine = require('../../extensions/vest/src/engine.js');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---- maths ---------------------------------------------------------------------------------------------------------------------------
t('roundToTick near/down/up, no float leaks', () => {
  assert.equal(C.roundToTick(7404.13, '0.25', 2, 'near'), '7404.25');
  assert.equal(C.roundToTick(7404.12, '0.25', 2, 'near'), '7404');
  assert.equal(C.roundToTick(7404.13, '0.25', 2, 'down'), '7404');
  assert.equal(C.roundToTick(0.1 + 0.2, '0.1', 1, 'near'), '0.3');
  assert.equal(C.roundToTick(75886.55, '0.1', 1, 'near'), '75886.6');
  assert.equal(C.roundToTick(1.162551, '0.000001', 6, 'near'), '1.162551');
  assert.equal(C.roundToTick(5, '0', 2, 'near'), null);
  assert.equal(C.decimalsOf('1e-06'), 6);
});
t('floorSize never rounds up', () => {
  assert.equal(C.floorSize(1.23456, 4), '1.2345');
  assert.equal(C.floorSize(0.00009, 4), '0');
  assert.equal(C.floorSize(3, 0), '3');
  assert.equal(C.floorSize(0.3, 1), '0.3');      // 0.3*10 = 2.9999999999999996 must still be 3 steps
  assert.equal(C.floorSize(2.999, 0), '2');
});
t('points -> price: long stop below, short stop above, targets the other way', () => {
  const o = { entry: 7400, points: 10, tick: '0.25', priceDecimals: 2 };
  assert.equal(C.pointsToPrice({ ...o, isLong: true, kind: 'stop' }), '7390');
  assert.equal(C.pointsToPrice({ ...o, isLong: false, kind: 'stop' }), '7410');
  assert.equal(C.pointsToPrice({ ...o, isLong: true, kind: 'target' }), '7410');
  assert.equal(C.pointsToPrice({ ...o, isLong: false, kind: 'target' }), '7390');
  assert.equal(C.pointsToPrice({ ...o, points: 2.6, isLong: true, kind: 'stop' }), '7397.5');   // to the tick
  assert.equal(C.pointsToPrice({ ...o, points: 8000, isLong: true, kind: 'stop' }), null);      // below zero
  assert.equal(C.pointsToPrice({ ...o, points: 0, isLong: true, kind: 'stop' }), null);
  assert.equal(C.pointsToPrice({ ...o, points: -5, isLong: true, kind: 'stop' }), null);
});
t('$ risk -> contracts', () => {
  assert.equal(C.sizeFromRisk({ riskUsd: 100, stopPoints: 10, sizeDecimals: 4 }), '10');
  assert.equal(C.sizeFromRisk({ riskUsd: 100, stopPoints: 30, sizeDecimals: 2 }), '3.33');
  assert.equal(C.sizeFromRisk({ riskUsd: 50, stopPoints: 300, sizeDecimals: 4 }), '0.1666');
  assert.equal(C.sizeFromRisk({ riskUsd: 10, stopPoints: 0, sizeDecimals: 4 }), '0');
  assert.equal(C.sizeFromRisk({ riskUsd: 1, stopPoints: 300, sizeDecimals: 0 }), '0');
});
t('bracket: stop + 2 targets split, risk, errors', () => {
  const spec = { sizeDecimals: 4, priceDecimals: 2, tick: '0.25' };
  const b = C.bracket({ spec, entry: 7400, qty: '1.0001', isLong: true, stopPoints: 10, targetPoints: [10, 20] });
  assert.equal(b.stop, '7390');
  assert.deepEqual(b.targets.map((x) => x.price), ['7410', '7420']);
  assert.deepEqual(b.targets.map((x) => x.qty), ['0.5', '0.5001']);    // halves add back to the full size
  assert.ok(Math.abs(b.riskUsd - 10.001) < 1e-9);
  const s = C.bracket({ spec, entry: 7400, qty: '2', isLong: false, stopPoints: 5, targetPoints: [15] });
  assert.equal(s.stop, '7405'); assert.deepEqual(s.targets, [{ price: '7385', qty: null }]);
  assert.ok(C.bracket({ spec, entry: 7400, qty: '0', isLong: true }).error);
  assert.ok(C.bracket({ spec: { ...spec, sizeDecimals: 0 }, entry: 7400, qty: '1', isLong: true, targetPoints: [5, 10] }).error);
  assert.ok(C.bracket({ spec, entry: 5, qty: '1', isLong: true, stopPoints: 10 }).error);
  assert.deepEqual(C.bracket({ spec, entry: 7400, qty: '1', isLong: true, stopPoints: '', targetPoints: ['', ''] }), { stop: null, targets: [], riskUsd: null });
});
t('follower sizing 1:1 and scaled to balance', () => {
  assert.equal(C.followerQty({ masterQty: '1.5', mode: 'equal', sizeDecimals: 4 }), '1.5');
  assert.equal(C.followerQty({ masterQty: '2', mode: 'balance', masterBalance: 10000, followerBalance: 2500, sizeDecimals: 4 }), '0.5');
  assert.equal(C.followerQty({ masterQty: '1', mode: 'balance', masterBalance: 3000, followerBalance: 1000, sizeDecimals: 2 }), '0.33');
  assert.equal(C.followerQty({ masterQty: '1', mode: 'balance', masterBalance: 0, followerBalance: 1000, sizeDecimals: 2 }), '0');
  assert.equal(C.followerQty({ masterQty: '1', mode: 'balance', masterBalance: 1000, followerBalance: NaN, sizeDecimals: 2 }), '0');
});
t('fan-out: order kept, limit enforced, zero sizes skipped, disabled ignored', () => {
  const f = [{ id: 'a', balance: 1000, enabled: true }, { id: 'b', balance: 1, enabled: true }, { id: 'x', enabled: false }, { id: 'c', balance: 5000, enabled: true }];
  const r = C.planFanout({ qty: '1' }, f, { maxFollowers: 2, sizing: 'balance', masterBalance: 1000, sizeDecimals: 2 });
  assert.deepEqual(r.map((x) => x.accountId), ['a', 'b', 'c']);
  assert.equal(r[0].qty, '1'); assert.equal(r[0].skip, null);
  assert.equal(r[1].qty, '0'); assert.match(r[1].skip, /rounds to 0/);
  assert.match(r[2].skip, /follower limit/);
  const n = C.planFanout({ qty: null }, f, { maxFollowers: 5, sizing: 'equal', sizeDecimals: 2 });
  assert.ok(n.every((x) => x.qty === null && x.skip === null));
  assert.deepEqual(C.scaleLegs([{ triggerPrice: '1', quantity: '3' }, { triggerPrice: '2' }], 0.5, 1), [{ triggerPrice: '1', quantity: '1.5' }, { triggerPrice: '2' }]);
  assert.deepEqual(C.scaleLegs([{ triggerPrice: '1', quantity: '0.01' }], 0.5, 1), []);
});
t('checkOrder: size, decimals, notional cap', () => {
  const spec = { sizeDecimals: 2 };
  assert.equal(C.checkOrder({ qty: '1', price: 100, spec, maxNotionalUsd: 1000 }), null);
  assert.match(C.checkOrder({ qty: '11', price: 100, spec, maxNotionalUsd: 1000 }), /over your limit/);
  assert.match(C.checkOrder({ qty: '0.001', price: 100, spec, maxNotionalUsd: 1000 }), /decimals/);
  assert.match(C.checkOrder({ qty: '0', price: 100, spec, maxNotionalUsd: 1000 }), /more than 0/);
  assert.match(C.checkOrder({ qty: '1', price: NaN, spec, maxNotionalUsd: 1000 }), /No price/);
});
t('rate limiter: sliding 60 s window', () => {
  let now = 1000; const L = new C.RateLimiter(3, () => now);
  assert.ok(L.take()); assert.ok(L.take(2)); assert.equal(L.take(), false); assert.equal(L.room(), 0);
  now += 59999; assert.equal(L.take(), false);
  now += 1; assert.equal(L.room(), 3); assert.ok(L.take(3)); assert.equal(L.take(), false);
  assert.equal(new C.RateLimiter(2, () => 0).take(3), false);
});
t('settings: hard caps cannot be raised, junk becomes defaults', () => {
  const s = C.clampSettings({ maxNotionalUsd: 1e9, maxFollowers: 99, maxOrdersPerMin: 999, master: 'm', followers: ['m', 'a', 5, 'b'], theme: 'pink' });
  assert.equal(s.maxNotionalUsd, C.HARD.maxNotionalUsd); assert.equal(s.maxFollowers, C.HARD.maxFollowers); assert.equal(s.maxOrdersPerMin, C.HARD.maxOrdersPerMin);
  assert.deepEqual(s.followers, ['a', 'b']); assert.equal(s.theme, 'auto');
  const d = C.clampSettings('nope');
  assert.equal(d.maxNotionalUsd, C.DEFAULTS.maxNotionalUsd); assert.equal(d.master, null); assert.equal(d.mirrorVestForm, true);
  assert.equal(C.clampSettings({ maxOrdersPerMin: 0 }).maxOrdersPerMin, C.DEFAULTS.maxOrdersPerMin);
});
t('change detection: shapes and endpoints', () => {
  assert.deepEqual(C.shapeErrors({ tickers: [{ symbol: 'X', markPrice: '1.5' }] }, C.SCHEMAS.ticker), []);
  assert.ok(C.shapeErrors({ tickers: [{ symbol: 'X', mark: '1.5' }] }, C.SCHEMAS.ticker)[0].includes('markPrice'));
  assert.ok(C.shapeErrors({ tickers: {} }, C.SCHEMAS.ticker)[0].includes('not a list'));
  assert.ok(C.shapeErrors(null, C.SCHEMAS.accounts).length);
  assert.ok(C.shapeErrors({ positions: [{ positionId: 'p', symbol: 's', side: 'long', quantity: 'x', openPrice: '1', takeProfits: [], stopLosses: [] }] }, C.SCHEMAS.positions)[0].includes('quantity'));
  const all = C.ENDPOINTS.map((e) => JSON.stringify(e)).join(',');
  assert.deepEqual(C.missingEndpoints(all), []);
  assert.deepEqual(C.missingEndpoints(all.replace('"/v3/positions/open"', '"/v4/positions/open"')), ['/v3/positions/open']);
});
t('levels link + url + jwt expiry', () => {
  const sec = 'A'.repeat(43);
  assert.equal(C.parseLevelsLink('https://tradezoro.com/api/lv/feed/' + sec + '.csv?u=SPX&inc=gex'), sec);
  assert.equal(C.parseLevelsLink(sec), sec);
  assert.equal(C.parseLevelsLink('https://evil.example/x'), null);
  assert.equal(C.levelsUrl(sec, 'ES'), 'https://tradezoro.com/api/lv/feed/' + sec + '.json?u=ES&inc=gex,em,nodes,dp');
  assert.equal(C.levelsUrl(sec, 'BTC'), null); assert.equal(C.levelsUrl('x', 'ES'), null);
  assert.equal(C.levelsSymbol('SPX-USD-PERP'), 'SPX'); assert.equal(C.levelsSymbol('NDX-USD-PERP'), 'QQQ'); assert.equal(C.levelsScaleFrom('NDX-USD-PERP'), 'QQQ-USD-PERP'); assert.equal(C.levelsScaleFrom('SPX-USD-PERP'), null);
  assert.deepEqual(C.scaleLevels([{ label: 'x', price: 600 }], 27105.5 / 657.91, 2), [{ label: 'x', price: 24719.64 }]);
  assert.equal(C.scaleLevels([{ price: 1 }], NaN, 2), null); assert.equal(C.levelsSymbol('BTC-PERP'), null);
  const tok = 'h.' + Buffer.from(JSON.stringify({ exp: 2000 })).toString('base64url') + '.s';
  assert.equal(C.tokenExpMs(tok, 1), 2000000); assert.equal(C.tokenExpMs('bad', 7), 7);
  assert.equal(C.agoText(0), 'updated just now'); assert.equal(C.agoText(5), 'updated 5 min ago'); assert.equal(C.agoText(125), 'updated 2 h ago');
});

// ---- engine against a fake Vest gateway ---------------------------------------------------------------------------------------------
const GW = 'https://api-gateway.hz.vestmarkets.com';
const ACC = { M: 'acct-master-0001', F1: 'acct-follow-0002', F2: 'acct-follow-0003' };
function fakeVest(opts = {}) {
  const calls = [];
  const positions = opts.positions || [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url), path = u.pathname, m = (init.method || 'GET').toUpperCase(), auth = (init.headers || {}).Authorization || '';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ m, path, auth, body });
    const J = (s, j) => { const r = { ok: s < 300, status: s, text: async () => JSON.stringify(j), json: async () => j }; r.clone = () => r; return r; };
    if (path === '/assets/index-abc.js') return { ok: true, status: 200, clone() { return this; }, text: async () => opts.bundle ?? C.ENDPOINTS.map((e) => JSON.stringify(e)).join(',') };
    if (path === '/v3/exchangeInfo') return J(200, { symbols: [{ symbol: 'SPX-USD-PERP', displaySymbol: 'SPX-USD-PERP', sizeDecimals: 4, priceDecimals: 2, minTickSize: '0.25', tradingStatus: 'TRADING' }] });
    if (path === '/v3/ticker/latest') return J(200, opts.ticker || { tickers: [{ symbol: 'SPX-USD-PERP', markPrice: '7400.000000000' }] });
    if (path === '/v3/auth/account-token') return J(200, { accessToken: 'acc-' + body.accountId, accessExpiresAtMs: 9e15, accountId: body.accountId });
    if (path === '/v3/accounts') return J(200, { accounts: [{ account_id: ACC.M, account_type: 1, amount: '10000' }, { account_id: ACC.F1, account_type: 3, amount: '5000' }, { account_id: ACC.F2, account_type: 2, amount: '2500' }, { account_id: 'sys', account_type: 6, amount: '1' }] });
    if (path === '/v3/positions/opened') return J(200, { positions });
    if (path === '/v3/positions/opened-orders') return J(200, { orders: [] });
    if (path === '/v3/user-state') return J(200, { accounts: [] });
    if (path.startsWith('/v3/positions/')) {
      const acct = auth.replace('Bearer acc-', '');
      if (opts.failFor === acct) return J(400, { detail: { code: 4001, msg: 'Insufficient margin' } });
      return J(200, { commandId: 'c' + calls.length, orderId: 'o-' + acct + '-' + calls.length, positionId: 'p-' + acct });
    }
    return J(404, {});
  };
  return { calls, fetch, positions };
}
function fakeWin(f) {
  return { fetch: f.fetch, XMLHttpRequest: function () {}, location: { hostname: 'next.vestmarkets.com', href: 'https://next.vestmarkets.com/trade/SPX-USD-PERP' },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    document: { querySelector: () => ({ getAttribute: () => '/assets/index-abc.js' }) } };
}
async function ready(opts, settings) {
  const v = fakeVest(opts), w = fakeWin(v);
  const e = new Engine(w, { settings: Object.assign({ master: ACC.M, followers: [ACC.F1, ACC.F2], maxFollowers: 3, maxOrdersPerMin: 60, maxNotionalUsd: 250000 }, settings || {}) });
  e.fetch0 = v.fetch;                        // the engine's own calls go to the fake gateway; Vest's page calls go through the hook
  await e.start();
  // Vest's own page reads the accounts with the member's session token: the hook learns the session from it
  await w.fetch(GW + '/v3/accounts?active=true', { headers: { Authorization: 'Bearer user-tok' } });
  await new Promise((r) => setTimeout(r, 5));
  await e.refresh();
  return { e, v, w };
}
const writes = (v) => v.calls.filter((c) => /^\/v3\/positions\/(open|append|reduce|close|cancel-order|take-profit|stop-loss)$/.test(c.path));

t('engine: starts only when the endpoints are in Vest\'s code, learns the session from Vest\'s own call', async () => {
  const { e } = await ready();
  assert.equal(e.ok, true); assert.equal(e.userTok.t, 'user-tok');
  assert.deepEqual(e.accounts.map((a) => a.id), [ACC.M, ACC.F1, ACC.F2]);   // system account left out
  const bad = await ready({ bundle: 'nothing here' });
  assert.equal(bad.e.ok, false); assert.match(bad.e.offReason, /Vest changed its page/);
});
t('engine: changed answer shape turns trading off and refuses orders', async () => {
  const { e, v } = await ready({ ticker: { tickers: [{ symbol: 'SPX-USD-PERP', price: '1' }] } });
  assert.equal(e.ok, false); assert.match(e.offReason, /ticker/);
  await assert.rejects(e.send(ACC.M, 'POST', '/v3/positions/open', {}), /Trading is off/);
  assert.equal(writes(v).length, 0);
});
t('engine: bracket order on master, copy OFF -> one order, points became prices', async () => {
  const { e, v } = await ready();
  const o = { symbol: 'SPX-USD-PERP', isBuy: true, orderType: 'market', qty: '1', legs: { stop: '7390', targets: [{ price: '7410', qty: '0.5' }, { price: '7420', qty: '0.5' }] } };
  const plan = e.plan(o); assert.equal(plan.rows.length, 1);
  await e.execute(o, plan);
  const w = writes(v); assert.equal(w.length, 1);
  assert.equal(w[0].path, '/v3/positions/open'); assert.equal(w[0].auth, 'Bearer acc-' + ACC.M);
  assert.deepEqual(w[0].body.stopLosses, [{ executionType: 'market', triggerPrice: '7390' }]);
  assert.deepEqual(w[0].body.takeProfits, [{ executionType: 'market', triggerPrice: '7410', quantity: '0.5' }, { executionType: 'market', triggerPrice: '7420', quantity: '0.5' }]);
  assert.equal(w[0].body.side, 'long'); assert.equal(w[0].body.timeInForce, 'IOC');
});
t('engine: copy ON, scaled to balance; a failing follower drops out, others still filled', async () => {
  const { e, v } = await ready({ failFor: ACC.F1 }, { sizing: 'balance' });
  e.setCopy(true); assert.equal(e.copyOn, true);
  const o = { symbol: 'SPX-USD-PERP', isBuy: false, orderType: 'limit', price: '7410', qty: '2', legs: { stop: '7420', targets: [{ price: '7390', qty: null }] } };
  const plan = e.plan(o);
  assert.deepEqual(plan.rows.map((r) => [r.acct, r.qty]), [[ACC.M, '2'], [ACC.F1, '1'], [ACC.F2, '0.5']]);
  await e.execute(o, plan);
  const w = writes(v);
  assert.deepEqual(w.map((c) => c.auth.replace('Bearer acc-', '')), [ACC.M, ACC.F1, ACC.F2]);   // master first
  assert.equal(w[2].body.quantity, '0.5'); assert.equal(w[2].body.price, '7410'); assert.equal(w[2].body.timeInForce, 'GTC');
  assert.ok(e.dropped[ACC.F1]); assert.match(e.dropped[ACC.F1], /Insufficient margin/);
  assert.deepEqual(e.activeFollowers().map((f) => f.id), [ACC.F2]);
  assert.ok(e.log.some((l) => l.acct === ACC.F1 && l.level === 'error'));
});
t('engine: master refused -> nothing copied', async () => {
  const { e, v } = await ready({ failFor: ACC.M });
  e.setCopy(true);
  const o = { symbol: 'SPX-USD-PERP', isBuy: true, orderType: 'market', qty: '1', legs: null };
  await assert.rejects(e.execute(o, e.plan(o)));
  assert.equal(writes(v).length, 1);
});
t('engine: per-order cap and per-minute limit block before sending', async () => {
  const { e, v } = await ready({}, { maxNotionalUsd: 5000, maxOrdersPerMin: 2 });
  assert.match(e.plan({ symbol: 'SPX-USD-PERP', isBuy: true, orderType: 'market', qty: '1' }).error, /over your limit/);
  e.setSettings(Object.assign({}, e.settings, { maxNotionalUsd: 100000 }));
  e.setCopy(true);
  assert.match(e.plan({ symbol: 'SPX-USD-PERP', isBuy: true, orderType: 'market', qty: '1' }).error, /order requests/);   // 3 accounts > 2/min
  e.setCopy(false);
  const o = { symbol: 'SPX-USD-PERP', isBuy: true, orderType: 'market', qty: '1' };
  await e.execute(o, e.plan(o)); await e.execute(o, e.plan(o));
  assert.match(e.plan(o).error, /left this minute/);
  await assert.rejects(e.send(ACC.M, 'POST', '/v3/positions/open', {}), /limit reached/);
  assert.equal(writes(v).length, 2);
});
t('engine: kill switch stops mirroring of Vest\'s own form', async () => {
  const pos = [{ positionId: 'pm', account_id: ACC.M, symbol: 'SPX-USD-PERP', side: 'long', quantity: '2', openPrice: '7400', leverage: '5', takeProfits: [], stopLosses: [] },
    { positionId: 'pf1', account_id: ACC.F1, symbol: 'SPX-USD-PERP', side: 'long', quantity: '1', openPrice: '7401', leverage: '5', takeProfits: [], stopLosses: [{ id: 'sl1', executionType: 'market', triggerPrice: '7390' }] }];
  const { e, v, w } = await ready({ positions: pos }, { followers: [ACC.F1] });
  e.acctTok[ACC.M] = { t: 'vest-own-master-token', exp: 9e15 };      // Vest's page minted this; the engine learnt it from the hook
  e.tokAcct['vest-own-master-token'] = ACC.M;
  const vestPost = (path, body, method = 'POST') => w.fetch(GW + path, { method, headers: { Authorization: 'Bearer vest-own-master-token' }, body: JSON.stringify(body) });
  e.setCopy(true);
  await vestPost('/v3/positions/stop-loss', { positionId: 'pm', stopLossId: 'x', executionType: 'market', triggerPrice: '7395' }, 'PUT');
  await new Promise((r) => setTimeout(r, 20));
  const moved = writes(v).filter((c) => c.auth === 'Bearer acc-' + ACC.F1);
  assert.equal(moved.length, 1); assert.equal(moved[0].m, 'PUT'); assert.deepEqual(moved[0].body, { positionId: 'pf1', stopLossId: 'sl1', executionType: 'market', triggerPrice: '7395' });
  await vestPost('/v3/positions/close', { symbol: 'SPX-USD-PERP', positionId: 'pm', orderType: 'market', leverage: '5' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(writes(v).filter((c) => c.auth === 'Bearer acc-' + ACC.F1 && c.path === '/v3/positions/close')[0].body.positionId, 'pf1');
  e.setCopy(false);
  const before = writes(v).length;
  await vestPost('/v3/positions/open', { symbol: 'SPX-USD-PERP', side: 'long', orderType: 'market', quantity: '1', leverage: '5', timeInForce: 'IOC', takeProfits: [], stopLosses: [] });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(writes(v).length, before + 1);   // only Vest's own call, nothing copied
});
t('engine: a follower holding the other side is never flipped', async () => {
  const pos = [{ positionId: 'pf1', account_id: ACC.F1, symbol: 'SPX-USD-PERP', side: 'short', quantity: '1', openPrice: '7401', leverage: '5', takeProfits: [], stopLosses: [] }];
  const { e, v, w } = await ready({ positions: pos }, { followers: [ACC.F1] });
  e.tokAcct['mt'] = ACC.M; e.setCopy(true);
  await w.fetch(GW + '/v3/positions/open', { method: 'POST', headers: { Authorization: 'Bearer mt' }, body: JSON.stringify({ symbol: 'SPX-USD-PERP', side: 'long', orderType: 'market', quantity: '1', leverage: '5', timeInForce: 'IOC', takeProfits: [], stopLosses: [] }) });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(writes(v).filter((c) => c.auth === 'Bearer acc-' + ACC.F1).length, 0);
  assert.ok(e.log.some((l) => /other side/.test(l.text)));
});
t('engine: breakeven moves each account\'s stop to its own entry', async () => {
  const pos = [{ positionId: 'pm', account_id: ACC.M, symbol: 'SPX-USD-PERP', side: 'long', quantity: '2', openPrice: '7400.13', leverage: '5', takeProfits: [], stopLosses: [] },
    { positionId: 'pf1', account_id: ACC.F1, symbol: 'SPX-USD-PERP', side: 'long', quantity: '1', openPrice: '7401', leverage: '5', takeProfits: [], stopLosses: [{ id: 'sl1', executionType: 'market', triggerPrice: '7390' }] }];
  const { e, v } = await ready({ positions: pos }, { followers: [ACC.F1] });
  e.setCopy(true);
  await e.setStop('SPX-USD-PERP', 0);
  const w = writes(v);
  assert.deepEqual(w.map((c) => [c.m, c.path, c.body.triggerPrice]), [['POST', '/v3/positions/stop-loss', '7400.25'], ['PUT', '/v3/positions/stop-loss', '7401']]);
});
t('engine: never sends on its own (no timers place orders)', async () => {
  const { v } = await ready();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(writes(v).length, 0);
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n  ')); }
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
