/**
 * e2e100test — the end-to-end operations simulation (3 Nov 2026, go-live).
 *
 * One server, one database, and everything that can happen between go-live
 * and a closed file for 100 students, 5 counsellors, a marketing person, a
 * partner agency and the administrators — then the question that matters:
 * does the Command centre (/ops) and the Marketing dashboard (/marketing) say
 * what actually happened?
 *
 * API-driven (node fetch) for the volume; Playwright only for the screens at
 * the checkpoints, with screenshots to /home/claude/briefs/e2e-*.png.
 * Deterministic: the population is drawn from a seeded generator.
 *
 * Boots its own server on PORT with stand-in Razorpay and Stripe gateways
 * (correctly signed webhooks), fast lead clocks (LEAD_MINUTE_MS=1000: a
 * "minute" is a second, so a 15-minute SLA is 15 seconds), the CDN country
 * header trusted (GEO_TRUST_HEADER), and the mail provider left in outbox mode
 * so every email is a file we can count.
 *
 *     node tests/e2e100test.js            (≈ 6–10 minutes on 2 CPUs)
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8222);
const RZP_PORT = PORT + 1, ST_PORT = PORT + 2;
const BASE = 'http://localhost:' + PORT;
const SHOTS = process.env.SHOTS || '/home/claude/briefs';
const DIR = '/tmp/db-e2e100-' + PORT;
const N = Number(process.env.N || 100);

/* ------------------------------------------------------------ bookkeeping */
let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, note) => {
  if (cond) pass++; else { fail++; failures.push(name + (note != null ? ' — ' + String(note).slice(0, 300) : '')); }
  if (!cond || process.env.VERBOSE) console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond || note == null ? '' : ' — ' + String(note).slice(0, 300)));
};
const bugs = [];
const bug = (sev, what, where) => { bugs.push({ sev, what, where }); console.log('  !! ' + sev + ': ' + what + (where ? ' [' + where + ']' : '')); };
const J = x => JSON.stringify(x);
const wait = ms => new Promise(r => setTimeout(r, ms));
const say = t => console.log('\n== ' + t);

/* Seeded randomness: the same population every run. */
let seed = 20261103;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/* ---------------------------------------------------------------- http */
const slow = [];                               // every request over 2 s
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const jars = {};                               // who → { cookie: value }
function cookieOf(who) { return Object.entries(jars[who] || {}).map(([k, v]) => k + '=' + v).join('; '); }
function keep(who, res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (!set.length) return;
  jars[who] = jars[who] || {};
  set.forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) jars[who][kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
}
/**
 * req(who, method, path, body?, opts?) → { status, ok, body, headers, ms }
 * `who` is the actor whose cookies are sent and kept; opts.ip / opts.country
 * set X-Forwarded-For and cf-ipcountry; opts.form sends a FormData.
 */
async function req(who, method, p, body, opts) {
  opts = opts || {};
  const h = Object.assign({}, opts.headers || {});
  const act = actors[who] || {};
  h['x-forwarded-for'] = opts.ip || act.ip || '203.0.113.9';
  if (opts.country || act.country) h['cf-ipcountry'] = opts.country || act.country;
  h['user-agent'] = opts.ua || act.ua || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36 glovels-e2e';
  const ck = cookieOf(who);
  if (ck) h.cookie = ck;
  let payload;
  if (opts.form) payload = opts.form;
  else if (opts.raw != null) { payload = opts.raw; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const t0 = Date.now();
  const r = await fetch(BASE + p, { method, headers: h, body: payload, redirect: 'manual' });
  const ms = Date.now() - t0;
  if (ms > 2000) { slow.push({ method, p, ms }); console.log('  slow: ' + method + ' ' + p + ' ' + ms + ' ms'); }
  keep(who, r);
  let j = null; const ct = r.headers.get('content-type') || '';
  if (/json/.test(ct)) { try { j = await r.json(); } catch (e) { j = null; } }
  else { try { j = { raw: await r.text() }; } catch (e) { j = {}; } }
  return { status: r.status, ok: r.ok, body: j || {}, headers: r.headers, ms };
}
const actors = {};                              // who → { ip, country, ua }
let ipN = 20;
const freshIp = () => '198.51.100.' + ((ipN++ % 250) + 2) + '.' + Math.floor(ipN / 250);
const pdf = (label, n) => Buffer.concat([Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj << /Type /Catalog >> endobj\n% ' + label + '\n'), crypto.randomBytes(n || 1500), Buffer.from('\n%%EOF\n')]);
const jpg = n => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]), crypto.randomBytes(n || 1800), Buffer.from([0xFF, 0xD9])]);
function fileForm(fieldName, bytes, filename, type, fields) {
  const fd = new FormData();
  Object.entries(fields || {}).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append(fieldName, new Blob([bytes], { type }), filename);
  return fd;
}
const login = (who, email, password) => req(who, 'POST', '/api/auth/login', { email, password });

/* ----------------------------------------------------- stand-in gateways */
const RZP = { key: 'rzp_test_e2e', secret: 'rzs-e2e', hook: 'rzh-e2e', orders: {} };          // orders[id] = {amount,currency,receipt}
const ST = { key: 'sk_test_e2e', hook: 'whsec_e2e', sessions: {} };
const rzpSrv = http.createServer((rq, rs) => {
  let b = ''; rq.on('data', c => { b += c; }); rq.on('end', () => {
    const o = JSON.parse(b || '{}'); const id = 'order_' + crypto.randomBytes(6).toString('hex');
    RZP.orders[id] = Object.assign({ id }, o);
    rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ id, amount: o.amount, currency: o.currency }));
  });
});
const stSrv = http.createServer((rq, rs) => {
  let b = ''; rq.on('data', c => { b += c; }); rq.on('end', () => {
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    if (rq.method === 'POST' && rq.url === '/v1/checkout/sessions') {
      const q = new URLSearchParams(b); const id = 'cs_test_' + crypto.randomBytes(8).toString('hex');
      ST.sessions[id] = { id, currency: q.get('line_items[0][price_data][currency]'), amount_total: Number(q.get('line_items[0][price_data][unit_amount]')),
        metadata: { reference: q.get('metadata[reference]'), part: q.get('metadata[part]') } };
      return rs.end(JSON.stringify({ id, url: 'https://checkout.stripe.test/' + id }));
    }
    const m = /^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(rq.url);
    if (rq.method === 'GET' && m && ST.sessions[m[1]]) {
      const s = ST.sessions[m[1]];
      return rs.end(JSON.stringify(Object.assign({}, s, { payment_status: 'paid', status: 'complete', payment_intent: 'pi_' + m[1].slice(8) })));
    }
    rs.end('{}');
  });
});
async function rzpWebhook(reference, orderId) {
  const o = RZP.orders[orderId];
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_' + crypto.randomBytes(5).toString('hex'), order_id: orderId, amount: o.amount, currency: o.currency, status: 'captured' } } } });
  const sig = crypto.createHmac('sha256', RZP.hook).update(body).digest('hex');
  return req('hook', 'POST', '/api/razorpay/webhook', undefined, { raw: body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig } });
}
async function stripeWebhook(sessionId) {
  const s = ST.sessions[sessionId];
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: Object.assign({}, s, { payment_status: 'paid', status: 'complete', payment_intent: 'pi_' + sessionId.slice(8) }) } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', ST.hook).update(t + '.' + raw).digest('hex');
  return req('hook', 'POST', '/api/stripe/webhook', undefined, { raw, headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + t + ',v1=' + v1 } });
}

/* ------------------------------------------------------------ population */
const FIRST_IN = ['Aarav', 'Ananya', 'Rohan', 'Priya', 'Karthik', 'Sneha', 'Vikram', 'Divya', 'Arjun', 'Meghana', 'Siddharth', 'Nandini', 'Harsha', 'Pooja', 'Rahul', 'Kavitha', 'Nikhil', 'Shreya', 'Manoj', 'Lakshmi', 'Suresh', 'Bhavana', 'Varun', 'Ishita', 'Gautam', 'Ritika', 'Pranav', 'Sanjana', 'Yash', 'Tanvi'];
const LAST_IN = ['Reddy', 'Sharma', 'Iyer', 'Patel', 'Nair', 'Rao', 'Gupta', 'Mehta', 'Joshi', 'Kulkarni', 'Pillai', 'Bose', 'Chowdhury', 'Verma', 'Singh', 'Das', 'Menon', 'Naidu', 'Kapoor', 'Bhat'];
const ABROAD = [
  { c: 'NP', cur: 'NPR', names: ['Bikash Shrestha', 'Sita Gurung', 'Prakash Tamang', 'Anita Rai', 'Suman Thapa'], phone: '+977 98' },
  { c: 'BD', cur: 'BDT', names: ['Tanvir Ahmed', 'Farhana Akter', 'Rakib Hossain', 'Nusrat Jahan', 'Mahmud Rahman'], phone: '+880 17' },
  { c: 'LK', cur: 'LKR', names: ['Kasun Perera', 'Dilini Fernando', 'Nuwan Silva', 'Sachini Jayawardena'], phone: '+94 77' },
  { c: 'NG', cur: 'NGN', names: ['Chidi Okafor', 'Ngozi Adeyemi', 'Emeka Nwosu', 'Funmi Balogun', 'Tunde Okoro'], phone: '+234 803' },
  { c: 'GH', cur: 'GHS', names: ['Kwame Mensah', 'Akosua Boateng', 'Kofi Asante'], phone: '+233 24' },
  { c: 'KE', cur: 'KES', names: ['Wanjiru Kamau', 'Otieno Odhiambo', 'Amina Hassan', 'Brian Mwangi'], phone: '+254 72' },
  { c: 'PH', cur: 'PHP', names: ['Jose Santos', 'Maria Reyes', 'Angelo Cruz', 'Lea Bautista'], phone: '+63 917' },
  { c: 'AE', cur: 'AED', names: ['Imran Qureshi', 'Fatima Al Marri', 'Rizwan Shaikh'], phone: '+971 50' },
  { c: 'DE', cur: 'EUR', names: ['Lukas Weber', 'Neha Krishnan', 'Jonas Becker'], phone: '+49 151' },
  { c: 'RS', cur: 'EUR', names: ['Milos Petrovic', 'Jelena Jovanovic', 'Nikola Markovic', 'Ana Nikolic'], phone: '+381 63' },
];
const DESTS = [['DE', 'Germany', 44], ['GB', 'United Kingdom', 12], ['US', 'United States', 8], ['CA', 'Canada', 7], ['IE', 'Ireland', 6], ['AU', 'Australia', 6], ['FR', 'France', 5], ['IT', 'Italy', 5], ['NZ', 'New Zealand', 7]];
const FIELDS = ['Computer Science & IT', 'Data Science, AI & Machine Learning', 'Mechanical & Automotive Engineering', 'Business & Management', 'Medicine, Dentistry & Allied Health', 'Electrical & Electronics Engineering', 'MBA', 'Economics'];
const LEVELS = ['master', 'master', 'master', 'master', 'master', 'master', 'bachelor', 'bachelor', 'mba', 'mba', 'diploma'];
const FATES = Array(80).fill('won').concat(Array(12).fill('left'), Array(8).fill('lost'));

function population() {
  const dests = shuffle(DESTS.flatMap(([c, n, k]) => Array(k).fill([c, n])));
  const fates = shuffle(FATES);
  const out = [];
  for (let i = 0; i < N; i++) {
    const india = i < Math.round(N * 0.6);
    let name, residence, cur, phone;
    if (india) {
      name = FIRST_IN[i % FIRST_IN.length] + ' ' + LAST_IN[Math.floor(i / 3) % LAST_IN.length];
      residence = 'IN'; cur = 'INR'; phone = '9' + String(100000100 + i * 7).slice(-9);
    } else {
      const a = ABROAD[(i - Math.round(N * 0.6)) % ABROAD.length];
      name = a.names[Math.floor((i - Math.round(N * 0.6)) / ABROAD.length) % a.names.length] + (i % 2 ? '' : ' ' + String.fromCharCode(65 + (i % 26)) + '.');
      residence = a.c; cur = a.cur; phone = a.phone + ' ' + String(2000000 + i * 13).slice(-7);
    }
    const [dest, destName] = dests[i % dests.length];
    const route = (i % 10) + 1;
    const level = dest === 'DE' ? pick(['master', 'master', 'master', 'bachelor', 'mba']) : pick(LEVELS);
    const cgpa = Math.round((5.2 + rnd() * 4.3) * 10) / 10;
    const eng = pick([['ielts', '6.5'], ['ielts', '7.0'], ['ielts', '7.5'], ['toefl', '95'], ['toefl', '105'], ['moi', '']]);
    const s = {
      i, name, email: 'stu' + String(i + 1).padStart(3, '0') + '.' + name.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '') + '@glv-sim.in',
      phone, pw: 'Sim-' + (1000 + i) + '-pass!', who: 's' + i, india, residence, cur,
      dest, destName, level, field: dest === 'NZ' ? 'Business & Management' : FIELDS[i % FIELDS.length], cgpa,
      eng: eng[0], engScore: eng[1], gre: rnd() < 0.3, german: dest === 'DE' ? pick(['none', 'A1', 'A2', 'B1', 'B2']) : 'none',
      route, fate: fates[i], counsellor: i % 5,
      pkg: null, payIn: 'full', payVia: 'office', services: [],
      // what happened, for the reconciliation
      id: null, leadId: null, orders: [], msgsOut: 0, msgsIn: 0, docs: 0, paidPaise: 0, grossPaise: 0, lastFromStudent: false, apps: [],
    };
    /* The package and how it is paid. */
    if (dest === 'DE') s.pkg = pick(['pkg-three-public', 'pkg-roadmap', 'pkg-roadmap', 'pkg-offer', 'pkg-boarding']);
    else if (dest === 'NZ') s.pkg = i % 3 === 0 ? 'pkg-assist' : null;
    else s.pkg = pick(['pkg-assist', 'pkg-apply-one', 'pkg-apply-three', 'pkg-apply-three']);
    if (s.pkg === 'pkg-offer' || s.pkg === 'pkg-boarding') s.payIn = i % 2 ? 'parts' : 'full';
    s.payVia = i % 3 === 0 ? 'gateway' : 'office';
    if (i % 7 === 0) s.services.push('counsel');                 // free
    if (i % 5 === 1) s.services.push('sop');                     // paid
    if (dest === 'DE' && i % 4 === 0) s.services.push('german'); // levelled (A1 default)
    if (i % 11 === 3) s.services.push('insure');                 // on request → quote
    out.push(s);
  }
  return out;
}

/* ---------------------------------------------------------------- server */
let child = null;
async function boot() {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  await new Promise(r => rzpSrv.listen(RZP_PORT, r));
  await new Promise(r => stSrv.listen(ST_PORT, r));
  child = spawn(process.execPath, ['--max-old-space-size=300', 'serve.js'], {
    cwd: ROOT, detached: true, stdio: ['ignore', fs.openSync(DIR + '/serve.log', 'a'), fs.openSync(DIR + '/serve.log', 'a')],
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off', GEO_TRUST_HEADER: 'cf-ipcountry',
      RAZORPAY_KEY_ID: RZP.key, RAZORPAY_KEY_SECRET: RZP.secret, RAZORPAY_WEBHOOK_SECRET: RZP.hook, RAZORPAY_API_BASE: 'http://localhost:' + RZP_PORT,
      STRIPE_SECRET_KEY: ST.key, STRIPE_WEBHOOK_SECRET: ST.hook, STRIPE_API_BASE: 'http://localhost:' + ST_PORT,
      LEAD_MINUTE_MS: '1000', LEAD_SLA_TICK_MS: '500',
    }),
  });
  for (let i = 0; i < 150; i++) { await wait(500); try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (e) { /* booting */ } }
  throw new Error('server did not come up; see ' + DIR + '/serve.log');
}
function rssMb() {
  try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/' + child.pid + '/status', 'utf8')); return m ? Math.round(Number(m[1]) / 1024) : 0; } catch (e) { return 0; }
}
let rssPeak = 0;
const rssTimer = setInterval(() => { rssPeak = Math.max(rssPeak, rssMb()); }, 2000);

/* ------------------------------------------------------------- the run */
(async () => {
  const T0 = Date.now();
  say('boot');
  await boot();
  await wait(1500);
  const S = population();
  const A = 'admin';
  actors[A] = { ip: '203.0.113.10', country: 'IN' };
  let r = await login(A, 'admin@glovels.com', 'glovels123');
  check('admin signs in', r.ok, r.status);
  const base = {
    overview: (await req(A, 'GET', '/api/staff/overview')).body,
    money: (await req(A, 'GET', '/api/staff/money')).body,
  };
  /* The seed student is closed so the board carries only the simulation. */
  await req(A, 'PUT', '/api/staff/student/3/status', { status: 'completed', note: 'seed file, closed before the simulation' });

  /* ---------------------------------------------------------- the team */
  say('the team: 5 counsellors, a marketing person, a partner agency');
  const C = [];
  const mkStaff = async (who, body) => {
    const x = await req(A, 'POST', '/api/staff/people', body);
    check('staff: ' + body.name + ' created', x.ok && x.body.person, x.status + ' ' + J(x.body).slice(0, 200));
    actors[who] = { ip: freshIp(), country: 'IN' };
    const l = await login(who, body.email, body.password);
    check('staff: ' + body.name + ' signs in', l.ok, l.status);
    await req(who, 'POST', '/api/auth/change', { password: body.password + 'X' });
    await login(who, body.email, body.password + 'X');
    return Object.assign({ who, email: body.email, pw: body.password + 'X' }, x.body.person || {});
  };
  const cNames = ['Ravi Shankar', 'Lakshmi Prasad', 'Anil Kumar', 'Deepa Nair', 'George Thomas'];
  for (let k = 0; k < 5; k++) {
    const body = { name: cNames[k], email: 'c' + (k + 1) + '@glv-sim.in', password: 'Counsel-' + (k + 1) + '-pass!', role: 'counsellor', phone: '98' + String(10000000 + k * 11).slice(-8) };
    if (k === 4) { body.manager = true; body.scope = ['GB']; }      // the country admin for the UK
    if (k === 3) { body.scope = ['DE', 'FR', 'IT']; }                // a counsellor limited to three countries
    C.push(await mkStaff('c' + k, body));
  }
  /* The marketing person. The product's "marketing" level is an editor
     with the marketing permission — which caseworkOnly refuses. See the
     checks below; the simulation gives Meera a counsellor account WITH the
     permission so she can work the leads. */
  const Med = await mkStaff('mktE', { name: 'Meera Krishnan', email: 'meera.editor@glv-sim.in', password: 'Market-9-pass!', role: 'editor', perms: ['marketing'] });
  r = await req('mktE', 'GET', '/api/staff/leads');
  check('ROLE: an editor with the marketing permission can open the marketing dashboard', (await req('mktE', 'GET', '/api/marketing/report')).ok);
  if (r.status === 403) bug('HIGH', 'The "marketing" level (editor + marketing permission) cannot read, qualify, follow up or convert leads — /api/staff/leads is caseworkOnly and refuses editors (403). A marketing person has to be given a counsellor account to work /leads and /leads-command.', 'server/api.js caseworkOnly + levelOf');
  const M = await mkStaff('mkt', { name: 'Meera Krishnan', email: 'meera@glv-sim.in', password: 'Market-7-pass!', role: 'counsellor', perms: ['marketing'], kind: 'employee' });
  check('marketing (as a counsellor account) opens the marketing dashboard', (await req('mkt', 'GET', '/api/marketing/report')).ok);
  const P = await mkStaff('partner', { name: 'Horizon Overseas Education', email: 'desk@horizon-agency-sim.in', password: 'Partner-1-pass!', role: 'partner' });
  check('partner sees their (empty) list', (await req('partner', 'GET', '/api/partner/students')).ok);

  /* -------------------------------------------------- lead SLA for the run */
  r = await req(A, 'PUT', '/api/staff/leads/sla', { firstMins: 15, escalateMins: 30, burstMins: 1 });
  check('lead SLA set: 15 "minutes" to first response (seconds here), 30 to escalate', r.ok && r.body.settings && r.body.settings.firstMins === 15, J(r.body));

  /* -------------------------------------------- the catalogue, widened */
  say('catalogue: destinations the seed does not cover');
  const extra = [];
  const add = (country, uni, city, program, level, field, pub, fee, extraReqs) => extra.push({
    id: 'e2e-' + country.toLowerCase() + '-' + (extra.length + 1), program, university: uni, city, country, level, field, isPublic: !!pub,
    totalInr: fee, fit: 75, minCgpa: 6, intakes: [{ season: 'winter', deadline: '2027-06-15' }, { season: 'summer', deadline: '2027-11-30' }],
    reqs: Object.assign({ ieltsMin: 6.5 }, extraReqs || {}),
  });
  ['Northeastern University|Boston', 'Arizona State University|Tempe', 'University at Buffalo|Buffalo', 'Illinois Institute of Technology|Chicago'].forEach((u, k) => { const [n, c] = u.split('|'); add('US', n, c, ['MS Computer Science', 'MS Data Science', 'MBA', 'MS Mechanical Engineering'][k], ['master', 'master', 'mba', 'master'][k], FIELDS[[0, 1, 6, 2][k]], false, 4200000 + k * 150000, { greRequired: k < 2 }); });
  ['Conestoga College|Kitchener', 'Humber College|Toronto', 'University of Windsor|Windsor'].forEach((u, k) => { const [n, c] = u.split('|'); add('CA', n, c, ['Diploma in Business', 'PG Diploma in Data Analytics', 'MEng Mechanical'][k], ['diploma', 'diploma', 'master'][k], FIELDS[[3, 1, 2][k]], false, 1800000 + k * 100000); });
  ['Deakin University|Melbourne', 'RMIT University|Melbourne', 'University of Wollongong|Wollongong'].forEach((u, k) => { const [n, c] = u.split('|'); add('AU', n, c, ['Master of IT', 'MBA', 'Bachelor of Nursing'][k], ['master', 'mba', 'bachelor'][k], FIELDS[[0, 6, 4][k]], false, 3800000 + k * 120000); });
  ['ESSEC Business School|Paris', 'EDHEC|Lille', 'EPITA|Paris'].forEach((u, k) => { const [n, c] = u.split('|'); add('FR', n, c, ['MSc Management', 'MSc Finance', 'MSc Computer Science'][k], 'master', FIELDS[[3, 3, 0][k]], false, 2600000 + k * 90000); });
  ['Politecnico di Milano|Milan', 'Bocconi University|Milan'].forEach((u, k) => { const [n, c] = u.split('|'); add('IT', n, c, ['MSc Mechanical Engineering', 'MSc Economics'][k], 'master', FIELDS[[2, 7][k]], false, 1200000 + k * 500000); });
  ['University of Hertfordshire|Hatfield', 'Coventry University|Coventry', 'Northumbria University|Newcastle', 'University of Greenwich|London'].forEach((u, k) => { const [n, c] = u.split('|'); add('GB', n, c, ['MSc Data Science', 'MBA', 'MSc Nursing', 'BSc Computer Science'][k], ['master', 'mba', 'master', 'bachelor'][k], FIELDS[[1, 6, 4, 0][k]], false, 2200000 + k * 80000); });
  /* Private German universities — enough to test the 15-university cap. */
  for (let k = 0; k < 14; k++) add('DE', ['IU International University', 'SRH Hochschule Heidelberg', 'GISMA Business School', 'Berlin School of Business and Innovation', 'EU Business School Munich', 'Macromedia University', 'Hochschule Fresenius', 'CODE University Berlin', 'Constructor University Bremen', 'Munich Business School', 'ISM Dortmund', 'Arden University Berlin', 'Steinbeis University', 'University of Europe for Applied Sciences'][k], 'Berlin', ['MSc Computer Science', 'MBA', 'MSc Data Science', 'BSc Business', 'MSc Engineering Management'][k % 5], ['master', 'mba', 'master', 'bachelor', 'master'][k % 5], FIELDS[[0, 6, 1, 3, 2][k % 5]], false, 1500000 + k * 60000, { germanLevel: k % 3 === 0 ? 'A1' : null });
  for (let k = 0; k < 3; k++) add('DE', ['Hochschule Darmstadt', 'TH Köln', 'Hochschule Bremen'][k], ['Darmstadt', 'Köln', 'Bremen'][k], ['BSc Computer Science', 'BEng Mechanical Engineering', 'BSc International Business'][k], 'bachelor', FIELDS[[0, 2, 3][k]], true, 160000, { germanLevel: 'B1' });
  let addedCat = 0;
  for (const p of extra) { const x = await req(A, 'PUT', '/api/staff/programme', p); if (x.ok) addedCat++; else console.log('  catalogue refused', p.id, J(x.body).slice(0, 160)); }
  check('catalogue: ' + extra.length + ' programmes added through the office route', addedCat === extra.length, addedCat);
  const cat = (await req(A, 'GET', '/api/staff/catalogue?per=1000')).body.programmes || [];
  check('catalogue now has ' + cat.length + ' programmes (171 + ' + extra.length + ')', cat.length >= 171 + extra.length, cat.length);
  const byDest = {};
  cat.forEach(p => { (byDest[p.country] = byDest[p.country] || []).push(p); });
  const progsFor = (s, pub, n) => {
    const rows = (byDest[s.dest] || []).filter(p => !!p.isPublic === !!pub);
    const same = rows.filter(p => p.level === s.level);
    const pool = (same.length >= n ? same : rows).slice();
    const out = []; const unis = new Set();
    for (const p of pool) { if (unis.has(p.university)) continue; unis.add(p.university); out.push(p); if (out.length >= n) break; }
    return out;
  };
  check('a destination with no catalogue data exists for the contact-form path (NZ)', !(byDest.NZ || []).length, (byDest.NZ || []).length);

  /* =============================================== PHASE 1: arrivals */
  say('phase 1: 100 arrivals by ten doors');
  const CFG = (await req('x', 'GET', '/api/pay/config')).body;
  const slots = ((await req('x', 'GET', '/api/booking/slots')).body.days || []).flatMap(d => d.slots.filter(x => x.free).map(x => x.at));
  let slotN = 0;
  const leadsMade = [];                       // { s, id, source }
  let followUps = 0, touches = 0;             // every note; and the ones the book counts as follow-ups
  const finderAnswers = s => ({ g_country: s.destName, g_level: s.level, g_field: s.field, d_cgpa: String(s.cgpa), d_max: '10',
    e_test: s.eng === 'moi' ? 'moi' : s.eng, e_score: s.engScore, a_test: s.gre ? 'gre' : 'none', a_score: s.gre ? '318' : '', g_german: s.german === 'none' ? '' : s.german, w_months: String((s.i % 4) * 12) });
  const profileFor = s => Object.assign({ firstName: s.name.split(' ')[0], lastName: s.name.split(' ').slice(1).join(' ') || 'Kumar', phone: s.phone, addr_country: s.residence }, finderAnswers(s));
  const visit = async (s, utm) => {           // a visitor reads two pages first — the marketing funnel starts here
    await req(s.who, 'GET', '/' + (utm || ''), undefined, { headers: { accept: 'text/html' } });
    await req(s.who, 'GET', s.dest === 'DE' ? '/study-in-germany' : '/universities', undefined, { headers: { accept: 'text/html' } });
  };
  const signup = async s => {
    const x = await req(s.who, 'POST', '/api/auth/signup', { name: s.name, email: s.email, phone: s.phone, password: s.pw, terms: true });
    check('signup: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
    s.id = x.body.id || (x.body.user && x.body.user.id) || null;
    if (!s.id) { const me = await req(s.who, 'GET', '/api/auth/me'); s.id = me.body && (me.body.id || (me.body.user && me.body.user.id)); }
    return x;
  };
  const saveProfile = async s => {
    const x = await req(s.who, 'PUT', '/api/profile', { profile: profileFor(s) });
    check('profile saved: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 200));
  };
  const enquiryBody = s => ({ name: s.name, phone: s.phone, email: s.email, destination: s.dest, consent: 'yes', message: 'Looking at ' + s.destName + ' for a ' + s.level + ' in ' + s.field + '. CGPA ' + s.cgpa + '.' });
  const leadFiled = async (s, source) => {
    /* The lead as the office sees it — found by email in the book. */
    const book = (await req(A, 'GET', '/api/staff/leads')).body.leads || [];
    const ten = v => String(v || '').replace(/\D/g, '').slice(-10);
    const l = book.find(x => String(x.email || '').toLowerCase() === s.email || (ten(x.phone).length === 10 && ten(x.phone) === ten(s.phone)));
    check('lead filed (' + source + '): ' + s.name, !!l, 'not in /api/staff/leads');
    if (l) {
      s.leadId = l.id; leadsMade.push({ s, id: l.id, source }); s.leadSource = l.source;
      /* Marketing answers as they arrive: the first response, inside the SLA. */
      if (source === 'chat') {
        const x = await req('mkt', 'POST', '/api/staff/chat/' + s.chatId + '/reply', { body: 'Hello ' + s.name.split(' ')[0] + ' — for ' + s.destName + ' most programmes take IELTS 6.5; some accept a Medium of Instruction letter. Shall I call you?' });
        check('chat answered: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
        if (x.ok) followUps++;
      } else {
        const x = await req('mkt', 'POST', '/api/staff/lead/' + l.id + '/note', { kind: 'call', body: 'Called — no answer, left a message.' });
        check('first call logged: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
        if (x.ok) { followUps++; touches++; }
      }
    }
    return l;
  };

  for (const s of S) {
    actors[s.who] = { ip: freshIp(), country: s.residence };
    await visit(s, s.route === 4 ? '?utm_source=' + (s.i % 2 ? 'google' : 'facebook') + '&utm_campaign=nov-' + s.dest.toLowerCase() : '');
    switch (s.route) {
      case 1: {                                 // finder → private university → "Create my login" (Apply free)
        await signup(s); await saveProfile(s);
        const privs = progsFor(s, false, s.i === 0 ? 20 : 2);
        if (!privs.length) { s.noPrivate = true; break; }
        if (s.i === 0) {
          /* The 15-university cap, through the real route. */
          let okN = 0, capped = null;
          const de = (byDest.DE || []).filter(p => !p.isPublic); const unis = new Set();
          for (const p of de) {
            if (unis.has(p.university)) continue; unis.add(p.university);
            const x = await req(s.who, 'POST', '/api/apply', { id: p.id });
            if (x.ok) okN++; else if (x.status === 409 && x.body.atCap) { capped = x; break; } else check('apply (cap test) refused unexpectedly', false, x.status + ' ' + J(x.body));
          }
          check('CAP: 15 private universities go on, the 16th is refused with 409 atCap', okN === 15 && !!capped, okN + ' added, cap=' + (capped && capped.status));
          s.msgsOut += okN;                     // each apply writes a message from the student
        } else {
          for (const p of privs) { const x = await req(s.who, 'POST', '/api/apply', { id: p.id }); check('apply free: ' + s.name + ' → ' + p.university, x.ok && x.body.applied, x.status + ' ' + J(x.body).slice(0, 160)); if (x.ok) s.msgsOut++; }
        }
        break;
      }
      case 2: {                                 // finder → "Just call me" (apply with details, signed out)
        const p = progsFor(s, false, 1)[0] || progsFor(s, true, 1)[0] || cat[0];
        const x = await req(s.who, 'POST', '/api/apply', { id: p.id, name: s.name, email: s.email, phone: s.phone, consent: 'yes', answers: finderAnswers(s), sourcePage: '/' });
        check('just call me: ' + s.name, x.ok && x.body.applied && x.body.signedIn === false, x.status + ' ' + J(x.body).slice(0, 160));
        await leadFiled(s, 'website');
        break;
      }
      case 3: {                                 // finder found nothing → special assistance
        const x = await req(s.who, 'POST', '/api/assist', { name: s.name, email: s.email, phone: s.phone, consent: 'yes', country: s.dest, filters: { country: s.dest, level: s.level, field: s.field, cgpa: s.cgpa }, note: 'Nothing matched my profile' });
        check('no-match assistance: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
        await leadFiled(s, 'no-match');
        break;
      }
      case 4: {                                 // the contact page
        const x = await req(s.who, 'POST', '/api/enquiries', Object.assign(enquiryBody(s), { sourcePage: '/contact-us' }), { headers: { referer: BASE + '/contact-us?utm_source=' + (s.i % 2 ? 'google' : 'facebook') + '&utm_campaign=nov-' + s.dest.toLowerCase() } });
        check('contact form: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
        await leadFiled(s, 'form');
        break;
      }
      case 5: {                                 // a booked counsellor call
        const slot = slots[slotN++ % slots.length];
        const x = await req(s.who, 'POST', '/api/enquiries', Object.assign(enquiryBody(s), { slot, tz: 'Asia/Kolkata', sourcePage: '/' }));
        check('booked call: ' + s.name, x.ok && x.body.booking, x.status + ' ' + J(x.body).slice(0, 160));
        await leadFiled(s, 'booking');
        break;
      }
      case 6: {                                 // the website chat widget
        const x = await req(s.who, 'POST', '/api/chat/start', { name: s.name, contact: s.india ? s.phone : s.email, page: '/study-in-germany' });
        check('chat started: ' + s.name, x.ok && x.body.id, x.status + ' ' + J(x.body).slice(0, 160));
        s.chatId = x.body.id;
        const y = await req(s.who, 'POST', '/api/chat/send', { body: 'Hi, do I need IELTS for ' + s.destName + '? My CGPA is ' + s.cgpa + '.' });
        check('chat message: ' + s.name, y.ok, y.status);
        await leadFiled(s, 'chat');
        break;
      }
      case 7: {                                 // referred by the partner agency
        const x = await req('partner', 'POST', '/api/partner/students', { students: [{ name: s.name, email: s.email, phone: s.india ? s.phone : '', destination: s.destName, level: s.level, field: s.field, cgpa: s.cgpa }] });
        check('partner adds: ' + s.name, x.ok && (x.body.added || []).length === 1, x.status + ' ' + J(x.body).slice(0, 200));
        s.id = x.body.added && x.body.added[0] && x.body.added[0].id;
        s.partner = true;
        const pw = await req(A, 'POST', '/api/staff/people/' + s.id + '/password');
        check('admin resets the partner student’s password so they can sign in', pw.ok && pw.body.password, pw.status);
        const l = await login(s.who, s.email, pw.body.password);
        check('partner student signs in: ' + s.name, l.ok, l.status + ' ' + J(l.body).slice(0, 120));
        const ch = await req(s.who, 'POST', '/api/auth/change', { password: s.pw });
        check('…and chooses a password', ch.ok, ch.status + ' ' + J(ch.body).slice(0, 120));
        await login(s.who, s.email, s.pw);
        await saveProfile(s);
        break;
      }
      case 8: {                                 // guest checkout → "choose a password"
        if (!s.pkg) s.pkg = 'pkg-assist';
        const body = { packageId: s.pkg, name: s.name, email: s.email, phone: s.phone, acceptedTerms: true, currency: s.cur, residence: s.residence, payIn: s.payIn, answers: finderAnswers(s), sourcePage: '/' };
        const x = await req(s.who, 'POST', '/api/orders', body);
        check('guest checkout: ' + s.name, x.ok && x.body.accountCreated && x.body.signedInHere && x.body.reference, x.status + ' ' + J(x.body).slice(0, 200));
        s.id = x.body.studentId; s.guestOrder = x.body;
        const w = await req(s.who, 'PUT', '/api/profile', { profile: { g_field: s.field } });
        check('before a password is chosen the record is read-only (403)', w.status === 403, w.status);
        const ch = await req(s.who, 'POST', '/api/auth/change', { password: s.pw });
        check('…"choose a password": ' + s.name, ch.ok, ch.status + ' ' + J(ch.body).slice(0, 120));
        await login(s.who, s.email, s.pw);
        await saveProfile(s);
        break;
      }
      case 9:                                   // existing account buys from the dashboard
      case 10: {                                // direct signup; buys later, through the office
        await signup(s); await saveProfile(s);
        break;
      }
    }
  }
  check('every door was used', S.every(s => s.id || s.leadId || s.route === 6), S.filter(s => !(s.id || s.leadId)).map(s => s.i).join(','));

  /* A few extra leads that never become students — spam, lost, left waiting. */
  const extraLeads = [];
  for (let k = 0; k < 10; k++) {
    const who = 'xl' + k; actors[who] = { ip: freshIp(), country: 'IN' };
    await req(who, 'GET', '/?utm_source=instagram&utm_campaign=diwali-reels', undefined, { headers: { accept: 'text/html' } });
    const nm = ['Sunil Kumar', 'Preethi Raj', 'Mohammed Irfan', 'Geetha Venkat', 'Abdul Rasheed', 'Kiran Bedi', 'Vinay Kumar', 'Rashmi Shetty', 'Shalini Pillai', 'Ajay Devgan'][k];
    const x = await req(who, 'POST', '/api/enquiries', { name: nm, phone: '9' + String(500000000 + k * 17).slice(-9), email: 'lead' + k + '@glv-sim.in', destination: ['DE', 'GB', 'CA'][k % 3], consent: 'yes', message: k < 3 ? 'buy cheap followers now http://spam.example' : 'Please call me about ' + ['Germany', 'UK', 'Canada'][k % 3] }, { headers: { referer: BASE + '/?utm_source=instagram&utm_campaign=diwali-reels' } });
    check('extra lead ' + k + ' filed', x.ok, x.status);
    extraLeads.push({ who, email: 'lead' + k + '@glv-sim.in', spam: k < 3, lost: k >= 3 && k < 6, waits: k >= 6 });
  }
  {
    const book = (await req(A, 'GET', '/api/staff/leads')).body.leads || [];
    extraLeads.forEach(l => { const row = book.find(x => x.email === l.email); l.id = row && row.id; });
    check('all 10 extra leads are in the book', extraLeads.every(l => l.id));
  }
  const tLeadsIn = Date.now();

  /* ========================================== PHASE 2: marketing works the leads */
  say('phase 2: marketing qualifies, follows up, assigns, converts; a few go cold');
  const cmd0 = (await req('mkt', 'GET', '/api/staff/leads/command')).body;
  check('leads command: the leads nobody has answered are in "Needs a call now" — the ten extras; every student lead was answered on arrival', cmd0.kpis && cmd0.kpis.waiting === extraLeads.length && cmd0.kpis.respondedSample === leadsMade.length, J(cmd0.kpis));
  check('leads command: every source is counted (website, form, no-match, chat, booking)', ['no-match', 'chat'].every(k => (cmd0.sources || []).some(x => x.key === k)) && (cmd0.channels || []).length >= 3, J(cmd0.sources));
  let converted = 0, lostLeads = 0, spamLeads = 0;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const convertLead = async (s, byWho) => {
    const x = await req(byWho, 'POST', '/api/staff/lead/' + s.leadId + '/convert', s.route === 6 && s.india ? { email: s.email } : {});
    check('convert: ' + s.name, x.ok && x.body.student && x.body.student.id, x.status + ' ' + J(x.body).slice(0, 200));
    if (!x.ok) return false;
    converted++;
    s.id = x.body.student.id;
    if (x.body.accountCreated) {
      const l = await login(s.who, s.email, x.body.password);
      check('converted lead signs in with the emailed password: ' + s.name, l.ok, l.status);
      const ch = await req(s.who, 'POST', '/api/auth/change', { password: s.pw });
      check('…and sets their own: ' + s.name, ch.ok, ch.status);
      await login(s.who, s.email, s.pw);
    } else {
      await login(s.who, s.email, s.pw);
    }
    await saveProfile(s);
    return true;
  };
  /* Every student lead: qualified (a call logged), a WhatsApp and an email
     follow-up on most, handed to the planned counsellor by the admin (a
     counsellor-level marketing account cannot hand a lead on), converted. */
  for (const { s, source } of leadsMade) {
    if (source === 'chat') {
      const y = await req(s.who, 'POST', '/api/chat/send', { body: 'Yes please, this afternoon works.' });
      check('visitor replies in the chat', y.ok, y.status);
      const z = await req('mkt', 'POST', '/api/staff/chat/' + s.chatId + '/close', {});
      check('chat closed', z.ok && z.body.status === 'done', J(z.body));
    }
    const kinds = ['whatsapp', 'email', 'call'];
    const n = s.i % 3;
    for (let k = 0; k < n; k++) {
      const x = await req('mkt', 'POST', '/api/staff/lead/' + s.leadId + '/note', { kind: kinds[k], body: kinds[k] === 'call' ? 'Called back; discussed budget and intake.' : kinds[k] === 'whatsapp' ? 'Sent the programme list on WhatsApp.' : 'Emailed the document checklist.', nextAt: k === n - 1 ? tomorrow : undefined });
      check('follow-up ' + kinds[k] + ' logged: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
      if (x.ok) { followUps++; touches++; }
    }
    if (s.i % 4 === 0) {
      const q = await req('mkt', 'PUT', '/api/staff/lead/' + s.leadId, { status: 'following', destination: s.dest });
      check('qualified → following: ' + s.name, q.ok, q.status + ' ' + J(q.body).slice(0, 120));
    }
    const handOff = await req('mkt', 'PUT', '/api/staff/lead/' + s.leadId, { ownerId: C[s.counsellor].id });
    if (handOff.status === 403 && !bugs.some(b => /hand a lead/.test(b.what))) bug('HIGH', 'Marketing (a counsellor-level account) cannot assign a lead to a counsellor: PUT /api/staff/lead/:id {ownerId} is "Only an administrator can hand a lead to somebody else" (403). Lead assignment is admin-only.', 'server/api.js PUT /api/staff/lead/:id');
    const a = await req(A, 'PUT', '/api/staff/lead/' + s.leadId, { ownerId: C[s.counsellor].id });
    check('admin assigns the lead to ' + C[s.counsellor].name + ': ' + s.name, a.ok && a.body.lead && Number(a.body.lead.ownerId) === C[s.counsellor].id, a.status + ' ' + J(a.body.lead || a.body).slice(0, 160));
    /* The counsellor who owns it converts it (or the admin). */
    await convertLead(s, s.i % 2 ? C[s.counsellor].who : A);
    if (source === 'booking') {
      const calls = (await req(A, 'GET', '/api/staff/calls')).body.calls || [];
      const call = calls.find(c => c.email === s.email);
      check('the booked call is on the calls list: ' + s.name, !!call, calls.length);
      if (call) { const d = await req(A, 'PUT', '/api/staff/calls/' + call.id, { status: 'done', note: 'Spoke for 25 minutes' }); check('…and is marked done', d.ok, d.status + ' ' + J(d.body).slice(0, 120)); }
    }
  }
  /* The extras: three spam (archived), three lost with a reason, four left waiting. */
  for (const l of extraLeads.filter(x => x.spam)) {
    const n = await req('mkt', 'POST', '/api/staff/lead/' + l.id + '/note', { kind: 'note', body: 'Spam — link farm.' }); followUps += n.ok ? 1 : 0;
    const x = await req('mkt', 'PUT', '/api/staff/lead/' + l.id, { status: 'lost', lostReason: 'other', note: 'spam' });
    check('spam lead marked lost/other', x.ok, x.status + ' ' + J(x.body).slice(0, 120));
    const y = await req(A, 'POST', '/api/staff/lead/' + l.id + '/archive', {});
    check('…and archived by the admin', y.ok, y.status);
    if (x.ok) { lostLeads++; spamLeads++; }
  }
  for (const l of extraLeads.filter(x => x.lost)) {
    const n = await req('mkt', 'POST', '/api/staff/lead/' + l.id + '/note', { kind: 'call', body: 'Called; going with a local agent.' }); if (n.ok) { followUps++; touches++; }
    const x = await req('mkt', 'PUT', '/api/staff/lead/' + l.id, { status: 'lost', lostReason: 'went-elsewhere' });
    check('lost lead recorded with a reason', x.ok && x.body.lead.status === 'lost', x.status);
    if (x.ok) lostLeads++;
  }
  const tHandled = Date.now();

  /* ============================================ PHASE 3: students buy */
  say('phase 3: packages and services — Razorpay, Stripe, the office; in full and in parts');
  const payConfig = CFG;
  let rzpPaid = 0, stripePaid = 0, officePaid = 0, partsOrders = 0, freeOrders = 0, quoteOrders = 0;
  const settle = async (s, o, how) => {
    /* o: the order response. how: 'gateway' | 'office' */
    const ref = o.reference;
    if (how === 'gateway' && o.razorpay) {
      const x = await rzpWebhook(ref, o.razorpay.orderId);
      check('Razorpay webhook settles ' + ref + ' (' + s.name + ')', x.ok, x.status + ' ' + J(x.body));
      if (x.ok) rzpPaid++;
    } else if (how === 'gateway' && o.stripe) {
      const x = await stripeWebhook(o.stripe.sessionId);
      check('Stripe webhook settles ' + ref + ' (' + s.name + ', ' + o.stripe.currency + ')', x.ok, x.status + ' ' + J(x.body));
      if (x.ok) stripePaid++;
    } else {
      const amount = (o.plan ? o.plan[0].paise : o.grossPaise) / 100;
      const x = await req(A, 'POST', '/api/staff/order/' + ref + '/payment', { amount, method: s.india ? 'upi' : 'bank', reference: 'UTR' + s.i, note: 'collected over the phone' });
      check('office records payment on ' + ref + ' (' + s.name + ')', x.ok, x.status + ' ' + J(x.body).slice(0, 160));
      if (x.ok) officePaid++;
    }
    /* The rest of a schedule: collected by the office, part by part. */
    if (o.plan) {
      partsOrders++;
      for (let n = 2; n <= o.plan.length; n++) {
        const asC = await req(C[s.counsellor].who, 'POST', '/api/staff/order/' + ref + '/part/' + n + '/paid', { method: 'bank', reference: 'UTR' + s.i + '-' + n });
        if (asC.status === 403 && !bugs.some(b => /record money/.test(b.what))) bug('LOW', 'A counsellor cannot record an instalment through POST /api/staff/order/:ref/part/:n/paid ("Only an administrator can record money", 403) although the older POST /api/staff/order/:ref/part lets the student’s own counsellor collect it. Two routes, two rules.', 'server/api.js orderForStaff');
        const x = asC.ok ? asC : await req(A, 'POST', '/api/staff/order/' + ref + '/part/' + n + '/paid', { method: 'bank', reference: 'UTR' + s.i + '-' + n });
        check('part ' + n + ' of ' + o.plan.length + ' collected on ' + ref, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
      }
      const over = await req(A, 'POST', '/api/staff/order/' + ref + '/part', {});
      check('a part cannot be collected once all are paid (409) on ' + ref, over.status === 409, over.status);
    }
    const row = (await req(A, 'GET', '/api/staff/order/' + ref)).body.order || {};
    check(ref + ' reads paid with nothing outstanding', row.status === 'paid' && Number(row.outstandingPaise || 0) === 0, J({ status: row.status, out: row.outstandingPaise, paid: row.paidPaise }));
    s.paidPaise += Number(row.paidPaise || row.receivedPaise || o.grossPaise || 0);
    s.grossPaise += Number(o.grossPaise || 0);
    s.orders.push({ ref, gross: o.grossPaise, kind: o.package, tax: o.exportSale ? (o.vatRate ? 'vat' : 'export') : 'gst' });
  };
  const buy = async (s, body) => {
    const b = Object.assign({ acceptedTerms: true, currency: s.cur, residence: s.residence, sourcePage: '/dashboard' }, body);
    const x = await req(s.who, 'POST', '/api/orders', b);
    check('order placed: ' + s.name + ' — ' + (b.packageId || J(b.services)), x.ok && x.body.reference, x.status + ' ' + J(x.body).slice(0, 200));
    if (!x.ok) return null;
    const o = x.body;
    /* Tax: GST in India (whatever the currency), none abroad, VAT in the EU. */
    const eu = (payConfig.euVat.countries || []).includes(s.residence);
    if (o.grossPaise > 0) {
      if (s.india) check('GST on an Indian order ' + o.reference, o.exportSale === false && o.taxPaise > 0, J({ exportSale: o.exportSale, tax: o.taxPaise }));
      else if (eu) check('VAT @19 on an EU order ' + o.reference, o.exportSale === true && o.vatRate === 19 && o.taxPaise > 0, J({ exportSale: o.exportSale, vat: o.vatRate, tax: o.taxPaise }));
      else check('no GST on an export order ' + o.reference + ' (' + s.residence + ')', o.exportSale === true && o.taxPaise === 0, J({ exportSale: o.exportSale, tax: o.taxPaise }));
      if (s.india) check('India → Razorpay, not Stripe: ' + o.reference, !!o.razorpay && !o.stripe, J({ r: !!o.razorpay, s: !!o.stripe }));
      else check('abroad → Stripe in ' + s.cur + ': ' + o.reference, !!o.stripe && !o.razorpay && o.stripe.currency === s.cur, J({ r: !!o.razorpay, s: o.stripe && o.stripe.currency }));
    }
    return o;
  };
  for (const s of S) {
    if (!s.id) continue;
    let o = null;
    if (s.route === 8) {
      o = s.guestOrder;
    } else if (s.route === 10 && s.pkg) {
      const x = await req(A, 'POST', '/api/staff/student/' + s.id + '/order', { packageId: s.pkg, payIn: s.payIn, note: 'agreed on the phone' });
      check('office creates the order for ' + s.name, x.ok && x.body.order, x.status + ' ' + J(x.body).slice(0, 160));
      o = x.ok ? Object.assign({}, x.body.order, { grossPaise: x.body.order.grossPaise || x.body.order.gross, plan: x.body.order.plan && x.body.order.plan.length ? x.body.order.plan : null, exportSale: !!x.body.exportSale, vatRate: x.body.vatRate || 0 }) : null;
      if (o) {
        s.payVia = 'office';
        const eu = (payConfig.euVat.countries || []).includes(s.residence);
        check('an office-raised order follows where the student lives (' + s.residence + '): ' + s.name, s.india ? !o.exportSale : eu ? (o.exportSale && o.vatRate === 19) : (o.exportSale && !o.vatRate), J({ exportSale: o.exportSale, vat: o.vatRate, taxMode: x.body.order.taxMode }));
      }
    } else if (s.pkg) {
      o = await buy(s, { packageId: s.pkg, payIn: s.payIn, answers: finderAnswers(s) });
    }
    if (o) await settle(s, o, s.payVia === 'gateway' && (o.razorpay || o.stripe) ? 'gateway' : 'office');
    /* Services: free, paid, levelled, on request. */
    for (const svc of s.services) {
      if (svc === 'insure') {
        const bad = await req(s.who, 'POST', '/api/orders', { services: [{ id: 'insure' }], acceptedTerms: true, currency: s.cur, residence: s.residence });
        check('an on-request service cannot be ordered at ₹0 (422): ' + s.name, bad.status === 422, bad.status + ' ' + J(bad.body).slice(0, 120));
        const q = await req(A, 'POST', '/api/staff/student/' + s.id + '/order', { services: [{ id: 'insure', priceInr: 8000 }], note: 'quoted after the call' });
        check('office raises the quoted order for insurance: ' + s.name, q.ok && q.body.order && q.body.order.grossPaise === ((payConfig.euVat.countries || []).includes(s.residence) ? 952000 : 800000), q.status + ' ' + J(q.body).slice(0, 160));
        if (q.ok) {
          quoteOrders++;
          check('the quote follows where the student lives (' + s.residence + '): ' + s.name, s.india ? !q.body.exportSale : !!q.body.exportSale, J({ exportSale: q.body.exportSale, taxMode: q.body.order.taxMode }));
          await settle(s, Object.assign({}, q.body.order, { plan: null, exportSale: !!q.body.exportSale, vatRate: q.body.vatRate || 0 }), 'office');
        }
        continue;
      }
      const so = await buy(s, { services: [svc === 'german' ? { id: 'german', level: 'A1' } : { id: svc }] });
      if (!so) continue;
      if (svc === 'counsel') { check('a free service is settled on the spot: ' + s.name, so.grossPaise === 0 && so.status !== 'awaiting', J({ g: so.grossPaise, st: so.status })); freeOrders++; s.orders.push({ ref: so.reference, gross: 0, kind: 'free' }); continue; }
      if (svc === 'german') check('German A1 is ₹15,000' + ((payConfig.euVat.countries || []).includes(s.residence) ? ' + 19% VAT (EU buyer)' : '') + ': ' + s.name, so.grossPaise === ((payConfig.euVat.countries || []).includes(s.residence) ? 1785000 : 1500000), so.grossPaise);
      await settle(s, so, s.i % 2 ? 'gateway' : 'office');
    }
  }
  /* An Indian paying in dollars from India is still an Indian sale. */
  {
    const s = S[1];
    const x = await req(s.who, 'POST', '/api/orders', { services: [{ id: 'cv' }], acceptedTerms: true, currency: 'USD', residence: 'IN' });
    check('India paying in USD → Razorpay, GST included', x.ok && x.body.razorpay && !x.body.stripe && x.body.exportSale === false, x.status + ' ' + J(x.body).slice(0, 160));
    if (x.ok) await settle(s, x.body, 'gateway');
  }
  /* Receipts: what the student's own screen will print, for every paid order. */
  let receipts = 0, receiptBad = [];
  for (const s of S.filter(x => x.id && x.orders.length)) {
    const st = (await req(s.who, 'GET', '/api/state')).body;
    const mine = (st.orders || []);
    const head = st.order || {};
    for (const o of s.orders) {
      const row = mine.find(x => x.reference === o.ref);
      if (!row) { receiptBad.push(o.ref + ' missing on ' + s.name + "'s dashboard"); continue; }
      const paid = /^(paid|part)$/.test(row.status) && !!row.paidAt;
      if (o.gross > 0 && !paid) { receiptBad.push(o.ref + ' ' + J({ status: row.status, paidAt: row.paidAt })); continue; }
      if (head.reference === o.ref) {
        /* The receipt card is drawn for the headline order: its tax line must match where the buyer lives. */
        const taxOk = o.kind === 'free' ? true : o.tax === 'gst' ? !head.taxMode : o.tax === 'vat' ? /^eu-vat-/.test(head.taxMode || '') : head.taxMode === 'export';
        if (!taxOk) { receiptBad.push(o.ref + ' ' + J({ taxMode: head.taxMode, want: o.tax })); continue; }
        receipts++;
      } else if (o.gross > 0) {
        s.noReceipt = (s.noReceipt || 0) + 1;
      }
    }
  }
  check('every headline order has a receipt the dashboard can print, with the right tax line (' + receipts + ')', !receiptBad.length, receiptBad.slice(0, 5).join(' | '));
  const noReceipt = S.reduce((n, s) => n + (s.noReceipt || 0), 0);
  if (noReceipt) bug('MEDIUM', noReceipt + ' paid add-on orders (SOP, German A1, CV, the quoted insurance) have no receipt on the student’s dashboard: the receipt card and its "Download receipt (PDF)" are drawn for the headline package only (stateFor → order), and the orders list carries no taxMode/charged for a per-order receipt.', 'dashboard.html #receipt / server/api.js stateFor orders[]');

  /* ======================================= PHASE 4: counselling */
  say('phase 4: assignment, scope, messages, shortlists');
  for (const s of S.filter(x => x.id)) {
    const x = await req(A, 'PUT', '/api/staff/student/' + s.id + '/counsellor', { counsellorId: C[s.counsellor].id });
    check('assigned to ' + C[s.counsellor].name + ': ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
  }
  /* Reassign a few, then put them back where the plan says. */
  for (const s of S.filter(x => x.id && x.i % 25 === 5)) {
    const other = C[(s.counsellor + 1) % 5];
    let x = await req(A, 'PUT', '/api/staff/student/' + s.id + '/counsellor', { counsellorId: other.id });
    check('reassigned to ' + other.name + ': ' + s.name, x.ok, x.status);
    x = await req(C[s.counsellor].who, 'GET', '/api/staff/student/' + s.id);
    check('…and the old counsellor can no longer open the file (403)', x.status === 403 || (s.dest === 'GB' && s.counsellor === 4), x.status);
    x = await req(A, 'PUT', '/api/staff/student/' + s.id + '/counsellor', { counsellorId: C[s.counsellor].id });
  }
  {
    /* Scope: the UK country admin sees every UK file and no German one;
       a counsellor limited to countries sees only their own students. */
    const gb = S.find(x => x.id && x.dest === 'GB' && x.counsellor !== 4);
    const de = S.find(x => x.id && x.dest === 'DE' && x.counsellor !== 4);
    if (gb) check('SCOPE: the UK country admin opens a UK student held by somebody else', (await req(C[4].who, 'GET', '/api/staff/student/' + gb.id)).status === 200);
    if (de) check('SCOPE: …and is refused a German one (403)', (await req(C[4].who, 'GET', '/api/staff/student/' + de.id)).status === 403);
    const de2 = S.find(x => x.id && x.dest === 'DE' && x.counsellor !== 3);
    if (de2) check('SCOPE: a counsellor limited to DE/FR/IT still cannot open a German student who is not theirs (403)', (await req(C[3].who, 'GET', '/api/staff/student/' + de2.id)).status === 403);
    const list = (await req(C[4].who, 'GET', '/api/staff/students')).body.students || [];
    check('SCOPE: the UK country admin’s roster is their own students plus every UK file', list.length > 0 && list.every(r => (r.counsellor && r.counsellor.id === C[4].id) || true), list.length);
    const notTheirs = list.filter(r => !(r.counsellor && r.counsellor.id === C[4].id));
    check('SCOPE: …and the files on it that are not theirs are all UK files', notTheirs.length > 0 && notTheirs.every(r => S.find(s => s.id === r.id) && S.find(s => s.id === r.id).dest === 'GB'), notTheirs.map(r => (S.find(s => s.id === r.id) || {}).dest).join(','));
  }
  /* Messages, both directions, with the counts the dashboards will have to show. */
  const stuMsg = async (s, body) => { const x = await req(s.who, 'POST', '/api/messages', { body }); if (x.ok) { s.msgsOut++; s.lastFromStudent = true; } return x; };
  const cMsg = async (s, body) => { const x = await req(C[s.counsellor].who, 'POST', '/api/staff/student/' + s.id + '/message', { body }); if (x.ok) { s.msgsIn++; s.lastFromStudent = false; } return x; };
  let attachments = 0;
  for (const s of S.filter(x => x.id)) {
    const c = C[s.counsellor];
    if (s.i % 2 === 0) {
      await stuMsg(s, 'Hello, I have paid. What should I upload first?');
      await req(s.who, 'POST', '/api/typing', {});
      const x = await cMsg(s, 'Welcome ' + s.name.split(' ')[0] + '! Start with your passport and marksheets on the Documents screen. I am ' + c.name + ', your counsellor.');
      check('counsellor replies: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
    } else {
      const x = await cMsg(s, 'Hi ' + s.name.split(' ')[0] + ', I am ' + c.name + ' and I will be looking after your file. When can we talk?');
      check('counsellor opens the conversation: ' + s.name, x.ok, x.status);
      await stuMsg(s, 'Thanks! Tomorrow evening is good.');
    }
    /* The welcome call happened; the file is open. */
    {
      const t = (((await req(c.who, 'GET', '/api/staff/student/' + s.id)).body.tasks) || []).find(x => /^Welcome call/.test(x.title));
      if (t && t.status !== 'done') { const w = await req(c.who, 'PUT', '/api/staff/task/' + t.id, { status: 'done' }); check('welcome call ticked: ' + s.name, w.ok, w.status + ' ' + J(w.body).slice(0, 120)); }
    }
    if (s.i % 6 === 0) {
      const x = await req(s.who, 'POST', '/api/messages/attach', undefined, { form: fileForm('file', pdf('cv ' + s.i), 'my-cv.pdf', 'application/pdf', { body: 'My CV for a first look' }) });
      check('student attaches a file: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
      if (x.ok) { attachments++; s.msgsOut++; s.lastFromStudent = true; s.attached = true; }
      const y = await req(c.who, 'POST', '/api/staff/student/' + s.id + '/attach', undefined, { form: fileForm('file', pdf('checklist'), 'document-checklist.pdf', 'application/pdf', { body: 'The checklist we discussed' }) });
      check('counsellor sends a file back: ' + s.name, y.ok, y.status);
      if (y.ok) { attachments++; s.msgsIn++; s.lastFromStudent = false; }
    }
  }
  /* Unread counts and read states. */
  {
    const s = S.find(x => x.id && x.i % 2 === 1 && x.route !== 1);
    await stuMsg(s, 'One more thing — do I need the APS certificate before applying?');
    const before = (await req(C[s.counsellor].who, 'GET', '/api/staff/students')).body.students.find(r => r.id === s.id);
    check('UNREAD: the roster shows the student’s unanswered message as unread', before && before.unread >= 1, J(before && before.unread));
    await req(C[s.counsellor].who, 'GET', '/api/staff/student/' + s.id);     // opening the file reads it
    const after = (await req(C[s.counsellor].who, 'GET', '/api/staff/students')).body.students.find(r => r.id === s.id);
    check('UNREAD: …and opening the file clears it', after && after.unread === 0, J(after && after.unread));
    const st0 = (await req(s.who, 'GET', '/api/state')).body;
    check('UNREAD: the student sees the counsellor’s message as unread', st0.unread >= 1, st0.unread);
    await req(s.who, 'POST', '/api/messages/read', {});
    const st1 = (await req(s.who, 'GET', '/api/state')).body;
    check('UNREAD: …until they read the thread', st1.unread === 0, st1.unread);
  }
  /* Shortlists: public (DE) and private; a swap; the student asks for a replacement. */
  for (const s of S.filter(x => x.id && x.dest !== 'NZ')) {
    const c = C[s.counsellor];
    const pubs = s.dest === 'DE' ? progsFor(s, true, 2) : [];
    const privs = progsFor(s, false, s.dest === 'DE' ? 1 : 2);
    for (const p of pubs.concat(privs)) {
      const x = await req(c.who, 'POST', '/api/staff/student/' + s.id + '/shortlist', { id: p.id, force: true });
      check('counsellor adds ' + (p.isPublic ? 'public' : 'private') + ' ' + p.university + ' for ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
    }
    if (s.i % 5 === 2 && privs[0]) {
      const ask = await stuMsg(s, 'Could you swap ' + privs[0].university + ' for something cheaper?');
      check('student asks for a replacement: ' + s.name, ask.ok, ask.status);
      const x = await req(c.who, 'DELETE', '/api/staff/student/' + s.id + '/shortlist/' + encodeURIComponent(privs[0].id));
      check('counsellor takes it off: ' + s.name, x.ok, x.status);
      const alt = ((byDest[s.dest] || []).filter(p => !p.isPublic && p.university !== privs[0].university && !privs.some(q => q.university === p.university)))[0];
      if (alt) { const y = await req(c.who, 'POST', '/api/staff/student/' + s.id + '/shortlist', { id: alt.id, force: true }); check('…and adds a replacement: ' + s.name, y.ok, y.status); }
      await cMsg(s, 'Done — swapped as you asked. Have a look at your list.');
    }
    const fit = await req(c.who, 'GET', '/api/staff/student/' + s.id + '/fit');
    check('counsellor runs the matcher (fit) for ' + s.name, fit.ok, fit.status);
    const file = (await req(c.who, 'GET', '/api/staff/student/' + s.id)).body;
    check('the counsellor sees the finder answers on the file: ' + s.name, file.profile && String(file.profile.g_country || '') === s.destName && String(file.profile.d_cgpa) === String(s.cgpa), J(file.profile && { c: file.profile.g_country, g: file.profile.d_cgpa }));
    s.list = (file.shortlist || []).map(r => r.id || r.prog_id || r.progId);
    check('the list is not empty: ' + s.name, s.list.length > 0, J(file.shortlist && file.shortlist[0]));
  }
  /* The counsellor corrects what the call settled — a CGPA typed wrong, a test score that came by WhatsApp. */
  for (const s of S.filter(x => x.id && x.i % 9 === 4)) {
    const c = C[s.counsellor];
    const fixed = String(Math.min(9.9, s.cgpa + 0.1).toFixed(1));
    const x = await req(c.who, 'PUT', '/api/staff/student/' + s.id + '/profile', { profile: { d_cgpa: fixed, e_score: s.eng === 'moi' ? '' : s.engScore } });
    check('counsellor corrects the CGPA on the file: ' + s.name, x.ok && (x.body.changed || []).includes('d_cgpa'), x.status + ' ' + J(x.body).slice(0, 160));
    const st = (await req(s.who, 'GET', '/api/state')).body;
    check('…and the student sees the corrected CGPA: ' + s.name, st.profile && st.profile.d_cgpa === fixed, J(st.profile && st.profile.d_cgpa));
    const other = C[(s.counsellor + 1) % 5];
    const no = await req(other.who, 'PUT', '/api/staff/student/' + s.id + '/profile', { profile: { d_cgpa: '9.9' } });
    check('…another counsellor cannot (403): ' + s.name, no.status === 403 || (s.dest === 'GB' && (s.counsellor + 1) % 5 === 4), no.status);
    s.cgpa = Number(fixed);
  }
  bug('MEDIUM', 'The counsellor screen (/counsellor) has no control to edit a student’s profile fields; the route PUT /api/staff/student/:id/profile was added in this run (commit "FIX: a counsellor can correct a student’s profile"), the screen still needs the form.', 'counsellor.html');

  /* ========================================= PHASE 5: documents */
  say('phase 5: documents — uploads, wrong types, re-uploads, verdicts, the agency');
  const REQUIRED = ['passport', 'x', 'xii', 'degree', 'consol', 'english', 'cv', 'sop', 'lor', 'finance'];
  const VISA_REQ = ['visa-offer', 'visa-funds', 'visa-insurance', 'visa-form', 'visa-cover', 'visa-appointment'];
  const upload = async (s, key, bytes, name, type, fields) => {
    const x = await req(s.who, 'POST', '/api/documents', undefined, { form: fileForm('file', bytes, name, type, Object.assign({ key }, fields || {})) });
    if (x.ok) s.docs++;
    return x;
  };
  const staffDoc = async (s, key, status, note) => req(C[s.counsellor].who, 'POST', '/api/staff/student/' + s.id + '/document/' + key, { status, note });
  let rescans = 0, badUploads = 0;
  const closers = S.filter(x => x.id && x.fate !== 'left');
  for (const s of S.filter(x => x.id)) {
    const c = C[s.counsellor];
    /* The student uploads: PDFs and photos; a wrong type is refused. */
    if (s.i % 9 === 0) {
      const w = await upload(s, 'passport', Buffer.from('<html>not a passport</html>'), 'passport.html', 'text/html');
      check('a .html "passport" is refused: ' + s.name, w.status === 415 || w.status === 422, w.status + ' ' + J(w.body).slice(0, 120));
      const w2 = await upload(s, 'xii', Buffer.from('plain text marksheet'), 'marks.txt', 'text/plain');
      check('a .txt marksheet is refused: ' + s.name, w2.status === 415 || w2.status === 422, w2.status);
      if (w.status >= 400) badUploads++; if (w2.status >= 400) badUploads++;
    }
    if (s.fate === 'left' && s.i % 2) continue;          // some who leave never uploaded anything
    const set = s.fate === 'left' ? REQUIRED.slice(0, 3) : REQUIRED.filter(k => k !== 'sop' && k !== 'lor');
    for (const key of set) {
      const photo = key === 'passport' && s.i % 4 === 0;
      const x = await upload(s, key, photo ? jpg() : pdf(key + ' ' + s.i), key + (photo ? '.jpg' : '.pdf'), photo ? 'image/jpeg' : 'application/pdf');
      if (!x.ok) check('upload ' + key + ': ' + s.name, false, x.status + ' ' + J(x.body).slice(0, 160));
    }
    if (s.fate === 'left') continue;
    /* The counsellor: one goes back for a rescan with a note (email + message), the student re-uploads, it is accepted. */
    if (s.i % 3 === 0) {
      const x = await staffDoc(s, 'passport', 'rescan', 'The photo page is cut off at the bottom — please scan the whole page.');
      check('rescan asked: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
      if (x.ok) rescans++;
      const file = (await req(c.who, 'GET', '/api/staff/student/' + s.id)).body;
      const slot = ((file.readiness || {}).docs || []).find(d => d.key === 'passport') || {};
      check('…the slot reads "rescan": ' + s.name, slot.status === 'rescan', J(slot));
      const re = await upload(s, 'passport', pdf('passport rescan ' + s.i, 2500), 'passport-full.pdf', 'application/pdf', { replace: 'yes' });
      check('student re-uploads the passport: ' + s.name, re.ok, re.status);
      const slot2 = (((await req(c.who, 'GET', '/api/staff/student/' + s.id)).body.readiness || {}).docs || []).find(d => d.key === 'passport') || {};
      check('…and the slot is back "in review" (wait): ' + s.name, slot2.status === 'wait', J(slot2));
    }
    /* Verdicts, per file: accept the newest file in each slot. */
    const docs = (await req(c.who, 'GET', '/api/staff/student/' + s.id + '/documents')).body.docs || [];
    for (const key of REQUIRED.filter(k => k !== 'sop' && k !== 'lor')) {
      const files = docs.filter(x => x.key === key && x.status !== 'bad');
      const newest = files[files.length - 1];
      let x;
      if (newest && newest.id && s.i % 2) x = await req(c.who, 'POST', '/api/staff/student/' + s.id + '/document/' + key + '/file/' + newest.id + '/verdict', { status: 'ok' });
      else x = await staffDoc(s, key, 'ok');
      if (!x.ok) check('accept ' + key + ': ' + s.name, false, x.status + ' ' + J(x.body).slice(0, 160));
    }
    const R = (await req(c.who, 'GET', '/api/staff/student/' + s.id)).body.readiness || {};
    check('8 of 10 required verified before the SOP and LORs: ' + s.name, R.ok === 8 && R.of === 10, J({ ok: R.ok, of: R.of }));
    /* The replaced file keeps its history: the first passport reads 'replaced' when a second was accepted. */
    if (s.i % 3 === 0) {
      const states = ((await req(c.who, 'GET', '/api/staff/student/' + s.id + '/documents')).body.docs || []).filter(x => x.key === 'passport').map(f => f.status);
      check('the passport slot keeps one verified copy: ' + s.name, states.filter(x => x === 'ok').length === 1, J(states));
    }
  }
  /* The agency uploads for its students — "From the agency". */
  for (const s of S.filter(x => x.id && x.partner && x.fate !== 'left')) {
    const x = await req('partner', 'POST', '/api/partner/student/' + s.id + '/document', undefined, { form: fileForm('file', pdf('agency work ' + s.i), 'work-letter.pdf', 'application/pdf', { key: 'work' }) });
    check('partner uploads a work letter for ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
    if (x.ok) s.docs++;
    const dw = ((await req(C[s.counsellor].who, 'GET', '/api/staff/student/' + s.id + '/documents')).body.docs || []).filter(y => y.key === 'work');
    check('…which the counsellor sees as from the agency: ' + s.name, dw.some(f => /agency|partner/i.test(f.by || f.from || f.who || JSON.stringify(f))), J(dw[0]).slice(0, 200));
  }
  /* The office's command centre now has documents to check? No — they were accepted. A few are left waiting on purpose. */
  const waitingDocs = S.filter(x => x.id && x.fate === 'won' && x.i % 10 === 4).slice(0, 6);
  for (const s of waitingDocs) { await upload(s, 'other', pdf('extra ' + s.i), 'extra-certificate.pdf', 'application/pdf'); }

  /* ---------------------------------- the board while everybody is mid-journey */
  const errs = [];
  let browser = null;
  const ctxFor = async (who, tz) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: tz || 'Asia/Kolkata' });
    await ctx.addCookies(Object.entries(jars[who] || {}).map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(who + ': ' + e.message));
    return { ctx, pg };
  };
  const shot = async (pg, name) => { try { await pg.screenshot({ path: path.join(SHOTS, 'e2e-' + name + '.png'), fullPage: true }); } catch (e) { errs.push('shot ' + name + ': ' + e.message); } };
  try {
    browser = await require('playwright').chromium.launch();
    const cmdJ = (await req(A, 'GET', '/api/staff/command')).body;
    const openNow = S.filter(x => x.id && !x.closed).length;
    const stops = (cmdJ.journey || []).map(p => p.key + ':' + p.students).join(' ');
    check('/ops journey (mid-run): the stops add up to the open files (' + stops + ')', (cmdJ.journey || []).reduce((n, p) => n + p.students, 0) === openNow, stops + ' vs ' + openNow);
    check('/ops journey (mid-run): files sit at Profile and later, nobody departed yet', !(cmdJ.journey || []).some(p => p.key === 'departed' && p.students > 0) && (cmdJ.journey || []).some(p => p.key === 'profile' && p.students > 0), stops);
    const { ctx, pg } = await ctxFor(A);
    await pg.goto(BASE + '/ops', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(3500);
    await shot(pg, 'ops-journey-midrun');
    await ctx.close();
  } catch (e) { check('mid-journey board', false, e.message); }

  /* ====================================== PHASE 6: the journey, stage by stage */
  say('phase 6: shortlist confirmed → documents assembled → filed → offers → visa → closed');
  const tasksOf = async s => ((await req(A, 'GET', '/api/staff/student/' + s.id)).body.tasks || []);
  const tick = async (s, re, who) => {
    const t = (await tasksOf(s)).find(x => re.test(x.title));
    if (!t) return { status: 0, body: { error: 'no such task' } };
    return req(who || C[s.counsellor].who, 'PUT', '/api/staff/task/' + t.id, { status: 'done' });
  };
  const staffUpload = async (s, key, name) => req(C[s.counsellor].who, 'POST', '/api/staff/student/' + s.id + '/document/' + key + '/file', undefined, { form: fileForm('file', pdf(key + ' ' + s.i), name || (key + '.pdf'), 'application/pdf') });
  const app = (s, progId, body, who) => req(who || C[s.counsellor].who, 'PUT', '/api/staff/student/' + s.id + '/application/' + encodeURIComponent(progId), body);
  let locks = 0, lockFails = 0;
  const expectLock = async (s, re, label) => {
    const x = await tick(s, re);
    if (x.status === 409 && x.body.locked) locks++; else { lockFails++; check('LOCK: ' + label + ' refused with 409 for ' + s.name, false, x.status + ' ' + J(x.body).slice(0, 160)); }
  };
  /* An SLA changed mid-run: the welcome call gets one day, the profile five. */
  {
    const rules = (await req(A, 'GET', '/api/staff/task-rules')).body;
    const asked = {}; (rules.rules || []).forEach(t => { asked[t.key] = t.due.sla != null ? { sla: t.due.sla } : { before: t.due.before }; });
    asked.welcome = { sla: 1 }; asked.profile = { sla: 5 };
    const x = await req(A, 'PUT', '/api/staff/task-rules', { rules: asked, stepHours: rules.stepHours || 24 });
    check('admin changes two SLAs mid-run (welcome 1 day, profile 5 days)', x.ok && (x.body.rules || []).find(t => t.key === 'welcome').due.sla === 1, x.status + ' ' + J(x.body).slice(0, 160));
  }
  const won = S.filter(x => x.id && x.fate === 'won' && x.dest !== 'NZ');
  const lost = S.filter(x => x.id && x.fate === 'lost' && x.dest !== 'NZ');
  const nz = S.filter(x => x.id && x.dest === 'NZ');
  let offers = 0, rejections = 0, waitlists = 0, filed = 0, conflicts = 0;
  for (const s of won.concat(lost)) {
    const c = C[s.counsellor];
    /* Locks first: nothing is done yet beyond the welcome call. */
    if (s.i % 10 === 0) {
      await expectLock(s, /^Profile completed/, '"Profile completed" at 8 of 10');
      await expectLock(s, /^Application documents/, '"Application documents assembled" with SOP/LOR missing');
      await expectLock(s, /^Offer letter/, '"Offer letter received" with no offer');
      await expectLock(s, /^Visa application filed/, '"Visa application filed" with the visa file empty');
    }
    let x = await tick(s, /^Welcome call/);
    check('welcome call ticked: ' + s.name, x.ok || x.status === 0, x.status + ' ' + J(x.body).slice(0, 120));
    x = await tick(s, /^Shortlist confirmed/);
    check('STAGE shortlist confirmed: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
    /* The office's own SOP and LOR land verified; the file is now 10 of 10. */
    x = await staffUpload(s, 'sop', 'sop-final.pdf'); check('SOP delivered: ' + s.name, x.ok && x.body.status === 'ok', x.status + ' ' + J(x.body).slice(0, 120));
    x = await staffUpload(s, 'lor', 'lor-signed.pdf'); check('LOR delivered: ' + s.name, x.ok && x.body.status === 'ok', x.status);
    x = await tick(s, /^Profile completed/);
    check('STAGE profile and documents complete (10 of 10): ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
    x = await tick(s, /^Application documents/);
    check('STAGE application documents assembled: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
    /* Applications filed, per university. */
    const list = s.list || [];
    for (const pid of list) {
      const f = await app(s, pid, { stage: 2, note: 'Filed; reference ' + s.i + '-' + pid.slice(-4) });
      if (f.ok) filed++; else check('filed: ' + s.name + ' ' + pid, false, f.status + ' ' + J(f.body).slice(0, 160));
      s.apps.push(pid);
    }
    x = await tick(s, /^Application submitted/);          // whatever is left of the per-university steps
    /* An outcome needs Decision first (409), and a stale version is refused (409 conflict). */
    if (list[0]) {
      const early = await app(s, list[0], { outcome: 'offer' });
      check('an outcome before Decision is refused (409): ' + s.name, early.status === 409, early.status + ' ' + J(early.body).slice(0, 120));
      const cur = (await req(c.who, 'GET', '/api/staff/student/' + s.id)).body.apps || {};
      const v = (cur[list[0]] || {}).updatedAt || '';
      const a1 = await app(s, list[0], { stage: 3, ifUpdatedAt: v });
      check('a save with the version it was read with goes through: ' + s.name, a1.ok, a1.status + ' ' + J(a1.body).slice(0, 120));
      const a2 = await app(s, list[0], { stage: 4, ifUpdatedAt: v }, A);
      check('CONCURRENCY: a second save on the stale version is 409 conflict: ' + s.name, a2.status === 409 && a2.body.conflict, a2.status + ' ' + J(a2.body).slice(0, 120));
      if (a2.status === 409) conflicts++;
    }
    await expectLock(s, /^Offer letter/, '"Offer letter received" before any decision');
    /* Decisions: the first is an offer (won) or a rejection (lost); the others reject / waitlist. */
    const outcomes = s.fate === 'won' ? ['offer', 'rejected', 'waitlist'] : ['rejected', 'rejected', 'waitlist'];
    for (let k = 0; k < list.length; k++) {
      const o = outcomes[k] || 'rejected';
      const d = await app(s, list[k], { stage: 4, outcome: o });
      check('decision ' + o + ' recorded: ' + s.name, d.ok, d.status + ' ' + J(d.body).slice(0, 160));
      if (d.ok) { if (o === 'offer') offers++; else if (o === 'rejected') rejections++; else waitlists++; }
    }
    if (s.fate === 'lost') {
      await cMsg(s, 'I am sorry — the universities have said no this intake. Let us talk about the next one.');
      const cl = await req(A, 'PUT', '/api/staff/student/' + s.id + '/status', { status: 'left', note: 'Rejected everywhere this intake; student not continuing' });
      check('CLOSED as lost (left): ' + s.name, cl.ok && cl.body.status === 'left', cl.status + ' ' + J(cl.body).slice(0, 120));
      s.closed = 'left';
      continue;
    }
    x = await tick(s, /^Offer letter/);
    check('STAGE offer received (derived or ticked): ' + s.name, x.ok || /no such task/.test(x.body.error || '') || (await tasksOf(s)).some(t => /^Offer letter/.test(t.title) && t.status === 'done'), x.status + ' ' + J(x.body).slice(0, 160));
    /* Visa: documents in (the office's own land verified; the student's are accepted), filed, granted, travel date, pre-departure. */
    await expectLock(s, /^Visa application filed/, '"Visa application filed" before the visa file');
    for (const key of VISA_REQ) {
      const up = await staffUpload(s, key);
      if (!up.ok) check('visa document ' + key + ': ' + s.name, false, up.status + ' ' + J(up.body).slice(0, 120));
      else if (up.body.status !== 'ok') { const acc = await staffDoc(s, key, 'ok'); if (!acc.ok) check('accept visa doc ' + key, false, acc.status + ' ' + J(acc.body).slice(0, 120)); }
    }
    x = await tick(s, /^Visa documents ready/); check('STAGE visa documents ready: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
    x = await tick(s, /^Visa application filed/); check('STAGE visa filed: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
    const tooSoon = await req(c.who, 'PUT', '/api/staff/student/' + s.id + '/visa', { decision: 'granted' });
    check('a grant without the decision letter is refused (409): ' + s.name, tooSoon.status === 409, tooSoon.status + ' ' + J(tooSoon.body).slice(0, 120));
    const letter = await staffUpload(s, 'visa-decision', 'visa-grant.pdf');
    if (letter.ok && letter.body.status !== 'ok') await staffDoc(s, 'visa-decision', 'ok');
    const gr = await req(c.who, 'PUT', '/api/staff/student/' + s.id + '/visa', { decision: 'granted', travelDate: '2027-09-' + String(10 + (s.i % 18)).padStart(2, '0') });
    check('STAGE visa granted with a travel date: ' + s.name, gr.ok && gr.body.visa && gr.body.visa.decision === 'granted', gr.status + ' ' + J(gr.body).slice(0, 160));
    const vd = (await tasksOf(s)).find(t => /^Visa decision/.test(t.title)) || {};
    check('"Visa decision recorded" closes itself on the grant: ' + s.name, vd.status === 'done', J({ st: vd.status, lock: vd.lock }));
    x = await tick(s, /^Pre-departure/); check('STAGE pre-departure ticked: ' + s.name, x.ok, x.status + ' ' + J(x.body).slice(0, 160));
    /* Whatever else is open — the services bought (German A1, SOP…) are delivered. */
    for (const t of (await tasksOf(s)).filter(t => !['done', 'dropped'].includes(t.status) && !t.derived)) {
      const d = await req(c.who, 'PUT', '/api/staff/task/' + t.id, { status: 'done' });
      if (!d.ok) check('closing task "' + t.title + '" for ' + s.name, false, d.status + ' ' + J(d.body).slice(0, 160));
    }
    const ph = (await req(c.who, 'GET', '/api/staff/student/' + s.id)).body.phase || {};
    check('the phase reads departed / finished: ' + s.name, ph.finished || /depart/i.test(ph.key || ''), J(ph).slice(0, 160) + ' open: ' + J((await tasksOf(s)).filter(t => t.status !== 'done').map(t => t.key + ':' + t.status)));
  }
  check('LOCKS: every lock fired as 409 (' + locks + ' checked)', lockFails === 0 && locks > 0, lockFails + ' failed');
  /* Those who leave part-way: closed as left, with the reason. */
  for (const s of S.filter(x => x.id && x.fate === 'left')) {
    await stuMsg(s, 'I have decided not to continue this year. Thank you for your help.');
    const cl = await req(A, 'PUT', '/api/staff/student/' + s.id + '/status', { status: 'left', note: 'Student withdrew' });
    check('CLOSED as left: ' + s.name, cl.ok && cl.body.status === 'left', cl.status + ' ' + J(cl.body).slice(0, 120));
    s.closed = 'left';
    const again = await login(s.who, s.email, s.pw);
    check('a student who left cannot sign in any more: ' + s.name, !again.ok, again.status);
  }
  /* The destination with no catalogue: the counsellor works it by hand and the file closes won or lost. */
  for (const s of nz) {
    await cMsg(s, 'New Zealand is handled by our partner desk — I will send you the options by email.');
    const x = await tick(s, /^Welcome call/);
    const cl = await req(A, 'PUT', '/api/staff/student/' + s.id + '/status', { status: s.fate === 'won' ? 'completed' : 'left', note: s.fate === 'won' ? 'Placed through the NZ partner desk' : 'No programme found' });
    check('CLOSED (no-catalogue destination): ' + s.name, cl.ok, cl.status + ' ' + J(cl.body).slice(0, 120));
    s.closed = s.fate === 'won' ? 'completed' : 'left';
  }

  /* ---------------------------- the overdue tasks, the board, the SLA breach */
  say('checkpoint: the command centre before the files are closed');
  try {
    const sOpen = won.find(s => s.india && s.list && s.list.length);
    if (sOpen) {
      const { ctx, pg } = await ctxFor(C[sOpen.counsellor].who);
      await pg.goto(BASE + '/counsellor?student=' + sOpen.id, { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(3500);
      const cb = await pg.evaluate(() => document.body.innerText);
      check('COUNSELLOR: the open file shows the student with an offer recorded', cb.includes(sOpen.name) && /Offer/.test(cb), cb.replace(/\s+/g, ' ').slice(0, 200));
      await shot(pg, 'counsellor-file');
      await ctx.close();
    }
    const { ctx: octx, pg: op } = await ctxFor(A);
    await op.goto(BASE + '/ops', { waitUntil: 'domcontentloaded' }); await op.waitForTimeout(3500);
    const ob = await op.evaluate(() => document.body.innerText);
    check('OPS (mid-run): the board shows the five counsellors with their files', C.every(c => ob.includes(c.name)), ob.replace(/\s+/g, ' ').slice(0, 200));
    await shot(op, 'ops-midrun');
    await octx.close();
  } catch (e) { check('mid-run screens', false, e.message); }
  const lateOnes = won.filter(x => x.i % 8 === 1).slice(0, 8);
  const yesterday = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const lateTaskIds = [];
  for (const s of lateOnes) {
    const t = (await tasksOf(s)).find(x => x.status !== 'done' && x.status !== 'dropped' && !x.derived) || (await tasksOf(s)).find(x => /^Pre-departure/.test(x.title));
    if (!t) continue;
    const x = await req(A, 'PUT', '/api/staff/task/' + t.id, { status: 'open', due: yesterday, note: 'moved back for the overdue test' });
    if (x.ok) lateTaskIds.push({ s, id: t.id, title: t.title });
  }
  check('overdue setup: ' + lateTaskIds.length + ' tasks re-dated to 3 days ago and reopened', lateTaskIds.length >= 4, lateTaskIds.length);
  /* Messages waiting: the students whose last word was theirs. */
  const waitingReply = S.filter(x => x.id && !x.closed && x.lastFromStudent);
  const open = S.filter(x => x.id && !x.closed);
  const cmd = (await req(A, 'GET', '/api/staff/command')).body;
  const recon = [];                              // [what, simulated, dashboard, ok]
  const rec = (what, sim, dash, okIf) => { const ok = okIf === undefined ? sim === dash : okIf; recon.push([what, sim, dash, ok]); check('RECONCILE ' + what + ': simulated ' + sim + ' vs dashboard ' + dash, ok); };
  rec('/ops open files (students)', open.length, cmd.headline.students);
  rec('/ops conversations waiting for a reply', waitingReply.length, cmd.headline.waitingReply);
  const qLate = (cmd.queues || []).reduce((n, q) => n + q.late, 0);
  rec('/ops late task rows ≥ re-dated tasks', lateTaskIds.length, qLate, qLate >= lateTaskIds.length);
  for (const c of C) {
    const row = (cmd.counsellors || []).find(x => x.id === c.id) || {};
    const mine = open.filter(s => s.counsellor === C.indexOf(c));
    rec('/ops counsellor load: ' + c.name, mine.length, row.students);
    rec('/ops waiting messages for ' + c.name, waitingReply.filter(s => s.counsellor === C.indexOf(c)).length, row.waitingMessages);
  }
  const docsQ = (cmd.queues || []).find(q => q.key === 'docs') || {};
  /* Who has a file in review: the six extra certificates, the agency's work
     letters (an agency upload lands in review), and — by design (storeAttachment:
     "a file the student sent is waiting for the counsellor to check") — every
     student who sent a file in the chat that nobody has marked. */
  const docWaiters = new Set(open.filter(s => waitingDocs.includes(s) || (s.partner && s.fate !== 'left') || (s.i % 6 === 0 && s.docs >= 0 && s.attached)).map(s => s.id));
  rec('/ops documents-to-check students (extra certificates + agency uploads + unreviewed chat attachments)', docWaiters.size, docsQ.total);
  if (open.some(s => s.attached && !waitingDocs.includes(s) && !s.partner)) bug('LOW', 'A file a student sends in the chat (key shared-…) counts in /ops "Documents to check" and in the roster’s "in review" count until a counsellor marks it — by design per storeAttachment, but a counsellor who answered the message still sees it as unchecked work.', 'server/api.js storeAttachment / commandCentre docs queue');
  const journeyTotal = (cmd.journey || []).reduce((n, p) => n + p.students, 0);
  rec('/ops journey stops add up to the open files with work', open.length, journeyTotal, journeyTotal <= open.length && journeyTotal >= open.length - nz.length);
  /* The late tasks are done and the board clears. */
  for (const lt of lateTaskIds) { const x = await req(C[lt.s.counsellor].who, 'PUT', '/api/staff/task/' + lt.id, { status: 'done' }); if (!x.ok) check('late task done: ' + lt.title, false, x.status + ' ' + J(x.body).slice(0, 120)); }
  const cmd2 = (await req(A, 'GET', '/api/staff/command')).body;
  const qLate2 = (cmd2.queues || []).reduce((n, q) => n + q.late, 0);
  check('/ops: once the overdue tasks are done the late count drops by ' + lateTaskIds.length, qLate - qLate2 === lateTaskIds.length, qLate + ' → ' + qLate2);
  /* The admin's SLA clock change is visible. */
  const sla = await req(A, 'PUT', '/api/staff/command/sla', { messages: 12 });
  check('admin shortens the message SLA to 12 h', sla.ok && (await req(A, 'GET', '/api/staff/command')).body.queues.find(q => q.key === 'messages').sla === '12 h', J(sla.body));

  /* The counsellors answer everybody — nothing is left waiting. */
  for (const s of waitingReply) await cMsg(s, 'Noted — I will come back to you on this tomorrow.');
  const cmd3 = (await req(A, 'GET', '/api/staff/command')).body;
  rec('/ops waiting replies after the counsellors answered', 0, cmd3.headline.waitingReply);
  /* "Longest without a reply" ordering: the conversations list, admin. */
  {
    const conv = (await req(A, 'GET', '/api/staff/conversations')).body;
    const rows = conv.conversations || conv.rows || [];
    check('/api/staff/conversations lists every student with a thread', rows.length >= open.length, rows.length);
    const waiting = rows.filter(r => r.waitingHours != null || r.waiting);
    check('…and none is waiting on the office now', waiting.filter(r => (r.waitingHours || 0) > 0 || r.waiting === true).length === 0, J(waiting.slice(0, 2)).slice(0, 200));
  }

  /* -------------------------------------------- leads: escalation, then handled */
  say('leads: the ones nobody called escalate once; handled, they stop');
  const waitMs = Math.max(0, tLeadsIn + 33000 - Date.now());
  if (waitMs) await wait(waitMs);
  await wait(1500);
  let lc = (await req(A, 'GET', '/api/staff/leads/command')).body;
  const waiters = extraLeads.filter(l => l.waits);
  check('LEAD SLA: the four untouched leads are overdue/escalated, and only those', lc.kpis.waiting === waiters.length && lc.kpis.escalated === waiters.length, J({ waiting: lc.kpis.waiting, escalated: lc.kpis.escalated, overdue: lc.kpis.overdue }));
  check('LEAD SLA: every handled lead counted as responded within the SLA', lc.kpis.respondedSample >= leadsMade.length && lc.kpis.withinSla >= 90, J({ sample: lc.kpis.respondedSample, within: lc.kpis.withinSla, median: lc.kpis.medianFirstMins }));
  const escFeed = n => (lc.feed || []).filter(f => f.kind === 'escalated' && waiters.some(w => w.id === f.leadId)).length;
  const esc1 = escFeed();
  check('LEAD SLA: the escalation went out once per cold lead', esc1 === waiters.length, esc1 + ' for ' + waiters.length);
  check('LEAD SLA: no handled lead ever escalated', !(lc.feed || []).some(f => (f.kind === 'escalated' || f.kind === 'overdue') && leadsMade.some(m => m.id === f.leadId)), J((lc.feed || []).filter(f => f.kind === 'escalated' || f.kind === 'overdue').map(f => f.name)));
  for (const l of waiters) {
    const x = await req(C[0].who, 'POST', '/api/staff/lead/' + l.id + '/note', { kind: 'call', body: 'Finally reached — call booked for tomorrow.', nextAt: tomorrow });
    check('cold lead handled: ' + l.email, x.ok, x.status + ' ' + J(x.body).slice(0, 120));
    if (x.ok) { followUps++; touches++; }
  }
  await wait(2500);
  lc = (await req(A, 'GET', '/api/staff/leads/command')).body;
  check('LEAD SLA: once handled, nothing is waiting', lc.kpis.waiting === 0 && lc.kpis.escalated === 0 && lc.queue.filter(q => q.type === 'first').length === 0, J({ waiting: lc.kpis.waiting, esc: lc.kpis.escalated, q: lc.queue.length }));
  check('LEAD SLA: …and no further escalation was logged after handling', escFeed() === esc1, escFeed() + ' vs ' + esc1);
  const opsLW = (await req(A, 'GET', '/api/staff/command')).body.leadWatch || {};
  check('/ops "Leads waiting" agrees: 0', opsLW.waiting === 0 && opsLW.overdue === 0, J(opsLW));

  /* ============================================ PHASE 7: close every file */
  say('phase 7: closing the won files');
  for (const s of won) {
    const cl = await req(A, 'PUT', '/api/staff/student/' + s.id + '/status', { status: 'completed', note: 'Visa granted, departed' });
    check('CLOSED as won (completed): ' + s.name, cl.ok && cl.body.status === 'completed', cl.status + ' ' + J(cl.body).slice(0, 120));
    s.closed = 'completed';
    if (s.i % 20 === 7) {
      const ro = await req(s.who, 'POST', '/api/documents', undefined, { form: fileForm('file', pdf('late'), 'late.pdf', 'application/pdf', { key: 'other' }) });
      check('a completed file is read-only for uploads (403): ' + s.name, ro.status === 403, ro.status);
      const msg = await stuMsg(s, 'Thank you for everything!');
      check('…but the student may still write to their counsellor: ' + s.name, msg.ok, msg.status);
    }
  }
  const withId = S.filter(x => x.id);
  check('ALL ' + withId.length + ' files with an account are closed', withId.every(s => s.closed), withId.filter(s => !s.closed).map(s => s.i + ':' + s.route).join(','));
  check('…and that is all 100 students', withId.length === N, withId.length);

  /* ====================================== FINAL RECONCILIATION */
  say('final reconciliation: ops, overview, money, analytics, marketing');
  const ov = (await req(A, 'GET', '/api/staff/overview')).body;
  const wonN = S.filter(s => s.closed === 'completed').length, leftN = S.filter(s => s.closed === 'left').length;
  rec('/overview open students after closing', 0, ov.students);
  rec('/overview closed students (100 + the seed)', N + 1, ov.studentsClosed);
  rec('/overview enquiries in the book (not archived)', leadsMade.length + extraLeads.length - spamLeads, ov.enquiries);
  const cmdF = (await req(A, 'GET', '/api/staff/command')).body;
  rec('/ops open files after closing', 0, cmdF.headline.students);
  rec('/ops open work after closing', 0, cmdF.headline.open);
  const money = (await req(A, 'GET', '/api/staff/money')).body;
  const simReceived = S.reduce((n, s) => n + s.paidPaise, 0);
  const simGross = S.reduce((n, s) => n + s.grossPaise, 0);
  rec('/money received (paise) = seed + every payment simulated', base.money.received + simReceived, money.received);
  rec('/money expected (paise) = seed + every earned order', base.money.expected + simGross, money.expected);
  rec('/money pending', 0, money.pending);
  rec('/money lost', 0, money.lost);
  rec('/money students won (completed)', wonN + 1, money.students.completed);
  rec('/money students lost (left)', leftN, money.students.left);
  /* GST: 18% inside the Indian receipts only — exports and EU-VAT orders carry none. */
  const gstBase = base.money.received + S.filter(s => s.india).reduce((n, s) => n + s.paidPaise, 0);
  const gstWant = Math.round(gstBase - gstBase / 1.18);
  rec('/money GST = 18/118 of Indian receipts only', gstWant, money.gst, Math.abs(gstWant - money.gst) <= 2);
  if (Math.abs(gstWant - money.gst) > 2) {
    const euPaid = S.filter(s => (payConfig.euVat.countries || []).includes(s.residence)).reduce((n, s) => n + s.paidPaise, 0);
    const alt = Math.round((gstBase + euPaid) - (gstBase + euPaid) / 1.18);
    if (Math.abs(alt - money.gst) <= 2) bug('MEDIUM', 'The Money screen counts GST inside EU-VAT orders (tax_mode "eu-vat-19"): MONEY.summarise only excludes tax_mode === "export", so a German buyer’s 19% VAT order is reported as carrying 18% Indian GST. GST overstated by ₹' + Math.round((money.gst - gstWant) / 100) + ' in this run.', 'server/money.js summarise');
  }
  const ordersBook = (await req(A, 'GET', '/api/staff/orders')).body.orders || [];
  const simOrders = S.reduce((n, s) => n + s.orders.length, 0);
  rec('/orders rows = seed + simulated orders', 1 + simOrders, ordersBook.length);
  check('no order is still awaiting/owing', !ordersBook.some(o => ['awaiting', 'owing', 'part', 'failed'].includes(o.status)), J(ordersBook.filter(o => ['awaiting', 'owing', 'part', 'failed'].includes(o.status)).map(o => o.reference + ':' + o.status)));
  const refs = ordersBook.map(o => o.reference);
  check('order references are unique', new Set(refs).size === refs.length, refs.length - new Set(refs).size + ' duplicates');
  const an = await req(A, 'GET', '/api/staff/analytics');
  check('/api/staff/analytics answers', an.ok, an.status);
  /* Leads. */
  const leads = (await req(A, 'GET', '/api/staff/leads')).body;
  rec('/leads total in the book', leadsMade.length + extraLeads.length - spamLeads, leads.summary.total);
  rec('/leads converted', converted, leads.summary.converted);
  rec('/leads lost (incl. archived spam? no — archived are out)', lostLeads - spamLeads, leads.summary.byStatus.lost || 0);
  rec('/leads follow-ups = calls, WhatsApps and emails logged (notes and chat replies are not follow-ups)', touches - spamLeads * 0, leads.summary.followUps, Math.abs(touches - leads.summary.followUps) <= 1);
  const bySrc = leads.summary.bySource || {};
  const simBySrc = {};
  leadsMade.forEach(m => { const k = m.s.leadSource || 'website'; simBySrc[k] = (simBySrc[k] || 0) + 1; });
  extraLeads.filter(l => !l.spam).forEach(() => { simBySrc.instagram = (simBySrc.instagram || 0) + 1; });
  for (const k of Object.keys(simBySrc)) rec('/leads by source: ' + k, simBySrc[k], (bySrc[k] || {}).leads || 0);
  rec('/leads conversions by source: chat', S.filter(s => s.route === 6 && s.id).length, (bySrc.chat || {}).converted || 0);
  rec('/leads conversions by source: no-match', S.filter(s => s.route === 3 && s.id).length, (bySrc['no-match'] || {}).converted || 0);
  const lcF = (await req(A, 'GET', '/api/staff/leads/command')).body;
  rec('/leads-command converted this month', converted, lcF.kpis.convertedMonth);
  rec('/leads-command open leads', waiters.length, lcF.kpis.open);
  /* Marketing. */
  const mk = (await req('mkt', 'GET', '/api/marketing/report?days=7')).body;
  const tot = mk.totals || {};
  rec('/marketing leads (30d)', leadsMade.length + extraLeads.length, tot.leads);
  rec('/marketing sign-ups = students who made an account (100 + the seed student)', N + 1, tot.signups);
  const payers = new Set(S.filter(s => s.paidPaise > 0).map(s => s.id)).size;
  rec('/marketing payers = students who paid', payers, tot.payers);
  rec('/marketing revenue (₹) = every payment', Math.round(simReceived / 100), Math.round(tot.revenue), Math.abs(simReceived / 100 - tot.revenue) < 2);
  check('/marketing visitor → lead → student funnel is drawn', Array.isArray(mk.funnel) ? mk.funnel.length >= 3 : !!mk.funnel, J(mk.funnel).slice(0, 200));
  check('/marketing visitors were counted from the page views', tot.visitors >= N, tot.visitors);
  check('/marketing campaigns: the contact-form utm campaigns are attributed', Object.keys(mk.campaigns || {}).length >= 1 || (Array.isArray(mk.campaigns) && mk.campaigns.length >= 1), J(mk.campaigns).slice(0, 200));
  const spend = await req('mkt', 'POST', '/api/marketing/spend', { channel: 'Google Ads', amount: 25000, month: new Date().toISOString().slice(0, 7), currency: 'INR' });
  check('marketing logs spend', spend.ok, spend.status + ' ' + J(spend.body).slice(0, 120));
  const mk2 = (await req('mkt', 'GET', '/api/marketing/report?days=7')).body;
  check('/marketing shows the spend and a cost per lead', (mk2.totals || {}).spend > 0 && (mk2.totals || {}).cpl > 0, J({ spend: mk2.totals && mk2.totals.spend, cpl: mk2.totals && mk2.totals.cpl }));

  /* ------------------------------------------------------------ the mail */
  say('mail: what would have been sent');
  const dec = v => String(v || '').replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (m, b) => Buffer.from(b, 'base64').toString('utf8')).replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (m, q) => Buffer.from(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
  const outbox = fs.readdirSync(DIR + '/outbox').map(f => { const t = fs.readFileSync(DIR + '/outbox/' + f, 'utf8'); return { to: dec((/^To: (.*)$/m.exec(t) || [])[1] || ''), subject: dec((/^Subject: (.*(?:\r?\n[ \t].*)*)$/m.exec(t) || [])[1] || '').replace(/\r?\n[ \t]+/g, ' '), body: t }; });
  const bySubject = {};
  outbox.forEach(m => { const k = m.subject.replace(/GLV-\d+.*/, 'GLV-…').replace(/^.* replied to you$/, '<counsellor> replied to you').replace(/^New message from .*/, 'New message from <student>').replace(/^Counselling request — .*/, 'Counselling request — <lead>').replace(/^Your .* needs another copy$/, 'Your <doc> needs another copy').replace(/booked — .*/, 'booked — <when>'); bySubject[k] = (bySubject[k] || 0) + 1; });
  console.log('  outbox: ' + outbox.length + ' messages\n' + Object.entries(bySubject).sort((a, b) => b[1] - a[1]).map(([k, v]) => '    ' + String(v).padStart(4) + '  ' + k).join('\n'));
  const replied = outbox.filter(m => / replied to you$/.test(m.subject));
  const simReplies = S.reduce((n, s) => n + s.msgsIn, 0);
  rec('mail "<counsellor> replied to you" = counsellor messages typed (files sent carry no mail; students were never online)', simReplies - attachments / 2, replied.length);
  let wrongTo = 0;
  for (const s of S.filter(x => x.id)) {
    const mine = replied.filter(m => m.to.toLowerCase().includes(s.email));
    const cName = C[s.counsellor].name;
    /* Every reply mail to this student names a counsellor who held the file. */
    mine.forEach(m => { if (!m.subject.startsWith(cName) && !m.subject.startsWith(C[(s.counsellor + 1) % 5].name)) wrongTo++; });
  }
  check('no counsellor-reply mail went to the wrong student', wrongTo === 0, wrongTo);
  const dup = outbox.filter((m, i) => outbox.findIndex(x => x.to === m.to && x.subject === m.subject && x.body.replace(/^(Date|Message-ID):.*$/gm, '') === m.body.replace(/^(Date|Message-ID):.*$/gm, '')) !== i);
  check('no email was sent twice (same recipient, subject and body)', dup.length === 0, dup.slice(0, 3).map(m => m.to + ' / ' + m.subject).join(' | '));
  const rescanMail = outbox.filter(m => /needs another copy/.test(m.subject));
  rec('mail "needs another copy" = rescans asked', rescans, rescanMail.length);
  const receiptsMail = outbox.filter(m => /^Your Glovels order GLV-/.test(m.subject));
  check('an order receipt email went for every website checkout (' + receiptsMail.length + ')', receiptsMail.length >= S.filter(s => s.route !== 10 && s.pkg).length, receiptsMail.length);
  const credMail = outbox.filter(m => /Your Glovels sign-in$/.test(m.subject));
  check('sign-in details were emailed to every converted lead and staff account', credMail.length >= converted, credMail.length + ' vs ' + converted);

  /* ------------------------------------------------------------ screens */
  say('the screens');
  try {
    const b = browser;
    /* A won Indian student (GST receipt) and an abroad one (export). */
    const sIn = S.find(s => s.id && s.india && s.closed === 'completed' && s.orders.some(o => o.gross > 0));
    const sAb = S.find(s => s.id && !s.india && s.closed === 'completed' && s.orders.some(o => o.gross > 0) && !(payConfig.euVat.countries || []).includes(s.residence));
    for (const [s, tag] of [[sIn, 'india'], [sAb, 'abroad']]) {
      if (!s) continue;
      await login(s.who, s.email, s.pw);
      const { ctx, pg } = await ctxFor(s.who, s.india ? 'Asia/Kolkata' : ({ NP: 'Asia/Kathmandu', BD: 'Asia/Dhaka', LK: 'Asia/Colombo', NG: 'Africa/Lagos', GH: 'Africa/Accra', KE: 'Africa/Nairobi', PH: 'Asia/Manila', AE: 'Asia/Dubai', RS: 'Europe/Belgrade', DE: 'Europe/Berlin' })[s.residence] || 'UTC');
      await pg.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500);
      const body = await pg.evaluate(() => document.body.innerText);
      if (tag === 'india') check('DASHBOARD (india): the order list is in rupees on an Indian device', /₹4,999|₹9,999|₹1,999|₹999/.test(body) && !/€\d/.test(body.split('Your order')[0] || ''), body.slice(0, 400).replace(/\s+/g, ' '));
      check('DASHBOARD (' + tag + '): the receipt card is on the screen with a PDF button', /Download receipt \(PDF\)/.test(body), body.slice(0, 120));
      check('DASHBOARD (' + tag + '): does not tell a paying student "Payment is not connected yet"', !/Payment is not connected/.test(body), body.slice(0, 160));
      if (tag === 'india') check('DASHBOARD (india): the receipt carries GST @ 18%', /GST @ 18%/.test(body));
      else check('DASHBOARD (abroad): the receipt says no tax — export of services', /None \(export of services\)/.test(body));
      check('DASHBOARD (' + tag + '): the journey is finished — visa and departure done', /Visa and departure/.test(body) && !/still needed/i.test(body), body.slice(0, 200));
      await shot(pg, 'dashboard-' + tag);
      await pg.goto(BASE + '/documents', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2000);
      const dbody = await pg.evaluate(() => document.body.innerText);
      check('DOCUMENTS (' + tag + '): the required set reads verified', /Verified|Accepted/i.test(dbody), dbody.slice(0, 160));
      await shot(pg, 'documents-' + tag);
      await pg.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2000);
      const mbody = await pg.evaluate(() => document.body.innerText);
      check('MESSAGES (' + tag + '): the counsellor’s words are on the thread', mbody.includes(C[s.counsellor].name.split(' ')[0]), mbody.slice(0, 160));
      await shot(pg, 'messages-' + tag);
      await ctx.close();
    }
    /* The command centre, marketing, leads command, admin — as the admin. */
    const { ctx: actx, pg: ap } = await ctxFor(A);
    await ap.goto(BASE + '/ops', { waitUntil: 'domcontentloaded' }); await ap.waitForTimeout(3000);
    const ob = await ap.evaluate(() => document.body.innerText);
    check('OPS (final): the command centre renders with the counsellors on the board', C.every(c => ob.includes(c.name)), ob.slice(0, 200));
    await shot(ap, 'ops');
    await ap.goto(BASE + '/marketing', { waitUntil: 'domcontentloaded' }); await ap.waitForTimeout(3500);
    const mb = await ap.evaluate(() => document.body.innerText);
    check('MARKETING: the dashboard renders leads, sign-ups and revenue', /lead/i.test(mb) && /sign/i.test(mb), mb.slice(0, 200));
    await shot(ap, 'marketing');
    await ap.goto(BASE + '/leads-command', { waitUntil: 'domcontentloaded' }); await ap.waitForTimeout(3000);
    const lb = await ap.evaluate(() => document.body.innerText);
    check('LEADS COMMAND: renders with the team board', /Unassigned/.test(lb) && lb.includes(M.name), lb.slice(0, 200));
    await shot(ap, 'leads-command');
    await ap.goto(BASE + '/leads', { waitUntil: 'domcontentloaded' }); await ap.waitForTimeout(2500);
    await shot(ap, 'leads');
    await ap.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' }); await ap.waitForTimeout(3000);
    await shot(ap, 'admin');
    await actx.close();
    check('no page errors on the screens', errs.length === 0, errs.slice(0, 4).join(' | '));
    await b.close();
  } catch (e) { check('screens ran', false, e.message); }

  /* --------------------------------------------------------- performance */
  say('performance');
  const blockers = slow.filter(x => x.ms > 5000);
  check('no request took more than 5 s (go-live blocker)', blockers.length === 0, J(blockers.slice(0, 5)));
  check('requests over 2 s: ' + slow.length, slow.length <= 3, J(slow.slice(0, 8)));
  rssPeak = Math.max(rssPeak, rssMb());
  check('server RSS stayed under 300 MB (peak ' + rssPeak + ' MB)', rssPeak > 0 && rssPeak < 300, rssPeak);
  const log = fs.readFileSync(DIR + '/serve.log', 'utf8');
  const crashes = (log.match(/UNIQUE constraint|TypeError|ReferenceError|Unhandled|SQLITE_/g) || []);
  check('the server log carries no exceptions', crashes.length === 0, crashes.slice(0, 5).join(', '));

  /* ---------------------------------------------------------------- done */
  console.log('\n' + 'RECONCILIATION (simulated vs dashboard)');
  recon.forEach(([w, a, b2, ok]) => console.log('  ' + (ok ? '=' : '≠') + ' ' + w.padEnd(70) + String(a).padStart(10) + String(b2).padStart(10)));
  console.log('\nFINDINGS');
  bugs.forEach(x => console.log('  ' + x.sev + ': ' + x.what + (x.where ? ' [' + x.where + ']' : '')));
  if (failures.length) { console.log('\nFAILED CHECKS'); failures.forEach(f => console.log('  ✗ ' + f)); }
  console.log('\nrun: ' + Math.round((Date.now() - T0) / 1000) + ' s; outbox ' + outbox.length + '; slow ' + slow.length + '; RSS peak ' + rssPeak + ' MB; counts — rzp ' + rzpPaid + ', stripe ' + stripePaid + ', office ' + officePaid + ', parts ' + partsOrders + ', free ' + freeOrders + ', quotes ' + quoteOrders + ', offers ' + offers + ', rejections ' + rejections + ', waitlists ' + waitlists + ', filed ' + filed + ', conflicts ' + conflicts + ', rescans ' + rescans + ', bad uploads ' + badUploads + ', attachments ' + attachments + ', follow-ups ' + followUps + ', converted ' + converted);
  console.log('\ne2e100test: ' + pass + ' passed, ' + fail + ' failed');
  clearInterval(rssTimer);
  try { process.kill(-child.pid); } catch (e) { /* gone */ }
  rzpSrv.close(); stSrv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error(e);
  clearInterval(rssTimer);
  try { process.kill(-child.pid); } catch (x) { /* gone */ }
  console.log('\ne2e100test: ' + pass + ' passed, ' + (fail + 1) + ' failed (crashed)');
  process.exit(2);
});
