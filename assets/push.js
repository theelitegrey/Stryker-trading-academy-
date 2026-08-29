// Stryker Trading Academy — push notification registration
// Depends on: assets/auth.js (auth), assets/progress.js (db)
//
// Mirrors in-site notifications to the device. The Cloud Function
// onNotificationCreated watches the notifications collection and sends to
// whatever tokens are stored here, so anything that already produces a bell
// notification produces a push — nothing needs instrumenting twice.
//
// PERMISSION IS NEVER REQUESTED ON LOAD. A permission prompt fired at a
// visitor who has not asked for it is the fastest way to get permanently
// blocked: browsers remember a denial and will not ask again, so one
// mistimed prompt costs that device push forever. It is only requested from
// an explicit toggle in Settings.
//
// TOKENS ARE PER DEVICE, not per user. The same person on a phone and a
// laptop has two, and one device signed into two accounts produces one token
// per account. They are stored as their own documents keyed by the token
// itself, so a stale one can be deleted without touching the others.

var STRYKER_VAPID_KEY = null;

function pushSupported(){
  return typeof firebase !== 'undefined' &&
         typeof firebase.messaging !== 'undefined' &&
         'serviceWorker' in navigator &&
         'Notification' in window &&
         'PushManager' in window;
}

// The VAPID public key identifies this project to the browser's push service.
// Public by design — it is the private half, held by Firebase, that signs. Read
// from settings so it can be set in the console without a redeploy.
function loadVapidKey(){
  if (STRYKER_VAPID_KEY) return Promise.resolve(STRYKER_VAPID_KEY);
  return db.collection('settings').doc('push').get()
    .then(function (doc) {
      STRYKER_VAPID_KEY = (doc.exists && doc.data().vapidKey) ? doc.data().vapidKey : null;
      return STRYKER_VAPID_KEY;
    })
    .catch(function () { return null; });
}

function pushPermissionState(){
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

// Registers this device and stores its token. Resolves to a short status
// string so the caller can say something useful rather than just failing.
function enablePush(){
  if (!pushSupported()) return Promise.resolve('unsupported');
  if (!auth || !auth.currentUser) return Promise.resolve('signed-out');

  // A previous denial cannot be undone from script — the browser will not
  // re-prompt. Saying so is more useful than a silent no-op.
  if (Notification.permission === 'denied') return Promise.resolve('blocked');

  return loadVapidKey().then(function (vapidKey) {
    if (!vapidKey) return 'no-key';

    return navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then(function (registration) {
        return Notification.requestPermission().then(function (permission) {
          if (permission !== 'granted') return 'denied';

          var messaging = firebase.messaging();
          return messaging.getToken({
            vapidKey: vapidKey,
            serviceWorkerRegistration: registration
          }).then(function (token) {
            if (!token) return 'no-token';

            // Keyed by the token so re-enabling on the same device overwrites
            // rather than accumulating duplicates — otherwise one person would
            // slowly collect tokens and receive the same push several times.
            return db.collection('pushTokens').doc(token).set({
              uid: auth.currentUser.uid,
              token: token,
              userAgent: navigator.userAgent.slice(0, 300),
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(function () { return 'enabled'; });
          });
        });
      });
  }).catch(function (err) {
    console.error('Stryker: push registration failed', err);
    return 'error';
  });
}

// Per-device preference: does this device keep receiving after sign-out?
//
// Stored in localStorage rather than Firestore because it has to be readable
// DURING sign-out, when the account is on its way out and a Firestore read may
// already be denied. It is also genuinely a property of the device, not the
// account — the same person may want it on their own phone and off on a
// borrowed laptop.
//
// Defaults to OFF. Someone logging out on a shared or public device would
// otherwise leave their notifications arriving in a stranger's tray with no
// indication it was happening.
var PUSH_KEEP_KEY = 'stryker_push_keep_signed_out';

function pushKeepAfterSignOut(){
  try { return localStorage.getItem(PUSH_KEEP_KEY) === '1'; }
  catch (e) { return false; }
}

function setPushKeepAfterSignOut(on){
  try { localStorage.setItem(PUSH_KEEP_KEY, on ? '1' : '0'); } catch (e) {}
}

function disablePush(){
  if (!pushSupported() || !auth || !auth.currentUser) return Promise.resolve();
  return currentPushToken().then(function (token) {
    if (!token) return;
    return db.collection('pushTokens').doc(token).delete()
      .then(function () { return firebase.messaging().deleteToken(); });
  }).catch(function (err) {
    console.warn('Stryker: could not fully disable push', err);
  });
}

// Is this specific device registered? Permission alone is not enough — the
// person may have granted it on another device, or cleared site data here.
// Called from the sign-out handler in auth.js.
function disablePushOnSignOut(){
  if (pushKeepAfterSignOut()) {
    // Token deliberately left in place. It stays bound to the uid that
    // registered it, so this device keeps receiving that account's
    // notifications until push is turned off in Settings.
    return Promise.resolve('kept');
  }
  return disablePush().then(function () { return 'removed'; });
}

// This device's current token, fetched the same way enablePush() fetches it.
// getToken() called bare — no VAPID key, no service-worker registration —
// FAILS on this SDK, which is why Settings used to report push as off moments
// after enabling it: the enable path and the check path were asking different
// questions. Permission is already granted wherever this is used, so nothing
// here ever prompts.
function currentPushToken(){
  if (!pushSupported() || Notification.permission !== 'granted') return Promise.resolve(null);
  return loadVapidKey().then(function (vapidKey) {
    if (!vapidKey) return null;
    return navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then(function (registration) {
        return firebase.messaging().getToken({
          vapidKey: vapidKey,
          serviceWorkerRegistration: registration
        });
      });
  }).catch(function (err) {
    console.warn('Stryker: could not read push token', err);
    return null;
  });
}

function pushEnabledOnThisDevice(){
  if (!auth || !auth.currentUser) return Promise.resolve(false);
  return currentPushToken()
    .then(function (token) {
      if (!token) return false;
      return db.collection('pushTokens').doc(token).get().then(function (d) { return d.exists; });
    })
    .catch(function () { return false; });
}

// Foreground messages. The browser deliberately does NOT show a system
// notification for a page that is currently focused, so without this a push
// arriving while the site is open would appear to be lost.
document.addEventListener('DOMContentLoaded', function () {
  if (!pushSupported()) return;
  if (typeof auth === 'undefined' || !auth) return;

  auth.onAuthStateChanged(function (user) {
    if (!user || Notification.permission !== 'granted') return;

    // Re-register silently on sign-in. The token is deleted at sign-out, so
    // without this someone would have to visit Settings and opt in again after
    // every login. Permission is already granted at this point, so nothing is
    // prompted — enablePush() only asks when permission is still 'default'.
    pushEnabledOnThisDevice().then(function (on) {
      if (!on) enablePush();
    });

    try {
      firebase.messaging().onMessage(function (payload) {
        var d = payload.data || {};
        if (typeof showToast === 'function') {
          showToast('info', d.body || 'You have a new notification', { title: d.title || 'Stryker' });
        }
        if (typeof loadNotifications === 'function') loadNotifications();
      });
    } catch (err) {
      console.warn('Stryker: foreground push listener failed', err);
    }
  });
});

// ---- Settings panel wiring ------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  var enableBtn = document.getElementById('push-enable-btn');
  if (!enableBtn) return;   // not on the settings page

  var disableBtn = document.getElementById('push-disable-btn');
  var stateEl = document.getElementById('push-state');
  var iosHint = document.getElementById('push-ios-hint');

  // iOS allows web push only for sites installed to the Home Screen, and only
  // from 16.4. Detected by the absence of standalone display mode rather than
  // by user-agent string, which lies.
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isIOS && !isStandalone && iosHint) iosHint.style.display = 'block';

  function say(text){ if (stateEl) stateEl.textContent = text; }

  function refresh(){
    if (!pushSupported()) {
      say('This browser does not support push notifications.');
      enableBtn.style.display = 'none';
      return;
    }
    if (Notification.permission === 'denied') {
      say('Blocked in your browser settings. Allow notifications for this site, then reload.');
      enableBtn.disabled = true;
      return;
    }
    pushEnabledOnThisDevice().then(function (on) {
      say(on ? 'On for this device.' : 'Off for this device.');
      enableBtn.style.display = on ? 'none' : 'inline-flex';
      if (disableBtn) disableBtn.style.display = on ? 'inline-flex' : 'none';
      // The keep-after-sign-out choice only means anything once push is
      // actually on, so it stays hidden until then rather than offering a
      // setting that does nothing.
      var keepRow = document.getElementById('push-keep-row');
      if (keepRow) keepRow.style.display = on ? 'flex' : 'none';
    });
  }

  var MESSAGES = {
    'enabled':     ['success', 'Push notifications are on for this device.'],
    'denied':      ['error',   'Permission was declined, so nothing will be sent to this device.'],
    'blocked':     ['error',   'Notifications are blocked for this site in your browser settings.'],
    'no-key':      ['error',   'Push is not configured yet — no VAPID key has been set.'],
    'no-token':    ['error',   'The browser did not return a push token. Try reloading.'],
    'signed-out':  ['error',   'Sign in first.'],
    'unsupported': ['error',   'This browser does not support push notifications.'],
    'error':       ['error',   'Could not enable push. Check the console for details.']
  };

  enableBtn.addEventListener('click', function () {
    enableBtn.disabled = true;
    enableBtn.textContent = 'Enabling…';
    enablePush().then(function (status) {
      var m = MESSAGES[status] || MESSAGES.error;
      if (typeof showToast === 'function') showToast(m[0], m[1]);
      enableBtn.disabled = false;
      enableBtn.textContent = 'Enable on this device';
      refresh();
    });
  });

  if (disableBtn) {
    disableBtn.addEventListener('click', function () {
      disableBtn.disabled = true;
      disablePush().then(function () {
        if (typeof showToast === 'function') showToast('success', 'Push turned off for this device.');
        disableBtn.disabled = false;
        refresh();
      });
    });
  }

  var keepToggle = document.getElementById('push-keep-toggle');
  if (keepToggle) {
    keepToggle.checked = pushKeepAfterSignOut();
    keepToggle.addEventListener('change', function () {
      setPushKeepAfterSignOut(keepToggle.checked);
      if (typeof showToast === 'function') {
        showToast('success', keepToggle.checked
          ? 'This device will keep receiving notifications after you sign out.'
          : 'Notifications will stop on this device when you sign out.');
      }
    });
  }

  if (typeof auth !== 'undefined' && auth) {
    var done = false;
    auth.onAuthStateChanged(function (user) {
      if (done || !user) return;
      done = true;
      refresh();
    });
  }
});
