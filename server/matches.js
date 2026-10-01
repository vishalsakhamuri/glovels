'use strict';
const GRADES = require('./grades.js');
const REQS = require('./reqs.js');
/**
 * Picking universities for somebody, without a person in the room.
 *
 * "4999 for 3 unis and 999 for shortlist for 10 private unis and 99 for 3 unis
 *  in private… we will have these 3 options as well so that we dont miss out
 *  anyone."
 *
 * The arithmetic on a ₹99 sale is what decides how this is built. Ninety-nine
 * rupees inclusive is ₹84 after GST and about ₹82 after the gateway. If a
 * counsellor spends ten minutes on one, the sale is a loss — so no counsellor
 * can be in the loop at all. The shortlist has to be picked, written and
 * delivered by the machine, in the minute after the payment, or the tier
 * should not exist.
 *
 * That is the whole reason for this file. It takes the profile the student
 * filled in, the catalogue the office maintains, and returns the N universities
 * that actually fit — deduplicated by university, because "three universities"
 * that turn out to be three courses at one university is not what was sold.
 *
 * Two rules that look like details and are not:
 *
 *   ONE PROGRAMME PER UNIVERSITY. The catalogue holds many courses per campus.
 *   Sorting by fit alone returns the same university three times.
 *
 *   A HARD FILTER IS A PROMISE, A SOFT ONE IS A PREFERENCE. Country, level and
 *   budget are what somebody told us about their life, and returning a ₹40 lakh
 *   programme to a student who said "under ₹10 lakhs" is not a near miss, it is
 *   an insult. Field of study is a preference: it is free text, people write
 *   "AI" and mean "Computer Science", and a hard filter on it returns nothing.
 *
 * And one rule about what happens when nothing matches: the answer is fewer
 * rows, never worse ones. A student who paid ₹99 and got two honest matches has
 * had a better deal than one who got three where the third was filler.
 */

/* The budget answers on the profile screen, as rupee ceilings. `null` is "no
   ceiling" — somebody who said "Above ₹40 Lakhs" has not ruled anything out. */
const BUDGET_CEILING = [
  [/under\s*₹?\s*10/i, 1000000],
  [/10\s*[–-]\s*20/, 2000000],
  [/20\s*[–-]\s*40/, 4000000],
  [/above\s*₹?\s*40/i, null],
];

/* The destination answers, as the two-letter codes the catalogue uses. */
const COUNTRY_CODE = {
  germany: 'DE', canada: 'CA', 'united kingdom': 'GB', uk: 'GB', ireland: 'IE',
  poland: 'PL', spain: 'ES', italy: 'IT', france: 'FR', netherlands: 'NL',
  australia: 'AU', 'united states': 'US', usa: 'US',
};

/* The level answers, as the catalogue's level values. */
const LEVEL = [
  [/master/i, 'master'], [/bachelor/i, 'bachelor'], [/mba/i, 'mba'],
  [/foundation|pathway/i, 'pathway'], [/phd|doctor/i, 'phd'],
  [/diploma/i, 'diploma'],
];

const match1 = (table, value) => {
  const v = String(value || '');
  for (const [re, out] of table) if (re.test(v)) return out;
  return null;
};

/**
 * The destinations, as codes. More than one now: a student deciding between
 * Germany and Poland was being made to pick one before we would show them
 * anything, so the answer is stored comma-joined and read as a list.
 *
 * Reading it with the old single-value lookup would have quietly returned null
 * for "Germany, Poland" — an unrecognised country name — and null means NO
 * COUNTRY CONSTRAINT. A student who named two destinations would have been
 * sent universities from all seven. That is the bug patch 61 already fixed
 * once, arriving by a different door.
 *
 * Returns null when they named none, or said they are open to advice.
 */
function destinations(value) {
  const parts = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.some(s => /open to advice/i.test(s))) return null;
  const codes = parts.map(s => COUNTRY_CODE[s.toLowerCase()]).filter(Boolean);
  return codes.length ? codes : null;
}

/**
 * The budget, as one ceiling. Several bands can be ticked, and the honest
 * reading of "under ₹10L and ₹20–40L" is that ₹40L is affordable — so the
 * HIGHEST wins, and any band with no ceiling of its own removes the ceiling
 * altogether. Taking the first match instead would have held a student who
 * ticked the top band to the bottom one.
 */
function ceilingOf(value) {
  const parts = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  let top = 0;
  for (const s of parts) {
    const c = match1(BUDGET_CEILING, s);
    if (c === null) return null;              /* "above ₹40L" — no ceiling */
    if (c != null && c > top) top = c;
  }
  return top || undefined;
}

/** What the profile actually constrains. Anything blank constrains nothing. */
function wants(profile) {
  const p = profile || {};
  const fieldText = [p.g_field, p.g_field2, p.g_field3, p.g_field4, p.g_field5]
    .map(x => String(x || '').trim()).filter(Boolean).join(' ');
  return {
    /* The catalogue fields those words mean, and their neighbours. */
    fields: fieldsWanted(fieldText),
    countries: destinations(p.g_country),
    level: match1(LEVEL, p.g_level),
    /* `undefined` means they did not say; `null` means they said "no ceiling". */
    ceiling: ceilingOf(p.b_total),
    /* All five boxes, joined.
     *
     * The profile asks for up to five fields of study now — a student open to
     * Data Science, AI and Computer Science was being made to pick one for us
     * to search on. score() splits this into words and counts any that a
     * programme shares, so joining them means a match on ANY of the five
     * counts, which is exactly what offering five boxes promised. */
    field: [p.g_field, p.g_field2, p.g_field3, p.g_field4, p.g_field5]
      .map(x => String(x || '').trim()).filter(Boolean).join(' '),
    intake: String(p.g_intake || '').trim(),
    term: termOf(p.g_intake),
    /* Whether they hold (or are finishing) a bachelor's. A 12th-pass student
       who ticks "Master's" is not sold master's degrees (patch 145). */
    hasBachelor: !!(String(p.d_course || '').trim() || String(p.d_cgpa || '').trim()),
    /* ON THE TEN-POINT SCALE the bars are written on, not as typed.
     *
     * This read d_cgpa raw. Two faults came out of that: a profile carrying an
     * impossible 47.9 cleared every bar on the site, and a student marked out
     * of 4 with a 3.6 — a first — was read as 3.6 out of 10 and quietly failed
     * every gate while their profile said it was complete. The maximum has
     * been on the profile since the German-grade patch and nothing read it. */
    cgpa: GRADES.cgpaTen(p) || 0,
    /* Their German grade, when their university's pass mark lets us work it
       out — a row that states a German grade is judged on that, as in the
       finder, not on the country's CGPA bar. */
    german: germanOf(p),
    /* What they have said about English, German, their bachelor's and work —
       read the way the finder reads it. */
    answers: answersOf(p),
  };
}

/*
 * WHAT THE STUDENT HAS TOLD US, in the shape server/reqs.js check() reads —
 * the same reading the finder's myAnswers() makes of the profile, so the paid
 * shortlist and the free finder cannot disagree about whether somebody clears
 * a programme's IELTS, German, bachelor-length or work-experience bar.
 *
 * Patch 143. The paid shortlist checked the CGPA and nothing else, so a
 * student with German B2 and no English test was sold fifteen programmes that
 * all ask for IELTS, while the finder on the home page hid every one of them.
 */
function answersOf(profile) {
  const P = profile || {};
  const a = {};
  [['e_test', 'e_score'], ['e2_test', 'e2_score']].forEach(([tk, sk]) => {
    const t = String(P[tk] || '').toLowerCase(), sc = parseFloat(P[sk]);
    if (/ielts/.test(t) && Number.isFinite(sc) && a.ielts == null) a.ielts = sc;
    if (/toefl/.test(t) && Number.isFinite(sc) && a.toefl == null) a.toefl = sc;
    if (/not taken/.test(t) && tk === 'e_test' && !Number.isFinite(sc)) a.englishNone = true;
    if (/medium of instruction|^moi\b/.test(t)) a.moi = true;
  });
  if (a.moi) a.englishNone = false;
  if (a.ielts != null || a.toefl != null) a.englishNone = false;
  [['a_test', 'a_score'], ['a2_test', 'a2_score']].forEach(([tk, sk]) => {
    const t = String(P[tk] || ''), sc = parseFloat(P[sk]);
    if (/^gre$/i.test(t) && Number.isFinite(sc) && a.gre == null) a.gre = sc;
  });
  /* Patch 149: "not taken" is an answer — a programme that requires the GRE
     is a miss, not a question. "Planning to take" stays a question. */
  if (a.gre == null && /^(not taken|not taken yet|not required|none|no)$/i.test(String(P.a_test || '').trim())) a.gre = false;
  if (P.g_german) {
    const t = String(P.g_german).trim();
    if (/^none/i.test(t)) a.germanLevel = 'none';
    else { const m = /\b(A1|A2|B1|B2|C1|C2)\b/i.exec(t); if (m) a.germanLevel = m[1].toUpperCase(); }
  }
  { const m = /^(\d)/.exec(String(P.d_dur || '')); if (m) a.bachelorYears = Number(m[1]); }
  if (/^no$/i.test(String(P.w_has || ''))) a.workExpMonths = 0;
  else {
    const m = parseFloat(P.w_months);
    if (Number.isFinite(m)) a.workExpMonths = m;
    else if (/^yes/i.test(String(P.w_has || ''))) a.workExpMonths = 1;
  }
  if (P.g_papers) a.papers = /^yes/i.test(String(P.g_papers));
  const bs = String(P.d_course || '').trim();
  if (bs) a.bachelorSubjects = bs;
  return a;
}

/* Their grade on the German scale (1.0 best, 4.0 pass), by the modified
   Bavarian formula the finder uses — or null when their pass mark is not on
   the profile, which is a reason not to judge, never a reason to guess. */
function germanOf(profile) {
  const P = profile || {};
  const o = parseFloat(P.d_cgpa), m = parseFloat(P.d_max), p = parseFloat(P.d_pass);
  if (![o, m, p].every(Number.isFinite) || m <= p || o < p || o > m) return null;
  const g = Math.max(1, Math.min(4, 1 + 3 * (m - o) / (m - p)));
  return Math.floor(g * 10) / 10;
}

/*
 * WHICH OF THE CATALOGUE'S FIELDS A STUDENT MEANS.
 *
 * The profile asks for fields of study as free text — "Data Science", "B.Com",
 * "EV design". The catalogue files every programme under one of thirty names.
 * Before 143 the only link between the two was a shared word, with "science",
 * "engineering" and "management" thrown away as noise — so "Computer Science"
 * matched nothing at all in Data Science, AI or Cyber Security, and a ₹99
 * shortlist for a data student was filled with Real Estate and Design
 * Management because they were tuition-free.
 *
 * Now: the words map to catalogue fields (DIRECT), each field sits in a family
 * (RELATED), and a programme outside both is not relevant to them. Relevance
 * is a filter, relaxed last and said out loud, not a bonus a free fee can beat.
 */
const FIELD_WORDS = [
  ['Computer Science & IT', /comput|software|\bit\b|informati|programming|\bweb\b|\bcse\b|\bmca\b|\bbca\b|\bcs\b|coding|developer/],
  ['Data Science, AI & Machine Learning', /\bdata\b|\bai\b|artificial intelligence|machine learning|\bml\b|analytics|big data|deep learning/],
  ['Cybersecurity & Cloud', /cyber|security|cloud|network/],
  ['Electrical & Electronics Engineering', /electric|electron|embedded|\bece\b|\beee\b|vlsi|semiconductor|telecom|power eng|microelectr|signal|communication eng|electronics and communication/],
  ['Mechanical & Automotive Engineering', /mechani|automotive|manufactur|production|mechatronic|industrial eng|\bev\b|vehicle/],
  ['Aerospace & Robotics', /aero|space|robot|automation|mechatronic|drone|avionic/],
  ['Renewable Energy', /renewable|energy|solar|wind|hydrogen/],
  ['Environmental Science & Sustainability', /environment|sustainab|climate|\bwater\b|ecolog|\bcivil\b|urban|geo/],
  ['Business & Management', /business|general management|international management|management studies|\bbba\b|commerce|b\.?\s?com\b|entrepreneur|business administration|supply chain|logistic|operations management|human resource|\bhr\b/],
  ['MBA', /\bmba\b/],
  ['Finance, Banking & Accounting', /financ|bank|account|commerce|b\.?\s?com\b|fintech|\bca\b|actuar|invest/],
  ['Economics', /econom/],
  ['Marketing & Digital Media', /marketing|digital media|brand|advertis|social media/],
  ['Media & Communication', /\bmedia\b|mass communication|communication studies|communication design|journalis|\bpr\b|public relations/],
  ['Arts & Design', /design|\bart\b|\barts\b|architect|interior|\bux\b|\bui\b|b\.?\s?arch|illustrat|photograph|music/],
  ['Animation, Film & Game Design', /animat|\bfilm|\bgame|vfx|visual effect|cinema/],
  ['Fashion & Luxury Management', /fashion|luxury|textile/],
  ['Hospitality, Tourism & Events', /hospitality|hotel|touris|\bevent/],
  ['Medicine, Dentistry & Allied Health', /medic|dent|mbbs|\bbds\b|nurs|physio|pharm|clinical|therap|allied health/],
  ['Public Health & Healthcare Management', /public health|health|hospital|pharm|epidemiolog/],
  ['Biotechnology & Bioinformatics', /biotech|bioinform|biolog|life science|genetic|biochem|microbio|bioeng/],
  ['Natural Sciences (Physics, Chemistry, Maths)', /physic|chemi|math|statist|\bb\.?\s?sc\b/],
  ['Psychology', /psycholog/],
  ['Social Sciences & Social Work', /social|sociolog|anthropolog|development studies/],
  ['International Relations & Public Policy', /international relation|public policy|policy stud|politic|governance|public admin|diplomac/],
  ['Law & Legal Studies', /\blaw\b|legal|\bllb\b|\bllm\b/],
  ['Humanities & Languages', /language|linguist|literat|history|philosoph|\benglish\b|humanit|german studies/],
  ['Education & Teaching', /educat|teach|pedagog/],
  ['Sport & Exercise Science', /sport|exercise|fitness/],
  ['Agriculture & Food Science', /agri|food|nutrition|farm|dairy|horticult/],
];
const FAMILIES = [
  ['Computer Science & IT', 'Data Science, AI & Machine Learning', 'Cybersecurity & Cloud', 'Electrical & Electronics Engineering'],
  ['Electrical & Electronics Engineering', 'Mechanical & Automotive Engineering', 'Aerospace & Robotics', 'Renewable Energy'],
  ['Business & Management', 'MBA', 'Finance, Banking & Accounting', 'Economics', 'Marketing & Digital Media', 'Hospitality, Tourism & Events', 'Fashion & Luxury Management'],
  ['Medicine, Dentistry & Allied Health', 'Public Health & Healthcare Management', 'Biotechnology & Bioinformatics'],
  ['Arts & Design', 'Animation, Film & Game Design', 'Media & Communication', 'Marketing & Digital Media', 'Fashion & Luxury Management'],
  ['Environmental Science & Sustainability', 'Renewable Energy', 'Agriculture & Food Science'],
  ['Social Sciences & Social Work', 'International Relations & Public Policy', 'Law & Legal Studies', 'Humanities & Languages', 'Education & Teaching', 'Psychology'],
  ['Natural Sciences (Physics, Chemistry, Maths)', 'Biotechnology & Bioinformatics'],
];
/* The catalogue's older names for the same fields. */
const FIELD_ALIAS = { 'computer science': 'Computer Science & IT' };
const normField = f => FIELD_ALIAS[String(f || '').toLowerCase()] || String(f || '');

function fieldsWanted(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const direct = new Set();
  FIELD_WORDS.forEach(([f, re]) => { if (re.test(t)) direct.add(f); });
  const related = new Set();
  direct.forEach(f => FAMILIES.forEach(fam => { if (fam.includes(f)) fam.forEach(x => { if (!direct.has(x)) related.add(x); }); }));
  return { direct, related };
}

/* 3 — their field, or their words in its name; 2 — the same family;
   0 — neither. 1 when they gave no field, so nothing is ranked on it. */
function relevance(p, w) {
  if (!w.field) return 1;
  const f = normField(p.field);
  const want = words(w.field);
  const inName = words(p.program).filter(x => want.includes(x)).length;
  if (w.fields.direct.has(f) || inName) return 3;
  /* The programme's own name read the way the student's words are — "M.Sc.
     Artificial Intelligence" filed under Other is still an AI programme. */
  /* Without the degree's own name: "Master of Arts in Governance" is not
     an arts programme, and "Master's Programme" is not programming. */
  const bare = String(p.program || '').replace(/\b(master|bachelor)('?s)?\s+(of\s+)?(arts|science|sciences|engineering|laws|business administration|fine arts|music)\b/gi, ' ')
    .replace(/\b(m\.?\s?a|b\.?\s?a|m\.?\s?sc|b\.?\s?sc|m\.?\s?eng|b\.?\s?eng|ll\.?m|mba)\b\.?/gi, ' ')
    .replace(/\bprogramme?s?\b/gi, ' ');
  const byName = fieldsWanted(bare).direct;
  if ([...byName].some(x => w.fields.direct.has(x))) return 3;
  if (w.fields.related.has(f) || [...byName].some(x => w.fields.related.has(x))) return 2;
  return 0;
}

/** Enough of a profile to pick anything worth paying for. */
function usable(profile) {
  const w = wants(profile);
  /* What they are applying for and in what — patch 145. Country and budget
     alone delivered thirteen universities, Pre-Masters and IT Security among
     them, to somebody who had said nothing about what they wanted to study. */
  return !!(w.level && w.field);
}

/* Words that carry no signal in a field name, so "Data Science and Engineering"
   and "Engineering" do not count as a match on "and". */
const STOP = new Set(['and', 'the', 'of', 'in', 'for', 'with', 'a', 'an', 'to',
  'science', 'studies', 'engineering', 'management',
  /* Patch 145: words that appear in every other programme name and say
     nothing about the subject — "Interactive Media Systems" is not an
     embedded-systems course, "Public Policy" is not public health. */
  'systems', 'system', 'public', 'technology', 'technologies', 'applied', 'international',
  'digital', 'advanced', 'intelligent', 'global', 'master', 'masters', 'msc', 'programme', 'program']);

const words = s => String(s || '').toLowerCase().split(/[^a-z0-9+]+/i)
  .filter(w => w.length > 2 && !STOP.has(w));

/**
 * How well one programme answers what somebody asked for.
 *
 * The catalogue's own `fit` — the office's judgement of how hard a programme is
 * to get into relative to a normal applicant — is the base, because it is the
 * one number a human maintained. Everything else adjusts it.
 */
function score(p, w) {
  let n = Number(p.fit || 0);

  /* Field first. Before 143 a matching word was worth 8 or 12 and a
     tuition-free row 14, so the same handful of free programmes — Real
     Estate, Design Management, Development Studies — turned up on the
     shortlists of chemistry, mechanical and architecture students alike.
     Relevance now outweighs everything else put together. */
  if (w.field) {
    const want = words(w.field);
    const inName = words(p.program).filter(x => want.includes(x)).length;
    n += relevance(p, w) * 40 + Math.min(3, inName) * 8;
  }

  /* Free tuition still counts — it is what this business finds — but only a
     fee that is actually known to be nothing. A private programme at ₹0 is a
     fee nobody has entered, not a free degree. */
  const fee = Number(p.totalInr) || 0;
  if (fee === 0 && p.isPublic) n += 8;
  else if (fee > 0 && w.ceiling && fee <= w.ceiling * 0.6) n += 4;

  /* An intake they can actually apply for. */
  const seasons = (p.intakes || []).map(i => String(i.season || '').toLowerCase());
  if (w.intake) {
    const season = /summer/i.test(w.intake) ? 'summer' : 'winter';
    if (seasons.includes(season)) n += 10;
  }

  /* A programme whose stated requirements they are known to clear is a
     better pick than one where we cannot yet tell. */
  const vd = REQS.check(p.reqs || {}, w.answers || {});
  n -= vd.unknown.length * 3;
  /* A known, open deadline for their term beats "no dates published". */
  if (w.term) n += termStatus(p, w.term) === 'open' ? 12 : 0;

  if (w.cgpa >= 8) n += (Number(p.fit || 0) < 70 ? 6 : 0);
  else if (w.cgpa && w.cgpa < 7) n += (Number(p.fit || 0) >= 80 ? 6 : -6);

  return n;
}

/**
 * The picks.
 *
 *   catalogue  every programme, as the finder sees them
 *   profile    what the student filled in
 *   count      how many universities the tier they bought promises
 *   kind       'public', 'private' or 'any'
 *
 * Returns programmes, best first, one per university, never more than `count`
 * and sometimes fewer.
 */
/*
 * The CGPA a programme actually asks for.
 *
 * Its own bar if the catalogue states one, otherwise the destination's rule
 * for that kind of university — which is the formula the public finder has
 * always used, and which this file did not use at all.
 *
 * That gap was the whole of it. The filter below read `p.minCgpa` and nothing
 * else, and `minCgpa` is blank on almost every row because almost no
 * university states its own number — the rule lives on the destination. So a
 * student with 5.0 who paid ₹9,999 was sold five German public universities
 * that every one of them asks 7.5 for, while the free finder on the home page
 * correctly refused to show them. The half of the site that takes money was
 * the half that ignored the requirement.
 */
function barOf(p, countries) {
  if (p.minCgpa != null && p.minCgpa !== '') return Number(p.minCgpa);
  const c = (countries || {})[String(p.country || '').toUpperCase()] || {};
  const own = p.isPublic ? c.minCgpaPublic : c.minCgpaPrivate;
  return own == null || own === '' ? null : Number(own);
}

/* The levels a stated level may bend to when a shortlist cannot be filled.
   A master's student may be shown an MBA and the other way round; a student
   who has only finished school may be shown a foundation year. Never across
   that line — before 143 a 12th-pass student who bought fifteen public
   universities was handed fifteen master's degrees, "at a different level". */
const LEVEL_NEAR = {
  master: ['mba'], mba: ['master'],
  bachelor: ['pathway', 'foundation', 'diploma'],
  pathway: ['foundation', 'bachelor'], foundation: ['pathway', 'bachelor'],
  diploma: ['bachelor'], phd: [],
};

/* Does this programme pass everything that is never relaxed? The CGPA or
   German-grade bar, and every requirement it states that the student is
   known to fall short of. */
/*
 * Is their bachelor's in something this programme accepts?
 *
 * Words on both sides, so it is read coarsely: the subjects the programme
 * names and the degree the student holds are both mapped onto the
 * catalogue's fields, and it fails only when they share neither a field nor
 * a family. A B.Com holder is not shown a Computer Science master's that asks
 * for a CS bachelor's; an ECE graduate is still shown one that asks for
 * "Electrical Engineering, IT or related". Unstated on either side is never a
 * failure. Patch 143.
 */
function subjectFits(p, w) {
  const want = String((p.reqs || {}).bachelorSubjects || '').trim();
  const have = String((w.answers || {}).bachelorSubjects || '').trim();
  if (!want || !have) return true;
  const need = fieldsWanted(want), mine = fieldsWanted(have);
  if (!need.direct.size || !mine.direct.size) return true;
  /* Their own fields, and only the neighbours a German admissions office
     actually treats as related. The whole family was too wide: an English
     graduate "fitted" a Psychology master's that asks for a Psychology
     bachelor's because both sit in the social-sciences family (patch 145). */
  const near = new Set(mine.direct);
  mine.direct.forEach(f => (SUBJECT_NEAR[f] || []).forEach(x => near.add(x)));
  return [...need.direct].some(f => near.has(f));
}
const SUBJECT_NEAR = {
  'Computer Science & IT': ['Data Science, AI & Machine Learning', 'Cybersecurity & Cloud', 'Electrical & Electronics Engineering'],
  'Data Science, AI & Machine Learning': ['Computer Science & IT', 'Natural Sciences (Physics, Chemistry, Maths)'],
  'Cybersecurity & Cloud': ['Computer Science & IT'],
  'Electrical & Electronics Engineering': ['Computer Science & IT', 'Renewable Energy', 'Aerospace & Robotics'],
  'Mechanical & Automotive Engineering': ['Aerospace & Robotics', 'Renewable Energy'],
  'Aerospace & Robotics': ['Mechanical & Automotive Engineering', 'Electrical & Electronics Engineering'],
  'Business & Management': ['MBA', 'Finance, Banking & Accounting', 'Economics', 'Marketing & Digital Media'],
  'Finance, Banking & Accounting': ['Business & Management', 'Economics'],
  'Economics': ['Business & Management', 'Finance, Banking & Accounting'],
  'Biotechnology & Bioinformatics': ['Natural Sciences (Physics, Chemistry, Maths)', 'Medicine, Dentistry & Allied Health'],
  'Medicine, Dentistry & Allied Health': ['Public Health & Healthcare Management', 'Biotechnology & Bioinformatics'],
  'Public Health & Healthcare Management': ['Medicine, Dentistry & Allied Health'],
  'Arts & Design': ['Animation, Film & Game Design'],
  'Environmental Science & Sustainability': ['Renewable Energy', 'Agriculture & Food Science'],
};

/*
 * THE TERM THEY ASKED FOR (patch 145).
 *
 * "Winter 2027", "Summer 2027" — or nothing. A programme with a known
 * deadline for that term that has already passed is not a pick: the students
 * the agents played were sold RWTH for Summer 2027 when RWTH's summer
 * deadline was 1 September 2026, and Ravensburg, which has no summer intake at
 * all. A programme with NO dates is let through, marked unknown — most private
 * universities admit on a rolling basis and simply do not publish one.
 */
function termOf(text) {
  const m = /(summer|spring|winter|fall|autumn)\D{0,3}(\d{4})/i.exec(String(text || ''));
  if (!m) return null;
  const season = /summer|spring/i.test(m[1]) ? 'summer' : 'winter';
  const year = Number(m[2]);
  return { season, year, start: new Date(year, season === 'summer' ? 3 : 9, 1) };
}
function termDeadline(i, term) {
  if (!i || !i.deadline || !term) return null;
  const se = /summer|spring/i.test(String(i.season || '')) ? 'summer' : 'winter';
  if (se !== term.season) return null;
  const d = new Date(i.deadline);
  if (isNaN(d)) return null;
  const limit = new Date(term.start); limit.setMonth(limit.getMonth() + 1);
  const at = new Date(term.year, d.getMonth(), d.getDate());
  while (at > limit) at.setFullYear(at.getFullYear() - 1);
  return at;
}
/* 'open' | 'closed' | 'unknown' for the term they want. */
function termStatus(p, term, today) {
  if (!term) return 'open';
  const ins = (p.intakes || []).filter(i => i && i.deadline);
  if (!ins.length) return 'unknown';
  const t0 = today || new Date(new Date().toDateString());
  return ins.some(i => { const at = termDeadline(i, term); return at && at >= t0; }) ? 'open' : 'closed';
}

/* A course a student visa does not cover: part-time, online, distance,
   executive — Arjun was sold three of them for an MBA in Germany. */
const NOT_FOR_VISA = /part[- ]?time|\bonline\b|distance|executive|berufsbegleitend|weekend|blended|fernstudium/i;
function visaFriendly(p) {
  return !NOT_FOR_VISA.test(String(p.program || '')) && !/distance learning|fernhochschule|fernuniversit/i.test(String(p.university || ''));
}

function clears(p, w, countries) {
  if (!visaFriendly(p)) return false;
  if (!subjectFits(p, w)) return false;
  if (p.germanGpa != null && w.german != null) {
    if (w.german > Number(p.germanGpa)) return false;
  } else {
    const bar = barOf(p, countries);
    if (w.cgpa && bar != null && w.cgpa < bar) return false;
  }
  return REQS.check(p.reqs || {}, w.answers || {}).fails.length === 0;
}

const nextTerm = t => t.season === 'winter'
  ? { season: 'summer', year: t.year + 1, start: new Date(t.year + 1, 3, 1) }
  : { season: 'winter', year: t.year, start: new Date(t.year, 9, 1) };

function pick(catalogue, profile, count, kind, drop, countries, prefer) {
  const w = wants(profile);
  const want = Math.max(0, Number(count) || 0);
  if (!want) return [];
  const off = new Set(drop || []);
  const keep = new Set((prefer || []).map(String));

  const eligible = (catalogue || []).filter(p => {
    if (kind === 'public' && !p.isPublic) return false;
    if (kind === 'private' && p.isPublic) return false;
    if (!off.has('country') && w.countries
      && w.countries.indexOf(String(p.country || '').toUpperCase()) < 0) return false;
    if (w.level) {
      const lv = String(p.level || '').toLowerCase();
      if (lv !== w.level && !(off.has('level') && (LEVEL_NEAR[w.level] || []).includes(lv))) return false;
    }
    /* undefined — not asked. null — asked, no ceiling. A private programme at
       ₹0 is a fee nobody entered, not a free one — it cannot be promised as
       inside a budget (patch 145). */
    if (!off.has('budget') && w.ceiling && (Number(p.totalInr || 0) > w.ceiling
      || (!p.isPublic && !Number(p.totalInr || 0)))) return false;
    /* A master's or MBA needs a bachelor's. */
    if (!w.hasBachelor && /^(master|mba|phd)$/.test(String(p.level || '').toLowerCase())) return false;
    /* The term they asked for: never one whose deadline has passed. When
       nothing is open for it, 'term' comes off and the next term's open
       programmes are used — said in the note. */
    if (w.term) {
      /* Relaxed, 'term' means the next intake this programme is open for —
         a winter-only programme is open the winter after, not the summer. */
      let st = termStatus(p, w.term);
      if (st === 'closed' && off.has('term')) {
        let t = w.term;
        for (let k = 0; k < 3 && st === 'closed'; k++) { t = nextTerm(t); st = termStatus(p, t); }
      }
      if (st === 'closed') return false;
    }
    /* Relevance to the field they asked for. Relaxed last, and only to
       "related", never to anything at all. */
    if (w.field) {
      const r = relevance(p, w);
      if (r < 2) return false;
      if (r < 3 && !off.has('field')) return false;
    }
    /* Never relaxed: a paid shortlist must not name a programme the student
       would be turned down for on the first line of the form. */
    return clears(p, w, countries);
  });

  const over = p => (w.ceiling ? Math.max(0, Number(p.totalInr || 0) - w.ceiling) : 0);
  const ranked = eligible
    .map(p => ({ p, s: score(p, w) + (keep.has(String(p.id)) ? 25 : 0) }))
    /* With the budget relaxed, the closest to it comes first — somebody who
       said "under ₹10 lakhs" and was shown a ₹39 lakh programme at the top of
       their list has been shown the wrong thing first. Then by score, then
       fee, then id, so two runs over the same catalogue agree. */
    .sort((a, b) => (off.has('budget') ? over(a.p) - over(b.p) : 0)
      || b.s - a.s
      || (Number(a.p.totalInr || 0) - Number(b.p.totalInr || 0))
      || String(a.p.id).localeCompare(String(b.p.id)));

  /* One per university. By name, simplified, as well as by key: "TU
     Dortmund" and "TU Dortmund University" are one university, and so are
     "FH Dortmund" and "Dortmund University of Applied Sciences and Arts". */
  const out = [], seen = new Set();
  for (const { p } of ranked) {
    const keys = uniKeys(p);
    if (keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    out.push(p);
    if (out.length >= want) break;
  }
  return out;
}

/* The ways one university's name is written in the catalogue, reduced to the
   same key. Deliberately conservative: city plus kind of school, so two
   different universities in one city are only merged when they are the same
   kind (a TU and an HS in Dortmund stay two). */
function uniKeys(p) {
  const raw = String(p.university || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
  const keys = [p.uKey || raw || p.id];
  const kind = /applied|fachhochschule|\bfh\b|hochschule|\bhs\b|\bth\b|\bhaw\b/.test(raw) ? 'has'
    : /technical|technische|\btu\b/.test(raw) ? 'tu' : /universit/.test(raw) ? 'uni' : '';
  const city = String(p.city || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const cityInName = city && raw.includes(city.split(/[\s,/]/)[0]);
  if (kind && cityInName && p.isPublic) keys.push('c:' + city.split(/[\s,/]/)[0] + ':' + kind);
  return keys;
}

/*
 * What to do when nothing matches, which is not a hypothetical.
 *
 * "Germany, master's, under ₹10 lakhs, private" describes nothing in the
 * catalogue today — every private German master's is over ten lakhs. A student
 * who paid for three universities and is handed zero has been robbed, however
 * defensible the filter was.
 *
 * So the constraints come off in a defined order, one at a time, until there
 * are enough rows — and WHICH ones came off is returned, so the student can be
 * told. That is what a good counsellor does out loud: "there is nothing
 * private in Germany under ten lakhs — here are the three closest, and here is
 * what they actually cost."
 *
 * Budget goes first because it is the constraint most often set from a guess.
 * Country goes last because it is the one people mean most.
 */
/* Note what is NOT in this list: the CGPA bar. See `pick`. */
/*
 * What may come off when a shortlist cannot be filled, in the order it comes.
 *
 * `country` used to be on this list and is deliberately not any more. A
 * student who chose Ireland and bought a package promising public
 * universities found none — Ireland has no public row, and nor do five of our
 * seven destinations — so the matcher relaxed its way down this list and
 * handed them German universities. It said so in the note, which is honest,
 * but it is not what they paid for: the destination is the one answer on the
 * form that is not a preference. It is where they are moving.
 *
 * Coming up short in the right country beats being full of the wrong one. The
 * note says which, and now that packages are scoped to a destination the
 * student is steered to the set that can actually serve them.
 */
const RELAX = ['term', 'budget', 'level', 'field'];

const RELAX_SAID = {
  budget: 'above the budget you gave',
  level: 'at a neighbouring level (an MBA for a master\u2019s, say)',
  field: 'in a field close to yours rather than exactly it',
  term: 'for a later intake, because the deadlines for the one you picked have passed',
  country: 'outside the country you picked',
};

/**
 * The shortlist, and an honest account of how it was arrived at.
 *
 * Returns { items, relaxed, note }. `relaxed` is the constraints that had to
 * come off; `note` is that said in a sentence, or empty when nothing was
 * relaxed and the picks are exactly what was asked for.
 */
function plan(catalogue, profile, count, kind, countries, opts) {
  const want = Math.max(0, Number(count) || 0);
  if (!want) return { items: [], relaxed: [], note: '', short: 0, cgpaHeld: 0 };
  const o = opts || {};
  /* Rows the office took off this student's list stay off it — a re-pick on
     the next profile save used to put them straight back. */
  const skip = new Set((o.exclude || []).map(String));
  const cat = (catalogue || []).filter(p => !skip.has(String(p.id)));

  let items = pick(cat, profile, want, kind, [], countries, o.prefer);
  const dropped = [];
  for (const c of RELAX) {
    if (items.length >= want) break;
    dropped.push(c);
    const wider = pick(cat, profile, want, kind, dropped, countries, o.prefer);
    /* Only keep the wider search if it actually found more. Dropping a
       constraint that was not narrowing anything should not be reported as
       though it were. */
    if (wider.length > items.length) items = wider;
    else dropped.pop();
  }
  /* Some lists need two things to come off together — a closed term AND a
     budget nobody's fee fits. One at a time, neither helps; cumulatively,
     in the same order, they do (patch 145). */
  if (items.length < want) {
    const acc = [];
    for (const c of RELAX) {
      acc.push(c);
      const wider = pick(cat, profile, want, kind, acc, countries, o.prefer);
      if (wider.length > items.length) { items = wider; dropped.length = 0; acc.forEach(x => dropped.push(x)); }
      if (items.length >= want) break;
    }
  }

  /* How many universities the CGPA (or German-grade) bar alone is holding
     back — among programmes that are otherwise a fit: right kind, country,
     level, budget, field and stated requirements. Counting every private
     university in Germany told a student with 5.5 that "another 4" were
     held, when the bar was the whole story. */
  const w = wants(profile);
  let cgpaHeld = 0;
  if (items.length < want && (w.cgpa || w.german != null)) {
    const off = new Set(dropped);
    const held = cat.filter(p => {
      if (kind === 'public' && !p.isPublic) return false;
      if (kind === 'private' && p.isPublic) return false;
      if (w.countries && w.countries.indexOf(String(p.country || '').toUpperCase()) < 0) return false;
      if (w.level) {
        const lv = String(p.level || '').toLowerCase();
        if (lv !== w.level && !(off.has('level') && (LEVEL_NEAR[w.level] || []).includes(lv))) return false;
      }
      if (!off.has('budget') && w.ceiling && Number(p.totalInr || 0) > w.ceiling) return false;
      if (w.field && relevance(p, w) < (off.has('field') ? 2 : 3)) return false;
      if (!w.hasBachelor && /^(master|mba|phd)$/.test(String(p.level || '').toLowerCase())) return false;
      if (w.term && termStatus(p, w.term) === 'closed' && !off.has('term')) return false;
      if (!visaFriendly(p)) return false;
      if (REQS.check(p.reqs || {}, w.answers || {}).fails.length) return false;
      if (!subjectFits(p, w)) return false;
      return !clears(p, w, countries);             // excluded ONLY by the grade bar
    });
    cgpaHeld = new Set(held.map(p => p.university)).size;
  }

  const parts = [];
  if (!w.hasBachelor && /^(master|mba|phd)$/.test(String(w.level || ''))) {
    parts.push('A master\u2019s needs a completed (or final-year) bachelor\u2019s degree, and your '
      + 'profile does not list one yet. Add your degree and marks and the list is picked again \u2014 '
      + 'or, if you have just finished school, choose Bachelor\u2019s as the level.');
  }
  if (dropped.length) {
    parts.push('Nothing matched every answer you gave, so some of these are '
      + dropped.map(c => RELAX_SAID[c]).join(', and some are ')
      + '. The fee and the country are on each one, so you can see which.');
  }
  if (cgpaHeld) {
    parts.push('Another ' + cgpaHeld + ' univers' + (cgpaHeld === 1 ? 'ity asks' : 'ities ask')
      + ' for a higher CGPA than the one on your profile, so '
      + (cgpaHeld === 1 ? 'it is' : 'they are') + ' not here \u2014 applying to '
      + (cgpaHeld === 1 ? 'it' : 'them') + ' would be turned down on the first line of '
      + 'the form. Your counsellor can tell you which of them take a bridging year.');
  }
  return { items, relaxed: dropped, note: parts.join(' '),
           short: Math.max(0, want - items.length), cgpaHeld };
}

/**
 * What a package delivers automatically.
 *
 * `matches` on the package says how many universities are picked for the
 * student the moment they buy it; `unlocks` says how many PUBLIC university
 * names that package may reveal, which is the older entitlement and the one
 * the finder enforces. The two together decide what kind of shortlist this is:
 *
 *   unlocks 0, matches 3   ₹99    three private universities
 *   unlocks 0, matches 10  ₹999   ten private universities
 *   unlocks 3, matches 3   ₹4,999 three public universities, named
 *
 * A package with neither delivers nothing on its own, which is right for the
 * ones where a counsellor agrees the shortlist on a call.
 */
function promise(pkg) {
  if (!pkg) return { count: 0, kind: 'any' };
  const unlocks = Number(pkg.unlocks || pkg.publicUnis || 0);
  const count = Number(pkg.matches != null ? pkg.matches : 0);
  if (!count) return { count: 0, kind: 'any' };
  return {
    count: unlocks ? Math.min(count, unlocks) : count,
    kind: unlocks ? 'public' : 'private',
  };
}

/*
 * THE SAME RULES, OPENED UP FOR STAFF (patch 147).
 *
 * "We hide the university shortlist until paid by student, so we need these
 *  proper filters to work in the counsellor and admin panel."
 *
 * `plan` answers "which N would the package deliver". A counsellor needs the
 * question behind it: every programme, and for each one whether it fits this
 * student and — when it does not — exactly why. One function, so the screen
 * a counsellor tests with and the machine that delivers the paid list can
 * never disagree about what "fits" means.
 *
 *   opts.kind      'public' | 'private' | 'any'
 *   opts.field     a catalogue field, exact — overrides the profile's words
 *   opts.q         words in the programme or university name
 *   opts.ceiling   rupees, overrides the profile's budget (0 = no ceiling)
 *   opts.limit     how many of each list to return
 *
 * Returns { fits: [...], near: [...], counts } — `near` is programmes that
 * miss on exactly one thing, which is what a counsellor can do something
 * about (a test score, a bridging semester, a later intake).
 */
const fold0 = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function screen(catalogue, profile, countries, opts) {
  const o = opts || {};
  const w = wants(profile);
  const ceiling = o.ceiling === undefined ? w.ceiling : (Number(o.ceiling) || null);
  /* Patch 150 — the home page's other filters, same rules as index.html. */
  const gg = parseFloat(o.ggpa);
  if (Number.isFinite(gg) && gg >= 1 && gg <= 4) w.german = gg;
  const tmax = o.tuitionMax === undefined || o.tuitionMax === '' ? null : Number(o.tuitionMax);
  const spec = fold0(o.spec);
  const words = String(o.q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const out = { fits: [], near: [], counts: { looked: 0, fits: 0, near: 0, unknownDates: 0 } };
  for (const p of catalogue || []) {
    if (o.kind === 'public' && !p.isPublic) continue;
    if (o.kind === 'private' && p.isPublic) continue;
    if (w.countries && w.countries.indexOf(String(p.country || '').toUpperCase()) < 0) continue;
    if (w.level && String(p.level || '').toLowerCase() !== w.level) continue;
    if (o.field && normField(p.field) !== o.field) continue;
    if (words.length && !words.every(x => fold(p.program + ' ' + p.university + ' ' + p.city).includes(x))) continue;
    /* No programme has a specialisation filled in yet, so the programme's own
       name counts too: "Embedded" finds "Embedded Systems". */
    if (spec && !fold0((p.reqs || {}).specialisation + ' ' + p.program).includes(spec)) continue;
    /* A stated tuition above the cap. Not stated is not excluded (home page rule). */
    if (tmax != null && Number.isFinite(tmax)) {
      const tv = (p.reqs || {}).tuitionEurSem;
      let t = tv !== undefined && tv !== null && tv !== '' && Number.isFinite(Number(tv)) ? Number(tv) : (Number(p.totalInr) === 0 ? 0 : null);
      /* Per-semester fee not entered but a total is: a rough per-semester
         figure (₹95 to the euro, four semesters), so "No tuition fee" does not
         return a ₹20L private master's. */
      if (t == null && Number(p.totalInr) > 0) t = Number(p.totalInr) / 95 / 4;
      if (t != null && t > tmax) continue;
    }
    const rel = o.field ? 3 : relevance(p, w);
    if (!o.field && w.field && rel < 2) continue;
    out.counts.looked++;
    const why = [], ask = [];
    if (!visaFriendly(p)) why.push('part-time / online / executive — a student visa does not cover it');
    /* Patch 149: in the staff screen an unanswered bachelor's is a question,
       not a miss — otherwise an empty profile shows every master's as missed.
       (Package delivery, plan(), still refuses to pick without it.) */
    if (!w.hasBachelor && /^(master|mba|phd)$/.test(String(p.level || '').toLowerCase())) ask.push('their bachelor’s');
    if (ceiling && Number(p.totalInr || 0) > ceiling) why.push('over budget (₹' + Math.round(Number(p.totalInr) / 100000) + 'L)');
    if (ceiling && !p.isPublic && !Number(p.totalInr || 0)) why.push('fee not entered');
    if (w.term) {
      const st = termStatus(p, w.term);
      if (st === 'closed') why.push('deadline for ' + w.term.season + ' ' + w.term.year + ' has passed');
      if (st === 'unknown') { ask.push('dates not published'); out.counts.unknownDates++; }
    }
    if (p.germanGpa != null && w.german != null) {
      if (w.german > Number(p.germanGpa)) why.push('asks German ' + Number(p.germanGpa).toFixed(1) + ', they have ' + w.german.toFixed(1));
    } else {
      const bar = barOf(p, countries);
      if (w.cgpa && bar != null && w.cgpa < bar) why.push('asks ' + bar + '+ CGPA, they have ' + w.cgpa);
    }
    const vd = REQS.check(p.reqs || {}, w.answers || {});
    vd.fails.forEach(f => why.push(f.label + ': asks ' + f.want + ', they have ' + f.have));
    vd.unknown.forEach(k => ask.push({ english: 'English score', gre: 'GRE', germanLevel: 'German level', bachelorYears: 'bachelor’s length', workExpMonths: 'work experience', papers: 'publications', moi: 'whether an MOI letter is accepted' }[k] || k));
    if (!subjectFits(p, w)) why.push('asks a bachelor’s in ' + String((p.reqs || {}).bachelorSubjects || '').split(/[—;]/)[0].trim().slice(0, 60));
    const row = { id: p.id, program: p.program, university: p.university, city: p.city || '', country: p.country,
      level: p.level, field: p.field, isPublic: !!p.isPublic, totalInr: Number(p.totalInr || 0),
      intakes: p.intakes || [], relevance: rel, why, ask, score: score(p, w) };
    if (!why.length) { out.fits.push(row); out.counts.fits++; }
    else if (why.length === 1) { out.near.push(row); out.counts.near++; }
  }
  /* Closest subject first — a Biotechnology student sees Biology before a
     Mathematics programme that only shares the Natural Sciences shelf. */
  const byScore = (a, b) => b.relevance - a.relevance || b.score - a.score || a.totalInr - b.totalInr || String(a.id).localeCompare(String(b.id));
  out.fits.sort(byScore); out.near.sort(byScore);
  const lim = Math.max(1, Math.min(500, Number(o.limit) || 100));
  out.fits = out.fits.slice(0, lim); out.near = out.near.slice(0, lim);
  return out;
}

module.exports = { pick, plan, promise, wants, usable, score, barOf, RELAX, answersOf, germanOf, fieldsWanted, relevance, clears, uniKeys, termOf, termStatus, visaFriendly, subjectFits, FIELD_WORDS, SUBJECT_NEAR, screen };
