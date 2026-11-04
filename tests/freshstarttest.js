/* Patch 266: the fresh start removes everything from before a moment and
   keeps real money and anyone who came after it. */
const BASE = 'http://localhost:8099';
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
async function j(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, body: d, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const admin = await j('POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  const ck = admin.cookie;
  /* The seed: student@glovels.com with a paid order (kept), plus an unpaid one. */
  const stu = await j('POST', '/api/auth/login', { email: 'student@glovels.com', password: 'glovels123' });
  const placed = await j('POST', '/api/orders', { packageId: 'pkg-roadmap', name: 'T', email: 'student@glovels.com', phone: '9876543210', acceptedTerms: true }, stu.cookie);
  check('an unpaid order sits on the paid student', placed.status < 300);
  /* An old test account: made now, so the cutoff is a second later. */
  const old = await j('POST', '/api/auth/signup', { name: 'Old Tester', email: 'old.tester@example.net', password: 'glovels123!', phone: '9876500001', acceptedTerms: true });
  check('an old test student signs up', old.status < 300, old.status + ' ' + JSON.stringify(old.body).slice(0, 80));
  await sleep(1500);
  const cutoff = new Date().toISOString();
  await sleep(1500);
  const fresh = await j('POST', '/api/auth/signup', { name: 'First Real Student', email: 'first.real@example.net', password: 'glovels123!', phone: '9876500002', acceptedTerms: true });
  check('a real student signs up after the cutoff', fresh.status < 300, fresh.status);

  /* After the cutoff, a real student pays and the office records it (a
     bank transfer, say): that is money, and stays. */
  const real = await j('POST', '/api/auth/login', { email: 'first.real@example.net', password: 'glovels123!' });
  const realOrder = await j('POST', '/api/orders', { packageId: 'pkg-roadmap', name: 'First Real Student', email: 'first.real@example.net', phone: '9876500002', acceptedTerms: true }, real.cookie);
  const realPay = await j('POST', '/api/staff/order/' + realOrder.body.reference + '/payment', { amount: realOrder.body.grossPaise / 100, method: 'bank', reference: 'UTR9', date: new Date().toISOString().slice(0, 10) }, ck);
  check('a payment after the cutoff is recorded', realPay.status < 300, realPay.status);
  const pv = await j('POST', '/api/staff/fresh/preview', { before: cutoff }, ck);
  check('preview answers', pv.status === 200, pv.status + ' ' + JSON.stringify(pv.body).slice(0, 120));
  const goes = (pv.body.students || []).map(p => p.email);
  const kept = (pv.body.kept || []).map(p => p.email);
  check('the old tester would go', goes.includes('old.tester@example.net'), goes.join(','));
  /* Patch 268: the seed's "paid" order was marked by hand before the cutoff
     — a rehearsal, not a gateway payment — so that account goes too. */
  check('a hand-marked paid order from before the cutoff goes', goes.includes('student@glovels.com'), goes.join(','));
  check('the student after the cutoff is kept', kept.includes('first.real@example.net'), kept.join(','));
  check('the unpaid order on the paid student goes too', (pv.body.orders || []).some(o => o.reference === placed.body.reference));
  check('and the hand-marked paid order is listed to go', (pv.body.orders || []).some(o => o.status === 'paid'));
  check('the order paid after the cutoff is not', !(pv.body.orders || []).some(o => o.reference === realOrder.body.reference));

  const no = await j('POST', '/api/staff/fresh/start', { before: cutoff, confirm: 'nope' }, ck);
  check('a wrong confirmation removes nothing', no.status === 422);
  const couns = await j('POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
  const notyou = await j('POST', '/api/staff/fresh/start', { before: cutoff, confirm: 'FRESH START' }, couns.cookie);
  check('a counsellor cannot', notyou.status === 403, notyou.status);

  const go = await j('POST', '/api/staff/fresh/start', { before: cutoff, confirm: 'FRESH START' }, ck);
  check('the fresh start runs', go.status === 200 && go.body.removed && go.body.removed.students >= 1, go.status + ' ' + JSON.stringify(go.body).slice(0, 120));
  const after = await j('GET', '/api/staff/students', null, ck);
  const mails = ((after.body && (after.body.students || after.body)) || []).map(s => s.email);
  check('the old tester is gone', !mails.includes('old.tester@example.net'));
  check('the real student remains and the rehearsal account is gone', mails.includes('first.real@example.net') && !mails.includes('student@glovels.com'), mails.join(','));
  const book = await j('GET', '/api/staff/orders', null, ck);
  check('the order paid after the cutoff is still on the book', (book.body.orders || []).some(o => o.reference === realOrder.body.reference && o.status === 'paid'));
  check('the unpaid one is not', !(book.body.orders || []).some(o => o.reference === placed.body.reference));
  console.log('freshstarttest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
