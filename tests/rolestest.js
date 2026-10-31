/**
 * Patch 201: who is what — super admins, admins, country admins, country
 * counsellors, and employee / external / B2B.
 *
 * Boots its own server on a fresh database. Checks the rules the owner set:
 * only a super admin makes admins, sees money and takes exports; a country
 * admin sees every student going to their countries and nobody else, and none
 * of the office-wide screens; a student going to Germany is given to the
 * Germany counsellor; the last super admin cannot be removed.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8201;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out.slice(0, 80) }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts && opts.body) req.write(JSON.stringify(opts.body));
  req.end();
});
const cookieOf = r => String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
const login = async (email, password) => cookieOf(await call('/api/auth/login', { method: 'POST', body: { email, password } }));
const as = c => ({ Cookie: c });

/* A staff account made with a known password: create, then sign in and set
   the password the must-change screen asks for. */
async function staff(adminC, body) {
  const r = await call('/api/staff/people', { method: 'POST', headers: as(adminC), body });
  if (r.status !== 200) return { r };
  const pw = 'Strong-pass-' + Math.random().toString(36).slice(2, 8);
  let c = await login(body.email, r.body.password);
  await call('/api/auth/change', { method: 'POST', headers: as(c), body: { current: r.body.password, password: pw } });
  c = await login(body.email, pw);
  return { r, c, id: r.body.person.id };
}
async function student(name, country) {
  const email = name.toLowerCase().replace(/\W+/g, '') + Date.now() + '@example.com';
  const su = await call('/api/auth/signup', { method: 'POST', body: { name, email, password: 'student-pass-1', terms: true } });
  const c = cookieOf(su);
  await call('/api/profile', { method: 'PUT', headers: as(c), body: { profile: { fullName: name, g_country: country, g_level: "Master's", g_field: 'Computer Science' } } });
  return { c, id: su.body && su.body.user ? su.body.user.id : (su.body.id || null), email };
}

(async () => {
  const dir = '/tmp/db-roles-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }

    const boss = await login('admin@glovels.com', 'glovels123');
    const people = await call('/api/staff/people', { headers: as(boss) });
    const me = (people.body.people || []).find(p => p.email === 'admin@glovels.com');
    check('the existing administrator is a super admin after the upgrade', me && me.level === 'super', me && me.level);
    check('the country list comes with the team', (people.body.countries || []).length > 200);

    /* A plain administrator. */
    const adm = await staff(boss, { name: 'Ravi Admin', email: 'ravi.admin@glovels.test', role: 'admin', kind: 'employee' });
    check('a super admin can add an administrator', adm.r.status === 200, String(adm.r.status));
    const p2 = (await call('/api/staff/people', { headers: as(boss) })).body.people.find(p => p.email === 'ravi.admin@glovels.test');
    check('and they are an administrator, not a super admin', p2 && p2.level === 'admin', p2 && p2.level);

    const tryAdmin = await call('/api/staff/people', { method: 'POST', headers: as(adm.c), body: { name: 'X', email: 'x.admin@glovels.test', role: 'admin' } });
    check('a plain administrator cannot add an administrator', tryAdmin.status === 403, String(tryAdmin.status));
    const trySuper = await call('/api/staff/people', { method: 'POST', headers: as(adm.c), body: { name: 'Y', email: 'y.admin@glovels.test', role: 'admin', super: true } });
    check('nor a super admin', trySuper.status === 403, String(trySuper.status));
    check('a plain administrator cannot see the money', (await call('/api/staff/money', { headers: as(adm.c) })).status === 403);
    check('nor download a backup', (await call('/api/staff/backup.tar', { headers: as(adm.c) })).status === 403);
    check('nor export the catalogue', (await call('/api/staff/catalogue.csv', { headers: as(adm.c) })).status === 403);
    check('the super admin can', (await call('/api/staff/money', { headers: as(boss) })).status === 200);
    const ext = await staff(adm.c, { name: 'Esha External', email: 'esha.ext@glovels.test', role: 'counsellor', kind: 'external' });
    check('a plain administrator can still add a counsellor', ext.r.status === 200, String(ext.r.status));

    /* A Germany country admin and a Germany counsellor. */
    const noCountry = await call('/api/staff/people', { method: 'POST', headers: as(boss), body: { name: 'Z', email: 'z.ca@glovels.test', role: 'counsellor', manager: true, scope: [] } });
    check('a country admin needs a country', noCountry.status === 422, String(noCountry.status));
    const deAdmin = await staff(boss, { name: 'Greta Germany', email: 'greta.de@glovels.test', role: 'counsellor', manager: true, scope: ['DE'], kind: 'employee' });
    check('a Germany country admin is created', deAdmin.r.status === 200, String(deAdmin.r.status));
    const deCoun = await staff(boss, { name: 'Dev Germany', email: 'dev.de@glovels.test', role: 'counsellor', scope: ['DE'], kind: 'external' });
    const list = (await call('/api/staff/people', { headers: as(boss) })).body.people;
    const g = list.find(p => p.email === 'greta.de@glovels.test');
    const d = list.find(p => p.email === 'dev.de@glovels.test');
    check('she reads as a country admin for Germany', g && g.level === 'country-admin' && g.scope.join() === 'DE', JSON.stringify(g && [g.level, g.scope]));
    check('he reads as an external counsellor for Germany', d && d.level === 'counsellor' && d.kind === 'external' && d.scope.join() === 'DE');

    /* Two students: one going to Germany, one to Canada. */
    const sDe = await student('Anika Germany', 'Germany');
    const sCa = await student('Carl Canada', 'Canada');
    const all = (await call('/api/staff/students', { headers: as(boss) })).body;
    const rowsAll = all.students || [];
    const idDe = (rowsAll.find(r => /Anika/.test(r.name)) || {}).id;
    const idCa = (rowsAll.find(r => /Carl/.test(r.name)) || {}).id;
    check('both students exist', !!idDe && !!idCa, idDe + '/' + idCa);

    const gList = (await call('/api/staff/students', { headers: as(deAdmin.c) })).body;
    const gRows = gList.students || [];
    check('the Germany admin sees the student going to Germany', gRows.some(r => r.id === idDe));
    check('and not the one going to Canada', !gRows.some(r => r.id === idCa));
    check('she can open the Germany file', (await call('/api/staff/student/' + idDe, { headers: as(deAdmin.c) })).status === 200);
    const caOpen = await call('/api/staff/student/' + idCa, { headers: as(deAdmin.c) });
    check('she cannot open the Canada file', caOpen.status === 403 || caOpen.status === 404, String(caOpen.status));
    check('nor any office-wide screen', (await call('/api/staff/overview', { headers: as(deAdmin.c) })).status === 403
      && (await call('/api/staff/people', { headers: as(deAdmin.c) })).status === 403
      && (await call('/api/staff/money', { headers: as(deAdmin.c) })).status === 403);
    const board = await call('/api/staff/command', { headers: as(deAdmin.c) });
    check('her command centre is her countries only', board.status === 200 && board.body.headline.students >= 1
      && !(JSON.stringify(board.body).includes('Carl Canada')), String(board.body.headline && board.body.headline.students));
    const plain = (await call('/api/staff/students', { headers: as(deCoun.c) })).body;
    const pRows = plain.students || [];
    check('a plain Germany counsellor sees only students given to them', !pRows.some(r => r.id === idDe));

    /* A purchase by the Germany student goes to the Germany counsellor. */
    await call('/api/orders', { method: 'POST', headers: as(sDe.c), body: { packageId: 'pkg-roadmap', acceptedTerms: true, phone: '9812345678' } });
    const after = (await call('/api/staff/students', { headers: as(boss) })).body;
    const rowDe = (after.students || []).find(r => r.id === idDe) || {};
    const who = rowDe.counsellor || rowDe.counsellorId || rowDe.counsellor_id;
    check('a student going to Germany is given to a Germany counsellor', JSON.stringify(rowDe).match(/Dev Germany|Greta Germany/) || [deCoun.id, deAdmin.id].includes(Number(who && who.id || who)),
      JSON.stringify(who));

    /* The type and countries change in one place. */
    const shape = await call('/api/staff/people/' + deCoun.id + '/shape', { method: 'PUT', headers: as(boss), body: { kind: 'employee', scope: ['DE', 'AT'] } });
    check('type and countries can be changed', shape.status === 200 && shape.body.person.kind === 'employee' && shape.body.person.scope.join() === 'DE,AT', JSON.stringify(shape.body));

    /* There is always a super admin. */
    const meId = me.id;
    const demote = await call('/api/staff/people/' + meId + '/shape', { method: 'PUT', headers: as(boss), body: { level: 'admin' } });
    check('the last super admin cannot be demoted', demote.status === 409, String(demote.status));
    const promote = await call('/api/staff/people/' + adm.id + '/shape', { method: 'PUT', headers: as(adm.c), body: { level: 'super' } });
    check('an administrator cannot make themself super', promote.status === 403, String(promote.status));
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nrolestest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
