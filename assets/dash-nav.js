// Stryker Trading Academy — app menu drawer (every dash-shell page, every width)
//
// The whole app menu lives behind the hamburger (#dash-menu-toggle) in the
// header (.mobile-topnav). There is no permanent sidebar column any more
// (Owner order 2026-10-04): each page's own <aside class="sidebar"> stays the
// single source of the menu (links, sections, active state, alert dots, lock
// badges from plan-guard.js, admin links from admin-link.js / notes-admin.js,
// the tour's targets) and style.css turns it into a slide-in drawer at all
// widths. This file only drives it: open/close, aria-expanded, scrim click,
// Escape, focus trap, body scroll lock, close on link tap.
//
// Depends on: markup #dash-menu-toggle, .sidebar, #dash-sidebar-backdrop.
// assets/tour.js adds/removes .mobile-open itself; the MutationObserver below
// keeps aria/scrim/lock state in step when it does.

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('dash-menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('dash-sidebar-backdrop');
  if (!toggleBtn || !sidebar || !backdrop) return;

  if (!sidebar.id) sidebar.id = 'dash-sidebar';
  toggleBtn.setAttribute('aria-controls', sidebar.id);
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.setAttribute('aria-label', 'Open menu');
  sidebar.setAttribute('aria-label', 'App menu');
  backdrop.setAttribute('aria-hidden', 'true');

  // Scroll lock: overflow:hidden on <html> and <body> (honoured by iOS Safari
  // 16+). The old position:fixed body trick is gone: with the drawer now
  // opening under the sticky header, a fixed body dragged that header off
  // screen whenever the page was scrolled, taking the close button with it.
  // The scrollbar's width is added back as padding so the page behind the
  // scrim does not jump sideways on desktop.
  let lastFocus = null;

  function lockPageScroll(){
    if (document.body.classList.contains('sidebar-locked')) return;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    document.documentElement.classList.add('sidebar-locked');
    document.body.classList.add('sidebar-locked');
  }

  function unlockPageScroll(){
    if (!document.body.classList.contains('sidebar-locked')) return;
    document.documentElement.classList.remove('sidebar-locked');
    document.body.classList.remove('sidebar-locked');
    document.body.style.paddingRight = '';
  }

  // The drawer opens under the header so the hamburger stays visible and
  // doubles as the close button. Header height differs per width/device, so
  // it is measured rather than hard-coded.
  const header = toggleBtn.closest('.mobile-topnav');
  function measureHeader(){
    const h = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0;
    document.documentElement.style.setProperty('--dash-head-h', h + 'px');
  }

  function isOpen(){ return sidebar.classList.contains('mobile-open'); }

  function focusables(){
    return Array.prototype.filter.call(
      sidebar.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      (el) => el.getClientRects().length > 0
    );
  }
  // The trap includes the hamburger (now the close button) as its first stop.
  function trapList(){
    return [toggleBtn].concat(focusables());
  }

  // Keeps aria, scrim and scroll lock in step with the class, whoever set it.
  function sync(){
    const open = isOpen();
    toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    toggleBtn.classList.toggle('is-open', open);
    backdrop.classList.toggle('visible', open);
    if (open) lockPageScroll(); else unlockPageScroll();
  }

  function openDrawer(){
    lastFocus = document.activeElement;
    measureHeader();
    sidebar.classList.add('mobile-open');
    sync();
    // Bring the current page's link into view inside the drawer by setting
    // the drawer's own scrollTop (scrollIntoView would scroll every ancestor).
    const active = sidebar.querySelector('.side-link.active');
    if (active) sidebar.scrollTop = Math.max(0, active.offsetTop - sidebar.clientHeight / 2);
    setTimeout(() => {
      const target = active || focusables()[0];
      if (!target) return;
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }, 30);
  }
  function closeDrawer(restoreFocus){
    if (!isOpen()) return;
    sidebar.classList.remove('mobile-open');
    sync();
    if (restoreFocus !== false) {
      const back = lastFocus && document.contains(lastFocus) && lastFocus !== document.body ? lastFocus : toggleBtn;
      try { back.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  toggleBtn.addEventListener('click', () => { isOpen() ? closeDrawer() : openDrawer(); });
  backdrop.addEventListener('click', () => closeDrawer());
  // Any click outside the drawer (e.g. the bell in the header) closes it.
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen() || sidebar.contains(e.target) || toggleBtn.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.tour-root')) return; // the tour drives the drawer itself
    closeDrawer(false);
  });
  window.addEventListener('resize', () => { if (isOpen()) measureHeader(); }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    const f = trapList();
    const first = f[0], last = f[f.length - 1];
    if (f.indexOf(document.activeElement) === -1) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Close after tapping a nav link inside the drawer. Delegated, so links
  // injected later (admin jump, quick notes) close it too. Links that only act
  // in place (href="#": sign out, quick notes, accordion toggles) are left to
  // their own handlers.
  sidebar.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href === '#' || href.indexOf('javascript:') === 0) return;
    closeDrawer(false);
  });

  // tour.js opens/closes the drawer by class; mirror that into aria + lock.
  new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });

  // Back/forward cache can restore the page with the drawer still open.
  window.addEventListener('pageshow', (e) => { if (e.persisted && isOpen()) closeDrawer(false); });
});
