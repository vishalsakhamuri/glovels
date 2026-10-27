/*
 * Round 169 — the student portal and partner items from the 12 Oct report.
 *
 *   STU-02  one progress model on the dashboard, from the applications
 *   STU-03  dashboard and My Programs read one catalogue record; withdrawn
 *           programmes have their own "No longer offered" group
 *   STU-05  document delete asks inline; accepted documents cannot be deleted
 *   STU-06  plain wording at the foot of Documents
 *   STU-07  booking from Services stays in the portal, on the account
 *   STU-09  the smaller items (profile text, readiness, sidebar name, loading
 *           state, logos, unread badge, upload wording, scholarships)
 *   B2B-01..04, Oct-10 #8  partner add checks, closed files, admin label,
 *           logo, SOP "Not included", inline Remove
 *
 * Port 8103 by default:  cd tests && bash srv.sh 8103 && node round169studenttest.js
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8103';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };
const J = x => JSON.stringify(x);
const stamp = Date.now();
const PW = 'glovels123';

(async () => {
  const b = await chromium.launch();
  const errs = [];
  let ipn = 1;
  const ctx = async (email, password, vp) => {
    const c = await b.newContext({ viewport: vp || { width: 1440, height: 1000 },
      extraHTTPHeaders: { 'x-forwarded-for': '10.169.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)) } });
    if (email) {
      const r = await c.request.post(BASE + '/api/auth/login', { data: { email, password: password || PW } });
      if (!r.ok()) console.log('    · login ' + email + ' → ' + r.status());
    }
    return c;
  };
  const page = async (c, path) => {
    /* One page per context at a time: the portal holds a live connection
       open, and six of them use up the browser's connections to one host. */
    for (const old of c.pages()) await old.close().catch(() => {});
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(path + ': ' + e.message));
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);
    return p;
  };
  const getJ = async (c, path) => { const r = await c.request.get(BASE + path); return { status: r.status(), body: await r.json().catch(() => ({})) }; };

  const S = await ctx('student@glovels.com');
  const A = await ctx('admin@glovels.com');
  const C = await ctx('kavya@glovels.com');

  /* ------------------------------------------------------------ STU-02 */
  let st = (await getJ(S, '/api/state')).body;
  const me = st.user || {};
  const Jy = st.journey;
  ok('STU-02 /api/state carries one journey model', Jy && Array.isArray(Jy.stages) && Jy.stages.length === 6, J(Jy && Jy.stages && Jy.stages.length));
  ok('STU-02 the step number and the done count agree (done = step - 1)', Jy && (Jy.finished || Jy.done === Jy.step - 1), Jy && (Jy.step + ' / ' + Jy.done));
  ok('STU-02 stages are monotone: every stage before the step is done, none after it is',
    Jy && Jy.stages.every((x, i) => i < Jy.step - 1 ? x.state === 'done' : x.state !== 'done'), J(Jy && Jy.stages.map(x => x.state)));
  const subApps = Object.values(st.apps || {});
  ok('STU-02 the applying stage counts the applications on the list',
    Jy && Jy.apps.live === subApps.length && new RegExp(Jy.apps.submitted + ' of ' + Jy.apps.live).test(Jy.stages[3].detail),
    J({ apps: Jy && Jy.apps, detail: Jy && Jy.stages[3].detail, n: subApps.length }));
  ok('STU-02 dates are "31 Dec 2026", never 2026-12-31',
    Jy && Jy.stages.every(x => (!x.by || /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(x.by)) && (!x.on || /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(x.on))),
    J(Jy && Jy.stages.map(x => [x.by, x.on])));
  ok('STU-02 nothing about lateness or the office leaks into it', !/late|overdue|owner|counsellor_id|behind/i.test(J(Jy)), J(Jy).slice(0, 200));

  let d = await page(S, '/dashboard');
  const ph = await d.$eval('#progPhase', e => e.textContent.replace(/\s+/g, ' ').trim());
  const cnt = await d.$eval('#progCount', e => e.textContent.trim());
  ok('STU-02 dashboard: "Step N of 6" beside "N-1 of 6 done"', new RegExp('Step ' + Jy.step + ' of 6').test(ph) && cnt === Jy.done + ' of 6 done', ph + ' | ' + cnt);
  ok('STU-02 dashboard: six stages listed', (await d.$$('#progList > li')).length === 6);
  ok('STU-02 dashboard: the old Application tracker / Your journey cards and the 4-step strip are gone',
    await d.$eval('#trackCols', e => e.hidden) && await d.$eval('#steps4', e => e.hidden));
  const progTxt = await d.$eval('#progSec', e => e.textContent);
  ok('STU-02 dashboard: no ISO dates in the progress card', !/\d{4}-\d{2}-\d{2}/.test(progTxt), progTxt.slice(0, 160));

  /* ------------------------------------------------- STU-09.5: logos */
  const logos = await d.$$eval('#slWrap img.sl-logo', l => l.map(i => ({ w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, nw: i.naturalWidth })));
  ok('STU-09.5 shortlist logos load and are drawn at a readable size (not an 18px square)',
    logos.length > 0 && logos.every(x => x.nw > 0 && x.h >= 24 && x.w > 30), J(logos.slice(0, 4)));

  /* ------------------------------------------------- STU-09.2: readiness */
  const sid = me.id;
  const caseR = await getJ(C, '/api/staff/student/' + sid);
  ok('STU-09.2 the counsellor’s case carries the same readiness as the student',
    caseR.body.readiness && st.readiness && caseR.body.readiness.ok === st.readiness.ok && caseR.body.readiness.of === st.readiness.of,
    J({ c: caseR.body.readiness && [caseR.body.readiness.ok, caseR.body.readiness.of], s: st.readiness && [st.readiness.ok, st.readiness.of] }));
  /* Send the passport back for a new copy, then both screens must say the same thing. */
  const hasPass = (st.docs || {}).passport;
  if (hasPass) await C.request.post(BASE + '/api/staff/student/' + sid + '/document/passport', { data: { status: 'rescan', note: 'Blurred' } });
  st = (await getJ(S, '/api/state')).body;
  d = await page(S, '/dashboard');
  const dashPass = await d.$$eval('#docReady .doclist li', l => (l.find(x => /Passport/.test(x.textContent)) || {}).textContent || '');
  const dashNote = await d.$eval('#docReady .ready-note', e => e.textContent);
  const docsP = await page(S, '/documents');
  const docPass = await docsP.evaluate(() => {
    const c = [...document.querySelectorAll('#docGrid > *')].find(x => /Passport/.test(x.textContent));
    return c ? c.textContent : '';
  });
  ok('STU-09.2 passport status: the dashboard uses the Documents wording ("Send a scanned copy" / "Accepted")',
    hasPass ? (/Send a scanned copy/i.test(dashPass) && /Send a scanned copy/i.test(docPass)) : /Not uploaded/i.test(dashPass),
    dashPass + ' || ' + docPass.slice(0, 120));
  ok('STU-09.2 the dashboard ring counts what the server counts', dashNote.startsWith(st.readiness.ok + ' of ' + st.readiness.of) || /Every document/.test(dashNote), dashNote);
  if (hasPass) await C.request.post(BASE + '/api/staff/student/' + sid + '/document/passport', { data: { status: 'ok' } });

  /* ------------------------------------------------- STU-09.3 sidebar name */
  d = await page(S, '/dashboard');
  const nm = await d.$eval('#whoName', e => ({ t: e.textContent, title: e.title, cut: e.scrollWidth > e.clientWidth + 1 }));
  ok('STU-09.3 the sidebar name is whole (no ellipsis at this width) and has a title', !nm.cut && nm.title === nm.t && nm.t.length > 4, J(nm));

  /* ------------------------------------------------- STU-06 / 09.8 / 05 */
  const docsP2 = await page(S, '/documents');
  const docTxt = await docsP2.evaluate(() => document.body.innerText);
  ok('STU-06 no developer text on Documents', !/data\/uploads|encrypted storage|endpoint/i.test(docTxt));
  ok('STU-06 the one plain sentence instead', /Your files are stored securely and only you and your counsellor can open them\./.test(docTxt));
  ok('STU-09.8 the upload wording names the accepted types', /PDF, JPG, PNG, HEIC or Word/.test(docTxt) && !/PDF, a photo or Word/.test(docTxt));

  /* Upload a CV as the student (status wait), then remove it — inline confirm. */
  const up = await S.request.post(BASE + '/api/documents', { multipart: {
    key: 'cv', file: { name: 'cv-' + stamp + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') } } });
  ok('STU-05 setup: a CV uploads', up.ok(), up.status() + ' ' + (await up.text()).slice(0, 120));
  const dp = await page(S, '/documents');
  const deletes = [];
  dp.on('request', r => { if (r.method() === 'DELETE') deletes.push(r.url()); });
  let dialogs = 0; dp.on('dialog', async dg => { dialogs++; await dg.dismiss(); });
  const rmBtn = await dp.$('#docGrid [data-dropfile]');
  ok('STU-05 the per-file button reads "Remove this file"', rmBtn && (await rmBtn.textContent()).trim() === 'Remove this file', rmBtn ? await rmBtn.textContent() : 'none');
  ok('STU-05 the slot button reads "Clear this document"', !!(await dp.$('#docGrid [data-rm]')) && /Clear this document/.test(await dp.$eval('#docGrid [data-rm]', e => e.textContent)));
  if (rmBtn) {
    await rmBtn.click(); await dp.waitForTimeout(500);
    ok('STU-05 one press asks inline and deletes nothing', deletes.length === 0 && !!(await dp.$('.dconfirm [data-cfyes]')) && dialogs === 0, J(deletes));
    await dp.click('.dconfirm [data-cfno]'); await dp.waitForTimeout(300);
    ok('STU-05 "Keep it" puts the button back and still deletes nothing', deletes.length === 0 && !(await dp.$('.dconfirm')));
    await dp.click('#docGrid [data-dropfile]'); await dp.waitForTimeout(300);
    await dp.click('.dconfirm [data-cfyes]'); await dp.waitForTimeout(1200);
    ok('STU-05 "Yes, remove" deletes that one file', deletes.length === 1 && /\/api\/documents\/file\//.test(deletes[0]), J(deletes));
  }
  /* An accepted document: no delete control, and the server refuses. */
  st = (await getJ(S, '/api/state')).body;
  const okKey = Object.keys(st.docs || {}).find(k => st.docs[k].status === 'ok' && (st.docs[k].files || []).some(f => f.by !== 'staff'));
  if (okKey) {
    const fileId = st.docs[okKey].files.find(f => f.by !== 'staff').id;
    const r1 = await S.request.delete(BASE + '/api/documents/file/' + fileId);
    const b1 = await r1.json().catch(() => ({}));
    ok('STU-05 server: DELETE on an accepted file → 409 with a message', r1.status() === 409 && /counsellor/i.test(b1.error || ''), r1.status() + ' ' + J(b1));
    const r2 = await S.request.delete(BASE + '/api/documents/' + okKey);
    ok('STU-05 server: clearing an accepted document → 409', r2.status() === 409, r2.status());
    const dp2 = await page(S, '/documents');
    const card = await dp2.evaluate(k => {
      const btn = document.querySelector('#docGrid [data-drop="' + k + '"]');
      const c = btn && btn.closest('#docGrid > *');
      return c ? { txt: c.textContent, rm: !!c.querySelector('[data-dropfile],[data-rm]') } : null;
    }, okKey);
    ok('STU-05 an accepted card says "Ask your counsellor to replace this" and has no delete button',
      card && /Ask your counsellor to replace this/.test(card.txt) && !card.rm, J(card));
  } else ok('STU-05 an accepted document exists to test against', false, J(Object.keys(st.docs || {})));

  /* ------------------------------------------------- STU-03 */
  st = (await getJ(S, '/api/state')).body;
  const cat = (await getJ(S, '/api/catalogue')).body.programmes || [];
  const pick = st.shortlist.find(r => cat.some(p => String(p.id) === String(r.id)) && (r.intakes || []).length);
  if (pick) {
    const live = cat.find(p => String(p.id) === String(pick.id));
    const moved = (live.intakes || []).map(i => ({ season: i.season, deadline: i.deadline.replace(/-\d{2}$/, '-09') }));
    const put = await A.request.put(BASE + '/api/staff/programme', { data: Object.assign({}, live, { id: live.id, intakes: moved }) });
    ok('STU-03 setup: the office moves a shortlisted programme’s deadline', put.ok(), put.status() + ' ' + (await put.text()).slice(0, 160));
    const after = (await getJ(S, '/api/state')).body.shortlist.find(r => String(r.id) === String(pick.id));
    ok('STU-03 the dashboard’s row reads the live catalogue record, not the copy taken when it was added',
      J((after.intakes || []).map(i => i.deadline)) === J(moved.map(i => i.deadline)), J({ row: after.intakes, moved }));
  } else ok('STU-03 a shortlisted programme with intakes exists', false);

  const goneId = (st.shortlist.find(r => r.addedBy === 'matched') || st.shortlist[0] || {}).id;
  const del = await A.request.delete(BASE + '/api/staff/programme/' + encodeURIComponent(goneId));
  ok('STU-03 setup: the office withdraws a shortlisted programme', del.ok(), del.status());
  const gRow = (await getJ(S, '/api/state')).body.shortlist.find(r => String(r.id) === String(goneId));
  ok('STU-03 the shortlist row is marked withdrawn', gRow && gRow.withdrawn, J(gRow));
  d = await page(S, '/dashboard');
  const dash3 = await d.evaluate(() => ({
    gone: !!document.getElementById('slGone'),
    goneRows: [...document.querySelectorAll('table.sl-gone tbody tr')].map(t => t.textContent),
    matchedRows: [...document.querySelectorAll('#slWrap table.sl-tbl:not(.sl-gone) tbody tr')].map(t => t.textContent),
  }));
  ok('STU-03 dashboard: a "No longer offered" group holds it', dash3.gone && dash3.goneRows.length >= 1 && /No longer offered/.test(dash3.goneRows[0]), J(dash3.goneRows));
  ok('STU-03 dashboard: nothing in the main table is marked "No longer offered"', !dash3.matchedRows.some(t => /No longer offered/.test(t)));
  const u = await page(S, '/universities');
  const uni3 = await u.evaluate(() => {
    const g = document.getElementById('goneGroup');
    const heads = [...document.querySelectorAll('#mineWrap h3')].map(h => h.textContent);
    return { gone: g ? g.textContent : '', heads };
  });
  ok('STU-03 My Programs: its own "No longer offered" group', /No longer offered/.test(uni3.heads.join('|')) && uni3.gone.length > 0, J(uni3.heads));
  const matchedHasGone = await u.evaluate(() => {
    const hs = [...document.querySelectorAll('#mineWrap h3')];
    const h = hs.find(x => /Matched to your profile/.test(x.textContent));
    if (!h) return false;
    const grid = h.closest('div').nextElementSibling;
    return !!grid && /No longer offered — check/.test(grid.textContent);
  });
  ok('STU-03 My Programs: "Matched to your profile" no longer lists a withdrawn programme', !matchedHasGone);

  /* ------------------------------------------------- STU-09.4 loading state */
  const raw = await (await S.request.get(BASE + '/universities')).text();
  ok('STU-09.4 My Programs starts with a loading state, not "0 / 0"',
    /Loading your programmes/.test(raw) && !/id="nMine">0</.test(raw) && !/id="nAll">0</.test(raw));

  /* ------------------------------------------------- STU-09.1 profile text */
  const pp = await page(S, '/profile');
  const lead = await pp.$eval('#pcLead', e => e.textContent);
  ok('STU-09.1 with a shortlist, the profile card does not say the shortlist starts at 100%',
    !/starts the shortlist once this reaches 100%/.test(lead) && /shortlist is under way/i.test(lead), lead);

  /* ------------------------------------------------- STU-09.6 unread badge */
  await C.request.post(BASE + '/api/staff/student/' + sid + '/message', { data: { body: 'Round 169 check ' + stamp } });
  d = await page(S, '/dashboard');
  const before = await d.$eval('.p-nav a[href="messages.html"]', a => a.textContent);
  const mp = await page(S, '/messages');
  await mp.waitForTimeout(1200);
  const badge = await mp.$('.p-nav a[href="messages.html"] .nav-n');
  ok('STU-09.6 the unread badge is gone once the messages are open', /\d/.test(before) && !badge, before + ' → ' + (badge ? await badge.textContent() : 'none'));

  /* ------------------------------------------------- STU-09.7 sender label */
  const sent = (await getJ(S, '/api/state')).body.msgs.filter(m => m.who === 'them').pop();
  ok('STU-09.7 a message from staff carries the sender’s own name (never a partner’s)', sent && sent.from === 'Kavya Menon', J(sent));

  /* ------------------------------------------------- STU-09.10 scholarships */
  const em = 'r169s' + stamp + '@ex.example';
  const N = await ctx(null);
  const su = await N.request.post(BASE + '/api/auth/signup', { data: { name: 'Round Nine', email: em, phone: '9876501690', password: 'Round169-pass!', terms: true } });
  const nid = ((await su.json().catch(() => ({}))).user || {}).id;
  const deId = (cat.find(p => p.country === 'DE' && /M\.?\s?Sc|Master/i.test(p.program || '')) || {}).id;
  if (nid && deId) {
    /* Round 175: a closed-deadline programme is a 409 until "Add anyway" (force). */
    await A.request.post(BASE + '/api/staff/student/' + nid + '/shortlist', { data: { id: deId, force: true } });
    const sp = await page(N, '/scholarships');
    const dest = await sp.$eval('#pCountry', e => e.textContent).catch(() => '');
    const lvl = await sp.$eval('#pLevel', e => e.textContent).catch(() => '');
    ok('STU-09.10 scholarships: destination and level come from the student’s German master’s shortlist when the profile is blank',
      /Germany/.test(dest) && /Master/.test(lvl), dest + ' | ' + lvl);
  } else ok('STU-09.10 setup', false, J({ nid, deId, s: su.status() }));

  /* ------------------------------------------------- STU-09.9 services tabs */
  const sv = await page(S, '/services');
  const tabs = await sv.$$eval('#svcTabs [data-svccat]', l => l.map(t => t.textContent.trim()));
  ok('STU-09.9 every Services tab shown has services behind it', tabs.length > 0 && tabs.every(t => /\d+$/.test(t) && !/ 0$/.test(t)), J(tabs));

  /* ------------------------------------------------- STU-07 booking */
  const navs = []; sv.on('framenavigated', f => { if (f === sv.mainFrame()) navs.push(f.url()); });
  const orderPosts = []; sv.on('request', r => { if (r.method() === 'POST' && /\/api\/orders$/.test(r.url())) orderPosts.push(r.postDataJSON()); });
  const ordersBefore = ((await getJ(S, '/api/state')).body.orders || []).length;
  const bookBtn = await sv.$('#svcList [data-svcbook]');
  ok('STU-07 "Book this" is a portal button, not a link to the public basket', !!bookBtn && !(await sv.$('#svcList a[href^="index.html#service-"]')));
  if (bookBtn) {
    await bookBtn.click(); await sv.waitForTimeout(500);
    const f = await sv.evaluate(() => ({
      name: (document.getElementById('svcCoName') || {}).value, nameRO: (document.getElementById('svcCoName') || {}).readOnly,
      mail: (document.getElementById('svcCoMail') || {}).value, mailRO: (document.getElementById('svcCoMail') || {}).readOnly,
      phone: (document.getElementById('svcCoPhone') || {}).value,
    }));
    ok('STU-07 name, mobile and email come from the account and are locked',
      f.name === me.name && f.mail === me.email && f.nameRO && f.mailRO && !!f.phone, J(f));
    await sv.click('#svcCoPay'); await sv.waitForTimeout(300);
    ok('STU-07 the terms must be ticked first', /accept the terms/i.test(await sv.$eval('#svcCoErr', e => e.textContent)) && orderPosts.length === 0);
    await sv.check('#svcCoOk'); await sv.click('#svcCoPay'); await sv.waitForTimeout(1800);
    ok('STU-07 the booking is confirmed inside the portal (no trip to the home page)',
      !!(await sv.$('#svcCoDone')) && !navs.some(u2 => /index\.html|\/$/.test(u2.replace(BASE, ''))) && /\/services/.test(sv.url()), J(navs));
    const ordersAfter = ((await getJ(S, '/api/state')).body.orders || []).length;
    ok('STU-07 the order is attached to the student’s own account', ordersAfter === ordersBefore + 1, ordersBefore + ' → ' + ordersAfter);
  }

  /* ================================================= B2B ===================== */
  const pEmail = 'r169p' + stamp + '@agency.example', pPw = 'r169-partner-pass';
  const mk = await A.request.post(BASE + '/api/staff/people', { data: { name: 'Round169 Agency ' + stamp, email: pEmail, password: pPw, role: 'partner' } });
  ok('B2B setup: an agency account', mk.ok(), mk.status() + ' ' + (await mk.text()).slice(0, 120));
  const P = await ctx(pEmail, pPw);
  /* An admin chose the password, so it is replaced before anything opens. */
  await P.request.post(BASE + '/api/auth/change', { data: { current: pPw, password: pPw + 'X' } });
  const addOne = async row => (await P.request.post(BASE + '/api/partner/students', { data: { students: [row] } })).json();
  let r = await addOne({ name: '12345', email: 'n' + stamp + '@ex.example', phone: '9876543210' });
  ok('B2B-01 server: a name with no letter is refused with a reason', r.added.length === 0 && /letter/.test(J(r.rejected)), J(r));
  r = await addOne({ name: 'Asha Rao', email: 'a' + stamp + '@ex.example', phone: 'abc' });
  ok('B2B-01 server: a mobile "abc" is refused', r.added.length === 0 && /mobile/.test(J(r.rejected)), J(r));
  r = await addOne({ name: 'Asha Rao', email: 'notanemail', phone: '9876543210' });
  ok('B2B-01 server: "notanemail" is refused', r.added.length === 0 && /email/.test(J(r.rejected)), J(r));
  r = await addOne({ name: 'Asha Rao ' + stamp, email: 'asha' + stamp + '@ex.example', phone: '+91 98765 43210' });
  ok('B2B-01 server: +91 with spaces is a valid mobile', r.added.length === 1, J(r));
  const ashaId = r.added[0] && r.added[0].id;

  const pp1 = await page(P, '/partner.html');
  const sentRows = []; pp1.on('request', q => { if (q.method() === 'POST' && /\/api\/partner\/students$/.test(q.url())) sentRows.push(q.postDataJSON()); });
  let pDialogs = 0; pp1.on('dialog', async dg => { pDialogs++; await dg.dismiss(); });
  await pp1.click('#openAdd'); await pp1.waitForSelector('#addModal.on');
  await pp1.fill('#aName', '12345'); await pp1.fill('#aEmail', 'x' + stamp + '@ex.example'); await pp1.fill('#aPhone', 'abc');
  await pp1.click('#addOne'); await pp1.waitForTimeout(500);
  ok('B2B-01 client: "12345" is refused on the form, nothing is sent', sentRows.length === 0 && /letter/.test(await pp1.$eval('#addOut', e => e.textContent)), await pp1.$eval('#addOut', e => e.textContent));
  await pp1.fill('#aName', 'Ravi K'); await pp1.click('#addOne'); await pp1.waitForTimeout(500);
  ok('B2B-01 client: mobile "abc" is refused on the form', sentRows.length === 0 && /mobile/.test(await pp1.$eval('#addOut', e => e.textContent)));
  await pp1.evaluate(() => { const d2 = document.querySelector('#addModal details'); if (d2) d2.open = true; });
  await pp1.fill('#bulk', 'Neha S, neha' + stamp + '@ex.example, 9876501691\n , , \nBad Row, notanemail, 9876501692\n12345, num' + stamp + '@ex.example\n');
  await pp1.click('#addMany'); await pp1.waitForTimeout(1500);
  const bulkOut = await pp1.$eval('#addOut', e => e.textContent);
  ok('B2B-01 bulk: blank rows are skipped, only the good row is sent', sentRows.length === 1 && sentRows[0].students.length === 1, J(sentRows));
  ok('B2B-01 bulk: each failing row is reported with its reason', /1 added/.test(bulkOut) && /2 not added/.test(bulkOut) && /email/.test(bulkOut) && /letter/.test(bulkOut), bulkOut);

  /* B2B-04 / Oct-10 #8: logo */
  const corner = await pp1.evaluate(() => { const c = document.querySelector('.p-logo'); const m = c && c.querySelector('.logo-img');
    return { shown: !!c && !c.hidden && c.getBoundingClientRect().height > 10, mark: !!m && getComputedStyle(m).display !== 'none' }; });
  ok('B2B-04 a partner with no logo sees the Glovels logo in the sidebar', corner.shown && corner.mark, J(corner));
  ok('B2B-04 the logo dialog says "PNG, JPG or WebP"', /PNG, JPG or WebP/.test(await pp1.$eval('#logoModal', e => e.textContent)));

  /* B2B-04 Remove asks inline */
  await pp1.reload({ waitUntil: 'domcontentloaded' }); await pp1.waitForTimeout(2200);
  const delReqs = []; pp1.on('request', q => { if (q.method() === 'DELETE') delReqs.push(q.url()); });
  const rmB = await pp1.$('[data-rm]');
  if (rmB) {
    await rmB.click(); await pp1.waitForTimeout(400);
    ok('B2B-04 Remove asks inline (no browser confirm), nothing deleted yet', pDialogs === 0 && delReqs.length === 0 && !!(await pp1.$('.pask [data-rm][data-sure]')), J({ pDialogs, delReqs }));
    await pp1.click('.pask [data-keep-file]'); await pp1.waitForTimeout(400);
    ok('B2B-04 Keep puts the row back', delReqs.length === 0 && !(await pp1.$('.pask')));
  } else ok('B2B-04 a removable student is listed', false);

  /* B2B-02: closed file */
  const cl = await P.request.put(BASE + '/api/partner/student/' + ashaId + '/closed', { data: { closed: true } });
  ok('B2B-02 setup: the agency closes a file', cl.ok(), cl.status());
  let pr = await P.request.put(BASE + '/api/partner/student/' + ashaId + '/profile', { data: { profile: { firstName: 'Asha', city: 'Pune' } } });
  ok('B2B-02 server: editing a closed file → 409', pr.status() === 409, pr.status());
  await P.request.put(BASE + '/api/partner/student/' + ashaId + '/closed', { data: { closed: false } });
  pr = await P.request.put(BASE + '/api/partner/student/' + ashaId + '/profile', { data: { profile: { firstName: '' } } });
  /* A blank first name on a student the agency added by full name is filled
     from that name, not refused (the agency never had a separate box). */
  ok('B2B-02 server: an empty first name is taken from the student\'s name, not left blank', pr.ok() && /Asha/.test(JSON.stringify(await pr.json().catch(() => ({})))), pr.status());
  pr = await P.request.put(BASE + '/api/partner/student/' + ashaId + '/profile', { data: { profile: { firstName: 'Asha' } } });
  ok('B2B-02 server: a real first name still saves', pr.ok(), pr.status());
  await P.request.put(BASE + '/api/partner/student/' + ashaId + '/closed', { data: { closed: true } });

  const pp2 = await page(P, '/partner.html');
  await pp2.evaluate(id => openStudent(id), ashaId); await pp2.waitForTimeout(1500);
  const cv = await pp2.evaluate(() => ({
    banner: (document.getElementById('closedBanner') || {}).textContent || '',
    editable: [...document.querySelectorAll('#p-details input, #p-details select, #p-details textarea')].filter(e => !e.disabled).length,
    save: (() => { const s2 = document.getElementById('saveProfile'); return !!s2 && !s2.hidden; })(),
    sop: (() => { const c2 = [...document.querySelectorAll('#p-docs .dcard')].find(x => /Statement of Purpose/.test(x.textContent)); return c2 ? c2.textContent : ''; })(),
  }));
  ok('B2B-02 a closed file shows a "Closed" banner', /Closed\./.test(cv.banner), cv.banner);
  ok('B2B-02 and its details are read-only', cv.editable === 0 && !cv.save, J({ editable: cv.editable, save: cv.save }));
  ok('B2B-04 closed file, no package: the SOP says "Not included", not "we write this — Being written"',
    /Not included/.test(cv.sop) && !/Being written/.test(cv.sop) && !/we write this/.test(cv.sop), cv.sop.slice(0, 160));

  /* B2B-03: admin */
  const all = (await getJ(A, '/api/staff/students')).body;
  const row = (all.students || all.rows || []).find(x => Number(x.id) === Number(ashaId));
  ok('B2B-03 Admin’s student list knows the agency closed it', row && row.agencyClosed === true, J(row && { status: row.status, agencyClosed: row.agencyClosed }));
  const ad = await page(A, '/admin.html');
  await ad.waitForTimeout(1500);
  await ad.fill('#findStudent', 'asha' + stamp).catch(() => {});
  await ad.waitForTimeout(800);
  const adTxt = await ad.evaluate(n => {
    const tr = [...document.querySelectorAll('tr')].find(t => t.textContent.includes(n));
    return tr ? tr.textContent : '';
  }, 'asha' + stamp + '@ex.example');
  ok('B2B-03 Admin → Every student says "Closed by the agency"', /Closed by the agency/.test(adTxt), adTxt.slice(0, 200));

  /* ------------------------------------------------- phone width */
  const Sm = await ctx('student@glovels.com', PW, { width: 390, height: 860 });
  for (const path of ['/dashboard', '/documents', '/services', '/universities']) {
    const p2 = await page(Sm, path);
    const wide = await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok('phone: no sideways scroll on ' + path, wide);
  }

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log('round169studenttest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
