// Offline support.
// - prices.json and app files: network first, so a new version shows up the first time the app opens online;
//   the cached copy is only used offline.
// - Google Fonts: cached after the first load.
// Bump VERSION only if you want every installed copy to drop its old cache.
const VERSION = 'v3';
const SHELL = `pixel-ski-shell-${VERSION}`;
const FONTS = `pixel-ski-fonts-${VERSION}`;
const CORE = [
  './', './index.html', './style.css', './app.js', './prices.json', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, which GitHub Pages keeps for 10 minutes
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(SHELL);
  const cached = async () => (await cache.match(req, { ignoreSearch: true })) || (fallbackUrl ? cache.match(fallbackUrl) : undefined);
  const fromNet = fetch(req, { cache: 'no-cache' })
    .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(async err => (await cached()) || Promise.reject(err));
  // weak signal on the mountain: after 4 s use the cached copy if there is one
  const slow = new Promise(r => setTimeout(r, 4000)).then(async () => (await cached()) || fromNet);
  return Promise.race([fromNet, slow]);
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

  if (url.origin === location.origin) {
    e.respondWith(networkFirst(req, req.mode === 'navigate' ? './index.html' : null));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, FONTS));
  }
});
