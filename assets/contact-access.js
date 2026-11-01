// TradeZoro — contact audience gate.
// Keeps the external form hidden until Firebase auth has resolved. Members get
// a direct route to their private support tickets instead of the public form.
(function () {
  function reveal(user) {
    var root = document.getElementById('contact-audience');
    var publicArea = document.getElementById('contact-public');
    var memberArea = document.getElementById('contact-member');
    if (!root || !publicArea || !memberArea) return;
    publicArea.hidden = !!user;
    memberArea.hidden = !user;
    root.hidden = false;
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof auth === 'undefined' || !auth) return;
    auth.onAuthStateChanged(reveal);
  });
})();
