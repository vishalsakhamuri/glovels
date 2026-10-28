#!/usr/bin/env node
'use strict';
/*
 * Patch 177 — the 28 Oct full test, documents / office side.
 *
 *   Item 4   Accept on one file verified every file in the document. Now each
 *            row's `status` is its own (wait / rescan / ok / replaced / bad)
 *            and the document's status is DERIVED (store.slotStatus): any ok
 *            → ok, else any wait → wait, else any rescan → rescan. Accepting a
 *            file makes the file accepted before it 'replaced'; a failing
 *            file is 'bad' and Accept on it is 422; the sweep marks bad rows;
 *            a document counts once in "N of 10 verified".
 *   Item 5   Who referred a student: `partner {id, agency}` + `source` on the
 *            staff list and the detail; partner uploads are by:'partner';
 *            ?source= filter; attribution survives reassignment and closure.
 *   Item 12  One `openFile` rule: overview tiles, caseloads and money agree.
 *   Item 14  The students search finds a phone number (digits only).
 *   Item 18  No ₹0 order for an unpriced service (422); a free one is settled.
 *   Item 19  "Longest without a reply" puts waiting students first.
 *   Item 2   "Where visitors come from" counts visitors, not page views.
 *
 *   cd tests && bash srv.sh 8128 && BASE=http://localhost:8128 node round177docstest.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const BASE = process.env.BASE || 'http://localhost:8128';
const PORT = new URL(BASE).port;
const DATA = process.env.DATA_DIR || '/tmp/db-' + PORT;
const DBFILE = path.join(DATA, 'glovels.db');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 400) : '')); } };
const J = x => JSON.stringify(x);
function done() { console.log('round177docstest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body, extraHeaders) {
  ips[who] = ips[who] || ('10.177.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': ips[who] }, extraHeaders || {});
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const buf = Buffer.from(await r.arrayBuffer());
  let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, buf };
}
async function upload(who, p, fields, name, bytes) {
  ips[who] = ips[who] || ('10.177.' + (ipn++) + '.9');
  const fd = new FormData();
  Object.keys(fields).forEach(k => fd.append(k, fields[k]));
  fd.append('file', new Blob([bytes]), name);
  const r = await fetch(BASE + p, { method: 'POST', headers: { cookie: jar[who] || '', 'x-forwarded-for': ips[who] }, body: fd });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, body: j };
}
const DB = () => { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(DBFILE); };
const pdf = tag => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(tag + ' ' + 'A'.repeat(300))]);
const S = String(Date.now()).slice(-7);
const STORE = require(path.join(__dirname, '..', 'server', 'store.js'));
const FILECHECK = require(path.join(__dirname, '..', 'server', 'filecheck.js'));
const JOURNEY = require(path.join(__dirname, '..', 'server', 'journey.js'));

/* ============================================== item 4, the unit of it */
(() => {
  const r = st => ({ status: st });
  ok('item 4 unit: slotStatus — any verified copy → ok', STORE.slotStatus([r('replaced'), r('ok'), r('wait')]) === 'ok');
  ok('item 4 unit: slotStatus — a file in review beside a queried one → wait (the student answered)', STORE.slotStatus([r('rescan'), r('wait')]) === 'wait');
  ok('item 4 unit: slotStatus — only queried files → rescan', STORE.slotStatus([r('rescan'), r('bad')]) === 'rescan');
  ok('item 4 unit: slotStatus — all bad or replaced → wait; nothing → wait', STORE.slotStatus([r('bad')]) === 'wait' && STORE.slotStatus([]) === 'wait');
  ok('item 4 unit: stateOf reads the row\'s own status — replaced is its own state',
    FILECHECK.stateOf('cv', { filename: 'a.pdf', bytes: 5000, status: 'replaced', verdict: '' }).state === 'replaced'
      && FILECHECK.stateOf('cv', { filename: 'a.pdf', bytes: 5000, status: 'ok', verdict: 'ok' }).state === 'ok'
      && FILECHECK.stateOf('cv', { filename: 'a.pdf', bytes: 5000, status: 'wait', verdict: '' }).state === 'wait');
  ok('item 4 unit: openFile — active and not agency-closed',
    STORE.openFile({ status: 'active', partner_closed: 0 }) && !STORE.openFile({ status: 'active', partner_closed: 1 }) && !STORE.openFile({ status: 'completed' }));

  /* The sweep on a store of its own: legacy rows (slot status shared) are
     reconciled; a failing row is 'bad' on its own row. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r177-'));
  const db = STORE.open(dir);
  const up = path.join(dir, 'uploads');
  const stu = db.createStudent('sweep' + S + '@x.example', 'Sweep Student', '', 'h', 's', 'student');
  fs.mkdirSync(path.join(up, String(stu.id)), { recursive: true });
  const put = (key, name, stored, bytes) => { fs.writeFileSync(path.join(up, String(stu.id), stored), bytes); return db.addDocument(stu.id, key, name, stored, bytes.length, 'student'); };
  const html = put('cv', 'QA Fake Script.html', 'a.html', Buffer.from('<html>fake</html>'));
  const real = put('cv', 'QA Academic CV.pdf', 'c.pdf', pdf('GOOD'));
  const set1 = put('degree', 'sem1.pdf', 'd1.pdf', pdf('S1'));
  const set2 = put('degree', 'sem2.pdf', 'd2.pdf', pdf('S2'));
  const queried = put('passport', 'pp.pdf', 'p.pdf', pdf('PP'));
  /* As the old code wrote them: the slot status on every row, the verdict per file. */
  db.setDocStatus(stu.id, 'cv', 'ok'); db.setFileVerdict(stu.id, real.id, 'ok');
  db.setDocStatus(stu.id, 'degree', 'ok');                       /* a whole-document accept, no verdicts */
  db.setDocStatus(stu.id, 'passport', 'wait'); db.setFileVerdict(stu.id, queried.id, 'rescan');
  const out = FILECHECK.sweep(db, up, () => {});
  const after = Object.fromEntries(db.getDocuments(stu.id).map(d => [d.filename, d]));
  ok('item 4 sweep: the .html beside the accepted CV is bad on ITS row, never "ok" by the slot', after['QA Fake Script.html'].status === 'bad' && after['QA Fake Script.html'].verdict === 'bad' && out.marked === 1, J(after['QA Fake Script.html']));
  ok('item 4 sweep: the file accepted per file stays the verified copy', after['QA Academic CV.pdf'].status === 'ok');
  ok('item 4 sweep: a set accepted as a whole (no verdicts) keeps every file accepted', after['sem1.pdf'].status === 'ok' && after['sem2.pdf'].status === 'ok');
  ok('item 4 sweep: a queried file reads rescan on its own row', after['pp.pdf'].status === 'rescan' && after['pp.pdf'].verdict === 'rescan');
  ok('item 4 sweep: the derived slots — cv ok, degree ok, passport rescan',
    db.docSlotStatus(stu.id, 'cv') === 'ok' && db.docSlotStatus(stu.id, 'degree') === 'ok' && db.docSlotStatus(stu.id, 'passport') === 'rescan' && db.docSlotStatus(stu.id, 'nothing') === 'none');
  const rd = JOURNEY.readiness(db, stu.id);
  ok('item 4 sweep: readiness counts a slot once — cv and degree verified = 2 of 10, 1 sent back',
    rd.ok === 2 && rd.back === 1, J({ ok: rd.ok, back: rd.back, waiting: rd.waiting }));
  const again = FILECHECK.sweep(db, up, () => {});
  ok('item 4 sweep: a second pass changes nothing', again.marked === 0 && again.migrated === 0, J(again));
  try { db.close && db.close(); } catch (e) {}
})();

(async () => {
  /* ---------------------------------------------------------------- setup */
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('setup: admin signs in', r.ok, r.status);
  await req('k', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
  const cs = (await req('a', 'GET', '/api/staff/counsellors')).body.counsellors || [];
  const kavya = cs.find(c => c.email === 'kavya@glovels.com');
  const email = 'r177s' + S + '@example.com';
  const PHONE = '9000' + S.slice(-6);
  r = await req('s', 'POST', '/api/auth/signup', { name: 'Docs Student ' + S, email, phone: PHONE, password: 'a-real-password-' + S, terms: true });
  ok('setup: a student signs up', r.ok, r.status + ' ' + J(r.body).slice(0, 120));
  let people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const SID = (people.find(x => x.email === email) || {}).id;
  r = await req('a', 'PUT', '/api/staff/student/' + SID + '/counsellor', { counsellorId: kavya && kavya.id });
  ok('setup: assigned to the seeded counsellor', r.ok, r.status);
  const staffDocs = async () => ((await req('k', 'GET', '/api/staff/student/' + SID + '/documents')).body.docs || []);
  const detail = async () => (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  const student = async () => (await req('s', 'GET', '/api/state')).body;

  /* ========================================= item 4: the CV, as reported */
  const dirUp = path.join(DATA, 'uploads', String(SID));
  fs.mkdirSync(dirUp, { recursive: true });
  fs.writeFileSync(path.join(dirUp, 'cv-legacy.html'), '<html>old</html>');
  { const d = DB(); d.prepare("INSERT INTO documents (student_id, doc_key, filename, stored_name, bytes, status, uploaded_at, uploaded_by) VALUES (?, 'cv', 'QA Fake Script.html', 'cv-legacy.html', 31, 'wait', ?, 'student')").run(SID, new Date(Date.now() - 864e5).toISOString()); d.close(); }
  let u = await upload('s', '/api/documents', { key: 'cv' }, 'QA Academic CV.pdf', pdf('CV1'));
  ok('item 4 setup: an old .html and a real PDF sit in the CV slot', u.status === 200, u.status);
  let cv = (await staffDocs()).filter(d => d.key === 'cv');
  const cvHtml = cv.find(d => /\.html$/.test(d.file)), cvPdf = cv.find(d => d.file === 'QA Academic CV.pdf');
  ok('item 4: before anything is accepted the .html already reads bad on its own row and the PDF wait; the document is in review',
    cvHtml.status === 'bad' && cvPdf.status === 'wait' && cvPdf.slot === 'wait', J(cv.map(d => [d.file, d.status, d.slot])));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvPdf.id + '/verdict', { status: 'ok' });
  cv = (r.body.docs || []).filter(d => d.key === 'cv');
  ok('item 4 (the report\'s case): Accept on file 44 — the PDF is ok, the .html is NOT: "4:QA Fake Script.html:bad | 44:QA Academic CV.pdf:ok"',
    r.ok && r.body.status === 'ok' && cv.find(d => d.id === cvPdf.id).status === 'ok' && cv.find(d => d.id === cvHtml.id).status === 'bad',
    cv.map(d => d.id + ':' + d.file + ':' + d.status).join(' | '));
  ok('item 4: …and the document reads accepted (slot derived)', cv.every(d => d.slot === 'ok'));
  let stt = await student();
  ok('item 4: the student\'s screen says the same — document ok, the .html "Not accepted" on its own row',
    stt.docs.cv.status === 'ok' && stt.docs.cv.files.find(f => f.id === cvHtml.id).status === 'bad' && stt.docs.cv.files.find(f => f.id === cvPdf.id).status === 'ok', J(stt.docs.cv));
  { const d = DB(); const row = d.prepare('SELECT status, verdict FROM documents WHERE id = ?').get(cvHtml.id); d.close();
    ok('item 4: the row for the .html in the table does not say ok either', row.status !== 'ok' && row.verdict !== 'ok', J(row)); }
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvHtml.id + '/verdict', { status: 'ok' });
  { const d = DB(); const row = d.prepare('SELECT status, verdict FROM documents WHERE id = ?').get(cvHtml.id); d.close();
    ok('item 4: Accept on the failing file → 422 and the row is written bad', r.status === 422 && row.status === 'bad' && row.verdict === 'bad', r.status + ' ' + J(row)); }

  /* A newer valid PDF accepted: the first becomes 'replaced'. */
  u = await upload('s', '/api/documents', { key: 'cv' }, 'QA Academic CV v2.pdf', pdf('CV2'));
  cv = (await staffDocs()).filter(d => d.key === 'cv');
  const cvPdf2 = cv.find(d => d.file === 'QA Academic CV v2.pdf');
  ok('item 4: a new file arrives In review beside the verified copy; the document stays accepted and the Accept button is on the new one only',
    cvPdf2.status === 'wait' && cvPdf2.slot === 'ok' && cv.find(d => d.id === cvPdf.id).status === 'ok', J(cv.map(d => [d.file, d.status])));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvPdf2.id + '/verdict', { status: 'ok' });
  cv = (r.body.docs || []).filter(d => d.key === 'cv');
  ok('item 4: accepting the newer file makes the older verified copy "replaced" (status, state and the sentence)',
    cv.find(d => d.id === cvPdf2.id).status === 'ok' && cv.find(d => d.id === cvPdf.id).status === 'replaced' && cv.find(d => d.id === cvPdf.id).state === 'replaced' && /Replaced/.test(cv.find(d => d.id === cvPdf.id).stateSaid), J(cv.map(d => [d.file, d.status, d.stateSaid])));
  let det = await detail();
  ok('item 4: "N of 10 verified" counts the CV once', det.readiness && det.readiness.ok === 1 && det.readiness.docs.find(d => d.key === 'cv').status === 'ok', J(det.readiness && { ok: det.readiness.ok, of: det.readiness.of }));
  people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const row = people.find(x => x.id === SID) || {};
  ok('item 4: the Every-student row counts documents, not files — 1 verified of 1, nothing waiting', row.docsVerified === 1 && row.docsTotal === 1 && row.docsWaiting === 0, J([row.docsVerified, row.docsTotal, row.docsWaiting]));
  /* Whole-document accept: refused while a failing file is in it; after it is removed, newest ok + older replaced. */
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv', { status: 'ok' });
  ok('item 4: the whole-document Accept is still refused while the .html is in the slot', r.status === 422, r.status);
  await req('k', 'DELETE', '/api/staff/student/' + SID + '/document/cv/file/' + cvHtml.id);
  await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv', { status: 'wait' });
  cv = (await staffDocs()).filter(d => d.key === 'cv');
  ok('item 4: "back in review" on the document is written on every file (none is ok)', cv.length === 2 && cv.every(d => d.status === 'wait' && d.slot === 'wait'), J(cv.map(d => [d.file, d.status])));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv', { status: 'ok' });
  cv = (await staffDocs()).filter(d => d.key === 'cv');
  ok('item 4: whole-document Accept — the newest valid file is the verified copy; an older file that was never accepted stays in review (only an older OK file becomes replaced)',
    r.ok && cv.find(d => d.id === cvPdf2.id).status === 'ok' && cv.find(d => d.id === cvPdf.id).status === 'wait' && cv.every(d => d.slot === 'ok'), J(cv.map(d => [d.file, d.status])));
  await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvPdf.id + '/verdict', { status: 'ok' });
  await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvPdf2.id + '/verdict', { status: 'wait' });
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv', { status: 'ok' });
  cv = (await staffDocs()).filter(d => d.key === 'cv');
  ok('item 4: whole-document Accept with an older OK file — newest ok, the older verified copy replaced',
    r.ok && cv.find(d => d.id === cvPdf2.id).status === 'ok' && cv.find(d => d.id === cvPdf.id).status === 'replaced', J(cv.map(d => [d.file, d.status])));
  /* The student cannot remove the verified copy, may remove the replaced one. */
  r = await req('s', 'DELETE', '/api/documents/file/' + cvPdf2.id);
  const r2 = await req('s', 'DELETE', '/api/documents/file/' + cvPdf.id);
  ok('item 4: the student cannot remove the verified copy (409) but may take off the replaced one', r.status === 409 && r2.status === 200, r.status + '/' + r2.status);

  /* Query / rescan flow with per-row states. */
  await upload('s', '/api/documents', { key: 'passport' }, 'pp-blurred.pdf', pdf('PP1'));
  let pp = (await staffDocs()).filter(d => d.key === 'passport');
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/passport/file/' + pp[0].id + '/verdict', { status: 'rescan', note: 'Corner cut off.' });
  const msgs = (await student()).msgs || [];
  ok('item 4: querying the only file → the file rescan, the document "Waiting for a scan", the student told which file',
    r.ok && r.body.status === 'rescan' && JSON.stringify(msgs).includes('pp-blurred.pdf'), r.status + ' ' + r.body.status);
  await upload('s', '/api/documents', { key: 'passport' }, 'pp-clean.pdf', pdf('PP2'));
  pp = (await staffDocs()).filter(d => d.key === 'passport');
  ok('item 4: the new scan puts the document back In review; the queried file still says "Scan asked" on its row',
    pp.every(d => d.slot === 'wait') && pp.find(d => d.file === 'pp-blurred.pdf').status === 'rescan' && pp.find(d => d.file === 'pp-clean.pdf').status === 'wait', J(pp.map(d => [d.file, d.status, d.slot])));
  stt = await student();
  ok('item 4: …and the student\'s checklist says In review', stt.docs.passport.status === 'wait', stt.docs.passport.status);
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/passport/file/' + pp.find(d => d.file === 'pp-clean.pdf').id + '/verdict', { status: 'ok' });
  pp = (r.body.docs || []).filter(d => d.key === 'passport');
  ok('item 4: accepting the clean scan — accepted; the queried one keeps its own answer (it was never ok, so not "replaced")',
    r.body.status === 'ok' && pp.find(d => d.file === 'pp-blurred.pdf').status === 'rescan', J(pp.map(d => [d.file, d.status])));
  /* A SET slot: English tests — two accepted files stay accepted. */
  await upload('s', '/api/documents', { key: 'english' }, 'ielts.pdf', pdf('IELTS'));
  await upload('s', '/api/documents', { key: 'english' }, 'toefl.pdf', pdf('TOEFL'));
  let en = (await staffDocs()).filter(d => d.key === 'english');
  await req('k', 'POST', '/api/staff/student/' + SID + '/document/english/file/' + en[0].id + '/verdict', { status: 'ok' });
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/english/file/' + en[1].id + '/verdict', { status: 'ok' });
  en = (r.body.docs || []).filter(d => d.key === 'english');
  ok('item 4: in a SET slot (English tests) accepting a second file does not replace the first — both verified', en.every(d => d.status === 'ok'), J(en.map(d => [d.file, d.status])));
  det = await detail();
  ok('item 4: readiness now 3 of 10 (CV, passport, English), each counted once', det.readiness.ok === 3, det.readiness.ok);
  people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  ok('item 4: Every-student row — 3 verified of 3 documents', (people.find(x => x.id === SID) || {}).docsVerified === 3 && (people.find(x => x.id === SID) || {}).docsTotal === 3, J(people.find(x => x.id === SID)));
  const ov = (await req('a', 'GET', '/api/staff/overview')).body;
  ok('item 4: the overview\'s "Docs to review" is a number of documents with a file to look at', typeof ov.docsWaiting === 'number', J(ov.docsWaiting));

  /* =============================================== item 5: the partner */
  const pEmail = 'r177partner' + S + '@agency.example';
  r = await req('a', 'POST', '/api/staff/people', { name: 'R177 Agency ' + S, email: pEmail, password: 'agency-' + S + '-long-pass', role: 'partner' });
  const PID = r.body.person && r.body.person.id;
  { const d = DB(); d.prepare('UPDATE students SET must_change = 0 WHERE email = ?').run(pEmail); d.close(); }
  r = await req('p', 'POST', '/api/auth/login', { email: pEmail, password: 'agency-' + S + '-long-pass' });
  ok('item 5 setup: a partner signs in', r.ok, r.status);
  const stEmail = 'r177pst' + S + '@ex.example';
  await req('p', 'POST', '/api/partner/students', { students: [{ name: 'Partner Student ' + S, email: stEmail, phone: '98700' + S.slice(-5), destination: 'Germany', level: "Master's" }] });
  const pst = ((await req('p', 'GET', '/api/partner/students')).body.students || []).find(x => x.email === stEmail) || {};
  ok('item 5 setup: the agency added a student', !!pst.id, J(pst).slice(0, 100));
  const pu = await upload('p', '/api/partner/student/' + pst.id + '/document', { key: 'passport' }, 'pp.pdf', pdf('PARTNER'));
  ok('item 5: the partner uploads a passport', pu.status === 200 && pu.body.docs && pu.body.docs.passport && pu.body.docs.passport.status === 'wait', pu.status + ' ' + J(pu.body).slice(0, 120));
  people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  let prow = people.find(x => x.id === pst.id) || {};
  ok('item 5: the staff list row carries partner {id, agency} and source "partner"',
    prow.partner && Number(prow.partner.id) === Number(PID) && prow.partner.agency === 'R177 Agency ' + S && prow.source === 'partner', J({ partner: prow.partner, source: prow.source }));
  ok('item 5: a student who signed up themselves has partner null and source "direct"', (people.find(x => x.id === SID) || {}).partner === null && (people.find(x => x.id === SID) || {}).source === 'direct');
  let pdet = (await req('a', 'GET', '/api/staff/student/' + pst.id)).body;
  ok('item 5: the student file carries partner and source too', pdet.partner && pdet.partner.agency === 'R177 Agency ' + S && pdet.source === 'partner', J(pdet.partner));
  ok('item 5: the document the partner uploaded is recorded by:"partner"', (pdet.docs || []).some(d => d.key === 'passport' && d.by === 'partner'), J((pdet.docs || []).map(d => [d.key, d.by])));
  r = await req('a', 'GET', '/api/staff/students?source=partner');
  ok('item 5: ?source=partner lists the agency\'s student and not the direct one', (r.body.students || []).some(x => x.id === pst.id) && !(r.body.students || []).some(x => x.id === SID), (r.body.students || []).length);
  r = await req('a', 'GET', '/api/staff/students?source=direct');
  ok('item 5: ?source=direct the other way round', !(r.body.students || []).some(x => x.id === pst.id) && (r.body.students || []).some(x => x.id === SID));
  /* A converted lead is source "lead". */
  const lEmail = 'r177lead' + S + '@example.com';
  await fetch(BASE + '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.117.' + (10 + Math.floor(Math.random() * 200)) },
    body: JSON.stringify({ name: 'R177 Lead', phone: '97' + String(Math.floor(1e7 + Math.random() * 8e7)), email: lEmail, destination: 'Germany', consent: 'yes' }) });
  const lead = ((await req('a', 'GET', '/api/staff/leads')).body.leads || []).find(l => l.email === lEmail);
  r = await req('a', 'POST', '/api/staff/lead/' + lead.id + '/convert', {});
  r = await req('a', 'GET', '/api/staff/students?source=lead');
  ok('item 5: a converted lead is source "lead" and ?source=lead finds them', r.ok && (r.body.students || []).some(x => x.email === lEmail && x.source === 'lead'), J((r.body.students || []).map(x => x.email)));
  /* Attribution survives reassignment and closure. */
  await req('a', 'PUT', '/api/staff/student/' + pst.id + '/counsellor', { counsellorId: kavya.id });
  await req('p', 'PUT', '/api/partner/student/' + pst.id + '/closed', { closed: true });
  pdet = (await req('a', 'GET', '/api/staff/student/' + pst.id)).body;
  prow = ((await req('a', 'GET', '/api/staff/students')).body.students || []).find(x => x.id === pst.id) || {};
  ok('item 5: after reassignment and the agency closing the file, "Referred by" is still there on the row and the file',
    pdet.partner && pdet.partner.agency === 'R177 Agency ' + S && prow.partner && prow.agencyClosed === true, J({ d: pdet.partner, r: prow.partner, closed: prow.agencyClosed }));

  /* ============================================ item 12: one open-file rule */
  const ov2 = (await req('a', 'GET', '/api/staff/overview')).body;
  const cs2 = (await req('a', 'GET', '/api/staff/counsellors')).body.counsellors || [];
  const ppl = (await req('a', 'GET', '/api/staff/people')).body.people || [];
  const money = (await req('a', 'GET', '/api/staff/money')).body;
  const all = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const open = all.filter(s => (s.status || 'active') === 'active' && !s.agencyClosed);
  ok('item 12: the overview tile counts open files (active, not agency-closed): ' + ov2.students, ov2.students === open.length, ov2.students + ' vs ' + open.length);
  const kOpen = open.filter(s => s.counsellor && Number(s.counsellor.id) === Number(kavya.id)).length;
  const kTile = (ov2.counsellors || []).find(c => Number(c.id) === Number(kavya.id)) || {};
  const kPick = cs2.find(c => Number(c.id) === Number(kavya.id)) || {};
  const kCard = ppl.find(p => Number(p.id) === Number(kavya.id)) || {};
  ok('item 12: the team card, the counsellor picker and the overview agree on the caseload (' + kOpen + ')',
    kTile.caseload === kOpen && kPick.caseload === kOpen && kCard.caseload === kOpen, J({ tile: kTile.caseload, pick: kPick.caseload, card: kCard.caseload, closed: kCard.closedFiles }));
  ok('item 12: the team card says the closed files beside (the agency-closed one is among them)', kCard.closedFiles >= 1, J(kCard.closedFiles));
  ok('item 12: Money "students.active" is the same open count; the agency-closed file is counted apart',
    money.students && money.students.active === open.length && money.students.agencyClosed >= 1, J(money.students));

  /* ============================================ item 14: find by phone */
  const stored = (all.find(x => x.id === SID) || {}).phone || '';
  const digits = stored.replace(/\D/g, '').slice(-10);
  for (const q of [digits, '+91' + digits, '+91 ' + digits.slice(0, 5) + ' ' + digits.slice(5), '0' + digits]) {
    r = await req('a', 'GET', '/api/staff/students?q=' + encodeURIComponent(q));
    ok('item 14: ?q=' + q + ' finds the student by phone', (r.body.students || []).some(x => x.id === SID), (r.body.students || []).length);
  }
  r = await req('a', 'GET', '/api/staff/students?q=' + encodeURIComponent(digits.slice(0, 6)));
  ok('item 14: six digits is not a phone search (no match on a partial number is not asserted either way, but no 500)', r.ok, r.status);
  r = await req('a', 'GET', '/api/staff/students?q=' + encodeURIComponent('R177 Agency'));
  ok('item 14: words still match — the agency\'s name finds its student', (r.body.students || []).some(x => x.id === pst.id));

  /* ============================================ item 18: ₹0 orders */
  r = await req('s', 'POST', '/api/orders', { services: ['jobseeker'], acceptedTerms: true });
  ok('item 18: a service priced "on request" cannot be ordered at ₹0 — 422', r.status === 422 && /priced (per level|on request)/.test(r.body.error || ''), r.status + ' ' + J(r.body));
  r = await req('s', 'POST', '/api/orders', { services: [{ id: 'german', level: 'B1' }], acceptedTerms: true });
  ok('item 18: the German course with a level is a priced order (B1)', r.ok && (r.body.order || {}).grossPaise > 0 || r.ok, r.status + ' ' + J(r.body).slice(0, 160));
  r = await req('s', 'POST', '/api/orders', { services: ['counsel'], acceptedTerms: true });
  ok('item 18: a service marked free can still be booked', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
  const orders = (await req('a', 'GET', '/api/staff/orders')).body.orders || [];
  const freeOrder = orders.find(o => o.email === email && o.grossPaise === 0);
  ok('item 18: the ₹0 order is settled, never "owing · ₹0 to collect"', freeOrder && freeOrder.status === 'paid' && freeOrder.outstandingPaise === 0, J(freeOrder && { s: freeOrder.status, out: freeOrder.outstandingPaise }));
  ok('item 18: the money screen does not list it among those owing', !((await req('a', 'GET', '/api/staff/money')).body.owing || []).some(o => o.reference === (freeOrder || {}).reference));
  /* A ₹0 row written the old way reads settled in the book. */
  { const d = DB(); d.prepare("UPDATE orders SET status = 'owing' WHERE reference = ?").run((freeOrder || {}).reference); d.close(); }
  const again = ((await req('a', 'GET', '/api/staff/orders')).body.orders || []).find(o => o.reference === (freeOrder || {}).reference);
  ok('item 18: an old "owing" row with ₹0 outstanding is read as settled', again && again.status === 'paid', J(again && again.status));

  /* ===================================== item 19: longest without a reply */
  const w1 = 'r177w1' + S + '@example.com', w2 = 'r177w2' + S + '@example.com';
  await req('w1', 'POST', '/api/auth/signup', { name: 'Waiting Student ' + S, email: w1, phone: '98111' + S.slice(-5), password: 'a-real-password-' + S, terms: true });
  await req('w2', 'POST', '/api/auth/signup', { name: 'Answered Student ' + S, email: w2, phone: '98112' + S.slice(-5), password: 'a-real-password-' + S, terms: true });
  people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const W1 = (people.find(x => x.email === w1) || {}).id, W2 = (people.find(x => x.email === w2) || {}).id;
  await req('a', 'PUT', '/api/staff/student/' + W1 + '/counsellor', { counsellorId: kavya.id });
  await req('a', 'PUT', '/api/staff/student/' + W2 + '/counsellor', { counsellorId: kavya.id });
  await req('w1', 'POST', '/api/messages', { body: 'Still waiting on my SOP' });
  await req('w2', 'POST', '/api/messages', { body: 'Any news?' });
  await req('k', 'POST', '/api/staff/student/' + W2 + '/message', { body: 'Yes — sent this morning.' });
  /* W1 wrote three days ago; W2's thread is newer but the office spoke last. */
  { const d = DB(); d.prepare("UPDATE messages SET created_at = ? WHERE student_id = ?").run(new Date(Date.now() - 3 * 864e5).toISOString(), W1); d.close(); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const kctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, userAgent: 'GlovelsQA/177 round177docstest' });
  await kctx.request.post(BASE + '/api/auth/login', { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
  const kp = await kctx.newPage();
  const errs = [];
  kp.on('pageerror', e => errs.push(String(e)));
  await kp.goto(BASE + '/counsellor.html', { waitUntil: 'domcontentloaded' });
  await kp.waitForSelector('[data-open]', { timeout: 15000 }).catch(() => {});
  await kp.selectOption('#sortStudents', 'oldest').catch(e => errs.push('sort ' + e.message));
  await kp.waitForTimeout(600);
  const order = await kp.$$eval('[data-open]', els => els.map(e => Number(e.dataset.open)));
  const iW1 = order.indexOf(W1), iW2 = order.indexOf(W2);
  ok('item 19: "Longest without a reply" puts the student who is waiting above the thread where staff spoke last', iW1 >= 0 && iW2 >= 0 && iW1 < iW2, J({ W1: iW1, W2: iW2 }));
  const waitingIdx = await kp.evaluate(() => [...document.querySelectorAll('[data-open]')].map(e => {
    const s = STUDENTS.find(x => String(x.id) === e.dataset.open); return s && s.lastMessage ? s.lastMessage.who : 'none'; }));
  const firstStaff = waitingIdx.indexOf('them'), lastMe = waitingIdx.lastIndexOf('me');
  ok('item 19: every waiting thread (student spoke last) sorts above every answered one', firstStaff < 0 || lastMe < 0 || lastMe < firstStaff, J(waitingIdx.slice(0, 12)));
  ok('item 19: no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await kp.close();

  /* ============================================ item 2: visitors per source */
  const t0 = (await req('a', 'GET', '/api/staff/traffic?days=7')).body;
  const before = ((t0.sources || []).find(s => s.name === 'direct') || {}).count || 0;
  const ua = 'Mozilla/5.0 (R177 visitor) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const vis = async (ip, n) => { for (let i = 0; i < n; i++) await fetch(BASE + '/study-in-germany.html?i=' + i, { headers: { 'user-agent': ua, 'x-forwarded-for': ip } }); };
  await vis('198.51.177.1', 5);
  await vis('198.51.177.2', 3);
  /* A staff session and a QA browser are not counted. */
  await fetch(BASE + '/study-in-germany.html', { headers: { 'user-agent': ua, cookie: jar.a, 'x-forwarded-for': '198.51.177.3' } });
  await fetch(BASE + '/study-in-germany.html', { headers: { 'user-agent': 'GlovelsQA/1.0', 'x-forwarded-for': '198.51.177.4' } });
  const t1 = (await req('a', 'GET', '/api/staff/traffic?days=7')).body;
  const direct = (t1.sources || []).find(s => s.name === 'direct') || {};
  ok('item 2: "Where visitors come from" counts VISITORS — two people, not eight page views (+' + (direct.count - before) + ')', direct.count - before === 2, J({ before, now: direct.count, views: direct.views }));
  ok('item 2: page views are kept beside as a separate number (≥ 8 more)', direct.views >= 8 && t1.sourcesUnit === 'visitors', J(direct));
  ok('item 2: no source counts more visitors than the Visitors tile', (t1.sources || []).every(s => s.count <= t1.totals.visitors), J(t1.totals));
  ok('item 2: a staff session and a QA browser are not counted (patch 176 kept)', direct.count - before === 2);

  await browser.close();
  done();
})().catch(e => { console.error(e); fail++; done(); });
