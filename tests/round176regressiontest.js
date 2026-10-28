/*
 * Round 176 — the pre-go-live regression sweep (28 Oct).
 *
 * The recorded issues each have their own suite (round117 … round175); this
 * one holds the checks for what the sweep itself found and fixed, plus a few
 * cheap end-to-end guards that no earlier suite asserts on its own:
 *
 *   - prose.js: a quotation typed over several ">" lines is ONE blockquote.
 *   - refer.html: a 4xx from /send.php shows the server's reason (a 429's
 *     "wait a few minutes, or call" as much as a 422's "needs a letter"),
 *     never the bare "That did not send".
 *   - every post the blog lists renders from the database once published —
 *     byline, date, no template leak — and the old static file is no longer
 *     what a visitor gets.
 *   - the public forms refuse a numeric name with the reason beside the field.
 *   - a document slot takes PDF / JPG / PNG / HEIC, Word only for written
 *     documents, and refuses HTML, text and a ".pdf" that is not one.
 *
 * Port 8124 by default (BASE overrides). Needs a fresh server; the blog
 * checks publish the six seeded drafts on it.
 */
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8124';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(JSON.stringify(extra)).slice(0, 240) : '')); } };
const J = { 'Content-Type': 'application/json' };
const jar = {};
const ip = () => '10.176.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
async function call(who, method, p, body, raw) {
  /* A fresh address per call: the enquiry forms rate-limit by IP, and this
     suite may run on a server other suites have already written to. */
  const h = Object.assign({ 'x-forwarded-for': ip() }, raw ? {} : J, jar[who] ? { Cookie: jar[who] } : {});
  const r = await fetch(BASE + p, { method, headers: h, body: raw ? body : (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc && /glovels_session=[0-9a-f]/.test(sc)) jar[who] = sc.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) {}
  return { s: r.status, t, j };
}

(async () => {
  /* ------------------------------------------------- prose: one blockquote */
  const P = require(path.join(__dirname, '..', 'server', 'prose.js'));
  const q3 = P.render('> If something went wrong — illness, family, a change of\n> college — say so plainly and briefly, once, in the SOP.\n> They are not looking for perfection.\n\nNext paragraph.');
  ok('three ">" lines are one blockquote', (q3.match(/<blockquote>/g) || []).length === 1, q3);
  ok('  · with the lines joined into one paragraph', /<blockquote><p>If something went wrong[^<]*perfection\.<\/p><\/blockquote>/.test(q3), q3);
  ok('  · and the paragraph after it is outside', /<\/blockquote>\n?<p>Next paragraph\.<\/p>/.test(q3), q3);
  const q2 = P.render('> first part\n>\n> second part');
  ok('a blank ">" line starts a second paragraph inside the same quotation', /<blockquote><p>first part<\/p><p>second part<\/p><\/blockquote>/.test(q2), q2);
  const qSep = P.render('> one\n\n> two');
  ok('two quotations separated by a blank line stay two', (qSep.match(/<blockquote>/g) || []).length === 2, qSep);
  ok('a single ">" line is unchanged', P.render('> alone') === '<blockquote><p>alone</p></blockquote>', P.render('> alone'));

  /* ------------------------------------------------ refer: the reason shown */
  /* The page's scripts are hoisted into /js/refer.<hash>.js at serve time. */
  const referPage = await (await fetch(BASE + '/refer')).text();
  const js = await Promise.all((referPage.match(/src="(\/js\/[^"]+)"/g) || []).map(async m => (await fetch(BASE + /src="([^"]+)"/.exec(m)[1])).text()));
  const refer = referPage + js.join('\n');
  ok('/refer handles every 4xx with the server\'s reason', /r\.status >= 400 && r\.status < 500/.test(refer) && /d\.error/.test(refer), 'pattern not in the page or its script');
  ok('  · a 429 no longer falls through to the bare "That did not send"', !/if \(r\.status === 422\) return r\.json/.test(refer));

  /* ------------------------------- university page: a long name wraps */
  /* "Wilhelmshaven/Oldenburg/Elsfleth" in an h2 has no break point and
     pushed the page 4px wide on a 375px phone (sweep, 28 Oct). The inside
     page template lets a heading break anywhere. */
  const unisPage = (await call('g', 'GET', '/university')).t;
  const firstUni = ((/href="\/?(university\/[a-z0-9-]+)"/.exec(unisPage) || [])[1] || "").replace(/^/, "/").replace(/^\/$/, "");
  if (firstUni) {
    const uniHtml = (await call('g', 'GET', firstUni)).t;
    ok('a university page heading may break inside a long name', /\.prose h2\{[^}]*overflow-wrap:anywhere/.test(uniHtml), firstUni);
  } else ok('a university page to read', false, 'none listed');

  /* ------------------------------------------- blog: published posts render */
  await call('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  const staffPosts = await call('a', 'GET', '/api/staff/posts?per=50');
  const drafts = ((staffPosts.j || {}).posts || []).filter(p => p.status !== 'published');
  for (const d of drafts) {
    const full = await call('a', 'GET', '/api/staff/post/' + d.id);
    await call('a', 'PUT', '/api/staff/post/' + d.id, Object.assign({}, (full.j || {}).post, { status: 'published', publishedAt: new Date().toISOString() }));
  }
  const live = await call('g', 'GET', '/api/posts');
  ok('the six seeded posts publish', live.j && live.j.total >= 6, live.j && live.j.total);
  for (const p of (live.j || {}).posts || []) {
    const html = (await call('g', 'GET', '/post/' + p.slug)).t;
    const good = /class="byline"/.test(html) && /Published <b>\d{1,2} \w+ \d{4}<\/b>/.test(html)
      && /article:published_time/.test(html) && !/\bundefined\b|\{\{|\bNaN\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))
      && !/href="http:\/\/M\.Sc/.test(html) && !/<!-- text to be written/.test(html);
    ok('/post/' + p.slug + ' renders from the database', good, html.slice(0, 0));
  }

  /* ------------------------------------------ forms: a numeric name refused */
  for (const [label, p, body] of [
    ['counselling form', '/api/enquiries', { name: '12345', phone: '9876543210', email: 'r176a@example.com', consent: 'yes', destination: 'DE', source: 'counsel' }],
    ['/send.php (contact, refer)', '/send.php', { name: '12345', phone: '9876543211', email: 'r176b@example.com', consent: 'yes', source: 'referral' }],
    ['sign-up', '/api/auth/signup', { name: '12345', email: 'r176c@example.com', password: 'a-good-password-9', phone: '9876543212', acceptedTerms: true }],
  ]) {
    const r = await call('g', 'POST', p, body);
    ok(label + ': "12345" is a 422 that says why', r.s === 422 && /letter/i.test(r.t), r.s + ' ' + r.t.slice(0, 100));
  }

  /* ------------------------------------------------ documents: file types */
  const stamp = Date.now();
  const su = await call('s', 'POST', '/api/auth/signup', { name: 'Round 176 Student', email: 'r176s' + stamp + '@example.com', password: 'a-good-password-9', phone: '9876' + String(stamp).slice(-6), acceptedTerms: true });
  ok('a student signs up', su.s === 200, su.s + ' ' + su.t.slice(0, 80));
  const up = async (key, name, buf, type) => { const fd = new FormData(); fd.append('key', key); fd.append('file', new Blob([buf], { type }), name); return call('s', 'POST', '/api/documents', fd, true); };
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n'), Buffer.alloc(400, 'x'), Buffer.from('\n%%EOF\n')]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]), Buffer.alloc(300, 1), Buffer.from([0xff, 0xd9])]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 2)]);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(300, 3)]);
  const docx = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('[Content_Types].xml'), Buffer.alloc(300, 4)]);
  const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  let r;
  r = await up('passport', 'passport.pdf', pdf, 'application/pdf'); ok('PDF passport accepted', r.s === 200, r.s + ' ' + r.t.slice(0, 80));
  r = await up('x', 'x.jpg', jpg, 'image/jpeg'); ok('JPG accepted', r.s === 200, r.s);
  r = await up('xii', 'xii.png', png, 'image/png'); ok('PNG accepted', r.s === 200, r.s);
  r = await up('degree', 'degree.heic', heic, 'image/heic'); ok('HEIC accepted', r.s === 200, r.s + ' ' + r.t.slice(0, 80));
  r = await up('cv', 'cv.docx', docx, WORD); ok('Word accepted for the CV', r.s === 200, r.s + ' ' + r.t.slice(0, 80));
  r = await up('passport', 'passport.docx', docx, WORD); ok('Word refused for the passport', r.s === 415, r.s + ' ' + r.t.slice(0, 80));
  r = await up('cv', 'cv.html', Buffer.from('<html><body>x</body></html>' + 'x'.repeat(200)), 'text/html'); ok('HTML refused', r.s === 415, r.s);
  r = await up('cv', 'cv.txt', Buffer.from('just text '.repeat(40)), 'text/plain'); ok('text refused', r.s === 415, r.s);
  r = await up('provis', 'fake.pdf', Buffer.concat([Buffer.from('<html>'), Buffer.alloc(300, 5)]), 'application/pdf'); ok('a ".pdf" that is not a PDF refused', r.s === 415, r.s + ' ' + r.t.slice(0, 80));
  const dob = await call('s', 'PUT', '/api/profile', { profile: { dob: '2000-02-31' } });
  ok('31 February is refused on the profile', dob.s === 422, dob.s + ' ' + dob.t.slice(0, 80));
  const big = await call('s', 'POST', '/api/messages', { body: 'a'.repeat(6000) });
  ok('a 6,000-character message is refused', big.s === 422, big.s);
  const out = await call('s', 'POST', '/api/auth/logout', {});
  const after = await call('s', 'GET', '/api/state');
  ok('sign-out ends the session on the server', out.s === 200 && after.s === 401, out.s + '/' + after.s);

  /* ----------------------------------- matcher: a stale answer never lands */
  /* fitpanel.js mounts with autorun (a slow run over the whole catalogue);
     a CGPA of 15 typed straight after and sent gets a 422 at once, and the
     first run's results then overwrote the error line. Every run is
     numbered now and only the latest writes the panel. */
  const fp = (await call('g', 'GET', '/fitpanel.js')).t;
  ok('fitpanel.js numbers its runs and drops stale answers', /runSeq/.test(fp) && /mine !== runSeq/.test(fp));
  let browser = null;
  try { browser = await require('playwright').chromium.launch(); } catch (e) { console.log('  (playwright not available: ' + e.message + ')'); }
  if (browser) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/catalogue.html', { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-t="fit"]');
    await page.waitForSelector('#gfCgpa', { timeout: 10000 });
    /* No waiting for the autorun to finish: that is the race. */
    await page.fill('#gfCgpa', '15');
    await page.click('#gfGo');
    await page.waitForTimeout(6000);
    const outText = await page.$eval('#gfOut', e => e.textContent).catch(() => '');
    ok('CGPA 15: six seconds later the summary line still says the answer cannot be right', /cannot be right/.test(outText), outText.slice(0, 120));
    ok('  · and the box keeps its reason', /scale/.test(await page.$eval('#gfCgpaErr', e => e.textContent).catch(() => '')));
    await page.fill('#gfCgpa', '7.5');
    await page.click('#gfGo');
    await page.waitForFunction(() => /fit|Tell us more/.test((document.querySelector('#gfOut') || {}).textContent || '') && !/Checking every/.test(document.querySelector('#gfOut').textContent), null, { timeout: 30000 }).catch(() => {});
    ok('  · corrected, the run answers again', !/cannot be right/.test(await page.$eval('#gfOut', e => e.textContent)));
    ok('  · no page errors', errs.length === 0, errs);
    await browser.close();
  }

  console.log('round176regressiontest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('round176regressiontest: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
