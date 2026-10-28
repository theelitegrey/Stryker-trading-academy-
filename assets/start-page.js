// TradeZoro — "Start page" preference (Owner request 2026-10-26: "Add option in
// settings to set page that will be open by default when website or app is
// logged in. Like for me, default is charts page.")
//
// One small file, loaded in <head> (sync) on: index.html, dashboard-user.html,
// login.html, signup.html, settings.html, settings-admin.html.
//
// What it does:
//  1. ENTRY REDIRECT (index.html + dashboard-user.html only). When a signed-in
//     member opens the site root or the app icon (manifest start_url =
//     /dashboard-user.html) as a fresh entry, it replaces the page with their
//     chosen start page. It decides in <head>, before the body paints, from the
//     localStorage cache only (no network), and uses location.replace so Back
//     does not bounce. It does NOTHING when:
//       - the start page is the Dashboard (the default) or unknown,
//       - the URL carries a query string (other than ?source=pwa) or a #hash
//         (a deep link, e.g. /?ref=CODE),
//       - the visit came from another page of this site (same-origin
//         referrer: the logo, the menu, the dashboard link, the login page),
//       - the tab already made its entry decision this session (sessionStorage),
//       - it is a reload or a back/forward navigation,
//       - the cache belongs to nobody signed in (stryker_nav_authed != '1').
//  2. AFTER SIGN-IN: assets/auth.js routeAfterAuth() calls
//     StrykerStartPage.pathForUser(uid) (one Firestore read, capped at 1.5 s)
//     when there is no stryker_return_to, and goes there instead of the
//     dashboard.
//  3. SETTINGS UI: if the page has #start-page-select, fills it with the pages
//     this member's plan can open, preselects their saved choice, and saves on
//     change to students/{uid}.startPage (+ the local cache), with a "Saved" tick.
//
// Storage: students/{uid}.startPage = one of the ids in PAGES below (not a
// URL). Every read goes through resolve(), an allow-list, so a bad or old
// value can never send anyone to an external or unknown address.
// localStorage 'tz_start_page' = JSON {uid, id} (cache for the head decision).
//
// Depends on (only for parts 2 and 3, looked up lazily): firebase compat,
// assets/auth.js (auth), assets/progress.js (db), assets/roles.js
// (loadPlansForRoles, loadPageAccess, getPageAccessLevel; optional).
(function () {
  'use strict';

  // id -> page. `access` is the settings/pageAccess key that gates the page
  // (plan-guard.js), null = open to every signed-in member.
  // "Paper trading" lives inside Charts (no separate page or deep link), so
  // members who want it pick Charts.
  var PAGES = [
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard-user.html', access: null },
    { id: 'charts',    label: 'ZoroCharts',    path: '/charts.html',         access: null },
    { id: 'gex',       label: 'GEX+',      path: '/gex.html',            access: null },
    { id: 'journal',   label: 'Journal',   path: '/trade-journal.html',  access: 'trade-journal' },
    { id: 'learn',     label: 'Learn',     path: '/courses.html',        access: 'curriculum' },
    { id: 'replay',    label: 'Replay',    path: '/replay.html',         access: null }
  ];
  var CACHE = 'tz_start_page';
  var ENTRY_FLAG = 'tz_entry_done';

  function find(id) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === id) return PAGES[i];
    return null;
  }
  // Allow-list lookup: only ever returns one of the fixed internal paths above.
  function resolve(id) {
    var p = (typeof id === 'string') ? find(id) : null;
    return p ? p.path : null;
  }

  function cacheGet() {
    try {
      var v = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (v && typeof v.uid === 'string' && find(v.id)) return v;
    } catch (e) {}
    return null;
  }
  function cacheSet(uid, id) {
    try {
      if (!uid) { localStorage.removeItem(CACHE); return; }
      localStorage.setItem(CACHE, JSON.stringify({ uid: uid, id: find(id) ? id : 'dashboard' }));
    } catch (e) {}
  }

  function fileName() {
    var segs = location.pathname.split('/').filter(Boolean);
    return (segs.length ? segs[segs.length - 1] : 'index').toLowerCase().replace(/\.html$/, '');
  }

  // ---- 1. Entry redirect ------------------------------------------------------
  function entryTarget() {
    var f = fileName();
    if (f !== 'index' && f !== 'dashboard-user') return null;
    var ss = null;
    try { ss = window.sessionStorage; } catch (e) {}
    try { if (ss && ss.getItem(ENTRY_FLAG)) return null; } catch (e) {}
    // From here on this tab has had its entry; nothing later redirects.
    try { if (ss) ss.setItem(ENTRY_FLAG, '1'); } catch (e) {}

    if (location.hash) return null;
    if (location.search && !/^\?source=pwa$/.test(location.search)) return null;
    try {
      if (document.referrer && new URL(document.referrer).origin === location.origin) return null;
    } catch (e) {}
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.type && nav.type !== 'navigate') return null;
    } catch (e) {}
    var authed = false;
    try { authed = localStorage.getItem('stryker_nav_authed') === '1'; } catch (e) {}
    if (!authed) return null;
    var c = cacheGet();
    if (!c || c.id === 'dashboard') return null;
    var path = resolve(c.id);
    if (!path) return null;
    var here = location.pathname.replace(/\.html$/, '');
    if (here === path.replace(/\.html$/, '')) return null;
    return path;
  }

  try {
    var target = entryTarget();
    if (target) {
      // Hide the page that is about to be replaced, so it never flashes.
      document.documentElement.style.visibility = 'hidden';
      location.replace(target);
    }
  } catch (e) {
    try { document.documentElement.style.visibility = ''; } catch (e2) {}
  }

  // ---- Firestore helpers (parts 2 and 3) ---------------------------------------
  function getDb() { return (typeof db !== 'undefined' && db) ? db : null; }
  function getAuth() { return (typeof auth !== 'undefined' && auth) ? auth : null; }

  function readSaved(uid) {
    var d = getDb();
    if (!d || !uid) return Promise.resolve(null);
    return d.collection('students').doc(uid).get().then(function (snap) {
      var id = snap.exists ? (snap.data() || {}).startPage : null;
      return find(id) ? id : 'dashboard';
    }).catch(function () { return null; });
  }

  // 2. Used by auth.js after sign-in. Resolves to an internal path, or null for
  // "the dashboard as usual". Never waits more than 1.5 s.
  function pathForUser(uid) {
    var timeout = new Promise(function (r) { setTimeout(function () { r(undefined); }, 1500); });
    return Promise.race([readSaved(uid), timeout]).then(function (id) {
      if (id === undefined || id === null) {
        // Slow or failed read: fall back to this device's cache for the same user.
        var c = cacheGet();
        id = (c && c.uid === uid) ? c.id : null;
      } else {
        cacheSet(uid, id);
      }
      try { sessionStorage.setItem(ENTRY_FLAG, '1'); } catch (e) {}
      if (!id || id === 'dashboard') return null;
      return resolve(id);
    });
  }

  // Keeps the cache in step with the account on the pages that load this file:
  // a signed-out state or another account drops it; a signed-in one refreshes it
  // (so a choice made on another device reaches this one).
  function syncCache() {
    var a = getAuth();
    if (!a) return;
    a.onAuthStateChanged(function (user) {
      if (!user) { cacheSet(null); return; }
      var c = cacheGet();
      if (c && c.uid !== user.uid) cacheSet(null);
      readSaved(user.uid).then(function (id) { if (id) cacheSet(user.uid, id); });
    });
  }

  // ---- 3. Settings UI -----------------------------------------------------------
  function allowedPages(uid) {
    var d = getDb();
    if (!d) return Promise.resolve(PAGES.slice());
    var adminP = d.collection('admins').doc(uid).get().then(function (s) { return s.exists; }).catch(function () { return false; });
    var planP = d.collection('students').doc(uid).get().then(function (s) { return s.exists ? (s.data() || {}).plan : null; }).catch(function () { return null; });
    var rolesP = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles().catch(function () {}) : Promise.resolve();
    var accessP = (typeof loadPageAccess === 'function') ? loadPageAccess() : Promise.resolve({});
    return Promise.all([adminP, planP, rolesP, accessP]).then(function (r) {
      return filterPages(r[0], r[1], r[3] || {});
    });
  }
  // The pages a member on `plan` can open, using the same rule as plan-guard.js.
  function filterPages(isAdmin, plan, access) {
    if (isAdmin) return PAGES.slice(); // admins can open every page
    return PAGES.filter(function (p) {
      if (!p.access) return true;
      if (typeof getPageAccessLevel !== 'function') return true;
      // 'view' still opens the page; only a page that would paywall is left out.
      return getPageAccessLevel(plan, access[p.access]) !== 'blocked';
    });
  }

  function initSettingsUI() {
    var sel = document.getElementById('start-page-select');
    if (!sel) return;
    var tick = document.getElementById('start-page-saved');
    var a = getAuth(), d = getDb();
    if (!a || !d) { sel.disabled = true; return; }
    var tickTimer = null;
    function showTick(text, bad) {
      if (!tick) return;
      tick.textContent = text;
      tick.classList.toggle('bad', !!bad);
      tick.hidden = false;
      clearTimeout(tickTimer);
      tickTimer = setTimeout(function () { tick.hidden = true; }, 2200);
    }
    var done = false;
    a.onAuthStateChanged(function (user) {
      if (!user || done) return;
      done = true;
      Promise.all([allowedPages(user.uid), readSaved(user.uid)]).then(function (r) {
        var list = r[0], saved = r[1] || 'dashboard';
        sel.innerHTML = '';
        list.forEach(function (p) {
          var o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.label + (p.id === 'dashboard' ? ' (default)' : '');
          sel.appendChild(o);
        });
        // A saved page this plan can no longer open shows (and acts) as Dashboard.
        sel.value = list.some(function (p) { return p.id === saved; }) ? saved : 'dashboard';
        sel.disabled = false;
        cacheSet(user.uid, sel.value);
        var last = sel.value;
        sel.addEventListener('change', function () {
          var id = sel.value;
          if (!find(id)) return;
          sel.disabled = true;
          d.collection('students').doc(user.uid).set({ startPage: id }, { merge: true }).then(function () {
            cacheSet(user.uid, id);
            last = id;
            showTick('✓ Saved');
          }).catch(function () {
            sel.value = last;
            showTick('Could not save. Try again.', true);
          }).then(function () { sel.disabled = false; });
        });
      });
    });
  }

  function onReady() {
    // auth/db are created by scripts at the end of <body>; by DOMContentLoaded
    // they exist (or never will).
    syncCache();
    initSettingsUI();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();

  window.StrykerStartPage = {
    PAGES: PAGES, resolve: resolve, pathForUser: pathForUser,
    cacheGet: cacheGet, cacheSet: cacheSet, filterPages: filterPages
  };
})();
