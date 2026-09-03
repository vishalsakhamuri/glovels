/**
 * An intake is a month. The year is arithmetic.
 *
 * From the 1.5 testing round:
 *
 *   "Deadlines that have passed, still shown as open to the public. The
 *    outlined dates read 31 Aug, 15 Jun and 15 Jan — today is 2 September
 *    2026, so all three have passed. Each row still carries a green FREE TO
 *    APPLY dot and a live Apply free button. Across the public catalogue this
 *    is 112 of 174 programmes, AND IT GROWS ON ITS OWN."
 *
 * The last four words are the whole thing. This is not a bug about a
 * programme; it is a site going out of date as a body, a little more every
 * week, with nothing anybody can do about it but retype 174 dates twice a
 * year. Patch 77 taught the finder to say "intake closed" rather than print a
 * date that had gone — correct, and by the day this was written it was saying
 * it on 16 of the first 18 rows.
 *
 * So the day and the month are read from the sheet and the year is computed.
 * "Winter closes 15 July" is what a university publishes; WHICH July is
 * arithmetic, and arithmetic is the one thing a computer should not be asking a
 * counsellor to redo every year.
 *
 * WHAT THIS SUITE IS REALLY FOR is the "grows on its own" part, and a check
 * against today's date could not catch that — it would pass on the morning it
 * was written and start rotting the same afternoon. So it asserts the rule
 * rather than the data: NO row on the public finder shows a date in the past,
 * whatever is in the catalogue, and a deadline seeded years ago still comes out
 * ahead of today.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Every "12 Mar 2027" in a blob of screen text, as Dates. */
function datesIn(text) {
  const out = [];
  const re = new RegExp('(\\d{1,2})\\s+(' + MONTHS.join('|') + ')\\s+(\\d{4})', 'g');
  let m;
  while ((m = re.exec(text))) {
    out.push({ said: m[0], at: new Date(Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1])) });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  /* ============================ 1. a deadline from years ago, on the screen */
  const admin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const cat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json();
  const row = (cat.programmes || []).find(p => !p.isPublic && p.country === 'DE');
  ok(!!row, 'there is a named German programme to date — ' + (row && row.university));

  /* Deliberately ancient, and deliberately a day and month that has already
     gone this year: 14 March 2019. Nothing about it is salvageable except the
     day and the month, which is exactly the claim being made. */
  const saved = await admin.request.put(BASE + '/api/staff/programme', {
    data: Object.assign({}, row, {
      intakes: [{ season: 'winter', deadline: '2019-03-14' }],
    }),
  });
  ok(saved.ok(), 'a 2019 deadline can be stored — ' + saved.status());

  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1050 } }))
    .newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.selectOption('#fCountry', 'DE').catch(() => {});
  const go = await page.$('text=Find Programs');
  if (go) await go.click();
  await page.waitForTimeout(1600);

  const shown = (await page.textContent('#rowsIn').catch(() => '')) || '';
  ok(shown.includes(row.university),
    'the row is still on the finder — ' + row.university);
  /* NOT hidden. Half this catalogue carries last cycle's dates, and hiding
     them all would take Germany from 158 rows to about 70 — a truthful finder
     that makes the business look like it has nothing. */
  const rows = await page.$$('#rowsIn .mrow');
  ok(rows.length > 3, 'and so is everything else — ' + rows.length + ' rows');

  const march = new Date(today.getFullYear(), 2, 14);
  const wanted = march < today ? today.getFullYear() + 1 : today.getFullYear();
  ok(shown.includes('14 Mar ' + wanted),
    'a 2019 deadline reads as the next 14 March — expected ' + wanted
    + ', got ' + JSON.stringify(datesIn(shown).map(d => d.said).slice(0, 4)));

  /* ================================== 2. THE rule, over the whole screen */
  await page.selectOption('#fCountry', '').catch(() => {});
  if (go) await go.click();
  await page.waitForTimeout(1500);

  const all = (await page.textContent('#rowsIn').catch(() => '')) || '';
  const found = datesIn(all);
  ok(found.length > 3, 'there are dates on the finder to check — ' + found.length);
  const gone = found.filter(d => d.at < today);
  ok(gone.length === 0,
    'and not one of them is in the past — ' + JSON.stringify(gone.map(d => d.said)));

  /* The label patch 77 introduced has nothing left to describe. It was on 16 of
     the first 18 rows the day this was written. */
  ok(!/intake closed/i.test(all),
    'nothing says "intake closed", because nothing is');

  /* And a row that offers Apply is a row somebody can apply to — which is what
     the report was really objecting to: a green dot and a live button beside a
     date from June. */
  ok(/Apply/i.test(all), 'rows still offer Apply — ' + /Apply/i.test(all));

  /* ========================== 3. the dropdown agrees with the rows under it */
  const opts = await page.$$eval('#fIntake option',
    o => o.map(x => ({ v: x.value, t: x.textContent.trim() })).filter(x => x.v));
  ok(opts.length > 0, 'the intake filter offers intakes — ' + opts.length);
  const stale = opts.filter(o => {
    const y = Number(String(o.v).split('-').pop());
    return Number.isFinite(y) && y < today.getFullYear();
  });
  ok(stale.length === 0,
    'and none of them is a year that has gone — ' + JSON.stringify(stale.map(o => o.t)));

  /* THE one that matters about the dropdown: choosing an intake has to return
     rows. It listed "Summer 2026 (67)" in September 2026 — a filter that
     matched 67 rows in the sheet and nothing the finder would show. */
  for (const o of opts.slice(0, 3)) {
    await page.selectOption('#fIntake', o.v);
    if (go) await go.click();
    await page.waitForTimeout(1100);
    const n = (await page.$$('#rowsIn .mrow')).length;
    ok(n > 0, 'choosing ' + o.t + ' returns rows — ' + n);
    const text = (await page.textContent('#rowsIn').catch(() => '')) || '';
    const bad = datesIn(text).filter(d => d.at < today);
    ok(bad.length === 0,
      'and none of them is dated in the past — ' + JSON.stringify(bad.map(d => d.said)));
  }
  await page.selectOption('#fIntake', '');

  ok(errs.length === 0, 'no page errors — ' + errs.slice(0, 2).join(' | '));

  /* ============= 4. and the student's own screens say the same thing */
  /* Two screens computing a deadline two ways is how a student is told one
     date on the dashboard and another on the finder. */
  const email = 'itk' + S + '@example.com';
  const buyer = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await buyer.request.post(BASE + '/api/orders', {
    data: { services: [{ id: 'shortlist-ten' }], name: 'Intake ' + S, email,
      phone: '+919000004321', acceptedTerms: true },
  });
  await buyer.request.post(BASE + '/api/auth/change', { data: { password: 'a-password-here' } });
  await buyer.request.put(BASE + '/api/profile', {
    data: { profile: { fullName: 'Intake', d_cgpa: '8.2', d_max: '10',
      g_level: "Master's", g_field: 'Data Science', g_country: 'Germany',
      g_intake: 'Winter 2027', b_total: 'Under ₹10 Lakhs' } },
  });

  const dash = await buyer.newPage();
  const derrs = [];
  dash.on('pageerror', e => derrs.push(String(e)));
  await dash.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await dash.waitForTimeout(3200);
  const dtext = (await dash.textContent('body').catch(() => '')) || '';
  const dpast = datesIn(dtext).filter(d => d.at < today);
  ok(dpast.length === 0,
    'the dashboard shows no date in the past either — '
    + JSON.stringify(dpast.map(d => d.said)));
  ok(derrs.length === 0, 'no errors on the dashboard — ' + derrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
