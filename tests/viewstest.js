/**
 * Patch 277: Organisation, Orders and Users are three screens, one menu line
 * each — and the Orders screen reads agreed → paid → remaining, with dates.
 *
 *   node viewstest.js        (starts its own server on 8277)
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8277, BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null && note !== '' ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const ping = () => new Promise(r => http.get(BASE + '/api/health', x => { x.resume(); r(x.statusCode); }).on('error', () => r(0)));
const S = Date.now();

(async () => {
  const dir = '/tmp/db-views-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off' }) });
  let b;
  try {
    for (let i = 0; i < 80; i++) { await wait(400); if (await ping() === 200) break; }
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + '/login'); await p.fill('#lEmail', 'admin@glovels.com'); await p.fill('#lPass', 'glovels123'); await p.click('#submit-btn'); await p.waitForTimeout(1500);

    /* An order owed in parts, recorded by hand: ₹5,000 of ₹15,000 paid. */
    const A = (m, u, d) => ctx.request[m](BASE + u, d ? { data: d } : undefined).then(async r => ({ status: r.status(), body: await r.json().catch(() => ({})) }));
    const su = await b.newContext();
    await su.request.post(BASE + '/api/auth/signup', { data: { name: 'Owing Student', email: 'owing' + S + '@example.com', phone: '+919876500022', password: 'a-real-password-' + S, terms: true } });
    const me = await (await su.request.get(BASE + '/api/auth/me')).json();
    const made = await A('post', '/api/staff/student/' + me.user.id + '/order', { package: 'Roadmap', grossInr: 15000 }).catch(() => ({}));
    void made;

    const visible = sel => p.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)).catch(() => false);
    const on = () => p.$$eval('.p-nav a.on', as => as.map(a => a.textContent.trim()));

    /* ---- Organisation */
    await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    check('Organisation: the counts and the tabs show', await visible('#kTiles') && await visible('.otabs'));
    check('Organisation: the team is not on it', !(await visible('#teamBlock')));
    check('Organisation: the menu says Organisation', JSON.stringify(await on()) === '["Organisation"]', JSON.stringify(await on()));
    check('Organisation: its Orders tab still works', await p.evaluate(() => { showTab('orders'); return true; }) && await visible('#o-orders'));

    /* ---- Orders, from the menu */
    await p.click('.p-nav a[href="admin.html#orders"]'); await p.waitForTimeout(900);
    check('Orders: the title says so', (await p.textContent('#viewTitle')).trim() === 'Orders & payments');
    check('Orders: the menu says Orders', JSON.stringify(await on()) === '["Orders"]', JSON.stringify(await on()));
    check('Orders: no counts, team or tab bar above the book', !(await visible('#kTiles')) && !(await visible('#teamBlock')) && !(await visible('.otabs')));
    check('Orders: the book is at the top of the page', await p.$eval('#everyOrder', e => e.getBoundingClientRect().top < 320).catch(() => false));
    check('Orders: the totals read Agreed / Paid / Remaining / Refunded',
      /Agreed[\s\S]*Paid[\s\S]*Remaining to be paid[\s\S]*Refunded/.test(await p.textContent('#ordSum')));
    const heads = await p.$$eval('#ordTable thead th', t => t.map(x => x.textContent.trim()));
    check('Orders: columns Agreed, Paid, Remaining', heads.includes('Agreed') && heads.includes('Paid') && heads.includes('Remaining'), heads.join('|'));
    check('Orders: filter chips by where the money stands', /Money remaining/.test(await p.textContent('#ordFilt')) && /Fully paid/.test(await p.textContent('#ordFilt')));
    check('Orders: the payments are on the same screen', await visible('#o-money') && await visible('#everyPayment'));
    const rows = await p.$$eval('#ordRows tr', t => t.map(r => r.textContent));
    if (rows.length && !/No orders yet/.test(rows[0])) {
      check('Orders: each row says when it was placed', rows.every(r => /Placed \d/.test(r)), rows[0].slice(0, 120));
      await p.click('[data-ostate="owe"]'); await p.waitForTimeout(300);
      check('Orders: "Money remaining" shows only orders still owed', (await p.$$eval('#ordRows tr', t => t.map(r => r.textContent))).every(r => /₹[\d,]+/.test(r) && !/Nothing/.test(r) || /No order matches/.test(r)));
      await p.click('[data-ostate="all"]');
    } else check('Orders: an empty book says so', /No orders yet/.test(rows.join('')));

    /* ---- Users */
    await p.click('.p-nav a[href="admin.html#users"]'); await p.waitForTimeout(900);
    check('Users: the title says so', (await p.textContent('#viewTitle')).trim() === 'Users');
    check('Users: the team shows, nothing else', await visible('#teamBlock') && await visible('#addPerson') && !(await visible('#kTiles')) && !(await visible('.otabs')) && !(await visible('#o-orders')));
    check('Users: the menu says Users', JSON.stringify(await on()) === '["Users"]', JSON.stringify(await on()));

    /* ---- back to Organisation */
    await p.click('.p-nav a[href="admin.html"]'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(900);
    check('Organisation again from the menu', await visible('#kTiles') && !(await visible('#teamBlock')));

    /* ---- the menu everywhere has Users for an admin */
    for (const pg of ['counsellor.html', 'ops.html', 'leads.html', 'marketing.html', 'catalogue.html']) {
      await p.goto(BASE + '/' + pg, { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
      check(pg + ': the menu has Orders and Users', await visible('.p-nav a[href="admin.html#users"], nav a[href="admin.html#users"]') && await visible('a[href="admin.html#orders"]'));
    }
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    bad.push('the suite threw: ' + (e && e.stack || e));
  } finally {
    if (b) await b.close().catch(() => {});
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(t => console.log('  ok   ' + t));
  bad.forEach(t => console.log('  FAIL ' + t));
  console.log(ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
