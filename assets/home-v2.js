// TradeZoro homepage v2 PREVIEW (demo-home-v2.html, Owner 19 Nov): page-only motion, no libraries.
//   1. Hero motion graphic (full-width canvas, one rAF clock): real recorded NQ 1-minute bars from the fixed file
//      assets/data/hero-session.json stream in left to right, the last bars form tick by tick; illustrative GEX walls draw
//      in, breathe and flash where price reaches them; GEX bars, volume, price scale, time labels, last-price tag.
//      ~11 s, hold, fade, replay. Paused off screen / hidden tab. Reduced motion = final frame.
//      window.__hvSeek(t) draws frame t and stops the clock (video capture).
//   2. Fanned montage: adds .in when scrolled into view (side shots settle outward).
//   3. Scroll reveals (.hv-rv -> .in), IntersectionObserver only.
//   4. Sticky verb story (desktop >= 900 px): the step for the current scroll position gets .on. Phone: stacked cards, no JS.
//   5. Persona tabs: WAI-ARIA tabs (click, arrow keys, Home/End).
// prefers-reduced-motion (html.hv-rm, set in <head>): everything shows in its final state; the story still switches steps.
// Depends on: assets/home-v2.css. Header/menu/theme come from assets/home-a.js + assets/theme.js.
(function () {
  var doc = document, root = doc.documentElement;
  var hasIO = typeof IntersectionObserver === 'function';
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  function once(el, cls, th) {
    if (!el) return;
    if (!hasIO || root.classList.contains('hv-rm')) { el.classList.add(cls); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); } });
    }, { threshold: th || 0.15 });
    io.observe(el);
  }

  // ---- hero motion graphic ----
  // Bars: assets/data/hero-session.json = recorded NQ 1-minute bars (10 Nov 2026, 12:07-14:26 ET) from our chart history,
  // shifted by data.rebase points so the levels below sit on round strikes. Fixed file, never an API call.
  // Levels + GEX per strike are illustrative (walls placed where this session swept, chopped and stalled).
  var PW = 27500, ZG = 27600, CW = 27750;
  var GEX = { 27800: 0.3, 27775: 0.5, 27750: 1, 27725: 0.62, 27700: 0.46, 27675: 0.34, 27650: 0.22, 27625: 0.12, 27600: 0.05,
    27575: -0.16, 27550: -0.3, 27525: -0.52, 27500: -0.95, 27475: -0.44, 27450: -0.22 };
  // timing (s): walls draw in, bars stream fast up to the last LIVE ones, which form tick by tick, then hold + fade
  var LIVE = 3, T_C0 = 0.9, T_FAST = 6.2, T_BAR = 1.25, T_END = T_C0 + T_FAST + LIVE * T_BAR, T_HOLD = 1.3, T_FADE = 0.6;
  var T_LOOP = T_END + T_HOLD + T_FADE;

  function hash(i) { var x = Math.sin(i * 127.1 + 11.7) * 43758.5453; return x - Math.floor(x); }
  function bars(rows, shift) { // + intrabar tick path: o -> wander -> first extreme -> wander -> second extreme -> wander -> c
    return rows.map(function (r, i) {
      var o = r[1] + shift, h = r[2] + shift, l = r[3] + shift, c = r[4] + shift, mid = function (s) { return l + (h - l) * (0.25 + 0.5 * hash(i * 7 + s)); };
      var lowFirst = c >= o; // bull bars usually print the low first, bear bars the high
      return { t: r[0], o: o, h: h, l: l, c: c, v: r[5],
        pts: [o, mid(1), lowFirst ? l : h, mid(2), mid(3), lowFirst ? h : l, mid(4), c] };
    });
  }
  function tickAt(k, f) { // price at fraction f of the bar, on the 0.25 tick grid
    if (f >= 1) return k.c;
    var n = k.pts.length - 1, u = Math.max(f, 0) * n, j = Math.min(Math.floor(u), n - 1), p = k.pts[j] + (k.pts[j + 1] - k.pts[j]) * (u - j);
    return Math.round(p * 4) / 4;
  }
  function rangeAt(k, f) { // high/low printed so far
    if (f >= 1) return [k.h, k.l];
    var n = k.pts.length - 1, u = Math.max(f, 0) * n, hi = k.o, lo = k.o, p = tickAt(k, f);
    for (var j = 1; j <= u; j++) { hi = Math.max(hi, k.pts[j]); lo = Math.min(lo, k.pts[j]); }
    return [Math.max(hi, p), Math.min(lo, p)];
  }
  function hexA(c, a) { // '#rrggbb' or '#rgb' -> rgba()
    c = (c || '').trim();
    if (c[0] !== '#') return c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    var n = parseInt(c.slice(1, 7), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  var ease = function (x) { x = Math.min(Math.max(x, 0), 1); return 1 - Math.pow(1 - x, 3); };
  var fmt = function (v, d) { return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var hhmm = function (t) { var m = Math.floor(((t - 5 * 3600) % 86400) / 60); return (Math.floor(m / 60)) + ':' + String(m % 60).padStart(2, '0'); }; // ET (EST, Nov)

  function heroArt(cv) {
    if (!cv || !cv.getContext || !window.fetch) return;
    var ctx = cv.getContext('2d'), wrap = cv.parentNode, ex = wrap.querySelector('.hv-ex');
    var rm = root.classList.contains('hv-rm');
    var all = [], ks = [], W = 0, H = 0, dpr = 1, phone = false, C = {}, L = {}, touches = [];
    var T = rm ? T_END + 1 : 0, last = 0, raf = 0, onScreen = false, seeking = false, ready = false;

    function colours() {
      var cs = getComputedStyle(root), g = function (n) { return cs.getPropertyValue(n).trim(); };
      C = { bull: g('--bull'), bear: g('--bear'), amber: g('--amber'), line: g('--line'), ink2: g('--ink-2'), ink3: g('--ink-3'),
        tagInk: root.getAttribute('data-theme') === 'light' ? '#ffffff' : g('--bg-0'), light: root.getAttribute('data-theme') === 'light' };
    }
    function layout() {
      var r = wrap.getBoundingClientRect();
      W = Math.round(r.width); H = Math.round(r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      phone = W < 700;
      ks = phone ? all.slice(-44) : all;
      var lo = Infinity, hi = -Infinity;
      ks.forEach(function (k) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); });
      [PW, ZG, CW].forEach(function (w) { if (w > lo - 40 && w < hi + 40) { lo = Math.min(lo, w); hi = Math.max(hi, w); } });
      var pad = (hi - lo) * 0.08; L.lo = lo - pad; L.hi = hi + pad * 1.6;
      touches = [];
      [[PW, 'pw'], [ZG, 'zg'], [CW, 'cw']].forEach(function (w) { // first reach of each level (12 pt proximity), then 20-bar cool-down
        var cool = -99;
        ks.forEach(function (k, i) {
          if (k.l <= w[0] + 12 && k.h >= w[0] - 12 && i - cool > 20) { touches.push({ w: w[1], i: i }); cool = i; }
        });
      });
      var ov = Math.min(96, Math.max(32, 0.06 * W)) + 12; // the screenshot fan overlaps the canvas bottom
      L.edge = phone ? 16 : 20;
      L.fs = phone ? 11 : 12;
      L.axisW = phone ? 62 : 74;
      L.axisX = W - L.edge - L.axisW;                // price scale + last-price tag column
      L.barMax = phone ? 26 : Math.min(96, W * 0.05);
      L.barR = L.axisX - 6;                          // GEX bars grow left from here
      L.labR = L.barR - L.barMax - 8;                // wall labels, right-aligned, above their lines
      L.cR = L.labR - (phone ? 8 : 16);              // last candle slot ends here (a few empty slots, like a real chart)
      L.step = L.cR / (ks.length + 2);
      L.timeY = H - ov - 4;
      L.volB = L.timeY - (phone ? 18 : 22);
      L.volH = (L.volB) * (phone ? 0.14 : 0.13);
      L.top = Math.round(H * (phone ? 0.12 : 0.15));
      L.bot = L.volB - L.volH - 10;
      if (ex) ex.style.right = L.edge + 'px';
    }
    var Y = function (p) { return L.top + (L.hi - p) / (L.hi - L.lo) * (L.bot - L.top); };
    var X = function (i) { return (i + 0.5) * L.step; };
    function head(t) { // index + fraction of the forming bar
      var n = ks.length, fastN = n - LIVE, u;
      if (t < T_C0) return { i: -1, f: 0 };
      if (t < T_C0 + T_FAST) u = (t - T_C0) / T_FAST * fastN;
      else u = fastN + (t - T_C0 - T_FAST) / T_BAR;
      if (u >= n) return { i: n - 1, f: 1 };
      return { i: Math.floor(u), f: u - Math.floor(u) };
    }
    function tAt(i) { var fastN = ks.length - LIVE; return i < fastN ? T_C0 + i / fastN * T_FAST : T_C0 + T_FAST + (i - fastN) * T_BAR; }

    function draw(t) {
      if (!ready) return;
      var lt = t % T_LOOP, D = dpr, R = function (v) { return Math.round(v * D); };
      var fade = lt > T_END + T_HOLD ? Math.max(1 - (lt - T_END - T_HOLD) / T_FADE, 0) : 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.globalAlpha = fade;
      var hd = head(lt), n = hd.i, font = function (w) { return w + ' ' + L.fs * D + 'px "Archivo Tnum","Archivo",sans-serif'; };
      var one = Math.max(1, Math.round(D));

      // grid + price scale (every 50 pts) + time labels (every 30 min, 15 on phones)
      var ga = ease(lt / 0.5);
      ctx.fillStyle = hexA(C.line, (C.light ? 0.7 : 0.5) * ga);
      ctx.font = font('500'); ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      var tagP = n >= 0 ? tickAt(ks[n], hd.f) : null;
      for (var s = Math.ceil(L.lo / 50) * 50; s <= L.hi; s += 50) {
        var gy = R(Y(s)); if (Y(s) < L.top - 8 || Y(s) > L.bot) continue;
        if (tagP !== null && Math.abs(Y(s) - Y(tagP)) < 18) { ctx.fillStyle = hexA(C.line, (C.light ? 0.7 : 0.5) * ga); ctx.fillRect(0, gy, R(L.axisX), one); continue; } // label sits under the tag
        ctx.fillStyle = hexA(C.line, (C.light ? 0.7 : 0.5) * ga); ctx.fillRect(0, gy, R(L.axisX), one);
        ctx.fillStyle = hexA(C.ink3, ga); ctx.fillText(fmt(s, 0), R(W - L.edge), gy);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      var every = phone ? 15 : 30;
      ks.forEach(function (k, i) {
        if (Math.floor(((k.t - 5 * 3600) % 3600) / 60) % every) return;
        var gx = R(X(i)); if (X(i) < 28) return;
        ctx.fillStyle = hexA(C.line, (C.light ? 0.6 : 0.4) * ga); ctx.fillRect(gx, R(L.top - 8), one, R(L.volB - L.top + 8));
        ctx.fillStyle = hexA(C.ink3, ga); ctx.fillText(hhmm(k.t), gx, R(L.timeY));
      });

      // GEX bars per strike, grow in from the right
      var bh = Math.max(3, Math.min(9, (Y(0) - Y(25)) * 0.5));
      Object.keys(GEX).forEach(function (k, j) {
        var p = +k; if (p < L.lo || p > L.hi) return;
        var g = GEX[k], e = ease((lt - 0.3 - j * 0.04) / 0.7), w = Math.abs(g) * L.barMax * e;
        ctx.fillStyle = hexA(g > 0 ? C.bull : C.bear, 0.7);
        ctx.fillRect(R(L.barR - w), R(Y(p) - bh / 2), R(w), R(bh));
      });

      // walls: draw in from the right, breathe, flash where price reaches them
      var walls = [[CW, 'cw', C.bull, 'Call wall'], [ZG, 'zg', C.amber, 'Zero gamma'], [PW, 'pw', C.bear, 'Put wall']];
      var drawWalls = function (labels) {
        walls.forEach(function (w, j) {
          if (w[0] < L.lo || w[0] > L.hi) return;
          var y = R(Y(w[0])), e = ease((lt - 0.1 - j * 0.15) / 0.8), xL = L.barR * (1 - e);
          var br = 0.5 + 0.5 * Math.sin((lt - j * 0.7) * 2.1);
          if (e <= 0) return;
          if (!labels) {
            ctx.fillStyle = hexA(w[2], (C.light ? 0.08 : 0.06) + 0.08 * br); ctx.fillRect(R(xL), y - R(3), R(L.barR - xL), R(6));
            ctx.fillStyle = hexA(w[2], 0.65 + 0.25 * br);
            for (var dx = xL; dx < L.barR; dx += 10) ctx.fillRect(R(dx), y, R(Math.min(6, L.barR - dx)), one);
            touches.forEach(function (tc) {
              if (tc.w !== w[1]) return;
              var a = lt - tAt(tc.i); if (a < 0 || a > 1) return;
              var x = X(tc.i), r = 24 + a * (phone ? 140 : 380), al = 1 - a;
              var gr = ctx.createLinearGradient(R(x - r), 0, R(x + r), 0);
              gr.addColorStop(0, hexA(w[2], 0)); gr.addColorStop(0.5, hexA(w[2], 0.85 * al)); gr.addColorStop(1, hexA(w[2], 0));
              ctx.fillStyle = gr; ctx.fillRect(R(x - r), y - R(1), R(2 * r), R(3));
            });
            return;
          }
          var la = ease((lt - 0.5 - j * 0.15) / 0.5); if (la <= 0) return;
          var txt = w[3] + '  ' + fmt(w[0], 0);
          ctx.font = font('600'); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.globalAlpha = fade * la; ctx.fillStyle = w[2]; ctx.fillText(txt, R(L.labR), y - R(5)); ctx.globalAlpha = fade;
        });
      };
      drawWalls(false);

      // volume + candles (body ~70% of the slot, odd device-px width so the 1-px wick sits dead centre)
      var bw = Math.max(1, Math.round(L.step * 0.7 * D)); if (bw % 2 === 0 && bw > 2) bw -= 1;
      var vmax = 1; ks.forEach(function (k) { vmax = Math.max(vmax, k.v); });
      for (var i = 0; i <= n; i++) {
        var k = ks[i], f = i < n ? 1 : hd.f, cur = tickAt(k, f), rg = rangeAt(k, f);
        var up = cur >= k.o, col = up ? C.bull : C.bear, cx = R(X(i)), bx = cx - (bw - 1) / 2;
        var vh = L.volH * k.v / vmax * Math.min(f * 1.2, 1);
        ctx.fillStyle = hexA(col, C.light ? 0.3 : 0.32); ctx.fillRect(bx, R(L.volB - vh), bw, R(L.volB) - R(L.volB - vh));
        ctx.fillStyle = col;
        var yh = R(Y(rg[0])), yl = R(Y(rg[1]));
        ctx.fillRect(cx, yh, one, Math.max(one, yl - yh));
        var y1 = R(Y(Math.max(k.o, cur))), y2 = R(Y(Math.min(k.o, cur)));
        ctx.fillRect(bx, y1, bw, Math.max(one, y2 - y1));
      }
      drawWalls(true);

      if (n >= 0) { // last-price line + tag in the price column, ticks with the forming bar
        var p = tickAt(ks[n], hd.f), tagCol = p >= ks[n].o ? C.bull : C.bear, ty = R(Y(p));
        ctx.fillStyle = hexA(tagCol, 0.7);
        for (var dx2 = X(n) + L.step; dx2 < L.axisX; dx2 += 5) ctx.fillRect(R(dx2), ty, R(2), one);
        var th = phone ? 20 : 22, tw = L.axisW, tX = L.axisX, tY = Y(p) - th / 2;
        ctx.fillStyle = tagCol; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(R(tX), R(tY), R(tw), R(th), R(4)); else ctx.rect(R(tX), R(tY), R(tw), R(th));
        ctx.fill();
        ctx.fillStyle = C.tagInk; ctx.font = font('700'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fmt(p, 2), R(tX + tw / 2), R(tY + th / 2 + 0.5));
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      raf = 0;
      if (seeking) return;
      T += last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
      draw(T); run();
    }
    function run() {
      if (!raf && ready && !rm && !seeking && onScreen && !doc.hidden) raf = requestAnimationFrame(frame);
      if (!raf) last = 0;
    }

    colours();
    window.__hvSeek = function (t) { seeking = true; if (raf) cancelAnimationFrame(raf); raf = 0; T = t; draw(t); return ready; };
    fetch(cv.getAttribute('data-src')).then(function (r) { return r.json(); }).then(function (d) {
      all = bars(d.bars, d.rebase || 0); ready = true; layout(); draw(T); run();
      window.__hvData = { n: all.length, loop: T_LOOP, end: T_END, date: d.date };
    }).catch(function () {});
    window.addEventListener('resize', function () { if (ready) { layout(); draw(T); } });
    new MutationObserver(function () { colours(); draw(T); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    doc.addEventListener('visibilitychange', run);
    if (hasIO) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; run(); }).observe(wrap);
    else { onScreen = true; run(); }
  }

  function init() {
    heroArt(doc.querySelector('[data-hv-canvas]'));
    once(doc.querySelector('[data-hv-fan]'), 'in', 0.35);
    $$('.hv-rv').forEach(function (el) { once(el, 'in', 0.12); });

    // sticky story: pick the step from how far the section has scrolled
    var story = doc.querySelector('[data-hv-story]');
    if (story) {
      var steps = $$('.hv-step', story), cur = 0, tick = false;
      var wide = window.matchMedia('(min-width:900px)');
      var pick = function () {
        tick = false;
        if (!wide.matches) return;
        var r = story.getBoundingClientRect(), run = r.height - window.innerHeight;
        var p = run > 0 ? Math.min(Math.max(-r.top / run, 0), 0.999) : 0;
        var i = Math.floor(p * steps.length);
        if (i === cur) return;
        steps[cur].classList.remove('on'); steps[i].classList.add('on'); cur = i;
      };
      var onScroll = function () { if (!tick) { tick = true; requestAnimationFrame(pick); } };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      pick();
    }

    // persona tabs
    var list = doc.querySelector('[data-hv-tabs]');
    if (list) {
      var tabs = $$('[role="tab"]', list);
      var show = function (t, focus) {
        tabs.forEach(function (x) {
          var on = x === t, p = doc.getElementById(x.getAttribute('aria-controls'));
          x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1;
          if (p) p.hidden = !on;
        });
        if (focus) t.focus();
      };
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { show(t); });
        t.addEventListener('keydown', function (e) {
          var n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
          if (n === undefined) return;
          e.preventDefault(); show(tabs[(n + tabs.length) % tabs.length], true);
        });
      });
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
