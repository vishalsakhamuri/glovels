#!/usr/bin/env node
'use strict';
/*
 * Round 175 (27 Oct report, items 4, 5 and 7).
 *
 *   Item 4  Programmes whose deadlines have passed were suggested first and
 *           added with no warning. Now: a confirmed open deadline ranks
 *           above a date rolled from last year; a row whose dates cannot
 *           roll is never a pick and ranks last on the screen; adding a
 *           closed programme is a 409 until the counsellor says "Add
 *           anyway" (force), and the student is then told the next intake
 *           is not announced; an empty profile gets "tell us more" instead
 *           of 2,707 fits.
 *   Item 5  Accepting the real CV also "verified" an old .html beside it.
 *           Now: a file's own state is what is shown (bad / ok / rescan /
 *           wait); Accept refuses a tiny or HTML-inside "PDF"; the sweep
 *           marks such files 'bad' and never deletes them.
 *   Item 7  Organisation tiles count active files (closed said beside);
 *           an enquiry from a staff or test account's number is Internal —
 *           no cold-lead alert, a chip in the book; the admin's enquiries
 *           number is the book's.
 *
 *   BASE=http://localhost:8120 node tests/round175counseltest.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const BASE = process.env.BASE || 'http://localhost:8120';
const PORT = new URL(BASE).port;
const DATA = process.env.DATA_DIR || '/tmp/db-' + PORT;
const DBFILE = path.join(DATA, 'glovels.db');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 400) : '')); } };
const J = x => JSON.stringify(x);
function done() { console.log('round175counseltest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.175.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const buf = Buffer.from(await r.arrayBuffer());
  let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, buf };
}
async function upload(who, p, fields, name, bytes) {
  ips[who] = ips[who] || ('10.175.' + (ipn++) + '.9');
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
const M = require(path.join(__dirname, '..', 'server', 'matches.js'));
const FILECHECK = require(path.join(__dirname, '..', 'server', 'filecheck.js'));
const STORE = require(path.join(__dirname, '..', 'server', 'store.js'));

/* ================================================= item 4, on the matcher */
(() => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const base = { program: 'Data Science', country: 'DE', level: 'master', field: 'Data Science, AI & Machine Learning', isPublic: true, totalInr: 0, reqs: {} };
  const rows = [
    Object.assign({}, base, { id: 'rolled', university: 'Rolled U', intakes: [{ season: 'winter', deadline: day(-100) }] }),
    Object.assign({}, base, { id: 'open', university: 'Open U', intakes: [{ season: 'winter', deadline: day(80) }] }),
    Object.assign({}, base, { id: 'later', university: 'Later U', intakes: [{ season: 'winter', deadline: day(200) }] }),
    Object.assign({}, base, { id: 'soon', university: 'Soon U', intakes: [{ season: 'winter', deadline: day(5) }] }),
    Object.assign({}, base, { id: 'nodates', university: 'Nodates U', intakes: [] }),
    Object.assign({}, base, { id: 'stuck', university: 'Stuck U', intakes: [{ season: 'winter', deadline: 'rolling, see site' }] }),
  ];
  const prof = { g_level: "Master's", g_field: 'Data Science', d_cgpa: '8', d_max: '10', d_pass: '4', g_country: 'Germany', d_course: 'B.Tech CSE' };
  const C = { DE: { code: 'DE', name: 'Germany' } };
  const di = M.deadlineInfo(rows[0]);
  ok('item 4: a programme whose only deadline passed is "closed" with the rolled date as its next', di.closed && !di.confirmed && di.next && di.next > today, J(di));
  ok('item 4: a date still ahead is confirmed, not closed', (d => d.confirmed && !d.closed)(M.deadlineInfo(rows[1])), J(M.deadlineInfo(rows[1])));
  ok('item 4: a date nobody can read cannot roll — not open', !M.deadlineInfo(rows[5]).open, J(M.deadlineInfo(rows[5])));
  ok('item 4: no dates at all is neither open-with-a-date nor closed', (d => d.open && !d.closed && !d.any)(M.deadlineInfo(rows[4])), J(M.deadlineInfo(rows[4])));
  const s = M.screen(rows, prof, C, { limit: 10 });
  const order = s.fits.map(r => r.id);
  ok('item 4 screen: confirmed open deadlines first (soonest first), then one inside 14 days, then rolled, then no dates, then stuck',
    order.join() === 'open,later,soon,rolled,nodates,stuck', J(order));
  ok('item 4 screen: rows say closed / lastDeadline / nextDeadline', (r => r.closed === true && r.lastDeadline === day(-100) && r.nextDeadline > day(0))(s.fits.find(r => r.id === 'rolled')), J(s.fits.find(r => r.id === 'rolled')));
  const picks = M.pick(rows, prof, 10, 'any', [], C).map(p => p.id);
  ok('item 4 pick: a row whose dates cannot roll is never a pick; rolled ones come after confirmed ones', !picks.includes('stuck') && picks.indexOf('open') < picks.indexOf('rolled'), J(picks));
  const plan = M.plan(rows, prof, 2, 'public', C);
  ok('item 4 plan (what a package delivers): the two confirmed-open ones, not the rolled one', plan.items.map(p => p.id).join() === 'open,later', J(plan.items.map(p => p.id)));
})();

/* ================================================= item 5, the file rules */
(() => {
  const rec = (filename, bytes, verdict) => ({ filename, bytes, verdict: verdict || '', status: 'wait' });
  ok('item 5: a .html in the CV slot fails', /not a PDF/.test(FILECHECK.fails('cv', rec('QA Fake Script.html', 31)) || ''), FILECHECK.fails('cv', rec('QA Fake Script.html', 31)));
  ok('item 5: a 31-byte "PDF" fails on size', /small/.test(FILECHECK.fails('cv', rec('x.pdf', 31)) || ''), FILECHECK.fails('cv', rec('x.pdf', 31)));
  ok('item 5: a PDF with HTML inside fails on the sniff', /text or HTML/.test(FILECHECK.fails('cv', rec('x.pdf', 5000), Buffer.from('<html><body>hi</body></html>')) || ''));
  ok('item 5: a real PDF passes', FILECHECK.fails('cv', rec('x.pdf', 5000), Buffer.from('%PDF-1.4\n')) === null);
  ok('item 5: a .docx in the Passport slot fails; in the CV slot it passes', !!FILECHECK.fails('passport', rec('p.docx', 5000)) && FILECHECK.fails('cv', rec('p.docx', 5000)) === null);
  ok('item 5: a file the sweep marked bad reads as bad without a sniff', !!FILECHECK.fails('cv', rec('x.pdf', 5000, 'bad')));
  const st = FILECHECK.stateOf('cv', Object.assign(rec('QA Fake Script.html', 31), { status: 'ok' }), true);
  ok('item 5: a bad file is never "verified", even in an accepted document read the legacy way', st.state === 'bad' && /Not accepted/.test(st.said), J(st));
  ok('item 5: verdict ok → "Verified copy"; rescan → "Scan asked"',
    FILECHECK.stateOf('cv', rec('a.pdf', 5000, 'ok')).said === 'Verified copy' && FILECHECK.stateOf('cv', rec('a.pdf', 5000, 'rescan')).said === 'Scan asked');

  /* The sweep, on a store of its own. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r175-'));
  const db = STORE.open(dir);
  const up = path.join(dir, 'uploads');
  const stu = db.createStudent('sweep' + S + '@x.example', 'Sweep Student', '', 'h', 's', 'student');
  fs.mkdirSync(path.join(up, String(stu.id)), { recursive: true });
  const put = (key, name, stored, bytes) => { fs.writeFileSync(path.join(up, String(stu.id), stored), bytes); return db.addDocument(stu.id, key, name, stored, bytes.length, 'student'); };
  const html = put('cv', 'QA Fake Script.html', 'a.html', Buffer.from('<html>fake</html>'));
  const fake = put('provis', 'looks-like.pdf', 'b.pdf', Buffer.concat([Buffer.from('<!DOCTYPE html>'), Buffer.alloc(2000, 0x41)]));
  const good = put('cv', 'real.pdf', 'c.pdf', pdf('GOOD'));
  db.setDocStatus(stu.id, 'cv', 'ok'); db.setDocStatus(stu.id, 'provis', 'ok');
  db.setFileVerdict(stu.id, html.id, 'ok');
  const lines = [];
  const r1 = FILECHECK.sweep(db, up, l => lines.push(l));
  const after = Object.fromEntries(db.getDocuments(stu.id).map(d => [d.filename, d]));
  ok('item 5 sweep: the .html and the HTML-inside "PDF" are marked bad, the real PDF is not', r1.marked === 2 && after['QA Fake Script.html'].verdict === 'bad' && after['looks-like.pdf'].verdict === 'bad' && after['real.pdf'].verdict === '', J(after));
  ok('item 5 sweep: an "ok" the bad file carried is gone', after['QA Fake Script.html'].verdict !== 'ok');
  ok('item 5 sweep: a slot whose only file is bad goes back to "wait"; a slot that still holds a good file keeps its status',
    after['looks-like.pdf'].status === 'wait' && after['real.pdf'].status === 'ok', J(after));
  ok('item 5 sweep: one log line, "[docs] N file(s) marked not accepted"', lines.length === 1 && /^\[docs\] 2 file\(s\) marked not accepted/.test(lines[0]), J(lines));
  ok('item 5 sweep: nothing is deleted', fs.existsSync(path.join(up, String(stu.id), 'a.html')) && db.getDocuments(stu.id).length === 3);
  const r2 = FILECHECK.sweep(db, up, l => lines.push(l));
  ok('item 5 sweep: a second pass marks nothing and logs nothing', r2.marked === 0 && lines.length === 1, J(r2));
  try { db.close && db.close(); } catch (e) {}
})();

(async () => {
  /* ---------------------------------------------------------------- setup */
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('setup: admin signs in', r.ok, r.status);
  const kPhone = '98123' + S.slice(-5);
  r = await req('a', 'POST', '/api/staff/people', { name: 'Round175 Counsellor', email: 'r175c-' + S + '@glovels.com', password: 'c-' + S + '-pw-long', phone: kPhone, role: 'counsellor' });
  ok('setup: a counsellor with a phone number', r.ok && r.body.person, r.status + ' ' + J(r.body).slice(0, 160));
  const KID = r.body.person && r.body.person.id;
  r = await req('k', 'POST', '/api/auth/login', { email: 'r175c-' + S + '@glovels.com', password: 'c-' + S + '-pw-long' });
  /* An account the office made must choose its own password first. */
  await req('k', 'POST', '/api/auth/change', { password: 'c-' + S + '-pw-longer' });
  r = await req('k', 'POST', '/api/auth/login', { email: 'r175c-' + S + '@glovels.com', password: 'c-' + S + '-pw-longer' });
  ok('setup: the counsellor signs in', r.ok, r.status);

  const email = 'r175s' + S + '@example.com';
  r = await req('s', 'POST', '/api/auth/signup', { name: 'Round175 Student ' + S, email, phone: '97765' + S.slice(-5), password: 'a-real-password-' + S, terms: true });
  ok('setup: a student signs up', r.ok, r.status);
  const people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const SID = (people.find(x => x.email === email) || {}).id;
  r = await req('a', 'PUT', '/api/staff/student/' + SID + '/counsellor', { counsellorId: KID });
  ok('setup: assigned to the counsellor', r.ok, r.status);

  /* ============================================= item 4c: an empty profile */
  r = await req('k', 'GET', '/api/staff/student/' + SID + '/fit?limit=50');
  ok('item 4c: an empty profile (no level, field or CGPA) gets needs [level, field] and no rows',
    r.ok && Array.isArray(r.body.needs) && r.body.needs.join() === 'level,field' && (r.body.fits || []).length === 0 && (r.body.near || []).length === 0 && r.body.counts.looked === 0,
    r.status + ' ' + J(r.body).slice(0, 200));
  r = await req('a', 'POST', '/api/staff/fit', { profile: {}, filters: { limit: 50, kind: 'any' } });
  ok('item 4c: the admin\'s matcher says the same for an empty profile', r.ok && (r.body.needs || []).join() === 'level,field' && r.body.counts.fits === 0, J(r.body).slice(0, 200));
  r = await req('a', 'POST', '/api/staff/fit', { profile: {}, filters: { limit: 50, kind: 'any', g_level: "Master's", g_field: 'Computer Science', d_cgpa: '8', d_max: '10' } });
  ok('item 4c: with a level and field typed into the panel it runs', r.ok && !r.body.needs && r.body.counts.looked > 0, J(r.body.counts));

  /* ====================================== item 4: the counsellor's screen */
  const Q = 'g_level=' + encodeURIComponent("Master's") + '&g_field=' + encodeURIComponent('Data Science') + '&d_cgpa=8&d_max=10&d_pass=4&g_country=Germany&d_course=' + encodeURIComponent('B.Tech CSE') + '&limit=2000&kind=any';
  r = await req('k', 'GET', '/api/staff/student/' + SID + '/fit?' + Q);
  const fits = r.body.fits || [];
  ok('item 4: the screen answers with rows', r.ok && fits.length > 5, r.status + ' ' + fits.length);
  const today = new Date().toISOString().slice(0, 10);
  const firstClosed = fits.findIndex(f => f.closed), lastConfirmed = (() => { let i = -1; fits.forEach((f, k) => { if (f.deadlineConfirmed && f.relevance === fits[0].relevance && !(f.soft || []).length && !(f.ask || []).length) i = k; }); return i; })();
  const topTier = fits.filter(f => f.relevance === fits[0].relevance && !(f.soft || []).length && !(f.ask || []).length);
  const closedBeforeConfirmed = topTier.some((f, i) => f.closed && topTier.slice(i + 1).some(g => g.deadlineConfirmed));
  ok('item 4: within the top tier no closed programme sits above one with a confirmed open deadline (' + topTier.filter(f => f.closed).length + ' closed, ' + topTier.filter(f => f.deadlineConfirmed).length + ' confirmed)',
    !closedBeforeConfirmed, J(topTier.slice(0, 8).map(f => [f.university, f.nextDeadline, f.closed])));
  ok('item 4: the first suggestion is not a programme whose every deadline has passed', fits[0] && !fits[0].closed, J([fits[0].university, fits[0].program, fits[0].nextDeadline, fits[0].closed]));
  ok('item 4: every row carries its next deadline as a date in the future, or none', fits.every(f => f.nextDeadline == null || f.nextDeadline >= today), J(fits.filter(f => f.nextDeadline && f.nextDeadline < today).slice(0, 3)));

  /* ============================================ item 4b: adding a closed one */
  const closedRow = fits.find(f => f.closed) || (r.body.near || []).find(f => f.closed);
  const openRow = fits.find(f => f.deadlineConfirmed && !f.closed);
  ok('item 4b setup: the catalogue has a closed programme and an open one to try', !!closedRow && !!openRow, J([closedRow && closedRow.id, openRow && openRow.id]));
  if (closedRow && openRow) {
    r = await req('k', 'POST', '/api/staff/student/' + SID + '/shortlist', { id: closedRow.id });
    ok('item 4b: adding a programme whose every deadline has passed is refused with 409 {closed, lastDeadline}',
      r.status === 409 && r.body.closed === true && r.body.lastDeadline === closedRow.lastDeadline && /Every deadline for this programme has passed \(last .+\)\. Add anyway\?/.test(r.body.error || ''),
      r.status + ' ' + J(r.body));
    let list = (await req('k', 'GET', '/api/staff/student/' + SID)).body.shortlist || [];
    ok('item 4b: …and it is not on the list', !list.some(x => String(x.id) === String(closedRow.id)), J(list.map(x => x.id)));
    r = await req('k', 'POST', '/api/staff/student/' + SID + '/shortlist', { id: closedRow.id, force: true });
    ok('item 4b: with force it goes on', r.ok && r.body.closed === true, r.status + ' ' + J(r.body).slice(0, 120));
    let msgs = (await req('s', 'GET', '/api/state')).body.msgs || [];
    const told = msgs.map(m => m.t || m.body || m.text || '').find(t => /I have added .*to your list/.test(t));
    ok('item 4b: the student is told, with "next intake is not announced yet; your counsellor will confirm"',
      !!told && /Its next intake is not announced yet; your counsellor will confirm\./.test(told), told);
    r = await req('k', 'POST', '/api/staff/student/' + SID + '/shortlist', { id: openRow.id });
    ok('item 4b: an open programme is added without a warning', r.ok && r.body.closed === false, r.status + ' ' + J(r.body).slice(0, 120));
    msgs = (await req('s', 'GET', '/api/state')).body.msgs || [];
    const told2 = msgs.map(m => m.t || m.body || m.text || '').filter(t => /I have added .*to your list/.test(t)).pop();
    ok('item 4b: …and that message says nothing about an unannounced intake', !!told2 && !/not announced/.test(told2), told2);
  }
  /* The screen's wording is in fitpanel.js. */
  const fp = (await req('k', 'GET', '/fitpanel.js')).buf.toString('utf8');
  ok('item 4 screen: the fit panel asks "Add anyway?" and re-sends with force', /err\.closed/.test(fp) && /force: true/.test(fp));
  ok('item 4c screen: the fit panel shows "Tell us more first — set at least the level and field" and no longer defaults the level to Master\'s',
    /Tell us more first/.test(fp) && /\['', 'Not set'\]/.test(fp) && /d\.needs/.test(fp));

  /* ================================================ item 5, on the server */
  const dirUp = path.join(DATA, 'uploads', String(SID));
  fs.mkdirSync(dirUp, { recursive: true });
  fs.writeFileSync(path.join(dirUp, 'cv-legacy.html'), '<html>old</html>');
  { const d = DB(); d.prepare("INSERT INTO documents (student_id, doc_key, filename, stored_name, bytes, status, uploaded_at, uploaded_by) VALUES (?, 'cv', 'QA Fake Script.html', 'cv-legacy.html', 31, 'wait', ?, 'student')").run(SID, new Date(Date.now() - 864e5).toISOString()); d.close(); }
  const cvUp = await upload('s', '/api/documents', { key: 'cv' }, 'QA Academic CV.pdf', pdf('CVPDF'));
  ok('item 5 setup: an old .html and a real PDF sit in the CV slot', cvUp.status === 200, cvUp.status + ' ' + J(cvUp.body).slice(0, 120));
  let rec = (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  let cv = (rec.docs || []).filter(d => d.key === 'cv');
  const cvHtml = cv.find(d => /\.html$/.test(d.file)), cvPdf = cv.find(d => /\.pdf$/.test(d.file));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvPdf.id + '/verdict', { status: 'ok' });
  ok('item 5: Accept on the PDF alone accepts the document', r.ok && r.body.status === 'ok', r.status + ' ' + J(r.body).slice(0, 120));
  cv = (r.body.docs || []).filter(d => d.key === 'cv');
  const h = cv.find(d => d.id === cvHtml.id), p = cv.find(d => d.id === cvPdf.id);
  ok('item 5: the PDF is the "Verified copy"', p && p.state === 'ok' && p.stateSaid === 'Verified copy', J(p));
  ok('item 5: the .html beside it is NOT verified — "Not accepted — not a PDF, photo or Word file", whatever the slot\'s status',
    h && h.state === 'bad' && /^Not accepted — not a PDF, photo or Word file/.test(h.stateSaid) && h.verdict !== 'ok', J(h));
  let stt = (await req('s', 'GET', '/api/state')).body;
  const sfiles = (((stt.docs || {}).cv || {}).files) || [];
  ok('item 5: the student\'s own screen data says the same per file',
    sfiles.some(f => f.id === cvPdf.id && f.state === 'ok') && sfiles.some(f => f.id === cvHtml.id && f.state === 'bad'), J(sfiles));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvHtml.id + '/verdict', { status: 'ok' });
  ok('item 5: Accept on the .html is refused (422)', r.status === 422, r.status);
  r = await req('s', 'DELETE', '/api/documents/file/' + cvHtml.id);
  ok('item 5: the student can remove the bad file even though the document is accepted', r.ok, r.status + ' ' + J(r.body).slice(0, 120));

  /* A tiny PDF and a "PDF" that holds HTML, both planted as if uploaded before the checks. */
  fs.writeFileSync(path.join(dirUp, 'tiny.pdf'), '%PDF-1.4\n%%EOF');
  fs.writeFileSync(path.join(dirUp, 'page.pdf'), '<!DOCTYPE html><html><body>' + 'x'.repeat(3000) + '</body></html>');
  { const d = DB();
    const ins = d.prepare("INSERT INTO documents (student_id, doc_key, filename, stored_name, bytes, status, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, 'wait', ?, 'student')");
    ins.run(SID, 'provis', 'tiny.pdf', 'tiny.pdf', 14, new Date().toISOString());
    ins.run(SID, 'provis', 'page.pdf', 'page.pdf', 3050, new Date().toISOString());
    d.close(); }
  rec = (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  const pv = (rec.docs || []).filter(d => d.key === 'provis');
  const tiny = pv.find(d => d.file === 'tiny.pdf'), page = pv.find(d => d.file === 'page.pdf');
  ok('item 5: a tiny PDF already reads as not accepted in the list (size, no disk read)', tiny && tiny.state === 'bad', J(tiny));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/provis/file/' + page.id + '/verdict', { status: 'ok' });
  ok('item 5: Accept on a "PDF" whose bytes are HTML is refused (422) and the file is marked bad',
    r.status === 422 && /text or HTML/.test(r.body.why || '') && ((await req('k', 'GET', '/api/staff/student/' + SID + '/documents')).body.docs || []).some(d => d.id === page.id && d.verdict === 'bad' && d.state === 'bad'),
    r.status + ' ' + J(r.body).slice(0, 200));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/provis/file/' + tiny.id + '/verdict', { status: 'ok' });
  ok('item 5: Accept on the tiny PDF is refused (422)', r.status === 422 && /small/.test(r.body.why || ''), r.status + ' ' + J(r.body).slice(0, 160));
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/provis', { status: 'ok' });
  ok('item 5: whole-document Accept is refused while any file in the slot fails', r.status === 422, r.status);
  { const d = DB(); const n = d.prepare("SELECT COUNT(*) AS n FROM audit WHERE what LIKE '%document file%' AND detail LIKE ?").get('%QA Academic CV.pdf%'); d.close();
    ok('item 5: the audit log carries the verdict change', n && n.n >= 1, J(n)); }

  /* =============================================== item 7: tiles and leads */
  const ov0 = (await req('a', 'GET', '/api/staff/overview')).body;
  /* A second student with a waiting document, then closed. */
  const email2 = 'r175x' + S + '@example.com';
  await req('x', 'POST', '/api/auth/signup', { name: 'Round175 Closing ' + S, email: email2, phone: '97766' + S.slice(-5), password: 'a-real-password-' + S, terms: true });
  const XID = ((await req('a', 'GET', '/api/staff/students')).body.students.find(x => x.email === email2) || {}).id;
  await upload('x', '/api/documents', { key: 'passport' }, 'passport.pdf', pdf('PASS'));
  const ov1 = (await req('a', 'GET', '/api/staff/overview')).body;
  ok('item 7 setup: a new unassigned student with a document to review counts in the tiles',
    ov1.students === ov0.students + 1 && ov1.unassigned === ov0.unassigned + 1 && ov1.docsWaiting === ov0.docsWaiting + 1, J([ov0, ov1].map(o => [o.students, o.unassigned, o.docsWaiting])));
  r = await req('a', 'PUT', '/api/staff/student/' + XID + '/status', { status: 'left', note: 'round 175' });
  ok('item 7 setup: the file is closed', r.ok, r.status);
  const ov2 = (await req('a', 'GET', '/api/staff/overview')).body;
  ok('item 7: Students, Unassigned and Docs to review count active files only once it is closed',
    ov2.students === ov0.students && ov2.unassigned === ov0.unassigned && ov2.docsWaiting === ov0.docsWaiting, J([ov0, ov2].map(o => [o.students, o.unassigned, o.docsWaiting])));
  ok('item 7: the closed ones are said beside the numbers (+N closed)',
    ov2.studentsClosed === (ov1.studentsClosed || 0) + 1 && ov2.unassignedClosed === (ov1.unassignedClosed || 0) + 1 && ov2.docsWaitingClosed === (ov1.docsWaitingClosed || 0) + 1,
    J([ov2.studentsClosed, ov2.unassignedClosed, ov2.docsWaitingClosed]));
  const adminHtml = (await req('a', 'GET', '/admin.html')).buf.toString('utf8');
  ok('item 7 screen: the Organisation tiles carry the "+N closed" sub-line', /studentsClosed/.test(adminHtml) && /on closed files/.test(adminHtml));

  /* Internal enquiries: the counsellor's own phone, three days old. */
  const g = (data) => fetch(BASE + '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.175.200.' + (ipn++) }, body: JSON.stringify(Object.assign({ consent: 'yes' }, data)) }).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }));
  const e1 = await g({ name: 'Office Test ' + S, phone: kPhone, email: 'office-test-' + S + '@example.com' });
  const e2 = await g({ name: 'Real Person ' + S, phone: '96655' + S.slice(-5), email: 'real-person-' + S + '@example.com' });
  ok('item 7 setup: two enquiries land', e1.status === 200 && e2.status === 200, e1.status + '/' + e2.status);
  { const d = DB(); d.prepare("UPDATE enquiries SET created_at = ? WHERE name IN (?, ?)").run(new Date(Date.now() - 3 * 864e5).toISOString(), 'Office Test ' + S, 'Real Person ' + S); d.close(); }
  const book = (await req('a', 'GET', '/api/staff/leads')).body;
  const lInt = (book.leads || []).find(l => l.name === 'Office Test ' + S), lReal = (book.leads || []).find(l => l.name === 'Real Person ' + S);
  ok('item 7: the enquiry from a staff member\'s number is in the book, marked internal', lInt && lInt.internal === true, J(lInt));
  ok('item 7: a stranger\'s enquiry is not', lReal && lReal.internal === false, J(lReal));
  ok('item 7: the book\'s summary counts it under internal and not under cold', book.summary.internal >= 1 && book.summary.cold >= 1, J(book.summary));
  const al = (await req('a', 'GET', '/api/staff/alerts')).body.alerts || [];
  const coldFor = id => al.filter(a => a.kind === 'cold' && (Number((a.subject || {}).leadId) === Number(id) || ((a.subject || {}).leadIds || []).map(Number).includes(Number(id))));
  ok('item 7: no cold-lead alert for the internal enquiry', coldFor(lInt && lInt.id).length === 0, J(coldFor(lInt && lInt.id).map(a => a.title)));
  ok('item 7: the stranger\'s enquiry still raises one', coldFor(lReal && lReal.id).length === 1, J(al.filter(a => a.kind === 'cold').map(a => a.title).slice(0, 5)));
  const ov3 = (await req('a', 'GET', '/api/staff/overview')).body;
  ok('item 7: the admin\'s Enquiries number is the leads book\'s total', ov3.enquiries === book.summary.total && ov3.enquiries === (book.leads || []).length, J([ov3.enquiries, book.summary.total, (book.leads || []).length]));
  ok('item 7: …with the internal count beside it', ov3.enquiriesInternal === book.summary.internal, J([ov3.enquiriesInternal, book.summary.internal]));
  const leadsHtml = (await req('a', 'GET', '/leads.html')).buf.toString('utf8');
  ok('item 7 screen: the leads book draws an "Internal" chip', /l\.internal/.test(leadsHtml) && />Internal</.test(leadsHtml));

  done();
})().catch(e => { console.error(e); fail++; done(); });
