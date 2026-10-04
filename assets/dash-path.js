// Stryker Trading Academy — "Guided Path" dashboard layer (dashboard-user.html)
//
// Purpose: the presentation layer for the journey-style dashboard. It does NOT
// load member data itself, except the upcoming live-sessions list; it listens
// to what dashboard.js already renders and draws on top of it:
//   - the chapter path ribbon in the hero (done / you-are-here / ahead),
//   - the animated progress ring and count-up chips,
//   - the US market countdown chip (a CLOCK from market-hours.js, not data),
//   - the band tabs (one open panel per band, WAI-ARIA tabs pattern),
//   - scroll reveal, and pausing the hero animation when it is off-screen.
// Everything respects prefers-reduced-motion.
//
// Depends on: dashboard.js (global renderDashboard, wrapped here), the
// CHAPTERS global from chapters-store.js, market-hours.js
// (window.StrykerMarketHours), and `db`/`auth` for the live-sessions list.

(function () {
  'use strict';

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function countUp(el, target, fmt) {
    if (!el || !isFinite(target)) return;
    if (reduced || target === 0) { el.textContent = fmt(target); return; }
    var t0 = performance.now(), dur = 900;
    (function tick(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(target * e));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  // ---- path ribbon -----------------------------------------------------------
  function drawPath(student) {
    var list = $('gp-path');
    if (!list || typeof CHAPTERS === 'undefined' || !CHAPTERS.length) return;
    var done = new Set(student.completedChapters || []);
    var next = CHAPTERS.find(function (c) { return !done.has(c.num); }) || CHAPTERS[CHAPTERS.length - 1];
    var html = '';
    var curIdx = 0;
    CHAPTERS.forEach(function (c, i) {
      var isDone = done.has(c.num), isCur = c.num === next.num;
      if (isCur) curIdx = i;
      var state = isDone ? 'is-done' : (isCur ? 'is-cur' : 'is-ahead');
      var label = 'Chapter ' + c.num + ': ' + c.title + (isDone ? ' (completed)' : (isCur ? ' (you are here)' : ''));
      html += '<li class="gp-node ' + state + '" style="--i:' + i + '">' +
        '<a href="chapter.html?ch=' + esc(c.num) + '" aria-label="' + esc(label) + '"' + (isCur ? ' aria-current="step"' : '') + '>' +
          '<span class="gp-dot">' + (isDone
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>'
            : '<b>' + esc(String(parseInt(c.num, 10) || c.num)) + '</b>') + '</span>' +
          (isCur ? '<span class="gp-here">You are here</span>' : '') +
          '<span class="gp-node-t">' + esc(c.title) + '</span>' +
        '</a></li>';
    });
    list.innerHTML = html;
    var pct = CHAPTERS.length > 1 ? curIdx / (CHAPTERS.length - 1) : 0;
    list.style.setProperty('--gp-fill', pct.toFixed(4));
    list.classList.add('is-ready');

    // Centre "you are here" in the ribbon. scrollLeft on the scroller itself,
    // never scrollIntoView (it would scroll every ancestor too).
    var sc = $('gp-path-scroll');
    var cur = list.children[curIdx];
    if (sc && cur) {
      // Snap to a whole node so no half-cut node is left at the left edge:
      // node k starts at padLeft + k*step inside the scroller, so
      // scrollLeft = padLeft + k*step puts node k at the edge and node k-1
      // out of view. Chapters near the start stay at 0, where
      // node 1 sits inside the left padding, fully visible.
      var step = cur.offsetWidth || 88;
      var padL = parseFloat(getComputedStyle(sc).paddingLeft) || 0;
      var maxS = Math.max(0, sc.scrollWidth - sc.clientWidth);
      var target = cur.offsetLeft - (sc.clientWidth - cur.offsetWidth) / 2;
      var k = Math.round(target / step); // target is in list coordinates (offsetLeft)
      var kMax = Math.floor((maxS - padL) / step);
      // 4px inset: the link/label box spans 4..84px of each 88px node, so
      // node k-1 (dot and label) is fully out of view and node k is whole.
      var left = (k < 1 || kMax < 1) ? 0 : Math.max(0, padL + Math.min(k, kMax) * step - 4);
      var prevB = sc.style.scrollBehavior;
      sc.style.scrollBehavior = 'auto';
      sc.scrollLeft = left;
      sc.style.scrollBehavior = prevB;
    }

    // Up-next title + ring
    var nt = $('gp-next-t');
    if (nt) nt.textContent = 'Chapter ' + next.num + ' · ' + next.title;
    var nk = $('gp-next-k');
    if (nk) nk.textContent = done.size === 0 ? 'Start here' : (done.size >= CHAPTERS.length ? 'Core path complete' : 'Up next');
    var ringPct = Math.round((done.size / CHAPTERS.length) * 100);
    var fg = $('gp-ring-fg');
    if (fg) {
      var C = 2 * Math.PI * 27;
      fg.style.strokeDasharray = C.toFixed(2);
      fg.style.strokeDashoffset = C.toFixed(2);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fg.style.strokeDashoffset = (C * (1 - ringPct / 100)).toFixed(2); });
      });
    }
    countUp($('gp-ring-pct'), ringPct, function (v) { return v + '%'; });
    var ring = $('gp-ring');
    if (ring) ring.setAttribute('aria-label', done.size + ' of ' + CHAPTERS.length + ' core chapters complete, ' + ringPct + ' percent');

    var streak = student.currentStreak || 0;
    countUp($('stat-streak'), streak, function (v) { return v + ' day' + (v === 1 ? '' : 's'); });
    countUp($('stat-lessons'), (student.completedLessons || []).length, String);
  }

  // Wrap renderDashboard (a global function declaration in dashboard.js) so
  // the path redraws whenever the original finishes, with no change to it.
  if (typeof window.renderDashboard === 'function') {
    var orig = window.renderDashboard;
    window.renderDashboard = function (student) {
      var r = orig.apply(this, arguments);
      try { drawPath(student || {}); } catch (e) { console.error('Stryker: path render failed', e); }
      return r;
    };
  }

  // ---- market countdown chip ----------------------------------------------------
  function startMarket() {
    var v = $('gp-mkt-v'), box = $('gp-mkt');
    var MH = window.StrykerMarketHours;
    if (!v || !MH) return;
    var timer = null;
    function tick() {
      var l = MH.label(Date.now());
      var txt = l.text + (l.early ? ' (early close)' : '');
      if (v.textContent !== txt) v.textContent = txt;
      if (box) box.classList.toggle('is-open', !!l.open);
    }
    function start() { if (!timer) { tick(); timer = setInterval(tick, 1000); } }
    function stop() { clearInterval(timer); timer = null; }
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    if (!document.hidden) start(); else tick();
  }

  // ---- tabs (one open panel per band) ------------------------------------------
  function wireTabs() {
    document.querySelectorAll('.gp-tabs').forEach(function (bar) {
      var tabs = Array.prototype.slice.call(bar.querySelectorAll('[role="tab"]'));
      function select(t, focus) {
        tabs.forEach(function (x) {
          var on = x === t;
          x.setAttribute('aria-selected', on ? 'true' : 'false');
          x.tabIndex = on ? 0 : -1;
          var p = $(x.getAttribute('aria-controls'));
          if (p) { p.hidden = !on; if (on) { p.classList.remove('gp-in'); void p.offsetWidth; p.classList.add('gp-in'); } }
        });
        if (focus) t.focus();
        // the journal sparkline measures its width; redraw once visible
        window.dispatchEvent(new Event('resize'));
      }
      bar.addEventListener('click', function (e) {
        var t = e.target.closest('[role="tab"]');
        if (t) select(t, false);
      });
      bar.addEventListener('keydown', function (e) {
        var i = tabs.indexOf(document.activeElement);
        if (i < 0) return;
        var n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') n = tabs[0];
        else if (e.key === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); select(n, true); }
      });
    });
  }

  // ---- scroll reveal + pause hero when off-screen ---------------------------------
  function wireMotion() {
    var bands = document.querySelectorAll('.gp-band');
    // Safety: screenshots, older browsers, and heavily throttled devices can
    // miss an observer callback. Never leave content invisible; reveal any
    // remaining bands after the first paint window.
    setTimeout(function () { bands.forEach(function (b) { b.classList.add('is-in'); }); }, 1200);
    if (!('IntersectionObserver' in window) || reduced) {
      bands.forEach(function (b) { b.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
      bands.forEach(function (b) { io.observe(b); });
    }
    var hero = $('gp-hero');
    if (hero && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        hero.classList.toggle('is-off', !es[0].isIntersecting);
      }).observe(hero);
    }
    document.addEventListener('visibilitychange', function () {
      if (hero) hero.classList.toggle('is-hidden', document.hidden);
    });
  }

  // ---- upcoming live sessions (replaces the old hard-coded August list) -----------
  function renderLive(rows) {
    var host = $('gp-live');
    if (!host) return;
    var now = Date.now();
    var up = rows.map(function (s) {
      var ms = (typeof s.startAtMillis === 'number' && isFinite(s.startAtMillis)) ? s.startAtMillis
        : new Date((s.date || '') + 'T' + (s.time || '00:00')).getTime();
      return { s: s, ms: ms };
    }).filter(function (x) { return !x.s.completed && isFinite(x.ms) && (x.s.isLive || x.ms > now - 3 * 3600e3); })
      .sort(function (a, b) { return a.ms - b.ms; }).slice(0, 3);
    if (!up.length) {
      host.innerHTML = '<p class="dov-empty">No sessions on the schedule yet. New ones appear here as soon as they are booked.</p>';
      return;
    }
    host.innerHTML = up.map(function (x) {
      var d = new Date(x.ms);
      return '<a class="gp-ev" href="live-sessions.html">' +
        '<span class="gp-ev-d"><b>' + d.getDate() + '</b>' + esc(d.toLocaleDateString(undefined, { month: 'short' })) + '</span>' +
        '<span class="gp-ev-t"><b>' + esc(x.s.title || 'Live session') + '</b><span>' +
          esc(d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) +
          (x.s.instrument ? ' · ' + esc(x.s.instrument) : '') + '</span></span>' +
        (x.s.isLive ? '<span class="live-badge"><i></i>LIVE</span>' : '<span class="gp-tool-go" aria-hidden="true">→</span>') +
      '</a>';
    }).join('');
  }
  function loadLive() {
    if (typeof db === 'undefined' || !db || typeof auth === 'undefined' || !auth) { renderLive([]); return; }
    var done = false;
    auth.onAuthStateChanged(function (user) {
      if (done || !user) return;
      done = true;
      db.collection('liveSessions').orderBy('date', 'asc').get().then(function (snap) {
        var rows = [];
        snap.forEach(function (d) { var o = d.data(); o.id = d.id; rows.push(o); });
        renderLive(rows);
      }).catch(function () { renderLive([]); });
    });
  }

  function boot() {
    wireTabs();
    wireMotion();
    startMarket();
    loadLive();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
