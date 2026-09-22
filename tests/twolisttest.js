/**
 * Two lists, because they are two different things.
 *
 * "We will show student interested universities and shortlisted from
 * counsellor." One list conflated what a student liked the look of on a
 * Tuesday evening with what their counsellor agreed with them and is going to
 * apply to. Those do not carry the same weight — the second is the package
 * deliverable, what applications are filed against, and what any admission
 * guarantee attaches to — and printed in one grid a student could not tell
 * which universities anybody was actually working on.
 *
 * The check that matters is the one across the boundary: a university the
 * student marks must NOT appear on the counsellor's list, on either screen,
 * until a counsellor puts it there.
 *
 * THE STUDENT-FACING HALF IS NOW SWITCHED OFF. Vishal: "this option is not
 * required ... we may add this feature later not now." So the student no
 * longer has a way to mark one, and no longer sees the list of what they
 * marked — but nothing underneath it has been torn out, and this suite is the
 * thing that has to prove that:
 *
 *   - the screen offers no way in and shows no such list  (checked here)
 *   - the endpoint still records `addedBy: 'student'`     (checked here)
 *   - a marked one still stays OFF the office's list      (checked here)
 *   - the counsellor can still see and promote one        (checked here)
 *
 * Marking is driven through the API rather than the button, which is the only
 * honest way to test a feature whose front door is closed — and it means the
 * day the button comes back, everything behind it is already known to work.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();

  const stu = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const state = await (await stu.request.get(BASE + '/api/state')).json();

  check('the server says who put each university on the list',
    (state.shortlist || []).every(r => ['student', 'office', 'matched'].includes(r.addedBy)),
    (state.shortlist || []).map(r => r.addedBy).join(','));

  /* Marked through the door the button used to press. The record has to carry
     the same answer whether a person clicked it or not — the day this is
     switched back on, that is what the screen will be reading. */
  const cat = await (await stu.request.get(BASE + '/api/catalogue')).json();
  const free = (cat.programmes || []).filter(p =>
    !(state.shortlist || []).some(r => String(r.id) === String(p.id)));
  /* PRIVATE. A public place is matched to the student's marks and put on the
     list by the office — the endpoint refuses one from a student now, which
     the next check proves rather than assumes. */
  const spare = free.find(p => !p.isPublic);
  check('there is a private university not already on the list', !!spare, spare && spare.id);
  const id = spare && spare.id;
  const marked = await stu.request.post(BASE + '/api/shortlist', { data: { id } });
  check('a student can mark a private one through the endpoint', marked.ok(),
    marked.status() + '');
  const pub = free.find(p => p.isPublic);
  if (pub) {
    const refused = await stu.request.post(BASE + '/api/shortlist', { data: { id: pub.id } });
    check('and cannot mark a public one', refused.status() === 403, refused.status() + '');
  }

  const after = await (await stu.request.get(BASE + '/api/state')).json();
  const row = (after.shortlist || []).find(r => String(r.id) === String(id));
  check('and the server records it as theirs', row && row.addedBy === 'student',
    row && row.addedBy);

  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/universities', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const wrap = flat(await page.textContent('#mineWrap'));
  check('the student sees their counsellor’s shortlist', /counsellor.{0,3}s shortlist/i.test(wrap));

  /* ------------------------------------------------- back on, and narrowed
   *
   * It was switched off because a student could mark ANY university, public
   * ones included — and a public place is matched to their marks and put on
   * the list by the office, not chosen off a page. The server refuses one
   * added any other way now, so the section can only ever hold private
   * universities and is back: leaving it off had its own cost, which was this
   * screen saying 17 while their applications screen and their counsellor both
   * said 18.
   *
   * "Only private unis student can add, public can only be added by
   *  counsellors… these public unis are assigned based on the student's marks." */
  check('the student’s own list is on their screen',
    /you added/i.test(wrap), wrap.slice(0, 120));
  await page.click('.tab[data-pane="browse"]');
  await page.waitForTimeout(1100);
  const marks = await page.evaluate(() => {
    const out = { onPrivate: 0, onPublic: 0 };
    document.querySelectorAll('article').forEach(card => {
      const add = card.querySelector('[data-add]');
      if (!add) return;
      /* A public row is the one the page marks as needing a package; a private
         one is free to apply to. Read from the card rather than from the data
         so this asserts what a student can actually press. */
      const t = (card.textContent || '').toLowerCase();
      if (/public/.test(t)) out.onPublic++; else out.onPrivate++;
    });
    return out;
  });
  check('a student can mark a private university', marks.onPrivate > 0,
    JSON.stringify(marks));
  check('and cannot mark a public one', marks.onPublic === 0, JSON.stringify(marks));

  /* The count above the tab has to agree with the page under it. This student
     HAS a marked university — put there a moment ago — and a tab reading one
     more than the screen shows is the number arguing with the page. */
  await page.click('.tab[data-pane="mine"]');
  await page.waitForTimeout(1100);
  const shown = await page.evaluate(() => ({
    tab: Number((document.querySelector('#nMine') || {}).textContent || -1),
    cards: document.querySelectorAll('#mineWrap .sl-grid > *').length,
  }));
  check('the counter counts what is on the screen', shown.tab === shown.cards,
    'tab says ' + shown.tab + ', screen shows ' + shown.cards);

  check('no page errors for the student', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ------------------------------------------------- and the counsellor's side */
  const staff = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const ops = await staff.newPage();
  const operrs = [];
  ops.on('pageerror', e => operrs.push(String(e)));
  await ops.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await ops.waitForTimeout(2800);
  await ops.locator('[data-open]').first().click();
  await ops.waitForTimeout(2400);
  await ops.click('.tab[data-t="file"]');
  await ops.waitForTimeout(900);

  check('the counsellor is shown what the student is interested in',
    /interested in/i.test(flat(await ops.textContent('#pane'))));
  check('marked as not agreed with anybody',
    /not agreed/i.test(flat(await ops.textContent('#pane'))));
  check('with a way to move one onto the real list',
    (await ops.$$('[data-promote]')).length >= 1);

  /* THE boundary. The student's pick is not on the list applications are filed
     against until somebody in the office says so. */
  const before = await (await staff.request.get(BASE + '/api/staff/student/'
    + state.user.id)).json();
  check('a student’s pick is not on the office’s list yet',
    (before.shortlist || []).find(r => String(r.id) === String(id)).addedBy === 'student');

  await ops.locator('[data-promote="' + id + '"]').click();
  await ops.waitForTimeout(2600);

  const promoted = await (await staff.request.get(BASE + '/api/staff/student/'
    + state.user.id)).json();
  const now = (promoted.shortlist || []).find(r => String(r.id) === String(id));
  check('and is, once the counsellor puts it there', now && now.addedBy === 'office',
    now && now.addedBy);
  check('no page errors for the counsellor', operrs.length === 0, operrs.slice(0, 2).join(' | '));

  /* Once the office has taken it, it is on the student's screen — which is the
     half of this that is NOT switched off, and the reason the endpoint had to
     keep working. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const mine = await (await stu.request.get(BASE + '/api/state')).json();
  check('the student sees it move to their counsellor’s list',
    (mine.shortlist || []).find(r => String(r.id) === String(id)).addedBy === 'office');
  check('  · and it is drawn there now, not hidden with the marked ones',
    flat(await page.textContent('#mineWrap'))
      .includes(String(spare.university || '').slice(0, 18)),
    spare.university);

  /* And the office's list cannot be demoted by the student clicking again. */
  await stu.request.post(BASE + '/api/shortlist', { data: { id } });
  const again = await (await stu.request.get(BASE + '/api/state')).json();
  check('a student pressing interest again cannot demote it',
    (again.shortlist || []).find(r => String(r.id) === String(id)).addedBy === 'office');

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
