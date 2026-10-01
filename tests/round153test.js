/*
 * Patch 153 — MOI clears, GRE sections, ECTS, top %, restricted admission,
 * held programmes and the no-match lead.
 *
 * Node only for the rules (reqs, matches, store, tasks). The delivery itself —
 * a package of three against one open and one restricted programme, one
 * matched and one held, the hold released by the counsellor — runs against a
 * server when one answers on BASE (`./srv.sh 8099` first); without one that
 * part says so and is skipped, so the Node run stays green on its own.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const R = require(path.join(__dirname, '..', 'server', 'reqs.js'));
const M = require(path.join(__dirname, '..', 'server', 'matches.js'));
const T = require(path.join(__dirname, '..', 'server', 'tasks.js'));
const STORE = require(path.join(__dirname, '..', 'server', 'store.js'));
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const J = x => JSON.stringify(x);

/* A. The sheet knows the new columns. */
['gre quant min', 'gre verbal min', 'gre awa min', 'ects min', 'restricted', 'top percent']
  .forEach(h => ok('sheet header "' + h + '"', R.SHEET_HEADERS.includes(h)));
const cl = R.clean({ greQuant: '160', greAwa: '4.5', ectsMin: '210', restricted: 'yes', topPercent: '10' }).reqs;
ok('the new fields clean to their types', cl.greQuant === 160 && cl.greAwa === 4.5 && cl.ectsMin === 210 && cl.restricted === true && cl.topPercent === 10, J(cl));
ok('an ECTS outside 180–240 is refused, not clamped', R.clean({ ectsMin: '120' }).refused.some(x => x.field === 'ectsMin'));

/* B. check(). */
let v = R.check({ ieltsMin: 6.5, moiAccepted: true }, { ielts: 6 });
ok('MOI accepted + short IELTS: no fail, a note', v.fails.length === 0 && v.notes.includes('clears via MOI letter'), J(v));
v = R.check({ ieltsMin: 6.5, moiAccepted: true }, {});
ok('  · and with no score at all, the same note', v.fails.length === 0 && v.unknown.length === 0 && v.notes.length === 1, J(v));
v = R.check({ ieltsMin: 6.5 }, { ielts: 6 });
ok('  · but a short IELTS still misses where MOI is not stated', v.fails.length === 1 && !v.notes.length, J(v));
v = R.check({ greQuant: 160 }, M.answersOf({ a_test: 'GRE', a_score: '320', a_quant: '155' }));
ok('GRE Quant 160 against a 155 misses', v.fails.length === 1 && v.fails[0].label === 'GRE Quant' && v.fails[0].have === '155', J(v));
v = R.check({ greQuant: 160 }, M.answersOf({ a_test: 'GRE', a_score: '320' }));
ok('  · a total with no section score is a question (greSections)', !v.fails.length && v.unknown.includes('greSections'), J(v));
v = R.check({ greVerbal: 150 }, M.answersOf({ a_test: 'Not taken yet' }));
ok('  · "not taken" misses, naming the section', v.fails.length === 1 && /GRE Verbal 150/.test(v.fails[0].want), J(v));
v = R.check({ ectsMin: 210 }, M.answersOf({ d_dur: '3 years' }));
ok('ECTS 210 against a 3-year bachelor\'s (180) misses', v.fails.length === 1 && v.fails[0].key === 'ects' && v.fails[0].have === '180', J(v));
v = R.check({ ectsMin: 210 }, M.answersOf({ d_dur: '4 years' }));
ok('  · a 4-year bachelor\'s (240) clears', v.fails.length === 0 && v.unknown.length === 0, J(v));
v = R.check({ ectsMin: 210 }, M.answersOf({ d_ects: '210' }));
ok('  · a stated 210 clears', v.fails.length === 0, J(v));
v = R.check({ ectsMin: 180 }, {});
ok('  · nothing known is a question', v.unknown.includes('ects'), J(v));
v = R.check({ topPercent: 10 }, M.answersOf({ d_top: '20' }));
ok('top 10% against top 20% misses', v.fails.length === 1 && v.fails[0].want === 'top 10%' && v.fails[0].have === 'top 20%', J(v));
v = R.check({ topPercent: 10 }, M.answersOf({ d_top: '5' }));
ok('  · top 5% clears', v.fails.length === 0, J(v));
v = R.check({ restricted: true }, M.answersOf({ g_restricted: 'no' }));
ok('restricted + "only open admission" misses', v.fails.length === 1 && v.fails[0].key === 'restricted', J(v));
v = R.check({ restricted: true }, M.answersOf({}));
ok('  · by default it clears, with a note', v.fails.length === 0 && v.notes.some(n => /restricted/.test(n)), J(v));
ok('answersOf reads the new profile keys',
  (a => a.greQuant === 165 && a.greVerbal === 150 && a.greAwa === 4 && a.ects === 240 && a.topPercent === 10 && a.restrictedOk === true)
  (M.answersOf({ a_quant: '165', a_verbal: '150', a_awa: '4', d_ects: '240', d_top: '10', g_restricted: 'yes' })));

/* C. screen(). */
const row = (id, o) => Object.assign({ id, program: 'Computer Science', university: 'U' + id, level: 'master', field: 'Computer Science & IT',
  country: 'DE', isPublic: true, totalInr: 0, intakes: [], reqs: {} }, o);
const cat = [
  row('pub'),
  row('pkg', { isPublic: false, feeModel: 'package', totalInr: 1500000 }),
  row('priv', { isPublic: false, totalInr: 1500000 }),
  row('nc', { reqs: { restricted: true } }),
  row('moi', { reqs: { ieltsMin: 7, moiAccepted: true } }),
];
const P = { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science', d_course: 'B.Tech CSE', d_cgpa: '8', d_max: '10', d_pass: '4', e_test: 'IELTS', e_score: '6.5' };
const C = { DE: 'Germany', Germany: 'DE' };
const fits = r => r.fits.map(x => x.id);
const free = fits(M.screen(cat, P, C, { feeModel: 'free' }));
ok('feeModel "free" keeps the private row and drops public + package', free.includes('priv') && !free.includes('pub') && !free.includes('pkg'), free);
const pk = fits(M.screen(cat, P, C, { feeModel: 'package' }));
ok('feeModel "package" keeps public + package rows', pk.includes('pub') && pk.includes('pkg') && !pk.includes('priv'), pk);
const open = fits(M.screen(cat, P, C, { restricted: 'no' }));
ok('restricted "no" drops the restricted row', !open.includes('nc') && open.includes('pub'), open);
const nc = fits(M.screen(cat, P, C, { restricted: 'yes' }));
ok('restricted "yes" keeps only it', J(nc) === '["nc"]', nc);
const all = M.screen(cat, P, C, {});
const ncRow = all.fits.find(x => x.id === 'nc'), moiRow = all.fits.find(x => x.id === 'moi'), pubRow = all.fits.find(x => x.id === 'pub');
ok('rows carry feeModel, restricted and notes', ncRow && ncRow.restricted === true && pubRow.feeModel === 'package' && all.fits.find(x => x.id === 'priv').feeModel === 'free', J(all.fits.map(x => [x.id, x.feeModel, x.restricted])));
ok('  · the MOI row fits an IELTS 6.5 student and says why', moiRow && moiRow.notes.includes('clears via MOI letter'), J(moiRow));
const askRow = M.screen([row('q', { reqs: { greQuant: 160 } })], Object.assign({}, P, { a_test: 'GRE', a_score: '320' }), C, {}).near[0] || {};
ok('an unanswered section is asked for in words', (M.screen([row('q', { reqs: { greQuant: 160 } })], Object.assign({}, P, { a_test: 'GRE', a_score: '320' }), C, {}).fits[0] || askRow).ask.includes('GRE section scores'));

/* partsFor reads the packages block. */
const content = { packages: { items: [
  { id: 'a', active: true, unlocks: 5, matches: 5 }, { id: 'b', active: true, unlocks: 3, matches: 3 },
  { id: 'c', active: false, unlocks: 9, matches: 9 }, { id: 'd', active: true, unlocks: 0, matches: 4 },
] }, services: { items: [{ id: 's', active: true, matches: 10 }, { id: 't', active: true, matches: 0 }] } };
const parts = M.partsFor(content);
ok('partsFor: the biggest public promise, ignoring inactive', parts[0].kind === 'public' && parts[0].count === 5, J(parts));
ok('  · and the biggest private one across packages and services', parts[1].kind === 'private' && parts[1].count === 10, J(parts));
ok('  · 3/10 when the content has nothing', J(M.partsFor(null)) === J([{ kind: 'public', count: 3 }, { kind: 'private', count: 10 }]));

/* G. The seventeen fields. */
ok('"civil engineering" is its own field now', [...M.fieldsWanted('B.E. Civil Engineering').direct].includes('Civil & Construction Engineering'));
ok('"pharmacy" files under Pharmacy', [...M.fieldsWanted('B.Pharm').direct].includes('Pharmacy & Pharmaceutical Sciences'));
ok('normField maps the catalogue\'s older names', M.normField('architecture') === 'Architecture, Urban Planning & Built Environment' && M.normField('logistics') === 'Supply Chain, Logistics & Operations');
ok('a civil programme is related to a mechanical student, not foreign',
  M.relevance({ program: 'Structural Engineering MSc', field: 'Civil & Construction Engineering' }, M.wants({ g_field: 'Mechanical Engineering' })) >= 2);

/* J. Held picks: the reasons, the rows, the task. */
const prof = Object.assign({}, P);
ok('a clear-cut programme has no hold reason', M.holdReasons(row('x'), prof).length === 0);
ok('a restricted one is held, in words', /Restricted admission/.test(M.holdReasons(row('x', { reqs: { restricted: true } }), prof).join()), J(M.holdReasons(row('x', { reqs: { restricted: true } }), prof)));
ok('an MOI-only clear is held', /MOI letter/.test(M.holdReasons(row('x', { reqs: { ieltsMin: 7, moiAccepted: true } }), prof).join()));
ok('an unanswered requirement is held', /Not yet confirmed: German level/.test(M.holdReasons(row('x', { reqs: { germanLevel: 'B1' } }), prof).join()));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g153-'));
const db = STORE.open(dir);
const sid = (db.createStudent('held153@ex.example', 'Held Student', '', 'h', 's', 'student', '') || {}).id;
if (sid) {
  const st = db.studentById(sid);
  db.addShortlist(sid, row('open1', { program: 'Open MSc' }), 'matched');
  ok('a held row goes in', db.addHeld(sid, row('nc1', { program: 'Ranked MSc' }), 'Restricted admission — ranked, limited places') === true);
  ok('  · and is NOT on the shortlist', db.getShortlist(sid).map(r => r.prog_id).join() === 'open1', db.getShortlist(sid).map(r => r.prog_id));
  ok('  · but is in the held list, with its reason', db.getHeld(sid).length === 1 && /Restricted/.test(db.getHeld(sid)[0].hold_reason), J(db.getHeld(sid)));
  ok('holding a programme already on the list is refused', db.addHeld(sid, row('open1'), 'x') === false && db.getShortlist(sid).length === 1);
  const task = T.holdReview(db, st, 1);
  ok('one review task, due in two days', task && task.task_key === 'held-review' && /Review 1 held programme for/.test(task.title)
    && task.due_at > new Date().toISOString().slice(0, 10), J(task));
  const again = T.holdReview(db, st, 2);
  ok('  · a second delivery updates the count, no second task', again.id === task.id && /Review 2 held programmes/.test(again.title)
    && db.tasksFor(sid).filter(t => t.task_key === 'held-review').length === 1, J(db.tasksFor(sid)));
  const rel = db.releaseHeld(sid, 'nc1');
  ok('release moves it to matched', rel && rel.added_by === 'matched' && db.getShortlist(sid).length === 2 && db.getHeld(sid).length === 0, J(rel));
  ok('  · releasing what is not held is a no-op', db.releaseHeld(sid, 'open1') === null);
  T.holdReview(db, st, 0);
  ok('  · and the task closes with the last one', db.tasksFor(sid).find(t => t.task_key === 'held-review').status === 'done');
} else {
  ok('a student could be created for the store checks', false, 'no addStudent');
}
try { db.close && db.close(); } catch (e) {}

/* The delivery end to end, when a server is up. */
const BASE = process.env.BASE || 'http://localhost:8099';
const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.153.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] }; if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text };
}
(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health').catch(() => fetch(BASE + '/'))).status < 500; } catch (e) { up = false; }
  if (!up) {
    console.log('  (no server on ' + BASE + ' — the delivery checks were skipped; run ./srv.sh 8099 first to include them)');
  } else {
    const st = Date.now().toString(36);
    await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    const mk = async (id, o) => {
      const r = await req('a', 'PUT', '/api/staff/programme', Object.assign({
        id: id + st, country: 'DE', level: 'master', field: 'Other', isPublic: true, feeModel: 'package',
        totalInr: 0, intakes: [{ season: 'winter', deadline: '2027-07-15' }],
      }, o));
      if (r.status >= 300) console.log('    (could not create ' + id + ': ' + r.status + ' ' + r.text.slice(0, 120) + ')');
      return id + st;
    };
    /* A word nobody else uses, per run, so a reused database cannot hand this
       student last run's programmes. */
    const W = 'Haruspicy' + st;
    const OPEN = await mk('hzA', { program: W + ' Open MSc', university: W + ' A University' });
    const NC = await mk('hzB', { program: W + ' Ranked MSc', university: W + ' B University', reqs: { restricted: true } });
    const email = 'h' + st + '@ex.example';
    let r = await req('s', 'POST', '/api/orders', { name: 'Held Student', email, phone: '+919000015301', acceptedTerms: true, packageId: 'pkg-three-public' });
    ok('an order for Public University Unlock is placed', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
    await req('s', 'POST', '/api/auth/change', { password: 'held-' + st + '-password' });
    const profile = { fullName: 'Held Student', d_course: 'B.Sc ' + W, d_dur: '4 years', d_cgpa: '8.5', d_max: '10', d_pass: '4',
      e_test: 'IELTS', e_score: '7', w_has: 'No', g_level: "Master's", g_field: W, g_country: 'Germany', b_total: 'Above ₹40 Lakhs' };
    await req('s', 'PUT', '/api/profile', { profile });
    let s = (await req('s', 'GET', '/api/state')).body;
    const ids = (s.shortlist || []).map(x => x.id);
    ok('the open programme is delivered', ids.includes(OPEN), ids.join(','));
    ok('the restricted one is NOT on the student\'s list', !ids.includes(NC), ids.join(','));
    ok('  · the dashboard counts it as held', s.matched && s.matched.held === 1 && s.matched.delivered === 1, J(s.matched));
    ok('  · and the thread says so without naming it', (s.msgs || []).some(m => /being checked by your counsellor/.test(m.t) && !/B University/.test(m.t)));
    const sidHttp = s.user && s.user.id;
    let c = (await req('a', 'GET', '/api/staff/student/' + sidHttp)).body;
    ok('the counsellor sees the held row with its reason', (c.held || []).length === 1 && c.held[0].id === NC && /Restricted/.test(c.held[0].reason), J(c.held));
    const tks = ((await req('a', 'GET', '/api/staff/student/' + sidHttp + '/tasks')).body.tasks || []).filter(t => (t.key || t.task_key) === 'held-review');
    ok('  · one held-review task is open for them, due in two days', tks.length === 1 && /Review 1 held programme/.test(tks[0].title) && tks[0].status === 'open', J(tks));
    r = await req('a', 'POST', '/api/staff/student/' + sidHttp + '/shortlist/' + encodeURIComponent(NC) + '/release', {});
    ok('release answers 200', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
    ok('  · the held list is empty', (r.body.held || []).length === 0, J(r.body.held));
    s = (await req('s', 'GET', '/api/state')).body;
    ok('  · and the student now sees it as matched', (s.shortlist || []).some(x => x.id === NC && x.addedBy === 'matched') && s.matched.held === 0, J(s.shortlist));
    ok('  · a second release is a 404', (await req('a', 'POST', '/api/staff/student/' + sidHttp + '/shortlist/' + encodeURIComponent(NC) + '/release', {})).status === 404);

    /* D. The no-match lead. */
    r = await req('v', 'POST', '/api/assist', { name: 'Nomatch Visitor', phone: '9000015302', email: 'nm' + st + '@ex.example',
      consent: 'yes', country: 'Germany', note: 'Any route at all', filters: { country: 'DE', level: 'master', field: 'Haruspicy', ielts: 5 } });
    ok('/api/assist takes a lead', r.status === 200 && r.body.ok === true, r.status + ' ' + r.text.slice(0, 120));
    const leads = (await req('a', 'GET', '/api/staff/leads')).body;
    const lead = (leads.leads || leads.enquiries || leads.items || []).find(l => l.email === 'nm' + st + '@ex.example');
    ok('  · filed under source no-match with the filters in the note', lead && lead.source === 'no-match' && /Special assistance/.test(lead.note || '') && /Haruspicy/.test(lead.note || ''), J(lead));
    r = await req('v', 'POST', '/api/assist', { name: 'Nomatch Visitor', phone: '123', email: 'bad', consent: 'yes' });
    ok('  · with the enquiry form\'s validation', r.status === 422, r.status);
  }
  console.log('round153test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
