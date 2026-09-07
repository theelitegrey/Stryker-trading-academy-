// Stryker Trading Academy — public feature pages (features*.html)
// Scroll-reveal: elements with .ft-reveal fade/rise in as they enter the
// viewport. Reduced-motion users (and browsers without IntersectionObserver)
// just see everything immediately — content never depends on the animation.

(function () {
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function showAll(){
    document.querySelectorAll('.ft-reveal').forEach(function (el) { el.classList.add('is-in'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var els = document.querySelectorAll('.ft-reveal');
    if (!els.length) return;
    if (reduced || typeof IntersectionObserver !== 'function') { showAll(); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    els.forEach(function (el, i) {
      // Stagger siblings slightly so grids cascade instead of popping at once.
      el.style.transitionDelay = ((i % 4) * 70) + 'ms';
      io.observe(el);
    });
  });
})();
