// TradeZoro demo homepage variation F "Tabbed showcase"
// (demo-v1024-f.html only; Owner order 2026-10-24, round 2).
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape, planYearlyDealHtml, stkPeriodKind,
//             strykerCurrencyNoteHtml). The enrolled count (#hero-enrolled-count)
//             is filled by assets/main.js from publicStats/enrollment (82 fallback).
// Does two things:
//   1. Free vs Pro: prices and feature lines from the Firestore 'plans' docs,
//      picked the same way assets/pricing-hero.js picks them. The static HTML
//      fallback stays if the plans fail to load. Nothing is written.
//   2. The feature showcase tabs: click/tap a pill, arrow keys on the tab row,
//      or swipe the picture left/right on a phone. No autoplay. The active pill
//      is kept visible by setting scrollLeft on the pill row itself (never
//      scrollIntoView, which would also scroll the page).
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
      .catch(function (e) { console.error('TradeZoro demo F: plans failed to load', e); });
  }

  // ---- 2. tabs ----
  function wireTabs() {
    var row = $('.tf-tabs'), stage = $('#tf-stage');
    if (!row || !stage) return;
    var tabs = Array.prototype.slice.call(row.querySelectorAll('[role="tab"]'));
    var dots = Array.prototype.slice.call(document.querySelectorAll('.tf-dots i'));
    var cur = 0;
    function keepVisible(t) {
      var max = row.scrollWidth - row.clientWidth;
      if (max <= 0) return;
      var x = t.offsetLeft - (row.clientWidth - t.offsetWidth) / 2;
      row.scrollTo({ left: Math.max(0, Math.min(max, x)), behavior: 'smooth' });
    }
    function show(i, focus) {
      i = (i + tabs.length) % tabs.length;
      if (i === cur && !focus) return;
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var p = document.getElementById(t.getAttribute('aria-controls'));
        if (!p) return;
        if (on) {
          p.hidden = false;
          p.classList.remove('in'); void p.offsetWidth; p.classList.add('in');
        } else { p.hidden = true; p.classList.remove('in'); }
      });
      dots.forEach(function (d, k) { d.classList.toggle('on', k === i); });
      cur = i;
      keepVisible(tabs[i]);
      if (focus) tabs[i].focus({ preventScroll: true });
    }
    tabs.forEach(function (t, k) { t.addEventListener('click', function () { show(k); }); });
    row.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowRight') { e.preventDefault(); show(cur + 1, true); }
      else if (k === 'ArrowLeft') { e.preventDefault(); show(cur - 1, true); }
      else if (k === 'Home') { e.preventDefault(); show(0, true); }
      else if (k === 'End') { e.preventDefault(); show(tabs.length - 1, true); }
    });
    // swipe on the picture area (horizontal only; vertical scroll untouched)
    var sx = null, sy = 0;
    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { sx = null; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (sx === null) return;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(cur + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  function start() { wireTabs(); loadPlans(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
