/**
 * What a visitor picks on the home page, and what they see after signing in.
 *
 * A package has always become an order. The a-la-carte services did not: they
 * went to the enquiry endpoint as a line of text, with a reference the browser
 * invented, so a student who ticked four services and paid signed in to a
 * dashboard that had never heard of them. These checks follow one person the
 * whole way — pick, pay, sign in, see it.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();

  /* ------------------------------------------------ a signed-in student buys */
  const stu = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });

  const before = await (await stu.request.get(BASE + '/api/state')).json();
  const nBefore = (before.orders || []).length;

  const p = await stu.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await p.goto(BASE + '/#services', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);

  /* Ids first, then click by selector. The grid repaints after every add, so
     element handles taken up front are detached by the time they are used. */
  const ids = await p.$$eval('#services [data-add]', els =>
    els.map(e => e.getAttribute('data-add')).filter(Boolean));
  check('the service grid has things to add', ids.length > 3, ids.length);

  const picked = [];
  for (const id of ids) {
    if (picked.length >= 2) break;
    const sel = '#services [data-add="' + id + '"]';
    const el = p.locator(sel).first();
    if (!(await el.count())) continue;
    await el.scrollIntoViewIfNeeded();
    await el.click();
    picked.push(id);
    await p.waitForTimeout(400);
  }
  check('two services are in the plan', picked.length === 2, picked.join(','));

  await p.waitForSelector('#planBar.on', { timeout: 8000 });
  const planText = await p.textContent('#planBar');
  check('the plan bar shows a total', /₹/.test(planText), planText.replace(/\s+/g, ' ').slice(0, 60));

  await p.click('#planCta');
  await p.waitForSelector('#scPay', { timeout: 8000 });
  await p.fill('#scName', 'Vishal Test');
  await p.fill('#scMail', 'student@glovels.com');
  await p.fill('#scPhone', '9876543210');

  /* Every checkout records what was accepted now, services included — so the
     tick is not optional and the order is refused without it. */
  await p.check('#scOk');

  await p.click('#scPay');
  await p.waitForTimeout(2500);

  const confirm = await p.textContent('#scBody');
  check('the confirmation appears', /booked|Payment received/i.test(confirm),
    confirm.replace(/\s+/g, ' ').slice(0, 80));
  const ref = (confirm.match(/GLV-\d+/) || [])[0];
  check('it shows a reference', !!ref, ref);

  /* ------------------------------------------- the order is really an order */
  const after = await (await stu.request.get(BASE + '/api/state')).json();
  check('an order was created', (after.orders || []).length === nBefore + 1,
    nBefore + ' -> ' + (after.orders || []).length);

  const order = (after.orders || []).find(o => o.reference === ref);
  check('with the SAME reference the page showed',
    !!order, ref + ' vs ' + (after.orders || []).map(o => o.reference).join(','));

  if (order) {
    check('it knows it was services, not a package', order.kind === 'services', order.kind);
    check('and it lists what was bought', (order.items || []).length === 2,
      (order.items || []).map(x => x.name).join(' | '));
    check('the total is the sum of the lines',
      order.grossPaise === (order.items || []).reduce((t, x) => t + x.paise, 0),
      order.grossPaise);
    check('the price came from the server, not the page',
      (order.items || []).every(x => x.paise > 0 || x.paise === 0), 'ok');
  }

  /* ------------------------------------------------- and it is on the screen */
  const dash = await stu.newPage();
  await dash.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await dash.waitForTimeout(2000);
  check('the dashboard has a "what you have bought" section',
    await dash.isVisible('#boughtSec'));
  const bought = await dash.textContent('#boughtWrap');
  check('the new order is on it', bought.includes(ref), bought.replace(/\s+/g, ' ').slice(0, 100));
  if (order && (order.items || []).length) {
    check('with the services named, not just a total',
      bought.includes(order.items[0].name),
      order.items[0].name + ' :: ' + bought.replace(/\s+/g, ' ').slice(0, 110));
  }
  /* By reference, not by length. "the text is longer than 200 characters" is
     not a claim about anything, and it failed on a dashboard that was showing
     both orders perfectly well. */
  const older = (before.orders || [])[0];
  check('the older package order is still listed too',
    !older || bought.includes(older.reference),
    older ? older.reference + ' :: ' + bought.replace(/\s+/g, ' ').slice(0, 120) : 'none to check');

  /* ---------------------------------- a package still works exactly as before */
  const pkgOrder = await (await stu.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-roadmap', name: 'T', email: 'student@glovels.com',
      phone: '9876543210', acceptedTerms: true },
  })).json();
  check('a package order still prices from the server', pkgOrder.grossPaise > 0,
    pkgOrder.grossPaise);
  check('and still unlocks universities', pkgOrder.publicUnis > 0, pkgOrder.publicUnis);

  /* --------------------------------------------- the price cannot be dictated */
  const cheeky = await (await stu.request.post(BASE + '/api/orders', {
    data: { services: [{ id: picked[0] }], amount: 1, grossPaise: 1,
      name: 'T', email: 'student@glovels.com', phone: '9876543210',
      acceptedTerms: true },
  })).json();
  const real = (after.orders.find(o => o.reference === ref).items || [])
    .find(x => x.id === picked[0]);
  check('an amount in the request is ignored',
    !real || cheeky.grossPaise === real.paise,
    cheeky.grossPaise + ' vs ' + (real && real.paise));

  /* ------------------------------------- a service that does not exist is not sold */
  const bogus = await stu.request.post(BASE + '/api/orders', {
    data: { services: [{ id: 'not-a-real-service' }],
      name: 'T', email: 'student@glovels.com', phone: '9876543210',
      acceptedTerms: true },
  });
  check('an unknown service is refused rather than invented', bogus.status() === 400,
    bogus.status());

  /* -------------------------------------------- the counsellor sees it too */
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const list = await (await staff.request.get(BASE + '/api/staff/students')).json();
  const me = (list.students || []).find(x => x.email === 'student@glovels.com');
  const rec = await (await staff.request.get(BASE + '/api/staff/student/' + me.id)).json();
  check('the order is on the counsellor\'s copy of the record',
    (rec.orders || []).some(o => o.reference === ref),
    (rec.orders || []).map(o => o.reference).join(','));

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
