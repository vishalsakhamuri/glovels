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
    /* The CGPA THIS programme asks for. The finder has always preferred it
       over the country's rule — and never received it, because the catalogue
       handed to the page did not carry the field. */
    minCgpa: r.min_cgpa == null ? null : Number(r.min_cgpa),
    url: r.url || '',
    uKey: uKeyOf(r.university),
    /* The office's choice of what leads the showcase on the home page. */
    featured: !!r.featured, featureSort: r.feature_sort || 0,
    intakes: (() => { try { return JSON.parse(r.intakes); } catch (e) { return []; } })(),
  }));
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

const api = makeApi({ db, uploadDir: UPLOADS, catalogue: liveCatalogue, countries: liveCountries,
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
const openedServices = seed.openOnRequestServices({ db });
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
    'Allow: /',
    '',
    'Sitemap: ' + (CFG.siteUrl || '') + '/sitemap.xml',
    '',
  ].join('\n');
}

/* The public pages only: everything behind a sign-in is left out, and so is
   404.html, which exists to be reached by accident. */
const PORTAL_PAGES = new Set(['dashboard', 'profile', 'documents', 'messages',
  'applications', 'universities', 'scholarships', 'visa', 'admin', 'counsellor',
  'chat', 'home', 'catalogue', 'blog-admin', 'leads', 'login', '404']);

function sitemapXml() {
  const pages = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name === 'data' || name === 'server' || name.startsWith('.')) continue;
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

function metaHoles({ title, desc, canonical, keywords, image, type, jsonld, indexable }) {
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
    OG_IMAGE: image
      ? '<meta property="og:image" content="' + esc(image) + '">\n'
      : '',
    TWITTER_CARD: image ? 'summary_large_image' : 'summary',
    JSONLD: jsonld
      ? '<script type="application/ld+json">' + JSON.stringify(jsonld)
        .replace(/</g, '\\u003c') + '</script>'
      : '',
  };
}

function postPage(post, isDraft) {
  const t = templates();
  if (!t) return null;
  const url_ = absolute('/post/' + post.slug);
  const title = post.meta_title || post.title;
  const desc = post.meta_desc || post.excerpt || PROSE.summarise(post.body);
  const image = post.og_image || post.cover || '';

  const body =
      (post.excerpt ? '<p class="lead">' + esc(post.excerpt) + '</p>' : '')
    + (isDraft
        ? '<div style="margin:0 0 18px;padding:12px 15px;border-radius:11px;'
          + 'background:#fdf6e6;border:1px solid #e6d5a8;color:#5b4409;'
          + 'font:600 13px/1.6 system-ui,sans-serif">This is a draft. It is not on the '
          + 'site, it is not in the sitemap, and search engines are told to skip it.</div>'
        : '')
    + PROSE.render(post.body);

  return fill(t.post, Object.assign(metaHoles({
    title, desc, canonical: url_, keywords: post.keywords, image,
    type: 'article', indexable: !isDraft,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description: desc, url: url_,
      datePublished: post.published_at || post.created_at,
      dateModified: post.updated_at || post.published_at || post.created_at,
      author: { '@type': 'Organization', name: post.author || 'Glovels' },
      publisher: { '@type': 'Organization', name: 'Glovels' },
      mainEntityOfPage: url_,
      image: image || undefined,
      keywords: post.keywords || undefined,
    },
  }), {
    H1: esc(post.title),
    DATELINE: esc(shownDate(post.published_at || post.created_at))
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

  /* Ahead of the static files, so the generated answer wins over the one on
     disk rather than depending on which is found first. */
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
      if (post.status !== 'published') return notFound(res);
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
    return send(res, 200,
      forIndexing(fs.readFileSync(file, 'utf8'), slug), TYPES['.html']);
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
${newTiers ? `  ${newTiers} entry package(s) added and live — the machine delivers them.\n` : ''}${movedTiers ? `  ${movedTiers} entry tier(s) moved into Services, where a private-university\n  shortlist belongs.\n` : ''}${newServices ? `  ${newServices} new service(s) added to the catalogue.\n` : ''}${openedServices ? `  ${openedServices} of them are priced on request and are live \u2014 the button asks a\n  counsellor.\n` : ''}${filledPosts ? `  ${filledPosts} blog post(s) written into their drafts. Read them and press Publish in\n  Blog \u2192 the post.\n` : ''}${adminSeed && adminSeed.created ? `  Administrator created: ${adminSeed.email}\n` : ''}${adminSeed && adminSeed.existed ? `  Administrator: ${adminSeed.email} (already existed — ADMIN_PASSWORD does not reset it.\n  Lost it? Set ADMIN_RESET=true, redeploy, sign in, then set it back to false.)\n` : ''}${adminSeed && adminSeed.reset ? `  ⚠ ADMIN PASSWORD WAS RESET for ${adminSeed.email} from ADMIN_PASSWORD.\n    Every session it had is signed out. TURN ADMIN_RESET OFF NOW — left on, it\n    resets the password on every single deploy.\n` : ''}${seeded ? `  Three accounts created, all with the password ${seeded.password_all}:
    student     ${seeded.email}      ${seeded.shortlisted} universities, 6 documents, 1 paid order
    counsellor  ${seeded.counsellor}       answers the chat — open /counsellor
    admin       ${seeded.admin}        assigns counsellors — open /admin
` : ''}
  Uploaded documents go to data/uploads/. Neither is served over HTTP.

  Create an account on the sign-in page — it is a real one.
  Stop the server with Control-C.
`);
});
