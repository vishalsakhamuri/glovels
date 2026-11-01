/** Patch 215: an unpaid order names nothing; a recorded payment names them. */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const ROOT = '/home/claude/glovels/build', PORT = 8215;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const call = (path, o) => new Promise(resolve => {
  o = o || {};
  const req = http.request({ host: 'localhost', port: PORT, path, method: o.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/130', 'Accept-Language': 'en' }, o.headers || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => { let j = {}; try { j = JSON.parse(out); } catch (e) {} resolve({ status: res.statusCode, body: j, headers: res.headers }); });
  });
  req.on('error', () => resolve({ status: 0, body: {} }));
  if (o.body) req.write(typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
  req.end();
});
const ck = r => String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
(async () => {
  const dir = '/tmp/db-unlock'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', UNLOCK_UNPAID: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const em = 'unlock-' + Date.now() + '@example.com';
    const su = await call('/api/auth/signup', { method: 'POST', body: { name: 'Ravi Kumar', email: em, password: 'a-long-password-1', phone: '9876543210', terms: true } });
    const c = ck(su);
    const st0 = await call('/api/state', { headers: { Cookie: c } });
    const pf = st0.body.profile || {};
    check('sign-up name, email and mobile are in the profile', pf.fullName === 'Ravi Kumar' && pf.email === em && /9876543210/.test(pf.phone || ''), JSON.stringify(pf));
    await call('/api/profile', { method: 'PUT', headers: { Cookie: c }, body: { profile: { fullName: 'Ravi Kumar', g_level: "Master's", g_field: 'Computer Science',
      g_country: 'Germany', d_course: 'B.Tech Computer Science', d_cgpa: '8.2', d_max: '10', d_pass: '5' } } });
    const o = await call('/api/orders', { method: 'POST', headers: { Cookie: c }, body: { packageId: 'pkg-three-public', acceptedTerms: true, sourcePage: '/' } });
    check('the order is owing (no gateway)', o.status === 200 && o.body.status === 'owing', JSON.stringify(o.body).slice(0, 120));
    const pub = s => ((s.body && s.body.shortlist) || []).filter(x => x.is_public || x.isPublic).length;
    const mid = await call('/api/state', { headers: { Cookie: c } });
    check('an unpaid order names no public university', pub(mid) === 0, String(pub(mid)));
    check('and the dashboard order is not "paid"', mid.body.order && !mid.body.order.paidAt && mid.body.order.status === 'owing', JSON.stringify(mid.body.order).slice(0, 160));
    const m = await call('/api/find/match?country=DE&level=master', { headers: { Cookie: c } });
    const named = ((m.body && m.body.named) || []).filter(x => x.isPublic && x.university).length;
    check('the finder names no public university either', named === 0, String(named));
    const ad = ck(await call('/api/auth/login', { method: 'POST', body: { email: 'admin@glovels.com', password: 'glovels123' } }));
    const pay = await call('/api/staff/order/' + o.body.reference + '/payment', { method: 'POST', headers: { Cookie: ad },
      body: { amount: o.body.grossPaise / 100, date: new Date().toISOString().slice(0, 10), method: 'upi', reference: 'UPI-1' } });
    check('the office records the payment', pay.status === 200, JSON.stringify(pay.body).slice(0, 160));
    const after = await call('/api/state', { headers: { Cookie: c } });
    check('the universities are named the moment it is recorded', pub(after) > 0, String(pub(after)));
    check('and the order reads paid', !!(after.body.order && after.body.order.paidAt), JSON.stringify(after.body.order).slice(0, 160));
  } catch (e) { bad.push('crashed: ' + e.stack); }
  finally { try { process.kill(-child.pid); } catch (e) {} }
  ok.forEach(x => console.log('  ✓ ' + x)); bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nunlocktest: ' + ok.length + ' passed, ' + bad.length + ' failed'); process.exit(bad.length ? 1 : 0);
})();
