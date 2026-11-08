'use strict';

// Permanent unit coverage for free-coupon calendar access. No Firebase/network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../../functions-src/couponAccess');

const ms = (s) => Date.parse(s);
const iso = (n) => new Date(n).toISOString();
const planMonth = { period: 'month' };
const planYear = { period: 'year' };
const free = (accessMonths, extra) => Object.assign({
  type: 'free', active: true, appliesToPlan: 'pro', redemptionCount: 0, accessMonths
}, extra || {});
const grant = (months, now, extra) => A.computeCouponGrant(Object.assign({
  coupon: free(months), plan: planMonth, listPrice: 49,
  nowMillis: ms(now), currentPaidThroughMillis: 0
}, extra || {}));
const expectAccessError = (value) => assert.throws(
  () => A.validateAccessMonths(value),
  (e) => e instanceof A.CouponAccessError && e.code === 'invalid-access-months'
);

assert.strictEqual(iso(grant(1, '2027-01-15T12:30:00.000Z').paidThroughMillis), '2027-02-15T12:30:00.000Z');
assert.strictEqual(iso(grant(6, '2027-01-15T12:30:00.000Z').paidThroughMillis), '2027-07-15T12:30:00.000Z');
assert.strictEqual(iso(grant(12, '2027-01-15T12:30:00.000Z').paidThroughMillis), '2028-01-15T12:30:00.000Z');
assert.strictEqual(iso(grant(60, '2027-01-15T12:30:00.000Z').paidThroughMillis), '2032-01-15T12:30:00.000Z');

[0, -1, 1.5, 61, '6', NaN, Infinity].forEach(expectAccessError);
assert.strictEqual(A.validateAccessMonths(undefined), null);
assert.strictEqual(A.validateAccessMonths(null), null);
assert.strictEqual(A.validateAccessMonths(''), null);

assert.strictEqual(
  iso(A.computeCouponGrant({ coupon: free(undefined), plan: planMonth, listPrice: 49,
    nowMillis: ms('2027-03-10T00:00:00.000Z'), currentPaidThroughMillis: 0 }).paidThroughMillis),
  '2027-04-10T00:00:00.000Z'
);
assert.strictEqual(
  iso(A.computeCouponGrant({ coupon: free(undefined), plan: planYear, listPrice: 349,
    nowMillis: ms('2027-03-10T00:00:00.000Z'), currentPaidThroughMillis: 0 }).paidThroughMillis),
  '2028-03-10T00:00:00.000Z'
);

const founding = A.computeCouponGrant({ coupon: free(12, { marksFounding: true }), plan: planMonth,
  listPrice: 49, nowMillis: ms('2027-01-01T00:00:00Z'), currentPaidThroughMillis: 0 });
assert.strictEqual(founding.permanent, true);
assert.strictEqual(founding.paidThroughMillis, null);
assert.strictEqual(founding.accessMonths, 12);

const freePlan = A.computeCouponGrant({ coupon: free(6), plan: planMonth, listPrice: 0,
  nowMillis: ms('2027-01-01T00:00:00Z'), currentPaidThroughMillis: 0 });
assert.strictEqual(freePlan.paidThroughMillis, null);

const existing = ms('2027-08-20T00:00:00.000Z');
assert.strictEqual(
  iso(A.computeCouponGrant({ coupon: free(6), plan: planMonth, listPrice: 49,
    nowMillis: ms('2027-01-01T00:00:00.000Z'), currentPaidThroughMillis: existing }).paidThroughMillis),
  '2028-02-20T00:00:00.000Z'
);

assert.throws(() => A.validateCouponRedemption({
  coupon: free(6), redemptionExists: true, price: 49, planId: 'pro', nowMillis: ms('2027-01-01T00:00:00Z')
}), (e) => e.code === 'already-exists');
assert.throws(() => A.validateCouponRedemption({
  coupon: free(6), redemptionExists: false, price: 49, planId: 'pro-yearly', nowMillis: ms('2027-01-01T00:00:00Z')
}), (e) => e.code === 'plan-mismatch');

[
  [null, 'missing'],
  [free(6, { active: false }), 'inactive'],
  [free(6, { expiresAt: '2026-12-31' }), 'expired'],
  [free(6, { redemptionCount: 2, maxRedemptions: 2 }), 'exhausted'],
  [free(61), 'invalid-access-months']
].forEach(([coupon, code]) => {
  assert.throws(() => A.validateCouponRedemption({
    coupon, redemptionExists: false, price: 49, planId: 'pro', nowMillis: ms('2027-01-01T00:00:00Z')
  }), (e) => e instanceof A.CouponAccessError && e.code === code);
});
const todayCoupon = A.validateCouponRedemption({
  coupon: free(6, { expiresAt: '2027-01-01' }), redemptionExists: false,
  price: 49, planId: 'pro', nowMillis: ms('2027-01-01T23:59:59Z')
});
assert.strictEqual(todayCoupon.accessMonths, 6);

// A past paid-through value starts from now, while a future value is extended.
assert.strictEqual(
  iso(A.computeCouponGrant({ coupon: free(1), plan: planMonth, listPrice: 49,
    nowMillis: ms('2027-03-15T00:00:00.000Z'), currentPaidThroughMillis: ms('2027-02-01T00:00:00.000Z') }).paidThroughMillis),
  '2027-04-15T00:00:00.000Z'
);

// Deterministic month-end/leap behavior.
assert.strictEqual(iso(A.addCalendarMonths(ms('2027-01-31T09:45:00.000Z'), 1)), '2027-02-28T09:45:00.000Z');
assert.strictEqual(iso(A.addCalendarMonths(ms('2028-01-31T09:45:00.000Z'), 1)), '2028-02-29T09:45:00.000Z');
assert.strictEqual(iso(A.addCalendarMonths(ms('2028-02-29T09:45:00.000Z'), 12)), '2029-02-28T09:45:00.000Z');

// Regression guards: entitlement and audit data come from the transaction's
// server-read coupon snapshot, and the client sends identifiers only.
const server = fs.readFileSync(path.join(__dirname, '../../functions-src/freeCheckout.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../../assets/checkout.js'), 'utf8');
assert.match(server, /const c = cDoc\.exists \? cDoc\.data\(\) : null/);
assert.match(server, /accessMonths: currentGrant\.accessMonths/);
assert.match(server, /paidThroughMillis: currentGrant\.paidThroughMillis/);
assert.doesNotMatch(client, /httpsCallable\('redeemFreeCheckout'\)\(\{[\s\S]{0,250}accessMonths/);

console.log('PASS coupon duration: calendar grants, bounds, legacy, founding, extension, duplicate and plan mismatch');

// New-members-only coupons (Owner 2026-11-08): a member with Pro / a trial / founding access can't redeem.
{
  const now = ms('2026-11-08T12:00:00.000Z');
  const c = free(1, { newMembersOnly: true, appliesToPlan: 'all' });
  const ok = (student) => A.validateCouponRedemption({ coupon: c, student, price: 20, planId: 'pro', nowMillis: now });
  const blocked = (student) => assert.throws(() => ok(student), (e) => e instanceof A.CouponAccessError && e.code === 'has-paid-access');
  ok({});
  ok({ plan: 'Starter' });
  ok({ paidThroughMillis: now - 5 * 864e5 });                       // lapsed past the 3-day grace
  ok({ paidThroughMillis: now + 864e5, subscriptionStatus: 'expired' });
  blocked({ paidThroughMillis: now + 10 * 864e5, subscriptionStatus: 'active' });
  blocked({ paidThroughMillis: now + 3 * 864e5, subscriptionStatus: 'trialing' });
  blocked({ paidThroughMillis: now - 864e5, subscriptionStatus: 'grace' });   // inside grace
  blocked({ foundingMember: true });
  // old coupons (no flag) unchanged
  A.validateCouponRedemption({ coupon: free(1, { appliesToPlan: 'all' }), student: { foundingMember: true }, price: 20, planId: 'pro', nowMillis: now });
  console.log('new-members-only coupon checks passed');
}
