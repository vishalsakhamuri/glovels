/**
 * Reading the conversations, and guiding the person having them.
 *
 * "Admin should be able to see all the chats, everything related to the
 * student. In case a counsellor is not writing messages correctly he should be
 * able to guide him."
 *
 * An administrator could already open any student's file — one at a time,
 * having first guessed which one to open. That is not oversight. And there was
 * no way at all to say anything to a counsellor about a conversation without
 * saying it in the conversation, where the student reads it.
 *
 * The check that matters most is the last one: the student must never be able
 * to see it, and not because a screen chose not to draw it.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();
const SECRET = 'Answer within the day and use their name — ' + stamp;

(async () => {
  const browser = await chromium.launch();

  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const me = await (await stu.request.get(BASE + '/api/state')).json();
  await stu.request.post(BASE + '/api/messages',
    { data: { body: 'Any update on my APS certificate?' } });

  const admin = await browser.newContext({ viewport: { width: 1700, height: 1060 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------------ the list */
  const list = await (await admin.request.get(BASE + '/api/staff/conversations')).json();
  check('an administrator can read every conversation at once',
    (list.conversations || []).length >= 1, (list.conversations || []).length);
  const mine = (list.conversations || []).find(c => c.id === me.user.id);
  check('with the student, the counsellor and what was said last',
    mine && mine.counsellor && /APS/.test(mine.lastBody), mine && mine.lastBody);
  check('and who spoke last, which is the whole of "is anybody waiting"',
    mine && mine.lastFrom === 'student', mine && mine.lastFrom);
  check('a thread the student spoke last in is waiting, however recent',
    mine && !!mine.waitingSince, mine && mine.waitingSince);
  check('and how much of the talking each side has done',
    mine && typeof mine.fromUs === 'number' && typeof mine.fromThem === 'number',
    mine && (mine.fromUs + '/' + mine.fromThem));
  check('with a split by counsellor, because that is the sentence being looked for',
    (list.summary.byCounsellor || []).length >= 1,
    JSON.stringify(list.summary.byCounsellor));

  /* ---------------------------------------------------------- on the screen */
  const page = await admin.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', async d => { await d.accept(SECRET); });
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);

  check('the conversations are on the Organisation screen',
    (await page.$$('#convRows tr[class], #convRows tr')).length >= 1);
  /* This student's row, not the first row. The list carries every student now,
     including the ones nobody has written to — they sort to the top, because a
     student nobody has started is the most urgent thing on the screen — so
     "the first row" is no longer this one, and clicking it guides somebody
     else's counsellor. */
  const myRow = page.locator('#convRows tr', { hasText: 'Vishal' });
  const rowText = await myRow.first().textContent();
  check('naming the student and the counsellor',
    rowText.includes('Vishal') && rowText.includes('Kavya'), rowText.slice(0, 80));
  check('and saying it is waiting rather than answered',
    !/answered/.test(rowText), rowText.replace(/\s+/g, ' ').slice(0, 140));
  check('a student nobody has written to is on the list too, not filtered out',
    (await page.textContent('#convRows')).includes('Nothing said yet')
      || (list.conversations || []).every(c => c.messages > 0),
    'silent=' + list.summary.silent);
  check('the by-counsellor summary is drawn',
    (await page.$$('#convWho .cw')).length >= 1);
  check('there is a way to read the whole thread',
    (await page.$$('a[href^="counsellor.html?student="]')).length >= 1);

  /* ------------------------------------------------------------- guiding */
  check('and a way to guide the counsellor', (await page.$$('[data-guide]')).length >= 1);
  await page.click('[data-guide="' + me.user.id + '"]');
  await page.waitForTimeout(1800);
  const after = await (await admin.request.get(BASE + '/api/staff/conversations')).json();
  const row = (after.conversations || []).find(c => c.id === me.user.id);
  check('the note is recorded against the student', row && row.guidance >= 1, row && row.guidance);
  check('and is unread until the counsellor opens the file',
    row && row.guidanceUnread >= 1, row && row.guidanceUnread);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* -------------------------------------------------- the counsellor reads it */
  const c = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await c.request.post(BASE + '/api/auth/login',
    { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
  const cp = await c.newPage();
  const cerrs = [];
  cp.on('pageerror', e => cerrs.push(String(e)));
  await cp.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await cp.waitForTimeout(2600);
  await cp.locator('[data-open]').first().click();
  await cp.waitForTimeout(2400);

  check('the counsellor sees it above the conversation it is about',
    await cp.isVisible('.guide'));
  check('word for word', (await cp.textContent('.guide')).includes(SECRET),
    (await cp.textContent('.guide') || '').slice(0, 70));
  check('and it says who said it',
    /Glovels Admin/.test(await cp.textContent('.guide')));
  check('no page errors for the counsellor', cerrs.length === 0, cerrs.slice(0, 2).join(' | '));

  const seen = await (await admin.request.get(BASE + '/api/staff/conversations')).json();
  const row2 = (seen.conversations || []).find(x => x.id === me.user.id);
  check('opening the file is reading it', row2 && row2.guidanceUnread === 0,
    row2 && row2.guidanceUnread);

  /* --------------------------------------- and the student never sees any of it */
  const state = await (await stu.request.get(BASE + '/api/state')).text();
  check('it is nowhere in the student’s own record', !state.includes(SECRET));
  check('not in their messages',
    !JSON.parse(state).msgs.some(m => (m.t || '').includes(SECRET)));
  const theirPage = await stu.newPage();
  await theirPage.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await theirPage.waitForTimeout(2400);
  check('and not on their messages screen',
    !(await theirPage.content()).includes(SECRET));

  /* ------------------------------------------------- and only for the office */
  check('a student cannot read the conversation list',
    (await stu.request.get(BASE + '/api/staff/conversations')).status() === 403);
  check('nor a counsellor — this is an administrator’s view',
    (await c.request.get(BASE + '/api/staff/conversations')).status() === 403);
  check('and a counsellor cannot guide anybody',
    (await c.request.post(BASE + '/api/staff/student/' + me.user.id + '/guide',
      { data: { body: 'not allowed' } })).status() === 403);

  /* A student nobody is looking after has nobody to tell. */
  const made = await (await admin.request.post(BASE + '/api/staff/people', {
    data: { name: 'Lonely Student ' + stamp, email: 'lonely' + stamp + '@example.com',
      role: 'student' },
  })).json();
  const nobody = await admin.request.post(
    BASE + '/api/staff/student/' + made.person.id + '/guide', { data: { body: 'hello' } });
  check('guiding a student with no counsellor says so rather than vanishing',
    nobody.status() === 409, nobody.status());
  check('and says what to do about it',
    /assign a counsellor/i.test((await nobody.json()).error || ''),
    (await nobody.json()).error);

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
