// Stryker Trading Academy — mobile sidebar drawer (dashboard pages)

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('dash-menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('dash-sidebar-backdrop');
  if (!toggleBtn || !sidebar || !backdrop) return;

  // Scroll position is captured and restored by hand because position:fixed
  // on the body is what actually stops iOS Safari scrolling behind the drawer
  // — overflow:hidden alone it ignores. The side effect is that the page jumps
  // to the top, hence saving and putting back the offset on close.
  let lockedScrollY = 0;

  function lockPageScroll(){
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + lockedScrollY + 'px';
    document.body.style.width = '100%';
    document.body.classList.add('sidebar-locked');
  }

  function unlockPageScroll(){
    document.body.classList.remove('sidebar-locked');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, lockedScrollY);
  }

  function openDrawer(){
    sidebar.classList.add('mobile-open');
    backdrop.classList.add('visible');
    // Only lock on the breakpoint where the sidebar is an overlay. On desktop
    // it's part of the layout and locking the page would be wrong.
    if (window.matchMedia('(max-width:900px)').matches) lockPageScroll();
  }
  function closeDrawer(){
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('visible');
    if (document.body.classList.contains('sidebar-locked')) unlockPageScroll();
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.contains('mobile-open') ? closeDrawer() : openDrawer();
  });
  backdrop.addEventListener('click', closeDrawer);

  // Close the drawer automatically after tapping a nav link inside it
  sidebar.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeDrawer);
  });

  // Rotating the phone past the breakpoint with the drawer open would leave
  // the body stuck fixed with no visible drawer to close.
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width:900px)').matches && document.body.classList.contains('sidebar-locked')) {
      closeDrawer();
    }
  });
});
