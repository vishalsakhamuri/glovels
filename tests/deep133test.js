/*
 * Three of the nine, below the API: a deadline that moves, a deadline that is
 * today, and a phone that belongs to nobody.
 */
const dir = '/tmp/db-deep133-' + Date.now();
require('fs').mkdirSync(dir, { recursive: true });
process.env.DATA_DIR = dir;
const store = require('../server/store.js');
const SLA = require('../server/sla.js');
const TASKS = require('../server/tasks.js');
const ALERTS = require('../server/alerts.js');
const DAYS = require('../server/days.js');
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

const db = store.open(dir);
const stamp = Date.now();
const mk = (name, email, role) => db.createStudent(email, name, '', 'h', 's', role);
const admin = mk('The Office', 'off' + stamp + '@g.com', 'admin');
const c = mk('Kavya', 'kv' + stamp + '@g.com', 'counsellor');
const st = mk('Ravi', 'rv' + stamp + '@g.com', 'student');
db.assignCounsellor(st.id, c.id);

/* ---- 1. a second deadline can be missed too ----
   A submission task is re-dated when the intake it was pointed at goes by and
   the next one comes into view. breached_at was left standing, and the sweep
   reads breached_at as "already told" rather than "already told about THIS
   date" — so the second miss, and every miss after it, was silent. */
const past = DAYS.addDays(Date.now(), -4);
const t = db.addTask({
  studentId: st.id, ownerId: c.id, key: 'submit', title: 'Submit the application',
  dueAt: past, basis: 'deadline', status: 'open', source: 'auto',
});
let p = SLA.plan(db, Date.now());
ok('a missed date is picked up', p.ids.includes(t.id), JSON.stringify(p.ids));
SLA.plan(db, Date.now()).ids.forEach(id => db.updateTask(id, { breachedAt: new Date().toISOString() }));
p = SLA.plan(db, Date.now());
ok('  · and not repeated while the date is the same', !p.ids.includes(t.id), JSON.stringify(p.ids));

/* The date moves on to the next intake — the way syncTasks moves it. */
db.updateTask(t.id, { dueAt: DAYS.addDays(Date.now(), 30), basis: 'deadline', breachedAt: null });
ok('  · a new date clears the stamp',
  !db.getTask(t.id).breached_at, String(db.getTask(t.id).breached_at));
db.updateTask(t.id, { dueAt: DAYS.addDays(Date.now(), -1) });
p = SLA.plan(db, Date.now());
ok('  · so the second date can be missed and said out loud',
  p.ids.includes(t.id), JSON.stringify(p.ids));

/* And the sync itself does the clearing, not just this test doing it by hand.
   A standard task moved off the date the rules give it, stamped as already
   chased, and then brought back into line by syncTasks: the stamp has to go
   with the date it belonged to. */
const sync = st2 => TASKS.syncTasks(db, db.studentById(st2), Date.now());
let auto = sync(st.id).find(x => x.task_key === 'welcome');
const proper = auto.due_at;
db.updateTask(auto.id, { dueAt: DAYS.addDays(Date.now(), -20), breachedAt: new Date().toISOString() });
auto = sync(st.id).find(x => x.task_key === 'welcome');
ok('syncTasks puts a standard task back on its own date',
  auto.due_at === proper, auto.due_at + ' vs ' + proper);
ok('  · and takes the late notice off with the old date',
  !auto.breached_at, String(auto.breached_at));

/* A task that is finished is not made to speak again by a re-date. */
const fin = sync(st.id).find(x => x.task_key === 'profile');
db.updateTask(fin.id, { status: 'done', by: c.id });
db.updateTask(fin.id, { breachedAt: new Date().toISOString(), dueAt: DAYS.addDays(Date.now(), -30) });
sync(st.id);
ok('  · a finished one keeps its stamp', !!db.getTask(fin.id).breached_at,
  String(db.getTask(fin.id).breached_at));

/* ---- 2. a deadline today is not a deadline yesterday ----
   The watchlist worked out how far away a deadline was by rounding a
   difference in milliseconds, so from half past six every evening a
   university closing TODAY was announced as having closed yesterday. */
const todayIst = DAYS.istDay(Date.now());
for (const [at, want, when] of [
  ['T00:30:00Z', 0, '6am in Hyderabad'],
  ['T15:00:00Z', 0, 'half past eight in the evening — where it used to read yesterday'],
  ['T18:29:00Z', 0, 'one minute to midnight'],
  ['T18:31:00Z', 1, 'one minute past, when it really is yesterday'],
]) {
  const d = DAYS.daysPast(todayIst, Date.parse(todayIst + at));
  ok('a deadline of today, at ' + when + ', is ' + want + ' days past', d === want, String(d));
}

/* ---- 3. a phone that belongs to nobody ----
   push_subs is keyed by staff_id, for a student too. Deleting a person by
   student_id threw on a column that does not exist and the catch ate it, so
   the subscription outlived the account and the phone went on buzzing. */
const doomed = mk('Doomed', 'dm' + stamp + '@g.com', 'student');
db.savePushSubscription(doomed.id,
  { endpoint: 'https://example.com/push/' + stamp, keys: { p256dh: 'k', auth: 'a' } }, 'a phone');
const had = db.countPushSubscriptions(doomed.id);
db.deletePerson(doomed.id);
const left = db.countPushSubscriptions(doomed.id);
ok('a subscription was written for the account', had === 1, had);
ok('  · and goes when the account does', left === 0, left);

/* ---- 4. the fallback driver knows about every table the code touches ----
   push_subs was missing from its list, so on a Node without node:sqlite
   subscribing a device threw instead of registering one. */
{
  const names = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'store.js'), 'utf8');
  const listed = (/const TABLES = \[([\s\S]*?)\];/.exec(names) || [])[1] || '';
  /* Every table this file creates, against every table the fallback driver
     is told about. A table that exists in the schema and not in that list is
     simply not there on the fallback driver. */
  const made = new Set();
  for (const m of names.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)\s*\(/gi)) made.add(m[1]);
  const missing = [...made].filter(t => !listed.includes("'" + t + "'") && t !== 'prog_fts');
  ok('the fallback driver lists every table the code touches',
    missing.length === 0, missing.join(', '));
}

/* ---- 5. a blank date is not the first of January 1970 ----
   Number('') is 0, so an empty date came back as fifty-six years ago and
   whatever it was attached to read as the most urgent thing in the office.
   Every other unusable value falls back to today; a blank has to as well. */
for (const bad of ['', '   ', null, undefined, 'garbage', '0000-00-00', 'NaN']) {
  ok('a date of ' + JSON.stringify(bad) + ' is treated as today, not as 1970',
    DAYS.istDay(bad) === DAYS.istDay(Date.now()), DAYS.istDay(bad));
}

/* ---- 6. the fallback driver can count ----
   A dozen callers ask for COUNT(*) AS n and read `[0].n`. This driver
   handed back the rows, so the count was undefined where there were
   matches and threw where there were none — and `countAdmins() <= 1`,
   the check that stops the last administrator deleting themselves, was
   `undefined <= 1`, which is false. */
{
  const jsonDir = '/tmp/db-json133-' + Date.now();
  require('fs').mkdirSync(jsonDir, { recursive: true });
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'store.js'), 'utf8');
  const Module = require('module');
  const forced = new Module('forced-json-store');
  forced.paths = Module._nodeModulePaths(require('path').join(__dirname, '..', 'server'));
  forced.filename = require('path').join(__dirname, '..', 'server', 'store.js');
  const guard = "const _r = require; require = function (n) { if (n === 'node:sqlite') throw new Error('no sqlite here'); return _r(n); };\n";
  forced._compile(guard + src, forced.filename);
  const jdb = forced.exports.open(jsonDir);
  const a1 = jdb.createStudent('ja' + stamp + '@g.com', 'Only Admin', '', 'h', 's', 'admin');
  jdb.createStudent('js' + stamp + '@g.com', 'A Student', '', 'h', 's', 'student');
  ok('the fallback driver is really the one under test',
    require('fs').readdirSync(jsonDir).includes('glovels-data.json'),
    require('fs').readdirSync(jsonDir).join(','));
  ok('  · it counts the administrators, and does not count the students among them',
    jdb.countAdmins() === 1, jdb.countAdmins());
  ok('  · and answers zero rather than throwing when there are none',
    jdb.countOrdersFor(a1.id) === 0, jdb.countOrdersFor(a1.id));
  ok('  · and counts a caseload', jdb.countStudentsOf(a1.id) === 0, jdb.countStudentsOf(a1.id));
}

void ALERTS; void admin;
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
