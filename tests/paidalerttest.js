/* Patch 263: a payment that just arrived is in the bell, and the order book
   says how it came. */
const BASE = 'http://localhost:8099';
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
async function j(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, body: d, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
(async () => {
  const admin = await j('POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  const ck = admin.cookie;
  const stu = await j('POST', '/api/auth/login', { email: 'student@glovels.com', password: 'glovels123' });
  const placed = await j('POST', '/api/orders', { packageId: 'pkg-roadmap', name: 'T', email: 'student@glovels.com', phone: '9876543210', acceptedTerms: true }, stu.cookie);
  check('order placed', placed.status < 300 && placed.body.reference, placed.status);
  const ref = placed.body.reference;
  const rec = await j('POST', '/api/staff/order/' + ref + '/payment', { amount: placed.body.grossPaise / 100, method: 'upi', reference: 'UTR1', date: new Date().toISOString().slice(0, 10) }, ck);
  check('payment recorded by the office', rec.status < 300, rec.status + ' ' + JSON.stringify(rec.body).slice(0, 100));
  const al = await j('GET', '/api/staff/alerts', null, ck);
  const hit = (al.body.alerts || []).find(a => a.kind === 'paid' && a.subject && a.subject.orderRef === ref);
  check('the bell says money arrived', !!hit, JSON.stringify((al.body.alerts || []).map(a => a.kind)).slice(0, 200));
  check('and it is urgent', hit && hit.urgency === 'now');
  const book = await j('GET', '/api/staff/orders', null, ck);
  const row = (book.body.orders || []).find(o => o.reference === ref);
  check('the book says how it came', row && row.via === 'upi', row && row.via);
  const pr = await j('POST', '/api/auth/login', { email: 'partner@glovels.com', password: 'glovels123' });
  if (pr.status === 200) {
    const pa = await j('GET', '/api/staff/alerts', null, pr.cookie);
    check('a partner is not told about money', !((pa.body && pa.body.alerts) || []).some(a => a.kind === 'paid'));
  }
  console.log('paidalerttest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
