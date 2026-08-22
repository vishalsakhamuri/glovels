/**
 * Every page, every control: does it do anything?
 *
 * A button that renders and does nothing is invisible to every other kind of
 * test. This one presses each control and watches for evidence that something
 * happened — the DOM changed, the URL changed, a request went out, or a dialog
 * opened. Anything that produces none of those is reported by name.
 *
 * It deliberately does not press anything destructive. The skip list is by
 * label, and it is conservative: a false skip costs a line in the report, a
 * false press costs the demo data.
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8099';

/* The pages where a dead control costs money or time. The full list of 40
   marketing pages is covered by loadcheck.js; pressing every button on all of
   them took longer than the whole rest of the suite and found nothing the home
   page did not. */
const PUBLIC = ['/', '/contact-us', '/scholarships', '/universities'];

const STUDENT = ['/dashboard', '/messages', '/documents', '/profile', '/applications'];

const STAFF = ['/counsellor', '/chat', '/home', '/catalogue', '/admin'];

/* Pressed only when the label is safe. Anything that removes, sends, pays,
   signs out or confirms is left alone. */
const DANGER = /remove|delete|sign out|log ?out|switch role|confirm|apply |send|pay|buy|checkout|mark done|close|reopen|save|upload|import|clear|reset|verify|assign/i;

const errors = [], dead = [], notes = [];

async function sweep(ctx, pages, who) {
  for (const path of pages) {
    const page = await ctx.newPage();
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(String(e).slice(0, 160)));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/ERR_TUNNEL|fonts\.googleapis|fonts\.gstatic|favicon|ERR_NAME_NOT_RESOLVED/.test(t)) return;
      /* A 401 on a portal screen is that screen discovering nobody is signed
         in, one line before it redirects to sign-in. loadcheck.js is the one
         that checks the redirect actually happens. */
      if (/status of 401/.test(t)) return;
      pageErrs.push(t.slice(0, 160));
    });

    let status = 0;
    try {
      const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20000 });
      status = r ? r.status() : 0;
      await page.waitForTimeout(1500);
    } catch (e) {
      errors.push(`${who} ${path} — did not load: ${e.message.slice(0, 90)}`);
      await page.close();
      continue;
    }
    if (status >= 400) errors.push(`${who} ${path} — HTTP ${status}`);
    pageErrs.forEach(e => errors.push(`${who} ${path} — ${e}`));

    /* Every control that looks pressable. */
    const controls = await page.$$eval(
      'button, a[href="#"], a[href=""], [role="button"], [data-ai], [data-chip]',
      els => els.map((el, i) => {
        el.setAttribute('data-sweep', String(i));
        const label = (el.getAttribute('aria-label') || el.textContent || '')
          .replace(/\s+/g, ' ').trim().slice(0, 44);
        const box = el.getBoundingClientRect();
        return {
          i, label,
          selected: el.getAttribute('aria-selected') === 'true'
            || el.classList.contains('on') || el.classList.contains('active'),
          visible: box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden',
        };
      }));

    let pressed = 0;
    for (const c of controls) {
      if (!c.visible || !c.label) continue;
      if (DANGER.test(c.label)) continue;
      /* Pressing the tab that is already open changes nothing, correctly. */
      if (c.selected) continue;
      if (pressed >= 45) { notes.push(`${who} ${path} — only the first 45 controls were pressed`); break; }
      pressed++;

      const el = page.locator('[data-sweep="' + c.i + '"]');
      if (!(await el.count())) continue;

      /* Evidence, gathered before and after: what the page looks like, where it
         is, and whether anything went to the server. A control that changes
         none of these did nothing. */
      /* Evidence has to include things that do not change innerHTML:
           - what is typed in the inputs (a "fill in the demo login" button
             writes .value, which never appears in the markup)
           - which tab is selected (aria-selected is an attribute, so it DOES
             show up, but a hover menu that opens on pointerenter and closes on
             the click nets out to no change at all — hence the snapshot below
             is taken after the mouse is already over the control). */
      await el.hover({ timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(150);
      const snapshot = () => page.evaluate(() => ({
        html: document.body.innerHTML.length,
        text: document.body.innerText.length,
        url: location.href,
        open: document.querySelectorAll('.modal.on, [open], dialog[open]').length,
        values: [...document.querySelectorAll('input, textarea, select')]
          .map(x => x.value).join('\u0001').length,
        checked: [...document.querySelectorAll('input')].filter(x => x.checked).length,
        selected: [...document.querySelectorAll('[aria-selected="true"], .active, .on')].length,
      }));
      const before = await snapshot();
      let requested = false;
      const listen = () => { requested = true; };
      page.on('request', listen);

      try {
        await el.click({ timeout: 2500, noWaitAfter: true });
      } catch (e) {
        page.off('request', listen);
        continue;                      /* covered by something else, or off-screen */
      }
      await page.waitForTimeout(450);
      page.off('request', listen);

      let after;
      try { after = await snapshot(); }
      catch (e) { break; }             /* navigated away; the next page picks up */

      const changed = Object.keys(before).some(k => after[k] !== before[k]) || requested;
      if (!changed) dead.push(`${who} ${path} — "${c.label}"`);

      /* Put the page back if a modal opened, so the next control is reachable. */
      if (after.open > before.open) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(200);
      }
      if (after.url !== before.url) {
        await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(900);
        break;
      }
    }
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch();

  const guest = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await sweep(guest, PUBLIC, 'visitor');
  await guest.close();

  const stu = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  await sweep(stu, STUDENT, 'student');
  await stu.close();

  const staff = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  await sweep(staff, STAFF, 'staff');
  await staff.close();

  await browser.close();

  console.log('\n=== errors on load ===');
  console.log(errors.length ? errors.map(e => '  ' + e).join('\n') : '  none');
  console.log('\n=== controls that did nothing ===');
  console.log(dead.length ? dead.map(e => '  ' + e).join('\n') : '  none');
  if (notes.length) {
    console.log('\n=== not fully covered ===');
    console.log(notes.map(e => '  ' + e).join('\n'));
  }
  console.log(`\n${errors.length} error(s), ${dead.length} dead control(s)`);
})().catch(e => { console.error(e); process.exit(2); });
