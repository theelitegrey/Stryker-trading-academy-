// Phantom pure maths (assets/phantom-core.js).   node tools/tests/phantom-core.test.mjs
import assert from 'node:assert/strict';
import * as P from '../../assets/phantom-core.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log('PASS ' + m); };

// futures mapping
eq(['futures:ES1!', 'MES1!', 'CME_MINI:NQ1!', 'MNQZ6', 'futures:GC1!', 'SPXW', 'stocks:AMEX:SPY', 'QQQ', 'AAPL', 'BTCUSDT', 'futures:CL1!'].map(P.phantomSource),
  ['SPX', 'SPX', 'QQQ', 'QQQ', 'GLD', 'SPX', 'SPY', 'QQQ', null, null, null], 'futures map ES/MES->SPX, NQ/MNQ->QQQ, GC->GLD; others not covered');

// contracts
eq(P.parseOcc('SPXW261120C07000000'), { root: 'SPXW', exp: '2026-11-20', cp: 'C', strike: 7000 }, 'OCC key parsed');
eq(P.parseOcc('QQQ261218P00612500').strike, 612.5, 'OCC half strike');
ok(P.parseOcc('nope') === null, 'bad key -> null');
ok(P.dte('2026-11-20', '2026-11-17') === 3 && P.dte('2026-11-17', '2026-11-17') === 0, 'DTE in calendar days');
ok(P.volOi(300, 100) === 3 && P.volOi(5, 0) === Infinity && P.volOi(0, 0) === 0, 'Vol/OI, no OI with volume = new');

// net premium
const sum = { day: '2026-11-17', u: {
  SPX: { t: 100, tot: { cp: 9e6, pp: 7e6, cn: 3e6, pn: 1e6 }, mcols: P.MOVE_COLS, moves: [[100, 'SPXW261117C07000000', 500, 900000, 18, 4000, 1000], [160, 'SPXW261120P06900000', 300, 400000, 13.3, 300, 900]] },
  QQQ: { t: 100, tot: { cp: 2e6, pp: 3e6, cn: -5e5, pn: 1.5e6 }, mcols: P.MOVE_COLS, moves: [[130, 'QQQ261219C00620000', 1000, 450000, 4.5, 2500, 2000]] },
  SPY: { t: 100, tot: { cp: 1e6, pp: 1e6, cn: 2e5, pn: -3e5 }, mcols: P.MOVE_COLS, moves: [] } } };
ok(P.netImpactOf({ cn: 3e6, pn: 1e6 }) === 2e6, 'net impact = net call premium - net put premium (bought puts are bearish)');
const ni = P.netImpact(sum);
eq(ni.map((x) => [x.u, x.net]), [['SPX', 2e6], ['SPY', 5e5], ['QQQ', -2e6]], 'Net Impact ranked best first, only symbols we have (no GLD padding)');
ok(P.netImpact(null).length === 0, 'no summary -> empty');

// board -> rows, flags, grid
const board = { day: '2026-11-17', exps: ['2026-11-17', '2026-11-18', '2026-12-19'], cols: P.BOARD_COLS, rows: [
  ['SPXW261117C07000000', 0, 7000, 'C', 4000, 1000, 900000, 600000, 2, null, null],
  ['SPXW261117P07000000', 0, 7000, 'P', 50, 1000, 10000, -4000, 2, null, null],
  ['SPXW261117P06900000', 0, 6900, 'P', 300, 900, 400000, 200000, 13, -50, 800],
  ['SPXW261118C07100000', 1, 7100, 'C', 90, 10, 50000, 10000, 5, 30, 20],
  ['SPX261219C07000000', 2, 7000, 'C', 0, 5000, 0, 0, 80, -20, 10]
] };
const rows = P.boardRows(board);
ok(rows.length === 5 && rows[0].exp === '2026-11-17' && rows[0].vo === 4 && rows[0].dte === 0 && rows[3].dte === 1, 'board rows: expiry, Vol/OI, DTE');
const cut = P.topCut(rows, 25);
ok(cut === 900000, 'top 25% premium cut: 4 contracts with premium -> the biggest one');
eq(P.flagsOf(rows[0], cut), { vo: true, top: true }, 'Vol/OI 4 with 4,000 volume -> unusual, top premium -> flagged');
eq(P.flagsOf(rows[3], cut), { vo: false, top: false }, 'Vol/OI 9 on 90 contracts is below the size floor -> not unusual');
const g = P.strikeGrid(rows, { side: 'all', topPct: 25 });
eq(g.exps, ['2026-11-17', '2026-11-18'], 'grid columns: expiries that have premium, nearest first');
eq(g.strikes, [7100, 7000, 6900], 'grid rows: strikes high to low');
ok(g.cells[1][0].p === 910000 && g.cells[1][0].keys.length === 2 && g.cells[1][0].flags.vo && g.cells[1][0].flags.top, '7000 x Nov 17: call + put premium summed, flags kept');
ok(g.cells[0][0] === null && g.max === 910000, 'empty cell null; max = biggest cell');
const gc = P.strikeGrid(rows, { side: 'C' });
ok(gc.cells.every((r) => r.every((c) => !c || c.keys.every((k) => /C\d{8}$/.test(k)))), 'calls-only grid has only calls');
const gn = P.strikeGrid(rows, { side: 'net' });
ok(gn.cells[gn.strikes.indexOf(7000)][0].p === 600000 + 4000 && gn.cells[gn.strikes.indexOf(6900)][0].p === -200000, 'net grid: bought calls +, bought puts −');
ok(P.strikeGrid(rows, { maxStrikes: 1 }).strikes[0] === 7000, 'maxStrikes keeps the strikes with the most premium');
ok(P.heat(910000, 910000) === 1 && P.heat(0, 1) === 0 && Math.abs(P.heat(227500, 910000) - 0.5) < 1e-9, 'heat = sqrt share of max');

// whales
const wl = P.summaryWhales(sum);
ok(wl.length === 3 && wl[0].u === 'SPX' && wl[0].vo === 4 && wl[0].dte === 0, 'whale rows from every symbol, with Vol/OI and DTE');
eq(P.filterWhales(wl, {}).map((w) => w.p), [900000, 450000, 400000], 'whales ranked by premium');
eq(P.filterWhales(wl, { side: 'P' }).map((w) => w.k), ['SPXW261120P06900000'], 'filter puts');
eq(P.filterWhales(wl, { u: 'QQQ' }).map((w) => w.u), ['QQQ'], 'filter ticker');
eq(P.filterWhales(wl, { maxDte: 3 }).map((w) => w.p), [900000, 400000], 'filter DTE <= 3');
eq(P.filterWhales(wl, { minPrem: 450000 }).length, 2, 'filter min premium');
eq(P.filterWhales([{ u: 'SPX', t: 2, p: 5, cp: 'C', dte: 0 }, { u: 'SPX', t: 1, p: 5, cp: 'C', dte: 0 }], {}).map((w) => w.t), [1, 2], 'tie -> earlier first');

// drilldown
const reply = { k: ['SPXW261117P06900000', 'SPXW261118C07100000'], t: [100, 160, 220], s: [[[100, 130000], [0, 0], [200, 270000]], [[0, 0], [90, 50000], [0, 0]]], next: { day: '2026-11-18', oi: [850, 40], doi: [-50, 30] } };
const by = new Map(rows.map((r) => [r.k, r]));
const dd = P.drillSeries(reply, by);
eq(dd[0].cumV, [100, 100, 300], 'drill: running volume');
ok(dd[0].prem === 400000 && dd[0].t[2] === 220000 && dd[0].vo === 300 / 900, 'drill: premium total, ms times, Vol/OI from the board');
eq(dd[0].next, { day: '2026-11-18', doi: -50, label: 'Position likely closed' }, 'drill: next morning OI fell -> likely closed');
eq(dd[1].next.label, 'Position likely opened', 'drill: OI rose -> likely opened');
ok(P.drillSeries({ k: ['X'], t: [], s: [[]], next: null }, new Map())[0].next === null, 'drill: no next session stored -> no label');
ok(P.oiLabel(0) === 'No change in open interest' && P.oiLabel(null) === '', 'OI label edge cases');

// tide
const ts = P.tideSeries({ day: 'd', t: [1, 2, 3], cn: [10, -5, 20], pn: [-1, -2, 4], s: [1, 2, 3] });
eq([ts.cn, ts.pn, ts.t], [[10, 5, 25], [-1, -3, 1], [1000, 2000, 3000]], 'tide running totals');

// formatting
eq([P.usd(1234567), P.usd(-2500, true), P.usd(3e6, true), P.usd(NaN)], ['$1.2M', '−$3K', '+$3.0M', '–'], 'usd');
eq([P.fmtExp('2026-11-20'), P.fmtStrike(7000), P.fmtStrike(612.5), P.fmtVo(Infinity), P.fmtVo(1.234), P.fmtVo(12.6)], ['Nov 20', '7,000', '612.50', 'new', '1.23', '13'], 'formatting');
eq([P.agoText(100, 130000), P.agoText(100, 400000), P.agoText(null)], ['Updated 30 s ago', 'Updated 5 min ago', ''], 'updated X ago wording');
ok(P.contractName(P.parseOcc('QQQ261219C00620000')) === 'Dec 19 620 call', 'contract name');
console.log(n + ' passed');
