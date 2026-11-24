/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('push', (event) => {
  let title = 'MandaoLink precisa de atenção',
    body = 'Abra o painel para conferir as pendências.';
  try {
    const data = event.data?.json();
    title = typeof data?.title === 'string' ? data.title : title;
    body = typeof data?.body === 'string' ? data.body : body;
  } catch {
    // Payload sem JSON: mantém título e texto padrão.
  }
  event.waitUntil(
    self.registration.showNotification(title, { body, tag: 'mandaolink-pendencia', data: { url: '/#operacao' } }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = new URL('/#operacao', self.location.origin).href;
      const existing = windows.find<WindowClient>(
        (client): client is WindowClient => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.navigate(target);
        await existing.focus();
      } else await self.clients.openWindow(target);
    })(),
  );
});
