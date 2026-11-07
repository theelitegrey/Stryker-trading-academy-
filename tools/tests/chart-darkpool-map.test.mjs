// Unit tests: assets/chart-darkpool-map.js (dark pool prints moved onto the futures price).
// Fixtures: real SPY / QQQ feeder parts and real 1-minute bars (NQ, ES, QQQ, SPY) of 2026-11-06.
//   node tools/tests/chart-darkpool-map.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const M = await import('../../assets/chart-darkpool-map.js');
const D = await import('../../assets/chart-darkpool.js');
const fx = (f) => JSON.parse(fs.readFileSync(new URL('../fixtures/' + f, import.meta.url)));
const SPY = fx('darkpool-spy-2026-11-06.json'), QQQ = fx('darkpool-qqq-2026-11-06.json'), BARS = fx('darkpool-bars1m-2026-11-06.json');
const rows = (k) => BARS[k].map(([t, c]) => [t, c, c, c, c, 0]);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };

ok(M.futRoot('futures:ES1!') === 'ES' && M.futRoot('CME_MINI:NQ1!') === 'NQ' && M.futRoot('futures:MYM1!') === 'MYM' && M.futRoot('futures:M2K1!') === 'M2K' && M.futRoot('futures:RTY1!') === 'RTY', 'futures roots with a matching ETF');
ok(M.futRoot('futures:CL1!') === '' && M.futRoot('futures:GC1!') === '' && M.futRoot('IDX:SPY') === '' && M.futRoot('stocks:NYSE:ES') === '' && M.futRoot('') === '', 'CL, GC, stocks, ETFs -> no match');
ok(M.FUT_ETF.ES === 'SPY' && M.FUT_ETF.MES === 'SPY' && M.FUT_ETF.NQ === 'QQQ' && M.FUT_ETF.MNQ === 'QQQ' && M.FUT_ETF.YM === 'DIA' && M.FUT_ETF.MYM === 'DIA' && M.FUT_ETF.RTY === 'IWM' && M.FUT_ETF.M2K === 'IWM', 'ETF pairs');
ok(D.targetOf('futures:ES1!') === 'SPY' && D.targetOf('IDX:QQQ') === 'QQQ' && D.targetOf('futures:CL1!') === '', 'indicator target: ES -> SPY, QQQ -> QQQ, CL -> none');

// ratio rule on small numbers
const mk = (a) => M.minuteIndex(a.map(([min, c]) => [min * 60, 0, 0, 0, c, 0]));
const F = mk([[10, 6800], [11, 6810], [20, 6900]]), E = mk([[10, 700], [11, 700], [20, 710]]);
const at = (min, s = 0) => (min * 60 + s) * 1000;
let m = M.mapPrint({ t: at(10, 30), p: 701 }, F, E);
ok(m.p === 6809.71 && m.ep === 701 && Math.abs(m.ratio - 6800 / 700) < 1e-12, 'same minute: 701 x (6800 / 700) = 6809.71');
m = M.mapPrint({ t: at(11, 59), p: 700 }, F, E);
ok(m.p === 6810, 'uses the minute the print falls in (last second)');
ok(M.mapPrint({ t: at(13), p: 700 }, F, E).p === 6810, 'no bar in the minute: nearest minute (11, 2 min back) is used');
ok(M.mapPrint({ t: at(5), p: 700 }, F, E).ratio === 6800 / 700, 'five minutes out is allowed (5 is 5 before 10)');
const F3 = mk([[11, 6810], [17, 6900]]), E3 = mk([[11, 700], [17, 710]]);
ok(M.mapPrint({ t: at(14), p: 700 }, F3, E3).ratio === 6810 / 700, 'tie in distance (3 min each side): the earlier minute wins');
ok(M.mapPrint({ t: at(15), p: 700 }, F3, E3).ratio === 6900 / 710, 'closer later minute wins (15: 2 min to 17, 4 to 11)');
ok(M.mapPrint({ t: at(4), p: 700 }, F, E) === null, 'more than 5 min from a bar: skipped');
ok(M.mapPrint({ t: at(26), p: 700 }, F, E) === null && M.mapPrint({ t: at(25), p: 700 }, F, E).ratio === 6900 / 710, 'exactly 5 min away is used, 6 is skipped');
// a minute with only one side does not count
const F2 = mk([[10, 6800], [12, 6820]]), E2 = mk([[10, 700], [11, 700]]);
ok(M.mapPrint({ t: at(12), p: 700 }, F2, E2).ratio === 6800 / 700, 'bar on the futures side only: falls back to the nearest minute that has both');
ok(M.mapPrint({ t: at(10), p: 700 }, new Map(), E) === null, 'no futures bars: skipped');
const r = M.mapPrints([{ t: at(10), p: 700 }, { t: at(1), p: 700 }], F, E);
ok(r.list.length === 1 && r.skipped === 1, 'mapPrints counts skipped');
ok(M.minuteIndex([[60, 0, 0, 0, 5, 0], [120, 0, 0, 0, NaN, 0], null, [180, 0, 0, 0, 0, 0]]).size === 1, 'bad bar rows ignored');
ok(M.pagesFor([{ t: 28800 * 1000 * 10 + 60000 }]).join() === '9,10' && M.pagesFor([{ t: 28800 * 1000 * 10 + 3600e3 }]).join() === '10', 'pages: previous page added only near a page start');

// real day: NQ from QQQ prints, ES from SPY prints
function real(part, fut, etf) {
  const all = D.prints(part, 1e6);
  const res = M.mapPrints(all, M.minuteIndex(rows(fut)), M.minuteIndex(rows(etf)));
  return { all, res, fi: M.minuteIndex(rows(fut)), ei: M.minuteIndex(rows(etf)) };
}
for (const [part, fut, etf, lo, hi] of [[QQQ, 'NQ1!', 'QQQ', 25000, 29000], [SPY, 'ES1!', 'SPY', 7000, 7800]]) {
  const { all, res, fi, ei } = real(part, fut, etf);
  ok(res.list.length + res.skipped === all.length && res.list.length > 100, etf + ': ' + res.list.length + ' of ' + all.length + ' prints placed, ' + res.skipped + ' skipped (outside the ETF session)');
  ok(res.list.every((x) => x.p > lo && x.p < hi), etf + ': every placed price is a plausible ' + fut.replace('1!', '') + ' level');
  const x = res.list.find((y) => Math.floor(y.t / 60000) * 60000 === y.t - (y.t % 60000) && fi.has(Math.floor(y.t / 60000) * 60000) && ei.has(Math.floor(y.t / 60000) * 60000));
  const mn = Math.floor(x.t / 60000) * 60000;
  ok(Math.abs(x.p - x.ep * fi.get(mn) / ei.get(mn)) < 0.006, etf + ': sample print ' + x.ep + ' -> ' + x.p + ' = ratio ' + fi.get(mn) + ' / ' + ei.get(mn));
  ok(res.list.every((y) => Math.abs(y.p / y.ep - y.ratio) < 0.001 * y.ratio), etf + ': price / ETF price = the ratio on every placed print');
}
// tooltip text
const q = real(QQQ, 'NQ1!', 'QQQ').res.list[0];
const tip = D.tipRows(Object.assign({}, q, { fut: 'NQ', etf: 'QQQ' }));
const price = tip.rows.find((r) => /QQQ .* at NQ ≈/.test(r[1]));
ok(price && price[1] === 'QQQ ' + q.ep.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' · at NQ ≈ ' + q.p.toLocaleString('en-US', { minimumFractionDigits: 2 }), 'tooltip: "' + (price && price[1]) + '"');
ok(/^QQQ /.test(tip.title) && /NQ price/.test(tip.note), 'tooltip title and note name the ETF and the futures');
ok(D.tipRows({ t: 1, p: 736.27, s: 1, v: 5, c: '' }).rows[1][0] === 'Price', 'stock tooltip unchanged');
console.log('ALL PASS (' + n + ')');
