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

  /* A second counsellor with a student of their own, so that filtering the
     list by counsellor has something to remove. With one conversation on the
     screen, "the list got shorter" is true whether the filter works or not. */
  const mk = async (name, email, role) => (await (await admin.request.post(
    BASE + '/api/staff/people',
    { data: { name, email, password: 'g-' + stamp + '-' + role, role } })).json());
  const pick2 = o => (o.person ? o.person.id : o.id);
  const other = await mk('Other Counsellor ' + stamp,
    'guide-c' + stamp + '@glovels.com', 'counsellor');
  const theirs = await mk('Their Student ' + stamp,
    'guide-s' + stamp + '@ex.example', 'student');
  await admin.request.put(
    BASE + '/api/staff/student/' + pick2(theirs) + '/counsellor',
    { data: { counsellorId: pick2(other) } });

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
  /* Conversations is a tab of its own now — four full tables stacked on one
     page was thirty-four screens of scrolling once the site had customers, so
     the link says which one it wants. */
  await page.goto(BASE + '/admin#everyChat', { waitUntil: 'domcontentloaded' });
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

  /* ------------------------------------------- the summary cards are doors
   *
   * Vishal, looking at this screen on his phone: "if i click its not opening
   * messages in mobile version." He was pressing the counsellor cards, and
   * they were plain divs — never clickable, on any device. A screen full of
   * things that look pressable and are not teaches somebody to distrust the
   * controls that do work.
   *
   * They filter the list under them now, the way the partner counters do. */
  check('each counsellor card is a control, not a label',
    (await page.$$eval('#convWho .cw', cs => cs.every(c => c.tagName === 'BUTTON'))),
    (await page.$$eval('#convWho .cw', cs => cs.map(c => c.tagName).join(','))));
  const everyone = (await page.$$('#convRows tr')).length;
  /* A named counsellor rather than the first card, and the count is checked
     against what the summary itself promised — "fewer rows than before" passes
     on its own when the fixture has one conversation in it, which is a check
     that cannot fail dressed up as one that can. */
  const cards = await page.$$eval('#convWho .cw', cs => cs.map(c => ({
    key: c.dataset.cw,
    name: c.querySelector('b').textContent,
    threads: Number((c.querySelector('span').textContent.match(/^(\d+) thread/) || [])[1] || 0),
  })));
  /* Guarded from here down. On a tree where these cards are still plain divs
     there is nothing to click, and an unguarded click TIMES OUT — which ends
     the run, so the twenty checks after it never happen and the report says
     nothing at all. Failing is the useful outcome; dying is not. */
  const pick = cards.find(c => c.key !== 'none') || cards[0];
  if (!pick || !pick.key) {
    check('pressing one shows exactly the threads that card counted', false,
      'the cards carry no data-cw — they are not controls');
  } else {
  await page.click('#convWho .cw[data-cw="' + pick.key + '"]');
  await page.waitForTimeout(500);
  const slice = (await page.$$('#convRows tr')).length;
  check('pressing one shows exactly the threads that card counted',
    slice === pick.threads, pick.name + ': card says ' + pick.threads
      + ', list shows ' + slice + ' (of ' + everyone + ')');
  check('and every row on it is theirs',
    (await page.$$eval('#convRows tr', (rs, who) =>
      rs.every(r => r.cells[1] && r.cells[1].textContent.includes(who)), pick.name)),
    pick.name);
  check('and it shows as pressed',
    (await page.$eval('#convWho .cw[data-cw="' + pick.key + '"]',
      c => c.getAttribute('aria-pressed'))) === 'true');
  check('and the screen says which slice it is showing',
    /Showing /.test(await page.textContent('#convChip')));
  /* A filter with no way out is a screen that has broken, as far as anybody
     using it can tell. There are two ways out here and both are checked. */
  await page.click('[data-cw-all]');
  await page.waitForTimeout(450);
  check('there is a way back to everyone',
    (await page.$$('#convRows tr')).length === everyone);
  await page.click('#convWho .cw[data-cw="' + pick.key + '"]');
  await page.waitForTimeout(400);
  await page.click('#convWho .cw[data-cw="' + pick.key + '"]');
  await page.waitForTimeout(400);
  check('and pressing the same card again is the other one',
    (await page.$$('#convRows tr')).length === everyone);
  }

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

  /* --------------------------------------- and all of it works on a handset
   *
   * Read it sits in the last column of a six-column table, which on a 390px
   * phone is 1,180px inside a 356px box — so the one control that opens a
   * conversation was off the right-hand edge, and the screen read as dead to
   * the touch. The student's name is the link now, and this checks it is
   * actually ON the screen rather than merely present in the DOM. */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true });
  await phone.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const pp = await phone.newPage();
  const perrs = [];
  pp.on('pageerror', e => perrs.push(String(e)));
  await pp.goto(BASE + '/admin#everyChat', { waitUntil: 'domcontentloaded' });
  await pp.waitForSelector('#convRows tr', { timeout: 15000 });
  await pp.waitForTimeout(1800);

  /* The cards first, because pressing the name navigates away. */
  const phoneAll = (await pp.$$('#convRows tr')).length;
  const phoneCard = await pp.$$eval('#convWho .cw', cs => {
    const c = cs.find(x => x.dataset.cw && x.dataset.cw !== 'none') || cs[0];
    if (!c || !c.dataset.cw) return null;
    return { key: c.dataset.cw,
      threads: Number((c.querySelector('span').textContent.match(/^(\d+) thread/) || [])[1] || 0) };
  });
  if (!phoneCard) {
    check('the counsellor cards press on a phone too', false, 'they are not controls');
  } else {
    await pp.click('#convWho .cw[data-cw="' + phoneCard.key + '"]');
    await pp.waitForTimeout(500);
    const phoneSlice = (await pp.$$('#convRows tr')).length;
    check('the counsellor cards press on a phone too',
      phoneSlice === phoneCard.threads,
      'card says ' + phoneCard.threads + ', list shows ' + phoneSlice
        + ' (of ' + phoneAll + ')');
    await pp.click('[data-cw-all]');
    await pp.waitForTimeout(450);
    check('  · and the way back works there as well',
      (await pp.$$('#convRows tr')).length === phoneAll);
  }

  /* ---- a row is a card on a phone ----
   *
   * Six columns is 1,180px inside a 356px box. Moving the link onto the
   * student's name made the row usable; Waiting and Balance were still behind
   * a sideways scroll nobody would think to try. The row is a card now and
   * every column is a labelled line in it.
   *
   * The check is that the CELL IS ON THE SCREEN, not that it exists — off to
   * the right of a scrolling box is exactly where they were before. */
  const card = await pp.evaluate(() => {
    const tr = document.querySelector('#convRows tr');
    const tbl = document.querySelector('.cvtbl');
    /* Null-safe on purpose. On a tree without these classes the evaluate
       THREW, which ends the run — so the checks after it never reported and
       the log was a stack trace instead of a list of what is wrong. */
    if (!tr || !tbl) return { missing: true, display: '', headerHidden: false,
      boxScrolls: true, offscreen: ['the card layout is not there'], labels: [] };
    const box = tbl.closest('.p-card') || tbl;
    const vw = document.documentElement.clientWidth;
    return {
      display: getComputedStyle(tr).display,
      headerHidden: !!tbl.querySelector('thead')
        && getComputedStyle(tbl.querySelector('thead')).position === 'absolute',
      boxScrolls: box.scrollWidth > box.clientWidth + 2,
      offscreen: [...tr.querySelectorAll('td')]
        .filter(td => td.getBoundingClientRect().right > vw + 2)
        .map(td => td.className || 'td'),
      labels: [...tr.querySelectorAll('td[data-lb]')].map(td => td.dataset.lb),
    };
  });
  check('a conversation is a card on a phone, not a table row',
    card.display === 'block', card.display);
  check('  · the column headers step aside', card.headerHidden);
  check('  · and each value says which column it is',
    ['Counsellor', 'Last said', 'Waiting', 'Balance'].every(l => card.labels.includes(l)),
    card.labels.join(', '));
  check('  · nothing is off the right-hand edge any more',
    card.offscreen.length === 0, card.offscreen.join(', '));
  check('  · so the list no longer needs a sideways scroll at all',
    !card.boxScrolls);

  const opener = await pp.$('#convRows .cvopen');
  check('on a phone the student name opens the conversation', !!opener);
  if (opener) {
    const box = await opener.boundingBox();
    check('  · and it is reachable without scrolling the table sideways',
      box && box.x >= 0 && box.x + box.width <= 390,
      box && Math.round(box.x) + '..' + Math.round(box.x + box.width));
    await opener.click();
    await pp.waitForTimeout(2200);
    check('  · and pressing it lands on that conversation',
      /counsellor\?student=\d+/.test(pp.url()), pp.url());
  }
  check('no page errors on the phone', perrs.length === 0, perrs[0] || '');
  await phone.close();

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
