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
  try {
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
      console.warn('Stryker: could not set LOCAL auth persistence', err);
    });
  } catch (err) {
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

function currentRoleIsAdmin(authBoxEl){
  let isAdmin = false;
  if (!authBoxEl) return false;
  authBoxEl.querySelectorAll('.role-toggle button').forEach(b => {
    if (b.classList.contains('active') && b.textContent.includes('Admin')) isAdmin = true;
  });
  return isAdmin;
}

function routeToRoleDashboard(role){
  // Small delay before navigating away: gives Firebase's persistence layer
  // a moment to actually finish writing the session to storage before a
  // full page reload immediately needs to read it back on the next page.
  setTimeout(() => {
    window.location.href = (role === 'admin') ? 'dashboard-admin.html' : 'dashboard-user.html';
  }, 400);
}

// Guards against routing twice if both getRedirectResult() and the
// onAuthStateChanged fallback both fire for the same completed sign-in.
let _redirectRoutingDone = false;
function completeGoogleRedirectRouting(){
  if (_redirectRoutingDone) return;
  _redirectRoutingDone = true;
  let role = 'student';
  try {
    role = sessionStorage.getItem('stryker_pending_role') || 'student';
    sessionStorage.removeItem('stryker_pending_role');
  } catch(e) {}
  routeToRoleDashboard(role);
}

document.addEventListener('DOMContentLoaded', () => {

  if (!auth) return; // Firebase failed to init — fallback error UI already shown above.

  // ---- Email/password login ----
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearAuthError('login-error');
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const isAdmin = currentRoleIsAdmin(loginForm.closest('.auth-box'));
      const btn = loginForm.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Logging in…';
      auth.signInWithEmailAndPassword(email, password)
        .then(() => routeToRoleDashboard(isAdmin ? 'admin' : 'student'))
        .catch((err) => showAuthError('login-error', friendlyAuthError(err)))
        .finally(() => { btn.disabled = false; btn.textContent = original; });
    });
  }

  // ---- Email/password signup ----
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearAuthError('signup-error');
      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const isAdmin = currentRoleIsAdmin(signupForm.closest('.auth-box'));
      const btn = signupForm.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Creating account…';
      auth.createUserWithEmailAndPassword(email, password)
        .then((cred) => {
          if (name && cred.user) return cred.user.updateProfile({ displayName: name });
        })
        .then(() => routeToRoleDashboard(isAdmin ? 'admin' : 'student'))
        .catch((err) => showAuthError('signup-error', friendlyAuthError(err)))
        .finally(() => { btn.disabled = false; btn.textContent = original; });
    });
  }

  // ---- Google sign-in (login + signup) ----
  // Uses a full-page redirect (not a popup) — popups are unreliable on mobile
  // browsers and were the cause of the earlier "400: malformed request" error.
  document.querySelectorAll('[data-google-signin]').forEach(btn => {
    btn.addEventListener('click', () => {
      clearAuthError('login-error');
      clearAuthError('signup-error');
      const isAdmin = currentRoleIsAdmin(btn.closest('.auth-box'));
      try { sessionStorage.setItem('stryker_pending_role', isAdmin ? 'admin' : 'student'); } catch(e) {}
      const provider = new firebase.auth.GoogleAuthProvider();
      // Forces Google's account chooser every time, instead of silently
      // reusing whichever Google account last signed in on this device.
      provider.setCustomParameters({ prompt: 'select_account' });
      auth.signInWithRedirect(provider);
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
        .then(() => alert('Password reset email sent — check your inbox.'))
        .catch((err) => alert(friendlyAuthError(err)));
    });
  });

  // ---- Sign out (dashboard sidebars) ----
  document.querySelectorAll('[data-sign-out]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      auth.signOut().then(() => { window.location.href = 'index.html'; });
    });
  });

  // ---- Completing a Google redirect sign-in ----
  // We check two signals so this works even on mobile browsers whose storage
  // partitioning breaks Firebase's own getRedirectResult() tracking:
  //  1) getRedirectResult() — the normal path.
  //  2) onAuthStateChanged() — fires once Firebase actually has a signed-in
  //     user, which happens even when (1) silently fails to resolve. This is
  //     what was fixing the earlier bug where Google sign-in just landed back
  //     on the home page instead of a dashboard.
  let hasPendingGoogleRedirect = false;
  try { hasPendingGoogleRedirect = sessionStorage.getItem('stryker_pending_role') !== null; } catch(e) {}

  if (hasPendingGoogleRedirect) {
    auth.getRedirectResult().then((result) => {
      if (result && result.user) completeGoogleRedirectRouting();
    }).catch((err) => {
      if (err && err.code) {
        const onSignup = !!document.getElementById('signup-form');
        showAuthError(onSignup ? 'signup-error' : 'login-error', friendlyAuthError(err));
      }
      try { sessionStorage.removeItem('stryker_pending_role'); } catch(e) {}
    });

    auth.onAuthStateChanged((user) => {
      if (user) completeGoogleRedirectRouting();
    });
  }

  // ---- Reflect the real signed-in user across the dashboard UI ----
  auth.onAuthStateChanged((user) => {
    if (!user) return;
    const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');
    const firstName = displayName.split(' ')[0];

    document.querySelectorAll('.user-chip').forEach(chip => {
      const nameEl = chip.querySelector('.chip-name');
      const roleEl = chip.querySelector('.chip-role');
      if (nameEl) nameEl.textContent = displayName;
      if (roleEl) roleEl.textContent = user.email || '';
    });

    const welcomeName = document.getElementById('dash-first-name');
    if (welcomeName) welcomeName.textContent = firstName;
  });

});
