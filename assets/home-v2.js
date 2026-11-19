// TradeZoro homepage v2 PREVIEW (demo-home-v2.html, Owner 19 Nov): page-only motion, no libraries.
//   1. Hero motion graphic (canvas, one rAF clock): candles build in from a FIXED hand-written OHLC path (range, sweep
//      below the put wall, bounce, stall under the call wall), GEX walls draw in and breathe, GEX bars, volume, sparks,
//      last-price tag. ~11 s, 2 s hold, fade, replay. Paused off screen / hidden tab. Reduced motion = final frame.
//      Example session, not market data. window.__hvSeek(t) draws frame t and stops the clock (video capture).
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
  // [high, low, close]; open = previous close. Levels: put wall 21,200 / zero gamma 21,300 / call wall 21,400.
  var OPEN0 = 21296, PW = 21200, ZG = 21300, CW = 21400;
  var K = [[21308,21290,21304],[21312,21299,21301],[21306,21286,21290],[21300,21284,21297],[21318,21294,21312],
    [21316,21298,21300],[21304,21282,21286],[21294,21276,21291],[21302,21286,21289],[21292,21270,21274],
    [21280,21258,21262],[21270,21250,21266],[21268,21240,21244],[21252,21228,21235],[21246,21222,21240],
    [21242,21214,21218],[21226,21204,21210],[21214,21178,21206],[21236,21200,21232],[21248,21226,21244],
    [21250,21234,21238],[21262,21236,21258],[21274,21252,21270],[21272,21256,21262],[21288,21258,21284],
    [21304,21280,21298],[21306,21288,21292],[21300,21284,21296],[21318,21292,21314],[21326,21306,21310],
    [21322,21300,21318],[21338,21314,21334],[21346,21326,21330],[21344,21322,21340],[21358,21336,21354],
    [21362,21344,21348],[21366,21342,21362],[21378,21356,21372],[21382,21362,21366],[21384,21360,21380],
    [21394,21374,21388],[21402,21382,21390],[21398,21378,21384],[21404,21380,21392],[21396,21376,21381],
    [21392,21374,21386],[21401,21380,21388],[21396,21382,21390]];
  // GEX per strike (25-pt steps), illustrative: + above zero gamma, - below, biggest at the walls
  var GEX = { 21425: 0.35, 21400: 1, 21375: 0.55, 21350: 0.42, 21325: 0.25, 21300: 0.08, 21275: -0.2, 21250: -0.34,
    21225: -0.5, 21200: -0.92, 21175: -0.4 };
  var P_LO = 21165, P_HI = 21418;
  var T_C0 = 1.4, T_RUN = 9.6, T_END = T_C0 + T_RUN, T_HOLD = 2, T_FADE = 0.8, T_LOOP = T_END + T_HOLD + T_FADE;

  function candles(merge) { // phone: merge pairs, 48 -> 24 candles, same story
    var out = [], o = OPEN0, i, a, b;
    for (i = 0; i < K.length; i += merge) {
      a = K[i]; b = K[i + merge - 1];
      var h = a[0], l = a[1];
      if (merge > 1) { h = Math.max(h, b[0]); l = Math.min(l, b[1]); }
      out.push({ o: o, h: h, l: l, c: b[2] }); o = b[2];
    }
    out.forEach(function (k) { // intrabar path: bull o-l-h-c, bear o-h-l-c (constant speed)
      var pts = k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c], d = [0], j;
      for (j = 1; j < 4; j++) d.push(d[j - 1] + Math.abs(pts[j] - pts[j - 1]));
      k.pts = pts; k.d = d; k.len = d[3] || 1;
      k.vol = 0.25 + (k.h - k.l) / 50;
    });
    return out;
  }
  function priceIn(k, p) { // price at fraction p of the candle's build
    var at = p * k.len, j = 1;
    while (j < 3 && k.d[j] < at) j++;
    var s = k.d[j] - k.d[j - 1], f = s ? (at - k.d[j - 1]) / s : 1;
    return k.pts[j - 1] + (k.pts[j] - k.pts[j - 1]) * Math.min(Math.max(f, 0), 1);
  }
  function hexA(c, a) { // '#rrggbb' or '#rgb' -> rgba()
    c = (c || '').trim();
    if (c[0] !== '#') return c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    var n = parseInt(c.slice(1, 7), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function hash(i) { var x = Math.sin(i * 127.1 + 11.7) * 43758.5453; return x - Math.floor(x); }
  var ease = function (x) { x = Math.min(Math.max(x, 0), 1); return 1 - Math.pow(1 - x, 3); };
  var fmt = function (v) { return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  function heroArt(cv) {
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d'), wrap = cv.parentNode, ex = wrap.querySelector('.hv-ex'), hero = doc.querySelector('.hv-hero') || wrap;
    var rm = root.classList.contains('hv-rm');
    var W = 0, H = 0, dpr = 1, phone = false, C = {}, ks = [], touches = [], L = {};
    var T = 0, last = 0, raf = 0, onScreen = false, seeking = false;
    var px = 0, py = 0, tx = 0, ty = 0;
    var fine = window.matchMedia('(pointer:fine) and (min-width:900px)');

    function colours() {
      var cs = getComputedStyle(root), g = function (n) { return cs.getPropertyValue(n).trim(); };
      C = { bull: g('--bull'), bear: g('--bear'), gold: g('--gold'), hi: g('--gold-bright'), amber: g('--amber'),
        line: g('--line'), ink2: g('--ink-2'), ink3: g('--ink-3'),
        tagInk: root.getAttribute('data-theme') === 'light' ? '#ffffff' : g('--bg-1'),
        light: root.getAttribute('data-theme') === 'light' };
    }
    function layout() {
      var r = wrap.getBoundingClientRect();
      W = Math.round(r.width); H = Math.round(r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var was = phone; phone = W < 700;
      if (!ks.length || was !== phone) {
        ks = candles(phone ? 2 : 1);
        touches = [];
        [[PW, 'pw'], [ZG, 'zg'], [CW, 'cw']].forEach(function (w) { // first touch of each visit -> ripple
          var prev = false;
          ks.forEach(function (k, i) {
            var hit = k.l <= w[0] && k.h >= w[0];
            if (hit && !prev) {
              var f = 0; while (f < 1 && (priceIn(k, f) - w[0]) * (k.o - w[0]) > 0) f += 0.02;
              touches.push({ w: w[1], i: i, f: Math.min(f, 1) });
            }
            prev = hit;
          });
        });
      }
      var inner = Math.min(W - 32, 1320), x0 = (W - inner) / 2;
      var ov = Math.min(96, Math.max(32, 0.06 * W)) + 12; // the screenshot fan overlaps the canvas bottom
      L.axisW = phone ? 60 : 76;
      L.axisX = x0 + inner - L.axisW;            // last-price tag column
      L.barMax = phone ? 30 : 84;
      L.barR = L.axisX - 6;                      // GEX bars grow left from here
      L.labR = L.barR - L.barMax - 8;            // wall labels right-aligned here
      L.cR = L.labR - (phone ? 64 : 120);        // candles end here (only the call-wall label sits above them, and above its line)
      L.cL = x0 + (phone ? 8 : 24);
      L.step = (L.cR - L.cL) / ks.length;
      L.bw = Math.max(3, Math.min(10, L.step * 0.56));
      L.volH = phone ? 22 : 40;
      L.volB = H - ov;
      L.top = phone ? 30 : 36;
      L.bot = L.volB - L.volH - 6;
      L.fs = phone ? 11 : 12;
      if (ex) ex.style.right = Math.round(W - L.axisX - L.axisW + 2) + 'px';
    }
    var Y = function (p) { return L.top + (P_HI - p) / (P_HI - P_LO) * (L.bot - L.top); };
    var X = function (i) { return L.cL + (i + 0.5) * L.step; };
    function head(t) { // index + fraction of the building candle, current price
      var cd = T_RUN / ks.length, u = (t - T_C0) / cd;
      if (u < 0) return { i: -1, f: 0, p: OPEN0 };
      var i = Math.min(Math.floor(u), ks.length - 1), f = Math.min(u - i, 1);
      if (u >= ks.length) f = 1;
      return { i: i, f: f, p: priceIn(ks[i], f) };
    }

    function draw(t) {
      var lt = t % T_LOOP, cd = T_RUN / ks.length;
      var fade = lt > T_END + T_HOLD ? 1 - (lt - T_END - T_HOLD) / T_FADE : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(fade, 0);
      var hd = head(lt), gx = px * 8, gy = py * 5, cx = -px * 3, cy = -py * 2;

      // grid (parallax layer: moves more than the candles)
      ctx.lineWidth = 1; ctx.strokeStyle = hexA(C.line, 0.55 * ease(lt / 0.6)); ctx.beginPath();
      for (var s = 21175; s <= 21425; s += 25) { var yy = Math.round(Y(s) + gy) + 0.5; ctx.moveTo(0, yy); ctx.lineTo(L.axisX, yy); }
      for (var v = 0; v <= ks.length; v += phone ? 3 : 6) { var xx = Math.round(L.cL + v * L.step + gx) + 0.5; ctx.moveTo(xx, L.top - 12); ctx.lineTo(xx, L.volB); }
      ctx.stroke();

      ctx.save(); ctx.translate(cx, cy);
      // GEX bars per strike, grow in from the right
      var bh = Math.max(4, Math.min(10, (Y(21175) - Y(21200)) * 0.42));
      Object.keys(GEX).forEach(function (k, j) {
        var g = GEX[k], e = ease((lt - 0.6 - j * 0.06) / 0.7), w = Math.abs(g) * L.barMax * e;
        ctx.fillStyle = hexA(g > 0 ? C.bull : C.bear, 0.75);
        ctx.fillRect(L.barR - w, Y(+k) - bh / 2, w, bh);
      });

      // GEX walls: draw in from the right, label + strike, breathe, ripple on touch
      var walls = [[CW, 'cw', C.bull, 'Call wall'], [ZG, 'zg', C.amber, 'Zero gamma'], [PW, 'pw', C.bear, 'Put wall']];
      walls.forEach(function (w, j) {
        var y = Math.round(Y(w[0])) + 0.5, e = ease((lt - 0.15 - j * 0.2) / 0.9), xL = L.barR - (L.barR) * e;
        var br = 0.5 + 0.5 * Math.sin((lt - j * 0.7) * 2.1); // slow breathing
        if (e <= 0) return;
        ctx.strokeStyle = hexA(w[2], (C.light ? 0.10 : 0.08) + 0.10 * br); ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(L.barR, y); ctx.stroke();
        ctx.strokeStyle = hexA(w[2], 0.7 + 0.25 * br); ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(L.barR, y); ctx.stroke(); ctx.setLineDash([]);
        touches.forEach(function (tc) { // ripple: a bright band that spreads both ways from the touch point and fades
          if (tc.w !== w[1]) return;
          var a = lt - (T_C0 + (tc.i + tc.f) * cd);
          if (a < 0 || a > 1.1) return;
          var x = X(tc.i), r = 30 + a * (phone ? 160 : 420), al = 1 - a / 1.1;
          var gr = ctx.createLinearGradient(x - r, 0, x + r, 0);
          gr.addColorStop(0, hexA(w[2], 0)); gr.addColorStop(0.5, hexA(w[2], 0.9 * al)); gr.addColorStop(1, hexA(w[2], 0));
          ctx.strokeStyle = gr; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.stroke();
          ctx.fillStyle = hexA(w[2], 0.35 * al); ctx.beginPath(); ctx.arc(x, y, 4 + a * 22, 0, 6.283); ctx.fill();
        });
        var la = ease((lt - 0.7 - j * 0.2) / 0.5);
        if (la > 0) {
          ctx.globalAlpha = Math.max(fade, 0) * la;
          ctx.font = '600 ' + L.fs + 'px "Archivo Tnum","Archivo",sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = w[2]; ctx.fillText(w[3] + '  ' + fmt(w[0]).replace('.00', ''), L.labR, y - 5);
          ctx.globalAlpha = Math.max(fade, 0);
        }
      });

      // volume + candles
      var n = hd.i, wk = phone ? 1 : 1.5;
      for (var i = 0; i <= n; i++) {
        var k = ks[i], f = i < n ? 1 : hd.f, cur = i < n ? k.c : hd.p;
        var hi = k.o, lo = k.o;
        if (i < n) { hi = k.h; lo = k.l; } else { for (var q = 0; q <= f + 1e-6; q += 0.05) { var pp = priceIn(k, Math.min(q, f)); if (pp > hi) hi = pp; if (pp < lo) lo = pp; } }
        var up = cur >= k.o, col = up ? C.bull : C.bear, x = X(i);
        var vh = L.volH * Math.min(k.vol, 1) * ease(f * 1.4);
        ctx.fillStyle = hexA(col, C.light ? 0.2 : 0.15); ctx.fillRect(x - L.bw / 2, L.volB - vh, L.bw, vh);
        ctx.strokeStyle = col; ctx.lineWidth = wk; ctx.beginPath(); ctx.moveTo(x, Y(hi)); ctx.lineTo(x, Y(lo)); ctx.stroke();
        var y1 = Y(Math.max(k.o, cur)), y2 = Y(Math.min(k.o, cur));
        ctx.fillStyle = col; ctx.fillRect(x - L.bw / 2, y1, L.bw, Math.max(1.5, y2 - y1));
      }

      if (n >= 0) {
        var hx = X(n), hy = Y(hd.p);
        // glow trail through the last closes + soft halo on the latest candle (gradients only, no blur filter)
        ctx.lineWidth = phone ? 2 : 2.5; ctx.lineJoin = 'round';
        var m0 = Math.max(0, n - 8);
        for (var m = m0; m < n; m++) {
          var a0 = (m - m0 + 1) / (n - m0 + 1);
          ctx.strokeStyle = hexA(C.hi, 0.55 * a0); ctx.beginPath();
          ctx.moveTo(X(m), Y(ks[m].c)); ctx.lineTo(m + 1 === n ? hx : X(m + 1), m + 1 === n ? hy : Y(ks[m + 1].c)); ctx.stroke();
        }
        var R = phone ? 34 : 64, halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, R);
        halo.addColorStop(0, hexA(C.gold, C.light ? 0.22 : 0.32)); halo.addColorStop(1, hexA(C.gold, 0));
        ctx.fillStyle = halo; ctx.fillRect(hx - R, hy - R, R * 2, R * 2);
        // sparks drifting up from the head (deterministic: spawn every 0.12 s, live 1.4 s)
        if (!rm) for (var sp = Math.floor((lt - 1.4) / 0.12); sp >= 0; sp--) {
          var ts = sp * 0.12, age = lt - ts; if (age > 1.4) break;
          if (ts < T_C0 || ts > T_END + T_HOLD) continue;
          var h0 = head(ts), sx = X(Math.max(h0.i, 0)) + (hash(sp) - 0.5) * 10 + (hash(sp + 9) - 0.5) * 26 * age;
          var sy = Y(h0.p) - (18 + hash(sp + 3) * 26) * age - 8 * age * age;
          ctx.fillStyle = hexA(C.hi, 0.75 * (1 - age / 1.4)); ctx.beginPath(); ctx.arc(sx, sy, 1 + hash(sp + 5) * 1.2, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = C.hi; ctx.beginPath(); ctx.arc(hx, hy, phone ? 2.5 : 3, 0, 6.283); ctx.fill();
        ctx.restore();
        // last-price line + tag on the right edge, slides with the price, number ticks
        var tagCol = hd.p >= ks[n].o ? C.bull : C.bear, ty2 = hy + cy;
        ctx.strokeStyle = hexA(tagCol, 0.6); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(hx + cx + 6, Math.round(ty2) + 0.5); ctx.lineTo(L.axisX, Math.round(ty2) + 0.5); ctx.stroke(); ctx.setLineDash([]);
        var th = phone ? 20 : 22, tw = L.axisW - 4, tX = L.axisX + 2, tY = ty2 - th / 2;
        ctx.fillStyle = tagCol; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tX, tY, tw, th, 4); else ctx.rect(tX, tY, tw, th);
        ctx.fill();
        ctx.fillStyle = C.tagInk; ctx.font = '700 ' + L.fs + 'px "Archivo Tnum","Archivo",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fmt(Math.round(hd.p * 4) / 4), tX + tw / 2, tY + th / 2 + 0.5);
      } else ctx.restore();
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      raf = 0;
      if (seeking) return;
      var dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
      T += dt;
      if (fine.matches) { px += (tx - px) * 0.08; py += (ty - py) * 0.08; } else { px = py = 0; }
      draw(T);
      run();
    }
    function run() {
      if (!raf && !rm && !seeking && onScreen && !doc.hidden) raf = requestAnimationFrame(frame);
      if (!raf) last = 0;
    }
    function still() { draw(rm ? T_END + 1.2 : T); }

    colours(); layout();
    if (rm) T = T_END + 1.2;
    still();
    window.addEventListener('resize', function () { layout(); still(); });
    new MutationObserver(function () { colours(); still(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    doc.addEventListener('visibilitychange', run);
    if (hasIO) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; run(); }).observe(wrap);
    else { onScreen = true; run(); }
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
    });
    hero.addEventListener('mouseleave', function () { tx = ty = 0; });
    window.__hvSeek = function (t) { seeking = true; if (raf) cancelAnimationFrame(raf); raf = 0; px = py = 0; T = t; draw(t); };
    window.__hvData = { K: K, OPEN0: OPEN0, loop: T_LOOP, end: T_END };
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
