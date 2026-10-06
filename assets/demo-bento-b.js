// Stryker Trading Academy: DEMO homepage, variation B "Trading terminal bento"
// (demo-bento-b.html only). Owner order 2026-10-06: bento demo homepages.
//
// What runs here:
//   - Status-bar clocks (New York + the visitor's local time) and the SESSION
//     pane from assets/market-hours.js (a clock, never market data).
//   - Ticker tape: one snapshot at page load. NQ/ES/GC/CL = last daily bar
//     from our own /api/chart/bars (Yahoo continuous front month, not a
//     stream); BTC = Binance spot 24h ticker (already in the site CSP, used by
//     Charts). If a symbol fails it shows "n/a". Nothing is invented and the
//     tape is labelled a snapshot. It scrolls on a rAF transform loop.
//   - GEX pane: free SPX 0DTE levels from /api/gex/levels/SPX, "updated X ago".
//   - CHARTS pane: recent NQ 15m bars from /api/chart/bars, drawn in on view.
//     Falls back to clearly labelled illustrative candles if the call fails.
//   - REPLAY pane: illustrative seeded candles stepping bar by bar.
//   - Keyboard shortcuts: G C J R L E S P focus a pane, H top, T theme, ? help.
// Motion: one rAF clock, transforms/opacity only, panes pause off-screen and
// on hidden tabs; prefers-reduced-motion draws everything once, statically.
// Depends on: assets/market-hours.js (window.StrykerMarketHours), style.css.
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  var esc = function (x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function fmt(n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function z(n) { return (n < 10 ? '0' : '') + n; }
  function css(k) { return (getComputedStyle(doc.body).getPropertyValue(k) || '').trim() || '#888'; }
  var COL = {};
  function readColors() { ['--tx-ink', '--tx-dim', '--tx-amber', '--tx-green', '--tx-red', '--tx-line'].forEach(function (k) { COL[k] = css(k); }); }

  readColors();

  // ---------------------------------------------------------------- rAF clock
  var jobs = [], running = false;
  function frame(now) {
    if (doc.hidden) { running = false; return; }
    var any = false;
    jobs.forEach(function (j) { if (j.on()) { any = true; j.fn(now); } });
    if (any) requestAnimationFrame(frame); else running = false;
  }
  function kick() { if (!running && !REDUCE && !doc.hidden) { running = true; requestAnimationFrame(frame); } }
  function job(el, fn) {
    var j = { vis: true, fn: fn, on: function () { return j.vis; } };
    if (el && window.IntersectionObserver) {
      j.vis = false;
      new IntersectionObserver(function (es) { es.forEach(function (e) { j.vis = e.isIntersecting; }); if (j.vis) kick(); }).observe(el);
    }
    jobs.push(j); return j;
  }
  doc.addEventListener('visibilitychange', kick);

  // ---------------------------------------------------------------- canvas surface
  function surface(cv, onFit) {
    var s = { cv: cv, ctx: cv.getContext('2d'), w: 0, h: 0 };
    function fit(first) {
      var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = Math.max(1, r.width); s.h = Math.max(1, r.height);
      cv.width = Math.round(s.w * dpr); cv.height = Math.round(s.h * dpr);
      s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (onFit && first !== true) onFit();
    }
    fit(true);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(cv);
    s.fit = fit; cv.__fit = fit; return s;
  }
  function drawCandles(s, bars, n, last) {
    var ctx = s.ctx, W = s.w, H = s.h; ctx.clearRect(0, 0, W, H);
    var vis = bars.slice(0, Math.max(1, n)); if (!vis.length) return null;
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b) { lo = Math.min(lo, b[3]); hi = Math.max(hi, b[2]); });
    var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    var y = function (v) { return 6 + (hi - v) / (hi - lo) * (H - 12); };
    var slot = (W - 46) / bars.length, w = Math.max(1, slot * 0.62);
    vis.forEach(function (b, i) {
      var x = i * slot + slot / 2, up = b[4] >= b[1], c = up ? COL['--tx-green'] : COL['--tx-red'];
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y(b[2])); ctx.lineTo(Math.round(x) + 0.5, y(b[3])); ctx.stroke();
      var t = y(Math.max(b[1], b[4])), bt = y(Math.min(b[1], b[4]));
      if (up) { ctx.globalAlpha = 0.9; ctx.fillRect(x - w / 2, t, w, Math.max(1, bt - t)); }
      else { ctx.globalAlpha = 1; ctx.fillRect(x - w / 2, t, w, Math.max(1, bt - t)); }
      ctx.globalAlpha = 1;
    });
    var lb = vis[vis.length - 1], ly = y(lb[4]);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = COL['--tx-amber']; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    return { y: ly, c: lb[4] };
  }

  // seeded illustrative candles (replay, and chart fallback)
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function fake(n, seed, start, vol) {
    var r = rng(seed), p = start, out = [];
    for (var i = 0; i < n; i++) {
      var o = p, c = o + (r() - 0.48) * vol * 2 + Math.sin(i / 9) * vol * 0.4;
      out.push([i, o, Math.max(o, c) + r() * vol, Math.min(o, c) - r() * vol, c, 0]); p = c;
    }
    return out;
  }

  // ---------------------------------------------------------------- clocks + session
  (function () {
    var MH = window.StrykerMarketHours;
    var nyF = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    var lcF = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    var ny = $('#tx-ny'), lc = $('#tx-lc'), up = $('#tx-up'), t0 = Date.now();
    var head = $('#tx-sess-head'), tail = $('#tx-sess-tail'), led = $('#tx-sess-led'), tape = $('#tx-tape-sess');
    var rows = $$('.tx-srow');
    function hourIn(tz, ms) {
      var p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' })
        .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return { h: (+p.hour % 24) + (+p.minute) / 60, wk: p.weekday === 'Sat' || p.weekday === 'Sun' };
    }
    function tick() {
      var now = Date.now();
      ny.textContent = nyF.format(now); if (lc) lc.textContent = lcF.format(now);
      var s = Math.floor((now - t0) / 1000);
      up.textContent = z(Math.floor(s / 3600)) + ':' + z(Math.floor(s / 60) % 60) + ':' + z(s % 60);
      if (!MH) return;
      var L = MH.sessionLabel(now);
      head.textContent = L.head; tail.textContent = L.tail ? '> ' + L.tail : '';
      led.classList.toggle('on', L.open);
      if (tape) tape.textContent = L.short;
      MH.SESSIONS.forEach(function (S, i) {
        var row = rows[i]; if (!row) return;
        var on = L.sessions.indexOf(S.name) >= 0, hh = hourIn(S.tz, now);
        var f = hh.wk ? 0 : Math.max(0, Math.min(1, (hh.h - S.open) / (S.close - S.open)));
        row.classList.toggle('on', on);
        row.querySelector('i').style.transform = 'scaleX(' + f.toFixed(3) + ')';
      });
    }
    tick();
    (function loop() { setTimeout(function () { if (!doc.hidden) tick(); loop(); }, 1000 - (Date.now() % 1000) + 5); })();
  })();

  // ---------------------------------------------------------------- ticker tape
  (function () {
    var run = $('#tx-tape-run'), set = $('#tx-tape-set'); if (!run || !set) return;
    var decimals = { NQ: 2, ES: 2, GC: 1, CL: 2, BTC: 0 };
    function paint(sym, last, prev) {
      $$('.tx-chip[data-sym="' + sym + '"]').forEach(function (ch) {
        var i = ch.querySelector('i'), e = ch.querySelector('em');
        if (last == null) { i.textContent = 'n/a'; e.textContent = ''; return; }
        i.textContent = fmt(last, decimals[sym]);
        if (prev) {
          var pct = (last - prev) / prev * 100;
          e.textContent = (pct >= 0 ? '▲ +' : '▼ ') + pct.toFixed(2) + '%';
          e.className = pct >= 0 ? 'up' : 'dn';
        }
      });
    }
    ['NQ', 'ES', 'GC', 'CL'].forEach(function (s) {
      fetch('/api/chart/bars/' + s + '?tf=D').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        var b = d && d.bars || []; if (!b.length) throw 0;
        paint(s, b[b.length - 1][4], b.length > 1 ? b[b.length - 2][4] : null);
      }).catch(function () { paint(s, null); });
    });
    fetch('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.lastPrice) throw 0;
      paint('BTC', +d.lastPrice, +d.lastPrice - +d.priceChange);
    }).catch(function () { paint('BTC', null); });

    if (REDUCE) return;
    var clone = set.cloneNode(true); clone.removeAttribute('id'); clone.setAttribute('aria-hidden', 'true');
    $$('[id]', clone).forEach(function (el) { el.removeAttribute('id'); });
    run.appendChild(clone);
    var x = 0, last = 0, w = set.offsetWidth, paused = false;
    if (window.ResizeObserver) new ResizeObserver(function () { w = set.offsetWidth; }).observe(set);
    run.addEventListener('pointerenter', function () { paused = true; });
    run.addEventListener('pointerleave', function () { paused = false; });
    // keep the clone's session text in step with the original
    var src = $('#tx-tape-sess'), dst = clone.querySelector('.tx-chip-sess i'), gsrc = $('#tx-tape-gex'), gdst = clone.querySelector('.tx-chip-gex i');
    job(null, function (now) {
      var dt = last ? Math.min(64, now - last) : 16; last = now;
      if (!paused) { x -= dt * 0.045; if (w && x <= -w) x += w; }
      run.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
      if (dst && dst.textContent !== src.textContent) dst.textContent = src.textContent;
      if (gdst && gdst.textContent !== gsrc.textContent) gdst.textContent = gsrc.textContent;
      // tape chips that are filled later are copied into the clone too
      $$('.tx-chip[data-sym]', set).forEach(function (c, k) {
        var d = clone.querySelectorAll('.tx-chip[data-sym]')[k];
        if (d && d.innerHTML !== c.innerHTML) d.innerHTML = c.innerHTML;
      });
    });
    kick();
  })();

  // ---------------------------------------------------------------- count-up numbers
  (function () {
    var els = $$('.tx-n');
    if (REDUCE || !window.IntersectionObserver) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; io.unobserve(e.target);
        var el = e.target, to = +el.getAttribute('data-to'), suf = el.getAttribute('data-suf') || '', t0 = 0;
        (function step(now) {
          if (!t0) t0 = now;
          var p = Math.min(1, (now - t0) / 900), v = Math.round(to * (1 - Math.pow(1 - p, 3)));
          el.textContent = (to >= 10 && v < 10 ? '0' : '') + v + suf;
          if (p < 1) requestAnimationFrame(step);
        })(performance.now());
      });
    }, { threshold: 0.1 });
    // the real number stays in the HTML until the pane is seen, so a fast
    // scroll past never leaves a 0 behind
    els.forEach(function (el) { io.observe(el); });
  })();

  // ---------------------------------------------------------------- GEX pane
  (function () {
    var meta = $('#tx-gex-meta'), lad = $('#tx-ladder'); if (!meta) return;
    function ago(sec) {
      if (!sec) return '';
      var m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
      if (m < 60) return 'updated ' + m + ' min ago';
      var h = Math.floor(m / 60); return h < 48 ? 'updated ' + h + ' h ago' : 'updated ' + Math.floor(h / 24) + ' d ago';
    }
    function tsOf(d) {
      if (d.market && d.market.options_ts) return d.market.options_ts;
      return null;
    }
    function set(id, v) { var el = $('#' + id); el.textContent = v; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    fetch('/api/gex/levels/SPX?dte=0', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || d.call_wall == null || d.put_wall == null || d.spot == null) throw 0;
      var seq = [['lv-call', fmt(d.call_wall, 2)], ['lv-spot', fmt(d.spot, 2)], ['lv-zero', d.zero_gamma == null ? 'n/a' : fmt(d.zero_gamma, 2)], ['lv-put', fmt(d.put_wall, 2)], ['lv-reg', String(d.regime || 'n/a').toLowerCase()]];
      seq.forEach(function (p, i) { setTimeout(function () { set(p[0], p[1]); }, REDUCE ? 0 : 140 * i); });
      var gt = $('#tx-tape-gex'); if (gt) gt.textContent = 'call wall ' + fmt(d.call_wall, 0) + ' · put wall ' + fmt(d.put_wall, 0) + ' · regime ' + String(d.regime || '').toLowerCase();
      var parts = ['SPX', d.expiry ? 'exp ' + d.expiry : '0DTE'], a = ago(tsOf(d));
      var closed = d.market && d.market.state && d.market.state !== 'open' && d.market.state !== 'stale';
      if (a) parts.push((closed ? 'last session, ' : '') + a);
      meta.textContent = parts.join(' · ');
      setInterval(function () { var a2 = ago(tsOf(d)); if (a2) { parts[2] = (closed ? 'last session, ' : '') + a2; meta.textContent = parts.join(' · '); } }, 30000);
      // strike ladder: the 7 strikes with the most gamma near spot, high to low
      var near = (d.ladder || []).filter(function (x) { return x && isFinite(x.gex) && Math.abs(x.gex) > 0 && Math.abs(x.strike - d.spot) / d.spot < 0.03; })
        .sort(function (a, b) { return Math.abs(b.gex) - Math.abs(a.gex); }).slice(0, 7)
        .sort(function (a, b) { return b.strike - a.strike; });
      if (!near.length) return;
      var mx = Math.max.apply(null, near.map(function (x) { return Math.abs(x.gex); }));
      lad.innerHTML = '<div class="tx-lad" style="color:var(--tx-dim)"><span>STRIKE</span><span>gamma (relative)</span></div>' + near.map(function (x) {
        return '<div class="tx-lad' + (Math.abs(x.strike - d.spot) < 6 ? ' spot' : '') + '"><span>' + fmt(x.strike, 0) + '</span><i data-f="' + (Math.abs(x.gex) / mx).toFixed(3) + '"' + (x.gex < 0 ? ' style="background:var(--tx-red)"' : '') + '></i></div>';
      }).join('');
      var grow = function () { $$('i', lad).forEach(function (i) { i.style.transform = 'scaleX(' + i.getAttribute('data-f') + ')'; }); };
      if (REDUCE || !window.IntersectionObserver) grow();
      else { var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); grow(); } }); io.observe(lad); }
    }).catch(function () {
      meta.textContent = 'levels did not load. Open GEX for the full view.';
      ['lv-call', 'lv-spot', 'lv-zero', 'lv-put', 'lv-reg'].forEach(function (id) { $('#' + id).textContent = 'n/a'; });
    });
  })();

  // ---------------------------------------------------------------- CHARTS pane
  (function () {
    var cv = $('#tx-ch-cv'); if (!cv) return;
    var bars = null, n = 0, t0 = 0, done = false, real = false;
    var px = $('#tx-ch-px'), meta = $('#tx-ch-meta');
    var s = surface(cv, function () { if (bars) paint(); });
    function paint() {
      var r = drawCandles(s, bars, n);
      if (r && px) { px.style.transform = 'translateY(' + (r.y - 8).toFixed(1) + 'px)'; px.style.top = '0'; px.style.opacity = '1'; px.textContent = fmt(r.c, 2); }
    }
    function start(b, isReal) {
      bars = b; real = isReal; n = REDUCE ? b.length : 1; t0 = 0; done = REDUCE; paint();
      if (!isReal) { meta.textContent = 'illustrative candles (bars did not load)'; $('#tx-ch-path').textContent = 'illustrative · 15m'; }
      else {
        var lt = new Date(b[b.length - 1][0] * 1000);
        meta.textContent = 'NQ 15m · last ' + b.length + ' bars · to ' + lt.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' your time · not streaming';
      }
      kick();
    }
    function get(page) { return fetch('/api/chart/bars/NQ?tf=15' + (page != null ? '&page=' + page : '')).then(function (r) { return r.ok ? r.json() : null; }); }
    get(null).then(function (d) {
      var b = d && d.bars || [];
      if (b.length >= 60) return b;
      if (!d || d.page == null) return b;
      return get(d.page - 1).then(function (d2) { return ((d2 && d2.bars) || []).concat(b); });
    }).then(function (b) {
      if (!b || b.length < 20) throw 0;
      start(b.slice(-72).map(function (x) { return [x[0], +x[1], +x[2], +x[3], +x[4], x[5]]; }), true);
    }).catch(function () { start(fake(72, 7, 100, 1.2), false); });
    job(cv, function (now) {
      if (!bars || done) return;
      if (!t0) t0 = now;
      var k = Math.min(bars.length, 1 + Math.floor((now - t0) / 28));
      if (k !== n) { n = k; paint(); }
      if (n >= bars.length) done = true;
    });
  })();

  // ---------------------------------------------------------------- REPLAY pane
  var replay = null;
  (function () {
    var cv = $('#tx-re-cv'); if (!cv) return;
    var all = fake(120, 23, 100, 0.9), WIN = 48, i = REDUCE ? 70 : 24, sp = 1, playing = !REDUCE, acc = 0, last = 0;
    var nEl = $('#tx-re-n'), btn = $('#tx-re-play');
    var s = surface(cv, function () { paint(); });
    function paint() {
      var from = Math.max(0, i - WIN), win = all.slice(from, from + WIN);
      drawCandles(s, win, i - from);
      nEl.textContent = ('00' + i).slice(-3);
    }
    function setPlay(p) {
      playing = p; btn.setAttribute('aria-pressed', p ? 'true' : 'false');
      btn.setAttribute('aria-label', p ? 'Pause replay' : 'Play replay'); btn.textContent = p ? '❚❚' : '▶';
      if (p) { last = 0; kick(); }
    }
    btn.addEventListener('click', function () { setPlay(!playing); });
    $$('.tx-re-sp button').forEach(function (b) {
      b.addEventListener('click', function () { sp = +b.getAttribute('data-sp'); $$('.tx-re-sp button').forEach(function (o) { o.classList.toggle('on', o === b); }); if (!playing) setPlay(true); });
    });
    if (REDUCE) setPlay(false);
    paint();
    job(cv, function (now) {
      if (!playing) { last = 0; return; }
      var dt = last ? Math.min(100, now - last) : 0; last = now; acc += dt * sp;
      if (acc >= 420) { acc = 0; i++; if (i > all.length) i = 24; paint(); }
    });
    replay = { toggle: function () { setPlay(!playing); } };
  })();

  // ---------------------------------------------------------------- LEARN typewriter
  (function () {
    var idEl = $('#tx-cat-id'), out = $('#tx-cat-out'); if (!out) return;
    var CH = [
      ['ch01', 'Candles, Charts & the Language of Price'], ['ch07', 'Liquidity: BSL, SSL & Resting Orders'],
      ['ch09', 'Order Blocks: Identification & Validity'], ['ch10', 'Fair Value Gaps & Imbalance'],
      ['ch13', 'Killzones & Session Timing'], ['ch18', 'Introduction to SMT Divergence'],
      ['ch24', 'Power of Three: AMD in Practice'], ['ch26', 'Optimal Trade Entry (OTE) Zones'],
      ['vp03', 'Volume Profile Anatomy: POC, Value Area, HVN & LVN'], ['vp08', 'Footprint Charts & Delta'],
      ['pf04', 'The Rules Deep Dive'], ['pf06', 'Passing the Evaluation: Sizing, Risk Plan & Frequency']
    ];
    if (REDUCE) return;
    var k = 0, vis = true;
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; }).observe(out);
    function type(str, cb) {
      var j = 0; (function t() { out.textContent = str.slice(0, j) + (j < str.length ? '▌' : ''); if (j++ < str.length) setTimeout(t, 26); else cb(); })();
    }
    (function next() {
      setTimeout(function () {
        if (!vis || doc.hidden) return next();
        k = (k + 1) % CH.length; idEl.textContent = CH[k][0]; type(CH[k][1], next);
      }, 2600);
    })();
  })();

  // ---------------------------------------------------------------- JOURNAL heatmap + coach (sample)
  (function () {
    var heat = $('#tx-heat'); if (!heat) return;
    var r = rng(5), h = '';
    for (var i = 0; i < 60; i++) { var v = r(); h += '<i class="' + (i % 7 > 4 ? '' : v > 0.75 ? 'b' : v > 0.45 ? 'a' : v > 0.3 ? 'c' : '') + '"></i>'; }
    heat.innerHTML = h;
    var msgs = ['checks each trade against your own rules', 'flags entries outside your killzone', 'spots when size drifts from your plan', 'groups trades by setup so you can review them'];
    var el = $('#tx-coach'), k = 0;
    if (REDUCE) return;
    setInterval(function () { if (doc.hidden) return; k = (k + 1) % msgs.length; el.style.opacity = '0'; setTimeout(function () { el.textContent = msgs[k]; el.style.opacity = '1'; }, 220); }, 3400);
    el.style.transition = 'opacity .2s';
  })();

  // ---------------------------------------------------------------- CALENDAR
  (function () {
    var ul = $('#tx-ev'); if (!ul) return;
    var f = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var items = [];
    function inTxt(ms) {
      var d = ms - Date.now(); if (d <= 0) return 'now';
      var m = Math.floor(d / 60000), dd = Math.floor(m / 1440), hh = Math.floor(m / 60) % 24, mm = m % 60;
      return 'in ' + (dd ? dd + 'd ' : '') + z(hh) + 'h ' + z(mm) + 'm';
    }
    fetch('assets/econ-calendar.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
      var now = Date.now();
      var ev = (d.events || []).filter(function (e) { return e.impact === 'high' && Date.parse(e.at) > now; })
        .sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); }).slice(0, 5);
      if (!ev.length) { ul.innerHTML = '<li class="tx-dim">No high-impact releases left in this calendar window.</li>'; return; }
      ul.innerHTML = ev.map(function (e) {
        return '<li><span class="c">' + esc(e.cur) + '</span><span class="n">' + esc(e.event) + '</span><span class="t">' + esc(f.format(new Date(e.at))) + '</span><span class="in" data-at="' + Date.parse(e.at) + '"></span></li>';
      }).join('');
      items = $$('.in', ul);
      var tick = function () { items.forEach(function (el) { el.textContent = inTxt(+el.getAttribute('data-at')); }); };
      tick(); setInterval(function () { if (!doc.hidden) tick(); }, 30000);
    }).catch(function () { ul.innerHTML = '<li class="tx-dim">The calendar did not load. Open the full calendar.</li>'; });
  })();

  // ---------------------------------------------------------------- closing typewriter
  (function () {
    var el = $('#tx-type'); if (!el) return;
    var cmds = ['stryker --start-free', 'open chapter 01', 'open charts', 'gex spx --dte 0'];
    if (REDUCE) { el.textContent = cmds[0]; return; }
    var k = 0, vis = false;
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; }).observe(el); else vis = true;
    (function loop() {
      if (!vis || doc.hidden) return setTimeout(loop, 600);
      var s = cmds[k++ % cmds.length], j = 0;
      (function t() { el.textContent = s.slice(0, j); if (j++ < s.length) setTimeout(t, 55); else setTimeout(loop, 2200); })();
    })();
  })();

  // ---------------------------------------------------------------- keyboard + pane focus
  (function () {
    var help = $('#tx-help'), helpBox = $('.tx-help-box'), opener = null;
    var panes = {}; $$('.tx-pane[data-key]').forEach(function (p) { panes[p.getAttribute('data-key')] = p; });
    var focused = null;
    function focusPane(k) {
      var p = panes[k]; if (!p) return;
      if (focused) focused.classList.remove('is-focus');
      focused = p; p.classList.add('is-focus');
      p.focus({ preventScroll: true });
      var top = p.getBoundingClientRect().top + window.pageYOffset - 84;
      window.scrollTo({ top: Math.max(0, top), behavior: REDUCE ? 'auto' : 'smooth' });
      clearTimeout(focusPane.t); focusPane.t = setTimeout(function () { p.classList.remove('is-focus'); }, 2400);
    }
    function openHelp() { opener = doc.activeElement; help.hidden = false; helpBox.focus(); }
    function closeHelp() { help.hidden = true; if (opener && opener.focus) opener.focus(); }
    help.addEventListener('click', function (e) { if (e.target === help || e.target.closest('[data-close]')) closeHelp(); });
    $('#tx-help-btn').addEventListener('click', openHelp);
    $$('[data-jump]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); focusPane(a.getAttribute('data-jump')); }); });
    doc.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (!help.hidden) { if (e.key === 'Escape') { e.preventDefault(); closeHelp(); } return; }
      var k = e.key.toLowerCase();
      if (e.key === '?') { e.preventDefault(); openHelp(); return; }
      if (k === 't') { e.preventDefault(); $('#tx-theme').click(); return; }
      if (k === 'h') { e.preventDefault(); focusPane('h'); return; }
      if (k === ' ' && focused === panes.r && doc.activeElement === panes.r && replay) { e.preventDefault(); replay.toggle(); return; }
      if (panes[k]) { e.preventDefault(); focusPane(k); }
    });
  })();

  // ---------------------------------------------------------------- theme
  (function () {
    var b = $('#tx-theme'), l = $('#tx-theme-l');
    function label() { l.textContent = root.getAttribute('data-theme') === 'light' ? 'day' : 'night'; }
    label();
    b.addEventListener('click', function () {
      var day = root.getAttribute('data-theme') !== 'light';
      if (day) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem('stryker_theme', day ? 'day' : 'night'); } catch (e) {}
      label(); readColors();
      $$('canvas.tx-cv').forEach(function (c) { if (c.__fit) c.__fit(); });
    });
  })();

  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(readColors);
  kick();
})();
