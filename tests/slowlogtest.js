/**
 * Patch 290: a slow request and a stalled server say so in the log, and the
 * database copy is taken at night.
 *
 * 24 Nov: the site froze twice (health check timed out, CPU at 100%) and the
 * log held nothing before the restart. Boots its own server with the "slow"
 * line set to 1 ms and checks: a request is logged with its method, path and
 * time; the query string is not; a live stream is not counted as slow; and the
 * backup schedule is 02:30 IST, with a start-up copy only when the newest one
 * is more than 26 hours old.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = '/home/claude/glovels/build';
const PORT = 8290;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const get = (p) => new Promise(resolve => {
  const req = http.get({ host: 'localhost', port: PORT, path: p }, res => { let o = ''; res.on('data', c => { o += c; }); res.on('end', () => resolve({ status: res.statusCode, body: o })); });
  req.on('error', () => resolve({ status: 0, body: '' }));
});

(async () => {
  const dir = '/tmp/db-slowlog-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let out = '';
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', SLOW_MS: '1', STALL_MS: '1500' }) });
  child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await get('/api/health')).status === 200) break; }
    const before = out.length;
    const r = await get('/api/catalogue?email=someone%40example.com&q=secret-term');
    await new Promise(r2 => setTimeout(r2, 500));
    const said = out.slice(before);
    check('the request was answered', r.status === 200, String(r.status));
    const line = said.split('\n').find(l => /slow/.test(l) && /\/api\/catalogue/.test(l)) || '';
    check('a request over the limit is logged as slow', !!line, said.slice(0, 200));
    check('with how long it took, its status and its method', /slow\s+\d+ ms\s+200\s+GET \/api\/catalogue/.test(line), line);
    check('and never its query string', !/someone|secret-term|\?/.test(said), line);
    check('a healthy server reports no stall', !/stall/.test(out));
    /* the limiter: a burst cannot fill the log */
    const b2 = out.length;
    for (let i = 0; i < 45; i++) await get('/api/catalogue?i=' + i);
    await new Promise(r2 => setTimeout(r2, 500));
    const burst = out.slice(b2).split('\n').filter(l => /^\s+slow\s+\d+ ms/.test(l)).length;
    check('at most thirty slow lines a minute are written', burst <= 30 && /more this minute/.test(out.slice(b2)), String(burst));

    /* ---- the backup schedule ---- */
    const B = require(path.join(ROOT, 'server/backup.js'));
    const bdir = '/tmp/db-slowlog-b'; fs.rmSync(bdir, { recursive: true, force: true }); fs.mkdirSync(path.join(bdir, 'backups'), { recursive: true });
    const b = B.open({ db: { kind: 'sqlite' }, dataDir: bdir, log: { log() {}, error() {} } });
    const at = (h, m) => Date.UTC(2026, 10, 24, h, m);
    const next = t => new Date(t + b.msToNight(t)).toISOString().slice(0, 16);
    check('from a restart at 16:07 IST the next copy is at 02:30 IST', next(at(10, 37)) === '2026-11-24T21:00', next(at(10, 37)));
    check('from 02:31 IST it is the following night', next(at(21, 1)) === '2026-11-25T21:00', next(at(21, 1)));
    check('with no copy on the disk, one is owed soon after start', b.newestCopyAt() === 0);
    fs.writeFileSync(path.join(bdir, 'backups', 'glovels-2026-11-24.db'), 'x');
    check('with a copy from today, none is taken at start', Date.now() - b.newestCopyAt() < 26 * 3600 * 1000);
    const old = new Date(Date.now() - 30 * 3600 * 1000);
    fs.utimesSync(path.join(bdir, 'backups', 'glovels-2026-11-24.db'), old, old);
    check('with the newest copy thirty hours old, one is taken at start', Date.now() - b.newestCopyAt() > 26 * 3600 * 1000);
    check('this run took no copy in its first seconds', !fs.existsSync(path.join(dir, 'backups')) || fs.readdirSync(path.join(dir, 'backups')).length === 0);
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\nslowlogtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
