// Stryker Trading Academy: DEMO homepage, variation D "3D scroll-assemble neon bento"
// (demo-bento-d.html only). Owner order 2026-10-06: "bento grid homepage, go crazy",
// "give me 3 more variations". Unlisted demo page (noindex, not in nav or sitemap).
//
// What it does:
//   - A sticky full-screen hero: a 3D CSS candlestick bounces off a neon CALL WALL.
//     As the visitor scrolls, the hero breaks apart (shards burst out of the candle)
//     and the bento tiles fly out of the candle's position, in 3D perspective, into
//     their grid cells. Everything is driven by scroll progress through the stage.
//   - Below: tiles that flip to a second face (click / tap / button), glass plan cards,
//     cursor-reactive light on every glass surface and magnetic CTA buttons.
//   - Phones get fewer pieces (6 tiles, 6 shards) and no cursor effects.
//
// Motion rules: only transform and opacity are written; one rAF render per scroll
// frame; the bounce loop runs only while the hero is on screen, the tab is visible and
// the hero has not broken apart yet. prefers-reduced-motion: the class nd-anim is
// never added, so the page is a plain static hero + grid and nothing moves.
//
// Data, and what is real:
//   - Session clock: assets/market-hours.js (StrykerMarketHours.sessionLabel), the same
//     calendar as the app header clock. A clock, not market data.
//   - GEX tile: GET /api/gex/levels/SPX?dte=0 (public endpoint the GEX page uses):
//     call wall, zero gamma, put wall are real when it answers; the price line is
//     illustrative. Age shown as "updated X ago". Never worded as live/real-time.
//   - Candle, trail, mini chart, replay bars and journal heatmap are illustrative/sample
//     and labelled so on the page. No P&L, balances, win rates or prices are invented.
//
// Depends on: assets/market-hours.js (window.StrykerMarketHours), demo-bento-d.css.
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

  // ------------------------------------------------------------ static fills (sample visuals)
  (function miniChart() {
    var svg = $('#nd-mini'); if (!svg) return;
    var r = rng(7), n = 22, p = 50, out = '', W = 300, H = 90, bars = [];
    for (var i = 0; i < n; i++) {
      var o = p, c = o + (r() - 0.45) * 10, h = Math.max(o, c) + r() * 4, l = Math.min(o, c) - r() * 4;
      bars.push([o, h, l, c]); p = c;
    }
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b) { lo = Math.min(lo, b[2]); hi = Math.max(hi, b[1]); });
    var y = function (v) { return (H - 4 - (v - lo) / (hi - lo) * (H - 8)).toFixed(1); };
    var bw = W / n;
    bars.forEach(function (b, i) {
      var up = b[3] >= b[0], cls = up ? 'up' : 'dn', x = i * bw + bw * 0.2, w = bw * 0.6;
      var top = Math.min(+y(b[0]), +y(b[3])), ht = Math.max(1.5, Math.abs(+y(b[0]) - +y(b[3])));
      out += '<rect class="' + cls + '" x="' + (x + w / 2 - 0.6).toFixed(1) + '" y="' + y(b[1]) + '" width="1.2" height="' + (+y(b[2]) - +y(b[1])).toFixed(1) + '"/>';
      out += '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + ht.toFixed(1) + '" rx="1"/>';
    });
    svg.innerHTML = out;
  })();
  (function heat() {
    var el = $('#nd-heat'); if (!el) return;
    var r = rng(11), html = '';
    for (var i = 0; i < 28; i++) {
      var v = r(), wk = (i % 7) > 4;
      html += '<i class="' + (wk ? '' : v > .72 ? 'h3' : v > .45 ? 'h2' : v > .2 ? 'h1' : '') + '"></i>';
    }
    el.innerHTML = html;
  })();

  // ------------------------------------------------------------ session clock
  (function () {
    var MH = window.StrykerMarketHours; if (!MH) return;
    var head = $('#nd-clock-head'), next = $('#nd-clock-next'), loc = $('#nd-clock-local'), dot = $('#nd-clock-dot');
    var abbr = '';
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZoneName: 'short' }).formatToParts(new Date())
        .forEach(function (p) { if (p.type === 'timeZoneName') abbr = p.value; });
      if (/^GMT\+5:30$/.test(abbr) || tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') abbr = 'IST';
    } catch (e) {}
    var hms = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    var nyHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    function tick() {
      var now = Date.now(), L = MH.sessionLabel(now);
      head.textContent = L.head;
      next.textContent = L.next ? 'Next: ' + L.next.name + ' opens in ' + MH.fmtClock(L.next.at - now) : '';
      loc.textContent = 'You ' + hms.format(now) + (abbr ? ' ' + abbr : '') + ' · NY ' + nyHm.format(now);
      dot.classList.toggle('is-on', !!L.open);
    }
    tick();
    (function loop() { setTimeout(function () { if (!doc.hidden) tick(); loop(); }, 1000 - (Date.now() % 1000) + 5); })();
  })();

  // ------------------------------------------------------------ GEX levels (real when the endpoint answers)
  (function () {
    var meta = $('#nd-gex-meta'), svg = $('#nd-gex'); if (!svg) return;
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
      $('#nd-lv-call').textContent = fmt(d.call_wall);
      $('#nd-lv-put').textContent = fmt(d.put_wall);
      $('#nd-lv-zero').textContent = d.zero_gamma != null ? fmt(d.zero_gamma) : '–';
      // place the three lines by value (top = highest)
      var vals = [d.call_wall, d.put_wall]; if (d.zero_gamma != null) vals.push(d.zero_gamma);
      var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals), span = (hi - lo) || 1;
      var y = function (v) { return (22 + (hi - v) / span * 126).toFixed(1); };
      [['.g-call', d.call_wall], ['.g-put', d.put_wall], ['.g-zero', d.zero_gamma]].forEach(function (a) {
        var ln = $(a[0], svg); if (!ln || a[1] == null) return; ln.setAttribute('y1', y(a[1])); ln.setAttribute('y2', y(a[1]));
      });
      var m = d.market || {}, closed = m.state && m.state !== 'open' && m.state !== 'stale', a = ago(m.options_ts);
      meta.textContent = 'SPX · 0DTE' + (a ? ' · ' + (closed ? 'last session, ' : '') + a : '') + ' · price line illustrative';
    }).catch(function () {
      ['#nd-lv-call', '#nd-lv-zero', '#nd-lv-put'].forEach(function (id) { $(id).textContent = ''; });
      meta.textContent = 'Illustrative levels: the GEX endpoint did not answer. Open GEX for the real ones.';
    });
  })();

  // ------------------------------------------------------------ flip tiles
  (function () {
    $$('[data-flip]').forEach(function (card) {
      var front = $('.nd-front', card), back = $('.nd-back', card);
      function set(on) {
        card.classList.toggle('is-flipped', on);
        if ('inert' in front) { front.inert = on; back.inert = !on; }
        else { back.setAttribute('aria-hidden', on ? 'false' : 'true'); front.setAttribute('aria-hidden', on ? 'true' : 'false'); }
      }
      set(false);
      card.addEventListener('click', function (e) {
        if (e.target.closest('a')) return; // links work normally
        var on = !card.classList.contains('is-flipped');
        set(on);
        var btn = $(on ? '.nd-back .nd-flip-btn' : '.nd-front .nd-flip-btn', card);
        if (e.target.closest('.nd-flip-btn') && btn) btn.focus({ preventScroll: true });
      });
    });
  })();

  // ------------------------------------------------------------ theme toggle
  (function () {
    var b = $('#nd-theme'); if (!b) return;
    b.addEventListener('click', function () {
      var day = root.getAttribute('data-theme') !== 'light';
      if (day) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem('stryker_theme', day ? 'day' : 'night'); } catch (e) {}
    });
  })();

  // ------------------------------------------------------------ cursor light + magnetic buttons (fine pointers only)
  if (FINE && !REDUCE) {
    $$('.nd-tile').forEach(function (t) {
      var g = doc.createElement('i'); g.className = 'nd-glow'; g.setAttribute('aria-hidden', 'true');
      t.insertBefore(g, t.querySelector('.nd-in'));
    });
    var pend = null, busy = false;
    doc.addEventListener('pointermove', function (e) {
      pend = e;
      if (busy) return; busy = true;
      requestAnimationFrame(function () {
        busy = false;
        var ev = pend; if (!ev) return;
        var host = ev.target.closest && ev.target.closest('.nd-tile, .nd-face, .nd-plan');
        $$('.is-lit').forEach(function (el) { if (el !== host) el.classList.remove('is-lit'); });
        if (host) {
          var g = host.querySelector(':scope > .nd-glow');
          if (g) {
            var r = host.getBoundingClientRect();
            var sx = host.offsetWidth ? r.width / host.offsetWidth : 1, sy = host.offsetHeight ? r.height / host.offsetHeight : 1;
            g.style.transform = 'translate3d(' + ((ev.clientX - r.left) / sx).toFixed(1) + 'px,' + ((ev.clientY - r.top) / sy).toFixed(1) + 'px,0)';
            host.classList.add('is-lit');
          }
        }
      });
    }, { passive: true });
    doc.addEventListener('pointerleave', function () { $$('.is-lit').forEach(function (el) { el.classList.remove('is-lit'); }); });

    $$('.nd-mag').forEach(function (m) {
      var btn = m.firstElementChild;
      m.addEventListener('pointermove', function (e) {
        var r = m.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = 'translate3d(' + (dx * 0.28).toFixed(1) + 'px,' + (dy * 0.38).toFixed(1) + 'px,0)';
      });
      m.addEventListener('pointerleave', function () { btn.style.transform = ''; });
      m.style.padding = '10px'; m.style.margin = '-10px'; // larger pull zone
    });
  }

  // ------------------------------------------------------------ the stage: bounce, break apart, assemble
  if (REDUCE) return;
  var stage = $('#nd-stage'), sticky = $('#nd-sticky'); if (!stage || !sticky) return;
  root.classList.add('nd-anim');

  var heroCopy = $('#nd-hero-copy'), hero = $('#nd-hero'), wall = $('#nd-wall'), flash = $('#nd-wall-flash'), trail = $('#nd-trail');
  var anchor = $('#nd-anchor'), bounce = $('#nd-bounce'), candle = $('#nd-candle'), shadow = $('.nd-candle-shadow');
  var floorWrap = $('.nd-floor'), floor = $('#nd-floor'), hint = $('#nd-hint'), illu = $('.nd-illu');
  var asm = $('#nd-asm'), grid = $('#nd-grid'), asmHead = $('#nd-asm-head'), bar = $('#nd-bar'), shardBox = $('#nd-shards');
  var tiles = [], shards = [], M = null, P = 0, phone = false;

  function buildShards() {
    phone = innerWidth < 720;
    var n = phone ? 6 : 14, r = rng(3);
    shardBox.innerHTML = '';
    shards = [];
    for (var i = 0; i < n; i++) {
      var el = doc.createElement('i'); shardBox.appendChild(el);
      var a = (i / n) * Math.PI * 2 + r() * 0.5;
      shards.push({ el: el, dx: Math.cos(a), dy: Math.sin(a) * 0.8 - 0.25, dist: (phone ? 140 : 300) * (0.6 + r() * 0.6), rz: (r() - .5) * 720, rx: (r() - .5) * 540 });
    }
  }

  function measure() {
    buildShards();
    tiles = $$('.nd-tile', grid).filter(function (t) { return getComputedStyle(t).display !== 'none'; });
    grid.style.transform = 'none'; bounce.style.transform = 'none';
    tiles.forEach(function (t) { t.style.transform = 'none'; });
    var sr = sticky.getBoundingClientRect(), ar = anchor.getBoundingClientRect(), sc = $('#nd-scene').getBoundingClientRect();
    var cx = ar.left + ar.width / 2 - sr.left, cy = ar.top + ar.height / 2 - sr.top;
    var r = rng(21);
    tiles.forEach(function (t, i) {
      var tr = t.getBoundingClientRect();
      t._dx = cx - (tr.left + tr.width / 2 - sr.left);
      t._dy = cy - (tr.top + tr.height / 2 - sr.top);
      t._rx = (r() - .5) * 140; t._ry = (r() - .5) * 160; t._rz = (r() - .5) * 90;
      t._i = i;
    });
    // how far the candle can rise before it touches the wall
    var wr = wall.getBoundingClientRect();
    M = { rise: Math.max(30, ar.top - wr.bottom - 4), n: tiles.length, total: Math.max(1, stage.offsetHeight - sticky.offsetHeight), sceneH: sc.height };
    render(true);
  }

  function progress() {
    // stage top relative to where the sticky viewport pins
    var pin = parseFloat(getComputedStyle(sticky).top) || 0;
    return clamp((pin - stage.getBoundingClientRect().top) / M.total, 0, 1);
  }

  var lastB = -1;
  function render(force) {
    if (!M) return;
    P = progress();
    var docH = root.scrollHeight - innerHeight;
    bar.style.transform = 'scaleX(' + (docH > 0 ? clamp(scrollY / docH, 0, 1) : 0).toFixed(4) + ')';

    // ---- break apart (0.06 .. 0.36)
    var b = easeInOut((P - 0.06) / 0.30);
    if (force || b !== lastB) {
      lastB = b;
      heroCopy.style.transform = b ? 'translate3d(0,' + (-70 * b).toFixed(1) + 'px,0) rotateX(' + (40 * b).toFixed(1) + 'deg) scale(' + (1 - .12 * b).toFixed(3) + ')' : '';
      heroCopy.style.opacity = (1 - b * 1.4).toFixed(3);
      hero.style.pointerEvents = b > 0.5 ? 'none' : '';
      wall.style.opacity = (1 - b * 1.3).toFixed(3);
      wall.style.transform = 'scaleX(' + (1 + b * .6).toFixed(3) + ')';
      trail.style.opacity = (1 - b * 1.5).toFixed(3);
      floorWrap.style.opacity = (1 - b * .8).toFixed(3);
      illu.style.opacity = (1 - b * 3).toFixed(3);
      if (hint) hint.style.opacity = clamp(1 - P * 12, 0, 1).toFixed(3);
      candle.style.opacity = clamp(1 - b * 2.2, 0, 1).toFixed(3);
      candle.style.transform = 'rotateX(-12deg) rotateY(' + (-28 + b * 260).toFixed(1) + 'deg) scale(' + (1 + b * 1.1).toFixed(3) + ')';
      shadow.style.opacity = (1 - b * 2).toFixed(3);
      shards.forEach(function (s) {
        var e = easeOut(b * 1.25);
        s.el.style.opacity = b <= 0 ? '0' : clamp(Math.min(1, b * 10) * (1 - b * 1.1), 0, 1).toFixed(3);
        s.el.style.transform = b <= 0 ? '' : 'translate3d(' + (s.dx * s.dist * e).toFixed(1) + 'px,' + (s.dy * s.dist * e).toFixed(1) + 'px,' + (120 * e).toFixed(1) + 'px) rotateX(' + (s.rx * e).toFixed(0) + 'deg) rotateZ(' + (s.rz * e).toFixed(0) + 'deg)';
      });
    }

    // ---- assemble (0.22 .. ~0.88)
    var g = easeOut((P - 0.24) / 0.68);
    grid.style.transform = 'rotateX(' + (22 * (1 - g)).toFixed(2) + 'deg) translateZ(' + (-80 * (1 - g)).toFixed(1) + 'px)';
    var step = phone ? 0.05 : 0.04, dur = phone ? 0.32 : 0.3;
    tiles.forEach(function (t) {
      var s0 = 0.22 + t._i * step, k = clamp((P - s0) / dur, 0, 1), e = easeOut(k), q = 1 - e;
      if (k >= 1) { if (t._done !== 1) { t.style.transform = 'none'; t.style.opacity = '1'; t._done = 1; } return; }
      t._done = 0;
      var z = -520 * q + 160 * Math.sin(Math.PI * e);
      t.style.opacity = clamp(k * 4, 0, 1).toFixed(3);
      t.style.transform = 'translate3d(' + (t._dx * q).toFixed(1) + 'px,' + (t._dy * q).toFixed(1) + 'px,' + z.toFixed(1) + 'px) rotateX(' + (t._rx * q).toFixed(1) + 'deg) rotateY(' + (t._ry * q).toFixed(1) + 'deg) rotateZ(' + (t._rz * q).toFixed(1) + 'deg) scale(' + (0.18 + 0.82 * e).toFixed(3) + ')';
    });
    var h = easeOut((P - 0.2) / 0.25);
    asmHead.style.opacity = h.toFixed(3);
    asmHead.style.transform = 'translate3d(0,' + (24 * (1 - h)).toFixed(1) + 'px,0)';
    asm.classList.toggle('is-on', P > 0.7);
    if (P < 0.4) startLoop();
  }

  // ---- candle bounce loop (time based, runs only while it is visible)
  var raf = 0, inView = true, t0 = performance.now();
  function frame(now) {
    raf = 0;
    if (!inView || doc.hidden || P > 0.4) return;
    var t = (now - t0) / 1000, period = 1.7, u = (t % period) / period;
    var s = 1 - Math.abs(1 - 2 * u);                 // 0 floor -> 1 wall -> 0 floor
    var y = M.rise * (1 - Math.cos(s * Math.PI / 2)); // smooth at the floor, sharp at the wall
    var squash = s > 0.94 ? 1 - (s - 0.94) * 2.2 : 1;
    bounce.style.transform = 'translate3d(0,' + (-y).toFixed(1) + 'px,0) rotateY(' + ((t * 24) % 360).toFixed(1) + 'deg) scale(' + (1 + (1 - squash) * .5).toFixed(3) + ',' + squash.toFixed(3) + ')';
    shadow.style.transform = 'rotateX(70deg) scale(' + (1 - (y / M.rise) * 0.55).toFixed(3) + ')';
    flash.style.opacity = s > 0.86 ? ((s - 0.86) / 0.14 * (1 - lastB)).toFixed(3) : '0';
    flash.style.transform = 'translate3d(0,0,0) scale(' + (0.6 + (s > 0.86 ? (s - .86) * 4 : 0)).toFixed(3) + ')';
    floor.style.transform = 'translate3d(0,' + ((t * 34) % 40).toFixed(1) + 'px,0)';
    raf = requestAnimationFrame(frame);
  }
  function startLoop() { if (!raf && inView && !doc.hidden && M) raf = requestAnimationFrame(frame); }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { inView = es[0].isIntersecting; if (inView) startLoop(); }).observe(hero);
  }
  doc.addEventListener('visibilitychange', startLoop);

  var queued = false;
  function onScroll() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; render(false); }); }
  addEventListener('scroll', onScroll, { passive: true });
  var rt = 0, lastW = innerWidth;
  addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      // phones fire resize when the URL bar slides; only re-measure on real size changes
      if (innerWidth === lastW && Math.abs(sticky.offsetHeight - (M ? M._h : 0)) < 80) return;
      lastW = innerWidth; measure(); if (M) M._h = sticky.offsetHeight;
    }, 150);
  });
  function boot() { measure(); M._h = sticky.offsetHeight; startLoop(); }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(boot); else boot();
})();
