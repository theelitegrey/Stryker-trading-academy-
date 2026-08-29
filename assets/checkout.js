// Stryker Trading Academy — Checkout (checkout.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/commerce.js
//
// No payment gateway exists yet, so completing an order requires a valid
// coupon right now. The flow still writes a real order record and assigns
// the plan to the student's account, so when a real processor is added
// later, this same order/plan-assignment path keeps working — only the
// "how do we know they paid" step changes.

let CHECKOUT_UID = null;
let CHECKOUT_PLAN = null;
let APPLIED_COUPON = null;

function getPlanIdFromQuery(){
  return new URLSearchParams(window.location.search).get('plan');
}

function renderPlanSummary(plan){
  const wrap = document.getElementById('checkout-plan-summary');
  const featuresHtml = (plan.features || []).map(f =>
    '<li style="display:flex; gap:8px; align-items:flex-start; font-size:13.5px; color:var(--ink-1); margin-bottom:8px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px; color:var(--teal);"><path d="M20 6L9 17l-5-5"/></svg>' + f + '</li>'
  ).join('');
  wrap.innerHTML =
    '<h3 style="font-size:18px; color:var(--ink-0); margin-bottom:6px;">' + plan.name + '</h3>' +
    (typeof planPriceHtml === 'function'
      ? planPriceHtml(plan, 'sm')
      : '<div style="font-family:var(--font-mono); font-size:24px; color:var(--ink-0); margin-bottom:16px;">$' + plan.price + '<span style="font-size:13px; color:var(--ink-3);"> / ' + plan.period + '</span></div>') +
    '<ul style="margin:0; padding:0; list-style:none;">' + featuresHtml + '</ul>';
}

function updateOrderSummary(){
  // An active offer is applied before any coupon: the coupon then discounts
  // the offer price, not the list price.
  const sale = (typeof planSaleInfo === 'function') ? planSaleInfo(CHECKOUT_PLAN) : { active: false };
  const listPrice = parseFloat(CHECKOUT_PLAN.price) || 0;
  const price = sale.active ? sale.price : listPrice;
  document.getElementById('checkout-original-price').textContent = '$' + listPrice.toFixed(2);

  const offerRow = document.getElementById('checkout-offer-row');
  if (offerRow) {
    offerRow.style.display = sale.active ? '' : 'none';
    if (sale.active) {
      document.getElementById('checkout-offer-label').textContent = sale.label + ' (' + sale.pct + '% off)';
      document.getElementById('checkout-offer-amount').textContent = '-$' + sale.save.toFixed(2);
    }
  }

  const completeBtn = document.getElementById('checkout-complete-btn');

  if (price <= 0) {
    // Genuinely free plan — no coupon needed, nothing to discount.
    document.getElementById('checkout-discount').textContent = '$0.00';
    document.getElementById('checkout-total').textContent = '$0.00';
    completeBtn.disabled = false;
    completeBtn.textContent = 'Start for free';
    return;
  }

  if (!APPLIED_COUPON) {
    document.getElementById('checkout-discount').textContent = '—';
    document.getElementById('checkout-total').textContent = '$' + price.toFixed(2);
    completeBtn.disabled = true;
    completeBtn.textContent = 'Apply a coupon to continue';
    return;
  }

  const discount = computeDiscount(APPLIED_COUPON, price);
  const total = Math.max(price - discount, 0);
  document.getElementById('checkout-discount').textContent = '-$' + discount.toFixed(2);
  document.getElementById('checkout-total').textContent = '$' + total.toFixed(2);
  completeBtn.disabled = false;
  completeBtn.textContent = 'Complete order';
}

function showCouponStatus(message, isError){
  const el = document.getElementById('checkout-coupon-status');
  el.textContent = message;
  el.style.color = isError ? '#f08488' : 'var(--bull)';
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  const planId = getPlanIdFromQuery();
  if (!planId) {
    document.getElementById('checkout-error').textContent = 'No plan selected. Go back to the pricing page and choose a plan.';
    document.getElementById('checkout-error').style.display = 'block';
    return;
  }

  let handled = false;
  let sawNullOnce = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      if (!sawNullOnce) {
        sawNullOnce = true;
        setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      }
      return;
    }
    handled = true;
    CHECKOUT_UID = user.uid;

    db.collection('plans').doc(planId).get().then((doc) => {
      if (!doc.exists) {
        document.getElementById('checkout-plan-summary').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">That plan could not be found.</p>';
        return;
      }
      CHECKOUT_PLAN = Object.assign({ id: doc.id }, doc.data());
      renderPlanSummary(CHECKOUT_PLAN);
      updateOrderSummary();
    }).catch((err) => {
      document.getElementById('checkout-error').textContent = 'Could not load plan: ' + (err.message || err);
      document.getElementById('checkout-error').style.display = 'block';
    });
  });

  document.getElementById('checkout-apply-coupon-btn').addEventListener('click', () => {
    const code = normalizeCouponCode(document.getElementById('checkout-coupon-input').value);
    if (!code) { showCouponStatus('Enter a coupon code first.', true); return; }
    if (!CHECKOUT_PLAN) { showCouponStatus('Plan is still loading — try again in a moment.', true); return; }

    db.collection('coupons').doc(code).get().then((doc) => {
      if (!doc.exists) { showCouponStatus('That coupon code doesn\'t exist.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      const coupon = Object.assign({ code: doc.id }, doc.data());

      if (coupon.active === false) { showCouponStatus('That coupon is no longer active.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      if (isCouponExpired(coupon)) { showCouponStatus('That coupon has expired.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      if (isCouponExhausted(coupon)) { showCouponStatus('That coupon has reached its redemption limit.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      if (!couponAppliesToPlan(coupon, CHECKOUT_PLAN.id)) { showCouponStatus('That coupon doesn\'t apply to this plan.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }

      APPLIED_COUPON = coupon;
      showCouponStatus('Coupon applied: ' + coupon.code, false);
      updateOrderSummary();
    }).catch((err) => {
      showCouponStatus('Could not check that coupon: ' + (err.message || err), true);
    });
  });

  document.getElementById('checkout-complete-btn').addEventListener('click', () => {
    const errEl = document.getElementById('checkout-error');
    errEl.style.display = 'none';
    if (!CHECKOUT_UID || !CHECKOUT_PLAN) return;

    const price = (typeof planEffectivePrice === 'function')
      ? planEffectivePrice(CHECKOUT_PLAN)
      : (parseFloat(CHECKOUT_PLAN.price) || 0);
    if (price > 0 && !APPLIED_COUPON) return; // paid plan still needs a coupon right now

    const btn = document.getElementById('checkout-complete-btn');
    btn.disabled = true;
    btn.textContent = 'Processing…';

    const discount = APPLIED_COUPON ? computeDiscount(APPLIED_COUPON, price) : 0;
    const finalAmount = Math.max(price - discount, 0);

    const user = auth.currentUser;
    const order = {
      studentUid: CHECKOUT_UID,
      studentName: (user && user.displayName) || (user && user.email ? user.email.split('@')[0] : 'Trader'),
      studentEmail: user && user.email,
      planId: CHECKOUT_PLAN.id,
      planName: CHECKOUT_PLAN.name,
      listPrice: parseFloat(CHECKOUT_PLAN.price) || 0,
      offerApplied: (typeof planSaleInfo === 'function') && planSaleInfo(CHECKOUT_PLAN).active,
      originalPrice: price,
      couponCode: APPLIED_COUPON ? APPLIED_COUPON.code : null,
      discountApplied: discount,
      finalAmount: finalAmount,
      status: 'completed',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('orders').add(order)
      .then(() => {
        if (!APPLIED_COUPON) return null;
        return db.collection('coupons').doc(APPLIED_COUPON.code).update({
          redemptionCount: firebase.firestore.FieldValue.increment(1)
        });
      })
      .then(() => db.collection('students').doc(CHECKOUT_UID).set({
        plan: CHECKOUT_PLAN.name,
        planId: CHECKOUT_PLAN.id
      }, { merge: true }))
      .then(() => {
        if (typeof syncPublicProfile === 'function') syncPublicProfile(CHECKOUT_UID, { plan: CHECKOUT_PLAN.name });
      })
      .then(() => {
        // Two entries, not one: the money and the access change are separate
        // facts. An order can exist without a plan change (a failed grant) and
        // an admin can grant a plan with no order behind it, so collapsing
        // them into a single line would hide both cases.
        if (typeof logActivity === 'function') {
          logActivity('commerce.order_created',
            'Bought ' + CHECKOUT_PLAN.name + ' for $' + finalAmount +
            (APPLIED_COUPON ? ' with coupon ' + APPLIED_COUPON.code : ''),
            { detail: 'plan ' + CHECKOUT_PLAN.id });
          logActivity('student.plan_changed',
            'Upgraded their own plan to ' + CHECKOUT_PLAN.name,
            { targetUid: CHECKOUT_UID, detail: 'via checkout' });
        }
        // AWAITED, unlike before. Each of these makes roughly seven sequential
        // Firestore round trips — read the student, resolve the code, check for
        // an existing row, load config, write the row, credit two point
        // documents, then notify. On mobile that comfortably exceeds the 1.8s
        // redirect below, so firing and forgetting meant the writes died with
        // the page: the referrer got no points and no notification, silently.
        //
        // Capped so a slow network can't strand someone on the checkout page
        // after their order has already gone through.
        const manualRefInput = document.getElementById('checkout-referral-input');
        const manualRefCode = manualRefInput ? manualRefInput.value.trim() : '';

        const referralWork = [];
        if (typeof processReferralConversion === 'function') {
          referralWork.push(processReferralConversion(CHECKOUT_UID, CHECKOUT_PLAN.name));
        }
        if (manualRefCode && typeof applyReferralCodeAtCheckout === 'function') {
          // Runs AFTER the conversion rather than alongside it. Both read and
          // then write the same student document, so in parallel they race:
          // each could read "not yet paid" before the other writes, and pay
          // the referrer twice for one upgrade.
          referralWork.push(
            Promise.all(referralWork.slice())
              .then(() => applyReferralCodeAtCheckout(CHECKOUT_UID, manualRefCode))
          );
        }

        if (!referralWork.length) return null;
        return Promise.race([
          Promise.all(referralWork).catch(() => null),
          new Promise((resolve) => setTimeout(resolve, 6000))
        ]);
      })
      .then(() => {
        // Was an inline strip pushed into the page, which shifted the layout
        // and read as content rather than a confirmation.
        showToast('success', 'Order complete — you now have ' + CHECKOUT_PLAN.name + '.', {
          title: 'Payment confirmed',
          duration: 2600
        });
        // The referral work above is already settled by this point, so this
        // delay only needs to let the confirmation be read — unlike the login
        // path, where the redirect
        // fires at 400ms and killed the write.
        setTimeout(() => { window.location.href = 'dashboard-user.html'; }, 1800);
      })
      .catch((err) => {
        errEl.textContent = 'Could not complete order: ' + (err.message || err);
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Complete order';
      });
  });
});
