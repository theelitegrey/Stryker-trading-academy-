// Unit test: plan-price.js sale maths + names. planSaleInfo().pct is still
// computed (rounded DOWN from the prices the visitor sees) but NO "% OFF"
// badge is rendered in the price row (CoS ruling 2026-10-11: cancel stands).
//   node tools/tests/plan-pct-unit.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function load(tz, rate) {
  const ctx = {
    window: {}, console,
    localStorage: { getItem: () => null, setItem() {} },
    document: { addEventListener() {}, querySelectorAll: () => [] },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: tz }) }) },
    location: { hostname: 'x', search: '' }, URLSearchParams,
    setInterval, clearInterval, Date, Math, String, parseFloat, isFinite, isNaN, Number
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'plan-price.js'), 'utf8'), ctx);
  if (rate) vm.runInContext('STRYKER_USD_INR = ' + rate, ctx);
  return ctx;
}

const PRO = { name: 'Pro', price: '109', salePrice: '39', onSale: true, saleEndsAt: '', period: 'month' };
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS  ' + m); };

// USD: 70 / 109 = 64.22% -> 64 (Math.round would also give 64; floor is the rule)
const usd = load('America/New_York');
ok(usd.planSaleInfo(PRO).active, 'USD sale active');
ok(usd.planSaleInfo(PRO).pct === 64, 'USD 39/109 -> 64% (got ' + usd.planSaleInfo(PRO).pct + ')');
ok(!/% OFF|pp-pct/.test(usd.planPriceHtml(PRO, 'lg')) && !/% OFF|pp-pct/.test(usd.planPriceHtml(PRO, 'sm')), 'price row has NO "% OFF" badge');
ok(typeof usd.planPctBadgeHtml === 'undefined', 'badge helper removed');
ok(/<s>\$109<\/s>/.test(usd.planPriceHtml(PRO, 'lg')) && /\$39/.test(usd.planPriceHtml(PRO, 'lg')), 'price row shows $39 and struck $109');
ok(!/Limited|left|ends/i.test(usd.planPriceHtml(PRO, 'lg')), 'no "limited" / countdown wording without saleEndsAt');
// Floor, not round: 10 -> 6.65 is 33.5% off; Math.round says 34, floor says 33.
ok(usd.planSaleInfo({ price: '10', salePrice: '6.65', onSale: true }).pct === 33, 'floor: 33.5% shows 33, never 34');
ok(usd.planSaleInfo({ price: '100', salePrice: '71', onSale: true }).pct === 29, 'exact 29% stays 29 (float noise guard)');
ok(!/<s>/.test(usd.planPriceHtml({ price: '109', salePrice: '39', onSale: false }, 'lg')), 'no struck price when the sale is off');

// INR at the live-style rate: Rs 3,772 / Rs 10,544 (whole rupees) -> 64.2% -> 64
const inr = load('Asia/Kolkata', 96.73);
const shown = inr.planMoneyDisplay(39) + ' / ' + inr.planMoneyDisplay(109);
ok(shown === '₹3,772 / ₹10,544', 'INR shows ₹3,772 / ₹10,544 (got ' + shown + ')');
ok(inr.planSaleInfo(PRO).pct === 64, 'INR 3,772/10,544 -> 64% (got ' + inr.planSaleInfo(PRO).pct + ')');

// Names: archived plan reads Pro for members
ok(usd.planDisplayName({ name: 'Elite', archived: true }) === 'Pro', 'archived Elite displays as Pro');
ok(usd.planDisplayName({ name: 'Starter', displayName: 'Free' }) === 'Free', 'Starter displays as Free');

console.log('\n' + n + ' passed, 0 failed');
