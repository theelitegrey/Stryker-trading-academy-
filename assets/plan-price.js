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
    return '<div class="' + cls + '"><span class="pp-main"><span class="pp-now">$' + planMoney(s.full) +
           '</span><span class="pp-per">/ ' + period + '</span></span></div>';
  }

  return '<div class="' + cls + ' is-sale">' +
      '<div class="pp-row">' +
        '<span class="pp-main">' +
          '<span class="pp-now">$' + planMoney(s.sale) + '</span>' +
          '<span class="pp-per">/ ' + period + '</span>' +
        '</span>' +
        '<span class="pp-was"><s>$' + planMoney(s.full) + '</s></span>' +
      '</div>' +
      '<div class="pp-tags">' +
        '<span class="pp-off"><i></i>SAVE ' + s.pct + '%</span>' +
        '<span class="pp-save">You save $' + planMoney(s.save) + '</span>' +
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
