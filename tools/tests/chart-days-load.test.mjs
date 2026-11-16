// "Days of history to load" (assets/chart-days-load.js): caps, menu, per-timeframe store, bars-needed maths.  node tools/tests/chart-days-load.test.mjs
import assert from 'node:assert/strict';
import * as D from '../../assets/chart-days-load.js';
const ok = (c, m) => { assert.ok(c, m); console.log('PASS ' + m); };
// cap = min(source depth, what fits in the memory ceiling)
ok(D.capDays('1', 29, 30000) === 20 && D.capDays('1', 29, 30000, 0.72) === 28, '1m: 30000 bars = 20 days (28 counting futures gaps), below the 29-day source depth');
ok(D.capDays('15', 59, 30000) === 59, '15m: source depth 59 days wins');
ok(D.capDays('1', 366, 400000, 0.72) === 366 && D.capDays('1', 366, 400000) === 277 && D.capDays('5', 366, 400000) === 366, 'deep 1m: memory ceiling (277 days) bites before the 366-day depth; 5m gets 366');
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
// STRICT plan (fix 2): exactly N days, no more
{
  const T = (n, step, end = 1e12) => Array.from({ length: n }, (_, i) => end - (n - 1 - i) * step);
  const H = 3600e3;
  const many = T(90 * 24, H);                       // 90 days of 1h
  const p = D.planDays(many, 14, 0);
  ok(p.trim > 0 && many[p.trim] >= many.at(-1) - 14 * DAY && many[p.trim - 1] < many.at(-1) - 14 * DAY, '14 days chosen, 90 held: cut to exactly 14 days');
  ok(p.from === 0, 'a cut needs no fetch');
  const few = T(500, 60e3);                          // 500 x 1m = 8 h held
  const q = D.planDays(few, 14, 0);
  ok(q.trim === 0 && q.from === few.at(-1) - 14 * DAY, 'too little held: fetch back to the day, by time, not by bar count');
  ok(D.planDays(few, 14, few[0]).from === 0, 'source shallower than the choice: not asked again');
  ok(D.planDays(few, 0, 0).trim === 0 && D.planDays(few, 0, 0).from === 0, 'Auto: untouched');
  const exact = T(14 * 24 + 1, H);
  const e = D.planDays(exact, 14, 0);
  ok(e.trim === 0 && e.from === 0, 'exactly 14 days held: nothing to do');
}
// footprint depth is stated honestly (AUTO-FPHIST2)
{
  const d0 = Date.UTC(2026, 9, 8);
  ok(D.fpDepthDays(d0 + 10 * 864e5) === 10, 'footprint depth = days since the recorder started');
  ok(D.fpDepthDays(d0 + 400 * 864e5) === 90, 'footprint depth never above the 90 days kept');
  ok(D.fpDepthDays(d0 - 5 * 864e5) === 0, 'before the start: 0');
  ok(/about 38 days/.test(D.fpHint(d0 + 38 * 864e5)) && /Candles go further/.test(D.fpHint(d0)), 'hint says footprint is shallower than candles');
  ok(D.capDays('240', 729, 30000) === 729 && D.optionsFor(729).includes('365 days') && D.optionsFor(729).at(-1) === 'Max (729 days)', '4h: menu goes to the 729-day source depth');
}
// long history: menu reaches years, pages, honest cap
{
  const m = D.optionsFor(14600);
  ok(m.includes('3650 days') && m.includes('7300 days') && m.at(-1) === 'Max (14600 days)', 'D: menu reaches 10 and 20 years, ends at Max');
  ok(D.optionsFor(366).at(-1) === 'Max (366 days)' && !D.optionsFor(366).includes('730 days'), '5m deep: stops at 366');
  D.restore('r1', { D: 9000 }); ok(D.getDays('r1', 'D') === 9000, 'a 9000-day daily choice survives a reload');
  const pp = D.pagePlan(0, 366 * 864e5, '1', 12000, 0.72);
  ok(pp.length > 20 && pp.length < 60 && pp[0][1] === 366 * 864e5 && pp.at(-1)[0] === 0, '1m year = ' + pp.length + ' pages, newest first, last one starts at the chosen day');
  ok(pp.every((p, i) => i === 0 || p[1] === pp[i - 1][0]) && pp.every((p) => p[0] < p[1]), 'pages touch with no gap or overlap');
  ok(D.pagePlan(0, 10 * 864e5, '15', 12000, 0.72).length === 1, 'small range = one page');
  ok(D.honestCap(366, 120) === 120 && D.honestCap(59, 120) === 59 && D.honestCap(59, 0) === 59, 'cap shrinks to the days the data really has');
}
console.log('OK long history');
