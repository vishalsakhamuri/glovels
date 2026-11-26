'use strict';
/*
 * Patch 309: Finance — a small set of books for an education consultancy.
 *
 * Owner, 25 Nov 2026: "only for admin there should be a finance tab …
 * invoices created and tracked; bank statement uploaded and mapped to the
 * student pending payment in multiple payments or single payment;
 * reconciliation with student payments; remaining payments are employees
 * cost and office expenses tracked separate; sales and purchases have
 * separate tabs; yearly, monthly profit and loss … GST or VAT … we do not
 * need a full module, only a few things, crisp and easy to handle."
 *
 * TWO COMPANIES, NEVER MIXED. "We have 2 different companies in different
 * countries … in Germany it is VAT and India it is GST … we are not clubbing
 * both." Every row carries `company` (IN or DE) and every read names one.
 *
 * THE BANK STATEMENT IS THE BOOK. Profit and loss goes by the day money
 * reached or left the bank (his choice). A line of money IN is matched to a
 * student's order (which RECORDS the payment on that order, so what they
 * still owe drops — his choice), to a payment the office or the gateway
 * already recorded, or to an invoice; or it is given a kind (capital, a
 * loan, interest…). A line of money OUT is given a kind (salaries, rent,
 * software…) and, when a supplier charged tax, the rate — that is the
 * purchases book.
 *
 * Amounts are whole numbers in the smallest unit of the company's currency
 * (paise, cents). Prices include tax, as everywhere on this site: the tax is
 * worked out of the amount, never added to it.
 */
const crypto = require('crypto');
const STATEMENT = require('./statement.js');

const COMPANIES = {
  IN: { code: 'IN', label: 'India', currency: 'INR', symbol: '₹', locale: 'en-IN', tax: 'GST', rates: [18, 0], yearStarts: 4,
    defaults: { name: 'Glovels Consultants Private Limited', series: 'GCPL/26-27/' } },
  DE: { code: 'DE', label: 'Germany', currency: 'EUR', symbol: '€', locale: 'de-DE', tax: 'VAT', rates: [19, 0], yearStarts: 1,
    defaults: { name: 'Glovels UG (haftungsbeschränkt)', series: 'GDE-2026-' } },
};

/* What a line can be called. `pl` says where it lands in profit and loss:
   income, cost, or neither (money that only moved). */
const KINDS = {
  /* money in */
  /* Patch 313: a receipt that IS a sale, named as one without raising an
     invoice for it — counted in sales, with the GST inside it taken out. */
  'sales-direct': { dir: 'in', label: 'Sale (no invoice raised)', pl: 'sale' },
  'other-income': { dir: 'in', label: 'Other income', pl: 'income' },
  interest: { dir: 'in', label: 'Bank interest', pl: 'income' },
  capital: { dir: 'in', label: 'Owner’s money / share capital', pl: '' },
  'loan-in': { dir: 'in', label: 'Loan received', pl: '' },
  'transfer-in': { dir: 'in', label: 'Transfer from our own account', pl: '' },
  'cash-deposit': { dir: 'in', label: 'Cash paid into the bank (sales already counted as cash)', pl: '' },
  'refund-in': { dir: 'in', label: 'Refund from a supplier', pl: 'cost-back' },
  /* money out */
  salaries: { dir: 'out', label: 'Salaries and staff', pl: 'cost', group: 'People' },
  contractors: { dir: 'out', label: 'Freelancers and outside counsellors', pl: 'cost', group: 'People' },
  rent: { dir: 'out', label: 'Rent and utilities', pl: 'cost', group: 'Office' },
  office: { dir: 'out', label: 'Office expenses', pl: 'cost', group: 'Office' },
  software: { dir: 'out', label: 'Software and hosting', pl: 'cost', group: 'Office' },
  marketing: { dir: 'out', label: 'Marketing and ads', pl: 'cost', group: 'Office' },
  travel: { dir: 'out', label: 'Travel', pl: 'cost', group: 'Office' },
  professional: { dir: 'out', label: 'Accountant, legal, fees', pl: 'cost', group: 'Office' },
  'bank-charges': { dir: 'out', label: 'Bank and gateway charges', pl: 'cost', group: 'Office' },
  'student-costs': { dir: 'out', label: 'Paid on a student’s behalf (university, APS, visa)', pl: 'cost', group: 'Students' },
  'student-refund': { dir: 'out', label: 'Refund to a student', pl: 'income-back', group: 'Students' },
  'other-cost': { dir: 'out', label: 'Other expense', pl: 'cost', group: 'Office' },
  'tax-paid': { dir: 'out', label: 'GST / VAT paid to the government', pl: '', group: 'Tax' },
  'tax-other': { dir: 'out', label: 'Income tax, TDS and other taxes', pl: '', group: 'Tax' },
  drawings: { dir: 'out', label: 'Owner’s drawings / dividends', pl: '' },
  'loan-out': { dir: 'out', label: 'Loan repaid or given', pl: '' },
  'transfer-out': { dir: 'out', label: 'Transfer to our own account', pl: '' },
};
/* A first guess from the bank's words, offered and never applied without a click. */
const GUESS = [
  [/service\s*ch|monthly service|sms charg|charges|gst @|razorpay.*fee|stripe.*fee|kontoführung|entgelt/i, 'bank-charges'],
  [/salary|sal\b|payroll|gehalt|lohn/i, 'salaries'],
  [/\brent\b|miete|electricity|broadband|internet|airtel|jio|act fibernet|strom/i, 'rent'],
  [/google|meta\b|facebook|instagram|linkedin ads|adwords/i, 'marketing'],
  [/render\b|cloudflare|github|brevo|zoho|microsoft|canva|openai|anthropic|aws|one\.com|notion|slack|zoom/i, 'software'],
  [/initial funding|share capital|capital/i, 'capital'],
  [/int\.?pd|interest|zinsen/i, 'interest'],
  [/gst payment|gstn|cbic|finanzamt|umsatzsteuer/i, 'tax-paid'],
  [/tds|income tax|advance tax|körperschaft|gewerbesteuer/i, 'tax-other'],
  [/uni-?assist|aps india|vfs|university|hochschule|universit/i, 'student-costs'],
  [/irctc|makemytrip|indigo|uber|ola\b|lufthansa|db bahn|hotel/i, 'travel'],
];

const iso = () => new Date().toISOString();
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
/* A real day of the calendar, 2000 to 2100: "2026-02-30" parses in V8 and is not one. */
const isDay = d => { const s = String(d == null ? '' : d); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = new Date(s + 'T00:00:00Z'); return !isNaN(t) && t.toISOString().slice(0, 10) === s && s >= '2000-01-01' && s <= '2100-12-31'; };
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200);
const taxIn = (amount, rate) => rate > 0 ? Math.round(Math.abs(amount) - Math.abs(amount) / (1 + rate / 100)) : 0;
const bad = (code, error, more) => Object.assign(new Error(error), { code }, more || {});
/* Patch 313 (the test of 26 Nov): an amount is a plain number of paise or
   cents, more than zero and under a hundred crore. One pasted account number
   in an amount box stored a figure the database could not read back, and the
   company's Finance screens answered 500 from then on. Nothing else is an
   amount: not true, not a list, not "0x10", not 1e30. */
const MAX_AMOUNT = 1e11;
const amt = (v, what) => {
  const ok = (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\d{1,13}(\.\d+)?$/.test(v.trim()));
  const n = ok ? Math.round(Number(v)) : NaN;
  if (!Number.isSafeInteger(n) || !(n > 0)) throw bad(422, (what || 'The amount') + ' has to be a number, more than zero.');
  if (n > MAX_AMOUNT) throw bad(422, (what || 'The amount') + ' is too large to be right. Check it: is that a reference or account number in the amount box?');
  return n;
};
/* a date the caller typed: the day itself, or a refusal — never silently today */
const dayOr = (v, what, fallback) => { if (v == null || v === '') return fallback; if (!isDay(v)) throw bad(422, what + ' is not a date. Use the calendar, or YYYY-MM-DD.'); return String(v); };

function open({ db, MONEY, takePayment, log = console }) {
  const F = db.fin;
  const co = c => { const x = COMPANIES[String(c || '').toUpperCase()]; if (!x) throw bad(422, 'Choose the company: India or Germany.'); return x; };

  /* ---- each company's own details: name, address, tax number, invoice numbers ---- */
  const settings = () => {
    const s = db.content('finance') || {};
    /* Owner, 26 Nov: "all Glovels company details mentioned in glovels.com,
       including GST number". The legal pages' own particulars (the Legal
       tab, with the registered defaults behind it) are what the invoice
       prints, unless Finance → Company says otherwise for a field. */
    let legal = {};
    try { legal = require('./content.js').cleanLegal(db.content('legal') || {}); } catch (e) { legal = db.content('legal') || {}; }
    const ug = legal.ug || {};
    const out = {};
    Object.keys(COMPANIES).forEach(k => {
      const d = COMPANIES[k].defaults, x = s[k] || {};
      out[k] = {
        name: str(x.name, 120) || (k === 'IN' ? str(legal.entity, 120) : str(ug.name, 120)) || d.name,
        address: String(x.address || (k === 'IN' ? legal.address || '' : ug.address || '')).slice(0, 400),
        taxId: str(x.taxId, 40) || (k === 'IN' ? str(legal.gstin, 40) : str(ug.vatId, 40)),
        /* the register entry: CIN in India, the Handelsregister line in Germany */
        register: k === 'IN' ? str(legal.cin, 60) : str(ug.register, 120),
        series: str(x.series, 40) || (k === 'IN' ? str(legal.invoiceSeries, 40) : '') || d.series,
        next: Math.max(1, Number(x.next) || 1),
        bank: String(x.bank || '').slice(0, 300),
      };
    });
    return out;
  };
  /* Owner, 26 Nov: "they should be able to put their own names in sales or
     purchases or expenses". The office's own kinds, beside the built-in
     ones: a name, which way the money goes, and what it counts as. Kept in
     the same place as the company details and shared by both companies. */
  const IN_TYPES = { sale: { pl: 'sale' }, income: { pl: 'income' }, none: { pl: '' } };
  const OUT_TYPES = { People: { pl: 'cost', group: 'People' }, Office: { pl: 'cost', group: 'Office' }, Students: { pl: 'cost', group: 'Students' }, none: { pl: '' } };
  const ownKinds = () => { const a = (db.content('finance') || {}).kinds; return Array.isArray(a) ? a.filter(k => k && /^x-[a-z0-9-]{3,60}$/.test(String(k.id)) && str(k.label, 60)) : []; };
  const loadKinds = () => {
    Object.keys(KINDS).forEach(k => { if (KINDS[k].custom) delete KINDS[k]; });
    ownKinds().forEach(k => {
      const dir = k.dir === 'in' ? 'in' : 'out', t = (dir === 'in' ? IN_TYPES : OUT_TYPES)[k.type] || (dir === 'in' ? IN_TYPES.income : OUT_TYPES.Office);
      KINDS[k.id] = Object.assign({ dir, label: str(k.label, 60), custom: true, type: k.type }, t);
    });
  };
  const kindUse = id => Number((F.one('SELECT COUNT(*) AS n FROM fin_lines WHERE category = ?', id) || {}).n || 0) + Number((F.one('SELECT COUNT(*) AS n FROM fin_bills WHERE category = ?', id) || {}).n || 0);
  const writeKinds = (list, who) => { const all = db.content('finance') || {}; all.kinds = list; db.setContent('finance', all, who || 'staff'); loadKinds(); };
  function addKind(b, who) {
    const label = str(b.label, 60).replace(/\s+/g, ' ').trim();
    if (label.length < 2) throw bad(422, 'A name of at least two letters.');
    const dir = b.dir === 'in' ? 'in' : b.dir === 'out' ? 'out' : '';
    if (!dir) throw bad(422, 'Say whether it is money coming in or going out.');
    const type = String(b.type || '');
    if (!(dir === 'in' ? IN_TYPES : OUT_TYPES)[type]) throw bad(422, 'Say what it counts as.');
    if (Object.keys(KINDS).some(k => KINDS[k].dir === dir && KINDS[k].label.toLowerCase() === label.toLowerCase())) throw bad(409, 'There is already a name \u201c' + label + '\u201d for money ' + (dir === 'in' ? 'coming in' : 'going out') + '.');
    const list = ownKinds();
    if (list.length >= 80) throw bad(409, 'That is 80 names of your own; remove one you do not use.');
    const id = 'x-' + (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'kind') + '-' + crypto.randomBytes(3).toString('hex');
    list.push({ id, label, dir, type });
    writeKinds(list, who);
    try { db.log(who, 'added a finance name', label + ' (' + (dir === 'in' ? 'money in' : 'money out') + ')'); } catch (e) { /* added */ }
    return { id, label, dir, type };
  }
  function renameKind(id, b, who) {
    const list = ownKinds(), k = list.find(x => x.id === String(id));
    if (!k) throw bad(404, 'No such name of your own.');
    const label = str(b.label, 60).replace(/\s+/g, ' ').trim();
    if (label.length < 2) throw bad(422, 'A name of at least two letters.');
    if (Object.keys(KINDS).some(x => x !== k.id && KINDS[x].dir === k.dir && KINDS[x].label.toLowerCase() === label.toLowerCase())) throw bad(409, 'There is already a name \u201c' + label + '\u201d.');
    k.label = label; writeKinds(list, who);
    return k;
  }
  function removeKind(id, who) {
    const list = ownKinds(), k = list.find(x => x.id === String(id));
    if (!k) throw bad(404, 'No such name of your own.');
    const n = kindUse(k.id);
    if (n) throw bad(409, '\u201c' + k.label + '\u201d is used on ' + n + ' line' + (n === 1 ? '' : 's') + ' or bills. Give those another name first; or rename this one.');
    writeKinds(list.filter(x => x.id !== k.id), who);
    return { removed: k.label };
  }
  try { loadKinds(); } catch (e) { /* the built-in names stand */ }
  const saveSettings = (company, b, who) => {
    const c = co(company), all = db.content('finance') || {}, cur = settings()[c.code];
    const next = Number(b.next);
    all[c.code] = { name: str(b.name, 120) || cur.name, address: String(b.address == null ? cur.address : b.address).slice(0, 400),
      taxId: str(b.taxId == null ? cur.taxId : b.taxId, 40), series: str(b.series, 40) || cur.series,
      next: Number.isInteger(next) && next >= cur.next ? next : cur.next, bank: String(b.bank == null ? cur.bank : b.bank).slice(0, 300) };
    db.setContent('finance', all, who || 'staff');
    return settings()[c.code];
  };

  /* ---- which company an order was sold by: rupees → India, anything else → Germany ---- */
  const companyOfOrder = o => (!o.currency || String(o.currency).toUpperCase() === 'INR') ? 'IN' : 'DE';
  /* An order's money in the company's own currency. An Indian order is in
     paise already; a foreign one keeps the local price it was charged in. */
  const unitOf = o => companyOfOrder(o) === 'IN' || !(Number(o.local_minor) > 0) ? 1 : Number(o.local_minor) / Number(o.gross_paise || 1);
  const rateOfOrder = o => {
    const m = String(o.tax_mode || '');
    if (companyOfOrder(o) === 'IN') return m === 'export' || /^eu-vat-/.test(m) ? 0 : 18;
    const v = /^eu-vat-(\d+)/.exec(m); return v ? Number(v[1]) : 0;
  };
  const openOrders = company => db.allOrders().filter(o => MONEY.EARNED.has(o.status) && companyOfOrder(o) === company).map(o => {
    const f = MONEY.figures(o), u = unitOf(o);
    return { ref: o.reference, studentId: o.student_id, name: o.name || '', email: o.email || '', package: o.package || '', date: String(o.created_at || '').slice(0, 10),
      gross: Math.round(f.grossPaise * u), received: Math.round(f.receivedPaise * u), outstanding: Math.round(f.outstandingPaise * u), taxRate: rateOfOrder(o), status: o.status };
  });

  /* ---- statements ---- */
  function importStatement(company, filename, buf, who) {
    const c = co(company);
    const st = STATEMENT.read(filename, buf, { decimal: c.code === 'DE' && /\.csv$/i.test(filename) ? ',' : '' });
    const b = F.run(`INSERT INTO fin_batches (company, filename, format, account, d_from, d_to, n_lines, n_new, opening, closing, by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`, c.code, str(filename, 160), str(st.format, 80), str(st.account, 40), st.from || '', st.to || '',
      st.lines.length, st.opening == null ? null : st.opening, st.closing == null ? null : st.closing, str(who, 80), iso());
    const batchId = Number(b.lastInsertRowid);
    /* The same file uploaded twice, or two statements that overlap, must not
       count a line twice: a line is itself by its account, day, amount,
       balance and words — and by which one of several identical lines it is. */
    const seen = {};
    let added = 0;
    st.lines.forEach(l => {
      const key = [st.account || '', l.date, l.amount, l.balance == null ? '' : l.balance, l.description.toLowerCase()].join('|');
      seen[key] = (seen[key] || 0) + 1;
      const hash = crypto.createHash('sha1').update(key + '|' + seen[key]).digest('hex');
      const r = F.run(`INSERT OR IGNORE INTO fin_lines (company, batch_id, account, date, description, ref, amount, balance, hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, c.code, batchId, str(st.account, 40), l.date, str(l.description, 400), str(l.ref, 60), l.amount, l.balance == null ? null : l.balance, hash, iso());
      if (Number(r.changes) > 0) added++;
      else { const was = F.one('SELECT id, batch_id FROM fin_lines WHERE company = ? AND hash = ?', c.code, hash); if (was && Number(was.batch_id) !== batchId) F.run('INSERT OR IGNORE INTO fin_seen (batch_id, line_id) VALUES (?, ?)', batchId, was.id); }
    });
    F.run('UPDATE fin_batches SET n_new = ? WHERE id = ?', added, batchId);
    /* a statement that brought nothing new is not listed a second time */
    if (!added && st.lines.length) { F.run('DELETE FROM fin_seen WHERE batch_id = ?', batchId); F.run('DELETE FROM fin_batches WHERE id = ?', batchId); }
    try { db.log(who, 'uploaded a bank statement', c.label + ' — ' + str(filename, 80) + ': ' + st.lines.length + ' lines, ' + added + ' new'); } catch (e) { /* the upload stands */ }
    return { batchId, format: st.format, account: st.account || '', holder: st.holder || '', from: st.from, to: st.to, lines: st.lines.length, added, already: st.lines.length - added,
      opening: st.opening, closing: st.closing, warnings: st.warnings };
  }
  /* Owner, 26 Nov: "if something is wrong in the bank statement I cannot
     delete it" — he had uploaded the wrong account's statement. A statement
     comes off whole: its lines, what they were named, and their matches to
     invoices and to payments already on the books. One thing stops it: a
     line that RECORDED a payment on a student's order, because that money is
     on the student's file and they were told. */
  function removeStatement(company, batchId, who, force) {
    const c = co(company);
    const b = F.one('SELECT * FROM fin_batches WHERE id = ? AND company = ?', Number(batchId), c.code);
    if (!b) throw bad(404, 'No such statement on this company\u2019s book.');
    let ids = F.all('SELECT id FROM fin_lines WHERE batch_id = ? AND company = ?', b.id, c.code).map(r => Number(r.id));
    /* a line another listed statement also contains stays, and belongs to that statement from now on */
    const keep = {};
    F.all('SELECT s.line_id, s.batch_id FROM fin_seen s JOIN fin_batches x ON x.id = s.batch_id WHERE s.batch_id != ? ORDER BY s.batch_id', b.id).forEach(r => { if (!keep[r.line_id]) keep[r.line_id] = r.batch_id; });
    const kept = ids.filter(id => keep[id]);
    ids = ids.filter(id => !keep[id]);
    const lk = linksOf(ids);
    const held = ids.filter(id => (lk[id] || []).some(k => k.kind === 'order'));
    if (held.length && !force) {
      const refs = [...new Set(held.flatMap(id => lk[id].filter(k => k.kind === 'order').map(k => k.order_ref)))];
      throw bad(409, held.length + ' line' + (held.length === 1 ? '' : 's') + ' of this statement recorded a payment on a student\u2019s order (' + refs.slice(0, 5).join(', ')
        + '). Removing the statement leaves those payments on the orders, as payments not yet found in the bank.', { held: held.length });
    }
    /* invoices this statement's lines raised for themselves ("a student not in the list") */
    const auto = [...new Set(ids.flatMap(id => (lk[id] || []).filter(k => k.kind === 'invoice' && k.invoice_id).map(k => Number(k.invoice_id))))];
    let links = 0;
    for (let i = 0; i < ids.length; i += 400) {
      const part = ids.slice(i, i + 400).join(',');
      links += Number(F.run('DELETE FROM fin_links WHERE line_id IN (' + part + ')').changes) || 0;
      /* a bill kept against one of these lines is not lost with the statement: it stands on its own */
      try { F.run('UPDATE fin_bills SET line_id = NULL WHERE line_id IN (' + part + ')'); } catch (e) { /* no bills table yet */ }
      F.run('DELETE FROM fin_lines WHERE id IN (' + part + ')');
    }
    kept.forEach(id => { F.run('UPDATE fin_lines SET batch_id = ? WHERE id = ?', keep[id], id); F.run('DELETE FROM fin_seen WHERE batch_id = ? AND line_id = ?', keep[id], id); });
    F.run('DELETE FROM fin_seen WHERE batch_id = ?', b.id);
    F.run('DELETE FROM fin_batches WHERE id = ?', b.id);
    autoCancel(auto, who);
    try { db.log(who, 'removed a bank statement', c.label + ' \u2014 ' + b.filename + ': ' + ids.length + ' lines, ' + links + ' matches'); } catch (e) { /* it is removed */ }
    return { removed: ids.length, matches: links, filename: b.filename, kept: kept.length };
  }
  /* Owner, 25 Nov: "we can have multiple bank accounts". A company's book is
     all its accounts together; each line remembers which account's
     statement it came from, and the screen can show one account alone. */
  const accounts = company => F.all('SELECT account, COUNT(*) AS n, MIN(date) AS d_from, MAX(date) AS d_to FROM fin_lines WHERE company = ? GROUP BY account ORDER BY account', co(company).code)
    .map(a => ({ account: a.account, lines: Number(a.n), from: a.d_from, to: a.d_to }));
  const batches = company => F.all('SELECT * FROM fin_batches WHERE company = ? ORDER BY id DESC LIMIT 60', co(company).code);
  const batchById = id => F.one('SELECT * FROM fin_batches WHERE id = ?', Number(id));

  /* ---- lines, and what each is matched to ---- */
  const linksOf = ids => {
    const by = {};
    if (!ids.length) return by;
    for (let i = 0; i < ids.length; i += 400) {
      F.all('SELECT * FROM fin_links WHERE line_id IN (' + ids.slice(i, i + 400).map(Number).join(',') + ') ORDER BY id').forEach(k => { (by[k.line_id] || (by[k.line_id] = [])).push(k); });
    }
    return by;
  };
  const shape = (l, links) => {
    const matched = (links || []).reduce((a, k) => a + Number(k.amount), 0);
    const size = Math.abs(l.amount);
    const state = l.category ? 'named' : matched >= size && size > 0 ? 'matched' : matched > 0 ? 'part' : 'open';
    return { id: l.id, date: l.date, description: l.description, ref: l.ref, amount: l.amount, balance: l.balance, account: l.account,
      category: l.category, party: l.party, taxRate: l.tax_rate, note: l.note, state, matched, left: l.category ? 0 : Math.max(0, size - matched),
      links: (links || []).map(k => ({ id: k.id, kind: k.kind, orderRef: k.order_ref, paymentId: k.payment_id, invoiceId: k.invoice_id, amount: k.amount,
        invoice: k.invoice_id ? ((F.one('SELECT number, party, kind FROM fin_invoices WHERE id = ?', k.invoice_id) || {})) : null })),
      guess: l.category || matched ? '' : ((GUESS.find(g => g[0].test(l.description) && KINDS[g[1]].dir === (l.amount > 0 ? 'in' : 'out')) || [])[1] || '') };
  };
  function lines(company, q) {
    const c = co(company); q = q || {};
    const where = ['company = ?'], args = [c.code];
    if (isDay(q.from)) { where.push('date >= ?'); args.push(q.from); }
    if (isDay(q.to)) { where.push('date <= ?'); args.push(q.to); }
    if (q.dir === 'in') where.push('amount > 0'); else if (q.dir === 'out') where.push('amount < 0');
    if (q.account) { where.push('account = ?'); args.push(String(q.account)); }
    const rows = F.all('SELECT * FROM fin_lines WHERE ' + where.join(' AND ') + ' ORDER BY date DESC, id DESC LIMIT 3000', ...args);
    const lk = linksOf(rows.map(r => r.id));
    let out = rows.map(r => shape(r, lk[r.id]));
    if (q.state === 'todo') out = out.filter(l => l.state === 'open' || l.state === 'part');
    else if (q.state === 'done') out = out.filter(l => l.state === 'matched' || l.state === 'part');
    else if (q.state) out = out.filter(l => l.state === q.state);
    return out;
  }
  const lineById = (company, id) => {
    const l = F.one('SELECT * FROM fin_lines WHERE id = ? AND company = ?', Number(id), co(company).code);
    if (!l) throw bad(404, 'No such line on this company’s statement.');
    return l;
  };
  /* Name a line: salaries, rent, capital… A line already matched to a
     student or an invoice is not also named — it is one thing or the other. */
  function nameLine(company, id, b, who) {
    const l = lineById(company, id), c = co(company);
    const kind = String(b.category || '');
    if (kind && !KINDS[kind]) throw bad(422, 'Choose a kind from the list.');
    if (kind && KINDS[kind].dir !== (l.amount > 0 ? 'in' : 'out')) throw bad(422, 'That kind is for money ' + (KINDS[kind].dir === 'in' ? 'coming in' : 'going out') + '; this line is the other way.');
    if (kind && F.one('SELECT 1 AS x FROM fin_links WHERE line_id = ?', l.id)) throw bad(409, 'This line is already matched. Take the match off first.');
    const rate = Number(b.taxRate) || 0;
    if (rate && !c.rates.includes(rate)) throw bad(422, c.tax + ' is ' + c.rates.join('% or ') + '% here.');
    F.run('UPDATE fin_lines SET category = ?, party = ?, tax_rate = ?, note = ?, by_name = ? WHERE id = ?',
      kind, str(b.party, 120), kind && (KINDS[kind].pl.indexOf('cost') === 0 || KINDS[kind].pl === 'sale') ? rate : 0, str(b.note, 300), str(who, 80), l.id);
    return shape(F.one('SELECT * FROM fin_lines WHERE id = ?', l.id), []);
  }

  /*
   * Match money in to what it paid for. `targets` is one or several of:
   *   { type: 'order',   ref,  amount }  a student's order — RECORDS the payment on it
   *   { type: 'payment', id          }  a payment already on the books (the gateway's, or one typed in)
   *   { type: 'invoice', id,  amount }  an invoice to a partner, a university or anyone
   * One line can pay several students; one student can be paid by several lines.
   */
  function match(company, id, targets, staff) {
    const c = co(company), l = lineById(company, id);
    if (!(l.amount > 0)) throw bad(422, 'Only money coming in is matched. Give money going out a kind instead.');
    if (l.category) throw bad(409, 'This line was given a kind (' + KINDS[l.category].label + '). Clear that first.');
    if (!Array.isArray(targets) || !targets.length || targets.some(t => !t || typeof t !== 'object')) throw bad(422, 'Choose what this money paid for.');
    if (targets.length > 60) throw bad(422, 'That is too many at once; match them in two goes.');
    const already = F.all('SELECT * FROM fin_links WHERE line_id = ?', l.id).reduce((a, k) => a + Number(k.amount), 0);
    let left = l.amount - already;
    /* Check everything before writing anything: a payment recorded on an
       order cannot be un-recorded from here. */
    const plan = targets.map(t => {
      const type = String(t.type || '');
      if (type === 'order') {
        const o = db.orderByReference(String(t.ref || ''));
        if (!o || !MONEY.EARNED.has(o.status)) throw bad(404, 'No open order ' + str(t.ref, 30) + '.');
        if (companyOfOrder(o) !== c.code) throw bad(422, 'Order ' + o.reference + ' was sold by the other company.');
        const u = unitOf(o), owed = Math.round(MONEY.figures(o).outstandingPaise * u);
        const amount = amt(t.amount, 'The amount for ' + o.reference);
        if (amount > owed) throw bad(422, 'Only ' + fmt(c, owed) + ' is outstanding on ' + o.reference + '.');
        return { type, order: o, amount, paise: u === 1 ? amount : Math.min(MONEY.figures(o).outstandingPaise, Math.round(amount / u)) };
      }
      if (type === 'payment') {
        const p = db.allPaymentsLite().find(x => Number(x.id) === Number(t.id));
        if (!p || p.kind !== 'payment') throw bad(404, 'No such payment.');
        const o = db.orderByReference(p.order_ref);
        if (!o || companyOfOrder(o) !== c.code) throw bad(422, 'That payment belongs to the other company.');
        /* a payment found in part on one line can have the rest found on another */
        const had = Number((F.one('SELECT COALESCE(SUM(amount), 0) AS s FROM fin_links WHERE kind IN (\'payment\', \'order\') AND payment_id = ?', Number(p.id)) || {}).s) || 0;
        const full = Math.round(Number(p.paise) * unitOf(o)) - had;
        if (full <= 0) throw bad(409, 'That payment is already matched to a bank line.');
        const amount = t.amount == null || t.amount === '' ? full : amt(t.amount, 'The amount for that payment');
        if (amount > full) throw bad(422, 'Up to ' + fmt(c, full) + ' for that payment.');
        return { type, payment: p, order: o, amount };
      }
      if (type === 'invoice') {
        const inv = F.one('SELECT * FROM fin_invoices WHERE id = ? AND company = ?', Number(t.id), c.code);
        if (!inv || inv.status === 'cancelled') throw bad(404, 'No such open invoice.');
        if (inv.order_ref) throw bad(422, 'That invoice is for a student’s order — match the money to the order itself.');
        const owed = inv.gross - paidOnInvoice(inv);
        const amount = amt(t.amount, 'The amount for invoice ' + inv.number);
        if (amount > owed) throw bad(422, 'Only ' + fmt(c, owed) + ' is unpaid on invoice ' + inv.number + '.');
        return { type, invoice: inv, amount };
      }
      if (type === 'student') {
        /* Owner, 26 Nov: "I cannot add student payment to the bank line". A
           student who paid with no order and no invoice on the books: the
           invoice is raised for this money, dated the day it arrived, and
           the line is matched to it. */
        const st = db.studentById(Number(t.studentId));
        if (!st || st.role !== 'student') throw bad(404, 'Choose a student.');
        const amount = amt(t.amount, 'The amount for ' + st.name);
        const rate = t.taxRate == null || t.taxRate === '' ? c.rates[0] : Number(t.taxRate);
        if (!c.rates.includes(rate)) throw bad(422, c.tax + ' is ' + c.rates.join('% or ') + '% here.');
        return { type, student: st, amount, rate, text: str(t.text, 200) };
      }
      throw bad(422, 'Match to an order, a payment, an invoice or a student.');
    });
    const total = plan.reduce((a, p) => a + p.amount, 0);
    if (total > left) throw bad(422, 'That is ' + fmt(c, total) + ', and only ' + fmt(c, left) + ' of this line is still unmatched.');
    const refs = plan.filter(p => p.type === 'order').map(p => p.order.reference);
    if (new Set(refs).size !== refs.length) throw bad(422, 'The same order is listed twice.');
    /* the same invoice or the same payment twice in one go would be checked
       twice against what is owed and paid twice over */
    const invIds = plan.filter(p => p.type === 'invoice').map(p => p.invoice.id), payIds = plan.filter(p => p.type === 'payment').map(p => Number(p.payment.id));
    if (new Set(invIds).size !== invIds.length) throw bad(422, 'The same invoice is listed twice.');
    if (new Set(payIds).size !== payIds.length) throw bad(422, 'The same payment is listed twice.');
    const done = [];
    plan.forEach(p => {
      let paymentId = p.payment ? Number(p.payment.id) : null;
      if (p.type === 'order') {
        const got = takePayment(db.orderByReference(p.order.reference), { paise: p.paise, day: l.date, method: /\bUPI\b/i.test(l.description) ? 'upi' : 'bank',
          reference: l.ref || '', note: 'Bank statement, ' + l.date, staff, partN: null });
        paymentId = got && got.payment ? Number(got.payment.id) : null;
      }
      if (p.type === 'student') {
        const made = createInvoice(c.code, { kind: 'student', studentId: p.student.id, amount: p.amount, text: p.text, taxRate: p.rate, date: l.date > today() ? today() : l.date, note: AUTO_NOTE + l.date }, staff && staff.name);
        p.invoice = { id: made.id, number: made.number };
      }
      F.run('INSERT INTO fin_links (line_id, kind, order_ref, payment_id, invoice_id, amount, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        l.id, p.type === 'student' ? 'invoice' : p.type, p.order ? p.order.reference : '', paymentId, p.invoice ? p.invoice.id : null, p.amount, str(staff && staff.name, 80), iso());
      done.push({ type: p.type, ref: p.order ? p.order.reference : p.invoice ? p.invoice.number : '', amount: p.amount });
    });
    return { line: shape(F.one('SELECT * FROM fin_lines WHERE id = ?', l.id), F.all('SELECT * FROM fin_links WHERE line_id = ? ORDER BY id', l.id)), done };
  }
  /* An invoice that a bank line raised for itself exists because of that
     money. When the match is taken off, or the statement removed, and nothing
     else has been received on it, it is cancelled rather than left as a debt
     the student never had. Its number is not reused. */
  const AUTO_NOTE = 'Raised for the bank receipt of ';
  const autoCancel = (invoiceIds, who) => {
    (invoiceIds || []).forEach(id => {
      const inv = F.one('SELECT * FROM fin_invoices WHERE id = ?', Number(id));
      if (!inv || inv.status === 'cancelled' || inv.order_ref || String(inv.note || '').indexOf(AUTO_NOTE) !== 0) return;
      if (Number((F.one("SELECT COUNT(*) AS n FROM fin_links WHERE invoice_id = ? AND kind IN ('invoice', 'cash')", inv.id) || {}).n) > 0) return;
      F.run("UPDATE fin_invoices SET status = 'cancelled' WHERE id = ?", inv.id);
      try { db.log(who || 'finance', 'cancelled an invoice', inv.number + ' \u2014 the bank receipt it was raised for was taken off'); } catch (e) { /* done */ }
    });
  };
  /* Take a match off. A match that RECORDED a payment on a student's order
     stays: that money is on their file and they were told — it is put right
     on the order (a refund), not by forgetting it here. */
  function unmatch(company, id, linkId) {
    const l = lineById(company, id);
    const k = F.one('SELECT * FROM fin_links WHERE id = ? AND line_id = ?', Number(linkId), l.id);
    if (!k) throw bad(404, 'No such match on this line.');
    /* Owner, 26 Nov: "it cannot be one way". A match to an order comes off
       like any other. What it recorded on the student's file stays there as
       a payment not yet found in the bank (Reconciliation lists it), to be
       tied to the right line or refunded on the order — taking a tick off a
       bank line must not quietly change what a student has been told they
       paid. */
    F.run('DELETE FROM fin_links WHERE id = ?', k.id);
    if (k.kind === 'invoice' && k.invoice_id) autoCancel([Number(k.invoice_id)], 'finance');
    if (k.kind === 'order') { try { db.log('finance', 'took a bank match off', k.order_ref + ' \u2014 line of ' + l.date + '; the payment stays on the order'); } catch (e) { /* done */ } }
    return shape(F.one('SELECT * FROM fin_lines WHERE id = ?', l.id), F.all('SELECT * FROM fin_links WHERE line_id = ? ORDER BY id', l.id));
  }

  /* What a line of money in could be: orders and invoices still owed, and
     payments on the books that no bank line has claimed — the likeliest first. */
  function candidates(company, id) {
    const c = co(company), l = lineById(company, id);
    if (!(l.amount > 0)) return { orders: [], payments: [], invoices: [] };
    const words = l.description.toLowerCase();
    const near = (name) => String(name || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && words.includes(w)).length;
    const found = {}; F.all('SELECT payment_id, SUM(amount) AS s FROM fin_links WHERE payment_id IS NOT NULL GROUP BY payment_id').forEach(r => { found[Number(r.payment_id)] = Number(r.s) || 0; });
    const orders = openOrders(c.code).filter(o => o.outstanding > 0).map(o => Object.assign(o, { score: (o.outstanding === l.amount ? 5 : 0) + near(o.name) * 3, named: near(o.name) > 0 }));
    const byRef = {}; db.allOrders().forEach(o => { byRef[o.reference] = o; });
    const payments = db.allPaymentsLite().filter(p => p.kind === 'payment' && byRef[p.order_ref] && companyOfOrder(byRef[p.order_ref]) === c.code && Math.round(Number(p.paise) * unitOf(byRef[p.order_ref])) - (found[Number(p.id)] || 0) > 0).map(p => {
      const o = byRef[p.order_ref], amount = Math.round(Number(p.paise) * unitOf(o)) - (found[Number(p.id)] || 0);
      const days = Math.abs((Date.parse(String(p.at).slice(0, 10)) - Date.parse(l.date)) / 86400000);
      return { id: p.id, orderRef: p.order_ref, name: o.name || '', date: String(p.at).slice(0, 10), method: p.method, reference: p.reference, amount,
        score: (amount === l.amount ? 5 : 0) + (p.reference && l.ref && String(p.reference).includes(l.ref) ? 6 : 0) + (days <= 3 ? 2 : 0) + near(o.name) * 3 };
    }).filter(p => p.score > 0 || Math.abs(Date.parse(p.date) - Date.parse(l.date)) <= 45 * 86400000);
    const invs = invoices(c.code).filter(i => !i.orderRef && i.status === 'open' && i.outstanding > 0).map(i => Object.assign(i, { score: (i.outstanding === l.amount ? 5 : 0) + near(i.party) * 3 + (words.includes(String(i.number).toLowerCase()) ? 8 : 0),
      /* the bank's own words name them (or the invoice number): only then is an amount offered ready-typed */
      named: near(i.party) > 0 || words.includes(String(i.number).toLowerCase()) }));
    const top = a => a.sort((x, y) => y.score - x.score || String(y.date).localeCompare(String(x.date))).slice(0, 80);
    /* of one party's invoices, the oldest is the one the money is for */
    return { orders: top(orders), payments: top(payments), invoices: invs.sort((x, y) => y.score - x.score || Number(x.id) - Number(y.id)).slice(0, 80) };
  }

  /* ---- invoices ---- */
  /* Owner, 25 Nov: "counsellors should be able to create multiple invoices
     for a student instead of one … 30k INR total to receive, they may create
     4 to 5 invoices for the same 30k. We receive multiple payments from
     students, not once." So an order can carry several invoices, each for a
     part of it; what the student has paid on the order settles them in the
     order they were raised, oldest first. */
  const invoicesOfOrder = ref => F.all('SELECT * FROM fin_invoices WHERE order_ref = ? AND status != \'cancelled\' ORDER BY id', String(ref));
  const paidOnInvoice = inv => {
    if (inv.order_ref) {
      const o = db.orderByReference(inv.order_ref);
      if (!o || inv.status === 'cancelled') return 0;
      let left = Math.round(MONEY.figures(o).receivedPaise * unitOf(o));
      for (const x of invoicesOfOrder(inv.order_ref)) {
        const take = Math.min(left, x.gross);
        if (Number(x.id) === Number(inv.id)) return take;
        left -= take;
      }
      return 0;
    }
    const r = F.one('SELECT COALESCE(SUM(amount), 0) AS s FROM fin_links WHERE kind IN (\'invoice\', \'cash\') AND invoice_id = ?', inv.id);
    return Number(r && r.s) || 0;
  };
  const invShape = inv => {
    const paid = paidOnInvoice(inv);
    let items = []; try { items = JSON.parse(inv.lines || '[]'); } catch (e) { items = []; }
    return { id: inv.id, number: inv.number, kind: inv.kind, party: inv.party, email: inv.email, address: inv.address, taxId: inv.tax_id, studentId: inv.student_id, orderRef: inv.order_ref,
      date: inv.issue_date, due: inv.due_date, currency: inv.currency, items, net: inv.net, tax: inv.tax, gross: inv.gross, taxRate: inv.tax_rate, note: inv.note,
      cash: inv.order_ref ? 0 : Number((F.one('SELECT COALESCE(SUM(amount), 0) AS s FROM fin_links WHERE kind = \'cash\' AND invoice_id = ?', inv.id) || {}).s) || 0,
      status: inv.status, paid, outstanding: inv.status === 'cancelled' ? 0 : Math.max(0, inv.gross - paid),
      state: inv.status === 'cancelled' ? 'cancelled' : paid >= inv.gross ? 'paid' : paid > 0 ? 'part' : (inv.due_date && inv.due_date < today() ? 'overdue' : 'unpaid') };
  };
  function invoices(company, q) {
    const c = co(company); q = q || {};
    let out = F.all('SELECT * FROM fin_invoices WHERE company = ? ORDER BY id DESC LIMIT 2000', c.code).map(invShape);
    if (q.kind) out = out.filter(i => i.kind === q.kind);
    if (q.state === 'owed') out = out.filter(i => i.outstanding > 0);
    return out;
  }
  /*
   * Raise an invoice. The number comes from the company's own series and is
   * never used twice, cancelled or not. Amounts typed are what the customer
   * pays (tax inside), as on the rest of the site.
   *   kind 'student' with orderRef → the order's own name, amount and tax;
   *   kind 'partner' or 'manual'   → party and lines as typed.
   */
  function createInvoice(company, b, who) {
    const c = co(company);
    const kind = ['student', 'partner', 'manual'].includes(b.kind) ? b.kind : 'manual';
    let party = str(b.party, 160), email = str(b.email, 160), address = String(b.address || '').slice(0, 400), taxId = str(b.taxId, 40);
    let items, rate, studentId = null, orderRef = '';
    if (kind === 'student' && b.orderRef) {
      const o = db.orderByReference(String(b.orderRef));
      if (!o) throw bad(404, 'No such order.');
      if (companyOfOrder(o) !== c.code) throw bad(422, 'That order was sold by the other company.');
      if (!MONEY.EARNED.has(o.status)) throw bad(409, 'Order ' + o.reference + ' is not an open order.');
      orderRef = o.reference; studentId = o.student_id || null;
      party = party || str(o.name, 160); email = email || str(o.email, 160);
      rate = rateOfOrder(o);
      /* Part of the order, or all that is left of it: the invoices of one
         order never add up to more than the order. */
      const total = Math.round(Number(o.gross_paise || 0) * unitOf(o));
      const invoiced = invoicesOfOrder(o.reference).reduce((a, x) => a + x.gross, 0);
      const room = total - invoiced;
      if (room <= 0) throw bad(409, 'Order ' + o.reference + ' is already invoiced in full (' + fmt(c, total) + ').');
      const amount = b.amount == null || b.amount === '' ? room : amt(b.amount);
      if (amount > room) throw bad(422, 'Only ' + fmt(c, room) + ' of order ' + o.reference + ' is not yet invoiced.');
      const nth = invoicesOfOrder(o.reference).length + 1;
      items = [{ text: str(b.text, 200) || ((str(o.package, 160) || 'Services') + (amount < total ? ' \u2014 part ' + nth : '')), amount }];
    } else if (kind === 'student') {
      /* Owner, 26 Nov: "there is no option to create invoice" — only a
         student with an order on the site could be invoiced, and most
         students agree their fee on the phone. Any student can be invoiced
         for an amount; several invoices, one per instalment, as before. */
      const st = db.studentById(Number(b.studentId));
      if (!st || st.role !== 'student') throw bad(422, 'Choose a student.');
      studentId = st.id; party = party || str(st.name, 160); email = email || str(st.email, 160);
      rate = b.taxRate == null || b.taxRate === '' ? c.rates[0] : Number(b.taxRate);
      if (!c.rates.includes(rate)) throw bad(422, c.tax + ' is ' + c.rates.join('% or ') + '% here.');
      const amount = amt(b.amount);
      items = [{ text: str(b.text, 200) || 'Education consulting services', amount }];
    } else {
      rate = b.taxRate == null || b.taxRate === '' ? 0 : Number(b.taxRate);
      if (!c.rates.includes(rate)) throw bad(422, c.tax + ' is ' + c.rates.join('% or ') + '% here.');
      /* every line typed is on the invoice or the invoice is refused: a line
         quietly dropped is a total nobody agreed to */
      const typed = (Array.isArray(b.items) ? b.items : []).filter(i => i && (str(i.text, 200) || (i.amount != null && i.amount !== '' && i.amount !== 0)));
      if (typed.length > 30) throw bad(422, 'An invoice takes up to 30 lines; this one has ' + typed.length + '.');
      items = typed.map((i, n) => { if (!str(i.text, 200)) throw bad(422, 'Line ' + (n + 1) + ' has an amount and no description.'); return { text: str(i.text, 200), amount: amt(i.amount, 'The amount on line ' + (n + 1)) }; });
      if (!items.length) throw bad(422, 'At least one line: what it is for, and the amount.');
      if (!party) throw bad(422, 'Who is the invoice to?');
    }
    const gross = items.reduce((a, i) => a + i.amount, 0);
    const tax = taxIn(gross, rate);
    const date = dayOr(b.date, 'The invoice date', today());
    if (date > today()) throw bad(422, 'The invoice date cannot be in the future.');
    const due = dayOr(b.due, 'The due date', '');
    if (gross > MAX_AMOUNT) throw bad(422, 'The total is too large to be right.');
    const all = db.content('finance') || {}, s = settings()[c.code];
    let n = s.next, number;
    do { number = s.series + String(n).padStart(4, '0'); n++; } while (F.one('SELECT 1 AS x FROM fin_invoices WHERE company = ? AND number = ?', c.code, number));
    const r = F.run(`INSERT INTO fin_invoices (company, number, kind, party, email, address, tax_id, student_id, order_ref, issue_date, due_date, currency, lines, net, tax, gross, tax_rate, status, note, by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`, c.code, number, kind, party, email, address, taxId, studentId, orderRef, date,
      due, c.currency, JSON.stringify(items), gross - tax, tax, gross, rate, str(b.note, 400), str(who, 80), iso());
    all[c.code] = Object.assign({}, s, { next: n });
    db.setContent('finance', all, who || 'staff');
    try { db.log(who, 'raised an invoice', c.label + ' — ' + number + ' to ' + party + ', ' + fmt(c, gross)); } catch (e) { /* the invoice stands */ }
    return invShape(F.one('SELECT * FROM fin_invoices WHERE id = ?', Number(r.lastInsertRowid)));
  }
  /* Owner, 26 Nov: "delete, update, save, edit … proper options". An invoice
     can be corrected after it is raised: who it is to, what it says, when it
     is due. Its amount can change only while nothing has been received on
     it and it is not part of an order (an order's invoice is cancelled and
     raised again, so the order's total is checked afresh). Its number never
     changes. */
  function updateInvoice(company, id, b, who) {
    const c = co(company), inv = F.one('SELECT * FROM fin_invoices WHERE id = ? AND company = ?', Number(id), c.code);
    if (!inv) throw bad(404, 'No such invoice.');
    if (inv.status === 'cancelled') throw bad(409, 'Invoice ' + inv.number + ' is cancelled.');
    let items = []; try { items = JSON.parse(inv.lines || '[]'); } catch (e) { items = []; }
    let gross = inv.gross, rate = inv.tax_rate;
    if (b.text != null && items[0] && str(b.text, 200)) items[0].text = str(b.text, 200);
    const newAmount = b.amount != null && b.amount !== '' ? amt(b.amount) : inv.gross;
    const wantAmount = newAmount !== inv.gross;
    const newDate = dayOr(b.date, 'The invoice date', inv.issue_date);
    if (newDate > today()) throw bad(422, 'The invoice date cannot be in the future.');
    const newDue = b.due == null ? inv.due_date : dayOr(b.due, 'The due date', '');
    const wantRate = b.taxRate != null && b.taxRate !== '' && Number(b.taxRate) !== inv.tax_rate;
    if (wantAmount || wantRate) {
      if (inv.order_ref) throw bad(409, 'This invoice is part of order ' + inv.order_ref + '. To change its amount, cancel it and raise it again.');
      if (paidOnInvoice(inv) > 0) throw bad(409, 'Money has been received on invoice ' + inv.number + '. Take that off first, then change the amount.');
      if (wantRate) { rate = Number(b.taxRate); if (!c.rates.includes(rate)) throw bad(422, c.tax + ' is ' + c.rates.join('% or ') + '% here.'); }
      if (wantAmount) {
        if (items.length !== 1) throw bad(409, 'This invoice has several lines. Cancel it and raise it again to change the amounts.');
        gross = newAmount;
        items[0].amount = gross;
      }
    }
    const tax = taxIn(gross, rate);
    F.run('UPDATE fin_invoices SET issue_date = ?, party = ?, email = ?, address = ?, tax_id = ?, due_date = ?, note = ?, lines = ?, net = ?, tax = ?, gross = ?, tax_rate = ? WHERE id = ?', newDate,
      b.party != null && str(b.party, 160) ? str(b.party, 160) : inv.party, b.email != null ? str(b.email, 160) : inv.email, b.address != null ? String(b.address).slice(0, 400) : inv.address,
      b.taxId != null ? str(b.taxId, 40) : inv.tax_id, newDue, b.note != null ? str(b.note, 400) : inv.note,
      JSON.stringify(items), gross - tax, tax, gross, rate, inv.id);
    try { db.log(who, 'edited an invoice', c.label + ' \u2014 ' + inv.number + (gross !== inv.gross ? ', ' + fmt(c, inv.gross) + ' \u2192 ' + fmt(c, gross) : '')); } catch (e) { /* saved */ }
    return invShape(F.one('SELECT * FROM fin_invoices WHERE id = ?', inv.id));
  }
  /* Owner, 26 Nov: "I cannot open the invoice in the same screen … we should
     be able to see the details". One invoice with everything about it: its
     lines, the tax, and each receipt against it — which bank line, on what
     day, from which account, or cash — and what is still unpaid. */
  function invoiceDetail(company, id) {
    const c = co(company), inv = F.one('SELECT * FROM fin_invoices WHERE id = ? AND company = ?', Number(id), c.code);
    if (!inv) throw bad(404, 'No such invoice.');
    const out = invShape(inv);
    out.by = inv.by_name; out.raisedAt = inv.created_at; out.receipts = [];
    if (inv.order_ref) {
      const o = db.orderByReference(inv.order_ref);
      out.order = o ? { ref: o.reference, package: o.package || '', total: Math.round(Number(o.gross_paise || 0) * unitOf(o)), received: Math.round(MONEY.figures(o).receivedPaise * unitOf(o)) } : null;
      const linked = {}; F.all('SELECT payment_id, line_id FROM fin_links WHERE payment_id IS NOT NULL').forEach(k => { linked[Number(k.payment_id)] = k.line_id; });
      if (o) db.allPaymentsLite().filter(p => p.order_ref === o.reference).forEach(p => {
        const l = linked[Number(p.id)] ? F.one('SELECT * FROM fin_lines WHERE id = ?', linked[Number(p.id)]) : null;
        out.receipts.push({ how: p.kind === 'refund' ? 'refund' : l ? 'bank' : String(p.method) === 'cash' ? 'cash' : 'other', method: p.method, date: String(p.at || '').slice(0, 10), amount: Math.round(Number(p.paise) * unitOf(o)),
          description: l ? l.description : (p.reference || p.note || ''), account: l ? l.account : '', lineId: l ? l.id : null, onOrder: true });
      });
    } else {
      F.all("SELECT * FROM fin_links WHERE invoice_id = ? AND kind IN ('invoice', 'cash') ORDER BY id", inv.id).forEach(k => {
        const l = k.kind === 'invoice' ? F.one('SELECT * FROM fin_lines WHERE id = ?', k.line_id) : null;
        out.receipts.push({ how: k.kind === 'cash' ? 'cash' : 'bank', date: l ? l.date : String(k.created_at).slice(0, 10), amount: k.amount, description: l ? l.description : 'Cash', account: l ? l.account : '', lineId: l ? l.id : null, linkId: k.id, by: k.by_name });
      });
    }
    const me = settings()[c.code];
    out.seller = { name: me.name, address: me.address, taxId: me.taxId, register: me.register || '' };
    out.symbol = c.symbol; out.locale = c.locale; out.tax_name = c.tax;
    return out;
  }
  function cancelInvoice(company, id, who) {
    const c = co(company), inv = F.one('SELECT * FROM fin_invoices WHERE id = ? AND company = ?', Number(id), c.code);
    if (!inv) throw bad(404, 'No such invoice.');
    if (inv.status === 'cancelled') throw bad(409, 'Invoice ' + inv.number + ' is already cancelled.');
    if (!inv.order_ref && paidOnInvoice(inv) > 0) throw bad(409, 'Money has been received on this invoice. Take the bank match or the cash off first (open the invoice to see them).');
    F.run('UPDATE fin_invoices SET status = \'cancelled\' WHERE id = ?', inv.id);
    try { db.log(who, 'cancelled an invoice', c.label + ' — ' + inv.number); } catch (e) { /* done */ }
    return invShape(F.one('SELECT * FROM fin_invoices WHERE id = ?', inv.id));
  }
  /* Owner, 25 Nov: "or paid via cash". Cash against an invoice that has no
     order behind it (an order's cash is recorded on the order, as before).
     It settles the invoice and is counted as cash; it is on no bank
     statement, so it is not in the bank-date profit and loss until the
     cash is paid in and that deposit is named. */
  function cashOnInvoice(company, id, b, who) {
    const c = co(company), inv = F.one('SELECT * FROM fin_invoices WHERE id = ? AND company = ?', Number(id), c.code);
    if (!inv || inv.status === 'cancelled') throw bad(404, 'No such open invoice.');
    if (inv.order_ref) throw bad(422, 'That invoice is for an order \u2014 record the cash on the order itself.');
    const owed = inv.gross - paidOnInvoice(inv);
    if (owed <= 0) throw bad(409, 'Invoice ' + inv.number + ' is already paid in full.');
    const amount = b.amount == null || b.amount === '' ? owed : amt(b.amount);
    if (amount > owed) throw bad(422, 'Only ' + fmt(c, owed) + ' is unpaid on invoice ' + inv.number + '.');
    const day = dayOr(b.date, 'The date of the cash', today());
    if (day > today()) throw bad(422, 'Cash cannot be received on a day that has not come.');
    F.run('INSERT INTO fin_links (line_id, kind, order_ref, payment_id, invoice_id, amount, by_name, created_at) VALUES (0, \'cash\', \'\', NULL, ?, ?, ?, ?)',
      inv.id, amount, str(who, 80), day + 'T00:00:00.000Z');
    try { db.log(who, 'recorded cash on an invoice', c.label + ' \u2014 ' + inv.number + ', ' + fmt(c, amount)); } catch (e) { /* recorded */ }
    return invShape(F.one('SELECT * FROM fin_invoices WHERE id = ?', inv.id));
  }
  function undoCash(company, id, who, linkId) {
    const c = co(company), inv = F.one('SELECT * FROM fin_invoices WHERE id = ? AND company = ?', Number(id), c.code);
    if (!inv) throw bad(404, 'No such invoice.');
    /* one entry when the caller says which; every cash entry on it otherwise */
    const n = Number((linkId ? F.run('DELETE FROM fin_links WHERE kind = \'cash\' AND invoice_id = ? AND id = ?', inv.id, Number(linkId)) : F.run('DELETE FROM fin_links WHERE kind = \'cash\' AND invoice_id = ?', inv.id)).changes) || 0;
    if (!n) throw bad(409, 'No cash is recorded on invoice ' + inv.number + '.');
    try { db.log(who, 'took cash off an invoice', c.label + ' \u2014 ' + inv.number); } catch (e) { /* done */ }
    return invShape(F.one('SELECT * FROM fin_invoices WHERE id = ?', inv.id));
  }
  /*
   * Bills (owner, 26 Nov: "upload purchase invoices we pay — we buy a table
   * or go for a team lunch — we should be able to upload the bill and save
   * it so that we can see it in future"). A bill is the supplier's paper for
   * a purchase: kept against the bank line that paid it, or on its own when
   * it was paid in cash and no line exists. The file itself is written by
   * the caller; this is the record of it.
   */
  const BILL_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic' };
  const billShape = b => ({ id: b.id, lineId: b.line_id || null, filename: b.filename, size: b.size, date: b.date, party: b.party, amount: b.amount,
    category: b.category, label: b.category && KINDS[b.category] ? KINDS[b.category].label : '', note: b.note, by: b.by_name, at: b.created_at });
  function addBill(company, b, who) {
    const c = co(company);
    let lineId = null, date = dayOr(b.date, 'The date on the bill', ''), party = str(b.party, 120), amount = b.amount == null || b.amount === '' ? 0 : amt(b.amount, 'The amount on the bill'), category = '';
    if (date && date > today()) throw bad(422, 'The bill\u2019s date cannot be in the future.');
    if (b.lineId) {
      const l = lineById(c.code, b.lineId);
      if (!(l.amount < 0)) throw bad(422, 'A bill is kept against money going out.');
      lineId = l.id; date = date || l.date; party = party || l.party; amount = amount || Math.abs(l.amount); category = l.category || '';
    } else {
      if (!date) throw bad(422, 'The date on the bill.');
      if (date > today()) throw bad(422, 'The bill\u2019s date cannot be in the future.');
      if (!party) throw bad(422, 'Who the bill is from.');
      if (!(amount > 0)) throw bad(422, 'The amount on the bill.');
      category = String(b.category || '');
      if (category && !(KINDS[category] && KINDS[category].dir === 'out')) throw bad(422, 'Choose a kind of cost from the list.');
    }
    const r = F.run('INSERT INTO fin_bills (company, line_id, filename, stored, size, date, party, amount, category, note, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      c.code, lineId, str(b.filename, 160), String(b.stored), Number(b.size) || 0, date, party, amount, category, str(b.note, 300), str(who, 80), iso());
    try { db.log(who, 'kept a bill', c.label + ' \u2014 ' + str(b.filename, 80) + (party ? ', ' + party : '') + ', ' + fmt(c, amount)); } catch (e) { /* kept */ }
    return billShape(F.one('SELECT * FROM fin_bills WHERE id = ?', Number(r.lastInsertRowid)));
  }
  const billRaw = (company, id) => F.one('SELECT * FROM fin_bills WHERE id = ? AND company = ?', Number(id), co(company).code);
  const billAny = id => F.one('SELECT * FROM fin_bills WHERE id = ?', Number(id));
  function bills(company, year) {
    const c = co(company), y = yearOf(c, year);
    const all = F.all('SELECT * FROM fin_bills WHERE company = ? ORDER BY date DESC, id DESC LIMIT 5000', c.code);
    const byLine = {}; all.forEach(b => { if (b.line_id) (byLine[b.line_id] || (byLine[b.line_id] = [])).push(billShape(b)); });
    const loose = all.filter(b => !b.line_id && b.date >= y.from && b.date <= y.to).map(billShape);
    return { byLine, loose, looseTotal: loose.reduce((a, b) => a + b.amount, 0), count: all.length };
  }
  function updateBill(company, id, b, who) {
    const row = billRaw(company, id); if (!row) throw bad(404, 'No such bill.');
    const date = dayOr(b.date, 'The date on the bill', row.date);
    if (date > today()) throw bad(422, 'The bill\u2019s date cannot be in the future.');
    if (b.party != null && !row.line_id && !str(b.party, 120)) throw bad(422, 'Who the bill is from.');
    /* a bill kept on its own can be put against the bank line that paid it, and taken off again */
    let lineId = row.line_id || null;
    if (b.lineId !== undefined) { if (b.lineId == null || b.lineId === '' || Number(b.lineId) === 0) lineId = null; else { const l = lineById(company, b.lineId); if (!(l.amount < 0)) throw bad(422, 'A bill is kept against money going out.'); lineId = l.id; } }
    const category = b.category != null ? String(b.category) : row.category;
    if (category && !(KINDS[category] && KINDS[category].dir === 'out')) throw bad(422, 'Choose a kind of cost from the list.');
    F.run('UPDATE fin_bills SET line_id = ?, date = ?, party = ?, amount = ?, category = ?, note = ? WHERE id = ?', lineId, date, b.party != null ? str(b.party, 120) : row.party,
      b.amount != null && b.amount !== '' ? amt(b.amount, 'The amount on the bill') : row.amount, category, b.note != null ? str(b.note, 300) : row.note, row.id);
    return billShape(F.one('SELECT * FROM fin_bills WHERE id = ?', row.id));
  }
  function removeBill(company, id, who) {
    const row = billRaw(company, id); if (!row) throw bad(404, 'No such bill.');
    F.run('DELETE FROM fin_bills WHERE id = ?', row.id);
    try { db.log(who, 'removed a bill', co(company).label + ' \u2014 ' + row.filename); } catch (e) { /* removed */ }
    return { stored: row.stored, filename: row.filename };
  }
  /* Students who can be invoiced or matched without an order. */
  const studentList = () => db.allStudents().filter(x => x.role === 'student').map(x => ({ id: x.id, name: x.name || '', email: x.email || '' }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 5000);
  /* A student's invoices, and for each of their orders how much is still to
     be invoiced — what the counsellor's screen shows. */
  function invoicesOfStudent(studentId) {
    const mine = db.allOrders().filter(o => Number(o.student_id) === Number(studentId) && MONEY.EARNED.has(o.status));
    const orders = mine.map(o => {
      const c = COMPANIES[companyOfOrder(o)], u = unitOf(o), total = Math.round(Number(o.gross_paise || 0) * u);
      const invoiced = invoicesOfOrder(o.reference).reduce((a, x) => a + x.gross, 0);
      const f = MONEY.figures(o);
      return { ref: o.reference, package: o.package || '', company: c.code, symbol: c.symbol, locale: c.locale, total, invoiced, toInvoice: Math.max(0, total - invoiced),
        received: Math.round(f.receivedPaise * u), outstanding: Math.round(f.outstandingPaise * u) };
    });
    const list = F.all('SELECT * FROM fin_invoices WHERE student_id = ? ORDER BY id DESC', Number(studentId))
      .map(i => Object.assign(invShape(i), { company: i.company, symbol: COMPANIES[i.company].symbol, locale: COMPANIES[i.company].locale }));
    return { orders, invoices: list };
  }
  const companyOfOrderRef = ref => { const o = db.orderByReference(String(ref || '')); return o ? companyOfOrder(o) : ''; };
  const invoiceRaw = id => { const inv = F.one('SELECT * FROM fin_invoices WHERE id = ?', Number(id)); return inv ? Object.assign(invShape(inv), { company: inv.company }) : null; };
  const invoiceById = (company, id) => { const inv = F.one('SELECT * FROM fin_invoices WHERE id = ? AND company = ?', Number(id), co(company).code); if (!inv) throw bad(404, 'No such invoice.'); return invShape(inv); };

  /* ---- the year: sales, purchases, tax, profit and loss ---- */
  const fmt = (c, minor) => c.symbol + (Math.round(minor) / 100).toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const yearOf = (c, y) => {
    const now = today();
    let start = Number(y);
    if (!start) { start = Number(now.slice(0, 4)); if (Number(now.slice(5, 7)) < c.yearStarts) start--; }
    const m = String(c.yearStarts).padStart(2, '0');
    const from = start + '-' + m + '-01';
    const end = new Date(Date.UTC(start + 1, c.yearStarts - 1, 0));
    const months = []; for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(start, c.yearStarts - 1 + i, 1)); months.push(d.toISOString().slice(0, 7)); }
    return { start, from, to: end.toISOString().slice(0, 10), months, label: c.yearStarts === 1 ? String(start) : start + '–' + String(start + 1).slice(2) };
  };
  function books(company, year) {
    const c = co(company), y = yearOf(c, year);
    const rows = F.all('SELECT * FROM fin_lines WHERE company = ? AND date >= ? AND date <= ? ORDER BY date, id', c.code, y.from, y.to);
    const lk = linksOf(rows.map(r => r.id));
    const orders = {}; db.allOrders().forEach(o => { orders[o.reference] = o; });
    const invs = {}; F.all('SELECT * FROM fin_invoices WHERE company = ?', c.code).forEach(i => { invs[i.id] = i; });
    const month = () => ({ sales: 0, salesTax: 0, otherIncome: 0, costs: 0, costsTax: 0, people: 0, office: 0, students: 0, taxPaid: 0, moved: 0, open: 0 });
    const by = {}; y.months.forEach(m => { by[m] = month(); });
    const sales = [], purchases = [], kinds = {};
    let openIn = 0, openOut = 0, nOpen = 0;
    rows.forEach(l => {
      const M = by[l.date.slice(0, 7)]; if (!M) return;
      const links = lk[l.id] || [];
      links.forEach(k => {
        let rate = 0, who = '', what = '';
        if (k.kind === 'invoice' && invs[k.invoice_id]) { rate = invs[k.invoice_id].tax_rate; who = invs[k.invoice_id].party; what = 'Invoice ' + invs[k.invoice_id].number; }
        else if (orders[k.order_ref]) { rate = rateOfOrder(orders[k.order_ref]); who = orders[k.order_ref].name || ''; what = k.order_ref + ' — ' + (orders[k.order_ref].package || ''); }
        const tax = taxIn(k.amount, rate);
        M.sales += k.amount - tax; M.salesTax += tax;
        sales.push({ date: l.date, who, what, kind: k.kind === 'invoice' ? (invs[k.invoice_id] || {}).kind || 'manual' : 'student', gross: k.amount, tax, net: k.amount - tax, rate, lineId: l.id });
      });
      const matched = links.reduce((a, k) => a + Number(k.amount), 0);
      if (l.category) {
        const K = KINDS[l.category], size = Math.abs(l.amount), tax = taxIn(size, l.tax_rate);
        kinds[l.category] = (kinds[l.category] || 0) + size - (K.pl.indexOf('cost') === 0 || K.pl === 'sale' ? tax : 0);
        if (K.pl === 'income') M.otherIncome += size;
        else if (K.pl === 'sale') { M.sales += size - tax; M.salesTax += tax; sales.push({ date: l.date, who: l.party, what: K.label + (l.note ? ' \u2014 ' + l.note : ''), kind: 'named', gross: size, tax, net: size - tax, rate: l.tax_rate, lineId: l.id }); }
        else if (K.pl === 'income-back') { M.sales -= size; sales.push({ date: l.date, who: l.party, what: K.label, kind: 'refund', gross: -size, tax: 0, net: -size, rate: 0, lineId: l.id }); }
        else if (K.pl === 'cost' || K.pl === 'cost-back') {
          const sign = K.pl === 'cost' ? 1 : -1;
          M.costs += sign * (size - tax); M.costsTax += sign * tax;
          const g = K.group === 'People' ? 'people' : K.group === 'Students' ? 'students' : 'office';
          M[g] += sign * (size - tax);
          purchases.push({ date: l.date, who: l.party, what: l.description, category: l.category, label: K.label, group: K.group || 'Office', gross: sign * size, tax: sign * tax, net: sign * (size - tax), rate: l.tax_rate, note: l.note, lineId: l.id });
        } else if (l.category === 'tax-paid') M.taxPaid += size;
        else M.moved += l.amount;
      } else if (matched < Math.abs(l.amount)) {
        const left = Math.abs(l.amount) - matched; nOpen++;
        if (l.amount > 0) openIn += left; else openOut += left;
        M.open += left;
      }
    });
    /* (The test of 26 Nov.) An invoice paid in cash showed as Paid and was in
       no sales figure and no GST figure: the bank is the book, and cash never
       crosses it. But the GST on a cash sale is owed all the same. Cash
       received on an invoice, and cash recorded on an order that no bank
       line has claimed, are sales on the day the cash was taken. When that
       cash is later paid into the bank, name the deposit "Cash paid into the
       bank" so it is not counted a second time. */
    F.all("SELECT k.amount, k.created_at, i.tax_rate, i.party, i.number, i.kind FROM fin_links k JOIN fin_invoices i ON i.id = k.invoice_id WHERE k.kind = 'cash' AND i.company = ? AND i.status != 'cancelled'", c.code).forEach(k => {
      const d = String(k.created_at).slice(0, 10), M = by[d.slice(0, 7)]; if (!M || d < y.from || d > y.to) return;
      const tax = taxIn(k.amount, k.tax_rate);
      M.sales += k.amount - tax; M.salesTax += tax; M.cashSales = (M.cashSales || 0) + k.amount;
      sales.push({ date: d, who: k.party, what: 'Invoice ' + k.number + ' \u2014 cash', kind: 'cash', gross: k.amount, tax, net: k.amount - tax, rate: k.tax_rate, lineId: null });
    });
    {
      const got = {}; F.all('SELECT payment_id, SUM(amount) AS s FROM fin_links WHERE payment_id IS NOT NULL GROUP BY payment_id').forEach(r => { got[Number(r.payment_id)] = Number(r.s) || 0; });
      db.allPaymentsLite().forEach(p => {
        if (p.kind !== 'payment' || String(p.method) !== 'cash') return;
        const o = orders[p.order_ref]; if (!o || companyOfOrder(o) !== c.code) return;
        const d = String(p.at || '').slice(0, 10), M = by[d.slice(0, 7)]; if (!M || d < y.from || d > y.to) return;
        const amount = Math.round(Number(p.paise) * unitOf(o)) - (got[Number(p.id)] || 0); if (!(amount > 0)) return;
        const rate = rateOfOrder(o), tax = taxIn(amount, rate);
        M.sales += amount - tax; M.salesTax += tax; M.cashSales = (M.cashSales || 0) + amount;
        sales.push({ date: d, who: o.name || '', what: p.order_ref + ' \u2014 cash', kind: 'cash', gross: amount, tax, net: amount - tax, rate, lineId: null });
      });
    }
    sales.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const months = y.months.map(m => Object.assign({ month: m }, by[m], { profit: by[m].sales + by[m].otherIncome - by[m].costs }));
    const sum = k => months.reduce((a, m) => a + m[k], 0);
    const totals = { sales: sum('sales'), otherIncome: sum('otherIncome'), costs: sum('costs'), people: sum('people'), office: sum('office'), students: sum('students'),
      profit: sum('sales') + sum('otherIncome') - sum('costs'), salesTax: sum('salesTax'), costsTax: sum('costsTax'), taxPaid: sum('taxPaid'),
      taxOwed: sum('salesTax') - sum('costsTax') - sum('taxPaid') };
    const all = F.one('SELECT COUNT(*) AS n, MIN(date) AS a, MAX(date) AS b FROM fin_lines WHERE company = ?', c.code);
    /* Patch 309 (owner, 25 Nov): "when the admin goes to finance will he
       know how much in total to receive, how much we received until now,
       what is pending". Every order this company has agreed with a student,
       whatever the year: agreed, received so far, still to come — and who
       owes it, the largest first. */
    const agreedOrders = openOrders(c.code);
    /* …and for each: when the next money is due, and HOW what came in was
       received — found on a bank statement (reconciled), taken as cash, or
       recorded another way (a transfer, UPI, the gateway) and not yet found
       on a statement. "Which student paid how much, how much is pending,
       due dates, reconciled with bank or not, or paid via cash." */
    const linkedTo = {};
    F.all("SELECT payment_id, SUM(amount) AS s FROM fin_links WHERE payment_id IS NOT NULL GROUP BY payment_id").forEach(r => { linkedTo[Number(r.payment_id)] = Number(r.s) || 0; });
    const paysOf = {};
    db.allPaymentsLite().forEach(p => { if (p.kind === 'payment') (paysOf[p.order_ref] || (paysOf[p.order_ref] = [])).push(p); });
    const rawOf = {}; db.allOrders().forEach(o => { rawOf[o.reference] = o; });
    const nowDay = today();
    const rowsS = agreedOrders.map(o => {
      const raw = rawOf[o.ref], u = unitOf(raw);
      let inBank = 0, cash = 0, other = 0, last = '';
      (paysOf[o.ref] || []).forEach(p => {
        const amt = Math.round(Number(p.paise) * u), found = Math.min(amt, linkedTo[Number(p.id)] || 0);
        inBank += found;
        if (String(p.method) === 'cash') cash += amt - found; else other += amt - found;
        const d = String(p.at || '').slice(0, 10); if (d > last) last = d;
      });
      /* What the ledger adds up to can differ from the order's own figure by
         a refund; the order's figure is the one shown, and the split is
         scaled to it only by trimming the unreconciled part. */
      /* an old order paid at the checkout before the ledger was kept: received, with no line saying how */
      if (inBank + cash + other < o.received) other += o.received - (inBank + cash + other);
      const over = inBank + cash + other - o.received;
      if (over > 0) { const cut = Math.min(other, over); other -= cut; cash -= Math.min(cash, over - cut); }
      let due = '', dueAmount = 0;
      let plan = null; try { plan = raw.plan ? JSON.parse(raw.plan) : null; } catch (e) { plan = null; }
      const part = (plan || []).find(p => p.status !== 'paid');
      if (o.outstanding > 0 && part && part.dueAt) { due = String(part.dueAt).slice(0, 10); dueAmount = Math.round(Math.max(0, Number(part.paise || 0) - Math.min(Number(part.paise || 0), Number(part.partPaise || 0))) * u); }
      const invs = invoicesOfOrder(o.ref);
      if (o.outstanding > 0 && !due) {
        /* no dated part: the due date of the oldest invoice not yet settled */
        let left = o.received;
        for (const x of invs) { const take = Math.min(left, x.gross); left -= take; if (take < x.gross && x.due_date) { due = x.due_date; dueAmount = x.gross - take; break; } }
      }
      return { ref: o.ref, studentId: o.studentId, name: o.name, package: o.package, date: o.date, agreed: o.gross, received: o.received, pending: o.outstanding,
        invoiced: invs.reduce((a2, x) => a2 + x.gross, 0), due, dueAmount, overdue: !!(due && due < nowDay && o.outstanding > 0), inBank, cash, notInBank: other, lastPaid: last };
    });
    /* Patch 311: students invoiced with no order behind the invoice. What is
       agreed with them is what has been invoiced; bank matches and cash say
       how it came in. One row per student. */
    const loose = {};
    F.all("SELECT * FROM fin_invoices WHERE company = ? AND kind = 'student' AND order_ref = '' AND status != 'cancelled' ORDER BY id", c.code).forEach(inv => {
      const key = inv.student_id || ('p:' + inv.party);
      const r = loose[key] || (loose[key] = { ref: '', studentId: inv.student_id || 0, name: inv.party, package: 'By invoice', date: inv.issue_date, agreed: 0, received: 0, pending: 0,
        invoiced: 0, due: '', dueAmount: 0, overdue: false, inBank: 0, cash: 0, notInBank: 0, lastPaid: '', numbers: [] });
      const paid = Math.min(inv.gross, paidOnInvoice(inv));
      const cashPaid = Math.min(paid, Number((F.one("SELECT COALESCE(SUM(amount), 0) AS s FROM fin_links WHERE kind = 'cash' AND invoice_id = ?", inv.id) || {}).s) || 0);
      r.agreed += inv.gross; r.invoiced += inv.gross; r.received += paid; r.pending += inv.gross - paid; r.cash += cashPaid; r.inBank += paid - cashPaid;
      r.numbers.push(inv.number);
      if (paid < inv.gross && inv.due_date && !r.due) { r.due = inv.due_date; r.dueAmount = inv.gross - paid; }
      if (paid < inv.gross && inv.due_date && inv.due_date < nowDay) r.overdueAmount = (r.overdueAmount || 0) + inv.gross - paid;
    });
    Object.keys(loose).forEach(k => { const r = loose[k]; r.ref = r.numbers.length === 1 ? r.numbers[0] : r.numbers.length + ' invoices'; r.overdue = !!(r.due && r.due < nowDay && r.pending > 0); delete r.numbers; rowsS.push(r); });
    const sumS = k => rowsS.reduce((a2, r) => a2 + r[k], 0);
    const students = {
      orders: rowsS.length, agreed: sumS('agreed'), received: sumS('received'), pending: sumS('pending'),
      inBank: sumS('inBank'), cash: sumS('cash'), notInBank: sumS('notInBank'),
      overdue: rowsS.filter(r => r.overdue).reduce((a2, r) => a2 + (r.overdueAmount || r.dueAmount || r.pending), 0), nOverdue: rowsS.filter(r => r.overdue).length,
      nPending: rowsS.filter(r => r.pending > 0).length,
      rows: rowsS.sort((x, y2) => (y2.overdue - x.overdue) || (y2.pending - x.pending) || String(x.name).localeCompare(String(y2.name))).slice(0, 600),
    };
    const owedOrders = agreedOrders.filter(o => o.outstanding > 0);
    const owedInv = invoices(c.code).filter(i => !i.orderRef && i.kind !== 'student' && i.outstanding > 0);
    return { company: c.code, currency: c.currency, symbol: c.symbol, locale: c.locale, tax: c.tax, rates: c.rates, year: y.start, yearLabel: y.label, from: y.from, to: y.to,
      months, totals, kinds: Object.keys(kinds).map(k => ({ category: k, label: KINDS[k].label, group: KINDS[k].group || '', pl: KINDS[k].pl, amount: kinds[k] })).sort((a, b) => b.amount - a.amount),
      sales: sales.reverse(), purchases: purchases.reverse(),
      students,
      todo: { lines: nOpen, moneyIn: openIn, moneyOut: openOut },
      owed: { students: owedOrders.reduce((a, o) => a + o.outstanding, 0), nStudents: owedOrders.length, invoices: owedInv.reduce((a, i) => a + i.outstanding, 0), nInvoices: owedInv.length },
      statement: { lines: Number(all && all.n) || 0, from: (all && all.a) || '', to: (all && all.b) || '' } };
  }

  /* Payments on the books that no bank line has claimed, and bank money in
     that nothing has claimed: the two lists a reconciliation is. */
  function reconciliation(company) {
    const c = co(company);
    const found = {}; F.all('SELECT payment_id, SUM(amount) AS s FROM fin_links WHERE payment_id IS NOT NULL GROUP BY payment_id').forEach(r => { found[Number(r.payment_id)] = Number(r.s) || 0; });
    const byRef = {}; db.allOrders().forEach(o => { byRef[o.reference] = o; });
    const mine = db.allPaymentsLite().filter(p => p.kind === 'payment' && byRef[p.order_ref] && companyOfOrder(byRef[p.order_ref]) === c.code);
    const row = p => { const o = byRef[p.order_ref]; return { id: p.id, orderRef: p.order_ref, name: o.name || '', date: String(p.at).slice(0, 10), method: p.method, reference: p.reference, amount: Math.round(Number(p.paise) * unitOf(o)) - (found[Number(p.id)] || 0), by: p.by_staff }; };
    /* what of each payment no bank line has claimed yet: all of it, or the rest of it */
    const unmatched = mine.map(row).filter(r => r.amount > 0).sort((a, b) => b.date.localeCompare(a.date));
    const done = mine.length - unmatched.length;
    const bank = lines(c.code, { dir: 'in', state: 'todo' });
    /* Patch 311: invoices that stand on their own (no order behind them) —
       for each, how much a bank line has paid, how much came as cash, and
       what is still unpaid. */
    const bankOn = {}, cashOn = {};
    F.all("SELECT invoice_id, kind, SUM(amount) AS s FROM fin_links WHERE invoice_id IS NOT NULL AND kind IN ('invoice', 'cash') GROUP BY invoice_id, kind").forEach(r => { (r.kind === 'cash' ? cashOn : bankOn)[Number(r.invoice_id)] = Number(r.s) || 0; });
    const invRows = F.all("SELECT * FROM fin_invoices WHERE company = ? AND order_ref = '' AND status != 'cancelled' ORDER BY id DESC LIMIT 1000", c.code)
      .map(i => ({ id: i.id, number: i.number, party: i.party, kind: i.kind, date: i.issue_date, due: i.due_date, gross: i.gross, bank: bankOn[i.id] || 0, cash: cashOn[i.id] || 0, unpaid: Math.max(0, i.gross - (bankOn[i.id] || 0) - (cashOn[i.id] || 0)) }));
    const sumI = k => invRows.reduce((a, r) => a + r[k], 0);
    /* Patch 315 (owner, 26 Nov): "in Finance we see opening balance and closing
       balance and match with the bank statement? … everything should match
       with the bank statement." For each account, statement by statement in
       date order: the bank's opening balance, the money in and out that is on
       the book for those days, and whether that arrives at the bank's own
       closing balance; whether each statement starts where the one before
       ended; days no statement covers; and how much is still not sorted. */
    const dayAfter = d => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    const byAcct = {};
    F.all('SELECT * FROM fin_batches WHERE company = ? ORDER BY account, d_from, id', c.code).forEach(b => { (byAcct[b.account || ''] || (byAcct[b.account || ''] = [])).push(b); });
    const balances = Object.keys(byAcct).sort().map(account => {
      let prev = null;
      const statements = byAcct[account].map(b => {
        /* the statement's own lines: the ones it brought, and the ones an earlier statement had already brought */
        const ls = F.all('SELECT id, amount, category FROM fin_lines WHERE company = ? AND (batch_id = ? OR id IN (SELECT line_id FROM fin_seen WHERE batch_id = ?))', c.code, b.id, b.id);
        const lk = linksOf(ls.map(x => Number(x.id)));
        let moneyIn = 0, moneyOut = 0, unsorted = 0, unsortedAmount = 0;
        ls.forEach(l => {
          if (l.amount > 0) moneyIn += l.amount; else moneyOut += -l.amount;
          const used = (lk[l.id] || []).reduce((a, k) => a + k.amount, 0);
          if (!l.category && used < Math.abs(l.amount)) { unsorted++; unsortedAmount += Math.abs(l.amount) - used; }
        });
        const has = b.opening != null && b.closing != null;
        const computed = has ? Number(b.opening) + moneyIn - moneyOut : null;
        const row = { id: b.id, filename: b.filename, from: b.d_from, to: b.d_to, opening: b.opening, moneyIn, moneyOut, closing: b.closing, computed, lines: ls.length,
          /* fewer lines on the book than the statement had: some were taken off with another statement, so the sum cannot be checked */
          agrees: has && ls.length >= Number(b.n_lines || 0) ? computed === Number(b.closing) : null, difference: has ? computed - Number(b.closing) : null, short: ls.length < Number(b.n_lines || 0),
          /* does it start where the one before ended? */
          follows: prev && prev.closing != null && b.opening != null ? Number(prev.closing) === Number(b.opening) : null,
          gapFrom: prev && b.d_from > dayAfter(prev.d_to) ? dayAfter(prev.d_to) : '', gapTo: prev && b.d_from > dayAfter(prev.d_to) ? new Date(Date.parse(b.d_from + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) : '',
          unsorted, unsortedAmount };
        prev = b;
        return row;
      });
      return { account, statements, ok: statements.every(x => x.agrees !== false && x.follows !== false && !x.gapFrom), sorted: statements.every(x => !x.unsorted) };
    });
    return { balances, invoices: { rows: invRows.slice(0, 500), gross: sumI('gross'), bank: sumI('bank'), cash: sumI('cash'), unpaid: sumI('unpaid') },
      payments: { total: mine.length, matched: done, unmatched: unmatched.slice(0, 500), unmatchedAmount: unmatched.reduce((a, p) => a + p.amount, 0) },
      bank: { unmatched: bank.slice(0, 500), unmatchedAmount: bank.reduce((a, l) => a + l.left, 0) } };
  }

  return { ok: () => !!(F && F.ok()), settings, saveSettings, importStatement, removeStatement, updateInvoice, invoiceDetail, batchById, addKind, renameKind, removeKind, kindUse, BILL_TYPES, addBill, bills, billRaw, billAny, updateBill, removeBill, cashOnInvoice, undoCash, studentList, batches, accounts, lines, nameLine, match, unmatch, candidates,
    invoices, createInvoice, cancelInvoice, invoiceById, invoicesOfStudent, companyOfOrderRef, invoiceRaw, openOrders, books, reconciliation, fmt: (company, minor) => fmt(co(company), minor) };
}

/* An invoice as a page to print or save as PDF. Plain, one sheet, the
   company's own details at the top; nothing is fetched from anywhere. */
function invoiceHtml(inv, company, me) {
  const c = COMPANIES[company];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const m = n => c.symbol + (Math.round(n) / 100).toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nl = v => esc(v).replace(/\n/g, '<br>');
  const stateWord = { paid: 'Paid', part: 'Part paid', unpaid: 'Unpaid', overdue: 'Overdue', cancelled: 'Cancelled' }[inv.state] || '';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow"><title>Invoice ' + esc(inv.number) + '</title><style>'
    + 'body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0b1e31;margin:0;background:#eef2f7}'
    + '.sheet{max-width:760px;margin:24px auto;background:#fff;padding:44px 48px;border-radius:10px}'
    + 'h1{font-size:26px;margin:0 0 2px}table{width:100%;border-collapse:collapse;margin-top:26px}'
    + 'th,td{text-align:left;padding:9px 6px;border-bottom:1px solid #dfe6ee;vertical-align:top}th{font-size:12px;color:#5b6b7e;text-transform:uppercase;letter-spacing:.04em}'
    + '.r{text-align:right}.top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.mute{color:#5b6b7e}.tot td{border:0;padding:5px 6px}.tot .g td{font-weight:700;font-size:16px;border-top:2px solid #0b1e31}'
    + '.tag{display:inline-block;padding:3px 10px;border-radius:99px;background:#eef2f7;font-weight:700;font-size:12px}'
    + '.bar{max-width:760px;margin:18px auto 0;display:flex;gap:10px;justify-content:flex-end}.bar button{font:inherit;font-weight:700;padding:9px 16px;border-radius:9px;border:0;background:#0b1e31;color:#fff;cursor:pointer}'
    + '@media print{body{background:#fff}.sheet{margin:0;padding:0;border-radius:0}.bar{display:none}}'
    + '</style></head><body><div class="bar"><button type="button" onclick="window.print()">Print or save as PDF</button></div><div class="sheet">'
    + '<div class="top"><div><h1>' + (inv.status === 'cancelled' ? 'Cancelled invoice' : (c.code === 'IN' && inv.tax > 0 ? 'Tax invoice' : 'Invoice')) + '</h1><div class="mute">No. ' + esc(inv.number) + '</div></div>'
    + '<div class="r"><b>' + esc(me.name) + '</b><br><span class="mute">' + nl(me.address) + (me.register ? '<br>' + (c.code === 'IN' ? 'CIN ' : '') + esc(me.register) : '') + (me.taxId ? '<br>' + (c.code === 'IN' ? 'GSTIN ' : 'VAT ID ') + esc(me.taxId) : '') + '</span></div></div>'
    + '<div class="top" style="margin-top:28px"><div><span class="mute">Billed to</span><br><b>' + esc(inv.party) + '</b>' + (inv.address ? '<br>' + nl(inv.address) : '') + (inv.email ? '<br>' + esc(inv.email) : '')
    + (inv.taxId ? '<br>' + (c.code === 'IN' ? 'GSTIN ' : 'VAT ID ') + esc(inv.taxId) : '') + '</div>'
    + '<div class="r"><span class="mute">Date</span> ' + esc(inv.date) + (inv.due ? '<br><span class="mute">Due</span> ' + esc(inv.due) : '') + (inv.orderRef ? '<br><span class="mute">Order</span> ' + esc(inv.orderRef) : '')
    + (stateWord ? '<br><span class="tag">' + stateWord + '</span>' : '') + '</div></div>'
    + '<table><thead><tr><th>For</th><th class="r">Amount</th></tr></thead><tbody>'
    + inv.items.map(i => '<tr><td>' + esc(i.text) + '</td><td class="r">' + m(i.amount) + '</td></tr>').join('') + '</tbody></table>'
    + '<table class="tot" style="margin-top:8px;width:auto;margin-left:auto"><tbody>'
    + '<tr><td class="mute">Before ' + c.tax + '</td><td class="r">' + m(inv.net) + '</td></tr>'
    + '<tr><td class="mute">' + c.tax + ' ' + inv.taxRate + '%</td><td class="r">' + m(inv.tax) + '</td></tr>'
    + '<tr class="g"><td>Total</td><td class="r">' + m(inv.gross) + '</td></tr>'
    + (inv.paid > 0 ? '<tr><td class="mute">Received</td><td class="r">' + m(inv.paid) + '</td></tr><tr><td class="mute">Still to pay</td><td class="r">' + m(inv.outstanding) + '</td></tr>' : '')
    + '</tbody></table>'
    + (inv.taxRate === 0 ? '<p class="mute" style="margin-top:22px">No ' + c.tax + ' is charged on this invoice.</p>' : '')
    + (inv.note ? '<p style="margin-top:18px">' + nl(inv.note) + '</p>' : '')
    + (me.bank ? '<p class="mute" style="margin-top:22px"><b style="color:#0b1e31">Pay to</b><br>' + nl(me.bank) + '</p>' : '')
    + '</div></body></html>';
}

module.exports = { open, COMPANIES, KINDS, taxIn, invoiceHtml };
