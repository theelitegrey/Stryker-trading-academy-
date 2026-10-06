// Stryker Trading Academy: Features hub as a neon bento page (features-bento.html only).
// Owner order 2026-10-06: "Create new feature page with this bento grids, make it beautiful and
// crazy, add big hero bento style CTA etc." Unlisted preview (noindex, not in nav/sitemap/pages.json);
// the live features.html is untouched until the Owner approves a swap.
//
// What it does:
//   - Hero: a bento cluster (headline tile, a neon scene where a 3D candle bounces off a CALL WALL,
//     four stat tiles) flies together in 3D on load, then explodes outward as you scroll, revealing
//     "11 tools". Driven by time (load) and scroll progress through the sticky stage.
//   - Feature mega-bento: every tile has its own small animation (CSS keyframes; built here from
//     seeded data) and expands on click / tap / "+" into three details and an "Explore" link.
//   - Sticky chip nav that highlights the feature in view, count-up stat strip, cursor light on
//     tiles, magnetic buttons, a cursor spotlight over the closing CTA.
//
// Motion rules: only transform and opacity are written; one rAF per scroll frame; the candle loop
// runs only while the hero is on screen and the tab is visible; tile keyframes are paused while a
// tile is off screen (.is-vis). prefers-reduced-motion: html.fb-anim is never added, CSS kills all
// keyframes, the page is static and fully readable.
//
// Data, and what is real:
//   - Market clock: assets/market-hours.js (StrykerMarketHours.sessionLabel). A clock, not data.
//   - GEX tile + hero tile: GET /api/gex/levels/SPX?dte=0 (the public endpoint the GEX page uses):
//     call wall, zero gamma, put wall when it answers, aged "updated X ago". Never "live".
//   - Every other visual (candle, trail, mini chart, replay bars, heatmap, posts) is illustrative or
//     sample and labelled so on the page. No P&L, balances, win rates or prices are invented.
//
// Depends on: assets/market-hours.js (window.StrykerMarketHours), features-bento.css.
(function () {
  'use strict';

  var doc = document, root = doc.documentElement;
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var FINE = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function easeOut(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }
  function easeInOut(x) { x = clamp(x, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var NS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------ sample visuals (seeded, illustrative)
  // GEX tile: a price path that ranges between the put wall and the call wall; drawn twice so the
  // CSS tape scroll (translateX -400) loops seamlessly.
  (function gexPath() {
    var p = $('#fb-gpath'); if (!p) return;
    var r = rng(5), pts = [], y = 120, n = 20;
    for (var i = 0; i <= n; i++) {
      if (i === 0 || i === n) y = 120;
      else { y += (r() - 0.5) * 34; if (y < 40) y = 40 + (40 - y); if (y > 156) y = 156 - (y - 156); }
      pts.push(y);
    }
    pts[6] = 58; pts[7] = 37; pts[8] = 62; pts[13] = 60; pts[14] = 38; pts[15] = 66; // two taps of the call wall
    var d = '';
    for (var k = 0; k < 2; k++) for (var j = 0; j <= n; j++) {
      d += (k === 0 && j === 0 ? 'M' : 'L') + (k * 400 + j * 20) + ' ' + pts[j].toFixed(1) + ' ';
    }
    p.setAttribute('d', d);
  })();

  // Charts tile: candles that draw themselves left to right, with a moving average.
  (function drawChart() {
    var svg = $('#fb-draw'); if (!svg) return;
    var r = rng(9), n = 26, W = 300, H = 120, p = 60, bars = [];
    for (var i = 0; i < n; i++) {
      var o = p, c = o + (r() - 0.42) * 9, h = Math.max(o, c) + r() * 4, l = Math.min(o, c) - r() * 4;
      bars.push([o, h, l, c]); p = c;
    }
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b) { lo = Math.min(lo, b[2]); hi = Math.max(hi, b[1]); });
    var y = function (v) { return H - 6 - (v - lo) / (hi - lo) * (H - 12); };
    var bw = W / n, out = '', ma = '';
    bars.forEach(function (b, i) {
      var up = b[3] >= b[0], x = i * bw + bw * 0.18, w = bw * 0.64;
      var top = Math.min(y(b[0]), y(b[3])), ht = Math.max(1.5, Math.abs(y(b[0]) - y(b[3])));
      out += '<g class="c ' + (up ? 'up' : 'dn') + '" style="animation-delay:' + (i * 0.16).toFixed(2) + 's">' +
        '<rect x="' + (x + w / 2 - 0.6).toFixed(1) + '" y="' + y(b[1]).toFixed(1) + '" width="1.2" height="' + (y(b[2]) - y(b[1])).toFixed(1) + '"/>' +
        '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + ht.toFixed(1) + '" rx="1"/></g>';
      var s = 0, m = 0; for (var k = Math.max(0, i - 5); k <= i; k++) { s += bars[k][3]; m++; }
      ma += (i ? 'L' : 'M') + (i * bw + bw / 2).toFixed(1) + ' ' + y(s / m).toFixed(1) + ' ';
    });
    svg.innerHTML = out + '<path class="ma" d="' + ma + '"/>';
  })();

  // Curriculum: a ring of 64 ticks (42 core, 12 Volume Profile, 10 Prop Firm) that light in order.
  (function ring() {
    var svg = $('#fb-ring'); if (!svg) return;
    var out = '';
    for (var i = 0; i < 64; i++) {
      var a = (i / 64) * Math.PI * 2 - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      var cls = i < 42 ? 'r-core' : i < 54 ? 'r-vp' : 'r-pf';
      out += '<line class="' + cls + '" style="animation-delay:' + (i * 0.1).toFixed(1) + 's" x1="' + (50 + c * 38).toFixed(2) + '" y1="' + (50 + s * 38).toFixed(2) +
        '" x2="' + (50 + c * 47).toFixed(2) + '" y2="' + (50 + s * 47).toFixed(2) + '"/>';
    }
    svg.innerHTML = out;
  })();

  // Replay: bars appear one at a time up to the "future hidden" edge, then rewind.
  (function replay() {
    var el = $('#fb-rp-bars'); if (!el) return;
    var r = rng(13), html = '', n = 18, h = 45;
    for (var i = 0; i < n; i++) {
      h = clamp(h + (r() - 0.42) * 22, 18, 96);
      html += '<i style="height:' + h.toFixed(0) + '%;animation-delay:' + (i * 0.32).toFixed(2) + 's"></i>';
    }
    el.innerHTML = html;
    el.style.paddingRight = '27%';
  })();

  // Journal: 4 weeks x 5 days sample heatmap.
  (function heat() {
    var el = $('#fb-heat'); if (!el) return;
    var r = rng(11), html = '';
    for (var i = 0; i < 20; i++) {
      var v = r();
      html += '<i class="' + (v > .74 ? 'h3' : v > .46 ? 'h2' : v > .2 ? 'h1' : '') + (i % 7 === 3 ? ' pulse' : '') + '"' +
        (i % 7 === 3 ? ' style="animation-delay:' + (i * 0.2).toFixed(1) + 's"' : '') + '></i>';
    }
    el.innerHTML = html;
  })();

  // ------------------------------------------------------------ market clock (market-hours.js)
  (function () {
    var MH = window.StrykerMarketHours; if (!MH) return;
    var heads = $$('[data-clock-head]'), nexts = $$('[data-clock-next]'), locs = $$('[data-clock-local]'), dots = $$('[data-clock-dot]');
    var hand = $('.fb-dial .hand');
    var abbr = '';
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZoneName: 'short' }).formatToParts(new Date())
        .forEach(function (p) { if (p.type === 'timeZoneName') abbr = p.value; });
      if (/^GMT\+5:30$/.test(abbr) || tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') abbr = 'IST';
    } catch (e) {}
    var hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var nyHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    function tick() {
      var now = Date.now(), L = MH.sessionLabel(now);
      var nx = L.next ? 'Next: ' + L.next.name + ' in ' + MH.fmtClock(L.next.at - now) : '';
      heads.forEach(function (e) { e.textContent = L.head; });
      nexts.forEach(function (e) { e.textContent = nx; });
      var ny = nyHm.format(now);
      locs.forEach(function (e) { e.textContent = 'You ' + hm.format(now) + (abbr ? ' ' + abbr : '') + ' · NY ' + ny; });
      dots.forEach(function (e) { e.classList.toggle('is-on', !!L.open); });
      if (hand) {
        var parts = ny.split(':'), hrs = (+parts[0] % 24) + (+parts[1]) / 60;
        hand.style.transform = 'rotate(' + (hrs / 24 * 360).toFixed(1) + 'deg)';
      }
    }
    tick();
    (function loop() { setTimeout(function () { if (!doc.hidden) tick(); loop(); }, 1000 - (Date.now() % 1000) + 5); })();
  })();

  // ------------------------------------------------------------ GEX levels (real when the endpoint answers)
  (function () {
    var meta = $('#fb-gex-meta'), svg = $('#fb-gex'), hCall = $('#fb-h-call'), hMeta = $('#fb-h-call-meta');
    if (!svg) return;
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
      $('#fb-lv-call').textContent = fmt(d.call_wall);
      $('#fb-lv-put').textContent = fmt(d.put_wall);
      $('#fb-lv-zero').textContent = d.zero_gamma != null ? fmt(d.zero_gamma) : '–';
      // Place the zero-gamma line between the two walls by value (walls stay at the top / bottom).
      if (d.zero_gamma != null && d.call_wall !== d.put_wall) {
        var f = clamp((d.call_wall - d.zero_gamma) / (d.call_wall - d.put_wall), 0.08, 0.92);
        var yz = (34 + f * 128).toFixed(1), ln = $('.g-zero', svg);
        ln.setAttribute('y1', yz); ln.setAttribute('y2', yz);
      }
      var m = d.market || {}, closed = m.state && m.state !== 'open' && m.state !== 'stale', a = ago(m.options_ts);
      meta.textContent = 'SPX · 0DTE' + (a ? ' · ' + (closed ? 'last session, ' : '') + a : '') + ' · the price line is illustrative';
      if (hCall) { hCall.textContent = fmt(d.call_wall); hMeta.textContent = 'SPX call wall' + (a ? ' · ' + a : ''); }
    }).catch(function () {
      ['#fb-lv-call', '#fb-lv-zero', '#fb-lv-put'].forEach(function (id) { $(id).textContent = ''; });
      meta.textContent = 'Illustrative levels: the GEX endpoint did not answer. Open GEX for the real ones.';
    });
  })();

  // ------------------------------------------------------------ expand tiles (3 details + Explore)
  (function () {
    var open = null;
    function set(tile, on, focus) {
      var more = $('.fb-more', tile), btn = $('.fb-more-btn', tile);
      tile.classList.toggle('is-open', on);
      if ('inert' in more) more.inert = !on; else more.setAttribute('aria-hidden', on ? 'false' : 'true');
      if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) { if (open && open !== tile) set(open, false); open = tile; if (focus) $('.fb-close', more).focus({ preventScroll: true }); }
      else { if (open === tile) open = null; if (focus && btn) btn.focus({ preventScroll: true }); }
    }
    $$('[data-tile]').forEach(function (tile) {
      var more = $('.fb-more', tile);
      if (!('inert' in more)) more.setAttribute('aria-hidden', 'true');
      tile.addEventListener('click', function (e) {
        if (e.target.closest('.fb-close')) { set(tile, false, true); return; }
        if (e.target.closest('a')) return; // links work normally
        if (e.target.closest('.fb-more')) return;
        set(tile, !tile.classList.contains('is-open'), !!e.target.closest('.fb-more-btn'));
      });
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) set(open, false, true); });
  })();

  // ------------------------------------------------------------ theme toggle
  (function () {
    var b = $('#fb-theme'); if (!b) return;
    b.addEventListener('click', function () {
      var day = root.getAttribute('data-theme') !== 'light';
      if (day) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem('stryker_theme', day ? 'day' : 'night'); } catch (e) {}
    });
  })();

  // ------------------------------------------------------------ chip nav: highlight the section in view
  (function () {
    var chips = $$('#fb-chips a'), row = $('#fb-chips'); if (!chips.length || !('IntersectionObserver' in window)) return;
    var byId = {}, current = '';
    chips.forEach(function (c) { byId[c.getAttribute('data-chip')] = c; });
    var visible = {};
    function pick() {
      var best = '', bestTop = Infinity;
      Object.keys(visible).forEach(function (id) { if (visible[id] < bestTop) { bestTop = visible[id]; best = id; } });
      if (best === current) return;
      if (current && byId[current]) byId[current].classList.remove('is-on');
      current = best;
      var c = byId[best]; if (!c) return;
      c.classList.add('is-on');
      // keep the active chip in view by scrolling the chip row only (never scrollIntoView)
      var target = c.offsetLeft - (row.clientWidth - c.offsetWidth) / 2;
      var max = row.scrollWidth - row.clientWidth;
      var to = clamp(target, 0, max);
      if (row.scrollTo) row.scrollTo({ left: to, behavior: REDUCE ? 'auto' : 'smooth' }); else row.scrollLeft = to;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var id = e.target.id;
        if (e.isIntersecting) visible[id] = e.boundingClientRect.top < 0 ? 0 : e.boundingClientRect.top; else delete visible[id];
      });
      pick();
    }, { rootMargin: '-120px 0px -45% 0px', threshold: 0 });
    Object.keys(byId).forEach(function (id) { var el = doc.getElementById(id); if (el) io.observe(el); });
  })();

  // ------------------------------------------------------------ visibility: pause off-screen tile animations, count-ups
  (function () {
    var tiles = $$('.fb-tile, .fb-end');
    if (!('IntersectionObserver' in window)) { tiles.forEach(function (t) { t.classList.add('is-vis'); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle('is-vis', e.isIntersecting); });
    }, { rootMargin: '80px 0px' });
    tiles.forEach(function (t) { io.observe(t); });

    if (REDUCE) return;
    var nums = $$('.fb-stat b[data-count]');
    var io2 = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io2.unobserve(e.target);
        var el = e.target, to = +el.getAttribute('data-count'), suf = el.getAttribute('data-suffix') || '', t0 = performance.now();
        (function step(now) {
          var k = easeOut((now - t0) / 1100);
          el.textContent = Math.round(to * k) + suf;
          if (k < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.5 });
    nums.forEach(function (n) { n.textContent = '0' + (n.getAttribute('data-suffix') || ''); io2.observe(n); });
  })();

  // ------------------------------------------------------------ cursor light, magnetic buttons, CTA spotlight (fine pointers)
  if (FINE && !REDUCE) {
    $$('.fb-tile, .fb-ht, .fb-cmp-hero, .fb-cmp-t, .fb-end-side, .fb-end-mini').forEach(function (t) {
      var g = doc.createElement('i'); g.className = 'fb-glow'; g.setAttribute('aria-hidden', 'true');
      var skin = t.querySelector(':scope > .fb-skin');
      if (skin) skin.after(g); else t.insertBefore(g, t.firstChild);
    });
    var end = $('#start'), spot = $('#fb-spot');
    var pend = null, busy = false;
    doc.addEventListener('pointermove', function (e) {
      pend = e;
      if (busy) return; busy = true;
      requestAnimationFrame(function () {
        busy = false;
        var ev = pend; if (!ev) return;
        var host = ev.target.closest && ev.target.closest('.fb-tile, .fb-ht, .fb-cmp-hero, .fb-cmp-t, .fb-end-side, .fb-end-mini');
        $$('.is-lit').forEach(function (el) { if (el !== host && el !== end) el.classList.remove('is-lit'); });
        if (host) {
          var g = host.querySelector(':scope > .fb-glow');
          if (g) {
            var r = host.getBoundingClientRect();
            var sx = host.offsetWidth ? r.width / host.offsetWidth : 1, sy = host.offsetHeight ? r.height / host.offsetHeight : 1;
            g.style.transform = 'translate3d(' + ((ev.clientX - r.left) / sx).toFixed(1) + 'px,' + ((ev.clientY - r.top) / sy).toFixed(1) + 'px,0)';
            host.classList.add('is-lit');
          }
        }
        if (end && spot) {
          var er = end.getBoundingClientRect();
          var inside = ev.clientY >= er.top && ev.clientY <= er.bottom && ev.clientX >= er.left && ev.clientX <= er.right;
          end.classList.toggle('is-lit', inside);
          if (inside) spot.style.transform = 'translate3d(' + (ev.clientX - er.left).toFixed(0) + 'px,' + (ev.clientY - er.top).toFixed(0) + 'px,0)';
        }
      });
    }, { passive: true });

    $$('.fb-mag').forEach(function (m) {
      var btn = m.firstElementChild, k = m.classList.contains('fb-mag-xl') ? 0.4 : 0.28;
      m.addEventListener('pointermove', function (e) {
        var r = m.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = 'translate3d(' + (dx * k).toFixed(1) + 'px,' + (dy * (k + .1)).toFixed(1) + 'px,0)';
      });
      m.addEventListener('pointerleave', function () { btn.style.transform = ''; });
      m.style.padding = '14px'; m.style.margin = '-14px';
    });
  }

  // ------------------------------------------------------------ progress bar (always)
  var bar = $('#fb-bar');
  function progressBar() {
    var docH = root.scrollHeight - innerHeight;
    bar.style.transform = 'scaleX(' + (docH > 0 ? clamp(scrollY / docH, 0, 1) : 0).toFixed(4) + ')';
  }

  if (REDUCE) { addEventListener('scroll', progressBar, { passive: true }); progressBar(); return; }

  // ------------------------------------------------------------ hero: assemble on load, explode on scroll
  var stage = $('#fb-stage'), sticky = $('#fb-sticky'), hero = $('#fb-hero');
  if (!stage || !sticky) return;
  root.classList.add('fb-anim');

  var parts = $$('[data-ht]', hero), core = $('[data-core]', hero), reveal = $('#fb-reveal'), hint = $('#fb-hint');
  var anchor = $('#fb-anchor'), bounce = $('#fb-bounce'), shadow = $('#fb-shadow'), wall = $('#fb-wall'), flash = $('#fb-wall-flash'), floor = $('#fb-floor');
  var M = null, P = 0, A = 0, phone = false, introT0 = 0;

  function measure() {
    phone = innerWidth < 720;
    parts.forEach(function (t) { t.style.transform = 'none'; });
    var hr = hero.getBoundingClientRect(), cx = hr.left + hr.width / 2, cy = hr.top + hr.height / 2;
    var r = rng(31);
    parts.forEach(function (t, i) {
      var b = t.getBoundingClientRect(), dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      t._ux = dx / len; t._uy = dy / len; t._i = i;
      t._rx = (r() - .5) * (phone ? 40 : 90); t._ry = (r() - .5) * (phone ? 50 : 110); t._rz = (r() - .5) * (phone ? 24 : 50);
      t._sx = (r() - .5) * hr.width * 0.9; t._sy = (r() - .5) * hr.height * 0.8; // intro start scatter
      t._core = t === core;
    });
    var ar = anchor.getBoundingClientRect(), wr = wall.getBoundingClientRect();
    var sc = phone ? 0.62 : 1;
    M = { rise: Math.max(24, (ar.top - wr.bottom) / sc - 6), total: Math.max(1, stage.offsetHeight - sticky.offsetHeight), w: hr.width, h: hr.height, sh: sticky.offsetHeight };
    render(true);
  }

  function progress() {
    var pin = parseFloat(getComputedStyle(sticky).top) || 0;
    return clamp((pin - stage.getBoundingClientRect().top) / M.total, 0, 1);
  }

  function render() {
    if (!M) return;
    progressBar();
    P = progress();
    var b = easeInOut(P / 0.8), dist = Math.max(M.w, M.h) * (phone ? 0.9 : 0.75);
    parts.forEach(function (t) {
      var a = easeOut((A - t._i * 0.07) / 0.6), q = 1 - a;               // intro, staggered
      var x = t._sx * q, y = t._sy * q, z = -600 * q, rx = t._rx * q * 1.4, ry = t._ry * q * 1.4, rz = t._rz * q, s = 0.6 + 0.4 * a, o = a;
      if (b > 0) {
        var k = t._core ? 0.35 : 1;
        x += t._ux * dist * b * k; y += t._uy * dist * b * k; z += (t._core ? -260 : 240) * b;
        rx += t._rx * b; ry += t._ry * b; rz += t._rz * b;
        s *= t._core ? 1 - 0.3 * b : 1 + 0.15 * b;
        o *= clamp(1 - b * (t._core ? 1.3 : 1.15), 0, 1);
      }
      if (a >= 1 && b <= 0) { t.style.transform = 'none'; t.style.opacity = '1'; return; }
      t.style.opacity = o.toFixed(3);
      t.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + z.toFixed(1) + 'px) rotateX(' + rx.toFixed(1) + 'deg) rotateY(' + ry.toFixed(1) + 'deg) rotateZ(' + rz.toFixed(1) + 'deg) scale(' + s.toFixed(3) + ')';
    });
    hero.style.pointerEvents = b > 0.4 ? 'none' : '';
    var rv = easeOut((P - 0.3) / 0.45);
    reveal.style.opacity = (rv * (1 - clamp((P - 0.9) / 0.1, 0, 1))).toFixed(3);
    reveal.style.transform = 'translate3d(0,' + (30 * (1 - rv)).toFixed(1) + 'px,0) scale(' + (0.6 + 0.4 * rv).toFixed(3) + ')';
    if (hint) hint.style.opacity = clamp(1 - P * 10, 0, 1).toFixed(3);
    if (P < 0.6) startLoop();
  }

  // intro (time-based, ~1.4 s)
  function intro(now) {
    if (!introT0) introT0 = now;
    A = clamp((now - introT0) / 1400, 0, 1.5);
    render();
    if (A < 1.5) requestAnimationFrame(intro);
  }

  // candle bounce loop (only while the hero is visible and not exploded)
  var raf = 0, inView = true, t0 = performance.now();
  function frame(now) {
    raf = 0;
    if (!inView || doc.hidden || P > 0.6) return;
    var t = (now - t0) / 1000, u = (t % 1.7) / 1.7, s = 1 - Math.abs(1 - 2 * u);
    var y = M.rise * (1 - Math.cos(s * Math.PI / 2)), squash = s > 0.94 ? 1 - (s - 0.94) * 2.2 : 1;
    bounce.style.transform = 'translate3d(0,' + (-y).toFixed(1) + 'px,0) rotateY(' + ((t * 24) % 360).toFixed(1) + 'deg) scale(' + (1 + (1 - squash) * .5).toFixed(3) + ',' + squash.toFixed(3) + ')';
    shadow.style.transform = 'rotateX(70deg) scale(' + (1 - (y / M.rise) * 0.55).toFixed(3) + ')';
    flash.style.opacity = s > 0.86 ? ((s - 0.86) / 0.14).toFixed(3) : '0';
    flash.style.transform = 'scale(' + (0.6 + (s > 0.86 ? (s - .86) * 4 : 0)).toFixed(3) + ')';
    floor.style.transform = 'translate3d(0,' + ((t * 34) % 40).toFixed(1) + 'px,0)';
    raf = requestAnimationFrame(frame);
  }
  function startLoop() { if (!raf && inView && !doc.hidden && M) raf = requestAnimationFrame(frame); }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { inView = es[0].isIntersecting; if (inView) startLoop(); }).observe(core);
  }
  doc.addEventListener('visibilitychange', startLoop);

  var queued = false;
  addEventListener('scroll', function () {
    if (queued) return; queued = true;
    requestAnimationFrame(function () { queued = false; render(); });
  }, { passive: true });
  var rt = 0, lastW = innerWidth;
  addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      // phones fire resize when the URL bar slides; only re-measure on real size changes
      if (innerWidth === lastW && M && Math.abs(sticky.offsetHeight - M.sh) < 80) return;
      lastW = innerWidth; measure();
    }, 150);
  });
  function boot() { measure(); requestAnimationFrame(intro); startLoop(); }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(boot); else boot();
})();
