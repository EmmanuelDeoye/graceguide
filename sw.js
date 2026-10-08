/* ============================================
   GraceGuide — sw.js
   Main PWA service worker: caches the app shell so the site can
   install and reopen instantly/offline. It deliberately does NOT
   cache Firebase, api.bible, or DeepSeek requests — those need to
   always hit the network (or fail visibly) since they're live data,
   not static assets. Push notifications are handled separately by
   firebase-messaging-sw.js (registered at its own scope) so the two
   service workers don't fight over the same events.
   ============================================ */

// Bump this whenever the shell list below changes so old caches get
// cleaned up and clients pick up the new files.
const CACHE_VERSION = 'graceguide-shell-v9';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/base.css',
  '/css/pages.css',
  '/css/features.css',
  '/js/config.js',
  '/js/core.js',
  '/js/features.js',
  '/js/streaks.js',
  '/js/community.js',
  '/js/messaging.js',
  '/css/games.css',
  '/js/games-bank.js',
  '/js/games-core.js',
  '/js/games-ai.js',
  '/js/games-net.js',
  '/js/games-play.js',
  '/js/games.js',
  '/img/logo.png',
  '/img/icons/icon-192.png',
  '/img/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Requests we never want to intercept/cache — anything that needs to
// always be live: Firebase (auth/db/storage), api.bible, DeepSeek,
// Google Fonts/Font Awesome CDN, and any non-GET request.
const NEVER_CACHE_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'firebasestorage.googleapis.com',
  'googleapis.com',
  'firebaseapp.com',
  'gstatic.com',
  'api.scripture.api.bible',
  'api.deepseek.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (NEVER_CACHE_HOSTS.some((host) => url.hostname.includes(host))) return;

  // Navigations (opening/reloading the app): network-first so users get
  // the latest shell when online, falling back to the cached shell when
  // offline instead of a browser error page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Everything else same-origin (css/js/img): cache-first, then update
  // the cache in the background for next time (stale-while-revalidate).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
