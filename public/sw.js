/* Xo Bot PWA service worker — push notifications only (no API caching; SaaS-safe). */

const SW_VERSION = 'xobot-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('xobot-') && key !== SW_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/** Network-only — never cache authenticated /api responses. */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }
  // Let the browser handle navigation/assets normally (no offline cache of merchant data).
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Xo Bot',
    body: 'لديك إشعار جديد',
    url: '/app/notifications',
    tag: 'xobot-default',
    type: 'info',
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (_) {
    try {
      const text = event.data && event.data.text();
      if (text) payload.body = text;
    } catch (_) {
      /* ignore */
    }
  }

  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'xobot-default',
    renotify: true,
    requireInteraction: payload.type === 'escalation' || payload.data?.kind === 'escalation',
    data: {
      url: payload.url || '/app/notifications',
      notificationId: payload.notificationId || null,
      type: payload.type || 'info',
      ...(payload.data || {}),
    },
    lang: 'ar',
    dir: 'rtl',
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'Xo Bot', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/app/notifications';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(targetUrl);
            } catch (_) {
              /* ignore */
            }
          } else {
            client.postMessage({ type: 'XOBOT_NAVIGATE', url: targetUrl });
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
