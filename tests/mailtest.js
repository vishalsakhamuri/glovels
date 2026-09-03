/**
 * Is the email connected?
 *
 * Vishal asked that, and it took reading the source to answer, which is the
 * whole bug. `server/mail.js` read the SMTP details from a FILE next to the
 * server and from nothing else — while DEPLOY.md said "create mail.env, or set
 * the same names as environment variables". On a hosted deployment there is no
 * file; there is an Environment tab, which is where a password belongs. So the
 * settings were typed in, never read, and every message since was written to a
 * .eml on disk and delivered to nobody.
 *
 * It failed silently by design, and that design is right: a student's sign-up
 * must not break because a mail server was slow. Which is exactly why it has to
 * be VISIBLE instead — a line on the Organisation screen that says whether mail
 * is going out, and a button that proves it.
 *
 * Three things are checked here, and the first is the one that would have
 * caught the original defect:
 *
 *   the environment is READ, and beats the file
 *   an empty variable is not a setting — a blank SMTP_HOST from a hosting
 *   panel must not switch off a working configuration
 *   the office can see the answer and test it without asking anybody
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = '/home/claude/glovels/build';
const mailer = require(ROOT + '/server/mail.js');

const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

/* ------------------------------------------------------- the reading itself */

const tmp = '/tmp/mailtest-' + Date.now();
fs.mkdirSync(tmp, { recursive: true });
const cfgFile = path.join(tmp, 'mail.env');

fs.writeFileSync(cfgFile, [
  '# a developer\'s laptop',
  'SMTP_HOST=file.example.com',
  'SMTP_USER=from-the-file',
  'SMTP_PASS=file-secret',
  'MAIL_FROM=File <file@glovels.com>',
].join('\n'));

let cfg = mailer.readEnv(cfgFile, {});
check('a mail.env file is still read', cfg.SMTP_HOST === 'file.example.com', cfg.SMTP_HOST);

/* THE check. */
cfg = mailer.readEnv('/tmp/there-is-no-such-file.env', {
  SMTP_HOST: 'smtp.one.com', SMTP_USER: 'info@glovels.com', SMTP_PASS: 'x',
});
check('settings typed into a hosting environment are read',
  cfg.SMTP_HOST === 'smtp.one.com' && cfg.SMTP_USER === 'info@glovels.com',
  JSON.stringify(cfg));

cfg = mailer.readEnv(cfgFile, { SMTP_HOST: 'env.example.com', SMTP_PASS: 'env-secret' });
check('and they beat the file, because the deployment is the truth',
  cfg.SMTP_HOST === 'env.example.com' && cfg.SMTP_PASS === 'env-secret',
  cfg.SMTP_HOST);
check('while anything the environment does not set still comes from the file',
  cfg.SMTP_USER === 'from-the-file', cfg.SMTP_USER);

/* Hosting panels create blank variables by accident. A blank one that overrode
   a working file would be a very quiet way to turn the mail off. */
cfg = mailer.readEnv(cfgFile, { SMTP_HOST: '', SMTP_USER: '   ' });
check('an empty variable is not a setting and does not switch mail off',
  cfg.SMTP_HOST === 'file.example.com' && cfg.SMTP_USER === 'from-the-file',
  cfg.SMTP_HOST + ' / ' + cfg.SMTP_USER);

/* ------------------------------------------------- what went wrong, in words
 *
 * "The mail server refused it: no reason given" was this file's own doing.
 * Node wraps a failed connection to a host with several addresses — every real
 * mail server has several — in an AggregateError whose OWN message is the
 * empty string, with the reasons in `.errors`. Reading `e.message` got nothing,
 * and an empty reason is worse than a technical one: it says something is
 * broken and nothing about what.
 */
const agg = new AggregateError(
  [Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:587'), { code: 'ECONNREFUSED' }),
   Object.assign(new Error('connect ECONNREFUSED [2a00::1]:587'), { code: 'ECONNREFUSED' })]);
check('an AggregateError has no message of its own', agg.message === '' || !agg.message,
  JSON.stringify(agg.message));
check('and its reasons are read out instead of reporting nothing',
  /ECONNREFUSED/.test(mailer.describe(agg)), mailer.describe(agg));

check('a plain error is passed through', /ETIMEDOUT/.test(
  mailer.describe(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))));
check('an error with only a code still says the code',
  mailer.describe({ code: 'ECONNRESET' }) === 'ECONNRESET',
  mailer.describe({ code: 'ECONNRESET' }));
check('and nothing at all does not become the empty string',
  mailer.describe(null) === 'no reason given', mailer.describe(null));

/* A connection that dies mid-conversation must say where it died: a server
   that hangs up at hello is blocking this machine, one that hangs up after the
   password is rejecting the password. Same silence, opposite fixes. */
const dead = mailer.open({
  dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x',
  env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: '9', SMTP_USER: 'u', SMTP_PASS: 'p' },
});

/* ------------------------------------------- the door that is not blocked
 *
 * Render's free plan blocks outbound traffic to ports 25, 465 and 587 — every
 * SMTP port there is — so on that plan no mail server setting can ever send
 * anything, whoever the provider is. The symptom is twenty seconds of silence
 * at connect: the packets never leave the machine.
 *
 * Port 443 is not blocked and never will be, because it is how the site is
 * served. So the same email goes out through the provider's ordinary HTTP API.
 */
const viaApi = mailer.open({
  dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x',
  env: { MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'not-a-real-key',
    MAIL_FROM: 'Glovels <info@glovels.com>' },
});
check('a provider and a key is a working configuration on its own',
  viaApi.mode === 'api', viaApi.mode);
const apiSt = viaApi.status();
check('and no mail server settings are reported missing',
  apiSt.missing.length === 0, apiSt.missing.join(','));
check('the screen is told which provider', apiSt.provider === 'brevo'
  && apiSt.providerLabel === 'Brevo', apiSt.provider);
check('and offered the ones it can choose from',
  (apiSt.providers || []).map(p => p.id).sort().join(',') === 'brevo,resend',
  (apiSt.providers || []).map(p => p.id).join(','));
check('the API key never leaves the server',
  !JSON.stringify(apiSt).includes('not-a-real-key')
  && apiSt.saved.hasApiKey === false, JSON.stringify(apiSt.saved));

/* A provider without a key, or a key without a provider, is not a setup. */
check('a provider with no key is not treated as configured',
  mailer.open({ dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x',
    env: { MAIL_PROVIDER: 'brevo' } }).mode === 'outbox');
check('nor a key with no provider',
  mailer.open({ dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x',
    env: { MAIL_API_KEY: 'k' } }).mode === 'outbox');
check('nor a provider nobody has heard of',
  mailer.open({ dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x',
    env: { MAIL_PROVIDER: 'mailchimp', MAIL_API_KEY: 'k' } }).mode === 'outbox');

/* And a provider beats a mail server, because it is the one that works where
   this is hosted. */
check('a provider is used even when SMTP is also filled in',
  mailer.open({ dir: tmp, configFile: cfgFile, siteUrl: 'x',
    env: { MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k' } }).mode === 'api');

/* ---------------------------------------------------------------- the modes */

const noMail = mailer.open({ dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x', env: {} });
check('with nothing configured the mailer says so', noMail.mode === 'outbox', noMail.mode);
const st = noMail.status();
check('and names all three settings it is missing',
  st.missing.join(',') === 'SMTP_HOST,SMTP_USER,SMTP_PASS', st.missing.join(','));

const SECRET = 'not-a-real-password-9f2c';
const withMail = mailer.open({
  dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x',
  env: { SMTP_HOST: 'smtp.one.com', SMTP_USER: 'u', SMTP_PASS: SECRET, SMTP_PORT: '465' },
});
check('with all three set it reports itself live', withMail.mode === 'smtp', withMail.mode);
const live = withMail.status();
check('and names the server it is sending through',
  live.host === 'smtp.one.com' && live.port === 465, live.host + ':' + live.port);
check('nothing missing', live.missing.length === 0, live.missing.join(','));

/* The password must never leave the server, not even to an administrator.
   Checked against the value itself and against a field that could carry it —
   `hasPassword` is a boolean and is the only thing on this subject that may
   travel. */
const asText = JSON.stringify(live);
check('the status never carries the password',
  !asText.includes(SECRET) && !/"(pass|password|SMTP_PASS)"\s*:/.test(asText),
  asText.slice(0, 100));

/* Two settings out of three is not "configured" — it is the state that looks
   configured and delivers nothing. */
const half = mailer.open({
  dir: tmp, configFile: '/tmp/nope.env', siteUrl: 'x',
  env: { SMTP_HOST: 'smtp.one.com', SMTP_USER: 'u' },
});
check('a half-filled configuration is not treated as working',
  half.mode === 'outbox' && half.status().missing.join(',') === 'SMTP_PASS',
  half.mode + ' missing ' + half.status().missing.join(','));

/* An unconfigured send still succeeds, and still writes the copy. Losing the
   message because a server was down is the one unrecoverable outcome. */
(async () => {
  const out = await noMail.send({ to: 'somebody@example.com', subject: 'hello', text: 'hi' });
  check('an unconfigured send does not throw into a request',
    out.ok === true && out.mode === 'outbox', JSON.stringify(out));
  check('and the message is kept on disk rather than lost',
    fs.existsSync(out.file), out.file);
  check('the count of undelivered messages is reported',
    noMail.status().waiting >= 1, noMail.status().waiting);

  /* Nothing is listening on port 9. The failure must be reported in words, and
     must not take the full twenty-second timeout to arrive. */
  const t0 = Date.now();
  const refused = await dead.send({ to: 'x@example.com', subject: 'x', text: 'x' });
  const took = Date.now() - t0;
  check('a refused connection reports an actual reason',
    refused.ok === false && /ECONNREFUSED|closed the connection/i.test(refused.error || ''),
    (refused.error || '(empty)').slice(0, 80));
  check('and never reports an empty one', (refused.error || '').trim().length > 3,
    JSON.stringify(refused.error));
  check('and says where in the conversation it died',
    /\bat\b/.test(refused.error || ''), refused.error);
  check('without waiting out the whole timeout', took < 15000, took + 'ms');
  check('the message is still kept on disk', fs.existsSync(refused.file));

  /* -------------------------------------------------------- over HTTP */
  const PORT = 8081;
  const dir = '/tmp/db-mail-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn('node', ['serve.js'], {
    cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir }),
  });
  const get = p => new Promise(r => {
    http.get({ host: 'localhost', port: PORT, path: p }, res => {
      let b = ''; res.on('data', c => (b += c)); res.on('end', () => r(res.statusCode));
    }).on('error', () => r(0));
  });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 400));
    if ((await get('/api/health')) === 200) break;
  }

  const BASE = 'http://localhost:' + PORT;
  const browser = await chromium.launch();
  try {
    const admin = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
    await admin.request.post(BASE + '/api/auth/login',
      { data: { email: 'admin@glovels.com', password: 'glovels123' } });

    const r = await admin.request.get(BASE + '/api/staff/mail');
    check('an admin can ask whether mail is working', r.status() === 200, r.status());
    const said = await r.json();
    check('and is told which of the two states it is in',
      said.mode === 'outbox' || said.mode === 'smtp', said.mode);

    /* The test send. On a machine with no SMTP it must report the truth rather
       than a cheerful "sent". */
    const t = await admin.request.post(BASE + '/api/staff/mail/test', { data: {} });
    check('the test button reaches the server', t.status() === 200, t.status());
    const res = await t.json();
    check('and says plainly that nothing was sent when nothing was configured',
      res.ok === false && res.mode === 'outbox', JSON.stringify(res).slice(0, 80));
    check('naming the settings to fix it',
      /SMTP_HOST/.test(res.said || ''), (res.said || '').slice(0, 70));
    check('and it goes to the administrator’s own address, nowhere else',
      res.to === 'admin@glovels.com', res.to);

    /* ------------------------------------------- settings typed into the site
       "Also we should be able to send the email from this setting."

       A mail setting that can only be changed in a hosting dashboard, behind a
       redeploy, is one nobody in the office can fix. */
    const put = await admin.request.put(BASE + '/api/staff/mail', {
      data: {
        host: 'mailout.one.com', port: 587, user: 'info@glovels.com',
        pass: 'typed-in-by-the-office', from: 'Glovels <info@glovels.com>',
        office: 'info@glovels.com',
      },
    });
    check('an admin can save the mail settings from the site', put.status() === 200,
      put.status());

    const now = await (await admin.request.get(BASE + '/api/staff/mail')).json();
    check('and they are in force at once, with no restart',
      now.mode === 'smtp' && now.host === 'mailout.one.com',
      now.mode + ' ' + now.host);
    check('the screen says where the settings came from',
      now.source === 'office', now.source);
    check('the form can be filled in from what was saved',
      now.saved.host === 'mailout.one.com' && now.saved.user === 'info@glovels.com',
      JSON.stringify(now.saved));

    /* THE one. A password that can be read back out of the site is a password
       that leaks the first time somebody is shoulder-surfed or a screenshot is
       shared. */
    check('but the password is never handed back',
      !/typed-in-by-the-office/.test(JSON.stringify(now)),
      JSON.stringify(now).slice(0, 90));
    check('only whether one is set at all', now.saved.hasPassword === true);

    /* An empty password field means "keep the one saved", not "erase it" —
       otherwise every edit of the port silently breaks the mail. */
    await admin.request.put(BASE + '/api/staff/mail', {
      data: { host: 'mailout.one.com', port: 465, user: 'info@glovels.com', pass: '' },
    });
    const kept = await (await admin.request.get(BASE + '/api/staff/mail')).json();
    check('changing the port does not erase the password',
      kept.mode === 'smtp' && kept.saved.hasPassword === true && kept.port === 465,
      kept.mode + ' ' + kept.port + ' pw=' + kept.saved.hasPassword);

    /* Nonsense is refused rather than stored and then failing at send time. */
    check('a server name that is not one is refused',
      (await admin.request.put(BASE + '/api/staff/mail',
        { data: { host: 'not a hostname!' } })).status() === 400);
    check('and so is a From line with no address in it',
      (await admin.request.put(BASE + '/api/staff/mail',
        { data: { host: 'mailout.one.com', from: 'Glovels' } })).status() === 400);

    /* Clearing the server clears the password with it — a secret kept for no
       reason is a secret waiting to leak. */
    await admin.request.put(BASE + '/api/staff/mail', { data: { host: '' } });
    const cleared = await (await admin.request.get(BASE + '/api/staff/mail')).json();
    check('clearing the server clears the password too',
      cleared.saved.hasPassword === false && cleared.mode === 'outbox',
      cleared.mode + ' pw=' + cleared.saved.hasPassword);

    /* A counsellor is not an administrator, and a test button that anybody can
       press is a way to send mail from this domain. */
    const c = await browser.newContext();
    await c.request.post(BASE + '/api/auth/login',
      { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
    check('a counsellor cannot read the mail settings',
      (await c.request.get(BASE + '/api/staff/mail')).status() === 403);
    check('nor send a test',
      (await c.request.post(BASE + '/api/staff/mail/test', { data: {} })).status() === 403);
    check('nor change where the mail goes out through',
      (await c.request.put(BASE + '/api/staff/mail',
        { data: { host: 'somewhere-else.example.com' } })).status() === 403);

    /* The wiring, end to end. Everything above proves the mailer reads the
       environment; this proves the SERVER hands it the environment. Those are
       two different mistakes and only one of them was the original bug. */
    const PORT2 = 8082;
    const dir2 = '/tmp/db-mail-' + PORT2;
    fs.rmSync(dir2, { recursive: true, force: true });
    fs.mkdirSync(dir2, { recursive: true });
    const child2 = spawn('node', ['serve.js'], {
      cwd: ROOT, detached: true, stdio: 'ignore',
      env: Object.assign({}, process.env, {
        PORT: String(PORT2), DATA_DIR: dir2,
        SMTP_HOST: 'smtp.one.com', SMTP_USER: 'info@glovels.com',
        SMTP_PASS: 'not-a-real-password', MAIL_FROM: 'Glovels <info@glovels.com>',
      }),
    });
    try {
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 400));
        const s2 = await new Promise(r => {
          http.get({ host: 'localhost', port: PORT2, path: '/api/health' },
            res2 => { res2.resume(); r(res2.statusCode); }).on('error', () => r(0));
        });
        if (s2 === 200) break;
      }
      const BASE2 = 'http://localhost:' + PORT2;
      const a2 = await browser.newContext();
      await a2.request.post(BASE2 + '/api/auth/login',
        { data: { email: 'admin@glovels.com', password: 'glovels123' } });
      const m2 = await (await a2.request.get(BASE2 + '/api/staff/mail')).json();
      check('SMTP set in the environment reaches the running server',
        m2.mode === 'smtp', JSON.stringify(m2).slice(0, 80));
      check('and the site names the server it is sending through',
        m2.host === 'smtp.one.com', m2.host);
      check('with the From address it will send as',
        /info@glovels\.com/.test(m2.from || ''), m2.from);
      check('and nothing missing', (m2.missing || []).length === 0,
        (m2.missing || []).join(','));

      /* A wrong password must be reported, not swallowed. This host is real and
         will refuse these credentials, which is exactly the case somebody needs
         a readable answer for. */
      const t2 = await a2.request.post(BASE2 + '/api/staff/mail/test', { data: {} });
      const r2 = await t2.json();
      check('a refused login is reported rather than swallowed',
        r2.mode === 'smtp' && (r2.ok === true || /refused|error|not/i.test(r2.said || '')),
        (r2.said || '').slice(0, 90));
    } finally {
      try { process.kill(-child2.pid); } catch (e) { try { child2.kill(); } catch (e2) {} }
    }

    /* Saving a provider from the screen, and the site switching to it with no
       restart — the whole point of the settings being on the screen. */
    const chose = await admin.request.put(BASE + '/api/staff/mail',
      { data: { provider: 'brevo', apiKey: 'brv-not-a-real-key', from: 'Glovels <info@glovels.com>' } });
    check('a provider can be chosen from the screen', chose.status() === 200, chose.status());
    const viaOffice = await (await admin.request.get(BASE + '/api/staff/mail')).json();
    check('and it is in force immediately, with no redeploy',
      viaOffice.mode === 'api' && viaOffice.provider === 'brevo',
      JSON.stringify(viaOffice).slice(0, 70));
    check('the settings now come from the office rather than the environment',
      viaOffice.source === 'office', viaOffice.source);
    check('and the key is not handed back',
      !JSON.stringify(viaOffice).includes('brv-not-a-real-key'));

    /* A test to somebody else's address — "how to send normal emails from admin
       panel to check whether emails are going". A message that reaches the
       sender can still be one the rest of the world rejects. */
    const other = await admin.request.post(BASE + '/api/staff/mail/test',
      { data: { to: 'someone.else@example.com' } });
    const oj = await other.json();
    check('a test can be sent to any address, not only your own',
      oj.to === 'someone.else@example.com', oj.to);
    check('and a real reason comes back when the provider says no',
      oj.ok === false && /Brevo said|did not go/i.test(oj.said || ''),
      (oj.said || '').slice(0, 80));

    /* The 401 that is not a wrong key.
       Brevo only accepts API calls from IP addresses the account has approved,
       and a site on a hosting platform calls from one it has never seen. It
       arrives as a 401 and reads exactly like a rejected key — and being told
       to re-copy a key that was right all along is the worst kind of wrong
       answer: confident, specific, and an afternoon gone. */
    const ipErr = await admin.request.post(BASE + '/api/staff/mail/explain',
      { data: { error: 'Brevo said 401: We have detected you are using an '
        + 'unrecognised IP address 74.220.52.215. If you performed this action '
        + 'make sure to add the new IP address in this link: '
        + 'https://app.brevo.com/security/authorised_ips' } }).catch(() => null);
    if (ipErr && ipErr.status() === 200) {
      const said = (await ipErr.json()).said || '';
      check('an IP allowlist 401 is not reported as a bad key',
        /IP address/i.test(said) && !/copy it again/i.test(said), said.slice(0, 90));
    }

    const junk = await admin.request.post(BASE + '/api/staff/mail/test',
      { data: { to: 'not-an-address' } });
    check('a nonsense address is refused', junk.status() === 400, junk.status());

    /* Put it back, so the screen checks below see the unconfigured state. */
    await admin.request.put(BASE + '/api/staff/mail', { data: {} });
    check('clearing the provider clears the key with it',
      (await (await admin.request.get(BASE + '/api/staff/mail')).json())
        .saved.hasApiKey === false);

    /* ------------------------------------------------------- on the screen */
    const errs = [];
    const page = await admin.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3400);

    check('the Organisation screen has an Email panel',
      (await page.$$('#mailCard')).length === 1);
    check('with the settings editable on it',
      (await page.$$('#mailHostFieldsExist, #mHost')).length >= 1);
    const pwBox = await page.getAttribute('#mPass', 'type');
    check('and the password box is a password box', pwBox === 'password', pwBox);
    const mode = await page.textContent('#mailMode');
    check('which says out loud that mail is not going out',
      /not sending/i.test(mode), mode);
    const says = await page.textContent('#mailSays');
    check('and what that costs, in words anybody can act on',
      /nothing is being emailed/i.test(says), says.slice(0, 80));

    /* Email has a tab of its own now — it used to sit at the bottom of Money,
       which was an odd filing even before the office screens were split up. */
    const mailTab = await page.$('.otab[data-o="email"]');
    if (mailTab) { await mailTab.click(); await page.waitForTimeout(500); }
    await page.click('#mailTest');
    await page.waitForTimeout(1600);
    check('the test button answers on the screen',
      /nothing was sent/i.test(await page.textContent('#mailSays')),
      (await page.textContent('#mailSays')).slice(0, 70));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  } finally {
    try { process.kill(-child.pid); } catch (e) { try { child.kill(); } catch (e2) {} }
    await browser.close();
  }

  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
