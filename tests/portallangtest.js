/**
 * Patch 268: the student chooses the portal's language, and the home page's
 * keyword line is a heading.
 *
 * Own server (8268) with languages switched on (translator paused, so pages
 * keep their English words — what is tested is the address and the choice).
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8269;
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = path => new Promise(resolve => {
  http.get({ host: 'localhost', port: PORT, path, headers: { Accept: 'text/html' } }, res => {
    let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
  }).on('error', () => resolve({ status: 0, text: '' }));
});

(async () => {
  const dir = '/tmp/db-portallang-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off',
      ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_API_BASE: 'http://127.0.0.1:1', I18N_GATE: 'off', I18N: 'off', ALLOW_INDEXING: 'true', GLOVELS_URL: 'https://www.glovels.test', SITEMAP_PER: '20' }) });
  let browser = null;
  try {
    for (let i = 0; i < 60; i++) { await wait(400); if ((await get('/api/health')).status === 200) break; }
    await wait(1000);

    /* ----------------------------------------------- the home page heading */
    const home = await get('/');
    check('the home page keeps one H1, the brand line', (home.text.match(/<h1[\s>]/g) || []).length === 1 && /<h1>Search\. Click\. <em>Fly\.<\/em><\/h1>/.test(home.text));
    check('the keyword line under it is an H2 naming public universities and the countries',
      /<h2 class="hero-sub">Study abroad at public universities in Germany, the UK, Canada and 12 more countries/.test(home.text));

    /* ------------------------------------- the sitemap index's dates */
    const idx = await get('/sitemap.xml');
    const entries = idx.text.match(/<sitemap>[\s\S]*?<\/sitemap>/g) || [];
    check('a split sitemap is an index', /<sitemapindex/.test(idx.text) && entries.length >= 3, String(entries.length));
    check('every file in the index carries a <lastmod> date', entries.length && entries.every(e => /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(e)), entries.slice(0, 2).join(' '));
    const pg1 = await get('/sitemap-pages.xml');
    check('and the files it names are served', pg1.status === 200 && /<urlset/.test(pg1.text));

    /* ---------------------------------------- the portal's language picker */
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    const su = await ctx.request.post(BASE + '/api/auth/signup', { data: { name: 'Lang Student', email: 'lang.student@mail.test', phone: '+919811100097', password: 'glovels123', terms: true } });
    check('a student signs up', su.status() === 200);
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await wait(1200);
    const opts = await page.$$eval('#glvLangSel option', o => o.map(x => x.value)).catch(() => []);
    check('the dashboard sidebar has a language picker with every language on', opts.join(',') === 'en,zh,ar,es,ru,fr,pt,bn,tr', opts.join(','));
    check('…set to English to begin with', (await page.$eval('#glvLangSel', e => e.value).catch(() => '')) === 'en');
    check('…sitting under the student’s name', await page.evaluate(() => { const w = document.querySelector('.p-side .p-who'); const l = document.querySelector('.p-side .glv-lang'); return !!(w && l && w.nextElementSibling === l); }));

    await page.selectOption('#glvLangSel', 'es');
    await page.waitForLoadState('networkidle'); await wait(1000);
    check('choosing Español opens the same screen in Spanish', /\/es\/dashboard$/.test(page.url()) && (await page.evaluate(() => document.documentElement.lang)) === 'es', page.url());
    check('the choice is remembered', (await ctx.cookies()).some(c => c.name === 'glv_lang' && c.value === 'es'));
    check('the picker now reads Español', (await page.$eval('#glvLangSel', e => e.value).catch(() => '')) === 'es');
    check('still signed in', /Lang Student/.test(await page.$eval('#whoName', e => e.textContent).catch(() => '')));
    await page.click('.p-nav a[href*="documents"]'); await page.waitForLoadState('networkidle'); await wait(800);
    check('moving to Documents stays in Spanish', /\/es\/documents/.test(page.url()) && (await page.evaluate(() => document.documentElement.lang)) === 'es', page.url());
    await page.goto(BASE + '/profile', { waitUntil: 'networkidle' }); await wait(1200);
    check('an English address opened later goes to the Spanish one', /\/es\/profile/.test(page.url()), page.url());

    await page.selectOption('#glvLangSel', 'ar');
    await page.waitForLoadState('networkidle'); await wait(1000);
    check('Arabic: right to left', /\/ar\/profile/.test(page.url()) && (await page.evaluate(() => document.documentElement.dir)) === 'rtl', page.url());

    await page.selectOption('#glvLangSel', 'en');
    await page.waitForLoadState('networkidle'); await wait(1000);
    check('back to English: the English address, and it sticks', /\/profile$/.test(page.url()) && !/\/(es|ar)\//.test(page.url())
      && (await ctx.cookies()).some(c => c.name === 'glv_lang' && c.value === 'en'), page.url());

    /* Phone width: the picker still fits. */
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
    const pp = await phone.newPage();
    await pp.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await wait(1000);
    const box = await pp.$eval('#glvLangSel', e => { const r = e.getBoundingClientRect(); return { w: r.width, r: r.right, vw: innerWidth }; }).catch(() => null);
    check('on a phone the picker is on screen and usable', box && box.w >= 80 && box.r <= box.vw + 1, JSON.stringify(box));

    /* Staff screens never get it. */
    check('no script errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    bad.push('crashed: ' + (e.stack || e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* gone */ } }
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ok   ' + x));
  bad.forEach(x => console.log('  FAIL ' + x));
  console.log('\nportallangtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
