/**
 * FIX (3 Nov e2e run): the Money screen's GST figure is 18/118 of the INDIAN
 * receipts only. An EU buyer's order (tax_mode "eu-vat-19") carries German
 * VAT, not GST, and an export (tax_mode "export") carries neither — only the
 * export was being left out, so a ₹17,850 German-course order sold to a
 * Berlin resident added ₹2,722 of "GST" that was never charged.
 *
 *     node tests/moneyvattest.js            (no server; MONEY.summarise alone)
 */
'use strict';
const path = require('path');
const MONEY = require(path.join(__dirname, '..', 'server', 'money.js'));

let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c || note == null ? '' : ' — ' + note)); };

const students = [{ id: 1, status: 'active' }, { id: 2, status: 'active' }, { id: 3, status: 'active' }];
const now = new Date().toISOString();
const order = (ref, sid, gross, tax_mode) => ({ reference: ref, student_id: sid, gross_paise: gross, paid_paise: gross, status: 'paid', tax_mode, created_at: now, paid_at: now, items: '[]', plan: '' });
const orders = [
  order('GLV-1001', 1, 1180000, ''),            // India: ₹11,800 incl. 18% GST → ₹1,800 GST
  order('GLV-1002', 2, 1785000, 'eu-vat-19'),   // Germany: ₹15,000 + 19% VAT → no GST
  order('GLV-1003', 3, 999900, 'export'),       // Nepal: export → no GST
];
const sum = MONEY.summarise(students, orders, Date.now(), {});
check('received is every payment', sum.received === 1180000 + 1785000 + 999900, sum.received);
check('GST is 18/118 of the Indian receipt only (₹1,800)', sum.gst === 180000, sum.gst);
check('the export and the EU-VAT order are outside the GST base', sum.receivedExport === 1785000 + 999900, sum.receivedExport);
console.log('\nmoneyvattest: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
