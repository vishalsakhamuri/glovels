/**
 * The finder's own settings, and the office's contact links.
 *
 * Small screen, but every field on it is a business decision that used to need
 * a developer: how many universities a visitor sees before they have a reason
 * to pay, what a euro is worth, what the budget buckets are, and the WhatsApp
 * number every page links to.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const homeCounts = async ctx => {
  const p = await ctx.newPage();
  await p.goto(BASE + '/#catalogue', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  const out = await p.evaluate(() => ({
    /* The band chips on the showcase carry the label from BANDS; the filter
       tabs above them are static markup whose words live on the Page text tab.
       Both are real, and this reads the one the Finder tab owns. */
    bandLabels: [...document.querySelectorAll('#catalogue .cband')].map(x => x.textContent.trim()),
    bandsOn: [...document.querySelectorAll('#catalogue .ccard')].map(x => x.dataset.band),
    trending: document.querySelectorAll('#catalogue .ctrend').length,
    wa: (document.querySelector('a[href*="wa.me/"]') || {}).href || '',
    text: document.body.innerText,
  }));
  await p.close();
  return out;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const before = await homeCounts(ctx);
  check('the home page has a wa.me link to change', /wa\.me\/\d+/.test(before.wa), before.wa);

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pkgTabs table', { timeout: 15000 });
  await page.click('.tab[data-t="find"]');
  await page.waitForSelector('#fBrowsePub', { timeout: 10000 });

  check('the tab is there', await page.isVisible('#fBrowsePub'));
  check('it is filled in from what the site shipped with',
    (await page.inputValue('#fBrowsePub')) === '3', await page.inputValue('#fBrowsePub'));
  check('the budget bands are listed',
    (await page.$$('#bandRows input')).length >= 8,
    (await page.$$('#bandRows input')).length);
  check('the currencies are listed',
    (await page.inputValue('#fxEUR')).length > 0, await page.inputValue('#fxEUR'));
  check('the trending chips are one per line',
    (await page.inputValue('#fTrend')).split('\n').length >= 5,
    (await page.inputValue('#fTrend')).split('\n').length);

  /* ------------------------------------------------------------ change them */
  await page.fill('#fBrowsePub', '6');
  await page.fill('#fxEUR', '125');
  await page.fill('#bl0', 'Budget — under ₹10L');
  await page.fill('#fTrend', 'Data Science, AI & Machine Learning\nNursing & Healthcare');
  await page.fill('#fWa', '919000000123');
  await page.fill('#fEmail', 'hello@glovels.com');
  await page.click('#findSave');
  await page.waitForTimeout(1500);

  const saved = await (await ctx.request.get(BASE + '/api/content')).json();
  check('the browse count is stored', saved.finder.browsePublic === 6, saved.finder.browsePublic);
  check('the euro rate is stored', saved.finder.fx.EUR === 125, saved.finder.fx.EUR);
  check('the band label is stored', /Budget/.test(saved.finder.bands[0].label),
    saved.finder.bands[0].label);
  check('the top band still has no ceiling',
    saved.finder.bands[saved.finder.bands.length - 1].ceilInr === null,
    String(saved.finder.bands[saved.finder.bands.length - 1].ceilInr));
  check('the trending list is stored', saved.finder.trending.length === 2,
    saved.finder.trending.join(' | '));
  check('the WhatsApp number is stored', saved.finder.contact.whatsapp === '919000000123',
    saved.finder.contact.whatsapp);

  /* ------------------------------------------------- and the site follows */
  const after = await homeCounts(ctx);
  check('the WhatsApp link on the site now points at the new number',
    after.wa.includes('919000000123'), after.wa);
  check('the renamed budget band is on the university cards',
    after.bandLabels.join(' | ').includes('Budget'),
    after.bandLabels.slice(0, 4).join(' | '));
  /* `|| after.trending >= 0` was in this line for a while, which made it true
     whatever happened — a check that cannot fail is a comment with a tick
     beside it. Removing two fields from the list has to remove badges. */
  check('the trending badge follows the list', after.trending < before.trending,
    before.trending + ' -> ' + after.trending);

  /* -------------------------- a ceiling is a real boundary, not a label */
  /* This is the one that decides whether the screen is telling the truth: a
     programme's bucket is worked out from its fee, so moving the ceiling has to
     move the programmes. */
  const cat = await (await ctx.request.get(BASE + '/api/staff/catalogue')).json();
  const mid = cat.programmes.find(p => p.totalInr > 1200000 && p.totalInr < 1900000);
  check('there is a programme between ₹12L and ₹19L to move', !!mid,
    mid && mid.totalInr);

  if (mid) {
    check('it starts in the under-₹20L bucket', mid.band === 'u20', mid.band);
    const lifted = JSON.parse(JSON.stringify(saved.finder));
    lifted.bands[0].ceilInr = 2500000;                 /* under-₹10L now takes it */
    const put = await ctx.request.put(BASE + '/api/staff/content/finder', { data: { value: lifted } });
    const body = await put.json();
    check('changing a ceiling re-bands the catalogue', (body.moved || 0) > 0, body.moved);

    const again = await (await ctx.request.get(BASE + '/api/staff/catalogue')).json();
    const moved = again.programmes.find(p => p.id === mid.id);
    check('and that programme actually moved bucket', moved.band === 'u10', moved.band);

    /* Put it back, so the checks below run against sane numbers. */
    await ctx.request.put(BASE + '/api/staff/content/finder', { data: { value: saved.finder } });
  }

  /* ---------------------------------------------------------- nonsense */
  await ctx.request.put(BASE + '/api/staff/content/finder', {
    data: { value: Object.assign({}, saved.finder, { browsePublic: 9999, fx: { EUR: -5 } }) },
  });
  const clamped = await (await ctx.request.get(BASE + '/api/content')).json();
  check('an absurd browse count is clamped', clamped.finder.browsePublic <= 50,
    clamped.finder.browsePublic);
  check('a negative exchange rate is refused rather than stored',
    !clamped.finder.fx.EUR || clamped.finder.fx.EUR > 0, String(clamped.finder.fx.EUR));

  /* ---------------------------------------------- private first, then public
     The results used to be one list with the public universities blurred at the
     bottom, so a visitor's first sight of the finder was a column of grey bars
     — a paywall before anything of value. */
  const v = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } }))
    .newPage();
  const verrs = [];
  v.on('pageerror', e => verrs.push(String(e)));
  await v.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await v.waitForTimeout(2400);

  check('the results have two tabs', (await v.$$('.rtab')).length === 2);
  check('and the one that opens is Private',
    (await v.$eval('.rtab.on', el => el.dataset.rt)) === 'priv',
    await v.$eval('.rtab.on', el => el.dataset.rt));
  check('so nothing a visitor sees first is blurred',
    (await v.$$('#rowsIn .masked')).length === 0,
    (await v.$$('#rowsIn .masked')).length + ' blurred rows');
  check('every row on it is readable',
    (await v.$$('#rowsIn .mrow')).length > 0,
    (await v.$$('#rowsIn .mrow')).length + ' rows');

  const pubCount = Number(await v.textContent('#rtnPub'));
  check('the public tab says how many are behind it', pubCount > 0, pubCount);

  await v.click('.rtab[data-rt="pub"]');
  await v.waitForTimeout(700);
  check('pressing it shows the public ones',
    (await v.$$('#rowsIn .masked')).length > 0,
    (await v.$$('#rowsIn .masked')).length + ' blurred');
  check('and only the public ones — no private rows mixed in',
    (await v.$$eval('#rowsIn .mtype.priv', els => els.length)) === 0);

  await v.click('.rtab[data-rt="priv"]');
  await v.waitForTimeout(700);
  check('and back again shows only the private ones',
    (await v.$$eval('#rowsIn .mtype.pub', els => els.length)) === 0);

  /* An ampersand stored as an HTML entity was escaped twice and rendered as
     "&amp;" in three programme names. */
  await v.selectOption('#fCountry', 'DE');
  await v.selectOption('#fLevel', 'master');
  await v.click('#fGo');
  await v.waitForTimeout(1600);
  check('no HTML entity leaks into a programme name',
    !(await v.innerText('#rowsIn')).includes('&amp;'),
    ((await v.innerText('#rowsIn')).match(/&\w+;/) || [''])[0]);
  check('no page errors on the finder', verrs.length === 0, verrs[0]);
  await v.close();

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
