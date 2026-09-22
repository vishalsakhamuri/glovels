'use strict';
/*
 * EVERY DOCUMENT SLOT THERE IS, as the server knows them.
 *
 * The screens' version of this list lives in `portal_fields.py` — DOCS and
 * VISA_DOCS — with the names, the notes and what each one blocks. That is the
 * right place for it: it is what a student reads. What the server needs is only
 * the KEYS, and it needs them because an upload route that accepts any string
 * lets a typo in a URL create a document nothing will ever draw.
 *
 * So this is the third list that has to agree with the others, and the two
 * before it — the stages and the outcomes — agreed until they did not. This one
 * is checked at BUILD time instead of being trusted: `check_pages.py` reads the
 * keys out of portal_fields.py and out of this file and fails the build if they
 * differ. A list that cannot drift without somebody being told is a different
 * thing from a list somebody promised to keep in step.
 *
 * OURS and THEIRS is the distinction that matters at the upload route.
 *
 *   OURS   the SOP, the recommendation letters, the visa cover letter. Glovels
 *          writes them. A second draft REPLACES the first, and it lands
 *          verified because we produced it.
 *   THEIRS everything else — a marksheet, a passport, a blocked-account
 *          confirmation. A counsellor can put one up on the student's behalf,
 *          because students send them by email and WhatsApp, but it joins the
 *          set rather than replacing it and it is NOT verified by arriving:
 *          uploading a file and checking a file are two different acts, and one
 *          person doing both in one motion is how a document goes unread.
 */

/* What Glovels produces. Keys only — the sentence each one is announced with
   lives beside SLOT_SAID in api.js, where the message is sent. */
const OURS = ['sop', 'lor', 'visa-cover'];

/* What the student provides. */
const THEIRS = [
  'passport', 'x', 'xii', 'degree', 'consol', 'degcert', 'provis',
  'english', 'cv', 'work', 'certs', 'finance', 'photo', 'aps',
  /* The catch-all, and the only slot on this list that is not a document we
     asked for by name. Either side may add to it and it holds as many files as
     it needs — see the note beside it in portal_fields.py for why it is
     `need:0` and why it is last. */
  'other',
  /* The enrolment pair, new with this patch. "Enrolment docs are missing in
     this succession. Tuition fee or semester fee invoice. Document option for
     enrolment certificate." They are the last two documents in the whole
     journey and there was nowhere to put either. */
  'fee-invoice', 'enrolment',
];

/* The visa file. Its own screen, the same store. */
const VISA = [
  'visa-offer', 'visa-funds', 'visa-insurance', 'visa-form', 'visa-cover',
  'visa-appointment', 'visa-police', 'visa-decision', 'visa-travel',
];

/* Files that belong to ONE application rather than to the student as a whole —
   the screenshot of a submission, the decision letter that came back. The key
   carries the programme id, so these are matched by shape rather than listed.
   `app:<progId>:proof` and `app:<progId>:decision`. */
const APP_FILE = /^app:[A-Za-z0-9_.-]{1,60}:(proof|decision)$/;

const ALL = [...new Set([...OURS, ...THEIRS, ...VISA])];

/** Is this a slot a screen will actually draw? */
const known = key => ALL.includes(String(key)) || APP_FILE.test(String(key));

/** Did WE write it — replace-and-verify — or did the student provide it? */
const ours = key => OURS.includes(String(key));

/*
 * What to CALL a slot, in a sentence.
 *
 * Deliberately below APP_FILE, where the build-time check against
 * portal_fields.py stops reading — that check matches quoted lowercase strings
 * and would read a name here as a slot nobody draws.
 *
 * Short, because these end up mid-sentence in a message and an email: "your
 * Class 10 marksheet needs another look". A key with no entry is turned into
 * words rather than shown raw, so a new slot reads badly before it reads
 * wrongly.
 */
const NAMES = {
  passport: 'passport', x: 'Class 10 marksheet', xii: 'Class 12 marksheet',
  degree: 'semester-wise marksheets', consol: 'consolidated grade card',
  degcert: 'degree certificate', provis: 'provisional certificate',
  english: 'English test scorecard', cv: 'academic CV',
  sop: 'Statement of Purpose', lor: 'letters of recommendation',
  work: 'work experience letters', certs: 'certificates and achievements',
  finance: 'financial documents', photo: 'passport photograph',
  aps: 'APS certificate', other: 'other documents',
  'fee-invoice': 'tuition or semester fee invoice', enrolment: 'enrolment certificate',
  'visa-offer': 'offer letter', 'visa-funds': 'proof of funds',
  'visa-insurance': 'travel and health insurance',
  'visa-form': 'visa application form', 'visa-cover': 'visa cover letter',
  'visa-appointment': 'appointment confirmation',
  'visa-police': 'police clearance certificate',
  'visa-decision': 'visa decision letter', 'visa-travel': 'ticket and accommodation',
};

/** The words for a slot. Never the raw key, and never empty. */
function nameOf(key) {
  const k = String(key || '');
  if (NAMES[k]) return NAMES[k];
  const m = /^app:.+:(proof|decision)$/.exec(k);
  if (m) return m[1] === 'proof' ? 'application submission proof' : 'application decision letter';
  return k.replace(/^visa-/, '').replace(/[-_]+/g, ' ').trim() || 'document';
}

module.exports = { OURS, THEIRS, VISA, ALL, APP_FILE, known, ours, NAMES, nameOf };
