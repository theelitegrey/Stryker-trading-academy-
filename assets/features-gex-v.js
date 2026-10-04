// Stryker Trading Academy — /features/gex design previews A/B/C (gex-a/b/c.html)
// Shared motion for the three preview variants. No libraries.
//
// CONTRACT (same as features-gex.js):
//  - Default markup is the FINISHED state. Hidden start states only apply
//    under html.gv-anim, which this script adds only when the visitor has not
//    asked for reduced motion.
//  - Transform / opacity only. Sections play while on screen ([data-gv-play]
//    gets .is-playing) and reset when they leave, so loops never run off-screen.
//  - Count-ups only ever show numbers already printed in the real capture
//    (data-to on the element; the finished text is in the HTML).
(function () {
  'use strict';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var root = document.documentElement;

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  function countUp(el) {
    var to = parseFloat(el.getAttribute('data-to'));
    var dec = (el.getAttribute('data-to').split('.')[1] || '').length;
    var from = parseFloat(el.getAttribute('data-from') || (to * 0.985));
    var dur = 1200, t0 = null;
    function fmt(v) { return v.toFixed(dec); }
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur); k = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
    }
    requestAnimationFrame(step);
  }

  ready(function () {
    // ---- tap toggles (C tiles, regime toggle); work with or without motion
    document.querySelectorAll('[data-gv-tap]').forEach(function (t) {
      t.addEventListener('click', function () {
        t.classList.remove('is-tap'); void t.offsetWidth; t.classList.add('is-tap');
      });
    });
    document.querySelectorAll('[data-gv-toggle]').forEach(function (g) {
      var btns = [].slice.call(g.querySelectorAll('button[data-v]'));
      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          g.setAttribute('data-state', b.getAttribute('data-v'));
          btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        });
      });
    });

    // ---- story steps (B): which step is in the middle of the screen
    var story = document.querySelector('[data-gv-story]');
    if (story && typeof IntersectionObserver === 'function') {
      var stage = story.querySelector('.gv-stage');
      var steps = [].slice.call(story.querySelectorAll('[data-step]'));
      var sio = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          if (!en.isIntersecting) return;
          var s = en.target.getAttribute('data-step');
          stage.setAttribute('data-step', s);
          steps.forEach(function (x) { x.classList.toggle('is-on', x === en.target); });
        });
      }, { rootMargin: '-45% 0px -45% 0px' });
      steps.forEach(function (s) { sio.observe(s); });
    }

    if (reduced || typeof IntersectionObserver !== 'function') return;

    var plays = [].slice.call(document.querySelectorAll('[data-gv-play]'));
    var vh = window.innerHeight || root.clientHeight;
    function play(el) {
      if (el.classList.contains('is-playing')) return;
      el.classList.add('is-playing');
      el.querySelectorAll('[data-to]').forEach(countUp);
    }
    // already on screen at load: mark playing BEFORE hiding anything
    plays.forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top < vh && r.bottom > 0) play(el); });
    root.classList.add('gv-anim');
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (en.isIntersecting) play(en.target);
        else en.target.classList.remove('is-playing');
      });
    }, { threshold: 0.2 });
    plays.forEach(function (el) { io.observe(el); });
  });
})();
