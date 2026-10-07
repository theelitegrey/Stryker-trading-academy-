// Stryker Trading Academy: homepage Platform section, bento grid (build 450)
//
// Ported from /demo-platform variation A (assets/demo-platform.js, "A bento").
//   - tile tilt + spotlight on fine pointers (rAF-throttled, transforms only)
//   - tap a tile to open the expand sheet: a dialog with the tool's screen,
//     copy, caption and link. Esc / scrim / x close it; Tab is kept inside;
//     focus returns to the tile that opened it.
//   - the hub-dot CSS loop pauses while the grid is off-screen (.hpb-off)
// prefers-reduced-motion: no tilt, instant open/close.
//
// Depends on: nothing (style.css tokens, home-platform-bento.css).
// Replaces assets/platform-desk.js on index.html (file kept, unused there).

(function () {
  'use strict';
  var grid = document.getElementById('hpb-grid');
  if (!grid) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (en) { grid.classList.toggle('hpb-off', !en.isIntersecting); });
    }, { rootMargin: '80px 0px' }).observe(grid);
  }

  var tiles = $$('.hpb-tile[data-k]', grid);
  if (fine && !reduced) {
    tiles.forEach(function (t) {
      var raf = 0, ev = null;
      t.addEventListener('pointermove', function (e) {
        ev = e;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = t.getBoundingClientRect();
          var x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
          t.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
          t.style.setProperty('--my', (y * 100).toFixed(1) + '%');
          t.style.setProperty('--ry', ((x - 0.5) * 5).toFixed(2) + 'deg');
          t.style.setProperty('--rx', ((0.5 - y) * 5).toFixed(2) + 'deg');
        });
      });
      t.addEventListener('pointerleave', function () {
        t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg');
      });
    });
  }

  var sheet = $('#hpb-sheet'), panel = sheet && $('.hpb-panel', sheet), lastHit = null, closeTimer = 0;
  if (!sheet) return;
  // keep the dialog out of any transformed ancestor so position:fixed is the viewport
  document.body.appendChild(sheet);

  function openSheet(tile, hit) {
    clearTimeout(closeTimer);
    lastHit = hit;
    $('#hpb-sheet-k').textContent = $('.hpb-top .hpb-k', tile).textContent;
    $('#hpb-sheet-title').textContent = $('.hpb-top h3', tile).textContent;
    var box = $('#hpb-sheet-img'); box.innerHTML = '';
    var img = $('.hpb-shot img', tile).cloneNode(true);
    img.removeAttribute('loading');
    box.appendChild(img);
    var chip = $('.hpb-shot .hpb-tagchip', tile);
    if (chip) box.appendChild(chip.cloneNode(true));
    var body = $('#hpb-sheet-body'); body.innerHTML = '';
    $$('.hpb-more > *', tile).forEach(function (n) { body.appendChild(n.cloneNode(true)); });
    sheet.hidden = false;
    panel.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { sheet.classList.add('open'); panel.focus(); });
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.classList.remove('open');
    document.body.style.overflow = '';
    closeTimer = setTimeout(function () { sheet.hidden = true; }, reduced ? 0 : 300);
    if (lastHit) lastHit.focus({ preventScroll: true });
  }
  tiles.forEach(function (t) {
    var hit = $('.hpb-hit', t);
    if (hit) hit.addEventListener('click', function () { openSheet(t, hit); });
  });
  $$('[data-close]', sheet).forEach(function (b) { b.addEventListener('click', closeSheet); });
  document.addEventListener('keydown', function (e) {
    if (sheet.hidden) return;
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Tab') {
      var f = $$('a[href], button', panel);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
})();
