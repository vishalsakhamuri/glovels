/**
 * The four legal pages, the particulars behind them, and the contact page.
 *
 * All four pages were stubs, and the Boarding Pass card has been selling an
 * admission guarantee while linking to refunds.html#guarantee-terms for the
 * full terms — an anchor that did not exist. A guarantee whose terms are a 404
 * is the one gap on this site that could cost real money.
 *
 * The checks below follow the money: a card promises something, the page it
 * links to says what that promise actually is, and the office can change both
 * without a deploy.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const PAGES = ['/terms', '/privacy', '/refunds', '/grievance'];
const stamp = String(Date.now()).slice(-6);
const CIN = 'U80903TG2019PTC' + stamp;

const text = async (ctx, url) => {
  const p = await ctx.newPage();
  await p.goto(BASE + url, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const t = await p.innerText('body');
  await p.close();
  return t;
};

(async () => {
  const browser = await chromium.launch();
  const guest = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  const errs = [];

  /* ------------------------------------------------ the pages are not stubs */
  for (const url of PAGES) {
    const t = await text(guest, url);
    check(url + ' is a policy, not a note to ourselves',
      !/To write/i.test(t) && t.length > 1800, t.length + ' characters');
  }

  const terms = await text(guest, '/terms');
  check('Terms says who is liable for an admission and a visa',
    /decided by the university/i.test(terms) && /decided by the consulate/i.test(terms));
  check('and that the catalogue is an indication, not a promise',
    /university's own website is the authority/i.test(terms));

  const privacy = await text(guest, '/privacy');
  check('Privacy says how long a student record is kept',
    /three years after your last application/i.test(privacy));
  check('and that documents leave India when we apply',
    /outside India/i.test(privacy));
  check('and how somebody asks for deletion',
    /Deletion/.test(privacy) && /withdraw consent/i.test(privacy));

  /* ------------------------------------------------------- the refund terms */
  const refunds = await text(guest, '/refunds');
  check('Refunds states the rule the office chose',
    /not refundable once paid/i.test(refunds));
  check('and does not pretend to override the law',
    /entitled to your money\s+back/i.test(refunds));
  check('and pays the guarantee in the window the office chose',
    /45 working days/.test(refunds));
  check('and says GST comes back with it',
    /including the GST charged on it/i.test(refunds));

  /* --------------------------------- the guarantee the card has been selling */
  const rp = await guest.newPage();
  await rp.goto(BASE + '/refunds', { waitUntil: 'load' });
  await rp.waitForTimeout(1800);
  check('the anchor both cards link to exists',
    await rp.isVisible('#guarantee-terms'));
  const cards = await rp.$$eval('.pkg-term > b', els => els.map(e => e.textContent));
  check('every pledged package has its terms printed here',
    cards.includes('Boarding Pass') && cards.includes('Offer Letter'), cards.join(' | '));
  const boarding = await rp.$eval('#terms-pkg-boarding', el => el.innerText);
  check('the guarantee says what voids it',
    /What voids the guarantee/.test(boarding));
  check('and how to claim it', /How to claim/.test(boarding));
  check('and the headings really are headings',
    (await rp.$$('#terms-pkg-boarding h4')).length >= 4,
    (await rp.$$('#terms-pkg-boarding h4')).length + ' headings');
  await rp.close();

  /* ------------------------- the card on the home page still points at them */
  const home = await guest.newPage();
  await home.goto(BASE + '/#packages', { waitUntil: 'domcontentloaded' });
  await home.waitForTimeout(2400);
  const links = await home.$$eval('#packages a[href*="guarantee-terms"]',
    els => els.length);
  check('the pledges on the cards still link to those terms', links >= 2, links);
  await home.close();

  /* ------------------------------------------------- nothing prints a blank */
  for (const url of PAGES) {
    const t = await text(guest, url);
    check(url + ' prints no empty placeholder',
      !/:\s*(—|-|N\/A|TBD|\[)/.test(t) && !/undefined|\[object/.test(t));
  }

  /* ------------------------------ the office fills them in, once, for all four */
  const staff = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const s = await staff.newPage();
  s.on('pageerror', e => errs.push(String(e)));
  s.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon|net::ERR/.test(m.text()) && errs.push(m.text()));

  await s.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
  await s.waitForTimeout(2600);
  await s.click('[data-t="legal"]');
  await s.waitForSelector('#legalGaps', { timeout: 10000 });
  await s.waitForTimeout(500);

  const gapsBefore = Number(await s.textContent('#nLegal'));
  check('the office is told what is still blank', gapsBefore > 0, gapsBefore + ' blanks');
  check('and told which page each blank is for',
    /Grievance/.test(await s.textContent('#legalGaps')));

  await s.fill('#lgCin', CIN);
  await s.fill('#lgGstin', '36AABCG1234M1Z7');
  await s.fill('#lgAddress', 'Plot No 60, Madhapur\nHyderabad, Telangana 500081');
  await s.fill('#lgEffective', '1 September 2026');
  await s.fill('#lgJuris', 'Hyderabad, Telangana');
  await s.fill('#lgInvoice', 'GLV/26-27/0001');
  await s.fill('#lgOffName', 'Kavya Menon');
  await s.fill('#lgOffRole', 'Grievance Officer');
  await s.fill('#lgOffMail', 'grievance@glovels.com');
  await s.fill('#lgOffPhone', '+91 40 4567 8900');
  await s.click('#lgSave');
  await s.waitForTimeout(2500);

  await s.reload({ waitUntil: 'domcontentloaded' });
  await s.waitForTimeout(2600);
  await s.click('[data-t="legal"]');
  await s.waitForTimeout(700);
  check('saving clears the blanks', Number(await s.textContent('#nLegal')) === 0,
    await s.textContent('#nLegal'));
  check('and the CIN survives a reload', (await s.inputValue('#lgCin')) === CIN);

  /* One place, four pages. */
  for (const url of PAGES) {
    const t = await text(guest, url);
    check(url + ' now quotes the CIN from that one place', t.includes(CIN));
  }
  const grievance = await text(guest, '/grievance');
  check('the grievance page names the officer', /Kavya Menon/.test(grievance));
  check('and drops the "write to info@" fallback once it can',
    !/mark the subject/i.test(grievance));
  check('the address keeps the lines it was typed on',
    /Madhapur/.test(grievance) && /500081/.test(grievance));

  /* ----------------------------- the office rewrites a package's terms */
  await s.fill('[data-terms="pkg-boarding"]',
    'What the guarantee covers\nRewritten by the office at ' + stamp + '.');
  await s.click('#lgSave');
  await s.waitForTimeout(2500);
  const after = await text(guest, '/refunds');
  check('a package\'s terms can be rewritten from the office',
    after.includes('Rewritten by the office at ' + stamp));
  check('and the old wording is gone', !/What voids the guarantee/.test(after));

  check('no page errors on the Legal tab', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ============================================== the contact page works */
  const c = await guest.newPage();
  const cErrs = [];
  c.on('pageerror', e => cErrs.push(String(e)));
  await c.goto(BASE + '/contact-us', { waitUntil: 'load' });
  await c.waitForTimeout(2000);

  check('the contact page offers a phone number', await c.isVisible('#reachTel'));
  check('printed so a person can read it back',
    /^\+91 \d{5} \d{5}$/.test((await c.textContent('#reachTel')).trim()),
    await c.textContent('#reachTel'));
  check('and linked so a phone can dial it',
    /^tel:\+91\d{10}$/.test(await c.getAttribute('#reachTel', 'href')),
    await c.getAttribute('#reachTel', 'href'));
  check('WhatsApp goes to the office number',
    /wa\.me\/91\d{10}/.test(await c.getAttribute('#reachWa', 'href')),
    await c.getAttribute('#reachWa', 'href'));
  check('the WhatsApp icon is not an empty gap',
    (await c.$$('symbol#i-wa')).length === 1);

  /* It refuses what it should refuse. */
  await c.fill('#ctName', 'A');
  await c.fill('#ctPhone', '12345');
  await c.fill('#ctMail', 'not-an-email');
  await c.click('#ctGo');
  await c.waitForTimeout(600);
  check('a bad number is refused with a reason',
    await c.isVisible('#ctErr'), await c.textContent('#ctErr'));
  check('and nothing was sent', await c.isVisible('#ctForm'));

  const email = 'tester' + stamp + '@example.com';
  await c.fill('#ctName', 'Ananya Rao');
  await c.fill('#ctPhone', '9812345678');
  await c.fill('#ctMail', email);
  await c.fill('#ctDest', 'Germany');
  await c.fill('#ctMsg', 'MSc Data Science, 7.4 CGPA.');
  await c.click('#ctGo');
  await c.waitForSelector('#ctSent', { timeout: 10000 });
  check('a good enquiry is accepted and says so', await c.isVisible('#ctSent'));
  check('no page errors on the contact page', cErrs.length === 0, cErrs[0]);
  await c.close();

  const book = await (await staff.request.get(BASE + '/api/staff/enquiries')).json();
  const rows = book.enquiries || book.items || book || [];
  check('and it reaches the enquiry book in the office',
    rows.some(r => r.email === email),
    rows.slice(0, 2).map(r => r.email).join(', '));

  /* ======================= the checkout does not claim money it did not take */
  const buy = await guest.newPage();
  await buy.goto(BASE + '/#packages', { waitUntil: 'domcontentloaded' });
  await buy.waitForTimeout(2400);
  const btn = buy.locator('#packages [data-buy]').first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await buy.waitForSelector('#buyPay', { timeout: 8000 });
  check('the button does not say Pay while nothing is charged',
    !/^Pay/i.test((await buy.textContent('#buyPay')).trim()),
    await buy.textContent('#buyPay'));

  await buy.fill('#rqName', 'Ananya Rao');
  await buy.fill('#rqPhone', '9812345678');
  await buy.fill('#rqMail', 'buy' + stamp + '@example.com');
  const tick = await buy.$('#rqOk');
  if (tick) await tick.check().catch(() => {});
  await buy.click('#buyPay');
  await buy.waitForTimeout(3000);

  const title = (await buy.textContent('#buyT')).trim();
  const body = await buy.innerText('#buyBody');
  check('the confirmation does not announce a payment', title !== 'Payment received', title);
  check('and the money line does not say paid', !/\bpaid\b/i.test(body),
    (body.match(/Order GLV[^\n]*/) || [''])[0]);
  check('it says plainly that nothing was charged',
    /Nothing has been charged yet/.test(body));
  check('and tells them who collects it', /counsellor will confirm the amount/i.test(body));
  check('the order is still recorded', /GLV-\d+/.test(body),
    (body.match(/GLV-\d+/) || [''])[0]);
  await buy.close();

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
