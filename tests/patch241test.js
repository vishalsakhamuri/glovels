/* Patch 241: student portal fixes from the 2 Nov QA run. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let bad = 0; const check = (n, ok, note) => { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || note == null ? '' : ' — ' + note)); if (!ok) bad++; };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  /* A student made the way a visitor makes one: Apply free, then a login. */
  await p.goto(BASE + '/'); await p.waitForTimeout(1200);
  await p.selectOption('#fCountry', 'DE'); await p.selectOption('#fLevel', 'master'); await p.fill('#fCgpa', '8'); await p.click('#fGo'); await p.waitForTimeout(1800);
  await (await p.$$('[data-apply]'))[0].click(); await p.waitForTimeout(700);
  await p.fill('#apName', 'Meera Das'); await p.fill('#apPhone', '9812312399'); await p.fill('#apMail', 'meera' + Date.now() + '@example.com');
  await p.fill('#apPw', 'Meera12345!'); await p.check('#apOk'); await p.click('#apGo'); await p.waitForTimeout(2500);

  /* One impossible box does not block the rest of the save. */
  const r = await p.evaluate(async () => {
    const res = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { g_city: 'Munich', e_test: 'IELTS', e_score: '7.3' } }) });
    const body = await res.json();
    const s = await (await fetch('/api/state')).json();
    return { status: res.status, body, prof: s.profile || {} };
  });
  check('IELTS 7.3 is refused', r.status === 422 && /halves/.test(r.body.error || ''), JSON.stringify(r.body));
  check('and the rest of the save is kept', r.body.keptRest === true && r.prof.g_city === 'Munich', JSON.stringify(r.prof).slice(0, 160));
  check('the refused box is not stored', r.prof.e_score !== '7.3', r.prof.e_score);

  /* Dashboard: no "Welcome back" for somebody new, and links open Goals. */
  await p.goto(BASE + '/dashboard'); await p.waitForTimeout(2200);
  const hello = await p.textContent('#hello');
  check('the dashboard greets without "back"', /^Welcome/.test(hello) && !/back/i.test(hello), hello);
  check('no "Eleven short sections"', !/Eleven short sections/.test(await p.textContent('body')));
  const goalsLinks = await p.$$eval('a[href*="sec=goals"]', a => a.length);
  check('the answers links open the Goals section', goalsLinks >= 1, goalsLinks);

  /* Profile: ?sec=goals opens Goals; Account has a change-password link. */
  await p.goto(BASE + '/profile?sec=goals'); await p.waitForTimeout(1800);
  const head = await p.evaluate(() => { const h = document.querySelector('#pForm h3'); return h ? h.textContent : ''; });
  check('profile opens on Goals', /Goals/i.test(head), head);
  check('Account has a change-password link', await p.$('#pwChange') != null);
  await p.goto(BASE + '/login?change=1&mine=1&next=profile.html'); await p.waitForTimeout(1500);
  check('it opens a "Change your password" screen', /Change your password/.test(await p.textContent('#form-title')), await p.textContent('#form-title'));

  /* Applications: the university they added waits for the counsellor. */
  await p.goto(BASE + '/applications'); await p.waitForTimeout(2000);
  check('a self-added university is not counted as in prep', (await p.textContent('#kPrep')).trim() === '0', await p.textContent('#kPrep'));
  check('and says the counsellor will confirm it', /counsellor will confirm/.test(await p.textContent('#appList')));

  /* Checkout prefill: the stored +91 number is not shown with the code twice. */
  await p.goto(BASE + '/'); await p.waitForTimeout(1500);
  const ph = await p.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div class="phone-row" id="t241">' + window.glvCcSelect('t241cc') + '<input id="t241ph"></div>');
    window.glvPutPhone('#t241ph', 't241cc', '+919812312399');
    return document.getElementById('t241cc').value + '|' + document.getElementById('t241ph').value;
  });
  check('a stored +91 number splits into code and number', ph === '+91|9812312399', ph);

  /* A student who opens a staff screen is told it is not theirs. */
  for (const pg of ['/marketing', '/ops', '/leads-command']) {
    await p.goto(BASE + pg); await p.waitForTimeout(1500);
    const t = await p.evaluate(() => { const a = document.querySelector('[role=alert]'); return a ? a.textContent : ''; });
    check('a student on ' + pg + ' is told it is not for them', /not for your account/.test(t), t);
  }
  errs.length = 0;
  check('no page errors', errs.length === 0, errs.join('; '));
  console.log(bad ? bad + ' failed' : 'patch241test: all passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
