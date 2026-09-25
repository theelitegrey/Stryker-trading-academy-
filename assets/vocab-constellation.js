// Stryker Trading Academy — Core Vocabulary "Constellation" (homepage #concepts)
//
// Purpose: animates the vocabulary network that tools/gen-vocab.js writes into
// index.html. The markup already holds every term, its chapter and its detail
// panel, so this file carries no content; with it switched off the section
// still shows one term's card and every term is a working button.
//
// What it does:
//   - Places the 14 nodes on the field and lets them drift slowly.
//   - Every 3 s spotlights the next term: that node scales up with a glow and
//     a pulsing ring, lines draw out to the terms it links to, the rest dim,
//     and the card on the right swaps to that term and draws its mini chart.
//   - Hover, tap, click or keyboard focus on a node spotlights that node.
//     Hovering the section pauses the walk; any tap, click or key press inside
//     it stops the walk for good, so the reader stays in control.
//   - prefers-reduced-motion: no drift, no walk, no ring. A still frame with
//     the lines of the selected term drawn; selecting a term swaps the card
//     straight away.
//
// Motion is transform, opacity and stroke-dashoffset only. One requestAnimationFrame
// loop, started when the section scrolls into view (IntersectionObserver) and
// stopped when it leaves or the tab is hidden. Positions are cached from one
// measure on load/resize, so a frame writes styles and never reads layout.
//
// Dependencies: none. Vanilla JS and SVG. Styles live in assets/home-motion.css
// (section "Core vocabulary constellation"). Loaded with `defer` on index.html
// only.
(function () {
  'use strict';
  var field = document.querySelector('#concepts .vc-field');
  if (!field) return;
  var section = document.getElementById('concepts');
  var card = document.getElementById('vc-card');
  var live = document.getElementById('vc-live');
  var edgesSvg = field.querySelector('.vc-edges');
  var glow = field.querySelector('.vc-glow');
  var pauseBtn = field.querySelector('.vc-pause');

  var ORDER = field.getAttribute('data-order').split(' ');
  var STILL = field.getAttribute('data-still');
  var EDGES = field.getAttribute('data-edges').split(' ').map(function (p) { return p.split(':'); });
  var STEP = 3.0;                                 // seconds per spotlight
  var NS = 'http://www.w3.org/2000/svg';

  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mqNarrow = window.matchMedia('(max-width: 900px)');
  var RM = mqReduce.matches;

  // ---- nodes -------------------------------------------------------------
  var nodes = {}, keys = [];
  Array.prototype.forEach.call(field.querySelectorAll('.vc-node'), function (li, i) {
    var k = li.getAttribute('data-k');
    keys.push(k);
    var st = li.style;
    nodes[k] = {
      el: li,
      sc: li.querySelector('.vc-sc'),
      ring: li.querySelector('.vc-ring'),
      btn: li.querySelector('.vc-pill'),
      panel: card.querySelector('.vc-in[data-k="' + k + '"]'),
      pos: [parseFloat(st.getPropertyValue('--x')), parseFloat(st.getPropertyValue('--y'))],
      ppos: [parseFloat(st.getPropertyValue('--px')), parseFloat(st.getPropertyValue('--py'))],
      ph: i * 1.7,                                // drift phase
      px: [14, 21, 10.5][i % 3],                  // drift periods (s)
      py: [21, 14, 8.4][i % 3],
      x: 0, y: 0, z: 0, on: null,
      last: ''                                    // last transform written, to skip no-op writes
    };
  });
  var related = {};
  keys.forEach(function (k) { related[k] = {}; related[k][k] = true; });
  EDGES.forEach(function (e) { related[e[0]][e[1]] = true; related[e[1]][e[0]] = true; });

  // ---- edges: a faint base line and a bright line that draws out ----------
  var edges = EDGES.map(function (e) {
    var base = document.createElementNS(NS, 'line'), hot = document.createElementNS(NS, 'line');
    [base, hot].forEach(function (l) {
      l.setAttribute('x1', 0); l.setAttribute('y1', 0); l.setAttribute('x2', 1); l.setAttribute('y2', 0);
    });
    base.setAttribute('class', 'vc-e');
    hot.setAttribute('class', 'vc-h');
    hot.setAttribute('pathLength', '1');
    hot.setAttribute('stroke-dasharray', '1');
    edgesSvg.appendChild(base); edgesSvg.appendChild(hot);
    return { a: e[0], b: e[1], base: base, hot: hot };
  });

  // ---- geometry: read once, reuse every frame ----------------------------
  // fy is the height nodes are laid out in: on phones the bottom strip is kept
  // clear for the Pause button.
  var fw = 0, fh = 0, fy = 0, narrow = mqNarrow.matches;
  function measure() {
    fw = field.clientWidth; fh = field.clientHeight; narrow = mqNarrow.matches;
    fy = narrow ? fh - 30 : fh;
    edgesSvg.setAttribute('viewBox', '0 0 ' + fw + ' ' + fh);
  }

  // ---- helpers -------------------------------------------------------------
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function eo(t) { return 1 - Math.pow(1 - t, 3); }
  function eio(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // ---- state -------------------------------------------------------------
  var t = 0;               // seconds of animation time (only advances while running)
  var auto = !RM;          // walking through ORDER on its own
  var hovering = false;    // pointer over the section: walk paused
  var pinned = false;      // user-chosen term shown; set by tap/click/keys
  var manual = null;       // {k, prev, t0} for hover/focus/tap spotlights
  var shown = STILL;       // term whose panel is visible (the markup starts on STILL)
  var ann = null;          // term last announced to screen readers
  var frozen = false;      // Pause motion pressed: nothing moves from here on

  function showPanel(k) {
    if (shown === k) return;
    if (shown) { nodes[shown].panel.hidden = true; nodes[shown].panel.classList.remove('on'); nodes[shown].btn.removeAttribute('aria-current'); }
    shown = k;
    var p = nodes[k].panel;
    p.hidden = false; p.classList.add('on');
    nodes[k].btn.setAttribute('aria-current', 'true');
  }
  // Only user-driven changes are announced; the automatic walk stays silent so
  // a screen reader is not interrupted every three seconds.
  function announce(k) {
    if (ann === k) return;
    ann = k;
    var p = nodes[k].panel;
    live.textContent = p.querySelector('.vc-k').textContent + '. ' + p.querySelector('.vc-d').textContent + ' ' + p.querySelector('.vc-ch').textContent + '.';
  }

  // Where the spotlight is at time tt: current term, previous term, seconds into it.
  function frameState(tt) {
    if (manual) return { cur: manual.k, prev: manual.prev, u: RM ? 9 : tt - manual.t0 };
    if (!auto) return { cur: shown || STILL, prev: null, u: 9 };
    var loop = ORDER.length * STEP, tm = tt % loop, i = Math.floor(tm / STEP);
    return { cur: ORDER[i], prev: ORDER[(i + ORDER.length - 1) % ORDER.length], u: tm - i * STEP };
  }

  function render(tt) {
    if (!fw) measure();
    var s = frameState(tt), cur = s.cur, prev = s.prev, u = s.u;
    var wc = RM ? 1 : eo(seg(u, 0, 0.45)), wp = prev && prev !== cur ? 1 - wc : 0;
    var rc = related[cur], rp = prev ? related[prev] : {};
    var A = narrow ? 5 : 10, drift = RM ? 0 : tt;

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], n = nodes[k], P = narrow ? n.ppos : n.pos;
      n.x = P[0] / 100 * fw + A * Math.sin(2 * Math.PI * drift / n.px + n.ph);
      n.y = P[1] / 100 * fy + A * Math.cos(2 * Math.PI * drift / n.py + n.ph * 1.3);
      var act = (k === cur ? wc : 0) + (k === prev ? wp : 0);
      var lit = clamp((rc[k] ? wc : 0) + (rp[k] ? wp : 0), 0, 1);
      var tf = 'translate(' + n.x.toFixed(1) + 'px,' + n.y.toFixed(1) + 'px)';
      if (tf !== n.last) { n.el.style.transform = tf; n.last = tf; }
      n.sc.style.transform = 'scale(' + (1 + 0.28 * act + 0.06 * lit).toFixed(3) + ')';
      n.sc.style.opacity = (0.32 + 0.68 * lit).toFixed(3);
      // Discrete state (which node is on top, which pill is lit) only changes
      // when the spotlight moves, so write it only then.
      var z = k === cur ? 5 : (lit > 0.5 ? 3 : 1), on = k === cur;
      if (z !== n.z) { n.el.style.zIndex = z; n.z = z; }
      if (on !== n.on) { n.el.classList.toggle('on', on); n.on = on; }
      if (k === cur && !RM) {
        var rp2 = (((u - 0.2) % 1.5) + 1.5) % 1.5 / 1.5;
        n.ring.style.opacity = u < 0.2 ? 0 : ((1 - rp2) * 0.8).toFixed(3);
        n.ring.style.transform = 'scale(' + (0.7 + rp2 * 1.1).toFixed(3) + ')';
      } else n.ring.style.opacity = 0;
    }

    for (var j = 0; j < edges.length; j++) {
      var e = edges[j], a = nodes[e.a], b = nodes[e.b];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      // Map the unit line (0,0)-(1,0) onto a→b; the y column keeps stroke width even.
      var m = 'matrix(' + dx.toFixed(2) + ' ' + dy.toFixed(2) + ' ' + (-dy / len).toFixed(4) + ' ' + (dx / len).toFixed(4) + ' ' + a.x.toFixed(2) + ' ' + a.y.toFixed(2) + ')';
      e.base.setAttribute('transform', m); e.hot.setAttribute('transform', m);
      var onC = e.a === cur || e.b === cur, onP = prev && (e.a === prev || e.b === prev);
      if (onC) {
        var from = e.a === cur;
        e.hot.style.strokeDashoffset = RM ? 0 : ((from ? 1 : -1) * (1 - eio(seg(u, 0.2, 0.85)))).toFixed(4);
        e.hot.style.opacity = 1;
      } else if (onP) { e.hot.style.strokeDashoffset = 0; e.hot.style.opacity = wp.toFixed(3); }
      else e.hot.style.opacity = 0;
    }

    var c = nodes[cur], p = prev ? nodes[prev] : c;
    var gx = c.x * wc + p.x * (1 - wc), gy = c.y * wc + p.y * (1 - wc);
    glow.style.transform = 'translate(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px)';

    showPanel(cur);
    var panel = c.panel;
    if (RM) { panel.style.opacity = 1; panel.style.transform = 'none'; miniAt(panel, 9, 0); return; }
    var ci = eo(seg(u, 0.15, 0.6));
    var out = (auto && !manual && !hovering) ? 1 - seg(u, STEP - 0.2, STEP) : 1;
    panel.style.opacity = (ci * out).toFixed(3);
    panel.style.transform = 'translateX(' + ((1 - ci) * 18).toFixed(1) + 'px)';
    miniAt(panel, u, 0.5);
  }

  // Mini chart: lines draw in (stroke-dashoffset), marks fade in.
  function miniAt(root, u, t0) {
    var dr = root.querySelectorAll('.dr'), fx = root.querySelectorAll('.fx');
    for (var i = 0; i < dr.length; i++) dr[i].style.strokeDashoffset = (1 - eio(seg(u, t0, t0 + 1.0))).toFixed(4);
    for (var j = 0; j < fx.length; j++) fx[j].style.opacity = seg(u, t0 + 0.15 + j * 0.05, t0 + 0.45 + j * 0.05).toFixed(3);
  }

  // ---- the loop: runs only while the section is on screen -----------------
  var inView = false, raf = 0, last = 0;
  function frame(now) {
    raf = 0;
    // rAF's timestamp can be slightly older than the performance.now() taken in
    // start(); a negative dt would push t below 0 and index ORDER at -1.
    var dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    // The clock stops while the pointer rests on the section, so drift and
    // the walk both hold still; a spotlight picked by hover keeps animating in.
    if (!hovering || manual) t += dt;
    render(t);
    if (inView && !RM && !frozen && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf || RM || frozen || !inView || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  // ---- interaction -------------------------------------------------------
  function keyOf(target) {
    var li = target && target.closest && target.closest('.vc-node');
    return li ? li.getAttribute('data-k') : null;
  }
  function spotlight(k, userSelected) {
    if (!k) return;
    if (!manual || manual.k !== k) manual = { k: k, prev: manual ? manual.k : (shown || STILL), t0: t };
    if (userSelected) announce(k);
    if (frozen) manual.t0 = t - 9;                 // paused: show the finished state
    if (RM || frozen || !raf) render(t);
  }
  function stopWalk() {
    if (!auto && pinned) return;
    auto = false; pinned = true;
  }

  field.addEventListener('pointerover', function (e) {
    if (e.pointerType === 'touch') return;        // touch is handled by click
    var k = keyOf(e.target); if (k) spotlight(k, false);
  });
  field.addEventListener('focusin', function (e) {
    var k = keyOf(e.target); if (k) spotlight(k, true);
  });
  field.addEventListener('click', function (e) {
    var k = keyOf(e.target); if (!k) return;
    stopWalk();
    spotlight(k, true);
  });
  section.addEventListener('keydown', function (e) {
    // Tab moves focus (and spotlights through focusin); only real keys stop the walk.
    if (e.key === 'Tab' || e.key === 'Shift') return;
    stopWalk();
  });
  section.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') hovering = true; });
  section.addEventListener('pointerleave', function () {
    hovering = false;
    if (!pinned) manual = null;                    // hover spotlight ends; the walk carries on
  });
  field.addEventListener('focusout', function (e) {
    if (!pinned && !field.contains(e.relatedTarget)) manual = null;
  });

  // A visible way to stop the motion for anyone who wants it still, reachable
  // by keyboard. Shown only when motion is on.
  if (!RM) {
    pauseBtn.hidden = false;
    pauseBtn.addEventListener('click', function () {
      stopWalk();
      frozen = true; stop();
      manual = { k: shown || STILL, prev: null, t0: t - 9 };
      pauseBtn.setAttribute('aria-pressed', 'true');
      render(t);
      // The button hides itself once pressed; keep focus in the section.
      nodes[shown].btn.focus({ preventScroll: true });
    });
  }

  // ---- lifecycle ---------------------------------------------------------
  measure();
  render(0);
  section.classList.add('vc-ready');
  var ro = 'ResizeObserver' in window ? new ResizeObserver(function () { measure(); render(t); }) : null;
  if (ro) ro.observe(field); else window.addEventListener('resize', function () { measure(); render(t); });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[entries.length - 1].isIntersecting;
      if (inView) start(); else stop();
    }, { threshold: 0.05 }).observe(field);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  mqReduce.addEventListener && mqReduce.addEventListener('change', function (e) {
    RM = e.matches;
    if (RM) { stop(); auto = false; pauseBtn.hidden = true; } else start();
    render(t);
  });
})();
