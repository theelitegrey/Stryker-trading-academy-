/* dragon-bg.js: a glowing Eastern-style dragon that swims through the page
   background, with scroll parallax. Decorative only.
   Used by: every /features/<name> page (loaded after window load by
   assets/features-page.js, the shared feature-page script) and the /features hub
   (features.html, one deferred tag). Opt a page out with <body data-no-dragon>.
   NOT for the member app, tool pages, auth/checkout, admin, legal or chart pages.
   Depends on: assets/dragon-bg.css (layer styles), which this file injects itself
   with the same ?v= build and waits for before drawing, so there is no unstyled flash.
   No libraries, no external assets, no globals besides one guard flag.

   How it works
   - Two fixed full-viewport canvases behind all content (z-index:-1, pointer-events:none):
       far  = low-resolution layer: a smaller, dimmer dragon, mist and far motes
       near = the main dragon, its pearl and near motes
   - The dragon's spine follows a looping Lissajous path (it leaves and re-enters the
     viewport), resampled to equal arc length so the body never stretches, plus a
     travelling sine wave so it swims. Drawn in opaque colours; the canvas element's
     CSS opacity sets how faint it is, so overlapping strokes never stack up.
   - Parallax: on scroll each layer is pushed up by (scroll delta x its depth factor),
     then drifts back to its home position over a couple of seconds. Far layer moves
     least, near layer more, near motes most, so the depth reads clearly.
   - Starts after window load (idle callback), pauses while the tab is hidden, caps the
     device pixel ratio, lighter on phones (1x pixels, fewer segments and motes, 30 fps
     main layer, quarter-rate far layer, no blur). If frames run slow for 4 s it freezes
     to a static frame.
   - prefers-reduced-motion: one static frame, no parallax, no pulse, no listeners.
   - Low-end devices (deviceMemory <= 2 GB, <= 2 CPU cores, or Save-Data on): skipped. */
(function(){
  'use strict';
  if (window.__strykerDragonBg) return;
  window.__strykerDragonBg = true;

  var TAU = Math.PI * 2;
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isMobile(){
    return root.getAttribute('data-device') === 'mobile' ||
      (window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  }
  function isLight(){ return root.getAttribute('data-theme') === 'light'; }

  /* ---------- palettes ---------- */
  function mix(a, b, t){
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  }
  function rgb(c, a){
    return 'rgba(' + (c[0]|0) + ',' + (c[1]|0) + ',' + (c[2]|0) + ',' + (a == null ? 1 : a) + ')';
  }
  // Body colour ramp head -> tail, plus accents. Dark: mint/teal with gold; far dragon violet-teal.
  var PAL = {
    dark: {
      ramp: [[150,255,215],[3,201,136],[20,184,166],[14,116,144],[8,60,78]],
      shade: [2,70,60], hi: [200,255,235], gold: [242,201,107], eye: [255,236,170],
      glow: [3,201,136], far: [[160,140,255],[90,110,220],[40,120,150],[20,50,80]], farGlow: [120,110,240],
      mote: [120,255,210], moteFar: [150,140,255], mist: [20,120,110]
    },
    light: {
      ramp: [[60,200,160],[6,160,112],[13,148,136],[14,116,144],[90,150,165]],
      shade: [6,95,80], hi: [190,245,225], gold: [196,146,40], eye: [255,214,120],
      glow: [6,170,120], far: [[150,130,235],[120,130,220],[100,160,180],[150,180,195]], farGlow: [140,130,230],
      mote: [10,150,110], moteFar: [130,120,220], mist: [120,190,180]
    }
  };
  function ramp(stops, t){
    var n = stops.length - 1, f = Math.min(n - 1e-6, Math.max(0, t * n)), i = f | 0;
    return mix(stops[i], stops[i + 1], f - i);
  }

  /* ---------- glow sprite (pre-rendered once per theme) ---------- */
  function sprite(c, size){
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var g = cv.getContext('2d'), h = size / 2;
    var gr = g.createRadialGradient(h, h, 0, h, h, h);
    gr.addColorStop(0, rgb(c, 1)); gr.addColorStop(0.25, rgb(c, 0.55));
    gr.addColorStop(0.6, rgb(c, 0.12)); gr.addColorStop(1, rgb(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return cv;
  }

  /* ---------- dragon ---------- */
  function Dragon(o){
    this.o = o;            // config: fx, fy, px, py, ampX, ampY, cy, speed, lenK, rK, segs, farStyle
    this.pts = []; this.u = o.u0 || 0;
  }
  // Smooth 1:2 Lissajous (a lazy figure-eight) whose phase drifts slowly, so each pass
  // takes a different route. Sweeps past the left/right edges, so the dragon exits and re-enters.
  Dragon.prototype.path = function(u, W, H){
    var o = this.o, ph = o.py + u * 0.11;
    return [
      W * (0.5 + o.ampX * Math.sin(u * o.fx + o.px)),
      H * (o.cy + o.ampY * Math.sin(u * o.fy + ph) + 0.05 * Math.sin(u * 0.7 + o.px))
    ];
  };
  // Spine resampled to equal arc length, walking backwards along the path from the head.
  Dragon.prototype.spine = function(W, H, T){
    var o = this.o, N = o.segs, L = Math.max(W, H) * o.lenK, seg = L / (N - 1);
    var R = Math.max(8, Math.min(28, Math.min(W, H) * o.rK));
    var u = this.u, p = this.path(u, W, H), out = [[p[0], p[1]]], acc = 0, guard = 0;
    var du = 0.002, prev = p;
    while (out.length < N && guard++ < 6000){
      u -= du;
      var q = this.path(u, W, H), dx = q[0] - prev[0], dy = q[1] - prev[1], d = Math.sqrt(dx*dx + dy*dy);
      if (d > 0){
        // adapt the step so each sample moves about a third of a segment
        du *= Math.max(0.5, Math.min(2, (seg / 3) / d));
        while (acc + d >= seg && out.length < N){
          var k = (seg - acc) / d;
          prev = [prev[0] + dx * k, prev[1] + dy * k];
          out.push(prev); dx = q[0] - prev[0]; dy = q[1] - prev[1];
          d = Math.sqrt(dx*dx + dy*dy); acc = 0;
        }
        acc += d;
      }
      prev = q;
    }
    while (out.length < N) out.push(out[out.length - 1].slice());
    // swim: lateral travelling wave, weaker at the head so the face stays steady
    var pts = this.pts; pts.length = N;
    for (var i = 0; i < N; i++){
      var a = out[Math.max(0, i - 1)], b = out[Math.min(N - 1, i + 1)];
      var tx = a[0] - b[0], ty = a[1] - b[1], tl = Math.sqrt(tx*tx + ty*ty) || 1;
      var s = i / (N - 1), env = 0.2 + 0.8 * Math.min(1, s * 3.5);
      var w = R * 1.1 * env * Math.sin(s * TAU * 2.1 - T * 1.7);
      pts[i] = { x: out[i][0] - ty / tl * w, y: out[i][1] + tx / tl * w, s: s, nx: 0, ny: 0, r: 0 };
    }
    for (i = 0; i < N; i++){
      a = pts[Math.max(0, i - 1)]; b = pts[Math.min(N - 1, i + 1)];
      tx = a.x - b.x; ty = a.y - b.y; tl = Math.sqrt(tx*tx + ty*ty) || 1;
      pts[i].nx = -ty / tl; pts[i].ny = tx / tl;
      s = pts[i].s;
      // thick neck, fuller chest, long taper to a fine tail
      pts[i].r = R * (0.62 + 0.38 * Math.sin(Math.min(1, s / 0.14) * Math.PI / 2)) * Math.pow(1 - s, 0.85) + 0.8;
    }
    this.R = R;
    return pts;
  };

  function drawDragon(g, dr, W, H, T, pulse, theme, lite){
    var o = dr.o, P = theme, pts = dr.spine(W, H, T), N = pts.length, R = dr.R, i, p;
    var stops = o.farStyle ? P.far : P.ramp, glowC = o.farStyle ? P.farGlow : P.glow;
    g.lineCap = 'round'; g.lineJoin = 'round';

    // 1. soft aura (single polygon, no overlap), breathing with the pulse
    [[2.9, 0.05, 0.07], [1.75, 0.08, 0.12]].forEach(function(b){
      g.beginPath();
      for (i = 0; i < N; i++){ p = pts[i]; g.lineTo(p.x + p.nx * p.r * b[0], p.y + p.ny * p.r * b[0]); }
      for (i = N - 1; i >= 0; i--){ p = pts[i]; g.lineTo(p.x - p.nx * p.r * b[0], p.y - p.ny * p.r * b[0]); }
      g.closePath(); g.fillStyle = rgb(glowC, b[1] + b[2] * pulse); g.fill();
    });

    // 2. legs (under the body): two pairs, slow paddling
    if (!o.noLegs){
      [0.2, 0.56].forEach(function(ls, li){
        var k = Math.round(ls * (N - 1)), q = pts[k], q2 = pts[Math.max(0, k - 1)];
        var dx = q2.x - q.x, dy = q2.y - q.y, dl = Math.sqrt(dx*dx + dy*dy) || 1; dx /= dl; dy /= dl;
        var col = rgb(ramp(stops, ls * 0.9)), gold = rgb(P.gold);
        for (var side = -1; side <= 1; side += 2){
          var sw = Math.sin(T * 1.8 + li * 1.7 + (side > 0 ? 0 : Math.PI)) * 0.5;
          var bx = q.x + q.nx * q.r * side * 0.8, by = q.y + q.ny * q.r * side * 0.8;
          var kx = bx + q.nx * side * R * 1.3 + dx * R * (0.3 + sw), ky = by + q.ny * side * R * 1.3 + dy * R * (0.3 + sw);
          var fx = kx - dx * R * (0.9 - sw) + q.nx * side * R * 0.5, fy = ky - dy * R * (0.9 - sw) + q.ny * side * R * 0.5;
          g.strokeStyle = col; g.lineWidth = R * 0.5;
          g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(kx, ky, fx, fy); g.stroke();
          g.strokeStyle = gold; g.lineWidth = Math.max(1, R * 0.12);
          g.beginPath();
          for (var c = -1; c <= 1; c++){
            g.moveTo(fx, fy);
            g.lineTo(fx + (q.nx * side * 0.55 + dx * c * 0.45) * R * 0.6 - dx * R * 0.25,
                     fy + (q.ny * side * 0.55 + dy * c * 0.45) * R * 0.6 - dy * R * 0.25);
          }
          g.stroke();
        }
      });
    }

    // 3. tail fin: two flame-like fronds
    var t0 = pts[N - 1], t1 = pts[N - 4] || pts[0];
    var tdx = t0.x - t1.x, tdy = t0.y - t1.y, tdl = Math.sqrt(tdx*tdx + tdy*tdy) || 1; tdx /= tdl; tdy /= tdl;
    g.fillStyle = rgb(o.farStyle ? stops[1] : P.gold, 0.85);
    for (var sd = -1; sd <= 1; sd += 2){
      var fl = Math.sin(T * 2.2 + sd) * 0.3;
      g.beginPath(); g.moveTo(t0.x, t0.y);
      g.quadraticCurveTo(t0.x + tdx * R * 1.2 - tdy * sd * R * (1.4 + fl), t0.y + tdy * R * 1.2 + tdx * sd * R * (1.4 + fl),
                         t0.x + tdx * R * 2.6 - tdy * sd * R * (0.6 + fl), t0.y + tdy * R * 2.6 + tdx * sd * R * (0.6 + fl));
      g.quadraticCurveTo(t0.x + tdx * R * 1.0, t0.y + tdy * R * 1.0, t0.x, t0.y);
      g.fill();
    }

    // 4. body tube: per-segment strokes, tail first so the neck sits on top
    for (i = N - 2; i >= 0; i--){
      p = pts[i]; var n = pts[i + 1];
      g.strokeStyle = dr.cols[i]; g.lineWidth = p.r * 2;
      g.beginPath(); g.moveTo(n.x, n.y); g.lineTo(p.x, p.y); g.stroke();
    }
    // 5. rounded highlight down the back (a few chunks of polyline)
    var chunks = lite ? 4 : 7, per = Math.ceil((N - 1) / chunks);
    g.strokeStyle = rgb(P.hi, o.farStyle ? 0.25 : 0.35);
    for (var ch = 0; ch < chunks; ch++){
      var a0 = ch * per, a1 = Math.min(N - 1, a0 + per);
      if (a1 <= a0) break;
      g.lineWidth = pts[a0].r * 0.55;
      g.beginPath(); g.moveTo(pts[a0].x, pts[a0].y);
      for (i = a0 + 1; i <= a1; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
    }
    // 6. scales: forward-pointing chevrons; a travelling gold shimmer every pulse
    var step = lite ? 3 : 2, sp = ((T / 2.6) % 1) * 1.3 - 0.15;
    g.lineWidth = Math.max(1, R * 0.11);
    g.strokeStyle = rgb(P.shade, 0.55);
    g.beginPath();
    for (i = 2; i < N - 3; i += step){
      p = pts[i]; var f = pts[i - 1], w2 = p.r * 0.78;
      var ddx = f.x - p.x, ddy = f.y - p.y;
      g.moveTo(p.x + p.nx * w2 - ddx * 0.6, p.y + p.ny * w2 - ddy * 0.6);
      g.lineTo(p.x + ddx * 0.6, p.y + ddy * 0.6);
      g.lineTo(p.x - p.nx * w2 - ddx * 0.6, p.y - p.ny * w2 - ddy * 0.6);
    }
    g.stroke();
    if (!reduce){
      g.strokeStyle = rgb(P.gold, 0.9);
      g.beginPath();
      for (i = 2; i < N - 3; i += step){
        if (Math.abs(pts[i].s - sp) > 0.06) continue;
        p = pts[i]; f = pts[i - 1]; w2 = p.r * 0.78; ddx = f.x - p.x; ddy = f.y - p.y;
        g.moveTo(p.x + p.nx * w2 - ddx * 0.6, p.y + p.ny * w2 - ddy * 0.6);
        g.lineTo(p.x + ddx * 0.6, p.y + ddy * 0.6);
        g.lineTo(p.x - p.nx * w2 - ddx * 0.6, p.y - p.ny * w2 - ddy * 0.6);
      }
      g.stroke();
    }
    // 7. dorsal ridge: fine gold line with small spines
    g.strokeStyle = rgb(o.farStyle ? stops[0] : P.gold, 0.8); g.lineWidth = Math.max(0.8, R * 0.08);
    g.beginPath(); g.moveTo(pts[1].x, pts[1].y);
    for (i = 2; i < N - 2; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();

    // 8. head, drawn in its own frame (forward = +x), top-down so it never flips
    var h0 = pts[0], h1 = pts[2] || pts[1];
    var ang = Math.atan2(h0.y - h1.y, h0.x - h1.x);
    g.save(); g.translate(h0.x, h0.y); g.rotate(ang);
    var hr = R * 1.5, wv = Math.sin(T * 1.3);
    // whiskers: from the snout, curling out then trailing far back, waving slowly
    g.lineWidth = Math.max(0.9, hr * 0.06);
    for (var s2 = -1; s2 <= 1; s2 += 2){
      g.strokeStyle = rgb(P.gold, 0.8);
      g.beginPath(); g.moveTo(hr * 2.05, s2 * hr * 0.38);
      g.bezierCurveTo(hr * 2.7, s2 * hr * 1.3, hr * 1.2, s2 * hr * (2.0 + wv * 0.35), -hr * 0.6, s2 * hr * (1.9 - wv * 0.3));
      g.stroke();
      g.strokeStyle = rgb(P.gold, 0.4);
      g.beginPath(); g.moveTo(-hr * 0.6, s2 * hr * (1.9 - wv * 0.3));
      g.quadraticCurveTo(-hr * 1.8, s2 * hr * (1.8 - wv * 0.5), -hr * 2.9, s2 * hr * (2.3 + wv * 0.3));
      g.stroke();
    }
    // mane: soft swept-back flame tufts behind the jaw
    g.fillStyle = rgb(o.farStyle ? stops[1] : ramp(stops, 0.3), 0.9);
    g.beginPath();
    for (s2 = -1; s2 <= 1; s2 += 2){
      for (var m = 0; m < 3; m++){
        var mx = -hr * (0.15 + m * 0.42), mw = Math.sin(T * 1.6 + m * 1.3) * 0.12;
        g.moveTo(mx + hr * 0.35, s2 * hr * 0.6);
        g.quadraticCurveTo(mx - hr * 0.2, s2 * hr * (1.15 + mw), mx - hr * 0.85, s2 * hr * (1.05 + m * 0.1 + mw));
        g.quadraticCurveTo(mx - hr * 0.25, s2 * hr * 0.75, mx - hr * 0.3, s2 * hr * 0.35);
      }
    }
    g.fill();
    // horns: two tapered antlers swept back, filled (crisper than strokes at small size)
    g.fillStyle = rgb(P.gold);
    for (s2 = -1; s2 <= 1; s2 += 2){
      g.beginPath();
      g.moveTo(hr * 0.35, s2 * hr * 0.42);
      g.quadraticCurveTo(-hr * 0.6, s2 * hr * 0.55, -hr * 1.9, s2 * hr * 1.05);
      g.quadraticCurveTo(-hr * 0.55, s2 * hr * 0.78, hr * 0.15, s2 * hr * 0.66);
      g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(-hr * 0.7, s2 * hr * 0.66);
      g.quadraticCurveTo(-hr * 0.95, s2 * hr * 0.95, -hr * 1.05, s2 * hr * 1.3);
      g.quadraticCurveTo(-hr * 0.8, s2 * hr * 0.95, -hr * 0.45, s2 * hr * 0.7);
      g.closePath(); g.fill();
    }
    // skull and long snout (top-down)
    g.fillStyle = rgb(ramp(stops, 0.03));
    g.beginPath();
    g.moveTo(-hr * 0.55, 0);
    g.bezierCurveTo(-hr * 0.55, -hr * 0.7, hr * 0.15, -hr * 0.9, hr * 0.8, -hr * 0.72);
    g.bezierCurveTo(hr * 1.3, -hr * 0.6, hr * 1.55, -hr * 0.4, hr * 2.0, -hr * 0.42);
    g.bezierCurveTo(hr * 2.45, -hr * 0.44, hr * 2.6, -hr * 0.2, hr * 2.6, 0);
    g.bezierCurveTo(hr * 2.6, hr * 0.2, hr * 2.45, hr * 0.44, hr * 2.0, hr * 0.42);
    g.bezierCurveTo(hr * 1.55, hr * 0.4, hr * 1.3, hr * 0.6, hr * 0.8, hr * 0.72);
    g.bezierCurveTo(hr * 0.15, hr * 0.9, -hr * 0.55, hr * 0.7, -hr * 0.55, 0);
    g.closePath(); g.fill();
    // brows and snout ridge
    g.strokeStyle = rgb(P.shade, 0.55); g.lineWidth = Math.max(0.9, hr * 0.07);
    g.beginPath();
    g.moveTo(hr * 0.3, -hr * 0.62); g.quadraticCurveTo(hr * 1.0, -hr * 0.62, hr * 1.35, -hr * 0.3);
    g.moveTo(hr * 0.3, hr * 0.62);  g.quadraticCurveTo(hr * 1.0, hr * 0.62, hr * 1.35, hr * 0.3);
    g.moveTo(hr * 1.45, 0); g.lineTo(hr * 2.35, 0);
    g.stroke();
    // nostrils
    g.fillStyle = rgb(P.shade, 0.85);
    g.beginPath(); g.ellipse(hr * 2.35, -hr * 0.2, hr * 0.09, hr * 0.05, 0.4, 0, TAU);
    g.ellipse(hr * 2.35, hr * 0.2, hr * 0.09, hr * 0.05, -0.4, 0, TAU); g.fill();
    // eyes: glow sprite (brighter on the pulse), almond eye, slit pupil
    for (s2 = -1; s2 <= 1; s2 += 2){
      var ex = hr * 0.95, ey = s2 * hr * 0.5, es = hr * (1.5 + 0.6 * pulse);
      g.globalAlpha = 0.5 + 0.45 * pulse;
      g.drawImage(dr.eyeSprite, ex - es / 2, ey - es / 2, es, es);
      g.globalAlpha = 1;
      g.fillStyle = rgb(P.eye);
      g.beginPath(); g.ellipse(ex, ey, hr * 0.24, hr * 0.12, s2 * 0.25, 0, TAU); g.fill();
      g.fillStyle = 'rgba(8,24,22,0.95)';
      g.beginPath(); g.ellipse(ex + hr * 0.03, ey, hr * 0.045, hr * 0.1, 0, 0, TAU); g.fill();
    }
    g.restore();
    // the pearl the dragon chases, just ahead of the head
    if (!o.noPearl){
      var pp = dr.path(dr.u + 0.16 * o.fxPearl, W, H), ps = R * (3.2 + 0.8 * pulse);
      var bob = Math.sin(T * 1.1) * R * 0.6;
      g.globalAlpha = 0.6 + 0.35 * pulse;
      g.drawImage(dr.pearlSprite, pp[0] - ps / 2, pp[1] + bob - ps / 2, ps, ps);
      g.globalAlpha = 1;
    }
  }

  /* ---------- motes (parallax particles) ---------- */
  function makeMotes(n, W, H, seed){
    var a = [], s = seed;
    function rnd(){ s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }
    for (var i = 0; i < n; i++) a.push({ x: rnd() * W, y: rnd() * H, r: 0.6 + rnd() * 1.8, ph: rnd() * TAU, v: 4 + rnd() * 10 });
    return a;
  }
  function drawMotes(g, motes, W, H, T, scrollY, k, spr, alpha){
    for (var i = 0; i < motes.length; i++){
      var m = motes[i];
      var y = ((m.y - scrollY * k - T * m.v) % H + H) % H;
      var x = m.x + Math.sin(T * 0.3 + m.ph) * 14;
      var tw = 0.45 + 0.55 * Math.sin(T * 0.9 + m.ph);
      var sz = m.r * 9;
      g.globalAlpha = alpha * tw;
      g.drawImage(spr, x - sz / 2, y - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
  }

  /* ---------- setup ---------- */
  function init(){
    var mobile = isMobile();
    var far = document.createElement('canvas'), near = document.createElement('canvas');
    far.className = 'dragon-bg far' + (mobile ? '' : ' soft');
    near.className = 'dragon-bg near';
    far.setAttribute('aria-hidden', 'true'); near.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(near, document.body.firstChild);
    document.body.insertBefore(far, near);
    var gf = far.getContext('2d'), gn = near.getContext('2d');
    if (!gf || !gn) return;

    var W = 0, H = 0, dprN = 1, dprF = 0.5, theme, sprites = {};
    var main = new Dragon({ fx: 1, fy: 2, px: 0.4, py: 1.9, ampY: 0.34, cy: 0.5, speed: 0.085,
            lenK: mobile ? 1.0 : 0.95, rK: mobile ? 0.03 : 0.024, ampX: mobile ? 0.54 : 0.62, segs: mobile ? 40 : 84, u0: 5.35, fxPearl: 1 });
    var ghost = new Dragon({ fx: 0.8, fy: 1.6, px: 2.6, py: 0.3, ampX: 0.7, ampY: 0.3, cy: 0.42, speed: 0.06,
      lenK: 0.7, rK: mobile ? 0.022 : 0.016, segs: mobile ? 22 : 44, u0: 5.1, farStyle: true, noPearl: true, noLegs: mobile, fxPearl: 1 });
    var motesNear, motesFar, light;

    function buildTheme(){
      light = isLight();
      theme = light ? PAL.light : PAL.dark;
      sprites.eye = sprite(theme.eye, 64);
      sprites.pearl = sprite(light ? [255, 215, 120] : [235, 255, 245], 96);
      sprites.mote = sprite(theme.mote, 32);
      sprites.moteFar = sprite(theme.moteFar, 32);
      sprites.mist = sprite(theme.mist, 128);
      [main, ghost].forEach(function(d){
        var stops = d.o.farStyle ? theme.far : theme.ramp, c = [];
        for (var i = 0; i < d.o.segs; i++) c.push(rgb(ramp(stops, i / (d.o.segs - 1))));
        d.cols = c; d.eyeSprite = sprites.eye; d.pearlSprite = sprites.pearl;
      });
    }
    function size(){
      var w = window.innerWidth, h = Math.max(window.innerHeight, document.documentElement.clientHeight);
      // On phones the URL bar resizes the viewport on scroll: only grow, never shrink, unless the width changed.
      if (w === W && h <= H) return false;
      W = w; H = h;
      var cap = mobile ? 1 : 1.5, dpr = Math.min(window.devicePixelRatio || 1, cap);
      dprN = dpr; dprF = mobile ? 0.5 : 0.5;
      near.width = Math.round(W * dprN); near.height = Math.round(H * dprN);
      far.width = Math.round(W * dprF); far.height = Math.round(H * dprF);
      motesNear = makeMotes(mobile ? 8 : 26, W, H, 7);
      motesFar = makeMotes(mobile ? 8 : 30, W, H, 99);
      return true;
    }

    var T = 0, last = 0, raf = 0, frame = 0;
    var sy = window.scrollY || 0, lagN = sy, lagF = sy, vel = 0, lastSy = sy;

    function render(full){
      var pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(T * TAU / 2.6);
      var offN = reduce ? 0 : Math.max(-H * 0.6, Math.min(H * 0.6, (sy - lagN) * 0.35));
      var offF = reduce ? 0 : Math.max(-H * 0.4, Math.min(H * 0.4, (sy - lagF) * 0.12));
      // far layer (quarter rate on phones, half rate on desktop)
      if (full || (frame & (mobile ? 3 : 1)) === 0){
        gf.setTransform(dprF, 0, 0, dprF, 0, 0);
        gf.clearRect(0, 0, W, H);
        // two slow mist clouds
        gf.globalAlpha = light ? 0.35 : 0.5;
        var mx = W * (0.3 + 0.2 * Math.sin(T * 0.05)), my = H * 0.35 - offF;
        gf.drawImage(sprites.mist, mx - W * 0.6, my - W * 0.4, W * 1.2, W * 0.8);
        mx = W * (0.75 + 0.15 * Math.cos(T * 0.04)); my = H * 0.75 - offF;
        gf.drawImage(sprites.mist, mx - W * 0.5, my - W * 0.35, W, W * 0.7);
        gf.globalAlpha = 1;
        drawMotes(gf, motesFar, W, H, reduce ? 0 : T, reduce ? 0 : sy, 0.2, sprites.moteFar, light ? 0.35 : 0.55);
        gf.save(); gf.translate(0, -offF);
        drawDragon(gf, ghost, W, H, T, pulse, theme, true);
        gf.restore();
      }
      gn.setTransform(dprN, 0, 0, dprN, 0, 0);
      gn.clearRect(0, 0, W, H);
      gn.save(); gn.translate(0, -offN);
      drawDragon(gn, main, W, H, T, pulse, theme, mobile);
      gn.restore();
      drawMotes(gn, motesNear, W, H, reduce ? 0 : T, reduce ? 0 : sy, 0.5, sprites.mote, light ? 0.45 : 0.7);
    }

    function tick(now){
      raf = 0;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      sy = window.scrollY || 0;
      var dsy = sy - lastSy; lastSy = sy;
      vel += (Math.abs(dsy) / Math.max(dt, 0.001) - vel) * 0.1;
      // swims a little faster while the page scrolls; parallax offsets relax back home
      var boost = 1 + Math.min(1.5, vel / 1500);
      T += dt * boost;
      main.u += dt * main.o.speed * boost;
      ghost.u += dt * ghost.o.speed * boost;
      lagN += (sy - lagN) * Math.min(1, dt * 0.9);
      lagF += (sy - lagF) * Math.min(1, dt * 0.6);
      frame++;
      // Frame-time guard: if the device cannot keep up (median frame > 26 ms over a
      // 2 s window), stop animating and leave one static frame. Phones draw at 30 fps.
      perf.push(now - (perf.lastNow || now)); perf.lastNow = now;
      if (now - perf.t0 > 2000){
        var a = perf.slice(1).sort(function(x, y){ return x - y; }), med = a[a.length >> 1] || 0;
        perf.length = 0; perf.t0 = now;
        if (med > 26 && ++perf.bad >= 2){ frozen = true; render(true); return; }
        if (med <= 26) perf.bad = 0;
      }
      if (!mobile || (frame & 1) === 0) render(false);
      schedule();
    }
    var perf = [], frozen = false; perf.t0 = 0; perf.bad = 0;
    function schedule(){ if (!raf && !document.hidden && !frozen) raf = requestAnimationFrame(tick); }

    buildTheme(); size();
    function redrawStatic(){ T = 6; render(true); }

    if (reduce){
      redrawStatic();
      window.addEventListener('resize', function(){ if (size()) redrawStatic(); }, { passive: true });
    } else {
      document.addEventListener('visibilitychange', function(){
        if (document.hidden){ if (raf) cancelAnimationFrame(raf); raf = 0; }
        else { last = 0; perf.length = 0; perf.lastNow = 0; perf.t0 = performance.now(); schedule(); }
      });
      window.addEventListener('resize', function(){ if (size() && frozen) render(true); }, { passive: true });
      perf.t0 = performance.now();
      schedule();
    }
    var onTheme = function(){ buildTheme(); if (reduce) redrawStatic(); else if (frozen) render(true); };
    window.addEventListener('stryker:theme', onTheme);
    new MutationObserver(function(){ if (isLight() !== light) onTheme(); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    requestAnimationFrame(function(){ far.classList.add('on'); near.classList.add('on'); });
    window.__dragonBgDebug = { render: render, main: main, ghost: ghost, frozen: function(){ return frozen; } };
  }

  // QA override: localStorage stryker_dragon = 'on' forces it, 'off' hides it.
  function pref(){ try { return localStorage.getItem('stryker_dragon'); } catch (e) { return null; } }
  function lowEnd(){
    var p = pref(); if (p === 'on') return false; if (p === 'off') return true;
    var n = navigator, mem = n.deviceMemory, cores = n.hardwareConcurrency;
    if (mem && mem <= 2) return true;
    if (cores && cores <= 2) return true;
    if (n.connection && n.connection.saveData) return true;
    return false;
  }
  // Load dragon-bg.css with this script's own ?v= build, then call back.
  function withCss(cb){
    if (document.querySelector('link[href*="dragon-bg.css"]')) { cb(); return; }
    var me = document.currentScript || document.querySelector('script[src*="dragon-bg.js"]');
    var v = me && /[?&]v=([^&]+)/.exec(me.src || '');
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/assets/dragon-bg.css' + (v ? '?v=' + v[1] : '');
    l.onload = cb; l.onerror = function(){};
    document.head.appendChild(l);
  }
  var cssReady = false, loaded = document.readyState === 'complete';
  function start(){
    if (!cssReady || !loaded) return;
    if (!document.body || document.body.hasAttribute('data-no-dragon') || lowEnd()) return;
    var go = function(){ try { init(); root.classList.add('dragon-on'); } catch (e) { /* decorative only: never break the page */ } };
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 200);
  }
  withCss(function(){ cssReady = true; start(); });
  if (!loaded) window.addEventListener('load', function(){ loaded = true; start(); }, { once: true });
})();
