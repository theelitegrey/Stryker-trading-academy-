// Unit test: the "% OFF" badge (assets/plan-price.js planSaleInfo().pct) and
// the yearly-as-monthly line. Percents are taken from the prices the visitor
// actually sees and rounded DOWN, so nothing overstates (Owner, 2026-10-12).
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
ok(/>64% OFF</.test(usd.planPriceHtml(PRO, 'lg')) && />64% OFF</.test(usd.planPriceHtml(PRO, 'md')) && />64% OFF</.test(usd.planPriceHtml(PRO, 'sm')), 'price row carries "64% OFF" (lg, md, sm)');
ok(/<s>\$109<\/s>/.test(usd.planPriceHtml(PRO, 'lg')) && /\$39/.test(usd.planPriceHtml(PRO, 'lg')), 'price row shows $39 and struck $109');
ok(!/Limited|left|ends/i.test(usd.planPriceHtml(PRO, 'lg')), 'no "limited" / countdown wording without saleEndsAt');
// Floor, not round: 10 -> 6.65 is 33.5% off; Math.round says 34, floor says 33.
ok(usd.planSaleInfo({ price: '10', salePrice: '6.65', onSale: true }).pct === 33, 'floor: 33.5% shows 33, never 34');
ok(usd.planSaleInfo({ price: '100', salePrice: '71', onSale: true }).pct === 29, 'exact 29% stays 29 (float noise guard)');
ok(!/<s>/.test(usd.planPriceHtml({ price: '109', salePrice: '39', onSale: false }, 'lg')), 'no struck price when the sale is off');
ok(usd.planPctBadgeHtml({ price: '109', salePrice: '39', onSale: false }) === '' && !/% OFF/.test(usd.planPriceHtml({ price: '109', salePrice: '39', onSale: false }, 'lg')), 'no badge when not on sale');
ok(usd.planPctBadgeHtml({ price: '109', salePrice: '39', onSale: true, saleEndsAt: '2020-01-01' }) === '', 'no badge once the sale has ended');

// INR at the live-style rate: Rs 3,772 / Rs 10,544 (whole rupees) -> 64.2% -> 64
const inr = load('Asia/Kolkata', 96.73);
const shown = inr.planMoneyDisplay(39) + ' / ' + inr.planMoneyDisplay(109);
ok(shown === '₹3,772 / ₹10,544', 'INR shows ₹3,772 / ₹10,544 (got ' + shown + ')');
ok(inr.planSaleInfo(PRO).pct === 64, 'INR 3,772/10,544 -> 64% (got ' + inr.planSaleInfo(PRO).pct + ')');
ok(/>64% OFF</.test(inr.planPriceHtml(PRO, 'lg')), 'INR price row carries "64% OFF"');

// Names: archived plan reads Pro for members
ok(usd.planDisplayName({ name: 'Elite', archived: true }) === 'Pro', 'archived Elite displays as Pro');
ok(usd.planDisplayName({ name: 'Starter', displayName: 'Free' }) === 'Free', 'Starter displays as Free');

// Yearly as a monthly price (2026-10-12): floor(yearly/12), % floored, visitor's currency
const YR = { id: 'proYearly', price: '349', period: 'year' };
const dU = usd.planYearlyDeal(PRO, YR);
ok(dU.text === 'or $29/mo billed yearly ($349) · save 25%', 'USD yearly line (got ' + dU.text + ')');
// 12 x 39 = 468; (468 - 349) / 468 = 25.43% -> 25
ok(dU.pct === 25, 'USD save 25% (floor of 25.43)');
const dI = inr.planYearlyDeal(PRO, YR);
// Rs 33,759 / 12 = 2,813.25 -> 2,813; (12 x 3,772 - 33,759) / 45,264 = 25.42% -> 25
ok(dI.text === 'or ₹2,813/mo billed yearly (₹33,759) · save 25%', 'INR yearly line (got ' + dI.text + ')');
ok(usd.planYearlyDeal({ price: '30', period: 'month' }, { price: '359.99', period: 'year' }).pct === 0, 'yearly >= 12 x monthly: no "save" claim');
ok(!/save/.test(usd.planYearlyDeal({ price: '30', period: 'month' }, { price: '359.99', period: 'year' }).text), 'no "save" text when nothing is saved');
ok(usd.planYearlyDeal({ price: '10', period: 'month' }, { price: '100', period: 'year' }).pct === 16, 'floor: 16.67% shows 16, never 17');
ok(usd.planYearlyDeal(PRO, null) === null && usd.planYearlyDealHtml(PRO, null) === '', 'no yearly twin: no line');

console.log('\n' + n + ' passed, 0 failed');
