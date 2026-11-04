/* Patch 262: a super administrator can take an unpaid order off the book;
   an order with money on it stays. */
const BASE = 'http://localhost:8099';
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };
async function j(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, body: data, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
(async () => {
  const admin = await j('POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  check('admin signs in', admin.status === 200, admin.status);
  const ck = admin.cookie;
  const book = await j('GET', '/api/staff/orders', null, ck);
  check('order book reads', book.status === 200);
  /* An unpaid order to remove: a student places one (the guard's page token
     is not asked of a signed-in student in tests, as ordertest does it). */
  const stu = await j('POST', '/api/auth/login', { email: 'student@glovels.com', password: 'glovels123' });
  const placed = await j('POST', '/api/orders', { packageId: 'pkg-roadmap', name: 'T', email: 'student@glovels.com', phone: '9876543210', acceptedTerms: true }, stu.cookie);
  check('a student places an unpaid order', placed.status < 300 && placed.body && placed.body.reference, placed.status + ' ' + JSON.stringify(placed.body).slice(0, 120));
  const book2 = await j('GET', '/api/staff/orders', null, ck);
  const paid = (book2.body.orders || []).find(o => o.status === 'paid');
  const owing = (book2.body.orders || []).find(o => o.reference === (placed.body || {}).reference && !o.receivedPaise);
  check('seed has a paid and an owing order', !!paid && !!owing);
  if (paid) {
    const r = await j('DELETE', '/api/staff/orders/' + paid.reference, null, ck);
    check('a paid order is refused (409)', r.status === 409, r.status + ' ' + JSON.stringify(r.body));
  }
  if (owing) {
    const r = await j('DELETE', '/api/staff/orders/' + owing.reference, null, ck);
    check('an owing order is removed', r.status === 200 && r.body.reference === owing.reference, r.status + ' ' + JSON.stringify(r.body));
    const again = await j('GET', '/api/staff/orders', null, ck);
    check('and is gone from the book', !(again.body.orders || []).some(o => o.reference === owing.reference));
    const twice = await j('DELETE', '/api/staff/orders/' + owing.reference, null, ck);
    check('removing it again says no such order', twice.status === 409);
  }
  const couns = await j('POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
  if (couns.status === 200 && owing) {
    const r = await j('DELETE', '/api/staff/orders/GLV-0000', null, couns.cookie);
    check('a counsellor cannot', r.status === 403, r.status);
  }
  console.log('unordertest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
