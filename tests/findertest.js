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
    (await page.inputValue('#fBrowsePub')) === '12', await page.inputValue('#fBrowsePub'));
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

  /* ------------------------------------- which tab a visitor lands on, and why
     The results used to be one list with the public universities blurred at
     the bottom, so a visitor's first sight of the finder was a column of grey
     bars — a paywall before anything of value. Splitting them in two was meant
     to fix that, and for three patches it did the opposite, because the two
     tabs and the gate were reading different columns.

     They read the same thing now. Free means free to apply THROUGH US — the
     universities we are partnered with, where the application costs a student
     nothing — and those rows are readable end to end. A German public place is
     not free in that sense: its name is what a package buys, and it sits on
     the tab that says so.

     Which is why the tab that opens can be the free one, as Vishal asked:
     "free to apply should be by default open." It opens onto real names and
     real prices, not a wall of blur. */
  const v = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } }))
    .newPage();
  const verrs = [];
  v.on('pageerror', e => verrs.push(String(e)));
  await v.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await v.waitForTimeout(2400);

  check('the results have two tabs', (await v.$$('.rtab')).length === 2);
  check('and the one that opens is the free one, as asked for',
    (await v.$eval('.rtab.on', el => el.dataset.rt)) === 'pub',
    await v.$eval('.rtab.on', el => el.dataset.rt));
  check('it is the first one on the screen as well as the open one',
    (await v.$eval('.rtab', el => el.dataset.rt)) === 'pub',
    await v.$eval('.rtab', el => el.dataset.rt));
  check('there are rows on it', (await v.$$('#rowsIn .mrow')).length > 0,
    (await v.$$('#rowsIn .mrow')).length + ' rows');

  /* The assertion this suite was missing, and the reason Vishal had to say
     "its reverse" four times before anybody looked.
     
     The fee column decides which tab a row lands in; the gate that hides a
     name still keys off public-versus-private. Those two agreeing is the
     entire contract of this screen, and for three patches they disagreed: a
     tab reading "Apply free, right away — no package needed" opened onto a
     hundred and fifty blurred bars offering to sell the names for ₹4,999,
     while the tab asking for a package listed real universities with real
     prices, free to apply to.
     
     Every part of that was individually tested and passing. Nothing checked
     the one thing a visitor sees, which is that the free tab is free. */
  check('the free tab is readable end to end — nothing on it is behind a package',
    (await v.$$('#rowsIn .masked')).length === 0,
    (await v.$$('#rowsIn .masked')).length + ' blurred rows on the FREE tab');
  check('and every row on it is marked free to apply',
    (await v.$$eval('#rowsIn .mtype.priv', els => els.length)) === 0);

  const pubCount = Number(await v.textContent('#rtnPub'));
  check('the free tab says how many are on it', pubCount > 0, pubCount);

  await v.click('.rtab[data-rt="priv"]');
  await v.waitForTimeout(700);
  check('the package tab has rows too', (await v.$$('#rowsIn .mrow')).length > 0,
    (await v.$$('#rowsIn .mrow')).length + ' rows');
  check('and it is where the gate lives — a name is what the package buys',
    (await v.$$('#rowsIn .masked')).length > 0,
    (await v.$$('#rowsIn .masked')).length + ' blurred');
  check('with nothing free-to-apply mixed in',
    (await v.$$eval('#rowsIn .mtype.pub', els => els.length)) === 0);

  await v.click('.rtab[data-rt="pub"]');
  await v.waitForTimeout(700);
  check('and back again is readable, still',
    (await v.$$('#rowsIn .masked')).length === 0,
    (await v.$$('#rowsIn .masked')).length + ' blurred');

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

  /* ---------------------------------------- the budget cards follow the filters */
  const rail = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const rp = await rail.newPage();
  const rerrs = [];
  rp.on('pageerror', e => rerrs.push(String(e)));
  await rp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await rp.waitForTimeout(2800);
  const counts = () => rp.$$eval('.rail-n', e => e.map(x => Number(x.textContent)));
  const tabs = async () => Number(await rp.textContent('#rtnPriv'))
    + Number(await rp.textContent('#rtnPub'));

  const all = await counts();
  check('the budget cards carry a count', all.every(n => n > 0), all.join(','));

  await rp.selectOption('#fCountry', 'DE');
  await rp.click('#fGo');
  await rp.waitForTimeout(1200);
  const de = await counts();
  check('and it moves when the destination changes',
    de.join(',') !== all.join(','), all.join(',') + ' -> ' + de.join(','));
  check('and adds up to what the two tabs are showing',
    de.reduce((a, b) => a + b, 0) === await tabs(),
    de.reduce((a, b) => a + b, 0) + ' vs ' + await tabs());

  /* The destination is Germany, so the grade question is the German one and the
     calculator is how a 6.5 CGPA becomes an answer to it. */
  await rp.click('#openGg');
  await rp.fill('#ggMax', '10');
  await rp.fill('#ggPass', '4');
  await rp.fill('#ggNow', '6.5');
  await rp.waitForTimeout(400);
  await rp.click('#ggUse');
  await rp.waitForTimeout(500);
  await rp.click('#fGo');
  await rp.waitForTimeout(1200);
  const cg = await counts();
  check('and it moves again when the CGPA does',
    cg.join(',') !== de.join(','), de.join(',') + ' -> ' + cg.join(','));
  check('still adding up to the tabs',
    cg.reduce((a, b) => a + b, 0) === await tabs(),
    cg.reduce((a, b) => a + b, 0) + ' vs ' + await tabs());

  /* And pressing one filters BOTH tabs, which is the thing it is for. */
  await rp.selectOption('#fGgpa', '');
  await rp.click('#fGo');
  await rp.waitForTimeout(1000);
  const wide = await tabs();
  await rp.click('[data-railband="u20"]');
  await rp.waitForTimeout(1200);
  check('pressing a budget card narrows the results', await tabs() < wide,
    wide + ' -> ' + await tabs());
  check('to exactly what the card said',
    await tabs() === (await counts())[1], await tabs() + ' vs ' + (await counts())[1]);
  check('and the card shows that it is on',
    (await rp.getAttribute('[data-railband="u20"]', 'aria-pressed')) === 'true');
  check('no page errors on the finder', rerrs.length === 0, rerrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
