/**
 * What a student is asked for, what they are told, and where the names live.
 *
 * Four things he said, all of them about the same mistake — the site treating
 * every customer as though they had bought the most expensive package:
 *
 *   "Blurred LOCKED always there, and what we don't show him is universities
 *    publicly. It is shown in the login after signing in."
 *
 *   "User should get the message: after you sign in with the details you can
 *    see your universities."
 *
 *   "These are not mandatory for everyone. They are only mandatory for students
 *    where applications are filed and the visa process is selected in the
 *    package. For other services these are not mandatory — whatever is required
 *    to complete the service, they need to fill it."
 *
 *   "Sign out should be on the top, not in the bottom."
 *
 * The requirement list used to be flat: twenty-seven items demanded of
 * everybody. Somebody who paid ₹99 for three university names signed in to
 * "your file is 0% complete" and a demand for their Class 10 marksheet and
 * their financial documents — for a purchase that had already been delivered
 * in full.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, p, note) => (p ? ok : bad).push(n + (note ? ' — ' + note : ''));

let seq = 0;
const buy = async (browser, order, profile) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  const email = 'stg' + Date.now() + (seq++) + '@example.com';
  const r = await ctx.request.post(BASE + '/api/orders', {
    headers: { 'x-forwarded-for': '10.8.' + (seq % 250) + '.4' },
    data: Object.assign({ name: 'Stage ' + seq, email, phone: '+919000006060',
      acceptedTerms: true }, order),
  });
  if (r.status() !== 200) return { error: r.status() };
  await ctx.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
  if (profile) await ctx.request.put(BASE + '/api/profile', { data: { profile } });
  const st = await (await ctx.request.get(BASE + '/api/state')).json();
  return { ctx, email, state: st, todo: st.todo || {}, matched: st.matched || {} };
};
const asked = t => (t.profileMissing || []).length + (t.documentsMissing || []).length;

const PROFILE = { fullName: 'Stage', phone: '+919000006060', d_cgpa: '8.2',
  g_level: "Master's", g_field: 'Data Science', g_country: 'Germany',
  g_intake: 'Winter 2027', b_total: 'Under ₹10 Lakhs' };

(async () => {
  const browser = await chromium.launch();

  /* ============================ 1. asked for what the purchase needs, and no more */
  const cheap = await buy(browser, { services: [{ id: 'first-three' }] });
  const write = await buy(browser, { services: [{ id: 'sop' }] });
  const shortlist = await buy(browser, { packageId: 'pkg-three-public' });
  const filing = await buy(browser, { packageId: 'pkg-offer' });
  const whole = await buy(browser, { packageId: 'pkg-boarding' });

  check('a ₹99 buyer is asked for a handful of things, not twenty-seven',
    asked(cheap.todo) <= 8, asked(cheap.todo) + ': ' + (cheap.todo.profileMissing || []).join(', '));
  check('and for no documents at all',
    (cheap.todo.documentsMissing || []).length === 0,
    (cheap.todo.documentsMissing || []).join(', '));

  check('an SOP customer is asked what the writer needs, not what a consulate does',
    asked(write.todo) <= 10 && (write.todo.documentsMissing || []).length === 0,
    asked(write.todo) + ' items, docs: ' + (write.todo.documentsMissing || []).join(', '));
  check('  · which does not include a Class 10 marksheet',
    !(write.todo.profileMissing || []).join(' ').match(/Class 10/i),
    (write.todo.profileMissing || []).join(', '));
  /* The one that reads as absurd from the customer's side: being asked to
     upload the very thing they are paying to have written. */
  check('  · nor an SOP, which is the thing they are buying',
    !(write.todo.documentsMissing || []).some(d => /Statement of Purpose/i.test(d)));

  check('a shortlisting package asks the six the matcher reads',
    asked(shortlist.todo) <= 8, asked(shortlist.todo));

  check('the package that FILES applications asks for the application file',
    asked(filing.todo) > asked(shortlist.todo)
    /* The academic record. It was called "Degree transcripts" and is now the
       two documents a university actually asks for — the semester marksheets
       and the consolidated grade card — so this looks for both rather than for
       a word one of them happens to contain. */
    && (filing.todo.documentsMissing || []).some(d => /Semester-wise marksheets/i.test(d))
    && (filing.todo.documentsMissing || []).some(d => /Consolidated grade card/i.test(d)),
    asked(filing.todo) + ' items: ' + (filing.todo.documentsMissing || []).join(', '));
  check('and the one that runs the visa asks for the visa papers too',
    (whole.todo.documentsMissing || []).some(d => /Passport/i.test(d))
    && (whole.todo.documentsMissing || []).some(d => /Financial/i.test(d)),
    (whole.todo.documentsMissing || []).join(', '));
  check('so the most expensive package is the only one asked for everything',
    asked(whole.todo) > asked(filing.todo) && asked(filing.todo) > asked(cheap.todo),
    [asked(cheap.todo), asked(shortlist.todo), asked(filing.todo), asked(whole.todo)].join(' < '));

  /* Finishing what was actually asked has to reach 100%. */
  const done = await buy(browser, { services: [{ id: 'first-three' }] }, PROFILE);
  check('answering what a ₹99 purchase needs finishes their file',
    Number(done.todo.complete) === 100, done.todo.complete + '%');

  /* And the sentence under the bar says why, rather than threatening everybody
     with an application that will never be filed. */
  const wp = await write.ctx.newPage();
  const werr = []; wp.on('pageerror', e => werr.push(String(e)));
  await wp.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await wp.waitForTimeout(3200);
  const banner = (await wp.textContent('.todo-card')) || '';
  check('the SOP customer is not told a visa depends on this',
    !/visa cannot be applied/i.test(banner), banner.replace(/\s+/g, ' ').slice(0, 100));

  /* ============================== 2. the names are never on the public page */
  const rich = await buy(browser, { packageId: 'pkg-boarding' }, PROFILE);
  check('the ₹74,999 buyer has their universities in their account',
    (rich.state.shortlist || []).length === 15, (rich.state.shortlist || []).length);

  const hp = await rich.ctx.newPage();
  const herr = []; hp.on('pageerror', e => herr.push(String(e)));
  await hp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await hp.waitForTimeout(2800);
  await hp.selectOption('#fCountry', 'DE');
  const go = await hp.$('text=Find Programs'); if (go) await go.click();
  await hp.waitForTimeout(1500);
  /* The gated tab, which is the one asking for a package — a public
     university's name is the thing a package buys. */
  const pub = await hp.$('.rtab[data-rt="priv"]');
  if (pub) { await pub.click(); await hp.waitForTimeout(900); }
  const shown = await hp.textContent('#rowsIn');
  const theirs = (rich.state.shortlist || []).map(p => p.university).filter(Boolean);
  check('and NONE of them is named on the home page, even signed in',
    !theirs.some(u => shown.includes(u)),
    theirs.filter(u => shown.includes(u)).slice(0, 2).join(', ') || 'none leaked');
  check('the public rows are still there, still locked',
    (await hp.$$eval('#rowsIn .masked', e => e.length)) > 0,
    await hp.$$eval('#rowsIn .masked', e => e.length));

  /* ================================= 3. and they are told where to look */
  const dp = await rich.ctx.newPage();
  await dp.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await dp.waitForTimeout(3200);
  const prompt = (await dp.textContent('#nextUp')) || '';
  check('the dashboard leads with the universities, not with a form',
    /15 universities are ready/i.test(prompt), prompt.replace(/\s+/g, ' ').slice(0, 90));
  check('and points at the screen they are on',
    (await dp.$$eval('#nextUp a', a => a.map(x => x.getAttribute('href'))))
      .some(h => /universities/.test(h || '')));

  /* Somebody who has paid but not answered the questions gets the other half. */
  const waiting = await buy(browser, { packageId: 'pkg-roadmap' });
  const wp2 = await waiting.ctx.newPage();
  await wp2.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await wp2.waitForTimeout(3200);
  check('somebody who has not answered yet is told what unlocks it',
    /questions and your 5 universities appear/i.test(await wp2.textContent('#nextUp')),
    (await wp2.textContent('#nextUp')).replace(/\s+/g, ' ').slice(0, 90));

  /* ============ 4. each university says what it takes, and offers the talk */
  const up = await rich.ctx.newPage();
  await up.goto(BASE + '/universities.html', { waitUntil: 'domcontentloaded' });
  await up.waitForTimeout(3200);
  const needs = await up.$$eval('#mineWrap .uneeds', e => e.length);
  check('every matched university says what it takes to apply',
    needs === (rich.state.shortlist || []).length,
    needs + ' of ' + (rich.state.shortlist || []).length);

  const first = await up.$('#mineWrap .uneeds');
  if (first) { await first.click(); await up.waitForTimeout(400); }
  const detail = (await up.textContent('#mineWrap .uneeds')) || '';
  check('  · when to start, not just the date',
    /deadline|Start today|Start this week|gathering documents/i.test(detail),
    detail.replace(/\s+/g, ' ').slice(0, 80));
  check('  · and the documents that destination asks for',
    /Passport/i.test(detail) && /DOCUMENTS/i.test(detail.toUpperCase()),
    (detail.match(/Passport[^·]*/) || [''])[0]);
  check('  · and the tests', /IELTS|TOEFL/i.test(detail));
  check('the card still shows the deadline itself',
    /Next deadline/i.test(await up.textContent('#mineWrap')));

  /* "He can check and, in case any changes are required, he can consult the
     counsellor. Counsellor can add or change the universities for him." */
  const ask = await up.$$eval('#mineWrap a',
    a => a.filter(x => /Ask about this one/i.test(x.textContent))
          .map(x => x.getAttribute('href')));
  check('each one offers the conversation rather than a delete button',
    ask.length === (rich.state.shortlist || []).length, ask.length);
  check('and no matched card offers to remove a university they paid for',
    !/Remove|Delete/i.test(await up.textContent('#mineWrap')));

  const mp = await rich.ctx.newPage();
  await mp.goto(BASE + '/' + ask[0], { waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(2600);
  const draft = await mp.inputValue('#box');
  check('the message is started for them, naming the university',
    /^About .+ — $/.test(draft), JSON.stringify(draft));
  /* Left UNSENT, with the cursor in it. A screen that sends something on
     somebody's behalf has put words in their mouth. */
  const sentAlready = await (await rich.ctx.request.get(BASE + '/api/state')).json();
  check('but left UNSENT — the screen does not speak for them',
    !(sentAlready.msgs || []).some(m => /^About /.test(m.t || m.body || '')),
    (sentAlready.msgs || []).length + ' messages on the thread, none of them ours');
  check('and the cursor is in it, ready to finish the sentence',
    await mp.evaluate(() => document.activeElement && document.activeElement.id === 'box'));
  /* And a reload does not re-fill a message they cleared on purpose. */
  await mp.reload({ waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(2400);
  check('a reload does not put it back',
    (await mp.inputValue('#box')) === '', JSON.stringify(await mp.inputValue('#box')));

  /* And the counsellor can act on it — which is the other half of what he
     described, and the only route by which the list changes. */
  const office = await browser.newContext();
  await office.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const them = (await (await office.request.get(BASE + '/api/staff/students')).json())
    .students.find(x => x.email === rich.email);
  const drop = (rich.state.shortlist || [])[0];
  const gone = await office.request.delete(BASE + '/api/staff/student/' + them.id
    + '/shortlist/' + encodeURIComponent(drop.id));
  check('a counsellor can take one off', gone.status() === 200, gone.status());
  const swapTo = (await (await office.request.get(BASE + '/api/staff/catalogue')).json())
    .programmes.find(p => p.isPublic && p.country === 'DE'
      && !(rich.state.shortlist || []).some(s => String(s.id) === String(p.id)));
  const added = await office.request.post(BASE + '/api/staff/student/' + them.id + '/shortlist',
    { data: { id: swapTo.id } });
  check('and put a different one on in its place', added.status() === 200, added.status());
  const after = await (await rich.ctx.request.get(BASE + '/api/state')).json();
  check('the student sees the swap on their own screen',
    (after.shortlist || []).some(p => String(p.id) === String(swapTo.id))
    && !(after.shortlist || []).some(p => String(p.id) === String(drop.id)),
    (after.shortlist || []).length + ' on the list');

  /* ==================================== 5. sign out, where people look for it */
  for (const screen of ['dashboard', 'profile', 'universities']) {
    const p = await rich.ctx.newPage();
    await p.goto(BASE + '/' + screen + '.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);
    const box = await p.$('#signOut');
    const nav = await p.$('.p-nav');
    const a = box && await box.boundingBox(), n = nav && await nav.boundingBox();
    check('sign out is above the menu on ' + screen, !!(a && n && a.y < n.y),
      a && n ? Math.round(a.y) + ' vs ' + Math.round(n.y) : 'not found');
    await p.close();
  }

  /* And it has to actually sign them out — the old one cleared a browser key
     and navigated, leaving the server session alive for the next person at
     that machine to find with the Back button. */
  const outCtx = (await buy(browser, { services: [{ id: 'first-three' }] })).ctx;
  const op = await outCtx.newPage();
  await op.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await op.waitForTimeout(3000);
  await op.click('#signOut');
  await op.waitForTimeout(1800);
  check('signing out lands on the sign-in screen', /login/.test(op.url()), op.url());
  check('and really ends the session on the server',
    (await outCtx.request.get(BASE + '/api/state')).status() === 401);

  check('no page errors', werr.length === 0 && herr.length === 0,
    werr.concat(herr).slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
