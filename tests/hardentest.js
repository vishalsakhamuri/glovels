/**
 * The front door, kicked.
 *
 * Everything a script does to a site the day it is indexed — fill every form,
 * guess passwords, pour mail at an address, post from another site, send a
 * body the size of a film — done here against a running server, and what the
 * server answers read back. No browser: these are the requests a browser
 * would never make, which is the point.
 *
 *   ./tests/srv.sh 8099
 *   node tests/hardentest.js
 */
const BASE = process.env.BASE || 'http://localhost:8099';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@glovels.com', password: process.env.ADMIN_PASSWORD || 'glovels123' };
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const post = (p, body, headers, raw) => fetch(BASE + p, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
  body: raw ? body : JSON.stringify(body),
  redirect: 'manual',
});
const ip = n => ({ 'X-Forwarded-For': '203.0.113.' + n });

(async () => {
  /* ------------------------------------------------ the honeypot, everywhere */
  let r = await post('/api/enquiries', { name: 'Bot', email: 'bot@example.com', phone: '9876543210', website: 'http://spam' }, ip(1));
  check('a filled honeypot on the blog form is swallowed with a 200', r.status === 200);
  r = await post('/send.php', { name: 'Bot', email: 'bot@example.com', phone: '9876543210', website: 'x' }, ip(1));
  check('and on the contact form', r.status === 200);

  /* ------------------------------------------------ per-address budgets */
  const flood = async (p, body, n, who) => {
    const codes = [];
    for (let i = 0; i < n; i++) codes.push((await post(p, body, ip(who))).status);
    return codes;
  };
  let codes = await flood('/api/auth/forgot', { email: 'nobody@example.com' }, 8, 10);
  check('forgot-password stops after six from one address', codes.filter(c => c === 429).length >= 2, codes.join(','));

  codes = [];
  for (let i = 0; i < 5; i++) codes.push((await post('/api/auth/forgot', { email: 'target@example.com' }, ip(20 + i))).status);
  check('and after three aimed at one inbox from anywhere', codes.filter(c => c === 429).length >= 2, codes.join(','));

  codes = await flood('/api/auth/signup', { name: 'S', email: 'x@example.com', password: 'pw' }, 12, 30);
  check('sign-up stops after ten from one address', codes.slice(-1)[0] === 429, codes.join(','));

  codes = await flood('/api/auth/reset', { token: 'nope', password: 'longenough1' }, 12, 40);
  check('reset stops after ten from one address', codes.slice(-1)[0] === 429, codes.join(','));

  /* The made-up address trick: a script writing its own X-Forwarded-For. */
  codes = [];
  for (let i = 0; i < 9; i++) {
    codes.push((await post('/api/auth/forgot', { email: 'nobody' + i + '@example.com' },
      { 'X-Forwarded-For': '1.2.3.' + i + ', 198.51.100.7' })).status);
  }
  check('a forged address at the left of X-Forwarded-For does not buy a fresh budget',
    codes.slice(-1)[0] === 429, codes.join(','));

  /* ------------------------------------------------ chat send */
  r = await post('/api/chat/start', { name: 'T', contact: 'chat@example.com', body: 'hi' }, ip(50));
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  check('a chat can be started', r.status === 200 && /glovels_chat=/.test(cookie), String(r.status));
  codes = [];
  for (let i = 0; i < 125; i++) {
    codes.push((await post('/api/chat/send', { body: 'msg ' + i }, Object.assign({ Cookie: cookie }, ip(50)))).status);
  }
  check('chat sends stop at 120 a minute', codes.slice(-1)[0] === 429 && codes[0] === 200, codes[0] + '…' + codes.slice(-1)[0]);

  /* ------------------------------------------------ another site's page */
  r = await post('/api/enquiries', { name: 'X', email: 'x@example.com', phone: '9876543210' },
    Object.assign({ Origin: 'https://evil.example' }, ip(60)));
  check('a POST whose Origin is another site is refused', r.status === 403, String(r.status));
  r = await post('/api/enquiries', { name: 'X', email: 'x@example.com', phone: '9876543210' },
    Object.assign({ Origin: 'null' }, ip(60)));
  check('and a null Origin', r.status === 403, String(r.status));
  r = await post('/api/enquiries', { name: 'X', email: 'x' + Date.now() + '@example.com', phone: '9876543210' },
    Object.assign({ Origin: BASE }, ip(61)));
  check('while our own pages still get through', r.status === 200, String(r.status));
  r = await fetch(BASE + '/api/catalogue', { headers: { Origin: 'https://evil.example' } });
  check('a GET from anywhere is unaffected', r.status === 200, String(r.status));

  /* ------------------------------------------------ bodies */
  const big = '{"name":"' + 'a'.repeat(70 * 1024) + '"}';
  try {
    r = await post('/api/enquiries', big, ip(70), true);
    check('a 70 KB JSON body is not accepted', r.status !== 200, String(r.status));
  } catch (e) {
    check('a 70 KB JSON body is not accepted', true, 'connection closed');
  }
  r = await post('/api/enquiries', '{not json', ip(71), true);
  check('rubbish JSON is a validation error, not a crash', r.status === 422, String(r.status));

  /* ------------------------------------------------ the WhatsApp door */
  r = await post('/api/whatsapp/webhook', { entry: [{ changes: [{ value: { messages: [{ type: 'text', from: '917839399999', text: { body: 'hello' } }] } }] }] });
  check('an unsigned WhatsApp callback is refused, not written into a conversation',
    r.status === 503 || r.status === 403, String(r.status));
  /* With a secret configured (WHATSAPP_APP_SECRET=testsecret on the server),
     a correctly signed callback is the only one that gets in. */
  if (r.status === 403) {
    const crypto = require('crypto');
    const body = JSON.stringify({ entry: [] });
    const sig = 'sha256=' + crypto.createHmac('sha256', 'testsecret').update(body).digest('hex');
    r = await post('/api/whatsapp/webhook', body, { 'X-Hub-Signature-256': sig }, true);
    check('a callback signed with the app secret is accepted', r.status === 200, String(r.status));
    r = await post('/api/whatsapp/webhook', body, { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }, true);
    check('and one signed with anything else is not', r.status === 403, String(r.status));
  }

  /* ------------------------------------------------ headers */
  r = await fetch(BASE + '/');
  const h = k => r.headers.get(k) || '';
  check('pages carry a Content-Security-Policy', /frame-ancestors 'self'/.test(h('content-security-policy')), h('content-security-policy').slice(0, 60));
  check('with no plugins and no <base> hijack', /object-src 'none'/.test(h('content-security-policy')) && /base-uri 'self'/.test(h('content-security-policy')));
  check('and a Permissions-Policy', /camera=\(\)/.test(h('permissions-policy')), h('permissions-policy'));
  check('nosniff, frame options, referrer policy', h('x-content-type-options') === 'nosniff' && h('x-frame-options') === 'SAMEORIGIN' && !!h('referrer-policy'));
  r = await fetch(BASE + '/api/catalogue');
  check('API answers carry nosniff and refuse framing', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY');

  /* ------------------------------------------------ backups */
  r = await post('/api/auth/login', ADMIN, ip(80));
  const admin = (r.headers.get('set-cookie') || '').split(';')[0];
  check('the administrator signs in', r.status === 200 && /glovels_session=/.test(admin), String(r.status));
  if (admin) {
    r = await fetch(BASE + '/api/staff/backup.tar');
    check('the backup needs a sign-in', r.status === 401, String(r.status));
    r = await post('/api/staff/backups', {}, { Cookie: admin });
    const d = await r.json().catch(() => ({}));
    check('an admin can take a copy now', r.status === 200 && /^glovels-\d{4}-\d{2}-\d{2}\.(db|json)$/.test(d.file || ''), JSON.stringify(d).slice(0, 80));
    r = await fetch(BASE + '/api/staff/backups', { headers: { Cookie: admin } });
    const l = await r.json().catch(() => ({}));
    check('and it is listed with a size', Array.isArray(l.copies) && l.copies.length >= 1 && l.copies[0].bytes > 0, JSON.stringify(l).slice(0, 80));

    r = await fetch(BASE + '/api/staff/backup.tar', { headers: { Cookie: admin } });
    const buf = Buffer.from(await r.arrayBuffer());
    check('the download is a tar', r.status === 200 && /x-tar/.test(r.headers.get('content-type') || '') && buf.length % 512 === 0, r.status + ' ' + buf.length + ' bytes');
    const name = buf.subarray(0, 100).toString().replace(/\0.*$/, '');
    const magic = buf.subarray(257, 262).toString();
    check('whose first entry is the database', magic === 'ustar' && /^data\/glovels/.test(name), name);
    /* Untar it with the system tar, which is a second opinion on the format. */
    const fs = require('fs'), cp = require('child_process'), os = require('os'), path = require('path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glv-tar-'));
    fs.writeFileSync(path.join(tmp, 'b.tar'), buf);
    const res = cp.spawnSync('tar', ['-tf', 'b.tar'], { cwd: tmp, encoding: 'utf8' });
    check('and the system tar reads every entry', res.status === 0 && /data\/glovels\.(db|json)/.test(res.stdout), (res.stderr || res.stdout).trim().split('\n')[0]);
    const listed = res.stdout.trim().split('\n');
    check('the nightly copies are not inside it', !listed.some(x => /backups\//.test(x)));
    cp.spawnSync('tar', ['-xf', 'b.tar'], { cwd: tmp });
    const dbf = listed.find(x => /glovels\.db$/.test(x));
    if (dbf) {
      const head = fs.readFileSync(path.join(tmp, dbf)).subarray(0, 16).toString();
      check('the database inside opens as SQLite', /^SQLite format 3/.test(head), JSON.stringify(head));
    }
  }

  /* ------------------------------------------------ a counsellor may not */
  r = await post('/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' }, ip(81));
  const c = (r.headers.get('set-cookie') || '').split(';')[0];
  if (r.status === 200) {
    r = await fetch(BASE + '/api/staff/backup.tar', { headers: { Cookie: c } });
    check('a counsellor cannot download the backup', r.status === 403, String(r.status));
  }

  console.log('\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) console.log('\n' + bad.map(x => '  ✗ ' + x).join('\n'));
  console.log('\n  ' + ok.length + ' passed, ' + bad.length + ' failed\n');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
