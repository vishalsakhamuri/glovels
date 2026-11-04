/**
 * Patch 265: the website in nine languages.
 *
 * The whole path, against a stand-in for the Anthropic API (i18nmock.js):
 * a page under /zh/ is served and its lines queued; the translator
 * translates and checks them; the page comes back translated with its
 * placeholders, numbers and links intact; a post is translated whole; a
 * student's email arrives in their language; the office corrects a line;
 * and the things that must never be translated — the catalogue, the staff
 * screens — are not.
 *
 *   node tests/langtest.js            (starts its own server and mock)
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const MOCK = require('./i18nmock.js');

const ROOT = '/home/claude/glovels/build';
const PORT = 8260, MOCK_PORT = 8261;
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));

const call = (p, opts) => new Promise(resolve => {
  const o = opts || {};
  const body = o.body ? JSON.stringify(o.body) : null;
  const req = http.request({ host: 'localhost', port: PORT, path: p, method: o.method || 'GET',
    headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 Chrome/130', Accept: 'text/html,application/json' }, o.cookie ? { Cookie: o.cookie } : {}, body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, o.headers || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(out); } catch (e) { j = null; } resolve({ status: res.statusCode, text: out, body: j || {}, headers: res.headers }); });
  });
  req.on('error', () => resolve({ status: 0, text: '', body: {}, headers: {} }));
  if (body) req.write(body);
  req.end();
});
const login = async email => String(((await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } })).headers['set-cookie'] || [])[0] || '').split(';')[0];
const statusOf = async admin => (await call('/api/staff/i18n', { cookie: admin })).body;
/* Wait until nothing is pending in a language and the worker is idle. */
async function settle(admin, lang, tries) {
  for (let i = 0; i < (tries || 60); i++) {
    await wait(1500);
    const s = await statusOf(admin);
    const l = (s.languages || []).find(x => x.code === lang) || { counts: {} };
    if (!(l.counts.pending) && !(s.running || []).length) return s;
  }
  return statusOf(admin);
}

(async () => {
  const dir = '/tmp/db-lang-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const mock = MOCK.start(MOCK_PORT);
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off',
      ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_API_BASE: 'http://127.0.0.1:' + MOCK_PORT, ALLOW_INDEXING: 'true', GLOVELS_URL: BASE }) });
  let b = null;
  try {
    for (let i = 0; i < 80; i++) { await wait(400); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');

    /* ---------------------------------------------------- the addresses */
    let r = await call('/zh');
    check('/zh goes to /zh/ (the language\'s home, with the slash)', r.status === 301 && r.headers.location === '/zh/', r.status + ' ' + r.headers.location);
    r = await call('/zh/');
    check('/zh/ is the home page in Chinese', r.status === 200 && /<html[^>]* lang="zh"/.test(r.text), String(r.status));
    check('…and says so in its headers', r.headers['content-language'] === 'zh' && /glv_lang=zh/.test(String(r.headers['set-cookie'])));
    check('the first visit still reads English (nothing translated yet)', /Search\. Click\./.test(r.text));
    check('its links stay under /zh/', /href="\/zh\/find-university"/.test(r.text) && !/href="\/find-university"/.test(r.text));
    check('its canonical is the /zh/ address', r.text.indexOf('<link rel="canonical" href="' + BASE + '/zh/">') >= 0);
    check('it names every language for Google (hreflang)', /hreflang="ar" href="[^"]*\/ar\/"/.test(r.text) && /hreflang="x-default" href="[^"]*\/"/.test(r.text) && /hreflang="en"/.test(r.text));
    check('it carries the dictionary and the script for what scripts draw', /<script id="glvI18n"/.test(r.text) && /<script src="\/js\/i18n\.js" defer>/.test(r.text));
    r = await call('/');
    check('the English home page keeps its address and gets the hreflang links too', r.status === 200 && /hreflang="zh" href="[^"]*\/zh\/"/.test(r.text) && !/<script id="glvI18n"/.test(r.text));
    r = await call('/ar/study-in-germany');
    check('Arabic is right to left', /<html[^>]* lang="ar" dir="rtl"/.test(r.text));
    r = await call('/zh/admin');
    check('a staff screen takes no prefix — it goes back to the plain address', r.status === 302 && r.headers.location === '/admin', r.status + ' ' + r.headers.location);
    r = await call('/zh/api/health');
    check('nor does the API', r.status === 302 && r.headers.location === '/api/health');
    r = await call('/zh/study-in-germany/');
    check('a trailing slash under the prefix redirects under the prefix', r.status === 301 && r.headers.location === '/zh/study-in-germany', r.headers.location);
    r = await call('/zh/study-in-germany.html');
    check('and a .html spelling', r.status === 301 && r.headers.location === '/zh/study-in-germany', r.headers.location);
    r = await call('/xx');
    check('an unknown prefix is just an unknown address', r.status === 404, String(r.status));
    r = await call('/js/i18n.js');
    check('the browser script is served', r.status === 200 && /MutationObserver/.test(r.text));
    r = await call('/sitemap.xml');
    check('the sitemap lists the language pages', /<loc>[^<]*\/zh\/<\/loc>/.test(r.text) && /<loc>[^<]*\/ar\/study-in-germany<\/loc>/.test(r.text) && !/\/zh\/university\//.test(r.text));

    /* ---------------------------------------------------- the translator */
    let s = await statusOf(admin);
    check('the Languages screen sees the key and nine languages', s.ready && s.connected && s.languages.length === 9 && s.langs.length === 8, JSON.stringify([s.ready, s.connected, s.langs]));
    check('serving /zh/ queued its lines', s.units > 300 && (s.languages.find(l => l.code === 'zh').counts.pending || 0) > 0 || (s.languages.find(l => l.code === 'zh').counts.checked || 0) > 300, JSON.stringify(s.languages.find(l => l.code === 'zh').counts));
    s = await settle(admin, 'zh', 80);
    const zh = s.languages.find(l => l.code === 'zh');
    check('the translator translated and checked them all', (zh.counts.checked || 0) > 300 && !zh.counts.pending && !zh.counts.machine, JSON.stringify(zh.counts));
    check('every language got them, not just the one served', ['ar', 'es', 'ru', 'fr', 'pt', 'bn', 'tr'].every(c => (s.languages.find(l => l.code === c).counts.checked || 0) === zh.counts.checked));
    check('calls to Claude are counted', s.calls > 10 && s.tokens.in > 0, String(s.calls));
    r = await call('/zh/');
    check('the second visit reads Chinese', /\[ZH:Search\]\. \[ZH:Click\]\./.test(r.text) && !/<h1[^>]*>Search\. Click\./.test(r.text));
    check('the title and the meta description too', /<title>\[ZH:Study\]/.test(r.text) && /<meta name="description" content="\[ZH:/.test(r.text));
    check('inline tags survive inside a translated line', /<h1[^>]*><!--t-->\[ZH:Search\]\. \[ZH:Click\]\. <em>\[ZH:Fly\]\.<\/em><\/h1>/.test(r.text));
    const money = /₹[\d,]+/.exec(r.text);
    check('numbers are kept as they were', !!money && !/\{\d\}/.test(r.text.replace(/<script[\s\S]*?<\/script>/g, '')), money && money[0]);
    check('links inside translated lines keep their addresses', /<a href="\/zh\/find-university"[^>]*>\[ZH:/.test(r.text) || /href="\/zh\/find-university"/.test(r.text));
    check('the words in scripts are left alone', !/\[ZH:[^\]]*\]\s*[:=]\s*function|var \[ZH:/.test(r.text));
    const srcHome = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('the English file on disk is untouched', /Search\. Click\./.test(srcHome) && !/\[ZH:/.test(srcHome));
    r = await call('/study-in-germany');
    check('the English page is still English', /<html[^>]* lang="en/.test(r.text) && !/\[ZH:/.test(r.text));

    /* The catalogue is never translated. */
    r = await call('/api/i18n/learn', { method: 'POST', body: { page: 'home', path: '/zh/', units: [{ key: 'TU Munich', kind: 'js' }, { key: 'A line nobody wrote before', kind: 'js' }] } });
    check('a university\'s name reported by a browser is declined', r.status === 200 && r.body.added === 1 && r.body.declined.length === 1, JSON.stringify(r.body));
    r = await call('/zh/study-in-germany');
    const named = (await call('/api/staff/i18n/units?lang=zh&q=TU%20Munich', { cookie: admin })).body.rows.filter(u => u.src === 'TU Munich');
    check('a university\'s name on a page is never a line of the dictionary', r.status === 200 && /TU Munich/.test(r.text) && named.length === 0, String(named.length));

    /* Flagged and corrected lines. */
    await call('/api/i18n/learn', { method: 'POST', body: { page: 'home', path: '/zh/', units: [{ key: 'Please breakme <1>now</1> {1}', kind: 'js' }, { key: 'The reviewfix line reads well', kind: 'js' }] } });
    s = await settle(admin, 'zh', 40);
    const I18N = require(path.join(ROOT, 'server', 'i18n.js'));
    const broken = (await call('/api/staff/i18n/units?lang=zh&q=breakme', { cookie: admin })).body.rows[0];
    check('a translation that loses a placeholder is flagged, not used', broken && broken.status === 'flagged', broken && broken.status + ' ' + broken.note);
    const fixed = (await call('/api/staff/i18n/units?lang=zh&q=reviewfix', { cookie: admin })).body.rows[0];
    check('the reviewer\'s correction is what is kept', fixed && fixed.status === 'checked' && /\(reviewed\)$/.test(fixed.text) && /corrected by the reviewer/.test(fixed.note), fixed && fixed.text);
    check('the English keeps its placeholders in the key', I18N.placeholdersMatch('Please breakme <1>now</1> {1}', 'x <1>y</1> {1}') && !I18N.placeholdersMatch('Please breakme <1>now</1> {1}', 'broken'));

    /* ---------------------------------------------------- the office corrects a line */
    const hero = I18N.keyOf('Schedule a call');
    r = await call('/api/staff/i18n/unit', { method: 'PUT', cookie: admin, body: { hash: hero.hash, lang: 'zh', text: '预约通话' } });
    check('a line can be corrected on the Languages screen', r.status === 200 && r.body.unit.status === 'edited', r.status + ' ' + JSON.stringify(r.body).slice(0, 100));
    r = await call('/zh/');
    check('and the site shows the corrected line at once', r.text.indexOf('预约通话') >= 0);
    r = await call('/api/staff/i18n/unit', { method: 'PUT', cookie: admin, body: { hash: hero.hash, lang: 'zh', text: '<b>bad</b>' } });
    check('a correction with HTML of its own is refused', r.status === 422);
    r = await call('/api/staff/i18n/unit/again', { method: 'POST', cookie: admin, body: { hash: hero.hash, lang: 'zh' } });
    check('"Again" queues a fresh translation', r.status === 200 && r.body.queued === 1);
    await settle(admin, 'zh', 30);
    r = await call('/zh/');
    check('…which replaces the edited one', /\[ZH:Schedule\] \[ZH:a\] \[ZH:call\]/.test(r.text) && r.text.indexOf('预约通话') < 0);
    const list = (await call('/api/staff/i18n/units?lang=zh&status=checked&per=5', { cookie: admin })).body;
    check('the lines list pages', list.total > 300 && list.rows.length === 5 && list.rows[0].src && list.rows[0].text);
    r = await call('/api/staff/i18n/units?lang=zh', {});
    check('the lines are staff-only', r.status === 401);

    /* ---------------------------------------------------- a post, translated whole */
    const posts = (await call('/api/staff/posts?per=50', { cookie: admin })).body;
    const draft = (posts.rows || posts.posts || []).find(p => p.status === 'draft' && (p.words > 50 || String(p.body || '').length > 300)) || (posts.rows || posts.posts || [])[0];
    let postSlug = '';
    if (draft) {
      const full = (await call('/api/staff/post/' + draft.id, { cookie: admin })).body.post || draft;
      const body = (full.body && full.body.length > 300) ? full.body : '## What changed\n\nThe blocked account rises to €11,904 for 2026.\n\n### What to do now\n\n1. Open the account early.\n2. Read [the official page](https://www.make-it-in-germany.com/en/).\n\n## Sources\n- [Make it in Germany](https://www.make-it-in-germany.com/en/)\n';
      r = await call('/api/staff/post/' + draft.id, { method: 'PUT', cookie: admin, body: Object.assign({}, full, { body, status: 'published', title: full.title || 'A post for the languages test' }) });
      postSlug = (r.body.post || {}).slug || full.slug;
      check('a draft is published for the test', r.status === 200 && postSlug, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    } else check('a draft is published for the test', false, 'no draft found');
    if (postSlug) {
      let done = false;
      for (let i = 0; i < 60 && !done; i++) { await wait(1500); const ps = (await call('/api/staff/i18n/posts', { cookie: admin })).body; const mine = (ps.posts || []).find(p => p.slug === postSlug); done = !!(mine && mine.status.zh === 'checked'); }
      check('the post is translated whole and checked in Chinese', done);
      r = await call('/zh/post/' + postSlug);
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(r.text);
      check('…and served under /zh/post/, its heading translated whole', r.status === 200 && h1 && /^<!--i18n:off-->\[ZH:/.test(h1[1]) && /<em>\[ZH:/.test(h1[1]), h1 && h1[1].slice(0, 80));
      const article = h => (/<div class="wrap prose"[\s\S]*?<\/section>/.exec(h) || [''])[0];
      const linksOf = h => (article(h).match(/href="https?:\/\/[^"]+"/g) || []).sort().join(' ');
      const enPost = await call('/post/' + postSlug);
      check('with the links of the English post intact', linksOf(r.text) === linksOf(enPost.text), linksOf(r.text).slice(0, 100));
      check('and its paragraphs translated', /<p>\[ZH:/.test(article(r.text)) && !/<p>[A-Z][a-z]+ [a-z]+ [a-z]+/.test(article(r.text)));
      check('the title is the translated one, not a line-by-line one', /<title>\[ZH:/.test(r.text) && /<meta name="description" content="\[ZH:/.test(r.text));
      r = await call('/zh/blog');
      check('the blog index shows the translated title', new RegExp('href="post/' + postSlug + '"[\\s\\S]{0,400}<h3><!--i18n:off-->\\[ZH:').test(r.text));
      r = await call('/post/' + postSlug);
      check('the English post is untouched', !/\[ZH:/.test(r.text));
      const t = (await call('/api/staff/i18n/post/' + draft.id + '/zh', { cookie: admin })).body;
      r = await call('/api/staff/i18n/post/' + draft.id + '/zh', { method: 'PUT', cookie: admin, body: Object.assign({}, t.translation, { title: '我的标题' }) });
      check('the office can correct a translated post', r.status === 200);
      r = await call('/zh/post/' + postSlug);
      check('…and the site shows the corrected title', r.text.indexOf('我的标题') >= 0);
      const ps = (await call('/api/staff/i18n/posts', { cookie: admin })).body;
      check('the posts list says so', (ps.posts.find(p => p.slug === postSlug) || { status: {} }).status.zh === 'edited');
    }

    /* ---------------------------------------------------- a student's email */
    const stu = await login('student@glovels.com');
    r = await call('/api/auth/me', { cookie: stu + '; glv_lang=zh' });
    check('a student who reads the site in Chinese is remembered as such', r.body.user && r.body.user.lang === 'zh', JSON.stringify(r.body.user && r.body.user.lang));
    /* The first email teaches the dictionary its lines; the second arrives translated. */
    r = await call('/api/auth/forgot', { method: 'POST', body: { email: 'student@glovels.com' } });
    await settle(admin, 'zh', 40);
    const before = fs.readdirSync(path.join(dir, 'outbox')).filter(f => f.endsWith('.eml')).length;
    r = await call('/api/auth/forgot', { method: 'POST', body: { email: 'student@glovels.com' } });
    await wait(1500);
    const files = fs.readdirSync(path.join(dir, 'outbox')).filter(f => f.endsWith('.eml')).sort();
    const eml = files.length > before ? fs.readFileSync(path.join(dir, 'outbox', files[files.length - 1]), 'utf8') : '';
    const decoded = eml.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    check('the email a student gets is in their language', /\[ZH:/.test(decoded) || /=5BZH/.test(eml) || /W1pI/.test(eml), files.length + ' files, ' + (decoded.match(/Subject:.*$/m) || [''])[0].slice(0, 80));
    check('…with the reset link intact', /\/login\?token=|reset|token=/.test(decoded));

    /* ---------------------------------------------------- in the browser */
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    const learned = []; p.on('request', q => { if (q.url().includes('/api/i18n/learn')) learned.push(q.postData()); });
    await p.goto(BASE + '/zh/', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
    check('the Chinese home page runs without a script error', errs.length === 0, errs.join(' | ').slice(0, 200));
    check('the header picker shows the language', /中文/.test(await p.textContent('header.site .glv-loc-btn')), await p.textContent('header.site .glv-loc-btn'));
    check('the browser reports the lines scripts drew', learned.length >= 1 && /"units":\[/.test(learned[0]));
    check('the dictionary script is on the page', await p.evaluate(() => !!window.glvHref && window.glvLang === 'zh'));
    check('a script\'s own address is kept in the language', await p.evaluate(() => window.glvHref('/dashboard') === '/zh/dashboard' && window.glvHref('/api/x') === '/api/x' && window.glvHref('/') === '/zh/' && window.glvHref('/admin') === '/admin'));
    await settle(admin, 'zh', 40);
    const ctx2 = await b.newContext({ viewport: { width: 1300, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/zh/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(3000);
    const heading = await p2.textContent('#rTitle').catch(() => '');
    check('what a script draws is translated by the next visit', /\[ZH:/.test(heading), heading);
    const probe = await p2.evaluate(() => { const d = document.createElement('p'); d.textContent = 'Popular private universities'; document.body.appendChild(d); return new Promise(r => setTimeout(() => r(d.textContent), 400)); });
    check('…and so is a line a script draws later', /\[ZH:Popular\]/.test(probe), probe);
    const uni = await p2.evaluate(() => { const d = document.createElement('p'); d.setAttribute('translate', 'no'); d.textContent = 'Find my university'; document.body.appendChild(d); return new Promise(r => setTimeout(() => r(d.textContent), 400)); });
    check('translate="no" is honoured by the script', uni === 'Find my university');
    /* The picker: choosing English goes to the English address and is remembered. */
    await p2.click('header.site .glv-loc-btn'); await p2.waitForTimeout(300);
    await p2.fill('#glvLocLQ', 'engl'); await p2.press('#glvLocLQ', 'Enter'); await p2.waitForTimeout(200);
    await p2.click('.glv-loc-pop .go'); await p2.waitForTimeout(2500);
    check('choosing English in the picker opens the English page', /^\/(\?.*)?$/.test(new URL(p2.url()).pathname + ''), p2.url());
    check('…and remembers it', /glv_lang=en/.test(await p2.evaluate(() => document.cookie)));
    /* A visitor who read Chinese and opens an English address is sent to Chinese. */
    const ctx3 = await b.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx3.addCookies([{ name: 'glv_lang', value: 'zh', url: BASE }]);
    const p3 = await ctx3.newPage();
    await p3.goto(BASE + '/study-in-germany', { waitUntil: 'networkidle' }); await p3.waitForTimeout(1500);
    check('a visitor who chose Chinese is kept in Chinese', new URL(p3.url()).pathname === '/zh/study-in-germany', p3.url());
    await p3.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' }); await p3.waitForTimeout(1200);
    check('…but never on a staff screen', new URL(p3.url()).pathname === '/admin' || /login/.test(p3.url()), p3.url());
    /* Arabic, in the browser: readable, no sideways scroll. */
    const p4 = await ctx.newPage();
    await p4.goto(BASE + '/ar/study-in-germany', { waitUntil: 'networkidle' }); await p4.waitForTimeout(1500);
    const rtl = await p4.evaluate(() => ({ dir: document.documentElement.dir, w: document.documentElement.scrollWidth, main: !!document.elementFromPoint(640, 450) }));
    check('the Arabic page is right to left and does not scroll sideways', rtl.dir === 'rtl' && rtl.w <= 1300 && rtl.main, JSON.stringify(rtl));
    /* The Languages screen. */
    const pa = await ctx.newPage();
    await pa.goto(BASE + '/login'); await pa.fill('#lEmail', 'admin@glovels.com'); await pa.fill('#lPass', 'glovels123'); await pa.click('#submit-btn'); await pa.waitForTimeout(2000);
    const aerrs = []; pa.on('pageerror', e => aerrs.push(String(e)));
    await pa.goto(BASE + '/languages', { waitUntil: 'networkidle' }); await pa.waitForTimeout(2500);
    check('the Languages screen opens for an administrator', aerrs.length === 0 && /English lines known/.test(await pa.textContent('#kpis')), aerrs.join(' '));
    check('…with every language and its progress', (await pa.$$('#langs .lang')).length === 8 && /of \d+ lines/.test(await pa.textContent('#langs')));
    check('…and the lines, with their translations', (await pa.$$('#lines tbody tr')).length > 10 && /\[ZH:/.test(await pa.textContent('#lines')));
    await pa.fill('#fQ', 'Schedule a call'); await pa.click('#fGo'); await pa.waitForTimeout(800);
    const first = await pa.$('#lines tbody tr');
    check('search finds a line', !!first && /Schedule a call/.test(await first.textContent()));
    if (first) {
      await first.$eval('textarea', t => { t.value = '预约电话'; });
      await (await first.$('[data-act="save"]')).click(); await pa.waitForTimeout(800);
      r = await call('/zh/');
      check('a line saved on the screen is on the site', r.text.indexOf('预约电话') >= 0);
    }
    await pa.click('.tabs button[data-tab="posts"]'); await pa.waitForTimeout(1200);
    check('the posts tab lists the live posts with a state per language', (await pa.$$('#posts tbody tr')).length >= 1 && /Edited|Checked/.test(await pa.textContent('#posts')));
    await pa.screenshot({ path: '/tmp/languages-screen.png', fullPage: true });
    /* A language switched off. */
    r = await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { langs: ['zh', 'ar', 'es', 'ru', 'fr', 'pt', 'bn'] } });
    check('a language can be switched off', r.status === 200 && r.body.langs.length === 7);
    r = await call('/tr/');
    check('its addresses go to English', r.status === 302 && r.headers.location === '/', r.status + ' ' + r.headers.location);
    r = await call('/zh/');
    check('and the hreflang links drop it', !/hreflang="tr"/.test(r.text) && /hreflang="bn"/.test(r.text));
    r = await call('/api/pay/config');
    check('the picker drops it too', (r.body.languages || []).map(l => l.code).join() === 'en,zh,ar,es,ru,fr,pt,bn');
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { langs: ['zh', 'ar', 'es', 'ru', 'fr', 'pt', 'bn', 'tr'] } });
    /* Staff screens stay English. */
    r = await call('/counsellor', { cookie: admin });
    check('a staff screen never carries the dictionary', r.status === 200 && !/<script id="glvI18n"/.test(r.text) && !/hreflang=/.test(r.text));
    /* Pause. */
    r = await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { on: false } });
    check('the translator can be paused', r.status === 200 && r.body.on === false);
    r = await call('/zh/');
    check('a paused translator still serves what it has', /\[ZH:Search\]/.test(r.text));
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { on: true } });
  } catch (e) {
    bad.push('the suite threw: ' + (e && e.stack || e));
  } finally {
    if (b) await b.close().catch(() => {});
    try { process.kill(-child.pid); } catch (e) {}
    mock.close();
  }
  ok.forEach(t => console.log('  ok   ' + t));
  bad.forEach(t => console.log('  FAIL ' + t));
  console.log(ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
