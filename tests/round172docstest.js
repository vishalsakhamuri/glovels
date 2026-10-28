/*
 * Round 172 — documents, leads, assignment and closed partner files.
 *
 *   N17-02  (Coverage & Flow, 16 Oct) The counsellor's Documents list is one
 *           block per document; every file has its own address
 *           (/document/<key>/file/<fileId>, and the student's equivalent) that
 *           serves THAT file; Accept / Query per file (accepting a file = the
 *           document accepted with that file as the verified copy); an older
 *           refused file does not block accepting a valid newer one; Remove
 *           (kept on record, logged) and Replace; the list refreshes when the
 *           student uploads (live event + 20 s poll); the student cannot remove
 *           the accepted copy (STU-05).
 *   Item 7  (Testing 15 Oct) Counsellors cannot delete leads (403); an
 *           administrator's delete archives; Archived filter + Restore; alerts
 *           skip archived leads; "Delete for good" only on an archived lead.
 *   Item 10 New students are never auto-assigned to a closed or test
 *           counsellor (lightestCounsellor = active counsellors only); a file
 *           held by one reads as Unassigned and raises the unassigned alert.
 *   Item 13 A partner's closed file: Documents uploads disabled with a note,
 *           and the server refuses the upload (409).
 *
 * Port 8113 by default:  cd tests && bash srv.sh 8113 && node round172docstest.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const BASE = process.env.BASE || 'http://localhost:8113';
const PORT = new URL(BASE).port;
const DATA = process.env.DATA_DIR || '/tmp/db-' + PORT;
const DBFILE = path.join(DATA, 'glovels.db');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };
const J = x => JSON.stringify(x);
function done() { console.log('round172docstest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.172.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
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
  ips[who] = ips[who] || ('10.172.' + (ipn++) + '.9');
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- unit: lightestCounsellor skips closed and test accounts ---- */
(() => {
  const STORE = require(path.join(__dirname, '..', 'server', 'store.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r172-'));
  const db = STORE.open(dir);
  const mk = (email, name, role) => db.createStudent(email, name, '', 'h', 's', role);
  const qwe = mk('qwe@glovels.com', 'qwe', 'counsellor');
  const left = mk('gone@glovels.com', 'Gone Person', 'counsellor');
  const real = mk('real@glovels.com', 'Real Counsellor', 'counsellor');
  try { db.setStudentStatus(left.id, 'left'); } catch (e) { /* older signature */ }
  const busy = mk('s1@x.example', 'Student One', 'student');
  db.assignCounsellor(busy.id, real.id);
  const pick = db.lightestCounsellor();
  ok('Item 10 unit: the round robin never picks the test account "qwe" or a closed one, even when they are lighter',
    pick && Number(pick.id) === Number(real.id), pick ? pick.name : 'nobody');
  const st = mk('s2@x.example', 'Student Two', 'student');
  db.assignCounsellor(st.id, qwe.id);
  ok('Item 10 unit: a student held by a test account has no live counsellor (reads as unassigned)',
    db.liveCounsellorOf(db.studentById(st.id)) === null);
  ok('Item 10 unit: a student held by a real active counsellor keeps them',
    Number((db.liveCounsellorOf(db.studentById(busy.id)) || {}).id) === Number(real.id));
  try { db.setStudentStatus(real.id, 'left'); } catch (e) {}
  ok('Item 10 unit: with no active counsellor left, nobody is picked (the student stays Unassigned)',
    db.lightestCounsellor() === null, J(db.lightestCounsellor()));
  try { db.close && db.close(); } catch (e) {}
})();

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();

  /* ---------------------------------------------------------------- setup */
  await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  await req('k', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
  const cs = (await req('a', 'GET', '/api/staff/counsellors')).body.counsellors || [];
  const kavya = cs.find(c => c.email === 'kavya@glovels.com');
  ok('setup: the seeded counsellor is on the active list', !!kavya, J(cs.map(c => c.name)));

  const email = 'r172s' + S + '@example.com';
  let r = await req('s', 'POST', '/api/auth/signup', { name: 'Docs Student ' + S, email, phone: '98765' + S.slice(-5), password: 'a-real-password-' + S, terms: true });
  ok('setup: a student signs up', r.ok, r.status + ' ' + J(r.body).slice(0, 120));
  const people = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const SID = (people.find(x => x.email === email) || {}).id;
  r = await req('a', 'PUT', '/api/staff/student/' + SID + '/counsellor', { counsellorId: kavya && kavya.id });
  ok('setup: assigned to the seeded counsellor', r.ok, r.status);

  /* ===================================================== N17-02 documents */
  const u1 = await upload('s', '/api/documents', { key: 'provis' }, 'QA R8 Provisional Cert.pdf', pdf('FIRST-FILE'));
  const u2 = await upload('s', '/api/documents', { key: 'provis' }, 'QA Provisional rescan.pdf', pdf('SECOND-FILE'));
  ok('N17-02: the student sends a document twice (the rescan flow) — both kept', u1.status === 200 && u2.status === 200, u1.status + '/' + u2.status);
  let rec = (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  let rows = (rec.docs || []).filter(d => d.key === 'provis');
  ok('N17-02: the counsellor\'s list carries each file with its own id and the document\'s name',
    rows.length === 2 && rows[0].id !== rows[1].id && rows.every(d => d.name && d.verdict === ''), J(rows));
  const [f1, f2] = rows;
  const g1 = await req('k', 'GET', '/api/staff/student/' + SID + '/document/provis/file/' + f1.id);
  const g2 = await req('k', 'GET', '/api/staff/student/' + SID + '/document/provis/file/' + f2.id);
  ok('N17-02: /document/<key>/file/<id> serves THAT file — the older one opens too',
    g1.status === 200 && g1.buf.includes('FIRST-FILE') && g2.status === 200 && g2.buf.includes('SECOND-FILE'),
    g1.status + ' ' + g2.status);
  const gx = await req('k', 'GET', '/api/staff/student/' + SID + '/document/passport/file/' + f1.id);
  ok('N17-02: a file id under the wrong document is a 404', gx.status === 404, gx.status);
  const gs = await req('s', 'GET', '/api/documents/provis/file/' + f1.id);
  ok('N17-02: the student\'s equivalent (/api/documents/<key>/file/<id>) serves that file', gs.status === 200 && gs.buf.includes('FIRST-FILE'), gs.status);
  const gOther = await req('k', 'GET', '/api/staff/student/' + SID + '/document/provis/file/999999');
  ok('N17-02: an id that is not theirs finds nothing', gOther.status === 404, gOther.status);
  const gStu = await req('s', 'GET', '/api/staff/student/' + SID + '/document/provis/file/' + f1.id);
  ok('N17-02: the staff route is closed to a student', gStu.status === 403 || gStu.status === 401, gStu.status);

  /* Accept the OLDER file. */
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/provis/file/' + f1.id + '/verdict', { status: 'ok' });
  rows = (r.body.docs || []).filter(d => d.key === 'provis');
  ok('N17-02: accepting the older file accepts the document with THAT file as the verified copy',
    r.ok && r.body.status === 'ok' && rows.find(d => d.id === f1.id).verdict === 'ok' && rows.find(d => d.id === f2.id).verdict === '',
    r.status + ' ' + J(rows));
  let stt = (await req('s', 'GET', '/api/state')).body;
  ok('N17-02: the student\'s screen carries the verdict per file',
    ((stt.docs || {}).provis || {}).status === 'ok' && (((stt.docs || {}).provis || {}).files || []).some(f => f.id === f1.id && f.verdict === 'ok'),
    J((stt.docs || {}).provis));
  /* A third file puts the slot back in review — the accepted copy stays theirs-not-to-delete. */
  const u3 = await upload('s', '/api/documents', { key: 'provis' }, 'third.pdf', pdf('THIRD-FILE'));
  stt = (await req('s', 'GET', '/api/state')).body;
  const f3 = (((stt.docs || {}).provis || {}).files || []).find(f => f.file === 'third.pdf');
  /* Patch 177 (item 4): each file carries its own state — the new file is
     "In review" beside the verified copy, and the document keeps its
     accepted status (a slot counts once, by its verified copy). */
  ok('N17-02 (177): a new file joins In review while the document keeps its verified copy',
    u3.status === 200 && stt.docs.provis.status === 'ok' && f3 && f3.state === 'wait' && f3.status === 'wait',
    J(stt.docs && stt.docs.provis && { status: stt.docs.provis.status, f3 }));
  const delAcc = await req('s', 'DELETE', '/api/documents/file/' + f1.id);
  ok('STU-05 kept: the student cannot remove the accepted copy, even while the document is in review (409)',
    delAcc.status === 409 && delAcc.body.accepted, delAcc.status + ' ' + J(delAcc.body));
  const clr = await req('s', 'DELETE', '/api/documents/provis');
  ok('STU-05 kept: nor clear the document holding it (409)', clr.status === 409, clr.status);
  const rep = await upload('s', '/api/documents', { key: 'provis', replace: 'yes' }, 'fourth.pdf', pdf('FOURTH'));
  stt = (await req('s', 'GET', '/api/state')).body;
  ok('STU-05 kept: "replace" does not wipe the accepted copy — the new file joins',
    rep.status === 200 && (stt.docs.provis.files || []).some(f => f.id === f1.id), J((stt.docs.provis.files || []).map(f => f.file)));
  const f4 = (stt.docs.provis.files || []).find(f => f.file === 'fourth.pdf');
  const delNew = await req('s', 'DELETE', '/api/documents/file/' + (f4 && f4.id));
  ok('N17-02: their own unreviewed newer file can still be taken off', delNew.status === 200, delNew.status + ' ' + J(delNew.body).slice(0, 120));

  /* Query a newer file while another file is the verified copy. */
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/provis/file/' + f2.id + '/verdict', { status: 'rescan' });
  ok('N17-02: querying a file when another is the verified copy does not send the document back',
    r.ok && r.body.verdict === 'rescan' && r.body.status !== 'rescan', J({ s: r.status, st: r.body.status, v: r.body.verdict }));

  /* Query the only file of a document: it goes to "Waiting for a scan", the student is told which file. */
  await upload('s', '/api/documents', { key: 'passport' }, 'passport-blurred.pdf', pdf('PASS'));
  rec = (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  const pp = (rec.docs || []).find(d => d.key === 'passport');
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/passport/file/' + pp.id + '/verdict', { status: 'rescan', note: 'The corner is cut off.' });
  const msgs = (await req('s', 'GET', '/api/state')).body.msgs || [];
  const told = JSON.stringify(msgs).includes('passport-blurred.pdf');
  ok('N17-02: querying the only file sends the document to "Waiting for a scan" and names the file to the student',
    r.ok && r.body.status === 'rescan' && told, r.status + ' ' + r.body.status + ' told=' + told);

  /* The CV case: an old .html (from before the type rules) and a valid new PDF. */
  const dirUp = path.join(DATA, 'uploads', String(SID));
  fs.mkdirSync(dirUp, { recursive: true });
  fs.writeFileSync(path.join(dirUp, 'cv-legacy.html'), '<html>old</html>');
  { const d = DB(); d.prepare("INSERT INTO documents (student_id, doc_key, filename, stored_name, bytes, status, uploaded_at, uploaded_by) VALUES (?, 'cv', 'QA Fake Script.html', 'cv-legacy.html', 16, 'wait', ?, 'student')").run(SID, new Date(Date.now() - 864e5).toISOString()); d.close(); }
  const cvUp = await upload('k', '/api/staff/student/' + SID + '/document/cv/file', {}, 'CV final.pdf', pdf('CVPDF'));
  ok('N17-02 setup: the counsellor puts a valid CV next to the old .html', cvUp.status === 200, cvUp.status + ' ' + J(cvUp.body));
  rec = (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  const cvRows = (rec.docs || []).filter(d => d.key === 'cv');
  const cvHtml = cvRows.find(d => /\.html$/.test(d.file)), cvPdf = cvRows.find(d => /\.pdf$/.test(d.file));
  const slotAcc = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv', { status: 'ok' });
  ok('N17-02: accepting the WHOLE document is still refused while a refused file is in it (old rule kept)', slotAcc.status === 422, slotAcc.status);
  r = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvPdf.id + '/verdict', { status: 'ok' });
  ok('N17-02: …but the valid newer PDF can be accepted on its own — the old .html no longer blocks it',
    r.ok && r.body.status === 'ok', r.status + ' ' + J(r.body).slice(0, 160));
  const accHtml = await req('k', 'POST', '/api/staff/student/' + SID + '/document/cv/file/' + cvHtml.id + '/verdict', { status: 'ok' });
  ok('N17-02: the .html itself still cannot be accepted', accHtml.status === 422, accHtml.status);
  const rm = await req('k', 'DELETE', '/api/staff/student/' + SID + '/document/cv/file/' + cvHtml.id);
  ok('N17-02: the counsellor can remove the old file', rm.ok && !(rm.body.docs || []).some(d => d.id === cvHtml.id), rm.status);
  { const d = DB(); const row = d.prepare('SELECT doc_key FROM documents WHERE id = ?').get(cvHtml.id);
    const logged = d.prepare("SELECT COUNT(*) AS n FROM audit WHERE what = 'removed a document file' AND detail LIKE ?").get('%QA Fake Script.html%');
    d.close();
    ok('N17-02: removal moves it out of the slot, keeps the row and the bytes (not a hard delete)',
      row && row.doc_key === 'removed:cv' && fs.existsSync(path.join(dirUp, 'cv-legacy.html')), J(row));
    ok('N17-02: …and writes an audit log entry', logged && logged.n >= 1, J(logged)); }
  const stuSees = await req('s', 'GET', '/api/documents/file/' + cvHtml.id);
  const stuClr = await req('s', 'DELETE', '/api/documents/' + encodeURIComponent('removed:cv'));
  ok('N17-02: the student can neither open nor wipe the removed copy', stuSees.status === 404 && stuClr.status === 404, stuSees.status + '/' + stuClr.status);
  rec = (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  ok('N17-02: removing a file that was not the accepted one leaves the document accepted',
    ((rec.docs || []).find(d => d.key === 'cv') || {}).status === 'ok', J((rec.docs || []).filter(d => d.key === 'cv')));

  /* Replace one file. */
  const before = (rec.docs || []).filter(d => d.key === 'provis');
  const victim = before.find(d => d.id === f2.id);
  const repl = await upload('k', '/api/staff/student/' + SID + '/document/provis/file', { replaces: String(victim.id) }, 'Provisional (clean).pdf', pdf('REPLACED'));
  rec = (await req('k', 'GET', '/api/staff/student/' + SID)).body;
  const after = (rec.docs || []).filter(d => d.key === 'provis');
  ok('N17-02: Replace puts the new file in and takes the old one out (kept on record)',
    repl.status === 200 && after.some(d => d.file === 'Provisional (clean).pdf') && !after.some(d => d.id === victim.id),
    J(after.map(d => d.file)));

  /* Polling endpoint. */
  const p1 = (await req('k', 'GET', '/api/staff/student/' + SID + '/documents')).body;
  await upload('s', '/api/documents', { key: 'english' }, 'ielts.pdf', pdf('IELTS'));
  const p2 = (await req('k', 'GET', '/api/staff/student/' + SID + '/documents')).body;
  ok('N17-02: the Documents list has its own light endpoint whose signature moves when the student uploads',
    p1.sig && p2.sig && p1.sig !== p2.sig && (p2.docs || []).some(d => d.key === 'english'), (p1.sig || '').slice(0, 40));

  /* ---- on the screen: the counsellor's file, opened from Admin ---- */
  const errs = [];
  const admin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const page = await admin.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/counsellor.html?student=' + SID, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#docs', { timeout: 15000 }).catch(() => {});
  await page.click('.tab[data-t="file"]').catch(() => {});
  await page.waitForTimeout(500);
  const ui = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('#docs .docgroup')];
    return groups.map(g => ({ key: g.dataset.dockey, name: (g.querySelector('.docname') || {}).textContent,
      links: [...g.querySelectorAll('a.docfilelink')].map(a => a.getAttribute('href')),
      accept: g.querySelectorAll('[data-fverdict="ok"]').length,
      query: g.querySelectorAll('[data-fverdict="rescan"]').length,
      remove: g.querySelectorAll('[data-fremove]').length,
      replace: g.querySelectorAll('input[data-freplace]').length }));
  });
  const gp = ui.find(g => g.key === 'provis') || {};
  ok('N17-02 screen: one block per document, its name as the heading',
    ui.length >= 3 && new Set(ui.map(g => g.key)).size === ui.length && gp.name && /provisional/i.test(gp.name), J(ui.map(g => g.key + ':' + g.name)));
  ok('N17-02 screen: every file in a block links to its own /document/<key>/file/<id>',
    (gp.links || []).length >= 2 && new Set(gp.links).size === gp.links.length && gp.links.every(h => /\/document\/provis\/file\/\d+$/.test(h)), J(gp.links));
  ok('N17-02 screen: Remove and Replace on every file; Accept on the files not yet accepted',
    gp.remove === gp.links.length && gp.replace === gp.links.length && gp.accept >= 1, J(gp));
  /* Accept a file from the screen. */
  const newRow = (await req('k', 'GET', '/api/staff/student/' + SID)).body.docs.find(d => d.key === 'english');
  await page.click('[data-fverdict="ok"][data-fid="' + newRow.id + '"]').catch(e => errs.push('click ' + e.message));
  await page.waitForTimeout(900);
  const eng = (await req('k', 'GET', '/api/staff/student/' + SID)).body.docs.find(d => d.id === newRow.id);
  ok('N17-02 screen: Accept on a row accepts THAT file', eng && eng.verdict === 'ok' && eng.status === 'ok', J(eng));
  /* Live refresh: the student uploads while the counsellor has the file open. */
  const countBefore = await page.$$eval('#docs .docfile', x => x.length);
  await upload('s', '/api/documents', { key: 'aps' }, 'aps-cert.pdf', pdf('APS'));
  let grew = false;
  for (let i = 0; i < 26 && !grew; i++) {
    await page.waitForTimeout(1000);
    grew = (await page.$$eval('#docs .docfile', x => x.length)) > countBefore;
  }
  ok('N17-02 screen: the list refreshes by itself when the student uploads (live, or the 20 s poll)', grew, countBefore);
  ok('N17-02 screen: no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.close();

  /* ---- the student's screen: no Remove on the accepted copy ---- */
  const stuCtx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  await stuCtx.request.post(BASE + '/api/auth/login', { data: { email, password: 'a-real-password-' + S } });
  const sp = await stuCtx.newPage();
  const serrs = [];
  sp.on('pageerror', e => serrs.push(String(e)));
  await sp.goto(BASE + '/documents.html', { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(2500);
  const stuUi = await sp.evaluate(id => ({
    acceptedRemove: document.querySelectorAll('[data-dropfile="' + id + '"]').length,
    acceptedLabel: document.body.innerText.includes('accepted copy') || document.body.innerText.includes('Accepted.'),
  }), f1.id);
  ok('STU-05 screen: the student\'s Documents screen offers no Remove on the accepted copy', stuUi.acceptedRemove === 0, J(stuUi));
  ok('STU-05 screen: no page errors', serrs.length === 0, serrs.slice(0, 2).join(' | '));
  await sp.close();

  /* ========================================================== Item 7 leads */
  const mkLead = async (tag) => {
    const em = 'r172lead-' + tag + S + '@example.com';
    /* Through the public form, so nobody owns it (a lead added by hand is the adder's). */
    await fetch(BASE + '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.114.' + (10 + Math.floor(Math.random() * 200)) },
      body: JSON.stringify({ name: 'R172 Lead ' + tag, phone: '97' + String(Math.floor(1e7 + Math.random() * 8e7)), email: em, destination: 'Germany', consent: 'yes' }) });
    const book = (await req('a', 'GET', '/api/staff/leads')).body.leads || [];
    return book.find(l => l.email === em);
  };
  const L1 = await mkLead('a');
  ok('Item 7 setup: an unowned lead is in the book', L1 && !L1.ownerId, J(L1));
  r = await req('k', 'DELETE', '/api/staff/lead/' + L1.id);
  ok('Item 7: a counsellor\'s DELETE on an unowned lead is refused (403)', r.status === 403, r.status + ' ' + J(r.body));
  r = await req('k', 'GET', '/api/staff/lead/' + L1.id);
  ok('Item 7: …and the lead is still there', r.ok && r.body.lead, r.status);
  r = await req('k', 'POST', '/api/staff/lead/' + L1.id + '/archive', {});
  ok('Item 7: a counsellor cannot archive either (403)', r.status === 403, r.status);
  r = await req('a', 'DELETE', '/api/staff/lead/' + L1.id + '?for=good');
  ok('Item 7: "Delete for good" on a lead that is not archived is refused (409)', r.status === 409, r.status);
  /* Old enough to raise an alert. */
  { const d = DB(); d.prepare('UPDATE enquiries SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 4 * 864e5).toISOString(), L1.id); d.close(); }
  const alertsHave = async () => JSON.stringify(((await req('a', 'GET', '/api/staff/alerts')).body.alerts || [])
    .filter(x => x.subject && Number(x.subject.leadId) === Number(L1.id))).length > 2;
  ok('Item 7 setup: the old untouched lead raises an alert', await alertsHave());
  r = await req('a', 'DELETE', '/api/staff/lead/' + L1.id);
  ok('Item 7: an administrator\'s Delete ARCHIVES (soft — archived_at set)', r.ok && r.body.archived === true, r.status + ' ' + J(r.body));
  { const d = DB(); const row = d.prepare('SELECT archived_at FROM enquiries WHERE id = ?').get(L1.id); d.close();
    ok('Item 7: the row is still in the database with archived_at', row && !!row.archived_at, J(row)); }
  let book = (await req('a', 'GET', '/api/staff/leads')).body;
  ok('Item 7: an archived lead is hidden from the book', !(book.leads || []).some(l => l.id === L1.id) && book.archivedCount >= 1, book.archivedCount);
  const arch = (await req('a', 'GET', '/api/staff/leads?archived=1')).body;
  ok('Item 7: …and listed under the Archived filter', (arch.leads || []).some(l => l.id === L1.id && l.archivedAt), (arch.leads || []).length);
  ok('Item 7: alerts skip an archived lead', !(await alertsHave()));
  r = await req('k', 'GET', '/api/staff/lead/' + L1.id);
  ok('Item 7: a counsellor cannot open an archived lead', r.status === 404, r.status);
  const kb = (await req('k', 'GET', '/api/staff/leads?archived=1')).body;
  ok('Item 7: the Archived filter is the administrator\'s (a counsellor gets the book)', !(kb.leads || []).some(l => l.id === L1.id) && !kb.archivedView, J({ v: kb.archivedView }));
  r = await req('a', 'DELETE', '/api/staff/lead/' + L1.id);
  ok('Item 7: a second Delete without "for good" is refused (409)', r.status === 409, r.status);
  /* A new public enquiry from the archived person is a new lead. */
  await fetch(BASE + '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.172' },
    body: JSON.stringify({ name: 'R172 Lead a', email: L1.email, phone: L1.phone, consent: 'yes' }) });
  book = (await req('a', 'GET', '/api/staff/leads')).body;
  const fresh = (book.leads || []).find(l => l.email === L1.email);
  ok('Item 7: a new enquiry from that person is a new lead, not a note on the archived one', fresh && fresh.id !== L1.id, J(fresh && fresh.id));
  r = await req('a', 'POST', '/api/staff/lead/' + L1.id + '/restore', {});
  book = (await req('a', 'GET', '/api/staff/leads')).body;
  ok('Item 7: Restore brings it back into the book', r.ok && (book.leads || []).some(l => l.id === L1.id && !l.archivedAt), r.status);
  await req('a', 'POST', '/api/staff/lead/' + L1.id + '/archive', {});
  r = await req('a', 'DELETE', '/api/staff/lead/' + L1.id + '?for=good');
  const gone = await req('a', 'GET', '/api/staff/lead/' + L1.id);
  ok('Item 7: "Delete for good" on an archived lead removes it for good', r.ok && r.body.deleted && gone.status === 404, r.status + '/' + gone.status);

  /* ---- on the screen ---- */
  const L2 = await mkLead('b');
  const kctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await kctx.request.post(BASE + '/api/auth/login', { data: { email: 'kavya@glovels.com', password: 'glovels123' } });
  const kp = await kctx.newPage();
  const lerrs = [];
  kp.on('pageerror', e => lerrs.push(String(e)));
  await kp.goto(BASE + '/leads.html', { waitUntil: 'domcontentloaded' });
  await kp.waitForSelector('tr[data-lead="' + L2.id + '"]', { timeout: 15000 }).catch(() => {});
  await kp.click('tr[data-lead="' + L2.id + '"]').catch(e => lerrs.push(e.message));
  await kp.waitForTimeout(900);
  const kHas = await kp.evaluate(() => ({ del: !!document.querySelector('#dDel'), save: !!document.querySelector('#dSave'),
    archivedOpt: !![...document.querySelectorAll('#fStatus option')].find(o => o.value === 'archived') }));
  ok('Item 7 screen: a counsellor sees no Delete/Archive button on an unowned lead', kHas.save && !kHas.del && !kHas.archivedOpt, J(kHas));
  await kp.close();
  const ap = await admin.newPage();
  ap.on('pageerror', e => lerrs.push(String(e)));
  ap.on('dialog', d => d.accept());
  await ap.goto(BASE + '/leads.html', { waitUntil: 'domcontentloaded' });
  await ap.waitForSelector('tr[data-lead="' + L2.id + '"]', { timeout: 15000 }).catch(() => {});
  await ap.click('tr[data-lead="' + L2.id + '"]').catch(e => lerrs.push(e.message));
  await ap.waitForTimeout(900);
  const aBtn = await ap.$eval('#dDel', b => b.textContent.trim()).catch(() => '');
  ok('Item 7 screen: an administrator sees "Archive" instead of Delete', aBtn === 'Archive', aBtn);
  await ap.click('#dDel').catch(() => {});
  await ap.waitForTimeout(1300);
  ok('Item 7 screen: Archive takes it out of the book', !(await ap.$('tr[data-lead="' + L2.id + '"]')), '');
  await ap.selectOption('#fStatus', 'archived').catch(e => lerrs.push(e.message));
  await ap.waitForTimeout(1300);
  const inArch = !!(await ap.$('tr[data-lead="' + L2.id + '"]'));
  ok('Item 7 screen: the "Archived" filter lists it', inArch);
  if (inArch) {
    await ap.click('tr[data-lead="' + L2.id + '"]');
    await ap.waitForTimeout(900);
    const btns = await ap.evaluate(() => ({ restore: !!document.querySelector('#dRestore'), good: (document.querySelector('#dDel') || {}).textContent }));
    ok('Item 7 screen: an archived lead offers Restore and "Delete for good"', btns.restore && /Delete for good/.test(btns.good || ''), J(btns));
    await ap.click('#dRestore').catch(() => {});
    await ap.waitForTimeout(1200);
    const back = ((await req('a', 'GET', '/api/staff/leads')).body.leads || []).some(l => l.id === L2.id);
    ok('Item 7 screen: Restore puts it back in the book', back);
  }
  ok('Item 7 screen: no page errors', lerrs.length === 0, lerrs.slice(0, 2).join(' | '));
  await ap.close();

  /* ======================================================== Item 10 assign */
  r = await req('a', 'POST', '/api/staff/people', { name: 'qwe', email: 'qwe' + S + '@glovels.com', password: 'qwe-' + S + '-a-long-pass', role: 'counsellor' });
  const qweId = (((await req('a', 'GET', '/api/staff/people')).body.people || []).find(p => p.email === 'qwe' + S + '@glovels.com') || {}).id;
  ok('Item 10 setup: a test counsellor account "qwe" (active, nobody on its list)', !!qweId, r.status);
  const bEmail = 'r172buyer' + S + '@example.com';
  await req('b', 'POST', '/api/auth/signup', { name: 'Buyer ' + S, email: bEmail, phone: '98123' + S.slice(-5), password: 'a-real-password-' + S, terms: true });
  r = await req('b', 'POST', '/api/orders', { packageId: 'pkg-roadmap', acceptedTerms: true });
  const studs = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const buyer = studs.find(x => x.email === bEmail) || {};
  ok('Item 10: a paying student is given an ACTIVE counsellor, never the lighter test account',
    buyer.counsellor && Number(buyer.counsellor.id) !== Number(qweId) && Number(buyer.counsellor.id) === Number(kavya.id),
    r.status + ' ' + J(buyer.counsellor));
  /* A file held by the test account (as Sathvik's is on live) reads as Unassigned. */
  const ov0 = (await req('a', 'GET', '/api/staff/overview')).body.unassigned;
  { const d = DB(); d.prepare('UPDATE students SET counsellor_id = ? WHERE id = ?').run(qweId, buyer.id); d.close(); }
  const studs2 = (await req('a', 'GET', '/api/staff/students')).body.students || [];
  const held = studs2.find(x => x.id === buyer.id) || {};
  ok('Item 10: a student held by a test account shows as Unassigned (named in heldBy)',
    held.counsellor === null && held.heldBy && Number(held.heldBy.id) === Number(qweId), J({ c: held.counsellor, h: held.heldBy }));
  const ov1 = (await req('a', 'GET', '/api/staff/overview')).body.unassigned;
  ok('Item 10: …counts in the Unassigned tile', ov1 === ov0 + 1, ov0 + ' → ' + ov1);
  const al = ((await req('a', 'GET', '/api/staff/alerts')).body.alerts || []).some(x => x.kind === 'unassigned' && x.subject && Number(x.subject.studentId) === Number(buyer.id));
  ok('Item 10: …and raises the unassigned alert', al);
  { const d = DB(); const row = d.prepare('SELECT counsellor_id FROM students WHERE id = ?').get(buyer.id); d.close();
    ok('Item 10: nothing is silently reassigned — the row still names the old account', Number(row.counsellor_id) === Number(qweId), J(row)); }
  /* A closed real counsellor is the same. */
  r = await req('a', 'POST', '/api/staff/people', { name: 'Closing Counsellor ' + S, email: 'closing' + S + '@glovels.com', password: 'closing-' + S + '-long-pass', role: 'counsellor' });
  const closingId = (((await req('a', 'GET', '/api/staff/people')).body.people || []).find(p => p.email === 'closing' + S + '@glovels.com') || {}).id;
  { const d = DB(); d.prepare("UPDATE students SET status = 'left' WHERE id = ?").run(closingId); d.prepare('UPDATE students SET counsellor_id = ? WHERE id = ?').run(closingId, SID); d.close(); }
  const row2 = ((await req('a', 'GET', '/api/staff/students')).body.students || []).find(x => x.id === SID) || {};
  ok('Item 10: a student held by a CLOSED account shows as Unassigned too', row2.counsellor === null && row2.heldBy, J({ c: row2.counsellor, h: row2.heldBy }));
  { const d = DB(); d.prepare('UPDATE students SET counsellor_id = ? WHERE id = ?').run(kavya.id, SID); d.close(); }
  /* Lead owner carry-over: an admin converting a lead owned by "qwe" leaves the student unassigned. */
  const L3 = await mkLead('c');
  { const d = DB(); d.prepare('UPDATE enquiries SET owner_id = ? WHERE id = ?').run(qweId, L3.id); d.close(); }
  r = await req('a', 'POST', '/api/staff/lead/' + L3.id + '/convert', {});
  const conv = ((await req('a', 'GET', '/api/staff/students')).body.students || []).find(x => x.email === L3.email);
  { const d = DB(); const row = conv ? d.prepare('SELECT counsellor_id FROM students WHERE id = ?').get(conv.id) : null; d.close();
    ok('Item 10: converting a lead owned by a test account does not carry the owner over (Unassigned)',
      r.ok && conv && !(row && row.counsellor_id), r.status + ' ' + J(row) + ' ' + J(r.body).slice(0, 120)); }

  /* ====================================================== Item 13 partner */
  const pEmail = 'r172partner' + S + '@agency.example';
  await req('a', 'POST', '/api/staff/people', { name: 'R172 Agency', email: pEmail, password: 'agency-' + S + '-long-pass', role: 'partner' });
  { const d = DB(); d.prepare('UPDATE students SET must_change = 0 WHERE email = ?').run(pEmail); d.close(); }
  r = await req('p', 'POST', '/api/auth/login', { email: pEmail, password: 'agency-' + S + '-long-pass' });
  ok('Item 13 setup: a partner signs in', r.ok, r.status);
  const stEmail = 'r172pst' + S + '@ex.example';
  await req('p', 'POST', '/api/partner/students', { students: [{ name: 'Partner Student ' + S, email: stEmail, phone: '98700' + S.slice(-5), destination: 'Germany', level: "Master's" }] });
  const pst = ((await req('p', 'GET', '/api/partner/students')).body.students || []).find(x => x.email === stEmail) || {};
  const upOpen = await upload('p', '/api/partner/student/' + pst.id + '/document', { key: 'passport' }, 'pp.pdf', pdf('PARTNER'));
  ok('Item 13: an open file takes an upload', upOpen.status === 200, upOpen.status + ' ' + J(upOpen.body).slice(0, 100));
  r = await req('p', 'PUT', '/api/partner/student/' + pst.id + '/closed', { closed: true });
  ok('Item 13 setup: the agency closes the file', r.ok, r.status);
  const upShut = await upload('p', '/api/partner/student/' + pst.id + '/document', { key: 'degree' }, 'deg.pdf', pdf('SHUT'));
  ok('Item 13: the server refuses an upload on a closed file (409)', upShut.status === 409 && upShut.body.closed, upShut.status + ' ' + J(upShut.body));
  const pctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await pctx.request.post(BASE + '/api/auth/login', { data: { email: pEmail, password: 'agency-' + S + '-long-pass' } });
  const pp2 = await pctx.newPage();
  const perrs = [];
  pp2.on('pageerror', e => perrs.push(String(e)));
  await pp2.goto(BASE + '/partner.html', { waitUntil: 'domcontentloaded' });
  await pp2.waitForTimeout(2500);
  await pp2.click('[data-tile="closed"]').catch(() => {});
  await pp2.waitForTimeout(500);
  await pp2.click('[data-open="' + pst.id + '"]').catch(e => perrs.push('open ' + e.message));
  await pp2.waitForTimeout(1200);
  await pp2.click('.ptab[data-p="docs"]').catch(() => {});
  await pp2.waitForTimeout(400);
  const pui = await pp2.evaluate(() => ({
    live: document.querySelectorAll('#p-docs input[type=file]:not([disabled]), #p-visa input[type=file]:not([disabled])').length,
    all: document.querySelectorAll('#p-docs input[type=file], #p-visa input[type=file]').length,
    note: !!document.querySelector('#p-docs #docsClosed') && /This file is closed/.test(document.querySelector('#p-docs').innerText),
  }));
  ok('Item 13 screen: every Upload on a closed file is disabled', pui.all > 0 && pui.live === 0, J(pui));
  ok('Item 13 screen: with a "This file is closed" note on Documents', pui.note, J(pui));
  r = await req('p', 'PUT', '/api/partner/student/' + pst.id + '/closed', { closed: false });
  const upAgain = await upload('p', '/api/partner/student/' + pst.id + '/document', { key: 'degree' }, 'deg.pdf', pdf('OPEN'));
  ok('Item 13: reopened, it takes uploads again', upAgain.status === 200, upAgain.status);
  ok('Item 13 screen: no page errors', perrs.length === 0, perrs.slice(0, 2).join(' | '));

  await browser.close();
  done();
})().catch(e => { console.error(e); fail++; done(); });
