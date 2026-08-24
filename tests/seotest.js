/**
 * Can the site be found?
 *
 * robots.txt shipped saying "Disallow: /". That was right for a preview build
 * and would have been a quiet disaster on the live site — the blog posts, the
 * country pages and every SEO title the office can edit would never have been
 * read by a search engine at all. Nobody would have noticed for months.
 *
 * It is generated now, from one setting, and this checks all three states of it
 * plus what the pages themselves offer a crawler.
 *
 * Runs its own servers, so no port argument.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = '/home/claude/glovels/build';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const get = (port, p) => new Promise(resolve => {
  http.get({ host: 'localhost', port, path: p }, res => {
    let body = '';
    res.on('data', c => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', () => resolve({ status: 0, body: '' }));
});

async function boot(port, env) {
  const dir = '/tmp/db-seo-' + port;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn('node', ['serve.js'], {
    cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir }, env),
  });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 400));
    const h = await get(port, '/api/health');
    if (h.status === 200) return child;
  }
  child.kill();
  throw new Error('server on ' + port + ' never answered');
}

const PROD = {
  GLOVELS_ENV: 'production',
  ADMIN_EMAIL: 'owner@glovels.com',
  ADMIN_PASSWORD: 'a-very-long-real-password-2f9',
};

(async () => {
  const kids = [];
  try {
    /* ------------------------------------------ the real site, on its own domain */
    kids.push(await boot(8071, Object.assign({}, PROD, { GLOVELS_URL: 'https://glovels.com' })));
    let r = await get(8071, '/robots.txt');
    check('a live site on its own domain invites crawlers',
      /Allow: \//.test(r.body) && !/^Disallow: \/$/m.test(r.body), r.body.slice(0, 60));
    check('and keeps them out of the portal',
      /Disallow: \/dashboard/.test(r.body) && /Disallow: \/api\//.test(r.body));
    check('and points at its sitemap',
      /Sitemap: https:\/\/glovels\.com\/sitemap\.xml/.test(r.body));

    const sm = await get(8071, '/sitemap.xml');
    check('the sitemap is served', sm.status === 200, sm.status);
    const urls = (sm.body.match(/<loc>([^<]+)<\/loc>/g) || []).map(x => x.slice(5, -6));
    check('it lists the public pages', urls.length > 20, urls.length + ' pages');
    check('the home page is in it', urls.includes('https://glovels.com/'));
    check('a country page is in it',
      urls.some(u => /study-in-germany/.test(u)), urls.slice(0, 3).join(' '));
    check('a blog post is in it', urls.some(u => /\/post\//.test(u)));
    check('nothing behind a sign-in is in it',
      !urls.some(u => /(dashboard|profile|documents|messages|admin|counsellor|login)/.test(u)),
      urls.filter(u => /dashboard|admin|login/.test(u)).join(' '));
    check('and neither is the 404 page', !urls.some(u => /404/.test(u)));
    check('every address is absolute and https',
      urls.every(u => u.startsWith('https://glovels.com/')), urls[0]);

    /* --------------------------------- the platform's own address, before a domain */
    kids.push(await boot(8072, Object.assign({}, PROD,
      { RENDER_EXTERNAL_URL: 'https://glovels.onrender.com' })));
    r = await get(8072, '/robots.txt');
    check('the platform address is NOT offered for indexing',
      /Disallow: \/$/m.test(r.body) && !/Allow: \//.test(r.body), r.body.slice(0, 70));
    check('and has no sitemap to crawl', (await get(8072, '/sitemap.xml')).status === 404);

    /* ------------------------------------------------------ asked for explicitly */
    kids.push(await boot(8073, Object.assign({}, PROD,
      { RENDER_EXTERNAL_URL: 'https://glovels.onrender.com', ALLOW_INDEXING: 'true' })));
    r = await get(8073, '/robots.txt');
    check('ALLOW_INDEXING turns it on anyway', /Allow: \//.test(r.body), r.body.slice(0, 60));

    /* ------------------------------------------------ what a crawler finds on a page */
    const browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    await page.goto('http://localhost:8071/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const title = await page.title();
    /* Google cuts a title around 60 characters. Longer than 80 is not a title,
       it is a paragraph; the office can shorten it on the Home page screen. */
    check('the home page has a title worth ranking',
      title.length > 20 && title.length <= 80, title.length + ': ' + title);
    const desc = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    check('and a search description', desc.length > 60, desc.length + ': ' + desc.slice(0, 60));
    check('there is exactly one h1',
      (await page.$$('h1')).length === 1, (await page.$$('h1')).length);
    const noindex = await page.$$('meta[name="robots"][content*="noindex"]');
    check('no page-level noindex left on the home page', noindex.length === 0);

    /* The one that would have kept the whole site out of Google. Every page
       shipped with a noindex on it; the public ones lose it when the site is
       live, the portal keeps it always. */
    let stillHidden = [];
    for (const s of ['about-us', 'blog', 'study-in-germany', 'contact-us']) {
      await page.goto('http://localhost:8071/' + s, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      if ((await page.$$('meta[name="robots"][content*="noindex"]')).length) stillHidden.push(s);
    }
    check('the public pages are indexable on a live site',
      stillHidden.length === 0, stillHidden.join(' '));

    let leaked = [];
    for (const s of ['dashboard', 'admin', 'login', '404']) {
      await page.goto('http://localhost:8071/' + s, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      if (!(await page.$$('meta[name="robots"][content*="noindex"]')).length) leaked.push(s);
    }
    check('and the portal is still told to stay out of the index',
      leaked.length === 0, leaked.join(' '));

    /* And before the domain is pointed here, nothing is indexable. */
    const pre = await (await browser.newContext()).newPage();
    await pre.goto('http://localhost:8072/', { waitUntil: 'load' });
    await pre.waitForTimeout(500);
    check('nothing is indexable while the site is on the platform address',
      (await pre.$$('meta[name="robots"][content*="noindex"]')).length === 1);
    await pre.close();

    /* ------------------------------------- the notes we left ourselves
       Twenty-seven pages carried a "To write" block addressed to this office
       and published to everybody. They belong to the copy opened from disk. */
    const notes = [];
    for (const s of ['about-us', 'careers', 'refer', 'glossary',
      'language-french', 'work-nursing-germany', 'test-gre-gmat-sat']) {
      await page.goto('http://localhost:8071/' + s, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const n = await page.$$eval('.towrite',
        els => els.filter(e => e.offsetParent !== null).length);
      if (n) notes.push(s);
    }
    check('no "To write" notes are published to visitors',
      notes.length === 0, notes.join(' '));

    /* blog.html, not careers.html and not terms.html. Both of those have since
       been written, and each one's note to ourselves went with the stub it was
       attached to — testing for a note on a page that no longer needs one is
       testing the wrong thing. Blog's note is still true: the six posts are
       waiting to be pasted into the sheet, and the office needs to keep seeing
       that until they are. */
    const fileCopy = await (await browser.newContext()).newPage();
    await fileCopy.goto('file:///home/claude/glovels/build/blog.html', { waitUntil: 'load' });
    await fileCopy.waitForTimeout(500);
    check('but the office still sees them on the copy it opens from disk',
      (await fileCopy.$$eval('.towrite',
        els => els.filter(e => e.offsetParent !== null).length)) === 1);
    await fileCopy.close();

    /* Every public page: a title, a description, and no noindex. */
    const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
      .map(f => f.slice(0, -5))
      /* Portal screens, which are behind a sign-in and are not indexed. `services`
         joined them when the student portal got its own Services screen — it is
         not the public services grid, which lives on the home page. */
      .filter(s => !['dashboard', 'profile', 'documents', 'messages', 'applications',
        'universities', 'scholarships', 'services', 'visa', 'admin', 'counsellor',
        'chat', 'home', 'catalogue', 'blog-admin', 'leads', 'login', '404',
        'index'].includes(s));
    const missing = [], thin = [];
    for (const s of pages) {
      await page.goto('http://localhost:8071/' + s, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const t = await page.title();
      const d = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
      if (t.length < 12 || d.length < 30) missing.push(s + ' (title ' + t.length + ', desc ' + d.length + ')');
      else if (d.length < 70) thin.push(s + ' (' + d.length + ' characters)');
    }
    check('every public page has a title and a search description',
      missing.length === 0, missing.slice(0, 4).join(' | '));

    /* Not a failure — a note. A short description is copy somebody has to
       write, not something the code can be wrong about. Google shows roughly
       155 characters and writes its own when the tag is too thin to use. */
    if (thin.length) {
      console.log('\nNOTE — search descriptions short enough that Google will write its own:');
      thin.forEach(x => console.log('  · ' + x));
    }

    await browser.close();
  } finally {
    kids.forEach(k => { try { process.kill(-k.pid); } catch (e) { try { k.kill(); } catch (e2) {} } });
  }

  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
