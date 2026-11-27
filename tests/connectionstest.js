/**
 * Patch 328: WhatsApp and Instagram set up on Organisation → Settings.
 *
 * The server starts with NO WhatsApp or Instagram settings in its
 * environment (only the address of a local stand-in for Meta). An admin types
 * them on the Connections card; from then on messages are verified with the
 * secret typed there, come in as leads, and replies go out with the token
 * typed there. Secrets are never sent back whole. Nobody but an admin may
 * read or change them. An Instagram token is renewed.
 *
 *   node connectionstest.js        (its own server on 8328, the stand-in on 8329)
 */
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8328), META = PORT + 1;
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; if (!c) console.log('  ✗ ' + n + (note == null ? '' : ' — ' + String(note).slice(0, 300))); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const WA_TOKEN = 'EAAG-wa-token-ABCD1234', WA_SECRET = 'wa-secret-9876', IG_TOKEN = 'IGAA-ig-token-WXYZ5555', IG_SECRET = 'ig-secret-4321';
const seen = [];
let igToken = IG_TOKEN;
const meta = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b });
    const ok = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const no = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && /^\/v21\.0\/1234567890123\?fields=display_phone_number,verified_name/.test(req.url)) {
      return req.headers.authorization === 'Bearer ' + WA_TOKEN ? ok({ display_phone_number: '+91 70933 14089', verified_name: 'Glovels', id: '1234567890123' }) : no(401, { error: { message: 'Invalid OAuth access token' } });
    }
    if (req.method === 'GET' && /^\/v25\.0\/me\?/.test(req.url)) {
      return req.headers.authorization === 'Bearer ' + igToken ? ok({ user_id: '17841400000000009', username: 'glovels' }) : no(400, { error: { message: 'Invalid token' } });
    }
    if (req.method === 'GET' && /^\/refresh_access_token\?grant_type=ig_refresh_token/.test(req.url)) {
      igToken = 'IGAA-renewed-7777'; return ok({ access_token: igToken, token_type: 'bearer', expires_in: 5184000 });
    }
    if (req.method === 'GET' && /\/v25\.0\/IGSID555\?/.test(req.url)) return ok({ name: 'Rahul S', username: 'rahul.s', id: 'IGSID555' });
    if (req.method === 'POST') return ok({ messages: [{ id: 'wamid.out' }], message_id: 'mid.out' });
    no(404, {});
  });
}).listen(META);

(async () => {
  const dir = '/tmp/db-conn-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', BOTGATE: 'off',
    WHATSAPP_GRAPH: 'http://localhost:' + META, INSTAGRAM_GRAPH: 'http://localhost:' + META });
  ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'INSTAGRAM_TOKEN', 'INSTAGRAM_ACCOUNT_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN'].forEach(k => { delete env[k]; });
  const start = () => spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore', env });
  let child = start();
  const B = 'http://localhost:' + PORT;
  const up = async () => { for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(B + '/api/health')).ok) return; } catch (e) { /* booting */ } } };
  const login = async (email) => {
    const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'glovels123' }) });
    return lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  };
  try {
    await up();
    let cookie = await login('admin@glovels.com');
    const req = async (method, p, body, ck) => { const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', cookie: ck || cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) { j = {}; } return { status: r.status, body: j, text: t }; };
    const sign = (raw, secret) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const waHook = async (payload, secret) => { const raw = Buffer.from(JSON.stringify(payload)); return (await fetch(B + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw, secret) }, body: raw })).status; };
    const igHook = async (payload, secret) => { const raw = Buffer.from(JSON.stringify(payload)); return (await fetch(B + '/api/instagram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw, secret) }, body: raw })).status; };
    const waMsg = (from, name, id, t) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '1234567890123' }, contacts: [{ profile: { name }, wa_id: from }],
      messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: t } }] } }] }] });

    /* ------------------------------------------------------- before */
    let g = await req('GET', '/api/staff/connections');
    check('the card reads as not connected before anything is typed', g.status === 200 && !g.body.whatsapp.connected && !g.body.whatsapp.verified && !g.body.instagram.connected, JSON.stringify(g.body).slice(0, 200));
    check('it gives the callback addresses to paste into Meta', /\/api\/whatsapp\/webhook$/.test(g.body.whatsapp.webhook) && /\/api\/instagram\/webhook$/.test(g.body.instagram.webhook));
    check('a message before the secret is typed is refused', (await waHook(waMsg('919811111111', 'Early', 'e1', 'hi'), WA_SECRET)) === 503);

    /* ------------------------------------------------------- who may */
    const kc = await login('kavya@glovels.com');
    check('a counsellor cannot read the connections', (await req('GET', '/api/staff/connections', undefined, kc)).status === 403);
    check('nor change them', (await req('PUT', '/api/staff/connections', { side: 'whatsapp', token: 'x' }, kc)).status === 403);
    check('nor without signing in', (await fetch(B + '/api/staff/connections')).status === 401);

    /* ------------------------------------------------------- WhatsApp */
    let p = await req('PUT', '/api/staff/connections', { side: 'whatsapp', phoneId: '+91 70933 14089' });
    check('a phone number typed where the number ID goes is refused, saying why', p.status === 422 && /digits only|not the phone number/.test(p.body.error || ''), JSON.stringify(p.body));
    p = await req('PUT', '/api/staff/connections', { side: 'whatsapp', token: WA_TOKEN, phoneId: '1234567890123', appSecret: WA_SECRET, verify: 'glovels-wa' });
    check('saving WhatsApp asks Meta and says it works, with the number and name', p.status === 200 && p.body.check && p.body.check.ok && /70933 14089/.test(p.body.check.said) && /Glovels/.test(p.body.check.said), JSON.stringify(p.body.check));
    check('it now reads as connected', p.body.whatsapp.connected && p.body.whatsapp.verified && p.body.whatsapp.number === '+91 70933 14089');
    check('the token and secret come back only as their last four characters', p.body.whatsapp.token === '••••1234' && p.body.whatsapp.appSecret === '••••9876' && !p.text.includes(WA_TOKEN) && !p.text.includes(WA_SECRET), p.body.whatsapp.token + ' ' + p.body.whatsapp.appSecret);
    check('the GET never has them either', !(await req('GET', '/api/staff/connections')).text.includes(WA_TOKEN));
    const v = await fetch(B + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=glovels-wa&hub.challenge=4242');
    check('Meta’s handshake works with the verify token typed on the card', v.status === 200 && (await v.text()) === '4242');
    check('and not with another word', (await fetch(B + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=glovels&hub.challenge=1')).status === 403);
    check('a message signed with the secret typed on the card comes in', (await waHook(waMsg('919822222222', 'Meera Iyer', 'wamid.c1', 'Hello, Canada for MBA?'), WA_SECRET)) === 200);
    await wait(300);
    const lead = ((await req('GET', '/api/staff/leads')).body.leads || []).find(l => /9822222222/.test(String(l.phone || '').replace(/\D/g, '')));
    check('and becomes a WhatsApp lead', lead && lead.source === 'whatsapp' && lead.name === 'Meera Iyer', JSON.stringify(lead || {}).slice(0, 200));
    check('one signed with another secret is refused', (await waHook(waMsg('919833333333', 'X', 'wamid.c2', 'hi'), 'wrong')) === 403);
    g = await req('GET', '/api/staff/connections');
    check('the card says when the last message came in', g.body.whatsapp.lastIn && /T/.test(g.body.whatsapp.lastIn.at));
    check('and that Meta sent something that did not verify', g.body.whatsapp.lastBad && /app secret/.test(g.body.whatsapp.lastBad.detail));
    check('and that Meta checked the address', g.body.whatsapp.lastHello && !!g.body.whatsapp.lastHello.at);
    const chat = ((await req('GET', '/api/staff/chats')).body.chats || []).find(c => c.channel === 'whatsapp');
    seen.length = 0;
    const rep = await req('POST', '/api/staff/chat/' + chat.id + '/reply', { body: 'Yes — let us talk. When can you take a call?' });
    const out = seen.find(x => x.method === 'POST' && /\/v21\.0\/1234567890123\/messages/.test(x.url));
    check('a reply goes out on WhatsApp with the token typed on the card', rep.status === 200 && out && out.auth === 'Bearer ' + WA_TOKEN, rep.status + ' ' + JSON.stringify(rep.body).slice(0, 160));
    p = await req('PUT', '/api/staff/connections', { side: 'whatsapp', token: '••••1234', appSecret: '', phoneId: '1234567890123', verify: 'glovels-wa' });
    check('saving again with the boxes left as they were keeps the token and secret', p.status === 200 && p.body.check.ok && p.body.whatsapp.verified, JSON.stringify(p.body.check));
    p = await req('PUT', '/api/staff/connections', { side: 'whatsapp', token: 'EAAG-wrong-0000' });
    check('a wrong token is saved but said plainly not to work', p.status === 200 && p.body.check && !p.body.check.ok && /401|Invalid/.test(p.body.check.said), JSON.stringify(p.body.check));
    await req('PUT', '/api/staff/connections', { side: 'whatsapp', token: WA_TOKEN });

    /* ------------------------------------------------------- Instagram */
    p = await req('PUT', '/api/staff/connections', { side: 'instagram', token: IG_TOKEN, accountId: '17841400000000009', appSecret: IG_SECRET, verify: 'glovels-ig' });
    check('saving Instagram asks Meta and says which account', p.status === 200 && p.body.check.ok && p.body.check.said === '@glovels' && p.body.instagram.username === 'glovels', JSON.stringify(p.body.check));
    check('Instagram secrets come back masked too', !p.text.includes(IG_TOKEN) && !p.text.includes(IG_SECRET) && p.body.instagram.token === '••••5555');
    const igv = await fetch(B + '/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=glovels-ig&hub.challenge=99');
    check('the Instagram handshake works with its verify token', igv.status === 200 && (await igv.text()) === '99');
    const igm = { object: 'instagram', entry: [{ id: '17841400000000009', time: Date.now(), messaging: [{ sender: { id: 'IGSID555' }, recipient: { id: '17841400000000009' }, timestamp: Date.now(), message: { mid: 'mid.c1', text: 'Is Germany free for masters?' } }] }] };
    check('an Instagram message signed with the secret typed here comes in', (await igHook(igm, IG_SECRET)) === 200);
    await wait(400);
    const ilead = ((await req('GET', '/api/staff/leads')).body.leads || []).find(l => l.source === 'instagram');
    check('and becomes an Instagram lead', ilead && /Rahul S/.test(ilead.name), JSON.stringify(ilead || {}).slice(0, 200));
    p = await req('POST', '/api/staff/connections/instagram/renew');
    check('Renew token now swaps in the new token', p.status === 200 && p.body.instagram.token === '••••7777' && p.body.instagram.expiresAt && p.body.instagram.renewedAt, JSON.stringify(p.body.instagram).slice(0, 200));
    const days = (Date.parse(p.body.instagram.expiresAt) - Date.now()) / 86400000;
    check('good for 60 days from now', days > 59 && days < 61, days);
    seen.length = 0;
    await req('POST', '/api/staff/chat/' + ((await req('GET', '/api/staff/chats')).body.chats || []).find(c => c.channel === 'instagram').id + '/reply', { body: 'Public universities charge no tuition, yes.' });
    const igOut = seen.find(x => x.method === 'POST' && /\/messages/.test(x.url));
    check('and replies go out with the renewed token', igOut && igOut.auth === 'Bearer IGAA-renewed-7777', igOut && igOut.auth);

    /* ------------------------------------------------------- a restart keeps it */
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
    await wait(1500);
    child = start(); await up();
    cookie = await login('admin@glovels.com');
    g = await req('GET', '/api/staff/connections');
    check('after a restart both are still connected', g.body.whatsapp.connected && g.body.whatsapp.verified && g.body.instagram.connected && g.body.instagram.verified, JSON.stringify(g.body).slice(0, 200));
    check('a message after the restart still verifies', (await waHook(waMsg('919844444444', 'After Restart', 'wamid.r1', 'hello again'), WA_SECRET)) === 200);
    p = await req('PUT', '/api/staff/connections', { side: 'whatsapp', appSecret: 'remove' });
    check('typing remove clears a secret', p.status === 200 && !p.body.whatsapp.verified);
    const logs = (await req('GET', '/api/staff/content')).text || '';
    check('no secret is written to the activity log', /"audit"/.test(logs) && /connection saved/.test(logs) && !logs.includes(WA_TOKEN) && !logs.includes(IG_TOKEN) && !logs.includes(WA_SECRET));
  } catch (e) {
    fail++; console.log('  ✗ the suite threw: ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
    meta.close();
  }
  console.log('\nconnectionstest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
