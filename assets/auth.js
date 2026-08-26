// Stryker Trading Academy — Firebase Authentication
// Loaded on: login.html, signup.html, dashboard-user.html, dashboard-admin.html
// Requires firebase-app-compat.js + firebase-auth-compat.js to be loaded first.

const firebaseConfig = {
  apiKey: "AIzaSyC8nqRVQ7wpuplYygZObKgNx2ojj5ZwbSQ",
  authDomain: "strykertrades-e0cd8.firebaseapp.com",
  projectId: "strykertrades-e0cd8",
  storageBucket: "strykertrades-e0cd8.firebasestorage.app",
  messagingSenderId: "950576868151",
  appId: "1:950576868151:web:0f204f6debee99beda08b2"
};

let auth = null;
try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();

  // Explicitly use durable local persistence. Wrapped defensively — some
  // mobile browser configurations reject certain persistence types outright.
  //
  // LOCAL persistence needs IndexedDB. Private/incognito windows and browsers
  // with site data blocked reject it, and when that happens sign-in still
  // SUCCEEDS on this page — it just doesn't survive the navigation to the
  // dashboard. That looks exactly like "login does nothing", so record the
  // failure and say so on-page rather than only warning to a console that
  // nobody on mobile can open.
  try {
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
      window.__strykerPersistenceFailed = true;
      console.warn('Stryker: could not set LOCAL auth persistence', err);
    });
  } catch (err) {
    window.__strykerPersistenceFailed = true;
    console.warn('Stryker: setPersistence threw synchronously', err);
  }
} catch (err) {
  console.error('Stryker: Firebase failed to initialize', err);
  document.addEventListener('DOMContentLoaded', () => {
    const box = document.querySelector('.auth-box') || document.querySelector('.dash-main');
    if (box) {
      const el = document.createElement('div');
      el.className = 'auth-error';
      el.style.display = 'block';
      el.textContent = 'Login system failed to initialize (' + (err && err.message ? err.message : 'unknown error') + '). Please refresh the page.';
      box.insertBefore(el, box.firstChild);
    }
    // Prevent forms from silently falling back to a native page reload.
    document.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
  });
}

function showAuthError(elId, message){
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}
function clearAuthError(elId){
  const el = document.getElementById(elId);
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

function friendlyAuthError(error){
  const map = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password. Try again or reset it below.',
    'auth/email-already-in-use': 'An account already exists with that email — try logging in instead.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/missing-password': 'Please enter a password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before finishing.',
    'auth/unauthorized-domain': 'This domain isn\'t authorized for Google sign-in yet in the Firebase console.'
  };
  return map[error.code] || (error.message || 'Something went wrong. Please try again.');
}

// NOTE: role selection at login was removed deliberately. It was a UI toggle
// that anyone could click, so it never proved anything — the real boundary is
// the Firestore rules plus admin-guard.js, both of which check for an
// /admins/{uid} document. Everyone now lands on the student dashboard, and
// admin-link.js reveals an "Admin dashboard" entry point for genuine admins.

// Stores the page a visitor was trying to reach before being bounced to
// login, so we can send them back there instead of a generic dashboard once
// they're actually signed in — e.g. checkout.html?plan=X should return to
// that exact plan's checkout, not just "some dashboard".
function goToLoginPreservingReturn(){
  try {
    sessionStorage.setItem('stryker_return_to', window.location.pathname + window.location.search);
  } catch(e) {}
  window.location.href = 'login.html';
}

// "Keep me logged in" was previously a checkbox with no id, no name and no
// code reading it — purely decorative, while persistence was always LOCAL.
// Now it actually chooses: LOCAL survives closing the browser, SESSION lasts
// only for the tab. Applied immediately before sign-in, because Firebase
// requires persistence to be set before the credential is exchanged.
function applyChosenPersistence(){
  if (!auth || typeof firebase === 'undefined') return Promise.resolve();
  const box = document.getElementById('login-remember');
  const wanted = (box && !box.checked)
    ? firebase.auth.Auth.Persistence.SESSION
    : firebase.auth.Auth.Persistence.LOCAL;
  try {
    return auth.setPersistence(wanted).catch((err) => {
      // Don't block the login — an in-memory session still works for this
      // page. The dashboard reports the dropped session if it doesn't stick.
      window.__strykerPersistenceFailed = true;
      console.warn('Stryker: could not apply chosen persistence', err);
    });
  } catch (err) {
    window.__strykerPersistenceFailed = true;
    console.warn('Stryker: setPersistence threw synchronously', err);
    return Promise.resolve();
  }
}

function routeAfterAuth(){
  // Small delay before navigating away: gives Firebase's persistence layer
  // a moment to actually finish writing the session to storage before a
  // full page reload immediately needs to read it back on the next page.
  setTimeout(() => {
    let returnTo = null;
    try {
      returnTo = sessionStorage.getItem('stryker_return_to');
      sessionStorage.removeItem('stryker_return_to');
    } catch(e) {}

    const isUsableReturn = returnTo &&
      returnTo.indexOf('login.html') === -1 &&
      returnTo.indexOf('signup.html') === -1;

    if (isUsableReturn) {
      window.location.href = returnTo;
      return;
    }
    window.location.href = 'dashboard-user.html';
  }, 400);
}

document.addEventListener('DOMContentLoaded', () => {

  // Capture a ?ref= code the moment it appears in the URL, before anything
  // else. Previously this only happened inside the signup submit handler, so
  // a visitor who landed on an invite link and then clicked through to the
  // login page (or reloaded) lost the code entirely.
  if (typeof capturePendingReferralCode === 'function') capturePendingReferralCode();

  if (!auth) return; // Firebase failed to init — fallback error UI already shown above.

  // If persistence was rejected, sign-in will appear to work and then silently
  // fail to carry over to the dashboard. Warn BEFORE they try, on the page
  // where they can still do something about it. The setPersistence promise is
  // async, so check shortly after load rather than immediately.
  const authBox = document.querySelector('.auth-box');
  if (authBox) {
    setTimeout(() => {
      if (!window.__strykerPersistenceFailed) return;
      if (document.getElementById('persistence-warning')) return;
      const warn = document.createElement('div');
      warn.id = 'persistence-warning';
      warn.className = 'auth-error';
      warn.style.display = 'block';
      warn.textContent = "Your browser is blocking the storage this site needs to keep you signed in. Logging in may appear to work but then stall on the next page. If you're in a private/incognito window, try a normal window; otherwise allow site data for strykertrading.com.";
      authBox.insertBefore(warn, authBox.firstChild);
    }, 1200);
  }

  // ---- Email/password login ----
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearAuthError('login-error');
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const btn = loginForm.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Logging in…';
      applyChosenPersistence()
        .then(() => auth.signInWithEmailAndPassword(email, password))
        .then(() => {
          // Awaited: routeAfterAuth navigates, and an in-flight write dies
          // with the page. Capped internally so a slow log can't strand
          // someone on a login screen that looks like it did nothing.
          if (typeof logActivityBeforeNavigating === 'function') {
            return logActivityBeforeNavigating('auth.login', 'Logged in').then(routeAfterAuth);
          }
          return routeAfterAuth();
        })
        .catch((err) => showAuthError('login-error', friendlyAuthError(err)))
        .finally(() => { btn.disabled = false; btn.textContent = original; });
    });
  }

  // ---- Email/password signup ----
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    // Pre-fill the invite code field from a ?ref= link, if the person arrived via one.
    const referralField = document.getElementById('signup-referral');
    if (referralField) {
      const urlRef = new URLSearchParams(window.location.search).get('ref');
      if (urlRef) referralField.value = urlRef;
    }

    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearAuthError('signup-error');
      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const referralCode = referralField ? referralField.value.trim() : '';
      const btn = signupForm.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Creating account…';
      // Stash whatever code is in the field (typed or pre-filled) so the
      // student-doc-creation step (progress.js) can pick it up regardless
      // of which sign-up path (email or Google) actually creates the account.
      if (referralCode) {
        try { sessionStorage.setItem('stryker_referral_code', referralCode); } catch (err) { /* fail open */ }
      }
      auth.createUserWithEmailAndPassword(email, password)
        .then((cred) => {
          if (name && cred.user) return cred.user.updateProfile({ displayName: name }).then(() => cred);
          return cred;
        })
        .then((cred) => {
          // Password signups start unverified. Fire the verification email
          // immediately — email-verify.js blocks the dashboard until they
          // click it. Deliberately not chained into the failure path: if the
          // send fails (quota, transient), the account still exists and the
          // gate offers a resend button, which is far better than leaving
          // them with a half-created account and an error.
          if (cred && cred.user && !cred.user.emailVerified) {
            return cred.user.sendEmailVerification()
              .catch((err) => console.warn('Stryker: verification email failed to send', err));
          }
        })
        .then(() => {
          if (typeof logActivityBeforeNavigating === 'function') {
            return logActivityBeforeNavigating('auth.signup', 'Created an account').then(routeAfterAuth);
          }
          return routeAfterAuth();
        })
        .catch((err) => showAuthError('signup-error', friendlyAuthError(err)))
        .finally(() => { btn.disabled = false; btn.textContent = original; });
    });
  }

  // ---- Google sign-in (login + signup) ----
  // Uses a popup rather than a full-page redirect. Redirect-based sign-in
  // depends on sessionStorage surviving a three-way navigation between this
  // site's domain and Firebase's authDomain (firebaseapp.com) — on this
  // device that hit Firebase's own "missing initial state" error, a known,
  // widely-reported limitation of mobile browsers that partition storage
  // per top-level site. Popup avoids that specific relay entirely.
  document.querySelectorAll('[data-google-signin]').forEach(btn => {
    btn.addEventListener('click', () => {
      clearAuthError('login-error');
      clearAuthError('signup-error');
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const errElId = document.getElementById('signup-form') ? 'signup-error' : 'login-error';

      // Stash the invite code before the popup, exactly as the email/password
      // path does. Without this, anyone arriving on a ?ref= link and choosing
      // "Continue with Google" lost their referral silently — the code was
      // only ever read inside the email signup submit handler.
      const gRefField = document.getElementById('signup-referral');
      const gUrlRef = new URLSearchParams(window.location.search).get('ref');
      const gCode = (gRefField && gRefField.value.trim()) || (gUrlRef || '').trim();
      if (gCode) {
        try { sessionStorage.setItem('stryker_referral_code', gCode); } catch (err) { /* fail open */ }
      }

      const original = btn.innerHTML;
      btn.disabled = true;

      applyChosenPersistence()
        .then(() => auth.signInWithPopup(provider))
        .then((cred) => {
          // Google covers both sign-up and sign-in through one button, so the
          // event is chosen from whether Firebase just created the account.
          var isNew = cred && cred.additionalUserInfo && cred.additionalUserInfo.isNewUser;
          if (typeof logActivityBeforeNavigating === 'function') {
            return logActivityBeforeNavigating(
              isNew ? 'auth.signup' : 'auth.login',
              isNew ? 'Created an account with Google' : 'Logged in with Google'
            ).then(routeAfterAuth);
          }
          return routeAfterAuth();
        })
        .catch((err) => {
          if (err && err.code === 'auth/popup-blocked') {
            showAuthError(errElId, "Your browser blocked the Google sign-in popup. Please allow popups for this site, or use email/password instead — it doesn't need one.");
          } else {
            showAuthError(errElId, friendlyAuthError(err) + ' If this keeps happening, email/password login is the most reliable option on this device.');
          }
        })
        .finally(() => { btn.disabled = false; btn.innerHTML = original; });
    });
  });

  // ---- Forgot password ----
  document.querySelectorAll('[data-forgot-password]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const prefillEl = document.getElementById('login-email');
      const prefill = prefillEl ? prefillEl.value.trim() : '';
      const email = prompt('Enter your account email to receive a reset link:', prefill);
      if (!email) return;
      auth.sendPasswordResetEmail(email.trim())
        .then(() => showToast('success', 'Password reset email sent — check your inbox.'))
        .catch((err) => showToast('error', friendlyAuthError(err)));
    });
  });

  // ---- Sign out (dashboard sidebars) ----
  document.querySelectorAll('[data-sign-out]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const bye = (typeof logActivity === 'function') ? logActivity('auth.logout', 'Logged out') : Promise.resolve();
      // Unregister this device's push token BEFORE signing out, while the
      // rules still allow deleting a document that belongs to this uid.
      // Without it the token survives logout and the next person on a shared
      // phone keeps receiving the previous user's notifications.
      const unpush = (typeof disablePushOnSignOut === 'function') ? disablePushOnSignOut().catch(() => {}) : Promise.resolve();
      Promise.all([bye, unpush])
        .then(() => auth.signOut())
        .then(() => { window.location.href = 'index.html'; });
    });
  });

  // ---- Reflect the real signed-in user across the dashboard UI ----
  auth.onAuthStateChanged((user) => {
    if (!user) return;
    const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');
    const firstName = displayName.split(' ')[0];

    function applyChipName(roleTag){
      document.querySelectorAll('.user-chip').forEach(chip => {
        const nameEl = chip.querySelector('.chip-name');
        const roleEl = chip.querySelector('.chip-role');
        if (nameEl) nameEl.innerHTML = escapeChipText(displayName) + (roleTag || '');
        if (roleEl) roleEl.textContent = user.email || '';
      });
    }

    applyChipName(''); // set the name immediately; the role tag arrives async below

    function applyChipAvatar(studentData){
      if (typeof avatarImgHtml !== 'function') return;
      const html = avatarImgHtml(user.uid, displayName, studentData, 34);
      document.querySelectorAll('.user-chip .chip-avatar').forEach(el => {
        el.style.background = 'none';
        el.innerHTML = html;
      });
    }

    if (typeof db !== 'undefined' && db && typeof roleTagHtml === 'function' && typeof loadPlansForRoles === 'function') {
      Promise.all([
        db.collection('students').doc(user.uid).get().catch(() => null),
        loadPlansForRoles()
      ]).then(([studentDoc]) => {
        const data = studentDoc && studentDoc.exists ? studentDoc.data() : null;
        const plan = data ? data.plan : null;
        if (plan) applyChipName(roleTagHtml(plan, { size: 'small' }));
        applyChipAvatar(Object.assign({}, data, { photoURL: (data && data.photoURL) || user.photoURL }));
      }).catch(() => {});
    }

    const welcomeName = document.getElementById('dash-first-name');
    if (welcomeName) welcomeName.textContent = firstName;
  });

});

function escapeChipText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
