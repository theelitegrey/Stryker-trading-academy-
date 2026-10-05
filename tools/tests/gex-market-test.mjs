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

// Open-gap (Owner bug, Mon 5 Oct 2026 09:45 ET): cash open by schedule, futures fresh, Cboe's delayed
// chain still from Friday's 16:14:59 close -> opening (not cash_closed), short cache
check('monday-open-gap', { now: et('2026-10-05T09:35:00'), futTs: et('2026-10-05T09:34:00'), optTs: et('2026-10-02T16:14:59') }, 'opening');
check('monday-open-gap-0945', { now: et('2026-10-05T09:45:00'), futTs: et('2026-10-05T09:44:00'), optTs: et('2026-10-02T16:14:59') }, 'opening');
// Tuesday open-gap: chain from Monday's close
check('tuesday-open-gap', { now: et('2026-10-06T09:40:00'), futTs: et('2026-10-06T09:39:00'), optTs: et('2026-10-05T16:14:59') }, 'opening');
// First fresh print arrives -> open
check('monday-first-print', { now: et('2026-10-05T09:48:00'), futTs: et('2026-10-05T09:47:00'), optTs: et('2026-10-05T09:31:07') }, 'open');
// Pre-open 09:20 Monday -> still cash_closed (schedule-closed)
check('monday-preopen', { now: et('2026-10-05T09:20:00'), futTs: et('2026-10-05T09:19:00'), optTs: et('2026-10-02T16:14:59') }, 'cash_closed');

// cacheTtl / cacheHeaders (functions/api/gex/levels/[name].js)
const { cacheTtl, cacheHeaders } = await import('../../functions/api/gex/levels/[name].js');
const ma = h => Number(/max-age=(\d+)/.exec(h)[1]);
const sm = h => Number(/s-maxage=(\d+)/.exec(h)[1]);
const sw = h => Number(/stale-while-revalidate=(\d+)/.exec(h)[1]);
function ttlCase(name, input, edgeOk) {
  const now = input.now;
  const data = { market: marketStatus(input) };
  const h = cacheHeaders(cacheTtl(data, now))['cache-control'];
  assert.ok(ma(h) <= 60, `${name}: browser max-age ${ma(h)} > 60 (${h})`);
  assert.ok(edgeOk(sm(h), sw(h)), `${name}: bad edge ttl ${h}`);
  n++; console.log('PASS', name, '->', data.market.state, '|', h);
}
const short = (e, s) => e <= 60 && s <= 60;
ttlCase('ttl-open-gap-0935', { now: et('2026-10-05T09:35:00'), futTs: et('2026-10-05T09:34:00'), optTs: et('2026-10-02T16:14:59') }, short);
ttlCase('ttl-open', { now: et('2026-10-05T11:00:00'), futTs: et('2026-10-05T10:59:00'), optTs: et('2026-10-05T10:45:00') }, (e, s) => e <= 90 && s <= 120);
ttlCase('ttl-mlk-cash-hours', { now: et('2027-01-18T11:00:00'), futTs: et('2027-01-18T10:58:00'), optTs: et('2027-01-15T16:14:59') }, short);
ttlCase('ttl-saturday-long', { now: et('2026-10-03T12:00:00'), futTs: et('2026-10-02T16:59:00'), optTs: et('2026-10-02T16:14:59') }, e => e === 1800);
ttlCase('ttl-overnight-long', { now: et('2026-09-29T22:00:00'), futTs: et('2026-09-29T21:59:00'), optTs: et('2026-09-29T16:14:59') }, e => e === 1800);
// 09:10 ET: long TTL must end by 09:30 (never outlives the open)
ttlCase('ttl-preopen-capped', { now: et('2026-10-05T09:10:00'), futTs: et('2026-10-05T09:09:00'), optTs: et('2026-10-02T16:14:59') }, e => e <= 20 * 60);
ttlCase('ttl-0929', { now: et('2026-10-05T09:29:00'), futTs: et('2026-10-05T09:28:00'), optTs: et('2026-10-02T16:14:59') }, short);

console.log(`gex-market-test: ${n} checks passed`);
