/*
 * Patch 151 — the full test, 30 September (Glovels-Full-Test-Open-Issues-Sept30).
 * One check per issue that code can settle; data and wording decisions are in
 * the patch notes.
 */
const { chromium } = require('playwright');
const G = require('../server/grades.js');
const BASE = process.env.BASE || 'http://localhost:8099'; const S = Date.now();
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

(async () => {
  /* ---- 5, 13, 20, 21: the profile rules, straight ---- */
  ok(/February 2000 has 29 days/.test((G.problems({ dob: '2000-02-31' })[0] || {}).why || ''), '31 Feb 2000 is refused with the month length');
  ok(G.problems({ dob: '2000-13-45' }).length === 1, 'month 13 is refused');
  ok(G.problems({ dob: '2000-02-29' }).length === 0, 'a real leap day is fine');
  ok(G.problems({ r1_mail: 'bad@' }).length === 1, 'a recommender email of "bad@" is refused');
  ok(G.problems({ email: 'me@x.com', r1_mail: 'ME@x.com' }).length === 1, 'the student’s own email as recommender is refused');
  ok(G.problems({ firstName: '1234' }).length === 1 && G.problems({ firstName: '<b>S</b>' }).length === 1, 'digit-only and HTML names are refused');
  ok(G.problems({ firstName: 'x'.repeat(101) }).length === 1, 'a 101-character name is refused');
  ok(G.problems({ phone: '9876543210', alt_phone: '+91 98765 43210' }).length === 1, 'the alternate number cannot be the main one');

  const b = await chromium.launch();
  const anon = await b.newContext();
  const admin = await b.newContext();
  await admin.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ---- 4, 20: consent and names on enquiries ---- */
  const enq = d => anon.request.post(BASE + '/api/enquiries', { data: d, headers: { 'x-forwarded-for': '203.0.113.' + (S % 200) } });
  let r = await enq({ name: 'No Consent', email: 'nc' + S + '@example.com', phone: '9876500301' });
  ok(r.status() === 422, 'an enquiry without consent is refused — ' + r.status());
  r = await enq({ name: 'x'.repeat(3000), email: 'ln' + S + '@example.com', phone: '9876500302', consent: 'yes' });
  ok(r.status() === 422, 'a 3,000-character name is refused — ' + r.status());
  r = await enq({ name: 'Given Consent', email: 'gc' + S + '@example.com', phone: '9876500303', consent: 'yes', consentWording: 'I agree that Glovels may contact me.' });
  ok(r.ok(), 'with consent it goes through — ' + r.status());
  const leads = await (await admin.request.get(BASE + '/api/staff/enquiries')).json();
  const mine = (leads.enquiries || []).find(e => e.email === 'gc' + S + '@example.com');
  ok(mine && mine.consent === 'yes' && mine.consentAt && /contact me/.test(mine.consentWording), 'and consent, time and wording are stored — ' + JSON.stringify(mine || {}).slice(0, 160));

  /* ---- 3: a partial profile save merges ---- */
  const email = 'pp' + S + '@student.example', pw = 'pp-pass-' + S;
  const stu = await b.newContext();
  await stu.request.post(BASE + '/api/auth/signup', { data: { name: 'Part Save', email, phone: '9876500304', password: pw, terms: true } });
  await stu.request.post(BASE + '/api/auth/login', { data: { email, password: pw } });
  await stu.request.put(BASE + '/api/profile', { data: { profile: { firstName: 'Part', lastName: 'Save', city: 'Pune', d_cgpa: '8', d_max: '10' } } });
  r = await stu.request.put(BASE + '/api/profile', { data: { profile: { phone: '9876500304' } } });
  const st1 = await (await stu.request.get(BASE + '/api/state')).json();
  ok(r.ok() && st1.profile && st1.profile.city === 'Pune' && st1.profile.d_cgpa === '8' && st1.profile.phone === '9876500304',
    'saving one field keeps the rest — ' + JSON.stringify(st1.profile || {}).slice(0, 120));
  r = await stu.request.put(BASE + '/api/profile', { data: { profile: { dob: '2000-02-31' } } });
  ok(r.status() === 422, 'the profile save refuses 31 February — ' + r.status());

  /* ---- 2: deletion needs DELETE typed ---- */
  r = await stu.request.fetch(BASE + '/api/account', { method: 'DELETE', data: { email, password: pw } });
  ok(r.status() === 422, 'account deletion without DELETE typed is refused — ' + r.status());
  const pg = await stu.newPage();
  await pg.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2000);
  await pg.evaluate(() => { const a = [...document.querySelectorAll('[data-account], #secNav button')].find(x => /account/i.test(x.textContent)); if (a) a.click(); });
  await pg.waitForTimeout(500);
  await pg.evaluate(() => { const o = document.querySelector('#delOpen'); if (o) o.click(); });
  await pg.waitForTimeout(600);
  ok(await pg.$eval('#delGo', el => el.disabled).catch(() => null) === true, 'Delete permanently is disabled when the section opens');
  ok(await pg.$eval('#delPass', el => el.value === '' && el.autocomplete === 'new-password').catch(() => false), 'and the password box is empty and not a saved-password field');

  /* ---- 6: no copy of the file in the browser ---- */
  const kept = await pg.evaluate(() => { try { return localStorage.getItem('glovels.portal.offline'); } catch (e) { return 'x'; } });
  ok(!kept, 'the portal keeps no offline copy of the profile in localStorage');

  /* ---- 16: no real name as a hint ---- */
  const prof = await (await stu.request.get(BASE + '/profile')).text();
  ok(!/ph:'Vishal'|ph:'Sakhamuri'/.test(prof), 'the name boxes no longer use a real student’s name as the example');

  /* ---- 21: spaces-only message, lead status ---- */
  r = await stu.request.post(BASE + '/api/messages', { data: { body: '    ' } });
  ok(r.status() === 422, 'a message of only spaces is refused — ' + r.status());
  if (mine) {
    r = await admin.request.put(BASE + '/api/staff/lead/' + mine.id, { data: { status: 'banana' } });
    ok(r.status() === 422, 'lead status "banana" is refused — ' + r.status());
  }

  /* ---- 9: partner add-student checks ---- */
  const pe = 'pa' + S + '@agency.example', ppw = 'pa-' + S;
  await admin.request.post(BASE + '/api/staff/people', { data: { name: 'Check Agency', email: pe, password: ppw, role: 'partner' } });
  const P = await b.newContext();
  await P.request.post(BASE + '/api/auth/login', { data: { email: pe, password: ppw } });
  await P.request.post(BASE + '/api/auth/change', { data: { current: ppw, password: ppw + 'X' } });
  await P.request.post(BASE + '/api/auth/login', { data: { email: pe, password: ppw + 'X' } });
  const add = await (await P.request.post(BASE + '/api/partner/students', { data: { students: [
    { name: 'Junk Phone', email: 'jp' + S + '@ex.example', phone: 'zzzzz' },
    { name: 'Junk Dest', email: 'jd' + S + '@ex.example', destination: 'ZZ' },
    { name: 'Good One', email: 'go' + S + '@ex.example', phone: '9876500305', destination: 'France' },
  ] } })).json();
  ok((add.rejected || []).length === 2 && (add.added || []).length === 1, 'the partner form refuses "zzzzz" and "ZZ", and takes France — ' + JSON.stringify(add).slice(0, 200));

  /* ---- 22: France in the lists ---- */
  const home = await (await anon.request.get(BASE + '/')).text();
  ok(/<option value="FR">[^<]*France<\/option>/.test(home), 'France is on the homepage counselling form');

  /* ---- 25: health says nothing about accounts ---- */
  const h = await (await anon.request.get(BASE + '/api/health')).json();
  ok(h.ok === true && h.accounts === undefined && h.storage === undefined, '/api/health no longer shows the account count — ' + JSON.stringify(h));

  /* ---- 24: content payload is not every counsellor's ---- */
  const ce = 'cc' + S + '@glovels.com', cpw = 'cc-' + S;
  await admin.request.post(BASE + '/api/staff/people', { data: { name: 'Content Check', email: ce, password: cpw, role: 'counsellor' } });
  const C = await b.newContext();
  await C.request.post(BASE + '/api/auth/login', { data: { email: ce, password: cpw } });
  await C.request.post(BASE + '/api/auth/change', { data: { current: cpw, password: cpw + 'X' } });
  await C.request.post(BASE + '/api/auth/login', { data: { email: ce, password: cpw + 'X' } });
  r = await C.request.get(BASE + '/api/staff/content');
  ok(r.status() === 403, 'a counsellor cannot read the site editor’s payload and audit trail — ' + r.status());

  await b.close();
  console.log('round151test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
