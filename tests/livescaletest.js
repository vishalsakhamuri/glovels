/**
 * The site at the LIVE catalogue's size — 68,000 programmes (tests/bigcat.js)
 * — on the production command (node --max-old-space-size=300 serve.js), with
 * the guard on, timed as a visitor and as a signed-in student.
 *
 * What it proves (3 Nov 2026, the go-live blocker): a single visitor on the
 * study-in-united-kingdom page's filter got 3–5 s answers from
 * /api/universities/filter and took the live server down on "GB · Master's ·
 * Data Science" — the route read every row of sixty universities (14,000 to
 * 21,000 full rows, 60–85 MB of objects) per request, had no flood limit, no
 * bot guard and no cache. This suite builds that catalogue, starts the server
 * the way Render does, and asserts:
 *
 *   - no visitor request takes more than 2 s (every country × level × field
 *     of the filter, the finder, the search box, the pages, the sitemap);
 *   - three of the heaviest filters at once do not take the process down,
 *     and the process stays well under the 300 MB heap;
 *   - /api/universities/filter answers a script with 403, a flood with 429,
 *     and the same question twice from memory;
 *   - the office's catalogue pages and the CSV export answer at this size.
 *
 * Slow (about two minutes: a minute to build the catalogue, a minute to
 * measure), so it is NOT in runtests.sh. Run it on its own:
 *
 *     node tests/livescaletest.js                 # build, start, measure, assert
 *     node tests/livescaletest.js --measure 8241  # measure a server already running
 *     BIGCAT_SCALE=1 node tests/livescaletest.js  # the live split as stated (~49k)
 *
 * Ports 8243 (its own server). Prints a timing table (BEFORE/AFTER tables in
 * the patch notes come from this output).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[process.argv.indexOf('--measure') + 1]) || 8243;
const MEASURE_ONLY = process.argv.includes('--measure');
const KEEP = process.argv.includes('--keep');
const DIR = '/tmp/db-livescale-' + PORT;
const LIMIT_MS = 2000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

let ipN = 1;
const freshIp = () => '198.51.' + (ipN >> 8 & 255) + '.' + (ipN++ & 255);
let token = '';
function call(p, o) {
  o = o || {};
  return new Promise(resolve => {
    const t0 = Date.now();
    const headers = Object.assign({ 'User-Agent': o.ua || UA, 'Accept-Language': 'en-GB,en', 'X-Forwarded-For': o.ip || freshIp() }, o.headers || {});
    if (token && !o.noToken) headers['X-Glv-T'] = token;
    if (o.cookie) headers.Cookie = o.cookie;
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: o.method || 'GET', headers }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = null; try { j = JSON.parse(out); } catch (e) { j = null; }
        resolve({ status: res.statusCode, body: j, text: out, headers: res.headers, ms: Date.now() - t0, kb: Math.round(out.length / 1024) });
      });
    });
    req.on('error', e => resolve({ status: 0, body: null, text: '', headers: {}, ms: Date.now() - t0, kb: 0, err: e.code }));
    if (o.body) req.write(JSON.stringify(o.body));
    req.end();
  });
}
const login = async email => String(([].concat((await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { email, password: 'glovels123' } })).headers['set-cookie'] || []))[0] || '').split(';')[0];
const enc = encodeURIComponent;

let pid = 0;
const rssMB = () => { try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/' + pid + '/status', 'utf8'))[1]) / 1024); } catch (e) { return -1; } };
let peakRss = 0;
const rows = [];
async function timed(label, p, o) {
  const r = await call(p, o);
  peakRss = Math.max(peakRss, rssMB());
  rows.push({ label, p, ms: r.ms, status: r.status, kb: r.kb, rss: rssMB() });
  return r;
}
const pad = (s, n) => String(s).padStart(n);
function table(title, list) {
  console.log('\n' + title);
  console.log(pad('ms', 7) + ' ' + pad('st', 4) + ' ' + pad('kB', 6) + ' ' + pad('rssMB', 6) + '  what');
  list.forEach(r => console.log(pad(r.ms, 7) + ' ' + pad(r.status, 4) + ' ' + pad(r.kb, 6) + ' ' + pad(r.rss, 6) + '  ' + r.label));
}

const COUNTRIES = ['GB', 'US', 'CA', 'IE', 'AU', 'DE', 'FR'];
const LEVELS = ['', 'bachelor', 'master'];
const FIELDS = ['', 'Business & Management', 'Computer Science & IT', 'Data Science, AI & Machine Learning', 'Finance, Banking & Accounting', 'Mechanical & Automotive Engineering', 'Public Health & Healthcare Management'];
const DS = 'Data Science, AI & Machine Learning';
const filterPath = (c, l, f, extra) => '/api/universities/filter?country=' + c + (l ? '&level=' + l : '') + (f ? '&field=' + enc(f) : '') + (extra || '');

async function main() {
  let child = null;
  if (!MEASURE_ONLY) {
    fs.rmSync(DIR, { recursive: true, force: true });
    const t0 = Date.now();
    const built = require('./bigcat.js').build(DIR, { scale: Number(process.env.BIGCAT_SCALE) || 1.4 });
    console.log('catalogue built: ' + built.rows + ' rows in ' + Math.round((Date.now() - t0) / 1000) + ' s ' + JSON.stringify(built.perCountry));
    /* The production command, exactly: package.json "start". */
    child = spawn(process.execPath, ['--max-old-space-size=300', 'serve.js'], { cwd: ROOT, detached: true,
      stdio: ['ignore', fs.openSync('/tmp/serve-' + PORT + '.log', 'w'), fs.openSync('/tmp/serve-' + PORT + '.log', 'a')],
      env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'on', NODE_NO_WARNINGS: '1', ALLOW_INDEXING: 'true', GLOVELS_URL: 'https://glovels.example' }) });
    pid = child.pid;
    let up = false;
    for (let i = 0; i < 150; i++) { await new Promise(r => setTimeout(r, 500)); if ((await call('/api/health')).status === 200) { up = true; break; } }
    check('the server boots on the big catalogue', up);
    if (!up) { console.log(fs.readFileSync('/tmp/serve-' + PORT + '.log', 'utf8').slice(-3000)); return finish(child); }
    console.log('server up, pid ' + pid + ', rss ' + rssMB() + ' MB');
    /* 3 Nov: the one-off repairs on a fresh database (entities, duplicates)
       read whole rows; the entity scan matched every row whose FIELD has an
       ampersand — all of them — and boot peaked at a 230 MB heap. */
    check('RSS right after boot is under 250 MB (the one-off repairs read pages, not the catalogue)', rssMB() < 250, rssMB() + ' MB');
  } else {
    /* Find the pid of the server on PORT (its log name carries the port). */
    for (const p of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
      try {
        const env = fs.readFileSync('/proc/' + p + '/environ', 'utf8').split('\0');
        const cmd = fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').split('\0');
        if (env.includes('PORT=' + PORT) && cmd[0] === 'node' && cmd.includes('serve.js')) pid = Number(p);
      } catch (e) { /* not ours */ }
    }
    console.log('measuring the server on :' + PORT + ' (pid ' + pid + ', rss ' + rssMB() + ' MB)');
  }
  const guardOn = /name="glv-t"/.test((await call('/')).text);
  { const m = /name="glv-t" content="([^"]+)"/.exec((await call('/study-in-united-kingdom')).text || ''); token = m ? m[1] : ''; }
  const studentCookie = await login('student@glovels.com');
  const adminCookie = await login('admin@glovels.com');
  check('the student and the administrator can sign in', !!studentCookie && !!adminCookie);

  /* ---- 1. the country pages' filter: every country × level × field, as a visitor, one at a time */
  const filt = [];
  for (const c of COUNTRIES) for (const l of LEVELS) for (const f of FIELDS) {
    const r = await timed('filter ' + c + ' ' + (l || 'any') + ' ' + (f || 'any field'), filterPath(c, l, f));
    filt.push(Object.assign({ c, l, f }, r));
    if (r.status !== 200) check('filter ' + c + ' ' + l + ' ' + f + ' answers 200', false, r.status + ' ' + (r.text || '').slice(0, 120));
  }
  const slowF = filt.filter(r => r.ms > LIMIT_MS);
  check('every /api/universities/filter answers within ' + LIMIT_MS + ' ms (' + filt.length + ' asked)', !slowF.length,
    slowF.slice(0, 5).map(r => r.c + '/' + r.l + '/' + r.f + '=' + r.ms + 'ms').join(', '));
  check('the slowest filter', true, Math.max(...filt.map(r => r.ms)) + ' ms; median ' + filt.map(r => r.ms).sort((a, b) => a - b)[filt.length >> 1] + ' ms');
  {
    const gb = filt.find(r => r.c === 'GB' && r.l === 'master' && r.f === DS);
    check('GB · Master\'s · Data Science (the crash on live) answers, with universities', gb.status === 200 && gb.body && gb.body.universities.length > 0, gb.ms + ' ms, ' + (gb.body ? gb.body.universities.length : 0) + ' universities');
    const vis = gb.body || {};
    check('a visitor gets no total and no counts', vis.total === undefined && (vis.universities || []).every(u => u.matching === undefined && u.programmes === undefined));
    check('a visitor row carries what the page prints', (vis.universities || []).every(u => u.slug && u.name && u.url && 'feeMin' in u && 'feeOnRequest' in u && 'typeLabel' in u && 'partial' in u && 'listed' in u));
  }
  /* the same question again, from memory */
  {
    const again = await timed('filter GB master Data Science (again, cached)', filterPath('GB', 'master', DS));
    check('the same filter asked again is answered from memory (under 150 ms)', again.ms < 150, again.ms + ' ms');
  }
  /* with every box filled */
  {
    const r = await timed('filter GB master DS cgpa=7.2 intake=winter budget=4000000 q=london', filterPath('GB', 'master', DS, '&cgpa=7.2&intake=winter&budget=4000000&q=london'));
    check('every filter box at once answers within ' + LIMIT_MS + ' ms', r.status === 200 && r.ms <= LIMIT_MS, r.ms + ' ms');
    const r2 = await timed('filter US any q=university', filterPath('US', '', '', '&q=university'));
    check('a wide name search on the USA answers within ' + LIMIT_MS + ' ms', r2.status === 200 && r2.ms <= LIMIT_MS, r2.ms + ' ms');
  }
  /* ---- as a signed-in student */
  for (const [c, l, f] of [['GB', 'master', DS], ['US', 'master', ''], ['US', 'bachelor', 'Business & Management'], ['DE', 'master', ''], ['CA', '', '']]) {
    const r = await timed('student filter ' + c + ' ' + (l || 'any') + ' ' + (f || 'any'), filterPath(c, l, f) + '&cgpa=7.5', { cookie: studentCookie, ip: '203.0.113.9' });
    check('student filter ' + c + ' ' + l + ' ' + f + ' answers within ' + LIMIT_MS + ' ms', r.status === 200 && r.ms <= LIMIT_MS, r.status + ' ' + r.ms + ' ms');
    if (r.body) check('a student gets no total either (' + c + ')', r.body.total === undefined);
  }
  /* ---- 3 at once, the heaviest, eight rounds: the live "190 consecutive 502s" */
  {
    const heavy = [filterPath('US', 'master', ''), filterPath('GB', 'master', DS), filterPath('US', 'bachelor', 'Business & Management'), filterPath('US', '', ''), filterPath('GB', '', '')];
    const worst = [];
    let alive = true;
    for (let round = 0; round < 8 && alive; round++) {
      const rs = await Promise.all([0, 1, 2].map(i => call(heavy[(round * 3 + i) % heavy.length] + '&cgpa=' + (6 + round * 0.3).toFixed(1))));
      peakRss = Math.max(peakRss, rssMB());
      worst.push(Math.max(...rs.map(r => r.ms)));
      if (rs.some(r => r.status !== 200)) { alive = false; check('three heavy filters at once keep answering 200 (round ' + round + ')', false, rs.map(r => r.status + (r.err ? ' ' + r.err : '')).join(' ')); }
    }
    rows.push({ label: '3 concurrent heavy filters × 8 rounds (worst of each round)', p: '', ms: Math.max(...worst), status: alive ? 200 : 'x', kb: 0, rss: rssMB() });
    check('three heavy filters at once: the slowest finishes within ' + (LIMIT_MS * 2) + ' ms', alive && Math.max(...worst) <= LIMIT_MS * 2, worst.join(' ') + ' ms');
    check('the server is still up after the burst', (await call('/api/health')).status === 200);
  }

  /* ---- 2. the finder, the search box, the catalogue, the tags */
  const finder = [
    ['find/match GB only', '/api/find/match?country=GB'], ['find/match US only', '/api/find/match?country=US'],
    ['find/match GB master Business', '/api/find/match?country=GB&level=master&field=' + enc('Business & Management')],
    ['find/match US master Data Science', '/api/find/match?country=US&level=master&field=' + enc(DS)],
    ['find/match q=london', '/api/find/match?q=london'], ['find/match q=data', '/api/find/match?q=data'], ['find/match q=business', '/api/find/match?q=business'],
    ['find/match home page (limit=30)', '/api/find/match?country=GB&limit=30'],
    ['find/locked GB', '/api/find/locked?country=GB'],
    ['universities/search un', '/api/universities/search?q=un'], ['universities/search data', '/api/universities/search?q=data'], ['universities/search lon', '/api/universities/search?q=lon'],
    ['find/unis lon', '/api/find/unis?q=lon'], ['find/unis uni', '/api/find/unis?q=uni'],
    ['catalogue', '/api/catalogue'], ['catalogue GB', '/api/catalogue?country=GB'], ['tags', '/api/tags'], ['tags q=data', '/api/tags?q=data'],
  ];
  for (const [label, p] of finder) {
    const r = await timed(label, p);
    check(label + ' answers 200 within ' + LIMIT_MS + ' ms', r.status === 200 && r.ms <= LIMIT_MS, r.status + ' ' + r.ms + ' ms ' + r.kb + ' kB');
  }
  for (const [label, p] of [['student find/match GB master DS', '/api/find/match?country=GB&level=master&field=' + enc(DS)], ['student find/match q=london', '/api/find/match?q=london'], ['student catalogue', '/api/catalogue']]) {
    const r = await timed(label, p, { cookie: studentCookie, ip: '203.0.113.9' });
    check(label + ' answers 200 within ' + LIMIT_MS + ' ms', r.status === 200 && r.ms <= LIMIT_MS, r.status + ' ' + r.ms + ' ms');
  }

  /* ---- 3. the pages */
  let bigUni = '';
  {
    const STORE = require(path.join(ROOT, 'server/store.js'));
    const dbDir = MEASURE_ONLY ? (process.env.DATA_DIR || DIR) : DIR;
    try { const db = STORE.open(dbDir); const top = db.rowsForCountryPage('GB', 1); bigUni = top.length ? top[0].uni_slug : ''; } catch (e) { bigUni = ''; }
  }
  const pages = [['study-in-united-kingdom', '/study-in-united-kingdom'], ['study-in-usa', '/study-in-usa'], ['universities index', '/universities'], ['universities?country=GB', '/universities?country=GB'],
    ['university page (biggest UK)', '/university/' + bigUni], ['home', '/'], ['find-university', '/find-university?country=GB&level=master'], ['sitemap.xml', '/sitemap.xml'], ['sitemap.xml (again)', '/sitemap.xml'], ['robots.txt', '/robots.txt']];
  for (const [label, p] of pages) {
    if (p.endsWith('/')) continue;
    const r = await timed(label, p);
    check(label + ' renders 200 within ' + LIMIT_MS + ' ms', r.status === 200 && r.ms <= LIMIT_MS, r.status + ' ' + r.ms + ' ms ' + r.kb + ' kB');
  }

  /* ---- 4. the office */
  const office = [['staff/catalogue page 1', '/api/staff/catalogue?page=1&per=100'], ['staff/catalogue GB page 5', '/api/staff/catalogue?country=GB&page=5&per=100'],
    ['staff/catalogue q=data', '/api/staff/catalogue?q=data&per=100'], ['staff/catalogue US master DS', '/api/staff/catalogue?country=US&level=master&field=' + enc(DS) + '&per=200'],
    ['staff/catalogue/ids GB', '/api/staff/catalogue/ids?country=GB'], ['staff/universities', '/api/staff/universities?per=100'], ['staff/students', '/api/staff/students'],
    ['staff/catalogue.csv GB (export)', '/api/staff/catalogue.csv?country=GB'], ['staff filter GB master DS (with total)', filterPath('GB', 'master', DS)]];
  for (const [label, p] of office) {
    const r = await timed(label, p, { cookie: adminCookie, ip: '203.0.113.10' });
    const lim = /export|ids/.test(label) ? 5000 : LIMIT_MS;
    check(label + ' answers 200 within ' + lim + ' ms', r.status === 200 && r.ms <= lim, r.status + ' ' + r.ms + ' ms ' + r.kb + ' kB');
    if (/with total/.test(label)) check('the office keeps its total on the filter', r.body && typeof r.body.total === 'number', JSON.stringify(r.body && r.body.total));
  }
  check('peak RSS of the process stayed under 450 MB (Render Starter is 512)', peakRss > 0 && peakRss < 450, peakRss + ' MB');

  /* ---- 5. the guard and the flood limit on the filter (GUARD=on) */
  if (guardOn) {
    const curl = await call(filterPath('GB', 'master', DS), { ua: 'curl/8.4.0' });
    check('a script (curl) gets nothing from /api/universities/filter', curl.status === 403 && curl.body && curl.body.robot, curl.status + ' ' + (curl.text || '').slice(0, 80));
    const noTok = await call(filterPath('GB', 'master', DS), { noToken: true });
    check('a browser without the page token is told to reload', noTok.status === 403 && noTok.body && noTok.body.reload, noTok.status);
    /* a guest who runs through 30 different filters is asked to sign in */
    const ip = '203.0.113.77';
    let cookie = '', last = null;
    for (let i = 0; i < 34; i++) {
      last = await call(filterPath('GB', 'master', DS, '&cgpa=' + (5 + i * 0.1).toFixed(1) + '&q=' + ['a', 'b', 'c', 'd'][i % 4] + i), { ip, cookie });
      const c = [].concat(last.headers['set-cookie'] || []).find(x => /^gl_v=/.test(x)); if (c) cookie = c.split(';')[0];
      if (last.status !== 200) break;
    }
    check('a guest\'s 31st different filter is asked to sign in (401)', last.status === 401 && last.body && last.body.loginRequired, last.status + ' ' + (last.text || '').slice(0, 100));
    /* the flood limit: 240 a minute from one address, whoever they are */
    let flooded = null;
    for (let i = 0; i < 260; i++) { const r = await call(filterPath('DE', 'master', ''), { ip: '203.0.113.88' }); if (r.status === 429) { flooded = { i, r }; break; } }
    check('a flood from one address meets the limiter (429) within 260 requests', !!flooded, flooded ? 'at request ' + (flooded.i + 1) : 'never');
    check('the server is still up after the flood', (await call('/api/health')).status === 200);
  } else {
    check('guard checks skipped: GUARD is off on this server', true);
  }

  table('TIMINGS (ms) — ' + rows.length + ' requests, peak RSS ' + peakRss + ' MB', rows.filter(r => !/^filter [A-Z]{2} /.test(r.label) || r.ms > 500 || /GB master Data|US master any|US bachelor Business/.test(r.label)));
  const byC = {};
  filt.forEach(r => { byC[r.c] = byC[r.c] || []; byC[r.c].push(r.ms); });
  console.log('\nfilter route by country (ms): ' + Object.keys(byC).map(c => c + ' max ' + Math.max(...byC[c]) + ' / median ' + byC[c].sort((a, b) => a - b)[byC[c].length >> 1]).join(' · '));
  finish(child);
}

function finish(child) {
  if (child && !KEEP) { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { try { child.kill(); } catch (e2) {} } }
  const log = (() => { try { return fs.readFileSync('/tmp/serve-' + PORT + '.log', 'utf8'); } catch (e) { return ''; } })();
  const fatal = /FATAL ERROR|heap out of memory|Unhandled|TypeError|RangeError/.exec(log);
  check('the server log carries no fatal error, OOM or unhandled exception', !fatal, fatal ? fatal[0] : '');
  console.log('\nPASS ' + ok.length + '  FAIL ' + bad.length);
  bad.forEach(b => console.log('  FAIL ' + b));
  ok.filter(o => /slowest|peak|median/.test(o)).forEach(o => console.log('  note ' + o));
  process.exit(bad.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
