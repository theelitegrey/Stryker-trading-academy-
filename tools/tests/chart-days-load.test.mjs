// "Days of history to load" (assets/chart-days-load.js): caps, menu, per-timeframe store, bars-needed maths.  node tools/tests/chart-days-load.test.mjs
import assert from 'node:assert/strict';
import * as D from '../../assets/chart-days-load.js';
const ok = (c, m) => { assert.ok(c, m); console.log('PASS ' + m); };
// cap = min(source depth, what fits in the memory ceiling)
ok(D.capDays('1', 29, 30000) === 20, '1m: 30000 bars = 20 days, below the 29-day source depth');
ok(D.capDays('15', 59, 30000) === 59, '15m: source depth 59 days wins');
ok(D.capDays('1', 366, 400000) === 277 && D.capDays('5', 366, 400000) === 366, 'deep 1m: memory ceiling (277 days) bites before the 366-day depth; 5m gets 366');
ok(D.capDays('weird', 59, 30000) === 0, 'unknown timeframe: nothing offered');
// menu never lists more than the cap
const m = D.optionsFor(59);
ok(m[0] === 'Auto' && m.at(-1) === 'Max (59 days)' && !m.includes('60 days') && m.includes('30 days'), 'menu stops at the cap: ' + m.join(', '));
ok(D.optionsFor(1).length === 1, 'under 2 days of room: Auto only');
// labels round trip
ok(D.parseLabel('Auto', 59) === 0 && D.parseLabel('7 days', 59) === 7 && D.parseLabel('Max (59 days)', 59) === 59 && D.parseLabel('1 day', 59) === 1, 'labels parse');
ok(D.parseLabel('90 days', 59) === 59, 'a stale choice above the cap is clamped');
ok(D.displayOf(0, 59) === 'Auto' && D.displayOf(59, 59) === 'Max (59 days)' && D.displayOf(100, 59) === 'Max (59 days)' && D.displayOf(7, 59) === '7 days', 'display');
// per timeframe store + persistence
D.setDays('c1', '15', 14); D.setDays('c1', '5', 7);
ok(D.getDays('c1', '15') === 14 && D.getDays('c1', '5') === 7 && D.getDays('c1', '60') === 0 && D.getDays('c2', '15') === 0, 'per timeframe, per cell');
const saved = JSON.parse(JSON.stringify(D.serialize('c1')));
D.restore('c3', saved); ok(D.getDays('c3', '15') === 14, 'serialize / restore round trip');
D.setDays('c1', '15', 0); D.setDays('c1', '5', 0); ok(D.serialize('c1') === undefined, 'all Auto = nothing saved');
D.restore('c4', { '15': -5, '5': 'x', '999': 3, '30': 99999, '60': 5.9 });
ok(D.getDays('c4', '15') === 0 && D.getDays('c4', '5') === 0 && D.getDays('c4', '30') === 0 && D.getDays('c4', '60') === 5, 'junk in saved data is dropped');
// bars needed
const DAY = 864e5, now = 1e12;
ok(D.barsNeeded(now - 2 * DAY, now, 1000, 0) === 0, 'Auto: no extra load');
ok(D.barsNeeded(now - 10 * DAY, now, 1000, 7) === 0, 'already covers 7 days: no extra load');
const n = D.barsNeeded(now - 2 * DAY, now, 1000, 7);
ok(n >= 2500 && n <= 2800, '7 days wanted, 2 loaded (500/day): about 2500 more, got ' + n);
ok(D.barsNeeded(now - DAY, now, 1, 7) === 0, 'too few bars to judge: no load');
console.log('OK');
