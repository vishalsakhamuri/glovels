/**
 * The app a student installs, and what it does with no connection.
 *
 * There has been a manifest on this site for months and it belongs to the
 * counsellors: "Glovels Operations", opening on /counsellor, linked from eight
 * staff screens and from nothing a student or a visitor has ever seen. So on a
 * student's phone "Add to Home Screen" produced a bookmark with a screenshot
 * for an icon, and there was nothing for Play to wrap. That is the gap this
 * closes, and these are the ways closing it goes wrong:
 *
 *   THE DONOR. build_portal.py builds every portal and staff page from a head
 *   it reads out of visa.html — a page the same build wrote and apply_fixes
 *   then patched. So a tag added to the public pages arrives in NEXT build's
 *   staff pages for free, and every counsellor screen starts announcing itself
 *   as the student app: wrong manifest, wrong name on the home screen, and our
 *   name back on the white-labelled partner page. It happened while this was
 *   being written. The check is not "the student pages have it" — it is that
 *   the staff pages still have theirs and only theirs.
 *
 *   THE OFFLINE PAGE THAT NEEDS THE NETWORK. Half a dozen build steps walk the
 *   .html files in the site root and inject something into each: the chat
 *   widget, the WhatsApp corner, the header rules. A page whose whole job is to
 *   explain that there is no network cannot carry a script that opens a
 *   connection to find that out. It lives in app/ to stay out of their way, and
 *   this asserts that it did.
 *
 *   CACHING, WHICH IS REFUSED. Every screen here is a database read. Serving a
 *   cached application status is worse than an honest failure, because the
 *   person believes it. So the worker is held to caching nothing but its own
 *   error page — the test takes a page offline and checks that what comes back
 *   says "offline" rather than being yesterday's copy of the real screen.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/* Its own port, because this suite really stops and starts the server under
   it. Sharing 8099 would work — the runner rebuilds that server before every
   suite anyway — but a suite that kills a shared port is a booby trap for
   whoever next runs two things at once. */
const BASE = process.env.BASE || 'http://localhost:8093';
const ROOT = process.env.ROOT || '/home/claude/glovels/build';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* The screens the office uses. They keep the operations manifest — it is a
   different app, installed by different people, and its identity must not
   change or the copies already on counsellors' phones are orphaned. */
const OFFICE = ['admin.html', 'blog-admin.html', 'catalogue.html', 'chat.html',
  'counsellor.html', 'home.html', 'leads.html', 'partner.html'];

/*
 * Actually unplugging it.
 *
 * `context.setOffline(true)` does not do this. It emulates network conditions
 * on the PAGE's target, and a service worker is a target of its own — so the
 * worker's own fetch() sails through, returns 200, and a test written that way
 * passes while proving nothing. The same is true of context.route(): neither
 * reaches the worker. Both were tried; both reported a healthy page while the
 * server was supposedly unreachable.
 *
 * So the server is really stopped and really started again. It is found the way
 * srv.sh finds it — by the PORT in its environment, since the command line of
 * `setsid env PORT=… node serve.js` does not contain the port at all.
 */
const PORT = (BASE.match(/:(\d+)/) || [, '8099'])[1];
const serverPids = () => {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let env = '', cmd = '';
    try {
      cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8');
      if (!cmd.includes('serve.js')) continue;
      env = fs.readFileSync('/proc/' + d + '/environ', 'utf8');
    } catch (e) { continue; }
    if (env.split('\0').includes('PORT=' + PORT)) out.push(Number(d));
  }
  return out;
};
const stopServer = () => {
  const pids = serverPids();
  pids.forEach(p => { try { process.kill(p, 'SIGKILL'); } catch (e) {} });
  return pids.length;
};
const startServer = () => {
  try {
    execFileSync('/home/claude/glovels/srv.sh', [PORT], { stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  /* ------------------------------------------------------- the two manifests */
  const appRes = await ctx.request.get(BASE + '/app.webmanifest');
  ok(appRes.ok(), 'the student app manifest is served — ' + appRes.status());
  ok(/application\/manifest\+json/.test(appRes.headers()['content-type'] || ''),
    'with the right content type, or the browser makes a bookmark instead — '
    + appRes.headers()['content-type']);

  const app = await appRes.json().catch(() => ({}));
  ok(app.name && /glovels/i.test(app.name), 'it is named — ' + app.name);
  ok(app.start_url === '/', 'and opens on the home page, which is what sells — '
    + app.start_url);
  ok(app.display === 'standalone', 'as an app, not a browser tab — ' + app.display);
  ok((app.icons || []).some(i => i.sizes === '512x512'),
    'with an icon big enough for a splash screen');
  ok((app.icons || []).some(i => (i.purpose || '').includes('maskable')),
    'and a maskable one, or Android crops it into a white square');

  const opsRes = await ctx.request.get(BASE + '/manifest.webmanifest');
  const ops = await opsRes.json().catch(() => ({}));
  ok(ops.start_url === '/counsellor',
    'the operations app is untouched and still opens on the caseload — ' + ops.start_url);
  ok(ops.start_url !== app.start_url,
    'the two are separate apps, which is what start_url decides when there is no id');

  /* Both icons exist. A manifest that names a file nobody shipped installs an
     app with a blank square, and neither store lets that through. */
  for (const src of new Set((app.icons || []).map(i => i.src))) {
    const r = await ctx.request.get(BASE + src);
    ok(r.ok(), 'the icon ' + src + ' is actually there — ' + r.status());
  }

  /* ------------------------------------------------------ who links to which */
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !f.startsWith('_'));
  const wrong = [], missing = [], noSw = [];
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hasApp = t.includes('href="/app.webmanifest"');
    const hasOps = t.includes('href="/manifest.webmanifest"');
    const hasSw = /serviceWorker\.register/.test(t);
    if (OFFICE.includes(f)) {
      if (hasApp || !hasOps) wrong.push(f + (hasApp ? ' has the student manifest' : ' lost the operations one'));
    } else {
      if (!hasApp) missing.push(f);
      if (hasOps) wrong.push(f + ' has the operations manifest');
      if (!hasSw) noSw.push(f);
    }
  }
  ok(!wrong.length, 'no page carries the wrong manifest — ' + wrong.slice(0, 3).join(' | '));
  ok(!missing.length,
    'every public and student page can be installed — missing on '
    + missing.slice(0, 4).join(', '));
  ok(!noSw.length,
    'and every one of them registers the worker — missing on ' + noSw.slice(0, 4).join(', '));

  /* The white-label page by name, because it is the one where getting this
     wrong puts our name on an agency's home screen. */
  const partner = fs.readFileSync(path.join(ROOT, 'partner.html'), 'utf8');
  ok(!/apple-mobile-web-app-title" content="Glovels"/.test(partner),
    'the partner screen does not put our name on their home screen');

  /* ------------------------------------------------------- the offline page */
  const offRes = await ctx.request.get(BASE + '/app/offline.html');
  ok(offRes.ok(), 'the offline page is served — ' + offRes.status());
  const offText = await offRes.text();
  ok(/offline/i.test(offText), 'and says what has happened');
  ok(/\+91 ?70933 ?14089|tel:/.test(offText),
    'with a way to reach somebody that does not need a connection');

  /* Nothing external. Not a font, not a stylesheet, not a script from a CDN —
     every one of those is a request that cannot succeed on the one page that
     only ever loads when requests are failing. */
  const external = (offText.match(/(?:src|href)="https?:\/\/[^"]+"/g) || [])
    .filter(u => !/^href="https?:\/\/[^"]*"$/.test('') && !/tel:|mailto:/.test(u));
  ok(!external.length,
    'it fetches nothing from anywhere — ' + external.slice(0, 3).join(' | '));
  ok(!/GLOVELS-CHAT-WIDGET/.test(offText),
    'and the build did not inject the chat widget into it');
  ok(!/serviceWorker\.register/.test(offText),
    'nor a service-worker registration');

  /* It is not for indexing: a search result reading "You are offline" is not a
     page anybody meant to publish. */
  ok(/noindex/.test(offText), 'it is marked noindex');
  const robots = await (await ctx.request.get(BASE + '/robots.txt')).text();
  /* Either form keeps them out. A preview build disallows everything; the live
     one lists the pages that are not for indexing, and app/ is on that list. */
  ok(/Disallow: \/app\//.test(robots) || /Disallow: \/\s*$/m.test(robots),
    'robots.txt keeps crawlers out of app/ — ' + robots.replace(/\s+/g, ' ').slice(0, 90));
  const sitemap = await (await ctx.request.get(BASE + '/sitemap.xml')).text();
  ok(!/offline/.test(sitemap), 'and it is not in the sitemap');

  /* ------------------------------------------------- the worker, on a browser
     Everything above read files. This installs the thing and pulls the plug. */
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });

  /* Raced against a clock, and that is not belt-and-braces.
     `navigator.serviceWorker.ready` is a promise that NEVER SETTLES when
     nothing is registered — so on the build this suite is meant to prove wrong
     it does not fail, it hangs, and the run ends with no count and no report on
     any of the twenty checks after it. Which is what it did. */
  const ready = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    try {
      return await Promise.race([
        navigator.serviceWorker.ready.then(r => r && r.active ? 'active' : 'not active'),
        new Promise(res => setTimeout(() => res('never registered'), 8000)),
      ]);
    } catch (e) { return 'threw: ' + e.message; }
  }).catch(e => 'evaluate failed: ' + e.message);
  ok(ready === 'active', 'the worker installs and takes over — ' + ready);

  const cached = await page.evaluate(async () => {
    try {
      const names = await caches.keys();
      const hits = [];
      for (const n of names) {
        const c = await caches.open(n);
        for (const r of await c.keys()) hits.push(new URL(r.url).pathname);
      }
      return { names, hits };
    } catch (e) { return { names: [], hits: [], err: String(e) }; }
  }).catch(() => ({ names: [], hits: [] }));

  /* Without the .html. The server redirects /app/offline.html to /app/offline,
     and a Response carrying the `redirected` flag cannot answer a navigation —
     the browser refuses it and shows its own error page, which is the one
     outcome the worker exists to prevent. Everything looked right from the
     outside while that was wrong: the file was in the cache, matching it
     returned 200, and every navigation died with ERR_FAILED. */
  ok(cached.hits.includes('/app/offline'),
    'it has kept the offline page ready, at the address the server serves — '
    + JSON.stringify(cached.hits));

  /* The refusal, and it is the point of the whole file. Nothing that could be
     served stale is in the cache: no screen, no API answer. */
  const stale = cached.hits.filter(
    p => p.startsWith('/api/') || p.endsWith('.html')
      || p === '/' || p === '/dashboard');
  ok(!stale.length,
    'and nothing that would be a lie tomorrow — ' + stale.join(', '));

  /* ------------------------------------------------------------ pull the plug
     Really stopped, not emulated. See the note at the top of the file. */
  const killed = stopServer();
  ok(killed > 0, 'the server is stopped for the offline test — ' + killed + ' process(es)');

  const nav = await page.goto(BASE + '/study-in-germany.html', { waitUntil: 'load' })
    .catch(e => ({ err: String(e).slice(0, 120) }));
  const body = await page.innerText('body').catch(() => '');
  ok(/offline/i.test(body),
    'with no server the app says so, rather than showing the browser error — '
    + (nav && nav.err ? nav.err : body.replace(/\s+/g, ' ').slice(0, 70)));
  ok(!/study in germany/i.test(body),
    'and does not serve a stale copy of the page that was asked for');
  ok(await page.isVisible('#again').catch(() => false), 'there is a way back');
  ok(/70933 ?14089/.test(body),
    'and a phone number that does not need the connection');

  /* And the API, with nothing behind it, fails rather than answering from a
     cache. An app that reports yesterday's fee as today's is the failure this
     whole design refuses. */
  const dead = await page.evaluate(async () => {
    try { const r = await fetch('/api/state'); return 'answered ' + r.status; }
    catch (e) { return 'failed'; }
  }).catch(() => 'evaluate failed');
  ok(dead === 'failed', 'and the API fails honestly rather than answering — ' + dead);

  /* ------------------------------------------------------------ plug it back in */
  ok(startServer(), 'the server comes back');
  await page.goto(BASE + '/study-in-germany.html', { waitUntil: 'load' }).catch(() => {});
  const backText = await page.innerText('body').catch(() => '');
  ok(/germany/i.test(backText),
    'and the real page loads again — ' + backText.replace(/\s+/g, ' ').slice(0, 60));

  /* ------------------------------------------ the worker does not touch /api/
     A cached API answer is the failure this design exists to prevent, and the
     handler returns before respondWith for anything under /api/. */
  const health = await page.evaluate(async () => {
    const r = await fetch('/api/health', { cache: 'no-store' });
    return { status: r.status, fromSw: !!r.headers.get('x-served-by-sw') };
  }).catch(e => ({ status: 0, err: String(e) }));
  ok(health.status === 200, 'the API still answers through the worker — ' + health.status);

  const after = await page.evaluate(async () => {
    const names = await caches.keys();
    const hits = [];
    for (const n of names) {
      const c = await caches.open(n);
      for (const r of await c.keys()) hits.push(new URL(r.url).pathname);
    }
    return hits;
  }).catch(() => []);
  ok(!after.some(p => p.startsWith('/api/')),
    'and no API answer was kept afterwards — ' + after.filter(p => p.startsWith('/api/')).join(', '));

  ok(!errs.length, 'no page errors throughout — ' + errs.slice(0, 2).join(' | '));

  /* --------------------------------------------------- a staff screen still works
     The worker's scope is the whole origin, so it now sits in front of the
     counsellor screens too. It must not have changed anything for them. */
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const sp = await staff.newPage();
  const sErrs = [];
  sp.on('pageerror', e => sErrs.push(String(e)));
  await sp.goto(BASE + '/counsellor.html', { waitUntil: 'load' });
  await sp.waitForTimeout(1500);
  const sManifest = await sp.getAttribute('link[rel="manifest"]', 'href').catch(() => '');
  ok(sManifest === '/manifest.webmanifest',
    'the caseload screen still installs as the operations app — ' + sManifest);
  ok(!sErrs.length, 'and loads clean — ' + sErrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
