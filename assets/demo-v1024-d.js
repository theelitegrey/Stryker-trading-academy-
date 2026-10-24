// TradeZoro demo homepage variation D "Problem -> Solution / Compare"
// (demo-v1024-d.html only; Owner order 2026-10-24).
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape, planYearlyDealHtml, stkPeriodKind,
//             strykerCurrencyNoteHtml). The enrolled count (#hero-enrolled-count)
//             is filled by assets/main.js from publicStats/enrollment (82 fallback).
// Does three things:
//   1. Free vs Pro: prices and feature lines from the Firestore 'plans' docs,
//      picked the same way assets/pricing-hero.js picks them. The static HTML
//      fallback stays if the plans fail to load. Nothing is written.
//   2. Hero "messy desk" wobble runs only while the hero is in view.
//   3. Phone sticky "Start free" bar shows after the hero leaves view and hides
//      over the final call to action.
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
      .catch(function (e) { console.error('TradeZoro demo D: plans failed to load', e); });
  }

  // ---- 2 + 3. in-view motion and sticky bar ----
  function wire() {
    var hero = $('.pd-hero'), bar = $('#pd-sticky'), fin = $('.pd-final');
    if (!('IntersectionObserver' in window) || !hero) return;
    var heroIn = true, finIn = false;
    var sync = function () {
      if (!bar) return;
      var on = !heroIn && !finIn;
      bar.classList.toggle('on', on);
      bar.setAttribute('aria-hidden', on ? 'false' : 'true');
      var a = bar.querySelector('a'); if (a) a.tabIndex = on ? 0 : -1;
    };
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.target === hero) { heroIn = e.isIntersecting; hero.classList.toggle('pd-play', e.isIntersecting); }
        else if (e.target === fin) finIn = e.isIntersecting;
      });
      sync();
    }, { threshold: 0 }).observe(hero);
    if (fin) new IntersectionObserver(function (es) { finIn = es[0].isIntersecting; sync(); }, { threshold: 0 }).observe(fin);
    if (bar) document.body.classList.add('pd-has-sticky');
  }

  function start() { wire(); loadPlans(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
