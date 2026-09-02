'use strict';
/**
 * A number that is not a number, and a number on the wrong scale.
 *
 * From the 1.5 testing round: a student profile accepted a CGPA of 47.9, an
 * IELTS overall of 99, a Listening band of -4, a Reading band of "abc", a
 * Class 10 score of 999% and a Class 12 score of -50. Every one was stored,
 * and the first of them is the dangerous one — the matcher compares d_cgpa
 * against each programme's bar, so 47.9 cleared all of them and the student
 * was told 174 of 174 programmes were open to them.
 *
 * A profile full of impossible numbers does not look broken. It looks like a
 * student who qualifies for everything, and the first person to find out
 * otherwise is the student, months later, from a university.
 *
 * TWO THINGS LIVE HERE, and they are the same problem seen from both ends.
 *
 *   `problems()` is the gate on the way in. It REFUSES rather than clamping:
 *   silently rewriting 99 to 9 stores a score the student never sat, and the
 *   German-grade work settled that principle — a number we invented for
 *   somebody is worse than no number.
 *
 *   `cgpaTen()` is the reading on the way out, and it fixes a second fault
 *   found on the way to the first. The matcher read d_cgpa raw and compared it
 *   against a bar written out of ten. A student marked out of 4 with a 3.6 —
 *   a first — was read as 3.6 out of 10 and failed every gate on the site,
 *   silently, while their profile said 100% complete. The maximum has been on
 *   the profile since the German-grade patch; nothing was reading it.
 *
 * The bounds are per test, because they have to be: 99 is impossible for
 * IELTS, ordinary for PTE and low for TOEFL. A single "0 to 100" would have
 * let the reported 99 through.
 */

/* What a number arrives as. "8.8 CGPA", "88%", " 7.0 " are all what students
   type; a value with no digit in it is not a number at all. */
function num(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  if (!s) return null;
  const m = /^-?\d*\.?\d+/.exec(s.replace(/[^\d.\-]/g, ''));
  if (!m) return NaN;                       // "abc" — said something, meant nothing
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : NaN;
}

/* Overall and per-skill ranges, by test. A band is not a percentage and a
   percentage is not a band, and the only thing that says which is the test. */
const TESTS = {
  IELTS:    { min: 0,  max: 9,   band: [0, 9],   step: 'a half band' },
  TOEFL:    { min: 0,  max: 120, band: [0, 30] },
  PTE:      { min: 10, max: 90,  band: [10, 90] },
  DUOLINGO: { min: 10, max: 160 },
  CAMBRIDGE:{ min: 80, max: 230 },
};

const APTITUDE = {
  GRE:  { min: 260, max: 340 },
  GMAT: { min: 205, max: 805 },
  SAT:  { min: 400, max: 1600 },
  ACT:  { min: 1,   max: 36 },
  GATE: { min: 0,   max: 100 },
  NEET: { min: -180, max: 720 },
};

const testKey = v => String(v || '').trim().toUpperCase().split(/\s|\//)[0];

/** The scale a student's own university marks on. 10 unless they said otherwise. */
function scaleOf(p) {
  const max = num((p || {}).d_max);
  return Number.isFinite(max) && max > 0 && max <= 100 ? max : 10;
}

/**
 * Their overall grade ON THE TEN-POINT SCALE every bar in this catalogue is
 * written on, or null when we have not been told enough to say.
 *
 * Not a clamp and not a guess: it is their number divided by their own stated
 * maximum. A student out of 4 and a student out of 10 are finally comparable,
 * and a student out of 100 stops reading as a genius.
 */
function cgpaTen(p) {
  const raw = num((p || {}).d_cgpa);
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  const max = scaleOf(p);
  if (raw > max) return null;               // impossible on their own scale
  return Math.round(raw / max * 10 * 100) / 100;
}

/* One rule. `only` limits it to profiles where it applies — a Listening band
   means nothing to somebody who submitted a Medium of Instruction letter. */
const RULE = (key, label, lo, hi, note) => ({ key, label, lo, hi, note });

function rulesFor(p) {
  const out = [];
  const max = scaleOf(p);

  out.push(RULE('d_max', 'Maximum grade at your university', 1, 100));
  out.push(RULE('d_cgpa', 'Your overall grade', 0, max,
    'Out of ' + max + ', which is the maximum on your profile. Change the '
    + 'maximum if your university marks differently.'));
  if (num(p.d_max) != null && Number.isFinite(num(p.d_max))) {
    out.push(RULE('d_pass', 'Minimum passing grade at your university', 0, max));
  }
  /* Percentage or CGPA in one box, so the ceiling is 100 and the floor is 0.
     That is enough to catch 999% and -50, which is what was reported. */
  out.push(RULE('x_score', 'Class 10 percentage / CGPA', 0, 100));
  out.push(RULE('xii_score', 'Class 12 percentage / CGPA', 0, 100));
  out.push(RULE('w_months', 'Months of experience', 0, 720));

  const eng = TESTS[testKey(p.e_test)];
  if (eng) {
    const t = String(p.e_test).trim();
    out.push(RULE('e_score', t + ' overall score', eng.min, eng.max));
    out.push(RULE('e_low', t + ' lowest band', (eng.band || [eng.min, eng.max])[0],
      (eng.band || [eng.min, eng.max])[1]));
    if (eng.band) {
      [['e_listen', 'Listening'], ['e_read', 'Reading'],
       ['e_write', 'Writing'], ['e_speak', 'Speaking']].forEach(([k, l]) =>
        out.push(RULE(k, t + ' ' + l, eng.band[0], eng.band[1])));
    }
  }
  const eng2 = TESTS[testKey(p.e2_test)];
  if (eng2) {
    out.push(RULE('e2_score', String(p.e2_test).trim() + ' overall score',
      eng2.min, eng2.max));
    out.push(RULE('e2_low', String(p.e2_test).trim() + ' lowest band',
      (eng2.band || [eng2.min, eng2.max])[0], (eng2.band || [eng2.min, eng2.max])[1]));
  }

  const apt = APTITUDE[testKey(p.a_test)];
  if (apt) out.push(RULE('a_score', String(p.a_test).trim() + ' score', apt.min, apt.max));
  const apt2 = APTITUDE[testKey(p.a2_test)];
  if (apt2) out.push(RULE('a2_score', String(p.a2_test).trim() + ' score', apt2.min, apt2.max));

  return out;
}

/**
 * Everything wrong with the numbers on a profile, as sentences a student can
 * act on. Empty means nothing was out of range — NOT that the profile is
 * complete, which is a different question with a different answer.
 */
function problems(profile) {
  const p = profile || {};
  const out = [];
  for (const r of rulesFor(p)) {
    const raw = p[r.key];
    if (raw == null || String(raw).trim() === '') continue;   // blank is allowed
    const n = num(raw);
    if (!Number.isFinite(n)) {
      out.push({ field: r.key, label: r.label, said: String(raw).slice(0, 40),
        why: r.label + ' has to be a number. "' + String(raw).slice(0, 20)
           + '" is not one.' });
      continue;
    }
    if (n < r.lo || n > r.hi) {
      out.push({ field: r.key, label: r.label, said: String(raw).slice(0, 40),
        why: r.label + ' has to be between ' + r.lo + ' and ' + r.hi + '. You '
           + 'entered ' + n + '.' + (r.note ? ' ' + r.note : '') });
    }
  }
  /* A pass mark at or above the maximum is not a range, and every grade
     conversion on the site divides by the gap between them. */
  const mx = num(p.d_max), ps = num(p.d_pass);
  if (Number.isFinite(mx) && Number.isFinite(ps) && ps >= mx) {
    out.push({ field: 'd_pass', label: 'Minimum passing grade', said: String(p.d_pass),
      why: 'The passing grade has to be below the maximum. You entered ' + ps
         + ' out of ' + mx + '.' });
  }
  return out;
}

module.exports = { problems, cgpaTen, scaleOf, num, TESTS, APTITUDE, rulesFor };
