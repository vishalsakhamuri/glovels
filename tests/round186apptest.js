/**
 * Patch 186: ready for the apps, and for buyers everywhere.
 *
 *   tests/srv.sh 8186 FX_AUTO=off
 *   BASE=http://localhost:8186 node tests/round186apptest.js
 */
const BASE = process.env.BASE || 'http://localhost:8186';
const FX = require('../server/fx.js');
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null ? ' — ' + note : ''));
const call = async (method, p, body, headers) => {
  const r = await fetch(BASE + p, { method, redirect: 'manual',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; const t = await r.text();
  try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
  return { s: r.status, j, h: r.headers };
};

(async () => {
  /* ------------------------------------------------ currencies, offline */
  const want = ['INR', 'NPR', 'LKR', 'BDT', 'PKR', 'MYR', 'IDR', 'VND', 'AED', 'SAR', 'KWD',
    'NGN', 'KES', 'ZAR', 'EGP', 'BRL', 'CLP', 'COP', 'PEN', 'USD', 'EUR'];
  check('every target region has its own currency', want.every(c => FX.currencies().includes(c)),
    want.filter(c => !FX.currencies().includes(c)).join(','));
  check('Argentina and Venezuela are not offered (Razorpay does not take them)',
    !FX.currencies().includes('ARS') && !FX.currencies().includes('VES'));
  const vnd = FX.convert(4999900, 'VND');
  check('VND has no minor unit', vnd.exponent === 0 && vnd.amountMinor === vnd.units, JSON.stringify(vnd));
  check('and is rounded to a clean figure', vnd.units % 1000 === 0, vnd.units);
  const kwd = FX.convert(4999900, 'KWD');
  check('KWD has three decimals', kwd.exponent === 3 && kwd.amountMinor === kwd.units * 1000, JSON.stringify(kwd));
  const usd = FX.convert(999900, 'USD');
  check('the rupee price is never undercharged', usd.units * usd.rate >= 9999, usd.units + ' × ' + usd.rate);
  check('an unknown currency is charged in rupees', FX.convert(100000, 'ARS').currency === 'INR');
  check('the snapshot rate sits near the market', FX.rate('USD') > 80 && FX.rate('USD') < 110, FX.rate('USD'));

  /* ---------------------------------------------- the same API at /api/v1 */
  const c0 = await call('GET', '/api/pay/config');
  const c1 = await call('GET', '/api/v1/pay/config');
  check('/api/v1/ answers like /api/', c1.s === 200 && JSON.stringify(c0.j) === JSON.stringify(c1.j), c1.s);
  check('the checkout is told the regions and the exponents',
    Array.isArray(c0.j.regions) && c0.j.regions.length >= 5 && c0.j.exponents && c0.j.exponents.VND === 0);
  const app = await call('GET', '/api/v1/app/config');
  check('the app has a config to ask first', app.s === 200 && app.j.api === 1 && app.j.pay
    && Array.isArray(app.j.pay.currencies) && app.j.minVersion, JSON.stringify(app.j).slice(0, 100));

  /* --------------------------------------------------- app sign-in */
  const stamp = Date.now();
  const email = 'app' + stamp + '@example.com';
  const made = await call('POST', '/api/v1/auth/signup', { name: 'Ayesha Khan', email,
    phone: '+92 300 1234567', password: 'a-real-password-186', terms: true },
    { 'X-Glovels-Client': 'app/android/1.0.0' });
  check('a Pakistani mobile can sign up', made.s === 200, JSON.stringify(made.j).slice(0, 120));
  check('and the number is kept as typed, not turned into +91',
    made.j.user && made.j.user.phone === '+923001234567', made.j.user && made.j.user.phone);
  check('and the app is handed its session token', typeof made.j.token === 'string' && made.j.token.length >= 16);
  const web = await call('POST', '/api/auth/login', { email, password: 'a-real-password-186' });
  check('a browser sign-in is NOT handed the token in the body', web.s === 200 && !web.j.token);
  const login = await call('POST', '/api/v1/auth/login', { email, password: 'a-real-password-186' },
    { 'X-Glovels-Client': 'app/ios/1.0.0' });
  const tok = login.j.token;
  check('an app sign-in is', !!tok);
  const st = await call('GET', '/api/v1/state', undefined, { Authorization: 'Bearer ' + tok });
  check('the token signs the app in', st.s === 200 && JSON.stringify(st.j).includes(email), st.s);
  const nope = await call('GET', '/api/v1/state', undefined, { Authorization: 'Bearer not-a-real-token-at-all' });
  check('a made-up token signs nobody in', !JSON.stringify(nope.j).includes(email), nope.s);
  const out = await call('POST', '/api/v1/auth/logout', {}, { Authorization: 'Bearer ' + tok });
  const after = await call('GET', '/api/v1/state', undefined, { Authorization: 'Bearer ' + tok });
  check('signing out ends the token', out.s === 200 && !JSON.stringify(after.j).includes(email), after.s);

  /* --------------------------------------------------- app links */
  const aasa0 = await call('GET', '/.well-known/apple-app-site-association');
  check('Apple is served valid JSON before there is an app',
    aasa0.s === 200 && /json/.test(aasa0.h.get('content-type')) && aasa0.j.applinks
      && aasa0.j.applinks.details.length === 0);
  const adm = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
  const ck = (adm.headers.get('set-cookie') || '').split(';')[0];
  const badIos = await call('PUT', '/api/staff/ios', { teamId: 'short', bundleId: 'com.glovels.app' }, { Cookie: ck });
  check('a wrong Team ID is refused', badIos.s === 422, badIos.s);
  const put = await call('PUT', '/api/staff/ios', { teamId: 'a1b2c3d4e5', bundleId: 'com.glovels.app' }, { Cookie: ck });
  check('the office can enter the iPhone app', put.s === 200 && put.j.live === true, JSON.stringify(put.j));
  const aasa = await call('GET', '/apple-app-site-association');
  check('and Apple is then told about it', JSON.stringify(aasa.j).includes('A1B2C3D4E5.com.glovels.app'));
  check('with the office screens left out',
    JSON.stringify(aasa.j).includes('"/admin*"') && JSON.stringify(aasa.j).includes('"exclude":true'));
  await call('PUT', '/api/staff/ios', { teamId: '', bundleId: '' }, { Cookie: ck });

  /* --------------------------------------------------- the delivery policy */
  const ship = await call('GET', '/shipping');
  check('/shipping points at the delivery policy', ship.s === 301 && /refunds#delivery/.test(ship.h.get('location') || ''));
  const ref = await fetch(BASE + '/refunds').then(r => r.text());
  check('which says nothing is shipped', /id="delivery"/.test(ref) && /nothing is shipped/.test(ref));

  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\nround186apptest: ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
