// TradeZoro: sign-in token for the GEX+ data calls (classic script)
// GEX data needs a signed-in member (free since 2026-11-04), enforced on the server (functions/api/gex/_pro.js, the recorder's GEX routes): every GEX request must carry the
// member's Firebase ID token. window.strykerGexHeaders() -> Promise<{authorization}> ({} when signed out; the server then answers 403).
// window.strykerGexWall() shows a "Sign in to use GEX+" prompt in place of the GEX+ page (GEX+ is free for signed-in members, 2026-11-04).
// Education only. Not financial advice.
(function () {
  'use strict';
  // Wait for Firebase to restore the signed-in member before the first GEX call. Without this, the page's first
  // request (fired on DOMContentLoaded) went out with no token, the server answered 403 and a Pro member saw the Pro wall.
  var authReady = null;
  function whenAuthReady() {
    if (authReady) return authReady;
    authReady = new Promise(function (resolve) {
      var done = false, finish = function () { if (!done) { done = true; resolve(); } };
      var tries = 0;
      (function hook() {
        try {
          if (window.firebase && firebase.apps && firebase.apps.length) {
            var off = firebase.auth().onAuthStateChanged(function () { try { off(); } catch (e) {} finish(); });
            return;
          }
        } catch (e) {}
        if (++tries > 50) return finish();          // Firebase never initialised: carry on signed out
        setTimeout(hook, 100);
      })();
      setTimeout(finish, 6000);                    // never hang the page
    });
    return authReady;
  }
  window.strykerGexHeaders = function () {
    return whenAuthReady().then(function () {
      try {
        var u = window.firebase && firebase.apps && firebase.apps.length && firebase.auth().currentUser;
        if (u) return u.getIdToken().then(function (t) { return t ? { authorization: 'Bearer ' + t } : {}; }, function () { return {}; });
      } catch (e) {}
      return {};
    });
  };
  var walled = false, hidByWall = [];
  window.strykerGexWall = function () {
    if (walled) return; walled = true;
    var shell = document.querySelector('.gex-page-shell');
    if (!shell) return;
    hidByWall = [];
    Array.prototype.forEach.call(shell.children, function (el) { if (!el.classList.contains('gex-head') && !el.hidden) { el.hidden = true; hidByWall.push(el); } });
    ['gex-tabs', 'gex-dtes'].forEach(function (id) { var e = document.getElementById(id); if (e && !e.hidden) { e.hidden = true; hidByWall.push(e); } });
    var slot = document.createElement('div'); slot.id = 'gex-pro-wall';
    slot.innerHTML = '<div class="plan-lock-card"><h3 class="plan-lock-title">Sign in to use GEX+</h3><p class="plan-usage-note">GEX+ is free for every member. Sign in or create a free account to see it.</p>' +
      '<p><a class="btn btn-primary" href="login.html?next=' + encodeURIComponent(location.pathname + location.search) + '">Sign in</a></p><p class="plan-usage-note">Education only. Not financial advice.</p></div>';
    shell.appendChild(slot);
  };
  // A later GEX call succeeded (e.g. the member signed in after the page opened): take the wall down again.
  window.strykerGexUnwall = function () {
    if (!walled) return; walled = false;
    var w = document.getElementById('gex-pro-wall'); if (w) w.remove();
    hidByWall.forEach(function (el) { el.hidden = false; }); hidByWall = [];
  };
})();
