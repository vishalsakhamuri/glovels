/**
 * The counsellor card, on the screen a student opens every morning.
 *
 * It asked whether they had paid, not who their counsellor is. Unpaid got
 * "Not assigned yet"; everybody else got "Assigned after your call" — a
 * sentence that stayed on the screen forever, because nothing ever changed it.
 * A student with a named counsellor she had been messaging for a week still
 * read "Assigned after your call".
 *
 * /api/state has carried `counsellor: {name, id}` since the portal was built.
 * The card simply never read it, which is why the bug was invisible to every
 * API test: the data was right the whole time.
 *
 * So the check has to be on the rendered card, and it has to cover the change
 * — unassigned, then assigned, on the same student. A test that only looks at
 * a seeded student who already has a counsellor would have passed against the
 * broken version, because "Assigned after your call" and a real name are both
 * plausible-looking text in a card.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();

  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const made = await (await admin.request.post(BASE + '/api/staff/people', {
    data: { name: 'Venkat Rao', email: 'venkat' + stamp + '@example.com', role: 'student' },
  })).json();

  const stu = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: made.person.email, password: made.password } });
  await stu.request.post(BASE + '/api/auth/change',
    { data: { current: made.password, password: 'a-password-of-their-own' } });

  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);

  /* ------------------------------------------------- nobody looking after them */
  const before = flat(await page.textContent('#couns'));
  check('a student with no counsellor is told so',
    /Not assigned yet|Assigned after/.test(before), before);
  check('and no name is invented for them',
    !/Kavya|Menon/.test(before), before);
  check('the avatar is a dash rather than initials of nobody',
    flat(await page.textContent('#couns .c-av')) === '—',
    flat(await page.textContent('#couns .c-av')));

  /* ------------------------------------------------------ the office assigns one */
  const cs = await (await admin.request.get(BASE + '/api/staff/overview')).json();
  const kavya = (cs.counsellors || []).find(c => /Kavya/.test(c.name))
    || (cs.counsellors || [])[0];
  check('there is a counsellor to assign', !!kavya,
    JSON.stringify((cs.counsellors || []).map(c => c.name)));

  const put = await admin.request.put(
    BASE + '/api/staff/student/' + made.person.id + '/counsellor',
    { data: { counsellorId: kavya.id } });
  check('the office can assign one', put.status() === 200, put.status());

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);

  /* THE check. Same student, same screen, one assignment apart. */
  const after = flat(await page.textContent('#couns'));
  check('and the student sees who it is, by name',
    after.includes(kavya.name), after);
  check('not "assigned after your call" forever',
    !/Assigned after your call/.test(after), after);
  check('with their initials, and no "undefined" in them',
    /^[A-Z]{1,2}$/.test(flat(await page.textContent('#couns .c-av'))),
    flat(await page.textContent('#couns .c-av')));
  check('and a way to message them', await page.isVisible('#couns a[href*="messages"]'));

  /* The server agrees — the card is reading, not guessing. */
  const state = await (await stu.request.get(BASE + '/api/state')).json();
  check('the card matches what the server says',
    state.counsellor && state.counsellor.name === kavya.name,
    JSON.stringify(state.counsellor));

  /* And unassigning puts it back, rather than leaving a stale name on a screen
     the student reads every day. */
  await admin.request.put(BASE + '/api/staff/student/' + made.person.id + '/counsellor',
    { data: { counsellorId: null } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  check('taking them off the file clears the name too',
    !flat(await page.textContent('#couns')).includes(kavya.name),
    flat(await page.textContent('#couns')));

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
