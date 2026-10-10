/* ============================================
   GraceGuide — sw.js
   Main PWA service worker: keeps a copy of the app shell so the site can
   install and still open offline. It deliberately does NOT cache
   Firebase, api.bible, or DeepSeek requests — those need to always hit
   the network (or fail visibly) since they're live data, not static
   assets. Push notifications are handled separately by
   firebase-messaging-sw.js (registered at its own scope) so the two
   service workers don't fight over the same events.

   FRESHNESS FIRST. The app's own pages, scripts and styles are fetched
   from the network every time (asking the server whether its copy has
   changed), and the saved copy is only used when the network cannot be
   reached. An update therefore shows on the very next load — it no longer
   takes several visits (or a private window) to shake off an old version.
   ============================================ */

// Bump this whenever the shell list below changes so old caches get
// cleaned up and clients pick up the new files.
const CACHE_VERSION = 'graceguide-shell-v14';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/base.css',
  '/css/pages.css',
  '/css/features.css',
  '/css/games.css',
  '/js/config.js',
  '/js/core.js',
  '/js/features.js',
  '/js/streaks.js',
  '/js/community.js',
  '/js/messaging.js',
  '/js/quiz.js',
  '/js/sharecards.js',
  '/js/games-bank.js',
  '/js/games-core.js',
  '/js/games-net.js',
  '/js/games-play.js',
  '/js/games.js',
  '/js/pwa.js',
  '/img/logo.png',
  '/img/icons/icon-192.png',
  '/img/icons/icon-512.png'
];

// How long to wait for the network before showing the saved copy (slow / flaky connections).
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // 'reload': straight from the server, never the browser's own HTTP cache — otherwise a
      // new version of this worker could save the OLD files as its "fresh" shell.
      .then((cache) => Promise.all(APP_SHELL.map((url) =>
        fetch(new Request(url, { cache: 'reload' }))
          .then((response) => { if (response && response.ok) return cache.put(url, response); })
          .catch(() => {}) // one missing file must not block the update
      )))
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

// The page asks for this when it finds an update waiting.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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

/** The saved copy of a request (ignoring any ?v= on the address), or undefined. */
function saved(request) {
  return caches.match(request, { ignoreSearch: true });
}

/**
 * Network first: ask the server (revalidating, so an unchanged file costs almost nothing),
 * keep a copy for offline use, and fall back to the saved copy if the network fails or is
 * too slow to answer.
 */
function networkFirst(url, cacheKey) {
  const fromNetwork = fetch(url, { cache: 'no-cache', credentials: 'same-origin' }).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
    }
    return response;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS, null));
  return Promise.race([fromNetwork.catch(() => null), slow]).then((response) => {
    if (response) return response;
    // Offline or slow: the saved copy now, if there is one; otherwise keep waiting for the network.
    return saved(cacheKey).then((cached) => cached || fromNetwork);
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (NEVER_CACHE_HOSTS.some((host) => url.hostname.includes(host))) return;
  if (url.origin !== self.location.origin) return;

  // Opening / reloading the app: always the latest page when online.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(url.pathname === '/admin.html' ? request.url : '/index.html', url.pathname === '/admin.html' ? request.url : '/index.html')
      .catch(() => saved('/index.html')));
    return;
  }

  // Pictures change rarely: saved copy first, refreshed in the background.
  if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(
      saved(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Scripts, styles, the manifest: the latest from the network, the saved copy only when offline.
  event.respondWith(networkFirst(request.url, request).catch(() => saved(request)));
});
