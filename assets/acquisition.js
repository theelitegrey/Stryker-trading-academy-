// acquisition.js — first-touch attribution + social visit counting.
//
// Purpose
//   1. First touch: the very first time a browser lands on the site, remember
//      where it came from (utm_source / utm_medium / utm_campaign from the URL,
//      plus document.referrer) in localStorage under `stryker_acq`. Later
//      visits never overwrite it. progress.js copies it onto the student doc
//      as `acquisition` when the account is created, and checkout.js copies it
//      on a paid checkout if the account doesn't have one yet.
//   2. Visit counting: once per browser session, add 1 to aggregate counter
//      docs in `traffic/` (day total, plus per utm_source and utm_campaign
//      when present). Counts only: no user id, no IP, no cookie. The
//      Firestore rule for `traffic` only accepts +1 increments.
//   3. Cloudflare Web Analytics: dormant. When CF_BEACON_TOKEN below is set,
//      the Cloudflare beacon (cookieless) is loaded too.
//
// Dependencies: none for (1). (2) uses the Firebase compat SDK if the page
// has loaded it (window.firebase + firestore); pages without Firebase simply
// skip the counter. Loaded with `defer` on every page.
(function () {
  'use strict';
  var KEY = 'stryker_acq';
  var SESSION_KEY = 'stryker_visit_counted';
  var CF_BEACON_TOKEN = ''; // Cloudflare Web Analytics site token, when the Owner creates one.

  // Keep stored values short and plain: they end up as Firestore field
  // values (and, for the counter, as part of field names).
  function clean(v, max) {
    return String(v || '').trim().slice(0, max || 100);
  }
  function slug(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { params = null; }
  var get = function (k) { return params ? params.get(k) : null; };

  // Only a referrer from another site is interesting; internal navigation
  // (strykertrading.com -> strykertrading.com) is not a source.
  var ref = '';
  try {
    if (document.referrer) {
      var r = new URL(document.referrer);
      if (r.hostname !== window.location.hostname) ref = clean(r.origin + r.pathname, 200);
    }
  } catch (e) {}

  var touch = {
    source: clean(get('utm_source')),
    medium: clean(get('utm_medium')),
    campaign: clean(get('utm_campaign')),
    referrer: ref,
    landingPage: clean(window.location.pathname, 120),
    landedAt: new Date().toISOString()
  };

  // 1. First touch — first visit only.
  try {
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(touch));
  } catch (e) {}

  // Public getter for other scripts (progress.js / checkout.js read
  // localStorage directly too, so load order never matters).
  window.strykerAcquisition = function () {
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && typeof s === 'object' ? s : null; }
    catch (e) { return null; }
  };

  // 2. Aggregate visit counter, once per browser session. One doc per day
  // (`traffic/2026-09-23`), plus one per UTM source and campaign seen that
  // day (`traffic/2026-09-23~src~x`, `traffic/2026-09-23~cmp~launch`). Each
  // doc holds a single number, `visits`, which the Firestore rule only lets
  // go up by exactly 1. Admin-read only.
  function countVisit() {
    try { if (sessionStorage.getItem(SESSION_KEY)) return; } catch (e) { return; }
    if (!window.firebase || !firebase.apps || !firebase.apps.length || typeof firebase.firestore !== 'function') return;
    var d = new Date();
    var day = d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
    var ids = [day];
    // The session is attributed to this landing's own UTM tags; a session
    // without any only adds to the day total (direct / referral / return).
    var s = slug(touch.source), c = slug(touch.campaign);
    if (s) ids.push(day + '~src~' + s);
    if (c) ids.push(day + '~cmp~' + c);
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
    var col = firebase.firestore().collection('traffic');
    var inc = { visits: firebase.firestore.FieldValue.increment(1) };
    ids.forEach(function (id) {
      col.doc(id).set(inc, { merge: true })
        .catch(function (err) { console.warn('Stryker: visit count skipped', err && err.code); });
    });
  }

  // 3. Cloudflare Web Analytics beacon (only when a token is configured).
  function cfBeacon() {
    if (!CF_BEACON_TOKEN) return;
    var sc = document.createElement('script');
    sc.defer = true;
    sc.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    sc.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }));
    document.head.appendChild(sc);
  }

  // Deferred scripts run before DOMContentLoaded but Firebase is initialised
  // by main.js (not deferred), so it is ready by load at the latest.
  function run() { countVisit(); cfBeacon(); }
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
