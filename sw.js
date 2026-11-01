// Offline support: the app shell is cached on install; fonts are cached the first time they load.
// Bump VERSION whenever any app file changes so phones pick up the new version.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const FONTS = 'fonts';
const FILES = ['./', './index.html', './app.css', './app.js', './store.js', './shared.js', './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
          return res;
        } catch {
          return new Response('', { status: 504 });
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  // Network first so updates arrive while online; the cache keeps the app working offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
