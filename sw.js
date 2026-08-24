/*
 * The service worker.
 *
 * It exists for one reason: a push notification cannot be delivered without
 * one. There is no caching here and no offline mode — this application talks to
 * a database on every screen, and a cached copy of yesterday's caseload is
 * worse than a page that says it cannot reach the server.
 *
 * So: receive a push, show it, and put the person on the right screen when they
 * tap it. Nothing else.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  /* A push with no payload is still a push worth showing — some services strip
     the body, and "something happened" beats silence. */
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }

  event.waitUntil(self.registration.showNotification(d.title || 'Glovels', {
    body: d.body || 'Something needs you.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    /* One tag per student, so five messages from the same person replace each
       other rather than stacking into a wall of five identical lines. */
    tag: d.tag || 'glovels',
    renotify: true,
    data: { url: d.url || '/counsellor' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/counsellor';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* If the screen is already open somewhere, focus it rather than opening a
       second copy of the same caseload. */
    for (const c of all) {
      if (c.url.includes('/counsellor') || c.url.includes('/admin')) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
