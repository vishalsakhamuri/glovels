/**
 * Patch 267: the marketing team's tags.
 *
 * Own server (8267) with stand-ins for Meta's Conversions API and IndexNow
 * (plain HTTP on 8268, counted per path). Checks:
 *
 *   nothing is tagged until an ID is typed; an administrator may save, a
 *   counsellor may not, a bad ID is refused by field; every tag lands on a
 *   public page and never on the portal or the office; the token is never
 *   read back; the consent banner shows to a German visitor and not to an
 *   Indian one, Google runs in consent mode until Accept, the pixel and
 *   Clarity are held back and loaded on Accept, the answer is a cookie;
 *   glvTrack fans out — Lead to the pixel (browser) when CAPI is off, Google
 *   Ads conversion with the label, Purchase with eventID purchase-<ref>,
 *   Contact on a WhatsApp click; an enquiry, a sign-up and a paid order
 *   reach the Conversions API from the server with hashed email and phone;
 *   publishing a post pings IndexNow and the key file is served.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = '/home/claude/glovels/build';
const PORT = 8267, STUB = 8268;
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
let ipN = 10;
const ip = () => '203.0.113.' + (ipN++);

const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers, text: out });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {}, text: '' }));
  if (opts && opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const cookieOf = r => String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
const login = async email => cookieOf(await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } }));
const page = (path, headers) => call(path, { headers: Object.assign({ Accept: 'text/html' }, headers || {}) }).then(r => r.text);

(async () => {
  const dir = '/tmp/db-marktags-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });

  /* The stand-ins: everything POSTed is kept. */
  const hits = [];
  const KEY_ID = 'rzp_test_marktags', KEY_SECRET = 'secret-marktags-1';
  const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const stub = http.createServer((req, res) => {
    let t = ''; req.on('data', c => { t += c; });
    req.on('end', () => {
      let j = null; try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
      /* The stand-in Razorpay: an order id for the checkout. */
      if (req.method === 'POST' && req.url === '/v1/orders') {
        const id = 'order_' + crypto.randomBytes(6).toString('hex');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id, amount: j.amount, currency: j.currency || 'INR', receipt: j.receipt, status: 'created' }));
      }
      hits.push({ url: req.url, body: j }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"events_received":1}');
    });
  }).listen(STUB);

  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', UNLOCK_UNPAID: 'on',
      GLOVELS_URL: 'https://www.glovels.test', GEO_TRUST_HEADER: 'cf-ipcountry',
      RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_API_BASE: 'http://localhost:' + STUB,
      META_CAPI_URL: 'http://localhost:' + STUB + '/meta', INDEXNOW_URL: 'http://localhost:' + STUB + '/indexnow' }) });
  let browser = null;
  try {
    for (let i = 0; i < 60; i++) { await wait(400); if ((await call('/api/health')).status === 200) break; }
    await wait(1200);
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');

    /* ------------------------------------------------ nothing until typed */
    let h = await page('/');
    check('no tag on the home page before any ID is typed', !/gtag\/js|fbevents|clarity\.ms|gtm\.js/.test(h) && /window\.__glvTags/.test(h));
    check('a counsellor may not read the tag settings', (await call('/api/staff/analytics', { headers: { Cookie: kavya } })).status === 403);
    check('nor save them', (await call('/api/staff/analytics', { method: 'PUT', headers: { Cookie: kavya }, body: { gaId: 'G-ABCDEF1234' } })).status === 403);
    const badId = await call('/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin }, body: { pixelId: 'not-a-pixel' } });
    check('a bad pixel ID is refused, naming the field', badId.status === 422 && badId.body.fields && badId.body.fields[0].field === 'pixelId', JSON.stringify(badId.body));
    const noAds = await call('/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin }, body: { adsLeadLabel: 'AbCdEfGh' } });
    check('a label without the AW- id is refused', noAds.status === 422 && noAds.body.fields[0].field === 'adsId');

    const TOKEN = 'EAAB' + crypto.randomBytes(40).toString('hex');
    const saved = await call('/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin },
      body: { gaId: 'g-abcdef1234', gtmId: 'GTM-ABC1234', adsId: 'AW-123456789', adsLeadLabel: 'LeadLbl_1', adsPurchaseLabel: 'BuyLbl_2',
        pixelId: '123456789012345', capiToken: TOKEN, clarityId: 'abc123xyz9', consent: 'eu' } });
    check('an administrator saves every tag', saved.status === 200 && saved.body.gaId === 'G-ABCDEF1234' && saved.body.gtmId === 'GTM-ABC1234', JSON.stringify(saved.body));
    check('the token is never read back whole', saved.body.capiTokenSet === true && /^••••/.test(saved.body.capiToken) && !saved.body.capiToken.includes(TOKEN.slice(0, 20)), saved.body.capiToken);
    const again = await call('/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin },
      body: { gaId: 'G-ABCDEF1234', gtmId: 'GTM-ABC1234', adsId: 'AW-123456789', adsLeadLabel: 'LeadLbl_1', adsPurchaseLabel: 'BuyLbl_2', pixelId: '123456789012345', capiToken: '', clarityId: 'abc123xyz9', consent: 'eu' } });
    check('saving with the token box blank keeps the token', again.body.capiTokenSet === true);

    /* --------------------------------------------- on the page, and where */
    h = await page('/', { 'cf-ipcountry': 'IN' });
    check('GA4 + Google Ads via gtag on the home page', /gtag\/js\?id=G-ABCDEF1234/.test(h) && /gtag\("config","AW-123456789"\)/.test(h));
    check('Tag Manager script and noscript frame', /gtm\.js\?id="\+i/.test(h) && /GTM-ABC1234/.test(h) && /ns\.html\?id=GTM-ABC1234/.test(h));
    check('Meta pixel init + PageView', /fbq\("init","123456789012345"\);fbq\("track","PageView"\)/.test(h));
    check('Clarity tag', /clarity\.ms\/tag\/"\+i/.test(h) && /"abc123xyz9"/.test(h));
    check('an Indian visitor: no banner, everything loads at once', !/id="glvConsent"/.test(h) && /\};window\.__glvLoadConsented\(\);<\/script>/.test(h) && !/gtag\("consent","default"/.test(h));
    const de = await page('/', { 'cf-ipcountry': 'DE' });
    check('a German visitor: the banner, Google in consent mode, pixel and Clarity held back',
      /id="glvConsent"/.test(de) && /gtag\("consent","default",\{ad_storage:"denied"/.test(de) && !/\};window\.__glvLoadConsented\(\);<\/script>/.test(de) && /__glvLoadConsented=function/.test(de));
    const deYes = await page('/', { 'cf-ipcountry': 'DE', Cookie: 'glv_consent=all' });
    check('…and after Accept: no banner, everything loads', !/id="glvConsent"/.test(deYes) && /\};window\.__glvLoadConsented\(\);<\/script>/.test(deYes) && !/gtag\("consent","default"/.test(deYes));
    const deNo = await page('/', { 'cf-ipcountry': 'DE', Cookie: 'glv_consent=essential' });
    check('…after Only essential: no banner, no pixel/Clarity load, Google stays denied', !/id="glvConsent"/.test(deNo) && !/\};window\.__glvLoadConsented\(\);<\/script>/.test(deNo) && /gtag\("consent","default"/.test(deNo));
    const dash = await call('/dashboard', { headers: { Accept: 'text/html', Cookie: kavya } });
    const adminPage = await call('/admin', { headers: { Accept: 'text/html', Cookie: admin } });
    check('the office screen is never tagged', !/gtag\/js|fbevents|clarity\.ms\/tag/.test(adminPage.text));
    check('nor the portal', !/gtag\/js|fbevents|clarity\.ms\/tag/.test(dash.text), String(dash.status));
    const csp = (await call('/', { headers: { Accept: 'text/html' } })).headers['content-security-policy'] || '';
    check('the CSP lets the tag hosts in', /connect\.facebook\.net/.test(csp) && /clarity\.ms/.test(csp) && /googleadservices/.test(csp));

    /* ------------------------------------------- the browser fans out */
    browser = await chromium.launch();
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'cf-ipcountry': 'DE', 'X-Forwarded-For': ip() } });
    /* The outside tags are not reachable here: stub them so the fan-out is observable. */
    await ctx.route(/googletagmanager|connect\.facebook\.net|clarity\.ms|googleadservices|doubleclick/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const pg = await ctx.newPage();
    const errs = []; pg.on('pageerror', e => errs.push(String(e)));
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(600);
    check('the banner is on the screen for a German visitor', await pg.isVisible('#glvConsent'));
    check('Google was told consent is denied before anything else', await pg.evaluate(() => Array.isArray(window.dataLayer) && window.dataLayer.some(a => a[0] === 'consent' && a[1] === 'default' && a[2].ad_storage === 'denied')));
    check('the pixel is not loaded yet', await pg.evaluate(() => !window.fbq && !window.__glvLoaded));
    await pg.click('#glvConsent button:last-child');
    await pg.waitForTimeout(300);
    check('Accept: banner gone, cookie set, consent updated, pixel + Clarity loaded', await pg.evaluate(() => !document.getElementById('glvConsent') && /glv_consent=all/.test(document.cookie)
      && window.dataLayer.some(a => a[0] === 'consent' && a[1] === 'update' && a[2].ad_storage === 'granted') && !!window.fbq && !!window.clarity && window.__glvLoaded === 1));
    /* Capture what the pixel and gtag are asked to do. */
    await pg.evaluate(() => {
      window.__fb = []; window.fbq = function () { window.__fb.push(Array.from(arguments)); };
      window.__gt = []; window.gtag = function () { window.__gt.push(Array.from(arguments)); };
    });
    await pg.evaluate(() => { glvTrack('generate_lead', { form: 'contact' }); glvTrack('purchase', { transaction_id: 'GLV-TEST-1', currency: 'INR', value: 999, package: 'Starter' }); glvTrack('begin_checkout', { transaction_id: 'GLV-TEST-1', value: 999 }); });
    const fb = await pg.evaluate(() => window.__fb), gt = await pg.evaluate(() => window.__gt);
    check('Lead is NOT sent from the browser while the Conversions API is on (the server sends it)', !fb.some(a => a[1] === 'Lead'), JSON.stringify(fb));
    check('Purchase goes to the pixel with eventID purchase-<reference> and the amount', fb.some(a => a[1] === 'Purchase' && a[2].value === 999 && a[2].currency === 'INR' && a[3] && a[3].eventID === 'purchase-GLV-TEST-1'), JSON.stringify(fb));
    check('InitiateCheckout too', fb.some(a => a[1] === 'InitiateCheckout'));
    check('Google Ads: the Lead conversion with its label', gt.some(a => a[0] === 'event' && a[1] === 'conversion' && a[2].send_to === 'AW-123456789/LeadLbl_1'), JSON.stringify(gt));
    check('and the Purchase conversion with amount and transaction id', gt.some(a => a[1] === 'conversion' && a[2].send_to === 'AW-123456789/BuyLbl_2' && a[2].value === 999 && a[2].transaction_id === 'GLV-TEST-1'));
    check('GA4 still gets the plain events', gt.some(a => a[1] === 'generate_lead') && gt.some(a => a[1] === 'purchase'));
    /* A WhatsApp click is a Contact. */
    await pg.evaluate(() => { const a = document.createElement('a'); a.href = 'https://wa.me/919000000000'; a.textContent = 'WhatsApp us'; a.id = 'waTest'; a.addEventListener('click', e => e.preventDefault()); document.body.appendChild(a); });
    await pg.click('#waTest');
    await pg.waitForTimeout(200);
    const fb2 = await pg.evaluate(() => window.__fb), gt2 = await pg.evaluate(() => window.__gt);
    check('a WhatsApp click: Contact to the pixel, contact{method:whatsapp} to Google', fb2.some(a => a[1] === 'Contact' && a[2].content_name === 'whatsapp') && gt2.some(a => a[1] === 'contact' && a[2].method === 'whatsapp'), JSON.stringify(fb2.slice(-1)) + JSON.stringify(gt2.slice(-1)));
    check('no script errors', errs.length === 0, errs.join(' | '));

    /* Pixel off, CAPI off → Lead from the browser. */
    await call('/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin }, body: { gaId: 'G-ABCDEF1234', adsId: 'AW-123456789', adsLeadLabel: 'LeadLbl_1', pixelId: '123456789012345', capiToken: 'remove', consent: 'off' } });
    const ctx2 = await browser.newContext({ extraHTTPHeaders: { 'cf-ipcountry': 'DE', 'X-Forwarded-For': ip() } });
    await ctx2.route(/googletagmanager|connect\.facebook\.net|clarity\.ms|googleadservices|doubleclick/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const pg2 = await ctx2.newPage();
    await pg2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg2.waitForTimeout(400);
    check('consent "off": no banner even for a German visitor', !(await pg2.$('#glvConsent')));
    await pg2.evaluate(() => { window.__fb = []; window.fbq = function () { window.__fb.push(Array.from(arguments)); }; glvTrack('generate_lead', { form: 'contact' }); });
    check('with the Conversions API off, Lead goes from the browser', await pg2.evaluate(() => window.__fb.some(a => a[1] === 'Lead')));

    /* --------------------------------------------- the server's own events */
    await call('/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin }, body: { gaId: 'G-ABCDEF1234', adsId: 'AW-123456789', adsLeadLabel: 'LeadLbl_1', pixelId: '123456789012345', capiToken: TOKEN, consent: 'eu' } });
    hits.length = 0;
    const enq = await call('/api/enquiries', { method: 'POST', headers: { 'X-Forwarded-For': ip(), Cookie: '_fbp=fb.1.1700000000000.123456789', Referer: BASE + '/study-in-germany' },
      body: { name: 'Lead Person', phone: '9811100077', email: 'Lead.Person@mail.test', destination: 'Germany', consent: 'yes', message: 'MS in Germany?' } });
    check('an enquiry is accepted', enq.status === 200);
    await wait(700);
    const lead = hits.find(x => /^\/meta\/123456789012345\/events\?access_token=/.test(x.url) && x.body.data && x.body.data[0].event_name === 'Lead');
    check('…and reaches the Conversions API as a Lead', !!lead, JSON.stringify(hits.map(x => x.url)));
    const sha = v => crypto.createHash('sha256').update(v).digest('hex');
    check('with the email and phone hashed, the _fbp cookie, the IP and the page', lead && lead.body.data[0].user_data.em[0] === sha('lead.person@mail.test') && lead.body.data[0].user_data.ph[0] === sha('919811100077')
      && lead.body.data[0].user_data.fbp === 'fb.1.1700000000000.123456789' && lead.body.data[0].user_data.client_ip_address && /study-in-germany/.test(lead.body.data[0].event_source_url), lead && JSON.stringify(lead.body.data[0]));
    check('with the token in the address and event_id lead-<id>', lead && decodeURIComponent(lead.url.split('access_token=')[1]) === TOKEN && /^lead-\d+$/.test(lead.body.data[0].event_id));
    const su = await call('/api/auth/signup', { method: 'POST', headers: { 'X-Forwarded-For': ip() }, body: { name: 'Sign Up', email: 'sign.up@mail.test', phone: '+919811100078', password: 'glovels123', terms: true } });
    await wait(600);
    check('a sign-up reaches it as a Lead too', su.status === 200 && hits.some(x => x.body.data && x.body.data[0].event_name === 'Lead' && /^signup-\d+$/.test(x.body.data[0].event_id)));
    /* A paid order: the office marks a bank transfer paid — the same recordPayment path as the gateways. */
    const suCookie = cookieOf(su);
    const order = await call('/api/orders', { method: 'POST', headers: { Cookie: suCookie, 'X-Forwarded-For': ip() }, body: { packageId: 'pkg-roadmap', name: 'Sign Up', email: 'sign.up@mail.test', phone: '+919811100078', terms: true, acceptedTerms: true } });
    const ref = order.body && order.body.reference;
    check('an order is placed with the gateway', !!ref && order.body.razorpay && order.body.razorpay.orderId, JSON.stringify(order.body).slice(0, 200));
    hits.length = 0;
    const payId = 'pay_' + crypto.randomBytes(5).toString('hex');
    const paid = await call('/api/orders/' + ref + '/paid', { method: 'POST', headers: { Cookie: suCookie, 'X-Forwarded-For': ip(), Cookie: suCookie + '; _fbp=fb.1.1700000000000.555' },
      body: { razorpay_order_id: order.body.razorpay.orderId, razorpay_payment_id: payId, razorpay_signature: sign(KEY_SECRET, order.body.razorpay.orderId + '|' + payId) } });
    check('the payment is confirmed', paid.status === 200 && paid.body.status === 'paid', paid.status + ' ' + JSON.stringify(paid.body).slice(0, 100));
    await wait(700);
    const pur = hits.find(x => x.body.data && x.body.data[0].event_name === 'Purchase');
    check('…and the Purchase reaches the Conversions API with event_id purchase-<reference>, the amount and the hashed buyer',
      pur && pur.body.data[0].event_id === 'purchase-' + ref && pur.body.data[0].custom_data.value === Math.round(order.body.grossPaise / 100) && pur.body.data[0].custom_data.currency === 'INR'
      && pur.body.data[0].user_data.em[0] === sha('sign.up@mail.test') && pur.body.data[0].user_data.fbp === 'fb.1.1700000000000.555', pur && JSON.stringify(pur.body.data[0]));
    const sentLog = (await call('/api/staff/analytics', { headers: { Cookie: admin } })).body.sent || [];
    check('the office screen lists what was sent', sentLog.some(x => x.kind === 'meta' && /^Lead/.test(x.what) && x.ok), JSON.stringify(sentLog.slice(0, 3)));

    /* --------------------------------------------------------- IndexNow */
    hits.length = 0;
    const post = await call('/api/staff/posts', { method: 'POST', headers: { Cookie: admin }, body: { title: 'IndexNow test post', body: 'A post with enough words to be a post. '.repeat(20), status: 'published', tag: 'Guides' } });
    check('a post is published', post.status === 200, JSON.stringify(post.body).slice(0, 160));
    await wait(700);
    const inow = hits.find(x => x.url === '/indexnow');
    check('…and IndexNow is pinged with the post, the blog and the sitemap', inow && inow.body.host === 'www.glovels.test' && /^[a-f0-9]{32}$/.test(inow.body.key)
      && inow.body.urlList.some(u => /\/post\/indexnow-test-post$/.test(u)) && inow.body.urlList.includes('https://www.glovels.test/blog') && inow.body.urlList.includes('https://www.glovels.test/sitemap.xml'), inow && JSON.stringify(inow.body));
    const keyFile = inow && await call('/' + inow.body.key + '.txt');
    check('the key file is served at /<key>.txt', keyFile && keyFile.status === 200 && keyFile.text.trim() === inow.body.key);
    check('a wrong key is not', (await call('/' + 'f'.repeat(32) + '.txt')).status === 404);
    const draft = await call('/api/staff/posts', { method: 'POST', headers: { Cookie: admin }, body: { title: 'Draft only', body: 'Not live. '.repeat(30), status: 'draft', tag: 'Guides' } });
    await wait(400);
    check('a draft does not ping', draft.status === 200 && hits.filter(x => x.url === '/indexnow').length === 1);

    /* ------------------------------------------------ the admin screen */
    const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await actx.addCookies([{ name: admin.split('=')[0], value: admin.split('=')[1], domain: 'localhost', path: '/' }]);
    const ap = await actx.newPage();
    const aerrs = []; ap.on('pageerror', e => aerrs.push(String(e)));
    await ap.goto(BASE + '/admin#o-traffic', { waitUntil: 'networkidle' });
    await ap.evaluate(() => { const b = document.querySelector('[data-opane="o-traffic"],[data-tab="o-traffic"],a[href="#o-traffic"]'); if (b) b.click(); });
    await ap.waitForTimeout(1200);
    const vals = await ap.evaluate(() => ({ ga: document.querySelector('#gaId') && document.querySelector('#gaId').value, px: document.querySelector('#pixelId') && document.querySelector('#pixelId').value,
      tok: document.querySelector('#capiToken') && document.querySelector('#capiToken').value, mode: document.querySelector('#gaMode') && document.querySelector('#gaMode').textContent, key: document.querySelector('#inKey') && document.querySelector('#inKey').textContent }));
    check('Organisation → Traffic shows the saved IDs, the masked token and the key file', vals.ga === 'G-ABCDEF1234' && vals.px === '123456789012345' && /^••••/.test(vals.tok || '') && /GA4/.test(vals.mode || '') && /\.txt$/.test(vals.key || ''), JSON.stringify(vals));
    check('no script errors on the admin screen', aerrs.length === 0, aerrs.join(' | '));
  } catch (e) {
    bad.push('crashed: ' + (e.stack || e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* gone */ } }
    try { stub.close(); } catch (e) { /* gone */ }
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ok   ' + x));
  bad.forEach(x => console.log('  FAIL ' + x));
  console.log('\nmarktagstest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
