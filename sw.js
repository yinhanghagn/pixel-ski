// Offline support.
// - prices.json: network first, so an updated file shows up the next time the app opens online.
// - app files: served from cache at once and refreshed in the background (changes show on the next open).
// - Google Fonts: cached after the first load.
// Bump VERSION only if you want every installed copy to drop its old cache.
const VERSION = 'v2';
const SHELL = `pixel-ski-shell-${VERSION}`;
const FONTS = `pixel-ski-fonts-${VERSION}`;
const CORE = [
  './', './index.html', './style.css', './app.js', './prices.json', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req)
    .then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (hit) return hit;
  const res = await fresh;
  if (res) return res;
  if (fallbackUrl) {
    const fb = await cache.match(fallbackUrl);
    if (fb) return fb;
  }
  return Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin && url.pathname.endsWith('/prices.json')) {
    e.respondWith(networkFirst(req));
  } else if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL, req.mode === 'navigate' ? './index.html' : null));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, FONTS));
  }
});
