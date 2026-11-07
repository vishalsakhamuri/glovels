/**
 * Patch 282: a website-chat reply the visitor has not seen is emailed to
 * them, with a link back into the same chat, and every enquiry carries a
 * number (GLV-E-00042) the office can search for.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.GLOVELS_ROOT || '/home/claude/glovels';
const PORT = 8283;
const DIR = '/tmp/db-' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function call(p, o) {
  o = o || {};
  return new Promise(resolve => {
    const headers = Object.assign({ 'User-Agent': UA, 'Accept-Language': 'en', 'Content-Type': 'application/json',
      'X-Forwarded-For': o.ip || '203.0.113.70' }, o.headers || {});
    if (o.cookie) headers.Cookie = o.cookie;
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: o.method || 'GET', headers }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch (e) { j = { raw: out }; }
        resolve({ status: res.statusCode, body: j, headers: res.headers, text: out });
      });
    });
    req.on('error', () => resolve({ status: 0, body: {} }));
    if (o.body) req.write(JSON.stringify(o.body));
    req.end();
  });
}
const cookieOf = (r, name) => String([].concat(r.headers['set-cookie'] || []).find(c => c.startsWith(name + '=')) || '').split(';')[0];
function outbox() {
  const d = path.join(DIR, 'outbox');
  try { return fs.readdirSync(d).map(f => fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { return []; }
}
const decoded = m => m.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', CHAT_MAIL_MINUTES: '0.05', INBOUND_DOMAIN: 'reply.glovels.com', INBOUND_KEY: 'testinboundkey' }) });
  child.unref();
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { up = (await call('/')).status === 200; if (!up) await sleep(500); }
    check('server starts', up);
    const loginR = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@glovels.com', password: 'glovels123' } });
    const staff = String([].concat(loginR.headers['set-cookie'] || [])[0] || '').split(';')[0];
    check('admin signs in', !!staff && loginR.status === 200);

    /* A visitor who leaves. */
    const st = await call('/api/chat/start', { method: 'POST', ip: '203.0.113.71', body: { name: 'Mohammad Rehan', phone: '+923338619199', email: 'rehan@example.com', page: '/' } });
    const guest = cookieOf(st, 'glovels_chat');
    check('a visitor starts a chat', st.status === 200 && !!guest, st.status + ' ' + JSON.stringify(st.body).slice(0, 120));
    check('the chat carries an enquiry number', /^GLV-E-\d{5}$/.test(st.body.ref || ''), String(st.body.ref));
    await call('/api/chat/send', { method: 'POST', cookie: guest, ip: '203.0.113.71', body: { body: 'Which public universities for civil engineering?' } });
    const list = (await call('/api/staff/chats', { cookie: staff })).body.chats || [];
    const c = list.find(x => x.name === 'Mohammad Rehan');
    check('the office sees the number on the chat', c && c.ref === st.body.ref, JSON.stringify(c || {}).slice(0, 160));
    const before = outbox().length;
    const rp = await call('/api/staff/chat/' + (c && c.id) + '/reply', { method: 'POST', cookie: staff, body: { body: 'Share your WhatsApp number and a time for a call.' } });
    check('the office replies', rp.status === 200, String(rp.status));
    await sleep(1000);
    check('nothing is emailed straight away', outbox().length === before);
    await sleep(4500);
    const mails = outbox().slice(before).map(decoded).filter(m => /rehan@example\.com/.test(m));
    check('the unseen reply is emailed to the visitor', mails.length === 1, String(mails.length));
    const m = mails[0] || '';
    check('with the reply in it', /Share your WhatsApp number/.test(m));
    check('with the enquiry number', m.includes(st.body.ref || 'none'));
    const link = (/(\/api\/chat\/open\?t=[A-Za-z0-9_%.-]+)/.exec(m) || [])[1];
    check('and a link back into the chat', !!link);
    if (link) {
      const o = await call(link);
      check('the link signs this browser into the same chat', o.status === 200 && cookieOf(o, 'glovels_chat') === guest, cookieOf(o, 'glovels_chat'));
      check('and opens the chat box on the home page', /glovels_chat_open/.test(o.text) && /location\.replace\("\/"\)/.test(o.text));
    }
    const rt = (/Reply-To:\s*<?(chat-\d+-[a-f0-9]{10}@reply\.glovels\.com)/i.exec(m) || [])[1];
    check('the email can be answered: Reply-To is the chat\'s own address', !!rt, (/Reply-To:.*/i.exec(m) || [''])[0]);
    check('it invites them to create an account', /Create (a|my) free account/.test(m) && /to=signup/.test(m));
    const sg = await call('/api/chat/open?t=' + encodeURIComponent(guest.split('=')[1]) + '&to=signup');
    check('that link opens sign-up and returns to Messages', /login\.html\?signup=1/.test(sg.text) && /messages/.test(sg.text));

    /* Answering the email. */
    const wrong = await call('/api/inbound/brevo?k=nope', { method: 'POST', body: { items: [] } });
    check('the inbound hook refuses a wrong key', wrong.status === 403);
    const item = txt => ({ items: [{ From: { Address: 'rehan@example.com', Name: 'Mohammad Rehan' }, To: [{ Address: rt }], Subject: 'Re: reply',
      ExtractedMarkdownMessage: txt, RawTextBody: txt + '\n\n> On Sat, Glovels wrote: ...', Spam: { Score: 0.4 } }] });
    const inb = await call('/api/inbound/brevo?k=testinboundkey', { method: 'POST', body: item('My WhatsApp is +92 333 8619199, any time after 4pm.') });
    check('an emailed answer is taken', inb.status === 200 && inb.body.took === 1, JSON.stringify(inb.body));
    const thread = (await call('/api/staff/chat/' + c.id, { cookie: staff })).body.chat || {};
    const lastMsg = (thread.messages || []).slice(-1)[0] || {};
    check('and lands in the same chat, as the visitor', lastMsg.who === 'me' && /after 4pm/.test(lastMsg.t || '') && !/On Sat, Glovels wrote/.test(lastMsg.t || ''), JSON.stringify(lastMsg));
    const forged = JSON.parse(JSON.stringify(item('x'))); forged.items[0].To[0].Address = 'chat-' + c.id + '-0000000000@reply.glovels.com';
    check('a guessed chat address is ignored', (await call('/api/inbound/brevo?k=testinboundkey', { method: 'POST', body: forged })).body.took === 0);

    /* Signing up carries the chat into the account. */
    const su = await call('/api/auth/signup', { method: 'POST', cookie: guest, ip: '203.0.113.71', body: { name: 'Mohammad Rehan', email: 'rehan@example.com', phone: '+923338619199', password: 'abcdefgh123', terms: true, consent: true } });
    const sess = String([].concat(su.headers['set-cookie'] || []).find(x => !/^glovels_chat=/.test(x)) || '').split(';')[0];
    check('the visitor creates an account', su.status === 200 && !!sess, su.status + ' ' + JSON.stringify(su.body).slice(0, 100));
    const stt = (await call('/api/state', { cookie: sess })).body || {};
    const texts = (stt.msgs || stt.messages || []).map(x => String(x.t || x.body || ''));
    check('their Messages hold the whole website chat', texts.some(t => /civil engineering/.test(t)) && texts.some(t => /Share your WhatsApp/.test(t)) && texts.some(t => /after 4pm/.test(t)), texts.length + ' messages');
    const chats2 = (await call('/api/staff/chats', { cookie: staff })).body.chats || [];
    const c2 = chats2.find(x => x.id === c.id) || {};
    check('the office chat is closed with a pointer to the account', c2.status === 'done', String(c2.status));
    const again = await call('/api/auth/login', { method: 'POST', cookie: guest, body: { email: 'rehan@example.com', password: 'abcdefgh123' } });
    const sess2 = String([].concat(again.headers['set-cookie'] || [])[0] || '').split(';')[0];
    const n2 = ((await call('/api/state', { cookie: sess2 })).body.msgs || []).length;
    check('signing in again does not copy it twice', n2 === texts.length, n2 + ' vs ' + texts.length);
    await call('/api/inbound/brevo?k=testinboundkey', { method: 'POST', body: item('Answering the old email after signing up.') });
    const texts3 = ((await call('/api/state', { cookie: sess2 })).body.msgs || []).map(x => String(x.t || x.body || ''));
    check('an emailed answer after sign-up goes to their Messages', texts3.some(t => /after signing up/.test(t)));

    const bogus = await call('/api/chat/open?t=nonsense');
    check('a made-up link sets no chat', bogus.status === 200 && !cookieOf(bogus, 'glovels_chat'));

    /* Two replies close together → one email. */
    const b2 = outbox().length;
    await call('/api/staff/chat/' + c.id + '/reply', { method: 'POST', cookie: staff, body: { body: 'First line.' } });
    await call('/api/staff/chat/' + c.id + '/reply', { method: 'POST', cookie: staff, body: { body: 'Second line.' } });
    await sleep(5500);
    const two = outbox().slice(b2).map(decoded).filter(m => /rehan@example\.com/.test(m));
    check('replies close together go as one email', two.length === 1 && /First line/.test(two[0]) && /Second line/.test(two[0]), String(two.length));

    /* A visitor who comes back in time is not emailed. */
    const b3 = outbox().length;
    await call('/api/staff/chat/' + c.id + '/reply', { method: 'POST', cookie: staff, body: { body: 'Seen this one.' } });
    await sleep(800);
    await call('/api/chat', { cookie: guest });
    await sleep(4500);
    check('a reply the visitor saw is not emailed', outbox().slice(b3).map(decoded).filter(m => /rehan@example\.com/.test(m)).length === 0);

    /* The enquiry form answers with its number, and the lead carries it. */
    const ef = await call('/api/enquiries', { method: 'POST', ip: '203.0.113.80', body: { name: 'Asha Rao', phone: '+919876500321', email: 'asha.rao@example.com', consent: 'yes', destination: 'Germany' } });
    check('an enquiry answers with its number', ef.status === 200 && /^GLV-E-\d{5}$/.test(ef.body.ref || ''), JSON.stringify(ef.body));
    await sleep(600);
    const ack = outbox().map(decoded).filter(m => /asha\.rao@example\.com/.test(m) && /enquiry number/i.test(m));
    check('the acknowledgement email quotes it', ack.length >= 1 && ack[0].includes(ef.body.ref || 'none'));
    const leads = (await call('/api/staff/leads', { cookie: staff })).body;
    const rows = leads.leads || leads.rows || leads;
    const asha = [].concat(rows || []).find(l => l.email === 'asha.rao@example.com');
    check('the lead carries the same number', asha && asha.ref === ef.body.ref, JSON.stringify(asha || {}).slice(0, 120));
  } catch (e) {
    check('test ran', false, String(e && e.stack || e).slice(0, 300));
  } finally {
    try { process.kill(-child.pid); } catch (e) { try { child.kill(); } catch (_) {} }
    console.log('\nchatmail: ' + ok.length + ' passed, ' + bad.length + ' failed');
    bad.forEach(b => console.log('  ✗ ' + b));
    process.exit(bad.length ? 1 : 0);
  }
})();
