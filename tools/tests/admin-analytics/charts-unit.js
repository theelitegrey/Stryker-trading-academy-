// Unit tests for the admin chart series builders (assets/admin-charts.js).
// Run: node tools/tests/admin-analytics/charts-unit.js
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '../../../assets/admin-charts.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const D = 86400000;

check('IST day key flips at 18:30 UTC, not at UTC midnight', () => {
  assert.strictEqual(C.istDayKey(Date.UTC(2026, 10, 7, 18, 29)), '2026-11-07');
  assert.strictEqual(C.istDayKey(Date.UTC(2026, 10, 7, 18, 30)), '2026-11-08');
  assert.strictEqual(C.istMidnightMs(Date.UTC(2026, 10, 7, 20, 0)), Date.UTC(2026, 10, 7, 18, 30));
});
check('fmtIST shows IST wall time', () => {
  assert.strictEqual(C.fmtIST(Date.UTC(2026, 10, 7, 20, 5)), '8 Nov 2026, 01:35 IST');
  assert.strictEqual(C.fmtTimeIST(Date.UTC(2026, 10, 7, 0, 0)), '05:30');
});
check('dayKeys: consecutive, oldest first, across a month end', () => {
  assert.deepStrictEqual(C.dayKeys('2026-11-02', 4), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});
check('rangeKeys: 7/30/90 lengths; seriesStart clips; all starts at seriesStart', () => {
  assert.strictEqual(C.rangeKeys('7d', '2026-11-07').length, 7);
  assert.strictEqual(C.rangeKeys('30d', '2026-11-07').length, 30);
  assert.strictEqual(C.rangeKeys('90d', '2026-11-07').length, 90);
  const all = C.rangeKeys('all', '2026-11-07', '2026-09-28');
  assert.strictEqual(all[0], '2026-09-28');
  assert.strictEqual(all.length, 41);
  assert.strictEqual(C.rangeKeys('90d', '2026-11-07', '2026-11-05').length, 3);
});
check('dailySeries: gaps stay null (never 0), non-numbers are null', () => {
  const docs = { '2026-11-01': { totalUsers: 10 }, '2026-11-03': { totalUsers: 12 }, '2026-11-04': { totalUsers: 'x' } };
  const keys = C.dayKeys('2026-11-04', 4);
  const v = C.dailySeries(docs, keys, (d) => d.totalUsers);
  assert.deepStrictEqual(v, [10, null, 12, null]);
  assert.strictEqual(C.realCount(v), 2);
});
check('bucketOrders: IST days, payments vs trials vs free/refunded, USD + unconverted, conversion', () => {
  const now = Date.UTC(2026, 10, 7, 20, 0);   // 8 Nov IST
  const orders = [
    { uid: 'a', kind: 'trial', finalAmount: 0, gateway: 'stripe', status: 'completed', ms: now - 8 * D },
    { uid: 'a', finalAmount: 19, currency: 'USD', amountUsd: 19, gateway: 'stripe', status: 'completed', ms: now - D },
    { uid: 'b', kind: 'trial', finalAmount: 0, gateway: 'stripe', status: 'completed', ms: now },
    { uid: 'c', finalAmount: 0, gateway: 'coupon', status: 'completed', ms: now },
    { uid: 'd', finalAmount: 999, currency: 'INR', amountUsd: 12, gateway: 'razorpay', status: 'completed', ms: now },
    { uid: 'g', finalAmount: 999, currency: 'INR', gateway: 'razorpay', status: 'completed', ms: now },
    { uid: 'e', finalAmount: 19, currency: 'USD', gateway: 'stripe', status: 'refunded', ms: now },
    { uid: 'f', finalAmount: 19, currency: 'USD', gateway: 'stripe', status: 'completed', ms: now - 200 * D },
    { uid: 'h', finalAmount: 49, currency: 'USD', gateway: 'stripe', status: 'completed', ms: null }
  ];
  const b = C.bucketOrders(orders, now, 90);
  assert.strictEqual(b.keys.length, 90);
  assert.strictEqual(b.keys[89], '2026-11-08');
  assert.deepStrictEqual(b.by['2026-11-08'], { payments: 2, usd: 12, unconverted: 1, trials: 1, converted: 0 });
  assert.deepStrictEqual(b.by[C.istDayKey(now - D)], { payments: 1, usd: 19, unconverted: 0, trials: 0, converted: 0 });
  assert.deepStrictEqual(b.by[C.istDayKey(now - 8 * D)], { payments: 0, usd: 0, unconverted: 0, trials: 1, converted: 1 });
  const total = b.keys.reduce((a, k) => a + b.by[k].payments, 0);
  assert.strictEqual(total, 3, 'out-of-window, undated, free and refunded orders are not counted');
});
check('bucketOrders with 1 day = today only', () => {
  const now = Date.UTC(2026, 10, 7, 10, 0);
  const b = C.bucketOrders([{ uid: 'x', finalAmount: 5, currency: 'USD', gateway: 'stripe', status: 'completed', ms: now - D }], now, 1);
  assert.deepStrictEqual(b.keys, ['2026-11-07']);
  assert.strictEqual(b.by['2026-11-07'].payments, 0);
});
check('csv quotes commas, quotes and newlines; blanks for null', () => {
  assert.strictEqual(C.csv(['a', 'b'], [['x,y', null], ['he said "hi"', 2]]), 'a,b\n"x,y",\n"he said ""hi""",2\n');
});
check('niceMax rounds up to 1/2/2.5/5 x 10^n', () => {
  assert.strictEqual(C.niceMax(0), 1);
  assert.strictEqual(C.niceMax(7), 10);
  assert.strictEqual(C.niceMax(180), 200);
  assert.strictEqual(C.niceMax(2.2), 2.5);
  assert.strictEqual(C.niceMax(41), 50);
});

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
