// TradeZoro: ZoroCharts feature page (/features/charts), page-only motion. No libraries.
//   1. Hero demo: SAMPLE data only (seeded random walk). Switch BTC/NQ/ES, toggle EMA / Volume / a trend line, replay slider.
//   2. "Watch a chart come together" scroll story: 7 layers switch on as the sticky section scrolls.
//   3. Order flow gallery tabs (real screenshots).
// Reveals, parallax, toasts, tilt, magnetic buttons and the Rithmic flow diagram come from assets/creators-motion.js.
// prefers-reduced-motion: the story shows every layer at once, the replay play button steps without animation.
// Depends on: assets/charts-page.css, assets/creators-page.css. Used by: features/charts.html.
(function () {
  var doc = document, NS = 'http://www.w3.org/2000/svg';
  var rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  function el(n, a, p) { var e = doc.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
  function walk(n, base, vol, seed) {
    var r = rng(seed), p = base, a = [], tr = 0;
    for (var i = 0; i < n; i++) { tr = tr * 0.9 + (r() - 0.5) * 0.6; var o = p, c = o * (1 + (tr * 0.5 + (r() - 0.5)) * vol * 2), h = Math.max(o, c) * (1 + r() * vol * 0.8), l = Math.min(o, c) * (1 - r() * vol * 0.8); a.push([o, h, l, c, 0.3 + r() * 0.7]); p = c; }
    return a;
  }

  function ready(fn) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () {
    // ------------------------------------------------------------ 1. hero demo
    var root = doc.querySelector('[data-zc-demo]');
    if (root) (function () {
      var S = { BTC: { b: 64000, v: 0.0042, d: 0, s: 11 }, NQ: { b: 21400, v: 0.0016, d: 0, s: 23 }, ES: { b: 5850, v: 0.0011, d: 2, s: 37 } };
      var N = 120, sym = 'BTC', bars = N, on = { ema: true, vol: true, line: false }, timer = null, data = {};
      Object.keys(S).forEach(function (k) { data[k] = walk(N, S[k].b, S[k].v, S[k].s); });
      var W = 640, H = 300, PL = 8, PR = 56, PT = 12, PB = 40, svg = root.querySelector('svg'), out = root.querySelector('output'), range = root.querySelector('input'), pb = root.querySelector('.dm-rp button');
      var ICON = { play: '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>', pause: '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>' };
      function draw() {
        var a = data[sym], lo = 1e12, hi = 0;
        a.forEach(function (x) { lo = Math.min(lo, x[2]); hi = Math.max(hi, x[1]); });
        var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
        var Y = function (v) { return PT + (hi - v) / (hi - lo) * (H - PT - PB); }, st = (W - PL - PR) / N, X = function (i) { return PL + i * st + st / 2; };
        svg.textContent = '';
        for (var i = 0; i < 5; i++) { var y = PT + i * (H - PT - PB) / 4; el('line', { x1: 0, x2: W - PR, y1: y, y2: y, class: 'gl' }, svg); var t = el('text', { x: W - PR + 6, y: y + 4, class: 'ax' }, svg), v = hi - i * (hi - lo) / 4; t.textContent = S[sym].d ? v.toFixed(S[sym].d) : Math.round(v).toLocaleString('en-US'); }
        if (on.vol) { var g = el('g', {}, svg); for (var j = 0; j < bars; j++) el('rect', { x: PL + j * st + 1, width: Math.max(1, st - 2), y: H - PB - a[j][4] * 34, height: a[j][4] * 34, class: 'vb' }, g); }
        var cg = el('g', {}, svg);
        for (var k = 0; k < bars; k++) { var b = a[k], gr = el('g', { class: b[3] >= b[0] ? 'u' : 'd' }, cg); el('line', { x1: X(k), x2: X(k), y1: Y(b[1]), y2: Y(b[2]), 'stroke-width': 1 }, gr); el('rect', { x: X(k) - st * 0.32, width: st * 0.64, y: Math.min(Y(b[0]), Y(b[3])), height: Math.max(1.5, Math.abs(Y(b[0]) - Y(b[3]))) }, gr); }
        if (on.ema && bars > 1) { var m = 0, d = '', kf = 2 / 21; for (var q = 0; q < bars; q++) { m = q ? a[q][3] * kf + m * (1 - kf) : a[q][3]; d += (q ? 'L' : 'M') + X(q).toFixed(1) + ' ' + Y(m).toFixed(1); } el('path', { d: d, class: 'ema' }, svg); }
        if (on.line && bars > 40) { // trend line between the two lowest lows of each half of what is shown
          var lowIn = function (s, e) { var bi = s; for (var z = s; z < e; z++) if (a[z][2] < a[bi][2]) bi = z; return bi; };
          var i1 = lowIn(0, Math.floor(bars / 2)), i2 = lowIn(Math.floor(bars / 2), bars), x1 = X(i1), y1 = Y(a[i1][2]), x2 = X(i2), y2 = Y(a[i2][2]), ex = W - PR, ey = y1 + (y2 - y1) * (ex - x1) / Math.max(1, x2 - x1);
          el('line', { x1: x1, y1: y1, x2: ex, y2: ey, class: 'tl' }, svg); el('circle', { cx: x1, cy: y1, r: 4, class: 'tlh' }, svg); el('circle', { cx: x2, cy: y2, r: 4, class: 'tlh' }, svg);
        }
        var cx = PL + bars * st - st / 2; el('line', { x1: cx, x2: cx, y1: PT, y2: H - PB, class: 'cur' }, svg);
        out.textContent = bars >= N ? 'Latest bar' : 'Bar ' + bars + ' of ' + N; range.value = bars; range.setAttribute('aria-valuetext', out.textContent);
      }
      function stop() { clearInterval(timer); timer = null; pb.setAttribute('aria-label', 'Play replay'); pb.innerHTML = ICON.play; }
      root.querySelectorAll('.seg button').forEach(function (b) { b.addEventListener('click', function () { sym = b.getAttribute('data-s'); root.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); draw(); }); });
      root.querySelectorAll('[data-ind]').forEach(function (b) { b.addEventListener('click', function () { var v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); on[b.getAttribute('data-ind')] = v; draw(); }); });
      range.addEventListener('input', function () { bars = +range.value; stop(); draw(); });
      pb.addEventListener('click', function () {
        if (timer) { stop(); return; }
        if (bars >= N) bars = 30;
        pb.setAttribute('aria-label', 'Pause replay'); pb.innerHTML = ICON.pause; draw();
        timer = setInterval(function () { bars++; draw(); if (bars >= N) stop(); }, rm ? 160 : 90);
      });
      stop(); draw();
    })();

    // ------------------------------------------------------------ 2. scroll story
    var story = doc.querySelector('[data-zc-story]');
    if (story) (function () {
      var svg = story.querySelector('.zc-sv svg'), W = 640, H = 380, PR = 52, n = 48, st = (W - 16 - PR) / n;
      var a = walk(n, 21400, 0.0022, 51), lo = 1e12, hi = 0; a.forEach(function (x) { lo = Math.min(lo, x[2]); hi = Math.max(hi, x[1]); });
      var top = 16, bot = 236, pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      var Y = function (v) { return top + (hi - v) / (hi - lo) * (bot - top); }, X = function (i) { return 8 + i * st + st / 2; };
      var L = []; function layer() { var g = el('g', { class: 'zl' }, svg); L.push(g); return g; }
      // 0 market: grid + candles + symbol label
      var g0 = layer();
      for (var i = 0; i < 4; i++) el('line', { x1: 0, x2: W - PR, y1: top + i * (bot - top) / 3, y2: top + i * (bot - top) / 3, class: 'gl' }, g0);
      el('text', { x: 12, y: 30, class: 'lbl' }, g0).textContent = 'NQ · 5m · sample';
      a.forEach(function (b, k) { var gr = el('g', { class: b[3] >= b[0] ? 'u' : 'd' }, g0); el('line', { x1: X(k), x2: X(k), y1: Y(b[1]), y2: Y(b[2]), 'stroke-width': 1 }, gr); el('rect', { x: X(k) - st * 0.3, width: st * 0.6, y: Math.min(Y(b[0]), Y(b[3])), height: Math.max(1.5, Math.abs(Y(b[0]) - Y(b[3]))) }, gr); });
      // 1 indicators: EMA + RSI-like pane line
      var g1 = layer(), m = 0, d = '', kf = 2 / 11; a.forEach(function (b, q) { m = q ? b[3] * kf + m * (1 - kf) : b[3]; d += (q ? 'L' : 'M') + X(q).toFixed(1) + ' ' + Y(m).toFixed(1); }); el('path', { d: d, class: 'ema' }, g1);
      el('line', { x1: 0, x2: W - PR, y1: 300, y2: 300, class: 'pl' }, g1);
      var r = rng(9), d2 = ''; for (var q = 0; q < n; q++) d2 += (q ? 'L' : 'M') + X(q).toFixed(1) + ' ' + (330 - (a[q][3] - a[Math.max(0, q - 3)][0]) / (hi - lo) * 140 + (r() - 0.5) * 6).toFixed(1); el('path', { d: d2, class: 'ind' }, g1);
      el('text', { x: 12, y: 316, class: 'lbl' }, g1).textContent = 'Indicator pane';
      // 2 drawings: trend line + box
      var g2 = layer(), lowI = 0, hiI = 0; for (var z = 0; z < 24; z++) if (a[z][2] < a[lowI][2]) lowI = z; for (z = 24; z < n; z++) if (a[z][1] > a[hiI][1] || hiI < 24) hiI = z;
      el('line', { x1: X(lowI), y1: Y(a[lowI][2]), x2: X(hiI), y2: Y(a[hiI][1]), class: 'drw' }, g2); el('circle', { cx: X(lowI), cy: Y(a[lowI][2]), r: 4, class: 'hd' }, g2); el('circle', { cx: X(hiI), cy: Y(a[hiI][1]), r: 4, class: 'hd' }, g2);
      el('rect', { x: X(30), y: Y(a[30][1]) - 6, width: st * 10, height: 30, class: 'box' }, g2);
      // 3 order flow: delta bars in the lower pane replace nothing, sit at 350
      var g3 = layer(); a.forEach(function (b, k) { var dv = (b[3] - b[0]) / (hi - lo) * 220; el('rect', { x: X(k) - st * 0.3, width: st * 0.6, y: dv > 0 ? 356 - dv : 356, height: Math.max(1, Math.abs(dv)), class: dv > 0 ? 'dp' : 'dn' }, g3); });
      el('text', { x: 12, y: 372, class: 'lbl' }, g3).textContent = 'Delta';
      // 4 GEX lines
      var g4 = layer(), lv = [[hi - (hi - lo) * 0.12, 'gc', 'Call wall'], [lo + (hi - lo) * 0.5, 'gz', 'Zero gamma'], [lo + (hi - lo) * 0.1, 'gp', 'Put wall']];
      lv.forEach(function (l) { el('line', { x1: 0, x2: W - PR, y1: Y(l[0]), y2: Y(l[0]), class: 'gx ' + l[1] }, g4); el('text', { x: W - PR + 4, y: Y(l[0]) + 4, class: 'gt ' + l[1] }, g4).textContent = l[2].split(' ')[0]; });
      // 5 replay: future masked + cursor + control pill
      var g5 = layer(), rx = X(34) + st / 2; el('rect', { x: rx, y: 0, width: W - rx, height: H, class: 'fut' }, g5); el('line', { x1: rx, x2: rx, y1: 8, y2: H - 8, class: 'rcur' }, g5);
      el('rect', { x: 220, y: 12, width: 200, height: 32, rx: 16, class: 'rbar' }, g5); el('path', { d: 'M238 20l12 8-12 8z', class: 'rpl' }, g5); el('text', { x: 262, y: 32, class: 'rbt' }, g5).textContent = 'Replay · bar 35 of 48';
      // 6 save & share card
      var g6 = layer(); el('rect', { x: 372, y: 250, width: 220, height: 64, rx: 12, class: 'card' }, g6); el('text', { x: 388, y: 276, class: 'ct' }, g6).textContent = 'Layout saved'; el('text', { x: 388, y: 296, class: 'cs' }, g6).textContent = 'Link only · link copied';

      var lis = Array.prototype.slice.call(story.querySelectorAll('.cm-steps-list li')), cap = story.querySelector('[data-zc-cap]'), bar = story.querySelector('[data-zc-bar]'), cur = -2;
      var txt = lis.map(function (li) { return li.querySelector('b').textContent + '. ' + li.querySelector('p').textContent; });
      function set(s) {
        if (s === cur) return; cur = s;
        L.forEach(function (g, i) { g.classList.toggle('on', i <= s); });
        lis.forEach(function (li, i) { li.classList.toggle('on', i === s); li.classList.toggle('done', i < s); });
        if (cap) cap.textContent = s >= 0 ? (s + 1) + ' of ' + L.length + '. ' + txt[s] : '';
      }
      if (rm || typeof IntersectionObserver !== 'function') { L.forEach(function (g) { g.classList.add('on'); }); lis.forEach(function (li) { li.classList.add('done'); }); return; }
      story.classList.add('on');
      var ticking = false;
      function tick() {
        ticking = false;
        var b = story.getBoundingClientRect(), total = b.height - innerHeight, p = Math.max(0, Math.min(1, -b.top / Math.max(1, total)));
        if (bar) bar.style.transform = 'scaleX(' + p + ')';
        set(b.top > innerHeight * 0.5 ? -1 : Math.min(L.length - 1, Math.floor(p * L.length * 0.999)));
      }
      addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(tick); } }, { passive: true });
      addEventListener('resize', tick); tick();
    })();

    // ------------------------------------------------------------ 3. order flow gallery
    var gal = doc.querySelector('[data-zc-gal]');
    if (gal) (function () {
      var tabs = Array.prototype.slice.call(gal.querySelectorAll('[role="tab"]')), img = gal.querySelector('.zc-galm img'), ver = (img.getAttribute('src').split('?v=')[1] || '');
      function pick(b) {
        tabs.forEach(function (t) { var s = t === b; t.setAttribute('aria-selected', String(s)); t.tabIndex = s ? 0 : -1; });
        var src = '/assets/images/orderflow/' + b.getAttribute('data-src') + '?v=' + ver;
        var go = function () { img.src = src; img.width = +b.getAttribute('data-w'); img.height = +b.getAttribute('data-h'); img.alt = b.getAttribute('data-alt'); img.classList.remove('swap'); };
        if (rm) go(); else { img.classList.add('swap'); setTimeout(go, 180); }
        var row = b.parentNode, l = b.offsetLeft - (row.clientWidth - b.offsetWidth) / 2; row.scrollLeft = Math.max(0, Math.min(l, row.scrollWidth - row.clientWidth));
      }
      tabs.forEach(function (b, i) {
        b.tabIndex = i ? -1 : 0;
        b.addEventListener('click', function () { pick(b); });
        b.addEventListener('keydown', function (e) { var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!k) return; e.preventDefault(); var nb = tabs[(i + k + tabs.length) % tabs.length]; nb.focus(); pick(nb); });
      });
    })();
  });
})();
