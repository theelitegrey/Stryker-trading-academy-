// TradeZoro — plan pricing with sales / offer prices
//
// A plan can carry a sale (set in Billing & plans admin):
//   onSale:     true
//   salePrice:  '29'                 — what the student actually pays
//   saleLabel:  'Launch offer'       — optional ribbon text
//   saleEndsAt: '2026-09-30'         — optional; the offer expires on its own
//
// A sale is only "live" when it is switched on, the sale price is a real
// number below the plan price, and the end date (if any) has not passed —
// so an offer that runs out stops advertising itself with no admin action,
// and every surface (homepage cards, the upgrade modal, checkout, the amount
// actually charged) agrees on the price because they all ask this file.

// ---- Currency: USD base, ₹ for visitors in India -------------------------
//
// Plan prices are stored as plain USD numbers. Visitors whose device timezone
// is India see (and are charged) rupees at an admin-controlled rate stored in
// settings/commerce.usdInr — the SAME doc the payment function reads, and the
// SAME rounding (whole rupees), so the price on the page is exactly what
// Razorpay charges. Everyone else sees dollars. A manual switcher
// (data-currency-switch links) overrides detection via localStorage, because
// a timezone is a strong hint, not an identity — travellers and VPN users can
// put themselves in the right currency in one click.

var STRYKER_USD_INR = 88;   // fallback only — live rate comes from Firestore
var _fxPromise = null;

function strykerIsIndiaTz(){
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta';
  } catch (e) { return false; }
}

function strykerCurrencyOverride(){
  try {
    var saved = localStorage.getItem('stryker_currency');
    return (saved === 'USD' || saved === 'INR') ? saved : null;
  } catch (e) { return null; }
}

function strykerCurrency(){
  if (window.STRYKER_FORCE_CURRENCY) return window.STRYKER_FORCE_CURRENCY; // admin pages pin USD
  return strykerCurrencyOverride() || (strykerIsIndiaTz() ? 'INR' : 'USD');
}

// Resolves once the live USD→INR rate is in. Pages that render prices wait on
// this so the first paint already shows the right rupee amounts; USD viewers
// skip the read entirely (the rate is irrelevant to them).
function strykerFxReady(){
  if (_fxPromise) return _fxPromise;
  if (strykerCurrency() !== 'INR' || typeof db === 'undefined' || !db) {
    _fxPromise = Promise.resolve(STRYKER_USD_INR);
    return _fxPromise;
  }
  _fxPromise = db.collection('settings').doc('commerce').get().then(function (doc){
    var r = doc.exists ? parseFloat(doc.data().usdInr) : NaN;
    if (isFinite(r) && r > 0) STRYKER_USD_INR = r;
    return STRYKER_USD_INR;
  }).catch(function (){ return STRYKER_USD_INR; });
  return _fxPromise;
}

// USD number in, display string out — '$49' or '₹4,312'. Rupee prices round
// to whole rupees (functions-src/razorpay.js does the identical Math.round,
// so display and charge can never drift apart).
function planMoneyDisplay(usd){
  if (strykerCurrency() === 'INR') {
    return '₹' + Math.round(usd * STRYKER_USD_INR).toLocaleString('en-IN');
  }
  return '$' + planMoney(usd);
}

// The small "shown in ₹ · switch" line under pricing. Empty for plain-USD
// visitors with no override — they have nothing to switch about.
function strykerCurrencyNoteHtml(){
  if (!strykerIsIndiaTz() && !strykerCurrencyOverride()) return '';
  var cur = strykerCurrency();
  var msg = cur === 'INR'
    ? 'Prices shown in ₹ Indian Rupees'
    : 'Prices shown in US Dollars';
  var other = cur === 'INR' ? 'USD' : 'INR';
  var otherLabel = cur === 'INR' ? 'Show in $ USD' : 'Show in ₹ INR';
  return '<div class="currency-note" style="margin-top:14px; text-align:center; font-family:var(--font-mono); font-size:12px; color:var(--ink-3);">' +
    msg + ' · <a href="#" data-currency-switch="' + other + '" style="color:var(--teal); text-decoration:underline;">' + otherLabel + '</a></div>';
}

document.addEventListener('click', function (ev){
  var link = ev.target && ev.target.closest ? ev.target.closest('[data-currency-switch]') : null;
  if (!link) return;
  ev.preventDefault();
  try { localStorage.setItem('stryker_currency', link.dataset.currencySwitch); } catch (e) {}
  location.reload();   // every price on the page re-renders in the new currency
});

// ---- Local preview (development only) ------------------------------------------
// On localhost with ?preview=launch, pricing surfaces read the prepared plan
// records from tools/launch-sale/ instead of Firestore, so the launch sale can
// be screenshotted before any live record changes. Inert everywhere else.
function strykerPreviewMode(){
  try {
    return /^(127\.0\.0\.1|localhost)$/.test(location.hostname) &&
      new URLSearchParams(location.search).get('preview') === 'launch';
  } catch (e) { return false; }
}
function strykerLoadPlans(){
  if (strykerPreviewMode()) {
    return fetch('tools/launch-sale/plans.preview.json').then(function (r){ return r.json(); });
  }
  return db.collection('plans').get().then(function (snap){
    var list = [];
    snap.forEach(function (d){ list.push(Object.assign({ id: d.id }, d.data())); });
    return list;
  });
}

// ---- Subscription periods --------------------------------------------------
// Client mirror of functions-src/subscriptions.js: 'month'/'year' periods
// expire and renew; anything else (forever, one-time, lifetime, blank) never
// does. Same calendar-aware extension math, so a date stamped client-side
// (free-coupon checkout) matches one stamped server-side (paid checkout).

function stkPeriodKind(period){
  var p = String(period || '').toLowerCase();
  if (/month/.test(p)) return 'month';
  if (/year|annual/.test(p)) return 'year';
  return 'none';
}

function stkExtendPeriod(fromMillis, period){
  var kind = stkPeriodKind(period);
  if (kind === 'none') return null;
  var d = new Date(fromMillis);
  var day = d.getUTCDate();
  if (kind === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0);   // Jan 31 + 1mo → end of Feb
  return d.getTime();
}

// Strict: returns null when the field holds no number at all. A blank or
// mistyped sale price must NOT read as zero — that would silently price the
// plan at 100% off. An explicit '0' is still a real (free) sale price.
function planParsePrice(v){
  var s = String(v == null ? '' : v).replace(/[^0-9.]/g, '');
  if (!/\d/.test(s)) return null;
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function planPriceNum(v){
  var n = planParsePrice(v);
  return n === null ? 0 : n;
}

// End of the chosen day, so an offer dated "the 30th" runs through the 30th.
function planSaleEndMs(plan){
  if (!plan || !plan.saleEndsAt) return null;
  var d = new Date(plan.saleEndsAt);
  if (isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(plan.saleEndsAt))) d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// ---- Fixed rupee prices (launch sale, build 319) ------------------------------
// A plan may carry priceInr / salePriceInr: exact rupee prices set by hand
// instead of the converted USD ones. For an INR viewer they are expressed
// here as USD-equivalents (rupees / rate), so every existing caller keeps
// working in "USD" and planMoneyDisplay's Math.round(usd * rate) lands back
// on the exact rupee figure. functions-src/razorpay.js + razorpaySubs.js
// charge the same rupee numbers (see inrPlanPrices there).
function planUsesInrPrices(plan){
  return !!plan && strykerCurrency() === 'INR' && planParsePrice(plan.priceInr) !== null;
}
function planListPrice(plan){
  if (planUsesInrPrices(plan)) return planParsePrice(plan.priceInr) / STRYKER_USD_INR;
  return planPriceNum(plan && plan.price);
}
function planSalePriceRaw(plan){
  if (planUsesInrPrices(plan)) {
    var si = planParsePrice(plan.salePriceInr);
    return si === null ? null : si / STRYKER_USD_INR;
  }
  return planParsePrice(plan && plan.salePrice);
}

function planSaleInfo(plan){
  var full = planListPrice(plan);
  var out = { active: false, price: full, full: full, sale: full, pct: 0, save: 0,
              label: '', endsMs: null };
  if (!plan || !plan.onSale) return out;

  var sale = planSalePriceRaw(plan);
  if (sale === null || sale < 0 || sale >= full || full <= 0) return out;

  var endsMs = planSaleEndMs(plan);
  if (endsMs !== null && endsMs < Date.now()) return out;   // offer has run out

  out.active = true;
  out.price = sale;
  out.sale = sale;
  out.save = full - sale;
  out.pct = planPctOff(full, sale);
  out.label = (plan.saleLabel || '').trim() || 'Sale';
  out.endsMs = endsMs;
  return out;
}

// Percent off, worked out on the amounts the visitor actually sees (whole
// rupees for INR viewers, dollars otherwise) and rounded DOWN, so the badge
// never claims a bigger discount than the two printed prices show:
// $39 / $109 = 64.2% -> 64; Rs 3,772 / Rs 10,544 = 64.2% -> 64. The tiny
// epsilon stops float noise (e.g. 28.999999) from dropping a whole point.
function planPctOff(full, sale){
  if (strykerCurrency() === 'INR') {
    full = Math.round(full * STRYKER_USD_INR);
    sale = Math.round(sale * STRYKER_USD_INR);
  }
  if (!(full > 0) || !(sale >= 0) || sale >= full) return 0;
  return Math.max(0, Math.floor(((full - sale) / full) * 100 + 1e-9));
}

// The "64% OFF" pill that sits beside the struck-through price. Empty when
// there is no live sale or the rounded-down discount is 0.
function planPctBadgeHtml(plan){
  var s = planSaleInfo(plan);
  if (!s.active || !(s.pct > 0)) return '';
  return '<span class="pp-pct">' + s.pct + '% OFF</span>';
}

// The number to actually charge / store on the order.
function planEffectivePrice(plan){ return planSaleInfo(plan).price; }

// ---- Yearly as a monthly price (pricing upgrades, 2026-10-12) ---------------
// "or $29/mo billed yearly ($349) · save 25%". Every figure is worked out on
// the amounts the visitor actually sees (whole rupees for INR, the same
// Math.round(usd x rate) the payment functions charge; dollars otherwise),
// and both the per-month figure and the % are rounded DOWN, so the line never
// makes yearly look cheaper than the two real prices show:
//   per month = floor(yearly / 12)                         349 / 12 = 29.08 -> 29
//   save      = floor((12 x monthly - yearly) / (12 x monthly))   (468-349)/468 = 25.4% -> 25
// Returns null when there is no priced yearly twin.
function planShownAmount(usd){
  return strykerCurrency() === 'INR' ? Math.round(usd * STRYKER_USD_INR) : usd;
}
function planShownMoney(n){
  return strykerCurrency() === 'INR' ? '₹' + Math.round(n).toLocaleString('en-IN') : '$' + planMoney(n);
}
function planYearlyDeal(monthlyPlan, yearlyPlan){
  if (!yearlyPlan) return null;
  var y = planShownAmount(planSaleInfo(yearlyPlan).price);
  if (!(y > 0)) return null;
  var m = monthlyPlan ? planShownAmount(planSaleInfo(monthlyPlan).price) : 0;
  var twelve = m * 12;
  var pct = (twelve > 0 && y < twelve) ? Math.max(0, Math.floor(((twelve - y) / twelve) * 100 + 1e-9)) : 0;
  return {
    perMonth: planShownMoney(Math.floor(y / 12 + 1e-9)),
    total: planShownMoney(y),
    pct: pct,
    text: 'or ' + planShownMoney(Math.floor(y / 12 + 1e-9)) + '/mo billed yearly (' + planShownMoney(y) + ')' +
      (pct > 0 ? ' · save ' + pct + '%' : '')
  };
}
// The clickable line itself, linking to checkout for the yearly twin.
function planYearlyDealHtml(monthlyPlan, yearlyPlan, href){
  var d = planYearlyDeal(monthlyPlan, yearlyPlan);
  if (!d) return '';
  var url = href || ('checkout.html?plan=' + encodeURIComponent(yearlyPlan.id));
  return '<a class="plan-yearly" href="' + planEscape(url) + '">' + planEscape(d.text) + '\u00a0→</a>';
}

function planMoney(n){
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
}

// Public name of a plan. `name` is the stable key students store (and the
// Firestore rules pin new accounts to 'Starter'), so a rename on the public
// side goes in `displayName` instead: plans/WuvUQyHX82ZzHP2sKLms has name
// 'Starter', displayName 'Free' (pricing change 2026-10-05).
// Only Free and Pro are sold (Owner, 2026-10-12): an archived plan (Elite,
// still held by legacy members) reads as 'Pro' to members; admin pages use
// adminPlanLabel() in roles.js for 'Pro (legacy)'.
function planDisplayName(plan){
  if (!plan) return '';
  if (plan.archived === true) return 'Pro';
  return String(plan.displayName || plan.name || 'Plan');
}

// A plan that is no longer sold but still held by members (Elite since
// 2026-10-05). It keeps its rank so those members keep full access; every
// public surface (cards, upgrade modal, checkout) filters it out.
function planIsArchived(plan){
  return !!(plan && plan.archived === true);
}

function planEscape(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function saleCountdownText(endsMs){
  var ms = endsMs - Date.now();
  if (ms <= 0) return 'Offer ended';
  var mins = Math.floor(ms / 60000);
  var d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return d + 'd ' + h + 'h left';
  if (h > 0) return h + 'h ' + m + 'm left';
  return m + 'm left';
}

// The price block itself. `size` picks the scale: 'lg' for the homepage
// cards, 'md' for the upgrade modal, 'sm' for the checkout summary.
function planPriceHtml(plan, size){
  var s = planSaleInfo(plan);
  var period = planEscape(plan.period || 'month');
  var cls = 'plan-price plan-price-' + (size || 'lg');

  if (!s.active) {
    return '<div class="' + cls + '"><span class="pp-main"><span class="pp-now">' + planMoneyDisplay(s.full) +
           '</span><span class="pp-per">/ ' + period + '</span></span></div>';
  }

  return '<div class="' + cls + ' is-sale">' +
      '<div class="pp-row">' +
        '<span class="pp-main">' +
          '<span class="pp-now">' + planMoneyDisplay(s.sale) + '</span>' +
          '<span class="pp-per">/ ' + period + '</span>' +
        '</span>' +
        '<span class="pp-was-grp">' +
          '<span class="pp-was"><s>' + planMoneyDisplay(s.full) + '</s></span>' +
          planPctBadgeHtml(plan) +
        '</span>' +
      '</div>' +
      '<div class="pp-tags">' +
        '<span class="pp-off"><i></i>' + planEscape(s.label) + '</span>' +
        '<span class="pp-save">You save ' + planMoneyDisplay(s.save) + '</span>' +
        (s.endsMs ? '<span class="pp-ends" data-sale-countdown="' + s.endsMs + '">' +
          saleCountdownText(s.endsMs) + '</span>' : '') +
      '</div>' +
    '</div>';
}

// The corner ribbon that marks a card as being on offer.
function planSaleRibbonHtml(plan){
  var s = planSaleInfo(plan);
  if (!s.active) return '';
  return '<span class="plan-sale-flag"><b>' + s.pct + '% OFF</b></span>';
}

// Countdown chips tick themselves. One interval for the whole page, started
// on demand and stopped again once nothing is counting.
var _saleTimer = null;
function startSaleCountdowns(){
  if (_saleTimer) return;
  _saleTimer = setInterval(function (){
    var els = document.querySelectorAll('[data-sale-countdown]');
    if (!els.length) { clearInterval(_saleTimer); _saleTimer = null; return; }
    els.forEach(function (el){
      var ends = parseInt(el.dataset.saleCountdown, 10);
      var next = saleCountdownText(ends);
      if (next !== el.textContent) {
        el.textContent = next;
        el.classList.remove('tick');
        void el.offsetWidth;          // restart the flash
        el.classList.add('tick');
      }
      if (ends <= Date.now()) el.classList.add('done');
    });
  }, 1000);
}

document.addEventListener('DOMContentLoaded', startSaleCountdowns);
