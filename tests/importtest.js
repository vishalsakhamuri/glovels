/**
 * The spreadsheet import, and the four faults it waved through.
 *
 * From the 1.5 testing round, on a two-row file:
 *
 *   "0 CANNOT IMPORT, and not one warning on either row. Row 2 carries
 *    id=888888, which matches no programme — the instruction text at the top
 *    of this frame promises 'a row that arrives with an id is treated as a
 *    change to that programme', and instead it is queued as new, with 888888
 *    becoming the record's primary key (CAT-01). Row 3 carries a fee of
 *    not-a-number, a CGPA of 99, a fit score of 900 and a deadline of
 *    2020-05-05; all four are accepted, three are silently rewritten, and the
 *    preview mentions none of them (CAT-02 / 03 / 04)."
 *
 * WHAT MAKES THIS WORSE THAN A FORM ACCEPTING BAD INPUT is that the office
 * uploads 171 rows at a time and reads a preview to decide whether to apply
 * it. A preview that says "0 cannot import" is not a neutral silence — it is
 * the screen telling somebody the file is fine. They press Apply on that.
 *
 * A fee of 0 on this site means FREE. So "not-a-number" in the tuition column
 * did not fail; it made a paid programme free, on the public page, quietly.
 *
 * THE FOURTH ONE IS NOT A FAULT ANY MORE. A deadline of 2020-05-05 was
 * reported alongside the others, and since the intake patch the year in a
 * deadline is not used at all — the day and the month are read and the year is
 * worked out from today. So the importer must NOT refuse it, and must say so
 * once, rather than leaving a counsellor to infer it from silence. Both halves
 * are checked below.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* A CSV parser good enough to read our own export back: quoted fields with
   commas in them, which the university names have. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
const toCsv = rows => rows.map(r => r.map(c => {
  const s = String(c == null ? '' : c);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}).join(',')).join('\n');

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  const r0 = await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  ok(r0.ok(), 'the office can sign in — ' + r0.status());

  const csv = await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text();
  const rows = parseCsv(csv);
  const head = rows[0].map(h => h.trim().toLowerCase());
  const at = name => head.indexOf(name);
  const COL = {
    id: at('id'), fee: at('total tuition inr'), cgpa: at('minimum cgpa'),
    fit: at('fit score'), gpa: at('german gpa'), dl: at('intake 1 deadline'),
    /* The four the duplicate check is matched on, and the column that hides a
       row without deleting it. */
    prog: at('programme'), uni: at('university'), level: at('level'),
    country: at('country code'), live: at('on the site'),
  };
  ok(Object.values(COL).every(i => i >= 0),
    'the exported sheet has the columns this is about — ' + JSON.stringify(COL));
  ok(rows.length > 3, 'and rows to edit — ' + (rows.length - 1));

  /* Two rows, and nothing else, so the preview is about them. */
  const upload = async (edits, opts) => {
    const file = [rows[0], rows[1].slice(), rows[2].slice()];
    edits.forEach(([r, c, v]) => { file[r][c] = v; });
    const form = { file: { name: 'catalogue.csv', mimeType: 'text/csv',
      buffer: Buffer.from(toCsv(file), 'utf8') } };
    if (opts) Object.assign(form, opts);
    const res = await admin.request.post(BASE + '/api/staff/catalogue/import',
      { multipart: form });
    return { status: res.status(), body: await res.json() };
  };

  /* The same thing for a file whose SHAPE is the point — three rows, or two
     copies of one row — rather than two rows with cells edited. */
  const uploadRows = async (body, opts) => {
    const form = { file: { name: 'catalogue.csv', mimeType: 'text/csv',
      buffer: Buffer.from(toCsv([rows[0]].concat(body)), 'utf8') } };
    if (opts) Object.assign(form, opts);
    const res = await admin.request.post(BASE + '/api/staff/catalogue/import',
      { multipart: form });
    return { status: res.status(), body: await res.json() };
  };
  const whyOf = r => ((r.body.plan || {}).rejected || [])
    .flatMap(x => x.why || []).join(' | ');
  const warnOf = r => JSON.stringify([].concat((r.body.plan || {}).update || [],
    (r.body.plan || {}).create || [], (r.body.plan || {}).unchanged || []));

  /* ============================================================== CAT-01 */
  /* The PREVIEW, because the preview is what the office reads before pressing
     Apply. It answers 200 with a plan either way; "0 cannot import" on that
     plan is not a neutral silence, it is the screen saying the file is fine. */
  const badId = await upload([[1, COL.id, '888888']]);
  ok(badId.body.counts && badId.body.counts.rejected === 1,
    'the preview counts the row as one that cannot import — '
    + JSON.stringify(badId.body.counts));
  const idWhy = JSON.stringify((badId.body.plan || {}).rejected || []);
  ok(/888888/.test(idWhy),
    'and the reason names the id — ' + idWhy.slice(0, 140));
  ok(/leave that cell empty/i.test(idWhy),
    'and says what to do instead — ' + idWhy.slice(0, 200));
  /* The old behaviour, which is the one that matters: it was queued as NEW,
     and 888888 became the primary key of a record nobody meant to create. */
  const queued = JSON.stringify((badId.body.plan || {}).create || []);
  ok(!/888888/.test(queued),
    'and it is NOT queued as a new programme with that id — ' + queued.slice(0, 120));

  /* ======================================================= CAT-02 / 03 / 04 */
  const nums = await upload([
    [2, COL.fee, 'not-a-number'],
    [2, COL.cgpa, '99'],
    [2, COL.fit, '900'],
  ]);
  ok(nums.body.counts && nums.body.counts.rejected === 1,
    'the three impossible numbers stop the row — ' + JSON.stringify(nums.body.counts));
  const why = ((nums.body.plan || {}).rejected || [])
    .flatMap(r => r.why || []).join(' | ');
  ok(/not a number/i.test(why) && /not-a-number/.test(why),
    'the fee is named and quoted — ' + why);
  ok(/minimum CGPA is 99/i.test(why),
    'the CGPA is named with what was typed, not what it was clamped to — ' + why);
  ok(/fit score is 900/i.test(why), 'and so is the fit score — ' + why);
  /* THE point. Three of these were rewritten to 0, 10 and 100 and the preview
     said "0 cannot import" — a screen telling somebody to press Apply. */
  ok((nums.body.plan || {}).rejected.length > 0,
    'and the row is counted as one that cannot import, not as one that is fine');

  /* A fee of 0 means FREE here, which is why "not-a-number" becoming 0 was not
     a harmless default: it put a paid programme on the public page for
     nothing. Checked separately because it is the one that costs money. */
  const feeOnly = await upload([[2, COL.fee, 'not-a-number']]);
  ok(feeOnly.body.counts.rejected === 1,
    'a tuition cell that is not a number never silently becomes free — '
    + JSON.stringify(feeOnly.body.counts));

  /* And confirming it is refused outright rather than applied. The preview is
     advice; this is the door. */
  const applied = await upload([[2, COL.fee, 'not-a-number']], { confirm: 'yes' });
  ok(applied.status === 422,
    'and confirming a file with a bad row is refused — ' + applied.status);
  ok(/cannot be imported/i.test(applied.body.error || ''),
    'with a reason — ' + (applied.body.error || '').slice(0, 90));

  /* ============================================================== CAT-05 */
  /* THE OTHER HALF OF THE ID COLUMN, and the one nothing checked at all.
   *
   * A blank id means "I have never seen this course before". Nothing tested
   * whether that was TRUE, so clearing an id on a row already in the catalogue
   * queued a second copy of it, and the preview said "1 added" — accurate and
   * useless. That is how Vistula University came to be on the live site twice.
   *
   * The one that will happen more often is the whole file: the sheet of new
   * universities, uploaded a second time. Every id in it is blank, because
   * every row was new when it was made, so the second upload adds all of them
   * again. Twenty courses, forty records, and no screen anywhere saying they
   * are the same. */
  const dup = await upload([[1, COL.id, '']]);
  ok(dup.body.counts && dup.body.counts.rejected === 1,
    'a row already in the catalogue, with its id cleared, cannot import — '
    + JSON.stringify(dup.body.counts));
  const dupWhy = whyOf(dup);
  ok(dupWhy.includes(rows[1][COL.id]),
    'and the reason names the id to paste back — ' + dupWhy.slice(0, 200));
  ok(/twice/i.test(dupWhy),
    'and says what pressing Apply would have done — ' + dupWhy.slice(0, 220));
  ok(!/id column/.test(JSON.stringify((dup.body.plan || {}).create || [])),
    'and it is NOT queued as a new programme');

  /* The whole file, which is the accident this is really for. */
  const both = await upload([[1, COL.id, ''], [2, COL.id, '']]);
  ok(both.body.counts.rejected === 2,
    'yesterday\'s file of new universities, uploaded again, adds nothing — '
    + JSON.stringify(both.body.counts));
  ok((both.body.counts.create || 0) === 0,
    'not one row of it is queued as new — ' + JSON.stringify(both.body.counts));

  /* The door, not only the preview. */
  const dupApply = await upload([[1, COL.id, '']], { confirm: 'yes' });
  ok(dupApply.status === 422,
    'and confirming it is refused outright — ' + dupApply.status);

  /* What must NOT be caught, or the guard is a wall: a course that really is
     new, with the id blank, which is how every university gets added. */
  const fresh = rows[1].slice();
  fresh[COL.id] = '';
  fresh[COL.prog] = 'MSc Something Nobody Has Listed ' + Date.now();
  const newOne = await uploadRows([fresh]);
  ok(newOne.body.counts.rejected === 0 && newOne.body.counts.create === 1,
    'a genuinely new course with a blank id is still added — '
    + JSON.stringify(newOne.body.counts) + ' ' + whyOf(newOne).slice(0, 140));

  /* And the thing it is matched ON. The same programme name at a DIFFERENT
     university is a different course, and refusing it would stop the office
     adding the twelve MSc Computer Science rows every intake needs. */
  const elsewhere = rows[1].slice();
  elsewhere[COL.id] = '';
  elsewhere[COL.uni] = 'A University Not In This Catalogue ' + Date.now();
  const other = await uploadRows([elsewhere]);
  ok(other.body.counts.rejected === 0 && other.body.counts.create === 1,
    'the same course name at another university is not a duplicate — '
    + JSON.stringify(other.body.counts) + ' ' + whyOf(other).slice(0, 140));

  /* Two copies of one NEW row, inside one file. Neither is in the database, so
     the check above cannot see it — nothing has been written when the second
     one is read — and applying the file would create both. */
  const twice = fresh.slice();
  const pair = await uploadRows([fresh, twice]);
  ok(pair.body.counts.rejected === 1,
    'the same new row twice in one file: one of them is refused — '
    + JSON.stringify(pair.body.counts));
  ok(/line 2 of this file/i.test(whyOf(pair)),
    'and the message points at the row it collides with, not at the database — '
    + whyOf(pair).slice(0, 160));
  ok(pair.body.counts.create === 1,
    'leaving exactly one to be added — ' + JSON.stringify(pair.body.counts));

  /* ==================================== and what must still be allowed */
  /* A deadline from a cycle that has ended. The year is not read at all any
     more, so refusing this would refuse most of the catalogue. */
  const oldDate = await upload([[2, COL.dl, '2020-05-05']]);
  ok(oldDate.body.counts.rejected === 0,
    'a deadline from 2020 is NOT an error — the year is not used — '
    + JSON.stringify(oldDate.body.counts));
  const notes = ((oldDate.body.plan || {}).notes || []).join(' ');
  ok(/year is worked out from today/i.test(notes),
    'and the preview says so, once, rather than leaving it to be inferred — '
    + notes.slice(0, 120));

  /* A mistyped German grade leaves the row without a bar rather than inventing
     one — settled when that column was added — but it must not be silent.
     Unstated and "no bar published" look identical afterwards, and only the
     person who typed it can tell them apart. */
  const gpa = await upload([[2, COL.gpa, '25']]);
  ok(gpa.body.counts.rejected === 0,
    'a mistyped German grade does not refuse the row — '
    + JSON.stringify(gpa.body.counts));
  const P = gpa.body.plan || {};
  /* Every list, because a row that changes nothing else can still carry a
     warning — and that was exactly the case that swallowed it. */
  const warned = JSON.stringify([].concat(P.update || [], P.create || [], P.unchanged || []));
  ok(/no German bar at all/i.test(warned),
    'but the preview says the row will carry no German bar — ' + warned.slice(0, 200));

  /* And an untouched file still imports, or the whole thing is a wall. */
  const clean = await upload([]);
  ok(clean.status === 200, 'an unedited sheet is still accepted — ' + clean.status);
  ok(clean.body.counts.rejected === 0,
    'with nothing rejected at all — ' + JSON.stringify(clean.body.counts));
  ok(((clean.body.plan || {}).rejected || []).length === 0,
    'with nothing rejected — ' + JSON.stringify((clean.body.plan || {}).rejected || []));

  /* ============================== a row that was removed is still a row */
  /* Removing a programme HIDES it — students' shortlists still point at it.
     So re-uploading it with a blank id is the worst version of the duplicate:
     the shortlists stay on the dead copy while the site shows the fresh one.
     The repair is to bring the original back, and the message has to say so,
     because "it already exists" is a confusing thing to read about something
     that is not on the site. */
  const hide = await upload([[1, COL.live, 'no']], { confirm: 'yes' });
  ok(hide.status === 200, 'a row can be taken off the site from the sheet — ' + hide.status);
  const gone = await upload([[1, COL.id, ''], [1, COL.live, 'yes']]);
  ok(gone.body.counts.rejected === 1,
    'and re-uploading it as new is still refused — ' + JSON.stringify(gone.body.counts));
  ok(/removed from the site/i.test(whyOf(gone)),
    'and the message says it is there but hidden, which is not obvious — '
    + whyOf(gone).slice(0, 200));
  ok(/set active to yes/i.test(whyOf(gone)),
    'and names the column that brings it back — ' + whyOf(gone).slice(0, 220));

  /* ================= a duplicate ALREADY in the catalogue is said, not blocked */
  /* The two Vistula rows are both in the download, both carry ids, and both
     come back up on every ordinary edit. Refusing them would mean nobody can
     change a tuition fee until the old duplicate is cleaned up — a check whose
     first act is to block unrelated work is a check somebody turns off. */
  const made = await uploadRows([fresh], { confirm: 'yes' });
  ok(made.status === 200, 'the new row applies — ' + made.status);
  const again = parseCsv(await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text());
  const mine = again.find(r => r[COL.prog] === fresh[COL.prog]);
  ok(!!mine, 'and comes back down with an id of its own — ' + (mine && mine[COL.id]));
  if (mine) {
    /* Rename it into a course that already exists: the same collision, arriving
       by the other door. */
    const collide = rows[2].slice();
    collide[COL.id] = mine[COL.id];
    const soft = await uploadRows([collide]);
    ok(soft.body.counts.rejected === 0,
      'an id\'d row that matches another id\'d row is NOT refused — '
      + JSON.stringify(soft.body.counts) + ' ' + whyOf(soft).slice(0, 160));
    ok(/same course/i.test(warnOf(soft)),
      'but the preview says the two are the same course — ' + warnOf(soft).slice(0, 220));
    ok(warnOf(soft).includes(rows[2][COL.id]),
      'and names the other one, so somebody can go and look at it');
    ok(soft.body.counts.warned >= 1,
      'and it is counted as a warning rather than swallowed — '
      + JSON.stringify(soft.body.counts));
  }

  /* ============================================ and on the screen itself */
  const page = await admin.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/catalogue', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  ok(errs.length === 0, 'no page errors on the catalogue screen — '
    + errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
