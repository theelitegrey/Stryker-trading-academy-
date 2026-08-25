// Stryker Trading Academy — desktop header utilities
//
// The notification bell and sign-out button live inside .mobile-topnav, which
// is display:none above 900px. So on desktop student pages there was no bell
// at all, and signing out meant finding the link buried at the bottom of the
// sidebar. The admin dashboard already solved this by hand; every student
// page still had the gap.
//
// This MOVES the existing nodes into .dash-topbar rather than cloning them.
// Cloning would duplicate #notif-bell-btn, #notif-panel, #notif-badge and
// #notif-list — notifications.js finds those by id, so a second copy would
// leave one bell permanently dead and getElementById returning whichever
// happened to come first in the document.
//
// The nodes move back on the way down to mobile, so a rotate or window resize
// doesn't strand the controls in a hidden container.

(function () {

  var DESKTOP = '(min-width:901px)';

  function ensureHost(topbar) {
    var host = topbar.querySelector('.dash-topbar-actions');
    if (host) return host;
    host = document.createElement('div');
    host.className = 'dash-topbar-actions';
    topbar.appendChild(host);
    return host;
  }

  function toDesktop() {
    var topbar = document.querySelector('.dash-topbar');
    var nav = document.querySelector('.mobile-topnav');
    if (!topbar || !nav) return;

    var host = ensureHost(topbar);
    var bell = nav.querySelector('.notif-bell-wrap');
    var signout = nav.querySelector('[data-sign-out]');

    // Order matters: bell first, then sign out, matching the mobile header.
    if (bell && bell.parentElement !== host) host.appendChild(bell);
    if (signout && signout.parentElement !== host) host.appendChild(signout);
  }

  function toMobile() {
    var nav = document.querySelector('.mobile-topnav');
    var host = document.querySelector('.dash-topbar-actions');
    if (!nav || !host) return;

    // Put them back ahead of the hamburger so the row reads bell, sign out,
    // menu — the order they were authored in.
    var menuBtn = nav.querySelector('#dash-menu-toggle');
    var group = menuBtn ? menuBtn.parentElement : nav;

    var bell = host.querySelector('.notif-bell-wrap');
    var signout = host.querySelector('[data-sign-out]');

    if (bell) group.insertBefore(bell, menuBtn || null);
    if (signout) group.insertBefore(signout, menuBtn || null);
  }

  function apply() {
    if (window.matchMedia(DESKTOP).matches) toDesktop();
    else toMobile();
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Admin pages already place their own bell in the topbar; moving a second
    // one in would put two bells side by side.
    if (document.querySelector('.dash-topbar .notif-bell-wrap')) return;
    apply();
    window.addEventListener('resize', apply);
  });

})();
