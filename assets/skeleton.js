// Shared skeleton loader. CSS: ".skel" block in assets/style.css.
//   skel.rows(el, n, cols)  skel.cards(el, n)  skel.lines(el, n)  skel.tiles(el, n)  skel.chart(el)  skel.clear(el)
// Or markup only: <div data-skel="rows" data-n="6" data-cols="3"></div> (also cards|lines|tiles|chart).
// A skeleton fades in after 150 ms (CSS), sets aria-busy on the container, and ends by itself the moment the
// page's own render replaces the container's children. If nothing replaces it within 15 s it becomes an
// error line with a Reload button, so it never spins forever.
(function () {
  var TIMEOUT = 15000;
  function blk(cls, extra) { return '<i class="skel ' + cls + '" aria-hidden="true"' + (extra ? ' style="' + extra + '"' : '') + '></i>'; }
  function line(w) { return blk('skel-line w' + (w || 100)); }
  var W = [80, 60, 40, 100];
  function show(el, html, lbl) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    clear(el);
    el.innerHTML = '<div class="skel-wrap"><span class="skel-sr" role="status">' + (lbl || 'Loading') + '</span>' + html + '</div>';
    var wrap = el.firstChild;
    // a markup placeholder (data-skel) is replaced wholesale, so aria-busy goes on the container that holds it
    var bz = el.hasAttribute('data-skel') && el.parentElement ? el.parentElement : el;
    bz.setAttribute('aria-busy', 'true');
    var done = function () { if (el.__skel) { clearTimeout(el.__skel.t); el.__skel.mo.disconnect(); el.__skel = null; bz.removeAttribute('aria-busy'); } };
    var mo = new MutationObserver(function () { if (wrap.parentNode !== el || !el.isConnected) done(); });
    mo.observe(el, { childList: true });
    if (el.parentNode) mo.observe(el.parentNode, { childList: true }); // placeholder itself replaced
    el.__skel = {
      mo: mo,
      t: setTimeout(function () {
        if (wrap.parentNode !== el || !el.isConnected || !el.offsetParent) return done(); // already gone/hidden by the page
        done();
        el.innerHTML = '<div class="skel-err" role="alert">Could not load this. <button type="button">Reload</button></div>';
        el.querySelector('button').onclick = function () { location.reload(); };
      }, TIMEOUT)
    };
    return el;
  }
  function clear(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    if (el.__skel) { clearTimeout(el.__skel.t); el.__skel.mo.disconnect(); el.__skel = null; }
    var w = el.querySelector(':scope > .skel-wrap'); if (w) w.remove();
    el.removeAttribute('aria-busy');
  }
  function rowsH(n, cols, h) {
    var r = '', c = '', i, j;
    for (j = 0; j < (cols || 3); j++) c += line(j ? 60 : 80);
    for (i = 0; i < (n || 6); i++) r += '<div class="skel-row" aria-hidden="true"' + (h ? ' style="height:' + h + 'px"' : '') + '>' + c + '</div>';
    return r;
  }
  function cardsH(n, h) {
    var r = '', i; h = h ? ' style="min-height:' + h + 'px"' : '';
    for (i = 0; i < (n || 3); i++) r += '<div class="skel-card" aria-hidden="true"' + h + '>' + blk('skel-title') + line(100) + line(80) + line(40) + '</div>';
    return '<div class="skel-cards">' + r + '</div>';
  }
  function linesH(n) {
    var r = '', i;
    for (i = 0; i < (n || 4); i++) r += line(W[i % 4]);
    return r;
  }
  function tilesH(n) {
    var r = '', i;
    for (i = 0; i < (n || 4); i++) r += '<div class="skel-tile" aria-hidden="true">' + line(40) + blk('skel-line w60', 'height:20px') + '</div>';
    return '<div class="skel-cards" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' + r + '</div>';
  }
  function rows(el, n, c, h) { return show(el, rowsH(n, c, h)); }
  function cards(el, n, h) { return show(el, cardsH(n, h)); }
  function lines(el, n) { return show(el, linesH(n)); }
  function tiles(el, n) { return show(el, tilesH(n)); }
  // Markup-only form for code that builds innerHTML strings: skel.html('rows', 6, 4). No aria-busy/timeout; the caller's own render replaces it.
  function html(kind, n, a, b) {
    var B = { rows: rowsH, cards: cardsH, lines: linesH, tiles: tilesH, chart: chartHtml }[kind];
    return '<div class="skel-wrap"><span class="skel-sr" role="status">Loading</span>' + B(n, a, b) + '</div>';
  }
  var BARS = [38, 52, 44, 60, 72, 58, 66, 80, 70, 62, 74, 90, 82, 68, 56, 64, 78, 86, 72, 60, 50, 58, 70, 84, 76, 66, 54, 62, 74, 88, 80, 70];
  function chartHtml() { return '<div class="skel-chart" aria-hidden="true">' + BARS.map(function (b) { return '<i style="height:' + b + '%"></i>'; }).join('') + '</div>'; }
  function chart(el) { return show(el, chartHtml(), 'Loading chart'); }
  var KINDS = { rows: rows, cards: cards, lines: lines, tiles: tiles, chart: chart };
  function auto(root) {
    (root || document).querySelectorAll('[data-skel]').forEach(function (el) {
      if (el.__skel || el.hasAttribute('data-skel-done') || el.children.length) return; // children = page already rendered
      var f = KINDS[el.getAttribute('data-skel')]; if (!f) return;
      el.setAttribute('data-skel-done', '');
      f(el, +el.getAttribute('data-n') || undefined, +el.getAttribute('data-cols') || undefined, +el.getAttribute('data-h') || undefined);
    });
  }
  window.skel = { show: show, rows: rows, cards: cards, lines: lines, tiles: tiles, chart: chart, clear: clear, html: html, auto: auto, chartHtml: chartHtml };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { auto(); }); else auto();
})();
// Overlay skeletons (.skel-ov with an empty .skel-chart) get candle silhouettes; each one also gives up after 15 s.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.skel-ov').forEach(function (o) {
    var c = o.querySelector('.skel-chart');
    if (c && !c.children.length) c.innerHTML = window.skel.chartHtml().replace(/^<div[^>]*>|<\/div>$/g, '');
    setTimeout(function () { o.remove(); }, 15000);
  });
});
// The full-page access gate (shown while auth + plan resolve) uses the same skeleton instead of the candle loader.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.access-gate-overlay .loading-state').forEach(function (ls) {
    var s = window.skel;
    ls.outerHTML = '<div class="skel-gate" role="status"><span class="skel-sr">Loading</span><div class="skel-title" aria-hidden="true"></div>' +
      s.html('tiles', 4).replace(/<span class="skel-sr"[^>]*>Loading<\/span>/, '') + '<div style="height:16px"></div>' + s.html('rows', 6, 4).replace(/<span class="skel-sr"[^>]*>Loading<\/span>/, '') + '</div>';
  });
});
