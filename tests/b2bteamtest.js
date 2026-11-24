/**
 * Patch 289: a B2B agency has one admin and up to ten counsellors.
 *
 * Owner, 24 Nov: "every B2B customer is asking for a main admin and
 * counsellors. We can have up to 10 counsellors and one admin in B2B. The B2B
 * admin can see the list of all students, also do what the current B2B login
 * can do. He will ask our main admin to create sub-logins for his counsellors.
 * A counsellor can upload students. The B2B admin can see total students and
 * a counsellor can see his uploaded students. The admin can move students
 * from one counsellor to another and the data also moves. This is only in the
 * B2B login."
 *
 * Boots its own server on a fresh database and checks all of that: who makes
 * the logins, the limit of ten, who sees which students, that a counsellor
 * cannot reach a colleague's student by any door, that moving a student moves
 * the whole record, what happens when a counsellor login is removed, that
 * another agency sees none of it — and the two screens.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8289;
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const dir = '/tmp/db-b2bteam-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  const browser = await chromium.launch();
  try {
    const probe = await browser.newContext();
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); try { if ((await probe.request.get(BASE + '/api/health')).ok()) break; } catch (e) {} }

    const admin = await browser.newContext();
    await admin.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const PW = 'a-long-password-289';
    const make = (data) => admin.request.post(BASE + '/api/staff/people', { data: Object.assign({ password: PW }, data) });
    const signIn = async (email) => {
      const ctx = await browser.newContext();
      await ctx.request.post(BASE + '/api/auth/login', { data: { email, password: PW } });
      await ctx.request.post(BASE + '/api/auth/change', { data: { current: PW, password: PW + 'X' } });
      return ctx;
    };
    const J = async r => { try { return await r.json(); } catch (e) { return {}; } };

    /* ---- the main admin makes the agency and its counsellor logins ---- */
    const ra = await J(await make({ name: 'Alpha Overseas', email: 'alpha@agency.example', role: 'partner' }));
    const rb = await J(await make({ name: 'Beta Education', email: 'beta@agency.example', role: 'partner' }));
    const A = ra.person.id, B = rb.person.id;
    const c1r = await make({ name: 'Asha (Alpha)', email: 'asha@agency.example', role: 'partner', agencyId: A });
    const c1 = (await J(c1r)).person;
    check('the main admin can create a counsellor login under an agency', c1r.ok() && !!c1, String(c1r.status()));
    const c2 = (await J(await make({ name: 'Bala (Alpha)', email: 'bala@agency.example', role: 'partner', agencyId: A }))).person;
    const bad1 = await make({ name: 'Nobody', email: 'nobody@agency.example', role: 'partner', agencyId: 99999 });
    check('not under an agency that does not exist', bad1.status() === 404, String(bad1.status()));
    const bad2 = await make({ name: 'Nested', email: 'nested@agency.example', role: 'partner', agencyId: c1.id });
    check('nor under another counsellor login', bad2.status() === 404, String(bad2.status()));
    const bad3 = await make({ name: 'Staff', email: 'staff289@glovels.example', role: 'counsellor', agencyId: A });
    check('a Glovels counsellor cannot be tied to an agency', bad3.status() === 422, String(bad3.status()));

    const people = (await J(await admin.request.get(BASE + '/api/staff/people'))).people || [];
    const rowA = people.find(p => p.id === A), row1 = people.find(p => p.id === c1.id);
    check('the people list says which is the agency admin and how many counsellors it has',
      rowA && rowA.b2bRole === 'admin' && rowA.b2bCounsellors === 2, JSON.stringify(rowA && [rowA.b2bRole, rowA.b2bCounsellors]));
    check('and which agency a counsellor login belongs to', row1 && row1.b2bRole === 'counsellor' && row1.agencyId === A && /Alpha/.test(row1.agency),
      JSON.stringify(row1 && [row1.b2bRole, row1.agencyId, row1.agency]));

    /* ---- sign in: one admin, two counsellors, and another agency ---- */
    const xA = await signIn('alpha@agency.example');
    const x1 = await signIn('asha@agency.example');
    const x2 = await signIn('bala@agency.example');
    const xB = await signIn('beta@agency.example');
    const me = async x => (await J(await x.request.get(BASE + '/api/partner/me')));
    const list = async x => ((await J(await x.request.get(BASE + '/api/partner/students'))).students || []);
    check('the agency account is the admin', (await me(xA)).partner.role === 'admin' && (await me(xA)).partner.isOwner === true);
    const m1 = await me(x1);
    check('a counsellor login is a counsellor, under the agency\'s name', m1.partner.role === 'counsellor' && m1.partner.isOwner === false && /Alpha/.test(m1.partner.agency),
      JSON.stringify(m1.partner));

    /* ---- the agency cannot make logins itself ---- */
    const self = await xA.request.post(BASE + '/api/partner/team', { data: { name: 'Self Made', email: 'self@agency.example' } });
    check('the agency admin cannot create a login — Glovels does', self.status() === 403 && /account manager/.test((await J(self)).error || '') && !/Glovels/.test((await J(self)).error || ''), String(self.status()));
    const self2 = await x1.request.post(BASE + '/api/partner/team', { data: { name: 'Self Made', email: 'self2@agency.example' } });
    check('nor can a counsellor', self2.status() === 403, String(self2.status()));

    /* ---- everybody adds students ---- */
    const add = (x, rows) => x.request.post(BASE + '/api/partner/students', { data: { students: rows } });
    const stu = (n, e) => ({ name: n, email: e + '@stu.example', phone: '98765' + String(10000 + Math.floor(Math.random() * 89999)), destination: 'Germany', level: "Master's", field: 'Data Science' });
    const aAdd = await J(await add(xA, [stu('Admin One', 'adm1'), stu('Admin Two', 'adm2')]));
    const oAdd = await J(await add(x1, [stu('Asha One', 'ash1'), stu('Asha Two', 'ash2'), stu('Asha Three', 'ash3')]));
    const tAdd = await J(await add(x2, [stu('Bala One', 'bal1')]));
    const bAdd = await J(await add(xB, [stu('Beta One', 'bet1')]));
    check('the admin, both counsellors and the other agency can each add students',
      aAdd.added.length === 2 && oAdd.added.length === 3 && tAdd.added.length === 1 && bAdd.added.length === 1,
      [aAdd, oAdd, tAdd, bAdd].map(r => (r.added || []).length + '/' + (r.rejected || []).length + ' ' + JSON.stringify((r.rejected || [])[0] || '')).join(' | '));

    /* ---- who sees what ---- */
    const LA = await list(xA), L1 = await list(x1), L2 = await list(x2), LB = await list(xB);
    check('the agency admin sees every student of the agency', LA.length === 6, String(LA.length));
    check('a counsellor sees only the students they added', L1.length === 3 && L1.every(s => /^Asha/.test(s.name)), L1.map(s => s.name).join(','));
    check('the other counsellor sees only theirs', L2.length === 1 && L2[0].name === 'Bala One', L2.map(s => s.name).join(','));
    check('the other agency sees none of them', LB.length === 1 && LB[0].name === 'Beta One', LB.map(s => s.name).join(','));
    check('the counts on each login match its own list', (await me(xA)).counts.students === 6 && (await me(x1)).counts.students === 3 && (await me(x2)).counts.students === 1);
    check('the admin\'s list says who holds each student', LA.filter(s => s.heldBy && s.heldBy.id === c1.id).length === 3
      && LA.filter(s => !s.heldBy).length === 2, JSON.stringify(LA.map(s => s.heldBy && s.heldBy.name)));

    /* ---- a counsellor cannot reach a colleague's student by any door ---- */
    const bala = LA.find(s => s.name === 'Bala One'), adm = LA.find(s => s.name === 'Admin One'), asha = LA.find(s => s.name === 'Asha One');
    const doors = [
      await x1.request.get(BASE + '/api/partner/student/' + bala.id),
      await x1.request.put(BASE + '/api/partner/student/' + bala.id + '/profile', { data: { profile: { g_field: 'X' } } }),
      await x1.request.put(BASE + '/api/partner/student/' + bala.id + '/closed', { data: { closed: true } }),
      await x1.request.delete(BASE + '/api/partner/student/' + bala.id),
      await x1.request.get(BASE + '/api/partner/student/' + adm.id),
    ];
    check('open, edit, close, remove: a colleague\'s student is "no such student"', doors.every(r => r.status() === 404), doors.map(r => r.status()).join(','));
    check('and they are still there afterwards', (await list(xA)).length === 6);
    check('the admin can open any of them', (await xA.request.get(BASE + '/api/partner/student/' + bala.id)).ok());
    const dup = await J(await add(x2, [Object.assign(stu('Asha One Again', 'ash1'), {})]));
    check('adding a student a colleague already holds says it is on the agency\'s list, not whose',
      dup.added.length === 0 && /agency/.test((dup.rejected[0] || {}).why || ''), JSON.stringify(dup.rejected[0]));

    /* ---- moving: the admin's alone, and the whole record goes ---- */
    await x1.request.put(BASE + '/api/partner/student/' + asha.id + '/profile', { data: { profile: { g_field: 'Robotics', a_cgpa: '8.4' } } });
    const before = await J(await xA.request.get(BASE + '/api/partner/student/' + asha.id));
    const notAdmin = await x1.request.put(BASE + '/api/partner/students/owner', { data: { ids: [asha.id], ownerId: c2.id } });
    check('a counsellor cannot move a student', notAdmin.status() === 403, String(notAdmin.status()));
    const toOther = await xA.request.put(BASE + '/api/partner/students/owner', { data: { ids: [asha.id], ownerId: B } });
    check('nobody can move a student to another agency', toOther.status() === 404, String(toOther.status()));
    const theirs = await xA.request.put(BASE + '/api/partner/students/owner', { data: { ids: [LB[0].id], ownerId: c1.id } });
    check('nor move another agency\'s student', theirs.status() === 404, String(theirs.status()));
    const mv = await xA.request.put(BASE + '/api/partner/students/owner', { data: { ids: [asha.id], ownerId: c2.id } });
    check('the admin moves a student from one counsellor to another', mv.ok() && (await J(mv)).moved.length === 1, String(mv.status()));
    const L1b = await list(x1), L2b = await list(x2);
    check('it leaves the first counsellor\'s list', L1b.length === 2 && !L1b.some(s => s.id === asha.id), L1b.map(s => s.name).join(','));
    check('and arrives on the second\'s', L2b.length === 2 && L2b.some(s => s.id === asha.id), L2b.map(s => s.name).join(','));
    check('the first counsellor can no longer open it', (await x1.request.get(BASE + '/api/partner/student/' + asha.id)).status() === 404);
    const after = await J(await x2.request.get(BASE + '/api/partner/student/' + asha.id));
    check('the data moved with it — the same record, profile and all', after.id === before.id && after.profile.g_field === 'Robotics'
      && after.profile.a_cgpa === '8.4' && after.email === before.email, JSON.stringify(after.profile).slice(0, 120));
    const back = await xA.request.put(BASE + '/api/partner/students/owner', { data: { ids: [asha.id], ownerId: null } });
    check('the admin can take a student back', back.ok() && !(await list(xA)).find(s => s.id === asha.id).heldBy);
    const many = await xA.request.put(BASE + '/api/partner/students/owner', { data: { ids: (await list(xA)).filter(s => !s.heldBy).map(s => s.id), ownerId: c1.id } });
    check('and move several at once', many.ok() && (await J(many)).moved.length === 3 && (await list(x1)).length === 5, JSON.stringify(await J(many)).slice(0, 80));
    const team = await J(await xA.request.get(BASE + '/api/partner/team'));
    check('the team list says how many each holds, and the limit', team.max === 10 && team.counsellors === 2 && team.total === 6
      && team.team.find(t => t.id === c1.id).students === 5 && team.team.find(t => t.id === c2.id).students === 1 && team.team.find(t => t.owner).students === 0,
      JSON.stringify(team.team.map(t => t.name + ':' + t.students)));
    const t1 = await J(await x1.request.get(BASE + '/api/partner/team'));
    check('a counsellor does not see the rest of the team', t1.team.length === 1 && t1.team[0].me === true, JSON.stringify(t1.team.map(t => t.name)));

    /* ---- Glovels still sees a partner student as before ---- */
    const roster = (await J(await admin.request.get(BASE + '/api/staff/students'))).students || [];
    check('on the Glovels side every one of them is still a student of the agency', roster.filter(s => s.partner && s.partner.id === A).length === 6,
      String(roster.filter(s => s.partner && s.partner.id === A).length));

    /* ---- ten, and no more ---- */
    let made = 2, last = 0;
    for (let i = 3; i <= 11; i++) { const r = await make({ name: 'Extra ' + i, email: 'extra' + i + '@agency.example', role: 'partner', agencyId: A }); last = r.status(); if (r.ok()) made++; }
    check('an agency can have ten counsellor logins', made === 10, String(made));
    check('and the eleventh is refused', last === 409, String(last));
    check('another agency\'s limit is its own', (await make({ name: 'Beta C1', email: 'betac1@agency.example', role: 'partner', agencyId: B })).ok());

    /* ---- a counsellor login is removed: their students go back to the admin ---- */
    const noAgency = await admin.request.delete(BASE + '/api/staff/people/' + A);
    check('an agency with counsellor logins or students cannot be deleted', noAgency.status() === 409, String(noAgency.status()));
    const del = await admin.request.delete(BASE + '/api/staff/people/' + c1.id);
    check('the main admin can remove a counsellor login', del.ok(), del.status() + ' ' + JSON.stringify(await J(del)).slice(0, 100));
    const LA2 = await list(xA);
    check('no student is lost', LA2.length === 6, String(LA2.length));
    check('what they held is back with the agency admin', LA2.filter(s => !s.heldBy).length === 5 && LA2.filter(s => s.heldBy && s.heldBy.id === c2.id).length === 1,
      JSON.stringify(LA2.map(s => s.heldBy && s.heldBy.name)));
    check('and the removed login no longer opens the portal', [401, 403].includes((await x1.request.get(BASE + '/api/partner/students')).status()));

    /* ---- the agency admin's screen ---- */
    const pg = await xA.newPage();
    const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|404/.test(m.text())) errs.push(m.text()); });
    await pg.setViewportSize({ width: 1300, height: 950 });
    await pg.goto(BASE + '/partner.html'); await pg.waitForTimeout(2500);
    check('the admin\'s screen says Admin', /Admin/.test(await pg.textContent('#staffRole')), await pg.textContent('#staffRole'));
    check('it shows the counsellors and the limit', !(await pg.$eval('#b2bTeam', el => el.hidden)) && /of 10/.test(await pg.textContent('#b2bCount')), await pg.textContent('#b2bCount'));
    const chips = await pg.textContent('#b2bChips');
    check('with how many students each holds', /Everyone6/.test(chips.replace(/\s+/g, '')) && /Bala \(Alpha\)\s*1/.test(chips), chips.replace(/\s+/g, ' ').slice(0, 160));
    check('each row says who holds the student', (await pg.$$('#stuRows .heldby')).length === 6);
    await pg.click('#b2bChips [data-held="' + c2.id + '"]'); await pg.waitForTimeout(400);
    check('a counsellor\'s chip narrows the list to their students', (await pg.$$('#stuRows tr.prow')).length === 1 && /Bala One/.test(await pg.textContent('#stuRows')),
      (await pg.textContent('#stuRows')).slice(0, 80));
    await pg.click('#b2bChips [data-held=""]'); await pg.waitForTimeout(300);
    await pg.screenshot({ path: '/tmp/b2b-admin.png' });
    /* move everything the admin holds to Bala, from the card */
    await pg.selectOption('#b2bFrom', '0'); await pg.selectOption('#b2bTo', String(c2.id));
    await pg.click('#b2bMoveAll'); await pg.waitForTimeout(1500);
    check('"Move every student held by … to …" moves them', (await list(x2)).length === 6, String((await list(x2)).length));
    /* and one back, from the opened student */
    await pg.click('#stuRows tr.prow'); await pg.waitForTimeout(1200);
    const sel = await pg.$('#heldSel');
    check('an opened student has a "Held by" control', !!sel);
    if (sel) {
      const sidOpen = Number(await sel.getAttribute('data-student'));
      await pg.selectOption('#heldSel', '0'); await pg.click('#heldSave'); await pg.waitForTimeout(1200);
      check('changing it moves that one student', !(await list(xA)).find(s => s.id === sidOpen).heldBy && (await list(x2)).length === 5);
    }
    check('the agency\'s screen still never says our name (white label)', !/glovels/i.test(await pg.evaluate(() => document.querySelector('#b2bTeam').innerText)));
    check('the admin\'s screen has no script errors', errs.length === 0, errs.join(' | '));

    /* ---- a counsellor's screen ---- */
    const pc = await x2.newPage();
    const errs2 = []; pc.on('pageerror', e => errs2.push(String(e)));
    await pc.goto(BASE + '/partner.html'); await pc.waitForTimeout(2500);
    check('a counsellor\'s screen says Counsellor', /Counsellor/.test(await pc.textContent('#staffRole')), await pc.textContent('#staffRole'));
    check('with no team card and no move control', await pc.$eval('#b2bTeam', el => el.hidden) && !(await pc.$('#stuRows .heldby')));
    check('and only their own students', (await pc.$$('#stuRows tr.prow')).length === 5 && Number(await pc.textContent('#kStudents')) === 5,
      (await pc.$$('#stuRows tr.prow')).length + ' / ' + (await pc.textContent('#kStudents')));
    check('the counsellor\'s screen has no script errors', errs2.length === 0, errs2.join(' | '));

    /* ---- the main admin's screen ---- */
    const org = await admin.newPage();
    const errs3 = []; org.on('pageerror', e => errs3.push(String(e)));
    await org.goto(BASE + '/admin.html#users'); await org.waitForTimeout(2500);
    const opt = await org.$('#pRole option[value="partner-sub"]');
    check('the Add someone panel offers "B2B counsellor"', !!opt);
    await org.evaluate(() => { const s = document.querySelector('#pRole'); s.value = 'partner-sub'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await org.waitForTimeout(300);
    const ag = await org.$$eval('#pAgency option', a => a.map(o => o.textContent + (o.disabled ? ' [full]' : '')));
    check('and asks which agency, saying how many logins each has', ag.some(t => /Alpha Overseas/.test(t) && /9 of 10/.test(t)) && ag.some(t => /Beta Education/.test(t) && /1 of 10/.test(t)),
      ag.join(' | '));
    check('only agencies are offered, not counsellor logins', !ag.some(t => /Bala|Extra/.test(t)), ag.join(' | '));
    const body = await org.textContent('body');
    check('the team list labels a B2B counsellor with its agency', /B2B counsellor · Alpha Overseas/.test(body));
    check('the main admin\'s screen has no script errors', errs3.length === 0, errs3.join(' | '));
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { await browser.close(); } catch (e) {}
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\nb2bteamtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
