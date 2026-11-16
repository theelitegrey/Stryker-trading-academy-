// /desktop-login: Google sign-in for the TradeZoro Windows app, opened in the member's NORMAL browser by the app
// (desktop/src/handoff.js). Google blocks sign-in inside apps, so it happens here, with the same Google account
// picker as the site, and the result goes back to the app as a one-time code:
//   1. Continue with Google -> signInWithPopup on a separate, in-memory Firebase app (this browser's own
//      TradeZoro session, if any, is left exactly as it was).
//   2. POST /api/desktop/handoff {nonce} with the ID token -> {code} (120 s, single use, bound to the nonce).
//   3. Go to http://127.0.0.1:<port>/done?code=<c> (the app's one-sign-in listener) or tradezoro://auth?code=<c>.
//      The app redeems the code and sends this tab back to /desktop-login?done=1.
// Nothing is stored in this browser; nonce and code are never logged.
(function () {
  'use strict';
  var NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var nonce = q.get('nonce') || '';
  var portStr = q.get('port') || '';
  var port = /^\d{4,5}$/.test(portStr) && Number(portStr) >= 1024 && Number(portStr) <= 65535 ? Number(portStr) : 0;
  var root = document.documentElement;

  function state(s, msg) {
    root.setAttribute('data-dl-state', s);
    document.querySelectorAll('[data-dl-show]').forEach(function (el) {
      el.hidden = el.getAttribute('data-dl-show').split(' ').indexOf(s) === -1;
    });
    document.querySelectorAll('.dl-error').forEach(function (err) { err.textContent = msg || ''; err.style.display = msg ? 'block' : 'none'; });
  }

  // Keep the nonce out of the address bar, history and any copied link once it has been read.
  if (nonce || portStr) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* old browser */ } }

  if (q.get('done') === '1') return state('done');
  if (q.get('failed') === '1') return state('invalid', "That sign-in didn't reach the app. Go back to TradeZoro and choose Continue with Google again.");
  if (window.tzDesktop) return state('inapp');   // opened inside the app itself: Google would refuse here
  if (!NONCE_RE.test(nonce)) return state('invalid', 'This sign-in link is not complete. Open the TradeZoro app and choose Continue with Google.');
  if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return state('invalid', "Couldn't load the sign-in system. Check your connection and reload this page.");

  var app = firebase.initializeApp(firebase.app().options, 'tz-desktop-handoff');
  var auth = app.auth();
  var ready = auth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(function () {});
  var code = '';

  function friendly(err) {
    var c = err && err.code;
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return 'Google sign-in was closed before finishing. Try again.';
    if (c === 'auth/popup-blocked') return 'Your browser blocked the Google window. Allow pop-ups for tradezoro.com and try again.';
    if (c === 'auth/user-disabled') return 'This account has been disabled.';
    if (c === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
    return (err && err.message) || 'Something went wrong. Try again.';
  }

  function backToApp() {
    var loop = port ? 'http://127.0.0.1:' + port + '/done?code=' + encodeURIComponent(code) : '';
    var proto = 'tradezoro://auth?code=' + encodeURIComponent(code);
    $('dl-open-app').setAttribute('href', proto);
    state('sending');
    // If the browser refuses to reach the app on 127.0.0.1, the button opens it through tradezoro:// instead.
    setTimeout(function () { if (root.getAttribute('data-dl-state') === 'sending') state('fallback'); }, 4000);
    location.href = loop || proto;
  }

  $('dl-google').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    state('start');
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    ready
      .then(function () { return auth.signInWithPopup(provider); })
      .then(function (cred) {
        state('working');
        return cred.user.getIdToken();
      })
      .then(function (idToken) {
        var req = fetch('/api/desktop/handoff', {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + idToken },
          body: JSON.stringify({ nonce: nonce })
        });
        idToken = null;
        return req;
      })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.code) { var e = new Error(j.error || 'Could not finish sign-in. Try again.'); e.server = true; throw e; }
          return j.code;
        });
      })
      .then(function (c) {
        code = c;
        auth.signOut().catch(function () {});   // the app gets its own session; nothing stays in this tab
        backToApp();
      })
      .catch(function (err) {
        btn.disabled = false;
        state('start', err && err.server ? err.message : friendly(err));
      });
  });

  state('start');
})();
