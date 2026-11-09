// Rithmic order entry (ADMIN-ONLY, paper / test only): node tests. No browser, no real Rithmic (127.0.0.1 mock only).
//   node tools/tests/rithmic-trade.test.mjs
// One test per safety layer (see the header of assets/rithmic-trade-core.js), then a full mock round trip:
// login -> sync -> market / limit / stop / bracket -> modify -> cancel -> flatten, P&L + position updates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import * as K from '../../assets/rithmic-trade-core.js';
import { SCHEMA, encode } from '../../assets/rithmic-proto.js';
import { ALLOWED_TEMPLATES as RO_ALLOWED } from '../../assets/rithmic-orders.js';

let pass = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('PASS ' + name); }, (e) => { console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; });
const root = new URL('../../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. read-only module untouched --------------------------------------------------------------------------------
// sha256 of the read-only files at origin/main when this feature was built (2026-11-09). If one of these changes, a
// human must re-review that the Journal import is still read-only, then update the hash here.
const RO_HASH = {
  'assets/rithmic-orders.js': '842ec0fa23766a1c0e1f0a2b0a15b6de321f85820fb8b82548f4c1426351eade', 'assets/rithmic-proto.js': '9adfa0631799494f93e6b154bccae67d03b5784dfc1e7114b5333a54c4a3d6c2', 'tools/tests/rithmic-orders.test.mjs': 'da3fea24643427f050ed189e40fc821b4b18ae825beb05a620f94852e05978cc'
};
await t('read-only module + codec + its test are byte-identical to the reviewed version', () => {
  for (const [f, h] of Object.entries(RO_HASH)) assert.equal(crypto.createHash('sha256').update(read(f)).digest('hex'), h, f + ' changed');
});
await t('read-only allow-list still has no order template; read-only codec still cannot encode one', () => {
  for (const id of K.ORDER_TEMPLATES) { assert.ok(!RO_ALLOWED.includes(id), String(id)); assert.equal(SCHEMA[id], undefined); assert.throws(() => encode({ template_id: id }), /unknown template/); }
});
await t('the Journal import never imports the trading module', () => {
  for (const f of ['assets/rithmic-orders.js', 'assets/rithmic-fills.js', 'assets/rithmic-journal-ui.js', 'assets/rithmic-proto.js', 'assets/rithmic-client.js', 'assets/rithmic-ui.js', 'assets/rithmic-provider.js'])
    assert.doesNotMatch(read(f), /rithmic-trade/, f);
});

// ---- 2. template allow-list ----------------------------------------------------------------------------------------
await t('template sets: read-only + guarded = allow-list exactly; every order template is guarded; kill switch const exists', () => {
  const A = new Set(K.TRADE_ALLOWED_TEMPLATES), RO = new Set(K.READ_ONLY_TEMPLATES);
  for (const id of RO) assert.ok(A.has(id), id + ' read-only but not allowed');
  for (const id of K.ORDER_TEMPLATES) assert.ok(A.has(id) && !RO.has(id), id + ' order template must be guarded');
  assert.deepEqual([...A].filter((id) => !RO.has(id) && id !== 10).sort((a, b) => a - b), [...K.ORDER_TEMPLATES].sort((a, b) => a - b), 'guarded set = order templates');
  assert.equal(typeof K.ORDER_ENTRY_ON, 'boolean');
  assert.match(read('assets/rithmic-trade-core.js'), /if \(!ORDER_ENTRY_ON\) throw/);
});
await t('trade allow-list = exactly the reviewed ids; every order template needs the target guard', () => {
  assert.deepEqual([...K.TRADE_ALLOWED_TEMPLATES].sort((a, b) => a - b), [10, 12, 16, 18, 100, 113, 300, 302, 308, 310, 312, 314, 316, 320, 330, 336, 346, 400, 402, 3504]);
  assert.deepEqual([...K.ORDER_TEMPLATES].sort((a, b) => a - b), [312, 314, 316, 330, 346, 3504]);
  for (const id of [328, 332, 334, 344, 3500, 3502, 3506, 3508, 500, 3510]) assert.ok(!K.TRADE_ALLOWED_TEMPLATES.includes(id), id + ' must not be allowed');
});
await t('send() refuses a template outside the allow-list before writing (fuzz 0..4000)', async () => {
  const s = new K.TradeSession({ gateway: K.TEST_GATEWAY, appName: 'x' });
  s.target = Object.freeze({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] });
  const written = [], plant = new K.TPlant(s, 2);
  plant.ws = { readyState: 1, url: K.TEST_GATEWAY, send: (b) => written.push(b) }; s.order = plant;
  for (let id = 0; id <= 4000; id++) if (!K.TRADE_ALLOWED_TEMPLATES.includes(id)) assert.throws(() => plant.send({ template_id: id }), /Blocked: template/, String(id));
  assert.equal(written.length, 0);
  plant.send({ template_id: 18 }); assert.equal(written.length, 1);
});
async function plantClass() { return K.TPlant; }

// ---- 3. gateway / system allow-list ---------------------------------------------------------------------------------
const PROD = ['wss://rprotocol.rithmic.com:443', 'wss://rprotocol-nyc.rithmic.com:443', 'wss://rprotocol-ie.rithmic.com:443', 'wss://rprotocol-colo75.rithmic.com:443'];
await t('target: only Rithmic Test / Rithmic Paper Trading, exact names, listed by the gateway', () => {
  const ok = (o) => K.checkTarget(o).ok;
  assert.ok(ok({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] }));
  assert.ok(ok({ gateway: 'wss://rituz00100.rithmic.com', system: 'Rithmic Paper Trading', systems: ['Rithmic Paper Trading'] }));
  // Paper Trading on the production hosts stays OFF until its fcm / ib / route are pinned (advisor M2)
  assert.equal(K.ALLOW_PAPER_ON_PRODUCTION_HOSTS, false);
  for (const g of PROD) assert.ok(!ok({ gateway: g, system: 'Rithmic Paper Trading', systems: ['Rithmic Paper Trading', 'Rithmic 01'] }), g);
  // live / prop systems are refused everywhere
  for (const sys of ['Rithmic 01', 'Rithmic 04 Colo', 'Apex', 'TradeSea', 'Topstep', 'rithmic test', 'Rithmic Test ', ' Rithmic Paper Trading', 'Rithmic Paper', '', null, undefined])
    for (const g of [K.TEST_GATEWAY, ...PROD]) assert.ok(!ok({ gateway: g, system: sys, systems: [sys] }), JSON.stringify([g, sys]));
  // Rithmic Test is not allowed on a production host
  for (const g of PROD) assert.ok(!ok({ gateway: g, system: 'Rithmic Test', systems: ['Rithmic Test'] }), g);
  // the gateway must have listed the name
  assert.ok(!ok({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic 01'] }));
  assert.ok(!ok({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: undefined }));
  // look-alike / odd URLs
  for (const g of ['wss://rituz00100.rithmic.com.evil.io:443', 'wss://evil.io/rituz00100.rithmic.com', 'ws://rituz00100.rithmic.com:443', 'wss://rituz00100.rithmic.com:444', 'wss://user@rituz00100.rithmic.com:443',
    'wss://rituz00100.rithmic.com:443/x', 'wss://rituz00100.rithmic.com:443?a=1', 'wss://rprotocol.rithmic.com.evil.io:443', 'https://rituz00100.rithmic.com', 'ws://127.0.0.1:8765', ''])
    assert.ok(!ok({ gateway: g, system: 'Rithmic Test', systems: ['Rithmic Test'] }) && !ok({ gateway: g, system: 'Rithmic Paper Trading', systems: ['Rithmic Paper Trading'] }), g);
  // mock only with the dev switch
  assert.ok(ok({ gateway: 'ws://127.0.0.1:8765', system: 'Rithmic Test', systems: ['Rithmic Test'], allowMock: true }));
  assert.ok(!ok({ gateway: 'ws://10.0.0.5:8765', system: 'Rithmic Test', systems: ['Rithmic Test'], allowMock: true }));
});
await t('every real gateway in rithmic-config.js is refused for every non-paper system it could list', async () => {
  const src = read('assets/rithmic-config.js');
  const uris = [...src.matchAll(/uri: '(wss:[^']+)'/g)].map((m) => m[1]);
  assert.ok(uris.length >= 13);
  for (const g of uris) for (const sys of ['Rithmic 01', 'Apex', 'TradeSea', 'Rithmic 04 Colo']) assert.equal(K.checkTarget({ gateway: g, system: sys, systems: [sys] }).ok, false, g + ' ' + sys);
});
await t('live flag on still opens nothing: no live path', () => {
  assert.equal(K.checkTarget({ gateway: PROD[0], system: 'Rithmic 01', systems: ['Rithmic 01'], live: true }).ok, false);
  assert.match(K.checkTarget({ gateway: PROD[0], system: 'Rithmic 01', systems: ['Rithmic 01'], live: true }).why, /not built/);
});
await t('connect() refuses a live system BEFORE opening any socket', async () => {
  let opened = 0;
  class WS { constructor() { opened++; } }
  for (const [g, sys] of [[PROD[0], 'Rithmic 01'], [K.TEST_GATEWAY, 'Apex'], [PROD[1], 'Rithmic Test']]) {
    const s = new K.TradeSession({ gateway: g, appName: 'x', WebSocketImpl: WS });
    await assert.rejects(s.connect({ user: 'u', password: 'p', systemName: sys }), /limited to|refused/);
    assert.equal(s.log[0].result, 'refused');
  }
  assert.equal(opened, 0);
});
await t('order send re-checks the target: tampered system, wrong socket url, non-order plant -> blocked, nothing written', async () => {
  const TPlant = await plantClass();
  const mk = (target, url) => { const s = new K.TradeSession({ gateway: target.gateway, appName: 'x' }); s.target = Object.freeze(target); s.accounts = [{ id: 'A' }]; s.routes = { CME: 'sim' }; const w = []; const p = new TPlant(s, 2); p.ws = { readyState: 1, url, send: (b) => w.push(b) }; s.order = p; return { s, p, w }; };
  let x = mk({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] }, K.TEST_GATEWAY + '/');
  for (const id of K.ORDER_TEMPLATES) x.p.send({ template_id: id, account_id: 'A', ...(id === 312 || id === 330 ? { quantity_64: 1 } : {}) });
  assert.equal(x.w.length, K.ORDER_TEMPLATES.length, 'paper target sends');
  x = mk({ gateway: K.TEST_GATEWAY, system: 'Rithmic 01', systems: ['Rithmic 01'] }, K.TEST_GATEWAY);
  for (const id of K.ORDER_TEMPLATES) assert.throws(() => x.p.send({ template_id: id }), /Blocked/); assert.equal(x.w.length, 0);
  x = mk({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] }, 'wss://rprotocol.rithmic.com/');
  for (const id of K.ORDER_TEMPLATES) assert.throws(() => x.p.send({ template_id: id }), /not on the checked gateway/); assert.equal(x.w.length, 0);
  x = mk({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] }, K.TEST_GATEWAY); x.s.target = null;
  assert.throws(() => x.p.send({ template_id: 312 }), /no checked trading target/);
  x = mk({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] }, K.TEST_GATEWAY);
  const pnl = new TPlant(x.s, 4); pnl.ws = x.p.ws; assert.throws(() => pnl.send({ template_id: 312 }), /order plant/);
  assert.ok(Object.isFrozen(K.PAPER_SYSTEMS)); assert.throws(() => { 'use strict'; K.PAPER_SYSTEMS.push('Rithmic 01'); });
});

await t('login frame (10) must name the checked system on the checked socket (advisor H1)', async () => {
  const TPlant = await plantClass();
  const s = new K.TradeSession({ gateway: K.TEST_GATEWAY, appName: 'x' }); s.target = Object.freeze({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] });
  const w = []; const p = new TPlant(s, 2); p.ws = { readyState: 1, url: K.TEST_GATEWAY, send: (b) => w.push(b) }; s.order = p;
  for (const name of ['Rithmic 01', 'Rithmic Paper Trading', 'rithmic test', '', undefined]) assert.throws(() => p.send({ template_id: 10, system_name: name }), /login frame/, String(name));
  p.ws.url = 'wss://rprotocol.rithmic.com:443'; assert.throws(() => p.send({ template_id: 10, system_name: 'Rithmic Test' }), /checked gateway/);
  p.ws.url = K.TEST_GATEWAY; s.target = null; assert.throws(() => p.send({ template_id: 10, system_name: 'Rithmic Test' }), /login frame/);
  assert.equal(w.length, 0);
  s.target = Object.freeze({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] }); p.send({ template_id: 10, system_name: 'Rithmic Test' }); assert.equal(w.length, 1);
  assert.match(read('assets/rithmic-trade-core.js'), /system_name: this\.s\.target\.system/, 'TPlant.open builds the name from the frozen target only');
});
await t('wire invariants on every guarded frame, even hand-built ones (advisor H3): account, qty cap, route, bracket', async () => {
  const x = await readySession({ maxQty: 2 });
  const sent = []; x.p.ws.send = (b) => sent.push(b);
  const ok = { template_id: 312, account_id: 'PAPER-1', quantity_64: 1, trade_route: 'simulator' };
  x.p.send(ok); assert.equal(sent.length, 1);
  const bad = [{ ...ok, account_id: 'LIVE-1' }, { ...ok, account_id: undefined }, { ...ok, quantity_64: 3 }, { ...ok, quantity_64: 1.5 }, { ...ok, quantity_64: undefined }, { ...ok, trade_route: 'live-route' },
    { ...ok, template_id: 330, target_quantity_64: [2], target_ticks: [4] }, { ...ok, template_id: 330, stop_ticks: [0] }, { ...ok, template_id: 330, stop_ticks: [401] }, { template_id: 346 }, { template_id: 3504, account_id: 'X' }];
  for (const m of bad) assert.throws(() => x.p.send(m), /Blocked/, JSON.stringify(m));
  assert.equal(sent.length, 1);
  x.s.maxQty = 99; assert.throws(() => x.p.send({ ...ok, quantity_64: 6 }), /cap/);
});

// ---- 4. live double gate ------------------------------------------------------------------------------------------
await t('live double gate: constant false in config; both needed; server read errors fail closed', async () => {
  assert.match(read('assets/rithmic-config.js'), /^export const RITHMIC_LIVE_TRADING = false;$/m);
  let reads = 0; const srv = (v) => async () => { reads++; return v; };
  assert.equal(await K.liveTradingAllowed({ constFlag: false, readServerFlag: srv(true) }), false); assert.equal(reads, 0);
  assert.equal(await K.liveTradingAllowed({ constFlag: true, readServerFlag: srv(false) }), false);
  assert.equal(await K.liveTradingAllowed({ constFlag: true, readServerFlag: srv('true') }), false);
  assert.equal(await K.liveTradingAllowed({ constFlag: true, readServerFlag: async () => { throw new Error('permission-denied'); } }), false);
  assert.equal(await K.liveTradingAllowed({ constFlag: true, readServerFlag: srv(true) }), true);
  assert.equal(await K.liveTradingAllowed({ constFlag: 'true', readServerFlag: srv(true) }), false);
});
await t('Firestore rules: no rule opens config/rithmicTrading (default deny)', () => {
  const r = read('functions-src/firestore.rules');
  assert.doesNotMatch(r, /match \/config\b/); assert.doesNotMatch(r, /rithmicTrading/);
  assert.match(r, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});

// ---- 5. admin gate (static) ---------------------------------------------------------------------------------------
await t('admin gate: the trading module is only imported after admins/{uid} exists; nothing else imports it', () => {
  const cfg = read('assets/rithmic-config.js');
  const fn = cfg.slice(cfg.indexOf('export function mountRithmicTradingIfAdmin'));
  const iAdmin = fn.indexOf("collection('admins')"), iExists = fn.indexOf('if (!a.exists) return;'), iImp = fn.indexOf("import('./rithmic-trade.js");
  assert.ok(iAdmin > 0 && iExists > iAdmin && iImp > iExists, 'admins check -> exists -> import');
  const users = execFileSync('grep', ['-rlE', "rithmic-trade(-core)?\\.js", 'assets', '--include=*.js', '--include=*.html'], { cwd: root.pathname }).toString().trim().split('\n').sort();
  // only the gate (config) and the module itself (+ its core) name the trading module; vela-chart and the ladder only name the inert layer / window hook
  assert.deepEqual(users, ['assets/chart-book-panel.js', 'assets/rithmic-config.js', 'assets/rithmic-trade-core.js', 'assets/rithmic-trade-layer.js', 'assets/rithmic-trade.js'].sort(), users.join(' '));
  assert.doesNotMatch(read('assets/chart-book-panel.js'), /import\(?['"].*rithmic-trade/);
  const core = execFileSync('grep', ['-rlE', "import[^;]*rithmic-trade(-core)?\\.js", 'assets'], { cwd: root.pathname }).toString().trim().split('\n').sort();
  assert.deepEqual(core, ['assets/rithmic-config.js', 'assets/rithmic-trade.js'], core.join(' '));
  assert.doesNotMatch(read('assets/vela-chart.js'), /rithmic-trade(-core)?\.js/, 'vela-chart only loads the inert layer');
  assert.doesNotMatch(read('assets/rithmic-trade-layer.js'), /^\s*import\b|import\(|fetch\(|WebSocket|template_id/m, 'layer is inert');
  for (const f of fs.readdirSync(root.pathname).filter((x) => x.endsWith('.html'))) assert.doesNotMatch(read(f), /rithmic-trade/, f);
});

// ---- 6. order guards (unit, on a session forced to ready) --------------------------------------------------------
async function readySession(opts = {}) {
  const TPlant = await plantClass();
  let now = 1_000_000;
  const s = new K.TradeSession({ gateway: K.TEST_GATEWAY, appName: 'x', maxQty: opts.maxQty ?? 1, now: () => now, logSink: () => {} });
  s.target = Object.freeze({ gateway: K.TEST_GATEWAY, system: 'Rithmic Test', systems: ['Rithmic Test'] });
  const p = new TPlant(s, 2); p.ws = { readyState: 1, url: K.TEST_GATEWAY, send: () => {} }; s.order = p;
  s.state = 'ready';
  s.accounts = [{ id: 'PAPER-1', fcm_id: 'F', ib_id: 'I' }];
  s.routes = { CME: 'simulator' };
  s.contracts.set('MES', 'MESZ6');
  s.quotes.set('MESZ6', { bid: 5000, ask: 5000.25, last: 5000, at: now });
  return { s, p, tick: (ms) => { now += ms; }, setNow: (v) => { now = v; }, get now() { return now; } };
}
const base = { account: 'PAPER-1', root: 'MES', side: 'buy', type: 'limit', qty: 1, price: 4999 };
await t('size cap: whole contracts, 1..admin max, admin max clamps to hard cap 5', async () => {
  assert.equal(K.clampMaxQty(99), 5); assert.equal(K.clampMaxQty(0), 1); assert.equal(K.clampMaxQty('x'), 1); assert.equal(K.clampMaxQty(3.9), 3); assert.equal(K.LIMITS.hardMaxQty, 5);
  let { s } = await readySession();
  assert.throws(() => s.prepare({ ...base, qty: 2 }), /Max 1 contract/);
  for (const q of [0, -1, 1.5, '1e0x', NaN]) assert.throws(() => s.prepare({ ...base, qty: q }), /whole number/, String(q));
  s.prepare({ ...base, qty: 1 });
  ({ s } = await readySession({ maxQty: 50 }));
  assert.equal(s.maxQty, 5);
  s.prepare({ ...base, qty: 5 }); assert.throws(() => s.prepare({ ...base, qty: 6 }), /Max 5/);
  s.maxQty = 100; assert.equal(s.maxQty, 5, 'setter clamps'); assert.throws(() => s.prepare({ ...base, qty: 6 }), /Max 5/);
});
await t('stale prices (> 5 s since last update, local clock) block new orders and modifies; risk-reducing actions still go', async () => {
  const x = await readySession();
  x.s.prepare(base);
  x.tick(5001);
  assert.throws(() => x.s.prepare(base), /stale/);
  assert.throws(() => x.s.prepare({ ...base, type: 'market' }), /stale/);
  // stale while the confirm sheet was open: submit re-checks
  x.s.quotes.get('MESZ6').at = x.now; const tk = x.s.prepare(base); x.tick(6000);
  await assert.rejects(x.s.submit(tk), /stale/);
  // no quote at all
  x.s.quotes.delete('MESZ6'); assert.throws(() => x.s.prepare(base), /stale/);
  // cancel / cancel all / exit are not blocked by stale prices (they fail here only because the fake socket never answers)
  x.s.timeoutMs = 20; x.s.orders.set('B1', { basket: 'B1', account: 'PAPER-1', symbol: 'MESZ6', kind: 'working', type: 'limit', price: 4990 });
  await assert.rejects(x.s.cancel('B1'), /did not answer/); await assert.rejects(x.s.cancelAll('PAPER-1'), /did not answer/); await assert.rejects(x.s.exitPosition('PAPER-1'), /did not answer/);
});
await t('not connected / disconnected / syncing: every action blocked', async () => {
  const x = await readySession();
  for (const st of ['idle', 'connecting', 'syncing', 'disconnected']) {
    x.s.state = st;
    assert.throws(() => x.s.prepare(base), /Not connected|Disconnected/);
    await assert.rejects(x.s.cancelAll('PAPER-1'), /Not connected|Disconnected/);
    await assert.rejects(x.s.flatten('PAPER-1'), /Not connected|Disconnected/);
  }
  x.s.state = 'ready'; x.p.ws.readyState = 3; assert.throws(() => x.s.prepare(base), /Not connected/);
});
await t('price checks: on tick, within the band; stops on the right side; unknown instrument / contract / account refused', async () => {
  const { s } = await readySession({ maxQty: 5 });
  assert.throws(() => s.prepare({ ...base, price: 4999.1 }), /tick/);
  assert.throws(() => s.prepare({ ...base, price: 5000 + 401 * 0.25 }), /too far/);
  assert.throws(() => s.prepare({ ...base, price: 0 }), /tick|far/);
  assert.throws(() => s.prepare({ ...base, type: 'stop', trigger: 4990 }), /above the market/);
  assert.throws(() => s.prepare({ ...base, side: 'sell', type: 'stop', trigger: 5010 }), /below the market/);
  s.prepare({ ...base, type: 'stop', trigger: 5010 });
  assert.throws(() => s.prepare({ ...base, root: 'BTC' }), /not enabled/);
  assert.throws(() => s.prepare({ ...base, account: 'LIVE-9' }), /Unknown account/);
  assert.throws(() => s.prepare({ ...base, contract: 'ESZ6' }), /Contract not confirmed/);
  assert.throws(() => s.prepare({ ...base, type: 'stop_limit' }), /market, limit or stop/);
  assert.throws(() => s.prepare({ ...base, side: 'short' }), /buy or sell/);
  assert.throws(() => s.prepare({ ...base, tpTicks: 0.5 }), /1 to 400/);
  s.routes = {}; assert.throws(() => s.prepare(base), /No trade route/);
});
await t('ticket is frozen and is exactly what gets encoded: side enum, qty, price, bracket fields', async () => {
  const { s } = await readySession({ maxQty: 2 });
  const tk = s.prepare({ ...base, side: 'sell', qty: 2, price: 5001.25, tpTicks: 8, slTicks: 4 });
  assert.ok(Object.isFrozen(tk) && Object.isFrozen(tk.msg));
  const m = K.tDecode(K.tEncode(tk.msg));
  assert.equal(m.template_id, 330); assert.equal(m.transaction_type, 2); assert.equal(m.quantity_64, 2); assert.equal(m.price, 5001.25); assert.equal(m.price_type, 1);
  assert.deepEqual(m.target_ticks, [8]); assert.deepEqual(m.stop_ticks, [4]); assert.equal(m.bracket_type, 3); assert.equal(m.account_id, 'PAPER-1'); assert.equal(m.symbol, 'MESZ6'); assert.equal(m.exchange, 'CME');
  assert.match(m.user_tag, /^stkrt/);
  const mk = K.tDecode(K.tEncode(s.prepare({ ...base, type: 'market' }).msg)); assert.equal(mk.template_id, 312); assert.equal(mk.price_type, 2); assert.equal(mk.price, undefined); assert.equal(mk.transaction_type, 1);
  const st = K.tDecode(K.tEncode(s.prepare({ ...base, type: 'stop', trigger: 5010.5 }).msg)); assert.equal(st.price_type, 4); assert.equal(st.trigger_price, 5010.5);
  await assert.rejects(s.submit({ ...tk }), /Not a prepared order/);
  await assert.rejects(s.submit(Object.freeze({ ...tk })), /Not a prepared order/);
  const other = (await readySession({ maxQty: 2 })).s; await assert.rejects(other.submit(tk), /Not a prepared order/, 'ticket from another session');
});
await t('one new order in flight; a timeout is "unknown", never re-sent, and blocks new orders + modifies (advisor M5)', async () => {
  const x = await readySession();
  let sends = 0; x.p.ws.send = () => { sends++; };
  x.s.timeoutMs = 30;
  const a = x.s.submit(x.s.prepare(base));
  await assert.rejects(x.s.submit(x.s.prepare(base)), /already being sent/);
  await assert.rejects(a, /did not answer/);
  assert.equal(sends, 1, 'exactly one frame for two clicks');
  assert.match(x.s.log.find((e) => e.action === 'new order' && /unknown/.test(e.result)).result, /not re-sent/);
  await sleep(50); assert.equal(sends, 1, 'no retry later');
  assert.equal(x.s.unknownOrder, true); assert.throws(() => { x.s.unknownOrder = false; }); 
  assert.throws(() => x.s.prepare(base), /unknown/);
  x.s.orders.set('B9', { basket: 'B9', account: 'PAPER-1', symbol: 'MESZ6', kind: 'working', type: 'limit', price: 4990, qty: 1 });
  assert.throws(() => x.s.prepareModify('B9', { price: 4991 }), /unknown/);
});
await t('rate limit: 5 actions / 10 s', async () => {
  const x = await readySession();
  // the fake plant answers every request with a reject straight away
  x.p.ws.send = (b) => { const m = K.tDecode(b); queueMicrotask(() => x.p.onFrame(K.tEncode({ template_id: m.template_id + 1, user_msg: m.user_msg, rp_code: ['5', 'rejected'] }))); };
  for (let i = 0; i < 5; i++) await assert.rejects(x.s.submit(x.s.prepare(base)), /rejected/);
  await assert.rejects(x.s.submit(x.s.prepare(base)), /Too many orders/);
  x.tick(10001); x.s.quotes.get('MESZ6').at = x.now;
  await assert.rejects(x.s.submit(x.s.prepare(base)), /rejected/);
});
await t('status text: unknown statuses never count as done', () => {
  assert.equal(K.statusKind({ status: 'complete' }), 'done'); assert.equal(K.statusKind({ status: 'open' }), 'working'); assert.equal(K.statusKind({ status: 'partial' }), 'working');
  assert.equal(K.statusKind({ status: 'weird new status' }), 'unknown'); assert.equal(K.statusKind({}), 'unknown');
});
await t('log: no credentials, ever', async () => {
  const s = new K.TradeSession({ gateway: K.TEST_GATEWAY, appName: 'x', WebSocketImpl: class {} , logSink: () => {} });
  await assert.rejects(s.connect({ user: 'secret-user-x', password: 'hunter2-pass', systemName: 'Rithmic 01' }));
  assert.doesNotMatch(JSON.stringify(s.log), /hunter2|secret-user-x/);
});
await t('codec: shared messages encode byte-identically to the read-only codec (no drift)', () => {
  const msgs = [{ template_id: 10, template_version: '5.55', user: 'u', password: 'p', app_name: 'ZoroCharts', app_version: '1', system_name: 'Rithmic Test', infra_type: 2, os_platform: 'browser', user_msg: ['a'] },
    { template_id: 18 }, { template_id: 16, user_msg: ['s'] }, { template_id: 300, user_msg: ['x'] }, { template_id: 302, fcm_id: 'F', ib_id: 'I', user_type: 3 }, { template_id: 320, fcm_id: 'F', ib_id: 'I', account_id: 'A' },
    { template_id: 113, symbol: 'ES', exchange: 'CME', need_updates: false }, { template_id: 100, symbol: 'ESZ6', exchange: 'CME', request: 1, update_bits: 3 }];
  for (const m of msgs) assert.deepEqual(Buffer.from(K.tEncode(m)), Buffer.from(encode(m)), String(m.template_id));
  assert.equal(K.tDecode(K.tEncode({ template_id: 312, price: 4500.25 })).price, 4500.25);
});

// ---- 7. mock round trip ---------------------------------------------------------------------------------------------
const PORT = 8793, GW = 'ws://127.0.0.1:' + PORT, CTL = 'http://127.0.0.1:' + PORT + '/__trade/';
const mock = spawn('node', [new URL('./rithmic-mock.mjs', import.meta.url).pathname, String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => mock.stdout.once('data', r));
const ctl = async (c) => (await fetch(CTL + c)).json();
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(25); } return false; };
const open = () => new K.TradeSession({ gateway: GW, appName: 'ZoroCharts', appVersion: '0', WebSocketImpl: WebSocket, allowMock: true, maxQty: 2, logSink: () => {} });
try {
  await t('mock: non-paper system is refused before login (mock lists it)', async () => {
    const s = open();
    await assert.rejects(s.connect({ user: 'demo-trade', password: 'demo-pass', systemName: 'Apex' }), /limited to/);
    const st = await ctl('state'); assert.equal(st.trade.orders.length, 0);
  });
  await t('mock: login, accounts, routes, sync, market + limit + stop + bracket, fills, P&L, modify, cancel, flatten', async () => {
    await ctl('reset');
    const s = open();
    await s.connect({ user: 'demo-trade', password: 'demo-pass', systemName: 'Rithmic Test' });
    assert.equal(s.state, 'ready'); assert.deepEqual(s.accounts.map((a) => a.id), ['PAPER-1', 'PAPER-2']); assert.equal(s.routes.CME, 'simulator');
    assert.equal(await s.resolveContract('ES'), 'ESZ6');
    s.contracts.set('MES', 'MESZ6');
    await s.watch('ESZ6', 'CME');
    assert.ok(await waitFor(() => s.fresh('ESZ6')), 'quotes arrive');
    const q = s.quote('ESZ6'), A = 'PAPER-1', R = { account: A, root: 'ES' };
    // market buy 1 -> filled, long 1
    await s.submit(s.prepare({ ...R, side: 'buy', type: 'market', qty: 1 }));
    assert.ok(await waitFor(() => (s.position(A, 'ESZ6') || {}).net === 1), 'position long 1');
    assert.ok(s.fills.length === 1 && s.fills[0].side === 'buy');
    assert.ok(await waitFor(() => (s.acctPnl.get(A) || {}).balance != null), 'account balance from PnL plant');
    // working limit below the market, then modify, then cancel
    const lim = Math.round((q.bid - 20) / 0.25) * 0.25;
    const { basket } = await s.submit(s.prepare({ ...R, side: 'buy', type: 'limit', qty: 1, price: lim }));
    assert.ok(await waitFor(() => (s.orders.get(basket) || {}).kind === 'working'));
    await s.submitModify(s.prepareModify(basket, { price: lim - 1 }));
    assert.ok(await waitFor(() => s.orders.get(basket).price === lim - 1), 'modified price');
    await s.cancel(basket);
    assert.ok(await waitFor(() => s.orders.get(basket).kind === 'done'), 'cancelled');
    await assert.rejects(s.submitModify({ kind: 'modify', msg: Object.freeze({}), basket }), /no longer working|Not a prepared/);
    // stop above the market works; then the mock triggers it
    const stp = await s.submit(s.prepare({ ...R, side: 'buy', type: 'stop', qty: 1, trigger: Math.round((q.ask + 10) / 0.25) * 0.25 }));
    assert.ok(await waitFor(() => (s.orders.get(stp.basket) || {}).type === 'stop'));
    await ctl('fill?basket=' + stp.basket);
    assert.ok(await waitFor(() => (s.position(A, 'ESZ6') || {}).net === 2), 'long 2 after the stop filled');
    // bracket: sell 1 at market with TP 8 / SL 4 -> two children working
    await sleep(2100);   // rate limit window
    await s.submit(s.prepare({ ...R, side: 'sell', type: 'market', qty: 1, tpTicks: 8, slTicks: 4 }));
    assert.ok(await waitFor(() => s.working(A).filter((o) => o.parent).length === 2), 'bracket children working');
    const kids = s.working(A).filter((o) => o.parent);
    assert.deepEqual(kids.map((o) => o.role).sort(), ['sl', 'tp']);
    assert.ok(await waitFor(() => s.bracket.size === 1), 'bracket update (353)');
    // flatten: everything cancelled first, then exit -> flat, never reversed
    await s.flatten(A);
    assert.ok(await waitFor(() => s.working(A).length === 0 && (s.position(A, 'ESZ6') || {}).net === 0), 'flat with no working orders');
    const st = await ctl('state');
    const tids = st.trade.orders.map((o) => o.tid);
    assert.ok(tids.indexOf(346) < tids.lastIndexOf(3504), 'cancel all before exit position');
    assert.deepEqual(st.trade.nonPaper, []); assert.equal(st.pos['PAPER-1|ESZ6'].net, 0);
    const log = s.log.map((e) => e.action + ':' + e.result).join(' ');
    for (const k of ['new order:accepted', 'modify:accepted', 'cancel:accepted', 'cancel all:accepted', 'exit position:accepted', 'flatten:sent', 'fill:filled']) assert.ok(log.includes(k), k);
    await s.close();
  });
  await t('mock: rejected order is logged as rejected; slow ack + double submit = one order; stale feed blocks', async () => {
    await ctl('reset');
    const s = open();
    await s.connect({ user: 'demo-trade', password: 'demo-pass', systemName: 'Rithmic Paper Trading' });
    s.contracts.set('ES', 'ESZ6'); await s.watch('ESZ6', 'CME'); await waitFor(() => s.fresh('ESZ6'));
    await ctl('reject?n=1');
    await assert.rejects(s.submit(s.prepare({ account: 'PAPER-2', root: 'ES', side: 'buy', type: 'market', qty: 1 })), /rejected by mock/);
    assert.equal(s.log.find((e) => e.action === 'new order').result, 'rejected');
    await ctl('slow?ms=600');
    const p1 = s.submit(s.prepare({ account: 'PAPER-2', root: 'ES', side: 'buy', type: 'market', qty: 1 }));
    await assert.rejects(s.submit(s.prepare({ account: 'PAPER-2', root: 'ES', side: 'buy', type: 'market', qty: 1 })), /already being sent/);
    await p1; await ctl('slow?ms=0');
    const st = await ctl('state'); assert.equal(st.trade.orders.filter((o) => o.tid === 312).length, 2, 'reject + one accepted, no double');
    await ctl('freeze?on=1'); await sleep(5300);
    assert.throws(() => s.prepare({ account: 'PAPER-2', root: 'ES', side: 'sell', type: 'market', qty: 1 }), /stale/);
    await ctl('freeze?on=0');
    await s.flatten('PAPER-2');
    await s.close();
  });
  await t('mock: dropped connection locks trading; nothing is re-sent; re-login rebuilds working orders from Rithmic', async () => {
    await ctl('reset');
    let s = open();
    await s.connect({ user: 'demo-trade', password: 'demo-pass', systemName: 'Rithmic Test' });
    s.contracts.set('ES', 'ESZ6'); await s.watch('ESZ6', 'CME'); await waitFor(() => s.fresh('ESZ6'));
    const q = s.quote('ESZ6');
    const { basket } = await s.submit(s.prepare({ account: 'PAPER-1', root: 'ES', side: 'buy', type: 'limit', qty: 1, price: Math.round((q.bid - 25) / 0.25) * 0.25 }));
    const before = (await ctl('state')).trade.orders.length;
    await fetch('http://127.0.0.1:' + PORT + '/__drop');
    assert.ok(await waitFor(() => s.state === 'disconnected'), 'locked');
    assert.throws(() => s.prepare({ account: 'PAPER-1', root: 'ES', side: 'buy', type: 'market', qty: 1 }), /Disconnected/);
    await assert.rejects(s.flatten('PAPER-1'), /Disconnected/);
    await sleep(300);
    assert.equal((await ctl('state')).trade.orders.length, before, 'nothing re-sent');
    await s.close(true);
    s = open();
    await s.connect({ user: 'demo-trade', password: 'demo-pass', systemName: 'Rithmic Test' });
    assert.ok(s.orders.has(basket) && s.orders.get(basket).kind === 'working', 'working order rebuilt from show orders (320)');
    s.contracts.set('ES', 'ESZ6'); await s.watch('ESZ6', 'CME'); await waitFor(() => s.fresh('ESZ6'));
    await s.flatten('PAPER-1');
    assert.ok(await waitFor(() => s.working('PAPER-1').length === 0));
    await s.close();
  });
  await t('mock: every frame on the wire was in the trade allow-list; no order ever reached a non-paper system', async () => {
    const st = await (await fetch('http://127.0.0.1:' + PORT + '/__stats')).json();
    for (const id of Object.keys(st.trade.reqs)) assert.ok(K.TRADE_ALLOWED_TEMPLATES.includes(Number(id)), 'mock received ' + id);
    assert.deepEqual(st.trade.nonPaper, []);
  });
} finally { mock.kill(); }
console.log(pass + ' passed' + (process.exitCode ? ', FAILURES above' : ''));
