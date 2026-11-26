/**
 * Patch 309: Finance — statements, matching, invoices, the year's books.
 *
 * Two bank statements are written as PDFs here (made-up money, the two
 * layouts Axis Bank hands out), uploaded, and worked through the way the
 * office would: a student's transfer matched to their order in two parts,
 * the rest named as salaries, rent, capital; invoices raised by a counsellor
 * in instalments; then the year has to add up, for India and — apart from
 * it — for Germany.
 *
 *   node financetest.js        (starts its own server on 8311)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8311);
const BASE = 'http://localhost:' + PORT;
const DIR = '/tmp/db-finance-' + PORT;
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; if (!c) console.log('  ✗ ' + n + (note == null ? '' : ' — ' + String(note).slice(0, 260))); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---- a PDF with words at places: one content stream a page, Helvetica, no compression ---- */
function pdf(pages) {
  const esc = t => String(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs = [];
  const add = body => { objs.push(body); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  const pagesId = objs.length + 1 + pages.length * 2;
  pages.forEach(items => {
    const stream = items.map(i => 'BT\n/F1 9 Tf\n1 0 0 1 ' + i[0] + ' ' + i[1] + ' Tm\n(' + esc(i[2]) + ')Tj\nET').join('\n');
    const c = add('<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream');
    kids.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 842 595] /Contents ' + c + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >> >> >>'));
  });
  add('<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>');
  const cat = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  let out = '%PDF-1.4\n';
  objs.forEach((b, i) => { out += (i + 1) + ' 0 obj\n' + b + '\nendobj\n'; });
  out += 'trailer\n<< /Root ' + cat + ' 0 R /Size ' + (objs.length + 1) + ' >>\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
const inr = n => 'INR ' + (n / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* The "Smart Statement Report" layout: the narration runs on BELOW the row. */
function smart(rows, opening) {
  const items = [[33, 470, 'Smart Statement Report'], [20, 439, 'TESTING CONSULTANTS PRIVATE LIMITED'],
    [20, 373, 'Statement of Account No - 900000000000001 for period (01/04/2026 to 30/04/2026)'], [27, 333, 'Opening Balance: ' + inr(opening)]];
  [[25, 'S. No.'], [114, 'Transaction Date'], [203, 'Value Date'], [292, 'Cheque Number'], [381, 'Transaction Particulars'], [470, 'Amount'], [560, 'Transaction Type'], [649, 'Balance'], [738, 'Branch Name']]
    .forEach(h => items.push([h[0], 303, h[1]]));
  let y = 286, bal = opening;
  rows.forEach((r, i) => {
    bal += r[2];
    items.push([25, y, String(i + 1)], [114, y, r[0]], [203, y, r[0]], [381, y, r[1][0]], [511, y, inr(Math.abs(r[2]))], [560, y, r[2] > 0 ? 'CR' : 'DR'], [684, y, inr(bal)], [738, y, 'HYDERABAD']);
    r[1].slice(1).forEach(more => { y -= 7; items.push([381, y, more]); });
    y -= 17;
  });
  items.push([27, y - 10, 'Total Transaction Amount ' + inr(1)], [27, y - 30, 'Closing Balance: ' + inr(bal)], [20, y - 50, 'Unless the constituent notifies the bank immediately of any discrepancy']);
  return pdf([items]);
}
/* The monthly statement layout: the narration starts ABOVE the dated line. */
function classic(rows, opening) {
  const plain = n => (n / 100).toFixed(2);
  const items = [[38, 773, 'TESTING CONSULTANTS PRIVATE LIMITED'], [82, 612, 'Statement of Axis Account No :900000000000002 for the period (From : 01-05-2026  To : 31-05-2026)']];
  [[40, 'Tran Date'], [92, 'Chq No'], [203, 'Particulars'], [339, 'Debit'], [400, 'Credit'], [473, 'Balance'], [538, 'Init.']].forEach(h => items.push([h[0], 591, h[1]]));
  items.push([541, 582, 'Br'], [132, 562, 'OPENING BALANCE'], [471, 562, '        ' + plain(opening)]);
  let y = 540, bal = opening;
  rows.forEach(r => {
    bal += r[2];
    const parts = r[1];
    parts.slice(0, -1).forEach((t, k) => items.push([132, y + 9 * (parts.length - 1 - k), t]));
    items.push([38.5, y, r[0]], [132, y, parts[parts.length - 1]], [r[2] < 0 ? 320 : 383, y, '       ' + plain(Math.abs(r[2]))], [474, y, '      ' + plain(bal)], [537, y, '1195']);
    y -= 9 * parts.length + 13;
  });
  items.push([132, y, 'TRANSACTION TOTAL'], [132, y - 20, 'CLOSING BALANCE'], [471, y - 20, '      ' + plain(bal)], [38, y - 40, 'Unless the constituent notifies the bank immediately']);
  return pdf([items]);
}

const jars = {};
async function req(who, method, p, body) {
  const h = { 'content-type': 'application/json' };
  if (jars[who]) h.cookie = jars[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jars[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) { j = { text }; }
  return { status: r.status, ok: r.ok, body: j };
}
async function upload(who, company, name, buf) {
  const fd = new FormData();
  fd.append('company', company);
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), name);
  const r = await fetch(BASE + '/api/staff/finance/statement', { method: 'POST', headers: { cookie: jars[who] }, body: fd });
  let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, body: j };
}
async function sendBill(who, fields, name, buf) {
  const fd = new FormData();
  Object.keys(fields).forEach(k => fd.append(k, String(fields[k])));
  fd.append('file', new Blob([buf]), name);
  const r = await fetch(BASE + '/api/staff/finance/bill', { method: 'POST', headers: { cookie: jars[who] }, body: fd });
  let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, body: j };
}

(async () => {
  /* ---- the reader, on its own ---- */
  const ST = require(path.join(ROOT, 'server', 'statement.js'));
  const rowsA = [
    ['02/04/2026', ['INITIAL FUNDING'], 5000000],
    ['05/04/2026', ['NEFT/SBIN526193280682/RO', 'HAN VERMA/STATE BANK', 'OF INDIA//fees'], 1200000],
    ['09/04/2026', ['UPI/P2A/455275050348/PRIYA', 'NAIR/Paymen/HDFC'], 1800000],
    ['10/04/2026', ['GST @18% on Monthly', 'Service Ch'], -1800],
    ['10/04/2026', ['Monthly Service Chrgs'], -10000],
    ['28/04/2026', ['INB/NEFT/AXOIC213695704', '88/SALARY APRIL/CANARA'], -4000000],
    ['29/04/2026', ['INB/IFT/OFFICE RENT APR'], -2360000],
    ['30/04/2026', ['NEFT/HDFC1234567890/NORTH', 'RIDGE UNIVERSITY/commission'], 5900000],
  ];
  const a = ST.read('april.pdf', smart(rowsA, 0));
  check('Smart layout: every line read', a.lines.length === rowsA.length, a.lines.length);
  check('Smart layout: account and period', a.account === '900000000000001' && a.from === '2026-04-01' && a.to === '2026-04-30', a.account + ' ' + a.from + ' ' + a.to);
  check('Smart layout: in and out by CR / DR', a.lines.every((l, i) => l.amount === rowsA[i][2]), a.lines.map(l => l.amount).join(','));
  check('Smart layout: a narration over three lines is put back together', a.lines[1].description === 'NEFT/SBIN526193280682/RO HAN VERMA/STATE BANK OF INDIA//fees', a.lines[1].description);
  check('Smart layout: the bank’s reference is picked out', a.lines[1].ref === 'SBIN526193280682' && a.lines[2].ref === '455275050348', a.lines[1].ref + ' ' + a.lines[2].ref);
  check('Smart layout: opening + lines = closing, no warning', a.opening === 0 && a.closing === rowsA.reduce((s, r) => s + r[2], 0) && a.warnings.length === 0, JSON.stringify(a.warnings));
  const rowsB = [
    ['03-05-2026', ['UPI/P2M/418558678517/Airtel Prepaid', 'Rechar/Paymen/Airtel Payments Bank'], -37900],
    ['05-05-2026', ['IMPS/P2A/418519562340/ROHAN VERMA/Remitter/', 'fees part two'], 600000],
    ['13-05-2026', ['POS/SRI RAJA', 'RAJESHWA/HYDERABAD/130524/11:03/4195', '11143865'], -48000],
    ['19-05-2026', ['SALARY MAY'], -4000000],
  ];
  const b = ST.read('may.pdf', classic(rowsB, 9000000));
  check('Monthly layout: every line read', b.lines.length === rowsB.length, b.lines.length);
  check('Monthly layout: debit and credit told apart', b.lines.every((l, i) => l.amount === rowsB[i][2]), b.lines.map(l => l.amount).join(','));
  check('Monthly layout: a number cut across two lines is whole again', b.lines[2].description.endsWith('/419511143865'), b.lines[2].description);
  check('Monthly layout: closing balance agrees', b.closing === 9000000 + rowsB.reduce((s, r) => s + r[2], 0) && b.warnings.length === 0, b.closing + ' ' + JSON.stringify(b.warnings));
  let threw = '';
  try { ST.read('x.pdf', Buffer.from('not a pdf')); } catch (e) { threw = e.message; }
  check('something that is not a PDF is refused in words', /not a PDF/.test(threw), threw);
  threw = ''; try { ST.read('x.pdf', pdf([[[40, 700, 'Hello there'], [40, 680, 'nothing like a statement']]])); } catch (e) { threw = e.message; }
  check('a PDF that is not a statement is refused in words', /not laid out like a statement/.test(threw), threw);
  const de = ST.read('k.csv', Buffer.from('Buchungstag;Verwendungszweck;Betrag;Saldo\n01.11.2026;"Miete, Büro";-1.200,00;8.800,00\n03.11.2026;Rechnung GDE-2026-0001;2.380,00;11.180,00\n'), { decimal: ',' });
  check('a German CSV: semicolons, 1.234,56', de.lines.length === 2 && de.lines[0].amount === -120000 && de.lines[1].amount === 238000 && de.lines[0].date === '2026-11-01', JSON.stringify(de.lines));

  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off', BOTGATE: 'off' }) });
  try {
    for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* booting */ } }
    await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    const mk = async (who, name) => {
      const x = await req('a', 'POST', '/api/staff/people', { name, email: who + '@glv-sim.in', password: 'Office-12345!', role: 'student' });
      return x.body.person.id;
    };
    const rohan = await mk('fin1', 'Rohan Verma');
    const priya = await mk('fin2', 'Priya Nair');
    const mkOrder = async (id, rupees) => (await req('a', 'POST', '/api/staff/student/' + id + '/order', { services: [{ id: 'insure', priceInr: rupees }], note: 'finance test', residence: 'IN' })).body.order;
    const base = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.students;   /* the demo data's own orders */
    const oR = await mkOrder(rohan, 30000), oP = await mkOrder(priya, 18000);
    check('setup: two students each owe on an order', oR && oP && oR.reference && oP.reference, JSON.stringify(oR).slice(0, 120));

    /* ---- who may ---- */
    await req('c', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
    check('Finance needs a sign-in', (await req('x', 'GET', '/api/staff/finance/books?company=IN')).status === 401);
    check('a counsellor is refused the books', (await req('c', 'GET', '/api/staff/finance/books?company=IN')).status === 403);
    check('…and the statement lines', (await req('c', 'GET', '/api/staff/finance/lines?company=IN')).status === 403);
    check('the page itself is served', (await fetch(BASE + '/finance')).status === 200);
    check('a company has to be named', (await req('a', 'GET', '/api/staff/finance/lines')).status === 422);

    /* ---- upload ---- */
    let u = await upload('a', 'IN', 'april.pdf', smart(rowsA, 0));
    check('the April statement goes in', u.status === 200 && u.body.lines === 8 && u.body.added === 8, JSON.stringify(u.body).slice(0, 200));
    u = await upload('a', 'IN', 'april.pdf', smart(rowsA, 0));
    check('the same statement again adds nothing', u.status === 200 && u.body.added === 0 && u.body.already === 8, JSON.stringify(u.body).slice(0, 160));
    u = await upload('a', 'IN', 'may.pdf', classic(rowsB, 9000000));
    check('the May statement (the other layout) goes in', u.status === 200 && u.body.added === 4, JSON.stringify(u.body).slice(0, 200));
    u = await upload('a', 'IN', 'notes.pdf', pdf([[[40, 700, 'Hello']]]));
    check('a PDF that is not a statement is refused, in words', u.status === 422 && /statement/.test(u.body.error || ''), u.status + ' ' + (u.body.error || ''));
    let L = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.lines;
    check('twelve lines on India’s book', L.length === 12, L.length);
    const AC = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.accounts;
    check('two bank accounts on the one book, each with its own lines and period', AC.length === 2 && AC[0].account === '900000000000001' && AC[0].lines === 8 && AC[1].account === '900000000000002' && AC[1].lines === 4 && AC[1].from === '2026-05-03', JSON.stringify(AC));
    check('one account can be looked at alone', (await req('a', 'GET', '/api/staff/finance/lines?company=IN&account=900000000000002')).body.lines.length === 4);
    check('none on Germany’s', (await req('a', 'GET', '/api/staff/finance/lines?company=DE')).body.lines.length === 0);
    const line = re => L.find(l => re.test(l.description));
    check('a first guess is offered for the bank’s charges, not applied', line(/Monthly Service Chrgs/).guess === 'bank-charges' && line(/Monthly Service Chrgs/).category === '');

    /* ---- money in → the student's order, in two parts across two statements ---- */
    const l1 = line(/SBIN526193280682/), l2 = line(/418519562340/), l3 = line(/455275050348/);
    let cand = (await req('a', 'GET', '/api/staff/finance/line/' + l1.id + '/candidates?company=IN')).body;
    check('the likely order is offered first, by the name in the bank’s words', cand.orders[0] && cand.orders[0].ref === oR.reference, JSON.stringify((cand.orders || []).map(o => o.ref + ':' + o.score)));
    let m = await req('a', 'POST', '/api/staff/finance/line/' + l1.id + '/match', { company: 'IN', targets: [{ type: 'order', ref: oR.reference, amount: 1200000 }] });
    check('₹12,000 from the bank is matched to Rohan’s order', m.status === 200 && m.body.line.state === 'matched', m.status + ' ' + JSON.stringify(m.body).slice(0, 160));
    let ord = (await req('a', 'GET', '/api/staff/order/' + oR.reference)).body;
    check('…and that RECORDED the payment: ₹18,000 still owed', ord.order && ord.order.outstandingPaise === 1800000 && ord.payments.length === 1, JSON.stringify(ord.order && { o: ord.order.outstandingPaise, n: ord.payments.length }));
    check('…dated the day it reached the bank, with the bank’s reference', ord.payments[0] && String(ord.payments[0].at).slice(0, 10) === '2026-04-05' && /SBIN526193280682/.test(ord.payments[0].ref || ord.payments[0].reference || ''), JSON.stringify(ord.payments[0]));
    m = await req('a', 'POST', '/api/staff/finance/line/' + l1.id + '/match', { company: 'IN', targets: [{ type: 'order', ref: oR.reference, amount: 100 }] });
    check('a line already used up cannot be matched again', m.status === 422, m.status);
    m = await req('a', 'POST', '/api/staff/finance/line/' + l2.id + '/match', { company: 'IN', targets: [{ type: 'order', ref: oR.reference, amount: 600000 }] });
    ord = (await req('a', 'GET', '/api/staff/order/' + oR.reference)).body;
    check('a second payment, from the next statement: ₹12,000 still owed', m.status === 200 && ord.order.outstandingPaise === 1200000 && ord.payments.length === 2, m.status + ' ' + (ord.order && ord.order.outstandingPaise));
    m = await req('a', 'POST', '/api/staff/finance/line/' + l3.id + '/match', { company: 'IN', targets: [{ type: 'order', ref: oP.reference, amount: 9900000 }] });
    check('more than the order owes is refused', m.status === 422 && /outstanding/.test(m.body.error || ''), m.status + ' ' + m.body.error);
    m = await req('a', 'POST', '/api/staff/finance/line/' + l3.id + '/match', { company: 'IN', targets: [{ type: 'order', ref: oP.reference, amount: 1800000 }, { type: 'order', ref: oR.reference, amount: 100000 }] });
    check('more than the line holds is refused, and nothing is recorded', m.status === 422 && (await req('a', 'GET', '/api/staff/order/' + oP.reference)).body.payments.length === 0, m.status + ' ' + m.body.error);
    m = await req('a', 'POST', '/api/staff/finance/line/' + l3.id + '/match', { company: 'IN', targets: [{ type: 'order', ref: oP.reference, amount: 1500000 }, { type: 'order', ref: oR.reference, amount: 300000 }] });
    check('one bank line split across two students', m.status === 200 && m.body.line.state === 'matched' && m.body.line.links.length === 2, m.status + ' ' + JSON.stringify(m.body).slice(0, 200));
    check('…each order moved by its share', (await req('a', 'GET', '/api/staff/order/' + oP.reference)).body.order.outstandingPaise === 300000 && (await req('a', 'GET', '/api/staff/order/' + oR.reference)).body.order.outstandingPaise === 900000);
    const linkId = m.body.line.links[0].id;

    /* ---- a payment typed in on the order, reconciled to its bank line afterwards ---- */
    const typed = await req('a', 'POST', '/api/staff/order/' + oP.reference + '/payment', { amount: 3000, method: 'cash', date: '2026-04-20' });
    check('setup: a cash payment typed on the order', typed.status === 200, typed.status);
    let rec = (await req('a', 'GET', '/api/staff/finance/reconciliation?company=IN')).body;
    check('reconciliation: 5 payments on the books, 4 claimed by the bank, 1 not', rec.payments.total === 5 && rec.payments.matched === 4 && rec.payments.unmatched.length === 1 && rec.payments.unmatched[0].amount === 300000, JSON.stringify(rec.payments).slice(0, 220));
    check('…and the bank money nobody has claimed is listed', rec.bank.unmatched.some(x => /INITIAL FUNDING/.test(x.description)) && !rec.bank.unmatched.some(x => x.id === l1.id));

    /* ---- naming the rest ---- */
    const name = (re, body) => req('a', 'PUT', '/api/staff/finance/line/' + line(re).id, Object.assign({ company: 'IN' }, body));
    check('capital is named', (await name(/INITIAL FUNDING/, { category: 'capital' })).body.line.state === 'named');
    check('salaries, twice', (await name(/SALARY APRIL/, { category: 'salaries', party: 'Team' })).status === 200 && (await name(/SALARY MAY/, { category: 'salaries', party: 'Team' })).status === 200);
    check('rent, with 18% GST the landlord charged', (await name(/OFFICE RENT/, { category: 'rent', party: 'Landlord', taxRate: 18 })).body.line.taxRate === 18);
    check('bank charges', (await name(/Monthly Service Chrgs/, { category: 'bank-charges' })).status === 200 && (await name(/GST @18%/, { category: 'bank-charges' })).status === 200);
    check('a kind for money out is refused on money in', (await name(/NORTH RIDGE/, { category: 'salaries' })).status === 422);
    check('a tax rate this country does not have is refused', (await name(/Airtel/, { category: 'office', taxRate: 19 })).status === 422);
    check('a matched line cannot also be named', (await req('a', 'PUT', '/api/staff/finance/line/' + l1.id, { company: 'IN', category: 'other-income' })).status === 409);
    check('the wrong company cannot touch the line', (await req('a', 'PUT', '/api/staff/finance/line/' + line(/Airtel/).id, { company: 'DE', category: 'office' })).status === 404);
    await name(/Airtel/, { category: 'office' }); await name(/RAJESHWA/, { category: 'office' });

    /* ---- invoices: a counsellor raises several for one order ---- */
    await req('a', 'PUT', '/api/staff/student/' + rohan + '/assign', { counsellorId: null }).catch(() => {});
    let iv = await req('a', 'POST', '/api/staff/student/' + rohan + '/invoice', { orderRef: oR.reference, amount: 1200000 });
    check('a first invoice for part of the order (₹12,000 of ₹30,000)', iv.status === 200 && iv.body.invoice.gross === 1200000 && iv.body.invoice.number === 'GCPL/26-27/0001', iv.status + ' ' + JSON.stringify(iv.body).slice(0, 200));
    check('…with 18% GST worked out of it', iv.body.invoice.tax === Math.round(1200000 - 1200000 / 1.18) && iv.body.invoice.net + iv.body.invoice.tax === 1200000, iv.body.invoice.tax);
    const iv2 = await req('a', 'POST', '/api/staff/student/' + rohan + '/invoice', { orderRef: oR.reference, amount: 1000000 });
    const iv3 = await req('a', 'POST', '/api/staff/student/' + rohan + '/invoice', { orderRef: oR.reference });
    check('a second, and a third for all that is left (₹8,000)', iv2.status === 200 && iv3.status === 200 && iv3.body.invoice.gross === 800000 && iv3.body.invoice.number === 'GCPL/26-27/0003', iv3.status + ' ' + JSON.stringify(iv3.body.invoice || iv3.body).slice(0, 120));
    const iv4 = await req('a', 'POST', '/api/staff/student/' + rohan + '/invoice', { orderRef: oR.reference, amount: 100 });
    check('a fourth is refused: the order is invoiced in full', iv4.status === 409, iv4.status + ' ' + iv4.body.error);
    let mine = (await req('a', 'GET', '/api/staff/student/' + rohan + '/invoices')).body;
    const st = n => (mine.invoices.find(i => i.number === 'GCPL/26-27/000' + n) || {}).state;
    check('what Rohan has paid (₹21,000) settles them oldest first: paid, part, unpaid', st(1) === 'paid' && st(2) === 'part' && st(3) === 'unpaid', [st(1), st(2), st(3)].join(','));
    check('…and nothing is left to invoice on that order', mine.orders[0].toInvoice === 0 && mine.orders[0].invoiced === 3000000);
    check('another student’s order cannot be invoiced from this file', (await req('a', 'POST', '/api/staff/student/' + rohan + '/invoice', { orderRef: oP.reference, amount: 100 })).status === 404);
    const pr = await fetch(BASE + '/api/staff/finance/invoice/' + iv.body.invoice.id + '/print', { headers: { cookie: jars.a } });
    const html = await pr.text();
    check('the invoice prints: number, name, total, GST line', pr.status === 200 && html.includes('GCPL/26-27/0001') && html.includes('Rohan Verma') && html.includes('12,000.00') && /GST 18%/.test(html), pr.status);
    check('a counsellor who cannot see the student cannot print it', [403, 404].includes((await fetch(BASE + '/api/staff/finance/invoice/' + iv.body.invoice.id + '/print', { headers: { cookie: jars.c } })).status));

    /* ---- an invoice to a university, paid by a bank line ---- */
    const pi = await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'partner', party: 'North Ridge University', taxRate: 0, items: [{ text: 'Commission, spring intake', amount: 5900000 }] });
    check('an invoice to a university at 0%', pi.status === 200 && pi.body.invoice.tax === 0 && pi.body.invoice.number === 'GCPL/26-27/0004', pi.status + ' ' + JSON.stringify(pi.body).slice(0, 160));
    check('a rate that is not this country’s is refused', (await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'manual', party: 'X', taxRate: 19, items: [{ text: 'x', amount: 100 }] })).status === 422);
    const uni = line(/NORTH RIDGE/);
    cand = (await req('a', 'GET', '/api/staff/finance/line/' + uni.id + '/candidates?company=IN')).body;
    check('the invoice is offered for the university’s transfer', cand.invoices[0] && cand.invoices[0].id === pi.body.invoice.id);
    m = await req('a', 'POST', '/api/staff/finance/line/' + uni.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: pi.body.invoice.id, amount: 5900000 }] });
    const paid = (await req('a', 'GET', '/api/staff/finance/invoices?company=IN')).body.invoices.find(i => i.id === pi.body.invoice.id);
    check('matched, and the invoice reads paid', m.status === 200 && paid.state === 'paid' && paid.outstanding === 0, m.status + ' ' + paid.state);
    check('an invoice with money on it cannot be cancelled', (await req('a', 'POST', '/api/staff/finance/invoice/' + pi.body.invoice.id + '/cancel', { company: 'IN' })).status === 409);
    const un = await req('a', 'DELETE', '/api/staff/finance/line/' + uni.id + '/match/' + m.body.line.links[0].id + '?company=IN');
    check('an invoice match can be taken off and put back', un.status === 200 && un.body.line.state === 'open' && (await req('a', 'POST', '/api/staff/finance/line/' + uni.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: pi.body.invoice.id, amount: 5900000 }] })).status === 200);

    /* ---- the year ---- */
    const B = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body;
    const gst = n => Math.round(n - n / 1.18);
    const studentIn = 1200000 + 600000 + 1800000;                       /* matched bank money from students */
    /* Patch 313: the ₹3,000 typed on the order as cash, which no bank line has claimed, is a cash sale too */
    const wantSales = studentIn - gst(1200000) - gst(600000) - gst(1500000) - gst(300000) + 5900000 + 300000 - gst(300000);
    const rentNet = 2360000 - gst(2360000);
    const wantCosts = 4000000 + 4000000 + rentNet + 10000 + 1800 + 37900 + 48000;
    check('the screen is given the list of kinds to choose from, apart from the year\u2019s totals by kind', Array.isArray(B.kindList) && B.kindList.some(k => k.id === 'salaries' && k.dir === 'out') && B.kindList.some(k => k.id === 'capital' && k.dir === 'in') && B.kinds.some(k => k.category === 'salaries' && k.amount === 8000000), JSON.stringify((B.kinds || []).slice(0, 2)));
    check('the Indian year is April to March', B.yearLabel === '2026–27' && B.from === '2026-04-01' && B.to === '2027-03-31' && B.months.length === 12, B.yearLabel + ' ' + B.from);
    check('sales: money matched to students and invoices, before GST', B.totals.sales === wantSales, B.totals.sales + ' / ' + wantSales);
    check('costs: everything named as an expense, before the GST on the rent', B.totals.costs === wantCosts, B.totals.costs + ' / ' + wantCosts);
    check('people and office are kept apart', B.totals.people === 8000000 && B.totals.office === wantCosts - 8000000, B.totals.people + ' ' + B.totals.office);
    check('profit is sales less costs; capital is in neither', B.totals.profit === wantSales - wantCosts && B.totals.otherIncome === 0, B.totals.profit);
    check('GST: collected, less what the landlord charged, is what is owed', B.totals.salesTax === gst(1200000) + gst(600000) + gst(1500000) + gst(300000) + gst(300000) && B.totals.costsTax === gst(2360000) && B.totals.taxOwed === B.totals.salesTax - B.totals.costsTax, JSON.stringify([B.totals.salesTax, B.totals.costsTax, B.totals.taxOwed]));
    check('by month: April and May carry it, and add up to the year', B.months[0].month === '2026-04' && B.months.reduce((s, x) => s + x.profit, 0) === B.totals.profit && B.months[1].people === 4000000);
    check('the sales book lists five bank receipts and the cash one, the purchases book seven', B.sales.length === 6 && B.sales.filter(x => x.kind === 'cash').length === 1 && B.purchases.length === 7, B.sales.length + ' ' + B.purchases.length);
    check('nothing is left to sort', B.todo.lines === 0, JSON.stringify(B.todo));
    check('still owed by students: ₹9,000 on one order', B.owed.students === 900000 && B.owed.nStudents === 1, JSON.stringify(B.owed));
    const SR = name => B.students.rows.find(r => r.name === name) || {};
    check('students in all: to receive = received + pending, and \u20b99,000 is pending', B.students.agreed === B.students.received + B.students.pending && B.students.pending === 900000 && B.students.agreed - base.agreed === 4800000 && B.students.received - base.received === 3900000, JSON.stringify({ a: B.students.agreed, r: B.students.received, p: B.students.pending, base }));
    check('Rohan: \u20b930,000 to receive, \u20b921,000 received, \u20b99,000 pending, all invoiced', SR('Rohan Verma').agreed === 3000000 && SR('Rohan Verma').received === 2100000 && SR('Rohan Verma').pending === 900000 && SR('Rohan Verma').invoiced === 3000000 && SR('Rohan Verma').studentId === rohan, JSON.stringify(SR('Rohan Verma')));
    check('…all \u20b921,000 of it found on the bank statements', SR('Rohan Verma').inBank === 2100000 && SR('Rohan Verma').cash === 0 && SR('Rohan Verma').notInBank === 0 && SR('Rohan Verma').lastPaid === '2026-05-05', JSON.stringify(SR('Rohan Verma')));
    check('Priya: paid in full, \u20b915,000 through the bank and \u20b93,000 in cash', SR('Priya Nair').pending === 0 && SR('Priya Nair').received === 1800000 && SR('Priya Nair').inBank === 1500000 && SR('Priya Nair').cash === 300000 && SR('Priya Nair').notInBank === 0, JSON.stringify(SR('Priya Nair')));
    check('the company\u2019s split adds up to what was received', B.students.inBank + B.students.cash + B.students.notInBank === B.students.received && B.students.cash - base.cash === 300000, JSON.stringify([B.students.inBank, B.students.cash, B.students.notInBank, B.students.received]));
    check('who owes is listed first', B.students.rows[0].name === 'Rohan Verma' && B.students.nPending === 1);
    /* a due date: from an invoice with one, while money is still owed */
    const oD = await mkOrder(priya, 5000);
    await req('a', 'POST', '/api/staff/student/' + priya + '/invoice', { orderRef: oD.reference, amount: 200000, due: '2026-01-15' });
    await req('a', 'POST', '/api/staff/order/' + oD.reference + '/payment', { amount: 500, method: 'bank', date: '2026-04-21', reference: 'NEFT-TYPED-1' });
    const B2 = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body;
    const dRow = B2.students.rows.find(r => r.ref === oD.reference) || {};
    check('a due date that has passed shows as overdue, with what was due then', dRow.due === '2026-01-15' && dRow.overdue === true && dRow.dueAmount === 150000 && B2.students.nOverdue === 1 && B2.students.overdue === 150000 && B2.students.rows[0].ref === oD.reference, JSON.stringify(dRow));
    check('a transfer typed in and not yet found on a statement says so', dRow.notInBank === 50000 && dRow.inBank === 0 && dRow.cash === 0, JSON.stringify(dRow));
    const B25 = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2025')).body;
    check('another year is empty', B25.totals.sales === 0 && B25.totals.costs === 0 && B25.sales.length === 0);

    /* ---- Germany, apart ---- */
    const D0 = (await req('a', 'GET', '/api/staff/finance/books?company=DE&year=2026')).body;
    check('Germany has its own book, in euros, January to December, VAT 19 or 0', D0.currency === 'EUR' && D0.tax === 'VAT' && D0.rates.join() === '19,0' && D0.from === '2026-01-01' && D0.totals.sales === 0 && D0.statement.lines === 0, JSON.stringify([D0.currency, D0.from, D0.totals.sales]));
    const di = await req('a', 'POST', '/api/staff/finance/invoice', { company: 'DE', kind: 'manual', party: 'Hochschule Beispiel', taxRate: 19, items: [{ text: 'Beratung', amount: 119000 }] });
    check('a German invoice at 19%: its own number series, €1,000 + €190', di.status === 200 && di.body.invoice.number === 'GDE-2026-0001' && di.body.invoice.net === 100000 && di.body.invoice.tax === 19000, JSON.stringify(di.body).slice(0, 200));
    check('India does not list it', !(await req('a', 'GET', '/api/staff/finance/invoices?company=IN')).body.invoices.some(i => i.number === 'GDE-2026-0001'));
    check('a German bank line cannot be matched to an Indian order', await (async () => {
      const csv = 'Buchungstag;Verwendungszweck;Betrag;Saldo\n03.11.2026;Rechnung GDE-2026-0001 Hochschule Beispiel;1.190,00;1.190,00\n04.11.2026;Miete;-500,00;690,00\n';
      const fd = new FormData(); fd.append('company', 'DE'); fd.append('file', new Blob([csv], { type: 'text/csv' }), 'konto.csv');
      const up = await (await fetch(BASE + '/api/staff/finance/statement', { method: 'POST', headers: { cookie: jars.a }, body: fd })).json();
      const dl = (await req('a', 'GET', '/api/staff/finance/lines?company=DE')).body.lines;
      const inn = dl.find(x => x.amount > 0);
      const wrong = await req('a', 'POST', '/api/staff/finance/line/' + inn.id + '/match', { company: 'DE', targets: [{ type: 'order', ref: oR.reference, amount: 1000 }] });
      const right = await req('a', 'POST', '/api/staff/finance/line/' + inn.id + '/match', { company: 'DE', targets: [{ type: 'invoice', id: di.body.invoice.id, amount: 119000 }] });
      await req('a', 'PUT', '/api/staff/finance/line/' + dl.find(x => x.amount < 0).id, { company: 'DE', category: 'rent', taxRate: 19 });
      return up.added === 2 && wrong.status === 422 && right.status === 200;
    })());
    const D = (await req('a', 'GET', '/api/staff/finance/books?company=DE&year=2026')).body;
    check('Germany has no student orders and shows none of India\u2019s', D.students.orders === 0 && D.students.agreed === 0 && D.students.rows.length === 0);
    check('Germany’s year: €1,000 sales, VAT €190 collected, rent before VAT', D.totals.sales === 100000 && D.totals.salesTax === 19000 && D.totals.costs === 50000 - Math.round(50000 - 50000 / 1.19), JSON.stringify(D.totals));
    check('…and India’s year did not move', (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.totals.profit === B.totals.profit);

    /* ---- the company's own details ---- */
    const sv = await req('a', 'PUT', '/api/staff/finance/settings', { company: 'DE', name: 'Glovels Test UG', address: 'Musterstr. 1\n80331 München', taxId: 'DE123456789', series: 'GT-', next: 50 });
    check('Germany’s details are saved', sv.status === 200 && sv.body.settings.series === 'GT-' && sv.body.settings.next === 50, JSON.stringify(sv.body).slice(0, 160));
    const dn = await req('a', 'POST', '/api/staff/finance/invoice', { company: 'DE', kind: 'manual', party: 'Global Client Ltd', taxRate: 0, items: [{ text: 'Advisory', amount: 50000 }] });
    check('the next German invoice takes the new series and number, at 0% VAT', dn.status === 200 && dn.body.invoice.number === 'GT-0050' && dn.body.invoice.tax === 0, JSON.stringify(dn.body).slice(0, 160));
    check('India’s numbering is untouched', (await req('a', 'GET', '/api/staff/finance/books?company=IN')).body.settings.next === 6);
    check('a number is never given out twice: the counter cannot be set back', (await req('a', 'PUT', '/api/staff/finance/settings', { company: 'DE', next: 1 })).body.settings.next === 51);

    /* ---- Patch 311 (owner, 26 Nov): invoice any student, pay an invoice from a bank line or in cash,
            edit, take off, and remove a statement uploaded by mistake ---- */
    const anita = await mk('fin3', 'Anita Rao'), kiran = await mk('fin4', 'Kiran Das');
    check('the list of students to invoice is for administrators', (await req('c', 'GET', '/api/staff/finance/students')).status === 403 && (await req('a', 'GET', '/api/staff/finance/students')).body.students.some(x => x.name === 'Anita Rao'));
    let a1 = await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'student', studentId: anita, amount: 2000000, text: 'Germany admission — first instalment', taxRate: 18, due: '2026-01-10' });
    check('a student with no order is invoiced for an amount', a1.status === 200 && a1.body.invoice.gross === 2000000 && a1.body.invoice.studentId === anita && !a1.body.invoice.orderRef && a1.body.invoice.tax === 305085 && a1.body.invoice.party === 'Anita Rao', a1.status + ' ' + JSON.stringify(a1.body).slice(0, 240));
    let a2 = await req('a', 'POST', '/api/staff/student/' + anita + '/invoice', { amount: 1000000, text: 'Second instalment', taxRate: 0 });
    check('…and again from their file, a second instalment, at 0%', a2.status === 200 && a2.body.invoice.gross === 1000000 && a2.body.invoice.tax === 0 && a2.body.invoices.length === 2, a2.status + ' ' + JSON.stringify(a2.body).slice(0, 200));
    check('an invoice with no amount is refused', (await req('a', 'POST', '/api/staff/student/' + anita + '/invoice', { text: 'x' })).status === 422);
    let ed = await req('a', 'PUT', '/api/staff/finance/invoice/' + a2.body.invoice.id, { company: 'IN', amount: 800000, due: '2026-12-31', text: 'Second instalment (revised)' });
    check('an unpaid invoice is edited: amount, due date and wording; the number stays', ed.status === 200 && ed.body.invoice.gross === 800000 && ed.body.invoice.due === '2026-12-31' && ed.body.invoice.number === a2.body.invoice.number && ed.body.invoice.items[0].text === 'Second instalment (revised)', ed.status + ' ' + JSON.stringify(ed.body).slice(0, 200));
    const rowsC = [['05/04/2026', ['UPI/ANITA RAO/fees'], 1200000], ['06/04/2026', ['NEFT/KIRAN DAS/fees'], 500000], ['07/04/2026', ['ATM CHARGES'], -100]];
    const upC = await upload('a', 'IN', 'extra.pdf', smart(rowsC, 0));
    check('a third statement is taken in', upC.status === 200 && upC.body.added === 3, upC.status + ' ' + JSON.stringify(upC.body).slice(0, 160));
    const LC = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body;
    const lA = LC.lines.find(x => /ANITA/.test(x.description)), lK = LC.lines.find(x => /KIRAN/.test(x.description));
    const cand3 = (await req('a', 'GET', '/api/staff/finance/line/' + lA.id + '/candidates?company=IN')).body;
    check('her invoice is offered for her bank line, first', cand3.invoices.length && cand3.invoices[0].id === a1.body.invoice.id, JSON.stringify(cand3.invoices.slice(0, 2)).slice(0, 200));
    m = await req('a', 'POST', '/api/staff/finance/line/' + lA.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: a1.body.invoice.id, amount: 1200000 }] });
    check('the bank line pays part of the invoice', m.status === 200 && m.body.line.state === 'matched', m.status + ' ' + JSON.stringify(m.body).slice(0, 160));
    let cs = await req('a', 'POST', '/api/staff/finance/invoice/' + a1.body.invoice.id + '/cash', { company: 'IN', amount: 300000 });
    check('cash is added on the same invoice', cs.status === 200 && cs.body.invoice.paid === 1500000 && cs.body.invoice.cash === 300000 && cs.body.invoice.outstanding === 500000, cs.status + ' ' + JSON.stringify(cs.body).slice(0, 200));
    check('more cash than is unpaid is refused', (await req('a', 'POST', '/api/staff/finance/invoice/' + a1.body.invoice.id + '/cash', { company: 'IN', amount: 600000 })).status === 422);
    check('its amount can no longer be changed, its due date can', (await req('a', 'PUT', '/api/staff/finance/invoice/' + a1.body.invoice.id, { company: 'IN', amount: 100 })).status === 409 && (await req('a', 'PUT', '/api/staff/finance/invoice/' + a1.body.invoice.id, { company: 'IN', due: '2026-01-12' })).body.invoice.due === '2026-01-12');
    m = await req('a', 'POST', '/api/staff/finance/line/' + lK.id + '/match', { company: 'IN', targets: [{ type: 'student', studentId: kiran, amount: 500000, text: 'Visa file', taxRate: 18 }] });
    const kInv = (await req('a', 'GET', '/api/staff/student/' + kiran + '/invoices')).body.invoices;
    check('a bank line from a student with nothing on the books raises their invoice and pays it', m.status === 200 && m.body.line.state === 'matched' && kInv.length === 1 && kInv[0].gross === 500000 && kInv[0].state === 'paid' && kInv[0].date === '2026-04-06', m.status + ' ' + JSON.stringify(kInv).slice(0, 200));
    check('…a line to a student who is not one is refused', (await req('a', 'POST', '/api/staff/finance/line/' + lA.id + '/match', { company: 'IN', targets: [{ type: 'student', studentId: 999999, amount: 1 }] })).status === 404);
    let SB = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.students;
    const rA = SB.rows.find(r => r.name === 'Anita Rao'), rK = SB.rows.find(r => r.name === 'Kiran Das');
    check('Anita on the overview: ₹28,000 invoiced, ₹12,000 in the bank, ₹3,000 cash, ₹13,000 pending, overdue', rA && rA.agreed === 2800000 && rA.received === 1500000 && rA.inBank === 1200000 && rA.cash === 300000 && rA.pending === 1300000 && rA.overdue === true && rA.due === '2026-01-12', JSON.stringify(rA));
    check('Kiran: paid in full through the bank', rK && rK.pending === 0 && rK.inBank === 500000, JSON.stringify(rK));
    let RC = (await req('a', 'GET', '/api/staff/finance/reconciliation?company=IN')).body;
    const ri = RC.invoices.rows.find(r => r.id === a1.body.invoice.id);
    check('reconciliation shows the invoice: bank, cash and unpaid', ri && ri.bank === 1200000 && ri.cash === 300000 && ri.unpaid === 500000, JSON.stringify(ri));
    cs = await req('a', 'DELETE', '/api/staff/finance/invoice/' + a1.body.invoice.id + '/cash?company=IN');
    check('cash is taken off again', cs.status === 200 && cs.body.invoice.cash === 0 && cs.body.invoice.paid === 1200000, cs.status + ' ' + JSON.stringify(cs.body).slice(0, 160));

    /* a match to an order comes off; the payment it recorded stays on the order */
    const paysBefore = (await req('a', 'GET', '/api/staff/order/' + oP.reference)).body.payments.length;
    const unBefore = RC.payments.unmatched.length;
    m = await req('a', 'DELETE', '/api/staff/finance/line/' + l3.id + '/match/' + linkId + '?company=IN');
    RC = (await req('a', 'GET', '/api/staff/finance/reconciliation?company=IN')).body;
    check('a match to an order is taken off; the payment stays on the order and shows as not found in the bank', m.status === 200 && m.body.line.links.length === 1 && (await req('a', 'GET', '/api/staff/order/' + oP.reference)).body.payments.length === paysBefore && RC.payments.unmatched.length === unBefore + 1, m.status + ' ' + JSON.stringify(m.body).slice(0, 200));

    /* a statement uploaded by mistake */
    const BL = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.batches;
    const bC = BL.find(b => b.filename === 'extra.pdf');
    check('a counsellor cannot remove a statement', (await req('c', 'DELETE', '/api/staff/finance/statement/' + bC.id + '?company=IN')).status === 403);
    check('nor can it be removed from the other company’s book', (await req('a', 'DELETE', '/api/staff/finance/statement/' + bC.id + '?company=DE')).status === 404);
    const nBefore = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.lines.length;
    let rm = await req('a', 'DELETE', '/api/staff/finance/statement/' + bC.id + '?company=IN');
    const after = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body;
    check('the statement is removed with its three lines; the others stay', rm.status === 200 && rm.body.removed === 3 && after.lines.length === nBefore - 3 && !after.batches.some(b => b.id === bC.id), rm.status + ' ' + JSON.stringify(rm.body));
    const aAfter = (await req('a', 'GET', '/api/staff/student/' + anita + '/invoices')).body.invoices.find(i => i.id === a1.body.invoice.id);
    check('…and the invoice it had paid is unpaid again', aAfter.paid === 0 && aAfter.outstanding === 2000000, JSON.stringify(aAfter).slice(0, 200));
    let held = null;
    for (const b of after.batches) { const r = await req('a', 'DELETE', '/api/staff/finance/statement/' + b.id + '?company=IN&dry=1'); if (r.status === 409) { held = { b, r }; break; } if (r.status === 200) break; }
    check('a statement whose line recorded a payment on an order asks first', held && held.r.body.held >= 1 && /stay|leaves/i.test(held.r.body.error), JSON.stringify(held && held.r.body));
    if (held) {
      rm = await req('a', 'DELETE', '/api/staff/finance/statement/' + held.b.id + '?company=IN&force=1');
      check('…and is removed when told to; the payments stay on the orders', rm.status === 200 && rm.body.removed > 0 && (await req('a', 'GET', '/api/staff/order/' + oP.reference)).body.payments.length === paysBefore, rm.status + ' ' + JSON.stringify(rm.body));
    }
    const ST0 = (await req('a', 'GET', '/api/staff/finance/books?company=IN')).body.settings;
    check('the Indian company\u2019s name, address, GSTIN and CIN come from the site\u2019s legal details', ST0.name === 'Glovels Consultants Private Limited' && ST0.taxId === '36AALCG2793G1ZA' && /Madhapur/.test(ST0.address) && ST0.register === 'U85500TS2024PTC185996', JSON.stringify(ST0));
    const pr9 = await req('a', 'GET', '/api/staff/finance/invoice/' + a1.body.invoice.id + '/print');
    check('\u2026and are printed on the invoice', /GSTIN 36AALCG2793G1ZA/.test(pr9.body.text || '') && /CIN U85500TS2024PTC185996/.test(pr9.body.text || ''), String(pr9.body.text || '').slice(0, 120));
    const again = await upload('a', 'IN', 'extra.pdf', smart(rowsC, 0));
    check('a removed statement can be uploaded again', again.status === 200 && again.body.added === 3, again.status + ' ' + JSON.stringify(again.body).slice(0, 120));

    const past = await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'student', studentId: kiran, amount: 700000, text: 'Last year\u2019s fee', taxRate: 18, date: '2025-06-15' });
    check('an invoice of an earlier year is raised with its own date; a future date is refused', past.status === 200 && past.body.invoice.date === '2025-06-15' && (await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'student', studentId: kiran, amount: 100, date: '2099-01-01' })).status === 422, past.status + ' ' + JSON.stringify(past.body).slice(0, 160));
    /* ---- Patch 312 (owner, 26 Nov): the supplier's bill kept for a purchase ---- */
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    const PDFB = pdf([[[40, 700, 'Tax invoice: one office table']]]);
    const lATM = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.lines.find(x => /ATM CHARGES/.test(x.description));
    check('a counsellor cannot keep a bill', (await sendBill('c', { company: 'IN', lineId: lATM.id }, 'table.pdf', PDFB)).status === 403);
    let b1 = await sendBill('a', { company: 'IN', lineId: lATM.id }, 'table.pdf', PDFB);
    check('a bill is kept against the bank line that paid it; date and amount come from the line', b1.status === 200 && b1.body.bill.lineId === lATM.id && b1.body.bill.amount === 100 && b1.body.bill.date === '2026-04-07' && b1.body.bill.filename === 'table.pdf', b1.status + ' ' + JSON.stringify(b1.body));
    check('a web page is not a bill', (await sendBill('a', { company: 'IN', lineId: lATM.id }, 'bill.html', Buffer.from('<html><script>1</script></html>'))).status === 415);
    check('nor is a page renamed .pdf, or a PDF renamed .png', (await sendBill('a', { company: 'IN', lineId: lATM.id }, 'bill.pdf', Buffer.from('<html></html>'))).status === 415 && (await sendBill('a', { company: 'IN', lineId: lATM.id }, 'bill.png', PDFB)).status === 415);
    check('a bill is not kept against money coming in', (await sendBill('a', { company: 'IN', lineId: lA.id }, 'x.pdf', PDFB)).status !== 200);
    check('a bill with no bank line needs its date, who it is from and the amount', (await sendBill('a', { company: 'IN', party: 'Paradise', amount: 240000 }, 'lunch.png', PNG)).status === 422 && (await sendBill('a', { company: 'IN', date: '2026-04-09', amount: 240000 }, 'lunch.png', PNG)).status === 422 && (await sendBill('a', { company: 'IN', date: '2026-04-09', party: 'Paradise' }, 'lunch.png', PNG)).status === 422);
    const outKind = (await req('a', 'GET', '/api/staff/finance/books?company=IN')).body.kindList.find(k => k.dir === 'out').id;
    let b2 = await sendBill('a', { company: 'IN', date: '2026-04-09', party: 'Paradise Restaurant', amount: 240000, category: outKind, note: 'team lunch for 8' }, 'lunch.png', PNG);
    check('a cash bill (a team lunch) is kept on its own', b2.status === 200 && b2.body.bill.lineId === null && b2.body.bill.amount === 240000 && b2.body.bill.label, b2.status + ' ' + JSON.stringify(b2.body));
    let BLs = (await req('a', 'GET', '/api/staff/finance/bills?company=IN&year=2026')).body;
    check('both are listed: one beside its purchase, one on its own', (BLs.byLine[lATM.id] || []).length === 1 && BLs.loose.length === 1 && BLs.looseTotal === 240000 && BLs.count === 2, JSON.stringify(BLs).slice(0, 300));
    check('Germany’s book has none of them', (await req('a', 'GET', '/api/staff/finance/bills?company=DE&year=2026')).body.count === 0);
    const fr = await fetch(BASE + '/api/staff/finance/bill/' + b1.body.bill.id + '/file', { headers: { cookie: jars.a } });
    const fb = Buffer.from(await fr.arrayBuffer());
    check('the file comes back as it went in, as a PDF and nothing else', fr.status === 200 && fr.headers.get('content-type') === 'application/pdf' && fr.headers.get('x-content-type-options') === 'nosniff' && fb.equals(PDFB), fr.status + ' ' + fr.headers.get('content-type') + ' ' + fb.length);
    check('…and not for a counsellor', (await fetch(BASE + '/api/staff/finance/bill/' + b1.body.bill.id + '/file', { headers: { cookie: jars.c } })).status === 403);
    const be = await req('a', 'PUT', '/api/staff/finance/bill/' + b2.body.bill.id, { company: 'IN', note: 'team lunch for 9', amount: 250000 });
    check('a bill’s details are corrected', be.status === 200 && be.body.bill.note === 'team lunch for 9' && be.body.bill.amount === 250000, be.status + ' ' + JSON.stringify(be.body));
    const bd = await req('a', 'DELETE', '/api/staff/finance/bill/' + b2.body.bill.id + '?company=IN');
    check('a bill is removed, file and all', bd.status === 200 && (await fetch(BASE + '/api/staff/finance/bill/' + b2.body.bill.id + '/file', { headers: { cookie: jars.a } })).status === 404, bd.status + ' ' + JSON.stringify(bd.body));
    const bX = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.batches.find(b => b.filename === 'extra.pdf');
    await req('a', 'DELETE', '/api/staff/finance/statement/' + bX.id + '?company=IN&force=1');
    BLs = (await req('a', 'GET', '/api/staff/finance/bills?company=IN&year=2026')).body;
    check('removing a statement does not lose the bill kept on its line: it stands on its own', BLs.count === 1 && BLs.loose.length === 1 && BLs.loose[0].id === b1.body.bill.id && (await fetch(BASE + '/api/staff/finance/bill/' + b1.body.bill.id + '/file', { headers: { cookie: jars.a } })).status === 200, JSON.stringify(BLs).slice(0, 240));

    /* ---- Patch 313 (owner, 26 Nov): open an invoice with its receipts; matched lines can be found;
            the office's own names; a sale named without an invoice ---- */
    const upK = await upload('a', 'IN', 'kinds.pdf', smart([['11/04/2026', ['UPI/WALKIN/coaching'], 1180000], ['12/04/2026', ['POS/PARADISE RESTAURANT'], -240000], ['13/04/2026', ['UPI/ANITA RAO/second'], 800000]], 0));
    check('a statement for the next checks', upK.status === 200 && upK.body.added === 3, upK.status + ' ' + JSON.stringify(upK.body).slice(0, 120));
    const LK = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.lines;
    const lW = LK.find(x => /WALKIN/.test(x.description)), lP = LK.find(x => /PARADISE/.test(x.description)), lA2 = LK.find(x => /ANITA RAO\/second/.test(x.description));
    const before = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.totals;
    check('a counsellor cannot add a name', (await req('c', 'POST', '/api/staff/finance/kind', { label: 'Team lunch', dir: 'out', type: 'Office' })).status === 403);
    const k1 = await req('a', 'POST', '/api/staff/finance/kind', { label: 'Team lunch', dir: 'out', type: 'Office' });
    check('the office adds its own name for an expense', k1.status === 200 && /^x-team-lunch-/.test(k1.body.kind.id) && k1.body.kindList.some(k => k.id === k1.body.kind.id && k.custom && k.pl === 'cost' && k.group === 'Office'), k1.status + ' ' + JSON.stringify(k1.body.kind));
    check('the same name twice is refused; so is one with no name, or no direction', (await req('a', 'POST', '/api/staff/finance/kind', { label: 'team LUNCH', dir: 'out', type: 'Office' })).status === 409 && (await req('a', 'POST', '/api/staff/finance/kind', { label: ' ', dir: 'out', type: 'Office' })).status === 422 && (await req('a', 'POST', '/api/staff/finance/kind', { label: 'Thing', type: 'Office' })).status === 422 && (await req('a', 'POST', '/api/staff/finance/kind', { label: 'Thing', dir: 'in', type: 'Office' })).status === 422);
    const k2 = await req('a', 'POST', '/api/staff/finance/kind', { label: 'IELTS coaching', dir: 'in', type: 'sale' });
    check('…and one for a kind of sale', k2.status === 200 && k2.body.kindList.some(k => k.id === k2.body.kind.id && k.pl === 'sale' && k.dir === 'in'), k2.status + ' ' + JSON.stringify(k2.body.kind));
    let nm = await req('a', 'PUT', '/api/staff/finance/line/' + lP.id, { company: 'IN', category: k1.body.kind.id, party: 'Paradise', taxRate: 0, note: 'lunch for 8' });
    check('a bank line is given the office’s own name', nm.status === 200 && nm.body.line.category === k1.body.kind.id && nm.body.line.state === 'named', nm.status + ' ' + JSON.stringify(nm.body).slice(0, 160));
    check('a name for money out is refused on money in', (await req('a', 'PUT', '/api/staff/finance/line/' + lW.id, { company: 'IN', category: k1.body.kind.id })).status === 422);
    nm = await req('a', 'PUT', '/api/staff/finance/line/' + lW.id, { company: 'IN', category: k2.body.kind.id, party: 'Walk-in student', taxRate: 18 });
    check('a receipt is named as a sale of the office’s own kind, GST inside', nm.status === 200 && nm.body.line.taxRate === 18, nm.status + ' ' + JSON.stringify(nm.body).slice(0, 160));
    const BKk = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body;
    check('the year: sales up by ₹10,000 before GST, GST collected up by ₹1,800, office costs up by ₹2,400', BKk.totals.sales - before.sales === 1000000 && BKk.totals.salesTax - before.salesTax === 180000 && BKk.totals.office - before.office === 240000 && BKk.totals.profit - before.profit === 760000, JSON.stringify({ a: BKk.totals, b: before }));
    check('…listed under its own name in Purchases and in Sales', BKk.purchases.some(x => x.label === 'Team lunch' && x.gross === 240000 && x.group === 'Office') && BKk.sales.some(x => /IELTS coaching/.test(x.what) && x.gross === 1180000 && x.tax === 180000), JSON.stringify(BKk.sales.slice(0, 2)));
    check('a name in use cannot be removed, but can be renamed', (await req('a', 'DELETE', '/api/staff/finance/kind/' + k1.body.kind.id)).status === 409 && (await req('a', 'PUT', '/api/staff/finance/kind/' + k1.body.kind.id, { label: 'Team lunches' })).status === 200 && (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.purchases.some(x => x.label === 'Team lunches'));
    const k3 = await req('a', 'POST', '/api/staff/finance/kind', { label: 'Unused name', dir: 'out', type: 'People' });
    const k3d = await req('a', 'DELETE', '/api/staff/finance/kind/' + k3.body.kind.id);
    check('a name not in use is removed', k3d.status === 200 && !k3d.body.kindList.some(k => k.id === k3.body.kind.id), k3d.status + ' ' + JSON.stringify(k3d.body).slice(0, 100));
    const sd = await req('a', 'PUT', '/api/staff/finance/line/' + lW.id, { company: 'IN', category: 'sales-direct', taxRate: 0 });
    check('the built-in "Sale (no invoice raised)" works the same, here at 0%', sd.status === 200 && (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.totals.sales - before.sales === 1180000);
    /* the invoice opened on the screen */
    m = await req('a', 'POST', '/api/staff/finance/line/' + lA2.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: a1.body.invoice.id, amount: 800000 }] });
    await req('a', 'POST', '/api/staff/finance/invoice/' + a1.body.invoice.id + '/cash', { company: 'IN', amount: 200000 });
    const dt = await req('a', 'GET', '/api/staff/finance/invoice/' + a1.body.invoice.id + '?company=IN');
    check('an invoice opens with its lines, the seller, and every receipt: the bank line and the cash', dt.status === 200 && dt.body.invoice.number === a1.body.invoice.number && dt.body.invoice.seller.taxId === '36AALCG2793G1ZA' && dt.body.invoice.receipts.length === 2
      && dt.body.invoice.receipts.some(r => r.how === 'bank' && r.amount === 800000 && r.date === '2026-04-13' && /ANITA/.test(r.description)) && dt.body.invoice.receipts.some(r => r.how === 'cash' && r.amount === 200000) && dt.body.invoice.paid === 1000000 && dt.body.invoice.outstanding === 1000000, dt.status + ' ' + JSON.stringify(dt.body).slice(0, 400));
    check('…not for a counsellor, and not from the other company', (await req('c', 'GET', '/api/staff/finance/invoice/' + a1.body.invoice.id + '?company=IN')).status === 403 && (await req('a', 'GET', '/api/staff/finance/invoice/' + a1.body.invoice.id + '?company=DE')).status === 404);
    const dn2 = (await req('a', 'GET', '/api/staff/finance/lines?company=IN&state=done')).body.lines;
    check('matched lines can be listed on their own', dn2.length >= 1 && dn2.every(x => x.state === 'matched' || x.state === 'part') && dn2.some(x => x.id === lA2.id) && !dn2.some(x => x.id === lP.id), dn2.length);

    /* ---- Patch 313 (owner, 26 Nov): Finance as an extra permission an administrator gives ---- */
    const fc = await req('a', 'POST', '/api/staff/people', { name: 'Fin Counsellor', email: 'finc@glv-sim.in', password: 'Office-12345!', role: 'counsellor', perms: ['finance'] });
    check('a counsellor is created with Finance ticked', fc.status === 200 && (fc.body.person.perms || []).includes('finance'), fc.status + ' ' + JSON.stringify(fc.body).slice(0, 200));
    await req('f', 'POST', '/api/auth/login', { email: 'finc@glv-sim.in', password: 'Office-12345!' });
    await req('f', 'POST', '/api/auth/change', { password: 'Book-keeper-2026!' });
    const fb1 = await req('f', 'GET', '/api/staff/finance/books?company=IN');
    check('…and reads the books, the lines and an invoice, and can raise one', fb1.status === 200 && (await req('f', 'GET', '/api/staff/finance/lines?company=IN')).status === 200 && (await req('f', 'GET', '/api/staff/finance/invoice/' + a1.body.invoice.id + '?company=IN')).status === 200
      && (await req('f', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'student', studentId: kiran, amount: 100000, text: 'By the bookkeeper' })).status === 200, fb1.status + ' ' + JSON.stringify(fb1.body).slice(0, 200));
    check('…but is not an administrator anywhere else', (await req('f', 'PUT', '/api/staff/people/' + fc.body.person.id + '/perms', { perms: ['finance', 'content'] })).status === 403);
    check('a counsellor without it is still refused', (await req('c', 'GET', '/api/staff/finance/books?company=IN')).status === 403);
    const off = await req('a', 'PUT', '/api/staff/people/' + fc.body.person.id + '/perms', { perms: [] });
    check('the administrator takes it away again, at once', off.status === 200 && !off.body.perms.includes('finance') && (await req('f', 'GET', '/api/staff/finance/books?company=IN')).status === 403, off.status + ' ' + JSON.stringify(off.body));
    const on2 = await req('a', 'PUT', '/api/staff/people/' + fc.body.person.id + '/perms', { perms: ['finance', 'marketing'] });
    check('…and gives it back beside another permission', on2.status === 200 && on2.body.perms.includes('finance') && on2.body.perms.includes('marketing') && (await req('f', 'GET', '/api/staff/finance/books?company=IN')).status === 200, JSON.stringify(on2.body));
    const stf = await req('a', 'POST', '/api/staff/people', { name: 'Sneaky Student', email: 'sneak@glv-sim.in', password: 'Office-12345!', role: 'student', perms: ['finance'] });
    await req('s', 'POST', '/api/auth/login', { email: 'sneak@glv-sim.in', password: 'Office-12345!' });
    await req('s', 'POST', '/api/auth/change', { password: 'Student-pass-2026!' });
    const sfb = await req('s', 'GET', '/api/staff/finance/books?company=IN');
    check('a student cannot be given Finance, by creation or afterwards', !(stf.body.person && (stf.body.person.perms || []).includes('finance')) && sfb.status >= 401 && sfb.status <= 403 && (await req('a', 'PUT', '/api/staff/people/' + stf.body.person.id + '/perms', { perms: ['finance'] })).status === 409 && (await req('s', 'GET', '/api/staff/finance/books?company=IN')).status >= 401, stf.status + ' ' + sfb.status);

    /* ---- Patch 313: what the test agents of 26 Nov found ---- */
    const inv = b => req('a', 'POST', '/api/staff/finance/invoice', Object.assign({ company: 'IN', kind: 'student', studentId: kiran, text: 'x' }, b));
    const nInv = async () => (await req('a', 'GET', '/api/staff/finance/invoices?company=IN')).body.invoices.length;
    const n0 = await nInv();
    const huge = [9007199254740993, 1e15, 1e30, 'Infinity', '9007199254740993', true, [700], '0x10', -500, 0, 'abc', null];
    const hs = []; for (const h of huge) hs.push((await inv({ amount: h })).status);
    check('an absurd, negative or non-numeric amount is refused before anything is written', hs.every(x => x === 422) && (await nInv()) === n0 && (await req('a', 'GET', '/api/staff/finance/books?company=IN')).status === 200, JSON.stringify(hs));
    check('…on the counsellor’s route and on an edit too', (await req('a', 'POST', '/api/staff/student/' + kiran + '/invoice', { amount: 1e30 })).status === 422 && (await req('a', 'PUT', '/api/staff/finance/invoice/' + a2.body.invoice.id, { company: 'IN', amount: 9007199254740993 })).status === 422);
    const ds = []; for (const d of ['2026-02-30', '26/11/2026', '2026-13-01', 'yesterday', '1999-01-01', '2099-01-01']) ds.push((await inv({ amount: 100, date: d })).status);
    check('a date that is not a day, or is in the future, is refused; never quietly replaced by today', ds.every(x => x === 422) && (await inv({ amount: 100, due: '2026-02-31' })).status === 422 && (await nInv()) === n0, JSON.stringify(ds));
    const man = b => req('a', 'POST', '/api/staff/finance/invoice', Object.assign({ company: 'IN', kind: 'manual', party: 'Some Ltd', taxRate: 18 }, b));
    check('an invoice line that would be dropped refuses the invoice: a negative line, a line with no words, more than 30, a rate that is not a rate',
      (await man({ items: [{ text: 'Fee', amount: 100000 }, { text: 'Discount', amount: -20000 }] })).status === 422 && (await man({ items: [{ text: '', amount: 5000 }] })).status === 422
      && (await man({ items: Array.from({ length: 35 }, (_, i) => ({ text: 'L' + i, amount: 100 })) })).status === 422 && (await man({ taxRate: 'abc', items: [{ text: 'Fee', amount: 100 }] })).status === 422 && (await nInv()) === n0);
    const upD = await upload('a', 'IN', 'dups.pdf', smart([['20/04/2026', ['UPI/KIRAN DAS/one'], 300000], ['21/04/2026', ['UPI/SOMEONE/two'], 800000]], 0));
    const LD = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body;
    const lD1 = LD.lines.find(x => /KIRAN DAS\/one/.test(x.description)), lD2 = LD.lines.find(x => /SOMEONE\/two/.test(x.description));
    const iD = (await inv({ amount: 300000 })).body.invoice;
    m = await req('a', 'POST', '/api/staff/finance/line/' + lD2.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: iD.id, amount: 300000 }, { type: 'invoice', id: iD.id, amount: 300000 }] });
    check('the same invoice twice in one match is refused, and nothing is paid', m.status === 422 && (await req('a', 'GET', '/api/staff/finance/invoice/' + iD.id + '?company=IN')).body.invoice.paid === 0, m.status + ' ' + JSON.stringify(m.body).slice(0, 120));
    check('a match with nothing in it, or not a thing, is refused cleanly', (await req('a', 'POST', '/api/staff/finance/line/' + lD2.id + '/match', { company: 'IN', targets: [null] })).status === 422);
    check('money going out is offered nothing to match', (await req('a', 'GET', '/api/staff/finance/line/' + lP.id + '/candidates?company=IN')).body.invoices.length === 0);
    const cz = (await req('a', 'GET', '/api/staff/finance/line/' + lD2.id + '/candidates?company=IN')).body.invoices.find(x => x.id === iD.id);
    const cn = (await req('a', 'GET', '/api/staff/finance/line/' + lD1.id + '/candidates?company=IN')).body.invoices.find(x => x.id === iD.id);
    check('an invoice is offered ready-typed only when the bank line names its student, never for an equal amount alone', cz && cz.named === false && cn && cn.named === true, JSON.stringify([cz && cz.named, cn && cn.named]));
    /* a line that raised its own invoice: taken off, the invoice goes with it */
    const before2 = await nInv();
    m = await req('a', 'POST', '/api/staff/finance/line/' + lD2.id + '/match', { company: 'IN', targets: [{ type: 'student', studentId: anita, amount: 800000 }] });
    const autoInv = (await req('a', 'GET', '/api/staff/finance/invoices?company=IN')).body.invoices[0];
    const um = await req('a', 'DELETE', '/api/staff/finance/line/' + lD2.id + '/match/' + m.body.line.links[0].id + '?company=IN');
    const autoAfter = (await req('a', 'GET', '/api/staff/finance/invoice/' + autoInv.id + '?company=IN')).body.invoice;
    check('an invoice a bank line raised for itself is cancelled when that match is taken off, so the student owes nothing they never owed', m.status === 200 && um.status === 200 && autoAfter.status === 'cancelled' && (await nInv()) === before2 + 1, um.status + ' ' + autoAfter.status);
    /* overlapping statements */
    const upE = await upload('a', 'IN', 'dups-longer.pdf', smart([['20/04/2026', ['UPI/KIRAN DAS/one'], 300000], ['21/04/2026', ['UPI/SOMEONE/two'], 800000], ['22/04/2026', ['UPI/THIRD/three'], 100000]], 0));
    const same = await upload('a', 'IN', 'dups-copy.pdf', smart([['20/04/2026', ['UPI/KIRAN DAS/one'], 300000], ['21/04/2026', ['UPI/SOMEONE/two'], 800000]], 0));
    const BL2 = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.batches;
    check('a statement that overlaps adds only what is new; one that adds nothing is not listed again', upE.body.added === 1 && same.status === 200 && same.body.added === 0 && !BL2.some(b => b.filename === 'dups-copy.pdf') && BL2.some(b => b.filename === 'dups-longer.pdf'), JSON.stringify([upE.body.added, same.body.added]));
    m = await req('a', 'POST', '/api/staff/finance/line/' + lD1.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: iD.id, amount: 300000 }] });
    const rmD = await req('a', 'DELETE', '/api/staff/finance/statement/' + BL2.find(b => b.filename === 'dups.pdf').id + '?company=IN');
    const LD2 = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.lines;
    check('removing the first of two overlapping statements keeps the lines the second also has, with their matches', rmD.status === 200 && rmD.body.removed === 0 && rmD.body.kept === 2 && LD2.some(x => x.id === lD1.id && x.state === 'matched') && (await req('a', 'GET', '/api/staff/finance/invoice/' + iD.id + '?company=IN')).body.invoice.paid === 300000, JSON.stringify(rmD.body));
    /* cash is a sale, with its GST, on the day it was taken */
    const cb = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.totals;
    const iC = (await inv({ amount: 1180000, taxRate: 18 })).body.invoice;
    const c1 = await req('a', 'POST', '/api/staff/finance/invoice/' + iC.id + '/cash', { company: 'IN', amount: 590000, date: '2026-05-05' });
    const c2 = await req('a', 'POST', '/api/staff/finance/invoice/' + iC.id + '/cash', { company: 'IN', amount: 590000, date: '2026-05-06' });
    const ca = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body;
    check('cash received on an invoice is in the sales and the GST of its month', c1.status === 200 && c2.status === 200 && ca.totals.sales - cb.sales === 1000000 && ca.totals.salesTax - cb.salesTax === 180000 && ca.months.find(x => x.month === '2026-05').sales >= 1000000 && ca.sales.some(x => x.kind === 'cash' && x.gross === 590000 && x.date === '2026-05-05'), JSON.stringify([ca.totals.sales - cb.sales, ca.totals.salesTax - cb.salesTax]));
    const dC = (await req('a', 'GET', '/api/staff/finance/invoice/' + iC.id + '?company=IN')).body.invoice;
    const one = await req('a', 'DELETE', '/api/staff/finance/invoice/' + iC.id + '/cash?company=IN&link=' + dC.receipts[0].linkId);
    check('one cash entry is taken off without the other', one.status === 200 && one.body.invoice.cash === 590000 && (await req('a', 'POST', '/api/staff/finance/invoice/' + iC.id + '/cash', { company: 'IN', amount: 100, date: '2099-01-01' })).status === 422, one.status + ' ' + JSON.stringify(one.body).slice(0, 120));
    check('a counsellor’s invoice is the Indian company’s and dated today, whatever is sent', (await (async () => { const kv = (await req('c', 'GET', '/api/staff/students')).body; const mine = (kv.students || kv.rows || [])[0]; if (!mine) return 'no student'; const r = await req('c', 'POST', '/api/staff/student/' + mine.id + '/invoice', { amount: 100000, company: 'DE', date: '2024-01-01' }); return r.status === 200 && /^GCPL\//.test(r.body.invoice.number) && r.body.invoice.currency === 'INR' && r.body.invoice.date !== '2024-01-01' ? 'ok' : JSON.stringify(r.body).slice(0, 200); })()) === 'ok');
    /* bills: what the file is decides */
    const lOut = (await req('a', 'GET', '/api/staff/finance/lines?company=IN&dir=out')).body.lines[0];
    const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 3)]);
    check('a program renamed .jpg, text renamed .webp, and a page hidden behind a junk byte are not bills', (await sendBill('a', { company: 'IN', lineId: lOut.id }, 'photo.jpg', EXE)).status === 415 && (await sendBill('a', { company: 'IN', lineId: lOut.id }, 'x.webp', Buffer.from('just some text here'))).status === 415 && (await sendBill('a', { company: 'IN', lineId: lOut.id }, 'x.png', Buffer.from('﻿<html><script>1</script></html>'))).status === 415);
    const longName = 'a'.repeat(230) + '.pdf';
    const bl = await sendBill('a', { company: 'IN', lineId: lOut.id }, longName, PDFB);
    check('a real PDF with a very long name is kept', bl.status === 200, bl.status + ' ' + JSON.stringify(bl.body).slice(0, 120));
    check('a bill’s edit obeys what its creation obeys: no future date, no absurd amount; and it can be moved off its line and back', (await req('a', 'PUT', '/api/staff/finance/bill/' + bl.body.bill.id, { company: 'IN', date: '2031-01-01' })).status === 422 && (await req('a', 'PUT', '/api/staff/finance/bill/' + bl.body.bill.id, { company: 'IN', amount: 1e30 })).status === 422
      && (await req('a', 'PUT', '/api/staff/finance/bill/' + bl.body.bill.id, { company: 'IN', lineId: null })).body.bill.lineId === null && (await req('a', 'PUT', '/api/staff/finance/bill/' + bl.body.bill.id, { company: 'IN', lineId: lOut.id })).body.bill.lineId === lOut.id);

    /* ---- Patch 315 (owner, 26 Nov): the accountant; the statement file; the lines with what each was;
            the book against the bank's balances ---- */
    const acc = await req('a', 'POST', '/api/staff/people', { name: 'Asha Accountant', email: 'accountant@glv-sim.in', password: 'Office-12345!', role: 'editor', perms: ['finance'] });
    check('an accountant is a website-only account whose one permission is Finance', acc.status === 200 && JSON.stringify(acc.body.person.perms) === '["finance"]' && ((await req('a', 'GET', '/api/staff/people')).body.people.find(p => p.email === 'accountant@glv-sim.in') || {}).level === 'accountant', acc.status + ' ' + JSON.stringify(acc.body.person || acc.body).slice(0, 200));
    await req('x', 'POST', '/api/auth/login', { email: 'accountant@glv-sim.in', password: 'Office-12345!' });
    await req('x', 'POST', '/api/auth/change', { password: 'Accountant-2026!' });
    check('…who reads the books, the lines, the sales and purchases, an invoice and its printed page', (await req('x', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body.purchases.length > 0 && (await req('x', 'GET', '/api/staff/finance/lines?company=IN')).status === 200
      && (await req('x', 'GET', '/api/staff/finance/invoice/' + a1.body.invoice.id + '?company=IN')).status === 200 && (await req('x', 'GET', '/api/staff/finance/invoice/' + a1.body.invoice.id + '/print')).status === 200);
    check('…and nothing else: no students, no leads, no chats, no people, no website', (await req('x', 'GET', '/api/staff/students')).status === 403 && (await req('x', 'GET', '/api/staff/leads')).status === 403 && (await req('x', 'GET', '/api/staff/chats')).status === 403
      && (await req('x', 'GET', '/api/staff/people')).status === 403 && (await req('x', 'GET', '/api/staff/student/' + anita)).status === 403 && (await req('x', 'PUT', '/api/staff/programme', { id: 'x' })).status === 403);
    const upF = await upload('a', 'IN', 'kept.pdf', smart([['25/04/2026', ['UPI/KEPT/one'], 111100]], 0));
    const bF = (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.batches.find(b => b.filename === 'kept.pdf');
    const ff = await fetch(BASE + '/api/staff/finance/statement/' + bF.id + '/file', { headers: { cookie: jars.x } });
    const fbuf = Buffer.from(await ff.arrayBuffer());
    check('the statement file is kept as the bank gave it, and the accountant downloads it', upF.body.added === 1 && bF.hasFile === true && ff.status === 200 && ff.headers.get('content-type') === 'application/pdf' && /attachment/.test(ff.headers.get('content-disposition') || '') && fbuf.slice(0, 5).toString() === '%PDF-', ff.status + ' ' + fbuf.length);
    check('…not a counsellor; and an older statement says its file was not kept', (await fetch(BASE + '/api/staff/finance/statement/' + bF.id + '/file', { headers: { cookie: jars.c } })).status === 403 && (await req('a', 'GET', '/api/staff/finance/lines?company=IN')).body.batches.every(b => typeof b.hasFile === 'boolean'));
    const LL = (await req('x', 'GET', '/api/staff/finance/lines?company=IN')).body.lines;
    check('a matched line says what kind of invoice paid it (student or partner)', LL.some(l => (l.links || []).some(k => k.invoice && k.invoice.kind === 'student' && k.invoice.number)), JSON.stringify((LL.find(l => (l.links || []).length) || {}).links).slice(0, 200));
    const RB = (await req('x', 'GET', '/api/staff/finance/reconciliation?company=IN')).body.balances;
    const kb = RB.flatMap(a => a.statements).find(x => x.filename === 'kept.pdf');
    check('the book is checked against the bank: opening plus in less out is the bank’s closing balance', kb && kb.opening === 0 && kb.moneyIn === 111100 && kb.moneyOut === 0 && kb.computed === 111100 && kb.closing === 111100 && kb.agrees === true && kb.unsorted === 1 && kb.unsortedAmount === 111100, JSON.stringify(kb));
    const upG = await upload('a', 'IN', 'later.pdf', smart([['10/06/2026', ['UPI/LATER/two'], 5000]], 999));
    const RB2 = (await req('x', 'GET', '/api/staff/finance/reconciliation?company=IN')).body.balances;
    const lb = RB2.flatMap(a => a.statements).find(x => x.filename === 'later.pdf');
    check('a statement that does not start where the last one ended is flagged', upG.body.added === 1 && lb && lb.follows === false && lb.agrees === true && RB2.find(a => a.statements.some(x => x.id === lb.id)).ok === false, JSON.stringify(lb));
    const rmF = await req('a', 'DELETE', '/api/staff/finance/statement/' + bF.id + '?company=IN');
    check('removing a statement removes its kept file', rmF.status === 200 && (await fetch(BASE + '/api/staff/finance/statement/' + bF.id + '/file', { headers: { cookie: jars.a } })).status === 404);

    /* ---- Patch 319: the accountant's pack ---- */
    const rawGet = async (who, p) => { const r = await fetch(BASE + p, { headers: { cookie: jars[who] } }); return { status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) }; };
    const pkJ = (await req('a', 'GET', '/api/staff/finance/pack?company=IN&month=2026-06')).body;
    check('the pack for a month says, check by check, whether it is ready', pkJ.ok === true && Array.isArray(pkJ.checks) && pkJ.checks.length === 4 && ['statements', 'balance', 'sorted', 'bills'].every(k => pkJ.checks.some(c => c.key === k)) && typeof pkJ.ready === 'boolean', JSON.stringify(pkJ).slice(0, 200));
    check('"ready" is exactly: every must-have check passes', pkJ.ready === pkJ.checks.filter(c => c.must).every(c => c.ok));
    const sortedC = pkJ.checks.find(c => c.key === 'sorted');
    const juneLines = (await req('a', 'GET', '/api/staff/finance/lines?company=IN&from=2026-06-01&to=2026-06-30')).body.lines;
    check('a month with a line still to sort is not ready, and says how many', juneLines.some(l => l.state === 'open' || l.state === 'part') ? (sortedC.ok === false && pkJ.ready === false && /still to sort/.test(sortedC.detail)) : sortedC.ok === true, sortedC.detail);
    const pkE = (await req('a', 'GET', '/api/staff/finance/pack?company=IN&month=2026-08')).body;
    check('a month with no statement is not ready', pkE.ready === false && pkE.checks.find(c => c.key === 'statements').ok === false && pkE.counts.lines === 0);
    const pkY = (await req('a', 'GET', '/api/staff/finance/pack?company=IN&year=2026')).body;
    check('a year still running is held to the last month that is over, and marked so', pkY.period.kind === 'year' && pkY.period.partial === true && pkY.period.upTo < pkY.period.to && pkY.months.length === 12, JSON.stringify(pkY.period));
    check('the GST figures are there both ways: by money received and by invoices raised', pkY.tax && pkY.tax.received && pkY.tax.invoiced && pkY.tax.received.net === pkY.tax.received.output - pkY.tax.received.input && pkY.tax.invoiced.count >= 0);
    const bk = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body;
    check('and they are the book\u2019s own figures for the year', pkY.totals.sales === bk.totals.sales && pkY.totals.costs === bk.totals.costs && pkY.tax.received.output === bk.totals.salesTax, JSON.stringify(pkY.totals) + ' vs ' + JSON.stringify(bk.totals).slice(0, 200));
    for (const rp of ['gst', 'recon', 'pl', 'invoices']) {
      const r = await rawGet('a', '/api/staff/finance/pack/report/' + rp + '?company=IN&year=2026');
      check('the ' + rp + ' report is a page to print, with the company on it', r.status === 200 && /text\/html/.test(r.type) && r.buf.toString().includes('Glovels') && !/<script/i.test(r.buf.toString()), r.status + ' ' + r.type);
    }
    for (const rg of ['lines', 'sales', 'purchases', 'invoices']) {
      const r = await rawGet('a', '/api/staff/finance/pack/register/' + rg + '.csv?company=IN&year=2026');
      check('the ' + rg + ' register downloads as a spreadsheet', r.status === 200 && /text\/csv/.test(r.type) && r.buf.toString().split('\n').length >= 1, r.status + ' ' + r.type);
    }
    const linesCsv = (await rawGet('a', '/api/staff/finance/pack/register/lines.csv?company=IN&year=2026')).buf.toString();
    const yearLines = (await req('a', 'GET', '/api/staff/finance/lines?company=IN&from=' + pkY.period.from + '&to=' + pkY.period.to)).body.lines;
    check('one row in the lines register for each bank line of the year', linesCsv.trim().split(/\r?\n/).length === yearLines.length + 1, linesCsv.trim().split(/\r?\n/).length + ' rows for ' + yearLines.length + ' lines');
    const zp = await rawGet('a', '/api/staff/finance/pack.zip?company=IN&year=2026');
    const zt = zp.buf.toString('latin1');
    check('everything in one ZIP: reports, registers, statements, read-me', zp.status === 200 && zp.buf.slice(0, 2).toString() === 'PK' && /application\/zip/.test(zp.type) && ['1 GST report.html', '2 Bank reconciliation.html', '3 Profit and loss.html', '4 Sales invoices.html', 'Registers/', 'READ ME.txt'].every(n => zt.includes(n)), zp.status + ' ' + zp.buf.length);
    check('the bank\u2019s own statement files are inside it', pkY.counts.statementFiles > 0 ? zt.includes('Bank statements/') : true, pkY.counts.statementFiles);
    check('the ZIP ends as a ZIP should (a central directory with every file)', zp.buf.readUInt32LE(zp.buf.length - 22) === 0x06054b50 && zp.buf.readUInt16LE(zp.buf.length - 12) >= 9);
    check('a counsellor without Finance gets none of it', (await req('c', 'GET', '/api/staff/finance/pack?company=IN&year=2026')).status === 403 && (await rawGet('c', '/api/staff/finance/pack.zip?company=IN&year=2026')).status === 403 && (await rawGet('c', '/api/staff/finance/pack/report/gst?company=IN&year=2026')).status === 403);
    check('the German company has its own pack, in its own tax', (await req('a', 'GET', '/api/staff/finance/pack?company=DE&year=2026')).body.tax.name === 'VAT' || /USt|VAT|MwSt/.test((await req('a', 'GET', '/api/staff/finance/pack?company=DE&year=2026')).body.tax.name));
    const fh = fs.readFileSync(path.join(__dirname, '..', 'finance.html'), 'utf8');
    check('the Finance screen has the tab, with one button for everything', /data-tab="pack"[^>]*>For the accountant</.test(fh) && /pack\.zip\?/.test(fh) && /Download everything in one ZIP/.test(fh));

    /* ---- Patch 320: what the audit agents found ---- */
    const FINM = require(path.join(__dirname, '..', 'server', 'finance.js'));
    check('a GSTIN is told from a foreign VAT number', FINM.isGstin('36AALCG2793G1ZA') === true && FINM.isGstin('DE298471635') === false && FINM.isGstin('') === false);
    const meName = ((await req('a', 'GET', '/api/staff/finance/books?company=IN')).body.settings || {}).name || 'Glovels Consultants Private Limited';
    const upT = await upload('a', 'IN', 'own.pdf', smart([
      ['12/07/2026', ['IFT/IFT975071921/TRF FROM 900000000000001/' + meName.toUpperCase()], 6000000],
      ['13/07/2026', ['NEFT/YESBN1/WISE PAYMENTS LIMITED/YES BANK'], 4640000],
      ['14/07/2026', ['UPI/P2A/1/ROHITH NAIDU P/KOTAK/ielts'], 500000]], 0));
    const LT = (await req('a', 'GET', '/api/staff/finance/lines?company=IN&from=2026-07-01&to=2026-07-31')).body.lines;
    const lOwn = LT.find(l => /TRF FROM/.test(l.description)), lWise = LT.find(l => /WISE PAYMENTS/.test(l.description)), lRo = LT.find(l => /ROHITH/.test(l.description));
    const mkInv = async (party) => (await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'manual', party, taxRate: 18, date: '2026-07-01', items: [{ text: 'Commission', amount: 4720000 }] }));
    const iFin = await mkInv('FinEdu Loans Private Limited'); const iRo = await mkInv('Rohit Sharma');
    check('the test has its lines and invoices', upT.body.added === 3 && lOwn && lWise && lRo && iFin.status === 200 && iRo.status === 200, upT.status + ' ' + JSON.stringify(upT.body).slice(0, 120) + ' ' + iFin.status + ' ' + JSON.stringify(iFin.body).slice(0, 120));
    const cOwn = (await req('a', 'GET', '/api/staff/finance/line/' + lOwn.id + '/candidates?company=IN')).body;
    check('money moved between the company\u2019s own accounts is offered to nobody', cOwn.ownTransfer === true && cOwn.invoices.length === 0 && cOwn.orders.length === 0);
    const cWise = (await req('a', 'GET', '/api/staff/finance/line/' + lWise.id + '/candidates?company=IN')).body;
    check('"limited" and "payments" name nobody: no amount is ready-typed for another company', !cWise.ownTransfer && cWise.invoices.length > 0 && cWise.invoices.every(i => !i.named), JSON.stringify(cWise.invoices.filter(i => i.named).map(i => i.party)));
    const cRo = (await req('a', 'GET', '/api/staff/finance/line/' + lRo.id + '/candidates?company=IN')).body;
    check('"Rohith" does not name Rohit', cRo.invoices.every(i => !i.named), JSON.stringify(cRo.invoices.filter(i => i.named).map(i => i.party)));
    check('the Bank tab can list the lines that were named', (await req('a', 'GET', '/api/staff/finance/lines?company=IN&state=named')).body.lines.every(l => l.state === 'named'));
    /* the accountant: looks, downloads, changes nothing; and sees no catalogue */
    const bx = await req('x', 'GET', '/api/staff/finance/books?company=IN');
    check('the accountant\u2019s account is told it is read-only, and reads everything', bx.status === 200 && bx.body.readOnly === true && (await req('a', 'GET', '/api/staff/finance/books?company=IN')).body.readOnly === false);
    check('the accountant cannot name a line, raise an invoice, add a kind or remove a statement',
      (await req('x', 'PUT', '/api/staff/finance/line/' + lRo.id, { company: 'IN', category: 'sales-direct' })).status === 403
      && (await req('x', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'manual', party: 'X', taxRate: 0, items: [{ text: 'x', amount: 100 }] })).status === 403
      && (await req('x', 'POST', '/api/staff/finance/kind', { company: 'IN', label: 'x', dir: 'out', pl: 'office' })).status === 403
      && (await req('x', 'DELETE', '/api/staff/finance/statement/' + upT.body.batchId + '?company=IN')).status === 403);
    check('nor read the universities, which are no part of the books', (await req('x', 'GET', '/api/staff/catalogue')).status === 403 && (await req('x', 'GET', '/api/staff/catalogue/ids')).status === 403 && (await req('a', 'GET', '/api/staff/catalogue')).status === 200 && (await req('c', 'GET', '/api/staff/catalogue')).status === 200);
    /* GST by invoices raised now carries sales that came in without an invoice */
    const nm7 = await req('a', 'PUT', '/api/staff/finance/line/' + lRo.id, { company: 'IN', category: 'sales-direct', party: 'Rohith Naidu', taxRate: 18 });
    const pk7 = (await req('a', 'GET', '/api/staff/finance/pack?company=IN&month=2026-07')).body;
    check('a sale received without an invoice is in the GST to pay beside the invoices', nm7.status === 200 && pk7.tax.invoiced.uninvoiced.count === 1 && pk7.tax.invoiced.uninvoiced.gross === 500000 && pk7.tax.invoiced.outputAll === pk7.tax.invoiced.output + pk7.tax.invoiced.uninvoiced.tax && pk7.tax.invoiced.uninvoiced.tax === 76271, nm7.status + ' ' + JSON.stringify(pk7.tax && pk7.tax.invoiced && pk7.tax.invoiced.uninvoiced));
    const g7 = (await rawGet('a', '/api/staff/finance/pack/report/gst?company=IN&month=2026-07')).buf.toString();
    check('and the printed report says so', /received without an invoice/.test(g7) && /on sales without an invoice/.test(g7));

    /* ---- Patch 321: an invoice in pounds, received in rupees, reconciled ---- */
    const bfx = (await req('a', 'GET', '/api/staff/finance/books?company=IN')).body.fx || [];
    check('the screen is given the currencies an invoice can be in, with the day\u2019s rate', ['GBP', 'EUR', 'USD'].every(k => bfx.some(x => x.code === k)) && !bfx.some(x => x.code === 'INR'), JSON.stringify(bfx).slice(0, 200));
    const gb = await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'partner', party: 'Northfield University', taxRate: 0, date: '2026-08-03', currency: 'GBP', fxRate: 106.5, items: [{ text: 'Commission, autumn intake', amount: 150000 }, { text: 'Marketing support', amount: 50000 }] });
    const G1 = gb.body.invoice || {};
    check('an invoice is raised in pounds: \u00a32,000.00, valued at \u20b92,13,000.00 at 106.5', gb.status === 200 && G1.fx && G1.fx.currency === 'GBP' && G1.fx.gross === 200000 && G1.fx.rate === 106.5 && G1.gross === 21300000 && G1.outstanding === 21300000 && G1.items[0].fx === 150000 && G1.items[0].amount === 15975000, gb.status + ' ' + JSON.stringify(gb.body).slice(0, 260));
    const gp = (await rawGet('a', '/api/staff/finance/invoice/' + G1.id + '/print')).buf.toString();
    check('it prints in pounds, with its value in rupees and the rate underneath', gp.includes('\u00a31,500.00') && gp.includes('\u00a32,000.00') && /Invoiced in GBP/.test(gp) && gp.includes('106.5') && gp.includes('2,13,000.00'), gp.slice(gp.indexOf('<table'), gp.indexOf('<table') + 200));
    check('a currency the tool does not know, or no usable rate, is refused', (await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'manual', party: 'X', taxRate: 0, currency: 'XXX', fxRate: 2, items: [{ text: 'x', amount: 100 }] })).status === 422
      && (await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'manual', party: 'X', taxRate: 0, currency: 'GBP', fxRate: -3, items: [{ text: 'x', amount: 100 }] })).status !== 500);
    const upX = await upload('a', 'IN', 'fx.pdf', smart([['20/08/2026', ['NEFT/CITIN1/NORTHFIELD UNIVERSITY/CITI/INV'], 21184500], ['21/08/2026', ['NEFT/CITIN2/NORTHFIELD UNIVERSITY/CITI/second'], 100000]], 0));
    const LX = (await req('a', 'GET', '/api/staff/finance/lines?company=IN&from=2026-08-01&to=2026-08-31')).body.lines;
    const lx = LX.find(l => /CITIN1/.test(l.description)), lx2 = LX.find(l => /CITIN2/.test(l.description));
    const cx = (await req('a', 'GET', '/api/staff/finance/line/' + lx.id + '/candidates?company=IN')).body;
    check('the bank line that paid it offers the pound invoice, named', upX.body.added === 2 && cx.invoices.some(i => i.id === G1.id && i.named && i.fx && i.fx.currency === 'GBP'));
    const over = await req('a', 'POST', '/api/staff/finance/line/' + lx2.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: G1.id, amount: 100000 }] });
    check('a part of it can still be matched the ordinary way', over.status === 200 && (await req('a', 'GET', '/api/staff/finance/invoice/' + G1.id + '?company=IN')).status === 200);
    const mx = await req('a', 'POST', '/api/staff/finance/line/' + lx.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: G1.id, amount: 21184500, settle: true }] });
    const G2 = ((await req('a', 'GET', '/api/staff/finance/invoices?company=IN')).body.invoices || []).find(i => i.id === G1.id);
    check('matched as settling it: the invoice is paid in full by what the bank credited, and the difference is kept', mx.status === 200 && G2.state === 'paid' && G2.outstanding === 0 && G2.paid === 21284500 && G2.adjust === -15500 && G2.fxRealised > 106.4 && G2.fxRealised < 106.5, mx.status + ' ' + JSON.stringify({ s: G2.state, o: G2.outstanding, p: G2.paid, a: G2.adjust, r: G2.fxRealised }) + ' ' + JSON.stringify(mx.body).slice(0, 160));
    const bkx = (await req('a', 'GET', '/api/staff/finance/books?company=IN&year=2026')).body;
    const aug = bkx.months.find(m => m.month === '2026-08');
    check('the book counts the rupees that came, not the estimate', aug && aug.sales === 21284500, aug && aug.sales);
    const regx = (await rawGet('a', '/api/staff/finance/pack/register/invoices.csv?company=IN&month=2026-08')).buf.toString();
    check('the invoices register carries the currency, the amount, the rate and the exchange difference', /Invoiced in,Amount in that currency,Rate used,Exchange difference/.test(regx) && /GBP,2000\.00,106\.5,-155\.00/.test(regx), regx.slice(0, 400));
    const offx = await req('a', 'DELETE', '/api/staff/finance/line/' + lx.id + '/match/' + ((mx.body.line.links || []).slice(-1)[0] || {}).id + '?company=IN');
    const G3 = ((await req('a', 'GET', '/api/staff/finance/invoices?company=IN')).body.invoices || []).find(i => i.id === G1.id);
    check('taken off again, the invoice is open at its estimate', offx.status === 200 && G3.adjust === 0 && G3.state === 'part' && G3.outstanding === 21300000 - 100000, offx.status + ' ' + JSON.stringify({ a: G3.adjust, s: G3.state, o: G3.outstanding }));
    const tooMuch = await req('a', 'POST', '/api/staff/finance/line/' + lx.id + '/match', { company: 'IN', targets: [{ type: 'invoice', id: G1.id, amount: 21284500 }] });
    check('without saying it settles the invoice, more than is owed is still refused', tooMuch.status === 422, tooMuch.status);
    const inr = await req('a', 'POST', '/api/staff/finance/invoice', { company: 'IN', kind: 'manual', party: 'Plain Rupee Buyer', taxRate: 18, items: [{ text: 'x', amount: 118000 }] });
    check('an invoice in rupees is as before: no foreign amounts', inr.status === 200 && inr.body.invoice.fx === null && inr.body.invoice.adjust === 0 && inr.body.invoice.gross === 118000);
    check('the screen has the currency choice and the settle tick', /id="iCur"/.test(fh) && /data-settle=/.test(fh) && /settles the/.test(fh));
  } catch (e) { fail++; console.log('  ✗ test crashed — ' + (e && e.stack || e)); }
  try { process.kill(-child.pid); } catch (e) { /* gone */ }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
