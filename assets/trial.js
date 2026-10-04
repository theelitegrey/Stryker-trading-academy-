// Stryker Trading Academy: 7-day free trial, client side (labels and small print only)
// Depends on: assets/progress.js (`db`), assets/auth.js (`auth`, firebase app),
//             assets/plan-price.js (planSaleInfo, planListPrice, planMoneyDisplay,
//             stkPeriodKind, strykerCurrency, strykerFxReady)
//
// The server decides who gets a trial (functions-src/trial.js, re-checked at
// checkout and again when the payment method is attached). This file only
// asks, so it can show "Start 7-day free trial" plus honest small print to a
// member who will actually get one. Every failure path answers "no trial":
//   - settings/commerce.trialEnabled is not true (the switch; default off)
//   - signed out, functions SDK unavailable, callable error or timeout
// so with the switch off the site looks and behaves exactly as before.
//
// API (globals):
//   strykerTrialEligible(planId) -> Promise<boolean>   (cached per plan)
//   strykerTrialEndDate()        -> Date, now + 7 days
//   strykerTrialDateLabel(d)     -> '12 Oct 2026'
//   strykerTrialSmallPrint(plan) -> HTML string for under the button
//   strykerTrialDecorate(el, plan, small) relabels a plan CTA to "Start 7-day
//                                free trial" and adds the small print under it,
//                                only if the server says this member is eligible
//   STRYKER_TRIAL_DAYS           -> 7
//
// Dashboard: a member on a free trial (students/{uid}.subscriptionStatus ===
// 'trialing', set only by the payment functions) gets a one-line strip at the
// top of dashboard-user.html: days left, the charge date, a link to cancel.
// Not gated on the switch: a trial already running must stay visible even if
// new trials are switched off.

var STRYKER_TRIAL_DAYS = 7;
var _trialSwitch = null;
var _trialCache = {};

function strykerTrialSwitchOn(){
  if (_trialSwitch) return _trialSwitch;
  if (typeof db === 'undefined' || !db) return Promise.resolve(false);
  _trialSwitch = db.collection('settings').doc('commerce').get()
    .then(function (d){ return !!(d.exists && d.data().trialEnabled === true); })
    .catch(function (){ return false; });
  return _trialSwitch;
}

// Pages that never needed Cloud Functions don't load the SDK; it is pulled in
// only when the switch is on and a member is signed in.
function _trialFunctions(){
  try { if (firebase.app().functions) return Promise.resolve(firebase.app().functions()); } catch (e) {}
  return new Promise(function (resolve){
    var s = document.createElement('script');
    s.src = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js';
    s.onload = function (){ try { resolve(firebase.app().functions()); } catch (e) { resolve(null); } };
    s.onerror = function (){ resolve(null); };
    document.head.appendChild(s);
  });
}

function _trialSignedInUser(){
  return new Promise(function (resolve){
    if (typeof auth === 'undefined' || !auth) { resolve(null); return; }
    if (auth.currentUser) { resolve(auth.currentUser); return; }
    var off = auth.onAuthStateChanged(function (u){ off(); resolve(u || null); });
  });
}

function strykerTrialEligible(planId){
  var key = String(planId || '');
  if (_trialCache[key]) return _trialCache[key];
  _trialCache[key] = strykerTrialSwitchOn().then(function (on){
    if (!on) return false;
    return _trialSignedInUser().then(function (user){
      if (!user) return false;
      return _trialFunctions().then(function (fns){
        if (!fns) return false;
        var call = fns.httpsCallable('trialEligibility')({ planId: key || null })
          .then(function (res){ return !!(res && res.data && res.data.eligible === true); });
        var timeout = new Promise(function (r){ setTimeout(function (){ r(false); }, 8000); });
        return Promise.race([call, timeout]);
      });
    });
  }).catch(function (){ return false; });
  return _trialCache[key];
}

function strykerTrialEndDate(){
  return new Date(Date.now() + STRYKER_TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

function strykerTrialDateLabel(d){
  try { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return d.toISOString().slice(0, 10); }
}

// "Card required. You won't be charged until <date>. Then $39/month.
//  Cancel anytime before <date> in Billing." INR viewers see the live rupee
// price and the mandate wording (Razorpay takes a small refundable check).
function strykerTrialSmallPrint(plan){
  var sale = (typeof planSaleInfo === 'function') ? planSaleInfo(plan) : { active: false };
  var usd = sale.active ? sale.price
    : ((typeof planListPrice === 'function') ? planListPrice(plan) : (parseFloat(plan && plan.price) || 0));
  var money = (typeof planMoneyDisplay === 'function') ? planMoneyDisplay(usd) : ('$' + usd);
  var per = (typeof stkPeriodKind === 'function' && stkPeriodKind(plan && plan.period) === 'year') ? 'year' : 'month';
  var date = strykerTrialDateLabel(strykerTrialEndDate());
  var inr = (typeof strykerCurrency === 'function') && strykerCurrency() === 'INR';
  var need = inr
    ? 'Card or UPI AutoPay required (Razorpay may take a small refundable check to verify it).'
    : 'Card required.';
  return need + ' You won\'t be charged until ' + date + '. Then ' + money + '/' + per +
    '. Cancel anytime before ' + date + ' in ' +
    '<a href="settings.html" style="color:var(--teal); text-decoration:underline;">Billing</a>.';
}

// Pricing cards / upgrade modal: the CTA stays exactly as it was unless the
// server says yes. Plans that don't renew or cost nothing are never touched.
function strykerTrialDecorate(el, plan){
  if (!el || !plan) return;
  var renews = typeof stkPeriodKind === 'function' && stkPeriodKind(plan.period) !== 'none';
  var priced = (typeof planListPrice === 'function' ? planListPrice(plan) : parseFloat(plan.price) || 0) > 0;
  if (!renews || !priced) return;
  strykerTrialEligible(plan.id).then(function (ok){
    if (!ok || el.getAttribute('data-trial') === '1') return;
    el.setAttribute('data-trial', '1');
    el.textContent = 'Start ' + STRYKER_TRIAL_DAYS + '-day free trial';
    var p = document.createElement('p');
    p.className = 'trial-smallprint';
    p.innerHTML = strykerTrialSmallPrint(plan);
    el.insertAdjacentElement('afterend', p);
  });
}

function _trialBanner(){
  if (!/dashboard-user(\.html)?$/.test(location.pathname)) return;
  _trialSignedInUser().then(function (user){
    if (!user || typeof db === 'undefined' || !db) return;
    return db.collection('students').doc(user.uid).get().then(function (doc){
      var s = doc.exists ? doc.data() : {};
      var pt = s.paidThroughMillis || 0;
      if (s.subscriptionStatus !== 'trialing' || pt <= Date.now()) return;
      var main = document.getElementById('main');
      if (!main || document.getElementById('trial-strip')) return;
      var left = Math.max(1, Math.ceil((pt - Date.now()) / 86400000));
      var date = strykerTrialDateLabel(new Date(pt));
      var el = document.createElement('div');
      el.id = 'trial-strip';
      el.className = 'trial-strip';
      el.setAttribute('role', 'status');
      var plan = String(s.plan || 'Pro').replace(/[<>&"]/g, '');
      el.innerHTML = s.subscriptionAutopay
        ? '<b>Free trial: ' + left + ' day' + (left === 1 ? '' : 's') + ' left.</b> ' + plan +
          ' is unlocked. Your first charge is on ' + date + ' unless you cancel before then. ' +
          '<a href="settings.html">Cancel or manage billing</a>'
        : '<b>Free trial: ' + left + ' day' + (left === 1 ? '' : 's') + ' left.</b> You cancelled, so you won\'t be charged. ' +
          plan + ' stays unlocked until ' + date + '.';
      main.insertBefore(el, main.firstChild);
    });
  }).catch(function (){});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _trialBanner);
else _trialBanner();
