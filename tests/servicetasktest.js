/*
 * What gets tracked when somebody buys one thing rather than a package.
 *
 * The office: "some students may have 3 unis or 5 unis or one uni based on
 * the package selected… they may also select only SOP or LOR or visa
 * processing or bank processing, only one service as well."
 *
 * Both were broken. Buying an SOP put an LOR on the file and buying a CV put
 * both on it and no CV — so a counsellor owed work nobody had paid for, and
 * owed nothing for the work somebody had. And twenty-five of the thirty-eight
 * sellable services produced no task at all, so a single-service customer's
 * whole order was invisible: never late, never chased, never on the board.
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
    { name: 'Svc Counsellor', email: 'sc' + stamp + '@glovels.com', password: 'sc-' + stamp, role: 'counsellor' });
  const cId = r.body.person.id;

  /** A student who bought exactly `what`, and the tasks that produced. */
  const buyer = async (tag, what, pkg) => {
    const e = tag + stamp + '@ex.example', p = tag + '-' + stamp;
    let x = await req('a', 'POST', '/api/staff/people', { name: tag, email: e, password: p, role: 'student' });
    const id = x.body.person.id;
    await req('a', 'PUT', '/api/staff/student/' + id + '/counsellor', { counsellorId: cId });
    await login(tag, e, p);
    await req(tag, 'POST', '/api/auth/change', { password: p + 'X' });
    await login(tag, e, p + 'X');
    const order = { name: tag, email: e, phone: '9876543210', acceptedTerms: true };
    if (pkg) order.packageId = pkg; else order.services = what;
    x = await req(tag, 'POST', '/api/orders', order);
    /* The order endpoint allows ten an hour from one address, which a suite
       that buys fourteen things will hit. Say so loudly: a run where the
       orders silently failed proves nothing, and quietly passing is worse
       than failing. Restart the server to clear it — the counter is in
       memory. */
    if (x.status === 429) {
      console.error('\n  STOPPED: the order endpoint is rate-limited (10/hour per address).');
      console.error('  Restart the server to clear it:  bash tests/srv.sh 8099\n');
      process.exit(2);
    }
    if (!x.ok) { console.error('  order failed for ' + tag + ': ' + x.status + ' '
      + ((x.body || {}).error || '')); }
    const t = await req('a', 'GET', '/api/staff/student/' + id + '/tasks');
    return { id, tag, bought: x.ok, tasks: (t.body.tasks || []) };
  };
  const keys = b => b.tasks.map(t => t.key).sort();
  const has = (b, k) => b.tasks.some(t => t.key === k);

  /* ---- one service, and only that service ---- */
  const sop = await buyer('sop', ['sop']);
  ok('buying only an SOP creates an SOP task', has(sop, 'sop'), keys(sop).join(','));
  ok('  · and NOT an LOR task nobody paid for', !has(sop, 'lor'), keys(sop).join(','));

  const lor = await buyer('lor', ['lor']);
  ok('buying only an LOR creates an LOR task and not an SOP',
    has(lor, 'lor') && !has(lor, 'sop'), keys(lor).join(','));

  const cv = await buyer('cv', ['cv']);
  ok('buying a CV creates a CV task', has(cv, 'svc:cv'), keys(cv).join(','));
  ok('  · and neither an SOP nor an LOR', !has(cv, 'sop') && !has(cv, 'lor'), keys(cv).join(','));
  const cvTask = cv.tasks.find(t => t.key === 'svc:cv');
  ok('  · named from the office’s own catalogue, not its id',
    cvTask && /Academic CV/.test(cvTask.title), cvTask && cvTask.title);

  /* ---- the ones that used to vanish entirely ----
     Bought together in one order, which is both closer to how a real basket
     arrives and keeps the suite inside the ten-orders-an-hour limit. */
  const many = ['loan', 'forex', 'ielts', 'accom', 'insure', 'german'];
  const basket = await buyer('basket', many);
  for (const [id, expect] of [['loan', /Loan/i], ['forex', /Blocked Account|Forex/i],
                              ['ielts', /IELTS/i], ['accom', /Accommodation/i],
                              ['insure', /Insurance/i], ['german', /German/i]]) {
    const t = basket.tasks.find(x => x.key === 'svc:' + id);
    ok('buying ' + id + ' is tracked', !!t, keys(basket).join(','));
    if (t) {
      ok('  · named properly and dated', expect.test(t.title) && /^\d{4}-\d{2}-\d{2}$/.test(t.due),
        t.title + ' / ' + t.due);
    }
  }
  ok('  · six services bought together are six separate tasks',
    basket.tasks.filter(t => t.key.startsWith('svc:')).length === many.length,
    basket.tasks.filter(t => t.key.startsWith('svc:')).length);

  /* A service task is real work: it shows on the board and can be closed. */
  const lt = basket.tasks.find(t => t.key === 'svc:loan');
  r = await req('a', 'GET', '/api/staff/tasks?state=all');
  ok('a service task appears on the office board',
    (r.body.tasks || []).some(t => Number(t.id) === Number(lt.id)), lt && lt.id);
  r = await req('a', 'PUT', '/api/staff/task/' + lt.id, { status: 'done' });
  ok('  · and can be marked done like any other', r.ok && r.body.task.status === 'done', r.status);

  /* ---- a single-service customer still has a phase ---- */
  const only = await buyer('only', ['forex']);
  let ph = (await req('a', 'GET', '/api/staff/student/' + only.id)).body.phase;
  ok('a service-only student is not shown a university journey they never bought',
    ph && ['enrolled', 'profile', 'service'].includes(ph.key), ph && ph.key);
  for (const t of only.tasks.filter(x => /welcome|profile/.test(x.key))) {
    await req('a', 'PUT', '/api/staff/task/' + t.id, { status: 'done' });
  }
  ph = (await req('a', 'GET', '/api/staff/student/' + only.id)).body.phase;
  ok('  · and is NOT called Departed while their purchase is still open',
    ph && ph.key === 'service', ph && ph.key);
  const svcT = only.tasks.find(t => t.key === 'svc:forex');
  await req('a', 'PUT', '/api/staff/task/' + svcT.id, { status: 'done' });
  ph = (await req('a', 'GET', '/api/staff/student/' + only.id)).body.phase;
  ok('  · and only then is everything finished', ph && ph.key === 'departed', ph && ph.key);

  /* ---- however many universities the package allows ---- */
  const cat = await req('a', 'GET', '/api/staff/catalogue?per=60');
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const deadlineOf = p => {
    let ins = p.intakes;
    if (typeof ins === 'string') { try { ins = JSON.parse(ins); } catch (e) { ins = []; } }
    return (ins || []).map(i => i && i.deadline)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && d > today).sort()[0] || '';
  };
  /* Universities whose intake is still open first: those produce a real
     date per submission. Ones that have closed are correct to have none —
     that is patch 127 — and are covered below. */
  const progs = (cat.body.programmes || []).slice()
    .sort((a, b) => (deadlineOf(b) ? 1 : 0) - (deadlineOf(a) ? 1 : 0));
  for (const n of [1, 3, 5]) {
    const b = await buyer('u' + n, null, 'pkg-offer');
    for (const p of progs.slice(0, n)) {
      await req('a', 'POST', '/api/staff/student/' + b.id + '/shortlist', { id: p.id });
    }
    const t = (await req('a', 'GET', '/api/staff/student/' + b.id + '/tasks')).body.tasks || [];
    const subs = t.filter(x => x.key === 'submit');
    ok(n + ' universities shortlisted → ' + n + ' submission task' + (n === 1 ? '' : 's'),
      subs.length === n, subs.length);
    /* Each submission is dated from ITS OWN university, or correctly has no
       date at all when that university's intakes have closed. What must
       never happen is a date borrowed from a different university. */
    const picked = progs.slice(0, n);
    const wantDates = picked.map(deadlineOf);
    subs.forEach((x, k) => {
      const d = wantDates[k];
      /* Matched on the university AND the programme. One university can have
         several courses on a shortlist with different deadlines, which is
         exactly why the task title carries both — matching on the
         university alone picks the wrong one. */
      const mine = picked.find(pp =>
        x.title.includes(pp.university) && (!pp.program || x.title.includes(pp.program)));
      const want = mine ? deadlineOf(mine) : '';
      ok('  · ' + (x.title.split('—')[1] || '').trim().slice(0, 34) +
        (want ? ' is dated from its own deadline' : ' waits, its intakes having closed'),
        want ? (x.due && x.due < want && x.basis === 'deadline')
             : (!x.due && x.basis === 'pending'),
        'due=' + x.due + ' basis=' + x.basis + ' uni deadline=' + (want || 'none'));
    });
  }

  /* ---- what a second test agent found, all of it real ---- */

  /* F1: switching a step off in the standard list left a PAID service
     tracked by nothing at all — the template gone and the generic fallback
     suppressed by a static exclusion list. The exact invisibility this
     feature removed, reachable from a checkbox. */
  {
    await req('a', 'PUT', '/api/staff/task-rules',
      { rules: { sop: { off: true, title: 'Statement of Purpose written and approved' } } });
    const off = await buyer('sopoff', ['sop']);
    const tracked = off.tasks.filter(t => t.key === 'sop' || t.key === 'svc:sop');
    ok('a paid SOP is tracked even when the SOP step is switched off',
      tracked.length === 1, keys(off).join(','));
    ok('  · by the generic service task, named properly',
      tracked.length === 1 && /Statement of Purpose|SOP/i.test(tracked[0].title),
      tracked[0] && tracked[0].title);
    await req('a', 'PUT', '/api/staff/task-rules',
      { rules: { sop: { title: 'Statement of Purpose written and approved' } } });
  }

  /* F2: a service was dated from the day the FILE opened, not the day it
     was bought. An existing customer of six months buying a loan today was
     handed a task dated six months ago — overdue the instant it existed. */
  {
    const t = basket.tasks.find(x => x.key === 'svc:insure');
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    ok('a service bought today is not already overdue', t && t.due >= today,
      t && (t.due + ' vs today ' + today));
    ok('  · and is not reported late', t && (t.over == null || t.over <= 0), t && t.over);
  }

  /* F3: the service SLA had no writer at all, and the only writer of the
     block it lives in wiped it on every save from the Tasks screen. */
  {
    r = await req('a', 'PUT', '/api/staff/task-rules', { rules: { welcome: { sla: 2 } }, serviceSla: 30 });
    ok('the office can set how long a service has', r.ok && r.body.serviceSla === 30,
      JSON.stringify(r.body && r.body.serviceSla));
    r = await req('a', 'PUT', '/api/staff/task-rules', { rules: { welcome: { sla: 3 } } });
    ok('  · and saving the steps does not wipe it', r.body.serviceSla === 30, r.body.serviceSla);
    r = await req('a', 'GET', '/api/staff/task-rules');
    ok('  · it survives a reload', r.body.serviceSla === 30, r.body.serviceSla);
    /* F4: null, [] and {} are not numbers. `Number([])` is 0, so an empty
       array used to mean "every service is due the day it is bought". */
    for (const bad of [[], {}, 'abc', -5, 999, true]) {
      const x = await req('a', 'PUT', '/api/staff/task-rules',
        { rules: { welcome: { sla: 2 } }, serviceSla: bad });
      ok('  · ' + JSON.stringify(bad) + ' is not a number of days', x.status === 422,
        x.status + ' -> ' + JSON.stringify(x.body && x.body.serviceSla));
    }
    r = await req('a', 'GET', '/api/staff/task-rules');
    ok('  · and none of them turned into "due today"', r.body.serviceSla === 30,
      'serviceSla=' + r.body.serviceSla);
    await req('a', 'PUT', '/api/staff/task-rules',
      { rules: { welcome: { sla: 2 } }, serviceSla: 14 });
  }

  /* ---- and what fixing the above broke, which an agent caught ---- */

  /* N1: coverage is worked out from the templates that name a service, and
     the two visa templates named none — so buying the visa service, in the
     DEFAULT configuration, produced its two journey tasks AND a generic
     twin on top. */
  {
    const v = await buyer('visabuy', ['visa']);
    const visaRows = v.tasks.filter(t => /visa/i.test(t.key));
    ok('buying the visa service gives its two steps and no twin',
      visaRows.length === 2 && !v.tasks.some(t => t.key === 'svc:visa'),
      visaRows.map(t => t.key).join(','));
  }

  /* N2: an out-of-range service SLA returned 200, stored nothing, and reset
     the office's own figure to the default — while the screen said Saved. */
  {
    await req('a', 'PUT', '/api/staff/task-rules', { rules: { welcome: { sla: 2 } }, serviceSla: 21 });
    for (const bad of [999, -5, 'abc']) {
      r = await req('a', 'PUT', '/api/staff/task-rules',
        { rules: { welcome: { sla: 2 } }, serviceSla: bad });
      ok('a service length of ' + JSON.stringify(bad) + ' is refused, not silently reset',
        r.status === 422, r.status + ' ' + ((r.body || {}).error || ''));
    }
    r = await req('a', 'GET', '/api/staff/task-rules');
    ok('  · and the office’s own figure is still there', r.body.serviceSla === 21, r.body.serviceSla);
    await req('a', 'PUT', '/api/staff/task-rules', { rules: { welcome: { sla: 2 } }, serviceSla: 14 });
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
