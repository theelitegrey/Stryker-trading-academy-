// Stryker Trading Academy: homepage Curriculum section, stat + preview bento (build 454)
//
// Ported from /demo-curriculum variation D (assets/demo-curriculum.js, "D stats").
//   - the stat numbers count up once when first seen ([data-count])
//   - spotlight follows the pointer on fine pointers (rAF-throttled)
//   - the phone-float CSS loop pauses while the grid is off-screen (.hcb-off)
// prefers-reduced-motion: no count-up, no spotlight; numbers stay as shipped.
//
// The "1–10 free" figures are re-set from the Free plan's chapterAccess by
// assets/pricing-hero.js ([data-free-ch-range]); nothing here touches them.
//
// Depends on: nothing (style.css tokens, home-curriculum-bento.css).
// Replaces assets/curriculum-path.js on index.html (file kept, unused there).

(function () {
  'use strict';
  var grid = document.getElementById('hcb-grid');
  if (!grid) return;
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hasIO = 'IntersectionObserver' in window;

  if (hasIO) {
    new IntersectionObserver(function (es) {
      es.forEach(function (en) { grid.classList.toggle('hcb-off', !en.isIntersecting); });
    }, { rootMargin: '80px 0px' }).observe(grid);
  }

  if (fine && !reduced) {
    $$('.hcb-tile', grid).forEach(function (t) {
      var raf = 0, ev = null;
      t.addEventListener('pointermove', function (e) {
        ev = e;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = t.getBoundingClientRect();
          t.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
          t.style.setProperty('--my', (ev.clientY - r.top) + 'px');
        });
      });
    });
  }

  if (!reduced && hasIO) {
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        cio.unobserve(en.target);
        var el = en.target, to = +el.getAttribute('data-count'), start = 0;
        if (!(to > 0)) return;
        function f(t) {
          if (!start) start = t;
          var k = Math.min(1, (t - start) / 900);
          el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
          if (k < 1) requestAnimationFrame(f);
        }
        requestAnimationFrame(f);
      });
    }, { threshold: 0.6 });
    $$('[data-count]', grid).forEach(function (el) { cio.observe(el); });
  }
})();
