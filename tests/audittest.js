/**
 * The go-live website audit (3 Nov 2026): what a visitor or a student saw
 * that was wrong, each fixed and each held here.
 *
 *   - /study-in-germany/ and /blog/ answered 404; a trailing slash 301s now.
 *   - The social tags named www.glovels.com while the canonical named
 *     glovels.com; the six legacy blog posts had no og:image; the home page
 *     had no og:title. Every public <head> agrees with GLOVELS_URL now.
 *   - /services (a sign-in screen) was in the sitemap and open in robots.txt.
 *   - The checkout's subject box read "Any subject" and then refused with
 *     "Choose a subject." — the placeholder says what is wanted.
 *   - The finder's compare bar sat under the phone's quick-actions bar, so
 *     "Compare side by side" could not be pressed on a phone.
 *   - The receipt email named ₹9,999 to a buyer whose card was charged £81.
 *   - The profile's boxes had no <label for>, so a screen reader read "edit
 *     text" for "Mobile number".
 *   - The success stories carried "engineerig", "Sustainabiliy" and a
 *     "Programme to be confirmed" note (held in storytest.js).
 *
 * Needs a server started with GLOVELS_URL=https://glovels.com and
 * ALLOW_INDEXING=true (the seotest.js shape), on BASE.
 */
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8099';
const SITE = 'https://glovels.com';
let bad = 0, n = 0;
const check = (name, ok, note) => { n++; console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || note == null ? '' : ' — ' + note)); if (!ok) bad++; };
const get = async (p, opts) => {
  const r = await fetch(BASE + p, Object.assign({ redirect: 'manual' }, opts || {}));
  return { status: r.status, location: r.headers.get('location') || '', text: await r.text() };
};
const metas = html => {
  const head = html.slice(0, html.indexOf('</head>'));
  const m = {};
  head.replace(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g, (x, k, v) => { m[k] = v; });
  const c = /<link rel="canonical" href="([^"]+)"/.exec(head);
  m.canonical = c ? c[1] : '';
  return m;
};

(async () => {
  /* 1. Trailing slashes. */
  for (const [from, to] of [['/study-in-germany/', '/study-in-germany'], ['/blog/', '/blog'], ['/post/german-universities-lower-cgpa/', '/post/german-universities-lower-cgpa'], ['/find-university/?country=DE', '/find-university?country=DE']]) {
    const r = await get(from);
    check(from + ' 301s to ' + to, r.status === 301 && r.location === to, r.status + ' ' + r.location);
  }
  check('/.well-known/ paths are left alone', (await get('/.well-known/')).status !== 301);
  check('the root is left alone', (await get('/')).status === 200);

  /* 2. Social tags agree with the canonical. */
  for (const p of ['/', '/about-us', '/visa-processing', '/post/german-universities-lower-cgpa', '/study-in-germany', '/glossary']) {
    const r = await get(p); const m = metas(r.text);
    const want = SITE + (p === '/' ? '/' : p);
    check(p + ' canonical is ' + want, m.canonical === want, m.canonical);
    check(p + ' og:url matches it', m['og:url'] === want, m['og:url']);
    check(p + ' has an og:image on this origin', /^https:\/\/glovels\.com\/.+\.(png|jpg|jpeg|webp)$/i.test(m['og:image'] || ''), m['og:image']);
    check(p + ' has og:title and og:description', !!(m['og:title'] && m['og:description']), JSON.stringify([m['og:title'], m['og:description']]));
    check(p + ' names no www.glovels.com in its head', !/www\.glovels\.com/.test(r.text.slice(0, r.text.indexOf('</head>'))));
    check(p + ' asks for the large card', m['twitter:card'] === 'summary_large_image', m['twitter:card']);
  }

  /* 2b. A list of six countries is not "seven countries". */
  const de = (await get('/language-german')).text;
  check('the German page counts its six countries as six', /Luxembourg and Belgium — six countries/.test(de) && !/seven countries/.test(de));

  /* 3. The student's Services screen is not offered for indexing. */
  const sm = (await get('/sitemap.xml')).text;
  check('the sitemap does not list /services', !/<loc>[^<]*\/services<\/loc>/.test(sm));
  check('robots.txt keeps crawlers out of /services', /Disallow: \/services/.test((await get('/robots.txt')).text));
  check('but /services still answers (a sign-in for a visitor)', (await get('/services')).status === 200);

  /* 4. The receipt names the amount the buyer saw. */
  const EMAILS = require(path.join(__dirname, '..', 'server', 'emails.js'));
  const abroad = EMAILS.orderReceipt({ name: 'Siobhán', email: 'a@b.edu', reference: 'GLV-1', packageName: 'Roadmap', grossPaise: 999900, publicUnis: 5, siteUrl: SITE, hasAccount: true, exportSale: true, local: { currency: 'GBP', units: 81 } });
  check('a £81 order is receipted as £81, with the rupee price beside it', /Amount\s+£81 \(₹9,999\)/.test(abroad.text) && /£81 \(₹9,999\) — export of services, no GST/.test(abroad.html), abroad.text.split('\n').find(l => /^Amount/.test(l)));
  const home = EMAILS.orderReceipt({ name: 'Ravi', email: 'a@b.in', reference: 'GLV-2', packageName: 'Roadmap', grossPaise: 999900, publicUnis: 5, siteUrl: SITE, hasAccount: true });
  check('an Indian order is receipted in rupees alone', /Amount\s+₹9,999 \(including/.test(home.text) && !/\(₹9,999\)/.test(home.text), home.text.split('\n').find(l => /^Amount/.test(l)));
  const eur = EMAILS.orderReceipt({ name: 'Ana', email: 'a@b.de', reference: 'GLV-3', packageName: 'Roadmap', grossPaise: 999900, publicUnis: 5, siteUrl: SITE, hasAccount: true, exportSale: true, vatRate: 19, seller: 'Glovels UG', local: { currency: 'EUR', units: 115 } });
  check('a euro order with VAT leads with the euro figure', /Amount\s+€115 \(₹9,999\) \(including/.test(eur.text), eur.text.split('\n').find(l => /^Amount/.test(l)));
  /* ...and through the real order route, read back from the outbox. */
  const fs = require('fs');
  const dataDir = process.env.DATA_DIR || '';
  const pageHtml = (await get('/')).text;
  const tok = /name="glv-t" content="([^"]+)"/.exec(pageHtml);
  const o = await fetch(BASE + '/api/orders', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (X11; Linux) audit' }, tok ? { 'X-Glv-T': tok[1] } : {}),
    body: JSON.stringify({ packageId: 'pkg-roadmap', name: "Siobhán O'Brien", email: 'audit' + Date.now() + '@students.edu', phone: '+44 7911 123456', currency: 'GBP', residence: 'GB', level: 'master', field: 'Data Science, AI & Machine Learning', accepted: true, terms: true, acceptedTerms: true }) });
  const ob = await o.json().catch(() => ({}));
  check('a GBP order is taken', o.status === 200 && /^GLV-/.test(ob.reference || ''), o.status + ' ' + JSON.stringify(ob).slice(0, 160));
  if (dataDir && o.status === 200) {
    await new Promise(r => setTimeout(r, 800));
    const box = path.join(dataDir, 'outbox');
    const files = fs.existsSync(box) ? fs.readdirSync(box).filter(f => f.includes('@students.edu')).sort() : [];
    const last = files.length ? fs.readFileSync(path.join(box, files[files.length - 1]), 'utf8') : '';
    check('and its receipt in the outbox says £', /Amount\s+=?C2=A3|Amount\s+£/.test(last) || /&pound;|£/.test(last), files.length ? last.split('\n').find(l => /Amount/.test(l)) : 'no mail in ' + box);
  } else {
    console.log('  · outbox not checked (set DATA_DIR to the server\'s data folder)');
  }

  /* 5. The screens. */
  const b = await chromium.launch();
  const errs = [];
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Kolkata' });
  const p = await phone.newPage(); p.on('pageerror', e => errs.push(String(e)));

  /* The compare bar is above the quick-actions bar on a phone. */
  await p.goto(BASE + '/find-university?country=DE&level=master', { waitUntil: 'load' }); await p.waitForTimeout(1000);
  const cmp = await p.$$('.fresults button:has-text("⇄")');
  for (const c of cmp.slice(0, 2)) { await c.scrollIntoViewIfNeeded(); await c.click(); await p.waitForTimeout(250); }
  const bars = await p.evaluate(() => {
    /* offsetParent is null for a fixed element, so a box with a height is the test. */
    const r = s => { const e = document.querySelector(s); const b = e ? e.getBoundingClientRect() : null; return b && b.height > 0 && !e.hidden ? { top: b.top, bottom: b.bottom } : null; };
    return { cmp: r('#fcmp'), mbar: r('.glv-mbar'), vh: innerHeight };
  });
  check('two programmes picked show the compare bar', !!bars.cmp, JSON.stringify(bars));
  check('and it sits above the quick-actions bar, not under it', !!(bars.cmp && bars.mbar && bars.cmp.bottom <= bars.mbar.top + 1), JSON.stringify(bars));
  const go = await p.$('#fcmpGo');
  check('"Compare side by side" can be pressed', !!go && await go.evaluate(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === e || e.contains(hit)); }));

  /* The checkout's subject box. */
  await p.goto(BASE + '/', { waitUntil: 'load' }); await p.waitForTimeout(900);
  await p.evaluate(() => { const s = document.querySelector('[data-show-packages]'); if (s) s.click(); });
  await p.waitForTimeout(300);
  const choose = await p.$('text=Choose Roadmap'); await choose.scrollIntoViewIfNeeded(); await choose.click(); await p.waitForTimeout(900);
  const first = await p.$eval('#rqField option', o => o.textContent.trim()).catch(() => '');
  check('the checkout asks to "Choose subject", not "Any subject"', first === 'Choose subject', first);
  check('the finder above still offers "Any subject"', (await p.$eval('#fField option', o => o.textContent.trim())) === 'Any subject');
  await phone.close();

  /* A name in Bengali, Telugu or Arabic is a name. The screens tested for
     a letter with [A-Za-zÀ-ɏऀ-ॿ] — Latin and Devanagari — while the server
     tests \p{L}; a student from Dhaka or Colombo was told "A name needs at
     least one letter" by the page and never reached the server. */
  const g = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const q = await g.newPage(); q.on('pageerror', e => errs.push(String(e)));
  await q.goto(BASE + '/login?signup=1', { waitUntil: 'load' }); await q.waitForTimeout(900);
  await q.fill('#lName', 'তানভীর আহমেদ'); await q.fill('#lEmail', 'tanvir' + Date.now() + '@example.com.bd');
  await q.fill('#lPhone', '+880 1711 123456'); await q.fill('#lPass', 'Dhaka12345!'); await q.check('#terms');
  const signupReq = q.waitForResponse(r => r.url().includes('/api/auth/signup'), { timeout: 8000 }).catch(() => null);
  await q.click('#submit-btn'); const sr = await signupReq; await q.waitForTimeout(800);
  const nameBad = await q.$eval('#lName', e => e.closest('.field').classList.contains('bad')).catch(() => false);   // gone: it signed up and moved on
  check('a Bengali name passes the sign-up screen', !nameBad && !!sr && sr.status() === 200, nameBad ? 'marked bad' : (sr ? 'status ' + sr.status() : 'no request sent'));
  await g.close();
  const g2 = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const q2 = await g2.newPage(); q2.on('pageerror', e => errs.push(String(e)));
  await q2.goto(BASE + '/refer', { waitUntil: 'load' }); await q2.waitForTimeout(700);
  const referOk = await q2.evaluate(() => { const f = document.getElementById('rfName'); if (!f) return 'no form'; f.value = 'రవి కుమార్'; return 'set'; });
  check('the refer form is there', referOk === 'set', referOk);
  await q2.fill('#rfPhone', '9876543210'); await q2.evaluate(() => { const b = document.querySelector('#rfGo, #rfForm button[type=submit], form button'); if (b) b.click(); });
  await q2.waitForTimeout(500);
  const rfErr = await q2.evaluate(() => (document.getElementById('rfErr') || {}).textContent || '');
  check('a Telugu name passes the refer form', !/needs at least one letter/.test(rfErr), rfErr);
  await g2.close();

  /* The "leave your number" form on a destination with no public list
     (USA, Australia…) wanted "A 10-digit Indian mobile" — a visitor abroad
     could not send it — and a Latin-or-Devanagari name. */
  const g3 = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const q3 = await g3.newPage(); q3.on('pageerror', e => errs.push(String(e)));
  await q3.goto(BASE + '/study-in-usa', { waitUntil: 'load' }); await q3.waitForTimeout(700);
  const nlLabels = await q3.$$eval('#nlForm input:not([type=checkbox]):not(.nl-hp)', els => els.every(e => e.getAttribute('aria-label')));
  check('the no-list form\'s boxes are labelled for a screen reader', nlLabels);
  await q3.fill('#nlName', 'Adaeze Okonkwo'); await q3.fill('#nlPhone', '+1 212 555 0199'); await q3.fill('#nlEmail', 'adaeze' + Date.now() + '@uni.edu.ng'); await q3.check('#nlOk');
  const enq = q3.waitForResponse(r => r.url().includes('/api/enquiries'), { timeout: 8000 }).catch(() => null);
  await q3.click('#nlGo'); const er = await enq; await q3.waitForTimeout(600);
  const nlErr = await q3.evaluate(() => (document.getElementById('nlErr') || {}).textContent || '');
  check('a New York number is sent to a counsellor from /study-in-usa', !!er && er.status() === 200 && !/Indian mobile/.test(nlErr), (er ? 'status ' + er.status() : 'no request') + ' ' + nlErr);
  await g3.close();

  /* Every box on the profile has a label wired to it. */
  const stu = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/login', { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const s = await stu.newPage(); s.on('pageerror', e => errs.push(String(e)));
  await s.goto(BASE + '/profile', { waitUntil: 'load' }); await s.waitForTimeout(1500);
  const lab = await s.evaluate(() => {
    const boxes = [...document.querySelectorAll('#pForm input:not([type=hidden]):not([type=checkbox]):not([type=radio]), #pForm select, #pForm textarea')].filter(i => i.offsetParent !== null);
    const bare = boxes.filter(i => !(i.id && document.querySelector('label[for="' + i.id + '"]')) && !i.closest('label') && !i.getAttribute('aria-label'));
    const ids = {}; document.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
    return { boxes: boxes.length, bare: bare.map(i => i.name || i.id || i.type), dup: Object.keys(ids).filter(k => ids[k] > 1) };
  });
  check('the profile draws boxes', lab.boxes > 3, lab.boxes);
  check('every one has a label wired to it', lab.bare.length === 0, lab.bare.join(','));
  check('and no id is used twice', lab.dup.length === 0, lab.dup.join(','));
  const tap = await s.evaluate(() => { const l = [...document.querySelectorAll('#pForm label[for]')][0]; if (!l) return 'no label'; l.click(); return document.activeElement && document.activeElement.id === l.getAttribute('for') ? 'focused' : 'not ' + (document.activeElement || {}).id; });
  check('a tap on the label focuses its box', tap === 'focused', tap);
  /* "Payment is not connected yet, so orders are recorded but nothing is
     charged" was on the dashboard for everybody, including a student who had
     just paid on Razorpay. It is said only while no gateway is collecting. */
  await s.goto(BASE + '/dashboard', { waitUntil: 'load' }); await s.waitForTimeout(1500);
  const cfg = await (await fetch(BASE + '/api/pay/config')).json();
  const strip = await s.evaluate(() => (document.getElementById('pDemo') || {}).textContent || '');
  check('the dashboard strip says where the data lives', /stored on the/.test(strip) && /Glovels server/.test(strip), strip.slice(0, 120));
  check('and mentions "nothing is charged" only while no gateway collects', /nothing is charged/.test(strip) === !(cfg.enabled || cfg.stripe), strip.slice(0, 200));
  await s.route('**/api/pay/config', async route => { const r = await route.fetch(); const j = await r.json(); j.enabled = true; j.keyId = 'rzp_test_x'; await route.fulfill({ response: r, json: j }); });
  await s.goto(BASE + '/dashboard', { waitUntil: 'load' }); await s.waitForTimeout(1500);
  const live = await s.evaluate(() => (document.getElementById('pDemo') || {}).textContent || '');
  check('with Razorpay collecting, a paying student is not told nothing is charged', !/nothing is charged/.test(live) && /Glovels server/.test(live), live.slice(0, 200));
  await s.unroute('**/api/pay/config');
  /* A long university name in the shortlist pushed a 360px phone sideways. */
  await s.setViewportSize({ width: 360, height: 780 });
  await s.goto(BASE + '/dashboard', { waitUntil: 'load' }); await s.waitForTimeout(1800);
  const wide = await s.evaluate(() => {
    const u = document.querySelector('.sl-tbl .sl-uni'); if (!u) return 'no shortlist row';
    u.textContent = 'Deggendorf Institute of Technology (TH Deggendorf)';
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  check('a long university name on the shortlist does not push the phone sideways', wide === 0, String(wide));
  await stu.close();
  await b.close();

  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
