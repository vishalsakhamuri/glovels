#!/usr/bin/env node
/**
 * A synthetic catalogue at the LIVE site's scale, written straight into a
 * data directory's SQLite file through server/store.js — the same
 * saveProgramme() the import route ends in, so the schema, the full-text
 * index and the derived columns (uni_slug, fee_model, band) are exactly what
 * the office's uploads produce. The import route itself was not used because
 * it checks and previews every row (23 uploads of 3,000 rows take minutes);
 * this writes 68,000 rows in one transaction in about a minute.
 *
 *   node tests/bigcat.js /tmp/db-8241            # build into a data dir
 *   BIGCAT_SCALE=1 node tests/bigcat.js DIR       # the live split as stated (~49k)
 *   require('./bigcat.js').build(dir, { scale })  # from a test
 *
 * The split (scale 1): UK 13,000 · USA 25,000 · Canada 4,500 · Ireland 2,500
 * · Australia 1,100 · Germany 1,900 (160 public universities) · France 700 ·
 * PL/ES/IT ~100 each. The default scale (1.4) brings the total to ~68,000,
 * the number live reports. UK/US universities carry 60–600 programmes each,
 * like the agent-portal imports do; ~30 % of them are search-only (reached
 * from Google and the search box, not the lists). Programme names are long
 * and realistic, fields follow the ~46 catalogue fields in
 * server/matches.js FIELD_WORDS with a weight towards business, computing
 * and data, agent-portal rows carry indicative fees and no intakes (as the
 * live ones do), German rows carry intakes, a German grade and ECTS.
 *
 * Deterministic: the same seed gives the same catalogue.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const STORE = require(path.join(ROOT, 'server/store.js'));
const SEED = require(path.join(ROOT, 'server/seed.js'));
const { FIELD_WORDS } = require(path.join(ROOT, 'server/matches.js'));

/* A small, fast, seedable PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FIELDS = FIELD_WORDS.map(f => f[0]);
/* How often each field turns up — business, computing and data dominate an
   agent portal's catalogue; the rest share the tail. */
const FIELD_WEIGHT = {
  'Business & Management': 14, 'Computer Science & IT': 9, 'Data Science, AI & Machine Learning': 8,
  'Finance, Banking & Accounting': 6, 'Marketing & Digital Media': 4, 'MBA': 4, 'Engineering': 0,
  'Mechanical & Automotive Engineering': 4, 'Electrical & Electronics Engineering': 4, 'Civil & Construction Engineering': 3,
  'Medicine, Dentistry & Allied Health': 3, 'Public Health & Healthcare Management': 4, 'Nursing & Allied Health Sciences': 3,
  'Psychology': 3, 'Law & Legal Studies': 3, 'Arts & Design': 3, 'Media & Communication': 2, 'Education & Teaching': 3,
  'Biotechnology & Bioinformatics': 2, 'Cybersecurity & Cloud': 3, 'Environmental Science & Sustainability': 2,
  'International Relations & Public Policy': 2, 'Social Sciences & Social Work': 2, 'Humanities & Languages': 2,
  'Natural Sciences (Physics, Chemistry, Maths)': 2, 'Economics': 2, 'Hospitality, Tourism & Events': 2,
  'Supply Chain, Logistics & Operations': 2, 'Sport & Exercise Science': 1,
};
const FIELD_POOL = [];
FIELDS.forEach(f => { const w = FIELD_WEIGHT[f] == null ? 1 : FIELD_WEIGHT[f]; for (let i = 0; i < w; i++) FIELD_POOL.push(f); });

/* Programme-name parts per field, so "Data Science" rows really say so. */
const TOPIC = {
  'Computer Science & IT': ['Computer Science', 'Software Engineering', 'Information Technology', 'Computing', 'Advanced Computer Science', 'Web Development', 'Human-Computer Interaction'],
  'Data Science, AI & Machine Learning': ['Data Science', 'Artificial Intelligence', 'Machine Learning', 'Data Analytics', 'Business Analytics', 'Big Data Technologies', 'Data Science and Artificial Intelligence'],
  'Cybersecurity & Cloud': ['Cyber Security', 'Cloud Computing', 'Network Engineering', 'Information Security', 'Digital Forensics'],
  'Business & Management': ['Business Management', 'International Business', 'Management', 'Business Administration', 'Project Management', 'Human Resource Management', 'International Business Management'],
  'MBA': ['Business Administration', 'Global MBA', 'Executive MBA'],
  'Finance, Banking & Accounting': ['Finance', 'Accounting and Finance', 'Banking and Finance', 'Financial Technology', 'Investment Management', 'International Finance'],
  'Marketing & Digital Media': ['Marketing', 'Digital Marketing', 'Marketing Management', 'Brand Management', 'Strategic Marketing'],
  'Medicine, Dentistry & Allied Health': ['Biomedical Science', 'Clinical Sciences', 'Physiotherapy', 'Dental Hygiene', 'Medical Sciences'],
  'Public Health & Healthcare Management': ['Public Health', 'Global Health', 'Healthcare Management', 'Health Administration', 'Epidemiology'],
  'Nursing & Allied Health Sciences': ['Nursing', 'Adult Nursing', 'Mental Health Nursing', 'Allied Health Practice'],
  'Psychology': ['Psychology', 'Applied Psychology', 'Clinical Psychology', 'Forensic Psychology'],
  'Law & Legal Studies': ['Law', 'International Commercial Law', 'Legal Studies', 'Human Rights Law'],
  'Arts & Design': ['Graphic Design', 'Fine Art', 'Interior Architecture', 'Product Design', 'Illustration'],
  'Education & Teaching': ['Education', 'TESOL', 'Educational Leadership', 'Early Childhood Education'],
};
const PREFIX = { bachelor: ['BSc (Hons)', 'BA (Hons)', 'BEng (Hons)', 'Bachelor of Science in', 'Bachelor of Arts in', 'LLB (Hons)'],
  master: ['MSc', 'MA', 'MEng', 'Master of Science in', 'Master of Arts in', 'LLM', 'MRes', 'Master of'],
  mba: ['MBA', 'MBA in', 'Master of Business Administration -'], phd: ['PhD in', 'Doctor of Philosophy in'],
  diploma: ['Postgraduate Diploma in', 'Graduate Diploma in', 'Diploma in'], foundation: ['International Foundation Year in', 'Pre-Masters in'] };
const SUFFIX = ['', '', '', '', ' (with Placement Year)', ' (with Industrial Placement)', ' - Online', ' (Top-up)', ' (Conversion)', ' with Foundation Year', ' (Advanced Practice)', ' - September Intake', ' (2 Years, Co-op)', ' (Thesis)', ' (Course-based)'];

const CITIES = {
  GB: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Edinburgh', 'Bristol', 'Sheffield', 'Nottingham', 'Liverpool', 'Coventry', 'Cardiff', 'Newcastle upon Tyne', 'Leicester', 'Portsmouth', 'Brighton', 'Southampton', 'Exeter', 'Lincoln', 'Huddersfield', 'Bradford', 'Sunderland', 'Wolverhampton', 'Derby', 'Plymouth', 'Aberdeen', 'Dundee', 'Belfast', 'Canterbury', 'York'],
  US: ['New York', 'Boston', 'Chicago', 'Los Angeles', 'San Francisco', 'Seattle', 'Austin', 'Dallas', 'Houston', 'Atlanta', 'Miami', 'Philadelphia', 'Pittsburgh', 'Columbus', 'Phoenix', 'Denver', 'Minneapolis', 'St. Louis', 'Kansas City', 'Baltimore', 'San Diego', 'Portland', 'Raleigh', 'Tampa', 'Detroit', 'Cleveland', 'Indianapolis', 'Nashville', 'Buffalo', 'Sacramento'],
  CA: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton', 'Winnipeg', 'Halifax', 'Hamilton', 'Waterloo', 'Kingston', 'Regina', 'Saskatoon', 'Victoria', 'London (Ontario)'],
  IE: ['Dublin', 'Cork', 'Galway', 'Limerick', 'Waterford', 'Maynooth', 'Dundalk', 'Athlone', 'Letterkenny', 'Carlow'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Hobart', 'Newcastle', 'Wollongong'],
  DE: ['Berlin', 'München', 'Hamburg', 'Köln', 'Frankfurt am Main', 'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dresden', 'Hannover', 'Nürnberg', 'Bremen', 'Aachen', 'Karlsruhe', 'Freiburg', 'Heidelberg', 'Darmstadt', 'Mannheim', 'Bonn', 'Münster', 'Kiel', 'Jena', 'Ulm', 'Bochum', 'Dortmund', 'Essen', 'Mainz', 'Regensburg', 'Würzburg', 'Göttingen'],
  FR: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Lille', 'Bordeaux', 'Nantes', 'Grenoble', 'Nice', 'Strasbourg', 'Rennes', 'Montpellier'],
  PL: ['Warsaw', 'Kraków', 'Wrocław', 'Poznań', 'Gdańsk', 'Łódź'],
  ES: ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 'Granada'],
  IT: ['Milano', 'Roma', 'Torino', 'Bologna', 'Firenze', 'Padova'],
};
const UNI_SHAPES = {
  GB: ['University of {c}', '{c} Metropolitan University', '{c} City University', 'University of West {c}', '{c} Hallam University', 'Royal {c} College', '{c} Trinity University', 'University of {c} Business School', '{c} University London', 'Queen {c} University', 'University of East {c}', '{c} John Moores University', 'St {c} University', '{c} Napier University'],
  US: ['University of {c}', '{c} State University', '{c} University', 'University of Southern {c}', '{c} Institute of Technology', 'Northern {c} University', '{c} College', 'University of {c} at {c2}', '{c} Pacific University', 'Western {c} University', '{c} Christian University', 'University of Central {c}', '{c} Polytechnic Institute', 'Eastern {c} University', 'Saint {c} University', '{c} International University', 'University of North {c}'],
  CA: ['University of {c}', '{c} College', '{c} Polytechnic', 'Université de {c}', '{c} University', 'College of {c}', 'Northern {c} Institute of Technology'],
  IE: ['University College {c}', 'Technological University of {c}', '{c} Institute of Technology', 'National College of {c}', '{c} Business School'],
  AU: ['University of {c}', '{c} University of Technology', 'Western {c} University', '{c} College', 'Australian {c} University'],
  DE: ['Universität {c}', 'Technische Universität {c}', 'Hochschule {c}', 'Fachhochschule {c}', 'Technische Hochschule {c}', 'Hochschule für Technik und Wirtschaft {c}', '{c} University of Applied Sciences', 'Universität {c}-Nord', 'Hochschule {c} Süd', 'Private Hochschule {c}', 'International School of Management {c}', 'Business School {c}'],
  FR: ['Université de {c}', '{c} Business School', 'École de Management de {c}', 'Institut Polytechnique de {c}', 'ESC {c}'],
  PL: ['University of {c}', '{c} University of Technology', 'Kozminski-{c} University'],
  ES: ['Universidad de {c}', '{c} Business School', 'Universidad Europea de {c}'],
  IT: ['Università di {c}', 'Politecnico di {c}', '{c} Business School'],
};
const SPLIT = { GB: 13000, US: 25000, CA: 4500, IE: 2500, AU: 1100, DE: 1900, FR: 700, PL: 100, ES: 100, IT: 100 };

/** The rows, as saveProgramme takes them — nothing written. */
function generate({ scale = 1.4, seed = 7 } = {}) {
  const R = rng(seed);
  const pick = arr => arr[Math.floor(R() * arr.length)];
  const between = (a, b) => a + Math.floor(R() * (b - a + 1));
  const rows = [];
  let n = 0;
  const taken = new Set();
  const uniName = (code, c) => {
    const cities = CITIES[code];
    for (let t = 0; t < 40; t++) {
      const name = pick(UNI_SHAPES[code]).replace('{c}', c).replace('{c2}', pick(cities));
      if (!taken.has(name)) { taken.add(name); return name; }
      c = pick(cities);
    }
    const name = 'University of ' + c + ' ' + (taken.size + 1);
    taken.add(name); return name;
  };
  const programme = (level, field) => {
    const topics = TOPIC[field] || [field.replace(/ *\(.*\)/, '').split(/ & |, /)[0]];
    let name = pick(PREFIX[level] || PREFIX.master) + ' ' + pick(topics);
    if (R() < 0.35) name += ' and ' + pick(topics);
    if (R() < 0.15) name += ' with ' + pick(['Data Analytics', 'Professional Practice', 'Entrepreneurship', 'Sustainability', 'a Year in Industry']);
    return (name + pick(SUFFIX)).replace(/\s+/g, ' ').trim();
  };
  const agentReqs = () => ({ ieltsMin: pick([6, 6, 6.5, 6.5, 7]), toeflMin: pick([79, 80, 88, 90, 100]), moiAccepted: pick(['yes', 'maybe', 'no']),
    greRequired: pick(['no', 'no', 'no', 'yes']), bachelorYears: pick([3, 3, 4]), workExpRequired: 'no', threeYearOk: pick(['yes', 'yes', 'maybe']) });
  const germanReqs = pub => ({ ieltsMin: pick([6, 6.5]), toeflMin: pick([80, 88, 90]), germanLevel: pick(['', '', 'B1', 'B2', 'C1']), ectsMin: pick([180, 180, 210]),
    tuitionEurSem: pub ? pick([0, 0, 0, 150, 300]) : pick([3900, 4500, 5900, 6900]), greRequired: 'no', bachelorYears: 3, moiAccepted: 'maybe' });

  for (const code of Object.keys(SPLIT)) {
    const want = Math.round(SPLIT[code] * scale);
    const cities = CITIES[code];
    const agent = !['DE', 'FR', 'PL', 'ES', 'IT'].includes(code);
    let got = 0, uniIx = 0;
    const dePublicUnis = Math.round(160 * Math.min(scale, 1.2));
    while (got < want) {
      const city = pick(cities);
      const name = uniName(code, city);
      const isDE = code === 'DE';
      const dePublic = isDE && uniIx < dePublicUnis;
      /* Agent-portal imports: 60–600 a university, most around 150. Germany: ~10 each. */
      const size = Math.min(want - got, agent ? Math.round(60 + Math.pow(R(), 2.2) * 540) : isDE ? between(5, 16) : between(8, 40));
      const searchOnly = agent && R() < 0.3;
      const short = R() < 0.5 ? name.split(/\s+/).filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('').slice(0, 6) : '';
      const web = 'https://www.' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + (code === 'GB' ? '.ac.uk' : code === 'US' ? '.edu' : code === 'DE' ? '.de' : '.edu');
      for (let i = 0; i < size; i++) {
        const r = R();
        const level = isDE ? (r < 0.3 ? 'bachelor' : 'master') : r < 0.33 ? 'bachelor' : r < 0.88 ? 'master' : r < 0.94 ? 'mba' : r < 0.97 ? 'phd' : 'diploma';
        const field = level === 'mba' ? 'MBA' : pick(FIELD_POOL);
        const fee = agent ? (code === 'US' ? between(1800000, 6500000) : code === 'GB' ? between(1300000, 3800000) : between(1200000, 3200000))
          : dePublic ? 0 : between(600000, 2200000);
        n++;
        rows.push({
          id: 'big-' + code.toLowerCase() + '-' + n,
          program: programme(level, field), university: name, shortName: short, city,
          country: code, level, field,
          band: fee <= 1000000 ? 'u10' : fee <= 2000000 ? 'u20' : fee <= 4000000 ? 'above20' : 'elite',
          isPublic: dePublic, fit: between(55, 95),
          minCgpa: R() < 0.4 ? pick([5.5, 6, 6, 6.5, 7, 7.5]) : null,
          germanGpa: isDE && R() < 0.5 ? pick([2.5, 2.7, 3.0, 3.0, 3.5]) : null,
          totalInr: fee, url: web + '/courses/' + n,
          /* Live: agent-portal rows carry no intake; German rows do. */
          intakes: isDE ? [{ season: 'winter', deadline: '2027-07-15' }].concat(R() < 0.4 ? [{ season: 'summer', deadline: '2027-01-15' }] : [])
            : (R() < 0.08 ? [{ season: 'winter', deadline: '' }] : []),
          active: true, featured: R() < 0.004, featureSort: 0,
          feeModel: dePublic ? 'package' : 'free', searchOnly,
          reqs: agent ? agentReqs() : germanReqs(dePublic),
          tags: R() < 0.3 ? [pick(['Scholarships', 'STEM', 'Placement year', 'January intake', 'Low IELTS', 'No GRE'])] : undefined,
          feeIndicative: agent, awardingBody: '',
        });
        got++;
      }
      uniIx++;
    }
  }
  return rows;
}

/**
 * Build the catalogue into `dir` (a data directory the server will later
 * open with DATA_DIR=dir). Seeds the shipped countries and the 171 seed
 * rows first, exactly as serve.js does on a first start, then writes the
 * big catalogue in one transaction. Returns { rows, ms, perCountry }.
 */
function build(dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const db = STORE.open(dir);
  const seedCat = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalogue.json'), 'utf8'));
  const seedCountries = JSON.parse(fs.readFileSync(path.join(ROOT, 'countries.json'), 'utf8'));
  SEED.seedCatalogue({ db, catalogue: seedCat, countries: seedCountries });
  const rows = generate(opts);
  const t0 = Date.now();
  db.transaction(() => { rows.forEach(r => db.saveProgramme(r, 'bigcat')); });
  const ms = Date.now() - t0;
  const perCountry = {};
  rows.forEach(r => { perCountry[r.country] = (perCountry[r.country] || 0) + 1; });
  if (typeof db.close === 'function') { try { db.close(); } catch (e) { /* fine */ } }
  return { rows: rows.length, ms, perCountry };
}

module.exports = { generate, build, SPLIT, FIELDS };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tests/bigcat.js <data-dir>'); process.exit(2); }
  const scale = Number(process.env.BIGCAT_SCALE) || 1.4;
  const out = build(dir, { scale });
  console.log(JSON.stringify(out));
}
