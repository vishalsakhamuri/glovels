'use strict';
/*
 * ONE PROGRESS MODEL FOR THE STUDENT (patch 169, STU-02).
 *
 * The dashboard carried four trackers that each counted something different:
 * "0 of 9 done" (the office's task list), "Waiting on offers · Step 6 of 9"
 * (the phase, lifted by the applications), "Application tracker 1 of 5" and
 * "Your journey" (both hard-coded and ticked from the order alone). A student
 * with seven applications filed and two offers in hand read all four at once.
 *
 * This is the one they read now. Six stages, each decided by EVIDENCE first —
 * an order taken, applications filed, offers in — and by the office's tasks
 * where there is no evidence to read. The stages are monotone: the step the
 * student is "on" is the first one not finished, everything before it is done,
 * and the count of done stages is always one less than the step number, so the
 * headline and the count can never argue.
 *
 * The office's own model (TASKS.phaseOf, and TASKS.progress when it lands for
 * CNS-01) stays the office's: this reads the same tasks and the same
 * applications, it never writes either.
 *
 * READINESS lives here too (STU-09.2): the student's dashboard, their
 * Documents screen and the counsellor's tile each counted documents their own
 * way ("4 of 10" against "6/12", and a passport sent back for a new copy shown
 * as "Not uploaded" on one screen and "Send a scanned copy" on the other).
 * One function, one set of words.
 */
const TASKS = require('./tasks.js');
const APPS = require('./apps.js');
const MONEY = require('./money.js');

const STAGES = [
  { key: 'enrolled', label: 'Enrolled', phases: ['enrolled'] },
  { key: 'profile', label: 'Profile and documents', phases: ['profile'] },
  { key: 'shortlist', label: 'Shortlist agreed', phases: ['shortlist'] },
  { key: 'applying', label: 'Applying', phases: ['writing', 'applying'] },
  { key: 'offers', label: 'Offers', phases: ['offers'] },
  { key: 'visa', label: 'Visa and departure', phases: ['visa', 'departed'] },
];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-12-31" (or an ISO timestamp) → "31 Dec 2026". Blank stays blank. */
function day(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return '';
  return Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1];
}

function phaseOfTask(t) {
  const tpl = TASKS.TEMPLATES.find(x => x.key === t.task_key);
  return tpl ? tpl.phase : 'service';
}

function of(db, st, now) {
  const s = typeof st === 'object' ? st : db.studentById(Number(st));
  if (!s) return null;
  const today = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);

  let tasks = [];
  try { tasks = (db.tasksFor(s.id) || []).filter(t => String(t.status) !== 'dropped'); } catch (e) { tasks = []; }
  let orders = [];
  try { orders = db.ordersFor(s.id) || []; } catch (e) { orders = []; }
  let list = [];
  try { list = db.getShortlist(s.id) || []; } catch (e) { list = []; }
  let apps = [];
  try { apps = db.getApplications(s.id) || []; } catch (e) { apps = []; }

  /* Only applications to programmes still on the list — the same rule as the
     Applications screen and the counsellor's header (patch 160). */
  const listed = new Set(list.map(r => String(r.prog_id)));
  const live = apps.filter(a => listed.has(String(a.prog_id)));
  const SENT = APPS.STAGES.findIndex(x => x.k === 'sent');
  const submitted = live.filter(a => Number(a.stage || 0) >= SENT || String(a.outcome || ''));
  const offers = live.filter(a => APPS.hadOffer(a.outcome));
  const said = k => live.filter(a => String(a.outcome || '') === k).length;
  const rejected = said('rejected');
  const enrolledAt = said('enrolled');
  const decided = submitted.filter(a => !APPS.outcomeOf(a.outcome).open).length;
  const waiting = submitted.length - decided;

  const paid = orders.some(o => MONEY.EARNED.has(o.status));
  const tasksOf = st => tasks.filter(t => st.phases.includes(phaseOfTask(t)));
  const allDone = rows => rows.length > 0 && rows.every(t => String(t.status) === 'done');
  const anyMoving = rows => rows.some(t => ['done', 'doing', 'blocked'].includes(String(t.status)));
  const filed = submitted.length > 0;

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  const raw = STAGES.map(st => {
    const rows = tasksOf(st);
    let done = false, moving = anyMoving(rows), detail = '';
    switch (st.key) {
      case 'enrolled':
        done = paid || allDone(rows) || filed;
        detail = done ? 'Your package is active' : 'Choose a package to start';
        break;
      case 'profile':
        done = allDone(rows) || filed;
        detail = done ? 'Your details and documents are in' : 'Your details and the documents we asked for';
        break;
      case 'shortlist':
        done = allDone(rows) || filed;
        moving = moving || list.length > 0;
        detail = list.length
          ? plural(list.length, 'programme') + ' on your list'
          : 'Your counsellor builds it with you';
        break;
      case 'applying':
        done = (live.length > 0 && submitted.length === live.length) || (!live.length && allDone(rows));
        moving = moving || filed;
        detail = live.length
          ? submitted.length + ' of ' + plural(live.length, 'application') + ' submitted'
          : 'Once your shortlist is agreed';
        break;
      case 'offers': {
        done = enrolledAt > 0 || (filed && waiting === 0 && offers.length > 0);
        moving = moving || filed;
        const bits = [];
        if (offers.length) bits.push(plural(offers.length, 'offer'));
        if (rejected) bits.push(rejected + ' not successful');
        if (waiting) bits.push(waiting + ' waiting to hear');
        detail = bits.length ? bits.join(' · ') : 'After your applications are in';
        break;
      }
      case 'visa':
        done = allDone(rows);
        moving = moving || enrolledAt > 0;
        detail = done ? 'Visa done' : 'After you accept an offer';
        break;
    }
    const open = rows.filter(t => String(t.status) !== 'done');
    const nextDue = open.map(t => String(t.due_at || '').slice(0, 10)).filter(Boolean).sort()[0] || '';
    const lastDone = rows.filter(t => String(t.status) === 'done')
      .map(t => String(t.done_at || '').slice(0, 10)).filter(Boolean).sort().pop() || '';
    return {
      key: st.key, label: st.label, done, moving, detail,
      /* The target date, formatted — and when it has gone, no date at all:
         "your counsellor will confirm the date" is said by the screen. Not
         who is behind, which is the office's business. */
      by: nextDue && nextDue >= today ? day(nextDue) : '',
      confirm: !!(nextDue && nextDue < today),
      on: day(lastDone),
      /* The work under the stage, by title only. */
      items: rows.map(t => ({
        title: String(t.title || '').replace(/\s+—\s+delivered$/, ''),
        state: String(t.status) === 'done' ? 'done'
          : ['doing', 'blocked'].includes(String(t.status)) ? 'doing' : 'next',
      })),
    };
  });

  /* Monotone: the first stage not done is where they are. */
  let at = raw.findIndex(x => !x.done);
  const finished = at === -1;
  if (finished) at = raw.length;
  const stages = raw.map((x, i) => ({
    key: x.key, label: x.label, detail: x.detail, items: x.items,
    state: i < at ? 'done' : (i === at || x.moving) ? 'doing' : 'next',
    by: i < at ? '' : x.by, confirm: i < at ? false : x.confirm,
    on: i < at ? x.on : '',
  }));
  return {
    stages,
    step: finished ? stages.length : at + 1,
    of: stages.length,
    done: finished ? stages.length : at,
    percent: Math.round(100 * (finished ? stages.length : at) / stages.length),
    label: finished ? 'All done' : stages[at].label,
    finished,
    apps: { live: live.length, submitted: submitted.length, offers: offers.length,
      rejected, waiting },
  };
}

/*
 * DOCUMENT READINESS, once.
 *
 * Measured against the ten documents every student is asked for (the same ten
 * the Documents ring draws — `need:1` in portal_fields.py, the student's own
 * files only). `onFile` and `okAll` say what else is on the record so nothing
 * verified goes unmentioned.
 */
const REQUIRED = [
  ['passport', 'Passport'], ['x', 'Class 10 marksheet'], ['xii', 'Class 12 marksheet'],
  ['degree', 'Semester-wise marksheets'], ['consol', 'Consolidated grade card'],
  ['english', 'English test scorecard'], ['cv', 'Academic CV'],
  ['sop', 'Statement of Purpose'], ['lor', 'Recommendation letters'],
  ['finance', 'Financial documents'],
];
/* The Documents screen's words, so both screens say the same thing. */
const WORD = { none: 'Not uploaded', wait: 'In review', rescan: 'Send a scanned copy', ok: 'Accepted' };

function readiness(db, studentId) {
  let rows = [];
  try { rows = db.getDocuments(Number(studentId)) || []; } catch (e) { rows = []; }
  const slot = {};
  rows.forEach(d => { slot[d.doc_key] = String(d.status || 'wait'); });
  const statusOf = k => (slot[k] && WORD[slot[k]] ? slot[k] : (slot[k] ? 'wait' : 'none'));
  const docs = REQUIRED.map(([key, name]) => {
    const status = statusOf(key);
    return { key, name, status, word: WORD[status] };
  });
  const keys = Object.keys(slot);
  const ok = docs.filter(d => d.status === 'ok').length;
  const okAll = keys.filter(k => slot[k] === 'ok').length;
  return {
    ok, of: REQUIRED.length,
    percent: Math.round(100 * ok / REQUIRED.length),
    onFile: keys.length,
    okExtra: Math.max(0, okAll - ok),
    back: keys.filter(k => slot[k] === 'rescan').length,
    waiting: keys.filter(k => slot[k] === 'wait').length,
    docs,
  };
}

module.exports = { STAGES, of, day, readiness, REQUIRED, WORD };
