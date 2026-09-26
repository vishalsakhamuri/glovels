/*
 * Patch 141 — the course-link checker. A fake university on a local port
 * answers each way a real one does: a page, a 404, a quiet redirect to the
 * home page, a robot refusal, a HEAD-hater, and silence. The server under
 * test runs with LINKCHECK_ALLOW_LOCAL=true, because otherwise it rightly
 * refuses to fetch anything on a private address — checked here too.
 */
const http = require('http');
const BASE = process.env.BASE || 'http://localhost:8099';
const LINKS = require('../server/linkcheck.js');
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const jar = {};
async function req(method, path, body) {
  const h = { 'content-type': 'application/json' }; if (jar.a) h.cookie = jar.a;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : []; if (set.length) jar.a = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j, text, type: r.headers.get('content-type') || '' };
}
const U = http.createServer((q, s) => {
  if (q.url === '/en/study/msc-good') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end('<h1>MSc</h1>'); }
  if (q.url === '/en/study/msc-gone') { s.writeHead(404); return s.end('nope'); }
  if (q.url === '/en/study/msc-moved') { s.writeHead(301, { location: '/en/' }); return s.end(); }
  if (q.url === '/en/') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end('home'); }
  if (q.url === '/en/study/msc-robots') { s.writeHead(403); return s.end(); }
  if (q.url === '/en/study/msc-nohead') { if (q.method === 'HEAD') { s.writeHead(405); return s.end(); } s.writeHead(200); return s.end('ok'); }
  if (q.url === '/en/study/msc-broken') { s.writeHead(503); return s.end(); }
  s.writeHead(404); s.end();
});

(async () => {
  await new Promise(r => U.listen(8391, r));
  const F = 'http://127.0.0.1:8391/en/study/';

  /* the unit: verdicts */
  const v = async (u, local = true) => (await LINKS.checkOne(u, local)).verdict;
  ok('a working page is ok', await v(F + 'msc-good') === 'ok');
  ok('a 404 is dead', await v(F + 'msc-gone') === 'dead');
  ok('a redirect to the home page is "home", not ok', await v(F + 'msc-moved') === 'home');
  ok('a 403 is "blocked" — a person has to look', await v(F + 'msc-robots') === 'blocked');
  ok('a server that refuses HEAD is asked again with GET', await v(F + 'msc-nohead') === 'ok');
  ok('a 503 is an error, not dead', await v(F + 'msc-broken') === 'error');
  ok('not an address is "bad"', await v('see website') === 'bad');
  ok('a private address is refused outside the test', await v(F + 'msc-good', false) === 'bad');
  ok('a name that does not exist is dead', await v('https://no-such-host.invalid/x', false) === 'dead');
  ok('isHome: /en/ is the front door, /en/study/x is not', LINKS.isHome('https://x.de/en/') && !LINKS.isHome('https://x.de/en/study/x'));

  /* over HTTP: start, poll, download */
  let r = await req('POST', '/api/staff/linkcheck');
  ok('signed out, the check is refused', r.status === 401 || r.status === 403, r.status);
  await req('POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  const made = [];
  for (const [n, path] of [['Good', 'msc-good'], ['Gone', 'msc-gone'], ['Moved', 'msc-moved']]) {
    r = await req('PUT', '/api/staff/programme', { program: 'Linktest ' + n, university: 'Linktest University', country: 'DE', level: 'master',
      field: 'Computer Science & IT', isPublic: false, feeModel: 'free', totalInr: 0, url: F + path, intakes: [{ season: 'winter', deadline: '2027-07-15' }] });
    made.push(r.body && (r.body.id || (r.body.programme || {}).id));
  }
  r = await req('POST', '/api/staff/linkcheck?country=DE');
  ok('a run starts and answers at once', r.status === 202 && r.body && r.body.total > 0, r.status + ' ' + JSON.stringify(r.body).slice(0, 100));
  let st = r.body;
  for (let i = 0; i < 120 && st.running; i++) { await new Promise(x => setTimeout(x, 1000)); st = (await req('GET', '/api/staff/linkcheck')).body; }
  ok('it finishes', st && !st.running && st.done === st.total, JSON.stringify(st));
  r = await req('GET', '/api/staff/linkcheck.csv');
  ok('the results download as a sheet', r.status === 200 && /text\/csv/.test(r.type));
  const lines = r.text.split(/\r?\n/);
  ok('dead links sort to the top', /^﻿?dead,/.test(lines[1] || ''), lines[1]);
  ok('the gone page is reported dead', lines.some(l => /^dead,.*Linktest Gone/.test(l)));
  ok('the moved page is reported as sending you home', lines.some(l => /^home,.*Linktest Moved/.test(l)));
  ok('the good page is ok', lines.some(l => /^ok,.*Linktest Good/.test(l)));
  r = await req('GET', '/api/staff/linkcheck.xlsx');
  ok('and as Excel', r.status === 200 && /spreadsheetml/.test(r.type));
  r = await req('GET', '/catalogue');
  ok('the catalogue screen has the button', /id="lcGo"/.test(r.text) && /Check the course links/.test(r.text));

  for (const id of made) if (id) await req('DELETE', '/api/staff/programme/' + encodeURIComponent(id));
  U.close();
  console.log('linktest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
