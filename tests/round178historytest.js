#!/usr/bin/env node
'use strict';
/*
 * Round 178 — the 30 Oct "Status and History" review.
 *
 *   BUG-092  Applications keep a history: one `application_events` row per
 *            change (created / stage / outcome / note / internal_note /
 *            removed) with when, who (name + role), from and to — written by
 *            the staff PUT, the student's own route, the shortlist add,
 *            remove and release. The counsellor's (and admin's) file shows
 *            the latest change on each card and a History list with the
 *            office's notes; the student's card and the agency's file show
 *            the public events only. "Submitted on <date>" on the student's
 *            card once the stage reaches Submitted. Two notes on one
 *            application are both in its history, dated. Backfill: one
 *            `created` per earlier application, its note as one note event.
 *   BUG-093  A document's current file first (the accepted copy, else the
 *            newest — `current` on each file), older versions under
 *            "Earlier versions (N)" with their verdicts — counsellor panel,
 *            student Documents page; the agency's card names the current file.
 *   BUG-094  Automatic notices are `kind:'notice'` rows: out of the
 *            conversation and the unread counts, on the Activity tab (staff)
 *            and "What's happened" (student dashboard); the same notice is
 *            not written twice inside ten minutes. Adding and removing a
 *            programme leaves the chat unchanged and adds two activity
 *            entries. Backfill re-marks the code's own templates.
 *
 *   cd tests && bash srv.sh 8131 && BASE=http://localhost:8131 node round178historytest.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8131';
const PORT = new URL(BASE).port;
const DATA = process.env.DATA_DIR || '/tmp/db-' + PORT;
const DBFILE = path.join(DATA, 'glovels.db');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad/oct30/shots';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* screenshots are optional */ }

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 500) : '')); } };
const J = x => JSON.stringify(x);
function done() { console.log('round178historytest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.178.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {} };
}
async function upload(who, p, fields, name, bytes) {
  ips[who] = ips[who] || ('10.178.' + (ipn++) + '.9');
  const fd = new FormData();
  Object.keys(fields).forEach(k => fd.append(k, fields[k]));
  fd.append('file', new Blob([bytes]), name);
  const r = await fetch(BASE + p, { method: 'POST', headers: { cookie: jar[who] || '', 'x-forwarded-for': ips[who] }, body: fd });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, body: j };
}
const pdf = tag => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(tag + ' ' + 'A'.repeat(300))]);
const S = String(Date.now()).slice(-7);
const STORE = require(path.join(__dirname, '..', 'server', 'store.js'));
const SEED = require(path.join(__dirname, '..', 'server', 'seed.js'));

/* ====================================================== the backfills, unit */
(() => {
  console.log('\nbackfills (a store of its own)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r178-'));
  const db = STORE.open(dir);
  const stu = db.createStudent('bf' + S + '@x.example', 'Backfill Student', '', 'h', 's', 'student');
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(path.join(dir, 'glovels.db'));
  const T0 = '2026-09-02T10:00:00.000Z', T1 = '2026-09-20T09:00:00.000Z', T2 = '2026-10-16T12:00:00.000Z';
  /* As the old code left them: a list row, an application with a note, no history. */
  raw.prepare("INSERT INTO shortlist (student_id, prog_id, program, university, city, country, total_inr, is_public, url, intakes, fit, added_at, added_by) VALUES (?, 'bf-1', 'MSc Data', 'TU Test', '', 'DE', 0, 1, '', '[]', 0, ?, 'office')").run(stu.id, T0);
  raw.prepare("INSERT INTO applications (student_id, prog_id, stage, outcome, updated_at, note, note_at) VALUES (?, 'bf-1', 2, '', ?, 'Filed on the portal, ref TU-1', ?)").run(stu.id, T2, T1);
  /* Messages as the old code wrote them: templates, a person, an attachment, the note. */
  const addRaw = (sender, body, file) => raw.prepare("INSERT INTO messages (student_id, sender, body, file, created_at) VALUES (?, ?, ?, ?, ?)").run(stu.id, sender, body, file || '', T1);
  addRaw('them', 'I have added MSc Data at TU Test to your list.');
  addRaw('them', 'I have taken MBA at Nowhere off your list.');
  addRaw('them', 'Update on your applications — MSc Data at TU Test: Submitted.');
  addRaw('them', 'Your Academic CV needs another copy — "cv.html". The one on file is not clear enough to send on. You can upload a new one on your Documents screen — the old one stays until the new one arrives.');
  addRaw('them', 'Received ₹5,000 for GLV-1234. ₹10,000 left on this package.');
  addRaw('them', 'MSc Data at TU Test — Filed on the portal, ref TU-1');
  addRaw('me', 'I would like to apply to TU Test — MSc Data.');
  addRaw('them', 'Hello, can we talk tomorrow about your SOP?');
  addRaw('me', 'Yes, 11am works.');
  addRaw('them', 'I have added the file you asked for.', 'shared-1');
  raw.close();

  const n1 = SEED.noticesOutOfTheChat({ db });
  const left = db.getMessages(stu.id).map(m => m.body);
  const notes = db.getNotices(stu.id).map(m => m.body);
  ok('094 backfill: the six automatic sentences become notices (templates read off the code, the note by its "<course> at <uni> — " prefix)',
    n1 === 6 && notes.length === 6, n1 + ' ' + J(notes));
  ok('094 backfill: people\'s messages, an attachment AND the student\'s "I would like to apply to …" stay in the conversation',
    left.length === 4 && left.includes('Yes, 11am works.') && left.includes('Hello, can we talk tomorrow about your SOP?')
      && left.includes('I have added the file you asked for.') && left.includes('I would like to apply to TU Test — MSc Data.'), J(left));
  ok('094 backfill: notices are counted by no unread badge; the apply request is (2 for the student, 2 for staff)',
    db.unreadForStudent(stu.id) === 2 && db.unreadForStaff(stu.id) === 2,
    db.unreadForStudent(stu.id) + '/' + db.unreadForStaff(stu.id));
  ok('094 backfill: runs once', SEED.noticesOutOfTheChat({ db }) === 0);
  /* A database the first version of the backfill ran on: the apply request
     was marked a notice. Every boot puts it back (and only it). */
  db.markNotices(m => m.sender === 'me' && /^I would like to apply to/.test(m.body));
  ok('094 repair setup: the apply request marked a notice, as the first backfill did', !db.getMessages(stu.id).some(m => /^I would like to apply/.test(m.body)));
  SEED.noticesOutOfTheChat({ db });
  ok('094 repair: the next boot returns it to the conversation; the real notices stay notices',
    db.getMessages(stu.id).some(m => /^I would like to apply/.test(m.body)) && db.getNotices(stu.id).length === 6, J(db.getNotices(stu.id).length));
  SEED.noticesOutOfTheChat({ db });
  ok('094 repair: idempotent — a second boot changes nothing', db.getMessages(stu.id).length === 4 && db.getNotices(stu.id).length === 6);

  const n2 = SEED.applicationsKeepHistory({ db });
  const ev = db.appEvents(stu.id, 'bf-1');
  ok('092 backfill: one created event from the earliest known date, and the note as one note event dated when written',
    n2 === 2 && ev.length === 2 && ev[0].kind === 'created' && ev[0].at === T0 && ev[1].kind === 'note' && ev[1].at === T1 && /TU-1/.test(ev[1].text), J(ev));
  ok('092 backfill: runs once, and the store backfill is itself safe to repeat', SEED.applicationsKeepHistory({ db }) === 0 && db.backfillAppHistory() === 0);

  /* De-duplication, at the store. */
  const w1 = db.addNotice(stu.id, 'Your passport needs another copy.', 'Kavya');
  const w2 = db.addNotice(stu.id, 'Your passport needs another copy.', 'Kavya');
  const w3 = db.addNotice(stu.id, 'Your passport needs another copy. Corner cut.', 'Kavya');
  ok('094 unit: an identical notice inside ten minutes is written once; a different one is written', w1 && !w2 && w3, J([w1, w2, w3]));
  try { db.close && db.close(); } catch (e) {}
})();

(async () => {
  /* ---------------------------------------------------------------- setup */
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('setup: admin signs in', r.ok, r.status);
  r = await req('k', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
  ok('setup: the counsellor signs in', r.ok, r.status);
  const cs = (await req('a', 'GET', '/api/staff/counsellors')).body.counsellors || [];
  const kavya = cs.find(c => c.email === 'kavya@glovels.com');
  const email = 'r178s' + S + '@example.com';
  const PW = 'a-real-password-' + S;
  r = await req('s', 'POST', '/api/auth/signup', { name: 'History Student ' + S, email, phone: '9178' + S.slice(-6), password: PW, terms: true });
  ok('setup: a student signs up', r.ok, r.status + ' ' + J(r.body).slice(0, 120));
  const people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const SID = (people.find(x => x.email === email) || {}).id;
  r = await req('a', 'PUT', '/api/staff/student/' + SID + '/counsellor', { counsellorId: kavya && kavya.id });
  ok('setup: assigned to the seeded counsellor', r.ok, r.status);
  const detail = async () => (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  const student = async () => (await req('s', 'GET', '/api/state')).body;
  const cat = (await req('a', 'GET', '/api/staff/catalogue?per=60')).body.programmes || [];
  const progs = [];
  cat.forEach(x => { if (x && x.id && x.university && progs.length < 3 && !progs.some(y => y.university === x.university)) progs.push(x); });
  ok('setup: three programmes at three universities', progs.length === 3, progs.length);
  const [P1, P2, P3] = progs;
  const app = (id, body) => req('k', 'PUT', '/api/staff/student/' + SID + '/application/' + encodeURIComponent(id), body);
  await student();   /* the first visit seeds the welcome messages */

  /* ================================================================ BUG-092 */
  console.log('\nBUG-092 — applications keep a history');
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/shortlist', { id: P1.id, force: true });
  ok('092: the counsellor adds a programme', r.ok, r.status);
  let d = await detail();
  let h = (d.appHistory || {})[P1.id] || [];
  ok('092: the add is the first event — created, dated, by the counsellor (name + role)',
    h.length === 1 && h[0].kind === 'created' && h[0].who === 'Kavya Menon' && h[0].role === 'counsellor' && !isNaN(Date.parse(h[0].at)), J(h));
  r = await app(P1.id, { stage: 2 });
  ok('092: moved to Submitted', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
  r = await app(P1.id, { note: 'Filed on the TUM portal on Monday, ref TUM-4471.' });
  await new Promise(x => setTimeout(x, 30));
  r = await app(P1.id, { note: 'The university confirmed receipt — reply in 6 weeks.' });
  r = await app(P1.id, { internalNote: 'Portal login: student@x / see vault' });
  d = await detail();
  h = (d.appHistory || {})[P1.id] || [];
  const stageEv = h.find(e => e.kind === 'stage');
  ok('092: the stage change is an event — Documents collected → Submitted, from 0 to 2, signed',
    stageEv && stageEv.from === '0' && stageEv.to === '2' && /Documents collected → Submitted/.test(stageEv.said) && stageEv.who === 'Kavya Menon', J(stageEv));
  const noteEvs = h.filter(e => e.kind === 'note');
  ok('092: TWO NOTES on one application — both in its history, each dated, in order',
    noteEvs.length === 2 && /TUM-4471/.test(noteEvs[0].text) && /6 weeks/.test(noteEvs[1].text)
      && noteEvs.every(e => !isNaN(Date.parse(e.at))) && Date.parse(noteEvs[0].at) <= Date.parse(noteEvs[1].at), J(noteEvs));
  ok('092: the card still carries the latest note', d.apps[P1.id] && /6 weeks/.test(d.apps[P1.id].note), J(d.apps[P1.id] && d.apps[P1.id].note));
  ok('092: the office note is in the STAFF history, marked internal_note', h.some(e => e.kind === 'internal_note' && /vault/.test(e.text)), J(h.map(e => e.kind)));
  r = await app(P1.id, { note: 'The university confirmed receipt — reply in 6 weeks.' });
  ok('092: saving the same note again writes nothing', ((await detail()).appHistory[P1.id] || []).length === h.length);

  let st = await student();
  let sh = ((st.apps || {})[P1.id] || {}).history || [];
  ok('092: the STUDENT\'s application carries its history — created, stage, both notes',
    sh.length === 4 && sh.filter(e => e.kind === 'note').length === 2, J(sh.map(e => e.kind)));
  ok('092: …and never the office\'s note', !sh.some(e => e.kind === 'internal_note') && !J(st).includes('vault'), J(sh.map(e => e.kind)));
  ok('092: "Submitted on <date>" — submittedAt is the date it reached Submitted',
    st.apps[P1.id].submittedAt && st.apps[P1.id].submittedAt === stageEv.at, J([st.apps[P1.id].submittedAt, stageEv.at]));

  /* Outcome at Decision. */
  r = await app(P1.id, { stage: 4 });
  r = await app(P1.id, { stage: 4, outcome: 'offer' });
  ok('092: an offer recorded at Decision', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
  h = ((await detail()).appHistory || {})[P1.id] || [];
  const outEv = h.find(e => e.kind === 'outcome');
  ok('092: the outcome is its own event — No decision yet → Offer', outEv && outEv.from === '' && outEv.to === 'offer' && /No decision yet → Offer/.test(outEv.said), J(outEv));
  st = await student();
  ok('092: Submitted on stays the first time it got there (not the later moves)', st.apps[P1.id].submittedAt === stageEv.at, J([st.apps[P1.id].submittedAt, stageEv.at]));

  /* The student's own route: a correction backwards is theirs, signed as the student. */
  r = await req('s', 'PUT', '/api/applications/' + encodeURIComponent(P1.id), { stage: 3 });
  ok('092: the student may move their own application back', r.ok, r.status);
  h = ((await detail()).appHistory || {})[P1.id] || [];
  const back = h.filter(e => e.kind === 'stage').pop();
  ok('092: …and that is an event in THEIR name, role student', back && back.from === '4' && back.to === '3' && back.role === 'student' && /History Student/.test(back.who), J(back));
  r = await app(P1.id, { stage: 4 });

  /* Remove and add again: two lives, one history. */
  await req('k', 'POST', '/api/staff/student/' + SID + '/shortlist', { id: P3.id, force: true });
  await app(P3.id, { note: 'Waiting for the portal to open.' });
  r = await req('k', 'DELETE', '/api/staff/student/' + SID + '/shortlist/' + encodeURIComponent(P3.id));
  ok('092: a programme taken off the list', r.ok, r.status + ' ' + J(r.body).slice(0, 120));
  await req('k', 'POST', '/api/staff/student/' + SID + '/shortlist', { id: P3.id, force: true });
  h = ((await detail()).appHistory || {})[P3.id] || [];
  ok('092: removal is dated and signed, and adding it back starts a new life — created, note, removed, created',
    J(h.map(e => e.kind)) === J(['created', 'note', 'removed', 'created']) && h[2].who === 'Kavya Menon', J(h.map(e => [e.kind, e.who])));

  /* The admin's view of the same screen reads the same history. */
  const ah = ((await req('a', 'GET', '/api/staff/student/' + SID)).body.appHistory || {})[P1.id] || [];
  ok('092: the admin\'s view of the file carries the same history', ah.length === ((await detail()).appHistory[P1.id] || []).length && ah.some(e => e.kind === 'internal_note'), ah.length);

  /* ================================================================ BUG-093 */
  console.log('\nBUG-093 — the current file first');
  const DBX = () => { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(DBFILE); };
  const dirUp = path.join(DATA, 'uploads', String(SID));
  fs.mkdirSync(dirUp, { recursive: true });
  fs.writeFileSync(path.join(dirUp, 'cv-sept.html'), '<html>old</html>');
  { const x = DBX(); x.prepare("INSERT INTO documents (student_id, doc_key, filename, stored_name, bytes, status, uploaded_at, uploaded_by) VALUES (?, 'cv', 'Academic CV (Sept).html', 'cv-sept.html', 31, 'wait', ?, 'student')").run(SID, '2026-09-02T09:00:00.000Z'); x.close(); }
  let u = await upload('s', '/api/documents', { key: 'cv' }, 'Academic CV draft.pdf', pdf('CV-A'));
  ok('093 setup: a second CV arrives', u.status === 200, u.status);
  let rows = (await detail()).docs.filter(x => x.key === 'cv');
  const draft = rows.find(x => x.file === 'Academic CV draft.pdf');
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + draft.id + '/verdict', { status: 'rescan', note: 'Page two is missing.' });
  u = await upload('s', '/api/documents', { key: 'cv' }, 'Academic CV final.pdf', pdf('CV-B'));
  rows = (await detail()).docs.filter(x => x.key === 'cv');
  const fin = rows.find(x => x.file === 'Academic CV final.pdf');
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + fin.id + '/verdict', { status: 'ok' });
  ok('093 setup: the final CV accepted', r.ok, r.status + ' ' + J(r.body).slice(0, 120));
  rows = (await detail()).docs.filter(x => x.key === 'cv');
  const cur = rows.filter(x => x.current).map(x => x.file);
  ok('093: the staff rows mark the accepted file current and the two older ones not', J(cur) === J(['Academic CV final.pdf']) && rows.length === 3, J(rows.map(x => [x.file, x.state, x.current])));
  st = await student();
  const scv = (st.docs.cv || {}).files || [];
  ok('093: the student\'s files say the same', J(scv.filter(f => f.current).map(f => f.file)) === J(['Academic CV final.pdf']) && scv.length === 3, J(scv.map(f => [f.file, f.state, f.current])));
  /* No accepted copy: the newest is current. */
  await upload('s', '/api/documents', { key: 'passport' }, 'pp-1.pdf', pdf('P1'));
  await upload('s', '/api/documents', { key: 'passport' }, 'pp-2.pdf', pdf('P2'));
  rows = (await detail()).docs.filter(x => x.key === 'passport');
  ok('093: nothing accepted — the newest file is the current one', J(rows.filter(x => x.current).map(x => x.file)) === J(['pp-2.pdf']), J(rows.map(x => [x.file, x.current])));

  /* ================================================================ BUG-094 */
  console.log('\nBUG-094 — notices out of the conversation');
  /* A real exchange first, so the thread is not empty. */
  r = await req('s', 'POST', '/api/messages', { body: 'Hello — is my CV fine now?' });
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/message', { body: 'Yes, the final one is accepted.' });
  st = await student();
  const msgs0 = (st.msgs || []).map(m => m.t);
  const act0 = (st.activity || []).length;
  const unread0 = st.unread;
  ok('094: the conversation holds the people (and the welcome), not the notices so far',
    msgs0.includes('Hello — is my CV fine now?') && msgs0.includes('Yes, the final one is accepted.')
      && !msgs0.some(t => /^I have added|^Update on your applications|needs another copy|^.+ — (Filed on the TUM|The university confirmed)/.test(t)), J(msgs0));
  ok('094: …and those notices are on the Activity timeline, newest first',
    act0 >= 5 && (st.activity || []).some(a => /I have added/.test(a.t)) && (st.activity || []).some(a => /needs another copy/.test(a.t))
      && Date.parse(st.activity[0].at) >= Date.parse(st.activity[st.activity.length - 1].at), J((st.activity || []).map(a => a.t.slice(0, 40))));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/shortlist', { id: P2.id, force: true });
  ok('094: add a programme', r.ok, r.status);
  r = await req('k', 'DELETE', '/api/staff/student/' + SID + '/shortlist/' + encodeURIComponent(P2.id));
  ok('094: …and take it off again', r.ok, r.status);
  st = await student();
  ok('094: ADDING AND REMOVING A PROGRAMME LEAVES THE CHAT UNCHANGED', J((st.msgs || []).map(m => m.t)) === J(msgs0), J((st.msgs || []).slice(-3).map(m => m.t)));
  ok('094: …and adds two activity entries (added, taken off)', (st.activity || []).length === act0 + 2
    && /^I have taken /.test(st.activity[0].t) && /^I have added /.test(st.activity[1].t), J((st.activity || []).slice(0, 3).map(a => a.t)));
  ok('094: the unread badge did not move for a notice', st.unread === unread0, unread0 + ' → ' + st.unread);
  d = await detail();
  ok('094: the staff file carries the same Activity, and its thread the same people', (d.activity || []).length === st.activity.length
    && J((d.msgs || []).map(m => m.t)) === J(msgs0), (d.activity || []).length + ' vs ' + st.activity.length);
  /* The student's own request to apply is a MESSAGE the counsellor answers. */
  const priv = cat.find(x => x && !x.isPublic && ![P1.id, P2.id, P3.id].includes(x.id));
  if (priv) {
    const before = ((await req('k', 'GET', '/api/staff/students')).body.students || []).find(x => x.id === SID) || {};
    r = await req('s', 'POST', '/api/apply', { id: priv.id });
    const after = ((await req('k', 'GET', '/api/staff/students')).body.students || []).find(x => x.id === SID) || {};
    const stA = await student();
    ok('094: "I would like to apply to …" is in the CONVERSATION, not the activity',
      r.ok && (stA.msgs || []).some(m => m.who === 'me' && /^I would like to apply to /.test(m.t)) && !(stA.activity || []).some(a => /^I would like to apply/.test(a.t)), r.status + ' ' + J(r.body).slice(0, 120));
    ok('094: …and it raises the counsellor\'s unread count', after.unread === (before.unread || 0) + 1, (before.unread || 0) + ' → ' + after.unread);
    /* The counsellor answers, so the list below reads their reply last again. */
    await req('k', 'POST', '/api/staff/student/' + SID + '/message', { body: 'Yes, the final one is accepted.' });
  } else ok('094: a private programme to apply to', false, 'none in the catalogue');
  const list0 = ((await req('k', 'GET', '/api/staff/students')).body.students || []).find(x => x.id === SID) || {};
  ok('094: the counsellor\'s list says the last MESSAGE, not a notice', list0.lastMessage && list0.lastMessage.body === 'Yes, the final one is accepted.', J(list0.lastMessage));

  /* The same request twice inside ten minutes is one notice. */
  await upload('k', '/api/staff/student/' + SID + '/document/x/file', {}, 'tenth.pdf', pdf('X1'));
  const ask = () => req('k', 'POST', '/api/staff/student/' + SID + '/document/x', { status: 'rescan', note: 'The seal is not readable.' });
  r = await ask();
  ok('094 setup: a scan asked for', r.ok, r.status + ' ' + J(r.body).slice(0, 120));
  await req('k', 'POST', '/api/staff/student/' + SID + '/document/x', { status: 'wait' });
  r = await ask();
  st = await student();
  const asks = (st.activity || []).filter(a => /needs another copy\. The seal is not readable/.test(a.t));
  ok('094: the same document request asked twice inside ten minutes is ONE notice', asks.length === 1, asks.length);
  ok('094: …and none of them is in the conversation', !(st.msgs || []).some(m => /needs another copy/.test(m.t)));
  /* The email the request already sent still goes (the outbox, with no SMTP). */
  await new Promise(x => setTimeout(x, 600));
  let mails = [];
  try { mails = fs.readdirSync(path.join(DATA, 'outbox')).filter(f => f.includes(email)).map(f => fs.readFileSync(path.join(DATA, 'outbox', f), 'utf8')); } catch (e) { mails = []; }
  ok('094: the student is still EMAILED about the document request', mails.some(m => /Subject: Your .*needs another copy/.test(m)), mails.length + ' mails');
  /* People still count. */
  const u0 = (await student()).unread;
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/message', { body: 'One more thing — the APS.' });
  const u1 = (await student()).unread;
  ok('094: a counsellor\'s message still counts as unread for the student', u1 === u0 + 1, u0 + ' → ' + u1);

  /* ===================================================== screens, two widths */
  const browser = await chromium.launch();
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const W of [1400, 375]) {
    console.log('\nscreens at ' + W + 'px');
    const H = W === 375 ? 812 : 900;
    /* -- the counsellor's file -- */
    const kc = await browser.newContext({ viewport: { width: W, height: H }, extraHTTPHeaders: { 'x-forwarded-for': '10.178.200.' + (W % 250) } });
    await kc.request.post(BASE + '/api/auth/login', { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
    const cp = await kc.newPage();
    await cp.goto(BASE + '/counsellor.html?student=' + SID, { waitUntil: 'domcontentloaded' });
    await cp.waitForSelector('#t-file', { state: 'attached', timeout: 15000 });
    await cp.click('.tab[data-t="file"]');
    const row = cp.locator('[data-apphist="' + P1.id + '"]');
    await row.waitFor({ timeout: 8000 });
    const label = await row.textContent();
    ok(W + ' counsellor: the card shows the latest change and a History link', /History \(\d+\)/.test(label)
      && /Latest:/.test(await cp.locator('[data-apphist="' + P1.id + '"]').locator('xpath=..').textContent()), label);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const listTxt = await cp.locator('[data-apphistlist="' + P1.id + '"]').innerText();
    ok(W + ' counsellor: History opens a dated list — both notes, the stage, the office note marked',
      /TUM-4471/.test(listTxt) && /6 weeks/.test(listTxt) && /Submitted/.test(listTxt) && /Office only/.test(listTxt) && /\d{1,2} \w{3} 2026/.test(listTxt), listTxt.slice(0, 300));
    await cp.locator('[data-apphistlist="' + P1.id + '"]').scrollIntoViewIfNeeded();
    await cp.screenshot({ path: path.join(SHOTS, 'r178-counsellor-history-' + W + '.png') });
    /* Documents panel. */
    const grp = cp.locator('.docgroup[data-dockey="cv"]');
    await grp.scrollIntoViewIfNeeded();
    const firstFile = await grp.locator('.docfilelink').first().textContent();
    const summ = await grp.locator('details.docearlier summary').textContent().catch(() => '');
    ok(W + ' counsellor: the CV shows the accepted file FIRST, the two older ones under "Earlier versions (2)"',
      firstFile === 'Academic CV final.pdf' && /Earlier versions \(2\)/.test(summ), firstFile + ' | ' + summ);
    await grp.locator('details.docearlier summary').click();
    const earlierTxt = await grp.locator('details.docearlier').innerText();
    ok(W + ' counsellor: each earlier version says what happened to it (Scan asked / Not accepted)',
      /Scan asked/i.test(earlierTxt) && /Not accepted/i.test(earlierTxt), earlierTxt.slice(0, 300));
    await grp.screenshot({ path: path.join(SHOTS, 'r178-counsellor-docs-' + W + '.png') });
    /* Activity tab vs the conversation. */
    await cp.click('.tab[data-t="activity"]');
    const actTxt = await cp.locator('#t-activity').innerText();
    ok(W + ' counsellor: the Activity tab lists the notices (added, taken off, the scan asked)',
      /I have added/.test(actTxt) && /I have taken/.test(actTxt) && /needs another copy/.test(actTxt), actTxt.slice(0, 200));
    await cp.screenshot({ path: path.join(SHOTS, 'r178-counsellor-activity-' + W + '.png') });
    await cp.click('.tab[data-t="chat"]');
    const thread = await cp.locator('#thread').innerText();
    ok(W + ' counsellor: the conversation is people — no notice in it',
      /the final one is accepted/.test(thread) && !/I have added|I have taken|needs another copy|Update on your applications/.test(thread), thread.slice(0, 200));
    ok(W + ' counsellor: no sideways scroll', (await overflow(cp)) <= 1, await overflow(cp));
    await kc.close();

    /* -- the student's screens -- */
    const sc = await browser.newContext({ viewport: { width: W, height: H }, extraHTTPHeaders: { 'x-forwarded-for': '10.178.201.' + (W % 250) } });
    await sc.request.post(BASE + '/api/auth/login', { data: { email, password: PW } });
    const dp = await sc.newPage();
    await dp.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
    await dp.waitForSelector('#actSec:not([hidden])', { timeout: 15000 });
    const dash = await dp.locator('#actSec').innerText();
    ok(W + ' dashboard: "What\'s happened" lists the notices, newest first', /What.s happened/.test(dash) && /I have taken/.test(dash), dash.slice(0, 200));
    await dp.locator('#actSec').scrollIntoViewIfNeeded();
    await dp.locator('#actSec').screenshot({ path: path.join(SHOTS, 'r178-dashboard-activity-' + W + '.png') });
    ok(W + ' dashboard: no sideways scroll', (await overflow(dp)) <= 1, await overflow(dp));

    const ap = await sc.newPage();
    await ap.goto(BASE + '/applications.html', { waitUntil: 'domcontentloaded' });
    const card = ap.locator('[data-app="' + P1.id + '"]');
    await card.waitFor({ timeout: 15000 });
    const sent = await card.locator('.appsent').textContent().catch(() => '');
    ok(W + ' applications: the card says "Submitted on <date>"', /Submitted on \d{1,2} \w{3} 2026/.test(sent), sent);
    await card.locator('details.apphist summary').click();
    const hTxt = await card.locator('details.apphist').innerText();
    ok(W + ' applications: History lists both notes, the stage and the offer, dated — and no office note',
      /TUM-4471/.test(hTxt) && /6 weeks/.test(hTxt) && /Offer/.test(hTxt) && /Submitted/.test(hTxt) && !/vault|Office/.test(hTxt), hTxt.slice(0, 300));
    await card.screenshot({ path: path.join(SHOTS, 'r178-applications-history-' + W + '.png') });
    ok(W + ' applications: no sideways scroll', (await overflow(ap)) <= 1, await overflow(ap));

    const dc = await sc.newPage();
    await dc.goto(BASE + '/documents.html', { waitUntil: 'domcontentloaded' });
    const cvCard = dc.locator('.sl[data-id="cv"]');
    await cvCard.waitFor({ timeout: 15000 });
    const firstLink = await cvCard.locator('.dfiles a').first().textContent();
    const earl = await cvCard.locator('details.docearlier summary').textContent().catch(() => '');
    ok(W + ' documents: the accepted CV is listed first, the older two under "Earlier versions (2)"',
      firstLink === 'Academic CV final.pdf' && /Earlier versions \(2\)/.test(earl), firstLink + ' | ' + earl);
    await cvCard.locator('details.docearlier summary').click();
    const eTxt = await cvCard.locator('details.docearlier').innerText();
    ok(W + ' documents: with their verdicts (Scan asked, Not accepted)', /Scan asked/.test(eTxt) && /Not accepted/.test(eTxt), eTxt.slice(0, 200));
    await cvCard.scrollIntoViewIfNeeded();
    await cvCard.screenshot({ path: path.join(SHOTS, 'r178-documents-cv-' + W + '.png') });
    ok(W + ' documents: no sideways scroll', (await overflow(dc)) <= 1, await overflow(dc));

    const mp = await sc.newPage();
    await mp.goto(BASE + '/messages.html', { waitUntil: 'domcontentloaded' });
    await mp.waitForTimeout(1500);
    const mt = await mp.locator('#thread').innerText();
    ok(W + ' messages: the thread is people — no "I have added", no document request, no stage notice',
      /the final one is accepted/.test(mt) && !/I have added|I have taken|needs another copy|Update on your applications/.test(mt), mt.slice(0, 200));
    ok(W + ' messages: it points to "What\'s happened" for the notices', await mp.locator('#actHint a[href^="dashboard.html"]').count() === 1);
    await mp.screenshot({ path: path.join(SHOTS, 'r178-messages-' + W + '.png') });
    ok(W + ' messages: no sideways scroll', (await overflow(mp)) <= 1, await overflow(mp));
    await sc.close();
  }
  await browser.close();
  done();
})().catch(e => { console.error(e); fail++; done(); });
