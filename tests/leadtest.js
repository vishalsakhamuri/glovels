/**
 * Every enquiry in one place, and what happened to it.
 *
 * They were all in one table already — the form, the chat box, the blog, the
 * Apply button — and that table was shown as a COUNT on a dashboard and, for a
 * while, a read-only list. Nothing recorded where a lead came from, who was
 * chasing it, how many times they had called, or why one did not convert. So
 * the three questions the office actually asks — is Facebook worth it, are we
 * following up, what do we keep losing on — had no answer anywhere.
 *
 * And a counsellor who talked somebody round had to go to another screen and
 * retype the name, the email and the number they were looking at.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();
  const staff = await browser.newContext({ viewport: { width: 1700, height: 1060 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const guest = await browser.newContext();

  /* ------------------------------------------------- where a lead came from */
  const send = (data, referer) => guest.request.post(BASE + '/api/enquiries',
    { data, headers: referer ? { Referer: referer } : {} });

  await send({ name: 'Ad ' + stamp, email: 'ad' + stamp + '@example.com', phone: '9876543210' },
    BASE + '/?utm_source=facebook&utm_campaign=aug-germany');
  await send({ name: 'Click ' + stamp, email: 'cl' + stamp + '@example.com', phone: '9876543211' },
    BASE + '/?gclid=abc123');
  await send({ name: 'Search ' + stamp, email: 'se' + stamp + '@example.com',
    phone: '9876543212', referrer: 'https://www.google.com/search?q=study+in+germany' });
  await send({ name: 'Direct ' + stamp, email: 'di' + stamp + '@example.com',
    phone: '9876543213' }, BASE + '/contact-us');
  await send({ name: 'Reader ' + stamp, email: 're' + stamp + '@example.com',
    phone: '9876543214', consent: 'blog', note: 'From the blog: Blocked accounts' },
    BASE + '/post/germany-blocked-account-increase-2027');

  const first = await (await staff.request.get(BASE + '/api/staff/leads')).json();
  const find = n => (first.leads || []).find(l => l.name === n + ' ' + stamp);

  check('a lead from a Facebook ad says Facebook',
    find('Ad') && find('Ad').source === 'facebook', find('Ad') && find('Ad').source);
  check('and carries the campaign it came from',
    find('Ad') && find('Ad').campaign === 'aug-germany', find('Ad') && find('Ad').campaign);
  check('a Google ad click is Google even with no utm tags',
    find('Click') && find('Click').source === 'google', find('Click') && find('Click').source);
  check('somebody who arrived from a Google search is Google',
    find('Search') && find('Search').source === 'google', find('Search') && find('Search').source);
  check('and somebody who just came to the site is the website',
    find('Direct') && find('Direct').source === 'website', find('Direct') && find('Direct').source);
  check('a lead from a post is the blog',
    find('Reader') && find('Reader').source === 'blog', find('Reader') && find('Reader').source);

  check('every lead starts with nobody owning it and nothing said',
    find('Ad').ownerId === null && find('Ad').followUps === 0);
  check('the book counts them by source',
    (first.summary.bySource.facebook || {}).leads >= 1,
    JSON.stringify(first.summary.bySource).slice(0, 120));

  /* ---------------------------------------------------------- on the screen */
  const page = await staff.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/leads', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);

  check('the leads screen lists them', (await page.$$('#leadRows tr[data-lead]')).length >= 5,
    (await page.$$('#leadRows tr[data-lead]')).length + ' rows');
  check('the counters are filled', (await page.textContent('#kAll')) !== '—',
    await page.textContent('#kAll'));
  check('and it says how many nobody has called',
    /^\d+$/.test(await page.textContent('#kCold')), await page.textContent('#kCold'));

  await page.fill('#fQ', 'Ad ' + stamp);
  await page.waitForTimeout(400);
  check('the book can be searched', (await page.$$('#leadRows tr[data-lead]')).length === 1,
    (await page.$$('#leadRows tr[data-lead]')).length + ' rows');

  /* The name, not the middle of the row. The Owner column now holds the
     control that hands the lead to somebody, and a click aimed at the centre
     of a six-column row lands on it — which is deliberately NOT a click that
     opens the lead, or choosing a name would swap the panel out from under
     the hand doing the choosing. */
  await page.click('#leadRows tr[data-lead] td:first-child');
  await page.waitForTimeout(1000);
  check('opening one shows what has been said', await page.isVisible('#thread'));
  check('with a way to call and to WhatsApp them',
    (await page.$$('a[href^="tel:"]')).length > 0
    && (await page.$$('a[href^="https://wa.me/"]')).length > 0);

  /* --------------------------------------------------------- the follow-ups */
  await page.selectOption('#nKind', 'call');
  await page.fill('#nBody', 'Called. Wants Germany, winter intake, worried about funds.');
  await page.click('#nGo');
  await page.waitForTimeout(1400);
  check('a call can be written down',
    (await page.textContent('#thread')).includes('worried about funds'));
  check('and the count goes up', (await page.textContent('#kFollow')) !== '0',
    await page.textContent('#kFollow'));

  const afterNote = await (await staff.request.get(BASE + '/api/staff/leads')).json();
  const adNow = (afterNote.leads || []).find(l => l.name === 'Ad ' + stamp);
  check('writing down a call is contacting them — it is not "new" any more',
    adNow.status === 'contacted', adNow.status);
  check('and whoever wrote it now owns it', !!adNow.ownerId, adNow.owner);

  /* ------------------------------------------------- why one did not convert */
  await page.selectOption('#dStatus', 'lost');
  await page.waitForTimeout(300);
  check('closing a lead asks why', await page.isVisible('#dWhy'));
  await page.click('#dSave');
  await page.waitForTimeout(900);
  check('and refuses to close it without a reason',
    (await page.textContent('#dErr')).length > 10, await page.textContent('#dErr'));

  await page.selectOption('#dWhy', 'budget');
  await page.click('#dSave');
  await page.waitForTimeout(1200);
  const closed = await (await staff.request.get(BASE + '/api/staff/leads')).json();
  check('with a reason it closes', (closed.leads.find(l => l.name === 'Ad ' + stamp) || {})
    .status === 'lost');
  check('and the reason is counted', (closed.summary.byReason || {}).budget >= 1,
    JSON.stringify(closed.summary.byReason));

  await page.click('.tab[data-t="where"]');
  await page.waitForTimeout(600);
  check('the sources are charted', (await page.$$('#srcBars .srcbar')).length >= 2,
    (await page.$$('#srcBars .srcbar')).length + ' bars');
  check('and so are the reasons leads are lost',
    (await page.$$('#lostBars .srcbar')).length >= 1);

  /* -------------------------------------------- a lead somebody took by phone */
  await page.click('.tab[data-t="book"]');
  await page.waitForTimeout(300);
  await page.click('#addLead');
  await page.waitForTimeout(400);
  check('a lead can be logged by hand', await page.isVisible('#aName'));
  await page.fill('#aName', 'Walkin ' + stamp);
  await page.fill('#aPhone', '9876500000');
  await page.fill('#aMail', 'walk' + stamp + '@example.com');
  await page.selectOption('#aSource', 'whatsapp');
  await page.fill('#aNote', 'Messaged the office WhatsApp about Canada');
  await page.click('#aGo');
  await page.waitForTimeout(1500);

  const withWalk = await (await staff.request.get(BASE + '/api/staff/leads')).json();
  const walk = (withWalk.leads || []).find(l => l.name === 'Walkin ' + stamp);
  check('and it goes into the same book', !!walk, 'not found');
  check('marked with where it came from', walk && walk.source === 'whatsapp', walk && walk.source);
  check('and owned by whoever wrote it down, not left for nobody',
    walk && !!walk.ownerId, walk && walk.owner);
  check('with the first note already on it', walk && walk.followUps >= 1, walk && walk.followUps);

  /* ------------------------------------------------- and then they say yes */
  const won = await staff.request.post(BASE + '/api/staff/lead/' + walk.id + '/convert',
    { data: {} });
  const wonBody = await won.json();
  check('a lead can be turned into a student', won.ok(), won.status());
  check('an account is made', wonBody.accountCreated === true);
  check('with a password nobody chose, shown once',
    (wonBody.password || '').length >= 8, (wonBody.password || '').length + ' characters');

  const login = await browser.newContext();
  const inOk = await login.request.post(BASE + '/api/auth/login',
    { data: { email: wonBody.student.email, password: wonBody.password } });
  check('and the student can sign in with it', inOk.ok(), inOk.status());
  const blocked = await login.request.get(BASE + '/api/state');
  check('but it opens nothing until they choose their own',
    blocked.status() === 403, blocked.status());
  const changed = await login.request.post(BASE + '/api/auth/change',
    { data: { current: wonBody.password, password: 'a-password-they-picked' } });
  check('and once they do, their dashboard opens', changed.ok(), changed.status());

  const after = await (await staff.request.get(BASE + '/api/staff/leads')).json();
  const wrow = (after.leads || []).find(l => l.id === walk.id);
  check('the lead is marked converted', wrow.status === 'converted', wrow.status);
  check('and tied to the account, so they are one person from here on',
    Number(wrow.studentId) === Number(wonBody.student.id));
  check('the conversion is counted', after.summary.converted >= 1, after.summary.converted);
  check('and against the source it came from',
    (after.summary.bySource.whatsapp || {}).converted >= 1,
    JSON.stringify(after.summary.bySource.whatsapp));

  /* Converting twice must not make a second account. */
  const again = await staff.request.post(BASE + '/api/staff/lead/' + walk.id + '/convert',
    { data: {} });
  const againBody = await again.json();
  check('converting again does not make a second account',
    again.ok() && againBody.accountCreated === false, JSON.stringify(againBody).slice(0, 80));

  /* A lead with no email cannot become an account — that is what they sign in with. */
  const noMail = await (await staff.request.post(BASE + '/api/staff/leads',
    { data: { name: 'Nomail ' + stamp, phone: '9876500001', source: 'phone' } })).json();
  const refused = await staff.request.post(BASE + '/api/staff/lead/' + noMail.lead.id + '/convert',
    { data: {} });
  check('a lead with no email cannot be converted', refused.status() === 422, refused.status());
  check('and says why', /email/i.test((await refused.json()).error || ''));

  /* ------------------------------------------- and only the people it is for */
  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  check('a student cannot read the lead book',
    (await stu.request.get(BASE + '/api/staff/leads')).status() === 403);
  check('and nobody signed out can either',
    (await guest.request.get(BASE + '/api/staff/leads')).status() === 401);

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
