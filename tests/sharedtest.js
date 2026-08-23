/**
 * A file, shared in the conversation.
 *
 * The paperclip on the student's Messages screen sent the NAME of a file. A
 * student attached their passport, saw "passport.pdf" appear in the thread,
 * and nothing had been uploaded — not to the server, not to their documents,
 * nowhere. The counsellor read the same word and went looking for a file that
 * did not exist. The counsellor had no paperclip at all.
 *
 * "These should be available for counsellor in documents folder of student" —
 * so the test that matters is not that the message appears. It is that the
 * file is on the student's file afterwards, reachable by both of them, from a
 * screen neither of them was on when it was sent.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

const PASSPORT = '/tmp/sharedtest-passport-' + stamp + '.pdf';
const OFFER = '/tmp/sharedtest-offer-' + stamp + '.pdf';
const HUGE = '/tmp/sharedtest-huge-' + stamp + '.pdf';

(async () => {
  fs.writeFileSync(PASSPORT, Buffer.from('%PDF-1.4 a passport scan, near enough'));
  fs.writeFileSync(OFFER, Buffer.from('%PDF-1.4 an offer letter'));
  fs.writeFileSync(HUGE, Buffer.alloc(11 * 1024 * 1024, 0x20));

  const browser = await chromium.launch();

  const stu = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const before = await (await stu.request.get(BASE + '/api/state')).json();
  const docsBefore = Object.keys(before.docs || {}).length;

  /* ------------------------------------------- the student sends something */
  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  check('there is a way to send a file', await page.isVisible('#clip'));
  const bubbles = await page.$$eval('#thread > div', d => d.length);

  await page.fill('#box', 'Here is my passport');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'), page.click('#clip'),
  ]);
  await chooser.setFiles(PASSPORT);
  await page.waitForTimeout(2400);

  check('it appears in the thread',
    (await page.$$eval('#thread > div', d => d.length)) === bubbles + 1,
    bubbles + ' -> ' + (await page.$$eval('#thread > div', d => d.length)));
  const link = await page.$$eval('#thread a[href*="/api/documents/"]',
    a => a.map(x => x.textContent.trim()));
  check('as a real link, not a filename printed at them',
    link.some(t => /passport/.test(t)), link.join(' | '));
  check('with its size, so a wrong file is obvious', link.some(t => /KB|MB/.test(t)),
    link.join(' | '));
  check('and the note they typed went with it',
    (await page.textContent('#thread')).includes('Here is my passport'));

  /* THE point of the whole thing. */
  const after = await (await stu.request.get(BASE + '/api/state')).json();
  check('the file is on their own file, not only in the thread',
    Object.keys(after.docs || {}).length === docsBefore + 1,
    docsBefore + ' -> ' + Object.keys(after.docs || {}).length);
  const key = Object.keys(after.docs || {}).find(k => !(k in (before.docs || {})));
  check('and it is waiting for the counsellor to check it',
    (after.docs[key] || {}).status === 'wait', (after.docs[key] || {}).status);

  const got = await stu.request.get(BASE + '/api/documents/' + key + '/file');
  check('the student can download it back', got.ok(), got.status());
  check('and it is the file they sent, not an empty one',
    (await got.body()).length === fs.statSync(PASSPORT).size,
    (await got.body()).length + ' bytes');

  /* And on the Documents screen, where somebody who was not in the
     conversation would look for it. */
  await page.goto(BASE + '/documents', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  check('the Documents screen has a place for shared files',
    await page.isVisible('#sharedWrap'));
  check('and it is listed there', (await page.textContent('#sharedList')).includes('passport'),
    (await page.textContent('#sharedList') || '').slice(0, 60));
  check('with a link that downloads it',
    (await page.$$('#sharedList a[href*="/api/documents/"]')).length >= 1);
  check('no page errors for the student', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* --------------------------------------------- and the counsellor's side */
  const staff = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const ops = await staff.newPage();
  const operrs = [];
  ops.on('pageerror', e => operrs.push(String(e)));
  await ops.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await ops.waitForTimeout(2600);
  await ops.locator('[data-open]').first().click();
  await ops.waitForTimeout(2200);

  check('the counsellor sees the file in the thread',
    (await ops.$$eval('#thread a[href*="/document/"]', a => a.map(x => x.textContent.trim())))
      .some(t => t.includes(String(stamp))),
    (await ops.$$eval('#thread a[href*="/document/"]', a => a.map(x => x.textContent))).join(' | '));

  await ops.click('.tab[data-t="file"]');
  await ops.waitForTimeout(700);
  /* By the stamped name, not by the word "passport" — the seeded file list
     already has passport-front-back.pdf in it, and matching that would have
     passed with nothing shared at all. */
  check('and in the documents folder on their file',
    (await ops.textContent('#docs')).includes(String(stamp)),
    (await ops.textContent('#docs') || '').replace(/\s+/g, ' ').slice(0, 110));

  /* The other direction. */
  await ops.click('.tab[data-t="chat"]');
  await ops.waitForTimeout(500);
  check('the counsellor has a paperclip too', await ops.isVisible('#rclip'));
  await ops.fill('#rbox', 'Your offer letter, signed');
  const [ch2] = await Promise.all([
    ops.waitForEvent('filechooser'), ops.click('#rclip'),
  ]);
  await ch2.setFiles(OFFER);
  await ops.waitForTimeout(2600);
  check('sending one says where it went',
    /on their file/i.test(await ops.textContent('#rfile')), await ops.textContent('#rfile'));
  await ops.click('.tab[data-t="file"]');
  await ops.waitForTimeout(600);
  check('and it is on their file straight away, not after a reload',
    (await ops.textContent('#docs')).includes('offer-' + stamp),
    (await ops.textContent('#docs') || '').replace(/\s+/g, ' ').slice(0, 100));
  check('no page errors for the counsellor', operrs.length === 0, operrs.slice(0, 2).join(' | '));

  const mine = await (await stu.request.get(BASE + '/api/state')).json();
  const sent = Object.values(mine.docs || {}).find(d => /offer/.test(d.file));
  check('the student has it too', !!sent, Object.values(mine.docs || {}).map(d => d.file).join(','));
  check('and a file from the counsellor is not waiting to be checked by the counsellor',
    sent && sent.status === 'ok', sent && sent.status);

  /* ------------------------------------------------------- what is refused */
  const stuId = before.user.id;
  const other = await browser.newContext();
  check('nobody signed out can attach anything',
    (await other.request.post(BASE + '/api/messages/attach')).status() === 401);

  /* A counsellor cannot reach a student who is not theirs — and cannot fetch
     their file by putting an id in the URL. */
  const made = await (await staff.request.post(BASE + '/api/staff/people', {
    data: { name: 'Other C ' + stamp, email: 'otherc' + stamp + '@glovels.com',
      role: 'counsellor' },
  })).json();
  const notTheirs = await browser.newContext();
  await notTheirs.request.post(BASE + '/api/auth/login',
    { data: { email: made.person.email, password: made.password } });
  await notTheirs.request.post(BASE + '/api/auth/change',
    { data: { current: made.password, password: 'a-password-of-their-own' } });
  const denied = await notTheirs.request.get(
    BASE + '/api/staff/student/' + stuId + '/document/' + key + '/file');
  check('a counsellor cannot fetch a file from a student who is not theirs',
    denied.status() === 403, denied.status());

  const big = await stu.request.post(BASE + '/api/messages/attach', {
    multipart: { file: { name: 'huge.pdf', mimeType: 'application/pdf',
      buffer: fs.readFileSync(HUGE) } },
  });
  check('an 11 MB file is refused', big.status() === 413, big.status());
  check('and says what to do about it',
    /photograph|PDF/i.test((await big.json()).error || ''), (await big.json()).error);

  const empty = await stu.request.post(BASE + '/api/messages/attach',
    { headers: { 'Content-Type': 'application/json' }, data: {} });
  check('a request with no file is refused, not stored as an empty document',
    empty.status() === 400, empty.status());

  await browser.close();
  [PASSPORT, OFFER, HUGE].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });

  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
