/**
 * Patch 198: the command centre — /api/staff/command and /ops.
 *
 * Boots its own server on a fresh database (the demo student, Kavya and the
 * admin), makes a student message wait, and checks: every queue is there with
 * its SLA; the waiting message lands in "Students waiting for a reply" under
 * Kavya; the admin sees the whole team, a counsellor only themself, a student
 * nothing; and the page draws from the real API with no script errors.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8198;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts && opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const login = async (email) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};

(async () => {
  const dir = '/tmp/db-command-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }

    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const student = await login('student@glovels.com');

    /* A student writes; nobody has answered yet. */
    const sent = await call('/api/messages', { method: 'POST', headers: { Cookie: student },
      body: { body: 'Hello — can you check my SOP before Friday?' } });
    check('the student\'s message is sent', sent.status === 200 || sent.status === 201, String(sent.status));

    const a = await call('/api/staff/command', { headers: { Cookie: admin } });
    const keys = ((a.body && a.body.queues) || []).map(q => q.key);
    check('the admin gets the board', a.status === 200, String(a.status));
    check('every queue is there', ['counsellor', 'welcome', 'messages', 'leads', 'docs', 'profile', 'shortlist', 'writing',
      'private', 'public', 'decisions', 'visa', 'departure', 'services'].every(k => keys.includes(k)), keys.join(','));
    check('each queue says its SLA and counts', a.body.queues.every(q => q.sla && typeof q.total === 'number'
      && typeof q.late === 'number' && Array.isArray(q.rows)));
    const msgs = a.body.queues.find(q => q.key === 'messages');
    check('the waiting message is in "Students waiting for a reply"', msgs && msgs.total >= 1
      && msgs.rows.some(r => /SOP/.test(r.what)), JSON.stringify(msgs && msgs.rows[0]));
    check('with its 24 h clock, not late yet', msgs && msgs.rows[0].slaHours === 24 && msgs.rows[0].state !== 'late');
    check('owned by the student\'s counsellor', msgs && msgs.rows[0].counsellor && /Kavya/.test(msgs.rows[0].counsellor.name));
    const kv = (a.body.counsellors || []).find(c => /Kavya/.test(c.name));
    check('Kavya is on the team board with a reply owed', kv && kv.waitingMessages >= 1 && ['behind', 'watch', 'good'].includes(kv.health),
      JSON.stringify(kv));
    check('the journey has every stage', (a.body.journey || []).length >= 8, String((a.body.journey || []).length));
    check('the headline adds up', a.body.headline.open === a.body.queues.reduce((n, q) => n + q.total, 0));

    const k = await call('/api/staff/command', { headers: { Cookie: kavya } });
    check('a counsellor gets their own board', k.status === 200 && k.body.admin === false);
    check('and sees only themself on it', (k.body.counsellors || []).length === 1 && /Kavya/.test(k.body.counsellors[0].name),
      JSON.stringify((k.body.counsellors || []).map(c => c.name)));
    const s = await call('/api/staff/command', { headers: { Cookie: student } });
    check('a student is refused', s.status === 401 || s.status === 403, String(s.status));
    const anon = await call('/api/staff/command');
    check('nobody signed in is refused', anon.status === 401 || anon.status === 403, String(anon.status));

    /* The page, from the real API. */
    const b = await chromium.launch();
    const ctx = await b.newContext();
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1500);
    check('/ops draws with no script errors', errs.length === 0, errs.join(' | '));
    check('it greets the admin by name', /Good (morning|afternoon|evening), \w+/.test(await p.textContent('#hello')));
    check('fourteen queue cards', (await p.$$('[data-q]')).length === 14);
    await p.click('[data-q="messages"]'); await p.waitForTimeout(500);
    check('a queue opens with the student in it', /SOP/.test(await p.textContent('#dList')));
    check('with a way into the file', !!(await p.$('#dList a[href^="counsellor.html?student="]')));
    /* Out of search: not crawlable here (the whole dev site is), and named
       among the private pages the live robots.txt lists. */
    const robots = await call('/robots.txt');
    check('/ops is kept out of search', /Disallow: \/(ops)?\s*$/m.test(robots.body.raw || '')
      && /'Disallow: \/ops'/.test(fs.readFileSync(ROOT + '/serve.js', 'utf8')));
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.message);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\ncommandtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
