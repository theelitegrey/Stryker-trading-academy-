'use strict';

// Pure entitlement rules for redeemFreeCheckout. Keeping calendar arithmetic and
// coupon validation free of Firebase makes the security-critical behavior easy
// to exercise without touching production data.

const MAX_ACCESS_MONTHS = 60;

class CouponAccessError extends Error {
  constructor(code, message){
    super(message);
    this.name = 'CouponAccessError';
    this.code = code;
  }
}

function validateAccessMonths(value){
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_ACCESS_MONTHS) {
    throw new CouponAccessError('invalid-access-months',
      'This coupon has an invalid access duration. Ask support to update it.');
  }
  return value;
}

// Add whole UTC calendar months and clamp to the target month's final day.
// Examples: Jan 31 + 1 month => Feb 28 (or Feb 29 in a leap year), and
// Feb 29 + 12 months => Feb 28. The time of day is preserved.
function addCalendarMonths(fromMillis, months){
  if (!Number.isFinite(fromMillis)) throw new TypeError('fromMillis must be finite');
  if (!Number.isInteger(months) || months < 1) throw new TypeError('months must be a positive integer');
  const d = new Date(fromMillis);
  const originalDay = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(originalDay, finalDay));
  return d.getTime();
}

function periodKind(period){
  const p = String(period || '').toLowerCase();
  if (/month/.test(p)) return 'month';
  if (/year|annual/.test(p)) return 'year';
  return 'none';
}

function legacyPeriodEnd(fromMillis, period){
  const kind = periodKind(period);
  if (kind === 'month') return addCalendarMonths(fromMillis, 1);
  if (kind === 'year') return addCalendarMonths(fromMillis, 12);
  return null;
}

function todayUtc(nowMillis){
  return new Date(nowMillis).toISOString().slice(0, 10);
}

// Validate only server-read coupon data. The caller supplies whether the
// server-side redemption document exists; no request field participates.
function validateCouponRedemption(options){
  const o = options || {};
  const coupon = o.coupon;
  if (o.redemptionExists) {
    throw new CouponAccessError('already-exists', 'You\'ve already used this coupon on this account.');
  }
  if (!coupon) throw new CouponAccessError('missing', 'That coupon code doesn\'t exist.');
  if (coupon.active === false) throw new CouponAccessError('inactive', 'That coupon is no longer active.');
  if (coupon.expiresAt && coupon.expiresAt < todayUtc(o.nowMillis)) {
    throw new CouponAccessError('expired', 'That coupon has expired.');
  }
  const used = Number(coupon.redemptionCount) || 0;
  if (coupon.maxRedemptions && used >= coupon.maxRedemptions) {
    throw new CouponAccessError('exhausted', 'That coupon has reached its redemption limit.');
  }
  if (coupon.appliesToPlan !== 'all' && coupon.appliesToPlan !== o.planId) {
    throw new CouponAccessError('plan-mismatch', 'That coupon doesn\'t apply to this plan.');
  }

  let discount = 0;
  if (coupon.type === 'free') discount = o.price;
  else if (coupon.type === 'percent') discount = Math.min(o.price, o.price * (parseFloat(coupon.value) || 0) / 100);
  else if (coupon.type === 'fixed') discount = Math.min(o.price, parseFloat(coupon.value) || 0);

  const accessMonths = coupon.type === 'free' ? validateAccessMonths(coupon.accessMonths) : null;
  return { discount, accessMonths, used };
}

function computeCouponGrant(options){
  const o = options || {};
  const coupon = o.coupon || null;
  const plan = o.plan || {};
  const nowMillis = o.nowMillis;
  const accessMonths = coupon && coupon.type === 'free'
    ? validateAccessMonths(coupon.accessMonths)
    : null;

  if (coupon && coupon.marksFounding) {
    return { permanent: true, accessMonths, paidThroughMillis: null };
  }
  if (!(o.listPrice > 0) || periodKind(plan.period) === 'none') {
    return { permanent: false, accessMonths, paidThroughMillis: null };
  }

  const existing = Number(o.currentPaidThroughMillis) || 0;
  const fromMillis = Math.max(nowMillis, existing);
  const paidThroughMillis = accessMonths
    ? addCalendarMonths(fromMillis, accessMonths)
    : legacyPeriodEnd(fromMillis, plan.period);
  return { permanent: false, accessMonths, paidThroughMillis };
}

module.exports = {
  MAX_ACCESS_MONTHS,
  CouponAccessError,
  validateAccessMonths,
  addCalendarMonths,
  periodKind,
  legacyPeriodEnd,
  validateCouponRedemption,
  computeCouponGrant
};
