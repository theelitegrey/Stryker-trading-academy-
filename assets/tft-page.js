// TradeZoro: Traders for Traders page (/traders-for-traders), page-only motion, no libraries.
//   1. Constellation canvas (hero + final band, one canvas each): drifting nodes (traders) joined by thin green
//      lines; every ~14 s half of them gather into a decorative price line with candles, hold, and drift apart.
//      Nodes ease away from the cursor. Paused off screen / hidden tab. Reduced motion = one formed frame.
//      The line is generated, not market data, and carries no prices or labels.
//   2. Reveals: .tf-rv and [data-in] get .in once on screen (IntersectionObserver).
//   3. Manifesto: words go from dim to full as you scroll (sticky on >= 900 px, plain on phones).
//   4. Number strip count-up: the final text is what the HTML says (tools/home-stats.py keeps it true).
//   5. Roadmap feed: latest shipped items, two in-progress rows and updates per week, from assets/roadmap-data.js
//      (settings/roadmap + assets/roadmap-log.json). The HTML ships a static copy of the same, so no layout shift.
//   6. Card light: --mx/--my follow the pointer inside .tf-card (fine pointers only).
// html.tf-js / html.tf-rm are set by the inline <head> snippet. Depends on: assets/tft-page.css, assets/roadmap-data.js.
(function () {
  var doc = document, root = doc.documentElement;
  window.__tfOk = 1;
  var RM = root.classList.contains('tf-rm');
  var hasIO = typeof IntersectionObserver === 'function';
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  function vis(el, cb, th) {
    if (!hasIO) { cb(true); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { cb(e.isIntersecting); }); }, { threshold: th || 0 }).observe(el);
  }

  // ---- 2. reveals ----
  var rvs = $$('.tf-rv,[data-in]');
  if (!hasIO || RM) rvs.forEach(function (el) { el.classList.add('in'); });
  else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    rvs.forEach(function (el) { io.observe(el); });
  }

  // ---- 1. constellation ----
  function col(name, fb) { var v = getComputedStyle(root).getPropertyValue(name).trim(); return v || fb; }
  function rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return [3, 201, 136];
    var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rnd(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function sky(cv, band) {
    var ctx = cv.getContext('2d'); if (!ctx) return;
    var host = cv.parentNode, W = 0, H = 0, dpr = 1, nodes = [], line = [], run = false, raf = 0, last = 0, clock = 0;
    var mouse = { x: -1e4, y: -1e4, on: false }, C = {};
    function theme() {
      var light = root.getAttribute('data-theme') === 'light';
      C = { g: rgb(col('--gold', '#03c988')), t: rgb(col('--teal', '#00adb5')), ink: light ? [40, 50, 70] : [200, 210, 220], light: light };
    }
    function size() {
      var r = host.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var R = rnd(7), N = W < 700 ? 34 : W < 1100 ? 56 : 78, nl = Math.round(N * 0.5);
      nodes = []; line = [];
      // the price line: a gentle random walk across the band (decorative, not data)
      var y = 0.6, ys = [];
      for (var k = 0; k < nl; k++) { y += (R() - 0.47) * 0.16; y = Math.max(0.1, Math.min(0.9, y)); ys.push(y); }
      for (var i = 0; i < N; i++) {
        var n = { x: R() * W, y: R() * H, vx: (R() - 0.5) * 14, vy: (R() - 0.5) * 14, ox: 0, oy: 0, px: 0, py: 0, hx: 0, hy: 0, on: i < nl, w: 0.6 + R() * 0.4 };
        if (n.on) { n.hx = W * (0.05 + 0.9 * i / (nl - 1)); n.hy = H * (band[0] + (band[1] - band[0]) * ys[i]); line.push(n); }
        nodes.push(n);
      }
      if (!run) draw(RM ? 6 : clock);
    }
    function ease(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
    function form(t) { // 14 s loop: wander 0-3, gather 3-6.5, hold 6.5-11, release 11-14
      var p = t % 14; return p < 3 ? 0 : p < 6.5 ? ease((p - 3) / 3.5) : p < 11 ? 1 : 1 - ease((p - 11) / 3);
    }
    function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }
    function draw(t) {
      var f = RM ? 1 : form(t), dt = RM ? 0 : Math.min(0.05, (t - last) || 0); last = t;
      var i, j, n, m, R2 = 150;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
        if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
        var tx = 0, ty = 0;
        if (mouse.on) {
          var dx = n.px - mouse.x, dy = n.py - mouse.y, d = Math.sqrt(dx * dx + dy * dy);
          if (d < R2 && d > 0.1) { var k = (1 - d / R2); k = k * k * 36; tx = dx / d * k; ty = dy / d * k; }
        }
        n.ox += (tx - n.ox) * 0.12; n.oy += (ty - n.oy) * 0.12;
        var g = n.on ? f * n.w + f * (1 - n.w) : 0;
        n.px = n.x + (n.hx - n.x) * g + n.ox; n.py = n.y + (n.hy - n.y) * g + n.oy;
      }
      ctx.clearRect(0, 0, W, H);
      var maxD = W < 700 ? 96 : 132, lw = C.light ? 0.5 : 0.36;
      ctx.lineWidth = 1;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          m = nodes[j];
          var ax = n.px - m.px, ay = n.py - m.py; if (ax > maxD || ax < -maxD || ay > maxD || ay < -maxD) continue;
          var dd = Math.sqrt(ax * ax + ay * ay); if (dd >= maxD) continue;
          var a = (1 - dd / maxD) * lw * (n.on && m.on ? 1 - f * 0.7 : 1);
          ctx.strokeStyle = rgba(C.g, a); ctx.beginPath(); ctx.moveTo(n.px, n.py); ctx.lineTo(m.px, m.py); ctx.stroke();
        }
        if (mouse.on) {
          var mx = n.px - mouse.x, my = n.py - mouse.y, md = Math.sqrt(mx * mx + my * my);
          if (md < 190) { ctx.strokeStyle = rgba(C.g, (1 - md / 190) * 0.5); ctx.beginPath(); ctx.moveTo(n.px, n.py); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); }
        }
      }
      if (f > 0.01) {
        // candles between consecutive line nodes, then the line and a soft fill under it
        var cw = Math.max(3, Math.min(10, W / line.length * 0.34));
        for (i = 1; i < line.length; i++) {
          var p = line[i - 1], q = line[i], up = q.py < p.py, top = Math.min(p.py, q.py), bot = Math.max(p.py, q.py);
          var wk = 6 + (i * 37 % 13);
          ctx.strokeStyle = rgba(up ? C.g : C.ink, f * (up ? 0.5 : 0.32));
          ctx.beginPath(); ctx.moveTo(q.px, top - wk); ctx.lineTo(q.px, bot + wk * 0.7); ctx.stroke();
          ctx.fillStyle = rgba(up ? C.g : C.ink, f * (up ? 0.34 : 0.18));
          ctx.fillRect(q.px - cw / 2, top, cw, Math.max(2, bot - top));
        }
        ctx.beginPath(); ctx.moveTo(line[0].px, line[0].py);
        for (i = 1; i < line.length; i++) ctx.lineTo(line[i].px, line[i].py);
        ctx.lineWidth = 1.75; ctx.strokeStyle = rgba(C.g, f * 0.9); ctx.stroke();
        ctx.lineTo(line[line.length - 1].px, H); ctx.lineTo(line[0].px, H); ctx.closePath();
        var gr = ctx.createLinearGradient(0, H * 0.4, 0, H);
        gr.addColorStop(0, rgba(C.g, f * (C.light ? 0.1 : 0.12))); gr.addColorStop(1, rgba(C.g, 0));
        ctx.fillStyle = gr; ctx.fill(); ctx.lineWidth = 1;
      }
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var r = n.on ? 1.6 + f * 0.8 : 1.4;
        ctx.fillStyle = n.on && f > 0.5 ? rgba(C.g, 0.95) : rgba(C.light ? C.g : C.ink, C.light ? 0.6 : 0.55);
        ctx.beginPath(); ctx.arc(n.px, n.py, r, 0, 6.2832); ctx.fill();
      }
    }
    function loop(ts) {
      if (!run) return;
      clock = ts / 1000; draw(clock);
      raf = requestAnimationFrame(loop);
    }
    function play(on) {
      on = on && !RM && !doc.hidden;
      if (on === run) return;
      run = on; if (run) { last = performance.now() / 1000; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
    }
    var seen = false;
    theme(); size();
    vis(host, function (v) { seen = v; play(v); host.classList.toggle('tf-on', v && !RM); });
    doc.addEventListener('visibilitychange', function () { play(seen); });
    var rt = 0; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(size, 120); });
    doc.addEventListener('stryker:theme', function () { theme(); if (!run) draw(RM ? 6 : clock); });
    if (window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches) {
      host.addEventListener('pointermove', function (e) { var r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.on = true; });
      host.addEventListener('pointerleave', function () { mouse.on = false; });
    }
  }
  $$('canvas.tf-cv').forEach(function (cv) {
    var b = (cv.getAttribute('data-band') || '0.58,0.88').split(',').map(Number);
    if (window.innerWidth < 700) b = [Math.max(b[0], 0.8), Math.max(b[1], 0.9)];
    sky(cv, b);
  });
  var hero = doc.querySelector('.tf-hero');
  if (hero) requestAnimationFrame(function () { requestAnimationFrame(function () { hero.classList.add('tf-in'); }); });
  var end = doc.querySelector('.tf-end');
  if (end) { if (RM || !hasIO) end.classList.add('tf-in'); else vis(end, function (v) { if (v) end.classList.add('tf-in'); }, 0.3); }

  // ---- 3. manifesto word fill ----
  var man = doc.querySelector('.tf-man'), mt = man && man.querySelector('.tf-man-t'), bar = man && man.querySelector('.tf-man-bar i');
  if (mt && !RM) {
    (function wrap(el) {
      Array.prototype.slice.call(el.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var fr = doc.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { fr.appendChild(doc.createTextNode(w)); return; }
            var s = doc.createElement('span'); s.className = 'tf-wd'; s.textContent = w; fr.appendChild(s);
          });
          c.parentNode.replaceChild(fr, c);
        } else if (c.nodeType === 1) wrap(c);
      });
    })(mt);
    var wds = $$('.tf-wd', mt), lit = -1, mraf = 0;
    var paint = function () {
      mraf = 0;
      var r = man.getBoundingClientRect(), vh = window.innerHeight, p;
      var st = man.querySelector('.tf-man-st');
      if (getComputedStyle(st).position === 'sticky') p = -r.top / Math.max(1, r.height - vh) * 1.25;
      else p = (vh * 0.85 - mt.getBoundingClientRect().top) / (mt.offsetHeight + vh * 0.35);
      p = Math.max(0, Math.min(1, p));
      var n = Math.round(p * wds.length);
      if (n !== lit) { for (var i = 0; i < wds.length; i++) wds[i].classList.toggle('on', i < n); lit = n; }
      if (bar) bar.style.setProperty('--p', p.toFixed(3));
    };
    var on = false;
    vis(man, function (v) { on = v; if (v) paint(); });
    window.addEventListener('scroll', function () { if (on && !mraf) mraf = requestAnimationFrame(paint); }, { passive: true });
    paint();
  }

  // ---- 4. count-up ----
  $$('.tf-nums dd [data-stat]').forEach(function (el) {
    var txt = el.textContent, m = /^([\d,]+)(\+?)$/.exec(txt.trim()); if (!m || RM || !hasIO) return;
    var to = parseInt(m[1].replace(/,/g, ''), 10), done = false;
    vis(el, function (v) {
      if (!v || done) return; done = true;
      var t0 = performance.now(), D = 1400;
      (function step(now) {
        var k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
        el.textContent = k < 1 ? Math.round(to * e).toLocaleString('en-US') + m[2] : txt;
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }, 0.6);
  });

  // ---- 5. roadmap feed ----
  function href(l) { l = String(l || ''); if (!l || /:|^\/\//.test(l)) return '/roadmap#rmp-shipped'; return '/' + l.replace(/^\/+/, '').replace(/\.html(?=$|[#?])/, '').replace(/^index$/, ''); }
  function fmt(d) { var t = new Date(d + 'T12:00:00Z'); return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function mk(tag, cls, txt) { var e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var arrow = '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  if (window.StrykerRoadmap) {
    window.StrykerRoadmap.load().then(function (d) {
      var items = (d && d.items) || [];
      var shipped = items.filter(function (x) { return x.status === 'shipped' && x.date && x.desc && !x.auto; })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      var ul = doc.querySelector('[data-tf-ship]');
      if (ul && shipped.length >= 3) {
        ul.textContent = '';
        shipped.slice(0, 5).forEach(function (x, i) {
          var li = mk('li'); li.style.setProperty('--i', i);
          var a = mk('a'); a.href = href(x.link);
          var tm = mk('time', null, fmt(x.date)); tm.setAttribute('datetime', x.date);
          var tx = mk('span', 'tx'); tx.appendChild(mk('b', null, x.title)); tx.appendChild(mk('span', null, x.desc));
          a.appendChild(tm); a.appendChild(tx); a.insertAdjacentHTML('beforeend', arrow);
          li.appendChild(a); ul.appendChild(li);
        });
      }
      var rows = doc.querySelector('[data-tf-rows]'), prog = items.filter(function (x) { return x.status === 'progress' && x.desc; });
      if (rows && shipped.length && prog.length >= 2) {
        rows.textContent = '';
        [shipped[0], prog[0], prog[1]].forEach(function (x) {
          var li = mk('li'), tx = mk('span', 'tx');
          tx.appendChild(mk('b', null, x.title)); tx.appendChild(mk('span', null, x.desc));
          li.appendChild(tx); li.appendChild(mk('span', 'tf-st8 ' + x.status, x.status === 'shipped' ? 'Shipped' : 'In progress'));
          rows.appendChild(li);
        });
      }
    }).catch(function () {});
  }
  // updates per week from the public build log (same file and cache key as roadmap-data.js)
  var bars = doc.querySelector('[data-tf-bars]');
  if (bars && typeof fetch === 'function') {
    fetch('assets/roadmap-log.json?t=' + Math.floor(Date.now() / 3600000)).then(function (r) { return r.ok ? r.json() : []; }).then(function (log) {
      if (!Array.isArray(log) || !log.length) return;
      var ds = log.map(function (e) { return Date.parse(e.date + 'T00:00:00Z'); }).filter(function (x) { return !isNaN(x); });
      var lastD = new Date(Math.max.apply(null, ds)), wd = (lastD.getUTCDay() + 6) % 7, DAY = 864e5;
      var mon = lastD.getTime() - wd * DAY, wk = [], top = 1;
      for (var k = 7; k >= 0; k--) {
        var s = mon - k * 7 * DAY, n = ds.filter(function (x) { return x >= s && x < s + 7 * DAY; }).length;
        wk.push({ s: s, n: n }); top = Math.max(top, n);
      }
      bars.textContent = '';
      wk.forEach(function (w, i) {
        var li = mk('li'); li.style.setProperty('--i', i); li.style.setProperty('--h', Math.round(w.n / top * 100) + '%');
        li.appendChild(mk('b', null, String(w.n))); li.appendChild(mk('i'));
        li.appendChild(mk('em', null, new Date(w.s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })));
        li.setAttribute('aria-label', w.n + ' updates in the week of ' + fmt(new Date(w.s).toISOString().slice(0, 10)));
        bars.appendChild(li);
      });
    }).catch(function () {});
  }

  // ---- 6. card light ----
  if (window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches && !RM) {
    doc.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest('.tf-card'); if (!c) return;
      var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }
})();
