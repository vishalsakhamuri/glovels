/**
 * Scholarships — what this student can actually get.
 *
 * "Show when scholarships are available for the student."
 *
 * The screen shipped with the wrong answer for the commonest case. A student
 * with an empty profile saw "Ones you qualify for 12" beside "All scholarships
 * 12" — the same number twice, which is how you can tell a filter is not
 * filtering — and twelve cards each stamped CHECK WITH A COUNSELLOR. The
 * screen was checking nothing and said so twelve times without once saying
 * why.
 *
 * Two causes, both worth a test. The fit list was `verdict(s).ok !== false`,
 * so every unknown counted as a pass; and a deadline that had gone by did not
 * take a scholarship out of anything, so an award nobody could enter was still
 * being offered as an opportunity.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  /* ------------------------------------------- a student who has filled nothing in */
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const made = await (await admin.request.post(BASE + '/api/staff/people', {
    data: { name: 'Blank Profile ' + stamp, email: 'blank' + stamp + '@example.com',
      role: 'student' },
  })).json();

  const blank = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await blank.request.post(BASE + '/api/auth/login',
    { data: { email: made.person.email, password: made.password } });
  await blank.request.post(BASE + '/api/auth/change',
    { data: { current: made.password, password: 'a-password-of-their-own' } });

  const p = await blank.newPage();
  p.on('pageerror', e => errs.push('blank: ' + e));
  await p.goto(BASE + '/scholarships', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);

  const line = flat(await p.textContent('#fitLine'));
  check('with an empty profile the screen says it cannot check yet',
    /cannot check/i.test(line), line.slice(0, 70));
  check('and names the fields it is missing',
    /CGPA/.test(line) && /destination/.test(line), line.slice(0, 110));

  check('"ones you qualify for" is not offered when nothing can be judged',
    await p.locator('#tabFit').isHidden());

  const grid = flat(await p.textContent('#schGrid'));
  check('and no card carries a shrug where a verdict should be',
    !/Check with a counsellor/.test(grid));
  check('the cards are still there to read',
    (await p.$$('#schGrid article')).length >= 5,
    (await p.$$('#schGrid article')).length + ' cards');
  check('opening on what is open, rather than on a claim it cannot make',
    (await p.locator('.tab[data-f="all"]').getAttribute('aria-selected')) === 'true');

  /* -------------------------------------------- a student who has filled it in */
  const stu = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const q = await stu.newPage();
  q.on('pageerror', e => errs.push('student: ' + e));
  await q.goto(BASE + '/scholarships', { waitUntil: 'domcontentloaded' });
  await q.waitForTimeout(2800);

  check('a filled profile gets the tab back', await q.locator('#tabFit').isVisible());
  const fit = Number(await q.textContent('#nFit'));
  const open = Number(await q.textContent('#nAll'));
  check('and it says what they were matched on',
    /Matched against a CGPA/.test(flat(await q.textContent('#fitLine'))),
    flat(await q.textContent('#fitLine')).slice(0, 80));

  /* THE check. Equal counts is the signature of a filter that is not one. */
  check('"ones you qualify for" is fewer than everything open',
    fit > 0 && fit < open, fit + ' of ' + open);

  await q.click('.tab[data-f="fit"]');
  await q.waitForTimeout(700);
  const fitGrid = flat(await q.textContent('#schGrid'));
  check('every card in it says they qualify',
    !/Not yet/.test(fitGrid), fitGrid.slice(0, 90));
  check('and none of them says check with a counsellor',
    !/Check with a counsellor/.test(fitGrid));

  /* Closed awards are not opportunities. */
  const closed = Number(await q.textContent('#nClosed'));
  check('closed ones are counted separately', Number.isFinite(closed), closed);
  await q.click('.tab[data-f="all"]');
  await q.waitForTimeout(700);
  check('and are not mixed into what is open',
    !/Closed for this cycle/.test(flat(await q.textContent('#schGrid'))));

  const soon = flat(await q.textContent('#soonList'));
  check('nothing in "closing soon" has already closed', !/-\d+ days/.test(soon),
    soon.slice(0, 70));

  /* Saving one still works and reaches the server. */
  await q.locator('[data-save]').first().click();
  await q.waitForTimeout(1800);
  const state = await (await stu.request.get(BASE + '/api/state')).json();
  check('saving one records it against the account',
    (state.saved || []).length >= 1, JSON.stringify(state.saved));

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
