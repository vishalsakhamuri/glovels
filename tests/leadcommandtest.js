/**
 * Patch 221: the Leads command centre and the lead watch.
 *
 * Boots its own server on a fresh database with fast clocks
 * (LEAD_MINUTE_MS=1000: one "minute" is a second) and a local HTTPS server
 * standing in for the browsers' push service, so every web push the server
 * sends is really encrypted, really POSTed and counted per person. Checks:
 *
 *   an enquiry reaches every staff screen live (SSE 'lead') and every
 *   caseworker's device (a push per counsellor and administrator);
 *   a burst is combined; a chat start and a visitor's message alert too;
 *   a lead nobody calls re-alerts once at the first-response SLA and
 *   escalates once to the administrators — not again on later sweeps;
 *   the page draws its KPIs and queue at 1280 and 390 with no script errors;
 *   Mark called takes the lead off the queue;
 *   the SLA settings are an administrator's; a student gets 403, nobody 401.
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8221;
const PUSH_PORT = 8922;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
let ipN = 10;
const ip = () => '203.0.113.' + (ipN++);           // a fresh address per form — the six-an-hour limit

const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts && opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const login = async email => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};
const enquire = (name, phone, extra) => call('/api/enquiries', { method: 'POST', headers: { 'X-Forwarded-For': ip() },
  body: Object.assign({ name, phone, email: name.toLowerCase().replace(/\s+/g, '.') + '@mail.test', destination: 'Germany', consent: 'yes' }, extra || {}) });

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
  const dir = '/tmp/db-leadcmd-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });

  /* The stand-in push service: self-signed HTTPS, counts POSTs per path. */
  execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout ' + dir + '/k.pem -out ' + dir + '/c.pem -days 1 -subj /CN=localhost 2>/dev/null');
  const hits = {};
  const pushSvc = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, (req, res) => {
    let n = 0; req.on('data', c => { n += c.length; });
    req.on('end', () => {
      const who = req.url.split('/').pop();
      (hits[who] = hits[who] || []).push({ at: Date.now(), bytes: n, enc: req.headers['content-encoding'], auth: /^vapid /.test(req.headers.authorization || '') });
      res.writeHead(201); res.end();
    });
  }).listen(PUSH_PORT);

  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', UNLOCK_UNPAID: 'on',
      LEAD_MINUTE_MS: '1000', LEAD_SLA_TICK_MS: '500', NODE_TLS_REJECT_UNAUTHORIZED: '0' }) });
  let browser = null;
  try {
    for (let i = 0; i < 60; i++) { await wait(400); if ((await call('/api/health')).status === 200) break; }
    await wait(1500);                       // the first sweep runs (and seeds) at start-up

    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const student = await login('student@glovels.com');

    /* ------------------------------------------------------ permissions */
    check('nobody signed in gets 401', (await call('/api/staff/leads/command')).status === 401);
    check('a student gets 403', (await call('/api/staff/leads/command', { headers: { Cookie: student } })).status === 403);
    check('a counsellor may read the board', (await call('/api/staff/leads/command', { headers: { Cookie: kavya } })).status === 200);
    check('a counsellor may not read the lead SLAs', (await call('/api/staff/leads/sla', { headers: { Cookie: kavya } })).status === 403);
    check('a counsellor may not change them', (await call('/api/staff/leads/sla', { method: 'PUT', headers: { Cookie: kavya }, body: { firstMins: 1 } })).status === 403);
    const defaults = await call('/api/staff/leads/sla', { headers: { Cookie: admin } });
    check('defaults: 15 min first response, 60 min escalation, 2 min burst',
      defaults.body.settings && defaults.body.settings.firstMins === 15 && defaults.body.settings.escalateMins === 60 && defaults.body.settings.burstMins === 2,
      JSON.stringify(defaults.body.settings));
    check('escalation before first response is refused', (await call('/api/staff/leads/sla', { method: 'PUT', headers: { Cookie: admin }, body: { firstMins: 30, escalateMins: 20 } })).status === 422);

    /* Short clocks for the test: 8 s to first response, 12 s to escalate,
       a 3 s burst window. */
    const put = await call('/api/staff/leads/sla', { method: 'PUT', headers: { Cookie: admin }, body: { firstMins: 8, escalateMins: 12, burstMins: 3 } });
    check('an administrator sets the SLAs', put.status === 200 && put.body.settings.firstMins === 8, JSON.stringify(put.body));

    /* ---------------------------------------- every caseworker's device */
    const board0 = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    const team = board0.board.filter(b => b.id).map(b => b.id);
    check('the team is every counsellor and administrator', team.length >= 2, JSON.stringify(team));
    const keyFor = () => {
      const e = crypto.createECDH('prime256v1'); e.generateKeys();
      const b = x => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return { p256dh: b(e.getPublicKey()), auth: b(crypto.randomBytes(16)) };
    };
    for (const [cookie, label] of [[admin, 'admin'], [kavya, 'kavya']]) {
      const r = await call('/api/push/subscribe', { method: 'POST', headers: { Cookie: cookie },
        body: { subscription: { endpoint: 'https://localhost:' + PUSH_PORT + '/push/' + label, keys: keyFor() } } });
      check(label + '’s device is registered', r.status === 200, String(r.status));
    }

    const sseA = listen(admin), sseK = listen(kavya);
    await wait(600);

    /* --------------------------------------------------- a form arrives */
    const t0 = Date.now();
    const e1 = await enquire('Priya Sharma', '9811100001');
    check('the enquiry is accepted', e1.status === 200, JSON.stringify(e1.body));
    await wait(1200);
    const live1 = sseA.events.filter(x => x.ev === 'lead' && x.data.name === 'Priya Sharma' && x.data.kind === 'form');
    check('a live "lead" event reaches the admin’s screen', live1.length === 1, JSON.stringify(sseA.events.map(x => x.ev + ':' + (x.data.kind || ''))));
    check('and the counsellor’s', sseK.events.some(x => x.ev === 'lead' && x.data.name === 'Priya Sharma'));
    check('a push reached the admin’s device, encrypted and signed', (hits.admin || []).length === 1 && hits.admin[0].enc === 'aes128gcm' && hits.admin[0].auth,
      JSON.stringify(hits.admin));
    check('a push reached the counsellor’s device', (hits.kavya || []).length === 1, JSON.stringify(hits.kavya));
    let cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    const f1 = cmd.feed.find(f => f.kind === 'form' && f.name === 'Priya Sharma');
    check('the feed records who was alerted: every caseworker', f1 && team.every(id => f1.pushedTo.includes(id)), JSON.stringify(f1));
    const priya = cmd.queue.find(q => q.name === 'Priya Sharma');
    check('Priya is at the top of "Needs a call now"', priya && priya.type === 'first' && priya.channel === 'form', JSON.stringify(priya));

    /* --------------------------------------------------- a burst is one */
    await enquire('Ravi Kumar', '9811100002');
    await enquire('Meena Iyer', '9811100003');
    await wait(400);
    check('inside the window nothing more is pushed yet', (hits.admin || []).length === 1, String((hits.admin || []).length));
    await wait(3200);
    check('the burst arrives as ONE combined push per person', (hits.admin || []).length === 2 && (hits.kavya || []).length === 2,
      (hits.admin || []).length + '/' + (hits.kavya || []).length);
    cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    check('both burst leads are logged as combined', ['Ravi Kumar', 'Meena Iyer'].every(n => cmd.feed.some(f => f.name === n && f.kind === 'form')));

    /* ---------------------------------------------- a website chat starts */
    const guest = await chromium.launch();
    browser = guest;
    const gctx = await guest.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': ip() } });
    const st = await gctx.request.post('http://localhost:' + PORT + '/api/chat/start', { data: { name: 'Anjali Rao', contact: '9811100004', page: '/' } });
    check('a visitor starts a chat', st.status() === 200, String(st.status()));
    await gctx.request.post('http://localhost:' + PORT + '/api/chat/send', { data: { body: 'Do I need IELTS for Germany?' } });
    await wait(800);
    check('the chat start is a live lead event', sseA.events.some(x => x.ev === 'lead' && x.data.kind === 'chat' && x.data.name === 'Anjali Rao'));
    check('and the visitor’s message', sseA.events.some(x => x.ev === 'lead' && x.data.kind === 'chat-msg' && /IELTS/.test(x.data.text)));

    /* -------------------------------------------- escalation fires once */
    await wait(Math.max(0, t0 + 14500 - Date.now()));
    cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    const firstFor = cmd.feed.filter(f => f.kind === 'overdue' && f.name === 'Priya Sharma');
    const escFor = cmd.feed.filter(f => f.kind === 'escalated' && f.name === 'Priya Sharma');
    check('"Nobody has called Priya yet" went out once', firstFor.length === 1, JSON.stringify(cmd.feed.map(f => f.kind + ':' + f.name)));
    check('the escalation went out once, to the administrators', escFor.length === 1 && escFor[0].pushedTo.length >= 1
      && escFor[0].pushedTo.every(id => id !== cmd.board.find(b => /Kavya/.test(b.name)).id), JSON.stringify(escFor));
    check('the live screens heard the escalation', sseA.events.some(x => x.ev === 'lead' && x.data.kind === 'escalated' && x.data.name === 'Priya Sharma'));
    check('the KPIs count it overdue', cmd.kpis.overdue >= 1 && cmd.kpis.escalated >= 1, JSON.stringify(cmd.kpis));
    const pushesBefore = (hits.admin || []).length;
    await wait(2500);                                        // several more sweeps
    cmd = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    check('later sweeps say nothing again', cmd.feed.filter(f => f.kind === 'escalated' && f.name === 'Priya Sharma').length === 1
      && cmd.feed.filter(f => f.kind === 'overdue' && f.name === 'Priya Sharma').length === 1 && (hits.admin || []).length === pushesBefore,
      (hits.admin || []).length + ' vs ' + pushesBefore);
    const outbox = fs.existsSync(dir + '/outbox') ? fs.readdirSync(dir + '/outbox') : [];
    check('the administrators were emailed the escalation', outbox.some(f => /admin@glovels\.com/.test(f) && /Escalation/.test(fs.readFileSync(dir + '/outbox/' + f, 'utf8'))),
      outbox.join(','));
    check('the office was emailed about the chat', outbox.some(f => /Website chat/.test(fs.readFileSync(dir + '/outbox/' + f, 'utf8'))));

    /* the main command centre shows it too */
    const ops = await call('/api/staff/command', { headers: { Cookie: admin } });
    check('the command centre carries "Leads waiting"', ops.body.leadWatch && ops.body.leadWatch.waiting >= 3 && ops.body.leadWatch.overdue >= 1,
      JSON.stringify(ops.body.leadWatch));

    /* ------------------------------------------------------- the page */
    const errs = [];
    const ctx = await guest.newContext({ viewport: { width: 1280, height: 900 } });
    const [name, value] = admin.split('=');
    await ctx.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|favicon/.test(m.text())) errs.push(m.text()); });
    await pg.goto('http://localhost:' + PORT + '/leads-command', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#queue .qc', { timeout: 8000 });
    check('eight KPI tiles at 1280', (await pg.$$('#tiles .tile')).length === 8);
    check('the overdue tile is red', await pg.$eval('#tiles [data-tile="overdue"]', el => el.classList.contains('bad')));
    check('the queue lists Priya with her SLA chip', await pg.$$eval('#queue .qc', els => els.some(e => /Priya Sharma/.test(e.textContent) && e.querySelector('.sla .big.escalated'))));
    check('tap-to-call and WhatsApp buttons', await pg.$$eval('#queue .qc', els => els.every(e => !e.querySelector('a[href^="tel:"]') || e.querySelector('a[href^="https://wa.me/"]'))) && (await pg.$$('#queue a.act.call[href^="tel:"]')).length >= 3);
    check('the board has the team', (await pg.$$('#crew tr[data-cid]')).length === team.length + 1);
    await pg.waitForFunction(() => document.getElementById('live').classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
    check('the page is live (SSE connected)', await pg.$eval('#live', el => el.classList.contains('on')));
    check('the menu offers Leads command under Leads', await pg.$$eval('.nav a', as => { const i = as.findIndex(a => a.getAttribute('href') === 'leads.html'); return as[i + 1] && as[i + 1].getAttribute('href') === 'leads-command.html'; }));
    /* a new lead arrives while the page is open */
    await enquire('Live Arrival', '9811100009');
    await pg.waitForFunction(() => /Live Arrival/.test(document.getElementById('feed').textContent), null, { timeout: 6000 }).catch(() => {});
    check('the live feed updates without a reload', /Live Arrival/.test(await pg.textContent('#feed')));
    await pg.waitForFunction(() => /Live Arrival/.test(document.getElementById('queue').textContent), null, { timeout: 6000 }).catch(() => {});
    check('and the queue picks it up', /Live Arrival/.test(await pg.textContent('#queue')));
    /* a counsellor's row opens their leads */
    await pg.click('#crew tr[data-cid="0"]');
    await pg.waitForSelector('body.open #dList .qc', { timeout: 4000 }).catch(() => {});
    check('the Unassigned row opens its leads', (await pg.$$('#dList .qc')).length >= 1);
    await pg.click('#dx');
    /* Mark called */
    const pid = priya.id;
    await pg.click('#queue [data-called="' + pid + '"]');
    await pg.waitForFunction(id => !document.querySelector('#queue [data-qid="' + id + '"]'), pid, { timeout: 6000 }).catch(() => {});
    check('Mark called takes Priya off the queue', !(await pg.$('#queue [data-qid="' + pid + '"]')));
    const after = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    check('and the server agrees: contacted, a first response timed', !after.queue.some(q => q.id === pid) && after.kpis.medianFirstMins != null && after.kpis.contactedToday >= 1,
      JSON.stringify(after.kpis));
    check('the answer is in the feed', after.feed.some(f => f.kind === 'responded' && f.leadId === pid));
    await pg.screenshot({ path: '/tmp/leadcmd-test-1280.png', fullPage: true });

    const ph = await ctx.newPage();
    await ph.setViewportSize({ width: 390, height: 844 });
    ph.on('pageerror', e => errs.push('390: ' + e.message));
    await ph.goto('http://localhost:' + PORT + '/leads-command', { waitUntil: 'domcontentloaded' });
    await ph.waitForSelector('#queue .qc', { timeout: 8000 });
    check('fits at 390 (no sideways scroll)', !(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    check('on a phone the queue comes before the tiles', await ph.evaluate(() => document.querySelector('#queue').getBoundingClientRect().top < document.querySelector('#tiles').getBoundingClientRect().top));
    check('eight KPI tiles at 390', (await ph.$$('#tiles .tile')).length === 8);
    await ph.screenshot({ path: '/tmp/leadcmd-test-390.png', fullPage: true });

    /* the ops page shows the tile */
    const op = await ctx.newPage();
    op.on('pageerror', e => errs.push('ops: ' + e.message));
    await op.goto('http://localhost:' + PORT + '/ops', { waitUntil: 'domcontentloaded' });
    await op.waitForFunction(() => document.getElementById('lwN').textContent !== '—', null, { timeout: 8000 }).catch(() => {});
    check('ops shows "Leads waiting" linking here', /\d/.test(await op.textContent('#lwN')) && (await op.getAttribute('#leadW', 'href')) === 'leads-command.html');
    /* a notification's link opens the lead in the book */
    const lb = await ctx.newPage();
    lb.on('pageerror', e => errs.push('leads: ' + e.message));
    await lb.goto('http://localhost:' + PORT + '/leads?lead=' + pid, { waitUntil: 'domcontentloaded' });
    await lb.waitForFunction(() => /Priya Sharma/.test(document.body.innerText) && /Called/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
    check('leads.html?lead= opens that lead', /Called — logged from the Leads command centre/.test(await lb.evaluate(() => document.body.innerText)));
    check('no script errors', errs.length === 0, errs.join(' | '));
    sseA.close(); sseK.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
    pushSvc.close();
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nleadcommandtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
