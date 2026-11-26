/**
 * Patch 314 (owner, 26 Nov 2026): "university view and edit should be different
 * roles — they should be able to view, search but cannot edit."
 *
 * Two permissions: catalogue-view opens the Catalogue screen to look things up,
 * catalogue changes it (and carries view). Until now every counsellor had view
 * with no tick box; each is given it once so nobody loses it on the day.
 *
 *   node catalogueviewtest.js        (starts its own server on 8314; needs playwright for the screen checks)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8314);
const BASE = 'http://localhost:' + PORT;
const DIR = '/tmp/db-catview-' + PORT;
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; if (!c) console.log('  ✗ ' + n + (note == null ? '' : ' — ' + String(note).slice(0, 260))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const jars = {};
async function req(who, method, p, body) {
  const h = { 'content-type': 'application/json' };
  if (jars[who]) h.cookie = jars[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jars[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) { j = { text }; }
  return { status: r.status, body: j };
}
(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', BOTGATE: 'off' }) });
  try {
    for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* booting */ } }
    await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    await req('c', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
    const perms = async who => ((await req(who, 'GET', '/api/staff/me')).body.user || {}).perms || [];
    const people = (await req('a', 'GET', '/api/staff/people')).body.people || [];
    const kavya = people.find(p => p.email === 'kavya@glovels.com');
    check('a counsellor who was there before keeps looking things up: view is given once, edit is not', (await perms('c')).includes('catalogue-view') && !(await perms('c')).includes('catalogue'), JSON.stringify(await perms('c')));
    check('an administrator has both', (await perms('a')).includes('catalogue-view') && (await perms('a')).includes('catalogue'));
    const slug = ((await req('c', 'GET', '/api/staff/catalogue/ids')).body.universities || [])[0];
    check('with view only, changing a university is refused', (await req('c', 'PUT', '/api/staff/programme', { id: 'x', title: 'x' })).status === 403 && (await req('c', 'GET', '/api/staff/catalogue.xlsx')).status === 403);
    let r = await req('a', 'PUT', '/api/staff/people/' + kavya.id + '/perms', { perms: ['catalogue'] });
    check('edit carries view', r.status === 200 && String(r.body.perms).includes('catalogue-view') && (await perms('c')).includes('catalogue') && (await perms('c')).includes('catalogue-view'), JSON.stringify(r.body));
    r = await req('a', 'PUT', '/api/staff/people/' + kavya.id + '/perms', { perms: [] });
    check('both can be taken away', r.status === 200 && !(await perms('c')).includes('catalogue-view') && !(await perms('c')).includes('catalogue'), JSON.stringify(await perms('c')));
    const n1 = await req('a', 'POST', '/api/staff/people', { name: 'New One', email: 'new1@glv-sim.in', password: 'Office-12345!', role: 'counsellor' });
    const n2 = await req('a', 'POST', '/api/staff/people', { name: 'New Two', email: 'new2@glv-sim.in', password: 'Office-12345!', role: 'counsellor', perms: [] });
    const n3 = await req('a', 'POST', '/api/staff/people', { name: 'New Ed', email: 'new3@glv-sim.in', password: 'Office-12345!', role: 'editor', perms: ['catalogue-view'] });
    check('a new counsellor can look things up unless told otherwise; an editor can be given view alone', (n1.body.person.perms || []).includes('catalogue-view') && !(n2.body.person.perms || []).includes('catalogue-view') && (n3.body.person.perms || []).includes('catalogue-view') && !(n3.body.person.perms || []).includes('catalogue'), JSON.stringify([n1.body.person.perms, n2.body.person.perms, n3.body.person.perms]));

    /* ---- the screens ---- */
    let chromium = null; try { chromium = require('playwright').chromium; } catch (e) { console.log('  (playwright not found: the screen checks are skipped)'); }
    if (chromium) {
      const b = await chromium.launch();
      const open = async (email) => {
        const ctx = await b.newContext({ viewport: { width: 1366, height: 800 } }); const p = await ctx.newPage(); p.setDefaultTimeout(8000);
        await p.route(/fonts\.(googleapis|gstatic)\.com/, x => x.abort());
        await p.request.post(BASE + '/api/auth/login', { data: { email, password: 'glovels123' } });
        return { ctx, p };
      };
      /* neither */
      let s = await open('kavya@glovels.com');
      await s.p.goto(BASE + '/catalogue', { waitUntil: 'load' }); await s.p.waitForTimeout(1800);
      check('with neither, the Catalogue screen says so and lists nothing', /not switched on for your account/.test(await s.p.locator('.p-main').innerText()) && (await s.p.locator('#progRows tr').count()) === 0, (await s.p.locator('.p-main').innerText()).slice(0, 120));
      await s.p.goto(BASE + '/counsellor', { waitUntil: 'load' }); await s.p.waitForTimeout(1500);
      check('…and the menu has no Catalogue link', (await s.p.locator('.p-nav a[href="catalogue.html"]:visible').count()) === 0);
      await s.ctx.close();
      /* view */
      await req('a', 'PUT', '/api/staff/people/' + kavya.id + '/perms', { perms: ['catalogue-view'] });
      s = await open('kavya@glovels.com');
      await s.p.goto(BASE + '/counsellor', { waitUntil: 'load' }); await s.p.waitForTimeout(1500);
      check('with view, the menu has the Catalogue link', (await s.p.locator('.p-nav a[href="catalogue.html"]:visible').count()) === 1);
      await s.p.goto(BASE + '/catalogue', { waitUntil: 'load' }); await s.p.waitForTimeout(2500);
      const rows = await s.p.locator('#progRows tr').count();
      check('with view, the list loads', rows > 0, rows);
      check('…read-only: no Add, no edit buttons, no spreadsheet tab, and the note says which switch is on', (await s.p.evaluate(() => document.body.classList.contains('read-only'))) && !(await s.p.locator('#addProg').isVisible()) && (await s.p.locator('#progRows [data-edit]:visible').count()) === 0 && !(await s.p.locator('.tab[data-t="sheet"]').isVisible()) && /Universities: view/.test(await s.p.locator('.ro-note').first().innerText()));
      const first = ((await s.p.locator('#progRows tr').first().innerText()) || '').split(/\s+/).find(w => w.length > 4) || 'university';
      await s.p.fill('#q', first); await s.p.waitForTimeout(1500);
      const found = await s.p.locator('#progRows tr').count();
      await s.p.fill('#q', 'zzzz-no-such-thing-zzzz'); await s.p.waitForTimeout(1500);
      const none = await s.p.locator('#progRows tr').filter({ hasText: /zzzz/ }).count();
      check('…and search works', found > 0 && none === 0, first + ' ' + found);
      await s.ctx.close();
      /* edit */
      await req('a', 'PUT', '/api/staff/people/' + kavya.id + '/perms', { perms: ['catalogue'] });
      s = await open('kavya@glovels.com');
      await s.p.goto(BASE + '/catalogue', { waitUntil: 'load' }); await s.p.waitForTimeout(2500);
      check('with edit, the same screen can change things', !(await s.p.evaluate(() => document.body.classList.contains('read-only'))) && (await s.p.locator('#addProg').isVisible()));
      await s.ctx.close();
      /* the Organisation screen */
      s = await open('admin@glovels.com');
      await s.p.goto(BASE + '/admin#users', { waitUntil: 'load' }); await s.p.waitForTimeout(2500);
      const view = s.p.locator('[data-perm="' + kavya.id + '"][data-key="catalogue-view"]'), ed = s.p.locator('[data-perm="' + kavya.id + '"][data-key="catalogue"]');
      check('the Organisation screen has two switches: Universities: view and Universities: edit', (await view.count()) === 1 && (await ed.count()) === 1 && /Universities: view/.test(await view.innerText()) && /Universities: edit/.test(await ed.innerText()), (await view.count()) + ' ' + (await ed.count()));
      await view.click(); await s.p.waitForTimeout(1500);
      check('switching view off takes edit with it', !(await perms('c')).includes('catalogue-view') && !(await perms('c')).includes('catalogue'), JSON.stringify(await perms('c')));
      await s.p.locator('[data-perm="' + kavya.id + '"][data-key="catalogue"]').click(); await s.p.waitForTimeout(1500);
      check('switching edit on brings view', (await perms('c')).includes('catalogue-view') && (await perms('c')).includes('catalogue'), JSON.stringify(await perms('c')));
      await s.ctx.close(); await b.close();
    }
  } catch (e) { fail++; console.log('  ✗ test crashed — ' + (e && e.stack || e)); }
  try { process.kill(-child.pid); } catch (e) { /* gone */ }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
