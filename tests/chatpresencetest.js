'use strict';
/*
 * 3 Nov (owner): the website chat box shows no office hours — "Live now"
 * while a staff screen is open, "Someone will reply" otherwise — and when
 * nobody is at a desk, a new chat goes by email to every counsellor and
 * administrator, so someone answers it.
 *
 * Boots its own server (PORT, default 8314) with LEAD_MINUTE_MS=1000 so a
 * burst flushes in a second, reads the mail outbox on disk.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8314);
const dir = '/tmp/db-' + PORT;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
let pass = 0, fail = 0;
const check = (name, ok, note) => { if (ok) pass++; else fail++; console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || note == null ? '' : ' — ' + note)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const call = (p, opts) => new Promise(resolve => {
  opts = opts || {};
  const req = http.request({ host: 'localhost', port: PORT, path: p, method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, opts.headers || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts.body) req.write(JSON.stringify(opts.body));
  req.end();
});
const cookieOf = r => String((r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '));
const login = async (email, pw) => cookieOf(await call('/api/auth/login', { method: 'POST', body: { email, password: pw || 'glovels123' } }));
/* The page token the guard wants: taken from a public page's <meta name="glv-t">. */
const token = async () => { const r = await call('/'); const m = /name="glv-t" content="([^"]+)"/.exec(r.body.raw || ''); return m ? m[1] : ''; };
const outbox = () => (fs.existsSync(dir + '/outbox') ? fs.readdirSync(dir + '/outbox') : []).map(f => ({ f, text: fs.readFileSync(dir + '/outbox/' + f, 'utf8') }));
const mailsTo = who => outbox().filter(m => new RegExp(who.replace('.', '\\.'), 'i').test(m.f) || new RegExp('^To: .*' + who.replace('.', '\\.'), 'im').test(m.text));

(async () => {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', LEAD_MINUTE_MS: '1000', LEAD_SLA_TICK_MS: '500' }) });
  let open = null;
  try {
    for (let i = 0; i < 80; i++) { await wait(400); if ((await call('/api/health')).status === 200) break; }
    await wait(1500);
    const t = await token();   /* empty when the guard is off (the local default) — the form takes it either way */

    /* Nobody at a desk. */
    let r = await call('/api/chat');
    check('with no staff screen open, /api/chat says staffOnline:false', r.status === 200 && r.body.staffOnline === false, JSON.stringify(r.body));
    const page = (await call('/study-in-germany')).body.raw || '';
    const js = /src="(\/js\/study-in-germany\.[a-f0-9]+\.js)"/.exec(page);
    const widget = js ? (await call(js[1])).body.raw || '' : page;
    check('the chat box no longer prints the office hours', !/9:30am/.test(widget) && !/Replies appear here/.test(widget));
    check('…and says "Live now" or "Someone will reply" from the server\'s answer', /Live now/.test(widget) && /Someone will reply/.test(widget) && /staffOnline/.test(widget));

    const before = outbox().length;
    r = await call('/api/chat/start', { method: 'POST', headers: { 'X-Glv-T': t }, body: { name: 'Night Visitor', contact: 'night.visitor@example.com', body: 'Is anyone there? I want to study in Germany.' } });
    check('a visitor starts a chat at night', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 100));
    await wait(3500);                                            // the burst flushes (one "minute" = 1 s)
    const kavya = mailsTo('kavya@glovels.com').filter(m => /Website chat/.test(m.text));
    const admin = mailsTo('admin@glovels.com').filter(m => /Website chat/.test(m.text));
    check('the counsellor was emailed the chat (nobody was at a desk)', kavya.length >= 1, outbox().slice(before).map(m => m.f).join(','));
    check('…and the administrator too', admin.length >= 1, outbox().slice(before).map(m => m.f).join(','));
    check('…one mail each, not one per message', kavya.length === 1 && admin.length === 1, kavya.length + '/' + admin.length);

    /* A counsellor opens her screen: the live feed is enough, no mail. */
    const kc = await login('kavya@glovels.com');
    open = http.request({ host: 'localhost', port: PORT, path: '/api/live', headers: { Cookie: kc, Accept: 'text/event-stream', 'User-Agent': UA } });
    open.end();
    await wait(800);
    r = await call('/api/chat');
    check('with a counsellor screen open, /api/chat says staffOnline:true', r.body.staffOnline === true, JSON.stringify(r.body));
    const before2 = mailsTo('kavya@glovels.com').length;
    const guestCookie = cookieOf(await call('/api/chat/start', { method: 'POST', headers: { 'X-Glv-T': t }, body: { name: 'Day Visitor', contact: 'day.visitor@example.com', body: 'Hello, UK masters?' } }));
    void guestCookie;
    await wait(3500);
    check('a chat while she is at her desk does not email her', mailsTo('kavya@glovels.com').length === before2, mailsTo('kavya@glovels.com').length + ' vs ' + before2);
  } finally {
    try { if (open) open.destroy(); } catch (e) {}
    try { process.kill(-child.pid); } catch (e) { try { child.kill(); } catch (e2) {} }
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
