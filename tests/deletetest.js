/**
 * A person deleting their own account.
 *
 * Staff could already delete somebody else's record. The person it belonged to
 * could not — which is the wrong way round, and is an automatic rejection from
 * Apple for any app that lets an account be created. It is also what the DPDP
 * Act asks of anybody holding a passport number, a date of birth, a set of
 * marksheets and every message somebody sent their counsellor.
 *
 * Four things this suite is actually here to catch, none of which a unit test
 * of the route would have found:
 *
 *   A WRONG PASSWORD MUST NOT SIGN THEM OUT. The portal runs every request
 *   through one fetch helper that reads 401 as "your session has expired" and
 *   bounces to the sign-in screen. Answering a mistyped password with 401
 *   therefore threw somebody out of the account they were still deciding
 *   whether to keep — and left them believing something had happened. So the
 *   check here is not "the API returned 422"; it is that after a wrong
 *   password the person is STILL ON THE PROFILE SCREEN with the message next
 *   to the field.
 *
 *   THE FILES HAVE TO GO. Rows are easy to delete and easy to test. A passport
 *   scan left on the disk after the record pointing at it is gone is the one
 *   leftover nobody would ever find again, so this looks at the disk.
 *
 *   THE PAID ORDER HAS TO STAY, AND HAS TO COME OFF THE PERSON. A tax invoice
 *   is retained because it must be; scrubbing the name off one would only make
 *   a refund impossible to trace. The screen says so before anybody presses the
 *   button, so the test holds it to that sentence exactly: the order survives,
 *   and its student_id does not.
 *
 *   AN ACCOUNT ON A PASSWORD IT NEVER CHOSE CAN STILL LEAVE. A student made at
 *   checkout is handed a generated password and every screen but one is shut
 *   until they replace it. Making somebody set up an account they have decided
 *   to delete is the obstruction the deletion rule exists to prevent.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8099';
const PORT = (BASE.match(/:(\d+)/) || [, '8099'])[1];
/* The server under test is on this machine, started by srv.sh with a data
   directory named after its port. Reading the disk is the only way to prove a
   file is gone rather than merely unlisted. */
const DATA = process.env.DATA_DIR || '/tmp/db-' + PORT;

const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* Guarded, because an unguarded click on a control the build does not have
   throws after thirty seconds and takes the whole run with it — and a suite
   that dies reports nothing about the twenty checks that came after. Against
   the build we are trying to prove wrong, every one of these is missing. */
const seen = (p, sel) => p.isVisible(sel).catch(() => false);
const tap = async (p, sel) => {
  if (!(await seen(p, sel))) return false;
  return p.click(sel, { timeout: 4000 }).then(() => true).catch(() => false);
};
const type = async (p, sel, v) => {
  if (!(await seen(p, sel))) return false;
  return p.fill(sel, v, { timeout: 4000 }).then(() => true).catch(() => false);
};
const words = (p, sel) => p.textContent(sel).catch(() => '');

/* Who a context is signed in as, or null.
 *
 * NOT `(await ctx.request.get('/api/auth/me')).ok()`. That endpoint is open and
 * answers 200 to everybody, with `user: null` when nobody is signed in — so
 * asserting on the status code is a check that passes whatever happens, which
 * is worse than no check at all. It is asked here for the user. */
const whoami = async ctx => {
  const r = await ctx.request.get(BASE + '/api/auth/me');
  if (!r.ok()) return null;
  const b = await r.json().catch(() => ({}));
  return (b && b.user) || null;
};

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------------- a counsellor
     Somebody has to be told, so somebody has to exist. */
  const cEmail = 'delc' + S + '@glovels.com';
  const cPass = 'delc-pass-' + S;
  const madeC = await (await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'Del Counsellor ' + S, email: cEmail, password: cPass, role: 'counsellor' } })).json();
  const cId = madeC.person ? madeC.person.id : madeC.id;
  ok(!!cId, 'a counsellor exists to be notified');

  /* ------------------------------------------------- a student with a life on
     the system: a profile, a document, a shortlist, messages and a paid order.
     Deleting an empty account proves nothing. */
  const email = 'delme' + S + '@student.example';
  const password = 'a-real-password-' + S;
  const stu = await browser.newContext();
  const signup = await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Del Student', email, phone: '9876543210', password } });
  ok(signup.ok(), 'the student signs up — ' + signup.status());
  const me0 = await whoami(stu);
  const sid = me0 && me0.id;
  ok(!!sid, 'and has an id');

  await admin.request.put(BASE + '/api/staff/student/' + sid + '/counsellor',
    { data: { counsellorId: cId } });

  await stu.request.put(BASE + '/api/profile',
    { data: { profile: { name: 'Del Student', g_country: 'United Kingdom' } } });
  await stu.request.post(BASE + '/api/documents', {
    multipart: {
      key: 'passport',
      file: { name: 'passport.pdf', mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 a real passport scan ' + S) },
    },
  });
  await stu.request.post(BASE + '/api/messages',
    { data: { text: 'Please look at my SOP draft.' } });

  const upDir = path.join(DATA, 'uploads', String(sid));
  ok(fs.existsSync(upDir) && fs.readdirSync(upDir).length > 0,
    'the uploaded document is on the disk before we start — ' + upDir);

  const order = await (await stu.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-roadmap', name: 'Del Student', email,
      phone: '9876543210', acceptedTerms: true },
  })).json();
  const ref = order.reference;
  ok(!!ref, 'and a paid order exists — ' + JSON.stringify(order).slice(0, 90));

  const booked = await (await admin.request.get(BASE + '/api/staff/orders')).json();
  const mine = (booked.orders || []).find(o => o.reference === ref);
  ok(mine && mine.studentId === sid,
    'the order is attached to the account to begin with — ' + (mine && mine.studentId));

  const before = await (await admin.request.get(BASE + '/api/staff/students')).json();
  ok((before.students || []).some(x => x.id === sid), 'and staff can see the student');

  /* ------------------------------------------------------------- staff cannot
     A staff account has its own screen for this, and that screen refuses to let
     the last administrator lock everybody out. Borrowing this route to get
     round that would be a way to empty the organisation. */
  const staffTry = await admin.request.fetch(BASE + '/api/account', {
    method: 'DELETE', data: { email: 'admin@glovels.com', password: 'glovels123' },
  });
  ok(staffTry.status() === 403, 'a staff account is refused here — ' + staffTry.status());
  ok(!!(await whoami(admin)), 'and is still signed in afterwards');

  /* ------------------------------------------------------- the two gates, cold
     Both answer 422. Not 401: see the note at the top of this file. */
  const wrongEmail = await stu.request.fetch(BASE + '/api/account', {
    method: 'DELETE', data: { email: 'someone.else@student.example', password },
  });
  ok(wrongEmail.status() === 422, 'a different email is refused — ' + wrongEmail.status());

  const wrongPass = await stu.request.fetch(BASE + '/api/account', {
    method: 'DELETE', data: { email, password: 'not-the-password' },
  });
  ok(wrongPass.status() === 422,
    'a wrong password is refused with 422, not 401 — ' + wrongPass.status());

  const survived = await whoami(stu);
  ok(survived && survived.id === sid,
    'and the session survives a wrong password — ' + JSON.stringify(survived && survived.id));
  const stillThere = await (await admin.request.get(BASE + '/api/staff/students')).json();
  ok((stillThere.students || []).some(x => x.id === sid),
    'and nothing was deleted on the way');

  /* ------------------------------------------- what a person actually does
     Everything above went through the API. None of it would have caught the
     bug this suite exists for, because that bug lived in a fetch helper the
     API never touches. From here on it is a browser, a form and a screen. */
  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  /* Behind a heading, not at the foot of every visit — "remove Delete my
     Account from the bottom of the page", without removing the thing itself,
     which Apple and Google both refuse a listing without. So it has to be
     GONE from the page a student lands on, and REACHABLE from the nav. Both
     halves, because either one alone is a different bug. */
  ok(await page.$eval('#dangerZone', e => e.hidden).catch(() => false),
    'deleting an account is not at the foot of the profile');
  ok(await seen(page, '[data-account]'),
    'there is an Account section in the nav to find it in');
  await tap(page, '[data-account]');
  await page.waitForTimeout(600);

  ok(await seen(page, '#dangerZone'),
    'and the Account section offers to delete the account');

  const said = await words(page, '#dangerZone');
  ok(/cannot be undone/i.test(said), 'it says it cannot be undone');
  ok(/invoice|payment/i.test(said),
    'and says what is kept rather than leaving it to be discovered');

  await tap(page, '#delOpen');
  await page.waitForTimeout(400);
  ok(await seen(page, '#delConfirm'),
    'pressing it asks for confirmation rather than deleting');
  ok(await seen(page, '#delEmail'),
    'and asks for the email to be typed out');

  /* A phone. The one screen where a fixed-width panel would put the button
     off the side is the one nobody would find. */
  const phone = await stu.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(2200);
  await phone.click('[data-account]').catch(() => {});
  await phone.waitForTimeout(500);
  const box = await phone.evaluate(() => {
    const el = document.querySelector('#delOpen');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, w: innerWidth };
  }).catch(() => null);
  ok(box && box.left >= -1 && box.right <= box.w + 1,
    'on a phone the button is on the screen — ' + JSON.stringify(box));
  await phone.close();

  /* ------------------------------------------- the wrong password, on screen */
  await type(page, '#delEmail', email);
  await type(page, '#delPass', 'still-not-the-password');
  await tap(page, '#delGo');
  await page.waitForTimeout(1800);

  ok(/profile/.test(page.url()),
    'a wrong password leaves them on their profile, not at the sign-in screen — ' + page.url());
  ok(await seen(page, '#delErr'), 'the reason is on the screen next to the field');
  const errText = await words(page, '#delErr');
  ok(/password/i.test(errText), 'and says what was wrong — ' + errText.trim().slice(0, 60));
  ok(await page.isEnabled('#delGo').catch(() => false),
    'and they can try again');

  /* --------------------------------------------------------------- and then */
  await type(page, '#delPass', password);
  await tap(page, '#delGo');
  await page.waitForTimeout(3000);

  ok(/gone=1/.test(page.url()),
    'deleting lands on the home page saying so — ' + page.url());
  const notice = await page.innerText('body').catch(() => '');
  ok(/account has been deleted/i.test(notice),
    'and the notice is on it — ' + notice.replace(/\s+/g, ' ').slice(0, 70));

  await tap(page, '#goneOk');
  await page.waitForTimeout(500);
  ok(!/gone=1/.test(page.url()),
    'closing it takes the marker out of the address — ' + page.url());
  ok(!errs.length, 'no page errors along the way — ' + errs.slice(0, 2).join(' | '));

  /* A normal visit does not get the notice. */
  const plain = await browser.newContext();
  const plainPage = await plain.newPage();
  await plainPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await plainPage.waitForTimeout(900);
  ok(!/account has been deleted/i.test(await plainPage.innerText('body').catch(() => '')),
    'somebody arriving normally is not told an account was deleted');
  await plain.close();

  /* ----------------------------------------------------------- what is gone */
  ok(!(await whoami(stu)), 'the session is finished');
  const shut = await stu.request.get(BASE + '/api/state');
  ok(shut.status() === 401,
    'and it opens nothing that needs an account — ' + shut.status());

  const back = await stu.request.post(BASE + '/api/auth/login',
    { data: { email, password } });
  ok(!back.ok(), 'and they cannot sign back in — ' + back.status());

  const list = await (await admin.request.get(BASE + '/api/staff/students')).json();
  ok(!(list.students || []).some(x => x.id === sid), 'staff no longer see the student');

  ok(!fs.existsSync(upDir),
    'the uploaded documents are off the disk, not merely unlisted — ' + upDir);

  /* ----------------------------------------------------------- what is kept */
  const bookAfter = await (await admin.request.get(BASE + '/api/staff/orders')).json();
  const kept = (bookAfter.orders || []).find(o => o.reference === ref);
  ok(!!kept, 'the paid order is still in the book');
  ok(kept && kept.grossPaise > 0, 'with what was charged — ' + (kept && kept.grossPaise));
  ok(kept && kept.email === email.toLowerCase(),
    'and the invoice details it was issued with — ' + (kept && kept.email));
  ok(kept && !kept.studentId,
    'but no longer attached to an account — ' + JSON.stringify(kept && kept.studentId));

  /* --------------------------------------------------- the counsellor is told
     A student vanishing off a caseload with no explanation is a phone call
     somebody makes on Monday morning. */
  const outbox = path.join(DATA, 'outbox');
  const mails = fs.existsSync(outbox)
    ? fs.readdirSync(outbox).filter(f => f.endsWith('.eml'))
        .map(f => fs.readFileSync(path.join(outbox, f), 'utf8'))
    : [];
  const told = mails.filter(m => m.includes(cEmail));
  ok(told.some(m => /deleted their/i.test(m)),
    'the counsellor is told their student has gone — ' + told.length + ' message(s) to them');
  ok(told.some(m => /paid order/i.test(m)),
    'and told the paid order is still in the book');

  /* ---------------------------------- an account on a password it never chose
     Made at checkout, handed a generated password, every screen shut until it
     is replaced. It can still leave, and without producing a password that
     proves nothing — whoever holds this session already holds the account. */
  const tEmail = 'deltemp' + S + '@student.example';
  const tSign = await browser.newContext();
  await tSign.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Temp Student', email: tEmail, phone: '9876543210',
      password: 'first-password-' + S } });
  const tMe = await whoami(tSign);
  const tId = tMe && tMe.id;
  const reset = await (await admin.request.post(
    BASE + '/api/staff/people/' + tId + '/password', { data: {} })).json();
  ok(!!reset.password, 'an account is put on a temporary password');

  const T = await browser.newContext();
  await T.request.post(BASE + '/api/auth/login',
    { data: { email: tEmail, password: reset.password } });
  const gated = await T.request.get(BASE + '/api/staff/students');
  ok(!gated.ok(), 'that account is shut out of the rest of the site — ' + gated.status());

  const tGo = await T.request.fetch(BASE + '/api/account', {
    method: 'DELETE', data: { email: tEmail },
  });
  ok(tGo.ok(), 'but can still delete itself, with no password — ' + tGo.status()
    + ' ' + (await tGo.text()).slice(0, 80));
  const tList = await (await admin.request.get(BASE + '/api/staff/students')).json();
  ok(!(tList.students || []).some(x => x.id === tId), 'and it is gone');

  /* Typing the wrong address is still refused, temporary password or not. */
  const uEmail = 'delother' + S + '@student.example';
  const U = await browser.newContext();
  await U.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Other Student', email: uEmail, phone: '9876543210',
      password: 'other-password-' + S } });
  const uBad = await U.request.fetch(BASE + '/api/account', {
    method: 'DELETE', data: { email: 'wrong@student.example', password: 'other-password-' + S },
  });
  ok(uBad.status() === 422, 'the email gate holds on a fresh account too — ' + uBad.status());
  ok(!!(await whoami(U)), 'and that account is untouched');

  /* ------------------------------------------------------ nobody else's account */
  const V = await browser.newContext();
  const anon = await V.request.fetch(BASE + '/api/account', {
    method: 'DELETE', data: { email: uEmail, password: 'other-password-' + S },
  });
  ok(anon.status() === 401,
    'a signed-out request cannot delete an account by naming it — ' + anon.status());
  ok(!!(await whoami(U)), 'and it is still there');

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
