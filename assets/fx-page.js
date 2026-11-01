// TradeZoro: scroll story for the /features/* pages (screenshots swap as you scroll). Used by features/*.html with [data-fx-story].
// Reveals, parallax, the progress bar and the card tilt come from assets/creators-motion.js. No libraries.
// Markup: section.cm-story.fx-story[data-fx-story][style=--n:N] > .cm-sticky ... ol.cm-steps-list li (one per step),
//         .fx-stage .fx-sv figure.fx-sl (one per step), [data-fx-cap], [data-fx-bar].
// Under reduced motion (or no IntersectionObserver) the story stays a plain list and every figure is stacked as a normal block.
(function () {
  'use strict';
  var doc = document, st = doc.querySelector('[data-fx-story]');
  if (!st) return;
  var rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lis = [].slice.call(st.querySelectorAll('.cm-steps-list li')), ls = [].slice.call(st.querySelectorAll('.fx-sl'));
  var cap = st.querySelector('[data-fx-cap]'), bar = st.querySelector('[data-fx-bar]'), cur = -2;
  function set(s) {
    if (s === cur) return; cur = s;
    ls.forEach(function (f, i) { f.classList.toggle('on', i === Math.max(0, s)); });
    lis.forEach(function (li, i) { li.classList.toggle('on', i === s); li.classList.toggle('done', i < s); });
    if (cap) cap.textContent = s >= 0 ? (s + 1) + ' of ' + lis.length + '. ' + lis[s].querySelector('b').textContent + '. ' + lis[s].querySelector('p').textContent : '';
  }
  if (rm || typeof IntersectionObserver !== 'function') {
    ls.forEach(function (f, i) { f.style.position = 'relative'; f.classList.add('on'); if (i) f.style.marginTop = '12px'; });
    var sv = st.querySelector('.fx-sv'); if (sv) { sv.style.aspectRatio = 'auto'; sv.style.overflow = 'visible'; }
    lis.forEach(function (li) { li.classList.add('done'); });
    return;
  }
  st.classList.add('on');
  var tick = false;
  function run() {
    tick = false;
    var b = st.getBoundingClientRect(), total = b.height - innerHeight, p = Math.max(0, Math.min(1, -b.top / Math.max(1, total)));
    if (bar) bar.style.transform = 'scaleX(' + p + ')';
    set(b.top > innerHeight * 0.5 ? -1 : Math.min(lis.length - 1, Math.floor(p * (lis.length + 0.5))));
  }
  addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(run); } }, { passive: true });
  addEventListener('resize', run); run();
})();
