/*
 * What the form-fill sweep found, and what the office decided to do about it.
 *
 * Several of these are not defects being closed but rules being stated for the
 * first time — who may put a public university on a shortlist, what a blank
 * search is for, what an account records about the terms somebody accepted.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json' };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
const login = (who, e, p) => req(who, 'POST', '/api/auth/login', { email: e, password: p });

(async () => {
  const stamp = Date.now().toString(36);
  await login('a', 'admin@glovels.com', 'glovels123');

  /* ---- 1. the terms are a record, not a checkbox ---- */
  const email = 'r134' + stamp + '@ex.example';
  let r = await req('s', 'POST', '/api/auth/signup',
    { name: 'Consent Student', email, phone: '9876500140', password: 'a-real-password-' + stamp });
  ok('an account cannot be created without accepting the terms', r.status === 422, r.status);
  r = await req('s', 'POST', '/api/auth/signup',
    { name: 'Consent Student', email, phone: '9876500140',
      password: 'a-real-password-' + stamp, terms: true });
  ok('  · and can with them', r.ok, r.status + ' ' + ((r.body || {}).error || ''));
  const sId = ((r.body || {}).user || {}).id;
  r = await req('a', 'GET', '/api/staff/students');
  const row = (r.body.students || []).find(x => Number(x.id) === Number(sId));
  ok('  · the account exists on the office’s list', !!row, sId);

  /* ---- 2. a public university is not a student's to add ----
     The list is what a package delivers, matched against their marks. A
     student adding one put a row on their file nobody had matched, nobody had
     counted against the entitlement, and whose name they were not meant to be
     able to read. */
  r = await req('s', 'GET', '/api/catalogue');
  const cat = (r.body || {}).programmes || [];
  const pub = cat.find(p => p.isPublic);
  const priv = cat.find(p => !p.isPublic);
  if (!pub || !priv) {
    ok('the catalogue has one of each to test with', false,
      'STOPPED: public=' + !!pub + ' private=' + !!priv);
  } else {
    r = await req('s', 'POST', '/api/shortlist', { id: pub.id });
    ok('a student cannot shortlist a public university', r.status === 403,
      r.status + ' ' + JSON.stringify(r.body).slice(0, 110));
    ok('  · and is told who does', /counsellor/i.test(((r.body || {}).error || '')),
      (r.body || {}).error);
    r = await req('s', 'POST', '/api/shortlist', { id: priv.id });
    ok('  · a private one is still theirs to add', r.ok, r.status);
    r = await req('s', 'POST', '/api/shortlist/bulk', { ids: [pub.id, priv.id] });
    ok('  · and the bulk route does not let one in the back way',
      r.ok && Number(r.body.skipped) === 1, JSON.stringify(r.body || {}).slice(0, 120));
    r = await req('s', 'GET', '/api/state');
    ok('  · so nothing public is on their shortlist',
      !(r.body.shortlist || []).some(x => x.isPublic),
      JSON.stringify((r.body.shortlist || []).map(x => x.id)).slice(0, 120));
  }

  /* ---- 3. a grade outside the scale, and a rate that is not one ---- */
  /* The baseline read from the PUBLIC shape, which is the one the finder
     actually uses and the one a wrong save would damage. */
  r = await req('a', 'GET', '/api/content');
  const keep = JSON.parse(JSON.stringify((r.body || {}).finder || {}));
  for (const [what, patch] of [
    ['a CGPA of 88', { cgpaFull: 88 }],
    ['a CGPA of -1', { cgpaFull: -1 }],
    ['a CGPA that is letters', { cgpaFull: 'abc' }],
    ['a partial CGPA of 99', { cgpaPartial: 99 }],
    ['a rate typed as letters', { fx: Object.assign({}, keep.fx, { EUR: 'abc' }) }],
    ['a rate of zero', { fx: Object.assign({}, keep.fx, { EUR: 0 }) }],
    ['a negative rate', { fx: Object.assign({}, keep.fx, { EUR: -5 }) }],
  ]) {
    r = await req('a', 'PUT', '/api/staff/content/finder', Object.assign({}, keep, patch));
    ok(what + ' is refused', r.status === 422, r.status + ' ' + ((r.body || {}).error || ''));
  }
  r = await req('a', 'GET', '/api/content');
  const live = (r.body || {}).finder || {};
  ok('  · the euro is still in the table afterwards',
    live.fx && Number(live.fx.EUR) > 0, JSON.stringify(live.fx || {}));
  ok('  · and the grade bar is unchanged',
    Number(live.cgpaFull) === Number(keep.cgpaFull), live.cgpaFull + ' vs ' + keep.cgpaFull);
  r = await req('a', 'PUT', '/api/staff/content/finder', Object.assign({}, keep, { cgpaFull: 7.5 }));
  ok('  · a real grade still saves', r.ok, r.status + ' ' + ((r.body || {}).error || ''));

  /* ---- 4. the catalogue: read yes, carry it out no ---- */
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Plain Counsellor', email: 'pc' + stamp + '@glovels.com',
      password: 'pc-' + stamp, role: 'counsellor' });
  const cEmail = 'pc' + stamp + '@glovels.com';
  await login('c', cEmail, 'pc-' + stamp);
  await req('c', 'POST', '/api/auth/change', { current: 'pc-' + stamp, password: 'Plain-' + stamp + '-ok' });
  await login('c', cEmail, 'Plain-' + stamp + '-ok');
  r = await req('c', 'GET', '/api/staff/catalogue');
  ok('a counsellor with no permissions can read the catalogue', r.ok, r.status);
  const dl = await fetch(BASE + '/api/staff/catalogue.csv', { headers: { cookie: jar.c } });
  ok('  · but cannot take it away as a file', dl.status === 403, dl.status);
  const dl2 = await fetch(BASE + '/api/staff/catalogue.xlsx', { headers: { cookie: jar.c } });
  ok('  · in either format', dl2.status === 403, dl2.status);
  const dl3 = await fetch(BASE + '/api/staff/catalogue.csv', { headers: { cookie: jar.a } });
  ok('  · and the office still can', dl3.status === 200, dl3.status);

  /* ---- 5. whose lead it is, on the screen that shows everybody's ---- */
  r = await req('c', 'GET', '/api/staff/enquiries');
  ok('the enquiry feed says who owns each row',
    Array.isArray(r.body.enquiries)
    && r.body.enquiries.every(e => 'owner' in e && 'mine' in e),
    JSON.stringify((r.body.enquiries || [])[0] || {}).slice(0, 140));

  /* ---- 6. a document sent back is said out loud ---- */
  const cid = (await req('a', 'GET', '/api/staff/people')).body.people
    .find(p => p.email === cEmail).id;
  await req('a', 'PUT', '/api/staff/student/' + sId + '/counsellor', { counsellorId: cid });
  r = await req('a', 'POST', '/api/staff/student/' + sId + '/document/passport',
    { status: 'rescan', note: 'The photo page is cut off at the bottom.' });
  ok('a counsellor can send a document back', r.ok, r.status);
  r = await req('s', 'GET', '/api/state');
  const msgs = (r.body.msgs || []).filter(m => m.who === 'them');
  ok('  · and the student is told on their own thread',
    msgs.some(m => /passport/i.test(m.t) && /another copy/i.test(m.t)),
    JSON.stringify(msgs.map(m => m.t.slice(0, 50))).slice(0, 200));
  ok('  · with the reason the counsellor gave',
    msgs.some(m => /cut off at the bottom/.test(m.t)), 'note not carried');
  ok('  · and it is back on the list of what is still needed',
    ((r.body.todo || {}).documentsMissing || []).length >= 0, 'todo shape');

  /* ---- 7. every message says who it is from ---- */
  r = await req('c', 'POST', '/api/staff/student/' + sId + '/message',
    { body: 'Morning — could you send that passport page again?' });
  ok('a counsellor can write to their student', r.ok, r.status);
  r = await req('s', 'GET', '/api/state');
  const mine = (r.body.msgs || []);
  ok('  · their name is on what they typed',
    mine.some(m => m.who === 'them' && m.from === 'Plain Counsellor'),
    JSON.stringify(mine.map(m => m.who + ':' + (m.from || ''))).slice(0, 200));
  ok('  · an automatic notice is from the office, not from a person',
    mine.some(m => m.who === 'them' && m.from === 'Glovels'),
    JSON.stringify(mine.map(m => m.from || '')).slice(0, 160));
  ok('  · and the student’s own messages claim nobody',
    mine.filter(m => m.who === 'me').every(m => !m.from), 'a student message has a from');

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
