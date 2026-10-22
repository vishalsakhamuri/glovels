/*
 * Round 172 — the 15 October testing report, the website half (items 1–6, 8,
 * 9, 11 and 12's Babelsberg).
 *
 *   1  a country is its SVG flag (/flags/<cc>.svg), not the emoji, which is
 *      two letters in a box on Windows ("GB", "PL", "DE")
 *   2  "Universities we are partnered with are free to apply to …" is gone
 *   3  no "Work & migrate" tab in the home Services section
 *   4  Academic CV & Resume, Book Counselling and APS are in Most Booked again,
 *      and still in More Services; the migration sticks on an older install
 *   5  a Search button inside the hero search box, doing what Enter does
 *   6  the inside-page banner: a rounded navy card, eyebrow, italic gold last
 *      word(s), illustration, glassy chips — and no programme counts in it
 *   8  university pages fit a 375px phone (locked programme cards shrink)
 *   9  "12345" is told "A name needs at least one letter", and a refusal shows
 *      the server's reason
 *  11  Find University's facet counts are counted after the CGPA filter, and
 *      the CGPA slider has a separate "Not told us yet"
 *  12  Babelsberg's official site is filmuniversitaet.de
 *
 *   ./tests/srv.sh 8111
 *   BASE=http://localhost:8111 node tests/round172webtest.js
 *
 * Loads the German sheets (scratchpad r165 + out/v37, as round172sitestest
 * does) when the catalogue is still the seed, so the university pages have
 * locked German public rows and Babelsberg exists.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8111';
const ROOT = path.join(__dirname, '..');
const SP = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e === undefined ? '' : e).slice(0, 300))); };

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.172.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '' };
}
const get = async p => (await fetch(BASE + p)).text();
/* The page and the scripts it loads — the server moves inline scripts out to /js/<page>.<hash>.js. */
const withScripts = async p => {
  const h = await get(p);
  const srcs = [...h.matchAll(/<script[^>]*src="(\/js\/[^"]+)"/g)].map(m => m[1]);
  return h + (await Promise.all(srcs.map(get))).join('\n');
};
const num = s => Number(String(s || '').replace(/,/g, ''));

(async () => {
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('the administrator signs in', r.status === 200, r.status);
  const cat0 = (await req('anon', 'GET', '/api/catalogue')).body.programmes || [];
  if (cat0.length < 1000) {
    for (const f of [SP + '/r165/live-DE-noid.xlsx', SP + '/out/glovels-germany-v37-new-rows.xlsx']) {
      if (!fs.existsSync(f)) { console.log('    · (no sheet at ' + f + ')'); continue; }
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const up = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a, 'x-forwarded-for': ips.a }, body: fd });
      console.log('    · loaded ' + path.basename(f) + ': ' + up.status + ' ' + (await up.text()).slice(0, 90));
    }
  }

  /* ---------------------------------------------------------------- 1 API */
  console.log('\n1. Country flags as SVG pictures');
  const ISO = require(path.join(ROOT, 'server', 'countries.js')).ISO;
  const flagFiles = fs.readdirSync(path.join(ROOT, 'assets', 'flags')).filter(f => /^[a-z]{2}\.svg$/.test(f));
  ok('assets/flags holds an SVG for every country code the site knows (' + Object.keys(ISO).length + ')',
    Object.keys(ISO).every(c => flagFiles.includes(c.toLowerCase() + '.svg')), Object.keys(ISO).filter(c => !flagFiles.includes(c.toLowerCase() + '.svg')).join(','));
  ok('…with the flag-icons licence beside them', fs.existsSync(path.join(ROOT, 'assets', 'flags', 'LICENSE')));
  r = await req('anon', 'GET', '/flags/de.svg');
  ok('/flags/de.svg is served as image/svg+xml with a long cache', r.status === 200 && /image\/svg\+xml/.test(r.type) && /max-age=\d{6,}/.test(r.cache) && /<svg/.test(r.text), r.status + ' ' + r.type + ' ' + r.cache);
  for (const p of ['/flags/zz.svg', '/flags/DE.svg', '/flags/de.svg.bak', '/flags/de.svgx']) {
    r = await req('anon', 'GET', p);
    ok('  ' + p + ' is not a flag (' + r.status + ')', r.status === 404, r.status);
  }
  /* Only a bare two-letter name is looked up: a climbing name never reaches
     the flags route, and nothing outside the site folder comes back. */
  for (const p of ['/flags/..%2f..%2f..%2f..%2fetc%2fpasswd', '/flags/%2e%2e%2f%2e%2e%2fetc%2fpasswd']) {
    r = await req('anon', 'GET', p);
    ok('  ' + p + ' climbs nowhere (' + r.status + ')', !/root:/.test(r.text) && !/image\/svg/.test(r.type), r.status + ' ' + r.type);
  }
  const findHtml = await get('/find-university');
  ok('Find University: the Destination rail draws each country with <img src=/flags/..svg>', /name="country" value="DE"[^>]*> <span><img class="flagimg" src="\/flags\/de\.svg" alt="Germany"/.test(findHtml));
  ok('Find University: no emoji flag left in the rail', !/[\u{1F1E6}-\u{1F1FF}]/u.test(findHtml.slice(findHtml.indexOf('id="frail"'), findHtml.indexOf('id="frail"') + 20000)));
  const lockedRow = /<article class="frow locked"[\s\S]*?<\/article>/.exec(findHtml);
  ok('Find University: a locked row\'s tile is the flag picture', !lockedRow || /class="flogo lock"[^>]*><img class="flagimg" src="\/flags\/[a-z]{2}\.svg"/.test(lockedRow[0]), lockedRow ? lockedRow[0].slice(0, 200) : '');
  const bremenHtml = await get('/university/university-of-bremen');
  ok('a university page\'s country pill is the flag picture', /<span class="pill"><img class="flagimg" src="\/flags\/de\.svg" alt="Germany"[^>]*> Germany<\/span>/.test(bremenHtml));
  const dirHtml = await get('/university');
  ok('the /university list heads each country with its flag picture', /<h2 id="germany"><img class="flagimg" src="\/flags\/de\.svg"/.test(dirHtml));

  /* ------------------------------------------------------------ 2, 3, 4 API */
  const home = await get('/');
  console.log('\n2. The "partnered … free to apply to" line');
  ok('the sentence is not on the home page', !/nothing to buy first/.test(home) && !/Universities we are partnered with are/.test(home));
  const content = (await req('anon', 'GET', '/api/content')).body;
  ok('…nor in the editable text (Admin → content)', !JSON.stringify(content.text || {}).includes('nothing to buy first')
    && !fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8').includes('nothing to buy first'));

  console.log('\n3. No "Work & migrate" tab on the home page');
  ok('the Services tabs have no data-cat="migrate"', !/data-cat="migrate"/.test(home) && !/<span>Work &amp; migrate<\/span>/.test(home));
  const items = (content.services || {}).items || [];
  ok('…and the services in it are still there (Canada PR, Opportunity Card)', ['canadapr', 'oppcard'].every(id => items.some(x => x.id === id)));
  ok('…with their own pages', (await req('anon', 'GET', '/migrate-canada-pr')).status === 200 && (await req('anon', 'GET', '/work-opportunity-card')).status === 200);

  console.log('\n4. CV, Book Counselling and APS in Most Booked again');
  for (const id of ['cv', 'counsel', 'aps']) {
    const s = items.find(x => x.id === id);
    ok('  ' + id + ' carries Most Booked AND More Services', s && s.cats.includes('top') && s.cats.includes('more'), s && JSON.stringify(s.cats));
  }
  {
    /* The one-time migration on an install where patch 169 already moved them. */
    const SEED = require(path.join(ROOT, 'server', 'seed.js'));
    const store = { services: { tabs: [{ key: 'top' }, { key: 'more' }], items: [
      { id: 'cv', cats: ['more'] }, { id: 'counsel', cats: ['more'] }, { id: 'aps', cats: ['consult'] }, { id: 'sop', cats: ['top'] }] } };
    const logs = [];
    const fake = { content: k => store[k] || null, setContent: (k, v) => { store[k] = v; }, log: (...a) => logs.push(a) };
    const n = SEED.mostBookedAgain({ db: fake });
    const by = id => store.services.items.find(x => x.id === id).cats;
    ok('the migration puts the three back in Most Booked and keeps More Services', n === 3 && by('cv').join() === 'top,more' && by('counsel').join() === 'top,more' && by('aps').join() === 'top,consult,more', JSON.stringify(store.services.items));
    ok('…touches nothing else', by('sop').join() === 'top');
    store.services.items.find(x => x.id === 'cv').cats = ['more'];      // the office files it away again
    ok('…and runs once: the office\'s later choice stands', SEED.mostBookedAgain({ db: fake }) === 0 && by('cv').join() === 'more');
    ok('it runs after moreServicesTab at boot', /seed\.moreServicesTab\(\{ db \}\);[\s\S]{0,200}seed\.mostBookedAgain\(\{ db \}\);/.test(fs.readFileSync(path.join(ROOT, 'serve.js'), 'utf8')));
  }

  /* ---------------------------------------------------------------- 9 API */
  console.log('\n9. A name needs a letter');
  r = await req('n1', 'POST', '/send.php', { name: '12345', phone: '9876543210', email: 'n1@example.com', consent: 'yes' });
  ok('the counselling endpoint refuses "12345" with "A name needs at least one letter." on the name field',
    r.status === 422 && r.body.error === 'A name needs at least one letter.' && r.body.fields && r.body.fields[0].field === 'name', r.status + ' ' + r.text);
  r = await req('n2', 'POST', '/api/enquiries', { name: 'Ann <3', phone: '9876543210', email: 'n2@example.com', consent: 'yes' });
  ok('a name with other characters gets its own reason, on the name field', r.status === 422 && /only have letters/.test(r.body.error) && r.body.fields[0].field === 'name', r.text);
  r = await req('n3', 'POST', '/api/assist', { name: '12345', phone: '9876543210', email: 'n3@example.com', consent: 'yes', filters: {} });
  ok('special assistance refuses "12345" the same way', r.status === 422 && /at least one letter/.test(r.body.error), r.text);
  const contactHtml = await withScripts('/contact-us'), referHtml = await withScripts('/refer');
  ok('the contact and refer forms check the name in the browser and show a 422\'s reason',
    /needs at least one letter/.test(contactHtml) && /r\.status === 422/.test(contactHtml) && /needs at least one letter/.test(referHtml) && /r\.status === 422/.test(referHtml));

  /* --------------------------------------------------------------- 11 API */
  console.log('\n11. Facet counts after the CGPA filter');
  for (const q of ['cgpa=5', 'cgpa=7', 'cgpa=8.5', 'cgpa=7&level=master']) {
    const h = await get('/find-university?' + q);
    const total = num((/id="fsummary">([\d,]+) programme/.exec(h) || [])[1]);
    const rail = h.slice(h.indexOf('id="frail"'));
    const facet = name => [...rail.matchAll(new RegExp('name="' + name + '" value="([^"]+)"[^>]*>[\\s\\S]*?<em>([\\d,]+)</em>', 'g'))].map(m => [m[1], num(m[2])]);
    const cs = facet('country'), lv = facet('level');
    const sum = a => a.reduce((t, x) => t + x[1], 0);
    ok('  ?' + q + ': ' + total + ' match; every country and level count is ≤ that', total > 0 && cs.length && cs.every(x => x[1] <= total) && lv.every(x => x[1] <= total), J(cs) + ' ' + J(lv));
    if (!/level=/.test(q)) ok('  ?' + q + ': the country counts add up to the results', sum(cs) === total, sum(cs) + ' vs ' + total);
    else ok('  ?' + q + ': the level counts are counted without the level filter, so Master\'s is the total', (lv.find(x => x[0] === 'master') || [])[1] === total, J(lv));
  }
  {
    const FIND = require(path.join(ROOT, 'server', 'find.js'));
    const REQS = require(path.join(ROOT, 'server', 'reqs.js'));
    const rows = [
      { id: 1, country: 'DE', level: 'master', field: 'X', minCgpa: 8, isPublic: true, reqs: {} },
      { id: 2, country: 'DE', level: 'master', field: 'X', minCgpa: 6, isPublic: true, reqs: {} },
      { id: 3, country: 'FR', level: 'bachelor', field: 'Y', minCgpa: 9, isPublic: false, reqs: {} },
    ];
    const R = FIND.run(rows, FIND.parse('cgpa=7'), REQS, {});
    ok('find.js run(): a row the CGPA bar turns away is not in any facet', R.total === 1 && R.facets.country.DE === 1 && !R.facets.country.FR && R.facets.level.master === 1, J(R.facets) + ' total ' + R.total);
    const R10 = FIND.run(rows, FIND.parse('cgpa=10'), REQS, {});
    ok('find.js run(): cgpa=10 means 10 — every row clears', R10.total === 3, R10.total);
  }
  {
    const h = await get('/find-university');
    ok('the CGPA box has its own "Not told us yet", ticked when no CGPA is given, and the slider rests mid-scale',
      /<div class="fcg empty"><input type="range" id="fcgpa" name="cgpa" min="5" max="10" step="0.1" value="7\.5"/.test(h) && /<input type="checkbox" id="fcgnone" checked> Not told us yet/.test(h));
    const h10 = await get('/find-university?cgpa=10');
    ok('?cgpa=10 shows "CGPA 10", the slider at 10, the box unticked', /value="10" aria-label="Your CGPA"><output for="fcgpa">CGPA 10<\/output>/.test(h10) && /<input type="checkbox" id="fcgnone"> Not told us yet/.test(h10));
  }

  /* --------------------------------------------------------------- 12 API */
  console.log('\n12. Babelsberg');
  const bab = await get('/university/film-university-babelsberg-konrad-wolf');
  const chip = (/href="([^"]+)" target="_blank" rel="noopener nofollow">Official site/.exec(bab) || [])[1] || '';
  ok('Film University Babelsberg\'s Official site is filmuniversitaet.de, not uni-potsdam.de', /^https:\/\/www\.filmuniversitaet\.de\/?$/.test(chip), chip || bab.slice(0, 120));
  const UNIS = require(path.join(ROOT, 'server', 'unis.js'));
  const g = UNIS.group([{ university: 'Film University Babelsberg KONRAD WOLF', country: 'DE', url: 'https://www.uni-potsdam.de/en/x', isPublic: true }]);
  ok('…from the built-in override, ahead of the course-link guess', g[0].url === 'https://www.filmuniversitaet.de', g[0].url);
  ok('the office\'s list of universities with no site was written (scratchpad CSV)', fs.existsSync(SP + '/oct22/universities-without-website.csv')
    && /^slug,name,country,suggested_domain/.test(fs.readFileSync(SP + '/oct22/universities-without-website.csv', 'utf8')));

  /* ---------------------------------------------------------------- 6 API */
  console.log('\n6. The inside-page banner');
  const BANNERS = [
    ['/find-university', 'Find university', 'abroad', 'city'],
    ['/contact-us', 'Contact', 'us', 'city'],
    ['/migrate-canada-pr', 'Migrate', 'Express Entry', 'globe'],
    ['/study-in-germany', 'Study abroad', 'Germany', 'city'],
    ['/work-opportunity-card', 'Work in Germany', 'Opportunity Card', 'globe'],
    ['/blog', 'Blog', null, 'city'],
    ['/about-us', 'About us', null, 'city'],
    ['/university/university-of-bremen', 'Study in Germany', 'Bremen', 'city'],
    ['/terms', 'Legal', null, 'city'],
  ];
  for (const [p, eye, it, art] of BANNERS) {
    const h = await get(p);
    const sec = (/<section class="page-hero"[^>]*data-ph2[\s\S]*?<\/section>/.exec(h) || [''])[0];
    ok('  ' + p + ': the card, eyebrow "' + eye + '", ' + (it ? 'italic "' + it + '", ' : '') + art + ' art',
      /<div class="ph2-card">/.test(sec) && sec.includes('<div class="ph2-eye">' + eye + '</div>')
      && (!it || sec.includes('<em>' + it + '</em></h1>')) && sec.includes('data-art-kind="' + art + '"') && /<div class="ph2-art" aria-hidden="true"><svg/.test(sec)
      && /<style data-ph2>/.test(h), sec.slice(0, 400));
  }
  {
    const h = await get('/find-university');
    const chips = [...h.matchAll(/<div class="ph2-chip"><b>([^<]*)<\/b>(?:<span>([^<]*)<\/span>)?/g)].map(m => m[1] + ' ' + (m[2] || ''));
    ok('Find University: 2–3 chips, none a programme or university count', chips.length >= 2 && chips.length <= 3 && chips.every(c => !/\d[\d,]*\s*(programme|universit|match)/i.test(c)), chips.join(' | '));
    const steps = [...(await get('/migrate-canada-pr')).matchAll(/<div class="ph2-chip"><b>(0\d)<\/b><span>([^<]*)<\/span>/g)].map(m => m[1] + ' ' + m[2]);
    ok('Canada PR: the 01/02/03 steps', steps.join(' | ') === '01 ECA &amp; language test | 02 CRS profile | 03 Invitation draws', steps.join(' | '));
    const ct = [...(await get('/contact-us')).matchAll(/<div class="ph2-chip"><b>([^<]*)<\/b><span>([^<]*)<\/span>/g)].map(m => m[1] + ' · ' + m[2]);
    ok('Contact: "Mon–Sat · 9:30am–7:30pm IST" and "Hyderabad · office, or online"', ct.join(' | ') === 'Mon–Sat · 9:30am–7:30pm IST | Hyderabad · office, or online', ct.join(' | '));
    ok('a university page\'s banner subtitle has no programme count', !/<p>[^<]*\d+ programmes?<\/p>/.test(bremenHtml.slice(bremenHtml.indexOf('data-ph2'), bremenHtml.indexOf('data-ph2') + 30000).split('</section>')[0]));
    const HERO = require(path.join(ROOT, 'server', 'hero.js'));
    ok('hero.js: the italic rule — after " — ", else the last word, a tail for "Find your university"',
      HERO.italicHtml('Canada PR — Express Entry') === 'Canada PR — <em>Express Entry</em>' && HERO.italicHtml('Contact us') === 'Contact <em>us</em>'
      && HERO.italicHtml('Find your university') === 'Find your university <em>abroad</em>' && HERO.italicHtml('R&amp;D in Berlin') === 'R&amp;D in <em>Berlin</em>');
    ok('hero.js: a page can name its own eyebrow, italic words and chips (data-*)',
      /<div class="ph2-eye">Hello<\/div><h1>One two <em>three four<\/em><\/h1>[\s\S]*<b>A<\/b><span>b<\/span>/.test(HERO.upgrade('<head></head><section class="page-hero" data-eyebrow="Hello" data-italic="three four" data-chips="A|b;;C|d"><div class="wrap"><div class="crumbs">x</div><h1>One two three four</h1><p>s</p></div></section>', '/x')));
  }

  /* ---------------------------------------------------------- the browser */
  const browser = await chromium.launch();
  try {
    /* ---- home, desktop ---- */
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#rows .mrow', { timeout: 15000 }).catch(() => {});
    console.log('\n1. (browser) flags on the home page');
    const mcc = await page.$$eval('#rows .mrow .mcc', els => els.map(e => ({ img: (e.querySelector('img') || {}).src || '', text: e.textContent.trim() })));
    ok('every result row\'s tile is a picture (a logo or the flag), never two letters', mcc.length > 0 && mcc.every(x => x.img && !/^[A-Z]{2}$/.test(x.text)), JSON.stringify(mcc.slice(0, 4)));
    ok('…and the flag pictures are /flags/<cc>.svg with a country name for alt', await page.$$eval('#rows .mcc img.flagimg', els => els.length > 0 && els.every(e => /\/flags\/[a-z]{2}\.svg$/.test(e.src) && e.alt && e.complete && e.naturalWidth > 0)));
    /* Everything we offer. */
    const offer = await page.$$eval('.ccard .cflag', els => els.map(e => ({ img: (e.querySelector('img') || {}).src || '', text: e.textContent.trim() })));
    ok('"Everything we offer" cards show the flag picture', offer.length > 0 && offer.every(x => /\/flags\/[a-z]{2}\.svg$/.test(x.img) && !x.text), JSON.stringify(offer.slice(0, 3)));
    ok('the dashboard preview on the home page shows flag pictures', await page.$$eval('.dcard .dflag', els => els.length === 3 && els.every(e => e.querySelector('img[src^="/flags/"]') && !e.textContent.trim())));
    ok('the country dropdown reads the name alone (an option cannot hold the SVG)', await page.$eval('#fCountry', s => [...s.options].filter(o => o.value).every(o => !/[\u{1F1E6}-\u{1F1FF}]/u.test(o.textContent))));

    console.log('\n2–4. (browser) the home page sections');
    ok('the "partnered" sentence is not on the page', !(await page.textContent('body')).includes('nothing to buy first'));
    ok('no "Work & migrate" tab', (await page.$$('[data-cat="migrate"]')).length === 0 && !(await page.$$eval('#services .tab', els => els.map(e => e.textContent).join('|'))).includes('Work & migrate'));
    const mb = await page.$$eval('#svcGrid .svc h3', els => els.map(e => e.textContent.trim()));
    ok('Most Booked shows Academic CV & Resume, Book Counselling and APS, Attestation & Translation',
      ['Academic CV & Resume', 'Book Counselling', 'APS, Attestation & Translation'].every(n => mb.includes(n)), mb.join(' | '));
    await page.click('[data-cat="more"]');
    const more = await page.$$eval('#svcGrid .svc h3', els => els.map(e => e.textContent.trim()));
    ok('…and More Services still has them', ['Academic CV & Resume', 'Book Counselling', 'APS, Attestation & Translation'].every(n => more.includes(n)), more.join(' | '));
    await page.click('[data-cat="top"]');

    console.log('\n5. (browser) the Search button');
    const go = await page.$('#fSearchWrap #fSearchGo');
    const geo = go && await page.evaluate(() => { const b = document.getElementById('fSearchGo').getBoundingClientRect(), i = document.getElementById('fSearch').getBoundingClientRect(); return { b: [b.left, b.right, b.top, b.bottom], i: [i.left, i.right, i.top, i.bottom] }; });
    ok('a "Search" button sits inside the box, at its right', !!go && (await go.textContent()).trim() === 'Search'
      && geo.b[1] <= geo.i[1] && geo.b[1] > geo.i[1] - 20 && geo.b[0] > geo.i[0] + geo.i[1] / 2 - geo.i[0] / 2 && geo.b[2] >= geo.i[2] && geo.b[3] <= geo.i[3], JSON.stringify(geo));
    /* With the suggestions open, the button takes the first tag offered —
       what Enter does — on two fresh pages, one each way. */
    const viaWay = async (way, wait) => {
      const px = await ctx.newPage();
      await px.goto(BASE + '/', { waitUntil: 'networkidle' });
      await px.waitForSelector('#rows .mrow', { timeout: 15000 }).catch(() => {});
      const before = await px.$$eval('#rows .mrow', e => e.length);
      await px.click('#fSearch');
      await px.keyboard.type('Berlin');
      if (wait) await px.waitForSelector('#fSearchRes .fstag', { timeout: 8000 }).catch(() => {});
      if (way === 'button') await px.click('#fSearchGo'); else await px.press('#fSearch', 'Enter');
      await px.waitForTimeout(700);
      const out = { chips: await px.$$eval('#fTagChips .ftagchip', els => els.map(e => e.textContent.trim())), box: await px.inputValue('#fSearch'),
        before, after: await px.$$eval('#rows .mrow', e => e.length) };
      await px.close();
      return out;
    };
    const byBtn = await viaWay('button', true), byEnter = await viaWay('enter', true);
    ok('clicking it applies what was typed, as Enter does (a chip; the box empties; the results narrow)',
      byBtn.chips.some(c => /Berlin/.test(c)) && byBtn.box === '' && byBtn.after <= byBtn.before, JSON.stringify(byBtn));
    ok('Enter behaves as before, and the button gives the same result', JSON.stringify(byEnter.chips) === JSON.stringify(byBtn.chips) && byEnter.after === byBtn.after, JSON.stringify(byEnter) + ' vs ' + JSON.stringify(byBtn));
    const quick = await viaWay('button', false);
    ok('before any suggestion is back, the button searches the names for the words typed', quick.chips.some(c => /Berlin/.test(c)), JSON.stringify(quick));
    await page.fill('#fSearch', '');
    await page.click('#fSearchGo');
    ok('an empty box just takes the focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'fSearch'));

    console.log('\n9. (browser) the counselling form');
    await page.goto(BASE + '/#counsel', { waitUntil: 'networkidle' });
    await page.fill('#cName', '12345'); await page.fill('#cPhone', '9876543210'); await page.fill('#cMail', 'r172@example.com');
    await page.check('#cOk');
    let sent = 0; page.on('request', q => { if (/send\.php/.test(q.url())) sent++; });
    await page.click('#cGo');
    await page.waitForTimeout(400);
    const nameErr = await page.$eval('#cName', i => ({ bad: i.closest('.fld').classList.contains('bad'), err: i.closest('.fld').querySelector('.err').textContent }));
    ok('"12345" → "A name needs at least one letter" beside the field, nothing sent', nameErr.bad && nameErr.err === 'A name needs at least one letter' && sent === 0, JSON.stringify(nameErr) + ' sent ' + sent);
    await page.fill('#cName', 'Ann <3');
    await page.click('#cGo');
    await page.waitForTimeout(1200);
    const srvErr = await page.$eval('#cName', i => ({ bad: i.closest('.fld').classList.contains('bad'), err: i.closest('.fld').querySelector('.err').textContent }));
    const failBox = await page.$eval('#cFail', e => getComputedStyle(e).display !== 'none' ? e.textContent : '');
    ok('a name the server refuses shows the server\'s reason beside the field, not "That did not send"', sent === 1 && srvErr.bad && /only have letters/.test(srvErr.err) && !/did not send/.test(failBox), JSON.stringify(srvErr) + ' fail:' + failBox);
    ok('no page errors on the home page', errs.length === 0, errs.join(' | '));
    await ctx.close();

    /* ---- Find University ---- */
    console.log('\n1, 11. (browser) Find University');
    const fctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const fp = await fctx.newPage();
    await fp.goto(BASE + '/find-university?cgpa=5', { waitUntil: 'networkidle' });
    await fp.waitForTimeout(500);
    const live = await fp.evaluate(() => {
      const total = Number((document.getElementById('fsummary').textContent.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
      const cs = [...document.querySelectorAll('#frail input[name=country]')].filter(i => i.value).map(i => Number((i.closest('label').querySelector('em') || {}).textContent.replace(/,/g, '') || 0));
      return { total, cs, flags: document.querySelectorAll('#frail .fopt img.flagimg').length };
    });
    ok('re-counted in the browser, the country counts still add up to the results', live.total > 0 && live.cs.reduce((a, b) => a + b, 0) === live.total, JSON.stringify(live));
    ok('the rail\'s countries carry flag pictures after the browser re-draws', live.flags > 0);
    ok('the banner\'s title is still italic after the browser re-draws it', await fp.$eval('.page-hero h1', h => !!h.querySelector('em')));
    await fp.goto(BASE + '/find-university', { waitUntil: 'networkidle' });
    await fp.$eval('#fcgpa', i => { i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
    await fp.waitForTimeout(400);
    ok('moving the slider to 10 filters by CGPA 10 (not "not told")', /[?&]cgpa=10\b/.test(fp.url()) && (await fp.$eval('#fcgnone', i => !i.checked)) && /CGPA 10/.test(await fp.textContent('.fcg output')), fp.url());
    await fp.evaluate(() => { const d = document.getElementById('fcgnone').closest('details'); if (d) d.open = true; });
    await fp.check('#fcgnone');
    await fp.waitForTimeout(400);
    ok('ticking "Not told us yet" forgets the CGPA', !/cgpa=/.test(fp.url()) && /Not told us yet/.test(await fp.textContent('.fcg output')), fp.url());
    await fctx.close();

    /* ---- the student's screens ---- */
    console.log('\n1. (browser) the dashboard shortlist and My Programs');
    {
      const sctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
      const sp = await sctx.newPage();
      const lr = await sp.request.post(BASE + '/api/auth/login', { data: { email: 'student@glovels.com', password: 'glovels123' }, headers: { 'x-forwarded-for': '10.172.99.9' } });
      const pub = ((await (await sp.request.get(BASE + '/api/catalogue')).json()).programmes || []).find(p => !p.isPublic && !p.locked && p.country);
      if (pub) await sp.request.post(BASE + '/api/shortlist', { data: { id: pub.id }, headers: { 'x-forwarded-for': '10.172.99.9' } });
      await sp.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
      await sp.waitForSelector('.sl-flag', { timeout: 8000 }).catch(() => {});
      const fl = await sp.$$eval('.sl-flag', els => els.map(e => ({ img: (e.querySelector('img') || {}).getAttribute ? e.querySelector('img').getAttribute('src') : '', text: e.textContent.trim() })));
      ok('dashboard: every shortlist row\'s country is the flag picture', lr.status() === 200 && fl.length > 0 && fl.every(x => /^\/flags\/[a-z]{2}\.svg$/.test(x.img) && !x.text), lr.status() + ' ' + JSON.stringify(fl.slice(0, 3)));
      await sp.goto(BASE + '/universities.html', { waitUntil: 'domcontentloaded' }); await sp.waitForSelector('.sl-flag', { timeout: 8000 }).catch(() => {});
      await sp.waitForTimeout(600);
      const mp = await sp.$$eval('.sl-flag', els => els.map(e => ({ img: (e.querySelector('img') || {}).getAttribute ? e.querySelector('img').getAttribute('src') : '', text: e.textContent.trim() })));
      ok('My Programs: the flags are pictures', mp.length === 0 || mp.every(x => /^\/flags\/[a-z]{2}\.svg$/.test(x.img) && !x.text), JSON.stringify(mp.slice(0, 3)));
      await sctx.close();
    }

    /* ---- the banner, desktop and phone ---- */
    console.log('\n6. (browser) the banner at 1400 and 375');
    for (const [w, h] of [[1400, 900], [375, 812]]) {
      const bctx = await browser.newContext({ viewport: { width: w, height: h } });
      const bp = await bctx.newPage();
      for (const p of ['/find-university', '/contact-us', '/migrate-canada-pr', '/university/university-of-bremen']) {
        await bp.goto(BASE + p, { waitUntil: 'networkidle' });
        const m = await bp.evaluate(() => {
          const card = document.querySelector('.page-hero .ph2-card'), h1 = document.querySelector('.page-hero h1');
          const em = h1 && h1.querySelector('em'), eye = document.querySelector('.ph2-eye');
          const chips = [...document.querySelectorAll('.ph2-chip')].map(c => c.getBoundingClientRect());
          const art = document.querySelector('.ph2-art');
          const cs = card && getComputedStyle(card);
          return {
            sw: document.documentElement.scrollWidth, card: card && card.getBoundingClientRect().width,
            radius: cs && parseFloat(cs.borderTopLeftRadius), bg: cs && cs.backgroundImage,
            emColor: em && getComputedStyle(em).color, emStyle: em && getComputedStyle(em).fontStyle,
            eye: eye && getComputedStyle(eye).textTransform, h1Bottom: h1 && h1.getBoundingClientRect().bottom,
            chipTop: chips.length ? Math.min(...chips.map(c => c.top)) : null, chipRight: chips.length ? Math.max(...chips.map(c => c.right)) : null,
            artShown: art ? getComputedStyle(art).display !== 'none' : false,
          };
        });
        const tag = p + ' @' + w;
        ok('  ' + tag + ': a rounded card inside the page width, italic gold word, no sideways scroll',
          m.sw <= w && m.card > 0 && m.card < w && m.radius >= 14 && /gradient/.test(m.bg) && m.emStyle === 'italic' && /rgb\(226, 184, 96\)/.test(m.emColor) && m.eye === 'uppercase', JSON.stringify(m));
        if (w === 375) ok('  ' + tag + ': the chips wrap below the title', m.chipTop == null || (m.chipTop > m.h1Bottom && m.chipRight <= w), JSON.stringify(m));
        else ok('  ' + tag + ': the illustration is drawn', m.artShown);
      }
      await bctx.close();
    }

    /* ---- 8: university pages on a phone ---- */
    console.log('\n8. University pages at 375px');
    {
      const slugs = [...new Set([...dirHtml.matchAll(/href="(?:\/)?university\/([a-z0-9-]+)"/g)].map(m => m[1]))];
      const must = ['university-of-bremen', 'rwth-aachen-university'];
      const rest = slugs.filter(s => !must.includes(s));
      const step = Math.max(1, Math.floor(rest.length / 18));
      const sample = must.filter(s => slugs.includes(s)).concat(rest.filter((s, i) => i % step === 0).slice(0, 20 - must.length));
      const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
      const pp = await pctx.newPage();
      const wide = []; let lockedSeen = 0;
      for (const s of sample) {
        await pp.goto(BASE + '/university/' + s, { waitUntil: 'domcontentloaded' });
        await pp.waitForTimeout(150);
        const m = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, locked: document.querySelectorAll('.prog.locked').length,
          lw: Math.max(0, ...[...document.querySelectorAll('.prog.locked')].map(e => e.getBoundingClientRect().width)) }));
        if (m.locked) lockedSeen++;
        if (m.sw > 375 || m.lw > 375) wide.push(s + ' ' + m.sw + '/' + m.lw);
      }
      ok('the sample has 20 university pages, with Bremen and RWTH Aachen', sample.length === 20 && must.every(s => sample.includes(s)), sample.length + ' ' + must.filter(s => !sample.includes(s)));
      ok('some of them have locked programme cards', lockedSeen > 0, lockedSeen);
      ok('every one fits 375px — documentElement.scrollWidth ≤ 375, locked cards included', wide.length === 0, wide.join(', '));
      await pctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });

function J(x) { return JSON.stringify(x); }
