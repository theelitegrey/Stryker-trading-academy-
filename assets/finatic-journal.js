// TradeZoro — JournalX: admin-only "Broker sync (beta)" button (classic script). Hidden for everyone but admins (admins/{uid} doc);
// the server (functions/connect/finatic/*) re-checks admin on every call, so this is only the visibility switch.
(function () {
  'use strict';
  function build() { var m = document.querySelector('meta[name="stryker-build"]'); return m ? m.content : '0'; }
  function addButton(uid) {
    var anchor = document.getElementById('ji-open-rithmic') || document.getElementById('ji-open-btn');
    if (!anchor || document.getElementById('ji-open-broker')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.id = 'ji-open-broker'; b.textContent = 'Broker sync (beta)';
    b.addEventListener('click', function () {
      b.disabled = true;
      import('./finatic-journal-ui.js?v=' + build()).then(function (m) { m.openBrokerSync({ uid: uid }); })
        .catch(function (e) { console.error('Broker sync failed to load', e); if (window.showToast) window.showToast('error', 'Could not open broker sync.'); })
        .then(function () { b.disabled = false; });
    });
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
  }
  function init() {
    if (typeof auth === 'undefined' || typeof db === 'undefined') return;
    var seen = false;
    auth.onAuthStateChanged(function (user) {
      if (!user || seen) return; seen = true;
      db.collection('admins').doc(user.uid).get().then(function (a) { if (a.exists) addButton(user.uid); }).catch(function () {});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
