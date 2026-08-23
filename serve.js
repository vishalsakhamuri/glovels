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
const mail = mailer.open({ dir: DATA, configFile: MAIL_CFG, siteUrl: SITE_URL });
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

const api = makeApi({ db, uploadDir: UPLOADS, catalogue: liveCatalogue, countries: liveCountries,
  mail, notify, live, siteUrl: SITE_URL, config: CFG, content });

/* First run only: a demo account with a shortlist, documents, applications and
   an order, so there is something to look at before anyone signs up. */
const importedCat = seed.seedCatalogue({ db, catalogue: seedCat, countries: seedCountries });
const seeded = CFG.seedDemo
  ? seed.run({ db, uploadDir: UPLOADS, catalogue: liveCatalogue(), hashPassword, newSalt,
      password: CFG.demoPassword })
  : null;
const adminSeed = seed.seedAdmin({ db, admin: CFG.admin, hashPassword, newSalt,
  reset: CFG.admin.reset });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8',
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
  'chat', 'home', 'catalogue', 'login', '404']);

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
      const slug = name.slice(0, -5);
      if (!prefix && PORTAL_PAGES.has(slug)) continue;
      pages.push(prefix === '' && slug === 'index' ? '' : prefix + slug);
    }
  };
  walk(ROOT, '');
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
  Email: ${mail.mode === 'smtp' ? 'sending through ' + (process.env.SMTP_HOST || 'mail.env')
    : 'written to data/outbox/ as .eml files (no mail.env yet)'}.
  WhatsApp: ${notify.whatsappReady ? 'configured' : 'off — the messenger works without it'}.
${adminSeed && adminSeed.created ? `  Administrator created: ${adminSeed.email}\n` : ''}${adminSeed && adminSeed.existed ? `  Administrator: ${adminSeed.email} (already existed — ADMIN_PASSWORD does not reset it.\n  Lost it? Set ADMIN_RESET=true, redeploy, sign in, then set it back to false.)\n` : ''}${adminSeed && adminSeed.reset ? `  ⚠ ADMIN PASSWORD WAS RESET for ${adminSeed.email} from ADMIN_PASSWORD.\n    Every session it had is signed out. TURN ADMIN_RESET OFF NOW — left on, it\n    resets the password on every single deploy.\n` : ''}${seeded ? `  Three accounts created, all with the password ${seeded.password_all}:
    student     ${seeded.email}      ${seeded.shortlisted} universities, 6 documents, 1 paid order
    counsellor  ${seeded.counsellor}       answers the chat — open /counsellor
    admin       ${seeded.admin}        assigns counsellors — open /admin
` : ''}
  Uploaded documents go to data/uploads/. Neither is served over HTTP.

  Create an account on the sign-in page — it is a real one.
  Stop the server with Control-C.
`);
});
