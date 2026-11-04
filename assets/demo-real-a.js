// Demo homepage A v2. Canvas footprint replaying a recorded NQ1! session (assets/data/demo-nq.json),
// recorded BTCUSDT order book heatmap with a size filter (assets/data/demo-heatmap.json), tabs, layout grid,
// count-up numbers, scroll reveal. No libraries. Respects prefers-reduced-motion.
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif';
  var GREEN = '#03c988', RED = '#f0616d';

  var tb = $('#ra-theme');
  if (tb) tb.addEventListener('click', function () {
    var light = root.getAttribute('data-theme') === 'light';
    if (light) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', 'light');
    try { localStorage.setItem('stryker_theme', light ? 'night' : 'day'); } catch (e) {}
  });

  function fit(cv, h) {
    var w = cv.parentNode.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, w: w, h: h };
  }
  function onVisible(el, fn, margin) {
    if (!('IntersectionObserver' in window)) { fn(true); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { fn(e.isIntersecting); }); }, { rootMargin: margin || '0px' }).observe(el);
  }
  function getJSON(u) { return fetch(u).then(function (r) { return r.json(); }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function etTime(ms) { var d = new Date(ms - 4 * 3600e3); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); } // 21 Oct 2026 is EDT

  // ---------- reveal + count up ----------
  root.classList.add('ra-js');
  var rv = $$('.ra-sec-h,.ra-why-l,.ra-why-r,.ra-card,.ra-plan,.ra-faq-l,.ra-faq-r,.ra-data-t,.ra-data-vis,.ra-nums dl>div');
  if (reduce || !('IntersectionObserver' in window)) rv.forEach(function (e) { e.classList.add('ra-in'); });
  else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('ra-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px' });
    rv.forEach(function (e) { e.classList.add('ra-rv'); io.observe(e); });
  }
  $$('.ra-nums dd').forEach(function (dd) {
    var n = +dd.getAttribute('data-n'); if (reduce || !n) return;
    dd.textContent = '0';
    onVisible(dd, function (vis) {
      if (!vis || dd._done) return; dd._done = 1;
      var t0 = performance.now(), D = 900;
      (function step(t) { var k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); dd.textContent = Math.round(n * e); if (k < 1) requestAnimationFrame(step); })(t0);
    });
  });

  // ---------- footprint ----------
  var NQ = null, FP = null;
  function prepNQ(d) {
    var G = 12; // 12 ticks of 0.25 = 3 points per row
    d.bars.forEach(function (b) {
      var rows = {}, poc = -1, pv = 0, dl = 0, vol = 0;
      for (var k = 0; k < b.b.length; k++) {
        var r = Math.floor((b.l + k) / G), c = rows[r] || (rows[r] = { s: 0, b: 0 });
        c.s += b.s[k]; c.b += b.b[k]; dl += b.b[k] - b.s[k]; vol += b.b[k] + b.s[k];
      }
      for (var r2 in rows) { var t = rows[r2].s + rows[r2].b; if (t > pv) { pv = t; poc = +r2; } }
      b.rows = rows; b.poc = poc; b.delta = dl; b.vol = vol; b.rl = Math.floor(b.l / G); b.rh = Math.floor(b.h / G);
      b.ro = Math.floor(b.o / G); b.rc = Math.floor(b.c / G);
    });
    d.G = G; return d;
  }
  function Footprint(cv, d) {
    var self = this, wrap = cv.parentNode, tip = $('#fp-tip'), clock = $('#fp-clock');
    var S = null, N = 8, f = 6, speed = 1 / 1.5, last = 0, run = false, lo0 = 0, hi0 = 0, ready = false, fade = 1;
    function size() {
      var w = wrap.clientWidth; N = w < 560 ? 5 : w < 900 ? 8 : 12;
      S = fit(cv, w < 560 ? 380 : w < 900 ? 440 : 520);
    }
    size();
    new ResizeObserver(function () { if (wrap.clientWidth !== S.w) { size(); draw(); } }).observe(wrap);
    function ease(k) { return k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
    function draw() {
      var g = S.g, W = S.w, H = S.h, AX = W < 560 ? 48 : 56, TH = 18, DH = Math.round(H * .17);
      var pl = W - AX, ph = H - TH - DH - 8, colW = pl / N, B = d.bars;
      var cur = Math.floor(f), p = Math.min(1, ease(f - cur) * 1.15), first = cur - N + 1;
      g.clearRect(0, 0, W, H); g.globalAlpha = fade;
      var mn = 1e9, mx = -1e9;
      for (var i = Math.max(0, first); i <= cur; i++) {
        var b = B[i], k = i === cur ? p : 1;
        var rl = i === cur ? Math.round(b.ro + (b.rl - b.ro) * k) : b.rl, rh = i === cur ? Math.round(b.ro + (b.rh - b.ro) * k) : b.rh;
        mn = Math.min(mn, rl); mx = Math.max(mx, rh);
      }
      mn -= 1; mx += 1;
      if (!ready) { lo0 = mn; hi0 = mx; ready = true; } else { lo0 += (mn - lo0) * .12; hi0 += (mx - hi0) * .12; }
      var rows = hi0 - lo0 + 1, rh2 = ph / rows;
      function Y(r) { return 8 + ph - (r - lo0 + 1) * rh2; }
      g.font = '500 10px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'left';
      var stepR = Math.max(1, Math.ceil(26 / rh2));
      for (var r = Math.ceil(lo0); r <= hi0; r++) {
        if (r % stepR) continue;
        var y = Y(r) + rh2 / 2;
        g.strokeStyle = 'rgba(255,255,255,.055)'; g.beginPath(); g.moveTo(0, Math.round(y) + .5); g.lineTo(pl, Math.round(y) + .5); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(((d.lo + r * d.G) * d.tick).toFixed(2), pl + 6, y);
      }
      var maxCell = 1, maxD = 1;
      for (var i2 = Math.max(0, first); i2 <= cur; i2++) {
        for (var rr in B[i2].rows) { var c0 = B[i2].rows[rr]; maxCell = Math.max(maxCell, c0.s, c0.b); }
        maxD = Math.max(maxD, Math.abs(B[i2].delta));
      }
      var fs = Math.max(8, Math.min(11, rh2 * .62)), txt = rh2 >= 9, hit = [];
      for (var i3 = Math.max(0, first); i3 <= cur; i3++) {
        var bb = B[i3], x0 = (i3 - first) * colW, k3 = i3 === cur ? p : 1, cw = colW - 6, wx = x0 + 3;
        var up = bb.c >= bb.o, col = up ? GREEN : RED;
        var rl3 = i3 === cur ? Math.round(bb.ro + (bb.rl - bb.ro) * k3) : bb.rl, rh3 = i3 === cur ? Math.round(bb.ro + (bb.rh - bb.ro) * k3) : bb.rh;
        for (var r3 = rl3; r3 <= rh3; r3++) {
          var c = bb.rows[r3]; if (!c) continue;
          var s = Math.floor(c.s * k3), a = Math.floor(c.b * k3); if (!s && !a) continue;
          var y3 = Y(r3), hh = Math.max(1, rh2 - 1), inten = Math.min(1, (s + a) / (maxCell * 1.6));
          g.fillStyle = a - s >= 0 ? 'rgba(3,201,136,' + (0.08 + inten * .42) + ')' : 'rgba(240,97,109,' + (0.08 + inten * .42) + ')';
          g.fillRect(wx + 4, y3, cw - 4, hh);
          if (txt) {
            var imbA = a >= 3 * Math.max(s, 1) && a > 40, imbS = s >= 3 * Math.max(a, 1) && s > 40, mid = wx + 4 + (cw - 4) / 2;
            g.textAlign = 'right'; g.fillStyle = imbS ? '#ff8d98' : 'rgba(255,255,255,.74)'; g.font = (imbS ? '700 ' : '500 ') + fs + 'px ' + FONT;
            g.fillText(s, mid - 3, y3 + hh / 2 + .5);
            g.textAlign = 'left'; g.fillStyle = imbA ? '#52e6b0' : 'rgba(255,255,255,.74)'; g.font = (imbA ? '700 ' : '500 ') + fs + 'px ' + FONT;
            g.fillText(a, mid + 3, y3 + hh / 2 + .5);
          }
          if (r3 === bb.poc && k3 > .6) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.strokeRect(wx + 4.5, y3 + .5, cw - 5, hh - 1); }
          hit.push([wx + 4, y3, cw - 4, hh, i3, r3, s, a]);
        }
        var yo = Y(Math.round(bb.ro + (bb.rc - bb.ro) * k3)) + rh2 / 2, yh = Y(rh3), yl = Y(rl3) + rh2;
        g.fillStyle = col; g.fillRect(wx, yh, 1.5, yl - yh); g.fillRect(wx - 1, Math.min(yo, yl - 1), 3.5, 2);
        g.strokeStyle = 'rgba(255,255,255,.04)'; g.beginPath(); g.moveTo(Math.round(x0 + colW) + .5, 0); g.lineTo(Math.round(x0 + colW) + .5, H - TH); g.stroke();
        var dl = bb.delta * k3, dh = (DH - 18) * Math.abs(dl) / maxD, dy = 8 + ph + 16 + (DH - 18) / 2;
        g.fillStyle = dl >= 0 ? GREEN : RED; g.globalAlpha = fade * .9;
        g.fillRect(wx + 4, dl >= 0 ? dy - dh : dy, cw - 4, Math.max(1, dh)); g.globalAlpha = fade;
        if (i3 % 2 === 0) { g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.45)'; g.font = '500 10px ' + FONT; g.fillText(etTime(bb.t), wx + 4, H - TH / 2); }
      }
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(0, 8 + ph + 8.5); g.lineTo(W, 8 + ph + 8.5); g.stroke();
      g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '500 10px ' + FONT;
      g.fillText('Delta', pl + 6, 8 + ph + 22); g.fillText('ET', pl + 6, H - TH / 2);
      g.globalAlpha = 1; self.hit = hit;
      if (clock) clock.textContent = etTime(B[cur].t) + ' ET';
    }
    this.draw = draw;
    this.step = function (t) {
      if (!run) return;
      requestAnimationFrame(self.step);
      if (t - last < 33) return;
      var dt = Math.min(.1, (t - last) / 1000); last = t;
      if (fade < 1) fade = Math.min(1, fade + dt * 3);
      f += dt * speed;
      if (f >= d.bars.length - 1) { f = 6; fade = 0; ready = false; }
      draw();
    };
    this.play = function (on) { if (reduce) return; if (on && !run) { run = true; last = performance.now(); requestAnimationFrame(self.step); } else if (!on) run = false; };
    this.setAt = function (v) { f = v; ready = false; draw(); };
    function show(ev) {
      var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, h = self.hit || [], hc = null;
      for (var i = h.length - 1; i >= 0; i--) { var c = h[i]; if (x >= c[0] && x <= c[0] + c[2] && y >= c[1] && y <= c[1] + c[3]) { hc = c; break; } }
      if (!hc) { tip.hidden = true; return; }
      var b = d.bars[hc[4]];
      tip.innerHTML = '<b>' + ((d.lo + hc[5] * d.G) * d.tick).toFixed(2) + '</b><span>' + etTime(b.t) + ' ET</span><div><i>Bid</i>' + hc[6] + '</div><div><i>Ask</i>' + hc[7] + '</div><div><i>Delta</i>' + (hc[7] - hc[6]) + '</div>';
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.max(4, Math.min(S.w - tw - 4, x + 14)) + 'px'; tip.style.top = Math.max(4, Math.min(S.h - th - 4, y - th - 10)) + 'px';
    }
    cv.addEventListener('pointermove', show); cv.addEventListener('pointerdown', show);
    cv.addEventListener('pointerleave', function () { tip.hidden = true; });
    draw();
  }

  var fpCv = $('#fp');
  if (fpCv) getJSON('assets/data/demo-nq.json').then(function (d) {
    NQ = prepNQ(d); FP = new Footprint(fpCv, NQ);
    FP.setAt(reduce ? 24.99 : 6);
    onVisible(fpCv, function (v) { FP.play(v); });
    buildLayout();
  });

  // ---------- heatmap ----------
  var HM = null;
  var LOOKS = {
    zoro: function (t, side) { return side > 0 ? [3, 201, 136, Math.pow(t, .6)] : [240, 97, 109, Math.pow(t, .6)]; },
    midnight: function (t) { return [90 + 120 * t, 130 + 90 * t, 255, Math.pow(t, .55)]; },
    classic: function (t) { return [t < .5 ? 40 + t * 430 : 255, t < .5 ? 60 + t * 360 : 240 - (t - .5) * 280, t < .5 ? 160 - t * 240 : 40, Math.pow(t, .5)]; },
    split: function (t, side) { return side > 0 ? [80, 170, 255, Math.pow(t, .6)] : [255, 170, 60, Math.pow(t, .6)]; }
  };
  function Heat(cv, d) {
    var wrap = cv.parentNode, S, min = .5, look = 'zoro', reveal = reduce ? 1 : 0, off = doc.createElement('canvas'), total = 0, max = 0;
    var COLS = d.cols.length, ROWS = d.rows;
    d.cols.forEach(function (c) { c.forEach(function (e) { var a = Math.abs(e[1]) / 10; max = Math.max(max, a); total++; }); });
    var top = Math.ceil(max), slider = $('#hm-min'), out = $('#hm-min-o'), note = $('#hm-n');
    function mapV(v) { return +(.25 * Math.pow(top / .25, v / 100)).toFixed(2); }
    slider.min = 0; slider.max = 100; slider.step = 1; slider.value = Math.round(100 * Math.log(.5 / .25) / Math.log(top / .25)); min = mapV(+slider.value);
    function size() { S = fit(cv, wrap.clientWidth < 560 ? 320 : 420); }
    function render() {
      var W = S.w, H = S.h, g = S.g, AX = W < 560 ? 44 : 52, pw = W - AX;
      g.fillStyle = '#07080a'; g.fillRect(0, 0, W, H);
      off.width = COLS; off.height = ROWS;
      var og = off.getContext('2d'), im = og.createImageData(COLS, ROWS), shown = 0, f = LOOKS[look], big = [], cutoff = Math.floor(COLS * reveal);
      for (var x = 0; x < cutoff; x++) d.cols[x].forEach(function (e) {
        var a = Math.abs(e[1]) / 10; if (a < min) return; shown++;
        var t = Math.min(1, Math.log(1 + a) / Math.log(31)), c = f(t, e[1]), y = ROWS - 1 - e[0], i = (y * COLS + x) * 4;
        im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = Math.round(255 * Math.min(1, c[3] * 1.05));
        if (a >= 8) big.push([x, y, a]);
      });
      og.putImageData(im, 0, 0);
      g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, pw, H);
      g.font = '500 10px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'left';
      var rowH = H / ROWS;
      for (var k = 0; k < 6; k++) {
        var yy = H * (k + .5) / 6; g.strokeStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(0, Math.round(yy) + .5); g.lineTo(pw, Math.round(yy) + .5); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(Math.round(d.base + (1 - (k + .5) / 6) * ROWS * d.rowUsd).toLocaleString('en-US'), pw + 6, yy);
      }
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.25; g.beginPath();
      for (var m = 0; m < cutoff; m++) { var X = (m + .5) * pw / COLS, Yv = H - (d.mid[m] + .5) * rowH; if (m) g.lineTo(X, Yv); else g.moveTo(X, Yv); }
      g.stroke();
      g.font = '600 10px ' + FONT; g.textAlign = 'left';
      big.sort(function (a, b) { return b[2] - a[2]; });
      var taken = [];
      big.forEach(function (b) {
        if (taken.length >= (W < 560 ? 4 : 7)) return;
        var X = b[0] * pw / COLS, Yb = b[1] * rowH;
        for (var q = 0; q < taken.length; q++) if (Math.abs(taken[q][0] - X) < 80 && Math.abs(taken[q][1] - Yb) < 16) return;
        taken.push([X, Yb]);
        var tx = Math.min(X + 4, pw - 56); g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(tx - 3, Yb - 7, 54, 14);
        g.fillStyle = '#fff'; g.fillText(b[2].toFixed(1) + ' BTC', tx, Yb + .5);
      });
      note.textContent = shown + ' of ' + total + ' levels at ' + min + ' BTC or more';
    }
    function sync() { min = mapV(+slider.value); out.textContent = min + ' BTC'; render(); }
    slider.addEventListener('input', sync);
    $$('#hm-look button').forEach(function (b) {
      b.addEventListener('click', function () { look = b.getAttribute('data-look'); $$('#hm-look button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); render(); });
    });
    size(); out.textContent = min + ' BTC'; render();
    new ResizeObserver(function () { if (wrap.clientWidth !== S.w) { size(); render(); } }).observe(wrap);
    this.draw = function () { size(); render(); };
    this.setMin = function (v) { slider.value = v; sync(); };
    if (!reduce) {
      var t0 = performance.now(), D = 1800;
      (function st(t) { var k = Math.min(1, (t - t0) / D); reveal = 1 - Math.pow(1 - k, 3); render(); if (k < 1) requestAnimationFrame(st); })(t0);
    }
  }
  var hmCv = $('#hm'), hmStarted = false;
  function initHeat() {
    if (hmStarted || !hmCv) return; hmStarted = true;
    getJSON('assets/data/demo-heatmap.json').then(function (d) { HM = new Heat(hmCv, d); window.__raHM = HM; });
  }
  if (hmCv) onVisible(hmCv, function (v) { if (v) initHeat(); }, '300px');

  // ---------- tabs ----------
  var tabs = $$('.ra-tabs [role=tab]');
  function pick(t, focus) {
    tabs.forEach(function (x) {
      var on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1;
      var p = doc.getElementById(x.getAttribute('aria-controls')); p.hidden = !on;
    });
    if (focus) t.focus();
    if (t.id === 'tb-heat' && HM && HM.draw) HM.draw();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { pick(t); });
    t.addEventListener('keydown', function (e) {
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
      if (j < 0) return; e.preventDefault(); pick(tabs[(j + tabs.length) % tabs.length], true);
    });
  });

  // ---------- layout grid ----------
  function buildLayout() {
    var box = $('#lay'); if (!box || !NQ) return;
    var tfs = [1, 3, 5, 1, 3, 5, 1, 3, 5, 1, 3, 5, 1, 3, 5, 1], offs = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
    function agg(tf, off) {
      var out = [], B = NQ.bars;
      for (var i = off; i + tf <= B.length; i += tf) {
        var h = -1e9, l = 1e9;
        for (var j = i; j < i + tf; j++) { h = Math.max(h, B[j].h); l = Math.min(l, B[j].l); }
        out.push([B[i].o, h, l, B[i + tf - 1].c]);
      }
      return out;
    }
    for (var n = 0; n < 16; n++) box.appendChild(Object.assign(doc.createElement('canvas'), { className: 'ra-lay-c' }));
    function paint() {
      $$('.ra-lay-c', box).forEach(function (cv, n) {
        var w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (!w || !h) return; cv.width = w * dpr; cv.height = h * dpr;
        var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        var bars = agg(tfs[n], offs[n]).slice(offs[n] % 3 ? -Math.max(8, Math.floor(w / 6)) : -Math.max(8, Math.floor(w / 5))), mn = 1e9, mx = -1e9;
        bars.forEach(function (b) { mn = Math.min(mn, b[2]); mx = Math.max(mx, b[1]); });
        var cw = w / bars.length, Y = function (v) { return 18 + (h - 24) * (1 - (v - mn) / (mx - mn || 1)); };
        g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, w, h);
        bars.forEach(function (b, i) {
          g.fillStyle = g.strokeStyle = b[3] >= b[0] ? GREEN : RED;
          var x = i * cw + cw / 2; g.beginPath(); g.moveTo(x, Y(b[1])); g.lineTo(x, Y(b[2])); g.stroke();
          g.fillRect(x - Math.max(1, cw * .32), Math.min(Y(b[0]), Y(b[3])), Math.max(2, cw * .64), Math.max(1, Math.abs(Y(b[0]) - Y(b[3]))));
        });
        g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '600 10px ' + FONT; g.textBaseline = 'top'; g.fillText('NQ1! ' + tfs[n] + 'm', 6, 5);
      });
    }
    $$('#lay-seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#lay-seg button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        box.setAttribute('data-n', b.getAttribute('data-n')); requestAnimationFrame(paint);
      });
    });
    new ResizeObserver(function () { paint(); }).observe(box);
    onVisible(box, function (v) { if (v) paint(); }, '200px');
  }
})();
