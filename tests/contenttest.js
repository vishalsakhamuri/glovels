/**
 * Can the office change the home page?
 *
 * Not "does the endpoint return 200" — does the sentence on the page actually
 * read differently afterwards. So: pick a spread of real lines (a heading, a
 * paragraph, a button, a nav link, a placeholder, the page title, the meta
 * description), change them through the staff API, load the home page in a
 * browser, and read them back off the rendered page.
 *
 * The same for the packages: change a price, and check the card, the checkout
 * sheet and the order the server actually creates all say the new number.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const staff = await (await ctx.request.get(BASE + '/api/staff/content')).json();
  const lines = staff.text.lines;
  check('the editor lists every line', lines.length > 300, lines.length + ' lines');
  check('sections are named', lines.some(l => l.sectionLabel), '');

  /* A spread, not the first ten: the interesting failures are at the edges —
     the <title> in the head, an attribute, a line inside the footer. */
  const pick = kind => lines.find(l => l.kind === kind);
  const picks = [
    pick('title'), pick('meta-description'), pick('attr:placeholder'),
    lines.find(l => l.element === 'h1'),
    lines.find(l => l.element === 'h2' && l.section === 'counsel'),
    lines.find(l => l.section === 'footer' && l.element === 'a'),
    lines.find(l => l.element === 'button' && l.section === 'header'),
    lines.find(l => l.element === 'p' && l.original.length > 60),
  ].filter(Boolean);
  check('found lines of every kind to test', picks.length >= 7, picks.length);

  const map = {};
  picks.forEach((l, i) => { map[l.key] = 'GLOVELS-TEST-' + i + ' ' + l.original.slice(0, 30); });
  const put = await ctx.request.put(BASE + '/api/staff/content/text', { data: { map } });
  check('the edits save', put.ok(), put.status());

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis/.test(m.text()) && errs.push(m.text()));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const body = await page.evaluate(() => document.body.innerText);
  const title = await page.title();
  const meta = await page.getAttribute('meta[name="description"]', 'content');
  const html = await page.content();

  for (const [i, l] of picks.entries()) {
    const want = 'GLOVELS-TEST-' + i;
    const where = l.kind === 'title' ? title
      : l.kind === 'meta-description' ? meta
      : l.kind.startsWith('attr:') ? html
      : body;
    check(`"${l.original.slice(0, 34)}" (${l.kind}, ${l.section}) is changed on the page`,
      where.includes(want), l.key);
  }

  /* ------------------------------------------------------------- packages */
  const before = staff.packages.items.find(p => p.id === 'pkg-boarding');
  const items = staff.packages.items.map(p => p.id === 'pkg-boarding'
    ? Object.assign({}, p, { priceInr: 81234, title: 'Boarding Pass Plus', unlocks: 21 })
    : p);
  const pp = await ctx.request.put(BASE + '/api/staff/content/packages',
    { data: { value: Object.assign({}, staff.packages, { items }) } });
  check('the package saves', pp.ok(), pp.status());

  const page2 = await ctx.newPage();
  await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(1200);
  await page2.evaluate(() => { location.hash = '#packages'; });
  await page2.waitForTimeout(500);
  const pkgText = await page2.textContent('#packages');
  check('the new name is on the card', pkgText.includes('Boarding Pass Plus'), '');
  check('the new price is on the card', pkgText.includes('81,234'),
    (pkgText.match(/₹[\d,]+/g) || []).join(' '));
  check('the new unlock count is on the card', pkgText.includes('21'), '');
  check('the other packages survived', pkgText.includes('Roadmap') && pkgText.includes('Offer Letter'));

  /* The checkout sheet, which prices from D.packages and not from the card. */
  await page2.click('[data-buy="pkg-boarding"]');
  await page2.waitForTimeout(400);
  const sheet = await page2.textContent('#buyModal');
  check('the checkout sheet shows the new price', sheet.includes('81,234'),
    (sheet.match(/₹[\d,]+/g) || []).slice(0, 4).join(' '));

  /* And the number the server would actually charge. */
  const order = await (await ctx.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-boarding', name: 'Price Test', email: 'price@test.com',
      phone: '9876543210', amount: 1, acceptedTerms: true },
  })).json();
  const paise = order.grossPaise != null ? order.grossPaise
    : (order.order && (order.order.gross_paise != null ? order.order.gross_paise : order.order.grossPaise));
  const unis = order.publicUnis != null ? order.publicUnis
    : (order.order && (order.order.public_unis != null ? order.order.public_unis : order.order.publicUnis));
  check('the server charges the new price', paise === 8123400,
    paise + ' · ' + JSON.stringify(order).slice(0, 90));
  check('the order unlocks the new count', unis === 21, unis);

  /* ------------------------------------------- numbers, FAQ, testimonials */
  await ctx.request.put(BASE + '/api/staff/content/stats',
    { data: { value: [{ num: '9,001+', label: 'students placed abroad' },
      { num: '42', label: 'destination countries' }] } });
  await ctx.request.put(BASE + '/api/staff/content/faq',
    { data: { value: [{ q: 'Is this editable?', a: 'Yes, from the operations site.' }] } });
  await ctx.request.put(BASE + '/api/staff/content/testimonials',
    { data: { value: [{ name: 'Meera', route: 'India → Ireland', quote: 'Admitted to UCD.',
      where: 'Public university · Ireland', verified: true }] } });

  const page3 = await ctx.newPage();
  await page3.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page3.waitForTimeout(1200);
  const b3 = await page3.evaluate(() => document.body.innerText);
  check('the new number is on the page', b3.includes('9,001+'));
  /* Only from the numbers strip. The same figure is also written into the hero
     line above it, which is ordinary page text and is edited as page text —
     two places on purpose, so check the one this section owns. */
  check('the removed number is gone from the numbers strip',
    !(await page3.textContent('.stat-grid')).includes('3,200+'),
    await page3.textContent('.stat-grid'));
  check('the new FAQ is on the page', b3.includes('Is this editable?'));
  check('there is only one FAQ now',
    (await page3.$$('details.faq')).length === 1, (await page3.$$('details.faq')).length);
  check('the new testimonial is on the page', b3.includes('Admitted to UCD.'));
  check('the testimonial initial is right',
    (await page3.textContent('article.tcard .av')).trim() === 'M');

  /* -------------------------------------------------- empty is not allowed */
  const empty = await ctx.request.put(BASE + '/api/staff/content/faq', { data: { value: [] } });
  check('emptying a section is refused', empty.status() === 422,
    empty.status() + ' ' + JSON.stringify(await empty.json()).slice(0, 70));

  /* --------------------------------------------------------- putting it back */
  const back = {};
  picks.forEach(l => { back[l.key] = ''; });
  await ctx.request.put(BASE + '/api/staff/content/text', { data: { map: back } });
  const page4 = await ctx.newPage();
  await page4.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page4.waitForTimeout(1000);
  check('an emptied override puts the original back',
    !(await page4.evaluate(() => document.body.innerText)).includes('GLOVELS-TEST-'),
    '');
  check('the title goes back too', (await page4.title()) === picks[0].original,
    await page4.title());

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
