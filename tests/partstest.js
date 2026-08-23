/**
 * Paying in parts.
 *
 * A student who has just decided to go abroad was being asked for ₹74,999 in
 * one press, months before the first application is filed. Some of them can.
 * The ones who cannot did not say so — they closed the tab, and it was counted
 * as a page that did not convert.
 *
 * The arithmetic is the part worth testing hardest: three parts of ₹74,999 do
 * not divide evenly, and a student charged one rupee more than the card said
 * has caught us out.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

const PLANS = require(path.join(__dirname, 'build', 'server', 'plans.js'));
const ALERTS = require(path.join(__dirname, 'build', 'server', 'alerts.js'));
const store = require(path.join(__dirname, 'build', 'server', 'store.js'));

(async () => {
  /* ------------------------------------------------------ the arithmetic */
  check('₹9,999 is paid in one go', !PLANS.allowed(999900));
  check('and so is exactly ₹10,000 — the rule is "more than"',
    !PLANS.allowed(1000000));
  check('a rupee over, and it can be spread', PLANS.allowed(1000100));

  for (const gross of [1000100, 2999900, 4999900, 7499900, 123457]) {
    const parts = PLANS.split(gross, null, 0);
    if (!parts) continue;
    const sum = parts.reduce((n, p) => n + p.paise, 0);
    check('the parts of ₹' + (gross / 100) + ' add up to exactly that',
      sum === gross, sum + ' vs ' + gross);
    check('and every part but the last is whole rupees',
      parts.slice(0, -1).every(p => p.paise % 100 === 0),
      parts.map(p => p.paise).join(','));
  }
  const three = PLANS.split(7499900, null, 0);
  check('the first part is due now, the rest later',
    three[0].status === 'due' && three.slice(1).every(p => p.status === 'later'));
  check('the later ones carry a date somebody can chase',
    three.slice(1).every(p => !!p.dueAt), JSON.stringify(three.map(p => p.dueAt)));
  check('the first does not — it is being paid at the checkout', !three[0].dueAt);
  check('and each part is named after the work, not numbered',
    three.every(p => /[a-z]/.test(p.label) && !/^Part \d/.test(p.label)),
    three.map(p => p.label).join(' | '));

  /* ------------------------------------------------------- and on the page */
  const browser = await chromium.launch();
  const guest = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await guest.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.click('[data-show-packages]');
  await page.waitForTimeout(900);

  const lines = await page.$$eval('#packages .partline', els => els.map(e => e.textContent.trim()));
  check('the cards say part payment is possible', lines.length >= 2, lines.join(' | '));
  check('and say what starting it costs', lines.every(l => /₹[\d,]+ to start/.test(l)),
    lines[0]);

  await page.click('[data-buy="pkg-boarding"]');
  await page.waitForTimeout(900);
  check('the checkout offers the choice', await page.isVisible('#payChoice'));
  check('paying in full is what it opens on',
    await page.isChecked('[name="payin"][value="full"]'));
  check('and the button says the full price',
    /74,999/.test(await page.textContent('#buyPay')), await page.textContent('#buyPay'));

  await page.check('[name="payin"][value="parts"]');
  await page.waitForTimeout(400);
  check('picking parts changes what the button will charge',
    /30,000/.test(await page.textContent('#buyPay')), await page.textContent('#buyPay'));
  check('and shows the whole schedule before they commit',
    await page.isVisible('#paySched'));
  const sched = await page.textContent('#paySched');
  check('with every part named and priced',
    /30,000/.test(sched) && /22,500/.test(sched) && /22,499/.test(sched),
    sched.replace(/\s+/g, ' ').slice(0, 120));
  check('and says nothing is charged automatically',
    /nothing is charged automatically/i.test(sched));

  const email = 'parts' + stamp + '@example.com';
  await page.fill('#rqName', 'Parts Buyer');
  await page.fill('#rqPhone', '9876543210');
  await page.fill('#rqMail', email);
  await page.check('#rqOk');
  await page.click('#buyPay');
  await page.waitForTimeout(2400);
  check('the confirmation says which part this was',
    /Part 1 of 3/.test(await page.textContent('#buyT')), await page.textContent('#buyT'));
  const ref = (await page.textContent('#buyModal .sheet') || '').match(/GLV-\d+/);
  check('with a reference', !!ref, ref && ref[0]);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* --------------------------------------------- a small package is not split */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.click('[data-show-packages]');
  await page.waitForTimeout(600);
  await page.click('[data-buy="pkg-roadmap"]');
  await page.waitForTimeout(800);
  check('₹9,999 is not offered in parts', !(await page.isVisible('#payChoice')));

  /* ----------------------------------------------- what the server recorded */
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const book = await (await staff.request.get(BASE + '/api/staff/orders')).json();
  const row = (book.orders || []).find(o => o.reference === ref[0]);
  check('the order book has it', !!row, ref[0]);
  check('with the schedule on it', row && (row.plan || []).length === 3,
    row && JSON.stringify((row.plan || []).map(p => p.paise)));
  check('and nothing collected yet', row && !row.paidPaise, row && row.paidPaise);

  /* A hand-rolled request cannot dictate the schedule. */
  const cheeky = await (await guest.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-boarding', name: 'Cheeky', email: 'cheeky' + stamp + '@example.com',
      phone: '9876543211', acceptedTerms: true, payIn: 'parts',
      plan: [{ n: 1, label: 'nothing', paise: 100 }], chargedNowPaise: 100 },
  })).json();
  check('a schedule sent by the browser is ignored',
    cheeky.plan && cheeky.plan.length === 3 && cheeky.plan[0].paise === 3000000,
    JSON.stringify((cheeky.plan || []).map(p => p.paise)));
  check('and the first part is what is charged now',
    cheeky.chargedNowPaise === 3000000, cheeky.chargedNowPaise);

  /* -------------------------------------------- collecting the rest, by hand */
  const collect = n => staff.request.post(BASE + '/api/staff/order/' + ref[0] + '/part',
    { data: {} });
  let r = await (await collect()).json();
  check('a counsellor can record the first part', r.status === 'part', r.status);
  check('and the order is not called paid while money is owed',
    r.outstandingPaise === 4499900, r.outstandingPaise);

  /* Part paid means the work has started, so what they bought is theirs. */
  const state = await (await staff.request.get(BASE + '/api/staff/orders')).json();
  const partRow = (state.orders || []).find(o => o.reference === ref[0]);
  check('the order book shows what has arrived', partRow.paidPaise === 3000000,
    partRow.paidPaise);
  check('and says it is part paid', partRow.status === 'part', partRow.status);

  await (await collect()).json();
  r = await (await collect()).json();
  check('the last part settles it', r.status === 'paid', r.status);
  check('with nothing outstanding', r.outstandingPaise === 0, r.outstandingPaise);
  const over = await staff.request.post(BASE + '/api/staff/order/' + ref[0] + '/part',
    { data: {} });
  check('and it cannot be collected a fourth time', over.status() === 409, over.status());

  /* ------------------------------------------- the student sees the schedule */
  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const mine = await (await stu.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-boarding', name: 'Vishal', email: 'student@glovels.com',
      phone: '9876543210', acceptedTerms: true, payIn: 'parts' },
  })).json();
  const dash = await stu.newPage();
  const derrs = [];
  dash.on('pageerror', e => derrs.push(String(e)));
  await dash.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await dash.waitForTimeout(2800);
  check('the schedule is on their own screen', await dash.isVisible('.ord-plan'));
  const shown = await dash.textContent('.ord-plan');
  check('saying what is left of what', /left of/.test(shown), shown.slice(0, 60));
  check('with every part listed', (await dash.$$('.ord-plan li')).length >= 3,
    (await dash.$$('.ord-plan li')).length);
  check('and a way to pay the next one',
    (await dash.$$('[data-paypart]')).length >= 1,
    (await dash.$$eval('[data-paypart]', e => e.map(x => x.textContent.trim()))).join(' | '));
  check('no page errors on the dashboard', derrs.length === 0, derrs.slice(0, 2).join(' | '));

  /* An order being paid in parts still unlocks what was bought — the work has
     started, and withholding it until the last part would make the whole thing
     pointless. */
  await staff.request.post(BASE + '/api/staff/order/' + mine.reference + '/part', { data: {} });
  const cat = await (await stu.request.get(BASE + '/api/catalogue')).json();
  const named = (cat.programmes || []).filter(p => p.isPublic && p.university).length;
  check('a part-paid package unlocks the universities it bought', named > 0, named);

  /* --------------------------------------------- and a part that goes past its date */
  const db = store.open('/tmp/db-8099');
  const later = Date.now() + 40 * 86400000;
  const money = ALERTS.all(db, later).alerts.filter(a => a.kind === 'payment');
  check('a part payment past its date becomes an alert', money.length >= 1,
    money.map(a => a.title).join(' | '));
  check('naming the amount and the order',
    money[0] && /₹[\d,]+ overdue on GLV-\d+/.test(money[0].title), money[0] && money[0].title);
  check('and it is not an alert before the date',
    !ALERTS.all(db, Date.now()).alerts.some(a => a.kind === 'payment'
      && a.subject.reference === mine.reference));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
