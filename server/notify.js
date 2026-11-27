'use strict';
/**
 * Getting hold of a person.
 *
 * A message in a portal nobody has open is not a message. Something has to
 * leave the building — an email, a WhatsApp, eventually a push. Which one is a
 * deployment decision, not an application one, so the application asks for
 * "notify this person" and this file decides how.
 *
 * Drivers:
 *
 *   email     Always on. Works today, on the laptop (written to data/outbox/)
 *             and on one.com (sent through their SMTP).
 *
 *   whatsapp  Written, and OFF until three things exist that no amount of code
 *             can conjure:
 *               1. a Meta Business account with the number verified,
 *               2. a WhatsApp Business phone number ID and a permanent token,
 *               3. a PUBLIC HTTPS URL for Meta's webhook — a laptop cannot be
 *                  one, so inbound replies only start working once the portal
 *                  is hosted.
 *             Meta also refuses free-form business-initiated messages outside a
 *             24-hour window, so the first contact must be an approved template.
 *             `WHATSAPP_TEMPLATE` below is that template's name.
 *
 * Turning it on is three lines in mail.env and nothing else:
 *   WHATSAPP_TOKEN=...
 *   WHATSAPP_PHONE_ID=...
 *   WHATSAPP_TEMPLATE=glovels_new_message
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

function post(url, token, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const u = new URL(url);
    /* plain http only for a local test stand-in (WHATSAPP_GRAPH=http://localhost:…) */
    const req = (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? http : https).request({
      hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Authorization: 'Bearer ' + token,
      },
      timeout: 15000,
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(JSON.parse(out || '{}'));
        reject(new Error('WhatsApp API ' + res.statusCode + ': ' + out.slice(0, 300)));
      });
    });
    req.on('timeout', () => { req.destroy(new Error('WhatsApp API timed out')); });
    req.on('error', reject);
    req.end(body);
  });
}

/* Patch 328: a GET with the token, to prove a token and phone number ID work. */
function get(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? http : https).request({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + token }, timeout: 10000,
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { try { return resolve(JSON.parse(out || '{}')); } catch (e) { return resolve({}); } }
        reject(new Error('WhatsApp API ' + res.statusCode + ': ' + out.slice(0, 300)));
      });
    });
    req.on('timeout', () => { req.destroy(new Error('WhatsApp API timed out')); });
    req.on('error', reject);
    req.end();
  });
}

/** Meta wants digits only, with country code and no plus. */
const waNumber = phone => String(phone || '').replace(/\D+/g, '').replace(/^0+/, '');

function open({ mail, config, siteUrl, log = console }) {
  /* Patch 327: the settings from the file and the environment (`base`), with
     what an administrator typed on Organisation → Settings → Connections
     laid over them (`configure`). Changing them there takes effect at once. */
  const base = Object.assign({}, config || {});
  let cfg = base, waReady = false, appSecret = '', template = '', api = '';
  const recompute = () => {
    waReady = !!(cfg.WHATSAPP_TOKEN && cfg.WHATSAPP_PHONE_ID);
    /* The app secret from Meta's developer console, App settings → Basic. Meta
       signs every callback with it (X-Hub-Signature-256 over the raw body);
       without it a callback cannot be told from anybody's POST. */
    appSecret = String(cfg.WHATSAPP_APP_SECRET || '').trim();
    template = cfg.WHATSAPP_TEMPLATE || 'glovels_new_message';
    api = String(cfg.WHATSAPP_GRAPH || 'https://graph.facebook.com').replace(/\/+$/, '') + '/v21.0/' + cfg.WHATSAPP_PHONE_ID + '/messages';
  };
  recompute();

  async function whatsappText(to, text) {
    if (!waReady) return { ok: false, skipped: 'whatsapp not configured' };
    const num = waNumber(to);
    if (!num) return { ok: false, skipped: 'no phone number' };
    try {
      await post(api, cfg.WHATSAPP_TOKEN, {
        messaging_product: 'whatsapp',
        to: num,
        type: 'text',
        text: { preview_url: false, body: String(text).slice(0, 4000) },
      });
      return { ok: true };
    } catch (e) {
      /* The commonest failure by far is the 24-hour rule: a free-form message
         is only allowed inside 24 hours of the person's last message. Outside
         it, Meta refuses and an approved template is the only way through. */
      log.error('  whatsapp ✗ ' + num + ' ' + e.message);
      return { ok: false, error: e.message };
    }
  }

  async function whatsappTemplate(to, params) {
    if (!waReady) return { ok: false, skipped: 'whatsapp not configured' };
    const num = waNumber(to);
    if (!num) return { ok: false, skipped: 'no phone number' };
    try {
      await post(api, cfg.WHATSAPP_TOKEN, {
        messaging_product: 'whatsapp',
        to: num,
        type: 'template',
        template: {
          name: template,
          language: { code: cfg.WHATSAPP_LANG || 'en' },
          components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) }],
        },
      });
      return { ok: true };
    } catch (e) {
      log.error('  whatsapp template ✗ ' + num + ' ' + e.message);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Tell somebody something. Email always; WhatsApp too when it is configured
   * and we have a number. Neither is allowed to fail the caller.
   */
  async function notify({ to, phone, email, whatsapp }) {
    const out = {};
    if (email) out.email = await mail.send(Object.assign({ to }, email)).catch(e => ({ ok: false, error: e.message }));
    if (whatsapp && waReady && phone) {
      out.whatsapp = whatsapp.template
        ? await whatsappTemplate(phone, whatsapp.params || [])
        : await whatsappText(phone, whatsapp.text || '');
    }
    return out;
  }

  return {
    notify,
    whatsappText,
    whatsappTemplate,
    get whatsappReady() { return waReady; },
    get webhookReady() { return !!appSecret; },
    /** Patch 327: lay the admin panel's values over the file's; an empty one falls back to it. */
    configure(over) {
      const o = {};
      Object.keys(over || {}).forEach(k => { const v = String(over[k] == null ? '' : over[k]).trim(); if (v) o[k] = v; });
      cfg = Object.assign({}, base, o);
      recompute();
    },
    /** Patch 328: does this token reach this phone number? Says the number and the name Meta shows. */
    async check() {
      if (!waReady) throw new Error('No token and phone number ID yet.');
      return get(String(cfg.WHATSAPP_GRAPH || 'https://graph.facebook.com').replace(/\/+$/, '') + '/v21.0/' + encodeURIComponent(cfg.WHATSAPP_PHONE_ID) + '?fields=display_phone_number,verified_name', cfg.WHATSAPP_TOKEN);
    },
    /** Patch 327: what the settings are, and where each came from — never the secret itself. */
    describe() {
      const pick = k => String(cfg[k] || ''), from = k => (cfg[k] && cfg[k] === base[k] ? 'server' : cfg[k] ? 'panel' : '');
      return { token: pick('WHATSAPP_TOKEN'), phoneId: pick('WHATSAPP_PHONE_ID'), appSecret: pick('WHATSAPP_APP_SECRET'), verify: pick('WHATSAPP_VERIFY_TOKEN') || 'glovels',
        from: { token: from('WHATSAPP_TOKEN'), phoneId: from('WHATSAPP_PHONE_ID'), appSecret: from('WHATSAPP_APP_SECRET'), verify: from('WHATSAPP_VERIFY_TOKEN') },
        graph: String(cfg.WHATSAPP_GRAPH || 'https://graph.facebook.com').replace(/\/+$/, '') };
    },
    /** Meta's signature over the raw callback body: "sha256=<hex hmac>". */
    verifySignature(raw, header) {
      if (!appSecret) return false;
      const got = String(header || '').replace(/^sha256=/i, '').trim();
      if (!/^[0-9a-f]{64}$/i.test(got)) return false;
      const want = crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
    },
    status() {
      return {
        mail: mail.mode,
        whatsapp: waReady ? 'configured' : 'off — needs WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in mail.env',
        webhook: !waReady ? 'n/a'
          : !appSecret ? 'off — set WHATSAPP_APP_SECRET so replies from Meta can be verified'
          : siteUrl + '/api/whatsapp/webhook  (must be a public HTTPS URL for Meta to reach it)',
      };
    },
    /** Meta's webhook verification handshake: echo hub.challenge back. */
    verifyWebhook(query) {
      const want = cfg.WHATSAPP_VERIFY_TOKEN || 'glovels';
      if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === want) {
        return { ok: true, challenge: query['hub.challenge'] };
      }
      return { ok: false };
    },
    /** Pull the messages out of Meta's callback shape.
     *
     * Patch 325: every message, not only text — a photo, a voice note or a
     * document from somebody new is still somebody new, so it is kept as a
     * line saying what it was. Each comes with Meta's message id (callbacks
     * are retried, and the same message must not be filed twice), the
     * sender's WhatsApp name when Meta gives it, and `echo` for a message the
     * office sent from the WhatsApp Business app on the same number (Meta's
     * "smb_message_echoes", when the number is connected that way). */
    parseWebhook(body) {
      const out = [];
      const what = m => {
        const t = m && m.type;
        if (t === 'text') return String((m.text || {}).body || '');
        if (t === 'button') return String((m.button || {}).text || '[button]');
        if (t === 'interactive') { const i = m.interactive || {}; return String((i.button_reply || i.list_reply || {}).title || '[a choice from a list]'); }
        if (t === 'image') return '[photo]' + ((m.image || {}).caption ? ' ' + m.image.caption : '');
        if (t === 'document') return '[document' + ((m.document || {}).filename ? ': ' + m.document.filename : '') + ']' + ((m.document || {}).caption ? ' ' + m.document.caption : '');
        if (t === 'audio') return '[voice note]';
        if (t === 'video') return '[video]' + ((m.video || {}).caption ? ' ' + m.video.caption : '');
        if (t === 'sticker') return '[sticker]';
        if (t === 'location') return '[location]';
        if (t === 'contacts') return '[a contact card]';
        if (t === 'reaction') return '';
        return t ? '[' + t + ']' : '';
      };
      try {
        (body.entry || []).forEach(e => (e.changes || []).forEach(c => {
          const v = c.value || {};
          const names = {};
          (v.contacts || []).forEach(k => { if (k && k.wa_id) names[String(k.wa_id)] = String((k.profile || {}).name || ''); });
          (v.messages || []).forEach(m => {
            const text = what(m);
            if (!text || !m.from) return;
            out.push({ id: String(m.id || ''), from: String(m.from), name: names[String(m.from)] || '', text, at: m.timestamp, echo: false });
          });
          (v.message_echoes || []).forEach(m => {
            const text = what(m);
            if (!text || !m.to) return;
            out.push({ id: String(m.id || ''), from: String(m.to), name: '', text, at: m.timestamp, echo: true });
          });
        }));
      } catch (e) { /* an unexpected shape is not worth crashing over */ }
      return out;
    },
  };
}

module.exports = { open, waNumber };
