/**
 * Every admission, on a rail and on a page of its own.
 *
 * The section was three fixed cards in a three-column grid, which is what a
 * consultancy shows when it has three. The office can now put thirty in from
 * the Home page screen, six slide on the home page, and the rest live at
 * /success-stories.
 *
 * The one that matters for search: that page is rendered on the SERVER. The
 * home page can repaint itself because a visitor runs its scripts; a crawler
 * often does not, and would index three shipped placeholders where thirty
 * real admissions are. So this checks the stories are in the HTML as it comes
 * off the wire, before any JavaScript has run.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const UNIS = [
  ['TU Darmstadt', 'M.Sc. Information & Communication Engineering', 'Winter 2026'],
  ['RWTH Aachen', 'M.Sc. Data Science', 'Winter 2026'],
  ['FAU Erlangen', 'M.Sc. ICT', 'Summer 2026'],
  ['TU Munich', 'M.Sc. Robotics', 'Winter 2026'],
  ['University of Stuttgart', 'M.Sc. Renewable Energy', 'Summer 2027'],
  ['Kozminski University', 'MSc Finance', 'Winter 2026'],
  ['TU Berlin', 'M.Sc. Computer Science', 'Winter 2027'],
  ['Leibniz Hannover', 'M.Sc. Mechanical Engineering', 'Summer 2026'],
  ['KIT Karlsruhe', 'M.Sc. Electrical Engineering', 'Winter 2026'],
];
const INITIALS = ['R.K.', 'A.S.', 'S.M.', 'V.P.', 'N.R.', 'L.A.', 'D.T.', 'K.B.', 'P.G.'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const rows = UNIS.map((u, i) => ({
    name: INITIALS[i], route: 'India → Germany', where: 'Public university · Germany',
    intake: u[2], quote: 'Admitted to ' + u[0] + ' for the ' + u[1] + '.',
    verified: i < 7, dummy: false,
  }));

  const saved = await ctx.request.put(BASE + '/api/staff/content/testimonials',
    { data: { value: rows } });
  const back = (await saved.json()).saved;
  check('the office can save nine stories', saved.ok() && back.length === 9,
    saved.status() + ', ' + (back || []).length);
  check('and the intake survives the round trip',
    back[0] && back[0].intake === 'Winter 2026', back[0] && back[0].intake);

  /* Thirty is the cap. Not a soft one: a home page that grows without limit
     because somebody pasted a spreadsheet in is not a home page. */
  const many = await ctx.request.put(BASE + '/api/staff/content/testimonials', {
    data: { value: Array.from({ length: 44 }, (_, i) =>
      Object.assign({}, rows[0], { name: 'Z' + i })) },
  });
  check('and no more than thirty', (await many.json()).saved.length === 30,
    (await (await ctx.request.get(BASE + '/api/content')).json()).testimonials.length + ' held');
  await ctx.request.put(BASE + '/api/staff/content/testimonials', { data: { value: rows } });

  /* ------------------------------------------- the page, before any script */
  const raw = await (await ctx.request.get(BASE + '/success-stories')).text();
  check('/success-stories answers', raw.length > 2000, raw.length + ' bytes');
  check('and every admission is in the HTML as it arrives',
    UNIS.every(u => raw.includes(u[0])),
    UNIS.filter(u => !raw.includes(u[0])).map(u => u[0]).join(',') || 'all nine');
  check('with the intake beside each one', raw.includes('Winter 2026')
    && raw.includes('Summer 2027'));
  check('initials, never a full name',
    raw.includes('R.K.') && !/\b(Ram|Arya|Sakshi)\b/.test(raw));
  /* Only when this deployment is asking to be indexed at all. Every page
     ships noindex and it is lifted on the way out when ALLOW_INDEXING is on,
     so on a preview build the right answer here is noindex. */
  const indexing = /content="index,follow/.test(
    await (await ctx.request.get(BASE + '/')).text());
  check('it asks to be indexed exactly when the rest of the site does',
    /content="index,follow/.test(raw) === indexing,
    indexing ? 'site is indexable' : 'site is a preview build');
  check('and tells a crawler what the list is',
    raw.includes('"@type":"ItemList"') && raw.includes('"numberOfItems":9'));
  if (indexing) {
    check('the sitemap asks for it',
      (await (await ctx.request.get(BASE + '/sitemap.xml')).text())
        .includes('/success-stories'));
  }

  /* --------------------------------------------------------- and rendered */
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/success-stories');
  await page.waitForSelector('.sgrid .tcard');
  check('nine cards on the page', (await page.$$('.sgrid .tcard')).length === 9);
  /* The template this page borrows is the prose one — 70 characters to a line
     and a gold rule down every blockquote. Without the card rules the stories
     came out as a single column of run-together text. */
  const w = await page.$eval('.sgrid', e => Math.round(e.getBoundingClientRect().width));
  check('and they are not squeezed into a prose column', w > 900, w + 'px wide');
  const q = await page.$eval('.sgrid blockquote', e => getComputedStyle(e).fontStyle);
  check('the quote is not in the prose italic', q === 'normal', q);

  /* ------------------------------------------------------- the home rail */
  const home = await ctx.newPage();
  home.on('pageerror', e => errs.push(e.message));
  await home.goto(BASE + '/');
  await home.waitForSelector('.stories .tcard');
  await home.waitForTimeout(1200);

  check('six on the home page, not nine',
    (await home.$$('.tgrid .tcard')).length === 6,
    (await home.$$('.tgrid .tcard')).length + ' cards');
  check('and a link that says how many there are',
    /9 admissions/.test(await home.$eval('#storyMore', e => e.innerText)));
  check('one dot per position, not per card',
    (await home.$$('.sdots button')).length === 4,
    (await home.$$('.sdots button')).length + ' dots');

  /* A couple of pixels of slack. The track carries 2px of padding so the
     cards' shadows are not clipped, and a snapped track parks on the first
     card's snap point rather than on zero. */
  const left = () => home.$eval('.stories .tgrid', e => Math.round(e.scrollLeft));
  check('it starts at the beginning', await left() < 5, await left() + 'px');
  check('and the back arrow is out of the way there',
    await home.$eval('#storyPrev', e => e.disabled));

  await home.click('#storyNext');
  await home.waitForTimeout(900);
  const after = await left();
  check('the arrow slides it along', after > 100, after + 'px');
  check('and the back arrow comes alive',
    !(await home.$eval('#storyPrev', e => e.disabled)));
  check('the dot follows',
    (await home.$$eval('.sdots button', b =>
      b.findIndex(x => x.getAttribute('aria-current') === 'true'))) === 1);

  await home.click('#storyPrev');
  await home.waitForTimeout(900);
  check('and back again', await left() < 5, await left() + 'px');

  /* Three stories is not a carousel. The controls have to stand down. */
  await ctx.request.put(BASE + '/api/staff/content/testimonials',
    { data: { value: rows.slice(0, 3) } });
  await home.reload();
  await home.waitForSelector('.stories .tcard');
  await home.waitForTimeout(1200);
  check('with three there is nothing to slide to',
    (await home.$eval('#storyDots', e => e.hidden)) === true);
  check('and no link to a page of the same three',
    (await home.$eval('#storyMore', e => e.hidden)) === true);

  check('no page errors', errs.length === 0, errs[0] || '');

  await browser.close();
  ok.forEach(n => console.log('  ok   ' + n));
  bad.forEach(n => console.log('  BAD  ' + n));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
