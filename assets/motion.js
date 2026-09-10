// Stryker Trading Academy — shared motion primitives
//
// One place for the four kinds of movement the terminal modules need, so they
// all obey the same rules and the same off switch.
//
// THE OFF SWITCH IS NOT DECORATION
//
// Everything here checks prefers-reduced-motion and, when it is set, jumps
// straight to the end state. Not a shorter animation — no animation, with the
// content fully visible. A reveal that never fires because the observer never
// ran is a blank page, so every path here ends in the visible state whether it
// animated or not.
//
// WHY NOT CSS ANIMATION ALONE
//
// Reveals and count-ups could be CSS, but two things here cannot: the FLIP
// re-sort needs measured positions, and the count-up needs the target value
// formatted the same way the static render formats it. Doing all four in one
// place keeps the timing curve and duration consistent across modules.

(function () {
  'use strict';

  // The hidden start state for a reveal is scoped to this class, which only
  // exists once this file has run. If motion.js fails to load while a
  // renderer still emits .stk-rise markup, the rows are simply visible
  // rather than permanently transparent.
  document.documentElement.classList.add('stk-motion');

  const reduced = () => window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- reveal on scroll ----------------------------------------------------

  // Adds .is-in to each element as it enters, with a stagger. The elements
  // start at .stk-rise (translated + transparent) in CSS; if this never runs,
  // the CSS fallback under .no-motion still shows them.
  function reveal(root, opts) {
    const o = opts || {};
    const sel = o.selector || '.stk-rise';
    const nodes = Array.prototype.slice.call((root || document).querySelectorAll(sel));
    if (!nodes.length) return;

    if (reduced() || !('IntersectionObserver' in window)) {
      nodes.forEach((n) => n.classList.add('is-in'));
      return;
    }

    const step = o.stagger === undefined ? 32 : o.stagger;
    const cap = o.maxStagger === undefined ? 320 : o.maxStagger;
    let seen = 0;

    const io = new IntersectionObserver((entries) => {
      // Sort by document position so a row of cards lights up left to right,
      // not in whatever order the observer happens to report them.
      entries.filter((e) => e.isIntersecting)
        .sort((a, b) => (a.target.compareDocumentPosition(b.target) & 4) ? -1 : 1)
        .forEach((e) => {
          const d = Math.min(cap, (seen++ % 12) * step);
          e.target.style.setProperty('--stk-delay', d + 'ms');
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
    }, { rootMargin: o.rootMargin || '0px 0px -8% 0px', threshold: 0.05 });

    nodes.forEach((n) => io.observe(n));

    // Anything still unrevealed after two seconds gets shown anyway. An
    // observer that never fires (a hidden ancestor, a detached subtree) must
    // not be able to hide content permanently.
    setTimeout(() => nodes.forEach((n) => n.classList.add('is-in')), 2000);
  }

  // ---- count up ------------------------------------------------------------

  // el.dataset.countTo is the target; fmt turns a number into the string the
  // static render would have produced, so the final frame is byte-identical to
  // the non-animated version.
  function countUp(el, to, fmt, ms) {
    const f = typeof fmt === 'function' ? fmt : ((v) => String(Math.round(v)));
    if (!isFinite(to)) { el.textContent = f(to); return; }
    if (reduced()) { el.textContent = f(to); return; }

    const dur = ms || 620;
    // Counting from zero is wrong for a value that can be negative: it would
    // cross zero and flip sign mid-animation. Start from the near side instead.
    const from = to < 0 ? Math.min(0, to * 1.6) : Math.max(0, to * 0.15);
    const t0 = performance.now();

    function frame(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = f(to);
    }
    requestAnimationFrame(frame);
  }

  function countAll(root, fmt) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-count-to]'), (el) => {
      countUp(el, parseFloat(el.getAttribute('data-count-to')), fmt);
    });
  }

  // ---- FLIP re-sort --------------------------------------------------------

  // Measure, mutate, measure, invert, play. Used when the market map re-ranks:
  // rows visibly travel to their new positions, so the reader can see WHICH
  // row overtook which rather than being handed a different-looking table.
  function flip(container, itemSelector, mutate, opts) {
    const o = opts || {};
    if (!container || reduced()) { mutate(); return; }

    const key = o.key || ((el) => el.getAttribute('data-flip-key'));
    const before = new Map();
    Array.prototype.forEach.call(container.querySelectorAll(itemSelector), (el) => {
      const k = key(el);
      if (k) before.set(k, el.getBoundingClientRect().top);
    });

    mutate();

    const after = Array.prototype.slice.call(container.querySelectorAll(itemSelector));
    after.forEach((el, i) => {
      const k = key(el);
      if (!before.has(k)) return;
      const dy = before.get(k) - el.getBoundingClientRect().top;
      if (!dy) return;
      el.style.transform = 'translateY(' + dy + 'px)';
      el.style.transition = 'none';
      // Long lists would animate hundreds of rows at once; cap the stagger so
      // the whole re-sort still lands inside half a second.
      const delay = Math.min(160, i * 6);
      requestAnimationFrame(() => {
        el.style.transition = 'transform 460ms cubic-bezier(.22,1,.36,1) ' + delay + 'ms';
        el.style.transform = '';
        setTimeout(() => { el.style.transition = ''; }, 700 + delay);
      });
    });
  }

  // ---- draw an SVG path ----------------------------------------------------

  function drawPath(path, ms, delay) {
    if (!path || typeof path.getTotalLength !== 'function') return;
    if (reduced()) return;
    let len = 0;
    try { len = path.getTotalLength(); } catch (e) { return; }
    if (!len) return;
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    path.style.transition = 'stroke-dashoffset ' + (ms || 900) + 'ms ease-out ' + (delay || 0) + 'ms';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      path.style.strokeDashoffset = '0';
      setTimeout(() => {
        // Clear the dash properties afterwards so a dashed stroke defined in
        // CSS (the month-ago curve) is not permanently overridden by a solid one.
        path.style.strokeDasharray = '';
        path.style.strokeDashoffset = '';
        path.style.transition = '';
      }, (ms || 900) + (delay || 0) + 60);
    }));
  }

  // ---- grow a bar ----------------------------------------------------------

  function growBars(root, sel) {
    const nodes = Array.prototype.slice.call((root || document).querySelectorAll(sel || '[data-grow-to]'));
    nodes.forEach((el, i) => {
      const to = el.getAttribute('data-grow-to');
      if (reduced()) { el.style.width = to; return; }
      el.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = 'width 700ms cubic-bezier(.22,1,.36,1) ' + Math.min(300, i * 40) + 'ms';
        el.style.width = to;
      }));
    });
  }

  window.stkMotion = {
    reduced: reduced,
    reveal: reveal,
    countUp: countUp,
    countAll: countAll,
    flip: flip,
    drawPath: drawPath,
    growBars: growBars
  };
})();
