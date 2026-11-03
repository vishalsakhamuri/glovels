/**
 * FIX (3 Nov e2e run): a counsellor can correct a student's profile.
 *
 * PUT /api/staff/student/:id/profile {profile:{…}} — the student's own merge
 * and bounds (a CGPA of 47.9 is refused, not stored), only for a student the
 * caller may see, only on an open file; the student is told in the thread
 * which boxes changed, and the machine's picks are re-run.
 *
 *     node tests/staffprofiletest.js         (boots its own server on 8226)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8226);
const BASE = 'http://localhost:' + PORT;
const DIR = '/tmp/db-staffprofile-' + PORT;
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c || note == null ? '' : ' — ' + String(note).slice(0, 220))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;
const jars = {};
async function req(who, method, p, body) {
  const h = { 'content-type': 'application/json' };
  if (jars[who]) h.cookie = jars[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jars[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, ok: r.ok, body: j };
}

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* booting */ } }
    await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    const c1 = (await req('a', 'POST', '/api/staff/people', { name: 'Ravi Shankar', email: 'ravi.pf@glv-sim.in', password: 'Counsel-1-pass!', role: 'counsellor' })).body.person;
    const c2 = (await req('a', 'POST', '/api/staff/people', { name: 'Deepa Nair', email: 'deepa.pf@glv-sim.in', password: 'Counsel-2-pass!', role: 'counsellor' })).body.person;
    for (const [who, c, pw] of [['c1', c1, 'Counsel-1-pass!'], ['c2', c2, 'Counsel-2-pass!']]) {
      await req(who, 'POST', '/api/auth/login', { email: c.email, password: pw });
      await req(who, 'POST', '/api/auth/change', { password: pw + 'X' });
      await req(who, 'POST', '/api/auth/login', { email: c.email, password: pw + 'X' });
    }
    const su = await req('s', 'POST', '/api/auth/signup', { name: 'Ananya Reddy', email: 'ananya.pf@glv-sim.in', phone: '9100000111', password: 'Student-12345', terms: true });
    const sid = su.body.user && su.body.user.id;
    check('a student signs up', !!sid, J(su.body));
    await req('s', 'PUT', '/api/profile', { profile: { firstName: 'Ananya', lastName: 'Reddy', g_country: 'Germany', g_level: 'master', g_field: 'Computer Science & IT', d_cgpa: '7.8', e_test: 'ielts', e_score: '6.5' } });
    await req('a', 'PUT', '/api/staff/student/' + sid + '/counsellor', { counsellorId: c1.id });

    const P = (who, body) => req(who, 'PUT', '/api/staff/student/' + sid + '/profile', body);
    let r = await P('c2', { profile: { d_cgpa: '8.7' } });
    check('a counsellor who does not hold the file is refused (403)', r.status === 403, r.status);
    r = await P('c1', { profile: { d_cgpa: '47.9' } });
    check('a CGPA of 47.9 is refused (422), not stored', r.status === 422 && /CGPA|grade|scale/i.test(r.body.error || ''), r.status + ' ' + J(r.body).slice(0, 160));
    r = await P('c1', { profile: 'x' });
    check('a body that is not a profile is refused (422)', r.status === 422, r.status);
    r = await P('c1', { profile: { d_cgpa: '8.7', e_score: '7.0', g_country: 'Ireland' } });
    check('the student’s counsellor corrects the CGPA, the IELTS score and the destination', r.ok && r.body.changed && r.body.changed.length === 3, r.status + ' ' + J(r.body).slice(0, 200));
    const file = (await req('c1', 'GET', '/api/staff/student/' + sid)).body;
    check('the file shows the corrected values', file.profile && file.profile.d_cgpa === '8.7' && file.profile.e_score === '7.0' && file.profile.g_country === 'Ireland', J(file.profile).slice(0, 200));
    const st = (await req('s', 'GET', '/api/state')).body;
    check('the student sees them too, and the rest of the profile is untouched', st.profile.d_cgpa === '8.7' && st.profile.g_level === 'master' && st.profile.firstName === 'Ananya', J(st.profile).slice(0, 200));
    check('the student is told on their timeline which boxes changed, in the counsellor’s name', (st.activity || []).some(m => /updated your profile/.test(m.t || '') && /d_cgpa/.test(m.t || '') && /Ravi/.test(m.from || '')), J((st.activity || []).slice(0, 1)).slice(0, 200));
    r = await P('c1', { profile: { d_cgpa: '8.7' } });
    check('saving the same value again changes nothing and says so', r.ok && r.body.changed.length === 0, J(r.body.changed));
    r = await P('a', { profile: { firstName: '' } });
    check('clearing the first name is refused (422)', r.status === 422, r.status);
    await req('a', 'PUT', '/api/staff/student/' + sid + '/status', { status: 'completed', note: 'done' });
    r = await P('a', { profile: { d_cgpa: '9.0' } });
    check('a closed file is read-only (409)', r.status === 409 && r.body.closed, r.status + ' ' + J(r.body));
  } catch (e) {
    check('ran', false, e.stack);
  } finally {
    try { process.kill(-child.pid); } catch (x) { /* gone */ }
  }
  console.log('\nstaffprofiletest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
