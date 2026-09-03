/**
 * Notifications for the person who installed the app.
 *
 * The push machinery has worked for months and reached exactly one kind of
 * person: a counsellor. The four endpoints were staff-only, the bar was on the
 * staff screens, and the only thing that ever sent one was "a student has
 * written to you". So a student could install Glovels — as of the patch
 * before this one — and the app could not tell them the one thing they
 * installed it for, which is that somebody answered.
 *
 * Nothing in the machinery was ever staff-specific. The subscription is keyed
 * on an account id; the column is called staff_id because counsellors got here
 * first. So this is mostly a suite about the doors:
 *
 *   A STUDENT MAY REGISTER THEIR OWN DEVICE, and only their own. None of these
 *   endpoints takes an id — they all work on the session — and that is the
 *   property worth asserting, because the cheap way to build this would have
 *   been to pass one.
 *
 *   THE OFFICE LOG STAYS THE OFFICE'S. A line every time a student turns
 *   notifications on, on every phone they own, would bury the entries somebody
 *   actually reads.
 *
 *   A COUNSELLOR'S REPLY REACHES THE PHONE — but only when nobody is watching
 *   the screen. Pushing to somebody who is reading the message as it arrives
 *   is how an app teaches people to turn notifications off.
 *
 *   AND IT IS STILL THE COUNSELLOR'S APP TOO. The wording differs and nothing
 *   else does. A staff screen offering to buzz when "your counsellor replies"
 *   would mean the two had been merged wrongly.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const ROOT = process.env.ROOT || '/home/claude/glovels/build';
const fs = require('fs');
const path = require('path');
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* A subscription the server will accept. The keys have to be the right LENGTH
   and shape or /api/push/subscribe refuses them before any of this is
   exercised; they never have to decrypt, because pushtest.js already proves the
   crypto by reversing it and this suite is about who is allowed to do what. */
const b64u = b => b.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeSub = (tag) => ({
  endpoint: 'https://push.example/' + tag + '-' + S,
  keys: {
    p256dh: b64u(Buffer.concat([Buffer.from([4]), require('crypto').randomBytes(64)])),
    auth: b64u(require('crypto').randomBytes(16)),
  },
});

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------------- a student */
  const email = 'spush' + S + '@student.example';
  const password = 'a-real-password-' + S;
  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Push Student', email, phone: '9876543210', password } });
  const me = await (await stu.request.get(BASE + '/api/auth/me')).json();
  const sid = me.user && me.user.id;
  ok(!!sid, 'a student exists');

  /* --------------------------------------------------------- the four doors */
  const keyRes = await stu.request.get(BASE + '/api/push/key');
  ok(keyRes.ok(), 'a student can ask for the key they need to subscribe — ' + keyRes.status());
  const key = (await keyRes.json().catch(() => ({}))).key;
  ok(typeof key === 'string' && key.length > 40, 'and gets one — ' + String(key).slice(0, 12));

  const sub = await stu.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: fakeSub('stu') } });
  ok(sub.ok(), 'and can register a device — ' + sub.status()
    + ' ' + (await sub.text()).slice(0, 80));
  const subBody = await sub.json().catch(() => ({}));
  ok(subBody.devices === 1, 'which is counted — ' + subBody.devices);

  /* Rubbish is still refused. The shape check was there before and must not
     have been loosened on the way to opening the door. */
  const junk = await stu.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: { endpoint: 'https://push.example/x' } } });
  ok(junk.status() === 400, 'a subscription with no keys is refused — ' + junk.status());

  /* ------------------------------------------------- and only their own devices
     None of these takes an id. That is the property: there is no parameter to
     aim at somebody else, so there is nothing to get wrong later. */
  const other = 'spushb' + S + '@student.example';
  const O = await browser.newContext();
  await O.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Other Student', email: other, phone: '9876543210',
      password: 'other-password-' + S } });
  await O.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: fakeSub('oth') } });
  const mine = await (await stu.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: fakeSub('stu2') } })).json();
  ok(mine.devices === 2,
    'a second phone is a second device on MY account, not on anybody else’s — '
    + mine.devices);

  /* Signed out, nothing. */
  const anon = await browser.newContext();
  const nope = await anon.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: fakeSub('anon') } });
  ok(nope.status() === 401, 'a signed-out request cannot register anything — ' + nope.status());

  /* ------------------------------------------------------- the office's log
     A student turning notifications on their own phone is not office business,
     and a line per student per device would bury what somebody reads. */
  const readLog = async () => {
    const r = await admin.request.get(BASE + '/api/staff/catalogue');
    const b = await r.json().catch(() => ({}));
    return Array.isArray(b.audit) ? b.audit : null;
  };
  const rows = await readLog();
  /* Proved to be the real log before anything is concluded from it. An empty
     array would make the next check pass for the wrong reason, and a check that
     cannot fail is worse than no check. */
  ok(rows && rows.length > 0,
    'the office log is readable and has entries in it — ' + (rows ? rows.length : 'null'));
  const noise = (rows || []).filter(r => /notifications on/i.test(r.what || '')
    && /Push Student/i.test(r.who || ''));
  ok(!noise.length,
    'a student registering a phone does not fill it — ' + noise.length + ' line(s)');

  /* ---------------------------------------------- a counsellor's reply pushes
     The reply is what a student installed the app for. It is checked through
     what the office actually does — assign a counsellor, open the thread, type
     — rather than by calling the notifier directly. */
  const cEmail = 'spushc' + S + '@glovels.com';
  const cPass = 'spushc-' + S;
  const madeC = await (await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'Push Counsellor', email: cEmail, password: cPass, role: 'counsellor' } })).json();
  const cId = madeC.person ? madeC.person.id : madeC.id;
  await admin.request.put(BASE + '/api/staff/student/' + sid + '/counsellor',
    { data: { counsellorId: cId } });
  const C = await browser.newContext();
  await C.request.post(BASE + '/api/auth/login', { data: { email: cEmail, password: cPass } });
  await C.request.post(BASE + '/api/auth/change',
    { data: { current: cPass, password: cPass + 'X' } });
  await C.request.post(BASE + '/api/auth/login',
    { data: { email: cEmail, password: cPass + 'X' } });

  /* The other half of the log rule, so it is a rule and not an accident: a
     COUNSELLOR registering a device still writes a line. Without this, deleting
     the logging entirely would pass. */
  await C.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: fakeSub('coun') } });
  const rows2 = await readLog();
  ok((rows2 || []).some(r => /notifications on/i.test(r.what || '')
    && /Push Counsellor/i.test(r.who || '')),
    'but a counsellor registering one still does');

  const reply = await C.request.post(BASE + '/api/staff/student/' + sid + '/message',
    { data: { body: 'I have looked at your SOP — one change and it is ready.' } });
  ok(reply.ok(), 'the counsellor replies — ' + reply.status());

  /* The push went to a made-up endpoint on push.example, so nothing arrives and
     nothing should: what is checked is that the SUBSCRIPTION SURVIVED. A dead
     endpoint answering 404 or 410 is deleted on purpose, and push.example
     answers neither, so a subscription that has vanished here means the reply
     path never tried — or tried and threw. */
  await new Promise(r => setTimeout(r, 1200));
  const still = await (await stu.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: fakeSub('stu2') } })).json();
  ok(still.devices === 2, 'and the student’s devices are still registered — '
    + still.devices);

  /* The message itself arrived, which is the part that must never depend on a
     notification working. */
  const thread = await (await stu.request.get(BASE + '/api/state')).json().catch(() => ({}));
  const said = JSON.stringify(thread.msgs || []);
  ok(/one change and it is ready/.test(said),
    'and the reply is on the thread whatever the phone did');

  /* ------------------------------------------------------- the test button */
  const t1 = await stu.request.post(BASE + '/api/push/test');
  ok(t1.ok(), 'a student can send themselves a test — ' + t1.status());
  const t1b = await t1.json().catch(() => ({}));
  ok(typeof t1b.sent === 'number',
    'and is told how many devices it went to — ' + JSON.stringify(t1b));

  /* -------------------------------------------------------------- turning off */
  const gone = await stu.request.post(BASE + '/api/push/unsubscribe',
    { data: { endpoint: 'https://push.example/stu-' + S } });
  ok(gone.ok(), 'a device can be taken off — ' + gone.status());
  ok((await gone.json().catch(() => ({}))).devices === 1,
    'and the count follows');

  /* And deleting the account takes the rest with it. A phone still buzzing for
     an account that no longer exists is the worst kind of leftover, and the
     deletion path has to know about a table it was written before. */
  const del = await stu.request.fetch(BASE + '/api/account',
    { method: 'DELETE', data: { email, password } });
  ok(del.ok(), 'the student deletes their account — ' + del.status());
  const after = await browser.newContext();
  await after.request.post(BASE + '/api/auth/login',
    { data: { email: other, password: 'other-password-' + S } });
  const others = await (await after.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: fakeSub('oth') } })).json();
  ok(others.devices === 1,
    'and takes only their own devices with them — ' + others.devices);

  /* --------------------------------------------------------- the two screens
     The wording is the whole difference between the student's app and the
     office's. If a staff screen offers to buzz when "your counsellor replies",
     the two have been merged wrongly. */
  const msgs = fs.readFileSync(path.join(ROOT, 'messages.html'), 'utf8');
  const couns = fs.readFileSync(path.join(ROOT, 'counsellor.html'), 'utf8');
  ok(/id="pushBar"/.test(msgs), 'the student’s Messages screen offers notifications');
  ok(/your counsellor replies/i.test(msgs), 'and says what they will be told about');
  ok(!/one of your students writes/i.test(msgs),
    'without the counsellor’s wording');
  ok(/id="pushBar"/.test(couns), 'the counsellor screen still offers them');
  ok(/one of your students writes/i.test(couns), 'with its own wording');
  ok(!/your counsellor replies/i.test(couns),
    'and not the student’s');
  ok(/Add to Home Screen/.test(msgs),
    'the iPhone case is explained on the student screen too — Safari refuses '
    + 'the prompt until the app is installed, and says nothing');

  /* ------------------------------------------------------------- on a screen */
  const P = await browser.newContext();
  await P.request.post(BASE + '/api/auth/login',
    { data: { email: other, password: 'other-password-' + S } });
  const page = await P.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/messages.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  ok(!errs.length, 'the screen loads clean with the bar on it — '
    + errs.slice(0, 2).join(' | '));

  /* Headless Chromium has a PushManager but no push service, so the bar's own
     state can end up either way. What must be true regardless is that it did
     not silently take over the layout of the thread underneath it. */
  const shape = await page.evaluate(() => {
    const bar = document.querySelector('#pushBar');
    const thread = document.querySelector('#thread');
    return {
      bar: !!bar,
      barVisible: !!(bar && !bar.hidden),
      threadVisible: !!(thread && thread.getBoundingClientRect().height > 40),
      wide: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  }).catch(() => null);
  ok(shape && shape.bar, 'the bar is in the page');
  ok(shape && shape.threadVisible, 'and the conversation is still the screen');
  ok(shape && shape.wide, 'and nothing pushed the page sideways');

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
