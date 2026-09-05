/**
 * The 1.6 testing round.
 *
 * Six findings, and two more that were sitting beside them.
 *
 *   ONLY ALLOWED FILE TYPES CAN BE UPLOADED. "Both uploaded successfully. The
 *   allowed-types list is only a hint in the file picker; the server accepts
 *   anything." A .txt went into the Class 12 slot and an .html into the CV
 *   slot, and both sat on the record looking like documents. `accept` filters
 *   a dialog; every browser lets somebody switch it to All Files.
 *
 *   Checked here in BOTH halves, because one without the other is not a check:
 *   the name has to end in something we take, and the bytes have to agree with
 *   the name. An .html renamed .pdf defeats the first on its own.
 *
 *   A STUDENT CANNOT VERIFY THEIR OWN DOCUMENTS. "Simulate counsellor
 *   verification" was a link on the student's own Documents screen and it
 *   worked — one press moved every waiting file to verified. The same screen
 *   defines verified as a counsellor having opened the file and confirmed it,
 *   and the visa appointment and the university application are gated on it.
 *   The link is gone AND the route is gone, because a control removed from a
 *   page is not the same thing as a rule.
 *
 *   THE PASSWORD SCREEN SAID 8 AND THE SERVER WANTED 10. Not a wrong rule — a
 *   student needs 8 and a member of staff needs 10, and that difference is
 *   real. What was wrong is that the form said 8 to both and found out
 *   afterwards. Same shape as the 20 MB box in front of a 10 MB server.
 *
 *   AN EMPTY SECTION DOES NOT REPORT 100%. Fixed for the nav in the previous
 *   round and not for the heading beside it, which then read "null% done".
 *
 *   THE PROFILE REFUSES IMPOSSIBLE VALUES — and says so once. The refusal
 *   landed in patch 83; what this round caught is the screen ALSO saying
 *   "Saved. 91% of your profile is complete." about the same press, because
 *   the toast fired before the request went.
 *
 *   PACKAGE PRICE ENTERED AS ABC, DISPLAY 0. Live: "FROM ₹0 one-time" under
 *   Three Public Universities, and "CHEAPEST PACKAGE ₹0" on the office
 *   dashboard. Patch 83 refuses this on the way IN. It was already in.
 *
 * And the two found while fixing those:
 *
 *   THE AGENCY SCREEN refused at 12 MB in front of a server that refuses at
 *   10 — the exact mismatch patch 81 fixed on the student's screen, still
 *   standing one screen along.
 *
 *   THE PACKAGES SPREADSHEET had no price check at all, so the rule patch 83
 *   put on the Edit dialog could be walked around by uploading the sheet.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* Real files, made here rather than shipped: a signature and enough bytes
   after it that nothing is rejected for being empty. */
const REAL = {
  pdf: Buffer.concat([Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'), Buffer.alloc(512, 0x20)]),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256)]),
  jpg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256)]),
  docx: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256)]),
  heic: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(256)]),
};

/* A CSV parser good enough to read our own export back. The features column is
   "one per line", so a package row contains newlines INSIDE a quoted cell — and
   splitting the download on '\n' turns thirteen packages into sixty broken
   ones, which the importer then correctly refuses. Borrowed from importtest,
   where the same thing was learnt. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^\ufeff/, '');
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
  const vp = { viewport: { width: 1500, height: 1050 } };

  const stu = await browser.newContext(vp);
  const email = 'rnd' + S + '@example.com';
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Round Six', email, phone: '9876500061', password: 'a-real-password-' + S } });

  const send = (name, type, buf, key) => stu.request.post(BASE + '/api/documents',
    /* `xii`, not the name this used. There is no slot by that name — the
       Class 12 marksheet is `xii` in server/docs.js and in the screens — so
       every upload here landed under a key no screen draws, and the file was
       invisible on the Documents page it was supposedly proving. It passed
       because the route accepted any string it was given; that route now
       refuses a slot that does not exist, which is what surfaced this. */
    { multipart: { key: key || 'xii', file: { name, mimeType: type, buffer: buf } } });

  /* ====================================================== 1. the file types */
  const txt = await send('QA Wrong Type-Sudhin.txt', 'text/plain', Buffer.from('not a marksheet'));
  ok(txt.status() === 415, 'a .txt is refused from a document slot — ' + txt.status());
  const txtWhy = (await txt.json()).error || '';
  ok(/QA Wrong Type-Sudhin\.txt/.test(txtWhy), 'and the file is named — ' + txtWhy.slice(0, 90));
  ok(/PDF/.test(txtWhy) && /Word/.test(txtWhy),
    'and what IS taken is said, rather than only what is not');

  const html = await send('QA Fake Script-Sudhin.html', 'text/html',
    Buffer.from('<script>alert(1)</script>'), 'cv');
  ok(html.status() === 415, 'an .html is refused from the CV slot — ' + html.status());

  /* The half an extension check cannot do. This is the same bytes as above
     under a name we accept — and the reason the check reads the file. */
  const liar = await send('QA Fake Script-Sudhin.pdf', 'application/pdf',
    Buffer.from('<script>alert(1)</script>'));
  ok(liar.status() === 415, 'and renaming it .pdf does not get it in — ' + liar.status());
  ok(/is not one inside|not a/i.test((await liar.json()).error || ''),
    'the reason says the bytes disagree with the name, not that the name is wrong');

  /* And everything a student actually has must still go in, or this is a wall
     rather than a check. HEIC is on the list because the card tells them to
     photograph the pages and an iPhone photographing pages produces HEIC. */
  for (const [ext, buf] of Object.entries(REAL)) {
    const r = await send('scan-' + S + '.' + ext, 'application/octet-stream', buf);
    ok(r.ok(), 'a real .' + ext + ' is accepted — ' + r.status()
      + ' ' + (r.ok() ? '' : ((await r.json()).error || '')));
  }

  /* The screen states the same list it enforces — the fault the 20 MB box in
     front of a 10 MB server was, wearing a different hat. */
  const docs = await stu.newPage();
  const derrs = [];
  docs.on('pageerror', e => derrs.push(String(e)));
  await docs.goto(BASE + '/documents.html', { waitUntil: 'domcontentloaded' });
  await docs.waitForTimeout(2600);
  const said = ((await docs.textContent('#docLimit')) || '').replace(/\s+/g, ' ');
  ok(/PDF/.test(said) && /HEIC/i.test(said),
    'the card advertises the list the server keeps — ' + said.slice(0, 80));
  const accept = await docs.evaluate(() => {
    const i = [...document.querySelectorAll('input[type=file]')].pop();
    return i ? i.accept : null;
  });
  ok(accept && /heic/i.test(accept) && /pdf/i.test(accept),
    'and the picker offers the same ones — ' + accept);

  /* ============================ 2. a student cannot verify their own documents */
  ok((await docs.$$('#verifyAll')).length === 0,
    'there is no "simulate counsellor verification" on the student\'s screen');
  const body = (await docs.textContent('body')) || '';
  ok(!/simulate/i.test(body), 'and nothing offering it by another name');

  /* THE one that is a rule rather than a screen. */
  const sim = await stu.request.post(BASE + '/api/documents/verify-all');
  ok(sim.status() === 404, 'and the route is gone, not just the link — ' + sim.status());

  /* Nothing the student uploaded is verified by anybody but a counsellor. */
  const st1 = await (await stu.request.get(BASE + '/api/state')).json();
  const marks = Object.values(st1.docs || {}).map(d => d.status);
  ok(marks.length > 0 && marks.every(x => x !== 'ok'),
    'their own uploads are all still waiting to be checked — ' + marks.join(','));

  /* And a counsellor still CAN, which is the other half of the sentence. */
  const admin = await browser.newContext(vp);
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const people = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const row = (people.students || []).find(x => x.email === email);
  ok(!!row, 'the student is on the office list');
  if (row) {
    const v = await admin.request.post(
      BASE + '/api/staff/student/' + row.id + '/document/xii', { data: { status: 'ok' } });
    ok(v.ok(), 'the office can verify a document — ' + v.status());
    const st2 = await (await stu.request.get(BASE + '/api/state')).json();
    ok(((st2.docs || {}).xii || {}).status === 'ok',
      'and it shows as verified on the student\'s file');
  }

  /* ================================================= 3. one password minimum */
  const me = await (await stu.request.get(BASE + '/api/auth/me')).json();
  ok(me.passwordMin === 8, 'a student is told their minimum is 8 — ' + me.passwordMin);
  const meAdmin = await (await admin.request.get(BASE + '/api/auth/me')).json();
  ok(meAdmin.passwordMin === 10, 'and a member of staff 10 — ' + meAdmin.passwordMin);

  /* The number the screen prints is the number the server keeps. Read off the
     delivered page rather than the source, because the placeholder is written
     by script at the moment the form is drawn. */
  const chg = await admin.newPage();
  await chg.goto(BASE + '/login.html?change=1', { waitUntil: 'domcontentloaded' });
  await chg.waitForTimeout(1800);
  const ph = await chg.getAttribute('#cNew', 'placeholder').catch(() => null);
  ok(ph === 'At least 10 characters',
    'the forced-change screen asks staff for the ten it will be held to — ' + ph);
  /* Driven: type nine and the screen must refuse it itself, in its own words,
     rather than sending it and relaying the server's refusal afterwards. */
  await chg.fill('#cNow', 'whatever-they-were-given');
  await chg.fill('#cNew', 'nine-char');
  await chg.fill('#cAgain', 'nine-char');
  await chg.click('#cGo');
  await chg.waitForTimeout(700);
  const cmsg = ((await chg.textContent('#cMsg')) || '').trim();
  ok(/at least 10/i.test(cmsg), 'and refuses nine before sending it — ' + cmsg);

  /* And the server has the last word regardless of what any screen says. */
  const short = await admin.request.post(BASE + '/api/auth/change',
    { data: { current: 'glovels123', password: 'nine-char' } });
  ok(short.status() === 422, 'the server refuses nine for staff — ' + short.status());
  ok(/10/.test((await short.json()).error || ''), 'saying the same number');

  /* ==================================== 4 & 5. the profile, on one press */
  const prof = await stu.newPage();
  const perrs = [];
  prof.on('pageerror', e => perrs.push(String(e)));
  await prof.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await prof.waitForTimeout(2800);
  const nav = await prof.$$eval('#secNav button',
    b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()));

  const fam = nav.findIndex(n => /family details/i.test(n));
  ok(fam >= 0, 'there is a Family details section');
  await prof.click('#secNav [data-i="' + fam + '"]');
  await prof.waitForTimeout(600);
  const head = ((await prof.textContent('#pForm h3')) || '').replace(/\s+/g, ' ').trim();
  ok(/optional/i.test(head), 'an optional section\'s heading says optional — ' + head);
  ok(!/null/.test(head), 'and NOT "null% done", which is what it said — ' + head);
  ok(!/100%/.test(head), 'and not 100% of a form nobody has touched — ' + head);

  /* A section that DOES have required fields still prints a number, or the
     fix has taken the meter off every heading. */
  const per = nav.findIndex(n => /personal details/i.test(n));
  await prof.click('#secNav [data-i="' + per + '"]');
  await prof.waitForTimeout(600);
  ok(/%\s*done/i.test((await prof.textContent('#pForm h3')) || ''),
    'a section with required fields still shows a percentage');

  /* THE PRESS. One answer, and it is the server's. */
  const c12 = nav.findIndex(n => /class 12/i.test(n));
  await prof.click('#secNav [data-i="' + c12 + '"]');
  await prof.waitForTimeout(700);
  const box = '#pForm .field[data-k="xii_score"] input';
  await prof.click(box);
  await prof.fill(box, '500');
  await prof.click('#saveBtn');
  await prof.waitForTimeout(2600);
  const toast = ((await prof.textContent('#toast').catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  ok(!/Saved\./i.test(toast),
    'a refused value does not report itself as saved — ' + toast.slice(0, 90));
  ok(/between 0 and 100/i.test(toast),
    'the one thing on the screen is what the server said — ' + toast.slice(0, 90));
  const back = await (await stu.request.get(BASE + '/api/state')).json();
  ok(!(back.profile || {}).xii_score,
    'and nothing was stored — ' + JSON.stringify((back.profile || {}).xii_score));

  /* And a value it accepts still saves and still says so, or the press has
     simply stopped working. */
  await prof.click(box);
  await prof.fill(box, '88');
  await prof.click('#saveBtn');
  await prof.waitForTimeout(2600);
  const good = ((await prof.textContent('#toast').catch(() => '')) || '').replace(/\s+/g, ' ');
  ok(/Saved\./i.test(good), 'a real value saves and says so — ' + good.slice(0, 60));
  const back2 = await (await stu.request.get(BASE + '/api/state')).json();
  ok(String((back2.profile || {}).xii_score) === '88',
    'and it is on the record — ' + JSON.stringify((back2.profile || {}).xii_score));
  ok(perrs.length === 0, 'no page errors on the profile — ' + perrs.slice(0, 2).join(' | '));
  ok(derrs.length === 0, 'no page errors on documents — ' + derrs.slice(0, 2).join(' | '));

  /* ======================================= 6. a package on sale at nothing */
  /* Through the sheet, which is where this rule was missing. The Edit dialog
     learnt it in patch 83; this path had never heard of it. */
  const sheet = await (await admin.request.get(BASE + '/api/staff/content/packages.csv'))
    .text().catch(() => '');
  ok(!!sheet, 'the packages sheet downloads');
  if (sheet) {
    const rows = parseCsv(sheet);
    const head = rows[0].map(h => h.trim().toLowerCase());
    const iPrice = head.indexOf('price inr');
    const iSell = head.indexOf('sold online');
    ok(iPrice >= 0 && iSell >= 0, 'with the two columns this is about');

    const upload = async price => {
      const file = rows.map(r => r.slice());
      /* The first row that is actually sold online — the ₹99 entry package in
         a seeded database, and whatever plays that part in a real one. */
      const at = file.findIndex((r, i) => i > 0 && /^y|^1|^true/i.test(String(r[iSell] || '')));
      if (at < 0) return null;
      file[at][iPrice] = price;
      const res = await admin.request.post(BASE + '/api/staff/content/packages/import',
        { multipart: { file: { name: 'packages.csv', mimeType: 'text/csv',
          buffer: Buffer.from(toCsv(file), 'utf8') } } });
      return { status: res.status(), body: await res.json(), title: file[at][head.indexOf('title')] };
    };

    const abc = await upload('ABC');
    if (abc) {
      ok((abc.body.counts || {}).rejected >= 1,
        'a price of ABC stops the row — ' + JSON.stringify(abc.body.counts));
      const why = ((abc.body.plan || {}).rejected || []).flatMap(r => r.why || []).join(' | ');
      ok(/not a number/i.test(why) && /ABC/.test(why),
        'and the reason quotes what was typed — ' + why.slice(0, 120));
      ok(/sold online|above zero/i.test(why), 'and says how to fix it — ' + why.slice(0, 140));

      const zero = await upload('0');
      ok((zero.body.counts || {}).rejected >= 1,
        'and so does a price of zero on something marked as sold — '
        + JSON.stringify(zero.body.counts));
      const zwhy = ((zero.body.plan || {}).rejected || []).flatMap(r => r.why || []).join(' ');
      ok(/at nothing|zero/i.test(zwhy), 'saying what zero means here — ' + zwhy.slice(0, 110));

      const fine = await upload('9999');
      ok((fine.body.counts || {}).rejected === 0,
        'while a real price is still accepted — ' + JSON.stringify(fine.body.counts));

      /* AND THE SHEET ROUND-TRIPS AT ALL, which is what makes any of the above
         usable. Downloading it and uploading it back unchanged rejected the
         three packages on the "Other countries" tab — the importer carried a
         hard-coded study|work|migrate that cleanPackage had already stopped
         using — and because the sheet replaces the whole section, editing one
         price took three products off the site. */
      const same = await admin.request.post(BASE + '/api/staff/content/packages/import',
        { multipart: { file: { name: 'packages.csv', mimeType: 'text/csv',
          buffer: Buffer.from(toCsv(rows), 'utf8') } } });
      const sb = await same.json();
      ok((sb.counts || {}).rejected === 0,
        'the sheet downloads and uploads back with nothing refused — '
        + JSON.stringify(sb.counts) + ' '
        + JSON.stringify(((sb.plan || {}).rejected || []).slice(0, 2)));
      ok((sb.counts || {}).removed === 0,
        'and takes nothing off the home page — ' + JSON.stringify(sb.counts));
      ok((sb.counts || {}).total === rows.length - 1,
        'every row on the sheet survives the trip — ' + (sb.counts || {}).total
        + ' of ' + (rows.length - 1));
    }
  }

  /* AND THE READING, which is the half that matters for a row already stored
     that way — the one that was live. Nothing here can create it any more, so
     it is asserted on the rule itself: nothing on sale is on sale at nothing,
     and nothing the price list carries is worth zero. */
  const state = await (await admin.request.get(BASE + '/api/staff/content')).json();
  const sold = ((state.packages || {}).items || []).filter(p => p.sell);
  ok(sold.length > 0, 'there are packages on sale — ' + sold.length);
  ok(sold.every(p => Number(p.priceInr) > 0),
    'and not one of them is on sale at nothing — '
    + JSON.stringify(sold.filter(p => !(Number(p.priceInr) > 0)).map(p => p.id)));

  const home = await browser.newContext(vp);
  const page = await home.newPage();
  const herrs = [];
  page.on('pageerror', e => herrs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  /* Read off the package cards rather than the whole page: the services
     basket starts at ₹0 and is meant to. */
  const prices = await page.$$eval('#packageGrid .pk-price, .pkg-card .price, [data-pkg-price]',
    e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim())).catch(() => []);
  ok(!prices.some(t => /₹\s*0\b/.test(t)),
    'no package card offers itself at ₹0 — ' + prices.join(' | ').slice(0, 120));
  ok(herrs.length === 0, 'no page errors on the home page — ' + herrs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
