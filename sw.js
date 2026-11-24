// Party Quest service worker — shows push alerts and opens the right screen when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Party Quest', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Party Quest', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || '#/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL('./' + (e.notification.data?.url || ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
