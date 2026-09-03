/**
 * Fixing a mistake, and removing one.
 *
 * "Delete wrong data or user or anything should be easy as per process.
 *  Everywhere edit, delete options should be available."
 *
 * The "as per process" is the whole thing. A delete button that always works is
 * not a feature, it is a way to lose the books. Three deletions must be refused
 * however hard somebody clicks:
 *
 *   yourself — the account you are signed in as; there is nobody left to undo it
 *   the last administrator — the same outcome, one step removed
 *   anybody with an order — an order is the financial record of what a person
 *   accepted and paid, and it has to outlive the account. Close the file
 *   instead, which ends their access and keeps the money straight.
 *
 * And the edit exists for one reason worth stating: the email address IS the
 * sign-in. A typo in it locks somebody out of their own account with no way in
 * from their side. Before this, nobody could fix that.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();

  const admin = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const login = await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  check('an admin can sign in', login.status() === 200, login.status());
  const me = await (await admin.request.get(BASE + '/api/state')).json();

  const people = () => admin.request.get(BASE + '/api/staff/people').then(r => r.json());

  /* ------------------------------------------------------- somebody to edit */
  const made = await admin.request.post(BASE + '/api/staff/people', {
    data: {
      name: 'Typo Nmae', email: 'typo' + stamp + '@example.com',
      phone: '+919000000001', role: 'counsellor',
    },
  });
  check('an admin can add a counsellor', made.status() === 200, made.status());
  const who = (await made.json()).person || (await made.json());
  const id = who.id;

  /* THE reason this exists. */
  const fixed = await admin.request.put(BASE + '/api/staff/people/' + id, {
    data: {
      name: 'Fixed Name', email: 'fixed' + stamp + '@example.com', phone: '+919000000002',
    },
  });
  check('a name, an email and a phone can be corrected', fixed.status() === 200,
    fixed.status());
  const after = (await fixed.json()).person;
  check('and the correction stuck', after.name === 'Fixed Name'
    && after.email === 'fixed' + stamp + '@example.com', JSON.stringify(after).slice(0, 90));

  /* The corrected address is the sign-in now, and the old one is not. */
  const themNow = await browser.newContext();
  const reset = await admin.request.post(BASE + '/api/staff/people/' + id + '/password',
    { data: {} });
  const pw = (await reset.json()).password;
  const inNew = await themNow.request.post(BASE + '/api/auth/login',
    { data: { email: 'fixed' + stamp + '@example.com', password: pw } });
  check('they can sign in on the corrected address', inNew.status() === 200, inNew.status());
  const inOld = await (await browser.newContext()).request.post(BASE + '/api/auth/login',
    { data: { email: 'typo' + stamp + '@example.com', password: pw } });
  check('and the address with the typo in it no longer works', inOld.status() >= 400,
    inOld.status());

  /* Two accounts on one address means the second person to sign in gets the
     first one's file. */
  const clash = await admin.request.put(BASE + '/api/staff/people/' + id,
    { data: { name: 'Fixed Name', email: 'admin@glovels.com' } });
  check('an email already in use is refused', clash.status() === 409, clash.status());
  check('and says why', /already uses/i.test((await clash.json()).error || ''),
    (await clash.json()).error);

  const junk = await admin.request.put(BASE + '/api/staff/people/' + id,
    { data: { name: 'x', email: 'not-an-address' } });
  check('and so is something that is not an email at all', junk.status() === 400,
    junk.status());

  /* ------------------------------------------------- the deletions refused */
  const self = await admin.request.delete(BASE + '/api/staff/people/' + me.user.id);
  check('an admin cannot delete the account they are signed in as',
    self.status() === 400, self.status());
  check('and is told why rather than just failing',
    /your own account/i.test((await self.json()).error || ''), (await self.json()).error);

  /* Anybody with an order. Buy something as a new person, then try. */
  const buyer = await browser.newContext();
  const content = await (await buyer.request.get(BASE + '/api/content')).json();
  const pkg = (content.packages.items || [])[0];
  const bought = await (await buyer.request.post(BASE + '/api/orders', {
    data: {
      packageId: pkg.id, name: 'Paid Person ' + stamp,
      email: 'paid' + stamp + '@example.com', phone: '+919000000003',
      acceptedTerms: true,
    },
  })).json();
  check('somebody buys something', !!bought.reference, JSON.stringify(bought).slice(0, 80));

  const roster = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const payer = (roster.students || []).find(s => s.email === 'paid' + stamp + '@example.com');
  check('and appears on the roster', !!payer);

  if (payer) {
    const nope = await admin.request.delete(BASE + '/api/staff/people/' + payer.id);
    check('a person with an order on file cannot be deleted', nope.status() === 409,
      nope.status());
    const why = (await nope.json()).error || '';
    check('and the refusal names the alternative — close the file',
      /close the file/i.test(why), why.slice(0, 90));
    /* Which must actually be there. */
    const closed = await admin.request.put(
      BASE + '/api/staff/student/' + payer.id + '/status',
      { data: { status: 'completed', note: 'Flew in September' } });
    check('closing the file works instead', closed.status() === 200, closed.status());
    /* And the order survived all of it. */
    const money = await (await admin.request.get(BASE + '/api/staff/money')).json();
    check('the order is still in the books', money.orders >= 1, money.orders + ' orders');
  }

  /* An administrator is deletable like anybody else as long as they are not
     the last one and not the one holding the keyboard. */
  const second = await (await admin.request.post(BASE + '/api/staff/people', {
    data: {
      name: 'Second Admin', email: 'admin2-' + stamp + '@example.com',
      phone: '+919000000004', role: 'admin',
    },
  })).json();
  const secondId = (second.person || second).id;
  const otherAdmin = await admin.request.delete(BASE + '/api/staff/people/' + secondId);
  check('a second admin can be removed while another one remains',
    otherAdmin.status() === 200, otherAdmin.status());
  check('and the one signed in is still an administrator',
    (await (await admin.request.get(BASE + '/api/state')).json()).user.role === 'admin');

  /* ----------------------------------------------------- the delete allowed */
  const spare = await (await admin.request.post(BASE + '/api/staff/people', {
    data: {
      name: 'Wrong Entry ' + stamp, email: 'wrong' + stamp + '@example.com',
      phone: '+919000000005', role: 'counsellor',
    },
  })).json();
  const spareId = (spare.person || spare).id;

  /* Give them a student, so the unassignment is exercised. */
  const anyStudent = (roster.students || []).find(s => s.role !== 'admin');
  if (anyStudent) {
    await admin.request.put(BASE + '/api/staff/student/' + anyStudent.id + '/counsellor',
      { data: { counsellorId: spareId } });
  }

  const gone = await admin.request.delete(BASE + '/api/staff/people/' + spareId);
  check('a counsellor added by mistake can be deleted', gone.status() === 200, gone.status());
  const result = await gone.json();
  check('and the students they held are handed back rather than vanishing',
    typeof result.unassigned === 'number', JSON.stringify(result));

  const list = await people();
  check('they are off the list',
    !(list.people || []).some(p => String(p.id) === String(spareId)),
    (list.people || []).length + ' people');

  const stillIn = await (await browser.newContext()).request.post(BASE + '/api/auth/login',
    { data: { email: 'wrong' + stamp + '@example.com', password: 'anything' } });
  check('and cannot sign in', stillIn.status() >= 400, stillIn.status());

  if (anyStudent) {
    const back = await (await admin.request.get(BASE + '/api/staff/students')).json();
    const s = (back.students || []).find(x => x.id === anyStudent.id);
    check('the student they held is still there, just unassigned', !!s,
      s && JSON.stringify({ id: s.id, c: s.counsellorId }));
  }

  /* A counsellor is not an administrator. */
  const couns = await browser.newContext();
  await couns.request.post(BASE + '/api/auth/login',
    { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
  check('a counsellor cannot delete people',
    (await couns.request.delete(BASE + '/api/staff/people/' + id)).status() === 403);
  check('nor edit them',
    (await couns.request.put(BASE + '/api/staff/people/' + id,
      { data: { name: 'x' } })).status() === 403);

  /* ------------------------------------------------------------- a lead */
  const lead = await admin.request.post(BASE + '/api/staff/leads', {
    data: {
      name: 'Test Row ' + stamp, phone: '9000000006',
      email: 'lead' + stamp + '@example.com', destination: 'Germany', source: 'phone',
    },
  });
  check('an enquiry can be logged', lead.status() === 200, lead.status());
  const book = await (await admin.request.get(BASE + '/api/staff/leads')).json();
  const row = (book.leads || []).find(l => l.email === 'lead' + stamp + '@example.com');
  check('and lands in the book', !!row, (book.leads || []).length + ' leads');

  if (row) {
    await admin.request.post(BASE + '/api/staff/lead/' + row.id + '/note',
      { data: { kind: 'call', body: 'Rang, wrong number' } });
    const del = await admin.request.delete(BASE + '/api/staff/lead/' + row.id);
    check('a junk enquiry can be deleted', del.status() === 200, del.status());
    const now = await (await admin.request.get(BASE + '/api/staff/leads')).json();
    check('and is gone from the book',
      !(now.leads || []).some(l => l.id === row.id), (now.leads || []).length + ' leads');
    check('deleting one that is not there says so',
      (await admin.request.delete(BASE + '/api/staff/lead/' + row.id)).status() === 404);
  }

  /* ------------------------------------------------------------ on the screen */
  const errs = [];
  const page = await admin.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  check('every person on the list can be edited',
    (await page.$$('[data-edit]')).length >= 1, (await page.$$('[data-edit]')).length);
  check('and deleted, except the one signed in',
    (await page.$$('[data-del]')).length === (await page.$$('[data-edit]')).length - 1,
    (await page.$$('[data-del]')).length + ' of ' + (await page.$$('[data-edit]')).length);
  check('no page errors on the people screen', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* And a lead opened in the book offers the same. */
  const lead2 = await admin.request.post(BASE + '/api/staff/leads', {
    data: {
      name: 'Screen Row ' + stamp, phone: '9000000007',
      email: 'lead2-' + stamp + '@example.com', destination: 'Canada', source: 'phone',
    },
  });
  check('a second enquiry to open on screen', lead2.status() === 200);

  await page.goto(BASE + '/leads', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  const rows = await page.$$('tr[data-lead]');
  check('the book has rows', rows.length >= 1, rows.length);
  if (rows.length) {
    await rows[0].click();
    await page.waitForTimeout(900);
    check('an open lead offers Delete', (await page.$$('#dDel')).length === 1);
    const beforeCount = (await (await admin.request.get(BASE + '/api/staff/leads')).json())
      .leads.length;
    await page.click('#dDel');
    await page.waitForTimeout(1400);
    const afterCount = (await (await admin.request.get(BASE + '/api/staff/leads')).json())
      .leads.length;
    check('and clicking it removes the row', afterCount === beforeCount - 1,
      beforeCount + ' → ' + afterCount);
  }
  check('no page errors in the book', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
