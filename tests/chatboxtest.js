/**
 * The chat box on the website, and the screen that answers it.
 *
 * A chat box is easy to fake: a form that posts somewhere and a thank-you. The
 * checks that separate a real one from that are here — a visitor's question
 * reaching a counsellor's open screen, and the counsellor's answer appearing in
 * the visitor's browser with NOTHING refreshed.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();

  /* --------------------------------------------------- the visitor's side */
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const v = await guest.newPage();
  const errs = [];
  v.on('pageerror', e => errs.push(String(e)));
  v.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await v.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await v.waitForSelector('.gv-chat-fab', { timeout: 10000 });
  check('the chat button is on the home page', await v.isVisible('.gv-chat-fab'));
  check('and WhatsApp is above it, which is the one people press',
    await v.isVisible('.gv-wa'));

  /* It has to be on the other marketing pages too — the person reading about
     Germany at eleven at night is the one with the question. */
  const other = await guest.newPage();
  await other.goto(BASE + '/study-in-germany', { waitUntil: 'domcontentloaded' });
  await other.waitForTimeout(1200);
  check('and on the country pages', await other.isVisible('.gv-chat-fab'));

  /* The WhatsApp message says what they were reading, so the counsellor opens
     the conversation already knowing what it is about. */
  const href = await other.getAttribute('.gv-wa', 'href');
  check('WhatsApp carries the office number', /wa\.me\/9\d{10,}/.test(href), href.slice(0, 40));
  check('and a message naming the page they were on',
    decodeURIComponent(href).includes('Germany'),
    decodeURIComponent(href).slice(0, 110));
  await other.close();

  await v.click('.gv-chat-fab');
  await v.waitForSelector('.gv-chat form.gv-intro', { timeout: 8000 });
  check('it asks who you are before anything else',
    await v.isVisible('.gv-chat input[name="name"]'));

  /* A number that is not a number must be refused, or the lead is worthless. */
  await v.fill('.gv-chat input[name="name"]', 'Priya Reddy');
  await v.fill('.gv-chat input[name="contact"]', 'not-a-number');
  await v.click('.gv-chat .gv-go');
  await v.waitForTimeout(900);
  check('a contact that cannot be called back is refused',
    await v.isVisible('.gv-chat .gv-err'),
    (await v.textContent('.gv-chat .gv-err')) || '(no message)');

  await v.fill('.gv-chat input[name="contact"]', '9876543210');
  await v.click('.gv-chat .gv-go');
  await v.waitForSelector('.gv-chat textarea', { timeout: 8000 });
  check('with a real number it opens the conversation',
    await v.isVisible('.gv-chat textarea'));

  await v.fill('.gv-chat textarea', 'Do I need IELTS for a public university in Germany?');
  await v.click('.gv-chat .gv-go');
  await v.waitForTimeout(1200);
  check('the question shows in the visitor\'s own thread',
    (await v.textContent('.gv-body')).includes('Do I need IELTS'));
  check('the box empties after sending',
    (await v.inputValue('.gv-chat textarea')) === '');

  /* ---------------------------------------------------- the office's side */
  const staff = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const s = await staff.newPage();
  const serrs = [];
  s.on('pageerror', e => serrs.push(String(e)));
  s.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && serrs.push(m.text()));

  await s.goto(BASE + '/chat', { waitUntil: 'domcontentloaded' });
  await s.waitForSelector('#chatList li', { timeout: 12000 });
  check('the chat is in the sidebar', (await s.textContent('.p-nav')).includes('Website chat'));
  const listed = await s.textContent('#chatList');
  check('the visitor is listed by name', listed.includes('Priya Reddy'), listed.slice(0, 120));
  check('with the number they left', listed.includes('9876543210'));
  check('and marked as needing a reply', /Needs a reply/.test(listed));
  check('the counter agrees', (await s.textContent('#kOpen')) === '1',
    await s.textContent('#kOpen'));

  await s.click('#chatList [data-chat]');
  await s.waitForSelector('#chatBox', { timeout: 8000 });
  check('the question is on the counsellor\'s screen',
    (await s.textContent('#chatThread')).includes('Do I need IELTS'));

  /* ------------------------------- the half that makes it a chat, not a form */
  const before = (await v.textContent('.gv-body')).length;
  await s.fill('#chatBox', 'No — most public universities in Germany accept a medium-of-instruction letter. IELTS helps, it is not always required.');
  await s.keyboard.press('Enter');
  await wait(2500);
  const after = await v.textContent('.gv-body');
  check('the reply reaches the visitor with nothing refreshed',
    after.includes('medium-of-instruction letter'),
    after.length > before ? after.slice(-90) : 'thread did not change');

  /* ------------------------------------------ and it survives a reload */
  await v.reload({ waitUntil: 'domcontentloaded' });
  await v.waitForTimeout(1800);
  /* It reopens itself when it was open before the reload, which is the right
     behaviour and means there is no button to press. */
  check('a chat left open is still open after a reload',
    await v.isVisible('.gv-chat'), 'panel hidden');
  if (!(await v.isVisible('.gv-chat'))) {
    await v.click('.gv-chat-fab');
    await v.waitForTimeout(1200);
  }
  const back = await v.textContent('.gv-body');
  check('coming back later, the conversation is still there',
    back.includes('Do I need IELTS') && back.includes('medium-of-instruction'),
    back.replace(/\s+/g, ' ').slice(0, 110));
  check('and it does not ask who they are a second time',
    !(await v.isVisible('.gv-chat input[name="name"]')));

  /* --------------------------------- a new question arrives live in the office */
  const staffBefore = (await s.textContent('#chatThread')).length;
  await v.fill('.gv-chat textarea', 'And how long does the visa take?');
  await v.click('.gv-chat .gv-go');
  await wait(2500);
  check('a follow-up appears on the counsellor screen without a refresh',
    (await s.textContent('#chatThread')).includes('how long does the visa take'),
    (await s.textContent('#chatThread')).length + ' vs ' + staffBefore);

  /* ------------------------------------------------- it is a lead as well */
  await s.click('.tab[data-t="enq"]');
  await s.waitForTimeout(1200);
  const enqText = await s.textContent('#enqRows');
  check('the chat is in the enquiry book too, readable, not just counted',
    enqText.includes('Priya Reddy') && enqText.includes('9876543210'),
    enqText.replace(/\s+/g, ' ').slice(0, 120));
  check('and it says it came from the chat', /Chat/.test(enqText));
  await s.click('.tab[data-t="live"]');
  await s.waitForTimeout(400);
  await s.click('#chatList [data-chat]');
  await s.waitForSelector('#chatBox', { timeout: 8000 });

  /* ------------------------------------------------------ marking it done */
  await s.click('#chatDone');
  await s.waitForTimeout(1200);
  check('it can be marked done', /Reopen/.test(await s.textContent('#chatPane')));

  /* --------------------- a signed-in student gets their real thread instead */
  const stu = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const sp = await stu.newPage();
  await sp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sp.waitForSelector('.gv-chat-fab', { timeout: 10000 });
  await sp.click('.gv-chat-fab');
  await sp.waitForTimeout(1200);
  check('a signed-in student is not asked for their name again',
    !(await sp.isVisible('.gv-chat input[name="name"]')));
  const thread = await sp.textContent('.gv-chat');
  check('they see their real conversation with their counsellor',
    thread.length > 200 && /counsellor/i.test(thread), thread.replace(/\s+/g, ' ').slice(0, 100));

  await sp.fill('.gv-chat textarea', 'Sent from the chat box on the home page.');
  await sp.click('.gv-chat .gv-go');
  await wait(1500);
  const st = await (await stu.request.get(BASE + '/api/state')).json();
  check('what they type goes into that same thread, not a second one',
    (st.msgs || []).some(m => m.t === 'Sent from the chat box on the home page.'),
    (st.msgs || []).length + ' messages');

  /* ------------------------------------------- the portal's own corner */
  /* Inside the portal there is no WhatsApp and no intro form: they are past
     being sold to, and the server already knows who they are. */
  const dash = await stu.newPage();
  const derr = [];
  dash.on('pageerror', e => derr.push(String(e)));
  await dash.goto(BASE + '/documents', { waitUntil: 'domcontentloaded' });
  await dash.waitForTimeout(2000);
  check('a portal screen has the chat button', await dash.isVisible('.gv-chat-fab'));
  check('and no WhatsApp button', !(await dash.isVisible('.gv-wa')));
  check('it says whose thread it opens',
    /counsellor/i.test(await dash.textContent('.gv-chat-fab')),
    (await dash.textContent('.gv-chat-fab')).trim());

  await dash.click('.gv-chat-fab');
  await dash.waitForTimeout(1300);
  check('it opens the thread without asking who they are',
    !(await dash.isVisible('.gv-chat input[name="name"]'))
    && (await dash.isVisible('.gv-chat textarea')));
  check('with the conversation already in it',
    (await dash.textContent('.gv-body')).length > 100,
    (await dash.textContent('.gv-body')).replace(/\s+/g, ' ').slice(0, 80));

  await dash.fill('.gv-chat textarea', 'Asked from the documents screen.');
  await dash.click('.gv-chat .gv-go');
  await wait(1600);
  const st2 = await (await stu.request.get(BASE + '/api/state')).json();
  check('what they type reaches their counsellor thread',
    (st2.msgs || []).some(m => m.t === 'Asked from the documents screen.'),
    (st2.msgs || []).length + ' messages');
  check('no errors on a portal screen', derr.length === 0, derr.slice(0, 2).join(' | '));

  /* The Messages screen IS the thread; a floating button over it offering to
     open the thread is furniture. */
  const msgs = await stu.newPage();
  await msgs.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await msgs.waitForTimeout(1500);
  check('the Messages screen has no floating button',
    (await msgs.$$('.gv-chat-fab')).length === 0);
  await msgs.close();

  /* The 422 is the refused contact number, which is a check above. */
  check('no errors on the website',
    errs.filter(e => !/422/.test(e)).length === 0, errs.slice(0, 2).join(' | '));
  check('no errors in the office', serrs.length === 0, serrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
