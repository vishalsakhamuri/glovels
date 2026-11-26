'use strict';
/*
 * INSTAGRAM DIRECT MESSAGES (patch 325).
 *
 * Owner, 27 Nov: "we have website chat and WhatsApp chat where new students
 * can message — we need to make sure we track these leads … also Insta
 * messages."
 *
 * Meta sends every message to the business's Instagram professional account
 * to /api/instagram/webhook (Instagram API with Instagram Login, webhook
 * field "messages"), signed with the Instagram app's secret. A reply is sent
 * back through the same API. Meta allows a reply within 24 hours of the
 * person's last message.
 *
 * Settings (Render → Environment, or mail.env):
 *   INSTAGRAM_TOKEN        the Instagram user access token for the account
 *   INSTAGRAM_ACCOUNT_ID   the account's Instagram user ID (IG_ID)
 *   INSTAGRAM_APP_SECRET   the Instagram app secret — signs every callback
 *   INSTAGRAM_VERIFY_TOKEN any word, typed again on Meta's webhook form
 *   INSTAGRAM_GRAPH        (tests only) a local stand-in for graph.instagram.com
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const VERSION = 'v25.0';

function call(method, url, token, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const lib = u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? http : https;
    const req = lib.request({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
      timeout: 10000,
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { try { return resolve(JSON.parse(out || '{}')); } catch (e) { return resolve({}); } }
        reject(new Error('Instagram API ' + res.statusCode + ': ' + out.slice(0, 300)));
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Instagram API timed out')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function open({ config, log = console }) {
  const cfg = config || {};
  const token = String(cfg.INSTAGRAM_TOKEN || '').trim();
  const account = String(cfg.INSTAGRAM_ACCOUNT_ID || '').trim();
  const secret = String(cfg.INSTAGRAM_APP_SECRET || '').trim();
  const base = String(cfg.INSTAGRAM_GRAPH || 'https://graph.instagram.com').replace(/\/+$/, '') + '/' + VERSION;
  const ready = !!(token && account);

  /* What a message was, as one line: the words, or what was sent instead. */
  const what = msg => {
    const text = String((msg && msg.text) || '').trim();
    const att = (msg && Array.isArray(msg.attachments) ? msg.attachments : []).map(a => {
      const t = String((a && a.type) || '');
      return t === 'image' ? '[photo]' : t === 'video' ? '[video]' : t === 'audio' ? '[voice note]' : t === 'file' ? '[file]'
        : t === 'share' || t === 'ig_reel' || t === 'reel' ? '[shared a post]' : t === 'story_mention' ? '[mentioned you in a story]' : t ? '[' + t + ']' : '';
    }).filter(Boolean);
    if (msg && msg.reply_to && msg.reply_to.story) att.unshift('[replied to your story]');
    return [att.join(' '), text].filter(Boolean).join(' ').trim();
  };

  return {
    ready,
    webhookReady: !!secret,
    status() {
      return ready ? (secret ? 'connected' : 'off — set INSTAGRAM_APP_SECRET so messages from Meta can be verified')
        : 'off — needs INSTAGRAM_TOKEN and INSTAGRAM_ACCOUNT_ID';
    },
    verifyWebhook(q) {
      const want = String(cfg.INSTAGRAM_VERIFY_TOKEN || 'glovels');
      return q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === want ? { ok: true, challenge: q['hub.challenge'] } : { ok: false };
    },
    verifySignature(raw, header) {
      if (!secret) return false;
      const got = String(header || '').replace(/^sha256=/i, '').trim();
      if (!/^[0-9a-f]{64}$/i.test(got)) return false;
      const want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
    },
    /* The messages in a callback. `them` is the Instagram-scoped ID of the
       person the conversation is with; `echo` is a message the business sent
       (from the Instagram app, or from here). Reactions, "seen" and the like
       carry no message and are left out. */
    parse(body) {
      const out = [];
      try {
        (body && body.entry || []).forEach(e => (e.messaging || []).forEach(ev => {
          const m = ev && ev.message;
          if (!m || m.is_deleted) return;
          const sender = String((ev.sender || {}).id || ''), recipient = String((ev.recipient || {}).id || '');
          const echo = !!m.is_echo || (!!account && sender === account) || (!!e.id && sender === String(e.id));
          const text = what(m);
          if (!text) return;
          out.push({ id: String(m.mid || ''), them: echo ? recipient : sender, text: text.slice(0, 2000), echo, at: ev.timestamp });
        }));
      } catch (e) { /* an unexpected shape is not worth crashing over */ }
      return out;
    },
    /* Their name and username, for the lead. Nothing is lost if this fails. */
    async profile(igsid) {
      if (!ready || !igsid) return {};
      try {
        const p = await call('GET', base + '/' + encodeURIComponent(igsid) + '?fields=name,username', token);
        return { name: String(p.name || ''), username: String(p.username || '') };
      } catch (e) { log.error('  instagram profile ✗ ' + e.message); return {}; }
    },
    async send(igsid, text) {
      if (!ready) return { ok: false, error: 'Instagram is not connected on this server (INSTAGRAM_TOKEN and INSTAGRAM_ACCOUNT_ID).' };
      try {
        await call('POST', base + '/' + encodeURIComponent(account) + '/messages', token,
          { recipient: { id: String(igsid) }, message: { text: String(text).slice(0, 1000) } });
        return { ok: true };
      } catch (e) { log.error('  instagram send ✗ ' + e.message); return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { open };
