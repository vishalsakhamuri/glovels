/**
 * What applying to a university costs, and the country it belongs to.
 *
 * The catalogue used to be filtered on public-versus-private. That is a German
 * distinction: of 171 rows, 153 are German public places and the other six
 * destinations have no public row between them. So the screens had two faults
 * that this suite exists to keep fixed —
 *
 *   1. "Public only" on Canada, Ireland, Italy, Poland, Spain or the UK
 *      returned an empty screen. Not "nothing matches", just nothing, which
 *      reads as a broken site rather than a question that does not apply.
 *   2. The destination filter opened on "Any destination", so a student going
 *      to Ireland scrolled through German universities to reach the two that
 *      were theirs.
 *
 * The axis is now free-versus-charged, which means something in all seven
 * countries: free where we are partnered with the university, a package where
 * we are not. It rides on the catalogue sheet as the `application` column, so
 * the office marks a university free the day the partnership is signed.
 *
 * The sheet round-trip is checked end to end, because this is the second
 * column to be added to that spreadsheet and the first one was silently
 * discarded for weeks: the change detector did not name it, so a row whose
 * only edit was that column came back "already right" and the apply pass
 * skipped it. The office was told 171 rows were fine and the number they had
 * typed was thrown away. Hence `a flipped cell is seen as a change` below —
 * it is the regression test for a bug that has already happened once.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* --------------------------------------------- every row says what it costs */

  /* Fields like "Data Science, AI & Machine Learning" carry commas inside
     quotes, so this has to parse rather than split — a naive split shifts
     every column after them and the suite reports faults that are its own. */
  const parseCsv = text => {
    const out = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); out.push(row); }
    return out.filter(r => r.length > 1);
  };
  const quote = v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const csv = await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text();
  const grid = parseCsv(csv.replace(/^﻿/, ''));
  const head = grid[0];
  const iApp = head.indexOf('application');
  const iId = head.indexOf('id');
  const iCty = head.indexOf('country code');
  const iPub = head.indexOf('public university');
  check('the catalogue sheet carries an application column', iApp > -1, 'at ' + iApp);

  const rows = grid.slice(1);
  check('and every row has an answer in it',
    rows.every(r => r[iApp] === 'Free' || r[iApp] === 'Package'),
    rows.filter(r => r[iApp] !== 'Free' && r[iApp] !== 'Package').length + ' blank');

  /* Free means free TO APPLY, through us — not free of tuition. The first pass
     at this column read it the other way and wrote Free onto every German
     public row, which are precisely the rows whose names a student cannot see
     without buying a package. The finder split its two tabs on the column and
     put every row under the opposite heading.

     So: the places we are partnered with are free to apply to, and a German
     public university is what a package is for. */
  const germanPublic = rows.filter(r => r[iCty] === 'DE' && r[iPub] === 'yes');
  check('a German public university is what a package buys',
    germanPublic.length > 100 && germanPublic.every(r => r[iApp] === 'Package'),
    germanPublic.length + ' rows, '
      + germanPublic.filter(r => r[iApp] !== 'Package').length + ' not Package');
  const partnered = rows.filter(r => r[iPub] === 'no');
  check('and everywhere we are partnered is free to apply to',
    partnered.length > 0 && partnered.every(r => r[iApp] === 'Free'),
    partnered.length + ' rows, '
      + partnered.filter(r => r[iApp] !== 'Free').length + ' not Free');

  /* The check that would have caught it. What a row says on the sheet and what
     the home page does with it have to be the same sentence: a row the finder
     hides behind a package must not be sitting on the tab that promises there
     is nothing to buy. */
  const saysFree = rows.filter(r => r[iApp] === 'Free');
  check('nothing marked free is a gated row',
    saysFree.length > 0 && saysFree.every(r => r[iPub] === 'no'),
    saysFree.filter(r => r[iPub] === 'yes').length + ' gated rows marked Free');

  /* ------------------------------------------------------- the sheet round-trip */

  /* A partnership that lapses: a private university we no longer place for
     free, so a student needs a package for it. One cell, and the finder has to
     move the row to the other tab. */
  const target = rows.find(r => r[iCty] === 'GB' && r[iApp] === 'Free');
  check('there is a non-German row to change', !!target, target && target[iId]);
  const sheet = mut => [head].concat(rows.map(r => {
    const c = r.slice(); mut(c); return c;
  })).map(r => r.map(quote).join(',')).join('\n');
  const flipped = sheet(c => { if (c[iId] === target[iId]) c[iApp] = 'Package'; });

  const upload = async (body, confirm) => {
    const fd = { file: { name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(body) } };
    if (confirm) fd.confirm = 'yes';
    return admin.request.post(BASE + '/api/staff/catalogue/import', { multipart: fd });
  };

  const dry = await (await upload(flipped, false)).json();
  const plan = dry.plan || dry;
  check('the sheet has no columns the importer cannot read',
    (plan.unknownColumns || []).length === 0, JSON.stringify(plan.unknownColumns || []));
  /* THE regression test. A change detector that does not name this column
     reports the row as already right and throws the edit away. */
  check('a flipped cell is seen as a change', (plan.update || []).length === 1,
    (plan.update || []).length + ' updates');
  check('and nothing else is disturbed by it',
    (plan.unchanged || []).length === rows.length - 1,
    (plan.unchanged || []).length + ' unchanged of ' + (rows.length - 1));

  const applied = await (await upload(flipped, true)).json();
  check('applying it writes exactly one row', applied.updated === 1, JSON.stringify(applied));

  const after = await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text();
  const back = parseCsv(after.replace(/^﻿/, '')).find(r => r[iId] === target[iId]);
  check('the changed university reads charged afterwards',
    back[iApp] === 'Package', back[iApp]);
  /* Partnership and constitution are different facts. Changing what applying
     costs must not quietly reclassify a private university as a public one —
     the CGPA rules read that column. */
  check('and is still a private university', back[iPub] === 'no', back[iPub]);

  /* Put it back, so a second run of this suite starts where the first did. */
  await upload(sheet(() => {}), true);

  /* ------------------------------------------- a file that is not the sheet */

  /*
   * Vishal: "for upload file free or package mandatory for every row, country
   * as well to filter, all the other criteria for the filter ... it should
   * prompt that file is not correct."
   *
   * A blank in a column the finder filters on does not fail loudly — it makes
   * the row invisible to whoever filters on it. The office believes 171
   * universities are on the site; a student searching Ireland at master's
   * level is shown four. So the columns are required, and a file that is not
   * the catalogue sheet is refused once rather than as 171 identical errors.
   */
  const wrong = await upload('name,email\nSomebody,a@b.c', false);
  check('a file that is not the sheet is refused outright',
    wrong.status() === 422, wrong.status() + '');
  const wrongBody = await wrong.json();
  check('and it is told which columns are missing',
    (wrongBody.missingColumns || []).includes('application'),
    JSON.stringify(wrongBody.missingColumns || []));
  check('in words that say what to do about it',
    /Download the sheet/i.test(wrongBody.error || ''), wrongBody.error || '');

  for (const [what, col, val, says] of [
    ['blank', 'application', '', /application column is empty/i],
    ['nonsense', 'application', 'maybe', /not Free or Package/i],
    ['blank', 'level', '', /no level/i],
    ['blank', 'field', '', /no field/i],
  ]) {
    const at = head.indexOf(col);
    let first = true;
    const body = sheet(c => { if (first) { c[at] = val; first = false; } });
    const r = (await (await upload(body, false)).json());
    const pl = r.plan || r;
    const one = (pl.rejected || [])[0];
    check('a ' + what + ' "' + col + '" cell stops the row',
      (pl.rejected || []).length === 1 && one && one.why.some(w => says.test(w)),
      one ? JSON.stringify(one.why) : (pl.rejected || []).length + ' rejected');
  }

  /* The budget band is deliberately NOT required, and this is here so nobody
     "tidies up" by adding it to the list. Blank there means "work it out from
     the tuition" — the programme form promises exactly that — and the row
     ends up carrying a band either way. Requiring it would take away
     something that already works. */
  const atBand = head.indexOf('budget band');
  let firstBand = true;
  const noBand = sheet(c => { if (firstBand) { c[atBand] = ''; firstBand = false; } });
  const bandRun = (await (await upload(noBand, false)).json());
  const bandPlan = bandRun.plan || bandRun;
  check('a blank budget band is allowed, because it is worked out from the fee',
    (bandPlan.rejected || []).length === 0,
    JSON.stringify(((bandPlan.rejected || [])[0] || {}).why || ''));

  /* And a bad row must block the apply, not be quietly skipped. */
  const atApp = head.indexOf('application');
  let once = true;
  const oneBad = sheet(c => { if (once) { c[atApp] = ''; once = false; } });
  const blocked = await upload(oneBad, true);
  check('a bad row blocks the whole upload rather than being skipped',
    blocked.status() === 422, blocked.status() + '');

  /* The most important check in this block: the sheet as it actually is must
     still go through. A rule that rejects real data is worse than no rule. */
  const cleanRun = (await (await upload(sheet(() => {}), false)).json());
  const cleanPlan = cleanRun.plan || cleanRun;
  check('the real sheet still passes every row',
    (cleanPlan.rejected || []).length === 0,
    (cleanPlan.rejected || []).length + ' rejected');
  check('and is seen as unchanged',
    (cleanPlan.unchanged || []).length === rows.length,
    (cleanPlan.unchanged || []).length + ' of ' + rows.length);

  /* ------------------------------------------ the student never sees a dead end */

  const email = 'fee' + stamp + '@stu.example', PW = 'fee-' + stamp;
  await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'Fee ' + stamp, email, password: PW, role: 'student' } });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.request.post(BASE + '/api/auth/login', { data: { email, password: PW } });
  await ctx.request.post(BASE + '/api/auth/change',
    { data: { current: PW, password: PW + 'X' } });
  await ctx.request.post(BASE + '/api/auth/login', { data: { email, password: PW + 'X' } });
  /* They said in their profile where they are going. */
  await ctx.request.put(BASE + '/api/profile',
    { data: { profile: { g_country: 'Ireland', d_cgpa: '8.0' } } });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/universities.html');
  await page.waitForFunction(
    () => document.querySelectorAll('#fCountry option').length > 1, null, { timeout: 15000 });
  /* Browse is the second tab; nothing inside it is visible until it is open. */
  await page.click('.tab[data-pane="browse"]');
  await page.waitForTimeout(700);

  check('the destination opens on the one the student gave us',
    (await page.inputValue('#fCountry')) === 'IE',
    await page.inputValue('#fCountry'));

  const typeHidden = () => page.$eval('#fType', e => {
    const f = e.closest('.field'); return f ? f.hidden : null;
  });
  check('Ireland has only one kind, so the question is not asked',
    (await typeHidden()) === true);

  await page.selectOption('#fCountry', 'DE');
  await page.waitForTimeout(600);
  check('Germany has both, so it is', (await typeHidden()) === false);
  const deOpts = await page.$$eval('#fType option', o => o.map(x => x.value));
  check('and both answers are offered',
    deOpts.includes('free') && deOpts.includes('package'), JSON.stringify(deOpts));

  /* The fault this whole change exists to fix: an option that returns nothing. */
  for (const v of deOpts.filter(Boolean)) {
    await page.selectOption('#fType', v);
    await page.waitForTimeout(500);
    const n = await page.$$eval('#allGrid article.sl', e => e.length);
    check('Germany + "' + v + '" shows universities', n > 0, n + ' cards');
  }

  /* And it must never mix destinations, which is what "Any destination" as an
     opening position did. */
  await page.selectOption('#fType', '');
  await page.waitForTimeout(600);
  const mixed = await page.$$eval('#allGrid article.sl',
    c => c.map(x => (/🇩🇪|Germany/.test(x.textContent) ? 'de' : 'other')));
  check('and every card on a German list is German',
    mixed.length > 0 && !mixed.includes('other'),
    mixed.filter(x => x === 'other').length + ' strays of ' + mixed.length);

  check('no page errors on the student screen', errs.length === 0, errs[0] || '');

  /* ------------------------------------------------------- the office's own screen */

  const cat = await admin.newPage();
  const cerrs = [];
  cat.on('pageerror', e => cerrs.push(String(e)));
  await cat.goto(BASE + '/catalogue.html');
  await cat.waitForTimeout(1800);

  const filter = await cat.$$eval('#ft option', o => o.map(x => x.value));
  check('the office can filter on either axis',
    JSON.stringify(filter) === JSON.stringify(['', 'free', 'package', 'pub', 'pri']),
    JSON.stringify(filter));

  await cat.click('[data-edit] >> nth=0');
  await cat.waitForTimeout(900);
  check('the programme form asks how the student applies',
    (await cat.$$('#fFee')).length === 1);
  const held = await cat.inputValue('#fFee');
  check('and holds a real answer', held === 'free' || held === 'package', held);
  /* The tuition box had the id fFee before this. If both ended up with it, the
     form would save a rupee amount into the fee model or the other way round. */
  check('the tuition box kept an id of its own',
    (await cat.$$('#fTuition')).length === 1);

  /* The refusal has to reach the person, not just the API. Vishal asked for a
     prompt that the file is not correct; a 422 nobody sees is not a prompt. */
  const fs = require('fs');
  fs.writeFileSync('/tmp/not-the-sheet.csv', 'name,email\nSomebody,a@b.c\n');
  /* The programme editor is still open from the check above, and it covers
     the tab strip. */
  await cat.evaluate(() => document.querySelectorAll('.modal.on')
    .forEach(m => m.classList.remove('on')));
  await cat.waitForTimeout(300);
  await cat.click('.tab[data-t="sheet"]');
  await cat.waitForTimeout(400);
  await cat.setInputFiles('#sFile', '/tmp/not-the-sheet.csv');
  await cat.click('#sCheck');
  await cat.waitForTimeout(2500);
  const said = (await cat.textContent('#sOut')).replace(/\s+/g, ' ');
  check('uploading the wrong file says so on the screen',
    /not the current catalogue sheet/i.test(said), said.slice(0, 120));
  check('and names the column it wants',
    /application/i.test(said), said.slice(0, 160));
  check('and there is no Apply button to press',
    (await cat.$$('#sApply')).length === 0);

  check('no page errors on the catalogue screen', cerrs.length === 0, cerrs[0] || '');

  /* ------------------------------------------------ the finder on the home page */

  /*
   * Patch 59 moved the portal and the office onto free-versus-charged and left
   * this screen behind — Vishal, looking at the live site: "its still showing
   * like before." The home finder has its own pair of result tabs, in its own
   * file, and they still said Private and Public.
   *
   * The counts are the part worth testing rather than the labels: they have to
   * follow the destination, because "we show universities from different
   * countries" is the fault this whole change exists to fix.
   */
  const home = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const fp = await home.newPage();
  const ferrs = [];
  fp.on('pageerror', e => ferrs.push(String(e)));
  await fp.goto(BASE + '/');
  await fp.waitForSelector('.rtab', { timeout: 15000 });
  await fp.waitForTimeout(2000);

  const labels = await fp.$$eval('.rtab', t => t.map(x => x.innerText.replace(/\s+/g, ' ')));
  check('the finder tabs no longer say Private and Public',
    !labels.join(' ').match(/\bPrivate\b|\bPublic\b/), labels.join(' | '));
  /* The names took three goes. What I had wrong was WHY "free" and
     "immediately" belong together — I read immediate as decision speed, and by
     that reading it sat on the wrong tab, because a German public application
     is the slowest route we sell. It is not about speed: free means there is
     no package to buy first, so a student can apply today. */
  check('they say what applying costs instead',
    /Apply free, right away/.test(labels.join(' '))
    && /Universities with a package/.test(labels.join(' ')),
    labels.join(' | '));
  /* Vishal: "free to apply should be by default open." Worth knowing that this
     is the GATED tab — German public names a package buys — so a visitor's
     first sight is blurred bars. His call, and one line to reverse. */
  check('and the free one is the tab that opens',
    (await fp.$eval('.rtab.on', e => e.dataset.rt)) === 'pub');
  /* From the FIRST paint, not once the catalogue has loaded and render() has
     corrected it. The JS default was changed and the static markup was not, so
     the page lit the wrong tab until the fetch came back — which is the state
     anybody on a slow connection actually sees, and the state Vishal
     screenshotted twice. */
  check('and it is marked open in the markup, before any script runs',
    /class="rtab on" data-rt="pub"/.test(await fp.content()));

  /* Read by id, not by position. These two counters were read out of the DOM
     in order and labelled [charged, free] in a comment, and then the free tab
     was moved to the front — at which point every assertion below kept passing
     while meaning the opposite thing. A positional read of two things that can
     swap is not a reading. */
  const countsFor = async code => {
    await fp.selectOption('#fCountry', code);
    await fp.click('#fGo');
    await fp.waitForTimeout(900);
    return {
      free: Number(await fp.textContent('#rtnPub')),
      pkg: Number(await fp.textContent('#rtnPriv')),
    };
  };

  const de = await countsFor('DE');
  check('Germany is where the packages are — its public universities',
    de.pkg > 100, JSON.stringify(de));
  check('and it has partnered ones to apply to for nothing as well',
    de.free > 0, JSON.stringify(de));
  const ie = await countsFor('IE');
  /* Worth knowing rather than worth fixing here: Ireland has no public
     universities, so on today's data every Irish row is free to apply to and
     the package tab is empty there. That is the sheet's answer, not the code's
     — one cell per row changes it, and the office owns those cells. */
  check('Ireland has no gated universities, and says so rather than showing Germany',
    ie.pkg === 0 && ie.free > 0, JSON.stringify(ie));
  check('and the counts actually changed with the country',
    JSON.stringify(de) !== JSON.stringify(ie),
    JSON.stringify(de) + ' vs ' + JSON.stringify(ie));

  /* --------------------------------------------- packages belong to a destination */

  /*
   * Every study package was built for Germany: all four are about public
   * universities and three promise to reveal public university names, which
   * only means something where public universities exist — Germany alone, of
   * our seven. A student going to Ireland was shown the same four and could
   * buy one that could not serve them.
   *
   * Vishal: "which tab to show depends on the country selection and which uni
   * user has clicked."
   */
  await fp.evaluate(() => { const s = document.getElementById('packages'); if (s) s.hidden = false; });
  await fp.waitForTimeout(400);

  const tabKeys = await fp.$$eval('[data-ptab]', t => t.map(x => x.dataset.ptab));
  check('there is a tab for the other destinations',
    tabKeys.includes('study') && tabKeys.includes('other'), JSON.stringify(tabKeys));
  const tabText = await fp.$$eval('[data-ptab]', t => t.map(x => x.textContent.trim()));
  check('and the first one names the country it is for',
    tabText[0] === 'Germany', JSON.stringify(tabText));

  const openTab = () => fp.$eval('[data-ptab][aria-selected="true"]', e => e.dataset.ptab);
  const pickCountry = async code => {
    await fp.selectOption('#fCountry', code);
    await fp.waitForTimeout(800);
    return openTab();
  };
  check('choosing Germany opens the German packages',
    (await pickCountry('DE')) === 'study');
  check('choosing Ireland opens the other-countries packages',
    (await pickCountry('IE')) === 'other');
  check('and so does the UK', (await pickCountry('GB')) === 'other');

  await fp.click('[data-ptab="other"]');
  await fp.waitForTimeout(500);
  const ladder = await fp.$$eval('[data-pane="other"] .pcard',
    n => n.map(x => x.querySelector('h3').textContent.trim()));
  check('the other-countries ladder has three rungs',
    ladder.length === 3, JSON.stringify(ladder));

  /* Each rung strictly better than the one below. Vishal's first draft had a
     tier that cost MORE than a better one — ₹2,999 for check-and-advise on
     five against ₹1,999 for doing one end to end — and anybody comparing them
     picked the cheaper better one. */
  const prices = await fp.$$eval('[data-pane="other"] .pcard',
    n => n.map(x => Number((x.innerText.match(/₹([\d,]+)/) || [0, '0'])[1].replace(/,/g, ''))));
  check('priced in increasing order', prices.every((v, i) => i === 0 || v > prices[i - 1]),
    JSON.stringify(prices));
  check('and starts at ₹999', prices[0] === 999, JSON.stringify(prices));

  /* A flat fee is not a starting price. "From ₹999" on a fixed tier reads as a
     number that could go up. */
  const firstCard = await fp.$eval('[data-pane="other"] .pcard', x => x.innerText);
  check('a flat price is not dressed up as a starting one',
    !/From\s*₹\s*999/.test(firstCard), firstCard.replace(/\s+/g, ' ').slice(0, 70));

  /* The German four are untouched — same ids, same prices. */
  await fp.click('[data-ptab="study"]');
  await fp.waitForTimeout(500);
  const german = await fp.$$eval('[data-pane="study"] .pcard',
    n => n.map(x => x.querySelector('h3').textContent.trim()));
  check('Germany still has its four packages',
    german.length === 4, JSON.stringify(german));

  /* ------------------------------- a partnership reaches the page it is sold on */

  /*
   * The whole point of the column: sign a partnership, mark one cell Free, and
   * that university becomes free to apply to on the public site.
   *
   * This is a regression test for two bugs found by doing exactly that and
   * looking at the result. `liveCatalogue()` — the object handed to BOTH the
   * finder and the matcher — never carried the field at all, so a partnership
   * was stored, shown on the sheet, shown in the office, and invisible to the
   * two things that use it. And the live-catalogue merge refreshed an existing
   * row's CGPA, fit and band but not its fee, so even once the endpoint
   * carried it, a row the page already knew about ignored the change.
   *
   * It only LOOKED right before because free and public coincide in today's
   * data. The first real partnership outside Germany would have exposed it.
   */
  const api = await (await admin.request.get(BASE + '/api/catalogue')).json();
  check('the public catalogue endpoint carries the fee model',
    (api.programmes || []).every(x => x.feeModel === 'free' || x.feeModel === 'package'),
    JSON.stringify((api.programmes || [])[0] || {}).slice(0, 90));

  const beforeCounts = await countsFor('GB');
  /* A partnership that ends: the university stays private, stays readable, and
     stops being free to apply to. One cell on the sheet, and the row has to
     change tabs on the home page without a rebuild. */
  const partner = rows.find(r => r[iCty] === 'GB');
  await upload(sheet(c => { if (c[iId] === partner[iId]) c[iApp] = 'Package'; }), true);

  const fresh = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const np = await fresh.newPage();
  await np.goto(BASE + '/');
  await np.waitForSelector('.rtab', { timeout: 15000 });
  await np.waitForTimeout(2200);
  await np.selectOption('#fCountry', 'GB');
  await np.click('#fGo');
  await np.waitForTimeout(1000);
  const afterCounts = {
    free: Number(await np.textContent('#rtnPub')),
    pkg: Number(await np.textContent('#rtnPriv')),
  };
  check('marking one cell Package moves that university across',
    afterCounts.pkg === beforeCounts.pkg + 1 && afterCounts.free === beforeCounts.free - 1,
    JSON.stringify(beforeCounts) + ' -> ' + JSON.stringify(afterCounts));

  await np.click('[data-rt="priv"]');
  await np.waitForTimeout(700);
  const movedRows = await np.$$eval('.mrow', r => r.map(x => x.innerText));
  check('and it is the one whose cell we changed',
    movedRows.length === 1 && movedRows[0].includes(partner[head.indexOf('university')]),
    movedRows.length + ' rows');
  /* It is charged now, not hidden. A private university's name was never the
     thing a package bought, and changing what applying costs must not start
     blurring it. */
  check('a charged private university is still readable',
    (await np.$$('.mrow .masked')).length === 0,
    (await np.$$('.mrow .masked')).length + ' blurred');

  /* Put it back. */
  await upload(sheet(() => {}), true);

  check('no page errors on the finder', ferrs.length === 0, ferrs[0] || '');

  await browser.close();
  ok.forEach(n => console.log('  ok   ' + n));
  bad.forEach(n => console.log('  BAD  ' + n));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
