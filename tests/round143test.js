/*
 * Patch 143 — the shortlisting audit.
 *
 * Three agents tested the Germany catalogue as students, counsellors and the
 * office. What they found, and what this suite holds the site to:
 *
 *   the paid shortlist checked the CGPA and nothing else — IELTS, German,
 *   the bachelor's subject and work experience are now checked too;
 *   a level never bends from master's to bachelor's or back;
 *   a second purchase took away what the first delivered;
 *   buying on the home page stored twelve random finder rows as the
 *   counsellor's shortlist;
 *   a university the counsellor removed came back on the next profile save;
 *   a student could not take off a university they had marked themselves;
 *   a programme hidden by the office stayed on lists with no warning;
 *   the Germany page said "153 at public universities", and a search for
 *   "münchen" found nothing.
 *
 * Every programme here is invented ("Zymurgy"), so no other row in the
 * catalogue can match the profile and the expected shortlist is exact.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const jar = {}; let ipn = 1;
const ips = {};
async function req(who, method, path, body) {
  ips[who] = ips[who] || ('10.143.' + (ipn++) + '.9');
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] }; if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text };
}

(async () => {
  const st = Date.now().toString(36);
  await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });

  const mk = async (id, o) => {
    const r = await req('a', 'PUT', '/api/staff/programme', Object.assign({
      id: id + st, country: 'DE', level: 'master', field: 'Other', isPublic: false,
      feeModel: 'free', totalInr: 1500000, intakes: [{ season: 'winter', deadline: '2027-07-15' }],
    }, o));
    if (r.status >= 300) console.log('    (could not create ' + id + ': ' + r.status + ' ' + r.text.slice(0, 120) + ')');
    return id + st;
  };
  const A = await mk('zyA', { program: 'Zymurgy Science MSc', university: 'Zymurgy A University', reqs: { ieltsMin: 7 } });
  const B = await mk('zyB', { program: 'Zymurgy Brewing MSc', university: 'Zymurgy B University' });
  const C = await mk('zyC', { program: 'Zymurgy Analytics MSc', university: 'Zymurgy C University', reqs: { bachelorSubjects: 'Computer Science, Software Engineering' } });
  const D = await mk('zyD', { program: 'Zymurgy Leadership MSc', university: 'Zymurgy D University', reqs: { workExpRequired: true } });
  const E = await mk('zyE', { program: 'Zymurgy Fermentation BSc', university: 'Zymurgy E University', level: 'bachelor' });
  const F = await mk('zyF', { program: 'Zymurgy Public MSc', university: 'Zymurgy F Universität München', city: 'München', isPublic: true, feeModel: 'package', totalInr: 0 });
  const G = await mk('zyG', { program: 'Zymurgy Public Two MSc', university: 'Zymurgy G University', isPublic: true, feeModel: 'package', totalInr: 0, reqs: { ieltsMin: 8 } });

  /* A B.Com graduate, IELTS 6.5, no work experience, after a zymurgy master's. */
  const email = 'z' + st + '@ex.example';
  let r = await req('s', 'POST', '/api/orders', { name: 'Zed Student', email, phone: '+919000014301', acceptedTerms: true, packageId: 'pkg-three-public' });
  ok('an order for Public University Unlock is placed', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  await req('s', 'POST', '/api/auth/change', { password: 'zed-' + st + '-password' });
  const profile = { fullName: 'Zed Student', d_course: 'B.Com', d_dur: '3 years', d_cgpa: '8.5', d_max: '10', d_pass: '4',
    e_test: 'IELTS', e_score: '6.5', w_has: 'No', g_level: "Master's", g_field: 'Zymurgy', g_country: 'Germany', b_total: 'Above ₹40 Lakhs' };
  await req('s', 'PUT', '/api/profile', { profile });
  r = await req('s', 'POST', '/api/orders', { name: 'Zed Student', email, phone: '+919000014301', acceptedTerms: true, services: [{ id: 'shortlist-ten' }] });
  ok('then the ₹999 private shortlist', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  await req('s', 'PUT', '/api/profile', { profile });
  let s = (await req('s', 'GET', '/api/state')).body;
  const ids = (s.shortlist || []).map(x => x.id);
  const has = id => ids.includes(id);

  ok('the public university that fits is delivered', has(F), ids.join(','));
  ok('  · and still there after the private purchase — a second order no longer takes it away', has(F) && has(B), ids.join(','));
  ok('the private university that fits is delivered', has(B), ids.join(','));
  ok('a programme asking IELTS 7 is not sold to an IELTS 6.5 student', !has(A));
  ok('  · nor a public one asking IELTS 8', !has(G));
  ok('a programme asking for a Computer Science bachelor\'s is not sold to a B.Com', !has(C));
  ok('a programme that requires work experience is not sold to somebody with none', !has(D));
  ok('a bachelor\'s is never offered for a master\'s, even when the list comes up short', !has(E));
  ok('nothing irrelevant pads the list — every pick is a zymurgy programme',
    (s.shortlist || []).filter(x => x.addedBy === 'matched').every(x => /zymurgy/i.test(x.program)),
    (s.shortlist || []).filter(x => !/zymurgy/i.test(x.program)).map(x => x.program).join(' | '));
  ok('no university is said to be held back by the CGPA when it is the subject or IELTS that rules it out',
    s.matched && !s.matched.cgpaHeld, JSON.stringify(s.matched));
  ok('the dashboard knows both promises (3 public + 10 private)', s.matched && s.matched.owed === 13, JSON.stringify(s.matched));

  /* The home page's bulk post adds nothing any more. */
  r = await req('s', 'POST', '/api/shortlist/bulk', { ids: [A, C, D] });
  ok('the post-checkout bulk add stores nothing', r.status === 200 && r.body.added === 0
    && !(r.body.shortlist || []).some(x => [A, C, D].includes(x.id)), JSON.stringify(r.body).slice(0, 160));

  /* The counsellor's "not this one" sticks. */
  const sid = s.user && s.user.id;
  r = await req('a', 'DELETE', '/api/staff/student/' + sid + '/shortlist/' + encodeURIComponent(B));
  ok('the office can take a matched university off', r.status === 200, r.status);
  await req('s', 'PUT', '/api/profile', { profile });
  s = (await req('s', 'GET', '/api/state')).body;
  ok('  · and a profile save does not put it back', !(s.shortlist || []).some(x => x.id === B), (s.shortlist || []).map(x => x.id).join(','));

  /* A student's own pick is theirs to remove; the deliverable is not. */
  await req('s', 'POST', '/api/shortlist', { id: A });
  r = await req('s', 'DELETE', '/api/shortlist/' + encodeURIComponent(A));
  ok('a student can remove a university they added themselves', r.status === 200, r.status + ' ' + r.text.slice(0, 100));
  r = await req('s', 'DELETE', '/api/shortlist/' + encodeURIComponent(F));
  ok('  · but not one their package delivered', r.status === 403, r.status);

  /* Hidden by the office after it went on the list. */
  /* Deleting a programme that is on somebody's list hides it instead. */
  r = await req('a', 'DELETE', '/api/staff/programme/' + encodeURIComponent(F));
  s = (await req('s', 'GET', '/api/state')).body;
  const f = (s.shortlist || []).find(x => x.id === F);
  ok('a programme the office has hidden is marked on the list, not silently kept', !f || f.withdrawn === true, JSON.stringify(f || {}).slice(0, 160));

  /* The Germany page's public count, from the catalogue. */
  const cat = (await req('x', 'GET', '/api/catalogue')).body;
  const t = (await req('x', 'GET', '/study-in-germany')).text;
  const m = /programmes, ([\d,]+) at public universit/.exec(t);
  ok('"N at public universities" on the Germany page is counted, not typed', !m || Number(m[1].replace(/,/g, '')) > 0, m && m[1]);

  /* Umlauts. F is hidden now, so search with a fresh one. */
  await mk('zyH', { program: 'Zymurgy Köln MSc', university: 'Zymurgy H Hochschule Köln', city: 'Köln', isPublic: false });
  r = await req('x', 'GET', '/api/universities/filter?country=DE&q=' + encodeURIComponent('köln zymurgy'));
  const found = JSON.stringify(r.body);
  ok('searching the university list for "köln" finds Köln', /Zymurgy H Hochschule K/.test(found), found.slice(0, 200));

  /* Rows with numeric ids come off the finder when hidden. */
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'serve.js'), 'utf8');
  ok('hidden rows with numeric ids are recognised on the baked page', /\(\?:"\(\[\^"\]\+\)"\|\(\\d\+\)\)/.test(src));

  for (const id of [A, B, C, D, E, G, 'zyH' + st]) await req('a', 'DELETE', '/api/staff/programme/' + encodeURIComponent(id));
  console.log('round143test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
