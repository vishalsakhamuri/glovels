/**
 * Patch 274: a searchable country code on every phone box.
 *
 * The two numbers the office could not call on 6 Nov: a Lahore 0333 861 9199
 * typed into the website chat (stored +91 333 861 9199) and a Dhaka
 * 01872 125908 typed into a blog post's "Ask us about this" (stored
 * 1872125908). Both now arrive with their own country code.
 *
 *   ./srv.sh 8099 GUARD=off && node phonecctest.js
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORT || 8099);
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = async (p, o = {}) => {
  const r = await fetch(BASE + p, { method: o.method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/130' }, o.cookie ? { cookie: o.cookie } : {}), body: o.body ? JSON.stringify(o.body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j, headers: r.headers };
};

(async () => {
  let b;
  try {
    const login = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@glovels.com', password: 'glovels123' } });
    const admin = String(login.headers.get('set-cookie') || '').split(';')[0];
    /* A post from the database, so the page carries the ask form. */
    const ps = (await api('/api/staff/posts?per=50', { cookie: admin })).body;
    const rows = ps.rows || ps.posts || [];
    let post = rows.find(p => p.status === 'published' && p.id) || rows.find(p => p.status === 'draft');
    if (post && post.status !== 'published') {
      const full = (await api('/api/staff/post/' + post.id, { cookie: admin })).body.post;
      post = (await api('/api/staff/post/' + post.id, { method: 'PUT', cookie: admin, body: Object.assign({}, full, { status: 'published' }) })).body.post;
    }

    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));

    /* ---- the script itself */
    const js = await fetch(BASE + '/js/phone.js');
    check('/js/phone.js is served', js.status === 200 && /glvPhoneCc/.test(await js.text()));

    /* ---- the blog form: Bangladesh */
    if (post) {
      const sent = []; p.on('request', r => { if (/\/api\/enquiries$/.test(r.url())) sent.push(JSON.parse(r.postData())); });
      await p.goto(BASE + '/post/' + post.slug, { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
      check('the blog form\'s mobile box has a country code', await p.evaluate(() => !!document.querySelector('#bfPhone').closest('.glv-cc-wrap')));
      check('it starts on India for an Indian visitor', /\+91/.test(await p.textContent('#postForm .glv-cc-btn')));
      await p.click('#postForm .glv-cc-btn'); await p.fill('.glv-cc-pop input', 'bangla');
      check('searching "bangla" finds Bangladesh first', /Bangladesh\+880/.test(await p.textContent('.glv-cc-pop li')));
      await p.keyboard.press('Enter');
      check('picking it shows +880', /\+880/.test(await p.textContent('#postForm .glv-cc-btn')));
      await p.fill('#bfName', 'Faiza Phonetest'); await p.fill('#bfMail', 'faiza.phonetest@example.com'); await p.fill('#bfPhone', '01872 125908'); await p.check('#bfOk');
      check('the page reads the whole number, leading 0 dropped', await p.evaluate(() => document.getElementById('bfPhone').value) === '+880 1872125908');
      await p.waitForTimeout(3200); await p.click('#bfGo'); await p.waitForTimeout(1500);
      check('the blog form sends it', sent.length === 1 && sent[0].phone === '+880 1872125908', JSON.stringify(sent.map(x => x.phone)));
      check('and is accepted', /Thank you/.test(await p.textContent('#bfMsgOut')), await p.textContent('#bfMsgOut'));
      const leads = (await api('/api/staff/leads?per=200', { cookie: admin })).body.leads || [];
      const lead = leads.find(l => l.email === 'faiza.phonetest@example.com');
      check('the lead is stored as +8801872125908', lead && lead.phone === '+8801872125908', lead && lead.phone);
    } else check('a post to test the blog form on', false, 'no post');

    /* ---- search */
    await p.goto(BASE + '/study-in-germany', { waitUntil: 'networkidle' });
    await p.click('.gv-chat-fab'); await p.waitForTimeout(500);
    await p.click('form.gv-intro .glv-cc-btn');
    const first = async t => { await p.fill('.glv-cc-pop input', t); return (await p.textContent('.glv-cc-pop li')).trim(); };
    check('"pak" → Pakistan', /^.*Pakistan\+92$/.test(await first('pak')));
    check('"880" → Bangladesh', /Bangladesh\+880/.test(await first('880')));
    check('"ke" → Kenya', /Kenya\+254/.test(await first('ke')));
    check('"aus" → Australia', /Australia\+61/.test(await first('aus')));
    check('"uae" → United Arab Emirates', /Emirates\+971/.test(await first('uae')));
    check('"1" → United States', /United States\+1/.test(await first('1')));
    check('"44" → United Kingdom', /United Kingdom\+44/.test(await first('44')));
    check('every country is in the list', (await p.evaluate(() => window.glvPhoneCc.list.length)) > 230);
    await p.fill('.glv-cc-pop input', 'pakis'); await p.keyboard.press('Enter');

    /* ---- the chat: Pakistan */
    /* Patch 278: the chat asks for the mobile and the email, both. */
    const box = 'form.gv-intro input[name=phone]';
    const sentChat = []; p.on('request', r => { if (/\/api\/chat\/start/.test(r.url())) sentChat.push(JSON.parse(r.postData())); });
    check('the chat has a mobile box and an email box', await p.$('form.gv-intro input[name=email][type=email][required]') !== null && await p.$(box + '[required]') !== null);
    check('the mobile box has a country code', await p.evaluate(s => !!document.querySelector(s).closest('.glv-cc-wrap'), box));
    await p.fill('form.gv-intro input[name=name]', 'Rehan Phonetest');
    await p.fill(box, '0333 861 9199');
    await p.waitForTimeout(3200); await p.click('form.gv-intro .gv-go'); await p.waitForTimeout(600);
    check('without an email the chat does not start', sentChat.length === 0, JSON.stringify(sentChat));
    await p.fill('form.gv-intro input[name=email]', 'rehan.test@example.com');
    await p.click('form.gv-intro .gv-go'); await p.waitForTimeout(1500);
    check('the chat sends +92 3338619199 and the email', sentChat.length === 1 && sentChat[0].phone === '+92 3338619199' && sentChat[0].email === 'rehan.test@example.com', JSON.stringify(sentChat));
    const chats = (await api('/api/staff/chats', { cookie: admin })).body.chats || [];
    const ch = chats.find(c => c.name === 'Rehan Phonetest');
    check('the chat is stored as +923338619199, not +91…', ch && ch.phone === '+923338619199', ch && ch.phone);
    const leads2 = (await api('/api/staff/leads?per=200', { cookie: admin })).body.leads || [];
    const chl = leads2.find(l => l.name === 'Rehan Phonetest');
    check('and so is its lead', chl && chl.phone === '+923338619199', chl && chl.phone);
    check('the chat and its lead keep the email too', ch && ch.email === 'rehan.test@example.com' && chl && chl.email === 'rehan.test@example.com', (ch && ch.email) + ' / ' + (chl && chl.email));

    /* ---- server: chat start without the script */
    const ctx2 = await b.newContext(); const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/contact-us');
    const raw = await p2.evaluate(async () => { await new Promise(r => setTimeout(r, 3200)); const r = await fetch('/api/chat/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Kenya Raw', contact: '+254 712 345678', page: '/x' }) }); return [r.status, (await r.json()).phone]; });
    check('the chat takes a Kenyan number with its code', raw[0] === 200 && raw[1] === '+254712345678', JSON.stringify(raw));
    const ctx3 = await b.newContext(); const p3 = await ctx3.newPage(); await p3.goto(BASE + '/contact-us');
    const ind = await p3.evaluate(async () => { await new Promise(r => setTimeout(r, 3200)); const r = await fetch('/api/chat/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'India Raw', contact: '98765 43210', page: '/x' }) }); return [r.status, (await r.json()).phone]; });
    check('a bare Indian ten-digit mobile still becomes +91', ind[0] === 200 && ind[1] === '+919876543210', JSON.stringify(ind));
    const ctx4 = await b.newContext(); const p4 = await ctx4.newPage(); await p4.goto(BASE + '/contact-us');
    const noMail = await p4.evaluate(async () => { await new Promise(r => setTimeout(r, 3200)); const r = await fetch('/api/chat/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'No Mail', phone: '+254 712 345679', email: '', page: '/x' }) }); return [r.status, (await r.json()).error]; });
    check('the server refuses a chat with the mobile but no email', (noMail[0] === 422 || noMail[0] === 429) && (noMail[0] === 429 || /email/i.test(noMail[1] || '')), JSON.stringify(noMail));

    /* ---- prefilled numbers split back */
    await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
    const pre = await p.evaluate(() => { const el = document.getElementById('cPhone'); el.value = '+923338619199'; const raw = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(el); return [el.closest('.glv-cc-wrap').querySelector('.glv-cc-btn').textContent, raw, el.value]; });
    check('a stored +92 number shows Pakistan and the rest', /\+92/.test(pre[0]) && pre[1] === '3338619199' && pre[2] === '+92 3338619199', JSON.stringify(pre));
    check('the home contact box no longer says "10-digit"', !(await p.getAttribute('#cPhone', 'placeholder')).includes('10'));

    /* ---- the checkout's own list */
    await p.evaluate(() => { const d = document.createElement('div'); d.className = 'phone-row'; d.innerHTML = window.glvCcSelect('tCc') + '<input id="tPhone" inputmode="tel">'; document.body.prepend(d); });
    await p.waitForTimeout(300);
    check('the checkout\'s code list has every country', (await p.$eval('#tCc', s => s.options.length)) > 230);
    await p.dispatchEvent('#tCc', 'mousedown'); await p.waitForTimeout(200);
    await p.fill('.glv-cc-pop input', 'australia'); await p.keyboard.press('Enter');
    await p.fill('#tPhone', '0412 345 678');
    check('and searches like the others (+61 412 345 678)', await p.evaluate(() => window.glvFullPhone('#tPhone', 'tCc')) === '+61 412 345 678');

    /* ---- sign-up */
    await p.goto(BASE + '/login', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    check('the sign-up mobile has a country code', await p.evaluate(() => !!document.getElementById('lPhone').closest('.glv-cc-wrap')));

    /* ---- a phone screen */
    const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await m.newPage();
    if (post) {
      await mp.goto(BASE + '/post/' + post.slug, { waitUntil: 'networkidle' }); await mp.waitForTimeout(600);
      const w = await mp.evaluate(() => { const wr = document.querySelector('#bfPhone').closest('.glv-cc-wrap'); const r = wr.getBoundingClientRect(); return { w: r.width, page: document.documentElement.scrollWidth, input: document.getElementById('bfPhone').getBoundingClientRect().width }; });
      check('on a phone the box fits and the number has room', w.page <= 392 && w.input > 150, JSON.stringify(w));
    }

    /* ---- office */
    check('no script error on any page', errs.length === 0, errs.join(' | '));
  } catch (e) {
    bad.push('the suite threw: ' + (e && e.stack || e));
  } finally { if (b) await b.close(); }
  ok.forEach(t => console.log('  ok   ' + t));
  bad.forEach(t => console.log('  FAIL ' + t));
  console.log(ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
