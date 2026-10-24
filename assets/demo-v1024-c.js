// TradeZoro demo homepage variation C, "Bento playground" (demo-v1024-c.html)
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planIsArchived,
//             planEscape, stkPeriodKind). Styles: assets/demo-v1024-c.css.
//
// 1. Hero playground: chips swap the hero to the matching REAL screenshot and
//    a one-line explanation. Auto-advances every 4.5 s only while the hero is
//    in view; hover pauses, any tap/key on the chips stops it for good.
//    Reduced motion: no auto-advance.
// 2. Bento tiles: tap toggles the reveal layer (hover does it on desktop).
// 3. Free vs Pro tile: feature lines and prices from the live plans docs, the
//    same pick rule as pricing-hero.js (static HTML mirrors the live home's
//    fallback cards until then).
// 4. Enrolled count from publicStats/enrollment (82 shipped as the baseline).
// 5. Chapter rail arrow buttons, and scroll reveal.
(function () {
  'use strict';
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------ 1. hero playground
  var chips = $$('.bp-chip');
  var imgs = $$('.bp-screen img');
  var say = $('#bp-say-text');
  var tag = $('#bp-tag');
  var prog = $('#bp-prog');
  var chipRow = $('.bp-chips');
  var cur = 0, timer = null, stopped = reduce, inView = false, hovering = false;

  function show(i, fromUser) {
    cur = (i + chips.length) % chips.length;
    chips.forEach(function (c, k) {
      var on = k === cur;
      c.setAttribute('aria-selected', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    });
    var key = chips[cur].dataset.k;
    imgs.forEach(function (im) {
      var on = im.dataset.k === key;
      if (on && im.loading === 'lazy') im.loading = 'eager';
      im.classList.toggle('on', on);
    });
    if (say) {
      say.textContent = chips[cur].dataset.say;
      say.classList.remove('swap'); void say.offsetWidth; say.classList.add('swap');
    }
    if (tag) tag.textContent = chips[cur].dataset.tag;
    // keep the active chip visible in the chip row without moving the page
    if (chipRow) {
      var c = chips[cur];
      var target = c.offsetLeft - (chipRow.clientWidth - c.offsetWidth) / 2;
      var max = chipRow.scrollWidth - chipRow.clientWidth;
      chipRow.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: reduce || !fromUser && !inView ? 'auto' : 'smooth' });
    }
    restartProg();
  }
  function restartProg() {
    if (!prog) return;
    prog.classList.remove('run');
    if (stopped || !inView || hovering) return;
    void prog.offsetWidth; prog.classList.add('run');
  }
  function tick() {
    clearTimeout(timer);
    if (stopped || !inView || hovering) return;
    timer = setTimeout(function () { show(cur + 1); tick(); }, 4500);
  }
  function stopForGood() { stopped = true; clearTimeout(timer); if (prog) prog.classList.remove('run'); }

  if (chips.length) {
    chips.forEach(function (c, k) {
      c.addEventListener('click', function () { stopForGood(); show(k, true); });
    });
    chipRow.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); stopForGood(); show(cur + d, true); chips[cur].focus();
    });
    var play = $('.bp-play');
    play.addEventListener('mouseenter', function () { hovering = true; clearTimeout(timer); if (prog) prog.classList.remove('run'); });
    play.addEventListener('mouseleave', function () { hovering = false; restartProg(); tick(); });
    $('.bp-screen').addEventListener('touchstart', stopForGood, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        inView = es[0].isIntersecting;
        if (inView) { restartProg(); tick(); } else { clearTimeout(timer); if (prog) prog.classList.remove('run'); }
      }, { threshold: 0.35 }).observe(play);
    }
    show(0);
  }

  // ------------------------------------------------------------ 2. bento tap reveal
  $$('.bp-tile[data-tap]').forEach(function (t) {
    function toggle(e) {
      if (e.target.closest('a')) return;           // links inside the reveal still work
      var open = !t.classList.contains('open');
      $$('.bp-tile.open').forEach(function (o) { if (o !== t) { o.classList.remove('open'); o.setAttribute('aria-expanded', 'false'); } });
      t.classList.toggle('open', open);
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    t.addEventListener('click', toggle);
    t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  });

  // ------------------------------------------------------------ 3. Free vs Pro tile
  var planBox = $('#bp-plans');
  var P = null;
  function esc(s) { return (typeof planEscape === 'function') ? planEscape(s) : String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function paintPlan(which) {
    $$('.bp-toggle button', planBox).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.p === which ? 'true' : 'false'); });
    $$('[data-pane]', planBox).forEach(function (p) { p.hidden = p.dataset.pane !== which; });
  }
  if (planBox) {
    $$('.bp-toggle button', planBox).forEach(function (b) { b.addEventListener('click', function () { paintPlan(b.dataset.p); }); });
  }
  function fillPlans() {
    if (!planBox || typeof db === 'undefined' || typeof strykerLoadPlans !== 'function') return;
    var fx = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
    Promise.all([strykerLoadPlans(), fx]).then(function (res) {
      var all = res[0] || [];
      var priceOf = function (p) { return p ? planSaleInfo(p).price : 0; };
      var vis = all.filter(function (p) { return !p.hidden && !planIsArchived(p); })
        .sort(function (a, b) { return ((+a.rank || 0) - (+b.rank || 0)) || (priceOf(a) - priceOf(b)); });
      var free = vis.find(function (p) { return !priceOf(p); }) || null;
      var pro = vis.find(function (p) { return p.featured && priceOf(p) > 0; }) || vis.filter(function (p) { return priceOf(p) > 0; }).pop() || null;
      [['free', free], ['pro', pro]].forEach(function (pair) {
        var plan = pair[1]; if (!plan) return;
        var pane = $('[data-pane="' + pair[0] + '"]', planBox); if (!pane) return;
        var s = planSaleInfo(plan);
        var per = (typeof stkPeriodKind === 'function' && stkPeriodKind(plan.period) === 'year') ? 'year' : 'month';
        $('.bp-price', pane).innerHTML = '<span class="amt">' + esc(planMoneyDisplay(s.price)) + '</span><span class="per">/ ' + per + '</span>' +
          (s.active ? ' <s>' + esc(planMoneyDisplay(s.full)) + '</s>' : '');
        var feats = (plan.features || []).filter(Boolean);
        if (feats.length) $('.bp-feats', pane).innerHTML = feats.slice(0, 6).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('');
        if (pair[0] === 'pro') { var a = $('a.btn', pane); if (a) a.href = 'checkout?plan=' + encodeURIComponent(plan.id); }
      });
    }).catch(function () { /* static fallback stays */ });
  }

  // ------------------------------------------------------------ 4. enrolled count
  function fillEnrolled() {
    if (typeof db === 'undefined' || !db) return;
    db.collection('publicStats').doc('enrollment').get().then(function (doc) {
      var n = doc.exists ? Number(doc.data().count) : NaN;
      if (!isFinite(n) || n <= 0) return;
      $$('[data-enrolled]').forEach(function (el) { el.textContent = Math.round(n).toLocaleString(); });
    }).catch(function () {});
  }

  // ------------------------------------------------------------ 5. rail arrows + reveal
  var rail = $('#bp-rail');
  $$('[data-rail]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!rail) return;
      var step = Math.max(240, rail.clientWidth * 0.8) * (+b.dataset.rail);
      rail.scrollBy({ left: step, behavior: reduce ? 'auto' : 'smooth' });
    });
  });

  var rises = $$('.bp-rise');
  if (!reduce && 'IntersectionObserver' in window && rises.length) {
    var vh = window.innerHeight || 800;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.1 });
    rises.forEach(function (el) { if (el.getBoundingClientRect().top < vh) el.classList.add('in'); else io.observe(el); });
    document.documentElement.classList.add('bp-rv');
  }

  function boot() { fillPlans(); fillEnrolled(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
