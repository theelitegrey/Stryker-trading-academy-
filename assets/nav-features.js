/* Features mega-menu for the public marketing nav (.nav-links).
   Hovering (or keyboard-opening) "Features" shows a panel listing every
   feature; clicking "Features" still goes to /features. One data array, three
   display variants chosen by <html data-navfx="a|b|c"> (or data-navfx on this
   script tag). Under the burger breakpoint, Features gets a separate chevron
   button that expands the same list inside the burger menu.
   Lines are the approved hub-card sentences (see nav-features-menu/README.md). */
(function () {
  'use strict';

  // ---- DATA (one array; change url once a page goes live) -----------------
  var T = '/assets/images/navfx/';
  var FEATURES = [
    { id: 'gex', name: 'GEX', url: '/features/gex', icon: '📈', thumb: 'gex',
      line: 'Options gamma levels on a futures chart: call wall, put wall and zero gamma, read as context.' },
    { id: 'smd', name: 'Smart Money Desk', url: '/features/smart-money-desk', icon: '🏛️', thumb: 'smart-money-desk',
      line: 'Congress and insider filings parsed from official records, with a link to the official filing.' },
    { id: 'cur', name: 'Curriculum', url: '/features/curriculum', icon: '📚', thumb: 'curriculum',
      line: 'Ordered ICT & SMT chapters with tracked progress, so you always know what to read next.' },
    { id: 'gm', name: 'Global Monitor', url: '/features/global-monitor', icon: '🌐', thumb: 'global-monitor',
      line: 'The one-screen market context check before every session.' },
    { id: 'jr', name: 'Trade Journal', url: '/features/journal', icon: '📓', thumb: 'journal',
      line: 'Log and review your trades, with a P&L calendar, analytics, a rule-based coach and prop-firm tools.' },
    { id: 'mdl', name: 'Trading Models', url: '/features/models', icon: '📐', thumb: 'models',
      line: 'Complete rule-based models: context, trigger, invalidation and management.' },
    { id: 'ind', name: 'Private Indicators', url: '/features/indicators', icon: '📊', thumb: 'indicators',
      line: 'Five invite-only TradingView scripts, licensed to your username.' },
    { id: 'bt', name: 'Backtesting', url: '/features/backtesting', icon: '⏯️', thumb: 'backtesting',
      line: 'Replay NQ, ES, gold, forex or crypto bar by bar with the future hidden, practise with simulated orders, and review every practice session.' },
    { id: 'com', name: 'Community', url: '/features/community', icon: '🤝', thumb: 'community',
      line: 'The Trading Floor, achievements and your own invite link.' },
    { id: 'ch', name: 'Charts', url: '/features/charts', icon: '📉', thumb: 'charts',
      line: 'A full interactive charting desk with crypto market data, inside the academy.' },
    { id: 'ls', name: 'Live Sessions', url: '/features/live-sessions', icon: '🔴', thumb: 'live-sessions',
      line: 'Scheduled sessions with the desk, with a countdown in your timezone.' }
  ];
  var BIG = { gex: 1, jr: 1, mdl: 1 };       // variant C hero tiles
  var CTA = { all: '/features', start: 'signup' };

  // ---- setup ---------------------------------------------------------------
  var me = document.currentScript;
  var html = document.documentElement;
  var V = (html.getAttribute('data-navfx') || (me && me.getAttribute('data-navfx')) || 'a').toLowerCase();
  if (!/^[abc]$/.test(V)) V = 'a';
  html.setAttribute('data-navfx', V);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function img(f, w, cls) {
    return f.thumb ? '<img class="' + (cls || 'nfx-img') + '" alt="" width="' + w + '" height="' + Math.round(w * 10 / 16) +
      '" loading="lazy" decoding="async" data-src="' + T + f.thumb + '-' + w + '.webp">' : '<span class="nfx-noimg" aria-hidden="true">' + f.icon + '</span>';
  }
  function card(f, i, extra) {
    return '<a class="nfx-card' + (extra || '') + '" href="' + f.url + '" data-i="' + i + '" style="--i:' + i + '">';
  }

  function panelA() {
    var g = FEATURES[0], h = card(g, 0, ' nfx-feat') + img(g, 720) +
      '<span class="nfx-ft-txt"><b>' + g.icon + ' ' + esc(g.name) + '</b><span>' + esc(g.line) + '</span></span></a><div class="nfx-grid">';
    for (var i = 1; i < FEATURES.length; i++) {
      var f = FEATURES[i];
      h += card(f, i) + '<span class="nfx-ic" aria-hidden="true">' + f.icon + '</span><span class="nfx-tx"><b>' + esc(f.name) + '</b><span>' + esc(f.line) + '</span></span></a>';
    }
    return h + '</div><div class="nfx-strip"><a class="nfx-card nfx-all" href="' + CTA.all + '">See all features →</a>' +
      '<a class="nfx-card btn btn-primary btn-sm" href="' + CTA.start + '">Start learning</a></div>';
  }
  function panelB() {
    var l = '<div class="nfx-list" role="list">', p = '<div class="nfx-pane" aria-hidden="true">';
    FEATURES.forEach(function (f, i) {
      l += card(f, i) + '<span class="nfx-ic" aria-hidden="true">' + f.icon + '</span><b>' + esc(f.name) + '</b></a>';
      p += '<div class="nfx-slide" data-i="' + i + '">' + img(f, 720) + '<div class="nfx-cap"><b>' + esc(f.name) +
        '</b><span>' + esc(f.line) + '</span><a class="btn btn-primary btn-sm" tabindex="-1" href="' + f.url + '">Explore</a></div></div>';
    });
    return l + '<a class="nfx-card nfx-all" href="' + CTA.all + '">See all features →</a></div>' + p + '</div>';
  }
  function panelC() {
    var h = '<div class="nfx-bento">';
    FEATURES.forEach(function (f, i) {
      h += card(f, i, BIG[f.id] ? ' nfx-big' + (i === 0 ? ' nfx-hero' : '') : '') + img(f, BIG[f.id] ? 720 : 360) + '<span class="nfx-tl"><b>' + f.icon + ' ' + esc(f.name) + '</b>' +
        (BIG[f.id] ? '<span>' + esc(f.line) + '</span>' : '') + '</span></a>';
    });
    return h + '</div><div class="nfx-strip"><a class="nfx-card nfx-all" href="' + CTA.all + '">See all features →</a></div>';
  }
  function mobileList() {
    var h = '';
    FEATURES.forEach(function (f) {
      h += '<a class="nfx-m" href="' + f.url + '">' + (V === 'a' ? '<span class="nfx-ic" aria-hidden="true">' + f.icon + '</span>' : img(f, 360)) +
        '<span class="nfx-mt"><b>' + esc(f.name) + '</b>' + (V === 'b' ? '<span>' + esc(f.line) + '</span>' : '') + '</span></a>';
    });
    return h;
  }

  function init() {
    var links = document.querySelector('.nav-links'), nav = document.querySelector('.nav');
    if (!links || !nav) return;
    var link = [].filter.call(links.querySelectorAll('a'), function (a) { return a.textContent.trim() === 'Features'; })[0];
    if (!link) return;

    // Row: Features link + chevron (chevron only shows in the burger menu).
    var row = document.createElement('span'); row.className = 'nfx-row';
    link.parentNode.insertBefore(row, link); row.appendChild(link);
    var chev = document.createElement('button');
    chev.type = 'button'; chev.className = 'nfx-chev'; chev.setAttribute('aria-label', 'Show all features');
    chev.setAttribute('aria-expanded', 'false'); chev.setAttribute('aria-controls', 'nfx-mlist');
    chev.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    row.appendChild(chev);

    // Desktop panel: right after the link in DOM order (tab order), absolutely
    // positioned against the sticky .nav so it opens below the bar.
    var panel = document.createElement('div');
    panel.id = 'nfx-panel'; panel.className = 'nfx-panel nfx-' + V;
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'All features');
    panel.innerHTML = '<div class="nfx-inner">' + (V === 'b' ? panelB() : V === 'c' ? panelC() : panelA()) + '</div>';
    row.parentNode.insertBefore(panel, row.nextSibling);

    var mlist = document.createElement('div');
    mlist.id = 'nfx-mlist'; mlist.className = 'nfx-mlist nfx-m' + V; mlist.hidden = true; mlist.innerHTML = mobileList();
    panel.parentNode.insertBefore(mlist, panel.nextSibling);
    links.classList.add('nfx-has');

    link.setAttribute('aria-haspopup', 'true'); link.setAttribute('aria-expanded', 'false'); link.setAttribute('aria-controls', 'nfx-panel');

    var desk = window.matchMedia('(hover: hover) and (min-width: 901px)');
    var open = false, tOpen = 0, tClose = 0, loaded = {}, quiet = false;
    function load(root) { [].forEach.call(root.querySelectorAll('img[data-src]'), function (im) { im.src = im.getAttribute('data-src'); im.removeAttribute('data-src'); }); }
    function setOpen(v, focusLink) {
      clearTimeout(tOpen); clearTimeout(tClose);
      if (v === open) return;
      open = v;
      if (v) { if (!loaded.p) { load(panel); loaded.p = 1; } if (V === 'b') show(0); panel.style.setProperty('--nfx-top', Math.max(0, nav.getBoundingClientRect().bottom) + 'px'); }
      panel.classList.toggle('is-open', v);
      link.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (!v && focusLink) { quiet = true; link.focus(); quiet = false; }
    }
    function later(v, ms) { clearTimeout(tOpen); clearTimeout(tClose); if (v) tOpen = setTimeout(function () { setOpen(true); }, ms); else tClose = setTimeout(function () { setOpen(false); }, ms); }

    // Variant B: crossfade the preview pane to the hovered/focused item.
    var slides = panel.querySelectorAll('.nfx-slide'), cur = -1;
    function show(i) {
      if (i === cur || !slides[i]) return; cur = i;
      [].forEach.call(slides, function (s, k) { s.classList.toggle('on', k === i); });
      [].forEach.call(panel.querySelectorAll('.nfx-list .nfx-card'), function (c) { c.classList.toggle('on', +c.getAttribute('data-i') === i); });
    }
    if (V === 'b') {
      panel.addEventListener('mouseover', function (e) { var c = e.target.closest('.nfx-list .nfx-card[data-i]'); if (c) show(+c.getAttribute('data-i')); });
      panel.addEventListener('focusin', function (e) { var c = e.target.closest('.nfx-list .nfx-card[data-i]'); if (c) show(+c.getAttribute('data-i')); });
    }

    [link, panel].forEach(function (el) {
      el.addEventListener('mouseenter', function () { if (desk.matches) later(true, open ? 0 : 120); });
      el.addEventListener('mouseleave', function () { if (desk.matches) later(false, 250); });
    });
    link.addEventListener('focus', function () {
      var fv = false; try { fv = link.matches(':focus-visible'); } catch (e) {}
      if (desk.matches && fv && !quiet) setOpen(true);
    });
    link.addEventListener('keydown', function (e) {
      if (!desk.matches) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); var f = panel.querySelector('.nfx-card'); if (f) f.focus(); }
      else if (e.key === 'Enter' && !open) { e.preventDefault(); setOpen(true); }   // open; Enter again navigates
      else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false, true); }
    });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); setOpen(false, true); } });
    panel.addEventListener('focusout', function (e) {
      var to = e.relatedTarget;
      if (to && !panel.contains(to) && to !== link) setOpen(false);
    });
    link.addEventListener('blur', function (e) { var to = e.relatedTarget; if (to && !panel.contains(to)) setOpen(false); });
    document.addEventListener('pointerdown', function (e) { if (open && !panel.contains(e.target) && !row.contains(e.target)) setOpen(false); }, true);
    window.addEventListener('scroll', function () { if (open) setOpen(false); }, { passive: true });
    desk.addEventListener && desk.addEventListener('change', function () { setOpen(false); });

    // Burger accordion: the chevron toggles; the label still links to /features.
    chev.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var v = mlist.hidden;
      if (v && !loaded.m) { load(mlist); loaded.m = 1; }
      mlist.hidden = !v; chev.setAttribute('aria-expanded', v ? 'true' : 'false');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
