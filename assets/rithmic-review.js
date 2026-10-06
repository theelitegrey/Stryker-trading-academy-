// Stryker Trading Academy — /rithmic-review (temporary, unlisted page for Rithmic's
// conformance reviewers).
// Depends on: assets/auth.js (`auth`, friendlyAuthError), assets/progress.js (`db`,
// ensureStudentDoc), assets/activity-log.js (logActivityBeforeNavigating, optional).
//
// What it does: creates a normal FREE account (the same Starter bootstrap every sign-up gets:
// no plan purchase, no trial, no card, no checkout), files ONE request doc
// rithmicReview/{uid} {email, name, createdAt, source}, then sends the reviewer to /charts.
// The request grants nothing by itself. Rithmic access is students/{uid}.rithmicBeta, a
// privileged field that only an admin / the Admin SDK can set (Firestore rules), checked by
// assets/rithmic-config.js. Approve with the admin script kept outside the repo
// (stryker-notes/rithmic/rithmic-review-approve.py).

(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (typeof auth === 'undefined' || !auth || typeof db === 'undefined' || !db) {
    var e0 = $('rr-error');
    if (e0) { e0.textContent = 'Sign-up could not start. Please refresh the page.'; e0.style.display = 'block'; }
    return;
  }

  var busy = false;
  var fromForm = false; // true once this page itself signed someone in or up

  function showErr(id, msg) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
  function friendly(err) {
    return (typeof friendlyAuthError === 'function') ? friendlyAuthError(err) : ((err && err.message) || 'Something went wrong.');
  }
  function view(name) {
    $('rr-form-view').hidden = name !== 'form';
    $('rr-signin-view').hidden = name !== 'signin';
    $('rr-done-view').hidden = name !== 'done';
  }

  // Files the review request once (create-only in the rules; a second call is a no-op).
  function fileRequest(user, name) {
    var ref = db.collection('rithmicReview').doc(user.uid);
    return ref.get().then(function (snap) {
      if (snap.exists) return false;
      var data = {
        email: user.email || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        source: 'rithmic-review'
      };
      var n = String(name || user.displayName || '').trim().slice(0, 80);
      if (n) data.name = n;
      return ref.set(data).then(function () { return true; });
    });
  }

  function finish(user, name, isNew) {
    view('done');
    try { $('rr-signup').scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    var t = $('rr-done-text');
    var needsVerify = user && !user.emailVerified &&
      (user.providerData || []).some(function (p) { return p && p.providerId === 'password'; });
    if (t) {
      t.textContent = needsVerify
        ? 'Request filed. We just emailed ' + (user.email || 'you') + ' a confirmation link: Charts asks you to confirm your email first. Opening Charts…'
        : 'Request filed. Opening Charts…';
    }
    var boot = (typeof ensureStudentDoc === 'function') ? ensureStudentDoc(user).catch(function () {}) : Promise.resolve();
    return boot
      .then(function () { return fileRequest(user, name); })
      .catch(function (err) { console.warn('Stryker: review request not filed', err && err.code); })
      .then(function () {
        if (typeof logActivityBeforeNavigating === 'function') {
          return logActivityBeforeNavigating(isNew ? 'auth.signup' : 'auth.login',
            isNew ? 'Created an account (Rithmic review page)' : 'Logged in (Rithmic review page)').catch(function () {});
        }
      })
      .then(function () { setTimeout(function () { location.href = 'charts'; }, 1200); });
  }

  // ---- email sign-up ----
  $('rr-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;
    showErr('rr-error', '');
    var name = $('rr-name').value.trim();
    var email = $('rr-email').value.trim();
    var pass = $('rr-pass').value;
    if (!name) return showErr('rr-error', 'Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('rr-error', 'Please enter a valid email address.');
    if (pass.length < 6) return showErr('rr-error', 'Password must be at least 6 characters.');
    if (!$('rr-terms').checked) return showErr('rr-error', 'Please accept the Terms and Privacy Policy.');
    var btn = $('rr-go'); var label = btn.textContent;
    busy = true; fromForm = true; btn.disabled = true; btn.textContent = 'Creating account…';
    auth.createUserWithEmailAndPassword(email, pass)
      .then(function (cred) {
        return cred.user.updateProfile({ displayName: name }).then(function () { return cred.user; });
      })
      .then(function (user) {
        user.sendEmailVerification().catch(function (err) { console.warn('Stryker: verification email failed', err); });
        return finish(user, name, true);
      })
      .catch(function (err) {
        fromForm = false;
        showErr('rr-error', friendly(err));
        btn.disabled = false; btn.textContent = label; busy = false;
      });
  });

  // ---- Google ----
  $('rr-google').addEventListener('click', function () {
    if (busy) return;
    showErr('rr-error', '');
    if (!$('rr-terms').checked) return showErr('rr-error', 'Please accept the Terms and Privacy Policy first (tick the box below).');
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    busy = true; fromForm = true;
    auth.signInWithPopup(provider)
      .then(function (cred) {
        var isNew = !!(cred && cred.additionalUserInfo && cred.additionalUserInfo.isNewUser);
        return finish(cred.user, cred.user.displayName, isNew);
      })
      .catch(function (err) {
        fromForm = false; busy = false;
        showErr('rr-error', err && err.code === 'auth/popup-blocked'
          ? 'Your browser blocked the Google popup. Allow popups for this site, or use email instead.'
          : friendly(err));
      });
  });

  // ---- existing account ----
  $('rr-signin-link').addEventListener('click', function (e) { e.preventDefault(); view('signin'); });
  $('rr-back').addEventListener('click', function (e) { e.preventDefault(); view('form'); });
  $('rr-signin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;
    showErr('rr-error2', '');
    busy = true; fromForm = true;
    auth.signInWithEmailAndPassword($('rr-email2').value.trim(), $('rr-pass2').value)
      .then(function (cred) { return finish(cred.user, cred.user.displayName, false); })
      .catch(function (err) { fromForm = false; busy = false; showErr('rr-error2', friendly(err)); });
  });

  // Already signed in when the page opens: offer to use that account (never auto-file).
  auth.onAuthStateChanged(function (user) {
    if (!user || fromForm) return;
    var sub = document.querySelector('#rr-form-view .rr-card-sub');
    if (!sub || document.getElementById('rr-use-this')) return;
    var box = document.createElement('div');
    box.className = 'rr-signed';
    var p = document.createElement('p');
    p.textContent = 'You are signed in as ' + (user.email || 'this account') + '.';
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-primary btn-block'; b.id = 'rr-use-this';
    b.textContent = 'Use this account and open Charts';
    b.addEventListener('click', function () { if (busy) return; busy = true; fromForm = true; finish(user, user.displayName, false); });
    box.appendChild(p); box.appendChild(b);
    sub.parentNode.insertBefore(box, sub.nextSibling);
  });
})();
