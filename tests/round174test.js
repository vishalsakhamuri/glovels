/*
 * Round 174 — source files are not served; no count in the finder's tab title (23 Oct).
 * Port 8117 by default (BASE overrides).
 */
const BASE = process.env.BASE || 'http://localhost:8117';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); } };
const get = p => fetch(BASE + p, { redirect: 'manual' });

(async () => {
  for (const p of ['/serve.js', '/package.json', '/tests/runtests.sh', '/tests/round174test.js',
    '/build_portal.py', '/README.md', '/render.yaml', '/Dockerfile', '/start.command',
    '/catalogue.json', '/content.json', '/.gitignore', '/.git/config', '/__pycache__/x.pyc']) {
    const r = await get(p);
    ok(p + ' is not served', r.status === 404 || r.status === 403, r.status);
  }
  for (const [p, type] of [['/', 'text/html'], ['/fitpanel.js', 'javascript'], ['/sw.js', 'javascript'],
    ['/manifest.webmanifest', ''], ['/robots.txt', 'text/plain'], ['/favicon.svg', 'svg'],
    ['/flags/de.svg', 'svg'], ['/logos/index.json', 'json'], ['/about-us', 'text/html'],
    ['/find-university', 'text/html'], ['/university/university-of-stuttgart', 'text/html']]) {
    const r = await get(p);
    ok(p + ' still served', r.status === 200 && (r.headers.get('content-type') || '').includes(type), r.status + ' ' + r.headers.get('content-type'));
  }
  const send = await fetch(BASE + '/send.php', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '12345' }) });
  ok('/send.php still answers the form', send.status === 422 || send.status === 400, send.status);

  for (const q of ['', '?country=DE', '?country=DE&level=masters&field=Computer%20Science', '?cgpa=5']) {
    const html = await (await get('/find-university' + q)).text();
    const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    ok('finder title has no count ' + (q || '(plain)'), t && !/\d[\d,]* programme/i.test(t), t);
  }
  const FIND = require('../server/find.js');
  ok('the browser-side title has no count', !/programme/i.test(FIND.title({ level: 'masters' }, {}, 1234)), FIND.title({ level: 'masters' }, {}, 1234));

  console.log('round174test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('round174test: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
