/**
 * What needs doing, and who it needs doing by.
 *
 * Four things went wrong quietly and none of them was visible anywhere. A
 * deadline arrived and the first anybody heard was the student asking why they
 * had missed the intake. A student wrote and nobody answered, and there was no
 * number anywhere saying how long they had been waiting. A profile stayed half
 * empty and blocked the visa, because nobody had told the student which four
 * boxes were missing. Somebody said "call me Tuesday" and Tuesday went past.
 *
 * The alerts are computed from the data rather than stored, so these tests set
 * up the data and then read what the office would see.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

const ALERTS = require(path.join(__dirname, 'build', 'server', 'alerts.js'));
const DIGEST = require(path.join(__dirname, 'build', 'server', 'digest.js'));
const store = require(path.join(__dirname, 'build', 'server', 'store.js'));

(async () => {
  const browser = await chromium.launch();
  const staff = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------ what the API says */
  const first = await (await staff.request.get(BASE + '/api/staff/alerts')).json();
  check('the office can ask what needs doing', Array.isArray(first.alerts));
  check('with a count of how many are late',
    typeof first.counts.now === 'number' && typeof first.counts.total === 'number',
    JSON.stringify(first.counts));
  check('a deadline on an unsubmitted application is one of them',
    (first.alerts || []).some(a => a.kind === 'deadline'),
    (first.alerts || []).map(a => a.kind).join(','));
  check('and it names the student and the university',
    (first.alerts || []).filter(a => a.kind === 'deadline')
      .every(a => a.title.length > 20 && /closes/.test(a.title)));
  check('an administrator gets the split by person',
    Array.isArray(first.byPerson) && first.byPerson.length > 0,
    JSON.stringify(first.byPerson));

  /* ------------------------------------- a student waiting for an answer */
  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const me = await (await stu.request.get(BASE + '/api/state')).json();

  /* The engine takes the time as an argument precisely so this can be asked
     without waiting until tomorrow: send the message now, then ask what the
     office would be looking at thirty hours from now. */
  const db = store.open('/tmp/db-8099');
  db.addMessage(me.user.id, 'me', 'Any news on my APS certificate?');
  const in30h = Date.now() + 30 * 3600 * 1000;
  const in72h = Date.now() + 72 * 3600 * 1000;

  const waiting = ALERTS.all(db, in30h).alerts.filter(a => a.kind === 'silent');
  check('a student nobody has answered in 24 hours is an alert',
    waiting.length >= 1, waiting.length + ' found');
  check('and it says how long they have been waiting',
    waiting[0] && /waiting \d+ hours/.test(waiting[0].title), waiting[0] && waiting[0].title);
  check('with what they actually asked, so it can be answered from the alert',
    waiting[0] && waiting[0].detail.includes('APS certificate'));

  /* Two days without an answer is not a queue. */
  const stale = ALERTS.all(db, in72h).alerts.filter(a => a.kind === 'silent');
  check('after two days it is urgent, not a queue',
    stale[0] && stale[0].urgency === 'now', stale[0] && stale[0].urgency);

  /* A reply clears it — the last word being ours means nobody is waiting. */
  db.addMessage(me.user.id, 'them', 'Chased it this morning, I will have an answer by Friday.');
  check('a reply clears it', !ALERTS.all(db, in72h).alerts.some(a => a.kind === 'silent'
    && String(a.subject.studentId) === String(me.user.id)));

  /* ------------------------------------------------- a file that is not finished */
  const todo = ALERTS.forStudent(db, { id: me.user.id });
  check('a student is told exactly what is missing from their own file',
    Array.isArray(todo.documentsMissing) && todo.documentsMissing.length > 0,
    JSON.stringify(todo.documentsMissing));
  check('as names, not as a percentage on its own',
    todo.documentsMissing.every(x => /[a-z]/i.test(x)));
  check('and a percentage as well, for the bar',
    todo.complete > 0 && todo.complete < 100, todo.complete + '%');

  /* A brand-new account is not nagged: an empty profile on day one is an
     account made on day one, not a problem. */
  const fresh = await browser.newContext();
  const made = await fresh.request.post(BASE + '/api/auth/signup', {
    data: { name: 'New Person ' + stamp, email: 'new' + stamp + '@example.com',
      phone: '9876500009', password: 'a-password-here' },
  });
  check('a new account can be made', made.ok(), made.status());
  const newId = (await made.json()).user.id;
  check('and it is not reported to the office on its first day',
    !ALERTS.all(db).alerts.some(a => a.kind === 'profile'
      && String(a.subject.studentId) === String(newId)));

  /* ...but they are told, on their own screen, straight away. */
  const theirs = await (await fresh.request.get(BASE + '/api/state')).json();
  check('though they are told themselves, immediately',
    (theirs.todo.profileMissing || []).length > 10,
    (theirs.todo.profileMissing || []).length + ' fields');

  const page = await fresh.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  check('and it is on the screen they land on', await page.isVisible('.todo-card'));
  const card = await page.textContent('.todo-card');
  check('naming what is missing rather than scolding them',
    /full name/.test(card) && /Passport/.test(card), card.slice(0, 90));
  check('with a way to go and fix each half',
    (await page.$$('.todo-card a[href="profile.html"]')).length === 1
    && (await page.$$('.todo-card a[href="documents.html"]')).length === 1);
  check('no page errors on the dashboard', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ------------------------------------------------ a follow-up that was promised */
  const lead = await (await staff.request.post(BASE + '/api/staff/leads', {
    data: { name: 'Promised ' + stamp, phone: '9876500010', source: 'phone' },
  })).json();
  const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  await staff.request.put(BASE + '/api/staff/lead/' + lead.lead.id,
    { data: { status: 'following', nextAt: yesterday } });

  const due = ALERTS.all(db).alerts.filter(a => a.kind === 'followup');
  check('a follow-up somebody promised and missed is an alert',
    due.some(a => a.title.includes('Promised ' + stamp)),
    due.map(a => a.title).join(' | '));
  check('and being late makes it urgent',
    due.filter(a => a.title.includes('Promised ' + stamp))[0].urgency === 'now');

  /* ------------------------------------------------------------- the bell */
  const ops = await staff.newPage();
  const operrs = [];
  ops.on('pageerror', e => operrs.push(String(e)));
  await ops.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await ops.waitForTimeout(2600);
  check('there is a bell on the operations screen', await ops.isVisible('#bell'));
  check('with a number on it', (await ops.textContent('#bellN')) !== '0',
    await ops.textContent('#bellN'));
  await ops.click('#bell');
  await ops.waitForTimeout(1000);
  check('pressing it lists them', (await ops.$$('.al')).length > 0,
    (await ops.$$('.al')).length + ' alerts');
  check('the most urgent first',
    (await ops.$eval('.al', el => el.className)).includes('now')
    || (await ops.$$('.al.now')).length === 0);
  check('and each one is a button that goes to the thing',
    (await ops.$$('.al[data-student], .al[data-lead]')).length > 0);
  check('no page errors on the operations screen', operrs.length === 0,
    operrs.slice(0, 2).join(' | '));

  /* The bell is on every staff screen, not just the one somebody remembered. */
  for (const screen of ['counsellor', 'leads', 'chat']) {
    await ops.goto(BASE + '/' + screen, { waitUntil: 'domcontentloaded' });
    await ops.waitForTimeout(1800);
    check('the bell is on ' + screen + ' too', await ops.isVisible('#bell'));
  }

  /* ---------------------------------------------------------- the morning email */
  const jobs = DIGEST.plan(db, Date.now());
  check('the morning email goes to the people who can act on it',
    jobs.length >= 2, jobs.map(j => j.to).join(', '));
  check('and says in the subject how many are late',
    jobs.every(j => /thing\(s\) need doing today$/.test(j.subject)),
    jobs.map(j => j.subject).join(' | '));
  const adminJob = jobs.find(j => /admin@/.test(j.to));
  const kavyaJob = jobs.find(j => /kavya@/.test(j.to));
  check('an administrator gets the whole book',
    adminJob && adminJob.count >= (kavyaJob ? kavyaJob.count : 0),
    adminJob && adminJob.count + ' vs ' + (kavyaJob && kavyaJob.count));
  check('and the split by person, because a silent counsellor is about a counsellor',
    adminJob && /BY PERSON/.test(adminJob.body.text));
  check('a counsellor gets their own students, grouped by what sort of thing it is',
    kavyaJob && /DEADLINES|WAITING FOR A REPLY/.test(kavyaJob.body.text),
    kavyaJob && kavyaJob.body.text.split('\n')[3]);
  check('and it is written twice, so a client that blocks HTML still shows it',
    jobs.every(j => j.body.text.length > 40 && j.body.html.length > 40));

  /* ------------------------------------------- and only the people it is for */
  check('a student cannot read the alert list',
    (await stu.request.get(BASE + '/api/staff/alerts')).status() === 403);
  const anon = await browser.newContext();
  check('and nobody signed out can either',
    (await anon.request.get(BASE + '/api/staff/alerts')).status() === 401);

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
