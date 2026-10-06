// Stryker Trading Academy: DEMO bento-grid homepage (demo-bento.html only)
//
// Owner order 2026-10-06: "Do you know bento grids, can u create a demo homepage
// using them. Go crazy." Unlisted demo page (noindex, not in nav or sitemap).
//
// One requestAnimationFrame clock drives every canvas tile. Each tile registers a
// draw(t, dt) function; the loop only draws tiles that are on screen, stops when
// none are visible or the tab is hidden, and with prefers-reduced-motion every
// tile is painted once as a still frame and nothing moves.
//
// Data, and what is real:
//   - Session clock: assets/market-hours.js (StrykerMarketHours.sessionLabel), the
//     same calendar as the app header clock. It is a clock, not market data.
//   - GEX tile: GET /api/gex/levels/SPX?dte=0 (public, same endpoint the GEX page
//     uses). Call wall, zero gamma, put wall, spot and the strike ladder are real;
//     the moving price dot is illustrative motion between them. Data age is shown
//     as "updated X min ago" from market.options_ts. If the endpoint does not
//     answer, the tile draws unlabelled illustrative levels and says so.
//   - Market desk tile: assets/econ-calendar.json (next high-impact releases),
//     times in the visitor's own clock.
//   - Charts, replay, journal and hero candles are generated, illustrative motion
//     (the journal tile carries a "Sample" tag). No P&L, balances or win rates.
//
// Depends on: assets/market-hours.js (window.StrykerMarketHours), style.css tokens.
(function () {
  'use strict';

  var doc = document, root = doc.documentElement;
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var FINE = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };

  root.classList.add('bx-js');
  if (REDUCE) root.classList.remove('bx-js');

  // ------------------------------------------------------------ helpers
  function rng(seed) { // mulberry32: same seed, same candles
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function candles(n, seed, start, vol) {
    var r = rng(seed), out = [], p = start || 100, v = vol || 1.2, drift = 0;
    for (var i = 0; i < n; i++) {
      drift = drift * 0.86 + (r() - 0.5) * 0.9;
      var o = p, c = o + drift * v + (r() - 0.5) * v * 1.4;
      var h = Math.max(o, c) + r() * v * 0.9, l = Math.min(o, c) - r() * v * 0.9;
      out.push({ o: o, h: h, l: l, c: c, v: 0.3 + r() });
      p = c;
    }
    return out;
  }
  var COL = {};
  function readColors() {
    var cs = getComputedStyle(doc.body);
    ['--ink-0', '--ink-1', '--ink-2', '--ink-3', '--line', '--line-soft', '--bull', '--bear', '--gold', '--gold-bright', '--teal', '--amber', '--bg-1', '--bg-2', '--bg-3',
      '--bx-call', '--bx-zero', '--bx-put'].forEach(function (k) { COL[k] = (cs.getPropertyValue(k) || '').trim() || '#888'; });
  }
  function alpha(hex, a) {
    var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }
  function fmtNum(n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // Canvas with DPR + resize handling.
  function surface(cv) {
    var s = { cv: cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
    function fit() {
      var r = cv.getBoundingClientRect();
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = Math.max(1, Math.round(r.width)); s.h = Math.max(1, Math.round(r.height));
      cv.width = Math.round(s.w * s.dpr); cv.height = Math.round(s.h * s.dpr);
      s.ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      s.dirty = true;
    }
    fit();
    // A resize clears the bitmap; repaint at once so an off-screen tile is never left blank.
    if (window.ResizeObserver) new ResizeObserver(function () { fit(); if (s.tile) s.tile.draw(s.tile.lastT || 4000, 0); }).observe(cv);
    return s;
  }

  function drawCandle(ctx, x, w, yo, yh, yl, yc, up, a) {
    var c = up ? COL['--bull'] : COL['--bear'];
    ctx.globalAlpha = a == null ? 1 : a;
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, yh); ctx.lineTo(Math.round(x) + 0.5, yl); ctx.stroke();
    var top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yc - yo));
    ctx.fillRect(Math.round(x - w / 2), top, Math.max(1, Math.round(w)), hgt);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ the one clock
  var tiles = [];   // {el, draw, visible, still}
  var running = false, last = 0, T0 = 0;
  function register(el, draw, surf) {
    var t = { el: el, visible: false, lastT: 0 };
    t.draw = function (tt, dt) { t.lastT = tt; draw(tt, dt); };
    if (surf) surf.tile = t;
    tiles.push(t);
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { t.visible = e.isIntersecting; });
        if (REDUCE) { if (t.visible) t.draw(4000, 0); } else kick();
      }, { rootMargin: '80px' }).observe(el);
    } else { t.visible = true; }
    return t;
  }
  function frame(now) {
    if (!T0) T0 = now;
    var dt = last ? Math.min(64, now - last) : 16; last = now;
    var t = now - T0, any = false;
    for (var i = 0; i < tiles.length; i++) if (tiles[i].visible) { any = true; tiles[i].draw(t, dt); }
    for (var j = 0; j < tweens.length; j++) tweens[j](now);
    tweens = tweens.filter(function (f) { return !f.done; });
    if ((any || tweens.length) && !doc.hidden) requestAnimationFrame(frame);
    else { running = false; last = 0; }
  }
  function kick() { if (!running && !REDUCE && !doc.hidden) { running = true; requestAnimationFrame(frame); } }
  doc.addEventListener('visibilitychange', kick);
  var tweens = [];

  // ------------------------------------------------------------ reveal + count-up
  function countUp(el) {
    var n = +el.getAttribute('data-count'), suf = el.getAttribute('data-suffix') || '';
    if (REDUCE || !isFinite(n)) { el.textContent = n + suf; return; }
    var t0 = 0;
    var f = function (now) {
      if (!t0) t0 = now;
      var k = ease((now - t0) / 1300);
      el.textContent = Math.round(n * k) + suf;
      if (k >= 1) f.done = true;
    };
    el.textContent = '0' + suf;
    tweens.push(f); kick();
  }
  var allTiles = $$('.bx-tile');
  allTiles.forEach(function (el, i) {
    var row = 0; el.style.setProperty('--i', String(i % 6 + row));
  });
  if (window.IntersectionObserver && !REDUCE) {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target; rio.unobserve(el);
        el.classList.add('is-in');
        $$('.bx-num', el).forEach(countUp);
      });
    }, { threshold: 0.12 });
    allTiles.forEach(function (el) { rio.observe(el); });
  } else {
    allTiles.forEach(function (el) { el.classList.add('is-in'); });
  }

  // ------------------------------------------------------------ spotlight + tilt
  if (FINE && !REDUCE) {
    var grid = $('.bx-grid'), px = -1, py = -1, pending = false, hovered = null;
    grid.addEventListener('pointermove', function (e) {
      px = e.clientX; py = e.clientY;
      grid.classList.add('is-pointer');
      if (!pending) { pending = true; requestAnimationFrame(applyPointer); }
    });
    grid.addEventListener('pointerleave', function () {
      grid.classList.remove('is-pointer');
      if (hovered) { hovered.style.removeProperty('--rx'); hovered.style.removeProperty('--ry'); hovered = null; }
    });
    var applyPointer = function () {
      pending = false;
      var hit = null;
      allTiles.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var x = px - r.left, y = py - r.top;
        el.style.setProperty('--mx', x + 'px'); el.style.setProperty('--my', y + 'px');
        if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) hit = { el: el, x: x / r.width, y: y / r.height };
      });
      if (hovered && (!hit || hit.el !== hovered)) { hovered.style.removeProperty('--rx'); hovered.style.removeProperty('--ry'); }
      hovered = hit ? hit.el : null;
      if (hit) {
        var k = hit.el.classList.contains('bx-hero') ? 0.35 : 1;
        hit.el.style.setProperty('--rx', ((0.5 - hit.y) * 5 * k).toFixed(2) + 'deg');
        hit.el.style.setProperty('--ry', ((hit.x - 0.5) * 7 * k).toFixed(2) + 'deg');
      }
    };
  }

  // ------------------------------------------------------------ hero candle stream
  (function () {
    var cv = $('.bx-hero-cv'); if (!cv) return;
    var s = surface(cv), data = candles(400, 7, 100, 1.1), speed = 0.018;
    register($('.bx-hero'), function (t) {
      var ctx = s.ctx, W = s.w, H = s.h; ctx.clearRect(0, 0, W, H);
      var step = W < 600 ? 11 : 14, cw = step * 0.55, n = Math.ceil(W / step) + 2;
      var off = (t * speed) % (data.length * step), i0 = Math.floor(off / step), frac = off / step - i0;
      var vis = [];
      for (var k = 0; k < n; k++) vis.push(data[(i0 + k) % data.length]);
      var lo = Infinity, hi = -Infinity;
      vis.forEach(function (c) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
      var top = H * (W < 600 ? 0.05 : 0.10), bot = H * (W < 600 ? 0.26 : 0.62);
      var y = function (v) { return bot - (v - lo) / (hi - lo || 1) * (bot - top); };
      var x0 = W - (n - 1) * step;
      for (var j = 0; j < n; j++) {
        var c = vis[j], x = x0 + (j - frac) * step;
        // fade in from the left so the copy side stays calm
        var a = W < 600 ? clamp(x / (W * 0.5), 0, 1) * 0.5 : clamp((x - W * 0.25) / (W * 0.45), 0, 1) * 0.55;
        if (a <= 0.01) continue;
        drawCandle(ctx, x, cw, y(c.o), y(c.h), y(c.l), y(c.c), c.c >= c.o, a);
      }
      // a glowing "last price" line
      var lc = vis[n - 1], ly = y(lc.c);
      ctx.strokeStyle = alpha(COL['--gold'], 0.35); ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(W < 600 ? 0 : W * 0.35, ly); ctx.lineTo(W, ly); ctx.stroke(); ctx.setLineDash([]);
    }, s);
  })();

  // ------------------------------------------------------------ session clock
  (function () {
    var MH = window.StrykerMarketHours; if (!MH) return;
    var head = $('#bx-clock-head'), tail = $('#bx-clock-tail'), loc = $('#bx-clock-local'), dot = $('#bx-clock-dot'), hand = $('#bx-hand');
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var abbr = '';
    try {
      var parts = new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZoneName: 'short' }).formatToParts(new Date());
      parts.forEach(function (p) { if (p.type === 'timeZoneName') abbr = p.value; });
      if (/^GMT\+5:30$/.test(abbr) || tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') abbr = 'IST';
    } catch (e) {}
    var hms = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    var nyHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    function ymd(tzName, ms) {
      var o = {};
      new Intl.DateTimeFormat('en-US', { timeZone: tzName, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms))
        .forEach(function (p) { o[p.type] = +p.value; });
      return o;
    }
    function localMin(ms) { var d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }
    function arc(r, a0, a1) {
      var cx = 60, cy = 60, rad = function (a) { return (a - 90) * Math.PI / 180; };
      if (a1 < a0) a1 += 360;
      var large = a1 - a0 > 180 ? 1 : 0;
      return 'M' + (cx + r * Math.cos(rad(a0))).toFixed(2) + ' ' + (cy + r * Math.sin(rad(a0))).toFixed(2) +
        ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(rad(a1))).toFixed(2) + ' ' + (cy + r * Math.sin(rad(a1))).toFixed(2);
    }
    var ids = { 'Asia': '#bx-arc-asia', 'London': '#bx-arc-lon', 'New York': '#bx-arc-ny' };
    var lastDay = '';
    function arcs(now) {
      var key = new Date(now).toDateString(); if (key === lastDay) return; lastDay = key;
      MH.SESSIONS.forEach(function (s) {
        var d = ymd(s.tz, now);
        var a = MH.tzToUtc(s.tz, d.year, d.month, d.day, s.open, 0), b = MH.tzToUtc(s.tz, d.year, d.month, d.day, s.close, 0);
        var el = $(ids[s.name]); if (!el) return;
        el.setAttribute('d', arc(50, localMin(a) / 4, localMin(b) / 4));
      });
    }
    function tick() {
      var now = Date.now(), L = MH.sessionLabel(now);
      head.textContent = L.head;
      tail.textContent = L.next ? 'Next: ' + L.next.name + ' opens in ' + MH.fmtClock(L.next.at - now) : '';
      loc.textContent = 'Your time ' + hms.format(now) + (abbr ? ' ' + abbr : '') + ' · New York ' + nyHm.format(now);
      dot.classList.toggle('is-on', !!L.open);
      $$('.r-arc').forEach(function (el) { el.style.opacity = L.weekend ? '.3' : ''; });
      arcs(now);
      var d = new Date(now), deg = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 240;
      hand.setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 60 60)');
    }
    tick();
    (function loop() { setTimeout(function () { if (!doc.hidden) tick(); loop(); }, 1000 - (Date.now() % 1000) + 5); })();
  })();

  // ------------------------------------------------------------ GEX tile
  var GEX = null;
  (function () {
    var cv = $('.bx-gex-cv'); if (!cv) return;
    var s = surface(cv), meta = $('#bx-gex-meta');
    var lv = { call: 1.0, zero: 0.42, put: 0.3, spot: 0.62 }, real = false, ladder = [];
    function ago(sec) {
      if (!sec) return '';
      var m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
      if (m < 60) return 'updated ' + m + ' min ago';
      var h = Math.floor(m / 60);
      if (h < 48) return 'updated ' + h + ' h ago';
      return 'updated ' + Math.floor(h / 24) + ' d ago';
    }
    function paintMeta(d) {
      var m = d.market || {};
      var closed = m.state && m.state !== 'open' && m.state !== 'stale';
      var parts = ['SPX · 0DTE', 'spot ' + fmtNum(d.spot, 2)];
      var a = ago(m.options_ts); if (a) parts.push((closed ? 'last session, ' : '') + a);
      meta.textContent = parts.join(' · ');
    }
    fetch('/api/gex/levels/SPX?dte=0', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || d.call_wall == null || d.put_wall == null || d.spot == null) throw new Error('no levels');
      real = true;
      lv = { call: d.call_wall, zero: d.zero_gamma, put: d.put_wall, spot: d.spot };
      ladder = (d.ladder || []).filter(function (x) { return x && isFinite(x.gex) && x.gex > 0; });
      GEX = d; paintMeta(d); s.dirty = true;
      if (REDUCE) draw(4000);
      setInterval(function () { paintMeta(d); }, 30000);
    }).catch(function () {
      meta.textContent = 'Illustrative levels (data did not load)';
    });

    var path = [], P = null, V = 0, r = rng(11);
    function draw(t) {
      var ctx = s.ctx, W = s.w, H = s.h; ctx.clearRect(0, 0, W, H);
      var vals = [lv.call, lv.put, lv.spot]; if (lv.zero != null) vals.push(lv.zero);
      var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals), pad = (hi - lo) * 0.28 || 1;
      hi += pad; lo -= pad;
      var y = function (v) { return 14 + (hi - v) / (hi - lo) * (H - 28); };
      var right = W - 6, ladW = Math.min(90, W * 0.22), plotR = right - ladW - 8;
      // strike ladder (real gamma by strike) as a soft right-hand histogram
      if (ladder.length) {
        var near = ladder.filter(function (x) { return x.strike >= lo && x.strike <= hi; });
        var mx = Math.max.apply(null, near.map(function (x) { return x.gex; }).concat([1]));
        near.forEach(function (x) {
          var w = Math.max(1, (x.gex / mx) * ladW), yy = y(x.strike);
          ctx.fillStyle = alpha(x.strike >= lv.zero ? COL['--bx-call'] : COL['--bx-put'], 0.35);
          ctx.fillRect(right - w, yy - 1.5, w, 3);
        });
      }
      // levels
      var levels = [['CALL WALL', lv.call, COL['--bx-call']], ['ZERO GAMMA', lv.zero, COL['--bx-zero']], ['PUT WALL', lv.put, COL['--bx-put']]]
        .sort(function (a, b) { return (b[1] == null ? -1e9 : b[1]) - (a[1] == null ? -1e9 : a[1]); });
      ctx.font = '600 10px "JetBrains Mono", monospace'; ctx.textBaseline = 'bottom';
      var placed = [];
      levels.forEach(function (L, i) {
        if (L[1] == null) return;
        var yy = Math.round(y(L[1])) + 0.5, pulse = REDUCE ? 0.5 : 0.35 + 0.25 * Math.sin(t / 700 + i * 2);
        ctx.fillStyle = alpha(L[2], 0.07 + pulse * 0.08);
        ctx.fillRect(0, yy - 7, plotR, 14);
        ctx.strokeStyle = L[2]; ctx.lineWidth = 1.2; ctx.setLineDash(i === 1 ? [4, 4] : []);
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotR, yy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = L[2];
        // two levels close together (zero gamma right on the put wall): the lower label goes under its line
        var below = placed.some(function (py) { return Math.abs(py - yy) < 16; });
        ctx.textBaseline = below ? 'top' : 'bottom';
        ctx.fillText(L[0] + (real ? '  ' + fmtNum(L[1], 0) : ''), 8, below ? yy + 3 : yy - 3);
        placed.push(yy);
      });
      // illustrative price path: mean-reverting walk pinned between the walls
      var top = Math.max(lv.call, lv.put), bot = Math.min(lv.call, lv.put), span = top - bot;
      if (P == null || s.dirty) { P = lv.spot; V = 0; path = []; s.dirty = false; }
      var steps = REDUCE || path.length < 2 ? 140 : 1;
      for (var k = 0; k < steps; k++) {
        if (steps > 1 || t - (draw.lt || 0) > 70) {
          draw.lt = t;
          V = V * 0.9 + (r() - 0.5) * span * 0.035 + (lv.spot - P) * 0.004;
          P += V;
          if (P > top - span * 0.02) { P = top - span * 0.02; V = -Math.abs(V) * 0.8; }
          if (P < bot + span * 0.02) { P = bot + span * 0.02; V = Math.abs(V) * 0.8; }
          path.push(P); if (path.length > 140) path.shift();
        }
      }
      var n = path.length, dx = plotR / 139;
      ctx.lineWidth = 2; ctx.lineJoin = 'round';
      var grad = ctx.createLinearGradient(0, 0, plotR, 0);
      grad.addColorStop(0, alpha(COL['--ink-0'], 0)); grad.addColorStop(1, alpha(COL['--ink-0'], 0.9));
      ctx.strokeStyle = grad; ctx.beginPath();
      for (var j = 0; j < n; j++) { var xx = plotR - (n - 1 - j) * dx, yv = y(path[j]); j ? ctx.lineTo(xx, yv) : ctx.moveTo(xx, yv); }
      ctx.stroke();
      if (n) {
        var hx = plotR, hy = y(path[n - 1]);
        ctx.fillStyle = alpha(COL['--gold'], 0.25); ctx.beginPath(); ctx.arc(hx, hy, 7 + (REDUCE ? 0 : 2 * Math.sin(t / 250)), 0, 7); ctx.fill();
        ctx.fillStyle = COL['--ink-0']; ctx.beginPath(); ctx.arc(hx, hy, 3.2, 0, 7); ctx.fill();
      }
    }
    register($('.bx-gex'), draw, s);
  })();

  // ------------------------------------------------------------ Charts tile (draws itself)
  (function () {
    var cv = $('.bx-chart-cv'); if (!cv) return;
    var s = surface(cv), tools = $$('.bx-tools i'), CYCLE = 9000, seed = 3, data = candles(64, seed, 100, 1.3);
    function setTool(i) { tools.forEach(function (el, k) { el.classList.toggle('is-on', k === i); }); }
    function draw(t) {
      var ctx = s.ctx, W = s.w, H = s.h; ctx.clearRect(0, 0, W, H);
      var ph = REDUCE ? CYCLE - 1500 : t % CYCLE, cyc = Math.floor(t / CYCLE);
      if (!REDUCE && cyc + 3 !== seed) { seed = cyc + 3; data = candles(64, seed, 100, 1.3); }
      var vpW = Math.min(70, W * 0.18), plotW = W - vpW - 10, n = data.length, step = plotW / n;
      var lo = Infinity, hi = -Infinity; data.forEach(function (c) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
      var top = 12, bot = H - 18, y = function (v) { return bot - (v - lo) / (hi - lo) * (bot - top); };
      // grid
      ctx.strokeStyle = COL['--line-soft']; ctx.lineWidth = 1;
      for (var g = 1; g < 5; g++) { var gy = Math.round(top + (bot - top) * g / 5) + 0.5; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
      // candles appear over 0..3.2 s
      var shown = Math.floor(ease(ph / 3200) * n);
      for (var i = 0; i < shown; i++) {
        var c = data[i]; drawCandle(ctx, i * step + step / 2, step * 0.6, y(c.o), y(c.h), y(c.l), y(c.c), c.c >= c.o);
      }
      // EMA line after 2.4 s
      if (ph > 2400) {
        var k = 2 / 10, e = data[0].c, upto = Math.min(shown, Math.floor(n * ease((ph - 2400) / 1200)));
        ctx.strokeStyle = COL['--amber']; ctx.lineWidth = 1.6; ctx.beginPath();
        for (var m = 0; m < upto; m++) { e = data[m].c * k + e * (1 - k); var ex = m * step + step / 2; m ? ctx.lineTo(ex, y(e)) : ctx.moveTo(ex, y(e)); }
        ctx.stroke();
      }
      // volume profile on the right after 3.4 s
      if (ph > 3400) {
        var bins = 18, hist = new Array(bins).fill(0);
        data.forEach(function (c) { var b = clamp(Math.floor((c.c - lo) / (hi - lo) * bins), 0, bins - 1); hist[b] += c.v; });
        var mxh = Math.max.apply(null, hist), poc = hist.indexOf(mxh), bh = (bot - top) / bins, kk = ease((ph - 3400) / 900);
        for (var b = 0; b < bins; b++) {
          var bw = hist[b] / mxh * vpW * kk;
          ctx.fillStyle = b === poc ? alpha(COL['--gold'], 0.75) : alpha(COL['--teal'], 0.32);
          ctx.fillRect(W - bw, bot - (b + 1) * bh + 1, bw, bh - 2);
        }
      }
      // trend line drawn 4.4..5.6 s, then a FVG box 5.8..6.8 s
      var tool = ph < 3400 ? 0 : ph < 5700 ? 1 : ph < 7000 ? 3 : 0;
      if (ph > 4400) {
        var a = 0, b2 = Math.floor(n / 2), half = Math.floor(n / 2);
        for (var q = 0; q < half; q++) if (data[q].l < data[a].l) a = q;
        for (var q2 = half; q2 < n; q2++) if (data[q2].l < data[b2].l) b2 = q2;
        var kx = ease((ph - 4400) / 1200), x1 = a * step + step / 2, y1 = y(data[a].l) + 2, x2 = b2 * step + step / 2, y2 = y(data[b2].l) + 2;
        var sl = (y2 - y1) / (x2 - x1 || 1), xe = x1 + (plotW - x1) * kx;
        ctx.strokeStyle = COL['--teal']; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(xe, y1 + sl * (xe - x1)); ctx.stroke();
        ctx.fillStyle = COL['--teal']; ctx.beginPath(); ctx.arc(x1, y1, 3, 0, 7); ctx.fill();
        if (kx > 0.6) { ctx.beginPath(); ctx.arc(x2, y2, 3, 0, 7); ctx.fill(); }
      }
      if (ph > 5800) {
        var kb = ease((ph - 5800) / 900), bx = n * 0.55 * step, by = y(data[Math.floor(n * 0.55)].h) - 6;
        ctx.fillStyle = alpha(COL['--gold'], 0.13 * kb); ctx.strokeStyle = alpha(COL['--gold'], 0.7 * kb); ctx.lineWidth = 1;
        ctx.fillRect(bx, by, (plotW - bx) * kb, 18); ctx.strokeRect(bx + 0.5, by + 0.5, (plotW - bx) * kb, 18);
        ctx.fillStyle = alpha(COL['--gold'], kb); ctx.font = '600 10px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
        ctx.fillText('FVG', bx + 6, by + 9);
      }
      // fade out at the end of the cycle
      if (!REDUCE && ph > CYCLE - 600) { ctx.fillStyle = alpha(COL['--bg-1'], ease((ph - (CYCLE - 600)) / 600)); ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
      setTool(tool);
    }
    register($('.bx-charts'), draw, s);
  })();

  // ------------------------------------------------------------ Replay tile
  (function () {
    var cv = $('.bx-replay-cv'); if (!cv) return;
    var s = surface(cv), N = 46, data = candles(N, 21, 100, 1.2), btn = $('#bx-play'), fill = $('#bx-scrub-fill'), knob = $('#bx-scrub-knob');
    var playing = !REDUCE, pos = REDUCE ? N : 6, BAR = 380, acc = 0, seed = 21;
    btn.setAttribute('aria-pressed', String(playing)); btn.setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); playing = !playing;
      btn.setAttribute('aria-pressed', String(playing)); btn.setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
      if (playing && pos >= N) { pos = 4; }
      kick();
    });
    function draw(t, dt) {
      if (playing && !REDUCE) {
        acc += dt;
        while (acc > BAR) { acc -= BAR; pos++; if (pos > N + 6) { pos = 4; seed++; data = candles(N, seed, 100, 1.2); } }
      }
      var ctx = s.ctx, W = s.w, H = s.h; ctx.clearRect(0, 0, W, H);
      var lo = Infinity, hi = -Infinity; data.forEach(function (c) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
      var top = 10, bot = H - 10, y = function (v) { return bot - (v - lo) / (hi - lo) * (bot - top); }, step = W / N;
      var shown = Math.min(N, pos), frac = playing && pos < N ? acc / BAR : 1;
      for (var i = 0; i < shown; i++) {
        var c = data[i], last = i === shown - 1 && pos < N;
        if (last) {
          // the forming bar: close travels from open to its final value
          var cc = c.o + (c.c - c.o) * ease(frac), hh = Math.max(c.o, cc) + (c.h - Math.max(c.o, c.c)) * frac, ll = Math.min(c.o, cc) - (Math.min(c.o, c.c) - c.l) * frac;
          drawCandle(ctx, i * step + step / 2, step * 0.6, y(c.o), y(hh), y(ll), y(cc), cc >= c.o);
        } else drawCandle(ctx, i * step + step / 2, step * 0.6, y(c.o), y(c.h), y(c.l), y(c.c), c.c >= c.o, 0.95);
      }
      // the "future" area stays dark
      var fx = shown * step;
      ctx.fillStyle = alpha(COL['--ink-0'], 0.035); ctx.fillRect(fx, 0, W - fx, H);
      ctx.strokeStyle = alpha(COL['--gold'], 0.6); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(Math.round(fx) + 0.5, 0); ctx.lineTo(Math.round(fx) + 0.5, H); ctx.stroke(); ctx.setLineDash([]);
      var k = clamp((shown - 1 + (pos < N ? frac : 0)) / (N - 1), 0, 1);
      fill.style.transform = 'scaleX(' + k.toFixed(4) + ')';
      knob.style.transform = 'translateX(' + (k * knob.parentNode.clientWidth).toFixed(1) + 'px)';
    }
    register($('.bx-replay'), draw, s);
  })();

  // ------------------------------------------------------------ Journal heatmap + coach
  (function () {
    var host = $('#bx-heat'); if (!host) return;
    var r = rng(5), html = '', cls = ['w1', 'w2', 'w3', 'l1', 'l2', 'off'];
    for (var i = 0; i < 56; i++) {
      var dow = i % 7, c;
      if (dow >= 5) c = 'off';
      else { var x = r(); c = x < 0.2 ? '' : x < 0.42 ? 'w1' : x < 0.6 ? 'w2' : x < 0.7 ? 'w3' : x < 0.86 ? 'l1' : 'l2'; }
      html += '<i class="' + c + '" style="--d:' + i + '"></i>';
    }
    // laid out as 4 rows of 14 (two weeks per row)
    host.innerHTML = html;
    var msgs = [
      'Checks your trades against your own rules.',
      'Flags trades taken outside your planned session.',
      'Spots days where size crept above your plan.',
      'Groups setups so you can review them side by side.'
    ];
    var msg = $('#bx-coach-msg'), mi = 0, cells = $$('i', host).filter(function (el) { return !el.classList.contains('off'); });
    if (REDUCE) return;
    setInterval(function () {
      if (doc.hidden) return;
      mi = (mi + 1) % msgs.length;
      msg.classList.add('is-out');
      setTimeout(function () { msg.textContent = msgs[mi]; msg.classList.remove('is-out'); }, 350);
      var el = cells[Math.floor(r() * cells.length)];
      el.classList.remove('is-ping'); void el.offsetWidth; el.classList.add('is-ping');
    }, 2800);
    void cls;
  })();

  // ------------------------------------------------------------ Learn flip cards (real chapter titles)
  (function () {
    var host = $('#bx-flips'); if (!host) return;
    var CH = [
      ['CH 01', 'Candles, Charts & the Language of Price'], ['CH 07', 'Liquidity: BSL, SSL & Resting Orders'],
      ['CH 09', 'Order Blocks: Identification & Validity'], ['CH 10', 'Fair Value Gaps & Imbalance'],
      ['CH 13', 'Killzones & Session Timing'], ['CH 18', 'Introduction to SMT Divergence'],
      ['CH 24', 'Power of Three: AMD in Practice'], ['CH 26', 'Optimal Trade Entry (OTE) Zones'],
      ['VP 03', 'Volume Profile Anatomy: POC, Value Area, HVN & LVN'], ['VP 08', 'Footprint Charts & Delta'],
      ['PF 04', 'The Rules Deep Dive'], ['PF 06', 'Passing the Evaluation: Sizing, Risk Plan & Frequency']
    ];
    var face = function (c) { return '<small>' + c[0] + '</small><b>' + c[1].replace(/&/g, '&amp;') + '</b>'; };
    var cards = [], next = 4;
    for (var i = 0; i < 4; i++) {
      var el = doc.createElement('div'); el.className = 'bx-flip';
      el.innerHTML = '<div>' + face(CH[i]) + '</div><div>' + face(CH[(i + 4) % CH.length]) + '</div>';
      host.appendChild(el); cards.push(el);
    }
    if (REDUCE) return;
    var k = 0;
    setInterval(function () {
      if (doc.hidden) return;
      var el = cards[k % 4], flipped = el.classList.contains('is-flipped');
      // load the hidden face with the next chapter, then flip to it
      el.children[flipped ? 0 : 1].innerHTML = face(CH[next % CH.length]);
      next++;
      el.classList.toggle('is-flipped');
      k++;
    }, 1700);
  })();

  // ------------------------------------------------------------ Market desk: next high-impact events
  (function () {
    var ul = $('#bx-ev'); if (!ul) return;
    var fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var esc = function (x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    fetch('assets/econ-calendar.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
      var now = Date.now();
      var ev = (d.events || []).filter(function (e) { return e.impact === 'high' && Date.parse(e.at) > now; })
        .sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); }).slice(0, 4);
      if (!ev.length) { ul.innerHTML = '<li class="bx-muted">No high-impact releases left in this calendar window.</li>'; return; }
      ul.innerHTML = ev.map(function (e) {
        return '<li><span class="ev-cur">' + esc(e.cur) + '</span><span class="ev-name"><span class="ev-hi" aria-label="High impact"></span>' + esc(e.event) + '</span><span class="ev-at">' + esc(fmt.format(new Date(e.at))) + '</span></li>';
      }).join('');
    }).catch(function () { ul.innerHTML = '<li class="bx-muted">The calendar did not load. Open the full calendar.</li>'; });
  })();

  // ------------------------------------------------------------ expand overlay
  (function () {
    var ov = $('#bx-ov'); if (!ov) return;
    var panel = $('.bx-ov-panel', ov), opener = null;
    var V = {
      gex: { k: 'GEX levels', t: 'Free SPX GEX, with every level on the chart', p: 'Call wall, zero gamma and put wall from the options chain, plotted on the futures chart, with the strike ladder and regime notes. The Free plan covers SPX same-day (0DTE); Pro opens every symbol and expiry. Education only. Not financial advice.', img: 'assets/images/gex-real/chart-nq-5m-plot.webp', go: 'gex', b: 'Open GEX' },
      charts: { k: 'Charts', t: 'Watchlist, Layouts 1–8, Pine scripts, Volume Profile', p: 'Candles from public exchange feeds, 70+ built-in indicators, drawing tools, up to 8 charts on one screen, Pine scripts from you and the community, and our own session Volume Profile.', img: 'assets/images/charts/hero.webp', go: 'charts', b: 'Open Charts' },
      journal: { k: 'Journal', t: 'A P&L calendar and a coach that reads your own trades', p: 'Log trades by hand or import them, see every day on the calendar, and let the rule-based AI coach point out where you broke your own plan. Screenshot shows sample data.', img: 'assets/images/journal/calendar.webp', go: 'trade-journal', b: 'Open Journal' }
    };
    function open(key, tile) {
      var v = V[key]; if (!v) return;
      opener = doc.activeElement;
      $('#bx-ov-k').textContent = v.k; $('#bx-ov-title').textContent = v.t; $('#bx-ov-p').textContent = v.p;
      var img = $('#bx-ov-img'); img.src = v.img + '?v=440'; img.alt = v.t;
      var go = $('#bx-ov-go'); go.href = v.go; go.textContent = v.b + ' →';
      var r = tile.getBoundingClientRect();
      ov.hidden = false; doc.body.classList.add('bx-locked');
      // grow out of the tile that was clicked (offset* ignore the scale transform)
      var pl = panel.offsetLeft, pt = panel.offsetTop;
      panel.style.setProperty('--ox', Math.round(r.left + r.width / 2 - pl) + 'px');
      panel.style.setProperty('--oy', Math.round(r.top + r.height / 2 - pt) + 'px');
      requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add('is-open'); panel.focus(); }); });
    }
    function close() {
      ov.classList.remove('is-open'); doc.body.classList.remove('bx-locked');
      setTimeout(function () { ov.hidden = true; }, REDUCE ? 0 : 320);
      if (opener && opener.focus) opener.focus();
    }
    $$('.bx-expandable').forEach(function (tile) {
      tile.addEventListener('click', function (e) {
        if (e.target.closest('a') || (e.target.closest('button') && !e.target.closest('.bx-exp-btn'))) return;
        open(tile.getAttribute('data-expand'), tile);
      });
    });
    ov.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    doc.addEventListener('keydown', function (e) {
      if (ov.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { // keep focus inside the dialog
        var f = $$('a,button', panel), first = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && doc.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      }
    });
  })();

  // ------------------------------------------------------------ theme toggle
  (function () {
    var b = $('#bx-theme'); if (!b) return;
    b.addEventListener('click', function () {
      var day = root.getAttribute('data-theme') !== 'light';
      if (day) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem('stryker_theme', day ? 'day' : 'night'); } catch (e) {}
      readColors();
      if (REDUCE) tiles.forEach(function (t) { t.draw(4000, 0); });
    });
  })();

  readColors();
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(readColors);
  if (REDUCE) tiles.forEach(function (t) { t.draw(4000, 0); });
  kick();
})();
