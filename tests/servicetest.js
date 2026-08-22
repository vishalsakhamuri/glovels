/**
 * The services grid — SOP, LOR, CV, visa, test prep, language, loan.
 *
 * 26 cards with prices, categories, badges and turnaround times, frozen in the
 * page since it was generated. Every check here edits one from the operations
 * site and then reads the public home page to see whether it changed.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8086';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const home = async (ctx, expect) => {
  const p = await ctx.newPage();
  await p.goto(BASE + '/#services', { waitUntil: 'domcontentloaded' });
  if (expect) {
    /* Every string that should be there, not just the first. The grid is
       painted in one pass, but the wait used to return as soon as the NAME
       appeared and then read the prices — which under load were still the old
       ones for another frame. A test that fails once in five runs gets ignored
       exactly as fast as one that always fails. */
    for (const t of [].concat(expect)) {
      await p.waitForFunction(
        s => document.getElementById('services').innerText.includes(s),
        t, { timeout: 15000 },
      ).catch(() => {});
    }
  } else {
    await p.waitForTimeout(2600);
  }
  const out = {
    text: await p.textContent('#services'),
    names: await p.$$eval('#services .svc h4', els => els.map(e => e.textContent.trim())),
    prices: await p.$$eval('#services .svc-now', els => els.map(e => e.textContent.trim())),
  };
  await p.close();
  return out;
};

/* Open a service's editor, and mean it.
   The table repaints after every save, so an element found a moment ago can be
   detached by the time it is clicked — the click then lands on nothing, quietly,
   and the failure shows up as a timeout on a modal that was never asked to
   open. Clicking through a locator re-resolves the element, and the retry covers
   a repaint that lands between resolving and clicking. */
const openService = async (page, id) => {
  const row = page.locator('[data-sedit="' + id + '"]').first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    try {
      await page.waitForSelector('#sName', { state: 'visible', timeout: 3000 });
      return true;
    } catch (e) { await page.waitForTimeout(500); }
  }
  return false;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pkgTabs table', { timeout: 15000 });
  await page.click('.tab[data-t="svc"]');
  await page.waitForSelector('#svcCats table', { timeout: 10000 });

  check('the Services tab lists them',
    Number(await page.textContent('#nSvc')) >= 20, await page.textContent('#nSvc'));
  check('grouped by the categories the visitor sees',
    (await page.textContent('#svcCats')).includes('Most Booked')
    && (await page.textContent('#svcCats')).includes('Test Prep'));

  /* ------------------------------------------------------- edit a price */
  check('the SOP editor opens', await openService(page, 'sop'));
  check('the editor opens with the service in it',
    (await page.inputValue('#sName')).includes('SOP'), await page.inputValue('#sName'));

  await page.fill('#sName', 'SOP Writing & Editing');
  await page.fill('#sPrice', '1499');
  await page.fill('#sMeta', 'AI draft in ~60s · final same day');
  await page.selectOption('#sBadge', 'value');
  await page.click('#smSave');
  await page.waitForTimeout(800);
  check('the editor closes on save', !(await page.isVisible('#svcModal .sheet')));

  let h = await home(ctx, ['SOP Writing & Editing', '1,499', 'final same day']);
  check('the new name is on the home page', h.names.includes('SOP Writing & Editing'),
    h.names.slice(0, 3).join(' | '));
  check('the new price is on the home page', h.text.includes('1,499'),
    h.prices.slice(0, 4).join(' | '));
  check('the new turnaround is there', h.text.includes('final same day'));

  /* ---------------------------------------------------- add a service */
  await page.click('#addSvc');
  await page.waitForSelector('#sName');
  await page.fill('#sName', 'Accommodation Search');
  await page.fill('#sDesc', 'A room found and booked before you land, near your campus.');
  await page.fill('#sMeta', '5–7 days');
  await page.fill('#sPrice', '2999');
  await page.check('#sCat_top');
  await page.click('#smSave');
  await page.waitForTimeout(800);

  h = await home(ctx, ['Accommodation Search', '2,999']);
  check('a brand-new service appears on the home page',
    h.names.includes('Accommodation Search'));
  check('with its price', h.text.includes('2,999'));

  const pub = await (await ctx.request.get(BASE + '/api/content')).json();
  check('it got a usable id',
    pub.services.items.some(x => x.id === 'accommodation-search'),
    pub.services.items.map(x => x.id).slice(-3).join(','));

  /* --------------------------------------------------------- hide it */
  check('the new service can be reopened', await openService(page, 'accommodation-search'));
  await page.waitForSelector('#sActive', { timeout: 10000 });
  await page.uncheck('#sActive');
  await page.click('#smSave');
  await page.waitForTimeout(800);
  h = await home(ctx);
  check('hiding takes it off the home page', !h.names.includes('Accommodation Search'));

  /* ------------------------------------ a category decides where it shows */
  await openService(page, 'ielts').catch(() => false);
  if (await page.isVisible('#sName')) {
    const before = await page.isChecked('#sCat_top');
    await page.setChecked('#sCat_top', !before);
    await page.click('#smSave');
    await page.waitForTimeout(700);
    const after = await (await ctx.request.get(BASE + '/api/content')).json();
    const ielts = after.services.items.find(x => x.id === 'ielts');
    check('a category can be added or removed',
      (ielts.cats.indexOf('top') >= 0) !== before,
      ielts.cats.join(','));
  }

  /* -------------------------------------- the language price list survives */
  const langs = pub.services.items.filter(x => (x.levels || []).length);
  check('level pricing rode through untouched', langs.length > 0,
    langs.map(x => x.id + ':' + x.levels.length).join(' '));

  /* ------------------------------------------------------- the spreadsheet */
  const dl = await ctx.request.get(BASE + '/api/staff/content/services.csv');
  const csv = await dl.text();
  check('services download as a sheet', dl.ok() && /service/.test(csv.split('\n')[0]),
    csv.split('\n')[0].slice(0, 70));

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
