/**
 * Patch 295: a lead can be logged as already converted, and given to a counsellor.
 *
 * Owner, 24 Nov: "in Log a lead have the option to add Converted, so that for
 * referral leads who have already joined, the counsellor can log the lead and
 * convert, and also assign to a counsellor."
 *
 * Boots its own server and checks: a lead logged as converted makes the
 * student account, closes the lead as converted and puts the student with the
 * counsellor chosen; the same without an email is refused and nothing is
 * written; a lead logged as "following up" for another counsellor is theirs;
 * a made-up status or counsellor is refused; and the form does it on screen.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8297;
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
  const dir = '/tmp/db-leadlog-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const H = { Cookie: admin }, K = { Cookie: kavya };
    const book = async () => (await call('/api/staff/leads', { headers: H })).body;
    const b0 = await book();
    const kv = (b0.counsellors || []).find(c => /Kavya/.test(c.name));
    check('the leads page knows the counsellors to choose from', !!kv, JSON.stringify(b0.counsellors || []).slice(0, 120));
    const log = (h, body) => call('/api/staff/leads', { method: 'POST', headers: h, body });

    /* the administrator logs a referral who has already joined, for Kavya */
    const r1 = await log(H, { name: 'Referral One', phone: '9876511111', email: 'referral.one@mail.test', source: 'referral', status: 'converted', ownerId: kv.id });
    check('a lead logged as converted is saved', r1.status === 200 && r1.body.lead && r1.body.lead.status === 'converted', r1.status + ' ' + JSON.stringify(r1.body).slice(0, 160));
    check('the student account is made in the same step', r1.body.accountCreated === true && r1.body.student && r1.body.student.email === 'referral.one@mail.test' && !!r1.body.password);
    check('the lead belongs to the counsellor chosen', Number(r1.body.lead.ownerId) === Number(kv.id), String(r1.body.lead.ownerId));
    const st1 = (await call('/api/staff/student/' + r1.body.student.id, { headers: H })).body;
    const cn = JSON.stringify(st1).match(/Kavya Menon/);
    check('and so does the student', !!cn, JSON.stringify(st1).slice(0, 200));
    const lg = await call('/api/auth/login', { method: 'POST', body: { email: 'referral.one@mail.test', password: r1.body.password } });
    check('the student can sign in with the password shown', lg.status === 200, String(lg.status));

    /* a counsellor does the same for herself: no counsellor chosen means her */
    const r2 = await log(K, { name: 'Referral Two', phone: '9876522222', email: 'referral.two@mail.test', source: 'referral', status: 'converted' });
    check('a counsellor can log and convert too, and the student is hers', r2.status === 200 && r2.body.lead.status === 'converted' && Number(r2.body.lead.ownerId) === Number(kv.id) && r2.body.accountCreated === true, JSON.stringify(r2.body).slice(0, 160));

    /* no email: refused, and nothing written */
    const n0 = (await book()).leads.length;
    const r3 = await log(H, { name: 'Referral Three', phone: '9876533333', source: 'referral', status: 'converted', ownerId: kv.id });
    check('converted with no email is refused, saying why', r3.status === 422 && /email/i.test(r3.body.error || ''), r3.status + ' ' + (r3.body.error || ''));
    check('and no lead is left half-made', (await book()).leads.length === n0);
    const r4 = await log(H, { name: 'Staff Mail', phone: '9876544444', email: 'kavya@glovels.com', source: 'referral', status: 'converted' });
    check('a staff email address is refused before anything is written', r4.status === 409 && (await book()).leads.length === n0, String(r4.status));

    /* not converted: just a status and an owner */
    const r5 = await log(H, { name: 'Follow Me', phone: '9876555555', source: 'whatsapp', status: 'following', ownerId: kv.id });
    check('a lead can be logged as following up, for a named counsellor', r5.status === 200 && r5.body.lead.status === 'following' && Number(r5.body.lead.ownerId) === Number(kv.id) && !r5.body.student, JSON.stringify(r5.body).slice(0, 140));
    const r6 = await log(H, { name: 'Plain Lead', phone: '9876566666', source: 'phone' });
    check('with nothing chosen it is logged as before: contacted, and the logger\'s own', r6.status === 200 && r6.body.lead.status === 'contacted' && !!r6.body.lead.ownerId);
    check('a made-up status is refused', (await log(H, { name: 'Bad', phone: '9876577777', source: 'phone', status: 'banana' })).status === 422);
    check('a counsellor who does not exist is refused', (await log(H, { name: 'Bad', phone: '9876588888', source: 'phone', ownerId: 999999 })).status === 422);
    /* converting from the lead itself still works as it did */
    const r7 = await log(K, { name: 'Later Convert', phone: '9876599999', email: 'later.convert@mail.test', source: 'referral' });
    const cv = await call('/api/staff/lead/' + r7.body.lead.id + '/convert', { method: 'POST', headers: K, body: {} });
    check('Convert on a lead already in the book works as before', cv.status === 200 && cv.body.lead.status === 'converted' && cv.body.accountCreated === true, cv.status + ' ' + JSON.stringify(cv.body).slice(0, 100));
    const cmd = (await call('/api/staff/leads/command', { headers: H })).body;
    const row = cmd.board.find(r => /Kavya/.test(r.name));
    check('the Leads command counts them under her: three converted', row && row.conversions === 3, JSON.stringify(row || {}).slice(0, 160));

    /* ---- the form ---- */
    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:' + PORT + '/leads.html'); await p.waitForTimeout(1500);
    await p.click('#addLead'); await p.waitForTimeout(400);
    check('the form has a Status with Converted in it', /Contacted/.test(await p.textContent('#aStatus')) && /Following up/.test(await p.textContent('#aStatus')) && /Converted/.test(await p.textContent('#aStatus')));
    check('and a Counsellor to give it to', /Kavya Menon/.test(await p.textContent('#aOwner')) && /Me/.test(await p.textContent('#aOwner')));
    await p.click('#aGo'); await p.waitForTimeout(300);
    check('patch 297: an empty form is stopped at the first box', /name is needed/.test(await p.textContent('#dErr')), await p.textContent('#dErr'));
    await p.fill('#aName', 'Screen Referral'); await p.fill('#aPhone', '9876512345');
    await p.selectOption('#aSource', 'referral'); await p.selectOption('#aStatus', 'converted'); await p.selectOption('#aOwner', String(kv.id));
    await p.waitForTimeout(200);
    check('choosing Converted says what will happen', !(await p.$eval('#aConvNote', el => el.hidden)) && /convert/i.test(await p.textContent('#aGo')));
    await p.screenshot({ path: '/tmp/leadlog-form.png' });
    await p.click('#aGo'); await p.waitForTimeout(500);
    check('without an email it stops and says so', /email address/.test(await p.textContent('#dErr')), await p.textContent('#dErr'));
    await p.fill('#aMail', 'screen.referral@mail.test');
    await p.click('#aGo'); await p.waitForTimeout(300);
    check('patch 297: the destination is needed too', /destination is needed/.test(await p.textContent('#dErr')), await p.textContent('#dErr'));
    await p.fill('#aDest', 'Germany');
    await p.click('#aGo'); await p.waitForTimeout(300);
    check('patch 297: and what they want', /what they want/.test(await p.textContent('#dErr')), await p.textContent('#dErr'));
    check('patch 297: nothing was written while a box was empty', !(await book()).leads.some(l => l.name === 'Screen Referral'));
    await p.fill('#aNote', 'MS in Data Science, winter intake. Referred by a current student.');
    await p.click('#aGo'); await p.waitForTimeout(1800);
    const pane = await p.textContent('#leadPane');
    check('with one, the lead opens as converted, with the first password shown once', !!(await p.$('#aConvDone')) && /First password/.test(pane) && /screen\.referral@mail\.test/.test(pane), pane.slice(0, 200));
    await p.screenshot({ path: '/tmp/leadlog-done.png' });
    const after = (await book()).leads.find(l => l.name === 'Screen Referral');
    check('and it is in the book: converted, with Kavya', !!after && after.status === 'converted' && Number(after.ownerId) === Number(kv.id), JSON.stringify(after || {}).slice(0, 140));
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    await br.close();
  } catch (e) { bad.push('the suite ran to the end — ' + String(e && e.message || e).slice(0, 300)); }
  finally { try { process.kill(-child.pid); } catch (e) {} }
  ok.forEach(n => console.log('  ✓ ' + n)); bad.forEach(n => console.log('  ✗ ' + n));
  console.log('leadlogconverttest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
