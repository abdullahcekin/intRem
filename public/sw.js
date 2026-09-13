const CACHE = 'intrem-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('intrem-shell-') && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api') || url.pathname === '/health') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        const copy = response.clone();
        void caches.open(CACHE).then(cache => cache.put('/', copy));
      }
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (!url.pathname.startsWith('/assets/') && !SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Keep notifications generic. */ }
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
  event.waitUntil(self.registration.showNotification('intRem', {
    body: 'Oturumunuzla ilgili bir güncelleme var. Ayrıntıları uygulamada açın.',
    icon: '/icon.svg', badge: '/icon.svg', tag: sessionId ? `session-${sessionId}` : 'intrem-update',
    data: { path: sessionId ? `/?session=${encodeURIComponent(sessionId)}` : '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.path || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url.href); return existing.focus(); }
    return clients.openWindow(url.href);
  }));
});
