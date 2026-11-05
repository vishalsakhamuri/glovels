/**
 * Patch 266: a sign-up is a lead.
 *
 * Three accounts were made on one morning and the office could not see them
 * anywhere a lead is looked for. Checks, on a fresh database:
 *
 *   an account made on /login files a lead — channel "signed up on the
 *   website", source from where they came (Google via the referrer), the
 *   optional "what do you want help with" line as the note, the account tied;
 *   the lead watch sends every staff screen a live 'lead' event of kind
 *   signup; "Leads waiting" on the Command centre and "New leads nobody has
 *   called" both count it; the Leads screen draws the Signed up chip and
 *   "Looking for:" once the profile is filled; a sign-up from an email that
 *   already enquired lands on that lead as a note and ties the account;
 *   Conversations reads "New sign-up · nobody has written yet" over a thread
 *   that holds only the automatic welcome, the welcome bubbles say so, and
 *   the moment a counsellor writes the line is theirs;
 *   a sign-up from the finder's "Apply free" names the university;
 *   the sign-up from a staff member's own email is marked internal.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8266;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
let ipN = 10;
const ip = () => '203.0.113.' + (ipN++);

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
const cookieOf = r => String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
const login = async email => cookieOf(await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } }));
const signup = (body, headers) => call('/api/auth/signup', { method: 'POST',
  headers: Object.assign({ 'X-Forwarded-For': ip() }, headers || {}), body: Object.assign({ password: 'glovels123', terms: true }, body) });

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
  const dir = '/tmp/db-signuplead-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', UNLOCK_UNPAID: 'on',
      LEAD_MINUTE_MS: '1000', LEAD_SLA_TICK_MS: '500' }) });
  let browser = null;
  try {
    for (let i = 0; i < 60; i++) { await wait(400); if ((await call('/api/health')).status === 200) break; }
    await wait(1500);
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const sse = listen(admin);
    await wait(500);

    /* ------------------------------------------- an account from /login */
    const r1 = await signup({ name: 'Pavithra Test', email: 'pavithra.t@mail.test', phone: '+919908700001',
      why: 'Masters in Germany for Summer 2027, need a shortlist', referrer: 'https://www.google.com/',
      sourcePage: '/login?next=%2F' }, { Referer: 'http://localhost:' + PORT + '/login' });
    check('the account is made', r1.status === 200 && r1.body.user && r1.body.user.email === 'pavithra.t@mail.test', JSON.stringify(r1.body));
    const pav = r1.body.user;
    await wait(1200);

    let leads = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body.leads || [];
    let l1 = leads.find(l => l.email === 'pavithra.t@mail.test');
    check('the sign-up is a lead in the book', !!l1, JSON.stringify(leads.map(l => l.email)));
    check('channel: signed up', l1 && l1.how === 'signup', l1 && l1.how);
    check('source: where they came from (Google, via the referrer)', l1 && l1.source === 'google', l1 && l1.source);
    check('the note carries what they want', l1 && /Signed up on the website — “Masters in Germany for Summer 2027, need a shortlist”/.test(l1.note), l1 && l1.note);
    check('the lead knows the account', l1 && Number(l1.studentId) === Number(pav.id), l1 && String(l1.studentId));
    check('status new, nobody has called', l1 && l1.status === 'new' && !l1.followUps);
    check('the page they signed up on is recorded', l1 && /^\/login/.test(l1.page), l1 && l1.page);
    check('a live "lead" event of kind signup reached the admin’s screen',
      sse.events.some(x => x.ev === 'lead' && x.data.kind === 'signup' && x.data.name === 'Pavithra Test'),
      JSON.stringify(sse.events.map(x => x.ev + ':' + (x.data.kind || ''))));

    const cmdL = (await call('/api/staff/leads/command', { headers: { Cookie: admin } })).body;
    const q1 = (cmdL.queue || []).find(q => q.email === 'pavithra.t@mail.test');
    check('Leads command: in "Needs a call now" as a sign-up', q1 && q1.type === 'first' && q1.channel === 'signup' && /signed up/.test(q1.channelLabel), JSON.stringify(q1));

    const cmd = (await call('/api/staff/command', { headers: { Cookie: admin } })).body;
    check('Command centre: "Leads waiting" counts it', cmd.leadWatch && cmd.leadWatch.waiting >= 1, JSON.stringify(cmd.leadWatch));
    const q = (cmd.queues || []).find(x => x.key === 'leads');
    const row = q && (q.rows || []).find(r => r.leadId === l1.id);
    check('and "New leads nobody has called" lists it, marked as a sign-up', row && row.how === 'signup', JSON.stringify(row));

    /* ------------------------------------- the profile is what they want */
    const pavC = cookieOf(await call('/api/auth/login', { method: 'POST', body: { email: 'pavithra.t@mail.test', password: 'glovels123' } }));
    await call('/api/profile', { method: 'PUT', headers: { Cookie: pavC },
      body: { profile: { g_country: 'DE', g_level: "Master's", g_field: 'Computer Science', d_cgpa: '7.74', g_intake: 'Summer 2027' } } });
    leads = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body.leads || [];
    l1 = leads.find(l => l.email === 'pavithra.t@mail.test');
    check('"Looking for" is read live from the profile', l1 && /Germany/.test(l1.wants) && /Master/.test(l1.wants) && /CGPA 7\.74/.test(l1.wants) && /Summer 2027/.test(l1.wants), l1 && l1.wants);

    /* -------------------------- Conversations: the welcome is not "You:" */
    let cs = (await call('/api/staff/students', { headers: { Cookie: admin } })).body;
    let s1 = (cs.students || []).find(s => s.email === 'pavithra.t@mail.test');
    check('the caseload says nobody in the office has written yet', s1 && s1.spoken === false && s1.lastMessage && s1.lastMessage.auto === true && s1.lastMessage.from === 'Glovels', JSON.stringify(s1 && { spoken: s1.spoken, last: s1.lastMessage }));
    check('the staff screen is told who is reading', typeof cs.name === 'string' && cs.name.length > 0, cs.name);

    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=')[1], domain: 'localhost', path: '/' }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://localhost:' + PORT + '/counsellor?student=' + pav.id, { waitUntil: 'networkidle' });
    await wait(800);
    const list = await page.evaluate(() => Array.from(document.querySelectorAll('[data-open]')).map(b => b.textContent.replace(/\s+/g, ' ')));
    const mine = list.find(t => /Pavithra Test/.test(t)) || '';
    check('the thread list reads "New sign-up · nobody has written yet"', /New sign-up · nobody has written yet/.test(mine), mine);
    check('and not "You:"', !/You:/.test(mine), mine);
    const body = await page.evaluate(() => document.body.innerText);
    check('the welcome bubbles say they are automatic', (body.match(/Automatic welcome from Glovels/g) || []).length === 2, String((body.match(/Automatic welcome from Glovels/g) || []).length));

    /* ------------------------------------ a counsellor writes: now "You:" */
    const sent = await call('/api/staff/student/' + pav.id + '/message', { method: 'POST', headers: { Cookie: admin }, body: { body: 'Hi Pavithra — what are you aiming for?' } });
    check('the administrator writes to her', sent.status === 200, String(sent.status) + ' ' + JSON.stringify(sent.body));
    cs = (await call('/api/staff/students', { headers: { Cookie: admin } })).body;
    s1 = (cs.students || []).find(s => s.email === 'pavithra.t@mail.test');
    check('now somebody has spoken, and the last line is theirs', s1 && s1.spoken === true && s1.lastMessage.auto === false && s1.lastMessage.from === cs.name, JSON.stringify(s1 && { spoken: s1.spoken, last: s1.lastMessage, me: cs.name }));
    await page.reload({ waitUntil: 'networkidle' }); await wait(600);
    const list2 = await page.evaluate(() => Array.from(document.querySelectorAll('[data-open]')).map(b => b.textContent.replace(/\s+/g, ' ')));
    const mine2 = list2.find(t => /Pavithra Test/.test(t)) || '';
    check('the thread list now reads "You: Hi Pavithra…"', /You: Hi Pavithra/.test(mine2), mine2);

    /* ------------------------------ the Leads screen draws the chip */
    await page.goto('http://localhost:' + PORT + '/leads', { waitUntil: 'networkidle' });
    await wait(800);
    const lrow = await page.evaluate(() => { const tr = Array.from(document.querySelectorAll('tr[data-lead]')).find(r => /Pavithra Test/.test(r.textContent)); return tr ? tr.innerText.replace(/\s+/g, ' ') : ''; });
    check('Leads screen: the row carries "Signed up"', /Signed up/.test(lrow), lrow);
    check('and "Looking for: Germany …"', /Looking for: Germany/.test(lrow), lrow);
    const srcOpts = await page.evaluate(() => Array.from(document.querySelectorAll('#fSource option')).map(o => o.textContent));
    check('the source filter offers "Signed up on the website"', srcOpts.includes('Signed up on the website'), srcOpts.join('|'));

    /* ------------------------ enquired before, signs up now: one lead */
    const e2 = await call('/api/enquiries', { method: 'POST', headers: { 'X-Forwarded-For': ip() },
      body: { name: 'Vijetha Test', phone: '9908700002', email: 'vijetha.t@mail.test', destination: 'Germany', consent: 'yes', message: 'MS in Germany?' } });
    check('an enquiry from Vijetha is accepted', e2.status === 200);
    const r2 = await signup({ name: 'Vijetha Test', email: 'vijetha.t@mail.test', phone: '+919908700002', why: 'MS in Germany' });
    check('she signs up afterwards', r2.status === 200);
    await wait(600);
    leads = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body.leads || [];
    const vij = leads.filter(l => l.email === 'vijetha.t@mail.test');
    check('one lead for her, not two', vij.length === 1, String(vij.length));
    check('the sign-up is filed on it as a note and the account tied', vij[0] && vij[0].returning && Number(vij[0].studentId) === Number(r2.body.user.id), JSON.stringify(vij[0] && { returning: vij[0].returning, studentId: vij[0].studentId }));
    const notes = (await call('/api/staff/lead/' + vij[0].id, { headers: { Cookie: admin } })).body.notes || [];
    check('the note says "Created an account"', notes.some(n => /^Created an account via/.test(n.body)), JSON.stringify(notes.map(n => n.body.slice(0, 40))));

    /* --------------------------- from the finder: "Apply free" names it */
    const r3 = await signup({ name: 'Srishanth Test', email: 'srishanth.t@mail.test', phone: '+919908700003',
      why: 'Apply free: SRH Berlin — MSc Data Science', sourcePage: '/' }, { Referer: 'http://localhost:' + PORT + '/' });
    check('a sign-up from the home page is made', r3.status === 200);
    leads = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body.leads || [];
    const sri = leads.find(l => l.email === 'srishanth.t@mail.test');
    check('its note names the university they pressed Apply on', sri && /Apply free: SRH Berlin — MSc Data Science/.test(sri.note) && sri.source === 'website', sri && (sri.note + ' / ' + sri.source));

    /* ----------------------------- a staff member's own email: internal */
    const r4 = await signup({ name: 'Kavya Testing', email: 'kavya@glovels.com' });
    check('a second account on a staff email is refused as before', r4.status === 409);
    const r5 = await signup({ name: 'Kavya Own Phone', email: 'kavya.other@mail.test', phone: (await call('/api/auth/me', { headers: { Cookie: kavya } })).body.user.phone || '+919000000001' });
    leads = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body.leads || [];
    const kv = leads.find(l => l.email === 'kavya.other@mail.test');
    check('a sign-up from a staff member’s own number is marked internal', r5.status === 200 && kv && kv.internal === true, JSON.stringify(kv && { internal: kv.internal, phone: kv.phone }));

    /* ---------------------------------------- the sign-up page itself */
    const guest = await (await browser.newContext()).newPage();   // signed out: /login would send the admin on
    await guest.goto('http://localhost:' + PORT + '/login', { waitUntil: 'networkidle' });
    const hasWhy = await guest.evaluate(() => !!document.querySelector('#lWhy'));
    check('the sign-up form asks what they want help with', hasWhy);
    check('no script errors on the three screens', errors.length === 0, errors.join(' | '));
    sse.close();
  } catch (e) {
    bad.push('crashed: ' + (e.stack || e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* gone */ } }
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ok   ' + x));
  bad.forEach(x => console.log('  FAIL ' + x));
  console.log('\nsignupleadtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
