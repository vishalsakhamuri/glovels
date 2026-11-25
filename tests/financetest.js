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
    const wantSales = studentIn - gst(1200000) - gst(600000) - gst(1500000) - gst(300000) + 5900000;
    const rentNet = 2360000 - gst(2360000);
    const wantCosts = 4000000 + 4000000 + rentNet + 10000 + 1800 + 37900 + 48000;
    check('the screen is given the list of kinds to choose from, apart from the year\u2019s totals by kind', Array.isArray(B.kindList) && B.kindList.some(k => k.id === 'salaries' && k.dir === 'out') && B.kindList.some(k => k.id === 'capital' && k.dir === 'in') && B.kinds.some(k => k.category === 'salaries' && k.amount === 8000000), JSON.stringify((B.kinds || []).slice(0, 2)));
    check('the Indian year is April to March', B.yearLabel === '2026–27' && B.from === '2026-04-01' && B.to === '2027-03-31' && B.months.length === 12, B.yearLabel + ' ' + B.from);
    check('sales: money matched to students and invoices, before GST', B.totals.sales === wantSales, B.totals.sales + ' / ' + wantSales);
    check('costs: everything named as an expense, before the GST on the rent', B.totals.costs === wantCosts, B.totals.costs + ' / ' + wantCosts);
    check('people and office are kept apart', B.totals.people === 8000000 && B.totals.office === wantCosts - 8000000, B.totals.people + ' ' + B.totals.office);
    check('profit is sales less costs; capital is in neither', B.totals.profit === wantSales - wantCosts && B.totals.otherIncome === 0, B.totals.profit);
    check('GST: collected, less what the landlord charged, is what is owed', B.totals.salesTax === gst(1200000) + gst(600000) + gst(1500000) + gst(300000) && B.totals.costsTax === gst(2360000) && B.totals.taxOwed === B.totals.salesTax - B.totals.costsTax, JSON.stringify([B.totals.salesTax, B.totals.costsTax, B.totals.taxOwed]));
    check('by month: April and May carry it, and add up to the year', B.months[0].month === '2026-04' && B.months.reduce((s, x) => s + x.profit, 0) === B.totals.profit && B.months[1].people === 4000000);
    check('the sales book lists five receipts, the purchases book seven', B.sales.length === 5 && B.purchases.length === 7, B.sales.length + ' ' + B.purchases.length);
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
  } catch (e) { fail++; console.log('  ✗ test crashed — ' + (e && e.stack || e)); }
  try { process.kill(-child.pid); } catch (e) { /* gone */ }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
