// Stryker Trading Academy — email verification gate
// Depends on: assets/auth.js (auth)
//
// Firebase Auth has no email OTP — only phone. What it does have is
// verification LINKS: sendEmailVerification() mails a one-time link, and
// clicking it flips emailVerified on the account. That is what this enforces.
//
// WHO THIS APPLIES TO
// Only accounts created with a password. Google sign-in already proves the
// person controls the address, and Firebase marks those emailVerified from
// the start — gating them would be a pointless extra step. The check is on
// the provider list rather than on emailVerified alone, so a Google user is
// never shown this screen even briefly.
//
// WHY IT'S NOT JUST THIS SCRIPT
// Hiding the UI is not enforcement — anyone can skip client JS. The real
// boundary is the Firestore rules, which require request.auth.token
// .email_verified for writes. This screen exists so an unverified user gets
// an explanation and a resend button instead of a wall of silent permission
// errors.
//
// TOKEN REFRESH IS THE FIDDLY BIT
// emailVerified lives in the ID token, which Firebase caches for up to an
// hour. After someone clicks the link in their inbox, the token in THIS tab
// is still stale and still says false. So reload() the user and force-refresh
// the token before believing it — otherwise "I've verified" appears to do
// nothing and they're stuck looking at a screen they already satisfied.

(function () {

  var OVERLAY_ID = 'email-verify-overlay';

  function isPasswordAccount(user) {
    if (!user || !user.providerData) return false;
    return user.providerData.some(function (p) { return p && p.providerId === 'password'; });
  }

  function removeGate() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.body.style.overflow = '';
  }

  function buildGate(user) {
    if (document.getElementById(OVERLAY_ID)) return;

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'paywall-overlay';
    overlay.style.display = 'flex';
    overlay.style.background = 'rgba(5,5,6,0.94)';
    overlay.style.zIndex = '900';

    overlay.innerHTML =
      '<div class="paywall-card">' +
        '<div class="paywall-icon">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>' +
        '</div>' +
        '<h2>Confirm your email</h2>' +
        '<p id="ev-body">We sent a confirmation link to <b>' + (user.email || 'your email address') + '</b>. ' +
          'Open it to activate your account. Check spam if it hasn\'t arrived within a minute.</p>' +
        '<div class="paywall-actions" style="flex-direction:column; gap:10px;">' +
          '<button class="btn btn-primary" id="ev-check">I\'ve confirmed it</button>' +
          '<button class="btn btn-ghost" id="ev-resend">Resend the email</button>' +
          '<button class="btn btn-ghost" id="ev-signout">Sign out</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    var body = document.getElementById('ev-body');
    function say(msg) { if (body) body.innerHTML = msg; }

    document.getElementById('ev-check').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      // reload() refetches the account, getIdToken(true) forces a new token
      // carrying the updated email_verified claim. Skipping the second step
      // leaves the stale cached token in place and the check keeps failing.
      user.reload()
        .then(function () { return user.getIdToken(true); })
        .then(function () {
          if (auth.currentUser && auth.currentUser.emailVerified) {
            removeGate();
            window.location.reload();
          } else {
            say('That email still looks unconfirmed. Open the link we sent to <b>' +
                (user.email || 'your address') + '</b>, then try again.');
            btn.disabled = false;
            btn.textContent = "I've confirmed it";
          }
        })
        .catch(function (err) {
          say('Could not check just now: ' + (err.message || err));
          btn.disabled = false;
          btn.textContent = "I've confirmed it";
        });
    });

    document.getElementById('ev-resend').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      user.sendEmailVerification()
        .then(function () {
          say('Sent again to <b>' + (user.email || 'your address') + '</b>. It can take a minute — check spam too.');
          btn.textContent = 'Sent';
          setTimeout(function () { btn.disabled = false; btn.textContent = 'Resend the email'; }, 30000);
        })
        .catch(function (err) {
          // Firebase rate-limits resends fairly aggressively.
          var msg = (err && err.code === 'auth/too-many-requests')
            ? 'Too many requests just now — wait a few minutes before trying again.'
            : 'Could not resend: ' + (err.message || err);
          say(msg);
          btn.disabled = false;
          btn.textContent = 'Resend the email';
        });
    });

    document.getElementById('ev-signout').addEventListener('click', function () {
      auth.signOut().then(function () { window.location.href = 'index.html'; });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof auth === 'undefined' || !auth) return;

    var checked = false;
    auth.onAuthStateChanged(function (user) {
      if (checked || !user) return;
      checked = true;

      if (!isPasswordAccount(user)) return;  // Google accounts are already verified
      if (user.emailVerified) return;

      // Someone may have clicked the link in another tab since this token was
      // issued, so refresh before putting a wall in front of them.
      user.reload()
        .then(function () { return user.getIdToken(true); })
        .then(function () {
          if (auth.currentUser && !auth.currentUser.emailVerified) buildGate(auth.currentUser);
        })
        .catch(function (err) {
          console.warn('Stryker: could not refresh verification state', err);
          buildGate(user);
        });
    });
  });

})();
