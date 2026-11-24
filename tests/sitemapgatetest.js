/**
 * Patch 304: the sitemap offers nothing robots.txt forbids, and the log says
 * when a welcome crawler is slowed.
 *
 *   node sitemapgatetest.js        (starts its own server on 8306)
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8306, BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null && note !== '' ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const GOOGLE = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const PERSON = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const get = (p, ua) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path: p, headers: { 'User-Agent': ua || '' } }, res => {
    let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
  req.end();
});
const locs = xml => (xml.match(/<loc>[^<]+<\/loc>/g) || []).map(l => l.slice(5, -6).replace(/&amp;/g, '&'));

(async () => {
  const dir = '/tmp/db-sitemapgate-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let out = '';
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off',
      BOTGATE: 'on', BOT_PER_MIN: '20', ALLOW_INDEXING: 'true', GLOVELS_URL: BASE }) });
  child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
  try {
    for (let i = 0; i < 80; i++) { await wait(400); if ((await get('/api/health', 'x')).status === 200) break; }

    /* ---- the sitemap, every file of it */
    const first = await get('/sitemap.xml', PERSON);
    check('sitemap.xml answers', first.status === 200 && /<(urlset|sitemapindex)/.test(first.body), first.status);
    let all = [];
    if (first.body.includes('<sitemapindex')) {
      for (const f of locs(first.body)) { const r = await get(new URL(f).pathname, PERSON); check('child ' + new URL(f).pathname + ' answers', r.status === 200 && r.body.includes('<urlset'), r.status); all = all.concat(locs(r.body)); }
    } else all = locs(first.body);
    check('the sitemap lists addresses', all.length > 20, all.length);
    check('it lists the finder page', all.some(u => new URL(u).pathname === '/find-university' && !new URL(u).search));
    const withQuery = all.filter(u => u.includes('?'));
    check('no address carries a query string', withQuery.length === 0, withQuery.slice(0, 3).join(' '));

    /* ---- nothing in it is disallowed by robots.txt (the group Googlebot is in) */
    const robots = (await get('/robots.txt', PERSON)).body;
    const groups = robots.split(/\n\s*\n/);
    const mine = groups.find(g => /^User-agent:\s*Googlebot\s*$/mi.test(g)) || '';
    const rules = (mine.match(/^Disallow:\s*\S+/gmi) || []).map(l => l.replace(/^Disallow:\s*/i, ''));
    check('robots.txt has a group for Googlebot with rules', rules.length > 5, rules.length);
    const toRe = rule => new RegExp('^' + rule.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$').replace(/\$$/, '$'));
    const res = rules.map(toRe);
    const blocked = all.filter(u => { const x = new URL(u); const p = x.pathname + x.search; return res.some(re => re.test(p)); });
    check('no listed address is disallowed by robots.txt', blocked.length === 0, blocked.slice(0, 3).join(' '));

    /* ---- every listed kind of page answers 200 to Googlebot (a sample) */
    const sample = [];
    const kinds = new Map();
    all.forEach(u => { const p = new URL(u).pathname; const k = p.split('/').slice(0, 2).join('/'); if (!kinds.has(k)) kinds.set(k, p); });
    kinds.forEach(p => { if (sample.length < 15) sample.push(p); });
    let not200 = [];
    for (const p of sample) { const r = await get(p, GOOGLE); if (r.status !== 200) not200.push(p + ' ' + r.status); }
    check('a sample of listed pages answers 200 to Googlebot', not200.length === 0, not200.join(', '));
    check('…and the filtered finder still answers 403 to it', (await get('/find-university?country=DE', GOOGLE)).status === 403);

    /* ---- over the limit: 429, and the log says so */
    let n429 = 0;
    for (let i = 0; i < 40; i++) { const r = await get('/blog', GOOGLE); if (r.status === 429) n429++; }
    check('Googlebot over the limit is slowed with 429', n429 > 0, n429);
    await wait(300);
    check('the log names the slowed crawler', /crawler slowed\s+Googlebot\s+\d+ x 429/.test(out), (out.match(/crawler slowed.*/g) || []).length + ' line(s)');
    check('…at most one line a minute', (out.match(/crawler slowed\s+Googlebot/g) || []).length === 1);
    check('a person is never slowed', (await get('/blog', PERSON)).status === 200);
  } catch (e) { bad.push('test crashed — ' + (e && e.message)); }
  try { process.kill(-child.pid); } catch (e) { /* gone */ }
  bad.forEach(b => console.log('FAIL  ' + b));
  console.log((bad.length ? 'FAIL' : 'ok') + '  ' + ok.length + '/' + (ok.length + bad.length) + ' sitemap and crawler-log checks');
  process.exit(bad.length ? 1 : 0);
})();
