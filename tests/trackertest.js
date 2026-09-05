/**
 * The application tracker, after the last block of Student View Changes.
 *
 * Five notes, and one thread running through all of them: the screen a student
 * opens to ask "where is mine up to" could show them five stages and one badge
 * and nothing else. Every other fact about their application — why it is late,
 * whether it was actually filed, what the university wrote back — lived in a
 * chat thread, scrolled away from the application it was about.
 *
 *   "MY UNIVERSITIES → MY PROGRAMS." It was never a list of universities. A
 *   student with three courses at TU Dortmund has one university and three
 *   rows, and the row they act on — the thing with a deadline, an entry bar
 *   and an application of its own — is the programme.
 *
 *   "REMOVE FIT SCORE, ADD GERMAN GRADE REQUIREMENT" on the cards. The fit
 *   score was a number out of 100 that the office types into a spreadsheet,
 *   shown to a student with no scale and nothing to do about it. The German
 *   grade is the number on the transcript they already have — and the scale
 *   RUNS BACKWARDS, so the one thing this file has to prove is that 2.3 meets
 *   a bar of 2.5 and 2.8 does not.
 *
 *   "APPLICATION OVERVIEW: shortlisted, in prep, submitted, waitlist,
 *   rejections, offers." Six. The four that were there counted a waitlist and
 *   a rejection together as "decisions in", which is a number nobody wants.
 *
 *   "A STATUS UPDATE TEXT BOX FOR EACH APPLICATION." Written by the
 *   counsellor, read by the student — and it must survive the stage moving,
 *   because the row is written with INSERT OR REPLACE and a note that vanishes
 *   when somebody advances a dropdown is worse than no note at all.
 *
 *   "UPLOAD THE SCREENSHOT OF THE SUBMITTED APPLICATION AND THE DECISION PDF."
 *   Against the application, not on the Documents screen — that list is the
 *   fourteen things the STUDENT provides, and six counters read it as "how far
 *   through their documents are they".
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const pdf = n => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n, 0x41)]);

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1500, height: 1050 } };

  const stu = await browser.newContext(vp);
  const email = 'track' + S + '@example.com';
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Track Me', email, phone: '9876500098',
      password: 'a-real-password-' + S } });
  const state = async () => (await (await stu.request.get(BASE + '/api/state')).json());

  const admin = await browser.newContext(vp);
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const people = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const row = (people.students || []).find(x => x.email === email);
  ok(!!row, 'the student is on the office list');
  const SID = row && row.id;

  /* FIVE, and the fifth is never touched.
     A shortlisted programme nobody has moved yet sits at stage 0, and "in prep"
     has to count it. Four programmes with a stage set on each looked identical
     whether "in prep" was written as the complement of "submitted" or as a test
     for one particular stage — so the check passed either way and proved
     nothing. The untouched row is what tells them apart. */
  const cat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json();
  const progs = (cat.programmes || []).slice(0, 5);
  ok(progs.length === 5, 'five programmes to work with — ' + progs.length);
  for (const p of progs) {
    const r = await admin.request.post(BASE + '/api/staff/student/' + SID + '/shortlist',
      { data: { id: p.id } });
    ok(r.ok(), 'shortlisted ' + p.id + ' — ' + r.status());
  }
  const app = (id, body) => admin.request.put(
    BASE + '/api/staff/student/' + SID + '/application/' + id, { data: body });

  /* ============================================ 1. it is called My Programs */
  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/universities.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  const nav = (await page.textContent('.p-nav')) || '';
  ok(/My Programs/.test(nav), 'the menu says My Programs — ' + nav.replace(/\s+/g, ' ').slice(0, 120));
  ok(!/My Universities/.test(nav), 'and not My Universities');
  const h1 = (await page.textContent('h1')) || '';
  ok(/My Programs/i.test(h1), 'and so does the heading — ' + h1.trim().slice(0, 60));

  /* Every screen in the account, because a menu that renames itself on one
     page and not the next is worse than not renaming it. */
  for (const p of ['dashboard.html', 'documents.html', 'applications.html', 'profile.html']) {
    const o = await stu.newPage();
    await o.goto(BASE + '/' + p, { waitUntil: 'domcontentloaded' });
    await o.waitForTimeout(1500);
    const t = (await o.textContent('body')) || '';
    ok(!/My Universities/.test(t), p + ' does not say My Universities any more');
    await o.close();
  }

  /* ================== 2. the German grade on the card, and the fit score off */
  /* A grade has to be PUT on a programme first: the column is new, the shipped
     catalogue has it blank on all 171 rows, and a test that passes because a
     feature is invisible has proved nothing. */
  const g = progs[0];
  const setG = await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, g, { germanGpa: 2.5 }) });
  ok(setG.ok(), 'a programme can be given a German grade — ' + setG.status());

  /* Their own grade, from their own transcript. 8.0 out of 10 with a pass mark
     of 4: 1 + 3 × (10 − 8) / (10 − 4) = 2.0, which MEETS a bar of 2.5 because
     lower is better. This is the whole feature. */
  /* The route takes { profile: {...} }, not the fields at the top level — a
     bare object is accepted with a 200 and stores nothing at all. */
  const profile = async d => stu.request.put(BASE + '/api/profile', { data: { profile: d } });
  await profile({ d_cgpa: '8.0', d_max: '10', d_pass: '4' });

  const cards = await stu.newPage();
  const cerrs = [];
  cards.on('pageerror', e => cerrs.push(String(e)));
  await cards.goto(BASE + '/universities.html', { waitUntil: 'domcontentloaded' });
  await cards.waitForTimeout(2800);
  const mine = (await cards.textContent('#mineWrap')) || '';
  ok(/German 2\.5 or better/i.test(mine),
    'the card states the German grade the programme asks for — '
    + mine.replace(/\s+/g, ' ').slice(0, 200));
  ok(/yours is 2\.0/i.test(mine),
    'and what theirs is, converted by the Bavarian formula — '
    + (mine.match(/yours is [\d.]+[^<]{0,30}/i) || [''])[0]);
  ok(!/does not meet it/i.test(mine),
    'and 2.0 MEETS a bar of 2.5, because the scale runs backwards — '
    + (mine.match(/Asks for German[^·]{0,60}/i) || [''])[0]);
  ok(!/Fit score/i.test(mine),
    'and the fit score is gone from the card — ' + mine.replace(/\s+/g, ' ').slice(0, 160));

  /* The other direction, which is the one a mistake would show up in. 6.0 out
     of 10 with a pass mark of 4 is 3.0 — a worse grade than 2.5, and a bigger
     number. A `>=` written out of habit passes the first case and fails this
     one, which is why both are here. */
  await profile({ d_cgpa: '6.0', d_max: '10', d_pass: '4' });
  await cards.reload({ waitUntil: 'domcontentloaded' });
  await cards.waitForTimeout(2800);
  const worse = (await cards.textContent('#mineWrap')) || '';
  ok(/yours is 3\.0/i.test(worse),
    'a weaker transcript converts to a HIGHER German number — '
    + (worse.match(/yours is [\d.]+[^<]{0,34}/i) || [''])[0]);
  ok(/does not meet it/i.test(worse),
    'and 3.0 does NOT meet a bar of 2.5 — said in words, not only in red');
  ok(cerrs.length === 0, 'no page errors on My Programs — ' + cerrs.slice(0, 2).join(' | '));

  /* Browse programmes draws the same cards, and the note asked for both. */
  await cards.click('[data-pane="browse"]');
  await cards.waitForTimeout(1800);
  const browse = (await cards.textContent('#allGrid')) || '';
  ok(!/Fit score/i.test(browse),
    'the fit score is gone from Browse programmes too — '
    + browse.replace(/\s+/g, ' ').slice(0, 140));
  /* The SORT stays. Taking "Best fit" out of the dropdown as well changed the
     default order of a 171-row list, and reachtest went red because a
     programme it had added moved past the "show more" cap. The note asked for
     the score off the CARDS — a number out of 100 a student cannot interpret;
     the office's ordering of which rows to read first is a different thing and
     is still the sensible default here. */
  const sorts = (await cards.textContent('#fSort')) || '';
  ok(/Best fit/i.test(sorts),
    'but the ordering by it survives — what was removed is the number on the '
    + 'card, not the office\'s view of which rows to read first — ' + sorts);

  /* ==================================================== 3. the six counters */
  /* One of each, so a counter that reads another counter's rows is caught.
     Stage 2 is Submitted; anything before it is in prep. */
  await app(progs[0].id, { stage: 1, outcome: '' });               // in prep
  await app(progs[1].id, { stage: 2, outcome: '' });               // submitted
  await app(progs[2].id, { stage: 4, outcome: 'waitlist' });       // submitted + waitlisted
  await app(progs[3].id, { stage: 4, outcome: 'rejected' });       // submitted + rejected

  const apps = await stu.newPage();
  const aerrs = [];
  apps.on('pageerror', e => aerrs.push(String(e)));
  const counters = async () => {
    await apps.goto(BASE + '/applications.html', { waitUntil: 'domcontentloaded' });
    await apps.waitForTimeout(2600);
    const out = {};
    for (const k of ['kTotal', 'kPrep', 'kSent', 'kWait', 'kRej', 'kOffer']) {
      out[k] = Number(await apps.textContent('#' + k));
    }
    return out;
  };
  let k = await counters();
  ok(k.kTotal === 5, 'shortlisted counts the whole list — ' + JSON.stringify(k));
  ok(k.kPrep === 2,
    'in prep is everything that has not gone out — the one being drafted AND '
    + 'the one nobody has started, which is the row a stage test of its own '
    + 'would drop — ' + k.kPrep);
  ok(k.kSent === 3, 'submitted is everything at stage 2 or past it — ' + k.kSent);
  ok(k.kPrep + k.kSent === k.kTotal,
    'and the two of them always add up to the shortlist — ' + k.kPrep + '+' + k.kSent);
  ok(k.kWait === 1, 'a waitlist is its own number — ' + k.kWait);
  ok(k.kRej === 1, 'and so is a rejection — ' + k.kRej);
  ok(k.kOffer === 0, 'no offers yet — ' + k.kOffer);

  /* An offer that was taken up is still an offer that arrived. Counting only
     the rows sitting at 'offer' understates the year every time somebody
     records what happened next. */
  await app(progs[1].id, { stage: 4, outcome: 'enrolled' });
  k = await counters();
  ok(k.kOffer === 1,
    'an application recorded as ENROLLED still counts as an offer — ' + k.kOffer);
  ok(k.kRej === 1 && k.kWait === 1, 'and the other two are unmoved');

  /* ============================================ 4. the counsellor's note */
  const NOTE = 'Their portal was down on Friday. Filed Monday, reference TUM-4471.';
  const put = await app(progs[0].id, { stage: 1, outcome: '', note: NOTE });
  ok(put.ok(), 'a counsellor can write a note on one application — ' + put.status());
  ok((await put.json()).noted === true, 'and it is reported as written');

  let st = await state();
  ok((st.apps[progs[0].id] || {}).note === NOTE,
    'it is on the application — ' + ((st.apps[progs[0].id] || {}).note || '').slice(0, 40));
  ok(!!(st.apps[progs[0].id] || {}).noteAt, 'with when it was written');

  /* THE ONE THAT WOULD HAVE SHIPPED BROKEN. The row is written with INSERT OR
     REPLACE, which sets every column the call does not mention back to its
     default — so advancing the stage would have wiped the note, silently, on
     the screen that shows it. */
  await app(progs[0].id, { stage: 2, outcome: '' });
  st = await state();
  ok((st.apps[progs[0].id] || {}).note === NOTE,
    'and moving the stage afterwards does NOT wipe it — '
    + JSON.stringify(st.apps[progs[0].id]));

  /* Absent and empty are different answers. */
  const cleared = await app(progs[0].id, { stage: 2, outcome: '', note: '' });
  ok(cleared.ok(), 'and a counsellor can clear it — ' + cleared.status());
  st = await state();
  ok(!(st.apps[progs[0].id] || {}).note, 'which really does empty it');
  await app(progs[0].id, { stage: 2, outcome: '', note: NOTE });

  /* On the student's own screen, which is the point of writing it. */
  await apps.goto(BASE + '/applications.html', { waitUntil: 'domcontentloaded' });
  await apps.waitForTimeout(2600);
  const said = (await apps.textContent('body')) || '';
  ok(said.includes('TUM-4471'),
    'the student reads it on the application it is about — '
    + (said.match(/Latest from your counsellor[^]{0,90}/) || [''])[0].replace(/\s+/g, ' '));
  ok(/Latest from your counsellor/i.test(said), 'under a heading that says whose it is');
  /* And it reached them where they already look. */
  const msgs = (await (await stu.request.get(BASE + '/api/state')).json()).msgs || [];
  ok(msgs.some(m => String(m.t || '').includes('TUM-4471')),
    'and they were told, rather than being expected to go and look');

  /* The student may not write one. A box being absent from a page is not the
     same as an endpoint being shut. */
  const cheat = await stu.request.put(
    BASE + '/api/staff/student/' + SID + '/application/' + progs[0].id,
    { data: { stage: 4, outcome: 'offer', note: 'I got in' } });
  ok(!cheat.ok(),
    'a student cannot write their own counsellor note — ' + cheat.status());
  st = await state();
  ok((st.apps[progs[0].id] || {}).note === NOTE, 'and the real one is untouched');

  /* ================ 5. the submission screenshot and the decision letter */
  const file = (kind, name) => admin.request.post(
    BASE + '/api/staff/student/' + SID + '/document/app:' + progs[1].id + ':' + kind + '/file',
    { multipart: { file: { name, mimeType: 'application/pdf', buffer: pdf(500) } } });

  const proof = await file('proof', 'submitted-2026-09-14.pdf');
  ok(proof.ok(), 'a counsellor can file the submission confirmation — ' + proof.status());
  const decision = await file('decision', 'offer-letter.pdf');
  ok(decision.ok(), 'and the decision letter — ' + decision.status());

  st = await state();
  const bag = (st.appFiles || {})[progs[1].id] || {};
  ok((bag.proof || {}).file === 'submitted-2026-09-14.pdf',
    'both land against that one application — ' + JSON.stringify(Object.keys(bag)));
  ok((bag.decision || {}).file === 'offer-letter.pdf', 'each under its own kind');

  /* NOT ON THE DOCUMENTS CHECKLIST, which is the half that would have gone
     wrong quietly. Six counters read `docs` as "how far through their
     documents is this student", and filing two applications would have moved
     every one of them without a document arriving. */
  ok(!Object.keys(st.docs || {}).some(x => x.startsWith('app:')),
    'and NOT in the document checklist — ' + Object.keys(st.docs || {}).join(','));
  const office = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const after = (office.students || []).find(x => x.email === email);
  ok(after && after.docsTotal === 0,
    'so the office still counts nought documents for a student who has sent '
    + 'none — ' + (after && after.docsTotal));

  /* The student can open them. */
  const fid = bag.proof.files[0].id;
  const got = await stu.request.get(BASE + '/api/documents/file/' + fid);
  ok(got.ok(), 'the student can open what was filed for them — ' + got.status());

  /* And cannot remove them, or upload one. */
  const del = await stu.request.delete(BASE + '/api/documents/file/' + fid);
  ok(del.status() === 403,
    'but cannot delete our record of filing their application — ' + del.status());
  const mine2 = await stu.request.post(BASE + '/api/documents',
    { multipart: { key: 'app:' + progs[1].id + ':proof',
      file: { name: 'mine.pdf', mimeType: 'application/pdf', buffer: pdf(100) } } });
  ok(mine2.status() === 403, 'nor put one there themselves — ' + mine2.status());

  /* A slot no screen draws. The staff route has refused an invented key since
     the document sets went in; the route every student actually uploads
     through accepted anything, and a typo made a file that was invisible. */
  const junk = await stu.request.post(BASE + '/api/documents',
    { multipart: { key: 'not-a-real-slot',
      file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: pdf(100) } } });
  ok(junk.status() === 422,
    'and a document slot that does not exist is refused — ' + junk.status());

  /* An application file has to belong to an application. */
  const nowhere = await admin.request.post(
    BASE + '/api/staff/student/' + SID + '/document/app:not-on-their-list:proof/file',
    { multipart: { file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: pdf(100) } } });
  ok(nowhere.status() === 404,
    'a programme that is not on their list has no application to file against — '
    + nowhere.status());

  /* Both on the student's screen, openable. */
  await apps.goto(BASE + '/applications.html', { waitUntil: 'domcontentloaded' });
  await apps.waitForTimeout(2600);
  const shown = (await apps.textContent('body')) || '';
  ok(/Submission confirmation/i.test(shown), 'the confirmation is named on the application');
  ok(/Decision letter/i.test(shown), 'and so is the decision letter');
  ok((await apps.locator('a[href^="/api/documents/file/"]').count()) >= 2,
    'both are links rather than filenames — being told a file exists and not '
    + 'being able to open it is the counsellor bug all over again');
  ok(aerrs.length === 0, 'no page errors on Applications — ' + aerrs.slice(0, 2).join(' | '));
  ok(errs.length === 0, 'no page errors on My Programs — ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
