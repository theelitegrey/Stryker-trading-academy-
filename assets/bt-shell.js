/**
 * Stryker Trading Academy — Backtesting app shell
 *
 * Turns a dashboard-shell page into the backtesting "app window": the site
 * header stays (with its hamburger, which now opens the regular sidebar as a
 * drawer on every screen size), the page body gets a left app rail
 * (Dashboard · Sessions · Trades · Analytics · Replay), and content lives in
 * .bta-content. Pages opt in by loading this script; active item comes from
 * the page name and the URL hash (backtests.html#analytics).
 */
(function () {
  'use strict';
  const ITEMS = [
    ['dashboard', 'Dashboard', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>', 'backtests.html#dashboard'],
    ['sessions', 'Sessions', '<path d="M4 6h16M4 12h16M4 18h10"/>', 'backtests.html#sessions'],
    ['trades', 'Trades', '<path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h6v6"/>', 'backtests.html#trades'],
    ['analytics', 'Analytics', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 'backtests.html#analytics'],
    ['replay', 'Replay', '<circle cx="12" cy="12" r="9"/><path d="M10 8l5 4-5 4z"/>', 'replay.html']
  ];
  function activeKey() { const p = location.pathname.split('/').pop(); if (p === 'replay.html') return 'replay'; const h = (location.hash || '#dashboard').slice(1); return ITEMS.some((i) => i[0] === h) ? h : 'dashboard'; }
  function paint(rail) { const k = activeKey(); rail.querySelectorAll('[data-key]').forEach((a) => a.classList.toggle('is-on', a.dataset.key === k)); }
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('bt-app');
    const main = document.querySelector('.dash-main'); if (!main) return;
    const rail = document.createElement('nav'); rail.className = 'bta-rail'; rail.setAttribute('aria-label', 'Backtesting');
    rail.innerHTML = ITEMS.map((i) => '<a class="bta-item" data-key="' + i[0] + '" href="' + i[3] + '" title="' + i[1] + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + i[2] + '</svg><span>' + i[1] + '</span></a>').join('') +
      '<span class="bta-spacer"></span><a class="bta-item bta-exit" href="dashboard-user.html" title="Back to the academy"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg><span>Academy</span></a>';
    main.insertBefore(rail, main.firstChild);
    paint(rail); window.addEventListener('hashchange', () => paint(rail));
    // the site hamburger opens the regular sidebar as a drawer on every width
    const toggle = document.getElementById('dash-menu-toggle'), sidebar = document.querySelector('.sidebar'), backdrop = document.getElementById('dash-sidebar-backdrop');
    if (toggle && sidebar && backdrop) { toggle.addEventListener('click', () => { const open = sidebar.classList.contains('mobile-open'); if (!open) { sidebar.classList.add('mobile-open'); backdrop.classList.add('visible'); } }); backdrop.addEventListener('click', () => { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('visible'); }); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('visible'); } }); }
  });
})();
