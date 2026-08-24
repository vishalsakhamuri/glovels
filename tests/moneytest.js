/**
 * The four numbers, and the field that makes two of them different.
 *
 * "How much was expected, how much we got, what is pending, and drop off and
 * left — these four should be enough to track the progress."
 *
 * Three of those were already computable. The fourth was not, and neither was
 * the third, because they are the same number until somebody says which it is.
 * A student halfway through a three-part plan and a student who stopped
 * answering in March leave an identical row behind: an order, some money in,
 * some money out. One balance is coming and one is not. Adding them together
 * and calling the total "receivables" is how a business is surprised.
 *
 * So the test that matters is the transition: mark a student as having left,
 * and watch the same rupees move from pending to lost without expected or
 * received twitching. Everything else here is arithmetic.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();
const rupees = p => '₹' + Math.round(p / 100).toLocaleString('en-IN');

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  const admin = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const money = () => admin.request.get(BASE + '/api/staff/money').then(r => r.json());

  const before = await money();
  check('the four numbers are there',
    ['expected', 'received', 'pending', 'lost'].every(k => typeof before[k] === 'number'),
    JSON.stringify(['expected', 'received', 'pending', 'lost'].map(k => before[k])));
  check('and the working beside them',
    typeof before.gst === 'number' && typeof before.services === 'number',
    'gst ' + before.gst + ', services ' + before.services);

  /* Somebody who buys a package and pays the first instalment of three. */
  const buyer = await browser.newContext();
  /* A package big enough that the instalment rules apply — the split only
     exists above ₹10,000, so the cheapest one would be paid in a single go and
     leave nothing pending to move anywhere. */
  const content = await (await buyer.request.get(BASE + '/api/content')).json();
  const pkg = (content.packages.items || [])
    .filter(x => Number(x.priceInr) > 20000)
    .sort((a, b) => Number(b.priceInr) - Number(a.priceInr))[0];
  const order = await (await buyer.request.post(BASE + '/api/orders', {
    data: {
      packageId: pkg.id,
      name: 'Half Paid ' + stamp, email: 'half' + stamp + '@example.com',
      /* The server takes the WORD 'parts', not a count — it decides how many,
         from the amount and the package. Passing 3 here bought the whole thing
         outright and left nothing pending, which made four checks below pass
         for the wrong reason. */
      phone: '+919000000123', acceptedTerms: true, payIn: 'parts',
    },
  })).json();
  check('an order can be placed in instalments', !!order.reference, JSON.stringify(order).slice(0, 90));

  const mid = await money();
  check('the whole amount counts as agreed the moment it is agreed',
    mid.expected > before.expected, rupees(before.expected) + ' → ' + rupees(mid.expected));
  check('and what has not arrived is pending, not lost',
    mid.pending > before.pending && mid.lost === before.lost,
    'pending ' + rupees(mid.pending) + ', lost ' + rupees(mid.lost));
  check('somebody appears on the list to ring',
    (mid.owing || []).some(r => r.reference === order.reference),
    (mid.owing || []).length + ' rows');

  const row = (mid.owing || []).find(r => r.reference === order.reference);
  check('the row says how much of how much', row && row.outstanding > 0 && row.gross > 0,
    row && (rupees(row.outstanding) + ' of ' + rupees(row.gross)));
  check('and when the next part falls due', !!(row && (row.nextDue || row.since)),
    row && (row.nextDue || row.since));

  /* THE check. The student stops answering, and the office says so. */
  const students = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const them = (students.students || []).find(x => x.email === 'half' + stamp + '@example.com');
  check('the buyer has an account to close', !!them,
    (students.students || []).map(x => x.email).slice(0, 3).join(','));

  if (them) {
    const put = await admin.request.put(BASE + '/api/staff/student/' + them.id + '/status',
      { data: { status: 'left', note: 'Stopped answering in March' } });
    check('an admin can close a file as left part-way', put.status() === 200, put.status());

    const after = await money();
    check('the money owed moves out of pending', after.pending < mid.pending,
      rupees(mid.pending) + ' → ' + rupees(after.pending));
    check('and lands in lost, to the rupee',
      after.lost - mid.lost === mid.pending - after.pending,
      rupees(after.lost - mid.lost) + ' vs ' + rupees(mid.pending - after.pending));
    check('while what was agreed does not change — it was still agreed',
      after.expected === mid.expected, rupees(after.expected));
    check('nor what arrived — that money is in the bank either way',
      after.received === mid.received, rupees(after.received));
    check('and they are counted among the ones who left',
      after.students.left === mid.students.left + 1,
      mid.students.left + ' → ' + after.students.left);

    /* Closed means closed. */
    const shut = await browser.newContext();
    const tryIn = await shut.request.post(BASE + '/api/auth/login',
      { data: { email: 'half' + stamp + '@example.com', password: 'anything-at-all' } });
    check('a closed account cannot sign in', tryIn.status() >= 400, tryIn.status());

    /* Reopening puts it back, which matters because closing the wrong file is
       a thing somebody will do at four on a Friday. */
    await admin.request.put(BASE + '/api/staff/student/' + them.id + '/status',
      { data: { status: 'active' } });
    const back = await money();
    check('reopening puts the money back into pending',
      back.pending === mid.pending && back.lost === mid.lost,
      rupees(back.pending) + ' / ' + rupees(back.lost));

    /* Completed is a different ending: the work was done, and anything still
       owed is still owed. */
    await admin.request.put(BASE + '/api/staff/student/' + them.id + '/status',
      { data: { status: 'completed', note: 'Flew in September' } });
    const done = await money();
    check('completing a file does not write off what is owed',
      done.pending === mid.pending && done.lost === mid.lost,
      rupees(done.pending) + ' / ' + rupees(done.lost));
    check('but does count them as finished',
      done.students.completed === mid.students.completed + 1);
  }

  /* GST is inside what arrived, never on what was invoiced. */
  const now = await money();
  const expectedGst = Math.round(now.received - now.received / 1.18);
  check('GST is the tax inside money that actually arrived',
    Math.abs(now.gst - expectedGst) <= 1, now.gst + ' vs ' + expectedGst);
  check('and it is never more than what arrived', now.gst < now.received);

  /* Only an admin sees the book. */
  const c = await browser.newContext();
  await c.request.post(BASE + '/api/auth/login',
    { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
  check('a counsellor cannot see the whole book',
    (await c.request.get(BASE + '/api/staff/money')).status() === 403);
  check('nor close a file',
    (await c.request.put(BASE + '/api/staff/student/1/status',
      { data: { status: 'left' } })).status() === 403);

  /* ------------------------------------------------------------ on the screen */
  const page = await admin.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', async d => { await d.accept('closed'); });
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3400);

  check('the four numbers are on the Organisation screen',
    /₹/.test(await page.textContent('#mExpected'))
    && /₹/.test(await page.textContent('#mLost')),
    [await page.textContent('#mExpected'), await page.textContent('#mReceived'),
     await page.textContent('#mPending'), await page.textContent('#mLost')].join(' | '));
  check('with who to ring under them', (await page.$$('#owingRows tr')).length >= 1);
  check('and the GST and the count of services delivered',
    /GST/.test(await page.textContent('#moneyMore'))
    && /Services delivered/.test(await page.textContent('#moneyMore')));
  check('every roster row can be closed', (await page.$$('[data-close]')).length >= 1);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
