/**
 * The Organisation screen — the counters, and making a student.
 *
 * The counters were plain numbers. Somebody looking at "1 ENQUIRIES" tried to
 * click it, nothing happened, and reported the screen as broken — which is the
 * right reaction to a figure that leads nowhere. These checks press each one
 * and assert it lands somewhere useful.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const names = page => page.$$eval('#rows tr',
  rs => rs.map(r => r.innerText.split('\n')[0].trim()));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.otabs', { timeout: 15000 });

  /* ------------------------------------------------- make a student here */
  /* Patch 277: the team and its Add someone button are on the Users screen. */
  await page.evaluate(() => { location.hash = 'users'; });
  await page.waitForTimeout(400);
  await page.click('#addPerson');
  await page.waitForSelector('#pRole');
  await page.selectOption('#pRole', 'student');
  await page.waitForTimeout(300);
  check('the student option explains itself',
    await page.isVisible('#pStudentNote'));
  check('and the website-permission boxes are out of the way',
    !(await page.isVisible('#pPermBox')));

  await page.fill('#pName', 'Walk In Student');
  await page.fill('#pEmail', 'walkin@glovels.com');
  await page.click('#pSave');
  await page.waitForSelector('#pDone code', { timeout: 10000 });
  const password = (await page.textContent('#pDone code')).trim();
  check('a password is shown once', password.length >= 8, password.length + ' characters');

  const signIn = await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'walkin@glovels.com', password } });
  const who = await signIn.json();
  check('the account really signs in', signIn.ok(), signIn.status());
  check('and it is a student, not staff', who.user && who.user.role === 'student',
    who.user && who.user.role);

  /* Signing in as them replaced the session cookie on this context. */
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  /* Patch 327: the student list is the Students page; Organisation no longer
     repeats it (nor the counters, which Command centre and Students show). */
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('Organisation has no student table or counters of its own',
    !(await page.isVisible('#rows')) && !(await page.isVisible('#kTiles')));

  await page.goto(BASE + '/ops.html#students', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stuRows tr[data-stu]', { timeout: 15000 });
  const stuNames = () => page.$$eval('#stuRows tr[data-stu] td:first-child b', e => e.map(x => x.textContent.trim()));
  const all = await stuNames();
  check('they appear on the Students page', all.some(n => /Walk In Student/.test(n)), all.join(' | '));
  await page.selectOption('#stuCoun', '0');
  await page.waitForTimeout(500);
  const loose = await stuNames();
  check('Nobody assigned narrows the list to them', loose.length < all.length && loose.some(n => /Walk In Student/.test(n)),
    all.length + ' -> ' + loose.join(' | '));
  check('and an admin can pick their counsellor right there',
    (await page.$$('#stuRows tr:has-text("Walk In Student") select[data-scoun]')).length === 1);
  await page.selectOption('#stuCoun', '');
  await page.selectOption('#stuOpen', '1');
  await page.waitForTimeout(1200);
  check('closed files can be listed too, to reopen one',
    !(await stuNames()).some(n => /Walk In Student/.test(n)));

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
