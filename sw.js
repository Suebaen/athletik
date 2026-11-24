// Service worker: precaches the whole app in a versioned cache, serves it
// cache-first, and waits for the page to say SKIP_WAITING before taking over
// (the page shows "Update verfügbar – neu laden").
//
// RELEASE: bump VERSION for every deploy, otherwise phones keep the old files.

const VERSION = '2026-11-24.1';
const CACHE = `athletik-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'TrainingPlan.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/db.js',
  'js/logs.js',
  'js/plan.js',
  'js/stats.js',
  'js/svgchart.js',
  'js/timer.js',
  'js/timerstate.js',
  'js/ui.js',
  'js/util.js',
  'js/validate.js',
  'js/views/day.js',
  'js/views/history.js',
  'js/views/more.js',
  'js/views/planview.js',
  'js/views/tests.js',
  'js/views/today.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' bypasses the HTTP cache (GitHub Pages caches for 10 min).
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('athletik-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // App navigation (any path inside the scope) → the cached app shell.
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) ?? fetch(req);
    }
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
