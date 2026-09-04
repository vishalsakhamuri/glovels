/**
 * A document slot holds a SET.
 *
 * Four items from Student View Changes, and the one design decision underneath
 * all of them.
 *
 *   "ADD MULTI DOC UPLOAD OPTION for English tests, semester mark sheets,
 *   GRE/GMAT etc." Eight semester marksheets are eight files. The slot held one
 *   and a second upload deleted the first, so a student had to merge them into
 *   one PDF before they could send them — a job with software they do not have.
 *
 *   MANY FILES, ONE STATUS. That was chosen deliberately over verifying each
 *   file: verify them separately and a slot becomes PARTLY verified, and every
 *   gate that reads "documents verified" — the visa appointment, the university
 *   application — then has to decide what partly means. The counsellor checks
 *   the set, because the set is the document.
 *
 *   And the consequence that has to hold: a NEW file puts the whole slot back
 *   in review. Adding a ninth marksheet to a set somebody accepted last week
 *   cannot leave it reading "accepted", or accepted means "accepted as it was".
 *
 *   THREE STATUSES. "In review, upload a scanned copy, or accepted." The middle
 *   one is the one that was missing and the one that does the work: a photo of
 *   a certificate at an angle is not rejected and it is not accepted, and with
 *   two states a counsellor had to pick one and say the rest in a message the
 *   student might never open.
 *
 *   A COUNSELLOR CAN UPLOAD THE STUDENT'S OWN DOCUMENTS. "Sometimes students
 *   share the docs on email or WhatsApp and ask us to use them." That route
 *   used to accept the three things Glovels writes and refuse everything else.
 *   It takes any real slot now — and treats the two errands differently, which
 *   is the half worth testing: our draft replaces and lands accepted, their
 *   marksheet joins the set and still has to be read by somebody.
 *
 *   THE ENROLMENT DOCUMENTS. "Enrolment docs are missing in this succession.
 *   Tuition fee or semester fee invoice. Document option for enrolment
 *   certificate." The file ended at the plane ticket.
 *
 * And a build-time check, because this patch created a THIRD list that has to
 * agree with the screens — after the stages and the outcomes, which agreed
 * until they did not.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const pdf = n => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n, 0x41)]);

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1500, height: 1050 } };

  const stu = await browser.newContext(vp);
  const email = 'set' + S + '@example.com';
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Doc Set', email, phone: '9876500096',
      password: 'a-real-password-' + S } });
  const send = (key, name, extra) => stu.request.post(BASE + '/api/documents',
    { multipart: Object.assign({ key,
      file: { name, mimeType: 'application/pdf', buffer: pdf(600) } }, extra || {}) });
  const state = async () => (await (await stu.request.get(BASE + '/api/state')).json());

  /* ================================================= 1. a slot holds a set */
  for (const n of ['sem1.pdf', 'sem2.pdf', 'sem3.pdf']) {
    const r = await send('degree', n);
    ok(r.ok(), n + ' uploads — ' + r.status());
  }
  let st = await state();
  let slot = (st.docs || {}).degree || {};
  ok((slot.files || []).length === 3,
    'all three are in the slot, not just the last — ' + (slot.files || []).length);
  ok((slot.files || []).map(f => f.file).join(',') === 'sem1.pdf,sem2.pdf,sem3.pdf',
    'oldest first, which is the order a set was sent in — '
    + (slot.files || []).map(f => f.file).join(','));
  ok(slot.status === 'wait', 'and the slot has ONE status — ' + slot.status);
  /* The old shape is untouched, which is what let this ship without rewriting
     the readiness ring, the counsellor's link, the agency's cards and the visa
     checklist all at once. */
  ok(slot.file === 'sem3.pdf', 'the single-file view still answers, with the newest');
  ok(!!slot.size, 'and its size');

  /* Each file comes back on its own. */
  const one = (slot.files || [])[0];
  const got = await stu.request.get(BASE + '/api/documents/file/' + one.id);
  ok(got.ok(), 'each file downloads by its own id — ' + got.status());
  ok((await got.body()).slice(0, 5).toString() === '%PDF-', 'as what was uploaded');

  /* And nobody else's does. */
  const other = await browser.newContext(vp);
  await other.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Not Them', email: 'no' + S + '@example.com', phone: '9876500097',
      password: 'a-real-password-x' + S } });
  const nope = await other.request.get(BASE + '/api/documents/file/' + one.id);
  ok(!nope.ok(),
    'a file id from another student finds nothing — ' + nope.status());

  /* ============================== 2. one file out, the rest of the set stays */
  const del = await stu.request.delete(BASE + '/api/documents/file/' + one.id);
  ok(del.ok(), 'one file can be removed — ' + del.status());
  st = await state();
  slot = (st.docs || {}).degree || {};
  ok((slot.files || []).length === 2,
    'and the rest of the set is still there — '
    + (slot.files || []).map(f => f.file).join(','));
  ok(!(slot.files || []).some(f => f.id === one.id), 'without the one removed');

  /* The whole slot still goes in one go, for the screens that offer it. */
  const wipe = await stu.request.delete(BASE + '/api/documents/degree');
  ok(wipe.ok(), 'and the whole slot can still be cleared — ' + wipe.status());
  st = await state();
  ok(!(st.docs || {}).degree, 'leaving nothing behind');

  /* ============ 3. replace=yes, for a document that is one document */
  await send('passport', 'passport-old.pdf');
  await send('passport', 'passport-new.pdf', { replace: 'yes' });
  st = await state();
  const pp = (st.docs || {}).passport || {};
  ok((pp.files || []).length === 1,
    'a passport asked to REPLACE holds one file, not two — '
    + (pp.files || []).map(f => f.file).join(','));
  ok(pp.file === 'passport-new.pdf', 'and it is the new one');

  /* ======================= 4. the office, and the three answers */
  const admin = await browser.newContext(vp);
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const people = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const row = (people.students || []).find(x => x.email === email);
  ok(!!row, 'the student is on the office list');
  const SID = row && row.id;

  const setStatus = k => admin.request.post(
    BASE + '/api/staff/student/' + SID + '/document/passport', { data: { status: k } });
  for (const k of ['ok', 'rescan', 'wait']) {
    const r = await setStatus(k);
    ok(r.ok(), 'the office can set "' + k + '" — ' + r.status());
    ok((((await state()).docs || {}).passport || {}).status === k,
      'and it is stored as itself — ' + k);
  }
  /* `rescan` is the whole point of the third one: it is neither of the two
     that existed, and a counsellor forced to choose between them said the real
     answer in a message instead. */
  await setStatus('rescan');
  const docs = await stu.newPage();
  const derrs = [];
  docs.on('pageerror', e => derrs.push(String(e)));
  await docs.goto(BASE + '/documents.html', { waitUntil: 'domcontentloaded' });
  await docs.waitForTimeout(2800);
  const card = (await docs.textContent('[data-id="passport"]')) || '';
  ok(/scan/i.test(card),
    'the card says a scan is wanted — ' + card.replace(/\s+/g, ' ').slice(0, 110));
  ok(/could not read|clearer|good light/i.test(card),
    'and says what to do about it, on the document it is about');
  const anyAccepted = (await docs.textContent('body')) || '';
  ok(/Accepted|In review|Not uploaded/.test(anyAccepted),
    'the three words the counsellors asked for are the ones on the screen');

  /* ============ 5. a new file puts an accepted set back in front of somebody */
  await setStatus('ok');
  ok((((await state()).docs || {}).passport || {}).status === 'ok', 'a slot is accepted');
  await send('passport', 'passport-page-two.pdf');
  ok((((await state()).docs || {}).passport || {}).status === 'wait',
    'and adding a file to it puts the whole slot back in review — otherwise '
    + '"accepted" means "accepted as it was last week"');

  /* ================== 6. the counsellor uploads, two different errands */
  const put = (key, name) => admin.request.post(
    BASE + '/api/staff/student/' + SID + '/document/' + key + '/file',
    { multipart: { file: { name, mimeType: 'application/pdf', buffer: pdf(400) } } });

  const theirs = await put('x', 'class10-from-whatsapp.pdf');
  ok(theirs.ok(),
    'a counsellor can put up a document the student emailed them — ' + theirs.status());
  st = await state();
  ok(((st.docs || {}).x || {}).file === 'class10-from-whatsapp.pdf',
    'it lands on the student\'s own file');
  ok(((st.docs || {}).x || {}).status === 'wait',
    'and is NOT accepted by arriving: uploading a file and reading one are two '
    + 'different acts — ' + ((st.docs || {}).x || {}).status);

  await put('x', 'class10-page-two.pdf');
  st = await state();
  ok(((st.docs || {}).x || {}).files.length === 2,
    'a second one joins the set rather than replacing it — '
    + ((st.docs || {}).x || {}).files.map(f => f.file).join(','));

  await put('sop', 'sop-v1.pdf');
  await put('sop', 'sop-v2.pdf');
  st = await state();
  const sop = (st.docs || {}).sop || {};
  ok((sop.files || []).length === 1,
    'but OUR OWN draft replaces the one before it — a second draft is not a '
    + 'second page — ' + (sop.files || []).map(f => f.file).join(','));
  ok(sop.file === 'sop-v2.pdf', 'and it is the newer draft');
  ok(sop.status === 'ok', 'and it lands accepted, because we wrote it');

  const madeUp = await put('not-a-real-slot', 'nowhere.pdf');
  ok(madeUp.status() === 422,
    'a slot that does not exist is still refused — ' + madeUp.status());

  /* And the counsellor can open any of them. */
  const cdocs = await (await admin.request.get(BASE + '/api/staff/student/' + SID)).json();
  const xrow = (cdocs.docs || []).find(d => d.key === 'x');
  ok(!!xrow, 'the office sees the slot on the record');

  /* ============================= 7. the enrolment documents exist */
  for (const [k, what] of [['fee-invoice', 'the semester fee invoice'],
    ['enrolment', 'the enrolment certificate']]) {
    const r = await send(k, k + '.pdf');
    ok(r.ok(), what + ' has somewhere to go — ' + r.status());
  }
  const visa = await stu.newPage();
  const verrs = [];
  visa.on('pageerror', e => verrs.push(String(e)));
  await visa.goto(BASE + '/visa', { waitUntil: 'domcontentloaded' });
  await visa.waitForTimeout(2800);
  const vtext = (await visa.textContent('body')) || '';
  ok(/enrolment certificate/i.test(vtext),
    'and the enrolment certificate is on the visa screen, where the journey ends');
  ok(/fee invoice/i.test(vtext), 'with the fee invoice beside it');
  ok(verrs.length === 0, 'no page errors on the visa screen — ' + verrs.slice(0, 2).join(' | '));
  ok(derrs.length === 0, 'no page errors on documents — ' + derrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
