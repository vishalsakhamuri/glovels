'use strict';
/*
 * WHAT A PROGRAMME ASKS FOR, beyond a grade.
 *
 * The finder could filter on a grade, a subject, an intake and a budget, and
 * the office asked for the rest of what a university actually decides on:
 *
 *   "What filters should we keep upfront: Preferred Course/Specialisation,
 *    German Grade, Target Intake, IELTS/TOEFL Score, Work Exp. Advanced
 *    filters, hidden: GRE, German Language Level, Bachelors Degree, Bachelors
 *    Duration — 3 years or 4 years or 5 years, Tuition Preference — No
 *    Tuition fee, up to 500 Euro/Sem, 1500, 4000, 6000, Paper Publication."
 *
 * ONE RECORD, ONE COLUMN, ONE LIST. The German grade was one column and it
 * touched twenty-five places on its way from the import sheet to the finder
 * — the export, the import with its header aliases, the admin form, its
 * validator, the row mapper, both catalogue shapes and the filter. Eleven more
 * columns done that way is two hundred edits and a bug in one of them that
 * nobody finds until a student is told the wrong thing. So these travel
 * together as `reqs`, a JSON column like `intakes` already is, and this file
 * is the only place that knows what is in it. Add a tenth field: add a line
 * to FIELDS, and the sheet, the import, the form and the API all carry it.
 *
 * BLANK MEANS "NOT STATED", NEVER ZERO. Exactly the rule `minimum cgpa`
 * already follows, and for the same reason: a downloaded 0 typed back in would
 * flip "we do not know" into "they accept nothing" — or, for a language level,
 * into "no German needed" when nobody has checked. So a field that is not
 * stated is null everywhere, and a filter NEVER excludes a programme for a
 * requirement it has not stated. It is shown as "not stated" instead, which
 * is the truth and is a reason to ask a counsellor.
 */

const CEFR = ['none', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/*
 * key       the property on the record and in the API
 * col       the column heading on the import sheet (lower case)
 * aliases   other headings the import accepts — what people type
 * type      number | int | text | level | yesno
 * lo, hi    bounds for numbers; refused outside, not clamped (see problems)
 * label     how it is named to a person, in a sentence and on the form
 * note      the one line of help beside the box
 */
const FIELDS = [
  { key: 'specialisation', col: 'specialisation', aliases: ['specialization', 'specialisation / track', 'track'],
    type: 'text', max: 80, label: 'Specialisation',
    note: 'Narrower than the field. "Embedded Systems", not "Electrical Engineering".' },
  { key: 'tuitionEurSem', col: 'tuition eur per sem', aliases: ['tuition eur/sem', 'tuition per semester eur', 'tuition eur', 'semester fee eur'],
    type: 'int', lo: 0, hi: 30000, label: 'Tuition per semester (EUR)',
    note: '0 means no tuition. Blank means not stated. The semester contribution is not tuition.' },
  { key: 'ieltsMin', col: 'ielts min', aliases: ['ielts', 'ielts minimum', 'min ielts'],
    type: 'number', lo: 4, hi: 9, step: 0.5, label: 'IELTS minimum',
    note: 'Overall band. Blank if not stated or not required.' },
  { key: 'toeflMin', col: 'toefl min', aliases: ['toefl', 'toefl minimum', 'min toefl', 'toefl ibt'],
    type: 'int', lo: 40, hi: 120, label: 'TOEFL iBT minimum',
    note: 'Blank if not stated or not required.' },
  /* Two columns for the GRE and two for work experience, because DAAD says
     "required" far more often than it says how much. "Required, amount not
     stated" is a real answer — a student with no GRE at all is turned down —
     and a single number column could only say it with a made-up number. */
  { key: 'greRequired', col: 'gre required', aliases: ['gre', 'gre needed', 'needs gre'],
    type: 'yesno', label: 'GRE required',
    note: 'yes or no. Blank if not stated. Most German programmes do not ask.' },
  { key: 'greMin', col: 'gre min', aliases: ['gre minimum', 'min gre', 'gre score', 'gre total'],
    type: 'int', lo: 260, hi: 340, label: 'GRE minimum',
    note: 'Total, if a figure is stated. Blank when only "required" is known.' },
  { key: 'germanLevel', col: 'german level', aliases: ['german language level', 'german language', 'german required', 'language level'],
    type: 'level', label: 'German level required',
    note: '"none" for an English-taught programme. Blank if not stated.' },
  { key: 'bachelorSubjects', col: 'bachelor subjects', aliases: ['bachelor subject', 'bachelors degree', "bachelor's degree", 'required bachelor', 'bachelor in', 'prior degree'],
    type: 'text', max: 200, label: "Bachelor's in",
    note: 'What the bachelor’s has to be in. "Electrical Engineering, Electronics or closely related".' },
  { key: 'bachelorYears', col: 'bachelor duration', aliases: ['bachelors duration', "bachelor's duration", 'bachelor years', 'years of bachelor'],
    type: 'int', lo: 3, hi: 5, label: "Bachelor's length (years)",
    note: '3, 4 or 5. The one that quietly turns down a three-year BSc.' },
  { key: 'workExpRequired', col: 'work exp required', aliases: ['work experience required', 'experience required', 'work exp', 'work experience', 'job experience'],
    type: 'yesno', label: 'Work experience required',
    note: 'yes or no. Blank if not stated.' },
  { key: 'workExpMonths', col: 'work exp months', aliases: ['work experience months', 'experience months', 'work experience amount', 'work exp amount', 'months of experience'],
    type: 'months', lo: 0, hi: 120, label: 'Work experience (months)',
    note: '"12 months", "2 years" or "20 weeks" all read. Blank when only "required" is known.' },
  { key: 'papersRequired', col: 'papers required', aliases: ['paper publication', 'publications', 'papers', 'publication required'],
    type: 'yesno', label: 'Paper publication required',
    note: 'yes or no. Blank if not stated.' },
];

const BY_KEY = new Map(FIELDS.map(f => [f.key, f]));

/* Every heading the import will read a field from, lower-cased, spaces
   collapsed. The column name itself first. */
function headingsFor(f) {
  return [f.col].concat(f.aliases || []).map(h => h.toLowerCase().replace(/\s+/g, ' ').trim());
}

const YES = /^(y|yes|true|1|required|mandatory)$/i;
const NO = /^(n|no|false|0|not required|none|optional)$/i;

/* One value, one field, normalised. Returns undefined for "refused" so the
   caller can say so; null for blank; otherwise the clean value. */
function one(f, raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  switch (f.type) {
    case 'text':
      return s.slice(0, f.max || 200);
    case 'level': {
      const t = s.toLowerCase();
      if (/^(none|no|not required|english|english[- ]taught|n\/a)$/.test(t)) return 'none';
      const m = /^([abc][12])/i.exec(t.replace(/\s+/g, ''));
      return m ? m[1].toUpperCase() : undefined;
    }
    case 'yesno':
      if (YES.test(s)) return true;
      if (NO.test(s)) return false;
      return undefined;
    case 'months': {
      /* "12 months", "2 years", "20 weeks", "1 yr" or a bare number of
         months. Weeks are rounded to the nearest month, never to zero. */
      const m = /^(\d+(?:\.\d+)?)\s*(months?|mos?|m|years?|yrs?|y|weeks?|wks?|w)?\.?$/i.exec(s.replace(/,/g, ''));
      if (!m) return undefined;
      const q = Number(m[1]); const u = (m[2] || 'months').toLowerCase();
      let n = /^y/.test(u) ? q * 12 : /^w/.test(u) ? Math.max(1, q / 4.345) : q;
      n = Math.round(n);
      if (n < f.lo || n > f.hi) return undefined;
      return n;
    }
    case 'int':
    case 'number': {
      const n = Number(s.replace(/[,€₹\s]/g, '').replace(/^eur/i, ''));
      if (!Number.isFinite(n)) return undefined;
      if (f.lo != null && n < f.lo) return undefined;
      if (f.hi != null && n > f.hi) return undefined;
      return f.type === 'int' ? Math.round(n) : n;
    }
    default:
      return null;
  }
}

/*
 * A whole record from whatever arrived — the admin form, the import, an
 * older row. Unknown keys are dropped; every known key is present, null when
 * blank. `refused` lists what could not be read, for the caller to report;
 * the value is stored as null rather than as a guess.
 */
function clean(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const refused = [];
  for (const f of FIELDS) {
    const v = one(f, src[f.key]);
    if (v === undefined) { refused.push({ field: f.key, label: f.label, said: String(src[f.key]).slice(0, 40) }); out[f.key] = null; }
    else out[f.key] = v;
  }
  return { reqs: out, refused };
}

/* Refusals as the sentences the office's own programme form already uses,
   so the sheet and the form say the same thing about the same mistake. */
function problems(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = [];
  for (const f of FIELDS) {
    const raw = src[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    if (one(f, raw) !== undefined) continue;
    let why;
    if (f.type === 'level') why = f.label + ' has to be none, A1, A2, B1, B2, C1 or C2. You entered "' + String(raw).slice(0, 20) + '".';
    else if (f.type === 'yesno') why = f.label + ' has to be yes or no. You entered "' + String(raw).slice(0, 20) + '".';
    else if (f.type === 'months') why = f.label + ' has to be a number of months, weeks or years, up to ' + f.hi + ' months. You entered "' + String(raw).slice(0, 20) + '".';
    else why = f.label + ' has to be between ' + f.lo + ' and ' + f.hi + '. You entered "' + String(raw).slice(0, 20) + '".';
    out.push({ field: f.key, label: f.label, why });
  }
  return out;
}

/* Read from a stored row: the JSON column, or nothing. Never throws on a
   row written before this file existed. */
function parse(text) {
  if (!text) return clean({}).reqs;
  try { return clean(JSON.parse(text)).reqs; } catch (e) { return clean({}).reqs; }
}

/* The sheet, both ways. `get(heading)` is the import's own lookup. */
function fromSheet(get) {
  const src = {};
  for (const f of FIELDS) {
    for (const h of headingsFor(f)) {
      const v = get(h);
      if (v !== undefined && v !== null && String(v).trim() !== '') { src[f.key] = v; break; }
    }
  }
  return src;
}
function toSheet(reqs) {
  const r = reqs || {};
  return FIELDS.map(f => {
    const v = r[f.key];
    if (v === null || v === undefined) return '';
    if (f.type === 'yesno') return v ? 'yes' : 'no';
    return v;
  });
}
const SHEET_HEADERS = FIELDS.map(f => f.col);

/*
 * DOES THIS STUDENT CLEAR THIS PROGRAMME, and on what.
 *
 * `student` carries what they told us, in the same keys: ielts, toefl
 * (englishNone: true when they said they have not sat one), gre (a score, or
 * false for "not taken"), germanLevel, bachelorSubjects (free text),
 * bachelorYears, workExpMonths, papers (boolean). Missing on either side is not a failure: a requirement
 * the programme has not stated cannot be failed, and a question the student
 * has not answered cannot be checked. The reply says which is which, so the
 * screen can say "chances unknown" rather than "you qualify" when it does
 * not know.
 *
 *   fails    [{key, label, want, have}]  — stated, answered, and not met
 *   unknown  [key]                       — stated by the programme, not answered
 */
function check(reqs, student) {
  const r = reqs || {}; const s = student || {};
  const fails = []; const unknown = [];
  const has = v => v !== undefined && v !== null && v !== '';
  const num = v => (has(v) && Number.isFinite(Number(v)) ? Number(v) : null);

  /* English: either test satisfies. Only fail when we have a score for a
     test the programme names and it is short; unknown when it names a test
     and we have neither score. */
  const wantI = num(r.ieltsMin), wantT = num(r.toeflMin);
  if (wantI != null || wantT != null) {
    const haveI = num(s.ielts), haveT = num(s.toefl);
    const okI = wantI != null && haveI != null && haveI >= wantI;
    const okT = wantT != null && haveT != null && haveT >= wantT;
    if (okI || okT) { /* clears */ }
    else if (s.englishNone === true) fails.push({ key: 'english', label: 'English test',
      want: [wantI != null ? 'IELTS ' + wantI : null, wantT != null ? 'TOEFL ' + wantT : null].filter(Boolean).join(' or '),
      have: 'not taken yet' });
    else if (haveI == null && haveT == null) unknown.push('english');
    else fails.push({ key: 'english', label: 'English test',
      want: [wantI != null ? 'IELTS ' + wantI : null, wantT != null ? 'TOEFL ' + wantT : null].filter(Boolean).join(' or '),
      have: [haveI != null ? 'IELTS ' + haveI : null, haveT != null ? 'TOEFL ' + haveT : null].filter(Boolean).join(', ') });
  }
  /* GRE: the student answers with a score, or with "not taken" (false or 0).
     Required with no figure: any score clears, "not taken" fails. */
  if (r.greRequired === true || num(r.greMin) != null) {
    const notTaken = s.gre === false || s.gre === 0 || s.gre === '0' || /^(no|none|not taken)$/i.test(String(s.gre || ''));
    const have = notTaken ? null : num(s.gre);
    if (!notTaken && have == null) unknown.push('gre');
    else if (notTaken) fails.push({ key: 'gre', label: 'GRE', want: num(r.greMin) != null ? String(r.greMin) : 'a GRE score', have: 'not taken' });
    else if (num(r.greMin) != null && have < num(r.greMin)) fails.push({ key: 'gre', label: 'GRE', want: String(r.greMin), have: String(have) });
  }
  if (has(r.germanLevel) && r.germanLevel !== 'none') {
    const want = CEFR.indexOf(r.germanLevel);
    const haveL = has(s.germanLevel) ? CEFR.indexOf(String(s.germanLevel)) : -1;
    if (haveL < 0) unknown.push('germanLevel');
    else if (haveL < want) fails.push({ key: 'germanLevel', label: 'German', want: r.germanLevel, have: CEFR[haveL] });
  }
  if (num(r.bachelorYears) != null) {
    const have = num(s.bachelorYears);
    if (have == null) unknown.push('bachelorYears');
    else if (have < num(r.bachelorYears)) fails.push({ key: 'bachelorYears', label: "Bachelor's length",
      want: r.bachelorYears + ' years', have: have + ' years' });
  }
  /* Work experience: required with no figure means "some"; a student with
     none is turned down, any amount clears. A figure is a floor. */
  const wantMonths = num(r.workExpMonths);
  if ((wantMonths != null && wantMonths > 0) || (r.workExpRequired === true && !(wantMonths === 0))) {
    const have = num(s.workExpMonths);
    const floor = wantMonths != null && wantMonths > 0 ? wantMonths : 1;
    if (have == null) unknown.push('workExpMonths');
    else if (have < floor) fails.push({ key: 'workExpMonths', label: 'Work experience',
      want: wantMonths != null && wantMonths > 0 ? wantMonths + ' months' : 'some work experience', have: have > 0 ? have + ' months' : 'none' });
  }
  if (r.papersRequired === true) {
    if (s.papers === undefined || s.papers === null || s.papers === '') unknown.push('papers');
    else if (!s.papers) fails.push({ key: 'papers', label: 'Publication', want: 'a published paper', have: 'none' });
  }
  /* The bachelor's subject is words on both sides, so it is never a hard
     fail: a mismatch is flagged for the counsellor, not scored. */
  return { fails, unknown, ok: fails.length === 0 && unknown.length === 0 };
}

module.exports = { FIELDS, BY_KEY, CEFR, clean, problems, parse, fromSheet, toSheet, SHEET_HEADERS, headingsFor, check };
