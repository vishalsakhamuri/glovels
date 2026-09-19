/*
 * What a hostile — or merely careless — caller can do to the task board.
 *
 * Every case here is one a test agent found on the built feature, and every
 * one of them was real. Two were older than the feature and app-wide.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

const jar = {};
async function req(who, method, path, body, raw) {
  const h = { 'content-type': 'application/json' };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, {
    method, headers: h,
    body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
const login = (who, e, p) => req(who, 'POST', '/api/auth/login', { email: e, password: p });
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const stamp = Date.now().toString(36);
  await login('a', 'admin@glovels.com', 'glovels123');

  let r = await req('a', 'POST', '/api/staff/people',
    { name: 'Hard Counsellor', email: 'hc' + stamp + '@glovels.com', password: 'hc-' + stamp, role: 'counsellor' });
  const cId = r.body.person.id;
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Hard Student', email: 'hs' + stamp + '@ex.example', password: 'hs-' + stamp, role: 'student' });
  const sId = r.body.person.id;
  await req('a', 'PUT', '/api/staff/student/' + sId + '/counsellor', { counsellorId: cId });
  r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks', { title: 'A real task', due: day(4) });
  const tId = r.body.task.id;

  /* ---- 1. a body of the four characters `null` ----
     JSON.parse('null') is null, and every handler writes b.something on the
     next line. This was a 500 on every route in the application, including
     the sign-in page, where nobody is authenticated yet. */
  for (const [m, p] of [
    ['POST', '/api/staff/student/' + sId + '/tasks'],
    ['PUT', '/api/staff/task/' + tId],
    ['POST', '/api/staff/student/' + sId + '/guide'],
    ['PUT', '/api/staff/task-rules'],
    ['POST', '/api/auth/login'],
  ]) {
    r = await req('a', m, p, undefined, 'null');
    ok('a body of `null` on ' + m + ' ' + p.replace(/\d+/g, ':id') + ' does not crash the server',
      r.status !== 500, r.status);
  }
  for (const raw of ['[1,2,3]', '"hi"', '{{{', '']) {
    r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks', undefined, raw);
    ok('  · nor does ' + JSON.stringify(raw), r.status !== 500, r.status);
  }

  /* ---- 2. a date that looks like one but is not a day ----
     Ten characters in the right shape is not a calendar check. A task dated
     2026-13-45 can never be compared to today, so it is never late, never
     chased and never breached — silently untrackable, which is the exact
     failure this feature exists to prevent. */
  for (const bad of ['2026-13-45', '2026-02-30', '0000-00-00', '2026-00-10', '2026-06-32']) {
    r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks', { title: 'x', due: bad });
    ok('a task dated ' + bad + ' is refused', r.status === 422, r.status + ' ' + ((r.body || {}).error || ''));
  }
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { due: '2026-13-45' });
  ok('  · and it cannot be edited in either', r.status === 422, r.status);
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { due: '2028-02-29' });
  ok('  · a real leap day is accepted', r.ok, r.status + ' ' + ((r.body || {}).error || ''));
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { due: '2027-02-29' });
  ok('  · a leap day in a non-leap year is not', r.status === 422, r.status);
  await req('a', 'PUT', '/api/staff/task/' + tId, { due: day(4) });

  /* ---- 3. an owner who is not a person ----
     Unchecked, `Number(true)` is 1, which is somebody — so a malformed
     request quietly handed the task to whoever holds id 1. The rest put
     phantom names on the office's scoreboard. */
  for (const bad of [-5, 999999, true, 'abc', {}, [], 0, 1.5]) {
    r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks',
      { title: 'owner test', due: day(3), ownerId: bad });
    ok('an owner of ' + JSON.stringify(bad) + ' is refused', r.status === 422,
      r.status + ' -> ownerId=' + JSON.stringify(((r.body || {}).task || {}).ownerId));
  }
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { ownerId: 999999 });
  ok('  · on edit too', r.status === 422, r.status);
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { ownerId: cId });
  ok('  · a real counsellor is accepted', r.ok && Number(r.body.task.ownerId) === Number(cId), r.status);
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { ownerId: sId });
  ok('  · a STUDENT is not somebody who can own work', r.status === 422, r.status);
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { ownerId: null });
  /* Clearing the owner does not orphan the work: a task with nobody named on
     it is owed by whoever holds the file today, which is the whole reason
     the column is allowed to be null. */
  ok('  · and it can be handed back to whoever holds the file',
    r.ok && Number(r.body.task.ownerId) === Number(cId),
    r.status + ' -> ' + JSON.stringify((r.body.task || {}).owner));

  /* The scoreboard must therefore only ever name real people. */
  r = await req('a', 'GET', '/api/staff/tasks?state=all');
  ok('the scoreboard names nobody who does not exist',
    (r.body.people || []).every(p => p.id == null || p.name),
    JSON.stringify((r.body.people || []).map(p => p.id + ':' + p.name)));

  /* ---- 4. a field that is not text ----
     String({}) is "[object Object]", and String(['done']) is "done" — so an
     array walked straight through the status whitelist. */
  for (const bad of [{ a: 1 }, ['a', 'b'], 5, true]) {
    r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks', { title: bad, due: day(3) });
    ok('a title of ' + JSON.stringify(bad) + ' is refused', r.status === 422,
      r.status + ' -> ' + JSON.stringify(((r.body || {}).task || {}).title));
  }
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { status: ['done'] });
  ok('a status smuggled inside an array is refused', r.status === 422,
    r.status + ' -> ' + JSON.stringify(((r.body || {}).task || {}).status));
  r = await req('a', 'PUT', '/api/staff/task/' + tId, { note: { x: 1 } });
  ok('a note that is not text is refused', r.status === 422, r.status);
  r = await req('a', 'POST', '/api/staff/student/' + sId + '/guide', { body: {} });
  ok('a question that is not text is refused', r.status === 422, r.status);

  /* ---- 5. the standard list is not wiped by a malformed body ----
     saveRules rebuilds the whole block from what it is given, so anything
     that was not a map of rules reset every SLA in the office and re-dated
     every open task — with a 200 and no sign anything had happened. */
  await req('a', 'PUT', '/api/staff/task-rules', { rules: { welcome: { title: 'KEEP ME', sla: 9 } } });
  for (const bad of [{ rules: 'x' }, { rules: 5 }, { rules: [] }, { rules: {} }, {}]) {
    r = await req('a', 'PUT', '/api/staff/task-rules', bad);
    ok('the standard list survives ' + JSON.stringify(bad), r.status === 422, r.status);
  }
  r = await req('a', 'GET', '/api/staff/task-rules');
  const kept = (r.body.rules || []).find(x => x.key === 'welcome');
  ok('  · the office’s own wording is still there', kept && kept.title === 'KEEP ME' && kept.due.sla === 9,
    JSON.stringify(kept || {}));
  await req('a', 'PUT', '/api/staff/task-rules',
    { rules: { welcome: { title: 'Welcome call and file opened', sla: 2 } } });

  /* ---- 6. a deleted student leaves nothing behind ----
     staff_notes were deleted by a column that does not exist, so the
     statement threw, the catch ate it, and no note was ever removed for
     anybody. A deleted student's questions stayed on the office's board
     addressed to "Unknown", and could still be answered. */
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Doomed Student', email: 'dm' + stamp + '@ex.example', password: 'dm-' + stamp, role: 'student' });
  const dId = r.body.person.id;
  await req('a', 'PUT', '/api/staff/student/' + dId + '/counsellor', { counsellorId: cId });
  await req('a', 'POST', '/api/staff/student/' + dId + '/tasks', { title: 'Doomed task', due: day(5) });
  r = await req('a', 'POST', '/api/staff/student/' + dId + '/guide',
    { kind: 'question', body: 'A question about somebody who is about to be deleted' });
  const ghostQ = (r.body.notes || []).find(n => n.kind === 'question');
  r = await req('a', 'DELETE', '/api/staff/people/' + dId);
  ok('a student can be deleted', r.ok || r.status === 200, r.status + ' ' + ((r.body || {}).error || ''));

  r = await req('a', 'GET', '/api/staff/questions');
  const ghosts = [...(r.body.open || []), ...(r.body.answered || [])]
    .filter(q => Number(q.studentId) === Number(dId));
  ok('  · and their questions go with them', ghosts.length === 0,
    JSON.stringify(ghosts.map(g => g.student + ': ' + g.body)).slice(0, 200));
  r = await req('a', 'GET', '/api/staff/tasks?state=all');
  ok('  · and so do their tasks',
    !(r.body.tasks || []).some(t => Number(t.studentId) === Number(dId)),
    (r.body.tasks || []).filter(t => Number(t.studentId) === Number(dId)).length);
  ok('  · and the board still reads', r.ok && Array.isArray(r.body.tasks), r.status);
  if (ghostQ) {
    r = await req('a', 'POST', '/api/staff/note/' + ghostQ.id + '/reply', { body: 'to nobody' });
    ok('  · and nobody can answer a question on a student who is gone', r.status === 404, r.status);
  }

  /* ---- 7. a counsellor's work outlives the counsellor ---- */
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Leaving Soon', email: 'ls' + stamp + '@glovels.com', password: 'ls-' + stamp, role: 'counsellor' });
  const gone = r.body.person.id;
  r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks',
    { title: 'Work they owed', due: day(6), ownerId: gone });
  const orphanTask = r.body.task.id;
  await req('a', 'DELETE', '/api/staff/people/' + gone);
  r = await req('a', 'GET', '/api/staff/tasks?state=all');
  const survived = (r.body.tasks || []).find(t => Number(t.id) === Number(orphanTask));
  ok('work owed by somebody who leaves does not vanish with them', !!survived,
    'task ' + orphanTask + ' gone from the board');
  ok('  · it goes back to whoever holds the file', survived && survived.owner !== '',
    JSON.stringify(survived || {}).slice(0, 160));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
