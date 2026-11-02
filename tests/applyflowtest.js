/* Patch 232: a guest picks a private university, makes a login on the same
   screen and the university is on their list; then, signed in, adds another
   after one confirmation. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let bad = 0; const check = (n, ok, note) => { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || note == null ? '' : ' — ' + note)); if (!ok) bad++; };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(1200);
  await p.selectOption('#fCountry', 'DE'); await p.selectOption('#fLevel', 'master'); await p.fill('#fCgpa', '8'); await p.click('#fGo'); await p.waitForTimeout(1800);
  const btns = await p.$$('[data-apply]'); check('there are private universities to pick', btns.length >= 2, btns.length);
  await btns[0].click(); await p.waitForTimeout(700);
  check('the next screen offers a login or a call back', await p.isVisible('[data-ap="login"]') && await p.isVisible('[data-ap="call"]'));
  check('with a country code on the mobile box', await p.isVisible('#apCc'));
  await p.fill('#apName', 'Kiran Rao'); await p.fill('#apPhone', '9812312312'); await p.fill('#apMail', 'kiran' + Date.now() + '@example.com');
  await p.fill('#apPw', 'Kiran12345!'); await p.check('#apOk'); await p.click('#apGo'); await p.waitForTimeout(2500);
  check('the login is made and the university added', /with us/i.test(await p.textContent('#buyT')), await p.textContent('#buyT'));
  await p.click('#applyBack').catch(() => {}); await p.waitForTimeout(400);
  await (await p.$$('[data-apply]'))[1].click(); await p.waitForTimeout(600);
  check('signed in, it asks before adding the next', /Add this university to your profile/i.test(await p.textContent('#buyT')));
  await p.click('#addYes'); await p.waitForTimeout(2000);
  const st = await p.evaluate(async () => { const s = await (await fetch('/api/state')).json(); return { short: (s.shortlist || []).length, prof: s.profile || {} }; });
  check('both are on their list', st.short === 2, st.short);
  check('their finder answers are in their profile', st.prof.g_country === 'Germany' && st.prof.d_cgpa === '8', JSON.stringify(st.prof).slice(0, 120));
  check('no page errors', errs.length === 0, errs.join('; '));
  console.log(bad ? bad + ' failed' : 'applyflowtest: all passed'); await b.close(); process.exit(bad ? 1 : 0);
})();
