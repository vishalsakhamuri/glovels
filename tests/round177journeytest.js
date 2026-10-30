/*
 * Round 177 — the journey follows the evidence (28 Oct full test, items
 * 3, 6, 7, 9, 10, 11).
 *
 *   3   moving an application to a later stage no longer marks "Profile
 *       completed and documents collected", "Application documents
 *       assembled", "Offer letter received" or the SOP / LOR steps done with
 *       nothing behind them: a derived "done" passes the same lock as a
 *       tick; the task says "Applications are at Submitted but …"; the
 *       phase stays where the evidence is; the save carries a `warning`.
 *   7   Shortlist confirmed, Application documents assembled, Offer letter
 *       received and Visa application filed are locked (409) until the file
 *       backs them — like "Profile completed" and "Visa documents ready".
 *   9   the student's dashboard journey and the "still needed" box agree:
 *       with applications at stage 3/4 and no documents the journey shows
 *       Profile and documents as the step, nothing after it done.
 *   6   PUT …/application/:prog is a partial update (a note alone keeps the
 *       stage and the outcome), with optimistic concurrency (`ifUpdatedAt`
 *       → 409 {conflict, current}); the screen sends it and reloads.
 *  10   stage 9 / −1 / "abc" and outcome "hacked" are 422 with the reason.
 *  11   the staff document route reports the state the file landed in.
 *
 * Port 8127 by default:  bash srv.sh 8127 && node round177journeytest.js
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8127';

let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e ?? '').slice(0, 400))); };
const J = x => JSON.stringify(x);

const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json', 'x-forwarded-for': '10.177.' + (who.length) + '.' + (7 + who.charCodeAt(0) % 200) };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {} };
}
const login = (who, e, p) => req(who, 'POST', '/api/auth/login', { email: e, password: p });
const pdf = n => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n || 400, 0x41)]);
async function upload(who, sid, key, name) {
  const fd = new FormData();
  fd.append('file', new Blob([pdf(400)], { type: 'application/pdf' }), name || (key + '.pdf'));
  const r = await fetch(BASE + '/api/staff/student/' + sid + '/document/' + key + '/file',
    { method: 'POST', headers: { cookie: jar[who] }, body: fd });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
const REQUIRED = ['passport', 'x', 'xii', 'degree', 'consol', 'english', 'cv', 'sop', 'lor', 'finance'];
const VISA_REQ = ['visa-offer', 'visa-funds', 'visa-insurance', 'visa-form', 'visa-cover', 'visa-appointment'];

(async () => {
  const stamp = Date.now().toString(36);
  await login('a', 'admin@glovels.com', 'glovels123');
  let r = await req('a', 'POST', '/api/staff/people',
    { name: 'R177 Counsellor', email: 'c177' + stamp + '@glovels.com', password: 'c177-' + stamp, role: 'counsellor' });
  const cId = r.body && r.body.person && r.body.person.id;
  ok('setup: a counsellor', !!cId, J(r.body));

  const caseOf = async id => (await req('a', 'GET', '/api/staff/student/' + id)).body || {};
  const phase = async id => (await caseOf(id)).phase || {};
  const tasksOf = async id => (await caseOf(id)).tasks || [];
  const task = async (id, re) => (await tasksOf(id)).find(t => re.test(t.title)) || null;
  const tick = async (id, re) => {
    const t = await task(id, re);
    return t ? req('a', 'PUT', '/api/staff/task/' + t.id, { status: 'done' }) : { status: 0, body: {} };
  };
  const verify = async (id, keys) => {
    for (const k of keys) { await upload('a', id, k); await req('a', 'POST', '/api/staff/student/' + id + '/document/' + k, { status: 'ok' }); }
  };

  /* A packaged student, like the tester's. */
  const mk = async tag => {
    const e = tag + stamp + '@ex.example', p = tag + '-' + stamp;
    const who = 's' + tag;
    r = await req('a', 'POST', '/api/staff/people', { name: 'R177 ' + tag, email: e, password: p, role: 'student' });
    const sid = r.body.person.id;
    await req('a', 'PUT', '/api/staff/student/' + sid + '/counsellor', { counsellorId: cId });
    await login(who, e, p);
    await req(who, 'POST', '/api/auth/change', { password: p + 'X' });
    await login(who, e, p + 'X');
    r = await req(who, 'POST', '/api/orders', { packageId: 'pkg-boarding', name: 'R177 ' + tag, email: e, phone: '9876543210', acceptedTerms: true });
    ok('setup: ' + tag + ' buys the boarding package', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
    return { sid, who, e, p: p + 'X' };
  };
  const cat = (await req('a', 'GET', '/api/staff/catalogue?per=60')).body.programmes || [];
  const progs = [];
  cat.forEach(x => { if (x && x.id && x.university && progs.length < 3 && !progs.some(y => y.university === x.university)) progs.push(x); });
  ok('setup: three programmes at three universities', progs.length === 3, progs.length);
  const [P1, P2, P3] = progs;

  /* ======================= item 3: stage moves do not complete locked steps */
  console.log('\nitem 3 — a stage move is not the documents');
  const A = await mk('a3');
  const app = (sid, id, body) => req('a', 'PUT', '/api/staff/student/' + sid + '/application/' + encodeURIComponent(id), body);
  for (const u of progs) await req('a', 'POST', '/api/staff/student/' + A.sid + '/shortlist', { id: u.id, force: true });

  r = await app(A.sid, P1.id, { stage: 3, outcome: '' });
  ok('3: an application can be moved to stage 3 with no documents (the counsellor records reality)', r.ok, r.status + ' ' + J(r.body).slice(0, 200));
  ok('3: …but the save carries a warning naming the documents gap',
    /0 of 10 required documents/.test(r.body.warning || '') && /Profile completed/.test(r.body.warning || ''), J(r.body.warning));
  let ts = await tasksOf(A.sid);
  const byT = re => ts.find(t => re.test(t.title)) || {};
  const prof = byT(/^Profile completed/), sop = byT(/^Statement of Purpose/), lor = byT(/^Letters of Rec/),
    appdocs = byT(/^Application documents/), offer = byT(/^Offer letter/), welcome = byT(/^Welcome call/), sl = byT(/^Shortlist confirmed/);
  ok('3: "Profile completed and documents collected" is NOT done at 0 of 10', prof.status !== 'done' && !prof.derived, J(prof));
  ok('3: …and says the applications are ahead of the file',
    /^Applications are at .* but 10 of 10 required documents are still missing/.test(prof.waitingOn || ''), J(prof.waitingOn));
  ok('3: the SOP step is not finished with nothing in its slot', sop.status !== 'done' && /Statement of Purpose/.test(sop.waitingOn || ''), J(sop));
  ok('3: the LOR step is not finished with nothing in its slot', lor.status !== 'done' && /Recommendation/.test(lor.waitingOn || ''), J(lor));
  ok('3: "Application documents assembled" is not done with the slots empty', appdocs.status !== 'done' && /application document/.test(appdocs.waitingOn || ''), J(appdocs));
  ok('3: "Welcome call" (no lock) still reads done from the applications', welcome.status === 'done' && welcome.derived, J(welcome));
  ok('3: "Shortlist confirmed" reads done — three programmes are on the list', sl.status === 'done' && sl.derived, J(sl));
  let p = await phase(A.sid);
  ok('3: the phase stays at Profile and documents', p.key === 'profile', J(p));
  ok('3: …and says what it is waiting on', /0 of 10 required documents/.test(p.waitingOn || ''), J(p.waitingOn));

  r = await app(A.sid, P1.id, { stage: 4, outcome: 'offer' });
  ok('3: an offer at Decision saves', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
  ts = await tasksOf(A.sid);
  const offer2 = byT(/^Offer letter/);
  ok('3: "Offer letter received" is done — an offer IS on the file', offer2.status === 'done' && offer2.derived, J(offer2));
  p = await phase(A.sid);
  ok('3: with an offer and 0 of 10 documents the phase is still Profile and documents, not Visa', p.key === 'profile', J(p));
  r = await app(A.sid, P1.id, { stage: 4, outcome: 'offer' });
  ok('3: saving the same stage again carries no warning (it did not move)', r.ok && !r.body.warning, J(r.body.warning));

  /* The documents arrive: the derived completions follow, and so does the phase. */
  await verify(A.sid, REQUIRED);
  ts = await tasksOf(A.sid);
  const prof2 = byT(/^Profile completed/), sop2 = byT(/^Statement of Purpose/), appdocs2 = byT(/^Application documents/);
  ok('3: once all 10 are verified the documents step reads done from the applications', prof2.status === 'done' && prof2.derived && !prof2.waitingOn, J(prof2));
  ok('3: …and the SOP step', sop2.status === 'done' && sop2.derived, J(sop2));
  ok('3: …and "Application documents assembled"', appdocs2.status === 'done' && appdocs2.derived, J(appdocs2));
  p = await phase(A.sid);
  ok('3: the phase now follows the applications — Waiting on offers (an offer is in, two submissions still owed; everything before it is on the file)',
    p.key === 'offers' && p.from === 'applications', J(p));

  /* ======================= item 7: four steps that could be ticked with nothing behind them */
  console.log('\nitem 7 — locks on the four steps');
  const B = await mk('b7');
  r = await tick(B.sid, /^Shortlist confirmed/);
  ok('7: "Shortlist confirmed" is refused (409) with nothing on the list', r.status === 409 && /shortlist/i.test(r.body.error || ''), r.status + ' ' + J(r.body));
  r = await tick(B.sid, /^Application documents/);
  ok('7: "Application documents assembled" is refused (409) with the slots empty', r.status === 409 && /application documents/i.test(r.body.error || ''), r.status + ' ' + J(r.body));
  r = await tick(B.sid, /^Offer letter/);
  ok('7: "Offer letter received" is refused (409) with no offer', r.status === 409 && /No offer/i.test(r.body.error || ''), r.status + ' ' + J(r.body));
  r = await tick(B.sid, /^Visa application filed/);
  ok('7: "Visa application filed" is refused (409) with the visa file unverified', r.status === 409 && /visa documents/i.test(r.body.error || ''), r.status + ' ' + J(r.body));
  r = await tick(B.sid, /^Visa documents ready/);
  ok('7: (control) "Visa documents ready" still 409', r.status === 409, r.status);
  ts = await tasksOf(B.sid);
  ok('7: each locked row carries its reason for the screen',
    ['Shortlist confirmed', 'Application documents', 'Offer letter', 'Visa application filed'].every(w => (ts.find(t => t.title.startsWith(w)) || {}).lock),
    J(ts.map(t => [t.title.slice(0, 24), !!t.lock])));

  /* And each opens when the file backs it. */
  await req('a', 'POST', '/api/staff/student/' + B.sid + '/shortlist', { id: P1.id, force: true });
  r = await tick(B.sid, /^Shortlist confirmed/);
  ok('7: with a programme on the list "Shortlist confirmed" ticks', r.ok, r.status + ' ' + J(r.body));
  await verify(B.sid, ['sop', 'lor', 'cv', 'degree', 'consol']);
  r = await tick(B.sid, /^Application documents/);
  ok('7: with SOP, LOR, CV and the transcripts verified "Application documents assembled" ticks', r.ok, r.status + ' ' + J(r.body));
  await app(B.sid, P1.id, { stage: 4, outcome: 'offer' });
  ts = await tasksOf(B.sid);
  const bOffer = ts.find(t => /^Offer letter/.test(t.title)) || {};
  ok('7: with an offer recorded the offer step is satisfied (derived done)', bOffer.status === 'done', J(bOffer));
  await verify(B.sid, VISA_REQ);
  r = await tick(B.sid, /^Visa documents ready/);
  ok('7: with the visa file verified "Visa documents ready" ticks', r.ok, r.status + ' ' + J(r.body));
  r = await tick(B.sid, /^Visa application filed/);
  ok('7: …and "Visa application filed" ticks', r.ok, r.status + ' ' + J(r.body));

  /* ======================= item 9: the dashboard agrees with itself */
  console.log('\nitem 9 — the student dashboard: journey and the "still needed" box');
  const C = await mk('c9');
  for (const u of progs) await req('a', 'POST', '/api/staff/student/' + C.sid + '/shortlist', { id: u.id, force: true });
  await app(C.sid, P1.id, { stage: 3, outcome: '' });
  await app(C.sid, P2.id, { stage: 4, outcome: 'offer' });
  let st = (await req(C.who, 'GET', '/api/state')).body || {};
  let Jy = st.journey || {};
  const stage = k => (Jy.stages || []).find(x => x.key === k) || {};
  ok('9: /api/state journey: the phase is Profile and documents', Jy.phase && Jy.phase.key === 'profile', J(Jy.phase));
  ok('9: the Profile and documents stage is NOT done', stage('profile').state !== 'done', J(stage('profile')));
  ok('9: the Applying stage is NOT done', stage('applying').state !== 'done', J(stage('applying')));
  ok('9: the Offers stage is NOT done', stage('offers').state !== 'done', J(stage('offers')));
  ok('9: the step is Profile and documents', Jy.label === 'Profile and documents' && Jy.step === 2, J({ label: Jy.label, step: Jy.step }));
  ok('9: the Profile stage detail says 0 of 10 documents', /0 of 10 documents/.test(stage('profile').detail || ''), stage('profile').detail);
  ok('9: the "still needed" box has the ten documents to ask for', (st.todo && (st.todo.documentsMissing || []).length) >= 10, J(st.todo && st.todo.documentsMissing));
  ok('9: the next step is the documents', Jy.next && Jy.next.key === 'profile', J(Jy.next));

  /* ======================= item 6: partial update and concurrency */
  console.log('\nitem 6 — partial update and the lost update');
  r = await app(C.sid, P1.id, { note: 'Filed Monday, reference TUM-4471' });
  ok('6: a note alone saves (200)', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
  let apps = (await caseOf(C.sid)).apps || {};
  ok('6: …and keeps the stage at 3', Number((apps[P1.id] || {}).stage) === 3, J(apps[P1.id]));
  ok('6: …and keeps the note', /TUM-4471/.test((apps[P1.id] || {}).note || ''), J(apps[P1.id]));
  r = await app(C.sid, P2.id, { note: 'Offer letter attached' });
  apps = (await caseOf(C.sid)).apps || {};
  ok('6: a note alone on the offer keeps stage 4 and the outcome', Number((apps[P2.id] || {}).stage) === 4 && (apps[P2.id] || {}).outcome === 'offer', J(apps[P2.id]));
  ok('6: the row carries updatedAt', !!(apps[P2.id] || {}).updatedAt, J(apps[P2.id]));
  r = await app(C.sid, P2.id, { internalNote: 'office only' });
  apps = (await caseOf(C.sid)).apps || {};
  ok('6: an internal note alone keeps everything else', Number((apps[P2.id] || {}).stage) === 4 && (apps[P2.id] || {}).outcome === 'offer' && /Offer letter attached/.test((apps[P2.id] || {}).note || ''), J(apps[P2.id]));

  const v1 = (apps[P1.id] || {}).updatedAt;
  r = await app(C.sid, P1.id, { stage: 2, ifUpdatedAt: v1 });
  ok('6: a save with the version it was read with goes through', r.ok && r.body.updatedAt, r.status + ' ' + J(r.body).slice(0, 160));
  const v2 = r.body.updatedAt;
  r = await app(C.sid, P1.id, { stage: 3, ifUpdatedAt: v1 });
  ok('6: a second save with the OLD version is refused — 409 conflict', r.status === 409 && r.body.conflict === true, r.status + ' ' + J(r.body));
  ok('6: …with the current row to reload from', r.body.current && Number(r.body.current.stage) === 2 && r.body.current.updatedAt === v2, J(r.body.current));
  apps = (await caseOf(C.sid)).apps || {};
  ok('6: the refused save changed nothing', Number((apps[P1.id] || {}).stage) === 2, J(apps[P1.id]));
  r = await app(C.sid, P1.id, { stage: 3, ifUpdatedAt: v2 });
  ok('6: re-sent with the current version it saves', r.ok, r.status + ' ' + J(r.body).slice(0, 120));
  r = await app(C.sid, P3.id, { note: 'first word', ifUpdatedAt: '' });
  ok('6: a row that does not exist yet is "version empty" and saves', r.ok, r.status + ' ' + J(r.body).slice(0, 120));

  /* ======================= item 10: invalid values are refused */
  console.log('\nitem 10 — invalid stage / outcome');
  for (const bad of [9, -1, 'abc', 2.5]) {
    r = await app(C.sid, P1.id, { stage: bad });
    ok('10: stage ' + J(bad) + ' is 422 with the reason', r.status === 422 && /0 to 4/.test(r.body.error || ''), r.status + ' ' + J(r.body));
  }
  r = await app(C.sid, P2.id, { stage: 4, outcome: 'hacked' });
  ok('10: outcome "hacked" is 422 with the list', r.status === 422 && /Offer/.test(r.body.error || ''), r.status + ' ' + J(r.body));
  apps = (await caseOf(C.sid)).apps || {};
  ok('10: nothing was changed by the refused saves', Number((apps[P1.id] || {}).stage) === 3 && (apps[P2.id] || {}).outcome === 'offer', J([apps[P1.id], apps[P2.id]]));

  /* ======================= item 11: the delivery route says what it stored */
  console.log('\nitem 11 — staff document delivery reports the stored state');
  r = await upload('a', C.sid, 'passport', 'passport.pdf');
  ok('11: a student document put up by the office lands In review — the response says "wait"', r.status === 200 && r.body.status === 'wait' && !r.body.verified, r.status + ' ' + J(r.body));
  ok('11: …with the words the screens use', /In review/.test(r.body.said || ''), J(r.body));
  r = await upload('a', C.sid, 'sop', 'sop-final.pdf');
  ok('11: our own finished work lands verified — the response says "ok"', r.status === 200 && r.body.status === 'ok' && r.body.verified === true, r.status + ' ' + J(r.body));
  const docs = (await caseOf(C.sid)).readiness || {};
  ok('11: the file agrees: passport In review, SOP accepted',
    (docs.docs || []).some(d => d.key === 'passport' && d.status === 'wait') && (docs.docs || []).some(d => d.key === 'sop' && d.status === 'ok'),
    J((docs.docs || []).map(d => d.key + ':' + d.status)));

  /* ======================= the screens */
  console.log('\nthe screens');
  {
    const b = await chromium.launch();
    const errs = [];
    /* The student's dashboard: the journey and the yellow box. */
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email: C.e, password: C.p } });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push('dashboard: ' + e.message));
    await pg.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2800);
    const body = await pg.evaluate(() => document.body.innerText);
    ok('9 UI: the dashboard does not say Applying or Offers are done',
      !/Applying\s*Done/i.test(body) && !/Offers\s*Done/i.test(body), body.slice(0, 200));
    const head = await pg.$eval('#progPhase', e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    ok('9 UI: the progress head says Profile and documents', /Profile and documents/.test(head), head);
    const todo = await pg.$eval('.todo-card', e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    ok('9 UI: the "still needed" box is shown, and names documents', /still needed/.test(todo) && /document/i.test(todo), todo.slice(0, 200));

    /* The counsellor's screen: the overtaken-but-locked row, the note save, the conflict. */
    const cctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    await cctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const cp = await cctx.newPage();
    cp.on('pageerror', e => errs.push('counsellor: ' + e.message));
    await cp.goto(BASE + '/counsellor?student=' + C.sid, { waitUntil: 'domcontentloaded' });
    await cp.waitForTimeout(3000);
    await cp.click('.tab[data-t="tasks"]').catch(() => {});
    await cp.waitForTimeout(500);
    const rowTxt = await cp.evaluate(() => {
      /* Round 178 (BUG-091): the Tasks tab is a timeline of <li data-step>. */
      const row = [...document.querySelectorAll('#t-tasks tr, #t-tasks li[data-step]')].find(r => /Profile completed/.test(r.textContent));
      return row ? row.textContent.replace(/\s+/g, ' ') : '';
    });
    ok('3 UI: the documents row says "Applications are at … but … still missing"', /Applications are at .* but .* still missing/.test(rowTxt), rowTxt.slice(0, 300));
    ok('3 UI: …and is not shown as done', !/Done because the applications/.test(rowTxt), rowTxt.slice(0, 300));

    /* The note alone, from the screen, keeps the stage. */
    await cp.click('.tab[data-t="file"]').catch(() => {});
    await cp.waitForTimeout(600);
    const noteBox = await cp.$('[data-note="' + P2.id + '"]');
    if (noteBox) await noteBox.scrollIntoViewIfNeeded().catch(() => {});
    ok('6 UI: the application row has a note box', !!noteBox);
    if (noteBox) {
      await noteBox.fill('Screen note ' + stamp);
      await cp.click('[data-notesave="' + P2.id + '"]');
      await cp.waitForTimeout(1500);
      apps = (await caseOf(C.sid)).apps || {};
      ok('6 UI: saving a note from the screen keeps stage 4 and the offer', Number((apps[P2.id] || {}).stage) === 4 && (apps[P2.id] || {}).outcome === 'offer' && /Screen note/.test((apps[P2.id] || {}).note || ''), J(apps[P2.id]));
    }
    /* Somebody else moves the row underneath the open screen: the next save
       from the screen is refused and reloaded. */
    const other = await app(C.sid, P2.id, { note: 'Changed by the other counsellor' });
    ok('6 UI setup: another save lands behind the open screen', other.ok, other.status);
    await cp.click('.tab[data-t="file"]').catch(() => {});
    await cp.waitForTimeout(600);
    const sel = await cp.$('[data-stage="' + P2.id + '"]');
    ok('6 UI: the row has its stage control', !!sel);
    if (sel) {
      await sel.scrollIntoViewIfNeeded().catch(() => {});
      await sel.selectOption('3');
      await cp.waitForTimeout(1800);
      const toast = await cp.$eval('#toast', e => e.textContent).catch(() => '');
      ok('6 UI: the screen says "Someone else changed this — reloaded"', /Someone else changed this/.test(toast), toast);
      apps = (await caseOf(C.sid)).apps || {};
      ok('6 UI: …and the other person’s save stood (stage 4, their note)', Number((apps[P2.id] || {}).stage) === 4 && /other counsellor/.test((apps[P2.id] || {}).note || ''), J(apps[P2.id]));
      const shown = await cp.$eval('[data-stage="' + P2.id + '"]', e => e.value).catch(() => '');
      ok('6 UI: the reloaded row shows stage 4', shown === '4', shown);
    }
    const panel = await cp.evaluate(() => document.body.innerText);
    ok('11 UI: the delivery panel no longer says everything lands "already verified"', !/lands on their Documents screen already verified/.test(panel));
    ok('no page errors', !errs.length, errs.join(' | '));
    await b.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
