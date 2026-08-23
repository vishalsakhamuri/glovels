/**
 * The words on the pages.
 *
 * Twenty-three pages shipped with a heading, a fact box built from the
 * database, and a yellow box saying the text was still to be written. A
 * visitor deciding whether to spend ₹75,000 with us was reading four bullet
 * points and a call to action, and then a note addressed to somebody else
 * telling them the page was not finished.
 *
 * The text is generated now, from page_content.py, into a marked block that is
 * replaced rather than appended. So the things worth checking are: that the
 * block is there, that it has enough in it to be worth reading, that the FAQ
 * is real markup rather than a heading over nothing, and — the one that
 * actually caused the bug — that the note to ourselves is gone from every page
 * that no longer needs it.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const SLUGS = [
  'study-in-canada', 'study-in-germany', 'study-in-united-kingdom',
  'study-in-ireland', 'study-in-poland', 'study-in-spain', 'study-in-italy',
  'work-medical-pg-germany', 'work-nursing-germany', 'work-pharma-germany',
  'work-opportunity-card', 'language-german', 'language-french',
  'migrate-canada-pr', 'migrate-australia-pr', 'test-ielts-toefl-pte',
  'test-gre-gmat-sat', 'about-us', 'careers', 'contact-us', 'refer',
  'glossary', 'disclaimers',
];

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  const thin = [], noFaq = [], badLd = [], stillToWrite = [];

  for (const slug of SLUGS) {
    await page.goto(BASE + '/' + slug, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(320);

    /* 250, not 500. Contact and Careers are short by nature and padding them
       would be worse than leaving them. What this bar catches is a stub, which
       had about forty words in the prose column and a yellow box under them. */
    const words = (await page.textContent('.prose')).trim().split(/\s+/).length;
    if (words < 250) thin.push(slug + '(' + words + ')');

    if ((await page.$$('.pfaq details')).length < 3) noFaq.push(slug);

    /* The FAQ has to be valid JSON-LD or Google ignores it silently, which is
       the worst kind of broken: nothing looks wrong anywhere. */
    const ld = await page.$$eval('script[type="application/ld+json"]',
      n => n.map(x => x.textContent));
    const faqRecords = ld.filter(t => {
      try { return JSON.parse(t)['@type'] === 'FAQPage'; } catch (e) { return false; }
    });
    /* Exactly one. Not "at least one" — the generator appended a record on
       every run for four builds because its removal regex was written without
       the spaces json.dumps puts in, and nothing noticed. Counting is the only
       check that would have caught it: the page looked right, parsed right,
       and carried four identical records. */
    if (faqRecords.length !== 1) badLd.push(slug + '×' + faqRecords.length);

    /* THE point. A page with two thousand words of copy that still carries
       "To write" tells the reader the copy is a placeholder. */
    const note = await page.$$eval('.towrite',
      els => els.filter(e => e.offsetParent !== null).length);
    if (note) stillToWrite.push(slug);
  }

  check('every page has enough written on it to be worth reading',
    thin.length === 0, thin.join(' '));
  check('and questions under it, opening and closing',
    noFaq.length === 0, noFaq.join(' '));
  check('marked up as exactly one FAQPage record, in JSON that parses',
    badLd.length === 0, badLd.join(' '));
  check('and no page still says the copy is to be written',
    stillToWrite.length === 0, stillToWrite.join(' '));

  /* The accordion, actually worked rather than counted. */
  await page.goto(BASE + '/study-in-canada', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const first = page.locator('.pfaq details').first();
  check('an answer is hidden until it is asked for',
    !(await first.evaluate(e => e.open)));
  await first.locator('summary').click();
  await page.waitForTimeout(260);
  check('and opens when clicked', await first.evaluate(e => e.open));
  check('with an answer in it, not an empty box',
    (await first.textContent()).trim().length > 80);

  /* The fact box comes from the database and must keep winning. Copy that
     restates a fee is copy that goes stale the day the fee changes. */
  await page.goto(BASE + '/study-in-germany', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  check('the database-driven fact box is still above the copy',
    (await page.$$('.factbox')).length >= 1);
  check('and the copy sits after it, not instead of it',
    await page.evaluate(() => {
      const f = document.querySelector('.factbox');
      const h = [...document.querySelectorAll('.prose h2')].pop();
      return !!(f && h) && (f.compareDocumentPosition(h)
        & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }));

  check('no page errors anywhere', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
