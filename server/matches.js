'use strict';
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
  return {
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
    cgpa: Number(String(p.d_cgpa || '').replace(/[^\d.]/g, '')) || 0,
  };
}

/** Enough of a profile to pick anything worth paying for. */
function usable(profile) {
  const w = wants(profile);
  return !!((w.countries && w.countries.length) || w.level || w.field);
}

/* Words that carry no signal in a field name, so "Data Science and Engineering"
   and "Engineering" do not count as a match on "and". */
const STOP = new Set(['and', 'the', 'of', 'in', 'for', 'with', 'a', 'an', 'to',
  'science', 'studies', 'engineering', 'management']);

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

  /* Field is a preference, and it is where a shortlist stops feeling random.
     A word in common with the field they typed is worth a lot; a word in the
     programme's own name is worth more, because that is what they will read. */
  if (w.field) {
    const want = words(w.field);
    const inField = words(p.field).filter(x => want.includes(x)).length;
    const inName = words(p.program).filter(x => want.includes(x)).length;
    n += Math.min(3, inField) * 8 + Math.min(3, inName) * 12;
  }

  /* Free tuition is the thing this business exists to find, and a student who
     said "under ₹10 lakhs" has told us the fee is the constraint that matters. */
  if ((Number(p.totalInr) || 0) === 0) n += 14;
  else if (w.ceiling && Number(p.totalInr) <= w.ceiling * 0.6) n += 6;

  /* An intake they can actually apply for. A programme whose only deadline has
     passed is a bad row however well it fits. */
  const seasons = (p.intakes || []).map(i => String(i.season || '').toLowerCase());
  if (w.intake) {
    const season = /summer/i.test(w.intake) ? 'summer' : 'winter';
    if (seasons.includes(season)) n += 10;
  }

  /* Somebody with a strong record should not open a paid shortlist to find
     only the easy options on it; somebody without one should not open it to
     find only the impossible ones. */
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

function pick(catalogue, profile, count, kind, drop, countries) {
  const w = wants(profile);
  const want = Math.max(0, Number(count) || 0);
  if (!want) return [];
  const off = new Set(drop || []);

  const eligible = (catalogue || []).filter(p => {
    if (kind === 'public' && !p.isPublic) return false;
    if (kind === 'private' && p.isPublic) return false;
    if (!off.has('country') && w.countries
      && w.countries.indexOf(String(p.country || '').toUpperCase()) < 0) return false;
    if (!off.has('level') && w.level
      && String(p.level || '').toLowerCase() !== w.level) return false;
    /* undefined — not asked. null — asked, no ceiling. */
    if (!off.has('budget') && w.ceiling && Number(p.totalInr || 0) > w.ceiling) return false;
    /* The one constraint that is never relaxed — note it does not consult
       `off`. Country, level and budget are preferences somebody stated and
       might bend on. A CGPA bar is not: putting a university on a paid
       shortlist that the student cannot apply to is not a near miss, it is
       selling them something that does not exist. A shorter list is the right
       answer here, every time — and relaxing the COUNTRY is the useful move
       when this bites, because a student who cannot meet Germany's public bar
       may comfortably meet somebody else's. */
    const bar = barOf(p, countries);
    if (w.cgpa && bar != null && w.cgpa < bar) return false;
    return true;
  });

  const ranked = eligible
    .map(p => ({ p, s: score(p, w) }))
    /* By score, then by fee, then by id — the last one only so that two runs
       over the same catalogue return the same shortlist. A paid shortlist that
       reshuffles when you refresh looks like it was never real. */
    .sort((a, b) => b.s - a.s
      || (Number(a.p.totalInr || 0) - Number(b.p.totalInr || 0))
      || String(a.p.id).localeCompare(String(b.p.id)));

  const out = [], seen = new Set();
  for (const { p } of ranked) {
    const key = p.uKey || p.university || p.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= want) break;
  }
  return out;
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
const RELAX = ['budget', 'level'];

const RELAX_SAID = {
  budget: 'above the budget you gave',
  level: 'at a different level to the one you picked',
  country: 'outside the country you picked',
};

/**
 * The shortlist, and an honest account of how it was arrived at.
 *
 * Returns { items, relaxed, note }. `relaxed` is the constraints that had to
 * come off; `note` is that said in a sentence, or empty when nothing was
 * relaxed and the picks are exactly what was asked for.
 */
function plan(catalogue, profile, count, kind, countries) {
  const want = Math.max(0, Number(count) || 0);
  if (!want) return { items: [], relaxed: [], note: '', short: 0, cgpaHeld: 0 };

  let items = pick(catalogue, profile, want, kind, [], countries);
  const dropped = [];
  for (const c of RELAX) {
    if (items.length >= want) break;
    dropped.push(c);
    const wider = pick(catalogue, profile, want, kind, dropped, countries);
    /* Only keep the wider search if it actually found more. Dropping a
       constraint that was not narrowing anything should not be reported as
       though it were. */
    if (wider.length > items.length) items = wider;
    else dropped.pop();
  }

  /* How many rows the CGPA bar alone is holding back, over everything else
     that was allowed to relax. A list that comes up short has to be able to
     say WHY, or the student reads it as us not trying — and "your CGPA is
     below what these ask" is the one reason they can do something about, by
     retaking a test, adding a bridging year, or looking somewhere else. */
    const w = wants(profile);
  let cgpaHeld = 0;
  if (items.length < want && w.cgpa) {
    const withoutBar = (catalogue || []).filter(p => {
      if (kind === 'public' && !p.isPublic) return false;
      if (kind === 'private' && p.isPublic) return false;
      if (!dropped.includes('country') && w.countries
        && w.countries.indexOf(String(p.country || '').toUpperCase()) < 0) return false;
      if (!dropped.includes('level') && w.level
        && String(p.level || '').toLowerCase() !== w.level) return false;
      if (!dropped.includes('budget') && w.ceiling
        && Number(p.totalInr || 0) > w.ceiling) return false;
      const bar = barOf(p, countries);
      return bar != null && w.cgpa < bar;          // excluded ONLY by the bar
    });
    cgpaHeld = new Set(withoutBar.map(p => p.university)).size;
  }

  const parts = [];
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

module.exports = { pick, plan, promise, wants, usable, score, barOf, RELAX };
