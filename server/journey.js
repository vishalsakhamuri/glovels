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

/* N17-09 (16 Oct): the six stages are the counsellor's nine phases in the
   student's words — the SAME computation (TASKS.phaseOf), folded. `phases`
   is that fold. The first stage was called "Enrolled", which read as the
   university enrolment on a file that had one; it is the file being opened. */
const STAGES = [
  { key: 'enrolled', label: 'File opened', phases: ['enrolled'] },
  { key: 'profile', label: 'Profile and documents', phases: ['profile'] },
  { key: 'shortlist', label: 'Shortlist agreed', phases: ['shortlist'] },
  { key: 'applying', label: 'Applying', phases: ['writing', 'applying'] },
  { key: 'offers', label: 'Offers', phases: ['offers'] },
  { key: 'visa', label: 'Visa and departure', phases: ['visa', 'service', 'departed'] },
];
const STAGE_OF = {};
STAGES.forEach((x, i) => x.phases.forEach(p => { STAGE_OF[p] = i; }));

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
  /* As every screen counts them — steps the applications overtook read done. */
  try { tasks = (TASKS.effectiveTasks(db, s, null, now) || []).filter(t => String(t.status) !== 'dropped'); } catch (e) { tasks = []; }
  /* THE phase — the counsellor's. Everything below only words it. */
  let ph = null;
  try { ph = TASKS.phaseOf(db, s, now); } catch (e) { ph = null; }
  const V = TASKS.visaOf(db, s.id);
  let VR = { ok: 0, of: 6 };
  try { VR = visaReadiness(db, s.id); } catch (e) { /* nothing verified */ }
  let R = { ok: 0, of: 10 };
  try { R = readiness(db, s.id); } catch (e) { /* nothing verified */ }
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
        detail = allDone(rows) || filed ? 'Your file is open with your counsellor'
          : 'Your counsellor calls you to open your file';
        break;
      case 'profile':
        /* Round 177 (item 9): a filed application is not the documents. The
           rows are the effective tasks, and the documents step only reads
           done — ticked or derived — once the required documents are
           verified, so this is the same check the phase makes. */
        done = allDone(rows) || (!rows.length && R.ok >= R.of);
        detail = done ? 'Your details and documents are in'
          : R.ok + ' of ' + R.of + ' documents verified';
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
      case 'visa': {
        done = allDone(rows) && V.decision === 'granted' && !!V.travelDate;
        moving = moving || enrolledAt > 0;
        /* N17-09: "Visa done" was said once the tasks were ticked — with only
           the application filed. Granted is the only "done". */
        const visaFiled = tasks.some(t => t.task_key === 'visa' && String(t.status) === 'done');
        detail = V.decision === 'granted'
          ? 'Visa granted' + (V.travelDate ? ' · travelling ' + day(V.travelDate) : ' · confirm your travel date')
          : V.decision === 'refused' ? 'The visa was refused — your counsellor is preparing the next step'
          : V.decision === 'more' ? 'The consulate asked for more documents'
          : visaFiled ? 'Visa application filed — waiting for the decision'
          : (ph && (ph.key === 'visa' || ph.key === 'service')) ? VR.ok + ' of ' + VR.of + ' visa documents verified'
          : 'After you accept an offer';
        break;
      }
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

  /* N17-09: WHERE THEY ARE is the counsellor's phase, folded into six — not a
     second calculation. Monotone: everything before it is done. Without a
     phase (never expected) the evidence-only reading stands in. */
  let at, finished;
  if (ph) {
    finished = !!ph.finished;
    at = finished ? raw.length : (STAGE_OF[ph.key] != null ? STAGE_OF[ph.key] : 0);
  } else {
    at = raw.findIndex(x => !x.done);
    finished = at === -1;
    if (finished) at = raw.length;
  }

  /* The enrolment, said plainly, wherever the journey is. */
  const enr = live.find(a => String(a.outcome || '') === 'enrolled');
  const enrRow = enr ? list.find(r => String(r.prog_id) === String(enr.prog_id)) || {} : null;
  const enrolment = enr ? {
    progId: String(enr.prog_id), university: enrRow.university || '', program: enrRow.program || '',
    text: 'You are enrolled at ' + (enrRow.university || 'your university')
      + (enrRow.program ? ' — ' + enrRow.program : ''),
  } : null;

  /* The next real step, from the phase. [title, body, link, button]. */
  const pk = finished ? 'departed' : (ph ? ph.key : raw[Math.min(at, raw.length - 1)].key);
  const N = {
    enrolled: ['Your welcome call', 'Your counsellor calls you to open your file and agree what happens next.',
      'messages.html', 'Message your counsellor'],
    profile: ['Your documents — ' + R.ok + ' of ' + R.of + ' verified',
      'Your counsellor checks each one. The shortlist is agreed once they are all in.',
      'documents.html', 'Open my documents'],
    shortlist: ['Agree your shortlist with your counsellor',
      list.length ? plural(list.length, 'programme') + ' on your list so far.' : 'Your counsellor builds it with you.',
      'universities.html', 'See my universities'],
    writing: ['Your statement of purpose and recommendation letters',
      'Written with you before the applications go in.', 'documents.html', 'Open my documents'],
    applying: ['Your applications — ' + submitted.length + ' of ' + plural(live.length, 'application') + ' submitted',
      'Your counsellor files them in deadline order and tells you as each one goes in.',
      'applications.html', 'See my applications'],
    offers: ['Waiting to hear from your universities',
      [offers.length ? plural(offers.length, 'offer') : '', rejected ? rejected + ' not successful' : '',
        waiting ? waiting + ' waiting to hear' : ''].filter(Boolean).join(' · ') || 'Decisions come in over the next weeks.',
      'applications.html', 'See my applications'],
    visa: V.decision === 'granted'
      ? ['Your visa is granted', V.travelDate ? 'Travelling ' + day(V.travelDate) + '. Your counsellor runs the pre-departure briefing.'
        : 'Tell your counsellor your travel date.', 'visa.html', 'Open my visa file']
      : V.decision === 'refused'
      ? ['Your visa application was refused', 'Your counsellor will go through the letter with you and the next step.', 'visa.html', 'Open my visa file']
      : V.decision === 'more'
      ? ['The consulate asked for more documents', 'Your counsellor will tell you exactly what to send.', 'visa.html', 'Open my visa file']
      : ['Your visa file — ' + VR.ok + ' of ' + VR.of + ' visa documents verified',
        'The visa application goes in once the file is complete.', 'visa.html', 'Open my visa file'],
    service: ['The last services on your file', 'Your counsellor is finishing what you asked for.', 'services.html', 'See my services'],
    departed: [enrolment ? enrolment.text : 'Everything on your file is finished',
      V.travelDate ? 'Travelling ' + day(V.travelDate) + '. Safe travels.' : 'Safe travels.',
      'applications.html', 'See my applications'],
  };
  const nx = N[pk] || N.enrolled;
  const next = { key: pk, title: nx[0], body: nx[1], href: nx[2], cta: nx[3] };
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
    /* N17-09: the counsellor's phase this was folded from, the enrolment,
       the next real step, and the visa as the student may see it. */
    phase: ph ? { key: ph.key, label: ph.label, index: ph.index, of: ph.of, finished: !!ph.finished } : null,
    enrolment,
    next,
    visa: { decision: V.decision, travelDate: V.travelDate ? day(V.travelDate) : '' },
  };
}

/*
 * THE VISA FILE'S READINESS (N17-05): the six visa documents every student is
 * asked for (`need:1` in VISA_DOCS, portal_fields.py). "Visa documents ready"
 * cannot be ticked until all six are accepted.
 */
const VISA_REQUIRED = [
  ['visa-offer', 'Offer / admission letter'], ['visa-funds', 'Blocked account or proof of funds'],
  ['visa-insurance', 'Travel and health insurance'], ['visa-form', 'Completed visa application form'],
  ['visa-cover', 'Visa cover letter'], ['visa-appointment', 'Appointment confirmation'],
];
/* Patch 177 (item 4): key → the SLOT's status, derived from every file in
   it (store.slotStatus) — a slot counts once however many files it holds. */
function slotMap(db, rows) {
  const by = {};
  (rows || []).forEach(d => { const k = String(d.doc_key); (by[k] || (by[k] = [])).push(d); });
  const derive = db && typeof db.slotStatus === 'function' ? db.slotStatus : require('./store.js').slotStatus;
  const slot = {};
  Object.keys(by).forEach(k => { slot[k] = derive(by[k]); });
  return slot;
}
function visaReadiness(db, studentId) {
  let rows = [];
  try { rows = db.getDocuments(Number(studentId)) || []; } catch (e) { rows = []; }
  const slot = slotMap(db, rows);
  const docs = VISA_REQUIRED.map(([key, name]) => {
    const status = slot[key] && WORD[slot[key]] ? slot[key] : (slot[key] ? 'wait' : 'none');
    return { key, name, status, word: WORD[status] };
  });
  const ok = docs.filter(d => d.status === 'ok').length;
  return { ok, of: VISA_REQUIRED.length, docs };
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
  const slot = slotMap(db, rows);
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

module.exports = { STAGES, of, day, readiness, REQUIRED, WORD, visaReadiness, VISA_REQUIRED };
