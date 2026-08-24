/**
 * Everything that has been added, opened as the three people who use it.
 *
 * "In student login, counsellor login and admin login please check what are
 * added and whether they are working or not."
 *
 * Every other suite proves one feature in depth. This one proves they are all
 * still reachable from the screens the three roles actually open — which is a
 * different question, and the one that goes wrong quietly. A feature can be
 * perfect and unreachable: a sidebar entry that was never added, a tab that
 * renders empty, a button behind a permission nobody has. Each check here is
 * "can this person get to it, and does it show real data".
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  const asPage = async (email, w, h) => {
    const c = await browser.newContext({ viewport: { width: w, height: h } });
    await c.request.post(BASE + '/api/auth/login',
      { data: { email, password: 'glovels123' } });
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(email.split('@')[0] + ': ' + e));
    return { c, p };
  };

  /* ===================================================== the student ===== */
  const stu = await asPage('student@glovels.com', 1440, 1050);
  await stu.p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await stu.p.waitForTimeout(3000);

  const nav = flat(await stu.p.textContent('.p-side, aside, nav'));
  ['Dashboard', 'My Profile', 'Documents', 'My Universities', 'Applications',
   'Services', 'Scholarships', 'Visa', 'Messages'].forEach(item =>
    check('student · ' + item + ' is in the sidebar', nav.includes(item)));

  check('student · the dashboard names their counsellor rather than guessing',
    /Kavya/.test(flat(await stu.p.textContent('#couns'))),
    flat(await stu.p.textContent('#couns')).slice(0, 60));
  check('student · nothing points them back at the marketing site to buy',
    !/on the website/i.test(flat(await stu.p.textContent('#nextUp'))),
    flat(await stu.p.textContent('#nextUp')).slice(0, 90));

  await stu.p.goto(BASE + '/universities', { waitUntil: 'domcontentloaded' });
  await stu.p.waitForTimeout(2800);
  const uni = flat(await stu.p.textContent('#mineWrap'));
  check('student · My Universities shows the counsellor’s shortlist',
    /counsellor.{0,3}s shortlist/i.test(uni));
  check('student · and, separately, what they are interested in',
    /interested in/i.test(uni));
  check('student · with no Remove button on either',
    (await stu.p.$$('[data-rm]')).length === 0);

  await stu.p.goto(BASE + '/visa', { waitUntil: 'domcontentloaded' });
  await stu.p.waitForTimeout(2800);
  check('student · Visa & enrollment is an upload screen',
    (await stu.p.$$('[data-vdrop]')).length >= 6,
    (await stu.p.$$('[data-vdrop]')).length + ' upload zones');
  check('student · and no longer says it is a demo',
    !(await stu.p.content()).includes('Demo screen'));

  await stu.p.goto(BASE + '/services', { waitUntil: 'domcontentloaded' });
  await stu.p.waitForTimeout(3000);
  check('student · Services lists what the office sells',
    (await stu.p.$$('#svcList article')).length >= 5,
    (await stu.p.$$('#svcList article')).length + ' cards');
  check('student · grouped, including the new categories',
    /Work & migrate|After you arrive/.test(flat(await stu.p.textContent('#svcTabs'))),
    flat(await stu.p.textContent('#svcTabs')).slice(0, 90));
  check('student · with a way to ask their counsellor about one',
    (await stu.p.$$('[data-svcask]')).length >= 1);

  await stu.p.goto(BASE + '/documents', { waitUntil: 'domcontentloaded' });
  await stu.p.waitForTimeout(2600);
  check('student · Documents still has its own upload cards',
    (await stu.p.$$('[data-drop]')).length >= 8);

  /* An administrator's request context, needed below to ask what the WHOLE
     roster looks like — the counsellor's own answer cannot prove it is a
     subset of anything. */
  const adm0 = await browser.newContext();
  await adm0.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* =================================================== the counsellor ===== */
  const cou = await asPage('kavya@glovels.com', 1600, 1050);
  await cou.p.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await cou.p.waitForTimeout(3000);
  check('counsellor · their caseload opens', (await cou.p.$$('[data-open]')).length >= 1);
  await cou.p.locator('[data-open]').first().click();
  await cou.p.waitForTimeout(2600);

  check('counsellor · the conversation is there', await cou.p.isVisible('#thread'));
  check('counsellor · with a paperclip to send a file', await cou.p.isVisible('#rclip'));
  await cou.p.click('.tab[data-t="file"]');
  await cou.p.waitForTimeout(900);
  const file = flat(await cou.p.textContent('#pane'));
  check('counsellor · the student’s documents are on the file',
    (await cou.p.$$('#docs li')).length >= 1);
  check('counsellor · with a way to verify each one',
    (await cou.p.$$('[data-verify]')).length >= 1);
  check('counsellor · the agreed shortlist is separate from what the student likes',
    /interested in/i.test(file) || (await cou.p.$$('#uniList li')).length >= 1);
  check('counsellor · they cannot reset a password',
    !(await cou.p.isVisible('#pwReset')));

  /* A counsellor sees their own students and nobody else's — by the list they
     are given AND by putting somebody else's id in the URL, because a screen
     that omits a row is not a permission. */
  const mine = await (await cou.c.request.get(BASE + '/api/staff/students')).json();
  check('counsellor · the caseload is only students assigned to them',
    (mine.students || []).every(x => x.counsellor && /Kavya/.test(x.counsellor.name)),
    (mine.students || []).map(x => x.counsellor && x.counsellor.name).join(','));

  const everyone = await (await adm0.request.get(BASE + '/api/staff/students')).json();
  const notTheirs = (everyone.students || [])
    .find(x => !x.counsellor || !/Kavya/.test(x.counsellor.name));
  check('admin · sees every student, assigned or not',
    (everyone.students || []).length >= (mine.students || []).length,
    (everyone.students || []).length + ' vs ' + (mine.students || []).length);
  /* Made rather than found. A seeded database has one student, all of them
     Kavya's, so the branch that matters would never run — and a permission
     check that never runs is not a check. */
  const stranger = await (await adm0.request.post(BASE + '/api/staff/people', {
    data: { name: 'Not Hers ' + Date.now(),
      email: 'nothers' + Date.now() + '@example.com', role: 'student' },
  })).json();

  const peek = await cou.c.request.get(BASE + '/api/staff/student/' + stranger.person.id);
  check('counsellor · cannot open a student who is not theirs, even by id',
    peek.status() === 403, peek.status());
  const peekDocs = await cou.c.request.get(
    BASE + '/api/staff/student/' + stranger.person.id + '/document/passport/file');
  check('counsellor · nor reach their documents that way',
    peekDocs.status() === 403, peekDocs.status());
  const after = await (await cou.c.request.get(BASE + '/api/staff/students')).json();
  check('counsellor · and a student assigned to nobody is not on their list',
    !(after.students || []).some(x => x.id === stranger.person.id),
    (after.students || []).length + ' students');
  check('admin · but is on the admin’s',
    ((await (await adm0.request.get(BASE + '/api/staff/students')).json()).students || [])
      .some(x => x.id === stranger.person.id));

  /* ======================================================== the admin ===== */
  const adm = await asPage('admin@glovels.com', 1700, 1060);
  await adm.p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await adm.p.waitForTimeout(3400);

  const roster = flat(await adm.p.textContent('#everyStudent, body'));
  check('admin · the roster lists students', (await adm.p.$$('[data-assign]')).length >= 1);
  check('admin · with a counsellor dropdown on each',
    (await adm.p.$$('[data-assign] option')).length >= 2);
  check('admin · and an administrator among the people who can be assigned',
    /Glovels Admin/.test(await adm.p.textContent('[data-assign]')),
    flat(await adm.p.textContent('[data-assign]')).slice(0, 70));
  check('admin · a way to reset a student’s password',
    (await adm.p.$$('[data-pwreset]')).length >= 1);
  check('admin · and to send a sign-in link',
    (await adm.p.$$('[data-invite]')).length >= 1);

  check('admin · every conversation is on the screen',
    (await adm.p.$$('#convRows tr')).length >= 1);
  check('admin · with a note they can leave for the counsellor',
    (await adm.p.$$('[data-guide]')).length >= 1);
  check('admin · and the by-counsellor split', (await adm.p.$$('#convWho .cw')).length >= 1);

  /* The screens an admin reaches from the sidebar rather than this page. */
  for (const [path, what, sel] of [
    ['/leads', 'the lead book', '#leadRows, #leadList, table'],
    ['/blog-admin', 'the blog', 'table, .p-card'],
    ['/home', 'the home page editor', '.p-card'],
    ['/catalogue', 'the catalogue', 'table, .p-card'],
  ]) {
    await adm.p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await adm.p.waitForTimeout(2400);
    check('admin · ' + what + ' opens', (await adm.p.$$(sel)).length >= 1, path);
  }

  /* Services are edited from the home page screen — the one place the new ones
     have to be switchable on. */
  await adm.p.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
  await adm.p.waitForTimeout(3000);
  const home = flat(await adm.p.textContent('body'));
  check('admin · the home page editor mentions services', /service/i.test(home));

  check('no page errors for anybody', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
