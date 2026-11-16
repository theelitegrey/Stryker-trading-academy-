// node tools/tests/frvp-data.test.mjs — assets/chart-frvp-data.js (FRVP delta rows + anchored VWAP).
import assert from 'node:assert/strict';
import { deltaRows, anchoredVwap, flowDays } from '../../assets/chart-frvp-data.js';

// 2 rows of 1.0 from 100, tick 0.25: prices 100..100.75 -> row 0, 101..101.75 -> row 1
const mins = [
  { t: 0, lo: 400, buy: [5, 0, 0, 0, 2], sell: [1, 0, 0, 0, 7] },   // 100.00 (+4), 101.00 (-5)
  { t: 60000, lo: 403, buy: [3], sell: [0] },                       // 100.75 (+3)
  { t: 120000, lo: 400, buy: [9], sell: [0] },                      // outside [from, to): ignored
  { t: 60000, lo: 300, buy: [9], sell: [0] }                        // 75.00: far below the profile, ignored
];
const r = deltaRows(mins, 0.25, 100, 1, 2, 0, 120000);
assert.deepEqual([...r.d], [7, -5]);
assert.deepEqual([...r.has], [1, 1]);
assert.deepEqual([...deltaRows([mins[1]], 0.25, 100, 1, 2, 0, 120000).has], [1, 0]);   // row with no flow stays 0 (no data, not zero delta)
assert.equal(r.used, 2);
assert.equal(r.first, 0); assert.equal(r.last, 60000);
assert.equal(deltaRows([], 0.25, 100, 1, 2, 0, 1).used, 0);

const v = anchoredVwap([{ time: 1, high: 11, low: 9, close: 10, volume: 1 }, { time: 2, high: 21, low: 19, close: 20, volume: 1 }]);
assert.equal(v[0].vwap, 10); assert.equal(v[0].sd, 0);
assert.equal(v[1].vwap, 15); assert.equal(v[1].sd, 5);
assert.equal(anchoredVwap([{ time: 1, high: 1, low: 1, close: 1, volume: 0 }]), null);
// flowDays: AUTO-FRVPDELTA. A profile drawn back in March must still read the recorded days (8 Oct on), not just the newest 14.
const D = (y, m, d) => Math.floor(Date.UTC(y, m, d) / 86400000), now = Date.UTC(2026, 10, 14, 12);
assert.deepEqual(flowDays(Date.UTC(2026, 2, 3), now, 14, null), [D(2026, 10, 1), D(2026, 10, 14)]);              // old rule: only 14 days (the bug)
assert.deepEqual(flowDays(Date.UTC(2026, 2, 3), now, 90, D(2026, 9, 8)), [D(2026, 9, 8), D(2026, 10, 14)]);   // clamp to the first recorded day
assert.deepEqual(flowDays(Date.UTC(2026, 10, 10), now, 90, D(2026, 9, 8)), [D(2026, 10, 10), D(2026, 10, 14)]); // short span unchanged
console.log('frvp-data: all passed');

// volumeNodes: two clear peaks with a dip between them, thin edges
{
  const { volumeNodes } = await import('../../assets/chart-frvp-data.js');
  const vols = [1, 2, 3, 9, 3, 2, 1, 0.5, 1, 2, 3, 8, 3, 2, 1, 1];
  const rows = vols.map((v) => ({ up: v / 2, down: v / 2 }));
  const n = volumeNodes(rows);
  assert.deepEqual(n.hvn, [3, 11]);
  assert.deepEqual(n.lvn, [7]);
  assert.deepEqual(volumeNodes(rows.slice(0, 3)), { hvn: [], lvn: [] });   // too few rows
  assert.deepEqual(volumeNodes(vols.map(() => ({ up: 0, down: 0 }))), { hvn: [], lvn: [] });
  console.log('frvp-data: volumeNodes passed');
}
