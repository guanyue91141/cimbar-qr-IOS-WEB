
var _cacheName = 'cimbar-recv-js-v2026-05-26-mobile';
var _cacheFiles = [
  '/',
  '/recv.html',
  '/cimbar_js.2026-05-09T0146.js',
  '/cimbar_js.2026-05-09T0146.wasm',
  '/favicon.ico',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/recv.2026-05-09T0146.js',
  '/recv-worker.2026-05-09T0146.js',
  '/pwa-recv.2026-05-09T0146.json',
  '/zstd.2026-05-09T0146.js'
];

// fetch files
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(_cacheName).then(function (cache) {
      return cache.addAll(_cacheFiles);
    })
  );
  self.skipWaiting();
});

// serve from cache
self.addEventListener('fetch', function (e) {
  e.respondWith(
    caches.match(e.request).then(function (response) {
      return response || fetch(e.request);
    })
  );
});

// clean old caches
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      for (var i in names)
        if (names[i] != _cacheName)
          caches.delete(names[i]);
    })
  );
});
