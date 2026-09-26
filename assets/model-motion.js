// Stryker Trading Academy — model page motion polish (model.html)
// Scroll-reveal for the article body + steps panel, per-step entrance
// animation, and a sticky step-progress pill while the Steps & criteria
// panel is on screen. Transforms and opacity only. Never touches
// #model-player-slot (setup-player.js owns its own motion).
//
// GATE-PENDING DECISION (see brief): #reader-content-wrap carries
// .gate-pending until an access decision is made (assets/style.css:
// `.reader-shell.gate-pending{ visibility:hidden; }` — note VISIBILITY,
// not display:none, so getBoundingClientRect() during gate-pending returns
// real, non-zero geometry that matches the eventual layout). Because the
// content is invisible (not merely off-screen) the whole time gate-pending
// is set, nothing has been "seen" yet no matter what a rect-based
// above/below-the-fold check reports. So this file treats geometry from
// getBoundingClientRect() at face value even while gate-pending is present:
// elements the rect says are in the initial viewport are marked shown
// immediately (no hidden frame, no animation — they simply appear already
// in their final state the instant revealModelReaderContent() lifts
// visibility, which reads as correct because the visitor never saw them
// hidden). Elements the rect says are below the fold get the hidden class
// and an observer, and only animate once actually scrolled into view later
// — always after reveal, so always genuinely off-screen when it happens.
// This is simpler and safer than trying to special-case gate-pending: it
// never hides anything that was ever painted, which is the one rule that
// actually matters here.
(function () {

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var teardownFns = [];

  function onScreen(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    return r.top < vh && r.bottom > 0;
  }

  function teardownAll() {
    teardownFns.forEach(function (fn) { try { fn(); } catch (e) {} });
    teardownFns = [];
  }

  // ---- 1 & 2. Scroll-reveal: #model-body children, the steps panel, and
  // each individual .mdl-step (with the tick badge popping in) -----------
  function setupReveals() {
    if (reduced) return; // static & visible; html.mm-rv never added

    document.documentElement.classList.add('mm-rv');

    var targets = [];

    var body = document.getElementById('model-body');
    if (body) {
      Array.prototype.forEach.call(body.children, function (el) {
        targets.push({ el: el, cls: 'mm-rise' });
      });
    }

    // The whole "Steps & criteria" panel (the .panel wrapping #model-steps)
    // rises in as one unit; each step inside it then gets its own staggered
    // entrance once the panel itself is in view.
    var stepsWrap = document.getElementById('model-steps');
    var panel = stepsWrap ? stepsWrap.closest('.panel') : null;
    if (panel) targets.push({ el: panel, cls: 'mm-rise' });

    var steps = stepsWrap ? Array.prototype.slice.call(stepsWrap.querySelectorAll('.mdl-step')) : [];
    steps.forEach(function (el, i) {
      targets.push({ el: el, cls: 'mm-step', delayIndex: i });
    });

    if (!('IntersectionObserver' in window)) {
      // No IO support: show everything at once, no gate applied beyond mm-rv.
      targets.forEach(function (t) { t.el.classList.add(t.cls, 'mm-in'); });
      return;
    }

    var toObserve = [];
    targets.forEach(function (t) {
      t.el.classList.add(t.cls);
      if (onScreen(t.el)) {
        // Already within the initial viewport rect: mark shown in the same
        // task the gate class was added, so there is never a hidden frame.
        t.el.classList.add('mm-in');
      } else {
        toObserve.push(t);
      }
    });

    if (toObserve.length === 0) return;

    // Stagger siblings inside #model-body and inside a single step group by
    // giving each a small transition-delay before triggering .mm-in.
    var bodyStagger = 0, stepStagger = 0;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var t = targets.find(function (x) { return x.el === entry.target; });
        if (!t || t.el.classList.contains('mm-in')) return;
        var delay;
        if (t.cls === 'mm-step') {
          delay = stepStagger * 0.08; stepStagger++;
        } else {
          delay = bodyStagger * 0.08; bodyStagger++;
        }
        t.el.style.transitionDelay = delay.toFixed(2) + 's';
        t.el.classList.add('mm-in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    toObserve.forEach(function (t) { io.observe(t.el); });
    teardownFns.push(function () { io.disconnect(); });
  }

  // ---- 3. Sticky step-progress pill --------------------------------------
  // "Step N of M" + a thin progress bar, visible only while the steps panel
  // (the .panel wrapping #model-steps) is on screen. Decorative: aria-hidden.
  function setupStepPill() {
    var stepsWrap = document.getElementById('model-steps');
    var panel = stepsWrap ? stepsWrap.closest('.panel') : null;
    if (!panel || !stepsWrap) return;

    var steps = Array.prototype.slice.call(stepsWrap.querySelectorAll('.mdl-step'));
    if (steps.length === 0) return;

    var pill = document.createElement('div');
    pill.className = 'mm-steppill';
    pill.setAttribute('aria-hidden', 'true');
    pill.innerHTML =
      '<span class="mm-steppill-label"></span>' +
      '<span class="mm-steppill-track"><span class="mm-steppill-bar"></span></span>';
    document.body.appendChild(pill);

    var label = pill.querySelector('.mm-steppill-label');
    var bar = pill.querySelector('.mm-steppill-bar');

    var current = 0;
    function setStep(i) {
      current = i;
      label.textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
      bar.style.transform = 'scaleX(' + ((i + 1) / steps.length) + ')';
    }
    setStep(0);

    var panelOnScreen = false;
    function refreshVisibility() {
      // Never float the pill over the paywall or before access is decided.
      var blocked = !!panel.closest('.paywall-dimmed, .gate-pending');
      pill.classList.toggle('mm-steppill-show', panelOnScreen && !blocked);
    }

    if (!('IntersectionObserver' in window)) {
      // Best-effort static fallback: never show without scroll tracking.
      teardownFns.push(function () { pill.remove(); });
      return;
    }

    var panelIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        panelOnScreen = e.isIntersecting;
        refreshVisibility();
      });
    }, { threshold: 0 });
    panelIo.observe(panel);

    // Reading-zone band across the middle of the viewport: whichever step
    // intersects that band is "current". rootMargin shrinks the observation
    // window to a horizontal strip around the vertical center.
    var stepIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var idx = steps.indexOf(e.target);
        if (idx !== -1) setStep(idx);
      });
    }, { threshold: 0, rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { stepIo.observe(s); });

    teardownFns.push(function () {
      panelIo.disconnect();
      stepIo.disconnect();
      pill.remove();
    });
  }

  function mount() {
    teardownAll();
    setupReveals();
    if (!reduced) setupStepPill(); // reduced: no sticky-pill transitions at all
  }

  document.addEventListener('stryker:model-rendered', function () {
    try { mount(); } catch (e) { console.error('Stryker: model-motion failed', e); }
  });

})();
