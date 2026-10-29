// Creator Hub landing (creators.html): the CTA needs a signed-in user.
// Depends on: creator.js (CH).
(function () {
  var b = document.getElementById('cx-start');
  if (!b) return;
  b.addEventListener('click', function () {
    CH.user().then(function (u) {
      if (!u) { try { sessionStorage.setItem('stryker_return_to', '/creator-new'); } catch (e) {} location.href = '/login'; }
      else location.href = '/creator-new';
    });
  });
})();
