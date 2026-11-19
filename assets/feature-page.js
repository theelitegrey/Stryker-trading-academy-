// TradeZoro: shared FEATURE PAGE behaviour (/features/<tool> pages built from tools/feature-pages/build.py).
// Purpose: 1) scroll reveals (.fpg-rv), 2) the "How it works" step story ([data-fpg-steps]): on desktop (>= 900px) the
// sticky frame crossfades to the screenshot of the step nearest the middle of the screen and the progress line fills;
// phones / reduced motion / no JS keep each step's own image inline (the default markup), 3) the feature index
// ([data-fpg-index]): counts features and groups from the list itself and highlights the group in view.
// Deps: assets/feature-page.css. No libraries. transform/opacity only; prefers-reduced-motion = static page.
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var $$ = function (s, r) { return [].slice.call((r || doc).querySelectorAll(s)); };
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  var hasIO = typeof IntersectionObserver === 'function';

  // ---- 1. reveals: hidden only while JS runs with motion allowed; a 1.5 s safety net shows everything
  if (!rm && hasIO) {
    root.classList.add('fpg-anim');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.fpg-rv').forEach(function (el) { io.observe(el); });
    setTimeout(function () { $$('.fpg-rv').forEach(function (el) { el.classList.add('is-in'); }); }, 1500);
  }

  // ---- 3. feature index counts (from the list, never typed by hand)
  $$('[data-fpg-index]').forEach(function (ix) {
    var groups = $$('.fpg-ix-group', ix), n = 0;
    groups.forEach(function (g) {
      var c = $$('li', g).length; n += c;
      var a = ix.querySelector('a[href="#' + g.id + '"] [data-fpg-gcount]'); if (a) a.textContent = c;
      var h = g.querySelector('[data-fpg-gcount]'); if (h) h.textContent = c;
    });
    var sec = ix.closest('section') || doc;
    $$('[data-fpg-count]', sec).forEach(function (el) { el.textContent = n + ' features · ' + groups.length + ' groups'; });
    var links = $$('.fpg-ix-nav a', ix), nav = ix.querySelector('.fpg-ix-nav'), tq = null;
    // phones (< 900px): the group chips are tabs that show one group at a time (keeps the page short)
    try { tq = matchMedia('(max-width:899px)'); } catch (e) {}
    function show(id) {
      groups.forEach(function (g) { g.classList.toggle('is-cur', g.id === id); });
      links.forEach(function (l) { l.classList.toggle('is-on', l.getAttribute('href') === '#' + id); });
    }
    function tabMode() { root.classList.toggle('fpg-ixtabs', !!(tq && tq.matches)); }
    if (groups.length) show(groups[0].id);
    groups.forEach(function (g) {
      var c = $$('li', g).length; if (c <= 6) return;
      g.classList.add('is-short');
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'fpg-ix-more'; b.textContent = 'Show all ' + c;
      b.addEventListener('click', function () { g.classList.remove('is-short'); });
      g.appendChild(b);
    });
    tabMode();
    if (tq) { tq.addEventListener ? tq.addEventListener('change', tabMode) : tq.addListener(tabMode); }
    links.forEach(function (l) {
      l.addEventListener('click', function (ev) {
        if (!root.classList.contains('fpg-ixtabs')) return;
        ev.preventDefault();
        show(l.getAttribute('href').slice(1));
        // bring the chip into view inside its own scroller only (never scrollIntoView: it drags the page sideways)
        var max = nav.scrollWidth - nav.clientWidth;
        nav.scrollLeft = Math.max(0, Math.min(max, l.offsetLeft - nav.offsetLeft - 16));
      });
    });
    if (!hasIO) return;
    var gio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting || root.classList.contains('fpg-ixtabs')) return;
        links.forEach(function (l) { l.classList.toggle('is-on', l.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    groups.forEach(function (g) { gio.observe(g); });
  });

  // ---- 2. step story
  var st = doc.querySelector('[data-fpg-steps]');
  if (!st || rm) return;
  var steps = $$('.fpg-step', st), slides = $$('.fpg-slide', st), line = st.querySelector('.fpg-line'), cap = st.querySelector('.fpg-stage-cap');
  var list = st.querySelector('.fpg-step-list'), mq = null, cur = -1, queued = false;
  try { mq = matchMedia('(min-width:900px)'); } catch (e) {}
  if (!steps.length || steps.length !== slides.length) return;
  function set(i) {
    if (i === cur) return; cur = i;
    steps.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
    slides.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
    if (cap) cap.textContent = slides[i].getAttribute('data-cap') || '';
  }
  function tick() {
    queued = false;
    if (!root.classList.contains('fpg-story')) return;
    var mid = innerHeight / 2, best = 0, bd = 1e9;
    steps.forEach(function (s, k) { var r = s.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - mid); if (d < bd) { bd = d; best = k; } });
    set(best);
    if (line) {
      var lr = list.getBoundingClientRect(), p = (mid - lr.top) / Math.max(1, lr.height);
      line.style.setProperty('--fpg-p', Math.max(0, Math.min(1, p)).toFixed(3));
    }
  }
  function q() { if (!queued) { queued = true; raf(tick); } }
  function mode() { root.classList.toggle('fpg-story', !mq || mq.matches); cur = -1; q(); }
  if (mq) { mq.addEventListener ? mq.addEventListener('change', mode) : mq.addListener(mode); }
  addEventListener('scroll', q, { passive: true }); addEventListener('resize', q);
  mode();
})();
