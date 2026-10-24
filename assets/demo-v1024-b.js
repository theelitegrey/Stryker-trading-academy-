// TradeZoro demo homepage, variation B "Editorial story" (demo-v1024-b.html).
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape). Enrolled count is filled by main.js
//             (#hero-enrolled-count, publicStats/enrollment, 82 fallback in HTML).
//
// 1. Scroll reveals: opacity/transform only, observed while in view, nothing
//    hidden at all for prefers-reduced-motion or without IntersectionObserver.
// 2. Sticky side numbers (desktop): the number of the chapter in view lights up.
// 3. Plan cards: name, price and feature lines from the live `plans` docs, picked
//    the same way pricing-hero.js does (visible, not archived; Free = price 0,
//    Pro = featured paid plan). The static HTML stays if the read fails.
(function () {
  'use strict';
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var hasIO = 'IntersectionObserver' in window;

  if (!reduce && hasIO) {
    document.documentElement.classList.add('ed-js');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    document.querySelectorAll('.ed-reveal').forEach(function (el) { io.observe(el); });
  }

  if (hasIO) {
    var rail = {};
    document.querySelectorAll('.ed-rail li').forEach(function (li) { rail[li.getAttribute('data-for')] = li; });
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(rail).forEach(function (k) { rail[k].classList.toggle('is-on', k === e.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('.ed-ch').forEach(function (ch) { ro.observe(ch); });
  }

  function priceOf(p) { return p ? planSaleInfo(p).price : 0; }
  function fill(key, plan) {
    if (!plan) return;
    var esc = planEscape;
    var n = document.querySelector('[data-plan-name="' + key + '"]');
    if (n) n.textContent = planDisplayName(plan);
    var pr = document.querySelector('[data-plan-price="' + key + '"]');
    if (pr) {
      var s = planSaleInfo(plan);
      pr.textContent = planMoneyDisplay(priceOf(plan));
      var old = pr.parentNode.querySelector('s'); if (old) old.remove();
      if (s.active && s.full) {
        var st = document.createElement('s'); st.textContent = planMoneyDisplay(s.full);
        pr.parentNode.appendChild(st);
      }
    }
    var ul = document.querySelector('[data-plan-feats="' + key + '"]');
    if (ul && Array.isArray(plan.features) && plan.features.length) {
      ul.innerHTML = plan.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('');
    }
    var cta = document.querySelector('[data-plan-cta="' + key + '"]');
    if (cta) cta.setAttribute('href', 'checkout?plan=' + encodeURIComponent(plan.id));
  }

  function loadPlans() {
    if (typeof strykerLoadPlans !== 'function' || typeof db === 'undefined' || !db) return;
    Promise.all([strykerLoadPlans(), typeof strykerFxReady === 'function' ? strykerFxReady() : null])
      .then(function (r) {
        var all = r[0] || [];
        var vis = all.filter(function (p) { return !p.hidden && !planIsArchived(p); })
          .sort(function (a, b) { return ((+a.rank || 0) - (+b.rank || 0)) || (priceOf(a) - priceOf(b)); });
        var free = vis.find(function (p) { return !priceOf(p); });
        var pro = vis.find(function (p) { return p.featured && priceOf(p) > 0; }) ||
          vis.filter(function (p) { return priceOf(p) > 0; }).pop();
        fill('free', free); fill('pro', pro);
      })
      .catch(function (e) { console.error('TradeZoro: plans not loaded', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPlans); else loadPlans();
})();
