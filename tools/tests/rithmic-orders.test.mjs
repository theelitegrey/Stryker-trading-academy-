// Rithmic Journal import (Owner 2026-10-30): node-only tests. No browser, no real Rithmic.
//   node tools/tests/rithmic-orders.test.mjs
// 1. The allowlist: no order-entry template id can be allowed, none can be encoded, and every frame the
//    real session code puts on the wire (against the local mock) is in the allowlist.
// 2. Grouping + P&L: simple long/short, scale in/out, flip, partial fills, two accounts, MNQ+ES mix,
//    unknown symbol (needs a point value), fees, de-dupe, Free plan cap.
// 3. Mock round trip: login -> accounts -> dates -> day history -> PnL snapshot, then permission error text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { T, INFRA, SCHEMA, encode } from '../../assets/rithmic-proto.js';
import { ALLOWED_TEMPLATES, FORBIDDEN_ORDER_TEMPLATES, isAllowedTemplate, ReadOnlyPlant, RithmicOrderHistory, explainHistoryError, MSG_HISTORY_NOT_ENABLED, tradeDateCT } from '../../assets/rithmic-orders.js';
import { fillsFromNotes, buildTrips, tripToJournalTrade, planImport, tripDocId, crossCheck, pointValueFor, rootOf, POINT_VALUES } from '../../assets/rithmic-fills.js';
import { SETS, EXPECTED_1027_A1, EXPECTED_1026_A1, ACCOUNTS } from './rithmic-orders-fixtures.mjs';

let pass = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('PASS ' + name); }, (e) => { console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; });

// ---- 1. allowlist --------------------------------------------------------------------------------
await t('allowlist holds only read-only ids', () => {
  assert.deepEqual([...ALLOWED_TEMPLATES].sort((a, b) => a - b), [10, 12, 16, 18, 300, 302, 318, 320, 324, 326, 402]);
  for (const id of Object.keys(FORBIDDEN_ORDER_TEMPLATES)) assert.equal(isAllowedTemplate(id), false, 'template ' + id + ' must not be allowed');
  // every request-side order-entry id in the Rithmic reference (new/modify/cancel/bracket/oco/exit/link/cancel-all/...) is refused
  for (const id of [312, 314, 316, 330, 332, 334, 346, 3500, 3502, 3504, 3508, 308, 336, 400]) assert.equal(isAllowedTemplate(id), false, String(id));
});
await t('proto cannot even encode an order-entry message', () => {
  for (const id of [312, 314, 316, 330, 3504, 346]) {
    assert.equal(SCHEMA[id], undefined, 'SCHEMA has order template ' + id);
    assert.throws(() => encode({ template_id: id }), /unknown template/);
  }
});
await t('ReadOnlyPlant.send refuses order templates before anything is written', () => {
  const written = [];
  const p = new ReadOnlyPlant({ infra: INFRA.ORDER_PLANT, gateway: 'ws://x', WebSocketImpl: class {} });
  p.ws = { readyState: 1, send: (b) => written.push(b) };
  for (const id of [312, 314, 316, 330, 3504]) assert.throws(() => p.send({ template_id: id }), /Blocked/);
  assert.equal(written.length, 0);
  p.send({ template_id: T.HEARTBEAT });
  assert.equal(written.length, 1);
});
await t('no order-entry token anywhere in the feature source', () => {
  for (const f of ['assets/rithmic-orders.js', 'assets/rithmic-fills.js', 'assets/rithmic-journal-ui.js']) {
    if (!fs.existsSync(new URL('../../' + f, import.meta.url))) continue;
    const src = fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /T\.(NEW_ORDER|MODIFY_ORDER|CANCEL_ORDER|BRACKET|OCO|EXIT_POSITION|LINK_ORDERS|CANCEL_ALL)/, f);
    assert.doesNotMatch(src, /template_id:\s*(312|314|316|330|346|3504)\b/, f);
  }
});

// ---- 2. grouping / P&L ---------------------------------------------------------------------------
// Build 352 fill notifications from the fixture sets exactly as the mock would send them.
function notesFor(acct, day) {
  const out = [];
  for (const o of (SETS[acct] || {})[day] || []) o.fills.forEach((f, i) => out.push({ template_id: 352, notify_type: 5, account_id: acct, symbol: o.sym, exchange: 'CME', basket_id: o.basket,
    transaction_type: o.side === 'buy' ? 1 : 2, fill_price: f[1], fill_size_64: f[0], fill_id: o.basket + '-F' + (i + 1), commission_fill_rate: f[3] != null ? String(f[3]) : undefined,
    ssboe: Math.floor(f[2] / 1000) + 1, source_ssboe: Math.floor(f[2] / 1000), source_usecs: (f[2] % 1000) * 1000 }));
  return out;
}
await t('point values: contract table matches the journal importer', () => {
  const src = fs.readFileSync(new URL('../../assets/journal-lux.js', import.meta.url), 'utf8');
  const block = src.match(/LUX_FUT_MULTIPLIERS = \{([\s\S]*?)\};/)[1];
  const lux = {}; for (const m of block.matchAll(/(?:'([^']+)'|(\w+)): ([\d.]+)/g)) lux[m[1] || m[2]] = Number(m[3]);
  assert.deepEqual(POINT_VALUES, lux);
  for (const [r, v] of Object.entries({ MNQ: 2, NQ: 20, MES: 5, ES: 50, M2K: 5, RTY: 50, MYM: 0.5, YM: 5, MGC: 10, GC: 100, MCL: 100, CL: 1000 })) assert.equal(pointValueFor(r + 'Z6'), v, r);
  assert.equal(rootOf('6EZ6'), '6E'); assert.equal(rootOf('MNQZ6'), 'MNQ'); assert.equal(rootOf('ESH26'), 'ES');
  assert.equal(pointValueFor('XYZH6'), null);
});
await t('2026-10-27 APEX-1001: simple, scale in/out, flip, partials, MNQ+ES+NQ mix', () => {
  const { trips, open } = buildTrips(fillsFromNotes(notesFor('APEX-1001', '20261027')));
  assert.equal(trips.length, EXPECTED_1027_A1.length);
  EXPECTED_1027_A1.forEach((e, i) => {
    const g = trips[i];
    for (const k of ['symbol', 'direction', 'quantity', 'avgEntry', 'avgExit', 'grossPnl']) assert.equal(g[k], e[k], 'trip ' + i + ' ' + k + ': ' + g[k] + ' != ' + e[k]);
    assert.equal(g.fees, null, 'no fees sent -> null');
  });
  assert.equal(open.length, 1); assert.equal(open[0].symbol, 'ESZ6'); assert.equal(open[0].qty, 1);
});
await t('2026-10-26 APEX-1001: per-contract fee becomes fees, net = gross - fees', () => {
  const { trips } = buildTrips(fillsFromNotes(notesFor('APEX-1001', '20261026')));
  assert.equal(trips.length, 1);
  for (const k of Object.keys(EXPECTED_1026_A1[0])) assert.equal(trips[0][k], EXPECTED_1026_A1[0][k], k);
});
await t('two accounts on the same day stay separate', () => {
  const fills = fillsFromNotes([...notesFor('APEX-1001', '20261027'), ...notesFor('APEX-2002', '20261027')]);
  const { trips } = buildTrips(fills);
  const a2 = trips.filter((x) => x.account === 'APEX-2002');
  assert.equal(a2.length, 1); assert.equal(a2[0].grossPnl, 20); assert.equal(a2[0].symbol, 'MESZ6');
  assert.equal(trips.filter((x) => x.account === 'APEX-1001').length, EXPECTED_1027_A1.length);
});
await t('same fill reported twice (summary + detail) counts once', () => {
  const n = notesFor('APEX-1001', '20261027');
  const { trips } = buildTrips(fillsFromNotes([...n, ...n]));
  assert.equal(trips.length, EXPECTED_1027_A1.length);
});
await t('flip splits one fill across two trips and its fee in proportion', () => {
  const mk = (id, side, qty, price, ts, rate) => ({ notify_type: 5, account_id: 'A', symbol: 'MNQZ6', transaction_type: side, fill_price: price, fill_size_64: qty, fill_id: id, ssboe: ts, source_ssboe: ts, commission_fill_rate: rate });
  const { trips } = buildTrips(fillsFromNotes([mk('1', 1, 2, 100, 1000), mk('2', 2, 3, 110, 1010, '1'), mk('3', 1, 1, 100, 1020)]));
  assert.equal(trips.length, 2);
  // only the 3-contract exit fill carries a rate (1 per contract = 3): 2 of its 3 contracts close the long, 1 opens the short
  assert.equal(trips[0].fees, 2);
  assert.equal(trips[1].fees, 1);
});
await t('unknown symbol: no invented P&L, asks for a point value', () => {
  const fills = fillsFromNotes([{ notify_type: 5, account_id: 'A', symbol: 'XYZH6', transaction_type: 1, fill_price: 10, fill_size_64: 1, fill_id: 'a', ssboe: 1 },
    { notify_type: 5, account_id: 'A', symbol: 'XYZH6', transaction_type: 2, fill_price: 12, fill_size_64: 1, fill_id: 'b', ssboe: 2 }]);
  let r = buildTrips(fills);
  assert.equal(r.trips[0].netPnl, null); assert.deepEqual(r.needsPointValue, ['XYZ']);
  r = buildTrips(fills, { pointValues: { XYZ: 25 } });
  assert.equal(r.trips[0].grossPnl, 50); assert.deepEqual(r.needsPointValue, []);
});
await t('journal trade shape: IST + exchange time, tag, source ids, doc id is stable', () => {
  const { trips } = buildTrips(fillsFromNotes(notesFor('APEX-1001', '20261027')));
  const ist = tripToJournalTrade(trips[0], { tz: 'Asia/Kolkata', label: 'Apex 50K eval' });
  const ct = tripToJournalTrade(trips[0], { tz: 'America/Chicago', label: 'Apex 50K eval' });
  assert.equal(ist.date, '2026-10-27'); assert.equal(ist.time, '20:00');     // 14:30 UTC
  assert.equal(ct.time, '09:30');
  assert.equal(ist.instrument, 'MNQZ6'); assert.equal(ist.pnl, 40); assert.equal(ist.result, 'Win');
  assert.deepEqual(ist.tags, ['Rithmic \u00b7 Apex 50K eval']); assert.equal(ist.rithmicAccount, 'APEX-1001'); assert.ok(ist.rithmicIds.length >= 2);
  assert.equal(tripDocId(trips[0]), tripDocId(buildTrips(fillsFromNotes(notesFor('APEX-1001', '20261027'))).trips[0]));
  assert.notEqual(tripDocId(trips[0]), tripDocId(trips[1]));
});
await t('re-import adds nothing; Free cap says how many fit and never drops silently', () => {
  const { trips } = buildTrips(fillsFromNotes(notesFor('APEX-1001', '20261027')));
  const first = planImport(trips, { existingKeys: new Set(), freeRoom: null });
  assert.equal(first.take.length, 6);
  const again = planImport(trips, { existingKeys: new Set(trips.map((x) => x.key)) });
  assert.equal(again.take.length, 0); assert.equal(again.dupes.length, 6);
  const capped = planImport(trips, { existingKeys: new Set(), freeRoom: 4 });
  assert.equal(capped.take.length, 4); assert.equal(capped.overCap.length, 2); assert.equal(capped.fresh.length, 6);
  assert.equal(planImport(trips, { freeRoom: 0 }).take.length, 0);
});
await t('PnL cross-check: match / differs / unavailable', () => {
  const { trips } = buildTrips(fillsFromNotes(notesFor('APEX-1001', '20261027')));
  const gross = trips.reduce((a, x) => a + x.grossPnl, 0);
  assert.equal(crossCheck(trips, { dayClosedPnl: gross }, 'APEX-1001').status, 'match');
  assert.equal(crossCheck(trips, { dayClosedPnl: gross + 50 }, 'APEX-1001').status, 'differs');
  assert.equal(crossCheck(trips, { error: 'x' }, 'APEX-1001').status, 'unavailable');
});
await t('trade date helper rolls at 17:00 Chicago', () => {
  assert.equal(tradeDateCT(Date.UTC(2026, 9, 27, 14, 0)), '20261027');
  assert.equal(tradeDateCT(Date.UTC(2026, 9, 27, 22, 30)), '20261028');   // 17:30 CDT
});
await t('error text: permission -> "Order history isn\'t enabled for this app yet."', () => {
  assert.equal(explainHistoryError(Object.assign(new Error('permission denied: order history is not enabled'), { rpCode: '13' })).message, MSG_HISTORY_NOT_ENABLED);
  assert.match(explainHistoryError(new Error('weird thing')).message, /Rithmic said: "weird thing"/);
});

// ---- 3. mock round trip (real session code, real protobuf, local mock) -----------------------------
const PORT = 8791;
const mock = spawn('node', [new URL('./rithmic-mock.mjs', import.meta.url).pathname, String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => mock.stdout.once('data', r));
const GW = 'ws://127.0.0.1:' + PORT;
const sentIds = [];
const open = () => new RithmicOrderHistory({ gateway: GW, appName: 'ZoroCharts', appVersion: '0', WebSocketImpl: WebSocket, onSend: (id) => sentIds.push(id) });
try {
  await t('mock: login, accounts, dates, day history, PnL snapshot, logout', async () => {
    const h = open();
    await h.connect({ user: 'demo', password: 'demo-pass', systemName: 'Apex' });
    const accts = await h.accounts();
    assert.deepEqual(accts.map((a) => a.id), ACCOUNTS.map((a) => a.id));
    assert.deepEqual(await h.historyDates(), ['20261026', '20261027']);
    const notes = await h.dayNotes(accts[0], '20261027');
    const { trips } = buildTrips(fillsFromNotes(notes));
    assert.equal(trips.length, 6);
    assert.deepEqual(trips.map((x) => x.grossPnl), EXPECTED_1027_A1.map((x) => x.grossPnl));
    const n2 = await h.dayNotes(accts[1], '20261027');
    assert.equal(buildTrips(fillsFromNotes(n2)).trips.length, 1);
    const today = await h.dayNotes(accts[0], '20261028', { today: true });
    const tt = buildTrips(fillsFromNotes(today)).trips;
    assert.equal(tt.length, 1); assert.equal(tt[0].grossPnl, 100);
    const snap = await h.pnlSnapshot(accts[0]);
    assert.equal(crossCheck(tt, snap, 'APEX-1001').status, 'match');
    await h.close();
  });
  await t('mock: a login without order-history rights gets the plain message', async () => {
    const h = open();
    await h.connect({ user: 'demo-nohist', password: 'demo-pass', systemName: 'Apex' });
    await h.accounts();
    let err; try { await h.historyDates(); } catch (e) { err = e; }
    assert.ok(err, 'must reject');
    assert.equal(explainHistoryError(err).message, MSG_HISTORY_NOT_ENABLED);
    await h.close();
  });
  await t('mock: bad password is rejected by Rithmic with its own text', async () => {
    const h = open();
    let err; try { await h.connect({ user: 'err-pass', password: 'x', systemName: 'Apex' }); } catch (e) { err = e; }
    assert.ok(err); assert.match(err.message, /invalid user id or password/);
  });
  await t('every frame sent over the wire is in the allowlist, and the mock saw no order entry', async () => {
    assert.ok(sentIds.length > 20);
    for (const id of sentIds) assert.ok(ALLOWED_TEMPLATES.includes(id), 'sent ' + id);
    const st = await (await fetch('http://127.0.0.1:' + PORT + '/__stats')).json();
    assert.deepEqual(st.forbidden, []);
    for (const id of Object.keys(st.orderReqs)) assert.ok(ALLOWED_TEMPLATES.includes(Number(id)), 'mock received ' + id);
  });
} finally { mock.kill(); }
console.log(pass + ' passed' + (process.exitCode ? ', FAILURES above' : ''));
