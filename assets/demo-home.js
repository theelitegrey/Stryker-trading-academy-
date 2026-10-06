// Stryker Trading Academy: demo homepage motion (demo-home.html; unlisted, Owner order 2026-10-06).
//
// What it does:
//   - Hero parallax: five layers (glow, chart grid, laptop screen, floating GEX card + phone,
//     foreground candles + CALL WALL) move at different speeds on scroll, and gently with the
//     cursor (fine pointers) or phone tilt (deviceorientation, only where no permission prompt is
//     needed). On phones the depth is halved and cursor/tilt is skipped below 640px wide.
//   - Count-up stat strip, section reveals, bento cursor light, magnetic buttons.
//   - Sticky scroll story: the monitor on the left swaps to the screen of the step in view.
//   - Curriculum rail: arrow buttons + a progress thumb that follows the scroll position.
//   - GEX spotlight: real SPX 0DTE levels from /api/gex/levels/SPX?dte=0 (the public endpoint the
//     GEX page uses), "updated X min ago"; an illustrative price path bounces off the call wall.
//   - Scroll progress line under the nav; slim "Start free" dock on phones after the hero.
//
// Motion rules: transforms and opacity only; one rAF per scroll frame; the GEX loop runs only
// while its section is on screen and the tab is visible; keyframe loops pause off screen.
// prefers-reduced-motion: html.dh-anim is never added and nothing moves (CSS shows everything).
//
// Honesty: never "live" or "real-time"; levels are aged "updated X min ago"; the price path,
// candles, heatmap and replay bars are labelled illustrative/sample on the page.
//
// Depends on: demo-home.css. No libraries.
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var FINE = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  if (!REDUCE) root.classList.add('dh-anim');

  // ------------------------------------------------ sample visuals (seeded; labelled sample on the page)
  (function heat() {
    var el = $('#dh-heat'); if (!el) return;
    var r = rng(11), h = '';
    for (var i = 0; i < 20; i++) {
      var x = r(), cls = x < .22 ? '' : x < .68 ? 'u' : 'd';
      h += '<i class="' + cls + '" style="--k:' + i + ';--v:' + (0.35 + r() * 0.6).toFixed(2) + '"></i>';
    }
    el.innerHTML = h;
  })();
  (function replayBars() {
    var el = $('#dh-rp'); if (!el) return;
    var r = rng(5), h = '', p = 50;
    for (var i = 0; i < 26; i++) {
      var d = (r() - .45) * 18; p = clamp(p + d, 15, 90);
      h += '<i class="' + (d >= 0 ? 'u' : 'd') + (i >= 17 ? ' f' : '') + '" style="height:' + (12 + Math.abs(d) * 2.6 + p * .5).toFixed(0) + '%"></i>';
    }
    el.innerHTML = h;
  })();

  // ------------------------------------------------ reveals + count-up + visibility flags
  var counted = false;
  function countUp() {
    if (counted) return; counted = true;
    $$('[data-count]').forEach(function (el) {
      var to = +el.getAttribute('data-count');
      if (REDUCE) { el.textContent = to; return; }
      var t0 = performance.now(), dur = 1400;
      el.textContent = '0';
      (function step(now) {
        var k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 4);
        el.textContent = Math.round(to * e);
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }
  if ('IntersectionObserver' in window) {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in'); rio.unobserve(e.target);
        if (e.target.classList.contains('dh-stat')) countUp();
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    $$('.dh-rv').forEach(function (el) { rio.observe(el); });
    // pause keyframe loops in sections that are off screen
    var vio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle('is-vis', e.isIntersecting); });
    });
    $$('.dh-hero, .dh-end, .dh-gex, #dh-tools').forEach(function (el) { vio.observe(el); });
  } else {
    $$('.dh-rv').forEach(function (el) { el.classList.add('is-in'); }); countUp();
  }

  // ------------------------------------------------ GEX levels (real when the endpoint answers)
  var walls = null; // {call, zero, put} in svg y, filled when real numbers arrive (layout stays the same)
  (function () {
    var meta = $('#dh-gex-meta'); if (!meta) return;
    function fmt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
    function ago(sec) {
      if (!sec) return '';
      var m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
      if (m < 60) return 'updated ' + m + ' min ago';
      var h = Math.floor(m / 60);
      return h < 48 ? 'updated ' + h + ' h ago' : 'updated ' + Math.floor(h / 24) + ' d ago';
    }
    fetch('/api/gex/levels/SPX?dte=0', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || d.call_wall == null || d.put_wall == null) throw new Error('no levels');
      $('#dh-lv-call').textContent = fmt(d.call_wall);
      $('#dh-lv-put').textContent = fmt(d.put_wall);
      $('#dh-lv-zero').textContent = d.zero_gamma != null ? fmt(d.zero_gamma) : '–';
      if (d.zero_gamma != null && d.call_wall !== d.put_wall) {
        var f = clamp((d.call_wall - d.zero_gamma) / (d.call_wall - d.put_wall), 0.12, 0.88);
        var yz = (60 + f * 240).toFixed(1), ln = $('.g-zero'), tx = $('.t-zero');
        ln.setAttribute('y1', yz); ln.setAttribute('y2', yz); tx.setAttribute('y', (yz - 10).toFixed(1));
        zeroY = +yz;
      }
      var m = d.market || {}, closed = m.state && m.state !== 'open' && m.state !== 'stale', a = ago(m.options_ts);
      meta.textContent = 'SPX · 0DTE' + (a ? ' · ' + (closed ? 'last session, ' : '') + a : '');
    }).catch(function () {
      ['#dh-lv-call', '#dh-lv-zero', '#dh-lv-put'].forEach(function (id) { $(id).textContent = ''; });
      meta.textContent = 'Illustrative levels: the GEX endpoint did not answer. Open GEX for the real ones.';
    });
  })();

  // ------------------------------------------------ GEX price path: rallies, taps the call wall, fades
  var CALL_Y = 60, PUT_Y = 300, zeroY = 170;
  var gPath = $('#dh-gpath'), gDot = $('#dh-gdot'), gFlash = $('#dh-gflash');
  // one seeded path of 60 points between the walls, touching the call wall twice
  var PTS = (function () {
    var r = rng(29), pts = [], y = 250;
    var targets = [[0, 250], [14, 140], [20, CALL_Y + 1], [26, 120], [34, 190], [42, 100], [48, CALL_Y + 1], [54, 130], [59, 170]];
    for (var s = 0; s < targets.length - 1; s++) {
      var a = targets[s], b = targets[s + 1];
      for (var i = a[0]; i < b[0]; i++) {
        var k = (i - a[0]) / (b[0] - a[0]);
        y = a[1] + (b[1] - a[1]) * k + (r() - .5) * 18;
        if (i === b[0] - 1 && b[1] === CALL_Y + 1) y = CALL_Y + 1;
        pts.push([i * 10, clamp(y, CALL_Y + 1, PUT_Y - 6)]);
      }
    }
    pts.push([590, 170]);
    return pts;
  })();
  function pathTo(n) {
    var d = '';
    for (var i = 0; i < n; i++) d += (i ? 'L' : 'M') + PTS[i][0] + ' ' + PTS[i][1].toFixed(1);
    return d;
  }
  if (gPath) {
    if (REDUCE) { gPath.setAttribute('d', pathTo(PTS.length)); gDot.setAttribute('transform', 'translate(' + PTS[PTS.length - 1].join(' ') + ')'); }
  }
  var gexOn = false, gexT0 = 0, gexRaf = 0;
  function gexFrame(now) {
    gexRaf = 0;
    if (!gexOn || doc.hidden) return;
    var LOOP = 9000, t = ((now - gexT0) % LOOP) / LOOP; // 0..1
    var f = clamp(t / .85, 0, 1) * (PTS.length - 1), i = Math.floor(f), k = f - i;
    var a = PTS[i], b = PTS[Math.min(i + 1, PTS.length - 1)];
    var x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
    gPath.setAttribute('d', pathTo(i + 1) + 'L' + x.toFixed(1) + ' ' + y.toFixed(1));
    gDot.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    var near = y - CALL_Y < 6;
    if (near) { gFlash.setAttribute('cx', x.toFixed(1)); gFlash.style.opacity = '1'; gFlash.style.transform = 'scale(1.6)'; }
    else { gFlash.style.opacity = String(Math.max(0, (+gFlash.style.opacity || 0) - .04)); gFlash.style.transform = 'scale(1)'; }
    gPath.style.opacity = t > .9 ? String(1 - (t - .9) * 10) : '1';
    gexRaf = requestAnimationFrame(gexFrame);
  }
  if (!REDUCE && gPath && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      gexOn = es[0].isIntersecting;
      if (gexOn && !gexRaf) { if (!gexT0) gexT0 = performance.now(); gexRaf = requestAnimationFrame(gexFrame); }
    }).observe($('#dh-gex'));
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden && gexOn && !gexRaf) gexRaf = requestAnimationFrame(gexFrame); });
  }

  // ------------------------------------------------ sticky story (desktop: swap the monitor screen)
  (function () {
    var steps = $$('.dh-step'), imgs = $$('.dh-monitor-scr img'), dots = $$('.dh-story-dots i'), url = $('#dh-story-url');
    if (!steps.length || !('IntersectionObserver' in window)) return;
    var cur = 0;
    function set(n) {
      if (n === cur) return; cur = n;
      steps.forEach(function (s, i) { s.classList.toggle('is-on', i === n); });
      imgs.forEach(function (s, i) { s.classList.toggle('is-on', i === n); });
      dots.forEach(function (s, i) { s.classList.toggle('is-on', i === n); });
      if (url) url.textContent = steps[n].getAttribute('data-url');
    }
    var sio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) set(+e.target.getAttribute('data-s')); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { sio.observe(s); });
  })();

  // ------------------------------------------------ curriculum rail: arrows + progress thumb
  (function () {
    var rail = $('#dh-rail'), thumb = $('#dh-rail-thumb'); if (!rail) return;
    function card() { var c = $('.dh-ch', rail); return c ? c.offsetWidth + 12 : 240; }
    function upd() {
      var max = rail.scrollWidth - rail.clientWidth;
      var vis = rail.clientWidth / rail.scrollWidth, p = max > 0 ? rail.scrollLeft / max : 0;
      // thumb width = visible share, slid by progress (scaleX for length, translate via origin trick)
      thumb.style.transform = 'translateX(' + (p * (1 - vis) * 100).toFixed(2) + '%) scaleX(' + vis.toFixed(3) + ')';
    }
    thumb.style.transformOrigin = '0 50%';
    // translateX in % of the thumb's own (full-track) width, then scaled: keeps it inside the track
    var pend = false;
    rail.addEventListener('scroll', function () { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; upd(); }); }, { passive: true });
    addEventListener('resize', upd);
    upd();
    function go(dir) {
      var max = rail.scrollWidth - rail.clientWidth;
      rail.scrollTo({ left: clamp(rail.scrollLeft + dir * card() * 3, 0, max), behavior: REDUCE ? 'auto' : 'smooth' });
    }
    var p = $('#dh-rail-prev'), n = $('#dh-rail-next');
    if (p) p.addEventListener('click', function () { go(-1); });
    if (n) n.addEventListener('click', function () { go(1); });
  })();

  // ------------------------------------------------ cursor light on tiles, magnetic buttons, CTA spotlight
  if (FINE && !REDUCE) {
    var end = $('#dh-start'), spot = $('#dh-spot'), pendE = null, busy = false;
    doc.addEventListener('pointermove', function (e) {
      pendE = e; if (busy) return; busy = true;
      requestAnimationFrame(function () {
        busy = false; var ev = pendE; if (!ev) return;
        var t = ev.target.closest && ev.target.closest('.dh-tile');
        if (t) { var r = t.getBoundingClientRect(); t.style.setProperty('--mx', (ev.clientX - r.left).toFixed(0) + 'px'); t.style.setProperty('--my', (ev.clientY - r.top).toFixed(0) + 'px'); }
        if (end && spot) {
          var er = end.getBoundingClientRect();
          var inside = ev.clientY >= er.top && ev.clientY <= er.bottom && ev.clientX >= er.left && ev.clientX <= er.right;
          end.classList.toggle('is-lit', inside);
          if (inside) spot.style.transform = 'translate3d(' + (ev.clientX - er.left).toFixed(0) + 'px,' + (ev.clientY - er.top).toFixed(0) + 'px,0)';
        }
      });
    }, { passive: true });
    $$('.dh-mag').forEach(function (m) {
      var btn = m.firstElementChild, k = m.classList.contains('dh-mag-xl') ? 0.4 : 0.26;
      m.style.padding = '14px'; m.style.margin = '-14px';
      m.addEventListener('pointermove', function (e) {
        var r = m.getBoundingClientRect();
        btn.style.transform = 'translate3d(' + ((e.clientX - r.left - r.width / 2) * k).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * (k + .1)).toFixed(1) + 'px,0)';
      });
      m.addEventListener('pointerleave', function () { btn.style.transform = ''; });
    });
  }

  // ------------------------------------------------ scroll: progress line, hero parallax, phone dock
  var bar = $('#dh-bar'), hero = $('#dh-hero'), dock = $('#dh-dock');
  var layers = $$('.dh-layer').map(function (el) { return { el: el, d: +el.getAttribute('data-depth') || 0 }; });
  var px = 0, py = 0, tx = 0, ty = 0; // pointer / tilt offsets, -1..1 (eased)
  var heroVis = true, sPend = false;
  function small() { return innerWidth < 900; }
  function frame() {
    sPend = false;
    var y = scrollY, docH = root.scrollHeight - innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + (docH > 0 ? clamp(y / docH, 0, 1) : 0).toFixed(4) + ')';
    if (dock && hero) {
      var on = y > hero.offsetTop + hero.offsetHeight - 80 && y < docH - 260;
      if (on !== dock.classList.contains('is-on')) {
        dock.classList.toggle('is-on', on); dock.setAttribute('aria-hidden', on ? 'false' : 'true');
        var a = $('a', dock); if (a) a.tabIndex = on ? 0 : -1;
      }
    }
    if (REDUCE || !heroVis) return;
    tx += (px - tx) * .08; ty += (py - ty) * .08;
    var sm = small(), sc = sm ? .5 : 1, mv = sm ? 10 : 26;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      L.el.style.transform = 'translate3d(' + (tx * mv * L.d).toFixed(2) + 'px,' + (-y * L.d * .35 * sc + ty * mv * L.d).toFixed(2) + 'px,0)';
    }
    if (Math.abs(px - tx) > .002 || Math.abs(py - ty) > .002) req();
  }
  function req() { if (!sPend) { sPend = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', req, { passive: true });
  addEventListener('resize', req);
  if (hero && 'IntersectionObserver' in window) new IntersectionObserver(function (es) { heroVis = es[0].isIntersecting; if (heroVis) req(); }).observe(hero);
  if (!REDUCE) {
    if (FINE) addEventListener('pointermove', function (e) {
      if (!heroVis) return;
      px = clamp(e.clientX / innerWidth * 2 - 1, -1, 1); py = clamp(e.clientY / innerHeight * 2 - 1, -1, 1); req();
    }, { passive: true });
    // phone tilt, only where it needs no permission prompt (Android); iOS 13+ would need a tap-to-allow
    else if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
      addEventListener('deviceorientation', function (e) {
        if (!heroVis || e.gamma == null) return;
        px = clamp(e.gamma / 30, -1, 1); py = clamp((e.beta - 45) / 30, -1, 1); req();
      }, { passive: true });
    }
  }
  req();
})();
