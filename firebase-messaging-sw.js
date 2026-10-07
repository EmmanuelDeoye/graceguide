/* ============================================
   GraceGuide — firebase-messaging-sw.js
   Handles push notifications while the PWA is closed or in the
   background. Registered by js/pwa.js at the scope
   '/firebase-cloud-messaging-push-scope' so it can run alongside
   sw.js (the main app-shell service worker) without the two fighting
   over control of the page.

   NOTE: service workers can't `import` js/config.js, so the Firebase
   config is duplicated here. This is normal/expected for Firebase
   Messaging — these values (apiKey, projectId, etc.) are not secret,
   they just identify which Firebase project to talk to.
   ============================================ */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAYyIEAlJD8FgeE2bv73fWwKbpsDPuiB84",
  authDomain: "graceguide-8d9f5.firebaseapp.com",
  databaseURL: "https://graceguide-8d9f5-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "graceguide-8d9f5",
  storageBucket: "graceguide-8d9f5.firebasestorage.app",
  messagingSenderId: "859988308746",
  appId: "1:859988308746:web:f68879be9f0d967b9040f3"
});

const messaging = firebase.messaging();

// Fired for any push GraceGuide's Cloud Function sends while the app
// isn't in the foreground (tab closed, backgrounded, or phone locked).
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'GraceGuide';
  const body = payload?.notification?.body || '';
  const data = payload?.data || {};

  self.registration.showNotification(title, {
    body,
    icon: '/img/icons/icon-192.png',
    badge: '/img/icons/icon-96.png',
    tag: data.tag || undefined,   // same tag replaces/stacks related notifications instead of piling up
    data,
    vibrate: [100, 50, 100]
  });
});

// Tapping the notification opens (or focuses) the app, ideally landing
// on the relevant screen if the payload included a route/url.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Game invitation → "Decline": just dismiss it (the invite expires by itself).
  if (event.action === 'decline') return;
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-click', url: targetUrl });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
