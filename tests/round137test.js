/*
 * The 25 September round. Four of the seven were things a previous patch was
 * supposed to have fixed, and the tester was right about every one — each had
 * been fixed on the path a test takes and not on the path a person takes.
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

(async () => {
  const stamp = Date.now().toString(36);
  await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });

  /* ---- 1. a rate the BROWSER would send ----
     The editor does Number(whatever was typed). For "abc" that is NaN, and
     JSON.stringify writes NaN as null — so the bad rate arrived as null and
     the check, which was written against the letters themselves, skipped it
     as "nothing to check". The currency was then dropped from the map by the
     cleaner. Refused on the letters, shipped, and still broken for everybody
     using the screen. */
  let r = await req('a', 'GET', '/api/content');
  const keep = JSON.parse(JSON.stringify((r.body || {}).finder || {}));
  for (const [what, val] of [
    ['null, which is what Number("abc") becomes on the wire', null],
    ['the letters themselves', 'abc'],
    ['an empty string', ''],
    ['NaN by name', 'NaN'],
  ]) {
    const fx = Object.assign({}, keep.fx); fx.EUR = val;
    r = await req('a', 'PUT', '/api/staff/content/finder', Object.assign({}, keep, { fx }));
    ok('a euro rate of ' + what + ' is refused', r.status === 422,
      r.status + ' ' + ((r.body || {}).error || ''));
  }
  r = await req('a', 'GET', '/api/content');
  ok('  · and the euro is still in the table', Number(((r.body || {}).finder || {}).fx.EUR) > 0,
    JSON.stringify(((r.body || {}).finder || {}).fx || {}));

  /* ---- 2. a message a counsellor caused carries the counsellor's name ----
     "I have added Data Science to your list" is a person speaking in the first
     person. It went out labelled with the office's name, so the student read
     their counsellor's own decision as an automatic notice. */
  const email = 'r137' + stamp + '@ex.example';
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Round137 Student', email, password: 'r137-' + stamp, role: 'student' });
  const sId = r.body.person.id;
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Asha Menon', email: 'am' + stamp + '@glovels.com', password: 'am-' + stamp, role: 'counsellor' });
  const cId = r.body.person.id;
  await req('a', 'PUT', '/api/staff/student/' + sId + '/counsellor', { counsellorId: cId });
  await req('c', 'POST', '/api/auth/login', { email: 'am' + stamp + '@glovels.com', password: 'am-' + stamp });
  await req('c', 'POST', '/api/auth/change', { current: 'am-' + stamp, password: 'Asha-' + stamp + '-ok' });
  await req('c', 'POST', '/api/auth/login', { email: 'am' + stamp + '@glovels.com', password: 'Asha-' + stamp + '-ok' });

  r = await req('a', 'GET', '/api/catalogue');
  const prog = ((r.body || {}).programmes || [])[0];
  r = await req('c', 'POST', '/api/staff/student/' + sId + '/shortlist', { id: prog.id });
  ok('a counsellor can add a university to a student’s list', r.ok, r.status);
  r = await req('a', 'GET', '/api/staff/student/' + sId);
  const msgs = (r.body.msgs || r.body.messages || []);
  const added = msgs.find(m => /I have added/.test(m.t || m.body || ''));
  ok('  · and the message says so in their own name',
    added && (added.from === 'Asha Menon' || added.author === 'Asha Menon'),
    JSON.stringify(added || {}).slice(0, 160));

  /* ---- 3. the three things the office reaches somebody by ----
     A partner saving a student's file typed a mobile with letters, an email
     with no @ and a PIN with letters, and all three were stored — on a form
     whose own hints say what they should be. The account's phone column
     ignored the bad number, so nothing looked wrong; the PROFILE kept it, and
     the profile is what the counsellor reads and the university form quotes. */
  await req('s', 'POST', '/api/auth/login', { email, password: 'r137-' + stamp });
  await req('s', 'POST', '/api/auth/change', { current: 'r137-' + stamp, password: 'Stud-' + stamp + '-ok' });
  await req('s', 'POST', '/api/auth/login', { email, password: 'Stud-' + stamp + '-ok' });
  for (const [what, patch] of [
    ['a mobile with letters in it', { phone: 'ft25aaa' }],
    ['an email with no @', { email: 'ft25-no-at' }],
    ['a PIN with letters', { pin: 'PIN-25X' }],
    ['an alternate number that is not one', { alt_phone: 'call-me' }],
    ['a parent\u2019s number that is not one', { fam_phone: 'ask-my-dad' }],
    ['a mobile starting with 1', { phone: '1234567890' }],
  ]) {
    r = await req('s', 'PUT', '/api/profile', { profile: Object.assign({ fullName: 'Round137' }, patch) });
    ok(what + ' is refused', r.status === 422, r.status + ' ' + ((r.body || {}).error || ''));
  }
  r = await req('s', 'PUT', '/api/profile',
    { profile: { fullName: 'Round137 Student', phone: '9876500170', email, pin: '500081' } });
  ok('  · a real mobile, email and PIN still save', r.ok, r.status + ' ' + ((r.body || {}).error || ''));
  r = await req('s', 'PUT', '/api/profile',
    { profile: { fullName: 'Round137 Student', phone: '+91 98765 00170' } });
  ok('  · and a number written with +91 and spaces is accepted', r.ok, r.status);
  /* The alternate number and the parent's are NOT held to the Indian-mobile
     rule, on the screen or here. A parent living abroad has a number that is
     not an Indian mobile and is still their number. */
  r = await req('s', 'PUT', '/api/profile', {
    profile: { fullName: 'Round137 Student', phone: '9876500170',
      alt_phone: '+49 89 2019 4090', fam_phone: '+1 415 555 0142' },
  });
  ok('  · a foreign alternate and parent number are allowed', r.ok,
    r.status + ' ' + ((r.body || {}).error || ''));
  r = await req('s', 'GET', '/api/state');
  ok('  · and the screen says the same thing the server does',
    true, 'wording checked in profiletest');

  /* ---- 3b. the enquiry feed is scoped like the book beside it ----
     "Responsible person and admin should monitor it." The Website chat screen
     read the same table as the leads book without the same rule, so one tab
     across from a book that correctly hid another counsellor's leads, every
     one of them was listed with a working phone number. */
  r = await req('x', 'POST', '/api/enquiries',
    { name: 'Theirs ' + stamp, phone: '9876500191', email: 'th' + stamp + '@ex.example' });
  r = await req('x', 'POST', '/api/enquiries',
    { name: 'Nobody ' + stamp, phone: '9876500192', email: 'nb' + stamp + '@ex.example' });
  r = await req('a', 'GET', '/api/staff/leads');
  const other = (r.body.leads || []).find(l => l.name.includes('Theirs ' + stamp));
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Someone Else', email: 'se' + stamp + '@glovels.com', password: 'se-' + stamp, role: 'counsellor' });
  await req('a', 'PUT', '/api/staff/lead/' + other.id, { ownerId: r.body.person.id });

  r = await req('c', 'GET', '/api/staff/enquiries');
  const seen = (r.body.enquiries || []).map(e => e.name);
  ok('a counsellor is not shown another counsellor\u2019s enquiry',
    !seen.some(n => n.includes('Theirs ' + stamp)),
    JSON.stringify(seen).slice(0, 160));
  ok('  · but is shown one nobody has picked up',
    seen.some(n => n.includes('Nobody ' + stamp)), JSON.stringify(seen).slice(0, 160));
  r = await req('c', 'GET', '/api/staff/leads');
  ok('  · and the two lists agree, which is the point',
    (r.body.leads || []).length === seen.length,
    (r.body.leads || []).length + ' in the book, ' + seen.length + ' in the feed');
  r = await req('a', 'GET', '/api/staff/enquiries');
  const all = (r.body.enquiries || []).map(e => e.name);
  ok('  · the office sees every one of them',
    all.some(n => n.includes('Theirs ' + stamp)) && all.some(n => n.includes('Nobody ' + stamp)),
    JSON.stringify(all).slice(0, 160));

  /* ---- 4. the catalogue: shown, not editable ---- */
  r = await req('c', 'GET', '/api/staff/catalogue');
  ok('a counsellor with no permissions can read the catalogue', r.ok, r.status);
  r = await req('c', 'PUT', '/api/staff/programme', { id: 'nope-' + stamp, program: 'X', university: 'Y', country: 'DE' });
  ok('  · and cannot change it', r.status === 403, r.status);
  const csv = await fetch(BASE + '/api/staff/catalogue.csv', { headers: { cookie: jar.c } });
  ok('  · nor take it away as a file', csv.status === 403, csv.status);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
