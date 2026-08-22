'use strict';
/**
 * The JSON API the site and the portal talk to.
 *
 * Rules this file exists to enforce:
 *
 *   - The browser never decides who it is. Every portal route resolves the
 *     student from an HttpOnly session cookie, and a request for someone else's
 *     data cannot be expressed — the student id comes from the session, never
 *     from the request body.
 *   - The browser never decides what anything costs. The price list is derived
 *     from the packages block of the home page content, on the server, on every
 *     order; an `amount` arriving from the client is ignored. Editing a package
 *     price on the Home page screen therefore changes what checkout charges —
 *     which is the only way the price on the card and the price in the receipt
 *     can be guaranteed to agree.
 *   - Money is integer paise. Never floats.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const EMAILS = require('./emails.js');
const SHEET = require('./sheet.js');
const WRITING = require('./writing.js');
const { cleanWriting: CLEAN_WRITING } = require('./content.js');

const DAY = 864e5;

/* Prices live here, not in the page. Kept in sync with the package cards by
   `npm test`-style drift checks upstream; if these disagree with the site, the
   server wins and the visitor is charged what the server says. */
/* The list of last resort. It is used only if the content module is absent —
   a caller constructing the API without it, which the test harness does — so
   that an order in that case is priced wrongly-but-safely rather than crashing.
   In the running server the real list comes from the packages block. */
const FALLBACK_PACKAGES = {
  'pkg-roadmap':  { name: 'Roadmap',       paise:  999900, publicUnis: 5  },
  'pkg-offer':    { name: 'Offer Letter',  paise: 4999900, publicUnis: 10 },
  'pkg-boarding': { name: 'Boarding Pass', paise: 7499900, publicUnis: 15 },
};

const GST_RATE = 0.18;

/* ------------------------------------------------------------------ helpers */

const json = (res, code, obj, headers) => {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  }, headers || {}));
  res.end(body);
};

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > 25 * 1024 * 1024) { req.destroy(); reject(new Error('too large')); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const readJson = async req => {
  const raw = (await readBody(req)).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
};

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

/* scrypt, from the standard library. Storing a password any other way — plain,
   or a bare SHA — is the difference between an embarrassing breach and a
   catastrophic one, because people reuse passwords. */
const hashPassword = (pw, salt) =>
  crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

const newSalt = () => crypto.randomBytes(16).toString('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');

const safeEqual = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));
/*
 * Reduce anything a person might type to the ten digits of an Indian mobile.
 *
 * The obvious version — strip non-digits, then strip a leading "91" — is wrong,
 * and wrong in a way that only shows up for real customers: 91 is also the
 * start of a legitimate ten-digit mobile. 9123456781 became 23456781 and was
 * refused as "not a valid Indian mobile" at sign-up, at checkout and on the
 * counselling form. Every number in the 91xxxxxxxx range — a whole live series —
 * could not buy anything.
 *
 * So the country code is only removed when removing it actually leaves ten
 * digits: length decides, not the prefix.
 */
const tenDigits = p => {
  const d = String(p || '').replace(/\D+/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);   // +91 98765 43210
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);    // 0 98765 43210
  if (d.length > 10) return d.slice(-10);                          // 0091..., +91-0...
  return d;
};
const validPhone = p => /^[6-9]\d{9}$/.test(tenDigits(p));

/* Very small multipart parser — one file field plus text fields, which is all
   the upload form sends. A general parser is a dependency; this is 30 lines. */
function parseMultipart(buf, boundary) {
  const out = { fields: {}, file: null };
  const sep = Buffer.from('--' + boundary);
  let start = buf.indexOf(sep);
  while (start !== -1) {
    const next = buf.indexOf(sep, start + sep.length);
    if (next === -1) break;
    const part = buf.slice(start + sep.length, next);
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd > 0) {
      const head = part.slice(0, headEnd).toString('utf8');
      const body = part.slice(headEnd + 4, part.length - 2);   // strip trailing CRLF
      const name = /name="([^"]*)"/.exec(head);
      const file = /filename="([^"]*)"/.exec(head);
      if (name) {
        if (file && file[1]) out.file = { field: name[1], filename: file[1], data: body };
        else out.fields[name[1]] = body.toString('utf8');
      }
    }
    start = next;
  }
  return out;
}

/* ------------------------------------------------------------------- routes */

function makeApi({ db, uploadDir, catalogue, countries, mail, notify, live, siteUrl, config, content }) {
  /* Prices are read per request, never captured. A package edited at 11:02 is
     charged at the new price at 11:03, without a restart. */
  const PACKAGES = () => (content ? content.priceList() : FALLBACK_PACKAGES);
  const CFG = config || { secureCookies: false, maxLoginAttempts: 1e9, loginWindowMs: 60000 };
  fs.mkdirSync(uploadDir, { recursive: true });

  /* The catalogue is editable now, so it cannot be captured once at start-up.
     Both are read fresh — a programme a counsellor adds is valid on the very
     next request, not after a restart. */
  const cat = () => (typeof catalogue === 'function' ? catalogue() : (catalogue || []));
  const countryMap = () => (typeof countries === 'function' ? countries() : (countries || {}));
  const lookup = id => cat().find(p => p.id === String(id)) || null;

  /* Secure is added in production only. Setting it on plain HTTP means the
     browser silently drops the cookie and sign-in appears to do nothing. */
  const sessionCookie = (token, days) =>
    'glovels_session=' + token + '; Path=/; HttpOnly; SameSite=Lax'
    + (CFG.secureCookies ? '; Secure' : '')
    + '; Max-Age=' + Math.round(days * 86400);

  const me = req => db.sessionStudent(cookies(req).glovels_session);

  /* `perms` travels with the user everywhere, including to a student, where it
     is always empty. One shape for one thing beats two, and the sign-in
     redirect needs it before it knows what kind of account it has. */
  const publicStudent = s => ({
    id: s.id, name: s.name, email: s.email, phone: s.phone, role: s.role,
    perms: db.permsOf(s),
  });

  /* The whole of a student's portal in one response. The portal screens each
     need a slice of it and there is no benefit in six round trips on load. */
  function stateFor(s) {
    const orders = db.ordersFor(s.id);
    const docs = {};
    db.getDocuments(s.id).forEach(d => {
      docs[d.doc_key] = {
        file: d.filename,
        size: d.bytes > 1048576 ? (d.bytes / 1048576).toFixed(1) + ' MB'
                                : Math.max(1, Math.round(d.bytes / 1024)) + ' KB',
        status: d.status,
      };
    });
    const apps = {};
    db.getApplications(s.id).forEach(a => { apps[a.prog_id] = { stage: a.stage, outcome: a.outcome }; });
    const c = s.counsellor_id ? db.studentById(s.counsellor_id) : null;
    return {
      user: publicStudent(s),
      counsellor: c ? { name: c.name, id: c.id } : null,
      unread: db.unreadForStudent(s.id),
      profile: db.getProfile(s.id),
      shortlist: db.getShortlist(s.id).map(r => ({
        id: r.prog_id, program: r.program, university: r.university, city: r.city,
        country: r.country, totalInr: r.total_inr, isPublic: !!r.is_public, url: r.url,
        fit: r.fit || null,
        intakes: (() => { try { return JSON.parse(r.intakes); } catch (e) { return []; } })(),
      })),
      apps,
      docs,
      saved: db.getSaved(s.id),
      drafts: draftsFor(s.id),
      msgs: db.getMessages(s.id).map(m => ({ who: m.sender, t: m.body, file: m.file, at: m.created_at })),
      order: orders[0] ? {
        reference: orders[0].reference, package: orders[0].package,
        publicUnis: orders[0].public_unis, grossPaise: orders[0].gross_paise,
        paidAt: orders[0].created_at,
      } : null,
      orders: orders.map(o => ({
        reference: o.reference, package: o.package, grossPaise: o.gross_paise,
        publicUnis: o.public_unis, status: o.status, paidAt: o.created_at,
      })),
    };
  }

  /* The counsellor's first two messages. Seeded server-side on the student's
     first visit so the thread is identical on every device they sign in from. */
  function seedMessages(s) {
    if (db.getMessages(s.id).length) return;
    db.addMessage(s.id, 'them',
      'Hi! I am Kavya, your counsellor for the Germany desk. I have your profile open. '
      + 'Once your documents are verified I will confirm the shortlist with you on a call.', '');
    db.addMessage(s.id, 'them',
      'Two things worth starting now, because they are the slowest: the APS certificate '
      + '(6–8 weeks) and your blocked account. Everything else can follow.', '');
  }

  /*
   * Sign-in throttling. Counted per email AND per address, because either on its
   * own is easy to walk around: one address trying a thousand emails, or a
   * thousand addresses trying one email.
   *
   * In memory, so it resets on restart — which is fine for slowing a guesser
   * down and honest about what it is. A real deployment behind a CDN should let
   * the CDN do this too.
   */
  const attempts = new Map();
  function tooMany(key) {
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || now - rec.first > CFG.loginWindowMs) return false;
    return rec.n >= CFG.maxLoginAttempts;
  }
  function noteFailure(key) {
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || now - rec.first > CFG.loginWindowMs) attempts.set(key, { n: 1, first: now });
    else rec.n++;
    if (attempts.size > 5000) {                       // never grow without bound
      for (const [k, v] of attempts) if (now - v.first > CFG.loginWindowMs) attempts.delete(k);
    }
  }
  const clearFailures = key => attempts.delete(key);
  const clientIp = req =>
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';

  const ROUTES = [];
  /*
   * `open` means "no sign-in required". It also meant "do not look the session
   * up at all", which is not the same thing and cost an afternoon: the studio's
   * draft endpoint is open — a visitor may try it before making an account —
   * but when a student IS signed in the draft has to be saved to their account,
   * and the handler was always handed a null session.
   *
   * `soft` is the missing third state: anyone may call this, and if they happen
   * to be signed in the handler is told who they are. It is opt-in rather than
   * the default for every open route, because handing a live session to a
   * handler written on the assumption of null is how a public endpoint starts
   * quietly returning private data.
   */
  const route = (method, pattern, handler, opts) =>
    ROUTES.push({ method, pattern, handler,
      auth: !(opts && opts.open), soft: !!(opts && opts.soft) });

  /* ---------------------------------------------------------------- auth */

  route('POST', '/api/auth/signup', async (req, res) => {
    const b = await readJson(req);
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim();
    const pw = String(b.password || '');

    if (!name) return json(res, 422, { error: 'Tell us your name' });
    if (!validEmail(email)) return json(res, 422, { error: 'That email address is not valid' });
    if (phone && !validPhone(phone)) return json(res, 422, { error: 'A 10-digit Indian mobile, please' });
    if (pw.length < 8) return json(res, 422, { error: 'Use at least 8 characters' });
    if (db.studentByEmail(email)) return json(res, 409, { error: 'That email already has an account. Sign in instead.' });

    const salt = newSalt();
    const s = db.createStudent(email, name, tenDigits(phone) ? '+91' + tenDigits(phone) : '', hashPassword(pw, salt), salt);
    const claimed = db.claimOrders(s.id, email);
    seedMessages(s);

    mail.send(Object.assign({ to: s.email },
      EMAILS.welcome({ name: s.name, email: s.email, siteUrl }))).catch(() => {});

    const token = newToken();
    db.createSession(token, s.id, 30);
    return json(res, 200, { user: publicStudent(s), claimedOrders: claimed },
      { 'Set-Cookie': sessionCookie(token, 30) });
  }, { open: true });

  route('POST', '/api/auth/login', async (req, res) => {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const ip = clientIp(req);

    if (tooMany('e:' + email) || tooMany('i:' + ip)) {
      return json(res, 429, {
        error: 'Too many sign-in attempts. Wait '
          + Math.round(CFG.loginWindowMs / 60000) + ' minutes and try again, '
          + 'or use "Forgot password?".',
      });
    }

    const s = db.studentByEmail(email);
    /* One message for "no such account" and "wrong password". Telling them
       apart is a way to find out which addresses are registered. */
    const bad = () => {
      noteFailure('e:' + email);
      noteFailure('i:' + ip);
      return json(res, 401, { error: 'That email and password do not match an account.' });
    };
    if (!s) return bad();
    if (!safeEqual(hashPassword(String(b.password || ''), s.pass_salt), s.pass_hash)) return bad();
    clearFailures('e:' + email);
    clearFailures('i:' + ip);

    db.claimOrders(s.id, email);
    seedMessages(s);
    const token = newToken();
    const days = b.remember === false ? 1 : 30;
    db.createSession(token, s.id, days);
    return json(res, 200, { user: publicStudent(s) }, { 'Set-Cookie': sessionCookie(token, days) });
  }, { open: true });

  route('POST', '/api/auth/logout', async (req, res) => {
    db.dropSession(cookies(req).glovels_session);
    return json(res, 200, { ok: true },
      { 'Set-Cookie': 'glovels_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }, { open: true });

  route('GET', '/api/auth/me', async (req, res) => {
    const s = me(req);
    return json(res, 200, s ? { user: publicStudent(s) } : { user: null });
  }, { open: true });

  /* --------------------------------------------------------------- state */

  route('GET', '/api/state', async (req, res, s) => json(res, 200, stateFor(s)));

  route('PUT', '/api/profile', async (req, res, s) => {
    const b = await readJson(req);
    db.putProfile(s.id, b.profile || {});
    /* Name and phone typed into the profile are the student's own record, so
       they update the account too rather than living in two places. */
    const p = b.profile || {};
    if (p.fullName || p.phone) {
      db.updateStudent(s.id, p.fullName || s.name,
        validPhone(p.phone) ? '+91' + tenDigits(p.phone) : s.phone);
    }
    return json(res, 200, { ok: true });
  });

  /* ----------------------------------------------------------- shortlist */

  route('POST', '/api/shortlist', async (req, res, s) => {
    const b = await readJson(req);
    /* The client sends an id. The server looks the programme up in its own
       catalogue — so a fabricated price or university name cannot be stored. */
    const p = lookup(b.id);
    if (!p) return json(res, 404, { error: 'No such programme' });
    db.addShortlist(s.id, p);
    return json(res, 200, { shortlist: stateFor(s).shortlist });
  });

  route('DELETE', /^\/api\/shortlist\/(.+)$/, async (req, res, s, m) => {
    db.removeShortlist(s.id, decodeURIComponent(m[1]));
    db.removeApplication(s.id, decodeURIComponent(m[1]));
    return json(res, 200, { shortlist: stateFor(s).shortlist });
  });

  /* Used once, right after checkout, to store what the sales page matched. */
  route('POST', '/api/shortlist/bulk', async (req, res, s) => {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids : [];
    let n = 0;
    ids.forEach(id => { const p = lookup(id); if (p) { db.addShortlist(s.id, p); n++; } });
    return json(res, 200, { added: n, shortlist: stateFor(s).shortlist });
  });

  /* -------------------------------------------------------- applications */

  route('PUT', /^\/api\/applications\/(.+)$/, async (req, res, s, m) => {
    const b = await readJson(req);
    const progId = decodeURIComponent(m[1]);
    const stage = Math.max(0, Math.min(4, Number(b.stage) || 0));
    const outcome = ['', 'offer', 'no'].includes(b.outcome) ? b.outcome : '';
    db.putApplication(s.id, progId, stage, outcome);
    return json(res, 200, { ok: true });
  });

  /* ----------------------------------------------------------- documents */

  route('POST', '/api/documents', async (req, res, s) => {
    const ct = req.headers['content-type'] || '';
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!bm) return json(res, 400, { error: 'Expected a file upload' });
    const parsed = parseMultipart(await readBody(req), (bm[1] || bm[2]).trim());
    const key = String(parsed.fields.key || '').replace(/[^a-z0-9_-]/gi, '');
    if (!key || !parsed.file) return json(res, 400, { error: 'Missing file or key' });

    const dir = path.join(uploadDir, String(s.id));
    fs.mkdirSync(dir, { recursive: true });
    const ext = (path.extname(parsed.file.filename) || '').slice(0, 10).replace(/[^.a-z0-9]/gi, '');
    const stored = key + '-' + Date.now() + ext;
    fs.writeFileSync(path.join(dir, stored), parsed.file.data);

    /* Replacing a document removes the previous file rather than leaving it on
       disk — it is a passport scan, not a build artifact. */
    const prev = db.docByKey(s.id, key);
    if (prev) {
      try { fs.unlinkSync(path.join(dir, prev.stored_name)); } catch (e) {}
      db.removeDocument(s.id, key);
    }
    db.addDocument(s.id, key, parsed.file.filename, stored, parsed.file.data.length);
    return json(res, 200, { docs: stateFor(s).docs });
  });

  route('DELETE', /^\/api\/documents\/(.+)$/, async (req, res, s, m) => {
    const key = decodeURIComponent(m[1]);
    const rec = db.docByKey(s.id, key);
    if (rec) {
      try { fs.unlinkSync(path.join(uploadDir, String(s.id), rec.stored_name)); } catch (e) {}
      db.removeDocument(s.id, key);
    }
    return json(res, 200, { docs: stateFor(s).docs });
  });

  /* Stands in for the counsellor opening each file and confirming it.
     PROD: this belongs on the counsellor's screen, not the student's. */
  route('POST', '/api/documents/verify-all', async (req, res, s) => {
    let n = 0;
    db.getDocuments(s.id).forEach(d => {
      if (d.status === 'wait') { db.setDocStatus(s.id, d.doc_key, 'ok'); n++; }
    });
    return json(res, 200, { verified: n, docs: stateFor(s).docs });
  });

  /* Serves a student their own file back, and nobody else's — the path is
     built from the session, so an id in the URL cannot reach another student. */
  route('GET', /^\/api\/documents\/(.+)\/file$/, async (req, res, s, m) => {
    const rec = db.docByKey(s.id, decodeURIComponent(m[1]));
    if (!rec) return json(res, 404, { error: 'Not found' });
    const file = path.join(uploadDir, String(s.id), rec.stored_name);
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + rec.filename.replace(/"/g, '') + '"',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });

  /* ------------------------------------------------------------ messages */

  route('POST', '/api/messages', async (req, res, s) => {
    const b = await readJson(req);
    const body = String(b.body || '').slice(0, 4000);
    const file = String(b.file || '').slice(0, 200);
    if (!body && !file) return json(res, 422, { error: 'Nothing to send' });

    db.addMessage(s.id, 'me', body, file);
    const msgs = stateFor(s).msgs;
    const last = msgs[msgs.length - 1];

    /* Push it to the counsellor's open workspace immediately. This is the whole
       point of the change: a message that needs a refresh to appear is not a
       conversation, it is a form. */
    live.toThread(s.id, s.counsellor_id, 'message', {
      studentId: s.id, studentName: s.name, msg: last,
    });

    /* Nobody watching means it has to leave the building, or it waits until
       somebody happens to log in. Online, the push already did the job and an
       email as well would just be noise. */
    const counsellor = s.counsellor_id ? db.studentById(s.counsellor_id) : null;
    const target = counsellor || db.staffByRole('admin')[0] || null;
    if (target && !live.isOnline('staff', target.id)) {
      notify.notify({
        to: target.email,
        phone: target.phone,
        email: EMAILS.newStudentMessage({
          studentName: s.name, studentEmail: s.email,
          body: body || ('Sent a file: ' + file), siteUrl,
        }),
        whatsapp: { text: `New Glovels message from ${s.name}: "${String(body).slice(0, 120)}"` },
      }).catch(() => {});
    }

    return json(res, 200, { msgs });
  });

  /* Reading the thread clears the student's unread count. */
  route('POST', '/api/messages/read', async (req, res, s) => {
    db.markRead(s.id, 'student');
    return json(res, 200, { unread: 0 });
  });

  /* -------------------------------------------------------- scholarships */

  route('PUT', /^\/api\/scholarships\/(.+)$/, async (req, res, s, m) => {
    const b = await readJson(req);
    const id = decodeURIComponent(m[1]);
    if (b.saved) db.saveScholarship(s.id, id); else db.unsaveScholarship(s.id, id);
    return json(res, 200, { saved: db.getSaved(s.id) });
  });

  /* -------------------------------------------------------------- orders */

  route('POST', '/api/orders', async (req, res) => {
    const b = await readJson(req);
    const pkg = PACKAGES()[b.packageId];
    /* The browser sends an id. The server prices it. An `amount` in the request
       is ignored, and there is a test named for that. */
    if (!pkg) return json(res, 400, { error: 'No such package' });

    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim();
    if (!name) return json(res, 422, { error: 'Tell us your name' });
    if (!validEmail(email)) return json(res, 422, { error: 'That email address is not valid' });
    if (!validPhone(phone)) return json(res, 422, { error: 'A 10-digit Indian mobile, please' });

    const s = me(req);
    const reference = 'GLV-' + crypto.randomInt(1000, 9999);
    const order = db.addOrder({
      studentId: s ? s.id : null, reference, package: pkg.name,
      publicUnis: pkg.publicUnis, grossPaise: pkg.paise, name, email, phone,
      status: 'paid',
    });

    const gross = pkg.paise;
    const tax = Math.round(gross - gross / (1 + GST_RATE));

    /* The receipt is the message that tells a guest how to get into the portal
       they just paid for, so it goes out whether or not they have an account. */
    mail.send(Object.assign({ to: email }, EMAILS.orderReceipt({
      name, email, reference, packageName: pkg.name, grossPaise: gross,
      publicUnis: pkg.publicUnis, siteUrl, hasAccount: !!s,
    }))).catch(() => {});

    return json(res, 200, {
      reference, package: pkg.name, publicUnis: pkg.publicUnis,
      grossPaise: gross, taxablePaise: gross - tax, taxPaise: tax,
      linkedToAccount: !!s,
      createdAt: order.created_at,
    });
  }, { open: true });

  route('GET', '/api/orders', async (req, res, s) => json(res, 200, { orders: stateFor(s).orders }));

  /* ----------------------------------------------------------- enquiries */

  const enquiry = async (req, res) => {
    const b = await readJson(req);
    if (b.website) return json(res, 200, { ok: true });          // honeypot
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone || !email) return json(res, 422, { ok: false, error: 'Name, phone and email are required' });
    if (!validEmail(email)) return json(res, 422, { ok: false, error: 'That email address is not valid' });
    if (!validPhone(phone)) return json(res, 422, { ok: false, error: 'That does not look like an Indian mobile number' });
    const record = {
      name, email, phone: '+91' + tenDigits(phone),
      destination: b.destination, consent: b.consent,
      sourcePage: b.sourcePage, referrer: b.referrer,
    };
    db.addEnquiry(record);

    /* Two messages: the office gets the lead, the enquirer gets an
       acknowledgement. A form that goes quiet is a lead that calls a competitor
       to check they were heard. Reply-To is set to the enquirer so the office
       can just hit reply. */
    mail.send(Object.assign({ to: mail.office, replyTo: email },
      EMAILS.enquiryToOffice(record))).catch(() => {});
    mail.send(Object.assign({ to: email },
      EMAILS.enquiryToStudent({ name, destination: b.destination }))).catch(() => {});

    return json(res, 200, { ok: true });
  };
  route('POST', '/api/enquiries', enquiry, { open: true });
  route('POST', '/send.php', enquiry, { open: true });     // the live host's path

  /* Drafts as the portal shows them: the stored JSON parsed back, newest first,
     capped at what a screen can sensibly list. */
  const draftsFor = id => db.drafts(id).slice(0, 30).map(r => {
    let body = {};
    try { body = JSON.parse(r.body) || {}; } catch (e) {}
    return {
      id: r.id, kind: r.kind, programme: r.programme, university: r.university,
      at: r.created_at, paragraphs: body.paragraphs || [], words: body.words || 0,
      caveat: body.caveat || '',
    };
  });

  /* ------------------------------------------------------ the chat box */
  /*
   * The chat box on the marketing site.
   *
   * A visitor who is not signed in is the whole point. Making them create an
   * account before they can ask "do I need IELTS for Germany?" is how a chat
   * box becomes decoration — so a chat is identified by a random token in a
   * cookie, and the only thing asked for up front is a name and a way to call
   * back, which is what makes it a lead rather than an anonymous question.
   *
   * A student who IS signed in gets their real thread instead: the same
   * conversation as the Messages screen, with the same counsellor, so a
   * question asked from the home page does not start a second conversation
   * nobody joins up.
   */
  const chatCookie = token =>
    'glovels_chat=' + token + '; Path=/; HttpOnly; SameSite=Lax'
    + (CFG.secureCookies ? '; Secure' : '')
    + '; Max-Age=' + (60 * 86400);

  const chatOf = req => {
    const t = cookies(req).glovels_chat;
    return t ? db.chatByToken(t) : null;
  };

  const chatShape = c => ({
    id: c.id, name: c.name, phone: c.phone, email: c.email,
    status: c.status, at: c.created_at, lastAt: c.last_at,
    messages: db.chatMessages(c.id).map(m => ({
      who: m.sender, t: m.body, name: m.who, at: m.created_at,
    })),
  });

  /* Where a signed-in student's chat goes: their real thread, not a guest one. */
  const studentThread = s => ({
    signedIn: true,
    name: s.name,
    counsellor: s.counsellor_id ? (db.studentById(s.counsellor_id) || {}).name || '' : '',
    messages: db.getMessages(s.id).map(m => ({
      who: m.sender, t: m.body, name: '', at: m.created_at,
    })),
  });

  route('GET', '/api/chat', async (req, res, s) => {
    if (s && s.role === 'student') return json(res, 200, studentThread(s));
    const c = chatOf(req);
    return json(res, 200, c ? Object.assign({ signedIn: false }, chatShape(c))
                            : { signedIn: false, messages: [], started: false });
  }, { open: true, soft: true });

  route('POST', '/api/chat/start', async (req, res, s) => {
    if (s && s.role === 'student') return json(res, 200, studentThread(s));

    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 80);
    const contact = String(b.contact || '').trim().slice(0, 120);
    if (!name) return json(res, 422, { error: 'Your name, so we know who we are talking to.' });

    const isEmail = contact.includes('@');
    const phone = !isEmail ? tenDigits(contact) : '';
    if (isEmail && !validEmail(contact)) {
      return json(res, 422, { error: 'That email address does not look right.' });
    }
    if (!isEmail && !phone) {
      return json(res, 422, { error: 'A 10-digit mobile number, or an email address.' });
    }

    /* One chat per browser. Coming back the next day continues the same
       conversation rather than starting a second one a different counsellor
       picks up with no history. */
    const existing = chatOf(req);
    if (existing) return json(res, 200, Object.assign({ signedIn: false }, chatShape(existing)));

    const token = newToken();
    const c = db.createChat(token, {
      name, phone: phone ? '+91' + phone : '', email: isEmail ? contact.toLowerCase() : '',
      page: String(b.page || '').slice(0, 200),
    });

    /* A chat is a lead. It goes in the enquiries book the same as the form, so
       nobody has to remember to look in two places for the same person. */
    try {
      db.addEnquiry({
        name, phone: phone ? '+91' + phone : '', email: isEmail ? contact.toLowerCase() : '',
        destination: '', consent: 'chat', sourcePage: String(b.page || '').slice(0, 200),
        referrer: String(req.headers.referer || '').slice(0, 200),
      });
    } catch (e) { /* a lead that could not be filed must not lose the chat */ }

    live.toAllStaff('chat', { id: c.id, name: c.name, at: c.created_at, kind: 'started' });
    return json(res, 200, Object.assign({ signedIn: false }, chatShape(c)),
      { 'Set-Cookie': chatCookie(token) });
  }, { open: true, soft: true });

  route('POST', '/api/chat/send', async (req, res, s) => {
    const b = await readJson(req);
    const body = String(b.body || '').trim().slice(0, 2000);
    if (!body) return json(res, 422, { error: 'Nothing to send' });

    /* Signed in: this is their real conversation with their counsellor. */
    if (s && s.role === 'student') {
      db.addMessage(s.id, 'me', body, '');
      const msgs = stateFor(s).msgs;
      /* The same shape the Messages screen's own sends produce, so a message
         typed into the chat box lands in the counsellor's open thread exactly
         as one typed into the full screen does. Two shapes for one event is how
         a message arrives live on one screen and not the other. */
      live.toThread(s.id, s.counsellor_id, 'message', {
        studentId: s.id, studentName: s.name, msg: msgs[msgs.length - 1],
      });
      const counsellor = s.counsellor_id ? db.studentById(s.counsellor_id) : null;
      const target = counsellor || db.staffByRole('admin')[0] || null;
      if (target && !live.isOnline('staff', target.id)) {
        notify.notify({
          to: target.email, phone: target.phone,
          email: EMAILS.newStudentMessage({
            studentName: s.name, studentEmail: s.email, body, siteUrl,
          }),
          whatsapp: { text: `New Glovels message from ${s.name}: "${body.slice(0, 120)}"` },
        }).catch(() => {});
      }
      return json(res, 200, studentThread(s));
    }

    const c = chatOf(req);
    if (!c) return json(res, 409, { error: 'Tell us your name first.' });
    const m = db.addChatMessage(c.id, 'me', body, c.name);
    live.toAllStaff('chat', {
      id: c.id, name: c.name, kind: 'message', t: body, at: m.created_at,
    });
    return json(res, 200, Object.assign({ signedIn: false }, chatShape(db.chatById(c.id))));
  }, { open: true, soft: true });

  /* The visitor's live channel. Keyed by the cookie, so it cannot be used to
     listen to anybody else's conversation. */
  route('GET', '/api/chat/live', async (req, res) => {
    const c = chatOf(req);
    if (!c) return json(res, 404, { error: 'No chat here yet' });
    live.subscribe(req, res, { id: c.token, role: 'guest' });
    return true;
  }, { open: true });

  /* ------------------------------------------------------- the AI studio */
  /*
   * The SOP and LOR studio.
   *
   * The drafting moved off the page and onto the server for three reasons, in
   * order of how much they matter:
   *
   *   The wording is editable. It lives in the `writing` content block, so the
   *   office rewrites how a draft opens without a developer and without a
   *   rebuild.
   *
   *   A draft can be kept. A student who is signed in gets theirs saved, sees
   *   it in their portal, and their counsellor sees it too — which is the
   *   point, since the thing being sold is a human rewrite of exactly this.
   *
   *   The phrasing is not in the page source for anyone to lift.
   *
   * Open to visitors who are not signed in: the studio sits on the public home
   * page and asking people to make an account before they can see what it does
   * is how you find out nobody tries it. Signed out, the draft is returned and
   * not stored.
   */
  const DRAFT_LIMIT = 40;                     // per address, per hour
  const draftHits = new Map();
  function draftAllowed(ip) {
    const now = Date.now();
    const rec = draftHits.get(ip);
    if (!rec || now - rec.first > 36e5) { draftHits.set(ip, { n: 1, first: now }); return true; }
    rec.n++;
    if (draftHits.size > 5000) {
      for (const [k, v] of draftHits) if (now - v.first > 36e5) draftHits.delete(k);
    }
    return rec.n <= DRAFT_LIMIT;
  }

  route('POST', '/api/ai/draft', async (req, res, s) => {
    if (!content) return noContent(res);
    if (!draftAllowed(clientIp(req))) {
      return json(res, 429, {
        error: 'That is a lot of drafts in one hour. Try again shortly, or talk to a '
             + 'counsellor — they can write it with you.',
      });
    }

    const b = await readJson(req);
    const kind = b.kind === 'lor' ? 'lor' : 'sop';
    const bank = content.get('writing');

    /* Refusing an empty pick here as well as in the page. The page's check is a
       courtesy; this one is the rule, because a draft assembled from nothing is
       four sentences of scaffolding with no evidence in them — exactly the
       thing this studio must never produce. */
    const picked = (Array.isArray(b.signals) ? b.signals : []).filter(Boolean);
    if (!picked.length) {
      return json(res, 422, {
        error: kind === 'sop'
          ? 'Pick at least one thing for the draft to draw on.'
          : 'Pick at least one thing the referee actually saw.',
      });
    }

    const out = WRITING.draft(bank, {
      kind,
      programme: b.programme, university: b.university,
      signals: picked, motives: b.motives,
      who: b.who, span: b.span, instance: b.instance,
    }, b.pass);

    if (!out.paragraphs.length) {
      return json(res, 500, {
        error: 'The studio has nothing to write with at the moment. A counsellor can '
             + 'write it with you — tell them the writing bank is empty.',
      });
    }

    /* Saved only for a signed-in student. Staff drafting on a student's behalf
       is a different feature and would need to say whose it is. */
    let saved = null;
    if (s && s.role === 'student') {
      const row = db.addDraft(s.id, out);
      saved = { id: row.id, at: row.created_at };
    }

    return json(res, 200, { draft: out, saved });
  }, { open: true, soft: true });

  /* The chips the studio shows. Labels and keys only — the phrases stay on the
     server, both because the page has no use for them and because they are the
     part worth keeping off a competitor's clipboard. */
  route('GET', '/api/ai/chips', async (req, res) => {
    if (!content) return noContent(res);
    const w = content.get('writing');
    const strip = a => (a || []).map(c => ({ key: c.key, label: c.label }));
    return json(res, 200, {
      sop: { signals: strip(w.sop.signals), motives: strip(w.sop.motives) },
      lor: { signals: strip(w.lor.signals) },
    });
  }, { open: true });

  route('GET', '/api/ai/drafts', async (req, res, s) => {
    if (!s) return json(res, 401, { error: 'Please sign in' });
    return json(res, 200, { drafts: draftsFor(s.id) });
  });

  route('DELETE', /^\/api\/ai\/draft\/(\d+)$/, async (req, res, s, m) => {
    if (!s) return json(res, 401, { error: 'Please sign in' });
    db.deleteDraft(s.id, Number(m[1]));
    return json(res, 200, { deleted: true, drafts: draftsFor(s.id) });
  });

  /* --------------------------------------------------------- catalogue */

  /* The home page reads this, so a university added on the operations screen
     shows up in the finder without anyone rebuilding the site. */
  route('GET', '/api/catalogue', async (req, res) => {
    /*
     * The home page reads this, so a university added on the operations screen
     * shows up in the finder without a rebuild.
     *
     * A PUBLIC university's name is the thing a package buys. So this endpoint —
     * which anyone can call — returns the facts a locked row needs to render
     * (country, level, field, band, fee band, deadlines, and the LENGTH of the
     * name so the blurred placeholder is the right width) and not the name
     * itself. Private universities were never gated and come back in full.
     *
     * Signed in with a paid order, the names come back up to what that package
     * covers — decided here, from the order, not from anything the browser says.
     *
     * ⚠️ unlocked.json is still served as a static file and does leak the names.
     * It is the last piece of the old build to remove; this endpoint does not
     * widen the hole.
     */
    const me_ = me(req);
    const order = me_ ? db.ordersFor(me_.id)[0] : null;
    const quota = order ? Number(order.public_unis || 0) : 0;
    let spent = 0;

    const programmes = cat().map(p => {
      if (!p.isPublic) return p;                       // never gated
      const mayName = spent < quota;
      if (mayName) spent++;
      return mayName ? p : {
        id: p.id, country: p.country, level: p.level, field: p.field,
        band: p.band, isPublic: true, fit: p.fit, intakes: p.intakes,
        totalInr: p.totalInr, freeTuition: (p.totalInr || 0) === 0,
        /* uKey groups programmes by university so the page can say "12 public
           universities" without naming one. featured/featureSort say where the
           row sits, not what it is. None of the three is the name. */
        uKey: p.uKey, featured: p.featured, featureSort: p.featureSort,
        nLen: String(p.program || '').length,
        uLen: String(p.university || '').length,
      };
    });

    return json(res, 200, {
      programmes,
      countries: countryMap(),
      /* Explicitly listed, so the page removes exactly what was switched off and
         nothing else. Filtering by "not in this list" would delete every row the
         database has never heard of. */
      inactive: db.programmes(true).filter(r => !r.active).map(r => r.id),
      unlockedCount: spent,
    });
  }, { open: true });

  /* ------------------------------------------------------------ live feed */

  /* One long-lived response per open tab. Everything below that says "push"
     ends up here. */
  route('GET', '/api/live', async (req, res, s) => {
    live.subscribe(req, res, { id: s.id, role: s.role === 'student' ? 'student' : 'staff' });
    return true;   // the response is deliberately left open
  });

  /* ------------------------------------------------------- password reset */

  route('POST', '/api/auth/forgot', async (req, res) => {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const s = db.studentByEmail(email);

    /* The same answer whether or not the account exists. Saying "no such
       account" turns this form into a way to find out who has one. */
    const answer = () => json(res, 200, {
      ok: true,
      message: 'If that email has an account, a reset link is on its way. It expires in 30 minutes.',
    });
    if (!s) return answer();

    const token = newToken();
    db.createReset(token, s.id, 30);
    const link = siteUrl + '/reset?token=' + token;
    mail.send(Object.assign({ to: s.email },
      EMAILS.passwordReset({ name: s.name, link, minutes: 30 }))).catch(() => {});
    return answer();
  }, { open: true });

  route('POST', '/api/auth/reset', async (req, res) => {
    const b = await readJson(req);
    const pw = String(b.password || '');
    if (pw.length < 8) return json(res, 422, { error: 'Use at least 8 characters' });
    const s = db.useReset(String(b.token || ''));
    if (!s) return json(res, 400, { error: 'That link has expired or has already been used. Ask for a new one.' });

    const salt = newSalt();
    db.setPassword(s.id, hashPassword(pw, salt), salt);   // also drops every session
    const token = newToken();
    db.createSession(token, s.id, 30);
    return json(res, 200, { user: publicStudent(db.studentById(s.id)) },
      { 'Set-Cookie': sessionCookie(token, 30) });
  }, { open: true });

  /* --------------------------------------------------------------- health */
  /*
   * What a host asks before it sends traffic to a new deploy.
   *
   * It touches the database on purpose. A process that has started but cannot
   * read its own disk is exactly the failure a health check exists to catch,
   * and answering "ok" from memory would hide it — the deploy would go live
   * and every request after it would fail.
   */
  route('GET', '/api/health', async (req, res) => {
    try {
      const n = db.countStudents();
      /* `demoAccounts` is read by the sign-in page, which hides its yellow
         "use student@glovels.com" box when there are none. It is not a secret:
         it says whether a well-known account exists, which anyone could
         discover by trying it once. */
      return json(res, 200, {
        ok: true, accounts: n, storage: db.kind,
        demoAccounts: !!(CFG.seedDemo && !CFG.production),
      });
    } catch (e) {
      return json(res, 503, { ok: false, error: 'the database is not readable' });
    }
  }, { open: true });

  /* --------------------------------------------------------------- staff */

  /* Every staff route goes through this. A counsellor sees the students
     assigned to them; an admin sees everyone. The check is here, on the
     server, because a screen that hides a row is not a permission. */
  const STAFF_ROLES = ['counsellor', 'admin', 'editor'];
  const staffOnly = handler => async (req, res, s, m) => {
    if (!STAFF_ROLES.includes(s.role)) {
      return json(res, 403, { error: 'Not your workspace' });
    }
    return handler(req, res, s, m);
  };

  /*
   * Three roles, and the difference between them is the point.
   *
   *   admin       everything, including who else gets in
   *   counsellor  their own students, and the chat
   *   editor      the website, and nothing else — no student, no document, no
   *               conversation. This is the account you hand to whoever writes
   *               the copy or keeps the university list current, and it is the
   *               reason the role exists rather than being a counsellor with a
   *               tick box: the safest permission is the one that was never
   *               granted.
   *
   * On top of the role, two permissions decide what may be CHANGED on the
   * website: `catalogue` (universities and destinations) and `content` (the
   * home page). An admin has both, always. Anybody else has what they were
   * given, which starts as nothing.
   */
  const can = (s, perm) => db.permsOf(s).includes(perm);

  /** For routes that read or write a student's own record. */
  const caseworkOnly = handler => staffOnly(async (req, res, s, m) => {
    if (s.role === 'editor') {
      return json(res, 403, {
        error: 'That account is for the website only. It cannot open student records.',
      });
    }
    return handler(req, res, s, m);
  });

  /** For routes that change the website. */
  const needs = (perm, handler) => staffOnly(async (req, res, s, m) => {
    if (!can(s, perm)) {
      return json(res, 403, {
        error: perm === 'catalogue'
          ? 'You do not have access to change the universities on this site. An administrator '
            + 'can give it to you on the Organisation screen.'
          : 'You do not have access to change the home page. An administrator can give it to '
            + 'you on the Organisation screen.',
      });
    }
    return handler(req, res, s, m);
  });

  route('GET', '/api/staff/me', staffOnly(async (req, res, s) => json(res, 200, {
    user: publicStudent(s),
    counsellors: s.role === 'admin'
      ? db.counsellors().map(c => ({ id: c.id, name: c.name, email: c.email }))
      : [],
    live: live.counts(),
    channels: notify.status(),
  })));

  route('GET', '/api/staff/students', caseworkOnly(async (req, res, s) => {
    const rows = db.staffStudents(s).map(st => {
      const last = db.lastMessage(st.id);
      const docs = db.getDocuments(st.id);
      const orders = db.ordersFor(st.id);
      const c = st.counsellor_id ? db.studentById(st.counsellor_id) : null;
      return {
        id: st.id, name: st.name, email: st.email, phone: st.phone,
        joined: st.created_at,
        counsellor: c ? { id: c.id, name: c.name } : null,
        shortlist: db.getShortlist(st.id).length,
        docsTotal: docs.length,
        docsVerified: docs.filter(d => d.status === 'ok').length,
        docsWaiting: docs.filter(d => d.status === 'wait').length,
        unread: db.unreadForStaff(st.id),
        package: orders[0] ? orders[0].package : null,
        lastMessage: last ? { who: last.sender, body: last.body, at: last.created_at } : null,
      };
    });
    return json(res, 200, { students: rows, role: s.role });
  }));

  route('GET', /^\/api\/staff\/student\/(\d+)$/, caseworkOnly(async (req, res, s, m) => {
    const id = Number(m[1]);
    if (!db.canSee(s, id)) return json(res, 403, { error: 'That student is not assigned to you' });
    const st = db.studentById(id);
    if (!st) return json(res, 404, { error: 'No such student' });
    db.markRead(id, 'staff');
    const c = st.counsellor_id ? db.studentById(st.counsellor_id) : null;
    return json(res, 200, {
      student: { id: st.id, name: st.name, email: st.email, phone: st.phone, joined: st.created_at },
      counsellor: c ? { id: c.id, name: c.name } : null,
      profile: db.getProfile(id),
      shortlist: stateFor(st).shortlist,
      apps: stateFor(st).apps,
      docs: db.getDocuments(id).map(d => ({
        key: d.doc_key, file: d.filename, status: d.status, at: d.uploaded_at,
        bytes: d.bytes,
      })),
      orders: stateFor(st).orders,
      /* The drafts the student wrote in the studio. The counsellor is the one
         being paid to rewrite them, so making them ask for a copy by email is
         a step that exists for no reason. */
      drafts: draftsFor(id),
      msgs: db.getMessages(id).map(x => ({ who: x.sender, t: x.body, file: x.file, at: x.created_at })),
    });
  }));

  route('POST', /^\/api\/staff\/student\/(\d+)\/message$/, caseworkOnly(async (req, res, s, m) => {
    const id = Number(m[1]);
    if (!db.canSee(s, id)) return json(res, 403, { error: 'That student is not assigned to you' });
    const b = await readJson(req);
    const body = String(b.body || '').trim().slice(0, 4000);
    if (!body) return json(res, 422, { error: 'Nothing to send' });

    db.addMessage(id, 'them', body, '');
    const st = db.studentById(id);
    const msgs = db.getMessages(id);
    const last = msgs[msgs.length - 1];
    const payload = { who: 'them', t: last.body, file: '', at: last.created_at };

    /* toThread already reaches the student — pushing to both delivered the same
       reply twice and it appeared as two bubbles. */
    live.toThread(id, st.counsellor_id, 'message',
      { studentId: id, studentName: st.name, msg: payload });

    if (!live.isOnline('student', id)) {
      notify.notify({
        to: st.email,
        phone: st.phone,
        email: EMAILS.counsellorReplied({
          studentName: st.name, counsellorName: s.name, body, siteUrl,
        }),
        whatsapp: { text: `${s.name} replied on Glovels: "${body.slice(0, 120)}"` },
      }).catch(() => {});
    }
    return json(res, 200, { msg: payload });
  }));

  /* Somebody is typing. Nothing is stored — it is a hint, and a hint that
     arrives late is worse than none. */
  route('POST', /^\/api\/staff\/student\/(\d+)\/typing$/, caseworkOnly(async (req, res, s, m) => {
    const id = Number(m[1]);
    if (!db.canSee(s, id)) return json(res, 403, { error: 'Not yours' });
    live.toStudent(id, 'typing', { from: s.name });
    return json(res, 200, { ok: true });
  }));

  route('POST', '/api/typing', async (req, res, s) => {
    live.toThread(s.id, s.counsellor_id, 'typing', { studentId: s.id, from: s.name });
    return json(res, 200, { ok: true });
  });

  /* The counsellor confirming a document is real — the action the student's own
     "simulate" button was standing in for. */
  route('POST', /^\/api\/staff\/student\/(\d+)\/document\/([a-z0-9_-]+)$/i,
    caseworkOnly(async (req, res, s, m) => {
      const id = Number(m[1]);
      if (!db.canSee(s, id)) return json(res, 403, { error: 'Not yours' });
      const b = await readJson(req);
      const status = ['ok', 'wait', 'none'].includes(b.status) ? b.status : 'wait';
      db.setDocStatus(id, m[2], status);
      live.toStudent(id, 'documents', { key: m[2], status });
      return json(res, 200, { ok: true });
    }));

  /* Assignment is the admin's decision and nobody else's — it is what unlocks a
     student's file for a counsellor. */
  route('PUT', /^\/api\/staff\/student\/(\d+)\/counsellor$/, caseworkOnly(async (req, res, s, m) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Only an admin can assign counsellors' });
    const b = await readJson(req);
    const cid = b.counsellorId === null || b.counsellorId === '' ? null : Number(b.counsellorId);
    if (cid !== null) {
      const c = db.studentById(cid);
      if (!c || c.role !== 'counsellor') return json(res, 400, { error: 'No such counsellor' });
    }
    db.assignCounsellor(Number(m[1]), cid);
    return json(res, 200, { ok: true });
  }));

  route('GET', '/api/staff/overview', caseworkOnly(async (req, res, s) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    const students = db.allStudents();
    const counsellors = db.counsellors();
    const docs = students.flatMap(st => db.getDocuments(st.id));
    const orders = students.flatMap(st => db.ordersFor(st.id));
    return json(res, 200, {
      students: students.length,
      unassigned: students.filter(st => !st.counsellor_id).length,
      counsellors: counsellors.map(c => ({
        id: c.id, name: c.name, email: c.email,
        caseload: students.filter(st => Number(st.counsellor_id) === c.id).length,
      })),
      enquiries: db.allEnquiries().length,
      orders: orders.length,
      revenuePaise: orders.reduce((a, o) => a + (o.gross_paise || 0), 0),
      docsWaiting: docs.filter(d => d.status === 'wait').length,
      online: live.counts(),
      channels: notify.status(),
    });
  }));

  /* --------------------------------------------------------------- people */
  /*
   * Adding a counsellor.
   *
   * On a laptop the three demo accounts are created by the seeder, so this was
   * never needed. On a public address SEED_DEMO is off, and without this the
   * organisation is one administrator and nobody to answer the chat — and no
   * way in the interface to change that. The only route would be editing the
   * database by hand, which is not a route.
   */

  route('GET', '/api/staff/people', caseworkOnly(async (req, res, s) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    const rows = db.staffByRole('counsellor')
      .concat(db.staffByRole('editor'))
      .concat(db.staffByRole('admin'));
    return json(res, 200, {
      people: rows.map(p => ({
        id: p.id, name: p.name, email: p.email, phone: p.phone || '', role: p.role,
        perms: db.permsOf(p),
        createdAt: p.created_at,
        caseload: db.allStudents().filter(st => Number(st.counsellor_id) === p.id).length,
      })).sort((a, b) => a.name.localeCompare(b.name)),
      me: s.id,
    });
  }));

  route('POST', '/api/staff/people', caseworkOnly(async (req, res, s) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().toLowerCase();
    const role = ['admin', 'editor', 'counsellor'].includes(b.role) ? b.role : 'counsellor';
    const phone = String(b.phone || '').trim();

    if (!name) return json(res, 422, { error: 'They need a name' });
    if (!validEmail(email)) return json(res, 422, { error: 'That email address is not valid' });
    if (db.studentByEmail(email)) {
      return json(res, 409, { error: 'Somebody already has that email address on this site' });
    }

    /* A password nobody has chosen, shown once. An admin inventing passwords
       for their staff is how "Glovels@123" ends up on four accounts. */
    const password = String(b.password || '') || crypto.randomBytes(9).toString('base64url');
    if (password.length < 10) {
      return json(res, 422, { error: 'A password for a staff account needs at least 10 characters' });
    }
    const salt = newSalt();
    const person = db.createStudent(email, name, phone, hashPassword(password, salt), salt, role);

    /* An editor with no permissions can sign in and see nothing, which reads as
       a broken account rather than a careful one. If none were asked for, give
       the one the role exists for. */
    let perms = Array.isArray(b.perms) ? b.perms : [];
    if (role === 'editor' && !perms.length) perms = ['content'];
    if (role !== 'admin') db.setPerms(person.id, perms);

    db.log(s.name,
      role === 'admin' ? 'administrator added'
        : role === 'editor' ? 'website editor added' : 'counsellor added',
      name + ' (' + email + ')'
        + (role === 'admin' ? '' : ' — may change: ' + (db.permsOf(db.studentById(person.id)).join(', ') || 'nothing')));
    /* Returned once and never stored in the clear. If it is lost, the admin
       sets a new one — there is a button for that beside the person. */
    return json(res, 200, {
      person: { id: person.id, name: person.name, email: person.email, role,
        perms: db.permsOf(db.studentById(person.id)) },
      password,
    });
  }));

  route('PUT', /^\/api\/staff\/people\/(\d+)\/role$/, caseworkOnly(async (req, res, s, m) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    const id = Number(m[1]);
    const b = await readJson(req);
    const role = ['student', 'counsellor', 'admin', 'editor'].includes(b.role) ? b.role : null;
    if (!role) {
      return json(res, 422, { error: 'A role is student, counsellor, editor or admin' });
    }

    const person = db.studentById(id);
    if (!person) return json(res, 404, { error: 'No such person' });

    /* Two things this must never allow, both unrecoverable from inside the app:
       an organisation with no administrator, and an admin removing their own
       access by accident while tidying up. */
    if (person.role === 'admin' && role !== 'admin' && db.countAdmins() <= 1) {
      return json(res, 409, {
        error: 'That is the only administrator. Make somebody else an administrator first, '
             + 'or there is no way back into this screen.',
      });
    }
    if (Number(id) === Number(s.id) && role !== 'admin') {
      return json(res, 409, {
        error: 'That would take away your own access to this screen. Ask another administrator '
             + 'to do it.',
      });
    }

    db.setRole(id, role);
    db.log(s.name, 'role changed', person.name + ' is now a ' + role);
    return json(res, 200, { person: { id, name: person.name, role } });
  }));

  route('PUT', /^\/api\/staff\/people\/(\d+)\/perms$/, caseworkOnly(async (req, res, s, m) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    const id = Number(m[1]);
    const person = db.studentById(id);
    if (!person) return json(res, 404, { error: 'No such person' });
    if (person.role === 'admin') {
      return json(res, 409, {
        error: 'An administrator already has every permission. Make them a counsellor or an '
             + 'editor first if you want to narrow what they can change.',
      });
    }
    const b = await readJson(req);
    const perms = db.setPerms(id, b.perms);
    db.log(s.name, 'permissions changed',
      person.name + ' may change: ' + (perms || 'nothing'));
    return json(res, 200, { id, perms: perms ? perms.split(',') : [] });
  }));

  route('POST', /^\/api\/staff\/people\/(\d+)\/password$/, caseworkOnly(async (req, res, s, m) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    const id = Number(m[1]);
    const person = db.studentById(id);
    if (!person) return json(res, 404, { error: 'No such person' });

    const password = crypto.randomBytes(9).toString('base64url');
    const salt = newSalt();
    /* setPassword also drops every session that person has open. That is the
       point of resetting a password, and doing it quietly would not be. */
    db.setPassword(id, hashPassword(password, salt), salt);
    db.log(s.name, 'password reset', person.name);
    return json(res, 200, { password, name: person.name });
  }));

  /* ---------------------------------------------------- the office's side */

  route('GET', '/api/staff/chats', caseworkOnly(async (req, res) => {
    const unseen = db.unseenChats();
    return json(res, 200, {
      chats: db.chats(60).map(c => {
        const msgs = db.chatMessages(c.id);
        const last = msgs[msgs.length - 1];
        return {
          id: c.id, name: c.name, phone: c.phone, email: c.email,
          status: c.status, at: c.created_at, lastAt: c.last_at,
          page: c.page, messages: msgs.length,
          unseen: unseen[c.id] || 0,
          preview: last ? last.body.slice(0, 90) : '',
          lastFrom: last ? last.sender : '',
        };
      }),
    });
  }));

  /*
   * The enquiry book.
   *
   * Every form on the website writes here, and so does every chat. Until now
   * the operations site showed a COUNT of them and nothing else — which means
   * the leads were being collected and nobody could read one. A number on a
   * dashboard is not a lead.
   */
  route('GET', '/api/staff/enquiries', caseworkOnly(async (req, res) => json(res, 200, {
    enquiries: db.allEnquiries().slice(0, 200).map(e => ({
      id: e.id, name: e.name, phone: e.phone, email: e.email,
      destination: e.destination || '', how: e.consent === 'chat' ? 'chat' : 'form',
      page: e.source_page || '', at: e.created_at,
    })),
  })));

  route('GET', /^\/api\/staff\/chat\/(\d+)$/, caseworkOnly(async (req, res, s, m) => {
    const c = db.chatById(Number(m[1]));
    if (!c) return json(res, 404, { error: 'No such chat' });
    db.markChatSeen(c.id);
    return json(res, 200, { chat: chatShape(c) });
  }));

  route('POST', /^\/api\/staff\/chat\/(\d+)\/reply$/, caseworkOnly(async (req, res, s, m) => {
    const c = db.chatById(Number(m[1]));
    if (!c) return json(res, 404, { error: 'No such chat' });
    const b = await readJson(req);
    const body = String(b.body || '').trim().slice(0, 2000);
    if (!body) return json(res, 422, { error: 'Nothing to send' });

    const msg = db.addChatMessage(c.id, 'them', body, s.name);
    /* Straight down the visitor's open stream. This is the half that makes it a
       chat rather than a contact form with extra steps. */
    live.toGuest(c.token, 'chat', { who: 'them', t: body, name: s.name, at: msg.created_at });
    live.toAllStaff('chat', { id: c.id, kind: 'replied', at: msg.created_at });
    db.log(s.name, 'chat replied', c.name + (c.phone ? ' (' + c.phone + ')' : ''));
    return json(res, 200, { chat: chatShape(db.chatById(c.id)) });
  }));

  route('POST', /^\/api\/staff\/chat\/(\d+)\/close$/, caseworkOnly(async (req, res, s, m) => {
    const c = db.chatById(Number(m[1]));
    if (!c) return json(res, 404, { error: 'No such chat' });
    const next = c.status === 'open' ? 'done' : 'open';
    db.setChatStatus(c.id, next);
    return json(res, 200, { status: next });
  }));

  /* ------------------------------------------------------- the catalogue */
  /*
   * Counsellors edit this, not just admins: they are the ones who know that a
   * university has changed its fee or closed an intake, and making them file a
   * request to an admin is how a catalogue goes stale.
   *
   * Every write is logged with who did it. On a list several people edit, "who
   * put this on the site?" is a question that gets asked.
   */
  const FIELD_LIMITS = { program: 140, university: 140, city: 80, url: 400, field: 80 };

  /*
   * The words on the filters are `master`, `autumn`, `u20`. The words a
   * counsellor types into a spreadsheet are "Masters", "MSc", "Fall", "under
   * 20L". The old code compared against the first list and replaced anything
   * else with nothing — so a row that said "Masters" was imported with no
   * level at all, dropped out of the level filter on the home page, and looked
   * fine everywhere the counsellor thought to check. Silent is the problem:
   * translate what can be translated, and report the rest as a warning on the
   * row rather than swallowing it.
   */
  const LEVELS = {
    master: 'master', masters: 'master', ms: 'master', msc: 'master', ma: 'master',
    meng: 'master', mtech: 'master', pg: 'master', postgraduate: 'master', pgt: 'master',
    bachelor: 'bachelor', bachelors: 'bachelor', ba: 'bachelor', bsc: 'bachelor',
    beng: 'bachelor', undergraduate: 'bachelor', undergrad: 'bachelor', ug: 'bachelor',
    mba: 'mba', executivemba: 'mba', emba: 'mba',
    phd: 'phd', doctorate: 'phd', doctoral: 'phd',
    diploma: 'diploma', pgdiploma: 'diploma', pgdip: 'diploma',
    foundation: 'foundation', pathway: 'foundation', premasters: 'foundation',
  };
  const normLevel = v => LEVELS[String(v || '').toLowerCase().replace(/[^a-z]/g, '')] || '';

  const SEASONS = {
    winter: 'winter', jan: 'winter', january: 'winter',
    summer: 'summer', may: 'summer', june: 'summer',
    autumn: 'autumn', fall: 'autumn', sep: 'autumn', september: 'autumn',
    spring: 'spring', feb: 'spring', march: 'spring',
  };
  const normSeason = v => SEASONS[String(v || '').toLowerCase().replace(/[^a-z]/g, '')] || '';

  const BANDS = {
    u10: 'u10', under10: 'u10', under10l: 'u10',
    u20: 'u20', under20: 'u20', under20l: 'u20',
    above20: 'above20', over20: 'above20', above20l: 'above20',
    elite: 'elite', premium: 'elite',
  };
  const normBand = v => BANDS[String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')] || '';

  function cleanProgramme(b, existing) {
    const t = (k, max) => String(b[k] == null ? (existing ? existing[k] : '') : b[k]).trim().slice(0, max);
    const country = String(b.country || '').toUpperCase().slice(0, 2);
    const out = {
      id: String(b.id || '').trim() || ('own-' + crypto.randomBytes(5).toString('hex')),
      program: t('program', FIELD_LIMITS.program),
      university: t('university', FIELD_LIMITS.university),
      city: t('city', FIELD_LIMITS.city),
      country,
      level: normLevel(b.level),
      field: t('field', FIELD_LIMITS.field),
      band: normBand(b.band),
      isPublic: !!b.isPublic,
      fit: Math.max(0, Math.min(100, Number(b.fit) || 0)),
      totalInr: Math.max(0, Math.round(Number(b.totalInr) || 0)),
      url: /^https?:\/\//i.test(b.url || '') ? String(b.url).slice(0, FIELD_LIMITS.url) : '',
      active: b.active !== false,
      /* Featured is the office saying "lead with this one". It is not a
         property of the programme, so it survives an edit that says nothing
         about it rather than being reset to false by omission. */
      featured: b.featured === undefined ? !!(existing && existing.featured) : !!b.featured,
      featureSort: Math.max(0, Math.min(999, Math.round(Number(
        b.featureSort === undefined ? (existing ? existing.feature_sort : 0) : b.featureSort) || 0))),
      intakes: Array.isArray(b.intakes)
        ? b.intakes.filter(i => i && i.deadline).slice(0, 6).map(i => ({
            season: normSeason(i.season) || 'winter',
            deadline: /^\d{4}-\d{2}-\d{2}$/.test(i.deadline) ? i.deadline : '',
          })).filter(i => i.deadline)
        : [],
    };
    /* The band is what the budget filter on the home page uses. Deriving it from
       the fee when it is left blank means a counsellor cannot accidentally put a
       ₹30 lakh course in the "under ₹10L" bucket. */
    if (!out.band) {
      out.band = out.totalInr === 0 ? 'u10'
        : out.totalInr <= 1000000 ? 'u10'
        : out.totalInr <= 2000000 ? 'u20' : 'above20';
    }
    if (!out.fit) out.fit = 75;
    return out;
  }

  route('GET', '/api/staff/catalogue', staffOnly(async (req, res) => json(res, 200, {
    programmes: db.programmes(true).map(r => ({
      id: r.id, program: r.program, university: r.university, city: r.city || '',
      country: r.country, level: r.level || '', field: r.field || '', band: r.band || '',
      isPublic: !!r.is_public, fit: r.fit, totalInr: r.total_inr, url: r.url || '',
      active: !!r.active, updatedAt: r.updated_at, updatedBy: r.updated_by || '',
      featured: !!r.featured, featureSort: r.feature_sort || 0,
      intakes: (() => { try { return JSON.parse(r.intakes); } catch (e) { return []; } })(),
    })),
    countries: db.countries(true).map(c => {
      let facts = {};
      try { facts = JSON.parse(c.facts || '{}') || {}; } catch (e) {}
      return {
        code: c.code, name: c.name, flag: c.flag || '', region: c.region || '',
        active: !!c.active, sort: c.sort, facts,
        programmes: db.programmes(true).filter(p => p.country === c.code).length,
      };
    }),
    audit: db.auditTrail(25).map(a => ({ who: a.who, what: a.what, detail: a.detail, at: a.created_at })),
  })));

  route('PUT', '/api/staff/programme', needs('catalogue', async (req, res, s) => {
    const b = await readJson(req);
    const existing = b.id ? db.programme(b.id) : null;
    const p = cleanProgramme(b, existing);

    if (!p.program) return json(res, 422, { error: 'The programme needs a name' });
    if (!p.university) return json(res, 422, { error: 'The programme needs a university' });
    if (!db.country(p.country)) {
      return json(res, 422, {
        error: 'There is no destination with the code "' + p.country + '". '
             + 'Add it on the Destinations tab first.',
      });
    }
    db.saveProgramme(p, s.name);
    db.log(s.name, existing ? 'programme updated' : 'programme added',
      p.university + ' — ' + p.program);
    return json(res, 200, { programme: p });
  }));

  route('DELETE', /^\/api\/staff\/programme\/(.+)$/, needs('catalogue', async (req, res, s, m) => {
    const id = decodeURIComponent(m[1]);
    const p = db.programme(id);
    if (!p) return json(res, 404, { error: 'No such programme' });
    /* Deactivate rather than delete when a student has it shortlisted: removing
       the row would blank out their shortlist card and their application. */
    const inUse = db.allStudents().some(st => db.getShortlist(st.id).some(r => r.prog_id === id));
    if (inUse) {
      db.saveProgramme(Object.assign({}, {
        id: p.id, program: p.program, university: p.university, city: p.city,
        country: p.country, level: p.level, field: p.field, band: p.band,
        isPublic: !!p.is_public, fit: p.fit, totalInr: p.total_inr, url: p.url,
        intakes: (() => { try { return JSON.parse(p.intakes); } catch (e) { return []; } })(),
        active: false,
      }), s.name);
      db.log(s.name, 'programme hidden', p.university + ' — a student has it shortlisted, so it was hidden rather than deleted');
      return json(res, 200, { hidden: true });
    }
    db.deleteProgramme(id);
    db.log(s.name, 'programme deleted', p.university + ' — ' + p.program);
    return json(res, 200, { deleted: true });
  }));

  route('PUT', '/api/staff/country', needs('catalogue', async (req, res, s) => {
    const b = await readJson(req);
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    const name = String(b.name || '').trim().slice(0, 60);
    if (code.length !== 2) return json(res, 422, { error: 'A destination needs a two-letter code, like AU' });
    if (!name) return json(res, 422, { error: 'A destination needs a name' });
    const existed = db.country(code);
    const draft = { code, name, flag: String(b.flag || '').slice(0, 8),
      region: String(b.region || '').slice(0, 80), active: b.active !== false, sort: b.sort };
    /* Only when the caller sent them. saveCountry keeps whatever is stored
       otherwise, so the Destinations form cannot wipe the requirements and the
       requirements editor cannot wipe the flag. */
    if (b.facts !== undefined) draft.facts = cleanFacts(b.facts);
    db.saveCountry(draft);
    db.log(s.name, existed ? 'destination updated' : 'destination added',
      name + ' (' + code + ')' + (b.facts !== undefined ? ' — entry requirements' : ''));
    let facts = {};
    try { facts = JSON.parse((db.country(code) || {}).facts || '{}') || {}; } catch (e) {}
    return json(res, 200, { country: Object.assign({}, db.country(code), { facts }) });
  }));

  route('DELETE', /^\/api\/staff\/country\/([A-Za-z]{2})$/, needs('catalogue', async (req, res, s, m) => {
    const code = m[1].toUpperCase();
    const n = db.programmes(true).filter(p => p.country === code).length;
    if (n) return json(res, 409, {
      error: n + ' programme' + (n === 1 ? '' : 's') + ' still use that destination. '
           + 'Move or remove them first.',
    });
    db.deleteCountry(code);
    db.log(s.name, 'destination deleted', code);
    return json(res, 200, { deleted: true });
  }));

  /*
   * Many at once.
   *
   * A partner list goes out of date in blocks, not one row at a time, and
   * clicking Edit → Remove → confirm two hundred times is how a catalogue stops
   * being maintained. The rules are the same as the single delete, deliberately:
   * a programme a student has shortlisted or applied to is hidden, never
   * removed, because deleting it blanks out their shortlist card mid-application.
   * The reply says which ones that happened to, by name, so nobody is left
   * wondering why the count came back smaller than the tick boxes.
   */
  route('POST', '/api/staff/programmes/bulk', needs('catalogue', async (req, res, s) => {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 2000) : [];
    const action = String(b.action || '');
    if (!ids.length) return json(res, 422, { error: 'Nothing was selected.' });
    if (!['delete', 'hide', 'show'].includes(action)) {
      return json(res, 422, { error: 'That is not something this can do.' });
    }

    const inUse = action === 'delete' ? db.programmesInUse() : null;
    const out = { deleted: 0, hidden: 0, shown: 0, missing: 0, keptNames: [] };

    ids.forEach(id => {
      const p = db.programme(id);
      if (!p) { out.missing++; return; }

      const asDraft = extra => Object.assign({
        id: p.id, program: p.program, university: p.university, city: p.city,
        country: p.country, level: p.level, field: p.field, band: p.band,
        isPublic: !!p.is_public, fit: p.fit, totalInr: p.total_inr, url: p.url,
        featured: !!p.featured, featureSort: p.feature_sort || 0,
        intakes: (() => { try { return JSON.parse(p.intakes) || []; } catch (e) { return []; } })(),
        active: !!p.active,
      }, extra);

      if (action === 'delete') {
        if (inUse.has(String(id))) {
          db.saveProgramme(asDraft({ active: false }), s.name);
          out.hidden++;
          if (out.keptNames.length < 12) out.keptNames.push(p.university + ' — ' + p.program);
          return;
        }
        db.deleteProgramme(id);
        out.deleted++;
        return;
      }
      db.saveProgramme(asDraft({ active: action === 'show' }), s.name);
      action === 'show' ? out.shown++ : out.hidden++;
    });

    db.log(s.name, 'catalogue — ' + ids.length + ' selected',
      [out.deleted && out.deleted + ' removed', out.hidden && out.hidden + ' hidden',
        out.shown && out.shown + ' put back on the site',
        out.missing && out.missing + ' already gone'].filter(Boolean).join(', '));

    return json(res, 200, out);
  }));

  /*
   * What a destination is allowed to say about itself.
   *
   * These are read by a student deciding whether they qualify and how much
   * money they need to show a visa officer, so they are bounded and typed here
   * rather than trusted from a form. A CGPA of 47 or a funds figure with an
   * extra zero is not a typo anyone catches on the way past.
   */
  const cleanFacts = f => {
    const o = f && typeof f === 'object' ? f : {};
    const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const money = v => Math.max(0, Math.min(99999999,
      Math.round(Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0)));
    const cgpa = v => {
      const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) && n > 0 ? Math.min(10, Math.round(n * 10) / 10) : 0;
    };
    const lines = v => (Array.isArray(v) ? v : String(v || '').split(/\n|\s*\|\s*/))
      .map(x => str(x, 160)).filter(Boolean).slice(0, 20);
    return {
      minCgpaPublic: cgpa(o.minCgpaPublic),
      minCgpaPrivate: cgpa(o.minCgpaPrivate),
      degreeRule: str(o.degreeRule, 400),
      backlogRule: str(o.backlogRule, 400),
      extraNote: str(o.extraNote, 400),
      tests: lines(o.tests),
      fundsLabel: str(o.fundsLabel, 60),
      fundsInr: money(o.fundsInr),
      fundsNote: str(o.fundsNote, 200),
      livingInr: money(o.livingInr),
      workRights: str(o.workRights, 300),
      deadlineNote: str(o.deadlineNote, 300),
      documents: lines(o.documents),
      hasPublicTrack: !!o.hasPublicTrack,
      tuitionFree: !!o.tuitionFree,
    };
  };

  /* ------------------------------------------------ the catalogue as a sheet */
  /*
   * Download it, edit it in Excel, upload it back.
   *
   * The screen's own editor is better for one change. This is for the other
   * case: fifty universities from a partner's list, or a fee revision across a
   * whole country, where clicking through a form fifty times is the wrong tool.
   *
   * An import NEVER writes on the first request. It comes back as a plan —
   * these are new, these change, these are unchanged, these are wrong — and
   * only applies when it is sent back with confirm. A bulk edit that silently
   * empties the catalogue because a column was renamed is not recoverable from
   * a screen that just says "done".
   */
  const SHEET_COLUMNS = [
    ['id', 'id'], ['programme', 'program'], ['university', 'university'], ['city', 'city'],
    ['country code', 'country'], ['level', 'level'], ['field', 'field'],
    ['public university', 'isPublic'], ['total tuition inr', 'totalInr'],
    ['budget band', 'band'], ['course url', 'url'],
    ['intake 1 season', 'i1s'], ['intake 1 deadline', 'i1d'],
    ['intake 2 season', 'i2s'], ['intake 2 deadline', 'i2d'],
    ['on the site', 'active'],
    ['showcase', 'featured'], ['showcase position', 'featureSort'],
  ];

  const sheetRows = () => db.programmes(true).map(r => {
    let ins = [];
    try { ins = JSON.parse(r.intakes) || []; } catch (e) {}
    return [
      r.id, r.program, r.university, r.city || '', r.country, r.level || '', r.field || '',
      r.is_public ? 'yes' : 'no', Number(r.total_inr || 0), r.band || '', r.url || '',
      (ins[0] && ins[0].season) || '', (ins[0] && ins[0].deadline) || '',
      (ins[1] && ins[1].season) || '', (ins[1] && ins[1].deadline) || '',
      r.active ? 'yes' : 'no',
      r.featured ? 'yes' : 'no', r.feature_sort || '',
    ];
  });

  route('GET', /^\/api\/staff\/catalogue\.(xlsx|csv)$/, staffOnly(async (req, res, s, m) => {
    const headers = SHEET_COLUMNS.map(c => c[0]);
    const rows = sheetRows();
    const stamp = new Date().toISOString().slice(0, 10);
    if (m[1] === 'csv') {
      const body = Buffer.from(SHEET.writeCsv(headers, rows), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="glovels-catalogue-${stamp}.csv"`,
        'Content-Length': body.length, 'Cache-Control': 'no-store',
      });
      return res.end(body);
    }
    const body = SHEET.writeXlsx(headers, rows, 'Catalogue');
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="glovels-catalogue-${stamp}.xlsx"`,
      'Content-Length': body.length, 'Cache-Control': 'no-store',
    });
    return res.end(body);
  }));

  const YES = v => /^(y|yes|true|1|public|on|on the site|shown)$/i.test(String(v || '').trim());
  const NO_ = v => /^(n|no|false|0|private|off|hidden)$/i.test(String(v || '').trim());

  route('POST', '/api/staff/catalogue/import', needs('catalogue', async (req, res, s) => {
    const ct = req.headers['content-type'] || '';
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!bm) return json(res, 400, { error: 'Expected a file upload' });
    const parsed = parseMultipart(await readBody(req), (bm[1] || bm[2]).trim());
    if (!parsed.file) return json(res, 400, { error: 'No file in that upload' });

    const name = String(parsed.file.filename || '').toLowerCase();
    let rows;
    try {
      rows = /\.csv$/.test(name)
        ? SHEET.readCsv(parsed.file.data.toString('utf8'))
        : SHEET.readXlsx(parsed.file.data);
    } catch (e) {
      return json(res, 422, { error: 'Could not read that file: ' + e.message });
    }

    const objects = SHEET.toObjects(rows);
    if (!objects.length) return json(res, 422, { error: 'That sheet has no rows under its header.' });

    /* Column names are matched loosely — "Country Code", "country code" and
       "country" all land in the same place — because the person editing the
       sheet did not write the header and should not have to preserve it
       exactly. Anything unrecognised is reported rather than ignored. */
    const alias = {};
    SHEET_COLUMNS.forEach(([label, key]) => { alias[label] = key; });
    Object.assign(alias, {
      country: 'country', programme: 'program', program: 'program',
      fee: 'totalInr', tuition: 'totalInr', 'total tuition': 'totalInr',
      'is public': 'isPublic', type: 'isPublic', active: 'active', status: 'active',
      url: 'url', band: 'band',
    });

    const seen = Object.keys(objects[0] || {});
    const unknown = seen.filter(h => !alias[h]);

    const plan = { create: [], update: [], unchanged: [], rejected: [], warned: 0, unknownColumns: unknown };

    objects.forEach((o, n) => {
      const line = n + 2;                        // +1 header, +1 for 1-based rows
      const g = key => {
        for (const h of Object.keys(o)) if (alias[h] === key) return o[h];
        return '';
      };
      const draft = {
        id: String(g('id') || '').trim(),
        program: g('program'), university: g('university'), city: g('city'),
        country: String(g('country') || '').toUpperCase().trim(),
        level: String(g('level') || '').toLowerCase().trim(),
        field: g('field'),
        isPublic: NO_(g('isPublic')) ? false : YES(g('isPublic')),
        totalInr: Number(String(g('totalInr') || '0').replace(/[^0-9.]/g, '')) || 0,
        band: String(g('band') || '').trim(),
        url: g('url'),
        active: NO_(g('active')) ? false : true,
        featured: YES(g('featured')),
        featureSort: Number(String(g('featureSort') || '0').replace(/[^0-9]/g, '')) || 0,
        intakes: [[g('i1s'), g('i1d')], [g('i2s'), g('i2d')]]
          .filter(([, d]) => String(d || '').trim())
          .map(([sea, d]) => ({ season: String(sea || 'winter').toLowerCase().trim(), deadline: String(d).trim().slice(0, 10) })),
      };

      /* Warnings, not rejections. A word we cannot translate is worth saying
         out loud — "Masters" imported as no level at all is the kind of thing
         that is only discovered months later, by a student who cannot find the
         course — but it is not a reason to refuse the row. */
      const warn = [];
      const rawLevel = String(g('level') || '').trim();
      if (rawLevel && !normLevel(rawLevel)) {
        warn.push(`the level "${rawLevel}" is not one the filters know — it will be left blank`);
      }
      const rawBand = String(g('band') || '').trim();
      if (rawBand && !normBand(rawBand)) {
        warn.push(`the budget band "${rawBand}" is not one of u10 / u20 / above20 / elite — it will be worked out from the fee`);
      }
      [g('i1s'), g('i2s')].forEach(s => {
        const raw = String(s || '').trim();
        if (raw && !normSeason(raw)) warn.push(`the intake season "${raw}" was read as winter`);
      });

      const why = [];
      if (!draft.program) why.push('no programme name');
      if (!draft.university) why.push('no university');
      if (!draft.country) why.push('no country code');
      else if (!db.country(draft.country)) why.push(`the destination "${draft.country}" does not exist yet`);
      draft.intakes.forEach(i => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.deadline)) {
          why.push(`the deadline "${i.deadline}" is not YYYY-MM-DD`);
        }
      });
      if (why.length) {
        plan.rejected.push({ line, what: draft.university + ' — ' + draft.program, why });
        return;
      }

      const existing = draft.id ? db.programme(draft.id) : null;
      const clean = cleanProgramme(draft, existing);
      if (!existing) {
        plan.create.push({ line, id: clean.id, what: clean.university + ' — ' + clean.program, warn });
        if (warn.length) plan.warned++;
        return;
      }
      /* Every column the sheet carries has to be in this comparison. A field
         that is missing from it makes a row that changes only that field come
         back as "already right" — and the apply pass skips those, so the edit
         is reported as done and never written. Showcase and its position were
         the ones that mattered: ordering the university strip from Excel did
         nothing at all. */
      const oldIntakes = (() => {
        try { return JSON.parse(existing.intakes) || []; } catch (e) { return []; }
      })();
      const asIntakes = a => (a || []).map(i => i.season + '@' + i.deadline).join(',');
      const before = {
        program: existing.program, university: existing.university, city: existing.city || '',
        country: existing.country, totalInr: existing.total_inr, isPublic: !!existing.is_public,
        active: !!existing.active, url: existing.url || '',
        level: existing.level || '', field: existing.field || '', band: existing.band || '',
        featured: !!existing.featured, featureSort: existing.feature_sort || 0,
        intakes: asIntakes(oldIntakes),
      };
      const after = {
        program: clean.program, university: clean.university, city: clean.city,
        country: clean.country, totalInr: clean.totalInr, isPublic: clean.isPublic,
        active: clean.active, url: clean.url,
        level: clean.level, field: clean.field, band: clean.band,
        featured: clean.featured, featureSort: clean.featureSort,
        intakes: asIntakes(clean.intakes),
      };
      const changed = Object.keys(after).filter(k => String(before[k]) !== String(after[k]));
      if (!changed.length) plan.unchanged.push({ line, id: clean.id });
      else plan.update.push({ line, id: clean.id, what: clean.university + ' — ' + clean.program, changed, warn });
      if (warn.length) plan.warned++;
    });

    /* Nothing is written unless this is the confirm pass. */
    const body = parsed.fields || {};
    if (!YES(body.confirm)) {
      return json(res, 200, {
        preview: true,
        counts: {
          create: plan.create.length, update: plan.update.length,
          unchanged: plan.unchanged.length, rejected: plan.rejected.length,
          warned: plan.warned,
        },
        plan,
        note: 'Nothing has been changed. Send it again with confirm to apply.',
      });
    }

    if (plan.rejected.length && !YES(body.skipBad)) {
      return json(res, 422, {
        error: plan.rejected.length + ' row(s) cannot be imported. Fix them, or confirm '
             + 'again with "skip the bad rows".',
        plan,
      });
    }

    let created = 0, updated = 0;
    objects.forEach((o, n) => {
      const line = n + 2;
      if (plan.rejected.some(r => r.line === line)) return;
      const c = plan.create.find(x => x.line === line);
      const u = plan.update.find(x => x.line === line);
      if (!c && !u) return;
      const g = key => {
        for (const h of Object.keys(o)) if (alias[h] === key) return o[h];
        return '';
      };
      const id = c ? c.id : u.id;
      const existing = db.programme(id);
      const clean = cleanProgramme({
        id,
        program: g('program'), university: g('university'), city: g('city'),
        country: String(g('country') || '').toUpperCase().trim(),
        level: String(g('level') || '').toLowerCase().trim(), field: g('field'),
        isPublic: NO_(g('isPublic')) ? false : YES(g('isPublic')),
        totalInr: Number(String(g('totalInr') || '0').replace(/[^0-9.]/g, '')) || 0,
        band: String(g('band') || '').trim(), url: g('url'),
        active: NO_(g('active')) ? false : true,
        featured: YES(g('featured')),
        featureSort: Number(String(g('featureSort') || '0').replace(/[^0-9]/g, '')) || 0,
        intakes: [[g('i1s'), g('i1d')], [g('i2s'), g('i2d')]]
          .filter(([, d]) => String(d || '').trim())
          .map(([sea, d]) => ({ season: String(sea || 'winter').toLowerCase().trim(), deadline: String(d).trim().slice(0, 10) })),
      }, existing);
      db.saveProgramme(clean, s.name);
      c ? created++ : updated++;
    });

    db.log(s.name, 'catalogue imported from a sheet',
      created + ' added, ' + updated + ' updated, ' + plan.rejected.length + ' skipped');

    return json(res, 200, {
      applied: true, created, updated,
      skipped: plan.rejected.length, unchanged: plan.unchanged.length,
    });
  }));

  /* --------------------------------------------------- the home page content */
  /*
   * The packages, the headline numbers, the FAQ and the testimonials.
   *
   * The public endpoint is deliberately dull: no session, no gating, cacheable
   * for a minute, and it returns exactly what the page paints. The staff
   * endpoints beside it are the same two-pass shape as the catalogue import —
   * a plan first, and only what has been seen gets written.
   */

  const CONTENT_KEYS = ['packages', 'stats', 'faq', 'testimonials', 'services'];
  const noContent = res => json(res, 503, {
    error: 'The home page content is not loaded on this server. Run: python3 build_content.py',
  });

  route('GET', '/api/content', async (req, res) => {
    if (!content) return noContent(res);
    /* no-cache, not max-age. The browser may keep a copy, but it must ask
       before using it — a price edited in the office and then served from a
       cache for the next minute is a student shown one number and charged
       another. Revalidating a small JSON body on the same origin costs nothing
       worth having. */
    return json(res, 200, content.home(), { 'Cache-Control': 'no-cache' });
  }, { open: true });

  route('GET', '/api/staff/content', staffOnly(async (req, res) => {
    if (!content) return noContent(res);
    const out = content.home();
    /* Staff get the catalogue of editable lines, not the overrides map: they
       need to see every line on the page, including the ones nobody has
       touched, because that list IS the editor. */
    out.text = content.text();
    /* The writing bank is not part of `home()` — the public page never receives
       it — so it is added here explicitly for the screen that edits it. */
    out.writing = content.get('writing');
    out.updated = {};
    CONTENT_KEYS.concat(['writing', 'textOverrides']).forEach(k => { out.updated[k] = db.contentMeta(k) || null; });
    out.audit = db.auditTrail(40);
    return json(res, 200, out);
  }));

  /*
   * The writing bank saves on its own route.
   *
   * The shared route's guard counts `.length` to refuse an accidental empty
   * block, and this block is an object of six lists — the count would be
   * undefined and every save refused. Its own emptiness rule is also different
   * and worth stating: a kind with no openings and no closings can produce
   * nothing at all, so that is what gets refused, not "fewer sentences".
   */
  route('PUT', '/api/staff/content/writing', needs('content', async (req, res, s) => {
    if (!content) return noContent(res);
    const b = await readJson(req);
    const value = b && b.value !== undefined ? b.value : b;
    const empty = k => !((value && value[k] && value[k].openings) || []).length
                    || !((value && value[k] && value[k].closings) || []).length;
    if (empty('sop') || empty('lor')) {
      return json(res, 422, {
        error: 'Both the SOP and the LOR need at least one opening and one closing — '
             + 'without them the studio has nothing to write.',
      });
    }
    const saved = content.save('writing', value, s.name);
    db.log(s.name, 'home page \u2014 writing bank edited',
      saved.sop.openings.length + ' SOP openings, ' + saved.lor.openings.length + ' LOR openings');
    return json(res, 200, { saved });
  }));

  /* A draft written from the bank ON THE SCREEN, saved or not. Rewriting an
     opening and having to save it — over the live one — before you can see how
     it reads is how a bad sentence reaches the site. */
  route('POST', '/api/staff/content/writing/preview', needs('content', async (req, res) => {
    if (!content) return noContent(res);
    const b = await readJson(req);
    const value = b && b.value !== undefined ? b.value : b;
    const kind = b.kind === 'lor' ? 'lor' : 'sop';
    /* Cleaned through the same rules a save would apply, so the preview shows
       what would actually happen rather than what was typed. */
    const cleaned = CLEAN_WRITING(value);
    const sample = kind === 'sop'
      ? { kind, programme: 'M.Sc. Data Science', university: 'RWTH Aachen University',
          signals: (cleaned.sop.signals[0] ? [cleaned.sop.signals[0].key] : [])
            .concat(cleaned.sop.signals[1] ? [cleaned.sop.signals[1].key] : []),
          motives: cleaned.sop.motives[0] ? [cleaned.sop.motives[0].key] : [] }
      : { kind, programme: 'MSc Computer Science', university: 'TU Munich',
          signals: (cleaned.lor.signals[0] ? [cleaned.lor.signals[0].key] : []),
          who: 'their project supervisor', span: 'two years',
          instance: 'rebuilt the lab data pipeline in a week' };
    const out = WRITING.draft(cleaned, sample, 0);
    if (!out.paragraphs.length) {
      return json(res, 422, { error: 'There is nothing here to write with yet.' });
    }
    return json(res, 200, { draft: out });
  }));

  route('PUT', /^\/api\/staff\/content\/(packages|stats|faq|testimonials|services)$/,
    needs('content', async (req, res, s, m) => {
      if (!content) return noContent(res);
      const key = m[1];
      const b = await readJson(req);
      const value = b && b.value !== undefined ? b.value : b;

      /* A block arriving empty is almost always a bug in the screen, not an
         intention — and the cost of being wrong is a blank home page section
         that nobody notices for a week. Emptying one on purpose has to say so. */
      /* Packages and services arrive as {tabs, items}; the other three are bare
         arrays. Counting `.length` on the object form gives undefined, which
         reads as "empty" and refuses every save — the guard against emptying a
         section becomes a guard against editing it. */
      const grouped = key === 'packages' || key === 'services';
      const n = grouped ? ((value && value.items) || []).length : (value || []).length;
      if (!n && !YES(b && b.allowEmpty)) {
        return json(res, 422, {
          error: 'That would leave the ' + key + ' section of the home page with nothing in it. '
               + 'If that is what you want, remove the section instead.',
        });
      }

      const saved = content.save(key, value, s.name);
      const count = grouped ? saved.items.length : saved.length;
      db.log(s.name, 'home page — ' + key + ' edited', count + ' now on the page');
      return json(res, 200, { saved, count });
    }));

  route('GET', /^\/api\/staff\/content\/(packages|stats|faq|testimonials|services|text)\.(xlsx|csv)$/,
    staffOnly(async (req, res, s, m) => {
      if (!content) return noContent(res);
      const key = m[1];
      const { headers, rows } = content.sheet(key);
      const stamp = new Date().toISOString().slice(0, 10);
      const file = `glovels-${key}-${stamp}.${m[2]}`;
      if (m[2] === 'csv') {
        const body = Buffer.from(SHEET.writeCsv(headers, rows), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file}"`,
          'Content-Length': body.length, 'Cache-Control': 'no-store',
        });
        return res.end(body);
      }
      const body = SHEET.writeXlsx(headers, rows, key);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Content-Length': body.length, 'Cache-Control': 'no-store',
      });
      return res.end(body);
    }));

  route('POST', /^\/api\/staff\/content\/(packages|stats|faq|testimonials|services)\/import$/,
    needs('content', async (req, res, s, m) => {
      if (!content) return noContent(res);
      const key = m[1];
      const ct = req.headers['content-type'] || '';
      const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
      if (!bm) return json(res, 400, { error: 'Expected a file upload' });
      const parsed = parseMultipart(await readBody(req), (bm[1] || bm[2]).trim());
      if (!parsed.file) return json(res, 400, { error: 'No file in that upload' });

      const name = String(parsed.file.filename || '').toLowerCase();
      let rows;
      try {
        rows = /\.csv$/.test(name)
          ? SHEET.readCsv(parsed.file.data.toString('utf8'))
          : SHEET.readXlsx(parsed.file.data);
      } catch (e) {
        return json(res, 422, { error: 'Could not read that file: ' + e.message });
      }

      const objects = SHEET.toObjects(rows);
      if (!objects.length) return json(res, 422, { error: 'That sheet has no rows under its header.' });

      let plan;
      try { plan = content.plan(key, objects); }
      catch (e) { return json(res, 422, { error: e.message }); }

      const fields = parsed.fields || {};
      if (!YES(fields.confirm)) {
        return json(res, 200, {
          preview: true,
          counts: {
            total: plan.total, create: plan.create.length,
            kept: plan.kept, removed: plan.removed.length, rejected: plan.rejected.length,
          },
          plan,
          /* Said plainly because it is the one way this differs from the
             catalogue: the sheet is the whole section, not a set of edits to
             it, so anything missing from the sheet comes off the page. */
          note: 'This sheet replaces the whole section. Anything not in it comes off the '
              + 'home page. Nothing has been changed yet.',
        });
      }

      if (!plan.total) {
        return json(res, 422, {
          error: 'Not one row in that sheet could be used, so applying it would empty the '
               + 'section. Nothing has been changed.',
          plan,
        });
      }

      content.apply(key, plan, s.name);
      db.log(s.name, 'home page — ' + key + ' replaced from a sheet',
        plan.total + ' on the page, ' + plan.create.length + ' new, '
        + plan.removed.length + ' removed');
      return json(res, 200, {
        applied: true, total: plan.total, created: plan.create.length,
        removed: plan.removed.length, rejected: plan.rejected.length,
      });
    }));

  /*
   * One line of the page, changed — or put back.
   *
   * Everything that is not a package, a number, an FAQ entry or a testimonial
   * is a line of text with a key, and this is how it moves. An empty value is
   * not an empty line: it means "stop overriding this, go back to what the
   * page says", which is the undo, and there has to be one.
   */
  route('PUT', '/api/staff/content/text', needs('content', async (req, res, s) => {
    if (!content) return noContent(res);
    const b = await readJson(req);

    if (b && b.map && typeof b.map === 'object') {
      const r = content.setTexts(b.map, s.name);
      db.log(s.name, 'home page — wording edited',
        r.changed + ' changed, ' + r.cleared + ' put back');
      return json(res, 200, r);
    }

    let r;
    try { r = content.setText(b.key, b.value, s.name); }
    catch (e) { return json(res, 422, { error: e.message }); }
    db.log(s.name, r.cleared ? 'home page — wording put back' : 'home page — wording edited',
      String(r.current || '').slice(0, 90));
    return json(res, 200, r);
  }));

  route('POST', '/api/staff/content/text/import', needs('content', async (req, res, s) => {
    if (!content) return noContent(res);
    const ct = req.headers['content-type'] || '';
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!bm) return json(res, 400, { error: 'Expected a file upload' });
    const parsed = parseMultipart(await readBody(req), (bm[1] || bm[2]).trim());
    if (!parsed.file) return json(res, 400, { error: 'No file in that upload' });

    const name = String(parsed.file.filename || '').toLowerCase();
    let rows;
    try {
      rows = /\.csv$/.test(name)
        ? SHEET.readCsv(parsed.file.data.toString('utf8'))
        : SHEET.readXlsx(parsed.file.data);
    } catch (e) {
      return json(res, 422, { error: 'Could not read that file: ' + e.message });
    }
    const objects = SHEET.toObjects(rows);
    if (!objects.length) return json(res, 422, { error: 'That sheet has no rows under its header.' });

    const plan = content.planText(objects);
    const fields = parsed.fields || {};
    if (!YES(fields.confirm)) {
      return json(res, 200, {
        preview: true,
        counts: { change: plan.change.length, revert: plan.revert.length,
          rejected: plan.rejected.length, total: plan.total },
        plan,
        note: 'Only rows with something in the "new wording" column do anything. '
            + 'Nothing has been changed yet.',
      });
    }
    if (!plan.total) {
      return json(res, 422, { error: 'Nothing in that sheet changes anything.', plan });
    }
    const r = content.setTexts(plan.map, s.name);
    db.log(s.name, 'home page — wording replaced from a sheet',
      r.changed + ' changed, ' + r.cleared + ' put back');
    return json(res, 200, { applied: true, changed: plan.change.length,
      reverted: plan.revert.length, rejected: plan.rejected.length });
  }));

  /* -------------------------------------------------------- whatsapp hook */
  /* Meta verifies a webhook by asking for it with a challenge, then POSTs
     messages to the same URL. Both only work once the site is on a public
     HTTPS address — a laptop cannot receive either. */
  route('GET', '/api/whatsapp/webhook', async (req, res) => {
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const v = notify.verifyWebhook(q);
    if (!v.ok) return json(res, 403, { error: 'Verification failed' });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(String(v.challenge || ''));
    return true;
  }, { open: true });

  route('POST', '/api/whatsapp/webhook', async (req, res) => {
    const b = await readJson(req);
    notify.parseWebhook(b).forEach(m => {
      /* A counsellor replying from their phone: match the sender's number to a
         staff account, and put the reply on the student they last spoke to. */
      const staff = db.staffByRole('counsellor').concat(db.staffByRole('admin'))
        .find(c => String(c.phone || '').replace(/\D+/g, '').endsWith(String(m.from).slice(-10)));
      if (!staff) return;
      const mine = db.staffStudents(staff);
      const newest = mine
        .map(st => ({ st, last: db.lastMessage(st.id) }))
        .filter(x => x.last)
        .sort((a, b) => (a.last.created_at < b.last.created_at ? 1 : -1))[0];
      if (!newest) return;
      db.addMessage(newest.st.id, 'them', m.text, '');
      const msgs = db.getMessages(newest.st.id);
      const last = msgs[msgs.length - 1];
      live.toStudent(newest.st.id, 'message',
        { studentId: newest.st.id, msg: { who: 'them', t: last.body, file: '', at: last.created_at } });
    });
    return json(res, 200, { ok: true });
  }, { open: true });

  /* ------------------------------------------------------------ dispatch */

  return async function handle(req, res, pathname) {
    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      let m = null;
      if (typeof r.pattern === 'string') {
        if (r.pattern !== pathname) continue;
      } else {
        m = r.pattern.exec(pathname);
        if (!m) continue;
      }
      let s = null;
      if (r.soft) s = me(req);
      if (r.auth) {
        s = me(req);
        /* `return json(...)` here would return undefined, and the caller reads
           that as "no route matched" and sends a 404 on top of the 401 — which
           throws ERR_HTTP_HEADERS_SENT and takes the server down. Every exit
           from this function must say whether it answered. */
        if (!s) { json(res, 401, { error: 'Please sign in' }); return true; }
      }
      try {
        await r.handler(req, res, s, m);
      } catch (e) {
        console.error('  api error', pathname, e && e.message);
        if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server' });
      }
      return true;
    }
    return false;
  };
}

module.exports = { makeApi, FALLBACK_PACKAGES, hashPassword, newSalt };
