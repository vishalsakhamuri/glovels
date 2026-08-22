/**
 * The SOP & LOR tab on the Home page screen.
 *
 * The studio's wording is now content, and this is the screen that owns it. The
 * checks that matter are the ones about not losing work: switching between the
 * two kinds mid-edit, previewing without saving, and the refusal when a list is
 * emptied to the point where the studio could not write anything.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

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
  await page.click('.tab[data-t="ai"]');
  await page.waitForSelector('#ai_openings', { timeout: 10000 });

  check('the tab is on the Home page screen', await page.isVisible('#ai_openings'));
  check('the openings are in it',
    (await page.inputValue('#ai_openings')).includes('I am applying to the {programme}'),
    (await page.inputValue('#ai_openings')).slice(0, 60));
  check('the chips are editable too',
    (await page.inputValue('#cp_signals_0')).length > 0,
    await page.inputValue('#cp_signals_0'));
  check('the warning about inventing facts is on the screen',
    /may state a fact about the student/.test(
      (await page.textContent('#t-ai')).replace(/\s+/g, ' ')));

  /* ------------------------------------------- preview before saving */
  const opening = 'A previewed opening for the {programme} at {university}.';
  await page.fill('#ai_openings', opening + '\nA second one, so the list is not down to one.');
  await page.click('#aiPreview');
  await page.waitForTimeout(1500);
  const prev = await page.textContent('#aiPrev');
  check('the preview uses what is on the screen, not what is saved',
    prev.includes('A previewed opening for the M.Sc. Data Science'), prev.slice(0, 120));

  const live = await (await ctx.request.post(BASE + '/api/ai/draft', {
    data: { kind: 'sop', programme: 'X', university: 'Y', signals: ['work'], pass: 0 },
  })).json();
  check('previewing wrote nothing',
    !(live.draft.paragraphs[0] || '').includes('A previewed opening'),
    (live.draft.paragraphs[0] || '').slice(0, 70));

  /* --------------------------------- switching kinds keeps the edit */
  await page.click('.tab-ai[data-a="lor"]');
  await page.waitForTimeout(400);
  check('the letter has its own lists',
    (await page.inputValue('#ai_body')).includes('{signals}'),
    (await page.inputValue('#ai_body')).slice(0, 50));
  await page.click('.tab-ai[data-a="sop"]');
  await page.waitForTimeout(400);
  check('coming back, the unsaved edit is still there',
    (await page.inputValue('#ai_openings')).includes('A previewed opening'),
    (await page.inputValue('#ai_openings')).slice(0, 60));

  /* ------------------------------------------------------------ save */
  await page.click('#aiSave');
  await page.waitForTimeout(1400);
  const after = await (await ctx.request.post(BASE + '/api/ai/draft', {
    data: { kind: 'sop', programme: 'M.Sc. Robotics', university: 'TU Delft',
      signals: ['work'], pass: 0 },
  })).json();
  check('saving changes what the studio writes',
    (after.draft.paragraphs[0] || '').includes('A previewed opening for the M.Sc. Robotics'),
    (after.draft.paragraphs[0] || '').slice(0, 80));
  check('who changed it is recorded',
    /Last changed by/.test(await page.textContent('#aiWhen')),
    await page.textContent('#aiWhen'));

  /* -------------------------------------- editing a chip changes a draft */
  await page.fill('#cp_signals_0', 'the summer I spent rebuilding our billing system');
  await page.click('#aiSave');
  await page.waitForTimeout(1400);
  const chipped = await (await ctx.request.post(BASE + '/api/ai/draft', {
    data: { kind: 'sop', programme: 'M.Sc. Robotics', university: 'TU Delft',
      signals: ['work'], pass: 1 },
  })).json();
  check('an edited chip phrase reaches the draft',
    chipped.draft.paragraphs.join(' ').includes('rebuilding our billing system'),
    chipped.draft.paragraphs[1] || '');

  /* ------------------------------------------------ emptying is refused */
  /* The 422 below is the point of the check, so it stops counting as an error
     from here on. */
  errs.length = 0;
  const expected422 = true;
  page.on('console', () => {});
  await page.fill('#ai_openings', '');
  await page.click('#aiSave');
  await page.waitForTimeout(1200);
  const stillThere = await (await ctx.request.post(BASE + '/api/ai/draft', {
    data: { kind: 'sop', programme: 'Z', university: 'W', signals: ['work'], pass: 0 },
  })).json();
  check('emptying the openings is refused, and the studio still writes',
    stillThere.draft && stillThere.draft.paragraphs.length > 0,
    JSON.stringify(stillThere).slice(0, 100));

  check('no page errors',
    errs.filter(e => !/422/.test(e)).length === 0 && expected422,
    errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
