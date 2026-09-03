/**
 * The counsellors' second testing round, 30 August.
 *
 * Thirteen notes on a screenshot. Most are cosmetic and would never have been
 * caught by a test, which is why they reached a testing round; two are not.
 *
 *   A DEADLINE THAT HAS ALREADY PASSED, printed beside a button saying Apply
 *   free. Filter the finder to Summer 2026 on 30 August 2026 and rows offered
 *   1 Jul and 15 Jun. Two faults in one expression: it took the FIRST intake
 *   on the programme whatever the student had asked for, and it never compared
 *   the date to today. This is not cosmetic — it is the site telling somebody
 *   they can still apply for something they cannot, and they find out after
 *   they have started.
 *
 *   A TAB WITH NOTHING BEHIND IT. Choose the UK and "Universities with a
 *   package" said 0 and could still be pressed, swapping four real
 *   universities for a paragraph of apology.
 *
 * And one instruction that runs through several of them. Vishal: "donot show
 * the count 12, 30 etc — only display universities. user donot need to know
 * the count we have." The four band cards were counting the WHOLE catalogue
 * while the two tabs counted only the popular subset below them, so one screen
 * carried two denominators with nothing saying which was which. The numbers
 * are still computed — they decide what is dimmed and what cannot be pressed —
 * they are simply never read out.
 *
 * The finder is exercised through the page rather than through the data,
 * because every one of these is a thing somebody saw.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* Guarded. Against the build this is meant to prove wrong, half these controls
   behave differently and an unguarded click ends the run rather than failing
   one check. */
const seen = (p, s) => p.isVisible(s).catch(() => false);
const txt = (p, s) => p.textContent(s).catch(() => '');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  /* ------------------------------------------- 1. the name beside the mark */
  const card = await page.evaluate(() => {
    const c = document.querySelector('.svc');
    if (!c) return null;
    const top = c.querySelector('.svc-top');
    const h = c.querySelector('h4');
    if (!top || !h) return null;
    const tb = top.getBoundingClientRect(), hb = h.getBoundingClientRect();
    const ic = c.querySelector('.svc-ic');
    const ib = ic ? ic.getBoundingClientRect() : null;
    return {
      nameInsideTop: top.contains(h),
      /* Beside, not under: their vertical middles are within a few pixels. */
      sameRow: ib ? Math.abs((hb.top + hb.bottom) / 2 - (ib.top + ib.bottom) / 2) < 8 : false,
      rightOfIcon: ib ? hb.left > ib.right - 1 : false,
      name: h.textContent.trim(),
      topH: tb.height,
    };
  }).catch(() => null);
  ok(card && card.nameInsideTop, 'the service name shares the row with the mark');
  ok(card && card.sameRow, 'and sits level with it, not under it — '
    + JSON.stringify(card));
  ok(card && card.rightOfIcon, 'and to its right');
  ok(card && card.name && card.name.length > 3, 'and is still the name — ' + (card || {}).name);

  /* ------------------------------- 2. a colour break before the dashboard */
  const seam = await page.evaluate(() => {
    const svc = document.querySelector('#services');
    const dash = document.querySelector('.block.b3');
    if (!svc || !dash) return null;
    const bg = el => getComputedStyle(el).backgroundColor;
    return { svc: bg(svc), dash: bg(dash), alt: dash.classList.contains('alt') };
  }).catch(() => null);
  ok(seam && seam.svc !== seam.dash,
    'the dashboard section is a different colour from the services above it — '
    + JSON.stringify(seam));

  /* ------------------------------------ 3. the two chips on a story card */
  const chips = await page.evaluate(() => {
    const row = document.querySelector('.tcard .trow');
    if (!row) return null;
    const kids = [...row.children].filter(el => el.offsetParent !== null);
    if (kids.length < 2) return { only: kids.length };
    const b = kids.map(el => el.getBoundingClientRect());
    return {
      count: kids.length,
      heights: b.map(r => Math.round(r.height)),
      tops: b.map(r => Math.round(r.top)),
    };
  }).catch(() => null);
  ok(chips && chips.count >= 2, 'a story card has both chips on it — '
    + JSON.stringify(chips));
  ok(chips && chips.heights && new Set(chips.heights).size === 1,
    'and they are the same height — ' + JSON.stringify(chips && chips.heights));
  ok(chips && chips.tops && new Set(chips.tops).size === 1,
    'and start at the same line — ' + JSON.stringify(chips && chips.tops));

  /* -------------------------------------------- 4. the two tabs, told apart */
  const tabs = await page.evaluate(() => {
    const p = document.querySelector('.rtab[data-rt="pub"]');
    const v = document.querySelector('.rtab[data-rt="priv"]');
    if (!p || !v) return null;
    const s = el => getComputedStyle(el);
    return {
      pubBg: s(p).backgroundColor, privBg: s(v).backgroundColor,
      pubBr: s(p).borderTopColor, privBr: s(v).borderTopColor,
    };
  }).catch(() => null);
  ok(tabs && tabs.pubBg !== tabs.privBg,
    'the two result tabs are different colours — ' + JSON.stringify(tabs));
  ok(tabs && tabs.pubBr !== tabs.privBr, 'including their borders');

  /* --------------------------------------------------- 5. and no counts on them */
  const counted = await page.evaluate(() => {
    const shown = el => el && el.offsetParent !== null
      && getComputedStyle(el).display !== 'none';
    const rails = [...document.querySelectorAll('.rail-n')];
    const tabns = [...document.querySelectorAll('.rtab .rtn')];
    const chip = document.querySelector('#rCount');
    return {
      railShown: rails.filter(shown).length,
      tabShown: tabns.filter(shown).length,
      chip: shown(chip) ? (chip.textContent || '').trim() : '',
      /* Still computed, because the dimming and the disabling depend on it. */
      railText: rails.map(e => (e.textContent || '').trim()),
    };
  }).catch(() => null);
  ok(counted && counted.railShown === 0,
    'the band cards do not say how many we have — ' + (counted || {}).railShown);
  ok(counted && counted.tabShown === 0,
    'nor do the tabs — ' + (counted || {}).tabShown);
  ok(counted && !/\d/.test(counted.chip),
    'nor the chip over the list — "' + (counted || {}).chip + '"');
  ok(counted && counted.railText.some(x => /\d/.test(x)),
    'but the numbers are still worked out, because the dimming needs them — '
    + JSON.stringify(counted && counted.railText));

  const opts = await page.evaluate(() =>
    ['#fCountry', '#fLevel', '#fField', '#fIntake']
      .map(s => document.querySelector(s))
      .filter(Boolean)
      .flatMap(el => [...el.options].map(o => o.textContent))
      .filter(t => /\(\d+\)\s*$/.test(t))).catch(() => ['evaluate failed']);
  ok(opts && !opts.length,
    'and the dropdowns do not either — ' + JSON.stringify((opts || []).slice(0, 3)));

  /* ------------------------------------------------- 6. the country, readable */
  const country = await page.evaluate(() => {
    const cc = document.querySelector('.mrow .mcc');
    const ct = document.querySelector('.mrow .mctry');
    if (!cc || !ct) return null;
    return {
      ccSize: parseFloat(getComputedStyle(cc).fontSize),
      ccText: (cc.textContent || '').trim(),
      ctSize: parseFloat(getComputedStyle(ct).fontSize),
      ctWeight: getComputedStyle(ct).fontWeight,
      ctText: (ct.textContent || '').trim(),
    };
  }).catch(() => null);
  ok(country && country.ccSize >= 13,
    'the country code is big enough to read — ' + JSON.stringify(country));
  ok(country && Number(country.ctWeight) >= 600,
    'and the country name stands out on the row — ' + (country || {}).ctWeight);

  /* ---------------------------------------- 7. the university's own website
   *
   * Given a row that HAS one. Every address in the shipped catalogue — all 153
   * of them — is on a PUBLIC university, and a public row is stripped of
   * everything but its shape before it leaves the server, which is what a
   * package buys. The 18 private universities a browsing visitor actually sees
   * named are the ones the office has never filled an address in for.
   *
   * So the office fills one in here, the way it would on the Catalogue screen,
   * and the check is that it reaches the row. That is the code under test; the
   * empty column is a data job and is reported as one.
   */
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const cat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json()
    .catch(() => ({}));
  const priv = (cat.programmes || []).find(x => !x.isPublic);
  ok(!!priv, 'the office can see a private university to edit — '
    + (priv ? priv.university : 'none found'));
  if (priv) {
    const put = await admin.request.put(BASE + '/api/staff/programme',
      { data: Object.assign({}, priv, { url: 'https://example.edu/programme' }) });
    ok(put.ok(), 'and can put its website on it — ' + put.status()
      + ' ' + (await put.text()).slice(0, 70));
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);

  const links = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.mrow')];
    const withLink = rows.map(r => r.querySelector('.msub .ulink')).filter(Boolean);
    const a = withLink[0];
    return {
      rows: rows.length,
      linked: withLink.length,
      href: a ? a.getAttribute('href') : '',
      target: a ? a.getAttribute('target') : '',
      rel: a ? a.getAttribute('rel') : '',
      text: a ? a.textContent.trim() : '',
    };
  }).catch(() => null);
  ok(links && links.linked > 0,
    'a student can open the university’s own site from the row — '
    + JSON.stringify(links));
  ok(links && /^https?:\/\//i.test(links.href || ''),
    'and it is a real address — ' + (links || {}).href);
  ok(links && links.target === '_blank', 'opening in its own tab');
  ok(links && /noopener/.test(links.rel || ''),
    'without handing it a handle on ours — ' + (links || {}).rel);
  ok(links && /nofollow/.test(links.rel || ''),
    'and not counted as an endorsement — ' + (links || {}).rel);

  /* ------------------------------------- 8. a deadline that has not gone
     The one that matters. Every date printed on a row is compared with today. */
  const readDeadlines = () => page.evaluate(() => {
    return [...document.querySelectorAll('.mrow .mact')].map(a => {
      const spans = [...a.querySelectorAll('span')]
        .map(s => (s.textContent || '').trim())
        .filter(Boolean);
      return spans.join(' ');
    }).filter(Boolean);
  }).catch(() => []);

  const parseDay = s => {
    const m = /^(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?/.exec(s);
    if (!m) return null;
    const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6,
      aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = MON[m[2].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    /* The year when the row prints one, and only then the current year. The
       row prints it precisely WHEN the deadline is not in this year, so a bare
       "31 Aug" can only mean this August — which is the ambiguity that fix
       removed, and this reader has to honour it or it re-invents the bug it is
       checking for. */
    const year = m[3] ? Number(m[3]) : new Date().getFullYear();
    return new Date(year, mon, Number(m[1]));
  };

  const gone = list => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return list.filter(s => {
      const d = parseDay(s);
      /* Now that a year is printed whenever it is not this one, a date can be
         compared straight against today with nothing to be generous about. */
      return d && d < today;
    });
  };

  const browse = await readDeadlines();
  ok(browse.length > 0, 'rows carry a deadline or say why not — ' + browse.length);
  ok(!gone(browse).length,
    'and none of them is a date that has already passed — '
    + JSON.stringify(gone(browse).slice(0, 3)));

  /* Now the exact case from the testing round: an intake filter set. */
  const intakes = await page.evaluate(() => {
    const el = document.querySelector('#fIntake');
    return el ? [...el.options].map(o => o.value).filter(Boolean) : [];
  }).catch(() => []);
  ok(intakes.length > 0, 'the finder offers intakes — ' + intakes.join(','));

  let checkedIntakes = 0, badIntake = [];
  for (const v of intakes) {
    await page.selectOption('#fIntake', v).catch(() => {});
    /* Pressed, not just chosen. Changing a dropdown only redraws once the
       finder has been used at least once — which is the design, and which is
       also how the tester got to the screen they photographed. */
    await page.click('#fGo').catch(() => {});
    await page.waitForTimeout(800);
    const got = await readDeadlines();
    checkedIntakes++;
    const bad = gone(got);
    if (bad.length) badIntake.push(v + ': ' + bad.slice(0, 2).join(', '));
  }
  ok(checkedIntakes === intakes.length,
    'every intake was checked — ' + checkedIntakes + ' of ' + intakes.length);
  ok(!badIntake.length,
    'and no intake shows a deadline that has gone — ' + badIntake.slice(0, 3).join(' | '));

  /* A closed one says so rather than going quiet. Silence beside an Apply
     button reads as "no deadline", which is the opposite of the truth. */
  const closedWording = await page.evaluate(() =>
    document.body.innerText.includes('intake closed')).catch(() => false);
  ok(typeof closedWording === 'boolean',
    'the closed wording is reachable (present on this data: ' + closedWording + ')');

  await page.selectOption('#fIntake', '').catch(() => {});
  await page.click('#fGo').catch(() => {});
  await page.waitForTimeout(700);

  /* --------------------------------- 9. an empty tab cannot be pressed
     The case from the round: the United Kingdom, where nothing needs a
     package. */
  await page.selectOption('#fCountry', 'GB').catch(() => {});
  await page.click('#fGo').catch(() => {});
  await page.waitForTimeout(1100);
  const uk = await page.evaluate(() => {
    const p = document.querySelector('.rtab[data-rt="pub"]');
    const v = document.querySelector('.rtab[data-rt="priv"]');
    return {
      pubDisabled: !!(p && p.disabled), privDisabled: !!(v && v.disabled),
      rows: document.querySelectorAll('.mrow').length,
      on: document.querySelector('.rtab.on')
        ? document.querySelector('.rtab.on').dataset.rt : '',
    };
  }).catch(() => null);
  ok(uk && uk.rows > 0, 'the UK has universities to show — ' + JSON.stringify(uk));
  ok(uk && uk.privDisabled,
    'and the package tab, with nothing behind it, cannot be pressed');
  ok(uk && !uk.pubDisabled, 'while the one with the rows still can');
  ok(uk && uk.on === 'pub', 'and the list showing is the one that has something');

  /* Never both. A screen with two dead tabs has no way out of it. */
  const bothDead = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.rtab')];
    return t.length > 1 && t.every(b => b.disabled);
  }).catch(() => false);
  ok(!bothDead, 'never both at once');

  await page.selectOption('#fCountry', '').catch(() => {});
  await page.click('#fGo').catch(() => {});
  await page.waitForTimeout(800);

  /* ------------------------------------------ 10. the marks box takes marks */
  if (await seen(page, '#openCgpa')) await page.click('#openCgpa').catch(() => {});
  await page.waitForTimeout(600);
  ok(await seen(page, '#cvVal'), 'the marks converter opens');
  await page.fill('#cvVal', '').catch(() => {});
  await page.type('#cvVal', 'seventy8.5x', { delay: 12 }).catch(() => {});
  await page.waitForTimeout(400);
  const typed = await page.inputValue('#cvVal').catch(() => 'read failed');
  ok(!/[a-z]/i.test(typed), 'and refuses letters as they are typed — "' + typed + '"');
  ok(typed === '8.5', 'keeping the digits and the point — "' + typed + '"');

  await page.fill('#cvVal', '').catch(() => {});
  await page.type('#cvVal', '7.8.9', { delay: 12 }).catch(() => {});
  const dotty = await page.inputValue('#cvVal').catch(() => '');
  ok((dotty.match(/\./g) || []).length <= 1,
    'and never more than one decimal point — "' + dotty + '"');

  await page.fill('#cvVal', '78').catch(() => {});
  await page.waitForTimeout(500);
  const band = await txt(page, '#cvBand');
  ok(/band/i.test(band), 'a real score still gives an answer — ' + band.slice(0, 60));
  ok(!/\d+\s+of\s+\d+/.test(band),
    'and the answer does not count our catalogue at them — ' + band.slice(0, 80));

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  ok(!errs.length, 'no page errors on the home page — ' + errs.slice(0, 2).join(' | '));

  /* --------------------------------------- 11. the contact form comes first */
  const cp = await ctx.newPage();
  const cErrs = [];
  cp.on('pageerror', e => cErrs.push(String(e)));
  await cp.goto(BASE + '/contact-us.html', { waitUntil: 'load' });
  await cp.waitForTimeout(1200);

  const order = await cp.evaluate(() => {
    const f = document.querySelector('#ctForm');
    const r = document.querySelector('#reachBox');
    if (!f || !r) return null;
    return {
      formTop: Math.round(f.getBoundingClientRect().top + scrollY),
      reachTop: Math.round(r.getBoundingClientRect().top + scrollY),
      formFirst: !!(f.compareDocumentPosition(r)
        & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  }).catch(() => null);
  ok(order && order.formFirst,
    'the contact form comes before the phone number — ' + JSON.stringify(order));
  ok(order && order.formTop < order.reachTop,
    'and is higher up the page');

  /* Still a working form, and the numbers are still on the page. */
  ok(await seen(cp, '#ctName'), 'the form is still whole');
  ok(await seen(cp, '#ctGo'), 'with its Send button');
  ok(await seen(cp, '#reachTel'), 'and the phone number is still there');
  const heads = await cp.evaluate(() =>
    [...document.querySelectorAll('h2')].map(h => h.textContent.trim())).catch(() => []);
  ok(!heads.some(h => /^Or write to us here$/i.test(h)),
    'the heading no longer says "Or" while standing first — '
    + JSON.stringify(heads.slice(0, 5)));
  ok(!cErrs.length, 'no page errors on the contact page — ' + cErrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
