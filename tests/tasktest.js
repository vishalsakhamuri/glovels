/*
 * The task board, end to end.
 *
 * What the office asked for, in the order they asked for it:
 *   a list of tasks per student, driven by what they bought
 *   every task with a date, worked back from the university's deadline where
 *     there is one and forward from the file's start where there is not
 *   one submission task per university, on that university's own date
 *   the office able to see who is behind, and to chase them
 *   the counsellor and the office both told when a date goes past
 *   the student able to see progress and nothing else
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (extra ?? ''))); };

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
const login = (who, email, password) => req(who, 'POST', '/api/auth/login', { email, password });
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const stamp = Date.now().toString(36);
  await login('admin', 'admin@glovels.com', 'glovels123');

  /* A counsellor and a student of their own, so nothing here depends on the
     demo data that the testers delete. */
  const cEmail = 'tc' + stamp + '@glovels.com', cPw = 'tc-' + stamp;
  let r = await req('admin', 'POST', '/api/staff/people',
    { name: 'Task Counsellor', email: cEmail, password: cPw, role: 'counsellor' });
  ok('a counsellor can be made', r.ok, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  const cId = (r.body && (r.body.person || {}).id) || null;

  const sEmail = 'ts' + stamp + '@ex.example', sPw = 'ts-' + stamp;
  r = await req('admin', 'POST', '/api/staff/people',
    { name: 'Task Student', email: sEmail, password: sPw, role: 'student' });
  const sId = (r.body && (r.body.person || {}).id) || null;
  ok('a student can be made', !!sId, JSON.stringify(r.body).slice(0, 160));

  r = await req('admin', 'PUT', '/api/staff/student/' + sId + '/counsellor', { counsellorId: cId });
  ok('and assigned to the counsellor', r.ok, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));

  /* ---- 1. the list exists and is driven by what they bought ---- */
  r = await req('admin', 'GET', '/api/staff/student/' + sId + '/tasks');
  const base = (r.body && r.body.tasks) || [];
  ok('a new file already has the tasks everyone owes', base.length >= 2,
    base.map(t => t.key).join(','));
  ok('  · and every one of them has a date', base.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.due)),
    base.map(t => t.key + '=' + t.due).join(' '));
  ok('  · with nobody holding a visa task they did not buy',
    !base.some(t => t.key === 'visa' || t.key === 'submit'), base.map(t => t.key).join(','));

  /* ---- 2. dates: forwards from the start where there is no deadline ---- */
  const welcome = base.find(t => t.key === 'welcome');
  ok('the welcome call is dated from the day the file opened', welcome && welcome.basis === 'sla',
    welcome && welcome.basis);

  /* ---- 3. a university brings its own submission task, on its own date ---- */
  const cat = await req('admin', 'GET', '/api/staff/catalogue?per=60');
  const withDeadline = ((cat.body && cat.body.programmes) || []).find(p => {
    let ins = p.intakes; if (typeof ins === 'string') { try { ins = JSON.parse(ins); } catch (e) { ins = []; } }
    return (ins || []).some(i => i && /^\d{4}-\d{2}-\d{2}$/.test(String(i.deadline || ''))
      && i.deadline > day(30));
  });
  if (!withDeadline) {
    ok('a programme with a deadline more than a month out exists to test with', false, 'none in the catalogue');
  } else {
    let ins = withDeadline.intakes;
    if (typeof ins === 'string') { try { ins = JSON.parse(ins); } catch (e) { ins = []; } }
    const deadline = (ins || []).map(i => i && i.deadline).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))).sort()
      .find(d => d > day(30));

    /* The apply stage comes from an order, so give them one. Bought as
       themselves, which is how a real one arrives and is what puts their id
       on the row. */
    await login('s', sEmail, sPw);
    await req('s', 'POST', '/api/auth/change', { password: sPw + 'X' });
    await login('s', sEmail, sPw + 'X');
    r = await req('s', 'POST', '/api/orders', {
      packageId: 'pkg-offer', name: 'Task Student', email: sEmail, phone: '9876543210',
      acceptedTerms: true,
    });
    const boughtApply = r.ok;
    ok('an application package can be bought against the file', boughtApply,
      r.status + ' ' + JSON.stringify(r.body).slice(0, 200));

    r = await req('admin', 'POST', '/api/staff/student/' + sId + '/shortlist', { id: withDeadline.id });
    ok('and a university put on their shortlist', r.ok, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));

    r = await req('admin', 'GET', '/api/staff/student/' + sId + '/tasks');
    const rows = (r.body && r.body.tasks) || [];
    const submit = rows.find(t => t.key === 'submit');
    ok('the submission task appeared for that university', !!submit,
      rows.map(t => t.key).join(','));
    if (submit) {
      ok('  · named after it', /—/.test(submit.title), submit.title);
      ok('  · dated a week before the university closes, not after',
        submit.basis === 'deadline' && submit.due < deadline,
        submit.due + ' vs deadline ' + deadline);
      const want = new Date(new Date(deadline).getTime() - 7 * 864e5).toISOString().slice(0, 10);
      ok('  · seven days before, exactly', submit.due === want, submit.due + ' wanted ' + want);
    }
    const sop = rows.find(t => t.key === 'sop');
    if (boughtApply) {
      ok('the SOP is dated backwards from the deadline too', sop && sop.basis === 'deadline',
        sop ? sop.basis : 'no sop task');
    }
  }

  /* ---- 4. the office's board, and who is behind ---- */
  r = await req('admin', 'GET', '/api/staff/tasks?state=all');
  ok('the office can see the whole board', r.ok && Array.isArray(r.body.tasks),
    r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  ok('  · with a line per person saying how they are doing',
    r.ok && Array.isArray(r.body.people) && r.body.people.some(p => Number(p.id) === Number(cId)),
    JSON.stringify((r.body || {}).people || []).slice(0, 200));

  /* ---- 5. a task somebody adds by hand ---- */
  r = await req('admin', 'POST', '/api/staff/student/' + sId + '/tasks',
    { title: 'Call the father about funds', due: day(3) });
  const mine = r.body && r.body.task;
  ok('an administrator can add a task of their own', r.ok && mine && mine.source === 'manual',
    r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  r = await req('admin', 'POST', '/api/staff/student/' + sId + '/tasks',
    { title: 'Something overdue on arrival', due: day(-4) });
  ok('  · but not one that was already due last week', r.status === 422,
    r.status + ' ' + ((r.body || {}).error || ''));
  r = await req('admin', 'POST', '/api/staff/student/' + sId + '/tasks', { title: 'No date' });
  ok('  · and not one with no date at all', r.status === 422, r.status);

  /* ---- 6. marking it done ---- */
  r = await req('admin', 'PUT', '/api/staff/task/' + mine.id, { status: 'done' });
  ok('marking a task done records the day and the person',
    r.ok && r.body.task.status === 'done' && r.body.task.done && r.body.task.doneBy,
    JSON.stringify((r.body || {}).task || {}).slice(0, 200));
  r = await req('admin', 'PUT', '/api/staff/task/' + mine.id, { status: 'open' });
  ok('  · and reopening it takes them back off',
    r.ok && !r.body.task.done && !r.body.task.doneBy, JSON.stringify((r.body || {}).task || {}).slice(0, 160));
  r = await req('admin', 'PUT', '/api/staff/task/' + mine.id, { status: 'finished-ish' });
  ok('  · a state that does not exist is refused', r.status === 422, r.status);

  /* ---- 7. a generated task cannot be deleted, only retired ---- */
  const auto = (await req('admin', 'GET', '/api/staff/student/' + sId + '/tasks')).body.tasks
    .find(t => t.source === 'auto');
  r = await req('admin', 'DELETE', '/api/staff/task/' + auto.id);
  ok('a task from the standard list cannot be deleted', r.status === 409,
    r.status + ' ' + ((r.body || {}).error || ''));
  r = await req('admin', 'PUT', '/api/staff/task/' + auto.id, { status: 'dropped' });
  ok('  · it is marked as not applying instead', r.ok && r.body.task.status === 'dropped', r.status);

  /* ---- 8. what the counsellor may and may not do ---- */
  await login('c', cEmail, cPw);
  await req('c', 'POST', '/api/auth/change', { password: cPw + 'X' });
  await login('c', cEmail, cPw + 'X');
  r = await req('c', 'GET', '/api/staff/tasks?state=all');
  ok('the counsellor sees their own board', r.ok && r.body.tasks.length > 0,
    r.status + ' ' + ((r.body || {}).tasks || []).length);
  ok('  · and only their own students', r.ok && r.body.tasks.every(t => Number(t.studentId) === Number(sId)),
    [...new Set((r.body.tasks || []).map(t => t.studentId))].join(','));
  r = await req('c', 'PUT', '/api/staff/task/' + mine.id, { status: 'doing' });
  ok('  · they can move their own work along', r.ok && r.body.task.status === 'doing', r.status);
  r = await req('c', 'PUT', '/api/staff/task/' + mine.id, { ownerId: null });
  ok('  · but cannot hand it to somebody else', r.status === 403,
    r.status + ' ' + ((r.body || {}).error || ''));

  /* ---- 9. the office chases them, and it leaves the building ---- */
  r = await req('admin', 'POST', '/api/staff/student/' + sId + '/guide',
    { body: 'The SOP is nine days late. Please finish it by Friday.' });
  ok('the office can send the counsellor a word about the file', r.ok,
    r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  r = await req('c', 'GET', '/api/staff/student/' + sId + '/guidance');
  ok('  · and the counsellor has it', r.ok && (r.body.notes || []).some(n => /nine days late/.test(n.body)),
    JSON.stringify((r.body || {}).notes || []).slice(0, 200));

  /* ---- 10. the standard list is the office's to change ---- */
  r = await req('admin', 'GET', '/api/staff/task-rules');
  ok('the standard list can be read', r.ok && (r.body.rules || []).length >= 8,
    ((r.body || {}).rules || []).length);
  r = await req('admin', 'PUT', '/api/staff/task-rules', { rules: { welcome: { sla: 1 } } });
  ok('  · and its days changed', r.ok && (r.body.rules || []).find(x => x.key === 'welcome').due.sla === 1,
    JSON.stringify(((r.body || {}).rules || []).find(x => x.key === 'welcome') || {}));
  r = await req('c', 'PUT', '/api/staff/task-rules', { rules: { welcome: { sla: 9 } } });
  ok('  · by an administrator and nobody else', r.status === 403, r.status);
  await req('admin', 'PUT', '/api/staff/task-rules', { rules: {} });

  /* ---- 11. the student sees progress, and nothing about who is late ---- */
  r = await req('s', 'GET', '/api/state');
  const prog = r.body && r.body.progress;
  ok('the student can see how far along they are', prog && prog.total > 0,
    JSON.stringify(prog || {}).slice(0, 200));
  ok('  · as steps with target dates', prog && prog.steps.every(x => x.title && x.state),
    JSON.stringify((prog || {}).steps || []).slice(0, 200));
  const leak = JSON.stringify((prog || {}).steps || []);
  ok('  · and nothing about the counsellor or who is behind',
    !/Task Counsellor|over|owner|blocked|late/i.test(leak), leak.slice(0, 200));
  ok('  · with the retired task out of their list',
    prog && !prog.steps.some(x => x.title === auto.title), (prog || {}).total);

  /* ---- 12. the sweep decides who to tell ---- */
  r = await req('admin', 'GET', '/api/staff/tasks?state=late');
  ok('the board can be asked for only what is late', r.ok, r.status);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
