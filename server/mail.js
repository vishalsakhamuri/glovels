'use strict';
/**
 * Mail.
 *
 * Two drivers behind one `send()`:
 *
 *   outbox  The default. Every message is written to `data/outbox/` as a real
 *           .eml file you can double-click and read. Nothing leaves the
 *           machine. This is not a stub — it is the same message, addressed and
 *           encoded the same way, so what you read locally is what arrives.
 *
 *   smtp    Used the moment `mail.env` has a password in it. A small SMTP
 *           client, written here rather than pulled in, because a mail library
 *           is a large dependency for what is a dozen commands over a socket.
 *
 * one.com allows `mailout.one.com` only from sites hosted on their servers, so
 * on a laptop the smtp driver will be refused. That is expected, and why outbox
 * is the default rather than an afterthought.
 *
 * Nothing in here throws into a request handler. A student's sign-up must not
 * fail because a mail server was slow.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

/* ------------------------------------------------------------------ config */

/*
 * The settings the mailer needs, from wherever they were put.
 *
 * This read a FILE and nothing else, while DEPLOY.md said "create mail.env, or
 * set the same names as environment variables". The documentation promised
 * something the code did not do, and the failure is silent by design: mail is
 * never allowed to fail a request, so an unconfigured mailer writes .eml files
 * to disk and reports success. Everything looked fine and nothing was
 * delivered — password resets, receipts, the sign-in details a ₹99 buyer needs.
 *
 * On a hosted deployment there is no file. There is an Environment tab, which
 * is the right place for a password: nothing on disk, nothing in a repository.
 * So the environment is read too, and it WINS over the file — the file is a
 * developer's convenience on a laptop, the environment is what the deployment
 * was actually configured with.
 */
const MAIL_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS',
  'MAIL_FROM', 'MAIL_TO'];

/* The three without which nothing can be sent. The port is not one of them —
   it defaults to 587 — and naming it as missing would send somebody looking
   for a setting they do not need. */
const REQUIRED = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];

function readEnv(file, env) {
  const cfg = {};
  try {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
  } catch (e) { /* no file: the environment, or outbox mode */ }

  const from = env || process.env;
  MAIL_KEYS.forEach(k => {
    const v = String(from[k] == null ? '' : from[k]).trim();
    /* An empty variable is not a setting. Hosting panels create blank ones by
       accident, and a blank SMTP_HOST that overrode a working file would be a
       nasty way to turn the mail off. */
    if (v) cfg[k] = v;
  });
  return cfg;
}

/* ----------------------------------------------------------- MIME encoding */

/* Anything outside ASCII in a header — a rupee sign, a name with an accent —
   has to be encoded or it arrives as mojibake. */
const encodeHeader = s =>
  /^[\x20-\x7e]*$/.test(s) ? s
    : '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';

/* Quoted-printable, so a plain-text body survives every mail server on the way
   and long lines are not silently wrapped mid-word. */
function quotedPrintable(text) {
  const out = [];
  for (const rawLine of String(text).replace(/\r\n/g, '\n').split('\n')) {
    let line = '';
    for (const ch of rawLine) {
      const bytes = Buffer.from(ch, 'utf8');
      let piece = '';
      if (bytes.length === 1 && ch !== '=' && bytes[0] >= 32 && bytes[0] <= 126) piece = ch;
      else piece = [...bytes].map(b => '=' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
      if (line.length + piece.length > 73) { out.push(line + '='); line = ''; }
      line += piece;
    }
    // a trailing space would be stripped in transit, so encode it
    out.push(line.replace(/ $/, '=20'));
  }
  return out.join('\r\n');
}

function buildMessage({ from, to, replyTo, subject, text, html, messageId, date }) {
  const boundary = 'glv-' + crypto.randomBytes(12).toString('hex');
  const head = [
    'From: ' + from,
    'To: ' + to,
    replyTo ? 'Reply-To: ' + replyTo : null,
    'Subject: ' + encodeHeader(subject),
    'Date: ' + date,
    'Message-ID: ' + messageId,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (!html) {
    return head.concat([
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '', quotedPrintable(text),
    ]).join('\r\n');
  }
  return head.concat([
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '', quotedPrintable(text), '',
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '', quotedPrintable(html), '',
    '--' + boundary + '--', '',
  ]).join('\r\n');
}

/* -------------------------------------------------------------- SMTP client */

function smtpSend({ host, port, user, pass, envelopeFrom, recipients, message, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const secure = Number(port) === 465;
    let socket = secure
      ? tls.connect({ host, port: Number(port), servername: host })
      : net.connect({ host, port: Number(port) });

    let buf = '';
    let stage = 0;
    let done = false;
    const finish = (err, info) => {
      if (done) return;
      done = true;
      try { socket.end(); } catch (e) {}
      err ? reject(err) : resolve(info);
    };

    const timer = setTimeout(() => finish(new Error('SMTP timed out after ' + timeoutMs + 'ms')), timeoutMs);
    socket.setTimeout(timeoutMs);
    socket.on('error', e => { clearTimeout(timer); finish(e); });
    socket.on('timeout', () => { clearTimeout(timer); finish(new Error('SMTP socket timeout')); });

    const say = line => socket.write(line + '\r\n');

    /* The conversation, in order. Each step waits for a 2xx/3xx before the next
       — an SMTP server that is unhappy says so, and pipelining past it turns one
       clear error into a confusing one. */
    const steps = [
      () => say('EHLO glovels.local'),
      () => (secure ? next() : say('STARTTLS')),
      () => {
        if (secure) return next();
        socket.removeAllListeners('data');
        socket = tls.connect({ socket, servername: host }, () => { stage = 2; say('EHLO glovels.local'); });
        socket.on('error', e => finish(e));
        socket.on('data', onData);
      },
      () => say('AUTH LOGIN'),
      () => say(Buffer.from(user, 'utf8').toString('base64')),
      () => say(Buffer.from(pass, 'utf8').toString('base64')),
      () => say('MAIL FROM:<' + envelopeFrom + '>'),
      () => say('RCPT TO:<' + recipients[0] + '>'),
      () => say('DATA'),
      () => {
        // a lone "." ends DATA, so any line that is just "." must be escaped
        socket.write(message.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n');
      },
      () => { clearTimeout(timer); finish(null, { ok: true }); },
    ];

    const next = () => { stage++; if (steps[stage]) steps[stage](); };

    function onData(chunk) {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^\d{3}-/.test(line)) continue;              // multi-line reply, wait for the last
        const code = Number(line.slice(0, 3));
        if (code >= 400) { clearTimeout(timer); return finish(new Error('SMTP ' + line)); }
        next();
      }
    }

    socket.on('data', onData);
  });
}

/* ------------------------------------------------------------------ facade */

function open({ dir, configFile, siteUrl, env }) {
  const cfg = readEnv(configFile, env);
  const outbox = path.join(dir, 'outbox');
  fs.mkdirSync(outbox, { recursive: true });

  const usable = !!(cfg.SMTP_HOST && cfg.SMTP_USER && cfg.SMTP_PASS);
  const mode = usable ? 'smtp' : 'outbox';

  const FROM = cfg.MAIL_FROM || 'Glovels <website@glovels.com>';
  const OFFICE = cfg.MAIL_TO || 'info@glovels.com';
  const fromAddress = (/<([^>]+)>/.exec(FROM) || [null, FROM])[1];

  const sent = [];

  async function send({ to, subject, text, html, replyTo }) {
    const stamp = new Date();
    const message = buildMessage({
      from: FROM,
      to,
      replyTo,
      subject,
      text,
      html,
      date: stamp.toUTCString(),
      messageId: '<' + crypto.randomBytes(12).toString('hex') + '@glovels.com>',
    });

    const record = { to, subject, at: stamp.toISOString(), mode };
    sent.push(record);
    if (sent.length > 200) sent.shift();

    /* Always write the copy first. If SMTP then fails, the message still exists
       on disk and can be re-sent or read — losing it because a server was down
       is the one outcome that is not recoverable. */
    const safe = String(to).replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(outbox,
      stamp.toISOString().replace(/[:.]/g, '-') + '__' + safe + '.eml');
    try { fs.writeFileSync(file, message); } catch (e) { /* disk full: still try to send */ }

    if (!usable) {
      console.log(`  mail → ${to}  "${subject}"  (written to ${path.relative(process.cwd(), file)})`);
      return { ok: true, mode: 'outbox', file };
    }

    try {
      await smtpSend({
        host: cfg.SMTP_HOST,
        port: cfg.SMTP_PORT || 587,
        user: cfg.SMTP_USER,
        pass: cfg.SMTP_PASS,
        envelopeFrom: fromAddress,
        recipients: [to],
        message,
      });
      console.log(`  mail → ${to}  "${subject}"  (sent)`);
      return { ok: true, mode: 'smtp' };
    } catch (e) {
      /* Never throw into a request handler: a student's sign-up must not fail
         because a mail server was slow. The copy is already on disk. */
      console.error(`  mail ✗ ${to}  "${subject}"  ${e.message}  (copy kept at ${path.basename(file)})`);
      return { ok: false, mode: 'smtp', error: e.message, file };
    }
  }

  /*
   * What the office can be told, without telling it the password.
   *
   * Nobody could answer "is our email working?" from inside the site — the
   * only place it was ever said was one line in the server's start-up log,
   * which means asking whoever has access to the host. That is not a question
   * anybody should have to escalate.
   */
  function status() {
    return {
      mode,
      /* Named, so "sending through which one?" has an answer. Never the user
         or the password. */
      host: usable ? cfg.SMTP_HOST : '',
      port: usable ? Number(cfg.SMTP_PORT || 587) : 0,
      /* Which of the three REQUIRED ones is missing, so a half-filled
         configuration says so rather than silently staying in outbox mode.
         SMTP_PORT is not one of them — it defaults to 587. */
      missing: REQUIRED.filter(k => !cfg[k]),
      from: FROM,
      office: OFFICE,
      outbox: path.relative(process.cwd(), outbox),
      /* How many are sitting on disk undelivered — the number that says how
         much went nowhere while nobody was looking. */
      waiting: (() => {
        try { return fs.readdirSync(outbox).filter(f => f.endsWith('.eml')).length; }
        catch (e) { return 0; }
      })(),
      recent: sent.slice(-8).reverse(),
    };
  }

  return {
    mode, send, status, office: OFFICE, from: FROM, siteUrl,
    recent: () => sent.slice(-20).reverse(),
  };
}

module.exports = { open, readEnv, buildMessage, quotedPrintable, MAIL_KEYS, REQUIRED };
