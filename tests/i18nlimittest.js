/* Patch 269: the day's limit PAUSES the translator; it does not flag what is
   still waiting. Lines flagged that way by the old code go back to pending. */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const MOCK = require('./i18nmock.js');
const ROOT = '/home/claude/glovels/build';
const PORT = 8262, MOCK_PORT = 8263;
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
const flaggedByService = async (admin, lang) => (await call('/api/staff/i18n/units?status=flagged&lang=' + lang + '&limit=200', { cookie: admin })).body.rows || [];
async function idle(admin, tries) {
  for (let i = 0; i < (tries || 60); i++) { await wait(1500); const s = await statusOf(admin); if (!(s.running || []).length) return s; }
  return statusOf(admin);
}
(async () => {
  const dir = '/tmp/db-i18nlimit-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const mock = MOCK.start(MOCK_PORT);
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off',
      ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_API_BASE: 'http://127.0.0.1:' + MOCK_PORT, ALLOW_INDEXING: 'true', GLOVELS_URL: 'http://localhost:' + PORT }) });
  try {
    for (let i = 0; i < 60; i++) { await wait(1000); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    /* Lines to translate: a few pages seen in Chinese and Arabic. */
    const pages = ['/', '/about-us', '/contact-us', '/study-in-germany', '/study-in-canada', '/study-in-united-kingdom', '/study-in-ireland', '/study-in-poland', '/study-in-spain', '/work-opportunity-card', '/visa-processing', '/blog', '/services', '/packages', '/glossary', '/careers', '/test-ielts-toefl-pte', '/test-gre-gmat-sat', '/migrate-canada-pr', '/migrate-australia-pr', '/work-nursing-germany', '/work-pharma-germany', '/work-medical-pg-germany', '/success-stories', '/terms', '/privacy', '/refunds', '/grievance', '/disclaimers'];
    for (const p of pages) { await call('/zh' + (p === '/' ? '/' : p)); await call('/ar' + (p === '/' ? '/' : p)); }
    let s = await statusOf(admin);
    check('the default daily limit is no longer 2,500', s.perDay >= 20000, s.perDay);
    /* The smallest limit the office can set, and only Chinese on, so the limit hits mid-way. */
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { perDay: 100, batch: 5, langs: ['zh', 'ar'] } });
    await call('/api/staff/i18n/run', { method: 'POST', cookie: admin, body: {} });
    s = await idle(admin, 120);
    check('the run stopped at the limit', /limit of 100/.test(s.lastError || ''), s.lastError);
    check('and made no more than the limit (three workers may overshoot by a batch each)', s.todayCalls <= 110, s.todayCalls);
    const zh = (s.languages || []).find(l => l.code === 'zh') || { counts: {} };
    const ar = (s.languages || []).find(l => l.code === 'ar') || { counts: {} };
    const pending = (zh.counts.pending || 0) + (ar.counts.pending || 0);
    check('what was not reached is still pending, not flagged', pending > 0, JSON.stringify({ zh: zh.counts, ar: ar.counts }));
    const fz = await flaggedByService(admin, 'zh'), fa = await flaggedByService(admin, 'ar');
    check('nothing was flagged for the limit', !fz.concat(fa).some(r => /no translation came back/.test(r.note || '')), fz.concat(fa).map(r => r.note).slice(0, 2).join(' | '));
    /* Raise the limit: the queue carries on from where it stopped. */
    await call('/api/staff/i18n', { method: 'PUT', cookie: admin, body: { perDay: 100000 } });
    await call('/api/staff/i18n/run', { method: 'POST', cookie: admin, body: {} });
    s = await idle(admin, 200);
    const zh2 = (s.languages || []).find(l => l.code === 'zh') || { counts: {} };
    check('after raising the limit the queue drains', !(zh2.counts.pending), JSON.stringify(zh2.counts));
    check('and the error clears', !s.lastError, s.lastError);
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
    mock.close();
  }
  console.log(bad.map(b => '  ✗ ' + b).join('\n'));
  console.log('i18nlimittest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
