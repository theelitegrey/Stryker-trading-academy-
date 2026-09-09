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

// ---- billing details --------------------------------------------------------
// Saved on students/{uid}.billing the first time someone buys, then reused:
// returning buyers see a compact summary with an Edit button instead of the
// form. Nothing — a card payment or a free coupon seat — completes until the
// required fields are in.
let CHECKOUT_BILLING = null;

const BILLING_FIELDS = [
  ['fullName', 'bill-name'], ['phone', 'bill-phone'], ['address', 'bill-address'],
  ['city', 'bill-city'], ['state', 'bill-state'], ['postal', 'bill-postal'],
  ['country', 'bill-country']
];
const BILLING_REQUIRED = ['fullName', 'address', 'city', 'postal', 'country'];

function billingComplete(b){
  return !!b && BILLING_REQUIRED.every((k) => String(b[k] || '').trim());
}

function billingEsc(s){
  return (typeof planEscape === 'function') ? planEscape(s)
    : String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showBillingForm(){
  document.getElementById('checkout-billing-loading').style.display = 'none';
  document.getElementById('checkout-billing-summary').style.display = 'none';
  document.getElementById('checkout-billing-form').style.display = '';
  const b = CHECKOUT_BILLING || {};
  BILLING_FIELDS.forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = b[key] || '';
  });
  const user = (typeof auth !== 'undefined' && auth) ? auth.currentUser : null;
  const nameEl = document.getElementById('bill-name');
  if (nameEl && !nameEl.value && user && user.displayName) nameEl.value = user.displayName;
  // The country field almost always matches the currency the page detected —
  // prefill it, leave it editable.
  const countryEl = document.getElementById('bill-country');
  if (countryEl && !countryEl.value && typeof strykerCurrency === 'function' && strykerCurrency() === 'INR') {
    countryEl.value = 'India';
  }
}

function showBillingSummary(){
  const b = CHECKOUT_BILLING;
  document.getElementById('checkout-billing-loading').style.display = 'none';
  document.getElementById('checkout-billing-form').style.display = 'none';
  document.getElementById('checkout-billing-summary-text').innerHTML =
    '<b style="color:var(--ink-0);">' + billingEsc(b.fullName) + '</b><br>' +
    billingEsc(b.address) + '<br>' +
    billingEsc(b.city) + (b.state ? ', ' + billingEsc(b.state) : '') + ' ' + billingEsc(b.postal) + '<br>' +
    billingEsc(b.country) + (b.phone ? ' · ' + billingEsc(b.phone) : '');
  document.getElementById('checkout-billing-summary').style.display = '';
}

function initBillingSection(studentDoc){
  CHECKOUT_BILLING = (studentDoc && studentDoc.exists && studentDoc.data().billing) || null;
  if (billingComplete(CHECKOUT_BILLING)) showBillingSummary();
  else showBillingForm();
}

// Resolves with the saved billing details, or rejects with the sentinel
// 'billing-incomplete' (the error is already shown at the form) when the
// required fields are missing.
function ensureBillingSaved(){
  const formVisible = document.getElementById('checkout-billing-form').style.display !== 'none';
  if (!formVisible && billingComplete(CHECKOUT_BILLING)) return Promise.resolve(CHECKOUT_BILLING);

  const b = {};
  BILLING_FIELDS.forEach(([key, id]) => {
    const el = document.getElementById(id);
    b[key] = el ? el.value.trim() : '';
  });
  const errEl = document.getElementById('checkout-billing-error');
  if (!billingComplete(b)) {
    errEl.textContent = 'Fill in your name, address, city, postal code and country to continue.';
    errEl.style.display = 'block';
    document.getElementById('checkout-billing-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return Promise.reject(new Error('billing-incomplete'));
  }
  errEl.style.display = 'none';
  b.updatedAtMillis = Date.now();
  return db.collection('students').doc(CHECKOUT_UID).set({ billing: b }, { merge: true })
    .then(() => { CHECKOUT_BILLING = b; showBillingSummary(); return b; });
}

function getPlanIdFromQuery(){
  return new URLSearchParams(window.location.search).get('plan');
}

function getCouponFromQuery(){
  return normalizeCouponCode(new URLSearchParams(window.location.search).get('coupon'));
}

// Marketing links say `?plan=elite`, not `?plan=x7Kq2...` — so when the query
// value isn't a document id, fall back to matching it against plan NAMES.
function loadCheckoutPlan(planId){
  return db.collection('plans').doc(planId).get().then((doc) => {
    if (doc.exists) return Object.assign({ id: doc.id }, doc.data());
    return db.collection('plans').get().then((snap) => {
      let found = null;
      snap.forEach((d) => {
        const p = Object.assign({ id: d.id }, d.data());
        if (!found && (p.name || '').toLowerCase() === String(planId).toLowerCase()) found = p;
      });
      return found;
    });
  });
}

// One seat per account: a capped coupon (e.g. WELCOME's 50 founding seats)
// shouldn't be consumable twice by the same student. Fails open if this
// account's orders can't be read, so it never blocks a legitimate first use.
function hasAlreadyRedeemed(code){
  return db.collection('orders')
    .where('studentUid', '==', CHECKOUT_UID)
    .where('couponCode', '==', code)
    .limit(1).get()
    .then((snap) => !snap.empty)
    .catch(() => false);
}

// The coupon seat is claimed server-side now, inside redeemFreeCheckout,
// together with the per-account redemption record — see functions-src/
// freeCheckout.js. hasAlreadyRedeemed above stays as a courtesy check that
// tells someone before they press the button; it is not what enforces the
// limit, and it does not need to be.

function renderPlanSummary(plan){
  const wrap = document.getElementById('checkout-plan-summary');
  const featuresHtml = (plan.features || []).map(f =>
    '<li style="display:flex; gap:8px; align-items:flex-start; font-size:13.5px; color:var(--ink-1); margin-bottom:8px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px; color:var(--teal);"><path d="M20 6L9 17l-5-5"/></svg>' + f + '</li>'
  ).join('');
  wrap.innerHTML =
    '<h3 style="font-size:18px; color:var(--ink-0); margin-bottom:6px;">' + stkEsc(plan.name) + '</h3>' +
    (typeof planPriceHtml === 'function'
      ? planPriceHtml(plan, 'sm')
      : '<div style="font-family:var(--font-mono); font-size:24px; color:var(--ink-0); margin-bottom:16px;">$' + plan.price + '<span style="font-size:13px; color:var(--ink-3);"> / ' + plan.period + '</span></div>') +
    '<ul style="margin:0; padding:0; list-style:none;">' + featuresHtml + '</ul>';
}

// All plan math stays in USD (the stored base); only the final display step
// converts — planMoneyDisplay shows ₹ for Indian visitors, $ for everyone
// else, and the server charges from the same rate + rounding.
function checkoutFmt(usd){
  return (typeof planMoneyDisplay === 'function') ? planMoneyDisplay(usd) : ('$' + usd.toFixed(2));
}

function updateOrderSummary(){
  // An active offer is applied before any coupon: the coupon then discounts
  // the offer price, not the list price.
  const sale = (typeof planSaleInfo === 'function') ? planSaleInfo(CHECKOUT_PLAN) : { active: false };
  const listPrice = parseFloat(CHECKOUT_PLAN.price) || 0;
  const price = sale.active ? sale.price : listPrice;
  document.getElementById('checkout-original-price').textContent = checkoutFmt(listPrice);

  const noteEl = document.getElementById('checkout-currency-note');
  if (noteEl && typeof strykerCurrencyNoteHtml === 'function') noteEl.innerHTML = strykerCurrencyNoteHtml();

  const offerRow = document.getElementById('checkout-offer-row');
  if (offerRow) {
    offerRow.style.display = sale.active ? '' : 'none';
    if (sale.active) {
      document.getElementById('checkout-offer-label').textContent = sale.label + ' (' + sale.pct + '% off)';
      document.getElementById('checkout-offer-amount').textContent = '-' + checkoutFmt(sale.save);
    }
  }

  const completeBtn = document.getElementById('checkout-complete-btn');

  if (price <= 0) {
    // Genuinely free plan — no coupon needed, nothing to discount.
    document.getElementById('checkout-discount').textContent = checkoutFmt(0);
    document.getElementById('checkout-total').textContent = checkoutFmt(0);
    completeBtn.disabled = false;
    completeBtn.textContent = 'Start for free';
    return;
  }

  // Auto-debit is offered when it can actually be set up: an INR viewer
  // (mandates need Indian rails), a renewing plan, no coupon riding along
  // (mandates debit a fixed amount), and money actually owed.
  const autopayRow = document.getElementById('checkout-autopay-row');
  const autopayBox = document.getElementById('checkout-autopay');
  const autopayOk = !!autopayRow && typeof strykerCurrency === 'function' && strykerCurrency() === 'INR' &&
    typeof stkPeriodKind === 'function' && stkPeriodKind(CHECKOUT_PLAN.period) !== 'none' &&
    !APPLIED_COUPON && price > 0;
  if (autopayRow) autopayRow.style.display = autopayOk ? 'flex' : 'none';
  const autopayOn = autopayOk && autopayBox && autopayBox.checked;
  const cycle = (typeof stkPeriodKind === 'function' && stkPeriodKind(CHECKOUT_PLAN.period) === 'year') ? 'year' : 'month';

  if (!APPLIED_COUPON) {
    document.getElementById('checkout-discount').textContent = '—';
    document.getElementById('checkout-total').textContent = checkoutFmt(price);
    completeBtn.disabled = false;
    completeBtn.textContent = autopayOn
      ? 'Subscribe — ' + checkoutFmt(price) + ' / ' + cycle
      : 'Pay ' + checkoutFmt(price) + ' securely';
    return;
  }

  const discount = computeDiscount(APPLIED_COUPON, price);
  const total = Math.max(price - discount, 0);
  document.getElementById('checkout-discount').textContent = '-' + checkoutFmt(discount);
  document.getElementById('checkout-total').textContent = checkoutFmt(total);
  completeBtn.disabled = false;
  completeBtn.textContent = total > 0 ? 'Pay ' + checkoutFmt(total) + ' securely' : 'Complete order';
}

// ---- Razorpay Standard Checkout ---------------------------------------------
// Anything with money still owed goes through Razorpay. The amount is
// computed and charged SERVER-SIDE (functions-src/razorpay.js) from the plan
// doc + live sale + coupon — the client only opens the modal and relays the
// signed result back for verification. The plan grant happens on the server
// after the signature checks out, so nothing here writes orders/students.
function checkoutTotalDue(){
  const sale = (typeof planSaleInfo === 'function') ? planSaleInfo(CHECKOUT_PLAN) : { active: false };
  const price = sale.active ? sale.price : (parseFloat(CHECKOUT_PLAN.price) || 0);
  const discount = APPLIED_COUPON ? computeDiscount(APPLIED_COUPON, price) : 0;
  return Math.max(price - discount, 0);
}

function launchRazorpay(btn, errEl){
  if (typeof Razorpay === 'undefined') {
    errEl.textContent = 'The payment window could not load — check your connection and refresh.';
    errEl.style.display = 'block';
    return;
  }
  let fns = null;
  try { fns = firebase.app().functions(); } catch (e) {}
  if (!fns) {
    errEl.textContent = 'Payments are not available right now.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Preparing secure payment…';
  const reset = () => { btn.disabled = false; updateOrderSummary(); };

  fns.httpsCallable('razorpayCreateOrder')({
    planId: CHECKOUT_PLAN.id,
    couponCode: APPLIED_COUPON ? APPLIED_COUPON.code : null,
    // The currency this page has been showing — the server recomputes the
    // amount in it from the same rate doc, so what's displayed is charged.
    currency: (typeof strykerCurrency === 'function') ? strykerCurrency() : 'USD'
  }).then((res) => {
    const o = res.data;
    const user = auth.currentUser;
    const rzp = new Razorpay({
      key: o.keyId,
      order_id: o.orderId,
      amount: o.amount,
      currency: o.currency,
      name: 'Stryker Trading Academy',
      description: o.planName,
      image: 'https://strykertrading.com/assets/images/icon-192.png',
      prefill: {
        email: (user && user.email) || '',
        name: (CHECKOUT_BILLING && CHECKOUT_BILLING.fullName) || (user && user.displayName) || '',
        contact: (CHECKOUT_BILLING && CHECKOUT_BILLING.phone) || ''
      },
      theme: { color: '#03c988' },
      modal: { ondismiss: reset },
      handler: (resp) => {
        btn.textContent = 'Confirming payment…';
        fns.httpsCallable('razorpayVerifyPayment')({
          orderId: resp.razorpay_order_id,
          paymentId: resp.razorpay_payment_id,
          signature: resp.razorpay_signature
        }).then(() => {
          finishPaidCheckout();
        }).catch((err) => {
          errEl.textContent = 'Payment received but verification failed — contact support@strykertrading.com with payment id ' +
            resp.razorpay_payment_id + '. (' + (err.message || err) + ')';
          errEl.style.display = 'block';
          reset();
        });
      }
    });
    rzp.on('payment.failed', (resp) => {
      errEl.textContent = 'Payment failed: ' + ((resp.error && resp.error.description) || 'the payment was declined.');
      errEl.style.display = 'block';
      reset();
    });
    rzp.open();
  }).catch((err) => {
    errEl.textContent = err.message || 'Could not start the payment.';
    errEl.style.display = 'block';
    reset();
  });
}

// Auto-debit: the server creates the Razorpay subscription (mandate), the
// modal authorizes it (UPI AutoPay / card e-mandate), and verification
// activates it and grants the first period. From then on Razorpay charges
// each cycle on its own and the webhook keeps access current.
function launchRazorpaySubscription(btn, errEl){
  if (typeof Razorpay === 'undefined') {
    errEl.textContent = 'The payment window could not load — check your connection and refresh.';
    errEl.style.display = 'block';
    return;
  }
  let fns = null;
  try { fns = firebase.app().functions(); } catch (e) {}
  if (!fns) {
    errEl.textContent = 'Payments are not available right now.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Setting up auto-renewal…';
  const reset = () => { btn.disabled = false; updateOrderSummary(); };

  fns.httpsCallable('razorpaySubscribe')({
    planId: CHECKOUT_PLAN.id,
    currency: (typeof strykerCurrency === 'function') ? strykerCurrency() : 'INR'
  }).then((res) => {
    const o = res.data;
    const user = auth.currentUser;
    const rzp = new Razorpay({
      key: o.keyId,
      subscription_id: o.subscriptionId,
      name: 'Stryker Trading Academy',
      description: o.planName + ' · auto-renews',
      image: 'https://strykertrading.com/assets/images/icon-192.png',
      prefill: {
        email: (user && user.email) || '',
        name: (CHECKOUT_BILLING && CHECKOUT_BILLING.fullName) || (user && user.displayName) || '',
        contact: (CHECKOUT_BILLING && CHECKOUT_BILLING.phone) || ''
      },
      theme: { color: '#03c988' },
      modal: { ondismiss: reset },
      handler: (resp) => {
        btn.textContent = 'Confirming subscription…';
        fns.httpsCallable('razorpaySubsVerify')({
          subscriptionId: resp.razorpay_subscription_id,
          paymentId: resp.razorpay_payment_id,
          signature: resp.razorpay_signature
        }).then(() => {
          finishPaidCheckout();
        }).catch((err) => {
          errEl.textContent = 'Payment received but verification failed — contact support@strykertrading.com with payment id ' +
            resp.razorpay_payment_id + '. (' + (err.message || err) + ')';
          errEl.style.display = 'block';
          reset();
        });
      }
    });
    rzp.on('payment.failed', (resp) => {
      errEl.textContent = 'Payment failed: ' + ((resp.error && resp.error.description) || 'the payment was declined.');
      errEl.style.display = 'block';
      reset();
    });
    rzp.open();
  }).catch((err) => {
    errEl.textContent = err.message || 'Could not set up the subscription.';
    errEl.style.display = 'block';
    reset();
  });
}

// The server has already written the order, claimed the coupon seat, and
// granted the plan — this is the client-side tail the free path also runs:
// activity log, referral credit, confirmation, redirect.
function finishPaidCheckout(){
  if (typeof logActivity === 'function') {
    logActivity('commerce.order_created',
      'Bought ' + CHECKOUT_PLAN.name + ' via Razorpay' +
      (APPLIED_COUPON ? ' with coupon ' + APPLIED_COUPON.code : ''),
      { detail: 'plan ' + CHECKOUT_PLAN.id });
    logActivity('student.plan_changed',
      'Upgraded their own plan to ' + CHECKOUT_PLAN.name,
      { targetUid: CHECKOUT_UID, detail: 'via razorpay checkout' });
  }
  const work = [];
  if (typeof processReferralConversion === 'function') {
    work.push(processReferralConversion(CHECKOUT_UID, CHECKOUT_PLAN.name).catch(() => null));
  }
  Promise.race([Promise.all(work), new Promise((r) => setTimeout(r, 6000))]).then(() => {
    showToast('success', 'Order complete — you now have ' + CHECKOUT_PLAN.name + '.', {
      title: 'Payment confirmed',
      duration: 2600
    });
    setTimeout(() => { window.location.href = 'dashboard-user.html'; }, 1800);
  });
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

    const fxReady = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
    const studentReady = db.collection('students').doc(CHECKOUT_UID).get().catch(() => null);
    Promise.all([loadCheckoutPlan(planId), fxReady, studentReady]).then(([plan, , studentDoc]) => {
      // Billing resolves regardless of the plan lookup, so the panel never
      // sticks on "Checking your saved details…".
      initBillingSection(studentDoc);
      if (!plan) {
        document.getElementById('checkout-plan-summary').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">That plan could not be found — <a href="index.html#pricing" style="color:var(--teal);">choose a plan</a> and try again.</p>';
        return;
      }
      CHECKOUT_PLAN = plan;
      renderPlanSummary(CHECKOUT_PLAN);
      updateOrderSummary();

      // Campaign links (`?coupon=WELCOME`) pre-fill and apply the code so the
      // student lands on a ready-to-complete order instead of an empty field.
      const queryCoupon = getCouponFromQuery();
      if (queryCoupon) {
        document.getElementById('checkout-coupon-input').value = queryCoupon;
        applyCouponCode(queryCoupon);
      }
    }).catch((err) => {
      document.getElementById('checkout-error').textContent = 'Could not load plan: ' + (err.message || err);
      document.getElementById('checkout-error').style.display = 'block';
    });
  });

  function applyCouponCode(code){
    if (!code) { showCouponStatus('Enter a coupon code first.', true); return; }
    if (!CHECKOUT_PLAN) { showCouponStatus('Plan is still loading — try again in a moment.', true); return; }

    db.collection('coupons').doc(code).get().then((doc) => {
      if (!doc.exists) { showCouponStatus('That coupon code doesn\'t exist.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      const coupon = Object.assign({ code: doc.id }, doc.data());

      if (coupon.active === false) { showCouponStatus('That coupon is no longer active.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      if (isCouponExpired(coupon)) { showCouponStatus('That coupon has expired.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      if (isCouponExhausted(coupon)) { showCouponStatus('That coupon has reached its redemption limit.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
      if (!couponAppliesToPlan(coupon, CHECKOUT_PLAN.id)) { showCouponStatus('That coupon doesn\'t apply to this plan.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }

      return hasAlreadyRedeemed(code).then((used) => {
        if (used) { showCouponStatus('You\'ve already used this coupon on this account.', true); APPLIED_COUPON = null; updateOrderSummary(); return; }
        APPLIED_COUPON = coupon;
        showCouponStatus('Coupon applied: ' + coupon.code + (coupon.maxRedemptions ? ' — limited founding seats' : ''), false);
        updateOrderSummary();
      });
    }).catch((err) => {
      showCouponStatus('Could not check that coupon: ' + (err.message || err), true);
    });
  }

  document.getElementById('checkout-apply-coupon-btn').addEventListener('click', () => {
    applyCouponCode(normalizeCouponCode(document.getElementById('checkout-coupon-input').value));
  });

  document.getElementById('checkout-complete-btn').addEventListener('click', () => {
    const errEl = document.getElementById('checkout-error');
    errEl.style.display = 'none';
    if (!CHECKOUT_UID || !CHECKOUT_PLAN) return;

    // Billing details validate and save BEFORE any money — or a free coupon
    // seat — changes hands, so every order has a name and address behind it.
    ensureBillingSaved().then(() => {
      // Money still owed (list price minus sale minus coupon) → Razorpay:
      // the auto-renewing mandate when the toggle is on, a one-time charge
      // otherwise. Only a genuinely free order takes the coupon path below.
      if (checkoutTotalDue() > 0) {
        const autopayRow = document.getElementById('checkout-autopay-row');
        const autopayBox = document.getElementById('checkout-autopay');
        const wantAutopay = autopayRow && autopayRow.style.display !== 'none' &&
                            autopayBox && autopayBox.checked;
        if (wantAutopay) launchRazorpaySubscription(document.getElementById('checkout-complete-btn'), errEl);
        else launchRazorpay(document.getElementById('checkout-complete-btn'), errEl);
        return;
      }
      completeFreeOrder(errEl);
    }).catch((err) => {
      if (err && err.message === 'billing-incomplete') return; // shown at the form
      errEl.textContent = 'Could not save billing details: ' + (err.message || err);
      errEl.style.display = 'block';
    });
  });

  document.getElementById('checkout-billing-edit-btn').addEventListener('click', showBillingForm);

  const autopayBox = document.getElementById('checkout-autopay');
  if (autopayBox) autopayBox.addEventListener('change', () => { if (CHECKOUT_PLAN) updateOrderSummary(); });

  function completeFreeOrder(errEl){
    const price = (typeof planEffectivePrice === 'function')
      ? planEffectivePrice(CHECKOUT_PLAN)
      : (parseFloat(CHECKOUT_PLAN.price) || 0);

    const btn = document.getElementById('checkout-complete-btn');
    btn.disabled = true;
    btn.textContent = 'Processing…';

    const discount = APPLIED_COUPON ? computeDiscount(APPLIED_COUPON, price) : 0;
    const finalAmount = Math.max(price - discount, 0);

    // THE GRANT HAPPENS ON THE SERVER. This page used to claim the coupon
    // seat, write the order and set plan / paidThroughMillis / foundingMember
    // on the student document itself — which meant anyone with devtools open
    // could award themselves any plan, permanently in the founding-member
    // case. redeemFreeCheckout re-reads the plan and the coupon from
    // Firestore, proves the total really is zero, claims one redemption per
    // account atomically, and writes the entitlement with the Admin SDK.
    //
    // Nothing about the price, the plan or the coupon is taken from this
    // page any more; it sends two identifiers and is told what happened.
    let fns = null;
    try { fns = firebase.app().functions(); } catch (e) {}
    if (!fns) {
      btn.disabled = false;
      btn.textContent = 'Complete order';
      errEl.textContent = 'Checkout is unavailable right now. Please refresh and try again.';
      errEl.style.display = 'block';
      return;
    }

    fns.httpsCallable('redeemFreeCheckout')({
      planId: CHECKOUT_PLAN.id,
      couponCode: APPLIED_COUPON ? APPLIED_COUPON.code : null,
      billing: CHECKOUT_BILLING || null
    })
      .then(() => {
        // Two entries, not one: the money and the access change are separate
        // facts. An order can exist without a plan change (a failed grant) and
        // an admin can grant a plan with no order behind it, so collapsing
        // them into a single line would hide both cases.
        if (typeof logActivity === 'function') {
          logActivity('commerce.order_created',
            'Bought ' + CHECKOUT_PLAN.name + ' for ' + checkoutFmt(finalAmount) +
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
        // 'not-found' from a callable means the FUNCTION itself is missing,
        // not the plan — i.e. redeemFreeCheckout has not been deployed yet.
        // Say something a buyer can act on instead of leaking that detail.
        const missingFunction = err && (err.code === 'functions/not-found' ||
                                        err.code === 'functions/unimplemented');
        errEl.textContent = missingFunction
          ? 'Checkout is being updated right now. Please try again in a few minutes, or contact support and we will set this up for you.'
          : 'Could not complete order: ' + (err.message || err);
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Complete order';
      });
  }
});
