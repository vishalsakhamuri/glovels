/*
 * The 27 September round. Six findings: three names, a hard-wired CGPA, two
 * screens counting one student's documents differently, a counsellor's
 * messages labelled as the office's, a dashboard that dropped the student's
 * own pick from its count, and a partner form whose refusal vanished.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json' }; if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : []; if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j, text };
}
const page = async p => { const r = await fetch(BASE + p); let t = await r.text();
  for (const m of t.matchAll(/<script src="(\/js\/[^"]+\.js)"/g)) t += '\n' + await (await fetch(BASE + m[1])).text(); return t; };

(async () => {
  const stamp = Date.now().toString(36);
  await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });

  /* 1. the names */
  let r = await req('x', 'GET', '/api/content');
  const svc = ((r.body || {}).services || {}).items || [];
  const pk = ((r.body || {}).packages || {}).items || [];
  ok('₹99 is "Private match preview"', svc.some(s => s.id === 'first-three' && s.name === 'Private match preview' && /3 partner universities/.test(s.desc)), JSON.stringify(svc.find(s => s.id === 'first-three') || {}).slice(0, 120));
  ok('₹999 is "Private shortlist of 10"', svc.some(s => s.id === 'shortlist-ten' && s.name === 'Private shortlist of 10' && /gap analysis/.test(s.desc)));
  ok('₹4,999 is "Public University Unlock"', pk.some(p => p.id === 'pkg-three-public' && p.title === 'Public University Unlock'), JSON.stringify(pk.find(p => p.id === 'pkg-three-public') || {}).slice(0, 120));
  let t = await page('/');
  ok('  · and the home page paints the new names before the live ones arrive', /"Private match preview"/.test(t) && /"Private shortlist of 10"/.test(t) && /"Public University Unlock"/.test(t) && !/"First Three Universities"|"Shortlist of Ten"/.test(t));

  /* 2. the Germany page follows the finder's bar, not a number written into it */
  r = await req('a', 'GET', '/api/content');
  const fin = Object.assign({}, (r.body || {}).finder || {});
  await req('a', 'PUT', '/api/staff/content/finder', Object.assign({}, fin, { cgpaFull: 7.2, cgpaPartial: 6.5 }));
  /* Germany with no bar of its own — as it is on the live site. */
  const deAll = Object.assign({}, (((await req('x', 'GET', '/api/catalogue')).body || {}).countries || {}).DE);
  const deFacts = deAll.code ? deAll : null;
  if (deFacts) ['code', 'name', 'flag', 'region'].forEach(k => delete deFacts[k]);
  if (deFacts) await req('a', 'PUT', '/api/staff/country', { code: 'DE', name: 'Germany', facts: Object.assign({}, deFacts, { minCgpaPublic: '', minCgpaPrivate: '' }) });
  t = await (await fetch(BASE + '/study-in-germany')).text();
  ok('Germany: public CGPA comes from the finder when Germany has no bar of its own', /Public university CGPA<\/span><b>7\.2\+ on 10</.test(t), (t.match(/Public university CGPA<\/span><b>[^<]*/) || [''])[0]);
  ok('  · and so does the private one', /Private university CGPA<\/span><b>6\.5\+ on 10</.test(t), (t.match(/Private university CGPA<\/span><b>[^<]*/) || [''])[0]);
  ok('  · and the FAQ question says the same number', /My CGPA is below 7\.2/.test(t) && !/My CGPA is below 7\.5/.test(t));
  await req('a', 'PUT', '/api/staff/content/finder', fin);
  if (deFacts) await req('a', 'PUT', '/api/staff/country', { code: 'DE', name: 'Germany', facts: deFacts });

  /* 3. one count of documents on both screens */
  t = await page('/documents');
  /* Patch 161 (D17): one ratio — the required documents, the same the ring measures. */
  ok('the student screen leads with the required documents, the ring\'s own ratio', /required documents verified/.test(t));
  t = await page('/counsellor');
  ok('the counsellor tile names a file sent back', /' sent back'/.test(t));

  /* 4. who a message is from — on the chat panel too */
  const email = 'r142' + stamp + '@ex.example';
  r = await req('a', 'POST', '/api/staff/people', { name: 'R142 Student', email, password: 'r142-' + stamp + '-pw', role: 'student' });
  const sId = r.body.person.id;
  r = await req('a', 'POST', '/api/staff/people', { name: 'Meera Rao', email: 'mr' + stamp + '@glovels.com', password: 'mr-' + stamp + '-pw', role: 'counsellor' });
  await req('a', 'PUT', '/api/staff/student/' + sId + '/counsellor', { counsellorId: r.body.person.id });
  await req('c', 'POST', '/api/auth/login', { email: 'mr' + stamp + '@glovels.com', password: 'mr-' + stamp + '-pw' });
  await req('c', 'POST', '/api/auth/change', { current: 'mr-' + stamp + '-pw', password: 'mr-' + stamp + '-pwX' });
  r = await req('c', 'POST', '/api/staff/student/' + sId + '/message', { body: 'Hi, messaging you on 27 Sep' });
  ok('a counsellor can message the student', r.status < 300, r.status + ' ' + (r.body && r.body.error));
  await req('s', 'POST', '/api/auth/login', { email, password: 'r142-' + stamp + '-pw' });
  await req('s', 'POST', '/api/auth/change', { current: 'r142-' + stamp + '-pw', password: 'r142-' + stamp + '-pwX' });
  r = await req('s', 'GET', '/api/chat');
  const mine = ((r.body || {}).messages || []).find(m => /messaging you on 27 Sep/.test(m.t));
  ok('the chat panel is told the counsellor\'s name, not "Glovels"', mine && mine.name === 'Meera Rao', JSON.stringify(mine));
  t = await page('/');
  ok('  · and a live message carries it into the panel', /arrive\(\{ who: 'them', t: m\.t, at: m\.at, name: m\.from \|\| m\.name \|\| '' \}\)/.test(t));

  /* 5. the dashboard counts what My Programs counts */
  t = await page('/dashboard');
  ok('the dashboard counts the whole shortlist, the student\'s own picks included', /const slTotal = signedIn \? list\.length : shown\.length;/.test(t) && /\+ slSaid \+ '\.'/.test(t));

  /* 6. the partner form: refused, and seen to be refused */
  const pm = 'p' + stamp + '@ag.example';
  await req('a', 'POST', '/api/staff/people', { name: 'P ' + stamp, email: pm, password: 'pw-' + stamp + '-long', role: 'partner' });
  await req('p', 'POST', '/api/auth/login', { email: pm, password: 'pw-' + stamp + '-long' });
  await req('p', 'POST', '/api/auth/change', { current: 'pw-' + stamp + '-long', password: 'pw-' + stamp + '-longX' });
  await req('p', 'POST', '/api/partner/students', { students: [{ name: 'S ' + stamp, email: 's' + stamp + '@ex.example', phone: '9876500111' }] });
  const sid = (((await req('p', 'GET', '/api/partner/students')).body || {}).students || [])[0].id;
  r = await req('p', 'PUT', '/api/partner/student/' + sid + '/profile', { profile: { phone: 'ft26zzz', email: 'ft26-no-at', pin: 'PIN26-X' } });
  ok('the partner save refuses a lettered mobile, an email with no @ and a lettered PIN', r.status === 422 && ['phone', 'email', 'pin'].every(f => (r.body.fields || []).some(x => x.field === f)), r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  t = await page('/partner');
  ok('  · and the screen keeps the refusal up and marks the boxes', /'Not saved\. ' \+ err\.message/.test(t) && /box\.setAttribute\('aria-invalid', 'true'\)/.test(t) && /if \(Array\.isArray\(data\.fields\)\) err\.fields = data\.fields;/.test(t));

  console.log('round142test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
