'use strict';
/**
 * The home page's content, as data.
 *
 * Until now the packages, the headline numbers, the FAQ and the testimonials
 * were markup inside `index.html`, generated from a workbook nobody in the
 * office has. Changing a price meant a developer, a rebuild and a deploy.
 *
 * Here they are four JSON documents in the `content` table. `content.json`
 * holds what the page shipped with; the database holds whatever has been
 * edited since; the page asks `/api/content` on load and paints itself from
 * the answer. The defaults are a floor, never an override — once a block has
 * been edited, the file is ignored for that block, so a rebuild of the site
 * cannot quietly undo a counsellor's work.
 *
 * One thing here is not cosmetic. `priceInr` and `unlocks` on a package are
 * read by the order endpoint: the price it charges and the number of gated
 * university names it hands out both come from this file, not from the
 * browser. Editing a package price on the Home page screen changes what
 * checkout charges, which is the only way the two can be guaranteed to agree.
 */

const fs = require('fs');
const path = require('path');

const KEYS = ['packages', 'stats', 'faq', 'testimonials', 'services', 'finder'];

/*
 * The fifth block is not like the other four.
 *
 * Packages, numbers, FAQ and testimonials are lists you replace. The rest of
 * the page — every heading, paragraph, button label, the page title, the meta
 * description — is 400-odd lines that already exist, and what an editor
 * changes is a handful of them. Storing all 400 back on every save would mean
 * a rebuild of the marketing pages could never introduce a new sentence
 * without somebody re-saving.
 *
 * So text is stored as overrides only: a map of key to replacement. The
 * catalogue of what CAN be edited comes from content.json; the database holds
 * only what HAS been edited. That is also why the public endpoint sends the
 * map and not the catalogue — the visitor's browser already has the originals,
 * they are the page.
 */
const TEXT_KEY = 'textOverrides';

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 400);
const num = v => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const yes = v => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return false;
  return !/^(n|no|false|0|off|hidden)$/.test(s);
};
const list = v => (Array.isArray(v) ? v : String(v || '').split(/\s*\n|\s*\|\s*/))
  .map(x => str(x, 200)).filter(Boolean).slice(0, 20);

/* ------------------------------------------------------------ what is valid */

/*
 * Every block is cleaned on the way in and on the way out. On the way in
 * because the editor and the spreadsheet are both untrusted; on the way out
 * because a `content.json` produced by an older extractor may be missing a
 * field the page now reads, and a page that renders "undefined" is worse than
 * one that renders nothing.
 */

function cleanPackage(p, n) {
  const id = str(p.id, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const sell = yes(p.sell);
  return {
    id: id || 'pkg-' + (n + 1),
    tab: /^(study|work|migrate)$/.test(str(p.tab, 10)) ? str(p.tab, 10) : 'study',
    sort: num(p.sort) || n + 1,
    active: p.active === undefined ? true : yes(p.active),
    featured: yes(p.featured),
    primary: yes(p.primary),
    ribbon: str(p.ribbon, 40),
    title: str(p.title, 60),
    desc: str(p.desc, 400),
    unlocks: Math.max(0, Math.min(999, Math.round(num(p.unlocks)))),
    features: list(p.features),
    sell,
    /* Whole rupees, and capped. A stray zero on a price is the difference
       between ₹74,999 and ₹749,990, and there is no gateway in front of this
       yet to notice. */
    priceInr: sell ? Math.max(0, Math.min(9999999, Math.round(num(p.priceInr)))) : 0,
    priceFrom: str(p.priceFrom, 20) || 'From',
    priceNote: str(p.priceNote, 40),
    quote: str(p.quote, 80),
    quoteSmall: str(p.quoteSmall, 80),
    /* The line a student ticks at checkout. It is a promise about what the
       package does and does not cover, so it belongs with the package, and it
       is editable by the people who have to honour it. */
    consent: str(p.consent, 400),
    cta: str(p.cta, 40) || (sell ? 'Choose ' + str(p.title, 40) : 'Enquire'),
    ctaHref: /^(#|https?:\/\/|[a-z0-9._-]+\.html)/i.test(str(p.ctaHref, 200)) ? str(p.ctaHref, 200) : '',
    pledge: p.pledge && (p.pledge.title || p.pledge.body) ? {
      tone: /^(gold|green|blue)$/.test(str(p.pledge.tone, 10)) ? str(p.pledge.tone, 10) : 'green',
      title: str(p.pledge.title, 160),
      body: str(p.pledge.body, 400),
      href: str(p.pledge.href, 200),
      linkText: str(p.pledge.linkText, 40),
    } : null,
  };
}

function cleanPackages(v) {
  const raw = v && Array.isArray(v.items) ? v : { items: Array.isArray(v) ? v : [] };
  const items = raw.items.slice(0, 40).map(cleanPackage);

  /* Two packages with the same id is not a display bug: the order endpoint
     looks a package up by id, so a duplicate means the wrong price is charged
     for one of them. The later one is renamed rather than dropped, because
     losing a card someone just added is the more surprising failure. */
  const seen = new Set();
  items.forEach((p, i) => {
    let id = p.id, n = 2;
    while (seen.has(id)) id = p.id + '-' + n++;
    p.id = id;
    seen.add(id);
    p.sort = p.sort || i + 1;
  });

  const tabs = (Array.isArray(raw.tabs) && raw.tabs.length ? raw.tabs : [
    { key: 'study', label: 'Study' }, { key: 'work', label: 'Work' },
    { key: 'migrate', label: 'Migration' },
  ]).slice(0, 6).map(t => ({ key: str(t.key, 12), label: str(t.label, 40) }));

  /* Ordered by tab first, then by `sort` within the tab. Sorting on `sort`
     alone interleaves the three tabs — every tab numbers its own cards from 1
     — which is invisible on the page, where they are grouped anyway, and very
     confusing in the spreadsheet, where they are not. */
  const tabOrder = k => {
    const i = tabs.findIndex(t => t.key === k);
    return i < 0 ? tabs.length : i;
  };
  items.sort((a, b) => tabOrder(a.tab) - tabOrder(b.tab) || a.sort - b.sort);
  items.forEach((p, i) => { p.sort = i + 1; });

  return {
    eyebrow: str(raw.eyebrow, 80),
    heading: str(raw.heading, 200),
    tabs,
    items,
  };
}

/*
 * The a-la-carte grid. Two fields are kept but never shown in the editor:
 * `levels` (the per-level price list on the language courses) and `partners`
 * (outbound links). Modelling them would double the size of the form for two
 * cards; dropping them on save would quietly delete a price list. So they ride
 * through untouched.
 */
function cleanService(x, n) {
  const id = str(x.id, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const free = yes(x.isFree);
  return {
    id: id || 'svc-' + (n + 1),
    sort: num(x.sort) || n + 1,
    active: x.active === undefined ? true : yes(x.active),
    name: str(x.name, 80),
    desc: str(x.desc, 500),
    meta: str(x.meta, 120),
    cats: (Array.isArray(x.cats) ? x.cats : String(x.cats || '').split(/[,\s]+/))
      .map(c => str(c, 20).toLowerCase()).filter(Boolean).slice(0, 6),
    posTop: Math.max(0, Math.min(99, Math.round(num(x.posTop)))),
    isFree: free,
    priceInr: free ? 0 : Math.max(0, Math.min(9999999, Math.round(num(x.priceInr)))),
    priceLabel: str(x.priceLabel, 40),
    badge: /^(best|start|fast|value)$/.test(str(x.badge, 10)) ? str(x.badge, 10) : '',
    ai: /^(sop|lor|cv)$/.test(str(x.ai, 10)) ? str(x.ai, 10) : '',
    ctaLabel: str(x.ctaLabel, 40),
    ctaHref: str(x.ctaHref, 200),
    ctaGreen: yes(x.ctaGreen),
    levels: Array.isArray(x.levels) ? x.levels.slice(0, 12) : [],
    partners: Array.isArray(x.partners) ? x.partners.slice(0, 8) : [],
  };
}

function cleanServices(v) {
  const raw = v && Array.isArray(v.items) ? v : { items: Array.isArray(v) ? v : [] };
  const items = raw.items.slice(0, 120).map(cleanService);

  /* A duplicate id is not cosmetic: "Add to plan" tracks a service by id, so
     two with the same one add and remove each other. */
  const seen = new Set();
  items.forEach(x => {
    let id = x.id, n = 2;
    while (seen.has(id)) id = x.id + '-' + n++;
    x.id = id;
    seen.add(id);
  });
  items.sort((a, b) => a.sort - b.sort);
  items.forEach((x, i) => { x.sort = i + 1; });

  const tabs = (Array.isArray(raw.tabs) ? raw.tabs : []).slice(0, 10).map(t => ({
    key: str(t.key, 20), label: str(t.label, 40),
    icon: str(t.icon, 20) || 'star', colour: /^#[0-9a-f]{3,8}$/i.test(str(t.colour, 10))
      ? str(t.colour, 10) : '#123a7b',
  })).filter(t => t.key);

  return { tabs, items };
}

const cleanStats = v => (Array.isArray(v) ? v : []).slice(0, 8).map(x => ({
  num: str(x.num, 20), label: str(x.label, 120), dummy: yes(x.dummy),
})).filter(x => x.num || x.label);

const cleanFaq = v => (Array.isArray(v) ? v : []).slice(0, 40).map(x => ({
  q: str(x.q, 200), a: str(x.a, 1200), dummy: yes(x.dummy),
})).filter(x => x.q);

const cleanTestimonials = v => (Array.isArray(v) ? v : []).slice(0, 30).map(x => ({
  route: str(x.route, 60), quote: str(x.quote, 500), name: str(x.name, 40),
  where: str(x.where, 80), verified: yes(x.verified), dummy: yes(x.dummy),
})).filter(x => x.quote || x.name);

/*
 * What the SOP/LOR studio writes with.
 *
 * Deliberately NOT in KEYS. Everything in KEYS is sent to every visitor with
 * `/api/content`; this block is several pages of prose that the browser has no
 * use for, because drafting happens on the server. Keeping it out of the public
 * payload also keeps the phrasing off the page, where a competitor would find
 * it in one View Source.
 */
const cleanChips = v => (Array.isArray(v) ? v : []).slice(0, 24).map((c, n) => ({
  key: str(c.key, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
    || 'c' + (n + 1),
  label: str(c.label, 60),
  phrase: str(c.phrase, 200) || str(c.label, 60),
})).filter(c => c.label);

/* Sentences, not lines of a list: 400 characters, and newlines collapsed by
   str() so a stray line break in the editor cannot split one in half. */
const cleanLines = v => (Array.isArray(v) ? v : String(v || '').split(/\n{2,}|\n/))
  .map(x => str(x, 400)).filter(Boolean).slice(0, 24);

function cleanWriting(v) {
  const w = v && typeof v === 'object' ? v : {};
  const sop = w.sop || {};
  const lor = w.lor || {};
  return {
    sop: {
      signals: cleanChips(sop.signals),
      motives: cleanChips(sop.motives),
      openings: cleanLines(sop.openings),
      background: cleanLines(sop.background),
      motive: cleanLines(sop.motive),
      fit: cleanLines(sop.fit),
      closings: cleanLines(sop.closings),
    },
    lor: {
      signals: cleanChips(lor.signals),
      openings: cleanLines(lor.openings),
      body: cleanLines(lor.body),
      instance: cleanLines(lor.instance),
      closings: cleanLines(lor.closings),
    },
  };
}

/*
 * How the finder behaves, and how to reach the office.
 *
 * Small, but every field in here is a decision somebody in the business makes
 * and nobody in the business could change:
 *
 *   browsePublic / browsePrivate  how many universities a visitor sees before
 *                                 they have touched the filters. That is a
 *                                 pricing lever, not a layout choice.
 *   cgpaFull / cgpaPartial        the CGPA bar used for a destination that has
 *                                 not set its own.
 *   fx                            what one unit of each currency is worth in
 *                                 rupees, for the currency switch.
 *   bands                         the four budget buckets and their ceilings.
 *   trending                      the suggestion chips.
 *   contact                       the WhatsApp number, the phone number and the
 *                                 address every page links to. It was written
 *                                 into the markup of forty pages.
 */
const cleanFinder = v => {
  const f = v && typeof v === 'object' ? v : {};
  const int = (x, lo, hi, dflt) => {
    const n = Math.round(num(x));
    return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  const rate = x => {
    const n = num(x);
    return n > 0 ? Math.round(n * 100) / 100 : 0;
  };
  const fxIn = f.fx && typeof f.fx === 'object' ? f.fx : {};
  const fx = { INR: 1 };
  Object.keys(fxIn).slice(0, 12).forEach(k => {
    const code = str(k, 4).toUpperCase().replace(/[^A-Z]/g, '');
    if (!code || code === 'INR') return;
    const r = rate(fxIn[k]);
    if (r) fx[code] = r;
  });

  const bands = (Array.isArray(f.bands) ? f.bands : []).slice(0, 8).map((b, i) => ({
    id: str(b.id, 20).toLowerCase().replace(/[^a-z0-9]/g, '') || 'band' + (i + 1),
    label: str(b.label, 40),
    /* null is not zero. The top band deliberately has no ceiling, and turning
       that into 0 would make it match nothing at all. */
    ceilInr: b.ceilInr == null || b.ceilInr === '' ? null
      : Math.max(0, Math.min(99999999, Math.round(num(b.ceilInr)))),
  })).filter(b => b.label);

  const digits = (x, n) => String(x == null ? '' : x).replace(/[^0-9]/g, '').slice(0, n || 15);

  return {
    browsePublic: int(f.browsePublic, 1, 50, 3),
    browsePrivate: int(f.browsePrivate, 1, 50, 2),
    cgpaFull: rate(f.cgpaFull) || 7.5,
    cgpaPartial: rate(f.cgpaPartial) || 6,
    fx,
    bands,
    trending: (Array.isArray(f.trending) ? f.trending : String(f.trending || '').split(/\n/))
      .map(x => str(x, 80)).filter(Boolean).slice(0, 12),
    contact: {
      whatsapp: digits((f.contact || {}).whatsapp, 15),
      phone: str((f.contact || {}).phone, 30),
      email: str((f.contact || {}).email, 120).toLowerCase(),
    },
  };
};

const CLEAN = {
  packages: cleanPackages, stats: cleanStats,
  faq: cleanFaq, testimonials: cleanTestimonials, services: cleanServices,
  writing: cleanWriting, finder: cleanFinder,
};

/* ------------------------------------------------------------- the spreadsheet */

/*
 * One tab per block would be the tidy answer, but a workbook with four sheets
 * is a workbook people edit the wrong sheet of. Instead each block is its own
 * flat table, downloaded and uploaded separately, with a `block` column so an
 * upload that lands on the wrong screen is caught rather than applied.
 */
const SHEETS = {
  packages: {
    columns: [
      ['id', 'id'], ['tab', 'tab'], ['title', 'title'], ['description', 'desc'],
      ['price inr', 'priceInr'], ['price note', 'priceNote'],
      ['universities revealed', 'unlocks'], ['sold online', 'sell'],
      ['ribbon', 'ribbon'], ['highlighted', 'featured'],
      ['features (one per line)', 'features'],
      ['button label', 'cta'], ['button link', 'ctaHref'], ['on the site', 'active'],
    ],
    row: p => [p.id, p.tab, p.title, p.desc, p.sell ? p.priceInr : '', p.priceNote,
      p.unlocks || '', p.sell ? 'yes' : 'no', p.ribbon, p.featured ? 'yes' : 'no',
      p.features.join('\n'), p.cta, p.ctaHref, p.active ? 'yes' : 'no'],
    key: 'id',
    label: p => (p.title || p.id),
  },
  stats: {
    columns: [['number', 'num'], ['what it counts', 'label'], ['unconfirmed', 'dummy']],
    row: s => [s.num, s.label, s.dummy ? 'yes' : 'no'],
    key: 'label',
    label: s => s.num + ' ' + s.label,
  },
  faq: {
    columns: [['question', 'q'], ['answer', 'a'], ['unconfirmed', 'dummy']],
    row: f => [f.q, f.a, f.dummy ? 'yes' : 'no'],
    key: 'q',
    label: f => f.q,
  },
  testimonials: {
    columns: [['name', 'name'], ['route', 'route'], ['what they say', 'quote'],
      ['where', 'where'], ['verified', 'verified'], ['unconfirmed', 'dummy']],
    row: t => [t.name, t.route, t.quote, t.where, t.verified ? 'yes' : 'no', t.dummy ? 'yes' : 'no'],
    key: 'name',
    label: t => t.name || t.quote,
  },
  services: {
    columns: [['id', 'id'], ['service', 'name'], ['description', 'desc'],
      ['how long it takes', 'meta'], ['price inr', 'priceInr'], ['free', 'isFree'],
      ['instead of a price', 'priceLabel'], ['categories', 'cats'], ['badge', 'badge'],
      ['button label', 'ctaLabel'], ['button link', 'ctaHref'], ['on the site', 'active']],
    row: x => [x.id, x.name, x.desc, x.meta, x.isFree ? '' : x.priceInr,
      x.isFree ? 'yes' : 'no', x.priceLabel, x.cats.join(' '), x.badge,
      x.ctaLabel, x.ctaHref, x.active ? 'yes' : 'no'],
    key: 'id',
    label: x => x.name || x.id,
  },
  /* The text sheet is the one people will actually live in: every line on the
     page, its section, what it says now, and a column to type the new wording
     into. The key column is what makes it work and the only one that must
     survive a round trip — hence its heading. */
  text: {
    columns: [['do not edit — key', 'key'], ['section', 'sectionLabel'],
      ['where', 'kind'], ['what it says now', 'current'], ['new wording', 'newText']],
    row: t => [t.key, t.sectionLabel || t.section, t.kind === 'text' ? t.element : t.kind,
      t.current, ''],
    key: 'key',
    label: t => t.current,
  },
};

/* ------------------------------------------------------------------ the module */

function makeContent({ db, file }) {
  let defaults = {};
  try {
    defaults = JSON.parse(fs.readFileSync(file || path.join(__dirname, '..', 'content.json'), 'utf8'));
  } catch (e) {
    /* Not fatal. An empty home page block renders as nothing, which is
       recoverable; refusing to boot the whole site over it is not. */
    console.warn('  content.json could not be read (' + e.message + '). '
      + 'The home page will show whatever is in the database, and nothing if that '
      + 'is empty too. Run: python3 build_content.py');
  }

  const get = key => {
    const clean = CLEAN[key];
    if (!clean) return null;
    const stored = db.content(key);
    return clean(stored == null ? defaults[key] : stored);
  };

  /** The overrides map alone — what the home page needs and nothing more. */
  const overrides = () => {
    const v = db.content(TEXT_KEY);
    if (!v || typeof v !== 'object') return {};
    const out = {};
    Object.keys(v).slice(0, 2000).forEach(k => {
      const s = str(v[k], 1200);
      if (s) out[String(k).slice(0, 120)] = s;
    });
    return out;
  };

  /** The catalogue of editable lines, with whatever has been said instead. */
  const text = () => {
    const ov = overrides();
    const lines = (defaults.text || []).map(t => ({
      key: t.key,
      section: t.section,
      sectionLabel: t.sectionLabel || '',
      kind: t.kind,
      element: t.element,
      note: t.note || '',
      original: t.original,
      current: ov[t.key] != null ? ov[t.key] : t.original,
      edited: ov[t.key] != null && ov[t.key] !== t.original,
    }));

    /* An override whose line is no longer on the page. It happens when the
       marketing pages are rebuilt and a sentence comes out different: the key
       is content-addressed, so the old override simply stops matching. Showing
       them is the point — silently dropping somebody's edit is how you lose
       trust in the whole screen. */
    const known = new Set(lines.map(l => l.key));
    const orphans = Object.keys(ov).filter(k => !known.has(k))
      .map(k => ({ key: k, current: ov[k] }));

    return { lines, orphans, edited: lines.filter(l => l.edited).length };
  };

  return {
    KEYS,
    SHEETS,
    get,
    text,
    overrides,

    /**
     * Everything the home page needs, in one response.
     *
     * Text goes out as the overrides map, not the catalogue: the visitor's
     * browser already holds every original — they are the page it is looking
     * at — so sending 400 of them back would be 90KB to say nothing.
     */
    home() {
      const out = {};
      KEYS.forEach(k => { out[k] = get(k); });
      out.text = this.publicText();
      return out;
    },

    /**
     * The overrides the page applies, each carrying the text it replaces.
     *
     * The `from` is not redundant. The browser finds the line by walking the
     * page in the same order this key was computed in, but the page's own
     * scripts add and remove nodes as they run, so that walk can drift.
     * Carrying the original means a replacement only ever lands on a node that
     * says exactly what it is supposed to say — a drifted walk changes nothing
     * rather than changing the wrong sentence.
     */
    publicText() {
      const ov = overrides();
      const orig = {};
      (defaults.text || []).forEach(t => { orig[t.key] = t.original; });
      const out = {};
      Object.keys(ov).forEach(k => {
        if (orig[k] == null || ov[k] === orig[k]) return;
        out[k] = { from: orig[k], to: ov[k] };
      });
      return out;
    },

    /** One line changed, or put back. An empty value means "back to original". */
    setText(key, value, who) {
      const ov = overrides();
      const k = String(key || '').slice(0, 120);
      if (!k) throw new Error('That line has no key.');
      const v = str(value, 1200);
      if (v) ov[k] = v; else delete ov[k];
      db.setContent(TEXT_KEY, ov, who);
      return { key: k, current: v, cleared: !v };
    },

    /** Many lines at once — what the spreadsheet upload applies. */
    setTexts(map, who) {
      const ov = overrides();
      let changed = 0, cleared = 0;
      Object.keys(map || {}).slice(0, 2000).forEach(k => {
        const key = String(k).slice(0, 120);
        const v = str(map[k], 1200);
        if (v) { if (ov[key] !== v) changed++; ov[key] = v; }
        else if (ov[key] != null) { delete ov[key]; cleared++; }
      });
      db.setContent(TEXT_KEY, ov, who);
      return { changed, cleared, total: Object.keys(ov).length };
    },

    save(key, value, who) {
      if (!CLEAN[key]) throw new Error('There is no "' + key + '" block on the home page.');
      const clean = CLEAN[key](value);
      db.setContent(key, clean, who);
      return clean;
    },

    /**
     * The price list the order endpoint charges from.
     *
     * It is derived, not stored twice. `paise` is rupees × 100 because that is
     * what every Indian gateway wants and rounding it later is how a ₹9,999
     * package becomes ₹9,998.99.
     */
    priceList() {
      const out = {};
      get('packages').items.forEach(p => {
        if (!p.sell || !p.active) return;
        out[p.id] = { name: p.title, paise: Math.round(p.priceInr * 100), publicUnis: p.unlocks };
      });
      return out;
    },

    /**
     * The service price list the order endpoint charges from.
     *
     * Same rule as the packages: the browser sends ids, the server decides what
     * they cost. A language course carries a price per level, so those come
     * through as a map and the level is validated against it — "B2 at the A1
     * price" is exactly the kind of thing a hand-rolled request would try.
     */
    serviceList() {
      const out = {};
      get('services').items.forEach(x => {
        if (!x.active) return;
        const levels = {};
        (x.levels || []).forEach(l => {
          const code = str(l.code, 12);
          if (code) levels[code] = Math.max(0, Math.round(num(l.priceInr)));
        });
        out[x.id] = {
          name: x.name,
          paise: Math.round((x.isFree ? 0 : x.priceInr) * 100),
          isFree: !!x.isFree,
          levels,
          ai: x.ai || '',
        };
      });
      return out;
    },

    /** The block as rows, for the download. */
    sheet(key) {
      const sh = SHEETS[key];
      if (!sh) throw new Error('There is no "' + key + '" block on the home page.');
      const items = key === 'text' ? text().lines
                  : (key === 'packages' || key === 'services') ? get(key).items
                  : get(key);
      return { headers: sh.columns.map(c => c[0]), rows: items.map(sh.row) };
    },

    /**
     * The text sheet, coming back.
     *
     * Different from the others on purpose. The four list blocks are replaced
     * wholesale by their sheet; text is not, because the sheet is a catalogue
     * of what exists and an editor fills in the handful of rows they care
     * about. A blank "new wording" means "leave it alone", and the only way to
     * put a line back to the original is to type the original — which is in
     * the column beside it.
     */
    planText(objects) {
      const alias = { 'do not edit — key': 'key', 'do not edit - key': 'key', key: 'key',
        'new wording': 'newText', 'new text': 'newText', new: 'newText',
        'what it says now': 'current', section: 'sectionLabel', where: 'kind' };
      const unknown = Object.keys(objects[0] || {}).filter(h => !alias[h]);
      const lines = text().lines;
      const byKey = {};
      lines.forEach(l => { byKey[l.key] = l; });

      const change = [], rejected = [], revert = [];
      const map = {};

      objects.forEach((o, n) => {
        const line = n + 2;
        const g = f => {
          for (const h of Object.keys(o)) if (alias[h] === f) return o[h];
          return '';
        };
        const key = str(g('key'), 120);
        const next = str(g('newText'), 1200);
        if (!next) return;                                   // left alone
        if (!key) {
          rejected.push({ line, what: next.slice(0, 60), why: ['no key — that column must survive'] });
          return;
        }
        const l = byKey[key];
        if (!l) {
          rejected.push({ line, what: next.slice(0, 60),
            why: ['no line on the page has the key "' + key.slice(0, 40) + '"'] });
          return;
        }
        if (next === l.current) return;                      // typed the same thing
        map[key] = next;
        (next === l.original ? revert : change).push({
          line, key, section: l.sectionLabel || l.section, was: l.current, now: next,
        });
      });

      return { unknownColumns: unknown, rejected, change, revert, map,
        total: change.length + revert.length };
    },

    /**
     * What an uploaded sheet would do — and, on the second pass, doing it.
     *
     * Same contract as the catalogue import: the first call answers, the second
     * applies. The difference is that these blocks are ordered lists rather
     * than a table with ids, so an upload REPLACES the block. That is the
     * honest model for a FAQ — deleting a question means removing its row —
     * but it means an upload of the wrong file wipes the block, so the plan
     * says so in as many words before anything is written.
     */
    plan(key, objects) {
      const sh = SHEETS[key];
      if (!sh) throw new Error('There is no "' + key + '" block on the home page.');

      const alias = {};
      sh.columns.forEach(([label, field]) => { alias[label] = field; });
      Object.assign(alias, {
        programme: 'title', name: key === 'testimonials' ? 'name' : 'title',
        price: 'priceInr', 'price (inr)': 'priceInr', features: 'features',
        active: 'active', 'button': 'cta', question: 'q', answer: 'a',
        number: 'num', label: 'label', quote: 'quote',
      });

      const unknown = Object.keys(objects[0] || {}).filter(h => !alias[h]);
      const rejected = [];
      const items = [];

      objects.forEach((o, n) => {
        const line = n + 2;
        const g = f => {
          for (const h of Object.keys(o)) if (alias[h] === f) return o[h];
          return '';
        };
        const draft = {};
        sh.columns.forEach(([, f]) => { draft[f] = g(f); });
        if (key === 'packages') {
          draft.features = list(g('features'));
          draft.sell = yes(g('sell'));
          draft.primary = yes(g('featured'));
        }

        /* One required field per block, chosen as the one whose absence means
           the row is a blank line rather than a mistake. */
        const need = { packages: 'title', stats: 'num', faq: 'q', testimonials: 'quote',
          services: 'name' }[key];
        if (!str(draft[need])) {
          rejected.push({ line, what: '(row ' + line + ')', why: ['no ' + need] });
          return;
        }
        if (key === 'packages' && draft.tab && !/^(study|work|migrate)$/i.test(str(draft.tab))) {
          rejected.push({ line, what: str(draft.title, 60),
            why: ['"' + str(draft.tab, 20) + '" is not one of study, work or migrate'] });
          return;
        }
        items.push(draft);
      });

      const grouped = key === 'packages' || key === 'services';
      const before = grouped ? get(key).items : get(key);
      const after = key === 'packages'
        ? cleanPackages({ items, tabs: get(key).tabs, eyebrow: get(key).eyebrow, heading: get(key).heading }).items
        : key === 'services'
          ? cleanServices({ items, tabs: get(key).tabs }).items
          : CLEAN[key](items);

      const idOf = x => String(sh.key === 'id' ? x.id : sh.label(x)).toLowerCase();
      const had = new Set(before.map(idOf));
      const has = new Set(after.map(idOf));

      return {
        unknownColumns: unknown,
        rejected,
        create: after.filter(x => !had.has(idOf(x))).map(x => ({ what: sh.label(x) })),
        removed: before.filter(x => !has.has(idOf(x))).map(x => ({ what: sh.label(x) })),
        kept: after.filter(x => had.has(idOf(x))).length,
        total: after.length,
        result: after,
      };
    },

    apply(key, plan, who) {
      const v = (key === 'packages' || key === 'services')
        ? Object.assign({}, get(key), { items: plan.result })
        : plan.result;
      return this.save(key, v, who);
    },
  };
}

module.exports = { makeContent, KEYS, SHEETS, cleanWriting };
