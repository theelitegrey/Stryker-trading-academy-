/* Features hero menu (bento) for the public marketing nav (.nav-links).
   Hover or keyboard focus on "Features" opens a panel with every live feature;
   clicking "Features" still goes to /features. In the burger menu (<=900px) a
   separate chevron button expands the same list as an accordion.
   Depends on: assets/nav-features.css; a page with .nav and a .nav-links
   "Features" link (all marketing pages). FEATURES is the single list; it must
   match features/*.html (tools/check.py enforces this). Lines are the approved
   hub-card sentences from features.html. */
(function () {
  'use strict';

  var T = '/assets/images/navfx/';
  var FEATURES = [
    { id: 'gex', name: 'GEX', url: '/features/gex', icon: '📈', big: 1,
      line: 'Options gamma levels on a futures chart: call wall, put wall and zero gamma, read as context.' },
    { id: 'smart-money-desk', name: 'Smart Money Desk', url: '/features/smart-money-desk', icon: '🏛️' },
    { id: 'curriculum', name: 'Curriculum', url: '/features/curriculum', icon: '📚' },
    { id: 'global-monitor', name: 'Global Monitor', url: '/features/global-monitor', icon: '🌐' },
    { id: 'journal', name: 'Trade Journal', url: '/features/journal', icon: '📓', big: 1 },
    { id: 'models', name: 'Trading Models', url: '/features/models', icon: '📐', big: 1 },
    { id: 'indicators', name: 'Private Indicators', url: '/features/indicators', icon: '📊' },
    { id: 'backtesting', name: 'Backtesting', url: '/features/backtesting', icon: '⏯️' },
    { id: 'community', name: 'Community', url: '/features/community', icon: '🤝' },
    { id: 'charts', name: 'Charts', url: '/features/charts', icon: '📉' },
    { id: 'live-sessions', name: 'Live Sessions', url: '/features/live-sessions', icon: '🔴' }
  ];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function img(f, w) {
    return '<img class="nfx-img" alt="" width="' + w + '" height="' + Math.round(w * 10 / 16) +
      '" loading="lazy" decoding="async" data-src="' + T + f.id + '-' + w + '.webp">';
  }
  function panelHtml() {
    var h = '<div class="nfx-bento">';
    FEATURES.forEach(function (f, i) {
      h += '<a class="nfx-card' + (f.big ? ' nfx-big' + (i === 0 ? ' nfx-hero' : '') : '') + '" href="' + f.url + '" style="--i:' + i + '">' +
        img(f, f.big ? 720 : 360) + '<span class="nfx-tl"><b>' + f.icon + ' ' + esc(f.name) + '</b>' +
        (f.line ? '<span>' + esc(f.line) + '</span>' : '') + '</span></a>';
    });
    return h + '</div><div class="nfx-strip"><a class="nfx-all" href="/features">See all features →</a></div>';
  }
  function mobileHtml() {
    return FEATURES.map(function (f) {
      return '<a class="nfx-m" href="' + f.url + '">' + img(f, 360) + '<span class="nfx-mt"><b>' + esc(f.name) + '</b></span></a>';
    }).join('');
  }

  function init() {
    var links = document.querySelector('.nav-links'), nav = document.querySelector('.nav');
    if (!links || !nav || links.classList.contains('nfx-has')) return;
    var link = [].filter.call(links.querySelectorAll('a'), function (a) { return a.textContent.trim() === 'Features'; })[0];
    if (!link) return;

    var row = document.createElement('span'); row.className = 'nfx-row';
    link.parentNode.insertBefore(row, link); row.appendChild(link);
    var chev = document.createElement('button');
    chev.type = 'button'; chev.className = 'nfx-chev'; chev.setAttribute('aria-label', 'Show all features');
    chev.setAttribute('aria-expanded', 'false'); chev.setAttribute('aria-controls', 'nfx-mlist');
    chev.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    row.appendChild(chev);

    // Panel sits right after the link in DOM order (tab order) and is
    // absolutely positioned against the sticky .nav so it opens below the bar.
    var panel = document.createElement('div');
    panel.id = 'nfx-panel'; panel.className = 'nfx-panel';
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'All features');
    panel.innerHTML = '<div class="nfx-inner">' + panelHtml() + '</div>';
    row.parentNode.insertBefore(panel, row.nextSibling);

    var mlist = document.createElement('div');
    mlist.id = 'nfx-mlist'; mlist.className = 'nfx-mlist'; mlist.hidden = true; mlist.innerHTML = mobileHtml();
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
      if (v) { if (!loaded.p) { load(panel); loaded.p = 1; } panel.style.setProperty('--nfx-top', Math.max(0, nav.getBoundingClientRect().bottom) + 'px'); }
      panel.classList.toggle('is-open', v);
      link.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (!v && focusLink) { quiet = true; link.focus(); quiet = false; }
    }
    function later(v, ms) { clearTimeout(tOpen); clearTimeout(tClose); if (v) tOpen = setTimeout(function () { setOpen(true); }, ms); else tClose = setTimeout(function () { setOpen(false); }, ms); }

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
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); var f = panel.querySelector('a'); if (f) f.focus(); }
      else if (e.key === 'Enter' && !open) { e.preventDefault(); setOpen(true); }   // open; Enter again navigates
      else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false, true); }
    });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); setOpen(false, true); } });
    panel.addEventListener('focusout', function (e) { var to = e.relatedTarget; if (to && !panel.contains(to) && to !== link) setOpen(false); });
    link.addEventListener('blur', function (e) { var to = e.relatedTarget; if (to && !panel.contains(to)) setOpen(false); });
    document.addEventListener('pointerdown', function (e) { if (open && !panel.contains(e.target) && !row.contains(e.target)) setOpen(false); }, true);
    window.addEventListener('scroll', function () { if (open) setOpen(false); }, { passive: true });
    if (desk.addEventListener) desk.addEventListener('change', function () { setOpen(false); });

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
