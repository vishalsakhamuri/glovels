/* Patch 270: two languages at a time, each live on the site only once it is
   complete; visitors never see a half-translated language; the office
   previews it; refused calls do not count. */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const MOCK = require('./i18nmock.js');
const ROOT = '/home/claude/glovels/build';
const PORT = 8264, MOCK_PORT = 8265;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const call = (p, opts) => new Promise(resolve => {
  const o = opts || {};
  const body = o.body ? JSON.stringify(o.body) : null;
  const req = http.request({ host: 'localhost', port: PORT, path: p, method: o.method || 'GET',
    headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 Chrome/130', Accept: 'text/html,application/json' }, o.cookie ? { Cookie: o.cookie } : {}, body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(out); } catch (e) { j = null; } resolve({ status: res.statusCode, text: out, body: j || {}, headers: res.headers }); });
  });
  req.on('error', () => resolve({ status: 0, text: '', body: {}, headers: {} }));
  if (body) req.write(body);
  req.end();
});
const login = async email => String(((await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } })).headers['set-cookie'] || [])[0] || '').split(';')[0];
const statusOf = async admin => (await call('/api/staff/i18n', { cookie: admin })).body;
const langOf = (s, c) => (s.languages || []).find(l => l.code === c) || {};
(async () => {
  const dir = '/tmp/db-i18nlive-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const mock = MOCK.start(MOCK_PORT);
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off',
      ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_API_BASE: 'http://127.0.0.1:' + MOCK_PORT, ALLOW_INDEXING: 'true', GLOVELS_URL: 'http://localhost:' + PORT }) });
  try {
    for (let i = 0; i < 60; i++) { await wait(1000); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { on: false, langs: ['zh', 'ar', 'es'] } });
    let s = await statusOf(admin);
    check('two at a time by default', s.focus === 2, s.focus);
    check('nothing is live before it is translated', (s.live || []).length === 0, JSON.stringify(s.live));
    const anon = await call('/zh/');
    check('a visitor asking for Chinese gets English (302)', anon.status === 302 && !/^\/zh/.test(anon.headers.location || ''), anon.status + ' ' + anon.headers.location);
    const cfg = await call('/api/pay/config');
    check('the header picker offers English only', (cfg.body.languages || []).map(l => l.code).join(',') === 'en', JSON.stringify(cfg.body.languages));
    const prev = await call('/zh/', { cookie: admin });
    check('the office previews Chinese', prev.status === 200 && /lang="zh"/.test(prev.text), prev.status);
    check('the preview is not indexed', /noindex/i.test(String(prev.headers['x-robots-tag'] || '')), prev.headers['x-robots-tag']);
    check('the preview does not set the reader\'s language', !/glv_lang=/.test(String(prev.headers['set-cookie'] || '')));
    for (const p of ['/zh/about-us', '/zh/contact-us', '/zh/study-in-germany']) await call(p, { cookie: admin });
    s = await statusOf(admin);
    check('the two being translated are the first two in the order', JSON.stringify(s.translating) === '["zh","ar"]', JSON.stringify(s.translating));
    check('Spanish waits its turn', langOf(s, 'es').state === 'queued', langOf(s, 'es').state);
    check('lines were queued for every language from one preview', (langOf(s, 'es').counts.pending || 0) > 0, JSON.stringify(langOf(s, 'es').counts));
    /* "Do next" moves Spanish to the front. */
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { next: 'es' } });
    s = await statusOf(admin);
    check('"Do next" puts a language first', s.order[0] === 'es' && JSON.stringify(s.translating) === '["es","zh"]', JSON.stringify(s.order) + ' ' + JSON.stringify(s.translating));
    /* Run: the blog is off so completeness is the lines alone. */
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { on: true, blog: false } });
    for (let i = 0; i < 120; i++) { await wait(1500); s = await statusOf(admin); if ((s.live || []).length >= 3) break; }
    check('every language went live by itself once complete', ['es', 'zh', 'ar'].every(c => (s.live || []).includes(c)), JSON.stringify(s.live));
    check('Spanish went live first', s.live[0] === 'es', JSON.stringify(s.live));
    const anon2 = await call('/zh/');
    check('a visitor now gets Chinese', anon2.status === 200 && /lang="zh"/.test(anon2.text), anon2.status);
    const cfg2 = await call('/api/pay/config');
    check('and the picker offers it', (cfg2.body.languages || []).some(l => l.code === 'zh'));
    /* Take one off by hand. */
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { live: { lang: 'ar', on: false } } });
    const anon3 = await call('/ar/');
    check('a language taken off the site sends visitors to English', anon3.status === 302, anon3.status);
    s = await statusOf(admin);
    check('and its state says so (not live, nothing to do)', !(s.live || []).includes('ar') && ['person', 'queued', 'translating'].includes(langOf(s, 'ar').state), langOf(s, 'ar').state);
    await call('/api/staff/i18n/run', { method: 'POST', cookie: admin, body: {} });
    await wait(4000);
    check('a language taken off by hand is not put back by the translator', (await call('/ar/')).status === 302);
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { live: { lang: 'ar', on: true } } });
    check('and back on', (await call('/ar/')).status === 200);
    check('the daily limit is the ceiling', s.perDay >= 100000, s.perDay);
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
    mock.close();
  }
  console.log(bad.map(b => '  ✗ ' + b).join('\n'));
  console.log('i18nlivetest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
