/**
 * Patch 275: crawlers at the door, crawler hits per day, real visitors.
 *
 *   node botgatetest.js        (starts its own server on 8275)
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8275, BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null && note !== '' ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const UA = {
  claude: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  gpt: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  ahrefs: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  py: 'python-requests/2.31.0',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  oai: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  claudeuser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  wa: 'WhatsApp/2.23.20.0',
  person: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  stripe: 'Stripe/1.0 (+https://stripe.com/docs/webhooks)',
};
const get = (p, ua, o) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path: p, method: (o && o.method) || 'GET', headers: Object.assign({ 'User-Agent': ua || '' }, (o && o.headers) || {}) }, res => {
    let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
  if (o && o.body) req.write(o.body);
  req.end();
});

(async () => {
  const dir = '/tmp/db-botgate-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  /* Old one-row-per-crawler-hit rows, the way the live database holds them. */
  {
    const S = require(path.join(ROOT, 'server', 'store.js'));
    const db = S.open(dir);
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < 30; i++) db.hit({ day: y, ts: y + 'T10:00:0' + (i % 10) + 'Z', path: '/p' + (i % 7), kind: 'bot', bot: 'ClaudeBot (Anthropic)', source: 'ai' });
    for (let i = 0; i < 5; i++) db.hit({ day: y, ts: y + 'T11:00:00Z', path: '/', kind: 'page', visitor: 'v' + i, device: 'phone', source: 'direct', country: 'IN' });
    db.close();
  }
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off',
      BOTGATE: 'on', BOT_PER_MIN: '20', ALLOW_INDEXING: 'true', GLOVELS_URL: BASE, TRAFFIC_FOLD_MS: '1500' }) });
  let b;
  try {
    for (let i = 0; i < 80; i++) { await wait(400); if ((await get('/api/health', 'x')).status === 200) break; }

    /* ---- turned away */
    let r = await get('/', UA.claude);
    check('ClaudeBot (training) is turned away', r.status === 403 && r.body.length < 80, r.status);
    check('…with nothing cached', r.headers['cache-control'] === 'no-store');
    check('GPTBot (training) is turned away', (await get('/study-in-germany', UA.gpt)).status === 403);
    check('SEO tools are turned away', (await get('/blog', UA.ahrefs)).status === 403);
    check('an unnamed scraper is turned away', (await get('/find-university', UA.py)).status === 403);
    check('…and so are the pictures, for them', (await get('/assets/glovels-logo.png', UA.claude)).status === 403);
    check('every crawler may read robots.txt', (await get('/robots.txt', UA.claude)).status === 200);
    check('payment webhooks are never turned away', (await get('/api/stripe/webhook', UA.stripe, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status !== 403);

    /* ---- welcome, at a fair rate */
    r = await get('/', UA.google);
    check('Googlebot reads the home page', r.status === 200);
    check('ChatGPT search reads a page', (await get('/study-in-germany', UA.oai)).status === 200);
    check('a Claude answer reads a page', (await get('/blog', UA.claudeuser)).status === 200);
    check('a WhatsApp link preview works', (await get('/', UA.wa)).status === 200);
    check('Googlebot reads the finder itself', (await get('/find-university', UA.google)).status === 200);
    check('…but not its filtered lists', (await get('/find-university?country=DE&level=masters', UA.google)).status === 403);
    check('…in any language', (await get('/zh/find-university?country=DE', UA.google)).status === 403);
    check('a person can filter the finder', (await get('/find-university?country=DE&level=masters', UA.person)).status === 200);
    let n429 = 0, n200 = 0;
    for (let i = 0; i < 30; i++) { const x = await get('/about-us', UA.oai); if (x.status === 429) n429++; if (x.status === 200) n200++; }
    check('a welcome crawler that goes too fast is slowed (429)', n429 > 0 && n200 > 0, n200 + ' ok, ' + n429 + ' slowed');
    const slow = await get('/about-us', UA.oai);
    check('…with a Retry-After', slow.status !== 429 || slow.headers['retry-after'] === '120');
    check('people are never slowed', (await Promise.all(Array.from({ length: 30 }, () => get('/about-us', UA.person)))).every(x => x.status === 200));

    /* ---- robots.txt */
    const robots = (await get('/robots.txt', UA.google)).body;
    const groups = robots.split(/\n\s*\n/);
    const blocked = groups.find(g => /^User-agent: ClaudeBot$/m.test(g)) || '';
    const open = groups.find(g => /^User-agent: \*$/m.test(g)) || '';
    check('robots.txt: training and SEO crawlers get "Disallow: /"', /^Disallow: \/$/m.test(blocked) && /^User-agent: GPTBot$/m.test(blocked) && /^User-agent: CCBot$/m.test(blocked) && /^User-agent: AhrefsBot$/m.test(blocked));
    check('robots.txt: search and answer bots keep the public pages', /^Allow: \/$/m.test(open) && /^User-agent: Googlebot$/m.test(open) && /^User-agent: OAI-SearchBot$/m.test(open) && !/^User-agent: ClaudeBot$/m.test(open));
    check('robots.txt: no crawler through the finder\'s filters', /^Disallow: \/find-university\?$/m.test(open));

    /* ---- no cached copies */
    r = await get('/', UA.person);
    check('pages tell search engines not to keep a copy (noarchive)', /noarchive/.test(r.headers['x-robots-tag'] || ''), r.headers['x-robots-tag']);
    check('pages are still not cached', /no-store/.test(r.headers['cache-control'] || ''));

    /* ---- real visitors */
    b = await chromium.launch();
    const ctx = await b.newContext({ userAgent: UA.person, viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/study-in-germany', { waitUntil: 'networkidle' });
    await p.waitForTimeout(3500);
    const login = await get('/api/auth/login', UA.person, { method: 'POST', body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }), headers: { 'Content-Type': 'application/json' } });
    const admin = String((login.headers['set-cookie'] || [])[0] || '').split(';')[0];
    await wait(2500);   /* the fold of the old rows */
    const T = JSON.parse((await get('/api/staff/traffic?days=7', UA.person, { headers: { cookie: admin } })).body || '{}');
    const tot = T.totals || {};
    check('a browser that ran the page counts as a real visitor', tot.people >= 1, JSON.stringify({ people: tot.people, visitors: tot.visitors }));
    check('a script that only downloads pages does not', tot.visitors > tot.people, tot.visitors + ' visits, ' + tot.people + ' people');
    check('today has its real-visitor count', (T.byDay || []).slice(-1)[0].people >= 1);
    const cb = (T.bots || []).find(x => /ClaudeBot/.test(x.name));
    check('turned-away crawlers are still counted, as turned away', cb && cb.blocked >= 2, JSON.stringify(cb));
    check('the old crawler rows were folded into the day counts, not lost', cb && cb.hits >= 30 + 2, cb && cb.hits);
    check('and the pages of the old rows are kept', cb && cb.pages >= 7, cb && cb.pages);
    check('the pages the AI crawlers read most are still known', (T.aiPages || []).length >= 7, JSON.stringify((T.aiPages || []).slice(0, 3)));
    const gb = (T.bots || []).find(x => x.name === 'Googlebot');
    check('welcome crawlers are counted', gb && gb.hits >= 3, JSON.stringify(gb));
    check('the old page visits are untouched', tot.views >= 5);
    {
      const S = require(path.join(ROOT, 'server', 'store.js'));
      const db = S.open(dir);
      const left = db.hitsSince('2000-01-01', ['bot']).length;
      db.close();
      check('no crawler hit is a row of its own any more', left === 0, left + ' bot rows left');
    }

    /* ---- the Traffic screen */
    const ap = await ctx.newPage();
    await ap.goto(BASE + '/login'); await ap.fill('#lEmail', 'admin@glovels.com'); await ap.fill('#lPass', 'glovels123'); await ap.click('#submit-btn'); await ap.waitForTimeout(1500);
    await ap.goto(BASE + '/admin#traffic', { waitUntil: 'networkidle' }); await ap.waitForTimeout(1500);
    const tile = await ap.$eval('#trPeople', e => e.textContent).catch(() => '');
    check('the Traffic screen shows real visitors', /^\d/.test(tile), tile);
    const bots = await ap.$eval('#trBots', e => e.textContent).catch(() => '');
    check('…and which crawlers were turned away', /turned away/.test(bots), bots.slice(0, 120));
  } catch (e) {
    bad.push('the suite threw: ' + (e && e.stack || e));
  } finally {
    if (b) await b.close().catch(() => {});
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(t => console.log('  ok   ' + t));
  bad.forEach(t => console.log('  FAIL ' + t));
  console.log(ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
