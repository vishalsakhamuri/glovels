/**
 * What makes the Android app an app.
 *
 * A Trusted Web Activity is this site running full-screen inside an Android
 * shell. Android drops the browser's address bar only if it can fetch
 * /.well-known/assetlinks.json from THIS domain and find, in it, the signing
 * certificate of the app that is asking.
 *
 * The reason this needs a test rather than a look is that every way of getting
 * it wrong succeeds. A missing file, a wrong package name, the SHA-1 pasted
 * where the SHA-256 belongs — none of them fails. The app installs, opens,
 * signs people in and works, wearing a URL bar across the top of every screen,
 * with nothing anywhere saying why. A reviewer reads that as a wrapped website;
 * a user reads it as a browser pretending to be an app.
 *
 * So:
 *
 *   IT IS SERVED, at exactly that path, as JSON, to nobody in particular.
 *   Google's verifier is not signed in and follows no redirects it does not
 *   have to.
 *
 *   IT IS EMPTY UNTIL THERE IS AN APP, and empty is a valid answer rather than
 *   a 404. A 404 there is indistinguishable from a misconfigured host.
 *
 *   THE FINGERPRINT IS CHECKED WHEN IT IS TYPED. This is the whole point of
 *   putting it behind a form: the SHA-1 sitting directly above the SHA-256 on
 *   the same Play Console page is the thing people actually paste, and it is
 *   the mistake that costs a day.
 *
 *   AND ONLY AN ADMIN MAY TYPE IT. Whoever controls this file controls which
 *   Android app may present itself as Glovels.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* A real one, in the shape the Play Console prints: 32 hex pairs, colons. */
const printOf = seed => {
  const h = require('crypto').createHash('sha256').update(String(seed)).digest('hex')
    .toUpperCase();
  return (h.match(/../g) || []).join(':');
};

(async () => {
  const browser = await chromium.launch();
  const anon = await browser.newContext();

  /* ---------------------------------------------------- before there is an app */
  const first = await anon.request.get(BASE + '/.well-known/assetlinks.json');
  ok(first.ok(), 'the file is served — ' + first.status());
  ok(/application\/json/.test(first.headers()['content-type'] || ''),
    'as JSON — ' + first.headers()['content-type']);
  const empty = await first.json().catch(() => null);
  ok(Array.isArray(empty), 'and it parses as an array — ' + JSON.stringify(empty));
  ok(Array.isArray(empty) && empty.length === 0,
    'empty until there is an app, which is a valid answer and a 404 is not');

  /* Signed out, because Google's verifier is. */
  ok(!first.headers()['set-cookie'], 'and it needs no session');

  /* -------------------------------------------------------- only an admin sets it */
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const cEmail = 'twa' + S + '@glovels.com';
  const cPass = 'twa-pass-' + S;
  await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'TWA Counsellor', email: cEmail, password: cPass, role: 'counsellor' } });
  const C = await browser.newContext();
  await C.request.post(BASE + '/api/auth/login', { data: { email: cEmail, password: cPass } });
  await C.request.post(BASE + '/api/auth/change',
    { data: { current: cPass, password: cPass + 'X' } });
  await C.request.post(BASE + '/api/auth/login',
    { data: { email: cEmail, password: cPass + 'X' } });

  const cTry = await C.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.evil.app', fingerprints: printOf('evil') } });
  ok(cTry.status() === 403,
    'a counsellor cannot say which app may be Glovels — ' + cTry.status());

  const sEmail = 'twastu' + S + '@student.example';
  const St = await browser.newContext();
  await St.request.post(BASE + '/api/auth/signup',
    { data: { name: 'TWA Student', email: sEmail, phone: '9876543210',
      password: 'student-password-' + S } });
  const sTry = await St.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.evil.app', fingerprints: printOf('evil') } });
  ok(sTry.status() === 403 || sTry.status() === 401,
    'nor can a student — ' + sTry.status());

  const aTry = await anon.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.evil.app', fingerprints: printOf('evil') } });
  ok(aTry.status() === 401, 'nor can somebody signed out — ' + aTry.status());

  /* Nothing above changed anything. */
  const stillEmpty = await (await anon.request.get(
    BASE + '/.well-known/assetlinks.json')).json().catch(() => null);
  ok(Array.isArray(stillEmpty) && stillEmpty.length === 0,
    'and none of that got into the file — ' + JSON.stringify(stillEmpty));

  /* --------------------------------------------------- what is refused when typed
     The SHA-1 is the one people paste, because it sits directly above the
     SHA-256 on the same page. */
  const sha1 = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01';
  const short = await admin.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.glovels.app', fingerprints: sha1 } });
  ok(short.status() === 422, 'a SHA-1 is refused rather than stored — ' + short.status());
  const shortSaid = await short.json().catch(() => ({}));
  ok(/SHA-1/i.test(shortSaid.error || ''),
    'and the message names the mistake somebody actually made — '
    + String(shortSaid.error).slice(0, 60));

  const badPkg = await admin.request.put(BASE + '/api/staff/android',
    { data: { package: 'Glovels App', fingerprints: printOf('a') } });
  ok(badPkg.status() === 422, 'a package name with a space is refused — ' + badPkg.status());

  const noDot = await admin.request.put(BASE + '/api/staff/android',
    { data: { package: 'glovels', fingerprints: printOf('a') } });
  ok(noDot.status() === 422, 'and one with no dot in it — ' + noDot.status());

  const stillEmpty2 = await (await anon.request.get(
    BASE + '/.well-known/assetlinks.json')).json().catch(() => null);
  ok(Array.isArray(stillEmpty2) && stillEmpty2.length === 0,
    'none of the refusals left half a setting behind');

  /* ------------------------------------------------------------ and what works */
  const one = printOf('app-signing');
  const two = printOf('upload');
  const saved = await admin.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.glovels.app', fingerprints: one + '  ' + two } });
  ok(saved.ok(), 'both certificates save — ' + saved.status()
    + ' ' + (await saved.text()).slice(0, 70));

  const live = await (await anon.request.get(
    BASE + '/.well-known/assetlinks.json')).json().catch(() => null);
  ok(Array.isArray(live) && live.length === 1,
    'the file now has a statement in it — ' + JSON.stringify(live).slice(0, 60));
  const st = live && live[0];
  ok(st && (st.relation || []).includes('delegate_permission/common.handle_all_urls'),
    'delegating all urls, which is the relation a TWA needs — '
    + JSON.stringify(st && st.relation));
  ok(st && st.target && st.target.namespace === 'android_app',
    'to an android app — ' + (st && st.target && st.target.namespace));
  ok(st && st.target && st.target.package_name === 'com.glovels.app',
    'named — ' + (st && st.target && st.target.package_name));
  const prints = (st && st.target && st.target.sha256_cert_fingerprints) || [];
  ok(prints.length === 2 && prints.includes(one) && prints.includes(two),
    'against both certificates — ' + prints.length);
  ok(prints.every(f => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)),
    'in the shape Google parses — ' + (prints[0] || '').slice(0, 20));

  /* Lower case in, upper case out. Google compares these as strings. */
  const lower = await admin.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.glovels.app', fingerprints: one.toLowerCase() } });
  ok(lower.ok(), 'a fingerprint pasted in lower case is accepted — ' + lower.status());
  const norm = await (await anon.request.get(
    BASE + '/.well-known/assetlinks.json')).json().catch(() => null);
  ok(norm && norm[0] && norm[0].target.sha256_cert_fingerprints[0] === one,
    'and comes back out in upper case, which is what Google compares against — '
    + (norm && norm[0] && norm[0].target.sha256_cert_fingerprints[0] || '').slice(0, 20));

  /* The same one twice is one, not two. */
  const dup = await (await admin.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.glovels.app', fingerprints: one + ' ' + one } })).json();
  ok((dup.fingerprints || []).length === 1,
    'the same certificate pasted twice is stored once — ' + (dup.fingerprints || []).length);

  /* ---------------------------------------------------- and it can be taken back */
  const cleared = await admin.request.put(BASE + '/api/staff/android',
    { data: { package: '', fingerprints: '' } });
  ok(cleared.ok(), 'it can be cleared — ' + cleared.status());
  const back = await (await anon.request.get(
    BASE + '/.well-known/assetlinks.json')).json().catch(() => null);
  ok(Array.isArray(back) && back.length === 0,
    'and the file goes back to saying nothing — ' + JSON.stringify(back));

  /* ------------------------------------------------------------ on the screen */
  await admin.request.put(BASE + '/api/staff/android',
    { data: { package: 'com.glovels.app', fingerprints: one } });
  const page = await admin.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const tab = await page.$('.otab[data-o="app"]');
  ok(!!tab, 'the office has a Mobile app tab');
  if (tab) await tab.click().catch(() => {});
  await page.waitForTimeout(900);

  ok(await page.isVisible('#appCard').catch(() => false), 'and it opens the card');
  const said = await page.textContent('#appCard').catch(() => '');
  ok(/verifying/i.test(said),
    'which says the file is verifying, not merely that a box is filled — '
    + said.replace(/\s+/g, ' ').slice(0, 80));
  ok(/SHA-1/.test(said),
    'and warns about the fingerprint sitting above the right one on the same page');
  ok(/App signing/i.test(said),
    'and says where in the Play Console to find it');
  const pkgBox = await page.inputValue('#aPkg').catch(() => '');
  ok(pkgBox === 'com.glovels.app', 'the saved package is in the box — ' + pkgBox);
  ok(!errs.length, 'no page errors — ' + errs.slice(0, 2).join(' | '));

  /* Refusals reach the person, rather than being swallowed. */
  await page.fill('#aPrints', sha1).catch(() => {});
  await page.click('#appSave').catch(() => {});
  await page.waitForTimeout(1200);
  ok(await page.isVisible('#appErr').catch(() => false),
    'a bad fingerprint is refused on the screen');
  const shown = await page.textContent('#appErr').catch(() => '');
  ok(/SHA-1|fingerprint/i.test(shown), 'saying what is wrong — ' + shown.slice(0, 60));

  /* Put it back, so a suite that runs after this one is not looking at a
     half-configured site. */
  await admin.request.put(BASE + '/api/staff/android',
    { data: { package: '', fingerprints: '' } });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
