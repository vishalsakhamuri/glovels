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

function post(url, token, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
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

/** Meta wants digits only, with country code and no plus. */
const waNumber = phone => String(phone || '').replace(/\D+/g, '').replace(/^0+/, '');

function open({ mail, config, siteUrl, log = console }) {
  const cfg = config || {};
  const waReady = !!(cfg.WHATSAPP_TOKEN && cfg.WHATSAPP_PHONE_ID);
  const template = cfg.WHATSAPP_TEMPLATE || 'glovels_new_message';
  const api = 'https://graph.facebook.com/v21.0/' + cfg.WHATSAPP_PHONE_ID + '/messages';

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
    whatsappReady: waReady,
    status() {
      return {
        mail: mail.mode,
        whatsapp: waReady ? 'configured' : 'off — needs WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in mail.env',
        webhook: waReady
          ? siteUrl + '/api/whatsapp/webhook  (must be a public HTTPS URL for Meta to reach it)'
          : 'n/a',
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
    /** Pull the plain-text replies out of Meta's callback shape. */
    parseWebhook(body) {
      const out = [];
      try {
        (body.entry || []).forEach(e => (e.changes || []).forEach(c => {
          (c.value && c.value.messages || []).forEach(m => {
            if (m.type !== 'text') return;
            out.push({ from: m.from, text: m.text.body, at: m.timestamp });
          });
        }));
      } catch (e) { /* an unexpected shape is not worth crashing over */ }
      return out;
    },
  };
}

module.exports = { open, waNumber };
