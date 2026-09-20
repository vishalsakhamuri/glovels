'use strict';
/**
 * The work owed on a student's file, and when it is owed by.
 *
 * The office's problem, in the owner's words: "we assign a student to a
 * counsellor, there are a list of tasks — confirming the shortlisted
 * university, application processing, LOR, SOP, visa filing — everything has a
 * date and by when it has to be completed. We need to track all the tasks and
 * make sure these are completed on time."
 *
 * Two things follow from that, and they are the whole of this file.
 *
 * WHICH TASKS EXIST is decided by what the student bought. The same rule the
 * alerts engine already uses to decide which profile fields are compulsory —
 * alerts.stagesFor, which reads the paid orders and returns a set of stages —
 * decides which tasks appear. Somebody who bought a shortlist does not owe a
 * visa filing, and a template that would put one on their file is a task the
 * counsellor will close as not-applicable every month until they stop reading
 * the list.
 *
 * WHEN A TASK IS DUE has two answers, and the office wanted both:
 *
 *   from the deadline, backwards   Anything that has to be finished before a
 *                                  university closes is dated from that
 *                                  university's own closing date, so the work
 *                                  lands with room to spare. "So what we
 *                                  update for student before we get to last
 *                                  date, we need to make sure these tasks are
 *                                  completed within the timeline."
 *
 *   from the start, forwards       Everything with no deadline behind it —
 *                                  the welcome call, collecting documents,
 *                                  agreeing the shortlist — is a service
 *                                  promise: N days from the day the file
 *                                  opened.
 *
 * The submission task is the one there is one of per university, because
 * "university application submission, every uni has a date" — so that task
 * carries a prog_id and reads the deadline off that programme's own intakes.
 *
 * Nothing here decides who is late. Lateness is a comparison between due_at
 * and today, and that lives in alerts.js with every other derived fact.
 */

const ALERTS = require('./alerts.js');
const DAYS = require('./days.js');

const DAY = DAYS.DAY;
/* Calendar days in India, from one place — see server/days.js for why all
   three of these used to be computed differently in different files. */
const plus = (from, days) => DAYS.addDays(from, days);

/**
 * The default list. An administrator can change the days and the titles on the
 * Tasks screen; the keys and the stages are structural and are not editable,
 * because a template whose key changed is a new template and every task
 * already on a file would be orphaned by it.
 *
 *   key     stable identity. One task per key per student.
 *   stage   which entitlement turns it on ('always' is everybody). A list
 *           means any one of them: an SOP is owed both to somebody who paid
 *           for one to be written and to somebody whose applications we are
 *           filing, and those are two different purchases.
 *   per     'student' — one of them; 'uni' — one per shortlisted university.
 *   due     {sla: N}      N days after the file opened
 *           {before: N}   N days before the deadline it is working back from
 *   order   the order the list reads in, which is the order the work happens.
 */
/**
 * WHERE A STUDENT HAS GOT TO, as a single word.
 *
 * Not to be confused with a template's `stage`, which is the entitlement that
 * turns a task on. A PHASE is a place in the journey, and it is DERIVED —
 * nobody sets it. The office's instruction was exactly this: "these are
 * tracked and updated based on the completion, and asked for status to
 * counsellors in case not completed."
 *
 * Derived rather than set for one reason. A status somebody has to remember
 * to change is a status that is wrong, and a stage field that lags reality by
 * three weeks is worse than no stage field at all, because people plan
 * against it. The tasks are already being kept up to date — they have dates
 * and somebody is chased about them — so the phase rides on the back of work
 * that is happening anyway.
 *
 * And it deliberately does NOT work the other way round. Letting somebody
 * move a student to "Applying" and having that close the four tasks
 * underneath would clear an overdue list with one click, stamp work as
 * finished on a day it was not, and put every counsellor's on-time figure at
 * a hundred per cent forever. The one shortcut worth refusing is the one that
 * makes the board stop meaning anything.
 */
const PHASES = [
  { key: 'enrolled',  label: 'Enrolled',          short: 'Enrolled' },
  { key: 'profile',   label: 'Profile and documents', short: 'Profile' },
  { key: 'shortlist', label: 'Shortlisting',      short: 'Shortlisting' },
  { key: 'writing',   label: 'Writing (SOP/LOR)', short: 'Writing' },
  { key: 'applying',  label: 'Applying',          short: 'Applying' },
  { key: 'offers',    label: 'Waiting on offers', short: 'Offers' },
  { key: 'visa',      label: 'Visa',              short: 'Visa' },
  { key: 'departed',  label: 'Departed',          short: 'Departed' },
];
const PHASE_AT = new Map(PHASES.map((p, i) => [p.key, i]));

const TEMPLATES = [
  { key: 'welcome', order: 10, stage: 'always', phase: 'enrolled', per: 'student', due: { sla: 2 },
    title: 'Welcome call and file opened' },
  { key: 'profile', order: 20, stage: 'always', phase: 'profile', per: 'student', due: { sla: 7 },
    title: 'Profile completed and documents collected' },
  { key: 'shortlist', order: 30, stage: 'match', phase: 'shortlist', per: 'student', due: { sla: 14 },
    title: 'Shortlist confirmed with the student' },
  { key: 'sop', order: 40, stage: ['write', 'apply'], phase: 'writing', per: 'student', due: { before: 30 },
    title: 'Statement of Purpose written and approved' },
  { key: 'lor', order: 50, stage: ['write', 'apply'], phase: 'writing', per: 'student', due: { before: 30 },
    title: 'Letters of Recommendation collected' },
  { key: 'appdocs', order: 60, stage: 'apply', phase: 'applying', per: 'student', due: { before: 21 },
    title: 'Application documents assembled' },
  /* The one there is one of per university. */
  { key: 'submit', order: 70, stage: 'apply', phase: 'applying', per: 'uni', due: { before: 7 },
    title: 'Application submitted' },
  { key: 'offer', order: 80, stage: 'apply', phase: 'offers', per: 'student', due: { before: -45 },
    title: 'Offer letter received and recorded' },
  { key: 'visadocs', order: 90, stage: 'visa', phase: 'visa', per: 'student', due: { before: -60 },
    title: 'Visa documents ready' },
  { key: 'visa', order: 100, stage: 'visa', phase: 'visa', per: 'student', due: { before: -75 },
    title: 'Visa application filed' },
];

/* Statuses a task can be in. 'dropped' is the honest name for not-applicable:
   it leaves the row on the file saying somebody decided, rather than deleting
   the evidence that the task was ever owed. */
const STATUSES = ['open', 'doing', 'done', 'blocked', 'dropped'];
/* Neither owed nor late. */
const CLOSED = new Set(['done', 'dropped']);

/**
 * The templates as they are actually in force: the defaults above, with the
 * office's own days and titles laid over them.
 */
function rules(db) {
  let saved = {};
  try { saved = db.content('taskRules') || {}; } catch (e) { saved = {}; }
  return TEMPLATES.map(t => {
    const o = saved[t.key] || {};
    const due = Object.prototype.hasOwnProperty.call(t.due, 'sla')
      ? { sla: Number.isFinite(Number(o.sla)) ? Number(o.sla) : t.due.sla }
      : { before: Number.isFinite(Number(o.before)) ? Number(o.before) : t.due.before };
    return Object.assign({}, t, {
      title: o.title ? String(o.title).slice(0, 140) : t.title,
      due,
      /* An office that does not want a template at all switches it off rather
         than setting its days to something absurd. */
      off: !!o.off,
    });
  });
}

/** What an administrator may change, in the shape the screen sends back. */
function saveRules(db, body, who) {
  const keep = {};
  TEMPLATES.forEach(t => {
    const o = (body && body[t.key]) || {};
    const one = {};
    if (o.title != null && String(o.title).trim()) one.title = String(o.title).trim().slice(0, 140);
    if (o.off) one.off = true;
    if (Object.prototype.hasOwnProperty.call(t.due, 'sla')) {
      const n = Number(o.sla);
      if (Number.isFinite(n) && n >= 0 && n <= 365) one.sla = Math.round(n);
    } else {
      const n = Number(o.before);
      if (Number.isFinite(n) && n >= -365 && n <= 365) one.before = Math.round(n);
    }
    if (Object.keys(one).length) keep[t.key] = one;
  });
  db.setContent('taskRules', keep, who || '');
  return rules(db);
}

/**
 * The deadlines on a shortlist row, as days.
 *
 * `intakes` is stored as JSON on both the programme and the copy the shortlist
 * keeps, and a row can have several — a winter and a summer intake. The one
 * that matters is the next one that has not gone.
 */
function deadlinesOf(row, T) {
  let intakes = [];
  try { intakes = JSON.parse(row.intakes || '[]') || []; } catch (e) { intakes = []; }
  return intakes
    .map(i => i && i.deadline)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')))
    .sort();
}

/**
 * The next deadline on this row that has not already passed.
 *
 * Null when every one of them has gone, and that is the whole point of this
 * function. It used to fall back to the last one, which on a shortlist of
 * closed intakes produced a Statement of Purpose due on the last day of 2021
 * and permanently seventeen hundred days late. A deadline in the past is not
 * a thing to plan backwards from; it is the absence of one.
 */
function nextDeadline(row, T) {
  const ds = deadlinesOf(row, T);
  if (!ds.length) return null;
  const today = DAYS.istDay(T);
  return ds.find(d => d >= today) || null;
}

/**
 * The date the whole file is working backwards from: the earliest deadline
 * still ahead on anything the student has shortlisted. Earliest, not latest,
 * because the SOP has to be ready for the first university that closes, not
 * the last.
 */
function fileDeadline(shortlist, T) {
  const ds = shortlist.map(r => nextDeadline(r, T)).filter(Boolean).sort();
  return ds[0] || null;
}

/**
 * When a task is due.
 *
 * Returns {dueAt, basis} — basis being the word the screen shows to explain
 * the date, because an unexplained date is a date people argue with.
 * A backwards rule with no deadline to work back from falls through to the
 * start date plus the same number of days, so the task still has a date: a
 * task with no date is a task nobody is accountable for.
 */
function dueFor(tpl, opts) {
  const { start, deadline } = opts;
  if (Object.prototype.hasOwnProperty.call(tpl.due, 'sla')) {
    return { dueAt: plus(start, tpl.due.sla), basis: 'sla' };
  }
  if (deadline) return { dueAt: plus(deadline, -tpl.due.before), basis: 'deadline' };
  /* A step that is defined as "so many days before the university closes" has
     no date at all until there is a university with an intake still open. It
     waits, visibly, rather than being given an invented one: a made-up date
     is either nagging about work that cannot start or, worse, quietly late
     the day it is created. It picks up a real date the moment a live deadline
     appears on the shortlist, on the next sweep. */
  return { dueAt: null, basis: 'pending' };
}

/**
 * Bring one student's task list into step with what they bought and where they
 * have applied.
 *
 * Adds what is missing, re-dates what is still open when the deadline behind it
 * moved, and leaves everything a person has touched alone. It never deletes:
 * a university dropped from a shortlist leaves its submission task behind for
 * somebody to close, because a task that disappears is a task nobody answers
 * for.
 *
 * Safe to call as often as you like — on every order, every shortlist change,
 * and on the sweep. Returns the student's tasks.
 */
function syncTasks(db, student, now) {
  const T = now ? new Date(now).getTime() : Date.now();
  const st = typeof student === 'object' ? student : db.studentById(Number(student));
  if (!st) return [];
  const sid = Number(st.id);

  const stages = ALERTS.stagesFor(db, st);
  const live = rules(db).filter(t => !t.off
    && (Array.isArray(t.stage) ? t.stage : [t.stage]).some(x => stages.has(x)));
  if (!live.length) return db.tasksFor(sid);

  const shortlist = db.getShortlist(sid) || [];
  const owner = st.counsellor_id ? Number(st.counsellor_id) : null;
  /* The clock starts when the file opened, which is the day they signed up.
     Not the day the order was paid: a student who buys the visa service in
     March did not get a two-day welcome call owed to them in March. */
  const start = st.created_at || new Date(T).toISOString();
  const deadline = fileDeadline(shortlist, T);

  const have = new Map();
  db.tasksFor(sid).forEach(r => have.set(String(r.task_key) + '\u0000' + String(r.prog_id || ''), r));

  const want = [];
  live.forEach(tpl => {
    if (tpl.per === 'uni') {
      shortlist.forEach(row => {
        const d = nextDeadline(row, T);
        /* The UNIVERSITY AND THE PROGRAMME, both.
         *
         * A shortlist often holds two courses at one university, and naming
         * only the university produced two rows a counsellor could not tell
         * apart: same words, same date, different application. The one thing
         * a task in a list of forty has to do is say which thing it is. */
        const where = [row.university, row.program].filter(Boolean).join(' · ');
        want.push({
          tpl, progId: String(row.prog_id),
          title: tpl.title + ' — ' + (where || 'university'),
          due: dueFor(tpl, { start, deadline: d }),
        });
      });
    } else {
      want.push({ tpl, progId: '', title: tpl.title, due: dueFor(tpl, { start, deadline }) });
    }
  });

  want.forEach(w => {
    const key = w.tpl.key + '\u0000' + w.progId;
    const row = have.get(key);
    if (!row) {
      db.addTask({
        studentId: sid, ownerId: owner, key: w.tpl.key, title: w.title,
        progId: w.progId, dueAt: w.due.dueAt, basis: w.due.basis,
        status: 'open', source: 'auto',
      });
      return;
    }
    /* The deadline moved and this is still open: follow it. A task somebody has
       finished, dropped or hand-dated keeps the date it has. */
    if (CLOSED.has(String(row.status))) return;
    if (String(row.source) !== 'auto') return;
    /* A date a person typed is theirs. 'set' is the row saying so, and the
       generator does not argue with it when a deadline shifts underneath. */
    if (String(row.due_basis) === 'set') return;
    /* The office renaming a step in the standard list, or a university being
       renamed in the catalogue, reaches the open tasks that carry that name.
       A board where half the rows say the old thing is a board people stop
       reading carefully. */
    if (String(row.title || '') !== w.title) db.updateTask(row.id, { title: w.title });
    if ((row.due_at || null) !== w.due.dueAt || String(row.due_basis) !== w.due.basis) {
      db.updateTask(row.id, { dueAt: w.due.dueAt, basis: w.due.basis });
    }
  });

  return db.tasksFor(sid);
}

/** Every student's list brought up to date. The sweep's first move. */
function syncAll(db, now) {
  let n = 0;
  (db.allStudents() || []).forEach(st => {
    try { syncTasks(db, st, now); n += 1; } catch (e) { /* one bad file is not the sweep */ }
  });
  return n;
}

/**
 * How late a task is, in days. Positive means overdue, 0 means due today,
 * negative means still to come. Closed tasks are never late.
 */
function lateness(row, now) {
  if (!row || !row.due_at || CLOSED.has(String(row.status))) return null;
  return DAYS.daysPast(String(row.due_at).slice(0, 10), now);
}

/** Owed, and the day it was owed by has gone. Due today is not late. */
function isLate(row, now) {
  const n = lateness(row, now);
  return n != null && n > 0;
}

/**
 * Who owes this task today.
 *
 * A task keeps the counsellor it was given to, so last month's record does not
 * change when a file is handed over. But a task with nobody on it, or one whose
 * person has gone, is owed by whoever holds the file now.
 */
function ownerOf(db, row) {
  if (row && row.owner_id) return Number(row.owner_id);
  try {
    const st = db.studentById(Number(row.student_id));
    return st && st.counsellor_id ? Number(st.counsellor_id) : null;
  } catch (e) { return null; }
}

/**
 * Which phase a student is in, and how they are doing inside it.
 *
 * The phase is the FIRST one that is not finished. Not the furthest thing
 * they have touched: a student who has submitted to one university but never
 * agreed a shortlist is still shortlisting, and saying otherwise would hide
 * the thing that is actually stuck.
 *
 * A phase can hold many tasks — Applying holds one submission per
 * shortlisted university, so a ten-university shortlist is ten tasks — and
 * "Applying" on its own says nothing about whether that is day one or day
 * fifty. So the phase carries its own count, and the screens show it:
 * Applying, 6 of 10 submitted.
 *
 *   key/label   where they are
 *   done/total  how far through THIS phase
 *   since       when they entered it — the last thing finished before it
 *   days        how long they have been sitting in it
 *   late        tasks in this phase past their date
 *   blocking    those tasks, worst first, so "ask about it" has a subject
 *   waiting     true when nothing here is late but nothing is moving either:
 *               everything is open, and has been for a fortnight. This is the
 *               quiet failure — not a breached date, just a file nobody has
 *               touched — and it is the case the office asked to be able to
 *               ask about.
 */
function phaseOf(db, student, now) {
  const T = now ? new Date(now).getTime() : Date.now();
  const st = typeof student === 'object' ? student : db.studentById(Number(student));
  if (!st) return null;
  const rows = (db.tasksFor(st.id) || []).filter(t => String(t.status) !== 'dropped');
  const phaseKey = t => {
    const tpl = TEMPLATES.find(x => x.key === t.task_key);
    /* A task somebody typed by hand belongs to wherever the student is now,
       not to a phase of its own — it is extra work on this file, not a new
       step in everybody's journey. */
    return tpl ? tpl.phase : null;
  };

  /* The phases this student actually has, in order. Somebody who bought a
     shortlist has no visa phase, and showing them stuck before one they will
     never reach would be nonsense. */
  const present = PHASES.filter(p => rows.some(t => phaseKey(t) === p.key));
  if (!present.length) {
    return { key: 'enrolled', label: 'Enrolled', index: 0, of: PHASES.length,
      done: 0, total: 0, since: st.created_at, days: 0, late: 0, waiting: false,
      blocking: [], finished: false };
  }

  const at = present.find(p => rows.some(t => phaseKey(t) === p.key && !CLOSED.has(String(t.status))));
  /* Everything they owe is finished. */
  if (!at) {
    const last = rows.map(t => t.done_at).filter(Boolean).sort();
    return { key: 'departed', label: 'Departed', index: PHASES.length - 1, of: PHASES.length,
      done: rows.length, total: rows.length, since: last[last.length - 1] || st.created_at,
      days: 0, late: 0, waiting: false, blocking: [], finished: true };
  }

  const mine = rows.filter(t => phaseKey(t) === at.key);
  const done = mine.filter(t => String(t.status) === 'done');
  const open = mine.filter(t => !CLOSED.has(String(t.status)));
  const late = open.filter(t => isLate(t, T));

  /* Entered this phase when the last thing before it was finished — or, for
     the first phase, when the file opened. */
  const before = rows.filter(t => {
    const k = phaseKey(t);
    return k && PHASE_AT.get(k) < PHASE_AT.get(at.key) && t.done_at;
  }).map(t => t.done_at).sort();
  const since = before[before.length - 1] || st.created_at;
  const days = DAYS.daysBetweenDays(DAYS.istDay(since), DAYS.istDay(T)) || 0;

  return {
    key: at.key, label: at.label, short: at.short,
    index: PHASE_AT.get(at.key), of: PHASES.length,
    done: done.length, total: mine.length,
    since, days, late: late.length,
    /* Two weeks in one phase with nothing finished and nothing yet late is
       the file that quietly stops. It breaches no rule, so nothing chases
       it — which is exactly why it needs naming. */
    waiting: !late.length && !done.length && days >= 14,
    blocking: open
      .map(t => ({ id: t.id, title: t.title, due: t.due_at || '', over: lateness(t, T) }))
      .sort((a, b) => (b.over == null ? -1e9 : b.over) - (a.over == null ? -1e9 : a.over))
      .slice(0, 10),
    finished: false,
  };
}

/**
 * The book by phase, for the office's funnel.
 *
 * `only` limits it to a set of student ids — a counsellor sees their own
 * caseload shaped the same way, not the whole company's.
 */
function funnel(db, now, only) {
  const counts = new Map(PHASES.map(p => [p.key, { ...p, students: 0, late: 0, waiting: 0 }]));
  (db.allStudents() || []).forEach(st => {
    if (only && !only.has(Number(st.id))) return;
    let ph = null;
    try { ph = phaseOf(db, st, now); } catch (e) { ph = null; }
    if (!ph) return;
    const row = counts.get(ph.key);
    if (!row) return;
    row.students += 1;
    if (ph.late) row.late += 1;
    if (ph.waiting) row.waiting += 1;
  });
  return [...counts.values()];
}

/** One student's progress, in the shape the student's own screen shows. */
function progressOf(db, studentId, now) {
  const rows = (db.tasksFor(Number(studentId)) || [])
    .filter(r => String(r.status) !== 'dropped');
  const byKey = new Map(TEMPLATES.map((t, i) => [t.key, i]));
  rows.sort((a, b) => (byKey.get(a.task_key) ?? 999) - (byKey.get(b.task_key) ?? 999)
    || String(a.due_at || '').localeCompare(String(b.due_at || '')));
  const done = rows.filter(r => String(r.status) === 'done').length;
  return {
    done, total: rows.length,
    percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
    steps: rows.map(r => ({
      title: r.title,
      /* Whether the target day has gone. NOT how late it is and NOT whose
         fault — the student is told the work is running behind, which is
         theirs to know, and nothing about who owes it, which is not. */
      behind: String(r.status) !== 'done' && DAYS.isPast(String(r.due_at || '').slice(0, 10), now),
      /* The student sees three states, not five. 'blocked' reads as in hand,
         because "blocked" to a student means "something is wrong with me". */
      state: String(r.status) === 'done' ? 'done'
        : String(r.status) === 'doing' || String(r.status) === 'blocked' ? 'doing' : 'next',
      /* Their own target date, and nothing about who owes it or whether
         anybody is late: that is the office's business, not theirs. */
      by: r.due_at || '',
      on: String(r.status) === 'done' ? String(r.done_at || '').slice(0, 10) : '',
    })),
  };
}

/**
 * What one counsellor actually did, over a window of days.
 *
 * "What have you done since one week, what tasks have you completed." That is
 * a question about a record, not about a person, and asking a person to
 * assemble their own week from memory produces the answer they can most
 * easily defend rather than the one that is true. The office reads it here
 * and then asks the question worth asking.
 *
 * Counted on the work, not on effort: finished, finished late, started,
 * still owed, newly gone past its date, and the files that had anything
 * happen on them at all.
 */
function activityOf(db, staffId, days, now) {
  const T = now ? new Date(now).getTime() : Date.now();
  /* `days` is honoured as given, including 0 — which means today. It used to
     go through `Number(days) || 7`, so somebody asking for today's work was
     handed the week's and had no way to tell. */
  const asked = Number(days);
  const window = Number.isFinite(asked) ? Math.min(3650, Math.max(0, Math.round(asked))) : 7;
  const since = new Date(DAYS.addDays(DAYS.istDay(T), -window) + 'T00:00:00Z').getTime()
    - DAYS.IST_OFFSET;
  const id = Number(staffId);
  const mine = (db.allTasks() || []).filter(t => {
    const owner = ownerOf(db, t);
    return owner != null && Number(owner) === id;
  });

  const inWindow = at => at && new Date(at).getTime() >= since;
  const done = mine.filter(t => String(t.status) === 'done' && inWindow(t.done_at));
  /* Finished on or before the agreed day, IN INDIA. Comparing the raw
     timestamps' first ten characters compares UTC days, so work finished at
     00:30 in the office — 19:00 UTC the previous day — scored as on time
     when it was in fact a day late. It only ever erred in the flattering
     direction, which is the worst way for a scoreboard to be wrong. */
  const onDay = t => (t ? DAYS.istDay(t) : '');
  const finishedOnTime = t => !t.due_at || !t.done_at
    || onDay(t.done_at) <= String(t.due_at).slice(0, 10);
  const onTime = done.filter(finishedOnTime);
  const open = mine.filter(t => !CLOSED.has(String(t.status)));
  const late = open.filter(t => isLate(t, T));
  /* Went past its date DURING the window — the ones that slipped on their
     watch this week, as distinct from the backlog they inherited. */
  const slipped = late.filter(t => t.due_at
    && Date.parse(String(t.due_at).slice(0, 10) + 'T00:00:00Z') >= since);
  const started = mine.filter(t => String(t.status) === 'doing');
  const stuck = mine.filter(t => String(t.status) === 'blocked');

  const name = t => {
    const st = db.studentById(Number(t.student_id));
    return (st ? st.name : 'Unknown') + ' — ' + String(t.title || '');
  };
  return {
    days: window,
    students: new Set(mine.map(t => Number(t.student_id))).size,
    finished: done.length,
    finishedOnTime: onTime.length,
    finishedList: done
      .sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)))
      .slice(0, 40)
      .map(t => ({ title: name(t), on: onDay(t.done_at),
        due: t.due_at || '', late: !finishedOnTime(t) })),
    stillOwed: open.length,
    late: late.length,
    slipped: slipped.length,
    inHand: started.length,
    stuck: stuck.length,
    stuckList: stuck.slice(0, 20).map(t => ({ title: name(t), why: t.note || '' })),
    /* The ones to ask about: longest past their date first. */
    worst: late
      .map(t => ({ id: t.id, studentId: t.student_id, title: name(t),
        due: t.due_at, over: lateness(t, T) }))
      .sort((a, b) => b.over - a.over)
      .slice(0, 12),
  };
}

module.exports = {
  TEMPLATES, STATUSES, CLOSED,
  PHASES, rules, saveRules, syncTasks, syncAll, lateness, isLate, ownerOf,
  progressOf, activityOf, phaseOf, funnel,
  nextDeadline, fileDeadline, dueFor,
};
