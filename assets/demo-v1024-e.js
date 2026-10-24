// TradeZoro demo homepage variation E "Clean grid"
// (demo-v1024-e.html only; Owner order 2026-10-24, homepage variations round 2).
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape, planYearlyDealHtml, stkPeriodKind,
//             strykerCurrencyNoteHtml). The enrolled count (#hero-enrolled-count)
//             is filled by assets/main.js from publicStats/enrollment (82 fallback).
// Does three things:
//   1. Free vs Pro: prices and feature lines from the Firestore 'plans' docs,
//      picked the same way the other demo pages pick them. The static HTML
//      fallback stays if the plans fail to load. Nothing is written.
//   2. Feature cards with data-shot: tap/click opens a dialog with the real
//      screenshot; on a mouse device, hover shows a small floating preview.
//   3. Grid groups fade in once when they scroll into view (skipped under
//      prefers-reduced-motion).
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return (typeof planEscape === 'function') ? planEscape(s) : String(s); };
  var IMG = 'assets/images/demo-v1024-e/';
  var V = (function () { var m = /\?v=(\d+)/.exec(($('link[href*="demo-v1024-e.css"]') || {}).href || ''); return m ? '?v=' + m[1] : ''; })();
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      .catch(function (e) { console.error('TradeZoro demo E: plans failed to load', e); });
  }

  // ---- 2. previews ----
  // Phone: cards with data-m="w,h" use a tighter crop (<shot>-m.webp) so the
  // labels stay readable at 390 px.
  // The hover preview (forceM) uses the tight crop too, so it stays readable small.
  function useM(card, forceM) { return card.hasAttribute('data-m') && (forceM || window.innerWidth < 640); }
  function src(card, forceM) { return IMG + card.getAttribute('data-shot') + (useM(card, forceM) ? '-m' : '') + '.webp' + V; }
  function dims(card, forceM) {
    if (useM(card, forceM)) { var m = card.getAttribute('data-m').split(','); return [+m[0], +m[1]]; }
    return [+card.getAttribute('data-w') || 1200, +card.getAttribute('data-h') || 616];
  }
  function wirePreviews() {
    var dlg = $('#ge-dlg'), img = $('#ge-dlg-img'), title = $('#ge-dlg-t');
    var cards = document.querySelectorAll('.ge-has');
    var canDialog = dlg && typeof dlg.showModal === 'function';
    var pop = null;
    function hidePop() { if (pop) pop.classList.remove('on'); }
    cards.forEach(function (c) {
      c.addEventListener('click', function () {
        if (!canDialog) { window.open(src(c), '_blank', 'noopener'); return; }
        hidePop();
        img.removeAttribute('src');
        img.src = src(c);
        var d = dims(c);
        img.width = d[0]; img.height = d[1];
        img.alt = c.getAttribute('data-alt') || '';
        title.textContent = (c.querySelector('b') || {}).textContent || '';
        dlg.showModal();
      });
    });
    if (dlg) {
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
      });
    }

    // hover preview, mouse devices only
    var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!fine) return;
    pop = document.createElement('div');
    pop.className = 'ge-pop'; pop.setAttribute('aria-hidden', 'true');
    pop.innerHTML = '<img alt="">';
    document.body.appendChild(pop);
    var pimg = pop.firstChild;
    function place(c) {
      var d = dims(c, true), r = c.getBoundingClientRect();
      var top = 76, gap = 12, vh = window.innerHeight;
      var above = r.top - gap - top, below = vh - r.bottom - gap - 12;
      var room = Math.max(above, below);
      var w = Math.min(d[0] < d[1] ? 400 : 560, window.innerWidth - 24, room * d[0] / d[1]);
      var h = w * d[1] / d[0];
      pop.style.width = w + 'px';
      var x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
      var y = above >= below ? r.top - gap - h : r.bottom + gap;
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    }
    window.addEventListener('scroll', hidePop, { passive: true });
    cards.forEach(function (c) {
      c.addEventListener('mouseenter', function () { pimg.src = src(c, true); place(c); pop.classList.add('on'); });
      c.addEventListener('mouseleave', hidePop);
    });
  }

  // ---- 3. in-view reveal ----
  function wireReveal() {
    if (reduce || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('ge-js');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.ge-group').forEach(function (g) { io.observe(g); });
  }

  function start() { wireReveal(); wirePreviews(); loadPlans(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
