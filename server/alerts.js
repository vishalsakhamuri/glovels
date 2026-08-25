'use strict';
/**
 * What needs doing, and who it needs doing by.
 *
 * Four things go wrong quietly in this business, and every one of them was
 * invisible until somebody complained:
 *
 *   a deadline arrives     An application deadline is a date on a university's
 *                          website. Nothing on this site knew it was coming,
 *                          so the first anyone heard about a missed intake was
 *                          the student asking why.
 *
 *   a counsellor goes quiet  A student writes, and nobody answers. There was no
 *                          number anywhere that said how long they had been
 *                          waiting, so the only way to find out was to be told.
 *
 *   a profile stays empty  Half a profile blocks the application and the visa.
 *                          The student is not being obstructive; nobody has
 *                          said which four boxes are missing.
 *
 *   a lead goes cold       Somebody said "call me Tuesday" and Tuesday went
 *                          past.
 *
 * Every alert has the same shape, so one panel can show all of them and one
 * email can list them:
 *
 *   kind      what sort of thing it is
 *   urgency   'now' | 'soon' | 'watch' — decided here, once, so the screen and
 *             the email cannot disagree about what is urgent
 *   title     one line, readable on its own in a notification
 *   detail    the sentence under it
 *   who       the staff id it is for, or null for "anybody"
 *   subject   {studentId} or {leadId}, so a screen can open the thing
 *   at        when it became true, or the date it is about
 *
 * Computed on read rather than stored. An alert is a fact about the data —
 * "this deadline is in six days" — and a stored copy of a fact is a copy that
 * goes stale the moment somebody uploads the document.
 */

const DAY = 864e5;
const PLANS = require('./plans.js');

const iso = d => new Date(d).toISOString();
const inr = paise => '₹' + Number(Math.round((paise || 0) / 100)).toLocaleString('en-IN');
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / DAY);

/* What a student has to have. Kept in step with the profile screen's own
   section list and the documents screen's — both are authored as data there,
   and this is the third reader of the same truth. A field that is optional
   depending on an answer is not counted as missing. */
/*
 * WHAT IS ACTUALLY REQUIRED DEPENDS ON WHAT THEY BOUGHT.
 *
 * "These are not mandatory for everyone. They are only mandatory for students
 *  where applications are filed and the visa process is selected in the
 *  package. For other services these are not mandatory — whatever is required
 *  to complete the service, they need to fill it."
 *
 * This list used to be flat, and every one of the twenty-seven items was
 * demanded of everybody. Somebody who paid ₹99 for three university names, or
 * ₹599 for an SOP rewrite, signed in to "your file is 0% complete" and a
 * demand for their Class 10 marksheet and their financial documents. Neither
 * has anything to do with what they bought, and being told a purchase is 0%
 * complete when it is finished and delivered is simply wrong.
 *
 * So every requirement carries the stage that needs it:
 *
 *   always  we cannot contact them or address them without it
 *   match   the matcher reads it to pick universities
 *   apply   a university's application form asks for it
 *   visa    a consulate asks for it
 *
 * and a student is asked only for the stages their orders have actually
 * reached. A ₹99 buyer is asked for four things. Somebody on Boarding Pass,
 * which files applications and runs the visa, is asked for all of it — and for
 * them the old wording is exactly right.
 */
const PROFILE_MUST = [
  ['fullName', 'full name', ['always']],
  ['phone', 'mobile number', ['always']],
  /* The four the matcher reads. `usable()` in matches.js is the other reader
     of this same truth. */
  ['g_level', 'what they want to study', ['match', 'write', 'apply']],
  ['g_country', 'where', ['match', 'write', 'apply']],
  ['d_cgpa', 'degree CGPA', ['match', 'write', 'apply']],
  ['g_intake', 'which intake', ['match', 'apply']],
  /* What somebody writing an SOP, an LOR or a CV needs to know about them —
     and nothing beyond it. A ₹599 SOP rewrite does not need a Class 10
     marksheet, and asking for one is how a finished purchase reads as 0%. */
  ['d_uni', 'degree university', ['write', 'apply']],
  ['d_course', 'degree course', ['write', 'apply']],
  ['d_year', 'degree year', ['write', 'apply']],
  /* Everything a university's application form asks for on top of that. */
  ['dob', 'date of birth', ['apply']],
  ['city', 'city', ['apply']],
  ['x_board', 'Class 10 board', ['apply']],
  ['x_year', 'Class 10 year', ['apply']],
  ['x_score', 'Class 10 score', ['apply']],
  ['xii_board', 'Class 12 board', ['apply']],
  ['xii_year', 'Class 12 year', ['apply']],
  ['xii_score', 'Class 12 score', ['apply']],
  /* And what a consulate asks for. */
  ['p_has', 'whether they have a passport', ['visa']],
];

const DOCS_MUST = [
  ['x', 'Class 10 marksheet', ['apply']],
  ['xii', 'Class 12 marksheet', ['apply']],
  ['degree', 'Degree transcripts', ['apply']],
  ['english', 'English test scorecard', ['apply']],
  /* Never asked of somebody who is BUYING one of these. The CV service writes
     the CV; demanding they upload a CV first is the screen not knowing what
     was sold. Applications need them, so an application customer is asked. */
  ['cv', 'Academic CV', ['apply']],
  ['sop', 'Statement of Purpose', ['apply']],
  ['lor', 'Letters of Recommendation', ['apply']],
  ['passport', 'Passport', ['visa']],
  ['finance', 'Financial documents', ['visa']],
];

/* Which stages this student's orders have reached. Always at least `always`,
   because a name and a number are needed whatever was bought. */
const STAGES = ['always', 'match', 'write', 'apply', 'visa'];

function stagesFor(db, student) {
  const on = new Set(['always']);
  if (!db || !student) return on;
  let orders = [];
  try { orders = db.ordersFor(student.id) || []; } catch (e) { orders = []; }
  orders.forEach(o => {
    if (!EARNED_STATES.has(String(o.status))) return;
    /* Anything that shortlists universities needs the matcher's six. */
    if (Number(o.public_unis || 0) > 0) on.add('match');
    let items = [];
    try { items = JSON.parse(o.items || '[]') || []; } catch (e) { items = []; }
    const ids = items.map(x => String(x.id || ''));
    if (ids.some(id => /first-three|shortlist-ten|scholar/.test(id))) on.add('match');
    /* And the two stages that are the whole reason this list is long. Read off
       the order's own package, so a package the office renames still behaves. */
    const pkg = String(o.package_id || o.package || '');
    if (/offer|boarding/i.test(pkg)) { on.add('match'); on.add('apply'); }
    if (/boarding/i.test(pkg)) on.add('visa');
    if (ids.some(id => /^visa$/.test(id))) on.add('visa');
    /* Writing services need to know who they are writing about, not what a
       consulate wants. */
    if (ids.some(id => /^(sop|lor|cv|reeval|interview|career|profile)$/.test(id))) on.add('write');
  });
  return on;
}

/* `paid`, `owing` and `part` are money in or money agreed. `awaiting` is a
   gateway mid-collection and has confirmed nothing. Kept in step with EARNED
   in api.js, which is the other reader of this rule. */
const EARNED_STATES = new Set(['paid', 'owing', 'part']);

const wanted = (list, stages) => list.filter(([, , need]) => {
  const on = Array.isArray(need) ? need : [need || 'always'];
  return on.some(x => x === 'always' || stages.has(x));
});

function missingFrom(profile, stages) {
  const p = profile || {};
  const want = stages ? wanted(PROFILE_MUST, stages) : PROFILE_MUST;
  return want.filter(([k]) => !String(p[k] == null ? '' : p[k]).trim())
    .map(([, label]) => label);
}

function missingDocs(docs, stages) {
  const have = new Set((docs || []).map(d => String(d.doc_key || d.key)));
  const want = stages ? wanted(DOCS_MUST, stages) : DOCS_MUST;
  return want.filter(([k]) => !have.has(k)).map(([, label]) => label);
}

/**
 * How long a student has been waiting for a reply.
 *
 * The last message being theirs is the whole test. A conversation where the
 * counsellor spoke last is not waiting on anybody, whatever its age.
 */
function waitingSince(msgs) {
  if (!msgs || !msgs.length) return null;
  const last = msgs[msgs.length - 1];
  if (String(last.sender) !== 'me') return null;      // 'me' is the student
  return last.created_at;
}

/**
 * Everything, for everybody. Filtered per person by the caller.
 *
 * `now` is passed in rather than read, so a test can ask what this looks like
 * next Tuesday without waiting until Tuesday.
 */
function all(db, now) {
  const T = now ? new Date(now).getTime() : Date.now();
  const out = [];
  const add = a => out.push(a);

  const students = db.allStudents();
  const byId = new Map(students.map(s => [Number(s.id), s]));

  for (const st of students) {
    const owner = st.counsellor_id ? Number(st.counsellor_id) : null;

    /* ---- nobody is looking after them ---- */
    if (!owner) {
      add({
        kind: 'unassigned', urgency: 'soon', who: null,
        title: st.name + ' has no counsellor',
        detail: 'They signed up ' + daysBetween(T, st.created_at) + ' day(s) ago and nobody '
          + 'has been given their file. Assign somebody on the Organisation screen.',
        subject: { studentId: st.id }, at: st.created_at,
      });
    }

    /* ---- a deadline is coming ---- */
    const apps = {};
    db.getApplications(st.id).forEach(a => { apps[String(a.prog_id)] = a; });
    for (const row of db.getShortlist(st.id)) {
      let intakes = [];
      try { intakes = JSON.parse(row.intakes || '[]'); } catch (e) { intakes = []; }
      const app = apps[String(row.prog_id)] || { stage: 0, outcome: '' };
      /* Submitted, or decided. A deadline for an application that is already in
         is not a deadline, it is history. */
      if (Number(app.stage) >= 2 || app.outcome) continue;

      const next = intakes
        .map(i => i && i.deadline)
        .filter(Boolean)
        .map(d => ({ d, in: daysBetween(d, T) }))
        .filter(x => x.in >= -1)
        .sort((a, b) => a.in - b.in)[0];
      if (!next || next.in > 45) continue;

      add({
        kind: 'deadline',
        urgency: next.in <= 7 ? 'now' : next.in <= 21 ? 'soon' : 'watch',
        who: owner,
        title: next.in < 0
          ? (row.university || 'A university') + ' closed yesterday for ' + st.name
          : next.in === 0
            ? (row.university || 'A university') + ' closes today for ' + st.name
            : (row.university || 'A university') + ' closes in ' + next.in + ' day'
              + (next.in === 1 ? '' : 's') + ' for ' + st.name,
        detail: (row.program ? row.program + ' — ' : '')
          + 'deadline ' + String(next.d).slice(0, 10)
          + '. The application has not been submitted.',
        subject: { studentId: st.id, progId: row.prog_id }, at: next.d,
      });
    }

    /* ---- somebody is waiting for a reply ---- */
    const msgs = db.getMessages(st.id);
    const since = waitingSince(msgs);
    if (since) {
      const hours = Math.floor((T - new Date(since).getTime()) / 36e5);
      if (hours >= 24) {
        add({
          kind: 'silent',
          /* Two days without an answer is not a queue, it is a lost customer. */
          urgency: hours >= 48 ? 'now' : 'soon',
          who: owner,
          title: st.name + ' has been waiting ' + (hours >= 48
            ? Math.floor(hours / 24) + ' days' : hours + ' hours') + ' for a reply',
          detail: 'Their last message: “'
            + String(msgs[msgs.length - 1].body || '').slice(0, 120) + '”',
          subject: { studentId: st.id }, at: since,
        });
      }
    }

    /* ---- their file is not finished ---- */
    /* Scoped to what they bought, like the student's own screen. Chasing an
       SOP customer for their financial documents wastes the office's morning
       and the student's patience. */
    const stages = stagesFor(db, st);
    const gaps = missingFrom(db.getProfile(st.id), stages);
    const docGaps = missingDocs(db.getDocuments(st.id), stages);
    if (gaps.length || docGaps.length) {
      /* Only worth raising with the office once somebody has paid or been
         assigned — a browser who made an account yesterday has an empty
         profile because they made an account yesterday. */
      const engaged = owner || db.ordersFor(st.id).some(o => o.status === 'paid' || o.status === 'owing');
      const old = daysBetween(T, st.created_at) >= 3;
      if (engaged && old) {
        add({
          kind: 'profile', urgency: docGaps.length > 4 ? 'soon' : 'watch', who: owner,
          title: st.name + '’s file is ' + (gaps.length + docGaps.length)
            + ' item(s) short',
          detail: [
            gaps.length ? gaps.length + ' profile field(s): ' + gaps.slice(0, 4).join(', ')
              + (gaps.length > 4 ? '…' : '') : '',
            docGaps.length ? docGaps.length + ' document(s): ' + docGaps.slice(0, 4).join(', ')
              + (docGaps.length > 4 ? '…' : '') : '',
          ].filter(Boolean).join(' · '),
          subject: { studentId: st.id }, at: st.created_at,
        });
      }
    }
  }

  /* ---- a part payment whose date has gone past ---- */
  for (const o of db.allOrders()) {
    if (o.status === 'paid') continue;
    let plan = null;
    try { plan = o.plan ? JSON.parse(o.plan) : null; } catch (e) { plan = null; }
    if (!plan) continue;
    const late = PLANS.overdue(plan, T);
    if (!late.length) continue;
    const st = o.student_id ? byId.get(Number(o.student_id)) : null;
    const owner = st && st.counsellor_id ? Number(st.counsellor_id) : null;
    const days = daysBetween(T, late[0].dueAt);
    add({
      kind: 'payment',
      /* A week late is a conversation. A month late is a decision somebody
         has to make about whether the work continues. */
      urgency: days >= 30 ? 'now' : days >= 7 ? 'soon' : 'watch',
      who: owner,
      title: (o.name || (st && st.name) || 'A student') + ' — '
        + inr(late.reduce((n, p) => n + Number(p.paise || 0), 0))
        + ' overdue on ' + o.reference,
      detail: late.map(p => p.label + ' (' + inr(p.paise) + ', due '
        + String(p.dueAt).slice(0, 10) + ')').join(' · '),
      subject: { studentId: o.student_id || null, reference: o.reference },
      at: late[0].dueAt,
    });
  }

  /* ---- a lead nobody has called, or a follow-up that was promised ---- */
  const noteCounts = db.leadNoteCounts();
  for (const e of db.allEnquiries()) {
    if (e.status === 'converted' || e.status === 'lost') continue;
    const owner = e.owner_id ? Number(e.owner_id) : null;
    const touched = (noteCounts[String(e.id)] || { n: 0 }).n;

    if (e.next_at) {
      const due = daysBetween(String(e.next_at).slice(0, 10), T);
      if (due <= 0) {
        add({
          kind: 'followup', urgency: due <= -2 ? 'now' : 'soon', who: owner,
          title: 'Follow up with ' + (e.name || 'a lead')
            + (due < 0 ? ' — ' + -due + ' day(s) late' : ' — today'),
          detail: (e.phone || e.email || 'no number given')
            + (e.note ? ' · ' + String(e.note).slice(0, 90) : ''),
          subject: { leadId: e.id }, at: e.next_at,
        });
        continue;
      }
    }

    if (!touched) {
      const age = daysBetween(T, e.created_at);
      if (age >= 1) {
        add({
          kind: 'cold', urgency: age >= 3 ? 'now' : 'soon', who: owner,
          title: (e.name || 'A lead') + ' has been waiting ' + age + ' day'
            + (age === 1 ? '' : 's') + ' and nobody has called',
          detail: (e.source || 'website') + ' · ' + (e.phone || e.email || 'no number given'),
          subject: { leadId: e.id }, at: e.created_at,
        });
      }
    }
  }

  const RANK = { now: 0, soon: 1, watch: 2 };
  out.sort((a, b) => (RANK[a.urgency] - RANK[b.urgency])
    || String(a.at).localeCompare(String(b.at)));
  return { alerts: out, byId };
}

/**
 * The ones a particular person is answerable for.
 *
 * An administrator sees everything, because "the counsellor has not replied in
 * 24 hours" is an alert ABOUT a counsellor and is no use only to them. A
 * counsellor sees their own students and their own leads, plus the ones nobody
 * owns — an alert nobody can see is an alert nobody acts on.
 */
function forStaff(db, staff, now) {
  const { alerts } = all(db, now);
  if (staff.role === 'admin') return alerts;
  return alerts.filter(a => a.who == null || Number(a.who) === Number(staff.id));
}

/** What one student is being asked for. Their own file, and nothing else. */
function forStudent(db, student) {
  const stages = stagesFor(db, student);
  const gaps = missingFrom(db.getProfile(student.id), stages);
  const docGaps = missingDocs(db.getDocuments(student.id), stages);
  const wantP = wanted(PROFILE_MUST, stages).length;
  const wantD = wanted(DOCS_MUST, stages).length;
  const total = wantP + wantD;
  return {
    profileMissing: gaps,
    documentsMissing: docGaps,
    /* Which stages are being asked for, so the screen can say WHY rather than
       just how much is left. */
    stages: STAGES.filter(x => stages.has(x)),
    /* A percentage of what THIS student actually needs. Somebody who bought an
       SOP rewrite and gave us their name and number is finished, and a bar
       telling them they are 7% complete is the screen being wrong about their
       own purchase. */
    complete: total ? Math.round((total - gaps.length - docGaps.length) / total * 100) : 100,
  };
}

const counts = list => list.reduce((m, a) => {
  m[a.urgency] = (m[a.urgency] || 0) + 1;
  m.total = (m.total || 0) + 1;
  return m;
}, { now: 0, soon: 0, watch: 0, total: 0 });

module.exports = {
  all, forStaff, forStudent, counts,
  missingFrom, missingDocs, waitingSince, stagesFor,
  PROFILE_MUST, DOCS_MUST, STAGES,
};
