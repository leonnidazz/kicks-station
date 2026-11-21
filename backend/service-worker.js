const CACHE_NAME = 'kicks-station-shell-v11';
const APP_SHELL = [
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
  // Service worker hanya melayani panel admin; halaman toko tidak disentuh.
  if (!/\/(admin\.html|manifest\.webmanifest|icons\/[^/]+)$/i.test(url.pathname)) return;

  // Network-first: halaman admin tetap diperbarui dari server; cache hanya fallback offline.
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
  const title = data.title || 'Kicks Station';
  const kind = data.kind || 'chat';
  const options = {
    body: data.body || 'Ada pesan baru.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'kicks-station-chat',
    renotify: true,
    silent: false,
    // Admin: popup bertahan sampai dibuka. Pelanggan: popup biasa seperti chat.
    requireInteraction: data.requireInteraction !== false,
    vibrate: [250, 120, 250, 120, 400],
    timestamp: Date.now(),
    data: { url: data.url || './admin.html?openChat=1', kind }
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Jika halaman sedang terbuka, minta halaman langsung menyegarkan data (tanpa menunggu polling).
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach(client => { try { client.postMessage({ type: 'ks-push', kind }); } catch (_) {} });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || './admin.html?openChat=1';
  const target = new URL(raw, self.registration.scope).href;
  const normalize = path => path.replace(/\/index\.html$/, '/');
  const targetPath = normalize(new URL(target).pathname);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin !== self.location.origin) continue;
      // Hanya pakai jendela yang halamannya sama (admin tidak boleh dibelokkan ke toko, dan sebaliknya).
      if (normalize(url.pathname) !== targetPath) continue;
      if ('navigate' in client && client.url !== target) await client.navigate(target).catch(() => {});
      return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
