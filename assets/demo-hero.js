// Stryker Trading Academy: /demo-hero (unlisted preview page), round 2
//
// Behaviour for the four hero variations on demo-hero.html (markup generated
// by tools/demo-hero/gen.py from tools/demo-hero/body.html).
//
//   candles   the homepage falling-candle field, one canvas per [data-candles]
//             hero, 30 fps, only while that hero is on screen
//   A chart   an illustrative SVG session: candles print one by one, price
//             runs into the call wall, wicks through and turns down to the
//             zero-gamma flip (ring on the touch). Tabs GEX / Volume / ICT
//             swap the overlay; they auto-cycle until the visitor picks one.
//   B chart   full-bleed canvas: an illustrative path walking between a
//             glowing call wall and a teal zero-gamma line, scrolling left.
//             The session clock rides the last price as an axis tag.
//   C tape    the homepage ticker-tape look, filled with true facts
//   D stack   three desk cards fan out as the hero scrolls into view; real
//             SPX 0DTE call wall / zero gamma / put wall + "updated N min ago"
//   session   StrykerMarketHours.sessionLabel: a clock computed from session
//             hours, never market data. GEX age from market.options_ts.
//             Never "live", "real-time" or "delayed".
//   free N    Free plan chapterAccess (Firestore plans); enrolled count only
//             from publicStats/enrollment.
//
// Reduced motion: no candle field, charts drawn once complete, no tape scroll,
// cards shown fanned. Everything pauses off screen and in hidden tabs.

(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var NS = 'http://www.w3.org/2000/svg';
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function seeded(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function cssVar(n, fb) { var v = getComputedStyle(root).getPropertyValue(n).trim(); return v || fb; }
  function isLight() { return root.getAttribute('data-theme') === 'light'; }

  // ------------------------------------------------------------ theme + nav copies
  var tb = $('#xh-theme');
  if (tb) tb.addEventListener('click', function () {
    if (typeof window.toggleStrykerTheme === 'function') { window.toggleStrykerTheme(); }
    else {
      var toDay = !isLight();
      if (toDay) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem('stryker_theme', toDay ? 'day' : 'night'); } catch (e) {}
    }
    setTimeout(readColors, 50);
  });
  $$('.xh-nav-copy .nav-toggle').forEach(function (b) {
    b.addEventListener('click', function () { var l = b.closest('.nav').querySelector('.nav-links'); if (l) l.classList.toggle('xh-open'); });
  });

  var COL = {};
  function readColors() {
    COL = { gold: cssVar('--gold', '#03c988'), teal: cssVar('--teal', '#00adb5'), bear: cssVar('--bear', '#e5484d'),
      line: cssVar('--line-soft', '#19191d'), ink: cssVar('--ink-2', '#8b93a0'), dim: cssVar('--gold-dim', '#027a54'), light: isLight() };
  }
  readColors();
  window.addEventListener('stryker:theme', function () { setTimeout(readColors, 30); });

  // ------------------------------------------------------------ visibility
  var vis = {};
  var vars = $$('.xh-var'), chips = $$('.xh-switch a');
  var watchers = [];   // {el, on(bool)}
  function onVis(el, fn) { watchers.push({ el: el, fn: fn }); }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        en.target.classList.toggle('xh-off', !en.isIntersecting);
        watchers.forEach(function (w) { if (w.el === en.target) w.fn(en.isIntersecting); });
      });
    }, { rootMargin: '40px 0px' });
    vars.forEach(function (v) { io.observe(v); });
  } else {
    setTimeout(function () { watchers.forEach(function (w) { w.fn(true); }); }, 0);
  }
  function lightChip() {
    var line = window.innerHeight * 0.4, pick = 'A';
    vars.forEach(function (v) { if (v.getBoundingClientRect().top <= line) pick = v.id.slice(4); });
    chips.forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-v') === pick); });
  }

  // ------------------------------------------------------------ falling candles
  $$('[data-candles]').forEach(function (hero, hi) {
    if (reduced) return;
    var c = document.createElement('canvas'); c.className = 'xh-cnv'; c.setAttribute('aria-hidden', 'true');
    hero.insertBefore(c, hero.firstChild);
    var ctx = c.getContext('2d'), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.5), list = [], raf = 0, last = 0, on = false;
    function build() {
      W = hero.offsetWidth; H = hero.offsetHeight; c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + 'px'; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var r = seeded(4242 + hi * 77), n = Math.round(W / 46); list = [];
      for (var i = 0; i < n; i++) list.push({ x: (i / n) * W + r() * 14, y: r() * H, h: 14 + r() * 46, w: 3 + r() * 3, sp: .12 + r() * .3, up: r() > .45, a: .05 + r() * .13 });
    }
    function frame(t) {
      raf = 0; if (!on || document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (t - last < 33) return; last = t;
      ctx.clearRect(0, 0, W, H);
      var k = COL.light ? .55 : 1;
      for (var i = 0; i < list.length; i++) {
        var q = list[i]; q.y += q.sp; if (q.y > H + q.h) q.y = -q.h - 40;
        ctx.globalAlpha = q.a * k; ctx.fillStyle = q.up ? COL.gold : COL.bear;
        ctx.fillRect(q.x, q.y, q.w, q.h); ctx.fillRect(q.x + q.w / 2 - .5, q.y - 6, 1, q.h + 12);
      }
      ctx.globalAlpha = 1;
    }
    build();
    window.addEventListener('resize', build, { passive: true });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && on && !raf) raf = requestAnimationFrame(frame); });
    onVis(hero.closest('.xh-var'), function (v) { on = v; if (on && !raf) raf = requestAnimationFrame(frame); });
  });

  // ------------------------------------------------------------ A: chart card
  (function () {
    var host = $('[data-chart="a"]'); if (!host) return;
    var CALL = 48, ZERO = 128, PUT = 206, STEP = 10.6, X0 = 12;
    var closes = [172, 166, 170, 160, 156, 150, 153, 142, 136, 128, 131, 118, 110, 104, 96, 90, 82, 74, 66, 58,
                  63, 76, 88, 94, 102, 109, 104, 116, 122, 128, 124, 134, 139, 133];
    var r = seeded(91), C = [];
    for (var i = 0; i < closes.length; i++) {
      var o = i ? closes[i - 1] : 176, cl = closes[i];
      var hiY = Math.min(o, cl) - (2 + r() * 6), loY = Math.max(o, cl) + (2 + r() * 6);
      if (i === 19) hiY = 38;            // the wick through the call wall
      if (i === 20) hiY = 50;
      C.push({ o: o, c: cl, h: hiY, l: loY, x: X0 + i * STEP });
    }
    var TOUCH = 19;
    function el(tag, at, parent) { var e = document.createElementNS(NS, tag); for (var k in at) e.setAttribute(k, at[k]); if (parent) parent.appendChild(e); return e; }
    var svg = el('svg', { viewBox: '0 0 400 240', width: '100%', 'aria-hidden': 'true' });
    var g0 = el('g', { 'class': 'xs-grid' }, svg);
    [40, 90, 140, 190, 230].forEach(function (y) { el('line', { x1: 0, y1: y, x2: 400, y2: y }, g0); });
    // GEX layer
    var gex = el('g', { 'class': 'xs-layer xs-gex' }, svg);
    [[CALL, 'xs-call', 'CALL WALL'], [ZERO, 'xs-zero', 'ZERO \u03b3 FLIP'], [PUT, 'xs-put', 'PUT WALL']].forEach(function (L) {
      var g = el('g', { 'class': 'xs-lv ' + L[1] }, gex);
      el('line', { x1: 0, y1: L[0], x2: 400, y2: L[0] }, g);
      var t = el('text', { x: 396, y: L[0] - 5, 'text-anchor': 'end' }, g); t.textContent = L[2];
    });
    // Volume profile layer (from the drawn candles)
    var vp = el('g', { 'class': 'xs-layer xs-vp xs-off' }, svg);
    var rows = [], ROW = 8, top = 36;
    for (var y = top; y < 220; y += ROW) rows.push({ y: y, n: 0 });
    C.forEach(function (k) { rows.forEach(function (rw) { if (rw.y + ROW > k.h && rw.y < k.l) rw.n += (k.l - k.h) < 30 ? 2 : 1; }); });
    var mx = Math.max.apply(null, rows.map(function (q) { return q.n; })), poc = 0;
    rows.forEach(function (q, i) { if (q.n === mx && !poc) poc = i; });
    var tot = rows.reduce(function (a, q) { return a + q.n; }, 0), lo = poc, hi = poc, acc = rows[poc].n;
    while (acc < tot * .7 && (lo > 0 || hi < rows.length - 1)) {
      var up = hi < rows.length - 1 ? rows[hi + 1].n : -1, dn = lo > 0 ? rows[lo - 1].n : -1;
      if (up >= dn) { hi++; acc += up; } else { lo--; acc += dn; }
    }
    rows.forEach(function (q, i) { el('rect', { x: 398 - q.n / mx * 70, y: q.y + 1, width: q.n / mx * 70, height: ROW - 2, rx: 1, 'class': i === poc ? 'poc' : '' }, vp); });
    [[rows[lo].y, 'VAH'], [rows[poc].y + ROW / 2, 'POC'], [rows[hi].y + ROW, 'VAL']].forEach(function (L) {
      el('line', { x1: 0, y1: L[0], x2: 400, y2: L[0] }, vp);
      var t = el('text', { x: 4, y: L[0] - 4 }, vp); t.textContent = L[1];
    });
    // ICT layer
    var ict = el('g', { 'class': 'xs-layer xs-ict xs-off' }, svg);
    el('rect', { 'class': 'fvg', x: C[20].x, y: 66, width: STEP * 5, height: 10, rx: 1 }, ict);
    var ft = el('text', { x: C[20].x + STEP * 5 + 4, y: 74 }, ict); ft.textContent = 'FVG';
    el('line', { 'class': 'mss', x1: C[10].x, y1: 131, x2: C[32].x + 4, y2: 131 }, ict);
    var mt = el('text', { x: C[10].x - 2, y: 145 }, ict); mt.textContent = 'MSS';
    var jt = el('text', { x: C[TOUCH].x + 8, y: 34 }, ict); jt.textContent = 'SWEEP';
    // candles
    var cg = el('g', {}, svg), nodes = [];
    C.forEach(function (k) {
      var g = el('g', { 'class': 'xs-c ' + (k.c <= k.o ? 'xs-up' : 'xs-dn') }, cg);
      el('rect', { 'class': 'xs-w', x: k.x + 3, y: k.h, width: 1.2, height: k.l - k.h }, g);
      el('rect', { x: k.x + .6, y: Math.min(k.o, k.c), width: 6, height: Math.max(1.5, Math.abs(k.o - k.c)), rx: 1 }, g);
      nodes.push(g);
    });
    var ring = el('circle', { 'class': 'xs-touch', cx: C[TOUCH].x + 3.6, cy: CALL, r: 7 }, svg);
    host.appendChild(svg);

    var CAPS = {
      gex: '<b>Call wall.</b> The strike with the most call gamma above price. Watch how price behaves when it gets there.',
      vp: '<b>Volume profile.</b> Where the session traded most: the POC, and the value area between VAH and VAL.',
      ict: '<b>ICT read.</b> A sweep above the high, a fair value gap left on the way down, then a market structure shift.'
    };
    var tabs = $$('.xa-tabs button'), cap = $('.xa-cap'), layers = { gex: gex, vp: vp, ict: ict }, lens = 'gex', picked = false;
    function setLens(k) {
      lens = k;
      tabs.forEach(function (t) { t.setAttribute('aria-selected', t.getAttribute('data-lens') === k ? 'true' : 'false'); });
      for (var n in layers) layers[n].classList.toggle('xs-off', n !== k);
      cap.innerHTML = CAPS[k];
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { picked = true; setLens(t.getAttribute('data-lens')); }); });

    if (reduced) return;
    var shown = 0, timer = 0, on = false, ORDER = ['gex', 'vp', 'ict'], cycleAt = 0;
    function hideAll() { nodes.forEach(function (n) { n.classList.add('xs-hide'); }); shown = 0; }
    function tick() {
      timer = 0; if (!on || document.hidden) return;
      if (shown < nodes.length) {
        nodes[shown].classList.remove('xs-hide');
        if (shown === TOUCH) { ring.classList.remove('go'); void ring.getBBox(); ring.classList.add('go'); }
        shown++; timer = setTimeout(tick, shown === TOUCH + 1 ? 700 : 170);
      } else {
        cycleAt++;
        if (!picked) setLens(ORDER[cycleAt % 3]);
        timer = setTimeout(function () { hideAll(); tick(); }, 4200);
      }
    }
    hideAll();
    onVis(host.closest('.xh-var'), function (v) { on = v; if (on && !timer) timer = setTimeout(tick, 300); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && on && !timer) tick(); });
  })();

  // ------------------------------------------------------------ B: full-bleed chart
  var bTags = null;
  (function () {
    var host = $('[data-chart="b"]'); if (!host) return;
    var hero = host.closest('.xh-hero');
    var c = document.createElement('canvas'); host.appendChild(c);
    var ctx = c.getContext('2d'), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var SP = 15, list = [], r = seeded(2207), p = .2, lv = {};
    var bi = 0;
    function nextBar() {
      // a drawn swing: rallies into the call wall (sometimes wicking through),
      // fades back toward zero gamma, repeats with noise
      var o = p;
      bi++;
      p = .48 + .56 * Math.sin(bi * .16) + .12 * Math.sin(bi * .53) + (r() - .5) * .08;
      p = clamp(p, -.15, .99);
      var hi = Math.max(o, p) + r() * .06, lo = Math.min(o, p) - r() * .06;
      if (Math.max(o, p) > .9) hi = 1.02 + r() * .06;
      list.push({ o: o, c: p, h: hi, l: lo });
    }
    function layout() {
      W = hero.offsetWidth; H = hero.offsetHeight;
      c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var phone = W < 640;
      lv = phone ? { call: H - 250, zero: H - 120, unit: 130 } : { call: H * .3, zero: H * .72, unit: H * .42 };
      var need = Math.ceil(W / SP) + 4;
      while (list.length < need) nextBar();
      if (list.length > need + 5) list = list.slice(list.length - need - 5);
    }
    function Y(v) { return lv.zero - v * lv.unit; }
    var tagCall, tagZero, tagSess;
    function mkTag(cls) { var t = document.createElement('div'); t.className = 'xb-tag ' + cls; t.innerHTML = '<span></span>'; hero.appendChild(t); return t; }
    tagCall = mkTag('xb-t-call'); tagZero = mkTag('xb-t-zero'); tagSess = mkTag('xb-t-sess');
    tagCall.firstChild.textContent = 'CALL WALL'; tagZero.firstChild.textContent = 'ZERO \u03b3';
    bTags = { sess: tagSess };
    var off = 0;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      var right = W - (W < 640 ? 108 : 150);
      ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
      for (var gy = 0; gy < H; gy += 64) { ctx.beginPath(); ctx.moveTo(0, gy + .5); ctx.lineTo(W, gy + .5); ctx.stroke(); }
      // walls
      ctx.save(); ctx.strokeStyle = COL.gold; ctx.lineWidth = 2; ctx.shadowColor = COL.gold; ctx.shadowBlur = COL.light ? 0 : 16;
      var wx = W < 640 ? 0 : W * .5;
      ctx.beginPath(); ctx.moveTo(wx, Y(1)); ctx.lineTo(W, Y(1)); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = COL.light ? .07 : .06; ctx.fillStyle = COL.gold; ctx.fillRect(wx, Y(1), W - wx, Y(0) - Y(1)); ctx.restore();
      ctx.save(); ctx.strokeStyle = COL.teal; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(wx, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke(); ctx.restore();
      // candles, newest at `right`
      var n = list.length, bw = 8, minX = W < 640 ? -SP : W * .55;
      for (var i = 0; i < n; i++) {
        var k = list[i], x = right - (n - 1 - i) * SP - off;
        if (x < minX) continue;
        var up = k.c >= k.o; ctx.fillStyle = up ? COL.gold : COL.bear;
        ctx.globalAlpha = .9;
        ctx.fillRect(x + bw / 2 - .6, Y(k.h), 1.2, Y(k.l) - Y(k.h));
        var y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
        ctx.fillRect(x, y1, bw, Math.max(1.5, y2 - y1));
      }
      ctx.globalAlpha = 1;
      // last price line
      var lastY = Y(list[n - 1].c);
      ctx.save(); ctx.strokeStyle = COL.ink; ctx.globalAlpha = .5; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(right - 40, lastY); ctx.lineTo(W, lastY); ctx.stroke(); ctx.restore();
      tagCall.style.top = Y(1) + 'px'; tagZero.style.top = Y(0) + 'px';
      var sy = lastY; if (Math.abs(sy - Y(1)) < 28) sy = Y(1) + 30; if (Math.abs(sy - Y(0)) < 28) sy = Y(0) - 30;
      tagSess.style.top = sy + 'px';
    }
    layout(); draw();
    window.addEventListener('resize', function () { layout(); draw(); }, { passive: true });
    window.addEventListener('stryker:theme', function () { setTimeout(draw, 60); });
    if (tb) tb.addEventListener('click', function () { setTimeout(draw, 80); });
    if (reduced) return;
    var on = false, raf = 0, t0 = 0, last = 0, BAR = 1100;
    function frame(t) {
      raf = 0; if (!on || document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (t - last < 33) return; last = t;
      if (!t0) t0 = t;
      var f = (t - t0) / BAR;
      if (f >= 1) { t0 = t; f = 0; nextBar(); list.shift(); }
      off = f * SP;   // the chart slides one bar per BAR ms
      draw();
    }
    onVis(hero.closest('.xh-var'), function (v) { on = v; if (on && !raf) raf = requestAnimationFrame(frame); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && on && !raf) raf = requestAnimationFrame(frame); });
  })();

  // ------------------------------------------------------------ C: tape
  var tapeHTML = function (sess, gexAge) {
    var it = [
      '<b>64</b> chapters', '<i>FREE</i> SPX GEX levels' + (gexAge ? ' \u00b7 ' + esc(gexAge) : ''), '<b>70+</b> chart indicators',
      'up to <b>8</b> charts per layout', 'chapters <b class="xh-freeN">' + esc(freeN) + '</b> free', 'ICT \u00b7 SMT \u00b7 Volume Profile',
      'session clock: <b>' + esc(sess || 'Asia \u00b7 London \u00b7 New York') + '</b>'
    ];
    if (enrolled) it.push('<b>' + enrolled + '</b> traders enrolled');
    var one = it.map(function (s) { return '<span>' + s + '</span>'; }).join('<s>\u00b7</s>') + '<s>\u00b7</s>';
    return one + one;
  };
  var freeN = '1\u201310', enrolled = '', gexAgeText = '', sessShort = '';
  function paintTape() { var h = tapeHTML(sessShort, gexAgeText); $$('[data-tape]').forEach(function (e) { if (e.innerHTML !== h) e.innerHTML = h; }); }
  paintTape();

  // ------------------------------------------------------------ D: fan on scroll
  var stack = $('.xd-stack');
  function fan() {
    if (!stack || reduced) return;
    var r = stack.getBoundingClientRect(), vh = window.innerHeight;
    var f = clamp((vh - r.top) / (vh * .75), 0, 1);
    stack.style.setProperty('--f', (1 - Math.pow(1 - f, 2)).toFixed(3));
  }

  // ------------------------------------------------------------ session clock
  var MH = window.StrykerMarketHours;
  function both(longH, shortH) { return '<span class="xh-l">' + longH + '</span><span class="xh-s">' + shortH + '</span>'; }
  function tickSession() {
    if (!MH || !MH.sessionLabel) return;
    var now = Date.now(), L = MH.sessionLabel(now);
    var head = L.sessions.length ? L.sessions.join(' & ') + ' open' : (L.weekend ? 'Weekend, no session open' : 'No session open');
    var left = L.next ? MH.fmtClock(L.next.at - now) : '';
    var longH = '<b>' + esc(head) + '</b>' + (L.next ? ' \u00b7 ' + esc(L.next.name) + ' opens in ' + left : '');
    var shortH = '<b>' + esc(L.shortHead) + '</b>' + (L.next ? ' \u00b7 ' + esc(L.next.short) + ' in ' + left : '');
    var chip = $('[data-session]');
    if (chip) { var t = $('.xh-chip-t', chip), h = both(longH, shortH); if (t.innerHTML !== h) t.innerHTML = h; chip.classList.toggle('is-on', L.open); }
    var line = $('[data-session-line]'); if (line) line.innerHTML = both(longH, shortH);
    if (bTags) bTags.sess.firstChild.innerHTML = both(esc(L.text.replace('Next Session: ', '')).toUpperCase(), esc(L.short).toUpperCase());
    var dh = $('[data-sess-head]'); if (dh) dh.textContent = L.shortHead;
    var dl = $('[data-sess-left]'); if (dl) dl.textContent = left || '--:--:--';
    var dn = $('[data-sess-next]'); if (dn) dn.textContent = L.next ? 'until ' + L.next.name + ' opens' : '';
    $$('.xd-sess span').forEach(function (s) { s.classList.toggle('on', L.sessions.indexOf(s.getAttribute('data-s')) >= 0); });
    sessShort = L.short;
  }
  if (MH && MH.sessionLabel) { tickSession(); setInterval(tickSession, 1000); setInterval(paintTape, 15000); paintTape(); }

  // ------------------------------------------------------------ GEX levels (D card + tape)
  (function () {
    var age = $('[data-gex-age]');
    function fmt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
    fetch('/api/gex/levels/SPX?dte=0', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || d.call_wall == null) throw new Error('no levels');
      $$('[data-lv]').forEach(function (b) { var v = d[b.getAttribute('data-lv')]; b.textContent = v == null ? '\u2013' : fmt(v); });
      var m = d.market || {}, at = +m.options_ts || +m.data_ts || +d.fetched_at || 0;
      var closed = !!(m.state && m.state !== 'open' && m.state !== 'stale');
      function paint() {
        if (!at) return;
        var mins = Math.max(0, Math.round((Date.now() / 1000 - at) / 60)), s;
        if (mins < 60) s = 'updated ' + mins + ' min ago'; else if (mins < 2880) s = 'updated ' + Math.floor(mins / 60) + ' h ago'; else s = 'updated ' + Math.floor(mins / 1440) + ' d ago';
        if (closed) s = 'last session, ' + s;
        if (age) age.textContent = s;
        gexAgeText = s; paintTape();
      }
      paint(); setInterval(paint, 30000);
    }).catch(function () { if (age) age.textContent = 'see the GEX page'; });
  })();

  // ------------------------------------------------------------ Free plan range + enrolled
  function withDb(fn, tries) {
    tries = tries || 0;
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) { try { fn(firebase.firestore()); } catch (e) {} return; }
    if (tries < 40) setTimeout(function () { withDb(fn, tries + 1); }, 150);
  }
  withDb(function (fdb) {
    fdb.collection('plans').get().then(function (snap) {
      var best = null;
      snap.forEach(function (doc) {
        var p = doc.data() || {}; if (p.hidden || p.archived) return;
        var m = String(p.chapterAccess || '').match(/^(\d+)\s*-\s*(\d+)$/);
        if (m && (!best || +m[2] > +best[2])) best = m;
      });
      if (best) { freeN = best[1] + '\u2013' + best[2]; $$('.xh-freeN').forEach(function (e) { e.textContent = freeN; }); paintTape(); }
    }).catch(function () {});
    fdb.collection('publicStats').doc('enrollment').get().then(function (doc) {
      var n = doc.exists ? Number(doc.data().count) : NaN;
      if (!isFinite(n) || n <= 0) return;
      enrolled = Math.round(n).toLocaleString();
      $$('.xh-enrolled').forEach(function (e) { $('.xh-enrolled-n', e).textContent = enrolled; e.hidden = false; });
      paintTape();
    }).catch(function () {});
  });

  // ------------------------------------------------------------ scroll
  var ticking = false;
  function onScroll() { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; lightChip(); fan(); }); }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  lightChip(); fan();
})();
