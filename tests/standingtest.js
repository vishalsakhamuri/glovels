/**
 * Patch 291: the student file says where the student stands, stage by stage.
 *
 * Owner, 24 Nov: "when we open the student file it should clearly show the
 * student status like application process, visa etc. In the application
 * process, how many completed and how many pending."
 *
 * Boots its own server (the demo student) and checks: the file carries six
 * stages with a figure each; the figures agree with the documents count, the
 * shortlist and the applications on the same file, and with the command
 * centre; done / now / later follows the journey; the figures move when an
 * application does; and the panel is at the top of the file with the
 * applications listed by name under Applied and Pending.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8291;
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
  const dir = '/tmp/db-standing-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const H = { Cookie: admin };
    const roster = await call('/api/staff/students', { headers: H });
    const sid = ((roster.body.students || roster.body) || [])[0].id;
    const fileOf = async () => (await call('/api/staff/student/' + sid, { headers: H })).body;
    const f = await fileOf();
    const S = f.standing;
    check('the file says where the student stands', !!S && Array.isArray(S.stages), JSON.stringify(S).slice(0, 120));
    const keys = S.stages.map(g => g.key);
    check('six stages, in the order of the journey', keys.join(',') === 'welcome,documents,shortlist,writing,applications,visa', keys.join(','));
    check('each with a figure, a line and a state', S.stages.every(g => g.label && String(g.big) !== '' && g.small && ['done', 'now', 'todo'].includes(g.state)),
      JSON.stringify(S.stages.map(g => [g.big, g.state])));
    const st = k => S.stages.find(g => g.key === k);
    check('documents is the file\'s own count', st('documents').big === f.readiness.ok + ' / ' + f.readiness.of, st('documents').big);
    const miss = f.readiness.docs.filter(d => d.status !== 'ok');
    check('and says how many are missing, naming them', st('documents').small.includes(miss.length + ' missing') && st('documents').small.includes(miss[0].name), st('documents').small);
    const board = (await call('/api/staff/command', { headers: H })).body;
    const A = board.applications[sid];
    check('applications is "applied / shortlisted", the command centre\'s own sum', st('applications').big === A.applied + ' / ' + A.listed && S.apps.applied === A.applied && S.apps.listed === A.listed,
      st('applications').big + ' vs ' + A.applied + '/' + A.listed);
    check('with pending, waiting and offers said', (!A.pending || st('applications').small.includes(A.pending + ' pending'))
      && (!A.waiting || st('applications').small.includes(A.waiting + ' waiting to hear')) && (!A.offers || /offer/.test(st('applications').small)), st('applications').small);
    check('shortlist is the number on the list', st('shortlist').big === String(A.listed), st('shortlist').big);
    check('SOP and LOR say where each stands', /SOP: .+ · LOR: .+/.test(st('writing').small) && /^\d \/ 2$/.test(st('writing').big), st('writing').big + ' ' + st('writing').small);
    check('visa shows its documents until there is a decision', /^\d+ \/ \d+$/.test(st('visa').big) && /visa documents/.test(st('visa').small), st('visa').big + ' ' + st('visa').small);
    check('the stage the journey is at is "now", those before it done, those after later',
      f.phase.key === 'profile' && st('welcome').state === 'done' && st('documents').state === 'now' && st('visa').state === 'todo',
      f.phase.key + ' ' + JSON.stringify(S.stages.map(g => g.state)));
    check('it says whose move it is, the same as the command centre', !!S.pending && S.pending.with === board.pending[sid].with && S.pending.what === board.pending[sid].what,
      JSON.stringify(S.pending) + ' vs ' + JSON.stringify(board.pending[sid]).slice(0, 120));

    /* ---- it moves with the file ---- */
    const todo = S.apps.items.find(x => !x.applied);
    const row = f.shortlist.find(r => r.university === todo.university && r.program === todo.program);
    await call('/api/staff/student/' + sid + '/application/' + encodeURIComponent(row.id), { method: 'PUT', headers: H, body: { stage: 2 } });
    const S2 = (await fileOf()).standing;
    check('submitting one more application moves the figure', S2.stages.find(g => g.key === 'applications').big === (A.applied + 1) + ' / ' + A.listed,
      S2.stages.find(g => g.key === 'applications').big);
    await call('/api/staff/student/' + sid + '/visa', { method: 'PUT', headers: H, body: { decision: 'granted' } });
    const S3 = (await fileOf()).standing;
    check('a visa decision is shown in words', ['Granted', S.stages.find(g => g.key === 'visa').big].includes(S3.stages.find(g => g.key === 'visa').big),
      S3.stages.find(g => g.key === 'visa').big);

    /* ---- who may see it ---- */
    const student = await login('student@glovels.com');
    check('a student cannot read a staff file', [401, 403].includes((await call('/api/staff/student/' + sid, { headers: { Cookie: student } })).status));

    /* ---- the page ---- */
    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1320, height: 1000 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/counsellor.html?student=' + sid); await p.waitForTimeout(2800);
    const now = (await fileOf()).standing;
    check('the panel is on the file', !!(await p.$('.standing')));
    check('above the tiles and the tabs', await p.evaluate(() => { const a = document.querySelector('.standing'), b = document.querySelector('.tabs'); return !!a && !!b && a.getBoundingClientRect().top < b.getBoundingClientRect().top; }));
    check('with the six stages', (await p.$$('.standing .stand')).length === 6);
    const txt = await p.textContent('.standing');
    check('each showing its figure', now.stages.every(g => txt.includes(String(g.big))), now.stages.map(g => g.big).join(' | '));
    check('the stage in hand is marked Now', (await p.getAttribute('.standing .stand[data-stage="documents"]', 'data-state')) === 'now'
      || (await p.$$eval('.standing .stand[data-state="now"]', a => a.length)) >= 1);
    check('it says who it is pending from', /Pending from (Student|Counsellor|University|Consulate|Office)/.test(txt) && txt.includes(now.pending.what.slice(0, 30)), txt.slice(0, 200));
    const apps = await p.textContent('.standing .stand-apps');
    const done = now.apps.items.filter(x => x.applied), left = now.apps.items.filter(x => !x.applied);
    check('the applications are listed by name: applied', new RegExp('Applied \\(' + done.length + '\\)').test(apps) && done.every(x => apps.includes(x.university)), apps.slice(0, 160));
    check('and pending, still to apply', new RegExp('still to apply \\(' + left.length + '\\)').test(apps) && left.every(x => apps.includes(x.university)), apps.slice(-200));
    check('the summary line counts them', apps.includes(now.apps.applied + ' of ' + now.apps.listed + ' applied'));
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    await p.screenshot({ path: '/tmp/standing.png' });
    await br.close();
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\nstandingtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
