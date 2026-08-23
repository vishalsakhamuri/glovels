/**
 * What the student accepted when they paid, recorded and shown back to them.
 *
 * The tick box only appeared for packages that carried a pledge of their own —
 * so two of the three study packages, and every work and migration package,
 * took money with nothing recorded about what the buyer had agreed to. What
 * WAS recorded was a string the browser sent, which is worth nothing: a page
 * that reports its own consent wording can report anything.
 *
 * "Student should be shown proof that during payment he has accepted all
 * conditions" — so the last half of this drives the receipt in a browser, the
 * way a student would open it.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();
  const guest = await browser.newContext({ viewport: { width: 1500, height: 1000 } });

  /* ------------------------------------------------- the server is the rule */
  const without = await guest.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-roadmap', name: 'No Tick', email: 'notick' + stamp + '@example.com',
      phone: '9876543210' },
  });
  check('an order with no acceptance is refused', without.status() === 422, without.status());
  const why = await without.json();
  check('and the refusal carries the sentence it wanted ticked',
    (why.line || '').length > 40, (why.line || '').slice(0, 60));
  check('including the base terms, not only a package pledge',
    /Terms of Service/.test(why.line || ''));

  /* A package with no pledge of its own still records something. This is the
     case that recorded nothing at all before. */
  const plain = await guest.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-roadmap', name: 'Plain Buyer',
      email: 'plain' + stamp + '@example.com', phone: '9876543211', acceptedTerms: true },
  });
  check('a package with no pledge of its own can be bought', plain.ok(), plain.status());
  const plainRef = (await plain.json()).reference;
  const plainRec = await (await guest.request.get(BASE + '/api/orders/' + plainRef
    + '/acceptance?email=plain' + stamp + '@example.com')).json();
  check('and something is recorded against it',
    !!plainRec.accepted, JSON.stringify(plainRec.accepted));
  check('the record has the words, not a boolean',
    /Terms of Service/.test((plainRec.accepted || {}).line || ''));

  /* ------------------------------------------- a package that promises more */
  const email = 'buyer' + stamp + '@example.com';
  const placed = await guest.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-boarding', name: 'Guarantee Buyer', email, phone: '9876543212',
      acceptedTerms: true,
      /* A hand-rolled request trying to write its own terms. */
      consentWording: 'I agree to nothing at all', acceptedText: 'nothing at all' },
  });
  check('the order is placed', placed.ok(), placed.status());
  const ref = (await placed.json()).reference;

  const got = await (await guest.request.get(BASE + '/api/orders/' + ref
    + '/acceptance?email=' + email)).json();
  const a = got.accepted || {};
  check('the record ignores what the browser said it showed',
    !/nothing at all/.test(a.line || ''), a.line);
  check('and carries the package’s own promise as well as the base terms',
    /Terms of Service/.test(a.line) && /admission guarantee/.test(a.line), a.line);
  check('with the time it happened', !!a.at && !isNaN(new Date(a.at)), a.at);
  check('and where from, because "somebody with my email did it" is the first thing said',
    !!a.ip, a.ip);
  check('the package terms are stored word for word, not linked to',
    (a.packageTerms || '').length > 400, (a.packageTerms || '').length + ' characters');
  check('with a fingerprint of them', /^[a-f0-9]{16}$/.test(a.packageTermsSha256 || ''),
    a.packageTermsSha256);
  check('and a fingerprint of each legal page as it read that day',
    (a.docs || []).length >= 2 && a.docs.every(d => /^[a-f0-9]{16}$/.test(d.sha256)),
    JSON.stringify((a.docs || []).map(d => d.name)));
  check('naming the company it was accepted with', !!a.entity, a.entity);

  /* --------------------------------------------------- who may read it back */
  const nosy = await browser.newContext();
  check('somebody with the reference alone cannot read it',
    (await nosy.request.get(BASE + '/api/orders/' + ref + '/acceptance')).status() === 403);
  check('nor with the wrong email',
    (await nosy.request.get(BASE + '/api/orders/' + ref
      + '/acceptance?email=someone@else.com')).status() === 403);
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  check('the office can', (await staff.request.get(BASE + '/api/orders/' + ref
    + '/acceptance')).ok());

  /* ------------------------------------------------------------ the receipt */
  const page = await guest.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/acceptance/' + ref + '?email=' + encodeURIComponent(email),
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  const text = await page.textContent('body');
  check('the student can open a page that shows it', /What you accepted/.test(text));
  check('it quotes the sentence they ticked, in full',
    text.includes('admission guarantee applies to the shortlist'));
  check('it names them and their order', text.includes(email) && text.includes(ref));
  check('it prints the package terms as they read that day',
    /What voids the guarantee/.test(text));
  check('and shows a fingerprint beside each document',
    (await page.$$('.rc-docs code')).length >= 2,
    (await page.$$('.rc-docs code')).length + ' fingerprints');
  check('the page tells search engines to stay away — it has their name on it',
    /noindex/.test(await page.content()));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  const shut = await nosy.newPage();
  await shut.goto(BASE + '/acceptance/' + ref, { waitUntil: 'domcontentloaded' });
  check('and a stranger opening the same address is told to sign in',
    /sign in/i.test(await shut.textContent('body')));

  /* ------------------------------------------------ and on the way through */
  const buy = await guest.newPage();
  const berrs = [];
  buy.on('pageerror', e => berrs.push(String(e)));
  await buy.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await buy.waitForTimeout(2600);
  await buy.click('[data-show-packages]');
  await buy.waitForTimeout(700);
  /* Roadmap: the package that carries no pledge of its own, and therefore
     showed no tick box at all before. */
  await buy.click('[data-buy="pkg-roadmap"]');
  await buy.waitForTimeout(900);

  check('every checkout shows a tick box now, pledge or no pledge',
    await buy.isVisible('#rqOk'));
  check('with the terms it is about to record',
    /Terms of Service/.test(await buy.textContent('#cBox')),
    (await buy.textContent('#cBox') || '').slice(0, 70));
  check('and says that it is recorded and shown back',
    /show it back to you/i.test(await buy.textContent('#buyModal .sheet')),
    (await buy.textContent('#cBox') || '').slice(0, 40));

  await buy.fill('#rqName', 'Checkout Buyer');
  await buy.fill('#rqPhone', '9876543213');
  await buy.fill('#rqMail', 'checkout' + stamp + '@example.com');
  await buy.click('#buyPay');
  await buy.waitForTimeout(700);
  check('paying without ticking is refused on the page too',
    await buy.isVisible('#rqOkErr'));

  await buy.check('#rqOk');
  await buy.click('#buyPay');
  await buy.waitForTimeout(2200);
  const done = await buy.textContent('#buyModal .sheet');
  check('ticking it lets the order through', /GLV-\d+/.test(done), done.slice(0, 120));
  const proof = await buy.$$eval('a[href^="/acceptance/"]', els => els.map(e => e.getAttribute('href')));
  check('and the confirmation links to what they accepted', proof.length >= 1,
    proof.join(' '));
  check('no page errors on the way through', berrs.length === 0, berrs.slice(0, 2).join(' | '));

  /* ------------------------------------- and where a student finds it later */
  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const dash = await stu.newPage();
  const derrs = [];
  dash.on('pageerror', e => derrs.push(String(e)));
  await dash.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await dash.waitForTimeout(2600);
  check('their orders are listed on the screen they land on',
    await dash.isVisible('.ord-card'));
  check('each one with a way back to what they accepted',
    (await dash.$$('.ord-a')).length > 0,
    (await dash.$$eval('.ord-a', a => a.map(x => x.getAttribute('href')))).join(' '));
  check('no page errors on the dashboard', derrs.length === 0, derrs.slice(0, 2).join(' | '));

  /* And the office can see, at a glance, which orders have nothing recorded. */
  const book = await (await staff.request.get(BASE + '/api/staff/orders')).json();
  check('the order book says whether each order has a record',
    (book.orders || []).every(o => 'acceptedAt' in o));
  check('and the one just placed has one',
    ((book.orders || []).find(o => o.reference === ref) || {}).acceptedAt);

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
