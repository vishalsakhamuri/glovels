/**
 * The intake form, after the counsellors' testing round.
 *
 * Thirteen findings, all on the screen a student fills in once and the office
 * then reads for the next eighteen months. Most are small; three of them
 * change what the matcher is being told, and those are the ones with teeth:
 *
 *   - A destination is now a LIST. Read with the old single-value lookup,
 *     "Germany, Poland" is an unrecognised country name, and an unrecognised
 *     country name meant NO COUNTRY CONSTRAINT — so a student who named two
 *     destinations would have been sold universities from all seven. That is
 *     the bug patch 61 fixed once already, arriving through a different door.
 *   - A budget is now a LIST. Taking the first band that matches would hold
 *     somebody who ticked the top band to the bottom one.
 *   - The same form is rendered a second time in the partner portal. A field
 *     type that only the student's screen understands is an agency typing
 *     country names into a text box by hand.
 *
 * So the browser half of this suite checks what a person sees, and the second
 * half buys a package and reads what the machine actually delivered.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();
let seq = 0;

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* A student of our own, so nothing here depends on the demo account's
     answers and two runs of this suite do not fight over one profile. */
  const email = 'prof' + stamp + '@ex.example';
  const pw = 'prof-' + stamp;
  await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'Profile Student ' + stamp, email, password: pw, role: 'student' } });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  /* Somebody else chose the first password, so the account opens one thing
     until it is replaced — and replacing it rotates the session, which is why
     signing in happens twice rather than once. */
  await ctx.request.post(BASE + '/api/auth/login', { data: { email, password: pw } });
  await ctx.request.post(BASE + '/api/auth/change',
    { data: { current: pw, password: pw + 'X' } });
  await ctx.request.post(BASE + '/api/auth/login', { data: { email, password: pw + 'X' } });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pForm .field');
  await page.waitForTimeout(1200);

  const go = async name => {
    const i = await page.$$eval('#secNav [data-i]',
      (bs, n) => bs.findIndex(b => b.textContent.includes(n)), name);
    check('there is a "' + name + '" section', i >= 0);
    if (i >= 0) { await page.click('#secNav [data-i="' + i + '"]'); await page.waitForTimeout(450); }
  };
  const keys = () => page.$$eval('#pForm .field', fs => fs.map(f => f.dataset.k));
  const labelOf = k => page.$eval('.field[data-k="' + k + '"] label', e => e.textContent);

  /* ---------------------------------------------- 5, 6, 7 — years are years
     A year of passing was a number box, and what Vishal saw in it was the
     browser's own suggestion list — 1, 2, 3, 4, 5, 6. Not a list of years, and
     no amount of placeholder text makes it one. */
  await go('Class 10');
  const y10 = await page.$$eval('#pForm select[name="x_year"] option', os => os.map(o => o.value));
  check('Class 10 year of passing is a list of years', /^(19|20)\d{2}$/.test(y10[1] || ''),
    y10.slice(0, 4).join(','));
  check('  · going back far enough for anybody applying', y10.length > 35, y10.length + ' years');
  await go('Class 12');
  const y12 = await page.$$eval('#pForm select[name="xii_year"] option', os => os.map(o => o.value));
  check('Class 12 year of passing is a list of years', /^(19|20)\d{2}$/.test(y12[1] || ''),
    y12.slice(0, 3).join(','));
  await go('Bachelor');
  const yd = await page.$$eval('#pForm select[name="d_year"] option',
    os => os.map(o => o.value).filter(Boolean));
  check('the degree year is a list of years too', /^(19|20)\d{2}$/.test(yd[0] || ''), yd[0]);
  /* Somebody in their final year is applying now and has not finished. */
  check('  · and it allows a course not finished yet',
    Number(yd[0]) > new Date().getFullYear(), yd[0] + ' vs ' + new Date().getFullYear());

  /* ------------------------------------------------ 12 — the date, corrected
     "backspace does not work for Expiry date of passport". A native date input
     is a row of segments rather than text, so what a backspace does to it is
     the browser's business — and on a phone there is no keyboard involved at
     all. Nothing here is typed, so there is nothing to correct. */
  await go('Passport');
  await page.selectOption('[name="p_has"]', 'Yes');
  await page.waitForTimeout(450);
  /* Guarded from here on, and everywhere below that presses something new.
     Unguarded, these TIME OUT against a tree that does not have the control
     yet — which ends the run, so the forty checks after them report nothing at
     all and the log is a stack trace instead of a list of what is wrong.
     Fourth time this has come up; it is a rule now. */
  const dateParts = (await page.$$('#pForm [data-date="p_exp"] select')).length;
  check('the passport expiry is three lists, not a date box', dateParts === 3,
    dateParts + ' lists');
  if (dateParts === 3) {
    const setDate = async (k, d, m, y) => {
      await page.selectOption('#pForm [data-date="' + k + '"] [data-part="d"]', d);
      await page.selectOption('#pForm [data-date="' + k + '"] [data-part="m"]', m);
      await page.selectOption('#pForm [data-date="' + k + '"] [data-part="y"]', y);
      await page.waitForTimeout(350);
    };
    await setDate('p_exp', '02', '08', '2031');
    check('  · and the three of them make one date',
      (await page.evaluate(() => DB.profile.p_exp)) === '2031-08-02',
      await page.evaluate(() => DB.profile.p_exp));
    /* Half a date is worse than none: it reaches the visa checklist as a real
       answer and nobody looks at it again. */
    await page.selectOption('#pForm [data-date="p_exp"] [data-part="m"]', '');
    await page.waitForTimeout(350);
    check('  · and half a date is no date at all',
      (await page.evaluate(() => DB.profile.p_exp)) === '');
    await setDate('p_exp', '02', '08', '2031');
  }

  /* --------------------------------------- 13 — a box only when there is one */
  check('no box asking about a refusal until there is one',
    (await page.$$('[name="p_refuse_why"]')).length === 0);
  await page.selectOption('[name="p_refuse"]', 'Yes');
  await page.waitForTimeout(500);
  check('saying Yes opens a box to explain it',
    (await page.$$('[name="p_refuse_why"]')).length === 1);
  check('  · and it is optional, not another demand',
    (await page.$$('[name="p_refuse_why"]')).length === 1
      && /optional/i.test(await labelOf('p_refuse_why')));
  await page.selectOption('[name="p_refuse"]', 'No');
  await page.waitForTimeout(500);
  check('  · and it goes away when the answer changes',
    (await page.$$('[name="p_refuse_why"]')).length === 0);

  /* ------------------------------------------------- 8 — the four band scores
     A university asks per skill. A 7.0 overall with 5.5 in writing is refused
     by programmes a flat 6.5 would pass. */
  await go('English');
  await page.selectOption('[name="e_test"]', 'IELTS');
  await page.waitForTimeout(500);
  const bands = await keys();
  check('an English test has listening, reading, writing and speaking',
    ['e_listen', 'e_read', 'e_write', 'e_speak'].every(k => bands.includes(k)), bands.join(','));
  const hasBands = bands.includes('e_write');
  check('  · required where the test reports bands',
    hasBands && !/optional/i.test(await labelOf('e_write')));
  /* A Medium of Instruction letter has no bands. Asking for four of them makes
     a profile that can never reach 100%, and a meter nobody can clear is a
     meter nobody trusts. */
  await page.selectOption('[name="e_test"]', 'Medium of Instruction letter');
  await page.waitForTimeout(500);
  check('  · and optional where it reports none',
    hasBands && /optional/i.test(await labelOf('e_write')));
  await page.selectOption('[name="e_test"]', 'IELTS');
  await page.waitForTimeout(400);

  /* ------------------------------------------- 9, 10 — more than one answer */
  await go('Goals');
  const destBoxes = (await page.$$('#pForm [data-multi="g_country"] input')).length;
  check('destinations are a set of choices, not one', destBoxes >= 7, destBoxes + ' boxes');
  if (destBoxes) {
    await page.click('#pForm [data-multi="g_country"] input[value="Ireland"]');
    await page.click('#pForm [data-multi="g_country"] input[value="Poland"]');
    await page.waitForTimeout(400);
    check('  · and two of them can be chosen',
      (await page.evaluate(() => DB.profile.g_country)) === 'Ireland, Poland',
      await page.evaluate(() => DB.profile.g_country));
  } else {
    check('  · and two of them can be chosen', false, 'there is only one to choose');
  }

  await go('Budget');
  const bandBoxes = await page.$$eval('#pForm [data-multi="b_total"] input', is => is.map(i => i.value));
  check('the budget takes more than one band', bandBoxes.length === 4, bandBoxes.join(' | '));
  if (bandBoxes.length >= 3) {
    for (const v of [bandBoxes[0], bandBoxes[2]]) {
      await page.click('#pForm [data-multi="b_total"] input[value="' + v.replace(/"/g, '\\"') + '"]');
    }
    await page.waitForTimeout(400);
    const budget = await page.evaluate(() => DB.profile.b_total);
    check('  · and both are kept', budget.split(',').length === 2, budget);
  } else {
    check('  · and both are kept', false, 'there is nothing to tick');
  }

  /* --------------------------------------------- 11 — two people, two blocks
     Six fields in one column, with the name of the person only in the label,
     is how a manager's email ends up filed under a professor's name. */
  await go('Recommenders');
  const grps = await page.$$eval('#pForm .fgrp',
    gs => gs.map(g => ({ cls: g.className, name: g.querySelector('b').textContent })));
  check('the two recommenders are separate blocks', grps.length === 2,
    JSON.stringify(grps.map(g => g.name)));
  check('  · told apart by colour', grps.length === 2 && grps[0].cls !== grps[1].cls,
    JSON.stringify(grps.map(g => g.cls)));
  if (!grps.length) check('  · and named for the person in them', false, 'no blocks drawn');

  /* ----------------------------------------------------- 3 — family details */
  await go('Family');
  const fam = await keys();
  check("family details capture a parent's name and mobile",
    fam.includes('fam_name') && fam.includes('fam_phone'), fam.join(','));
  check('  · and none of it is required',
    await page.$$eval('#pForm .field label', ls => ls.every(l => /optional/i.test(l.textContent))));

  /* ------------------------------- 2 — the two the office cannot work without
     Everything else on this form can be filled in later. A record with no way
     to reach the person cannot. */
  await go('Personal');
  check('there is an alternate contact number', (await page.$$('[name="alt_phone"]')).length === 1);
  check('  · and it is optional',
    (await page.$$('[name="alt_phone"]')).length === 1
      && /optional/i.test(await labelOf('alt_phone')));
  check('mobile and email are marked required on the label, not just implied',
    (await page.$$('#pForm .reqmark')).length === 2);

  await page.fill('[name="phone"]', '');
  await page.fill('[name="email"]', 'someone@example.com');
  await page.click('#saveBtn');
  await page.waitForTimeout(600);
  check('saving without a mobile number is refused',
    (await page.$$('#pForm .field.bad')).length === 1,
    await page.$eval('#pForm .ferr:not([hidden])', e => e.textContent).catch(() => 'no message'));
  await page.fill('[name="phone"]', '12345');
  await page.click('#saveBtn');
  await page.waitForTimeout(600);
  check('  · and so is something that is not one',
    /does not look right/i.test(
      await page.$eval('#pForm .ferr:not([hidden])', e => e.textContent).catch(() => '')));
  await page.fill('[name="phone"]', '9876543210');
  await page.fill('[name="email"]', 'not-an-email');
  await page.click('#saveBtn');
  await page.waitForTimeout(600);
  check('  · and an email that is not one',
    (await page.$eval('#pForm .field.bad', e => e.dataset.k).catch(() => 'nothing marked')) === 'email');
  /* Moving between sections is NOT gated. Losing an answer because a phone
     number is half typed is worse than holding an invalid one for a minute. */
  await page.click('#nextBtn');
  await page.waitForTimeout(500);
  check('  · but a half-filled section can still be left',
    (await page.$eval('#pForm h3', e => e.textContent)).indexOf('Personal') < 0,
    await page.$eval('#pForm h3', e => e.textContent.trim()));
  await go('Personal');
  check('  · and what was typed is still there',
    (await page.inputValue('[name="phone"]')) === '9876543210');

  /* ------------------------------------------------ 1 — where the answer goes
     "the confirmation message shows up right next to the Save button, it must
     be displayed in the centre of the page clearly and prominently." At the
     bottom edge it competes with whatever the thumb is covering, and on a long
     form it can land off-screen entirely. */
  await page.fill('[name="email"]', 'someone@example.com');
  await page.click('#saveBtn');
  await page.waitForTimeout(700);
  const said = await page.evaluate(() => {
    const t = document.querySelector('#toast');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { txt: t.textContent.trim(), cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      vw: innerWidth, vh: innerHeight, size: parseFloat(getComputedStyle(t).fontSize) };
  });
  check('a save is confirmed', said && /saved/i.test(said.txt), said && said.txt);
  check('  · in the middle of the screen',
    said && Math.abs(said.cx - said.vw / 2) < 8 && Math.abs(said.cy - said.vh / 2) < 8,
    said && Math.round(said.cx) + ',' + Math.round(said.cy)
      + ' of ' + said.vw + 'x' + said.vh);
  check('  · and big enough to be the thing you notice', said && said.size >= 15,
    said && said.size + 'px');

  /* --------------------------------------------------- 4 — a way back as well
     Twelve sections with only a Next is a form you can walk into and not out
     of without going up to the nav. */
  await go('Goals');
  const here = await page.$eval('#pForm h3', e => e.textContent.trim());
  const hasPrev = (await page.$$('#prevBtn')).length === 1;
  check('there is a Previous section button', hasPrev);
  if (hasPrev) {
    await page.click('#prevBtn');
    await page.waitForTimeout(450);
    const back = await page.$eval('#pForm h3', e => e.textContent.trim());
    check('  · and it goes back one', back !== here, here + ' -> ' + back);
    await page.click('#nextBtn');
    await page.waitForTimeout(450);
    check('  · and Next returns to where you were',
      (await page.$eval('#pForm h3', e => e.textContent.trim())) === here);
  }

  check('no page errors on the profile', errs.length === 0, errs[0] || '');
  await page.close();

  /* ================================================================= the machine
   *
   * Everything above is what a person sees. This is what the answers DO.
   *
   * `/api/profile` is the same door the screen writes through, so a profile
   * put here is indistinguishable from one typed in. */
  const shopper = async () => {
    const c = await browser.newContext();
    const ip = '10.9.' + (seq++ % 250) + '.4';
    return {
      buy: d => c.request.post(BASE + '/api/orders',
        { headers: { 'x-forwarded-for': ip }, data: d }),
      api: (m, p, d) => c.request[m](BASE + p, d ? { data: d } : undefined),
    };
  };

  const content = await (await admin.request.get(BASE + '/api/content')).json();
  /* A package that promises universities WITHOUT promising public ones. The
     public tiers only ever deliver German public rows — six of our seven
     destinations have none — so a country filter cannot be observed through
     one of those at all. */
  const pkg = (content.packages.items || [])
    .filter(p => Number(p.matches || 0) > 0 && !Number(p.unlocks || 0) && p.sell !== false)
    .sort((a, b) => Number(b.matches) - Number(a.matches))[0];
  check('there is a package that delivers universities anywhere', !!pkg,
    pkg && (pkg.id + ', ' + pkg.matches + ' universities'));

  const deliverTo = async profile => {
    const s = await shopper();
    const em = 'pm' + Date.now() + Math.random().toString(36).slice(2, 7) + '@example.com';
    const r = await s.buy({ packageId: pkg.id, name: 'Matcher Test', email: em,
      phone: '+919000009999', acceptedTerms: true });
    if (r.status() !== 200) return { error: r.status() + ' ' + (await r.text()).slice(0, 100) };
    await s.api('post', '/api/auth/change', { password: 'a-password-here' });
    await s.api('put', '/api/profile', { profile });
    const st = await (await s.api('get', '/api/state')).json();
    return { rows: st.shortlist || [] };
  };

  const BASE_PROFILE = { fullName: 'Matcher Test', d_cgpa: '8.2', g_level: "Master's",
    g_field: 'Computer Science', phone: '9876543210', email: 'x@y.co' };

  if (pkg) {
    /* THE regression. Two destinations must mean two destinations — not none.
       Read with a single-value lookup, "Ireland, Poland" matches no country in
       the table, and no country in the table meant no constraint at all. */
    const two = await deliverTo(Object.assign({}, BASE_PROFILE,
      { g_country: 'Ireland, Poland' }));
    if (two.error) {
      check('naming two destinations delivers from those two', false, two.error);
    } else {
      const got = [...new Set(two.rows.map(r => r.country))].sort();
      check('naming two destinations delivers from those two and no others',
        two.rows.length > 0 && got.every(c => c === 'IE' || c === 'PL'),
        got.join(',') + ' across ' + two.rows.length + ' rows');
    }

    /* And one still means one, which is the check that would have caught the
       whole thing had it existed in the other direction. */
    const one = await deliverTo(Object.assign({}, BASE_PROFILE, { g_country: 'Poland' }));
    if (!one.error) {
      const got = [...new Set(one.rows.map(r => r.country))];
      check('naming one still delivers only that one',
        one.rows.length > 0 && got.every(c => c === 'PL'),
        got.join(',') + ' across ' + one.rows.length + ' rows');
    }

    /* Open to advice is the answer that means "no constraint", and it has to
       keep meaning that now the field takes several answers. */
    const open = await deliverTo(Object.assign({}, BASE_PROFILE,
      { g_country: 'Open to advice' }));
    if (!open.error) {
      check('open to advice is still open to anywhere', open.rows.length > 0,
        open.rows.length + ' rows');
    }

    /* The budget cannot be read back out of a delivery: when the strict filter
       comes up short the matcher RELAXES the budget on purpose — that is patch
       51's behaviour and it is right — so an expensive row in the result proves
       nothing either way. The two things that can actually break are pure
       functions, so they are read directly. */
  }

  const MATCHES = require('/home/claude/glovels/build/server/matches.js');
  const w = p => MATCHES.wants(p);

  check('one destination is one destination',
    JSON.stringify(w({ g_country: 'Poland' }).countries) === '["PL"]',
    JSON.stringify(w({ g_country: 'Poland' }).countries));
  check('two are two, not none',
    JSON.stringify(w({ g_country: 'Ireland, Poland' }).countries) === '["IE","PL"]',
    JSON.stringify(w({ g_country: 'Ireland, Poland' }).countries));
  /* THE regression this whole change could have introduced. The old lookup was
     COUNTRY_CODE[whole string]; "Ireland, Poland" is not a key, so it returned
     null — and null means no country constraint at all. A student who named
     two would have been sold universities from all seven. */
  check('  · and never null, which would mean anywhere',
    w({ g_country: 'Ireland, Poland' }).countries !== null);
  check('open to advice still means anywhere',
    w({ g_country: 'Open to advice' }).countries === null);
  check('  · even when it is ticked alongside a country',
    w({ g_country: 'Germany, Open to advice' }).countries === null);
  check('naming nothing still constrains nothing',
    w({ g_country: '' }).countries === null);
  check('a country we do not sell is dropped, not honoured',
    JSON.stringify(w({ g_country: 'Germany, Narnia' }).countries) === '["DE"]',
    JSON.stringify(w({ g_country: 'Germany, Narnia' }).countries));

  check('one budget band is that band',
    w({ b_total: 'Under ₹10 Lakhs' }).ceiling === 1000000,
    String(w({ b_total: 'Under ₹10 Lakhs' }).ceiling));
  /* The honest reading of "under ₹10L and ₹20-40L" is that ₹40L is
     affordable. Taking the first band that matched — which is what a
     single-value read does — would have held somebody who ticked the top band
     to the bottom one. */
  check('two bands means the HIGHER of them, not the first',
    w({ b_total: 'Under ₹10 Lakhs, ₹20-40 Lakhs' }).ceiling === 4000000,
    String(w({ b_total: 'Under ₹10 Lakhs, ₹20-40 Lakhs' }).ceiling));
  check('  · whichever order they were ticked in',
    w({ b_total: '₹20-40 Lakhs, Under ₹10 Lakhs' }).ceiling === 4000000,
    String(w({ b_total: '₹20-40 Lakhs, Under ₹10 Lakhs' }).ceiling));
  check('the top band removes the ceiling rather than setting a big one',
    w({ b_total: 'Under ₹10 Lakhs, Above ₹40 Lakhs' }).ceiling === null,
    String(w({ b_total: 'Under ₹10 Lakhs, Above ₹40 Lakhs' }).ceiling));
  check('saying nothing about money is not a ceiling of zero',
    w({ b_total: '' }).ceiling === undefined, String(w({ b_total: '' }).ceiling));

  /* A profile is usable when it names a destination — and that has to survive
     the field becoming a list, or every buyer is told to fill in their profile
     when they already have. */
  check('a profile that names destinations is usable',
    MATCHES.usable({ g_country: 'Ireland, Poland' }));

  /* ============================================ the agency fills the same form
   *
   * The partner portal renders SECTIONS a second time. A field type only the
   * student's screen understands renders there as `type="multi"`, which every
   * browser treats as a plain text box — an agency typing country names in by
   * hand, and getting them subtly wrong. */
  const pemail = 'pagency' + stamp + '@agency.example';
  const ppw = 'pag-' + stamp;
  await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'Form Agency ' + stamp, email: pemail, password: ppw, role: 'partner' } });
  const pctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await pctx.request.post(BASE + '/api/auth/login', { data: { email: pemail, password: ppw } });
  await pctx.request.post(BASE + '/api/auth/change', { data: { current: ppw, password: ppw + 'X' } });
  await pctx.request.post(BASE + '/api/auth/login', { data: { email: pemail, password: ppw + 'X' } });

  const pp = await pctx.newPage();
  const perrs = [];
  pp.on('pageerror', e => perrs.push(String(e)));
  await pp.goto(BASE + '/partner.html');
  await pp.waitForSelector('#stuRows');
  await pp.waitForTimeout(500);
  await pp.click('#openAdd');
  await pp.waitForSelector('#addModal.on');
  await pp.fill('#aName', 'Agency Student ' + stamp);
  await pp.fill('#aEmail', 'as' + stamp + '@ex.example');
  await pp.click('#addOne');
  await pp.waitForTimeout(900);
  await pp.click('.prow');
  await pp.waitForTimeout(1100);
  await pp.click('[data-p="details"]');
  await pp.waitForTimeout(800);

  check('the agency gets the checkbox groups too',
    (await pp.$$('#p-details [data-multi] input')).length >= 11,
    (await pp.$$('#p-details [data-multi] input')).length + ' boxes');
  check('and the three-part dates',
    (await pp.$$('#p-details [data-date] select')).length >= 9,
    (await pp.$$('#p-details [data-date] select')).length + ' lists');
  /* A `years` field carries no `o` list of its own. Read for one, the agency's
     dropdown came out empty — a required field nobody could fill. */
  const empties = await pp.$$eval('#p-details select[data-f]',
    ss => ss.filter(s => s.options.length <= 1).map(s => s.dataset.f));
  check('and no dropdown that has nothing in it', empties.length === 0, empties.join(','));

  const agencyReady = await pp.evaluate(() => {
    const g = document.querySelector('#p-details [data-multi="g_country"]');
    const d = document.querySelector('#p-details [data-date="p_exp"]');
    if (!g || !d) return false;
    g.querySelectorAll('input')[0].checked = true;
    g.querySelectorAll('input')[4].checked = true;
    d.querySelector('[data-part="d"]').value = '02';
    d.querySelector('[data-part="m"]').value = '08';
    d.querySelector('[data-part="y"]').value = '2031';
    return true;
  });
  await pp.click('#saveProfile');
  await pp.waitForTimeout(1400);
  await pp.reload();
  await pp.waitForSelector('#stuRows');
  await pp.waitForTimeout(800);
  await pp.click('.prow');
  await pp.waitForTimeout(1100);
  await pp.click('[data-p="details"]');
  await pp.waitForTimeout(800);
  const kept = await pp.evaluate(() => ({
    c: [...document.querySelectorAll('#p-details [data-multi="g_country"] input:checked')]
      .map(i => i.value),
    e: ['y', 'm', 'd'].map(s =>
      (document.querySelector('#p-details [data-date="p_exp"] [data-part="' + s + '"]') || {}).value
      || '?'),
  }));
  /* `.value` on a <div> is undefined. Left to the plain sweep that reads every
     [data-f], a save would have written undefined over whatever was there. */
  check('what an agency ticks survives a save and a reload',
    agencyReady && kept.c.length === 2,
    agencyReady ? JSON.stringify(kept.c) : 'the controls are not on the agency form');
  check('and so does a date it picked',
    agencyReady && kept.e.join('-') === '2031-08-02', kept.e.join('-'));
  check('no page errors on the agency form', perrs.length === 0, perrs[0] || '');

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
