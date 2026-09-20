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
      const o = await req(tag, 'POST', '/api/orders',
        { packageId: pkg, name: 'Phase ' + tag, email: e, phone: '9876543210', acceptedTerms: true });
      if (o.status === 429) {
        console.error('\n  STOPPED: the order endpoint is rate-limited (10/hour per address).');
        console.error('  Restart the server to clear it:  bash tests/srv.sh 8099\n');
        process.exit(2);
      }
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

  /* ---- 4b. a task that belongs to no template ----
     The worst bug the phase engine had. A hand-made task — which the Tasks
     board lets anybody create — matched no template, so it fell out of every
     phase; and "no phase has open work" was then read as "everything is
     finished". A student with one open, overdue, hand-written task was
     reported as Departed, with that task counted among the finished ones,
     while their own dashboard showed it as still to do. Two screens
     contradicting each other about the same row. */
  {
    const custom = await makeStudent('cust', null);
    await finish(custom, /Welcome call|Profile completed/);
    let p = await phase(custom);
    ok('with everything finished, a student is Departed', p.key === 'departed', p.key);
    r = await req('a', 'POST', '/api/staff/student/' + custom + '/tasks',
      { title: 'Send the bank letter', due: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
    const hand = r.body.task;
    p = await phase(custom);
    ok('  · adding one task by hand takes them OUT of Departed',
      p.key !== 'departed' && !p.finished, p.key + ' finished=' + p.finished);
    ok('  · and the open task is counted, not swallowed',
      p.total >= 1 && p.done < p.total, p.done + '/' + p.total);
    ok('  · and named as what is blocking them',
      (p.blocking || []).some(b => /bank letter/.test(b.title)),
      JSON.stringify(p.blocking || []));
    /* The student's own screen and the office's must agree about it. */
    const st2 = await req('a', 'GET', '/api/staff/student/' + custom);
    ok('  · the two screens agree on how much is left',
      (st2.body.tasks || []).filter(t => t.status !== 'done').length ===
        (p.total - p.done), p.done + '/' + p.total);
    await req('a', 'PUT', '/api/staff/task/' + hand.id, { status: 'done' });
    p = await phase(custom);
    ok('  · finishing it puts them back to Departed', p.key === 'departed' && p.finished, p.key);
  }

  /* ---- 5. the office's funnel ---- */
  r = await req('a', 'GET', '/api/staff/tasks?state=all');
  const fn = r.body.funnel || [];
  /* Nine, not eight: 'service' sits between Visa and Departed for work that
     is not on the university journey at all — a loan, a language course. */
  ok('the funnel has a row per phase, in order',
    fn.length === 9 && fn[0].key === 'enrolled'
    && fn[7].key === 'service' && fn[8].key === 'departed',
    fn.map(f => f.key).join(','));
  ok('  · counting students, not tasks',
    fn.reduce((n, f) => n + f.students, 0) >= 3, JSON.stringify(fn.map(f => f.short + '=' + f.students)));
  /* Somebody who signed up and bought nothing has no journey to be at a
     point in, and counting them inflated Enrolled — the column an office is
     most likely to act on. */
  {
    r = await req('a', 'POST', '/api/staff/people',
      { name: 'Never Bought', email: 'nb' + stamp + '@ex.example', password: 'nb-' + stamp, role: 'student' });
    const idle = r.body.person.id;
    /* Their standard tasks are created on first read, so read first — a
       baseline taken before they exist measures nothing. */
    const theirs = await tasksOf(idle);
    ok('  · a new student starts with the tasks everybody owes', theirs.length > 0, theirs.length);
    const before = ((await req('a', 'GET', '/api/staff/tasks?state=all')).body.funnel || [])
      .reduce((n, f) => n + f.students, 0);
    /* Drop everything they were given, so they genuinely have no work. */
    for (const t of theirs) {
      await req('a', 'PUT', '/api/staff/task/' + t.id, { status: 'dropped' });
    }
    const after = ((await req('a', 'GET', '/api/staff/tasks?state=all')).body.funnel || [])
      .reduce((n, f) => n + f.students, 0);
    ok('  · and counts nobody who has no work at all', after === before - 1,
      before + ' → ' + after);
  }

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
