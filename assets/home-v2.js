// TradeZoro homepage v2 PREVIEW (demo-home-v2.html, Owner 19 Nov): page-only motion, no libraries.
//   1. Hero light object: adds .go once the hero is on screen (CSS draws candles, path, GEX walls, light fan).
//   2. Fanned montage: adds .in when scrolled into view (side shots settle outward).
//   3. Scroll reveals (.hv-rv -> .in), IntersectionObserver only.
//   4. Sticky verb story (desktop >= 900 px): the step for the current scroll position gets .on. Phone: stacked cards, no JS.
//   5. Persona tabs: WAI-ARIA tabs (click, arrow keys, Home/End).
// prefers-reduced-motion (html.hv-rm, set in <head>): everything shows in its final state; the story still switches steps.
// Depends on: assets/home-v2.css. Header/menu/theme come from assets/home-a.js + assets/theme.js.
(function () {
  var doc = document, root = doc.documentElement;
  var hasIO = typeof IntersectionObserver === 'function';
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  function once(el, cls, th) {
    if (!el) return;
    if (!hasIO || root.classList.contains('hv-rm')) { el.classList.add(cls); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); } });
    }, { threshold: th || 0.15 });
    io.observe(el);
  }

  function init() {
    once(doc.querySelector('[data-hv-art]'), 'go', 0.2);
    once(doc.querySelector('[data-hv-fan]'), 'in', 0.35);
    $$('.hv-rv').forEach(function (el) { once(el, 'in', 0.12); });

    // sticky story: pick the step from how far the section has scrolled
    var story = doc.querySelector('[data-hv-story]');
    if (story) {
      var steps = $$('.hv-step', story), cur = 0, tick = false;
      var wide = window.matchMedia('(min-width:900px)');
      var pick = function () {
        tick = false;
        if (!wide.matches) return;
        var r = story.getBoundingClientRect(), run = r.height - window.innerHeight;
        var p = run > 0 ? Math.min(Math.max(-r.top / run, 0), 0.999) : 0;
        var i = Math.floor(p * steps.length);
        if (i === cur) return;
        steps[cur].classList.remove('on'); steps[i].classList.add('on'); cur = i;
      };
      var onScroll = function () { if (!tick) { tick = true; requestAnimationFrame(pick); } };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      pick();
    }

    // persona tabs
    var list = doc.querySelector('[data-hv-tabs]');
    if (list) {
      var tabs = $$('[role="tab"]', list);
      var show = function (t, focus) {
        tabs.forEach(function (x) {
          var on = x === t, p = doc.getElementById(x.getAttribute('aria-controls'));
          x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1;
          if (p) p.hidden = !on;
        });
        if (focus) t.focus();
      };
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { show(t); });
        t.addEventListener('keydown', function (e) {
          var n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
          if (n === undefined) return;
          e.preventDefault(); show(tabs[(n + tabs.length) % tabs.length], true);
        });
      });
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
