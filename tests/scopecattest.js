/**
 * Patch 211: a country admin uploads and changes their own country's data
 * only. A Germany admin with the catalogue permission adds, edits, imports
 * and hides German programmes — and is refused for the UK, row by row.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8211;
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const jar = {};
async function req(who, method, path, body, raw) {
  const h = raw ? {} : { 'content-type': 'application/json' };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: raw || (body ? JSON.stringify(body) : undefined) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { j = { raw: text }; }
  return { status: r.status, ok: r.ok, body: j };
}

(async () => {
  const dir = '/tmp/db-scopecat-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) {} }
    await req('admin', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    const pw = 'germany-admin-pw-211';
    const made = await req('admin', 'POST', '/api/staff/people', { name: 'Greta Germany', email: 'greta.de@glovels.com', password: pw,
      role: 'counsellor', manager: true, scope: ['DE'], perms: ['catalogue'] });
    check('a Germany country admin with the catalogue permission is made', made.ok, JSON.stringify(made.body).slice(0, 160));
    await req('greta', 'POST', '/api/auth/login', { email: 'greta.de@glovels.com', password: pw });
    await req('greta', 'POST', '/api/auth/change', { current: pw, password: pw + '-new' });
    await req('greta', 'POST', '/api/auth/login', { email: 'greta.de@glovels.com', password: pw + '-new' });
    const me = (await req('greta', 'GET', '/api/staff/me')).body;
    check('she is a country admin for Germany', me.user && me.user.level === 'country-admin' && (me.user.scope || []).join() === 'DE', JSON.stringify(me.user || me).slice(0, 160));

    const cat = (await req('admin', 'GET', '/api/staff/catalogue')).body;
    const rows = cat.programmes || cat.rows || [];
    const de = rows.find(p => p.country === 'DE'), gb = rows.find(p => p.country === 'GB');
    check('the catalogue has a German and a British programme to work with', !!de && !!gb, rows.length + ' rows');

    const editDe = await req('greta', 'PUT', '/api/staff/programme', Object.assign({}, de, { program: de.program + ' (edited)' }));
    check('she can change a German programme', editDe.ok, JSON.stringify(editDe.body).slice(0, 160));
    const editGb = await req('greta', 'PUT', '/api/staff/programme', Object.assign({}, gb, { program: gb.program + ' (edited)' }));
    check('but not a British one', editGb.status === 403 && /Germany/.test(editGb.body.error || ''), JSON.stringify(editGb.body).slice(0, 160));
    const move = await req('greta', 'PUT', '/api/staff/programme', Object.assign({}, de, { country: 'GB' }));
    check('nor move a German programme to the UK', move.status === 403);
    const addNew = await req('greta', 'PUT', '/api/staff/programme', Object.assign({}, de, { id: '', program: 'Brand New MSc' }));
    check('she can add a German programme', addNew.ok, JSON.stringify(addNew.body).slice(0, 160));
    const addGb = await req('greta', 'PUT', '/api/staff/programme', Object.assign({}, gb, { id: '', program: 'Sneaky MSc' }));
    check('but not a British one', addGb.status === 403);
    check('she cannot delete a British programme', (await req('greta', 'DELETE', '/api/staff/programme/' + encodeURIComponent(gb.id))).status === 403);
    check('she cannot change the UK destination', (await req('greta', 'PUT', '/api/staff/country', { code: 'GB', name: 'United Kingdom' })).status === 403);
    const slugOf = p => String(p.university || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const uniGb = await req('greta', 'PUT', '/api/staff/university/' + (gb.uKey || gb.universitySlug || slugOf(gb)), { about: 'x' });
    check('nor write a British university page', uniGb.status === 403 || uniGb.status === 404, String(uniGb.status));
    const bulk = await req('greta', 'POST', '/api/staff/programmes/bulk', { ids: [de.id, gb.id], action: 'search' });
    check('a bulk change skips the British row', bulk.ok && bulk.body.outOfScope === 1, JSON.stringify(bulk.body).slice(0, 160));

    /* An import: a German row and a British row. */
    const exp = await fetch(BASE + '/api/staff/catalogue.csv', { headers: { cookie: jar.admin } });
    const csv = await exp.text();
    const lines = csv.split(/\r?\n/);
    const head = lines[0];
    const deLine = lines.find(l => l.includes(',DE,') || /(^|,)"?DE"?(,|$)/.test(l));
    const gbLine = lines.find(l => /(^|,)"?GB"?(,|$)/.test(l));
    const fd = new FormData();
    fd.append('file', new Blob([[head, deLine, gbLine].join('\n')], { type: 'text/csv' }), 'mine.csv');
    const imp = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.greta }, body: fd });
    const ij = await imp.json();
    const rej = (ij.plan && ij.plan.rejected) || [];
    check('her sheet\'s British row is refused, line by line', rej.some(r => (r.why || []).join(' ').includes('not one of your countries')), JSON.stringify(ij).slice(0, 240));
    check('and the German row is not', !rej.some(r => (r.why || []).join(' ').includes('DE is not')));

    /* An administrator is unchanged. */
    const adm = await req('admin', 'PUT', '/api/staff/programme', Object.assign({}, gb, { program: gb.program + ' (admin)' }));
    check('an administrator still changes any country', adm.ok);
    await req('kav', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
    check('a counsellor without the permission still cannot', (await req('kav', 'PUT', '/api/staff/programme', de)).status === 403);

    /* The screen says it. */
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.addCookies(jar.greta.split('; ').map(c => ({ name: c.split('=')[0], value: c.split('=').slice(1).join('='), url: BASE })));
    const p = await ctx.newPage();
    await p.goto(BASE + '/catalogue', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    check('the Catalogue screen tells her which countries are hers', /Your countries:.*Germany/.test(await p.textContent('.scope-note').catch(() => '')));
    await p.screenshot({ path: '/tmp/scopecat.png', clip: { x: 0, y: 0, width: 1300, height: 300 } });
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nscopecattest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
