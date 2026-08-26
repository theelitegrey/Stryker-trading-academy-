// Stryker Trading Academy — homepage motion layer (PREVIEW)
//
// Loaded only by index-motion.html. The live homepage is untouched until this
// is approved.
//
// WHAT WAS ACTUALLY WRONG
// The page was not motionless — it already had scroll reveals, parallax and
// candles that build on load. It felt static for two more specific reasons:
//
//   1. Everything in a group arrived at the same instant. Six feature cards
//      fading in together reads as one block appearing, not as motion. Stagger
//      is what makes a group feel alive.
//   2. Nothing moved after it landed. Once the reveal finished, every element
//      was frozen. A page with no residual motion looks like a screenshot.
//
// So this adds sequencing and a small amount of continuous life, rather than
// piling on more entrances.
//
// PERFORMANCE. Transforms and opacity only — never width, height, top or left,
// which force layout on every frame. Scroll work is throttled through
// requestAnimationFrame. Observers disconnect once an element has played.
//
// prefers-reduced-motion removes all of it and shows the final state
// immediately. That is not a courtesy: for some people this kind of movement
// causes actual nausea.

(function () {

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ---- 1. Hero entrance ---------------------------------------------------
  // A single sequence, top to bottom, so the eye is led through the pitch in
  // the order it should be read: label, headline, explanation, action.
  function heroEntrance() {
    var copy = document.querySelector('.hero-copy');
    if (!copy) return;

    var steps = [
      copy.querySelector('.eyebrow'),
      copy.querySelector('h1'),
      copy.querySelector('p'),
      copy.querySelector('.hero-actions'),
      copy.querySelector('.hero-stats')
    ].filter(Boolean);

    steps.forEach(function (el, i) {
      el.classList.add('m-rise');
      // 90ms apart: close enough to feel like one movement, far enough apart
      // to read as a sequence. Below ~60ms it collapses into a single flash.
      el.style.transitionDelay = (0.12 + i * 0.09) + 's';
    });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        steps.forEach(function (el) { el.classList.add('m-in'); });
      });
    });

    var card = document.querySelector('.chart-card');
    if (card) {
      card.classList.add('m-card-rise');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { card.classList.add('m-in'); });
      });
    }
  }

  // ---- 2. Count-up on the hero stats --------------------------------------
  // Only for values that are genuinely numeric. A count-up on a placeholder
  // would animate toward a number the page does not actually know.
  function countUp(el, target, decimals, suffix) {
    var start = null, dur = 1100;
    function frame(t) {
      if (start === null) start = t;
      var k = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      var v = target * eased;
      el.textContent = (decimals ? v.toFixed(decimals)
                                 : Math.round(v).toLocaleString('en-US')) + (suffix || '');
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function heroStats() {
    document.querySelectorAll('.hero-stat b').forEach(function (el) {
      var raw = (el.textContent || '').trim();
      if (raw === '—' || raw === '') return;         // still loading from Firestore
      var m = raw.match(/^([\d.,]+)(.*)$/);
      if (!m) return;
      var num = parseFloat(m[1].replace(/,/g, ''));
      if (isNaN(num)) return;
      var decimals = (m[1].indexOf('.') !== -1) ? 1 : 0;
      el.textContent = decimals ? '0.0' : '0';
      setTimeout(function () { countUp(el, num, decimals, m[2]); }, 700);
    });
  }

  // ---- 3. Staggered reveals -----------------------------------------------
  // The existing .reveal fires every card in a grid at once. This re-observes
  // them and delays each by its position, so a grid unfolds instead of blinking.
  function staggerGroups() {
    if (!('IntersectionObserver' in window)) return;

    var groups = document.querySelectorAll(
      '.feature-grid, .price-grid, .proof-grid, .concept-grid, .step-grid');

    groups.forEach(function (group) {
      var kids = Array.prototype.filter.call(group.children, function (c) {
        return c.nodeType === 1;
      });
      kids.forEach(function (k) { k.classList.add('m-stagger'); });

      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          kids.forEach(function (k, i) {
            k.style.transitionDelay = (i * 0.07) + 's';
            k.classList.add('m-in');
          });
          io.disconnect();      // one-shot: re-animating on every scroll-by is
        });                     // distracting and costs frames for nothing
      }, { threshold: 0.15 });
      io.observe(group);
    });
  }

  // ---- 4. Section headings ------------------------------------------------
  function headings() {
    if (!('IntersectionObserver' in window)) return;
    document.querySelectorAll('.section-head, .container > h2').forEach(function (h) {
      h.classList.add('m-head');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          h.classList.add('m-in');
          io.disconnect();
        });
      }, { threshold: 0.3 });
      io.observe(h);
    });
  }

  // ---- 5. Header condense on scroll ---------------------------------------
  // Gives the page a sense of depth as you move down it, and reclaims vertical
  // space on the content that matters.
  function stickyHeader() {
    var nav = document.querySelector('.nav') || document.querySelector('nav');
    if (!nav) return;
    var ticking = false;
    function update() {
      nav.classList.toggle('m-condensed', window.scrollY > 40);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // ---- 6. Magnetic primary buttons ----------------------------------------
  // A few pixels of pull toward the cursor. Pointer-only and deliberately
  // small — enough to feel responsive, not enough to make the target move
  // away from someone trying to click it.
  function magneticButtons() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.querySelectorAll('.hero-actions .btn-primary').forEach(function (b) {
      b.classList.add('m-magnetic');
      b.addEventListener('mousemove', function (e) {
        var r = b.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        var dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        b.style.transform = 'translate(' + (dx * 6).toFixed(2) + 'px,' +
                                           (dy * 5).toFixed(2) + 'px)';
      });
      b.addEventListener('mouseleave', function () { b.style.transform = ''; });
    });
  }

  ready(function () {
    document.documentElement.classList.add('m-ready');

    if (reduced) {
      // Show the finished state at once. No delays, no transforms.
      document.querySelectorAll('.m-rise, .m-stagger, .m-head, .m-card-rise')
        .forEach(function (el) { el.classList.add('m-in'); });
      return;
    }

    heroEntrance();
    heroStats();
    staggerGroups();
    headings();
    stickyHeader();
    magneticButtons();
  });

})();

// ============================================================================
// MOTION LAYER 2 — the visible tier
//
// The first pass was deliberately restrained and read as bland. These are the
// elements people actually notice. The constraint is unchanged: nothing here
// may block reading, and all of it disappears under prefers-reduced-motion.
//
// The theme throughout is a LIVE MARKET. A trading platform whose homepage
// sits perfectly still is contradicting its own subject — price moves, so the
// page should look like it is watching something move.
// ============================================================================

(function () {

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ---- Deterministic-ish walk -------------------------------------------
  // A seeded generator rather than Math.random, so the price behaves like a
  // series instead of jittering — real ticks trend and retrace.
  function walker(seed, vol) {
    var s = seed;
    return function () {
      s = (s * 1103515245 + 12345) % 2147483648;
      return ((s / 2147483648) - 0.5) * 2 * vol;
    };
  }

  // ---- 1. Live price ticker on the chart card ----------------------------
  // The single highest-impact addition: a number that keeps changing reads as
  // a connected feed, which is what makes the whole card feel live rather than
  // like a screenshot of a chart.
  function livePrice() {
    var head = document.querySelector('.chart-card-head');
    if (!head || document.getElementById('m-price')) return;

    var wrap = document.createElement('div');
    wrap.className = 'm-price-wrap';
    wrap.innerHTML = '<span id="m-price">2418.60</span>' +
                     '<span id="m-change" class="up">+0.42%</span>';
    head.appendChild(wrap);

    var price = 2418.60, base = price, next = walker(7741, 0.9), t = 0;
    var el = document.getElementById('m-price');
    var ch = document.getElementById('m-change');

    setInterval(function () {
      t++;
      // Mean-reverting, so it never drifts somewhere implausible over a long
      // session on the page.
      price += next() - (price - base) * 0.04;
      var pct = ((price - base) / base) * 100;
      var up = pct >= 0;
      el.textContent = price.toFixed(2);
      el.className = up ? 'up' : 'down';
      ch.textContent = (up ? '+' : '') + pct.toFixed(2) + '%';
      ch.className = up ? 'up' : 'down';
      // Flash on change: the cue traders actually read on a live board.
      el.classList.remove('m-tick');
      void el.offsetWidth;               // reflow to restart the animation
      el.classList.add('m-tick');
    }, 1400);
  }

  // ---- 2. Rotating headline word -----------------------------------------
  // The headline states one idea; the market does several. Cycling the phrase
  // says more about the curriculum than a static line, and it is the first
  // thing the eye lands on.
  function rotatingWord() {
    var em = document.querySelector('.hero-copy h1 em');
    if (!em) return;
    var words = ['move price', 'hunt liquidity', 'engineer stops',
                 'fill their orders', 'trap the crowd'];
    var i = 0;
    em.classList.add('m-rotate');
    setInterval(function () {
      em.classList.add('m-out');
      setTimeout(function () {
        i = (i + 1) % words.length;
        em.textContent = words[i];
        em.classList.remove('m-out');
        em.classList.add('m-in-word');
        setTimeout(function () { em.classList.remove('m-in-word'); }, 500);
      }, 380);
    }, 3600);
  }

  // ---- 3. Candle rain behind the hero ------------------------------------
  // Canvas, not DOM: dozens of animated elements as divs would thrash layout.
  // One canvas draws them all in a single frame.
  function candleField() {
    var hero = document.querySelector('.hero');
    if (!hero || document.getElementById('m-canvas')) return;

    var c = document.createElement('canvas');
    c.id = 'm-canvas';
    c.className = 'm-canvas';
    hero.insertBefore(c, hero.firstChild);
    var ctx = c.getContext('2d');

    var candles = [], W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function size() {
      W = hero.offsetWidth; H = hero.offsetHeight;
      c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + 'px'; c.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      candles = [];
      var n = Math.round(W / 46);
      var r = walker(4242, 1);
      for (var i = 0; i < n; i++) {
        candles.push({
          x: (i / n) * W + (r() * 14),
          y: Math.abs(r()) * H,
          h: 14 + Math.abs(r()) * 46,
          w: 3 + Math.abs(r()) * 3,
          sp: 0.10 + Math.abs(r()) * 0.30,
          up: r() > 0,
          a: 0.05 + Math.abs(r()) * 0.13
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < candles.length; i++) {
        var k = candles[i];
        k.y += k.sp;
        if (k.y > H + k.h) { k.y = -k.h - Math.abs(walker(k.x | 0, 1)()) * 120; }
        ctx.globalAlpha = k.a;
        ctx.fillStyle = k.up ? '#03c988' : '#e5484d';
        ctx.fillRect(k.x, k.y, k.w, k.h);
        ctx.fillRect(k.x + k.w / 2 - 0.5, k.y - 6, 1, k.h + 12);
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    size();
    window.addEventListener('resize', size, { passive: true });
    requestAnimationFrame(frame);
  }

  // ---- 4. Instrument ticker strip ----------------------------------------
  // A marquee under the hero. Duplicated content and a transform-only loop, so
  // it never reflows and the seam is invisible.
  function tickerStrip() {
    var hero = document.querySelector('.hero');
    if (!hero || document.getElementById('m-ticker')) return;

    var rows = [
      ['XAUUSD', '2418.60', 0.42], ['NAS100', '19,842.5', 0.88],
      ['EURUSD', '1.0871', -0.14], ['US30', '39,118', 0.31],
      ['GBPUSD', '1.2704', -0.22], ['BTCUSD', '67,412', 1.94],
      ['SPX500', '5,431.2', 0.57], ['USDJPY', '157.44', -0.36]
    ];
    var html = rows.map(function (r) {
      var cls = r[2] >= 0 ? 'up' : 'down';
      return '<span class="m-tick-item"><b>' + r[0] + '</b>' +
             '<i>' + r[1] + '</i>' +
             '<u class="' + cls + '">' + (r[2] >= 0 ? '+' : '') + r[2] + '%</u></span>';
    }).join('');

    var bar = document.createElement('div');
    bar.id = 'm-ticker';
    bar.className = 'm-ticker';
    bar.innerHTML = '<div class="m-ticker-track">' + html + html + '</div>';
    hero.parentNode.insertBefore(bar, hero.nextSibling);
  }

  // ---- 5. Scroll progress --------------------------------------------------
  function scrollProgress() {
    var bar = document.createElement('div');
    bar.className = 'm-progress';
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? window.scrollY / max : 0) + ')';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // ---- 6. Cursor spotlight in the hero ------------------------------------
  // Pointer devices only. A soft light that follows the cursor makes the hero
  // feel like a surface rather than a flat image.
  function spotlight() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var s = document.createElement('div');
    s.className = 'm-spot';
    hero.appendChild(s);
    var tx = 0, ty = 0, cx = 0, cy = 0, running = false;

    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = e.clientX - r.left; ty = e.clientY - r.top;
      s.style.opacity = '1';
      if (!running) { running = true; requestAnimationFrame(loop); }
    });
    hero.addEventListener('mouseleave', function () { s.style.opacity = '0'; });

    function loop() {
      // Lerp rather than snapping: the lag is what makes it read as light
      // rather than as a div glued to the cursor.
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
      s.style.transform = 'translate3d(' + (cx - 260) + 'px,' + (cy - 260) + 'px,0)';
      if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) requestAnimationFrame(loop);
      else running = false;
    }
  }

  // ---- 7. Card tilt --------------------------------------------------------
  function cardTilt() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.querySelectorAll('.feature-card, .price-card').forEach(function (card) {
      card.classList.add('m-tilt');
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        // 6 degrees maximum. Beyond about 8 the text starts to distort and
        // the effect reads as a gimmick rather than depth.
        card.style.transform =
          'perspective(900px) rotateX(' + (-dy * 5).toFixed(2) + 'deg) ' +
          'rotateY(' + (dx * 6).toFixed(2) + 'deg) translateY(-5px)';
      });
      card.addEventListener('mouseleave', function () { card.style.transform = ''; });
    });
  }

  ready(function () {
    livePrice();
    rotatingWord();
    candleField();
    tickerStrip();
    scrollProgress();
    spotlight();
    cardTilt();
  });

})();

// ============================================================================
// MOTION GRAPHICS — a live chart that never stops running
//
// Replaces the parallax backdrop, which was the wrong idea: a scroll-linked
// wash behind everything is atmosphere, and atmosphere is exactly what read as
// bland. Motion graphics are different — discrete pieces that animate on their
// own timeline, in specific places, doing something recognisable.
//
// The centrepiece is a chart being drawn IN REAL TIME. New candles form at the
// right edge, the series scrolls left, and the analysis draws itself on top:
// a level gets marked, price sweeps it, a break-of-structure arrow fires, an
// order block fades in. It runs the loop the curriculum teaches, continuously.
//
// This is the honest version of what the previous layers were reaching for. A
// static chart with things drifting behind it says "trading site". A chart
// that is visibly working says "this is what we teach".
//
// PERFORMANCE. One canvas, one rAF loop, capped at 30fps — chart motion does
// not need 60, and halving the frame rate halves the cost. The loop pauses
// entirely when the canvas is off-screen, via IntersectionObserver, so it
// never burns battery animating something nobody can see.
// ============================================================================

(function () {

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var GREEN = '#03c988', RED = '#e5484d', TEAL = '#00adb5', AMBER = '#f5c542';

  function LiveChart(canvas) {
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var candles = [], step = 20, price = 0, seed = 20260826;
    var events = [];       // annotations currently on screen
    var frame = 0, visible = true, running = false;

    function rand() {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    }

    function resize() {
      W = canvas.parentNode.offsetWidth;
      H = canvas.parentNode.offsetHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!candles.length) seedSeries();
    }

    function newCandle() {
      var drift = (rand() - 0.5) * 2;
      var o = price;
      var c = o + drift * 9;
      // Occasional impulse, so the series has structure worth annotating
      // rather than being uniform noise.
      if (rand() > 0.9) c = o + (rand() - 0.5) * 42;
      return {
        o: o, c: c,
        hi: Math.min(o, c) - rand() * 8,
        lo: Math.max(o, c) + rand() * 8,
        born: frame
      };
    }

    function seedSeries() {
      candles = []; price = 0;
      var n = Math.ceil(W / step) + 4;
      for (var i = 0; i < n; i++) {
        var k = newCandle();
        candles.push(k);
        price = k.c;
      }
    }

    function pushEvent() {
      // Draws from the same vocabulary the chapters use, so the graphic is
      // teaching-adjacent rather than decorative.
      var kinds = ['level', 'sweep', 'bos', 'ob'];
      var kind = kinds[Math.floor(rand() * kinds.length)];
      events.push({ kind: kind, born: frame, life: 150,
                    idx: candles.length - 6 - Math.floor(rand() * 5) });
    }

    function y(v) {
      // Auto-scale to whatever the visible window is doing, so an impulse
      // never runs off the top and the chart always fills its band.
      var vals = [];
      for (var i = 0; i < candles.length; i++) {
        vals.push(candles[i].hi, candles[i].lo);
      }
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      var pad = (hi - lo) * 0.18 || 1;
      return H - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * H;
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (var g = 1; g < 4; g++) {
        var gy = (H / 4) * g;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // candles, oldest at the left
      for (var i = 0; i < candles.length; i++) {
        var k = candles[i];
        var cx = i * step + 10;
        if (cx > W + step) break;
        var up = k.c <= k.o;
        // The newest candle fades in rather than popping, which is what makes
        // the series read as forming instead of jumping.
        var age = Math.min(1, (frame - k.born) / 8);
        ctx.globalAlpha = 0.55 * age;
        ctx.strokeStyle = up ? GREEN : RED;
        ctx.fillStyle = up ? GREEN : RED;
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(cx, y(k.hi)); ctx.lineTo(cx, y(k.lo)); ctx.stroke();
        var top = Math.min(y(k.o), y(k.c));
        var hgt = Math.max(2, Math.abs(y(k.o) - y(k.c)));
        ctx.fillRect(cx - 6, top, 12, hgt);
      }
      ctx.globalAlpha = 1;

      // annotations
      for (var e = events.length - 1; e >= 0; e--) {
        var ev = events[e];
        var t = (frame - ev.born) / ev.life;
        if (t >= 1) { events.splice(e, 1); continue; }
        // Fade in over the first 15%, hold, fade out over the last 25%.
        var a = t < 0.15 ? t / 0.15 : (t > 0.75 ? (1 - t) / 0.25 : 1);
        var k2 = candles[ev.idx];
        if (!k2) continue;
        var ex = ev.idx * step + 10;

        ctx.globalAlpha = a;
        if (ev.kind === 'level') {
          ctx.strokeStyle = AMBER; ctx.lineWidth = 1.2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(ex - 40, y(k2.hi)); ctx.lineTo(W, y(k2.hi));
          ctx.stroke(); ctx.setLineDash([]);
          tag(ctx, 'BSL', W - 42, y(k2.hi) - 7, AMBER);
        } else if (ev.kind === 'sweep') {
          ctx.strokeStyle = AMBER; ctx.lineWidth = 1.4;
          ctx.beginPath();
          // A ring that expands outward — the visual for a level being taken.
          ctx.arc(ex, y(k2.hi), 6 + t * 26, 0, Math.PI * 2);
          ctx.globalAlpha = a * (1 - t) * 0.9;
          ctx.stroke();
          ctx.globalAlpha = a;
          tag(ctx, 'LIQ SWEEP', ex + 12, y(k2.hi) - 10, AMBER);
        } else if (ev.kind === 'bos') {
          ctx.strokeStyle = GREEN; ctx.lineWidth = 1.6;
          var x2 = ex + 60, y2 = y(k2.hi) - 26;
          ctx.beginPath(); ctx.moveTo(ex, y(k2.lo)); ctx.lineTo(x2, y2); ctx.stroke();
          var ang = Math.atan2(y2 - y(k2.lo), x2 - ex);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - 8 * Math.cos(ang - 0.4), y2 - 8 * Math.sin(ang - 0.4));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - 8 * Math.cos(ang + 0.4), y2 - 8 * Math.sin(ang + 0.4));
          ctx.stroke();
          tag(ctx, 'BOS', x2 + 6, y2 - 2, GREEN);
        } else {
          ctx.fillStyle = 'rgba(0,173,181,0.10)';
          ctx.strokeStyle = TEAL; ctx.lineWidth = 1.1;
          ctx.setLineDash([4, 3]);
          var by = Math.min(y(k2.o), y(k2.c));
          ctx.fillRect(ex - 12, by, 90, Math.max(14, Math.abs(y(k2.o) - y(k2.c))));
          ctx.strokeRect(ex - 12, by, 90, Math.max(14, Math.abs(y(k2.o) - y(k2.c))));
          ctx.setLineDash([]);
          tag(ctx, 'ORDER BLOCK', ex - 12, by - 7, TEAL);
        }
        ctx.globalAlpha = 1;
      }

      // The live price line and its dot — the element the eye locks onto.
      var last = candles[candles.length - 1];
      if (last) {
        var ly = y(last.c);
        ctx.strokeStyle = 'rgba(238,238,238,0.28)';
        ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke();
        ctx.setLineDash([]);
        var pulse = 3.5 + Math.sin(frame / 5) * 1.4;
        ctx.fillStyle = GREEN;
        ctx.beginPath(); ctx.arc(W - 14, ly, pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.28;
        ctx.beginPath(); ctx.arc(W - 14, ly, pulse * 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    function tag(c, text, x, ty, colour) {
      c.fillStyle = colour;
      c.font = 'bold 9.5px monospace';
      c.textAlign = 'left';
      c.fillText(text, x, ty);
    }

    var acc = 0, lastT = 0;
    function loop(t) {
      if (!running) return;
      requestAnimationFrame(loop);
      if (!visible) return;
      // 30fps cap. Chart motion does not need 60, and halving the rate halves
      // the cost on a page that may be open for a long time.
      acc += t - lastT; lastT = t;
      if (acc < 33) return;
      acc = 0;
      frame++;

      // New candle every ~14 frames; the series scrolls by dropping the oldest.
      if (frame % 14 === 0) {
        var k = newCandle();
        price = k.c;
        candles.push(k);
        if (candles.length > Math.ceil(W / step) + 4) candles.shift();
        for (var e = 0; e < events.length; e++) events[e].idx--;
      }
      if (frame % 150 === 40) pushEvent();
      draw();
    }

    this.start = function () {
      resize();
      window.addEventListener('resize', resize, { passive: true });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) {
          visible = en[0].isIntersecting;
        }, { threshold: 0 }).observe(canvas);
      }
      running = true; lastT = performance.now();
      requestAnimationFrame(loop);
    };
  }

  function mount() {
    var hero = document.querySelector('.hero');
    if (!hero || document.getElementById('m-live')) return;

    var band = document.createElement('div');
    band.id = 'm-live';
    band.className = 'm-live';
    band.innerHTML =
      '<div class="m-live-head">' +
        '<span class="m-live-dot"></span>' +
        '<span class="m-live-label">LIVE MARKET STRUCTURE</span>' +
        '<span class="m-live-sub">the loop this curriculum teaches, running</span>' +
      '</div>' +
      '<div class="m-live-canvas-wrap"><canvas id="m-live-canvas"></canvas></div>';

    // Directly under the hero, above the first section — the point where a
    // visitor has read the pitch and wants evidence.
    var after = document.getElementById('m-ticker') || hero;
    after.parentNode.insertBefore(band, after.nextSibling);

    new LiveChart(document.getElementById('m-live-canvas')).start();
  }

  ready(function () { setTimeout(mount, 250); });

})();
