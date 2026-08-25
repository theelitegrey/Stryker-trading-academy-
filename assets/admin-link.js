// Stryker Trading Academy — "Admin dashboard" entry point on student pages
// Depends on: assets/auth.js (auth), assets/progress.js (db)
//
// The login page no longer asks who you are — everyone signs in as a student
// and lands on dashboard-user.html. Admins instead get an extra way through
// to the admin suite, revealed here once we've confirmed an /admins/{uid}
// document actually exists for them.
//
// This is presentation only. Hiding a link is not access control: the real
// boundary is the Firestore rules plus guardAdminPage() in admin-guard.js,
// which run regardless of whether this link was ever rendered. Someone who
// types the admin URL directly still gets bounced by those.

(function () {

  var SHIELD_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l8 3.5v6c0 4.7-3.4 8.9-8 10.5-4.6-1.6-8-5.8-8-10.5v-6z"/><path d="M9 12l2 2 4-4"/></svg>';

  function buildSidebarEntry() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('admin-jump-side')) return;

    var brand = sidebar.querySelector('.brand');
    var section = document.createElement('div');
    section.className = 'side-section';
    section.innerHTML =
      '<div class="side-label">Staff</div>' +
      '<a href="dashboard-admin.html" class="side-link admin-jump" id="admin-jump-side">' +
      SHIELD_SVG + 'Admin dashboard</a>';

    // Sits directly under the logo, above "Learn" — it's a context switch out
    // of the student area, not another student destination.
    if (brand && brand.nextSibling) {
      sidebar.insertBefore(section, brand.nextSibling);
    } else {
      sidebar.insertBefore(section, sidebar.firstChild);
    }
  }

  function buildTopbarEntry() {
    // The mobile header is icon-only and already tight (bell + sign out +
    // menu), so this goes in as a matching icon button rather than a labelled
    // one. title/aria-label carry the meaning.
    var bell = document.querySelector('.mobile-topnav .notif-bell-wrap');
    if (!bell || !bell.parentElement) return;
    if (document.getElementById('admin-jump-top')) return;

    var a = document.createElement('a');
    a.href = 'dashboard-admin.html';
    a.id = 'admin-jump-top';
    a.className = 'icon-btn admin-jump-icon';
    a.setAttribute('aria-label', 'Admin dashboard');
    a.setAttribute('title', 'Admin dashboard');
    a.innerHTML = SHIELD_SVG;
    bell.parentElement.insertBefore(a, bell);
  }

  function reveal() {
    buildSidebarEntry();
    buildTopbarEntry();
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof auth === 'undefined' || !auth) return;

    var checked = false;
    auth.onAuthStateChanged(function (user) {
      if (checked || !user) return;
      checked = true;

      if (typeof db === 'undefined' || !db) return;

      db.collection('admins').doc(user.uid).get()
        .then(function (doc) {
          if (doc.exists) reveal();
        })
        .catch(function (err) {
          // A failed lookup simply means no link. Students massively outnumber
          // admins, so failing closed here is both safer and less confusing
          // than showing an entry point that would bounce them straight back.
          console.warn('Stryker: admin link check failed', err);
        });
    });
  });

})();
