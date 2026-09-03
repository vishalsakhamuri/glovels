/**
 * Who is doing this one, asked where the work actually arrives.
 *
 * Three things come in: an enquiry from the contact form, an order from
 * somebody who has paid, and a message from somebody who already has a file.
 * Every one of those has its own screen, and on every one of those screens the
 * name of the counsellor was printed as text. The control that set it existed
 * once — on a fourth screen, a list of students sorted by name — so answering
 * "give this one to Bhargav" meant leaving the thing you were looking at,
 * finding the person on another list, and coming back.
 *
 * This drives the three screens and checks the answer sticks on the server,
 * not just in the cell.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();
  const staff = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  const login = (ctx, email, password) => ctx.request.post(BASE + '/api/auth/login',
    { data: { email, password } });
  await login(staff, 'admin@glovels.com', 'glovels123');

  /* ------------------------------------------- somebody buys something ---- */
  const guest = await browser.newContext();
  const email = 'buyer' + stamp + '@example.com';
  await guest.request.post(BASE + '/api/orders', {
    data: {
      packageId: 'pkg-roadmap', name: 'Buyer ' + stamp, email, phone: '9876500001',
      acceptedTerms: true,
    },
    headers: { 'x-forwarded-for': '203.0.113.44' },
  });
  /* An order with no account behind it cannot be assigned to anybody, which is
     itself a thing the screen has to say rather than show a dead select. */
  await guest.request.post(BASE + '/api/auth/register', {
    data: { name: 'Buyer ' + stamp, email, password: 'buyer12345', phone: '9876500001' },
    headers: { 'x-forwarded-for': '203.0.113.44' },
  });

  /* ------------------------------------------- and somebody enquires ------ */
  const lguest = await browser.newContext();
  await lguest.request.post(BASE + '/api/enquiries', {
    data: { name: 'Asker ' + stamp, email: 'ask' + stamp + '@example.com', phone: '9876500002' },
    headers: { 'x-forwarded-for': '203.0.113.55' },
  });

  const people = await (await staff.request.get(BASE + '/api/staff/overview')).json();
  const counsellor = (people.counsellors || [])[0];
  check('there is a counsellor to hand work to', !!counsellor,
    counsellor ? counsellor.name : 'none in the overview');
  if (!counsellor) { report(); return; }

  /* ==================================================== the order book ==== */
  const page = await staff.newPage();
  await page.goto(BASE + '/admin.html');
  await page.waitForSelector('.otab[data-o="orders"]');
  await page.click('.otab[data-o="orders"]');
  await page.waitForSelector('#ordRows tr');
  await page.waitForTimeout(300);

  const heads = await page.$$eval('#o-orders thead th', ts => ts.map(t => t.textContent.trim()));
  check('the order book has a Counsellor column', heads.includes('Counsellor'),
    heads.join(' | '));

  const orderRow = await page.$('#ordRows tr:has-text("Buyer ' + stamp + '")');
  check('the new order is in the book', !!orderRow);

  const sel = orderRow && await orderRow.$('select[data-assign]');
  check('and it carries the control that assigns it', !!sel);

  if (sel) {
    await sel.selectOption(String(counsellor.id));
    await page.waitForTimeout(600);

    const orders = await (await staff.request.get(BASE + '/api/staff/orders')).json();
    const mine = (orders.orders || []).find(o => o.email === email);
    check('assigning from the order row reaches the server',
      mine && Number(mine.counsellorId) === Number(counsellor.id),
      mine ? 'counsellorId=' + mine.counsellorId : 'order not found');

    /* The same student on the student list, which is the other tab. It must
       not need a reload to agree with what was just done. */
    await page.click('.otab[data-o="students"]');
    await page.waitForTimeout(250);
    const stuValue = await page.$eval(
      '#o-students tr:has-text("Buyer ' + stamp + '") select[data-assign]',
      s => s.value).catch(() => '');
    check('and the student list agrees without a reload',
      String(stuValue) === String(counsellor.id), 'value=' + stuValue);
  }

  /* --------------------- an order nobody is on, said out loud ------------ */
  {
    const od = await (await staff.request.get(BASE + '/api/staff/orders')).json();
    const one = (od.orders || []).find(o => o.studentId);
    await staff.request.put(BASE + '/api/staff/student/' + one.studentId + '/counsellor',
      { data: { counsellorId: null } });

    const p2 = await staff.newPage();
    await p2.goto(BASE + '/admin.html');
    await p2.waitForSelector('.otab[data-o="orders"]');
    await p2.click('.otab[data-o="orders"]');
    await p2.waitForSelector('#ordRows tr');
    await p2.waitForTimeout(700);

    const said = await p2.$eval('#ordNone', el => el.hidden ? '' : el.textContent.trim());
    check('the order book says how many nobody is on', /nobody on (it|them)/.test(said),
      said || 'chip hidden');

    await p2.click('#ordNone');
    await p2.waitForTimeout(350);
    const rows = await p2.$$eval('#ordRows tr', r => r.length);
    const loose = (od.orders || []).filter(o => o.studentId && !o.counsellorId).length + 1;
    check('and pressing it shows exactly those', rows === loose,
      rows + ' rows, expected ' + loose);
    await p2.close();

    /* Put it back so the rest of this suite sees what it expects. */
    await staff.request.put(BASE + '/api/staff/student/' + one.studentId + '/counsellor',
      { data: { counsellorId: counsellor.id } });
  }

  /* ================================================== the conversations === */
  await page.click('.otab[data-o="chats"]');
  await page.waitForTimeout(400);
  const convSel = await page.$$('#convRows select[data-assign]');
  check('a conversation can be handed to somebody from its row', convSel.length > 0,
    convSel.length + ' selects');

  /* On a cold load. The conversations and the list of counsellors are fetched
     side by side, and whichever answered first used to decide whether these
     selects knew any names at all — so a thread with a counsellor could render
     as "unassigned" directly under a summary card counting it against them. */
  const fresh = await staff.newPage();
  await fresh.goto(BASE + '/admin.html');
  await fresh.waitForSelector('.otab[data-o="chats"]');
  await fresh.click('.otab[data-o="chats"]');
  await fresh.waitForSelector('#convRows select[data-assign]');
  await fresh.waitForTimeout(700);
  const convValue = await fresh.$eval(
    '#convRows tr:has-text("Buyer ' + stamp + '") select[data-assign]', s => s.value)
    .catch(() => '');
  check('a thread that has a counsellor says so on a cold load',
    String(convValue) === String(counsellor.id), 'value=' + convValue);
  await fresh.close();

  /* ========================================================= the leads ==== */
  const lead = await page.context().newPage();
  await lead.goto(BASE + '/leads.html');
  await lead.waitForSelector('#leadRows tr');

  const ownSel = await lead.$('#leadRows tr:has-text("Asker ' + stamp + '") select[data-own]');
  check('a lead can be given to somebody from the book', !!ownSel);

  if (ownSel) {
    await ownSel.selectOption(String(counsellor.id));
    await lead.waitForTimeout(600);
    const leads = await (await staff.request.get(BASE + '/api/staff/leads')).json();
    const mine = (leads.leads || []).find(l => l.name === 'Asker ' + stamp);
    check('and that reaches the server too',
      mine && Number(mine.ownerId) === Number(counsellor.id),
      mine ? 'ownerId=' + mine.ownerId : 'lead not found');

    /* Choosing an owner must not also open the lead — the select sits inside a
       row whose click opens the panel. */
    const paneOpen = await lead.$eval('#leadPane', el => /Pick a lead/.test(el.textContent))
      .catch(() => false);
    check('choosing an owner does not swap the panel out underneath', paneOpen === true);
  }

  /* ------------------------------------------------- the counter tiles ---- */
  const tiles = await lead.$$('.outgo[data-tile]');
  check('the five counters on the leads screen are buttons', tiles.length === 5,
    tiles.length + ' found');

  for (const key of ['open', 'follow', 'won', 'cold']) {
    const btn = await lead.$('.outgo[data-tile="' + key + '"]');
    if (!btn) { check('tile ' + key + ' exists', false); continue; }
    const said = Number(await btn.$eval('b', b => b.textContent.trim()));
    await btn.click();
    await lead.waitForTimeout(250);
    const rows = Number(await lead.$eval('#nBook', b => b.textContent.trim()));
    check('pressing "' + key + '" opens exactly the rows it counted',
      said === rows, 'tile said ' + said + ', book shows ' + rows);
    /* And pressing it again gives the whole book back. */
    await btn.click();
    await lead.waitForTimeout(200);
  }

  /* A filter you cannot see is a filter that makes the screen look broken ten
     minutes later, so pressing a tile has to say so and offer the way out. */
  await lead.click('.outgo[data-tile="open"]');
  await lead.waitForTimeout(250);
  const chipShown = await lead.$eval('#tileChip', el => !el.hidden && el.textContent.trim());
  check('a pressed tile says which one is holding the book down',
    /Still open/.test(chipShown || ''), String(chipShown));
  const pressed = await lead.$eval('.outgo[data-tile="open"]', b => b.classList.contains('on'));
  check('and the tile itself looks pressed', pressed === true);
  await lead.click('#tileChip');
  await lead.waitForTimeout(250);
  const chipGone = await lead.$eval('#tileChip', el => el.hidden);
  check('and pressing it clears the filter', chipGone === true);

  const back = Number(await lead.$eval('#nBook', b => b.textContent.trim()));
  const all = Number(await lead.$eval('#kAll', b => b.textContent.trim()));
  check('pressing a tile twice gives the whole book back', back === all,
    back + ' of ' + all);

  /* ------------------- a lost lead can still be handed to somebody -------- */
  const leads2 = await (await staff.request.get(BASE + '/api/staff/leads')).json();
  const victim = (leads2.leads || []).find(l => l.name === 'Asker ' + stamp);
  if (victim) {
    await staff.request.put(BASE + '/api/staff/lead/' + victim.id,
      { data: { status: 'lost', lostReason: (leads2.reasons || ['other'])[0] } });
    const r = await staff.request.put(BASE + '/api/staff/lead/' + victim.id,
      { data: { ownerId: null } });
    check('a lead already marked lost can still change hands', r.ok(),
      r.status() + ' ' + (r.ok() ? '' : (await r.text()).slice(0, 90)));
  }

  await browser.close();
  report();

  function report() {
    ok.forEach(n => console.log('  ok   ' + n));
    bad.forEach(n => console.log('  BAD  ' + n));
    console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
    process.exit(bad.length ? 1 : 0);
  }
})();
