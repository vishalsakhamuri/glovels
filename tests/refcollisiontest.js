/**
 * FIX (3 Nov e2e run): order references do not collide.
 *
 * A reference was "GLV-" + a random four-digit number — 9,000 values on a
 * UNIQUE column. By the birthday problem, 400 orders collide with a
 * probability over 99.99%, and the 150th order of the hundred-student
 * simulation did: INSERT failed with "UNIQUE constraint failed:
 * orders.reference" and the buyer saw "Something went wrong on the server"
 * at the checkout. Now a reference is checked against the book before it is
 * used (longer ones are drawn when the short ones run thin), so every one of
 * the 420 orders here is placed and every reference is unique.
 *
 *     node tests/refcollisiontest.js        (boots its own server on 8229)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8229);
const BASE = 'http://localhost:' + PORT;
const DIR = '/tmp/db-refs-' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null && !pass ? ' — ' + String(note).slice(0, 200) : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* booting */ } }
    const r0 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
    const cookie = (r0.headers.getSetCookie ? r0.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    check('admin signs in', r0.ok, r0.status);
    /* One student; the office raises 420 orders on their file — the same
       placeOrder() the checkout uses, without the ten-an-hour checkout limit. */
    const mk = await fetch(BASE + '/api/staff/people', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Reference Volume', email: 'refs@glv-sim.in', password: 'Refs-12345!', role: 'student' }) });
    const sid = ((await mk.json()).person || {}).id;
    check('a student to order for', !!sid);
    const refs = [];
    let failed = 0, firstError = '';
    for (let i = 0; i < 420; i++) {
      const r = await fetch(BASE + '/api/staff/student/' + sid + '/order', { method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ services: [{ id: 'cv' }], note: 'volume ' + i }) });
      let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
      if (r.ok && j.order && j.order.reference) refs.push(j.order.reference);
      else { failed++; if (!firstError) firstError = r.status + ' ' + JSON.stringify(j).slice(0, 120); }
    }
    check('all 420 orders were placed (none refused by a reference collision)', failed === 0, failed + ' failed; first: ' + firstError);
    check('every reference is unique', new Set(refs).size === refs.length, (refs.length - new Set(refs).size) + ' duplicates');
    check('every reference is GLV-<digits>', refs.every(r => /^GLV-\d{4,}$/.test(r)), refs.find(r => !/^GLV-\d{4,}$/.test(r)));
    const book = await (await fetch(BASE + '/api/staff/orders', { headers: { cookie } })).json();
    check('the order book holds them all', (book.orders || []).length >= 420, (book.orders || []).length);
  } catch (e) {
    bad.push('crashed: ' + e.message);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nrefcollisiontest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
