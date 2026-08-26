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
    var nav = document.querySelector('.site-nav') || document.querySelector('nav');
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
