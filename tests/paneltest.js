/**
 * The admin panel, and the drafts that were live.
 *
 * From the 1.3 and 1.5 testing rounds. Five of these are one sentence each in
 * a document; two of them turned out to be a screen not running at all.
 *
 *   AN EYE ON A PASSWORD FIELD, on every screen with one, because the eighth
 *   password box is the one somebody adds next month and forgets. Written once
 *   and swept over every page rather than added per screen.
 *
 *   "DEMO MODE — NOTHING WILL BE CHARGED", above an itemised bill with GST
 *   worked out on it. Left over from before there was a gateway, and the one
 *   sentence on that panel that is not true.
 *
 *   A PRIVATE UNIVERSITY FILED UNDER PACKAGES. Two coupled controls that did
 *   not move together: a new programme opens as Public, so "how the student
 *   applies" opens on Comprehensive filing, and changing the type to Private
 *   left the second answer behind.
 *
 *   "5 DRAFTS" WHILE ALL FIVE WERE READABLE. The blog index deliberately keeps
 *   the pages that were on glovels.com before the editor existed, serving from
 *   their files until a written post replaces each one. That is right. What
 *   was wrong is that the office screen did not know it.
 *
 *   AND THE REGISTERED COMPANY NAME, on the five pages whose entire job is to
 *   state it. Every legal page SHIPS the right name in its markup, and then a
 *   script on the page replaces it at runtime with whatever the Legal tab
 *   holds — and the built-in default there was still the old name. So the
 *   files were right, the sweep over the files reported "already in place",
 *   and the Terms in a visitor's browser said Glovels Overseas Consultants
 *   Private Limited. No check that reads a file could see that, which is why
 *   this one is asserted on a rendered page and driven through the office
 *   screen that feeds it.
 *
 *   AND "WEBSITE EDITOR" WHILE SIGNED IN AS ADMIN — which was not a label bug.
 *   The blog screen never called staffBoot at all, so the name and the role
 *   were never filled in, the must-change-your-password screen never appeared,
 *   and somebody without the content permission got a working-looking editor
 *   and a refusal from the server on Save. The leads screen had the same hole.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1600, height: 1050 } };
  const admin = await browser.newContext(vp);
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ================================================ 1. the eye, on every one */
  const anon = await browser.newContext(vp);
  const login = await anon.newPage();
  const lerrs = [];
  login.on('pageerror', e => lerrs.push(String(e)));
  await login.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  await login.waitForTimeout(1800);

  ok((await login.$$('.pw-eye')).length >= 1, 'the sign-in password has an eye on it');
  /* Driven, not counted: an icon that does not reveal anything is decoration. */
  const was = await login.$eval('.pw-wrap input', e => e.type);
  await login.click('.pw-eye');
  await login.waitForTimeout(200);
  const now = await login.$eval('.pw-wrap input', e => e.type);
  ok(was === 'password' && now === 'text',
    'and pressing it shows the password — ' + was + ' → ' + now);
  await login.click('.pw-eye');
  await login.waitForTimeout(200);
  ok(await login.$eval('.pw-wrap input', e => e.type) === 'password',
    'and pressing it again hides it');
  ok(await login.$eval('.pw-eye', e => e.getAttribute('type')) === 'button',
    'the eye is a button, not a submit — or it would send the form');
  ok(lerrs.length === 0, 'no page errors on sign in — ' + lerrs.slice(0, 2).join(' | '));

  /* The one that matters more than the sign-in screen: a box drawn by script
     AFTER the page loaded. Half of these are — the delete panel, Add someone,
     the forced change — and a sweep that only ran at load would miss them. */
  const stu = await browser.newContext(vp);
  const email = 'adm' + S + '@example.com';
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Admin Test', email, phone: '9876500077', password: 'a-real-password-' + S } });
  const prof = await stu.newPage();
  await prof.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await prof.waitForTimeout(2600);
  await prof.click('[data-account]');
  await prof.waitForTimeout(500);
  await prof.click('#delOpen');
  await prof.waitForTimeout(600);
  ok((await prof.$$('#delConfirm .pw-eye')).length >= 1,
    'a password box drawn after the page loaded gets one too');

  /* ============================ 2. nothing on the site says nothing is charged */
  const home = await anon.newPage();
  await home.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await home.waitForTimeout(2600);
  const src = await (await anon.request.get(BASE + '/')).text();
  ok(!/nothing will be charged/i.test(src),
    'the phrase is gone from the page source, not merely hidden');
  ok(!/Demo mode/i.test(src), 'and so is "demo mode"');

  /* ================================= 3. private is not filed under packages */
  const cat = await admin.newPage();
  const cerrs = [];
  cat.on('pageerror', e => cerrs.push(String(e)));
  await cat.goto(BASE + '/catalogue', { waitUntil: 'domcontentloaded' });
  await cat.waitForTimeout(2800);
  const add = await cat.$('#addProg');
  if (add) { await add.click(); await cat.waitForTimeout(700); }

  const opened = await cat.$eval('#fPublic', e => e.value).catch(() => null);
  ok(opened === '1', 'a new programme opens as public, which is the business — ' + opened);
  const feeAtOpen = await cat.$eval('#fFee', e => e.value).catch(() => null);
  ok(feeAtOpen === 'package', 'and applying through us costs a package — ' + feeAtOpen);

  /* THE one. Change the type and nothing else. */
  await cat.selectOption('#fPublic', '0');
  await cat.waitForTimeout(400);
  const feeAfter = await cat.$eval('#fFee', e => e.value).catch(() => null);
  ok(feeAfter === 'free',
    'changing the type to Private moves it out of packages — ' + feeAfter);

  /* And a deliberate choice is never overwritten: a private university we are
     NOT partnered with is a real thing, and this must not undo it. */
  await cat.selectOption('#fFee', 'package');
  await cat.waitForTimeout(300);
  await cat.selectOption('#fPublic', '1');
  await cat.waitForTimeout(300);
  await cat.selectOption('#fPublic', '0');
  await cat.waitForTimeout(300);
  ok(await cat.$eval('#fFee', e => e.value) === 'package',
    'but an answer somebody set themselves is left alone');

  /* And the deadline box says the year is not used, since it accepts one that
     has gone and there is no other way to know that is on purpose. */
  const form = (await cat.textContent('#progForm, form, .p-main').catch(() => '')) || '';
  ok(/year is not used/i.test(form),
    'the deadline box says the year is not read — ' + form.replace(/\s+/g, ' ').slice(0, 60));
  ok(cerrs.length === 0, 'no page errors on the catalogue — ' + cerrs.slice(0, 2).join(' | '));

  /* ====================== 4. the blog screen knows what is on the site */
  const posts = await (await admin.request.get(BASE + '/api/staff/posts')).json();
  const disk = (posts.posts || []).filter(p => p.onDisk);
  ok(disk.length > 0,
    'there are posts serving from their original page — ' + disk.length);
  /* AND THE PUBLIC CAN READ THEM, which is the whole point of keeping them —
     and which was not true. Every card on the public blog index answered 404:
     the index listed them, the route refused them, and the office screen
     called them drafts, so nobody was looking at any of the three. */
  const index = await (await anon.request.get(BASE + '/blog')).text();
  const cards = [...index.matchAll(/href="post\/([a-z0-9-]+)"/g)].map(m => m[1]);
  ok(cards.length > 0, 'the public blog index has cards on it — ' + cards.length);
  let broken = [];
  for (const slug of cards) {
    const r = await anon.request.get(BASE + '/post/' + slug);
    if (!r.ok()) broken.push(slug + ' ' + r.status());
  }
  ok(broken.length === 0,
    'and not one of them is a dead link — ' + JSON.stringify(broken));

  const blog = await admin.newPage();
  const berrs = [];
  blog.on('pageerror', e => berrs.push(String(e)));
  await blog.goto(BASE + '/blog-admin', { waitUntil: 'domcontentloaded' });
  await blog.waitForTimeout(3000);

  const tiles = (await blog.textContent('.out.tiles').catch(() => '')) || '';
  ok(!/\bDrafts\b/.test(tiles),
    'the tile no longer calls them drafts — ' + tiles.replace(/\s+/g, ' ').slice(0, 70));
  ok(/0\s*Not on the site/i.test(tiles.replace(/\s+/g, ' ')),
    'and says nothing is off the site, because nothing is — '
    + tiles.replace(/\s+/g, ' ').slice(0, 70));
  const pills = await blog.$$eval('.plist .stpill', e => e.map(x => x.textContent));
  ok(pills.length > 0 && pills.every(x => /on the site/i.test(x)),
    'every row says it is on the site — ' + [...new Set(pills)].join(' | '));

  /* ============= 5. and the screen runs at all, which was the real fault */
  ok(await blog.textContent('#staffRole') === 'Administrator',
    'the blog screen knows who is signed in — '
    + await blog.textContent('#staffRole'));
  ok(/Glovels Admin/.test(await blog.textContent('#staffName')),
    'and their name');
  ok(berrs.length === 0, 'no page errors on the blog screen — ' + berrs.slice(0, 2).join(' | '));

  /* The leads screen had the same hole. */
  const leads = await admin.newPage();
  await leads.goto(BASE + '/leads', { waitUntil: 'domcontentloaded' });
  await leads.waitForTimeout(3000);
  ok(await leads.textContent('#staffRole') === 'Administrator',
    'so does the leads screen — ' + await leads.textContent('#staffRole'));

  /* And no page asserts a role before it has asked. That is what made this a
     bug rather than a typo: the label was baked into the markup per screen. */
  for (const p of ['blog-admin', 'admin', 'home', 'catalogue', 'leads']) {
    const html = await (await admin.request.get(BASE + '/' + p)).text();
    const m = /id="staffRole"[^>]*>([^<]*)</.exec(html);
    ok(m && !/editor|admin|counsellor/i.test(m[1]),
      p + ' does not claim a role before asking — ' + (m && JSON.stringify(m[1])));
  }

  /* ================================ 6. the registered name, as rendered */
  /* NOT read out of the HTML. The name in the markup was right the whole time
     — a script overwrote it on load from the Legal block, and the default in
     that block was the old company name. So every assertion here is on text
     the browser had finished with. */
  const LEGAL = ['terms', 'refunds', 'privacy', 'disclaimers', 'grievance'];
  const visitor = await browser.newContext(vp);
  const leg = await visitor.newPage();
  const gerrs = [];
  leg.on('pageerror', e => gerrs.push(String(e)));

  for (const slug of LEGAL) {
    const res = await leg.goto(BASE + '/' + slug, { waitUntil: 'domcontentloaded' });
    ok(res && res.status() === 200, slug + ' is a page — ' + (res && res.status()));
    await leg.waitForTimeout(900);
    const t = (await leg.textContent('body')) || '';
    ok(/Glovels Consultants Private Limited/.test(t),
      slug + ' names the registered company');
    ok(!/Overseas/i.test(t),
      slug + ' does not use the old name — '
      + ((t.match(/Glovels[^,.\n]{0,60}Limited/) || [''])[0]));
  }
  ok(gerrs.length === 0, 'no page errors on the legal pages — '
    + gerrs.slice(0, 2).join(' | '));

  /* And the half that makes the above worth having: prove the page really does
     take its name from the Legal tab, so that a wrong default is a wrong page.
     A check that would pass even with the script deleted is not a check. */
  const MARK = 'Glovels Test Entity ' + S + ' Limited';
  const before = (await (await admin.request.get(BASE + '/api/staff/content')).json()).legal || {};
  const put = await admin.request.put(BASE + '/api/staff/content/legal',
    { data: { value: Object.assign({}, before, { entity: MARK }) } });
  ok(put.ok(), 'the office can set the registered name — ' + put.status());

  await leg.goto(BASE + '/terms', { waitUntil: 'domcontentloaded' });
  await leg.waitForTimeout(900);
  const typed = (await leg.textContent('body')) || '';
  ok(typed.includes(MARK),
    'and what they type is what the Terms say — so the default is load-bearing');

  /* Put it back, and confirm the page goes back with it. */
  const back = await admin.request.put(BASE + '/api/staff/content/legal',
    { data: { value: Object.assign({}, before, { entity: '' }) } });
  ok(back.ok(), 'and it can be cleared again — ' + back.status());
  await leg.goto(BASE + '/terms', { waitUntil: 'domcontentloaded' });
  await leg.waitForTimeout(900);
  const blank = (await leg.textContent('body')) || '';
  ok(/Glovels Consultants Private Limited/.test(blank) && !/Overseas/i.test(blank),
    'and an unfilled Legal tab falls back to the CORRECT name, not the old one '
    + '— ' + ((blank.match(/Glovels[^,.\n]{0,60}Limited/) || [''])[0]));
  ok(!/operated by\s*[.,]/i.test(blank.replace(/\s+/g, ' ')),
    'and never to a blank, which would read "operated by ."');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
