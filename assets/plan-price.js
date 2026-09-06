// Stryker Trading Academy — plan pricing with sales / offer prices
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
    ? 'Prices shown in ₹ Indian Rupees (converted from USD)'
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

function planSaleInfo(plan){
  var full = planPriceNum(plan && plan.price);
  var out = { active: false, price: full, full: full, sale: full, pct: 0, save: 0,
              label: '', endsMs: null };
  if (!plan || !plan.onSale) return out;

  var sale = planParsePrice(plan.salePrice);
  if (sale === null || sale < 0 || sale >= full || full <= 0) return out;

  var endsMs = planSaleEndMs(plan);
  if (endsMs !== null && endsMs < Date.now()) return out;   // offer has run out

  out.active = true;
  out.price = sale;
  out.sale = sale;
  out.save = full - sale;
  out.pct = Math.round(((full - sale) / full) * 100);
  out.label = (plan.saleLabel || '').trim() || 'Limited offer';
  out.endsMs = endsMs;
  return out;
}

// The number to actually charge / store on the order.
function planEffectivePrice(plan){ return planSaleInfo(plan).price; }

function planMoney(n){
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
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
        '<span class="pp-was"><s>' + planMoneyDisplay(s.full) + '</s></span>' +
      '</div>' +
      '<div class="pp-tags">' +
        '<span class="pp-off"><i></i>SAVE ' + s.pct + '%</span>' +
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
  return '<span class="plan-sale-flag"><b>' + planEscape(s.label) + '</b></span>';
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
