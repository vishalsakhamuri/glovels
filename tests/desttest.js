/**
 * The pages glovels.com had and this site did not.
 *
 * "All the pages are not copied to glovels.onrender.com." Eight destinations
 * and the visa-processing page, at the Wix addresses — those are the ones
 * Google has indexed — built by build_destinations.py and written in
 * page_content.py. And the eight destinations reaching a database that was
 * seeded before they existed, which is every database that matters.
 *
 * Run with indexing on, so the sitemap is the live one:
 *   ALLOW_INDEXING=true GLOVELS_URL=https://glovels.example
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const NEW = {
  'study-in-usa': ['United States', 'F-1', 'OPT'],
  'study-in-australia': ['Australia', 'Genuine Student', 'subclass 500'],
  'study-in-france': ['France', 'Campus France', 'APS'],
  'study-in-czechrepublic': ['Czech Republic', 'nostrification', 'Prague'],
  'study-in-finland': ['Finland', 'joint application', 'Aalto'],
  'study-in-singapore': ['Singapore', 'NUS', "Student's Pass"],
  'study-in-japan': ['Japan', 'Certificate of Eligibility', 'MEXT'],
  'study-in-new-zealand': ['New Zealand', 'Post Study Work', 'Offer of Place'],
};

(async () => {
  const browser = await chromium.launch();
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  for (const [slug, words] of Object.entries(NEW)) {
    const r = await guest.request.get(BASE + '/' + slug);
    const html = await r.text();
    const country = words[0];
    check(slug + ' answers', r.status() === 200);
    check(slug + ': the headline is the country', html.includes('<h1>Study in ' + country + '</h1>'));
    check(slug + ': the prose is on the page', words.slice(1).every(w => html.includes(w)), words.slice(1).join(', '));
    check(slug + ': a fact box with the country\'s own figures', /<div class="factbox">/.test(html)
      && /Living costs<\/span><b>₹[\d,]+ a month/.test(html));
    check(slug + ': the FAQ is marked up for Google', /"@type":\s*"FAQPage"/.test(html)
      && (html.match(/"@type":\s*"FAQPage"/g) || []).length === 1);
    /* The menus and the footer link to the Italy page, rightly. Nothing else may. */
    check(slug + ': no Italy left over from the donor',
      !/Italy/.test(html.replace(/<a href="study-in-italy\.html">Study in Italy<\/a>/g, '')));
    check(slug + ': head and og agree', (() => {
      const t = (/<title>([^<]+)<\/title>/.exec(html) || [])[1];
      return t && html.includes('<meta property="og:title" content="' + t + '"')
        && html.includes('content="https://www.glovels.com/' + slug + '"');
    })());
    check(slug + ': sends to a counsellor, not an empty finder', /Talk to a counsellor about/.test(html)
      && !/See programmes in/.test(html));
    check(slug + ': indexable', /content="index,follow/.test(html));
  }

  /* visa-processing */
  let r = await guest.request.get(BASE + '/visa-processing');
  let html = await r.text();
  check('/visa-processing answers', r.status() === 200);
  check('with the service on it', /<h1>Visa processing<\/h1>/.test(html) && /Student visas/.test(html)
    && /"@type": ?"Service"/.test(html));
  check('and links to the pages it names', /href="work-opportunity-card\.html"/.test(html)
    && /href="migrate-canada-pr\.html"/.test(html));

  /* Menus and sitemap. */
  const home = await (await guest.request.get(BASE + '/')).text();
  check('the Study Abroad menu lists all fifteen', Object.keys(NEW).every(s => home.includes('href="' + s + '.html">Study in '))
    && (home.match(/href="study-in-[a-z-]+\.html">Study in /g) || []).length >= 30 /* desktop + phone */);
  check('Visa processing is in the Migrate menu', /href="visa-processing\.html">Visa processing<\/a>/.test(home));
  const post = await (await guest.request.get(BASE + '/post/german-universities-lower-cgpa')).text();
  check('and on a blog post, with the right relative path', /href="\.\.\/study-in-japan\.html">Study in Japan/.test(post));
  const uni = await (await guest.request.get(BASE + '/university')).text();
  check('and on the university pages', /href="study-in-japan\.html">Study in Japan/.test(uni));
  const map = await (await guest.request.get(BASE + '/sitemap.xml')).text();
  check('the sitemap carries the nine new pages', Object.keys(NEW).every(s => map.includes('/' + s + '</loc>'))
    && map.includes('/visa-processing</loc>'));

  /* The old Wix addresses hand over. */
  for (const [from, to] of [['/study-in-uk', '/study-in-united-kingdom'], ['/canada-pr', '/migrate-canada-pr'],
    ['/germanyopportunitycard', '/work-opportunity-card'], ['/about', '/about-us'],
    ['/blog/categories/german', '/blog'], ['/pricing-india', '/#packages']]) {
    const rr = await guest.request.get(BASE + from, { maxRedirects: 0 });
    check('the Wix address ' + from + ' is a 301 to ' + to, rr.status() === 301 && rr.headers().location === to,
      rr.status() + ' ' + rr.headers().location);
  }
  const gone = await guest.request.get(BASE + '/blank-1');
  check('and an address nobody wants is a 404', gone.status() === 404);
  const svc = await guest.request.get(BASE + '/services', { maxRedirects: 0 });
  check('and /services is still the student\'s own screen', svc.status() === 200);

  /* The finder knows the eight countries. */
  const cat = await (await guest.request.get(BASE + '/api/catalogue')).json();
  check('/api/catalogue knows the eight destinations', ['US', 'AU', 'FR', 'CZ', 'FI', 'SG', 'JP', 'NZ']
    .every(c => cat.countries && cat.countries[c] && cat.countries[c].name), Object.keys(cat.countries || {}).join(','));
  check('with their requirements', cat.countries.JP.workRights === '28 hrs/week with work permission');
  const page = await guest.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '/');
  await page.waitForTimeout(1000);
  const opts = await page.evaluate(() => [...document.querySelectorAll('#fCountry option')].map(o => o.value));
  check('the finder dropdown does not offer a destination with no programmes', !opts.includes('JP') && opts.includes('DE'), opts.join(','));
  check('no script errors on the home page', !errors.length, errors.join(' | '));

  /* ------------------------ a database seeded before the eight existed */
  const store = require('../server/store.js');
  const seed = require('../server/seed.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glovels-dest-'));
  const db = store.open(dir);
  const countries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'countries.json'), 'utf8'));
  const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));
  const old = {};
  ['DE', 'CA', 'GB', 'IE', 'PL', 'ES', 'IT'].forEach(c => { old[c] = countries[c]; });
  seed.seedCatalogue({ db, catalogue, countries: old });
  check('an old database has seven destinations', db.countries(true).length === 7);
  let n = seed.addMissingCountries({ db, countries });
  check('the deploy adds the eight', n === 8 && db.countries(true).length === 15, n + ' added');
  check('with their facts', JSON.parse(db.country('JP').facts).workRights === '28 hrs/week with work permission');
  n = seed.addMissingCountries({ db, countries });
  check('a second deploy adds nothing', n === 0);
  db.deleteCountry('SG');
  n = seed.addMissingCountries({ db, countries });
  check('a destination the office deletes does not come back', n === 0 && !db.country('SG'));
  db.close();

  await browser.close();
  console.log('\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) console.log('\n' + bad.map(x => '  ✗ ' + x).join('\n'));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
