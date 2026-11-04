// TradeZoro: pricing page (pricing.html #pricing). DATA PLANS (Owner 2026-11-04): every tool is free; the paid part is live data.
// Three cards are in the HTML: Free, Data feed L1 (plans/LiveData), Data feed L2 (plans/LiveDataL2). This file only fills the live
// price from the plans docs (in the visitor's currency, plan-price.js) and hides a data card whose doc is missing or archived
// (no dead checkout). The $7 / $20 in the HTML are the fallback. Pro is no longer sold (its docs stay for current subscribers).
// Depends on: assets/progress.js (db), assets/plan-price.js (strykerLoadPlans, strykerFxReady, planSaleInfo, planMoneyDisplay,
// planIsArchived, strykerCurrencyNoteHtml). Education only. Not financial advice.
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('pricing-root');
    if (!root || typeof db === 'undefined' || typeof strykerLoadPlans !== 'function') return;
    var fx = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
    Promise.all([strykerLoadPlans(), fx]).then(function (res) {
      var byId = {};
      (res[0] || []).forEach(function (p) { byId[p.id] = p; });
      ['LiveData', 'LiveDataL2'].forEach(function (id) {
        var card = root.querySelector('[data-card="' + id + '"]'), p = byId[id];
        if (!card) return;
        if (!p || (typeof planIsArchived === 'function' ? planIsArchived(p) : p.archived === true)) {
          var cta = card.querySelector('[data-cta]');   // not on sale yet: say so instead of a dead checkout
          if (cta) { cta.removeAttribute('href'); cta.setAttribute('aria-disabled', 'true'); cta.classList.add('is-disabled'); cta.textContent = 'Opening soon'; }
          return;
        }
        var price = typeof planSaleInfo === 'function' ? planSaleInfo(p).price : parseFloat(p.price);
        var el = card.querySelector('[data-price]');
        if (el && price > 0 && typeof planMoneyDisplay === 'function') el.innerHTML = planMoneyDisplay(price) + '<span>/ month</span>';
      });
      if (typeof strykerCurrencyNoteHtml === 'function' && !root.querySelector('.plan-currency-note')) root.insertAdjacentHTML('beforeend', strykerCurrencyNoteHtml());
    }).catch(function (e) { console.error('TradeZoro: pricing plans failed to load, showing the fallback prices', e); });
  });
})();
