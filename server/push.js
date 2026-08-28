'use strict';
/**
 * A phone that buzzes when a student writes.
 *
 * The counsellor screen already streams — a message appears without a refresh
 * while the tab is open. On a phone that is the whole problem: the tab is not
 * open. It is a browser somebody closed at six, and a student writing at nine
 * reaches nobody until the morning.
 *
 * Web Push fixes exactly that, and only that. The browser holds a subscription
 * with its own push service (Google's for Chrome, Apple's for Safari); we hand
 * that service an encrypted payload and it wakes the phone whether or not any
 * page of ours is loaded.
 *
 * This is written against the specs rather than a library, because this
 * application has no dependencies and adding one for four hundred lines of
 * well-specified crypto is a poor trade:
 *
 *   RFC 8291  Message Encryption for Web Push — the key derivation below
 *   RFC 8188  aes128gcm content encoding — the body layout
 *   RFC 8292  VAPID — the signed JWT that identifies us to the push service
 *
 * The parts worth knowing if this ever misbehaves:
 *
 *   The VAPID key pair is generated once and kept in the database, not in the
 *   environment. Regenerating it invalidates every subscription silently —
 *   the push service accepts the request and drops it — so it must survive a
 *   redeploy, and a disk that survives a redeploy is where it belongs.
 *
 *   A subscription dies when the person clears site data or the browser rotates
 *   it. The push service says so with 404 or 410, and the only correct response
 *   is to delete it. Anything else accumulates dead endpoints that fail on
 *   every send for ever.
 *
 *   Payloads are capped at 3993 bytes after padding. We send a title, a line of
 *   body and a URL — far under it — but a student's message goes in that body,
 *   so it is truncated rather than trusted.
 */

const crypto = require('crypto');
const https = require('https');

const KEY_ROW = 'pushVapidKeys';
const MAX_PAYLOAD = 3800;          /* comfortably inside the 4096 limit */

/* ------------------------------------------------------------------ base64url */

const b64u = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* ------------------------------------------------------------------- VAPID keys */

/**
 * A P-256 key pair, in the shapes the two consumers want: the browser needs the
 * public key as 65 raw bytes, and our own signing needs a KeyObject.
 */
function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: b64u(publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)),
    privateKey: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
  };
}

function privateKeyObject(b64) {
  return crypto.createPrivateKey({
    key: unb64u(b64), format: 'der', type: 'pkcs8',
  });
}

/**
 * The VAPID JWT.
 *
 * `aud` is the ORIGIN of the push endpoint, not the endpoint — a JWT audienced
 * at the full URL is rejected, and the rejection says nothing useful.
 */
function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }));
  const signature = b64u(crypto.sign('sha256', Buffer.from(header + '.' + body),
    { key: privateKeyObject(keys.privateKey), dsaEncoding: 'ieee-p1363' }));
  return {
    Authorization: 'vapid t=' + header + '.' + body + '.' + signature
      + ', k=' + keys.publicKey,
  };
}

/* -------------------------------------------------------------- the encryption */

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** HKDF, the two-step form RFC 8291 uses. `length` is at most 32 here. */
const hkdf = (salt, ikm, info, length) =>
  hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

/**
 * One message, encrypted for one subscription.
 *
 * Returns the complete aes128gcm body: salt, record size, the ephemeral public
 * key, and the ciphertext. The receiving browser needs nothing else.
 */
function encrypt(subscription, plaintext) {
  const clientPub = unb64u(subscription.keys.p256dh);
  const auth = unb64u(subscription.keys.auth);
  if (clientPub.length !== 65) throw new Error('p256dh is not a 65-byte P-256 point');
  if (auth.length !== 16) throw new Error('auth secret is not 16 bytes');

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPub);

  /* RFC 8291 §3.3. The key_info string binds the derived key to BOTH public
     keys, which is what stops a payload encrypted for one subscription being
     replayed at another. */
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), clientPub, serverPub,
  ]);
  const ikm = hkdf(auth, shared, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  /* The padding delimiter. 0x02 means "last record" — 0x01 would mean another
     record follows, and there never is one. */
  const padded = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);       /* record size */
  header.writeUInt8(65, 20);            /* length of the key that follows */

  return Buffer.concat([header, serverPub, body]);
}

/* ------------------------------------------------------------------- the send */

function send(endpoint, headers, body) {
  return new Promise(resolve => {
    const u = new URL(endpoint);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': body.length,
        TTL: 86400,
        Urgency: 'high',
      }, headers),
      timeout: 15000,
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out.slice(0, 200) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timed out' }); });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.end(body);
  });
}

/* ------------------------------------------------------------------ the module */

function open({ db, siteUrl, log }) {
  const say = log || console;

  /* Generated once, then read. See the note at the top about why this is in the
     database and not in the environment. */
  let keys = null;
  try { keys = db.content(KEY_ROW); } catch (e) { /* first run */ }
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = generateKeys();
    db.setContent(KEY_ROW, keys, 'system');
    db.log('system', 'push keys generated',
      'every device will be asked to allow notifications again');
  }

  const subject = 'mailto:' + (process.env.ADMIN_EMAIL || 'info@glovels.com');

  /* Named, so toStaff can call toPerson without depending on `this` — a
     detached reference would otherwise fail at the one moment it matters. */
  const api = {
    /** What the browser needs before it can subscribe. */
    publicKey: keys.publicKey,

    /**
     * Notify one PERSON on every device they have registered.
     *
     * A person, not a member of staff. Nothing in here was ever staff-specific
     * — the subscription is keyed on an account id and the column is called
     * staff_id only because counsellors got here first. A student waiting on a
     * reply wants the buzz at least as much as the counsellor who sent it, and
     * an app that cannot notify the person who installed it is most of the
     * reason to install one.
     *
     * Never throws: a notification that fails is a notification that did not
     * arrive, and the message it was about is already saved.
     */
    async toPerson(personId, { title, body, url, tag }) {
      const subs = db.pushSubscriptions(personId);
      if (!subs.length) return { sent: 0, gone: 0 };

      const payload = JSON.stringify({
        title: String(title || 'Glovels').slice(0, 120),
        body: String(body || '').slice(0, 400),
        url: url || (siteUrl || '') + '/counsellor',
        /* One tag per student. Five messages from the same person replace each
           other on the lock screen instead of becoming five identical lines. */
        tag: tag || 'glovels',
      }).slice(0, MAX_PAYLOAD);

      let sent = 0, gone = 0;
      for (const sub of subs) {
        try {
          const encrypted = encrypt(sub, payload);
          const res = await send(sub.endpoint,
            vapidHeader(sub.endpoint, keys, subject), encrypted);
          if (res.status >= 200 && res.status < 300) { sent++; continue; }
          /* 404 and 410 are the push service saying this subscription is dead.
             Keeping it means failing on every send from now until somebody
             notices, which nobody does. */
          if (res.status === 404 || res.status === 410) {
            db.deletePushSubscription(sub.endpoint);
            gone++;
            continue;
          }
          say.error && say.error('  push ✗ ' + res.status + ' ' + res.body);
        } catch (e) {
          say.error && say.error('  push ✗ ' + e.message);
        }
      }
      return { sent, gone };
    },

    /* The name the counsellor side has always called it. Kept so that call
       sites and the suite that decrypts what this encrypts do not all have to
       move in the same patch as the behaviour change. */
    toStaff(staffId, opts) { return api.toPerson(staffId, opts); },

    /* Exposed for the tests, which prove the crypto by reversing it. */
    _encrypt: encrypt,
    _vapidHeader: endpoint => vapidHeader(endpoint, keys, subject),
  };
  return api;
}

module.exports = { open, generateKeys, b64u, unb64u };
