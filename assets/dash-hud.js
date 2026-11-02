// TradeZoro — "Your desk" HUD (dashboard-user.html): hero chart, session dial, drifting chips, system status.
//
// ONE requestAnimationFrame loop drives everything here (window.__dkLoop). Tasks run on their own interval and only
// while the page is visible and their element is on screen. window.__dkPerf holds the main-thread time the loop spent,
// so the cost can be measured (tools/tests/dash-desk-browser.js reports it). Reduced motion: every visual is drawn
// once and never moves.
//
// The candle chart is a SAMPLE (seeded random walk, labelled "Sample"); the dial, the chips and the status strip are
// computed from market-hours.js and from the feeds dash-desk.js loads (window.__dk). Nothing is invented.
// Depends on: dash-desk.js (window.__dk), market-hours.js (StrykerMarketHours).
(function () {
  'use strict';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var DK = window.__dk || { on: function () {}, data: {} };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var NS = 'http://www.w3.org/2000/svg';

  // ---- the single loop -------------------------------------------------------------------------------
  var tasks = [], perf = window.__dkPerf = { frames: 0, ms: 0, runs: 0 }, raf = 0, last = 0;
  var loop = window.__dkLoop = {
    // add(el, everyMs, fn): fn runs about every everyMs while el is on screen and the tab is visible
    add: function (el, every, fn) { var t = { el: el, every: every, fn: fn, due: 0, on: true }; tasks.push(t); if (io && el) io.observe(el); kick(); return t; }
  };
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { tasks.forEach(function (t) { if (t.el === e.target) t.on = e.isIntersecting; }); });
  }) : null;
  function frame(now) {
    raf = 0;
    if (document.hidden || reduced) return;
    var t0 = performance.now(), ran = false;
    tasks.forEach(function (t) { if (t.on && now >= t.due) { t.due = now + t.every; t.fn(now); ran = true; } });
    if (ran) { perf.ms += performance.now() - t0; perf.runs++; }
    perf.frames++;
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !document.hidden && !reduced) raf = requestAnimationFrame(frame); }
  document.addEventListener('visibilitychange', kick);

  function css(n, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; }

  // ---- sample candle chart (canvas) ------------------------------------------------------------------
  function chart() {
    var cv = $('dk-cv'); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d'), N = 60, bars = [], seed = 7, W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), col = {};
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
    var px = 100;
    function mk() { var o = px, c = o + rnd() * 3.2; px = c; return { o: o, c: c, h: Math.max(o, c) + Math.abs(rnd()) * 1.4, l: Math.min(o, c) - Math.abs(rnd()) * 1.4 }; }
    for (var i = 0; i < N; i++) bars.push(mk());
    function colors() { col = { up: css('--bull', '#03c988'), dn: css('--bear', '#e5484d'), grid: css('--line', 'rgba(255,255,255,.08)'), ink: css('--ink-3', '#8b93a7') }; }
    function size() {
      var r = cv.getBoundingClientRect(); if (!r.width) return;
      W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }
    function draw() {
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      var lo = Infinity, hi = -Infinity; bars.forEach(function (b) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
      var sp = (hi - lo) || 1, pad = 6, y = function (v) { return pad + (hi - v) / sp * (H - pad * 2); }, bw = W / N;
      ctx.strokeStyle = col.grid; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath();
      for (var g = 1; g < 4; g++) { var gy = Math.round(H * g / 4) + 0.5; ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
      ctx.stroke(); ctx.globalAlpha = 1;
      bars.forEach(function (b, i) {
        var up = b.c >= b.o, c = up ? col.up : col.dn, x = i * bw + bw / 2;
        ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y(b.h)); ctx.lineTo(x, y(b.l)); ctx.stroke();
        var t = y(Math.max(b.o, b.c)), h = Math.max(1.5, Math.abs(y(b.o) - y(b.c)));
        ctx.fillRect(x - bw * 0.32, t, bw * 0.64, h);
      });
      var lb = bars[N - 1], ly = y(lb.c), lc = lb.c >= lb.o ? col.up : col.dn;
      ctx.save(); ctx.strokeStyle = lc; ctx.setLineDash([3, 4]); ctx.shadowColor = lc; ctx.shadowBlur = 8; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke(); ctx.restore();
    }
    colors(); size();
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(cv); else window.addEventListener('resize', size);
    window.addEventListener('stryker:theme', function () { colors(); draw(); });
    new MutationObserver(function () { colors(); draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (reduced) return;
    var n = 0;
    loop.add(cv, 150, function () {
      var b = bars[N - 1];
      b.c += rnd() * 0.9; b.h = Math.max(b.h, b.c); b.l = Math.min(b.l, b.c);
      if (++n % 16 === 0) { bars.shift(); bars.push(mk()); }
      draw();
    });
  }

  // ---- 24h session dial (market-hours.js) -------------------------------------------------------------
  function dial() {
    var svg = $('dk-dial'), MH = window.StrykerMarketHours; if (!svg || !MH) return;
    var C = 2 * Math.PI, R = [62, 53, 44], cls = ['as', 'lo', 'ny'], map = { 'Asia': 0, 'London': 1, 'New York': 2 };
    function el(n, a) { var e = document.createElementNS(NS, n); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
    function tzDate(tz, ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms)).split('-').map(Number); }
    var g = el('g', { transform: 'rotate(-90 80 80)' }); svg.appendChild(g);
    g.appendChild(el('circle', { cx: 80, cy: 80, r: 67, class: 'dk-d-face' }));
    var now = Date.now();
    MH.SESSIONS.forEach(function (s, i) {
      var d = tzDate(s.tz, now), a = MH.tzToUtc(s.tz, d[0], d[1], d[2], s.open, 0), b = MH.tzToUtc(s.tz, d[0], d[1], d[2], s.close, 0);
      var st = new Date(a), start = st.getHours() + st.getMinutes() / 60, len = (b - a) / 3.6e6, r = R[map[s.name]];
      g.appendChild(el('circle', { cx: 80, cy: 80, r: r, class: 'dk-d-track' }));
      [start, start - 24].forEach(function (off) {
        g.appendChild(el('circle', { cx: 80, cy: 80, r: r, pathLength: 24, 'stroke-dasharray': len + ' ' + (24 - len), 'stroke-dashoffset': -off, class: 'dk-d-arc dk-d-' + cls[map[s.name]], 'data-n': s.name }));
      });
    });
    for (var h = 0; h < 24; h += 3) {
      var an = h / 24 * C, big = h % 6 === 0;
      g.appendChild(el('line', { x1: 80 + Math.cos(an) * 69, y1: 80 + Math.sin(an) * 69, x2: 80 + Math.cos(an) * (big ? 74 : 72), y2: 80 + Math.sin(an) * (big ? 74 : 72), class: 'dk-d-tk' }));
    }
    var nd = el('line', { x1: 80, y1: 80, x2: 80 + 66, y2: 80, class: 'dk-d-needle' }); g.appendChild(nd);
    g.appendChild(el('circle', { cx: 80, cy: 80, r: 3, class: 'dk-d-hub' }));
    var k = $('dk-dial-k'), v = $('dk-dial-v');
    function upd() {
      var t = Date.now(), dt = new Date(t), hr = dt.getHours() + dt.getMinutes() / 60 + dt.getSeconds() / 3600;
      nd.setAttribute('transform', 'rotate(' + (hr / 24 * 360).toFixed(2) + ' 80 80)');
      var st = MH.sessionStatus(t), fs = MH.futuresStatus(t), open = fs.open ? st.open : [];
      var nx = st.next, txt = nx ? MH.fmtClock(nx.at - t) : '';
      if (k) k.textContent = (open.length ? open.map(function (o) { return o.short; }).join(' + ') + ' open' : (fs.open ? 'Between sessions' : 'Market closed')) + (nx ? ' · ' + nx.short + ' opens in' : '');
      if (v && v.textContent !== txt) v.textContent = txt || '--';
      svg.querySelectorAll('.dk-d-arc').forEach(function (a) { a.classList.toggle('is-on', open.some(function (o) { return o.name === a.getAttribute('data-n'); })); });
    }
    upd();
    if (!reduced) loop.add($('dk-dial-box'), 1000, upd);
  }

  // ---- floating chips (drift via CSS) -----------------------------------------------------------------
  function chips() {
    var EC = window.__EC, MM = window.__MM;
    DK.on(function (k, d) {
      if (k === 'ec' && d && EC) {
        var cur = d.defaultCurrency || 'USD', now = Date.now();
        var ev = (d.events || []).filter(function (e) { return e.cur === cur && Date.parse(e.at) > now && e.impact === 'high'; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); })[0];
        var b = document.querySelector('#dk-chip-ev b'); if (!b) return;
        if (!ev) { b.textContent = 'None scheduled'; return; }
        var at = Date.parse(ev.at), upd = function () { b.textContent = EC.countdown(Math.max(0, at - Date.now())); };
        upd(); if (!reduced) loop.add($('dk-chip-ev'), 1000, upd);
      }
      if (k === 'mm' && d && MM) {
        try {
          MM.setData(d); var r = MM.ranked(d.defaultPeriod || '1D')[0], b2 = document.querySelector('#dk-chip-mv b');
          if (r && b2) b2.textContent = (r.ticker || r.label) + ' ' + MM.fmtPct(r.v);
        } catch (e) {}
      }
    });
  }

  // ---- system status strip: each feed, with the age of its own timestamp ------------------------------------
  function status() {
    var host = $('dk-status'); if (!host) return;
    var FEEDS = [['ec', 'Calendar', function (d) { return d.isUpdated || Date.parse(d.generatedAt); }], ['mm', 'Market map', function (d) { return Date.parse(d.generatedAt); }], ['mb', 'Brief', function (d) { return Date.parse(d.generatedAt); }]];
    var st = {};
    function age(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
    function stale(d) {
      var until = Date.parse(d.goodUntil);
      if (isFinite(until)) return Date.now() > until;
      var t = Date.parse(d.generatedAt); if (!isFinite(t) && !d.isUpdated) return true;
      return (Date.now() - (d.isUpdated || t)) / 36e5 > (Number(d.staleAfterHours) || 30);
    }
    function paint() {
      host.querySelector('ul').innerHTML = FEEDS.map(function (f) {
        var d = st[f[0]], state = d === undefined ? 'wait' : (d === false ? 'bad' : (stale(d) ? 'old' : 'ok'));
        var t = state === 'wait' ? 'checking' : state === 'bad' ? 'unavailable' : 'updated ' + age(f[2](d));
        return '<li class="is-' + state + '"><i aria-hidden="true"></i><b>' + f[1] + '</b><span>' + esc(t) + '</span></li>';
      }).join('');
      var bad = FEEDS.some(function (f) { return st[f[0]] === false || (st[f[0]] && stale(st[f[0]])); });
      var all = FEEDS.every(function (f) { return st[f[0]] !== undefined; });
      var lab = host.querySelector('.dk-st-h span:last-child'); if (lab) lab.textContent = !all ? 'Checking feeds' : bad ? 'Some feeds are behind' : 'All feeds current';
      host.classList.toggle('is-warn', all && bad);
    }
    DK.on(function (k, d) { st[k] = d; paint(); });
    paint(); setInterval(paint, 30000);
  }

  function hero() {
    var h = $('dk-hero'); if (!h || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (e) { h.classList.toggle('is-off', !e[0].isIntersecting); }).observe(h);
    document.addEventListener('visibilitychange', function () { h.classList.toggle('is-off', document.hidden); });
  }

  function boot() { hero(); chart(); dial(); chips(); status(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
