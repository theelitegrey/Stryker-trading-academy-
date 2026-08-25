// Stryker Trading Academy — admin sidebar accordion
// Loaded on admin pages only.
//
// The Manage section had grown to thirteen links, which on a phone meant the
// nav no longer fit and the useful items were below the fold. These are now
// four collapsible groups: People, Content, Commerce, System.
//
// The group containing the current page is marked .open in the HTML at build
// time rather than being opened by script. That matters: opening it in JS
// would mean a visible flash of every group collapsed before the right one
// expanded, on every single page load.
//
// Open state is remembered in sessionStorage so a group you expanded stays
// expanded as you move between pages — but the current page's own group is
// always forced open regardless, since collapsing the section you're inside
// makes the highlight vanish.

(function () {

  var STORE_KEY = 'stryker_admin_nav_open';

  function readOpen() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeOpen(keys) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(keys)); } catch (e) {}
  }

  function currentOpenKeys() {
    var keys = [];
    document.querySelectorAll('.side-group.open').forEach(function (g) {
      var k = g.getAttribute('data-group');
      if (k) keys.push(k);
    });
    return keys;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var groups = document.querySelectorAll('.side-group');
    if (!groups.length) return;

    // Restore remembered state, but never close the group holding the active
    // link — the server-rendered .open on that one wins.
    var remembered = readOpen();
    if (remembered) {
      groups.forEach(function (g) {
        var key = g.getAttribute('data-group');
        var hasActive = !!g.querySelector('.side-link.active');
        if (hasActive) return;
        var shouldOpen = remembered.indexOf(key) !== -1;
        g.classList.toggle('open', shouldOpen);
        var head = g.querySelector('.side-group-head');
        if (head) head.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      });
    }

    groups.forEach(function (g) {
      var head = g.querySelector('.side-group-head');
      if (!head) return;
      head.addEventListener('click', function () {
        var nowOpen = !g.classList.contains('open');
        g.classList.toggle('open', nowOpen);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        writeOpen(currentOpenKeys());
      });
    });
  });

})();
