'use strict';
/*
 * /success-stories — one card per admission offer, and one per visa or
 * work-route outcome, rendered on the server from assets/success-stories.json.
 *
 * The office keeps an internal success-stories sheet and exports the PUBLIC
 * file from it: `admits` (Intake, Display name, University, Country,
 * Programme (as recorded), Degree, University (as recorded)) and `routes`
 * (Intake, Display name, Country, Route). Nothing else about a student is in
 * that file, so nothing else can reach the page — no surname, no CGPA, no
 * score, no note. That is the whole privacy position, and it is enforced by
 * what the file contains rather than by what the template leaves out.
 *
 * Two sources, in order:
 *   1. the JSON the office uploaded from Organisation → Success stories
 *      (stored in the content table under `successStories`);
 *   2. assets/success-stories.json, shipped with the site.
 * The file is re-read when its mtime changes, so a redeploy with a new file
 * shows up without a restart.
 *
 * THE ORDER OF THE CARDS is the one thing here that is not obvious, and it
 * is fixed: the office's brief wants offers mixed, no student twice within
 * any four consecutive cards (one desktop row), and the same order on every
 * load. `order()` below is a line-for-line port of build_story_single.py —
 * the script that made the prototype the office signed off — including a
 * port of Python's Mersenne Twister, so that `random.Random(2026)` here
 * draws the same numbers it drew there and the page comes out in exactly
 * the order the prototype shows. Change the rule and the acceptance
 * reference changes with it; that is why it is not "a shuffle".
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'assets', 'success-stories.json');
const KEY = 'successStories';
const SITE_PATH = '/success-stories';

const MAX_ROWS = 5000;
const MAX_STR = 240;

/* ------------------------------------------------------------ Python RNG */

/**
 * MT19937 as CPython's random module drives it: seeded through
 * init_by_array with the integer's 32-bit chunks, random() from two draws
 * (27 + 26 bits), getrandbits(k) from the top k bits of one draw, and
 * shuffle() by Fisher–Yates with _randbelow's rejection loop. Only what
 * build_story_single.py used.
 */
class PyRandom {
  constructor(seed) {
    this.mt = new Uint32Array(624);
    this.i = 625;
    const n = Math.abs(Number(seed) || 0);
    const key = [];
    let v = n;
    do { key.push(v % 4294967296); v = Math.floor(v / 4294967296); } while (v > 0);
    this.initByArray(key);
  }
  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.i = 624;
  }
  initByArray(key) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1, j = 0;
    const len = key.length;
    for (let k = Math.max(624, len); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= len) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
  }
  uint32() {
    const mt = this.mt;
    if (this.i >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = (mt[(k + 397) % 624] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0)) >>> 0;
      }
      this.i = 0;
    }
    let y = mt[this.i++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
  /** Python's random(): 53 bits from two draws. */
  random() {
    const a = this.uint32() >>> 5, b = this.uint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }
  getrandbits(k) {
    /* k ≤ 32 is all shuffle() ever asks for here (a list of under 2^32). */
    return k === 32 ? this.uint32() : this.uint32() >>> (32 - k);
  }
  randbelow(n) {
    const k = n <= 0 ? 0 : Math.floor(Math.log2(n)) + 1;   // n.bit_length()
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }
  /** In place, as Python's shuffle(): from the end, swapping with randbelow(i+1). */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
}

/* -------------------------------------------------------------- the data */

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || MAX_STR);

const ADMIT_FIELDS = ['Intake', 'Display name', 'University', 'Country',
  'Programme (as recorded)', 'Degree', 'University (as recorded)'];
const ROUTE_FIELDS = ['Intake', 'Display name', 'Country', 'Route'];

/**
 * The shape the page needs, or an Error naming the first row that lacks it.
 * Only the public fields survive — anything else in a row (a surname column
 * somebody added to the export by mistake) is dropped here, before it is
 * stored, so it can never reach the page.
 */
function clean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('The file has to be a JSON object with "admits" and "routes" lists.');
  }
  const admitsIn = raw.admits, routesIn = raw.routes;
  if (!Array.isArray(admitsIn)) throw new Error('"admits" has to be a list — one entry per admission offer.');
  if (!Array.isArray(routesIn)) throw new Error('"routes" has to be a list — one entry per visa or work-route outcome (it may be empty).');
  if (admitsIn.length > MAX_ROWS || routesIn.length > MAX_ROWS) throw new Error('That is more than ' + MAX_ROWS + ' rows, which is not a success-stories file.');
  const admits = admitsIn.map((a, i) => {
    if (!a || typeof a !== 'object') throw new Error('Admit ' + (i + 1) + ' is not an object.');
    const out = {};
    ADMIT_FIELDS.forEach(f => { out[f] = str(a[f]); });
    ['Intake', 'Display name', 'University'].forEach(f => {
      if (!out[f]) throw new Error('Admit ' + (i + 1) + (out['Display name'] ? ' (' + out['Display name'] + ')' : '') + ' has no "' + f + '".');
    });
    return out;
  });
  const routes = routesIn.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error('Route ' + (i + 1) + ' is not an object.');
    const out = {};
    ROUTE_FIELDS.forEach(f => { out[f] = str(r[f]); });
    ['Route', 'Display name', 'Intake'].forEach(f => {
      if (!out[f]) throw new Error('Route ' + (i + 1) + (out['Display name'] ? ' (' + out['Display name'] + ')' : '') + ' has no "' + f + '".');
    });
    return out;
  });
  return { admits, routes };
}

let FILE_CACHE = { mtime: -1, data: null };

function fromFile() {
  let st = null;
  try { st = fs.statSync(FILE); } catch (e) { st = null; }
  const mtime = st ? st.mtimeMs : 0;
  if (FILE_CACHE.mtime === mtime) return FILE_CACHE.data;
  let data = null;
  if (st) {
    try { data = clean(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
    catch (e) { console.warn('  assets/success-stories.json could not be read: ' + e.message); data = null; }
  }
  FILE_CACHE = { mtime, data };
  return data;
}

/**
 * What the page shows: the office's upload when there is one, else the
 * shipped file, else nothing. `source` says which, for the admin screen.
 */
function load(deps) {
  deps = deps || {};
  let stored = null, meta = null;
  try {
    stored = (deps.content && typeof deps.content.get === 'function' && deps.content.get(KEY))
      || (deps.db && typeof deps.db.content === 'function' && deps.db.content(KEY)) || null;
    if (stored && deps.db && typeof deps.db.contentMeta === 'function') meta = deps.db.contentMeta(KEY) || null;
  } catch (e) { stored = null; }
  if (stored) {
    try {
      const d = clean(stored);
      return { admits: d.admits, routes: d.routes, source: 'upload', who: meta && meta.who || '', updated: meta && meta.updated_at || '' };
    } catch (e) { /* a bad row in the table: fall through to the file */ }
  }
  const f = fromFile();
  return { admits: f ? f.admits : [], routes: f ? f.routes : [], source: f ? 'file' : 'none', who: '', updated: '' };
}

/* ------------------------------------------------------------- the order */

const INTAKE_ORDER = { 'Winter 2026': 0, 'Summer 2026': 1, 'Summer 2025': 2, 'Winter 2025': 3 };
const intakeRank = i => (Object.prototype.hasOwnProperty.call(INTAKE_ORDER, i) ? INTAKE_ORDER[i] : 9);

/**
 * The admits in card order. The port of build_story_single.py, step for step:
 *
 *   · a "person" is a Display name (Rakesh and Vamsi appear in two intakes
 *     and are one person each, as the prototype treats them);
 *   · a person's offers sort by intake, newest first; people sort by their
 *     newest intake, then most offers first, then name;
 *   · each person's n cards get target slots (j + off) * N / n + jitter, off
 *     and jitter from random.Random(2026) — people in the order above;
 *   · up to ten passes swap any card that has a same-person card among the
 *     three before it with the first card (searching forward, then from the
 *     top) that keeps both neighbourhoods clean;
 *   · then, within each person, the cards are put back in intake order.
 */
function order(admits) {
  const people = new Map();
  (admits || []).forEach((a, idx) => {
    const name = a['Display name'];
    if (!people.has(name)) people.set(name, { name, offers: [] });
    people.get(name).offers.push({ a, idx });
  });
  const list = [...people.values()];
  list.forEach(p => {
    /* Stable, like Python's sort: same intake keeps the file's order. */
    p.offers = p.offers.map((o, i) => ({ o, i }))
      .sort((x, y) => (intakeRank(x.o.a.Intake) - intakeRank(y.o.a.Intake)) || (x.i - y.i))
      .map(x => x.o);
    p.latest = p.offers.length ? p.offers[0].a.Intake : '';
  });
  list.sort((x, y) => (intakeRank(x.latest) - intakeRank(y.latest))
    || (y.offers.length - x.offers.length)
    || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

  /* cards: [personKey, intake, k, offer] in person order. */
  const cards = [];
  list.forEach((p, pi) => p.offers.forEach((o, k) => cards.push({ p: pi, k, o })));

  const rng = new PyRandom(2026);
  const byP = new Map();
  cards.forEach(c => { if (!byP.has(c.p)) byP.set(c.p, []); byP.get(c.p).push(c); });
  const N = cards.length;
  const slots = [];
  byP.forEach(lst => {
    const n = lst.length, off = rng.random();
    lst.forEach((c, j) => slots.push({ s: (j + off) * N / n + rng.random() * 0.5, c }));
  });
  let ordered = slots.map((x, i) => ({ x, i })).sort((a, b) => (a.x.s - b.x.s) || (a.i - b.i)).map(a => a.x.c);

  const near = (arr, from, to, who, skip) => {
    for (let w = Math.max(0, from); w < Math.min(arr.length, to); w++) {
      if (arr[w] !== skip && arr[w].p === who) return true;
    }
    return false;
  };
  for (let pass = 0; pass < 10; pass++) {
    let bad = false;
    for (let i = 0; i < ordered.length; i++) {
      if (!near(ordered, i - 3, i, ordered[i].p, null)) continue;
      bad = true;
      const js = [];
      for (let j = i + 1; j < ordered.length; j++) js.push(j);
      for (let j = 0; j < i; j++) js.push(j);
      for (const j of js) {
        const a = ordered[i], b = ordered[j];
        const okJ = !near(ordered, i - 3, i + 4, b.p, a);
        const okI = !near(ordered, j - 3, j + 4, a.p, b);
        if (okI && okJ) { ordered[i] = b; ordered[j] = a; break; }
      }
    }
    if (!bad) break;
  }
  /* A person's cards back in their own intake order (k) across the slots they hold. */
  const pos = new Map();
  ordered.forEach((c, i) => { if (!pos.has(c.p)) pos.set(c.p, []); pos.get(c.p).push(i); });
  pos.forEach(idx => {
    const cs = idx.map(i => ordered[i]).sort((a, b) => a.k - b.k);
    idx.forEach((i, n) => { ordered[i] = cs[n]; });
  });
  return ordered.map(c => c.o.a);
}

/** The routes in the prototype's order: random.Random(7).shuffle. */
function orderRoutes(routes) {
  const arr = (routes || []).slice();
  new PyRandom(7).shuffle(arr);
  return arr;
}

/* ------------------------------------------------------------ the routes */

const ROUTE = {
  'Germany Opportunity Card': {
    title: 'Opportunity Card', sub: 'Chancenkarte · Germany', flag: '\u{1F1E9}\u{1F1EA}', tile: 'de',
    outcome: 'Germany Opportunity Card (Chancenkarte) approved',
    href: '/work-opportunity-card.html', link: 'Germany Opportunity Card service',
  },
  'EU Blue Card (Germany)': {
    title: 'EU Blue Card', sub: 'Germany', flag: '\u{1F1E9}\u{1F1EA}', tile: 'de',
    outcome: 'EU Blue Card for Germany approved',
    href: '/visa-processing.html', link: 'Visa processing service',
  },
  'German language course visa': {
    title: 'Language Course Visa', sub: 'Germany', flag: '\u{1F1E9}\u{1F1EA}', tile: 'de',
    outcome: 'German language course visa approved',
    href: '/language-german.html', link: 'German language classes',
  },
  'UK India Young Professionals Scheme visa': {
    title: 'Young Professionals Visa', sub: 'India–UK scheme', flag: '\u{1F1EC}\u{1F1E7}', tile: 'uk',
    outcome: 'UK India Young Professionals Scheme visa approved',
    href: '/visa-processing.html', link: 'Visa processing service',
  },
};
const routeOf = r => ROUTE[r.Route] || {
  title: r.Route, sub: r.Country || '', flag: '', tile: 'de',
  outcome: r.Route + ' approved', href: '/visa-processing.html', link: 'Visa processing service',
};

/* -------------------------------------------------------------- the page */

const escape_ = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** "TU" for a university with no logo — the first letters of its two telling words. */
function initials(u) {
  const skip = new Set(['of', 'the', 'and', 'university', 'universität', 'universitat']);
  const words = (String(u || '').match(/[A-Za-zÄÖÜäöüß]+/g) || []).filter(w => !skip.has(w.toLowerCase()));
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'U';
}

const STYLE = '<style>'
  /* The template is the prose one — 70ch and a gold rule on every blockquote.
     A grid of 109 cards in a 70ch column is one card wide, so the page breaks
     out of it; the cards carry their own rules and no blockquote. */
  + '#page{max-width:none}'
  + '.ss-lede{font-size:15.6px;line-height:1.7;color:var(--navy-800);max-width:760px;margin:0 0 22px}'
  + '.ss-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;align-items:stretch;margin:0 0 8px}'
  + '@media (max-width:1000px){.ss-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}'
  + '@media (max-width:720px){.ss-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}'
  + '@media (max-width:480px){.ss-grid{grid-template-columns:minmax(0,1fr)}}'
  + '.ss-card{display:flex;flex-direction:column;gap:9px;min-width:0;padding:14px;'
  + 'background:var(--paper,#fff);border:1px solid var(--line,#e6e2d7);border-radius:16px;box-shadow:0 1px 2px rgba(11,30,49,.04)}'
  + '.ss-card:hover{box-shadow:var(--sh-2,0 10px 24px rgba(11,30,49,.08))}'
  /* The logo tile stays white whatever the colour scheme: a university's mark
     was drawn for paper, and a dark tile makes half of them vanish. */
  + '.ss-logo{height:84px;border-radius:12px;padding:10px;display:flex;align-items:center;justify-content:center;'
  + 'background:#fff;border:1px solid var(--line,#e6e2d7);overflow:hidden;color-scheme:light}'
  + '.ss-logo img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block}'
  + '.ss-logo .ss-ini{font:800 20px/1 var(--sans,system-ui,sans-serif);letter-spacing:.06em;color:#13385c;'
  + 'width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:#eef3fb;border:1px solid #d5e0f0}'
  + '@media (prefers-color-scheme:dark){.ss-logo{background:#fff}.ss-logo .ss-ini{background:#eef3fb;color:#13385c}}'
  + '.ss-meta{display:flex;justify-content:space-between;align-items:center;gap:8px;min-width:0}'
  + '.ss-who{font:700 17px/1.25 var(--disp,inherit);color:var(--navy-900,#0b1e31);min-width:0;overflow-wrap:anywhere}'
  + '.ss-badge{flex:none;font:700 11.2px/1 var(--sans,system-ui,sans-serif);padding:6px 10px;border-radius:999px;'
  + 'background:#eef3fb;color:var(--navy-700,#13385c);border:1px solid #d5e0f0;white-space:nowrap}'
  + '.ss-u{font-weight:700;font-size:14.2px;line-height:1.35;color:var(--navy-800,#0d2338);overflow-wrap:anywhere}'
  + '.ss-p{font-size:13.2px;line-height:1.5;color:var(--muted,#5b6b7e);overflow-wrap:anywhere}'
  + '.ss-sec{margin:44px 0 0}'
  + '.ss-sec h2{margin:0 0 8px;font-size:clamp(21px,2.6vw,26px);line-height:1.2}'
  + '.ss-tile{height:84px;border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;'
  + 'align-items:center;text-align:center;color:#fff;background:linear-gradient(135deg,var(--navy-700,#13385c),var(--blue,#1a4fb4))}'
  + '.ss-tile.uk{background:linear-gradient(135deg,#012169,#c8102e)}'
  + '.ss-tile b{font-size:15.5px;line-height:1.2}.ss-tile span{font-size:11.6px;opacity:.92;margin-top:3px}'
  + '.ss-link{margin-top:auto;font:600 13.2px/1.4 var(--sans,system-ui,sans-serif);color:var(--blue,#1a4fb4);text-decoration:none}'
  + '.ss-link:hover{text-decoration:underline}'
  + '.ss-cta{margin:40px 0 0;padding:22px 24px;border-radius:16px;background:var(--cream,#f7f5ef);border:1px solid var(--line,#e6e2d7)}'
  + '.ss-cta h2{margin:0 0 6px;font-size:22px}.ss-cta p{margin:0 0 14px;color:var(--navy-800)}'
  + '.ss-cta .btn{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:700;'
  + 'padding:12px 18px;border-radius:12px;background:var(--green,#1f7a4d);color:#fff;border:1px solid var(--green,#1f7a4d)}'
  + '.ss-cta .btn:hover{background:var(--green-deep,#186139)}'
  + '</style>';

const INTRO = 'Every admission offer our students have received from Winter 2025 to Winter 2026 '
  + '— the university, the programme and the intake. Names are shown as the students chose.';
const ROUTES_INTRO = 'Beyond university admissions: clients we took through the Germany Opportunity '
  + 'Card (Chancenkarte), the EU Blue Card, the German language course visa and the UK India '
  + 'Young Professionals Scheme.';

/**
 * The page. `deps`: templates(), fill(), metaHoles(), absolute(), logoFor(),
 * esc() (optional), and db/content for load().
 */
function render(deps) {
  const t = deps.templates();
  if (!t) return null;
  const esc = deps.esc || escape_;
  const data = load(deps);
  const admits = order(data.admits);
  const routes = orderRoutes(data.routes);

  const logoHtml = u => {
    const src = deps.logoFor ? deps.logoFor(u, '') : '';
    return src
      ? '<img src="' + esc(src) + '" alt="' + esc(u) + ' logo" loading="lazy" decoding="async">'
      : '<span class="ss-ini" aria-hidden="true">' + esc(initials(u)) + '</span>';
  };
  const programme = a => a['Programme (as recorded)'] || 'Programme to be confirmed';

  const admitCard = a =>
    '<article class="ss-card ss-admit">'
    + '<div class="ss-logo">' + logoHtml(a.University) + '</div>'
    + '<div class="ss-meta"><span class="ss-who">' + esc(a['Display name']) + '</span>'
    + '<span class="ss-badge">' + esc(a.Intake) + '</span></div>'
    + '<div class="ss-u">' + esc(a.University) + '</div>'
    + '<div class="ss-p">' + esc(programme(a)) + (a.Degree ? ' · ' + esc(a.Degree) : '') + '</div>'
    + '</article>';

  const routeCard = r => {
    const d = routeOf(r);
    return '<article class="ss-card ss-route">'
      + '<div class="ss-tile' + (d.tile === 'uk' ? ' uk' : '') + '"><b>' + (d.flag ? d.flag + ' ' : '') + esc(d.title) + '</b>'
      + (d.sub ? '<span>' + esc(d.sub) + '</span>' : '') + '</div>'
      + '<div class="ss-meta"><span class="ss-who">' + esc(r['Display name']) + '</span>'
      + '<span class="ss-badge">' + esc(r.Intake) + '</span></div>'
      + '<div class="ss-u">' + esc(d.outcome) + '</div>'
      + '<a class="ss-link" href="' + esc(d.href) + '">' + esc(d.link) + ' →</a>'
      + '</article>';
  };

  const body = STYLE
    + '<p class="ss-lede">' + esc(INTRO) + '</p>'
    + (admits.length
      ? '<div class="ss-grid" id="admit-stories">' + admits.map(admitCard).join('') + '</div>'
      : '<p>The first admissions of this intake are being confirmed. '
        + '<a href="contact-us.html">Ask us</a> what we have placed and where.</p>')
    + '<section class="ss-sec" id="visa-work-stories">'
    + '<h2>Opportunity Card, Blue Card and visa success stories</h2>'
    + '<p class="ss-lede">' + esc(ROUTES_INTRO) + '</p>'
    + (routes.length
      ? '<div class="ss-grid">' + routes.map(routeCard).join('') + '</div>'
      : '<p>Our first visa and work-route outcomes are being confirmed.</p>')
    + '</section>'
    + '<div class="ss-cta"><h2>Your story could be next</h2>'
    + '<p>Book a free 45-minute session — we read your marksheets and tell you honestly '
    + 'which universities you can get into.</p>'
    + '<a class="btn" href="index.html#counsel">Book free counselling →</a></div>';

  /* The numbers in the description, from the data rather than typed in, so a
     new export changes them without anybody remembering to. */
  const students = new Set(data.admits.map(a => a['Display name'])).size;
  const unis = new Set(data.admits.map(a => a.University)).size;
  const cards = data.routes.filter(r => r.Route === 'Germany Opportunity Card').length;
  const blue = data.routes.filter(r => r.Route === 'EU Blue Card (Germany)').length;
  const yps = data.routes.filter(r => /Young Professionals/i.test(r.Route)).length;
  const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  const title = 'Success stories — ' + data.admits.length + ' admits, Opportunity Card & visa approvals';
  const desc = students + ' students, ' + n(data.admits.length, 'admission offer', 'admission offers')
    + ' at ' + n(unis, 'university', 'universities')
    + (cards ? ', plus ' + n(cards, 'Germany Opportunity Card (Chancenkarte)', 'Germany Opportunity Cards (Chancenkarte)') : '')
    + (blue ? ', ' + (blue === 1 ? 'an EU Blue Card' : blue + ' EU Blue Cards') : '')
    + (yps ? ' and UK Young Professionals visa approvals' : '')
    + '.';

  const site = deps.absolute('');
  const ld = [
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: site + '/' },
      { '@type': 'ListItem', position: 2, name: 'Success stories', item: site + SITE_PATH },
    ] },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Glovels student admission offers',
      numberOfItems: admits.length,
      itemListElement: admits.map((a, k) => ({ '@type': 'ListItem', position: k + 1,
        name: a['Display name'] + ' — ' + a.University + ', ' + programme(a) + ' (' + a.Intake + ')' })) },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Glovels Opportunity Card, Blue Card and visa success stories',
      numberOfItems: routes.length,
      itemListElement: routes.map((r, k) => ({ '@type': 'ListItem', position: k + 1,
        name: r['Display name'] + ' — ' + routeOf(r).outcome + ' (' + r.Intake + ')' })) },
  ];
  const jsonld = ld.map(x => '<script type="application/ld+json">'
    + JSON.stringify(x).replace(/</g, '\\u003c') + '</script>').join('\n');

  const holes = deps.metaHoles({
    title, desc,
    canonical: deps.absolute(SITE_PATH),
    keywords: 'study abroad success stories, Germany admits, Opportunity Card success, Chancenkarte approved, '
      + 'EU Blue Card Germany, UK India Young Professionals Scheme visa, public university admission',
    type: 'website',
    /* Round 169 (WEB-20.3): a preview card when the page is shared. */
    image: deps.defaultOg || '/og/glovels.png', imageAlt: 'Glovels — student success stories',
    indexable: true,
  });
  holes.JSONLD = jsonld;
  return deps.fill(t.page, Object.assign(holes, {
    CRUMBS: '<a href="index.html">Home</a> / Success stories',
    H1: 'Student success stories',
    DATELINE: admits.length
      ? admits.length + ' admission offers' + (routes.length ? ' · ' + routes.length + ' visa and work-route approvals' : '')
      : 'Being confirmed',
    BODY: body,
  }));
}

/**
 * The home page's "Real journeys, real outcomes" rail links to
 * success-stories.html, which the .html redirect turns into /success-stories.
 * Pointed straight there, so the one link on the home page that matters for
 * this page costs no redirect.
 */
function withHomeLink(html, deps) {
  let out = String(html).replace(/(id="storyMore"[^>]*>\s*<a\s+href=")success-stories\.html(")/, '$1' + SITE_PATH + '$2');
  /* Round 169 (WEB-17): "See all 9 admissions" counted the testimonials on
     the home page; the page it opens says 109. The number is the stories
     page's own — the admits it lists — and the home script leaves it be. */
  if (deps) {
    let n = 0;
    try { n = load(deps).admits.length; } catch (e) { n = 0; }
    if (n) out = out.replace(/<b data-count>\d*<\/b>/, '<b data-count data-src="stories">' + n + '</b>');
  }
  return out;
}

/* ----------------------------------------------------------- the office */

const MAX_BODY = 4 * 1024 * 1024;

/**
 * Two routes for Organisation → Success stories. `route(method, path,
 * handler)` is api.js's own; deps carry its guard and helpers:
 *   needs(perm, handler)  — staff with the `content` permission, i.e. the
 *                           people who edit the website; a counsellor gets 403
 *   json(res, code, obj)
 *   readBody(req, max)    — the raw body; the public file is 34KB today and
 *                           readJson's 64KB cap would refuse next year's
 *   db, content, log
 */
function installRoutes(route, deps) {
  const { db, needs, json, readBody } = deps;
  const log = deps.log || console;
  const counts = d => ({ admits: d.admits.length, routes: d.routes.length,
    students: new Set(d.admits.map(a => a['Display name'])).size,
    universities: new Set(d.admits.map(a => a.University)).size });

  route('GET', '/api/staff/success-stories', needs('content', async (req, res) => {
    const d = load(deps);
    return json(res, 200, { counts: counts(d), source: d.source, who: d.who, updated: d.updated,
      admits: d.admits, routes: d.routes });
  }));

  route('POST', '/api/staff/success-stories', needs('content', async (req, res, s) => {
    let raw = '';
    try { raw = (await readBody(req, MAX_BODY)).toString('utf8'); }
    catch (e) { return json(res, 413, { error: 'That file is bigger than 4MB, which is not a success-stories export.' }); }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return json(res, 422, { error: 'That is not valid JSON. Export the public file again and upload the whole file.' }); }
    /* {value: {...}} the way the other content routes take it, or the file itself. */
    if (parsed && parsed.value && typeof parsed.value === 'object' && !parsed.admits) parsed = parsed.value;
    if (parsed && parsed.restore === true) {
      db.setContent(KEY, null, s.name);
      const d = load(deps);
      db.log(s.name, 'success stories — back to the shipped file', d.admits.length + ' admits, ' + d.routes.length + ' routes');
      return json(res, 200, { counts: counts(d), source: d.source });
    }
    let d;
    try { d = clean(parsed); }
    catch (e) { return json(res, 422, { error: e.message }); }
    if (!d.admits.length) return json(res, 422, { error: 'The file has no admits. A page with no success stories is not a replacement anybody meant.' });
    db.setContent(KEY, d, s.name);
    const c = counts(d);
    db.log(s.name, 'success stories — replaced', c.admits + ' admits, ' + c.routes + ' routes, ' + c.students + ' students');
    log.log('  success stories replaced by ' + s.name + ': ' + c.admits + ' admits, ' + c.routes + ' routes');
    return json(res, 200, { counts: c, source: 'upload' });
  }));
}

module.exports = { load, clean, order, orderRoutes, render, withHomeLink, installRoutes, PyRandom, ROUTE, KEY, FILE };
