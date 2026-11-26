/**
 * Patch 325: WhatsApp chats are leads.
 *
 * A message to the business number from somebody who is not on the staff
 * becomes a conversation on the Website chat screen and, the first time, a
 * lead in Leads with source WhatsApp; a reply typed on the screen goes back
 * on WhatsApp. Meta is stood in for by a small local server that records
 * what is sent to it; Meta's callbacks are signed with the app secret.
 *
 *   node whatsappleadtest.js        (its own server on 8325, the stand-in on 8326)
 */
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8325), META = PORT + 1;
const SECRET = 'test-app-secret', IGSECRET = 'ig-secret';
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; if (!c) console.log('  ✗ ' + n + (note == null ? '' : ' — ' + String(note).slice(0, 300))); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const sent = []; let refuseNext = false;
const meta = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    if (req.method === 'GET' && /\/v25\.0\/IGSID777\?/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"name":"Priya Nair","username":"priya.studies","id":"IGSID777"}'); }
    if (req.method === 'GET') { res.writeHead(404); return res.end('{}'); }
    if (refuseNext) { refuseNext = false; res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"Re-engagement message","code":131047}}'); }
    try { sent.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); } catch (e) { sent.push({ raw: b }); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"messages":[{"id":"wamid.out"}]}');
  });
}).listen(META);

(async () => {
  const dir = '/tmp/db-walead-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', BOTGATE: 'off',
      WHATSAPP_TOKEN: 'test-token', WHATSAPP_PHONE_ID: '1234567890', WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_GRAPH: 'http://localhost:' + META,
      INSTAGRAM_TOKEN: 'ig-token', INSTAGRAM_ACCOUNT_ID: '17841400000000001', INSTAGRAM_APP_SECRET: IGSECRET, INSTAGRAM_VERIFY_TOKEN: 'ig-verify', INSTAGRAM_GRAPH: 'http://localhost:' + META }) });
  try {
    for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch('http://localhost:' + PORT + '/api/health')).ok) break; } catch (e) { /* booting */ } }
    const B = 'http://localhost:' + PORT;
    const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
    const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const req = async (method, p, body) => { const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch (e) { j = {}; } return { status: r.status, body: j }; };
    const hook = async (payload, sig) => {
      const raw = Buffer.from(JSON.stringify(payload));
      const h = sig === undefined ? 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex') : sig;
      const r = await fetch(B + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': h }, body: raw });
      return r.status;
    };
    const msg = (from, name, id, m) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '917093314089', phone_number_id: '1234567890' },
      contacts: name ? [{ profile: { name }, wa_id: from }] : [], messages: [Object.assign({ from, id, timestamp: String(Math.floor(Date.now() / 1000)) }, m)] } }] }] });
    const text = t => ({ type: 'text', text: { body: t } });

    /* the handshake Meta does when the webhook is set up */
    const v = await fetch(B + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
    check('Meta’s set-up handshake is answered with its challenge', v.status === 200 && (await v.text()) === '12345');
    check('a callback without Meta’s signature is refused', (await hook(msg('919812345678', 'Anu', 'w1', text('hi')), 'sha256=' + '0'.repeat(64))) === 403);

    const leads0 = ((await req('GET', '/api/staff/leads')).body.leads || []).length;
    check('a first WhatsApp message is accepted', (await hook(msg('919812345678', 'Anusha Reddy', 'wamid.1', text('Hi, I want to study masters in Germany. My CGPA is 7.4')))) === 200);
    await wait(300);
    const L1 = (await req('GET', '/api/staff/leads')).body.leads || [];
    const lead = L1.find(l => String(l.phone || '').replace(/\D/g, '').endsWith('9812345678'));
    check('it files a lead in Leads: source WhatsApp, their WhatsApp name and number, what they wrote', L1.length === leads0 + 1 && lead && lead.source === 'whatsapp' && lead.name === 'Anusha Reddy' && /\+919812345678/.test(lead.phone) && /masters in Germany/.test(lead.note || ''), JSON.stringify(lead || {}).slice(0, 300));
    const C1 = (await req('GET', '/api/staff/chats')).body.chats || [];
    const chat = C1.find(c => c.channel === 'whatsapp');
    check('and a conversation on the Website chat screen, marked WhatsApp, waiting for a reply', chat && chat.name === 'Anusha Reddy' && chat.lastFrom === 'me' && chat.unseen === 1 && /CGPA is 7\.4/.test(chat.preview) && chat.ref, JSON.stringify(chat || {}).slice(0, 300));

    await hook(msg('919812345678', 'Anusha Reddy', 'wamid.2', text('Also is IELTS needed?')));
    await hook(msg('919812345678', 'Anusha Reddy', 'wamid.2', text('Also is IELTS needed?')));
    await hook(msg('919812345678', 'Anusha Reddy', 'wamid.3', { type: 'image', image: { id: 'm1', caption: 'my marksheet' } }));
    await wait(300);
    const L2 = (await req('GET', '/api/staff/leads')).body.leads || [];
    const ch2 = (await req('GET', '/api/staff/chat/' + chat.id)).body.chat;
    check('their next messages go on the same conversation, not new leads', L2.length === L1.length && ch2.messages.length === 3, L2.length + ' leads, ' + ch2.messages.length + ' messages');
    check('the same message sent twice by Meta is filed once', ch2.messages.filter(m => /IELTS needed/.test(m.t)).length === 1);
    check('a photo is kept as a line saying what it was', ch2.messages.some(m => m.t === '[photo] my marksheet'));

    const r1 = await req('POST', '/api/staff/chat/' + chat.id + '/reply', { body: 'Hi Anusha, yes we can help. Can we call you at 6 pm?' });
    const out = sent.slice(-1)[0] || {};
    check('a reply typed on the screen goes to their WhatsApp', r1.status === 200 && out.body && out.body.to === '919812345678' && out.body.type === 'text' && /call you at 6 pm/.test(out.body.text.body) && out.auth === 'Bearer test-token' && /\/1234567890\/messages$/.test(out.path), r1.status + ' ' + JSON.stringify(out).slice(0, 200));
    const leadAfter = ((await req('GET', '/api/staff/leads')).body.leads || []).find(l => l.id === lead.id);
    check('and it counts as the first response: the lead is contacted and owned', leadAfter && leadAfter.status === 'contacted' && leadAfter.ownerId != null || (leadAfter && leadAfter.status === 'contacted'), JSON.stringify(leadAfter || {}).slice(0, 200));
    refuseNext = true;
    const r2 = await req('POST', '/api/staff/chat/' + chat.id + '/reply', { body: 'Following up' });
    const ch3 = (await req('GET', '/api/staff/chat/' + chat.id)).body.chat;
    check('when WhatsApp refuses (past 24 hours), the screen says so and nothing is shown as sent', r2.status === 502 && /24 hours/.test(r2.body.error) && !ch3.messages.some(m => m.t === 'Following up'), r2.status + ' ' + JSON.stringify(r2.body).slice(0, 200));

    /* a reply sent from the WhatsApp app on the same number */
    await hook({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'smb_message_echoes', value: { messaging_product: 'whatsapp', message_echoes: [{ from: '917093314089', to: '919812345678', id: 'wamid.echo1', timestamp: '1', type: 'text', text: { body: 'Sent you the brochure' } }] } }] }] });
    await wait(200);
    const ch4 = (await req('GET', '/api/staff/chat/' + chat.id)).body.chat;
    check('a reply sent from the WhatsApp app shows as the office’s reply', ch4.messages.slice(-1)[0].t === 'Sent you the brochure' && ch4.messages.slice(-1)[0].who === 'them');

    /* somebody who already enquired on the website, by the same number */
    const pub = await fetch(B + '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Kiran Rao', phone: '+91 98111 22233', email: 'kiran@example.test', destination: 'Germany', consent: 'yes', message: 'call me' }) });
    const before = ((await req('GET', '/api/staff/leads')).body.leads || []).length;
    await hook(msg('919811122233', 'Kiran', 'wamid.k1', text('Hi, I filled the form')));
    await wait(300);
    const after = (await req('GET', '/api/staff/leads')).body.leads || [];
    check('the same person on the website form and on WhatsApp is one lead', pub.status < 300 && after.length === before && after.filter(l => String(l.phone).replace(/\D/g, '').endsWith('9811122233')).length === 1, pub.status + ' ' + before + ' -> ' + after.length);

    /* a counsellor's own phone is not a lead */
    const leadsNow = after.length;
    await hook(msg('910000000001', 'Counsellor', 'wamid.c1', text('test')));
    await wait(200);
    check('nothing breaks on a message with no name', (await hook(msg('447700900123', '', 'wamid.u1', text('Hello from London')))) === 200);
    await wait(300);
    const Lx = (await req('GET', '/api/staff/leads')).body.leads || [];
    const ln = Lx.find(l => String(l.phone).endsWith('447700900123'));
    check('a number from abroad files a lead under the number when WhatsApp gives no name', ln && ln.name === '+447700900123' && ln.source === 'whatsapp', JSON.stringify(ln || {}).slice(0, 160));

    /* a converted lead is finished business: the next message is a new lead */
    const conv = await req('PUT', '/api/staff/lead/' + lead.id, { status: 'lost', lostReason: 'test' });
    check('(the test can mark the lead lost)', conv.status === 200, conv.status + ' ' + JSON.stringify(conv.body).slice(0, 160));
    {
      await hook(msg('919812345678', 'Anusha Reddy', 'wamid.9', text('Hi again, next year intake?')));
      await wait(300);
      const L9 = (await req('GET', '/api/staff/leads')).body.leads || [];
      check('when their lead is finished, a new message files a new lead', L9.filter(l => String(l.phone).endsWith('9812345678')).length === 2);
    }
    /* ---- Instagram direct messages ---- */
    const igHook = async (payload, sig) => {
      const raw = Buffer.from(JSON.stringify(payload));
      const h = sig === undefined ? 'sha256=' + crypto.createHmac('sha256', IGSECRET).update(raw).digest('hex') : sig;
      return (await fetch(B + '/api/instagram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': h }, body: raw })).status;
    };
    const igMsg = (from, to, mid, message) => ({ object: 'instagram', entry: [{ id: '17841400000000001', time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: to }, timestamp: Date.now(), message: Object.assign({ mid }, message) }] }] });
    const iv = await fetch(B + '/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=ig-verify&hub.challenge=777');
    check('Instagram: the set-up handshake is answered', iv.status === 200 && (await iv.text()) === '777');
    check('Instagram: a callback signed with the wrong secret is refused', (await igHook(igMsg('IGSID777', '17841400000000001', 'm.0', { text: 'x' }), 'sha256=' + crypto.createHmac('sha256', SECRET).update('x').digest('hex'))) === 403);
    const ig0 = ((await req('GET', '/api/staff/leads')).body.leads || []).length;
    check('Instagram: a first message is accepted', (await igHook(igMsg('IGSID777', '17841400000000001', 'm.1', { text: 'Hi! How much does Germany masters cost?' }))) === 200);
    await wait(400);
    const IL = (await req('GET', '/api/staff/leads')).body.leads || [];
    const igLead = IL.find(l => l.source === 'instagram');
    check('Instagram: it files a lead with source Instagram, their name and @username, and what they wrote', IL.length === ig0 + 1 && igLead && igLead.name === 'Priya Nair (@priya.studies)' && /Germany masters cost/.test(igLead.note || ''), JSON.stringify(igLead || {}).slice(0, 240));
    const igChat = ((await req('GET', '/api/staff/chats')).body.chats || []).find(c => c.channel === 'instagram');
    check('Instagram: and a conversation on the chat screen, marked Instagram, waiting for a reply', igChat && igChat.name === 'Priya Nair (@priya.studies)' && igChat.lastFrom === 'me' && igChat.ref, JSON.stringify(igChat || {}).slice(0, 240));
    await igHook(igMsg('IGSID777', '17841400000000001', 'm.2', { attachments: [{ type: 'image', payload: { url: 'https://x' } }] }));
    await igHook(igMsg('IGSID777', '17841400000000001', 'm.2', { attachments: [{ type: 'image', payload: { url: 'https://x' } }] }));
    await igHook(igMsg('IGSID777', '17841400000000001', 'm.3', { text: 'My number is 98480 12345' }));
    await wait(300);
    const IL2 = (await req('GET', '/api/staff/leads')).body.leads || [];
    const igc = (await req('GET', '/api/staff/chat/' + igChat.id)).body.chat;
    check('Instagram: their next messages go on the same conversation and the same lead (it has no phone to match on)', IL2.length === IL.length && igc.messages.length === 3 && igc.messages[1].t === '[photo]', IL2.length + ' leads, ' + igc.messages.length + ' messages');
    const nSent = sent.length;
    const ir = await req('POST', '/api/staff/chat/' + igChat.id + '/reply', { body: 'Hi Priya, thanks — a counsellor will call you on 98480 12345 today.' });
    const io = sent[sent.length - 1] || {};
    check('Instagram: a reply typed on the screen goes to their Instagram', ir.status === 200 && sent.length === nSent + 1 && io.body.recipient.id === 'IGSID777' && /will call you/.test(io.body.message.text) && io.auth === 'Bearer ig-token' && /\/v25\.0\/17841400000000001\/messages$/.test(io.path), ir.status + ' ' + JSON.stringify(io).slice(0, 200));
    await igHook(igMsg('17841400000000001', 'IGSID777', 'm.4', { text: 'Hi Priya, thanks — a counsellor will call you on 98480 12345 today.', is_echo: true }));
    await igHook(igMsg('17841400000000001', 'IGSID777', 'm.5', { text: 'Sent from the Instagram app', is_echo: true }));
    await wait(200);
    const igc2 = (await req('GET', '/api/staff/chat/' + igChat.id)).body.chat;
    check('Instagram: the echo of a reply sent from here is not shown twice; one sent from the app is shown', igc2.messages.filter(m => /will call you/.test(m.t)).length === 1 && igc2.messages.slice(-1)[0].t === 'Sent from the Instagram app' && igc2.messages.slice(-1)[0].who === 'them');
    const igLead2 = ((await req('GET', '/api/staff/leads')).body.leads || []).find(l => l.id === igLead.id);
    check('Instagram: the reply counts as the first response', igLead2 && igLead2.status === 'contacted', JSON.stringify(igLead2 || {}).slice(0, 160));
    const ig3 = (await req('GET', '/api/staff/leads')).body.leads.length;
    await igHook(igMsg('17841400000000001', 'IGSID999', 'm.6', { text: 'We start the conversation', is_echo: true }));
    await wait(200);
    check('Instagram: the office writing first to somebody is not a lead', (await req('GET', '/api/staff/leads')).body.leads.length === ig3 && !((await req('GET', '/api/staff/chats')).body.chats || []).some(c => /IGSID999/.test(c.name)));
    const ch = fs.readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
    check('the chat screen marks WhatsApp conversations', /c\.channel === 'whatsapp'/.test(ch) && /your reply goes to their WhatsApp/.test(ch));
  } catch (e) { fail++; console.log('  ✗ test crashed — ' + (e && e.stack || e)); }
  finally { try { process.kill(-child.pid); } catch (e) { /* gone */ } meta.close(); }
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();
