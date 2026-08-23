/**
 * Applying to a private university is free, and the button does it.
 *
 * "Apply Now" on a private row called showPackages() — the paywall — for a
 * university the same page describes as free to view and free to apply to. On
 * a public row, for somebody who had paid, it opened a box that said "Demo.
 * Nothing has been filed." One button, two untrue things, and neither of them
 * put a row in a database.
 *
 * Everything below is read off the rendered page or out of the server, never
 * out of the source.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();

  /* ------------------------------------------- a visitor nobody knows yet */
  const guest = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await guest.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  const firstBtn = page.locator('#rowsIn [data-apply]').first();
  check('a private row offers a way to apply', await firstBtn.count() > 0);
  check('and it says the applying is free',
    /free/i.test(await firstBtn.textContent() || ''),
    (await firstBtn.textContent() || '').trim());
  check('the footnote says so too',
    /free to apply/i.test(await page.textContent('.rfoot')),
    (await page.textContent('.rfoot') || '').trim());

  /* The old behaviour: pressing it opened the packages section. */
  await firstBtn.click();
  await page.waitForTimeout(900);
  check('pressing it does not open the paywall',
    await page.locator('#packages').isHidden(),
    'packages section visible');
  check('it asks who is applying instead', await page.isVisible('#apName'));

  const heading = await page.textContent('#buyT');
  check('and says which university', /\w/.test(heading) && !/checkout/i.test(heading), heading);

  /* Rubbish in is refused on the page, not sent and refused by the server. */
  await page.fill('#apName', 'Test Applicant');
  await page.fill('#apMail', 'not-an-email');
  await page.fill('#apPhone', '9876543210');
  await page.click('#apGo');
  await page.waitForTimeout(500);
  check('a bad email address is caught before it is sent',
    await page.isVisible('#apErr'), await page.textContent('#apErr'));

  const email = 'apply' + Date.now() + '@example.com';
  await page.fill('#apMail', email);
  await page.click('#apGo');
  await page.waitForTimeout(1600);

  const said = await page.textContent('#buyBody');
  check('it confirms the application', /counsellor picks it up/i.test(said));
  check('and does not say the word demo', !/\bdemo\b/i.test(said),
    (said.match(/.{0,40}demo.{0,40}/i) || [''])[0]);
  check('with nothing to pay', !(await page.locator('#buyPay').isVisible()));

  /* --------------------------------- and it really is in the enquiry book */
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const book = await (await staff.request.get(BASE + '/api/staff/enquiries')).json();
  const lead = (book.enquiries || []).find(e => e.email === email);
  check('the office has the lead', !!lead, email);
  check('and it says what they want to apply to',
    !!lead && /^Wants to apply: .+/.test(lead.note || ''), lead && lead.note);

  /* It is on the operations screen too, not only in the API. */
  const ops = await staff.newPage();
  await ops.goto(BASE + '/chat', { waitUntil: 'domcontentloaded' });
  await ops.waitForTimeout(2200);
  check('the enquiry book paints without opening a chat first',
    (await ops.$$('#enqRows tr')).length > 0,
    (await ops.$$('#enqRows tr')).length + ' rows');
  await ops.click('.tab[data-t="enq"]');
  await ops.waitForTimeout(500);
  check('the Enquiry forms tab opens', await ops.isVisible('#t-enq'));
  check('and the row shows the university they asked about',
    (await ops.textContent('#enqRows') || '').includes('Wants to apply:'));

  /* ------------------------------------------------- a signed-in student */
  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const sp = await stu.newPage();
  const serrs = [];
  sp.on('pageerror', e => serrs.push(String(e)));
  await sp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(2600);

  const before = await (await stu.request.get(BASE + '/api/state')).json();
  /* One they have NOT already applied to, or "already on your list" would pass
     the check below without anything having been written. */
  const on = new Set((before.shortlist || []).map(x => String(x.id)));
  const all = await sp.$$eval('#rowsIn [data-apply]', bs => bs.map(b => b.dataset.apply));
  const fresh = all.find(id => !on.has(String(id)));
  check('there is one they have not applied to yet', !!fresh, all.join(','));
  const btn = sp.locator('[data-apply="' + fresh + '"]').first();
  const progId = fresh;
  check('the row carries the programme id the server will look up',
    !!progId && !/\|/.test(progId), progId);

  await btn.click();
  await sp.waitForTimeout(1800);
  const body = await sp.textContent('#buyBody');
  check('a signed-in student is not asked who they are',
    !(await sp.isVisible('#apName')));
  check('they are told it is with us now',
    /Your application is with us/i.test(await sp.textContent('#buyT')),
    await sp.textContent('#buyT'));
  check('and that their counsellor has been told', /counsellor has been told/i.test(body));
  check('with a way to go and look at it',
    (await sp.$$('a[href="dashboard.html"]')).length > 0);

  const after = await (await stu.request.get(BASE + '/api/state')).json();
  check('and it really is on the shortlist on the server',
    (after.shortlist || []).some(x => String(x.id) === String(progId))
      && (after.shortlist || []).length === (before.shortlist || []).length + 1,
    (before.shortlist || []).length + ' -> ' + (after.shortlist || []).length);

  check('no page errors for a visitor', errs.length === 0, errs.slice(0, 2).join(' | '));
  check('no page errors for a student', serrs.length === 0, serrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
