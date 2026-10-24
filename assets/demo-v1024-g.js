// TradeZoro demo homepage variation G "Alternating rows"
// (demo-v1024-g.html only; Owner order 2026-10-24, homepage variations 1024).
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape, planYearlyDealHtml, stkPeriodKind,
//             strykerCurrencyNoteHtml). The enrolled count (#hero-enrolled-count)
//             is filled by assets/main.js from publicStats/enrollment (82 fallback),
//             and main.js also runs the shared .reveal fade-in.
// Does two things:
//   1. Free vs Pro: prices and feature lines from the Firestore 'plans' docs,
//      picked the same way assets/pricing-hero.js picks them. The static HTML
//      fallback stays if the plans fail to load. Nothing is written.
//   2. Sticky section nav: sits under the site header and underlines the
//      section currently in view (IntersectionObserver, no scroll handler).
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return (typeof planEscape === 'function') ? planEscape(s) : String(s); };

  // ---- 1. plans ----
  function priceOf(p) { return p ? planSaleInfo(p).price : 0; }
  function renderPlans(all) {
    var byId = {};
    all.forEach(function (p) { byId[p.id] = p; });
    var vis = all.filter(function (p) { return !p.hidden && !planIsArchived(p); })
      .sort(function (a, b) { return ((+a.rank || 0) - (+b.rank || 0)) || (priceOf(a) - priceOf(b)); });
    var free = vis.find(function (p) { return !priceOf(p); });
    var pro = vis.find(function (p) { return p.featured && priceOf(p) > 0; }) ||
      vis.filter(function (p) { return priceOf(p) > 0; }).pop();
    fill($('[data-plan="free"]'), free, null);
    fill($('[data-plan="pro"]'), pro, pro && pro.yearlyPlanId ? byId[pro.yearlyPlanId] : null);
    var note = $('[data-curnote]');
    if (note && typeof strykerCurrencyNoteHtml === 'function') note.innerHTML = strykerCurrencyNoteHtml();
  }
  function fill(card, plan, yearly) {
    if (!card || !plan) return;
    var name = card.querySelector('[data-name]');
    if (name) name.textContent = planDisplayName(plan);
    var feats = (plan.features || []).filter(Boolean);
    if (feats.length) card.querySelector('[data-feats]').innerHTML = feats.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('');
    var s = planSaleInfo(plan);
    card.querySelector('[data-price]').innerHTML = planMoneyDisplay(s.price) + (s.active ? ' <s>' + planMoneyDisplay(s.full) + '</s>' : '');
    var per = card.querySelector('[data-per]');
    if (per && typeof stkPeriodKind === 'function') per.textContent = '/ ' + (stkPeriodKind(plan.period) === 'year' ? 'year' : 'month');
    var y = card.querySelector('[data-yearly]');
    if (y && yearly && typeof planYearlyDealHtml === 'function') y.innerHTML = planYearlyDealHtml(plan, yearly, 'checkout.html?plan=' + encodeURIComponent(yearly.id));
    var cta = card.querySelector('[data-cta]');
    if (cta && priceOf(plan) > 0) {
      cta.href = 'checkout?plan=' + encodeURIComponent(plan.id);
      cta.textContent = (plan.ctaLabel || '').trim() || ('Join ' + planDisplayName(plan));
    }
  }
  function loadPlans() {
    if (typeof strykerLoadPlans !== 'function' || typeof db === 'undefined' || !db) return;
    var fx = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
    Promise.all([strykerLoadPlans(), fx]).then(function (r) { renderPlans(r[0]); })
      .catch(function (e) { console.error('TradeZoro demo G: plans failed to load', e); });
  }

  // ---- 2. sticky section nav ----
  function wireNav() {
    var bar = $('.ar-secnav');
    if (!bar) return;
    var siteNav = $('#site-nav');
    var setTop = function () { if (siteNav) document.documentElement.style.setProperty('--ar-navh', siteNav.offsetHeight + 'px'); };
    setTop();
    window.addEventListener('resize', setTop);
    if (!('IntersectionObserver' in window)) return;
    var links = Array.prototype.slice.call(bar.querySelectorAll('a'));
    var map = {};
    links.forEach(function (a) { var t = document.getElementById(a.getAttribute('href').slice(1)); if (t) map[t.id] = a; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('on', a === map[e.target.id]); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  }

  function start() { wireNav(); loadPlans(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
