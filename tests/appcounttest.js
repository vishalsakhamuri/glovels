/**
 * Patch 285: "3 / 5 applied" on the command centre — and which.
 *
 * Owner, 24 Nov: "waiting for which university decision? … for a student who
 * has 5 shortlisted universities, how many have we applied to and how many
 * applications do we need to process … they want 3 / 5 applied, also what
 * applied and what pending."
 *
 * Boots its own server on a fresh database (the demo student and his
 * shortlist), and checks: /api/staff/command carries one applications summary
 * per open file whose numbers add up and agree with the student's file; moving
 * an application to "Submitted" moves the count; a student with nothing sent is
 * not in "Waiting on university decisions" and is counted beside it; and the
 * drawer on /ops shows the count and lists Applied and Pending by name.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8285;
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
  const dir = '/tmp/db-appcount-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const H = { Cookie: admin };
    const board = async () => (await call('/api/staff/command', { headers: H })).body;
    const queue = (b, k) => (b.queues || []).find(q => q.key === k) || { rows: [] };

    const roster = await call('/api/staff/students', { headers: H });
    const st = ((roster.body.students || roster.body) || []).find(x => x.shortlist > 0);
    check('the demo student has a shortlist to count', !!st, JSON.stringify(roster.body).slice(0, 120));
    const sid = st.id;
    const file = (await call('/api/staff/student/' + sid, { headers: H })).body;

    /* ---- the summary, and that it agrees with the file ---- */
    const a = await board();
    const A = (a.applications || {})[sid];
    check('the board carries an applications summary for the student', !!A && Array.isArray(A.items), JSON.stringify(A).slice(0, 120));
    check('listed = applied + pending', A.listed === A.applied + A.pending && A.listed > 0, A.applied + ' + ' + A.pending + ' of ' + A.listed);
    check('every item says its university and whether it was applied to',
      A.items.every(x => x.university && typeof x.applied === 'boolean' && x.stage));
    check('the applied count is the items at Submitted or later', A.items.filter(x => x.applied).length === A.applied);
    const office = (file.shortlist || []).filter(r => r.addedBy !== 'student');
    const sentInFile = office.filter(r => ((file.apps || {})[r.id] || {}).stage >= 2).length;
    check('and it agrees with the student\'s own file', A.applied === sentInFile && A.listed >= office.length,
      'board ' + A.applied + ' / ' + A.listed + ', file ' + sentInFile + ' / ' + office.length);
    check('waiting is never more than applied, offers never more than applied', A.waiting <= A.applied && A.offers <= A.applied);
    check('applied ones are listed first', A.items.findIndex(x => !x.applied) === -1
      || A.items.slice(A.items.findIndex(x => !x.applied)).every(x => !x.applied));

    /* ---- nothing sent: not "waiting on a university" ---- */
    for (const r of office) {
      await call('/api/staff/student/' + sid + '/application/' + encodeURIComponent(r.id), { method: 'PUT', headers: H,
        body: { stage: 0, outcome: '' } });
    }
    const b0 = await board();
    const A0 = b0.applications[sid];
    check('with every application back at the start, 0 are applied', A0.applied === 0 && A0.pending === A0.listed, A0.applied + ' / ' + A0.listed);
    check('a pending one says where it stands, not an outcome', A0.items.every(x => !x.applied && !x.outcome && !x.waiting));
    const d0 = queue(b0, 'decisions');
    check('the student is not in "Waiting on university decisions"', !d0.rows.some(r => Number(r.studentId) === Number(sid)),
      JSON.stringify(d0.rows.map(r => r.student)));
    check('and is counted beside the queue instead', d0.notYet >= 1, String(d0.notYet));
    check('the headline still adds up', b0.headline.open === b0.queues.reduce((n, q) => n + q.total, 0));

    /* ---- one sent: the count moves, and the student is waiting ---- */
    const first = office[0];
    const put = await call('/api/staff/student/' + sid + '/application/' + encodeURIComponent(first.id), { method: 'PUT', headers: H,
      body: { stage: 2 } });
    check('an application can be moved to Submitted', put.status === 200, String(put.status));
    const b1 = await board();
    const A1 = b1.applications[sid];
    check('the board now says 1 applied', A1.applied === 1 && A1.pending === A1.listed - 1 && A1.waiting === 1, A1.applied + ' / ' + A1.listed);
    check('and names the university that was applied to', A1.items[0].applied && A1.items[0].university === first.university,
      A1.items[0].university);
    const d1 = queue(b1, 'decisions');
    check('the student is now in "Waiting on university decisions"', d1.rows.some(r => Number(r.studentId) === Number(sid)),
      JSON.stringify(d1.rows.map(r => r.student)) + ' notYet ' + d1.notYet);

    /* ---- an offer is an offer ---- */
    await call('/api/staff/student/' + sid + '/application/' + encodeURIComponent(first.id), { method: 'PUT', headers: H,
      body: { stage: 4, outcome: 'offer' } });
    const A2 = (await board()).applications[sid];
    check('an offer is counted, and is no longer "waiting"', A2.offers === 1 && A2.waiting === 0 && A2.applied === 1,
      JSON.stringify({ o: A2.offers, w: A2.waiting, a: A2.applied }));
    /* back to "sent, waiting" for the page below */
    await call('/api/staff/student/' + sid + '/application/' + encodeURIComponent(first.id), { method: 'PUT', headers: H,
      body: { stage: 2, outcome: '' } });

    /* ---- "why is he shown here if documents not accepted" ---- */
    const bq = await board();
    const fq = (await call('/api/staff/student/' + sid, { headers: H })).body;
    const pub = queue(bq, 'public'), visa = queue(bq, 'visa');
    check('the demo file is still at Profile and documents', fq.phase.key === 'profile', fq.phase.key);
    check('so its "Application documents assembled" step is not in the applications queue',
      !pub.rows.some(r => Number(r.studentId) === Number(sid) && /documents assembled/.test(r.what) && r.state !== 'late'),
      JSON.stringify(pub.rows.map(r => r.what + ':' + r.state)));
    check('unless its date has passed — a late step is never hidden',
      pub.rows.filter(r => Number(r.studentId) === Number(sid)).every(r => r.state === 'late'));
    check('nor are its visa steps in the visa queue', !visa.rows.some(r => Number(r.studentId) === Number(sid) && r.state !== 'late'),
      JSON.stringify(visa.rows.map(r => r.what + ':' + r.state)));
    check('they are counted beside those queues instead', pub.notYet + visa.notYet >= 1, pub.notYet + ' + ' + visa.notYet);
    check('the earlier queues are untouched', queue(bq, 'profile').rows.some(r => Number(r.studentId) === Number(sid)));
    check('and the headline still adds up', bq.headline.open === bq.queues.reduce((n, q) => n + q.total, 0));

    /* ---- which documents: "6 of 10" names the four ---- */
    const f2 = (await call('/api/staff/student/' + sid, { headers: H })).body;
    const R = f2.readiness;
    const missing = R.docs.filter(d => d.status !== 'ok');
    check('the demo file is short of required documents', R.ok < R.of && missing.length === R.of - R.ok, R.ok + ' of ' + R.of);
    check('the phase banner names every one still needed', /still needed: /.test(f2.phase.waitingOn)
      && missing.every(d => f2.phase.waitingOn.includes(d.name)), f2.phase.waitingOn);
    check('and says which were never uploaded', !missing.some(d => d.status === 'none') || /\(not uploaded\)/.test(f2.phase.waitingOn));
    const tl = (await call('/api/staff/student/' + sid + '/tasks', { headers: H })).body.tasks || [];
    const pt = tl.find(t => t.key === 'profile' && t.status !== 'done');
    const tick = pt ? await call('/api/staff/task/' + pt.id, { method: 'PUT', headers: H, body: { status: 'done' } }) : { status: 0, body: {} };
    check('ticking the documents step is still refused', tick.status === 409, String(tick.status));
    check('and the refusal names the documents, not just a count', missing.every(d => String(tick.body.error || '').includes(d.name)),
      String(tick.body.error || '').slice(0, 200));
    check('it does not say "accept the rest" when some were never uploaded',
      !missing.some(d => d.status === 'none') || /uploaded/.test(String(tick.body.error || '')), String(tick.body.error || '').slice(-140));

    /* ---- who may see it ---- */
    const student = await login('student@glovels.com');
    const s = await call('/api/staff/command', { headers: { Cookie: student } });
    check('a student is still refused the board', s.status === 401 || s.status === 403, String(s.status));

    /* ---- the page ---- */
    const br = await chromium.launch();
    const ctx = await br.newContext();
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1500);
    await p.click('[data-q="decisions"]'); await p.waitForTimeout(500);
    const listed = (await board()).applications[sid].listed;
    const txt = await p.textContent('#dList');
    check('the drawer shows the count on the student\'s row', new RegExp('1 / ' + listed + ' applied').test(txt), txt.slice(0, 160));
    check('with how many are pending', new RegExp((listed - 1) + ' pending').test(txt), txt.slice(0, 200));
    check('the list is shut until asked for', !(await p.$('#dList .apps details[open]')));
    await p.click('#dList .apps summary'); await p.waitForTimeout(300);
    const open = await p.textContent('#dList .apps .aplist');
    check('opened, it lists what was applied to, by name', /Applied \(1\)/.test(open) && open.includes(first.university), open.slice(0, 160));
    check('and what is still to apply to', new RegExp('still to apply \\(' + (listed - 1) + '\\)').test(open)
      && office.slice(1).every(r => open.includes(r.university)), open.slice(0, 260));
    check('an applied one says it is waiting to hear', /Submitted · waiting to hear/.test(open), open.slice(0, 200));
    check('the queue does not claim anybody has nothing sent when nobody has',
      !/nothing submitted/.test(await p.textContent('#dSub')), await p.textContent('#dSub'));
    /* the minute's refresh must not shut a list somebody is reading */
    await p.evaluate(() => document.getElementById('refresh').click()); await p.waitForTimeout(1200);
    check('a refresh leaves the opened list open', !!(await p.$('#dList .apps details[open]')));
    await p.click('#dx'); await p.waitForTimeout(300);
    /* a queue that is not about applications still shows the count where there is a shortlist */
    const stop = await p.$('.stop.has');
    if (stop) { await stop.click(); await p.waitForTimeout(500); }
    check('a stop on the route shows the count too', !!stop && / applied/.test(await p.textContent('#dList')),
      (await p.textContent('#dList')).slice(0, 140));
    /* the counsellor's file: the missing documents, by name, under the tiles */
    await p.goto('http://localhost:' + PORT + '/counsellor.html?student=' + sid); await p.waitForTimeout(2500);
    const need = (await p.$('.docneed')) ? await p.textContent('.docneed') : '';
    check('the student file lists the required documents still needed', /still needed/.test(need)
      && missing.every(d => need.includes(d.name)), need.slice(0, 200));
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    const shot = await p.screenshot({ path: '/tmp/appcount.png' });
    await br.close();
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\nappcounttest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
