/**
 * Patch 302: the office can call the people on its files "Applicants".
 *
 * Owner, 24 Nov: "instead of student please mention everywhere applicant."
 *
 * A switch for the administrator on the Command centre; every staff screen
 * follows it. Boots its own server and checks: it starts on "student" and
 * nothing is changed; only an administrator can change it; once set, the
 * Command centre, the Students tab, a file and the leads pages say Applicant;
 * what people wrote, an email address, the address bar and "student visa"
 * are left alone; a student's own pages are untouched; and it switches back.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8305;
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
  const dir = '/tmp/db-wording-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const student = await login('student@glovels.com');
    const H = { Cookie: admin }, K = { Cookie: kavya };
    const get = async h => (await call('/api/staff/wording', { headers: h })).body;
    check('it starts on "student"', (await get(H)).noun === 'student');
    check('a counsellor can read it', (await get(K)).noun === 'student');
    check('a student cannot', [401, 403].includes((await call('/api/staff/wording', { headers: { Cookie: student } })).status));
    check('a counsellor cannot change it', (await call('/api/staff/wording', { method: 'PUT', headers: K, body: { noun: 'applicant' } })).status === 403);
    check('a made-up word is refused', (await call('/api/staff/wording', { method: 'PUT', headers: H, body: { noun: 'customer' } })).status === 422);
    const js = await call('/staff-wording.js');
    check('the script is served', js.status === 200 && /glvStaffNoun/.test(js.body.raw || ''), String(js.status));
    /* a message with the word in it, written by a person */
    await call('/api/staff/student/3/message', { method: 'POST', headers: K, body: { body: 'Every student must upload the student visa form.' } });

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    const vis = () => p.evaluate(() => document.querySelector('#main, main, body').innerText);
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1800);
    check('on "student" the Command centre reads as before', /Students/.test(await p.textContent('#optabs')) && !/Applicant/.test((await vis()).replace(/Say: Applicant/g, '')));
    check('the administrator has the switch', await p.isVisible('#nounSel') && (await p.inputValue('#nounSel')) === 'student');
    await p.selectOption('#nounSel', 'applicant'); await p.waitForTimeout(1200);
    check('choosing Applicant saves it', (await get(H)).noun === 'applicant');
    const t1 = await vis();
    check('and the Command centre says Applicants at once', /Applicants/.test(await p.textContent('#optabs')) && /Where every applicant is/i.test(t1) && !/\bstudents?\b/i.test(t1.replace(/Say: Student/g, '')), (t1.match(/.{0,30}\bstudents?\b.{0,30}/i) || [''])[0]);
    await p.screenshot({ path: '/tmp/wording-ops.png' });
    await p.click('#optabs [data-optab="students"]'); await p.waitForTimeout(1300);
    const t2 = await p.evaluate(() => document.querySelector('#stuView').innerText);
    check('the tab and its list say applicant', /APPLICANT|Applicant/.test(t2) && /1 applicant/.test(t2), t2.slice(0, 160));
    check('but what the counsellor wrote is word for word', /Every student must upload the student visa form\./.test(t2), t2.slice(0, 400));
    check('the side menu says Applicants', /Applicants/.test(await p.textContent('#navStudents')));
    await p.click('#stuRows tr[data-stu="3"]'); await p.waitForTimeout(2500);
    check('the address still says student, so links keep working', /student=3/.test(p.url()), p.url());
    const t3 = await p.evaluate(() => document.body.innerText);
    check('the file says applicant in the office\'s own labels', /Where this applicant stands/i.test(t3), (t3.match(/Where this .{0,30}/i) || [''])[0]);
    check('an email address is left alone', /student@glovels\.com/.test(t3));
    await p.screenshot({ path: '/tmp/wording-file.png' });
    await p.click('[data-tab="conversation"], [data-tab="chat"], [data-t="conversation"]').catch(() => {});
    await p.waitForTimeout(600);
    const th = await p.evaluate(() => (document.querySelector('#thread') || {}).innerText || '');
    check('the conversation is left exactly as written', !th || /Every student must upload the student visa form\./.test(th), th.slice(-200));
    await p.goto('http://localhost:' + PORT + '/leads-command.html'); await p.waitForTimeout(1800);
    check('the Leads command follows too', /Applicants/.test(await p.evaluate(() => document.querySelector('.nav').innerText)));
    /* the student's own pages do not load it */
    const sctx = await br.newContext();
    await sctx.addCookies([{ name: student.split('=')[0], value: student.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const sp = await sctx.newPage();
    await sp.goto('http://localhost:' + PORT + '/dashboard.html'); await sp.waitForTimeout(1500);
    check('a student\'s own dashboard does not carry the switch', !(await sp.content()).includes('staff-wording.js'));
    await sctx.close();
    /* and back */
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1500);
    await p.selectOption('#nounSel', 'student'); await p.waitForTimeout(2200);
    check('switching back to Student puts every word back', (await get(H)).noun === 'student' && /Students/.test(await p.textContent('#optabs')) && !/Applicant/.test((await vis()).replace(/Say: Applicant/g, '')));
    check('the pages have no script errors', errs.length === 0, errs.join(' | '));
    await br.close();
  } catch (e) { bad.push('the suite ran to the end — ' + String(e && e.message || e).slice(0, 300)); }
  finally { try { process.kill(-child.pid); } catch (e) {} }
  ok.forEach(n => console.log('  ✓ ' + n)); bad.forEach(n => console.log('  ✗ ' + n));
  console.log('wordingtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
