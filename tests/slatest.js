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

  /* Counted from the END of the due day, so a task due yesterday is one day
     late at midnight tonight and not three hours late at breakfast. */
  const late = TASKS.lateness(db.getTask(t2.id), new Date(yesterday + 'T23:59:59Z').getTime() + 2 * 864e5);
  ok('lateness is counted in whole days past the date', late === 2, late);
  ok('a finished task has no lateness', TASKS.lateness(db.getTask(t1.id), Date.now()) === null);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
