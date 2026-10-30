'use strict';
/*
 * Round 176 — the go-live self-check.
 *
 * One block in the start-up log, the same facts behind GET /api/staff/golive,
 * and the "Go-live readiness" card on Organisation. Each item is a fact the
 * office would otherwise have to ask a developer for on launch day: is the
 * site indexable, is mail leaving the building, are the payment keys live,
 * is the Analytics tag on, are the legal particulars typed, can a backup be
 * written, how much disk is left, is any QA account still on the books.
 *
 * Nothing here changes anything. It reads, it reports, and it says what to
 * do about each amber or red line.
 */
const fs = require('fs');
const path = require('path');

/* The legal particulars every one of the four pages quotes. Kept in step
   with LEGAL_FIELDS on the Home page screen (home.html). */
const LEGAL_FIELDS = [
  ['entity', 'Legal entity name'], ['cin', 'CIN'], ['gstin', 'GSTIN'],
  ['address', 'Registered office'], ['effective', 'Effective date'],
  ['jurisdiction', 'Courts of'], ['invoiceSeries', 'Invoice series'],
  ['officer.name', 'Grievance officer name'], ['officer.designation', 'Grievance officer designation'],
  ['officer.email', 'Grievance officer email'], ['officer.phone', 'Grievance officer phone'],
];
const dig = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

/** Which legal particulars are still blank, by label. */
function legalMissing(content) {
  let L = {};
  try { L = (content && content.get('legal')) || {}; } catch (e) { L = {}; }
  return LEGAL_FIELDS.filter(([k]) => !String(dig(L, k) == null ? '' : dig(L, k)).trim()).map(([, label]) => label);
}

/* Razorpay: live, test, half, or off — from the key id's prefix. */
function paymentsState(rz) {
  rz = rz || {};
  const id = String(rz.keyId || ''), secret = String(rz.keySecret || '');
  if (!id && !secret) return { state: 'off', label: 'not configured' };
  if (!id || !secret) return { state: 'half', label: 'HALF configured — one key without the other' };
  if (/^rzp_test_/i.test(id)) return { state: 'test', label: 'TEST keys' };
  if (/^rzp_live_/i.test(id)) return { state: 'live', label: 'LIVE keys' };
  return { state: 'unknown', label: 'keys set (prefix not recognised)' };
}

function diskFree(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch (e) { return { freeBytes: -1, totalBytes: -1 }; }
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-check-' + process.pid);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) { return false; }
}

const mb = n => (n < 0 ? '?' : (n / 1048576).toFixed(0) + ' MB');

/**
 * The report. `deps`: { cfg, siteUrl, mail, content, db, backup, dataDir,
 * gaId (function), uploadDir }.
 */
function report(deps) {
  const { cfg, siteUrl, mail, content, db, backup, dataDir } = deps;
  const items = [];
  const add = (key, level, label, value, hint) => items.push({ key, level, label, value, hint: hint || '' });

  /* URL */
  const own = /^https:\/\//i.test(siteUrl || '') && !/onrender\.com|localhost|127\.0\.0\.1/i.test(siteUrl || '');
  add('url', own ? 'ok' : (cfg.production ? 'warn' : 'info'), 'Public address', siteUrl || '(unset)',
    own ? '' : 'Set GLOVELS_URL=https://www.glovels.com on Render once the domain points here (www is the main address; glovels.com and glovels.onrender.com then 301 to it).');

  /* Indexing */
  add('indexing', cfg.allowIndexing ? 'ok' : (own ? 'warn' : 'info'), 'Search engines',
    cfg.allowIndexing ? 'allowed (index,follow; robots.txt and sitemap.xml live)' : 'kept away (noindex; robots.txt disallows)',
    cfg.allowIndexing ? '' : 'Set ALLOW_INDEXING=true (or GLOVELS_URL to the real domain in production) to be found.');

  /* Email */
  let ms = null;
  try { ms = mail && mail.status ? mail.status() : { mode: mail ? mail.mode : 'outbox' }; } catch (e) { ms = { mode: 'outbox' }; }
  const mailOn = ms && ms.mode !== 'outbox';
  add('email', mailOn ? 'ok' : 'warn', 'Email',
    mailOn ? (ms.mode === 'api' ? 'sending over HTTPS through ' + (ms.providerLabel || ms.provider || 'the provider') : 'sending through ' + (ms.host || 'SMTP'))
      : 'Brevo not configured — mail is queued in the outbox' + (ms && ms.waiting ? ' (' + ms.waiting + ' waiting)' : ''),
    mailOn ? '' : 'Set BREVO_API_KEY (and MAIL_FROM) on Render, or pick Brevo on Organisation → Email and paste the key.');

  /* Payments */
  const ps = paymentsState(cfg.razorpay);
  const hook = !!(cfg.razorpay && cfg.razorpay.webhookSecret);
  add('payments', ps.state === 'live' ? (hook ? 'ok' : 'warn') : ps.state === 'off' ? 'warn' : 'bad', 'Payments',
    ps.label + (ps.state === 'off' ? ' — orders are recorded, a counsellor collects' : hook ? ', webhook secret set' : ', NO webhook secret'),
    ps.state === 'live' && hook ? '' : 'Set RAZORPAY_KEY_ID (rzp_live_…), RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on Render; point the webhook at /api/razorpay/webhook.');

  /* Analytics */
  let ga = '';
  try { ga = deps.gaId ? deps.gaId() : ''; } catch (e) { ga = ''; }
  add('analytics', ga ? 'ok' : 'warn', 'Google Analytics', ga ? 'tag on the public pages (' + ga + ')' : 'no GA id',
    ga ? '' : 'Paste the G-XXXXXXXXXX id on Organisation → Traffic, or set GA_ID on Render.');

  /* Legal */
  const missing = legalMissing(content);
  add('legal', missing.length ? 'warn' : 'ok', 'Legal particulars',
    missing.length ? missing.length + ' blank: ' + missing.join(', ') : 'all ' + LEGAL_FIELDS.length + ' filled in',
    missing.length ? 'Home page → Legal: type the company details, or the policy pages show "Company details are being updated".' : '');

  /* Backups */
  const bdir = backup && backup.dir ? backup.dir : path.join(dataDir || '.', 'backups');
  const canWrite = writable(bdir);
  let copies = [];
  try { copies = backup ? backup.list() : []; } catch (e) { copies = []; }
  const last = copies[0] || null;
  let lastAt = '';
  if (last) { try { lastAt = fs.statSync(path.join(bdir, last.file)).mtime.toISOString(); } catch (e) { lastAt = ''; } }
  add('backups', canWrite ? (last ? 'ok' : 'info') : 'bad', 'Backups',
    (canWrite ? 'folder writable' : 'folder NOT writable') + (last ? ', last copy ' + last.file + (lastAt ? ' at ' + lastAt.slice(0, 16).replace('T', ' ') + ' UTC' : '') : ', no nightly copy yet (first one 5 minutes after start)'),
    canWrite ? 'Download /api/staff/backup.tar weekly and keep it off the host.' : 'Check the disk is mounted at DATA_DIR and writable.');

  /* Disk */
  const d = diskFree(dataDir || '.');
  const lowDisk = d.freeBytes >= 0 && d.freeBytes < 100 * 1048576;
  add('disk', d.freeBytes < 0 ? 'info' : lowDisk ? 'bad' : 'ok', 'Disk free on the data volume',
    mb(d.freeBytes) + (d.totalBytes > 0 ? ' of ' + mb(d.totalBytes) : ''),
    lowDisk ? 'Grow the Render disk (it can be grown, never shrunk).' : '');

  /* Catalogue */
  let cat = { onSite: 0, searchOnly: 0 };
  try { cat = db.catalogueStats(); } catch (e) {}
  add('catalogue', (cat.onSite + cat.searchOnly) > 0 ? 'ok' : 'bad', 'Catalogue',
    cat.onSite + ' programmes on site, ' + cat.searchOnly + ' search-only', (cat.onSite + cat.searchOnly) ? '' : 'The catalogue is empty — import the sheet.');

  /* Staff and test accounts */
  let people = [];
  try { people = ['admin', 'counsellor', 'editor', 'partner'].flatMap(r => db.staffByRole(r)); } catch (e) { people = []; }
  const admins = people.filter(p => p.role === 'admin').length;
  add('staff', admins >= 2 ? 'ok' : 'warn', 'Staff accounts', people.length + ' (' + admins + ' administrator' + (admins === 1 ? '' : 's') + ')',
    admins >= 2 ? '' : 'Add a second administrator so two people can reset each other.');
  let qa = null;
  try { qa = db.qaCandidates(); } catch (e) { qa = null; }
  const qaN = qa ? qa.students.length + qa.staff.length + qa.orders.length + qa.enquiries.length + qa.chats.length : 0;
  add('qa', qaN ? 'warn' : 'ok', 'QA test data',
    qa ? (qaN ? qaN + ' record(s): ' + qa.students.length + ' students, ' + qa.staff.length + ' test staff, ' + qa.orders.length + ' orders, ' + qa.enquiries.length + ' enquiries, ' + qa.chats.length + ' chats' : 'none left') : 'unknown',
    qaN ? 'Organisation → Settings → Remove QA test data.' : '');

  const worst = items.some(i => i.level === 'bad') ? 'bad' : items.some(i => i.level === 'warn') ? 'warn' : 'ok';
  return { ok: true, at: new Date().toISOString(), level: worst, items };
}

/** The start-up block, as lines. */
function lines(deps) {
  const r = report(deps);
  const out = ['  [golive] readiness: ' + r.level.toUpperCase()];
  r.items.forEach(i => {
    const mark = i.level === 'ok' ? '✓' : i.level === 'bad' ? '✗' : i.level === 'warn' ? '!' : '·';
    out.push('  [golive] ' + mark + ' ' + i.label + ': ' + i.value + (i.hint && i.level !== 'ok' ? ' — ' + i.hint : ''));
  });
  return out;
}

module.exports = { report, lines, legalMissing, paymentsState, LEGAL_FIELDS };
