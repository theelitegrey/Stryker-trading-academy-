/**
 * Stryker Trading Academy — Trade Journal app shell
 *
 * Opens the journal as its own module, the same way assets/bt-shell.js opens
 * Backtesting: the site header stays (its hamburger opens the regular sidebar
 * as a drawer on every width), a left app rail lists the journal sections plus
 * an "Academy" exit back to the dashboard, and the content runs full width in
 * .bta-content. Sections are routed by the URL hash (trade-journal#history),
 * so deep links work and the browser Back button steps through sections.
 *
 * On phones the rail is hidden (the bottom .appnav-dock owns that edge) and
 * the existing #journal-tabs strip stays as the section switcher.
 *
 * Only wraps switchJournalTab() from journal-main.js for routing; journal data,
 * saving and analytics are untouched.
 *
 * Depends on: assets/journal-main.js (switchJournalTab, JOURNAL_TAB_RENDERERS).
 */
(function () {
  'use strict';
  const ITEMS = [
    ['dashboard', 'Dashboard', 'Trade journal', 'Private to your account — log every trade, and see exactly what\'s actually working.', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>'],
    ['add', 'Add', 'Add trade', 'Log a trade by hand; the numbers fill in as you type.', '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'],
    ['history', 'History', 'History', 'Every trade you have logged, newest first.', '<path d="M4 6h16M4 12h16M4 18h10"/>'],
    ['calendar', 'Calendar', 'Calendar', 'Your trading days at a glance.', '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'],
    ['analytics', 'Analytics', 'Analytics', 'Break your trades down by setup, session, day and instrument.', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
    ['playbook', 'Playbook', 'Playbook', 'Your strategies, their rules, and how each one is doing.', '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M20 17v4H6.5a2.5 2.5 0 0 1 0-5"/>'],
    ['ai', 'AI Coach', 'AI Coach', 'A plain-language review of your own journal.', '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'],
    ['propfirms', 'Prop firms', 'Prop firms', 'Track your evaluation and funded accounts against their rules.', '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>'],
    ['settings', 'Settings', 'Journal settings', 'Accounts, instruments, tags and imports.', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>']
  ];
  const KEYS = ITEMS.map((i) => i[0]);
  function hashTab() { const h = (location.hash || '').slice(1); return KEYS.indexOf(h) >= 0 ? h : ''; }
  let rail = null, booted = false;

  function paint(tab) {
    const it = ITEMS.find((i) => i[0] === tab) || ITEMS[0];
    if (rail) rail.querySelectorAll('[data-key]').forEach((a) => { const on = a.dataset.key === it[0]; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const t = document.getElementById('jr-title'), s = document.getElementById('jr-sub');
    if (t) t.textContent = it[2];
    if (s) s.textContent = it[3];
    document.title = (it[0] === 'dashboard' ? 'Trade Journal' : it[2] + ' · Trade Journal') + ' — Stryker Trading Academy';
  }

  // Route every tab switch (tab strip, rail, in-page buttons like "Edit" or
  // "Full report") through the hash so Back/Forward and deep links work.
  function wrap() {
    if (typeof window.switchJournalTab !== 'function' || window.switchJournalTab.__jrWrapped) return;
    const orig = window.switchJournalTab;
    const wrapped = function (tab) {
      // journal-main.js opens 'dashboard' once the data has loaded; honour a
      // deep link (trade-journal#history) instead.
      if (!booted && typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS) { booted = true; tab = hashTab() || tab; }
      if (KEYS.indexOf(tab) < 0) return orig(tab);
      orig(tab);
      paint(tab);
      if (hashTab() !== tab) {
        if (!location.hash && tab === 'dashboard') history.replaceState(null, '', '#dashboard');
        else location.hash = tab;
      }
    };
    wrapped.__jrWrapped = true;
    window.switchJournalTab = wrapped;
  }
  wrap();

  window.addEventListener('hashchange', () => {
    const t = hashTab() || 'dashboard';
    if (!booted) { paint(t); return; }   // data not loaded yet; boot will pick the hash up
    if (typeof JOURNAL_ACTIVE_TAB !== 'undefined' && JOURNAL_ACTIVE_TAB === t) { paint(t); return; }
    window.switchJournalTab(t);
  });

  document.addEventListener('DOMContentLoaded', () => {
    wrap();
    document.body.classList.add('bt-app', 'jr-app');
    const main = document.querySelector('.dash-main'); if (!main) return;
    rail = document.createElement('nav'); rail.className = 'bta-rail jr-rail'; rail.setAttribute('aria-label', 'Trade journal');
    rail.innerHTML = ITEMS.map((i) => '<a class="bta-item" data-key="' + i[0] + '" href="#' + i[0] + '" title="' + i[2] + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + i[4] + '</svg><span>' + i[1] + '</span></a>').join('') +
      '<span class="bta-spacer"></span><a class="bta-item bta-exit" href="dashboard-user.html" title="Back to the academy"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg><span>Academy</span></a>';
    main.insertBefore(rail, main.firstChild);
    paint(hashTab() || 'dashboard');
    // the site hamburger opens the regular sidebar as a drawer on every width (same as bt-shell.js)
    const toggle = document.getElementById('dash-menu-toggle'), sidebar = document.querySelector('.sidebar'), backdrop = document.getElementById('dash-sidebar-backdrop');
    if (toggle && sidebar && backdrop) { toggle.addEventListener('click', () => { if (!sidebar.classList.contains('mobile-open')) { sidebar.classList.add('mobile-open'); backdrop.classList.add('visible'); } }); backdrop.addEventListener('click', () => { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('visible'); }); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('visible'); } }); }
  });
})();
