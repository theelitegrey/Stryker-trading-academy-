// InsightSentry monthly REST counter (src/is-usage.js). node workers/book-recorder/test/is-usage.test.mjs
import assert from 'node:assert/strict';
import { periodOf, addNote, setBase, summary, emptyUse, noteSig, sigOk, QUOTA } from '../src/is-usage.js';

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const T = (s) => Date.parse(s);

assert.deepEqual(periodOf(T('2026-10-25T19:15:00Z')), { start: '2026-10-09', end: '2026-11-08' });
assert.deepEqual(periodOf(T('2026-11-08T23:59:00Z')), { start: '2026-10-09', end: '2026-11-08' });
assert.deepEqual(periodOf(T('2026-11-09T00:00:00Z')), { start: '2026-11-09', end: '2026-12-08' });
assert.deepEqual(periodOf(T('2026-01-03T00:00:00Z')), { start: '2025-12-09', end: '2026-01-08' });
ok('billing period 9th..8th, year wrap');

let u = emptyUse();
u = setBase(u, T('2026-10-25T19:15:00Z'), 75441);
u = addNote(u, 'gexfast', 10, T('2026-10-25T19:10:00Z'));   // before the baseline: counted per day, not added
u = addNote(u, 'news', 5, T('2026-10-25T19:20:00Z'));
u = addNote(u, 'bogus', 3, T('2026-10-25T19:21:00Z'));
u = addNote(u, 'opt', -4, T('2026-10-25T19:22:00Z'));
let s = summary(u, T('2026-10-25T20:00:00Z'));
assert.equal(s.used, 75441 + 5 + 3);
assert.equal(s.today, 18);
assert.equal(s.todayBy.other, 3);
assert.equal(s.rateBasis.wk, 'plan');
ok('baseline + counted after it; unknown source -> other; negative ignored');

// projection with the plan rate: Oct 25 (Sun) .. Nov 8: 10 weekdays x 2600 + 5 weekend days x 150 (today counts its rest)
const exp = 75449 + (150 - 18) + 10 * 2600 + 4 * 150;
assert.equal(s.projected, exp);
assert.equal(s.alert, exp > QUOTA * 0.9);
assert.equal(s.runsOutOn, null);
ok('projection to Nov 8 = ' + s.projected + ' (' + s.projectedPct + '%), alert=' + s.alert);

// measured rate replaces the plan once full days exist; a heavy rate trips the alert and dates the run-out
let v = setBase(emptyUse(), T('2026-10-19T00:00:00Z'), 50000);
v = addNote(v, 'gexfast', 1, T('2026-10-19T00:00:01Z'));
for (const d of ['20', '21', '22', '23']) v = addNote(v, 'gexfast', 13500, T('2026-10-' + d + 'T15:00:00Z'));
s = summary(v, T('2026-10-24T12:00:00Z'));
assert.equal(s.rate.wk, 13500);
assert.equal(s.rateBasis.wk, '4 days');
assert.equal(s.alert, true);
assert.equal(s.used, 50000 + 1 + 4 * 13500);
assert.equal(s.runsOutOn, '2026-10-27');   // 104,001 + Sat/Sun 150 each + Mon 13,500 = 117,801; Tue passes 120k
ok('measured weekday rate 13,500 -> alert, runs out ' + s.runsOutOn);

// no baseline for this period -> counted only
s = summary(addNote(emptyUse(), 'scan', 40, T('2026-11-10T10:00:00Z')), T('2026-11-10T11:00:00Z'));
assert.equal(s.used, 40); assert.equal(s.base, null);
ok('new period without a baseline counts from zero');

// 45-day retention
let w = addNote(emptyUse(), 'news', 1, T('2026-08-01T00:00:00Z'));
w = addNote(w, 'news', 1, T('2026-10-01T00:00:00Z'));
assert.deepEqual(Object.keys(w.days), ['2026-10-01']);
ok('days older than 45 days dropped');

const m = Math.floor(T('2026-10-25T19:00:30Z') / 60000);
const sig = await noteSig('k1', m);
assert.equal(await sigOk('k1', sig, T('2026-10-25T19:00:30Z')), true);
assert.equal(await sigOk('k1', sig, T('2026-10-25T19:01:30Z')), true);
assert.equal(await sigOk('k1', sig, T('2026-10-25T19:03:00Z')), false);
assert.equal(await sigOk('k2', sig, T('2026-10-25T19:00:30Z')), false);
assert.equal(await sigOk('', sig), false);
ok('Pages note signature: right key, +-1 minute only');
console.log('is-usage.test: ' + n + ' checks passed');
