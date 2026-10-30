/**
 * Round 178 — go-live SEO: robots, sitemap dates, llms.txt, structured data,
 * one address (www), the blog's fixed dates and the "significant update"
 * switch, the test / off-topic review and "Archive selected", and no
 * catalogue-size counts in public copy.
 *
 *   tests/srv.sh 8134 ALLOW_INDEXING=true GLOVELS_URL=https://www.glovels.com
 *   BASE=http://localhost:8134 node tests/round178seotest.js
 *
 * A second, plain (staging) server is started by the test itself on 8935.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const BASE = process.env.BASE || 'http://localhost:8134';
const SITE = 'https://www.glovels.com';
const ROOT = path.join(__dirname, '..');
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@glovels.com', password: process.env.ADMIN_PASSWORD || 'glovels123' };
const TODAY = new Date().toISOString().slice(0, 10);
const S = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (m, c, detail) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m + (detail !== undefined ? ' — ' + String(detail).slice(0, 300) : '')); } };

let cookie = '';
async function req(method, p, body) {
  const h = { 'content-type': 'application/json', 'x-forwarded-for': '10.178.1.' + (1 + (S.charCodeAt(0) % 200)) };
  if (cookie) h.cookie = cookie;
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  const sess = set.map(c => c.split(';')[0]).filter(c => /^glovels_session=./.test(c));
  if (sess.length) cookie = sess.join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text, headers: r.headers };
}
const anon = (p, base) => fetch((base || BASE) + p, { redirect: 'manual' });
/* fetch() will not send a Host header; http.request sends what it is given. */
const raw = (base, p, headers) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const rq = http.request({ host: u.hostname, port: u.port, path: p, method: 'GET', headers: headers || {} }, res => {
    let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: b }));
  });
  rq.on('error', reject); rq.end();
});
const lds = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => {
  try { return JSON.parse(m[1]); } catch (e) { return { invalid: m[1].slice(0, 80) }; }
});
const metaProp = (html, prop) => (new RegExp('<meta property="' + prop + '" content="([^"]*)"').exec(html) || [])[1] || '';
const byline = html => ((/<div class="byline">([\s\S]*?)<\/div>/.exec(html) || [])[1] || '').replace(/<[^>]+>/g, ' ');
const lastmodOf = (xml, loc) => (new RegExp('<loc>' + loc.replace(/[.?*+^$()|[\]\\]/g, '\\$&') + '</loc><lastmod>([^<]*)</lastmod>').exec(xml) || [])[1] || '';
const visible = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  /* ===================================================== A. robots (production) */
  console.log('A. robots.txt, sitemap.xml, llms.txt (production)');
  let r = await anon('/robots.txt');
  const robots = await r.text();
  ['*', 'GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Bingbot'].forEach(ua =>
    ok('robots names User-agent: ' + ua, new RegExp('^User-agent: ' + ua.replace('*', '\\*') + '$', 'm').test(robots), robots.slice(0, 200)));
  {
    const rules = robots.split('\n').filter(l => /^(User-agent|Disallow|Allow):/.test(l));
    const firstRule = rules.findIndex(l => !/^User-agent:/.test(l));
    ok('robots: one group — no crawler gets a group of its own that drops the portal rules',
      firstRule > 0 && !rules.slice(firstRule).some(l => /^User-agent:/.test(l)), rules.slice(0, 3).join(' | '));
  }
  ok('robots allows the public pages', /^Allow: \/$/m.test(robots));
  ok('robots Sitemap line on GLOVELS_URL', robots.includes('Sitemap: ' + SITE + '/sitemap.xml'), robots.slice(-120));
  ok('robots no longer blocks /visa-processing with a bare /visa prefix', !/^Disallow: \/visa$/m.test(robots) && /^Disallow: \/visa\$$/m.test(robots));

  r = await anon('/llms.txt');
  const llms = await r.text();
  ok('/llms.txt answers 200 as plain text', r.status === 200 && /^text\/plain/.test(r.headers.get('content-type') || ''), r.status + ' ' + r.headers.get('content-type'));
  ok('llms.txt says who Glovels is', /^# Glovels\n/.test(llms) && /Hyderabad/.test(llms) && /study-abroad/i.test(llms));
  ok('llms.txt carries the contact page phone and email', /\+91 78393 99999/.test(llms) && /info@glovels\.com/.test(llms));
  ['/study-in-germany', '/find-university', '/success-stories', '/contact-us', '/visa-processing', '/work-opportunity-card', '/blog']
    .forEach(p => ok('llms.txt links ' + p + ' on the www address', llms.includes('](' + SITE + p + ')')));
  ok('llms.txt has no catalogue-size count', !/\d[\d,]*\+?\s+programmes/i.test(llms));

  /* ===================================================== sign in, seed posts */
  r = await req('POST', '/api/auth/login', ADMIN);
  ok('the office can sign in', r.status === 200, r.status + ' ' + r.text.slice(0, 120));

  const old = (await req('POST', '/api/staff/posts', { title: 'Blocked account in 2024 ' + S, body: 'How the blocked account worked in 2024, step by step, for Indian students.',
    status: 'published', author: 'Priya Menon', publishedAt: '2024-05-12' })).body.post;
  ok('an old post is published with its stated date', old && String(old.publishedAt).startsWith('2024-05-12'), JSON.stringify(old && old.publishedAt));

  let xml = await (await anon('/sitemap.xml')).text();
  ok('sitemap lastmod of an old post is its own date, not today', lastmodOf(xml, SITE + '/post/' + old.slug) === '2024-05-12', lastmodOf(xml, SITE + '/post/' + old.slug));
  ok('every lastmod in the sitemap is a date', [...xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].every(m => /^\d{4}-\d{2}-\d{2}$/.test(m[1])));
  ok('the home page carries a lastmod', !!lastmodOf(xml, SITE + '/'));

  /* ===================================================== B. the post page */
  console.log('B. BlogPosting, fixed datePublished, the significant-update switch');
  let html = await (await anon('/post/' + old.slug)).text();
  let bp = lds(html).find(x => x['@type'] === 'BlogPosting');
  ok('/post/<slug> is the route and renders', !!bp, html.slice(0, 120));
  ok('BlogPosting datePublished is the stored one', bp && bp.datePublished === old.publishedAt, bp && bp.datePublished);
  ok('article:published_time is the stored one', metaProp(html, 'article:published_time') === old.publishedAt);
  ok('author in the page, the JSON-LD and article:author', /Priya Menon/.test(byline(html)) && bp && bp.author && bp.author.name === 'Priya Menon' && metaProp(html, 'article:author') === 'Priya Menon');
  ok('no "Updated" line on a post nobody has significantly updated', !/Updated/.test(byline(html)), byline(html));
  ok('dateModified equals datePublished until then', bp && bp.dateModified === bp.datePublished, bp && bp.dateModified);

  /* A headline edit, significant OFF, with the address box emptied and a different date typed. */
  r = await req('PUT', '/api/staff/post/' + old.id, { title: 'Blocked account in 2024, reworded ' + S, slug: '', body: 'How the blocked account worked in 2024, step by step, for Indian students. Typo fixed.',
    status: 'published', author: 'Priya Menon', publishedAt: '2025-01-01' });
  const ed = r.body.post;
  ok('editing the headline never changes the address', ed && ed.slug === old.slug, ed && ed.slug);
  ok('datePublished is fixed after the first publish', ed && ed.publishedAt === old.publishedAt, ed && ed.publishedAt);
  ok('significant OFF: no modified date', ed && !ed.modifiedAt, ed && ed.modifiedAt);
  html = await (await anon('/post/' + old.slug)).text();
  bp = lds(html).find(x => x['@type'] === 'BlogPosting');
  ok('the new headline is in the JSON-LD', bp && /reworded/.test(bp.headline), bp && bp.headline);
  ok('…with datePublished exactly as before', bp && bp.datePublished === old.publishedAt);
  ok('…dateModified unchanged and no Updated line', bp && bp.dateModified === old.publishedAt && !/Updated/.test(byline(html)), byline(html));
  xml = await (await anon('/sitemap.xml')).text();
  ok('…sitemap lastmod unchanged', lastmodOf(xml, SITE + '/post/' + old.slug) === '2024-05-12', lastmodOf(xml, SITE + '/post/' + old.slug));

  /* Significant ON. */
  r = await req('PUT', '/api/staff/post/' + old.id, { title: 'Blocked account in 2024, reworded ' + S, slug: old.slug, body: 'The 2027 amount, corrected.',
    status: 'published', author: 'Priya Menon', significant: true });
  const sg = r.body.post;
  ok('significant ON: modified date is now', sg && String(sg.modifiedAt).startsWith(TODAY), sg && sg.modifiedAt);
  html = await (await anon('/post/' + old.slug)).text();
  bp = lds(html).find(x => x['@type'] === 'BlogPosting');
  ok('…the page shows Updated next to Published', /Published/.test(byline(html)) && /Updated/.test(byline(html)), byline(html));
  ok('…JSON-LD dateModified is now and agrees with article:modified_time', bp && String(bp.dateModified).startsWith(TODAY) && metaProp(html, 'article:modified_time') === bp.dateModified);
  ok('…datePublished still the original', bp && bp.datePublished === old.publishedAt);
  xml = await (await anon('/sitemap.xml')).text();
  ok('…sitemap lastmod is today', lastmodOf(xml, SITE + '/post/' + old.slug) === TODAY, lastmodOf(xml, SITE + '/post/' + old.slug));

  /* An imported (Wix) draft keeps its timestamp to the second when the date box shows the same day. */
  const wix = (await req('POST', '/api/staff/posts', { title: 'Wix import ' + S, body: 'An imported article.', status: 'draft', author: 'maurya2pi',
    publishedAt: '2023-03-14T10:31:22.000Z' })).body.post;
  r = await req('PUT', '/api/staff/post/' + wix.id, { title: 'Wix import ' + S, slug: wix.slug, body: 'An imported article.', status: 'published', author: 'maurya2pi', publishedAt: '2023-03-14' });
  ok('publishing an imported draft keeps the Wix datePublished exactly', r.body.post && r.body.post.publishedAt === '2023-03-14T10:31:22.000Z', r.body.post && r.body.post.publishedAt);

  /* An address changed on purpose → the old one 301s. */
  const moved = (await req('PUT', '/api/staff/post/' + wix.id, { title: 'Wix import ' + S, slug: 'wix-import-moved-' + S, body: 'An imported article.', status: 'published', author: 'maurya2pi' })).body.post;
  r = await anon('/post/' + wix.slug);
  ok('an explicit address change 301s the old address to the new one', moved && moved.slug === 'wix-import-moved-' + S && r.status === 301 && r.headers.get('location') === '/post/' + moved.slug, r.status + ' ' + r.headers.get('location'));

  /* Wix archive addresses. */
  for (const p of ['/blog/categories/germany', '/blog/tags/visa', '/profile/maurya2pi/profile', '/blog/hashtags/ielts']) {
    r = await anon(p);
    ok(p + ' → 301 /blog', r.status === 301 && r.headers.get('location') === '/blog', r.status + ' ' + r.headers.get('location'));
  }

  /* ===================================================== the editor */
  const ed1 = fs.readFileSync(path.join(ROOT, 'blog-admin.html'), 'utf8');
  const ed2 = fs.readFileSync(path.join(ROOT, 'portal_blog.py'), 'utf8');
  for (const [label, src] of [['blog-admin.html', ed1], ['portal_blog.py', ed2]]) {
    ok(label + ': the "This is a significant content update" checkbox, off by default, sent on save',
      src.includes('This is a significant content update') && src.includes('id="pSig"') && !/id="pSig"[^>]*checked/.test(src) && src.includes("significant: !!($('#pSig')"));
    ok(label + ': Review and "Archive selected"', src.includes('id="revBtn"') && src.includes('Archive selected') && src.includes('/api/staff/posts/archive'));
  }

  /* ===================================================== B3/B4: the review */
  console.log('C. test / off-topic lists, Archive selected');
  const mk = async (title, body, status) => (await req('POST', '/api/staff/posts', { title: title + ' ' + S, body, status: status || 'published' })).body.post;
  const tBlog = await mk('France Universities – Blog Testing', 'Just checking that the blog works.');
  const tLorem = await mk('Lorem ipsum sample', 'Lorem ipsum dolor sit amet.', 'draft');
  const tEmpty = await mk('Untitled thoughts', '', 'draft');
  const oPlay = await mk('Top student playlists for late-night study', 'Ten songs.');
  const oFood = await mk('Foods to try in Munich', 'Pretzels, mostly.');
  const oHike = await mk('Hiking places near Heidelberg', 'Trails and views.');
  const real = await mk('IELTS test dates for German universities', 'When to sit the IELTS for a winter intake.');
  r = await req('GET', '/api/staff/posts/review');
  const has = (list, p) => (r.body[list] || []).some(x => x.id === p.id);
  ok('review: "France Universities – Blog Testing" is a test post', has('test', tBlog), JSON.stringify(r.body.test || []).slice(0, 300));
  ok('review: lorem / sample draft is a test post', has('test', tLorem));
  ok('review: an empty post is a test post', has('test', tEmpty));
  ok('review: playlists, foods and hiking are off-topic', has('offTopic', oPlay) && has('offTopic', oFood) && has('offTopic', oHike), JSON.stringify(r.body.offTopic || []).slice(0, 300));
  ok('review: an IELTS test-dates guide is on neither list', !has('test', real) && !has('offTopic', real));
  ok('review: each item says why', (r.body.test || []).concat(r.body.offTopic || []).every(x => x.reason && x.url));

  /* The office's script, against this server, as the office runs it against live. */
  let out = '';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'blogreview-'));
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'blog-review.js'), BASE, '--json'],
      { cwd: work, env: Object.assign({}, process.env, { GLOVELS_EMAIL: ADMIN.email, GLOVELS_PASSWORD: ADMIN.password }), encoding: 'utf8', timeout: 60000 });
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || e.message); }
  let sj = {}; try { sj = JSON.parse(out); } catch (e) {}
  const sHas = (list, p) => (sj[list] || []).some(x => x.id === p.id);
  ok('scripts/blog-review.js prints the two lists', sHas('test', tBlog) && sHas('test', tLorem) && sHas('offTopic', oFood) && !sHas('test', real), out.slice(0, 300));
  ok('…and writes a CSV for a spreadsheet', fs.readdirSync(work).some(f => /^blog-review-\d{4}-\d{2}-\d{2}\.csv$/.test(f)));
  let txt = '';
  try {
    txt = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'blog-review.js'), BASE],
      { cwd: work, env: Object.assign({}, process.env, { GLOVELS_EMAIL: ADMIN.email, GLOVELS_PASSWORD: ADMIN.password }), encoding: 'utf8', timeout: 60000 });
  } catch (e) { txt = String(e.stdout || '') + String(e.stderr || e.message); }
  ok('…as readable text by default', /TEST \/ DUMMY POSTS/.test(txt) && /OFF-TOPIC POSTS/.test(txt) && txt.includes('Blog Testing'), txt.slice(0, 200));
  fs.rmSync(work, { recursive: true, force: true });

  r = await req('POST', '/api/staff/posts/archive', { ids: [tBlog.id, tLorem.id] });
  ok('Archive selected archives the ticked posts', r.status === 200 && r.body.archived === 2, r.status + ' ' + r.text.slice(0, 120));
  r = await anon('/post/' + tBlog.slug);
  ok('an archived post 301s to /blog', r.status === 301 && r.headers.get('location') === '/blog', r.status + ' ' + r.headers.get('location'));
  xml = await (await anon('/sitemap.xml')).text();
  ok('an archived post is not in the sitemap', !xml.includes('/post/' + tBlog.slug + '<'));
  const blogHtml = await (await anon('/blog')).text();
  ok('…nor on the blog', !blogHtml.includes(tBlog.slug));
  r = await req('DELETE', '/api/staff/post/' + tLorem.id);
  ok('an archived post cannot be hard-deleted', r.status === 409, r.status);
  r = await req('GET', '/api/staff/posts?status=archived');
  ok('the office can list archived posts', (r.body.posts || []).some(p => p.id === tBlog.id) && (r.body.posts || []).every(p => p.status === 'archived'));
  r = await req('GET', '/api/staff/posts/review');
  ok('archived posts leave the review lists', !has('test', tBlog));
  r = await req('POST', '/api/staff/posts/archive', { ids: [tLorem.id], restore: true });
  ok('restore brings one back as a draft', r.body.restored === 1 && (await req('GET', '/api/staff/post/' + tLorem.id)).body.post.status === 'draft');

  /* ===================================================== JSON-LD */
  console.log('D. structured data');
  html = await (await anon('/')).text();
  const homeLd = lds(html);
  ok('home: every JSON-LD block parses', homeLd.length >= 2 && homeLd.every(x => !x.invalid), JSON.stringify(homeLd.filter(x => x.invalid)));
  const lb = homeLd.find(x => x['@type'] === 'LocalBusiness');
  ok('home: LocalBusiness with the contact-page address', lb && lb.address && lb.address.addressLocality === 'Hyderabad' && lb.address.postalCode === '500081' && /Madhapur/.test(lb.address.streetAddress), JSON.stringify(lb && lb.address));
  ok('home: LocalBusiness phone, email and hours (Mon–Sat 9:30–19:30)', lb && lb.telephone === '+917839399999' && lb.email === 'info@glovels.com'
    && lb.openingHoursSpecification && lb.openingHoursSpecification[0].opens === '09:30' && lb.openingHoursSpecification[0].closes === '19:30' && lb.openingHoursSpecification[0].dayOfWeek.length === 6);
  ok('home: LocalBusiness on the www address, no invented rating or geo', lb && lb.url === SITE + '/' && !lb.aggregateRating && !lb.geo && !lb.priceRange);
  ok('home: the Organization block is still there', homeLd.some(x => x['@type'] === 'Organization' && x.url === SITE + '/'));
  for (const p of ['work-opportunity-card', 'visa-processing', 'language-german']) {
    const h = await (await anon('/' + p)).text();
    const svc = lds(h).filter(x => x['@type'] === 'Service');
    ok('/' + p + ': exactly one Service JSON-LD, valid', svc.length === 1 && svc[0].name && svc[0].provider && lds(h).every(x => !x.invalid), svc.length);
    ok('/' + p + ': links to /success-stories#visa-work-stories', h.includes('href="/success-stories#visa-work-stories"'));
  }

  /* ===================================================== host redirect */
  console.log('E. one address: www');
  let hr = await raw(BASE, '/blog?x=1', { Host: 'glovels.com' });
  ok('glovels.com → 301 https://www.glovels.com (same path and query)', hr.status === 301 && hr.headers.location === SITE + '/blog?x=1', hr.status + ' ' + hr.headers.location);
  hr = await raw(BASE, '/study-in-germany', { Host: 'glovels.onrender.com' });
  ok('glovels.onrender.com → 301 https://www.glovels.com', hr.status === 301 && hr.headers.location === SITE + '/study-in-germany', hr.status + ' ' + hr.headers.location);
  hr = await raw(BASE, '/', { Host: 'www.glovels.com' });
  ok('www.glovels.com itself is served', hr.status === 200, hr.status);
  ok('…with a www canonical', /<link rel="canonical" href="https:\/\/www\.glovels\.com\/"/.test(hr.text));
  hr = await raw(BASE, '/api/health', { Host: 'glovels.onrender.com' });
  ok('the health check is never redirected', hr.status === 200, hr.status);

  /* ===================================================== C. no catalogue counts */
  console.log('F. no catalogue-size counts on About and home');
  const COUNT = /160,000|2,000\+|2,500\+|2,597|\b\d{1,3}(?:,\d{3})+\+?\s+programmes|institutions we work with|Eight countries covered/i;
  const homeTxt = visible(html), aboutHtml = await (await anon('/about-us')).text();
  ok('home copy has no catalogue-size count', !COUNT.test(homeTxt), (homeTxt.match(COUNT) || [])[0]);
  ok('About copy has no catalogue-size count', !COUNT.test(visible(aboutHtml)), (visible(aboutHtml).match(COUNT) || [])[0]);
  ok('About meta description has no programme count', !/160,000/.test((/<meta name="description" content="([^"]*)"/.exec(aboutHtml) || [])[1] || 'x'));
  r = await anon('/api/content');
  const cj = await r.json().catch(() => ({}));
  ok('the numbers the home page paints have no catalogue count', Array.isArray(cj.stats) && cj.stats.length && !cj.stats.some(s => COUNT.test(s.num + ' ' + s.label)), JSON.stringify(cj.stats));
  ok('the chat panel quotes the contact page hours', !/10am–7pm/.test(html) && !/10am–7pm/.test(fs.readFileSync(path.join(ROOT, 'chat_widget.py'), 'utf8')));

  /* ===================================================== wording: affiliated */
  console.log('F2. "affiliated universities", never "partner universities" (owner, 30 Oct)');
  const PARTNER = /partner universit|partner campus|partner institution|free to apply at partners?\b|we are partnered|partnered with|\b\d+\s+affiliated universit/i;
  const uniSlug = ((/<loc>https:\/\/www\.glovels\.com\/university\/([a-z0-9-]+)<\/loc>/.exec(xml)) || [])[1];
  const pages = ['/', '/about-us', '/contact-us', '/careers', '/disclaimers', '/study-in-germany', '/study-in-japan', '/find-university',
    '/find-university?country=DE', '/university', '/blog', '/work-opportunity-card', '/visa-processing', '/llms.txt'].concat(uniSlug ? ['/university/' + uniSlug] : []);
  for (const p of pages) {
    const h = await (await anon(p)).text();
    ok(p + ' never says "partner universities" / "we are partnered"', !PARTNER.test(h), (h.match(PARTNER) || [])[0]);
  }
  ok('the home hero chip says "Free to apply at affiliated universities"', /Free to apply at affiliated universities/.test(html));
  const cj2 = await (await anon('/api/content')).json().catch(() => ({}));
  ok('the services the home page paints say affiliated, with no count', !PARTNER.test(JSON.stringify(cj2.services || cj2)) && /Affiliated universities you match/.test(JSON.stringify(cj2.services || cj2)));
  {
    const SEED = require(path.join(ROOT, 'server', 'seed.js'));
    const t = SEED.affiliatedText;
    ok('migration rule: "3 partner universities you match, instant." → no count', t('3 partner universities you match, instant.') === 'Affiliated universities you match, instant.');
    ok('migration rule: "Free to apply at partners" / "we are partnered with"', t('Free to apply at partners') === 'Free to apply at affiliated universities'
      && t('The universities we are partnered with are free.') === 'The universities we are affiliated with are free.');
    ok('migration rule: the agency meaning is left alone', t('Referred by Acme, our partner agency') === 'Referred by Acme, our partner agency' && t('Partner portal') === 'Partner portal');
    const store = { services: { items: [{ id: 'first-three', desc: '3 partner universities you match, instant.', partners: [{ label: 'Open with Fintiba' }] }] },
      finder: { line: 'Free to apply at partner universities' } };
    const fake = { content: k => store[k] == null ? null : JSON.parse(JSON.stringify(store[k])), setContent: (k, v) => { store[k] = v; }, log: () => {} };
    const n = SEED.affiliatedWording({ db: fake });
    ok('the one-time migration rewrites stored office copy, once', n === 2 && store.services.items[0].desc === 'Affiliated universities you match, instant.'
      && store.finder.line === 'Free to apply at affiliated universities' && store.services.items[0].partners[0].label === 'Open with Fintiba'
      && SEED.affiliatedWording({ db: fake }) === 0, n + ' ' + JSON.stringify(store));
  }

  /* ===================================================== no data → the counsellor form */
  console.log('F3. a destination or a finder search with nothing listed shows the enquiry form');
  const jp = await (await anon('/study-in-japan')).text();
  ok('/study-in-japan (no programmes) shows the enquiry form', /id="nlForm"/.test(jp) && /Send to a counsellor/.test(jp));
  const fj = await (await anon('/find-university?country=JP')).text();
  ok('/find-university?country=JP (no data) shows the enquiry form, not just an empty list', /id="nlForm"/.test(fj) && /Send to a counsellor/.test(fj) && /id="nlDest" value="JP"/.test(fj), (fj.match(/fempty[\s\S]{0,200}/) || [''])[0]);
  ok('…and the script that sends it (delegated, survives a re-render)', /document\.addEventListener\('submit'[\s\S]{0,120}nlForm/.test(fj));
  const fd = await (await anon('/find-university?country=DE')).text();
  ok('a search with results does not show it', !/id="nlForm"/.test(fd));
  r = await fetch(BASE + '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.178.9.' + (1 + (Date.now() % 200)) },
    body: JSON.stringify({ name: 'Finder Asker ' + S, phone: '98' + String(Date.now()).slice(-8), email: 'asker-' + S + '@example.com', destination: 'JP',
      note: 'Destination page with nothing listed', consent: 'yes', consentWording: 'I agree', sourcePage: '/find-university', website: '' }) });
  ok('the form posts to the leads book like every other enquiry form', r.status < 300, r.status);

  /* ===================================================== staging */
  console.log('G. staging (no GLOVELS_URL, no ALLOW_INDEXING) — own server on 8935');
  const SPORT = 8935, sdir = '/tmp/db-' + SPORT;
  fs.rmSync(sdir, { recursive: true, force: true }); fs.mkdirSync(sdir, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(SPORT), DATA_DIR: sdir });
  delete env.GLOVELS_URL; delete env.ALLOW_INDEXING; delete env.GLOVELS_ENV; delete env.RENDER_EXTERNAL_URL; delete env.BASE;
  let log = '';
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await new Promise(res => setTimeout(res, 500));
    try { up = (await fetch('http://localhost:' + SPORT + '/api/health')).ok; } catch (e) {}
  }
  ok('a staging server starts', up, log.slice(-300));
  if (up) {
    const SB = 'http://localhost:' + SPORT;
    const sr = await (await anon('/robots.txt', SB)).text();
    ok('staging robots: Disallow: / for everyone, nothing allowed', /^User-agent: \*\nDisallow: \/$/m.test(sr) && !/^Allow:/m.test(sr) && !/Sitemap:/.test(sr), sr);
    ok('staging: no sitemap', (await anon('/sitemap.xml', SB)).status === 404);
    const sh = await (await anon('/', SB)).text();
    ok('staging: pages stay noindex,nofollow', /<meta name="robots" content="noindex,nofollow"/.test(sh));
    hr = await raw(SB, '/', { Host: 'glovels.onrender.com' });
    ok('staging: no host redirect without GLOVELS_URL', hr.status === 200, hr.status);
  }
  child.kill();
  await new Promise(res => setTimeout(res, 500));
  fs.rmSync(sdir, { recursive: true, force: true });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
