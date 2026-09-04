/**
 * Counsellor View — the seven notes from the testing team.
 *
 *   THE FILES WERE NOT DOWNLOADABLE. "When clicked on their profile — under
 *   documents — we are seeing the file names but not able to download the
 *   files." The route existed and was already correct; this screen printed the
 *   filename as text and never linked to it. So a counsellor could see that a
 *   passport had been uploaded, could not open it, and was asked on the same
 *   row to press Verify — which means "I have opened this and checked it".
 *
 *   "UNDER REVIEW" → "UNDER REVIEW BY UNIVERSITY". A student reasonably read
 *   the old wording as us reviewing it.
 *
 *   FOUR MORE ADMISSION OUTCOMES. Offer and Rejected were the only two, so a
 *   waitlist, a deferral, an offer that was turned down and an enrolment were
 *   all being filed as one of the two answers that were wrong. A waitlist
 *   recorded as Rejected is a place the office stops waiting for.
 *
 *   ONE CLICK REMOVED A PROGRAMME. And the server deletes the APPLICATION with
 *   it — the stage, the decision, everything recorded against it — then
 *   messages the student. The note in the code said it was "reversible by
 *   adding it back". It is not: adding it back gives a fresh row at stage zero.
 *
 *   THE MESSAGE NAMED ONLY THE UNIVERSITY. It was meant to name the course as
 *   well; the line read `p.name`, and a catalogue row has no `name` — the
 *   course is `program`. The clause was undefined on all 171 rows and fell away
 *   silently, so a student with three courses at one university got three
 *   identical messages.
 *
 *   THE GERMAN SHORT NAME. TU Dortmund, HAW Kiel, BHT Berlin. A typed column in
 *   the catalogue sheet, not a rule — FH Kiel and HAW Kiel are two different
 *   institutions.
 *
 *   AND A SORT ON THE STUDENT LIST, latest message first.
 *
 * The two lists this round renamed things in were in FOUR files, with a comment
 * above the second copy saying two lists that must agree eventually will not.
 * They are one list now, and the last section here reads the delivered page and
 * compares it against what the server says.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

const asPdf = bytes => Buffer.concat([
  Buffer.from('%PDF-1.4\n'), Buffer.alloc(Math.max(0, bytes - 9), 0x41)]);

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
const toCsv = rows => rows.map(r => r.map(c => {
  const s = String(c == null ? '' : c);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}).join(',')).join('\n');

(async () => {
  const browser = await chromium.launch();
  const vp = { viewport: { width: 1600, height: 1050 } };

  const admin = await browser.newContext(vp);
  const r0 = await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  ok(r0.ok(), 'the office can sign in — ' + r0.status());

  /* A student of our own, with a file on their record and a programme on their
     list, so nothing below depends on what the seed happens to hold. */
  const stu = await browser.newContext(vp);
  const email = 'cv' + S + '@example.com';
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Counsellor View', email, phone: '9876500071',
      password: 'a-real-password-' + S } });
  const up = await stu.request.post(BASE + '/api/documents', {
    multipart: { key: 'passport',
      file: { name: 'Passport_' + S + '.pdf', mimeType: 'application/pdf',
        buffer: asPdf(4096) } },
  });
  ok(up.ok(), 'the student has a document on file — ' + up.status());

  const people = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const row = (people.students || []).find(x => x.email === email);
  ok(!!row, 'and is on the office list');
  const SID = row && row.id;

  const cat = await (await admin.request.get(BASE + '/api/staff/catalogue')).json();
  const prog = (cat.programmes || cat.items || [])[0];
  ok(!!prog, 'there is a programme to put on their list');
  const add = await admin.request.post(BASE + '/api/staff/student/' + SID + '/shortlist',
    { data: { id: prog.id } });
  ok(add.ok(), 'the office can add it — ' + add.status());

  /* ============================================ 1. the message names the course */
  const msgs = await (await stu.request.get(BASE + '/api/chat')).json()
    .catch(() => ({ messages: [] }));
  const body = JSON.stringify(msgs);
  ok(prog && body.includes(prog.program),
    'the student is told WHICH COURSE was added, not only the university — '
    + body.slice(0, 160));
  ok(prog && body.includes(prog.university),
    'and the university it is at');

  /* ================================================ 2. the file is downloadable */
  const page = await admin.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.click('[data-open="' + SID + '"]');
  await page.waitForTimeout(1600);
  const fileTab = await page.$('.tab[data-t="file"]');
  if (fileTab) { await fileTab.click(); await page.waitForTimeout(900); }

  const links = await page.$$eval('#docs a[href]',
    a => a.map(x => ({ href: x.getAttribute('href'), text: x.textContent.trim() })))
    .catch(() => []);
  ok(links.length > 0,
    'the documents on the counsellor\'s screen are links, not text — ' + links.length);
  ok(links.some(l => /\/api\/staff\/student\/\d+\/document\/.+\/file/.test(l.href)),
    'pointing at the file — ' + JSON.stringify(links.slice(0, 2)));

  /* Followed, because a link with the wrong id is still a link. */
  const hit = links.find(l => /\/file$/.test(l.href));
  if (hit) {
    const got = await admin.request.get(BASE + hit.href);
    ok(got.ok(), 'and the file actually comes back — ' + got.status());
    const buf = await got.body();
    ok(buf.slice(0, 5).toString() === '%PDF-', 'as the PDF that was uploaded');
    ok(/attachment/i.test(got.headers()['content-disposition'] || ''),
      'delivered as an attachment');
  }

  /* And it is still nobody else's file. The link is on a page; the rule is on
     the server, and only the second one is a rule. */
  const other = await browser.newContext(vp);
  await other.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Nosy', email: 'nosy' + S + '@example.com', phone: '9876500072',
      password: 'a-real-password-x' + S } });
  const denied = await other.request.get(
    BASE + '/api/staff/student/' + SID + '/document/passport/file');
  ok(!denied.ok(), 'a student cannot fetch another student\'s file — ' + denied.status());

  /* ================================= 3. the stage, and what the student reads */
  const stages = await page.$$eval('[data-stage] option',
    o => o.map(x => x.textContent.trim()));
  ok(stages.includes('Under review by university'),
    'the stage says who is reviewing it — ' + stages.join(' | '));
  ok(!stages.includes('Under review'),
    'and not the wording a student read as us — ' + stages.join(' | '));

  /* ============================================== 4. seven admission outcomes */
  const outs = await page.$$eval('[data-outcome] option',
    o => o.map(x => ({ v: x.value, n: x.textContent.trim() })));
  const want = ['', 'offer', 'waitlist', 'deferred', 'rejected', 'relinquished', 'enrolled'];
  ok(want.every(k => outs.some(o => o.v === k)),
    'every admission outcome is on the list — ' + JSON.stringify(outs.map(o => o.v)));
  ok(outs.length === want.length,
    'and nothing else — ' + outs.length + ' of ' + want.length);

  /* Each one is a real answer the server keeps, not a label on a control. A
     waitlist that stores as '' is the fault this is fixing, one layer down. */
  for (const k of ['waitlist', 'deferred', 'relinquished', 'enrolled']) {
    const put = await admin.request.put(
      BASE + '/api/staff/student/' + SID + '/application/' + encodeURIComponent(prog.id),
      { data: { stage: 4, outcome: k } });
    ok(put.ok(), 'the office can record "' + k + '" — ' + put.status());
    const back = await (await stu.request.get(BASE + '/api/state')).json();
    const app = (back.apps || {})[String(prog.id)] || {};
    ok(app.outcome === k, 'and it is stored as itself — ' + JSON.stringify(app.outcome));
  }
  /* And nothing invented is. */
  const junk = await admin.request.put(
    BASE + '/api/staff/student/' + SID + '/application/' + encodeURIComponent(prog.id),
    { data: { stage: 4, outcome: 'made-up' } });
  const afterJunk = await (await stu.request.get(BASE + '/api/state')).json();
  ok(((afterJunk.apps || {})[String(prog.id)] || {}).outcome === '',
    'an outcome that is not on the list is not stored — '
    + JSON.stringify((afterJunk.apps || {})[String(prog.id)]));

  /* The student is told in the words of the outcome, not the stage it happened
     to be on. Every one of these used to arrive as "Decision". */
  await admin.request.put(
    BASE + '/api/staff/student/' + SID + '/application/' + encodeURIComponent(prog.id),
    { data: { stage: 4, outcome: 'waitlist' } });
  const said = JSON.stringify(
    await (await stu.request.get(BASE + '/api/chat')).json().catch(() => ({})));
  ok(/waiting list/i.test(said),
    'a waitlist reaches the student as a waitlist — ' + said.slice(-200));

  /* ==================================== 5. removing takes two presses */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.click('[data-open="' + SID + '"]');
  await page.waitForTimeout(1800);
  /* Their universities live on the file tab, and a reload opens on the
     conversation. A control in a hidden pane is not a control somebody can
     press, so this has to be where a counsellor would actually be. */
  const ft = await page.$('.tab[data-t="file"]');
  if (ft) { await ft.click(); await page.waitForTimeout(1000); }
  const rm = await page.$('[data-unidrop]');
  ok(!!rm, 'there is a Remove control');
  if (rm) {
    ok((await rm.textContent()).trim() === 'Remove', 'reading Remove to start with');
    await rm.click();
    await page.waitForTimeout(400);
    const asked = (await rm.textContent()).trim();
    ok(/\?$/.test(asked), 'one press asks rather than removes — ' + asked);
    ok(asked.length > 'Remove?'.length,
      'and names what would go — ' + asked);
    /* NOTHING HAPPENED YET. This is the whole finding. */
    const still = await (await stu.request.get(BASE + '/api/state')).json();
    ok((still.shortlist || []).some(x => String(x.id) === String(prog.id)),
      'and the programme is still on their list after that first press');

    await rm.click();
    await page.waitForTimeout(1400);
    const gone = await (await stu.request.get(BASE + '/api/state')).json();
    ok(!(gone.shortlist || []).some(x => String(x.id) === String(prog.id)),
      'the second press removes it');
    /* The reason it needed asking: the application goes too. */
    ok(!(gone.apps || {})[String(prog.id)],
      'and the application with it, which is what could not be undone');
  }
  ok(errs.length === 0, 'no page errors on the counsellor screen — '
    + errs.slice(0, 2).join(' | '));

  /* ===================================== 6. the short name, sheet to screen */
  const csv = await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text();
  const rows = parseCsv(csv);
  const head = rows[0].map(h => h.trim().toLowerCase());
  const iShort = head.indexOf('short name');
  const iUni = head.indexOf('university');
  const iId = head.indexOf('id');
  ok(iShort >= 0, 'the sheet has a short name column — ' + head.slice(0, 5).join(', '));
  ok(iShort === iUni + 1, 'beside the full name, where somebody filling it in is looking');

  const MARK = 'TU Test-' + S;
  const target = rows.find((r, i) => i > 0 && r[iId]);
  const file = rows.map(r => r.slice());
  file[rows.indexOf(target)][iShort] = MARK;
  const imp = await admin.request.post(BASE + '/api/staff/catalogue/import',
    { multipart: { confirm: 'yes', file: { name: 'catalogue.csv', mimeType: 'text/csv',
      buffer: Buffer.from(toCsv(file), 'utf8') } } });
  ok(imp.ok(), 'a short name uploads — ' + imp.status() + ' '
    + (imp.ok() ? '' : (await imp.text()).slice(0, 120)));

  /* THE TRAP THIS COLUMN WALKS INTO. The first upload of a new column is a
     sheet where it is the ONLY edit on 171 rows — so a field missing from the
     importer's comparison makes every row read "already right", the office is
     told nothing needed doing, and the upload is thrown away in silence. */
  const impBody = await imp.json().catch(() => ({}));
  ok((impBody.counts || {}).updated >= 1 || impBody.applied,
    'and counts as a change rather than "already right" — '
    + JSON.stringify(impBody.counts || impBody).slice(0, 140));

  const backCsv = await (await admin.request.get(BASE + '/api/staff/catalogue.csv')).text();
  ok(backCsv.includes(MARK), 'it survives the round trip to the sheet');

  const pub = await (await browser.newContext().then(c => c.request.get(BASE + '/api/catalogue'))).json();
  const served = (pub.programmes || []).find(p => String(p.id) === String(target[iId]));
  ok(served && served.shortName === MARK,
    'and reaches the public catalogue — ' + JSON.stringify(served && served.shortName));

  /* AND THE PAGE. The live-catalogue merge refreshes a known row field by
     field, and a field nobody adds to that list is a field the office can edit
     for ever without a visitor seeing it. That has now happened five times in
     this file — the address, the URLs, the two bars, the intakes, and this. */
  const home = await browser.newContext(vp);
  const hp = await home.newPage();
  const herrs = [];
  hp.on('pageerror', e => herrs.push(String(e)));
  await hp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await hp.waitForTimeout(3200);
  /* Asserted on the RENDERED ROWS, not on a variable inside the page. The
     catalogue the finder filters is module-scoped and a test that reaches for
     it is testing the wrong thing anyway: what matters is the name printed on
     the card a visitor reads. */
  await hp.waitForTimeout(1200);
  const shown = await hp.$$eval('#rowsIn .mrow, #rowsOut .mrow',
    els => els.map(e => e.textContent.replace(/\s+/g, ' '))).catch(() => []);
  ok(shown.length > 0, 'the finder has rows on it — ' + shown.length);
  const hit2 = shown.find(x => x.includes(MARK));
  ok(!!hit2,
    'a short name the office types is printed on the card a visitor reads — '
    + shown.slice(0, 2).join(' // ').slice(0, 200));
  ok(hit2 && !hit2.includes(target[iUni]),
    'and the long name is not printed beside it — ' + String(hit2).slice(0, 140));
  ok(herrs.length === 0, 'no page errors on the home page — ' + herrs.slice(0, 2).join(' | '));

  /* Blank means the FULL name, never an abbreviation this code invented. */
  const blanks = (pub.programmes || []).filter(p => p.university && !p.shortName);
  ok(blanks.length > 0,
    'rows with no short name are ordinary — ' + blanks.length);

  /* ==================================== 7. the student list can be sorted */
  ok((await page.$$('#sortStudents')).length === 1, 'there is a sort control');
  const sorts = await page.$$eval('#sortStudents option', o => o.map(x => x.value));
  ok(sorts[0] === 'latest', 'and it opens on latest message — ' + sorts.join(', '));
  ok(sorts.includes('unread') && sorts.includes('name'),
    'with the other ways somebody works — ' + sorts.join(', '));

  /* Driven: choosing a different sort reorders the list rather than only
     changing the box. */
  const before = await page.$$eval('#caseList [data-open]', b => b.map(x => x.dataset.open));
  await page.selectOption('#sortStudents', 'name');
  await page.waitForTimeout(600);
  const byName = await page.$$eval('#caseList [data-open] b', b => b.map(x => x.textContent));
  const sorted = byName.slice().sort((a, b) => a.localeCompare(b));
  ok(JSON.stringify(byName) === JSON.stringify(sorted),
    'and A–Z really is A–Z — ' + byName.slice(0, 3).join(' | '));
  await page.selectOption('#sortStudents', 'latest');
  await page.waitForTimeout(600);
  const after = await page.$$eval('#caseList [data-open]', b => b.map(x => x.dataset.open));
  ok(JSON.stringify(after) === JSON.stringify(before),
    'and going back to latest restores the order it opened with');

  /* ======================= 8. one list, not four copies of it */
  /* The whole reason the renames above were a five-file job. The server owns
     these now; this reads what the DELIVERED page has and compares. */
  const src = await (await admin.request.get(BASE + '/counsellor')).text();
  const inPage = [...src.matchAll(/\{k:'([a-z]*)',\s*n:'([^']+)'/g)].map(m => m[2]);
  ok(inPage.includes('Under review by university'),
    'the page carries the shared stage list — ' + inPage.slice(0, 6).join(' | '));
  for (const p of ['/applications.html', '/partner', '/counsellor']) {
    const s = await (await admin.request.get(BASE + p)).text();
    ok(/Under review by university/.test(s) && !/'Under review'/.test(s),
      p + ' has the one wording, and not the old one');
    ok(/relinquished/.test(s), p + ' has the one outcome list');
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
