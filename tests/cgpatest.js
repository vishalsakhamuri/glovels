/**
 * The CGPA bar, from the spreadsheet to the filter.
 *
 * "CGPA is missing in the excel sheet for universities to upload… make sure
 *  excel upload has all relevant fields otherwise exact filter will not work."
 *
 * It was worse than missing. `filtered()` on the home page has always PREFERRED
 * a programme's own cut-off over its country's —
 *
 *     const bar = p.minCgpa != null ? p.minCgpa : (country rule)
 *
 * — and the field behind `p.minCgpa` existed nowhere: not in the database, not
 * in the API, not in the sheet, and hardcoded to `null` in the one place the
 * page built its rows. So the preference could never fire, and every programme
 * in a country shared one bar. A student with 6.8 was turned away from a whole
 * country when a dozen of its universities would have taken them, and there was
 * no way for anybody to say otherwise.
 *
 * This walks the whole path, because every link in it was broken and a test of
 * any one of them would have passed on its own:
 *
 *   the column exists in the sheet, and comes back down again
 *   the editor saves it, and blank stays blank rather than becoming 0
 *   the API carries it — INCLUDING on a locked row, where it matters most
 *   the finder filters on it, beating the country rule
 *   the matcher will not sell a ₹99 shortlist somebody cannot apply to
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------------- the sheet */
  const csv = await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text();
  const header = csv.split('\n')[0].replace(/^﻿/, '').split(',').map(h => h.trim());

  /* Every field the finder filters on has to be a column, or a bulk upload
     cannot describe what the site actually does with it. */
  const FILTERS = ['country code', 'level', 'field', 'minimum cgpa',
    'intake 1 season', 'intake 1 deadline', 'budget band', 'total tuition inr',
    'public university', 'fit score', 'on the site'];
  check('the sheet has a column for every field the finder filters on',
    FILTERS.every(h => header.includes(h)),
    FILTERS.filter(h => !header.includes(h)).join(', ') || 'all present');

  /* --------------------------------------------------- saving one, and blank */
  const cat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json();
  const priv = cat.programmes.find(p => !p.isPublic && p.country === 'DE');
  const pub = cat.programmes.find(p => p.isPublic && p.country === 'DE');
  check('there is a private German programme to work with', !!priv, priv && priv.university);
  check('and a public one', !!pub, pub && pub.university);

  check('a programme with no stated bar reads as blank, not 0',
    priv.minCgpa === null || priv.minCgpa === undefined, JSON.stringify(priv.minCgpa));

  const saved = await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, priv, { minCgpa: 9.4 }) });
  check('a bar can be saved against one programme', saved.status() === 200, saved.status());
  check('and comes back as the number that was typed',
    (await saved.json()).programme.minCgpa === 9.4);

  await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, pub, { minCgpa: 9.4 }) });

  /* Blank must survive a round trip. Stored as 0 it would mean "takes
     anybody" — the same filter, silently switched off. */
  const cleared = await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, priv, { minCgpa: '' }) });
  check('clearing it stores blank rather than zero',
    (await cleared.json()).programme.minCgpa === null,
    JSON.stringify((await cleared.json()).programme.minCgpa));
  await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, priv, { minCgpa: 9.4 }) });

  /* ---------------------------------------------------------------- the API */
  const anon = await browser.newContext();
  const live = await (await anon.request.get(BASE + '/api/catalogue')).json();
  const rows = live.programmes || [];
  const privRow = rows.find(r => String(r.id) === String(priv.id));
  const pubRow = rows.find(r => String(r.id) === String(pub.id));

  check('the public catalogue carries the bar on a named row',
    privRow && Number(privRow.minCgpa) === 9.4, privRow && privRow.minCgpa);

  /* The one that matters most. A locked row is stripped of everything
     identifying before it leaves the server — but a requirement is not an
     identity, and withholding it would mean the finder filters gated rows by
     the country's rule while naming them by their own. A student would be
     shown a locked row they cannot apply to, and charged to unlock it. */
  check('and on a locked one, where the student cannot see the name',
    pubRow && !pubRow.university && Number(pubRow.minCgpa) === 9.4,
    pubRow && JSON.stringify({ named: !!pubRow.university, bar: pubRow.minCgpa }));

  /* --------------------------------------------------------- and the finder */
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1050 } }))
    .newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  /* Germany hides the CGPA control by design — the destination is graded on the
     German scale, so the student is asked for a German grade and handed the
     calculator to work one out. Driving that calculator is therefore how a CGPA
     reaches the German filter, and it is the path the student actually walks:
     three numbers off their transcript, then "Use this in the finder". */
  const useGerman = async cgpa => {
    await page.click('#openGg');
    await page.fill('#ggMax', '10');
    await page.fill('#ggPass', '4');
    await page.fill('#ggNow', String(cgpa));
    await page.waitForTimeout(400);
    await page.click('#ggUse');
    await page.waitForTimeout(500);
  };

  const showsIt = async cgpa => {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.selectOption('#fCountry', 'DE');
    await useGerman(cgpa);
    const go = await page.$('text=Find Programs');
    if (go) await go.click();
    await page.waitForTimeout(1500);
    return (await page.textContent('#rowsIn')).includes(priv.university);
  };

  check('a student who clears the bar is shown the programme', await showsIt('9.5'));
  /* THE check. The country's rule for a private German university is 6.0, so
     without the programme's own bar this row would still be there. */
  check('and one who does not is not — the programme’s own bar beats the country’s',
    (await showsIt('6.5')) === false);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ------------------------------------------------------------ the matcher */
  const stamp = Date.now();
  const buyer = await browser.newContext();
  await buyer.request.post(BASE + '/api/orders', {
    data: {
      services: [{ id: 'shortlist-ten' }], name: 'Low CGPA ' + stamp,
      email: 'lowcgpa' + stamp + '@example.com', phone: '+919000007777',
      acceptedTerms: true,
    },
  });
  await buyer.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
  await buyer.request.put(BASE + '/api/profile', {
    data: {
      profile: {
        fullName: 'Low CGPA', g_level: "Master's", g_field: 'Data Science',
        g_country: 'Germany', b_total: 'Above ₹40 Lakhs', d_cgpa: '6.5',
      },
    },
  });
  const state = await (await buyer.request.get(BASE + '/api/state')).json();
  const shortlist = state.shortlist || [];
  check('the ₹999 shortlist was delivered', shortlist.length > 0, shortlist.length);

  /* Selling somebody a university they cannot apply to is not a near miss.
     This is the one constraint the matcher never relaxes. */
  check('and it does not include the one they cannot apply to',
    !shortlist.some(p => String(p.id) === String(priv.id)),
    shortlist.map(p => p.university).join(' | '));

  /* Put it back, so nothing after this runs against a doctored catalogue. */
  await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, priv, { minCgpa: '' }) });
  await admin.request.put(BASE + '/api/staff/programme',
    { data: Object.assign({}, pub, { minCgpa: '' }) });

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
