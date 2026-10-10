/* Patch 164 (Q1): a file closed as COMPLETED still signs in, read-only; LEFT shuts it. */
'use strict';
const BASE = 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };
const jar = {};
async function req(as, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, jar[as] ? { Cookie: jar[as] } : {}), body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[as] = sc.split(';')[0];
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) { j = { raw: text }; }
  return { status: r.status, body: j };
}
(async () => {
  const st = Date.now().toString(36);
  await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  const email = 'done' + st + '@ex.example';
  let r = await req('s', 'POST', '/api/auth/signup', { name: 'Done Student', email, phone: '9000012345', password: 'done-' + st + '-pw', acceptedTerms: true });
  ok('a student signs up', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
  const me = (await req('s', 'GET', '/api/auth/me')).body.user || {};
  r = await req('a', 'PUT', '/api/staff/student/' + me.id + '/status', { status: 'completed', note: 'all done' });
  ok('the office closes the file as completed', r.status === 200 && r.body.status === 'completed', r.status);
  r = await req('s', 'GET', '/api/state');
  ok('the existing session still reads the file', r.status === 200);
  r = await req('s2', 'POST', '/api/auth/login', { email, password: 'done-' + st + '-pw' });
  ok('and a fresh sign-in still opens', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
  r = await req('s2', 'GET', '/api/state');
  ok('documents, applications and messages are readable', r.status === 200 && Array.isArray(r.body.msgs || r.body.messages || []));
  r = await req('s2', 'PUT', '/api/profile', { profile: { fullName: 'Changed Name' } });
  ok('but the profile is read-only', r.status === 403 && r.body.completed === true, r.status);
  r = await req('s2', 'POST', '/api/shortlist', { id: 'anything' });
  ok('and so is the shortlist', r.status === 403, r.status);
  r = await req('s2', 'POST', '/api/messages', { body: 'Could you resend my visa letter?' });
  ok('they can still message their counsellor', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
  r = await req('a', 'PUT', '/api/staff/student/' + me.id + '/status', { status: 'left', note: 'moved on' });
  ok('closed as left instead', r.status === 200);
  r = await req('s2', 'GET', '/api/state');
  ok('left signs the session out', r.status === 401, r.status);
  r = await req('s3', 'POST', '/api/auth/login', { email, password: 'done-' + st + '-pw' });
  ok('and a left file does not sign in', r.status === 403 && r.body.closed === 'left', r.status);
  console.log('round164test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
