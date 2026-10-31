'use strict';
/*
 * Round 178 (30 Oct, brief Part D): "when a student searches for the
 * university or a search term in ChatGPT or Google, our site should come up."
 *
 * Three kinds of page, all rendered from the live catalogue on request:
 *
 *   1. /university/<uni>/<programme> — one page per NAMED programme: every
 *      row the public already sees by name (private universities, and every
 *      country but Germany's public universities). Degree, language, city,
 *      intakes, requirements, application route, fee (never an indicative
 *      one), Course + BreadcrumbList JSON-LD.
 *   2. The university page's direct answer, "Subjects you can study" line
 *      (FIELD level) and FAQ + FAQPage JSON-LD (uniAnswer / uniFaq).
 *   3. The Germany master's guides — landing pages built from the tags and
 *      requirements (MOI, 3-year bachelor's, no tuition, low CGPA, English-
 *      taught, deadline month, Indian branch) and the hub that links them.
 *
 * THE RULE THAT MUST NOT BREAK (patches 146/170/175/176). A German PUBLIC
 * university's programme names are what the packages sell. So:
 *   - such a row never gets a page, and its address is not derivable: the
 *     slug table is built only from named rows, so /university/<public>/<x>
 *     is a 404 for every x, identical to a university that does not exist;
 *   - a landing page lists the university (its name is public — the
 *     /university pages show it), its city and "Programmes open with a
 *     package", and nothing from the row: no title, fee or deadline date;
 *   - no page here prints a count of programmes or universities — every
 *     quantity is said in words ("some", "most") or not at all.
 */

const UNIS = require('./unis.js');
const T = require('./tags.js');
const F = require('./find.js');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LEVEL_WORD = { master: 'masters', bachelor: 'bachelors', mba: 'mba', phd: 'phd', diploma: 'diploma', foundation: 'foundation', pathway: 'foundation' };

/* A row whose name is part of a package: a public university in Germany. */
const isHiddenRow = p => !!p && !!p.isPublic && String(p.country || '').toUpperCase() === 'DE';
const isLockedUni = u => !!u && !!u.isPublic && String(u.country || '').toUpperCase() === 'DE';

const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const reqsOf = p => (p && p.reqs && typeof p.reqs === 'object') ? p.reqs : {};
const storedTags = p => (Array.isArray(p && p.tags) ? p.tags : []).map(t => T.fold(t));
const hasStored = (p, tag) => storedTags(p).includes(T.fold(tag));
const tagSet = p => { try { return new Set(T.tagsOf(p).map(t => T.fold(t))); } catch (e) { return new Set(); } };

/* The fee the public may see (find.js owns the flag; the fallback reads the
   same fields, so a missing export never shows an agent's fee). */
const feeIndicative = p => (typeof F.feeIndicative === 'function' ? F.feeIndicative(p) : false)
  || !!(p && (p.feeIndicative === true || p.feeIndicative === 1 || p.feeIndicative === 'yes'
    || p.fee_indicative === 1 || p.fee_indicative === true || reqsOf(p).feeIndicative === true
    || /agent/i.test(String(p.feeSource || p.fee_source || ''))));
const awardingBody = p => (typeof F.awardingBody === 'function' ? F.awardingBody(p)
  : String((p && (p.awardingBody || p.awarding_body || reqsOf(p).awardingBody)) || '').trim());

/* ---------------------------------------------------------- the tests */

const moiOk = p => reqsOf(p).moiAccepted === true || hasStored(p, 'MOI Accepted');
const threeYear = p => {
  const r = reqsOf(p);
  if (r.threeYearOk === true) return true;
  if (num(r.ectsMin) != null && num(r.ectsMin) <= 180) return true;
  if (num(r.bachelorYears) != null && num(r.bachelorYears) <= 3) return true;
  return hasStored(p, '3-Year Bachelor Accepted');
};
const noTuition = p => {
  if (feeIndicative(p)) return false;
  const t = num(reqsOf(p).tuitionEurSem);
  if (t != null) return t === 0;
  return hasStored(p, 'No Tuition Fee') || (!!p.isPublic && !Number(p.totalInr || 0) && !(p.tags || []).length);
};
const noGerman = p => {
  const g = String(reqsOf(p).germanLevel || '').trim();
  if (g) return /^none$/i.test(g);
  return hasStored(p, 'No German Required');
};
/* Bavarian formula, the finder's (find.js germanFrom), at the kindest pass
   mark Indian universities use: a CGPA of 7 is a German 2.5. */
const LOW_CGPA = 7;
const germanAt = (cg, pass) => (cg < pass ? null : Math.floor((1 + 3 * (10 - cg) / (10 - pass)) * 10) / 10);
function lowCgpa(p, countries) {
  const own = num(p.minCgpa);
  if (own != null) return own <= LOW_CGPA;
  const gg = num(p.germanGpa);
  if (gg != null) return gg >= germanAt(LOW_CGPA, 4);
  const c = (countries || {})[String(p.country || '').toUpperCase()] || {};
  const bar = num(p.isPublic ? c.minCgpaPublic : c.minCgpaPrivate);
  return bar != null && bar <= LOW_CGPA;
}
const deadlineMonths = p => {
  const out = new Map();
  (p.intakes || []).forEach(i => {
    const m = /^\d{4}-(\d{2})-\d{2}/.exec(String((i && i.deadline) || ''));
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
      const k = Number(m[1]) - 1;
      const se = /summer|spring/i.test(String(i.season || '')) ? 'summer' : 'winter';
      if (!out.has(k)) out.set(k, new Set());
      out.get(k).add(se);
    }
  });
  return out;
};

const BRANCHES = [
  { slug: 'ece', short: 'ECE', name: 'Electronics & Communication Engineering', tags: ['ECE', 'Electronics & Communication Engineering'], fields: ['Electrical & Electronics Engineering'], find: 'ECE' },
  { slug: 'cse', short: 'CSE', name: 'Computer Science & Engineering', tags: ['CSE', 'Computer Science & Engineering', 'Computer Science'], fields: ['Computer Science & IT'], find: 'CSE' },
  { slug: 'eee', short: 'EEE', name: 'Electrical & Electronics Engineering', tags: ['EEE', 'Electrical & Electronics Engineering', 'Electrical Engineering'], fields: ['Electrical & Electronics Engineering'], find: 'EEE' },
  { slug: 'mechanical', short: 'Mechanical', name: 'Mechanical Engineering', tags: ['Mechanical Engineering', 'Mechanical'], fields: ['Mechanical & Automotive Engineering'], find: 'Mechanical Engineering' },
  { slug: 'civil', short: 'Civil', name: 'Civil Engineering', tags: ['Civil Engineering'], fields: [], find: 'Civil Engineering' },
  { slug: 'chemical', short: 'Chemical', name: 'Chemical Engineering', tags: ['Chemical Engineering'], fields: [], find: 'Chemical Engineering' },
  { slug: 'biotechnology', short: 'Biotechnology', name: 'Biotechnology', tags: ['Biotechnology'], fields: ['Biotechnology & Bioinformatics'], find: 'Biotechnology' },
  { slug: 'it', short: 'IT', name: 'Information Technology', tags: ['IT', 'Information Technology'], fields: ['Computer Science & IT'], find: 'IT' },
];
function branchOk(b, p) {
  const s = tagSet(p);
  if (b.tags.some(t => s.has(T.fold(t)))) return true;
  /* A row nobody has tagged and that names no bachelor's: its own field. */
  return !(p.tags || []).length && !reqsOf(p).bachelorSubjects && b.fields.includes(String(p.field || ''));
}

/* ------------------------------------------------------- word helpers */

const listWords = a => { const x = a.filter(Boolean); return x.length <= 1 ? (x[0] || '') : x.slice(0, -1).join(', ') + ' and ' + x[x.length - 1]; };
/* How many of a set, in a word. Never a number (owner rule). */
const share = (part, whole) => (!part ? 'none' : part >= whole ? 'all' : part / whole >= 0.6 ? 'most' : 'some');
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const dayMonth = iso => { const d = new Date(String(iso || '')); return isNaN(d) ? '' : d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };

function makeGuides(d) {
  const { db, esc, absolute } = d;

  /* ------------------------------------------------- programme slugs */

  /* name + level, unique within the university: then the city, then the
     row id. Built ONLY from named rows, sorted by id so it is stable. */
  function slugTable(u) {
    if (!u) return new Map();
    if (u._guideSlugs) return u._guideSlugs;
    const out = new Map();
    if (!isLockedUni(u)) {
      const taken = new Set();
      const rows = (u.programmes || []).filter(p => !isHiddenRow(p))
        .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
      for (const p of rows) {
        const base = ((UNIS.slugOf(p.program) || 'programme').slice(0, 80) + '-' + (LEVEL_WORD[String(p.level || '').toLowerCase()] || 'masters')).replace(/-+/g, '-');
        let s = base;
        if (taken.has(s) && p.city) s = base + '-' + UNIS.slugOf(p.city);
        if (taken.has(s)) s = base + '-' + UNIS.slugOf(String(p.id));
        taken.add(s);
        out.set(String(p.id), s.slice(0, 120));
      }
    }
    Object.defineProperty(u, '_guideSlugs', { value: out, enumerable: false, configurable: true });
    return out;
  }
  const progPath = (u, p) => { const s = slugTable(u).get(String(p.id)); return s ? '/university/' + u.slug + '/' + s : ''; };
  /** The programme's title on the university page: a link to its page when it has one. */
  function progTitleLink(u, p) {
    const href = progPath(u, p);
    return href ? '<a href="' + esc(href) + '" style="color:inherit">' + esc(p.program) + '</a>' : esc(p.program);
  }

  /* -------------------------------------------------- the catalogue */

  let CACHE = null;
  function catalogue() {
    const v = typeof db.catalogueVersion === 'function' ? db.catalogueVersion() : 0;
    if (CACHE && CACHE.v === v && Date.now() - CACHE.at < 5 * 60 * 1000) return CACHE;
    /* Patch 179 (memory): the guides are about Germany, so only Germany's
       rows are read and held. This read every live row in every country —
       seventy thousand once the UK and USA came in — on the first page view
       after any catalogue write, and kept them all, which on a 512 MB server
       was the restart loop of 31 Oct. Programme pages elsewhere are found
       one university at a time (sitemapEntries). */
    const raw = db.rowsForCountries(['DE']) || [];
    const stamp = new Map(raw.map(r => [String(r.id), String(r.updated_at || '')]));
    const rows = raw.map(UNIS.fromRow);
    const hidden = d.hiddenUniversitySlugs ? d.hiddenUniversitySlugs() : new Set();
    const unis = UNIS.group(rows).filter(u => !hidden.has(u.slug));
    const countries = d.liveCountries();
    CACHE = { v, at: Date.now(), unis, stamp, countries, pages: null };
    CACHE.pages = buildPages(CACHE);
    return CACHE;
  }
  const lastmodOf = (cat, rows) => rows.map(p => cat.stamp.get(String(p.id)) || '').filter(Boolean).sort().pop() || '';

  /* ------------------------------------------------ landing pages */

  const GUIDE_PAGES = [];
  const add = o => GUIDE_PAGES.push(o);
  add({ path: 'masters-in-germany-without-ielts', group: 'Requirements', title: "Master's in Germany without IELTS",
    short: 'Without IELTS (MOI accepted)', test: p => moiOk(p), find: { moi: '1' },
    desc: "Universities in Germany that accept a Medium of Instruction (MOI) letter instead of IELTS for master's admission — public and private, for Indian students.",
    intro: x => "Yes — you can study a master's in Germany without IELTS at universities that accept a Medium of Instruction (MOI) letter, the letter from your college confirming your bachelor's was taught in English. "
      + x.ex + ' are among the universities below where master\'s programmes take an MOI letter in place of IELTS or TOEFL.',
    faq: x => [
      ["Can I get admission to a master's in Germany without IELTS?", 'Yes, at universities that accept an MOI letter instead — ' + x.ex + ' among them. Each programme decides for itself, so a counsellor checks that your letter suits the programme before anything is filed.'],
      ['Do public universities in Germany accept an MOI letter?', x.pubEx ? 'Yes — some public universities do, including ' + x.pubEx + '. Their programme names and deadlines open with a Glovels package.' : 'On our list it is private universities that accept it; public universities in Germany mostly ask for IELTS or TOEFL.'],
      ['Which cities have universities that accept MOI?', 'Universities that accept an MOI letter are in ' + x.cities + ', among other cities.'],
    ] });
  add({ path: 'germany-3-year-bachelor-accepted', group: 'Requirements', title: "Master's in Germany with a 3-year bachelor's",
    short: "3-year bachelor's accepted", test: p => threeYear(p), find: { tags: '3-Year Bachelor Accepted' },
    desc: "German universities whose master's programmes accept a 3-year bachelor's (180 ECTS) — B.Sc., B.Com, BCA and BBA graduates from India.",
    intro: x => "Yes — a 3-year bachelor's (180 ECTS, such as a B.Sc., B.Com, BBA or BCA) is accepted for some master's programmes in Germany. "
      + 'The universities below, including ' + x.ex + ', have master\'s programmes that state they accept a three-year degree.',
    faq: x => [
      ["Can I do a master's in Germany after a 3-year degree?", 'Yes, at programmes that accept 180 ECTS. ' + cap(x.ex) + ' are among the universities with such programmes; others ask for a 4-year degree (210 or 240 ECTS) and turn a 3-year degree away.'],
      ["How many ECTS is a 3-year Indian bachelor's?", "A 3-year bachelor's usually counts as 180 ECTS credits and a 4-year B.Tech or B.E. as 240. Look for programmes that state they accept 180 — the ones on this page do."],
      ["Which German universities accept a 3-year bachelor's?", 'The list on this page, which follows our live catalogue — ' + x.ex + ' among them, in cities such as ' + x.cities + '.'],
    ] });
  add({ path: 'tuition-free-masters-germany', group: 'Fees', title: "Tuition-free master's in Germany",
    short: 'No tuition fee', test: p => noTuition(p), find: { tuition: '0' },
    desc: "Master's programmes in Germany with no tuition fee — the public universities where Indian students pay only the semester contribution and living costs.",
    intro: x => "Yes — many master's programmes at German public universities charge no tuition fee: students pay a semester contribution and their own living costs. "
      + 'The universities below, including ' + x.ex + ', have master\'s programmes with no tuition fee.',
    faq: x => [
      ["Are master's degrees in Germany really free?", 'At many public universities, yes: there is no tuition fee, only a semester contribution each semester and your living costs. ' + cap(x.ex) + ' are among them.'],
      ['Do I still need money to show for the visa?', x.funds || 'Yes — the student visa asks for proof that you can pay a year of living costs, usually in a blocked account.'],
      ['Which universities in Germany are tuition-free?', 'The public universities on this page — ' + x.ex + ' among them, in cities such as ' + x.cities + '. The programme names open with a Glovels package.'],
    ] });
  add({ path: 'low-cgpa-masters-germany', group: 'Requirements', title: "Master's in Germany with a low CGPA (6–7)",
    short: 'Low CGPA (6–7) accepted', test: (p, c) => lowCgpa(p, c), find: { cgpa: '7' },
    desc: "German universities whose master's programmes a CGPA of 6 to 7 out of 10 can meet — how the German grade works and where to apply.",
    intro: x => "Yes — a CGPA of 6 to 7 out of 10 can still get you into a master's in Germany. The universities below, including " + x.ex
      + ', have master\'s programmes whose grade bar a CGPA of 7 can meet, depending on your university\'s pass mark.',
    faq: x => [
      ['Can I get into a German university with a 6 or 7 CGPA?', 'Yes, at programmes whose bar is within reach — ' + x.ex + ' among them. Many private universities ask for a CGPA of 6 or more; public ones state a German grade, which depends on your pass mark.'],
      ['How is my CGPA converted to a German grade?', 'German universities use the modified Bavarian formula: German grade = 1 + 3 × (best mark − your mark) ÷ (best mark − pass mark). A CGPA of 7 with a pass mark of 4 is a German 2.5; 1.0 is the best grade and 4.0 a pass.'],
      ['Which universities accept a low CGPA?', 'The universities on this page, in cities such as ' + x.cities + '. A counsellor works out your German grade and checks each programme before you apply.'],
    ] });
  add({ path: 'english-taught-masters-germany-no-german', group: 'Requirements', title: "English-taught master's in Germany — no German needed",
    short: 'English-taught, no German', test: p => noGerman(p), find: { tags: 'No German Required' },
    desc: "English-taught master's programmes in Germany that ask for no German for admission — universities, cities and how to apply from India.",
    intro: x => "Yes — you can study a master's in Germany in English without knowing German. The universities below, including " + x.ex
      + ', have master\'s programmes taught in English that ask for no German for admission.',
    faq: x => [
      ['Can I study a master\'s in Germany in English?', 'Yes. ' + cap(x.ex) + ' are among the universities with English-taught master\'s programmes that ask for no German for admission.'],
      ['Do I need to know German at all?', 'Not for admission to these programmes. ' + (x.germanLife || 'Some German helps with part-time work and daily life, so many students learn the basics before they fly.')],
      ['Which universities teach master\'s programmes in English?', 'The universities on this page, in cities such as ' + x.cities + '.'],
    ] });
  MONTHS.forEach((m, k) => add({ path: 'germany-masters-deadlines/' + m.toLowerCase(), group: 'Deadlines', month: k,
    title: "Master's in Germany with a " + m + ' deadline', short: m,
    test: p => deadlineMonths(p).has(k),
    desc: "German universities with master's application deadlines in " + m + ' — which intake it is for and how to get your application in on time.',
    intro: x => m + ' is an application deadline month for master\'s programmes in Germany for the ' + x.seasonWords + '. '
      + 'Universities with a master\'s deadline in ' + m + ' include ' + x.ex + '; the exact date differs by programme, so check it on the programme or with a counsellor.',
    faq: x => [
      ['Which German universities have master\'s deadlines in ' + m + '?', 'The universities on this page — ' + x.ex + ' among them, in cities such as ' + x.cities + '.'],
      ['Which intake has a deadline in ' + m + '?', cap(x.seasonWords) + '.'],
      ['When should I start my application?', 'Two to three months before the deadline. ' + (x.aps || 'Documents such as the APS certificate take weeks to arrive, so start early.')],
    ] }));
  BRANCHES.forEach(b => add({ path: 'masters-in-germany-for/' + b.slug, group: 'Branch', branch: b,
    title: "Master's in Germany after " + (b.short === b.name ? b.name : b.short + ' (' + b.name + ')'), short: b.short,
    test: p => branchOk(b, p), find: { tags: b.find },
    desc: "Master's programmes in Germany that accept a bachelor's in " + b.name + ' (' + b.short + ') — subjects, universities and how to apply from India.',
    intro: x => "Yes — with a bachelor's in " + b.name + (b.short !== b.name ? ' (' + b.short + ')' : '') + ' you can apply for a master\'s in Germany, in fields such as '
      + x.fields + '. Universities with master\'s programmes that accept ' + b.short + ' graduates include ' + x.ex + '.',
    faq: x => [
      ["Can I do a master's in Germany after " + b.short + '?', 'Yes. ' + cap(x.ex) + ' are among the universities whose master\'s programmes accept a bachelor\'s in ' + b.name + '.'],
      ['Which master\'s subjects can a ' + b.short + ' graduate study in Germany?', 'Programmes that accept ' + b.short + ' graduates are in ' + x.fields + '.'],
      ['Which universities accept ' + b.short + ' graduates?', 'The universities on this page, in cities such as ' + x.cities + '. A counsellor checks the subjects each programme asks for against your marksheets.'],
    ] }));

  function buildPages(cat) {
    const de = cat.unis.filter(u => String(u.country).toUpperCase() === 'DE');
    const c = cat.countries.DE || { name: 'Germany' };
    const out = new Map();
    for (const g of GUIDE_PAGES) {
      const hits = [];
      for (const u of de) {
        const rows = u.programmes.filter(p => String(p.level || '').toLowerCase() === 'master' && g.test(p, cat.countries));
        if (rows.length) hits.push({ u, rows });
      }
      out.set(g.path, { g, hits, c, lastmod: lastmodOf(cat, hits.flatMap(h => h.rows)) });
    }
    return out;
  }

  /* Words for a page, from its list: example universities, cities, fields. */
  function wordsFor(pg) {
    const hits = pg.hits;
    const byRows = hits.slice().sort((a, b) => b.rows.length - a.rows.length || a.u.name.localeCompare(b.u.name));
    const pub = byRows.filter(h => h.u.isPublic), priv = byRows.filter(h => !h.u.isPublic);
    const pick = pub.slice(0, 2).concat(priv.slice(0, 1));
    if (pick.length < 3) byRows.forEach(h => { if (pick.length < 3 && !pick.includes(h)) pick.push(h); });
    const city = new Map();
    hits.forEach(h => { if (h.u.city) city.set(h.u.city, (city.get(h.u.city) || 0) + 1); });
    const fields = new Map();
    hits.forEach(h => h.rows.forEach(p => { if (p.field && p.field !== 'Other') fields.set(p.field, (fields.get(p.field) || 0) + 1); }));
    const seasons = new Set();
    if (pg.g.month != null) hits.forEach(h => h.rows.forEach(p => (deadlineMonths(p).get(pg.g.month) || new Set()).forEach(s => seasons.add(s))));
    const seasonWords = [seasons.has('winter') ? 'winter intake (starting in October)' : '', seasons.has('summer') ? 'summer intake (starting in April)' : ''].filter(Boolean);
    const c = pg.c || {};
    return {
      ex: listWords(pick.map(h => h.u.name)),
      pubEx: listWords(pub.slice(0, 3).map(h => h.u.name)),
      cities: listWords([...city.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(e => e[0])),
      fields: listWords([...fields.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(e => e[0])),
      seasonWords: seasonWords.length === 2 ? 'winter intake (starting in October) and the summer intake (starting in April)' : (seasonWords[0] || 'winter intake'),
      funds: c.fundsLabel ? 'Yes — ' + c.fundsLabel + (c.fundsInr ? ' of about ' + UNIS.money(c.fundsInr) : '') + '. ' + (c.fundsNote || '') : '',
      aps: c.extraNote || '',
      germanLife: Array.isArray(c.tests) ? (c.tests.find(t => /german/i.test(t) && /daily|life/i.test(t)) || '') .replace(/(^.)/, m => m.toUpperCase()).replace(/([^.])$/, '$1.') : '',
    };
  }

  const findHref = g => {
    const q = Object.assign({ country: 'DE', level: 'master' }, g.find || {});
    return '/find-university?' + Object.keys(q).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
  };
  const guideUrl = p => '/' + p;

  const GUIDE_CSS = `<style>/* GLOVELS-GUIDE-CSS */
.g-answer{font:400 16.5px/1.7 var(--sans);color:var(--navy-900);margin:0 0 18px}
.g-unis{list-style:none;padding:0;margin:14px 0 26px;display:grid;gap:10px}
.g-unis>li{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:13px 16px;min-width:0}
.g-unis .top{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}
.g-unis .top a{font:700 15px/1.35 var(--sans);color:var(--navy-900)}
.g-unis .top small{font:400 12.4px/1.5 var(--sans);color:var(--muted)}
.g-unis .kind{font:700 10.8px/1.3 var(--sans);letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:99px;border:1px solid var(--line)}
.g-unis .kind.pub{color:#14603a;border-color:#bfe0cc;background:#eaf6ee}.g-unis .kind.priv{color:#5b4409;border-color:#e6d5a8;background:#fdf6e6}
.g-unis ul{margin:8px 0 0;padding-left:18px;font:400 13.4px/1.6 var(--sans)}
.g-unis .pk{margin:6px 0 0;font:400 13px/1.55 var(--sans);color:var(--muted)}
.g-cta{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 26px}
.g-faq{margin:10px 0 26px}.g-faq details{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:0 0 8px}
.g-faq summary{font:700 14.6px/1.45 var(--sans);color:var(--navy-900);cursor:pointer}.g-faq p{margin:8px 0 0;font:400 14px/1.65 var(--sans);color:var(--navy-800)}
.g-hub{columns:2;column-gap:28px;padding-left:18px;margin:10px 0 22px}@media (max-width:600px){.g-hub{columns:1}}.g-hub li{break-inside:avoid;margin:0 0 7px}
.g-req{margin:10px 0 24px;padding-left:18px;font:400 14px/1.7 var(--sans);color:var(--navy-800)}
.g-box{margin:22px 0;padding:14px 18px;border-radius:12px;background:#eef3fc;border:1px solid #b9cdf0;font:400 14px/1.65 var(--sans);color:var(--navy-800)}
.g-box a{font-weight:700;color:#0b3d91}
</style>`;

  const ld = o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
  const faqLd = qa => ({ '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  const faqHtml = (qa, heading) => '<h2 id="faq">' + esc(heading || 'Frequently asked questions') + '</h2><div class="g-faq">'
    + qa.map(([q, a], i) => '<details' + (i === 0 ? ' open' : '') + '><summary>' + esc(q) + '</summary><p>' + esc(a) + '</p></details>').join('') + '</div>';
  const crumbsLd = items => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: absolute(it[1]) })) });

  /* The template, filled the way the university page fills it. */
  function render({ title, desc, canonical, h1, eyebrow, chips, dateline, crumbs, body, jsonld, extraLd, indexable, keywords, tail }) {
    const t = d.templates();
    if (!t) return null;
    const page = d.fill(t.page, Object.assign(d.metaHoles({
      title, desc, canonical: absolute(canonical), keywords, image: d.defaultOg, imageAlt: h1, type: 'website',
      indexable: indexable !== false, jsonld,
    }), {
      H1: esc(h1),
      HERO: d.HERO.attrs({ eyebrow, chips }),
      DATELINE: esc(dateline || ''),
      CRUMBS: crumbs.map((c, i) => i === crumbs.length - 1 ? esc(c[0]) : '<a href="' + esc(c[1]) + '">' + esc(c[0]) + '</a>').join(' / '),
      BODY: body,
    }));
    return d.rootLinks(page.replace('</head>', d.uniCss() + GUIDE_CSS + (extraLd || []).map(ld).join('') + '\n</head>')
      .replace('</body>', (tail || '') + '</body>'));
  }

  const HUB_CRUMBS = [['Home', '/'], ['Study in Germany', '/study-in-germany'], ["Germany master's guides", '/germany-masters-guides']];

  function landingPage(path) {
    const cat = catalogue();
    const pg = cat.pages.get(path);
    if (!pg || !pg.hits.length) return null;           // thin-page guard
    const g = pg.g, x = wordsFor(pg);
    const intro = g.intro(x), qa = g.faq(x);
    const MAX_NAMED = 6;
    const list = pg.hits.slice().sort((a, b) => a.u.name.localeCompare(b.u.name)).map(({ u, rows }) => {
      const locked = isLockedUni(u);
      const head = '<div class="top"><a href="/university/' + esc(u.slug) + '">' + esc(u.name) + '</a>'
        + (UNIS.typeLabel(u) ? '<span class="kind ' + (u.isPublic ? 'pub' : 'priv') + '">' + UNIS.typeLabel(u) + '</span>' : '')
        + (u.city ? '<small>' + esc(u.city) + ', Germany</small>' : '') + '</div>';
      if (locked) {
        return '<li>' + head + '<p class="pk">Programmes open with a package — <a href="/#packages">see the packages</a>.</p></li>';
      }
      const named = rows.filter(p => !isHiddenRow(p) && progPath(u, p)).sort((a, b) => String(a.program).localeCompare(String(b.program)));
      const shown = named.slice(0, MAX_NAMED);
      return '<li>' + head + (shown.length ? '<ul>' + shown.map(p => '<li><a href="' + esc(progPath(u, p)) + '">' + esc(p.program) + '</a></li>').join('')
        + (named.length > shown.length ? '<li><a href="/university/' + esc(u.slug) + '#programmes">More at ' + esc(u.shortName || u.name) + '</a></li>' : '') + '</ul>' : '') + '</li>';
    }).join('');
    const others = [...cat.pages.values()].filter(o => o.hits.length && o.g.path !== path && (o.g.group === g.group || o.g.group !== 'Deadlines'))
      .slice(0, 14).map(o => '<li><a href="' + esc(guideUrl(o.g.path)) + '">' + esc(o.g.title) + '</a></li>').join('');
    const body = '<p class="g-answer">' + esc(intro) + '</p>'
      + '<div class="g-cta"><a class="btn btn-primary" href="' + esc(findHref(g)) + '">See them on Find University</a>'
      + '<a class="btn btn-ghost" href="/#counsel">Check your fit — free counselling</a></div>'
      + '<h2 id="universities">Universities that fit</h2>'
      + '<p>Public universities in Germany are listed by name; their programme names, fees and deadlines open with a Glovels package. '
      + 'Private universities\' programmes link to their own pages.</p>'
      + '<ul class="g-unis">' + list + '</ul>'
      + faqHtml(qa)
      + '<div class="g-box"><b>Not sure which of these you clear?</b> A counsellor reads your marksheets and tests and tells you, free. '
      + '<a href="/#counsel">Book free counselling</a> · <a href="' + esc(findHref(g)) + '">Filter them on Find University</a></div>'
      + (others ? '<h2>More Germany master\'s guides</h2><ul class="g-hub">' + others + '<li><a href="/germany-masters-guides">All guides</a></li></ul>' : '');
    const crumbs = HUB_CRUMBS.concat([[g.title, guideUrl(path)]]);
    return {
      lastmod: pg.lastmod,
      html: render({
        title: g.title + ' — universities & how to apply', desc: g.desc, canonical: guideUrl(path), h1: g.title,
        eyebrow: 'Study in Germany', chips: [["Master's", 'in Germany'], [g.short, 'guide']],
        dateline: "Germany master's guide · updated from our live catalogue", crumbs, body,
        jsonld: faqLd(qa), extraLd: [crumbsLd(crumbs)],
        keywords: [g.title, 'study in Germany', 'masters in Germany', 'Indian students'].join(', '),
      }),
    };
  }

  function hubPage() {
    const cat = catalogue();
    const live = [...cat.pages.values()].filter(p => p.hits.length);
    if (!live.length) return null;
    const groups = [['Requirements', 'By requirement'], ['Fees', 'By fees'], ['Branch', 'By your bachelor\'s branch'], ['Deadlines', 'By application deadline month']];
    const body = '<p class="g-answer">Our guides to a master\'s in Germany for Indian students — without IELTS, with a 3-year bachelor\'s, tuition-free, '
      + 'with a low CGPA, taught in English, by deadline month and by your B.Tech branch — each built from our live catalogue of German universities.</p>'
      + groups.map(([k, h]) => {
        const items = live.filter(p => p.g.group === k);
        return items.length ? '<h2>' + esc(h) + '</h2><ul class="g-hub">' + items.map(p => '<li><a href="' + esc(guideUrl(p.g.path)) + '">' + esc(p.g.title) + '</a></li>').join('') + '</ul>' : '';
      }).join('')
      + '<div class="g-box"><a href="/find-university?country=DE&amp;level=master">Find University — every master\'s in Germany, filtered</a> · '
      + '<a href="/study-in-germany">Study in Germany</a> · <a href="/#counsel">Free counselling</a></div>';
    return {
      lastmod: live.map(p => p.lastmod).filter(Boolean).sort().pop() || '',
      html: render({
        title: "Germany master's guides for Indian students", desc: "Master's in Germany without IELTS, with a 3-year bachelor's, tuition-free, low CGPA, English-taught, by deadline month and by branch — guides from our live catalogue.",
        canonical: '/germany-masters-guides', h1: "Germany master's guides", eyebrow: 'Study in Germany', chips: [["Master's", 'in Germany'], ['Guides', 'for Indian students']],
        dateline: 'Built from our live catalogue', crumbs: HUB_CRUMBS, body,
        jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: "Germany master's guides", url: absolute('/germany-masters-guides'),
          hasPart: live.map(p => ({ '@type': 'WebPage', name: p.g.title, url: absolute(guideUrl(p.g.path)) })) },
        extraLd: [crumbsLd(HUB_CRUMBS)],
      }),
    };
  }

  /* --------------------------------------------------- programme page */

  const SEASON = s => cap(String(s || ''));
  function teaching(p) {
    const g = String(reqsOf(p).germanLevel || '').trim();
    if (/^none$/i.test(g)) return 'English';
    if (/^[ABC][12]$/i.test(g)) return /^(B2|C1|C2)$/i.test(g) ? 'German (' + g.toUpperCase() + ' required)' : 'English (German ' + g.toUpperCase() + ' asked for)';
    if (hasStored(p, 'No German Required')) return 'English';
    return String(p.country).toUpperCase() === 'DE' ? 'Ask a counsellor' : 'English';
  }
  function feeWords(p) {
    if (feeIndicative(p)) return 'Fee on request';
    const tot = Number(p.totalInr) || 0, t = num(reqsOf(p).tuitionEurSem);
    if (t === 0) return 'No tuition fee';
    if (tot > 0) return UNIS.money(tot) + ' total' + (t ? ' (€' + t.toLocaleString('en-IN') + ' a semester)' : '');
    if (t) return '€' + t.toLocaleString('en-IN') + ' a semester';
    return 'To be confirmed';
  }
  function requirements(p, c) {
    const r = reqsOf(p), out = [];
    const eng = [];
    if (num(r.ieltsMin) != null) eng.push('IELTS ' + num(r.ieltsMin).toFixed(1));
    if (num(r.toeflMin) != null) eng.push('TOEFL iBT ' + num(r.toeflMin));
    out.push(['English', (eng.length ? eng.join(' or ') : 'Score not stated') + (moiOk(p) ? '; a Medium of Instruction (MOI) letter is accepted instead' : '')]);
    if (num(p.minCgpa) != null) out.push(['Grades', 'CGPA ' + num(p.minCgpa).toFixed(1) + '+ on 10']);
    else if (num(p.germanGpa) != null) out.push(['Grades', 'German grade ' + num(p.germanGpa).toFixed(1) + ' or better (1.0 is best)']);
    else {
      const bar = num(p.isPublic ? (c || {}).minCgpaPublic : (c || {}).minCgpaPrivate);
      out.push(['Grades', bar != null ? 'Not stated — CGPA ' + bar + '+ on 10 is the usual bar' : 'Assessed on your profile']);
    }
    const bach = [];
    if (num(r.ectsMin) != null) bach.push(num(r.ectsMin) + ' ECTS');
    if (num(r.bachelorYears) != null) bach.push(num(r.bachelorYears) + '-year bachelor\'s');
    if (threeYear(p)) bach.push('3-year bachelor\'s accepted');
    else if (r.threeYearOk === 'maybe') bach.push('3-year bachelor\'s: case by case');
    if (r.bachelorSubjects) bach.push('in ' + r.bachelorSubjects);
    if (bach.length) out.push(["Bachelor's", bach.join('; ')]);
    if (r.greRequired === true) out.push(['GRE', 'Required' + (num(r.greMin) != null ? ', ' + num(r.greMin) + '+' : '')
      + (num(r.greQuant) != null ? '; Quant ' + num(r.greQuant) + '+' : '') + (num(r.greVerbal) != null ? '; Verbal ' + num(r.greVerbal) + '+' : '')]);
    else if (r.greRequired === false) out.push(['GRE', 'Not required']);
    if (r.germanLevel) out.push(['German', /^none$/i.test(r.germanLevel) ? 'None needed for admission' : 'Level ' + String(r.germanLevel).toUpperCase()]);
    if (r.workExpRequired === true || num(r.workExpMonths)) out.push(['Work experience', num(r.workExpMonths) ? num(r.workExpMonths) + ' months' : 'Required']);
    if (r.papersRequired === true) out.push(['Publications', 'Required']);
    if (r.restricted === true) out.push(['Admission', 'Restricted — applicants are ranked']);
    if (num(r.topPercent) != null) out.push(['Class rank', 'Top ' + num(r.topPercent) + '% of the class']);
    return out;
  }
  const ROUTES = { 'uni-assist': 'Through uni-assist', 'vpd': 'uni-assist VPD, then the university', 'portal': "The university's own online portal",
    'precheck': 'uni-assist pre-check', 'rolling admission': 'Rolling admission — applications are read as they arrive' };
  function routeOf(p, free) {
    const t = tagSet(p);
    const via = Object.keys(ROUTES).filter(k => t.has(T.fold(k))).map(k => ROUTES[k]);
    return (via.length ? via.join('; ') + '. ' : '')
      + (free ? 'Applying through Glovels is free here — we are affiliated with the university and file it for you.'
        : 'A Glovels counsellor files it as part of a package: SOP, documents, the application and every follow-up.');
  }

  function programmePage(uniSlug, progSlug) {
    const u = d.universityOf(uniSlug);
    if (!u || isLockedUni(u)) return null;
    let p = null;
    for (const [id, s] of slugTable(u)) if (s === progSlug) { p = u.programmes.find(q => String(q.id) === id); break; }
    if (!p || isHiddenRow(p)) return null;
    const countries = d.liveCountries();
    const c = countries[u.country] || { name: u.country };
    const level = UNIS.levelOf(p.level);
    const free = (p.feeModel === 'free' || p.feeModel === 'package' ? p.feeModel : (p.isPublic ? 'package' : 'free')) === 'free';
    const city = p.city || u.city;
    const dl = (p.intakes || []).filter(i => i && i.season);
    const intakeWords = dl.length ? dl.map(i => SEASON(i.season) + ' intake' + (i.deadline ? ', apply by ' + dayMonth(i.deadline) : '')).join('; ') : 'Ask a counsellor';
    const fee = feeWords(p);
    const lang = teaching(p);
    const awb = awardingBody(p);
    const x = u.extras || {};
    const official = x.website || u.url || '';
    const url_ = '/university/' + u.slug + '/' + progSlug;
    const answer = p.program + ' is a ' + level.replace(/'s$/, "'s") + ' programme at ' + u.name + (city ? ' in ' + city : '') + ', ' + c.name + ', taught in '
      + (/^English/.test(lang) ? 'English' : /^German/.test(lang) ? 'German' : 'English or German (ask a counsellor)') + '. '
      + (fee === 'Fee on request' || fee === 'To be confirmed' ? 'Ask a counsellor for the current fee' : 'Fee: ' + fee)
      + (dl.length ? '; ' + dl.map(i => SEASON(i.season).toLowerCase() + ' intake' + (i.deadline ? ' (apply by ' + dayMonth(i.deadline) + ')' : '')).join(' and ') : '') + '.'
      + (awb ? ' The degree is awarded by ' + awb + '.' : '');
    const facts = [
      ['Degree', level], ['Teaching language', lang], ['City', (city ? city + ', ' : '') + c.name],
      UNIS.typeLabel(u) ? ['University', UNIS.typeLabel(u) + ' university'] : null, ['Intakes & deadlines', intakeWords],
      ['Fee', fee], ['Applying through Glovels', free ? 'Free — we are affiliated' : 'With a package'],
      awb ? ['Degree awarded by', awb] : null,
      p.field ? ['Field', p.field] : null,
    ].filter(Boolean);
    const reqs = requirements(p, c);
    const anchor = UNIS.slugOf(p.program);
    const body = '<p class="g-answer">' + esc(answer) + '</p>'
      + '<div class="factbox">' + facts.map(f => '<div><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b></div>').join('') + '</div>'
      + '<h2>Requirements</h2><ul class="g-req">' + reqs.map(r => '<li><b>' + esc(r[0]) + ':</b> ' + esc(r[1]) + '</li>').join('') + '</ul>'
      + '<h2>How to apply</h2><p>' + esc(routeOf(p, free)) + '</p>'
      + '<div class="g-cta"><a class="btn btn-primary" href="/#counsel">Check your fit — free counselling</a>'
      + (free ? '<button type="button" class="btn btn-gold" data-apply="' + esc(p.id) + '" data-fee="free" data-uni="' + esc(u.name) + '" data-prog="' + esc(p.program) + '">Apply free</button>'
        : '<a class="btn btn-gold" href="/university/' + esc(u.slug) + '#' + esc(anchor) + '">Apply</a>')
      + '<a class="btn btn-ghost" href="/find-university?country=' + esc(encodeURIComponent(u.country)) + '&amp;level=' + esc(encodeURIComponent(String(p.level || 'master').toLowerCase()))
        + (p.field ? '&amp;field=' + esc(encodeURIComponent(p.field)) : '') + '">Similar programmes</a></div>'
      + (/^https?:\/\//i.test(String(p.url || '')) ? '<p><a href="' + esc(p.url) + '" target="_blank" rel="noopener nofollow">The course on the university\'s site ↗</a></p>' : '')
      + '<p style="margin-top:22px"><a class="btn btn-ghost" href="/university/' + esc(u.slug) + '#' + esc(anchor) + '">All programmes at ' + esc(u.shortName || u.name) + '</a></p>';
    const offer = (() => {
      if (feeIndicative(p)) return undefined;
      const t = num(reqsOf(p).tuitionEurSem), tot = Number(p.totalInr) || 0;
      if (t === 0) return { '@type': 'Offer', category: 'Free', price: 0, priceCurrency: 'EUR' };
      if (tot > 0) return { '@type': 'Offer', category: 'Paid', price: tot, priceCurrency: 'INR' };
      return undefined;
    })();
    const course = {
      '@context': 'https://schema.org', '@type': 'Course', name: p.program, description: answer, url: absolute(url_),
      provider: { '@type': 'CollegeOrUniversity', name: u.name, url: official || absolute('/university/' + u.slug),
        address: { '@type': 'PostalAddress', addressLocality: city || undefined, addressCountry: u.country } },
      educationalLevel: level, educationalCredentialAwarded: level + (awb ? ' (awarded by ' + awb + ')' : ''),
      inLanguage: /^German/.test(lang) ? 'de' : 'en',
      hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'Onsite', location: (city ? city + ', ' : '') + c.name },
      offers: offer,
    };
    const crumbs = [['Home', '/'], ['Universities', '/university'], [u.shortName || u.name, '/university/' + u.slug], [p.program, url_]];
    return {
      noindex: !!x.hidden,
      html: render({
        title: p.program + ' at ' + (u.shortName || u.name) + ' — fees, deadlines & requirements',
        desc: p.program + ' at ' + u.name + (city ? ', ' + city : '') + ': ' + lang.toLowerCase() + '-taught ' + level + ', ' + fee.toLowerCase() + ', intakes, IELTS/MOI, CGPA and how to apply from India.',
        canonical: url_, h1: p.program, eyebrow: 'Study in ' + c.name, chips: [[level, 'programme'], [city || c.name, city ? c.name : 'study abroad']],
        dateline: level + ' · ' + u.name + (city ? ', ' + city : ''), crumbs, body,
        jsonld: course, extraLd: [crumbsLd(crumbs)], indexable: !x.hidden,
        keywords: [p.program, u.name, city, c.name, 'fees', 'admission', 'Indian students'].filter(Boolean).join(', '),
        tail: d.uniJs ? d.uniJs() : '',
      }),
    };
  }

  /* ------------------------------------------- the university page */

  /** The first paragraph: what the university is, where, and what you can study (fields only). */
  function uniAnswer(u, c) {
    const fields = (u.fields || []).filter(f => f && f !== 'Other');
    const lv = (u.levels || []).map(l => l.replace(/'s$/, "'s")).join(', ').replace(/, ([^,]*)$/, ' and $1');
    return '<p class="g-answer">' + esc(u.name + ' is a ' + (UNIS.typeLabel(u) ? UNIS.typeLabel(u).toLowerCase() + ' ' : '') + 'university' + (u.city ? ' in ' + u.city : '') + ', ' + c.name
      + (lv ? ', where Indian students can apply for ' + lv + ' programmes' : '') + (u.tuitionFree && u.isPublic ? ', many with no tuition fee' : '') + '.') + '</p>'
      + (fields.length ? '<p class="g-subjects"><b>Subjects you can study:</b> ' + esc(fields.slice(0, 12).join(', ')) + '</p>' : '');
  }

  /** FAQ about one university, in general terms from its rows. Never a name or a count. */
  function uniFaq(u, c) {
    const nm = u.shortName || u.name;
    const ms = u.programmes.filter(p => String(p.level || '').toLowerCase() === 'master');
    const set = ms.length ? ms : u.programmes;
    const what = ms.length ? "master's programmes" : 'programmes';
    const n = set.length || 1;
    const locked = isLockedUni(u);
    const qa = [];
    /* IELTS */
    const ielts = set.map(p => num(reqsOf(p).ieltsMin)).filter(v => v != null);
    const moi = set.filter(moiOk).length;
    const lo = ielts.length ? Math.min(...ielts) : null, hi = ielts.length ? Math.max(...ielts) : null;
    qa.push(['Does ' + u.name + ' require IELTS for ' + (ms.length ? "master's" : 'admission') + '?',
      (ielts.length ? cap(share(ielts.length, n)) + ' of its ' + what + ' state an IELTS score' + (lo === hi ? ' of ' + lo.toFixed(1) : ', from ' + lo.toFixed(1) + ' to ' + hi.toFixed(1)) + ' overall (or TOEFL)'
        : 'Its ' + what + ' do not state an IELTS score in our catalogue; a counsellor confirms the English test each one takes')
      + '. ' + (moi ? cap(share(moi, n)) + ' accept a Medium of Instruction (MOI) letter instead, so you can apply without IELTS.' : 'We have no programme here on record as accepting an MOI letter instead.')]);
    /* Tuition */
    const known = set.filter(p => !feeIndicative(p) && (num(reqsOf(p).tuitionEurSem) != null || Number(p.totalInr) > 0 || p.isPublic));
    const free = known.filter(noTuition).length;
    const fees = locked ? [] : set.filter(p => !feeIndicative(p) && Number(p.totalInr) > 0).map(p => Number(p.totalInr));
    qa.push(['Is ' + u.name + ' tuition-free?',
      free && free === known.length ? 'Yes — its ' + what + ' charge no tuition fee. You pay a semester contribution and your living costs.'
        : free ? cap(share(free, known.length)) + ' of its ' + what + ' charge no tuition fee; others do. You pay a semester contribution and your living costs either way.'
          : (UNIS.typeLabel(u) !== 'Private' ? 'Its ' + what + ' charge tuition' : 'No — ' + nm + ' is a private university, so its ' + what + ' charge tuition')
            + (fees.length ? ', from ' + UNIS.money(Math.min(...fees)) + ' for the whole course' : '') + '. A counsellor gives you the current fee.']);
    /* Intakes */
    const months = { winter: new Set(), summer: new Set() };
    set.forEach(p => (p.intakes || []).forEach(i => {
      const se = /summer|spring/i.test(String((i && i.season) || '')) ? 'summer' : 'winter';
      const m = /^\d{4}-(\d{2})/.exec(String((i && i.deadline) || ''));
      if (i && i.season) months[se].add(m ? Number(m[1]) - 1 : -1);
    }));
    const sw = ['winter', 'summer'].filter(s => months[s].size).map(s => {
      const ms2 = [...months[s]].filter(k => k >= 0).sort((a, b) => a - b).map(k => MONTHS[k]);
      return s + ' intake (starting in ' + (s === 'winter' ? 'October' : 'April') + ')' + (ms2.length ? ', with deadlines in ' + listWords(ms2) : '');
    });
    qa.push(['Which intakes does ' + u.name + ' offer?', sw.length ? cap(nm) + ' offers the ' + sw.join('; and the ') + '. The exact date differs by programme.' : 'Ask a counsellor — the intakes are not stated in our catalogue.']);
    /* 3-year */
    const three = set.filter(threeYear).length;
    const four = set.filter(p => !threeYear(p) && ((num(reqsOf(p).ectsMin) || 0) > 180 || (num(reqsOf(p).bachelorYears) || 0) >= 4)).length;
    qa.push(["Can I apply to " + u.name + " with a 3-year bachelor's?",
      three ? 'Yes — ' + share(three, n) + ' of its ' + what + ' accept a 3-year bachelor\'s (180 ECTS).' + (three < n ? ' Others ask for a 4-year degree, so a counsellor checks each one.' : '')
        : four ? 'Its ' + what + ' ask for a 4-year bachelor\'s (210–240 ECTS) where they say; a 3-year degree usually needs a master\'s year or a bridge first.'
          : 'Not stated in our catalogue. ' + (c.degreeRule ? c.degreeRule : 'A counsellor checks your degree against each programme.')]);
    /* CGPA */
    const cg = set.map(p => num(p.minCgpa)).filter(v => v != null);
    const gg = set.map(p => num(p.germanGpa)).filter(v => v != null);
    const bar = num(u.isPublic ? c.minCgpaPublic : c.minCgpaPrivate);
    qa.push(['What CGPA do I need for ' + u.name + '?',
      (cg.length ? 'Where a CGPA is stated, it is ' + Math.min(...cg).toFixed(1) + (Math.max(...cg) > Math.min(...cg) ? ' to ' + Math.max(...cg).toFixed(1) : '') + ' or more on 10. ' : '')
      + (gg.length ? 'Where a German grade is stated, it is ' + Math.min(...gg).toFixed(1) + (Math.max(...gg) > Math.min(...gg) ? ' to ' + Math.max(...gg).toFixed(1) : '') + ' or better (1.0 is best; your CGPA converts with the Bavarian formula). ' : '')
      + (!cg.length && !gg.length ? (bar != null ? 'No bar is stated; a CGPA of ' + bar + '+ on 10 is the usual bar for a ' + (UNIS.typeLabel(u) ? UNIS.typeLabel(u).toLowerCase() + ' ' : '') + 'university in ' + c.name + '. ' : 'It is assessed on your whole profile. ') : '')
      + 'A free counselling call checks your marks against each programme.']);
    return { html: faqHtml(qa, 'Questions about ' + nm), ld: faqLd(qa) };
  }

  /* ------------------------------------------------ routes & links */

  const LANDING_RE = /^\/(masters-in-germany-without-ielts|germany-3-year-bachelor-accepted|tuition-free-masters-germany|low-cgpa-masters-germany|english-taught-masters-germany-no-german|germany-masters-deadlines\/[a-z]{3,9}|masters-in-germany-for\/[a-z]{2,20})\/?$/;
  /** { html, key, noindex } | { redirect } | { status: 404 } | null (not ours). */
  function route(pathname) {
    if (pathname === '/germany-masters-guides' || pathname === '/germany-masters-guides/') {
      if (pathname.endsWith('/')) return { redirect: '/germany-masters-guides' };
      const h = hubPage();
      return h ? { html: h.html, key: 'guide__hub' } : { status: 404 };
    }
    if (pathname === '/germany-masters-deadlines' || pathname === '/masters-in-germany-for') return { redirect: '/germany-masters-guides' };
    const m = LANDING_RE.exec(pathname);
    if (m) {
      if (pathname.endsWith('/')) return { redirect: pathname.slice(0, -1) };
      const pg = landingPage(m[1]);
      return pg ? { html: pg.html, key: 'guide__l-' + m[1].replace(/\//g, '--') } : { status: 404 };
    }
    const pm = /^\/university\/([a-z0-9-]{1,90})\/([a-z0-9-]{1,130})\/?$/.exec(pathname);
    if (pm) {
      if (pathname.endsWith('/')) return { redirect: pathname.slice(0, -1) };
      const pg = programmePage(pm[1], pm[2]);
      return pg ? { html: pg.html, key: 'guide__p-' + pm[1] + '--' + pm[2], noindex: pg.noindex } : { status: 404 };
    }
    return null;
  }
  /** The page behind a script key (serve.js scriptFile, after a restart). */
  function rebuild(key) {
    if (key === 'guide__hub') { const h = hubPage(); return h ? h.html : null; }
    if (key.startsWith('guide__l-')) { const pg = landingPage(key.slice(9).replace(/--/g, '/')); return pg ? pg.html : null; }
    if (key.startsWith('guide__p-')) { const [a, b] = key.slice(9).split('--'); const pg = programmePage(a, b); return pg ? pg.html : null; }
    return null;
  }

  /** Sitemap entries: [{ path, lastmod }] — non-empty landing pages, the hub, named programmes. */
  function sitemapEntries() {
    const cat = catalogue();
    const out = [];
    const live = [...cat.pages.values()].filter(p => p.hits.length);
    if (live.length) out.push({ path: 'germany-masters-guides', lastmod: live.map(p => p.lastmod).filter(Boolean).sort().pop() || '' });
    live.forEach(p => out.push({ path: p.g.path, lastmod: p.lastmod }));
    cat.unis.forEach(u => {
      if (isLockedUni(u)) return;
      for (const [id, s] of slugTable(u)) out.push({ path: 'university/' + u.slug + '/' + s, lastmod: cat.stamp.get(id) || '' });
    });
    /* Patch 179: every other country's named programmes, one university at a
       time — never the whole catalogue in memory at once. */
    try {
      const seen = new Set(cat.unis.map(u => u.slug));
      const mods = typeof db.uniLastmods === 'function' ? db.uniLastmods() : new Map();
      const hidden = d.hiddenUniversitySlugs ? d.hiddenUniversitySlugs() : new Set();
      const slugs = typeof db.uniSlugs === 'function' ? db.uniSlugs({}) : [];
      for (const slug of slugs) {
        if (seen.has(slug) || hidden.has(slug)) continue;
        const u = d.universityOf ? d.universityOf(slug) : null;
        if (!u || String(u.country).toUpperCase() === 'DE' || isLockedUni(u)) continue;
        const lm = mods.get(slug) || '';
        for (const [, s] of slugTable(u)) out.push({ path: 'university/' + u.slug + '/' + s, lastmod: lm });
      }
    } catch (e) { /* the guides and German pages are listed; the rest wait */ }
    return out;
  }
  const hubLive = () => { try { return [...catalogue().pages.values()].some(p => p.hits.length); } catch (e) { return false; } };
  /** The hub in the footer (beside "All universities") and on /study-in-germany. */
  function withLinks(html, slug) {
    if (!hubLive() || html.indexOf('germany-masters-guides') >= 0) return html;
    let out = html.replace(/(<a href="((?:\.\.\/|\/)?)university">All universities<\/a>)(<\/div>)/,
      (m, a, pre, end) => a + '<a href="' + (pre === '../' ? '../' : '/') + 'germany-masters-guides">Germany master\'s guides</a>' + end);
    if (slug === 'study-in-germany') {
      const box = '<div class="wrap" style="margin-top:22px"><div style="padding:14px 18px;border-radius:12px;background:#eef3fc;border:1px solid #b9cdf0;font:400 14px/1.65 var(--sans)">'
        + '<b>Germany master\'s guides:</b> <a href="/masters-in-germany-without-ielts">without IELTS</a> · <a href="/germany-3-year-bachelor-accepted">3-year bachelor\'s</a> · '
        + '<a href="/tuition-free-masters-germany">tuition-free</a> · <a href="/low-cgpa-masters-germany">low CGPA</a> · <a href="/english-taught-masters-germany-no-german">English-taught</a> · '
        + '<a href="/germany-masters-guides">by branch and deadline month</a></div></div>';
      const i = out.indexOf('<div class="cta-band">');
      const j = i >= 0 ? i : out.indexOf('<footer');
      if (j >= 0) out = out.slice(0, j) + box + '\n' + out.slice(j);
    }
    return out;
  }
  /** The llms.txt lines for the guides. */
  function llmsLines() {
    const base = absolute('');
    return [...catalogue().pages.values()].filter(p => p.hits.length).map(p => '- [' + p.g.title + '](' + base + '/' + p.g.path + ')');
  }

  return { css: GUIDE_CSS, route, rebuild, sitemapEntries, withLinks, progTitleLink, progPath, slugTable, uniAnswer, uniFaq, llmsLines,
    GUIDE_PAGES, isHiddenRow, isLockedUni, landingPage, hubPage, programmePage };
}

module.exports = { makeGuides, BRANCHES, MONTHS, isHiddenRow, isLockedUni };
