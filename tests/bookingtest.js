/**
 * Patch 206: book a call from the website.
 *
 * A visitor sees the slots (09:00–12:00 office time, Mon–Fri) on their own
 * clock, books one with the counselling form, and a second visitor who picks
 * the same slot is told it was just taken. The office sees the call in the
 * Command centre, an admin assigns it, the counsellor sends a meeting link
 * and marks it done; a counsellor cannot touch somebody else's call; the
 * admin can change the slots.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const B = require('../server/booking.js');

const ROOT = '/home/claude/glovels/build';
const PORT = 8206;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

const call = (path, opts) => new Promise(resolve => {
  opts = opts || {};
  const req = http.request({ host: 'localhost', port: PORT, path, method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, opts.headers || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {} }));
  if (opts.body) req.write(JSON.stringify(opts.body));
  req.end();
});
const login = async email => String(([].concat((await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } })).headers['set-cookie'] || []))[0] || '').split(';')[0];

(async () => {
  /* The clock, without a server: winter and summer in India, and a holiday. */
  const winter = B.slots({}, Date.parse('2026-11-01T07:00:00Z'), () => 0);
  check('Sunday offers Monday first, five working days', winter.days.length === 5 && winter.days[0].date === '2026-11-02', winter.days.map(d => d.date).join());
  check('four slots a day, 09:00–11:15 office time', winter.days[0].slots.map(s => s.local).join() === '09:00,09:45,10:30,11:15');
  check('09:00 CET is 13:30 in India in winter', B.say(winter.days[0].slots[0].at, 'Asia/Kolkata').endsWith('13:30'));
  const summer = B.slots({}, Date.parse('2026-06-01T05:00:00Z'), () => 0);
  check('and 12:30 in India in summer', B.say(summer.days[0].slots[0].at, 'Asia/Kolkata').endsWith('12:30'), B.say(summer.days[0].slots[0].at, 'Asia/Kolkata'));
  const closed = B.slots({ closed: ['2026-11-02'] }, Date.parse('2026-11-01T07:00:00Z'), () => 0);
  check('a closed date is skipped', closed.days[0].date === '2026-11-03');
  const late = B.slots({}, Date.parse('2026-11-02T09:00:00Z'), () => 0);
  check('slots inside the notice period are not offered', late.days[0].date === '2026-11-03' || late.days[0].slots.filter(s => s.free).length === 0);

  const dir = '/tmp/db-booking-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }

    const sl = (await call('/api/booking/slots')).body;
    check('the slots are public', sl.ok && sl.on && sl.days.length === 5 && sl.tz === 'Europe/Berlin');
    const pick = sl.days[1].slots[0].at;
    const form = (name, email, phone, slot) => call('/send.php', { method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.' + Math.floor(Math.random() * 200) },
      body: { name, email, phone, consent: 'yes', destination: '🇩🇪 Germany', slot, tz: 'Asia/Kolkata' } });
    const b1 = await form('Asha Rao', 'asha.rao@example.com', '9876501234', pick);
    check('a call can be booked', b1.status === 200 && b1.body.booking && /13:30|12:30/.test(b1.body.booking.when), JSON.stringify(b1.body));
    const b2 = await form('Ravi Kumar', 'ravi.k@example.com', '9876505678', pick);
    check('the same slot cannot be booked twice', b2.status === 409 && b2.body.slotTaken, JSON.stringify(b2.body));
    const sl2 = (await call('/api/booking/slots')).body;
    check('and now shows as taken', sl2.days[1].slots[0].free === false);
    const bogus = await form('Mira Shah', 'mira@example.com', '9876509999', '2026-11-04T03:00:00.000Z');
    check('a time that is not offered is refused', bogus.status === 409);
    const plain = await form('No Slot', 'noslot@example.com', '9876500001');
    check('the form still works without a time', plain.status === 200 && !plain.body.booking);

    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const list = (await call('/api/staff/calls', { headers: { Cookie: admin } })).body;
    const c = (list.calls || [])[0] || {};
    check('the admin sees the booked call', c.name === 'Asha Rao' && /09:00/.test(c.whenOffice) && /13:30|12:30/.test(c.whenIndia), JSON.stringify(c));
    check('unassigned, and counted', !c.ownerId && list.unassigned === 1);
    const leads = (await call('/api/staff/leads', { headers: { Cookie: admin } })).body;
    const lead = (leads.leads || leads.rows || []).find ? (leads.leads || leads.rows || []).find(l => /Asha/.test(l.name)) : null;
    check('the lead carries the call time', lead && (lead.nextAt === pick || lead.next_at === pick), lead && JSON.stringify({ n: lead.nextAt || lead.next_at }));
    const kv = (list.counsellors || []).find(p => /Kavya/.test(p.name));
    check('a counsellor cannot see an unassigned call', ((await call('/api/staff/calls', { headers: { Cookie: kavya } })).body.calls || []).length === 0);
    check('or change it', (await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: kavya }, body: { status: 'done' } })).status === 403);
    const asg = await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: admin }, body: { ownerId: kv && kv.id } });
    check('the admin assigns it to Kavya', asg.status === 200 && asg.body.call.owner === kv.name);
    const mine = (await call('/api/staff/calls', { headers: { Cookie: kavya } })).body.calls || [];
    check('and Kavya now sees it', mine.length === 1 && mine[0].id === c.id);
    const badLink = await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: kavya }, body: { mode: 'video', link: 'javascript:alert(1)', send: true } });
    check('a link that is not https is refused', badLink.status === 422);
    const noLink = await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: kavya }, body: { mode: 'video', send: true } });
    check('sending a video call needs the link', noLink.status === 422);
    const sent = await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: kavya }, body: { mode: 'video', link: 'https://meet.google.com/abc-defg-hij', send: true } });
    check('Kavya sends the meeting link', sent.status === 200 && sent.body.call.sentAt && sent.body.call.link.startsWith('https://meet.google.com'));
    const done = await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: kavya }, body: { status: 'done' } });
    check('and marks it done', done.status === 200 && done.body.call.status === 'done');
    check('Kavya cannot reassign it', (await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: kavya }, body: { ownerId: null } })).status === 403);
    const phone = await call('/api/staff/calls/' + c.id, { method: 'PUT', headers: { Cookie: kavya }, body: { mode: 'phone', send: true } });
    check('a phone call can be announced instead', phone.status === 200 && phone.body.call.mode === 'phone');

    /* Settings. */
    check('a counsellor cannot change the slots', (await call('/api/staff/booking-settings', { method: 'PUT', headers: { Cookie: kavya }, body: { times: '08:00' } })).status === 403);
    const set = await call('/api/staff/booking-settings', { method: 'PUT', headers: { Cookie: admin }, body: { times: '09:00, 10:00, 11:00, nonsense', capacity: 2, days: [1, 2, 3, 4, 5], tz: 'Europe/Berlin' } });
    check('the admin changes the slots (nonsense dropped)', set.status === 200 && set.body.settings.times.join() === '09:00,10:00,11:00' && set.body.settings.capacity === 2);
    const sl3 = (await call('/api/booking/slots')).body;
    check('and the website offers the new ones', sl3.days[0].slots.map(s => s.local).join() === '09:00,10:00,11:00');
    await call('/api/staff/booking-settings', { method: 'PUT', headers: { Cookie: admin }, body: { on: false } });
    check('booking can be switched off', (await call('/api/booking/slots')).body.on === false);
    await call('/api/staff/booking-settings', { method: 'PUT', headers: { Cookie: admin }, body: { on: true } });

    /* The pages. */
    const b = await chromium.launch();
    const pub = await (await b.newContext({ userAgent: UA, timezoneId: 'Asia/Kolkata', viewport: { width: 1300, height: 900 } })).newPage();
    const errs = []; pub.on('pageerror', e => errs.push(String(e)));
    await pub.goto('http://localhost:' + PORT + '/#book'); await pub.waitForTimeout(1500);
    check('the home page shows the slot picker (the admin\'s three times kept)', await pub.isVisible('#slotBox') && (await pub.$$('#slTimes [data-slot]')).length === 3, String((await pub.$$('#slTimes [data-slot]')).length));
    check('times are on the visitor\'s clock (India), office time beside', /1[23]:30/.test(await pub.textContent('#slTimes')) && /CET/.test(await pub.textContent('#slTimes')), await pub.textContent('#slTimes'));
    await pub.click('#slTimes [data-slot]:not([disabled])');
    check('picking a time names it on the button', /Book my call/.test(await pub.textContent('#bGo')));
    await pub.fill('#bName', 'Page Booker'); await pub.fill('#bPhone', '+91 98765 12345'); await pub.fill('#bMail', 'page.booker@example.com');
    await pub.check('#bOk');
    await pub.locator('#book').screenshot({ path: '/tmp/slots.png' });
    await pub.click('#bGo'); await pub.waitForTimeout(1500);
    check('booking from the page confirms the time', /Your call is booked/.test(await pub.textContent('#bForm')), (await pub.textContent('#bForm')).slice(0, 120));
    check('the contact form is untouched — no slot picker in it', !(await pub.$('#cForm [data-slot]')) && /calls? you back within one/.test(await pub.textContent('#counsel')));
    check('the hero button goes to Schedule a call', (await pub.getAttribute('.hero-cta a.btn-ghost-light', 'href')) === '#book');
    check('no script errors on the home page', errs.length === 0, errs.join(' | '));

    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const e2 = []; p.on('pageerror', e => e2.push(String(e)));
    await p.goto('http://localhost:' + PORT + '/ops#calls'); await p.waitForTimeout(2000);
    check('the Command centre lists the booked call', /Page Booker/.test(await p.textContent('#callRows')));
    check('with a counsellor picker for the admin', !!(await p.$('#callRows select[data-cown]')));
    await p.locator('#calls').scrollIntoViewIfNeeded();
    await p.screenshot({ path: '/tmp/calls.png' });
    await p.click('#slotsBtn'); await p.waitForTimeout(500);
    check('the admin opens the call-slot settings', await p.isVisible('#slotsM form') && /09:00/.test(await p.inputValue('#slTimes')));
    check('no script errors in the Command centre', e2.length === 0, e2.join(' | '));
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nbookingtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
