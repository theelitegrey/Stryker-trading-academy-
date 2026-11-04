import assert from 'node:assert/strict';
import { fillsFromBroker, tripsFromBroker, tripToTrade, tripId, ordersToFetch, planImport } from '../../assets/finatic-fills.js';

const F = (fillId, side, quantity, price, t, o = {}) => ({ fillId, orderId: 'o' + fillId, side, quantity, price, commission: o.fee ?? 0.5, executedAt: '2026-11-02T' + t + 'Z', instrument: { displaySymbol: o.sym || 'MNQZ6' } });

// futures long, partial exit in two fills, point value MNQ = 2
let r = tripsFromBroker([F('a', 'BUY', 2, 100, '14:00:00', { fee: 1 }), F('b', 'SELL', 1, 110, '14:05:00'), F('c', 'SELL', '1', '105', '14:09:00')], 'acc1');
assert.equal(r.trips.length, 1); assert.deepEqual(r.open, []);
let t = r.trips[0];
assert.equal(t.direction, 'long'); assert.equal(t.quantity, 2); assert.equal(t.avgExit, 107.5);
assert.equal(t.grossPnl, 30);            // (10 + 5) pts x $2 x 1 each
assert.equal(t.fees, 2); assert.equal(t.netPnl, 28);

// short side, ES (50)
r = tripsFromBroker([F('s1', 'SELL', 1, 5000, '15:00:00', { sym: 'ESZ6' }), F('s2', 'BUY', 1, 4990, '15:30:00', { sym: 'ESZ6' })], 'acc1');
assert.equal(r.trips[0].direction, 'short'); assert.equal(r.trips[0].grossPnl, 500); assert.equal(r.trips[0].netPnl, 499);

// still open -> not a trade; unknown root -> needs point value, no pnl
r = tripsFromBroker([F('o1', 'BUY', 1, 10, '16:00:00')], 'acc1'); assert.equal(r.trips.length, 0); assert.equal(r.open.length, 1);
r = tripsFromBroker([F('x1', 'BUY', 1, 10, '16:00:00', { sym: 'ZZZ' }), F('x2', 'SELL', 1, 12, '16:01:00', { sym: 'ZZZ' })], 'acc1');
assert.equal(r.needsPointValue[0], 'ZZZ'); assert.equal(r.trips[0].netPnl, null);
r = tripsFromBroker([F('x1', 'BUY', 1, 10, '16:00:00', { sym: 'ZZZ' }), F('x2', 'SELL', 1, 12, '16:01:00', { sym: 'ZZZ' })], 'acc1', { ZZZ: 7 });
assert.equal(r.trips[0].grossPnl, 14);

// bad rows + duplicate fill ids dropped
assert.equal(fillsFromBroker([F('d', 'BUY', 1, 1, '10:00:00'), F('d', 'BUY', 1, 1, '10:00:00'), { fillId: 'e' }, null, F('g', 'HOLD', 1, 1, '10:00:00'), F('h', 'BUY', 0, 1, '10:00:00')], 'a').length, 1);

// journal trade + dedupe on re-sync (same fills -> same key/doc id -> planImport marks dupes)
r = tripsFromBroker([F('a', 'BUY', 1, 100, '14:00:00'), F('b', 'SELL', 1, 101, '14:05:00')], 'acc1');
const trade = tripToTrade(r.trips[0], { label: 'acc1', tz: 'UTC' });
assert.equal(trade.date, '2026-11-02'); assert.equal(trade.time, '14:00'); assert.equal(trade.instrument, 'MNQZ6');
assert.equal(trade.pnl, 1); assert.equal(trade.result, 'Win'); assert.equal(trade.source, 'broker-sync'); assert.ok(!('rithmicIds' in trade));
assert.ok(tripId(r.trips[0]).startsWith('brk'));
const again = tripsFromBroker([F('a', 'BUY', 1, 100, '14:00:00'), F('b', 'SELL', 1, 101, '14:05:00')], 'acc1').trips;
assert.equal(tripId(again[0]), tripId(r.trips[0]));
const plan = planImport(again, { existingKeys: new Set([trade.syncKey]) }); assert.equal(plan.take.length, 0); assert.equal(plan.dupes.length, 1);

// orders worth fetching
const ord = [{ orderId: '1', status: 'FILLED', orderTerminalAt: '2026-11-02T10:00:00Z' }, { orderId: '2', status: 'CANCELLED' }, { orderId: '3', status: 'PARTIALLY_FILLED', orderTerminalAt: '2025-01-01T00:00:00Z' }, { orderId: '1', status: 'FILLED' }];
assert.deepEqual(ordersToFetch(ord, Date.parse('2026-10-01'), Date.parse('2026-12-01')), ['1']);
console.log('finatic mapper: ok');
