// Stryker Trading Academy — header account menu
// Depends on: assets/auth.js (auth), assets/progress.js (db),
//             assets/avatars.js (avatarImgHtml, resolveAvatarUrl)
//
// Replaces the bare sign-out icon in the header. Sign out was sitting at the
// same visual weight as notifications despite being the one destructive,
// irreversible action there — one mis-tap next to the bell and you are out.
// It now lives behind the avatar with Profile and Settings, which is where
// people look for it anyway.
//
// Built in JS rather than added to 33 pages of markup: the menu needs the
// signed-in user's photo and name, so it cannot be static HTML, and one
// source keeps every page identical.

(function () {

  var MENU_ID = 'account-menu';

  var ITEMS = [
    {
      href: 'profile.html',
      label: 'Profile',
      icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
    },
    {
      href: 'settings.html',
      label: 'Settings',
      icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    }
  ];

  var SIGNOUT_ICON = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>';

  function esc(s){
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function build(user, student){
    var right = document.querySelector('.topnav-right');
    if (!right || document.getElementById(MENU_ID)) return;

    // The old sign-out icon goes: it is inside this menu now, and leaving both
    // would give one action two places to live.
    var oldSignout = right.querySelector('[data-sign-out]');
    if (oldSignout) oldSignout.remove();

    var name = user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');
    var avatar = (typeof avatarImgHtml === 'function')
      ? avatarImgHtml(user.uid, name, student || {}, 34)
      : '<div class="floor-avatar" style="width:34px; height:34px;"></div>';

    var wrap = document.createElement('div');
    wrap.className = 'account-menu-wrap';
    wrap.id = MENU_ID;
    wrap.innerHTML =
      '<button type="button" class="account-trigger" id="account-trigger" ' +
        'aria-haspopup="true" aria-expanded="false" aria-label="Account menu">' +
        avatar +
      '</button>' +
      '<div class="account-panel" id="account-panel" role="menu">' +
        '<div class="account-panel-head">' +
          '<span class="account-panel-name">' + esc(name) + '</span>' +
          '<span class="account-panel-mail">' + esc(user.email || '') + '</span>' +
        '</div>' +
        ITEMS.map(function (it) {
          return '<a href="' + it.href + '" class="account-item" role="menuitem">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.9">' + it.icon + '</svg>' + it.label + '</a>';
        }).join('') +
        '<button type="button" class="account-item account-item-danger" role="menuitem" data-sign-out>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.9">' + SIGNOUT_ICON + '</svg>Sign out' +
        '</button>' +
      '</div>';

    right.appendChild(wrap);

    var trigger = document.getElementById('account-trigger');
    var panel = document.getElementById('account-panel');

    function close(){
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = wrap.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      // Close the notification panel if it is open — two overlapping dropdowns
      // in the same corner is a mess.
      var notif = document.getElementById('notif-panel');
      if (open && notif) notif.style.display = 'none';
    });

    // Clicks inside must not bubble to the document listener below, or the
    // panel would close before a link's own handler ran.
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    // auth.js binds sign-out on DOMContentLoaded, which has already passed by
    // the time this button exists, so it gets its own handler.
    wrap.querySelector('[data-sign-out]').addEventListener('click', function (e) {
      e.preventDefault();
      var bye = (typeof logActivity === 'function')
        ? logActivity('auth.logout', 'Logged out') : Promise.resolve();
      var unpush = (typeof disablePushOnSignOut === 'function')
        ? disablePushOnSignOut().catch(function () {}) : Promise.resolve();
      Promise.all([bye, unpush])
        .then(function () { return auth.signOut(); })
        .then(function () { window.location.href = 'index.html'; });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.topnav-right')) return;
    if (typeof auth === 'undefined' || !auth) return;

    var done = false;
    auth.onAuthStateChanged(function (user) {
      if (done || !user) return;
      done = true;

      // The student doc carries any custom upload or avatar seed. A failed
      // read still builds the menu — it just falls back to initials, which is
      // far better than no account menu and no way to sign out.
      db.collection('students').doc(user.uid).get()
        .then(function (doc) { build(user, doc.exists ? doc.data() : {}); })
        .catch(function () { build(user, {}); });
    });
  });

})();
