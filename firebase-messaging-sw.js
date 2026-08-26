// Stryker Trading Academy — Firebase Cloud Messaging service worker
//
// MUST live at the site root. A service worker can only control pages at or
// below its own path, so at /assets/ it would never receive a push for
// /dashboard-user.html. This file is deliberately not in assets/ and is not
// cache-busted with ?v= — the browser versions service workers by byte
// comparison, and a query string would register a second, competing worker.
//
// Handles messages that arrive while no tab is focused. Foreground messages
// are handled in assets/push.js instead, because the browser suppresses
// notifications for a page the user is already looking at.

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Duplicated from auth.js rather than imported: a service worker runs in a
// separate global scope with no access to the page's variables, and none of
// these values are secret — they identify the project, they don't authorise
// anything. The security boundary is the Firestore rules.
firebase.initializeApp({
  apiKey: "AIzaSyC8nqRVQ7wpuplYygZObKgNx2ojj5ZwbSQ",
  authDomain: "strykertrades-e0cd8.firebaseapp.com",
  projectId: "strykertrades-e0cd8",
  storageBucket: "strykertrades-e0cd8.firebasestorage.app",
  messagingSenderId: "950576868151",
  appId: "1:950576868151:web:0f204f6debee99beda08b2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  const data = payload.data || {};
  const title = data.title || 'Stryker Trading Academy';

  self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/assets/images/icon-192.png',
    badge: '/assets/images/favicon-32.png',
    // Tagging by type collapses repeats: five likes replace one another
    // instead of stacking five separate entries in the tray.
    tag: data.type || 'stryker',
    renotify: true,
    data: { link: data.link || '/dashboard-user.html' }
  });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/dashboard-user.html';

  // Focus an existing tab rather than opening a duplicate. Someone with the
  // site already open should be taken to it, not given a second copy.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const client of list) {
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
