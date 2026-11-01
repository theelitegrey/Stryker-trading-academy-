// TradeZoro: sign-in token for the GEX+ data calls (classic script)
// GEX data is Pro only and enforced on the server (functions/api/gex/_pro.js, the recorder's GEX routes): every GEX request must carry the
// member's Firebase ID token. window.strykerGexHeaders() -> Promise<{authorization}> ({} when signed out; the server then answers 403).
// window.strykerGexWall() shows the Pro prompt in place of the GEX+ page for a member without Pro.
// Education only. Not financial advice.
(function () {
  'use strict';
  window.strykerGexHeaders = function () {
    try {
      var u = window.firebase && firebase.apps && firebase.apps.length && firebase.auth().currentUser;
      if (u) return u.getIdToken().then(function (t) { return t ? { authorization: 'Bearer ' + t } : {}; }, function () { return {}; });
    } catch (e) {}
    return Promise.resolve({});
  };
  var walled = false;
  window.strykerGexWall = function () {
    if (walled) return; walled = true;
    var shell = document.querySelector('.gex-page-shell');
    if (!shell) return;
    Array.prototype.forEach.call(shell.children, function (el) { if (!el.classList.contains('gex-head')) el.hidden = true; });
    ['gex-tabs', 'gex-dtes'].forEach(function (id) { var e = document.getElementById(id); if (e) e.hidden = true; });
    var slot = document.createElement('div'); slot.id = 'gex-pro-wall';
    if (window.strykerPlanLock) slot.appendChild(window.strykerPlanLock.card('gex', 'gex-page'));
    else slot.innerHTML = '<p class="plan-usage-note">GEX+ is part of Pro.</p>';
    shell.appendChild(slot);
  };
})();
