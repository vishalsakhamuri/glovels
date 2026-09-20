/*
 * The service catalogue and the tasks that follow it.
 *
 * Its own file because the order endpoint allows ten an hour from one
 * address, and servicetasktest.js already spends nine of them.
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
    { name: 'Cat Counsellor', email: 'cc' + stamp + '@glovels.com', password: 'cc-' + stamp, role: 'counsellor' });
  const cId = r.body.person.id;
  const buyer = async (tag, what) => {
    const e = tag + stamp + '@ex.example', p = tag + '-' + stamp;
    let x = await req('a', 'POST', '/api/staff/people', { name: tag, email: e, password: p, role: 'student' });
    const id = x.body.person.id;
    await req('a', 'PUT', '/api/staff/student/' + id + '/counsellor', { counsellorId: cId });
    await login(tag, e, p);
    await req(tag, 'POST', '/api/auth/change', { password: p + 'X' });
    await login(tag, e, p + 'X');
    x = await req(tag, 'POST', '/api/orders',
      { services: what, name: tag, email: e, phone: '9876543210', acceptedTerms: true });
    if (x.status === 429) {
      console.error('\n  STOPPED: the order endpoint is rate-limited (10/hour per address).');
      console.error('  Restart the server to clear it:  bash tests/srv.sh 8099\n');
      process.exit(2);
    }
    const t = await req('a', 'GET', '/api/staff/student/' + id + '/tasks');
    return { id, tag, tasks: (t.body.tasks || []) };
  };

  /* F5: deleting a service from the catalogue rewrote an already-paid
     task's stored title down to its bare id — losing the only record of
     what the customer actually bought. */
  {
    const cur = (await req('a', 'GET', '/api/staff/content')).body.services;
    const items = (cur.items || []).slice();
    items.push({ id: 'zzztemp', sort: 999, active: true, name: 'Temporary Thing',
      desc: 'x', priceInr: 100, cats: ['top'], levels: [], partners: [] });
    let put = await req('a', 'PUT', '/api/staff/content/services',
      { value: Object.assign({}, cur, { items }) });
    if (!put.ok) {
      ok('a service can be added to the catalogue to test with', false, put.status);
    } else {
      const tmp = await buyer('tmpsvc', ['zzztemp']);
      const before = tmp.tasks.find(t => t.key === 'svc:zzztemp');
      ok('a service the office added itself is named properly',
        before && /Temporary Thing/.test(before.title), before && before.title);
      /* Now remove it from the catalogue entirely. */
      await req('a', 'PUT', '/api/staff/content/services',
        { value: Object.assign({}, cur, { items: (cur.items || []) }) });
      const after = ((await req('a', 'GET', '/api/staff/student/' + tmp.id + '/tasks')).body.tasks || [])
        .find(t => t.key === 'svc:zzztemp');
      ok('  · and keeps its name after the office deletes it from the catalogue',
        after && /Temporary Thing/.test(after.title), after && after.title);
    }
  }

  /* A structure in a text field is not text. An object arriving as a
     service name used to be stored as the five words "[object Object]" and
     shown on the office's board. */
  {
    const cur = (await req('a', 'GET', '/api/staff/content')).body.services;
    const items = (cur.items || []).map(x => x.id === 'insure'
      ? Object.assign({}, x, { name: { a: 1 } }) : x);
    await req('a', 'PUT', '/api/staff/content/services',
      { value: Object.assign({}, cur, { items }) });
    const back = (await req('a', 'GET', '/api/staff/content')).body.services;
    const got = (back.items || []).find(x => x.id === 'insure');
    ok('an object cannot become a service name',
      got && !/object Object/.test(String(got.name)), got && JSON.stringify(got.name));
    await req('a', 'PUT', '/api/staff/content/services', { value: cur });
  }


  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
