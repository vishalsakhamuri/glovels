/**
 * "New universities get added by Excel upload — added to the current list."
 *
 * The claim under test is not that the import works. It is that an upload
 * ADDS. A sheet that carries only the new universities must leave every
 * existing one exactly where it was: still there, still on the site, still
 * priced the same. An import that quietly treats the sheet as the whole
 * catalogue would pass a "did the new one appear?" test and destroy the
 * business.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const SHEET = require('/home/claude/glovels/build/server/sheet.js');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const all = async () => (await (await ctx.request.get(BASE + '/api/staff/catalogue')).json()).programmes;

  const before = await all();
  check('the catalogue starts with something in it', before.length > 100, before.length + ' programmes');
  const fingerprint = before.map(p => p.id + '|' + p.totalInr + '|' + p.active).sort().join('\n');

  /* A sheet with the right header and THREE rows. No ids — these are new.
     Nothing else from the catalogue is in the file at all.

     `application` is required now: every row has to say whether applying
     through us is free (we are partnered) or needs a package. A blank there
     does not fail loudly, it makes the row invisible to whoever filters on
     it — so the file is refused instead. Same for the budget band. */
  const header = ['id', 'programme', 'university', 'city', 'country code', 'level', 'field',
    'public university', 'application', 'total tuition inr', 'budget band', 'course url',
    'intake 1 season', 'intake 1 deadline', 'intake 2 season', 'intake 2 deadline',
    'on the site', 'showcase', 'showcase position'];
  const rows = [
    /* Written the way a counsellor writes: "Masters", not "master". */
    ['', 'MSc Data Science', 'Coventry University', 'Coventry', 'GB', 'Masters', 'Computing',
      'no', 'Package', 1850000, 'u20', 'https://example.com/a', 'Fall', '2027-01-15', '', '', 'yes', 'no', ''],
    ['', 'MBA Global Business', 'Griffith College', 'Dublin', 'IE', 'MBA', 'Business',
      'no', 'Package', 2600000, 'above20', 'https://example.com/b', 'autumn', '2027-02-01', '', '', 'yes', 'yes', 3],
    /* A university we have since partnered with. Free to apply to, and still
       a private one — the two are different facts. */
    ['', 'MS Cybersecurity', 'SRH Berlin', 'Berlin', 'DE', 'MSc', 'Computing',
      'no', 'Free', 3100000, 'above20', 'https://example.com/c', 'winter', '2027-01-10', '', '', 'yes', 'no', ''],
    /* A destination Glovels does not sell yet. It must be refused by name. */
    ['', 'MS Analytics', 'Pace University', 'New York', 'US', 'Masters', 'Computing',
      'no', 'Package', 3300000, 'above20', 'https://example.com/d', 'fall', '2027-01-10', '', '', 'yes', 'no', ''],
  ];
  fs.writeFileSync('/tmp/new-unis.xlsx', SHEET.writeXlsx(header, rows, 'Catalogue'));

  /* ------------------------------------------------- through the screen */
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/catalogue', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#progRows', { timeout: 15000 }).catch(() => {});
  /* The upload lives on the Spreadsheet tab. #sFile is in the markup from the
     start — hidden — so waiting for it to EXIST proves nothing. */
  await page.click('.tab[data-t="sheet"]').catch(() => {});
  await page.waitForTimeout(400);
  const hasScreen = await page.isVisible('#sFile').catch(() => false);
  check('the upload box is on the Catalogue screen', hasScreen);

  if (hasScreen) {
    await page.setInputFiles('#sFile', '/tmp/new-unis.xlsx');
    await page.click('#sCheck');
    await page.waitForSelector('#sApply', { timeout: 20000 });
    const plan = (await page.textContent('#sOut')).replace(/\s+/g, ' ');
    check('the plan says three are new', /3\s*to add/i.test(plan), plan.slice(0, 200));
    check('the plan does not propose removing anything',
      !/remove|delete|will be dropped/i.test(plan), plan.slice(0, 160));
    check('the unsellable destination is named, not silently dropped',
      /US.*does not exist yet|does not exist yet/.test(plan) && /Pace University/.test(plan),
      plan.slice(0, 220));
    check('"Masters" and "Fall" are read, not thrown away',
      !/level "Masters"|season "Fall"/.test(plan), plan.slice(0, 220));

    const mid = await all();
    check('checking wrote nothing', mid.length === before.length, mid.length);

    await page.click('#sApply');
    await page.waitForTimeout(1800);
  } else {
    /* Fall back to the endpoint so the append claim is still tested. */
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync('/tmp/new-unis.xlsx')]), 'new-unis.xlsx');
    form.append('confirm', 'yes');
    await ctx.request.post(BASE + '/api/staff/catalogue/import', { multipart: {
      file: { name: 'new-unis.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync('/tmp/new-unis.xlsx') },
      confirm: 'yes', skipBad: 'yes',
    } });
  }

  /* ------------------------------------------------------- the verdict */
  const after = await all();
  check('the three new universities are there',
    ['Coventry University', 'Griffith College', 'SRH Berlin']
      .every(u => after.some(p => p.university === u)),
    after.filter(p => /Coventry|Griffith|SRH/.test(p.university)).map(p => p.university).join(','));
  check('the count went UP by exactly three — the fourth was refused', after.length === before.length + 3,
    before.length + ' → ' + after.length);

  const stillThere = before.filter(p => !after.some(q => q.id === p.id));
  check('not one existing programme disappeared', stillThere.length === 0,
    stillThere.slice(0, 3).map(p => p.id).join(','));

  const afterFp = after.filter(p => before.some(q => q.id === p.id))
    .map(p => p.id + '|' + p.totalInr + '|' + p.active).sort().join('\n');
  check('and not one of them was altered', afterFp === fingerprint,
    afterFp === fingerprint ? '' : 'fees or visibility moved');

  /* ------------------------------------- and the site itself shows them */
  const pub = await (await ctx.request.get(BASE + '/api/catalogue')).json();
  const list = pub.programmes || pub;
  check('a new one is live on the public catalogue',
    JSON.stringify(list).includes('Coventry University'));

  /* --------------------- uploading the SAME sheet again must not double */
  const dl = await ctx.request.get(BASE + '/api/staff/catalogue.xlsx');
  const full = SHEET.readXlsx(Buffer.from(await dl.body()));
  const h = full[0], iUni = h.indexOf('university'), iFee = h.indexOf('total tuition inr');
  const cov = full.find((r, n) => n > 0 && r[iUni] === 'Coventry University');
  check('the new row comes back down with an id of its own', cov && cov[0], cov && cov[0]);
  cov[iFee] = 1900000;
  fs.writeFileSync('/tmp/edit-one.xlsx', SHEET.writeXlsx(h, [cov], 'Catalogue'));

  const r2 = await ctx.request.post(BASE + '/api/staff/catalogue/import', { multipart: {
    file: { name: 'edit-one.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync('/tmp/edit-one.xlsx') },
  } });
  const plan2 = await r2.json();
  check('a row WITH an id is an update, not a second copy',
    plan2.counts.update === 1 && plan2.counts.create === 0, JSON.stringify(plan2.counts));

  await ctx.request.post(BASE + '/api/staff/catalogue/import', { multipart: {
    file: { name: 'edit-one.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync('/tmp/edit-one.xlsx') },
    confirm: 'yes',
  } });
  const after2 = await all();
  check('the count did not move on the update pass', after2.length === after.length,
    after.length + ' → ' + after2.length);
  check('the fee actually changed',
    after2.find(p => p.university === 'Coventry University').totalInr === 1900000,
    after2.find(p => p.university === 'Coventry University').total_inr);

  /* ------------------------- the words a counsellor actually types */
  const cov2 = after2.find(p => p.university === 'Coventry University');
  check('"Masters" was stored as the level the filters use', cov2.level === 'master', cov2.level);
  check('"Fall" was stored as the autumn intake',
    (cov2.intakes[0] || {}).season === 'autumn', JSON.stringify(cov2.intakes));

  /* --------------- a change to nothing but the showcase must still apply */
  /* This is the one that was broken: showcase and its position were left out
     of the "did anything change?" comparison, so a sheet that reordered the
     university strip came back as "already right" and was skipped. */
  const dl3 = await ctx.request.get(BASE + '/api/staff/catalogue.xlsx');
  const f3 = SHEET.readXlsx(Buffer.from(await dl3.body()));
  const h3 = f3[0], iU = h3.indexOf('university');
  const iShow = h3.indexOf('showcase'), iPos = h3.indexOf('showcase position');
  const row3 = f3.find((r, n) => n > 0 && r[iU] === 'Coventry University');
  row3[iShow] = 'yes'; row3[iPos] = 2;
  fs.writeFileSync('/tmp/showcase-only.xlsx', SHEET.writeXlsx(h3, [row3], 'Catalogue'));
  const up = { file: { name: 'showcase-only.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync('/tmp/showcase-only.xlsx') } };
  const p3 = await (await ctx.request.post(BASE + '/api/staff/catalogue/import', { multipart: up })).json();
  check('a showcase-only edit is seen as a change',
    p3.counts.update === 1 && p3.counts.unchanged === 0, JSON.stringify(p3.counts));
  await ctx.request.post(BASE + '/api/staff/catalogue/import',
    { multipart: Object.assign({ confirm: 'yes' }, up) });
  const cov3 = (await all()).find(p => p.university === 'Coventry University');
  check('and it really is in the showcase now, in position 2',
    cov3.featured === true && cov3.featureSort === 2,
    cov3.featured + '/' + cov3.featureSort);

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
