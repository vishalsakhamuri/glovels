/*
 * Round 168 — two decisions Vishal made on 11 Oct after the ranking sweep.
 *
 *   "whether free public programmes should always rank above paid private
 *    ones at the same level of fit — yes, we show the mix"
 *       → a weight, not a filter: at the same relevance and tier a free public
 *         programme outranks a paid private one that merely states more
 *         requirements the student clears; private rows stay in the list.
 *
 *   "what to show when a field can't fill a 10-package (e.g. MBA below CGPA
 *    7.2) — show what we have, the remaining the counsellor will assign"
 *       → the student sees the picks that exist and is told the rest stay
 *         open; the counsellor's bell says "N places to fill" on that file.
 *
 * Runs on the German catalogue (port 8097; loads it like round165 when the
 * database is nearly empty).
 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8097';
const SHOTS = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
const M = require(path.join(__dirname, '..', 'server', 'matches.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };
const note = s => console.log('    · ' + s);
const J = x => JSON.stringify(x);
function done() { console.log('round168test: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.168.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] }; if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text };
}

/* ---- 1. the weight, on the scorer alone (no server needed) ---- */
(() => {
  const w = { field: 'Business & Management', cgpa: 8, level: 'master', country: 'DE' };
  const free = { id: 'f', program: 'Master in Business Management', university: 'U1', country: 'DE', level: 'master', field: 'Business & Management', isPublic: true, totalInr: 0, intakes: [], reqs: {} };
  /* The private row states six requirements the student clears (+5 each =
     +30) and is otherwise the same; before 168 that was +22 over the free
     public row (+8). */
  const paid = Object.assign({}, free, { id: 'p', university: 'U2', isPublic: false, totalInr: 2500000,
    reqs: { ieltsMin: 6, toeflMin: 80, moiAccepted: true, workExpRequired: false, bachelorYears: 3, ectsMin: 180 } });
  const prof = { d_cgpa: '8', d_max: '10', d_pass: '4', e_test: 'IELTS', e_score: '6.5', d_dur: '4 years', g_field: 'Business & Management', g_level: "Master's", g_country: 'Germany' };
  const s = M.screen([free, paid], prof, { DE: { code: 'DE', name: 'Germany' } }, { limit: 10 });
  const order = s.fits.map(x => x.id);
  ok('scorer: a free public programme ranks above a paid private one of the same relevance/tier that merely states more cleared requirements', order[0] === 'f', J(s.fits.map(x => [x.id, x.score])));
  ok('scorer: the private one is still in the list (a mix, not a filter)', order.includes('p'), J(order));
  const better = Object.assign({}, paid, { id: 'p2', fit: 95 });
  const s2 = M.screen([Object.assign({}, free, { fit: 50 }), better], prof, { DE: { code: 'DE', name: 'Germany' } }, { limit: 10 });
  ok('scorer: a private programme with a clearly better fit still ranks above a free one', s2.fits[0].id === 'p2', J(s2.fits.map(x => [x.id, x.score])));
  /* Patch 170: "any restriction should be for ranking" — with everything else
     equal, a restricted programme ranks below an open one, for a student who
     did not rule restricted out (the default). */
  const open = Object.assign({}, free, { id: 'zz-open' });
  const restr = Object.assign({}, free, { id: 'aa-restr', university: 'U3', reqs: { restricted: true } });
  const s3 = M.screen([restr, open], prof, { DE: { code: 'DE', name: 'Germany' } }, { limit: 10 });
  ok('scorer: a restricted programme ranks below an open one of the same fit (and stays in the list)', s3.fits.map(x => x.id).join() === 'zz-open,aa-restr', J(s3.fits.map(x => [x.id, x.score])));
})();

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ' — server checks skipped)'); return done(); }
  const st = Date.now().toString(36);
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.status === 200, r.status);
  const total0 = Number((await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.total || 0);
  if (total0 < 1000) {
    const sheets = (process.env.R165_SHEETS || [SHOTS + '/r165/live-DE-noid.xlsx', SHOTS + '/out/glovels-germany-v37-new-rows.xlsx'].join(';')).split(';').filter(f => f && fs.existsSync(f));
    for (const f of sheets) {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const u = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a, 'x-forwarded-for': ips.a }, body: fd });
      note('loaded ' + path.basename(f) + ': ' + u.status + ' ' + (await u.text()).slice(0, 100));
    }
  }

  /* ---- 2. the mix on the real catalogue: Business at 8.0, kind any ---- */
  const PROF = { d_course: 'BBA', d_dur: '4 years', d_cgpa: '8', d_max: '10', d_pass: '4', e_test: 'IELTS', e_score: '6.5', a_test: 'Not taken yet', g_german: 'None yet', w_has: 'No', g_level: "Master's", g_field: 'Business & Management', g_country: 'Germany', b_total: 'Above ₹40 Lakhs' };
  r = await req('a', 'POST', '/api/staff/fit', { profile: PROF, filters: { limit: 2000, kind: 'any' } });
  const fits = r.body.fits || [];
  const top = fits.filter(x => x.relevance === fits[0].relevance && !(x.soft || []).length && !(x.ask || []).length);
  const pos = (pred) => { const xs = top.map((x, i) => pred(x) ? i : -1).filter(i => i >= 0); return xs.length ? xs[Math.floor(xs.length / 2)] : -1; };
  const medFree = pos(x => x.isPublic && !Number(x.totalInr || 0)), medPaid = pos(x => !x.isPublic && Number(x.totalInr || 0) > 0);
  const firstPaid = top.findIndex(x => !x.isPublic && Number(x.totalInr || 0) > 0);
  const freeBefore = top.slice(0, Math.max(0, firstPaid)).filter(x => x.isPublic && !Number(x.totalInr || 0)).length;
  const freeTotal = top.filter(x => x.isPublic && !Number(x.totalInr || 0)).length;
  ok('catalogue: in the top relevance/clear tier (' + top.length + ' rows) free public programmes sit ahead of paid private ones — median position free #' + (medFree + 1) + ' vs paid #' + (medPaid + 1) + '; ' + freeBefore + ' of ' + freeTotal + ' free rows come before the first paid private row',
    medPaid < 0 || (medFree >= 0 && medFree < medPaid && freeBefore >= Math.floor(freeTotal * 0.8)),
    J(top.slice(0, 12).map(x => [x.university, x.isPublic ? 'pub' : 'priv', x.totalInr, x.score])));
  ok('catalogue: the list is still a mix — private programmes appear', fits.some(x => !x.isPublic), fits.length);

  /* ---- 3. a short package: MBA at CGPA 6.5 on the 10-package ---- */
  const MBA = { d_course: 'BBA', d_dur: '3 years', d_cgpa: '6.5', d_max: '10', d_pass: '4', e_test: 'IELTS', e_score: '6.5', a_test: 'Not taken yet', g_german: 'None yet', w_has: 'No', g_level: 'MBA', g_field: 'MBA', g_country: 'Germany', b_total: 'Above ₹40 Lakhs' };
  r = await req('a', 'POST', '/api/staff/fit', { profile: MBA, filters: { limit: 2000, kind: 'public' } });
  const pubUnis = []; (r.body.fits || []).forEach(x => { if (!pubUnis.includes(x.university)) pubUnis.push(x.university); });
  note('MBA public universities at 6.5: ' + pubUnis.length + ' (' + pubUnis.slice(0, 8).join(' · ') + ')');
  if (pubUnis.length >= 10) { note('the catalogue fills the 10-package here; the short-package checks need a thinner field — skipping'); return done(); }
  const who = 'mba';
  const email = who + '-' + st + '@ex.example';
  r = await req(who, 'POST', '/api/orders', { name: 'Short Mba', email, phone: '+919000168010', acceptedTerms: true, packageId: 'pkg-offer' });
  ok('pkg-offer: the order is placed', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  await req(who, 'POST', '/api/auth/change', { password: who + '-' + st + '-password' });
  r = await req(who, 'PUT', '/api/profile', { profile: Object.assign({ fullName: 'Short Mba' }, MBA) });
  ok('the profile saves and the matcher runs', r.status === 200 && r.body.matched, r.text.slice(0, 160));
  const s = (await req(who, 'GET', '/api/state')).body;
  const named = (s.shortlist || []).filter(x => x.addedBy === 'matched');
  const heldN = Number((s.matched || {}).held || 0);
  ok('the student sees what there is: ' + named.length + ' named + ' + heldN + ' held, fewer than 10', named.length + heldN < 10 && named.length + heldN > 0, J(s.matched));
  ok('all of them are public (the package\'s kind)', named.every(x => x.isPublic !== false), J(named.map(x => x.university)));
  const told = (s.msgs || []).find(m => /stay open/.test(m.t || ''));
  ok('and is told the remaining places stay open for the counsellor', !!told, (s.msgs || []).slice(-1).map(m => (m.t || '').slice(0, 200)).join());
  /* The counsellor's half: the bell. */
  r = await req('a', 'GET', '/api/staff/alerts');
  const mine = (r.body.alerts || []).filter(a => a.kind === 'places' && String((a.subject || {}).studentId) === String(s.user.id));
  ok('the office bell carries a "places to fill" alert for that student', mine.length === 1, J((r.body.alerts || []).filter(a => a.kind === 'places').map(a => a.title)));
  const open = 10 - named.length - heldN;
  ok('  · naming how many places are open (' + open + ')', mine[0] && new RegExp(open + ' place').test(mine[0].title + ' ' + mine[0].detail), mine[0] && mine[0].title + ' | ' + mine[0].detail);
  /* A counsellor filling one place reduces it. */
  r = await req('a', 'POST', '/api/staff/people', { name: 'Places Counsellor', email: 'places-' + st + '@glovels.com', role: 'counsellor' });
  const cid = r.body.person && r.body.person.id;
  await req('a', 'POST', '/api/staff/student/' + s.user.id + '/assign', { counsellorId: cid });
  const anyFit = (await req('a', 'POST', '/api/staff/fit', { profile: MBA, filters: { limit: 50, kind: 'any' } })).body.fits || [];
  const extra = anyFit.find(x => !named.some(n => String(n.id) === String(x.id)) && !x.isPublic);
  if (extra) {
    r = await req('a', 'POST', '/api/staff/student/' + s.user.id + '/shortlist', { id: extra.id });
    ok('the counsellor adds one of her own (' + extra.university + ')', r.status === 200, r.text.slice(0, 120));
    r = await req('a', 'GET', '/api/staff/alerts');
    const after = (r.body.alerts || []).filter(a => a.kind === 'places' && String((a.subject || {}).studentId) === String(s.user.id));
    /* A private add does not fill a PUBLIC place — the alert still counts the
       public package's open places; what it must not do is disappear or grow. */
    ok('the alert still stands (an add of the other kind does not fill a public place)', after.length === 1 && new RegExp(open + ' place').test(after[0].title + ' ' + after[0].detail), J(after.map(a => a.title)));
    const s2 = (await req(who, 'GET', '/api/state')).body;
    ok('the student sees the counsellor\'s add on top of what there was', (s2.shortlist || []).some(x => String(x.id) === String(extra.id)) && (s2.shortlist || []).filter(x => x.addedBy === 'matched').length === named.length, J((s2.shortlist || []).map(x => [x.university, x.addedBy])));
  }
  done();
})().catch(e => { console.log('  ✗ crashed: ' + (e.stack || e)); fail++; done(); });
