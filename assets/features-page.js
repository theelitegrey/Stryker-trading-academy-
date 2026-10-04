// Stryker Trading Academy — shared motion for the /features/<name> pages
// (features/gex.html and every page built from the feature-page template).
// Loaded after assets/features.js, which owns the .ft-reveal fade-ins.
// No libraries. No innerHTML: only textContent and class/attribute changes.
//
// CONTRACT
//  - Default markup is the FINISHED state. Hidden start states only apply under
//    html.fp-anim, which this script adds only when the visitor has not asked
//    for reduced motion (and IntersectionObserver exists).
//  - Whatever is already on screen at load is marked playing BEFORE fp-anim is
//    added, so painted content is never blanked.
//  - Transform / opacity only. [data-fp-play] blocks get .is-playing while on
//    screen and lose it when they leave, so loops never run off-screen.
//  - Count-ups only ever show numbers already printed in the real capture:
//    the finished text is in the HTML, data-to repeats it, data-from (optional)
//    is where the count starts.
//
// HOOKS (see stryker-notes/reports/features-pages/TEMPLATE.md)
//  [data-fp-play]  hero terminal, flow diagrams: toggles .is-playing
//  [data-fp-row]   showcase rows: .fp-in once revealed, .fp-act on the media
//                  while on screen, count-up of .sx-num b
//  [data-fp-ix]    index-nav links, highlighted for the row under mid-screen
//  [data-fp-tl]    3-step timeline: auto-advances while visible, click to pick
//
// DRAGON BACKGROUND
//  After window load this script appends assets/dragon-bg.js (same ?v= build),
//  so every page built on this template gets the background with no extra tag.
//  The dragon script loads its own CSS and skips reduced-data / low-end devices.
//  Opt a page out with <body data-no-dragon>.
(function () {
  'use strict';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var hasIO = typeof IntersectionObserver === 'function';
  var root = document.documentElement;

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function all(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }

  function countUp(el) {
    if (reduced || el._fpDone) return; el._fpDone = 1;
    var to = el.getAttribute('data-to'); if (!to) return;
    var dec = (to.split('.')[1] || '').length, commas = to.indexOf(',') > -1;
    var end = parseFloat(to.replace(/,/g, ''));
    var fromAttr = el.getAttribute('data-from');
    var start = fromAttr ? parseFloat(fromAttr.replace(/,/g, '')) : end * 0.985;
    if (!isFinite(end) || !isFinite(start)) return;
    function fmt(v) { return commas ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec); }
    var t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / 1150); k = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(start + (end - start) * k);
      if (k < 1) requestAnimationFrame(step); else el.textContent = to;
    }
    requestAnimationFrame(step);
  }

  ready(function () {
    var vh = window.innerHeight || root.clientHeight;
    function onScreen(el) { var r = el.getBoundingClientRect(); return r.top < vh && r.bottom > 0; }

    // ---- timeline (works with or without motion) -------------------------
    var tl = document.querySelector('[data-fp-tl]');
    var steps = tl ? all('.fg-tl-step', tl) : [];
    var active = 0, timer = null, userTook = false, tlVisible = false, DWELL = 5000;
    function setActive(i) {
      active = i;
      steps.forEach(function (s, n) {
        var on = n === i;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    if (steps.length) {
      tl.style.setProperty('--tl', (DWELL / 1000) + 's');
      steps.forEach(function (s, n) { s.addEventListener('click', function () { userTook = true; stopTimer(); setActive(n); }); });
      setActive(0);
    }

    var plays = all('[data-fp-play]');
    var rows = all('[data-fp-row]');

    // ---- cards + string: one empty pulse element per rows container --------
    var lists = all('.sx-rows');
    lists.forEach(function (l) {
      var i = document.createElement('i');
      i.className = 'sx-pulse'; i.setAttribute('aria-hidden', 'true');
      l.insertBefore(i, l.firstChild);
    });

    // ---- reduced motion / no observer: finished static state -------------
    if (reduced || !hasIO) {
      plays.forEach(function (el) { el.classList.add('is-playing'); });
      rows.forEach(function (r) {
        r.classList.add('fp-in');
        var m = r.querySelector('.sx-media'); if (m) m.classList.add('fp-act');
      });
      return; // fp-anim is never added: nothing hidden, nothing moves
    }

    // ---- motion path ------------------------------------------------------
    function play(el) {
      if (el.classList.contains('is-playing')) return;
      el.classList.add('is-playing');
      all('[data-to]', el).forEach(countUp);
    }
    plays.forEach(function (el) { if (onScreen(el)) play(el); });
    rows.forEach(function (r) { if (onScreen(r)) { r.classList.add('fp-in'); var m = r.querySelector('.sx-media'); if (m) m.classList.add('fp-act'); } });
    root.classList.add('fp-anim');

    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        var el = en.target;
        if (en.isIntersecting) { play(el); if (el === tl) { tlVisible = true; startTimer(); } }
        else { el.classList.remove('is-playing'); if (el === tl) { tlVisible = false; stopTimer(); } }
      });
    }, { threshold: 0.18 });
    plays.forEach(function (el) { io.observe(el); });
    if (tl) { if (plays.indexOf(tl) < 0) io.observe(tl); tlVisible = onScreen(tl); startTimer(); }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopTimer(); else startTimer(); });

    // ---- showcase rows ------------------------------------------------------
    if (rows.length) {
      var rio = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          var m = en.target.querySelector('.sx-media');
          if (en.isIntersecting) {
            en.target.classList.add('fp-in'); if (m) m.classList.add('fp-act');
            var b = en.target.querySelector('.sx-num b'); if (b) countUp(b);
          } else if (m) { m.classList.remove('fp-act'); }
        });
      }, { threshold: 0.3 });
      // sticky index: highlight the row under the middle of the screen
      var links = {}, idxBox = document.querySelector('.sx-index div');
      all('[data-fp-ix]').forEach(function (a) { links[a.getAttribute('data-fp-ix')] = a; });
      function mark(id) {
        for (var k in links) links[k].classList.toggle('on', k === id);
        var a = links[id];
        if (a && idxBox) idxBox.scrollTo({ left: Math.max(0, a.offsetLeft - 16), behavior: 'smooth' });
      }
      var mio = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { if (en.isIntersecting) mark(en.target.getAttribute('data-fp-row')); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      rows.forEach(function (r) { rio.observe(r); mio.observe(r); });
    }

    // ---- string pulse runs only while the rows are on screen --------------
    if (lists.length) {
      var lio = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { en.target.classList.toggle('is-live', en.isIntersecting); });
      });
      lists.forEach(function (l) { lio.observe(l); });
    }

    // ---- 3D tilt: fine pointers only, rAF-throttled, max 6deg -------------
    var fine = false;
    try { fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
    if (fine) {
      rows.forEach(function (r) {
        var box = null, px = 0, py = 0, raf = 0;
        function apply() {
          raf = 0; if (!box) return;
          if (r._fpStale) { r._fpStale = 0; box = r.getBoundingClientRect(); }
          var x = (px - box.left) / box.width - 0.5, y = (py - box.top) / box.height - 0.5;
          r.style.setProperty('--fp-ry', (x * 12).toFixed(2) + 'deg');   // ±6
          r.style.setProperty('--fp-rx', (-y * 12).toFixed(2) + 'deg');
        }
        r.addEventListener('pointerenter', function (e) {
          if (e.pointerType !== 'mouse') return;
          box = r.getBoundingClientRect(); r.classList.add('is-tilt');
        });
        r.addEventListener('pointermove', function (e) {
          if (!box) return; px = e.clientX; py = e.clientY;
          if (!raf) raf = requestAnimationFrame(apply);
        });
        r.addEventListener('pointerleave', function () {
          box = null; if (raf) { cancelAnimationFrame(raf); raf = 0; }
          r.classList.remove('is-tilt');
          r.style.removeProperty('--fp-rx'); r.style.removeProperty('--fp-ry');
        });
      });
      // the cached box goes stale when the page scrolls under a still pointer
      window.addEventListener('scroll', function () {
        rows.forEach(function (r) { if (r.classList.contains('is-tilt')) r._fpStale = 1; });
      }, { passive: true });
    }
  });

  // ---- dragon background: fetched only after load, never blocks the page ---
  (function () {
    var me = document.currentScript;
    var v = me && /[?&]v=([^&]+)/.exec(me.src || '');
    function add() {
      if (document.body && document.body.hasAttribute('data-no-dragon')) return;
      if (document.querySelector('script[src*="dragon-bg.js"]')) return;
      var s = document.createElement('script');
      s.src = '/assets/dragon-bg.js' + (v ? '?v=' + v[1] : '');
      s.async = true;
      document.body.appendChild(s);
    }
    if (document.readyState === 'complete') add();
    else window.addEventListener('load', add, { once: true });
  })();
})();
