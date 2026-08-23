// Stryker Trading Academy — mobile sidebar drawer (dashboard pages)

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('dash-menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('dash-sidebar-backdrop');
  if (!toggleBtn || !sidebar || !backdrop) return;

  function openDrawer(){
    sidebar.classList.add('mobile-open');
    backdrop.classList.add('visible');
  }
  function closeDrawer(){
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('visible');
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.contains('mobile-open') ? closeDrawer() : openDrawer();
  });
  backdrop.addEventListener('click', closeDrawer);

  // Close the drawer automatically after tapping a nav link inside it
  sidebar.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeDrawer);
  });
});
