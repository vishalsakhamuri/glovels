/**
 * Patch 298: the Students tab on the Command centre.
 *
 * Owner, 24 Nov: "we should also have a students tab where we can see each
 * student's status and the latest comment from the counsellor ... analysis and
 * tracking in all directions: the counsellor's point of view, the student's
 * point of view, work progressing, tasks completed."
 *
 * Boots its own server and checks: every open file is one row with its stage,
 * whose move it is, steps done, applications applied, counsellor and when it
 * last moved; the latest thing the counsellor wrote is on the row (a message
 * to the student, then a newer office note); a counsellor sees only her own;
 * and the tab, its filters, search and the way into the file work on screen.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8299;
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
  const dir = '/tmp/db-stuboard-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const student = await login('student@glovels.com');
    const H = { Cookie: admin }, K = { Cookie: kavya };
    const get = async h => (await call('/api/staff/students/board', { headers: h || H })).body;
    check('nobody signed in is refused', [401, 403].includes((await call('/api/staff/students/board')).status));
    check('a student is refused', [401, 403].includes((await call('/api/staff/students/board', { headers: { Cookie: student } })).status));
    const b0 = await get();
    const cmd = (await call('/api/staff/command', { headers: H })).body;
    check('every open file is on the list', b0.total === b0.students.length && b0.total === cmd.headline.students && b0.total > 0, b0.total + ' vs ' + cmd.headline.students);
    const r0 = b0.students.find(r => r.id === 3) || b0.students[0];
    const file = (await call('/api/staff/student/' + r0.id, { headers: H })).body;
    check('a row says the stage the file itself says', !!r0.stage && r0.stage === file.standing.stage, r0.stage + ' vs ' + (file.standing || {}).stage);
    check('and whose move it is, in words', !!r0.pendingWith && r0.pendingWhat === file.standing.pending.what, r0.pendingLabel + ': ' + r0.pendingWhat);
    check('steps done of the steps owed', r0.steps.total > 0 && r0.steps.done <= r0.steps.total, JSON.stringify(r0.steps));
    const A = (cmd.applications || {})[r0.id];
    check('applications applied of those shortlisted, as the Command centre counts them', !!A && r0.apps.applied === A.applied && r0.apps.listed === A.listed, JSON.stringify(r0.apps));
    check('the counsellor, destination and intake', r0.counsellor && /Kavya/.test(r0.counsellor.name) && !!r0.destination, JSON.stringify([r0.counsellor, r0.destination, r0.intake]));
    const m = await call('/api/staff/student/' + r0.id + '/message', { method: 'POST', headers: K, body: { body: 'Please upload your semester marksheets by Friday.' } });
    const r1 = (await get()).students.find(r => r.id === r0.id);
    check('a message she sends the student is the latest from the counsellor', m.status === 200 && r1.comment && /semester marksheets by Friday/.test(r1.comment.text) && /Kavya/.test(r1.comment.by) && r1.comment.kind === 'message', JSON.stringify(r1.comment));
    check('and the row is updated today', String(r1.updated).slice(0, 10) === new Date().toISOString().slice(0, 10) && r1.updated >= r0.updated);
    const n = await call('/api/staff/student/' + r0.id + '/guide', { method: 'POST', headers: H, body: { body: 'Office to counsellor: chase the fee this week.' } });
    const r2 = (await get()).students.find(r => r.id === r0.id);
    check('guidance the office writes TO the counsellor does not pass as her comment', n.status === 200 && r2.comment.kind === 'message' && /semester marksheets/.test(r2.comment.text), n.status + ' ' + JSON.stringify(r2.comment));
    const mine = await get(K);
    check('a counsellor sees only her own students', mine.students.length > 0 && mine.students.every(r => r.counsellor && /Kavya/.test(r.counsellor.name)) && mine.counsellors.length === 0);

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1600);
    check('the Command centre opens on the overview, with a Students tab', !!(await p.$('#optabs [data-optab="students"]')) && await p.$eval('#stuView', el => el.hidden) && await p.isVisible('#wsum'));
    check('and Students in the side menu', /Students/.test(await p.textContent('#navStudents')));
    await p.click('#optabs [data-optab="students"]'); await p.waitForTimeout(1200);
    check('the tab shows the students and puts the overview away', await p.isVisible('#stuView') && !(await p.isVisible('#wsum')) && /#students$/.test(p.url()));
    const rows = await p.$$('#stuRows tr[data-stu]');
    check('one row a student', rows.length === b0.total, rows.length + ' vs ' + b0.total);
    const txt = await p.textContent('#stuRows tr[data-stu="' + r0.id + '"]');
    check('with stage, pending from, steps, applications, the latest comment and the counsellor', txt.includes(r2.stage) && txt.includes(r2.pendingLabel) && txt.includes(r2.steps.done + ' / ' + r2.steps.total) && txt.includes(r2.comment.text.slice(0, 30)) && /Kavya Menon/.test(txt), txt.slice(0, 300));
    await p.screenshot({ path: '/tmp/students-tab.png' });
    await p.fill('#stuQ', 'zzzz-nobody'); await p.waitForTimeout(200);
    check('search narrows the list', (await p.$$('#stuRows tr[data-stu]')).length === 0 && /No student matches/.test(await p.textContent('#stuRows')));
    await p.fill('#stuQ', ''); await p.selectOption('#stuStage', r2.stageKey); await p.waitForTimeout(200);
    check('and so does the stage', (await p.$$('#stuRows tr[data-stu]')).length === b0.students.filter(r => r.stageKey === r2.stageKey).length);
    await p.selectOption('#stuStage', ''); await p.selectOption('#stuPend', r2.pendingWith); await p.waitForTimeout(200);
    check('and whose move it is', (await p.$$('#stuRows tr[data-stu]')).length === b0.students.filter(r => r.pendingWith === r2.pendingWith).length);
    await p.goto('http://localhost:' + PORT + '/ops.html#students'); await p.waitForTimeout(1500);
    check('the side-menu address opens straight on the tab', await p.isVisible('#stuView') && (await p.$$('#stuRows tr[data-stu]')).length === b0.total);
    await p.click('#stuRows tr[data-stu="' + r0.id + '"]'); await p.waitForTimeout(1500);
    check('a row opens the student\'s file', new RegExp('counsellor(\\.html)?\\?student=' + r0.id).test(p.url()), p.url());
    await p.goBack(); await p.waitForTimeout(1200);
    await p.click('#optabs [data-optab="overview"]'); await p.waitForTimeout(500);
    check('Overview brings the board back', await p.isVisible('#wsum') && !(await p.isVisible('#stuView')));
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    await br.close();
  } catch (e) { bad.push('the suite ran to the end — ' + String(e && e.message || e).slice(0, 300)); }
  finally { try { process.kill(-child.pid); } catch (e) {} }
  ok.forEach(n => console.log('  ✓ ' + n)); bad.forEach(n => console.log('  ✗ ' + n));
  console.log('studentstabtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
