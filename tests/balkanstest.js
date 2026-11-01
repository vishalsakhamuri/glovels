/**
 * Patch 213: the Western Balkans hub and one page per country.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8213;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const get = path => new Promise(resolve => {
  http.get({ host: 'localhost', port: PORT, path, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130', 'Accept-Language': 'en' } }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, text: out }));
  }).on('error', () => resolve({ status: 0, text: '' }));
});
const SLUGS = ['albania', 'serbia', 'bosnia-and-herzegovina', 'north-macedonia', 'montenegro', 'kosovo'];

(async () => {
  const dir = '/tmp/db-balkans-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', ALLOW_INDEXING: 'true' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await get('/api/health')).status === 200) break; }

    const hub = await get('/western-balkans');
    check('the hub answers', hub.status === 200, String(hub.status));
    check('the hub links every country', SLUGS.every(s => hub.text.includes('study-in-germany-from-' + s + '.html')));
    for (const s of SLUGS) {
      const p = await get('/study-in-germany-from-' + s);
      check(s + ' answers', p.status === 200, String(p.status));
      const ld = (p.text.match(/<script type="application\/ld\+json">(\{"@context": "https:\/\/schema.org", "@type": "FAQPage".*?)<\/script>/s) || [])[1];
      let faq = null; try { faq = JSON.parse(ld); } catch (e) { /* bad */ }
      check(s + ' has its own FAQ data', !!faq && faq.mainEntity.length === 5 && !/APS/.test(ld));
      check(s + ' says €11,904 and links its sources', p.text.includes('€11,904') && p.text.includes('arbeitsagentur.de'));
      check(s + ' offers the free call and the finder', p.text.includes('index.html#book') && p.text.includes('/find-university?country=Germany'));
      check(s + ' has a canonical-ish og:url', p.text.includes('og:url" content="https://www.glovels.com/study-in-germany-from-' + s + '"'));
    }
    const de = await get('/study-in-germany');
    check('the Germany page points to the guide', de.text.includes('western-balkans.html'));
    const sm = await get('/sitemap.xml');
    const smAll = sm.text + (sm.text.includes('<sitemapindex') ? (await get('/sitemap-1.xml')).text + (await get('/sitemap-pages.xml')).text : '');
    check('the sitemap lists the hub and the pages', /western-balkans/.test(smAll) && /study-in-germany-from-kosovo/.test(smAll), sm.text.slice(0, 160));

    const b = await chromium.launch();
    const errs = [];
    for (const vp of [{ width: 1280, height: 900, n: 'd' }, { width: 390, height: 844, n: 'm' }]) {
      const pg = await b.newPage({ viewport: { width: vp.width, height: vp.height } });
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto('http://localhost:' + PORT + '/study-in-germany-from-albania', { waitUntil: 'networkidle' });
      const ov = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check('albania page fits at ' + vp.width, !ov);
      await pg.screenshot({ path: '/tmp/balkans-' + vp.n + '.png', fullPage: false });
      await pg.goto('http://localhost:' + PORT + '/western-balkans', { waitUntil: 'networkidle' });
      await pg.screenshot({ path: '/tmp/balkans-hub-' + vp.n + '.png', fullPage: true });
      await pg.close();
    }
    check('no script errors', errs.length === 0, errs.join(' | '));
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nbalkanstest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
