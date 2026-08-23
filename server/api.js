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
const PAY = require('./pay.js');
const fs = require('fs');
const path = require('path');
const url = require('url');
const EMAILS = require('./emails.js');
const SHEET = require('./sheet.js');
const WRITING = require('./writing.js');
const PROSE = require('./prose.js');
const ALERTS = require('./alerts.js');
const PLANS = require('./plans.js');
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
  'pkg-roadmap':  { id: 'pkg-roadmap',  name: 'Roadmap',       paise:  999900, publicUnis: 5  },
  'pkg-offer':    { id: 'pkg-offer',    name: 'Offer Letter',  paise: 4999900, publicUnis: 10 },
  'pkg-boarding': { id: 'pkg-boarding', name: 'Boarding Pass', paise: 7499900, publicUnis: 15 },
};

const GST_RATE = 0.18;

/*
 * The order states that have bought something.
 *
 * `paid` is obvious. `owing` counts because it is the state on a site with no
 * gateway, where a counsellor collects and the office has decided the student
 * may proceed. `part` counts because the student HAS paid — the first
 * instalment is money in the account and the work has started; withholding
 * what they bought until the last part lands would make paying in parts
 * pointless. `awaiting` does not: a gateway is mid-collection and has confirmed
 * nothing.
 */
const EARNED = new Set(['paid', 'owing', 'part']);

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

/* The bytes exactly as they arrived. A webhook signature is computed over those
   bytes, and JSON.parse followed by JSON.stringify is not the identity — key
   order and whitespace both move — so a re-serialised body never verifies. */
const readRaw = req => readBody(req);

const inrOf = paise => '\u20b9' + Math.round(Number(paise || 0) / 100).toLocaleString('en-IN');

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

/*
 * A password somebody will have to read out over a bad phone line.
 *
 * base64url gives 0/O and l/1/I in the same string, which is fine for a machine
 * and miserable for a counsellor dictating it to a student in a noisy office.
 * These are the letters and digits that survive being spoken, grouped so the
 * eye can hold them: `nutmeg-4718-cobalt`.
 *
 * Three groups of that shape is about 40 bits — weak as a permanent password
 * and entirely adequate for one that must be replaced at first sign-in, which
 * is enforced rather than suggested.
 */
const PW_WORDS = ['amber', 'basalt', 'cobalt', 'cedar', 'delta', 'ember', 'flint', 'garnet',
  'harbour', 'indigo', 'jasper', 'kestrel', 'lantern', 'meadow', 'nutmeg', 'onyx',
  'pepper', 'quartz', 'rowan', 'saffron', 'topaz', 'umber', 'violet', 'willow'];
const pick = arr => arr[crypto.randomInt(arr.length)];
const newPassword = () =>
  pick(PW_WORDS) + '-' + String(crypto.randomInt(1000, 9999)) + '-' + pick(PW_WORDS);
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
  /* Razorpay, or a stand-in that reports itself off. Off is a working state:
     the order is recorded and a counsellor collects, which is how this site
     ran before there was a gateway at all. */
  const pay = PAY.makePay((config && config.razorpay) || {});
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

  /*
   * A file shared in the conversation.
   *
   * "He should be able to share documents in the chatbox and these should be
   * available for the counsellor in the documents folder of the student."
   *
   * So an attachment is not a copy of a file that lives in a chat thread — it
   * IS a document on the student's file, and the message is a pointer to it.
   * One upload, one place it lives, and it is on the Documents screen the
   * moment it is sent. A thread with the only copy of somebody's passport in
   * it is a thread nobody can find the passport in six weeks later.
   *
   * The message column holds the document's key. Everything a screen needs to
   * draw the attachment — its name, its size, whether it has been verified —
   * is resolved from the document itself, so renaming or replacing the
   * document does not leave the thread quoting a name that no longer exists.
   */
  const attachmentOf = (studentId, key) => {
    if (!key) return null;
    const d = db.docByKey(studentId, key);
    if (!d) return { key, name: key, missing: true };
    return {
      key: d.doc_key,
      name: d.filename,
      bytes: d.bytes,
      size: d.bytes > 1048576 ? (d.bytes / 1048576).toFixed(1) + ' MB'
                              : Math.max(1, Math.round(d.bytes / 1024)) + ' KB',
      status: d.status,
    };
  };

  const msgShape = studentId => m => ({
    who: m.sender, t: m.body, file: m.file, at: m.created_at,
    attachment: attachmentOf(studentId, m.file),
  });

  /*
   * Where an attachment is written, and what it is called on the file.
   *
   * The key is stamped with the time so two people sending `scan.pdf` on the
   * same file do not overwrite each other — which is what would happen if the
   * key were the filename, and it would happen silently.
   */
  function storeAttachment(studentId, file, who) {
    const dir = path.join(uploadDir, String(studentId));
    fs.mkdirSync(dir, { recursive: true });
    const ext = (path.extname(file.filename) || '').slice(0, 10).replace(/[^.a-z0-9]/gi, '');
    const key = 'shared-' + Date.now() + '-' + crypto.randomInt(100, 999);
    const stored = key + ext;
    fs.writeFileSync(path.join(dir, stored), file.data);
    db.addDocument(studentId, key, file.filename, stored, file.data.length);
    /* A file the counsellor sent is not waiting for the counsellor to check
       it. A file the student sent is. */
    if (who === 'them') db.setDocStatus(studentId, key, 'ok');
    return key;
  }

  /** The multipart body, or null with the reason already sent. */
  async function oneFile(req, res) {
    const ct = req.headers['content-type'] || '';
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!bm) { json(res, 400, { error: 'Expected a file upload' }); return null; }
    const parsed = parseMultipart(await readBody(req), (bm[1] || bm[2]).trim());
    if (!parsed.file || !parsed.file.data || !parsed.file.data.length) {
      json(res, 400, { error: 'No file arrived. Try again, or send it as an email.' });
      return null;
    }
    /* Ten megabytes. A passport scan is under one; a phone photo of a degree
       certificate is three. Anything above this is a video somebody attached
       by accident. */
    if (parsed.file.data.length > 10 * 1024 * 1024) {
      json(res, 413, {
        error: 'That file is over 10 MB. Photograph the page rather than scanning it at '
             + 'full size, or send it as a PDF.',
      });
      return null;
    }
    return parsed;
  }

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
      /* What is still missing from their own file, named. "Your profile is 62%
         complete" is a number; "we still need your Class 12 marksheet and your
         date of birth" is something somebody can act on in a minute. */
      todo: ALERTS.forStudent(db, s),
      saved: db.getSaved(s.id),
      drafts: draftsFor(s.id),
      msgs: db.getMessages(s.id).map(msgShape(s.id)),
      order: orders[0] ? {
        reference: orders[0].reference, package: orders[0].package,
        publicUnis: orders[0].public_unis, grossPaise: orders[0].gross_paise,
        paidAt: orders[0].created_at,
      } : null,
      orders: orders.map(o => ({
        reference: o.reference, package: o.package, grossPaise: o.gross_paise,
        publicUnis: o.public_unis, status: o.status, paidAt: o.created_at,
        kind: o.kind || 'package',
        /* What was in it. An order placed before this column existed has none,
           and shows as it always did — the package name and the total. */
        items: (() => { try { return JSON.parse(o.items || '[]') || []; } catch (e) { return []; } })(),
        /* The schedule, for an order being paid in parts: what has been paid,
           what is next, and when. A student who agreed to pay in three parts
           and cannot see the other two on their own screen has been given a
           debt rather than a plan. */
        plan: (() => { try { return o.plan ? JSON.parse(o.plan) : null; } catch (e) { return null; } })(),
        paidPaise: o.paid_paise || 0,
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

  /*
   * Slowing down the things a robot does, on the endpoints anybody can reach.
   *
   * The honeypot catches the lazy ones — a script that fills every field it
   * finds, including the one no human can see. It does nothing about a script
   * written for THIS form, and once a site is indexed those arrive.
   *
   * So: a plain per-address budget on the public write endpoints. It is
   * generous enough that a family sharing an office connection never meets it,
   * and mean enough that a loop posting a thousand enquiries stops after a
   * handful. In memory, and honest about it — it resets on restart, and a real
   * front door would put a CDN in front as well.
   */
  const posts = new Map();
  function floodedBy(ip, what, limit, windowMs) {
    const now = Date.now();
    const key = what + ':' + ip;
    const rec = posts.get(key);
    if (!rec || now - rec.first > windowMs) {
      posts.set(key, { n: 1, first: now });
      if (posts.size > 5000) {
        for (const [k, v] of posts) if (now - v.first > windowMs) posts.delete(k);
      }
      return false;
    }
    rec.n++;
    return rec.n > limit;
  }

  /* One shape of answer for every flood, so a script learns nothing from the
     difference between "too many" and "we ignored you". */
  const slowDown = res => json(res, 429, {
    ok: false,
    error: 'That is a lot of messages in a short time. Wait a few minutes, '
         + 'or call us on +91 70933 14089 — a person answers faster than this form.',
  });
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

  /* The three things an account with a temporary password may still do. */
  const CHANGE_ALLOWED = new Set([
    '/api/auth/change', '/api/auth/logout', '/api/auth/me',
  ]);

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

  /*
   * Applying, from the finder on the home page.
   *
   * "Apply Now" did two untrue things. On a private university — the ones the
   * site says are free to view and free to apply to — it opened the packages
   * section, which is the paywall, for something nothing is charged for. And
   * on a public one, for somebody who had actually paid, it opened a box that
   * said "Demo. Nothing has been filed." Both buttons went nowhere.
   *
   * One endpoint answers both now, and what it does depends on who is asking:
   *
   *   signed in      the university goes on their real shortlist and their
   *                  counsellor is told. That is what applying means here.
   *   not signed in  their details are taken and it becomes an enquiry with
   *                  the programme written on it, which a counsellor picks up
   *                  from the same book every other lead arrives in.
   *
   * A public university still needs a package — the quota is counted here, in
   * universities, the same way the package card counts it. A private one never
   * does, whoever is asking.
   */
  route('POST', '/api/apply', async (req, res, s) => {
    const b = await readJson(req);
    const p = lookup(String(b.id || ''));
    if (!p) return json(res, 404, { error: 'No such programme' });

    if (s && s.role === 'student') {
      if (p.isPublic) {
        const earned = db.ordersFor(s.id)
          .filter(o => EARNED.has(o.status));
        const quota = earned.reduce((n, o) => Math.max(n, Number(o.public_unis || 0)), 0);
        const list = db.getShortlist(s.id);
        const already = list.some(x => String(x.prog_id) === String(p.id));
        /* Counted in universities, not rows: a second course at a university
           already on the list costs nothing, exactly as the package says. */
        const unis = new Set(list.filter(x => x.is_public).map(x => x.university));
        if (!already && !unis.has(p.university) && unis.size >= quota) {
          return json(res, 402, {
            error: quota
              ? 'Your package covers ' + quota + ' public universit'
                + (quota === 1 ? 'y' : 'ies') + ', and they are all on your list. '
                + 'Your counsellor can swap one, or a larger package adds more.'
              : 'Public universities are covered by a package. Private ones are free '
                + 'to apply to and always will be.',
            needsPackage: true,
          });
        }
      }
      const had = db.getShortlist(s.id).some(x => String(x.prog_id) === String(p.id));
      db.addShortlist(s.id, p);
      if (!had) {
        db.addMessage(s.id, 'me', 'I would like to apply to '
          + (p.university || '') + (p.program ? ' — ' + p.program : '') + '.');
        db.log(s.name, 'applied', (p.university || p.id));
      }
      return json(res, 200, {
        applied: true, signedIn: true, already: had,
        university: p.university, program: p.program,
        shortlist: stateFor(s).shortlist,
      });
    }

    /* Nobody signed in. Without contact details there is nothing to act on, so
       say so rather than storing an application against no one — the page asks
       for them and calls back. */
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !email || !phone) {
      return json(res, 200, {
        needDetails: true, isPublic: !!p.isPublic,
        university: p.isPublic ? '' : p.university,
        program: p.isPublic ? '' : p.program,
      });
    }
    if (floodedBy(clientIp(req), 'apply', 8, 60 * 60 * 1000)) return slowDown(res);
    if (!validEmail(email)) return json(res, 422, { error: 'That email address is not valid' });
    if (!validPhone(phone)) return json(res, 422, { error: 'That does not look like an Indian mobile number' });

    const where = (p.university || '') + (p.program ? ' — ' + p.program : '');
    const from = sourceOf(req, b);
    const record = {
      name, email, phone: '+91' + tenDigits(phone),
      destination: p.country || '',
      consent: b.consent || '',
      note: 'Wants to apply: ' + where,
      source: from.source, campaign: from.campaign,
      sourcePage: b.sourcePage || '/', referrer: b.referrer || '',
    };
    db.addEnquiry(record);
    mail.send(Object.assign({ to: mail.office, replyTo: email },
      EMAILS.enquiryToOffice(record))).catch(() => {});
    mail.send(Object.assign({ to: email },
      EMAILS.enquiryToStudent({ name, destination: record.destination }))).catch(() => {});

    return json(res, 200, {
      applied: true, signedIn: false,
      university: p.university, program: p.program,
    });
  }, { open: true, soft: true });

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

  /*
   * A file, sent in the conversation.
   *
   * It lands on the student's own file at the same moment — same upload, same
   * folder, visible on the Documents screen and in the counsellor's list. The
   * message is the announcement; the document is the thing.
   */
  route('POST', '/api/messages/attach', async (req, res, s) => {
    const parsed = await oneFile(req, res);
    if (!parsed) return true;
    const key = storeAttachment(s.id, parsed.file, 'me');
    const note = String(parsed.fields.body || '').slice(0, 400);
    db.addMessage(s.id, 'me', note || 'Sent ' + parsed.file.filename, key);

    const msgs = stateFor(s).msgs;
    const last = msgs[msgs.length - 1];
    live.toThread(s.id, s.counsellor_id, 'message', {
      studentId: s.id, studentName: s.name, msg: last,
    });
    return json(res, 200, { msgs, docs: stateFor(s).docs });
  });

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

  /*
   * An order.
   *
   * Two shapes arrive here, and until now only one of them existed. A package
   * has always come through as an id the server prices. The a-la-carte services
   * — the grid a visitor ticks their way down — went to the enquiry endpoint as
   * a line of text with a reference the BROWSER made up, so nothing was ever
   * recorded against the student: they paid for four services and signed in to
   * an empty dashboard.
   *
   * Both now make an order. The rule is the same for both and it is the only
   * rule that matters here: the browser sends ids, the server decides what they
   * cost. An `amount` in the request is ignored, and there is a test named for
   * that.
   */
  const SERVICES_OF = () => (content ? content.serviceList() : {});

  /*
   * What the student accepted, recorded so it can be shown back to them.
   *
   * "They ticked a box" is evidence of nothing a year later, when the terms
   * have been reworded twice and nobody can say which version was on the
   * screen. So the record carries the words that were actually shown, the
   * package's own terms in full as they read that day, and a fingerprint of
   * each legal page — which is what makes "this is what you accepted" a
   * statement rather than an assertion.
   *
   * Built HERE, from our own copies. Nothing the browser sends about what it
   * displayed is trusted: a page that reported its own consent wording could
   * report anything.
   */
  const fingerprint = text => crypto.createHash('sha256')
    .update(String(text == null ? '' : text), 'utf8').digest('hex').slice(0, 16);

  const pageFingerprint = name => {
    try {
      const f = path.join(__dirname, '..', name + '.html');
      const html = fs.readFileSync(f, 'utf8');
      /* The readable part only. The head carries a build time and the footer a
         year, and hashing those would make every page look edited every time
         anything at all was rebuilt. */
      const m = /<main[\s\S]*?<\/main>/i.exec(html) || /<body[\s\S]*<\/body>/i.exec(html);
      return fingerprint((m ? m[0] : html).replace(/\s+/g, ' '));
    } catch (e) { return ''; }
  };

  /*
   * The sentence somebody actually ticks.
   *
   * Every order carries the base line, whatever was bought — a package with no
   * pledge of its own is still sold under the Terms and the Refund policy, and
   * an order with no acceptance recorded against it is exactly the one that
   * gets argued about. A package that makes its own promise adds its sentence
   * to it rather than replacing it.
   */
  const baseAcceptance = () => {
    try {
      const block_ = content && content.get('packages');
      if (block_ && block_.acceptance) return block_.acceptance;
    } catch (e) { /* content not loaded */ }
    return 'I have read and accept the Terms of Service, the Refund & Cancellation '
         + 'policy and the Privacy policy.';
  };

  const acceptanceLine = pkg => {
    const own = pkg ? String(pkg.consent || '').trim() : '';
    return own ? baseAcceptance() + ' ' + own : baseAcceptance();
  };

  function acceptanceRecord({ req, line, pkg, name, email }) {
    let legal = {};
    try { legal = (content && content.get('legal')) || {}; } catch (e) { /* stubs */ }
    let packageTerms = '';
    if (pkg && pkg.id) {
      try {
        const block_ = content && content.get('packages');
        const row = ((block_ && block_.items) || []).find(x => x.id === pkg.id);
        packageTerms = (row && row.terms) || '';
      } catch (e) { /* none authored */ }
    }
    return {
      at: new Date().toISOString(),
      ip: clientIp(req),
      /* Their own browser, because "somebody with my email did it" is the first
         thing a disputed charge says. */
      agent: String(req.headers['user-agent'] || '').slice(0, 200),
      name, email,
      line,
      packageTerms,
      entity: legal.entity || '',
      effective: legal.effective || '',
      docs: [
        { name: 'Terms of Service', url: '/terms', sha256: pageFingerprint('terms') },
        { name: 'Refund & Cancellation policy', url: '/refunds', sha256: pageFingerprint('refunds') },
        { name: 'Privacy policy', url: '/privacy', sha256: pageFingerprint('privacy') },
      ].filter(d => d.sha256),
      packageTermsSha256: packageTerms ? fingerprint(packageTerms) : '',
    };
  }

  /*
   * Money arriving against an order that is being paid in parts.
   *
   * One place, because there are three ways it can arrive — the browser coming
   * back from the card sheet, the gateway's webhook, and a counsellor writing
   * down a bank transfer — and three copies of "mark it paid and work out
   * whether that was the last one" is how a student ends up owing nothing and
   * still being chased.
   */
  const planOf = order => {
    try { return order.plan ? JSON.parse(order.plan) : null; } catch (e) { return null; }
  };

  function recordPayment(order, paymentId, which) {
    const plan = planOf(order);
    if (!plan) {
      /* Paid in one go: the order is simply paid. */
      db.setOrderPaid(order.reference, paymentId || '');
      return { status: 'paid', plan: null, outstanding: 0 };
    }
    const part = which
      ? plan.find(p => Number(p.n) === Number(which) && p.status !== 'paid')
      : PLANS.nextDue(plan);
    if (part) {
      part.status = 'paid';
      part.paidAt = new Date().toISOString();
      if (paymentId) part.paymentId = String(paymentId).slice(0, 60);
    }
    const got = PLANS.collected(plan);
    const left = PLANS.outstanding(plan);
    db.setOrderPlan(order.reference, plan, got);
    /* `part` is a status of its own. It is not `paid` — money is still owed —
       and it is not `owing`, which would read as nothing having arrived. The
       entitlement treats it like a paid order, because the work has started. */
    if (left <= 0) db.setOrderPaid(order.reference, paymentId || '');
    else db.setOrderStatus(order.reference, 'part');
    return { status: left <= 0 ? 'paid' : 'part', plan, outstanding: left, collected: got };
  }

  route('POST', '/api/orders', async (req, res) => {
    const b = await readJson(req);

    const pkg = b.packageId ? PACKAGES()[b.packageId] : null;
    if (b.packageId && !pkg) return json(res, 400, { error: 'No such package' });

    /* Services: [{id, level}] or plain ids. Anything not on the list today is
       dropped rather than guessed at — a service that has been retired must not
       be sellable through a stale page. */
    const catalogue = SERVICES_OF();
    const asked = Array.isArray(b.services) ? b.services.slice(0, 30) : [];
    const items = [];
    asked.forEach(raw => {
      const id = String((raw && raw.id) || raw || '').trim();
      const svc = catalogue[id];
      if (!svc || items.some(x => x.id === id)) return;
      const wanted = String((raw && raw.level) || '').trim();
      const codes = Object.keys(svc.levels);
      /* A level is only honoured if this service HAS that level. "B2 at the A1
         price" is exactly what a hand-rolled request would try. */
      const level = codes.length ? (svc.levels[wanted] != null ? wanted : codes[0]) : '';
      items.push({
        id, name: svc.name, level,
        paise: level ? svc.levels[level] * 100 : svc.paise,
        ai: svc.ai || '',
      });
    });

    if (!pkg && !items.length) {
      return json(res, 400, { error: 'Nothing was selected' });
    }

    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim();
    if (!name) return json(res, 422, { error: 'Tell us your name' });
    if (!validEmail(email)) return json(res, 422, { error: 'That email address is not valid' });
    if (!validPhone(phone)) return json(res, 422, { error: 'A 10-digit Indian mobile, please' });

    /* Ten an hour. Somebody genuinely buying a package and then three services
       makes four in a minute; a script making orders forever creates accounts
       and sends email, which is the expensive kind of junk. */
    if (floodedBy(clientIp(req), 'order', 10, 60 * 60 * 1000)) return slowDown(res);

    const s = me(req);
    const reference = 'GLV-' + crypto.randomInt(1000, 9999);
    const gross = (pkg ? pkg.paise : 0) + items.reduce((t, x) => t + x.paise, 0);

    /* What the order is CALLED. A package keeps its name; a basket of services
       is named by what is in it, because "Order GLV-4821" on a dashboard tells
       a student nothing about what they bought. */
    const label = pkg ? pkg.name
      : items.length === 1 ? items[0].name
      : items.length + ' services';

    /*
     * `awaiting` when a gateway is going to collect, `owing` when a counsellor
     * is.
     *
     * It used to be `paid` in both cases, which was true of neither: nothing
     * was ever charged. Once Razorpay is on, marking an order paid at the
     * moment it is created would hand over the universities before a single
     * rupee had moved, to anybody who pressed the button and closed the tab.
     */
    /*
     * The terms, accepted before the money and recorded with it.
     *
     * The wording comes from OUR copy of the package, not from what the page
     * says it displayed — a browser that reports its own consent line could
     * report anything, and this is the part that has to hold up when somebody
     * disputes a charge. If a package carries a consent line and the tick is
     * not there, the order does not exist: refusing here rather than in the
     * page means a hand-rolled request cannot skip it either.
     */
    const consentLine = acceptanceLine(pkg);
    if (b.acceptedTerms !== true) {
      return json(res, 422, {
        error: 'Accept the terms shown before paying — we record what you accepted '
             + 'and show it back to you.',
        needsAcceptance: true, line: consentLine,
      });
    }
    const accepted = acceptanceRecord({ req, line: consentLine, pkg, name, email });

    /*
     * Paying in parts.
     *
     * Anything over ₹10,000 may be spread. The schedule is worked out here,
     * from our own price and our own phases — a browser asking to pay ₹1 of
     * ₹74,999 "in parts" is asking for the schedule to come from the request,
     * and it does not.
     */
    /* Packages and baskets of services alike — the rule is the price, not what
       was bought. A student buying four services for ₹32,000 is in exactly the
       position the rule exists for. */
    const canSplit = PLANS.allowed(gross);
    const inParts = canSplit && b.payIn === 'parts';
    const plan = inParts ? PLANS.split(gross, pkg, Date.now()) : null;
    /* The gateway collects the first part, not the total. This is the number
       that has to be right: charging the full amount and calling it an
       instalment is the worst possible version of this feature. */
    const chargeNow = plan ? plan[0].paise : gross;

    const collecting = pay.enabled;
    const order = db.addOrder({
      plan,
      studentId: s ? s.id : null, reference, package: label,
      publicUnis: pkg ? pkg.publicUnis : 0, grossPaise: gross, name, email, phone,
      status: collecting ? 'awaiting' : 'owing', kind: pkg ? 'package' : 'services',
      items: items.map(x => ({ id: x.id, name: x.name, level: x.level, paise: x.paise })),
      accepted,
    });

    /* The gateway's own order, created from OUR total. The browser is handed an
       id and the public key id; the amount it displays comes from Razorpay,
       which got it from here, so there is no number in this flow that a page
       could have tampered with. */
    let rzp = null;
    if (collecting) {
      try {
        const made = await pay.createOrder({
          amountPaise: chargeNow,
          receipt: reference,
          notes: { reference, email, package: label,
            part: plan ? '1 of ' + plan.length : 'in full' },
        });
        rzp = { orderId: made.id, keyId: pay.keyId, amountPaise: chargeNow };
        db.setOrderGateway(reference, made.id);
      } catch (e) {
        /* The gateway is down or misconfigured. The order still exists and a
           counsellor can still collect — losing the sale because a third party
           had a bad minute would be the worse failure. */
        db.setOrderStatus(reference, 'owing');
        db.log('system', 'Razorpay order could not be created', reference + ': ' + e.message);
      }
    }

    /*
     * The account is made here, not asked for later.
     *
     * A guest used to finish the checkout and be told to go and sign up. Some
     * did. The ones who did not had paid for universities they could not see,
     * and the office had an order with nobody attached to it — which is exactly
     * what "no account yet" in the order book has been counting.
     *
     * So: if they are not signed in and that email has no account, we make one.
     * They are signed in on this browser straight away, because this is the
     * browser that just placed the order, and a set-password link goes to the
     * email so they can get back in from anywhere else.
     *
     * NOT if an account already exists on that address. Creating a session for
     * an existing account because somebody typed its address into a checkout
     * would be a way into it.
     */
    let created = null;
    let inviteLink = '';
    let sessionCookieHeader = null;
    if (!s && !db.studentByEmail(email)) {
      /* A password nobody will ever use or see. The account is unusable until
         the set-password link is followed, which is the point — there is no
         weak default sitting on it. */
      const salt = newSalt();
      const temp = newPassword();
      created = db.createStudent(email, name, tenDigits(phone) ? '+91' + tenDigits(phone) : '',
        hashPassword(temp, salt), salt);
      db.setMustChange(created.id, true);
      db.claimOrders(created.id, email);
      seedMessages(created);

      /* Both ways in, because they fail differently. The password is what a
         counsellor reads out when a student phones to say nothing arrived; the
         link is what works when they have forgotten it. Neither survives first
         use — the account demands its own password either way. */
      const invite = newToken();
      /* Days, not the 30 minutes a forgotten password gets. This one is an
         invitation — it may sit unread over a weekend, and a student coming
         back to a dead link after paying is the worst version of this. */
      db.createReset(invite, created.id, 60 * 24 * 7);
      inviteLink = siteUrl + '/login?token=' + invite;
      mail.send(Object.assign({ to: created.email }, EMAILS.credentials({
        name: created.name, email: created.email, password: temp, siteUrl,
        role: 'student', madeBy: '',
      }))).catch(() => {});

      const sess = newToken();
      db.createSession(sess, created.id, 30);
      sessionCookieHeader = sessionCookie(sess, 30);
      db.log('system', 'Account created at checkout', email + ' — ' + reference);
    }

    const tax = Math.round(gross - gross / (1 + GST_RATE));

    /* The receipt is the message that tells a guest how to get into the portal
       they just paid for, so it goes out whether or not they have an account. */
    mail.send(Object.assign({ to: email }, EMAILS.orderReceipt({
      name, email, reference, packageName: label, grossPaise: gross,
      publicUnis: pkg ? pkg.publicUnis : 0, siteUrl, hasAccount: !!s,
      services: items.map(x => x.name + (x.level ? ' (' + x.level + ')' : '')),
    }))).catch(() => {});

    return json(res, 200, {
      reference, package: label, publicUnis: pkg ? pkg.publicUnis : 0,
      grossPaise: gross, taxablePaise: gross - tax, taxPaise: tax,
      services: items.map(x => ({ id: x.id, name: x.name, level: x.level, priceInr: x.paise / 100 })),
      linkedToAccount: !!s || !!created,
      /* So the confirmation can say "your dashboard is ready" rather than
         "now go and make an account", which is what it said to somebody whose
         account had just been made for them. */
      accountCreated: !!created,
      createdAt: order.created_at,
      /* Present only when there is genuinely a card form to open. The page
         decides which confirmation to show from this and nothing else. */
      razorpay: rzp,
      status: rzp ? 'awaiting' : 'owing',
      /* The schedule, so the confirmation can say what was charged now and
         what is left rather than showing the full price against a payment that
         was a fraction of it. */
      plan,
      chargedNowPaise: chargeNow,
      outstandingPaise: plan ? gross - plan[0].paise : 0,
      /* Whether this could have been split, so the page knows to offer it. */
      canSplit: !!canSplit,
    }, sessionCookieHeader ? { 'Set-Cookie': sessionCookieHeader } : undefined);
  }, { open: true });

  /*
   * The browser comes back from Razorpay saying it worked.
   *
   * It might be right. The signature is the only reason to believe it: Razorpay
   * computes it over `order_id|payment_id` with the key secret, which no
   * browser has ever seen. Wrong signature, nothing happens — and the webhook
   * will settle it properly a moment later if the payment was real.
   */
  route('POST', /^\/api\/orders\/(GLV-\d+)\/paid$/, async (req, res, s, m) => {
    const reference = m[1];
    const b = await readJson(req);
    const order = db.orderByReference(reference);
    if (!order) return json(res, 404, { error: 'No such order.' });
    if (order.status === 'paid') return json(res, 200, { status: 'paid', reference });

    if (!pay.enabled) return json(res, 409, { error: 'No gateway is collecting on this site.' });

    const okSig = pay.verifyHandback({
      orderId: String(b.razorpay_order_id || ''),
      paymentId: String(b.razorpay_payment_id || ''),
      signature: String(b.razorpay_signature || ''),
    });
    /* And it must be the signature for THIS order — a valid signature from
       somebody else's ₹1 payment is still a valid signature. */
    const sameOrder = order.gateway_order_id
      && order.gateway_order_id === String(b.razorpay_order_id || '');

    if (!okSig || !sameOrder) {
      db.log('system', 'Payment handback refused', reference
        + (okSig ? ' — signature was for a different order' : ' — signature did not verify'));
      return json(res, 400, {
        error: 'That payment could not be confirmed. If money has left your account it is '
             + 'safe — tell us the reference and we will find it.',
      });
    }

    const done = recordPayment(order, String(b.razorpay_payment_id || ''));
    db.log('system', 'Payment confirmed', reference + ' — '
      + inrOf(done.plan ? (done.collected || 0) : order.gross_paise)
      + (done.outstanding ? ' (' + inrOf(done.outstanding) + ' still to come)' : ''));
    return json(res, 200, {
      status: done.status, reference,
      outstandingPaise: done.outstanding, plan: done.plan,
    });
  }, { open: true });

  /*
   * Razorpay tells us directly.
   *
   * This is the one that matters. A student whose phone died on the bank's
   * 3-D Secure page never sends a handback, and their money has still left
   * their account. The webhook arrives regardless.
   *
   * Signed over the RAW bytes, so the route reads them itself rather than
   * taking a parsed object — re-serialising JSON reorders keys and the
   * signature stops matching.
   */
  route('POST', '/api/razorpay/webhook', async (req, res) => {
    const raw = await readRaw(req);
    const sig = req.headers['x-razorpay-signature'];

    if (!pay.webhookReady) {
      /* Not configured to verify: refuse rather than trust. An unverifiable
         webhook is an open endpoint for marking any order paid. */
      return json(res, 503, { error: 'No webhook secret is configured.' });
    }
    if (!pay.verifyWebhook(raw, sig)) {
      db.log('system', 'Webhook refused', 'signature did not verify');
      return json(res, 400, { error: 'Signature did not verify.' });
    }

    let body = {};
    try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) { body = {}; }
    const event = String(body.event || '');
    const entity = ((body.payload || {}).payment || {}).entity || {};
    const gatewayOrderId = entity.order_id || '';
    const order = gatewayOrderId ? db.orderByGateway(gatewayOrderId) : null;

    /* 200 even when we do nothing. Razorpay retries anything that is not a 2xx,
       and retrying an event we have deliberately ignored forever helps nobody. */
    if (!order) return json(res, 200, { ok: true, note: 'no matching order' });

    if (event === 'payment.captured') {
      /* The amount is checked, not assumed. A payment for less than the order
         is not that order being paid — unless the order is being paid in
         parts, in which case the amount has to match a part that is still
         owed, and it settles THAT part rather than the order. */
      const amount = Number(entity.amount || 0);
      const parts = planOf(order);
      const part = parts && parts.find(x => x.status !== 'paid' && Number(x.paise) === amount);
      if (!part && amount !== Number(order.gross_paise || 0)) {
        db.log('system', 'Webhook amount mismatch',
          order.reference + ': gateway says ' + amount + ', order is ' + order.gross_paise
          + (parts ? ' and no unpaid part is that size' : ''));
        return json(res, 200, { ok: true, note: 'amount mismatch, left alone' });
      }
      if (order.status !== 'paid') {
        const done = recordPayment(order, entity.id || '', part ? part.n : null);
        db.log('system', 'Payment captured', order.reference + ' — ' + inrOf(amount)
          + (done.outstanding ? ' (' + inrOf(done.outstanding) + ' still to come)' : ''));
      }
    } else if (event === 'payment.failed' && order.status !== 'paid') {
      db.setOrderStatus(order.reference, 'failed');
      db.log('system', 'Payment failed', order.reference);
    }
    return json(res, 200, { ok: true });
  }, { open: true });

  /* Whether to offer a card at all, and under whose key. The secret is not here
     and never will be — the key id is public by design. */
  route('GET', '/api/pay/config', async (req, res) => json(res, 200, {
    enabled: pay.enabled,
    keyId: pay.keyId,
  }), { open: true });

  /*
   * What you accepted, shown back to you.
   *
   * "The student should be shown proof that during payment he accepted all
   * conditions" — so the record is readable by the person it is about, by the
   * office, and by nobody else. An order still waiting for its account is
   * readable by whoever knows its reference AND its email address, because the
   * person who just paid has no account to sign in to yet and is exactly who
   * needs to see this.
   */
  route('GET', /^\/api\/orders\/([A-Za-z0-9-]{3,30})\/acceptance$/,
    async (req, res, s, m) => {
      const order = db.orderByReference(m[1]);
      if (!order) return json(res, 404, { error: 'No such order' });

      const staff = s && s.role !== 'student';
      const mine = s && Number(order.student_id) === Number(s.id);
      const asked = String((url.parse(req.url, true).query || {}).email || '')
        .trim().toLowerCase();
      const byEmail = asked && asked === String(order.email || '').toLowerCase();
      if (!staff && !mine && !byEmail) {
        return json(res, 403, {
          error: 'Sign in with the email this order was placed under to see it.',
        });
      }

      let accepted = null;
      try { accepted = order.accepted ? JSON.parse(order.accepted) : null; } catch (e) { /* none */ }
      return json(res, 200, {
        order: {
          reference: order.reference, package: order.package,
          grossPaise: order.gross_paise, status: order.status,
          name: order.name, email: order.email, at: order.created_at,
          paidAt: order.paid_at || '',
        },
        accepted,
      });
    }, { open: true, soft: true });

  route('GET', '/api/orders', async (req, res, s) => json(res, 200, { orders: stateFor(s).orders }));

  /*
   * The next part, paid by the student.
   *
   * A schedule the student can see and cannot act on is a bill. This makes a
   * fresh gateway order for the part that is due — for ITS amount, worked out
   * here — and the card sheet opens on the dashboard the same way it does at
   * the checkout.
   */
  route('POST', /^\/api\/orders\/(GLV-\d+)\/pay-part$/, async (req, res, s) => {
    const order = db.orderByReference(String(req.url.split('/')[3]));
    if (!order) return json(res, 404, { error: 'No such order' });
    if (Number(order.student_id) !== Number(s.id)) {
      return json(res, 403, { error: 'That order is not yours' });
    }
    const plan = planOf(order);
    if (!plan) return json(res, 409, { error: 'That order is not being paid in parts.' });
    const part = PLANS.nextDue(plan);
    if (!part) return json(res, 409, { error: 'It is all paid.' });
    if (!pay.enabled) {
      return json(res, 409, {
        error: 'Card payment is not switched on yet. Your counsellor can take this part '
             + 'and record it against your order.',
      });
    }
    try {
      const made = await pay.createOrder({
        amountPaise: part.paise,
        receipt: order.reference + '-' + part.n,
        notes: { reference: order.reference, part: part.n + ' of ' + plan.length },
      });
      /* The gateway id is stored so the webhook can find this order when it
         arrives — the webhook has nothing but the gateway's own identifiers. */
      db.setOrderGateway(order.reference, made.id);
      return json(res, 200, {
        reference: order.reference,
        razorpay: { orderId: made.id, keyId: pay.keyId, amountPaise: part.paise },
        part: { n: part.n, label: part.label, paise: part.paise },
      });
    } catch (e) {
      return json(res, 502, {
        error: 'The card system did not answer. Try again in a minute, or your counsellor '
             + 'can take this part over the phone.',
      });
    }
  });

  /* ----------------------------------------------------------- enquiries */

  /*
   * Where a lead came from.
   *
   * Every enquiry landed in one undifferentiated list, so "how many did
   * Facebook bring us, and how many of those converted" had no answer — the
   * money going into ads was being judged on a feeling.
   *
   * Two things are read, and they answer different questions. The page they
   * were on when they filled the form carries the campaign parameters, because
   * the browser sends the full URL of that page as Referer on the POST. The
   * `referrer` the page reports is where they came from BEFORE they landed —
   * facebook.com, a Google search. Either can name the source; the campaign
   * only ever comes from the first.
   */
  const HOSTS = [
    [/(?:^|\.)(?:facebook|fb|m\.facebook)\.com$/i, 'facebook'],
    [/(?:^|\.)instagram\.com$/i, 'instagram'],
    [/(?:^|\.)(?:wa\.me|whatsapp\.com|api\.whatsapp\.com)$/i, 'whatsapp'],
    [/(?:^|\.)google\./i, 'google'],
    [/(?:^|\.)bing\.com$/i, 'bing'],
    [/(?:^|\.)(?:youtube\.com|youtu\.be)$/i, 'youtube'],
    [/(?:^|\.)linkedin\.com$/i, 'linkedin'],
    [/(?:^|\.)(?:x\.com|twitter\.com|t\.co)$/i, 'x'],
    [/(?:^|\.)quora\.com$/i, 'quora'],
    [/(?:^|\.)reddit\.com$/i, 'reddit'],
  ];
  const SOURCES = new Set(['website', 'blog', 'chat', 'facebook', 'instagram', 'whatsapp',
    'google', 'bing', 'youtube', 'linkedin', 'x', 'quora', 'reddit', 'phone', 'walk-in',
    'referral', 'other']);

  const paramsOf = u => {
    try { return new URL(u).searchParams; } catch (e) { return new URLSearchParams(); }
  };
  const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };

  function sourceOf(req, b) {
    /* Said outright — a counsellor logging a call, or a form that knows. */
    const said = String(b.source || '').trim().toLowerCase();
    if (SOURCES.has(said)) return { source: said, campaign: String(b.campaign || '').slice(0, 90) };

    const here = String(req.headers.referer || '');
    const q = paramsOf(here);
    const campaign = String(q.get('utm_campaign') || q.get('utm_content') || '').slice(0, 90);

    const utm = String(q.get('utm_source') || '').toLowerCase();
    if (utm) {
      for (const [re, name] of HOSTS) if (re.test(utm) || utm === name) return { source: name, campaign };
      if (SOURCES.has(utm)) return { source: utm, campaign };
      return { source: 'other', campaign: campaign || utm.slice(0, 90) };
    }
    /* The click ids, for when the utm tags were forgotten — which is most of
       the time, because they are added by hand. */
    if (q.get('gclid') || q.get('gad_source')) return { source: 'google', campaign };
    if (q.get('fbclid')) return { source: 'facebook', campaign };

    const from = hostOf(String(b.referrer || ''));
    if (from && !/glovels/i.test(from)) {
      for (const [re, name] of HOSTS) if (re.test(from)) return { source: name, campaign };
      return { source: 'other', campaign: campaign || from.slice(0, 90) };
    }

    /* Nothing external: it is the site itself, and which part of it. */
    const how = String(b.consent || '').toLowerCase();
    if (how === 'chat') return { source: 'chat', campaign };
    if (how === 'blog') return { source: 'blog', campaign };
    return { source: 'website', campaign };
  }


  const enquiry = async (req, res) => {
    const b = await readJson(req);
    if (b.website) return json(res, 200, { ok: true });          // honeypot
    /* Six an hour from one address. A real person sending a second enquiry
       because they forgot to mention their intake is normal; a seventh in the
       same hour is not a person. */
    if (floodedBy(clientIp(req), 'enq', 6, 60 * 60 * 1000)) return slowDown(res);
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone || !email) return json(res, 422, { ok: false, error: 'Name, phone and email are required' });
    if (!validEmail(email)) return json(res, 422, { ok: false, error: 'That email address is not valid' });
    if (!validPhone(phone)) return json(res, 422, { ok: false, error: 'That does not look like an Indian mobile number' });
    /* What it is about, in their words or in the page's.
       Every form on the site writes here, and until now they all wrote the
       same shape: a name, a number and a country. A lead from a blog post that
       does not say which post, or from a form where somebody typed a question
       that was then thrown away, is a lead the counsellor starts from
       nothing. */
    const said = String(b.message || b.note || '').trim().slice(0, 400);
    const about = String(b.note || '').trim().slice(0, 200);
    const from = sourceOf(req, b);
    const record = {
      name, email, phone: '+91' + tenDigits(phone),
      destination: b.destination, consent: b.consent,
      note: about && said && said !== about ? about + ' — “' + said + '”' : (about || said),
      source: from.source, campaign: from.campaign,
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
    /* Three new conversations an hour from one address. A student who closes
       the tab and comes back is fine; a script opening threads in a loop fills
       the office's screen with nothing. */
    if (floodedBy(clientIp(req), 'chat', 3, 60 * 60 * 1000)) return slowDown(res);
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
      const from = sourceOf(req, { consent: 'chat', referrer: b.referrer });
      db.addEnquiry({
        name, phone: phone ? '+91' + phone : '', email: isEmail ? contact.toLowerCase() : '',
        destination: '', consent: 'chat', sourcePage: String(b.page || '').slice(0, 200),
        source: from.source, campaign: from.campaign,
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
    /*
     * The BIGGEST paid entitlement, not the most recent order.
     *
     * Two changes here, both of which matter once money moves. It used to take
     * `ordersFor(id)[0]` — the newest order, whatever its state — so an order
     * that had only been created would unlock the names before anybody paid for
     * them, and a small package bought after a large one would take the large
     * one's universities away again.
     *
     * `owing` counts: that is the state on a site with no gateway, where a
     * counsellor collects and the office has decided the student may proceed.
     * `awaiting` does not: a gateway is mid-collection and has not confirmed.
     */
    const me_orders = me_ ? db.ordersFor(me_.id) : [];
    const earned = me_orders.filter(o => EARNED.has(o.status));
    const quota = earned.reduce((n, o) => Math.max(n, Number(o.public_unis || 0)), 0);
    let spent = 0;

    /*
     * How much of a public university a visitor who has not paid may see. Set
     * on the Home page screen, under Finder & contact, and enforced HERE
     * because the name has to be withheld by the server — a page that hides it
     * with CSS has already sent it.
     *
     *   gated  the match, not the name. The default, and the business model.
     *   names  the name, not the fee.
     *   open   everything, free to all.
     */
    let gate = 'gated';
    try {
      const f = content && content.get('finder');
      if (f && f.gate) gate = f.gate;
    } catch (e) { /* the strictest reading is the safe one */ }

    /* The quota counts UNIVERSITIES, because that is what the package says on
       the card: "Reveals 5 public universities". Counting programmes instead
       spends the allowance on five courses at three universities, which is a
       worse deal than the one that was sold. Every programme at an already
       revealed university is free. */
    const named = new Set();
    const mayShow = p => {
      if (named.has(p.uKey)) return true;
      if (named.size >= quota) return false;
      named.add(p.uKey);
      return true;
    };

    const programmes = cat().map(p => {
      if (!p.isPublic) return p;                       // never gated
      if (gate === 'open') return p;
      if (gate === 'names') {
        /* The name, and enough to place it, but not what it costs. */
        return Object.assign({}, p, { totalInr: 0, freeTuition: false, feeHidden: true });
      }
      const mayName = quota > 0 && mayShow(p);
      if (mayName) spent = named.size;
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
      /* Said out loud, so the page does not have to infer it from the shape of
         the rows it got. */
      gate,
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

  /*
   * Choosing your own password, from inside the session.
   *
   * Separate from /api/auth/reset, which takes an emailed token and belongs to
   * somebody who is locked out. This one belongs to somebody already signed in
   * with a password we gave them, and it asks for that password again — so a
   * borrowed laptop with a live session cannot be used to take the account
   * over.
   */
  route('POST', '/api/auth/change', async (req, res, s) => {
    const b = await readJson(req);
    const current = String(b.current || '');
    const pw = String(b.password || '');

    const floor = s.role && s.role !== 'student' ? 10 : 8;
    if (pw.length < floor) {
      return json(res, 422, { error: 'Use at least ' + floor + ' characters.' });
    }
    if (!safeEqual(hashPassword(current, s.pass_salt), s.pass_hash)) {
      return json(res, 401, { error: 'That is not your current password.' });
    }
    if (pw === current) {
      return json(res, 422, { error: 'That is the password you were given. Pick a different one.' });
    }

    const salt = newSalt();
    /* setPassword drops every session, including this one — which is right
       after a password change, but it would sign them out of the browser they
       are standing in front of. So a fresh session is issued immediately. */
    db.setPassword(s.id, hashPassword(pw, salt), salt);
    db.setMustChange(s.id, false);
    const token = newToken();
    db.createSession(token, s.id, 30);
    db.log(s.name, 'chose their own password', '');
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, 30) });
  });

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
    const link = siteUrl + '/login?token=' + token;
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
    /* They have chosen this one themselves, so whatever we gave them before is
       spent. */
    db.setMustChange(s.id, false);
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
      msgs: db.getMessages(id).map(msgShape(id)),
    });
  }));

  /*
   * The counsellor runs the student's list.
   *
   * This is the actual job. A counsellor agrees a shortlist on the phone and
   * then had no way to put it anywhere — the student had to add each university
   * themselves, from a finder, having just been told which ones over a call.
   * The agreed shortlist is also what the admission guarantee attaches to, so
   * "agreed" needs to mean a row in a database rather than a memory of a
   * conversation.
   *
   * The programme is looked up in OUR catalogue by id, exactly as it is for a
   * student, so a counsellor cannot invent a university or a fee either.
   */
  route('POST', /^\/api\/staff\/student\/(\d+)\/shortlist$/,
    caseworkOnly(async (req, res, s, m) => {
      const id = Number(m[1]);
      if (!db.canSee(s, id)) return json(res, 403, { error: 'That student is not assigned to you' });
      const st = db.studentById(id);
      if (!st) return json(res, 404, { error: 'No such student' });

      const b = await readJson(req);
      const p = lookup(String(b.id || ''));
      if (!p) return json(res, 404, { error: 'No such programme in the catalogue.' });

      const already = db.getShortlist(id).some(x => String(x.prog_id) === String(p.id));
      db.addShortlist(id, p);
      if (!already) {
        db.log(s.name, 'added a university', st.name + ' — ' + (p.university || p.id));
        /* The student is told, on their own thread, because a university
           appearing on their list without explanation is unsettling — and
           because this is the counsellor doing visible work. */
        db.addMessage(id, 'them', 'I have added ' + (p.university || p.id)
          + (p.name ? ' — ' + p.name : '') + ' to your list.');
        live.toStudent(id, 'shortlist', {});
      }
      return json(res, 200, { shortlist: stateFor(st).shortlist, apps: stateFor(st).apps });
    }));

  route('DELETE', /^\/api\/staff\/student\/(\d+)\/shortlist\/(.+)$/,
    caseworkOnly(async (req, res, s, m) => {
      const id = Number(m[1]);
      if (!db.canSee(s, id)) return json(res, 403, { error: 'That student is not assigned to you' });
      const st = db.studentById(id);
      if (!st) return json(res, 404, { error: 'No such student' });

      const progId = decodeURIComponent(m[2]);
      const row = db.getShortlist(id).find(x => String(x.prog_id) === progId);
      db.removeShortlist(id, progId);
      /* The application goes with it. A tracker for a university nobody is
         applying to any more is a row that will be wrong forever. */
      db.removeApplication(id, progId);
      if (row) {
        db.log(s.name, 'removed a university', st.name + ' — ' + (row.university || progId));
        db.addMessage(id, 'them', 'I have taken ' + (row.university || progId) + ' off your list.');
        live.toStudent(id, 'shortlist', {});
      }
      return json(res, 200, { shortlist: stateFor(st).shortlist, apps: stateFor(st).apps });
    }));

  /*
   * Where each application has got to.
   *
   * The student's own screen has always shown a five-stage tracker; nobody
   * could move it. So it sat at stage zero for every student on the site while
   * their counsellor filed applications, and the one question a student asks —
   * "where is mine up to" — had no answer on the screen built to answer it.
   */
  route('PUT', /^\/api\/staff\/student\/(\d+)\/application\/(.+)$/,
    caseworkOnly(async (req, res, s, m) => {
      const id = Number(m[1]);
      if (!db.canSee(s, id)) return json(res, 403, { error: 'That student is not assigned to you' });
      const st = db.studentById(id);
      if (!st) return json(res, 404, { error: 'No such student' });

      const progId = decodeURIComponent(m[2]);
      const row = db.getShortlist(id).find(x => String(x.prog_id) === progId);
      if (!row) return json(res, 404, { error: 'That is not on this student\'s list.' });

      const b = await readJson(req);
      const stage = Math.max(0, Math.min(4, Math.round(Number(b.stage) || 0)));
      const outcome = /^(offer|rejected)$/.test(String(b.outcome || ''))
        ? String(b.outcome) : '';

      const before = db.getApplications(id).find(a => String(a.prog_id) === progId);
      db.putApplication(id, progId, stage, outcome);

      const words = ['Documents collected', 'Application drafted', 'Submitted',
        'Under review', 'Decision'][stage];
      const said = outcome === 'offer' ? 'an offer from ' + (row.university || progId)
        : outcome === 'rejected' ? (row.university || progId) + ' has said no'
        : (row.university || progId) + ': ' + words;

      /* Only when it actually moved. A counsellor tidying up ten rows should
         not send a student ten messages saying nothing changed. */
      const moved = !before || before.stage !== stage || before.outcome !== outcome;
      if (moved) {
        db.log(s.name, 'moved an application', st.name + ' — ' + said);
        db.addMessage(id, 'them', 'Update on your applications — ' + said + '.');
        live.toStudent(id, 'apps', {});
      }
      return json(res, 200, { apps: stateFor(st).apps, moved });
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
    const payload = { who: 'them', t: last.body, file: '', attachment: null,
      at: last.created_at };

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
  /* The other direction: a counsellor sending an offer letter, a form to
     sign, a checklist. It goes on the student's file too, because "where is
     that form they sent me" is the same question in reverse. */
  route('POST', /^\/api\/staff\/student\/(\d+)\/attach$/,
    caseworkOnly(async (req, res, s, m) => {
      const id = Number(m[1]);
      if (!db.canSee(s, id)) return json(res, 403, { error: 'That student is not assigned to you' });
      const st = db.studentById(id);
      if (!st) return json(res, 404, { error: 'No such student' });
      const parsed = await oneFile(req, res);
      if (!parsed) return true;

      const key = storeAttachment(id, parsed.file, 'them');
      const note = String(parsed.fields.body || '').slice(0, 400);
      db.addMessage(id, 'them', note || 'Sent you ' + parsed.file.filename, key);
      db.log(s.name, 'shared a document', st.name + ' — ' + parsed.file.filename);

      const msgs = db.getMessages(id).map(msgShape(id));
      live.toStudent(id, 'message', { studentId: id, msg: msgs[msgs.length - 1] });
      return json(res, 200, { msgs });
    }));

  /* A student's file, to the person looking after them. The student's own
     route builds the path from their session; this one builds it from the id
     in the URL, so it checks the assignment first — an id in a URL is a guess
     until somebody says otherwise. */
  route('GET', /^\/api\/staff\/student\/(\d+)\/document\/(.+)\/file$/,
    caseworkOnly(async (req, res, s, m) => {
      const id = Number(m[1]);
      if (!db.canSee(s, id)) return json(res, 403, { error: 'That student is not assigned to you' });
      const rec = db.docByKey(id, decodeURIComponent(m[2]));
      if (!rec) return json(res, 404, { error: 'Not found' });
      const file = path.join(uploadDir, String(id), rec.stored_name);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + rec.filename.replace(/"/g, '') + '"',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
      return true;
    }));

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
    /* Every order, not one per student. An order placed before the buyer made
       an account belongs to nobody yet, and walking the students to find the
       orders skipped exactly those — so the counter read zero to the person
       who had just placed four of them. */
    const orders = db.allOrders();
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

  /*
   * The order book.
   *
   * There was no way to see an order. The Organisation screen counted them and
   * showed a rupee total, and that was all — no list, no reference, no way to
   * find out what somebody had bought. Orders placed by a visitor who had not
   * signed up were not even counted.
   */
  /*
   * The next part, collected by a counsellor.
   *
   * Bank transfer, UPI to the office account, cash at the desk — most of this
   * money will arrive that way for a while yet. Writing it down here is what
   * makes the student's screen and the order book agree.
   */
  route('POST', /^\/api\/staff\/order\/(GLV-\d+)\/part$/,
    caseworkOnly(async (req, res, s, m) => {
      const order = db.orderByReference(m[1]);
      if (!order) return json(res, 404, { error: 'No such order' });
      const plan = planOf(order);
      if (!plan) return json(res, 409, { error: 'That order is not being paid in parts.' });
      const b = await readJson(req);
      const next = PLANS.nextDue(plan);
      if (!next && !b.n) return json(res, 409, { error: 'It is all paid.' });
      const which = Number(b.n || 0) || (next || {}).n;
      const part = plan.find(x => Number(x.n) === Number(which));
      if (!part) return json(res, 404, { error: 'No such part' });
      if (part.status === 'paid') return json(res, 409, { error: 'That part is already paid.' });

      const done = recordPayment(order, String(b.note || 'collected by ' + s.name).slice(0, 60),
        part.n);
      db.log(s.name, 'recorded a part payment',
        order.reference + ' — part ' + part.n + ', ' + inrOf(part.paise)
        + (done.outstanding ? ', ' + inrOf(done.outstanding) + ' still to come' : ', settled'));
      /* The student is told on their own thread. Money arriving is the one
         thing nobody should have to ask about. */
      if (order.student_id) {
        try {
          db.addMessage(order.student_id, 'them',
            'Received ' + inrOf(part.paise) + ' for ' + order.reference + ' — ' + part.label
            + '. ' + (done.outstanding
              ? inrOf(done.outstanding) + ' left on this package.'
              : 'That settles it, thank you.'));
          live.toStudent(order.student_id, 'message', {});
        } catch (e) { /* the payment is recorded either way */ }
      }
      return json(res, 200, {
        reference: order.reference, status: done.status,
        plan: done.plan, outstandingPaise: done.outstanding,
      });
    }));

  route('GET', '/api/staff/orders', caseworkOnly(async (req, res, s) => {
    if (s.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    const byId = new Map(db.allStudents().map(st => [st.id, st]));
    const orders = db.allOrders().map(o => {
      let items = [];
      try { items = JSON.parse(o.items || '[]'); } catch (e) { items = []; }
      const st = o.student_id ? byId.get(o.student_id) : null;
      return {
        reference: o.reference,
        kind: o.kind || 'package',
        package: o.package || '',
        items,
        publicUnis: o.public_unis || 0,
        grossPaise: o.gross_paise || 0,
        status: o.status || '',
        name: o.name || '',
        email: o.email || '',
        phone: o.phone || '',
        /* Whether there is a record of what they accepted, and when. The words
           themselves are on the receipt — the book only needs to say that one
           exists, because an order with nothing recorded against it is the one
           worth spotting. */
        acceptedAt: (() => {
          try { return o.accepted ? (JSON.parse(o.accepted).at || '') : ''; }
          catch (e) { return ''; }
        })(),
        /* The schedule and what is still owed. An order book that shows
           ₹74,999 against an order where ₹30,000 has arrived is a revenue
           figure nobody can act on. */
        plan: (() => {
          try { return o.plan ? JSON.parse(o.plan) : null; } catch (e) { return null; }
        })(),
        paidPaise: o.paid_paise || 0,
        at: o.created_at,
        /* Whether this order has an account behind it yet. A guest order is not
           a problem — it is the normal path — but it is the one somebody has to
           chase, so it is said out loud rather than left to be inferred from a
           null. */
        studentId: o.student_id || null,
        studentName: st ? st.name : '',
      };
    });
    return json(res, 200, {
      orders,
      grossPaise: orders.reduce((a, o) => a + o.grossPaise, 0),
      guests: orders.filter(o => !o.studentId).length,
    });
  }));

  /*
   * Send a student their way in.
   *
   * The office could create an account and see its password once, on one
   * screen, and then had to get it to the student somehow — read out over the
   * phone, typed into WhatsApp. This does it properly: a link that sets a
   * password, good for seven days, used once.
   *
   * The link comes back in the response as well as going by email, because
   * email does not leave this building until SMTP is configured. Telling the
   * office "sent" while the message sits in a folder would be a lie they only
   * discover when a student says they never got it — so the answer says which
   * of the two actually happened, and hands over the link either way.
   */
  route('POST', /^\/api\/staff\/students\/(\d+)\/invite$/,
    caseworkOnly(async (req, res, s, m) => {
      const id = Number(m[1]);
      const student = db.studentById(id);
      if (!student) return json(res, 404, { error: 'No such student.' });

      /* A counsellor may only do this for their own. The rule is the same one
         that governs every other student action, and it is enforced here
         rather than by hiding the button. */
      if (s.role !== 'admin' && Number(student.counsellor_id) !== s.id) {
        return json(res, 403, { error: 'That student is not assigned to you.' });
      }

      const token = newToken();
      db.createReset(token, student.id, 60 * 24 * 7);
      const link = siteUrl + '/login?token=' + token;

      const out = await mail.send(Object.assign({ to: student.email }, EMAILS.invite({
        name: student.name, email: student.email, link, days: 7, siteUrl,
      }))).catch(e => ({ ok: false, mode: 'error', error: e.message }));

      db.log(s.name, 'Sign-in link sent', student.email
        + (out && out.mode === 'smtp' ? ' — by email' : ' — written to the outbox'));

      return json(res, 200, {
        email: student.email,
        link,
        sent: !!(out && out.ok && out.mode === 'smtp'),
        mode: (out && out.mode) || 'unknown',
        days: 7,
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
    /* `student` is here as well as the three staff roles. A counsellor sitting
       with a walk-in should be able to make them an account there and then,
       and it is also the only way to get a test login onto a live site without
       putting a seeded password in an environment variable. */
    const role = ['admin', 'editor', 'counsellor', 'student'].includes(b.role)
      ? b.role : 'counsellor';
    const phone = String(b.phone || '').trim();

    if (!name) return json(res, 422, { error: 'They need a name' });
    if (!validEmail(email)) return json(res, 422, { error: 'That email address is not valid' });
    if (db.studentByEmail(email)) {
      return json(res, 409, { error: 'Somebody already has that email address on this site' });
    }

    /* A password nobody has chosen, shown once. An admin inventing passwords
       for their staff is how "Glovels@123" ends up on four accounts. */
    const password = String(b.password || '') || newPassword();
    /* A student's own sign-up accepts eight; holding an account made FOR them
       to a longer one would mean a counsellor reading out a password the
       student could not then choose for themselves. */
    const floor = role === 'student' ? 8 : 10;
    if (password.length < floor) {
      return json(res, 422, {
        error: 'A password for ' + (role === 'student' ? 'a student' : 'a staff')
             + ' account needs at least ' + floor + ' characters',
      });
    }
    const salt = newSalt();
    const person = db.createStudent(email, name, phone, hashPassword(password, salt), salt, role);
    /* We chose this password, so it opens exactly one thing: the screen that
       replaces it. */
    db.setMustChange(person.id, true);
    mail.send(Object.assign({ to: person.email }, EMAILS.credentials({
      name: person.name, email: person.email, password, siteUrl,
      role: role === 'student' ? 'student' : role, madeBy: s.name,
    }))).catch(() => {});

    /* An editor with no permissions can sign in and see nothing, which reads as
       a broken account rather than a careful one. If none were asked for, give
       the one the role exists for. */
    let perms = Array.isArray(b.perms) ? b.perms : [];
    if (role === 'editor' && !perms.length) perms = ['content'];
    if (role === 'student') perms = [];
    if (role !== 'admin') db.setPerms(person.id, perms);

    /* A student made by a COUNSELLOR is theirs — they are sitting with the
       person. One made by an administrator is left unassigned on purpose: an
       admin is not a caseload, the row's dropdown can only offer counsellors,
       and an unassigned student is visible in the Unassigned counter, which is
       where somebody will pick them up. */
    if (role === 'student' && s.role === 'counsellor') {
      try { db.assignCounsellor(person.id, s.id); } catch (e) { /* not fatal */ }
    }

    db.log(s.name,
      role === 'admin' ? 'administrator added'
        : role === 'editor' ? 'website editor added'
        : role === 'student' ? 'student account created' : 'counsellor added',
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

    const password = newPassword();
    const salt = newSalt();
    /* setPassword also drops every session that person has open. That is the
       point of resetting a password, and doing it quietly would not be. */
    db.setPassword(id, hashPassword(password, salt), salt);
    db.setMustChange(id, true);
    const out = await mail.send(Object.assign({ to: person.email }, EMAILS.credentials({
      name: person.name, email: person.email, password, siteUrl,
      role: person.role || 'student', madeBy: s.name,
    }))).catch(e => ({ ok: false, mode: 'error' }));
    db.log(s.name, 'password reset', person.name
      + (out && out.mode === 'smtp' ? ' — emailed' : ' — written to the outbox'));
    return json(res, 200, {
      password, name: person.name, email: person.email,
      /* So the screen can say "read it to them" rather than "we sent it", when
         nothing was sent. */
      sent: !!(out && out.ok && out.mode === 'smtp'),
    });
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
      note: e.note || '', source: e.source || 'website', status: e.status || 'new',
      page: e.source_page || '', at: e.created_at,
    })),
  })));

  /* ------------------------------------------------------------- the leads */
  /*
   * Every enquiry in one place, with what happened to it.
   *
   * They were already all in one table — the form, the chat box, the blog, the
   * Apply button — and that table was shown as a COUNT on a dashboard and, for
   * a while, as a read-only list. Nothing recorded who was chasing a lead, how
   * many times they had called, or why one did not convert. So the questions
   * the office actually asks — is Facebook worth it, are we following up, what
   * do we keep losing on — had no answer anywhere in the system.
   *
   * A lead is the enquiry row plus a thread of notes. The note thread is what
   * makes "how many follow-ups" a real number rather than a feeling.
   */

  const LEAD_STATUS = ['new', 'contacted', 'following', 'converted', 'lost'];
  /* The reasons a lead does not convert, as a list rather than free text —
     free text cannot be counted, and counting them is the point. `other`
     carries the note. */
  const LOST_REASONS = ['budget', 'went-elsewhere', 'deferred', 'not-eligible',
    'no-response', 'changed-plan', 'other'];

  const leadShape = (e, counts, people) => {
    const owner = e.owner_id ? people.get(Number(e.owner_id)) : null;
    const c = counts[String(e.id)] || { n: 0, last: '', lastWho: '' };
    return {
      id: e.id, name: e.name, phone: e.phone, email: e.email,
      destination: e.destination || '',
      source: e.source || 'website', campaign: e.campaign || '',
      how: e.consent === 'chat' ? 'chat' : 'form',
      note: e.note || '',
      status: e.status || 'new',
      lostReason: e.lost_reason || '',
      ownerId: e.owner_id || null,
      owner: owner ? owner.name : '',
      studentId: e.student_id || null,
      nextAt: e.next_at || '',
      followUps: c.n, lastTouch: c.last, lastBy: c.lastWho,
      page: e.source_page || '', referrer: e.referrer || '',
      at: e.created_at, updatedAt: e.updated_at || e.created_at,
    };
  };

  /* Everybody who could own a lead, by id. Counsellors and administrators —
     a lead handed to a website editor is a lead nobody calls. */
  const peopleMap = () => new Map(
    db.counsellors().concat(db.staffByRole('admin')).map(p => [Number(p.id), p]));

  route('GET', '/api/staff/leads', caseworkOnly(async (req, res, s) => {
    const counts = db.leadNoteCounts();
    const people = peopleMap();
    let rows = db.allEnquiries();
    /* A counsellor sees the ones that are theirs and the ones nobody has
       taken. An administrator sees the book. */
    if (s.role !== 'admin') {
      rows = rows.filter(e => !e.owner_id || Number(e.owner_id) === Number(s.id));
    }
    const leads = rows.map(e => leadShape(e, counts, people));

    /* The summary the office asks for, counted here so every screen showing it
       shows the same numbers. */
    const by = (key) => leads.reduce((m, l) => {
      const k = l[key] || 'unknown';
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    const won = leads.filter(l => l.status === 'converted');
    const bySource = {};
    leads.forEach(l => {
      const k = l.source || 'website';
      if (!bySource[k]) bySource[k] = { leads: 0, converted: 0, lost: 0, followUps: 0 };
      bySource[k].leads++;
      bySource[k].followUps += l.followUps;
      if (l.status === 'converted') bySource[k].converted++;
      if (l.status === 'lost') bySource[k].lost++;
    });

    return json(res, 200, {
      leads: leads.slice(0, 500),
      counsellors: db.counsellors().map(c => ({ id: c.id, name: c.name })),
      statuses: LEAD_STATUS, reasons: LOST_REASONS,
      summary: {
        total: leads.length,
        byStatus: by('status'),
        bySource,
        byReason: leads.filter(l => l.status === 'lost')
          .reduce((m, l) => { const k = l.lostReason || 'other'; m[k] = (m[k] || 0) + 1; return m; }, {}),
        followUps: leads.reduce((n, l) => n + l.followUps, 0),
        converted: won.length,
        /* Untouched, and old enough that it is a problem rather than a queue.
           This is the number that should make somebody uncomfortable. */
        cold: leads.filter(l => l.status !== 'converted' && l.status !== 'lost'
          && !l.followUps && Date.now() - new Date(l.at).getTime() > DAY).length,
      },
    });
  }));

  route('GET', /^\/api\/staff\/lead\/(\d+)$/, caseworkOnly(async (req, res, s, m) => {
    const e = db.enquiryById(Number(m[1]));
    if (!e) return json(res, 404, { error: 'No such enquiry' });
    if (s.role !== 'admin' && e.owner_id && Number(e.owner_id) !== Number(s.id)) {
      return json(res, 403, { error: 'That lead belongs to somebody else' });
    }
    return json(res, 200, {
      lead: leadShape(e, db.leadNoteCounts(), peopleMap()),
      notes: db.leadNotes(e.id).map(n => ({
        id: n.id, who: n.who, kind: n.kind, body: n.body, at: n.created_at,
      })),
    });
  }));

  /* A lead that arrived by phone, or on somebody's personal WhatsApp. It is
     not in the book unless somebody puts it there, and a lead that is not in
     the book is not followed up. */
  route('POST', '/api/staff/leads', caseworkOnly(async (req, res, s) => {
    const b = await readJson(req);
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    const email = String(b.email || '').trim();
    if (!name) return json(res, 422, { error: 'A name, at least.' });
    if (!phone && !email) return json(res, 422, { error: 'A number or an email — otherwise there is no way to call them back.' });
    if (email && !validEmail(email)) return json(res, 422, { error: 'That email address is not valid' });
    if (phone && !validPhone(phone)) return json(res, 422, { error: 'That does not look like an Indian mobile number' });

    const source = SOURCES.has(String(b.source || '').toLowerCase())
      ? String(b.source).toLowerCase() : 'phone';
    const row = db.addEnquiry({
      name, email, phone: phone ? '+91' + tenDigits(phone) : '',
      destination: String(b.destination || '').slice(0, 60),
      consent: 'staff', note: String(b.note || '').trim().slice(0, 400),
      source, campaign: String(b.campaign || '').trim().slice(0, 90),
      sourcePage: 'added by ' + s.name, referrer: '',
      /* Whoever writes it down owns it, unless they say otherwise. A lead
         logged and left unowned is the one that goes cold. */
      ownerId: b.ownerId ? Number(b.ownerId) : s.id,
      status: 'contacted',
    });
    if (row) {
      db.addLeadNote(row.id, s.name, 'added',
        'Added by hand' + (b.note ? ' — ' + String(b.note).trim().slice(0, 300) : ''));
      db.log(s.name, 'logged a lead', name + ' (' + source + ')');
    }
    return json(res, 200, { lead: row ? leadShape(row, db.leadNoteCounts(), peopleMap()) : null });
  }));

  route('PUT', /^\/api\/staff\/lead\/(\d+)$/, caseworkOnly(async (req, res, s, m) => {
    const e = db.enquiryById(Number(m[1]));
    if (!e) return json(res, 404, { error: 'No such enquiry' });
    if (s.role !== 'admin' && e.owner_id && Number(e.owner_id) !== Number(s.id)) {
      return json(res, 403, { error: 'That lead belongs to somebody else' });
    }
    const b = await readJson(req);
    const status = LEAD_STATUS.includes(b.status) ? b.status : (e.status || 'new');
    const reason = status === 'lost'
      ? (LOST_REASONS.includes(b.lostReason) ? b.lostReason : 'other')
      : '';
    /* Lost, and no reason chosen. The list exists so the reasons can be
       counted; free text and a shrug cannot be. */
    if (status === 'lost' && !b.lostReason) {
      return json(res, 422, { error: 'Say why it did not convert — that is the half of this worth recording.' });
    }
    let ownerId = e.owner_id;
    if (b.ownerId !== undefined) {
      ownerId = b.ownerId ? Number(b.ownerId) : null;
      if (ownerId && !db.studentById(ownerId)) return json(res, 404, { error: 'No such person' });
      if (s.role !== 'admin' && ownerId && Number(ownerId) !== Number(s.id)) {
        return json(res, 403, { error: 'Only an administrator can hand a lead to somebody else.' });
      }
    }

    const row = db.updateEnquiry(e.id, {
      source: b.source && SOURCES.has(String(b.source).toLowerCase())
        ? String(b.source).toLowerCase() : (e.source || 'website'),
      campaign: b.campaign !== undefined ? String(b.campaign).slice(0, 90) : (e.campaign || ''),
      ownerId, status, lostReason: reason,
      nextAt: b.nextAt !== undefined ? String(b.nextAt).slice(0, 30) : (e.next_at || ''),
      studentId: e.student_id,
      note: b.note !== undefined ? String(b.note).slice(0, 400) : (e.note || ''),
      destination: b.destination !== undefined
        ? String(b.destination).slice(0, 60) : (e.destination || ''),
    });

    /* What changed, on the thread, so the history reads as a history rather
       than as a field that is different today. */
    const said = [];
    if ((e.status || 'new') !== status) {
      said.push('Moved to ' + status + (reason ? ' (' + reason.replace(/-/g, ' ') + ')' : ''));
    }
    if (Number(e.owner_id || 0) !== Number(ownerId || 0)) {
      const who = ownerId ? (db.studentById(ownerId) || {}).name : 'nobody';
      said.push('Given to ' + who);
    }
    if ((e.next_at || '') !== (row.next_at || '') && row.next_at) {
      said.push('Next follow-up ' + row.next_at);
    }
    if (said.length) db.addLeadNote(e.id, s.name, 'change', said.join('. '));

    return json(res, 200, {
      lead: leadShape(row, db.leadNoteCounts(), peopleMap()),
      notes: db.leadNotes(e.id).map(n => ({
        id: n.id, who: n.who, kind: n.kind, body: n.body, at: n.created_at,
      })),
    });
  }));

  route('POST', /^\/api\/staff\/lead\/(\d+)\/note$/, caseworkOnly(async (req, res, s, m) => {
    const e = db.enquiryById(Number(m[1]));
    if (!e) return json(res, 404, { error: 'No such enquiry' });
    if (s.role !== 'admin' && e.owner_id && Number(e.owner_id) !== Number(s.id)) {
      return json(res, 403, { error: 'That lead belongs to somebody else' });
    }
    const b = await readJson(req);
    const body = String(b.body || '').trim().slice(0, 2000);
    if (!body) return json(res, 422, { error: 'Nothing to record.' });
    const kind = ['call', 'whatsapp', 'email', 'meeting', 'note'].includes(b.kind)
      ? b.kind : 'note';
    db.addLeadNote(e.id, s.name, kind, body);

    /* Writing down what you said to somebody IS contacting them — a lead that
       has a call logged against it is not "new" any more, and leaving it as
       new is how the untouched count lies. */
    const next = {};
    if ((e.status || 'new') === 'new') next.status = 'contacted';
    if (!e.owner_id) next.ownerId = s.id;
    if (Object.keys(next).length) {
      db.updateEnquiry(e.id, Object.assign({
        source: e.source, campaign: e.campaign, ownerId: e.owner_id,
        status: e.status || 'new', lostReason: e.lost_reason, nextAt: e.next_at,
        studentId: e.student_id, note: e.note, destination: e.destination,
      }, next));
    }
    if (b.nextAt !== undefined) {
      const row0 = db.enquiryById(e.id);
      db.updateEnquiry(e.id, {
        source: row0.source, campaign: row0.campaign, ownerId: row0.owner_id,
        status: row0.status, lostReason: row0.lost_reason,
        nextAt: String(b.nextAt).slice(0, 30), studentId: row0.student_id,
        note: row0.note, destination: row0.destination,
      });
    }

    const row = db.enquiryById(e.id);
    return json(res, 200, {
      lead: leadShape(row, db.leadNoteCounts(), peopleMap()),
      notes: db.leadNotes(e.id).map(n => ({
        id: n.id, who: n.who, kind: n.kind, body: n.body, at: n.created_at,
      })),
    });
  }));


  /*
   * A lead becomes a student.
   *
   * This is the moment the business has been waiting for and there was no
   * button for it: a counsellor who talked somebody round had to go to a
   * different screen, retype the name, the email and the number they were
   * looking at, and hope they matched — and the lead stayed sitting in the
   * book as "new" forever, so the conversion rate was always zero.
   *
   * The account is made with a password nobody chose, which opens exactly one
   * thing: the screen that replaces it. The details are emailed. The lead is
   * marked converted and tied to the student, so the two are the same person
   * from here on.
   */
  route('POST', /^\/api\/staff\/lead\/(\d+)\/convert$/, caseworkOnly(async (req, res, s, m) => {
    const e = db.enquiryById(Number(m[1]));
    if (!e) return json(res, 404, { error: 'No such enquiry' });
    if (s.role !== 'admin' && e.owner_id && Number(e.owner_id) !== Number(s.id)) {
      return json(res, 403, { error: 'That lead belongs to somebody else' });
    }
    const b = await readJson(req);
    const name = String(b.name || e.name || '').trim().slice(0, 80);
    const email = String(b.email || e.email || '').trim().toLowerCase();
    const phone = String(b.phone || e.phone || '').replace(/\D/g, '').slice(-10);

    if (!name) return json(res, 422, { error: 'They need a name' });
    if (!validEmail(email)) {
      return json(res, 422, {
        error: 'An account needs an email address — that is what they sign in with. '
             + 'Ask them for one and put it on the lead first.',
      });
    }

    /* Already has an account: tie the lead to it rather than refusing, because
       the person exists either way and two records for one student is worse
       than one that was made twice. */
    let person = db.studentByEmail(email);
    let password = '';
    let made = false;
    if (person) {
      if (person.role !== 'student') {
        return json(res, 409, { error: 'That email address belongs to a staff account.' });
      }
    } else {
      password = newPassword();
      const salt = newSalt();
      person = db.createStudent(email, name, phone ? '+91' + phone : '',
        hashPassword(password, salt), salt, 'student');
      db.setMustChange(person.id, true);
      made = true;
      mail.send(Object.assign({ to: person.email }, EMAILS.credentials({
        name: person.name, email: person.email, password, siteUrl,
        role: 'student', madeBy: s.name,
      }))).catch(() => {});
      /* Any order already filed under that address — somebody who paid on the
         website before anybody talked to them — belongs to this account. */
      try { db.claimOrders(person.id, email); } catch (err) { /* not fatal */ }
      seedMessages(person);
    }

    /* Whoever converted them looks after them, unless an administrator did it,
       in which case the lead's owner does. */
    const owner = s.role === 'counsellor' ? s.id
      : (e.owner_id && (db.studentById(e.owner_id) || {}).role === 'counsellor'
          ? Number(e.owner_id) : null);
    if (owner) { try { db.assignCounsellor(person.id, owner); } catch (err) { /* not fatal */ } }

    const row = db.updateEnquiry(e.id, {
      source: e.source, campaign: e.campaign, ownerId: e.owner_id || s.id,
      status: 'converted', lostReason: '', nextAt: '',
      studentId: person.id, note: e.note, destination: e.destination,
    });
    db.addLeadNote(e.id, s.name, 'converted',
      made ? 'Converted. Account made for ' + email + ' and the sign-in details emailed.'
           : 'Converted. They already had an account on ' + email + '.');
    db.log(s.name, 'converted a lead', name + ' — ' + email);

    return json(res, 200, {
      lead: leadShape(row, db.leadNoteCounts(), peopleMap()),
      notes: db.leadNotes(e.id).map(n => ({
        id: n.id, who: n.who, kind: n.kind, body: n.body, at: n.created_at,
      })),
      student: { id: person.id, name: person.name, email: person.email },
      accountCreated: made,
      /* Shown once, on the screen, because email to a wrong address is the
         normal failure and a counsellor sitting with the student on the phone
         can read it out. */
      password: password || '',
    });
  }));

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

  const FALLBACK_BANDS = [
    { id: 'u10', ceilInr: 1000000 }, { id: 'u20', ceilInr: 2000000 },
    { id: 'above20', ceilInr: 4000000 }, { id: 'elite', ceilInr: null },
  ];

  /** Which budget bucket a fee falls in, by the ceilings the office set. */
  function bandFor(totalInr) {
    let bands = FALLBACK_BANDS;
    try {
      const f = content && content.get('finder');
      if (f && f.bands && f.bands.length) bands = f.bands;
    } catch (e) { /* fall back rather than refuse to save a programme */ }
    const fee = Math.max(0, Number(totalInr) || 0);
    for (const b of bands) {
      if (b.ceilInr == null) return b.id;      // the top band takes the rest
      if (fee <= b.ceilInr) return b.id;
    }
    return bands[bands.length - 1].id;
  }

  /**
   * Put every programme back in the right bucket.
   *
   * Called when the ceilings change. Without it a new boundary applies only to
   * programmes edited afterwards, so the filter would show a mix of the old
   * rule and the new one — which is harder to notice, and harder to explain,
   * than it simply not working.
   */
  function rebandAll(who) {
    let moved = 0;
    db.programmes(true).forEach(r => {
      const want = bandFor(r.total_inr);
      if (want === r.band) return;
      db.saveProgramme({
        id: r.id, program: r.program, university: r.university, city: r.city,
        country: r.country, level: r.level, field: r.field, band: want,
        isPublic: !!r.is_public, fit: r.fit, totalInr: r.total_inr, url: r.url,
        active: !!r.active, featured: !!r.featured, featureSort: r.feature_sort || 0,
        intakes: (() => { try { return JSON.parse(r.intakes) || []; } catch (e) { return []; } })(),
      }, who);
      moved++;
    });
    return moved;
  }

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
       ₹30 lakh course in the "under ₹10L" bucket.

       The ceilings come from the Finder tab rather than from three numbers
       written here, because otherwise editing them changes a label and nothing
       else — the buckets would keep their old boundaries and the screen would
       be lying about what it does. */
    if (!out.band) out.band = bandFor(out.totalInr);
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

  const CONTENT_KEYS = ['packages', 'stats', 'faq', 'testimonials', 'services', 'finder',
    'legal'];
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

  route('PUT', /^\/api\/staff\/content\/(packages|stats|faq|testimonials|services|finder|legal)$/,
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
      /* The finder block is an object of settings, not a list. Counting it the
         way the lists are counted gives undefined, which reads as empty, and
         the guard against blanking a section would refuse every save. */
      /* `legal` is an object of particulars, like `finder`, and an EMPTY one is
         a legitimate save — clearing a CIN that was typed wrong is a thing
         somebody will do at 11pm. Counting its keys would refuse exactly that. */
      const n = key === 'finder' || key === 'legal' ? 1
        : grouped ? ((value && value.items) || []).length : (value || []).length;
      if (!n && !YES(b && b.allowEmpty)) {
        return json(res, 422, {
          error: 'That would leave the ' + key + ' section of the home page with nothing in it. '
               + 'If that is what you want, remove the section instead.',
        });
      }

      const saved = content.save(key, value, s.name);
      const count = key === 'finder' ? (saved.bands || []).length
        : key === 'legal' ? Object.keys(saved).length
        : grouped ? saved.items.length : saved.length;

      let moved = 0;
      if (key === 'finder') moved = rebandAll(s.name);

      db.log(s.name, 'home page — ' + key + ' edited',
        count + ' now on the page' + (moved ? ', ' + moved + ' programmes re-banded' : ''));
      return json(res, 200, { saved, count, moved });
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

  /* ---------------------------------------------------------------- blog */
  /*
   * Writing and publishing, without a developer.
   *
   * The six posts on the site today are static HTML files with a headline, a
   * lead paragraph and a note to ourselves where the article should be. The
   * office cannot write a seventh, cannot finish any of the six, and cannot
   * correct a fee that changed — the only route is a text editor and a deploy.
   *
   * The SEO fields sit on the same form as the words, because that is the only
   * way they get filled in. A separate "SEO settings" screen is a screen
   * nobody opens.
   */

  const postShape = (p, full) => {
    const o = {
      id: p.id, slug: p.slug, title: p.title,
      excerpt: p.excerpt || '', tag: p.tag || '', author: p.author || '',
      status: p.status, readMins: p.read_mins || 0,
      publishedAt: p.published_at || '', updatedAt: p.updated_at,
      updatedBy: p.updated_by || '', cover: p.cover || '',
      metaTitle: p.meta_title || '', metaDesc: p.meta_desc || '',
      keywords: p.keywords || '', ogImage: p.og_image || '',
      words: String(p.body || '').trim().split(/\s+/).filter(Boolean).length,
    };
    if (full) { o.body = p.body || ''; o.html = PROSE.render(p.body); }
    return o;
  };

  /* What a visitor may read. Published, and with something in it — a post with
     an empty body is a headline with a URL, which is worse than no post. */
  route('GET', '/api/posts', async (req, res) => json(res, 200, {
    posts: db.livePosts().map(p => postShape(p, false)),
  }), { open: true });

  route('GET', /^\/api\/posts\/([a-z0-9-]{1,90})$/, async (req, res, s, m) => {
    const p = db.postBySlug(m[1]);
    /* A draft is readable by the person writing it and by nobody else, which
       is what makes Preview honest — it is the same renderer and the same
       route, so what they see is what gets published. */
    const staff = me(req);
    const mayPreview = staff && staff.role !== 'student';
    if (!p || (p.status !== 'published' && !mayPreview)) {
      return json(res, 404, { error: 'No such post' });
    }
    return json(res, 200, { post: postShape(p, true), draft: p.status !== 'published' });
  }, { open: true, soft: true });

  /* ---- and the side that writes them ---- */

  route('GET', '/api/staff/posts', needs('content', async (req, res) => json(res, 200, {
    posts: db.allPosts().map(p => postShape(p, false)),
  })));

  route('GET', /^\/api\/staff\/post\/(\d+)$/, needs('content', async (req, res, s, m) => {
    const p = db.postById(Number(m[1]));
    if (!p) return json(res, 404, { error: 'No such post' });
    return json(res, 200, { post: postShape(p, true) });
  }));

  /* One shape for save and for publish: the status is a field on the form, not
     a different endpoint, so "publish" cannot mean something the save did not
     see. */
  const readPost = async (req, s, existing) => {
    const b = await readJson(req);
    const title = String(b.title || '').trim().slice(0, 180);
    const body = String(b.body || '');
    const wants = b.status === 'published' ? 'published' : 'draft';

    if (!title) return { error: 'A post needs a headline.' };
    if (wants === 'published' && !body.trim()) {
      return { error: 'There is nothing in the body. A published post with no words is a '
        + 'headline with a URL on it.' };
    }

    let slug = PROSE.slugify(b.slug || title);
    const clash = db.postBySlug(slug);
    if (clash && (!existing || clash.id !== existing.id)) {
      /* Two posts cannot share an address. Rather than refuse and make somebody
         invent one, take the next one along. */
      let n = 2;
      while (db.postBySlug(slug + '-' + n)) n++;
      slug = slug + '-' + n;
    }

    const excerpt = String(b.excerpt || '').trim() || PROSE.summarise(body, 200);
    return {
      post: {
        slug, title, body, excerpt,
        cover: String(b.cover || '').trim().slice(0, 400),
        author: String(b.author || s.name || '').trim().slice(0, 90),
        tag: String(b.tag || '').trim().slice(0, 60),
        status: wants,
        /* Empty is not a mistake to refuse — it is the common case, and the
           right answer is the headline and the first two sentences rather than
           an empty <title> or a description Google writes for us. */
        metaTitle: String(b.metaTitle || '').trim().slice(0, 200),
        metaDesc: String(b.metaDesc || '').trim().slice(0, 320),
        keywords: String(b.keywords || '').split(',').map(x => x.trim())
          .filter(Boolean).slice(0, 25).join(', '),
        ogImage: String(b.ogImage || '').trim().slice(0, 400),
        readMins: PROSE.readingMinutes(body),
        publishedAt: wants === 'published'
          ? ((existing && existing.published_at) || new Date().toISOString())
          : (existing ? existing.published_at || '' : ''),
        updatedBy: s.name,
      },
    };
  };

  route('POST', '/api/staff/posts', needs('content', async (req, res, s) => {
    const r = await readPost(req, s, null);
    if (r.error) return json(res, 422, { error: r.error });
    const row = db.addPost(r.post);
    db.log(s.name, r.post.status === 'published' ? 'published a post' : 'started a post',
      r.post.title);
    return json(res, 200, { post: postShape(row, true) });
  }));

  route('PUT', /^\/api\/staff\/post\/(\d+)$/, needs('content', async (req, res, s, m) => {
    const was = db.postById(Number(m[1]));
    if (!was) return json(res, 404, { error: 'No such post' });
    const r = await readPost(req, s, was);
    if (r.error) return json(res, 422, { error: r.error });
    const row = db.updatePost(was.id, r.post);
    db.log(s.name,
      was.status !== 'published' && r.post.status === 'published' ? 'published a post'
        : r.post.status === 'published' ? 'edited a live post' : 'saved a draft',
      r.post.title);
    return json(res, 200, { post: postShape(row, true) });
  }));

  route('DELETE', /^\/api\/staff\/post\/(\d+)$/, needs('content', async (req, res, s, m) => {
    const p = db.postById(Number(m[1]));
    if (!p) return json(res, 404, { error: 'No such post' });
    /* A published post has an address people have shared and Google has
       indexed. Taking it off the site is unpublishing; deleting the row is only
       for something that was never live. */
    if (p.status === 'published') {
      db.updatePost(p.id, Object.assign(postShape(p, true), {
        status: 'draft', body: p.body, updatedBy: s.name,
      }));
      db.log(s.name, 'took a post off the site', p.title);
      return json(res, 200, { unpublished: true, posts: db.allPosts().map(x => postShape(x, false)) });
    }
    db.deletePost(p.id);
    db.log(s.name, 'deleted a draft', p.title);
    return json(res, 200, { deleted: true, posts: db.allPosts().map(x => postShape(x, false)) });
  }));

  /* -------------------------------------------------------------- alerts */
  /*
   * What needs doing, and who it needs doing by.
   *
   * Four things went wrong quietly and none of them was visible anywhere: a
   * deadline arriving, a counsellor going silent on a student, a profile that
   * stays half-empty and blocks the visa, and a follow-up somebody promised
   * and forgot. Every one of them was found out about by being told.
   *
   * Computed on read. An alert is a fact about the data — "this deadline is in
   * six days" — and a stored copy of a fact is a copy that is wrong the moment
   * somebody uploads the document.
   */
  route('GET', '/api/staff/alerts', caseworkOnly(async (req, res, s) => {
    const list = ALERTS.forStaff(db, s);
    return json(res, 200, {
      alerts: list.slice(0, 200),
      counts: ALERTS.counts(list),
      /* An administrator is answerable for the counsellors, so the split by
         person is theirs — it is the only view that shows a counsellor with
         nine unanswered students. */
      byPerson: s.role === 'admin'
        ? Object.values(list.reduce((m, a) => {
            const k = String(a.who || 'nobody');
            if (!m[k]) {
              const p = a.who ? db.studentById(a.who) : null;
              m[k] = { id: a.who || null, name: p ? p.name : 'Nobody assigned', now: 0, total: 0 };
            }
            m[k].total++;
            if (a.urgency === 'now') m[k].now++;
            return m;
          }, {})).sort((x, y) => y.now - x.now || y.total - x.total)
        : [],
    });
  }));

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

        /*
         * A password somebody else chose opens nothing but the door to changing
         * it.
         *
         * Enforced here rather than by showing a screen, because a screen is a
         * suggestion — the API underneath it would still answer. Until the flag
         * is cleared this account can change its password, read who it is, and
         * sign out. Nothing else.
         */
        if (s.must_change && !CHANGE_ALLOWED.has(pathname)) {
          json(res, 403, {
            error: 'Choose your own password before you go any further.',
            mustChange: true,
          });
          return true;
        }
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
