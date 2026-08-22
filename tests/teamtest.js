/**
 * Can an admin build a team on a live site?
 *
 * This is the gap a production launch opens: SEED_DEMO is off, so there are no
 * demo accounts, and until now the only way to create a counsellor was to edit
 * the database by hand. The test runs against a server started the way the host
 * starts it — production mode, no seed — and checks the whole path: create a
 * counsellor, sign in as them, be assigned a student, and be refused the things
 * a counsellor may not do.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8095';
const ADMIN_PW = 'a-long-admin-password-9f2c';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const li = await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'boss@glovels.com', password: ADMIN_PW } });
  check('the admin from the environment can sign in', li.ok(), li.status());

  const before = await (await ctx.request.get(BASE + '/api/staff/people')).json();
  check('a fresh production site has exactly one person', before.people.length === 1,
    before.people.map(p => p.role).join(','));

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));
  page.on('dialog', d => d.accept());

  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#counsellors li', { timeout: 15000 });
  check('the team list shows the admin', (await page.textContent('#counsellors')).includes('boss@glovels.com'));
  check('there is an Add someone button', await page.isVisible('#addPerson'));

  /* ------------------------------------------------- create a counsellor */
  await page.click('#addPerson');
  await page.waitForSelector('#pName');
  await page.fill('#pName', 'Kavya Reddy');
  await page.fill('#pEmail', 'kavya@glovels.com');
  await page.fill('#pPhone', '9876543210');
  await page.selectOption('#pRole', 'counsellor');
  await page.click('#pSave');
  await page.waitForSelector('#pDone code', { timeout: 10000 });

  const password = (await page.textContent('#pDone code')).trim();
  check('a password is shown once', password.length >= 10, password.length + ' characters');
  check('the panel says it cannot be shown again',
    /only time it can be shown/i.test(await page.textContent('#pDone')));

  await page.click('#personModal [data-close]');
  await page.waitForTimeout(500);
  check('the new counsellor is in the list',
    (await page.textContent('#counsellors')).includes('Kavya Reddy'));

  /* ---------------------------------------- that password actually works */
  const kavya = await browser.newContext();
  const kl = await kavya.request.post(BASE + '/api/auth/login',
    { data: { email: 'kavya@glovels.com', password } });
  check('the new counsellor can sign in with it', kl.ok(), kl.status());
  const kme = await (await kavya.request.get(BASE + '/api/staff/me')).json();
  check('and lands as a counsellor', kme.user && kme.user.role === 'counsellor',
    kme.user && kme.user.role);

  const denied = await kavya.request.get(BASE + '/api/staff/overview');
  check('a counsellor cannot open the admin overview', denied.status() === 403, denied.status());
  const deniedPeople = await kavya.request.post(BASE + '/api/staff/people',
    { data: { name: 'Sneaky', email: 'sneaky@glovels.com', role: 'admin' } });
  check('a counsellor cannot create an admin', deniedPeople.status() === 403, deniedPeople.status());

  /* ------------------------------------------- a student, and assignment */
  /* In its own context. Signing up sets a session cookie, and doing it in the
     admin's context quietly replaces the admin session with the student's —
     after which every staff call in the rest of the test is a 403 for a reason
     that has nothing to do with what is being tested. */
  const studentCtx = await browser.newContext();
  await studentCtx.request.post(BASE + '/api/auth/signup', {
    data: { name: 'Test Student', email: 'stu@example.com', phone: '9876500000',
      password: 'student-password-1' },
  });
  const students = await (await ctx.request.get(BASE + '/api/staff/students')).json();
  const stu = students.students.find(s => s.email === 'stu@example.com');
  check('the student appears to the admin', !!stu);

  const kavyaId = (await (await ctx.request.get(BASE + '/api/staff/people')).json())
    .people.find(p => p.email === 'kavya@glovels.com').id;

  const blocked = await kavya.request.get(BASE + '/api/staff/student/' + stu.id);
  check('before assignment the counsellor cannot open that student',
    blocked.status() >= 400, blocked.status());

  await ctx.request.put(BASE + '/api/staff/student/' + stu.id + '/counsellor',
    { data: { counsellorId: kavyaId } });
  const allowed = await kavya.request.get(BASE + '/api/staff/student/' + stu.id);
  check('after assignment the counsellor can open that student', allowed.ok(), allowed.status());

  /* ---------------------------------------------------- resetting a password */
  const reset = await (await ctx.request.post(BASE + '/api/staff/people/' + kavyaId + '/password')).json();
  check('a reset returns a new password', reset.password && reset.password !== password);
  const oldPw = await browser.newContext();
  check('the old password stops working',
    !(await oldPw.request.post(BASE + '/api/auth/login',
      { data: { email: 'kavya@glovels.com', password } })).ok());
  check('the session it had is dead',
    !(await kavya.request.get(BASE + '/api/staff/me')).ok());
  check('the new password works',
    (await oldPw.request.post(BASE + '/api/auth/login',
      { data: { email: 'kavya@glovels.com', password: reset.password } })).ok());

  /* ---------------------------------------- an editor sees the site only */
  const ed = await ctx.request.post(BASE + '/api/staff/people', {
    data: { name: 'Priya Copy', email: 'priya@glovels.com', role: 'editor',
      perms: ['content'] },
  });
  check('an editor account can be created', ed.ok(), ed.status());
  const edPw = (await ed.json()).password;

  const editor = await browser.newContext();
  const edLogin = await editor.request.post(BASE + '/api/auth/login',
    { data: { email: 'priya@glovels.com', password: edPw } });
  check('the editor can sign in', edLogin.ok(), edLogin.status());
  const edMe = await (await editor.request.get(BASE + '/api/staff/me')).json();
  check('the editor is an editor with the content permission',
    edMe.user.role === 'editor' && edMe.user.perms.join() === 'content',
    edMe.user.role + ':' + (edMe.user.perms || []).join());

  check('an editor cannot list students',
    (await editor.request.get(BASE + '/api/staff/students')).status() === 403);
  check('an editor cannot open a student record',
    (await editor.request.get(BASE + '/api/staff/student/' + stu.id)).status() === 403);
  check('an editor cannot message a student',
    (await editor.request.post(BASE + '/api/staff/student/' + stu.id + '/message',
      { data: { text: 'hello' } })).status() === 403);
  check('an editor cannot add people',
    (await editor.request.post(BASE + '/api/staff/people',
      { data: { name: 'x', email: 'x@y.com' } })).status() === 403);

  const content = await (await editor.request.get(BASE + '/api/staff/content')).json();
  const edSave = await editor.request.put(BASE + '/api/staff/content/stats',
    { data: { value: [{ num: '1,234', label: 'edited by the editor' }] } });
  check('an editor CAN change the home page', edSave.ok(), edSave.status());

  check('an editor without the catalogue permission cannot add a university',
    (await editor.request.put(BASE + '/api/staff/programme',
      { data: { program: 'X', university: 'Y', country: 'DE' } })).status() === 403);

  /* Give it to them, and the same request works. */
  const edId = (await (await ctx.request.get(BASE + '/api/staff/people')).json())
    .people.find(p => p.email === 'priya@glovels.com').id;
  await ctx.request.put(BASE + '/api/staff/people/' + edId + '/perms',
    { data: { perms: ['content', 'catalogue'] } });
  check('once given, the same request is allowed',
    (await editor.request.put(BASE + '/api/staff/programme',
      { data: { program: 'MSc Test', university: 'Test University', country: 'DE' } })).ok());

  /* And taking it away takes it away. */
  await ctx.request.put(BASE + '/api/staff/people/' + edId + '/perms',
    { data: { perms: [] } });
  check('taking the permission away stops them again',
    (await editor.request.put(BASE + '/api/staff/content/stats',
      { data: { value: [{ num: '9', label: 'nope' }] } })).status() === 403);

  /* --------------------------- a counsellor has neither permission by default */
  const kav2 = await browser.newContext();
  await kav2.request.post(BASE + '/api/auth/login',
    { data: { email: 'kavya@glovels.com', password: reset.password } });
  check('a plain counsellor cannot change the home page',
    (await kav2.request.put(BASE + '/api/staff/content/stats',
      { data: { value: [{ num: '1', label: 'no' }] } })).status() === 403);
  check('a plain counsellor cannot add a university',
    (await kav2.request.put(BASE + '/api/staff/programme',
      { data: { program: 'X', university: 'Y', country: 'DE' } })).status() === 403);

  /* -------------------------------------------------- the last admin rule */
  const meId = before.people[0].id;
  const selfDemote = await ctx.request.put(BASE + '/api/staff/people/' + meId + '/role',
    { data: { role: 'counsellor' } });
  check('an admin cannot demote themselves', selfDemote.status() === 409,
    selfDemote.status() + ' ' + JSON.stringify(await selfDemote.json()).slice(0, 90));

  /* Promote Kavya, then the rule about the last admin no longer applies to
     the original — which is exactly the sequence a real handover follows. */
  await ctx.request.put(BASE + '/api/staff/people/' + kavyaId + '/role', { data: { role: 'admin' } });
  const nowTwo = await (await ctx.request.get(BASE + '/api/staff/people')).json();
  check('there are two admins now',
    nowTwo.people.filter(p => p.role === 'admin').length === 2,
    nowTwo.people.map(p => p.role).join(','));

  const duplicate = await ctx.request.post(BASE + '/api/staff/people',
    { data: { name: 'Again', email: 'kavya@glovels.com', role: 'counsellor' } });
  check('a duplicate email is refused', duplicate.status() === 409, duplicate.status());

  const badEmail = await ctx.request.post(BASE + '/api/staff/people',
    { data: { name: 'X', email: 'not-an-email', role: 'counsellor' } });
  check('an invalid email is refused', badEmail.status() === 422, badEmail.status());

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
