// Live account balance + header strip P&L (Owner bug 2026-11-19 "the balance is not updated"). Pure logic, fixture rows only.
// The fixture rows follow the broker link's documented balance record (LegacyBrokerBalance: balanceId, balanceType, cashBalance,
// netLiquidationValue, totalCashValue, totalRealizedPnl, currencyCode, balanceCreatedAt, lastUpdated) and order fill record
// (FDXBrokerOrderFill: fillId, orderId, securityId, side, quantity, price, executedAt, commission). Sample data, not a real account.
// Run: node tests/finatic/live-balance.test.mjs
import assert from 'node:assert/strict';
import * as L from '../../assets/chart-live-core.js';

const T = (s) => Date.parse(s);
// ---- 1. which snapshot / which field --------------------------------------------------------------------------------------
// The bug: the list holds several dated snapshots; the old code took the first row in list order (here the stale morning one).
const SNAPS = [
  { balanceId: 'b1', balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '53582.88', netLiquidationValue: '53582.88', totalRealizedPnl: '3582.88', balanceCreatedAt: '2026-11-19T00:00:00Z', lastUpdated: '2026-11-19T06:00:00Z' },
  { balanceId: 'b2', balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '53582.88', netLiquidationValue: '53742.38', unrealizedPnl: '0', totalRealizedPnl: '3742.38', balanceCreatedAt: '2026-11-19T00:00:00Z', lastUpdated: '2026-11-19T15:10:00Z' },
  { balanceId: 'b0', balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '52990.00', netLiquidationValue: '52990.00', balanceCreatedAt: '2026-11-18T00:00:00Z', lastUpdated: '2026-11-18T21:00:00Z' },
];
let b = L.balanceOf(SNAPS, 'USD');
assert.equal(b.amount, 53742.38, 'newest snapshot (lastUpdated 15:10) wins, not the first row');
assert.equal(b.kind, 'netliq'); assert.equal(b.key, 'netLiquidationValue'); assert.equal(b.at, T('2026-11-19T15:10:00Z'));
assert.equal(b.realized, null, 'a cumulative totalRealizedPnl is never added or used as today’s');
assert.equal(b.upl, 0);
// order of the list does not matter
assert.equal(L.balanceOf(SNAPS.slice().reverse(), 'USD').amount, 53742.38);
// net liquidation beats cash inside one snapshot; cash when there is no net liquidation; available last
assert.equal(L.balanceOf([{ currencyCode: 'USD', cashBalance: 50000, netLiquidationValue: 50120, lastUpdated: '2026-11-19T10:00:00Z' }]).amount, 50120);
assert.deepEqual(['cash', 'totalCashValue'], ((x) => [x.kind, x.key])(L.balanceOf([{ currencyCode: 'USD', totalCashValue: '49,870.25', availableBalance: 1 }])));
assert.equal(L.balanceOf([{ currencyCode: 'USD', availableBalance: '12.5' }]).kind, 'available');
// a newer snapshot with only cash beats an older one with net liquidation (never fall back to an older day)
assert.equal(L.balanceOf([{ currencyCode: 'USD', netLiquidationValue: 1, lastUpdated: '2026-11-18T10:00:00Z' }, { currencyCode: 'USD', cashBalance: 2, lastUpdated: '2026-11-19T10:00:00Z' }]).amount, 2);
// dated rows beat undated ones; other currencies are ignored when the account currency is there
assert.equal(L.balanceOf([{ currencyCode: 'USD', cashBalance: 9 }, { currencyCode: 'USD', cashBalance: 7, balanceCreatedAt: '2026-11-19' }]).amount, 7);
assert.equal(L.balanceOf([{ currencyCode: 'EUR', cashBalance: 99, lastUpdated: '2026-11-19T12:00:00Z' }, { currencyCode: 'USD', cashBalance: 20, lastUpdated: '2026-11-18T12:00:00Z' }], 'USD').amount, 20);
// an explicit day-realised field is reported (RP&L fallback), not added to the balance
b = L.balanceOf([{ currencyCode: 'USD', cashBalance: 100, realizedPnlToday: '-25', lastUpdated: '2026-11-19T12:00:00Z' }]);
assert.equal(b.amount, 100); assert.equal(b.realized, -25);
// epoch seconds / ms stamps
assert.equal(L.stampOf({ lastUpdated: 1763560000 }), 1763560000000); assert.equal(L.stampOf({ updatedAt: 1763560000000 }), 1763560000000);
assert.equal(L.stampOf({}), null); assert.equal(L.stampOf({ lastUpdated: 'soon' }), null);

// ---- 2. age line ---------------------------------------------------------------------------------------------------------
const NOW = T('2026-11-19T15:20:00Z');
assert.equal(L.ageText(NOW - 60000, NOW), '', 'under 2 min: nothing');
assert.equal(L.ageText(NOW - 119999, NOW), '');
assert.equal(L.ageText(NOW - 120000, NOW), 'updated 2 min ago');
assert.equal(L.ageText(NOW - 47 * 60000, NOW), 'updated 47 min ago');
assert.equal(L.ageText(NOW - 5 * 3600000, NOW), 'updated 5 h ago');
assert.equal(L.ageText(NOW - 3 * 86400000, NOW), 'updated 3 days ago');
assert.equal(L.ageText(null, NOW), '');
for (const w of [L.ageText(NOW - 600000, NOW)]) assert.ok(!/delayed|real.?time/i.test(w));

// ---- 3. today's realised P&L from fills (MNQ $2/pt, NQ $20/pt), FIFO, net of commission ----------------------------------
const DAY = T('2026-11-19T00:00:00Z');
const F = (id, sym, side, qty, price, at, commission) => ({ fillId: id, orderId: 'o' + id, securityId: sym, side, quantity: qty, price, executedAt: at, commission });
const FILLS = [
  F('1', 'MNQZ6', 'BUY', 1, 25000, '2026-11-19T14:31:00Z', 0.62),
  F('2', 'MNQZ6', 'SELL', 1, 25020.5, '2026-11-19T14:40:00Z', 0.62),   // +20.5 pt x $2 = +41
  F('3', 'MNQZ6', 'SELL', 2, 25030, '2026-11-19T15:00:00Z', 1.24),
  F('4', 'MNQZ6', 'BUY', 2, 25040, '2026-11-19T15:05:00Z', 1.24),     // -10 pt x 2 x $2 = -40
  F('5', 'NQZ6', 'BUY', 1, 25001, '2026-11-18T19:00:00Z', 2.0),       // yesterday: ignored
];
let r = L.dayRealized(FILLS, [], DAY);
assert.equal(r.value, Math.round((41 - 40 - 3.72) * 100) / 100); assert.equal(r.fills, 4);
// yesterday's NQ buy is still held -> its sell today closes a carried position: incomplete
r = L.dayRealized(FILLS.concat([F('6', 'NQZ6', 'SELL', 1, 25011, '2026-11-19T16:00:00Z', 2)]), [], DAY);
assert.equal(r.complete, false); assert.match(r.why, /earlier day/);
// a position still open from today's fills is fine (start of day was flat)
r = L.dayRealized([F('a', 'MNQZ6', 'BUY', 2, 100, '2026-11-19T14:00:00Z', 0), F('b', 'MNQZ6', 'SELL', 1, 110, '2026-11-19T14:10:00Z', 0)], [{ securityId: 'MNQZ6', quantity: 1, averageBuyPrice: 100 }], DAY);
assert.deepEqual([r.value, r.complete], [20, true], 'partial close: 10 pt x 1 x $2');
// duplicates (same fillId twice from two reads) count once; unknown symbols make it incomplete
r = L.dayRealized([FILLS[0], FILLS[0], FILLS[1]], [], DAY); assert.equal(r.value, Math.round((41 - 1.24) * 100) / 100); assert.equal(r.fills, 2);
r = L.dayRealized([F('x', 'CLZ6', 'BUY', 1, 70, '2026-11-19T14:00:00Z', 0)], [], DAY); assert.equal(r.complete, false);
assert.deepEqual(L.dayRealized([], [], DAY), { value: 0, fills: 0, complete: true, why: '' });
// short first then cover: (sell - buy)
r = L.dayRealized([F('s', 'NQZ6', 'sell', 1, 25050, '2026-11-19T14:00:00Z', 0), F('c', 'NQZ6', 'buy', 1, 25040, '2026-11-19T14:05:00Z', 0)], [], DAY); assert.equal(r.value, 200);

// ---- 4. balance = snapshot + fills after it ---------------------------------------------------------------------------------
const snap = L.balanceOf([{ currencyCode: 'USD', netLiquidationValue: '53582.88', lastUpdated: '2026-11-19T14:35:00Z' }]);
let lb = L.liveBalance(snap, FILLS, []);
// fills after 14:35: #2 closes #1 (bought before the snapshot) -> the account was NOT flat at the snapshot: shown as is
assert.equal(lb.adjusted, false); assert.equal(lb.amount, 53582.88); assert.equal(lb.fillsAfter, 3);
// snapshot at 14:50 (flat): fills #3, #4 after it -> 53582.88 - 40 - 2.48
const snap2 = L.balanceOf([{ currencyCode: 'USD', netLiquidationValue: '53582.88', lastUpdated: '2026-11-19T14:50:00Z' }]);
lb = L.liveBalance(snap2, FILLS, []);
assert.deepEqual([lb.adjusted, lb.amount, lb.fillsAfter], [true, Math.round((53582.88 - 40 - 2.48) * 100) / 100, 2]);
// no fills after the snapshot / undated snapshot: unchanged
assert.equal(L.liveBalance(L.balanceOf([{ currencyCode: 'USD', cashBalance: 10, lastUpdated: '2026-11-19T23:00:00Z' }]), FILLS, []).adjusted, false);
assert.equal(L.liveBalance(L.balanceOf([{ currencyCode: 'USD', cashBalance: 10 }]), FILLS, []).amount, 10);
assert.equal(L.liveBalance(null, FILLS, []), null);

// ---- 5. UP&L over every open position (last price x point value), broker figure fallback -----------------------------------
const POS = [{ securityId: 'MNQZ6', quantity: 2, averageBuyPrice: 25000 }, { securityId: 'ESZ6', quantity: -1, side: 'SHORT', averageSellPrice: 6800, unrealizedProfitLoss: '-75' }];
const last = { MNQ: 25010.25, ES: 6798 };
assert.deepEqual(L.openTotal(POS, (root) => last[root]), { value: 10.25 * 2 * 2 + 2 * 50, open: 2 });
assert.deepEqual(L.openTotal(POS, (root) => (root === 'ES' ? undefined : last[root])), { value: 41 - 75, open: 2 }, 'no ES price: broker figure');
assert.deepEqual(L.openTotal([{ securityId: 'MNQZ6', quantity: 1, averageBuyPrice: 1 }], () => undefined), { value: null, open: 1 }, 'no price, no broker figure');
assert.deepEqual(L.openTotal([], () => 1), { value: 0, open: 0 });
assert.equal(L.openTotal([{ securityId: 'AAPL', quantity: 5 }], () => 1).value, null, 'unmappable symbol -> unknown, never a partial sum');
// ---- 6. broker's realised per position (RP&L fallback) ------------------------------------------------------------------------
assert.equal(L.positionsRealized([{ securityId: 'MNQZ6', quantity: 0, status: 'CLOSED', realizedProfitLossWithCommission: '38.76', positionClosedAt: '2026-11-19T14:40:00Z' }, { realizedProfitLoss: 500, positionClosedAt: '2026-11-18T14:40:00Z' }], DAY), 38.76);
assert.equal(L.positionsRealized([{ securityId: 'MNQZ6', quantity: 1 }], DAY), null);
console.log('live-balance: all assertions passed');
