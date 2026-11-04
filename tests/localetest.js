/**
 * Patch 207: country / currency / language in the header, and a 30-row cap
 * on what the home page's searches bring.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8207;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const call = (path, cookie) => new Promise(resolve => {
  http.get({ host: 'localhost', port: PORT, path, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 Chrome/130' }, cookie ? { Cookie: cookie } : {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => { let j = {}; try { j = JSON.parse(out); } catch (e) { j = { raw: out }; } resolve({ status: res.statusCode, body: j, size: out.length, headers: res.headers }); });
  }).on('error', () => resolve({ status: 0, body: {} }));
});
const login = email => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
    res.resume(); resolve(String((res.headers['set-cookie'] || [])[0] || '').split(';')[0]);
  });
  req.end(JSON.stringify({ email, password: 'glovels123' }));
});

(async () => {
  const dir = '/tmp/db-locale-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }

    /* The cap. The demo catalogue is small, so the cap is checked at 10 (its floor). */
    const full = (await call('/api/find/match')).body;
    const cut = (await call('/api/find/match?limit=10')).body;
    check('a search with no limit is unchanged', full.named.length > 10, String(full.named.length));
    check('a visitor\'s search with limit=10 brings 10', cut.named.length === 10 && cut.moreNamed === true, String(cut.named.length));
    const spread = new Set(cut.named.map(p => p.uKey || p.university)).size;
    check('taken across universities in turn', spread >= Math.min(5, new Set(full.named.map(p => p.uKey || p.university)).size), String(spread));
    const cat = (await call('/api/catalogue')).body, catCut = (await call('/api/catalogue?limit=10')).body;
    const namedOf = d => (d.programmes || []).filter(p => p.university).length;
    check('the opening list honours the limit too', namedOf(catCut) <= 10 && namedOf(catCut) < namedOf(cat), namedOf(catCut) + ' of ' + namedOf(cat));
    const admin = await login('admin@glovels.com');
    const staff = (await call('/api/find/match?limit=10', admin)).body;
    check('staff are never capped', staff.named.length >= full.named.length, String(staff.named.length));
    const pay = (await call('/api/pay/config')).body;
    check('every country is offered', (pay.countries || []).length >= 240, String((pay.countries || []).length));
    check('each with its currency', pay.currencyOf.IN === 'INR' && pay.currencyOf.DE === 'EUR' && pay.currencyOf.AL === 'ALL' && pay.currencyOf.RS === 'RSD' && pay.currencyOf.NG === 'NGN');
    check('and a country whose currency we cannot take pays in US dollars', pay.currencyOf.AR === 'USD' || pay.currencyOf.VE === 'USD');
    /* patch 265: English first, and the eight languages the office switched on. */
    check('English is the first language, with eight more', (pay.languages || []).map(l => l.code).join() === 'en,zh,ar,es,ru,fr,pt,bn,tr', (pay.languages || []).map(l => l.code).join());

    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    const asked = [];
    p.on('request', r => { if (/\/api\/(catalogue|find\/match)/.test(r.url())) asked.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
    await p.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    check('the home page asks for 30 at a time', asked.length > 0 && asked.every(u => /limit=30/.test(u)), asked.join(' '));
    check('the header shows the country and currency control', await p.isVisible('header.site .glv-locale .glv-loc-btn'));
    await p.click('.glv-loc-btn'); await p.waitForTimeout(200);
    check('it opens with country, currency and language, each searchable', await p.isVisible('#glvLocCQ') && await p.isVisible('#glvLocCurQ') && await p.isVisible('#glvLocLQ'));
    check('the country list is complete', (await p.$$('#glvLocCL button')).length >= 240);
    await p.fill('#glvLocCQ', 'ital');
    const vis = await p.$$eval('#glvLocCL button:not([hidden])', bs => bs.map(b => b.textContent.trim()));
    check('typing "ital" finds Italy', vis.length >= 1 && vis.length <= 3 && vis.some(t => /Italy/.test(t)), vis.join(', '));
    await p.fill('#glvLocCQ', 'zzzz');
    check('a search with no match says so', await p.isVisible('#glvLocCL .glv-pick-none'));
    await p.fill('#glvLocCQ', 'albania'); await p.press('#glvLocCQ', 'Enter');
    check('choosing Albania picks the lek', (await p.getAttribute('.glv-pick[data-id="glvLocCur"]', 'data-value')) === 'ALL');
    await p.screenshot({ path: '/tmp/locale.png', clip: { x: 600, y: 0, width: 700, height: 620 } });
    await p.fill('#glvLocCurQ', 'swiss'); 
    check('currency search finds the franc by name', (await p.$$eval('#glvLocCurL button:not([hidden])', bs => bs.map(b => b.getAttribute('data-v')))).includes('CHF'));
    await p.fill('#glvLocCQ', 'germany'); await p.click('#glvLocCL button:not([hidden])');
    check('choosing Germany picks the euro', (await p.getAttribute('.glv-pick[data-id="glvLocCur"]', 'data-value')) === 'EUR');
    await p.click('.glv-loc-pop .go'); await p.waitForTimeout(500);
    check('saving shows the flag and EUR', /EUR/.test(await p.textContent('.glv-loc-btn')) && /🇩🇪/.test(await p.textContent('.glv-loc-btn')));
    const pkg = await p.evaluate(() => [].map.call(document.querySelectorAll('#packages .pkg, #packages [class*="price"]'), e => e.textContent).join(' '));
    check('package prices now read in euros', /€\s?\d|\d\s?€|EUR\s?\d/.test(pkg), pkg.replace(/\s+/g, ' ').slice(0, 160));
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(600);
    check('the choice is remembered', /EUR/.test(await p.textContent('.glv-loc-btn')));
    const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await m.goto('http://localhost:' + PORT + '/study-in-germany', { waitUntil: 'networkidle' }); await m.waitForTimeout(600);
    await m.click('#burger'); await m.waitForTimeout(400);
    check('on a phone, and on inner pages, it is in the menu', await m.isVisible('#mm .glv-loc-btn'));
    await m.click('#mm .glv-loc-btn'); await m.waitForTimeout(200);
    check('and opens there', await m.isVisible('#mm #glvLocCQ'));
    await m.screenshot({ path: '/tmp/locale-mm.png' });
    await m.click('#mmClose').catch(() => {}); await m.waitForTimeout(300);
    const ov = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('and the phone header does not overflow', !ov);
    await m.screenshot({ path: '/tmp/locale-m.png', clip: { x: 0, y: 0, width: 390, height: 120 } });
    check('no script errors', errs.length === 0, errs.join(' | '));
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nlocaletest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
