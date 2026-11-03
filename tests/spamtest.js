/**
 * Spam and abuse — the go-live test (3 Nov 2026).
 *
 * Boots its own server with the guard ON (as in production), fast lead clocks
 * (LEAD_MINUTE_MS=1000: a "minute" is a second) and a local HTTPS stand-in
 * for the browsers' push service, then attacks every public write route the
 * way a script would, and reads what the office would see afterwards:
 *
 *   the enquiry form flooded from one address, from rotating addresses, by
 *     robots, with the honeypot filled, with huge and rubbish bodies — and
 *     then a REAL student, on the same phone network as the spammer, still
 *     gets through (the budget is per person, not per address);
 *   one contact typed in from many addresses cannot be mail-bombed;
 *   the Apply-free form refuses robots like every other form, and raises a
 *     lead alert like every other form;
 *   sign-up: ten an hour from one address, case/space variants of one email
 *     are one account, welcome mail is budgeted;
 *   three hundred leads in a burst are a handful of combined pushes, one line
 *     in the feed when overdue, one escalation email — and an administrator
 *     archives them all in one request, after which they are out of the
 *     queue, the escalations and the marketing numbers;
 *   chat: five hundred parallel chats and a thousand messages into one, with
 *     the counsellor's screens still answering;
 *   a signed-in student cannot fill the disk — a per-student cap on files,
 *     megabytes and uploads an hour;
 *   search scraping trips the 30/150 caps with a human sentence, and the
 *     administrators can see and unblock it;
 *   the office's mail: what one hour of each flood would have sent.
 *
 *   node tests/spamtest.js            (SHOTS=/some/dir saves screenshots)
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8212);
const PUSH_PORT = PORT + 1;
const SHOTS = process.env.SHOTS || '';
const ok = [], bad = [], notes = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const note = s => notes.push(s);
const wait = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const BASE = 'http://localhost:' + PORT;
const uniq = () => crypto.randomBytes(4).toString('hex');
let TOKEN = '';

const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
/* Looks like a browser on one of our pages: a real UA, a language, our
   Origin and the page token — the floods here are a script written for THIS
   form, which the guard's robot checks do not catch and are not meant to. */
const call = (p, opts = {}) => new Promise(resolve => {
  const headers = Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9',
    Origin: BASE, Referer: BASE + '/' }, opts.headers || {});
  if (TOKEN && !opts.noToken) headers['X-Glv-T'] = TOKEN;
  const body = opts.body == null ? null : (typeof opts.body === 'string' || Buffer.isBuffer(opts.body) ? opts.body : JSON.stringify(opts.body));
  if (body != null) headers['Content-Length'] = Buffer.byteLength(body);
  const t0 = Date.now();
  const req = http.request({ host: 'localhost', port: PORT, path: p, method: opts.method || (body != null ? 'POST' : 'GET'), headers, agent }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out.slice(0, 300) }; }
      resolve({ status: res.statusCode, body: j, text: out, headers: res.headers, ms: Date.now() - t0 });
    });
  });
  req.on('error', e => resolve({ status: 0, body: { error: e.message }, headers: {}, ms: Date.now() - t0 }));
  if (body != null) req.write(body);
  req.end();
});
const login = async (email, pw = 'glovels123') => {
  const r = await call('/api/auth/login', { body: { email, password: pw } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};
const tally = rs => rs.reduce((t, r) => { t[r.status] = (t[r.status] || 0) + 1; return t; }, {});
const say = t => Object.entries(t).map(([k, v]) => k + '×' + v).join(' ');
async function pool(n, conc, fn) {
  const out = new Array(n); let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { const k = i++; out[k] = await fn(k); } }));
  return out;
}
const outbox = dir => (fs.existsSync(dir + '/outbox') ? fs.readdirSync(dir + '/outbox') : []);
const mailsTo = (dir, who) => outbox(dir).filter(f => f.includes(who));
const mailsMatching = (dir, re) => outbox(dir).filter(f => re.test(fs.readFileSync(dir + '/outbox/' + f, 'utf8')));

/* An SSE listener on /api/live, as a member of staff. */
function listen(cookie) {
  const events = [];
  const req = http.get({ host: 'localhost', port: PORT, path: '/api/live', headers: { Cookie: cookie, Accept: 'text/event-stream' } }, res => {
    let buf = '';
    res.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (/^event: (.*)$/m.exec(block) || [])[1];
        const data = (/^data: (.*)$/m.exec(block) || [])[1];
        if (ev) { try { events.push({ ev, data: JSON.parse(data) }); } catch (e) { events.push({ ev, data }); } }
      }
    });
  });
  req.on('error', () => {});
  return { events, close: () => req.destroy() };
}

(async () => {
  const dir = '/tmp/db-spam-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });

  /* The stand-in push service: self-signed HTTPS, counts POSTs per person. */
  execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout ' + dir + '/k.pem -out ' + dir + '/c.pem -days 1 -subj /CN=localhost 2>/dev/null');
  const hits = {};
  const pushSvc = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, (req, res) => {
    let n = 0; req.on('data', c => { n += c.length; });
    req.on('end', () => { const who = req.url.split('/').pop(); (hits[who] = hits[who] || []).push({ at: Date.now(), bytes: n }); res.writeHead(201); res.end(); });
  }).listen(PUSH_PORT);
  const pushes = who => (hits[who] || []).length;

  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: ['ignore', fs.openSync(dir + '/serve.log', 'a'), fs.openSync(dir + '/serve.log', 'a')],
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'on',
      /* A "minute" is a second and the SLA sweep runs every 3 s (every minute
         in production) — so a two-second flood crosses each SLA line in one
         or two sweeps, as it would in an hour of real time. */
      LEAD_MINUTE_MS: '1000', LEAD_SLA_TICK_MS: '3000', NODE_TLS_REJECT_UNAUTHORIZED: '0',
      /* Small caps so the disk test runs in seconds: 20 MB, 30 files, 25 uploads an hour. */
      MAX_STUDENT_MB: '20', MAX_STUDENT_FILES: '30', UPLOADS_HOUR: '25' }) });
  let browser = null;
  try {
    for (let i = 0; i < 150; i++) { await wait(400); if ((await call('/api/health')).status === 200) break; }
    await wait(1500);                                   // the first sweep seeds
    const home = await call('/');
    TOKEN = (/name="glv-t" content="([^"]+)"/.exec(home.text || '') || [])[1] || '';
    check('a public page carries the guard token', !!TOKEN);
    await wait(3200);                                   // a form within 3 s of the page is refused

    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const student = await login('student@glovels.com');
    check('the three demo accounts sign in', admin && kavya && student);

    /* devices, so pushes are real and countable */
    const keyFor = () => {
      const e = crypto.createECDH('prime256v1'); e.generateKeys();
      const b = x => Buffer.from(x).toString('base64url');
      return { p256dh: b(e.getPublicKey()), auth: b(crypto.randomBytes(16)) };
    };
    for (const [cookie, label] of [[admin, 'admin'], [kavya, 'kavya']]) {
      const r = await call('/api/push/subscribe', { headers: { Cookie: cookie }, body: { subscription: { endpoint: 'https://localhost:' + PUSH_PORT + '/push/' + label, keys: keyFor() } } });
      check(label + '’s phone is registered', r.status === 200, String(r.status));
    }
    const sseK = listen(kavya);
    await wait(500);

    /* Fast clocks: 6 s to first response, 16 s to escalate, 3 s burst window. */
    const put = await call('/api/staff/leads/sla', { method: 'PUT', headers: { Cookie: admin }, body: { firstMins: 6, escalateMins: 16, burstMins: 3 } });
    check('an administrator sets short SLAs for the test', put.status === 200, String(put.status));

    const enq = (i, hdr, extra) => call('/api/enquiries', { headers: Object.assign({ 'X-Forwarded-For': '203.0.113.7' }, hdr || {}),
      body: Object.assign({ name: 'Spam Bot ' + i, email: 'spam' + i + uniq() + '@mailinator.com', phone: '98' + String(10000000 + i).slice(-8),
        destination: 'Germany', consent: 'yes', message: 'buy cheap ' + i }, extra || {}) });

    /* ============================================ 1. the enquiry form */
    /* A spammer on a phone network sends a dozen; the student on the same
       network, a moment later, is not the spammer. (Before the fix the budget
       was six an hour per ADDRESS, and she saw his 429.) */
    let rs = await pool(12, 4, i => enq(900 + i, {}, { name: 'Nat Spammer ' + i }));
    let t = tally(rs);
    check('a dozen spam enquiries from one network address are all filed (the address is shared)', (t[200] || 0) === 12, say(t));
    let r = await enq(0, {}, { name: 'Real Student', email: 'real.student' + uniq() + '@gmail.com', phone: '9123456789', message: 'MS in Germany, intake 2027' });
    check('a REAL student on the SAME address as the spammer still gets through', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    r = await enq(0, {}, { name: 'Real Student', email: 'real.student' + uniq() + '@gmail.com', phone: '9123456789', message: 'forgot: intake 2027' });
    check('…and her correction a minute later', r.status === 200, String(r.status));
    rs = await pool(4, 1, i => enq(0, {}, { name: 'Real Student', email: 'real.student' + uniq() + '@gmail.com', phone: '9123456789', message: 'again ' + i }));
    check('…but a fourth from the same contact in the hour is refused', rs.some(x => x.status === 429) && rs[0].status === 200, say(tally(rs)));

    let mail0 = outbox(dir).length;
    let t0 = Date.now();
    rs = await pool(500, 20, i => enq(i));
    t = tally(rs);
    check('500 enquiries from one address, rotating contacts: at most 30 get in', (t[200] || 0) <= 30 && (t[429] || 0) >= 470, say(t));
    check('…answered in under 5 s', Date.now() - t0 < 5000, (Date.now() - t0) + ' ms');
    const r429 = rs.find(r => r.status === 429);
    check('the refusal is a sentence a person can act on, with the office number', r429 && /call us on \+91/.test(String(r429.body.error)), JSON.stringify(r429 && r429.body));
    const enqMail1 = outbox(dir).length - mail0;
    check('the flood sent at most 60 emails (two per accepted enquiry)', enqMail1 <= 60, enqMail1 + ' mails');
    note('500 enquiries from one address: ' + say(t) + ', ' + enqMail1 + ' emails would have gone');

    /* After 500 from one address the address itself is spent for the hour —
       the one trade-off here, and it is said out loud in the sentence. */
    r = await enq(0, { 'X-Forwarded-For': '49.37.10.10' }, { name: 'Another Student', email: 'another' + uniq() + '@gmail.com', phone: '9123456780' });
    check('a student on a different address gets through after the flood', r.status === 200, String(r.status));

    /* The same contact, typed in from thirty addresses: not thirty emails to them. */
    const victim = 'victim' + uniq() + '@gmail.com';
    rs = await pool(30, 5, i => enq(i, { 'X-Forwarded-For': '198.51.100.' + (i + 1) }, { name: 'Name ' + i, email: victim, phone: '9000000' + String(100 + i) }));
    t = tally(rs);
    const toVictim = mailsTo(dir, victim.replace('@', '@')).length;
    check('one email address sent from 30 addresses: a handful are filed, the rest refused', (t[200] || 0) <= 4 && (t[429] || 0) >= 26, say(t));
    check('…and the inbox gets at most four acknowledgements', toVictim <= 4, toVictim + ' mails to ' + victim);

    /* Robots, tokens, honeypot, bodies. */
    r = await enq(1, { 'User-Agent': 'python-requests/2.31', 'X-Forwarded-For': '198.51.101.1' });
    check('a scripted user agent is refused with a sentence', r.status === 403 && /browser/.test(String(r.body.error)), r.status + ' ' + JSON.stringify(r.body));
    r = await enq(1, { 'User-Agent': '', 'X-Forwarded-For': '198.51.101.2' });
    check('no user agent at all is refused', r.status === 403, String(r.status));
    r = await call('/api/enquiries', { noToken: true, headers: { 'X-Forwarded-For': '198.51.101.3' }, body: { name: 'A B', email: 'ab@x.com', phone: '9876543210', consent: 'yes' } });
    check('a post without the page token is told to reload', r.status === 403 && /reload/i.test(String(r.body.error)), String(r.status));
    r = await enq(1, { 'X-Forwarded-For': '198.51.101.4' }, { name: 'Honey Pot', phone: '9000099999', website: 'http://spam' });
    const leadsNow = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body;
    check('a filled honeypot is swallowed with a 200 and files nothing', r.status === 200 && !leadsNow.leads.some(l => l.name === 'Honey Pot'), String(r.status));
    r = await call('/api/enquiries', { headers: { 'X-Forwarded-For': '198.51.101.5' }, body: '{"name":"' + 'a'.repeat(200000) + '"}' });
    check('a 200 KB body is refused as too big', r.status === 413, String(r.status));
    r = await enq(1, { 'X-Forwarded-For': '198.51.101.6' }, { message: 'x'.repeat(10000) });
    check('a 10,000-character message is refused with the limit named', r.status === 422 && /2,000/.test(String(r.body.error)), String(r.status));
    let wn = 0;
    for (const weird of ['‮evil‬', '🙂🙂🙂 Rahul', '\x00\x01Ctrl', '<script>alert(1)</script>', 'Priya"; DROP TABLE enquiries;--']) {
      wn++;
      r = await enq(1, { 'X-Forwarded-For': '198.51.102.' + wn }, { name: weird, message: weird, destination: weird, note: weird, phone: '900011000' + wn });
      check('a name of ' + JSON.stringify(weird).slice(0, 24) + ' is refused by field', r.status === 422 && Array.isArray(r.body.fields), String(r.status));
    }
    r = await enq(1, { 'X-Forwarded-For': '198.51.103.1' }, { name: 'مرحبا علي', email: 'arabic' + uniq() + '@x.com', phone: '+971501234567' });
    check('a real name in another script is accepted', r.status === 200, String(r.status));
    r = await enq(1, { 'X-Forwarded-For': '198.51.103.2' }, { name: 'Ravi Kumar', email: 'ravi' + uniq() + '@x.com', phone: '9876501234', message: '<img src=x onerror=alert(1)>', destination: '<script>', sourcePage: '<script>', referrer: 'javascript:alert(1)' });
    check('HTML in the free-text fields is stored, not executed (the screens escape it)', r.status === 200, String(r.status));
    const leadHtml = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body.leads.find(l => l.name === 'Ravi Kumar');
    check('…and comes back as text in the API', !!leadHtml && /onerror/.test(JSON.stringify(leadHtml)), JSON.stringify(leadHtml || {}).slice(0, 120));

    /* ============================================ 2. Apply free (guest) */
    const cat = await call('/api/catalogue');
    const pid = (cat.body.programmes || cat.body.list || cat.body.rows || cat.body || [])[0];
    const progId = pid && pid.id;
    check('the catalogue has a programme to apply to', !!progId);
    mail0 = outbox(dir).length;
    rs = await pool(20, 5, i => call('/api/apply', { noToken: true, headers: { 'User-Agent': 'python-requests/2.0', 'X-Forwarded-For': '198.54.' + (i + 1) + '.1' },
      body: { id: progId, name: 'Apply Bot ' + i, email: 'ap' + i + uniq() + '@x.com', phone: '98765' + String(10000 + i).slice(-5) } }));
    t = tally(rs);
    check('Apply free refuses a script with no browser and no page token', (t[403] || 0) === 20, say(t));
    check('…and sends it no email', outbox(dir).length === mail0, (outbox(dir).length - mail0) + ' mails');
    const feedBefore = sseK.events.filter(x => x.ev === 'lead').length;
    r = await call('/api/apply', { headers: { 'X-Forwarded-For': '198.54.200.1' }, body: { id: progId, name: 'Genuine Applicant', email: 'genuine' + uniq() + '@gmail.com', phone: '9876599999' } });
    await wait(600);
    check('a person applying from the page is filed', r.status === 200 && r.body.applied === true, String(r.status));
    check('…and the office hears about it live, like any other lead', sseK.events.filter(x => x.ev === 'lead').length > feedBefore && sseK.events.some(x => x.ev === 'lead' && x.data.name === 'Genuine Applicant'));

    /* ============================================ 3. sign-up */
    mail0 = outbox(dir).length;
    rs = await pool(60, 10, i => call('/api/auth/signup', { headers: { 'X-Forwarded-For': '203.0.113.50' }, body: { name: 'Bot ' + i, email: 'acct' + i + uniq() + '@x.com', password: 'password123', terms: true } }));
    t = tally(rs);
    check('sign-up from one address stops at ten an hour', (t[200] || 0) === 10 && (t[429] || 0) === 50, say(t));
    check('…ten welcome emails, not sixty', outbox(dir).length - mail0 === 10, (outbox(dir).length - mail0) + ' mails');
    const base = 'Case.Variant' + uniq();
    rs = [];
    for (const e of [base + '@X.com', base.toLowerCase() + '@x.com', ' ' + base + '@x.com ', base.toUpperCase() + '@x.COM']) {
      rs.push(await call('/api/auth/signup', { headers: { 'X-Forwarded-For': '198.51.250.' + (rs.length + 1) }, body: { name: 'Case Variant', email: e, password: 'password123', terms: true } }));
    }
    check('case and space variants of one email are one account', rs.map(x => x.status).join(',') === '200,409,409,409', rs.map(x => x.status).join(','));
    r = await call('/api/auth/signup', { headers: { 'X-Forwarded-For': '198.51.250.9', 'User-Agent': 'curl/8.0' }, body: { name: 'Bot', email: 'bot' + uniq() + '@x.com', password: 'password123', terms: true } });
    check('a script cannot sign up', r.status === 403, String(r.status));
    /* The welcome-mail budget: 150 sign-ups from 150 addresses in one hour. */
    mail0 = outbox(dir).length;
    t0 = Date.now();
    rs = await pool(150, 10, i => call('/api/auth/signup', { headers: { 'X-Forwarded-For': '198.60.' + (i + 1) + '.1' }, body: { name: 'Bot ' + i, email: 'many' + i + uniq() + '@x.com', password: 'password123', terms: true } }));
    t = tally(rs);
    const welcomes = outbox(dir).length - mail0;
    check('150 sign-ups from 150 addresses all go through (the address is not the person)', (t[200] || 0) === 150, say(t) + ' in ' + (Date.now() - t0) + ' ms');
    check('…but the welcome mail stops at the hourly budget (40 a kind since go-live)', welcomes <= 40, welcomes + ' welcome mails');
    note('150 sign-ups from 150 addresses: ' + welcomes + ' welcome emails would have gone (budget 40/hour per kind)');

    /* forgot-password aimed at one inbox from everywhere */
    mail0 = outbox(dir).length;
    rs = await pool(40, 10, i => call('/api/auth/forgot', { headers: { 'X-Forwarded-For': '198.61.' + (i + 1) + '.1' }, body: { email: 'student@glovels.com' } }));
    t = tally(rs);
    check('forgot-password at one inbox from 40 addresses sends at most three', (t[200] || 0) <= 3 && outbox(dir).length - mail0 <= 3, say(t) + ', ' + (outbox(dir).length - mail0) + ' mails');

    /* ============================================ 4. the lead-alert flood */
    const pushK0 = pushes('kavya'), pushA0 = pushes('admin');
    const sse0 = sseK.events.filter(x => x.ev === 'lead' && x.data.kind === 'form').length;
    mail0 = outbox(dir).length;
    const floodT0 = Date.now();
    rs = await pool(300, 20, i => enq(i, { 'X-Forwarded-For': '198.62.' + Math.floor(i / 20 + 1) + '.' + (i % 20 + 1) }, { name: 'Flood Bot ' + i, email: 'flood' + i + uniq() + '@x.com', phone: '97' + String(10000000 + i).slice(-8) }));
    t = tally(rs);
    const floodIn = t[200] || 0;
    check('300 enquiries from 15 addresses (20 each) in a burst: all filed, in under 5 s', floodIn === 300 && Date.now() - floodT0 < 5000, say(t) + ' in ' + (Date.now() - floodT0) + ' ms');
    await wait(4500);                                   // the burst window closes
    const pushK = pushes('kavya') - pushK0;
    /* One push per burst window for the arrivals, plus one per sweep for
       earlier leads crossing the SLA line while this ran. */
    check('the counsellor’s phone buzzed a handful of times, not 300', pushK >= 1 && pushK <= 6, pushK + ' pushes');
    check('every lead reached the open screens live', sseK.events.filter(x => x.ev === 'lead' && x.data.kind === 'form').length - sse0 >= 300);
    const floodMail = outbox(dir).length - mail0;
    check('the flood’s email is bounded by the hourly budget (≤ 240 for 300 leads × 2)', floodMail <= 240, floodMail + ' mails');
    note('300 enquiries from 15 addresses: ' + floodIn + ' filed, ' + pushK + ' pushes to a counsellor, ' + floodMail + ' emails would have gone');
    let cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    check('the command centre answers with 300+ waiting in under 5 s', cmd.kpis && cmd.kpis.waiting >= 300, JSON.stringify(cmd.kpis).slice(0, 120));
    const cmdMs = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).ms;
    check('…quickly', cmdMs < 5000, cmdMs + ' ms');

    /* first-response alerts at 6 s (the last of the flood was filed ~2 s in,
       and the sweep that sees it runs within 3 s of that) */
    await wait(Math.max(0, floodT0 + 11500 - Date.now()));
    const pushK1 = pushes('kavya') - pushK0 - pushK;
    cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    const overdueRows = cmd.feed.filter(f => f.kind === 'overdue');
    const overdueCounted = overdueRows.reduce((n, f) => n + (f.count || 1), 0);
    /* The sweep runs every half-second here, so a two-second flood crosses
       the line in a few sweeps rather than one; in production the sweep is a
       minute and a flood is one line. */
    check('"nobody has called" for 300 leads is a combined push per sweep, not 300', pushK1 >= 1 && pushK1 <= 4, pushK1 + ' pushes');
    check('…and a few combined lines in the feed, not 300', overdueRows.length >= 1 && overdueRows.length <= 12 && overdueCounted >= 290, overdueRows.length + ' rows for ' + overdueCounted + ' leads; ' + JSON.stringify(overdueRows.slice(0, 1)));
    const arriveRows = cmd.feed.filter(f => f.kind === 'form' && /Flood Bot/.test(f.name || ''));
    check('the 300 arrivals did not drown the feed either', arriveRows.length <= 16 && cmd.feed.some(f => f.combined && f.count >= 100), arriveRows.length + ' single rows; combined ' + JSON.stringify((cmd.feed.find(f => f.combined && f.count >= 100) || {}).name));
    check('the KPIs say so', cmd.kpis.overdue >= 200, JSON.stringify(cmd.kpis).slice(0, 160));

    /* the administrator archives the flood in one request — before escalation */
    const book = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body;
    check('the Leads list says how many there are, not just the 500 it shows', typeof book.total === 'number' && book.total >= book.leads.length, 'total ' + book.total + ', shown ' + book.leads.length);
    const spamIds = book.leads.filter(l => /^(Flood|Spam) Bot|^Nat Spammer/.test(l.name)).map(l => l.id);
    const keep = book.leads.filter(l => /^(Real|Another) Student$/.test(l.name)).map(l => l.id);
    check('the real students are in the book', keep.length === 2, keep.length + ' kept');
    r = await call('/api/staff/leads/archive-many', { headers: { Cookie: kavya }, body: { ids: spamIds.slice(0, 2) } });
    check('a counsellor may not bulk-archive', r.status === 403, String(r.status));
    r = await call('/api/staff/leads/archive-many', { headers: { Cookie: student }, body: { ids: spamIds.slice(0, 2) } });
    check('nor a student', r.status === 403, String(r.status));
    t0 = Date.now();
    r = await call('/api/staff/leads/archive-many', { headers: { Cookie: admin }, body: { ids: spamIds, why: 'spam flood' } });
    check('an administrator archives ' + spamIds.length + ' leads in one request', r.status === 200 && r.body.archived === spamIds.length, r.status + ' ' + JSON.stringify(r.body));
    check('…in under 5 s', Date.now() - t0 < 5000, (Date.now() - t0) + ' ms');
    cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    check('the queue is back to the real leads', cmd.kpis.waiting < 20 && cmd.queue.every(q => !/Bot/.test(q.name)), 'waiting ' + cmd.kpis.waiting);
    const arch = (await call('/api/staff/leads?archived=1', { headers: { Cookie: admin } })).body;
    check('they are under the Archived filter with the reason on each', arch.leads.length >= spamIds.length - 0 && arch.archivedCount >= spamIds.length, arch.archivedCount + ' archived');
    const one = (await call('/api/staff/lead/' + spamIds[0], { headers: { Cookie: admin } })).body;
    check('…as a note', JSON.stringify(one).includes('spam flood'), JSON.stringify(one).slice(0, 100));

    /* escalation at 16 s: only what is still in the book */
    const escMailsBefore = mailsMatching(dir, /Subject: Escalation/).length;
    check('the flood was archived before it could escalate', Date.now() - floodT0 < 16000, (Date.now() - floodT0) + ' ms after the flood');
    await wait(Math.max(0, floodT0 + 22000 - Date.now()));
    cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    const escMails = mailsMatching(dir, /Subject: Escalation/);
    check('the archived flood is not escalated — the KPIs count only the real leads', cmd.kpis.escalated >= 1 && cmd.kpis.escalated < 20, 'escalated ' + cmd.kpis.escalated);
    check('no escalation email names a Flood Bot', !escMails.some(f => /Flood Bot/.test(fs.readFileSync(dir + '/outbox/' + f, 'utf8'))), escMails.length + ' escalation mails');
    check('escalation emails are at most one per administrator per ten minutes', escMails.length - escMailsBefore <= 1, (escMails.length - escMailsBefore) + ' since the flood');
    const pushA = pushes('admin') - pushA0;
    check('the administrator’s phone: a handful of pushes for the whole episode', pushA <= 12, pushA + ' pushes');
    note('alert flood: counsellor pushes ' + (pushes('kavya') - pushK0) + ', admin pushes ' + pushA + ', escalation emails ' + escMails.length);

    /* marketing: archived spam is not a lead */
    const mk = (await call('/api/marketing/report?days=30', { headers: { Cookie: admin } })).body;
    const bookNow = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body;
    check('the marketing report counts the book, not the archived spam', mk.totals && mk.totals.leads <= bookNow.total + 2 && mk.totals.leads < 100, 'report ' + (mk.totals && mk.totals.leads) + ' vs book ' + bookNow.total);

    /* ============================================ 5. the chat widget */
    mail0 = outbox(dir).length;
    const pushK2 = pushes('kavya');
    const chatT0 = Date.now();
    rs = await pool(500, 25, i => call('/api/chat/start', { headers: { 'X-Forwarded-For': '198.63.' + (i % 250 + 1) + '.' + (i % 100 + 1) }, body: { name: 'Chat Bot ' + i, contact: 'cb' + i + uniq() + '@x.com', page: '/' } }));
    t = tally(rs);
    const chatSecs = (Date.now() - chatT0) / 1000;
    const cookies = rs.filter(x => x.status === 200).map(x => String((x.headers['set-cookie'] || [])[0] || '').split(';')[0]).filter(Boolean);
    check('500 parallel chats from 500 addresses are all opened', (t[200] || 0) === 500, say(t) + ' in ' + chatSecs.toFixed(1) + ' s');
    await wait(4000);
    /* One combined email and one push per 3 s window here (2 min in
       production), plus one push per 3 s sweep as they cross the SLA line. */
    const windows = Math.ceil(chatSecs / 3) + 2;
    check('…the office got one combined email per burst window, not 500', outbox(dir).length - mail0 <= windows, (outbox(dir).length - mail0) + ' mails for ' + windows + ' windows');
    check('…and one push per window and per sweep', pushes('kavya') - pushK2 <= 2 * windows, (pushes('kavya') - pushK2) + ' pushes');
    note('500 chats in ' + chatSecs.toFixed(1) + ' s: ' + (outbox(dir).length - mail0) + ' office emails, ' + (pushes('kavya') - pushK2) + ' pushes (one per burst window)');
    rs = await pool(12, 4, i => call('/api/chat/start', { headers: { 'X-Forwarded-For': '198.64.0.1' }, body: { name: 'One IP ' + i, contact: 'oneip' + i + uniq() + '@x.com' } }));
    t = tally(rs);
    check('one address opens three chats an hour, then 429', (t[200] || 0) === 3 && (t[429] || 0) === 9, say(t));
    rs = await pool(1000, 20, i => call('/api/chat/send', { headers: { Cookie: cookies[0], 'X-Forwarded-For': '198.63.1.1' }, body: { body: 'spam ' + i } }));
    t = tally(rs);
    check('1,000 messages into one chat: 120 a minute, the rest 429', (t[200] || 0) <= 120 && (t[429] || 0) >= 880, say(t));
    r = await call('/api/chat/send', { headers: { Cookie: cookies[1], 'X-Forwarded-For': '198.63.1.2' }, body: { body: 'y'.repeat(2500) } });
    const lastMsg = r.body && r.body.messages ? r.body.messages[r.body.messages.length - 1] : null;
    check('a 2,500-character chat message is cut at 2,000', r.status === 200 && lastMsg && String(lastMsg.t || lastMsg.body || '').length === 2000, r.status + ' ' + (lastMsg && String(lastMsg.t || lastMsg.body || '').length));
    const open = [];
    for (let i = 0; i < 300; i++) {
      const q = http.get({ host: 'localhost', port: PORT, path: '/api/chat/live', headers: { Cookie: cookies[i], Accept: 'text/event-stream' } }, res => { res.on('data', () => {}); });
      q.on('error', () => {}); open.push(q);
    }
    await wait(1500);
    r = await call('/api/health'); check('300 open chat streams: the server still answers at once', r.status === 200 && r.ms < 1000, r.ms + ' ms');
    r = await call('/api/staff/chats', { headers: { Cookie: kavya } }); check('the counsellor’s chat list opens in under 5 s', r.status === 200 && r.ms < 5000, r.ms + ' ms, ' + ((r.body.chats || []).length) + ' chats');
    r = await call('/api/staff/leads/command', { headers: { Cookie: kavya } }); check('…and the command centre', r.status === 200 && r.ms < 5000, r.ms + ' ms');
    r = await call('/api/staff/command', { headers: { Cookie: admin } }); check('…and /ops', r.status === 200 && r.ms < 5000, r.ms + ' ms');
    open.forEach(q => q.destroy());
    r = await call('/api/staff/chat/' + ((await call('/api/staff/chats', { headers: { Cookie: kavya } })).body.chats || [{}])[0].id + '/reply', { headers: { Cookie: kavya }, body: { body: 'z'.repeat(2500) } });
    check('a counsellor’s reply is cut at 2,000 as well', r.status === 200 && r.body.chat && r.body.chat.messages.slice(-1)[0] && String(r.body.chat.messages.slice(-1)[0].t || r.body.chat.messages.slice(-1)[0].body || '').length === 2000, String(r.status));
    r = await call('/api/messages', { headers: { Cookie: student }, body: { body: 'q'.repeat(5001) } });
    check('a student’s portal message over 5,000 is refused, not cut', r.status === 422, String(r.status));

    /* ============================================ 6. documents */
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024, 0x41)]);
    const up = (cookie, name, buf, key = 'other', route = '/api/documents') => {
      const bd = '----glv' + uniq();
      const head = Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="key"\r\n\r\n' + key + '\r\n--' + bd + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
      return call(route, { headers: { Cookie: cookie, 'Content-Type': 'multipart/form-data; boundary=' + bd }, body: Buffer.concat([head, buf, Buffer.from('\r\n--' + bd + '--\r\n')]) });
    };
    const du = () => { try { return Number(execSync('du -sk ' + dir + '/uploads 2>/dev/null').toString().split('\t')[0]); } catch (e) { return 0; } };
    const student2 = (await call('/api/auth/signup', { headers: { 'X-Forwarded-For': '198.70.0.1' }, body: { name: 'Disk Filler', email: 'disk' + uniq() + '@x.com', password: 'password123', terms: true } }));
    const filler = String((student2.headers['set-cookie'] || [])[0] || '').split(';')[0];
    check('a fresh account signs up for the disk test', student2.status === 200 && !!filler);
    rs = await pool(30, 5, i => up(filler, 'scan' + i + '.pdf', pdf));
    t = tally(rs);
    const refused = rs.find(x => x.status === 429);
    check('30 × 1 MB in a minute from one student: the cap holds (20 MB / 25 an hour here)', (t[200] || 0) <= 20 && (t[429] || 0) >= 10, say(t));
    check('…with a sentence, not a stack', refused && /MB|uploads/.test(String(refused.body.error)) && refused.body.storage === true, JSON.stringify(refused && refused.body));
    const kb = du();
    check('the disk under uploads is bounded (≤ 32 MB for everything so far)', kb <= 32 * 1024, kb + ' KB');
    r = await up(filler, 'shared.pdf', pdf, '', '/api/messages/attach');
    check('…and the chat attachment route counts against the same cap', r.status === 429, String(r.status));
    r = await up(student, 'big.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(12 * 1024 * 1024)]), 'passport');
    check('a 12 MB file is refused as too big', r.status === 413, String(r.status));
    r = await up(student, 'evil.pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'passport');
    check('an HTML file renamed .pdf is refused by its bytes', r.status === 415, r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
    r = await up(student, 'evil.html', Buffer.from('<html></html>'), 'other');
    check('an .html is refused by its name', r.status === 415, String(r.status));
    const fid = student2.body && student2.body.user && student2.body.user.id;
    r = await call('/api/staff/student/' + fid, { headers: { Cookie: admin } });
    check('the counsellor’s view of the filler’s file opens in under 5 s', r.status === 200 && r.ms < 5000, r.status + ' ' + r.ms + ' ms');

    /* ============================================ 7. search scraping */
    let gl = '', codes = [];
    for (let i = 0; i < 35; i++) {
      r = await call('/api/find/match?country=DE&level=masters&q=term' + i, { headers: { Cookie: gl, 'X-Forwarded-For': '198.80.0.1' } });
      const sc = (r.headers['set-cookie'] || []).find(c => /^gl_v=/.test(c)); if (sc) gl = sc.split(';')[0];
      codes.push(r.status);
    }
    const first401 = codes.indexOf(401);
    check('a visitor’s 31st search asks them to sign in', first401 === 30 && /Sign in/.test(String(r.body.error)), first401 + ' ' + JSON.stringify(r.body));
    gl = ''; codes = [];
    for (let i = 0; i < 25 && !codes.includes(429); i++) {
      r = await call('/api/find/match?country=' + ['DE', 'UK', 'US', 'CA', 'AU'][i % 5] + '&level=' + ['bachelors', 'masters'][i % 2] + '&field=' + ['eng', 'bus', 'cs', 'med', 'art'][Math.floor(i / 5)], { headers: { Cookie: gl, 'X-Forwarded-For': '198.80.0.2' } });
      const sc = (r.headers['set-cookie'] || []).find(c => /^gl_v=/.test(c)); if (sc) gl = sc.split(';')[0];
      codes.push(r.status);
    }
    check('walking the catalogue (18 destination/subject combinations) is blocked for 24 h with a sentence', codes.includes(429) && /paused/.test(String(r.body.error)), codes.length + ' searches: ' + JSON.stringify(r.body));
    codes = [];
    for (let i = 0; i < 155; i++) { r = await call('/api/find/match?country=DE&level=masters&q=s' + i, { headers: { Cookie: student, 'X-Forwarded-For': '198.80.0.3' } }); codes.push(r.status); }
    check('a signed-in student’s 151st search is refused with a sentence, not a stack', codes.indexOf(429) === 150 && /150 searches/.test(String(r.body.error)), codes.indexOf(429) + ' ' + JSON.stringify(r.body));
    r = await call('/api/staff/search-activity', { headers: { Cookie: admin } });
    const blocked = (r.body.guard || {}).blocked || [];
    check('the administrators see the blocked scraper and the busy account', r.status === 200 && blocked.length >= 1 && (r.body.accounts || []).some(a => a.searches >= 150), blocked.length + ' blocked, ' + (r.body.accounts || []).length + ' accounts');
    r = await call('/api/staff/search-activity/unblock', { headers: { Cookie: admin }, body: { key: blocked[0] && blocked[0].key } });
    check('…and can unblock it', r.status === 200 && r.body.unblocked >= 1, JSON.stringify(r.body));
    r = await call('/api/find/match?country=DE', { headers: { 'User-Agent': 'Scrapy/2.11', 'X-Forwarded-For': '198.80.0.4' } });
    check('a crawler gets nothing from the search API', r.status === 403, String(r.status));
    r = await call('/api/staff/search-activity', { headers: { Cookie: kavya } });
    check('a counsellor may not see the search activity', r.status === 403, String(r.status));

    /* ============================================ 8. the mail bill */
    const all = outbox(dir);
    const byKind = {};
    all.forEach(f => { const s = (/^Subject: (.*)$/m.exec(fs.readFileSync(dir + '/outbox/' + f, 'utf8')) || [])[1] || '?'; const k = s.replace(/=\?UTF-8\?B\?.*/, 'enc').replace(/[0-9]+/g, '#').slice(0, 50); byKind[k] = (byKind[k] || 0) + 1; });
    note('mail that would have gone in this whole run: ' + all.length + ' — ' + Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => v + ' × "' + k + '"').join(', '));
    check('the whole run stayed under 600 emails', all.length < 600, all.length + ' mails');

    /* ============================================ 9. the screens */
    if (SHOTS) {
      const { chromium } = require('playwright');
      browser = await chromium.launch();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const [name, value] = admin.split('=');
      await ctx.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const p of ['leads-command', 'leads', 'marketing', 'ops']) {
        const t1 = Date.now();
        await pg.goto(BASE + '/' + p, { waitUntil: 'domcontentloaded' });
        await wait(2500);
        await pg.screenshot({ path: path.join(SHOTS, 'spam-' + p + '.png'), fullPage: false });
        check('/' + p + ' draws after the floods with no script error', errs.length === 0 && Date.now() - t1 < 10000, errs.join(' | ').slice(0, 120));
      }
      /* the Archive-shown button on the Leads page, as the administrator */
      await pg.goto(BASE + '/leads', { waitUntil: 'domcontentloaded' });
      await pg.waitForSelector('#leadRows tr', { timeout: 8000 });
      const btn = await pg.$('#archiveShown');
      check('the administrator sees "Archive shown" on the Leads page', !!btn && !(await btn.isHidden()));
      await pg.fill('#fQ', 'Chat Bot');
      await wait(400);
      const label = await pg.$eval('#archiveShown', el => el.textContent);
      check('…counting what the filters show', /Archive shown \(\d+\)/.test(label) && Number(/\((\d+)\)/.exec(label)[1]) >= 400, label);
      pg.on('dialog', d => d.accept('spam'));
      await pg.click('#archiveShown');
      await wait(2500);
      await pg.screenshot({ path: path.join(SHOTS, 'spam-leads-after-archive.png') });
      const after = (await call('/api/staff/leads?archived=1', { headers: { Cookie: admin } })).body;
      check('one press archives every chat-bot lead', after.leads.filter(l => /^Chat Bot/.test(l.name)).length >= 400, after.leads.filter(l => /^Chat Bot/.test(l.name)).length + ' archived');
      const kctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const [kn, kv] = kavya.split('=');
      await kctx.addCookies([{ name: kn, value: kv, domain: 'localhost', path: '/' }]);
      const kp = await kctx.newPage();
      await kp.goto(BASE + '/leads', { waitUntil: 'domcontentloaded' });
      await kp.waitForSelector('#leadRows', { timeout: 8000 });
      await wait(1000);
      check('a counsellor does not see the bulk Archive button', await kp.$eval('#archiveShown', el => el.hidden));
    }
  } catch (e) {
    bad.push('the suite died: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { process.kill(-child.pid); } catch (e) { try { child.kill(); } catch (e2) {} }
    pushSvc.close();
  }
  console.log('\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) console.log('\n' + bad.map(x => '  ✗ ' + x).join('\n'));
  if (notes.length) console.log('\n' + notes.map(x => '  · ' + x).join('\n'));
  console.log('\n  ' + ok.length + ' passed, ' + bad.length + ' failed\n');
  process.exit(bad.length ? 1 : 0);
})();
