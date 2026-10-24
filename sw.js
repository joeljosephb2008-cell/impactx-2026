// Offline shell: app files come from the cache first; Supabase calls always go to the network.
const CACHE = 'returnease-v5';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/sha256.js', 'js/engine.js', 'js/scenario.js', 'js/tests.js', 'js/i18n.js', 'js/art.js', 'js/api.js', 'js/app.js', 'img/wordmark.png', 'img/icons/icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network first so judges always see the latest deploy; cache when offline
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
