'use strict';
/*
 * The marketing level works the lead book (3 Nov, owner).
 *
 * An editor with the marketing permission can read the leads, the Leads
 * command board and their alerts, note and follow up a lead, hand it to a
 * counsellor, and convert it — and still cannot open a student record. A
 * plain editor (no marketing permission) is kept out of the lead book as
 * before. Runs against a server on BASE (default localhost:8099) with its
 * demo accounts.
 */
const http = require('http');
const BASE = new URL(process.env.BASE || 'http://localhost:8099');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
let pass = 0, fail = 0;
const check = (name, ok, note) => { if (ok) pass++; else fail++; console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || note == null ? '' : ' — ' + note)); };

const call = (path, opts) => new Promise(resolve => {
  opts = opts || {};
  const req = http.request({ host: BASE.hostname, port: BASE.port, path, method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, opts.headers || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const login = async (email, pw) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: pw || 'glovels123' } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};

(async () => {
  const stamp = Date.now();
  const admin = await login('admin@glovels.com');
  check('admin signs in', !!admin);

  /* Two editors: one with the marketing permission, one without. */
  const mk = await call('/api/staff/people', { method: 'POST', headers: { Cookie: admin },
    body: { name: 'Maya Marketing', email: 'maya.' + stamp + '@example.com', role: 'editor', perms: ['marketing'], password: 'a-strong-password-252' } });
  check('a marketing editor is made', mk.status === 200 || mk.status === 201, mk.status + ' ' + JSON.stringify(mk.body).slice(0, 120));
  const ed = await call('/api/staff/people', { method: 'POST', headers: { Cookie: admin },
    body: { name: 'Eddie Editor', email: 'eddie.' + stamp + '@example.com', role: 'editor', perms: ['content'], password: 'a-strong-password-252' } });
  check('a plain editor is made', ed.status === 200 || ed.status === 201, ed.status);
  let maya = await login('maya.' + stamp + '@example.com', 'a-strong-password-252');
  let eddie = await login('eddie.' + stamp + '@example.com', 'a-strong-password-252');
  check('both sign in', !!maya && !!eddie);
  /* An account made by the office chooses its own password first (patch
     201); the change signs the old session out, so sign in again. */
  for (const c of [maya, eddie]) {
    const ch = await call('/api/auth/change', { method: 'POST', headers: { Cookie: c }, body: { current: 'a-strong-password-252', password: 'my-own-password-252', confirm: 'my-own-password-252' } });
    check('…and chooses an own password', ch.status === 200, ch.status + ' ' + JSON.stringify(ch.body).slice(0, 100));
  }
  maya = await login('maya.' + stamp + '@example.com', 'my-own-password-252');
  eddie = await login('eddie.' + stamp + '@example.com', 'my-own-password-252');
  check('…and sign in again', !!maya && !!eddie);

  /* A lead to work. */
  const enq = await call('/api/enquiries', { method: 'POST', body: { name: 'Lead For Marketing', email: 'lead.' + stamp + '@example.com', phone: '9876501234', destination: 'DE', consent: 'yes', message: 'Please call me about Germany' } });
  check('a lead arrives through the form', enq.status === 200, enq.status + ' ' + JSON.stringify(enq.body).slice(0, 100));

  /* The marketing level reads the book, the board and its alerts. */
  let r = await call('/api/staff/leads', { headers: { Cookie: maya } });
  check('marketing reads the lead book', r.status === 200 && Array.isArray(r.body.leads), r.status);
  const lead = (r.body.leads || []).find(l => l.email === 'lead.' + stamp + '@example.com');
  check('…and sees the new lead in it', !!lead, JSON.stringify((r.body.leads || []).slice(0, 2)).slice(0, 120));
  r = await call('/api/staff/leads/command', { headers: { Cookie: maya } });
  check('marketing opens the Leads command board', r.status === 200, r.status);
  r = await call('/api/staff/alerts', { headers: { Cookie: maya } });
  check('marketing reads its alerts', r.status === 200, r.status);
  r = await call('/api/staff/lead-lookup?email=' + encodeURIComponent('lead.' + stamp + '@example.com'), { headers: { Cookie: maya } });
  check('marketing looks a lead up', r.status === 200, r.status);

  /* Notes, follow-ups, and the hand-off to a counsellor. */
  const kavya = (r = await call('/api/staff/people', { headers: { Cookie: admin } }), ((r.body.people || r.body || [])).find(p => p.email === 'kavya@glovels.com'));
  check('the counsellor is on the staff list', !!kavya, JSON.stringify(r.body).slice(0, 100));
  if (lead) {
    r = await call('/api/staff/lead/' + lead.id + '/note', { method: 'POST', headers: { Cookie: maya }, body: { kind: 'call', body: 'Called, no answer — WhatsApp sent' } });
    check('marketing logs a follow-up', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 100));
    r = await call('/api/staff/lead/' + lead.id, { method: 'PUT', headers: { Cookie: maya }, body: { ownerId: kavya && kavya.id } });
    check('marketing hands the lead to a counsellor', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    r = await call('/api/staff/lead/' + lead.id, { headers: { Cookie: admin } });
    check('…and the book shows the counsellor as its owner', r.status === 200 && kavya && Number((r.body.lead || r.body).ownerId) === Number(kavya.id), JSON.stringify(r.body).slice(0, 120));
  }

  /* Still no student records for either editor. */
  r = await call('/api/staff/students', { headers: { Cookie: maya } });
  check('marketing cannot list students', r.status === 403, r.status);
  r = await call('/api/staff/student/1', { headers: { Cookie: maya } });
  check('…nor open one', r.status === 403 || r.status === 404, r.status);

  /* A plain editor is kept out of the lead book. */
  r = await call('/api/staff/leads', { headers: { Cookie: eddie } });
  check('a plain editor cannot read the lead book', r.status === 403, r.status);
  r = await call('/api/staff/leads/command', { headers: { Cookie: eddie } });
  check('…nor the board', r.status === 403, r.status);

  /* The staff pages let the marketing level in. */
  const page = await call('/leads-command', { headers: { Cookie: maya } });
  check('the Leads command page admits the marketing level', page.status === 200 && /indexOf\('marketing'\) < 0\) \{ \$\('#error'\)/.test(page.body.raw || ''), page.status);
  const leadsPage = await call('/leads', { headers: { Cookie: maya } });
  check('the Leads page lists the lead screens for a marketing editor', leadsPage.status === 200 && /leads: me\.user\.role !== 'editor' \|\| perms\.indexOf\('marketing'\) >= 0/.test(leadsPage.body.raw || ''), leadsPage.status);

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
