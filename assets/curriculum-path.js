// Stryker Trading Academy — homepage curriculum "price path" (#curriculum)
//
// Purpose: animates the curriculum block that tools/gen-curriculum.js writes
// into index.html. The markup already holds every level card, chapter title
// and the finished chart, so this file carries no content; with it switched
// off (or with reduced motion) the section is simply the final frame.
//
// What it plays, once, the first time the section scrolls into view (~9.5 s):
//   - An illustrative price line draws left to right across three level zones
//     (Foundation, Intermediate, Advanced); candles fade in behind the head.
//   - As the line enters each zone, that level's card rises, its chapter count
//     ticks up and its chapter / theme titles type in.
//   - Then the free Chapter 01 card rises and a light sweep crosses it.
//   On phones the four cards share one stage: each card hands over to the
//   next, and four level buttons let the reader pick any card afterwards.
//
// Control: hovering the section pauses; any click, tap or key press inside it
// stops the animation for good and shows the final frame, so the reader is
// never fighting it. Runs only while the section is in view and the tab is
// visible (IntersectionObserver + visibilitychange).
//
// Motion is transform and opacity only (the line reveal is a transform on a
// clipPath rect). One requestAnimationFrame loop; every frame is a pure
// function of elapsed time. Layout is read once on load/resize, never per frame.
//
// Dependencies: none. Styles live in assets/home-motion.css (section
// "Curriculum price path"). Loaded with `defer` on index.html only.
(function () {
  'use strict';
  var root = document.querySelector('#curriculum .cp');
  if (!root) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var phoneMQ = window.matchMedia('(max-width:640px)');
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); };

  var cells = $$('.cp-cell');
  var cards = $$('.cp-card');
  var tabs = $$('.cp-tab');
  var stage = root.querySelector('.cp-cards');
  var foot = root.querySelector('.cp-foot');
  var sweeps = $$('.cp-sweep');
  if (cards.length !== 4) return;

  root.classList.add('cp-js');
  var selected = 3;                         // phone stage: which card shows at rest

  function selectCard(i) {
    selected = i;
    cells.forEach(function (c, j) { c.classList.toggle('cp-off', j !== i); });
    tabs.forEach(function (b, j) { b.setAttribute('aria-pressed', String(j === i)); });
  }
  // Phone stage height = tallest card, measured on load/resize only.
  function sizeStage() {
    if (!phoneMQ.matches) { stage.style.height = ''; return; }
    var h = 0;
    cards.forEach(function (c) { h = Math.max(h, c.offsetHeight); });
    stage.style.height = h + 'px';
  }
  selectCard(3);
  sizeStage();
  window.addEventListener('resize', sizeStage);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeStage);
  var stop = function () {};               // replaced below once the animation is armed
  tabs.forEach(function (b, i) { b.addEventListener('click', function () { stop(); selectCard(i); }); });

  if (reduced || !('IntersectionObserver' in window)) return;   // static final frame

  // ---- timeline helpers --------------------------------------------------
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var seg = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var eo = function (p) { return 1 - Math.pow(1 - p, 3); };
  var eo5 = function (p) { return 1 - Math.pow(1 - p, 5); };
  var eio = function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  var lerp = function (a, b, p) { return a + (b - a) * p; };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  var T0 = 0.45, D = 2.2, TS = T0 + 3 * D + 0.2, END = TS + 2.2;

  // ---- chart parts (both SVGs; only the visible one matters) ---------------
  function chartParts(svg) {
    var L = +svg.getAttribute('data-l'), R = +svg.getAttribute('data-r'), step = +svg.getAttribute('data-step');
    var line = svg.querySelector('.cp-line');
    var pts = line.getAttribute('points').trim().split(/\s+/).map(function (p) { return p.split(',').map(Number); });
    return {
      L: L, R: R, step: step, pts: pts,
      clip: svg.querySelector('.cp-clip'),
      head: svg.querySelector('.cp-head'),
      halo: svg.querySelector('.cp-halo'),
      bands: $$('.cp-band', svg),
      cn: $$('.cp-cn', svg).map(function (g) { return [g, +g.getAttribute('data-x')]; })
    };
  }
  var charts = $$('.cp-svg').map(chartParts);
  function yAt(c, x) {
    var p = c.pts;
    for (var i = 1; i < p.length; i++) {
      if (x <= p[i][0]) return lerp(p[i - 1][1], p[i][1], (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]));
    }
    return p[p.length - 1][1];
  }

  // ---- card parts ------------------------------------------------------------
  var nums = cards.slice(0, 3).map(function (c) { var b = c.querySelector('.cp-big'); return [b, +b.getAttribute('data-n')]; });
  var typers = cards.map(function (c) {
    return $$('.cp-ty', c).map(function (el) { return { el: el, full: el.textContent, n: -1 }; });
  });
  var rangeTags = $$('.cp-th li b', cards[2]);
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function typeTo(o, p) {
    var n = Math.round(o.full.length * p);
    if (n === o.n) return;
    o.n = n;
    if (n >= o.full.length) { o.el.textContent = o.full; return; }
    o.el.innerHTML = esc(o.full.slice(0, n)) + (n > 0 ? '<i class="cp-car"></i>' : '') +
      '<span class="cp-gh">' + esc(o.full.slice(n)) + '</span>';
  }
  function set(el, tr, op) {
    el.style.transform = tr;
    if (op !== undefined) { el.style.opacity = op; el.style.pointerEvents = op < 0.5 ? 'none' : ''; }
  }

  // ---- one frame ---------------------------------------------------------------
  function render(t) {
    var phone = phoneMQ.matches;
    var prog = clamp((t - T0) / (3 * D));
    charts.forEach(function (c) {
      var hx = c.L + prog * (c.R - c.L), hy = yAt(c, hx);
      c.clip.setAttribute('transform', 'translate(' + c.L + ' 0) scale(' + Math.max(0.0001, prog) + ' 1) translate(' + (-c.L) + ' 0)');
      var live = t < END - 0.01, pulse = 1 + 0.25 * Math.sin(t * 5);
      c.head.setAttribute('transform', 'translate(' + hx + ' ' + hy + ')');
      c.halo.setAttribute('transform', 'translate(' + hx + ' ' + hy + ') scale(' + (live ? pulse : 1) + ')');
      c.head.style.opacity = c.halo.style.opacity = prog > 0 ? 1 : 0;
      c.cn.forEach(function (g) { g[0].style.opacity = eo(seg(hx, g[1] - c.step * 0.4, g[1] + c.step * 0.9)); });
      c.bands.forEach(function (b, k) { b.style.opacity = 0.25 + 0.75 * eo(seg(t, T0 + k * D - 0.1, T0 + k * D + 0.35)); });
    });
    for (var k = 0; k < 3; k++) {
      var tk = T0 + k * D, p = eo5(seg(t, tk + 0.05, tk + 0.6));
      var y = (1 - p) * 26, sc = 0.95 + 0.05 * p, op = p;
      if (phone) {
        var nx = k < 2 ? tk + D + 0.05 : TS, q = eo(seg(t, nx, nx + 0.45));
        y -= q * 22; sc *= 1 - 0.03 * q; op *= 1 - q;
      }
      set(cards[k], 'translateY(' + y + 'px) scale(' + sc + ')', op);
      nums[k][0].textContent = pad(Math.round(nums[k][1] * eo(seg(t, tk + 0.1, tk + 0.85))));
      var st = k < 2 ? 0.14 : 0.1;
      typers[k].forEach(function (o, i) { typeTo(o, seg(t, tk + 0.3 + i * st, tk + 0.7 + i * st)); });
      if (k === 2) rangeTags.forEach(function (b, i) { b.style.opacity = seg(t, tk + 0.5 + i * st, tk + 0.8 + i * st); });
    }
    var ps = eo5(seg(t, TS, TS + 0.6));
    set(cards[3], 'translateY(' + (1 - ps) * 26 + 'px) scale(' + (0.95 + 0.05 * ps) + ')', ps);
    set(sweeps[0], 'translateX(' + lerp(-110, 110, eio(seg(t, TS + 0.5, TS + 1.6))) + '%)');
    set(sweeps[1], 'translateX(' + lerp(-110, 110, eio(seg(t, TS + 1.2, TS + 2.1))) + '%)');
    var pf = eo(seg(t, TS + 0.4, TS + 1));
    set(foot, 'translateY(' + (1 - pf) * 10 + 'px)', pf);
  }

  // ---- clock -------------------------------------------------------------------
  // Hover pauses only while the mouse is actually being moved over the
  // section (last move < HOLD ms ago). A cursor left parked where the page
  // scrolls the section underneath it fires pointerenter too, and a plain
  // "hovering" flag froze the timeline at frame 0 with every card invisible.
  var HOLD = 1500, lastMove = -1e9;
  var t = 0, playing = false, done = false, hover = false, inView = false, raf = 0, last = 0;
  function frame(now) {
    raf = 0;
    if (!playing || done) return;
    if (!(hover && now - lastMove < HOLD)) t += Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (t >= END) { finish(); return; }
    render(t);
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (done || playing || !inView || document.hidden) return;
    playing = true;
    cells.forEach(function (c) { c.classList.remove('cp-off'); });   // the timeline decides visibility
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() { playing = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  // Final frame: clear every inline style so the static markup shows as authored.
  function finish() {
    pause();
    if (done) return;
    done = true;
    charts.forEach(function (c) {
      c.clip.removeAttribute('transform');
      var e = c.pts[c.pts.length - 1];
      c.head.setAttribute('transform', 'translate(' + e[0] + ' ' + e[1] + ')');
      c.halo.setAttribute('transform', 'translate(' + e[0] + ' ' + e[1] + ')');
      c.head.style.opacity = c.halo.style.opacity = '';
      c.cn.forEach(function (g) { g[0].style.opacity = ''; });
      c.bands.forEach(function (b) { b.style.opacity = ''; });
    });
    cards.concat([foot]).concat(sweeps).concat(rangeTags).forEach(function (el) { el.style.transform = ''; el.style.opacity = ''; el.style.pointerEvents = ''; });
    nums.forEach(function (n) { n[0].textContent = pad(n[1]); });
    typers.forEach(function (list) { list.forEach(function (o) { o.n = -1; o.el.textContent = o.full; }); });
    selectCard(selected);
  }
  stop = function () {
    if (done) return;
    if (phoneMQ.matches && playing) {
      var vis = -1;
      cards.forEach(function (c, i) { if (+(c.style.opacity || 1) >= 0.5) vis = i; });
      if (vis >= 0) selected = vis;
    }
    finish();
  };

  // Hide the cards (frame 0) only once the section is armed to play, so a
  // script failure can never leave the section invisible.
  // If the section is already well inside the viewport the first time the
  // observer reports (a /#curriculum link, a reload with restored scroll, an
  // instant jump), the reader is looking at it: show the final frame instead
  // of blanking it and replaying.
  var first = true;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (first) {
        first = false;
        if (e.isIntersecting && e.boundingClientRect.top < window.innerHeight * 0.5) { io.disconnect(); finish(); return; }
      }
      inView = e.isIntersecting;
      if (inView) play(); else pause();
    });
  }, { threshold: 0.25 });
  render(0);
  io.observe(root);

  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else play(); });
  root.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hover = true; });
  root.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') { hover = true; lastMove = performance.now(); } });
  root.addEventListener('pointerleave', function () { hover = false; });
  ['pointerdown', 'keydown', 'focusin'].forEach(function (ev) { root.addEventListener(ev, function () { stop(); }); });
})();
