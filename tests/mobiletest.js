/**
 * Nothing scrolls sideways on a phone.
 *
 * Most students open this on a handset. Three portal screens were pushing the
 * page 16, 111 and 262 pixels wide, all for the same reason: a column width
 * written as an inline style, which beats the media query meant to collapse it.
 * Inline widths are invisible to a stylesheet, so this checks the rendered
 * result instead of the source.
 */
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const STUDENT = ['/', '/dashboard', '/profile', '/documents', '/messages',
  '/universities', '/applications', '/scholarships', '/visa', '/login'];
const STAFF = ['/admin', '/chat', '/counsellor', '/home', '/catalogue'];

/* A phone, a small phone, and a tablet — the three shapes that actually break. */
const SIZES = [[360, 780, 'a small phone'], [390, 844, 'a phone'], [820, 1180, 'a tablet']];

const overflow = page =>
  page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Anything INSIDE the page that scrolls sideways without being asked to.
 *
 * The check above measures the document, and the document was fine — 390 wide
 * on a 390 screen — while the results list inside it needed 533 and scrolled.
 * One nudge of a thumb and the university name was off the left edge, leaving a
 * price and a button belonging to nothing. That is what a student saw, and this
 * suite passed the whole time.
 *
 * A table or a code block with `overflow-x: auto` is a deliberate scroller and
 * is left alone. An element that overflows its own box while its overflow is
 * `visible` is a layout that does not fit.
 */
const innerOverflow = page =>
  page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach(el => {
      if (el.clientWidth < 120) return;                 /* too small to judge */
      if (el.scrollWidth <= el.clientWidth + 2) return;
      /* Only `visible`. `auto` and `scroll` are deliberate scrollers; `hidden`
         and `clip` are deliberate truncation — an ellipsised programme name is
         wider than its box by design and no thumb can move it. `visible` is the
         one that escapes and makes something outside scroll, which is the bug. */
      if (getComputedStyle(el).overflowX !== 'visible') return;
      out.push((el.tagName + '.' + String(el.className || '').split(' ')[0])
        + ' ' + el.scrollWidth + '/' + el.clientWidth);
    });
    return out.slice(0, 4);
  });

(async () => {
  const browser = await chromium.launch();

  for (const [width, height, label] of SIZES) {
    const mobile = width < 500;

    const stu = await browser.newContext({ viewport: { width, height },
      isMobile: mobile, hasTouch: mobile });
    await stu.request.post(BASE + '/api/auth/login',
      { data: { email: 'student@glovels.com', password: 'glovels123' } });

    const staff = await browser.newContext({ viewport: { width, height },
      isMobile: mobile, hasTouch: mobile });
    await staff.request.post(BASE + '/api/auth/login',
      { data: { email: 'admin@glovels.com', password: 'glovels123' } });

    for (const [ctx, list] of [[stu, STUDENT], [staff, STAFF]]) {
      for (const url of list) {
        const page = await ctx.newPage();
        const r = await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
          .catch(() => null);
        if (!r || r.status() >= 400) {
          check(url + ' loads on ' + label, false, r ? 'HTTP ' + r.status() : 'no response');
          await page.close();
          continue;
        }
        await page.waitForTimeout(1600);
        const over = await overflow(page);
        check(url + ' fits ' + label, over === 0, over + 'px of sideways scroll');
        if (mobile) {
          const inner = await innerOverflow(page);
          check(url + ' has nothing scrolling sideways inside it on ' + label,
            inner.length === 0, inner.join(', '));
        }
        await page.close();
      }
    }
    await stu.close();
    await staff.close();
  }

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
