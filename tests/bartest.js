/**
 * "Are we not considering CGPA in the logic?"
 *
 * Half of it. The free finder on the home page has always worked out what a
 * programme asks for as: its OWN bar if the catalogue states one, otherwise the
 * destination's rule for that kind of university. The matcher — the half that
 * runs after somebody has paid — read only the first of those:
 *
 *     if (w.cgpa && p.minCgpa != null && w.cgpa < Number(p.minCgpa)) return false;
 *
 * and `minCgpa` is blank on virtually every row, because almost no university
 * states its own number. The rule lives on the destination. So the condition
 * never fired, and a student with 5.0 who paid ₹9,999 was sold five German
 * public universities that every one of them asks 7.5 for — while the free
 * finder correctly refused to show that same student the same rows.
 *
 * The half of the site that takes money was the half ignoring the requirement.
 *
 * The consequence of fixing it is not comfortable and is checked here too: a
 * student below every public bar in the catalogue now gets NOTHING from a
 * public package. That is the right list. Silently nothing is not — so the
 * screen and the message have to say why, and they are checked as hard as the
 * filter is.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, p, note) => (p ? ok : bad).push(n + (note ? ' — ' + note : ''));

let seq = 0;
const buy = async (browser, cgpa, order, country) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const ip = '10.3.' + (seq++ % 250) + '.5';
  const email = 'bar' + Date.now() + (seq) + '@example.com';
  const r = await ctx.request.post(BASE + '/api/orders',
    { headers: { 'x-forwarded-for': ip },
      data: Object.assign({ name: 'Bar ' + cgpa, email, phone: '+919000003030',
        acceptedTerms: true }, order) });
  if (r.status() !== 200) return { error: r.status() + ' ' + (await r.text()).slice(0, 100) };
  await ctx.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
  await ctx.request.put(BASE + '/api/profile', { data: { profile: {
    fullName: 'Bar', d_cgpa: cgpa, g_level: "Master's", g_field: 'Data Science',
    g_country: country || 'Germany', b_total: 'Above ₹40 Lakhs' } } });
  const st = await (await ctx.request.get(BASE + '/api/state')).json();
  return { ctx, state: st, shortlist: st.shortlist || [], matched: st.matched || {} };
};

(async () => {
  const browser = await chromium.launch();

  /* What the destinations actually ask for, read off the site rather than
     assumed — these numbers are editable in the office. */
  const look = await browser.newContext();
  const cat = await (await look.request.get(BASE + '/api/catalogue')).json();
  const DE = (cat.countries || {}).DE || {};
  const pubBar = Number(DE.minCgpaPublic), priBar = Number(DE.minCgpaPrivate);
  check('Germany states a CGPA rule for public universities', pubBar > 0, pubBar);
  check('and a lower one for private', priBar > 0 && priBar < pubBar, priBar);

  /* ------------------------------------------- above the bar: nothing changes */
  const over = await buy(browser, String(pubBar + 1), { packageId: 'pkg-roadmap' });
  check('a student above the public bar gets the five they paid for',
    over.shortlist.length === 5, over.shortlist.length + ' rows');
  check('and every one of them is one they could actually apply to',
    over.shortlist.every(p => !p.minCgpa || Number(p.minCgpa) <= pubBar + 1));

  /* exactly ON the bar — the boundary, which is where an off-by-one lives */
  const on = await buy(browser, String(pubBar), { packageId: 'pkg-roadmap' });
  check('a student exactly on the bar is not turned away by it',
    on.shortlist.length === 5, on.shortlist.length + ' rows at CGPA ' + pubBar);

  /* ------------------------------------------ below it: the regression itself */
  const under = await buy(browser, String(pubBar - 1), { packageId: 'pkg-roadmap' });
  check('a student below the public bar is sold none of them',
    under.shortlist.length === 0,
    under.shortlist.map(p => p.university).join(', ') || 'none, correctly');

  /* And it is SAID, which is the half that makes the empty list acceptable. */
  check('the account says how many the bar is holding back',
    Number(under.matched.cgpaHeld) > 0, JSON.stringify(under.matched));
  const msgs = (under.state.msgs || []).map(m => m.t || m.body || '').join(' ');
  check('and a message explains it rather than leaving a blank screen',
    /higher CGPA/i.test(msgs) && /cannot put a university/i.test(msgs),
    msgs.slice(-170));
  check('the message does not pretend the package is spent',
    /still owes you/i.test(msgs));

  const page = await under.ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/universities.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const screen = await page.textContent('#mineWrap');
  check('and the screen says it too, in words',
    /not an oversight/i.test(screen) && /higher CGPA/i.test(screen),
    screen.replace(/\s+/g, ' ').slice(0, 130));
  check('with somewhere to take it',
    /Ask my counsellor/i.test(screen));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* -------------------------------- the private tiers use the private rule */
  const priv = await buy(browser, String(priBar + 0.5), { services: [{ id: 'first-three' }] });
  check('the same student still gets the private universities they qualify for',
    priv.shortlist.length === 3, priv.shortlist.length + ' rows');
  check('and they are private, judged against the private rule',
    priv.shortlist.every(p => !p.isPublic));

  /* -------------------------------- and the free finder agrees with all of it */
  /* The two halves disagreeing is what this whole patch is about, so the
     agreement itself is the thing to assert. */
  const fp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } }))
    .newPage();
  await fp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await fp.waitForTimeout(2600);
  await fp.selectOption('#fCountry', 'DE');
  /* Germany asks for a German grade; the calculator is how a CGPA becomes one. */
  await fp.click('#openGg');
  await fp.fill('#ggMax', '10');
  await fp.fill('#ggPass', '4');
  await fp.fill('#ggNow', String(pubBar - 1));
  await fp.waitForTimeout(400);
  await fp.click('#ggUse');
  await fp.waitForTimeout(500);
  const go = await fp.$('text=Find Programs'); if (go) await go.click();
  await fp.waitForTimeout(1400);
  const shownPublic = await fp.$$eval('#rowsIn .mrow',
    rows => rows.filter(r => /public/i.test(r.textContent || '')).length);
  check('the free finder hides public universities from the same student too',
    shownPublic === 0, shownPublic + ' public rows shown');

  await browser.close();
  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
