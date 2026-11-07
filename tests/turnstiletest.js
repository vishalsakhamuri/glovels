/**
 * Patch 280: Cloudflare Turnstile on the public forms.
 * A stand-in for Cloudflare's siteverify answers "good" as a real answer,
 * anything else as wrong, and can be switched to "down". A stand-in for
 * Cloudflare's widget script lets a real browser send a real form.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = process.env.GLOVELS_ROOT || '/home/claude/glovels';
const PORT = 8280, PORT_OFF = 8281, CF = 8282;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

let cfDown = false, cfSeen = [];
const cf = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    const p = new URLSearchParams(b); cfSeen.push({ secret: p.get('secret'), response: p.get('response'), ip: p.get('remoteip') });
    if (cfDown) { res.writeHead(503); return res.end('down'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(p.get('response') === 'good' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }));
  });
});

function call(port, path, o) {
  o = o || {};
  return new Promise(resolve => {
    const headers = Object.assign({ 'User-Agent': UA, 'Accept-Language': 'en-GB,en', 'Content-Type': 'application/json',
      'X-Forwarded-For': o.ip || '203.0.113.9' }, o.headers || {});
    if (o.ts) headers['X-Glv-Ts'] = o.ts;
    if (o.cookie) headers.Cookie = o.cookie;
    const req = http.request({ host: 'localhost', port, path, method: o.method || 'GET', headers }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch (e) { j = { raw: out }; }
        resolve({ status: res.statusCode, body: j, headers: res.headers, text: out });
      });
    });
    req.on('error', () => resolve({ status: 0, body: {} }));
    if (o.body) req.write(JSON.stringify(o.body));
    req.end();
  });
}
function start(port, env) {
  const dir = '/tmp/db-' + port; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off' }, env) });
  child.unref();
  return child;
}
async function up(port) {
  for (let i = 0; i < 120; i++) { const r = await call(port, '/'); if (r.status === 200) return true; await new Promise(r => setTimeout(r, 500)); }
  return false;
}

(async () => {
  await new Promise(r => cf.listen(CF, r));
  const on = start(PORT, { TURNSTILE_SITEKEY: '0x4AAAAAAATestSiteKey', TURNSTILE_SECRET: '0x4AAAAAAATestSecret', TURNSTILE_VERIFY_URL: 'http://localhost:' + CF + '/siteverify' });
  const off = start(PORT_OFF, {});
  let browser;
  try {
    check('server with keys starts', await up(PORT));
    check('server without keys starts', await up(PORT_OFF));

    /* Pages */
    const home = await call(PORT, '/');
    check('the page carries the public site key', /name="glv-ts" content="0x4AAAAAAATestSiteKey"/.test(home.text));
    check('the secret never reaches the page', !/TestSecret/.test(home.text));
    check('the browser script is on the page', /data-glvts/.test(home.text));
    const csp = String(home.headers['content-security-policy'] || '');
    check('CSP allows Cloudflare\'s script', /script-src[^;]*challenges\.cloudflare\.com/.test(csp));
    check('CSP allows Cloudflare\'s frame', /frame-src[^;]*challenges\.cloudflare\.com/.test(csp));
    const login = await call(PORT, '/login');
    check('the sign-in page carries it too', /name="glv-ts"/.test(login.text), String(login.status));
    const homeOff = await call(PORT_OFF, '/');
    check('without keys nothing is added', !/glv-ts/.test(homeOff.text));

    /* Forms */
    const form = { name: 'Real Person', phone: '9876500111', email: 'real.person@example.com', consent: 'yes' };
    const e0 = await call(PORT, '/send.php', { method: 'POST', body: form, ip: '203.0.113.21' });
    check('contact form with no check is refused', e0.status === 403 && e0.body.captcha, e0.status + ' ' + JSON.stringify(e0.body));
    const e1 = await call(PORT, '/send.php', { method: 'POST', body: form, ts: 'forged', ip: '203.0.113.22' });
    check('a wrong answer is refused', e1.status === 403 && e1.body.captcha && e1.body.retry);
    const e2 = await call(PORT, '/send.php', { method: 'POST', body: form, ts: 'good', ip: '203.0.113.23' });
    check('a real answer goes through', e2.status === 200, e2.status + ' ' + JSON.stringify(e2.body));
    const last = cfSeen[cfSeen.length - 1] || {};
    check('the secret and visitor IP go to Cloudflare', last.secret === '0x4AAAAAAATestSecret' && last.ip === '203.0.113.23', JSON.stringify(last));
    const e3 = await call(PORT, '/api/enquiries', { method: 'POST', body: form, ip: '203.0.113.24' });
    check('the enquiry API is covered', e3.status === 403 && e3.body.captcha);

    const sg0 = await call(PORT, '/api/auth/signup', { method: 'POST', body: { name: 'Bot Signup', email: 'botsign@example.com', password: 'abcdefgh123', phone: '+919876500222' }, ip: '203.0.113.31' });
    check('sign-up with no check is refused', sg0.status === 403 && sg0.body.captcha, String(sg0.status));
    const sg1 = await call(PORT, '/api/auth/signup', { method: 'POST', ts: 'good', body: { name: 'Asha Student', email: 'asha.ts@example.com', password: 'abcdefgh123', phone: '+919876500333', consent: true, terms: true }, ip: '203.0.113.32' });
    check('sign-up with a real answer works', sg1.status === 200 || sg1.status === 201, sg1.status + ' ' + JSON.stringify(sg1.body).slice(0, 160));
    const cookie = String([].concat(sg1.headers['set-cookie'] || []).find(c => /session|glv_s|sid/i.test(c)) || [].concat(sg1.headers['set-cookie'] || [])[0] || '').split(';')[0];

    const ch0 = await call(PORT, '/api/chat/start', { method: 'POST', body: { name: 'Chat Bot', phone: '+919876500444', email: 'chatbot@example.com' }, ip: '203.0.113.41' });
    check('chat start with no check is refused', ch0.status === 403 && ch0.body.captcha);
    const fg0 = await call(PORT, '/api/auth/forgot', { method: 'POST', body: { email: 'asha.ts@example.com' }, ip: '203.0.113.42' });
    check('forgot password with no check is refused', fg0.status === 403 && fg0.body.captcha);
    const ap0 = await call(PORT, '/api/apply', { method: 'POST', body: { name: 'X' }, ip: '203.0.113.43' });
    check('guest application with no check is refused', ap0.status === 403 && ap0.body.captcha, String(ap0.status));

    if (cookie) {
      const chS = await call(PORT, '/api/chat/start', { method: 'POST', cookie, body: {}, ip: '203.0.113.32' });
      check('a signed-in student is not asked', chS.status === 200, chS.status + ' ' + JSON.stringify(chS.body).slice(0, 120));
    } else check('a signed-in student is not asked', false, 'no session cookie from sign-up');

    cfDown = true;
    const d = await call(PORT, '/send.php', { method: 'POST', body: Object.assign({}, form, { email: 'down@example.com' }), ts: 'anything', ip: '203.0.113.51' });
    check('if Cloudflare is down the form still goes through', d.status === 200, String(d.status));
    cfDown = false;

    const o0 = await call(PORT_OFF, '/send.php', { method: 'POST', body: form, ip: '203.0.113.61' });
    check('without keys forms work as before', o0.status === 200, String(o0.status));

    /* A real browser sending the real contact form, with Cloudflare's
       widget replaced by a stand-in that answers "good". */
    browser = await chromium.launch();
    const page = await browser.newPage({ userAgent: UA });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body:
      'window.turnstile={render:function(el,o){window.__o=o;return "w1"},execute:function(){var o=window.__o;setTimeout(function(){o.callback("good")},50)},reset:function(){}};' +
      '(function(){var s=document.currentScript&&document.currentScript.src||"";var m=/onload=([^&]+)/.exec(s);if(m&&window[m[1]])window[m[1]]();})();' }));
    let sentTs = null;
    page.on('request', r => { if (/\/send\.php|\/api\/enquiries/.test(r.url()) && r.method() === 'POST') sentTs = r.headers()['x-glv-ts'] || ''; });
    await page.goto('http://localhost:' + PORT + '/contact-us', { waitUntil: 'load' });
    const status = await page.evaluate(async () => {
      const r = await fetch('/send.php', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Browser Person', phone: '9876500999', email: 'browser.person@example.com', consent: 'yes' }) });
      return r.status;
    });
    check('in a browser the page fetches the answer and sends it', sentTs === 'good', String(sentTs));
    check('and the form is accepted', status === 200, String(status));
    const other = await page.evaluate(async () => (await fetch('/api/content')).status);
    check('other requests are untouched', other === 200, String(other));
    check('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  } catch (e) {
    check('test ran', false, String(e && e.stack || e).slice(0, 300));
  } finally {
    if (browser) await browser.close();
    try { process.kill(-on.pid); } catch (e) { try { on.kill(); } catch (_) {} }
    try { process.kill(-off.pid); } catch (e) { try { off.kill(); } catch (_) {} }
    cf.close();
    console.log('\nturnstile: ' + ok.length + ' passed, ' + bad.length + ' failed');
    bad.forEach(b => console.log('  ✗ ' + b));
    process.exit(bad.length ? 1 : 0);
  }
})();
