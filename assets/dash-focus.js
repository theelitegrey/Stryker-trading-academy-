// Stryker Trading Academy — dashboard "Focus mode" behaviour (dashboard-user.html)
//
// Purpose: presentation only. Drives the focus layout around the data that
// dashboard.js and dash-overview.js already render: staggered reveal, the
// collapsible sections (open state remembered per browser), the hero
// progress ring + count-up numbers, the market-open countdown chip and the
// particle-line canvas in the hero. It never reads or writes Firestore and
// never changes what the existing modules render; it only watches their
// output elements (#stat-chapters, #stat-streak, #dash-subtitle, badges).
//
// Motion rules: everything respects prefers-reduced-motion; the canvas pauses
// when the hero is off-screen or the tab is hidden, and uses fewer particles
// on narrow screens.
//
// Depends on: market-hours.js (window.StrykerMarketHours) for the countdown.
// Load after dashboard.js, dash-overview.js and market-hours.js.

(function () {
  'use strict';
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };
  var OPEN_KEY = 'stryker_dash_focus_open';

  // ---- count-up ---------------------------------------------------------------
  function countUp(el, to, fmt, ms) {
    if (!el) return;
    if (RM || !to) { el.textContent = fmt(to); return; }
    var t0 = performance.now(); ms = ms || 1100;
    (function tick(t) {
      var p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(to * e));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  // ---- sections ---------------------------------------------------------------
  function initSections() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null'); } catch (e) {}
    var state = saved || { learn: true };
    document.querySelectorAll('.fx-sec').forEach(function (sec) {
      var key = sec.dataset.sec, btn = sec.querySelector('.fx-sec-btn');
      function set(on, store) {
        sec.classList.toggle('is-open', on);
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        var body = $(btn.getAttribute('aria-controls'));
        if (body) body.setAttribute('aria-hidden', on ? 'false' : 'true');
        if (store) { state[key] = on; try { localStorage.setItem(OPEN_KEY, JSON.stringify(state)); } catch (e) {} }
        if (on) window.dispatchEvent(new Event('resize')); // journal spark redraws at real width
      }
      set(!!state[key], false);
      btn.addEventListener('click', function () { set(!sec.classList.contains('is-open'), true); });
    });
  }

  // ---- reveal -----------------------------------------------------------------
  function initReveal() {
    var els = document.querySelectorAll('.fx-rv');
    els.forEach(function (el, i) { el.style.setProperty('--fx-i', Math.min(i, 6)); });
    if (RM || !('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('fx-in'); }); return; }
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('fx-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  // ---- ring + numbers + summaries (watch what dashboard.js renders) -----------
  function initProgress() {
    var C = 2 * Math.PI * 52, ring = $('fx-ring-fg'), pctEl = $('fx-ring-pct'), wrap = $('fx-ring');
    var lastPct = -1, lastStreak = -1, busy = false;
    function sync() {
      if (busy) return;
      var ch = ($('stat-chapters') || {}).textContent || '';
      var m = ch.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        var done = +m[1], total = +m[2], pct = total ? Math.round(done / total * 100) : 0;
        if (pct !== lastPct) {
          lastPct = pct;
          if (ring) ring.style.strokeDashoffset = String(C * (1 - pct / 100));
          countUp(pctEl, pct, String);
          if (wrap) wrap.setAttribute('aria-label', done + ' of ' + total + ' core chapters completed, ' + pct + ' percent');
          setSum('fx-sum-learn', done + ' of ' + total + ' chapters done' + nextChapterHint());
        }
      }
      var st = $('stat-streak'), sm = st && st.textContent.match(/^(\d+) day/);
      if (sm && +sm[1] !== lastStreak && !st.dataset.fxAnim) {
        lastStreak = +sm[1];
        st.dataset.fxAnim = '1'; busy = true;
        countUp(st, lastStreak, function (v) { return v + ' day' + (v === 1 ? '' : 's'); });
        setTimeout(function () { delete st.dataset.fxAnim; busy = false; }, 1200);
      }
      var badges = document.querySelectorAll('.fx-badges .badge-item'), unlocked = 0;
      badges.forEach(function (b) { if (!b.classList.contains('locked')) unlocked++; });
      var lessons = ($('stat-lessons') || {}).textContent || '0';
      setSum('fx-sum-achieve', unlocked + ' of ' + badges.length + ' badges · ' + lessons + ' lesson' + (lessons === '1' ? '' : 's') + ' completed');
    }
    function nextChapterHint() {
      var b = $('dash-resume-btn'), m = b && b.textContent.match(/Chapter (\d+)/);
      return m ? ' · Chapter ' + m[1] + ' is next' : '';
    }
    var mo = new MutationObserver(sync);
    ['stat-chapters', 'stat-streak', 'stat-lessons', 'dash-resume-btn'].forEach(function (id) {
      var el = $(id); if (el) mo.observe(el, { childList: true, characterData: true, subtree: true });
    });
    document.querySelectorAll('.fx-badges .badge-item').forEach(function (b) { mo.observe(b, { attributes: true, attributeFilter: ['class'] }); });
    var floor = $('dov-floor-body');
    if (floor) new MutationObserver(function () {
      var n = floor.querySelectorAll('.dov-post').length;
      setSum('fx-sum-community', n ? n + ' recent post' + (n === 1 ? '' : 's') + ' on the floor · live sessions and messages' : 'Trading floor, live sessions and messages');
    }).observe(floor, { childList: true });
  }
  function setSum(id, txt) { var el = $(id); if (el && el.textContent !== txt) el.textContent = txt; }

  // ---- market countdown (a clock, not market data) ----------------------------
  function initMarket() {
    var MH = window.StrykerMarketHours, b = $('fx-mkt-left'), l = $('fx-mkt-lbl'), chip = $('fx-mkt');
    if (!MH || !b) return;
    var t = null;
    function tick() {
      var now = Date.now(), st = MH.status(now);
      if (!st) { b.textContent = 'Closed'; l.textContent = 'US stock market'; return; }
      b.textContent = MH.fmtLeft(st.until - now);
      l.textContent = st.open ? 'until the US close' + (st.early ? ' (early)' : '') : 'until the US open';
      chip.classList.toggle('is-open', !!st.open);
      setSum('fx-sum-market', (st.open ? 'US market open · closes in ' : 'US market opens in ') + MH.fmtLeft(st.until - now) + ' · briefing, GEX, journal');
    }
    function start() { if (!t) { tick(); t = setInterval(tick, 1000); } }
    function stop() { clearInterval(t); t = null; }
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    start();
  }

  // ---- hero canvas: drifting particles joined by thin lines --------------------
  function initCanvas() {
    var cv = $('fx-hero-canvas');
    if (!cv || RM || !cv.getContext) return;
    var ctx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0, pts = [], raf = 0, visible = true, col = '3,201,136', col2 = '0,173,181';
    function readColors() {
      var light = document.documentElement.getAttribute('data-theme') === 'light';
      col = light ? '3,150,104' : '3,201,136'; col2 = light ? '0,140,150' : '0,173,181';
    }
    function size() {
      var r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = W < 500 ? 18 : W < 900 ? 30 : 46;
      pts = [];
      for (var i = 0; i < n; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: Math.random() * 1.4 + .6 });
    }
    var D = 120;
    function frame() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;
        for (var j = i + 1; j < pts.length; j++) {
          var q = pts[j], dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
          if (d2 < D * D) {
            ctx.strokeStyle = 'rgba(' + (i % 2 ? col : col2) + ',' + (0.22 * (1 - Math.sqrt(d2) / D)).toFixed(3) + ')';
            ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgba(' + col + ',.55)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    function run() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); }
    function halt() { cancelAnimationFrame(raf); raf = 0; }
    readColors(); size();
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; visible ? run() : halt(); }).observe(cv);
    document.addEventListener('visibilitychange', function () { document.hidden ? halt() : run(); });
    var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(size, 200); });
    window.addEventListener('stryker:theme', readColors);
    new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    run();
    window.__fxCanvas = { halt: halt, run: run };
  }

  function initToday() {
    var el = $('fx-today');
    if (el) el.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initToday(); initSections(); initReveal(); initProgress(); initMarket(); initCanvas();
  });
})();
