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
  await page.waitForSelector('#rows tr', { timeout: 15000 });

  /* ------------------------------------------------- make a student here */
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
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rows tr', { timeout: 15000 });

  check('they appear in Every student',
    (await names(page)).some(n => /Walk In Student/.test(n)),
    (await names(page)).join(' | '));

  /* ------------------------------------------------------- the counters */
  const all = await names(page);
  check('the table starts with everybody', all.length >= 2, all.length + ' rows');

  check('and the view you are in is marked on the counter',
    await page.$eval('[data-go="all"]', el => el.classList.contains('on')));

  await page.click('[data-go="unassigned"]');
  await page.waitForTimeout(700);
  check('the mark follows the filter',
    await page.$eval('[data-go="unassigned"]', el => el.classList.contains('on'))
    && !(await page.$eval('[data-go="all"]', el => el.classList.contains('on'))));
  const unassigned = await names(page);
  check('Unassigned narrows the table', unassigned.length < all.length,
    all.length + ' -> ' + unassigned.length);
  check('and says what it is showing',
    /Unassigned only/.test(await page.textContent('#onlyChip')),
    await page.textContent('#onlyChip'));
  check('a student an administrator created is in it',
    unassigned.some(n => /Walk In Student/.test(n)), unassigned.join(' | '));

  await page.click('#onlyChip');
  await page.waitForTimeout(600);
  check('the chip clears the filter', (await names(page)).length === all.length,
    (await names(page)).length);

  await page.click('[data-go="docs"]');
  await page.waitForTimeout(700);
  check('Docs to review filters too',
    /Waiting on documents/.test(await page.textContent('#onlyChip')),
    await page.textContent('#onlyChip'));

  await page.click('[data-go="all"]');
  await page.waitForTimeout(700);
  check('Students shows everybody again', (await names(page)).length === all.length,
    (await names(page)).length);

  /* -------------------------------------------------- out to another screen */
  await page.click('[data-go="enquiries"]');
  await page.waitForTimeout(2500);
  check('Enquiries leaves for the chat screen', /\/chat/.test(page.url()), page.url());
  check('and opens the enquiry book, not the chats',
    await page.isVisible('#enqRows'), page.url());

  /* ------------------------ the one with nowhere to go is not a button */
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rows tr', { timeout: 15000 });
  /* It used to be a plain number BECAUSE there was no order book to open. There
     is one now, so it leads there — and the person who reported the counters as
     broken was pressing this one. */
  check('"Orders placed" now leads to the order book',
    (await page.$$('[data-go="orders"]')).length === 1);
  await page.click('[data-go="orders"]');
  await page.waitForTimeout(900);
  check('and the order book is on the screen', await page.isVisible('#ordRows'));
  check('it says how many orders there are, not just a rupee total',
    /^\d+$/.test((await page.textContent('#kRev')).trim()),
    await page.textContent('#kRev'));

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
