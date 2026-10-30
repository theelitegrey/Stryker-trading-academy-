// TradeZoro Creator Hub pages inside the app shell: tab-row fade edges and keeping the active tab in view.
// Works on any .cx-ltabs row, including rows that the page re-renders (MutationObserver on <main>).
(function () {
  function fade(el) {
    var max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-l', el.scrollLeft > 4);
    el.classList.toggle('fade-r', max > 4 && el.scrollLeft < max - 4);
  }
  function wire(el) {
    if (el.__cxf) { fade(el); return; }
    el.__cxf = 1;
    el.addEventListener('scroll', function () { fade(el); }, { passive: true });
    window.addEventListener('resize', function () { fade(el); }, { passive: true });
    var on = el.querySelector('.active');
    if (on) { var l = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2; el.scrollLeft = Math.max(0, l); }
    fade(el);
  }
  function scan() { document.querySelectorAll('.cx-ltabs').forEach(wire); }
  var main = document.getElementById('main');
  if (main && window.MutationObserver) new MutationObserver(scan).observe(main, { childList: true, subtree: true });
  scan();
})();
