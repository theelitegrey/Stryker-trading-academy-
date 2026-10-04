// Stryker — /features/gex-c preview ("Tile wall").
// 1. Tiles [data-gc] play their overlay once when they scroll into view, and
//    replay on tap / Enter / hover. 2. The regime toggle swaps the colour wash.
// Animations are gated on html.gc-anim, added only when the visitor has not
// asked for reduced motion; without it every overlay shows its final state.
(function () {
  var root = document.documentElement;
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function replay(el) {
    el.classList.remove('is-play');
    void el.offsetWidth; // restart CSS animations
    el.classList.add('is-play');
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Regime toggle works with or without motion.
    document.querySelectorAll('[data-gc-toggle]').forEach(function (box) {
      var btns = box.querySelectorAll('.gc-seg button');
      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          box.setAttribute('data-state', b.getAttribute('data-v'));
          btns.forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        });
      });
    });

    if (reduced || typeof IntersectionObserver !== 'function') return;
    root.classList.add('gc-anim');

    var tiles = document.querySelectorAll('[data-gc]');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-play'); io.unobserve(en.target); }
      });
    }, { threshold: 0.35 });

    tiles.forEach(function (t) {
      io.observe(t);
      t.addEventListener('click', function (e) { if (!e.target.closest('a,button')) replay(t); });
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); replay(t); } });
      if (window.matchMedia('(hover:hover)').matches) t.addEventListener('mouseenter', function () { replay(t); });
    });
  });
})();
