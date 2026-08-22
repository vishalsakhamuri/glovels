/**
 * Two people, two browser contexts, one conversation.
 *
 * The only test that proves a live chat is live: send from one side and assert
 * it appears on the other WITHOUT reloading anything.
 */
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8080';

const wait = ms => new Promise(r => setTimeout(r, ms));

async function signIn(ctx, email, expect) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 150)));
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.fill('#lEmail', email);
  await p.fill('#lPass', 'glovels123');
  await p.click('#submit-btn');
  await p.waitForURL(new RegExp(expect), { timeout: 9000 });
  return p;
}

(async () => {
  const b = await chromium.launch();

  console.log('=== signing in, two separate browsers ===');
  const studentCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const staffCtx = await b.newContext({ viewport: { width: 1440, height: 950 } });

  const student = await signIn(studentCtx, 'student@glovels.com', 'dashboard');
  console.log('  student   ->', student.url());
  const kavya = await signIn(staffCtx, 'kavya@glovels.com', 'counsellor');
  console.log('  counsellor->', kavya.url());

  await kavya.waitForTimeout(1500);
  console.log('  counsellor sees', await kavya.locator('[data-open]').count(), 'student(s) in the caseload');
  console.log('  live indicator:', await kavya.locator('#liveDot').innerText());

  // open the conversation on the counsellor side
  await kavya.locator('[data-open]').first().click();
  await kavya.waitForTimeout(1200);
  console.log('  conversation open, bubbles:', await kavya.locator('#thread > div').count());

  // student opens Messages
  await student.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await student.waitForTimeout(1400);
  console.log('  student live indicator:', await student.locator('#liveDot').innerText());
  const before = await student.locator('#thread > div').count();
  console.log('  student sees', before, 'bubbles');

  console.log('\n=== student writes; does it reach the counsellor with no refresh? ===');
  const staffBefore = await kavya.locator('#thread > div').count();
  await student.fill('#box', 'Hi Kavya — do I need the APS before or after I apply?');
  await student.keyboard.press('Enter');
  await wait(2000);
  const staffAfter = await kavya.locator('#thread > div').count();
  console.log('  counsellor thread:', staffBefore, '->', staffAfter,
    staffAfter > staffBefore ? '✓ arrived live' : '✗ did not arrive');
  console.log('  last bubble on counsellor screen:',
    (await kavya.locator('#thread > div').last().innerText()).replace(/\s+/g, ' ').slice(0, 90));

  console.log('\n=== counsellor replies; does it reach the student with no refresh? ===');
  const stuBefore = await student.locator('#thread > div').count();
  await kavya.fill('#rbox', 'Before. Start the APS now — it takes 6–8 weeks and the application cannot be filed without it.');
  await kavya.keyboard.press('Enter');
  await wait(2000);
  const stuAfter = await student.locator('#thread > div').count();
  console.log('  student thread:', stuBefore, '->', stuAfter,
    stuAfter > stuBefore ? '✓ arrived live' : '✗ did not arrive');
  console.log('  last bubble on student screen:',
    (await student.locator('#thread > div').last().innerText()).replace(/\s+/g, ' ').slice(0, 110));

  console.log('\n=== typing indicator ===');
  await kavya.click('#rbox');
  await kavya.type('#rbox', 'One more thing', { delay: 40 });
  await wait(1200);
  console.log('  student sees:', JSON.stringify(await student.locator('#typing').innerText()));
  await kavya.fill('#rbox', '');

  console.log('\n=== the counsellor verifies a document; the student sees the change ===');
  await kavya.locator('.tab[data-t="file"]').click();
  await kavya.waitForTimeout(700);
  const v = kavya.locator('[data-verify]').first();
  console.log('  documents awaiting review:', await kavya.locator('[data-verify]').count());
  if (await v.count()) {
    await v.click();
    await wait(1500);
    await student.goto(BASE + '/documents', { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(900);
    console.log('  student readiness ring now:', await student.locator('#ringTxt').textContent());
  }

  console.log('\n=== it is all on the server, not in a tab ===');
  await student.reload({ waitUntil: 'domcontentloaded' });
  await student.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await student.waitForTimeout(900);
  console.log('  after a full reload the student still sees',
    await student.locator('#thread > div').count(), 'bubbles');

  console.log('\n=== admin assigns, and permission is enforced on the server ===');
  const adminCtx = await b.newContext();
  const admin = await signIn(adminCtx, 'admin@glovels.com', 'admin');
  await admin.waitForTimeout(1500);
  console.log('  admin sees', await admin.locator('[data-assign]').count(), 'student row(s)');
  console.log('  counsellors listed:', (await admin.locator('#counsellors').innerText()).replace(/\s+/g, ' ').slice(0, 80));

  const probe = await staffCtx.newPage();
  const r = await probe.evaluate(async base => {
    const res = await fetch(base + '/api/staff/student/9999', { credentials: 'same-origin' });
    return res.status;
  }, BASE).catch(() => 'n/a');
  console.log('  counsellor asking for a student that is not theirs ->', r);

  await b.close();
  process.exit(0);
})();
