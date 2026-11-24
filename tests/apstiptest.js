/**
 * Patch 284: the APS / blocked-account welcome tip goes to Germany students only.
 *
 * Owner, 24 Nov: "This APS process is only for German students. Please send
 * this message only for German students; for other country students sending
 * this message is not required."
 *
 * Boots its own server and checks: a new student with no destination gets the
 * welcome and not the tip; saving the UK does not send it; saving Germany
 * does, once, in the new wording; a destination list that includes Germany
 * counts; a home country outside India, China, Vietnam and Mongolia gets the
 * blocked account alone; and a counsellor saving Germany for a student counts.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8284;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts && opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const login = async (email) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};

(async () => {
  const dir = '/tmp/db-apstip-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    let n = 0;
    const signup = async name => {
      n++;
      const r = await call('/api/auth/signup', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.' + (40 + n) },
        body: { name, email: name.toLowerCase().replace(/\s+/g, '.') + '@mail.test', phone: '+9198765' + String(40000 + n), password: 'abcdefgh123', terms: true, consent: true } });
      return { status: r.status, cookie: String([].concat(r.headers['set-cookie'] || []).find(x => !/^glovels_chat=/.test(x)) || '').split(';')[0] };
    };
    const thread = async ck => ((await call('/api/state', { headers: { Cookie: ck } })).body.msgs || []).map(m => String(m.t || ''));
    const save = (ck, patch) => call('/api/profile', { method: 'PUT', headers: { Cookie: ck }, body: { profile: patch } });
    const tip = t => t.filter(x => /blocked account/i.test(x));

    const a = await signup('Asha Nair');
    const t0 = await thread(a.cookie);
    check('a new student is welcomed', a.status === 200 && t0.some(x => /^Welcome/.test(x)), a.status + ' ' + JSON.stringify(t0).slice(0, 160));
    check('with no destination yet, the APS and blocked-account tip is not sent', tip(t0).length === 0, JSON.stringify(t0).slice(0, 200));
    const uk = await save(a.cookie, { g_country: 'United Kingdom' });
    check('saving the United Kingdom does not send it', uk.status === 200 && tip(await thread(a.cookie)).length === 0, String(uk.status));
    const de = await save(a.cookie, { g_country: 'Germany' });
    const t1 = tip(await thread(a.cookie));
    check('saving Germany sends it, in the new wording', de.status === 200 && t1.length === 1 && /for Germany/.test(t1[0]) && /APS certificate/.test(t1[0]), JSON.stringify(t1));
    await save(a.cookie, { g_country: 'Germany', g_intake: 'Winter 2027' });
    await call('/api/auth/login', { method: 'POST', body: { email: 'asha.nair@mail.test', password: 'abcdefgh123' } });
    check('and only once, however often the profile is saved or they sign in', tip(await thread(a.cookie)).length === 1);

    const b = await signup('Bilal Khan');
    await save(b.cookie, { g_country: 'UK, DE' });
    check('a list of destinations that includes Germany counts', tip(await thread(b.cookie)).length === 1, JSON.stringify(await thread(b.cookie)).slice(0, 200));

    const c = await signup('Chidi Okafor');
    await save(c.cookie, { addr_country: 'Nigeria', g_country: 'Germany' });
    const t3 = tip(await thread(c.cookie));
    check('educated outside India, China, Vietnam and Mongolia: the blocked account alone, no APS', t3.length === 1 && !/APS/.test(t3[0]) && /for Germany/.test(t3[0]), JSON.stringify(t3));
  } catch (e) { bad.push('the suite ran to the end — ' + String(e && e.message || e).slice(0, 300)); }
  finally { try { process.kill(-child.pid); } catch (e) {} }
  ok.forEach(n => console.log('  ✓ ' + n)); bad.forEach(n => console.log('  ✗ ' + n));
  console.log('apstiptest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
