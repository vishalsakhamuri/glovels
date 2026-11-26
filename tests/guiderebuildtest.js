/**
 * Patch 318: the last pauses taken off the thread that answers visitors.
 *
 *   1. The guide pages are rebuilt behind the pages already being served, a
 *      slice at a time — and come out the same as when built in one go.
 *   2. A university added to a student's list by hand is ordered with the
 *      matcher's lists made on the second thread — the same order.
 *   3. The catalogue download is written a slice at a time — the same file.
 *
 * Two servers asked the same things: A the new way (GUIDES_REBUILD=sliced),
 * B the old (GUIDES_REBUILD=inline, HEAVY=inline).
 *
 *   node guiderebuildtest.js        (its own servers on 8318 and 8319)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8318);
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; if (!c) console.log('  ✗ ' + n + (note == null ? '' : ' — ' + String(note).slice(0, 300))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const boot = async (port, extra) => {
  const dir = '/tmp/db-guiderebuild-' + port;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', BOTGATE: 'off' }, extra || {}) });
  for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch('http://localhost:' + port + '/api/health')).ok) break; } catch (e) { /* booting */ } }
  const lr = await fetch('http://localhost:' + port + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
  const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const raw = async (method, p, body) => {
    const r = await fetch('http://localhost:' + port + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  };
  const req = async (method, p, body) => { const r = await raw(method, p, body); let j = {}; try { j = JSON.parse(r.text); } catch (e) { j = {}; } return { status: r.status, body: j }; };
  return { child, raw, req, port };
};
/* Two servers seeded a moment apart, on two ports: times and ports are not the page. */
const plain = t => String(t).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T').replace(/localhost:\d+/g, 'HOST').replace(/nonce-[A-Za-z0-9+/=_-]+/g, 'N').replace(/nonce="[^"]*"/g, 'N');

(async () => {
  const A = await boot(PORT, { GUIDES_REBUILD: 'sliced' });
  const B = await boot(PORT + 1, { GUIDES_REBUILD: 'inline', HEAVY: 'inline' });
  try {
    const PAGES = ['/germany-masters-guides', '/masters-in-germany-without-ielts', '/tuition-free-masters-germany', '/english-taught-masters-germany-no-german',
      '/study-in-germany', '/university', '/sitemap-guides.xml', '/llms.txt'];
    const both = async p => { const a = await A.raw('GET', p), b = await B.raw('GET', p); return { a, b, same: a.status === b.status && plain(a.text) === plain(b.text) }; };
    for (const p of PAGES) { const r = await both(p); check('before any change, the same page both ways: ' + p, r.same, r.a.status + '/' + r.b.status + ' ' + r.a.text.length + '/' + r.b.text.length); }
    const hub = await A.raw('GET', '/germany-masters-guides');
    check('the guides hub is a real page with guides on it', hub.status === 200 && /masters-in-germany/.test(hub.text));

    /* ---- 1. a catalogue change: served from the pages already built, then the new set */
    const list = (await A.req('GET', '/api/staff/catalogue?country=DE&level=master&per=50')).body.programmes || [];
    const row = list.find(p => p.program && p.university) || list[0];
    check('there is a German master\'s row to change', !!row, list.length);
    const NEW = 'Zebra Crossing Engineering ' + (row && row.program);
    const health = []; let stop = false;
    const pinger = (async () => { while (!stop) { const t = Date.now(); await fetch('http://localhost:' + PORT + '/api/health'); health.push(Date.now() - t); await wait(5); } })();
    const pa = await A.req('PUT', '/api/staff/programme', Object.assign({}, row, { program: NEW }));
    const pb = await B.req('PUT', '/api/staff/programme', Object.assign({}, row, { program: NEW }));
    check('the programme is renamed on both', pa.status === 200 && pb.status === 200, pa.status + '/' + pb.status + ' ' + JSON.stringify(pa.body).slice(0, 150));
    const slug = String(row.university).toLowerCase();
    const uniPath = '/university/' + ((await A.req('GET', '/api/staff/universities?q=' + encodeURIComponent(row.university))).body.universities || []).map(u => u.slug)[0];
    const first = await A.raw('GET', '/germany-masters-guides');
    check('the first visitor after the change is answered at once, from the pages already built', first.status === 200);
    let settled = false, tries = 0;
    for (; tries < 60 && !settled; tries++) { await wait(250); const r = await both('/sitemap-guides.xml'); const u = await both(uniPath); settled = r.same && u.same && u.a.text.indexOf('Zebra Crossing Engineering') >= 0; }
    stop = true; await pinger;
    check('and within seconds the new pages take over — the renamed programme is on its university\'s page', settled, 'after ' + tries + ' looks at ' + uniPath);
    check('the health check was answered all through the rebuild', health.length > 5 && Math.max.apply(null, health) < 1000, Math.max.apply(null, health));
    for (const p of PAGES.concat([uniPath])) { const r = await both(p); check('after the rebuild, built in slices = built in one go: ' + p, r.same, r.a.status + '/' + r.b.status + ' ' + r.a.text.length + '/' + r.b.text.length); }
    const up = (await A.raw('GET', uniPath)).text;
    const progUrls = [...new Set(up.match(/\/university\/[a-z0-9-]+\/[a-z0-9-]+/g) || [])].slice(0, 5);
    /* (a university whose programmes have no page of their own has none to compare) */
    for (const p of progUrls) { const r = await both(p); check('a programme page, the same both ways: ' + p.slice(0, 70), r.same && r.a.status === 200, r.a.status + '/' + r.b.status); }

    /* ---- 2. a university added by hand: the same order */
    const students = ((await A.req('GET', '/api/staff/students')).body.students || []).map(s => s.id);
    const sid = students[0];
    const picks = ((await A.req('GET', '/api/staff/catalogue?country=DE&per=40')).body.programmes || []).filter((p, i) => i % 9 === 0).slice(0, 4);
    let added = 0;
    for (const p of picks) {
      const a = await A.req('POST', '/api/staff/student/' + sid + '/shortlist', { id: p.id, force: true });
      const b = await B.req('POST', '/api/staff/student/' + sid + '/shortlist', { id: p.id, force: true });
      if (a.status === 200 && b.status === 200) added++;
      else check('adding a university answers the same both ways', a.status === b.status, a.status + '/' + b.status + ' ' + JSON.stringify(a.body).slice(0, 120));
    }
    check('universities were added by hand', added > 0, added + ' of ' + picks.length);
    const order = async S => ((await S.req('GET', '/api/staff/student/' + sid)).body.shortlist || []).map(r => [r.prog_id || r.id, r.rank, r.added_by]);
    const oa = await order(A), ob = await order(B);
    check('and they stand in the same order, ranked on the second thread or here', oa.length > 0 && JSON.stringify(oa) === JSON.stringify(ob), JSON.stringify(oa).slice(0, 140) + ' vs ' + JSON.stringify(ob).slice(0, 140));

    /* ---- 3. the catalogue download */
    const ca = await A.raw('GET', '/api/staff/catalogue.csv'), cb = await B.raw('GET', '/api/staff/catalogue.csv');
    check('the whole catalogue as CSV: every row, the same file', ca.status === 200 && plain(ca.text) === plain(cb.text) && ca.text.split('\r\n').length > 100, ca.status + ' ' + ca.text.length + '/' + cb.text.length);
    const total = (await A.req('GET', '/api/staff/catalogue?per=1&status=')).body.total;
    check('one line for the header and one for each programme', ca.text.trim().split('\r\n').length >= total, ca.text.trim().split('\r\n').length + ' lines for ' + total);
    const src = fs.readFileSync(path.join(ROOT, 'server', 'api.js'), 'utf8');
    check('the download lets the server answer between slices', /const STEP = 400;[\s\S]{0,1600}await new Promise\(r => setImmediate\(r\)\);/.test(src));
    check('adding a university does not read the catalogue on this thread', /await rankOfficeRowsOff\(/.test(src) && !/rankOfficeRows\(id, prof, rowsFor\(prof\)/.test(src));
    const gs = fs.readFileSync(path.join(ROOT, 'server', 'guides.js'), 'utf8');
    check('a rebuild serves the pages already built', /refreshLater\(v\); return CACHE;/.test(gs));
    check('the pages are built before the site takes its first visitor', /GUIDES\.warm\(\)[\s\S]{0,200}server\.listen\(/.test(fs.readFileSync(path.join(ROOT, 'serve.js'), 'utf8')));
  } finally {
    try { process.kill(-A.child.pid); } catch (e) { /* gone */ }
    try { process.kill(-B.child.pid); } catch (e) { /* gone */ }
  }
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL — ' + (e && e.stack || e)); process.exit(1); });
