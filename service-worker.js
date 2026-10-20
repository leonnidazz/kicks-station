const CACHE_NAME = 'kicks-station-shell-v4';
const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(error => console.warn('App shell cache tidak lengkap:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('kicks-station-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first: halaman admin tetap diperbarui dari GitHub Pages; cache hanya fallback offline.
  event.respondWith(
    fetch(request).then(response => {
      if (response && response.ok && (request.destination === 'document' || /\.(?:html|webmanifest|png|svg|css|js|ico)$/i.test(url.pathname))) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return (await caches.match('./admin.html')) || Response.error();
      }
      return Response.error();
    })
  );
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Pesan baru — Kicks Station';
  const options = {
    body: data.body || 'Ada pesan baru dari pelanggan.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'kicks-station-chat',
    renotify: true,
    requireInteraction: true,
    vibrate: [250, 120, 250, 120, 400],
    data: { url: data.url || './admin.html?openChat=1' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || './admin.html?openChat=1', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        if ('navigate' in client && client.url !== target) await client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
