/**
 * Patch 286: exceptional approval on a documents step.
 *
 * Owner, 24 Nov: "counsellor has the option to move it forward in case a few
 * documents are missing, saying exceptional approval, with some comment —
 * sometimes a few documents may not be needed."
 *
 * Boots its own server on a fresh database (the demo student, whose required
 * documents are not all verified) and checks: the documents step is refused
 * as before and says the exception door is open; an approval needs a real
 * reason; a counsellor can give one and the step closes, with their name, the
 * time, the reason and the documents that were missing kept on the file and
 * in the audit log; the journey moves on; the documents count is NOT faked;
 * reopening withdraws it; other steps and students cannot use it; and the
 * counsellor's screen does all of this.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8286;
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
  const dir = '/tmp/db-docexc-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const student = await login('student@glovels.com');
    const K = { Cookie: kavya };
    const roster = await call('/api/staff/students', { headers: { Cookie: admin } });
    const sid = ((roster.body.students || roster.body) || [])[0].id;
    const fileOf = async () => (await call('/api/staff/student/' + sid, { headers: K })).body;
    const tasksOf = async () => (await call('/api/staff/student/' + sid + '/tasks', { headers: K })).body.tasks || [];
    const put = (id, body, who) => call('/api/staff/task/' + id, { method: 'PUT', headers: who || K, body });

    const f0 = await fileOf();
    const missing = f0.readiness.docs.filter(d => d.status !== 'ok').map(d => d.name);
    const pt = (await tasksOf()).find(t => t.key === 'profile');
    check('the demo file is short of required documents, and the step is open', missing.length > 0 && pt && pt.status !== 'done',
      missing.length + ' missing, step ' + (pt && pt.status));
    check('nothing has been approved by exception yet', Object.keys(f0.docException || {}).length === 0, JSON.stringify(f0.docException));
    const step0 = (f0.timeline.steps || []).find(x => x.key === 'profile');
    check('the step says the exception door is open', step0 && step0.canException === true && !!step0.block, JSON.stringify(step0 && [step0.canException, step0.block]).slice(0, 120));

    /* ---- refused as before, and what is asked of an approval ---- */
    const no = await put(pt.id, { status: 'done' });
    check('ticking it plainly is still refused', no.status === 409 && no.body.locked === true, String(no.status));
    check('and the refusal says an exception is possible', no.body.canException === true);
    const empty = await put(pt.id, { status: 'done', exception: '' });
    check('an approval with no reason is refused', empty.status === 422, String(empty.status));
    const short = await put(pt.id, { status: 'done', exception: 'ok fine' });
    check('so is a reason of a few letters', short.status === 422 && /reason/i.test(short.body.error || ''), short.status + ' ' + short.body.error);
    const stu = await put(pt.id, { status: 'done', exception: 'I do not need these documents at all' }, { Cookie: student });
    check('a student cannot approve their own file', stu.status === 401 || stu.status === 403, String(stu.status));
    const other = (await tasksOf()).find(t => !['profile', 'appdocs'].includes(t.key) && t.status !== 'done' && !t.derived);
    const wrong = other ? await put(other.id, { status: 'done', exception: 'This step should not need anything more' }) : { status: 422, body: {} };
    check('a step that is not about documents has no such door', wrong.status === 422 || wrong.status === 409, (other && other.key) + ' ' + wrong.status);
    check('none of that changed the file', Object.keys((await fileOf()).docException || {}).length === 0);

    /* ---- the counsellor approves, with a reason ---- */
    const reason = 'English test not needed: the university accepts the medium-of-instruction letter. SOP follows in the writing step.';
    const yes = await put(pt.id, { status: 'done', exception: reason });
    check('a counsellor can move it forward with a reason', yes.status === 200 && yes.body.task && yes.body.task.status === 'done',
      yes.status + ' ' + JSON.stringify(yes.body).slice(0, 120));
    const f1 = await fileOf();
    const ex = (f1.docException || {}).profile;
    check('the approval is on the file', !!ex && ex.note === reason, JSON.stringify(ex).slice(0, 140));
    check('with who gave it and when', !!ex && /Kavya/.test(ex.by) && /^\d{4}-\d{2}-\d{2}T/.test(ex.at), ex && ex.by + ' ' + ex.at);
    check('and exactly which documents were missing', !!ex && ex.missing.length === missing.length && missing.every(n => ex.missing.includes(n)),
      ex && ex.missing.join(', '));
    check('the documents count is not faked — it still says what is verified', f1.readiness.ok === f0.readiness.ok && f1.readiness.ok < f1.readiness.of,
      f1.readiness.ok + ' of ' + f1.readiness.of);
    check('the journey is no longer waiting on the documents', !/required documents/.test(String(f1.phase.waitingOn || '')),
      f1.phase.key + ' — ' + f1.phase.waitingOn);
    const step1 = (f1.timeline.steps || []).find(x => x.key === 'profile');
    check('the step is finished, and carries the approval', step1 && step1.state === 'done' && step1.exception && step1.exception.note === reason,
      JSON.stringify(step1 && [step1.state, !!step1.exception]));
    const log = await call('/api/staff/audit', { headers: { Cookie: admin } });
    const lines = JSON.stringify(log.body || {});
    check('the audit log has it, if the log is readable here', log.status !== 200 || /exceptional approval/.test(lines), String(log.status));

    /* ---- reopening withdraws it ---- */
    const re = await put(pt.id, { status: 'open' });
    check('the step can be reopened', re.status === 200, String(re.status));
    const f2 = await fileOf();
    check('and that withdraws the approval', !(f2.docException || {}).profile, JSON.stringify(f2.docException));
    check('so it is refused again without one', (await put(pt.id, { status: 'done' })).status === 409);
    check('and the journey waits on the documents again', /required documents/.test(String(f2.phase.waitingOn || '')), f2.phase.waitingOn);

    /* ---- the screen ---- */
    const br = await chromium.launch();
    const ctx = await br.newContext();
    await ctx.addCookies([{ name: kavya.split('=')[0], value: kavya.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|409|422/.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/counsellor.html?student=' + sid); await p.waitForTimeout(2500);
    await p.click('.tab[data-t="tasks"]'); await p.waitForTimeout(500);
    const btn = await p.$('#t-tasks [data-task-exc="' + pt.id + '"]');
    check('the documents step offers "exceptional approval"', !!btn, (await p.textContent('#t-tasks')).slice(0, 200));
    check('only the document steps do', (await p.$$('#t-tasks [data-task-exc]')).length >= 1
      && (await p.$$eval('#t-tasks [data-task-exc]', a => a.every(b => /documents/i.test(b.closest('li').textContent)))));
    if (btn) {
      await btn.click(); await p.waitForTimeout(300);
      check('it asks for the reason under the step', !!(await p.$('#t-tasks .excrow textarea')));
      await p.click('#t-tasks [data-exc-save]'); await p.waitForTimeout(400);
      check('saving with nothing written does nothing', !((await fileOf()).docException || {}).profile);
      await p.fill('#t-tasks .excrow textarea', 'Financial documents are for the visa stage; not needed for these applications.');
      await p.click('#t-tasks [data-exc-save]'); await p.waitForTimeout(2500);
      const f3 = await fileOf();
      check('written and saved, the file is moved forward', !!(f3.docException || {}).profile, JSON.stringify(f3.docException).slice(0, 120));
      await p.click('.tab[data-t="tasks"]'); await p.waitForTimeout(500);
      const t3 = await p.textContent('#t-tasks');
      check('the step reads "Exceptional approval by …" with the reason', /Exceptional approval by Kavya/.test(t3) && /visa stage/.test(t3), t3.slice(0, 260));
      check('and names what it went without', /without: /.test(t3) && missing.every(n => t3.includes(n)), t3.slice(0, 300));
      const strip = (await p.$('.docneed')) ? await p.textContent('.docneed') : '';
      check('the file header says it was moved forward by exceptional approval, not "still needed"',
        /moved forward by exceptional approval/.test(strip) && !/still needed/.test(strip), strip.slice(0, 200));
    }
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    await p.screenshot({ path: '/tmp/docexc.png', fullPage: false });
    await br.close();
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\ndocexceptiontest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
