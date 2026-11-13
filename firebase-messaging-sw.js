// TradeZoro — Firebase Cloud Messaging service worker
//
// MUST live at the site root. A service worker can only control pages at or
// below its own path, so at /assets/ it would never receive a push for
// /dashboard-user.html. This file is deliberately not in assets/ and is not
// cache-busted with ?v= — the browser versions service workers by byte
// comparison, and a query string would register a second, competing worker.
//
// Handles messages that arrive while no TradeZoro window is visible. When a
// window IS visible the SDK hands the message to that page instead
// (assets/push.js onMessage: a toast, or a system notification through this
// worker's registration when that tab itself is hidden).

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Duplicated from auth.js rather than imported: a service worker runs in a
// separate global scope with no access to the page's variables, and none of
// these values are secret — they identify the project, they don't authorise
// anything. The security boundary is the Firestore rules.
// authDomain stays on firebaseapp.com here on purpose: messaging never uses
// it (only the Google sign-in popup does, in assets/auth.js), and a worker has
// no localStorage for the stk_auth_domain test override.
firebase.initializeApp({
  apiKey: "AIzaSyC8nqRVQ7wpuplYygZObKgNx2ojj5ZwbSQ",
  authDomain: "strykertrades-e0cd8.firebaseapp.com",
  projectId: "strykertrades-e0cd8",
  storageBucket: "strykertrades-e0cd8.firebasestorage.app",
  messagingSenderId: "950576868151",
  appId: "1:950576868151:web:0f204f6debee99beda08b2"
});

const messaging = firebase.messaging();

// A new worker takes over at once instead of waiting for every tab to close, so a fixed worker reaches the
// installed app on the next open (and clients.claim() lets notification clicks navigate the open app).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

// Alerts the member set (price, options, dark pool, test): they must be seen, so they stay on screen and buzz.
const ALERT_TYPES = { chart_alert: 1, zoro_alert: 1, dp_alert: 1, metric_alert: 1, test: 1 };

// Shared with assets/push.js (the open-but-hidden page shows the same notification through this worker).
function notifOptions(data) {
  const isAlert = !!ALERT_TYPES[data.type];
  return {
    body: data.body || '',
    icon: '/assets/images/tradezoro-icon-192-494.png?v=979',
    // Android draws the badge as a white mask of the alpha channel: the transparent TZ mark gives a clean glyph.
    badge: '/assets/images/tradezoro-icon-192-494.png?v=979',
    // One tag per alert notification (two alerts must both show); other types collapse by type (five likes = one).
    tag: isAlert ? 'alert-' + data.type + '-' + (data.nid || Date.now()) : (data.type || 'stryker'),
    badge: '/assets/images/tradezoro-favicon-32-494.png?v=979',
    // Tagging by type collapses repeats: five likes replace one another
    // instead of stacking five separate entries in the tray.
    // Chart alerts and dark pool print alerts get their own tag (two different alerts must both show); other types collapse by type.
    tag: data.type === 'chart_alert' || data.type === 'dp_alert' ? 'chart-alert-' + Date.now() : (data.type || 'stryker'),
    renotify: true,
    requireInteraction: isAlert,
    vibrate: isAlert ? [200, 100, 200] : undefined,
    timestamp: Number(data.ts) || Date.now(),
    data: { link: data.link || '/dashboard-user.html' }
  };
}

// Data-only messages (the function sends no `notification` block), so this worker alone decides what shows.
// The SDK calls this whenever no TradeZoro window is visible: app closed, in the background, phone locked.
// The promise is RETURNED so the push event stays alive until the notification is on screen.
messaging.onBackgroundMessage(function (payload) {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'TradeZoro', notifOptions(data));
});

// A notification's link arrives in the push payload. Only ever navigate to a
// path on this origin: an absolute URL here would let anyone who can send a
// push (now or after a future key leak) redirect a tap straight off-site.
function sameOriginPath(link) {
  const fallback = '/dashboard-user.html';
  if (!link || typeof link !== 'string') return fallback;
  try {
    const url = new URL(link, self.location.origin);
    if (url.origin !== self.location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch (e) {
    return fallback;
  }
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const link = sameOriginPath(event.notification.data && event.notification.data.link);

  // Focus an existing tab rather than opening a duplicate. Someone with the
  // site already open should be taken to it, not given a second copy.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const client of list) {
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          // navigate() only works on a page this worker controls; fall back to a new window if it refuses.
          return client.focus().then(function (c) { return (c || client).navigate(link); })
            .catch(function () { return clients.openWindow ? clients.openWindow(link) : null; });
        }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
