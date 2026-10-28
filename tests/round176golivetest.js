/*
 * Round 176 — go-live readiness (28 Oct).
 *
 * Everything the office cannot check from a browser on launch day, checked
 * here: the indexing switch, one canonical host, the legal pages with no
 * particulars, the mail / payments / analytics states, the readiness report
 * and card, the QA clean-up, the backups, and the security headers.
 *
 *   tests/srv.sh 8125 ALLOW_INDEXING=true GLOVELS_URL=https://glovels.com WHATSAPP_APP_SECRET=testsecret
 *   BASE=http://localhost:8125 node tests/round176golivetest.js
 *
 * Section F starts a second server of its own (port 8126) in PRODUCTION mode
 * to see the HSTS header and the [golive] start-up lines as Render will.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8125';
const SITE = 'https://glovels.com';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@glovels.com', password: process.env.ADMIN_PASSWORD || 'glovels123' };
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e === undefined ? '' : e).slice(0, 300))); };

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body, headers) {
  ips[who] = ips[who] || ('10.176.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': ips[who] }, headers || {});
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text, headers: r.headers };
}
const get = (p, headers) => fetch(BASE + p, { redirect: 'manual', headers: headers || {} });
/* fetch() drops a Host header (undici treats it as forbidden), so the one-host
   checks go through http.request, which sends exactly what it is given. */
const http = require('http');
const raw = (base, p, headers, method) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const rq = http.request({ host: u.hostname, port: u.port, path: p, method: method || 'GET', headers: headers || {} }, res => {
    let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: body }));
  });
  rq.on('error', reject); rq.end(method === 'POST' ? '{}' : undefined);
});
const meta = (html, name) => (new RegExp('<meta name="' + name + '" content="([^"]*)"').exec(html) || [])[1] || '';
const canonical = html => (/<link rel="canonical" href="([^"]*)"/.exec(html) || [])[1] || '';

(async () => {
  /* ------------------------------------------------------------- A */
  console.log('A. the indexing switch (ALLOW_INDEXING=true GLOVELS_URL=' + SITE + ')');
  const robots = await (await get('/robots.txt')).text();
  ok('robots.txt allows and names the sitemap', /Allow: \//.test(robots) && robots.includes('Sitemap: ' + SITE + '/sitemap.xml') && !/^Disallow: \/$/m.test(robots), robots.slice(0, 200));
  ok('robots.txt keeps the portal out', /Disallow: \/api\//.test(robots) && /Disallow: \/admin/.test(robots) && /Disallow: \/login/.test(robots));
  const smR = await get('/sitemap.xml');
  const sm = await smR.text();
  ok('sitemap.xml answers 200 as XML', smR.status === 200 && /xml/.test(smR.headers.get('content-type') || ''), smR.status);
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  ok('every sitemap address is on ' + SITE, locs.length > 30 && locs.every(l => l.startsWith(SITE + '/')), locs.filter(l => !l.startsWith(SITE)).slice(0, 3));
  for (const p of ['/', '/about-us', '/contact-us', '/blog', '/university', '/find-university', '/study-in-germany', '/success-stories', '/terms', '/privacy']) {
    ok('sitemap lists ' + p, locs.includes(SITE + (p === '/' ? '/' : p)));
  }
  ok('sitemap lists university pages', locs.some(l => /\/university\/[a-z0-9-]+$/.test(l)));
  ok('sitemap lists /post/ pages', locs.some(l => /\/post\/[a-z0-9-]+$/.test(l)));
  ok('sitemap lists every study-in page', locs.filter(l => /\/study-in-/.test(l)).length >= 7, locs.filter(l => /\/study-in-/.test(l)).length);
  ok('sitemap never lists a portal page', !locs.some(l => /\/(dashboard|admin|counsellor|login|leads|catalogue|home|chat)$/.test(l)));

  const uniSlug = (locs.find(l => /\/university\/[a-z0-9-]+$/.test(l)) || '').replace(SITE, '');
  const postSlug = (locs.find(l => /\/post\/[a-z0-9-]+$/.test(l)) || '').replace(SITE, '');
  for (const p of ['/', '/about-us', '/study-in-germany', '/blog', '/university', uniSlug, postSlug, '/find-university', '/success-stories', '/terms']) {
    if (!p) { ok('a page to test', false, 'no slug'); continue; }
    const r = await get(p);
    const html = await r.text();
    ok(p + ' is index,follow', r.status === 200 && /^index,follow/.test(meta(html, 'robots')), r.status + ' ' + meta(html, 'robots'));
    const want = SITE + (p === '/' ? '/' : p);
    ok(p + ' canonical is ' + want, canonical(html) === want, canonical(html));
  }
  for (const p of ['/login', '/dashboard', '/admin', '/counsellor', '/leads', '/home', '/catalogue', '/chat', '/blog-admin', '/partner']) {
    const html = await (await get(p)).text();
    ok(p + ' stays noindex', /^noindex/.test(meta(html, 'robots')), meta(html, 'robots'));
  }
  /* JSON-LD parses on the three page kinds that carry it: the home page
     (Organization), a university page, and a published post (Article). */
  await req('a', 'POST', '/api/auth/login', ADMIN);
  const written = await req('a', 'POST', '/api/staff/posts', { title: 'Go-live post ' + Date.now(), status: 'published', author: 'Priya Menon',
    publishedAt: '2026-10-28', excerpt: 'A post written on launch day to check the article markup is there.', tag: 'Germany',
    body: '<p>A paragraph long enough to be a post. ' + 'Public universities in Germany charge no tuition. '.repeat(12) + '</p>' });
  const livePost = written.body && written.body.post && written.body.post.slug;
  ok('a published post exists for the check', !!livePost, written.status + ' ' + written.text.slice(0, 120));
  for (const p of ['/', uniSlug, livePost ? '/post/' + livePost : postSlug]) {
    const html = await (await get(p)).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    let good = blocks.length > 0;
    blocks.forEach(b => { try { JSON.parse(b); } catch (e) { good = false; } });
    ok(p + ' JSON-LD is valid JSON (' + blocks.length + ' block(s))', good, blocks.length ? blocks[0].slice(0, 80) : 'none');
  }

  /* ------------------------------------------------------------- B */
  console.log('B. one host');
  let r = await raw(BASE, '/study-in-germany?x=1', { Host: 'www.glovels.com' });
  ok('www.glovels.com → 301 ' + SITE + ' (same path+query)', r.status === 301 && r.headers.location === SITE + '/study-in-germany?x=1', r.status + ' ' + r.headers.location);
  r = await raw(BASE, '/blog', { Host: 'glovels.onrender.com' });
  ok('glovels.onrender.com → 301 ' + SITE + '/blog', r.status === 301 && r.headers.location === SITE + '/blog', r.status + ' ' + r.headers.location);
  r = await raw(BASE, '/api/health', { Host: 'glovels.onrender.com' });
  ok('/api/health is never redirected (the host\'s checker)', r.status === 200, r.status);
  r = await raw(BASE, '/', { Host: 'glovels.com' });
  ok('glovels.com itself is served', r.status === 200, r.status);
  r = await raw(BASE, '/', { Host: 'localhost:8125' });
  ok('localhost is never redirected', r.status === 200, r.status);
  r = await raw(BASE, '/', { Host: '127.0.0.1' });
  ok('a bare IP is never redirected', r.status === 200, r.status);
  r = await raw(BASE, '/api/enquiries', { Host: 'www.glovels.com', 'content-type': 'application/json', 'x-forwarded-for': '10.176.200.1' }, 'POST');
  ok('a POST is answered, not redirected (no silent form loss)', r.status !== 301 && r.status !== 302, r.status);

  /* ------------------------------------------------------------- C */
  console.log('C. security headers');
  r = await get('/');
  const csp = r.headers.get('content-security-policy') || '';
  ok('CSP on HTML', csp.includes("default-src 'self'"), csp.slice(0, 80));
  ok("no 'unsafe-eval'", !csp.includes('unsafe-eval'));
  ok('X-Frame-Options + Referrer-Policy + nosniff', r.headers.get('x-frame-options') === 'SAMEORIGIN' && !!r.headers.get('referrer-policy') && r.headers.get('x-content-type-options') === 'nosniff');
  for (const p of ['/.git/config', '/server/api.js', '/data/glovels.db', '/tests/runtests.sh']) {
    const rr = await get(p);
    ok(p + ' is ' + rr.status, rr.status === 404 || rr.status === 403, rr.status);
  }

  /* ------------------------------------------------------------- D */
  console.log('D. the legal pages with nothing typed');
  r = await req('a', 'POST', '/api/auth/login', ADMIN);
  ok('the administrator signs in', r.status === 200, r.status + ' ' + r.text.slice(0, 100));
  /* Make sure the particulars are blank first (a previous run may have typed them). */
  r = await req('a', 'PUT', '/api/staff/content/legal', { value: {}, allowEmpty: true });
  ok('legal particulars cleared for the test', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  for (const p of ['/terms', '/privacy', '/refunds', '/grievance']) {
    const rr = await get(p);
    const html = await rr.text();
    ok(p + ' renders with the "Company details are being updated" block', rr.status === 200 && html.includes('data-legal-notice') && html.includes('Company details are being updated'), rr.status);
    ok(p + ' still has its heading and body', /<h1>/.test(html) && html.length > 20000, html.length);
  }
  const legal = { entity: 'Glovels Consultants Private Limited', cin: 'U80903TG2019PTC176001', gstin: '36AAACG1234A1Z5',
    address: '1-2-3 Road No 1\nBanjara Hills\nHyderabad 500034', effective: '1 November 2026', jurisdiction: 'Hyderabad, Telangana',
    invoiceSeries: 'GLV/26-27/', officer: { name: 'Ravi Kumar', designation: 'Grievance Officer', email: 'grievance@glovels.com', phone: '+91 98765 43210' } };
  r = await req('a', 'PUT', '/api/staff/content/legal', { value: legal });
  ok('Home page → Legal saves every field', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  const back = (await req('a', 'GET', '/api/content')).body.legal || {};
  ok('…and reads them all back', back.cin === legal.cin && back.gstin === legal.gstin && back.invoiceSeries === legal.invoiceSeries && back.officer && back.officer.phone === legal.officer.phone, JSON.stringify(back).slice(0, 200));
  for (const p of ['/terms', '/grievance']) {
    const html = await (await get(p)).text();
    ok(p + ' no longer carries the placeholder block', !html.includes('data-legal-notice'));
  }
  let gl = (await req('a', 'GET', '/api/staff/golive')).body;
  const legalItem = (gl.items || []).find(i => i.key === 'legal') || {};
  ok('readiness says the legal particulars are complete', legalItem.level === 'ok', JSON.stringify(legalItem));

  /* ------------------------------------------------------------- E */
  console.log('E. the readiness report, mail, payments, analytics, backups');
  r = await req('v', 'GET', '/api/staff/golive');
  ok('/api/staff/golive needs a sign-in', r.status === 401, r.status);
  ok('the report answers for an admin with every item', gl.ok === true && ['url', 'indexing', 'email', 'payments', 'analytics', 'legal', 'backups', 'disk', 'catalogue', 'staff', 'qa'].every(k => (gl.items || []).some(i => i.key === k)), JSON.stringify((gl.items || []).map(i => i.key)));
  const item = k => (gl.items || []).find(i => i.key === k) || {};
  ok('url item names ' + SITE, item('url').value === SITE, item('url').value);
  ok('indexing item is green', item('indexing').level === 'ok', JSON.stringify(item('indexing')));
  ok('email item says Brevo not configured — outbox', /Brevo not configured/.test(item('email').value) && item('email').level === 'warn', JSON.stringify(item('email')));
  ok('payments item says not configured, with the env names in the hint', /not configured/.test(item('payments').value) && /RAZORPAY_KEY_ID/.test(item('payments').hint), JSON.stringify(item('payments')));
  ok('analytics item says no GA id', /no GA id/.test(item('analytics').value), JSON.stringify(item('analytics')));
  ok('backups item says the folder is writable', /writable/.test(item('backups').value) && item('backups').level !== 'bad', JSON.stringify(item('backups')));
  ok('catalogue item counts programmes', /\d+ programmes/.test(item('catalogue').value), item('catalogue').value);
  ok('staff item counts administrators', /administrator/.test(item('staff').value), item('staff').value);

  const ms = (await req('a', 'GET', '/api/staff/mail')).body;
  ok('Organisation → Email says outbox', ms.mode === 'outbox', ms.mode);
  const pc = (await req('v', 'GET', '/api/pay/config')).body;
  ok('/api/pay/config says payments are off', pc.enabled === false, JSON.stringify(pc));
  r = await req('v', 'POST', '/api/orders', { name: 'Golive Buyer', email: 'golive-buyer-' + Date.now() + '@example.com', phone: '9876501234', acceptedTerms: true, packageId: 'pkg-roadmap' });
  ok('an order without a gateway is recorded, not paid (no JS error path)', r.status === 200 || r.status === 201, r.status + ' ' + r.text.slice(0, 150));
  ok('…and the answer does not claim a payment', !(r.body.paid === true) && !(r.body.order && r.body.order.gateway_payment_id), JSON.stringify(r.body).slice(0, 150));
  /* Analytics: the GA tag goes on when an id is typed, public pages only. */
  r = await req('a', 'PUT', '/api/staff/analytics', { gaId: 'G-GOLIVE176' });
  ok('a GA id is accepted', r.status === 200, r.text.slice(0, 100));
  let html = await (await get('/about-us')).text();
  ok('the GA snippet is on a public page', html.includes('googletagmanager.com/gtag/js?id=G-GOLIVE176'));
  html = await (await get('/dashboard')).text();
  ok('…never on the portal', !html.includes('googletagmanager.com'));
  html = await (await get('/admin')).text();
  ok('…never on the office', !html.includes('googletagmanager.com'));
  gl = (await req('a', 'GET', '/api/staff/golive')).body;
  ok('readiness analytics item turns green', (gl.items.find(i => i.key === 'analytics') || {}).level === 'ok');
  r = await req('a', 'PUT', '/api/staff/analytics', { gaId: '' });
  html = await (await get('/about-us')).text();
  ok('cleared: nothing renders', r.status === 200 && !html.includes('googletagmanager.com'));
  /* Backups: take one, list it, download it. */
  r = await req('a', 'POST', '/api/staff/backups', {});
  ok('a backup copy is taken on demand', r.status === 200 && /^glovels-\d{4}-\d{2}-\d{2}\./.test(r.body.file || ''), r.text.slice(0, 120));
  gl = (await req('a', 'GET', '/api/staff/golive')).body;
  ok('readiness shows the last backup time', /last copy glovels-\d{4}-\d{2}-\d{2}\.\w+ at \d{4}-\d{2}-\d{2}/.test((gl.items.find(i => i.key === 'backups') || {}).value), (gl.items.find(i => i.key === 'backups') || {}).value);
  r = await fetch(BASE + '/api/staff/backup.tar', { headers: { cookie: jar.a } });
  const tar = Buffer.from(await r.arrayBuffer());
  ok('the admin download works and is a tar', r.status === 200 && /x-tar/.test(r.headers.get('content-type') || '') && tar.length > 1024 && tar.slice(257, 262).toString() === 'ustar', r.status + ' ' + tar.length);
  r = await fetch(BASE + '/api/staff/backup.tar');
  ok('the download needs a sign-in', r.status === 401, r.status);

  /* ------------------------------------------------------------- F */
  console.log('F. traffic ignores the office and the QA browsers');
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const campaign = 'c176-' + Date.now();
  const stamp = '/about-us?utm_source=golive176&utm_medium=test&utm_campaign=' + campaign;
  await get(stamp, { 'user-agent': UA, cookie: jar.a, 'x-forwarded-for': '203.0.176.1' });
  await get(stamp, { 'user-agent': 'GlovelsQA/1.0 ' + UA, 'x-forwarded-for': '203.0.176.2' });
  let tr = (await req('a', 'GET', '/api/staff/traffic?days=1')).body;
  const camp = (tr.campaigns || []).find(c => String(c.name || '').startsWith(campaign));
  ok('neither the admin\'s visit nor the QA browser was counted', !camp, JSON.stringify(camp));
  await get(stamp, { 'user-agent': UA, 'x-forwarded-for': '203.0.176.3' });
  tr = (await req('a', 'GET', '/api/staff/traffic?days=1')).body;
  ok('a plain visitor still is', (tr.campaigns || []).some(c => String(c.name || '').startsWith(campaign)), JSON.stringify(tr.campaigns || []).slice(0, 200));

  /* ------------------------------------------------------------- G */
  console.log('G. the QA clean-up');
  const tag = String(Date.now()).slice(-6);
  const mk = async (who, name, email) => {
    const rr = await req(who, 'POST', '/api/auth/signup', { name, email, phone: '98765' + tag.slice(0, 5), password: 'a-long-password-' + tag, terms: true, acceptedTerms: true });
    return rr.status;
  };
  ok('QA student 1 (@example.com) signs up', (await mk('q1', 'QA Student One', 'qa1-' + tag + '@example.com')) === 200 || jar.q1);
  ok('QA student 2 (-sudhin) signs up', (await mk('q2', 'Priya Test-Sudhin', 'priya+sudhin' + tag + '@gmail.com')) === 200 || jar.q2);
  ok('a real-looking student signs up', (await mk('real', 'Ananya Rao', 'ananya.rao.' + tag + '@gmail.com')) === 200 || jar.real);
  r = await req('q1', 'POST', '/api/orders', { name: 'QA Student One', email: 'qa1-' + tag + '@example.com', phone: '9876543210', acceptedTerms: true, packageId: 'pkg-roadmap' });
  ok('QA student 1 places an unpaid order', r.status === 200 || r.status === 201, r.status + ' ' + r.text.slice(0, 100));
  r = await req('lead', 'POST', '/api/enquiries', { name: 'Test Lead ' + tag, email: 'lead-' + tag + '@example.com', phone: '9876543211', consent: 'yes' });
  ok('a QA enquiry is filed', r.status === 200 || r.status === 201, r.status + ' ' + r.text.slice(0, 100));
  r = await req('a', 'POST', '/api/staff/people', { name: 'Test Counsellor ' + tag, email: 'testc-' + tag + '@glovels.com', role: 'counsellor', password: 'a-long-password-' + tag });
  ok('a test staff account exists', r.status === 200 || r.status === 201, r.status + ' ' + r.text.slice(0, 100));

  r = await req('v', 'GET', '/api/staff/qa/preview');
  ok('the preview needs a sign-in', r.status === 401 || r.status === 403, r.status);
  r = await req('a', 'GET', '/api/staff/qa/preview');
  const pv = r.body;
  ok('the preview lists counts per table and the names', r.status === 200 && pv.counts && pv.total >= 4 && pv.confirmWith === 'DELETE QA DATA', r.text.slice(0, 200));
  const mails = (pv.students || []).map(s => s.email);
  ok('both QA students are on it', mails.includes('qa1-' + tag + '@example.com') && mails.includes('priya+sudhin' + tag + '@gmail.com'), mails.join(','));
  ok('the real-looking student is NOT', !mails.includes('ananya.rao.' + tag + '@gmail.com'));
  ok('the test counsellor is on it', (pv.staff || []).some(s => s.email === 'testc-' + tag + '@glovels.com'), JSON.stringify(pv.staff));
  ok('the administrator is NOT', !(pv.staff || []).some(s => s.email === ADMIN.email));
  ok('the QA enquiry is on it', (pv.enquiries || []).some(e => e.email === 'lead-' + tag + '@example.com'));
  ok('the unpaid QA order is on it', (pv.orders || []).some(o => o.email === 'qa1-' + tag + '@example.com'));
  gl = (await req('a', 'GET', '/api/staff/golive')).body;
  ok('readiness flags the test data still present', (gl.items.find(i => i.key === 'qa') || {}).level === 'warn', JSON.stringify(gl.items.find(i => i.key === 'qa')));

  r = await req('a', 'POST', '/api/staff/qa/purge', { confirm: 'delete qa data' });
  ok('the wrong phrase removes nothing (422)', r.status === 422, r.status);
  r = await req('a', 'GET', '/api/staff/qa/preview');
  ok('…and the list is unchanged', r.body.total === pv.total, r.body.total + ' vs ' + pv.total);
  r = await req('q2', 'POST', '/api/staff/qa/purge', { confirm: 'DELETE QA DATA' });
  ok('a student cannot purge', r.status === 401 || r.status === 403, r.status);
  r = await req('a', 'POST', '/api/staff/qa/purge', { confirm: 'DELETE QA DATA' });
  ok('the typed phrase purges', r.status === 200 && r.body.removed && r.body.removed.students >= 2 && r.body.removed.staff >= 1 && r.body.removed.enquiries >= 1 && r.body.removed.orders >= 1, r.text.slice(0, 250));
  r = await req('a', 'GET', '/api/staff/qa/preview');
  ok('nothing left to preview', r.status === 200 && r.body.total === 0, r.body.total);
  r = await req('real', 'GET', '/api/auth/me');
  ok('the real-looking student is still signed in and intact', r.status === 200 && r.body.user && /ananya/.test(r.body.user.email), r.status + ' ' + r.text.slice(0, 100));
  r = await req('q1', 'GET', '/api/auth/me');
  ok('QA student 1 is gone', r.status === 401 || !(r.body.user), r.status);
  const org = (await req('a', 'GET', '/api/staff/content')).body;
  ok('the audit trail records it', (org.audit || []).some(a => /QA test data removed/.test(a.what || '')), JSON.stringify((org.audit || []).slice(0, 2)));

  /* ------------------------------------------------------------- H */
  console.log('H. the Organisation screen carries the card and the button');
  for (const [file, label] of [['admin.html', 'admin.html'], ['portal_admin.py', 'portal_admin.py']]) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    ok(label + ' has the Settings tab, the readiness card, the backup download and the QA button',
      src.includes('data-o="settings"') && src.includes('id="goliveCard"') && src.includes('href="/api/staff/backup.tar"') && src.includes('id="qaPreview"') && src.includes('/api/staff/qa/purge') && src.includes("'/api/staff/golive'"));
  }

  /* ------------------------------------------------------------- I */
  console.log('I. production mode: HSTS and the [golive] start-up lines (own server, port 8126)');
  const PPORT = 8126;
  const pdir = '/tmp/db-' + PPORT;
  fs.rmSync(pdir, { recursive: true, force: true }); fs.mkdirSync(pdir, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PPORT), DATA_DIR: pdir, GLOVELS_ENV: 'production', GLOVELS_URL: SITE,
    ADMIN_EMAIL: 'owner@glovels.com', ADMIN_PASSWORD: 'a-long-admin-password-176', RAZORPAY_KEY_ID: 'rzp_live_golive176', RAZORPAY_KEY_SECRET: 'x'.repeat(20),
    RAZORPAY_WEBHOOK_SECRET: 'hook176', BREVO_API_KEY: 'xkeysib-golive-176', MAIL_FROM: 'Glovels <info@glovels.com>', GA_ID: 'G-ENV176' });
  delete env.BASE; delete env.ALLOW_INDEXING;
  let log = '';
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await new Promise(res => setTimeout(res, 500));
    try { up = (await fetch('http://localhost:' + PPORT + '/api/health')).ok; } catch (e) {}
  }
  ok('a production server starts with live keys, Brevo and GA from the environment', up, log.slice(-400));
  if (up) {
    const pr = await fetch('http://localhost:' + PPORT + '/', { headers: { 'x-forwarded-proto': 'https', host: 'glovels.com' }, redirect: 'manual' });
    ok('HSTS header on https', /max-age=31536000/.test(pr.headers.get('strict-transport-security') || ''), pr.headers.get('strict-transport-security'));
    ok('CSP carries upgrade-insecure-requests', /upgrade-insecure-requests/.test(pr.headers.get('content-security-policy') || ''));
    const phtml = await pr.text();
    ok('indexing defaults ON with GLOVELS_URL in production', /^index,follow/.test(meta(phtml, 'robots')), meta(phtml, 'robots'));
    ok('GA_ID from the environment renders the tag', phtml.includes('gtag/js?id=G-ENV176'));
    const rr = await raw('http://localhost:' + PPORT, '/', { Host: 'glovels.onrender.com' });
    ok('onrender.com → 301 glovels.com in production', rr.status === 301 && rr.headers.location === SITE + '/', rr.status + ' ' + rr.headers.location);
    await new Promise(res => setTimeout(res, 300));
    ok('[golive] payments: LIVE keys, webhook secret set', /\[golive\] payments: LIVE keys, webhook secret set/.test(log), (log.match(/\[golive\] payments[^\n]*/) || [])[0]);
    ok('[golive] email: configured (Brevo) from BREVO_API_KEY', /\[golive\] email: configured \(Brevo\)/.test(log), (log.match(/\[golive\] email[^\n]*/) || [])[0]);
    ok('[golive] analytics names the GA id', /\[golive\] analytics: GA id G-ENV176/.test(log), (log.match(/\[golive\] analytics[^\n]*/) || [])[0]);
    ok('[golive] legal details missing: … is logged', /\[golive\] legal details missing: .*CIN/.test(log), (log.match(/\[golive\] legal[^\n]*/) || [])[0]);
    ok('[golive] url line says indexing ON and the host redirect', /\[golive\] url: https:\/\/glovels\.com — indexing ON — other hosts 301 → glovels\.com/.test(log), (log.match(/\[golive\] url[^\n]*/) || [])[0]);
    ok('[golive] readiness summary line', /\[golive\] readiness: (OK|WARN|BAD)/.test(log));
  }
  child.kill('SIGINT');
  await new Promise(res => setTimeout(res, 500));
  try { child.kill('SIGKILL'); } catch (e) {}

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
