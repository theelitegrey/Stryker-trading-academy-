// Stryker Trading Academy: DEMO homepage, variation C "light editorial bento"
// (demo-bento-c.html only). Owner order 2026-10-06. Unlisted demo page.
//
// What it does:
//   - Theme toggle: light is the default; stores 'day' / 'night' in the same
//     localStorage key the site uses (stryker_theme).
//   - Scroll reveal: IntersectionObserver adds .bc-in once to each .bc-rv
//     element (tiles fade and rise in; the chapter bars grow).
//   - Count-up: the big true numbers (64, 70+, 8, 10, 4, 3) count up once
//     when first seen. They are fixed product facts, not data.
//   - Parallax: elements with data-par drift gently with scroll. One rAF
//     loop, only while some parallax element is on screen and the tab is
//     visible. Transforms only.
//   - Session clock: assets/market-hours.js (StrykerMarketHours.sessionLabel),
//     a calendar clock, not market data. Ticks once a second while visible.
// With prefers-reduced-motion nothing moves: no reveal, no count, no parallax,
// no float; final values are shown at once.
//
// Depends on: assets/market-hours.js (window.StrykerMarketHours).
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $$ = function (s) { return Array.prototype.slice.call(doc.querySelectorAll(s)); };
  var IO = 'IntersectionObserver' in window;
  if (!REDUCE && IO) root.classList.add('bc-js');

  // ------------------------------------------------------------ theme
  var tbtn = doc.getElementById('bc-theme');
  if (tbtn) tbtn.addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') !== 'dark';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('stryker_theme', dark ? 'night' : 'day'); } catch (e) {}
    var m = doc.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#000000' : '#f5f5f7');
  });
  if (root.getAttribute('data-theme') === 'dark') {
    var m0 = doc.querySelector('meta[name="theme-color"]'); if (m0) m0.setAttribute('content', '#000000');
  }

  // ------------------------------------------------------------ count-up
  function fmtNum(el, v) { el.textContent = v + (el.getAttribute('data-suffix') || ''); }
  function countUp(el) {
    var to = +el.getAttribute('data-count') || 0, t0 = 0, dur = 1200 + Math.min(to, 64) * 6;
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      fmtNum(el, Math.round(to * e));
      if (k < 1) requestAnimationFrame(step);
    }
    fmtNum(el, 0);
    requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ reveal
  if (!REDUCE && IO) {
    var rio = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        el.classList.add('bc-in');
        Array.prototype.forEach.call(el.querySelectorAll('.bc-num[data-count]'), countUp);
        rio.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    $$('.bc-rv').forEach(function (el) { rio.observe(el); });
  }

  // ------------------------------------------------------------ parallax
  var parEls = $$('[data-par]');
  if (!REDUCE && IO && parEls.length) {
    var vis = new Set(), raf = 0, lastY = -1;
    var hero = doc.querySelector('.bc-hero');
    function frame() {
      raf = 0;
      if (!vis.size || doc.hidden) return;
      var y = window.scrollY;
      if (y !== lastY) {
        lastY = y;
        var vh = window.innerHeight;
        vis.forEach(function (el) {
          var r = el.getBoundingClientRect();
          var c = r.top + r.height / 2 - vh / 2;          // distance from viewport centre
          var k = +el.getAttribute('data-par') || 0;
          var lim = window.innerWidth < 700 ? 10 : 24;     // captions sit lim+ px below each frame
          var d = Math.max(-lim, Math.min(lim, c * k));
          el.style.transform = 'translate3d(0,' + d.toFixed(1) + 'px,0)';
        });
      }
    }
    function kick() { if (!raf && vis.size) raf = requestAnimationFrame(frame); }
    var pio = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) vis.add(en.target); else vis.delete(en.target); });
      lastY = -1; kick();
    });
    parEls.forEach(function (el) { pio.observe(el); });
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', function () { lastY = -1; kick(); }, { passive: true });

    // pause the CSS float when the hero stage is off-screen
    if (hero) new IntersectionObserver(function (ents) {
      hero.classList.toggle('bc-paused', !ents[0].isIntersecting);
    }).observe(hero);
  }

  // ------------------------------------------------------------ session clock
  var MH = window.StrykerMarketHours;
  var head = doc.getElementById('bc-clock-head'), cnt = doc.getElementById('bc-count'),
      nxt = doc.getElementById('bc-clock-next'), dot = doc.getElementById('bc-dot'),
      sess = $$('#bc-sess li'), clockTile = doc.getElementById('bc-clock');
  var clockTimer = 0;
  function tick() {
    if (!MH || !MH.sessionLabel) return;
    var now = Date.now(), L = MH.sessionLabel(now);
    head.textContent = L.head;
    dot.classList.toggle('on', !!L.open);
    sess.forEach(function (li) { li.classList.toggle('on', L.sessions.indexOf(li.getAttribute('data-s')) >= 0); });
    if (L.next) {
      cnt.textContent = MH.fmtClock(L.next.at - now);
      var t = '';
      try { t = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date(L.next.at)); } catch (e) {}
      nxt.textContent = 'until ' + L.next.name + ' opens' + (t ? ' (' + t + ' your time)' : '') + '.';
    } else { cnt.textContent = ''; }
  }
  function startClock() { if (!clockTimer) { tick(); clockTimer = setInterval(tick, 1000); } }
  function stopClock() { clearInterval(clockTimer); clockTimer = 0; }
  if (clockTile) {
    tick();
    if (IO) new IntersectionObserver(function (ents) {
      if (ents[0].isIntersecting && !doc.hidden) startClock(); else stopClock();
    }).observe(clockTile);
    else startClock();
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) stopClock();
      else { var r = clockTile.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) startClock(); }
    });
  }
})();
