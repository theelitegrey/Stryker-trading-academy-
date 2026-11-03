// Unit tests: Options Flow Marks (assets/chart-optflow.js), Off-exchange Volume (assets/chart-offex.js), FINRA feeder parsing.
//   node tools/tests/optflow-offex.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
globalThis.window = { __stkReplay: { on: false } }; globalThis.document = undefined;
const { perBar, pickMarks, tipRows } = await import('../../assets/chart-optflow.js');
const O = await import('../../assets/chart-offex.js');
const { parseRegSho, mergeWeekly } = createRequire(import.meta.url)('../fetch-finra.js');
let n = 0; const t = (name, f) => { f(); n++; console.log('PASS ' + name); };

const MIN = 60000, T0 = Date.UTC(2026, 10, 3, 14, 30);
const bars = [0, 1, 2, 3].map((i) => ({ time: T0 + i * 5 * MIN }));
const day = { t: [], cn: [], pn: [], cp: [], pp: [], cv: [], pv: [] };
const add = (min, cp, pp, cn = 0, pn = 0) => { day.t.push((T0 + min * MIN) / 1000); day.cp.push(cp); day.pp.push(pp); day.cn.push(cn); day.pn.push(pn); day.cv.push(10); day.pv.push(5); };
add(0, 100, 50, 60, -10); add(2, 300, 0, 200, 0); add(11, 0, 900, 0, -700); add(30, 999, 999);   // 30 min is past the last bar
t('perBar sums the samples inside each bar', () => {
  const a = perBar([day], bars, 5 * MIN);
  assert.equal(a[0].cp, 400); assert.equal(a[0].cn, 260); assert.equal(a[0].cv, 20); assert.equal(a[0].n, 2);
  assert.equal(a[1], null); assert.equal(a[2].pp, 900); assert.equal(a[3], null);
});
t('perBar ignores a sample after the last bar and an empty list', () => {
  assert.equal(perBar([day], bars, 5 * MIN).reduce((s, b) => s + (b ? b.cp : 0), 0), 400);
  assert.deepEqual(perBar([], bars, 5 * MIN), [null, null, null, null]);
});
t('pickMarks: floor, side, size scaling', () => {
  const a = perBar([day], bars, 5 * MIN);
  const m = pickMarks(a, { sensitivity: 'Many', minPremium: 100 });
  assert.deepEqual(m.map((x) => x.side + x.i).sort(), ['C0', 'P2']);
  assert.ok(m.find((x) => x.side === 'P').r > m.find((x) => x.side === 'C').r);   // 900 > 400
  assert.equal(pickMarks(a, { minPremium: 500 }).length, 1);
  assert.equal(pickMarks(a, { minPremium: 5000 }).length, 0);
});
t('tipRows says strike / expiry are not in the data, never invents them', () => {
  const m = pickMarks(perBar([day], bars, 5 * MIN), { minPremium: 0 })[0];
  const r = tipRows(m); const txt = JSON.stringify(r);
  assert.match(txt, /Strike \/ expiry/); assert.match(txt, /not in the data/); assert.match(txt, /Not a single trade/);
  assert.doesNotMatch(txt, /live|real-time|delayed/i);
});
t('feedSymbol', () => {
  const k = { SPY: 1, AAPL: 1 };
  assert.equal(O.feedSymbol('SPY', k), 'SPY'); assert.equal(O.feedSymbol('nasdaq:aapl', k), 'AAPL'); assert.equal(O.feedSymbol('ES1!', k), ''); assert.equal(O.feedSymbol('', k), '');
});
t('shareSeries: % of the chart volume, null when unknown or over 100', () => {
  const d = Date.UTC(2026, 10, 2);
  const p = O.shareSeries([['20261102', 4000, 1000]], [{ time: d, volume: 10000 }, { time: d + 86400000, volume: 10000 }, { time: d - 86400000, volume: 0 }]);
  assert.equal(p[0].value, 40); assert.equal(p[1].value, null); assert.equal(p[2].value, null);
  assert.equal(O.shareSeries([['20261102', 4000, 1]], [{ time: d, volume: 1000 }])[0].value, null);
});
t('weeklyLevels merges close average prices and ranks by shares', () => {
  const rows = [['2026-10-05', 100, 10000, 100, 10000], ['2026-10-12', 100, 10040, 100, 10040], ['2026-10-19', 50, 7500, 50, 7500]];   // 100.0, 100.4, 150
  const L = O.weeklyLevels(rows, { max: 5 });
  assert.equal(L.length, 2); assert.equal(L[0].weeks.length, 2); assert.ok(Math.abs(L[0].price - 100.2) < 0.01); assert.equal(L[0].shares, 400); assert.equal(L[1].price, 150);
  assert.equal(O.weeklyLevels(rows, { max: 1 }).length, 1); assert.deepEqual(O.weeklyLevels([], {}), []);
});
t('dataAge / shortNum', () => {
  assert.equal(O.dataAge(Date.now() - 3 * 86400000 - 1000), 'Data refreshed 3 days ago'); assert.equal(O.dataAge(Date.now()), 'Data refreshed today');
  assert.equal(O.shortNum(48147874), '48.1M'); assert.equal(O.shortNum(950), '950');
});
t('parseRegSho keeps wanted symbols only, skips junk', () => {
  const txt = 'Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\r\n20261102|SPY|10721064.5|7939|19334798.2|B,Q,N\r\n20261102|ZZZZ|1|0|2|B\r\n20261102|AAPL|x|0|5|B\r\n';
  assert.deepEqual(parseRegSho(txt), { SPY: [19334798, 10721065] });
});
t('mergeWeekly pairs ATS and OTC by week, oldest first', () => {
  const r = [{ weekStartDate: '2026-10-12', summaryTypeCode: 'OTC_W_SMBL', totalWeeklyShareQuantity: 20.4, totalNotionalSum: 200 }, { weekStartDate: '2026-10-12', summaryTypeCode: 'ATS_W_SMBL', totalWeeklyShareQuantity: 10, totalNotionalSum: 100 },
    { weekStartDate: '2026-10-05', summaryTypeCode: 'ATS_W_SMBL', totalWeeklyShareQuantity: 5, totalNotionalSum: 50 }, { weekStartDate: '2026-10-05', summaryTypeCode: 'X', totalWeeklyShareQuantity: 5, totalNotionalSum: 50 }];
  assert.deepEqual(mergeWeekly(r), [['2026-10-05', 5, 50, 0, 0], ['2026-10-12', 10, 100, 20, 200]]);
});
console.log(n + ' passed');
