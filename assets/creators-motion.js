// TradeZoro Creator Hub feature page (/features/creators): all motion in one small file, no libraries.
// Scroll reveals, hero parallax + toasts, the "build your community" scroll story, candle chart, flow diagrams,
// course unlock, dashboard tab cycle, tilt + magnetic buttons, count-ups.
// Everything pauses when offscreen (IntersectionObserver). prefers-reduced-motion: no motion, content shown in its final state.
// Without JS the page is fully readable (hidden start states are gated on html.cm-js, set below).
// Depends on: assets/creators-page.css. Used by: features/creators.html.
(function () {
  var doc = document, root = doc.documentElement;
  var rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var fine = false; try { fine = matchMedia('(hover:hover) and (pointer:fine)').matches; } catch (e) {}
  var hasIO = typeof IntersectionObserver === 'function';
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };

  // visible-only helper: fn(isVisible) is called on every change
  function watch(el, fn, margin) {
    if (!el) return;
    if (!hasIO) { fn(true); return; }
    new IntersectionObserver(function (es) { fn(es[es.length - 1].isIntersecting); }, { rootMargin: margin || '80px 0px' }).observe(el);
  }

  // ------------------------------------------------------------ chart + diagrams are built before reveal (static fallback = drawn)
  var NS = 'http://www.w3.org/2000/svg';
  function mk(n, a, p) { var e = doc.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  function buildChart(box) {
    var svg = $('svg', box), W = 640, H = 320, g = $('.cm-grid', svg), cg = $('.cm-candles', svg), mg = $('.cm-marks', svg);
    for (var i = 1; i < 6; i++) mk('line', { x1: 0, x2: W, y1: i * 50 + 10, y2: i * 50 + 10, class: 'gl' }, g);
    var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var n = 44, step = 13.2, x0 = 22, px = 190, cs = [];
    // a made-up price path: drift, a sweep below a low, a bounce through a gap. Illustration only.
    var path = [0, 3, 2, 6, 5, 9, 8, 6, 9, 12, 10, 14, 12, 9, 7, 8, 5, 3, -2, -8, -4, 2, 6, 10, 9, 14, 18, 16, 21, 24, 22, 27, 25, 29, 33, 31, 34, 38, 36, 40, 42, 41, 45, 47];
    var prev = path[0];
    for (var j = 0; j < n; j++) {
      var o = prev, c = path[j] + (rnd() - 0.5) * 3, hi = Math.max(o, c) + rnd() * 5 + 1, lo = Math.min(o, c) - rnd() * 5 - 1;
      var Y = function (v) { return px - v * 3.3 + 20; };
      var up = c >= o, x = x0 + j * step;
      var gr = mk('g', { class: 'cd ' + (up ? 'u' : 'd'), style: '--k:' + j }, cg);
      mk('line', { x1: x, x2: x, y1: Y(hi), y2: Y(lo) }, gr);
      mk('rect', { x: x - 3.6, width: 7.2, y: Math.min(Y(o), Y(c)), height: Math.max(2, Math.abs(Y(o) - Y(c))), rx: 1 }, gr);
      cs.push({ x: x, hi: Y(hi), lo: Y(lo), o: Y(o), c: Y(c) });
      prev = c;
    }
    var sweepX = cs[19].x, sweepY = cs[19].lo;
    var lvl = mk('line', { x1: x0 - 8, x2: W - 14, y1: cs[16].lo + 6, y2: cs[16].lo + 6, class: 'mk lvl', style: '--k:' + (n + 2) }, mg);
    mk('rect', { x: cs[24].x - 4, y: cs[25].lo - 26, width: 150, height: 26, rx: 3, class: 'mk fvg', style: '--k:' + (n + 6) }, mg);
    var sw = mk('g', { class: 'mk swp', style: '--k:' + (n + 4), transform: 'translate(' + sweepX + ' ' + (sweepY + 12) + ')' }, mg);
    mk('circle', { r: 8 }, sw); mk('path', { d: 'M-3 2 L0 -3 L3 2', class: 'ar' }, sw);
    var tg = mk('g', { class: 'mk tag', style: '--k:' + (n + 8) }, mg);
    var last = cs[n - 1]; mk('circle', { cx: last.x, cy: last.c, r: 4, class: 'live' }, tg);
    var cnt = n + 10; box.style.setProperty('--cm-total', (cnt * 38 + 400) + 'ms');
  }

  // ------------------------------------------------------------ boot
  root.classList.add('cm-js'); if (rm) root.classList.add('cm-rm');
  function ready(fn) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () {
    var chart = $('[data-chart]'); if (chart) buildChart(chart);

    // -------------------------------------------------------- reveals
    var rvs = $$('.cm-rv');
    if (rm || !hasIO) rvs.forEach(function (e) { e.classList.add('is-in'); });
    else {
      var vh = innerHeight, io = new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
      }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
      rvs.forEach(function (e) { if (e.getBoundingClientRect().top < vh) e.classList.add('is-in'); else io.observe(e); });
      root.classList.add('cm-rv-on');
    }

    // -------------------------------------------------------- count-ups
    function countUp(el, to, ms) {
      if (rm) { el.textContent = to; return; }
      var t0 = null; el.textContent = '0';
      (function f(t) { if (t0 === null) t0 = t; var p = clamp((t - t0) / ms, 0, 1), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e); if (p < 1) raf(f); })(performance.now());
    }

    // -------------------------------------------------------- scroll progress + hero scroll parallax (CSS timeline when supported)
    var tl = false; try { tl = CSS.supports('animation-timeline: scroll()'); } catch (e) {}
    var bar = $('[data-scroll-bar]'), hero = $('.cm-hero'), heroVis = true, ticking = false;
    var layers = $$('.cm-fl-main,.cm-fl-ind,.cm-fl-lesson,.cm-fl-event,.cm-fl-role');
    var depthK = { 'cm-fl-main': 0.04, 'cm-fl-ind': 0.1, 'cm-fl-lesson': 0.16, 'cm-fl-event': 0.12, 'cm-fl-role': 0.2 };
    function onScroll() {
      ticking = false;
      var y = scrollY, h = doc.documentElement.scrollHeight - innerHeight;
      if (bar && !tl) bar.style.transform = 'scaleX(' + (h > 0 ? clamp(y / h, 0, 1) : 0) + ')';
      if (heroVis && !rm && !tl) layers.forEach(function (l) {
        var k = 0; for (var c in depthK) if (l.classList.contains(c)) k = depthK[c];
        l.style.translate = '0 ' + (-Math.min(y, 700) * k).toFixed(1) + 'px';
      });
      story && storyTick();
    }
    addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(onScroll); } }, { passive: true });
    addEventListener('resize', function () { if (!ticking) { ticking = true; raf(onScroll); } });
    watch(hero, function (v) { heroVis = v; }, '0px');

    // -------------------------------------------------------- hero: pointer parallax + toasts
    var scene = $('[data-scene]');
    if (scene && fine && !rm) {
      var px = $$('.cm-px', scene), tx = 0, ty = 0, cx = 0, cy = 0, run = false;
      scene.addEventListener('pointermove', function (e) {
        var r = scene.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
        if (!run) { run = true; raf(loop); }
      });
      scene.addEventListener('pointerleave', function () { tx = 0; ty = 0; if (!run) { run = true; raf(loop); } });
      var loop = function () {
        cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
        px.forEach(function (p) { var d = +p.getAttribute('data-depth') || 0; p.style.transform = 'translate3d(' + (-cx * d).toFixed(2) + 'px,' + (-cy * d).toFixed(2) + 'px,0)'; });
        if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) raf(loop); else run = false;
      };
    }
    var toasts = $$('.cm-toast'), ti = -1, tTimer = null, sceneVis = true;
    function nextToast() {
      toasts.forEach(function (t) { t.classList.remove('show'); });
      ti = (ti + 1) % toasts.length; toasts[ti].classList.add('show');
    }
    function toastLoop() { clearInterval(tTimer); if (rm || !sceneVis) return; nextToast(); tTimer = setInterval(nextToast, 3400); }
    if (toasts.length) {
      if (rm) toasts[1].classList.add('show');
      else setTimeout(function () { watch(scene, function (v) { sceneVis = v; if (v) toastLoop(); else clearInterval(tTimer); }); }, 1700);
    }

    // -------------------------------------------------------- scroll story
    var story = $('[data-story]'), stage = $('[data-stage]'), caps = $('[data-story-cap]'), sbar = $('[data-story-bar]');
    var lis = story ? $$('.cm-steps-list li', story) : [], TH = [0, 0.14, 0.34, 0.54, 0.74], cur = -1, counted = false, sIn = false;
    var stepTxt = lis.map(function (li) { return $('b', li).textContent + '. ' + $('p', li).textContent; });
    function setStep(s) {
      if (s === cur) return; cur = s;
      for (var i = 0; i < 5; i++) stage.classList.toggle('s' + i, i <= s && s >= 0);
      lis.forEach(function (li, i) { li.classList.toggle('on', i === s); li.classList.toggle('done', i < s); });
      if (caps) caps.textContent = s >= 0 ? (s + 1) + ' of 5. ' + stepTxt[s] : '';
      if (s >= 1 && !counted) { counted = true; $$('[data-count]', stage).forEach(function (c) { countUp(c, +c.getAttribute('data-count'), 900); }); }
    }
    function storyTick() {
      if (!story || !story.classList.contains('on')) return;
      var r = story.getBoundingClientRect(), total = r.height - innerHeight, p = clamp(-r.top / Math.max(1, total), 0, 1);
      if (sbar) sbar.style.transform = 'scaleX(' + p + ')';
      if (!sIn) { setStep(-1); return; }
      var s = 0; for (var i = 0; i < TH.length; i++) if (p >= TH[i]) s = i;
      setStep(s);
    }
    if (story) {
      if (rm || !hasIO) { stage.className += ' s0 s1 s2 s3 s4'; lis.forEach(function (li) { li.classList.add('done'); }); }
      else {
        story.classList.add('on');
        watch(story, function (v) { sIn = v; if (v) { stage.classList.add('iv'); } storyTick(); }, '-15% 0px');
        storyTick();
      }
    }

    // -------------------------------------------------------- chart
    if (chart) {
      if (rm || !hasIO) chart.classList.add('go', 'vis');
      else watch(chart, function (v) { chart.classList.toggle('vis', v); if (v) chart.classList.add('go'); }, '0px');
    }

    // -------------------------------------------------------- flow diagrams (SMIL dot paused offscreen)
    $$('[data-flow]').forEach(function (f) {
      var svg = $('svg', f);
      if (rm) { if (svg.pauseAnimations) svg.pauseAnimations(); f.classList.add('static'); return; }
      watch(f, function (v) {
        f.classList.toggle('vis', v);
        if (svg.pauseAnimations) { if (v) svg.unpauseAnimations(); else svg.pauseAnimations(); }
      }, '0px');
    });

    // -------------------------------------------------------- number reel (0%)
    $$('[data-reel]').forEach(function (r) { if (rm) r.classList.add('is-in'); else watch(r, function (v) { if (v) r.classList.add('is-in'); }, '-10% 0px'); });

    // -------------------------------------------------------- course unlock
    var course = $('[data-course]');
    if (course) {
      var rows = $$('.cm-lessons li', course), ring = $('.cm-ring', course), rn = $('[data-ring-n]', course), cdone = false;
      var setRing = function (k) { ring.style.setProperty('--p', k / rows.length); rn.textContent = k + '/' + rows.length; };
      if (rm) { rows.forEach(function (r) { r.classList.add('ok'); }); setRing(rows.length); }
      else { setRing(0); watch(course, function (v) {
        if (!v || cdone) return; cdone = true;
        rows.forEach(function (r, i) { setTimeout(function () { r.classList.add('ok'); setRing(i + 1); }, 500 + i * 520); });
      }, '-12% 0px'); }
    }

    // -------------------------------------------------------- dashboard tab cycle
    var app = $('[data-app]');
    if (app && !rm) {
      var tabs = $$('.cm-side li', app), ai = 0, aT = null;
      watch(app, function (v) {
        clearInterval(aT); if (!v) return;
        aT = setInterval(function () { tabs[ai].classList.remove('on'); ai = (ai + 1) % tabs.length; tabs[ai].classList.add('on'); app.classList.remove('sw'); void app.offsetWidth; app.classList.add('sw'); }, 1600);
      }, '0px');
    }

    // -------------------------------------------------------- tilt + magnetic (desktop pointers only)
    if (fine && !rm) {
      $$('[data-tilt]').forEach(function (c) {
        c.addEventListener('pointermove', function (e) {
          var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
          c.style.transform = 'perspective(900px) rotateX(' + (-y * 5).toFixed(2) + 'deg) rotateY(' + (x * 6).toFixed(2) + 'deg) translateY(-2px)';
        });
        c.addEventListener('pointerleave', function () { c.style.transform = ''; });
      });
      $$('[data-mag]').forEach(function (b) {
        b.addEventListener('pointermove', function (e) {
          var r = b.getBoundingClientRect(); b.style.translate = ((e.clientX - r.left - r.width / 2) * 0.12).toFixed(1) + 'px ' + ((e.clientY - r.top - r.height / 2) * 0.2).toFixed(1) + 'px';
        });
        b.addEventListener('pointerleave', function () { b.style.translate = ''; });
      });
    }
    onScroll();
  });
})();
