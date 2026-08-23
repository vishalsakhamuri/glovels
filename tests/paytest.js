/**
 * Razorpay: what is trusted, and what is refused.
 *
 * Real payments cannot be made from a test, and that is not the interesting
 * part anyway. The interesting part is everything a hostile browser can try —
 * claiming a payment that never happened, replaying somebody else's signature,
 * paying ₹1 for a ₹75,000 package — and every one of those is a request this
 * server can receive whether or not a real card is involved.
 *
 * So: a stand-in Razorpay on localhost, a known key secret, and signatures
 * computed the way Razorpay computes them. Runs its own servers.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const ROOT = require('path').join(__dirname, '..');
const KEY_ID = 'rzp_test_glovels';
const KEY_SECRET = 'a-secret-no-browser-has-seen';
const HOOK_SECRET = 'a-webhook-secret';
const FAKE_PORT = 8061;
const PORT = 8062;

const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const sign = (secret, payload) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

/* ---------------------------------------------------- the stand-in gateway */
let created = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v1/orders') {
      const o = JSON.parse(body || '{}');
      const id = 'order_' + crypto.randomBytes(6).toString('hex');
      created.push({ id, amount: o.amount, receipt: o.receipt });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id, amount: o.amount, currency: 'INR',
        receipt: o.receipt, status: 'created' }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});

const get = (port, path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port, path,
    method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {} }, res => {
    let out = '';
    res.on('data', c => { out += c; });
    res.on('end', () => {
      let j = null;
      try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {} }));
  if (opts && opts.body) req.write(opts.body);
  req.end();
});

const post = (port, path, obj, headers) => get(port, path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
  body: typeof obj === 'string' ? obj : JSON.stringify(obj),
});

async function boot(port, env) {
  const dir = '/tmp/db-pay-' + port;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn('node', ['serve.js'], {
    cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir }, env),
  });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 400));
    if ((await get(port, '/api/health')).status === 200) return child;
  }
  child.kill();
  throw new Error('server on ' + port + ' never answered');
}

(async () => {
  const kids = [];
  await new Promise(r => fake.listen(FAKE_PORT, r));

  try {
    kids.push(await boot(PORT, {
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: HOOK_SECRET,
      RAZORPAY_API_BASE: 'http://localhost:' + FAKE_PORT,
    }));

    /* --------------------------------------------------- it says it is on */
    const cfg = await get(PORT, '/api/pay/config');
    check('the page is told a gateway is collecting', cfg.body.enabled === true);
    check('and given the public key id', cfg.body.keyId === KEY_ID, cfg.body.keyId);
    check('but never the secret', !JSON.stringify(cfg.body).includes(KEY_SECRET));

    /* ------------------------------------------------- an order is created */
    const made = await post(PORT, '/api/orders', {
      packageId: 'pkg-roadmap', name: 'Ananya Rao',
      email: 'pay@example.com', phone: '9812345678',
    });
    const ref = made.body.reference;
    check('an order is created', made.status === 200 && /^GLV-\d+$/.test(ref || ''), ref);
    check('and it is NOT paid yet', made.body.status === 'awaiting', made.body.status);
    check('the gateway was asked for an order', created.length === 1, created.length);
    check('for the amount THIS server priced, not one the browser sent',
      created[0].amount === made.body.grossPaise,
      created[0].amount + ' vs ' + made.body.grossPaise);
    check('and the page is handed what it needs to open the card sheet',
      !!(made.body.razorpay && made.body.razorpay.orderId && made.body.razorpay.keyId));

    const gatewayOrder = made.body.razorpay.orderId;

    /* --------------------------------- the universities are NOT handed over */
    const before = await get(PORT, '/api/catalogue');
    const namedBefore = (before.body.programmes || []).filter(p => p.isPublic && p.university);
    check('nothing is unlocked while the payment is only started',
      namedBefore.length === 0, namedBefore.length + ' named');

    /* ============================== what a hostile browser can try ========= */

    const browser = await chromium.launch();
    const staff = await browser.newContext();
    await staff.request.post('http://localhost:' + PORT + '/api/auth/login',
      { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const statusOf = async r0 => {
      const b = await (await staff.request.get(
        'http://localhost:' + PORT + '/api/staff/orders')).json();
      const row = (b.orders || []).find(o => o.reference === r0);
      return row ? row.status : 'gone';
    };

    const claim = (obj) => post(PORT, '/api/orders/' + ref + '/paid', obj);

    let r = await claim({});
    check('a bare claim of payment is refused', r.status === 400, r.status);

    r = await claim({
      razorpay_order_id: gatewayOrder,
      razorpay_payment_id: 'pay_forged',
      razorpay_signature: 'not-a-signature',
    });
    check('an invented signature is refused', r.status === 400, r.status);

    r = await claim({
      razorpay_order_id: gatewayOrder,
      razorpay_payment_id: 'pay_x',
      razorpay_signature: sign('the-wrong-secret', gatewayOrder + '|pay_x'),
    });
    check('a signature made with the wrong secret is refused', r.status === 400, r.status);

    /* A real signature — but for a different order. This is the attack that
       gets past a naive check: sign a ₹1 payment of your own, post it here. */
    const other = 'order_someone_elses';
    r = await claim({
      razorpay_order_id: other,
      razorpay_payment_id: 'pay_real',
      razorpay_signature: sign(KEY_SECRET, other + '|pay_real'),
    });
    check('a VALID signature for somebody else\'s order is refused', r.status === 400, r.status);

    /* The real check, not a shrug. Four forged claims have been made against
       this order; it must still be sitting where it was. */
    check('and after all four attempts the order is still unpaid',
      (await statusOf(ref)) === 'awaiting', await statusOf(ref));

    /* ------------------------------------------- the real thing is accepted */
    const payId = 'pay_' + crypto.randomBytes(5).toString('hex');
    r = await claim({
      razorpay_order_id: gatewayOrder,
      razorpay_payment_id: payId,
      razorpay_signature: sign(KEY_SECRET, gatewayOrder + '|' + payId),
    });
    check('the genuine signature is accepted', r.status === 200 && r.body.status === 'paid',
      r.status + ' ' + JSON.stringify(r.body).slice(0, 60));

    r = await claim({
      razorpay_order_id: gatewayOrder,
      razorpay_payment_id: payId,
      razorpay_signature: sign(KEY_SECRET, gatewayOrder + '|' + payId),
    });
    check('and sending it twice does not double anything', r.status === 200, r.status);

    /* ================================= the webhook, which is the authority == */
    const hookBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_hook', order_id: gatewayOrder,
        amount: made.body.grossPaise } } },
    });

    r = await post(PORT, '/api/razorpay/webhook', hookBody,
      { 'x-razorpay-signature': 'nope' });
    check('an unsigned webhook is refused', r.status === 400, r.status);

    r = await post(PORT, '/api/razorpay/webhook', hookBody,
      { 'x-razorpay-signature': sign('wrong-hook-secret', hookBody) });
    check('a webhook signed with the wrong secret is refused', r.status === 400, r.status);

    r = await post(PORT, '/api/razorpay/webhook', hookBody,
      { 'x-razorpay-signature': sign(HOOK_SECRET, hookBody) });
    check('a properly signed webhook is accepted', r.status === 200, r.status);

    /* A second order, paid ONLY by webhook — the student whose browser never
       came back. This is the case the webhook exists for. */
    const two = await post(PORT, '/api/orders', {
      packageId: 'pkg-boarding', name: 'Rohit K',
      email: 'hook@example.com', phone: '9812345670',
    });
    const twoGateway = two.body.razorpay.orderId;

    const shortBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_short', order_id: twoGateway, amount: 100 } } },
    });
    r = await post(PORT, '/api/razorpay/webhook', shortBody,
      { 'x-razorpay-signature': sign(HOOK_SECRET, shortBody) });
    check('a webhook paying ₹1 for a ₹74,999 package does not settle it',
      r.status === 200 && /mismatch/.test(JSON.stringify(r.body)),
      JSON.stringify(r.body).slice(0, 80));

    const fullBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_full', order_id: twoGateway,
        amount: two.body.grossPaise } } },
    });
    r = await post(PORT, '/api/razorpay/webhook', fullBody,
      { 'x-razorpay-signature': sign(HOOK_SECRET, fullBody) });
    check('but the right amount does', r.status === 200);

    /* ------------------------------------ the office can see all of it */
    const book = await (await staff.request.get(
      'http://localhost:' + PORT + '/api/staff/orders')).json();
    /* By reference, not by count: the demo database seeds an order of its own,
       and asserting "two paid orders exist" is a claim about the seed rather
       than about the payments this test just made. */
    const mine = book.orders.filter(
      o => o.reference === ref || o.reference === two.body.reference);
    check('the office sees both of these payments',
      mine.length === 2 && mine.every(o => o.status === 'paid'),
      mine.map(o => o.reference + ':' + o.status).join(' '));
    check('and neither has an account behind it yet',
      mine.every(o => !o.studentId), book.guests + ' guest orders in all');
    await browser.close();

    /* ===================== and with no keys, the site works as it always did = */
    kids.push(await boot(PORT + 1, {}));
    const off = await get(PORT + 1, '/api/pay/config');
    check('with no keys the page is told there is no gateway', off.body.enabled === false);

    const plain = await post(PORT + 1, '/api/orders', {
      packageId: 'pkg-roadmap', name: 'Ananya Rao',
      email: 'nogateway@example.com', phone: '9812345678',
    });
    check('an order is still placed', plain.status === 200 && !!plain.body.reference);
    check('it carries no card sheet to open', !plain.body.razorpay);
    check('and it is owed to a counsellor, not awaiting a gateway',
      plain.body.status === 'owing', plain.body.status);

    const claimOff = await post(PORT + 1, '/api/orders/' + plain.body.reference + '/paid', {
      razorpay_order_id: 'x', razorpay_payment_id: 'y', razorpay_signature: 'z',
    });
    check('and nothing can claim a payment on a site that takes none',
      claimOff.status === 409, claimOff.status);

    const hookOff = await post(PORT + 1, '/api/razorpay/webhook', '{}',
      { 'x-razorpay-signature': 'x' });
    check('the webhook refuses to act without a secret to verify with',
      hookOff.status === 503, hookOff.status);
  } finally {
    kids.forEach(k => { try { process.kill(-k.pid); } catch (e) { try { k.kill(); } catch (e2) {} } });
    fake.close();
  }

  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); fake.close(); process.exit(2); });
