// TradeZoro Creator Hub: fills the platform legal name on static pages (Creator Rules).
// Source: settings/commerce.creatorPlatformLegalName (public read). Elements: <span data-legal-name>fallback text</span>.
// Needs: firebase app + firestore, progress.js (db). If the read fails, the printed fallback stays.
(function () {
  function put(n) { Array.prototype.forEach.call(document.querySelectorAll('[data-legal-name]'), function (e) { e.textContent = n; }); }
  try {
    db.collection('settings').doc('commerce').get().then(function (s) {
      var n = s.exists ? String(s.data().creatorPlatformLegalName || '').replace(/\s+/g, ' ').trim() : '';
      if (n && n.length <= 120) put(n);
    }).catch(function () {});
  } catch (e) {}
})();
