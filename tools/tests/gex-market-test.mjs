// Market-status fixtures for the GEX engine (functions/api/gex/_engine.js).
// Pure node, no browser and no network:  node tools/tests/gex-market-test.mjs
// Checks the closed-market detection only; no GEX calculation is exercised or changed.
import assert from 'node:assert/strict';
import { marketStatus, etEpoch } from '../../functions/api/gex/_engine.js';

const et = s => etEpoch(s); // New York wall time -> epoch seconds
let n = 0;
function check(name, input, want) {
  const got = marketStatus(input);
  assert.equal(got.state, want, `${name}: expected ${want}, got ${got.state} ${JSON.stringify(got)}`);
  n++; console.log('PASS', name, '->', got.state);
}

// etEpoch: Cboe wall time is New York time (EDT in October, EST in December)
assert.equal(etEpoch('2026-10-02T16:14:59'), Date.UTC(2026, 9, 2, 20, 14, 59) / 1000);
assert.equal(etEpoch('2026-12-24T13:00:00'), Date.UTC(2026, 11, 24, 18, 0, 0) / 1000);
assert.equal(etEpoch(null), null);
n += 3;

// Saturday midday: last prints Friday 17:00 ET futures, 16:14 options -> closed
check('saturday', { now: et('2026-10-03T12:00:00'), futTs: et('2026-10-02T16:59:00'), optTs: et('2026-10-02T16:14:59') }, 'closed');
// Sunday before the 18:00 ET reopen -> closed
check('sunday-afternoon', { now: et('2026-10-04T10:47:00'), futTs: et('2026-10-02T16:59:00'), optTs: et('2026-10-02T16:14:59') }, 'closed');
// Weekday overnight: Globex trading, options chain from the 16:15 close -> cash_closed
check('weekday-overnight', { now: et('2026-09-29T22:00:00'), futTs: et('2026-09-29T21:59:00'), optTs: et('2026-09-29T16:14:59') }, 'cash_closed');
// Daily CME maintenance break 17:00-18:00 ET -> closed
check('daily-break', { now: et('2026-09-30T17:30:00'), futTs: et('2026-09-30T16:59:00'), optTs: et('2026-09-30T16:14:59') }, 'closed');
// Full holiday (Christmas, a Friday): no futures print since the early close -> closed
check('holiday-christmas', { now: et('2026-12-25T11:00:00'), futTs: et('2026-12-24T13:14:00'), optTs: et('2026-12-24T13:00:00') }, 'closed');
// Cash holiday with shortened Globex session (MLK day): futures fresh, options from Friday -> cash_closed
check('holiday-mlk-cash-closed', { now: et('2027-01-18T11:00:00'), futTs: et('2027-01-18T10:58:00'), optTs: et('2027-01-15T16:14:59') }, 'cash_closed');
// Open market, fresh data -> open (no closed-market disclaimer)
check('open-fresh', { now: et('2026-09-29T11:00:00'), futTs: et('2026-09-29T10:58:00'), optTs: et('2026-09-29T10:50:00') }, 'open');
// Open market, feed lag over the 30-minute limit -> stale (existing staleness message)
check('open-stale-feed', { now: et('2026-09-29T11:00:00'), futTs: et('2026-09-29T10:20:00'), optTs: et('2026-09-29T10:50:00') }, 'stale');
// No data at all -> nodata (honest empty state)
check('no-data', { now: et('2026-10-03T12:00:00'), futTs: null, optTs: null }, 'nodata');
// Futures feed missing but an options chain exists -> closed (chain shown with its own timestamp)
check('options-only', { now: et('2026-10-03T12:00:00'), futTs: null, optTs: et('2026-10-02T16:14:59') }, 'closed');

console.log(`gex-market-test: ${n} checks passed`);
