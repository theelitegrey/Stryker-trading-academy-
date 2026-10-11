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
    // &saleEnd=14d | 65s | 3h | none | <ISO date> rewrites saleEndsAt on every
    // on-sale preview plan, so the launch timer and its expiry can be watched
    // locally. Preview only: live plans always use their stored saleEndsAt.
    var se = new URLSearchParams(location.search).get('saleEnd');
    return fetch('tools/launch-sale/plans.preview.json').then(function (r){ return r.json(); })
      .then(function (list){
        if (!se) return list;
        var m = /^(\d+)([smhd])$/.exec(se);
        var unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
        var at = se === 'none' ? '' : m ? new Date(Date.now() + (+m[1]) * unit[m[2]]).toISOString() : se;
        list.forEach(function (p){ if (p.onSale) p.saleEndsAt = at; });
        return list;
      });
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

// Public name of a plan. `name` is the stable key students store (and the
// Firestore rules pin new accounts to 'Starter'), so a rename on the public
// side goes in `displayName` instead: plans/WuvUQyHX82ZzHP2sKLms has name
// 'Starter', displayName 'Free' (pricing change 2026-10-05).
function planDisplayName(plan){
  if (!plan) return '';
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
// opts.noEnds drops the small "3d 4h left" chip, for cards that already carry
// the launch banner with its own live countdown.
function planPriceHtml(plan, size, opts){
  var s = planSaleInfo(plan);
  var period = planEscape(plan.period || 'month');
  var cls = 'plan-price plan-price-' + (size || 'lg');
  var noEnds = !!(opts && opts.noEnds);

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
        (noEnds ? '' : '<span class="pp-off"><i></i>' + planEscape(s.label) + '</span>') +
        '<span class="pp-save">You save ' + planMoneyDisplay(s.save) + '</span>' +
        (s.endsMs && !noEnds ? '<span class="pp-ends" data-sale-countdown="' + s.endsMs + '">' +
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

// ---- Launch offer banner (Owner order 2026-10-12) ---------------------------
// A slim banner at the top of a plan card on sale: "LAUNCH OFFER · <label>",
// and, when the plan has a saleEndsAt, a live "Ends in 14d 03:12:45" plus the
// exact end in the viewer's own timezone. The deadline is the plan record's
// saleEndsAt and nothing else (the same instant planSaleInfo and the payment
// functions use), so it is never per-visitor, never rolling and never resets
// on reload. Without a saleEndsAt it is a label only, with no timer.
function planSaleTimerText(endsMs){
  var t = Math.max(0, Math.floor((endsMs - Date.now()) / 1000));
  var d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600);
  var m = Math.floor((t % 3600) / 60), x = t % 60;
  var p = function (n){ return (n < 10 ? '0' : '') + n; };
  return d + 'd ' + p(h) + ':' + p(m) + ':' + p(x);
}

// "26 Oct 2026, 11:59 PM IST" in the viewer's timezone (an India viewer sees
// IST, a New York viewer sees the same instant in EDT).
function planSaleEndLabel(endsMs){
  var d = new Date(endsMs);
  try {
    var date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    var time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    var tz = '';
    var tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    var loc = /^Asia\/(Kolkata|Calcutta)$/.test(tzName) ? 'en-IN' : undefined;
    new Intl.DateTimeFormat(loc, { timeZoneName: 'short' }).formatToParts(d).forEach(function (pt){
      if (pt.type === 'timeZoneName') tz = pt.value;
    });
    return date + ', ' + time + (tz ? ' ' + tz : '');
  } catch (e) {
    return d.toString();
  }
}

function planLaunchBannerHtml(plan){
  var s = planSaleInfo(plan);
  if (!s.active) return '';
  var label = String(s.label || '').trim();
  var head = '<div class="plb-head"><i aria-hidden="true"></i><span>LAUNCH OFFER</span>' +
    (label && label.toLowerCase() !== 'launch offer'
      ? '<span class="plb-sep" aria-hidden="true">·</span><span class="plb-label">' + planEscape(label) + '</span>' : '') +
    '</div>';
  if (!s.endsMs) return '<div class="plan-launch-banner plb-no-timer">' + head + '</div>';
  return '<div class="plan-launch-banner" data-sale-timer="' + s.endsMs + '">' + head +
    '<div class="plb-timer">Ends in <b class="plb-clock" role="timer" data-sale-clock>' + planSaleTimerText(s.endsMs) + '</b></div>' +
    '<div class="plb-fine">Launch price ends ' + planEscape(planSaleEndLabel(s.endsMs)) + '</div>' +
  '</div>';
}

// Countdowns tick themselves: ONE interval for the whole page, aligned to the
// wall-clock second, started on demand, stopped once nothing is counting and
// paused while the tab is hidden. Every value is recomputed from Date.now()
// and the stored end, so a pause can never make a timer drift.
// When a launch timer passes its end, 'stryker:sale-ended' fires once on
// document; the card renderers listen and redraw, and planSaleInfo then
// returns the normal price (no banner, no strike-through).
var _saleTimer = null, _saleAlign = null, _saleEnded = {};
function _saleTick(){
  var chips = document.querySelectorAll('[data-sale-countdown]');
  var timers = document.querySelectorAll('[data-sale-timer]');
  if (!chips.length && !timers.length) { stopSaleCountdowns(); return; }
  chips.forEach(function (el){
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
  var now = Date.now();
  timers.forEach(function (el){
    var ends = parseInt(el.dataset.saleTimer, 10);
    var clock = el.querySelector('[data-sale-clock]');
    var txt = planSaleTimerText(ends);
    if (clock && clock.textContent !== txt) clock.textContent = txt;
    if (ends <= now && !_saleEnded[ends]) {
      _saleEnded[ends] = true;
      // a beat past the end, so planSaleInfo's "ends < now" test is already true
      setTimeout(function (){
        document.dispatchEvent(new CustomEvent('stryker:sale-ended', { detail: { endsMs: ends } }));
      }, 60);
    }
  });
}
function stopSaleCountdowns(){
  if (_saleAlign) { clearTimeout(_saleAlign); _saleAlign = null; }
  if (_saleTimer) { clearInterval(_saleTimer); _saleTimer = null; }
}
function startSaleCountdowns(){
  if (_saleTimer || _saleAlign || document.hidden) return;
  _saleTick();
  if (!document.querySelector('[data-sale-countdown],[data-sale-timer]')) return;
  _saleAlign = setTimeout(function (){
    _saleAlign = null;
    _saleTick();
    if (document.querySelector('[data-sale-countdown],[data-sale-timer]')) _saleTimer = setInterval(_saleTick, 1000);
  }, 1005 - (Date.now() % 1000));
}

document.addEventListener('visibilitychange', function (){
  if (document.hidden) stopSaleCountdowns(); else startSaleCountdowns();
});
document.addEventListener('DOMContentLoaded', startSaleCountdowns);
