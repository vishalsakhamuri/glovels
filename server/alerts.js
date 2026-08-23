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

const iso = d => new Date(d).toISOString();
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / DAY);

/* What a student has to have. Kept in step with the profile screen's own
   section list and the documents screen's — both are authored as data there,
   and this is the third reader of the same truth. A field that is optional
   depending on an answer is not counted as missing. */
const PROFILE_MUST = [
  ['fullName', 'full name'], ['dob', 'date of birth'], ['phone', 'mobile number'],
  ['city', 'city'],
  ['x_board', 'Class 10 board'], ['x_year', 'Class 10 year'], ['x_score', 'Class 10 score'],
  ['xii_board', 'Class 12 board'], ['xii_year', 'Class 12 year'], ['xii_score', 'Class 12 score'],
  ['d_uni', 'degree university'], ['d_course', 'degree course'], ['d_year', 'degree year'],
  ['d_cgpa', 'degree CGPA'],
  ['g_level', 'what they want to study'], ['g_country', 'where'], ['g_intake', 'which intake'],
  ['p_has', 'whether they have a passport'],
];

const DOCS_MUST = [
  ['passport', 'Passport'], ['x', 'Class 10 marksheet'], ['xii', 'Class 12 marksheet'],
  ['degree', 'Degree transcripts'], ['english', 'English test scorecard'],
  ['cv', 'Academic CV'], ['sop', 'Statement of Purpose'],
  ['lor', 'Letters of Recommendation'], ['finance', 'Financial documents'],
];

function missingFrom(profile) {
  const p = profile || {};
  return PROFILE_MUST.filter(([k]) => !String(p[k] == null ? '' : p[k]).trim())
    .map(([, label]) => label);
}

function missingDocs(docs) {
  const have = new Set((docs || []).map(d => String(d.doc_key || d.key)));
  return DOCS_MUST.filter(([k]) => !have.has(k)).map(([, label]) => label);
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
    const gaps = missingFrom(db.getProfile(st.id));
    const docGaps = missingDocs(db.getDocuments(st.id));
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
  const gaps = missingFrom(db.getProfile(student.id));
  const docGaps = missingDocs(db.getDocuments(student.id));
  return {
    profileMissing: gaps,
    documentsMissing: docGaps,
    /* A percentage, so the screen can show a bar rather than a scolding. */
    complete: Math.round(
      ((PROFILE_MUST.length - gaps.length) + (DOCS_MUST.length - docGaps.length))
      / (PROFILE_MUST.length + DOCS_MUST.length) * 100),
  };
}

const counts = list => list.reduce((m, a) => {
  m[a.urgency] = (m[a.urgency] || 0) + 1;
  m.total = (m.total || 0) + 1;
  return m;
}, { now: 0, soon: 0, watch: 0, total: 0 });

module.exports = {
  all, forStaff, forStudent, counts,
  missingFrom, missingDocs, waitingSince,
  PROFILE_MUST, DOCS_MUST,
};
