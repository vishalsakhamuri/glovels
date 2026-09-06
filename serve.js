#!/usr/bin/env node
/**
 * Glovels — local application server.
 *
 * Serves the site the way the live Apache host does, and runs the API that the
 * portal stores student data in.
 *
 * Three things a plain static server gets wrong, and this does not:
 *
 *   1. Clean URLs.  /study-in-germany serves study-in-germany.html. Every
 *      internal link is written that way, so without this rule the whole site
 *      404s locally and looks broken when it is not.
 *   2. The .html redirect. /terms.html sends you to /terms, exactly as the
 *      .htaccess does, so you cannot develop against a URL the live site will
 *      not serve.
 *   3. send.php. There is no PHP here, so the counselling form is answered by
 *      the API and the enquiry is written to the database.
 *
 * No dependencies. Node 18+.
 *
 *   node serve.js            -> http://localhost:8080
 *   node serve.js 3000       -> http://localhost:3000
 */

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const configure = require('./server/config.js');
const CFG = configure.load();

/* A port on the command line still wins, so `node serve.js 3000` behaves the
   way it always has. */
const PORT = Number(process.argv[2]) || CFG.port;
const DATA = CFG.dataDir ? path.resolve(CFG.dataDir) : path.join(ROOT, 'data');

/* Refuse to start rather than come up unsafely. A server that boots anyway and
   prints a warning is a server whose warning nobody reads. */
if (!CFG.ok) {
  console.error('\n  Refusing to start in production mode:\n');
  CFG.problems.forEach(p => console.error('    · ' + p));
  console.error('\n  Fix those and start again. See DEPLOY.md.\n');
  process.exit(1);
}

const store = require('./server/store.js');
const { makeApi, hashPassword, newSalt } = require('./server/api.js');
const seed = require('./server/seed.js');
const mailer = require('./server/mail.js');
const notifier = require('./server/notify.js');
const { Live } = require('./server/live.js');
const { makeContent } = require('./server/content.js');
const PROSE = require('./server/prose.js');
const UNIS = require('./server/unis.js');
const DAAD = require('./server/daad.js');

/* catalogue.json is now the SEED, not the source of truth. Once it is in the
   database the staff screens own it, and this file is only read again on a
   fresh install. */
let seedCat = [], seedCountries = {};
try {
  seedCat = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalogue.json'), 'utf8'));
} catch (e) {
  console.error('  ! catalogue.json missing — run: python3 build_portal.py');
}
try {
  seedCountries = JSON.parse(fs.readFileSync(path.join(ROOT, 'countries.json'), 'utf8'));
} catch (e) { /* the seeder copes with an empty set */ }

const db = store.open(DATA);
const UPLOADS = path.join(DATA, 'uploads');
/* Pictures in blog posts. Public, and on the data disk so they survive a deploy. */
const IMAGES_DIR = path.join(DATA, 'images');
const IMAGES = require('./server/images.js');

/* The shape the rest of the application expects, read fresh from the database
   every time — so a programme a counsellor adds is live on the next request
   rather than on the next restart. */
/* A stable id for "the same university", used to count distinct universities
   without naming them. Derived from the name, so two programmes at one
   university agree, and it reveals nothing a gated row was hiding. */
const uKeyOf = name => 'u' + require('crypto')
  .createHash('sha1').update(String(name || '').trim().toLowerCase()).digest('hex').slice(0, 8);

function liveCatalogue() {
  return db.programmes().map(r => ({
    id: r.id, program: r.program, university: r.university, city: r.city || '',
    country: r.country, level: r.level || '', field: r.field || '', band: r.band || '',
    isPublic: !!r.is_public, fit: r.fit || null, totalInr: r.total_inr || 0,
    /* What applying through us costs the student — free where we are
       partnered, a package where we are not. This is the object the finder AND
       the matcher are handed, so leaving it out meant a partnership marked in
       the sheet was stored, shown on the sheet, shown in the office, and
       invisible to both of the things that use it. Exactly the shape of the
       bug the CGPA comment above this one is about, one column along. */
    feeModel: r.fee_model === 'free' || r.fee_model === 'package'
      ? r.fee_model : (r.is_public ? 'package' : 'free'),
    /* The CGPA THIS programme asks for. The finder has always preferred it
       over the country's rule — and never received it, because the catalogue
       handed to the page did not carry the field. */
    minCgpa: r.min_cgpa == null ? null : Number(r.min_cgpa),
    /* The German grade the programme asks for, 1.0 best to 4.0 pass. Handed to
       the finder AND the matcher, because a bar nobody filters on is a bar
       that is only decoration. */
    germanGpa: r.german_gpa == null ? null : Number(r.german_gpa),
    url: r.url || '',
    /* What the university is CALLED — TU Dortmund, BHT Berlin. Typed by the
       office, blank outside Germany, and blank means "use the full name".
       Handed to the finder AND the matcher for the same reason the German
       grade is: a name that reaches the API and stops at the page is a column
       the office fills in for nothing. */
    shortName: r.short_name || '',
    /* Grouped on the FULL name, deliberately. The short name is a display
       choice and can be edited or cleared; keying on it would move a
       university's programmes into a different bucket the moment somebody
       typed one, and the quota counts universities. */
    uKey: uKeyOf(r.university),
    /* The office's choice of what leads the showcase on the home page. */
    featured: !!r.featured, featureSort: r.feature_sort || 0,
    /* On its university's page and in the search box, but NOT in the finder
       or on any list. See the column's note in store.js. */
    searchOnly: !!r.search_only,
    intakes: (() => { try { return JSON.parse(r.intakes); } catch (e) { return []; } })(),
  }));
}
/* The catalogue as universities, grouped once per change rather than once per
   request. A page for one university needs the whole list grouped — for its
   "other universities" and the index — and with a catalogue that is meant to
   grow to every university there is, grouping a hundred thousand rows on every
   Googlebot visit is the slow site the office was worried about. Keyed on the
   table's newest edit and its size, so an edit on the Catalogue screen is
   live on the next request, as before. */
let groupedAt = '';
let groupedList = null;
function universities() {
  const stamp = db.catalogueVersion();
  if (!groupedList || stamp !== groupedAt) {
    groupedList = UNIS.group(liveCatalogue());
    groupedAt = stamp;
  }
  return groupedList;
}
function liveCountries() {
  const out = {};
  db.countries().forEach(c => {
    let facts = {};
    /* Stored as JSON in one column. A country whose facts are unreadable gets
       an empty set rather than taking the whole catalogue endpoint down with
       it — the finder then shows the destination with no requirements panel,
       which is recoverable; a 500 on /api/catalogue is not. */
    try { facts = JSON.parse(c.facts || '{}') || {}; } catch (e) { facts = {}; }
    out[c.code] = Object.assign({}, facts,
      { code: c.code, name: c.name, flag: c.flag, region: c.region || '' });
  });
  return out;
}
const SITE_URL = CFG.siteUrl || ('http://localhost:' + PORT);

/* mail.env sits next to the server and is the only file with a password in it.
   Absent, mail is written to data/outbox/ instead of sent — which is what you
   want on a laptop, and what one.com forces anyway since they only accept SMTP
   from sites hosted with them. */
const MAIL_CFG = path.join(ROOT, 'mail.env');
/* The file OR the environment — the environment wins. On a hosted deployment
   there is no file, there is an Environment tab, and that is the right place
   for a password: nothing on disk, nothing in a repository. */
const mail = mailer.open({
  dir: DATA, configFile: MAIL_CFG, siteUrl: SITE_URL, env: process.env,
  /* And whatever an administrator saved on Organisation → Email, read fresh on
     every send so a corrected password works on the next message rather than
     after a redeploy. */
  stored: () => db.content('mail'),
});
const notify = notifier.open({
  mail,
  config: (() => {
    const cfg = {};
    try {
      fs.readFileSync(MAIL_CFG, 'utf8').split(/\r?\n/).forEach(l => {
        const t = l.trim();
        if (!t || t.startsWith('#')) return;
        const i = t.indexOf('=');
        if (i > 0) cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      });
    } catch (e) {}
    return cfg;
  })(),
  siteUrl: SITE_URL,
});
const live = new Live();

/* The home page's packages, numbers, FAQ and testimonials. content.json is the
   seed — what the page shipped with; anything edited on the Home page screen
   overrides it from the database, so a rebuild of the marketing pages cannot
   undo a counsellor's price change. */
const content = makeContent({ db, file: path.join(ROOT, 'content.json') });

/* A phone that buzzes when a student writes. The VAPID key pair is generated on
   first run and kept on the disk beside the database — regenerating it drops
   every registered device silently, so it must survive a redeploy. */
const push = require('./server/push.js').open({ db, siteUrl: SITE_URL, log: console });

const api = makeApi({ db, uploadDir: UPLOADS, imageDir: IMAGES_DIR, catalogue: liveCatalogue, countries: liveCountries,
  mail, notify, live, push, siteUrl: SITE_URL, config: CFG, content });

/* First run only: a demo account with a shortlist, documents, applications and
   an order, so there is something to look at before anyone signs up. */
const importedCat = seed.seedCatalogue({ db, catalogue: seedCat, countries: seedCountries });
const seeded = CFG.seedDemo
  ? seed.run({ db, uploadDir: UPLOADS, catalogue: liveCatalogue(), hashPassword, newSalt,
      password: CFG.demoPassword })
  : null;
const adminSeed = seed.seedAdmin({ db, admin: CFG.admin, hashPassword, newSalt,
  reset: CFG.admin.reset });
/* The blog posts already on the site, brought in as drafts to finish. Not
   behind seedDemo: these are real pages with real titles, not demo data. */
const importedPosts = seed.seedPosts({ db, root: ROOT });
seed.bumpBrowseCaps({ db });
/* Services shipped since this database was seeded. Added hidden — the office
   turns each on when there is somebody briefed to sell it. */
const newServices = seed.addMissingServices({ db, content: content.shipped() });
/* Destinations shipped since the database was seeded — the eight that came with
   their own pages. Their pages exist either way; this puts them on the
   Destinations tab so programmes can be filed under them. */
const newCountries = seed.addMissingCountries({ db, countries: seedCountries });
/* The ₹99, ₹999 and ₹4,999 tiers on a deployment seeded before they existed.
   Visible immediately — a hidden ₹99 card is the same as no ₹99 card. */
const newTiers = seed.addEntryTiers({ db, content: content.shipped() });
/* ₹99 and ₹999 shipped as packages one deploy ago and belong in Services — the
   packages section is headed "Public University Admission" and those two
   deliver private ones. Runs before addMissingServices so they arrive visible
   rather than as hidden new arrivals. */
const movedTiers = seed.moveEntryTiersToServices({ db, content: content.shipped() });
/* And the sentence that said the cheapest way to a public university name was
   ₹9,999. It is ₹4,999 — only rewritten where nobody has edited that answer. */
seed.fixCheapestPackagePrice({ db });
/* The ones priced "on request" go straight on: there is no price to get wrong
   and the only button on them starts a conversation, which is the point. */
/* Every package that names public universities now hands them over. Somebody
   who paid ₹74,999 before this ran signed in to an empty shortlist. */
const deliveringPkgs = seed.packagesDeliverWhatTheyUnlock({ db });
/* And the fourth success story that showed visitors the code that draws
   success stories, plus its twin in the FAQ. */
const phantomCards = seed.removeTheCardsThatWereSourceCode({ db });
/* And the question each studio chip asks, which did not exist when this
   deployment's writing block was seeded. */
const chipAsks = seed.chipsAskWhatItWas({ db, content: content.shipped() });
const openedServices = seed.openOnRequestServices({ db });
/* What applying to each university costs the student through us. Read off
   public-versus-private for the rows already on the shelf — we are partnered
   with the private places, so those are free to apply to, and the public names
   are what a package buys — and correctable from the catalogue sheet after. */
const feeModels = seed.everyRowSaysWhatItCosts({ db });
/* The first pass ran with that sentence backwards, so every row it touched is
   put the right way up here. Only rows still holding what it wrote. */
const feeFixed = seed.feeModelIsFreeToApply({ db });
/* Two study tabs — Germany, and the other six destinations, which have a
   ladder of their own because the German packages are all about public
   universities that only Germany has. */
const destPkgs = seed.packagesBelongToADestination({ db });
/* Bodies for the six posts that shipped as empty drafts. Never overwrites one
   somebody has started, and leaves them as drafts to read before publishing. */
const filledPosts = seed.fillEmptyPosts({ db, root: ROOT });

/*
 * One email a morning, to the people who can do something about it.
 *
 * The bell in the operations site tells somebody who is already looking. This
 * is for the deadline that arrives on a day nobody opens the screen, which is
 * the day it matters. With no SMTP configured the mailer writes .eml files to
 * data/outbox, so this works from today and starts arriving in inboxes the day
 * the mail details are filled in.
 */
const digest = require('./server/digest.js');
digest.start({
  db, mail, siteUrl: SITE_URL,
  hour: process.env.DIGEST_HOUR_IST ? Number(process.env.DIGEST_HOUR_IST) : 9,
  shell: require('./server/emails.js').shell,
});

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8',
  /* Served with the right type or the browser ignores it, and "Add to Home
     Screen" quietly falls back to a bookmark with a screenshot for an icon. */
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function send(res, code, body, type, extra) {
  const headers = {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'no-store',        // local dev: never serve a stale page
  };
  /* Only on HTTPS. Sending HSTS over plain HTTP does nothing, and sending it
     from a laptop would pin localhost to HTTPS in the developer's browser. */
  if (CFG.production) headers['Strict-Transport-Security'] = 'max-age=31536000';
  res.writeHead(code, Object.assign(headers, extra || {}));
  res.end(body);
}

function notFound(res) {
  const p = path.join(ROOT, '404.html');
  if (fs.existsSync(p)) return send(res, 404, fs.readFileSync(p), TYPES['.html']);
  send(res, 404, 'Not found');
}

/** Refuse anything that climbs out of the site folder. */
function resolveSafe(pathname) {
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, clean);
  return full.startsWith(ROOT) ? full : null;
}

/*
 * robots.txt and sitemap.xml, generated rather than shipped.
 *
 * The file on disk said "Disallow: /" — correct for a preview build, and a
 * quiet disaster on a live marketing site: the blog posts, the country pages
 * and every SEO title the office can edit would never be read by a search
 * engine at all. Generating it means the answer follows the setting instead of
 * whatever was last committed. See allowIndexing in server/config.js.
 */
function robotsTxt() {
  if (!CFG.allowIndexing) {
    return '# Not the live address yet — nothing here is for indexing.\n'
         + 'User-agent: *\nDisallow: /\n';
  }
  return [
    '# The public pages are for reading. The portal and the API are not.',
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /dashboard',
    'Disallow: /profile',
    'Disallow: /documents',
    'Disallow: /messages',
    'Disallow: /applications',
    'Disallow: /universities',
    'Disallow: /scholarships',
    'Disallow: /visa',
    'Disallow: /admin',
    'Disallow: /counsellor',
    'Disallow: /chat',
    'Disallow: /home',
    'Disallow: /catalogue',
    'Disallow: /blog-admin',
    'Disallow: /leads',
    'Disallow: /acceptance/',
    'Disallow: /login',
    'Disallow: /app/',
    'Allow: /',
    '',
    'Sitemap: ' + (CFG.siteUrl || '') + '/sitemap.xml',
    '',
  ].join('\n');
}

/**
 * Digital Asset Links, from what the office has saved.
 *
 * `android_app` + the package name + the SHA-256 of the certificate Google
 * signs the app with. More than one fingerprint is normal and not a mistake:
 * Play App Signing gives you an upload certificate and an app signing
 * certificate, and during testing a build signed with either has to verify.
 */
function assetLinks() {
  let cfg = null;
  try { cfg = db.content('androidApp'); } catch (e) { cfg = null; }
  const pkg = (cfg && cfg.package) || '';
  const prints = (cfg && Array.isArray(cfg.fingerprints) ? cfg.fingerprints : [])
    .filter(Boolean);
  if (!pkg || !prints.length) return [];
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: pkg,
      sha256_cert_fingerprints: prints,
    },
  }];
}

/* The public pages only: everything behind a sign-in is left out, and so is
   404.html, which exists to be reached by accident. */
const PORTAL_PAGES = new Set(['dashboard', 'profile', 'documents', 'messages',
  'applications', 'universities', 'scholarships', 'visa', 'admin', 'counsellor',
  'chat', 'home', 'catalogue', 'blog-admin', 'leads', 'partner', 'login', '404']);

function sitemapXml() {
  const pages = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        /* `app/` holds the installed app's own furniture — today the service
           worker's offline screen. Not pages anybody meant to publish, and a
           search result reading "You are offline" would be a bug. */
        if (name === 'data' || name === 'server' || name === 'app'
            || name.startsWith('.')) continue;
        walk(full, prefix + name + '/');
        continue;
      }
      if (!name.endsWith('.html')) continue;
      if (name.startsWith('_')) continue;          // templates, not pages
      const slug = name.slice(0, -5);
      if (!prefix && PORTAL_PAGES.has(slug)) continue;
      pages.push(prefix === '' && slug === 'index' ? '' : prefix + slug);
    }
  };
  walk(ROOT, '');
  /* The blog comes from the database, not from the files still sitting in
     post/. A draft has an address that works for staff and must not be in
     here — a sitemap is a list of pages we are asking to have indexed. */
  /* A draft written in the editor has an address that works for staff and must
     not be listed — a sitemap is a request to index. The static files that are
     already live stay, because they are already live; they are dropped the
     moment the post that replaces them is published. */
  const live = new Set(db.livePosts().map(p => 'post/' + p.slug));
  const drafted = new Set(db.allPosts().filter(p => p.status !== 'published')
    .map(p => 'post/' + p.slug));
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i];
    if (!p.startsWith('post/')) continue;
    if (live.has(p)) continue;
    if (drafted.has(p) && fs.existsSync(path.join(ROOT, p + '.html'))) continue;
    pages.splice(i, 1);
  }
  live.forEach(p => { if (!pages.includes(p)) pages.push(p); });
  /* Rendered from the database rather than sitting on disk, so the walk above
     cannot find it — and a page nobody has asked to have indexed is a page
     that will not be. */
  if (!pages.includes('success-stories')) pages.push('success-stories');
  /* The university pages, from the catalogue — every one the office has not
     taken off search. */
  pages.push('university');
  universities().forEach(u => {
    if (!UNIS.cleanExtras(db.content('university:' + u.slug)).hidden) pages.push('university/' + u.slug);
  });
  pages.sort();
  const base = CFG.siteUrl || '';
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + pages.map(p => '  <url><loc>' + base + '/' + p + '</loc></url>').join('\n')
    + '\n</urlset>\n';
}

/*
 * The noindex meta tag, taken off the public pages when the site is live.
 *
 * Every one of the fifty pages shipped with
 * `<meta name="robots" content="noindex,nofollow">` in its head — right for a
 * preview build, and the single thing that would have kept this site out of
 * Google no matter what robots.txt said. robots.txt asks a crawler not to
 * fetch; a noindex tells it not to list, and it is written per page, so fixing
 * only robots.txt would have achieved nothing at all.
 *
 * It is rewritten on the way out rather than at build time, because the build
 * has no idea which address it is going to be served from. Same setting as
 * robots.txt, one place, so the two can never disagree. The portal pages and
 * the 404 keep theirs whatever happens.
 */
/*
 * The blog, rendered here rather than shipped as files.
 *
 * Six static post pages is what a blog looks like when only a developer can
 * write one. The posts live in the database now, and /blog and /post/<slug>
 * are built from two templates on every request.
 *
 * Rendered on the SERVER, deliberately. A blog that paints itself from an API
 * after the page loads is a blog Google reads as an empty page and WhatsApp
 * previews as a headline with no description. The title, the description, the
 * keywords, the canonical, the Open Graph tags and the Article JSON-LD are in
 * the HTML before it leaves this process.
 */
const esc = PROSE.esc;

/* Who is asking, for the one case a page needs to know: a draft post is shown
   to staff and to nobody else. The API does its own session handling; this is
   the same cookie read the same way, and it is read-only. */
function whoIsIt(req) {
  const raw = req.headers.cookie || '';
  const hit = /(?:^|;\s*)glovels_session=([^;]+)/.exec(raw);
  if (!hit) return null;
  try { return db.sessionStudent(decodeURIComponent(hit[1])); } catch (e) { return null; }
}
let TPL = { post: null, index: null, page: null, at: 0 };

function templates() {
  /* Re-read when the file on disk is newer, so a rebuild shows up without a
     restart, and cached otherwise — this is on the path of every blog page. */
  const a = path.join(ROOT, 'post', '_post.tpl.html');
  const b = path.join(ROOT, '_blog.tpl.html');
  const c = path.join(ROOT, '_page.tpl.html');
  try {
    const at = Math.max(fs.statSync(a).mtimeMs, fs.statSync(b).mtimeMs,
      fs.statSync(c).mtimeMs);
    if (!TPL.post || at > TPL.at) {
      TPL = {
        post: fs.readFileSync(a, 'utf8'),
        index: fs.readFileSync(b, 'utf8'),
        page: fs.readFileSync(c, 'utf8'),
        at,
      };
    }
  } catch (e) {
    return null;                      // templates not built: fall through to files
  }
  return TPL;
}

const shownDate = iso => {
  const d = new Date(iso || Date.now());
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric' });
};

/** Fill the holes. Anything not supplied becomes an empty string, never "undefined". */
function fill(tpl, holes) {
  /* [A-Z0-9_], not [A-Z_]: the first version could not see {{H1}}, so every
     post shipped with the literal characters {{H1}} where its headline goes. */
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) =>
    (Object.prototype.hasOwnProperty.call(holes, k) ? String(holes[k] == null ? '' : holes[k]) : ''));
}

const absolute = p => (CFG.siteUrl || '') + p;

/* The picture a link preview shows when the page has not named one.
 *
 * WhatsApp, Facebook, LinkedIn and iMessage all fall back to a grey rectangle
 * with the domain in it, which is what every Glovels link pasted into a group
 * looked like. One shipped image is not as good as a picture of the thing the
 * article is about, and it is far better than nothing — so the chain runs:
 * what the writer chose, then the first picture in the post, then this. */
const DEFAULT_OG = '/og/glovels.png';

function ogTags(image, alt) {
  if (!image) return '';
  /* Absolute. A relative og:image is the single most common reason a preview
     comes back blank: the crawler is not on our site and cannot resolve it. */
  const src = /^https?:\/\//i.test(image) ? image : absolute(image);
  return '<meta property="og:image" content="' + esc(src) + '">\n'
    + '<meta property="og:image:alt" content="' + esc(alt || 'Glovels') + '">\n'
    + '<meta name="twitter:image" content="' + esc(src) + '">\n';
}

function metaHoles({ title, desc, canonical, keywords, image, imageAlt, type, jsonld,
  indexable, article }) {
  return {
    HEAD_TITLE: esc(title) + ' | Glovels',
    OG_TITLE: esc(title),
    DESC: esc(desc),
    CANONICAL: esc(canonical),
    KEYWORDS: keywords ? '<meta name="keywords" content="' + esc(keywords) + '">\n' : '',
    /* A draft being previewed must never be indexed, whatever the site
       setting says — the whole point of a preview is that it is not published. */
    ROBOTS: (CFG.allowIndexing && indexable)
      ? '<meta name="robots" content="index,follow,max-image-preview:large">'
      : '<meta name="robots" content="noindex,nofollow">',
    OG_TYPE: type || 'website',
    OG_IMAGE: ogTags(image, imageAlt),
    /* The four tags that turn a page into an article rather than a page, and
       the ones a counsellor was asked for by name. `article:modified_time` is
       the one that earns its keep: a guide corrected in March and stamped
       January reads as a year-old guide. */
    ARTICLE: article
      ? [
        article.author ? '<meta property="article:author" content="' + esc(article.author) + '">' : '',
        article.published ? '<meta property="article:published_time" content="' + esc(article.published) + '">' : '',
        article.modified ? '<meta property="article:modified_time" content="' + esc(article.modified) + '">' : '',
        article.section ? '<meta property="article:section" content="' + esc(article.section) + '">' : '',
      ].filter(Boolean).join('\n') + '\n'
      : '',
    TWITTER_CARD: image ? 'summary_large_image' : 'summary',
    JSONLD: jsonld
      ? '<script type="application/ld+json">' + JSON.stringify(jsonld)
        .replace(/</g, '\\u003c') + '</script>'
      : '',
  };
}

/** The slugs a writer picked as related, in the order they picked them. */
const relatedOf = post => String(post.related || '')
  .split(/[,\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 6);

/* Two dates are the same day, so "updated on" is not printed against a post
   nobody has touched since it went up. */
const sameDay = (a, b) => shownDate(a) === shownDate(b);

function postPage(post, isDraft) {
  const t = templates();
  if (!t) return null;
  const url_ = absolute('/post/' + post.slug);
  const title = post.meta_title || post.title;
  const desc = post.meta_desc || post.excerpt || PROSE.summarise(post.body);
  /* What the writer chose, then the first picture in the article, then the one
     the site ships — so a link pasted into a WhatsApp group is never a grey
     rectangle. */
  const inBody = PROSE.images(post.body)[0];
  const image = post.og_image || post.cover || (inBody && inBody.src) || DEFAULT_OG;
  const imageAlt = (post.og_image || post.cover) ? post.title
    : (inBody && inBody.alt) || post.title;

  const published = post.published_at || post.created_at;
  const modified = post.updated_at || published;

  /* Who wrote it, when it went up, and when it was last put right. All three
     were asked for, and the third is the one that matters to a reader deciding
     whether a fee or a deadline on the page can still be trusted. */
  const byline = '<div class="byline">'
    + (post.author ? '<span>By <b>' + esc(post.author) + '</b></span>' : '')
    + '<span>Published <b>' + esc(shownDate(published)) + '</b></span>'
    + (isDraft || sameDay(modified, published) ? ''
      : '<span class="upd">Updated <b>' + esc(shownDate(modified)) + '</b></span>')
    + '<span>' + (post.read_mins || 1) + ' min read</span>'
    + '</div>';

  /* Chosen when the post was written, not computed from tags: "related posts
     should be selected while writing the blog". A slug that has since been
     unpublished simply does not appear — a related link to a 404 is worse than
     one fewer link. */
  const live = new Map(db.livePosts().map(p => [p.slug, p]));
  const related = relatedOf(post)
    .filter(s => s !== post.slug).map(s => live.get(s)).filter(Boolean);
  const relatedBlock = related.length
    ? '<div class="postfoot"><h2>Read next</h2><ul class="related">'
      + related.map(p => '<li><a href="' + esc(p.slug) + '">'
        + '<b>' + esc(p.title) + '</b>'
        + '<span>' + esc(PROSE.summarise(p.excerpt || p.body, 105)) + '</span>'
        + '</a></li>').join('')
      + '</ul></div>'
    : '';

  /* The cover, printed under the headline when the office chose one. A
     relative address is fine here — the page is at /post/<slug> and the
     picture at /images/<name>, both absolute paths. */
  const coverBlock = PROSE.safeImg(post.cover || '')
    ? '<figure class="cover"><img src="' + esc(post.cover) + '" alt="' + esc(post.title)
      + '" decoding="async"></figure>'
    : '';

  const body =
      byline
    + (post.excerpt ? '<p class="lead">' + esc(post.excerpt) + '</p>' : '')
    + coverBlock
    + (isDraft
        ? '<div style="margin:0 0 18px;padding:12px 15px;border-radius:11px;'
          + 'background:#fdf6e6;border:1px solid #e6d5a8;color:#5b4409;'
          + 'font:600 13px/1.6 system-ui,sans-serif">This is a draft. It is not on the '
          + 'site, it is not in the sitemap, and search engines are told to skip it.</div>'
        : '')
    + PROSE.render(post.body)
    + relatedBlock;

  return fill(t.post, Object.assign(metaHoles({
    title, desc, canonical: url_, keywords: post.keywords, image, imageAlt,
    type: 'article', indexable: !isDraft,
    article: {
      author: post.author || 'Glovels',
      published, modified, section: post.tag || '',
    },
    jsonld: {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description: desc, url: url_,
      datePublished: published,
      dateModified: modified,
      author: post.author
        ? { '@type': 'Person', name: post.author }
        : { '@type': 'Organization', name: 'Glovels' },
      publisher: { '@type': 'Organization', name: 'Glovels' },
      mainEntityOfPage: url_,
      image: /^https?:\/\//i.test(image) ? image : absolute(image),
      keywords: post.keywords || undefined,
    },
  }), {
    H1: esc(post.title),
    DATELINE: esc(shownDate(published))
      + ' &middot; ' + (post.read_mins || 1) + ' min read'
      + (post.author ? ' &middot; ' + esc(post.author) : ''),
    BODY: body,
  }));
}

/*
 * What the blog index lists.
 *
 * Published posts, and the pages that are ALREADY on glovels.com — the six
 * static files that were the blog before this. Those came in as drafts to
 * finish, and dropping them off the index the day the database took over would
 * quietly take six live pages off the site. They stay listed, and still serve
 * from their file, until the post that replaces them is published; then the
 * database version wins and the file is never reached again.
 */
function blogList() {
  const live = db.livePosts();
  const shown = new Set(live.map(p => p.slug));
  const stillOnDisk = db.allPosts().filter(p =>
    !shown.has(p.slug) && p.status !== 'published'
    && fs.existsSync(path.join(ROOT, 'post', p.slug + '.html')));
  return live.concat(stillOnDisk).sort((a, b) =>
    String(b.published_at || b.created_at).localeCompare(String(a.published_at || a.created_at)));
}

function blogIndexPage(posts) {
  const t = templates();
  if (!t) return null;
  const cards = posts.map(p =>
    '<a class="postcard" href="post/' + esc(p.slug) + '">'
    + (PROSE.safeImg(p.cover || '')
        ? '<img class="thumb" src="' + esc(p.cover) + '" alt="" loading="lazy" decoding="async">'
        : '')
    + '<div class="postmeta">' + esc(shownDate(p.published_at || p.created_at))
      + ' &middot; ' + (p.read_mins || 1) + ' min'
      + (p.tag ? ' &middot; ' + esc(p.tag) : '') + '</div>'
    + '<h3>' + esc(p.title) + '</h3>'
    + '<p>' + esc(p.excerpt || PROSE.summarise(p.body)) + '</p></a>').join('');

  return fill(t.index, Object.assign(metaHoles({
    title: 'Blog — study-abroad guides for Indian students',
    desc: 'Guides on public universities, blocked accounts, CGPA cut-offs and '
        + 'deadlines — the questions students actually ask.',
    canonical: absolute('/blog'),
    keywords: 'study abroad blog, public universities germany, blocked account, '
            + 'student visa india',
    type: 'website', indexable: true,
    image: DEFAULT_OG, imageAlt: 'Glovels — public universities abroad',
    jsonld: {
      '@context': 'https://schema.org', '@type': 'Blog',
      name: 'Glovels blog', url: absolute('/blog'),
      blogPost: posts.slice(0, 20).map(p => ({
        '@type': 'BlogPosting', headline: p.title,
        url: absolute('/post/' + p.slug),
        datePublished: p.published_at || p.created_at,
      })),
    },
  }), {
    H1: 'The blog',
    DATELINE: 'Guides on public universities, blocked accounts, CGPA cut-offs and '
      + 'deadlines — the questions students actually ask.',
    BODY: cards || '<p style="color:var(--muted)">Nothing published yet. '
      + 'The first guides are being written.</p>',
  }));
}

/*
 * A page for each university, and the list of them.
 *
 * Rendered from the live catalogue on request — see server/unis.js. Nothing
 * here is in index.html; the finder links to it with "More details" and a
 * search engine reaches it through the sitemap.
 */
const UNI_CSS = `<style>/* GLOVELS-UNI-CSS */
.uni-lead{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 18px}
.uni-lead .pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:99px;
  font:700 11.6px/1.3 var(--sans);letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--line);
  background:var(--paper)}
.uni-lead .pill.pub{color:#14603a;border-color:#bfe0cc;background:#eaf6ee}
.uni-lead .pill.priv{color:#5b4409;border-color:#e6d5a8;background:#fdf6e6}
.uni-lead a.pill.daad{color:#0b3d91;border-color:#b9cdf0;background:#eef3fc;text-decoration:none}
.daadbox{margin:0 0 22px;padding:13px 16px;border-radius:12px;background:#eef3fc;border:1px solid #b9cdf0;
  font:400 13.6px/1.65 var(--sans);color:var(--navy-800)}
.daadbox a{font-weight:700;color:#0b3d91}
.factbox{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:18px 0 26px}
.factbox>div{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.factbox span{display:block;font:600 11.2px/1.4 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.factbox b{display:block;margin-top:4px;font:700 15.5px/1.35 var(--sans);color:var(--navy-900)}
.uni-cover{margin:0 0 24px}
.uni-cover img{display:block;width:100%;aspect-ratio:16/8;object-fit:cover;border-radius:14px;border:1px solid var(--line);background:#f2f5f9}
.progs{display:grid;gap:12px;margin:14px 0 8px}
.prog{display:grid;grid-template-columns:1fr auto;gap:12px 18px;align-items:center;background:var(--paper);
  border:1px solid var(--line);border-radius:14px;padding:15px 17px}
.prog h3{margin:0;font-size:16px;line-height:1.3;color:var(--navy-900)}
.prog .meta{margin:5px 0 0;font:400 12.8px/1.6 var(--sans);color:var(--muted)}
.prog .meta b{color:var(--navy-800);font-weight:700}
.prog .act{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center}
.prog .act a.course{font:600 12.4px/1.4 var(--sans);color:var(--navy-700)}
@media (max-width:600px){.prog{grid-template-columns:1fr}.prog .act{justify-content:flex-start}}
.uni-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:14px 0 6px;padding:0;list-style:none}
.uni-steps li{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font:400 13.4px/1.6 var(--sans);color:var(--navy-800)}
.uni-steps li b{display:block;font:700 13.6px/1.4 var(--sans);color:var(--navy-900);margin-bottom:4px}
.utabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}
.utab{padding:8px 14px;border:1px solid var(--line);border-radius:99px;background:var(--paper);font:700 12.6px/1.3 var(--sans);color:var(--navy-800);cursor:pointer}
.utab.on{background:var(--navy-900);border-color:var(--navy-900);color:#fff}
.upkgs{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:14px 0 8px}
.upkg{position:relative;display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px 18px 16px}
.upkg.featured{border-color:var(--navy-700);box-shadow:0 10px 28px rgba(11,30,49,.10)}
.upkg .ribbon{position:absolute;top:-11px;left:16px;background:var(--navy-700);color:#fff;font:700 10.6px/1.3 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:99px}
.upkg h3{margin:0 0 6px;font-size:17px;line-height:1.3;color:var(--navy-900)}
.upkg p{margin:0 0 10px;font:400 13px/1.55 var(--sans);color:var(--muted)}
.upkg .quota{font:700 12.4px/1.4 var(--sans);color:var(--navy-700);margin:0 0 10px}
.upkg ul{margin:0 0 14px;padding-left:18px;font:400 12.8px/1.55 var(--sans);color:var(--navy-800)}
.upkg ul li{margin:0 0 4px}
.upkg .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--line)}
.upkg .price{font:700 20px/1.2 var(--serif,Georgia,serif);color:var(--navy-900)}
.upkg .price .from{display:block;font:600 10.6px/1.3 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.upkg .price .note{display:block;font:400 11.6px/1.4 var(--sans);color:var(--muted)}
.uni-others{columns:2;column-gap:28px;padding-left:18px;margin:12px 0 0}
@media (max-width:600px){.uni-others{columns:1}}
.uni-others li{break-inside:avoid;margin:0 0 7px;font-size:14px}
.ulist{list-style:none;padding:0;margin:14px 0 30px;display:grid;gap:10px}
.ulist li a{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;background:var(--paper);
  border:1px solid var(--line);border-radius:12px;padding:13px 16px;text-decoration:none;color:inherit}
.ulist li a:hover{border-color:var(--navy-700)}
.ulist b{font:700 15px/1.35 var(--sans);color:var(--navy-900)}
.ulist small{display:block;margin-top:3px;font:400 12.4px/1.5 var(--sans);color:var(--muted)}
.ulist .n{font:700 12px/1.3 var(--sans);color:var(--navy-700);white-space:nowrap}
/* The apply sheet */
.apsheet{position:fixed;inset:0;background:rgba(6,18,30,.55);display:none;align-items:center;justify-content:center;z-index:500;padding:18px}
.apsheet.on{display:flex}
.apsheet .box{background:#fff;border-radius:16px;max-width:440px;width:100%;padding:22px 22px 18px;box-shadow:0 24px 60px rgba(0,0,0,.3)}
.apsheet h2{margin:0 0 4px;font-size:19px}
.apsheet p{margin:0 0 14px;font:400 13.2px/1.6 var(--sans);color:var(--muted)}
.apsheet label{display:block;font:600 12.4px/1.4 var(--sans);color:var(--navy-800);margin:10px 0 4px}
.apsheet input{width:100%;padding:10px 12px;border:1.5px solid #d8dde4;border-radius:9px;font:400 14px/1.4 var(--sans)}
.apsheet .row{display:flex;gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap}
.apsheet .said{font:600 12.6px/1.5 var(--sans);margin-top:10px}
.apsheet .said.bad{color:#7a2118}.apsheet .said.ok{color:#14603a}
/* The name search on the /university list — the finder's, with its own home. */
.usearch{position:relative;margin:0 0 22px}
.usearch>svg{position:absolute;left:14px;top:15px;width:17px;height:17px;color:var(--muted);pointer-events:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.usearch input{width:100%;height:48px;padding:0 14px 0 40px;border:1.5px solid var(--line);border-radius:12px;
  background:var(--cream,#faf8f3);font:400 14.4px/1.4 var(--sans);color:var(--navy-900)}
.usearch input:focus{outline:none;border-color:var(--navy-700);background:#fff}
.usearch .fsres{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:60;background:#fff;border:1px solid var(--line);
  border-radius:14px;box-shadow:0 18px 40px rgba(10,30,60,.14);max-height:420px;overflow-y:auto;padding:6px}
.usearch .fsres h5{margin:8px 12px 4px;font:700 10.8px/1.3 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.usearch .fsres a{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:9px 12px;border-radius:9px;text-decoration:none;color:inherit}
.usearch .fsres a:hover,.usearch .fsres a:focus{background:#f0f5fb;outline:none}
.usearch .fsres a b{font:700 13.6px/1.35 var(--sans);color:var(--navy-900)}
.usearch .fsres a small{display:block;font:400 12px/1.4 var(--sans);color:var(--muted)}
.usearch .fsres a span.n{font:700 11.6px/1.3 var(--sans);color:var(--navy-700);white-space:nowrap}
.usearch .fsres .none{padding:12px;font:400 13px/1.5 var(--sans);color:var(--muted)}
</style>`;

/* The search box on the /university list. The list shows the universities
   the office put on the site; every other university in the catalogue has a
   page too, and this is how a student reaches one without Google. The same
   /api/universities/search the home page asks. */
const USEARCH_HTML = '<div class="usearch" id="uSearchWrap">'
  + '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
  + '<label for="uSearch" class="offscreen" style="position:absolute;left:-9999px">Search every university and programme by name</label>'
  + '<input id="uSearch" type="search" autocomplete="off" spellcheck="false" '
  + 'placeholder="Search every university and programme we track — by name, city or subject">'
  + '<div class="fsres" id="uSearchRes" hidden role="listbox"></div></div>';
const USEARCH_JS = `<script>(function(){
  var box = document.getElementById('uSearch'), out = document.getElementById('uSearchRes');
  if (!box || !out) return;
  var t = null, last = '';
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function draw(d) {
    var U = d.universities || [], P = d.programmes || [];
    if (!U.length && !P.length) {
      out.innerHTML = '<div class="none">Nothing by that name yet. <a href="/#counsel" style="display:inline;padding:0">Ask a counsellor</a> — we add universities on request.</div>';
      out.hidden = false; return;
    }
    out.innerHTML = (U.length ? '<h5>Universities</h5>' + U.map(function (u) {
        return '<a href="' + esc(u.url) + '"><span><b>' + esc(u.name) + '</b><small>'
          + esc([u.city, u.countryName].filter(Boolean).join(', ')) + '</small></span>'
          + '<span class="n">' + u.programmes + ' programme' + (u.programmes === 1 ? '' : 's') + ' \u2192</span></a>'; }).join('') : '')
      + (P.length ? '<h5>Programmes</h5>' + P.map(function (p) {
        return '<a href="' + esc(p.url) + '"><span><b>' + esc(p.program) + '</b><small>'
          + esc(p.university) + ' \u00b7 ' + esc(p.countryName) + '</small></span><span class="n">Open \u2192</span></a>'; }).join('') : '');
    out.hidden = false;
  }
  function ask() {
    var q = box.value.trim();
    if (q.length < 2) { out.hidden = true; return; }
    if (q === last) { out.hidden = false; return; }
    last = q;
    fetch('/api/universities/search?q=' + encodeURIComponent(q)).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && box.value.trim() === q) draw(d); }).catch(function () {});
  }
  box.addEventListener('input', function () { clearTimeout(t); t = setTimeout(ask, 180); });
  box.addEventListener('focus', function () { if (box.value.trim().length >= 2) ask(); });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { out.hidden = true; return; }
    var a = out.querySelector('a');
    if (e.key === 'ArrowDown' && !out.hidden && a) { e.preventDefault(); a.focus(); }
    if (e.key === 'Enter' && !out.hidden && a) { e.preventDefault(); location.href = a.href; }
  });
  out.addEventListener('keydown', function (e) {
    var links = [].slice.call(out.querySelectorAll('a')), i = links.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < links.length - 1) { e.preventDefault(); links[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? links[i - 1] : box).focus(); }
    if (e.key === 'Escape') { out.hidden = true; box.focus(); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#uSearchWrap')) out.hidden = true; });
})();</script>`;

/* Apply, from a university page. Signed-in students go on their own shortlist
   (the server checks the package); everybody else fills three boxes and a
   counsellor calls. The same /api/apply the finder uses — one rule, one place. */
const UNI_JS = `<div class="apsheet" id="apSheet" role="dialog" aria-modal="true" aria-labelledby="apT">
<div class="box"><h2 id="apT">Apply</h2><p id="apLead"></p>
<form id="apForm" novalidate>
<label for="apName">Your name</label><input id="apName" autocomplete="name" required>
<label for="apEmail">Email</label><input id="apEmail" type="email" autocomplete="email" required>
<label for="apPhone">Mobile (India)</label><input id="apPhone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="98xxxxxxxx" required>
<div class="row"><button class="btn btn-primary" type="submit" id="apGo">Send</button>
<button class="btn btn-ghost" type="button" id="apClose">Cancel</button></div>
<div class="said" id="apSaid" role="status"></div>
<p style="margin:12px 0 0;font-size:11.6px">By sending you agree to be contacted about this application. <a href="../privacy.html">Privacy</a>.</p>
</form></div></div>
<script>
(function(){
  var sheet = document.getElementById('apSheet'), form = document.getElementById('apForm');
  var said = document.getElementById('apSaid'), cur = null;
  function post(body){
    return fetch('/api/apply', { method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({ sourcePage: location.pathname,
        referrer: document.referrer || 'direct' }, body)) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){
        if (!r.ok) { var e = new Error(d.error || 'That did not go through.'); e.needsPackage = !!d.needsPackage; throw e; }
        return d; }); });
  }
  function say(msg, cls){ said.textContent = msg; said.className = 'said ' + (cls || ''); }
  function open(b){
    cur = b; say('');
    document.getElementById('apT').textContent = 'Apply to ' + b.dataset.uni;
    document.getElementById('apLead').textContent = b.dataset.prog
      + '. Three details and a counsellor calls you back within one working day to start it.';
    sheet.classList.add('on');
    document.getElementById('apName').focus();
  }
  function shut(){ sheet.classList.remove('on'); }
  document.getElementById('apClose').onclick = shut;
  sheet.addEventListener('click', function(e){ if (e.target === sheet) shut(); });
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-apply]');
    if (!b) return;
    e.preventDefault();
    b.disabled = true;
    post({ id: b.dataset.apply }).then(function(d){
      b.disabled = false;
      /* Nobody signed in, at a with-a-package university: what the home page
         does for a locked row — the package is the way in, so show the
         packages on this page rather than a form nobody can act on yet. A
         free university gets the three-detail form, as on the home page. A
         signed-in student never lands here: their apply went on their list,
         or the server said it needs a package (below). */
      if (d.needDetails && b.dataset.fee === 'package' && document.getElementById('packages')) {
        var why = document.getElementById('pkgWhy');
        var note = document.getElementById('apNeed') || (function(){
          var d2 = document.createElement('div'); d2.id = 'apNeed'; d2.className = 'daadbox';
          d2.style.borderColor = '#e6d5a8'; d2.style.background = '#fdf6e6';
          why.parentNode.insertBefore(d2, why); return d2; })();
        note.innerHTML = '<b>' + b.dataset.prog.replace(/</g, '&lt;') + '</b> is applied to through a package. '
          + 'Choose one below — it opens at the checkout, and a counsellor files this application as part of it.';
        document.getElementById('packages').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (d.needDetails) return open(b);
      if (d.signedIn) {
        b.textContent = d.already ? 'On your list' : 'Added to your list';
        b.classList.add('btn-ghost');
        var go = document.createElement('a'); go.className = 'course'; go.href = '../dashboard.html';
        go.textContent = 'Open your dashboard'; b.parentNode.appendChild(go);
      }
    }).catch(function(err){
      b.disabled = false;
      if (err.needsPackage) {
        /* What the home page says in its modal, said here above the packages
           that are already on the page — then scroll to them. */
        var why = document.getElementById('pkgWhy');
        var box = document.getElementById('apNeed') || (function(){
          var d = document.createElement('div'); d.id = 'apNeed'; d.className = 'daadbox';
          d.style.borderColor = '#e6d5a8'; d.style.background = '#fdf6e6';
          (why || document.getElementById('programmes')).parentNode.insertBefore(d, why || document.getElementById('programmes'));
          return d; })();
        box.innerHTML = '<b>That one needs a package.</b> ' + String(err.message).replace(/</g, '&lt;');
        var h = document.getElementById('packages') || box;
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      alert(err.message);
    });
  });
  form.addEventListener('submit', function(e){
    e.preventDefault();
    if (!cur) return;
    var name = document.getElementById('apName').value.trim();
    var email = document.getElementById('apEmail').value.trim();
    var phone = document.getElementById('apPhone').value.trim();
    if (!name || !email || !phone) return say('All three are needed to call you back.', 'bad');
    var go = document.getElementById('apGo'); go.disabled = true;
    post({ id: cur.dataset.apply, name: name, email: email, phone: phone, consent: 'apply' })
      .then(function(d){
        go.disabled = false;
        say('Sent. A counsellor will call you within one working day about ' + cur.dataset.uni + '.', 'ok');
        cur.textContent = 'Applied'; cur.disabled = true;
        setTimeout(shut, 2600);
      })
      .catch(function(err){ go.disabled = false; say(err.message, 'bad'); });
  });
})();
</script>`;

const SEASON = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const dateShort = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Everything the page needs about one university, or null. */
function universityOf(slug) {
  const u = universities().find(x => x.slug === String(slug)) || null;
  if (!u) return null;
  u.extras = UNIS.cleanExtras(db.content('university:' + u.slug));
  return u;
}

function universityPage(u) {
  const t = templates();
  if (!t) return null;
  const countries = liveCountries();
  const c = countries[u.country] || { name: u.country, flag: '' };
  const x = u.extras || UNIS.cleanExtras(null);
  const url_ = absolute('/university/' + u.slug);
  const n = u.programmes.length;
  const called = u.shortName && u.shortName !== u.name ? u.shortName : '';
  const free = u.feeModel === 'free';
  /* The DAAD listing for this institution — Germany's own register of what
     it offers internationally. German universities only; typed on the
     University pages tab, or shipped in daad.js. */
  const daad = DAAD.daadUrl(u.slug, x.daad);

  const feeLine = u.feeMin === 0 && u.feeMax === 0 ? 'No tuition — public university'
    : u.feeMin === u.feeMax ? UNIS.money(u.feeMin)
    : (u.feeMin === 0 ? '₹0 to ' : UNIS.money(u.feeMin) + ' to ') + UNIS.money(u.feeMax);

  const title = x.metaTitle
    || (called ? called + ' (' + u.name + ')' : u.name) + ' — courses, fees & deadlines';
  const desc = x.metaDesc
    || u.name + (u.city ? ' in ' + u.city : '') + ', ' + c.name + ': ' + n + ' programme'
      + (n === 1 ? '' : 's') + ' for Indian students — ' + feeLine.toLowerCase()
      + (u.seasons.length ? ', ' + u.seasons.map(SEASON).join(' and ').toLowerCase() + ' intake' + (u.seasons.length > 1 ? 's' : '') : '')
      + ', the CGPA you need, and how to apply' + (free ? ' free through Glovels.' : ' with Glovels.');

  /* The next deadline across every programme, for the fact box. */
  const soonest = u.programmes.flatMap(p => (p.intakes || []).filter(i => i && i.deadline)
    .map(i => ({ season: i.season, at: UNIS.nextOn(i.deadline) }))).filter(i => i.at)
    .sort((a, b) => a.at - b.at)[0];

  const cgpa = u.minCgpa != null ? u.minCgpa.toFixed(1) + '+ on 10'
    : (u.isPublic && c.minCgpaPublic ? c.minCgpaPublic + '+ on 10 (' + c.name + ' public)'
      : (!u.isPublic && c.minCgpaPrivate ? c.minCgpaPrivate + '+ on 10' : 'Assessed on your profile'));

  const facts = [
    ['Programmes we track', n + (n === 1 ? ' programme' : ' programmes')],
    ['Type', u.isPublic ? 'Public university' : 'Private university'],
    ['Applying through Glovels', free ? 'Free — we are partnered' : 'With a package'],
    ['Total cost', feeLine],
    ['Intakes', u.seasons.length ? u.seasons.map(SEASON).join(' & ') : 'Ask a counsellor'],
    ['Next deadline', soonest ? SEASON(soonest.season) + ' · ' + dateShort(soonest.at) : '—'],
    ['CGPA', cgpa],
    u.germanGpa != null ? ['German grade', 'up to ' + u.germanGpa.toFixed(1)] : null,
    ['City', (u.city ? u.city + ', ' : '') + c.name],
  ].filter(Boolean);

  const about = x.about
    ? PROSE.render(x.about)
    : '<p>' + esc(u.name) + ' is a ' + (u.isPublic ? 'public' : 'private') + ' university'
      + (u.city ? ' in ' + esc(u.city) : '') + ', ' + esc(c.name) + '. Glovels tracks '
      + n + ' programme' + (n === 1 ? '' : 's') + ' here'
      + (u.fields.length ? ' in ' + esc(u.fields.slice(0, 4).join(', ')) : '') + ', with '
      + (u.tuitionFree ? 'no tuition fees' : 'total costs from ' + esc(UNIS.money(u.feeMin)))
      + (u.seasons.length ? ' and ' + esc(u.seasons.map(SEASON).join(' and ').toLowerCase())
        + ' intake' + (u.seasons.length > 1 ? 's' : '') : '')
      + '. ' + (free
        ? 'We are partnered with the university, so applying through Glovels costs you nothing — '
          + 'a counsellor checks your profile, prepares the file and follows it up.'
        : 'Applications here are filed by a counsellor as part of a Glovels package: the '
          + 'shortlist, the SOP and the follow-up are done for you.')
      + '</p>';

  const progs = u.programmes.map(p => {
    const dl = (p.intakes || []).filter(i => i && i.deadline)
      .map(i => ({ season: i.season, at: UNIS.nextOn(i.deadline) })).filter(i => i.at)
      .sort((a, b) => a.at - b.at);
    const fee = Number(p.totalInr) || 0;
    const courseUrl = /^https?:\/\//i.test(String(p.url || '')) ? p.url : '';
    const fm = p.feeModel === 'free' || p.feeModel === 'package' ? p.feeModel
      : (p.isPublic ? 'package' : 'free');
    return '<article class="prog" id="' + esc(UNIS.slugOf(p.program)) + '">'
      + '<div><h3>' + esc(p.program) + '</h3><p class="meta">'
      + '<b>' + esc(UNIS.levelOf(p.level)) + '</b>'
      + (p.field ? ' · ' + esc(p.field) : '')
      + ' · <b>' + (fee ? esc(UNIS.money(fee)) + ' total' : 'No tuition') + '</b>'
      + (dl.length ? ' · ' + dl.map(d => esc(SEASON(d.season)) + ' intake, apply by '
        + esc(dateShort(d.at))).join('; ') : '')
      + (p.minCgpa != null ? ' · CGPA ' + esc(Number(p.minCgpa).toFixed(1)) + '+' : '')
      + (p.germanGpa != null ? ' · German grade up to ' + esc(Number(p.germanGpa).toFixed(1)) : '')
      + '</p></div>'
      + '<div class="act">'
      + (courseUrl ? '<a class="course" href="' + esc(courseUrl) + '" target="_blank" rel="noopener nofollow">Course page ↗</a>' : '')
      + '<button type="button" class="btn btn-sm ' + (fm === 'free' ? 'btn-primary' : 'btn-gold')
        + '" data-apply="' + esc(p.id) + '" data-fee="' + fm + '" data-uni="' + esc(u.name) + '" data-prog="' + esc(p.program) + '">'
        + (fm === 'free' ? 'Apply free' : 'Apply') + '</button>'
      + '</div></article>';
  }).join('');

  /* Only the ones the office put on the site. A search-only university is
     reached from Google and the search box, not from a list — a list of
     every university in the catalogue is what "search only" exists to avoid. */
  const others = universities().filter(o => o.listed && o.country === u.country && o.slug !== u.slug);
  const othersBlock = others.length
    ? '<h2>Other universities in ' + esc(c.name) + '</h2><ul class="uni-others">'
      + others.slice(0, 40).map(o => '<li><a href="' + esc(o.slug) + '">' + esc(o.name) + '</a>'
        + ' <span style="color:var(--muted);font-size:12.4px">· ' + o.programmes.length
        + ' programme' + (o.programmes.length === 1 ? '' : 's') + '</span></li>').join('')
      + '</ul>'
    : '';

  const body =
      '<div class="uni-lead">'
    + '<span class="pill ' + (u.isPublic ? 'pub' : 'priv') + '">' + (u.isPublic ? 'Public' : 'Private') + '</span>'
    + '<span class="pill">' + esc(c.flag ? c.flag + ' ' : '') + esc(c.name) + '</span>'
    + (u.city ? '<span class="pill">' + esc(u.city) + '</span>' : '')
    + '<span class="pill">' + n + ' programme' + (n === 1 ? '' : 's') + '</span>'
    + (u.url ? '<a class="pill" href="' + esc(u.url) + '" target="_blank" rel="noopener nofollow">Official site ↗</a>' : '')
    + (daad ? '<a class="pill daad" href="' + esc(daad) + '" target="_blank" rel="noopener">DAAD listing ↗</a>' : '')
    + '</div>'
    + (PROSE.safeImg(x.cover) ? '<figure class="uni-cover"><img src="' + esc(x.cover) + '" alt="' + esc(u.name) + '" decoding="async"></figure>' : '')
    + '<div class="factbox">' + facts.map(f => '<div><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b></div>').join('') + '</div>'
    + '<h2>About ' + esc(called || u.name) + '</h2>' + about
    + (daad
        ? '<div class="daadbox"><b>On the DAAD.</b> ' + esc(called || u.name) + ' is listed in the DAAD\'s '
          + 'International Programmes database — the German Academic Exchange Service\'s own register of '
          + 'what German universities offer international students. '
          + '<a href="' + esc(daad) + '" target="_blank" rel="noopener">See every programme it lists for '
          + esc(called || u.name) + ' ↗</a> — the fees, deadlines and language requirements there are the '
          + 'university\'s own words.</div>'
        : '')
    + '<h2 id="programmes">Programmes at ' + esc(called || u.name) + '</h2>'
    + '<p>Every programme below is one we have placed students in or checked ourselves. '
      + 'Fees are the total for the whole course, in rupees at today\'s rate; deadlines are the '
      + 'university\'s and come round every year.</p>'
    + '<div class="progs">' + progs + '</div>'
    + packagesBlock(u, c)
    + '<h2>How applying works</h2>'
    + '<ol class="uni-steps">'
    + '<li><b>1. Press Apply</b>Three details, and a counsellor calls you within one working day. '
      + 'Signed in already? It goes straight onto your list.</li>'
    + '<li><b>2. Your profile is read properly</b>Marksheets, backlogs, tests. You are told which '
      + 'programmes here you actually clear before anything is filed.</li>'
    + '<li><b>3. We file it</b>' + (free
        ? 'Free at this university — we are partnered with it, so the application, the SOP and the follow-up cost you nothing.'
        : 'Through a Glovels package: SOP, documents, the application itself and every follow-up until the decision.')
      + '</li>'
    + '</ol>'
    + '<p style="margin-top:22px"><a class="btn btn-primary" href="../index.html#counsel">Book free counselling</a> '
    + '<a class="btn btn-ghost" href="../index.html#results">See how you match</a></p>'
    + othersBlock
    + '<p style="margin-top:26px"><a class="btn btn-ghost" href="../university">All universities</a></p>';

  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'CollegeOrUniversity',
    name: u.name, alternateName: called || undefined, url: u.url || url_,
    address: { '@type': 'PostalAddress', addressLocality: u.city || undefined, addressCountry: u.country },
    sameAs: [u.url, daad].filter(Boolean),
  }, {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absolute('/') },
      { '@type': 'ListItem', position: 2, name: 'Universities', item: absolute('/university') },
      { '@type': 'ListItem', position: 3, name: u.name, item: url_ },
    ],
  }];

  const page = fill(t.page, Object.assign(metaHoles({
    title, desc, canonical: url_,
    keywords: [u.name, called, u.city, c.name, 'study in ' + c.name, 'fees', 'admission', 'Indian students']
      .filter(Boolean).join(', '),
    image: PROSE.safeImg(x.cover) ? x.cover : DEFAULT_OG,
    imageAlt: u.name, type: 'website', indexable: !x.hidden,
    jsonld: jsonld[0],
  }), {
    H1: esc(u.name),
    DATELINE: esc((called ? called + ' · ' : '') + (u.isPublic ? 'Public university' : 'Private university')
      + (u.city ? ' in ' + u.city : '') + ', ' + c.name + ' · ' + n + ' programme' + (n === 1 ? '' : 's')),
    CRUMBS: '<a href="../index.html">Home</a> / <a href="../university">Universities</a> / ' + esc(called || u.name),
    BODY: body,
  }));
  /* The breadcrumb record beside the university's own, the stylesheet, and
     the apply sheet. */
  return rootLinks(page.replace('</head>', UNI_CSS + '<script type="application/ld+json">'
      + JSON.stringify(jsonld[1]).replace(/</g, '\\u003c') + '</script>\n</head>')
    .replace('</body>', UNI_JS + '</body>'));
}

/*
 * The page template's links are written for a page at the root — `about-us.html`,
 * `index.html#counsel` — and this page lives one level down at
 * /university/<slug>, where the browser resolves them to
 * /university/about-us.html and every menu link is a 404. ("Home is not coming
 * after going to a university page.") So every relative page link becomes a
 * root one: `index.html` → `/`, `about-us.html` → `/about-us`, `../x.html` the
 * same. Links to other universities (`href="tu-munich"`), anchors, mailto and
 * full addresses are left alone.
 */
function rootLinks(html) {
  return html.replace(/href="(?:\.\.\/)?([a-z0-9][a-z0-9-]*)\.html(#[^"]*)?"/g, (m, name, hash) =>
    'href="' + (name === 'index' ? '/' : '/' + name) + (hash || '') + '"')
    .replace(/href="\.\.\/university"/g, 'href="/university"')
    .replace(/(href|src)="(?:\.\.\/)?(favicon\.png|og\/[^"]+|assets\/[^"]+|app\.webmanifest|icon-\d+\.png)"/g,
      (m, attr, file) => attr + '="/' + file + '"');
}

/*
 * The packages a student at THIS university would buy.
 *
 * "Packages or other-country packages are not showing when the university is
 *  not free to apply." A university we are not partnered with is applied to
 * through a package, and the page said so and pointed at the home page. Now
 * the packages themselves are on the page: Germany's own set for a German
 * university, the Other-countries set for the rest, priced as the office has
 * them today, each button opening that package's checkout on the home page.
 * A free-to-apply university gets none — Apply is the button there.
 */
function packagesBlock(u, country) {
  /* A free-to-apply university needs none: Apply is the button there, and it
     behaves as it does on the home page. */
  if (u.feeModel === 'free') return '';
  let pk = null;
  try { pk = content.get('packages'); } catch (e) { pk = null; }
  const tabs = (pk && Array.isArray(pk.tabs) && pk.tabs.length ? pk.tabs
    : [{ key: 'study', label: 'Germany' }, { key: 'other', label: 'Other countries' }]);
  const all = (pk && Array.isArray(pk.items) ? pk.items : []).filter(p => p && p.active !== false);
  if (!all.length) return '';
  const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');
  const card = p => {
    const priced = p.sell && Number(p.priceInr) > 0 && !p.priceBroken;
    return '<article class="upkg' + (p.featured ? ' featured' : '') + '">'
      + (p.ribbon ? '<span class="ribbon">' + esc(p.ribbon) + '</span>' : '')
      + '<h3>' + esc(p.title) + '</h3>'
      + (p.desc ? '<p>' + esc(p.desc) + '</p>' : '')
      + (p.unlocks ? '<div class="quota">Reveals <b>' + Number(p.unlocks) + '</b> public universit'
        + (Number(p.unlocks) === 1 ? 'y' : 'ies') + '</div>' : '')
      + (Array.isArray(p.features) && p.features.length
        ? '<ul>' + p.features.slice(0, 5).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '')
      + '<div class="foot">'
      + (priced
        ? '<div class="price">' + (p.priceFrom ? '<span class="from">From</span>' : '') + esc(money(p.priceInr))
          + (p.priceNote ? '<span class="note">' + esc(p.priceNote) + '</span>' : '') + '</div>'
          + '<a class="btn ' + (p.featured || p.primary ? 'btn-primary' : 'btn-ghost') + ' btn-sm" href="/?buy='
          + encodeURIComponent(p.id) + '#packages">Choose ' + esc(p.title) + '</a>'
        : '<div class="price"><span class="note">' + esc(p.quote || 'Priced after we assess your case') + '</span></div>'
          + '<a class="btn btn-ghost btn-sm" href="/#counsel">Ask a counsellor</a>')
      + '</div></article>';
  };
  /* Every tab the home page shows, the one for this university's country open
     first: Germany's set for a German university, Other countries for the rest. */
  const mine = u.country === 'DE' ? 'study' : 'other';
  const panes = tabs.map(t => ({ t, items: all.filter(p => p.tab === t.key) })).filter(x => x.items.length);
  if (!panes.length) return '';
  const open = panes.some(x => x.t.key === mine) ? mine : panes[0].t.key;
  return '<h2 id="packages">Packages that cover ' + esc(u.shortName || u.name) + '</h2>'
    + '<p id="pkgWhy">' + esc(u.name) + ' is applied to through a Glovels package: the shortlist, the SOP, the application itself '
        + 'and every follow-up until the decision. The same packages as on the home page, at today\'s prices — press one and it opens at the checkout.'
    + '</p>'
    + '<div class="utabs" role="tablist">' + panes.map(x =>
      '<button type="button" class="utab' + (x.t.key === open ? ' on' : '') + '" data-utab="' + esc(x.t.key)
      + '" role="tab" aria-selected="' + (x.t.key === open) + '">' + esc(x.t.label) + '</button>').join('') + '</div>'
    + panes.map(x => '<div class="upkgs" data-upane="' + esc(x.t.key) + '"' + (x.t.key === open ? '' : ' hidden') + '>'
      + x.items.map(card).join('') + '</div>').join('')
    + '<script>document.querySelectorAll(".utab").forEach(function(b){b.onclick=function(){'
    + 'document.querySelectorAll(".utab").forEach(function(x){x.classList.toggle("on",x===b);x.setAttribute("aria-selected",x===b);});'
    + 'document.querySelectorAll("[data-upane]").forEach(function(p){p.hidden=p.dataset.upane!==b.dataset.utab;});};});</script>';
}

function universitiesIndexPage() {
  const t = templates();
  if (!t) return null;
  const all = universities();
  const countries = liveCountries();
  /* The ones on the site. Search-only universities have pages and are in the
     sitemap, but the list is not where a student meets them: they come up in
     the search box, and on Google. */
  const shown = all.filter(u => u.listed && !UNIS.cleanExtras(db.content('university:' + u.slug)).hidden);
  const unlisted = all.filter(u => !u.listed && !UNIS.cleanExtras(db.content('university:' + u.slug)).hidden).length;
  const byCountry = new Map();
  shown.forEach(u => { if (!byCountry.has(u.country)) byCountry.set(u.country, []); byCountry.get(u.country).push(u); });
  const order = [...byCountry.keys()].sort((a, b) => byCountry.get(b).length - byCountry.get(a).length);
  const body = order.map(code => {
    const c = countries[code] || { name: code, flag: '' };
    const list = byCountry.get(code);
    return '<h2 id="' + esc(UNIS.slugOf(c.name)) + '">' + esc(c.flag ? c.flag + ' ' : '') + esc(c.name)
      + ' <span style="font-size:14px;color:var(--muted);font-weight:400">· ' + list.length
      + ' universit' + (list.length === 1 ? 'y' : 'ies') + '</span></h2>'
      + '<ul class="ulist">' + list.map(u =>
        '<li><a href="university/' + esc(u.slug) + '"><span><b>' + esc(u.name) + '</b><small>'
        + (u.isPublic ? 'Public' : 'Private') + (u.city ? ' · ' + esc(u.city) : '')
        + ' · ' + (u.feeMin === 0 ? (u.feeMax === 0 ? 'no tuition' : 'no tuition on some programmes') : 'from ' + esc(UNIS.money(u.feeMin)))
        + (u.feeModel === 'free' ? ' · free to apply through us' : '')
        + (DAAD.daadUrl(u.slug, UNIS.cleanExtras(db.content('university:' + u.slug)).daad) ? ' · on the DAAD' : '')
        + '</small></span><span class="n">' + u.programmes.length + ' programme'
        + (u.programmes.length === 1 ? '' : 's') + ' →</span></a></li>').join('')
      + '</ul>';
  }).join('') || '<p style="color:var(--muted)">No universities are on the site yet.</p>';

  const page = fill(t.page, Object.assign(metaHoles({
    title: 'Universities abroad for Indian students — fees, intakes & how to apply',
    desc: shown.length + ' universities across ' + byCountry.size + ' countries that Glovels places '
      + 'students at: public and private, what each costs in total, when to apply, and which '
      + 'ones you can apply to free through us.',
    canonical: absolute('/university'),
    keywords: 'universities abroad, study abroad universities, public universities germany, fees, intakes, Indian students',
    image: DEFAULT_OG, imageAlt: 'Glovels — universities abroad', type: 'website', indexable: true,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Universities Glovels places students at',
      itemListElement: shown.slice(0, 100).map((u, i) => ({
        '@type': 'ListItem', position: i + 1, name: u.name, url: absolute('/university/' + u.slug),
      })),
    },
  }), {
    H1: 'Universities we place students at',
    DATELINE: shown.length + ' universities in ' + byCountry.size + ' countries'
      + (unlisted ? ', and ' + unlisted + ' more you can search for' : '') + '. Every one has its own page '
      + 'with the programmes we track, what they cost in total, and a way to apply.',
    CRUMBS: '<a href="index.html">Home</a> / Universities',
    BODY: USEARCH_HTML
      + '<p class="lead">Pick a university to see its programmes, fees, intake deadlines and the CGPA '
      + 'it asks for. Not sure which ones you clear? <a href="index.html#results">The finder</a> reads '
      + 'your profile and tells you.</p>' + body,
  }));
  return page.replace('</head>', UNI_CSS + '</head>').replace('</body>', USEARCH_JS + '</body>');
}

/*
 * A few universities on a destination page.
 *
 * "We show via search or a dropdown on the home page; a few universities on
 *  the country pages; the other universities are displayed whenever there is
 *  a specific search from Google or in the search bar."
 *
 * The country page is static — written by build_destinations.py — and this
 * puts that country's universities into it as it goes out, fifty at most,
 * in front of the "Universities in X" button — on-the-site ones first, then
 * search-only ones, which have pages too. Past fifty they are counted, not
 * listed: "and 140 more you can search for". The page is not touched on
 * disk, so a rebuild cannot lose it and a country with no university gets no
 * empty heading.
 */
const DEST_CSS = `<style>/* GLOVELS-DEST-UNIS */
.ulist{list-style:none;padding:0;margin:14px 0 8px;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.ulist li a{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;background:var(--paper);
  border:1px solid var(--line);border-radius:12px;padding:13px 16px;text-decoration:none;color:inherit}
.ulist li a:hover{border-color:var(--navy-700)}
.ulist b{font:700 14.6px/1.35 var(--sans);color:var(--navy-900)}
.ulist small{display:block;margin-top:3px;font:400 12.2px/1.5 var(--sans);color:var(--muted)}
.ulist .n{font:700 12px/1.3 var(--sans);color:var(--navy-700);white-space:nowrap}
.umore{font:400 13.6px/1.6 var(--sans);color:var(--muted);margin:0 0 6px}
.ufilter{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0 6px;padding:14px;
  background:var(--paper);border:1px solid var(--line);border-radius:14px}
.ufilter .field label{display:block;font:600 11.2px/1.4 var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:0 0 4px}
.ufilter select,.ufilter input{width:100%;height:40px;padding:0 10px;border:1.5px solid var(--line);border-radius:10px;background:#fff;
  font:400 13.4px/1.4 var(--sans);color:var(--navy-900)}
.ufilter select:focus,.ufilter input:focus{outline:none;border-color:var(--navy-700)}
.ufilter .act{display:flex;align-items:flex-end}
.ufilter .act .btn{height:40px;width:100%;justify-content:center}
.ucount{font:700 13px/1.5 var(--sans);color:var(--navy-800);margin:8px 0 0}
</style>`;
const DEST_MAX = 50;
function withDestinationUniversities(html, slug) {
  const want = String(slug || '').replace(/^study-in-/, '');
  const countries = liveCountries();
  const code = Object.keys(countries).find(k => UNIS.slugOf(countries[k].name) === want);
  if (!code) return html;
  const anchor = html.indexOf('<p style="margin-top:26px"><a class="btn btn-ghost" href="university#');
  if (anchor < 0) return html;
  const all = universities().filter(u => u.country === code
    && !UNIS.cleanExtras(db.content('university:' + u.slug)).hidden);
  if (!all.length) return html;
  const c = countries[code];
  /* Every university in the country with a page, search-only ones included —
     "the home page search for universities looks fine, no changes to it; on
     the country pages we can display up to 50". The ones the office put on
     the site lead, then the featured, then whoever has the most on offer. */
  const lead = all.slice().sort((a, b) =>
    (b.listed - a.listed)
    || (b.programmes.some(p => p.featured) - a.programmes.some(p => p.featured))
    || (b.programmes.length - a.programmes.length) || a.name.localeCompare(b.name)).slice(0, DEST_MAX);
  const more = all.length - lead.length;
  const li = u => '<li><a href="university/' + esc(u.slug) + '"><span><b>' + esc(u.shortName || u.name) + '</b><small>'
      + (u.isPublic ? 'Public' : 'Private') + (u.city ? ' · ' + esc(u.city) : '')
      + ' · ' + (u.feeMin === 0 ? (u.feeMax === 0 ? 'no tuition' : 'no tuition on some programmes') : 'from ' + esc(UNIS.money(u.feeMin)))
      + (u.feeModel === 'free' ? ' · free to apply through us' : '')
      + '</small></span><span class="n">' + u.programmes.length + ' programme'
      + (u.programmes.length === 1 ? '' : 's') + ' →</span></a></li>';

  /* "We can have the home page criteria — filter — on the country screen as
     well." The finder's fields, minus the country, over this country's
     universities; every change asks /api/universities/filter. The options
     are what this country's programmes actually have, so nobody filters
     Germany to a level nothing there offers. */
  const levels = [...new Set(all.flatMap(u => u.programmes.map(p => String(p.level || 'master').toLowerCase())))].sort();
  const fields = [...new Set(all.flatMap(u => u.programmes.map(p => p.field).filter(Boolean)))].sort();
  const LEVEL_NAMES = { bachelor: "Bachelor's", master: "Master's", mba: 'MBA', diploma: 'Diploma / PG Diploma',
    foundation: 'Foundation / Pathway', pathway: 'Foundation / Pathway', phd: 'PhD' };
  const opt = (v, t) => '<option value="' + esc(v) + '">' + esc(t) + '</option>';
  const sel = (id, label, options) => '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '">'
    + options + '</select></div>';
  const filterBar = '<form class="ufilter" id="uFilter" data-country="' + esc(code) + '" onsubmit="return false">'
    + '<div class="field"><label for="ufQ">University or city</label><input id="ufQ" type="search" autocomplete="off" placeholder="Munich, Heidelberg, RWTH…"></div>'
    + sel('ufLevel', 'Study level', opt('', 'Any level') + levels.map(l => opt(l, LEVEL_NAMES[l] || l)).join(''))
    + sel('ufField', 'Field', opt('', 'Any field') + fields.map(f => opt(f, f)).join(''))
    + sel('ufCgpa', 'Your CGPA', opt('', 'Any CGPA') + opt('9.5', '9.0 – 10.0') + opt('8.5', '8.0 – 8.9') + opt('7.5', '7.5 – 7.9')
      + opt('7.2', '7.0 – 7.4') + opt('6.5', '6.0 – 6.9') + opt('5.5', 'below 6.0'))
    + (code === 'DE' ? sel('ufGgpa', 'Your German grade', opt('', 'Any grade') + opt('1.5', '1.0 – 1.5 (excellent)') + opt('2.0', '1.6 – 2.0 (very good)')
      + opt('2.5', '2.1 – 2.5 (good)') + opt('3.0', '2.6 – 3.0 (satisfactory)') + opt('3.5', '3.1 – 3.5 (sufficient)') + opt('4.0', '3.6 – 4.0 (pass)')) : '')
    + sel('ufIntake', 'Intake', opt('', 'Any intake') + opt('winter', 'Winter') + opt('summer', 'Summer'))
    + sel('ufBudget', 'Total tuition', opt('', 'Any budget') + opt('1', 'No tuition') + opt('500000', 'Up to ₹5 lakh') + opt('1000000', 'Up to ₹10 lakh')
      + opt('2000000', 'Up to ₹20 lakh') + opt('4000000', 'Up to ₹40 lakh'))
    + sel('ufApply', 'Applying', opt('', 'Free or with a package') + opt('free', 'Free to apply through us'))
    + '<div class="field act"><button type="button" class="btn btn-ghost" id="ufClear" hidden>Clear filters</button></div>'
    + '</form><p class="ucount" id="uCount" aria-live="polite">' + (more ? 'Showing ' + lead.length + ' of ' + all.length : all.length) + ' universit'
    + (all.length === 1 ? 'y' : 'ies') + ' in ' + esc(c.name) + '</p>';

  const block = '<h2 id="universities">Universities in ' + esc(c.name) + ' we place students at</h2>'
    + filterBar
    + '<ul class="ulist" id="uList">' + lead.map(li).join('') + '</ul>'
    + '<p class="umore" id="uMore">' + (more ? 'And ' + more + ' more in ' + esc(c.name) + ' — narrow the filters above, or search below.'
      : 'Looking for another university? Every one we track has its own page — search for it below.') + '</p>'
    /* "For more they can search — that option should be there." The same box
       the /university list has, on the country page itself. */
    + USEARCH_HTML;
  return (html.slice(0, anchor) + block + html.slice(anchor))
    .replace('</head>', UNI_CSS + DEST_CSS + '</head>').replace('</body>', USEARCH_JS + UFILTER_JS + '</body>');
}

const UFILTER_JS = `<script>(function(){
  var f = document.getElementById('uFilter'), list = document.getElementById('uList'),
      count = document.getElementById('uCount'), moreEl = document.getElementById('uMore'), clear = document.getElementById('ufClear');
  if (!f || !list) return;
  var code = f.dataset.country, first = list.innerHTML, firstCount = count.textContent, firstMore = moreEl.textContent, t = null, seq = 0;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (v) { v = Number(v) || 0; if (!v) return '\u20b90';
    if (v >= 1e7) return '\u20b9' + (v / 1e7).toFixed(v % 1e7 ? 1 : 0) + ' crore';
    if (v >= 1e5) return '\u20b9' + (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + ' lakh';
    return '\u20b9' + v.toLocaleString('en-IN'); };
  var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var state = function () { return { q: val('ufQ'), level: val('ufLevel'), field: val('ufField'), cgpa: val('ufCgpa'),
    ggpa: val('ufGgpa'), intake: val('ufIntake'), budget: val('ufBudget'), apply: val('ufApply') }; };
  var row = function (u) {
    return '<li><a href="' + esc(u.url) + '"><span><b>' + esc(u.name) + '</b><small>'
      + (u.isPublic ? 'Public' : 'Private') + (u.city ? ' \u00b7 ' + esc(u.city) : '')
      + ' \u00b7 ' + (u.feeMin === 0 ? (u.feeMax === 0 ? 'no tuition' : 'no tuition on some programmes') : 'from ' + money(u.feeMin))
      + (u.feeModel === 'free' ? ' \u00b7 free to apply through us' : '')
      + '</small></span><span class="n">' + (u.matching < u.programmes ? u.matching + ' of ' + u.programmes : u.programmes)
      + ' programme' + (u.programmes === 1 ? '' : 's') + ' \u2192</span></a></li>';
  };
  function ask() {
    var s = state(), on = Object.keys(s).some(function (k) { return s[k]; });
    clear.hidden = !on;
    if (!on) { list.innerHTML = first; count.textContent = firstCount; moreEl.textContent = firstMore; return; }
    var my = ++seq, qs = Object.keys(s).filter(function (k) { return s[k]; })
      .map(function (k) { return k + '=' + encodeURIComponent(s[k]); }).join('&');
    fetch('/api/universities/filter?country=' + code + '&' + qs).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || my !== seq) return;
      var U = d.universities || [];
      list.innerHTML = U.map(row).join('') || '<li style="color:var(--muted);padding:8px 0">Nothing clears every filter. Loosen one, or <a href="index.html#counsel">ask a counsellor</a> \u2014 we add universities on request.</li>';
      count.textContent = (d.total > U.length ? 'Showing ' + U.length + ' of ' + d.total : d.total) + ' universit' + (d.total === 1 ? 'y' : 'ies') + ' match';
      moreEl.textContent = d.total > U.length ? 'And ' + (d.total - U.length) + ' more match \u2014 narrow the filters, or search below.' : 'Every one has its own page. Search for another below.';
    }).catch(function () {});
  }
  f.addEventListener('change', ask);
  f.addEventListener('input', function (e) { if (e.target.id === 'ufQ') { clearTimeout(t); t = setTimeout(ask, 220); } });
  clear.addEventListener('click', function () { f.reset(); ask(); });
})();</script>`;

/*
 * The receipt for what somebody accepted when they paid.
 *
 * "The student should be shown proof that during payment he has accepted all
 * conditions." A tick in a database is not proof to the person who ticked it —
 * this is the page that shows them the words that were on the screen, the day
 * and time, and the fingerprint of each document as it read then. It prints.
 *
 * Never indexed. It has somebody's name, their email and their order on it.
 */
function acceptancePage(order, accepted) {
  const t = templates();
  if (!t) return null;
  const money = p => '₹' + Number((p || 0) / 100).toLocaleString('en-IN');
  const when = iso => {
    const d = new Date(iso);
    return isNaN(d) ? String(iso || '') : d.toLocaleString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
    }) + ' IST';
  };

  const body = accepted
    ? '<div class="rc"><h2>What you accepted</h2>'
      + '<p class="rc-sub">Recorded when the order was placed. This page is the record; '
      + 'nothing on it is written from memory.</p>'
      + '<dl>'
      + '<dt>Order</dt><dd>' + esc(order.reference) + ' — ' + esc(order.package)
        + ' · ' + money(order.gross_paise) + '</dd>'
      + '<dt>Accepted by</dt><dd>' + esc(accepted.name || order.name)
        + ' (' + esc(accepted.email || order.email) + ')</dd>'
      + '<dt>Accepted at</dt><dd>' + esc(when(accepted.at)) + '</dd>'
      + (accepted.ip ? '<dt>From</dt><dd>' + esc(accepted.ip) + '</dd>' : '')
      + (accepted.entity ? '<dt>With</dt><dd>' + esc(accepted.entity) + '</dd>' : '')
      + (accepted.effective ? '<dt>Terms in effect from</dt><dd>'
        + esc(accepted.effective) + '</dd>' : '')
      + '</dl>'
      + '<div class="said">' + esc(accepted.line) + '</div>'
      + '</div>'

      + (accepted.docs && accepted.docs.length
          ? '<div class="rc"><h2>The documents, as they read that day</h2>'
            + '<p class="rc-sub">The code beside each one is a fingerprint of its text at '
            + 'the moment you accepted it. If a page is edited later, its fingerprint '
            + 'changes and this one stays — so what you agreed to can always be told apart '
            + 'from what the page says today.</p>'
            + '<ul class="rc-docs">'
            + accepted.docs.map(d => '<li><a href="' + esc(d.url) + '">' + esc(d.name)
              + '</a> <code>' + esc(d.sha256) + '</code></li>').join('')
            + '</ul></div>'
          : '')

      + (accepted.packageTerms
          ? '<div class="rc"><h2>' + esc(order.package) + ' — the terms in full</h2>'
            + '<p class="rc-sub">Stored word for word with the order, not linked to. '
            + (accepted.packageTermsSha256
                ? 'Fingerprint <code>' + esc(accepted.packageTermsSha256) + '</code>.' : '')
            + '</p>'
            + '<div class="rc-terms">' + esc(accepted.packageTerms) + '</div></div>'
          : '')

      + '<p style="margin:22px 0 0;font-size:12.6px;color:var(--muted);line-height:1.65">'
      + 'Keep this page, or print it. A copy is held against your order and your '
      + 'counsellor can send it again at any time.</p>'

    : '<div class="rc-none"><b>Nothing was recorded against this order.</b><br>'
      + 'It was placed before we started recording acceptance, or the package it was '
      + 'for carries no separate terms. The Terms of Service and the Refund policy '
      + 'still apply, and your counsellor can go through them with you.</div>';

  return fill(t.page, Object.assign(metaHoles({
    title: 'What you accepted — ' + order.reference,
    desc: 'The terms accepted with order ' + order.reference + '.',
    canonical: absolute('/acceptance/' + order.reference),
    type: 'website',
    /* Never. Somebody's name, their email and their order are on this page. */
    indexable: false,
  }), {
    CRUMBS: '<a href="index.html">Home</a> / Your order',
    H1: 'What you accepted',
    DATELINE: 'Order ' + esc(order.reference) + ' · ' + esc(when(order.created_at)),
    BODY: body,
  }));
}

/*
 * /success-stories — every admission, on one page.
 *
 * The home page shows six on a rail. This is the rest, and it is the reason
 * the office was asked for the intake: a list of thirty admissions with the
 * university, the course and the term each one was for is the single most
 * useful page this site can offer somebody deciding whether to trust it.
 *
 * Rendered HERE, from the database, rather than painted into a static file by
 * the browser. The home page can repaint itself because a visitor runs its
 * scripts; a crawler indexing the page — and the AI crawlers in particular —
 * often does not, and would find three shipped placeholders where thirty real
 * admissions are. The cards are built with the same fields and the same class
 * names the browser uses, so the two cannot drift.
 *
 * Initials only. That is the whole privacy position on this page: a student
 * gave us their admission letter, not permission to publish their name.
 */
function successStoriesPage() {
  const t = templates();
  if (!t) return null;
  const rows = (content.get('testimonials') || []).filter(x => x && (x.quote || x.name));

  const card = s =>
    '<article class="card card-hover card-stack tcard"><div class="card-body">'
    + '<div class="trow">'
    + (s.route ? '<span class="route">' + esc(s.route) + '</span>' : '')
    + (s.intake ? '<span class="intake">' + esc(s.intake) + '</span>' : '')
    + (s.verified
        ? '<span class="vadm"><svg class="ico" aria-hidden="true"><use href="#i-shield"/></svg>'
          + 'Verified admission</span>'
        : '')
    + '</div><blockquote>' + esc(s.quote) + '</blockquote></div>'
    + '<div class="card-foot who"><span class="av">'
    + esc(String(s.name || '?').trim().charAt(0).toUpperCase()) + '</span><span><b>'
    + esc(s.name) + '</b><span>' + esc(s.where) + '</span></span></div></article>';

  /*
   * The cards' own styling, inline.
   *
   * This template is the one the legal pages and the blog use, and it carries
   * a prose stylesheet — 70 characters to a line and a gold rule down the side
   * of every blockquote. A story card dropped into it came out as a column of
   * run-together text with the route, the intake and "Verified admission"
   * printed as one sentence, because none of the home page's card rules exist
   * here. They are declared once, below, and the grid breaks out of the prose
   * column because thirty cards in a 70ch measure is one card wide.
   */
  const STYLE = '<style>'
    + '#page{max-width:none}'
    + '.sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:0 0 26px}'
    + '@media (max-width:980px){.sgrid{grid-template-columns:repeat(2,1fr)}}'
    + '@media (max-width:640px){.sgrid{grid-template-columns:1fr}}'
    + '.sgrid .tcard{display:flex;flex-direction:column;padding:18px 20px 0;'
    + 'background:var(--paper,#fff);border:1px solid var(--line,#e4e8ee);border-radius:16px}'
    + '.sgrid .card-body{flex:1}'
    + '.sgrid .trow{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:11px}'
    + '.sgrid .route{font:700 11.6px/1 var(--sans);padding:6px 11px;border-radius:999px;'
    + 'border:1px solid var(--line,#e4e8ee);background:var(--cream,#f6f4ee);color:var(--navy-800)}'
    + '.sgrid .intake{font:700 11.2px/1 var(--sans);padding:6px 10px;border-radius:999px;'
    + 'background:#eef3fb;color:var(--navy-700);border:1px solid #d5e0f0}'
    + '.sgrid .vadm{display:inline-flex;align-items:center;gap:5px;font:800 9.4px/1 var(--sans);'
    + 'letter-spacing:.1em;text-transform:uppercase;padding:5px 8px;border-radius:999px;'
    + 'background:#eef8f2;color:#14603a;border:1px solid #bfe0cc}'
    + '.sgrid .vadm .ico{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:1.8}'
    + '.sgrid blockquote{margin:0;padding:0;border:0;font-size:14.6px;line-height:1.5;'
    + 'font-style:normal;color:var(--navy-800)}'
    + '.sgrid .who{padding:13px 0 18px;margin-top:14px;border-top:1px solid var(--line,#e4e8ee);'
    + 'display:flex;align-items:center;gap:10px}'
    + '.sgrid .who .av{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;'
    + 'flex:none;font:700 13px/1 var(--sans);color:#fff;'
    + 'background:linear-gradient(160deg,var(--navy-600,#1c3d5e),var(--navy-800,#0f2740))}'
    + '.sgrid .who b{font-size:13.4px;color:var(--navy-900)}'
    + '.sgrid .who span span{display:block;font-size:11.8px;color:var(--muted)}'
    + '</style>';

  const body = rows.length
    ? STYLE
      + '<div class="sgrid">' + rows.map(card).join('') + '</div>'
      + '<p style="font-size:13px;color:var(--muted);line-height:1.7">'
      + 'Initials only — a student gives us their admission letter, not permission to '
      + 'publish their name. Every card marked <b>Verified admission</b> has the offer '
      + 'letter on file, and we will show it to the university that asks.</p>'
    : '<p>The first admissions of this intake are being confirmed. '
      + '<a href="contact-us.html">Ask us</a> what we have placed and where.</p>';

  const verified = rows.filter(r => r.verified).length;

  return fill(t.page, Object.assign(metaHoles({
    title: 'Success stories — every admission we have placed',
    desc: rows.length
      ? rows.length + ' admissions to public and private universities abroad, with the '
        + 'course and the intake each one was for. Initials only; offer letters on file.'
      : 'Admissions Glovels has placed, with the course and the intake for each.',
    canonical: absolute('/success-stories'),
    keywords: 'study abroad success stories, admits, Germany admission, public university admission',
    type: 'website',
    jsonld: rows.length ? {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Glovels admissions',
      numberOfItems: rows.length,
      itemListElement: rows.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: s.quote,
      })),
    } : null,
  }), {
    CRUMBS: '<a href="index.html">Home</a> / Success stories',
    H1: 'Every admission we have placed',
    DATELINE: rows.length
      ? rows.length + ' admission' + (rows.length === 1 ? '' : 's')
        + (verified ? ' · ' + verified + ' with the offer letter on file' : '')
      : 'Being confirmed',
    BODY: body,
  }));
}

const NOINDEX = /<meta name="robots" content="noindex,nofollow"\s*\/?>/i;

function forIndexing(html, slug) {
  if (!CFG.allowIndexing) return html;
  if (PORTAL_PAGES.has(slug)) return html;
  return html.replace(NOINDEX,
    '<meta name="robots" content="index,follow,max-image-preview:large">');
}

const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url);

  // The API first — it owns /api/* and the form endpoint.
  if (pathname.startsWith('/api/') || pathname === '/send.php') {
    const handled = await api(req, res, pathname);
    if (handled || res.headersSent) return;      // belt and braces: never answer twice
    return send(res, 404, JSON.stringify({ error: 'No such endpoint' }), TYPES['.json']);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  /*
   * /reset is the sign-in page.
   *
   * The set-a-new-password form lives on login.html, which reads the token out
   * of the query string — one page rather than two copies of the same markup.
   * The emails, though, were built with `/reset?token=…`, and nothing serves
   * that: every reset link ever sent pointed at a 404. The links are written
   * correctly now, and this keeps the ones already in people's inboxes working.
   */
  if (pathname === '/reset') {
    return send(res, 302, '', 'text/html',
      { Location: '/login' + (query ? '?' + query : '') });
  }

  /*
   * /.well-known/assetlinks.json — what makes the Android app an app.
   *
   * A Trusted Web Activity is this site running full-screen inside an Android
   * shell. Android will only drop the browser's address bar if it can fetch
   * THIS file from THIS domain and find the signing certificate of the app
   * that is asking. Without it the app still works and still looks wrong: a
   * URL bar across the top of every screen, which reviewers read as a wrapped
   * website and users read as a browser pretending to be an app.
   *
   * Generated rather than shipped, for the reason robots.txt is: the
   * fingerprint is not known until Google has signed the first upload, it can
   * change, and a file on disk means a developer and a redeploy every time it
   * does. It comes from the Mobile app card in the office instead.
   *
   * With nothing configured this is an empty array — which is valid, and
   * verifies nothing, which is the honest answer before there is an app.
   */
  if (pathname === '/.well-known/assetlinks.json') {
    return send(res, 200, JSON.stringify(assetLinks(), null, 2) + '\n',
      TYPES['.json']);
  }

  /* Ahead of the static files, so the generated answer wins over the one on
     disk rather than depending on which is found first. */
  /* A picture somebody uploaded for a post. The name is minted by images.js and
     nothing else is looked up, so ../ cannot reach the database beside it. A
     name changes when the file does, hence the year-long cache. */
  const pic = /^\/images\/([a-z0-9][a-z0-9-]{0,120}\.(?:jpg|png|gif|webp))$/.exec(pathname);
  if (pic) {
    const f = IMAGES.fileFor(IMAGES_DIR, pic[1]);
    if (!f) return notFound(res);
    return send(res, 200, fs.readFileSync(f.path), f.mime,
      { 'Cache-Control': 'public, max-age=31536000, immutable' });
  }

  if (pathname === '/robots.txt') return send(res, 200, robotsTxt(), TYPES['.txt']);
  if (pathname === '/sitemap.xml') {
    if (!CFG.allowIndexing) return notFound(res);
    return send(res, 200, sitemapXml(), TYPES['.xml']);
  }

  /*
   * /acceptance/<reference> — the receipt for what somebody accepted.
   *
   * Readable by the person it is about, by the office, and by nobody else. An
   * order still waiting for its account is readable with its email in the
   * query, because the person who has just paid has no account to sign in to
   * yet and is exactly who needs to see this.
   */
  /* Ahead of the static files, because there is no file — the page is the
     database, rendered. `success-stories.html` reaches it through the same
     .html redirect every other internal link on this site goes through. */
  /*
   * The addresses glovels.com has today, on Wix.
   *
   * "SEOs are ranked good and SEOs are working well. In the new website also we
   *  want to make sure we continue the same."
   *
   * The blog posts keep their addresses — /post/<slug> is the same on both
   * sites, which is why the import keeps the slug. The PAGES do not: the Wix
   * site says /canada-pr and /study-in-uk, this one says /migrate-canada-pr and
   * /study-in-united-kingdom. The day the domain moves, every one of those old
   * addresses is a link Google holds and a student has bookmarked, and a 404
   * on it throws the ranking away. A 301 hands it over.
   *
   * Only addresses that are on the Wix sitemap today, and only where this site
   * has the page. Not /services: that is the student's Services screen here.
   * Anything not listed is a 404, honestly.
   */
  const WIX_MOVED = {
    '/about': '/about-us', '/contact': '/contact-us', '/career': '/careers',
    '/french': '/language-french', '/glovels-referral-program': '/refer',
    '/terms-of-use': '/terms', '/privacy-policy': '/privacy',
    '/study-in-uk': '/study-in-united-kingdom',
    '/canada-pr': '/migrate-canada-pr', '/australia-pr': '/migrate-australia-pr',
    '/germanyopportunitycard': '/work-opportunity-card',
    '/nursing-jobs-in-germany': '/work-nursing-germany',
    '/pharma-jobs-in-germany': '/work-pharma-germany',
    '/medical-pg-in-germany': '/work-medical-pg-germany',
    '/ielts-toefl-pte': '/test-ielts-toefl-pte', '/gre-gmat-sat': '/test-gre-gmat-sat',
    '/pricing-india': '/#packages', '/pricing-global': '/#packages',
    '/book-online': '/#counsel',
    '/useful-links': '/glossary', '/project': '/success-stories',
  };
  if (Object.prototype.hasOwnProperty.call(WIX_MOVED, pathname)) {
    return send(res, 301, '', 'text/html', { Location: WIX_MOVED[pathname] });
  }
  /* Wix's blog categories and tags: /blog/categories/german, /blog/tags/x.
     The posts keep their own addresses; the lists land on the index. */
  if (/^\/blog\/(?:categories|tags)\//.test(pathname)) {
    return send(res, 301, '', 'text/html', { Location: '/blog' });
  }

  /* One page per university, and the list. Rendered from the live catalogue;
     not files, so they sit ahead of the static handler. A .html spelling or a
     trailing slash goes to the clean address like every other page. */
  if (pathname === '/university' || pathname === '/university/' || pathname === '/university.html') {
    if (pathname !== '/university') return send(res, 301, '', 'text/html', { Location: '/university' });
    const page = universitiesIndexPage();
    if (page) return send(res, 200, forIndexing(page, 'university'), TYPES['.html']);
  }
  const uniUrl = /^\/university\/([a-z0-9-]{1,90})(?:\.html|\/)?$/.exec(pathname);
  if (uniUrl) {
    if (pathname !== '/university/' + uniUrl[1]) {
      return send(res, 301, '', 'text/html', { Location: '/university/' + uniUrl[1] });
    }
    const u = universityOf(uniUrl[1]);
    if (!u) return notFound(res);
    const page = universityPage(u);
    /* A page the office took off search keeps its noindex whatever the site
       setting says — forIndexing would put it back. */
    if (page) return send(res, 200, u.extras.hidden ? page : forIndexing(page, 'university-' + u.slug), TYPES['.html']);
  }

  if (pathname === '/success-stories') {
    const page = successStoriesPage();
    if (page) return send(res, 200, forIndexing(page, 'success-stories'), TYPES['.html']);
  }

  const acc = /^\/acceptance\/([A-Za-z0-9-]{3,30})$/.exec(pathname);
  if (acc) {
    const order = db.orderByReference(acc[1]);
    if (!order) return notFound(res);
    const who = whoIsIt(req);
    const asked = String((url.parse(req.url, true).query || {}).email || '')
      .trim().toLowerCase();
    const allowed = (who && who.role !== 'student')
      || (who && Number(order.student_id) === Number(who.id))
      || (asked && asked === String(order.email || '').toLowerCase());
    if (!allowed) {
      return send(res, 403,
        '<!doctype html><meta charset="utf-8"><title>Sign in to see this</title>'
        + '<body style="font:400 15px/1.6 system-ui,sans-serif;max-width:34em;margin:14vh auto;'
        + 'padding:0 20px;color:#0b1e31"><h1 style="font-size:22px">This one is yours, so '
        + 'we have to know it is you</h1><p>Sign in with the email address the order was '
        + 'placed under, and open it from your dashboard.</p>'
        + '<p><a href="/login" style="font-weight:700;color:#13385c">Sign in</a></p></body>',
        TYPES['.html']);
    }
    let accepted = null;
    try { accepted = order.accepted ? JSON.parse(order.accepted) : null; } catch (e) { /* none */ }
    const html = acceptancePage(order, accepted);
    if (html) return send(res, 200, html, TYPES['.html']);
  }

  /*
   * /blog and /post/<slug>, from the database.
   *
   * Ahead of the static files on purpose: the six .html files are still on
   * disk, and whichever answers first is what the world reads. The database is
   * the one the office can edit.
   */
  if (pathname === '/blog' || pathname === '/blog.html') {
    const html = blogIndexPage(blogList());
    if (html) return send(res, 200, html, TYPES['.html']);
  }
  const postUrl = /^\/post\/([a-z0-9-]{1,90})(?:\.html)?$/.exec(pathname);
  if (postUrl) {
    const post = db.postBySlug(postUrl[1]);
    if (post && post.body && String(post.body).trim()) {
      /* A draft is visible to staff, so Preview shows the real page rather
         than an approximation of it, and to nobody else. */
      const who = post.status === 'published' ? null : whoIsIt(req);
      if (post.status === 'published' || (who && who.role !== 'student')) {
        const html = postPage(post, post.status !== 'published');
        if (html) return send(res, 200, html, TYPES['.html']);
      }
      if (post.status !== 'published') {
        /* ...unless the page it is going to replace is still on disk.
         *
         * blogList() lists exactly these on the public index — the six pages
         * that were on glovels.com before the editor existed, kept until a
         * written post replaces each one, because dropping them the day the
         * database took over would have taken six live pages off the site.
         * That is the intention; the 404 here defeated it. Every card on the
         * public blog index answered 404, and the office screen said they were
         * drafts, so nobody was looking.
         *
         * The file is what a visitor gets until Publish, which is what the
         * comment on blogList has always said. */
        const orig = path.join(ROOT, 'post', post.slug + '.html');
        if (!fs.existsSync(orig)) return notFound(res);
        return send(res, 200, forIndexing(fs.readFileSync(orig, 'utf8'), post.slug),
          TYPES['.html']);
      }
    }
  }

  /* A file whose name starts with an underscore is a template, not a page.
     /post/_post.tpl answered 200 and served the blog template with {{H1}} in
     it — a page with holes where the words go, on a public address. */
  if (/(?:^|\/)_/.test(pathname)) return notFound(res);

  // The database and anything a student uploaded are never served as files.
  if (pathname.startsWith('/data/') || pathname.startsWith('/server/')
      || /\.(db|db-wal|db-shm)$/.test(pathname) || /enquiries.*\.log$/.test(pathname)) {
    return send(res, 403, 'Forbidden');
  }

  let file = resolveSafe(pathname);
  if (!file) return send(res, 403, 'Forbidden');

  // A .html address redirects to the clean one, so the same page is never
  // reachable at two URLs — matching the live redirect.
  if (/\.html$/.test(pathname) && pathname !== '/index.html') {
    return send(res, 301, '', 'text/html',
      { Location: pathname.replace(/\.html$/, '') + (query ? '?' + query : '') });
  }
  if (pathname === '/index.html') {
    return send(res, 301, '', 'text/html', { Location: '/' + (query ? '?' + query : '') });
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) file = idx;
    else return notFound(res);
  }

  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return notFound(res);

  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') {
    const slug = path.basename(file, '.html');
    let html = fs.readFileSync(file, 'utf8');
    if (slug.startsWith('study-in-')) html = withDestinationUniversities(html, slug);
    return send(res, 200, forIndexing(html, slug), TYPES['.html']);
  }

  send(res, 200, fs.readFileSync(file),
    TYPES[ext] || 'application/octet-stream');
});

process.on('SIGINT', () => {
  try { db.close(); } catch (e) {}
  console.log('\n  Stopped. Your data is saved in ' + path.relative(ROOT, DATA) + '/\n');
  process.exit(0);
});

server.listen(PORT, CFG.host, () => {
  /* The real path, not a hard-coded "data/". On a host DATA_DIR is a mounted
     volume somewhere else entirely, and a start-up line that names the wrong
     directory is the line you trust while looking for a database that is not
     where it says. */
  const where = path.join(DATA, db.kind === 'sqlite' ? 'glovels.db (SQLite)' : 'glovels-data.json');
  console.log(`
  Glovels is running.

${configure.describe(CFG)}

    Website    ${SITE_URL}/
    Sign in    ${SITE_URL}/login
    Portal     ${SITE_URL}/dashboard

  ${db.countStudents()} account(s), ${db.programmes().length} programmes across ${db.countries().length} destinations.
  Data is stored in ${where}.${importedCat ? '\n  Catalogue imported from catalogue.json (' + importedCat + ' programmes) — it lives in the database now.' : ''}
  Email: ${mail.mode === 'smtp' ? 'sending through ' + (mail.status().host || 'mail.env')
    : 'NOT SENDING \u2014 written to data/outbox/ as .eml files. Set SMTP_HOST,\n         SMTP_USER and SMTP_PASS in the environment (or mail.env) and restart.\n         Organisation \u2192 Email says the same thing, with a test button.'}.
  WhatsApp: ${notify.whatsappReady ? 'configured' : 'off — the messenger works without it'}.
${newTiers ? `  ${newTiers} entry package(s) added and live — the machine delivers them.\n` : ''}${movedTiers ? `  ${movedTiers} entry tier(s) moved into Services, where a private-university\n  shortlist belongs.\n` : ''}${newServices ? `  ${newServices} new service(s) added to the catalogue.\n` : ''}${newCountries ? `  ${newCountries} destination(s) added \u2014 they have pages on the site and are on the\n  Destinations tab now, with no programmes yet.\n` : ''}${openedServices ? `  ${openedServices} of them are priced on request and are live \u2014 the button asks a\n  counsellor.\n` : ''}${deliveringPkgs ? `  ${deliveringPkgs} package(s) now deliver the public universities they unlock \u2014 a\n  student who pays gets a shortlist without waiting for anybody.\n` : ''}${phantomCards ? `  ${phantomCards} home-page card(s) removed \u2014 they were the code that draws the\n  cards, scraped as if they were content.\n` : ''}${chipAsks ? `  The SOP and LOR studio now asks what each ticked thing actually was.\n` : ''}${feeModels ? `  ${feeModels} university row(s) now say what applying costs \u2014 free where we are\n  partnered, a package where we are not. The column is on the catalogue sheet.\n` : ''}${destPkgs ? `  Packages are scoped to a destination now: Germany keeps its four, and the\n  other six countries have three of their own on a second tab.\n` : ''}${filledPosts ? `  ${filledPosts} blog post(s) written into their drafts. Read them and press Publish in\n  Blog \u2192 the post.\n` : ''}${adminSeed && adminSeed.created ? `  Administrator created: ${adminSeed.email}\n` : ''}${adminSeed && adminSeed.existed ? `  Administrator: ${adminSeed.email} (already existed — ADMIN_PASSWORD does not reset it.\n  Lost it? Set ADMIN_RESET=true, redeploy, sign in, then set it back to false.)\n` : ''}${adminSeed && adminSeed.reset ? `  ⚠ ADMIN PASSWORD WAS RESET for ${adminSeed.email} from ADMIN_PASSWORD.\n    Every session it had is signed out. TURN ADMIN_RESET OFF NOW — left on, it\n    resets the password on every single deploy.\n` : ''}${seeded ? `  Three accounts created, all with the password ${seeded.password_all}:
    student     ${seeded.email}      ${seeded.shortlisted} universities, 6 documents, 1 paid order
    counsellor  ${seeded.counsellor}       answers the chat — open /counsellor
    admin       ${seeded.admin}        assigns counsellors — open /admin
` : ''}
  Uploaded documents go to data/uploads/. Neither is served over HTTP.

  Create an account on the sign-in page — it is a real one.
  Stop the server with Control-C.
`);
});
