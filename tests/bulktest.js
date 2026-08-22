/**
 * Taking many universities off the list at once.
 *
 * The dangerous part of a bulk delete is not the delete. It is the selection:
 * what "select all" covers when a search is narrowed, what survives a repaint,
 * and whether a programme a student is mid-application on can be removed out
 * from under them. Every check here is made by ticking real boxes.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const all = async () => (await (await ctx.request.get(BASE + '/api/staff/catalogue')).json()).programmes;
  const before = await all();

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));
  /* confirm() blocks everything until it is answered. */
  page.on('dialog', d => d.accept());

  await page.goto(BASE + '/catalogue', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#progRows tr', { timeout: 15000 });

  check('the action bar is hidden until something is ticked',
    !(await page.isVisible('#bulkBar')));

  /* ---------------------------------------------------- tick three rows */
  const boxes = page.locator('#progRows [data-pick]');
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await boxes.nth(i).getAttribute('data-pick'));
    await boxes.nth(i).check();
  }
  check('the bar appears and counts them',
    (await page.isVisible('#bulkBar')) && /3 selected/.test(await page.textContent('#bulkCount')),
    await page.textContent('#bulkCount'));

  /* ------------------------------------ a selection survives a new search */
  await page.fill('#q', 'Warsaw');
  await page.waitForTimeout(400);
  await page.fill('#q', '');
  await page.waitForTimeout(400);
  check('the ticks survive searching and clearing',
    /3 selected/.test(await page.textContent('#bulkCount')),
    await page.textContent('#bulkCount'));

  /* -------------------------------------- select-all follows the search */
  await page.click('#bulkClear');
  await page.waitForTimeout(250);
  await page.selectOption('#fc', 'DE');
  await page.waitForTimeout(400);
  const german = before.filter(p => p.country === 'DE').length;
  await page.check('#selAll');
  await page.waitForTimeout(350);
  check('"select all" covers exactly what the search found, not the whole catalogue',
    (await page.textContent('#bulkCount')).indexOf(String(german) + ' selected') === 0,
    await page.textContent('#bulkCount') + ' vs ' + german + ' German');

  /* -------------------------------------------- take them off the site */
  await page.click('#bulkHide');
  await page.waitForTimeout(1400);
  const afterHide = await all();
  check('every one of them came off the site',
    afterHide.filter(p => p.country === 'DE' && p.active).length === 0,
    afterHide.filter(p => p.country === 'DE' && p.active).length + ' still live');
  check('none of them was deleted', afterHide.length === before.length,
    before.length + ' -> ' + afterHide.length);
  check('the selection is cleared afterwards', !(await page.isVisible('#bulkBar')));

  const home = await ctx.newPage();
  await home.goto(BASE + '/api/catalogue');
  const pub = JSON.parse(await home.textContent('body'));
  check('and the site itself stopped listing them',
    (pub.programmes || []).filter(p => p.country === 'DE').length === 0,
    (pub.programmes || []).filter(p => p.country === 'DE').length);
  await home.close();

  /* ------------------------------------------------------ and back on */
  await page.check('#selAll');
  await page.waitForTimeout(350);
  await page.click('#bulkShow');
  await page.waitForTimeout(1400);
  check('putting them back works the same way',
    (await all()).filter(p => p.country === 'DE' && p.active).length === german);

  /* --------------------------------------------------------- removal */
  /* Deliberately aimed at a programme the demo student has shortlisted, plus
     two that nobody has touched. The vacuous version of this check — delete
     rows nobody shortlisted and assert that the empty leftover list is all
     hidden — passes whatever the server does. */
  const stu = await ctx.browser().newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const state = await (await stu.request.get(BASE + '/api/state')).json();
  const protectedId = (state.shortlist || [])[0] && state.shortlist[0].id;
  await stu.close();
  check('the demo student really has something shortlisted', !!protectedId, protectedId);

  /* Spares must be programmes NOBODY has shortlisted — the demo student starts
     with several, and picking the first two rows in the table quietly chose two
     of those, so the test asserted a deletion the server was right to refuse. */
  const inUse = new Set((state.shortlist || []).map(x => x.id));
  const spare = (await all()).filter(p => !inUse.has(p.id)).slice(0, 2).map(p => p.id);
  const doomed = [protectedId].concat(spare);

  await page.selectOption('#fc', '');
  await page.fill('#q', '');
  await page.waitForTimeout(450);
  for (const id of doomed) {
    await page.check('#progRows [data-pick="' + id + '"]').catch(async () => {
      /* Outside the first 400 drawn: tick it through the search instead. */
      const p = (await all()).find(x => x.id === id);
      await page.fill('#q', p.university);
      await page.waitForTimeout(400);
      await page.check('#progRows [data-pick="' + id + '"]');
      await page.fill('#q', '');
      await page.waitForTimeout(400);
    });
  }
  check('three are selected for removal',
    /3 selected/.test(await page.textContent('#bulkCount')), await page.textContent('#bulkCount'));

  await page.click('#bulkDelete');
  await page.waitForTimeout(2200);

  const afterDel = await all();
  check('the two nobody was using are gone',
    spare.every(id => !afterDel.some(p => p.id === id)),
    afterDel.filter(p => spare.includes(p.id)).map(p => p.id).join(','));
  const kept = afterDel.find(p => p.id === protectedId);
  check('the shortlisted one was kept, and taken off the site instead',
    !!kept && kept.active === false, kept ? 'active=' + kept.active : 'DELETED');
  check('the student\'s shortlist did not blank out', afterDel.length === before.length - 2,
    before.length + ' -> ' + afterDel.length);

  /* -------------------------------------------- it is written in the log */
  await page.click('.tab[data-t="log"]');
  await page.waitForTimeout(600);
  check('the change is in Recent changes with a count',
    /selected/.test(await page.textContent('#logRows')),
    (await page.textContent('#logRows')).replace(/\s+/g, ' ').slice(0, 120));

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
