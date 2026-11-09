// Std service worker — app-shell caching so repeat launches don't wait on the network.
// Bump CACHE_VERSION whenever you deploy changes to any cached file.
const CACHE_VERSION = 'std-v2';
const SHELL = [
  './', './index.html', './app.js', './db.js', './firebase-config.js',
  './manifest.json', './icon-192.png', './icon-512.png', './logo.svg'
];
const FIREBASE_SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Versioned Firebase SDK files never change at a given version -> cache-first.
  if (FIREBASE_SDK.test(req.url)) {
    e.respondWith(caches.open(CACHE_VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Own files (incl. astronomy.min.js on first Calendar open): stale-while-revalidate.
  // Data traffic (Firestore / Auth APIs) is cross-origin and is never touched here.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(CACHE_VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const refresh = fetch(req).then((res) => {
        if (res && res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || refresh;
    }));
  }
});
