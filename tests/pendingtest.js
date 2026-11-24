/**
 * Patch 287: the command centre says whose move each file is.
 *
 * Owner, 24 Nov: "command centre should not mislead us. It should clearly
 * show the exact status, pending from whom as well … for each student what is
 * pending should be there, to understand Kanchana has this student and
 * application or CV or SOP is pending."
 *
 * Boots its own server on a fresh database (the demo student) and checks:
 * /api/staff/command carries one status per open file — who it is waiting on
 * and what for, by name; the counts by whom add up; the status follows the
 * file as it changes (documents to check → documents to upload → shortlist /
 * applications to submit → decision awaited from a university); and /ops
 * shows the count strip and the line on every student row.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8287;
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
  const dir = '/tmp/db-pending-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const H = { Cookie: admin };
    const board = async () => (await call('/api/staff/command', { headers: H })).body;
    const roster = await call('/api/staff/students', { headers: H });
    const sid = ((roster.body.students || roster.body) || [])[0].id;
    const fileOf = async () => (await call('/api/staff/student/' + sid, { headers: H })).body;
    const setDoc = (key, status) => call('/api/staff/student/' + sid + '/document/' + key, { method: 'POST', headers: H, body: { status } });
    const setApp = (id, body) => call('/api/staff/student/' + sid + '/application/' + encodeURIComponent(id), { method: 'PUT', headers: H, body });

    /* ---- the shape, and that it adds up ---- */
    const a = await board();
    const P = (a.pending || {})[sid];
    check('the board carries a status for the student', !!P && !!P.with && !!P.what, JSON.stringify(P).slice(0, 160));
    check('it names who the file is waiting on', ['student', 'counsellor', 'university', 'consulate', 'office'].includes(P.with) && !!P.withLabel);
    check('and who holds the file', P.counsellor && /Kavya/.test(P.counsellor.name), JSON.stringify(P.counsellor));
    check('and where on the journey it is', !!P.stage, P.stage);
    const sum = Object.values(a.pendingFrom || {}).reduce((n, x) => n + x, 0);
    check('the counts by whom add up to the files with a status', sum === Object.keys(a.pending).length && sum >= 1, sum + ' vs ' + Object.keys(a.pending).length);
    check('one file, one answer', Object.values(a.pending).every(x => a.pendingFrom[x.with] >= 1));

    /* ---- documents uploaded and not checked: the counsellor's move ---- */
    const f0 = await fileOf();
    const waiting = f0.readiness.docs.filter(d => d.status === 'wait');
    const notUp = f0.readiness.docs.filter(d => d.status === 'none');
    check('the demo file has documents to check and documents not uploaded', waiting.length > 0 && notUp.length > 0, waiting.length + ' / ' + notUp.length);
    check('so it is pending from the counsellor, to check them', P.with === 'counsellor' && /waiting to be checked/.test(P.what), P.what);
    check('naming them', waiting.slice(0, 4).every(d => P.what.includes(d.name)), P.what);
    check('and saying how many are still to come from the student', new RegExp(notUp.length + ' still to come from the student').test(P.what), P.what);

    /* ---- every uploaded one accepted: now it is the student's move ---- */
    for (const d of waiting) await setDoc(d.key, 'ok');
    const f1 = await fileOf();
    const stillWaiting = f1.readiness.docs.filter(d => d.status === 'wait');
    const b1 = await board(); const P1 = b1.pending[sid];
    if (!stillWaiting.length) {
      check('with everything on the file accepted, it is pending from the student', P1.with === 'student', P1.with + ': ' + P1.what);
      check('and it says which documents to upload, by name', /to upload: /.test(P1.what) && notUp.slice(0, 5).every(d => P1.what.includes(d.name)), P1.what);
      check('the count moved from the counsellor to the student', b1.pendingFrom.student === (a.pendingFrom.student || 0) + 1
        && b1.pendingFrom.counsellor === a.pendingFrom.counsellor - 1, JSON.stringify(b1.pendingFrom));
    } else {
      /* a seeded file the server will not accept as it stands: still the counsellor's */
      check('a document that could not be accepted keeps it with the counsellor', P1.with === 'counsellor', P1.what);
    }

    /* ---- moved on by exceptional approval: applications ---- */
    const tasks = (await call('/api/staff/student/' + sid + '/tasks', { headers: H })).body.tasks || [];
    const pt = tasks.find(t => t.key === 'profile');
    const ex = await call('/api/staff/task/' + pt.id, { method: 'PUT', headers: H,
      body: { status: 'done', exception: 'Remaining documents follow in the writing and visa steps.' } });
    check('the documents step is moved forward by exceptional approval', ex.status === 200, ex.status + ' ' + JSON.stringify(ex.body).slice(0, 100));
    /* every row the board counts: the office's list, and any the student saved that has an application */
    const office = (f1.shortlist || []).filter(r => r.addedBy !== 'student' || (f1.apps || {})[r.id]);
    for (const r of office) await setApp(r.id, { stage: 0, outcome: '' });
    const b2 = await board(); const P2 = b2.pending[sid];
    check('the status no longer asks the student for documents', !/required document/.test(P2.what), P2.with + ': ' + P2.what);
    check('it is the counsellor\'s move again', P2.with === 'counsellor', P2.with + ': ' + P2.what);

    /* everything submitted, nothing decided → a university */
    const sent = [];
    for (const r of office) sent.push((await setApp(r.id, { stage: 2, outcome: '' })).status);
    const b3 = await board(); const P3 = b3.pending[sid]; const A3 = b3.applications[sid];
    const f3 = await fileOf();
    check('the file has reached the applications', ['applying', 'offers'].includes(f3.phase.key), f3.phase.key + ' ' + sent.join(','));
    /* The status must agree with the applied count, whichever it is. */
    const agrees = (P, A) => A.pending > 0
      ? P.with === 'counsellor' && P.what.includes(A.applied + ' of ' + A.listed + ' applied') && P.what.includes(A.items.find(x => !x.applied).university)
      : A.waiting > 0 ? P.with === 'university' && /Decision awaited from /.test(P.what) && P.what.includes(A.items.find(x => x.waiting).university)
      : true;
    check('the status agrees with the applied count', agrees(P3, A3), A3.applied + '/' + A3.listed + ' — ' + P3.with + ': ' + P3.what);
    /* Whatever would not go to Submitted by this route, close as decided, so every one has been sent. */
    for (const x of A3.items.filter(y => !y.applied)) {
      const r = office.find(o => o.university === x.university && o.program === x.program);
      if (r) await setApp(r.id, { stage: 4, outcome: 'rejected' });
    }
    const b4 = await board(); const P4 = b4.pending[sid]; const A4 = b4.applications[sid];
    check('with every application sent and some undecided, it is pending from the university',
      A4.pending === 0 && A4.waiting > 0 && P4.with === 'university' && /Decision awaited from /.test(P4.what), A4.applied + '/' + A4.listed + ' — ' + P4.with + ': ' + P4.what);
    check('naming a university it is waiting on', P4.what.includes(A4.items.find(x => x.waiting).university), P4.what);
    check('and the count on the board says so', b4.pendingFrom.university === 1, JSON.stringify(b4.pendingFrom));
    const back = office.find(o => { const it = A4.items.find(x => x.waiting); return o.university === it.university && o.program === it.program; });
    await setApp(back.id, { stage: 0, outcome: '' });
    const b5 = await board(); const P5 = b5.pending[sid]; const A5 = b5.applications[sid];
    check('one not yet sent: back with the counsellor, counted "n of m applied", by name', P5.with === 'counsellor' && agrees(P5, A5) && A5.pending === 1,
      A5.applied + '/' + A5.listed + ' — ' + P5.what);

    /* ---- who may see it ---- */
    const kavya = await login('kavya@glovels.com');
    const k = await call('/api/staff/command', { headers: { Cookie: kavya } });
    check('a counsellor gets the status of their own students', k.status === 200 && !!(k.body.pending || {})[sid]);
    const student = await login('student@glovels.com');
    check('a student is refused', [401, 403].includes((await call('/api/staff/command', { headers: { Cookie: student } })).status));

    /* ---- the page ---- */
    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1500);
    const now = await board(); const PN = now.pending[sid];
    const strip = await p.textContent('#pfrom');
    check('the board counts the files by whose move it is', /Pending from/.test(strip) && /Students/.test(strip) && /Counsellors/.test(strip) && /Universities/.test(strip), strip);
    check('a count with nobody in it cannot be opened', (await p.$$('#pfrom button[disabled]')).length >= 1);
    await p.click('#pfrom [data-pend="' + PN.with + '"]'); await p.waitForTimeout(500);
    const title = await p.textContent('#dTitle'), list = await p.textContent('#dList');
    check('a count opens the students it counts', /Pending from/.test(title) && /Prasad Kumar/.test(list), title + ': ' + list.slice(0, 120));
    check('each row says who it is pending from and what for', list.includes('Pending from ' + PN.withLabel) && list.includes(PN.what.slice(0, 40)), list.slice(0, 260));
    check('and who holds the file', /Kavya Menon/.test(list));
    await p.screenshot({ path: '/tmp/pending-drawer.png' });
    await p.click('#dx'); await p.waitForTimeout(300);
    await p.screenshot({ path: '/tmp/pending-board.png' });
    /* the same line on a counsellor's own list, a queue and a stop */
    const row = await p.$('tr[data-cid]');
    if (row) { await row.click(); await p.waitForTimeout(400); const kp = await p.$('[data-cview="students"]'); if (kp) { await kp.click(); await p.waitForTimeout(400); } }
    check('a counsellor\'s own list shows it for each of their students', /Pending from /.test(await p.textContent('#dList')), (await p.textContent('#dList')).slice(0, 160));
    await p.screenshot({ path: '/tmp/pending-counsellor.png' });
    await p.click('#dx'); await p.waitForTimeout(300);
    const stop = await p.$('.stop.has');
    if (stop) { await stop.click(); await p.waitForTimeout(400); }
    check('a stop on the journey shows it', !!stop && /Pending from /.test(await p.textContent('#dList')));
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    await br.close();
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\npendingtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
