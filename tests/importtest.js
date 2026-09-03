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
