'use strict';
/*
 * Patch 309: a bank statement → its lines.
 *
 * Owner, 25 Nov 2026: "bank statement can be uploaded … build for pdf only,
 * we don't have excel at the moment". The two layouts Axis Bank hands out
 * are read from the PDF itself (server/pdftext.js); a CSV or Excel export
 * from any bank is read by its column headings.
 *
 *   read(filename, buffer, { decimal }) →
 *     { format, account, holder, from, to, opening, closing,
 *       lines: [ { date:'2024-07-09', description, ref, amount (minor units,
 *                  + in / − out), balance (minor units or null) } ],
 *       warnings: [] }
 *
 * Every figure is checked against the statement's own running balance where
 * it prints one; a line that does not add up is reported, never corrected.
 */
const PDF = require('./pdftext.js');
const SHEET = require('./sheet.js');

/* "INR 1,50,000.00", "1,234.56", "1.234,56", "-12,00 €", "(500.00)", "500.00 Dr" → minor units */
function money(v, decimal) {
  let s = String(v == null ? '' : v).replace(/[ \s]/g, '');
  if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s) || /dr$/i.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (!/\d/.test(s)) return null;
  let dec = decimal;
  if (!dec) {
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    dec = lc > ld && /,\d{1,2}$/.test(s) ? ',' : '.';
  }
  s = dec === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!isFinite(n)) return null;
  const minor = Math.round(n * 100);
  return neg ? -minor : minor;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/* 09/07/2024, 09-07-2024, 09.07.2024, 9 Jul 2024, 2024-07-09 → 2024-07-09 (day first, as India and Germany write it) */
function day(v) {
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  m = /^(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + String(MONTHS[m[2].toLowerCase()]).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  /* an Excel serial day */
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000); return d.toISOString().slice(0, 10); }
  return '';
}
const valid = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && d >= '2000-01-01' && d <= '2100-01-01';
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
/* The bank's own reference inside the narration: the long number of a UPI,
   IMPS, NEFT or RTGS transfer. */
const refOf = text => {
  const m = /\b(?:UPI|IMPS|NEFT|RTGS|INB)\/(?:P2[AM]\/|NEFT\/|IFT\/)?([A-Z0-9]{9,22})\b/i.exec(text) || /\b([A-Z]{4}[A-Z0-9]\d{9,16}|\d{11,18})\b/.exec(text);
  return m && /\d{6}/.test(m[1]) ? m[1] : '';
};
/* A narration the bank broke over several lines, put back together: no gap
   where it was cut inside a number or at a slash or hyphen, a space otherwise. */
const joinWrapped = parts => parts.reduce((a, b) => {
  if (!a) return b;
  if (!b) return a;
  return a + ((/\d$/.test(a) && /^\d/.test(b)) || /[\/\-:]$/.test(a) || /^[\/]/.test(b) ? '' : ' ') + b;
}, '');

/* ---- Axis "Smart Statement Report" (internet banking, business accounts) ----
   S. No. | Transaction Date | Value Date | Cheque Number | Transaction
   Particulars | Amount | Transaction Type | Balance | Branch Name.
   A long narration runs on in its own column on the lines BELOW the row. */
function axisSmart(pages) {
  const out = { format: 'Axis Bank — Smart Statement Report (PDF)', lines: [], warnings: [] };
  const all = [];
  pages.forEach(p => p.lines.forEach(l => all.push(l)));
  const head = all.find(l => /Transaction Particulars/i.test(l.text) && /Transaction Type/i.test(l.text));
  if (!head) return null;
  const col = name => { const it = head.items.find(i => new RegExp(name, 'i').test(i.text)); return it ? it.x : null; };
  const xPart = col('Particulars'), xAmt = col('^\\s*Amount');
  const first = all.find(l => /Statement of Account No/i.test(l.text));
  if (first) {
    const m = /Account No\s*-?\s*(\d{6,})\s+for period\s*\(([^ ]+)\s+to\s+([^)]+)\)/i.exec(first.text);
    if (m) { out.account = m[1]; out.from = day(m[2]); out.to = day(m[3]); }
  }
  const ob = all.find(l => /Opening Balance/i.test(l.text)); if (ob) out.opening = money(ob.text.replace(/.*Opening Balance:?/i, ''), '.');
  const cb = all.find(l => /Closing Balance/i.test(l.text)); if (cb) out.closing = money(cb.text.replace(/.*Closing Balance:?/i, ''), '.');
  const holder = all[all.indexOf(first) - 1]; void holder;
  const title = all.findIndex(l => /Smart Statement Report/i.test(l.text));
  if (title >= 0 && all[title + 1]) out.holder = clean(all[title + 1].text);
  let cur = null, started = false;
  for (const l of all) {
    if (l === head) { started = true; continue; }
    if (!started) continue;
    if (/^Total Transaction Amount|^Closing Balance|^Unless the constituent/i.test(l.text)) { cur = null; if (/^Unless/i.test(l.text)) break; continue; }
    if (/Transaction Particulars/i.test(l.text) && /Transaction Type/i.test(l.text)) continue;     /* the heading again on a new page */
    const sn = l.items[0] && /^\d+$/.test(l.items[0].text.trim()) && l.items[0].x < (xPart || 300) - 200;
    const dt = l.items[1] && day(l.items[1].text.trim());
    if (sn && dt) {
      const amtIt = l.items.find(i => /^\s*INR\s*[\d,]+\.\d{2}\s*$/.test(i.text) && i.x < (col('Transaction Type') || 560));
      const typeIt = l.items.find(i => /^\s*(CR|DR)\s*$/i.test(i.text));
      const balIt = l.items.filter(i => /^\s*INR\s*[\d,]+\.\d{2}\s*$/.test(i.text)).pop();
      if (!amtIt || !typeIt) { out.warnings.push('Line ' + l.items[0].text.trim() + ' could not be read: ' + l.text.slice(0, 80)); cur = null; continue; }
      const amt = money(amtIt.text, '.');
      cur = { date: dt, description: clean(l.items.filter(i => i.x >= (xPart || 0) - 2 && i.x < amtIt.x - 2 && i !== l.items[1] && i !== l.items[2]).map(i => i.text).join(' ')),
        amount: /CR/i.test(typeIt.text) ? amt : -amt, balance: balIt && balIt !== amtIt ? money(balIt.text, '.') : null, cheque: '' };
      const chq = l.items.find(i => i.x > (col('Cheque') || 292) - 5 && i.x < (xPart || 381) - 5 && i !== l.items[1] && i !== l.items[2] && i !== l.items[0]);
      if (chq) cur.cheque = clean(chq.text);
      out.lines.push(cur);
    } else if (cur) {
      const more = l.items.filter(i => i.x >= (xPart || 0) - 2 && i.x < (xAmt || 470) + 30).map(i => i.text).join(' ');
      if (more.trim()) cur.description = clean(joinWrapped([cur.description, more.trim()]));
    }
  }
  return out;
}

/* ---- Axis account statement (the monthly PDF) ----
   Tran Date | Chq No | Particulars | Debit | Credit | Balance | Init. Br.
   The narration starts on the lines ABOVE the dated line and ends on it. */
function axisClassic(pages) {
  const out = { format: 'Axis Bank — account statement (PDF)', lines: [], warnings: [] };
  const all = [];
  pages.forEach(p => p.lines.forEach(l => all.push(l)));
  const head = all.find(l => /Tran Date/i.test(l.text) && /Particulars/i.test(l.text) && /Balance/i.test(l.text));
  if (!head) return null;
  const col = name => { const it = head.items.find(i => new RegExp(name, 'i').test(i.text)); return it ? it.x : null; };
  const xPart = 125, xDebit = col('Debit') || 339, xCredit = col('Credit') || 400, xBal = col('Balance') || 473;
  const edgeDC = (xDebit + xCredit) / 2 + 12;         /* amounts are right-set in their column, a little left of the next heading */
  const st = all.find(l => /Statement of Axis Account No/i.test(l.text));
  if (st) {
    const m = /Account No\s*:?\s*(\d{6,}).*From\s*:\s*([0-9\-\/]+)\s+To\s*:\s*([0-9\-\/]+)/i.exec(st.text);
    if (m) { out.account = m[1]; out.from = day(m[2]); out.to = day(m[3]); }
  }
  if (all[0]) out.holder = clean(all[0].text);
  let pending = [], prev = null, started = false;
  const isAmt = t => /^\s*[\d,]+\.\d{2}\s*$/.test(t);
  for (const l of all) {
    if (l === head) { started = true; continue; }
    if (!started) continue;
    if (/Tran Date/i.test(l.text) && /Particulars/i.test(l.text)) { pending = []; continue; }
    if (/^Br$/.test(l.text.trim())) continue;
    if (/OPENING BALANCE/i.test(l.text)) { const a = l.items.filter(i => isAmt(i.text)).pop(); if (a) { out.opening = money(a.text, '.'); prev = out.opening; } pending = []; continue; }
    if (/CLOSING BALANCE/i.test(l.text)) { const a = l.items.filter(i => isAmt(i.text)).pop(); if (a) out.closing = money(a.text, '.'); pending = []; continue; }
    if (/TRANSACTION TOTAL/i.test(l.text)) { pending = []; continue; }
    if (/^Unless the constituent|^\+\+\+\+ End of Statement|^Legends/i.test(l.text)) break;
    const d = l.items[0] && l.items[0].x < 80 ? day(l.items[0].text.trim()) : '';
    if (d && valid(d)) {
      const nums = l.items.filter(i => isAmt(i.text) && i.x > 300);
      const balIt = nums.filter(i => i.x >= xBal - 25).pop();
      const amtIt = nums.find(i => i !== balIt);
      if (!amtIt || !balIt) { out.warnings.push('The line of ' + d + ' could not be read: ' + l.text.slice(0, 80)); pending = []; continue; }
      const amt = Math.abs(money(amtIt.text, '.')), bal = money(balIt.text, '.');
      /* Which column the amount stands in says in or out; the running balance says it again. */
      let sign = amtIt.x >= edgeDC - 30 ? 1 : -1;
      if (prev != null) {
        if (prev + amt === bal) sign = 1; else if (prev - amt === bal) sign = -1;
        else out.warnings.push('The balance after the line of ' + d + ' (' + clean(amtIt.text) + ') does not follow from the line before it.');
      }
      const here = l.items.filter(i => i.x >= xPart && i.x < 315 && !isAmt(i.text)).map(i => i.text.trim()).filter(Boolean);
      const chq = l.items.find(i => i.x >= 83 && i.x < xPart && i !== l.items[0]);
      out.lines.push({ date: d, description: clean(joinWrapped(pending.concat(here))), amount: sign * amt, balance: bal, cheque: chq ? clean(chq.text) : '' });
      prev = bal; pending = [];
    } else {
      const t = l.items.filter(i => i.x >= xPart && i.x < 315).map(i => i.text.trim()).filter(Boolean).join(' ');
      if (t) pending.push(t);
    }
  }
  return out;
}

/* ---- a CSV or Excel export: found by its headings ---- */
const HEAD = {
  date: /^(tran(saction)?\s*date|txn\s*date|date|posting\s*date|booking\s*date|buchungstag|buchungsdatum|datum|valuta|value\s*date|wertstellung)$/i,
  desc: /^(transaction\s*particulars|particulars|description|narration|details|remarks|transaction\s*remarks|verwendungszweck|buchungstext|text|beschreibung|name|beguenstigter.*|begünstigter.*|auftraggeber.*)$/i,
  debit: /^(debit|withdrawal(s)?(\s*amt\.?)?|dr|debit\s*amount|soll|ausgang|withdrawal\s*amount.*)$/i,
  credit: /^(credit|deposit(s)?(\s*amt\.?)?|cr|credit\s*amount|haben|eingang|deposit\s*amount.*)$/i,
  amount: /^(amount|betrag|umsatz|transaction\s*amount|amount\s*\(.*\)|betrag\s*\(.*\))$/i,
  type: /^(transaction\s*type|type|dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit|soll\s*\/\s*haben|s\/h)$/i,
  balance: /^(balance|closing\s*balance|running\s*balance|saldo|kontostand|balance\s*\(.*\))$/i,
  ref: /^(ref(erence)?(\s*no\.?)?|chq\s*no\.?|cheque\s*(no\.?|number)|utr|transaction\s*id|kundenreferenz|referenz)$/i,
};
function sheet(rows, decimal) {
  const out = { format: 'Spreadsheet (CSV or Excel)', lines: [], warnings: [] };
  let hi = -1, map = null;
  for (let r = 0; r < Math.min(rows.length, 60) && hi < 0; r++) {
    const m = {};
    rows[r].forEach((c, i) => { const t = clean(c); Object.keys(HEAD).forEach(k => { if (m[k] == null && HEAD[k].test(t)) m[k] = i; }); });
    if (m.date != null && (m.amount != null || m.debit != null || m.credit != null)) { hi = r; map = m; }
  }
  if (hi < 0) throw new Error('No heading row was found. The file needs a Date column and an Amount column (or Debit and Credit).');
  let prev = null;
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const d = day(row[map.date]);
    if (!d || !valid(d)) continue;
    let amt = null;
    if (map.debit != null || map.credit != null) {
      const dr = map.debit != null ? money(row[map.debit], decimal) : null, cr = map.credit != null ? money(row[map.credit], decimal) : null;
      if (cr) amt = Math.abs(cr); else if (dr) amt = -Math.abs(dr);
    }
    if (amt == null && map.amount != null) {
      amt = money(row[map.amount], decimal);
      const t = map.type != null ? clean(row[map.type]) : '';
      if (amt != null && /^(dr|debit|d|s|soll)$/i.test(t)) amt = -Math.abs(amt);
      if (amt != null && /^(cr|credit|c|h|haben)$/i.test(t)) amt = Math.abs(amt);
    }
    if (amt == null || amt === 0) continue;
    const bal = map.balance != null ? money(row[map.balance], decimal) : null;
    if (prev != null && bal != null && prev + amt !== bal && prev - amt === bal) amt = -amt;
    out.lines.push({ date: d, description: clean(map.desc != null ? row[map.desc] : ''), amount: amt, balance: bal, cheque: map.ref != null ? clean(row[map.ref]) : '' });
    if (bal != null) prev = bal;
  }
  return out;
}

/* German banks export with semicolons; SHEET.readCsv reads commas. */
function readCsvAny(text) {
  const firstLines = String(text).split(/\r?\n/).slice(0, 15).join('\n');
  const semi = (firstLines.match(/;/g) || []).length, comma = (firstLines.match(/,/g) || []).length;
  if (semi <= comma) return SHEET.readCsv(text);
  /* swap the two outside quotes, read, and the cells come out right */
  let out = '', q = false;
  for (const ch of String(text)) { if (ch === '"') q = !q; out += !q && ch === ';' ? ',' : !q && ch === ',' ? '\u0001' : ch; }
  return SHEET.readCsv(out).map(r => r.map(c => String(c).replace(/\u0001/g, ',')));
}

function read(filename, buf, opts) {
  const name = String(filename || '').toLowerCase();
  const decimal = (opts && opts.decimal) || '';
  let out = null;
  if (/\.pdf$/.test(name) || buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    const pages = PDF.read(buf);
    out = axisSmart(pages) || axisClassic(pages);
    if (!out) throw new Error('This PDF is not laid out like a statement this screen knows (Axis Bank). Send one to be added, or upload the CSV or Excel download instead.');
  } else if (/\.csv$/.test(name)) out = sheet(readCsvAny(buf.toString('utf8')), decimal);
  else if (/\.xlsx$/.test(name)) out = sheet(SHEET.readXlsx(buf), decimal);
  else throw new Error('Upload the statement as a PDF, or as a CSV or Excel (.xlsx) file.');
  out.lines.forEach(l => { l.ref = refOf(l.description) || l.cheque || ''; delete l.cheque; });
  out.lines = out.lines.filter(l => valid(l.date) && l.amount);
  if (!out.lines.length) throw new Error('No transactions were found in that file.');
  /* does it add up? */
  if (out.opening != null && out.closing != null) {
    const sum = out.lines.reduce((a, l) => a + l.amount, 0);
    if (out.opening + sum !== out.closing) out.warnings.push('Opening balance plus the lines read does not give the closing balance printed on the statement. Some lines may be missing.');
  }
  const ds = out.lines.map(l => l.date).sort();
  out.from = out.from || ds[0]; out.to = out.to || ds[ds.length - 1];
  return out;
}

module.exports = { read, money, day };
