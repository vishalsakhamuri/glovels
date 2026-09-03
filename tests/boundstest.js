/**
 * Numbers that are not numbers, and numbers on the wrong scale.
 *
 * From the 1.5 testing round:
 *
 *   "CGPA 47.9, IELTS 99, Listening -4, Reading abc, Class 10 999%, Class 12
 *    -50 all stored. CGPA clears every gate → 174 of 174 programmes eligible"
 *
 *   "fPrice is type=text. Typed -9999 and abc-sudhin → both stored as 0,
 *    package left active:true"
 *
 * THE ONE THAT MATTERS is the first sentence's second half. A profile full of
 * impossible numbers does not look broken — it looks like a student who
 * qualifies for everything, their file reads 100% complete, and the first
 * person to find out otherwise is the student, months later, from a
 * university. So this suite does not check "the form validates"; it checks
 * that an impossible grade cannot reach the matcher, by counting what the
 * matcher returns.
 *
 * AND THE SECOND FAULT, found on the way to the first and not in any report:
 * the matcher read the grade RAW and compared it against a bar written out of
 * ten. A student marked out of 4 with a 3.6 — a first — was read as 3.6 out of
 * 10 and failed every gate on the site, silently. The maximum has been on the
 * profile since the German-grade patch and nothing was reading it. That one
 * costs a real student real universities, and it is asserted here in both
 * directions: the impossible grade must not pass, and the four-point first
 * must.
 *
 * REFUSED, NOT CLAMPED. Rewriting 99 to 9 stores an IELTS the student never
 * sat, and nobody ever finds out where it came from.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

const student = async (browser, n) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const email = 'bnd' + S + n + '@example.com';
  await ctx.request.post(BASE + '/api/auth/signup', {
    data: { name: 'Bounds ' + n, email, phone: '98765001' + (10 + n),
      password: 'a-real-password-' + S },
  });
  return { ctx, email };
};

(async () => {
  const browser = await chromium.launch();

  /* A student who has BOUGHT. An account with no order has an empty shortlist,
     and counting an empty list against an empty list is a check that cannot
     fail — which is how the first version of the scale assertion below passed
     against the very bug it was written for. */
  const buyer = async n => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const email = 'bnd' + S + n + '@example.com';
    await ctx.request.post(BASE + '/api/orders', {
      data: { services: [{ id: 'shortlist-ten' }], name: 'Bounds ' + n, email,
        phone: '+91900000' + (5010 + n), acceptedTerms: true },
    });
    await ctx.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
    return { ctx, email };
  };

  /* ============================================ 1. what cannot be stored */
  const a = await student(browser, 1);
  const REPORTED = {
    fullName: 'Bounds One', d_cgpa: '47.9',
    e_test: 'IELTS', e_score: '99', e_listen: '-4', e_read: 'abc',
    x_score: '999%', xii_score: '-50',
  };
  const bad = await a.ctx.request.put(BASE + '/api/profile', { data: { profile: REPORTED } });
  ok(bad.status() === 422, 'the profile from the report is refused — ' + bad.status());
  const said = await bad.json();
  const fields = (said.fields || []).map(f => f.field);
  /* All six, not the first one and a shrug. A student who fixes the CGPA and
     saves again should not discover the IELTS one save later, five times. */
  ['d_cgpa', 'e_score', 'e_listen', 'e_read', 'x_score', 'xii_score'].forEach(k =>
    ok(fields.includes(k), 'and ' + k + ' is named — ' + JSON.stringify(fields)));
  ok(/47\.9/.test(said.error), 'the reason quotes what they typed — ' + said.error);

  /* Nothing was written. A partial save is worse than a refusal: it stores
     half an impossible profile and reports failure. */
  const after = await (await a.ctx.request.get(BASE + '/api/state')).json();
  ok(!(after.profile || {}).d_cgpa,
    'and nothing was stored — ' + JSON.stringify((after.profile || {}).d_cgpa));

  /* Refused, not clamped. */
  const clamped = await a.ctx.request.put(BASE + '/api/profile',
    { data: { profile: { e_test: 'IELTS', e_score: '99' } } });
  ok(clamped.status() === 422, 'an IELTS of 99 is refused rather than rewritten to 9');

  /* The bounds are per test, or a single range lets the reported 99 through
     while refusing a PTE score that is perfectly ordinary. */
  const pte = await a.ctx.request.put(BASE + '/api/profile',
    { data: { profile: { fullName: 'B', e_test: 'PTE', e_score: '79' } } });
  ok(pte.ok(), 'a PTE of 79 is fine, because PTE runs to 90 — ' + pte.status());
  const pteBad = await a.ctx.request.put(BASE + '/api/profile',
    { data: { profile: { fullName: 'B', e_test: 'PTE', e_score: '99' } } });
  ok(pteBad.status() === 422, 'and 99 is not, because it does not — ' + pteBad.status());

  /* A pass mark at or above the maximum is not a range, and every grade
     conversion on the site divides by the gap between them. */
  const scale = await a.ctx.request.put(BASE + '/api/profile',
    { data: { profile: { fullName: 'B', d_max: '10', d_pass: '10' } } });
  ok(scale.status() === 422, 'a pass mark equal to the maximum is refused — '
    + scale.status());

  /* ================================== 2. the gate, counted rather than trusted */
  const good = await buyer(2);
  await good.ctx.request.put(BASE + '/api/profile', {
    data: { profile: { fullName: 'Bounds Two', d_cgpa: '6.0', d_max: '10',
      g_level: "Master's", g_field: 'Data Science', g_country: 'Germany',
      g_intake: 'Winter 2027', b_total: 'Under ₹10 Lakhs' } },
  });
  const mid = await (await good.ctx.request.post(BASE + '/api/matches/run')).json();
  const midN = (mid.shortlist || []).length;
  ok(midN > 0, 'a 6.0 out of 10 student is delivered universities — ' + midN);

  /* THE check. If an impossible grade could still be stored, this student
     would see the whole catalogue. It cannot be stored, so they cannot. */
  const cat = await (await browser.newContext()).request.get(BASE + '/api/catalogue');
  const total = ((await cat.json()).programmes || []).length;
  ok(total > 50, 'there is a catalogue to be wrong about — ' + total);

  const cheat = await student(browser, 3);
  const tried = await cheat.ctx.request.put(BASE + '/api/profile', {
    data: { profile: { fullName: 'Bounds Three', d_cgpa: '47.9',
      g_level: "Master's", g_field: 'Data Science', g_country: 'Germany' } },
  });
  ok(tried.status() === 422,
    'a grade that would clear every bar on the site never gets stored — '
    + tried.status());

  /* ============ 3. and the four-point student who was failing everything */
  const four = await buyer(4);
  const r4 = await four.ctx.request.put(BASE + '/api/profile', {
    data: { profile: { fullName: 'Bounds Four', d_cgpa: '3.6', d_max: '4',
      g_level: "Master's", g_field: 'Data Science', g_country: 'Germany',
      g_intake: 'Winter 2027', b_total: 'Under ₹10 Lakhs' } },
  });
  ok(r4.ok(), 'a first out of 4 is a legitimate profile — ' + r4.status());

  /* 3.6 out of 4 is 9.0 out of 10, and read raw it is 3.6 — below every bar in
     the catalogue. So this student saw nothing at all, silently, while their
     profile said it was complete. Counted against the six-out-of-ten student
     above: a better grade must not see fewer programmes. */
  const m4 = await (await four.ctx.request.post(BASE + '/api/matches/run')).json();
  const n4 = (m4.shortlist || []).length;
  ok(n4 >= midN,
    'and is read on their own scale, not as 3.6 out of 10 — ' + n4 + ' vs ' + midN);

  /* And on the screen, read off the screen rather than out of the page's
     scope. A 7.5 bar is above 3.6 and below 9.0, so the student who is marked
     out of 4 must NOT be told it is above theirs — which is exactly what they
     were told before, on every gated row on the site. */
  /* And the three screens that compare a grade against a bar.
   *
   * Each of them had its own copy of "parse d_cgpa and use it", and each was
   * wrong in the same two ways. They read the shared helper now, and this
   * checks the page the browser is actually served rather than the source it
   * was built from — a helper that stops being included is a screen silently
   * back to reading the grade raw.
   *
   * `myCgpa`, `caseCgpa` and the scholarships filter live inside the page's
   * own scope, so this reads the delivered script rather than calling them. */
  const anon = await browser.newContext();
  for (const [page_, who] of [['universities.html', 'the student’s Browse tab'],
                              ['counsellor.html', 'the counsellor’s screen'],
                              ['scholarships.html', 'the scholarships screen']]) {
    const src = await (await anon.request.get(BASE + '/' + page_)).text();
    ok(src.includes('function cgpaTenOf'),
      who + ' carries the one reading of a grade');
    /* The exact expression all three used, and the one that made a first out
       of 4 read as a fail. If it comes back, so does the bug. */
    ok(!/d_cgpa \|\| ''\)\.trim\(\);\s*\n\s*const n = Number\(raw/.test(src),
      'and not its own copy of it — ' + who);
  }

  /* ============================================= 4. the price of a package */
  const admin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const content = await (await admin.request.get(BASE + '/api/staff/content')).json();
  const pk = JSON.parse(JSON.stringify(content.packages));
  const sold = (pk.items || []).find(x => x.sell);
  ok(!!sold, 'there is a package somebody pays for — ' + (sold && sold.id));
  const was = sold.priceInr;

  const price = async v => {
    sold.priceInr = v;
    const r = await admin.request.put(BASE + '/api/staff/content/packages',
      { data: { value: pk } });
    return { status: r.status(), said: (await r.json()).error || '' };
  };

  const neg = await price('-9999');
  ok(neg.status === 422, 'a negative price is refused — ' + neg.status);
  ok(/negative/i.test(neg.said), 'and says why — ' + neg.said);
  const abc = await price('abc-sudhin');
  ok(abc.status === 422, 'a price that is not a number is refused — ' + abc.status);
  ok(/not a number/i.test(abc.said), 'and says why — ' + abc.said);
  /* The one the report is really about: BOTH of those used to store 0 and
     leave the package on the site, on sale, at nothing. */
  const zero = await price(0);
  ok(zero.status === 422,
    'and a package on sale at zero is refused, which is what both of those '
    + 'silently became — ' + zero.status);

  const back = await price(was);
  ok(back.status === 200, 'a real price still saves — ' + back.status + ' ' + back.said);

  /* Zero is a real answer for a service: twelve of them are priced on request.
     A rule that refused zero everywhere would make those unsavable. */
  const svc = await admin.request.put(BASE + '/api/staff/content/services',
    { data: { value: content.services } });
  ok(svc.ok(), 'and a service priced on request is untouched by that — ' + svc.status());

  /* On the screen, so nobody gets as far as the server's refusal. */
  const home = await admin.newPage();
  await home.goto(BASE + '/home.html', { waitUntil: 'domcontentloaded' });
  await home.waitForTimeout(2600);
  const rows = await home.$$('[data-edit]');
  if (rows.length) {
    await rows[0].click();
    await home.waitForTimeout(900);
  }
  const type = await home.getAttribute('#fPrice', 'type').catch(() => null);
  ok(type === 'number', 'the price box is a number box — ' + type);
  const min = await home.getAttribute('#fPrice', 'min').catch(() => null);
  ok(min === '0', 'with a floor — ' + min);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
