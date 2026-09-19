/* The sweep: who gets told, and once. */
const path = '/tmp/db-sla-' + Date.now();
require('fs').mkdirSync(path, { recursive: true });
process.env.DATA_DIR = path;
const store = require('../server/store.js');
const SLA = require('../server/sla.js');
const TASKS = require('../server/tasks.js');
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
(async () => {
  const db = store.open(path);
  const mk = (name, email, role) => db.createStudent(email, name, '', 'h', 's', role);
  const admin = mk('The Office', 'off' + Date.now() + '@g.com', 'admin');
  const c = mk('Kavya', 'kv' + Date.now() + '@g.com', 'counsellor');
  const st = mk('Ravi', 'rv' + Date.now() + '@g.com', 'student');
  db.assignCounsellor(st.id, c.id);
  const yesterday = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const t1 = db.addTask({ studentId: st.id, ownerId: c.id, key: 'custom', title: 'SOP',
    dueAt: yesterday, status: 'open', source: 'manual' });
  const t2 = db.addTask({ studentId: st.id, ownerId: c.id, key: 'custom2', title: 'LOR',
    dueAt: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10), status: 'open', source: 'manual' });

  let p = SLA.plan(db, Date.now());
  ok('the late one is picked up and the future one is not', p.ids.length === 1 && p.ids[0] === t1.id,
    JSON.stringify(p.ids));
  ok('the counsellor is told', p.jobs.some(j => j.role === 'counsellor' && j.to === c.email),
    p.jobs.map(j => j.role + ':' + j.to).join(' '));
  ok('and so is the office', p.jobs.some(j => j.role === 'admin' && j.to === admin.email),
    p.jobs.map(j => j.role).join(','));
  ok('  · one message each, listing the work', p.jobs.length === 2 && p.jobs.every(j => j.items.length === 1),
    p.jobs.length);

  db.updateTask(t1.id, { breachedAt: new Date().toISOString() });
  p = SLA.plan(db, Date.now());
  ok('once told, it is not told again tomorrow', p.jobs.length === 0, p.jobs.length);

  db.updateTask(t1.id, { status: 'done', by: c.id });
  db.updateTask(t2.id, { dueAt: yesterday });
  p = SLA.plan(db, Date.now());
  ok('a task finished is never late', !p.ids.includes(t1.id), JSON.stringify(p.ids));
  ok('a different task going past raises its own notice', p.ids.includes(t2.id), JSON.stringify(p.ids));

  /* WHOLE CALENDAR DAYS IN INDIA, and the same answer all day long.
   *
   * This used to round elapsed milliseconds from the due date at 23:59:59Z,
   * so a task due yesterday reported "0 days ago" until noon UTC — including
   * at 10am IST, the exact hour the sweep runs, so every overdue email
   * understated the delay by a day. And alerts.js measured from midnight UTC
   * instead, so the 9am digest and the 10am sweep disagreed by one day about
   * the same task in the same database. */
  const at = (day, hourIST) =>
    Date.parse(day + 'T00:00:00Z') - 5.5 * 3600 * 1000 + hourIST * 3600 * 1000;
  const row = db.getTask(t2.id);                  // due `yesterday`, three days back
  const breakfast = TASKS.lateness(row, at(yesterday, 24 + 8));
  const evening = TASKS.lateness(row, at(yesterday, 24 + 21));
  ok('a task one day past its date is one day late, all day long',
    breakfast === 1 && evening === 1, 'morning ' + breakfast + ', evening ' + evening);
  ok('  · and two days past is two', TASKS.lateness(row, at(yesterday, 48 + 8)) === 2,
    TASKS.lateness(row, at(yesterday, 48 + 8)));

  /* The one that was chasing people for work that was not yet owed. */
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const t3 = db.addTask({ studentId: st.id, ownerId: c.id, key: 'today', title: 'Due today',
    dueAt: today, status: 'open', source: 'manual' });
  ok('a task due TODAY is not late, at any hour',
    [0, 9, 14, 23].every(h => TASKS.lateness(db.getTask(t3.id), at(today, h)) === 0
      && TASKS.isLate(db.getTask(t3.id), at(today, h)) === false),
    [0, 9, 14, 23].map(h => h + 'h=' + TASKS.lateness(db.getTask(t3.id), at(today, h))).join(' '));
  ok('  · and the sweep does not chase it',
    !SLA.plan(db, at(today, 10)).ids.includes(t3.id), JSON.stringify(SLA.plan(db, at(today, 10)).ids));
  ok('  · but does the next day',
    SLA.plan(db, at(today, 24 + 10)).ids.includes(t3.id));

  ok('a finished task has no lateness', TASKS.lateness(db.getTask(t1.id), Date.now()) === null);

  /* A late task nobody can be told about must NOT be marked as told. It used
     to be stamped anyway, on a sweep that emailed nobody, and was then never
     chased again for the life of the file. */
  {
    const dir2 = path + '-orphan';
    require('fs').mkdirSync(dir2, { recursive: true });
    const db2 = store.open(dir2);
    const s2 = db2.createStudent('o' + Date.now() + '@g.com', 'Orphan Student', '', 'h', 's', 'student');
    const gone = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
    const orphan = db2.addTask({ studentId: s2.id, ownerId: null, key: 'x', title: 'Nobody owns this',
      dueAt: gone, status: 'open', source: 'manual' });
    const p2 = SLA.plan(db2, Date.now());
    ok('a late task with nobody to tell is not marked as told',
      !p2.ids.includes(orphan.id) && (p2.unreachable || []).includes(orphan.id),
      'ids=' + JSON.stringify(p2.ids) + ' unreachable=' + JSON.stringify(p2.unreachable));
    /* And once there is an office to tell, it is chased. */
    db2.createStudent('adm' + Date.now() + '@g.com', 'The Office', '', 'h', 's', 'admin');
    const p3 = SLA.plan(db2, Date.now());
    ok('  · and is chased as soon as somebody can be told',
      p3.ids.includes(orphan.id) && p3.jobs.length === 1, JSON.stringify(p3.ids));
  }

  /* ---- the three the rewrite itself introduced ----
   * Every one of these is an India-vs-UTC slip, and every one of them only
   * showed up for work happening between half past midnight and half past
   * five in the morning, local — which is to say, overnight web signups and
   * a counsellor finishing something late at night. */
  {
    const D = require('../server/days.js');
    /* A day-count from a TIMESTAMP must resolve that timestamp's Indian day
       first. Reading its first ten characters reads a UTC day, and dated the
       welcome call from the day before the student existed. */
    ok('a date counted from a late-evening signup uses the Indian day',
      D.addDays('2026-06-01T20:00:00Z', 2) === '2026-06-04'
      && D.addDays('2026-06-01T06:00:00Z', 2) === '2026-06-03',
      D.addDays('2026-06-01T20:00:00Z', 2) + ' / ' + D.addDays('2026-06-01T06:00:00Z', 2));
    ok('  · and a plain day is left alone', D.addDays('2026-06-01', 2) === '2026-06-03');
    ok('  · and nothing throws on rubbish', !!D.addDays('not a date', 1) && !!D.istDay('x'));

    /* Finished at 00:30 in the office is the NEXT day, however flattering
       the UTC reading would have been. The on-time test used to compare the
       first ten characters of two timestamps, which compares UTC days: work
       finished at 19:00Z on the due date — half past midnight the following
       morning, locally — scored as on time. It only ever erred in the
       counsellor's favour, which is the worst way for a scoreboard to be
       wrong. */
    ok('a task finished at half past midnight belongs to that morning',
      D.istDay('2026-06-10T19:00:00Z') === '2026-06-11'
      && D.istDay('2026-06-10T12:00:00Z') === '2026-06-10',
      D.istDay('2026-06-10T19:00:00Z') + ' / ' + D.istDay('2026-06-10T12:00:00Z'));
    ok('  · so finishing then, on a task due the day before, is late',
      D.istDay('2026-06-10T19:00:00Z') > '2026-06-10');

    /* A quiet day returns the same shape as a busy one. */
    const dir4 = path + '-quiet';
    require('fs').mkdirSync(dir4, { recursive: true });
    const quiet = SLA.plan(store.open(dir4), Date.now());
    ok('a sweep with nothing late still reports the same three lists',
      Array.isArray(quiet.jobs) && Array.isArray(quiet.ids) && Array.isArray(quiet.unreachable),
      JSON.stringify(Object.keys(quiet)));
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
