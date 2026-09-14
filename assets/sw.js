/*
 * Chess Club service worker.
 *
 * Makes the app load instantly and work fully offline:
 *   - install()   precaches the entire shell (page, styles, scripts, chess.js,
 *                 Stockfish) into one versioned cache;
 *   - activate()  deletes any older cache, so a deploy just needs the VERSION
 *                 bump below to push every client to the new files;
 *   - fetch()     navigations (the HTML page) are network-first so updates
 *                 arrive, falling back to the cached shell when offline;
 *                 everything else is cache-first with a background refresh, so
 *                 the board renders immediately and newer files replace cached
 *                 ones on the next load.
 *
 * Keep VERSION in step with the app files: when you ship changed assets, bump
 * it so upgrading clients re-fetch everything instead of serving the old cache.
 *
 * Request handling is same-origin only (CDN fallbacks are left to the network).
 */

var VERSION = '1.1.0';
var CACHE = 'chessclub-v' + VERSION;

var PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './src/pieces.js',
  './src/engine.js',
  './src/coach.js',
  './src/drills.js',
  './vendor/chess.js',
  './vendor/stockfish.js',
  './vendor/stockfish.wasm.js',
  './vendor/stockfish.wasm',
  './favicon.svg',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (key) { return key !== CACHE; })
          .map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url = new URL(request.url);

  // Only same-origin GETs. CDN / blob requests go straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Page loads: try the network first so new HTML reaches the client; while
  // offline, serve the cached shell instead.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { return cache.put('./index.html', copy); });
        }
        return response;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // Other assets: serve the cache instantly (e-ink speed), and refresh the copy
  // in the background so the next load sees the newest file.
  event.respondWith(
    caches.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { return cache.put(request, copy); });
        }
        return response;
      });
      return cached || network;
    })
  );
});
