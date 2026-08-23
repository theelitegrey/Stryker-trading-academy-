// Stryker Trading Academy — shared commerce helpers
// Depends on: assets/progress.js (`db`)
//
// Data model:
//   plans/{planId}: (already exists from Billing & Plans) name, price, period,
//     chapterAccess, features, featured
//   coupons/{code}: code is the Firestore doc ID itself (uppercased), so a
//     checkout can look one up directly by ID instead of running a query.
//     { type: 'free'|'percent'|'fixed', value, appliesToPlan: planId|'all',
//       maxRedemptions: number|null, redemptionCount, expiresAt: 'YYYY-MM-DD'|null,
//       active, createdAt }
//   orders/{orderId}: { studentUid, studentName, studentEmail, planId,
//     planName, originalPrice, couponCode, discountApplied, finalAmount,
//     status: 'completed', createdAt }
//
// No payment gateway exists yet, so every order today comes from a coupon
// redemption — finalAmount is always 0 right now. The schema is written so a
// real processor can slot in later without changing how orders are read.

function normalizeCouponCode(code){
  return (code || '').trim().toUpperCase();
}

function isCouponExpired(coupon){
  if (!coupon.expiresAt) return false;
  const today = new Date().toISOString().slice(0, 10);
  return coupon.expiresAt < today;
}

function isCouponExhausted(coupon){
  if (!coupon.maxRedemptions) return false;
  return (coupon.redemptionCount || 0) >= coupon.maxRedemptions;
}

function couponAppliesToPlan(coupon, planId){
  return coupon.appliesToPlan === 'all' || coupon.appliesToPlan === planId;
}

function computeDiscount(coupon, originalPrice){
  const price = parseFloat(originalPrice) || 0;
  if (coupon.type === 'free') return price;
  if (coupon.type === 'percent') return Math.min(price, price * (parseFloat(coupon.value) || 0) / 100);
  if (coupon.type === 'fixed') return Math.min(price, parseFloat(coupon.value) || 0);
  return 0;
}
