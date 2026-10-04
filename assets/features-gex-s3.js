// Stryker Trading Academy — /features/gex-s3 preview ("Interactive dashboard")
// One real capture, 12 hotspots. Tap a hotspot, a chip or the arrows: the capture
// zooms (transform only) to that feature and its panel slides in. A short tour plays
// once the section is on screen and stops the moment the visitor touches anything.
// Reduced motion: no tour, no transitions; tapping still jumps straight to each view.
(function () {
  'use strict';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    var wrap = document.querySelector('[data-s3]');
    if (!wrap) return;
    var sec = wrap.closest('.s3');
    var frame = wrap.querySelector('[data-s3-frame]');
    var stage = wrap.querySelector('[data-s3-stage]');
    var panels = [].slice.call(wrap.querySelectorAll('.s3-panel'));
    var chips = [].slice.call(wrap.querySelectorAll('.s3-chip'));
    var dots = [].slice.call(wrap.querySelectorAll('.s3-dot'));
    var ovs = [].slice.call(wrap.querySelectorAll('.s3-o'));
    var tag = wrap.querySelector('.s3-tag');
    var bar = wrap.querySelector('[data-s3-bar]');
    var N = 12, cur = 0, sub = 0, subT = null, tourT = null, touched = false, seen = false;
    var DWELL = 6500;
    sec.setAttribute('data-reg', 'pos');
    if (!reduced) document.documentElement.classList.add('s3-anim');

    function regions(i) { var p = panels[i]; return i ? JSON.parse(p.getAttribute('data-r')) : null; }

    // fit a region [x,y,w,h] (fractions of the capture) into the frame
    function view(r) {
      var fw = frame.clientWidth, fh = frame.clientHeight, sw = fw, sh = stage.offsetHeight || fw * 3237 / 2024;
      var z0 = Math.min(1, fh / sh), z, tx, ty;
      if (!r) { z = z0; }
      else {
        z = Math.min(fw / (r[2] * sw), fh / (r[3] * sh)) * 0.94;
        z = Math.max(z0, Math.min(z, 3.6));
      }
      function fit(c, size, f) {               // centre c (px at z=1) in frame f, keep the capture covering it
        var t = f / 2 - z * c, span = z * size;
        if (span <= f) return (f - span) / 2;
        return Math.min(0, Math.max(f - span, t));
      }
      tx = fit(r ? (r[0] + r[2] / 2) * sw : sw / 2, sw, fw);
      ty = fit(r ? (r[1] + r[3] / 2) * sh : sh / 2, sh, fh);
      stage.style.setProperty('--z', z.toFixed(4));
      stage.style.setProperty('--tx', tx.toFixed(1) + 'px');
      stage.style.setProperty('--ty', ty.toFixed(1) + 'px');
    }

    function restartAnims(el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }

    function show(i) {
      cur = i; sub = 0; clearTimeout(subT);
      panels.forEach(function (p) {
        var on = +p.getAttribute('data-i') === i;
        p.classList.toggle('is-on', on); p.setAttribute('aria-hidden', on ? 'false' : 'true');
        if ('inert' in p) p.inert = !on;
      });
      chips.forEach(function (c) { c.setAttribute('aria-pressed', +c.getAttribute('data-i') === i ? 'true' : 'false'); });
      dots.forEach(function (d) { d.classList.toggle('is-on', +d.getAttribute('data-i') === i); });
      ovs.forEach(function (o) { var on = +o.getAttribute('data-f') === i; o.classList.toggle('is-on', on); if (on) restartAnims(o); });
      frame.classList.toggle('is-zoomed', i > 0);
      if (i > 0) {
        var name = panels[i].querySelector('h3').textContent;
        tag.querySelector('b').textContent = i; tag.querySelector('span').textContent = name;
        var rs = regions(i); view(rs[0]);
        // features that live in two places on the page pan to the second one
        if (rs.length > 1) subT = setTimeout(function () { sub = 1; view(rs[1]); }, reduced ? 0 : 2500);
        var chip = chips[i - 1];
        var strip = chip.parentNode;
        if (strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: chip.offsetLeft - 20, behavior: reduced ? 'auto' : 'smooth' });
      } else view(null);
    }

    function stopTour() { touched = true; clearTimeout(tourT); tourT = null; if (bar) bar.classList.remove('is-run'); }
    function tourStep() {
      if (touched) return;
      show(cur >= N ? 1 : cur + 1);
      if (bar) { bar.classList.remove('is-run'); void bar.offsetWidth; bar.style.setProperty('--dwell', DWELL / 1000 + 's'); bar.classList.add('is-run'); }
      tourT = setTimeout(tourStep, DWELL);
    }
    function startTour() { touched = false; clearTimeout(tourT); tourStep(); }
    function pick(i) { stopTour(); show(i); }

    chips.forEach(function (c) { c.addEventListener('click', function () { pick(+c.getAttribute('data-i')); }); });
    dots.forEach(function (d) { d.addEventListener('click', function (e) { e.stopPropagation(); pick(+d.getAttribute('data-i')); }); });
    wrap.querySelector('[data-s3-back]').addEventListener('click', function () { pick(0); });
    wrap.querySelectorAll('[data-s3-step]').forEach(function (b) {
      b.addEventListener('click', function () { var s = +b.getAttribute('data-s3-step'); pick(((cur - 1 + s + N) % N) + 1); });
    });
    var tb = wrap.querySelector('[data-s3-tour]');
    if (tb) tb.addEventListener('click', function () { startTour(); });
    wrap.querySelectorAll('.s3-reg button').forEach(function (b) {
      b.addEventListener('click', function () {
        stopTour();
        var v = b.getAttribute('data-v'); sec.setAttribute('data-reg', v);
        wrap.querySelectorAll('.s3-reg button').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-v') === v ? 'true' : 'false'); });
        if (cur !== 3) show(3);                       // the wash lives on the chart: show the flip
      });
    });
    wrap.querySelectorAll('.s3-how').forEach(function (d) { d.addEventListener('toggle', function () { if (d.open) stopTour(); }); });

    // swipe the capture left/right for next/previous
    var x0 = null, y0 = null;
    frame.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; stopTour(); }, { passive: true });
    frame.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) pick(((cur - 1 + (dx < 0 ? 1 : -1) + N) % N) + 1);
    }, { passive: true });
    frame.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') pick((cur % N) + 1);
      else if (e.key === 'ArrowLeft') pick(((cur - 2 + N) % N) + 1);
      else if (e.key === 'Escape') pick(0);
    });

    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { var rs = cur ? regions(cur) : null; view(rs ? rs[Math.min(sub, rs.length - 1)] : null); }, 120);
    });

    show(0);
    if (reduced || typeof IntersectionObserver !== 'function') { wrap.classList.add('is-playing'); return; }
    var r0 = frame.getBoundingClientRect();
    if (r0.top < innerHeight && r0.bottom > 0) wrap.classList.add('is-playing');
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (en.isIntersecting) wrap.classList.add('is-playing');
        if (en.isIntersecting && !seen) { seen = true; setTimeout(function () { if (!touched) startTour(); }, 1600); }
        if (!en.isIntersecting && tourT) { clearTimeout(tourT); tourT = null; if (bar) bar.classList.remove('is-run'); seen = false; }
      });
    }, { threshold: 0.3 });
    io.observe(frame);
    document.addEventListener('visibilitychange', function () { if (document.hidden && tourT) { clearTimeout(tourT); tourT = null; seen = false; } });
  });
})();
