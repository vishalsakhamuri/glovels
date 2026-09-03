/**
 * "Make sure the excel upload has all relevant fields otherwise exact filter
 *  will not work… in the website and counsellors websites."
 *
 * Patch 44 put the CGPA bar in the sheet and taught the public finder to read
 * it. Three things were still wrong, and each only shows up if you follow the
 * number all the way through:
 *
 *  1. A CGPA typed into the spreadsheet was SILENTLY DISCARDED. The import
 *     decides what changed by comparing a list of fields, and the two new
 *     columns were not on that list — so a row whose only edit was the CGPA
 *     compared equal, landed in "unchanged", and the apply pass skipped it.
 *     The office was told 171 rows were fine and nothing was written.
 *
 *  2. The student's own Browse tab had no idea a bar existed. It offered every
 *     university in the catalogue to a student who could not apply to half of
 *     them — after they had paid.
 *
 *  3. The counsellor's search was the same: a name, a course, a country, and
 *     no sign that this student would be turned away. A shortlist agreed on a
 *     call is typed in from that box.
 *
 * This drives all three the way a person would.
 */
const SHEET = require('/home/claude/glovels/build/server/sheet.js');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, p, note) => (p ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ============================================= 1. the spreadsheet, for real */
  const buf = Buffer.from(await (await admin.request.get(BASE + '/api/staff/catalogue.xlsx')).body());
  const rows = SHEET.readXlsx(buf);
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const FILTERS = ['country code', 'level', 'field', 'minimum cgpa', 'budget band',
    'total tuition inr', 'public university', 'fit score', 'intake 1 deadline', 'on the site'];
  check('the .xlsx has a column for every field the filters read',
    FILTERS.every(h => head.includes(h)),
    FILTERS.filter(h => !head.includes(h)).join(', ') || 'all present');

  const cCg = head.indexOf('minimum cgpa'), cUni = head.indexOf('university'),
        cCo = head.indexOf('country code'), cPub = head.indexOf('public university');
  check('and every row downloads blank rather than 0',
    rows.slice(1).every(r => r[cCg] === '' || r[cCg] == null));

  /* "When I downloaded I got a sheet but I cannot see cgpa column filled at
     all… in the master data it should be there."
     It was blank on purpose — `minimum cgpa` is an OVERRIDE and blank means
     "follow the destination's rule", which is right for almost every row. But
     a column of 171 blanks tells nobody what bar is actually in force, so the
     sheet now carries that beside it, read-only. */
  const cInf = head.indexOf('cgpa in force');
  check('the sheet says what bar is actually in force', cInf >= 0);
  check('and it is filled on every row that has a rule behind it',
    rows.slice(1).filter(r => r[cInf] !== '' && r[cInf] != null).length === rows.length - 1,
    rows.slice(1).filter(r => r[cInf] === '' || r[cInf] == null).length + ' rows with no rule');
  /* Germany's public rule, read off the sheet rather than assumed. */
  const cLvl = head.indexOf('public university');
  const dePub = rows.slice(1).find(r => r[cCo] === 'DE' && /^(y|yes|true)$/i.test(String(r[cLvl])));
  check('a German public row shows the destination’s rule, not a blank',
    dePub && Number(dePub[cInf]) > 0, dePub && dePub[cInf]);

  const target = rows.slice(1).find(r => r[cCo] === 'DE' &&
    !/^(y|yes|true)$/i.test(String(r[cPub])));
  const uni = target[cUni];
  target[cCg] = 9.4;                                  // typed in Excel, nothing else touched

  const file = { name: 'catalogue.xlsx', mimeType:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(SHEET.writeXlsx(rows[0], rows.slice(1), 'Catalogue')) };

  const plan = await (await admin.request.post(BASE + '/api/staff/catalogue/import',
    { multipart: { file } })).json();
  /* THE regression. Before this patch the preview said "171 unchanged" and the
     confirm pass wrote nothing at all. */
  /* And the read-only column travels back up without being mistaken for data —
     an unrecognised column is REPORTED, so a silent one would show here. */
  check('the extra column is not treated as an unknown one',
    (plan.plan.unknownColumns || []).length === 0,
    JSON.stringify(plan.plan.unknownColumns));
  check('the preview sees the edit and names the field',
    plan.counts.update === 1 && (plan.plan.update[0].changed || []).includes('minCgpa'),
    JSON.stringify(plan.counts) + ' ' + JSON.stringify(plan.plan.update.map(u => u.changed)));
  const applied = await (await admin.request.post(BASE + '/api/staff/catalogue/import',
    { multipart: { file, confirm: 'yes' } })).json();
  check('and confirming actually writes it', applied.updated === 1, JSON.stringify(applied));

  const cat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json();
  const prog = cat.programmes.find(p => p.university === uni && p.country === 'DE');
  check('the number typed into Excel is on the programme',
    prog && Number(prog.minCgpa) === 9.4, prog && JSON.stringify(prog.minCgpa));
  check('and no other row picked one up',
    cat.programmes.filter(p => p.minCgpa != null).length === 1,
    cat.programmes.filter(p => p.minCgpa != null).map(p => p.university).join(', '));

  /* ================================================= 2. the public home page */
  const vp = { viewport: { width: 1500, height: 1050 } };
  const page = await (await browser.newContext(vp)).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const finder = async cgpa => {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.selectOption('#fCountry', 'DE');
    /* Germany asks for a German grade, not a CGPA — so the CGPA gets in the way
       the student's does, through the calculator. */
    await page.click('#openGg');
    await page.fill('#ggMax', '10');
    await page.fill('#ggPass', '4');
    await page.fill('#ggNow', String(cgpa));
    await page.waitForTimeout(400);
    await page.click('#ggUse');
    await page.waitForTimeout(500);
    const go = await page.$('text=Find Programs'); if (go) await go.click();
    await page.waitForTimeout(1400);
    return { has: (await page.textContent('#rowsIn')).includes(uni),
             n: (await page.$$('#rowsIn .mrow')).length };
  };
  const hi = await finder('9.5'), lo = await finder('6.5');
  check('the finder shows it to a student who clears the bar', hi.has, 'rows ' + hi.n);
  check('and hides it from one who does not', lo.has === false, 'rows ' + lo.n);
  check('without emptying the country', lo.n > 1, 'rows ' + lo.n);
  check('no errors on the home page', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ============================== 3. the student's own Browse tab, signed in */
  const stamp = Date.now();
  const email = 'reach' + stamp + '@example.com';
  const buyer = await browser.newContext(vp);
  await buyer.request.post(BASE + '/api/orders', {
    data: { services: [{ id: 'shortlist-ten' }], name: 'Reach ' + stamp,
      email, phone: '+919000008888', acceptedTerms: true },
  });
  await buyer.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
  await buyer.request.put(BASE + '/api/profile', {
    data: { profile: { fullName: 'Reach', d_cgpa: '6.5', g_level: "Master's",
      g_field: 'Data Science', g_country: 'Germany', b_total: 'Above ₹40 Lakhs' } },
  });

  const sp = await buyer.newPage();
  const serrs = []; sp.on('pageerror', e => serrs.push(String(e)));
  const browse = async mode => {
    await sp.goto(BASE + '/universities.html', { waitUntil: 'domcontentloaded' });
    await sp.waitForTimeout(2400);
    await sp.click('.tab[data-pane="browse"]');
    await sp.waitForTimeout(400);
    await sp.selectOption('#fCountry', 'DE');
    await sp.selectOption('#fReach', mode);
    await sp.waitForTimeout(600);
    return { html: await sp.innerHTML('#allGrid'), count: await sp.textContent('#cCount') };
  };
  const mineOnly = await browse('mine');
  check('signed in, Browse hides the one they cannot apply to',
    !mineOnly.html.includes(uni), uni);
  check('and says so rather than hiding it silently',
    /higher CGPA than 6\.5/.test(mineOnly.count), mineOnly.count);

  const everything = await browse('all');
  check('switching to “every programme” brings it back',
    everything.html.includes(uni));
  check('marked as above their CGPA',
    /Asks for 9\.4\+ CGPA — above yours/.test(everything.html),
    (everything.html.match(/Asks for [^<]*/g) || []).slice(0, 3).join(' | '));
  /* And the ones they DO clear say so plainly rather than saying nothing —
     a blank card and a card that has been checked look identical otherwise. */
  const kept = mineOnly.html.match(/Asks for [^<]*/g) || [];
  check('and the ones they DO clear carry the bar without the warning',
    kept.length > 0 && kept.every(m => !/above yours/.test(m)),
    kept.slice(0, 3).join(' | ') || 'no bar shown on any kept card');
  check('no errors on the student screen', serrs.length === 0, serrs.slice(0, 2).join(' | '));

  /* ==================================== 4. the counsellor, building that list */
  const who = (await (await admin.request.get(BASE + '/api/staff/students')).json())
    .students.find(u => u.email === email);
  check('the student is on the counsellor’s list', !!who, email);

  const cp = await admin.newPage();
  const cerrs = []; cp.on('pageerror', e => cerrs.push(String(e)));
  await cp.goto(BASE + '/counsellor.html', { waitUntil: 'domcontentloaded' });
  await cp.waitForTimeout(2800);
  await cp.click('[data-open="' + who.id + '"]');
  await cp.waitForTimeout(1800);
  await cp.click('.tab[data-t="file"]');          // the record, not the chat
  await cp.waitForTimeout(500);
  await cp.click('#addUni');                       // opens the search box
  await cp.waitForTimeout(400);
  await cp.fill('#uniQ', uni.slice(0, 12));
  await cp.waitForTimeout(1800);
  const hits = await cp.innerHTML('#uniHits');
  check('the counsellor’s search finds it', hits.includes(uni.slice(0, 12)), hits.slice(0, 160));
  check('and warns that this student is below its bar',
    /Asks for 9\.4\+ CGPA — they have 6\.5/.test(hits),
    (hits.match(/Asks for [^<]*/g) || []).slice(0, 3).join(' | '));
  check('the Add button is still there — the counsellor decides, not the screen',
    /data-uniadd/.test(hits));
  check('no errors on the counsellor screen', cerrs.length === 0, cerrs.slice(0, 2).join(' | '));

  /* leave the catalogue as it was found */
  await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, prog, { minCgpa: '' }) });

  await browser.close();
  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
