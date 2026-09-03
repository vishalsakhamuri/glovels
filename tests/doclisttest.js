/**
 * The document checklist, after the counsellors read it.
 *
 * From Student View Corrections.docx. Seven corrections, and six of them are
 * about HOW a document should arrive rather than which document it is — which
 * is the part a list of nouns cannot say, and the part a student gets wrong and
 * finds out about weeks later when an application stops.
 *
 *   THE SIZE LIMIT THAT DISAGREED WITH ITSELF. The upload screen refused at
 *   20 MB. The server refused at 10. So a student with a 15 MB scan watched the
 *   whole upload finish and was then told it was too big — the friendly check
 *   let through exactly the files the real one rejects, which is worse than
 *   having no friendly check at all. One number now, stated on the screen
 *   BEFORE a file is chosen, and it is the server's.
 *
 *   ONE FILE, NOT EIGHT. Semester marksheets, work experience letters and
 *   certificates each arrive as one file. A set that arrives in eight pieces is
 *   checked as eight documents and one of them always goes missing.
 *
 *   THE CONSOLIDATED GRADE CARD is not the same document as the semester
 *   marksheets, and most universities abroad ask for both. It did not exist.
 *
 *   THE ORIGINAL DEGREE CERTIFICATE, separately from the provisional one, and
 *   both marked "(if available)" — students who have not graduated yet were
 *   chasing a certificate that cannot exist.
 *
 *   AND "(IF AVAILABLE)" IN THE NAME, not only in a chip beside it. "Optional"
 *   reads as "we would still like it".
 *
 * The list lives in one file and is used by five screens. This suite reads it
 * off each of them, because the way this breaks is one screen keeping a name
 * the rest of the product has stopped using.
 */
const { chromium } = require('playwright');
/* A file that IS a PDF, not just named one. The server reads the first bytes
   now — an .html renamed .pdf used to go into any slot — so a fixture made of
   one repeated byte is refused for the wrong reason and this suite stops being
   about the size limit it is here for. */
const asPdf = bytes => Buffer.concat([
  Buffer.from('%PDF-1.4\n'), Buffer.alloc(Math.max(0, bytes - 9), 0x41)]);
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1500, height: 1050 } };

  const email = 'docs' + S + '@example.com';
  const stu = await browser.newContext(vp);
  await stu.request.post(BASE + '/api/auth/signup', {
    data: { name: 'Doc Student', email, phone: '9876500011',
      password: 'a-real-password-' + S },
  });

  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/documents.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);

  const cards = await page.$$eval('#docGrid .sl', els => els.map(e => ({
    id: e.dataset.id,
    name: (e.querySelector('h3') || {}).textContent || '',
    note: (e.querySelector('.docnote') || {}).textContent || '',
    chip: (e.querySelector('.sl-chip') || {}).textContent || '',
  })));
  const by = id => cards.find(c => c.id === id);
  ok(cards.length >= 12, 'the documents screen lists the checklist — ' + cards.length);

  /* --------------------------------------------- the wording, one at a time */
  const sem = by('degree');
  ok(sem && /semester/i.test(sem.name),
    'the transcripts card asks for semester-wise marksheets — ' + (sem && sem.name));
  ok(sem && /one file/i.test(sem.note),
    'and says every semester goes in one file — ' + (sem && sem.note).slice(0, 80));

  const con = by('consol');
  ok(con && /consolidated grade card/i.test(con.name),
    'the consolidated grade card is its own document — ' + (con && con.name));
  ok(con && /not the same/i.test(con.note),
    'and says it is not the marksheets under another name — '
    + (con && con.note).slice(0, 80));

  const cert = by('degcert');
  ok(cert && /original degree certificate/i.test(cert.name),
    'the original degree certificate is asked for — ' + (cert && cert.name));
  const prov = by('provis');
  ok(prov && /provisional/i.test(prov.name) && prov.id !== (cert || {}).id,
    'and the provisional one separately — ' + (prov && prov.name));

  const work = by('work');
  ok(work && /work experience/i.test(work.name),
    'work experience has a slot — ' + (work && work.name));
  ok(work && /ONE file/.test(work.note),
    'and it is one file, not one per employer — ' + (work && work.note).slice(0, 80));

  const certs = by('certs');
  ok(certs && /certificates/i.test(certs.name),
    'certificates have a slot — ' + (certs && certs.name));
  ok(certs && /ONE file/.test(certs.note),
    'and they go in one file too — ' + (certs && certs.note).slice(0, 80));

  /* Every optional document says so in its NAME. The chip alone reads as "we
     would still like it", and a student who has not graduated was chasing a
     degree certificate that cannot exist yet. */
  const optional = cards.filter(c => c.chip);
  ok(optional.length >= 4, 'there are optional documents at all — ' + optional.length);
  const silent = optional.filter(c => !/\(if available\)/i.test(c.name));
  ok(silent.length === 0,
    'and every one of them says "(if available)" in its name — '
    + JSON.stringify(silent.map(c => c.name)));
  /* And nothing required says it. */
  const wrong = cards.filter(c => !c.chip && /\(if available\)/i.test(c.name));
  ok(wrong.length === 0,
    'while nothing required pretends to be optional — '
    + JSON.stringify(wrong.map(c => c.name)));

  /* ------------------------------------------------------- the size limit */
  const limit = (await page.textContent('#docLimit').catch(() => '')) || '';
  ok(/10 MB/.test(limit),
    'the screen states the limit before a file is chosen — ' + limit.trim());

  /* THE one, and it is driven rather than read: the screen's number, the
     uploader's number and the server's number have to be the SAME number, and
     the way that broke was three copies of it in three files. So an oversized
     file is handed to the real file chooser and the screen is asked what it
     says — no upload should even start. */
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-drop="passport"]');
  const fc = await chooser;
  await fc.setFiles({ name: 'huge-scan.pdf', mimeType: 'application/pdf',
    buffer: asPdf(11 * 1024 * 1024) });
  await page.waitForTimeout(900);
  const toast = (await page.textContent('.toast, #toast').catch(() => '')) || '';
  ok(/10 MB/.test(toast),
    'the uploader refuses an 11 MB file with the same number — ' + toast.trim());
  ok(/11\.0 MB/.test(toast),
    'and tells them how big theirs actually is — ' + toast.trim());
  const stillEmpty = await page.$eval('[data-id="passport"]',
    e => !e.querySelector('.sl-meta')).catch(() => false);
  ok(stillEmpty, 'and nothing was uploaded');

  const big = asPdf(11 * 1024 * 1024);
  const refused = await stu.request.post(BASE + '/api/documents', {
    multipart: { key: 'passport',
      file: { name: 'huge.pdf', mimeType: 'application/pdf', buffer: big } },
  });
  ok(refused.status() === 413,
    'the server refuses a file over it — ' + refused.status());
  const said = await refused.text();
  ok(/10 MB/.test(said),
    'and says the same number the screen said — ' + said.slice(0, 90));

  /* Under it still works, or the limit is a wall rather than a limit. */
  const fine = await stu.request.post(BASE + '/api/documents', {
    multipart: { key: 'consol',
      file: { name: 'grade-card.pdf', mimeType: 'application/pdf',
        buffer: asPdf(400 * 1024) } },
  });
  ok(fine.ok(), 'and a normal scan goes through — ' + fine.status());

  ok(errs.length === 0, 'no page errors — ' + errs.slice(0, 2).join(' | '));

  /* ============================== and every other screen agrees with the list */
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  const dash = await page.$$eval('#docReady .doclist li',
    els => els.map(e => (e.querySelector('span') || {}).textContent || ''));
  ok(dash.some(n => /Semester-wise marksheets/i.test(n)),
    'the dashboard uses the same name — ' + JSON.stringify(dash));
  /* This card is injected into dashboard.html, which is edited in place and
     never rebuilt, so it kept whatever the FIRST build wrote. That is how one
     screen ends up naming a document nothing else calls that. */
  ok(!dash.some(n => /Degree transcripts/i.test(n)),
    'and not the one the product has stopped using — ' + JSON.stringify(dash));
  ok(dash.some(n => /Consolidated grade card/i.test(n)),
    'and it knows about the new one — ' + JSON.stringify(dash));

  /* The counsellor's own screen, which is the one that has to ask for it. */
  const admin = await browser.newContext(vp);
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const alerts = await (await admin.request.get(BASE + '/api/staff/alerts')).json();
  const text = JSON.stringify(alerts.alerts || []);
  ok(!/Degree transcripts/.test(text),
    'the alerts do not chase a document by its old name');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
