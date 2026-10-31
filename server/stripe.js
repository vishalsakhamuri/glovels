/**
 * Stripe, for buyers outside India — sold by Glovels UG (haftungsbeschränkt).
 *
 * Patch 195 (owner, 31 Oct 2026): "for India it's Razorpay and anywhere else
 * in the world it's Stripe." Razorpay stays the Indian company's gateway
 * (Glovels Consultants Private Limited, rupees, GST); Stripe is the German
 * company's (Glovels UG), for an export sale in the buyer's own currency.
 *
 * THE SAME RULE AS server/pay.js. Nothing is paid because a browser said so.
 * Stripe Checkout is a redirect: the buyer pays on Stripe's page and comes
 * back. Coming back proves nothing — the server asks Stripe itself (with the
 * secret key, which no browser has seen) whether that Checkout Session was
 * paid, for what amount and in what currency, and the webhook, signed with
 * the webhook secret over the raw bytes, is the authority behind both.
 *
 * Off until STRIPE_SECRET_KEY is set. Off is a working state: a buyer abroad
 * then goes to Razorpay as before (or a counsellor collects).
 *
 * No dependencies. Node's own https and crypto do all of it.
 */

'use strict';

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

/* Overridable for the tests' local stand-in only — see server/pay.js. */
const API_BASE = process.env.STRIPE_API_BASE || 'https://api.stripe.com';

/* Stripe's own minor units, which are NOT all Razorpay's (server/fx.js).
   https://docs.stripe.com/currencies */
const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX',
  'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
/* Two decimals on paper, but Stripe wants whole units (amount divisible by 100). */
const WHOLE2 = new Set(['ISK', 'HUF', 'TWD']);

/**
 * `units` of `currency` (e.g. 571.5 USD) in Stripe's minor units, rounded UP
 * where Stripe needs a coarser step — never down, so we never undercharge.
 */
function minorFor(currency, units) {
  const c = String(currency || '').toUpperCase();
  const u = Number(units) || 0;
  if (ZERO.has(c)) return Math.ceil(u - 1e-9);
  if (THREE.has(c)) return Math.ceil(Math.round(u * 1000) / 10) * 10;
  if (WHOLE2.has(c)) return Math.ceil(u - 1e-9) * 100;
  return Math.ceil(Math.round(u * 1000) / 10);
}
const exponentFor = c => (ZERO.has(String(c).toUpperCase()) ? 0 : THREE.has(String(c).toUpperCase()) ? 3 : 2);

function sameSignature(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Stripe's form encoding: nested objects as a[b][c]=v. */
function form(obj, prefix, out) {
  out = out || [];
  Object.keys(obj || {}).forEach(k => {
    const v = obj[k];
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (v == null) return;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  });
  return out.join('&');
}

function request(method, path, secret, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, API_BASE);
    const data = body ? Buffer.from(form(body)) : null;
    const lib = u.protocol === 'http:' ? require('http') : https;
    const req = lib.request({
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers: Object.assign({
        Authorization: 'Bearer ' + secret,
        Accept: 'application/json',
      }, data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length } : {}),
      timeout: 15000,
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(out || '{}'); } catch (e) { parsed = { raw: out }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const err = new Error((parsed && parsed.error && parsed.error.message) || ('Stripe answered ' + res.statusCode));
        err.status = res.statusCode;
        reject(err);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Stripe did not answer in time')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function makeStripe(cfg) {
  const secretKey = (cfg && cfg.secretKey) || '';
  const webhookSecret = (cfg && cfg.webhookSecret) || '';
  const on = !!secretKey;

  return {
    enabled: on,
    webhookReady: !!(on && webhookSecret),
    seller: (cfg && cfg.seller) || 'Glovels UG (haftungsbeschränkt)',

    /**
     * A Checkout Session for an amount THIS server worked out. The browser is
     * given only the URL Stripe hands back.
     */
    async createSession({ amountMinor, currency, reference, partN, email, description, successUrl, cancelUrl }) {
      if (!on) throw new Error('Stripe is not configured on this server.');
      const cur = String(currency || '').toUpperCase();
      const amount = Math.round(Number(amountMinor) || 0);
      if (!/^[A-Z]{3}$/.test(cur) || cur === 'INR') throw new Error('Stripe takes buyers abroad only, not ' + cur + '.');
      if (amount < 1) throw new Error('That amount is too small to charge: ' + cur + ' ' + amount + ' (minor units).');
      const meta = { reference: String(reference || ''), part: partN == null ? '' : String(partN) };
      return request('POST', '/v1/checkout/sessions', secretKey, {
        mode: 'payment',
        client_reference_id: String(reference || '').slice(0, 200),
        customer_email: email || undefined,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: { 0: {
          quantity: 1,
          price_data: { currency: cur.toLowerCase(), unit_amount: amount,
            product_data: { name: String(description || 'Glovels').slice(0, 250) } },
        } },
        metadata: meta,
        payment_intent_data: { description: 'Glovels ' + reference + (partN == null ? '' : ' part ' + partN), metadata: meta },
      });
    },

    /** Ask Stripe, with the secret key, what really happened to a session. */
    async session(id) {
      if (!on) throw new Error('Stripe is not configured on this server.');
      if (!/^cs_[A-Za-z0-9_]+$/.test(String(id || ''))) throw new Error('Not a Checkout Session id.');
      return request('GET', '/v1/checkout/sessions/' + encodeURIComponent(id), secretKey);
    },

    /**
     * The webhook. Header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`; the
     * signature is HMAC-SHA256 of `<t>.<raw body>` with the webhook secret.
     * Older than five minutes is refused, so a captured request cannot be
     * replayed later.
     */
    verifyWebhook(rawBody, header, nowSec) {
      if (!webhookSecret || !header) return false;
      const parts = String(header).split(',').map(s => s.trim());
      const t = (parts.find(p => p.startsWith('t=')) || '').slice(2);
      const sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
      if (!/^\d+$/.test(t) || !sigs.length) return false;
      const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
      if (Math.abs(now - Number(t)) > 300) return false;
      const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
      const want = crypto.createHmac('sha256', webhookSecret).update(t + '.' + raw).digest('hex');
      return sigs.some(s => sameSignature(want, s));
    },

    status() {
      if (!on) return 'off';
      return webhookSecret ? 'live' : 'live, no webhook';
    },
  };
}

/* Stripe: live, test, or off — from the secret key's prefix. */
function stripeState(st) {
  const k = String((st && st.secretKey) || '');
  if (!k) return { state: 'off', label: 'not configured' };
  if (/^(sk|rk)_test_/.test(k)) return { state: 'test', label: 'TEST key' };
  if (/^(sk|rk)_live_/.test(k)) return { state: 'live', label: 'LIVE key' };
  return { state: 'unknown', label: 'key set (prefix not recognised)' };
}

module.exports = { makeStripe, minorFor, exponentFor, form, stripeState };
