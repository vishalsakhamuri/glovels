/**
 * Patch 307: the Traffic and Marketing screens count without holding the server.
 *
 * 120,000 visits are put in the table, the two screens are asked for their
 * numbers, and while the server counts the health check is asked every few
 * milliseconds — it has to keep answering. The numbers have to be the ones
 * the rows give.
 *
 *   node trafficslicetest.js        (starts its own server on 8309)
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8309;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null && note !== '' ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const req = (p, o) => new Promise(resolve => {
  const t0 = Date.now();
  const body = o && o.body ? JSON.stringify(o.body) : null;
  const r = http.request({ host: 'localhost', port: PORT, path: p, method: (o && o.method) || 'GET',
    headers: Object.assign({ 'User-Agent': 'GlovelsQA trafficslicetest' }, body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, (o && o.headers) || {}) }, res => {
    let b = ''; res.on('data', c => { b += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body: b, json: j, ms: Date.now() - t0 }); });
  });
  r.on('error', () => resolve({ status: 0, headers: {}, body: '', json: null, ms: Date.now() - t0 }));
  if (body) r.write(body);
  r.end();
});
/* Ask for something slow and, until it comes back, ask the health check every 15 ms. */
async function whileCounting(p, cookie) {
  let done = false, worst = 0, asked = 0, failed = 0;
  const big = req(p, { headers: { Cookie: cookie } }).then(r => { done = true; return r; });
  while (!done) { const h = await req('/api/health'); asked++; if (h.status !== 200) failed++; worst = Math.max(worst, h.ms); await wait(15); }
  return { r: await big, worst, asked, failed };
}

(async () => {
  const dir = '/tmp/db-trafficslice-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const N = 120000, DAYS = 20;
  const want = { views: 0, visitors: new Set(), people: new Set(), seen: new Set(), bots: 0, byDay: {}, pages: {} };
  {
    const S = require(path.join(ROOT, 'server', 'store.js'));
    const db = S.open(dir);
    const rows = [];
    for (let i = 0; i < N; i++) {
      const d = new Date(Date.now() - (DAYS - 1 - Math.floor((i / N) * DAYS)) * 86400000);
      const day = d.toISOString().slice(0, 10);
      const visitor = 'v' + (i % 211) + '-' + day.slice(5);
      const p = ['/', '/blog', '/find-university', '/study-in-germany', '/university/u' + (i % 90)][i % 5];
      const k = i % 25;
      let h;
      if (k === 0) h = { day, ts: d.toISOString(), path: p, kind: 'bot', bot: 'Googlebot', source: 'search' };
      else if (k < 3 && (i % 211) % 4 === 0) h = { day, ts: d.toISOString(), path: p, kind: 'seen', device: 'phone', visitor, country: 'IN' };
      else h = { day, ts: d.toISOString(), path: p, kind: 'page', source: ['direct', 'search', 'social'][i % 3], site: ['', 'Google', 'Instagram'][i % 3], device: i % 2 ? 'phone' : 'desktop', visitor, country: ['IN', 'NP', 'DE'][i % 3] };
      db.hit(h); rows.push(h);
    }
    rows.forEach(h => { if (h.kind === 'seen') want.seen.add(h.day + '|' + h.visitor); });
    rows.forEach(h => {
      if (h.kind === 'bot') { want.bots++; return; }
      if (h.kind !== 'page') return;
      want.views++; want.visitors.add(h.visitor); want.pages[h.path] = (want.pages[h.path] || 0) + 1;
      want.byDay[h.day] = (want.byDay[h.day] || 0) + 1;
      if (want.seen.has(h.day + '|' + h.visitor)) want.people.add(h.day + '|' + h.visitor);
    });

    /* ---- the slices are the same rows as the one big read */
    const all = db.hitsSince('2000-01-01', ['page', 'seen', 'bot']);
    const span = db.hitsSpan('2000-01-01');
    check('the span is the first and the last row', span && span.a === all[0].id && span.b === all[all.length - 1].id, JSON.stringify(span));
    let ids = [];
    for (let from = span.a; from <= span.b; from += 3000) ids = ids.concat(db.hitsSlice(from, from + 3000, '2000-01-01', ['page', 'seen', 'bot']).map(r => r.id));
    check('the slices give every row once, in order', ids.length === all.length && ids.every((id, i) => id === all[i].id), ids.length + ' of ' + all.length);
    const since = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
    const part = db.hitsSince(since, ['page']);
    const sp = db.hitsSpan(since);
    let n = 0;
    for (let from = sp.a; from <= sp.b; from += 3000) n += db.hitsSlice(from, from + 3000, since, ['page']).length;
    check('a window and a kind: the same count as the one read', n === part.length && n > 0, n + ' / ' + part.length);
    check('the short read carries only what the beacons need', Object.keys(db.hitsSlice(span.a, span.a + 500, '2000-01-01', ['seen'], true)[0] || { id: 1, day: 1, kind: 1, visitor: 1 }).sort().join() === 'day,id,kind,visitor');
    check('a day with nothing after it has no span', db.hitsSpan('2999-01-01').a == null);
    db.close();
  }

  let out = '';
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', BOTGATE: 'off',
      TRAFFIC_SLICE: '500', STALL_MS: '400', SLOW_MS: '60000', TRAFFIC_FOLD_MS: '3600000' }) });
  child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
  try {
    for (let i = 0; i < 80; i++) { await wait(400); if ((await req('/api/health')).status === 200) break; }
    let r = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@glovels.com', password: 'glovels123' } });
    const admin = String((r.headers['set-cookie'] || [''])[0]).split(';')[0];
    check('the administrator signs in', r.status === 200 && !!admin, r.status);

    /* ---- Traffic: the right numbers, and the server answers meanwhile */
    let w = await whileCounting('/api/staff/traffic?days=90', admin);
    const t = w.r.json || {};
    check('Traffic answers for 90 days', w.r.status === 200 && t.ok === true, w.r.status);
    check('page views are the page rows', t.totals && t.totals.views === want.views, (t.totals && t.totals.views) + ' / ' + want.views);
    check('visitors are counted once each', t.totals && t.totals.visitors === want.visitors.size, (t.totals && t.totals.visitors) + ' / ' + want.visitors.size);
    check('real visitors are the ones whose browser said so', t.totals && t.totals.people === want.people.size && want.people.size > 0, (t.totals && t.totals.people) + ' / ' + want.people.size);
    check('crawler rows still in the table are counted', t.totals && t.totals.botHits === want.bots, (t.totals && t.totals.botHits) + ' / ' + want.bots);
    const dayOk = (t.byDay || []).every(d => (want.byDay[d.day] || 0) === d.views);
    check('every day has its own views', dayOk && (t.byDay || []).length === 90);
    const topWant = Object.entries(want.pages).sort((a, b) => b[1] - a[1])[0];
    check('the most-read page is the one with the most rows', t.pages && t.pages[0] && t.pages[0].count === topWant[1], JSON.stringify(t.pages && t.pages[0]) + ' / ' + topWant.join(' '));
    check('the health check was asked while it counted', w.asked >= 3, w.asked + ' times');
    check('…and always answered', w.failed === 0, w.failed + ' failed');
    check('…in well under a second each time', w.worst < 500, 'slowest ' + w.worst + ' ms');

    /* ---- a short window */
    r = await req('/api/staff/traffic?days=1', { headers: { Cookie: admin } });
    const today = new Date().toISOString().slice(0, 10);
    check('one day counts only that day', r.status === 200 && r.json.totals.views === (want.byDay[today] || 0), r.json && r.json.totals.views + ' / ' + (want.byDay[today] || 0));

    /* ---- two people at once */
    const [a, b] = await Promise.all([req('/api/staff/traffic?days=30', { headers: { Cookie: admin } }), req('/api/staff/traffic?days=30', { headers: { Cookie: admin } })]);
    check('two askers at once both get the same answer', a.status === 200 && b.status === 200 && a.body === b.body);

    /* ---- Marketing */
    w = await whileCounting('/api/marketing/report?days=30', admin);
    const m = w.r.json || {};
    check('Marketing answers for 30 days', w.r.status === 200 && m.ok === true, w.r.status);
    check('…with visitors and pages in it', m.totals && m.totals.visitors > 0 && Array.isArray(m.pages) && m.pages.length > 0 && Array.isArray(m.sections) && m.sections.length > 0,
      JSON.stringify(m.totals && { visitors: m.totals.visitors, views: m.totals.views }));
    check('…only real visitors, once there are beacons', m.totals && m.totals.views > 0 && m.totals.views < want.views, (m.totals && m.totals.views) + ' < ' + want.views);
    check('…and the health check always answered', w.failed === 0 && w.asked >= 2, w.asked + ' asked, ' + w.failed + ' failed');
    check('…in well under a second each time', w.worst < 500, 'slowest ' + w.worst + ' ms');

    /* ---- still closed to everyone else */
    check('Traffic still needs a sign-in', (await req('/api/staff/traffic?days=7')).status === 401);
    check('Marketing still needs a sign-in', [401, 403].includes((await req('/api/marketing/report?days=7')).status));

    await wait(300);
    check('the server never stalled while counting (no stall line in its log)', !/^\s*stall\b/m.test(out), (out.match(/^\s*stall.*$/m) || [''])[0].slice(0, 120));
  } catch (e) { bad.push('test crashed — ' + (e && e.stack || e)); }
  try { process.kill(-child.pid); } catch (e) { /* gone */ }
  bad.forEach(b => console.log('FAIL  ' + b));
  console.log(ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
