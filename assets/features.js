// Stryker Trading Academy — public feature pages (features*.html)
// Scroll-reveal: elements with .ft-reveal fade/rise in as they enter the
// viewport. Reduced-motion users (and browsers without IntersectionObserver)
// just see everything immediately — content never depends on the animation.
// With JS off or still downloading, everything is visible too: the hidden
// start state is gated on html.ft-rv, which only this file adds.

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

    // Content is visible by default; style.css only hides .ft-reveal under
    // html.ft-rv. Whatever is already on screen (it may have been readable
    // for seconds on a slow connection) is marked shown first, so adding
    // .ft-rv never blanks painted text. Only below-the-fold items fade in.
    var vh = window.innerHeight || document.documentElement.clientHeight;
    els.forEach(function (el, i) {
      if (el.getBoundingClientRect().top < vh) { el.classList.add('is-in'); return; }
      // Stagger siblings slightly so grids cascade instead of popping at once.
      el.style.transitionDelay = ((i % 4) * 70) + 'ms';
      io.observe(el);
    });
    document.documentElement.classList.add('ft-rv');
  });
})();
