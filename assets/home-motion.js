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
