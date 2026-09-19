'use strict';
/**
 * The thing that notices, without anybody looking.
 *
 * "We need to automatically send them email or via chat that you missed the
 * SLA." The Tasks board answers that question when somebody opens it; this
 * answers it when nobody does.
 *
 * Every ten minutes it:
 *
 *   1. brings the task lists into step with what has been bought and
 *      shortlisted, so a university added on Tuesday has its submission task
 *      by Tuesday afternoon rather than the next time an administrator
 *      happens to open the file;
 *
 *   2. once a day, gathers everything past its date and tells the two people
 *      who can do something about it — the counsellor who owes it and the
 *      office. Both, because that is what was asked for.
 *
 * Two rules it does not break:
 *
 *   ONCE PER TASK.  A task carries breached_at. The notice goes out when that
 *   is empty and the date has gone, and the column is stamped in the same
 *   pass, so a task that stays late for six weeks is not six weeks of daily
 *   mail about the same line.
 *
 *   MARKED BEFORE SENT.  The day marker goes into the content table before
 *   any mail leaves, the way the digest does it. A mailer that throws on the
 *   third of eight recipients must not start again from the first in ten
 *   minutes.
 *
 * Built on the same shape as digest.js, deliberately: one more timer that
 * behaves differently at 3am is one more thing to reason about at 3am.
 */

const TASKS = require('./tasks.js');
const DAYS = require('./days.js');

const KEY = 'slaSweptOn';
const CHECK_EVERY = 10 * 60 * 1000;      // ten minutes

/* Calendar days in India, shared with alerts.js and tasks.js — see
   server/days.js. These were three separate calculations once, and the
   digest and this sweep reported the same task as one day late and zero
   days late within an hour of each other. */
const istHour = DAYS.istHour;
const istDay = DAYS.istDay;

/**
 * Who has to hear about what.
 *
 * Returns [{to, role, forName, tasks:[{id, student, title, due, over}]}] — one
 * entry per person, not per task. A counsellor with nine late items gets one
 * email listing nine, and the office gets one per counsellor, so the subject
 * line can name who is behind.
 *
 * Exported and pure so a test can ask what would be sent without a mailer.
 */
function plan(db, now) {
  const T = now ? new Date(now).getTime() : Date.now();
  const students = new Map((db.allStudents() || []).map(s => [Number(s.id), s]));

  const late = [];
  (db.allTasks() || []).forEach(row => {
    if (TASKS.CLOSED.has(String(row.status))) return;
    if (row.breached_at) return;                      // already said once
    if (!row.due_at) return;
    const over = DAYS.daysPast(String(row.due_at).slice(0, 10), T);
    /* Due TODAY is not late, and nobody is chased for it. */
    if (over == null || over <= 0) return;
    const st = students.get(Number(row.student_id));
    if (!st) return;
    late.push({
      id: row.id, over,
      owner: TASKS.ownerOf(db, row),
      student: st.name,
      title: String(row.title || ''),
      due: String(row.due_at).slice(0, 10),
    });
  });
  /* The same shape on a quiet day as on a busy one. Returning `{jobs, ids}`
     here and `{jobs, ids, unreachable}` below meant the commonest case of
     all — nothing is late — was the one that broke a caller reading
     `.unreachable.length`. */
  if (!late.length) return { jobs: [], ids: [], unreachable: [] };

  const byOwner = new Map();
  late.forEach(t => {
    const k = t.owner == null ? 'none' : String(t.owner);
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k).push(t);
  });

  const admins = (db.staffByRole('admin') || []).filter(a => a.email);
  const jobs = [];

  byOwner.forEach((items, k) => {
    const person = k === 'none' ? null : db.studentById(Number(k));
    /* An owner id that no longer resolves is a deleted account, not an
       unassigned file — telling the office the file is unassigned when it is
       assigned to somebody who has left sends them looking for the wrong
       problem. */
    const forName = person ? person.name
      : (k === 'none' ? 'Nobody (unassigned files)' : 'A deleted account');
    /* The counsellor. Not sent when the work has no owner — there is nobody to
       send it to, which is itself what the office needs to see. */
    if (person && person.email) {
      jobs.push({ to: person.email, staffId: Number(k), role: 'counsellor', forName, items });
    }
    admins.forEach(a => {
      /* An administrator who owes the work themselves has already had the
         counsellor copy; a second one saying the same thing in the third
         person is the kind of noise that gets a rule switched off. */
      if (person && Number(a.id) === Number(k)) return;
      jobs.push({ to: a.email, staffId: Number(a.id), role: 'admin', forName, items });
    });
  });

  /*
   * ONLY the tasks somebody was actually told about.
   *
   * This used to return every late id, and the caller stamped all of them as
   * notified. So a task with no owner, in an office with no administrator —
   * or one whose only recipient had no email address — was marked "told" on a
   * sweep that told nobody, and was then never chased again. Ever. The one
   * category of work most likely to be forgotten was the one the system
   * guaranteed to forget.
   *
   * A task that reached no inbox stays unstamped and comes back tomorrow.
   */
  const told = new Set();
  jobs.forEach(j => j.items.forEach(i => told.add(i.id)));
  return { jobs, ids: [...told], unreachable: late.filter(t => !told.has(t.id)).map(t => t.id) };
}

/**
 * Start the timer.
 *
 * Returns a stop function, which the tests use and nothing else does.
 */
function start({ db, mail, notify, live, push, emails, siteUrl, hour }) {
  const at = hour == null ? 10 : Number(hour);       // 10am, India — an hour after the digest

  async function tick() {
    const t = Date.now();

    /* Step one runs every ten minutes. It writes nothing unless something
       changed, and it is what makes a task appear the same day the order or
       the shortlist did. */
    try { TASKS.syncAll(db, t); } catch (e) { /* a broken file is not the sweep */ }

    /* Step two is once a day. */
    if (istHour(t) !== at) return;
    const today = istDay(t);
    let sent = null;
    try { sent = db.content(KEY); } catch (e) { /* first run */ }
    if (sent && sent.on === today) return;
    db.setContent(KEY, { on: today }, 'system');

    const { jobs, ids, unreachable } = plan(db, t);
    if (unreachable && unreachable.length) {
      /* Left unstamped on purpose, so tomorrow's sweep tries again once
         somebody has an inbox to send to. */
      try {
        db.log('system', 'sla notices had nowhere to go',
          unreachable.length + ' late task(s) have no reachable owner or office');
      } catch (e) {}
    }
    if (!jobs.length) return;

    /* Stamped before sending, same reasoning as the day marker. */
    ids.forEach(id => { try { db.updateTask(id, { breachedAt: new Date(t).toISOString() }); } catch (e) {} });

    for (const j of jobs) {
      const msg = emails.taskOverdue({
        toName: j.role === 'admin'
          ? ((db.studentById(j.staffId) || {}).name || '') : j.forName,
        forName: j.forName, items: j.items, siteUrl: siteUrl || '',
        admin: j.role === 'admin',
      });
      /* The workspace first for anybody who has it open — "or via chat" — and
         then the email, which is the record either way. Unlike a message from
         a student, this one is sent whether or not they are online: a missed
         date is not a conversation that can wait for the next login. */
      try {
        if (live) {
          live.toStaff(j.staffId, 'sla', {
            n: j.items.length, forName: j.forName,
            worst: j.items.slice().sort((a, b) => b.over - a.over)[0] || null,
          });
        }
      } catch (e) {}
      try {
        if (push) {
          push.toStaff(j.staffId, {
            title: msg.subject,
            body: j.items.length + ' item(s) — open the Tasks board',
            url: (siteUrl || '') + (j.role === 'admin' ? '/admin#tasks' : '/counsellor'),
            tag: 'sla-' + j.staffId,
          }).catch(() => {});
        }
      } catch (e) {}
      try {
        const person = db.studentById(j.staffId);
        await notify.notify({
          to: j.to, phone: person && person.phone, email: msg,
          whatsapp: { text: 'Glovels: ' + msg.subject },
        });
      } catch (e) {
        /* One bad address must not stop the other seven. */
        console.error('  sla notice to ' + j.to + ' failed:', e && e.message);
      }
    }
    try { db.log('system', 'sla notices sent', jobs.length + ' person(s), ' + ids.length + ' task(s)'); }
    catch (e) {}
  }

  const timer = setInterval(() => { tick().catch(() => {}); }, CHECK_EVERY);
  if (timer.unref) timer.unref();
  tick().catch(() => {});
  return () => clearInterval(timer);
}

module.exports = { start, plan, KEY, istHour, istDay };
