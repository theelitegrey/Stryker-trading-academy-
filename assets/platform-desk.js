// Stryker Trading Academy — homepage platform desk (index.html#platform)
//
// Drives the tabbed "desk" that replaced the Ferris wheel: six tool tabs on
// the left, one stage on the right. Only one tool is visible at a time, so
// the stage advances by itself until the visitor shows any intent — a
// click, a keypress on the tabs, or a touch — after which it stays put.
// Hovering pauses the countdown without stopping it, because a hover is
// curiosity, not a decision.
//
// The progress bar under the active tab runs on a CSS animation whose
// duration is the same interval used here (--desk-ms), so what the visitor
// sees filling up is exactly the time left before the switch.
//
// Restarting the entrance animations on every switch: toggling .on off and
// back on within one frame does not restart CSS animations. Removing the
// class, forcing a reflow with offsetWidth, then adding it does.
//
// prefers-reduced-motion: no autoplay at all. The tabs still work.
//
// Keeping the active tab visible on phones scrolls the tab strip itself and
// never scrollIntoView, which would drag the whole desk sideways behind its
// hidden overflow and clip the pane. See centreTab().

(function () {
  var desk = document.getElementById('plat-desk');
  if (!desk) return;

  var tabs  = Array.prototype.slice.call(desk.querySelectorAll('.desk-tab'));
  var panes = Array.prototype.slice.call(desk.querySelectorAll('.desk-pane'));
  var nav   = desk.querySelector('.desk-nav');
  if (!tabs.length || tabs.length !== panes.length) return;

  var reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var interval = parseInt(desk.getAttribute('data-autoplay'), 10) || 5200;
  var current  = 0;
  var timer    = null;
  var stopped  = reduced;   // true once the visitor has interacted
  var paused   = false;     // hover
  var inView   = false;     // only run while on screen

  desk.style.setProperty('--desk-ms', interval + 'ms');

  function restartAnimations(el) {
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  function show(i) {
    i = (i + tabs.length) % tabs.length;
    if (i === current && panes[i].classList.contains('on')) {
      restartAnimations(panes[i]);
      restartAnimations(tabs[i]);
      return;
    }
    tabs[current].classList.remove('on');
    tabs[current].setAttribute('aria-selected', 'false');
    tabs[current].setAttribute('tabindex', '-1');
    panes[current].classList.remove('on');
    current = i;
    tabs[i].setAttribute('aria-selected', 'true');
    tabs[i].removeAttribute('tabindex');
    restartAnimations(tabs[i]);
    restartAnimations(panes[i]);
    // On the phone the tabs are a horizontal strip; keep the active one visible.
    centreTab(tabs[i]);
  }

  // scrollIntoView() walks up and scrolls EVERY scrollable ancestor, so if the
  // page is still smooth-scrolling towards the section when a tab is tapped,
  // it also shifts #plat-desk itself sideways. The desk is overflow-x:hidden,
  // so that shift clips the pane's heading, copy and call to action off the
  // left edge with no way to scroll them back. Scroll the strip and nothing
  // else: set scrollLeft on the strip directly.
  function centreTab(tab) {
    if (!nav || window.innerWidth > 940) return;
    var max = nav.scrollWidth - nav.clientWidth;
    if (max <= 0) return;
    var target = tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2;
    target = Math.max(0, Math.min(target, max));
    if (reduced || typeof nav.scrollTo !== 'function') nav.scrollLeft = target;
    else nav.scrollTo({ left: target, behavior: 'smooth' });
    markOverflow();
  }

  // Only about one and a half tabs fit on a phone, so the strip reads as a short
  // row rather than something that scrolls. Mark which side still has tabs
  // beyond the edge and let the stylesheet fade that side. Toggling classes
  // rather than writing styles keeps the appearance entirely in the CSS.
  function markOverflow() {
    if (!nav) return;
    var max = nav.scrollWidth - nav.clientWidth;
    var scrollable = max > 1 && window.innerWidth <= 940;
    nav.classList.toggle('has-before', scrollable && nav.scrollLeft > 1);
    nav.classList.toggle('has-after', scrollable && nav.scrollLeft < max - 1);
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || paused || !inView) return;
    timer = setTimeout(function () { show(current + 1); schedule(); }, interval);
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    desk.classList.add('is-stopped');
  }

  tabs.forEach(function (tab, i) {
    if (i !== 0) tab.setAttribute('tabindex', '-1');
    tab.addEventListener('click', function () { stop(); show(i); });
    tab.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
            : e.key === 'ArrowUp'   || e.key === 'ArrowLeft'  ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      stop();
      show(current + d);
      tabs[current].focus();
    });
  });

  desk.addEventListener('mouseenter', function () {
    paused = true; desk.classList.add('is-paused'); clearTimeout(timer);
  });
  desk.addEventListener('mouseleave', function () {
    paused = false; desk.classList.remove('is-paused');
    // resume with a fresh bar rather than an unknown remainder
    if (!stopped) { restartAnimations(tabs[current]); schedule(); }
  });
  desk.addEventListener('touchstart', stop, { passive: true });

  // Swipe between panes on touch screens.
  var tx = null;
  desk.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
  desk.addEventListener('touchend', function (e) {
    if (tx === null) return;
    var dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) < 48) return;
    show(current + (dx < 0 ? 1 : -1));
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      if (inView) { if (!stopped) restartAnimations(tabs[current]); schedule(); }
      else clearTimeout(timer);
    }, { threshold: 0.35 }).observe(desk);
  } else {
    inView = true;
    schedule();
  }

  if (reduced) desk.classList.add('is-stopped');

  // Keep the edge fade honest: after a manual scroll, on resize, and once at
  // startup. Passive listener so it never delays the scroll itself.
  if (nav) {
    nav.addEventListener('scroll', markOverflow, { passive: true });
    window.addEventListener('resize', markOverflow);
    markOverflow();
  }
})();
