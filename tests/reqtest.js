/**
 * Entry requirements, edited in the office and read on the website.
 *
 * These are the numbers a student checks before deciding whether they qualify
 * and how much money they have to show a visa officer. They change every year.
 * Until now they were baked into index.html, so correcting one meant a
 * developer and a deploy — which is the same as saying they were never
 * corrected.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

/* What a visitor sees when they open the Requirements panel for a country. */
const reqPanel = async (ctx, code) => {
  const p = await ctx.newPage();
  await p.goto(BASE + '/#results', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  /* Entry requirements are a property of the destination, so either tab has a
     Requirements button — but the public tab is the one that always has a row
     for a given country, since that is where the bulk of the catalogue is. */
  await p.click('.rtab[data-rt="pub"]').catch(() => {});
  await p.waitForTimeout(800);
  const text = await p.evaluate(cc => {
    const btn = document.querySelector('[data-req="' + cc + '"]');
    if (btn) btn.click();
    const body = document.querySelector('#reqBody');
    return body ? body.innerText : '';
  }, code);
  await p.close();
  return text;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------ they arrive from the seed */
  const cat = await (await ctx.request.get(BASE + '/api/catalogue')).json();
  const de = (cat.countries || {}).DE || {};
  check('the destinations carry their requirements', !!de.minCgpaPublic, de.minCgpaPublic);
  check('and the funds figure', !!de.fundsInr, de.fundsInr);
  check('and the document list', (de.documents || []).length > 0,
    (de.documents || []).length);

  /* ------------------------------------------------------------ the screen */
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await page.goto(BASE + '/catalogue', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#progRows tr', { timeout: 15000 });
  await page.click('.tab[data-t="dest"]');
  await page.waitForSelector('#destRows tr', { timeout: 8000 });

  const destText = await page.textContent('#destRows');
  check('the list says how complete each destination is',
    /filled in/.test(destText), destText.replace(/\s+/g, ' ').slice(0, 90));

  await page.click('[data-dreq="DE"]');
  await page.waitForSelector('#rFunds', { timeout: 8000 });
  check('the editor opens with what is stored',
    (await page.inputValue('#rCgP')) === String(de.minCgpaPublic),
    await page.inputValue('#rCgP'));
  check('the funds figure is in it',
    Number(await page.inputValue('#rFunds')) === de.fundsInr,
    await page.inputValue('#rFunds'));
  check('the documents are one per line',
    (await page.inputValue('#rDocs')).split('\n').length === de.documents.length,
    (await page.inputValue('#rDocs')).split('\n').length + ' vs ' + de.documents.length);

  /* ------------------------------------------------------------- edit them */
  await page.fill('#rFunds', '1234567');
  await page.fill('#rCgP', '8.2');
  await page.fill('#rWork', '24 hours a week during term, no limit in the holidays.');
  await page.fill('#rDocs', 'Passport\nAPS certificate\nBlocked account confirmation');
  await page.click('#pmSave');
  await page.waitForTimeout(1400);
  check('the editor closes on save', !(await page.isVisible('#progModal .sheet')));

  const after = await (await ctx.request.get(BASE + '/api/catalogue')).json();
  const de2 = after.countries.DE;
  check('the new funds figure is stored', de2.fundsInr === 1234567, de2.fundsInr);
  check('the new CGPA bar is stored', de2.minCgpaPublic === 8.2, de2.minCgpaPublic);
  check('the document list was replaced, not appended',
    de2.documents.length === 3, de2.documents.join(' | '));

  /* --------------------------------------- and the visitor reads the new one */
  const panel = await reqPanel(ctx, 'DE');
  check('the Requirements panel on the site shows the edited figure',
    panel.includes('12,34,567') || panel.includes('1,234,567'),
    panel.replace(/\s+/g, ' ').slice(0, 160));
  check('and the edited work rights', panel.includes('24 hours a week during term'));
  check('and the edited document list', panel.includes('APS certificate'));

  /* --------------------------- hiding a destination must not touch the facts */
  await page.click('.tab[data-t="dest"]');
  await page.waitForTimeout(400);
  await page.click('[data-dtoggle="DE"]');
  await page.waitForTimeout(1200);
  await page.click('[data-dtoggle="DE"]');
  await page.waitForTimeout(1200);
  const de3 = (await (await ctx.request.get(BASE + '/api/catalogue')).json()).countries.DE;
  check('hiding and showing again leaves the requirements alone',
    de3.fundsInr === 1234567 && de3.documents.length === 3,
    de3.fundsInr + ' / ' + de3.documents.length);

  /* ------------------------------------------------- nonsense is bounded */
  await ctx.request.put(BASE + '/api/staff/country', {
    data: { code: 'DE', name: 'Germany', facts: { minCgpaPublic: '47', fundsInr: '99999999999' } },
  });
  const de4 = (await (await ctx.request.get(BASE + '/api/catalogue')).json()).countries.DE;
  check('a CGPA of 47 is clamped rather than published', de4.minCgpaPublic <= 10,
    de4.minCgpaPublic);
  check('and an impossible funds figure is capped', de4.fundsInr <= 99999999, de4.fundsInr);

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
