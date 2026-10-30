/**
 * The success-stories page: one card per admission offer, one per visa or
 * work-route outcome, from assets/success-stories.json.
 *
 * What the office signed off (the brief and the prototype): 109 admit cards
 * and 13 route cards, first names only, no filters, no stats strip, no
 * scores; a FIXED order in which no student appears twice within any four
 * consecutive cards (one desktop row) and which is the same on every load;
 * white logo tiles that stay white in dark mode; JSON-LD for the breadcrumb
 * and both lists; the three service pages linking back to the visa section;
 * and an Organisation → Success stories screen where the office replaces
 * the whole file.
 *
 * The one that matters for search: the page is rendered on the SERVER. A
 * crawler often does not run scripts, so the cards are checked in the HTML
 * as it comes off the wire, before any JavaScript has run.
 *
 * The data file is in the repo, so this runs against a fresh database.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'success-stories.json'), 'utf8'));
const N_ADMITS = DATA.admits.length, N_ROUTES = DATA.routes.length;

/* Surnames and scores: the public file has none, and the page must not grow
   any. A handful of words that would only be on the page if somebody wired
   the internal sheet in by mistake. */
const PRIVATE = /CGPA|IELTS|GRE\b|German grade|Bachelor branch|Journey note|Consent to publish|<blockquote/;

const cards = page => page.$$eval('#admit-stories .ss-admit, #visa-work-stories .ss-route', els => els.map(e => [
  e.querySelector('.ss-who').textContent.trim(), e.querySelector('.ss-badge').textContent.trim(),
  e.querySelector('.ss-u').textContent.trim()]));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------- the page, before any script */
  const raw = await (await ctx.request.get(BASE + '/success-stories')).text();
  check('/success-stories answers', raw.length > 20000, raw.length + ' bytes');
  const body = (raw.split('id="page"')[1] || '').split('cta-band')[0];
  const nAdmit = (body.match(/class="ss-card ss-admit"/g) || []).length;
  const nRoute = (body.match(/class="ss-card ss-route"/g) || []).length;
  check(N_ADMITS + ' admit cards in the HTML as it arrives', nAdmit === N_ADMITS, nAdmit + ' cards');
  check(N_ROUTES + ' visa / work-route cards', nRoute === N_ROUTES, nRoute + ' cards');
  check('every admit is on the page by university',
    DATA.admits.every(a => body.includes(a.University.replace(/&/g, '&amp;'))));
  check('first names as the students chose them, with the intake',
    body.includes('<span class="ss-who">Arya</span>') && body.includes('<span class="ss-badge">Winter 2026</span>'));
  check('no surnames, scores or notes', !PRIVATE.test(body));
  check('no filters, no search, no sort, no stats strip, no per-student links',
    !/<input|<select|class="stats"|View story|href="\/success-stories\//.test(body));
  check('an empty programme reads "Programme to be confirmed"',
    DATA.admits.some(a => !a['Programme (as recorded)']) ? body.includes('Programme to be confirmed') : true);
  check('a university with no logo gets an initials tile', body.includes('class="ss-ini"'));
  check('logo tiles are lazy, described, contained',
    /<img src="\/logos\/[^"]+" alt="[^"]+ logo" loading="lazy"/.test(body));

  /* The four route kinds, each linked to its service page. */
  check('Opportunity Card cards link to the service page',
    body.includes('Germany Opportunity Card (Chancenkarte) approved')
    && body.includes('class="ss-link" href="/work-opportunity-card.html">Germany Opportunity Card service'));
  check('Blue Card and Young Professionals cards link to visa processing',
    body.includes('EU Blue Card for Germany approved') && body.includes('UK India Young Professionals Scheme visa approved')
    && body.includes('class="ss-link" href="/visa-processing.html">Visa processing service'));
  check('language visa cards link to the German classes',
    body.includes('German language course visa approved')
    && body.includes('class="ss-link" href="/language-german.html">German language classes'));
  check('the visa section has its anchor', body.includes('id="visa-work-stories"'));
  check('the CTA box', body.includes('Your story could be next') && body.includes('href="index.html#counsel"'));

  /* -------------------------------------------------------------- the head */
  check('the title from the brief',
    /* Round 169 (WEB-20.3): a title over 65 characters with " | Glovels"
       drops the suffix rather than being cut by Google. */
    /* Round 178: the brief's title cut to the 65-character rule. */
    raw.includes('<title>Success stories — ' + N_ADMITS + ' admits &amp; visa approvals | Glovels</title>'));
  check('the description counts students, offers and universities',
    /<meta name="description" content="\d+ students, \d+ admission offers at \d+ universities/.test(raw));
  check('a canonical on /success-stories', /<link rel="canonical" href="[^"]+\/success-stories">/.test(raw));
  const ld = (raw.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
    .map(s => JSON.parse(s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
  const types = ld.map(x => x['@type']);
  check('JSON-LD: a BreadcrumbList and two ItemLists', types.filter(t => t === 'BreadcrumbList').length === 1
    && types.filter(t => t === 'ItemList').length === 2, types.join(','));
  const lists = ld.filter(x => x['@type'] === 'ItemList');
  check('the admit list counts every offer', lists[0] && lists[0].numberOfItems === N_ADMITS
    && lists[0].itemListElement.length === N_ADMITS);
  check('the route list counts every outcome', lists[1] && lists[1].numberOfItems === N_ROUTES);
  check('a list item reads "name — university, programme (intake)"',
    lists[0] && /^[^—]+ — .+, .+ \((Winter|Summer) 20\d\d\)$/.test(lists[0].itemListElement[0].name),
    lists[0] && lists[0].itemListElement[0].name);
  /* Only when this deployment is asking to be indexed at all. */
  const indexing = /content="index,follow/.test(await (await ctx.request.get(BASE + '/')).text());
  check('it asks to be indexed exactly when the rest of the site does',
    /content="index,follow/.test(raw) === indexing, indexing ? 'site is indexable' : 'site is a preview build');
  if (indexing) {
    check('the sitemap asks for it',
      (await (await ctx.request.get(BASE + '/sitemap.xml')).text()).includes('/success-stories'));
  }

  /* --------------------------------------------------------- and rendered */
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/success-stories');
  await page.waitForSelector('#admit-stories .ss-admit');
  const first = await cards(page);
  check('all ' + (N_ADMITS + N_ROUTES) + ' cards on the page', first.length === N_ADMITS + N_ROUTES, first.length + ' cards');
  await page.reload();
  await page.waitForSelector('#admit-stories .ss-admit');
  const second = await cards(page);
  check('the order is the same on the next load', JSON.stringify(first) === JSON.stringify(second));

  /* The spacing rule: a student's offers never land in the same desktop row. */
  let clashes = 0;
  for (let i = 0; i < N_ADMITS; i++) {
    for (let j = Math.max(0, i - 3); j < i; j++) if (first[i][0] === first[j][0]) clashes++;
  }
  check('no student twice within any four consecutive cards', clashes === 0, clashes + ' clashes');
  const multi = Object.values(DATA.admits.reduce((m, a) => { m[a['Display name']] = (m[a['Display name']] || 0) + 1; return m; }, {}))
    .filter(n => n > 1).length;
  check('and the students with several offers are spread, not sorted together', multi > 0 && clashes === 0,
    multi + ' students with 2+ offers');

  const cols = await page.$eval('#admit-stories', e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
  check('four cards to a desktop row', cols === 4, cols + ' columns');
  const w = await page.$eval('#admit-stories', e => Math.round(e.getBoundingClientRect().width));
  check('and not squeezed into the prose column', w > 900, w + 'px wide');

  /* Every logo loads. The images are lazy, so ask the server for each one
     rather than waiting for a scroll to reach it. */
  const srcs = [...new Set(await page.$$eval('#admit-stories img', els => els.map(e => e.getAttribute('src'))))];
  let broken = 0;
  for (const s of srcs) {
    const r = await ctx.request.get(BASE + s);
    if (!r.ok() || !/^image\//.test(r.headers()['content-type'] || '')) broken++;
  }
  check('every logo image is served (' + srcs.length + ' distinct)', srcs.length > 30 && broken === 0, broken + ' broken');

  /* A phone: one column, nothing scrolls sideways. */
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(BASE + '/success-stories');
  const sw = await phone.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  check('390px: no horizontal scroll', sw[0] <= sw[1], sw.join('/'));
  check('390px: one card per row',
    (await phone.$eval('#admit-stories', e => getComputedStyle(e).gridTemplateColumns.split(' ').length)) === 1);
  await phone.close();

  /* Dark mode: the logo tile stays white, or half the marks vanish. */
  const dark = await browser.newContext({ colorScheme: 'dark' });
  const dp = await dark.newPage();
  await dp.goto(BASE + '/success-stories');
  const tile = await dp.$eval('#admit-stories .ss-logo', e => getComputedStyle(e).backgroundColor);
  check('dark mode: the logo tile is white', tile === 'rgb(255, 255, 255)', tile);
  await dark.close();

  /* ------------------------------------------ the service pages link back */
  for (const p of ['/work-opportunity-card', '/visa-processing', '/language-german']) {
    const h = await (await ctx.request.get(BASE + p)).text();
    check(p + ' links to the visa stories', h.includes('href="/success-stories#visa-work-stories"'));
  }

  /* ------------------------------------------------------- the home rail */
  const home = await ctx.newPage();
  home.on('pageerror', e => errs.push(e.message));
  await home.goto(BASE + '/');
  await home.waitForSelector('.stories .tcard');
  await home.waitForTimeout(800);
  check('the home page "Real journeys" link goes to /success-stories',
    (await home.$eval('#storyMore a', e => e.getAttribute('href'))) === '/success-stories');

  /* ------------------------------------------- the office replaces the file */
  const got = await ctx.request.get(BASE + '/api/staff/success-stories');
  if (got.status() === 404) {
    check('GET /api/staff/success-stories is wired', false,
      '404 — add the installRoutes line from server/stories.js to api.js');
  } else {
    const g = await got.json();
    check('the office sees the counts and the source', got.ok() && g.counts && g.counts.admits === N_ADMITS
      && g.counts.routes === N_ROUTES && g.source === 'file', got.status() + ' ' + JSON.stringify(g.counts));

    const two = { admits: [
      { Intake: 'Winter 2026', 'Display name': 'Testa', University: 'RWTH Aachen University', Country: 'Germany',
        'Programme (as recorded)': 'Data Science', Degree: 'MSc', 'University (as recorded)': 'RWTH' },
      { Intake: 'Summer 2026', 'Display name': 'Testb', University: 'Durham University', Country: 'United Kingdom',
        'Programme (as recorded)': '', Degree: '', 'University (as recorded)': 'Durham' },
    ], routes: [{ Intake: 'Winter 2025', 'Display name': 'Testc', Country: 'Germany', Route: 'EU Blue Card (Germany)' }] };
    const up = await ctx.request.post(BASE + '/api/staff/success-stories', { data: two });
    const uj = await up.json();
    check('a two-admit file replaces the page', up.ok() && uj.counts && uj.counts.admits === 2 && uj.counts.routes === 1,
      up.status() + ' ' + JSON.stringify(uj));
    const after = await (await ctx.request.get(BASE + '/success-stories')).text();
    check('and the page shows two cards', (after.match(/class="ss-card ss-admit"/g) || []).length === 2
      && (after.match(/class="ss-card ss-route"/g) || []).length === 1);
    check('with the counts in the title', after.includes('<title>Success stories — 2 admits &amp;'));

    const wrong = await ctx.request.post(BASE + '/api/staff/success-stories',
      { data: { admits: [{ Intake: 'Winter 2026', University: 'X' }], routes: [] } });
    check('a row with no display name is refused', wrong.status() === 422, (await wrong.json()).error);
    const junk = await ctx.request.post(BASE + '/api/staff/success-stories',
      { data: { admits: [], routes: [] } });
    check('an empty file is refused', junk.status() === 422);
    const still = await (await ctx.request.get(BASE + '/success-stories')).text();
    check('and a refused file changes nothing', (still.match(/class="ss-card ss-admit"/g) || []).length === 2);

    /* A counsellor cannot: the routes ask for the content permission. */
    const c = await browser.newContext();
    await c.request.post(BASE + '/api/auth/login', { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
    const c1 = await c.request.get(BASE + '/api/staff/success-stories');
    const c2 = await c.request.post(BASE + '/api/staff/success-stories', { data: two });
    check('a counsellor gets 403 on both routes', c1.status() === 403 && c2.status() === 403, c1.status() + '/' + c2.status());
    const anon = await browser.newContext();
    check('a visitor is refused', (await anon.request.post(BASE + '/api/staff/success-stories', { data: two })).status() === 401);
    await c.close(); await anon.close();

    const back = await ctx.request.post(BASE + '/api/staff/success-stories', { data: { restore: true } });
    const bj = await back.json();
    check('"back to the shipped file" restores the ' + N_ADMITS, back.ok() && bj.counts.admits === N_ADMITS && bj.source === 'file',
      JSON.stringify(bj));
    const restored = await (await ctx.request.get(BASE + '/success-stories')).text();
    check('and the page has them all again', (restored.match(/class="ss-card ss-admit"/g) || []).length === N_ADMITS);

    /* The Organisation screen: the tab, the counts, the upload. */
    const admin = await ctx.newPage();
    admin.on('pageerror', e => errs.push(e.message));
    admin.on('dialog', d => d.accept());
    await admin.goto(BASE + '/admin');
    await admin.waitForSelector('.otab[data-o="stories"]');
    await admin.click('.otab[data-o="stories"]');
    await admin.waitForFunction(() => /admission offer/.test(document.getElementById('ssCounts').textContent));
    check('Organisation → Success stories shows the counts',
      new RegExp('^' + N_ADMITS + ' admission offers').test(await admin.$eval('#ssCounts', e => e.textContent)),
      await admin.$eval('#ssCounts', e => e.textContent));
    await admin.fill('#ssText', JSON.stringify(two));
    await admin.click('#ssReplace');
    await admin.waitForFunction(() => /Done/.test(document.getElementById('ssResult').textContent));
    check('"Replace all" from the screen replaces the page',
      (await (await ctx.request.get(BASE + '/success-stories')).text()).match(/class="ss-card ss-admit"/g).length === 2);
    check('and says who uploaded it', /uploaded by/.test(await admin.$eval('#ssSource', e => e.textContent)));
    await admin.click('#ssRestore');
    await admin.waitForFunction(() => /shipped/.test(document.getElementById('ssSource').textContent));
    check('and "Back to the shipped file" puts it back',
      (await (await ctx.request.get(BASE + '/success-stories')).text()).match(/class="ss-card ss-admit"/g).length === N_ADMITS);
  }

  check('no page errors', errs.length === 0, errs[0] || '');

  await browser.close();
  ok.forEach(n => console.log('  ok   ' + n));
  bad.forEach(n => console.log('  BAD  ' + n));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
