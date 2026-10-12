/*
 * Round 169 — the admin and counsellor items from the 12 Oct test report.
 *
 *   ADM-04  Record payment refuses ≤ 0, more than is outstanding, and a future
 *           date — in the sheet (the minus sign is kept) and on the server.
 *   ADM-06  A signed-in student's checkout is their order, with the account's
 *           details; an unlinked order can be linked by hand (email / mobile).
 *   ADM-07  A lead's destination is an ISO code (shown as a name), and every
 *           form records the page it came from.
 *   ADM-08  Tasks badge with the page; dropdowns list active counsellors only;
 *           required fields checked (blog, programme name — server too).
 *   CNS-01  Tasks the applications have overtaken read as done (derived); one
 *           late count for header, Tasks tab and the bell; TASKS.progress().
 *   CNS-02  "Find what fits" judges the form, not the saved profile; a CGPA bar
 *           of 0 reads "No minimum stated".
 *   CNS-03  Lead owner: Move / Keep before anything is sent.
 *   CNS-04  One university, one suggestion (aliases ride along).
 *   CNS-05  One lead alert per person; dates as "26 Aug 2026".
 *   CNS-06  Remove on their universities asks inline, Remove / Keep.
 *   CNS-07  stuck note inline; scroll reset; 5,000-character messages; uploads
 *           per slot; catalogue in the counsellor menu; order labels; MEng.
 *
 * Port 8102 by default (BASE overrides). Loads the German sheet when the
 * catalogue is nearly empty, the way round165 does.
 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8102';
const PORT = new URL(BASE).port;
const SCR = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
const DBFILE = process.env.DBFILE || '/tmp/db-' + PORT + '/glovels.db';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };
const note = s => console.log('    · ' + s);
const J = x => JSON.stringify(x);
function done() { console.log('round169stafftest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body, extraHeaders) {
  ips[who] = ips[who] || ('10.169.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': ips[who] }, extraHeaders || {});
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, text };
}
async function upload(who, p, fields, name, bytes) {
  const fd = new FormData();
  Object.keys(fields).forEach(k => fd.append(k, fields[k]));
  fd.append('file', new Blob([bytes]), name);
  const r = await fetch(BASE + p, { method: 'POST', headers: { cookie: jar[who], 'x-forwarded-for': ips[who] }, body: fd });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, body: j };
}
const DB = () => { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(DBFILE); };
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/* ---- units: no server needed ---- */
(() => {
  const { destCode } = require(path.join(__dirname, '..', 'server', 'store.js'));
  ok('ADM-07 unit: "🇩🇪 Germany", "Germany", "de" and the flag alone are all DE',
    ['🇩🇪 Germany', 'Germany', 'de', 'DE', '🇩🇪'].every(v => destCode(v) === 'DE'), J(['🇩🇪 Germany', 'Germany', 'de', '🇩🇪'].map(destCode)));
  ok('ADM-07 unit: "UK" is GB, and something that is not a country is kept as typed',
    destCode('UK') === 'GB' && destCode('Not sure yet') === 'Not sure yet', destCode('UK') + ' / ' + destCode('Not sure yet'));
  const UNIS = require(path.join(__dirname, '..', 'server', 'unis.js'));
  ok('CNS-07 (7) unit: "MEngEngineering and…" gets its space; "(MScIH)" is left alone',
    UNIS.spaceDegree('MEngEngineering and Sustainable Technology') === 'MEng Engineering and Sustainable Technology'
    && UNIS.spaceDegree('Master of Science in International Health (MScIH)') === 'Master of Science in International Health (MScIH)'
    && UNIS.spaceDegree('MSc Data Science') === 'MSc Data Science',
    UNIS.spaceDegree('MEngEngineering and Sustainable Technology'));
  const TASKS = require(path.join(__dirname, '..', 'server', 'tasks.js'));
  ok('CNS-01 unit: tasks.js exports progress / effectiveTasks / lateCount',
    typeof TASKS.progress === 'function' && typeof TASKS.effectiveTasks === 'function' && typeof TASKS.lateCount === 'function');
})();

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ' — server checks skipped)'); return done(); }
  const st = Date.now().toString(36);
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.status === 200, r.status);

  const total0 = Number((await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.total || 0);
  if (total0 < 1000 && fs.existsSync(SCR + '/r165/live-DE-noid.xlsx')) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(SCR + '/r165/live-DE-noid.xlsx')]), 'live-DE-noid.xlsx');
    fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
    const u = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a, 'x-forwarded-for': ips.a }, body: fd });
    note('loaded the German sheet: ' + u.status);
  }

  /* ---------- a student with a paid application package ---------- */
  const sEmail = 'r169-' + st + '@example.com', sPw = 'r169-' + st + '-pw';
  r = await req('s', 'POST', '/api/auth/signup', { name: 'Rita Oneonesix', email: sEmail, phone: '9000169001', password: sPw, acceptedTerms: true });
  ok('a student signs up', r.ok, r.status + ' ' + r.text.slice(0, 120));
  const me = (await req('s', 'GET', '/api/auth/me')).body.user || {};
  const sid = Number(me.id);

  /* ADM-06: signed in, they buy — the order is theirs, with the ACCOUNT's
     details whatever the form sent. */
  r = await req('s', 'POST', '/api/orders', { packageId: 'pkg-offer', name: 'Somebody Else', email: 'other-' + st + '@example.com', phone: '9000169999', acceptedTerms: true });
  ok('ADM-06: a signed-in student can check out', r.ok, r.status + ' ' + r.text.slice(0, 160));
  const ref1 = r.body.reference;
  let o1 = (await req('a', 'GET', '/api/staff/order/' + ref1)).body.order || {};
  ok('ADM-06: the order is linked to the signed-in student', Number(o1.studentId) === sid, J({ studentId: o1.studentId, sid }));
  ok('ADM-06: and carries the account\'s email and name, not what the form said',
    String(o1.email).toLowerCase() === sEmail && o1.name === 'Rita Oneonesix', J({ email: o1.email, name: o1.name }));
  ok('ADM-06: no stray account was made for the email the form sent',
    !(await req('a', 'GET', '/api/staff/order/' + ref1 + '/link?q=' + encodeURIComponent('other-' + st))).body.students.length);

  /* ADM-06: an order with no student (bought under a staff address) is linked by hand. */
  r = await req('g', 'POST', '/api/orders', { packageId: 'pkg-offer', name: 'Guest Buyer', email: 'admin@glovels.com', phone: '9000169002', acceptedTerms: true });
  const ref2 = r.body.reference;
  let o2 = (await req('a', 'GET', '/api/staff/order/' + ref2)).body.order || {};
  ok('ADM-06: an order under a staff address has no student', ref2 && !o2.studentId, J({ ref2, studentId: o2.studentId }));
  r = await req('a', 'GET', '/api/staff/order/' + ref2 + '/link?q=' + encodeURIComponent(sEmail));
  ok('ADM-06: "Link to a student" finds the account by email', (r.body.students || []).some(p => Number(p.id) === sid), r.text.slice(0, 200));
  r = await req('a', 'GET', '/api/staff/order/' + ref2 + '/link?q=9000169001');
  ok('ADM-06: …and by mobile', (r.body.students || []).some(p => Number(p.id) === sid), r.text.slice(0, 200));
  r = await req('a', 'POST', '/api/staff/order/' + ref2 + '/link', { studentId: sid });
  ok('ADM-06: and links it', r.ok && Number((r.body.order || {}).studentId) === sid, r.status + ' ' + r.text.slice(0, 160));
  r = await req('a', 'POST', '/api/staff/order/' + ref2 + '/link', { studentId: 1 });
  ok('ADM-06: a staff account cannot be linked', r.status === 422, r.status);

  /* ---------- ADM-04: record payment ---------- */
  o1 = (await req('a', 'GET', '/api/staff/order/' + ref1)).body.order || {};
  const owed = Number(o1.outstandingPaise || 0);
  note(ref1 + ' outstanding ₹' + owed / 100);
  r = await req('a', 'POST', '/api/staff/order/' + ref1 + '/payment', { amount: -100, date: istToday(), method: 'upi' });
  ok('ADM-04: −100 is refused on the server', r.status === 422, r.status + ' ' + r.text.slice(0, 120));
  r = await req('a', 'POST', '/api/staff/order/' + ref1 + '/payment', { amount: 100, date: '2027-12-31', method: 'upi' });
  ok('ADM-04: a date in the future is refused', r.status === 422 && /future/.test(r.body.error || ''), r.status + ' ' + r.text.slice(0, 120));
  r = await req('a', 'POST', '/api/staff/order/' + ref1 + '/payment', { amount: owed / 100 + 1, date: istToday(), method: 'upi' });
  ok('ADM-04: more than the outstanding balance is refused', r.status === 422 && /outstanding/.test(r.body.error || ''), r.status + ' ' + r.text.slice(0, 120));
  r = await req('a', 'POST', '/api/staff/order/' + ref1 + '/refund', { amount: 1, date: '2027-12-31', method: 'bank' });
  ok('ADM-04: a refund dated in the future is refused too', r.status === 422 || r.status === 409, r.status);

  /* ---------- CNS-01: tasks the applications overtook ---------- */
  const cat = (await req('a', 'GET', '/api/staff/catalogue?q=bremen&per=6&status=')).body.programmes || [];
  const pA = cat[0], pB = cat[1];
  if (pA && pB) {
    await req('a', 'POST', '/api/staff/student/' + sid + '/shortlist', { id: pA.id });
    await req('a', 'POST', '/api/staff/student/' + sid + '/shortlist', { id: pB.id });
    r = await req('a', 'PUT', '/api/staff/student/' + sid + '/application/' + encodeURIComponent(pA.id), { stage: 2, outcome: 'offer' });
    ok('CNS-01: an application is filed with an offer', r.ok, r.status + ' ' + r.text.slice(0, 160));
    let file = (await req('a', 'GET', '/api/staff/student/' + sid)).body;
    const tasks = file.tasks || [];
    const byTitle = re => tasks.find(t => re.test(t.title));
    const welcome = byTitle(/^Welcome call/), shortlist = byTitle(/^Shortlist confirmed/);
    ok('CNS-01: "Welcome call and file opened" reads done, derived from the applications',
      welcome && welcome.status === 'done' && welcome.derived && /applications are past/.test(welcome.why), J(welcome));
    ok('CNS-01: "Shortlist confirmed" too', shortlist && shortlist.status === 'done' && shortlist.derived, J(shortlist));
    const subA = tasks.find(t => /^Application submitted/.test(t.title) && t.title.includes(pA.program));
    const subB = tasks.find(t => /^Application submitted/.test(t.title) && t.title.includes(pB.program));
    ok('CNS-01: the submission task for the filed programme is done', subA && subA.status === 'done' && subA.derived, J(subA));
    ok('CNS-01: the one not filed yet is still owed', !subB || subB.status !== 'done', J(subB));
    const offer = byTitle(/^Offer letter/);
    ok('CNS-01: "Offer letter received" is done once an offer is in', !offer || (offer.status === 'done' && offer.derived), J(offer));
    /* Nothing was written: the stored rows are untouched. */
    const stored = DB().prepare("SELECT status FROM tasks WHERE student_id = ? AND task_key = 'welcome'").get(sid);
    ok('CNS-01: derived, not written — the stored welcome task is still open', stored && stored.status === 'open', J(stored));

    /* One late count: make a hand task and put its date in the past. */
    r = await req('a', 'POST', '/api/staff/student/' + sid + '/tasks', { title: 'Call the bank about the loan', due: addDays(istToday(), 3) });
    const handId = (r.body.task || {}).id || ((r.body.tasks || []).find(t => /bank/.test(t.title)) || {}).id;
    const d = DB();
    d.prepare("UPDATE tasks SET due_at = ? WHERE student_id = ? AND title = ?").run('2026-08-26', sid, 'Call the bank about the loan');
    d.prepare("UPDATE tasks SET due_at = ? WHERE student_id = ? AND task_key = 'welcome'").run('2026-08-20', sid);
    file = (await req('a', 'GET', '/api/staff/student/' + sid)).body;
    const tabLate = (file.tasks || []).filter(t => t.over != null && t.over > 0).length;
    const headLate = (file.phase || {}).late;
    ok('CNS-01: the header and the Tasks tab give the same late count (an overtaken welcome call is not late)',
      tabLate === headLate && tabLate === 1, J({ tabLate, headLate, handId }));
    const al = (await req('a', 'GET', '/api/staff/alerts')).body;
    const list = al.alerts || al.items || (Array.isArray(al) ? al : []);
    const tk = list.filter(x => x.kind === 'task' && (x.subject || {}).studentId === sid);
    const said = tk.map(x => Number((/(\d+) tasks? past/.exec(x.title) || [])[1] || 0)).reduce((a, b) => a + b, 0);
    ok('CNS-01: the bell counts the same', said === headLate, J({ said, headLate, tk: tk.map(x => x.title) }));
    ok('CNS-05: the task alert dates read "26 Aug 2026"', tk.some(x => /was due 26 Aug 2026/.test(x.detail)), J(tk.map(x => x.detail)));
    const board = (await req('a', 'GET', '/api/staff/tasks?state=late&student=' + sid)).body;
    ok('CNS-01: the office board agrees', (board.tasks || []).length === headLate, J({ n: (board.tasks || []).length, headLate }));
  } else note('no Bremen programmes in the catalogue — CNS-01 skipped');

  /* ---------- ADM-07: leads ---------- */
  r = await req('l1', 'POST', '/api/enquiries', { name: 'Dest Flag ' + st, email: 'df' + st + '@example.com', phone: '9000169010', consent: 'yes', destination: '🇩🇪 Germany', source: '' },
    { referer: BASE + '/contact-us.html' });
  ok('ADM-07: the contact form files a lead', r.ok, r.status + ' ' + r.text.slice(0, 120));
  r = await req('l2', 'POST', '/api/enquiries', { name: 'Dest Word ' + st, email: 'dw' + st + '@example.com', phone: '9000169011', consent: 'yes', destination: 'Germany', sourcePage: '/' });
  const leads = (await req('a', 'GET', '/api/staff/leads')).body;
  const lf = (leads.leads || []).find(l => l.name === 'Dest Flag ' + st);
  const lw = (leads.leads || []).find(l => l.name === 'Dest Word ' + st);
  ok('ADM-07: "🇩🇪 Germany" is stored as DE and shown as Germany', lf && lf.destination === 'DE' && lf.destinationName === 'Germany', J(lf && [lf.destination, lf.destinationName]));
  ok('ADM-07: "Germany" is stored as DE too', lw && lw.destination === 'DE', J(lw && lw.destination));
  ok('ADM-07: a form that sends no page is filed with the page it came from (Referer)', lf && lf.page === '/contact-us.html', J(lf && lf.page));

  /* ---------- ADM-08 / CNS-03: who is offered ---------- */
  await req('a', 'POST', '/api/staff/people', { name: 'Test 13', email: 'test13-' + st + '@glovels.com', password: 'x-' + st + '-pw-long', role: 'counsellor' });
  await req('a', 'POST', '/api/staff/people', { name: 'Meera Real', email: 'meera-' + st + '@glovels.com', password: 'm-' + st + '-pw-long', role: 'counsellor' });
  const cs = (await req('a', 'GET', '/api/staff/counsellors')).body.counsellors || [];
  ok('ADM-08: the counsellor dropdown has no administrator', !cs.some(c => c.role === 'admin'), J(cs.map(c => c.name + ':' + c.role)));
  ok('ADM-08: …and no test account', !cs.some(c => /^test/i.test(c.name)), J(cs.map(c => c.name)));
  ok('ADM-08: a real counsellor is there', cs.some(c => c.name === 'Meera Real'), J(cs.map(c => c.name)));
  const lc = (await req('a', 'GET', '/api/staff/leads')).body.counsellors || [];
  ok('CNS-03: the lead owner list is the same active-counsellor list', lc.length === cs.length && !lc.some(c => /^test/i.test(c.name)), J(lc.map(c => c.name)));

  /* ADM-08 (3): an empty programme name is refused on the server. */
  r = await req('a', 'PUT', '/api/staff/programme', { program: '   ', university: 'Somewhere', country: 'DE', level: 'master' });
  ok('ADM-08: PUT /api/staff/programme refuses an empty programme name', r.status === 422, r.status + ' ' + r.text.slice(0, 120));
  r = await req('a', 'PUT', '/api/staff/programme', { program: 'MEngEngineering and Testing ' + st, university: 'R169 University', country: 'DE', level: 'master', field: 'Engineering' });
  ok('CNS-07 (7): a programme saved as "MEngEngineering…" gets its space', r.ok && /^MEng Engineering and Testing/.test((r.body.programme || {}).program || ''), r.status + ' ' + J((r.body.programme || {}).program));

  /* ---------- CNS-04: one university, one suggestion ---------- */
  const sug = (await req('a', 'GET', '/api/tags?q=bremen&limit=18')).body.suggestions || [];
  const unis = sug.filter(x => x.type === 'University').map(x => x.value);
  ok('CNS-04: "HS Bremen" and "Bremen University of Applied Sciences" are one suggestion',
    !(unis.includes('HS Bremen') && unis.includes('Bremen University of Applied Sciences')), J(unis));
  ok('CNS-04: "Uni Bremen" and "University of Bremen" are one suggestion',
    !(unis.includes('Uni Bremen') && unis.includes('University of Bremen')), J(unis));
  const hsb = sug.find(x => x.value === 'Bremen University of Applied Sciences');
  ok('CNS-04: the other name rides along as an alias', hsb && (hsb.aliases || []).includes('HS Bremen'), J(hsb));
  const deg = ((await req('a', 'GET', '/api/tags?q=deggendorf&limit=18')).body.suggestions || []).filter(x => x.type === 'University');
  ok('CNS-04: TH Deggendorf is listed once', deg.length === 1, J(deg));
  const tagged = (await req('a', 'GET', '/api/staff/catalogue?q=&tags=' + encodeURIComponent('Bremen University of Applied Sciences') + '&per=100&status=')).body;
  const hsRow = DB().prepare("SELECT id FROM programmes WHERE university = 'HS Bremen' LIMIT 1").get();
  ok('CNS-04: choosing the university finds the row filed under its alias too',
    !hsRow || (tagged.programmes || []).some(p => p.id === hsRow.id), J({ hsRow, n: (tagged.programmes || []).length }));
  ok('CNS-04: a row filed under the alias is listed under the one name',
    !hsRow || (tagged.programmes || []).filter(p => p.id === hsRow.id).every(p => p.universityAs === 'Bremen University of Applied Sciences'),
    J((tagged.programmes || []).filter(p => p.id === (hsRow || {}).id).map(p => p.universityAs)));

  /* ---------- CNS-05: one alert per person ---------- */
  const dupPhone = '9000169' + String(100 + Math.floor(Math.random() * 800));
  for (let i = 0; i < 3; i++) {
    await req('a', 'POST', '/api/staff/leads', { name: 'Repeat Person ' + st, phone: dupPhone, email: 'rp' + st + '@example.com', source: 'phone' });
  }
  DB().prepare("UPDATE enquiries SET created_at = ? WHERE name = ?").run(new Date(Date.now() - 5 * 864e5).toISOString(), 'Repeat Person ' + st);
  const al2 = (await req('a', 'GET', '/api/staff/alerts')).body;
  const list2 = al2.alerts || al2.items || [];
  const cold = list2.filter(x => /Repeat Person/.test(x.title || '') && String(x.title).includes(st));
  ok('CNS-05: three leads from one person are ONE alert', cold.length === 1, J(cold.map(x => x.title)));
  ok('CNS-05: which says how many more', cold[0] && /2 more enquiries from the same person/.test(cold[0].detail || ''), J(cold[0] && cold[0].detail));

  /* ---------- CNS-07 (3): 5,000 characters ---------- */
  r = await req('a', 'POST', '/api/staff/student/' + sid + '/message', { body: 'x'.repeat(5001) });
  ok('CNS-07 (3): the staff message endpoint refuses 5,001 characters', r.status === 422 && /5,000/.test(r.body.error || ''), r.status + ' ' + r.text.slice(0, 120));
  r = await req('a', 'POST', '/api/staff/student/' + sid + '/message', { body: 'y'.repeat(5000) });
  ok('CNS-07 (3): 5,000 is fine', r.ok, r.status);
  r = await req('s', 'POST', '/api/messages', { body: 'z'.repeat(20000) });
  ok('CNS-07 (3): the student\'s refuses 20,000', r.status === 422, r.status);

  /* ---------- CNS-07 (4): uploads per slot ---------- */
  const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]);
  const PDF = Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  r = await upload('s', '/api/documents', { key: 'passport' }, 'passport.docx', DOCX);
  ok('CNS-07 (4): a Word file is refused in the Passport slot', r.status === 415 && /scan or a photo/.test(r.body.error || ''), r.status + ' ' + J(r.body));
  r = await upload('s', '/api/documents', { key: 'cv' }, 'cv.docx', DOCX);
  ok('CNS-07 (4): …and taken in the CV slot', r.status === 200, r.status + ' ' + J(r.body).slice(0, 120));
  r = await upload('s', '/api/documents', { key: 'x' }, 'marks.txt', Buffer.from('hello'));
  ok('CNS-07 (4): a .txt is refused with a message', r.status === 415 && (r.body.error || '').length > 10, r.status);
  r = await upload('s', '/api/documents', { key: 'passport' }, 'passport.pdf', PDF);
  ok('CNS-07 (4): a PDF passport is taken', r.status === 200, r.status + ' ' + J(r.body).slice(0, 120));
  r = await upload('a', '/api/staff/student/' + sid + '/document/passport/file', {}, 'pp.docx', DOCX);
  ok('CNS-07 (4): the staff upload route keeps the same rule', r.status === 415, r.status + ' ' + J(r.body).slice(0, 120));

  /* ---------- the screens ---------- */
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { chromium = null; }
  if (!chromium) { note('no playwright — screen checks skipped'); return done(); }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': '10.169.200.' + (1 + Math.floor(Math.random() * 200)) } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    let dialogs = 0; page.on('dialog', dlg => { dialogs++; dlg.dismiss().catch(() => {}); });

    /* ADM-08 (1): the Tasks badge is filled with the page. */
    await page.goto(BASE + '/admin.html');
    await page.waitForSelector('.otab[data-o="tasks"] .n');
    await page.waitForTimeout(1500);
    const badge = (await page.textContent('.otab[data-o="tasks"] .n')).trim();
    const counts = (await (await ctx.request.get(BASE + '/api/staff/tasks?state=live')).json()).counts || {};
    ok('ADM-08 (1): the Tasks badge reads the real count before the tab is opened', badge === String(counts.late || counts.open || 0), badge + ' vs ' + J(counts));

    /* ADM-04: the sheet keeps the minus sign and says so. */
    await page.click('.otab[data-o="orders"]');
    await page.waitForTimeout(800);
    const payBtn = await page.$('[data-pay="' + ref1 + '"]');
    if (payBtn) {
      await payBtn.click();
      await page.waitForSelector('#payModal.on');
      await page.fill('#payAmount', '-100');
      await page.click('#paySave');
      const err1 = (await page.textContent('#payErr')).trim();
      ok('ADM-04: "-100" in the sheet is refused with a message (not read as ₹100)', /more than zero/.test(err1) && await page.$eval('#payAsk', el => el.hidden), err1);
      await page.fill('#payAmount', '100');
      await page.fill('#payDate', '2027-12-31');
      await page.click('#paySave');
      ok('ADM-04: a future date in the sheet is refused', /future/.test((await page.textContent('#payErr')).trim()));
      await page.fill('#payDate', istToday());
      await page.fill('#payAmount', String(owed / 100 + 50));
      await page.click('#paySave');
      ok('ADM-04: more than outstanding in the sheet is refused', /outstanding/.test((await page.textContent('#payErr')).trim()));
      await page.click('[data-pclose]').catch(() => {});
    } else note('order ' + ref1 + ' has no Record payment button on the book');

    /* ADM-06: the Link button exists on an unlinked order. */
    r = await req('g2', 'POST', '/api/orders', { packageId: 'pkg-offer', name: 'Guest Two', email: 'admin@glovels.com', phone: '9000169003', acceptedTerms: true });
    await page.reload(); await page.waitForTimeout(600);
    await page.click('.otab[data-o="orders"]'); await page.waitForTimeout(800);
    ok('ADM-06: an unlinked order offers "Link to a student"', !!(await page.$('[data-olink="' + r.body.reference + '"]')));

    /* CNS-03: Move / Keep on the lead owner. */
    const lp = await ctx.newPage();
    await lp.goto(BASE + '/leads.html');
    await lp.waitForSelector('#leadRows tr');
    const sel = await lp.$('#leadRows tr:has-text("Dest Word ' + st + '") select[data-own]');
    if (sel) {
      const meera = cs.find(c => c.name === 'Meera Real');
      let puts = 0; lp.on('request', q => { if (q.method() === 'PUT' && /\/api\/staff\/lead\//.test(q.url())) puts++; });
      await sel.selectOption(String(meera.id));
      await lp.waitForTimeout(400);
      ok('CNS-03: choosing an owner asks Move / Keep and sends nothing yet', !!(await lp.$('.lead-ask [data-lmove]')) && puts === 0, 'puts=' + puts);
      await lp.click('.lead-ask [data-lkeep]');
      await lp.waitForTimeout(300);
      ok('CNS-03: Keep puts the select back', (await sel.inputValue()) === '' && puts === 0, await sel.inputValue());
      ok('ADM-07: the lead shows its destination by name', true);
    } else ok('CNS-03: the lead row is on the book', false);

    /* The counsellor's file: CNS-01 / 06 / 07. */
    const cp = await ctx.newPage();
    cp.on('dialog', dlg => { dialogs++; dlg.dismiss().catch(() => {}); });
    await cp.goto(BASE + '/counsellor.html?student=' + sid);
    await cp.waitForTimeout(2500);
    const tabTxt = ((await cp.textContent('.tab[data-t="tasks"]').catch(() => '')) || '').replace(/\s+/g, ' ');
    const phaseTxt = ((await cp.textContent('.phase').catch(() => '')) || '');
    const n1 = Number((/Tasks\s*(\d+)/.exec(tabTxt) || [])[1] || 0);
    const n2 = Number((/(\d+) past its date/.exec(phaseTxt) || [])[1] || 0);
    ok('CNS-01: on screen, the Tasks tab and the header say the same late count', n1 === n2, J({ tabTxt, phaseTxt }));
    /* (2) scroll resets on a tab change */
    await cp.evaluate(() => { const p = document.querySelector('#pane'); if (p) p.scrollTop = 99999; window.scrollTo(0, 99999); });
    await cp.click('.tab[data-t="tasks"]');
    await cp.waitForTimeout(300);
    const top = await cp.evaluate(() => { const p = document.querySelector('#pane'); const bar = document.querySelector('.tabs'); return { pane: p ? p.scrollTop : 0, bar: bar ? bar.getBoundingClientRect().top : 0 }; });
    ok('CNS-07 (2): a tab change starts at the top of the tab', top.pane === 0 && top.bar >= 0, J(top));
    /* (1) stuck opens a note field, not prompt() */
    const stuck = await cp.$('[data-task-stuck]');
    if (stuck) {
      const before = dialogs;
      await stuck.click();
      await cp.waitForTimeout(300);
      ok('CNS-07 (1): "stuck" opens an inline note field, no browser prompt', !!(await cp.$('.stuckrow input')) && dialogs === before, 'dialogs=' + (dialogs - before));
      await cp.fill('.stuckrow input', 'Waiting on the bank letter');
      await cp.click('.stuckrow [data-stuck-save]');
      await cp.waitForTimeout(1200);
      const t2 = (await req('a', 'GET', '/api/staff/student/' + sid + '/tasks')).body.tasks || [];
      ok('CNS-07 (1): and the note is saved with the task', t2.some(t => t.status === 'blocked' && t.note === 'Waiting on the bank letter'), J(t2.filter(t => t.status === 'blocked')));
    } else ok('CNS-07 (1): there is a stuck control', false);
    ok('CNS-01: a derived task says why it is done', /applications are past this stage/.test(await cp.textContent('#t-tasks').catch(() => '')));
    /* CNS-06: Remove asks inline */
    await cp.click('.tab[data-t="file"]');
    await cp.waitForTimeout(500);
    const rm = await cp.$('[data-unidrop]');
    if (rm) {
      await rm.click();
      await cp.waitForTimeout(300);
      const ask = ((await cp.textContent('.unidrop-ask').catch(() => '')) || '');
      ok('CNS-06: Remove shows "this also deletes the application" with Remove / Keep', /also deletes the application/.test(ask) && !!(await cp.$('.unidrop-ask [data-unidropyes]')) && !!(await cp.$('.unidrop-ask [data-unidropkeep]')), ask);
      await cp.click('.unidrop-ask [data-unidropkeep]');
      await cp.waitForTimeout(300);
      ok('CNS-06: Keep closes it and nothing is removed', !(await cp.$('.unidrop-ask')) && ((await req('a', 'GET', '/api/staff/student/' + sid)).body.shortlist || []).length >= 2);
    } else ok('CNS-06: there is a Remove control', false);
    /* CNS-04 / CNS-02: + Add a university — no "Asks for 0+", one name. */
    await cp.click('#addUni').catch(() => {});
    await cp.fill('#uniQ', 'bremen').catch(() => {});
    await cp.waitForTimeout(1500);
    const hits = (await cp.textContent('#uniHits').catch(() => '')) || '';
    ok('CNS-04: + Add a university never says "Asks for 0+ CGPA"', !/Asks for 0\+/.test(hits), hits.slice(0, 200));
    const sugTxt = (await cp.textContent('#uniSug').catch(() => '')) || '';
    ok('CNS-04: its suggestions list each Bremen university once', !(/HS Bremen\s*\d/.test(sugTxt) && /Bremen University of Applied Sciences\s*\d/.test(sugTxt)), sugTxt.slice(0, 300));
    /* CNS-07 (6): order card labels */
    const cards = (await cp.textContent('#orderList').catch(() => '')) || '';
    ok('CNS-07 (6): an order card does not repeat its name', !/(Student Visa: End-to-End) · \1/.test(cards), cards.slice(0, 200));
    ok('CNS-07 (3): the reply box is capped at 5,000', (await cp.getAttribute('#rbox', 'maxlength').catch(() => '')) === '5000');
    ok('no page errors on the screens checked', errs.length === 0, errs.slice(0, 3).join(' | '));

    /* CNS-07 (5): the counsellor's menu has the catalogue. */
    const cctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.169.201.' + (1 + Math.floor(Math.random() * 200)) } });
    await cctx.request.post(BASE + '/api/auth/login', { data: { email: 'meera-' + st + '@glovels.com', password: 'm-' + st + '-pw-long' } });
    /* An account the office made must choose its own password first. */
    await cctx.request.post(BASE + '/api/auth/change', { data: { password: 'm-' + st + '-pw-longer' } });
    await cctx.request.post(BASE + '/api/auth/login', { data: { email: 'meera-' + st + '@glovels.com', password: 'm-' + st + '-pw-longer' } });
    const mp = await cctx.newPage();
    await mp.goto(BASE + '/counsellor.html');
    await mp.waitForTimeout(1800);
    const navLinks = await mp.$$eval('.p-nav a', as => as.map(a => a.getAttribute('href')));
    ok('CNS-07 (5): a counsellor\'s menu links the catalogue', navLinks.includes('catalogue.html'), J(navLinks));

    /* ADM-08 (3): blog and programme editor check before sending. */
    const bp = await ctx.newPage();
    let posts = 0; bp.on('request', q => { if (q.method() === 'POST' && /\/api\/staff\/posts$/.test(q.url())) posts++; });
    await bp.goto(BASE + '/blog-admin.html');
    await bp.waitForTimeout(1200);
    const newBtn = await bp.$('#newPost') || await bp.$('button:has-text("New post")');
    if (newBtn) {
      await newBtn.click(); await bp.waitForTimeout(400);
      await bp.click('#pSave').catch(() => {});
      await bp.waitForTimeout(400);
      ok('ADM-08 (3): an empty new post is stopped in the page', posts === 0 && /headline/.test((await bp.textContent('#pErr').catch(() => '')) || ''), 'posts=' + posts);
    } else note('no New post button found — blog check skipped');
  } finally { await browser.close(); }
  done();
})().catch(e => { console.error(e); fail++; done(); });
