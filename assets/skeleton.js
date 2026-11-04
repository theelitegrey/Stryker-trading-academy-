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
    var B = { profile: profileH, rows: rowsH, cards: cardsH, lines: linesH, tiles: tilesH, chart: chartHtml }[kind];
    return '<div class="skel-wrap"><span class="skel-sr" role="status">Loading</span>' + B(n, a, b) + '</div>';
  }
  var BARS = [38, 52, 44, 60, 72, 58, 66, 80, 70, 62, 74, 90, 82, 68, 56, 64, 78, 86, 72, 60, 50, 58, 70, 84, 76, 66, 54, 62, 74, 88, 80, 70];
  BARS = BARS.concat(BARS.map(function (v, i) { return Math.max(30, Math.min(92, v + ((i * 7) % 13) - 6)); }), BARS.map(function (v, i) { return Math.max(30, Math.min(92, v + ((i * 5) % 11) - 5)); }));
  function chartHtml() { return '<div class="skel-chart" aria-hidden="true">' + BARS.map(function (b) { return '<i style="height:' + b + '%"></i>'; }).join('') + '</div>'; }
  function chart(el) { return show(el, chartHtml(), 'Loading chart'); }
  function profileH() { return '<div class="skel-card" style="padding:0;overflow:hidden;margin-bottom:16px">' + blk('skel-line w100', 'height:96px;margin:0;border-radius:0') + '<div style="display:flex;gap:16px;padding:16px;align-items:center">' + blk('skel-avatar', 'width:72px;height:72px;margin-top:-48px') + '<div style="flex:1">' + line(40) + line(60) + '</div></div></div>' + tilesH(4) + '<div style="height:16px"></div>' + linesH(4); }
  var KINDS = { profile: function (el) { return show(el, profileH()); }, rows: rows, cards: cards, lines: lines, tiles: tiles, chart: chart };
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
// ---- Full-page access gate: one template per page, shaped like that page's real first screen. ----
// Pure markup; sizes live in the .sg-* rules in assets/style.css (phone and desktop differ by CSS only).
(function () {
  function b(c, st) { return '<i class="skel ' + c + '"' + (st ? ' style="' + st + '"' : '') + '></i>'; }
  function ln(w, h) { return b('skel-line', 'width:' + w + (typeof w === 'number' ? '%' : '') + ';margin:0;height:' + (h || 12) + 'px'); }
  function rep(n, f) { var o = '', i; for (i = 0; i < n; i++) o += f(i); return o; }
  function card(inner, cls, st) { return '<div class="skel-card sg-c ' + (cls || '') + '"' + (st ? ' style="' + st + '"' : '') + '>' + inner + '</div>'; }
  function top() {
    return '<div class="sg-top">' + b('sg-ib') + b('sg-logo') + '<span class="sg-sp"></span>' + b('sg-ib sg-hide-p') + b('sg-ib') + b('sg-ib') + b('skel-avatar', 'width:36px;height:36px') + '</div>' +
      '<div class="sg-pill-row">' + b('sg-pill') + '</div>';
  }
  function dock() { return '<div class="sg-dock">' + rep(5, function () { return b('sg-dk'); }) + '</div>'; }
  function head(sub) { return '<div class="sg-head">' + b('skel-title', 'width:min(220px,55%);height:28px;margin:0 0 12px') + (sub ? ln(60, 14) : '') + '</div>'; }
  function tabs(n) { return '<div class="sg-tabs">' + rep(n, function () { return b('sg-tab'); }) + '</div>'; }
  function chips(n) { return '<div class="sg-chips">' + rep(n, function (i) { return b('sg-chip', 'width:' + (72 + (i * 23) % 50) + 'px'); }) + '</div>'; }
  function trow(cols) { return '<div class="skel-row sg-tr">' + rep(cols, function (i) { return b('skel-line', 'flex:' + (i ? 1 : 2) + ' 1 0;margin:0' + (i > 1 ? ';height:12px' : '')); }) + '</div>'; }
  function table(cols, n) { return '<div class="sg-table">' + '<div class="skel-row sg-th">' + rep(cols, function (i) { return b('skel-line', 'flex:' + (i ? 1 : 2) + ' 1 0;margin:0;height:10px;opacity:.7'); }) + '</div>' + rep(n, function () { return trow(cols); }) + '</div>'; }
  // phone card-style rows: avatar + two lines + value
  function prow(n) { return '<div class="sg-prow">' + rep(n, function () { return '<div class="skel-row" style="height:60px">' + b('skel-avatar', 'width:36px;height:36px') + '<div style="flex:1;display:grid;gap:8px">' + ln(45) + ln(28, 10) + '</div>' + ln(56) + '</div>'; }) + '</div>'; }
  var T = {
    charts: function () {
      return '<div class="sg-cbar">' + b('sg-tab', 'width:96px') + rep(5, function () { return b('sg-ib sg-sm'); }) + b('sg-tab', 'width:104px') + '<span class="sg-sp"></span>' + rep(3, function () { return b('sg-ib sg-sm sg-hide-p'); }) + '</div>' +
        '<div class="sg-cmain"><div class="sg-tools sg-hide-p">' + rep(13, function () { return b('sg-ib sg-sm'); }) + '</div>' +
        '<div class="sg-chart"><div class="skel-chart" aria-hidden="true">' + BARSH() + '</div><div class="sg-axis">' + rep(8, function () { return b('skel-line', 'width:34px;height:9px;margin:0'); }) + '</div></div><div class="sg-tools sg-rail2 sg-hide-p">' + rep(6, function () { return b('sg-ib sg-sm'); }) + '</div></div>' +
        '<div class="sg-cbot sg-show-p">' + rep(5, function () { return b('sg-ib sg-sm', 'width:56px'); }) + '</div>';
    },
    dashboard: function () {
      return '<div class="sg-body">' + card(b('sg-ib sg-sm') + '<div style="flex:1;display:grid;gap:8px">' + ln(40) + ln(80, 10) + '</div>', 'sg-fx', 'min-height:72px;margin:0 0 16px') +
        '<div class="sg-hero">' + card('<div class="sg-hero-l">' + b('sg-pill', 'width:170px;margin-bottom:12px') + b('skel-title', 'width:72%;height:34px;margin:0 0 8px') + ln(60, 14) +
          '<div class="sg-tiles5">' + rep(5, function () { return b('skel-tile', 'height:76px;border-radius:12px'); }) + '</div></div><div class="sg-hero-r">' + card(ln(30, 10) + '<div class="skel-chart" aria-hidden="true" style="min-height:120px;height:140px;margin-top:8px">' + BARSH(20) + '</div>', '', 'min-height:190px;padding:12px') + '</div>', 'sg-herocard') + '</div>' +
        card(b('skel-title', 'width:150px;height:20px;margin:0 0 8px') + ln(50, 12) + b('skel-line', 'height:6px;margin:16px 0;border-radius:3px;width:100%') + rep(4, function () { return '<div class="skel-row" style="height:52px">' + b('skel-avatar', 'width:20px;height:20px') + ln(55) + '<span class="sg-sp"></span>' + b('sg-tab sg-hide-p', 'width:120px;height:32px') + '</div>'; }), '', 'margin-top:16px') + '</div>';
    },
    journal: function () {
      return '<div class="sg-body sg-rail-w"><div class="sg-rail sg-hide-p">' + rep(8, function () { return b('sg-ib'); }) + '</div><div class="sg-col">' + head(1) + b('sg-tab', 'width:130px;margin-bottom:16px') + tabs(4) +
        card(ln(30, 10) + ln(85, 14) + ln(60, 12), '', 'min-height:104px;margin:16px 0') +
        '<div class="sg-jmain">' + card(ln(25, 10) + b('skel-title', 'width:55%;height:44px;margin:16px 0') + ln(40, 10), '', 'min-height:200px') + card('<div class="skel-chart" aria-hidden="true" style="min-height:160px;height:100%">' + BARSH(14) + '</div>', 'sg-hide-p', 'min-height:200px') + '</div>' +
        '<div class="sg-stats4">' + rep(4, function () { return b('skel-tile', 'height:96px'); }) + '</div>' +
        '<div class="sg-cal">' + rep(35, function () { return b('sg-day'); }) + '</div>' +
        table(5, 5) + '</div></div>';
    },
    screener: function () {
      return '<div class="sg-body">' + head(1) + '<div class="sg-seg">' + rep(4, function () { return b('sg-segi'); }) + '</div>' + chips(10) + b('sg-input', '') + chips(5) + chips(3) +
        '<div class="sg-hide-p">' + table(9, 12) + '</div><div class="sg-show-p">' + prow(8) + '</div></div>';
    },
    gex: function () {
      return '<div class="sg-body">' + b('skel-line', 'width:120px;height:10px;margin:0 0 12px') + b('skel-title', 'width:130px;height:34px;margin:0 0 12px') + ln(70, 14) +
        '<div class="sg-chips" style="margin-top:16px">' + rep(4, function () { return b('sg-chip', 'width:92px'); }) + '</div><div class="sg-chips">' + rep(4, function () { return b('sg-chip', 'width:44px'); }) + '</div>' +
        card(b('skel-line', 'width:60%;margin:0;height:14px'), '', 'min-height:56px;margin:12px 0') + tabs(4) +
        '<div class="sg-gexg"><div class="sg-chart sg-card-ch"><div class="skel-chart" aria-hidden="true">' + BARSH() + '</div><div class="sg-axis">' + rep(8, function () { return b('skel-line', 'width:34px;height:9px;margin:0'); }) + '</div></div>' +
        card(b('skel-title', 'width:50%;height:18px;margin:0 0 8px') + rep(8, function () { return '<div class="skel-row" style="height:40px">' + ln(34) + '<span class="sg-sp"></span>' + ln(24) + '</div>'; }), 'sg-levels') + '</div></div>';
    },
    rows: function () { return '<div class="sg-body">' + head(1) + tabs(3) + '<div class="sg-hide-p">' + table(5, 9) + '</div><div class="sg-show-p">' + prow(8) + '</div></div>'; },
    tiles: function () { return '<div class="sg-body">' + head(1) + chips(6) + '<div class="sg-stats4">' + rep(4, function () { return b('skel-tile', 'height:96px'); }) + '</div><div class="sg-hide-p">' + table(5, 7) + '</div><div class="sg-show-p">' + prow(6) + '</div></div>'; },
    cards: function () { return '<div class="sg-body">' + head(1) + chips(5) + '<div class="skel-cards" style="margin-top:8px">' + rep(8, function () { return card(b('skel-title', 'width:60%;margin:0 0 12px') + ln(100) + ln(80) + ln(40), '', 'min-height:150px'); }) + '</div></div>'; },
    form: function () { return '<div class="sg-body">' + head(1) + '<div class="sg-forms">' + rep(2, function () { return card(b('skel-title', 'width:40%;height:18px;margin:0 0 16px') + rep(3, function () { return ln(30, 10) + b('sg-input', 'margin:8px 0 16px'); }), '', 'min-height:260px'); }) + '</div></div>'; },
    roadmap: function () { return '<div class="sg-body">' + head(1) + tabs(3) + '<div class="sg-cols3">' + rep(3, function () { return '<div>' + b('skel-line', 'width:40%;height:14px;margin:0 0 12px') + rep(3, function () { return card(ln(70, 14) + '<div style="height:10px"></div>' + ln(100) + ln(60), '', 'min-height:104px;margin-bottom:12px'); }) + '</div>'; }) + '</div></div>'; },
    replay: function () { return '<div class="sg-body">' + head(1) + '<div class="sg-forms">' + card(b('skel-title', 'width:45%;height:18px;margin:0 0 16px') + rep(4, function () { return ln(30, 10) + b('sg-input', 'margin:8px 0 16px'); }), '', 'min-height:340px') + '<div>' + b('skel-title', 'width:35%;height:18px;margin:0 0 12px') + rep(4, function () { return '<div class="skel-row" style="height:64px">' + b('skel-avatar', 'width:36px;height:36px') + '<div style="flex:1;display:grid;gap:8px">' + ln(50) + ln(30, 10) + '</div></div>'; }) + '</div></div></div>'; }
  };
  function BARSH(n) { return window.skel.chartHtml().replace(/^<div[^>]*>|<\/div>$/g, ''); }
  var MAP = { 'charts': 'charts', 'dashboard-user': 'dashboard', 'trade-journal': 'journal', 'scanner': 'screener', 'gex': 'gex',
    'market-stats': 'tiles', 'leaderboard': 'tiles', 'economic-calendar': 'rows', 'referrals': 'rows', 'trading-floor': 'rows', 'smart-money': 'rows', 'global-monitor': 'tiles', 'market-brief': 'rows', 'market-map': 'tiles', 'messages': 'rows', 'backtests': 'rows', 'paper-review': 'rows',
    'communities': 'cards', 'giveaways': 'cards', 'indicators': 'cards', 'models': 'cards', 'achievements': 'cards', 'creator': 'cards', 'creator-new': 'form', 'creator-admin': 'rows', 'indicator': 'form', 'model': 'form', 'chapter': 'form',
    'settings': 'form', 'partner': 'form', 'roadmap': 'roadmap', 'replay': 'replay' };
  window.skel.gate = function (name) { return (T[MAP[name]] || T.rows)(); };
  document.addEventListener('DOMContentLoaded', function () {
    var name = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '');
    document.querySelectorAll('.access-gate-overlay').forEach(function (g) {
      var ls = g.querySelector('.loading-state'); if (!ls) return;
      g.classList.add('sg-on');
      g.innerHTML = '<div class="skel-gate sg-' + (MAP[name] || 'rows') + '" role="status"><span class="skel-sr">Loading</span><div class="skel-wrap" aria-hidden="true">' + top() + window.skel.gate(name) + dock() + '</div></div>';
    });
  });
})();
