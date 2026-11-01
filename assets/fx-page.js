// TradeZoro: shared behaviour for the /features/* pages built from the cm-* system (curriculum, models, indicators, community, hub, ...).
// 1. Reveal safety net: content is visible by default; creators-motion.js hides .cm-rv only while JS runs and motion is allowed.
//    Here every .cm-rv in or near the viewport is revealed on load/scroll/resize (no IntersectionObserver threshold to miss on fast scrolls),
//    and after 1.5 s everything is revealed, so a fast scroller, a crawler or a full-page capture never sees blank space.
// 2. Scroll story ([data-fx-story]): on desktop (>=900px, motion allowed) the screenshot stage is sticky beside the steps and follows the
//    step nearest the middle of the screen; the section is exactly as tall as the steps. Phones, reduced motion and no-JS show each
//    step's screenshot inline under its text (the default markup). No libraries.
(function () {
  'use strict';
  var doc = document, raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  var rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var $$ = function (s, r) { return [].slice.call((r || doc).querySelectorAll(s)); };

  // ---- 1. reveal safety net
  var queued = false;
  function sweep(all) {
    queued = false;
    var lim = innerHeight + 320;
    $$('.cm-rv:not(.is-in)').forEach(function (e) { if (all || e.getBoundingClientRect().top < lim) e.classList.add('is-in'); });
  }
  function q() { if (!queued) { queued = true; raf(function () { sweep(false); }); } }
  addEventListener('scroll', q, { passive: true }); addEventListener('resize', q); addEventListener('load', q);
  sweep(false);
  setTimeout(function () { sweep(true); }, 1500);

  // ---- 2. scroll story
  var st = doc.querySelector('[data-fx-story]');
  if (!st) return;
  var lis = $$('.cm-steps-list li', st), ls = $$('.fx-sl', st), cur = -1, mq = null;
  try { mq = matchMedia('(min-width:900px)'); } catch (e) {}
  function set(i) {
    if (i === cur) return; cur = i;
    ls.forEach(function (f, k) { f.classList.toggle('on', k === i); });
    lis.forEach(function (li, k) { li.classList.toggle('on', k === i); li.classList.toggle('done', k < i); });
  }
  function pick() {
    var y = innerHeight * 0.5, i = 0;
    lis.forEach(function (li, k) { if (li.getBoundingClientRect().top < y) i = k; });
    set(i);
  }
  var tick = false;
  function onScroll() { if (!tick) { tick = true; raf(function () { tick = false; pick(); }); } }
  function mode() {
    var on = !rm && mq && mq.matches && ls.length === lis.length;
    st.classList.toggle('fx-pin', !!on);
    if (on) { cur = -1; pick(); }
  }
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);
  if (mq && mq.addEventListener) mq.addEventListener('change', mode);
  mode();
})();
