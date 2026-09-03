/**
 * The B2B partner portal, and everything it must refuse.
 *
 * An agency sends Glovels students. It gets one login, adds student records in
 * bulk, and watches where each one has got to. It is not staff, and the whole
 * safety of the feature is that one sentence being true in code rather than in
 * the interface.
 *
 * So this suite is deliberately lopsided: a handful of checks that the screen
 * works, and a long run of checks that a partner is REFUSED — another agency's
 * students, the money, the leads, the organisation, the guidance notes a
 * counsellor writes. Every screen that reasoned "admin sees everything,
 * counsellor sees their own" gained a third case, and that is exactly where a
 * missed branch means one agency reading another's book.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

const PW_A = 'partner-alpha-9f2c';
const PW_B = 'partner-beta-4k7d';

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------ an admin makes two agencies */
  const makePartner = (name, email, password) => admin.request.post(BASE + '/api/staff/people',
    { data: { name, email, password, role: 'partner' } });

  const emailA = 'alpha' + stamp + '@agency.example';
  const emailB = 'beta' + stamp + '@agency.example';
  const ra = await makePartner('Alpha Overseas ' + stamp, emailA, PW_A);
  const rb = await makePartner('Beta Education ' + stamp, emailB, PW_B);
  check('an admin can create a partner agency', ra.ok(), ra.status() + ' ' +
    (ra.ok() ? '' : (await ra.text()).slice(0, 90)));
  check('and a second one', rb.ok(), rb.status());

  const people = await (await admin.request.get(BASE + '/api/staff/people')).json();
  const rowA = (people.people || []).find(p => p.email === emailA);
  check('the agency is on the people list with its role',
    rowA && rowA.role === 'partner', rowA ? rowA.role : 'not listed');

  /*
   * From the SCREEN, not from the API.
   *
   * The role worked everywhere the server was concerned and "Partner agency"
   * was not in the dropdown on the Add someone panel, so the one door a human
   * would use was shut while forty-three checks went green. Every check above
   * this line went through request.post, which is exactly why none of them
   * noticed. This one clicks.
   */
  const org = await admin.newPage();
  const orgErrs = [];
  org.on('pageerror', e => orgErrs.push(e.message));
  await org.goto(BASE + '/admin.html');
  await org.waitForSelector('#addPerson');
  await org.click('#addPerson');
  await org.waitForSelector('#pRole');

  const roles = await org.$$eval('#pRole option', o => o.map(x => x.value));
  check('the Add someone panel offers a partner agency', roles.includes('partner'),
    roles.join(','));

  const emailC = 'gamma' + stamp + '@agency.example';
  await org.fill('#pName', 'Gamma Global ' + stamp);
  await org.fill('#pEmail', emailC);
  await org.selectOption('#pRole', 'partner');
  await org.click('#pSave');
  await org.waitForTimeout(1400);

  const after = await (await admin.request.get(BASE + '/api/staff/people')).json();
  const rowC = (after.people || []).find(p => p.email === emailC);
  check('and an agency created from the screen is a partner',
    rowC && rowC.role === 'partner', rowC ? rowC.role : 'not created');

  /* The permission tick boxes grant power over the WEBSITE. A partner is not
     inside this business, and offering a control the server would refuse is
     worse than never offering it. */
  const perms = await org.$$eval('[data-perm]', b => b.map(x => x.dataset.perm));
  check('a partner row offers no website permissions',
    rowC && !perms.includes(String(rowC.id)),
    perms.join(',') + ' | partner is ' + (rowC && rowC.id));

  const roleOpts = rowC
    ? await org.$$eval('[data-role="' + rowC.id + '"] option', o => o.map(x => x.value))
    : [];
  check('and the change-role dropdown knows the role exists',
    roleOpts.includes('partner'), roleOpts.join(','));
  check('the row says it is an agency, not a caseload',
    /Partner agency/.test(await org.textContent('#counsellors')));
  check('no page errors on the organisation screen', orgErrs.length === 0, orgErrs[0] || '');
  await org.close();

  /* A partner account is created with a password somebody else chose, so it
     opens exactly one thing until that is replaced — same rule as staff. */
  const signIn = async (email, password) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email, password } });
    /* The password was chosen by an admin, so the account opens exactly one
       thing until it is replaced — the same rule staff accounts follow, and
       one a partner must not be exempt from. */
    await ctx.request.post(BASE + '/api/auth/change',
      { data: { current: password, password: password + 'X' } });
    return ctx;
  };
  const held = await browser.newContext();
  await held.request.post(BASE + '/api/auth/login', { data: { email: emailA, password: PW_A } });
  const beforeChange = await held.request.get(BASE + '/api/partner/me');
  check('a partner with a password somebody else chose opens nothing',
    beforeChange.status() === 403 && (await beforeChange.json()).mustChange === true,
    beforeChange.status() + '');

  const ctxA = await signIn(emailA, PW_A);
  const meA = await ctxA.request.get(BASE + '/api/partner/me');
  check('a partner can open their own portal', meA.ok(),
    meA.status() + ' ' + (meA.ok() ? '' : (await meA.text()).slice(0, 90)));

  /* ------------------------------------------------------- adding students */
  const addA = await ctxA.request.post(BASE + '/api/partner/students', {
    data: {
      students: [
        { name: 'Priya A' + stamp, email: 'priya' + stamp + '@ex.example', phone: '9876500101',
          destination: 'Germany', level: "Master's", field: 'Data Science' },
        { name: 'Rahul A' + stamp, email: 'rahul' + stamp + '@ex.example', phone: '9876500102',
          destination: 'Poland', level: "Master's" },
        { name: '', email: 'noname' + stamp + '@ex.example' },
        { name: 'Bad Email', email: 'not-an-email' },
        { name: 'Priya Again', email: 'priya' + stamp + '@ex.example' },
      ],
    },
  });
  const outA = await addA.json();
  check('a partner adds students in one go', outA.added && outA.added.length === 2,
    (outA.added || []).length + ' added');
  check('and every bad row is reported, not silently dropped',
    outA.rejected && outA.rejected.length === 3,
    (outA.rejected || []).map(x => x.why).join(' | '));
  check('a row with no name says so',
    (outA.rejected || []).some(x => /no name/.test(x.why)));
  check('a row that is not an email says so',
    (outA.rejected || []).some(x => /not an email/.test(x.why)));
  check('and the same person twice says already on your list',
    (outA.rejected || []).some(x => /already on your list/.test(x.why)),
    (outA.rejected || []).map(x => x.why).join(' | '));

  /* Two hundred is the limit, and it is a refusal rather than a truncation —
     silently keeping 200 of 260 rows is how sixty students go missing. */
  const flood = await ctxA.request.post(BASE + '/api/partner/students', {
    data: { students: Array.from({ length: 260 }, (_, i) =>
      ({ name: 'F' + i, email: 'f' + i + stamp + '@ex.example' })) },
  });
  check('more than two hundred rows is refused, not trimmed', flood.status() === 422,
    flood.status());
  const stillA = await (await ctxA.request.get(BASE + '/api/partner/students')).json();
  check('and nothing from that file went in', stillA.students.length === 2,
    stillA.students.length + ' on the books');

  /* ------------------------------- the students arrive where Glovels wants */
  const staffList = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const priya = staffList.students.find(s => s.name === 'Priya A' + stamp);
  check('a partner student is on the office roster', !!priya);
  check('and arrives unassigned, for the office to hand out',
    priya && !priya.counsellor, priya && priya.counsellor && priya.counsellor.name);

  /* ------------------------------------------------- ONE AGENCY, ONE BOOK */
  const ctxB = await signIn(emailB, PW_B);
  await ctxB.request.post(BASE + '/api/partner/students', {
    data: { students: [{ name: 'Sana B' + stamp, email: 'sana' + stamp + '@ex.example' }] },
  });
  const listB = await (await ctxB.request.get(BASE + '/api/partner/students')).json();
  check('the second agency sees only its own student',
    listB.students.length === 1 && listB.students[0].name === 'Sana B' + stamp,
    listB.students.map(s => s.name).join(','));
  check('and the first agency cannot see theirs',
    !stillA.students.some(s => /Sana B/.test(s.name)));

  /* ------------------------------------------------ and nothing of Glovels */
  const forbidden = [
    ['the student roster', 'GET', '/api/staff/students'],
    ['one student file', 'GET', '/api/staff/student/' + (priya ? priya.id : 1)],
    ['the money', 'GET', '/api/staff/money'],
    ['the leads book', 'GET', '/api/staff/leads'],
    ['the people list', 'GET', '/api/staff/people'],
    ['the order book', 'GET', '/api/staff/orders'],
    ['the conversations', 'GET', '/api/staff/conversations'],
    ['the overview', 'GET', '/api/staff/overview'],
    ['the staff identity', 'GET', '/api/staff/me'],
  ];
  for (const [what, method, path_] of forbidden) {
    const r = await ctxA.request.fetch(BASE + path_, { method });
    check('a partner is refused ' + what, r.status() === 403 || r.status() === 404,
      r.status() + '');
  }

  /* The guidance notes a counsellor writes about a student. The student never
     sees those and neither does the agency that introduced them. */
  const guide = await ctxA.request.get(BASE + '/api/staff/student/'
    + (priya ? priya.id : 1) + '/guidance');
  check('a partner is refused the counsellor notes',
    guide.status() === 403 || guide.status() === 404, guide.status() + '');

  /* And the other way: a partner endpoint refuses everybody who is not one. */
  const asAdmin = await admin.request.get(BASE + '/api/partner/students');
  check('an admin is not a partner either', asAdmin.status() === 403, asAdmin.status() + '');
  const stranger = await browser.newContext();
  const out = await stranger.request.get(BASE + '/api/partner/students');
  check('and nobody signed out gets in', out.status() === 401 || out.status() === 403,
    out.status() + '');

  /* A partner cannot put a student on somebody else's book by saying so. */
  const spoof = await ctxB.request.post(BASE + '/api/partner/students', {
    data: { students: [{ name: 'Spoof' + stamp, email: 'spoof' + stamp + '@ex.example',
      partner_id: 1, partnerId: 1 }] },
  });
  check('a partner cannot file a student under another agency', spoof.ok());
  const afterSpoof = await (await ctxA.request.get(BASE + '/api/partner/students')).json();
  check('and it did not land on the other book',
    !afterSpoof.students.some(s => /Spoof/.test(s.name)),
    afterSpoof.students.map(s => s.name).join(','));

  /* -------------------------------------------------------- deleting an agency */
  const del = await admin.request.fetch(BASE + '/api/staff/people/'
    + (rowA ? rowA.id : 0), { method: 'DELETE' });
  check('an agency with students on the books cannot be deleted',
    del.status() === 409, del.status() + '');

  /* And the same damage by a different door: a role change would leave those
     students pointing at somebody who is not an agency, on a screen that would
     never show it again. */
  const demote = await admin.request.put(BASE + '/api/staff/people/'
    + (rowA ? rowA.id : 0) + '/role', { data: { role: 'counsellor' } });
  check('nor turned into a counsellor while it holds them',
    demote.status() === 409, demote.status() + '');

  /* The other end of it: a counsellor carrying a caseload cannot become an
     agency, because that would take those students out of every staff list. */
  const cslr = (people.people || []).find(p => p.role === 'counsellor' && p.caseload);
  if (cslr) {
    const promote = await admin.request.put(BASE + '/api/staff/people/' + cslr.id + '/role',
      { data: { role: 'partner' } });
    check('and a counsellor with students cannot become one',
      promote.status() === 409, promote.status() + '');
  }

  /* ----------------------------------------------------------- the screen */
  const page = await ctxA.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/partner.html');
  await page.waitForSelector('#stuRows tr');
  check('the portal lists their students', (await page.$$('#stuRows tr')).length === 2,
    (await page.$$('#stuRows tr')).length + ' rows');
  check('and counts them', (await page.textContent('#kStudents')) === '2',
    await page.textContent('#kStudents'));
  check('a student nobody is on says it is waiting on Glovels',
    /not yet assigned/i.test(await page.textContent('#stuRows')));

  /* No staff rail. A link to a screen that would refuse them is worse than no
     link — it reads as something broken rather than something withheld. */
  const nav = await page.$$eval('.p-nav a', a => a.map(x => x.getAttribute('href')));
  check('the rail offers only their own screen',
    nav.length === 1 && nav[0] === 'partner.html', nav.join(','));
  check('and there is no bell to press', (await page.$$('#bell')).length === 0);

  /* Pasted from Excel: tabs, and a header row somebody copied by accident.
     The add panel is a dialog since patch 58, and the paste box a disclosure
     inside it — an agency adding one student should not have to look at a
     textarea meant for two hundred. */
  await page.click('#openAdd');
  await page.waitForSelector('#addModal.on');
  await page.click('#addModal details > summary');
  await page.fill('#bulk',
    'name\temail\tphone\n'
    + 'Tab One' + stamp + '\ttab1' + stamp + '@ex.example\t9876500201\n'
    + 'Tab Two' + stamp + '\ttab2' + stamp + '@ex.example\t9876500202');
  await page.click('#addMany');
  await page.waitForTimeout(1200);
  await page.click('#addModal [data-close]');
  await page.waitForTimeout(200);
  check('a sheet pasted with tabs goes in',
    (await page.$$('#stuRows tr')).length === 4,
    (await page.$$('#stuRows tr')).length + ' rows');
  check('and the header row it came with is not a student',
    !/\bemail\s*·/i.test(await page.textContent('#stuRows')));

  /* ------------------------------------------------------------ the logo */
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA'
    + 'C0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const put = await ctxA.request.put(BASE + '/api/partner/logo', { data: { logo: png } });
  check('a partner can put their own mark up', put.ok(), put.status() + '');
  const notAnImage = await ctxA.request.put(BASE + '/api/partner/logo',
    { data: { logo: 'data:text/html;base64,PHNjcmlwdD4=' } });
  check('and cannot put something that is not an image',
    notAnImage.status() === 422, notAnImage.status() + '');
  const huge = await ctxA.request.put(BASE + '/api/partner/logo',
    { data: { logo: 'data:image/png;base64,' + 'A'.repeat(500000) } });
  check('nor one the size of a page', huge.status() === 422, huge.status() + '');

  await page.reload();
  await page.waitForSelector('#stuRows tr');
  await page.waitForTimeout(600);
  check('their logo replaces ours on their screen',
    await page.$eval('#ownLogo', e => !e.hidden && /^data:image/.test(e.src)));

  /* ============================================ one student, opened ==== */
  const mine = (await (await ctxA.request.get(BASE + '/api/partner/students')).json()).students;
  const one = mine[0];

  const full = await (await ctxA.request.get(BASE + '/api/partner/student/' + one.id)).json();
  check('a partner can open one of their own students', !!full.id && full.id === one.id);
  check('and it carries the profile and the document slots',
    typeof full.profile === 'object' && typeof full.docs === 'object');

  /* The gate. Beta's student, opened by Alpha, must answer the same way a
     student that does not exist would — there is nothing to learn here. */
  const hers = (await (await ctxB.request.get(BASE + '/api/partner/students')).json())
    .students[0];
  const peek = await ctxA.request.get(BASE + '/api/partner/student/' + hers.id);
  check('and cannot open another agency\'s', peek.status() === 404, peek.status() + '');
  const peekProf = await ctxA.request.put(BASE + '/api/partner/student/' + hers.id + '/profile',
    { data: { profile: { fullName: 'Nope' } } });
  check('nor write to one', peekProf.status() === 404, peekProf.status() + '');

  /* --------------------------------------- details, filled in by the agency */
  const saved = await ctxA.request.put(BASE + '/api/partner/student/' + one.id + '/profile', {
    data: { profile: {
      fullName: 'Priya A' + stamp, phone: '9876500111', d_cgpa: '8.4',
      g_country: 'Germany', g_level: "Master's", g_field: 'Data Science',
      p_has: 'Yes', p_num: 'M1234567',
    } },
  });
  check('the agency can fill in the student\'s details', saved.ok(), saved.status() + '');

  /* THE record, not a second one shaped like it — the counsellor has to see
     what the agency typed. */
  const asStaff = await (await admin.request.get(BASE + '/api/staff/student/' + one.id)).json();
  check('and the counsellor reads what they typed',
    asStaff.profile && asStaff.profile.d_cgpa === '8.4',
    asStaff.profile ? JSON.stringify(asStaff.profile).slice(0, 70) : 'no profile');
  check('and the destination reaches the partner\'s own list',
    (await (await ctxA.request.get(BASE + '/api/partner/students')).json())
      .students.find(x => x.id === one.id).destination === 'Germany');

  /* ------------------------------------------------ a document, uploaded */
  const upload = async (ctx, id, key, body) => {
    const boundary = '----glovels' + Math.random().toString(16).slice(2);
    const head = '--' + boundary + '\r\nContent-Disposition: form-data; name="key"\r\n\r\n'
      + key + '\r\n--' + boundary
      + '\r\nContent-Disposition: form-data; name="file"; filename="' + key + '.pdf"\r\n'
      + 'Content-Type: application/pdf\r\n\r\n';
    const tail = '\r\n--' + boundary + '--\r\n';
    return ctx.request.post(BASE + '/api/partner/student/' + id + '/document', {
      headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
      data: Buffer.concat([Buffer.from(head), Buffer.from(body), Buffer.from(tail)]),
    });
  };

  const up = await upload(ctxA, one.id, 'passport', '%PDF-1.4 a passport');
  check('the agency can upload a document for their student', up.ok(), up.status() + '');
  const upBody = up.ok() ? await up.json() : { docs: {} };
  check('it lands in the right slot', !!upBody.docs.passport,
    Object.keys(upBody.docs).join(','));
  /* Arriving 'wait', never 'ok'. A document nobody at Glovels has looked at is
     not verified whoever sent it. */
  check('and arrives unverified, whoever sent it',
    upBody.docs.passport && upBody.docs.passport.status === 'wait',
    upBody.docs.passport && upBody.docs.passport.status);

  /* The student's own folder, where the counsellor already looks — not a
     partner area somebody would then have to copy across. */
  const staffDocs = await (await admin.request.get(BASE + '/api/staff/student/' + one.id)).json();
  check('the counsellor sees it on the student\'s own file',
    (staffDocs.docs || []).some(d => d.key === 'passport'),
    (staffDocs.docs || []).map(d => d.key).join(','));

  const visaUp = await upload(ctxA, one.id, 'visa-offer', '%PDF-1.4 an offer letter');
  check('and a visa document too', visaUp.ok(), visaUp.status() + '');

  const back = await ctxA.request.get(BASE + '/api/partner/student/' + one.id
    + '/document/passport/file');
  check('they can read their own student\'s file back', back.ok(), back.status() + '');
  const steal = await ctxB.request.get(BASE + '/api/partner/student/' + one.id
    + '/document/passport/file');
  check('and another agency cannot', steal.status() === 404, steal.status() + '');

  const noUpload = await upload(ctxB, one.id, 'passport', 'nope');
  check('nor upload onto somebody else\'s student', noUpload.status() === 404,
    noUpload.status() + '');

  /* ------------------------------------------------------- colleagues ---- */
  const mate = await ctxA.request.post(BASE + '/api/partner/team', {
    data: { name: 'Anita ' + stamp, email: 'anita' + stamp + '@agency.example' },
  });
  check('an agency can add a colleague', mate.ok(), mate.status() + ' '
    + (mate.ok() ? '' : (await mate.text()).slice(0, 80)));
  const matePw = mate.ok() ? (await mate.json()).password : '';

  const ctxM = await browser.newContext();
  await ctxM.request.post(BASE + '/api/auth/login',
    { data: { email: 'anita' + stamp + '@agency.example', password: matePw } });
  await ctxM.request.post(BASE + '/api/auth/change',
    { data: { current: matePw, password: matePw + 'X' } });

  const mateList = await (await ctxM.request.get(BASE + '/api/partner/students')).json();
  check('a colleague sees the same book, not an empty one',
    mateList.students && mateList.students.length === mine.length,
    (mateList.students || []).length + ' vs ' + mine.length);

  /* One agency, one book — a colleague's additions belong to the agency and
     not to whichever colleague happened to type them in. */
  await ctxM.request.post(BASE + '/api/partner/students', {
    data: { students: [{ name: 'ByMate' + stamp, email: 'bymate' + stamp + '@ex.example' }] },
  });
  const ownerSees = await (await ctxA.request.get(BASE + '/api/partner/students')).json();
  check('and what a colleague adds lands on the agency\'s book',
    ownerSees.students.some(x => /ByMate/.test(x.name)));

  const mateTeam = await ctxM.request.post(BASE + '/api/partner/team',
    { data: { name: 'Nope', email: 'nope' + stamp + '@agency.example' } });
  check('but a colleague cannot add colleagues of their own',
    mateTeam.status() === 403, mateTeam.status() + '');
  const mateLogo = await ctxM.request.put(BASE + '/api/partner/logo', { data: { logo: '' } });
  check('nor change the agency logo', mateLogo.status() === 403, mateLogo.status() + '');

  /* And Beta still sees only Beta's. */
  const betaAgain = await (await ctxB.request.get(BASE + '/api/partner/students')).json();
  check('the other agency is untouched by any of it',
    betaAgain.students.every(x => !/ByMate|Priya A/.test(x.name)),
    betaAgain.students.map(x => x.name).join(','));

  /* ------------------------------------------------ the screen, opened --- */
  await page.reload();
  await page.waitForSelector('#stuRows tr.prow');
  await page.waitForTimeout(800);

  /* Different students go to different places, so the book splits by
     destination rather than totalling them into one number. */
  const chips = await page.$$eval('.dest', b => b.map(x => x.textContent.trim()));
  check('the book splits by destination', chips.length >= 2, chips.join(' | '));

  /* Whoever is at the top — the book is sorted by id, and this suite has been
     adding students throughout, so naming one here would be a test that knows
     too much about the order. */
  const topName = await page.$eval('#stuRows tr.prow td b', e => e.textContent.trim());
  await page.$eval('#stuRows tr.prow', el => el.click());
  await page.waitForSelector('.ptab');
  await page.waitForTimeout(700);
  check('a row opens the student', !(await page.$eval('#oneView', e => e.hidden)));
  check('and the heading follows them in',
    (await page.$eval('.p-top h1', e => e.textContent.trim())) === topName,
    await page.$eval('.p-top h1', e => e.textContent) + ' vs ' + topName);

  const panes = await page.$$eval('.ptab', t => t.map(x => x.textContent.trim()));
  check('with details, documents, visa and universities',
    panes.join(',') === 'Details,Documents,Visa file,Universities', panes.join(','));

  await page.$eval('.ptab[data-p="docs"]', el => el.click());
  await page.waitForTimeout(400);
  const slots = await page.$$('#p-docs .dcard');
  /* Counted against the list itself rather than a number typed in here: the
     checklist grows when the counsellors ask for a document, and a hard-coded
     12 turns that into a failing test rather than a passing one. */
  const want = await page.evaluate(() =>
    (typeof DOCS !== 'undefined' ? DOCS.length : -1)).catch(() => -1);
  check('every document slot is on the screen', want > 0 && slots.length === want,
    slots.length + ' cards');
  check('and each says what it blocks',
    (await page.$$('#p-docs .dcard .blocks')).length === slots.length);

  await page.$eval('.ptab[data-p="visa"]', el => el.click());
  await page.waitForTimeout(400);
  /* Counted from the page's own list. The visa checklist grows — the cover
     letter we write was added to it — and pinning the number fails on every
     addition while proving nothing about whether the cards match the list. */
  const wantVisa = await page.evaluate(
    () => (typeof VISA_DOCS !== 'undefined' ? VISA_DOCS.length : 0));
  check('the visa file has its own slots',
    wantVisa > 0 && (await page.$$('#p-visa .dcard')).length === wantVisa,
    (await page.$$('#p-visa .dcard')).length + ' cards for ' + wantVisa + ' documents');
  /* And one of them is the letter WE write, offered as a download rather than
     an upload box. */
  check('including the cover letter we write ourselves',
    /Visa cover letter/.test(await page.textContent('#p-visa')));

  await page.$eval('.ptab[data-p="details"]', el => el.click());
  await page.waitForTimeout(400);
  check('the details form is the student\'s own field list',
    (await page.$$('#p-details [data-f]')).length > 40,
    (await page.$$('#p-details [data-f]')).length + ' fields');

  await page.$eval('#backToList', el => el.click());
  await page.waitForTimeout(400);
  check('and there is a way back', !(await page.$eval('#listView', e => e.hidden)));

  check('no page errors', errs.length === 0, errs[0] || '');

  await browser.close();
  ok.forEach(n => console.log('  ok   ' + n));
  bad.forEach(n => console.log('  BAD  ' + n));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
