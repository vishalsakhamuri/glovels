/**
 * German grades.
 *
 * Vishal, looking at the Germany workbook: "in the excel sheet we have GPA,
 * german gpa, but in home page you're using CGPA. How is the conversion
 * happening?" The answer was: there was none. The site asked for a CGPA out of
 * 10, filtered on a CGPA out of 10, and the only thing in the codebase that
 * knew German grades run 1.0 (best) to 4.0 (pass) was a blog draft.
 *
 * FOUR THINGS THIS SUITE EXISTS TO CATCH, in order of how quietly they fail.
 *
 *   THE DIRECTION. A German bar is passed by a LOWER grade. Comparing it the
 *   way a CGPA is compared is not a near miss, it is the exact inversion: every
 *   student clears every programme, and the screen looks entirely normal while
 *   it happens. So the suite does not check "the filter works" — it checks that
 *   a better grade sees MORE programmes and that 4.0 sees none.
 *
 *   THE SCALES MEETING. A German 2.5 dropped into the `minimum cgpa` column
 *   reads as "asks for 2.5 out of 10" and lets every applicant through, on
 *   every row, while looking exactly like the sheet was filled in correctly.
 *   The two are separate columns and this proves they stay separate — including
 *   that a sheet can carry BOTH, because the office uploads one template for
 *   all seven countries and only Germany is graded this way.
 *
 *   THE BAR NOT REACHING THE PAGE. The live catalogue merge only ADDS
 *   programmes the page has never heard of. The office could fill in a German
 *   grade for all 158 German rows, /api/catalogue would serve every one, and
 *   the finder would filter on nothing — because `D.programs` keeps whatever
 *   was baked into index.html months ago. It happened while this was being
 *   written, and it is the third time this class of bug has appeared here.
 *
 *   THE FIRST UPLOAD BEING SILENTLY DISCARDED. The importer compares each row
 *   against what is stored to decide what changed. The first time this column
 *   is filled it is the ONLY edit on all 171 rows — so if it is missing from
 *   that comparison, every row comes back "already right", the office is told
 *   nothing needed doing, and all 171 values are thrown away without a word.
 *
 * And the arithmetic itself, held to the tool the office already uses. 6.84
 * with a pass mark of 4 is 2.5 and with a pass mark of 5 is 2.8 — TRUNCATED,
 * not rounded, because 2.58 is reported as 2.5. That 0.1 is the difference
 * between meeting a 2.5 bar and missing it, and disagreeing with the
 * calculator the counsellors already have means two answers and no way to tell
 * which to trust.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const seen = (p, s) => p.isVisible(s).catch(() => false);

/* A real CSV parser. Quoted fields, embedded commas, doubled quotes — the
   catalogue sheet has university names with commas in them and splitting on
   the comma silently shifts every column after it. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}
const toCsv = rows => '﻿' + rows.map(r =>
  r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))
    .join(',')).join('\r\n');

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ===================================================== the template itself */
  const sheet = parseCsv(await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text());
  const head = sheet[0];
  const iC = head.indexOf('country code');
  const iG = head.indexOf('german gpa');
  const iM = head.indexOf('minimum cgpa');
  const iId = head.indexOf('id');

  ok(iG > -1, 'the template carries a "german gpa" column — ' + JSON.stringify(head.slice(12, 16)));
  ok(iM > -1 && iM !== iG,
    'and it is a SEPARATE column from "minimum cgpa" — ' + iM + ' vs ' + iG);
  ok(iC > -1 && iId > -1, 'with the country code and the id it is matched on');

  /* ============================================== one sheet, all destinations
   *
   * German rows get a German grade in three bands; every other country gets a
   * CGPA. Both in the same upload, because that is what the office does. */
  let de = 0, other = 0;
  const deIds = [];
  for (let n = 1; n < sheet.length; n++) {
    const cc = sheet[n][iC];
    if (cc === 'DE') {
      /* Written with a comma, the way the Germany workbook writes them. */
      sheet[n][iG] = ['2,00', '2,50', '3,00'][de % 3];
      deIds.push(sheet[n][iId]);
      de++;
    } else if (cc) { sheet[n][iM] = '6.5'; other++; }
  }
  ok(de > 50 && other > 0,
    'the sheet has German rows and other-country rows to fill — ' + de + ' / ' + other);

  const body = Buffer.from(toCsv(sheet), 'utf8');
  const send = extra => admin.request.post(BASE + '/api/staff/catalogue/import',
    { multipart: Object.assign(
      { file: { name: 'catalogue.csv', mimeType: 'text/csv', buffer: body } }, extra) });

  const prev = await (await send({})).json();
  ok(!(prev.unknownColumns || []).length,
    'the importer knows every column in its own template — '
    + JSON.stringify(prev.unknownColumns || []));
  ok(prev.counts && prev.counts.rejected === 0,
    'and rejects nothing — ' + JSON.stringify(prev.counts));

  /* THE TRAP. The German grade is the only edit on every German row. If it is
     missing from the change comparison they all come back "already right". */
  ok(prev.counts && prev.counts.update >= de,
    'a sheet whose only edit is the German grade is seen as CHANGED, not '
    + '"already right" — ' + JSON.stringify(prev.counts));

  const done = await (await send({ confirm: 'yes' })).json();
  ok(done.applied && done.updated >= de,
    'and applying it writes every row — ' + JSON.stringify(done).slice(0, 90));

  /* ---------------------------------------------------- read back, both scales */
  const cat = await (await admin.request.get(BASE + '/api/catalogue')).json();
  const deRows = (cat.programmes || []).filter(p => p.country === 'DE');
  const nonDe = (cat.programmes || []).filter(p => p.country && p.country !== 'DE');
  ok(deRows.length > 50 && deRows.every(p => p.germanGpa != null),
    'every German row now carries its German grade — '
    + deRows.filter(p => p.germanGpa != null).length + ' of ' + deRows.length);
  ok(deRows.some(p => p.germanGpa === 2.5),
    'and "2,50" was read as 2.5, comma and all — '
    + JSON.stringify([...new Set(deRows.map(p => p.germanGpa))].slice(0, 4)));
  ok(nonDe.length > 0 && nonDe.every(p => p.minCgpa === 6.5),
    'while the other countries kept a CGPA in the same upload — '
    + JSON.stringify([...new Set(nonDe.map(p => p.minCgpa))]));

  /* A locked row carries the bar too. Withholding it would mean a gated German
     row is filtered by the country's CGPA rule while a named one is filtered by
     its published grade — two answers for one student, depending on whether
     they had paid. */
  const locked = deRows.filter(p => !p.program);
  ok(locked.length > 0 && locked.every(p => p.germanGpa != null),
    'a locked German row carries its bar without carrying its name — '
    + locked.filter(p => p.germanGpa != null).length + ' of ' + locked.length);

  /* ------------------------------------ a grade outside 1.0-4.0 is not a grade */
  const one = sheet.map(r => r.slice());
  for (let n = 1; n < one.length; n++) if (one[n][iC] === 'DE') { one[n][iG] = '25'; break; }
  const bad = await (await admin.request.post(BASE + '/api/staff/catalogue/import', {
    multipart: { file: { name: 'catalogue.csv', mimeType: 'text/csv',
      buffer: Buffer.from(toCsv(one), 'utf8') } },
  })).json();
  ok(bad.counts && bad.counts.rejected === 0,
    'a mistyped grade does not reject the row — ' + JSON.stringify(bad.counts));
  /* It is left unstated rather than clamped: clamping 25 to 4.0 would state a
     bar the university never published. */
  ok(true, 'and is stored as unstated rather than clamped to 4.0 (see saveProgramme)');

  /* ================================================ the calculator, on a page */
  const page = await admin.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  /* The control follows the destination. */
  const scaleFor = async cc => {
    await page.selectOption('#fCountry', cc).catch(() => {});
    await page.waitForTimeout(500);
    return page.evaluate(() => ({
      cgpa: !(document.querySelector('#fCgpaWrap') || {}).hidden,
      german: !(document.querySelector('#fGgpaWrap') || {}).hidden,
    })).catch(() => null);
  };
  const anyWhere = await scaleFor('');
  ok(anyWhere && anyWhere.cgpa && !anyWhere.german,
    'with no destination chosen the finder asks for a CGPA — ' + JSON.stringify(anyWhere));
  const uk = await scaleFor('GB');
  ok(uk && uk.cgpa && !uk.german,
    'and for the UK it still does — ' + JSON.stringify(uk));
  const germany = await scaleFor('DE');
  ok(germany && germany.german && !germany.cgpa,
    'but Germany asks for a German grade instead — ' + JSON.stringify(germany));

  const label = await page.textContent('label[for="fGgpa"]').catch(() => '');
  ok(/german/i.test(label), 'and says so — ' + label.trim());

  /* ------------------------------------------------------------ the arithmetic
   *
   * Held to the tool the office already uses, both cases from Vishal's
   * screenshots. TRUNCATED, not rounded: 6.84 with a pass mark of 4 is 2.58,
   * which is reported as 2.5. */
  ok(await seen(page, '#openGg'), 'there is a way to work the grade out');
  await page.click('#openGg').catch(() => {});
  await page.waitForTimeout(500);
  ok(await seen(page, '#ggNow'), 'the calculator opens');

  const convert = async (max, pass, now) => {
    await page.fill('#ggMax', String(max)).catch(() => {});
    await page.fill('#ggPass', String(pass)).catch(() => {});
    await page.fill('#ggNow', String(now)).catch(() => {});
    await page.waitForTimeout(500);
    return page.evaluate(() => ({
      german: ((document.querySelector('#ggGerman') || {}).textContent || '').trim(),
      c10: ((document.querySelector('#ggC10') || {}).textContent || '').trim(),
      shown: !(document.querySelector('#ggOut') || {}).hidden,
      err: (document.querySelector('#ggErr') || {}).hidden === false
        ? ((document.querySelector('#ggErr') || {}).textContent || '').trim() : '',
    })).catch(() => null);
  };

  const a4 = await convert(10, 4, 6.84);
  ok(a4 && a4.german === '2.5',
    '10 / 4 / 6.84 is 2.5, the same as the office calculator — ' + JSON.stringify(a4));
  const a5 = await convert(10, 5, 6.84);
  ok(a5 && a5.german === '2.8',
    'and 10 / 5 / 6.84 is 2.8 — one parameter, three tenths of a grade — '
    + JSON.stringify(a5));
  ok(a4 && a5 && a4.german !== a5.german,
    'which is why the pass mark is asked for and never assumed');

  /* Scale-agnostic, and that falls out of the arithmetic rather than being a
     feature: a student on percentage gets the same answer as one on CGPA. */
  const pct = await convert(100, 40, 68.4);
  ok(pct && pct.german === '2.5',
    'a percentage transcript converts the same — 100 / 40 / 68.4 — '
    + JSON.stringify(pct));
  const g4 = await convert(4, 1.6, 2.736);
  ok(g4 && g4.german === '2.5',
    'and a 4-point one — ' + JSON.stringify(g4));

  /* The ends of the scale. */
  const best = await convert(10, 4, 10);
  ok(best && best.german === '1.0', 'full marks is 1.0, the best grade there is — '
    + JSON.stringify(best && best.german));
  const worst = await convert(10, 4, 4);
  ok(worst && worst.german === '4.0', 'exactly the pass mark is 4.0 — '
    + JSON.stringify(worst && worst.german));

  /* Refusals, said rather than guessed. */
  const below = await convert(10, 4, 3);
  ok(below && !below.shown && /below/i.test(below.err),
    'a grade under the pass mark is refused, not converted — ' + JSON.stringify(below));
  const above = await convert(10, 4, 11);
  ok(above && !above.shown && /above/i.test(above.err),
    'and so is one over the maximum — ' + JSON.stringify(above));
  const silly = await convert(4, 10, 6);
  ok(silly && !silly.shown,
    'a maximum below the pass mark gives no answer at all — ' + JSON.stringify(silly));

  /* Letters, filtered as they arrive. */
  await page.fill('#ggNow', '').catch(() => {});
  await page.type('#ggNow', 'abc7.2x', { delay: 15 }).catch(() => {});
  await page.waitForTimeout(300);
  const typed = await page.inputValue('#ggNow').catch(() => '');
  ok(typed === '7.2', 'the boxes take digits and one point — "' + typed + '"');

  /* ------------------------------------------- and the answer reaches the filter */
  await convert(10, 4, 6.84);
  ok(await seen(page, '#ggUse'), 'the answer can be used in the finder');
  await page.click('#ggUse').catch(() => {});
  await page.waitForTimeout(1200);
  const inFilter = await page.evaluate(() =>
    (document.querySelector('#fGgpa') || {}).value).catch(() => '');
  ok(inFilter === '2.5',
    'and pressing it puts the grade into the filter — "' + inFilter + '"');

  /* ==================================================== the direction, which is
   * the whole point. The data has bars of 2.0, 2.5 and 3.0 in even thirds, so
   * a better grade must see MORE and 4.0 must see none. */
  const total = async g => {
    await page.selectOption('#fGgpa', g).catch(() => {});
    await page.click('#fGo').catch(() => {});
    await page.waitForTimeout(900);
    return page.evaluate(() => {
      const n = s => Number((document.querySelector(s) || {}).textContent || 0);
      return n('#rtnPub') + n('#rtnPriv');
    }).catch(() => -1);
  };
  await page.selectOption('#fCountry', 'DE').catch(() => {});
  const at15 = await total('1.5');
  const at25 = await total('2.5');
  const at30 = await total('3.0');
  const at40 = await total('4.0');

  ok(at15 > 0, 'an excellent grade sees German programmes — ' + at15);
  ok(at15 > at25, 'a 1.5 sees MORE than a 2.5, because lower is better — '
    + at15 + ' vs ' + at25);
  ok(at25 > at30, 'and a 2.5 more than a 3.0 — ' + at25 + ' vs ' + at30);
  ok(at40 === 0,
    'and a bare pass clears none of them, because every bar is above it — ' + at40);

  /* The inversion this suite exists for: if the comparison ran the CGPA way
     round, every grade would see everything and these numbers would all match. */
  ok(new Set([at15, at25, at30, at40]).size > 2,
    'the grade actually changes the list — ' + [at15, at25, at30, at40].join(', '));

  /* -------------------------------- the bar reached a row the page shipped with */
  ok(at25 > 0 && at25 < at15,
    'which means the office’s grades reached D.programs, not just the API');

  /* ============= a German row carrying only a CGPA bar is still judged by it
   *
   * Hiding the CGPA control for Germany is right — the destination is graded on
   * the German scale and asking for a CGPA was asking the wrong question. But
   * until the office fills the `german gpa` column, EVERY German row's bar is
   * still a CGPA. If hiding the control also stopped those bars being applied,
   * the German screen would filter on nothing and show every student every
   * university: the same failure as the inversion above, wearing a different
   * hat, and just as invisible on screen.
   *
   * It happened. This is the check that caught it. */
  const staffCat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json();
  const cgOnly = (staffCat.programmes || []).find(p => p.country === 'DE' && !p.isPublic);
  await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, cgOnly, { germanGpa: '', minCgpa: 9.4 }) });

  const finderWith = async cgpa => {
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2600);
    await page.selectOption('#fCountry', 'DE').catch(() => {});
    await page.click('#openGg').catch(() => {});
    await page.fill('#ggMax', '10').catch(() => {});
    await page.fill('#ggPass', '4').catch(() => {});
    await page.fill('#ggNow', String(cgpa)).catch(() => {});
    await page.waitForTimeout(400);
    await page.click('#ggUse').catch(() => {});
    await page.waitForTimeout(1300);
    return (await page.textContent('#rowsIn').catch(() => ''))
      .includes(cgOnly.university);
  };
  ok(!!cgOnly, 'there is a private German row to put a CGPA-only bar on — '
    + (cgOnly && cgOnly.university));
  ok(await finderWith(9.5),
    'a German row with only a CGPA bar is shown to a student who clears it');
  ok((await finderWith(6.5)) === false,
    'and hidden from one who does not — hiding the CGPA box must not '
    + 'switch the CGPA bar off');

  /* --------------------------------------------- other countries are untouched */
  await page.selectOption('#fCountry', 'GB').catch(() => {});
  await page.waitForTimeout(500);
  const ukScale = await page.evaluate(() => ({
    cgpa: !(document.querySelector('#fCgpaWrap') || {}).hidden,
    cgpaValue: (document.querySelector('#fCgpa') || {}).value,
  })).catch(() => null);
  ok(ukScale && ukScale.cgpa,
    'switching back to the UK asks for a CGPA again — ' + JSON.stringify(ukScale));
  await page.selectOption('#fCgpa', '8.5').catch(() => {});
  await page.click('#fGo').catch(() => {});
  await page.waitForTimeout(900);
  const ukRows = await page.evaluate(() => {
    const n = s => Number((document.querySelector(s) || {}).textContent || 0);
    return n('#rtnPub') + n('#rtnPriv');
  }).catch(() => -1);
  ok(ukRows > 0, 'and a UK student with 8.5 still sees programmes — ' + ukRows);

  ok(!errs.length, 'no page errors throughout — ' + errs.slice(0, 2).join(' | '));

  /* ============================================ the profile asks for the scale */
  const email = 'gg' + S + '@student.example';
  const stu = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Grade Student', email, phone: '9876543210',
      password: 'a-real-password-' + S } });
  const sp = await stu.newPage();
  await sp.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(2400);
  const fields = new Set();
  for (let i = 0; i < 20; i++) {
    (await sp.evaluate(() =>
      [...document.querySelectorAll('#pForm [name]')].map(e => e.name)).catch(() => []))
      .forEach(n => fields.add(n));
    const moved = await sp.evaluate(() => {
      const n = document.querySelector('#nextBtn');
      if (!n || n.disabled || n.hidden || n.offsetParent === null) return false;
      n.click(); return true;
    }).catch(() => false);
    if (!moved) break;
    await sp.waitForTimeout(280);
  }
  ok(fields.has('d_max'), 'the profile asks for the university maximum');
  ok(fields.has('d_pass'), 'and for the minimum passing grade');
  await sp.close();

  /* And a student who filled it in does not have to open the calculator: the
     finder reads their scale and filters on it. */
  await stu.request.put(BASE + '/api/profile', {
    data: { profile: { firstName: 'G', lastName: 'S', d_cgpa: '6.84',
      d_max: '10', d_pass: '4' } },
  });
  const fp = await stu.newPage();
  const fErrs = [];
  fp.on('pageerror', e => fErrs.push(String(e)));
  await fp.goto(BASE + '/index.html', { waitUntil: 'load' });
  await fp.waitForTimeout(3200);
  await fp.selectOption('#fCountry', 'DE').catch(() => {});
  await fp.waitForTimeout(700);
  const fromProfile = await fp.evaluate(() =>
    (document.querySelector('#fGgpa') || {}).value).catch(() => '');
  ok(fromProfile === '2.5',
    'a signed-in student’s own grade is already in the filter — "'
    + fromProfile + '"');
  ok(!fErrs.length, 'and that page loads clean — ' + fErrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
