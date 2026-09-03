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
/* /leads and /blog-admin were not on this list, and /leads was pushing the
   whole document to 1,198px on a 390px phone the entire time. A page nobody
   checks is a page nobody checks. */
const STAFF = ['/admin', '/chat', '/counsellor', '/home', '/catalogue',
  '/leads', '/blog-admin'];

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
/**
 * A menu is never a deliberate scroller.
 *
 * The check below forgives `overflow-x: auto`, on the grounds that a wide data
 * table scrolling in its own box is a decision somebody made. That forgiveness
 * hid the worst mobile bug on the site for weeks: the portal sidebar collapsed
 * into a single nowrap row with `overflow-x:auto` and measured **1,554px** on a
 * 390px phone. A student saw the logo, their name and Sign out. Dashboard,
 * Documents, Applications, Messages and five more were off the right-hand edge
 * with nothing on the screen to say they existed. Every signed-in page, every
 * role.
 *
 * So navigation is held to a stricter rule than content: whatever the CSS says
 * it meant to do, a nav that does not fit is a nav with links nobody can find.
 */
const navFits = page =>
  page.evaluate(() => {
    const out = [];
    document.querySelectorAll('nav, .p-side, .p-nav, .rtabs, .tabs').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 2) {
        out.push((el.tagName + '.' + String(el.className || '').split(' ')[0])
          + ' ' + el.scrollWidth + '/' + el.clientWidth);
      }
    });
    return out.slice(0, 4);
  });

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
          const nav = await navFits(page);
          check(url + ' shows every link it has on ' + label,
            nav.length === 0, nav.join(', '));
        }
        await page.close();
      }
    }
    await stu.close();
    await staff.close();
  }

  /* ------------------------------------------ the home page, and its length
   *
   * Vishal: "mobile version is not aligned . its going side ways and getting
   * long." Sideways is measured above. This is long.
   *
   * The page was 17,012px on a 390px screen — twenty phone screens — and half
   * of that was two card grids that are three or four tidy columns on a laptop
   * and one very tall column on a phone. A result row was 470px on its own,
   * because every field had a line to itself, so a list of eighteen showed one
   * and a half.
   *
   * A budget rather than an exact number: the page is meant to grow when there
   * is something worth adding. Twice its current size is not growth.
   */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true });
  const hp = await phone.newPage();
  const perrs = [];
  hp.on('pageerror', e => perrs.push(String(e)));
  await hp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await hp.waitForSelector('#rowsIn .mrow', { timeout: 15000 });
  await hp.waitForTimeout(2200);

  const tall = await hp.evaluate(() => document.documentElement.scrollHeight);
  check('the home page is a readable length on a phone', tall < 15000,
    tall + 'px, ' + (tall / 844).toFixed(1) + ' screens');

  const rowH = await hp.$$eval('#rowsIn .mrow',
    rs => Math.max(...rs.slice(0, 6).map(r => Math.round(r.getBoundingClientRect().height))));
  check('a result row is a row, not a page', rowH < 200, rowH + 'px tall');
  const seen = await hp.$$eval('#rowsIn .mrow', rs => rs.filter(r => {
    const b = r.getBoundingClientRect(), box = r.parentElement.parentElement.getBoundingClientRect();
    return b.top >= box.top - 2 && b.bottom <= box.bottom + 2;
  }).length);
  check('and more than one of them is visible at a time', seen >= 3, seen + ' rows');

  /* The long grids open short, and everything in them is still reachable. */
  const btns = await hp.$$eval('.showmore', bs => bs.map(b => b.textContent.trim()));
  check('the long card grids offer the rest rather than printing it',
    btns.length === 2, JSON.stringify(btns));
  const svcShown = () => hp.$$eval('#svcGrid > .card',
    els => els.filter(e => getComputedStyle(e).display !== 'none').length);
  const svcAll = await hp.$$eval('#svcGrid > .card', els => els.length);
  check('services open at a handful', (await svcShown()) < svcAll,
    (await svcShown()) + ' of ' + svcAll);
  /* Guarded. Without the button this line threw, and a suite that dies on the
     exact bug it exists to find reports nothing at all — which is worse than
     failing, because the run ends and the checks after it never happen. */
  const more = await hp.$('.showmore');
  if (more) {
    await more.click();
    await hp.waitForTimeout(400);
    check('and pressing it shows every one of them',
      (await svcShown()) === svcAll, (await svcShown()) + ' of ' + svcAll);
  } else {
    check('and pressing it shows every one of them', false, 'there is no button');
  }

  /* The panel that sells the locked universities lives at the end of the
     catalogue grid. Counting it as a card meant the offer could be the thing
     that got collapsed away. */
  check('the offer at the end of the catalogue is never the thing hidden',
    await hp.$$eval('#cgrid .gatepanel',
      els => els.length === 0 || getComputedStyle(els[0]).display !== 'none'));

  /* The floating corner. As a labelled pill it was 340px wide on a 390px
     screen — a green bar lying across whatever was under it, which on the
     results list was somebody's Apply button. */
  const fab = await hp.evaluate(() => {
    const c = document.querySelector('.gv-corner');
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { w: Math.round(b.width), vw: document.documentElement.clientWidth };
  });
  check('the floating buttons stay in the corner',
    !fab || fab.w < fab.vw * 0.35, fab && fab.w + 'px of ' + fab.vw);

  check('no page errors on the phone', perrs.length === 0, perrs[0] || '');
  await phone.close();

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
