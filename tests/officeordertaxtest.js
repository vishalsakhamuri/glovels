/**
 * FIX (3 Nov e2e run): an order the office raises on a student's file
 * (POST /api/staff/student/:id/order) follows where the student lives, as the
 * checkout does. It was always an Indian sale: a Nepali student's insurance
 * quote read "GST @ 18%" on their dashboard receipt and its 18% sat in the
 * Money screen's GST figure; a Berlin resident's order carried no VAT.
 *
 *   India   → GST, tax mode blank, price as listed
 *   Nepal   → export: no GST, tax mode "export", price as listed
 *   Germany → EU VAT: price + 19%, tax mode "eu-vat-19"
 *   a residence the office sends in the body wins over the profile
 *
 *     node tests/officeordertaxtest.js       (boots its own server on 8228)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8228);
const BASE = 'http://localhost:' + PORT;
const DIR = '/tmp/db-officetax-' + PORT;
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c || note == null ? '' : ' — ' + String(note).slice(0, 220))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;

const jars = {};
async function req(who, method, p, body) {
  const h = { 'content-type': 'application/json' };
  if (jars[who]) h.cookie = jars[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jars[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, ok: r.ok, body: j };
}

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* booting */ } }
    await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    const base = (await req('a', 'GET', '/api/staff/money')).body;

    const mk = async (who, name, country) => {
      const x = await req('a', 'POST', '/api/staff/people', { name, email: who + '@glv-sim.in', password: 'Office-12345!', role: 'student' });
      const id = x.body.person.id;
      await req(who, 'POST', '/api/auth/login', { email: who + '@glv-sim.in', password: 'Office-12345!' });
      await req(who, 'POST', '/api/auth/change', { password: 'Office-12345!X' });
      await req(who, 'POST', '/api/auth/login', { email: who + '@glv-sim.in', password: 'Office-12345!X' });
      const p = await req(who, 'PUT', '/api/profile', { profile: { firstName: name.split(' ')[0], lastName: name.split(' ')[1], addr_country: country } });
      check('setup: ' + name + ' lives in ' + country, x.ok && p.ok, x.status + ' ' + p.status);
      return id;
    };
    const inId = await mk('in1', 'Rohan Verma', 'India');
    const npId = await mk('np1', 'Bikash Shrestha', 'Nepal');
    const deId = await mk('de1', 'Lukas Weber', 'DE');

    const order = (id, body) => req('a', 'POST', '/api/staff/student/' + id + '/order', Object.assign({ services: [{ id: 'insure', priceInr: 8000 }], note: 'quoted' }, body || {}));
    const a = await order(inId);
    check('India: the quote is ₹8,000 with GST inside, tax mode blank', a.ok && a.body.order.grossPaise === 800000 && !a.body.order.taxMode && a.body.exportSale === false, a.status + ' ' + J(a.body).slice(0, 200));
    const b = await order(npId);
    check('Nepal: the quote is ₹8,000 as an export — no GST, tax mode "export"', b.ok && b.body.order.grossPaise === 800000 && b.body.order.taxMode === 'export' && b.body.exportSale === true, b.status + ' ' + J(b.body.order).slice(0, 200));
    check('Nepal: …priced in the student’s currency on the order', b.ok && b.body.order.currency === 'NPR' && b.body.order.residence === 'NP', J({ cur: b.body.order.currency, res: b.body.order.residence }));
    const c = await order(deId);
    check('Germany: the quote is ₹8,000 + 19% VAT = ₹9,520, tax mode "eu-vat-19"', c.ok && c.body.order.grossPaise === 952000 && c.body.order.taxMode === 'eu-vat-19' && c.body.vatRate === 19, c.status + ' ' + J(c.body.order).slice(0, 200));
    const d = await order(inId, { residence: 'NG' });
    check('a residence the office sends wins over the profile (Nigeria → export)', d.ok && d.body.order.taxMode === 'export', J(d.body.order).slice(0, 160));

    /* The receipt the student sees says the same. */
    const stNp = (await req('np1', 'GET', '/api/state')).body;
    check('the Nepali student’s dashboard receipt carries tax mode "export"', stNp.order && stNp.order.taxMode === 'export', J(stNp.order).slice(0, 200));
    const stDe = (await req('de1', 'GET', '/api/state')).body;
    check('the German student’s dashboard receipt carries "eu-vat-19"', stDe.order && stDe.order.taxMode === 'eu-vat-19', J(stDe.order).slice(0, 200));

    /* Money: once paid, only the Indian ₹8,000 adds GST. */
    for (const o of [a, b, c]) {
      const p = await req('a', 'POST', '/api/staff/order/' + o.body.order.reference + '/payment', { amount: o.body.order.grossPaise / 100, method: 'bank' });
      check('paid ' + o.body.order.reference, p.ok, p.status + ' ' + J(p.body).slice(0, 120));
    }
    const money = (await req('a', 'GET', '/api/staff/money')).body;
    const gstAdded = money.gst - base.gst;
    check('the Money screen adds GST for the Indian order only (₹1,220 = 18/118 of ₹8,000)', gstAdded === Math.round(800000 - 800000 / 1.18), gstAdded);
    check('…and received grew by all three', money.received - base.received === 800000 + 800000 + 952000, money.received - base.received);
  } catch (e) {
    check('ran', false, e.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  console.log('\nofficeordertaxtest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
