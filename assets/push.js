// TradeZoro — push notification registration
// Depends on: assets/auth.js (auth), assets/progress.js (db)
//
// Mirrors in-site notifications to the device. The Cloud Function
// onNotificationCreated watches the notifications collection and sends to
// whatever tokens are stored here, so anything that already produces a bell
// notification produces a push — nothing needs instrumenting twice.
//
// REGISTRATION THAT STICKS (Owner bug 2026-11-07: "alerts don't pop up, only when I open the app").
// A device's FCM token is not permanent: the browser can rotate its push subscription (new token, old one
// dead), and nothing used to tell Firestore. So syncToken() runs on every signed-in open, when the app comes
// back to the front (at most every 30 min), and when a new service worker takes over: it reads this device's
// current token (no prompt: only when permission is already 'granted') and upserts pushTokens/{token} when
// it changed or is a day old, deleting this device's previous token doc. pushTokens keeps its existing
// shape {uid, token, userAgent, createdAt} (the live rules allow only those keys), so createdAt is "last
// registered".
//
// PERMISSION IS NEVER REQUESTED ON LOAD. A permission prompt fired at a
// visitor who has not asked for it is the fastest way to get permanently
// blocked: browsers remember a denial and will not ask again, so one
// mistimed prompt costs that device push forever. It is only requested from
// an explicit tap: the Settings toggle, the dashboard card, or the "Turn on"
// button in an alert dialog (StrykerPush.mountPrompt).
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
      .then(function (reg) {
        // A first-time registration is still 'installing': getToken() then fails with "no active Service
        // Worker" and the first tap on Enable does nothing (worst on iPhone). Wait until it is active.
        return navigator.serviceWorker.ready.then(function () { return reg; });
      })
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
            return saveToken(token).then(function () { return 'enabled'; });
          });
        });
      });
  }).catch(function (err) {
    console.error('TradeZoro: push registration failed', err);
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
    forgetToken();
    return db.collection('pushTokens').doc(token).delete()
      .then(function () { return firebase.messaging().deleteToken(); });
  }).catch(function (err) {
    console.warn('TradeZoro: could not fully disable push', err);
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
      .then(function (reg) { return navigator.serviceWorker.ready.then(function () { return reg; }); })
      .then(function (registration) {
        return firebase.messaging().getToken({
          vapidKey: vapidKey,
          serviceWorkerRegistration: registration
        });
      });
  }).catch(function (err) {
    console.warn('TradeZoro: could not read push token', err);
    return null;
  });
}

// Also repairs the registration on the way (syncToken re-saves a rotated or missing token).
function pushEnabledOnThisDevice(){
  if (!auth || !auth.currentUser) return Promise.resolve(false);
  return syncToken(false).then(function (t) { return !!t; }).catch(function () { return false; });
}

// ---- token sync (see REGISTRATION THAT STICKS above) -------------------------
function pushTokKey(){ return auth && auth.currentUser ? 'stryker_push_tok_' + auth.currentUser.uid : null; }
function readTok(){ try { return JSON.parse(localStorage.getItem(pushTokKey()) || 'null'); } catch (e) { return null; } }
function forgetToken(){ try { if (pushTokKey()) localStorage.removeItem(pushTokKey()); } catch (e) {} }

// Upsert this device's token; drop this device's previous one (rotation) so it is not sent to forever.
function saveToken(token){
  var prev = readTok();
  return db.collection('pushTokens').doc(token).set({
    uid: auth.currentUser.uid,
    token: token,
    userAgent: navigator.userAgent.slice(0, 300),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function () {
    try { localStorage.setItem(pushTokKey(), JSON.stringify({ t: token, at: Date.now() })); } catch (e) {}
    if (prev && prev.t && prev.t !== token) {
      db.collection('pushTokens').doc(prev.t).delete().catch(function () {});
    }
  });
}

// Silent: never prompts. Resolves to the token or null. force = write even if unchanged.
var pushSyncBusy = null;
function syncToken(force){
  if (!pushSupported() || Notification.permission !== 'granted') return Promise.resolve(null);
  if (!auth || !auth.currentUser) return Promise.resolve(null);
  if (pushSyncBusy) return pushSyncBusy;          // one getToken at a time (parallel calls can mint two tokens)
  pushSyncBusy = currentPushToken().then(function (token) {
    if (!token) return null;
    var prev = readTok();
    var save = function () { return saveToken(token).then(function () { return token; }); };
    if (force || !prev || prev.t !== token || Date.now() - prev.at >= 864e5) return save();
    // Same token, saved today: still re-save if the doc is gone (pruned, or removed by a sign-out elsewhere).
    return db.collection('pushTokens').doc(token).get()
      .then(function (d) { return d.exists ? token : save(); });
  }).catch(function (err) {
    console.warn('TradeZoro: push token sync failed', err && (err.code || err.message));
    return null;
  }).then(function (t) { pushSyncBusy = null; return t; });
  return pushSyncBusy;
}

// ---- status, prompt and test (alert dialogs, alerts manager, Settings) --------
function pushIsIOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function pushIsStandalone(){ return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }

// 'on' | 'off' (can be turned on) | 'denied' | 'ios-install' | 'unsupported' | 'signed-out'
function pushStatus(){
  if (pushIsIOS() && !pushIsStandalone()) return Promise.resolve('ios-install');
  if (!pushSupported()) return Promise.resolve('unsupported');
  if (!auth || !auth.currentUser) return Promise.resolve('signed-out');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  if (Notification.permission !== 'granted') return Promise.resolve('off');
  return syncToken(false).then(function (t) { return t ? 'on' : 'off'; });
}

// How to unblock, for THIS platform only (two short lines at most).
function pushUnblockHelp(){
  if (pushIsIOS()) return 'iPhone: Settings, Notifications, TradeZoro, then Allow Notifications.';
  if (/Android/i.test(navigator.userAgent)) {
    return pushIsStandalone()
      ? 'Android: long-press the TradeZoro icon, App info, Notifications, Allow. Then reopen the app.'
      : 'Android: tap the icon left of the address, Permissions, Notifications, Allow. Then reload.';
  }
  return 'Click the icon left of the address bar, set Notifications to Allow, then reload this page.';
}

// System notification through the service worker (Android Chrome forbids new Notification() in a page).
function pushLocalNotify(title, body, tag, link){
  if (!('Notification' in window) || Notification.permission !== 'granted') return Promise.resolve(false);
  var opts = { body: body || '', icon: '/assets/images/tradezoro-icon-192-494.png?v=976',
               badge: '/assets/images/tradezoro-icon-192-494.png?v=976', tag: tag || 'tz-local',
               renotify: true, requireInteraction: true, vibrate: [200, 100, 200],
               data: { link: link || location.pathname + location.search } };
  var viaSw = ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration)
    ? navigator.serviceWorker.getRegistration('/').then(function (r) { if (!r) throw 0; return r.showNotification(title, opts); })
    : Promise.reject(0);
  return viaSw.then(function () { return true; }).catch(function () {
    try { new Notification(title, opts); return true; } catch (e) { return false; }
  });
}

// Test: a 'test' notification to yourself; onNotificationCreated sends it (3 per hour) and writes pushResult.
var PUSH_TEST_KEY = 'stryker_push_tests';
function sendTestPush(){
  if (!auth || !auth.currentUser) return Promise.resolve({ status: 'signed-out' });
  var now = Date.now(), list = [];
  try { list = JSON.parse(localStorage.getItem(PUSH_TEST_KEY) || '[]').filter(function (t) { return now - t < 3600000; }); } catch (e) {}
  if (list.length >= 3) return Promise.resolve({ status: 'rate-limited' });
  var uid = auth.currentUser.uid;
  return syncToken(true).then(function () {
    return db.collection('notifications').add({
      recipientUid: uid, senderUid: uid, type: 'test', read: false, link: 'settings.html',
      message: 'Test notification. If you can see this, TradeZoro alerts reach this device.',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }).then(function (ref) {
    list.push(now); try { localStorage.setItem(PUSH_TEST_KEY, JSON.stringify(list)); } catch (e) {}
    return new Promise(function (resolve) {
      var done = false, unsub = null;
      var finish = function (r) { if (done) return; done = true; try { if (unsub) unsub(); } catch (e) {} resolve(r); };
      setTimeout(function () { finish({ status: 'pending' }); }, 20000);
      try {
        unsub = ref.onSnapshot(function (d) { var r = d && d.exists && d.data().pushResult; if (r && r.status) finish(r); },
                               function () { finish({ status: 'pending' }); });
      } catch (e) { finish({ status: 'pending' }); }
    });
  }).catch(function (err) {
    console.warn('TradeZoro: test notification failed', err && (err.code || err.message));
    return { status: 'error' };
  });
}
function pushTestMessage(r){
  switch (r && r.status) {
    case 'sent': return ['success', 'Test sent to ' + r.sent + ' of ' + r.tokens + ' device' + (r.tokens === 1 ? '' : 's') + '. It should pop up in a few seconds.'];
    case 'no-device': return ['error', 'No device is registered for notifications yet. Turn them on first.'];
    case 'failed': return ['error', 'The notification service refused this device. Turn notifications off and on again.'];
    case 'rate-limited': return ['error', 'You can send 3 test notifications an hour. Try again later.'];
    case 'pending': return ['info', 'Test queued. If nothing pops up within a minute, turn notifications off and on again.'];
    case 'signed-out': return ['error', 'Sign in first.'];
    default: return ['error', 'Could not send a test notification. Check your connection and try again.'];
  }
}

var PUSH_BELL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
var PUSH_CSS = '' +
  '.tz-pushp{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:#131316;border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.92);font-family:inherit;font-size:14px;line-height:20px;font-weight:400;letter-spacing:normal;text-align:left;}' +
  '.tz-pushp[hidden]{display:none !important;}' +
  '.tz-pushp-ic{flex:none;width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:rgba(3,201,136,.12);color:#03c988;}' +
  '.tz-pushp.is-warn .tz-pushp-ic{background:rgba(245,166,35,.14);color:#f5a623;}' +
  '.tz-pushp.is-on .tz-pushp-ic{background:rgba(3,201,136,.12);}' +
  '.tz-pushp-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}' +
  '.tz-pushp-tx b{font-size:14px;line-height:20px;font-weight:600;}' +
  '.tz-pushp-tx span{font-size:12px;line-height:16px;color:rgba(255,255,255,.64);}' +
  '.tz-pushp-acts{flex:none;display:flex;gap:8px;}' +
  '.tz-pushp button.tz-pushp-btn{flex:none;min-height:44px;min-width:44px;padding:0 16px;letter-spacing:normal;border-radius:12px;border:1px solid rgba(3,201,136,.55);background:transparent;color:#03c988;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;transform:none;}' +
  '.tz-pushp button.tz-pushp-btn:hover{background:rgba(3,201,136,.10);border-color:#03c988;transform:none;}' +
  '.tz-pushp button.tz-pushp-btn:disabled{opacity:.6;cursor:default;}' +
  '.tz-pushp button.tz-pushp-btn:focus-visible{outline:2px solid #03c988;outline-offset:2px;}' +
  ':root[data-theme="light"] .tz-pushp{background:#f5f5f7;border-color:rgba(0,0,0,.08);color:#1d1d1f;}' +
  ':root[data-theme="light"] .tz-pushp-tx span{color:#515154;}' +
  ':root[data-theme="light"] .tz-pushp button.tz-pushp-btn{color:#047857;border-color:rgba(4,120,87,.55);}' +
  ':root[data-theme="light"] .tz-pushp .tz-pushp-ic{color:#047857;}' +
  '';
function pushCss(){
  if (document.getElementById('tz-pushp-css')) return;
  var st = document.createElement('style'); st.id = 'tz-pushp-css'; st.textContent = PUSH_CSS; document.head.appendChild(st);
}

// Inline block. mode 'prompt' (alert dialogs: hidden when this device already gets notifications) or
// 'status' (alerts manager: always shows a line, with "Send test" when on).
function mountPushPrompt(slot, mode){
  if (!slot) return Promise.resolve(null);
  pushCss();
  mode = mode || 'prompt';
  return pushStatus().then(function (st) {
    slot.classList.add('tz-pushp'); slot.hidden = false; slot.setAttribute('data-push', st);
    slot.classList.toggle('is-warn', st === 'denied' || st === 'ios-install');
    slot.classList.toggle('is-on', st === 'on');
    var head = '', sub = '', btn = '';
    if (st === 'on') {
      if (mode === 'prompt') { slot.hidden = true; return st; }
      head = 'Notifications on for this device'; sub = 'Server alerts pop up here even when TradeZoro is closed.';
      btn = '<button type="button" class="tz-pushp-btn" data-k="test">Send test</button>';
    } else if (st === 'off') {
      head = mode === 'prompt' ? 'Get this alert as a phone notification' : 'Notifications off for this device';
      sub = mode === 'prompt' ? 'Pops up even when TradeZoro is closed.' : 'Turn on to get alerts when TradeZoro is closed.';
      btn = '<button type="button" class="tz-pushp-btn" data-k="on">Turn on</button>';
    } else if (st === 'denied') {
      head = 'Notifications are blocked for this site'; sub = pushUnblockHelp();
    } else if (st === 'ios-install') {
      head = 'Add TradeZoro to your Home Screen first';
      sub = 'iPhone shows alerts only for the installed app (iOS 16.4+): Share, Add to Home Screen, then open it from the icon.';
    } else { slot.hidden = true; return st; }   // unsupported / signed-out: nothing to offer
    slot.setAttribute('role', 'group'); slot.setAttribute('aria-label', 'Notifications for this device');
    slot.innerHTML = '<span class="tz-pushp-ic">' + PUSH_BELL + '</span><span class="tz-pushp-tx"><b></b><span aria-live="polite"></span></span>' +
      (btn ? '<span class="tz-pushp-acts">' + btn + '</span>' : '');
    slot.querySelector('b').textContent = head;
    slot.querySelector('.tz-pushp-tx span').textContent = sub;
    var b = slot.querySelector('.tz-pushp-btn');
    if (b && b.getAttribute('data-k') === 'on') {
      b.onclick = function () {
        b.disabled = true; b.textContent = 'Turning on…';
        enablePush().then(function (res) {
          if (res !== 'enabled' && typeof showToast === 'function') showToast('error', (PUSH_ENABLE_MSG[res] || PUSH_ENABLE_MSG.error));
          if (res === 'enabled' && typeof showToast === 'function') showToast('success', 'Notifications are on for this device.');
          mountPushPrompt(slot, mode === 'prompt' ? 'status' : mode);   // show the "on" line (with Send test) after turning on
        });
      };
    } else if (b) {
      b.onclick = function () {
        b.disabled = true; b.textContent = 'Sending…';
        sendTestPush().then(function (r) {
          var m = pushTestMessage(r);
          if (typeof showToast === 'function') showToast(m[0], m[1]);
          slot.querySelector('.tz-pushp-tx span').textContent = m[1];
          b.disabled = false; b.textContent = 'Send test';
        });
      };
    }
    return st;
  });
}

var PUSH_ENABLE_MSG = {
  'denied':      'Permission was declined, so nothing will be sent to this device.',
  'blocked':     'Notifications are blocked for this site in your browser settings.',
  'no-key':      'Push is not configured yet. No VAPID key has been set.',
  'no-token':    'The browser did not return a push token. Try reloading.',
  'signed-out':  'Sign in first.',
  'unsupported': 'This browser does not support push notifications.',
  'error':       'Could not turn on notifications. Reload and try again.'
};

window.StrykerPush = {
  status: pushStatus, enable: enablePush, sync: syncToken, sendTest: sendTestPush, testMessage: pushTestMessage,
  mountPrompt: mountPushPrompt, unblockHelp: pushUnblockHelp, notify: pushLocalNotify
};

// Foreground messages. The browser deliberately does NOT show a system
// notification for a page that is currently focused, so without this a push
// arriving while the site is open would appear to be lost.
document.addEventListener('DOMContentLoaded', function () {
  if (!pushSupported()) return;
  if (typeof auth === 'undefined' || !auth) return;

  var listening = false, lastSync = 0;
  auth.onAuthStateChanged(function (user) {
    if (!user || Notification.permission !== 'granted') return;

    // Re-register silently on every signed-in open (see REGISTRATION THAT STICKS). Permission is already
    // granted here, so nothing is prompted.
    lastSync = Date.now();
    syncToken(false);
    if (listening) return;
    listening = true;

    // Back to the front after a while (an installed app is rarely reloaded): check the token again.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || Date.now() - lastSync < 1800000) return;
      lastSync = Date.now(); syncToken(false);
    });
    // A new service worker took over (each deploy): make sure the token behind it is the one stored.
    try { navigator.serviceWorker.addEventListener('controllerchange', function () { syncToken(true); }); } catch (e) {}

    try {
      firebase.messaging().onMessage(function (payload) {
        var d = payload.data || {};
        // The SDK only hands a message to the page when a TradeZoro window is visible. If THIS tab is not
        // the visible one, still put it in the system tray (the visible window may be another app tab).
        if (document.visibilityState !== 'visible') {
          pushLocalNotify(d.title || 'TradeZoro', d.body || '', 'alert-' + (d.type || 'n') + '-' + (d.nid || Date.now()), d.link);
        }
        // chart alerts: the open Charts page shows its own toast + sound from alertFires
        if (d.type === 'chart_alert' && /charts/.test(location.pathname)) { if (typeof loadNotifications === 'function') loadNotifications(); return; }
        if (typeof showToast === 'function') {
          showToast('info', d.body || 'You have a new notification', { title: d.title || 'TradeZoro' });
        }
        if (typeof loadNotifications === 'function') loadNotifications();
      });
    } catch (err) {
      console.warn('TradeZoro: foreground push listener failed', err);
    }
  });
});

// ---- Settings panel wiring ------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  var enableBtn = document.getElementById('push-enable-btn');
  if (!enableBtn) return;   // not on the settings page

  var disableBtn = document.getElementById('push-disable-btn');
  var testBtn = document.getElementById('push-test-btn');
  var stateEl = document.getElementById('push-state');
  var iosHint = document.getElementById('push-ios-hint');

  // iOS allows web push only for sites installed to the Home Screen, and only
  // from 16.4. Detected by the absence of standalone display mode rather than
  // by user-agent string, which lies.
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var iosNeedsInstall = isIOS && !isStandalone;
  if (iosNeedsInstall && iosHint) iosHint.style.display = 'block';

  function say(text){ if (stateEl) stateEl.textContent = text; }

  function refresh(){
    // iPhone / iPad Safari has no push at all outside an installed Home Screen app (iOS 16.4+), so say
    // what to do instead of 'not supported'.
    if (iosNeedsInstall) {
      say('Add TradeZoro to your Home Screen to get alerts.');
      enableBtn.style.display = 'none';
      if (disableBtn) disableBtn.style.display = 'none';
      return;
    }
    if (!pushSupported()) {
      say('This browser does not support push notifications.');
      enableBtn.style.display = 'none';
      return;
    }
    if (Notification.permission === 'denied') {
      say('Blocked for this site. ' + pushUnblockHelp());
      enableBtn.disabled = true;
      return;
    }
    pushEnabledOnThisDevice().then(function (on) {
      say(on ? 'Notifications on for this device.' : 'Off for this device: turn on to get alerts when TradeZoro is closed.');
      enableBtn.style.display = on ? 'none' : 'inline-flex';
      if (disableBtn) disableBtn.style.display = on ? 'inline-flex' : 'none';
      if (testBtn) testBtn.style.display = on ? 'inline-flex' : 'none';
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

  if (testBtn) {
    testBtn.addEventListener('click', function () {
      testBtn.disabled = true; testBtn.textContent = 'Sending…';
      sendTestPush().then(function (r) {
        var m = pushTestMessage(r);
        if (typeof showToast === 'function') showToast(m[0], m[1]);
        say(m[1]);
        testBtn.disabled = false; testBtn.textContent = 'Send test notification';
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
