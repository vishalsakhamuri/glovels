/*
 * Round 165 — the ranking rule, proved on the real German catalogue.
 *
 * Vishal: "for computer science and a CGPA we have 30 unis; the student
 * selected a 3-uni, 5-uni or 10-uni package; based on the secondary filters
 * (GRE, language, top 10%) we rank the unis and show the best top 3 / 5 / 10;
 * the counsellor sees the ranking order for all 30 and can suggest changes —
 * add or replace — later; other secondary filters only rank, they never drop."
 *
 * Codified in patch 161: country + level + field + CGPA decide the SET; GRE,
 * German, top %, bachelor subject/length, IELTS, work experience and papers
 * only PRIORITISE (rank lower, never drop); only a higher CGPA bar hides a
 * row; the student sees the best N by package; the counsellor sees all and
 * can swap.
 *
 * Needs a server on BASE (default 8097) loaded with the live German catalogue
 * (see the note in the report for patch 165: live-DE.xlsx with the id column
 * stripped, then glovels-germany-v37-new-rows.xlsx). On a near-empty database
 * the SET is too small and the first check says so.
 *
 * Run: cd tests && bash srv.sh 8097 && <load the sheets> && node round165test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const M = require(path.join(__dirname, '..', 'server', 'matches.js'));
const TAGS = require(path.join(__dirname, '..', 'server', 'tags.js'));

const BASE = process.env.BASE || 'http://localhost:8097';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const J = x => JSON.stringify(x);
const note = s => console.log('    · ' + s);

/* One cookie jar and one client address per actor — ten orders an hour per
   address is the server's flood rule. */
const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.165.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] }; if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text };
}

/* The student: Germany, master's, Computer Science & IT, 8.2/10, IELTS 6.5,
   no GRE, no German, a four-year bachelor's, no budget ceiling. */
const BASE_PROFILE = {
  d_course: 'B.Tech Computer Science', d_dur: '4 years', d_cgpa: '8.2', d_max: '10', d_pass: '4',
  e_test: 'IELTS', e_score: '6.5', a_test: 'Not taken yet', g_german: 'None yet', w_has: 'No',
  g_level: "Master's", g_field: 'Computer Science & IT', g_country: 'Germany', b_total: 'Above ₹40 Lakhs',
};
const STRONG = Object.assign({}, BASE_PROFILE, { a_test: 'GRE', a_score: '320', a_quant: '165', g_german: 'B1', d_top: '10' });
const WEAK = Object.assign({}, BASE_PROFILE, { d_dur: '3 years' });
const LOW = Object.assign({}, BASE_PROFILE, { d_cgpa: '6.0' });

const uniOrder = rows => { const out = []; rows.forEach(r => { if (!out.includes(r.university)) out.push(r.university); }); return out; };
/* Round 177 (item 8): a row short of a stated requirement the student
   answered (IELTS, GRE, ECTS, German, work…) is no longer a "fit" — it is a
   NEAR row carrying `hard`, the reason first, ranked below every fit. It is
   still in the SET (owner's rule: country + level + field + CGPA decide the
   set; everything else only ranks), so this suite reads the set as the fits
   followed by the near rows whose only reasons are hard misses — the order
   pick() fills a package in — and counts a hard miss as "ranked lower". */
const hardOnly = n => (n.hard || []).length && (n.why || []).length === n.hard.length;
const asSet = r => {
  const b = r.body || {};
  if (Array.isArray(b.fits)) {
    const extra = (b.near || []).filter(hardOnly);
    b.fits = b.fits.concat(extra);
    b.near = (b.near || []).filter(n => !hardOnly(n)).map(n => Object.assign({}, n, { why: (n.why || []).slice(0, (n.why || []).length - (n.hard || []).length) }));
    if (b.counts) { b.counts.fits = (b.counts.fits || 0) + extra.length; b.counts.near = Math.max(0, (b.counts.near || 0) - extra.length); }
  }
  return r;
};
const tier = r => ((r.hard && r.hard.length) || (r.soft && r.soft.length)) ? 'soft' : (r.ask && r.ask.length) ? 'ask' : 'clear';
/* 2,000 (the server's cap), not 500: the hard-miss rows of the set travel
   in near[], which also holds every row the grade bar turns away. */
const fitPost = (profile, filters) => req('a', 'POST', '/api/staff/fit', { profile, filters: Object.assign({ limit: 2000, kind: 'any' }, filters || {}) }).then(asSet);
const fitGet = (who, sid, q) => req(who, 'GET', '/api/staff/student/' + sid + '/fit?limit=2000' + (q ? '&' + q : '')).then(asSet);
const visible = s => (s.shortlist || []).filter(r => r.addedBy !== 'student');

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ')'); return done(); }
  const st = Date.now().toString(36);
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.status === 200, r.status);

  /* ------------------------------------------------------------ 1. the SET */
  const total0 = Number((await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.total || 0);
  if (total0 < 1000) {
    /* A fresh database (the seed's 171 rows): load the German catalogue
       first — the rule is about a set of the live size. R165_SHEETS is a
       ';'-joined list of .xlsx/.csv files in the catalogue export format
       (rows without an id are added); the defaults are the live German
       sheet with its id column stripped and the v37 new-rows sheet. */
    const sheets = (process.env.R165_SHEETS || [SHOTS + '/r165/live-DE-noid.xlsx', SHOTS + '/out/glovels-germany-v37-new-rows.xlsx'].join(';')).split(';').filter(f => f && fs.existsSync(f));
    if (!sheets.length) console.log('  (the catalogue is nearly empty and no sheet to load was found — set R165_SHEETS)');
    for (const f of sheets) {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const up = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a, 'x-forwarded-for': ips.a }, body: fd });
      const t = await up.text();
      note('loaded ' + path.basename(f) + ': ' + up.status + ' ' + t.slice(0, 120));
    }
  }
  r = await fitPost(BASE_PROFILE);
  const base = r.body;
  const N_all = (base.fits || []).length;
  const unisAll = uniOrder(base.fits || []);
  const pubFits = (base.fits || []).filter(x => x.isPublic);
  const unisPub = uniOrder(pubFits);
  ok('the SET for Germany · master · CS&IT · 8.2 is bigger than 10 (N_all = ' + N_all + ' programmes at ' + unisAll.length + ' universities)', N_all > 10, J(base.counts));
  note(pubFits.length + ' public programmes at ' + unisPub.length + ' public universities; ' + (N_all - pubFits.length) + ' private');
  note('tiers: ' + J((base.fits || []).reduce((m, x) => (m[tier(x)] = (m[tier(x)] || 0) + 1, m), {})) + ' · relevance: ' + J((base.fits || []).reduce((m, x) => (m[x.relevance] = (m[x.relevance] || 0) + 1, m), {})));
  ok('the three rows the set turns away are visa or grade reasons only, never a secondary requirement',
    (base.near || []).every(x => x.why.every(w => /visa|CGPA|German \d/.test(w))), J((base.near || []).map(x => x.why)));
  /* The same set through the public finder's path: /api/catalogue rows (names
     withheld on locked rows) through the same screen(). */
  const cat = (await req('v', 'GET', '/api/catalogue')).body;
  const pubScreen = M.screen(cat.programmes || [], BASE_PROFILE, cat.countries || {}, { limit: 500 });
  ok('the public finder path (/api/catalogue + screen) gives a set over 10 as well (' + pubScreen.fits.length + ')', pubScreen.fits.length > 10, J(pubScreen.counts));
  note('finder-path set ' + pubScreen.fits.length + ' vs staff set ' + N_all + ' (locked rows carry no programme name, so word matches in the title differ)');

  /* --------------------------------------------- 2. three packages, best N */
  const PKGS = [['pkg-three-public', 3, 's3'], ['pkg-roadmap', 5, 's5'], ['pkg-offer', 10, 's10']];
  const students = {};
  const autoPub = ((base.auto || []).find(a => a.kind === 'public') || { picks: [] }).picks.map(p => p.id);
  const heldIds = async who => ((await req('a', 'GET', '/api/staff/student/' + students[who].id)).body.held || []).map(h => String(h.id));
  for (const [pkgId, n, who] of PKGS) {
    const email = who + '-' + st + '@ex.example';
    r = await req(who, 'POST', '/api/orders', { name: 'Rank ' + who, email, phone: '+9190001650' + (n < 10 ? '0' + n : n), acceptedTerms: true, packageId: pkgId });
    ok(pkgId + ': the order is placed', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
    await req(who, 'POST', '/api/auth/change', { password: who + '-' + st + '-password' });
    r = await req(who, 'PUT', '/api/profile', { profile: Object.assign({ fullName: 'Rank ' + who }, BASE_PROFILE) });
    ok('  · the profile saves and the matcher runs', r.status === 200 && r.body.matched, r.status + ' ' + r.text.slice(0, 160));
    const s = (await req(who, 'GET', '/api/state')).body;
    students[who] = { id: s.user.id, n, email, pkgId };
    const list = visible(s);
    const held = await heldIds(who);
    const want = Math.min(unisPub.length, n);
    ok('  · the package picks exactly ' + want + ' universities (' + list.length + ' named now + ' + held.length + ' held for the counsellor\'s review)',
      list.length + held.length === want && (s.matched || {}).held === held.length, list.length + '+' + held.length + '; matched=' + J(s.matched));
    ok('  · every named one is public and a different university', list.every(x => x.university && x.isPublic) && new Set(list.map(x => x.university)).size === list.length, J(list.map(x => x.university)));
    ok('  · the ' + want + ' are the first ' + n + ' of the matcher\'s ranking for this profile', J(list.map(x => x.id).concat(held).sort()) === J(autoPub.slice(0, n).slice().sort()), J(list.map(x => x.university)) + ' + held ' + J(held) + ' vs ' + J(autoPub.slice(0, n)));
    ok('  · the named ones keep the ranking order', J(list.map(x => x.id)) === J(autoPub.slice(0, n).filter(id => !held.includes(String(id)))));
    ok('  · the rest of the ' + unisPub.length + ' are not on the list — absent, not locked; the student sees only a count of held ones', (s.matched || {}).owed === n && (s.matched || {}).delivered === list.length && !list.some(x => !x.university), J(s.matched));
    ok('  · the thread tells them about the held one(s) without a name', !held.length || (s.msgs || []).some(m => /being checked by your counsellor/.test(m.t) && !/BHT|Berliner/.test(m.t)), (s.msgs || []).slice(-1).map(m => m.t.slice(0, 160)).join());
    note(pkgId + ' → ' + list.map((x, i) => (i + 1) + '. ' + x.university).join(' · ') + (held.length ? ' · HELD: ' + held.map(h => (pubFits.find(x => String(x.id) === h) || {}).university + ' (' + ((s.matched || {}).held) + ')').join(', ') : ''));
  }
  const S5 = students.s5, S10 = students.s10, S3 = students.s3;
  note('held reason on the #1 pick: ' + J(((await req('a', 'GET', '/api/staff/student/' + S5.id)).body.held || []).map(h => h.university + ': ' + h.reason)));

  /* ------------------------------- 3. secondary filters re-rank, never drop
     On the 10-student, so the 5-student's list stays as delivered for the
     counsellor and the screens. */
  const idsOf = x => (x.fits || []).map(y => y.id);
  const baseFit = (await fitGet('a', S10.id)).body;
  ok('the counsellor\'s fit for the 10-student is the same set (' + idsOf(baseFit).length + ')', idsOf(baseFit).length === N_all, idsOf(baseFit).length);
  const before10 = visible((await req('s10', 'GET', '/api/state')).body).map(x => x.id);

  r = await req('s10', 'PUT', '/api/profile', { profile: STRONG });
  ok('GRE 320 (Q165), German B1, top 10% saves', r.status === 200, r.text.slice(0, 160));
  const strongFit = (await fitGet('a', S10.id)).body;
  ok('  · the SET is unchanged (' + idsOf(strongFit).length + ')', idsOf(strongFit).length === N_all, idsOf(strongFit).length + ' vs ' + N_all);
  ok('  · the same rows — nothing new, nothing gone', J(idsOf(strongFit).slice().sort()) === J(idsOf(baseFit).slice().sort()));
  ok('  · but the ORDER changes', J(idsOf(strongFit)) !== J(idsOf(baseFit)));
  const strongTiers = (strongFit.fits || []).reduce((m, x) => (m[tier(x)] = (m[tier(x)] || 0) + 1, m), {});
  ok('  · more rows are cleared outright, fewer ranked lower', (strongTiers.soft || 0) < (baseFit.fits || []).filter(x => tier(x) === 'soft').length, J(strongTiers));
  const autoStrong = ((strongFit.auto || []).find(a => a.kind === 'public') || { picks: [] }).picks.map(p => p.university);
  const autoBase = ((baseFit.auto || []).find(a => a.kind === 'public') || { picks: [] }).picks.map(p => p.university);
  ok('  · what the package would deliver is a different top list', J(autoStrong.slice(0, 5)) !== J(autoBase.slice(0, 5)), J(autoStrong.slice(0, 5)));
  note('base top 5: ' + autoBase.slice(0, 5).join(' · '));
  note('strong top 5: ' + autoStrong.slice(0, 5).join(' · '));
  let s10 = (await req('s10', 'GET', '/api/state')).body;
  let held10 = await heldIds('s10');
  ok('  · the student still has 10 (' + visible(s10).length + ' named + ' + held10.length + ' held)', visible(s10).length + held10.length === 10, visible(s10).length + '+' + held10.length);
  note('student list ' + (J(visible(s10).map(x => x.id)) === J(before10) ? 'UNCHANGED' : 'changed') + ' after the stronger profile (a re-pick prefers the picks already shown, +25)');

  r = await req('s10', 'PUT', '/api/profile', { profile: WEAK });
  ok('no GRE and a 3-year bachelor\'s saves', r.status === 200, r.text.slice(0, 160));
  const weakFit = (await fitGet('a', S10.id)).body;
  ok('  · still the whole SET (' + idsOf(weakFit).length + ') — a shortfall never drops a row', idsOf(weakFit).length === N_all, idsOf(weakFit).length);
  /* Round 177: a stated requirement they fall short of is in hard[] (and
     first in why[]); the bachelor's subject stays in soft[]. */
  const softRows = (weakFit.fits || []).filter(x => (x.hard || []).length || x.soft.length);
  ok('  · rows short of a stated requirement carry it in hard[] / soft[] (' + softRows.length + ')', softRows.length > 0 && softRows.some(x => (x.hard || []).concat(x.soft).some(w => /bachelor|GRE|ECTS/i.test(w))) && softRows.filter(x => (x.hard || []).length).every(x => x.why[0] === x.hard[0]), J(softRows.slice(0, 2).map(x => (x.hard || []).concat(x.soft))));
  /* Within one relevance tier a shortfall sinks below every cleared row.
     Across tiers the subject's closeness comes first — a CS programme short
     on ECTS still ranks above a related-field one that clears everything. */
  let bad = null;
  for (const rel of [3, 2]) {
    const rows = (weakFit.fits || []).filter(x => x.relevance === rel);
    const firstSoft = rows.findIndex(x => tier(x) === 'soft');
    const lastClear = rows.map(tier).lastIndexOf('clear');
    if (firstSoft >= 0 && lastClear > firstSoft) bad = 'rel ' + rel + ': soft at ' + firstSoft + ', clear at ' + lastClear;
  }
  ok('  · within a relevance tier every shortfall ranks below every cleared row', !bad, bad);
  note('first soft row overall at index ' + (weakFit.fits || []).findIndex(x => x.soft.length) + ' of ' + N_all);
  s10 = (await req('s10', 'GET', '/api/state')).body; held10 = await heldIds('s10');
  ok('  · the student still has 10 (' + visible(s10).length + ' named + ' + held10.length + ' held)', visible(s10).length + held10.length === 10, visible(s10).length + '+' + held10.length);

  /* ------------------------------------------------- 4. only the CGPA drops
     On the 3-student. */
  const fit3 = (await fitGet('a', S3.id)).body;
  r = await req('s3', 'PUT', '/api/profile', { profile: LOW });
  ok('CGPA 6.0 saves', r.status === 200, r.text.slice(0, 160));
  const lowFit = (await fitGet('a', S3.id)).body;
  ok('  · the SET shrinks (' + idsOf(lowFit).length + ' of ' + N_all + ')', idsOf(lowFit).length < N_all, idsOf(lowFit).length);
  ok('  · the rows that vanished are held by the CGPA / German-grade bar and nothing else',
    (lowFit.near || []).length > 0 && (lowFit.near || []).every(x => x.why.length === 1 && /CGPA|German \d|visa/.test(x.why[0])), J((lowFit.near || []).slice(0, 3).map(x => x.why)));
  ok('  · every row left is one the student clears on grade', idsOf(lowFit).every(id => idsOf(fit3).includes(id)));
  let s3 = (await req('s3', 'GET', '/api/state')).body;
  let held3 = await heldIds('s3');
  note('student list at CGPA 6.0: ' + visible(s3).map(x => x.university).join(' · ') + ' + ' + held3.length + ' held; matched=' + J(s3.matched));
  ok('  · the student\'s picks are re-made from what is left', visible(s3).every(x => idsOf(lowFit).includes(x.id)) && visible(s3).length + held3.length === 3, J(visible(s3).map(x => x.university)));
  /* Back to 8.2: does the student get the best three back? */
  r = await req('s3', 'PUT', '/api/profile', { profile: BASE_PROFILE });
  s3 = (await req('s3', 'GET', '/api/state')).body; held3 = await heldIds('s3');
  ok('back at 8.2 the student has 3 again (' + visible(s3).length + ' + ' + held3.length + ' held)', visible(s3).length + held3.length === 3, visible(s3).length + '+' + held3.length);
  ok('  · and they are the best 3 for 8.2 again, not the 6.0 picks carried over', J(visible(s3).map(x => x.id).concat(held3).sort()) === J(autoPub.slice(0, 3).slice().sort()),
    J(visible(s3).map(x => x.university)) + ' — a re-pick prefers what is already on the list (+25), so picks made for a weaker profile stay when the profile improves');

  /* ---------------------------------------------- 5. the counsellor's view */
  r = await req('a', 'POST', '/api/staff/people', { name: 'Ranking Counsellor', email: 'rank-' + st + '@glovels.com', role: 'counsellor' });
  ok('a counsellor is created', r.status === 200 && r.body.person, r.text.slice(0, 160));
  const cEmail = r.body.person && r.body.person.email, cPass = r.body.password, cId = r.body.person && r.body.person.id;
  r = await req('a', 'PUT', '/api/staff/student/' + S5.id + '/counsellor', { counsellorId: cId });
  ok('  · and assigned the 5-student', r.status === 200, r.text.slice(0, 160));
  await req('c', 'POST', '/api/auth/login', { email: cEmail, password: cPass });
  r = await req('c', 'POST', '/api/auth/change', { current: cPass, password: 'rank-' + st + '-chose-this' });
  ok('  · signs in', r.status === 200, r.text.slice(0, 120));
  const cFit = (await fitGet('c', S5.id)).body;
  ok('the counsellor sees ALL ' + N_all + ' rows for the student', idsOf(cFit).length === N_all, idsOf(cFit).length);
  ok('  · in the same order the admin\'s matcher gives for this profile', J(idsOf(cFit)) === J(idsOf(base)));
  const cPub = (await fitGet('c', S5.id, 'kind=public')).body;
  let s5 = (await req('s5', 'GET', '/api/state')).body;
  let held5 = await heldIds('s5');
  const cFile = (await req('c', 'GET', '/api/staff/student/' + S5.id)).body;
  ok('  · the file shows the held pick with its reason', (cFile.held || []).length === held5.length && (cFile.held || []).every(h => h.reason), J(cFile.held));
  ok('  · the student\'s 5 (named + held) are the first 5 universities of the counsellor\'s public ranking',
    J(visible(s5).map(x => x.university).concat((cFile.held || []).map(h => h.university)).sort()) === J(uniOrder(cPub.fits || []).slice(0, 5).slice().sort()),
    J(visible(s5).map(x => x.university)) + ' + held ' + J((cFile.held || []).map(h => h.university)) + ' vs ' + J(uniOrder(cPub.fits || []).slice(0, 5)));
  ok('  · onList marks the named ones', J((cFit.onList || []).slice().sort()) === J(visible(s5).map(x => x.id).sort()), J(cFit.onList));
  ok('  · each row has a position (the list order is the rank; no rank number is sent)', (cFit.fits || []).length > 0 && !(cFit.fits || [])[0].rank, (cFit.fits || [])[0] && Object.keys((cFit.fits || [])[0]).join(','));
  /* Release the held one: the student should now see the full five, in rank order. */
  for (const h of held5) {
    r = await req('c', 'POST', '/api/staff/student/' + S5.id + '/shortlist/' + encodeURIComponent(h) + '/release', {});
    ok('  · the counsellor releases the held #1 pick', r.status === 200, r.text.slice(0, 120));
  }
  s5 = (await req('s5', 'GET', '/api/state')).body;
  ok('  · the student now sees all 5 named', visible(s5).length === 5 && (s5.matched || {}).held === 0, visible(s5).length + ' matched=' + J(s5.matched));
  ok('  · in the ranking order (released #1 first)', J(visible(s5).map(x => x.university)) === J(uniOrder(cPub.fits || []).slice(0, 5)),
    J(visible(s5).map(x => x.university)) + ' — release stamps added_at = now, and the list is ordered by added_at before rank, so the released top pick lands last');

  /* The swap: take the last off, put the 6th on. */
  const studentIds = () => visible(s5).map(x => x.id);
  const fifth = visible(s5)[visible(s5).length - 1];
  const next = uniOrder(cPub.fits || []).slice(5).map(u => (cPub.fits || []).find(x => x.university === u)).find(x => !studentIds().includes(x.id));
  r = await req('c', 'DELETE', '/api/staff/student/' + S5.id + '/shortlist/' + encodeURIComponent(fifth.id));
  ok('swap: the counsellor takes one off (' + fifth.university + ')', r.status === 200, r.status);
  r = await req('c', 'POST', '/api/staff/student/' + S5.id + '/shortlist', { id: next.id });
  ok('  · and puts #6 (' + next.university + ') on', r.status === 200, r.text.slice(0, 120));
  s5 = (await req('s5', 'GET', '/api/state')).body;
  let l5 = visible(s5);
  ok('  · the student still sees 5', l5.length === 5, l5.length);
  ok('  · with the replacement and without the removed one', l5.some(x => x.id === next.id) && !l5.some(x => x.id === fifth.id), J(l5.map(x => x.university)));
  ok('  · the replacement is marked as the office\'s choice, the rest as matched', (l5.find(x => x.id === next.id) || {}).addedBy === 'office' && l5.filter(x => x.addedBy === 'matched').length === 4, J(l5.map(x => x.addedBy)));
  ok('  · the student is told, by name', (s5.msgs || []).concat((s5.activity || [])).some(m => /I have taken/.test(m.t) && m.t.includes(fifth.university)) && (s5.msgs || []).concat((s5.activity || [])).some(m => /I have added/.test(m.t) && m.t.includes(next.university)));
  /* A profile save re-runs the matcher: the swap must survive it. */
  await req('s5', 'PUT', '/api/profile', { profile: BASE_PROFILE });
  s5 = (await req('s5', 'GET', '/api/state')).body; l5 = visible(s5); held5 = await heldIds('s5');
  ok('  · a profile save keeps the swap — 5 rows, the removed one stays off, the office\'s stays on', l5.length === 5 && held5.length === 0 && !l5.some(x => x.id === fifth.id) && l5.some(x => x.id === next.id), J(l5.map(x => x.university + '/' + x.addedBy)) + ' held ' + J(held5));
  /* An add beyond N. */
  const seventh = uniOrder(cPub.fits || []).slice(5).map(u => (cPub.fits || []).find(x => x.university === u)).find(x => x.id !== next.id && !l5.some(y => y.id === x.id) && x.id !== fifth.id);
  r = await req('c', 'POST', '/api/staff/student/' + S5.id + '/shortlist', { id: seventh.id });
  s5 = (await req('s5', 'GET', '/api/state')).body;
  const l6 = visible(s5);
  ok('an add beyond the package (a 6th) answers 200', r.status === 200, r.status);
  note('after a 6th: the student sees ' + l6.length + ' rows (' + l6.map(x => x.addedBy).join(',') + '); matched=' + J(s5.matched));
  ok('  · the student sees it — the package is a floor, not a cap, when the counsellor adds by hand', l6.length === 6 && l6.some(x => x.id === seventh.id), l6.length);
  await req('s5', 'PUT', '/api/profile', { profile: BASE_PROFILE });
  s5 = (await req('s5', 'GET', '/api/state')).body;
  ok('  · and a profile save does not trim it back to 5 (' + visible(s5).length + ')', visible(s5).length === 6, J(visible(s5).map(x => x.university + '/' + x.addedBy)));
  /* Back to five for the screenshots. */
  await req('c', 'DELETE', '/api/staff/student/' + S5.id + '/shortlist/' + encodeURIComponent(seventh.id));
  s5 = (await req('s5', 'GET', '/api/state')).body;
  note('taking the 6th off again leaves ' + visible(s5).length + ' (the save above let the machine drop one of its own to make room for the hand-add)');
  await req('s5', 'PUT', '/api/profile', { profile: BASE_PROFILE });
  s5 = (await req('s5', 'GET', '/api/state')).body;
  ok('  · and a save tops the list back up to 5', visible(s5).length === 5, J(visible(s5).map(x => x.university + '/' + x.addedBy)));

  /* ------------------------------------------------------- 6. tags in the mix */
  const TAG = 'No German Required';
  const tagFit = (await fitGet('c', S5.id, 'tags=' + encodeURIComponent(TAG))).body;
  ok('the matcher with tags=' + TAG + ' narrows (' + idsOf(tagFit).length + ' of ' + N_all + ')', idsOf(tagFit).length > 0 && idsOf(tagFit).length < N_all, idsOf(tagFit).length);
  ok('  · to a subset of the SET', idsOf(tagFit).every(id => idsOf(base).includes(id)));
  /* Locked rows come out of /api/catalogue under stand-in ids, so the real
     ids are checked against the staff index of rows carrying the tag. */
  const staffRows = [];
  for (let pg = 1; pg < 10; pg++) {
    const b = (await req('a', 'GET', '/api/staff/catalogue?per=2000&page=' + pg + '&status=')).body;
    (b.programmes || []).forEach(x => staffRows.push(x));
    if (staffRows.length >= (b.total || 0) || !(b.programmes || []).length) break;
  }
  const staffById = new Map(staffRows.map(x => [String(x.id), x]));
  ok('  · every row carries the tag (stored or derived)', idsOf(tagFit).every(id => staffById.get(String(id)) && TAGS.match(staffById.get(String(id)), [TAG], '')), idsOf(tagFit).filter(id => !(staffById.get(String(id)) && TAGS.match(staffById.get(String(id)), [TAG], ''))).slice(0, 3));
  const carry = staffRows.filter(x => TAGS.match(x, [TAG], '')).length;
  const indexed = (await req('a', 'GET', '/api/staff/catalogue?tags=' + encodeURIComponent(TAG) + '&per=1&status=')).body.total;
  ok('  · the staff list\'s ?tags= count agrees with the rows that carry it (' + indexed + ' vs ' + carry + ' of ' + staffRows.length + ')', indexed === carry,
    'GET /api/staff/catalogue?tags= reads at most 2,000 rows before filtering (server/api.js ~7895, per: 2000) — on a catalogue of ' + staffRows.length + ' rows the tail is never looked at');
  const byId = new Map((cat.programmes || []).map(p => [String(p.id), p]));
  ok('  · and keeps the ranking order of the full list', J(idsOf(tagFit)) === J(idsOf(base).filter(id => idsOf(tagFit).includes(id))));
  /* Round 176 (owner, go-live): the home page no longer holds the locked
     set — /api/catalogue carries at most 12 placeholders, and the finder
     asks /api/find/locked for the ones that fit its boxes as they change.
     So the home path with a tag is that endpoint: the rows for the SET with
     the tag are a subset of the rows without it, every one carries the tag,
     never more than 12 come back, and nothing in the answer is a count. */
  const lq = '/api/find/locked?country=DE&level=master&field=' + encodeURIComponent(BASE_PROFILE.g_field) + '&cgpa=8';
  const lockedAll = (await req('v', 'GET', lq)).body, lockedTag = (await req('v', 'GET', lq + '&tags=' + encodeURIComponent(TAG))).body;
  ok('the home finder path with the tag narrows too — /api/find/locked, capped at 12, every row carrying the tag, no count (' + (lockedTag.locked || []).length + ' of ≤12)',
    (lockedAll.locked || []).length > 0 && (lockedAll.locked || []).length <= 12 && (lockedTag.locked || []).length > 0 && (lockedTag.locked || []).length <= 12
    && lockedTag.locked.every(p => !p.university && TAGS.match(p, [TAG], '')) && lockedTag.total === undefined && typeof lockedTag.more === 'boolean' && Object.keys(lockedTag).every(k => k === 'locked' || k === 'more'),
    J({ all: (lockedAll.locked || []).length, tag: (lockedTag.locked || []).length, keys: Object.keys(lockedTag) }));
  void byId;
  r = await req('v', 'GET', '/api/catalogue?tags=' + encodeURIComponent(TAG));
  note('/api/catalogue?tags= returns ' + (r.body.programmes || []).length + ' rows (the home page filters tags in the browser with TAGS.match)');

  /* ------------------------------------------------------- 7. the screens */
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) {}
  if (!chromium) { console.log('  (no playwright — screen checks skipped)'); return done(); }
  const logos = (await req('v', 'GET', '/logos/index.json')).body;
  const browser = await chromium.launch();
  const sctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await sctx.request.post(BASE + '/api/auth/login', { data: { email: S5.email, password: 's5-' + st + '-password' } });
  const sp = await sctx.newPage();
  const errs = [];
  sp.on('pageerror', e => errs.push(String(e)));
  await sp.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await sp.waitForSelector('.sl-tbl tbody tr', { timeout: 8000 }).catch(() => {});
  await sp.waitForTimeout(800);
  const rows = await sp.$$eval('.sl-tbl tbody tr', trs => trs.map(tr => ({
    n: (tr.querySelector('.sl-n') || {}).textContent || '', uni: (tr.querySelector('td[data-l="University"]') || {}).textContent || '',
    imgs: tr.querySelectorAll('img').length })));
  ok('student screen: 5 cards', rows.length === 5, rows.length);
  ok('  · numbered 1–5, each a named university, in the list\'s order', rows.map(x => x.n).join() === '1,2,3,4,5' && rows.every(x => x.uni.trim()) && J(rows.map(x => x.uni.trim())) === J(visible(s5).map(x => x.university)), J(rows));
  const withLogo = visible(s5).filter(x => logos && logos.files && (logos.files[x.university] || Object.keys(logos.files).some(k => k.toLowerCase() === String(x.university).toLowerCase())));
  note(withLogo.length + ' of the 5 universities have a logo file in /logos/index.json by exact name');
  ok('  · a card shows the university\'s logo where one exists (img inside the row)', withLogo.length === 0 || rows.some(x => x.imgs > 0), 'no <img> in any row — the dashboard table draws the flag and the name only; logos (patch 165) are on the finder, Find University, the university page and the counsellor\'s matcher, not here');
  const bodyText = await sp.evaluate(() => document.body.innerText);
  ok('  · no "Showing X of N" — the student is not told how many were held back', !/Showing \d+ of \d+/i.test(bodyText) && !/of ' + N_all + '/.test(bodyText));
  ok('  · no page errors', errs.length === 0, errs.join(' | '));
  await sp.locator('.sl-tbl').scrollIntoViewIfNeeded().catch(() => {});
  await sp.waitForTimeout(300);
  await sp.screenshot({ path: path.join(SHOTS, 'r165-student.png'), fullPage: false });

  const cctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await cctx.request.post(BASE + '/api/auth/login', { data: { email: cEmail, password: 'rank-' + st + '-chose-this' } });
  const cp = await cctx.newPage();
  const cerrs = [];
  cp.on('pageerror', e => cerrs.push(String(e)));
  await cp.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await cp.waitForSelector('[data-open="' + S5.id + '"]', { timeout: 8000 }).catch(() => {});
  await cp.click('[data-open="' + S5.id + '"]');
  await cp.waitForTimeout(2000);
  await cp.click('.tab[data-t="file"]');
  await cp.waitForTimeout(800);
  const uniRows = await cp.$$eval('#uniList li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)));
  ok('counsellor screen: the student\'s list shows the 5', uniRows.length === 5, uniRows.length);
  await cp.click('#fitUni');
  await cp.waitForSelector('#gfOut ul li', { timeout: 15000 }).catch(() => {});
  await cp.waitForTimeout(1500);
  const fitHead = await cp.$$eval('#gfOut h4', hs => hs.map(h => h.textContent));
  const fitCount = (await cp.$$('#gfOut ul')).length ? await cp.$$eval('#gfOut ul >> nth=0 >> li', ls => ls.length) : 0;
  /* Round 177: the set is drawn across both lists — the fits, then under
     "Near — short of something they ask" the rows with a hard miss (each
     saying it first), beside the few the grade bar turns away. */
  const hardDrawn = (await cp.$$('#gfOut ul')).length > 1 ? await cp.$$eval('#gfOut ul >> nth=1 >> li', ls => ls.filter(l => /Near — short of something they ask:/.test(l.textContent)).length) : 0;
  /* What the API says for this student, raw: the fits, and every near row
     with a hard miss (a few of those are also under the grade bar, so
     outside the set — the panel marks them "Near" all the same). */
  const rawFit = (await req('c', 'GET', '/api/staff/student/' + S5.id + '/fit?limit=2000')).body;
  const rawHard = (rawFit.near || []).filter(x => (x.hard || []).length).length;
  ok('  · the matcher panel lists the whole set (' + N_all + ': ' + fitCount + ' fits + ' + hardDrawn + ' near on a stated requirement)', fitHead.some(h => /^Fits \(\d+/.test(h)) && fitHead.some(h => /^Near — short of something they ask \(\d+\)/.test(h))
    && fitCount === (rawFit.fits || []).length && hardDrawn === rawHard && idsOf(asSet({ body: rawFit }).body).length === N_all, J(fitHead) + ' rows=' + fitCount + '+' + hardDrawn + ' api=' + (rawFit.fits || []).length + '+' + rawHard);
  const firstFive = await cp.$$eval('#gfOut ul >> nth=0 >> li', ls => ls.slice(0, 12).map(l => (l.querySelector('.m b span') || l.querySelector('.m b') || {}).textContent || ''));
  const panelUnis = []; firstFive.forEach(u => { const t = u.replace(/Restricted$/, '').trim(); if (t && !panelUnis.includes(t)) panelUnis.push(t); });
  ok('  · in the ranking order the API gives', J(panelUnis.slice(0, 4)) === J(uniOrder(cFit.fits || []).slice(0, 4)), J(panelUnis.slice(0, 4)) + ' vs ' + J(uniOrder(cFit.fits || []).slice(0, 4)));
  note('student list order on screen: ' + visible(s5).map(x => x.university + '/' + x.addedBy).join(' · '));
  const numbered = await cp.evaluate(() => {
    const out = document.querySelector('#gfOut'); if (!out) return { ol: 0, nums: 0 };
    const ol = out.querySelectorAll('ol').length;
    const lis = [...out.querySelectorAll('ul li')].slice(0, 5);
    const nums = lis.filter(li => /^\s*#?\d+[.)]?\s/.test(li.textContent)).length;
    const style = lis[0] ? getComputedStyle(lis[0]).listStyleType : '';
    return { ol, nums, style };
  });
  ok('  · each row shows its rank number', numbered.ol > 0 || numbered.nums >= 5 || /decimal/.test(numbered.style), 'no ordinal on the rows — the list is in rank order but unnumbered (' + J(numbered) + ')');
  ok('  · "on their list" marks the student\'s 5 in the full list', (await cp.$$eval('#gfOut .tag', ts => ts.filter(t => /on their list/.test(t.textContent)).length)) === 5, await cp.$$eval('#gfOut .tag', ts => ts.filter(t => /on their list/.test(t.textContent)).length));
  ok('  · logos beside the names', (await cp.$$('#gfOut .ulogo')).length > 0, (await cp.$$('#gfOut .ulogo')).length);
  ok('  · lower-priority rows say why', (await cp.$$('#gfOut .soft')).length > 0);
  ok('  · no page errors', cerrs.length === 0, cerrs.join(' | '));
  await cp.locator('#gfOut h4').first().scrollIntoViewIfNeeded().catch(() => {});
  await cp.waitForTimeout(300);
  await cp.screenshot({ path: path.join(SHOTS, 'r165-counsellor.png'), fullPage: false });
  await browser.close();
  done();
})().catch(e => { console.log('  ✗ crashed: ' + (e && e.stack || e)); fail++; done(); });

function done() { console.log('round165test: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
