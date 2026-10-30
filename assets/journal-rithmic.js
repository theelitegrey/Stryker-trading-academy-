// TradeZoro — JournalX: "Import from Rithmic" button + visibility switch (classic script)
// Depends on: the journal page globals (db, auth, JOURNAL_UID) and assets/rithmic-journal-ui.js (loaded on click).
// Visible only to admins, and only when settings/commerce.rithmicJournal is true or the URL has ?rjournal=1
// (the Chief of Staff flips the switch once Rithmic confirms order-history access).
(function () {
  'use strict';
  function build() { var m = document.querySelector('meta[name="stryker-build"]'); return m ? m.content : '0'; }
  function addButton(uid) {
    var anchor = document.getElementById('ji-open-btn');
    if (!anchor || document.getElementById('ji-open-rithmic')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.id = 'ji-open-rithmic'; b.textContent = 'Import from Rithmic';
    b.addEventListener('click', function () {
      b.disabled = true;
      import('./rithmic-journal-ui.js?v=' + build()).then(function (m) { return (window.strykerRithmicSaved ? window.strykerRithmicSaved.sheetHook() : Promise.resolve(null)).catch(function () { return null; }).then(function (hook) { m.openRithmicJournalImport({ uid: uid, savedLogin: hook }); }); })
        .catch(function (e) { console.error('Rithmic import failed to load', e); if (window.showToast) window.showToast('error', 'Could not open Rithmic import.'); })
        .then(function () { b.disabled = false; });
    });
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
  }
  function init() {
    if (typeof auth === 'undefined' || typeof db === 'undefined') return;
    var seen = false;
    auth.onAuthStateChanged(function (user) {
      if (!user || seen) return; seen = true;
      db.collection('admins').doc(user.uid).get().then(function (a) {
        if (!a.exists) return;
        var force = /[?&]rjournal=1\b/.test(location.search);
        if (force) return addButton(user.uid);
        return db.collection('settings').doc('commerce').get().then(function (c) {
          if (c.exists && c.data().rithmicJournal === true) addButton(user.uid);
        });
      }).catch(function () {});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
