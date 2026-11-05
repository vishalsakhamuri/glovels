/**
 * Patch 273: a connection the proxy keeps open is still open after 7 s idle.
 * Render's proxy reuses connections for up to 120 s; Node's default closed
 * them after 5 s, and a request sent down a just-closed one is a 502.
 */
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const PORT = 8273, ROOT = '/home/claude/glovels/build';
const wait = ms => new Promise(r => setTimeout(r, ms));
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
(async () => {
  const dir = '/tmp/db-keepalive-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 60; i++) {
      await wait(300);
      const up = await new Promise(r => { const s = net.connect(PORT, '127.0.0.1', () => { s.end(); r(true); }); s.on('error', () => r(false)); });
      if (up) break;
    }
    await wait(800);
    const sock = net.connect(PORT, '127.0.0.1');
    let buf = '', closed = false;
    sock.on('data', d => { buf += d; });
    sock.on('close', () => { closed = true; });
    sock.on('error', () => { closed = true; });
    const ask = () => sock.write('GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
    await new Promise(r => sock.on('connect', r));
    ask(); await wait(800);
    check('first request answered on a keep-alive connection', /HTTP\/1\.1 200/.test(buf));
    const hdr = /keep-alive: timeout=(\d+)/i.exec(buf);
    check('the server says it keeps the connection for at least 120 s', hdr && Number(hdr[1]) >= 120, hdr && hdr[0]);
    buf = '';
    await wait(7000);
    check('after 7 s idle the connection is still open (Node’s default closed it at 5 s)', !closed);
    if (!closed) { ask(); await wait(800); }
    check('and a second request on it is answered', /HTTP\/1\.1 200/.test(buf));
    sock.destroy();
  } catch (e) { bad.push('crashed: ' + (e.stack || e)); }
  finally { try { process.kill(-child.pid); } catch (e) { /* gone */ } }
  ok.forEach(x => console.log('  ok   ' + x));
  bad.forEach(x => console.log('  FAIL ' + x));
  console.log('\nkeepalivetest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
