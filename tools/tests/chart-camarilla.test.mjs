// Pure parts of assets/chart-camarilla-data.js + chart-camarilla.js.  node tools/tests/chart-camarilla.test.mjs
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {};
const D = await import('../../assets/chart-camarilla-data.js');
const C = await import('../../assets/chart-camarilla.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const near = (a, b, m, e = 1e-9) => ok(Math.abs(a - b) <= e, m + ' (' + a + ' vs ' + b + ')');

// Hand case: H 110, L 10, C 60 -> Range 100, r = 110
let L = D.camarilla(110, 10, 60);
near(L.R5, 110 / 10 * 60, 'R5 = High/Low*Close'); near(L.R4, 60 + 55, 'R4'); near(L.R3, 60 + 27.5, 'R3'); near(L.R2, 60 + 110 / 6, 'R2'); near(L.R1, 60 + 110 / 12, 'R1');
near(L.S1, 60 - 110 / 12, 'S1'); near(L.S2, 60 - 110 / 6, 'S2'); near(L.S3, 60 - 27.5, 'S3'); near(L.S4, 60 - 55, 'S4');
near(L.S5, 60 - (L.R5 - 60), 'S5 = Close-(R5-Close)'); near(L.RB3, (L.R3 + L.R4) / 2, 'RB3 midpoint'); near(L.SB3, (L.S3 + L.S4) / 2, 'SB3 midpoint');
ok(L.YH === 110 && L.YL === 10 && L.YC === 60, 'Y-High / Y-Low / Y-Close');
// Reference picture back-solved: Close 15199.00, R4-R3 = Range*1.1/4 = 73.75 -> Range 268.1818...
const rng = 73.75 * 4 / 1.1;
L = D.camarilla(15300 + rng, 15300, 15199);
near(L.R3, 15272.75, 'reference R3', 1e-6); near(L.R4, 15346.5, 'reference R4', 1e-6); near(L.RB3, 15309.625, 'reference RB3 (shown 15309.50 on a 0.25 tick grid)', 1e-6);
ok(D.camarilla(10, 20, 15) === null && D.camarilla(NaN, 1, 1) === null && D.camarilla(5, 0, 1) === null, 'bad input -> null');

// Session boundary: futures day starts 18:00 New York (EST Jan: 23:00Z; EDT Jul: 22:00Z)
const t = (s) => Date.parse(s);
ok(D.sessionDay(t('2026-01-14T22:55:00Z'), true) === '2026-01-14', 'EST 17:55 NY -> same day');
ok(D.sessionDay(t('2026-01-14T23:00:00Z'), true) === '2026-01-15', 'EST 18:00 NY -> next trading day');
ok(D.sessionDay(t('2026-07-14T21:55:00Z'), true) === '2026-07-14', 'EDT 17:55 NY -> same day');
ok(D.sessionDay(t('2026-07-14T22:00:00Z'), true) === '2026-07-15', 'EDT 18:00 NY -> next trading day');
ok(D.sessionDay(t('2026-07-14T22:00:00Z'), false) === '2026-07-14', 'non-futures uses the UTC day');
ok(D.periodKey(t('2026-11-05T15:00:00Z'), 'W', true) === '2026-11-02', 'week key = Monday');
ok(D.periodKey(t('2026-11-05T15:00:00Z'), 'M', true) === '2026-11', 'month key');

// Grouping: three futures sessions on 5m bars; the first starts at 18:00 so it is complete
const bars = [], M5 = 300000;
const add = (from, to, h, l, c) => { for (let x = from; x < to; x += M5) bars.push({ time: x, open: c, high: h, low: l, close: c }); };
add(t('2026-11-02T23:00:00Z'), t('2026-11-03T22:00:00Z'), 120, 100, 110);   // Tue session (Mon 18:00 -> Tue 17:00 EST)
add(t('2026-11-03T23:00:00Z'), t('2026-11-04T22:00:00Z'), 130, 105, 125);   // Wed session
add(t('2026-11-04T23:00:00Z'), t('2026-11-05T05:00:00Z'), 128, 124, 126);   // Thu, so far
const sets = D.levelSets(bars, 'D', true, M5, 5);
ok(sets.length === 2 && sets[1].last && !sets[0].last, 'two level sets, newest is last');
near(sets[0].levels.YC, 110, 'set 1 uses the first session close'); near(sets[1].levels.YH, 130, 'set 2 Y-High = Wed high'); near(sets[1].levels.R5, 130 / 105 * 125, 'set 2 R5');
ok(sets[1].start === t('2026-11-04T23:00:00Z'), 'today starts at 18:00 NY');
ok(D.levelSets(bars, 'D', true, M5, 1).length === 1, 'days limit');
// history that starts mid-session: that first (partial) session is not used as a source
ok(D.levelSets(bars.slice(40), 'D', true, M5, 5).length === 1, 'partial first session skipped');

// UI helpers
ok(C.tfMs('5') === 300000 && C.tfMs('1D') === 86400000 && C.tfMs('D') === 86400000 && C.tfMs('60') === 3600000, 'tfMs');
const vis = C.visibleLevels(L, { g5: false, g3: true, g4: true, g2: true, g1: true, yh: true, yc: false, yl: true });
ok(!vis.some((x) => ['R5', 'S5', 'YC'].includes(x.id)) && vis.length === 12 && vis[0].id === 'R4', 'group toggles hide levels');
ok(C.visibleLevels(L, {}).map((x) => x.label).join(' ') === 'R5 R4 RB3 R3 R2 R1 Y-High Y-Close Y-Low S1 S2 S3 SB3 S4 S5', 'label order');
const sp = C.spread([100, 102, 104, 300], 14, 8, 400);
ok(sp[1] - sp[0] >= 14 && sp[2] - sp[1] >= 14 && sp[3] === 300, 'tags spread apart');
// Tick rounding (raw maths stays unrounded above): reference RB3 15309.625 -> 15309.50 on NQ (0.25); the exact tie rounds up
ok(D.roundTick(L.RB3, 0.25) === 15309.5 && C.fmtPrice(D.roundTick(L.RB3, 0.25), 2) === '15309.50', 'reference RB3 15309.625 -> 15309.50 (tie goes down)');
ok(D.roundTick(15309.6, 0.25) === 15309.5 && D.roundTick(15309.63, 0.25) === 15309.75, 'roundTick nearest tick');
ok(Math.abs(D.roundTick(1.234567, 0.00005) - 1.23455) < 1e-9 && D.roundTick(5.5, 0) === 5.5 && D.roundTick(5.5, undefined) === 5.5, 'roundTick: no tick -> unchanged');
ok(D.tickDecimals(0.25) === 2 && D.tickDecimals(1) === 0 && D.tickDecimals(0.00001) === 5 && D.tickDecimals(0.5) === 1, 'tickDecimals');
ok(C.fmtPrice(15309.5, 2) === '15309.50' && C.fmtPrice(7, 0) === '7', 'fmtPrice uses the tick decimals');
console.log(n + ' passed');
