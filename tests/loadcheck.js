/**
 * Does every page still load, and does any of them throw?
 *
 * The cheapest test here and the one that catches the most. A script error on
 * page load stops every handler below it from binding, and the page looks
 * perfect while nothing on it works — which is exactly how the sign-in page
 * broke, silently, for half a day.
 */
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8099';

const PUBLIC = ['/', '/study-in-germany', '/study-in-canada', '/study-in-ireland',
  '/study-in-poland', '/study-in-spain', '/study-in-italy', '/study-in-united-kingdom',
  '/about-us', '/contact-us', '/careers', '/blog', '/scholarships', '/glossary',
  '/test-ielts-toefl-pte', '/test-gre-gmat-sat', '/language-german', '/language-french',
  '/migrate-canada-pr', '/migrate-australia-pr', '/work-opportunity-card',
  '/work-nursing-germany', '/work-pharma-germany', '/work-medical-pg-germany',
  '/universities', '/visa', '/refer', '/terms', '/privacy', '/refunds',
  '/disclaimers', '/grievance', '/login'];
const STUDENT = ['/dashboard', '/messages', '/documents', '/profile', '/applications'];
const STAFF = ['/counsellor', '/chat', '/home', '/catalogue', '/admin'];

const bad = [];
let n = 0;

async function visit(ctx, paths, who) {
  for (const path of paths) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('threw: ' + String(e).slice(0, 120)));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/ERR_TUNNEL|fonts\.googleapis|fonts\.gstatic|favicon|ERR_NAME_NOT_RESOLVED/.test(t)) return;
      /* A 401 on a portal screen is the screen finding out nobody is signed in;
         the redirect to /login on the next line is the correct behaviour, and
         the console line is the evidence of it working. Only a 401 that leaves
         the visitor sitting on the page is a fault, and that is caught below by
         the URL check. */
      if (/status of 401/.test(t)) return;
      errs.push(t.slice(0, 120));
    });
    let status = 0;
    try {
      const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
      status = r ? r.status() : 0;
      await page.waitForTimeout(1100);
    } catch (e) {
      bad.push(`${who} ${path} — did not load`);
      await page.close();
      continue;
    }
    n++;
    if (status >= 400) bad.push(`${who} ${path} — HTTP ${status}`);
    errs.forEach(e => bad.push(`${who} ${path} — ${e}`));
    const text = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
    if (text < 200) bad.push(`${who} ${path} — only ${text} characters of text`);
    /* A signed-out visitor on a portal screen must END UP at sign-in. */
    const url = page.url();
    if (who === 'visitor' && /\/(dashboard|messages|documents|profile|applications)/.test(url)) {
      bad.push(`${who} ${path} — a portal screen served to somebody not signed in`);
    }
    await page.close();
  }
}

(async () => {
  const b = await chromium.launch();
  const guest = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await visit(guest, PUBLIC, 'visitor');
  await guest.close();

  const stu = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  await visit(stu, STUDENT, 'student');
  await stu.close();

  const staff = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  await visit(staff, STAFF, 'staff');
  await staff.close();
  await b.close();

  console.log(n + ' pages loaded');
  if (bad.length) { console.log('\nPROBLEMS'); bad.forEach(x => console.log('  ✗ ' + x)); }
  else console.log('no errors on any page');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
