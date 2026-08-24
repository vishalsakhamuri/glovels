/**
 * The two screens login.html turns itself into.
 *
 * login.html is three screens in one file: sign in, set a password from an
 * emailed link (?token=), and replace the password we generated for you
 * (?change=1). The second two are built by script, which empties a container
 * and writes new markup into it.
 *
 * The container was found with `document.querySelector('.auth-card')`. The
 * class on the page is `form-card`. So the selector matched nothing, the
 * fallback took `document.body`, and both screens replaced the ENTIRE page —
 * the panel, the stylesheet's container, the width limit, all of it. On a
 * 2,560px monitor the password fields ran the full width of the screen, and
 * that was the first thing a new administrator ever saw. It was also what
 * every student saw after clicking a password-reset email.
 *
 * A selector that matches nothing throws no error and logs nothing. The only
 * way to catch it is to check the thing it was supposed to achieve: that the
 * form is INSIDE the card, and that a wide window does not stretch it.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

/* Deliberately wider than any laptop. The bug was invisible at 1400px, because
   the card's max-width and the viewport were close enough that a full-bleed
   form still looked plausible. */
const WIDE = { width: 2560, height: 1000 };

const SCREENS = [
  { q: '?change=1', name: 'replacing a password made for you', field: '#cNow',
    words: 'Choose your own password' },
  { q: '?token=a-link-from-an-email', name: 'setting one from an emailed link',
    field: '#rPass', words: 'Set a new password' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: WIDE })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  for (const s of SCREENS) {
    await page.goto(BASE + '/login.html' + s.q, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    check(s.name + ': the screen is drawn',
      (await page.textContent('body')).includes(s.words));

    /* THE check. Not "is the field visible" — it was visible the whole time,
       stretched across two and a half thousand pixels. */
    check(s.name + ': inside the card, not in place of the page',
      await page.evaluate(sel => {
        const f = document.querySelector(sel);
        return !!(f && f.closest('.form-card'));
      }, s.field));

    const w = await page.evaluate(sel => {
      const f = document.querySelector(sel);
      return f ? Math.round(f.getBoundingClientRect().width) : -1;
    }, s.field);
    check(s.name + ': and the fields are a readable width', w > 0 && w <= 520,
      w + 'px on a ' + WIDE.width + 'px window');

    /* The panel beside it is part of the page, not decoration — losing it was
       how the bug announced itself visually. */
    check(s.name + ': the sign-in page is still around it',
      await page.isVisible('.form-panel'));
  }

  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
