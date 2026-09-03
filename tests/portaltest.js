/**
 * The student portal, after the counsellors read it.
 *
 * From the 1.4 testing round, five corrections. Three are about a screen
 * saying something untrue and two are about a student being able to do
 * something that is not theirs to do.
 *
 *   FILL WITH DEMO ANSWERS. A button on the live profile screen that pasted
 *   somebody else's answers over a real student's record, in one press. A
 *   demonstration control that survived the demonstration.
 *
 *   DELETE MY ACCOUNT AT THE FOOT OF EVERY VISIT. It cannot simply go — Apple
 *   and Google both refuse a listing without a way to delete an account from
 *   inside the app — so it moved behind a heading. It is a section of the
 *   profile now, alongside Class 10 and Passport, and this suite checks BOTH
 *   halves: not on the page by default, and still reachable and still working.
 *
 *   THE TAB KEY. The upload cards were bare divs — not in the tab order at
 *   all, so somebody working without a mouse could reach every part of the
 *   Documents screen except the only control on it that does anything.
 *
 *   FAMILY DETAILS AT 100% WHEN EMPTY. Every field in that section is
 *   optional, so there were no required fields to divide by and the answer was
 *   100 — a green tick against a form nobody had touched. The one section
 *   where that is most likely to be believed is the one asking for a parent's
 *   phone number.
 *
 *   AND THE TRACKER, WHICH IS THE OFFICE'S RECORD. "The student can mark
 *   Documents Collected as Done, whereas the counsellor is the one who
 *   verifies and marks it as done." Every stage on that list is something
 *   Glovels does. A student pressing done on one moved their dashboard, their
 *   counsellor's list and the office's counters, and nobody had collected
 *   anything.
 *
 * The last one is checked at the ENDPOINT as well as on the screen, because a
 * button being absent from a page is not the same thing as a rule.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1500, height: 1050 } };
  const email = 'prt' + S + '@example.com';
  const PW = 'a-real-password-' + S;

  const stu = await browser.newContext(vp);
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Portal Student', email, phone: '9876500055', password: PW } });

  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);

  /* ================================================= 1. the demo answers */
  ok((await page.$$('#fillBtn')).length === 0, 'there is no "fill with demo answers"');
  const body = (await page.textContent('body').catch(() => '')) || '';
  ok(!/demo answers/i.test(body), 'and nothing offering them by another name');

  /* ==================================== 2. delete my account, behind a heading */
  ok(await page.$eval('#dangerZone', e => e.hidden),
    'deleting an account is not at the foot of the profile');
  const nav = await page.$$eval('#secNav button',
    b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(nav.some(n => /^Account$/i.test(n)),
    'there is an Account section in the nav — ' + nav.join(' | '));

  await page.click('[data-account]');
  await page.waitForTimeout(600);
  ok(!(await page.$eval('#dangerZone', e => e.hidden)),
    'and choosing it shows the way to delete one');
  ok(await page.$eval('#pForm', e => e.hidden),
    'with the form standing down rather than sitting under it');
  /* Still WORKING, not merely present — the app stores refuse a listing over
     this, and a control that is hidden and broken is worse than one that is
     visible and broken. */
  ok(await page.isVisible('#delOpen'), 'the control itself is there');
  await page.click('#delOpen');
  await page.waitForTimeout(400);
  ok(await page.isVisible('#delEmail') && await page.isVisible('#delPass'),
    'and it asks for the email and the password before it will do anything');

  await page.click('#secNav [data-i="0"]');
  await page.waitForTimeout(500);
  ok(await page.$eval('#dangerZone', e => e.hidden)
    && !(await page.$eval('#pForm', e => e.hidden)),
    'and going back to a section puts the form back');

  /* ============================== 3. family details is optional, not finished */
  const fam = nav.find(n => /family details/i.test(n)) || '';
  ok(/optional/i.test(fam),
    'an empty section with nothing required in it reads as optional — ' + fam);
  ok(!/100%/.test(fam),
    'and NOT as 100% complete, which is what it said — ' + fam);
  /* The rest of the form is untouched: a section that really does have
     required fields still counts them. */
  const personal = nav.find(n => /personal details/i.test(n)) || '';
  ok(/%$/.test(personal),
    'a section that does have required fields still shows a percentage — ' + personal);

  ok(errs.length === 0, 'no page errors on the profile — ' + errs.slice(0, 2).join(' | '));

  /* ================================================== 4. the Tab key */
  const docs = await stu.newPage();
  const derrs = [];
  docs.on('pageerror', e => derrs.push(String(e)));
  await docs.goto(BASE + '/documents.html', { waitUntil: 'domcontentloaded' });
  await docs.waitForTimeout(2600);

  const drop = await docs.$eval('[data-drop]', e => ({
    tab: e.getAttribute('tabindex'), role: e.getAttribute('role'),
    label: e.getAttribute('aria-label'),
  })).catch(() => null);
  ok(drop && drop.tab === '0', 'an upload card is in the tab order — ' + JSON.stringify(drop));
  ok(drop && drop.role === 'button', 'and announces itself as a button');
  ok(drop && /upload/i.test(drop.label || ''),
    'saying which document it is for — ' + (drop && drop.label));

  /* Driven, not read off an attribute: focus it and press Enter, and the file
     chooser has to open. An element can carry tabindex and still do nothing. */
  await docs.focus('[data-drop="passport"]');
  const focused = await docs.evaluate(() =>
    (document.activeElement || {}).getAttribute
      ? document.activeElement.getAttribute('data-drop') : null);
  ok(focused === 'passport', 'the keyboard can land on it — ' + focused);

  /* Two presses, twenty seconds. This is the one assertion in the suite that
     waits on the BROWSER rather than on our own page: a native file chooser is
     opened by chromium, not by the app, and on a machine running seventy
     suites back to back it has taken longer than four seconds to arrive. It
     went red once in a full run and green every time alone — which is the
     shape of a check that is measuring the machine, not the code.
     The failure it exists to catch is a card with no key handler at all, and
     that one never opens a chooser, however long anybody waits. */
  let chose = null;
  for (let i = 0; i < 2 && !chose; i++) {
    const chooser = docs.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
    await docs.keyboard.press('Enter');
    chose = await chooser;
  }
  ok(!!chose, 'and Enter opens the file chooser, as a button would');

  ok(derrs.length === 0, 'no page errors on documents — ' + derrs.slice(0, 2).join(' | '));

  /* ========================= 5. the tracker belongs to the office */
  const buyer = await browser.newContext(vp);
  const bmail = 'trk' + S + '@example.com';
  await buyer.request.post(BASE + '/api/orders', {
    data: { services: [{ id: 'shortlist-ten' }], name: 'Tracker ' + S, email: bmail,
      phone: '+919000006543', acceptedTerms: true },
  });
  await buyer.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
  await buyer.request.put(BASE + '/api/profile', {
    data: { profile: { fullName: 'Tracker', d_cgpa: '8.2', d_max: '10',
      g_level: "Master's", g_field: 'Data Science', g_country: 'Germany',
      g_intake: 'Winter 2027', b_total: 'Under ₹10 Lakhs' } },
  });
  const state = await (await buyer.request.get(BASE + '/api/state')).json();
  const first = (state.shortlist || [])[0];
  ok(!!first, 'the student has an application to look at — '
    + ((state.shortlist || []).length + ' rows'));

  const apps = await buyer.newPage();
  const aerrs = [];
  apps.on('pageerror', e => aerrs.push(String(e)));
  await apps.goto(BASE + '/applications.html', { waitUntil: 'domcontentloaded' });
  await apps.waitForTimeout(2800);

  ok((await apps.$$('[data-adv]')).length === 0,
    'the student cannot mark a stage done');
  ok((await apps.$$('[data-out]')).length === 0,
    'nor record their own offer');
  const atext = (await apps.textContent('#appList').catch(() => '')) || '';
  ok(/counsellor moves this on/i.test(atext),
    'and the screen says who does — ' + atext.replace(/\s+/g, ' ').slice(0, 90));
  /* The tracker itself is still there. Nothing was taken away that was the
     student's: seeing where an application has got to is what this is for. */
  ok(/Documents collected/i.test(atext) && /Submitted/i.test(atext),
    'while the stages are all still shown');
  ok(aerrs.length === 0, 'no page errors on applications — ' + aerrs.slice(0, 2).join(' | '));

  /* THE one that is a rule rather than a screen. */
  const push = await buyer.request.put(
    BASE + '/api/applications/' + encodeURIComponent(first.id), { data: { stage: 2 } });
  ok(push.status() === 403,
    'and the endpoint refuses it too, not just the page — ' + push.status());
  ok(/counsellor/i.test((await push.json()).error || ''),
    'saying whose job it is');

  const after = await (await buyer.request.get(BASE + '/api/state')).json();
  const app = (after.apps || {})[String(first.id)] || {};
  ok(!(Number(app.stage) >= 2),
    'and nothing moved — ' + JSON.stringify(app));

  /* The counsellor CAN, which is the other half of the sentence. */
  const admin = await browser.newContext(vp);
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const people = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const row = (people.students || []).find(x => x.email === bmail);
  ok(!!row, 'the student is on the office list — ' + (row && row.email));
  if (row) {
    const staff = await admin.request.put(
      BASE + '/api/staff/student/' + row.id + '/application/' + encodeURIComponent(first.id),
      { data: { stage: 1 } });
    ok(staff.ok(), 'the office can move it on — ' + staff.status());
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
