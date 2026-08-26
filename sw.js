/* ═══════════════════════════════════════════════════════════════════════
   Prem Predictor 26/27 — service worker

   Strategy
   • App shell (html, manifest, icons)  → stale-while-revalidate
   • CDN libs (React, Tailwind, Babel, fonts) → cache-first, so the app opens
     offline after the first visit
   • Google Apps Script /exec           → never cached here; the app does its
                                          own short-lived cache in localStorage

   Bump CACHE_VERSION whenever you edit index.html, otherwise phones will keep
   serving the old copy.
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'pp2627-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(SHELL).catch(() => {/* a missing file must not block install */}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept the sheet API — always straight to the network.
  if (url.hostname.endsWith('script.google.com') ||
      url.hostname.endsWith('script.googleusercontent.com') ||
      url.hostname.endsWith('googleapis.com') && url.pathname.includes('/v4/spreadsheets')) {
    return;
  }

  // CDN libraries and fonts: cache-first (they are version-pinned).
  if (CDN_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => hit)
      )
    );
    return;
  }

  // Same-origin app shell: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    );
  }
});

// Lets the page trigger an immediate update: navigator.serviceWorker.controller
//   .postMessage('SKIP_WAITING')
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
