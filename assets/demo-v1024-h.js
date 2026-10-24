// TradeZoro demo homepage variation H "App style / swipe cards"
// (demo-v1024-h.html only; Owner order 2026-10-24, homepage variations round 2).
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape, planYearlyDealHtml, stkPeriodKind,
//             strykerCurrencyNoteHtml). The enrolled count (#hero-enrolled-count)
//             is filled by assets/main.js from publicStats/enrollment (82 fallback).
// Does three things:
//   1. Free vs Pro ("Everything included"): names, prices and feature lines from
//      the Firestore 'plans' docs, picked the same way demo D / pricing-hero.js
//      pick them. The static HTML fallback stays if the plans fail. Nothing is written.
//   2. Rail arrows (desktop): scroll each feature rail by one view; arrows
//      disable at the ends. Sets scrollLeft on the rail itself (never scrollIntoView).
//   3. Hero phone float runs only while the hero is in view.
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
      .catch(function (e) { console.error('TradeZoro demo H: plans failed to load', e); });
  }

  // ---- 2. rail arrows ----
  function wireRails() {
    Array.prototype.forEach.call(document.querySelectorAll('.ah-rail'), function (rail) {
      var track = rail.querySelector('.ah-track');
      var btns = rail.querySelectorAll('.ah-arrow');
      if (!track || !btns.length) return;
      var sync = function () {
        var max = track.scrollWidth - track.clientWidth - 2;
        btns[0].disabled = track.scrollLeft <= 2;
        btns[1].disabled = track.scrollLeft >= max;
      };
      Array.prototype.forEach.call(btns, function (b) {
        b.addEventListener('click', function () {
          var dir = +b.getAttribute('data-dir') || 1;
          var card = track.querySelector('.ah-card');
          var step = card ? card.getBoundingClientRect().width + 14 : track.clientWidth;
          var per = Math.max(1, Math.floor((track.clientWidth + 14) / step));
          var max = track.scrollWidth - track.clientWidth;
          track.scrollLeft = Math.max(0, Math.min(max, track.scrollLeft + dir * per * step));
        });
      });
      track.addEventListener('scroll', sync, { passive: true });
      window.addEventListener('resize', sync);
      sync();
    });
  }

  // ---- 3. hero motion only while in view ----
  function wireHero() {
    var hero = $('.ah-hero');
    if (!hero || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (es) {
      hero.classList.toggle('ah-play', es[0].isIntersecting);
    }, { threshold: 0 }).observe(hero);
  }

  function start() { wireRails(); wireHero(); loadPlans(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
