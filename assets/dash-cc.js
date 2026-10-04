// Stryker Trading Academy — dashboard "Command Center" layer (variation A)
//
// Purpose: the presentation-only motion for dashboard-user.html: hero aurora
// canvas, animated progress ring (fed from the #stat-chapters text that
// dashboard.js already writes, so no data hook changes), the market-open
// countdown in the hero (from StrykerMarketHours, a calendar clock, not market
// data), the date line, and scroll reveals for the sections.
//
// Motion rules: prefers-reduced-motion jumps every animation to its end state;
// the aurora pauses when the hero is off-screen or the tab is hidden, runs at
// a lower resolution and ~30 fps on phones.
//
// Depends on: markup in dashboard-user.html (.cc-*), assets/market-hours.js
// (optional; the clock tile stays "--" without it).

(function () {
  'use strict';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function $(id) { return document.getElementById(id); }

  // ---- date line ------------------------------------------------------------
  function setDate() {
    var el = $('cc-date');
    if (el) el.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ---- progress ring --------------------------------------------------------
  var C = 2 * Math.PI * 50, ringShown = -1;
  function setRing(pct) {
    var fg = $('cc-ring-fg'), txt = $('cc-ring-pct');
    if (!fg || !txt || pct === ringShown) return;
    var from = ringShown < 0 ? 0 : ringShown;
    ringShown = pct;
    fg.style.strokeDasharray = C.toFixed(1);
    fg.style.strokeDashoffset = (C * (1 - pct / 100)).toFixed(1);
    var wrap = fg.closest('.cc-ring-wrap');
    if (wrap) wrap.setAttribute('aria-label', pct + '% of the core path complete');
    if (reduced) { txt.textContent = pct + '%'; return; }
    var t0 = performance.now(), dur = 1100;
    (function tick(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      txt.textContent = Math.round(from + (pct - from) * e) + '%';
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  function readChapters() {
    var el = $('stat-chapters');
    if (!el) return;
    var m = /(\d+)\s*\/\s*(\d+)/.exec(el.textContent || '');
    if (m && +m[2] > 0) setRing(Math.round(+m[1] / +m[2] * 100));
  }

  // ---- market countdown -----------------------------------------------------
  function tickClock() {
    var MH = window.StrykerMarketHours, b = $('cc-mkt'), sub = $('cc-mkt-sub');
    if (!MH || !b) return;
    var now = Date.now(), st = MH.status(now);
    if (!st) { b.textContent = 'Closed'; return; }
    var left = MH.fmtLeft(st.until - now);
    b.textContent = left;
    if (sub) sub.textContent = st.open ? 'US market closes in' : 'US market opens in';
    var li = b.closest('.cc-clock');
    if (li) li.classList.toggle('is-open', !!st.open);
  }

  // ---- aurora ---------------------------------------------------------------
  function aurora() {
    var cv = $('cc-aurora');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d'), hero = cv.parentNode;
    var phone = document.documentElement.getAttribute('data-device') === 'mobile' || window.innerWidth < 640;
    var scale = phone ? 0.25 : 0.4;            // blurred blobs: low-res canvas is invisible-cost
    var w = 0, h = 0, visible = true, raf = 0, last = 0, t = 0;
    var blobs = [
      { c: '3,201,136', x: .18, y: .25, r: .55, sx: .11, sy: .07, ph: 0 },
      { c: '0,173,181', x: .72, y: .35, r: .6, sx: .08, sy: .1, ph: 2 },
      { c: '19,0,90', x: .5, y: .9, r: .7, sx: .06, sy: .05, ph: 4 },
      { c: '245,197,66', x: .9, y: .05, r: .3, sx: .09, sy: .06, ph: 1 }
    ];
    function size() {
      var r = hero.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width * scale)); h = Math.max(1, Math.round(r.height * scale));
      cv.width = w; cv.height = h;
      draw();
    }
    function draw() {
      var light = document.documentElement.getAttribute('data-theme') === 'light';
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
      for (var i = 0; i < blobs.length; i++) {
        var b = blobs[i];
        var x = (b.x + Math.sin(t * b.sx + b.ph) * .12) * w;
        var y = (b.y + Math.cos(t * b.sy + b.ph) * .15) * h;
        var r = b.r * Math.max(w, h);
        var a = (i === 3 ? .16 : .32) * (light ? .55 : 1);
        var g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(' + b.c + ',' + a + ')');
        g.addColorStop(1, 'rgba(' + b.c + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }
    var frameGap = phone ? 1000 / 30 : 1000 / 45;
    function loop(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      if (now - last >= frameGap) { t += (now - last) / 1000; if (t > 1e5) t = 0; last = now; draw(); }
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && !reduced) { last = performance.now(); raf = requestAnimationFrame(loop); } }
    size();
    window.addEventListener('resize', function () { clearTimeout(aurora._rz); aurora._rz = setTimeout(size, 150); });
    document.addEventListener('stryker:theme', draw);
    if (reduced) return;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) start(); }).observe(hero);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
    start();
  }

  // ---- scroll reveal --------------------------------------------------------
  function reveal() {
    var els = document.querySelectorAll('.cc-reveal');
    if (reduced || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('is-in'); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach(function (e) { io.observe(e); });
    // safety: nothing stays invisible if the observer never fires
    setTimeout(function () { els.forEach(function (e) { e.classList.add('is-in'); }); }, 2500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.cc')) return;
    setDate();
    reveal();
    aurora();
    var sc = $('stat-chapters');
    if (sc && 'MutationObserver' in window) new MutationObserver(readChapters).observe(sc, { childList: true, characterData: true, subtree: true });
    readChapters();
    tickClock();
    setInterval(tickClock, 1000);
  });
})();
