/**
 * The spreadsheet round trip, through the actual screen.
 *
 * Download the catalogue, edit it the way a counsellor would (change a fee,
 * add a university, and — deliberately — get one row wrong), upload it, read
 * the plan, apply it, and then check the home page's own catalogue endpoint to
 * see whether the change really reached the site.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const SHEET = require('../server/sheet.js');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (name, pass, note) => (pass ? ok : bad).push(name + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  const li = await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  check('sign in as admin', li.ok(), li.status());

  /* ---------------------------------------------------------- download */
  const dl = await ctx.request.get(BASE + '/api/staff/catalogue.xlsx');
  const buf = Buffer.from(await dl.body());
  check('download .xlsx', dl.ok() && buf.slice(0, 2).toString() === 'PK',
    buf.length + ' bytes, ' + dl.headers()['content-disposition']);

  const csv = await ctx.request.get(BASE + '/api/staff/catalogue.csv');
  check('download .csv', csv.ok() && (await csv.text()).split('\n').length > 100);

  const rows = SHEET.readXlsx(buf);
  const header = rows[0];
  check('the sheet has a header', header[0] === 'id' && header.includes('total tuition inr'),
    header.join('|').slice(0, 80));
  const nBefore = rows.length - 1;
  check('every programme is in it', nBefore > 150, nBefore + ' rows');

  /* ------------------------------------------------------------ edit it */
  const iFee = header.indexOf('total tuition inr');
  const iUni = header.indexOf('university');
  const iCountry = header.indexOf('country code');
  const iProg = header.indexOf('programme');

  const victim = rows[1];
  const victimId = victim[0];
  const feeBefore = Number(victim[iFee]);
  victim[iFee] = feeBefore + 111000;                       // a change

  const blank = header.map(() => '');                      // a new one
  blank[iProg] = 'MSc Marine Robotics';
  blank[iUni] = 'University of Aberdeen';
  blank[iCountry] = 'GB';
  blank[header.indexOf('city')] = 'Aberdeen';
  blank[header.indexOf('level')] = 'master';
  blank[header.indexOf('field')] = 'Engineering';
  blank[iFee] = 1850000;
  blank[header.indexOf('public university')] = 'no';
  blank[header.indexOf('on the site')] = 'yes';
  blank[header.indexOf('intake 1 season')] = 'winter';
  blank[header.indexOf('intake 1 deadline')] = '2027-01-15';

  const wrong = header.map(() => '');                      // and a wrong one
  wrong[iProg] = 'BSc Nonsense';
  wrong[iUni] = 'University of Nowhere';
  wrong[iCountry] = 'ZZ';

  const edited = SHEET.writeXlsx(header, rows.slice(1).concat([blank, wrong]), 'Catalogue');
  fs.writeFileSync('/tmp/cat-edited.xlsx', edited);

  /* ------------------------------------------------------- on the screen */
  const page = await ctx.newPage();
  const errs = [];
  /* Google Fonts is unreachable from this sandbox, and a blocked webfont is
     not a defect in the spreadsheet import. Every other suite filters these;
     this one did not, so it reported one red check on every clean run and
     taught everybody to ignore its result. */
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|fonts\.gstatic|favicon|ERR_NAME_NOT_RESOLVED/.test(m.text())
    && errs.push(m.text()));
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/catalogue', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#progRows tr');

  await page.click('.tab[data-t="sheet"]');
  check('the Spreadsheet tab opens', await page.isVisible('#sFile'));

  await page.setInputFiles('#sFile', '/tmp/cat-edited.xlsx');
  await page.click('#sCheck');
  await page.waitForSelector('#sApply', { timeout: 20000 });

  const counts = await page.$$eval('#sOut .out b', els => els.map(e => e.textContent.trim()));
  check('the plan says 1 to add', counts[0] === '1', counts.join('/'));
  check('the plan says 1 to change', counts[1] === '1', counts.join('/'));
  check('the plan says 1 cannot import', counts[3] === '1', counts.join('/'));

  const planText = await page.textContent('#sOut');
  check('it names the new programme', planText.includes('MSc Marine Robotics'));
  check('it says why the bad row failed',
    /does not exist yet/.test(planText), planText.slice(0, 0));
  check('it warns the bad row will be skipped', /will be skipped/.test(planText));

  /* Nothing may have been written yet. */
  const midFee = (await (await ctx.request.get(BASE + '/api/staff/catalogue')).json())
    .programmes.find(p => p.id === victimId).totalInr;
  check('the preview wrote nothing', midFee === feeBefore, midFee + ' vs ' + feeBefore);

  /* --------------------------------------------------------------- apply */
  await page.click('#sApply');
  await page.waitForFunction(() => /added,/.test(document.querySelector('#sOut').textContent),
    null, { timeout: 20000 });
  const done = await page.textContent('#sOut');
  check('it reports what it did', /1 added, 1 updated/.test(done), done.trim().slice(0, 90));

  const after = await (await ctx.request.get(BASE + '/api/staff/catalogue')).json();
  const v = after.programmes.find(p => p.id === victimId);
  check('the fee actually changed', v.totalInr === feeBefore + 111000, v.totalInr);
  const nu = after.programmes.find(p => p.program === 'MSc Marine Robotics');
  check('the new programme exists', !!nu && nu.university === 'University of Aberdeen');
  check('nothing was deleted', after.programmes.length === nBefore + 1,
    after.programmes.length + ' vs ' + (nBefore + 1));
  check('the bad row was not created',
    !after.programmes.some(p => p.program === 'BSc Nonsense'));

  /* The point of the whole exercise: is it on the public site? */
  const pub = await (await ctx.request.get(BASE + '/api/catalogue')).json();
  const live = (pub.programmes || pub).find(p => p.program === 'MSc Marine Robotics');
  check('it is on the public finder', !!live, live ? live.university : 'missing');

  /* And is it in the audit trail? */
  check('the import is recorded',
    after.audit.some(a => /imported from a sheet/.test(a.what)),
    (after.audit[0] || {}).what);

  /* -------------------------------------------- the table refreshed too */
  await page.click('.tab[data-t="prog"]');
  await page.fill('#q', 'Marine Robotics');
  await page.waitForTimeout(300);
  check('the table shows it without a reload',
    (await page.textContent('#progRows')).includes('Aberdeen'));

  check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
