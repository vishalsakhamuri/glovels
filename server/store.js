'use strict';
/**
 * Storage.
 *
 * Student data lives in a real database on disk — `glovels.db` next to the
 * server — not in the browser. Clearing your browser, switching browsers or
 * reinstalling the machine does not lose a student's profile, documents or
 * shortlist, which is the whole point of the change.
 *
 * Two drivers, one interface:
 *
 *   sqlite  Node 22.5+ ships `node:sqlite`. Real SQL, real tables, real
 *           foreign keys. This is what runs on any current Node.
 *   json    Older Node has no SQLite and no way to get one without a native
 *           module. Rather than refuse to start, the same tables are held as
 *           arrays in one file, written atomically (write to a temp file, then
 *           rename — a rename is atomic on macOS, so a crash mid-write leaves
 *           the previous good file rather than half of a new one).
 *
 * The API layer never learns which one it got. Moving to MySQL on the live host
 * means writing a third driver against this same interface — every query the
 * application makes is in this file.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  phone       TEXT,
  pass_hash   TEXT NOT NULL,
  pass_salt   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'student',
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  student_id  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  student_id  INTEGER PRIMARY KEY,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shortlist (
  student_id  INTEGER NOT NULL,
  prog_id     TEXT NOT NULL,
  program     TEXT,
  university  TEXT,
  city        TEXT,
  country     TEXT,
  total_inr   INTEGER,
  is_public   INTEGER,
  url         TEXT,
  intakes     TEXT,
  fit         INTEGER,
  added_at    TEXT NOT NULL,
  PRIMARY KEY (student_id, prog_id)
);
CREATE TABLE IF NOT EXISTS applications (
  student_id  INTEGER NOT NULL,
  prog_id     TEXT NOT NULL,
  stage       INTEGER NOT NULL DEFAULT 0,
  outcome     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (student_id, prog_id)
);
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL,
  doc_key     TEXT NOT NULL,
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'wait',
  uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL,
  sender      TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  file        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_scholarships (
  student_id  INTEGER NOT NULL,
  sch_id      TEXT NOT NULL,
  saved_at    TEXT NOT NULL,
  PRIMARY KEY (student_id, sch_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER,
  reference   TEXT NOT NULL UNIQUE,
  package     TEXT NOT NULL,
  public_unis INTEGER NOT NULL DEFAULT 0,
  gross_paise INTEGER NOT NULL DEFAULT 0,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'paid',
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enquiries (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL,
  destination TEXT,
  consent     TEXT,
  source_page TEXT,
  referrer    TEXT,
  created_at  TEXT NOT NULL
);
/* What was said to a lead, and when.
   "How many follow-ups have we done" is the question the office actually
   asks, and it cannot be answered by a status field — a status says where
   something got to, not how much work went into getting it there. One row per
   call, message or note, so the count is real. */
/* An administrator's word to a counsellor about one student.
   NOT a message — a message is something the student can read, and the whole
   point of this is that they cannot. It is a separate table rather than a
   sender value on the messages table because "remember to filter this one out"
   is a rule that gets forgotten exactly once, and the thing that leaks is a
   manager telling somebody their tone was wrong. */
CREATE TABLE IF NOT EXISTS staff_notes (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL,
  from_id     INTEGER NOT NULL,
  to_id       INTEGER,
  body        TEXT NOT NULL,
  seen        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lead_notes (
  id          INTEGER PRIMARY KEY,
  lead_id     INTEGER NOT NULL,
  who         TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'note',
  body        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS programmes (
  id          TEXT PRIMARY KEY,
  program     TEXT NOT NULL,
  university  TEXT NOT NULL,
  city        TEXT,
  country     TEXT NOT NULL,
  level       TEXT,
  field       TEXT,
  band        TEXT,
  is_public   INTEGER NOT NULL DEFAULT 1,
  fit         INTEGER,
  /* The CGPA this programme asks for, on 10. NULL means it has not been
     stated, and the country's rule applies instead. */
  min_cgpa    REAL,
  total_inr   INTEGER NOT NULL DEFAULT 0,
  url         TEXT,
  intakes     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
CREATE TABLE IF NOT EXISTS countries (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  flag        TEXT,
  region      TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 100,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY,
  who         TEXT NOT NULL,
  what        TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);
/* The home page's own words and numbers — packages, the headline figures, the
   FAQ, the testimonials. One row per block, the value a JSON document, because
   the shape of a package is going to change and a column per field would mean
   a migration every time somebody wants a new line on a card. */
CREATE TABLE IF NOT EXISTS content (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  who         TEXT,
  updated_at  TEXT NOT NULL
);
/* A blog post.
 *
 * The six posts on glovels.com today are static HTML with a headline, a lead
 * paragraph and a note to ourselves where the article should be. Nobody
 * without a text editor and a deploy can write one, which is the same as
 * saying nobody can.
 *
 * The SEO fields are columns rather than a JSON blob because they are the
 * point: the title Google prints, the sentence under it, the words we are
 * trying to rank for, and the picture that shows when the link is pasted into
 * WhatsApp. A writer who has to open a second screen to fill them in does not
 * fill them in.
 */
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT,
  body         TEXT,
  cover        TEXT,
  author       TEXT,
  tag          TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  meta_title   TEXT,
  meta_desc    TEXT,
  keywords     TEXT,
  og_image     TEXT,
  read_mins    INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT PRIMARY KEY,
  student_id  INTEGER NOT NULL,
  expires_at  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
/* A draft the SOP/LOR studio wrote. Kept because a student who writes one at
   eleven at night expects it to be there in the morning, and because the
   counsellor doing the paid rewrite should not have to ask them to paste it. */
CREATE TABLE IF NOT EXISTS drafts (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  programme   TEXT NOT NULL DEFAULT '',
  university  TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
/* A conversation with somebody who is not signed in.
   The chat box on the marketing site is the first thing a visitor uses and the
   last place they should be asked to make an account. A chat is identified by a
   random token in a cookie, carries the name and number they gave, and is a
   lead the moment it starts — which is why it is a table of its own rather than
   a shell student record polluting the caseload. */
CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  page        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  student_id  INTEGER,
  created_at  TEXT NOT NULL,
  last_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY,
  chat_id     INTEGER NOT NULL,
  sender      TEXT NOT NULL,
  body        TEXT NOT NULL,
  who         TEXT NOT NULL DEFAULT '',
  seen_staff  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chatmsg_chat   ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_drafts_student  ON drafts(student_id);
CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_docs_student    ON documents(student_id);
CREATE INDEX IF NOT EXISTS idx_msgs_student    ON messages(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_email    ON orders(email);
`;

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ sqlite */

function sqliteDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');   // survives a hard kill mid-write
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  /* Columns added after the first release. CREATE TABLE IF NOT EXISTS does not
     add a column to a table that already exists, so an existing database would
     silently keep the old shape and fail on the first query that used the new
     one. ALTER TABLE throws when the column is already there — which is the
     signal that this migration has run. */
  ['ALTER TABLE students ADD COLUMN counsellor_id INTEGER',
   'ALTER TABLE messages ADD COLUMN read_by_student INTEGER NOT NULL DEFAULT 0',
   'ALTER TABLE messages ADD COLUMN read_by_staff INTEGER NOT NULL DEFAULT 0',
   /* What this person is allowed to change, beyond their own students: a
      comma-separated list of `catalogue` and `content`. Empty for everyone
      until an administrator ticks a box, because "every counsellor can edit
      the prices on the home page" is not a permission model. */
   "ALTER TABLE students ADD COLUMN perms TEXT NOT NULL DEFAULT ''",
   /* Which programmes lead the showcase on the home page, and in what order.
      Chosen on the Catalogue screen. Nothing featured means the grid falls
      back to cheapest-first, which is what it always did. */
   /* The CGPA a student needs for THIS programme, on 10.
      The finder has always preferred a programme's own cut-off over the
      country's — the code reads `p.minCgpa` and falls back to the country rule
      — but the column never existed, so the preference could never fire and
      every programme in a country shared one bar. That is wrong at the level
      it matters: a student with 6.8 is turned away from a whole country when a
      dozen of its universities would have taken them.
      NULL means "not stated", which is different from 0 and is what makes the
      country rule apply. */
   'ALTER TABLE programmes ADD COLUMN min_cgpa REAL',
   'ALTER TABLE programmes ADD COLUMN featured INTEGER NOT NULL DEFAULT 0',
   'ALTER TABLE programmes ADD COLUMN feature_sort INTEGER NOT NULL DEFAULT 0',
   /* The entry requirements a visitor reads before deciding to pay: minimum
      CGPA, the funds to show, accepted tests, work rights, the document list.
      One JSON column rather than thirteen, because the list of facts a country
      cares about changes and a migration per fact is how it stops being kept
      up to date. */
   "ALTER TABLE countries ADD COLUMN facts TEXT NOT NULL DEFAULT ''",
   /* What was actually bought, as JSON. An order used to be one package and a
      total; the a-la-carte services never became an order at all, so a student
      who bought four of them signed in to an empty dashboard. */
   "ALTER TABLE orders ADD COLUMN items TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'package'",
   /* The gateway's own identifiers. Kept because a refund, a chargeback or a
      reconciliation against a Razorpay settlement report is done by THEIR id —
      our reference means nothing at their end. */
   "ALTER TABLE orders ADD COLUMN gateway_order_id TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE orders ADD COLUMN gateway_payment_id TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE orders ADD COLUMN paid_at TEXT NOT NULL DEFAULT ''",
   /* A password somebody else chose is a password that has been read aloud, or
      typed into WhatsApp, or left sitting in an inbox. It gets one use: this
      flag makes the account refuse to do anything until its owner replaces it. */
   "ALTER TABLE students ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0",
   /* What this enquiry is about, in the enquirer's own terms — which programme
      at which university they pressed Apply on. A lead that says only "someone
      from Hyderabad" is a lead the counsellor has to start from nothing. */
   "ALTER TABLE enquiries ADD COLUMN note TEXT NOT NULL DEFAULT ''",
   /* What the student accepted, and when, as one JSON document.
      Not a boolean. "They ticked a box" is evidence of nothing a year later,
      when the terms have been reworded twice — the record has to carry the
      words that were on the screen, the documents as they read that day, and
      a fingerprint that shows neither has been edited since. */
   "ALTER TABLE orders ADD COLUMN accepted TEXT NOT NULL DEFAULT ''",
   /* The instalments, as JSON, and what has actually been received.
      A schedule is not a property of the package — it is a property of THIS
      order, agreed at the checkout and then chased for months, so it has to be
      stored rather than recomputed from a price that may have changed twice by
      the time the last part is collected. */
   "ALTER TABLE orders ADD COLUMN plan TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE orders ADD COLUMN paid_paise INTEGER NOT NULL DEFAULT 0",
   /* WHICH package was bought, not just what it was called at the time.
      An order recorded the package's title, which is editable on the Home page
      screen — so an office that renames "Roadmap" loses the only link between
      an order and the thing it bought. Nothing needed that link until the
      entry tiers arrived, where what a student is owed (three matched
      universities, or ten) is a property of the package and has to be read
      back months later. */
   "ALTER TABLE orders ADD COLUMN package_id TEXT NOT NULL DEFAULT ''",
   /* Where the lead came from — a Facebook ad, a WhatsApp message, a Google
      search, the chat box, a blog post, or somebody who walked in. Every
      enquiry landed in one undifferentiated list, so "which of these is
      working" had no answer at all. Detected from the page and the referrer
      where it can be, set by hand where it cannot. */
   "ALTER TABLE enquiries ADD COLUMN source TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE enquiries ADD COLUMN campaign TEXT NOT NULL DEFAULT ''",
   /* Whose it is, where it got to, and why it stopped. A lead nobody owns is a
      lead nobody calls. */
   "ALTER TABLE enquiries ADD COLUMN owner_id INTEGER",
   "ALTER TABLE enquiries ADD COLUMN status TEXT NOT NULL DEFAULT 'new'",
   "ALTER TABLE enquiries ADD COLUMN lost_reason TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE enquiries ADD COLUMN next_at TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE enquiries ADD COLUMN student_id INTEGER",
   "ALTER TABLE enquiries ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
   /* Who put this university on the list.
    *
    * One list conflated two different things: what the student liked the look
    * of while browsing, and what their counsellor agreed with them and is
    * going to apply to. They are not the same list and they do not carry the
    * same weight — the second is what the package delivered and what a
    * guarantee attaches to.
    *
    * Defaults to 'office' rather than 'student', because every row that
    * already exists was written either by the purchase match or by a
    * counsellor. Calling those 'student' would move somebody's real shortlist
    * into a list of idle interest. */
   "ALTER TABLE shortlist ADD COLUMN added_by TEXT NOT NULL DEFAULT 'office'",
   /* One row per device a member of staff has allowed notifications on. The
      endpoint is the identity — a browser that rotates a subscription gives us
      a new endpoint, and the old one starts returning 410, which is how dead
      ones get cleaned up. */
   `CREATE TABLE IF NOT EXISTS push_subs (
      endpoint    TEXT PRIMARY KEY,
      staff_id    INTEGER NOT NULL,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      agent       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    )`,
   /* Where a student is in their life with us.
    *
    *   active     on the books
    *   completed  the services were delivered and there is nothing left to do
    *   left       they stopped part-way
    *
    * It is one column and it decides three things: whether they can sign in,
    * whether they are in a counsellor's caseload, and — the one that matters to
    * the office — whether money still owed is PENDING or LOST. Those two are
    * the same number until somebody says which it is, and nobody ever does
    * unless the screen asks. */
   "ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
   "ALTER TABLE students ADD COLUMN closed_at TEXT NOT NULL DEFAULT ''",
   "ALTER TABLE students ADD COLUMN close_note TEXT NOT NULL DEFAULT ''",
   "CREATE INDEX IF NOT EXISTS idx_push_staff ON push_subs(staff_id)",
   "CREATE INDEX IF NOT EXISTS idx_lead_notes ON lead_notes(lead_id)",
   /* After the ALTERs, not in the schema above: the schema runs first, and an
      index on a column that does not exist yet fails on every fresh database. */
   /* The agency that introduced this student, and it never changes.
      DELIBERATELY separate from counsellor_id: a partner is not a replacement
      for a Glovels counsellor, it is who the student came from. A
      partner-sourced student has both, and anything that collapses the two
      into one field will have to be undone the first time a partner sends
      somebody Glovels has to work on directly. */
   'ALTER TABLE students ADD COLUMN partner_id INTEGER',
   /* A partner's own mark, shown in their portal in place of the Glovels one.
      Held as a data URL rather than a file so there is no second upload path
      to authorise, and capped small — this is a logo, not an asset library. */
   "ALTER TABLE students ADD COLUMN logo TEXT NOT NULL DEFAULT ''",
   "CREATE INDEX IF NOT EXISTS idx_students_partner ON students(partner_id)",
   "CREATE INDEX IF NOT EXISTS idx_orders_gateway ON orders(gateway_order_id)",
  ].forEach(sql => { try { db.exec(sql); } catch (e) { /* already applied */ } });

  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a) || null;
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  return { kind: 'sqlite', all, one, run, close: () => db.close() };
}

/* -------------------------------------------------------------------- json */
/* A tiny query layer over arrays. It understands only the handful of shapes
   this application actually issues — deliberately, because a general SQL
   interpreter here would be a much bigger thing to get wrong. */

function jsonDriver(file) {
  const TABLES = ['students', 'sessions', 'profiles', 'shortlist', 'applications',
    'documents', 'messages', 'saved_scholarships', 'orders', 'enquiries',
    'password_resets', 'programmes', 'countries', 'audit', 'content', 'drafts',
    'chats', 'chat_messages', 'posts', 'lead_notes', 'staff_notes'];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    data = {};
  }
  TABLES.forEach(t => { if (!Array.isArray(data[t])) data[t] = []; });
  if (typeof data._seq !== 'number') data._seq = 0;

  function flush() {
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);              // on disk, not just in the OS cache
    fs.closeSync(fd);
    fs.renameSync(tmp, file);      // atomic: readers see old or new, never half
  }

  // "SELECT ... FROM t WHERE a = ? AND b = ?" is all we need to parse.
  function parse(sql) {
    const m = /(?:from|into|update|delete\s+from)\s+([a-z_]+)/i.exec(sql);
    const table = m ? m[1] : null;
    const wm = /where\s+(.+?)(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+\d+)?\s*$/is.exec(sql);
    const cols = wm ? [...wm[1].matchAll(/([a-z_]+)\s*=\s*\?/gi)].map(x => x[1]) : [];
    const order = wm && wm[2] ? wm[2].trim() : null;
    return { table, cols, order };
  }
  const match = (row, cols, args) => cols.every((c, i) => String(row[c]) === String(args[i]));
  function sorted(rows, order) {
    if (!order) return rows;
    const [col, dir] = order.split(/\s+/);
    const s = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0));
    return /desc/i.test(dir || '') ? s.reverse() : s;
  }

  function all(sql, ...args) {
    const { table, cols, order } = parse(sql);
    return sorted(data[table].filter(r => match(r, cols, args)), order);
  }
  const one = (sql, ...args) => all(sql, ...args)[0] || null;

  function run(sql, ...args) {
    const s = sql.trim();
    const { table, cols } = parse(s);

    if (/^insert/i.test(s)) {
      const names = /\(([^)]+)\)\s*values/i.exec(s)[1].split(',').map(x => x.trim());
      const row = {};
      names.forEach((n, i) => { row[n] = args[i]; });
      if (!('id' in row) && table !== 'profiles' && table !== 'shortlist'
          && table !== 'applications' && table !== 'saved_scholarships'
          && table !== 'password_resets' && table !== 'sessions'
          && table !== 'programmes' && table !== 'countries'
          && table !== 'content') {
        row.id = ++data._seq;
      }
      // INSERT OR REPLACE / ON CONFLICT: drop any row with the same key first
      if (/or\s+replace|on\s+conflict/i.test(s)) {
        const keys = {profiles: ['student_id'], shortlist: ['student_id', 'prog_id'],
          applications: ['student_id', 'prog_id'], saved_scholarships: ['student_id', 'sch_id'],
          password_resets: ['token'], programmes: ['id'], countries: ['code'],
          content: ['key']}[table];
        if (keys) data[table] = data[table].filter(r => !keys.every(k => String(r[k]) === String(row[k])));
      }
      data[table].push(row);
      flush();
      return { lastInsertRowid: row.id, changes: 1 };
    }

    if (/^update/i.test(s)) {
      const setPart = /set\s+(.+?)\s+where/is.exec(s)[1];
      const setCols = [...setPart.matchAll(/([a-z_]+)\s*=\s*\?/gi)].map(x => x[1]);
      const setArgs = args.slice(0, setCols.length);
      const whereArgs = args.slice(setCols.length);
      let n = 0;
      data[table].forEach(r => {
        if (match(r, cols, whereArgs)) {
          setCols.forEach((c, i) => { r[c] = setArgs[i]; });
          n++;
        }
      });
      flush();
      return { changes: n };
    }

    if (/^delete/i.test(s)) {
      const before = data[table].length;
      data[table] = data[table].filter(r => !match(r, cols, args));
      flush();
      return { changes: before - data[table].length };
    }

    throw new Error('json driver cannot run: ' + s.slice(0, 60));
  }

  return { kind: 'json', all, one, run, close: flush };
}

/* ------------------------------------------------------------------ facade */

function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let db;
  try {
    db = sqliteDriver(path.join(dir, 'glovels.db'));
  } catch (e) {
    db = jsonDriver(path.join(dir, 'glovels-data.json'));
  }

  return {
    kind: db.kind,
    close: db.close,

    /* ---- students ---- */
    createStudent(email, name, phone, hash, salt, role) {
      const r = db.run(
        `INSERT INTO students (email, name, phone, pass_hash, pass_salt, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        email.toLowerCase(), name, phone || '', hash, salt, role || 'student', now());
      return this.studentById(Number(r.lastInsertRowid));
    },
    studentByEmail: e => db.one('SELECT * FROM students WHERE email = ?', String(e).toLowerCase()),
    studentById:    id => db.one('SELECT * FROM students WHERE id = ?', Number(id)),
    updateStudent(id, name, phone) {
      db.run('UPDATE students SET name = ?, phone = ? WHERE id = ?', name, phone, Number(id));
    },
    /* Permissions are a set, stored as a sorted comma-separated string so the
       same set is always the same string — which makes "did this change?"
       answerable without parsing. An administrator is not consulted: they have
       everything, and storing that would mean it could be taken away by an
       UPDATE that forgot to check. */
    setPerms(id, perms) {
      const clean = [...new Set((Array.isArray(perms) ? perms : String(perms || '').split(','))
        .map(x => String(x).trim().toLowerCase())
        .filter(x => x === 'catalogue' || x === 'content'))].sort().join(',');
      db.run('UPDATE students SET perms = ? WHERE id = ?', clean, Number(id));
      return clean;
    },
    permsOf(person) {
      if (!person) return [];
      if (person.role === 'admin') return ['catalogue', 'content'];
      return String(person.perms || '').split(',').map(x => x.trim()).filter(Boolean);
    },
    setRole(id, role) {
      db.run('UPDATE students SET role = ? WHERE id = ?', String(role), Number(id));
      return this.studentById(id);
    },
    /* How many administrators exist. Asked before demoting one: an organisation
       with no admin cannot assign a counsellor, cannot add a counsellor, and
       cannot make itself an admin again. There is no way back from that except
       editing the database by hand. */
    countAdmins: () => db.all("SELECT * FROM students WHERE role = ?", 'admin').length,

    /* ---- sessions ---- */
    createSession(token, studentId, days = 30) {
      const exp = new Date(Date.now() + days * 864e5).toISOString();
      db.run('INSERT INTO sessions (token, student_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        token, Number(studentId), now(), exp);
    },
    sessionStudent(token) {
      if (!token) return null;
      const s = db.one('SELECT * FROM sessions WHERE token = ?', token);
      if (!s) return null;
      if (new Date(s.expires_at) < new Date()) { this.dropSession(token); return null; }
      const who = this.studentById(s.student_id);
      /* A file closed while somebody was signed in. The sessions are dropped at
         the moment of closing, but a cookie can outlive a restore from backup or
         a race with a request already in flight — and "closed" has to mean
         closed on every path, not on the one we remembered to change. */
      if (who && who.role === 'student' && (who.status || 'active') !== 'active') {
        this.dropSession(token);
        return null;
      }
      return who;
    },
    dropSession: t => db.run('DELETE FROM sessions WHERE token = ?', t),

    /* Every session one person has open. Closing a file that leaves the account
       signed in somewhere is not closing it. */
    dropSessions: studentId =>
      db.run('DELETE FROM sessions WHERE student_id = ?', Number(studentId)),

    /* ---- profile ---- */
    getProfile(studentId) {
      const r = db.one('SELECT * FROM profiles WHERE student_id = ?', Number(studentId));
      if (!r) return {};
      try { return JSON.parse(r.data); } catch (e) { return {}; }
    },
    putProfile(studentId, obj) {
      db.run(`INSERT OR REPLACE INTO profiles (student_id, data, updated_at) VALUES (?, ?, ?)`,
        Number(studentId), JSON.stringify(obj || {}), now());
    },

    /* ---- shortlist ---- */
    getShortlist: id => db.all('SELECT * FROM shortlist WHERE student_id = ? ORDER BY added_at asc', Number(id)),
    /**
     * `by` is 'student', 'matched' or 'office'.
     *
     * INSERT OR REPLACE, so a student marking interest in something their
     * counsellor already shortlisted would demote it to interest. So the
     * stronger claim wins, and there are three of them now:
     *
     *   office   a counsellor put it there, and nothing may demote it
     *   matched  the machine picked it for a package they bought
     *   student  they pressed the button themselves
     *
     * A counsellor confirming one of the machine's picks promotes it, which is
     * exactly what confirming means. The machine re-running over a university
     * a counsellor has already agreed does not demote it back.
     */
    addShortlist(studentId, p, by) {
      const existing = db.all(
        'SELECT added_by FROM shortlist WHERE student_id = ? AND prog_id = ?',
        Number(studentId), String(p.id))[0];
      const RANK = { student: 1, matched: 2, office: 3 };
      const want = RANK[by] ? by : 'office';
      const prior = existing && existing.added_by;
      const owner = prior && (RANK[prior] || 0) > RANK[want] ? prior : want;
      db.run(`INSERT OR REPLACE INTO shortlist
        (student_id, prog_id, program, university, city, country, total_inr, is_public, url, intakes, fit, added_at, added_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        Number(studentId), String(p.id), p.program || '', p.university || '', p.city || '',
        p.country || '', Number(p.totalInr || 0), p.isPublic ? 1 : 0, p.url || '',
        JSON.stringify(p.intakes || []), Number(p.fit || 0), now(), owner);
    },
    removeShortlist: (studentId, progId) =>
      db.run('DELETE FROM shortlist WHERE student_id = ? AND prog_id = ?', Number(studentId), String(progId)),

    /* Every programme id any student has shortlisted or applied to, as one set.
       Deleting one of these blanks out that student's shortlist card and their
       application, so it is hidden instead. Asking per programme meant reading
       every student's shortlist once per row — fine for one delete, useless for
       two hundred. */
    programmesInUse() {
      const s = new Set();
      db.all('SELECT DISTINCT prog_id FROM shortlist').forEach(r => s.add(String(r.prog_id)));
      db.all('SELECT DISTINCT prog_id FROM applications').forEach(r => s.add(String(r.prog_id)));
      return s;
    },

    /* ---- the visitor chat ---- */
    chatByToken: t => db.one('SELECT * FROM chats WHERE token = ?', String(t)),
    chatById: id => db.one('SELECT * FROM chats WHERE id = ?', Number(id)),
    createChat(token, d) {
      const t = now();
      db.run(`INSERT INTO chats (token, name, phone, email, page, status, student_id, created_at, last_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
        String(token), String(d.name || ''), String(d.phone || ''), String(d.email || ''),
        String(d.page || ''), d.studentId == null ? null : Number(d.studentId), t, t);
      return db.one('SELECT * FROM chats WHERE token = ?', String(token));
    },
    chatMessages: id => db.all('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id asc', Number(id)),
    addChatMessage(chatId, sender, body, who) {
      db.run(`INSERT INTO chat_messages (chat_id, sender, body, who, seen_staff, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
        Number(chatId), String(sender), String(body), String(who || ''),
        sender === 'them' ? 1 : 0, now());
      db.run('UPDATE chats SET last_at = ? WHERE id = ?', now(), Number(chatId));
      const all = db.all('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id asc', Number(chatId));
      return all[all.length - 1];
    },
    /* Newest activity first — a chat waiting on a reply is the one that matters,
       and it is the one that was written in most recently. */
    chats(limit) {
      const rows = db.all("SELECT * FROM chats WHERE token > ? ORDER BY last_at desc", '');
      return rows.slice(0, limit || 60);
    },
    setChatStatus(id, status) {
      db.run('UPDATE chats SET status = ? WHERE id = ?', String(status), Number(id));
      return db.one('SELECT * FROM chats WHERE id = ?', Number(id));
    },
    markChatSeen(id) {
      db.all('SELECT * FROM chat_messages WHERE chat_id = ?', Number(id))
        .filter(m => !m.seen_staff)
        .forEach(m => db.run('UPDATE chat_messages SET seen_staff = 1 WHERE id = ?', Number(m.id)));
    },
    unseenChats() {
      const seen = {};
      db.all('SELECT * FROM chat_messages WHERE seen_staff = ?', 0)
        .forEach(m => { seen[m.chat_id] = (seen[m.chat_id] || 0) + 1; });
      return seen;
    },

    /* ---- drafts ---- */
    /* Newest first, and capped where it is read rather than where it is
       written: a student who regenerates twenty times still has all twenty,
       and the screen shows the ones they are likely to want. */
    drafts: id => db.all('SELECT * FROM drafts WHERE student_id = ? ORDER BY id desc', Number(id)),
    addDraft(studentId, d) {
      db.run(`INSERT INTO drafts (student_id, kind, programme, university, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
        Number(studentId), String(d.kind || 'sop'), String(d.programme || ''),
        String(d.university || ''), JSON.stringify(d), now());
      return db.all('SELECT * FROM drafts WHERE student_id = ? ORDER BY id desc', Number(studentId))[0];
    },
    deleteDraft: (studentId, id) =>
      db.run('DELETE FROM drafts WHERE id = ? AND student_id = ?', Number(id), Number(studentId)),

    /* ---- applications ---- */
    getApplications: id => db.all('SELECT * FROM applications WHERE student_id = ?', Number(id)),
    putApplication(studentId, progId, stage, outcome) {
      db.run(`INSERT OR REPLACE INTO applications (student_id, prog_id, stage, outcome, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        Number(studentId), String(progId), Number(stage) || 0, outcome || '', now());
    },
    removeApplication: (studentId, progId) =>
      db.run('DELETE FROM applications WHERE student_id = ? AND prog_id = ?', Number(studentId), String(progId)),

    /* ---- documents ---- */
    getDocuments: id => db.all('SELECT * FROM documents WHERE student_id = ?', Number(id)),
    docByKey: (studentId, key) =>
      db.one('SELECT * FROM documents WHERE student_id = ? AND doc_key = ?', Number(studentId), String(key)),
    addDocument(studentId, key, filename, storedName, bytes) {
      db.run(`INSERT INTO documents (student_id, doc_key, filename, stored_name, bytes, status, uploaded_at)
              VALUES (?, ?, ?, ?, ?, 'wait', ?)`,
        Number(studentId), String(key), filename, storedName, Number(bytes), now());
      return this.docByKey(studentId, key);
    },
    setDocStatus: (studentId, key, status) =>
      db.run('UPDATE documents SET status = ? WHERE student_id = ? AND doc_key = ?',
        status, Number(studentId), String(key)),
    removeDocument: (studentId, key) =>
      db.run('DELETE FROM documents WHERE student_id = ? AND doc_key = ?', Number(studentId), String(key)),

    /* ---- messages ---- */
    getMessages: id => db.all('SELECT * FROM messages WHERE student_id = ? ORDER BY id asc', Number(id)),
    addMessage(studentId, sender, body, file) {
      db.run('INSERT INTO messages (student_id, sender, body, file, created_at) VALUES (?, ?, ?, ?, ?)',
        Number(studentId), sender, body || '', file || '', now());
    },

    /* ---- saved scholarships ---- */
    getSaved: id => db.all('SELECT * FROM saved_scholarships WHERE student_id = ?', Number(id)).map(r => r.sch_id),
    saveScholarship: (studentId, schId) =>
      db.run('INSERT OR REPLACE INTO saved_scholarships (student_id, sch_id, saved_at) VALUES (?, ?, ?)',
        Number(studentId), String(schId), now()),
    unsaveScholarship: (studentId, schId) =>
      db.run('DELETE FROM saved_scholarships WHERE student_id = ? AND sch_id = ?',
        Number(studentId), String(schId)),

    /* ---- orders ---- */
    addOrder(o) {
      db.run(`INSERT INTO orders
        (student_id, reference, package, package_id, public_unis, gross_paise, name, email, phone, status, created_at, items, kind, accepted, plan, paid_paise)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        o.studentId ? Number(o.studentId) : null, o.reference, o.package,
        String(o.packageId || ''),
        Number(o.publicUnis || 0), Number(o.grossPaise || 0),
        o.name || '', String(o.email || '').toLowerCase(), o.phone || '', o.status || 'paid', now(),
        JSON.stringify(o.items || []), o.kind || 'package',
        o.accepted ? JSON.stringify(o.accepted) : '',
        o.plan ? JSON.stringify(o.plan) : '', Number(o.paidPaise || 0));
      return db.one('SELECT * FROM orders WHERE reference = ?', o.reference);
    },
    ordersFor: id => db.all('SELECT * FROM orders WHERE student_id = ? ORDER BY id desc', Number(id)),
    /* The schedule and the running total, written together — a plan that says
       a part is paid and a total that has not moved is a reconciliation nobody
       can do. */
    setOrderPlan(reference, plan, paidPaise) {
      db.run('UPDATE orders SET plan = ?, paid_paise = ? WHERE reference = ?',
        plan ? JSON.stringify(plan) : '', Number(paidPaise || 0), String(reference));
      return db.one('SELECT * FROM orders WHERE reference = ?', String(reference));
    },
    /*
     * EVERY order, including the ones nobody has signed up for yet.
     *
     * The office counted its orders by walking the students and asking each one
     * what they had bought. An order placed by a visitor who has not yet made
     * an account has no student to walk from — so it was counted nowhere, shown
     * nowhere, and the Organisation screen read "0 orders placed" to somebody
     * who had just placed four. Buying before signing up is the normal path on
     * this site; it cannot be the path that disappears.
     */
    allOrders: () => db.all('SELECT * FROM orders ORDER BY id desc'),
    orderByReference: r => db.one('SELECT * FROM orders WHERE reference = ?', String(r)),
    orderByGateway: g =>
      db.one('SELECT * FROM orders WHERE gateway_order_id = ?', String(g)),
    setOrderGateway: (reference, gatewayOrderId) =>
      db.run('UPDATE orders SET gateway_order_id = ? WHERE reference = ?',
        String(gatewayOrderId), String(reference)),
    setOrderStatus: (reference, status) =>
      db.run('UPDATE orders SET status = ? WHERE reference = ?',
        String(status), String(reference)),
    /*
     * Paid, and when, and by which payment.
     *
     * The payment id is kept because it is the only handle a refund or a
     * dispute can be raised against later — an order reference means nothing to
     * the gateway. `paid_at` is separate from `created_at`: an order created on
     * Friday and paid on Monday is a normal thing, and collapsing the two loses
     * the fact.
     */
    setOrderPaid: (reference, paymentId) =>
      db.run('UPDATE orders SET status = ?, gateway_payment_id = ?, paid_at = ? '
        + 'WHERE reference = ?',
        'paid', String(paymentId || ''), now(), String(reference)),
    ordersByEmail: e => db.all('SELECT * FROM orders WHERE email = ? ORDER BY id desc', String(e).toLowerCase()),
    /* An order placed before signing up is claimed the moment that email
       registers — otherwise a student who paid as a guest signs in to an empty
       dashboard, which is the worst possible first impression after paying. */
    claimOrders(studentId, email) {
      const rows = db.all('SELECT * FROM orders WHERE email = ?', String(email).toLowerCase());
      rows.filter(r => !r.student_id).forEach(r =>
        db.run('UPDATE orders SET student_id = ? WHERE reference = ?', Number(studentId), r.reference));
      return rows.length;
    },

    /* ---- the catalogue: what the site offers ---- */
    /* This used to be a build artefact — a JSON file generated from a
       spreadsheet nobody in the office had. It is a table now, so a counsellor
       can add a university from the operations screen and the site shows it
       without anyone running a build. */
    programmes(all) {
      const rows = db.all('SELECT * FROM programmes WHERE id > ? ORDER BY university asc', '');
      return all ? rows : rows.filter(r => r.active);
    },
    programme: id => db.one('SELECT * FROM programmes WHERE id = ?', String(id)),
    saveProgramme(p, who) {
      /* Blank is not zero. A programme with no stated CGPA follows its
         country's rule; a programme with 0 would accept anybody. Writing an
         empty box as 0 is how a filter quietly stops filtering. */
      const bar = (p.minCgpa === '' || p.minCgpa == null || !Number.isFinite(Number(p.minCgpa)))
        ? null : Math.max(0, Math.min(10, Number(p.minCgpa)));
      db.run(`INSERT OR REPLACE INTO programmes
        (id, program, university, city, country, level, field, band, is_public, fit,
         min_cgpa, total_inr, url, intakes, active, featured, feature_sort, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        String(p.id), p.program, p.university, p.city || '', p.country,
        p.level || '', p.field || '', p.band || '', p.isPublic ? 1 : 0,
        Number(p.fit || 0), bar, Number(p.totalInr || 0), p.url || '',
        JSON.stringify(p.intakes || []), p.active === false ? 0 : 1,
        p.featured ? 1 : 0, Number(p.featureSort || 0), now(), who || '');
      return this.programme(p.id);
    },
    deleteProgramme: id => db.run('DELETE FROM programmes WHERE id = ?', String(id)),

    countries(all) {
      const rows = db.all('SELECT * FROM countries WHERE code > ? ORDER BY sort asc', '');
      return all ? rows : rows.filter(r => r.active);
    },
    country: code => db.one('SELECT * FROM countries WHERE code = ?', String(code).toUpperCase()),
    saveCountry(c) {
      /* `facts` is left alone when the caller does not mention it. The
         Destinations form edits the name and the flag; the requirements editor
         edits the facts; neither should wipe the other's work by omission. */
      const had = this.country(c.code);
      const facts = c.facts === undefined
        ? (had ? had.facts || '' : '')
        : JSON.stringify(c.facts || {});
      db.run(`INSERT OR REPLACE INTO countries (code, name, flag, region, active, sort, updated_at, facts)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        String(c.code).toUpperCase(), c.name, c.flag || '', c.region || '',
        c.active === false ? 0 : 1, Number(c.sort || 100), now(), facts);
      return this.country(c.code);
    },
    deleteCountry: code => db.run('DELETE FROM countries WHERE code = ?', String(code).toUpperCase()),

    /* ---- home page content ---- */
    /* A block comes back parsed or it comes back null. A caller that gets a
       string here would have to remember to parse it, and the one place that
       forgets is the one that blanks the home page. */
    content(key) {
      const row = db.one('SELECT * FROM content WHERE key = ?', String(key));
      if (!row) return null;
      try { return JSON.parse(row.value); } catch (e) { return null; }
    },
    contentMeta: key => db.one('SELECT key, who, updated_at FROM content WHERE key = ?', String(key)),
    setContent(key, value, who) {
      db.run(`INSERT OR REPLACE INTO content (key, value, who, updated_at)
              VALUES (?, ?, ?, ?)`,
        String(key), JSON.stringify(value), who || '', now());
      return this.content(key);
    },

    /* Who changed what. Without it, "who put this university on the site?" has
       no answer, and on a catalogue several people edit that question gets
       asked. */
    log(who, what, detail) {
      db.run('INSERT INTO audit (who, what, detail, created_at) VALUES (?, ?, ?, ?)',
        who, what, detail || '', now());
    },
    auditTrail: n => db.all('SELECT * FROM audit WHERE id > ? ORDER BY id desc', 0).slice(0, n || 40),

    /* ---- staff: roles, caseload, assignment ---- */
    /* Who a counsellor may see is decided here and nowhere else. The rule is the
       assignment: a counsellor sees the students assigned to them, an admin sees
       everyone. A screen that filters the list client-side is not a permission. */
    /**
     * A counsellor's caseload, or every student for an admin.
     *
     * Closed files are out of a counsellor's list by default — a caseload that
     * includes everybody they have ever helped stops being a to-do list — but
     * an admin sees them, because the admin is the one who has to find them
     * again. `all` overrides it either way.
     */
    staffStudents(staff, all) {
      const rows = staff.role === 'admin'
        ? db.all("SELECT * FROM students WHERE role = ? ORDER BY id desc", 'student')
        : db.all('SELECT * FROM students WHERE counsellor_id = ? ORDER BY id desc', Number(staff.id));
      if (all || staff.role === 'admin') return rows;
      return rows.filter(r => (r.status || 'active') === 'active');
    },

    /**
     * Edit a person's name, email or phone.
     *
     * The email is the sign-in, so a typo in it locks somebody out of their own
     * account and there is no way in from their side. It has to be fixable, and
     * it has to refuse a duplicate — two accounts on one address means the
     * second person to sign in gets the first one's file.
     */
    updatePerson(id, p) {
      const email = String(p.email || '').trim().toLowerCase();
      if (email) {
        const clash = db.one('SELECT id FROM students WHERE email = ? AND id != ?',
          email, Number(id));
        if (clash) return { error: 'Another account already uses that email address' };
      }
      const was = this.studentById(id);
      if (!was) return { error: 'No such person' };
      db.run('UPDATE students SET name = ?, email = ?, phone = ? WHERE id = ?',
        String(p.name || was.name).slice(0, 120),
        email || was.email,
        String(p.phone == null ? was.phone : p.phone).slice(0, 30),
        Number(id));
      return { person: this.studentById(id) };
    },

    /**
     * Delete a person, and everything of theirs.
     *
     * A row left behind in one of these tables is not tidy-but-harmless: an
     * orphaned document row points at a file on disk that nobody can reach and
     * nobody will ever delete, and an orphaned message turns up in a count.
     *
     * Orders are the exception and are NOT deleted — they are the financial
     * record, they carry what somebody accepted and what they paid, and they
     * survive the account. The caller refuses to delete anybody who has one;
     * this is the second line of that same rule, so a future caller cannot
     * quietly remove a paid order by removing a person.
     */
    deletePerson(id) {
      const n = Number(id);
      const orders = db.all('SELECT id FROM orders WHERE student_id = ?', n);
      if (orders.length) return { error: 'That person has orders on file' };

      [
        'sessions', 'profiles', 'shortlist', 'applications', 'documents',
        'messages', 'saved_scholarships', 'drafts', 'push_subs',
      ].forEach(table => {
        try { db.run('DELETE FROM ' + table + ' WHERE student_id = ?', n); }
        catch (e) { /* a table this database has never had */ }
      });
      try { db.run('DELETE FROM staff_notes WHERE student_id = ? OR staff_id = ?', n, n); }
      catch (e) {}
      /* Their students become unassigned rather than disappearing with them. */
      try { db.run('UPDATE students SET counsellor_id = NULL WHERE counsellor_id = ?', n); }
      catch (e) {}
      /* A lead they owned goes back in the pool, and a lead that became them
         loses the link rather than pointing at nothing. */
      try { db.run('UPDATE enquiries SET owner_id = NULL WHERE owner_id = ?', n); } catch (e) {}
      try { db.run('UPDATE enquiries SET student_id = NULL WHERE student_id = ?', n); } catch (e) {}

      db.run('DELETE FROM students WHERE id = ?', n);
      return { ok: true };
    },

    countOrdersFor: id => db.all(
      'SELECT COUNT(*) AS n FROM orders WHERE student_id = ?', Number(id))[0].n,
    countStudentsOf: id => db.all(
      'SELECT COUNT(*) AS n FROM students WHERE counsellor_id = ?', Number(id))[0].n,
    countAdmins: () => db.all(
      "SELECT COUNT(*) AS n FROM students WHERE role = 'admin'")[0].n,

    /* The enquiry and the follow-ups written against it. Leaving the notes
       behind would mean somebody's account of a phone call sitting in a table
       attached to a lead that no longer exists — invisible, and counted. */
    deleteLead(id) {
      const n = Number(id);
      try { db.run('DELETE FROM lead_notes WHERE lead_id = ?', n); } catch (e) {}
      db.run('DELETE FROM enquiries WHERE id = ?', n);
      return { ok: true };
    },

    setStudentStatus(studentId, status, note) {
      const s = ['active', 'completed', 'left'].includes(status) ? status : 'active';
      db.run('UPDATE students SET status = ?, closed_at = ?, close_note = ? WHERE id = ?',
        s, s === 'active' ? '' : now(), String(note || '').slice(0, 400), Number(studentId));
      return s;
    },
    canSee(staff, studentId) {
      if (staff.role === 'admin') return true;
      const st = this.studentById(studentId);
      return !!st && Number(st.counsellor_id) === Number(staff.id);
    },
    assignCounsellor: (studentId, counsellorId) =>
      db.run('UPDATE students SET counsellor_id = ? WHERE id = ?',
        counsellorId === null ? null : Number(counsellorId), Number(studentId)),

    /*
     * Whoever has the fewest students right now.
     *
     * A student who has just paid for a service built around a named person
     * was being left with nobody, on their screen and on ours, until somebody
     * in the office noticed the Unassigned counter. They would sign in, find
     * no counsellor, and message a blank.
     *
     * Fewest OPEN files, not fewest ever: a counsellor who has seen a hundred
     * students through to enrolment is not busy today because of it, and
     * counting closed files would push everything at whoever joined last.
     *
     * Counsellors only, never an administrator. An admin can already see every
     * student, so putting one on a caseload does not give them anything and
     * does quietly make them somebody's first point of contact.
     */
    lightestCounsellor() {
      const staff = db.all("SELECT * FROM students WHERE role = 'counsellor' ORDER BY id asc")
        .filter(c => (c.status || 'active') === 'active');
      if (!staff.length) return null;
      const load = c => db.all(
        "SELECT COUNT(*) AS n FROM students WHERE counsellor_id = ? AND role = 'student' "
        + "AND (status IS NULL OR status = 'active')", Number(c.id))[0].n;
      let best = null, least = Infinity;
      staff.forEach(c => {
        const n = load(c);
        /* Ties go to the earlier id, so the same input gives the same answer
           twice — a round robin that depends on iteration order is a round
           robin nobody can reason about when it goes wrong. */
        if (n < least) { least = n; best = c; }
      });
      return best;
    },
    /* ------------------------------------------------------ push subscriptions */

    savePushSubscription(staffId, sub, agent) {
      db.run(`INSERT OR REPLACE INTO push_subs
        (endpoint, staff_id, p256dh, auth, agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        String(sub.endpoint), Number(staffId),
        String((sub.keys || {}).p256dh || ''), String((sub.keys || {}).auth || ''),
        String(agent || '').slice(0, 200), now());
    },
    pushSubscriptions: staffId => db.all(
      'SELECT * FROM push_subs WHERE staff_id = ?', Number(staffId))
      .map(r => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth },
        agent: r.agent, at: r.created_at })),
    deletePushSubscription: endpoint =>
      db.run('DELETE FROM push_subs WHERE endpoint = ?', String(endpoint)),
    countPushSubscriptions: staffId => db.all(
      'SELECT COUNT(*) AS n FROM push_subs WHERE staff_id = ?', Number(staffId))[0].n,

    counsellors: () => db.all("SELECT * FROM students WHERE role = ?", 'counsellor'),

    /* Everybody who can carry a student: counsellors, and administrators.
     *
     * In a five-person office the administrator IS a counsellor for some of
     * the students — usually the difficult ones — and there was no way to put
     * their name on a file. The assignment dropdown listed role='counsellor'
     * and nothing else, so those students sat unassigned, out of every
     * caseload count and every digest, looking like nobody's problem.
     *
     * Kept separate from counsellors() rather than widening it, because the
     * daily digest already reads counsellors().concat(staffByRole('admin'))
     * and widening the first would have emailed every admin twice. */
    caseworkers: () => db.all(
      "SELECT * FROM students WHERE role IN ('counsellor', 'admin') ORDER BY role, name"),
    staffByRole: r => db.all('SELECT * FROM students WHERE role = ?', r),
    allStudents: () => db.all("SELECT * FROM students WHERE role = ? ORDER BY id desc", 'student'),

    /* ---- partners ---- */
    /*
     * A B2B agency and the students it introduced.
     *
     * The agency is a row in this same table with role='partner', so it gets
     * sign-in, sessions and password reset for free. What makes it a partner
     * rather than a member of staff is the role alone — every partner-facing
     * endpoint asks for that role and every staff endpoint refuses it.
     */
    partners: () => db.all("SELECT * FROM students WHERE role = ? ORDER BY name", 'partner'),

    /* THE scoping query. Everything a partner is allowed to see goes through
       this one function, so there is a single place to be wrong rather than
       one per screen — and a partner with no id gets nothing rather than
       everything, which is the failure mode that matters. */
    partnerStudents: partnerId => (Number(partnerId) > 0
      ? db.all("SELECT * FROM students WHERE role = 'student' AND partner_id = ? "
        + 'ORDER BY id desc', Number(partnerId))
      : []),

    partnerStudentCount: partnerId => (Number(partnerId) > 0
      ? db.all("SELECT * FROM students WHERE role = 'student' AND partner_id = ?",
        Number(partnerId)).length
      : 0),

    setPartner(studentId, partnerId) {
      db.run('UPDATE students SET partner_id = ? WHERE id = ?',
        partnerId ? Number(partnerId) : null, Number(studentId));
    },

    setLogo(id, dataUrl) {
      db.run('UPDATE students SET logo = ? WHERE id = ?',
        String(dataUrl || ''), Number(id));
    },

    /* ---- unread ---- */
    unreadForStudent: id =>
      db.all('SELECT * FROM messages WHERE student_id = ?', Number(id))
        .filter(m => m.sender !== 'me' && !m.read_by_student).length,
    unreadForStaff: id =>
      db.all('SELECT * FROM messages WHERE student_id = ?', Number(id))
        .filter(m => m.sender === 'me' && !m.read_by_staff).length,
    markRead(studentId, who) {
      const col = who === 'staff' ? 'read_by_staff' : 'read_by_student';
      const want = who === 'staff' ? 'me' : 'them';
      db.all('SELECT * FROM messages WHERE student_id = ?', Number(studentId))
        .filter(m => m.sender === want && !m[col])
        .forEach(m => db.run(`UPDATE messages SET ${col} = ? WHERE id = ?`, 1, m.id));
    },
    lastMessage(studentId) {
      const l = db.all('SELECT * FROM messages WHERE student_id = ? ORDER BY id asc', Number(studentId));
      return l[l.length - 1] || null;
    },

    /* ---- password resets ---- */
    /* One-time and short-lived. A reset link that still works tomorrow, or works
       twice, is a spare key to the account sitting in an inbox. */
    createReset(token, studentId, minutes) {
      db.run('INSERT INTO password_resets (token, student_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)',
        token, Number(studentId), new Date(Date.now() + minutes * 60000).toISOString(), now());
    },
    useReset(token) {
      const r = db.one('SELECT * FROM password_resets WHERE token = ?', String(token));
      if (!r || r.used || new Date(r.expires_at) < new Date()) return null;
      db.run('UPDATE password_resets SET used = ? WHERE token = ?', 1, String(token));
      return this.studentById(r.student_id);
    },
    /* Set when we generate a password for somebody; cleared the moment they
       choose their own. */
    setMustChange: (id, on) =>
      db.run('UPDATE students SET must_change = ? WHERE id = ?', on ? 1 : 0, Number(id)),

    setPassword(studentId, hash, salt) {
      db.run('UPDATE students SET pass_hash = ?, pass_salt = ? WHERE id = ?',
        hash, salt, Number(studentId));
      /* Every existing session is dropped. If the reset was because somebody
         else had the password, leaving their session alive defeats the point. */
      db.all('SELECT * FROM sessions WHERE student_id = ?', Number(studentId))
        .forEach(x => db.run('DELETE FROM sessions WHERE token = ?', x.token));
    },

    /* ---- enquiries ---- */
    addEnquiry(e) {
      const t = now();
      db.run(`INSERT INTO enquiries (name, phone, email, destination, consent, source_page,
                referrer, note, source, campaign, status, owner_id, lost_reason, next_at,
                student_id, updated_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.name, e.phone, e.email, e.destination || '', e.consent || '',
        e.sourcePage || '', e.referrer || '', e.note || '',
        e.source || 'website', e.campaign || '', e.status || 'new',
        e.ownerId == null ? null : Number(e.ownerId), '', e.nextAt || '',
        e.studentId == null ? null : Number(e.studentId), t, t);
      return db.all('SELECT * FROM enquiries WHERE id > ? ORDER BY id desc', 0)[0] || null;
    },
    allEnquiries: () => db.all('SELECT * FROM enquiries WHERE id > ? ORDER BY id desc', 0),
    enquiryById: id => db.one('SELECT * FROM enquiries WHERE id = ?', Number(id)),
    updateEnquiry(id, e) {
      db.run(`UPDATE enquiries SET source = ?, campaign = ?, owner_id = ?, status = ?,
                lost_reason = ?, next_at = ?, student_id = ?, note = ?, destination = ?,
                updated_at = ? WHERE id = ?`,
        e.source || '', e.campaign || '', e.ownerId == null ? null : Number(e.ownerId),
        e.status || 'new', e.lostReason || '', e.nextAt || '',
        e.studentId == null ? null : Number(e.studentId), e.note || '',
        e.destination || '', now(), Number(id));
      return db.one('SELECT * FROM enquiries WHERE id = ?', Number(id));
    },
    leadNotes: id => db.all('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY id asc',
      Number(id)),
    addLeadNote(leadId, who, kind, body) {
      db.run(`INSERT INTO lead_notes (lead_id, who, kind, body, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        Number(leadId), String(who || ''), String(kind || 'note'), String(body || ''), now());
      return db.all('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY id asc', Number(leadId));
    },
    /* Every note on every lead in one read. Asking per lead meant one query
       per row to draw a list of two hundred. */
    leadNoteCounts() {
      const out = {};
      db.all('SELECT * FROM lead_notes WHERE id > ?', 0).forEach(n => {
        const k = String(n.lead_id);
        if (!out[k]) out[k] = { n: 0, last: '', lastWho: '' };
        out[k].n++;
        if (String(n.created_at) > out[k].last) {
          out[k].last = n.created_at;
          out[k].lastWho = n.who;
        }
      });
      return out;
    },
    countStudents: () => db.all('SELECT * FROM students WHERE id > ?', 0).length,

    /* ---- the blog ---- */

    /* ---- what an administrator has said to a counsellor ---- */

    staffNotes: id => db.all('SELECT * FROM staff_notes WHERE student_id = ? ORDER BY id asc',
      Number(id)),
    staffNotesFor: toId => db.all('SELECT * FROM staff_notes WHERE to_id = ? ORDER BY id desc',
      Number(toId)),
    addStaffNote(studentId, fromId, toId, body) {
      db.run(`INSERT INTO staff_notes (student_id, from_id, to_id, body, seen, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        Number(studentId), Number(fromId), toId == null ? null : Number(toId),
        String(body), 0, now());
      return db.all('SELECT * FROM staff_notes WHERE student_id = ? ORDER BY id asc',
        Number(studentId));
    },
    markStaffNotesSeen(studentId, toId) {
      db.all('SELECT * FROM staff_notes WHERE student_id = ?', Number(studentId))
        .filter(n => Number(n.to_id) === Number(toId) && !n.seen)
        .forEach(n => db.run('UPDATE staff_notes SET seen = ? WHERE id = ?', 1, Number(n.id)));
    },

    allPosts: () => db.all('SELECT * FROM posts WHERE id > ? ORDER BY id desc', 0),
    /* Published only, newest first. The list a visitor sees is decided here
       rather than by a filter in a browser, because a draft that reaches the
       page is published whatever the badge on it says. */
    livePosts() {
      return db.all('SELECT * FROM posts WHERE status = ?', 'published')
        .filter(p => p.body && String(p.body).trim())
        .sort((a, b) => String(b.published_at || b.created_at)
          .localeCompare(String(a.published_at || a.created_at)));
    },
    postById: id => db.one('SELECT * FROM posts WHERE id = ?', Number(id)),
    postBySlug: slug => db.one('SELECT * FROM posts WHERE slug = ?', String(slug)),
    addPost(p) {
      const t = now();
      db.run(`INSERT INTO posts (slug, title, excerpt, body, cover, author, tag, status,
                meta_title, meta_desc, keywords, og_image, read_mins, published_at,
                created_at, updated_at, updated_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.slug, p.title, p.excerpt || '', p.body || '', p.cover || '', p.author || '',
        p.tag || '', p.status || 'draft', p.metaTitle || '', p.metaDesc || '',
        p.keywords || '', p.ogImage || '', Number(p.readMins || 0),
        p.publishedAt || '', p.createdAt || t, t, p.updatedBy || '');
      return db.one('SELECT * FROM posts WHERE slug = ?', p.slug);
    },
    updatePost(id, p) {
      db.run(`UPDATE posts SET slug = ?, title = ?, excerpt = ?, body = ?, cover = ?,
                author = ?, tag = ?, status = ?, meta_title = ?, meta_desc = ?,
                keywords = ?, og_image = ?, read_mins = ?, published_at = ?,
                updated_at = ?, updated_by = ? WHERE id = ?`,
        p.slug, p.title, p.excerpt || '', p.body || '', p.cover || '', p.author || '',
        p.tag || '', p.status || 'draft', p.metaTitle || '', p.metaDesc || '',
        p.keywords || '', p.ogImage || '', Number(p.readMins || 0),
        p.publishedAt || '', now(), p.updatedBy || '', Number(id));
      return db.one('SELECT * FROM posts WHERE id = ?', Number(id));
    },
    deletePost: id => db.run('DELETE FROM posts WHERE id = ?', Number(id)),
  };
}

module.exports = { open };
