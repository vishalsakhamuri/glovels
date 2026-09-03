/**
 * The Catalogue screen in the office, and the sheet that feeds it.
 *
 * "Filters what we have on site we should have same, and CGPA is not visible
 *  on the screen. Sidebar to move to the side is missing."
 *
 * Three separate things, all true:
 *
 *   THE FILTERS. The public finder asks six questions — destination, level,
 *   field, budget, CGPA, intake. The office screen asked two, so there was no
 *   way to see what a student with 6.5 would actually be shown without making
 *   an account and paying for a package.
 *
 *   THE CGPA. Not on the screen at all. The number that decides whether a
 *   student may apply was editable in a modal, present in the spreadsheet, and
 *   invisible in the list.
 *
 *   THE SIDEWAYS SCROLL. macOS does not draw a scrollbar until something
 *   moves, so a table wider than its card reads as a table that has been cut
 *   off. It also reads as one when the columns are crushed instead — which is
 *   what a table with no minimum width does.
 *
 * And the regression underneath it: patch 46 let table chips wrap so a long
 * package name would stop overprinting the row above, which turned "Private"
 * into "Privat / e" on this screen.
 */
const SHEET = require('/home/claude/glovels/build/server/sheet.js');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, p, note) => (p ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const page = await admin.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/catalogue.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3800);

  /* ------------------------------------------------------------- the filters */
  const WANT = ['fc', 'fl', 'ff', 'ft', 'fb', 'fg', 'fs'];
  const have = await page.$$eval('#t-prog select', s => s.map(x => x.id));
  check('the office asks the same questions the public finder does',
    WANT.every(id => have.includes(id)),
    WANT.filter(id => !have.includes(id)).join(', ') || 'destination, level, field, type, budget, CGPA, status');

  /* The field list is built from the catalogue, so it can never offer a field
     with nothing behind it. */
  const fields = await page.$$eval('#ff option', o => o.length);
  check('the field list is built from the catalogue', fields > 3, fields + ' options');

  const rows = () => page.$$eval('#progRows tr[data-row], #progRows tr', r =>
    r.filter(x => x.querySelector('[data-edit]')).length);
  const all = await rows();
  check('the table draws a page of programmes', all > 0 && all <= 25, all);

  const total = async () => Number(((await page.textContent('#progPager'))
    .match(/of (\d+) programmes/) || [])[1] || 0);
  const everything = await total();

  /* ---------------------------------------------------------- the CGPA column */
  const heads = await page.$$eval('#t-prog thead th', h => h.map(x => x.textContent.trim()));
  check('CGPA is a column on the screen, not only in the spreadsheet',
    heads.includes('CGPA'), heads.join(' | '));

  const firstDe = await page.$$eval('#progRows tr', trs => {
    const r = trs.find(x => /Germany rule|its own/.test(x.textContent || ''));
    return r ? r.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  check('and it says whether the bar is the programme’s own or its country’s',
    /rule|its own/.test(firstDe), firstDe.slice(0, 90));

  /* ------------------------------------------ the filter does what the site does */
  await page.selectOption('#ft', 'pub');
  await page.waitForTimeout(500);
  const publicOnly = await total();
  await page.selectOption('#fg', '6.5');
  await page.waitForTimeout(600);
  const lowCgpa = await total();
  check('a CGPA filter narrows the public list the way the site would',
    lowCgpa < publicOnly, lowCgpa + ' of ' + publicOnly + ' public at CGPA 6.5');

  await page.selectOption('#fg', '9.5');
  await page.waitForTimeout(600);
  check('and a high CGPA opens it back up',
    (await total()) === publicOnly, (await total()) + ' of ' + publicOnly);

  check('a filtered screen offers a way back', await page.isVisible('#fClear'));
  await page.click('#fClear');
  await page.waitForTimeout(600);
  check('and clearing returns the whole catalogue',
    (await total()) === everything, (await total()) + ' of ' + everything);

  /* -------------------------------------------------- the chips do not break up */
  const chip = await page.$$eval('#progRows .st', s => {
    const one = s.find(x => /Private|Public/.test(x.textContent));
    if (!one) return null;
    const st = getComputedStyle(one);
    return { text: one.textContent.trim(), wrap: st.whiteSpace,
             lines: Math.round(one.getBoundingClientRect().height / parseFloat(st.lineHeight || 16)) };
  });
  check('a status pill stays on one line — "Privat / e" was the fix that broke',
    chip && chip.wrap === 'nowrap' && chip.lines <= 1,
    chip && JSON.stringify(chip));

  /* ------------------------------------------------- and the sideways scroll */
  const narrow = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await narrow.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const np = await narrow.newPage();
  const nerrs = []; np.on('pageerror', e => nerrs.push(String(e)));
  await np.goto(BASE + '/catalogue.html', { waitUntil: 'domcontentloaded' });
  await np.waitForTimeout(4200);
  const sc = await np.evaluate(() => {
    const box = document.querySelector('#progRows').closest('.scrollx');
    if (!box) return null;
    const wrap = box.closest('.scrollwrap');
    const say = wrap && wrap.querySelector('.scrollsay');
    return { can: box.scrollWidth > box.clientWidth + 2,
             shaded: !!(wrap && wrap.classList.contains('more-right')),
             said: say && !say.hidden ? say.textContent.trim() : '',
             pageSideways: document.body.scrollWidth > document.documentElement.clientWidth + 2 };
  });
  check('on a narrow screen the table scrolls sideways rather than crushing',
    sc && sc.can, JSON.stringify(sc));
  check('the edge is shaded so it is clear there is more',
    sc && sc.shaded);
  check('and it says so in words, because macOS hides the scrollbar',
    sc && /scroll sideways/i.test(sc.said), sc && sc.said);
  check('the page itself does not scroll sideways — only the table',
    sc && !sc.pageSideways);
  check('no page errors', errs.length === 0 && nerrs.length === 0,
    errs.concat(nerrs).slice(0, 2).join(' | '));

  /* ============================ the template, used the way he will use it ==== */
  /* Three new Polish public universities, two with their own CGPA and one left
     blank to follow the country rule. This is the next real job — Poland asks
     6.5 where Germany asks 7.5 — so the sheet has to be able to do it. */
  const buf = Buffer.from(await (await admin.request.get(BASE + '/api/staff/catalogue.xlsx')).body());
  const sheet = SHEET.readXlsx(buf);
  const h = sheet[0].map(x => String(x).trim());
  const col = n => h.indexOf(n);
  const mk = (uni, prog, cgpa, fee) => {
    const r = new Array(h.length).fill('');
    r[col('programme')] = prog; r[col('university')] = uni; r[col('city')] = 'Warsaw';
    r[col('country code')] = 'PL'; r[col('level')] = 'master';
    r[col('field')] = 'Computer Science & IT'; r[col('public university')] = 'yes';
    /* Required since the fee model landed. These are public Polish places, so
       free to apply to through us — which is the whole point of Poland: a
       student below Germany's 7.5 bar has somewhere to go. */
    r[col('application')] = 'Free';
    r[col('total tuition inr')] = fee; r[col('minimum cgpa')] = cgpa;
    r[col('fit score')] = 80; r[col('intake 1 season')] = 'winter';
    r[col('intake 1 deadline')] = '2027-07-15'; r[col('on the site')] = 'yes';
    return r;
  };
  const body = sheet.slice(1).concat([
    mk('Warsaw University of Technology', 'MSc Computer Science', 6.5, 480000),
    mk('AGH University of Krakow', 'MSc Data Science', 6.0, 420000),
    mk('University of Warsaw', 'MSc Software Engineering', '', 510000),
  ]);
  const file = { name: 'c.xlsx', mimeType:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(SHEET.writeXlsx(sheet[0], body, 'Catalogue')) };

  const plan = await (await admin.request.post(BASE + '/api/staff/catalogue/import',
    { multipart: { file } })).json();
  check('a blank id in the sheet means a NEW university',
    plan.counts.create === 3 && plan.counts.rejected === 0,
    JSON.stringify(plan.counts));
  check('and nothing on the row is rejected or misread',
    (plan.plan.rejected || []).length === 0 && (plan.plan.unknownColumns || []).length === 0,
    JSON.stringify(plan.plan.rejected) + ' ' + JSON.stringify(plan.plan.unknownColumns));

  const done = await (await admin.request.post(BASE + '/api/staff/catalogue/import',
    { multipart: { file, confirm: 'yes' } })).json();
  check('confirming adds them', done.created === 3, JSON.stringify(done));

  const cat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json();
  const pl = cat.programmes.filter(p => p.country === 'PL' && p.isPublic);
  check('all three are in the catalogue', pl.length === 3, pl.length);
  check('the ones with their own bar kept it',
    Number((pl.find(p => /Technology/.test(p.university)) || {}).minCgpa) === 6.5,
    JSON.stringify(pl.map(p => p.university + '=' + p.minCgpa)));
  check('the one left blank follows its country instead of storing a zero',
    (pl.find(p => /University of Warsaw$/.test(p.university)) || {}).minCgpa == null);
  check('a blank budget band is worked out from the fee, not left empty',
    pl.every(p => p.band), pl.map(p => p.band).join(','));

  /* And a student who could not be served before can be now. */
  const anon = await browser.newContext();
  const live = await (await anon.request.get(BASE + '/api/catalogue')).json();
  const livePl = (live.programmes || []).filter(p => p.country === 'PL' && p.isPublic);
  check('they are on the public catalogue immediately, no rebuild',
    livePl.length === 3, livePl.length);
  check('carrying the bar the sheet gave them',
    livePl.some(p => Number(p.minCgpa) === 6.5), livePl.map(p => p.minCgpa).join(','));

  await browser.close();
  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
