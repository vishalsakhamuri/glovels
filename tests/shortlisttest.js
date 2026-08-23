/**
 * The counsellor runs the student's list.
 *
 * This is the day-to-day work of the business and none of it was possible. A
 * counsellor agreed a shortlist on a call and then had nowhere to put it — the
 * student had to add each university themselves, from a finder, having just
 * been told which ones over the phone. And the five-stage tracker on the
 * student's own screen sat at zero for everybody, because nothing could move
 * it: the one question a student asks had no answer on the screen built to
 * answer it.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const staff = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const who = await (await stu.request.get(BASE + '/api/state')).json();
  const id = who.user.id;

  const cat = await (await staff.request.get(BASE + '/api/staff/catalogue')).json();
  const before = await (await stu.request.get(BASE + '/api/state')).json();
  const on = new Set((before.shortlist || []).map(x => String(x.id)));
  const fresh = (cat.programmes || []).find(p => p.active !== false && !on.has(String(p.id)));
  check('there is a university not yet on their list', !!fresh, fresh && fresh.university);

  /* ------------------------------------------------------- adding one */
  let r = await staff.request.post(BASE + '/api/staff/student/' + id + '/shortlist',
    { data: { id: fresh.id } });
  check('a counsellor can put a university on the list', r.ok(), r.status());

  let after = await (await stu.request.get(BASE + '/api/state')).json();
  check('the student sees it', (after.shortlist || []).some(x => String(x.id) === String(fresh.id)),
    (before.shortlist || []).length + ' -> ' + (after.shortlist || []).length);
  check('and is told, rather than finding it there one day',
    (after.msgs || []).some(m => /I have added/.test(m.t || '') &&
      (m.t || '').includes(fresh.university)),
    (after.msgs || []).slice(-1).map(m => m.t).join(''));

  /* The name and the fee come from OUR catalogue, not from the request. */
  const added = (after.shortlist || []).find(x => String(x.id) === String(fresh.id));
  check('the university is the one in the catalogue, not one that was sent',
    added.university === fresh.university, added.university + ' vs ' + fresh.university);

  const bogus = await staff.request.post(BASE + '/api/staff/student/' + id + '/shortlist',
    { data: { id: 'not-a-real-programme' } });
  check('a programme that does not exist cannot be added', bogus.status() === 404, bogus.status());

  /* ------------------------------------------------ moving it along */
  r = await staff.request.put(
    BASE + '/api/staff/student/' + id + '/application/' + encodeURIComponent(fresh.id),
    { data: { stage: 2, outcome: '' } });
  check('the application can be moved along', r.ok(), r.status());

  after = await (await stu.request.get(BASE + '/api/state')).json();
  check('and the student\'s tracker shows it',
    ((after.apps || {})[fresh.id] || {}).stage === 2,
    JSON.stringify((after.apps || {})[fresh.id] || {}));
  check('with a message saying what moved',
    (after.msgs || []).some(m => /Submitted/.test(m.t || '')),
    (after.msgs || []).slice(-1).map(m => m.t).join(''));

  /* Saving the same thing twice must not send a second message — a counsellor
     tidying ten rows should not send ten notifications saying nothing. */
  const msgsBefore = (after.msgs || []).length;
  const again = await (await staff.request.put(
    BASE + '/api/staff/student/' + id + '/application/' + encodeURIComponent(fresh.id),
    { data: { stage: 2, outcome: '' } })).json();
  check('saving an unchanged row says nothing to anybody', again.moved === false, again.moved);
  after = await (await stu.request.get(BASE + '/api/state')).json();
  check('and really sends no message', (after.msgs || []).length === msgsBefore,
    msgsBefore + ' -> ' + (after.msgs || []).length);

  r = await staff.request.put(
    BASE + '/api/staff/student/' + id + '/application/' + encodeURIComponent(fresh.id),
    { data: { stage: 4, outcome: 'offer' } });
  after = await (await stu.request.get(BASE + '/api/state')).json();
  check('an offer can be recorded',
    ((after.apps || {})[fresh.id] || {}).outcome === 'offer',
    JSON.stringify((after.apps || {})[fresh.id] || {}));

  const junk = await staff.request.put(
    BASE + '/api/staff/student/' + id + '/application/' + encodeURIComponent(fresh.id),
    { data: { stage: 99, outcome: 'whatever-we-like' } });
  after = await (await stu.request.get(BASE + '/api/state')).json();
  check('a stage past the end is clamped, not stored',
    ((after.apps || {})[fresh.id] || {}).stage === 4,
    ((after.apps || {})[fresh.id] || {}).stage);
  check('and an outcome we do not recognise is dropped',
    ((after.apps || {})[fresh.id] || {}).outcome === '',
    ((after.apps || {})[fresh.id] || {}).outcome);

  /* --------------------------------------------------- taking it off */
  r = await staff.request.delete(
    BASE + '/api/staff/student/' + id + '/shortlist/' + encodeURIComponent(fresh.id));
  check('a counsellor can take one off', r.ok(), r.status());
  after = await (await stu.request.get(BASE + '/api/state')).json();
  check('it is gone from the student\'s list',
    !(after.shortlist || []).some(x => String(x.id) === String(fresh.id)));
  check('and its tracker went with it — no row for a university nobody is applying to',
    !(after.apps || {})[fresh.id], JSON.stringify((after.apps || {})[fresh.id] || {}));
  check('the student is told that too',
    (after.msgs || []).some(m => /I have taken/.test(m.t || '')));

  /* -------------------------------- and only for their own students */
  const other = await browser.newContext();
  const made = await (await staff.request.post(BASE + '/api/staff/people', {
    data: { name: 'Other Counsellor', email: 'other' + Date.now() + '@glovels.com',
      role: 'counsellor' },
  })).json();
  await other.request.post(BASE + '/api/auth/login',
    { data: { email: made.person.email, password: made.password } });
  await other.request.post(BASE + '/api/auth/change',
    { data: { current: made.password, password: 'other-chose-this-one' } });

  const denied = await other.request.post(BASE + '/api/staff/student/' + id + '/shortlist',
    { data: { id: fresh.id } });
  check('a counsellor cannot touch a student who is not theirs',
    denied.status() === 403, denied.status());

  /* --------------------------------------------------- and on the screen */
  const page = await staff.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.locator('[data-open]').first().click();
  await page.waitForTimeout(2200);
  await page.click('.tab[data-t="file"]');
  await page.waitForTimeout(800);

  check('the counsellor screen offers a way to add one', await page.isVisible('#addUni'));
  await page.click('#addUni');
  await page.waitForTimeout(400);
  await page.fill('#uniQ', 'Berlin');
  await page.waitForTimeout(1400);
  check('searching the catalogue finds something',
    (await page.$$('#uniHits li')).length > 0,
    (await page.$$('#uniHits li')).length + ' hits');

  const rows = (await page.$$('#uniList li')).length;
  const addBtn = page.locator('[data-uniadd]').first();
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForTimeout(2400);
    await page.click('.tab[data-t="file"]').catch(() => {});
    await page.waitForTimeout(600);
    check('adding from the screen puts it on the list',
      (await page.$$('#uniList li')).length === rows + 1,
      rows + ' -> ' + (await page.$$('#uniList li')).length);
  }

  const stage = page.locator('[data-stage]').first();
  check('every row carries the stage control', await stage.count() > 0);
  check('and a decision control', (await page.$$('[data-outcome]')).length > 0);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
