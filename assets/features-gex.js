// Stryker Trading Academy — /features/gex page motion
// Loaded only by features/gex.html, after assets/features.js (which owns the
// .ft-reveal fade-ins) and assets/features-gex.css.
//
// CONTRACT (same as home-motion / model-motion):
//  - Nothing is hidden unless this script runs AND the visitor has not asked
//    for reduced motion. html.fg-anim is the only switch for hidden start
//    states; without it every graphic is already in its finished state.
//  - Whatever is already on screen when the page loads is marked playing
//    BEFORE fg-anim is added, so painted content is never blanked.
//  - Sections play while visible and reset when they leave, so loops never run
//    off-screen (battery) and the draw-in plays again on the way back.
//  - No libraries. One IntersectionObserver, one timer, both torn down when
//    not needed.

(function () {
  'use strict';

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var root = document.documentElement;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var plays = [].slice.call(document.querySelectorAll('[data-fg-play]'));
    var vh = window.innerHeight || document.documentElement.clientHeight;

    // ---- timeline (works with or without motion) ------------------------
    var tl = document.querySelector('[data-fg-tl]');
    var steps = tl ? [].slice.call(tl.querySelectorAll('.fg-tl-step')) : [];
    var active = 0, timer = null, userTook = false, tlVisible = false;
    var DWELL = 5000;

    function setActive(i) {
      active = i;
      steps.forEach(function (s, n) {
        var on = n === i;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-pressed', on ? 'true' : 'false');
        // restart the progress bar animation
        var bar = s.querySelector('.fg-bar');
        if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      });
    }
    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function startTimer() {
      stopTimer();
      if (reduced || userTook || !tlVisible || steps.length < 2) return;
      timer = setInterval(function () { setActive((active + 1) % steps.length); }, DWELL);
    }
    if (tl && steps.length) {
      tl.style.setProperty('--tl', (DWELL / 1000) + 's');
      steps.forEach(function (s, n) {
        s.addEventListener('click', function () { userTook = true; stopTimer(); setActive(n); });
      });
      setActive(0);
    }

    // ---- reduced motion / no observer: finished static state ------------
    if (reduced || typeof IntersectionObserver !== 'function') {
      plays.forEach(function (el) { el.classList.add('is-playing'); });
      return;               // fg-anim is never added: nothing is hidden, nothing moves
    }

    // ---- motion path -----------------------------------------------------
    plays.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) el.classList.add('is-playing');
    });
    root.classList.add('fg-anim');

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var el = en.target;
        if (en.isIntersecting) {
          el.classList.add('is-playing');
          if (el === tl) { tlVisible = true; startTimer(); }
        } else {
          el.classList.remove('is-playing');
          if (el === tl) { tlVisible = false; stopTimer(); }
        }
      });
    }, { threshold: 0.18 });
    plays.forEach(function (el) { io.observe(el); });
    if (tl) {
      var r0 = tl.getBoundingClientRect();
      tlVisible = r0.top < vh && r0.bottom > 0;
      startTimer();
    }

    // pause everything when the tab is hidden
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopTimer(); else startTimer();
    });

    // ---- mock replay ------------------------------------------------------
    var mock = document.querySelector('[data-fg-mock]');
    var replay = document.getElementById('fg-replay');
    if (mock && replay) {
      replay.addEventListener('click', function () {
        mock.classList.remove('is-playing');
        void mock.offsetWidth;
        mock.classList.add('is-playing');
      });
    }
  });
})();
