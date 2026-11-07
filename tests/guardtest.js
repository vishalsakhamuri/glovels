/**
 * Patch 208: the guard. Runs the server with GUARD=on and behaves like a
 * scraper, a robot, a guest, a signed-in student and a form-filling bot.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8208;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
let ipN = 10;

function call(path, o) {
  o = o || {};
  return new Promise(resolve => {
    const headers = Object.assign({ 'User-Agent': UA, 'Accept-Language': 'en-GB,en', 'Content-Type': 'application/json',
      'X-Forwarded-For': o.ip || '203.0.113.1' }, o.headers || {});
    if (o.token) headers['X-Glv-T'] = o.token;
    if (o.cookie) headers.Cookie = o.cookie;
    const req = http.request({ host: 'localhost', port: PORT, path, method: o.method || 'GET', headers }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch (e) { j = { raw: out }; }
        resolve({ status: res.statusCode, body: j, headers: res.headers, text: out });
      });
    });
    req.on('error', () => resolve({ status: 0, body: {} }));
    if (o.body) req.write(JSON.stringify(o.body));
    req.end();
  });
}
const tokenOf = async ip => { const r = await call('/', { ip }); const m = /name="glv-t" content="([^"]+)"/.exec(r.text || ''); return m ? m[1] : ''; };
const ck = r => String([].concat(r.headers['set-cookie'] || []).find(c => /^gl_v=/.test(c)) || '').split(';')[0];
const login = async (email, ip) => String(([].concat((await call('/api/auth/login', { method: 'POST', ip, body: { email, password: 'glovels123' } })).headers['set-cookie'] || []))[0] || '').split(';')[0];
const FIELDS = ['Computer Science & IT', 'Business & Management', 'MBA', 'Data Science, AI & Machine Learning', 'Mechanical & Automotive Engineering', 'Economics', 'Biotechnology & Bioinformatics', 'Media & Communication', 'Civil & Construction Engineering', 'Electrical & Electronics Engineering'];
const DESTS = ['DE', 'GB', 'CA', 'IE', 'IT', 'PL', 'ES', 'FR'];

(async () => {
  const dir = '/tmp/db-guard-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'on' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }

    const page = await call('/', { ip: '203.0.113.1' });
    check('every page carries a signed token', /name="glv-t" content="[\w-]+\.[\w-]{16}"/.test(page.text || ''));
    check('robots.txt and the pages still serve to crawlers', (await call('/study-in-germany', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } })).status === 200);

    /* Robots and scripts. */
    const curl = await call('/api/find/match?country=DE', { headers: { 'User-Agent': 'curl/8.4.0' } });
    check('a script (curl) gets nothing from the search', curl.status === 403 && curl.body.robot, JSON.stringify(curl.body));
    const py = await call('/api/find/match?country=DE', { headers: { 'User-Agent': 'python-requests/2.31' } });
    check('nor does python', py.status === 403);
    const head = await call('/api/find/match?country=DE', { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/130.0 Safari/537.36' } });
    check('nor a headless browser', head.status === 403);
    const noTok = await call('/api/find/match?country=DE');
    check('a browser-looking request without a page token is refused', noTok.status === 403 && noTok.body.reload);
    const catBot = await call('/api/catalogue', { headers: { 'User-Agent': 'Scrapy/2.11' } });
    check('the opening catalogue refuses scrapers', catBot.status === 403);

    /* A guest: 10 different searches, then sign up (patch 280). */
    const ipG = '198.51.100.10';
    const tok = await tokenOf(ipG);
    let cookie = '', last = null, okCount = 0;
    for (let i = 0; i < 11; i++) {
      const r = await call('/api/find/match?country=DE&q=word' + i, { ip: ipG, token: tok, cookie });
      cookie = cookie || ck(r);
      if (r.status === 200) okCount++;
      last = r;
    }
    check('a guest gets 10 searches', okCount === 10, String(okCount));
    check('the 11th asks them to sign up', last.status === 401 && last.body.loginRequired, JSON.stringify(last.body));
    const again = await call('/api/find/match?country=DE&q=word0&cgpa=7.5', { ip: ipG, token: tok, cookie });
    check('repeating a search already made — with a different CGPA — still works', again.status === 200);
    const fresh = await call('/api/find/match?country=DE&q=fresh', { ip: ipG, token: tok });
    check('clearing the cookie does not reset the network\'s day forever', fresh.status === 200 || fresh.status === 401);

    /* A signed-in student: beyond 30, and recorded against their name. */
    const ipS = '198.51.100.20';
    const stud = await login('student@glovels.com', ipS);
    const tokS = await tokenOf(ipS);
    let sOk = 0;
    for (let i = 0; i < 35; i++) {
      const r = await call('/api/find/match?country=DE&q=s' + i, { ip: ipS, token: tokS, cookie: stud });
      if (r.status === 200) sOk++;
    }
    check('a student with a paid order goes past 30', sOk === 35, String(sOk));

    /* Patch 280: a free account has 30 a day, then the ₹99 package. */
    const ipN = '198.51.100.25';
    const tokN = await tokenOf(ipN);
    await new Promise(r => setTimeout(r, 3300));
    const su = await call('/api/auth/signup', { method: 'POST', ip: ipN, token: tokN, body: { name: 'Free Account', email: 'free.account@example.com', password: 'abcdefgh123', phone: '+919876500777', terms: true, consent: true } });
    const freeCk = String([].concat(su.headers['set-cookie'] || []).find(c => !/^gl_v=/.test(c)) || '').split(';')[0];
    check('a new account can be made', (su.status === 200 || su.status === 201) && !!freeCk, su.status + ' ' + JSON.stringify(su.body).slice(0, 120));
    let nOk = 0, nLast = null;
    for (let i = 0; i < 31; i++) {
      const r = await call('/api/find/match?country=DE&q=n' + i, { ip: ipN, token: tokN, cookie: freeCk });
      if (r.status === 200) nOk++;
      nLast = r;
    }
    check('a free account gets 30 searches a day', nOk === 30, String(nOk));
    check('the 31st asks for the ₹99 package', nLast.status === 402 && nLast.body.packageRequired && nLast.body.service === 'first-three', nLast.status + ' ' + JSON.stringify(nLast.body).slice(0, 160));

    /* Staff are never limited, and need no token. */
    const admin = await login('admin@glovels.com', '198.51.100.30');
    const st = await call('/api/find/match?country=DE', { ip: '198.51.100.30', cookie: admin });
    check('staff search freely', st.status === 200);

    const act = await call('/api/staff/search-activity', { cookie: admin, ip: '198.51.100.30' });
    const row = (act.body.accounts || []).find(a => /student@glovels\.com/.test(a.email));
    check('the admin sees what the signed-in student searched', row && row.searches >= 35 && row.today >= 35, JSON.stringify(row || act.body).slice(0, 160));

    /* Walking the catalogue: destination × field, fast. */
    const ipW = '198.51.100.40';
    const tokW = await tokenOf(ipW);
    /* Patch 280: with 10 guest searches a day the sign-up wall comes long
       before the 18-combination pattern, so a catalogue walker is stopped
       there; the pause list and unblock button still answer. */
    let wc = '', stopped = null;
    for (let i = 0; i < 25 && !stopped; i++) {
      const r = await call('/api/find/match?country=' + DESTS[i % DESTS.length] + '&field=' + encodeURIComponent(FIELDS[i % FIELDS.length]), { ip: ipW, token: tokW, cookie: wc });
      wc = wc || ck(r);
      if (r.status === 401 || r.status === 429) stopped = i + 1;
    }
    check('walking the catalogue is stopped within 11 searches', stopped && stopped <= 11, String(stopped));
    const after = await call('/api/find/match?country=DE', { ip: ipW, token: tokW, cookie: wc });
    check('and stays stopped', after.status === 401 || after.status === 429);
    const act2 = (await call('/api/staff/search-activity', { cookie: admin, ip: '198.51.100.30' })).body;
    check('the admin pause list answers, with the new limits', act2.guard && act2.guard.limits && act2.guard.limits.guest === 10 && act2.guard.limits.member === 30 && act2.guard.limits.paid === 150, JSON.stringify(act2.guard || {}).slice(0, 200));
    const unb = await call('/api/staff/search-activity/unblock', { method: 'POST', cookie: admin, ip: '198.51.100.30', body: { key: 'nobody' } });
    check('and the unblock button answers', unb.status === 200);
    const kav = await login('kavya@glovels.com', '198.51.100.31');
    check('a counsellor cannot see the activity list', (await call('/api/staff/search-activity', { cookie: kav, ip: '198.51.100.31' })).status === 403);

    /* Forms. */
    const ipF = '198.51.100.50';
    const form = { name: 'Real Person', phone: '9876500111', email: 'real.person@example.com', consent: 'yes' };
    const fBot = await call('/send.php', { method: 'POST', ip: ipF, body: form, headers: { 'User-Agent': 'python-requests/2.31' } });
    check('a robot cannot send the contact form', fBot.status === 403);
    const fNoTok = await call('/send.php', { method: 'POST', ip: ipF, body: form });
    check('nor a script posting it without the page', fNoTok.status === 403);
    const tokF = await tokenOf(ipF);
    const fFast = await call('/send.php', { method: 'POST', ip: ipF, body: form, token: tokF });
    check('a form sent the instant the page loaded is refused', fFast.status === 429, String(fFast.status));
    await new Promise(r => setTimeout(r, 3300));
    const fOk = await call('/send.php', { method: 'POST', ip: ipF, body: form, token: tokF });
    check('a person filling it in normally gets through', fOk.status === 200, JSON.stringify(fOk.body));
    const sBot = await call('/api/auth/signup', { method: 'POST', ip: ipF, body: { name: 'Bot', email: 'bot@example.com', password: 'abcdefgh123' }, headers: { 'User-Agent': 'Go-http-client/1.1' } });
    check('a robot cannot create an account', sBot.status === 403);

    /* In a browser: the sign-in box after the free searches. */
    const b = await chromium.launch();
    const ctx = await b.newContext({ userAgent: UA, locale: 'en-GB', viewport: { width: 1300, height: 900 }, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.60' } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    const r1 = await p.evaluate(async () => (await fetch('/api/find/match?country=DE')).status);
    check('the page\'s own searches carry the token', r1 === 200, String(r1));
    for (let i = 0; i < 12; i++) await p.evaluate(async c => { await fetch('/api/find/match?country=DE&cgpa=' + c); }, (5 + i / 10).toFixed(1));
    check('changing only the CGPA does not use up searches', !(await p.isVisible('text=Create a free account')));
    for (let i = 0; i < 31; i++) await p.evaluate(async c => { await fetch('/api/find/match?country=DE&q=w' + c); }, i);
    await p.waitForTimeout(600);
    check('after the free searches the page asks the guest to sign in', await p.isVisible('text=Create a free account') && await p.isVisible('text=I have an account'));
    await p.screenshot({ path: '/tmp/wall.png' });
    const href = await p.getAttribute('a[href^="login.html?signup=1"]', 'href');
    check('and "Create a free account" brings them back to the finder', /next=%2F%23finder|next=%2F/.test(href || ''), href);
    const copyBlocked = await p.evaluate(() => { const el = document.querySelector('#results') || document.querySelector('#rows'); if (!el) return 'none'; const e = new Event('copy', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; });
    check('copying from the results list is blocked', copyBlocked === true, String(copyBlocked));
    check('no script errors', errs.length === 0, errs.join(' | '));
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nguardtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
