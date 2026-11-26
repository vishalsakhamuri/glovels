'use strict';
/**
 * Patch 316 — the accountant's pack.
 *
 * Owner, 26 Nov 2026: "show clearly it is OK; GST to be paid report; bank
 * statements; reconciliation report; expenses, real copies; sales invoices and
 * purchase invoices to download for the accountant."
 *
 * For one month (or the whole year) this says, in one place, whether the
 * month is ready to hand over — every account has its statement, the book
 * arrives at the bank's closing balance, every line is sorted — and gives the
 * accountant everything as files: the bank's own statements, a reconciliation
 * report naming what each line was, the GST report, the profit and loss, every
 * sales invoice, and the suppliers' bills as they were uploaded. One ZIP, or
 * each on its own.
 *
 * It computes nothing new about money: every figure comes from finance.js
 * (books, lines, reconciliation, invoices), so a report can never disagree
 * with the screen.
 */
const zlib = require('zlib');

/* ---- a ZIP file, stored (not compressed): names in UTF-8, no dependency ---- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0; let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = []; let offset = 0; const seen = {};
  files.forEach(f => {
    let name = String(f.name).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.+/g, '.');
    if (seen[name]) { const dot = name.lastIndexOf('.'); name = (dot > 0 ? name.slice(0, dot) : name) + '-' + (++seen[name]) + (dot > 0 ? name.slice(dot) : ''); } else seen[name] = 1;
    const nb = Buffer.from(name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nb.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nb.length, 28); cen.writeUInt32LE(0, 30); cen.writeUInt32LE(0, 34); cen.writeUInt16LE(0, 38); cen.writeUInt32LE(offset, 42);
    parts.push(local, nb, data); central.push(cen, nb); offset += 30 + nb.length + data.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const safeName = v => String(v || '').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
const csvOf = (head, rows) => '﻿' + [head].concat(rows).map(r => r.map(c => { const t = String(c == null ? '' : c); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(',')).join('\r\n') + '\r\n';

function open({ fin, FIN, fs, path, billFile, stmtFile }) {
  const C = code => FIN.COMPANIES[String(code || 'IN').toUpperCase() === 'DE' ? 'DE' : 'IN'];
  const kind = id => FIN.KINDS[id] || { label: '', pl: '' };
  const major = n => (Math.round(Number(n) || 0) / 100).toFixed(2);
  const lastDay = ym => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const monthName = ym => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);

  /* The period asked for: one month ("2026-04") or a whole year of the company's books. */
  function period(company, q) {
    const c = C(company), month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(q.month || '')) ? String(q.month) : '';
    if (month) {
      const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
      const fy = c.code === 'IN' ? (m >= 4 ? y : y - 1) : y;
      return { company: c.code, kind: 'month', month, from: month + '-01', to: lastDay(month), label: monthName(month), year: fy, slug: month };
    }
    const B = fin.books(c.code, q.year || '');
    return { company: c.code, kind: 'year', month: '', from: B.from, to: B.to, label: 'Year ' + B.yearLabel, year: B.year, slug: 'year-' + B.yearLabel.replace(/[^0-9]+/g, '-') };
  }

  /* What a bank line was, in the accountant's words. */
  function classify(l) {
    if (l.category) {
      const k = kind(l.category);
      const type = k.pl === 'sale' ? 'Sale (no invoice)' : k.pl === 'income' ? 'Other income' : String(k.pl || '').indexOf('cost') === 0 ? 'Expense' : l.amount > 0 ? 'Not income' : 'Not an expense';
      return { type, what: k.label };
    }
    const links = l.links || [];
    if (!links.length) return { type: 'Not sorted yet', what: '' };
    const kinds = links.map(x => x.kind === 'invoice' ? (x.invoice && x.invoice.kind === 'partner' ? 'B2B / partner invoice' : x.invoice && x.invoice.kind === 'student' ? 'Student invoice' : 'Other invoice') : 'Student payment (order)');
    return { type: kinds.filter((x, i) => kinds.indexOf(x) === i).join(' + ') + (l.state === 'part' ? ' (part matched)' : ''),
      what: links.map(x => (x.kind === 'invoice' ? 'Invoice ' + ((x.invoice && x.invoice.number) || '') + ((x.invoice && x.invoice.party) ? ' ' + x.invoice.party : '') : (x.kind === 'payment' ? 'Payment on ' : 'Order ') + x.orderRef) + ' ' + major(x.amount)).join('; ') };
  }

  /* Everything about the period, gathered once. */
  function gather(company, q) {
    const P = period(company, q), c = C(company);
    const B = fin.books(c.code, P.year);
    const inP = d => d >= P.from && d <= P.to;
    const months = B.months.filter(m => m.month + '-01' >= P.from.slice(0, 7) + '-01' && m.month + '-01' <= P.to);
    const sum = k => months.reduce((a, m) => a + (Number(m[k]) || 0), 0);
    const lines = fin.lines(c.code, { from: P.from, to: P.to }).slice().sort((a, b) => (a.account || '').localeCompare(b.account || '') || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
    const R = fin.reconciliation(c.code);
    const accounts = (R.balances || []).map(a => ({ account: a.account, statements: a.statements.filter(s => s.from <= P.to && s.to >= P.from) }));
    const allAccounts = (R.balances || []).map(a => a.account);
    const batches = fin.batches(c.code);
    const statements = batches.filter(b => b.d_from <= P.to && b.d_to >= P.from).map(b => ({ id: b.id, filename: b.filename, account: b.account, from: b.d_from, to: b.d_to, opening: b.opening, closing: b.closing, hasFile: fs.existsSync(stmtFile(b)), row: b }));
    const BL = fin.bills(c.code, P.year);
    const lineIds = new Set(lines.map(l => l.id));
    const bills = [];
    Object.keys(BL.byLine || {}).forEach(id => { if (lineIds.has(Number(id))) BL.byLine[id].forEach(b => bills.push(b)); });
    (BL.loose || []).forEach(b => { if (inP(b.date)) bills.push(b); });
    const purchases = B.purchases.filter(x => inP(x.date));
    const sales = B.sales.filter(x => inP(x.date));
    const invoices = fin.invoices(c.code).filter(i => inP(i.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
    const live = invoices.filter(i => i.status !== 'cancelled');

    /* ---- is it ready? ---- */
    const checks = [];
    const missing = allAccounts.filter(a => !accounts.find(x => x.account === a && x.statements.length));
    const covered = accounts.filter(a => a.statements.length);
    /* a month is covered when the statements of each account reach from its first day to its last */
    /* A year still running cannot have statements to its last day: it is
       held to the last month that is over (`upTo`), and said to be
       reconciled "up to" that day, never simply "ready". */
    const today = new Date().toISOString().slice(0, 10);
    const lastMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
    const upTo = P.to <= today ? P.to : (lastMonthEnd >= P.from ? lastMonthEnd : P.from);
    P.upTo = upTo; P.partial = upTo < P.to;
    const reach = a => ({ f: a.statements.reduce((m, s) => s.from < m ? s.from : m, '9999'), t: a.statements.reduce((m, s) => s.to > m ? s.to : m, '') });
    const short = covered.filter(a => { const r = reach(a); return r.f > P.from || r.t < upTo; }).map(a => a.account);
    const shortSay = covered.filter(a => short.includes(a.account)).map(a => { const r = reach(a); return '••' + String(a.account).slice(-4) + ' has ' + r.f + ' to ' + r.t; }).join('; ');
    checks.push({ key: 'statements', ok: allAccounts.length > 0 && !missing.length && !short.length, must: true,
      title: 'A bank statement for every account',
      detail: !allAccounts.length ? 'No bank statement has been uploaded for this company yet.'
        : missing.length ? 'No statement covers ' + P.label + ' for account' + (missing.length === 1 ? ' ' : 's ') + missing.map(a => '••' + String(a).slice(-4)).join(', ') + '.'
        : short.length ? 'The statements do not cover ' + P.from + ' to ' + upTo + ': ' + shortSay + '.'
        : covered.length + ' account' + (covered.length === 1 ? '' : 's') + ', ' + statements.length + ' statement' + (statements.length === 1 ? '' : 's') + '.' });
    const all = covered.flatMap(a => a.statements);
    const off = all.filter(s => s.agrees === false), broken = all.filter(s => s.follows === false || s.gapFrom), unknown = all.filter(s => s.agrees === null);
    checks.push({ key: 'balance', ok: all.length > 0 && !off.length && !broken.length && !unknown.length, must: true,
      title: 'The book agrees with the bank’s closing balance',
      detail: !all.length ? 'Nothing to check yet.'
        : off.length ? off.map(s => s.filename + ' is out by ' + major(Math.abs(s.difference))).join('; ') + '.'
        : broken.length ? broken.map(s => s.filename + (s.gapFrom ? ': no statement for ' + s.gapFrom + ' to ' + s.gapTo : ' does not start where the one before ended')).join('; ') + '.'
        : unknown.length ? unknown.map(s => s.filename + ' could not be checked (upload it again)').join('; ') + '.'
        : 'Opening balance, plus money in, less money out, is the bank’s closing balance on every statement.' });
    const open = lines.filter(l => l.state === 'open' || l.state === 'part');
    const openAmt = open.reduce((a, l) => a + Math.abs(l.amount) - (l.links || []).reduce((s, k) => s + k.amount, 0), 0);
    checks.push({ key: 'sorted', ok: lines.length > 0 && !open.length, must: true,
      title: 'Every bank line is matched or named',
      detail: !lines.length ? 'There are no bank lines in ' + P.label + '.' : open.length ? open.length + ' of ' + lines.length + ' lines are still to sort (' + major(openAmt) + ').' : 'All ' + lines.length + ' lines.' });
    const withBill = purchases.filter(x => ((BL.byLine || {})[x.lineId] || []).length).length;
    checks.push({ key: 'bills', ok: withBill === purchases.length, must: false,
      title: 'A bill is kept for every purchase',
      detail: purchases.length ? withBill + ' of ' + purchases.length + ' purchases have their bill.' + (withBill < purchases.length ? ' Bank charges, salaries and taxes often have none; the rest should.' : '') : 'No purchases in ' + P.label + '.' });
    const ready = checks.filter(x => x.must).every(x => x.ok);

    /* ---- GST / VAT ---- */
    /* Patch 320: a buyer "with a GSTIN" is one whose number IS a GSTIN — a
       German VAT ID on an Indian invoice is a foreign buyer, not a registered one. */
    const registered = id => !!id && (c.code !== 'IN' || FIN.isGstin(id));
    /* Taxable sales that came in without an invoice (named as a sale on the
       Bank tab): tax is due on them like any other, so they stand beside the
       invoices in the figure to pay. */
    const loose = sales.filter(x => x.kind === 'named');
    const uninvoiced = { count: loose.length, taxable: loose.reduce((a, x) => a + x.net, 0), tax: loose.reduce((a, x) => a + x.tax, 0), gross: loose.reduce((a, x) => a + x.gross, 0) };
    const byRate = {};
    live.forEach(i => { const k = String(i.taxRate); const r = byRate[k] || (byRate[k] = { rate: i.taxRate, count: 0, taxable: 0, tax: 0, gross: 0, withId: 0, withIdTaxable: 0, withIdTax: 0 }); r.count++; r.taxable += i.net; r.tax += i.tax; r.gross += i.gross; if (registered(i.taxId)) { r.withId++; r.withIdTaxable += i.net; r.withIdTax += i.tax; } });
    const tax = {
      name: c.tax,
      /* by the day the money reached the bank or was taken as cash — how this book counts */
      received: { taxable: sum('sales'), output: sum('salesTax'), purchases: sum('costs'), input: sum('costsTax'), net: sum('salesTax') - sum('costsTax'), paid: sum('taxPaid') },
      /* by the date on the invoices raised — what a return of invoices is made from */
      invoiced: { count: live.length, taxable: live.reduce((a, i) => a + i.net, 0), output: live.reduce((a, i) => a + i.tax, 0), gross: live.reduce((a, i) => a + i.gross, 0),
        byRate: Object.keys(byRate).map(k => byRate[k]).sort((a, b) => b.rate - a.rate), cancelled: invoices.length - live.length, uninvoiced,
        outputAll: live.reduce((a, i) => a + i.tax, 0) + uninvoiced.tax },
    };
    return { P, c, B, months, lines, accounts, statements, bills, purchases, sales, invoices, live, checks, ready, tax, billsByLine: BL.byLine || {},
      totals: { sales: sum('sales'), otherIncome: sum('otherIncome'), people: sum('people'), office: sum('office'), students: sum('students'), costs: sum('costs'), profit: sum('sales') + sum('otherIncome') - sum('costs') } };
  }

  /* What the screen is given. */
  function pack(company, q) {
    const G = gather(company, q);
    return { company: G.P.company, period: { kind: G.P.kind, month: G.P.month, from: G.P.from, to: G.P.to, label: G.P.label, year: G.P.year, upTo: G.P.upTo, partial: G.P.partial }, ready: G.ready, checks: G.checks, tax: G.tax, totals: G.totals,
      counts: { lines: G.lines.length, statements: G.statements.length, statementFiles: G.statements.filter(s => s.hasFile).length, bills: G.bills.length, purchases: G.purchases.length, sales: G.sales.length, invoices: G.invoices.length },
      statements: G.statements.map(s => ({ id: s.id, filename: s.filename, account: s.account, from: s.from, to: s.to, opening: s.opening, closing: s.closing, hasFile: s.hasFile })),
      bills: G.bills.map(b => ({ id: b.id, filename: b.filename, date: b.date, party: b.party, amount: b.amount, lineId: b.lineId })),
      months: G.B.months.map(m => m.month), yearLabel: G.B.yearLabel };
  }

  /* ---- printed pages ---- */
  const page = (G, title, body, me) => {
    const money = n => G.c.symbol + (Math.round(Number(n) || 0) / 100).toLocaleString(G.c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>' + esc(title + ' — ' + G.P.label + ' — ' + me.name) + '</title><style>'
      + 'body{font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0b1e31;margin:0;background:#eef2f7}.sheet{max-width:1040px;margin:20px auto;background:#fff;padding:34px 38px;border-radius:10px}'
      + 'h1{font-size:23px;margin:0 0 2px}h2{font-size:15px;margin:26px 0 6px}table{width:100%;border-collapse:collapse;margin-top:6px}th,td{text-align:left;padding:6px 6px;border-bottom:1px solid #dfe6ee;vertical-align:top}'
      + 'th{font-size:11px;color:#5b6b7e;text-transform:uppercase;letter-spacing:.04em}.r{text-align:right;white-space:nowrap}.mute{color:#5b6b7e}.b td{font-weight:700;border-top:2px solid #0b1e31}'
      + '.ok{color:#0a7a45;font-weight:700}.no{color:#b3261e;font-weight:700}.warn{color:#8a5a00;font-weight:700}.box{border:1px solid #dfe6ee;border-radius:10px;padding:12px 14px;margin:12px 0}.big{font-size:18px;font-weight:800}'
      + '.bar{max-width:1040px;margin:14px auto 0;display:flex;gap:10px;justify-content:flex-end}.bar button{font:inherit;font-weight:700;padding:9px 16px;border-radius:9px;border:0;background:#0b1e31;color:#fff;cursor:pointer}'
      + '.inv{page-break-after:always;border-bottom:2px dashed #dfe6ee;padding-bottom:26px;margin-bottom:26px}.inv:last-child{page-break-after:auto;border:0}.top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.tot td{border:0;padding:4px 6px}.tot .g td{font-weight:700;font-size:15px;border-top:2px solid #0b1e31}.tag{display:inline-block;padding:2px 9px;border-radius:99px;background:#eef2f7;font-weight:700;font-size:11px}'
      + '@media print{body{background:#fff}.sheet{margin:0;padding:0;border-radius:0;max-width:none}.bar{display:none}tr{page-break-inside:avoid}}'
      + '</style></head><body><div class="bar"><button type="button" onclick="window.print()">Print or save as PDF</button></div><div class="sheet">'
      + '<div class="top"><div><h1>' + esc(title) + '</h1><div class="mute">' + esc(G.P.label) + ' · ' + esc(G.P.from) + ' to ' + esc(G.P.to) + '</div></div>'
      + '<div class="r" style="white-space:normal"><b>' + esc(me.name) + '</b><br><span class="mute">' + (me.taxId ? (G.c.code === 'IN' ? 'GSTIN ' : 'VAT ID ') + esc(me.taxId) + '<br>' : '') + 'Prepared ' + new Date().toISOString().slice(0, 10) + '</span></div></div>'
      + body(money) + '</div></body></html>';
  };
  const statusBox = (G) => '<div class="box"><div class="big ' + (G.ready ? 'ok' : 'no') + '">' + (G.ready ? '✓ ' + esc(G.P.label) + (G.P.partial ? ' is reconciled with the bank up to ' + esc(G.P.upTo) + ' (it runs to ' + esc(G.P.to) + ')' : ' is reconciled and ready for the accountant') : '✗ ' + esc(G.P.label) + ' is not ready yet') + '</div>'
    + '<table><tbody>' + G.checks.map(x => '<tr><td style="width:26px" class="' + (x.ok ? 'ok' : x.must ? 'no' : 'warn') + '">' + (x.ok ? '✓' : x.must ? '✗' : '!') + '</td><td><b>' + esc(x.title) + '</b><br><span class="mute">' + esc(x.detail) + '</span></td></tr>').join('') + '</tbody></table></div>';

  function gstHtml(company, q) {
    const G = gather(company, q), me = fin.settings()[G.P.company], t = G.tax, T = G.c.tax;
    return page(G, T + ' report', money => statusBox(G)
      + '<h2>' + T + ' to pay — by the invoices raised in the period</h2><p class="mute" style="margin:0">Every invoice dated in the period that is not cancelled, whether or not it has been paid. This is the basis a return of invoices is made on. Input ' + T + ' is on the purchases paid in the period.</p>'
      + '<table><thead><tr><th>Rate</th><th class="r">Invoices</th><th class="r">Taxable value</th><th class="r">' + T + '</th><th class="r">Invoice total</th><th class="r">Of which to buyers with a ' + (G.c.code === 'IN' ? 'GSTIN' : 'VAT ID') + '</th></tr></thead><tbody>'
      + (t.invoiced.byRate.length ? t.invoiced.byRate.map(r => '<tr><td>' + r.rate + '%</td><td class="r">' + r.count + '</td><td class="r">' + money(r.taxable) + '</td><td class="r">' + money(r.tax) + '</td><td class="r">' + money(r.gross) + '</td><td class="r">' + r.withId + ' · ' + money(r.withIdTaxable) + ' · ' + T + ' ' + money(r.withIdTax) + '</td></tr>').join('') : '<tr><td colspan="6" class="mute">No invoice is dated in this period.</td></tr>')
      + '<tr class="b"><td>All</td><td class="r">' + t.invoiced.count + '</td><td class="r">' + money(t.invoiced.taxable) + '</td><td class="r">' + money(t.invoiced.output) + '</td><td class="r">' + money(t.invoiced.gross) + '</td><td></td></tr></tbody></table>'
      + (t.invoiced.uninvoiced.count ? '<p style="margin:6px 0"><b>Also taxable: ' + t.invoiced.uninvoiced.count + ' sale' + (t.invoiced.uninvoiced.count === 1 ? '' : 's') + ' received without an invoice</b> (named as a sale on the Bank tab) — taxable ' + money(t.invoiced.uninvoiced.taxable) + ', ' + T + ' ' + money(t.invoiced.uninvoiced.tax) + '. An invoice should be raised for each.</p>' : '')
      + (t.invoiced.cancelled ? '<p class="mute">' + t.invoiced.cancelled + ' cancelled invoice' + (t.invoiced.cancelled === 1 ? ' is' : 's are') + ' left out; ' + (t.invoiced.cancelled === 1 ? 'it is' : 'they are') + ' in the list of invoices.</p>' : '')
      + '<table style="width:auto;margin-left:auto"><tbody><tr><td>' + T + ' on invoices raised</td><td class="r">' + money(t.invoiced.output) + '</td></tr>' + (t.invoiced.uninvoiced.count ? '<tr><td>' + T + ' on sales without an invoice</td><td class="r">' + money(t.invoiced.uninvoiced.tax) + '</td></tr>' : '') + '<tr><td>Less ' + T + ' on purchases paid in the period</td><td class="r">' + money(t.received.input) + '</td></tr><tr class="b"><td>' + T + ' to pay for the period</td><td class="r">' + money(t.invoiced.outputAll - t.received.input) + '</td></tr><tr><td class="mute">' + T + ' paid to the government in the period (bank)</td><td class="r">' + money(t.received.paid) + '</td></tr></tbody></table>'
      + '<h2>' + T + ' — by the money received in the period</h2><p class="mute" style="margin:0">How this book counts sales: on the day the money reached the bank, or was taken as cash. It differs from the table above by invoices not yet paid and by money received for earlier invoices.</p>'
      + '<table style="width:auto"><tbody><tr><td>Sales received, before ' + T + '</td><td class="r">' + money(t.received.taxable) + '</td></tr><tr><td>' + T + ' inside the money received</td><td class="r">' + money(t.received.output) + '</td></tr><tr><td>Purchases paid, before ' + T + '</td><td class="r">' + money(t.received.purchases) + '</td></tr><tr><td>' + T + ' inside the purchases paid</td><td class="r">' + money(t.received.input) + '</td></tr><tr class="b"><td>Net</td><td class="r">' + money(t.received.net) + '</td></tr></tbody></table>'
      + '<h2>Invoices raised in the period</h2><table><thead><tr><th>Number</th><th>Date</th><th>To</th><th>Their ' + (G.c.code === 'IN' ? 'GSTIN' : 'VAT ID') + '</th><th>Kind</th><th class="r">Taxable</th><th class="r">Rate</th><th class="r">' + T + '</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>'
      + (G.invoices.length ? G.invoices.map(i => '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.date) + '</td><td>' + esc(i.party) + '</td><td>' + esc(i.taxId || '') + '</td><td>' + esc(i.kind) + '</td><td class="r">' + money(i.net) + '</td><td class="r">' + i.taxRate + '%</td><td class="r">' + money(i.tax) + '</td><td class="r">' + money(i.gross) + '</td><td>' + esc(i.state) + '</td></tr>').join('') : '<tr><td colspan="10" class="mute">None.</td></tr>') + '</tbody></table>'
      + '<h2>Purchases paid in the period, with the ' + T + ' inside them</h2><table><thead><tr><th>Date</th><th>Kind</th><th>Paid to</th><th class="r">Paid</th><th class="r">Rate</th><th class="r">' + T + '</th><th class="r">Before ' + T + '</th><th>Bill kept</th></tr></thead><tbody>'
      + (G.purchases.length ? G.purchases.map(x => '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.label) + '</td><td>' + esc(x.who) + '</td><td class="r">' + money(x.gross) + '</td><td class="r">' + (x.rate || 0) + '%</td><td class="r">' + money(x.tax) + '</td><td class="r">' + money(x.net) + '</td><td>' + ((G.billsByLine[x.lineId] || []).length ? 'Yes' : '<span class="mute">No</span>') + '</td></tr>').join('') : '<tr><td colspan="8" class="mute">None.</td></tr>')
      + (G.purchases.length ? '<tr class="b"><td colspan="3">All</td><td class="r">' + money(G.purchases.reduce((a, x) => a + x.gross, 0)) + '</td><td></td><td class="r">' + money(G.purchases.reduce((a, x) => a + x.tax, 0)) + '</td><td class="r">' + money(G.purchases.reduce((a, x) => a + x.net, 0)) + '</td><td></td></tr>' : '') + '</tbody></table>'
      + '<p class="mute" style="margin-top:18px">A working paper from the office’s books for the accountant, not a filed return.</p>', me);
  }

  function reconHtml(company, q) {
    const G = gather(company, q), me = fin.settings()[G.P.company];
    return page(G, 'Bank reconciliation', money => statusBox(G)
      + G.accounts.map(a => '<h2>Account ••' + esc(String(a.account || '').slice(-4) || '—') + ' <span class="mute" style="font-weight:400">' + esc(a.account || '') + '</span></h2>'
        + '<table><thead><tr><th>Statement</th><th>Period</th><th class="r">Opening balance</th><th class="r">Money in</th><th class="r">Money out</th><th class="r">Book closes at</th><th class="r">Bank’s closing balance</th><th>Check</th></tr></thead><tbody>'
        + (a.statements.length ? a.statements.map(s => '<tr><td>' + esc(s.filename) + '</td><td>' + esc(s.from) + ' to ' + esc(s.to) + '</td><td class="r">' + (s.opening == null ? '—' : money(s.opening)) + '</td><td class="r">' + money(s.moneyIn) + '</td><td class="r">' + money(s.moneyOut) + '</td><td class="r">' + (s.computed == null ? '—' : money(s.computed)) + '</td><td class="r"><b>' + (s.closing == null ? '—' : money(s.closing)) + '</b></td><td class="' + (s.agrees && s.follows !== false && !s.gapFrom ? 'ok' : 'no') + '">' + (s.agrees === false ? 'Out by ' + money(Math.abs(s.difference)) : s.agrees === null ? 'Not checked' : s.follows === false ? 'Does not follow the last' : s.gapFrom ? 'Days missing before it' : 'Agrees') + '</td></tr>').join('') : '<tr><td colspan="8" class="no">No statement covers this period for this account.</td></tr>') + '</tbody></table>'
        + '<table><thead><tr><th>Date</th><th>What the bank says</th><th class="r">Money in</th><th class="r">Money out</th><th class="r">Balance</th><th>Type</th><th>What it was</th><th>Who</th><th>Bill</th></tr></thead><tbody>'
        + G.lines.filter(l => (l.account || '') === (a.account || '')).map(l => { const k = classify(l); return '<tr><td style="white-space:nowrap">' + esc(l.date) + '</td><td style="word-break:break-word;max-width:300px">' + esc(l.description) + '</td><td class="r">' + (l.amount > 0 ? money(l.amount) : '') + '</td><td class="r">' + (l.amount < 0 ? money(-l.amount) : '') + '</td><td class="r">' + (l.balance == null ? '' : money(l.balance)) + '</td><td class="' + (k.type === 'Not sorted yet' ? 'no' : '') + '">' + esc(k.type) + '</td><td>' + esc(k.what) + (l.note ? '<br><span class="mute">' + esc(l.note) + '</span>' : '') + '</td><td>' + esc(l.party || '') + '</td><td>' + ((G.billsByLine[l.id] || []).length ? 'Yes' : '') + '</td></tr>'; }).join('') + '</tbody></table>').join('')
      + (G.accounts.length ? '' : '<p class="no">No bank statement has been uploaded.</p>')
      + '<p class="mute" style="margin-top:18px">Every line of the bank statements for the period, as the bank wrote it, with what the office recorded it as.</p>', me);
  }

  function plHtml(company, q) {
    const G = gather(company, q), me = fin.settings()[G.P.company], T = G.c.tax;
    const kinds = {}; G.purchases.forEach(x => { const k = x.group + ' — ' + x.label; kinds[k] = (kinds[k] || 0) + x.net; });
    const salesBy = {}; G.sales.forEach(x => { const k = ({ cash: 'Cash sales', named: 'Sales received without an invoice', refund: 'Refunds to students (taken off sales)', partner: 'Partner invoices paid through the bank', manual: 'Other invoices paid through the bank', student: 'Students paid through the bank' })[x.kind] || 'Other sales'; salesBy[k] = (salesBy[k] || 0) + x.net; });
    return page(G, 'Profit and loss', money => statusBox(G)
      + '<p class="mute">By the day the money reached or left the bank (or was taken as cash). ' + T + ' is taken out of both sides. Capital, loans, transfers between your own accounts and tax payments are neither income nor cost.</p>'
      + '<table><thead><tr><th>Month</th><th class="r">Sales</th><th class="r">Other income</th><th class="r">People</th><th class="r">Office</th><th class="r">For students</th><th class="r">All costs</th><th class="r">Profit</th></tr></thead><tbody>'
      + G.months.map(m => '<tr><td>' + esc(monthName(m.month)) + '</td><td class="r">' + money(m.sales) + '</td><td class="r">' + money(m.otherIncome) + '</td><td class="r">' + money(m.people) + '</td><td class="r">' + money(m.office) + '</td><td class="r">' + money(m.students) + '</td><td class="r">' + money(m.costs) + '</td><td class="r"><b>' + money(m.sales + m.otherIncome - m.costs) + '</b></td></tr>').join('')
      + '<tr class="b"><td>' + esc(G.P.label) + '</td><td class="r">' + money(G.totals.sales) + '</td><td class="r">' + money(G.totals.otherIncome) + '</td><td class="r">' + money(G.totals.people) + '</td><td class="r">' + money(G.totals.office) + '</td><td class="r">' + money(G.totals.students) + '</td><td class="r">' + money(G.totals.costs) + '</td><td class="r">' + money(G.totals.profit) + '</td></tr></tbody></table>'
      + '<h2>Sales, by how they came in</h2><table style="width:auto"><tbody>' + (Object.keys(salesBy).length ? Object.keys(salesBy).sort().map(k => '<tr><td>' + esc(k) + '</td><td class="r">' + money(salesBy[k]) + '</td></tr>').join('') : '<tr><td class="mute">None.</td></tr>') + '</tbody></table>'
      + '<h2>Costs, by kind</h2><table style="width:auto"><tbody>' + (Object.keys(kinds).length ? Object.keys(kinds).sort().map(k => '<tr><td>' + esc(k) + '</td><td class="r">' + money(kinds[k]) + '</td></tr>').join('') : '<tr><td class="mute">None.</td></tr>') + '</tbody></table>'
      + '<p class="mute" style="margin-top:18px">A management statement on a receipts-and-payments basis from the bank and cash records. The statutory accounts are prepared by the accountant.</p>', me);
  }

  /* Every invoice of the period on one page, each on its own sheet when printed. */
  function invoicesHtml(company, q) {
    const G = gather(company, q), me = fin.settings()[G.P.company];
    const one = i => { const html = FIN.invoiceHtml(Object.assign(fin.invoiceRaw(i.id) || i, {}), G.P.company, me); const a = html.indexOf('<div class="sheet">'), b = html.lastIndexOf('</div></body>'); return a >= 0 && b > a ? html.slice(a + 19, b) : ''; };
    return page(G, 'Sales invoices', money => '<p class="mute">' + G.invoices.length + ' invoice' + (G.invoices.length === 1 ? '' : 's') + ' dated in the period, in number order of date. Each prints on its own page.</p>'
      + (G.invoices.length ? G.invoices.map(i => '<div class="inv">' + one(i) + '</div>').join('') : '<p class="mute">No invoice is dated in this period.</p>'), me);
  }

  /* ---- registers as spreadsheets ---- */
  function registers(G) {
    const T = G.c.tax;
    return {
      lines: csvOf(['Date', 'Account', 'What the bank says', 'Reference', 'Money in', 'Money out', 'Balance', 'Type', 'What it was', 'Who', T + ' %', 'Note', 'Bills kept'],
        G.lines.map(l => { const k = classify(l); return [l.date, l.account, l.description, l.ref, l.amount > 0 ? major(l.amount) : '', l.amount < 0 ? major(-l.amount) : '', l.balance == null ? '' : major(l.balance), k.type, k.what, l.party, l.category && l.taxRate ? l.taxRate : '', l.note, (G.billsByLine[l.id] || []).map(b => b.filename).join('; ')]; })),
      sales: csvOf(['Date received', 'From', 'For', 'How', 'Received', T, 'Rate %', 'Before ' + T], G.sales.map(x => [x.date, x.who, x.what, x.kind, major(x.gross), major(x.tax), x.rate, major(x.net)])),
      purchases: csvOf(['Date paid', 'Group', 'Kind', 'Paid to', 'Bank narration', 'Paid', T, 'Rate %', 'Before ' + T, 'Note', 'Bills kept'], G.purchases.map(x => [x.date, x.group, x.label, x.who, x.what, major(x.gross), major(x.tax), x.rate, major(x.net), x.note, (G.billsByLine[x.lineId] || []).map(b => b.filename).join('; ')])),
      /* Patch 321: an invoice in another currency carries that amount, the rate it was valued at, and the exchange difference once the money came. */
      invoices: csvOf(['Number', 'Date', 'To', 'Their tax number', 'Kind', 'Taxable value', 'Rate %', T, 'Total', 'Received', 'Unpaid', 'Status', 'Due', 'Invoiced in', 'Amount in that currency', 'Rate used', 'Exchange difference'], G.invoices.map(i => [i.number, i.date, i.party, i.taxId || '', i.kind, major(i.net), i.taxRate, major(i.tax), major(i.gross), major(i.paid), major(i.outstanding), i.state, i.due || '', i.fx ? i.fx.currency : '', i.fx ? major(i.fx.gross) : '', i.fx ? i.fx.rate : '', i.adjust ? major(i.adjust) : ''])),
    };
  }

  /* Everything for the period in one file. */
  function zipFor(company, q) {
    const G = gather(company, q), R = registers(G), files = [];
    const base = 'Glovels ' + G.P.company + ' ' + G.P.slug;
    files.push({ name: '1 ' + G.c.tax + ' report.html', data: gstHtml(company, q) });
    files.push({ name: '2 Bank reconciliation.html', data: reconHtml(company, q) });
    files.push({ name: '3 Profit and loss.html', data: plHtml(company, q) });
    files.push({ name: '4 Sales invoices.html', data: invoicesHtml(company, q) });
    files.push({ name: 'Registers/Bank lines with what each was.csv', data: R.lines });
    files.push({ name: 'Registers/Sales received.csv', data: R.sales });
    files.push({ name: 'Registers/Purchases paid.csv', data: R.purchases });
    files.push({ name: 'Registers/Invoices raised.csv', data: R.invoices });
    const missing = [];
    G.statements.forEach(s => { try { files.push({ name: 'Bank statements/' + safeName((s.account ? String(s.account).slice(-4) + ' ' : '') + s.from + ' to ' + s.to + ' ' + s.filename), data: fs.readFileSync(stmtFile(s.row)) }); } catch (e) { missing.push('Bank statement ' + s.filename + ' (uploaded before files were kept: remove it and upload it again)'); } });
    G.bills.forEach(b => { try { const raw = fin.billAny(b.id); files.push({ name: 'Purchase bills/' + safeName((b.date || '') + ' ' + (b.party || '') + ' ' + major(b.amount) + ' ' + b.filename), data: fs.readFileSync(billFile(raw)) }); } catch (e) { missing.push('Bill ' + b.filename); } });
    files.push({ name: 'READ ME.txt', data: [me(G), '', G.P.label + ' (' + G.P.from + ' to ' + G.P.to + ')', G.ready ? (G.P.partial ? 'RECONCILED against the bank up to ' + G.P.upTo + ' (the period runs to ' + G.P.to + ').' : 'READY: reconciled against the bank.') : 'NOT READY: see the first page of any report.', '',
      G.checks.map(x => (x.ok ? '[ok] ' : x.must ? '[NO] ' : '[!]  ') + x.title + ' — ' + x.detail).join('\r\n'), '',
      'In this folder: the ' + G.c.tax + ' report, the bank reconciliation, the profit and loss and every sales invoice (open in a browser; print or save as PDF), four registers as spreadsheets, the bank’s own statements, and the suppliers’ bills as they were uploaded.',
      missing.length ? '\r\nNot included:\r\n' + missing.map(x => ' - ' + x).join('\r\n') : ''].join('\r\n') });
    return { name: safeName(base) + '.zip', data: zip(files), count: files.length, missing };
  }
  const me = G => fin.settings()[G.P.company].name;

  return { pack, gstHtml, reconHtml, plHtml, invoicesHtml, zipFor, registers: (company, q) => registers(gather(company, q)), period };
}

module.exports = { open, zip };
