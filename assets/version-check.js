// Stryker Trading Academy — stale-page detector
//
// THE PROBLEM THIS SOLVES
// The ?v= scheme versions everything the HTML references, but not the HTML
// itself — pages are fetched at bare URLs like /login.html. GitHub Pages
// serves those with max-age=600, and mobile browsers routinely hold them far
// longer, so a visitor can sit on a months-old page indefinitely.
//
// This has now caused two separate incidents: a student stuck on a login page
// whose role toggle had been deleted, and an admin seeing the old flat
// sidebar after the accordion shipped. In both cases the deploy was fine and
// the browser simply never re-fetched the document.
//
// HOW IT WORKS
// Every page carries <meta name="stryker-build" content="N">. This fetches
// version.json with a cache-busting timestamp so the request can never itself
// be served from cache, compares, and reloads once if the page is behind.
//
// LOOP SAFETY MATTERS MORE THAN FRESHNESS HERE
// A reload triggered by a condition that survives the reload is an infinite
// loop that makes the site unusable. So: at most one reload per build per
// tab, recorded BEFORE reloading, and any error at all is swallowed and
// ignored. Failing to update is a minor annoyance; a reload loop is a broken
// site.

(function () {

  var STORE_PREFIX = 'stryker_reloaded_for_';

  function pageBuild() {
    var meta = document.querySelector('meta[name="stryker-build"]');
    if (!meta) return null;
    var n = parseInt(meta.getAttribute('content'), 10);
    return isNaN(n) ? null : n;
  }

  function alreadyReloadedFor(build) {
    try { return sessionStorage.getItem(STORE_PREFIX + build) === '1'; }
    catch (e) { return true; }   // no storage means no loop protection, so don't risk it
  }

  function markReloadedFor(build) {
    try { sessionStorage.setItem(STORE_PREFIX + build, '1'); return true; }
    catch (e) { return false; }  // couldn't record it, so don't reload
  }

  document.addEventListener('DOMContentLoaded', function () {
    var mine = pageBuild();
    if (mine === null) return;

    fetch('assets/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || typeof data.build !== 'number') return;
        if (data.build <= mine) return;              // current, or somehow ahead
        if (alreadyReloadedFor(data.build)) return;  // already tried for this build
        if (!markReloadedFor(data.build)) return;    // can't guarantee no loop
        // Cache-busting query on the document URL forces a genuine re-fetch;
        // location.reload(true) is deprecated and ignored by modern browsers.
        var url = new URL(window.location.href);
        url.searchParams.set('_r', String(data.build));
        window.location.replace(url.toString());
      })
      .catch(function () { /* offline or blocked — nothing to do */ });
  });

})();
