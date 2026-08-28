/*
 * The service worker. Two jobs, and it refuses a third.
 *
 * ONE — push. A push notification cannot be delivered without a service worker
 * at all. Receive it, show it, put the person on the right screen when they tap.
 *
 * TWO — say so when there is no connection. An installed app that drops the
 * device's own "no internet" error page looks broken rather than offline, and
 * Play's review reads that as an app that does not work. So a navigation that
 * cannot reach the server ends on our own page, which explains what happened.
 *
 * THE THIRD, WHICH IS REFUSED — caching the application. Every screen here is a
 * database read: a caseload, an application status, a fee. Serving yesterday's
 * copy of any of those is worse than an honest failure, because the person
 * believes it. So nothing but the offline page and its icon is ever cached, no
 * API response is touched, and a page that loads is always a page the server
 * just sent.
 */

/* The name carries a version. `activate` deletes every cache that is not this
   one, which is what makes a changed offline page actually replace the copy
   sitting on somebody's phone rather than losing to it for ever. Bump it when
   the list below changes. */
const SHELL = 'glovels-shell-v1';
/* Without the .html, deliberately.
 *
 * The server answers /app/offline.html with a 301 to /app/offline, and a
 * Response that carries the `redirected` flag CANNOT be used to answer a
 * navigation — the browser refuses it and shows its own error page, which is
 * the precise outcome this handler exists to prevent. Everything looked right
 * from the outside: the file was in the cache, matching it returned 200, and
 * every navigation still died with ERR_FAILED. Precaching the address the
 * server actually serves is the fix; the guard below is the second one. */
const OFFLINE = '/app/offline';
const KEEP = [OFFLINE, '/icon-192.png', '/favicon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* One at a time rather than addAll: addAll is atomic, so one missing file
       fails the whole install and the worker never activates — taking push
       notifications down with it over a favicon. */
    await Promise.all(KEEP.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== SHELL).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  /* Only ever a page the person navigated to. Not a stylesheet, not an image,
     and emphatically not /api/ — those go to the network untouched, with no
     respondWith at all, so the browser handles them exactly as it did before
     this handler existed. */
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  if (new URL(req.url).pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      /* The network, every time. Whatever comes back is what the server said
         just now, which is the whole point. */
      return await fetch(req);
    } catch (e) {
      /* It did not come back. Our page rather than the browser's. */
      let cached = null;
      try { cached = await caches.match(OFFLINE); } catch (e2) { cached = null; }
      /* The guard, in case somebody changes that address back. A redirected
         response is copied into a fresh one rather than handed over as it is. */
      if (cached && cached.redirected) {
        try {
          cached = new Response(await cached.blob(),
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (e3) { cached = null; }
      }
      return cached || new Response(
        '<!doctype html><meta charset="utf-8"><title>No connection</title>'
        + '<p style="font:16px system-ui;padding:24px">You are offline. '
        + 'Try again when you have a connection.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});

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
