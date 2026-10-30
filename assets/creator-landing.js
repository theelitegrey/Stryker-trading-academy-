// Creator Hub landing (/creators): the "Start your community" buttons need a signed-in user.
// Signed out -> sign-up, then back to the start flow (auth.js reads stryker_return_to). Signed in -> the start flow.
// Without JS the buttons are plain links to /signup.
// Depends on: creator.js (CH).
(function () {
  var btns = document.querySelectorAll('[data-cl-start], #cx-start');
  if (!btns.length) return;
  btns.forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      CH.user().then(function (u) {
        if (!u) { try { sessionStorage.setItem('stryker_return_to', '/creator-new'); } catch (x) {} location.href = '/signup'; }
        else location.href = '/creator-new';
      });
    });
  });
})();
