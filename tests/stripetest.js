/**
 * Patch 195: India → Razorpay, anywhere else → Stripe (Glovels UG).
 *
 * A stand-in Razorpay AND a stand-in Stripe on localhost. Checks the routing
 * (who goes where), that nothing is paid because a browser came back, that
 * Stripe's word is checked for currency and amount, the webhook's signature
 * and timestamp, and that the return and the webhook together settle once.
 */
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const STRIPE = require(ROOT + '/server/stripe.js');
const SK = 'sk_test_glovels';
const HOOK = 'whsec_glovels';
const RZP_PORT = 8071, ST_PORT = 8072, PORT = 8073;

const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

/* ------------------------------------------------------------ unit checks */
check('USD in cents, rounded up', STRIPE.minorFor('USD', 571.234) === 57124, STRIPE.minorFor('USD', 571.234));
check('JPY has no minor unit', STRIPE.minorFor('JPY', 8800) === 8800);
check('KWD in three decimals, a multiple of 10', STRIPE.minorFor('KWD', 17.6543) === 17660, STRIPE.minorFor('KWD', 17.6543));
check('HUF in whole forints ×100', STRIPE.minorFor('HUF', 2105.3) === 210600, STRIPE.minorFor('HUF', 2105.3));
{
  const s = STRIPE.makeStripe({ secretKey: SK, webhookSecret: HOOK });
  const raw = '{"a":1}', t = 1700000000;
  const v1 = crypto.createHmac('sha256', HOOK).update(t + '.' + raw).digest('hex');
  check('a correctly signed webhook verifies', s.verifyWebhook(raw, 't=' + t + ',v1=' + v1, t + 10));
  check('an old one is refused (replay)', !s.verifyWebhook(raw, 't=' + t + ',v1=' + v1, t + 1000));
  check('a changed body is refused', !s.verifyWebhook('{"a":2}', 't=' + t + ',v1=' + v1, t));
}

/* ------------------------------------------------------ stand-in gateways */
const rzpOrders = [];
const rzp = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    const o = JSON.parse(b || '{}'); const id = 'order_' + crypto.randomBytes(5).toString('hex');
    rzpOrders.push(Object.assign({ id }, o));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, amount: o.amount, currency: o.currency }));
  });
});
const sessions = {};
let payOut = 'paid';             // what the stand-in reports on retrieve
let amountSkew = 0;              // to fake a session paid for less
const st = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.headers.authorization !== 'Bearer ' + SK) { res.writeHead(401); return res.end('{}'); }
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const q = new URLSearchParams(b);
      const id = 'cs_test_' + crypto.randomBytes(6).toString('hex');
      sessions[id] = { id, currency: q.get('line_items[0][price_data][currency]'),
        amount_total: Number(q.get('line_items[0][price_data][unit_amount]')),
        metadata: { reference: q.get('metadata[reference]'), part: q.get('metadata[part]') },
        success: q.get('success_url'), cancel: q.get('cancel_url'), email: q.get('customer_email') };
      return res.end(JSON.stringify({ id, url: 'https://checkout.stripe.test/' + id }));
    }
    const m = /^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(req.url);
    if (req.method === 'GET' && m && sessions[m[1]]) {
      const s = sessions[m[1]];
      return res.end(JSON.stringify(Object.assign({}, s, { amount_total: s.amount_total - amountSkew,
        payment_status: payOut, status: payOut === 'paid' ? 'complete' : 'open', payment_intent: 'pi_' + m[1].slice(8) })));
    }
    res.end('{}');
  });
});

const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts && opts.body) req.write(opts.body);
  req.end();
});
const order = (currency, country, email) => call('/api/orders', { method: 'POST',
  headers: country ? { 'cf-ipcountry': country } : {},
  body: JSON.stringify({ packageId: 'pkg-roadmap', name: 'Test Buyer', email, phone: '+234 803 123 4567',
    acceptedTerms: true, currency, sourcePage: '/services' }) });
const hook = obj => {
  const raw = JSON.stringify(obj), t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', HOOK).update(t + '.' + raw).digest('hex');
  return call('/api/stripe/webhook', { method: 'POST', body: raw, headers: { 'Stripe-Signature': 't=' + t + ',v1=' + v1 } });
};

(async () => {
  await new Promise(r => rzp.listen(RZP_PORT, r));
  await new Promise(r => st.listen(ST_PORT, r));
  const dir = '/tmp/db-stripe-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir,
      RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'rzs', RAZORPAY_WEBHOOK_SECRET: 'rzh',
      RAZORPAY_API_BASE: 'http://localhost:' + RZP_PORT,
      STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: HOOK, GEO_TRUST_HEADER: 'cf-ipcountry', STRIPE_API_BASE: 'http://localhost:' + ST_PORT }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }

    const cfg = await call('/api/pay/config');
    check('the page is told Stripe takes buyers abroad', cfg.body.stripe === true && /Glovels UG/.test(cfg.body.sellerAbroad || ''));
    check('the secret key is never sent', !JSON.stringify(cfg.body).includes(SK));

    /* India: rupees → Razorpay */
    const a = await order('INR', 'IN', 'in@example.com');
    check('India, rupees → Razorpay', a.status === 200 && !!a.body.razorpay && !a.body.stripe, JSON.stringify(a.body).slice(0, 120));
    /* India, paying in dollars → still Razorpay (an Indian sale) */
    const b = await order('USD', 'IN', 'inusd@example.com');
    check('India, dollars → still Razorpay, GST included', !!b.body.razorpay && !b.body.stripe && b.body.exportSale === false);
    /* Abroad → Stripe */
    const c = await order('USD', 'NG', 'ng@example.com');
    const sid = c.body.stripe && c.body.stripe.sessionId;
    check('Nigeria, dollars → Stripe', !!c.body.stripe && !c.body.razorpay && /^https:\/\/checkout\.stripe\.test\//.test(c.body.stripe.url));
    check('an export sale (no GST), awaiting payment', c.body.exportSale === true && c.body.status === 'awaiting');
    const s = sessions[sid] || {};
    check('Stripe asked in USD for the amount THIS server priced', s.currency === 'usd' && s.amount_total === c.body.stripe.amountMinor && s.amount_total > 0, s.currency + ' ' + s.amount_total);
    check('the session is tied to the order', s.metadata && s.metadata.reference === c.body.reference);
    check('back to OUR return route, not a "paid" page', /\/api\/stripe\/return\?ref=GLV-\d+&session_id=\{CHECKOUT_SESSION_ID\}$/.test(s.success || ''), s.success);

    /* Coming back while not yet paid settles nothing */
    payOut = 'unpaid';
    const r1 = await call('/api/stripe/return?ref=' + c.body.reference + '&session_id=' + sid);
    check('coming back unpaid → "processing", not paid', r1.status === 303 && /payment=processing/.test(r1.headers.location || ''), r1.headers.location);
    /* Stripe says paid, but for less */
    payOut = 'paid'; amountSkew = 100;
    const r2 = await call('/api/stripe/return?ref=' + c.body.reference + '&session_id=' + sid);
    check('paid for less than we asked → not settled', /payment=processing/.test(r2.headers.location || ''), r2.headers.location);
    amountSkew = 0;
    /* Someone else's session id on this reference */
    const d = await order('EUR', 'DE', 'de@example.com');
    const r3 = await call('/api/stripe/return?ref=' + c.body.reference + '&session_id=' + d.body.stripe.sessionId);
    check('another order\'s session does not settle this one', !/paid=/.test(r3.headers.location || ''), r3.headers.location);
    /* The real return */
    const r4 = await call('/api/stripe/return?ref=' + c.body.reference + '&session_id=' + sid);
    check('paid in full → dashboard says paid', /\/dashboard\?paid=GLV-/.test(r4.headers.location || ''), r4.headers.location);

    /* Webhook: bad signature, then the real one arriving after the return */
    const bad1 = await call('/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 't=1,v1=00' } });
    check('an unsigned webhook is refused', bad1.status === 400);
    const w = await hook({ type: 'checkout.session.completed', data: { object: Object.assign({}, s, { payment_status: 'paid' }) } });
    check('the signed webhook is accepted', w.status === 200);

    /* The ledger: one payment, not two */
    const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
    const cookie = String((login.headers['set-cookie'] || [])[0] || '').split(';')[0];
    const one = await call('/api/staff/order/' + c.body.reference, { headers: { Cookie: cookie } });
    const pays = ((one.body && (one.body.payments || (one.body.order && one.body.order.payments))) || []).filter(p => p.kind === 'payment' || !p.kind);
    check('the order is paid', (one.body.order || one.body).status === 'paid', (one.body.order || one.body).status);
    check('return + webhook recorded ONE payment, by Stripe', pays.length === 1 && /stripe/i.test(pays[0].note || pays[0].method + pays[0].byStaff || ''), JSON.stringify(pays).slice(0, 200));

    /* Patch 197: the universities arrive the moment the payment is confirmed. */
    {
      const em = 'shortlist-' + Date.now() + '@example.com';
      const su = await call('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Ada Obi', email: em,
        password: 'a-long-password-1', phone: '+234 803 555 0101', terms: true }) });
      const ck = String((su.headers['set-cookie'] || [])[0] || '').split(';')[0];
      const pr = await call('/api/profile', { method: 'PUT', headers: { Cookie: ck }, body: JSON.stringify({ profile: {
        fullName: 'Ada Obi', g_level: "Master's", g_field: 'Computer Science', g_country: 'Germany',
        d_course: 'B.Tech Computer Science', d_cgpa: '8.2', d_max: '10', d_pass: '5' } }) });
      const before = await call('/api/state', { headers: { Cookie: ck } });
      const n0 = ((before.body && before.body.shortlist) || []).length;
      const o = await call('/api/orders', { method: 'POST', headers: { Cookie: ck, 'cf-ipcountry': 'NG' },
        body: JSON.stringify({ packageId: 'pkg-three-public', acceptedTerms: true, currency: 'USD', sourcePage: '/' }) });
      const mid = await call('/api/state', { headers: { Cookie: ck } });
      const n1 = ((mid.body && mid.body.shortlist) || []).length;
      const sid2 = o.body.stripe && o.body.stripe.sessionId;
      const back = await call('/api/stripe/return?ref=' + o.body.reference + '&session_id=' + sid2, { headers: { Cookie: ck } });
      const after = await call('/api/state', { headers: { Cookie: ck } });
      const n2 = ((after.body && after.body.shortlist) || []).length;
      check('signed-in student with a profile, via Stripe', su.status === 200 && pr.status === 200 && !!sid2,
        su.status + '/' + pr.status + ' ' + JSON.stringify(o.body).slice(0, 120));
      check('nothing is handed over while the payment is only started', n1 === n0, n0 + ' → ' + n1);
      check('the universities are on the shortlist the moment Stripe confirms', /paid=/.test(back.headers.location || '') && n2 > n1,
        n1 + ' → ' + n2 + ' ' + back.headers.location);
    }

    /* An expired session marks a waiting order failed */
    /* (d's session really was paid on the stand-in, so the return settled d —
       right: Stripe's word decides, whatever the address said.) */
    const f = await order('GBP', 'GB', 'gb@example.com');
    const e = await hook({ type: 'checkout.session.expired', data: { object: { id: f.body.stripe.sessionId, payment_status: 'unpaid' } } });
    const two = await call('/api/staff/order/' + f.body.reference, { headers: { Cookie: cookie } });
    const three = await call('/api/staff/order/' + d.body.reference, { headers: { Cookie: cookie } });
    const e2 = await hook({ type: 'checkout.session.expired', data: { object: { id: d.body.stripe.sessionId, payment_status: 'unpaid' } } });
    const four = await call('/api/staff/order/' + d.body.reference, { headers: { Cookie: cookie } });
    check('an expired event never un-pays a paid order', e2.status === 200 && (three.body.order || three.body).status === 'paid' && (four.body.order || four.body).status === 'paid');
    check('an expired session → that order failed', e.status === 200 && (two.body.order || two.body).status === 'failed', (two.body.order || two.body).status);
    /* Cancel goes back where they were */
    const cx = await call('/api/stripe/return?ref=GLV-1&cancel=1&back=%2Fservices');
    check('cancel → back to the page they came from', cx.status === 303 && /^\/services\?payment=cancelled/.test(cx.headers.location || ''), cx.headers.location);
    const cy = await call('/api/stripe/return?ref=GLV-1&cancel=1&back=%2F%2Fevil.example');
    check('and never to another site', /^\/\?payment=cancelled/.test(cy.headers.location || ''), cy.headers.location);
  } catch (err) {
    bad.push('crashed: ' + err.message);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
    rzp.close(); st.close();
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
