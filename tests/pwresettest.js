/**
 * An administrator resetting a student's password.
 *
 * The endpoint existed the whole time. It was reachable only from the staff
 * list — and /api/staff/people returns counsellors, editors and admins, never
 * students. So the office had exactly one way to help a student who could not
 * get in: "Send sign-in link", which needs a working inbox, and there is no
 * SMTP configured yet. In practice that meant no way at all.
 *
 * Two places now: the Every student roster, where the office is looking when
 * somebody rings up, and the student's own file. What the tests care about is
 * not that a button exists but that the new password actually signs them in,
 * that the old one stops working, and that nobody but an admin can do it.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();

  const admin = await browser.newContext({ viewport: { width: 1700, height: 1060 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const made = await (await admin.request.post(BASE + '/api/staff/people', {
    data: { name: 'Locked Out ' + stamp, email: 'locked' + stamp + '@example.com',
      role: 'student' },
  })).json();

  /* They set a password of their own, so the reset has something real to
     invalidate rather than an already-temporary one. */
  const them = await browser.newContext();
  await them.request.post(BASE + '/api/auth/login',
    { data: { email: made.person.email, password: made.password } });
  await them.request.post(BASE + '/api/auth/change',
    { data: { current: made.password, password: 'the-one-they-forgot' } });
  check('the student has a password of their own to begin with',
    (await them.request.get(BASE + '/api/state')).ok());

  /* ------------------------------------------------- the office does it */
  const page = await admin.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', async d => { await d.accept(); });
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const row = page.locator('tr', { hasText: 'Locked Out ' + stamp });
  check('the student is on the roster', await row.count() >= 1);
  check('with a way to reset their password',
    await row.locator('[data-pwreset]').count() >= 1);

  await row.locator('[data-pwreset]').first().click();
  await page.waitForTimeout(2400);

  const note = await row.locator('[data-pw-note]').textContent().catch(() => '');
  check('and it says whether anything was emailed', /Emailed to|not connected/.test(note),
    (note || '').replace(/\s+/g, ' ').slice(0, 80));
  const fresh = await row.locator('[data-pw-note] input').first().inputValue();
  check('the new password is on the screen to read out', !!fresh && fresh.length > 6, fresh);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ------------------------------------------------ and it actually works */
  const old = await browser.newContext();
  const oldTry = await old.request.post(BASE + '/api/auth/login',
    { data: { email: made.person.email, password: 'the-one-they-forgot' } });
  check('the password they forgot no longer works', oldTry.status() === 401, oldTry.status());

  const back = await browser.newContext();
  const newTry = await back.request.post(BASE + '/api/auth/login',
    { data: { email: made.person.email, password: fresh } });
  check('the new one signs them in', newTry.ok(), newTry.status());

  /* A password somebody else chose is not private, so it cannot stay. */
  const gated = await back.request.get(BASE + '/api/state');
  check('and the portal holds them at "choose your own" first',
    gated.status() === 403, gated.status());
  check('saying so, rather than failing blankly',
    !!(await gated.json().catch(() => ({}))).mustChange);

  await back.request.post(BASE + '/api/auth/change',
    { data: { current: fresh, password: 'a-password-only-they-know' } });
  check('and lets them in once they have chosen',
    (await back.request.get(BASE + '/api/state')).ok());

  /* The session they had open before the reset is gone. */
  check('every session open at the time was signed out',
    (await them.request.get(BASE + '/api/state')).status() === 401,
    (await them.request.get(BASE + '/api/state')).status());

  /* ------------------------------------------------------- who may do it */
  const c = await browser.newContext();
  await c.request.post(BASE + '/api/auth/login',
    { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
  const byCounsellor = await c.request.post(
    BASE + '/api/staff/people/' + made.person.id + '/password');
  check('a counsellor cannot reset anybody’s password',
    byCounsellor.status() === 403, byCounsellor.status());

  const byStudent = await back.request.post(
    BASE + '/api/staff/people/' + made.person.id + '/password');
  check('nor can the student themselves', byStudent.status() === 403, byStudent.status());

  /* The counsellor screen shows it to an admin and not to a counsellor. */
  const cp = await c.newPage();
  await cp.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await cp.waitForTimeout(2600);
  await cp.locator('[data-open]').first().click();
  await cp.waitForTimeout(2200);
  check('and a counsellor is not shown the button on a student’s file',
    !(await cp.isVisible('#pwReset')));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
