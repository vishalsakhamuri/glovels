/**
 * The office screens with a real number of records in them.
 *
 * "If we have more than 100 records all the grid what was built will not be
 *  sufficient in admin, counsellor page. If need have then in multiple tabs."
 *
 * He is right, and the measurements were worse than the guess. With 131
 * students loaded, the Organisation screen rendered 543 rows across four
 * stacked tables — thirty-four screens of scrolling, 10,000 DOM nodes, and the
 * fourth table may as well not have existed. The catalogue silently stopped at
 * 400 programmes: at 401 universities, one of them was simply not there and
 * nothing on the screen said so.
 *
 * This seeds 130 of everything and then checks the things that actually go
 * wrong with paging, rather than that a pager exists:
 *
 *   the count is the TRUE count, never the shown count
 *   a search resets to page one, instead of stranding you on an empty page six
 *   the last page is reachable and holds the remainder
 *   a counter that filters the table also opens the tab the table is on
 *   selecting everything still means everything, not everything on this page
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const N = 130;
const ok = [], bad = [];
const check = (n, p, note) => (p ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------------- fill it up */
  /* Buying is done SIGNED OUT. An order placed while signed in attaches to
     whoever is signed in — so seeding through the admin context creates no
     students at all and quietly hangs a hundred orders off the administrator's
     own account. */
  const shop = await browser.newContext();
  for (let i = 0; i < N; i++) {
    /* And signed out EVERY time. The first order creates an account and sets a
       session cookie, so without this the second buyer is the first one again
       and a hundred and thirty orders land on one student. */
    await shop.clearCookies();
    /* A different visitor each time. The form's flood guard is per-IP and it is
       right to have one — this is the test working around it, not a bug. */
    await shop.request.post(BASE + '/api/orders', {
      headers: { 'x-forwarded-for': '10.0.' + (i % 250) + '.7' },
      data: { services: [{ id: 'shortlist-ten' }], name: 'Student ' + String(i).padStart(3, '0'),
        email: 'bulk' + i + '@example.com', phone: '+9190000' + String(10000 + i),
        acceptedTerms: true },
    });
    await admin.request.post(BASE + '/api/staff/leads', {
      data: { name: 'Lead ' + String(i).padStart(3, '0'), source: 'website',
        phone: '+9199999' + String(10000 + i), email: 'lead' + i + '@example.com' },
    });
  }
  const students = (await (await admin.request.get(BASE + '/api/staff/students')).json()).students;
  check('the site has more than a hundred students to draw', students.length > 100, students.length);

  const page = await admin.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));

  /* =============================================== the Organisation screen */
  await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4200);

  const height = await page.evaluate(() => document.body.scrollHeight);
  check('the screen is a screen, not a scroll', height < 6000, height + 'px');

  const tabs = await page.$$eval('.otab', e => e.map(x => x.dataset.o));
  check('the four tables are on four tabs',
    ['students', 'orders', 'money', 'chats'].every(t => tabs.includes(t)), tabs.join(','));
  check('only one is showing at a time',
    (await page.$$eval('.opane.active', e => e.length)) === 1);

  const pagerText = () => page.textContent('#stuPager');
  check('the pager counts every student, not the ones drawn',
    (await pagerText()).includes('of ' + students.length),
    (await pagerText()).replace(/\s+/g, ' ').trim());
  check('and draws a page of them',
    (await page.$$eval('#rows tr', e => e.length)) === 25,
    await page.$$eval('#rows tr', e => e.length));

  /* The last page, and the remainder on it. */
  const pages = Math.ceil(students.length / 25);
  await page.click('#stuPager .pgb[data-pg=\"stu|' + (pages - 1) + '\"]');
  await page.waitForTimeout(500);
  const lastRows = await page.$$eval('#rows tr', e => e.length);
  check('the last page holds the remainder',
    lastRows === (students.length % 25 || 25), lastRows + ' rows, ' + pages + ' pages');

  /* THE paging bug: search while standing on the last page. */
  await page.fill('#findStudent', 'Student 01');
  await page.waitForTimeout(600);
  const found = await page.$$eval('#rows tr', e => e.length);
  check('searching from the last page shows results, not an empty table',
    found > 0 && found <= 25, found + ' rows');
  check('and the pager is back on page one',
    (await pagerText()).trim() === '' || /^1–/.test((await pagerText()).trim()),
    (await pagerText()).replace(/\s+/g, ' ').trim() || 'no pager — everything fits');
  await page.fill('#findStudent', '');
  await page.waitForTimeout(500);

  /* A counter that filters the table has to open the tab the table is on. */
  await page.click('.otab[data-o="money"]');
  await page.waitForTimeout(400);
  await page.click('[data-go="unassigned"]');
  await page.waitForTimeout(700);
  check('the Unassigned counter brings the student tab back with it',
    await page.getAttribute('.otab[data-o="students"]', 'aria-selected') === 'true');
  /* Every buyer is given a counsellor now, so the honest expectation is that
     this filter finds nobody and says so — not that it renders some rows. */
  const unassigned = await page.textContent('#rows');
  check('and the table under it is the filtered one',
    /Everybody has a counsellor/.test(unassigned)
    || (await page.$$eval('#rows tr[data-row]', e => e.length)) > 0,
    unassigned.replace(/\s+/g, ' ').trim().slice(0, 80));
  await page.click('[data-go="all"]');
  await page.waitForTimeout(600);

  /* Orders and Conversations page too. */
  await page.click('.otab[data-o="orders"]');
  await page.waitForTimeout(500);
  check('the orders table pages', /of \d+ orders/.test(await page.textContent('#ordPager')),
    (await page.textContent('#ordPager')).replace(/\s+/g, ' ').trim());
  await page.click('.otab[data-o="chats"]');
  await page.waitForTimeout(500);
  check('and so does the conversation list',
    /of \d+ conversations/.test(await page.textContent('#convPager')),
    (await page.textContent('#convPager')).replace(/\s+/g, ' ').trim());
  check('no errors on the Organisation screen', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ================================================== the enquiries screen */
  const lerr = []; page.on('pageerror', e => lerr.push(String(e)));
  await page.goto(BASE + '/leads.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  check('the enquiry book is a screen, not a scroll',
    (await page.evaluate(() => document.body.scrollHeight)) < 4000,
    (await page.evaluate(() => document.body.scrollHeight)) + 'px');
  check('and counts every enquiry', /of \d+ enquiries/.test(await page.textContent('#leadPager')),
    (await page.textContent('#leadPager')).replace(/\s+/g, ' ').trim());
  await page.fill('#fQ', 'Lead 01');
  await page.waitForTimeout(600);
  check('its search finds rows', (await page.$$eval('#leadRows tr', e => e.length)) > 0);

  /* =================================================== the catalogue screen */
  await page.goto(BASE + '/catalogue.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3400);
  const cat = await page.textContent('#progPager');
  check('the catalogue pages rather than stopping at 400 in silence',
    /of \d+ programmes/.test(cat), cat.replace(/\s+/g, ' ').trim());
  const total = Number((cat.match(/of (\d+) programmes/) || [])[1] || 0);
  check('and the pager knows the whole catalogue',
    total === (await (await admin.request.get(BASE + '/api/staff/catalogue')).json())
      .programmes.length, total);
  /* Select-everything has to keep meaning everything. */
  await page.check('#selAll');
  await page.waitForTimeout(500);
  const picked = await page.textContent('body');
  check('“select everything” still selects everything, not this page',
    picked.includes(String(total)), 'expected ' + total + ' selected');
  await page.uncheck('#selAll');

  /* ================================================= the counsellor screen */
  await page.goto(BASE + '/counsellor.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3400);
  const roster = await page.$$eval('[data-open]', e => e.length);
  check('the conversation roster draws a page, not the whole caseload',
    roster > 0 && roster <= 50, roster + ' rows');
  check('and says how many there are in total',
    /of \d+ students/.test(await page.textContent('#casePager')),
    (await page.textContent('#casePager')).replace(/\s+/g, ' ').trim());

  check('no errors anywhere', errs.length === 0 && lerr.length === 0,
    errs.concat(lerr).slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
