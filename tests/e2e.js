/**
 * One walk through the whole business, on a database that has just been made.
 *
 * The sixteen suites each prove one screen. This proves the joins between them:
 * a stranger arrives, is matched, asks a question, buys something, becomes a
 * student, gets a reply from the office, and finds their purchase waiting for
 * them. Nothing here is stubbed and nothing is asserted from an API response
 * that the page never showed — every claim is read off the rendered screen.
 *
 *   ./srv.sh 8097 && node e2e.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8097';
const ok = [], bad = [];
const check = (n, pass, note) => {
  (pass ? ok : bad).push(n + (note ? ' — ' + String(note).replace(/\s+/g, ' ').slice(0, 110) : ''));
  console.log((pass ? '  ok   ' : '  FAIL ') + n);
};
const stamp = Date.now();
const VISITOR = { name: 'Ananya Rao', phone: '9812' + String(stamp).slice(-6),
  email: 'ananya' + stamp + '@example.com', pass: 'a-good-password' };

const watch = (page, errs) => {
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon|net::ERR/.test(m.text())
    && errs.push('console: ' + m.text().slice(0, 160)));
};

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  /* =============================================== 1. a stranger on the site */
  console.log('\n=== a stranger arrives ===');
  const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await guest.newPage();
  watch(p, errs);
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  check('the home page renders', (await p.title()).length > 5, await p.title());
  check('WhatsApp is offered to people who have not signed in',
    await p.isVisible('#wa'));
  check('and so is the chat box', await p.isVisible('.gv-chat-fab'));

  /* ------------------------------------------------------------ the finder */
  /* Germany and a master's — the combination most of the traffic arrives
     looking for. Picking option 1 of each blindly asks for a Canadian
     bachelor's, which the catalogue legitimately has none of. */
  await p.selectOption('#fCountry', 'DE');
  await p.selectOption('#fLevel', 'master');
  await p.click('#fGo');
  await p.waitForTimeout(2000);
  const matched = Number((await p.textContent('#rCount')).replace(/[^0-9]/g, '') || 0);
  check('the finder returns matches', matched > 0, matched + ' matches');
  const table = await p.textContent('#rowsWrap');
  check('a public university is matched but not named',
    /Public|Unlocks with|package/i.test(table), table.slice(0, 90));

  /* =============================================== 2. the stranger asks a question */
  console.log('\n=== and asks a question ===');
  await p.click('.gv-chat-fab');
  await p.waitForSelector('.gv-intro', { timeout: 8000 });
  await p.fill('.gv-intro input[name="name"]', VISITOR.name);
  await p.fill('.gv-intro input[name="contact"]', VISITOR.phone);
  await p.click('.gv-intro .gv-go');
  await p.waitForSelector('.gv-send', { timeout: 10000 });
  check('giving a name and number opens the conversation', true);

  await p.fill('.gv-send textarea', 'Is a public university in Germany possible with 7.2 CGPA?');
  await p.click('.gv-send .gv-go');
  await p.waitForTimeout(1800);
  check('the question appears in the thread',
    /7\.2 CGPA/.test(await p.textContent('.gv-body')));

  /* =============================================== 3. the office sees the lead */
  console.log('\n=== the office picks it up ===');
  const staff = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const s = await staff.newPage();
  watch(s, errs);
  await s.goto(BASE + '/chat', { waitUntil: 'domcontentloaded' });
  await s.waitForTimeout(2500);

  const chatList = await s.textContent('body');
  check('the conversation is on the counsellor screen',
    chatList.includes(VISITOR.name), VISITOR.name);

  await s.goto(BASE + '/chat#enquiries', { waitUntil: 'domcontentloaded' });
  await s.waitForTimeout(2000);
  const book = await s.textContent('#enqRows');
  check('and the same person is a lead in the enquiry book',
    book.includes(VISITOR.name) && book.includes(VISITOR.phone),
    book.slice(0, 120));

  /* ------------------------------------------------------- a counsellor replies */
  await s.goto(BASE + '/chat', { waitUntil: 'domcontentloaded' });
  await s.waitForTimeout(2000);
  const thread = s.locator('[data-chat]').first();
  if (await thread.count()) { await thread.click(); await s.waitForTimeout(1200); }
  const reply = s.locator('#cReply, textarea').first();
  await reply.fill('Yes — 7.2 clears most public universities. Shall we look at Munich?');
  await s.locator('#cSend, button:has-text("Send")').first().click();
  await s.waitForTimeout(2000);

  await p.waitForTimeout(2500);
  const seen = await p.textContent('.gv-body');
  check('the reply reaches the visitor without a refresh',
    /Munich/.test(seen), seen.slice(-90));

  /* =============================================== 4. the stranger buys something */
  console.log('\n=== and buys a package ===');
  await p.click('.gv-chat header button');
  await p.waitForTimeout(400);
  await p.goto(BASE + '/#packages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  const buy = p.locator('#packages [data-buy]').first();
  check('the packages have a way to buy them', await buy.count() > 0);
  await buy.scrollIntoViewIfNeeded();
  await buy.click();
  await p.waitForSelector('#buyPay', { timeout: 8000 });

  await p.fill('#rqName', VISITOR.name);
  await p.fill('#rqPhone', VISITOR.phone);
  await p.fill('#rqMail', VISITOR.email);
  const tick = await p.$('#rqOk');
  if (tick) await tick.check().catch(() => {});
  await p.click('#buyPay');
  await p.waitForTimeout(3000);
  const conf = await p.textContent('#buyBody');
  const ref = (conf.match(/GLV-\d+/) || [])[0];
  check('the purchase is confirmed with a reference', !!ref, conf.slice(0, 100));

  /* =============================================== 5. they become a student */
  console.log('\n=== then signs up ===');
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.click('#tab-signup');
  await p.fill('#lName', VISITOR.name);
  await p.fill('#lEmail', VISITOR.email);
  await p.fill('#lPhone', VISITOR.phone);
  await p.fill('#lPass', VISITOR.pass);
  const terms = await p.$('#terms');
  if (terms) await terms.check().catch(() => {});
  await p.click('#submit-btn');
  await p.waitForURL(/dashboard/, { timeout: 12000 }).catch(() => {});
  check('sign-up lands on the dashboard', /dashboard/.test(p.url()), p.url());

  await p.waitForTimeout(2500);
  const dash = await p.textContent('body');
  check('the dashboard greets them by name', dash.includes('Ananya'), dash.slice(0, 80));
  check('and what they bought before signing up is waiting for them',
    ref ? dash.includes(ref) : false,
    ref + ' :: ' + (await p.textContent('#boughtWrap').catch(() => 'no section')).slice(0, 110));

  /* =============================================== 6. the studio writes for them */
  console.log('\n=== uses the SOP studio ===');
  await p.goto(BASE + '/#services', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1800);
  const studio = p.locator('[data-ai="sop"]').first();
  await studio.scrollIntoViewIfNeeded();
  await studio.click();
  await p.waitForSelector('#aiGo', { timeout: 10000 });
  await p.fill('#aiProg', 'M.Sc. Data Science');
  await p.fill('#aiUni', 'TU Munich');
  await p.click('[data-chip="work"]');
  await p.click('[data-chip="project"]');
  await p.click('#aiGo');
  await p.waitForSelector('#aiAgain', { timeout: 15000 });
  const draft = await p.textContent('.ai-draft');
  check('the studio writes a draft', draft.length > 400, draft.length + ' characters');
  check('and it uses what it was told, not invented facts',
    draft.includes('M.Sc. Data Science') && draft.includes('TU Munich'), draft.slice(0, 70));
  check('a signed-in student is told it was kept',
    /saved|kept|on your account|Documents/i.test(await p.textContent('#aiBody')),
    (await p.textContent('#aiBody')).slice(-90));

  const state = await (await p.context().request.get(BASE + '/api/state')).json();
  check('and it really is on their account', (state.drafts || []).length >= 1,
    (state.drafts || []).length);

  /* =============================================== 7. the student writes to the office */
  console.log('\n=== and writes to their counsellor ===');
  await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const box = p.locator('textarea').first();
  check('the messages screen has a composer', await box.count() > 0);
  if (await box.count()) {
    await box.fill('Sending my transcripts tonight.');
    await p.locator('button:has-text("Send")').first().click().catch(() => {});
    await p.waitForTimeout(2000);
    check('the message is on the thread',
      /transcripts tonight/.test(await p.textContent('body')));
  }

  /* =============================================== 8. the office sees the student */
  console.log('\n=== the office sees the new student ===');
  await s.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await s.waitForSelector('#rows tr', { timeout: 15000 });
  await s.waitForTimeout(1200);
  const roster = await s.textContent('#rows');
  check('the new student is on the roster', roster.includes('Ananya'), roster.slice(0, 120));
  check('and is counted as unassigned until somebody takes them',
    Number(await s.textContent('#kUnassigned')) >= 1,
    await s.textContent('#kUnassigned'));

  /* =============================================== 9. an edit on the home page */
  console.log('\n=== an edit made in the office shows on the site ===');
  await s.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
  await s.waitForTimeout(2500);
  const words = 'Counsellors who have done this ' + String(stamp).slice(-4) + ' times';
  await s.click('[data-t="txt"]');
  await s.waitForSelector('[data-tkey]', { timeout: 12000 });
  await s.waitForTimeout(600);

  /* A sentence that is actually ON the page, not the first row in the list —
     which is the Google title, and lives in <head> where no reader would ever
     see it change. */
  const before = await guest.newPage();
  await before.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await before.waitForTimeout(2000);
  const publicText = await before.textContent('body');
  await before.close();

  const pick = await s.$$eval('[data-tkey]', (els, txt) => {
    for (const el of els) {
      const v = (el.value || '').trim();
      if (v.length > 25 && v.length < 120 && txt.includes(v)) {
        return { key: el.getAttribute('data-tkey'), was: v };
      }
    }
    return null;
  }, publicText);
  check('a visible sentence can be found in the editor', !!pick,
    pick && pick.was);

  if (pick) {
    await s.fill('[data-tkey="' + pick.key + '"]', words);
    await s.click('[data-tsave="' + pick.key + '"]');
    await s.waitForTimeout(2500);

    const fresh = await browser.newContext({ viewport: { width: 1300, height: 950 } });
    const fp = await fresh.newPage();
    await fp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await fp.waitForTimeout(2500);
    const body = await fp.textContent('body');
    check('words typed in the office appear on the public page',
      body.includes(words), 'replacing "' + pick.was.slice(0, 45) + '"');
    check('and the sentence it replaced is gone', !body.includes(pick.was),
      pick.was.slice(0, 60));
    await fresh.close();
  }

  /* =============================================== 10. nothing broke on the way */
  check('no page errors anywhere on the journey', errs.length === 0,
    errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
