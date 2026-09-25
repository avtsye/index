const VERSION = 'avtsye-home-v9';
const ASSETS = ['./', './index.html', './404.html', './app.js', './style.css', './config.js', './manifest.webmanifest', './favicon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))])); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(VERSION).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || caches.match('./index.html')));
    return;
  }
  if (!ASSETS.some(asset => new URL(asset, self.location.href).pathname === url.pathname)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) caches.open(VERSION).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request)));
});
