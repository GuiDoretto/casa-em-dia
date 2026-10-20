/* Push only: no page or API caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 400) : 'Você tem atividades esperando seu cuidado. Abra a agenda para conferir.';
  event.waitUntil(self.registration.showNotification('Casa em Dia', {
    body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: 'casa-tarefas', data: { view: 'home' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (current) {
      await current.focus();
      current.postMessage({ type: 'OPEN_TASKS' });
      return;
    }
    await self.clients.openWindow('/#home');
  })());
});
