'use strict';
/*
 * WHERE AN APPLICATION HAS GOT TO, AND WHAT CAME BACK — written once.
 *
 * These two lists were in four files. `portal_counsellor.py` carried a comment
 * saying "kept here as the same list rather than a second one, because two
 * lists that must agree eventually will not", above the second copy of it; the
 * student's tracker had a third, the agency portal a fourth, and `api.js` a
 * fifth inline in the sentence it sends the student. Renaming one stage meant
 * finding five places, and the counsellor's screen and the student's screen
 * would have disagreed about the same application until somebody noticed.
 *
 * So: here, and mirrored into the page scripts by APPS_JS in portal_fields.py
 * the way grades.js is mirrored — one source, one shape, and a test that reads
 * the delivered page and compares it with what this file says.
 *
 * A STAGE is where WE have got to. Every one of them is something Glovels
 * does, which is why a student cannot set them.
 *
 * An OUTCOME is what the UNIVERSITY said, and then what the student did about
 * it. Both belong on the same list because a counsellor updating a row is
 * answering one question — "where is this now?" — and asking it twice, in two
 * controls with two vocabularies, is how a record ends up half true.
 */

/* Index-addressed: the stage is stored as a number, so the ORDER here is the
   data. Adding one in the middle would renumber every stored application —
   append, or migrate deliberately. */
const STAGES = [
  { k: 'docs', n: 'Documents collected',
    d: 'Everything the university asks for, verified and in order.' },
  { k: 'draft', n: 'Application drafted',
    d: 'Forms filled, SOP and LORs attached, checked line by line.' },
  { k: 'sent', n: 'Submitted',
    d: 'Filed with the university, reference number on record.' },
  /* Was "Under review", which a student reasonably read as US reviewing it.
     It is the university's admissions committee, and the counsellors asked for
     the difference to be on the screen. */
  { k: 'review', n: 'Under review by university',
    d: 'With the admissions committee. We follow up on a schedule.' },
  { k: 'decided', n: 'Decision',
    d: 'Offer, rejection or a request for more information.' },
];

/*
 * The answer, and what happened next. Two were not enough:
 *
 *   "add four other options in addition to offer, rejected — admission
 *    currently impossible (waitlist), relinquished (admission received, but
 *    student did not accept), deferred, enrolled."
 *
 * Every one of those is a real thing a German university says or a real thing
 * a student does, and with only Offer and Rejected on the list all four were
 * being recorded as one of the two that were wrong. A waitlist recorded as
 * "Rejected" is a place the office stops chasing.
 *
 * `tone` is how the row reads: ok is settled and good, bad is settled and not,
 * wait is still open. `open` marks the ones where the university has not
 * finished — the office keeps chasing those, and the student is told so.
 * `said` is the sentence the student receives, which is why it is here rather
 * than written again beside the message.
 */
const OUTCOMES = [
  { k: '', n: 'No decision yet', tone: '', open: true,
    said: u => u + ': waiting to hear' },
  { k: 'offer', n: 'Offer', tone: 'ok', open: false,
    said: u => 'an offer from ' + u },
  /* The German "Zulassung derzeit nicht möglich" — not a no. The place can
     still come, and an office that files this under Rejected stops waiting for
     it. */
  { k: 'waitlist', n: 'Waitlisted', tone: 'wait', open: true,
    d: 'Admission is not possible at the moment. The place may still come.',
    said: u => u + ' has put you on the waiting list' },
  { k: 'deferred', n: 'Deferred', tone: 'wait', open: true,
    d: 'Held over to a later intake.',
    said: u => u + ' has held your application over to a later intake' },
  { k: 'rejected', n: 'Rejected', tone: 'bad', open: false,
    said: u => u + ' has said no' },
  /* An offer that was received and not taken. It is not a rejection and it is
     not an open application, and counting it as either misstates the year. */
  { k: 'relinquished', n: 'Relinquished', tone: '', open: false,
    d: 'An offer came and was not accepted.',
    said: u => 'the offer from ' + u + ' was not taken up' },
  { k: 'enrolled', n: 'Enrolled', tone: 'ok', open: false,
    d: 'Accepted, and enrolled.',
    said: u => 'you are enrolled at ' + u },
];

const OUT_KEYS = OUTCOMES.map(o => o.k);
const outcomeOf = k => OUTCOMES.find(o => o.k === String(k || '')) || OUTCOMES[0];

/** The stored value for whatever arrived, or '' — never the caller's string. */
const cleanOutcome = v => (OUT_KEYS.includes(String(v || '')) ? String(v || '') : '');

/** The stored stage for whatever arrived, clamped to the list that exists. */
const cleanStage = v =>
  Math.max(0, Math.min(STAGES.length - 1, Math.round(Number(v) || 0)));

/** An offer arrived at some point — true for enrolled and relinquished too. */
const hadOffer = k => ['offer', 'enrolled', 'relinquished'].includes(String(k || ''));

module.exports = {
  STAGES, OUTCOMES, OUT_KEYS, outcomeOf, cleanOutcome, cleanStage, hadOffer,
};
