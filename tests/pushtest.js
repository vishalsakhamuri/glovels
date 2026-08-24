/**
 * The Web Push crypto, proved by reversing it.
 *
 * There is no way to check this against a real push service from a test — the
 * only honest answers come from Google's or Apple's servers, and a wrong
 * derivation gets accepted with a 201 and silently dropped. So this test plays
 * the browser: it generates a subscription the way a browser does, hands it to
 * the server code, and then decrypts what comes back using the client private
 * key. If the plaintext comes out, every step of RFC 8291 was right.
 *
 * That is worth more than it sounds. Every one of these mistakes produces a
 * body that looks perfectly well-formed and cannot be delivered:
 *
 *   the key_info string missing its trailing NUL
 *   the two public keys concatenated in the wrong order
 *   the padding delimiter written as 0x01 instead of 0x02
 *   the record size or the key length written in the wrong endianness
 *   the VAPID `aud` set to the endpoint rather than its origin
 */
const crypto = require('crypto');
const push = require('/home/claude/glovels/build/server/push.js');

const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const b64u = push.b64u;
const unb64u = push.unb64u;
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const hkdf = (salt, ikm, info, len) =>
  hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

/** A browser subscribing: its own P-256 key pair and a 16-byte auth secret. */
function fakeBrowser() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/' + b64u(crypto.randomBytes(16)),
      keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) },
    },
  };
}

/** What a browser does with the body we send it, in reverse. */
function decrypt(browser, body) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body.readUInt8(20);
  const serverPub = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const shared = browser.ecdh.computeSecret(serverPub);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), browser.ecdh.getPublicKey(), serverPub,
  ]);
  const ikm = hkdf(browser.auth, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(tag);
  const out = Buffer.concat([
    d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final(),
  ]);
  return { rs, idlen, delimiter: out[out.length - 1], text: out.subarray(0, -1).toString('utf8') };
}

/* A database just real enough to hold the keys and the subscriptions. */
function fakeDb() {
  const content = {}, subs = new Map();
  return {
    content: k => content[k],
    setContent: (k, v) => { content[k] = v; },
    log: () => {},
    savePushSubscription(id, s) { subs.set(s.endpoint, { id, s }); },
    pushSubscriptions: id => [...subs.values()].filter(x => x.id === id).map(x => x.s),
    deletePushSubscription(e) { subs.delete(e); },
  };
}

(async () => {
  const db = fakeDb();
  const p = push.open({ db, siteUrl: 'https://glovels.onrender.com', log: console });

  /* ------------------------------------------------------------- the keys */
  check('a VAPID key pair is generated on first run', !!p.publicKey && p.publicKey.length > 80,
    (p.publicKey || '').slice(0, 20) + '…');
  check('the public key is the 65 raw bytes a browser expects',
    unb64u(p.publicKey).length === 65, unb64u(p.publicKey).length + ' bytes');
  check('and it is an uncompressed point', unb64u(p.publicKey)[0] === 0x04);

  /* Kept, not regenerated — a new pair silently kills every subscription. */
  const again = push.open({ db, siteUrl: 'https://glovels.onrender.com', log: console });
  check('a restart keeps the same keys rather than orphaning every device',
    again.publicKey === p.publicKey);

  /* --------------------------------------------------------- the encryption */
  const browser = fakeBrowser();
  const message = 'New message from Vishal Sakhamuri: "Any update on my APS certificate?"';
  const body = p._encrypt(browser.subscription, message);

  check('the body carries a 16-byte salt and a 65-byte key', body.length > 100,
    body.length + ' bytes');
  const round = decrypt(browser, body);
  check('the record size is 4096, big-endian', round.rs === 4096, round.rs);
  check('the key length byte says 65', round.idlen === 65, round.idlen);
  check('the padding delimiter marks the last record', round.delimiter === 2, round.delimiter);

  /* THE check. */
  check('a browser can decrypt what the server encrypted', round.text === message,
    round.text.slice(0, 50));

  /* Encrypting the same message twice must not produce the same bytes — the
     salt and the ephemeral key are per-message, and a fixed one would leak. */
  const second = p._encrypt(browser.subscription, message);
  check('every message gets its own salt and ephemeral key',
    !body.equals(second));

  /* A payload for one subscription must not decrypt under another. */
  const other = fakeBrowser();
  let refused = false;
  try { decrypt(other, body); } catch (e) { refused = true; }
  check('and a payload for one device cannot be read by another', refused);

  /* ------------------------------------------------------------- the VAPID */
  const h = p._vapidHeader('https://fcm.googleapis.com/fcm/send/abc123');
  check('the request carries a VAPID header', /^vapid t=.+, k=.+$/.test(h.Authorization),
    (h.Authorization || '').slice(0, 30) + '…');
  const jwt = h.Authorization.split('t=')[1].split(',')[0];
  const [hdr, pay, sig] = jwt.split('.');
  const claims = JSON.parse(unb64u(pay).toString('utf8'));
  check('the JWT is ES256', JSON.parse(unb64u(hdr).toString('utf8')).alg === 'ES256');
  /* The one that is easy to get wrong and impossible to diagnose: `aud` is the
     ORIGIN, not the endpoint. A full URL is rejected with no useful message. */
  check('audienced at the push service’s origin, not the endpoint',
    claims.aud === 'https://fcm.googleapis.com', claims.aud);
  check('it expires, and within a day',
    claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);
  check('it says who to complain to', /^mailto:/.test(claims.sub || ''), claims.sub);
  check('the signature is raw r||s, not DER', unb64u(sig).length === 64,
    unb64u(sig).length + ' bytes');

  /* And it verifies against the public key the browser was given. */
  const spki = Buffer.concat([
    Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
    unb64u(p.publicKey),
  ]);
  const verified = crypto.verify('sha256', Buffer.from(hdr + '.' + pay),
    { key: crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }),
      dsaEncoding: 'ieee-p1363' }, unb64u(sig));
  check('and verifies against the key we hand out', verified);

  /* ------------------------------------------------- a subscription that died */
  db.savePushSubscription(7, browser.subscription);
  check('a subscription is stored against the person', db.pushSubscriptions(7).length === 1);
  db.deletePushSubscription(browser.subscription.endpoint);
  check('and can be removed when the push service says it is gone',
    db.pushSubscriptions(7).length === 0);

  /* Nobody subscribed is not an error. */
  const none = await p.toStaff(99, { title: 'x', body: 'y' });
  check('notifying somebody with no devices does nothing quietly',
    none.sent === 0 && none.gone === 0, JSON.stringify(none));

  /* ------------------------------------------- and the same thing over HTTP */
  const { chromium } = require('playwright');
  const BASE = process.env.BASE || 'http://localhost:8099';
  const real = await chromium.launch();

  const staff = await real.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'kavya@glovels.com', password: 'glovels123' } });

  const served = await (await staff.request.get(BASE + '/api/push/key')).json();
  check('the browser can fetch the key it needs to subscribe',
    !!served.key && unb64u(served.key).length === 65);

  const shaped = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/' + b64u(crypto.randomBytes(12)),
    keys: { p256dh: b64u(fakeBrowser().ecdh.getPublicKey()), auth: b64u(crypto.randomBytes(16)) },
  };
  const saved = await staff.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: shaped } });
  check('a device registers', saved.status() === 200, saved.status());
  check('and is counted', (await saved.json()).devices >= 1);

  const junk = await staff.request.post(BASE + '/api/push/subscribe',
    { data: { subscription: { endpoint: 'not-a-subscription' } } });
  check('something that is not a subscription is refused', junk.status() === 400,
    junk.status());

  /* A notification carries a student's words. One account must not be able to
     arrange for those to be sent to another. */
  const student = await real.newContext();
  await student.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  check('a student cannot register for staff notifications',
    (await student.request.post(BASE + '/api/push/subscribe',
      { data: { subscription: shaped } })).status() === 403);
  check('nor read the key', (await student.request.get(BASE + '/api/push/key')).status() === 403);

  const gone = await staff.request.post(BASE + '/api/push/unsubscribe',
    { data: { endpoint: shaped.endpoint } });
  check('and a device can be taken off again', gone.status() === 200, gone.status());
  check('leaving none behind', (await gone.json()).devices === 0);

  /* The three files a home-screen install needs, with the types that make it
     an install rather than a bookmark. */
  for (const [url, type] of [
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/sw.js', 'text/javascript'],
    ['/icon-192.png', 'image/png'],
  ]) {
    const r = await staff.request.get(BASE + url);
    check('the phone can fetch ' + url, r.status() === 200, r.status());
    check('  served as ' + type, (r.headers()['content-type'] || '').startsWith(type),
      r.headers()['content-type']);
  }

  const page = await staff.newPage();
  const perr = [];
  page.on('pageerror', e => perr.push(String(e)));
  await page.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  check('the operations screen offers to turn notifications on',
    (await page.$$('#pushBar')).length === 1);
  check('and the page still runs', perr.length === 0, perr.slice(0, 2).join(' | '));

  await real.close();

  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
