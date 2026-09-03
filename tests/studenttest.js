/**
 * Student View Corrections — the dashboard and the messages screen.
 *
 * Three of these are the same fault wearing different clothes: the screen was
 * telling a student something that was not true about their own file.
 *
 *   "25% filled, even though I did not upload anything." The readiness card
 *   was the designer's markup and nothing had ever replaced it. The ring said
 *   25%, Passport said VERIFIED and Degree transcripts said IN REVIEW — on
 *   every account, on the first visit, before a single file existed. A
 *   student's own dashboard was telling them their passport had been checked.
 *
 *   "Your counsellor is typing" with nobody there. /api/typing went through
 *   live.toThread, which writes to the STUDENT's own connections first — so a
 *   student's keystroke came back to the browser that sent it and the screen
 *   announced their counsellor. On a new account, where a seeded welcome
 *   message makes the thread look live, that is indistinguishable from a
 *   person actually being at the other end.
 *
 *   "Your counsellor sees it on their screen straight away." True only if a
 *   counsellor happens to have that thread open, which the student cannot
 *   know. The point of a message going onto their file is that it does not
 *   depend on anybody watching.
 *
 * And two that are visible rather than false: chips crossing the border of the
 * card, and descriptions truncated mid-word — "with the el", "until disburs" —
 * cut into the markup at a character count when the page was designed.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const seen = (p, s) => p.isVisible(s).catch(() => false);

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const email = 'sv' + S + '@student.example';
  const password = 'a-real-password-' + S;
  const stu = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'View Student', email, phone: '9876543210', password } });
  const me = await (await stu.request.get(BASE + '/api/auth/me')).json();
  const sid = me.user && me.user.id;
  ok(!!sid, 'a student exists');

  /* ------------------------------------------- the meter, on an empty account */
  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);

  const read = () => page.evaluate(() => {
    const c = document.querySelector('#docReady');
    if (!c) return null;
    return {
      pct: ((c.querySelector('.ring-lbl') || {}).textContent || '').trim(),
      note: ((c.querySelector('.ready-note') || {}).textContent || '').trim(),
      rows: [...c.querySelectorAll('.doclist li')].map(li => ({
        name: ((li.querySelector('.dname') || {}).textContent || '').trim(),
        state: ((li.querySelector('.st') || {}).textContent || '').trim(),
      })),
    };
  }).catch(() => null);

  const empty = await read();
  ok(empty && empty.rows.length > 0, 'the dashboard has a readiness card — '
    + JSON.stringify(empty && empty.rows.length));
  ok(empty && empty.pct === '0%',
    'and it says 0% on an account that has uploaded nothing — ' + (empty || {}).pct);
  ok(empty && empty.rows.every(r => r.state === 'Not uploaded'),
    'with nothing claiming to be verified — '
    + JSON.stringify((empty || {}).rows));
  ok(empty && /0 of \d+ verified/.test(empty.note),
    'and says in words what the ring counts — ' + (empty || {}).note);

  /* The names are the real document list, not a set the designer invented.
     "IELTS scorecard" and "Resume" were on the card and are not what the
     Documents screen or the counsellor call them. */
  const names = (empty || { rows: [] }).rows.map(r => r.name);
  ok(names.includes('Passport') && names.includes('Semester-wise marksheets'),
    'the names are the ones the Documents screen uses — ' + JSON.stringify(names));
  /* This card is injected into dashboard.html, which is edited in place and
     never regenerated — so it used to keep whatever the first build wrote and
     drift away from every other screen. Renaming a document has to reach it. */
  ok(!names.includes('Degree transcripts'),
    'and not a name the rest of the product has stopped using — ' + JSON.stringify(names));
  ok(!names.includes('IELTS scorecard') && !names.includes('Resume'),
    'and not the ones the mock-up used — ' + JSON.stringify(names));

  /* ------------------------------------------------- and it moves with the file */
  const up = await stu.request.post(BASE + '/api/documents', {
    multipart: {
      key: 'passport',
      file: { name: 'passport.pdf', mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 passport ' + S) },
    },
  });
  ok(up.ok(), 'the student uploads a passport — ' + up.status());

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  const waiting = await read();
  const pass1 = (waiting || { rows: [] }).rows.find(r => r.name === 'Passport');
  ok(pass1 && pass1.state === 'In review',
    'the card says it is with the counsellor — ' + JSON.stringify(pass1));
  ok(waiting && waiting.pct === '0%',
    'and still 0%, because uploaded is not checked — ' + (waiting || {}).pct);

  /* Verified by staff, which is the only thing that moves the ring. */
  /* The real endpoint the counsellor screen posts to. An earlier draft of this
     guessed at `/document/passport/status`, which does not exist — so it 404'd,
     and the two checks below were written `ver.ok() ? … : true` and passed
     without testing anything. A check that cannot fail is worse than none. */
  const ver = await admin.request.post(
    BASE + '/api/staff/student/' + sid + '/document/passport',
    { data: { status: 'ok' } });
  ok(ver.ok(), 'a counsellor marks the passport verified — ' + ver.status()
    + ' ' + (await ver.text()).slice(0, 60));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  const done = await read();
  const pass2 = (done || { rows: [] }).rows.find(r => r.name === 'Passport');
  ok(pass2 && pass2.state === 'Verified',
    'and the card says so — ' + JSON.stringify(pass2));
  ok(done && done.pct !== '0%' && done.pct !== '',
    'and the ring moves off zero — ' + (done || {}).pct);
  ok(done && /1 of \d+ verified/.test(done.note),
    'and the sentence under it counts one — ' + (done || {}).note);

  /* ---------------------------------------- and it stays inside its own card */
  const fits = await page.evaluate(() => {
    const c = document.querySelector('#docReady');
    if (!c) return null;
    const cb = c.getBoundingClientRect();
    const chips = [...c.querySelectorAll('.doclist .st')];
    return {
      chips: chips.length,
      inside: chips.every(s => {
        const r = s.getBoundingClientRect();
        return r.right <= cb.right + 1 && r.left >= cb.left - 1;
      }),
      oneLine: chips.every(s => s.getBoundingClientRect().height < 24),
      tall: Math.max(...chips.map(s => Math.round(s.getBoundingClientRect().height))),
    };
  }).catch(() => null);
  ok(fits && fits.chips > 0, 'the card has status chips on it');
  ok(fits && fits.inside, 'none of them crosses the border of the card');
  ok(fits && fits.oneLine,
    'and none wraps onto a second line — tallest ' + (fits || {}).tall + 'px');

  /* On a phone too, which is where a fixed-width chip and a long name meet. */
  const phone = await stu.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(2600);
  const small = await phone.evaluate(() => {
    const c = document.querySelector('#docReady');
    if (!c) return null;
    const cb = c.getBoundingClientRect();
    const chips = [...c.querySelectorAll('.doclist .st')];
    return {
      inside: chips.every(s => s.getBoundingClientRect().right <= cb.right + 1),
      oneLine: chips.every(s => s.getBoundingClientRect().height < 24),
      wide: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  }).catch(() => null);
  ok(small && small.inside, 'on a phone the chips are inside the card too');
  ok(small && small.oneLine, 'and still on one line');
  ok(small && small.wide, 'and the dashboard does not scroll sideways');
  await phone.close();

  /* ------------------------------------------ the funding card, in whole words */
  const cut = await page.evaluate(() => {
    const t = document.body.innerText;
    const bad = ['with the el', 'until disburs', 'follow up on d']
      .filter(s => t.includes(s));
    return { bad, hasCard: /Funding/i.test(t) };
  }).catch(() => null);
  ok(cut && cut.hasCard, 'the funding card is on the dashboard');
  ok(cut && !cut.bad.length,
    'and no description stops in the middle of a word — ' + JSON.stringify(cut && cut.bad));

  /* ------------------------------------------------- the menu says what is waiting */
  const badge = await page.evaluate(() => {
    const d = document.querySelector('.p-nav a[href="messages.html"] .nav-n');
    return d ? d.textContent.trim() : '';
  }).catch(() => '');
  ok(badge && /^\d/.test(badge),
    'the menu carries the unread count — "' + badge + '"');

  ok(!errs.length, 'no page errors on the dashboard — ' + errs.slice(0, 2).join(' | '));

  /* ------------------------------------------- nobody is typing, so nothing says so
   *
   * The real journey: a student opens Messages and types. Nothing about their
   * own keystrokes may come back as somebody else's. */
  const mp = await stu.newPage();
  const mErrs = [];
  mp.on('pageerror', e => mErrs.push(String(e)));
  await mp.goto(BASE + '/messages.html', { waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(2500);

  ok(await seen(mp, '#box'), 'the student has a composer');

  /* Watched WHILE they type, not read afterwards.
   *
   * The line clears itself after 2.5 seconds. An earlier draft typed, waited
   * four seconds and then read the element — by which time the timer had wiped
   * the evidence, so the check passed against the very build it was written to
   * fail on. What is recorded here is whether the line was EVER shown. */
  await mp.evaluate(() => {
    window.__sawTyping = '';
    const el = document.querySelector('#typing');
    if (!el) return;
    new MutationObserver(() => {
      const t = (el.textContent || '').trim();
      if (t) window.__sawTyping = t;
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }).catch(() => {});

  await mp.click('#box').catch(() => {});
  /* Slowly, over more than one ping. The client throttles to one every 1.5s,
     so a fast burst could finish before a single one is sent. */
  await mp.type('#box', 'Checking whether anybody is really there.', { delay: 90 })
    .catch(() => {});
  await mp.waitForTimeout(2500);

  const said = await mp.evaluate(() => window.__sawTyping || '').catch(() => '');
  ok(!/typing/i.test(said || ''),
    'a student typing is never told their counsellor is typing — "'
    + (said || '').trim() + '"');

  /* And the line still works for a real one. A counsellor at the other end
     posts the same hint from the staff screen, and it must arrive. */
  const cEmail = 'svc' + S + '@glovels.com';
  const cPass = 'svc-pass-' + S;
  const madeC = await (await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'View Counsellor', email: cEmail, password: cPass, role: 'counsellor' } })).json();
  const cId = madeC.person ? madeC.person.id : madeC.id;
  await admin.request.put(BASE + '/api/staff/student/' + sid + '/counsellor',
    { data: { counsellorId: cId } });
  const C = await browser.newContext();
  await C.request.post(BASE + '/api/auth/login', { data: { email: cEmail, password: cPass } });
  await C.request.post(BASE + '/api/auth/change',
    { data: { current: cPass, password: cPass + 'X' } });
  await C.request.post(BASE + '/api/auth/login',
    { data: { email: cEmail, password: cPass + 'X' } });

  await mp.reload({ waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(2500);
  await mp.evaluate(() => {
    window.__sawTyping = '';
    const el = document.querySelector('#typing');
    if (!el) return;
    new MutationObserver(() => {
      const t = (el.textContent || '').trim();
      if (t) window.__sawTyping = t;
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }).catch(() => {});
  await C.request.post(BASE + '/api/staff/student/' + sid + '/typing');
  await mp.waitForTimeout(1200);
  const real = await mp.evaluate(() => window.__sawTyping || '').catch(() => '');
  ok(/typing/i.test(real || ''),
    'but a counsellor who really is typing still shows — "' + (real || '').trim() + '"');

  /* ------------------------------------------------------------- "Sent." */
  await mp.fill('#box', 'A question about my shortlist.').catch(() => {});
  await mp.click('#composer button[type="submit"]').catch(() => {});
  await mp.waitForTimeout(1800);
  const body = await mp.innerText('body').catch(() => '');
  ok(!/sees it on their screen straight away/i.test(body),
    'sending does not promise the counsellor is watching');
  ok(/\bSent\b/.test(body), 'and still says it was sent');

  ok(!mErrs.length, 'no page errors on Messages — ' + mErrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
