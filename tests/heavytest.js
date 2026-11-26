/**
 * Patch 316 (the outage of 26 Nov 2026): "it cannot crash — if someone is
 * checking the catalogue". A tag search with no word typed, and the fit test,
 * read the whole catalogue on the web server's one thread: ten seconds and
 * five seconds in which nobody was answered, and the host restarted the site.
 *
 * That work is done by a second reader on its own thread now (server/heavy.js).
 * This holds it to the same answers as before: one server with the second
 * reader, one doing the work the old way (HEAVY=inline), asked the same things.
 *
 *   node heavytest.js        (starts its own two servers on 8316 and 8317)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8316);
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; if (!c) console.log('  ✗ ' + n + (note == null ? '' : ' — ' + String(note).slice(0, 300))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const boot = async (port, dir, extra) => {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', BOTGATE: 'off' }, extra || {}) });
  for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch('http://localhost:' + port + '/api/health')).ok) break; } catch (e) { /* booting */ } }
  const lr = await fetch('http://localhost:' + port + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
  const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const req = async (method, p, body) => {
    const r = await fetch('http://localhost:' + port + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) { j = { text }; }
    return { status: r.status, body: j };
  };
  return { child, req, dir };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  /* ---- the row's part and the tags' part give match()'s answer, row by row */
  const TAGS = require(path.join(ROOT, 'server', 'tags.js'));
  const UNIS = require(path.join(ROOT, 'server', 'unis.js'));
  const A = await boot(PORT, '/tmp/db-heavy-' + PORT, {});
  const B = await boot(PORT + 1, '/tmp/db-heavy-' + (PORT + 1), { HEAVY: 'inline' });
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(path.join(A.dir, 'glovels.db'), { readOnly: true });
    const rows = d.prepare('SELECT * FROM programmes').all().map(UNIS.fromRow);
    d.close();
    check('the test has a catalogue to look at', rows.length > 100, rows.length);
    const seen = new Map();
    rows.forEach(p => TAGS.tagsOf(p).forEach(t => seen.set(t, (seen.get(t) || 0) + 1)));
    const some = [...seen.keys()].slice(0, 400);
    const lists = some.map(t => [t]).concat(
      [['MOI accepted'], ['moi'], ['Public University'], ['Private University'], ['Restricted admission'], ['Nothing Has This Tag'],
       ['Public University', some[0]], [some[1], some[2]], [some[3], some[4], 'Private University'], ['Berlin'], ['Munich', 'Berlin'], ['HS Bremen']],
      some.slice(0, 60).map((t, i) => [t, some[(i * 7 + 3) % some.length]]));
    const preps = rows.map(p => TAGS.prep(p));
    let differ = 0, first = '';
    for (const list of lists) {
      const test = TAGS.matcher(list);
      for (let i = 0; i < rows.length; i++) {
        if (test(preps[i]) !== TAGS.match(rows[i], list, '')) { differ++; if (!first) first = JSON.stringify(list) + ' on ' + rows[i].id; }
      }
    }
    check('the kept form of a row answers every tag question as the row itself does (' + lists.length + ' tag lists × ' + rows.length + ' rows)', differ === 0, differ + ' differ, first: ' + first);
    check('a kept row survives being sent between threads', same(JSON.parse(JSON.stringify(preps[0])), preps[0]));

    /* ---- the two servers, asked the same things */
    const tag1 = some.find(t => seen.get(t) > 30 && seen.get(t) < rows.length - 30) || some[0];
    const asks = [
      '/api/staff/catalogue?q=&tags=' + encodeURIComponent(tag1) + '&per=24&status=',
      '/api/staff/catalogue?q=&tags=' + encodeURIComponent(tag1) + '&per=24&status=&page=2',
      '/api/staff/catalogue?tags=' + encodeURIComponent(tag1 + ';Public University') + '&per=50',
      '/api/staff/catalogue?tags=MOI%20accepted&country=DE&per=10',
      '/api/staff/catalogue?q=computer&tags=' + encodeURIComponent(tag1),
      '/api/staff/catalogue?tags=Nothing%20Has%20This%20Tag',
      '/api/staff/catalogue?tags=Private%20University&status=1&level=master&cgpa=7',
      '/api/staff/catalogue/ids?tags=' + encodeURIComponent(tag1),
      '/api/staff/catalogue/ids?tags=Public%20University&country=DE',
      '/api/staff/catalogue?per=24',
      '/api/staff/catalogue/ids',
    ];
    for (const p of asks) {
      const a = await A.req('GET', p), b = await B.req('GET', p);
      const strip = x => JSON.stringify(x.body).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T');   /* two servers seeded a moment apart */
      check('same answer from the second reader as the old way: ' + p.slice(0, 80), a.status === 200 && b.status === 200 && strip(a) === strip(b),
        a.status + '/' + b.status + ' totals ' + a.body.total + '/' + b.body.total);
    }
    const tagged = await A.req('GET', asks[0]);
    check('a tag search finds rows, a page of them', tagged.body.total > 0 && (tagged.body.programmes || []).length === Math.min(24, tagged.body.total), tagged.body.total);
    check('"select all" on a tag covers what the screen counts', (await A.req('GET', asks[7])).body.total === tagged.body.total);

    const people = ((await A.req('GET', '/api/staff/students')).body.students || []).slice(0, 6).map(s => s.id);
    check('there are students to test the fit on', people.length > 0, people.length);
    for (const id of people) {
      for (const q of ['', '?kind=public', '?tags=' + encodeURIComponent(tag1), '?limit=500&ceiling=0']) {
        const a = await A.req('GET', '/api/staff/student/' + id + '/fit' + q), b = await B.req('GET', '/api/staff/student/' + id + '/fit' + q);
        check('the fit test answers the same: student ' + id + ' ' + q, a.status === b.status && same(a.body, b.body), a.status + '/' + b.status + ' ' + JSON.stringify(a.body.counts) + ' vs ' + JSON.stringify(b.body.counts));
      }
    }
    const typed = { profile: { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science', d_cgpa: '7.5', d_max: '10' }, filters: {} };
    const fa = await A.req('POST', '/api/staff/fit', typed), fb = await B.req('POST', '/api/staff/fit', typed);
    check('a typed-in profile: the same fits, and some', fa.status === 200 && same(fa.body, fb.body) && fa.body.counts.looked > 0, JSON.stringify(fa.body.counts));
    const again = await A.req('GET', '/api/staff/student/' + people[0] + '/fit');
    check('asked twice, the route still adds its own lines (a remembered answer is not shared)', Array.isArray(again.body.onList) && again.body.bought !== undefined);
    const empty = await A.req('POST', '/api/staff/fit', { profile: {}, filters: {} });
    check('an empty profile is still told what is needed, without the catalogue being read', empty.status === 200 && empty.body.usable === false && (empty.body.needs || []).length === 2);

    /* ---- a change to the catalogue is seen at once */
    const row = tagged.body.programmes[0];
    const none = await A.req('GET', '/api/staff/catalogue?tags=Zebra%20Crossing%20Tag');
    const put = await A.req('PUT', '/api/staff/programme', Object.assign({}, row, { tags: ['Zebra Crossing Tag'] }));
    const one = await A.req('GET', '/api/staff/catalogue?tags=Zebra%20Crossing%20Tag');
    check('a tag written on a programme is found by the next search', none.body.total === 0 && put.status === 200 && one.body.total === 1 && one.body.programmes[0].id === row.id,
      none.body.total + ' / ' + put.status + ' ' + JSON.stringify(put.body).slice(0, 120) + ' / ' + one.body.total);
    const after = await A.req('GET', asks[0]);
    check('and it has left the tag it no longer carries', after.body.total === tagged.body.total - 1 || TAGS.parseList(row.tags || []).length > 0, after.body.total + ' was ' + tagged.body.total);

    /* ---- the second reader really is a second thread */
    const src = fs.readFileSync(path.join(ROOT, 'server', 'api.js'), 'utf8');
    const routeOf = name => { const i = src.indexOf(name); return src.slice(i, i + 4200); };
    check('the catalogue route does not walk the catalogue itself', /await taggedFind\(/.test(routeOf("route('GET', '/api/staff/catalogue', catalogueReader")) && !/= taggedScan\(/.test(routeOf("route('GET', '/api/staff/catalogue', catalogueReader")));
    check('the fit route waits for the second reader', /await fitRun\(/.test(src) && !/[^t] fitRun\(db\.getProfile/.test(src));
    check('when the reader cannot take it on a big catalogue the screen is told busy — the work does not come back to this thread', /if \(catalogueIsBig\(\)\) return \{ busy: true \}/.test(src));
    const health = []; let stop = false;
    const pinger = (async () => { while (!stop) { const t = Date.now(); await fetch('http://localhost:' + PORT + '/api/health'); health.push(Date.now() - t); await wait(10); } })();
    await Promise.all(asks.slice(0, 8).map((p, i) => A.req('GET', p + '&x=' + i)).concat(people.map(id => A.req('GET', '/api/staff/student/' + id + '/fit?limit=' + (300 + id)))));
    stop = true; await pinger;
    check('the health check is answered while tag searches and fit tests run', health.length > 0 && Math.max.apply(null, health) < 1000, Math.max.apply(null, health));
  } finally {
    try { process.kill(-A.child.pid); } catch (e) { /* gone */ }
    try { process.kill(-B.child.pid); } catch (e) { /* gone */ }
  }
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL — ' + (e && e.stack || e)); process.exit(1); });
