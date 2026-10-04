/* Snake on the cards string: Owner example, /features/models only.
   Opt-in: <div class="sx-rows sx-snake"> + this file + features-snake.css.
   One SVG overlay in the left gutter of .sx-rows (aria-hidden, pointer-events
   none, clipped to the gutter so it can never reach a card, text or capture).
   The head travels node to node (easeInOutSine), pausing at each card's dot; the
   body (16 overlapping, tapering segments) trails with a lateral S-wave whose amplitude is 0
   at the head. After the last card it fades out and re-enters at the first.
   Perf: one rAF loop, per frame only style.transform + style.opacity on 14
   elements, no layout reads (node positions are cached and refreshed by a
   debounced ResizeObserver). Runs only while .sx-rows is on screen and the tab
   is visible. Reduced motion: no rAF at all, snake parked at the first dot.
   No JS: this never runs; the page shows the plain static string. */
(function () {
  'use strict';
  var list = document.querySelector('.sx-rows.sx-snake');
  if (!list || !window.requestAnimationFrame || !document.createElementNS) return;
  var rows = [].slice.call(list.children).filter(function (el) { return el.classList.contains('sx-row'); });
  if (rows.length < 2) return;

  var NS = 'http://www.w3.org/2000/svg', N = 17;           // head + 16 overlapping body segments
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(mq && mq.matches);

  // ---- build the overlay -------------------------------------------------
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'sx-snake-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  var segs = [];
  for (var i = N - 1; i >= 1; i--) {                       // tail first, so the head paints on top
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'sx-sn-seg'); c.setAttribute('cx', '0'); c.setAttribute('cy', '0');
    segs[i] = c; svg.appendChild(c);
  }
  var head = document.createElementNS(NS, 'g');
  head.setAttribute('class', 'sx-sn-head');
  // unit geometry, pointing down (+y); scaled per breakpoint
  var parts = [['circle', 'sx-sn-glow', { r: 6.5, cy: 1 }],
               ['ellipse', 'sx-sn-skull', { rx: 4.3, ry: 5.8, cy: 0.9 }],
               ['circle', 'sx-sn-eye', { r: 0.85, cx: -1.9, cy: 2.7 }],
               ['circle', 'sx-sn-eye', { r: 0.85, cx: 1.9, cy: 2.7 }]];
  parts.forEach(function (p) {
    var e = document.createElementNS(NS, p[0]); e.setAttribute('class', p[1]);
    for (var k in p[2]) e.setAttribute(k, p[2][k]);
    head.appendChild(e);
  });
  svg.appendChild(head);
  svg.style.visibility = 'hidden';
  list.insertBefore(svg, list.firstChild);

  // ---- geometry cache (refreshed only on resize) -------------------------
  var nodes = [], tx = 5, gut = 16, sc = 1, amp = 4, gap = 5.2, wl = 34, ready = false;
  function measure() {
    var cs = getComputedStyle(list);
    tx = parseFloat(cs.getPropertyValue('--fp-tx')) || 5;
    gut = parseFloat(cs.getPropertyValue('--fp-gut')) || 16;
    var ny = parseFloat(cs.getPropertyValue('--fp-ny')) || 30;
    var desk = gut >= 40;
    sc = desk ? 1.45 : 1;
    amp = desk ? 8 : 4;
    gap = 3.1 * sc;
    wl = 44 * sc;
    nodes = rows.map(function (r) { return r.offsetTop + r.clientTop + ny + 6; });
    for (var i = 1; i < N; i++) {
      var f = i / (N - 1);
      segs[i].setAttribute('r', ((3.5 - 2.2 * f) * sc).toFixed(2));
    }
    ready = true;
    svg.style.visibility = '';
  }

  // ---- timeline ----------------------------------------------------------
  var PAUSE = 900, OUT = 700, IN = 500, GAPMS = 300;
  var phase = 'in', j = 0, p0 = 0, clock = 0, at = null;
  function ease(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }  // easeInOutSine
  function hopDur(a, b) { return Math.max(1600, Math.min(2200, Math.abs(b - a) * 1.6)); }
  function mark(row) {
    if (at === row) return;
    if (at) at.classList.remove('sx-sn-at');
    at = row; if (at) at.classList.add('sx-sn-at');
  }
  function step() {                                        // advance phases; returns [headY, alpha]
    var e = clock - p0;
    for (;;) {
      if (phase === 'in') { if (e < IN) return [nodes[0], e / IN]; phase = 'pause'; j = 0; p0 += IN; e = clock - p0; mark(rows[0]); continue; }
      if (phase === 'pause') {
        if (e < PAUSE) return [nodes[j], 1];
        p0 += PAUSE; e = clock - p0;
        if (j >= nodes.length - 1) { phase = 'out'; } else { phase = 'hop'; mark(null); }
        continue;
      }
      if (phase === 'hop') {
        var d = hopDur(nodes[j], nodes[j + 1]);
        if (e < d) return [nodes[j] + (nodes[j + 1] - nodes[j]) * ease(e / d), 1];
        p0 += d; e = clock - p0; j += 1; phase = 'pause'; mark(rows[j]); continue;
      }
      if (phase === 'out') {
        if (e < OUT) return [nodes[nodes.length - 1], 1 - e / OUT];
        if (e < OUT + GAPMS) { mark(null); return [nodes[nodes.length - 1], 0]; }
        p0 += OUT + GAPMS; e = clock - p0; phase = 'in'; continue;
      }
    }
  }

  // ---- draw (transform + opacity only) -----------------------------------
  var TAU = Math.PI * 2;
  function draw(hy, alpha, t, still) {
    var k = TAU / wl, w = TAU / 2400, top = nodes[0] - 2;
    var lo = 1, hi = gut - 1;
    for (var i = 1; i < N; i++) {
      var f = i / (N - 1), y = hy - i * gap;
      var env = Math.sin(Math.min(1, i / 7) * Math.PI / 2);   // 0 at the head -> full by segment 7
      var x = tx + amp * env * Math.sin(k * y - w * t);
      var r = (3.5 - 2.2 * f) * sc;
      if (x < lo + r) x = lo + r; else if (x > hi - r) x = hi - r;
      var shimmer = still ? 1 : 0.78 + 0.22 * Math.sin(TAU * t / 1800 - i * 0.55);
      var o = y < top ? 0 : alpha * (1 - 0.6 * f) * shimmer;
      segs[i].style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)';
      segs[i].style.opacity = o.toFixed(3);
    }
    head.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + hy.toFixed(2) + 'px) scale(' + sc + ')';
    head.style.opacity = alpha.toFixed(3);
  }

  // ---- loop + gating -----------------------------------------------------
  var raf = 0, last = 0, onScreen = false;
  function frame(now) {
    raf = 0;
    if (last) clock += Math.min(50, now - last);           // own clock: no jump after a pause
    last = now;
    if (ready) { var s = step(); draw(s[0], s[1], clock, false); }
    if (onScreen && !document.hidden && !reduced) raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf && onScreen && !document.hidden && !reduced && ready) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function park() { stop(); if (!ready) return; mark(rows[0]); draw(nodes[0], 1, 0, true); }

  measure();
  if (reduced) park(); else draw(nodes[0], 0, 0, false);

  var rt = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      clearTimeout(rt);
      rt = setTimeout(function () { measure(); if (reduced) park(); }, 150);
    }).observe(list);
  }
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (ents) {
      onScreen = ents[ents.length - 1].isIntersecting;
      if (onScreen) start(); else stop();
    }).observe(list);
  } else { onScreen = true; start(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  if (mq) {
    var onMq = function () { reduced = mq.matches; if (reduced) park(); else { mark(null); start(); } };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }
})();
