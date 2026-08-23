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
    (state.shortlist || []).every(r => r.addedBy === 'student' || r.addedBy === 'office'),
    (state.shortlist || []).map(r => r.addedBy).join(','));
  check('and there are some of each to tell apart',
    (state.shortlist || []).some(r => r.addedBy === 'office')
    && (state.shortlist || []).some(r => r.addedBy === 'student'));

  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/universities', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const wrap = flat(await page.textContent('#mineWrap'));
  check('the student sees their counsellor’s shortlist', /counsellor.{0,3}s shortlist/i.test(wrap));
  check('and, separately, what they are interested in', /interested in/i.test(wrap));
  check('the counsellor’s list comes first, because it is the answer to '
    + '"what is happening with my application"',
    wrap.search(/counsellor.{0,3}s shortlist/i) < wrap.search(/interested in/i));

  /* Marking interest must not put it on the office's list. */
  await page.click('.tab[data-pane="browse"]');
  await page.waitForTimeout(900);
  const btn = page.locator('[data-add]').first();
  check('browsing offers interest, not a shortlist place',
    /interested/i.test(await btn.textContent()), await btn.textContent());
  const id = await btn.getAttribute('data-add');
  await btn.click();
  await page.waitForTimeout(2400);

  await page.click('.tab[data-pane="mine"]');
  await page.waitForTimeout(900);
  const sections = await page.evaluate(() => {
    const h = [...document.querySelectorAll('#mineWrap h3')];
    return h.map(x => {
      const cards = [];
      let n = x.parentElement.nextElementSibling;
      if (n && n.classList.contains('sl-grid')) {
        n.querySelectorAll('[data-add], article, .sl-card').forEach(c => cards.push(c.textContent));
      }
      return { title: x.textContent, count: n && n.classList.contains('sl-grid')
        ? n.children.length : 0 };
    });
  });
  check('the new one lands under interest, not under the counsellor’s list',
    sections.length >= 2, JSON.stringify(sections));

  const after = await (await stu.request.get(BASE + '/api/state')).json();
  const row = (after.shortlist || []).find(r => String(r.id) === String(id));
  check('and the server records it as theirs', row && row.addedBy === 'student',
    row && row.addedBy);

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

  /* It moves on the student's screen too, without them doing anything. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const mine = await (await stu.request.get(BASE + '/api/state')).json();
  check('the student sees it move to their counsellor’s list',
    (mine.shortlist || []).find(r => String(r.id) === String(id)).addedBy === 'office');

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
