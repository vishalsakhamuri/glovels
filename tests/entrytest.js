/**
 * Ninety-nine rupees, and what has to be true for it to work.
 *
 * "4999 for 3 unis and 999 for shortlist for 10 private unis and 99 for 3 unis
 *  in private — what do u think this will do."
 *
 * What it does is buy a paid lead for the price of a coffee. What it must never
 * do is cost anybody's time: ₹99 inclusive is ₹84 after GST and about ₹82 after
 * the gateway, so ten minutes of a counsellor's attention turns the sale into a
 * loss. Every check here exists to prove one of the three things that follows
 * from that:
 *
 *   THE MACHINE DELIVERS IT. Buy, answer the profile, and the universities are
 *   on the shortlist with nobody in the loop.
 *
 *   IT DELIVERS WHAT WAS SOLD. Three means three DIFFERENT universities, not
 *   three courses at one. Private means private. Public means public, and only
 *   as many as the package unlocks.
 *
 *   IT RESPECTS WHAT THEY TOLD US. A student who said "under ₹10 lakhs" and
 *   "Germany" does not get a ₹40 lakh programme in Canada. A near miss on a
 *   paid shortlist is not a near miss, it is a refund request.
 *
 * The last two checks are the ones that would embarrass somebody: the same
 * profile must produce the same shortlist twice, and a counsellor's own pick
 * must not be demoted by the machine running again.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

const PROFILE = {
  fullName: 'Entry Tier', city: 'Vijayawada',
  g_level: "Master's", g_field: 'Data Science', g_country: 'Germany',
  g_intake: 'Winter 2026', b_total: 'Under ₹10 Lakhs', d_cgpa: '7.8',
};

(async () => {
  const browser = await chromium.launch();

  /* ------------------------------------------------ where each tier now lives
     "Lets have it in services instead here. As this packages are only for
      public unis." — "99 and 999", "4999 we leave in this packages."

     Which is right, and the reason is the tab above the cards: that section is
     headed Public University Admission, and ₹99 and ₹999 deliver PRIVATE
     universities. A card reading "3 private universities" under a tab that says
     public is the section contradicting itself. */
  const shop = await browser.newContext();
  const content = await (await shop.request.get(BASE + '/api/content')).json();
  const items = content.packages.items || [];
  const svc = content.services.items || [];
  const byId = Object.fromEntries(items.map(p => [p.id, p]));
  const bySvc = Object.fromEntries(svc.map(x => [x.id, x]));

  check('the ₹99 tier is a service, not a package',
    bySvc['first-three'] && bySvc['first-three'].priceInr === 99
    && !byId['pkg-first-three'],
    JSON.stringify(bySvc['first-three'] || {}).slice(0, 70));
  check('and so is the ₹999 one',
    bySvc['shortlist-ten'] && bySvc['shortlist-ten'].priceInr === 999
    && !byId['pkg-shortlist-ten']);
  check('the ₹4,999 tier stays a package — it names public universities',
    byId['pkg-three-public'] && byId['pkg-three-public'].priceInr === 4999
    && byId['pkg-three-public'].unlocks === 3);

  /* Four prices in the study tab, and no fifth to push one onto a second row. */
  const study = items.filter(p => p.tab === 'study' && p.active !== false && p.sell)
    .map(p => p.priceInr).sort((a, b) => a - b);
  check('the public-university tab holds exactly the four packages',
    study.join(' ') === '4999 9999 49999 74999', study.join(' '));

  check('the range still runs from ₹99 to ₹74,999',
    bySvc['first-three'].priceInr === 99 && Math.max(...study) === 74999);

  /* The tiers must differ in KIND, or the cheap one eats the dearer one. */
  check('₹99 and ₹999 promise different amounts of work',
    bySvc['first-three'].matches === 3 && bySvc['shortlist-ten'].matches === 10,
    bySvc['first-three'].matches + ' vs ' + bySvc['shortlist-ten'].matches);
  check('only the ₹4,999 one reveals public university names',
    byId['pkg-three-public'].unlocks === 3
    && svc.every(x => !x.unlocks));
  /* This used to assert the opposite, and asserting it is how the bug survived:
     the ₹49,999 and ₹74,999 tiers unlocked ten and fifteen public university
     names and shortlisted none of them, so the most expensive thing on the site
     delivered less than the cheapest. Every tier that reveals names now hands
     them over, and a counsellor edits the list afterwards. */
  check('every package that reveals public names delivers that many',
    byId['pkg-boarding'].matches === byId['pkg-boarding'].unlocks
    && byId['pkg-offer'].matches === byId['pkg-offer'].unlocks
    && byId['pkg-roadmap'].matches === byId['pkg-roadmap'].unlocks,
    ['pkg-roadmap', 'pkg-offer', 'pkg-boarding']
      .map(k => k + ' ' + byId[k].matches + '/' + byId[k].unlocks).join(', '));
  check('and no other service is either',
    svc.filter(x => x.matches).map(x => x.id).sort().join(',') === 'first-three,shortlist-ten',
    svc.filter(x => x.matches).map(x => x.id).join(','));

  /* "Also 99 we show as a best thing." Leading the Most Booked row, and
     badged Best value rather than Bestseller — nobody has bought it yet. */
  check('the ₹99 one leads the most-booked row',
    bySvc['first-three'].posTop === 1 && bySvc['first-three'].cats.includes('top'),
    bySvc['first-three'].posTop + ' ' + bySvc['first-three'].cats.join('/'));
  check('and carries a badge it can honestly wear',
    bySvc['first-three'].badge === 'value', bySvc['first-three'].badge);

  /* --------------------------------------------------- somebody buys the ₹99 */
  const buyer = await browser.newContext();
  const order = await (await buyer.request.post(BASE + '/api/orders', {
    data: {
      services: [{ id: 'first-three' }], name: 'Entry Tier ' + stamp,
      email: 'entry' + stamp + '@example.com', phone: '+919000001111',
      acceptedTerms: true,
    },
  })).json();
  check('₹99 can be paid', !!order.reference, JSON.stringify(order).slice(0, 90));
  check('and it is charged as ₹99, from the server’s own price list',
    order.grossPaise === 9900, order.grossPaise);

  /* Buying signs them in on this browser — but on a password that was made for
     them, so nothing opens until they pick their own. A ₹99 buyer has not read
     the email yet, so the one thing they must NOT be asked for is the password
     they were given. */
  const blocked = await buyer.request.get(BASE + '/api/state');
  check('a brand-new account is held at the password screen', blocked.status() === 403,
    blocked.status());
  const chose = await buyer.request.post(BASE + '/api/auth/change',
    { data: { password: 'their-own-password-99' } });
  check('and can choose one without repeating a password nobody sent them yet',
    chose.status() === 200, chose.status() + ' ' + JSON.stringify(await chose.json()));

  const state1 = await (await buyer.request.get(BASE + '/api/state')).json();
  check('the buyer has an account without signing up separately',
    !!(state1.user && state1.user.email === 'entry' + stamp + '@example.com'),
    state1.user && state1.user.email);

  check('the site knows what it owes them',
    state1.matched && state1.matched.owed === 3, JSON.stringify(state1.matched));
  check('and that it is waiting on their profile, not on a person',
    state1.matched && state1.matched.needsProfile === true);
  check('nothing has been shortlisted yet', (state1.shortlist || []).length === 0);

  /* ------------------------------------------------- they answer the questions */
  const saved = await buyer.request.put(BASE + '/api/profile', { data: { profile: PROFILE } });
  const saveOut = await saved.json();
  check('saving the profile delivers the shortlist in the same breath',
    saved.status() === 200 && saveOut.matched.added === 3,
    JSON.stringify(saveOut.matched));

  const state2 = await (await buyer.request.get(BASE + '/api/state')).json();
  const got = state2.shortlist || [];
  check('three universities are on the shortlist', got.length === 3, got.length);
  check('and they are marked as matched, not as a counsellor’s pick',
    got.every(p => p.addedBy === 'matched'), got.map(p => p.addedBy).join(','));

  /* Three universities means three universities. */
  check('they are three DIFFERENT universities',
    new Set(got.map(p => p.university)).size === 3,
    got.map(p => p.university).join(' | '));

  /* Private tier means private universities. */
  check('a ₹99 buyer gets private universities, not gated public names',
    got.every(p => !p.isPublic), got.map(p => p.isPublic).join(','));

  /* What they told us was not decoration. */
  check('every one is in the country they asked for',
    got.every(p => p.country === 'DE'), got.map(p => p.country).join(','));
  /* The budget is a promise unless there is nothing behind it. There is no
     private German master's under ₹10 lakhs in the catalogue at all — so the
     honest behaviour is not an empty shortlist and not a silent one: widen the
     search by one constraint, and SAY which. */
    const inBudget = got.every(p => Number(p.totalInr || 0) <= 1000000);
  const told = /above the budget you gave/i.test(saveOut.matched.note || '');
  check('the budget is either respected or the widening is admitted to',
    inBudget || told,
    (saveOut.matched.note || '(no note)').slice(0, 80));
  check('and the constraint that came off is named',
    inBudget || (saveOut.matched.relaxed || []).includes('budget'),
    JSON.stringify(saveOut.matched.relaxed));
  check('the country they asked for is not what got dropped',
    !(saveOut.matched.relaxed || []).includes('country'));

  /* The thing that makes it feel real: they are told. */
  const msgs = (state2.msgs || []).map(m => m.t || m.body || '').join(' ');
  check('and the student is told, in the thread they read',
    /matched/i.test(msgs) && /shortlist/i.test(msgs),
    msgs.slice(-90));
  check('and is not promised a phone call nobody is making at ₹99',
    !/confirm the shortlist with you on a call/i.test(msgs),
    msgs.slice(0, 80));

  /* Run it again — same answers, same universities. A paid shortlist that
     reshuffles on a refresh looks like it was never real. */
  const again = await (await buyer.request.post(BASE + '/api/matches/run', { data: {} })).json();
  check('running it again adds nothing new', again.added === 0, JSON.stringify(again).slice(0, 60));
  check('and returns the same three', (again.shortlist || []).length === 3);
  const same = (again.shortlist || []).map(p => p.id).sort().join(',')
    === got.map(p => p.id).sort().join(',');
  check('exactly the same three, in fact', same);

  /* --------------------------------------------------------- ₹999 gets ten */
  const ten = await browser.newContext();
  await ten.request.post(BASE + '/api/orders', {
    data: {
      services: [{ id: 'shortlist-ten' }], name: 'Ten Tier ' + stamp,
      email: 'ten' + stamp + '@example.com', phone: '+919000002222',
      acceptedTerms: true,
    },
  });
  await ten.request.post(BASE + '/api/auth/change', { data: { password: 'ten-own-password' } });
  await ten.request.put(BASE + '/api/profile', { data: { profile: PROFILE } });
  const tenState = await (await ten.request.get(BASE + '/api/state')).json();
  /*
   * It used to be "delivers up to ten", and it reached ten by quietly pulling
   * universities out of countries the student had not chosen — the matcher was
   * allowed to relax `country` and did. That is not a shortlist, it is a
   * different product: the destination is the one answer on the form that is
   * not a preference, it is where they are moving.
   *
   * So the promise is now bounded by what the destination actually holds, and
   * this checks the two things that matter: nothing outside the country they
   * chose, and no more than ten. Germany has five private rows in the whole
   * catalogue, so a German student gets three or four of them and a note
   * saying why — which is thin, and a catalogue problem rather than a matcher
   * one.
   */
  const tenList = tenState.shortlist || [];
  check('₹999 delivers no more than ten universities',
    tenList.length > 0 && tenList.length <= 10, tenList.length);
  check('and not one of them is outside the country they chose',
    tenList.every(p => String(p.country || '').toUpperCase() === 'DE'),
    [...new Set(tenList.map(p => p.country))].join(','));
  check('all of them different', new Set(tenList
    .map(p => p.university)).size === tenList.length);
  check('and still private', tenList.every(p => !p.isPublic));

  /* -------------------------------------------------- ₹4,999 names public ones */
  const pub = await browser.newContext();
  const pubOrder = await (await pub.request.post(BASE + '/api/orders', {
    data: {
      packageId: 'pkg-three-public', name: 'Public Tier ' + stamp,
      email: 'pub' + stamp + '@example.com', phone: '+919000003333',
      acceptedTerms: true,
    },
  })).json();
  check('₹4,999 unlocks three public universities on the order',
    pubOrder.publicUnis === 3, pubOrder.publicUnis);
  await pub.request.post(BASE + '/api/auth/change', { data: { password: 'pub-own-password' } });
  await pub.request.put(BASE + '/api/profile', { data: { profile: PROFILE } });
  const pubState = await (await pub.request.get(BASE + '/api/state')).json();
  const pubList = pubState.shortlist || [];
  check('and shortlists three public ones', pubList.length === 3 && pubList.every(p => p.isPublic),
    pubList.map(p => p.isPublic + ':' + p.university).join(' | '));
  check('named in full, not blurred', pubList.every(p => (p.university || '').length > 3),
    pubList.map(p => p.university).join(' | '));
  check('never more public names than the package unlocks', pubList.length <= 3);

  /* And the finder agrees with the shortlist about how many names they may see. */
  const progs = await (await pub.request.get(BASE + '/api/catalogue')).json();
  const named = new Set((progs.programmes || [])
    .filter(p => p.isPublic && p.university).map(p => p.university));
  check('the finder reveals the same three public names and no more',
    named.size <= 3, named.size + ': ' + [...named].join(' | '));
  /* The SAME three. Spending the allowance on whatever the browse list reaches
     first would give them three names on their shortlist and three different
     ones in the finder — six universities, and no way to tell which three they
     actually paid for. */
  check('and they are the ones they were matched with, not three others',
    pubList.every(p => named.has(p.university)),
    [...named].join(' | '));

  /* ------------------------------------------- a counsellor still outranks it */
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const roster = await (await staff.request.get(BASE + '/api/staff/students')).json();
  const them = (roster.students || []).find(s => s.email === 'entry' + stamp + '@example.com');
  check('the ₹99 buyer is on the roster like anybody else', !!them);

  if (them) {
    const one = got[0];
    const conf = await staff.request.post(BASE + '/api/staff/student/' + them.id + '/shortlist',
      { data: { id: one.id } });
    check('a counsellor can confirm one of the machine’s picks', conf.status() === 200,
      conf.status());
    const after = await (await buyer.request.get(BASE + '/api/state')).json();
    const row = (after.shortlist || []).find(p => p.id === one.id);
    check('and it is theirs now, not the machine’s',
      row && row.addedBy === 'office', row && row.addedBy);

    /* The machine running again must not take it back. */
    await buyer.request.post(BASE + '/api/matches/run', { data: {} });
    const later = await (await buyer.request.get(BASE + '/api/state')).json();
    const still = (later.shortlist || []).find(p => p.id === one.id);
    check('re-running the matcher does not demote a counsellor’s pick',
      still && still.addedBy === 'office', still && still.addedBy);
  }

  /* ------------------------------------- somebody who bought nothing gets nothing */
  /* An account that has bought NOTHING, made here rather than borrowed from
     the demo seed. The seeded student has a paid Roadmap on their file — this
     check used to pass on them only because Roadmap delivered nothing at all,
     which was the bug, not the rule. */
  const free = await browser.newContext();
  const nobody = 'nothingbought' + Date.now() + '@example.com';
  await staff.request.post(BASE + '/api/staff/people',
    { data: { name: 'Bought Nothing', email: nobody, role: 'student' } });
  const reset = await (await staff.request.post(BASE + '/api/staff/people/'
    + ((await (await staff.request.get(BASE + '/api/staff/students')).json()).students
        .find(x => x.email === nobody) || {}).id + '/password', { data: {} })).json();
  await free.request.post(BASE + '/api/auth/login',
    { data: { email: nobody, password: reset.password } });
  /* An office-set password has to be changed before the account does anything,
     which is right — and it means this test has to do it too. */
  await free.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
  const freeRun = await free.request.post(BASE + '/api/matches/run', { data: {} });
  const freeOut = await freeRun.json();
  check('a student with no entry package is owed nothing', freeOut.owed === 0,
    JSON.stringify(freeOut).slice(0, 90));

  /* --------------------------------------------------------------- on screen */
  const errs = [];
  const page = await buyer.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/universities', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const text = await page.textContent('#mineWrap');
  check('the student sees a section for what was matched for them',
    /Matched to your profile/i.test(text), (text || '').slice(0, 80));
  check('and no page errors on it', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* The state that would otherwise look like the money went nowhere. */
  const waiting = await browser.newContext();
  await waiting.request.post(BASE + '/api/orders', {
    data: {
      services: [{ id: 'first-three' }], name: 'Waiting ' + stamp,
      email: 'wait' + stamp + '@example.com', phone: '+919000004444',
      acceptedTerms: true,
    },
  });
  await waiting.request.post(BASE + '/api/auth/change', { data: { password: 'wait-own-password' } });
  const wpage = await waiting.newPage();
  wpage.on('pageerror', e => errs.push(String(e)));
  await wpage.goto(BASE + '/universities', { waitUntil: 'domcontentloaded' });
  await wpage.waitForTimeout(3000);
  const wtext = await wpage.textContent('#mineWrap');
  check('somebody who has paid but not answered is told what is waiting on them',
    /waiting on six questions/i.test(wtext), (wtext || '').slice(0, 110));

  /* And the card on the home page says the machine does it, not a counsellor. */
  const home = await browser.newContext();
  const hpage = await home.newPage();
  hpage.on('pageerror', e => errs.push(String(e)));
  await hpage.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await hpage.waitForTimeout(2600);
  const cards = await hpage.textContent('[data-pane="study"]');
  check('the packages tab no longer advertises private universities',
    !/private universit/i.test(cards), (cards.match(/.{0,40}private.{0,40}/i) || [''])[0]);
  check('₹4,999 leads the packages tab',
    cards.indexOf('Three Public Universities') < cards.indexOf('Roadmap'));

  /* "We need to show 4999, 9999, 49999, 74999 in one screen. On desktop."
     One row, four cards, every price visible without scrolling past them. */
  /* Scrolled to, then measured. A card that has never been on screen reports a
     height of zero, and `0 <= 760` is a check that passes without looking. */
  await hpage.goto(BASE + '/#packages', { waitUntil: 'domcontentloaded' });
  await hpage.waitForTimeout(2600);
  const row = await hpage.evaluate(() => {
    const cs = [...document.querySelectorAll('[data-pane="study"] .pcard')];
    if (!cs.length) return null;
    const box = cs.map(c => c.getBoundingClientRect());
    return {
      n: cs.length,
      rows: new Set(box.map(b => Math.round(b.top))).size,
      height: Math.round(box[0].height),
      prices: cs.map(c => (c.querySelector('.price') || {}).textContent || ''),
    };
  });
  check('all four packages are on one row', row && row.n === 4 && row.rows === 1,
    row && (row.n + ' cards, ' + row.rows + ' row(s)'));
  check('and the whole row fits a laptop screen',
    row && row.height > 300 && row.height <= 760,
    row && row.height + 'px tall');
  check('with all four prices on it',
    row && ['4,999', '9,999', '49,999', '74,999']
      .every(p => row.prices.some(t => t.includes(p))),
    row && row.prices.join(' | '));

  /* "Public university matches unlock with a package — from ₹9,999" — it is
     ₹4,999, and it must never be a hand-typed number again. So: change the
     cheapest unlocking package's price and watch the sentence follow. A
     hardcoded ₹4,999 passes the first half of this and fails the second. */
  const teaser = (await hpage.textContent('#pkgTeaser')) || '';
  check('the teaser names the cheapest package that unlocks a public name',
    /₹4,999/.test(teaser), teaser.trim().replace(/\s+/g, ' ').slice(0, 70));

  const boss = await browser.newContext();
  await boss.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const block = (await (await boss.request.get(BASE + '/api/content')).json()).packages;
  const edited = {
    tabs: block.tabs,
    items: block.items.map(p =>
      (p.id === 'pkg-three-public' ? Object.assign({}, p, { priceInr: 5999 }) : p)),
  };
  const put = await boss.request.put(BASE + '/api/staff/content/packages',
    { data: edited });
  check('an admin can reprice that package', put.status() === 200, put.status());

  const after = await browser.newContext();
  const apage = await after.newPage();
  await apage.goto(BASE + '/#packages', { waitUntil: 'domcontentloaded' });
  await apage.waitForTimeout(2800);
  const moved = (await apage.textContent('#pkgTeaser')) || '';
  check('and the sentence follows the price rather than being typed in',
    /₹5,999/.test(moved), moved.trim().replace(/\s+/g, ' ').slice(0, 70));
  await apage.close();

  /* Put it back, so nothing after this reads a repriced package. */
  await boss.request.put(BASE + '/api/staff/content/packages', { data: block });

  /* And the ₹99 is in the services grid, where it now belongs. */
  const grid = await hpage.textContent('#services, .svc-wrap, main').catch(() => '');
  check('the ₹99 service is on the home page',
    /First Three Universities/.test(grid), (grid || '').slice(0, 50));
  check('no page errors anywhere', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
