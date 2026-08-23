/**
 * Razorpay, with the money decided here and not in the browser.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE. A browser may say "the payment
 * succeeded". It may say so because it did, or because somebody typed it into a
 * console. The only thing that distinguishes the two is a signature computed
 * with a secret the browser has never seen — so nothing is marked paid until
 * that signature verifies here, and the amount is always the one this server
 * computed, never one that arrived in a request.
 *
 * THREE WAYS AN ORDER BECOMES PAID, in decreasing order of how much we trust
 * them:
 *
 *   1. The webhook. Razorpay signs the raw body with the webhook secret and
 *      posts it to us. This is the authority: it arrives whether or not the
 *      student's browser survived the redirect, whether or not their train went
 *      into a tunnel at the wrong moment.
 *   2. The browser handback, verified. Fast, and it is what lets the
 *      confirmation screen appear immediately. Same signature scheme, different
 *      secret, and it is checked exactly as hard.
 *   3. Nothing. If no keys are configured, this module reports itself off and
 *      the site behaves as it did before there was a gateway: the order is
 *      recorded and a counsellor collects the money. That is the state this
 *      site is in until somebody sets the keys, and it must keep working.
 *
 * No dependencies. Node's own https and crypto do all of it.
 */

'use strict';

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

/* Overridable so the tests can point at a local stand-in. Nothing else should
   ever change it — a payments client whose endpoint comes from the environment
   in production is a payments client that can be redirected. */
const API_BASE = process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com';

/** Constant-time compare. A signature check that returns early on the first
 *  wrong byte tells an attacker how much of their guess was right. */
function sameSignature(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function request(method, path, auth, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, API_BASE);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      protocol: u.protocol,
      headers: Object.assign({
        Authorization: 'Basic ' + Buffer.from(auth).toString('base64'),
        Accept: 'application/json',
      }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      timeout: 15000,
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(out || '{}'); } catch (e) { parsed = { raw: out }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const msg = (parsed && parsed.error && parsed.error.description)
          || ('Razorpay answered ' + res.statusCode);
        const err = new Error(msg);
        err.status = res.statusCode;
        err.body = parsed;
        reject(err);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Razorpay did not answer in time')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* http for the local stand-in the tests run against; https everywhere real. */
if (/^http:/.test(API_BASE)) {
  const http = require('http');
  https.request = http.request;                       // eslint-disable-line
}

function makePay(cfg) {
  const keyId = (cfg && cfg.keyId) || '';
  const keySecret = (cfg && cfg.keySecret) || '';
  const webhookSecret = (cfg && cfg.webhookSecret) || '';
  const on = !!(keyId && keySecret);

  return {
    /* Whether to offer a card at all. Read by the API and sent to the page, so
       the browser never has to guess and never has to be told twice. */
    enabled: on,
    keyId: on ? keyId : '',
    /* A webhook we cannot verify is a webhook we must not act on. */
    webhookReady: !!(on && webhookSecret),

    /**
     * Ask Razorpay for an order.
     *
     * `amountPaise` is whatever this server computed from the catalogue. It is
     * never a number that arrived from a browser — that is the entire point of
     * doing it here.
     */
    async createOrder({ amountPaise, receipt, notes }) {
      if (!on) throw new Error('Razorpay is not configured on this server.');
      const amount = Math.round(Number(amountPaise) || 0);
      if (amount < 100) {
        /* Razorpay's own floor is ₹1. Sending less returns a 400 that reads
           like a server fault; refusing here says what actually happened. */
        throw new Error('That amount is too small to charge: ₹'
          + (amount / 100).toFixed(2) + '.');
      }
      return request('POST', '/v1/orders', keyId + ':' + keySecret, {
        amount,
        currency: 'INR',
        receipt: String(receipt || '').slice(0, 40),
        notes: notes || {},
        payment_capture: 1,
      });
    },

    /**
     * The browser's handback.
     *
     * Razorpay signs `order_id|payment_id` with the key secret. Anybody can
     * post the three ids; only Razorpay can produce the signature over them.
     */
    verifyHandback({ orderId, paymentId, signature }) {
      if (!on || !orderId || !paymentId || !signature) return false;
      return sameSignature(hmac(keySecret, orderId + '|' + paymentId), signature);
    },

    /**
     * The webhook.
     *
     * Signed over the RAW body — so the caller must hand us the bytes as they
     * arrived, not a re-serialised object. Re-serialising changes key order and
     * whitespace, the signature stops matching, and every real payment starts
     * looking forged.
     */
    verifyWebhook(rawBody, signature) {
      if (!webhookSecret || !signature) return false;
      return sameSignature(hmac(webhookSecret, rawBody), signature);
    },

    /** For the office: what is switched on, in words. */
    status() {
      if (!on) return 'off';
      return webhookSecret ? 'live' : 'live, no webhook';
    },
  };
}

module.exports = { makePay, hmac, sameSignature };
