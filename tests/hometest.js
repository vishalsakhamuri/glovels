/**
 * The Home page screen in the operations site — driven, not inspected.
 *
 * Every claim here is made by clicking the thing a counsellor would click and
 * then reading the public home page to see whether it changed. A screen that
 * renders correctly and saves nothing looks identical to one that works.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const SHEET = require('../server/sheet.js');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

/*
 * The packages section starts hidden — it is revealed by #packages — and
 * innerText does not see hidden elements. Reading the page without opening it
 * makes every "is the new package there?" check pass by accident, which is
 * worse than failing.
 */
const homeText = async ctx => {
  const p = await ctx.newPage();
  await p.goto(BASE + '/#packages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1300);
  const t = await p.evaluate(() =>
    document.body.innerText + '\n' + (document.getElementById('packages') || {}).innerText);
  await p.close();
  return t;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pkgTabs table', { timeout: 15000 });
  check('the screen opens', true);
  check('it is in the sidebar',
    (await page.textContent('.p-nav')).includes('Home page'));
  check('all nine packages are listed',
    (await page.$$('#pkgTabs tbody tr[class], #pkgTabs tbody tr')).length >= 9,
    (await page.$$('#pkgTabs tbody tr')).length);
  check('the counters are filled',
    (await page.textContent('#kPkg')) !== '—' && (await page.textContent('#kLines')) !== '—',
    (await page.textContent('#kPkg')) + ' / ' + (await page.textContent('#kLines')));

  /* ---------------------------------------------------- edit a package */
  await page.click('[data-edit="pkg-roadmap"]');
  await page.waitForSelector('#fTitle');
  for (const [sel, v] of [['#fTitle', 'Roadmap Lite'], ['#fPrice', '12345'],
    ['#fUnlocks', '7'], ['#fFeatures', 'One thing\nAnother thing\nA third thing']]) {
    await page.click(sel);
    await page.fill(sel, v);
  }
  await page.click('#pmSave');
  await page.waitForTimeout(700);
  check('the editor closes on save', !(await page.isVisible('#pkgModal .sheet')));

  let home = await homeText(ctx);
  check('the new package name is on the home page', home.includes('Roadmap Lite'));
  check('the new price is on the home page', home.includes('12,345'));
  check('the new feature list is on the home page', home.includes('A third thing'));
  check('the old feature list is gone', !home.includes('2 counselling sessions'));

  const order = await (await ctx.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-roadmap', name: 'T', email: 't@t.com', phone: '9876543210' },
  })).json();
  check('checkout charges the edited price', order.grossPaise === 1234500, order.grossPaise);
  check('checkout unlocks the edited count', order.publicUnis === 7, order.publicUnis);

  /* --------------------------------------------------- add a package */
  /* Click into each field before typing. Playwright's fill focuses and then
     inserts text, and the editor re-lays-out when "how it is sold" changes —
     so an unfocused fill lands in whichever box had focus last. It produced a
     package whose id was the title and the description run together, and the
     test then looked for one that did not exist. */
  const type = async (sel, value) => {
    await page.click(sel);
    await page.fill(sel, value);
  };

  await page.click('#addPkg');
  await page.waitForSelector('#fTitle');
  await page.selectOption('#fTab', 'study');
  await type('#fTitle', 'Ireland Fast Track');
  await type('#fPrice', '19999');
  await type('#fDesc', 'Applications to Irish universities, start to finish.');
  await type('#fFeatures', 'Shortlist of 5\nVisa filing');
  await type('#fCta', 'Choose Ireland');
  await page.click('#pmSave');
  await page.waitForTimeout(700);
  home = await homeText(ctx);
  check('a brand-new package appears on the home page', home.includes('Ireland Fast Track'));
  check('its price appears too', home.includes('19,999'));

  const cat = await (await ctx.request.get(BASE + '/api/content')).json();
  check('the new package has a usable id',
    cat.packages.items.some(p => p.id === 'ireland-fast-track'),
    cat.packages.items.map(p => p.id).join(','));

  /* ------------------------------------------------------ hide and show */
  await page.click('[data-edit="ireland-fast-track"]');
  await page.waitForSelector('#fActive');
  await page.uncheck('#fActive');
  await page.click('#pmSave');
  await page.waitForTimeout(700);
  home = await homeText(ctx);
  check('hiding takes it off the home page', !home.includes('Ireland Fast Track'));

  /* ------------------------------------------------------ the numbers */
  await page.click('.tab[data-t="num"]');
  await page.waitForSelector('#num0');
  await page.fill('#num0', '5,000+');
  await page.uncheck('#sd0');
  await page.click('[data-save="stats"]');
  await page.waitForTimeout(700);
  home = await homeText(ctx);
  check('an edited figure reaches the home page', home.includes('5,000+'));
  const firstStat = await (async () => {
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1000);
    const t = await p.textContent('.stat-grid .stat');
    await p.close();
    return t;
  })();
  check('unticking unconfirmed removes that figure\'s DUMMY marker',
    !firstStat.includes('DUMMY'), firstStat);

  /* ---------------------------------------------------------- the FAQ */
  await page.click('.tab[data-t="faq"]');
  await page.waitForSelector('[data-add="faq"]');
  const faqBefore = (await page.$$('#faqRows .p-card')).length;
  await page.click('[data-add="faq"]');
  await page.waitForTimeout(250);
  await page.fill('#q' + faqBefore, 'Do you help with the visa interview?');
  await page.fill('#a' + faqBefore, 'Yes — a mock interview and a document check before you go.');
  await page.click('[data-save="faq"]');
  await page.waitForTimeout(700);
  home = await homeText(ctx);
  check('a new FAQ entry reaches the home page',
    home.includes('Do you help with the visa interview?'));

  /* ------------------------------------------------------- page text */
  await page.click('.tab[data-t="txt"]');
  await page.waitForSelector('#txtRows textarea');
  await page.fill('#tq', 'Find your university');
  await page.waitForTimeout(350);
  const box = page.locator('#txtRows textarea').first();
  check('search finds the line', await box.count() > 0,
    'rows=' + (await page.$$('#txtRows textarea')).length
    + ' saves=' + (await page.$$('#txtRows [data-tsave]')).length
    + ' :: ' + (await page.textContent('#txtRows')).replace(/\s+/g, ' ').slice(0, 200));
  /* Click into it before typing. Playwright's fill focuses and then inserts
     text, and with the search box still focused the insertion lands there
     instead — which then filters the row away mid-test. */
  await box.click();
  await box.fill('Find your course, anywhere');
  try {
    await page.locator('#txtRows [data-tsave]').first().click({ timeout: 5000 });
  } catch (e) {
    await page.screenshot({ path: '/tmp/txt-fail.png', fullPage: false });
    console.log('DEBUG', JSON.stringify(await page.evaluate(() => {
      const b = document.querySelector('#txtRows [data-tsave]');
      if (!b) return { none: true, html: document.querySelector('#txtRows').innerHTML.slice(0, 300) };
      const r = b.getBoundingClientRect();
      return { rect: r.toJSON(), top: (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || {}).outerHTML };
    }), null, 1).slice(0, 900));
    throw e;
  }
  await page.waitForTimeout(800);
  home = await homeText(ctx);
  check('an edited line of text reaches the home page',
    home.includes('Find your course, anywhere'), '');
  check('the reworded count went up',
    Number(await page.textContent('#kEdited')) >= 1, await page.textContent('#kEdited'));

  await page.locator('#txtRows [data-treset]').first().click();
  await page.waitForTimeout(800);
  home = await homeText(ctx);
  check('back to original really puts it back',
    !home.includes('Find your course, anywhere') && home.includes('Find your university'));

  /* ------------------------------------------------------ spreadsheet */
  await page.click('.tab[data-t="sheet"]');
  await page.waitForSelector('#sWhat');

  const dl = await ctx.request.get(BASE + '/api/staff/content/text.xlsx');
  const buf = Buffer.from(await dl.body());
  check('the page-text sheet downloads', dl.ok() && buf.slice(0, 2).toString() === 'PK',
    buf.length + ' bytes');
  const rows = SHEET.readXlsx(buf);
  const head = rows[0];
  const iKey = head.indexOf('do not edit — key');
  const iNew = head.indexOf('new wording');
  const iNow = head.indexOf('what it says now');
  check('the sheet has the columns the import needs', iKey === 0 && iNew > 0, head.join('|'));

  const target = rows.findIndex((r, n) => n > 0 && String(r[iNow]).indexOf('Find your university') === 0);
  check('the sheet contains the line', target > 0, target);
  rows[target][iNew] = 'Find your university — from a sheet';
  fs.writeFileSync('/tmp/text-edited.xlsx', SHEET.writeXlsx(head, rows.slice(1), 'text'));

  await page.selectOption('#sWhat', 'text');
  await page.setInputFiles('#sFile', '/tmp/text-edited.xlsx');
  await page.click('#sCheck');
  await page.waitForSelector('#sApply', { timeout: 20000 });
  const plan = await page.textContent('#sOut');
  check('the preview says one line will be reworded', /1toreword/.test(plan.replace(/\s+/g, '')),
    plan.replace(/\s+/g, ' ').slice(0, 120));
  check('the preview shows the new wording',
    plan.includes('Find your university — from a sheet'));

  const midHome = await homeText(ctx);
  check('the preview wrote nothing', !midHome.includes('from a sheet'));

  await page.click('#sApply');
  await page.waitForTimeout(1200);
  home = await homeText(ctx);
  check('applying the sheet changes the home page', home.includes('Find your university — from a sheet'));

  /* -------------------------------------------------------- a bad sheet */
  const bogus = head.slice();
  const badRows = [['not-a-real-key', 'x', 'x', 'x', 'Some new wording']];
  fs.writeFileSync('/tmp/text-bad.xlsx', SHEET.writeXlsx(bogus, badRows, 'text'));
  await page.setInputFiles('#sFile', '/tmp/text-bad.xlsx');
  await page.click('#sCheck');
  await page.waitForTimeout(1500);
  const badPlan = await page.textContent('#sOut');
  check('an unknown key is rejected with a reason',
    /no line on the page has the key/.test(badPlan), badPlan.replace(/\s+/g, ' ').slice(0, 140));

  check('no page errors on the screen', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
