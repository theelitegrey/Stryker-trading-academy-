// Spectra core unit tests (pure node):  node tools/tests/spectra.test.mjs
// Board model, Apex (top node), floor / ceiling, spot row, velocity deltas, agreement, futures mapping, alert docs, copy.
// Hand-made boards below are Sample data for tests; the real-chain fixtures are tools/fixtures/zoro/board-*.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../../assets/spectra-core.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log('PASS', m); };

// Sample data: 5 strikes (low to high, as the API sends them), 3 expiries, spot 102. $M.
const B = { t: 1000, spot: 102, step: 1, k: [100, 101, 102, 103, 104], x: ['2026-11-17', '2026-11-20', '2026-12-18'], tag: ['0DTE', 'Monthly', ''],
  gex: [[5, -20, 1, 2, 30], [-3, 2, 0, 40, 1], [0, 0, -2, -1, 0]],
  vex: [[1, 1, 1, 1, 1], [-9, 0, 0, 0, 0], [0, 0, 0, 0, 2]] };
const m = S.boardModel(B, 'gex');
eq(m.rows.map((r) => r.k), [104, 103, 102, 101, 100], 'rows high to low');
eq(m.rows[0].cells, [30e6, 1e6, 0], 'cells in dollars, one per expiry');
eq(m.cols.map((c) => c.label.date + ' ' + c.tag), ['Nov 17 0DTE', 'Nov 20 Monthly', 'Dec 18 '], 'column labels + tags');
ok(S.boardModel({ k: [], x: [] }, 'gex') === null && S.boardModel({ k: [1], x: ['a'], gex: [] }, 'gex') === null, 'empty / broken body -> null');

// Apex = biggest |value|
let tn = S.topNode(m);
eq([tn.k, tn.x, tn.v], [103, '2026-11-20', 40e6], 'Apex = 103 / Nov 20 (+$40M)');
const mv = S.boardModel(B, 'vex');
tn = S.topNode(mv);
eq([tn.k, tn.x, tn.v], [100, '2026-11-20', -9e6], 'Apex follows the view: VEX Apex = 100 / Nov 20 (-$9M)');
ok(S.topNode(S.boardModel({ k: [1], x: ['2026-01-01'], gex: [[0]] }, 'gex')) === null, 'all-zero board has no Apex');

// floor / ceiling
let fc = S.floorCeiling(m);
eq([fc.floor.k, fc.floor.v], [101, -20e6], 'floor = biggest |value| below spot (101, -$20M)');
eq([fc.ceiling.k, fc.ceiling.v], [103, 40e6], 'ceiling = biggest |value| above spot (103, +$40M)');
fc = S.floorCeiling(mv);
eq([fc.floor.k, fc.ceiling.k], [100, 104], 'VEX floor 100, ceiling 104');
eq(S.spotRow(m), 2, 'spot row = strike 102');
eq(S.spotRow(S.boardModel(Object.assign({}, B, { spot: 103.6 }), 'gex')), 0, 'spot row = nearest strike (104)');

// velocity
const P = JSON.parse(JSON.stringify(B)); P.t = 700; P.gex[1][3] = 20; P.gex[0][4] = 31; P.gex[0][1] = -40; P.x[2] = '2026-12-11';
const vel = S.velocity(m, P, 'gex');
const at = (k, x) => vel[m.rows.findIndex((r) => r.k === k)][m.cols.findIndex((c) => c.x === x)];
eq([at(103, '2026-11-20').dir, at(103, '2026-11-20').d, at(103, '2026-11-20').pct], [1, 20e6, 100], '103 Nov 20: 20 -> 40 grows (+$20M, +100%)');
eq(at(104, '2026-11-17').dir, 0, '104 Nov 17: 31 -> 30 is flat (under 5%)');
eq([at(101, '2026-11-17').dir, at(101, '2026-11-17').d], [-1, 20e6], '101 Nov 17: -40 -> -20 shrinks (|value| down)');
eq(at(102, '2026-12-18').dir, null, 'column not on the earlier board -> no velocity');
ok(S.velocity(m, null, 'gex').every((r) => r.every((c) => c.dir === null)), 'no earlier board -> every cell null');
ok(S.velocity(mv, P, 'vex').every((r, ri) => r.every((c, ci) => ci === 2 || c.dir === 0)), 'VEX velocity uses the VEX grid (unchanged -> flat)');

// agreement
eq(S.leanOf(m), 'up', 'lean: Apex above spot -> up');
eq(S.leanOf(mv), 'down', 'lean: VEX Apex below spot -> down');
eq(S.agreement(['up', 'up', 'up']), 'agree', 'all up -> agree');
eq(S.agreement(['up', 'up', 'down']), 'mixed', '2 of 3 -> mixed');
eq(S.agreement(['up', 'down', 'flat']), 'disagree', 'no majority -> disagree');
eq(S.agreement(['up', null, null]), null, 'fewer than 2 known -> null');
eq(S.agreement(['down', 'down', null]), 'agree', 'two known and the same -> agree');

// futures mapping
eq(['CME_MINI:NQ1!', 'MNQ1!', 'futures:MNQZ6', 'ES1!', 'MES', 'COMEX:GC1!', 'MGCZ6', 'SPXW', 'QQQ', 'AAPL', 'CL1!'].map(S.tickerFor),
  ['QQQ', 'QQQ', 'QQQ', 'SPX', 'SPX', 'GLD', 'GLD', 'SPX', 'QQQ', null, null], 'chart symbol -> Spectra ticker (NQ -> QQQ, ES -> SPX, GC -> GLD)');

// alerts
eq(S.priceAlertFor('touch', 103, 102, 1, (v) => v * 10), { cond: 'crossing', price: 1030 }, 'touch: a crossing alert at the converted strike');
eq(S.priceAlertFor('near', 103, 102, 1, null), { cond: 'crossing_up', price: 102, at: 102 }, 'near (strike above): crossing up one step before it');
eq(S.priceAlertFor('near', 100, 102, 1, null), { cond: 'crossing_down', price: 101, at: 101 }, 'near (strike below): crossing down one step before it');
const nd = S.nodeAlertDoc('SPX', 'gex', '2026-11-20', 103, 40e6, 'grow', 25);
eq(nd.p, { k: 103, x: '2026-11-20', view: 'gex', dir: 'grow', pct: 25, base: 40 }, 'node alert doc (base in $M)');
ok(Object.keys(nd.p).length <= 6 && nd.type === 'node_change', 'node alert p fits the rules (<= 6 keys)');
ok(S.nodeAlertDoc('AAPL', 'gex', '2026-11-20', 1, 1, 'grow', 5) === null && S.nodeAlertDoc('SPX', 'gex', '2026-11-20', 1, 1, 'grow', 0) === null, 'node alert: bad symbol / 0% -> null');
const rules = fs.readFileSync(new URL('../../functions-src/firestore.rules', import.meta.url), 'utf8');
const zr = rules.slice(rules.indexOf('match /zoroAlerts/{aid}'), rules.indexOf('match /zoroAlerts/{aid}') + 1200);
ok(zr.includes("'node_change'") && zr.includes("d.type == 'node_change' ? 6 : 4"), 'rules allow node_change with its 6 keys');

// money + copy
eq([S.fmtMoney(1.74e9), S.fmtMoney(-2.4e8), S.fmtMoney(85e3), S.fmtMoney(12.3e6), S.fmtMoney(0)], ['+$1.7B', '\u2212$240M', '+$85K', '+$12.3M', '$0'], 'money format');
eq(S.updatedText(1000, 1045e3), 'Updated 45 s ago', 'updated seconds');
eq(S.updatedText(1000, (1000 + 600) * 1e3), 'Updated 10 min ago', 'updated minutes');
const src = fs.readFileSync(new URL('../../assets/spectra-core.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../../assets/spectra-board.js', import.meta.url), 'utf8');
const strings = (src.match(/'[^'\n]*'|`[^`]*`/g) || []).join(' ');
ok(!/\b(delayed|behind|king)\b/i.test(strings), 'no "delayed" / "behind" / "King" in any UI string');

// colours: positive greenish, negative magenta, small near the background, in both themes
const [pr, pg] = S.cellColor(1, 1, 'dark'), [nr, , nb] = S.cellColor(-1, 1, 'dark'), small = S.cellColor(0.0001, 1, 'dark');
ok(pg > pr && nr > 150 && nb > 100 && small.every((c) => c < 45), 'dark scale: green +, magenta -, small dark');
ok(S.cellColor(0, 1, 'light').every((c) => c > 230), 'light scale: small = near white');
ok(S.inkOn([3, 201, 136]) === '#07130e' && S.inkOn([24, 23, 38]) === '#f2f5f8', 'ink contrast picks dark on bright, light on dark');

// real-chain fixtures (2026-11-17): every board has an Apex, a floor and a ceiling; the trio gives a verdict
const fx = (u) => JSON.parse(fs.readFileSync(new URL('../fixtures/zoro/board-' + u + '.json', import.meta.url), 'utf8'));
const leans = [];
for (const u of ['SPX', 'SPY', 'QQQ', 'GLD']) {
  const bm = S.boardModel(fx(u), 'gex'), f = S.floorCeiling(bm);
  ok(S.topNode(bm) && f.floor && f.ceiling && f.floor.k < bm.spot && f.ceiling.k > bm.spot, u + ' fixture: Apex, floor < spot < ceiling');
  if (S.TRIO.includes(u)) leans.push(S.leanOf(bm));
}
ok(['agree', 'mixed', 'disagree'].includes(S.agreement(leans)), 'trio on the fixtures gives a verdict (' + S.agreement(leans) + ')');

console.log('\n' + n + ' checks passed');
