/*
 * Where a student has got to, and how it is worked out.
 *
 * The office's instruction: "Enrolled → Profile and documents → Shortlisting
 * → Writing (SOP/LOR) → Applying → Waiting on offers → Visa → Departed —
 * these are tracked and updated based on the completion, and asked for
 * status to counsellors in case not completed."
 *
 * So the phase is DERIVED and never set, and the interesting cases are the
 * ones where a naive derivation would lie: a phase holding ten tasks, a
 * student who never bought the later phases, and a file that is not late but
 * has stopped moving.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json' };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
const login = (who, e, p) => req(who, 'POST', '/api/auth/login', { email: e, password: p });

(async () => {
  const stamp = Date.now().toString(36);
  await login('a', 'admin@glovels.com', 'glovels123');
  let r = await req('a', 'POST', '/api/staff/people',
    { name: 'Phase Counsellor', email: 'fc' + stamp + '@glovels.com', password: 'fc-' + stamp, role: 'counsellor' });
  const cId = r.body.person.id;

  const makeStudent = async (tag, pkg) => {
    const e = tag + stamp + '@ex.example', p = tag + '-' + stamp;
    let x = await req('a', 'POST', '/api/staff/people', { name: 'Phase ' + tag, email: e, password: p, role: 'student' });
    const id = x.body.person.id;
    await req('a', 'PUT', '/api/staff/student/' + id + '/counsellor', { counsellorId: cId });
    if (pkg) {
      await login(tag, e, p);
      await req(tag, 'POST', '/api/auth/change', { password: p + 'X' });
      await login(tag, e, p + 'X');
      await req(tag, 'POST', '/api/orders',
        { packageId: pkg, name: 'Phase ' + tag, email: e, phone: '9876543210', acceptedTerms: true });
    }
    return id;
  };
  const phase = async id => (await req('a', 'GET', '/api/staff/student/' + id)).body.phase;
  const tasksOf = async id => (await req('a', 'GET', '/api/staff/student/' + id)).body.tasks || [];
  const finish = async (id, re) => {
    for (const t of (await tasksOf(id)).filter(x => re.test(x.title))) {
      await req('a', 'PUT', '/api/staff/task/' + t.id, { status: 'done' });
    }
  };

  /* ---- 1. the whole journey, in order ---- */
  const full = await makeStudent('full', 'pkg-boarding');
  const cat = await req('a', 'GET', '/api/staff/catalogue?per=40');
  const unis = (cat.body.programmes || []).slice(0, 3);
  for (const u of unis) await req('a', 'POST', '/api/staff/student/' + full + '/shortlist', { id: u.id });

  ok('a fresh file is Enrolled', (await phase(full)).key === 'enrolled', (await phase(full)).key);
  await finish(full, /Welcome call/);
  ok('  · then Profile and documents', (await phase(full)).key === 'profile');
  await finish(full, /Profile completed/);
  ok('  · then Shortlisting', (await phase(full)).key === 'shortlist');
  await finish(full, /Shortlist confirmed/);
  ok('  · then Writing', (await phase(full)).key === 'writing');
  await finish(full, /Statement of Purpose|Letters of Rec/);
  ok('  · then Applying', (await phase(full)).key === 'applying');

  /* ---- 2. Applying holds one submission per university ---- */
  const applying = await phase(full);
  ok('Applying counts every university plus the documents',
    applying.total === unis.length + 1, applying.done + '/' + applying.total + ' for ' + unis.length + ' unis');
  const subs = (await tasksOf(full)).filter(t => /Application submitted/.test(t.title));
  ok('  · one submission task per shortlisted university', subs.length === unis.length, subs.length);
  ok('  · each named after its own university',
    new Set(subs.map(t => t.title)).size === subs.length, subs.map(t => t.title).join(' | '));
  await finish(full, /Application documents/);
  for (let i = 0; i < subs.length; i++) {
    await req('a', 'PUT', '/api/staff/task/' + subs[i].id, { status: 'done' });
    const p = await phase(full);
    const last = i === subs.length - 1;
    ok('  · ' + (i + 1) + ' of ' + subs.length + ' submitted → ' + p.label,
      last ? p.key === 'offers' : (p.key === 'applying' && p.done === i + 2),
      p.key + ' ' + p.done + '/' + p.total);
  }
  await finish(full, /Offer letter/);
  ok('then Visa', (await phase(full)).key === 'visa');
  await finish(full, /Visa documents|Visa application/);
  const end = await phase(full);
  ok('and finally Departed', end.key === 'departed' && end.finished, end.key);

  /* ---- 3. a student never reaches a phase they did not buy ---- */
  const small = await makeStudent('small', null);
  const sp = await phase(small);
  ok('somebody who bought nothing is not parked before a visa they will never need',
    sp.key === 'enrolled', sp.key);
  await finish(small, /Welcome call|Profile completed/);
  const sp2 = await phase(small);
  ok('  · and reads as finished once their own short list is done',
    sp2.key === 'departed' && sp2.finished, sp2.key);

  /* ---- 4. the phase is the FIRST unfinished one, not the furthest touched ---- */
  const jump = await makeStudent('jump', 'pkg-boarding');
  for (const u of unis.slice(0, 1)) await req('a', 'POST', '/api/staff/student/' + jump + '/shortlist', { id: u.id });
  await finish(jump, /Application submitted/);
  const jp = await phase(jump);
  ok('submitting before agreeing a shortlist still reads as the earlier phase',
    jp.key === 'enrolled', jp.key + ' — a submitted application must not hide an unstarted file');

  /* ---- 5. the office's funnel ---- */
  r = await req('a', 'GET', '/api/staff/tasks?state=all');
  const fn = r.body.funnel || [];
  ok('the funnel has a row per phase, in order',
    fn.length === 8 && fn[0].key === 'enrolled' && fn[7].key === 'departed',
    fn.map(f => f.key).join(','));
  ok('  · counting students, not tasks',
    fn.reduce((n, f) => n + f.students, 0) >= 3, JSON.stringify(fn.map(f => f.short + '=' + f.students)));
  r = await req('a', 'GET', '/api/staff/tasks?state=all&phase=enrolled');
  const onlyEnrolled = new Set((r.body.tasks || []).map(t => t.studentId));
  ok('  · and a phase can be asked for on its own', r.ok && onlyEnrolled.size > 0, onlyEnrolled.size);

  /* ---- 6. the student sees the phase and nothing operational ---- */
  const state = await req('full', 'GET', '/api/state');
  const ph = (state.body.progress || {}).phase;
  ok('the student is told their phase', !!ph && !!ph.label, JSON.stringify(ph));
  const keys = Object.keys(ph || {});
  ok('  · and only what is theirs to know',
    !keys.some(k => ['late', 'waiting', 'days', 'blocking', 'since'].includes(k)), keys.join(','));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
