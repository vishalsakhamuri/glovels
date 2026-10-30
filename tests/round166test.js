/*
 * Round 166 — the ranking rule swept across the whole German master's
 * catalogue, field by field, at four CGPAs, API-level (no browser).
 *
 * Vishal's rule (patch 161): country + level + field + CGPA decide the SET;
 * GRE, German level, class rank, bachelor subject/length/ECTS, IELTS, work
 * experience and papers only RANK (lower, never drop); the student sees the
 * best 3/5/10 by package, one per university, in rank order; the counsellor
 * sees ALL in rank order and her first N are the student's N; only a higher
 * CGPA bar hides a row.
 *
 * Round 165 proved this for one field (CS&IT, 8.2). This round runs it for
 * every field in the catalogue (~31, MBA at level mba) × CGPA 9.0 / 8.0 /
 * 7.2 / 6.5, through POST /api/staff/fit (kind any / public / private):
 *   (a) the ranked list is sorted the way screen() says — relevance, then
 *       clear < ask < soft, then score desc; (round 177: a row short of a
 *       stated requirement the student answered — IELTS, GRE, ECTS… — is a
 *       NEAR row, `hard`, below every fit and never in fits[]; soft is
 *       only the bachelor's subject now);
 *   (b) no duplicate programme ids;
 *   (c) the package picks (auto[] plan, 3/5/10) are the first N distinct
 *       universities of the ranked list for that kind;
 *   (d) the secondary filters change the ORDER only — same id set, same N;
 *   (e) a lower CGPA's set is a subset of a higher CGPA's;
 *   (f) what a lower CGPA loses is lost to the grade bar and nothing else.
 * Then eight representative fields actually buy the three packages (24
 * students) and the student's named + held count and names are checked
 * against the counsellor's own public ranking.
 *
 * Needs a server on BASE (default 8097). On a near-empty database the German
 * sheets are loaded first, as round 165 does (R165_SHEETS or the defaults).
 *
 * Run: cd tests && bash srv.sh 8097 && node round166test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const M = require(path.join(__dirname, '..', 'server', 'matches.js'));

const BASE = process.env.BASE || 'http://localhost:8097';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const J = x => JSON.stringify(x);
const note = s => console.log('    · ' + s);
const T0 = Date.now();

/* One cookie jar and one client address per actor (ten orders an hour per
   address is the server's flood rule). */
const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.166.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] }; if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text };
}

/* The base profile: Germany, master's, IELTS 6.5, no GRE, no German, a
   four-year bachelor's in the field itself, no budget ceiling. */
const profileFor = (field, cgpa, level) => ({
  d_course: 'Bachelor in ' + field, d_dur: '4 years', d_cgpa: String(cgpa), d_max: '10', d_pass: '4',
  e_test: 'IELTS', e_score: '6.5', a_test: 'Not taken yet', g_german: 'None yet', w_has: 'No',
  g_level: level || "Master's", g_field: field, g_country: 'Germany', b_total: 'Above ₹40 Lakhs',
});
/* The secondary filters: each one only ranks. */
const TOGGLES = [
  ['GRE 320 / Q165', { a_test: 'GRE', a_score: '320', a_quant: '165' }],
  ['German B1', { g_german: 'B1' }],
  ['top 10 %', { d_top: '10' }],
  ['3-year bachelor + ECTS 180', { d_dur: '3 years', d_ects: '180' }],
  ['work exp 24 months', { w_has: 'Yes', w_months: '24' }],
  ['papers yes', { g_papers: 'Yes' }],
];
const CGPAS = [9.0, 8.0, 7.2, 6.5];
/* The eight that buy. */
const BUYERS = [
  ['Computer Science & IT', 'B.Tech Computer Science'],
  ['Data Science, AI & Machine Learning', 'B.Tech Computer Science'],
  ['Mechanical & Automotive Engineering', 'B.Tech Mechanical Engineering'],
  ['Electrical & Electronics Engineering', 'B.Tech Electrical Engineering'],
  ['Business & Management', 'BBA'],
  ['MBA', 'BBA'],
  ['Natural Sciences (Physics, Chemistry, Maths)', 'B.Sc Physics'],
  ['Biotechnology & Bioinformatics', 'B.Tech Biotechnology'],
];
const PKGS = [['pkg-three-public', 3], ['pkg-roadmap', 5], ['pkg-offer', 10]];

/* Round 177: 3 = a hard miss (near), below every fit. */
const hardOf = r => (r.hard && r.hard.length) ? 1 : 0;
const tier = r => hardOf(r) ? 3 : (r.soft && r.soft.length) ? 2 : (r.ask && r.ask.length) ? 1 : 0;
/* screen()'s own order, server/matches.js byRank: relevance, tier, the
   deadline's standing (round 175: confirmed open 14+ days away, inside 14
   days, rolled from last year, no dates, cannot roll), score, the sooner
   deadline, fee, id. */
const dl = r => M.deadlineInfo(r);
const dlTime = r => (dl(r).next ? dl(r).next.getTime() : Infinity);
const cmp = (a, b) => hardOf(a) - hardOf(b) || b.relevance - a.relevance || tier(a) - tier(b) || dl(a).rank - dl(b).rank || b.score - a.score || dlTime(a) - dlTime(b) || a.totalInr - b.totalInr || String(a.id).localeCompare(String(b.id));
const idsOf = x => (x.fits || []).map(y => String(y.id));
/* One per university, the way pick() counts them (uniKeys: name, or city + kind of school). */
const firstUnis = (rows, n) => { const out = [], seen = new Set(); for (const p of rows) { const ks = M.uniKeys(p); if (ks.some(k => seen.has(k))) continue; ks.forEach(k => seen.add(k)); out.push(p); if (out.length >= n) break; } return out; };
const uniCount = rows => firstUnis(rows, 1e9).length;
/* pick()'s own order (server/matches.js ~636): score alone, then fee, then
   id — it does not sort by the clear/ask/soft tier the way screen() does.
   Used to DIAGNOSE a plan-vs-list mismatch, not to excuse it. */
const scoreOnly = rows => rows.slice().sort((a, b) => b.score - a.score || a.totalInr - b.totalInr || String(a.id).localeCompare(String(b.id)));
/* Round 177 (item 8): a row short of a stated requirement the student
   answered (IELTS, GRE, ECTS, German…) is no longer a "fit" — it is a NEAR
   row with `hard` reasons, ranked below every fit. It is still in the SET
   (country + level + field + CGPA decide the set; the rest only ranks), so
   this suite reads the set as fits followed by the near rows whose only
   reasons are hard misses — the order pick() fills a package in. */
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
/* 2,000 (the server's cap), not 500: the hard-miss rows of the set now
   travel in near[], which also holds every row the grade bar turns away —
   cut at 500 it dropped part of the set. */
const fitPost = (profile, filters, counts) => req('a', 'POST', '/api/staff/fit', Object.assign({ profile, filters: Object.assign({ limit: 2000, kind: 'any' }, filters || {}) }, counts || {})).then(asSet);
const fitGet = (who, sid, q) => req(who, 'GET', '/api/staff/student/' + sid + '/fit?limit=2000' + (q ? '&' + q : '')).then(asSet);
const visible = s => (s.shortlist || []).filter(r => r.addedBy !== 'student');
const short = s => String(s || '').replace(/Universit(y|ät|aet) of Applied Sciences/i, 'UAS').replace(/Technische Universität/i, 'TU').replace(/University/i, 'U.').slice(0, 26);

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ')'); return done(); }
  const st = Date.now().toString(36);
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.status === 200, r.status);

  /* ---------------------------------------------------- 0. the catalogue */
  const total0 = Number((await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.total || 0);
  if (total0 < 1000) {
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
  const staffRows = [];
  for (let pg = 1; pg < 10; pg++) {
    const b = (await req('a', 'GET', '/api/staff/catalogue?per=2000&page=' + pg + '&status=')).body;
    (b.programmes || []).forEach(x => staffRows.push(x));
    if (staffRows.length >= (b.total || 0) || !(b.programmes || []).length) break;
  }
  const deMaster = staffRows.filter(x => String(x.country).toUpperCase() === 'DE' && /^master$/i.test(x.level));
  const deMba = staffRows.filter(x => String(x.country).toUpperCase() === 'DE' && /^mba$/i.test(x.level));
  ok('the German catalogue is loaded (' + staffRows.length + ' rows; ' + deMaster.length + ' DE master, ' + deMba.length + ' DE mba)', deMaster.length > 1000, staffRows.length);
  const catByField = {};
  deMaster.forEach(x => { const f = M.normField(x.field); catByField[f] = catByField[f] || { n: 0, pub: 0, unis: new Set(), pubUnis: new Set() }; catByField[f].n++; catByField[f].unis.add(x.university); if (x.isPublic) { catByField[f].pub++; catByField[f].pubUnis.add(x.university); } });
  const FIELDS = Object.keys(catByField).sort((a, b) => catByField[b].n - catByField[a].n).map(f => [f, "Master's"]);
  FIELDS.push(['MBA', 'MBA']);
  catByField.MBA = { n: deMba.length, pub: deMba.filter(x => x.isPublic).length, unis: new Set(deMba.map(x => x.university)), pubUnis: new Set(deMba.filter(x => x.isPublic).map(x => x.university)) };
  ok('fields to sweep: ' + FIELDS.length + ' (' + (FIELDS.length - 1) + ' at master + MBA at mba)', FIELDS.length >= 25, FIELDS.map(f => f[0]).join(', '));

  /* ------------------------------------------------------- 1. the sweep */
  const table = [];          // field | cgpa | N_all | N_unis(pub) | top-3 | soft
  const findings = { under10: [], zero: [], capped: [], privAboveFree: [], pickMismatch: [], pickByScore: [], pickOutside: [], pickOdd: [], merged: new Set(), sortBad: [], dupes: [], toggleBad: [], subsetBad: [], lostBad: [] };
  let calls = 0;
  for (const [field, level] of FIELDS) {
    const perC = {};
    let sortOk = true, dupOk = true, pickOk = true, toggleOk = true, subsetOk = true, lostOk = true;
    const why = [];
    for (const cgpa of CGPAS) {
      const prof = profileFor(field, cgpa, level);
      const any = (await fitPost(prof, { kind: 'any' })).body; calls++;
      const pub = (await fitPost(prof, { kind: 'public' }, { publicCount: 10, privateCount: 10 })).body; calls++;
      const priv = (await fitPost(prof, { kind: 'private' })).body; calls++;
      perC[cgpa] = { any, pub, priv };
      for (const [kind, x] of [['any', any], ['public', pub], ['private', priv]]) {
        const fits = x.fits || [];
        /* (a) sorted the way screen() sorts. */
        for (let i = 1; i < fits.length; i++) if (cmp(fits[i - 1], fits[i]) > 0) { sortOk = false; why.push(kind + '@' + cgpa + ' rows ' + (i - 1) + '/' + i + ' out of order: ' + J([fits[i - 1].relevance, tier(fits[i - 1]), fits[i - 1].score]) + ' then ' + J([fits[i].relevance, tier(fits[i]), fits[i].score])); break; }
        /* (b) no duplicate ids. */
        const ids = idsOf(x);
        if (new Set(ids).size !== ids.length) { dupOk = false; why.push(kind + '@' + cgpa + ' duplicate ids'); }
        if ((x.counts || {}).fits > 500) findings.capped.push(field + ' ' + kind + '@' + cgpa + ': ' + x.counts.fits);
      }
      /* (c) the picks are the first N distinct universities of the ranked list, per kind. */
      for (const [kind, x] of [['public', pub], ['private', priv]]) {
        const plan = (pub.auto || []).find(a => a.kind === kind) || { picks: [] };
        /* Round 177: the set is fits then hard-miss rows; pick() keeps to the
           student's own field (relevance 3) unless that cannot fill the
           package, and only then widens to the whole set in its order. */
        /* Round 178 (owner, 30 Oct): pick() fills ONLY from rows the student
           meets — the hard-miss rows stay in the counsellor's SET (ranked,
           near) but are never a package pick. */
        const met = (x.fits || []).filter(f => !(f.hard || []).length);
        const rel3 = met.filter(f => f.relevance === 3);
        const want10 = uniCount(rel3) >= 10 ? firstUnis(rel3, 10) : firstUnis(met, 10);
        const byScore10 = firstUnis(scoreOnly(x.fits || []), 10);
        const byScore10rel3 = firstUnis(scoreOnly((x.fits || []).filter(f => f.relevance === 3)), 10);
        /* Different universities that uniKeys() folds into one (city + kind of
           school): pick() then names only one of them. */
        if (kind === 'public' && cgpa === 8.0) {
          const byKey = new Map();
          (x.fits || []).forEach(f => M.uniKeys(f).filter(k2 => k2.startsWith('c:')).forEach(k2 => { if (!byKey.has(k2)) byKey.set(k2, new Set()); byKey.get(k2).add(f.university); }));
          byKey.forEach((names, k2) => { if (names.size > 1) findings.merged.add(k2 + ' = ' + [...names].map(short).join(' + ')); });
        }
        for (const n of [3, 5, 10]) {
          const got = plan.picks.slice(0, n).map(p => String(p.id));
          const exp = want10.slice(0, n).map(p => String(p.id));
          if (J(got) !== J(exp)) {
            pickOk = false;
            /* pick() keeps only the student's own field (relevance 3) unless
               it had to relax, so the score-only order is tried on the whole
               list and on the relevance-3 rows alone. */
            const explained = J(got) === J(byScore10.slice(0, n).map(p => String(p.id))) || J(got) === J(byScore10rel3.slice(0, n).map(p => String(p.id)));
            /* A pick that is not in the list at all: plan() relaxed the level
               (an MBA for a master's) before the field — those rows are not
               in a master's-only list. */
            const outside = got.filter(id => !(x.fits || []).some(f => String(f.id) === id)).length;
            (explained ? findings.pickByScore : outside ? findings.pickOutside : findings.pickOdd).push(field + ' ' + kind + '@' + cgpa + ' n=' + n + (outside ? ' (' + outside + ' outside the list)' : ''));
            const gotU = plan.picks.slice(0, n).map(p => short(p.university)), expU = want10.slice(0, n).map(p => short(p.university));
            const firstOff = got.findIndex((id, i) => id !== exp[i]);
            const pickRow = (x.fits || []).find(f => String(f.id) === got[firstOff]) || {}, listRow = want10[firstOff] || {};
            why.push(kind + '@' + cgpa + ' pick ' + n + ': plan ' + J(gotU) + ' vs list ' + J(expU) + (explained ? ' — pick() sorts by score alone (#' + (firstOff + 1) + ' plan: ' + short(pickRow.university) + ' ' + ['clear', 'ask', 'soft'][tier(pickRow)] + ' ' + pickRow.score + (pickRow.soft || []).map(s => ' [' + s.slice(0, 50) + ']').join('') + '; list: ' + short(listRow.university) + ' ' + ['clear', 'ask', 'soft'][tier(listRow)] + ' ' + listRow.score + ')' : (got.some(id => !(x.fits || []).some(f => String(f.id) === id)) ? ' — a pick outside the master\'s list: plan() relaxed the level (MBA rows) before the field' : ' — NOT explained by score-only order')));
            findings.pickMismatch.push(field + ' ' + kind + '@' + cgpa + ' n=' + n + ': plan ' + J(gotU) + ' vs ranked list ' + J(expU));
            break;
          }
        }
      }
    }
    /* (d) the secondary filters change the order only — at 8.0 for every
       field (and 6.5 for the buyers), kind any. */
    const togglesAt = BUYERS.some(b => b[0] === field) ? [8.0, 6.5] : [8.0];
    let orderChanged = 0, togglesRun = 0;
    for (const cgpa of togglesAt) {
      const base = perC[cgpa].any;
      if ((base.counts || {}).fits > 500) continue;          // a capped list cannot be compared as a set
      togglesRun += TOGGLES.length;
      const baseIds = idsOf(base);
      for (const [label, extra] of TOGGLES) {
        const t = (await fitPost(Object.assign(profileFor(field, cgpa, level), extra), { kind: 'any' })).body; calls++;
        const tIds = idsOf(t);
        const same = tIds.length === baseIds.length && J(tIds.slice().sort()) === J(baseIds.slice().sort());
        if (!same) {
          toggleOk = false;
          const gone = baseIds.filter(i => !tIds.includes(i)), came = tIds.filter(i => !baseIds.includes(i));
          why.push(label + '@' + cgpa + ': N ' + baseIds.length + ' → ' + tIds.length + ' (gone ' + gone.length + ', new ' + came.length + ')');
          findings.toggleBad.push(field + ' ' + label + '@' + cgpa + ': ' + baseIds.length + ' → ' + tIds.length + '; gone ' + J(gone.slice(0, 3)) + ' new ' + J(came.slice(0, 3)));
        }
        if (J(tIds) !== J(baseIds)) orderChanged++;
      }
    }
    /* (e)+(f): lower CGPA ⊆ higher CGPA, and what goes is the grade bar. */
    for (let i = 1; i < CGPAS.length; i++) {
      const hi = perC[CGPAS[i - 1]].any, lo = perC[CGPAS[i]].any;
      if ((hi.counts || {}).fits > 500 || (lo.counts || {}).fits > 500) continue;
      const hiIds = new Set(idsOf(hi)), loIds = idsOf(lo);
      const extra = loIds.filter(id => !hiIds.has(id));
      if (extra.length) { subsetOk = false; why.push('set@' + CGPAS[i] + ' has ' + extra.length + ' rows not in set@' + CGPAS[i - 1] + ': ' + J(extra.slice(0, 3))); findings.subsetBad.push(field + ' ' + CGPAS[i] + '⊄' + CGPAS[i - 1] + ' ' + J(extra.slice(0, 3))); }
      const lost = [...hiIds].filter(id => !loIds.includes(id));
      const nearLo = new Map((lo.near || []).map(x => [String(x.id), x]));
      const badLost = lost.filter(id => { const n = nearLo.get(id); return !n || n.why.length !== 1 || !/CGPA|German \d/.test(n.why[0]); });
      if (badLost.length && (lo.counts || {}).near <= 500) { lostOk = false; why.push(CGPAS[i - 1] + '→' + CGPAS[i] + ': ' + badLost.length + ' of ' + lost.length + ' lost rows not for the grade bar: ' + J(badLost.slice(0, 3).map(id => (nearLo.get(id) || {}).why || 'not in near[]'))); findings.lostBad.push(field + ' ' + CGPAS[i - 1] + '→' + CGPAS[i] + ' ' + J(badLost.slice(0, 2))); }
    }
    /* The human look: a paid private programme above a free public one, same relevance and tier. */
    {
      const fits = (perC[8.0].any.fits || []);
      let shown = 0;
      for (let i = 0; i < fits.length && shown < 1; i++) {
        const a = fits[i];
        if (a.isPublic || !(a.totalInr > 0)) continue;
        const b = fits.slice(i + 1).find(x => x.isPublic && x.totalInr === 0 && x.relevance === a.relevance && tier(x) === tier(a));
        if (b) { findings.privAboveFree.push(field + '@8.0: #' + (i + 1) + ' ' + short(a.university) + ' ₹' + Math.round(a.totalInr / 1e5) + 'L score ' + a.score + ' above #' + (fits.indexOf(b) + 1) + ' ' + short(b.university) + ' free score ' + b.score); shown++; }
      }
    }
    /* The rows of the table. */
    for (const cgpa of CGPAS) {
      const any = perC[cgpa].any, pub = perC[cgpa].pub;
      const nAll = (any.counts || {}).fits, nUnis = uniCount(pub.fits || []), nUnisAny = uniCount(any.fits || []);
      const soft = (any.fits || []).filter(x => tier(x) === 2).length;
      table.push({ field, cgpa, nAll, nUnis, nUnisAny, top3: firstUnis(pub.fits || [], 3).map(p => short(p.university)).join(' · '), soft, rel3: (any.fits || []).filter(x => x.relevance === 3).length });
      if (cgpa === 8.0) {
        if (!nAll) findings.zero.push(field);
        else if (nUnis < 10) findings.under10.push(field + ' (' + nUnis + ' public universities, ' + nUnisAny + ' any)');
      }
    }
    const n8 = table.find(t => t.field === field && t.cgpa === 8.0);
    ok(field.padEnd(46) + ' N@9/8/7.2/6.5 = ' + CGPAS.map(c => table.find(t => t.field === field && t.cgpa === c).nAll).join('/') + ' · ' + n8.nUnis + ' public unis · order changed by ' + orderChanged + ' of ' + togglesAt.length * TOGGLES.length + ' toggles',
      sortOk && dupOk && pickOk && toggleOk && subsetOk && lostOk, why.slice(0, 3).join(' | '));
  }
  note(calls + ' fit calls in ' + Math.round((Date.now() - T0) / 1000) + 's');

  /* --------------------------------------------- 2. twenty-four students */
  r = await req('a', 'POST', '/api/staff/people', { name: 'Sweep Counsellor', email: 'sweep-' + st + '@glovels.com', role: 'counsellor' });
  ok('a counsellor is created', r.status === 200 && r.body.person, r.text.slice(0, 160));
  const cEmail = r.body.person && r.body.person.email, cPass = r.body.password, cId = r.body.person && r.body.person.id;
  await req('c', 'POST', '/api/auth/login', { email: cEmail, password: cPass });
  r = await req('c', 'POST', '/api/auth/change', { current: cPass, password: 'sweep-' + st + '-chose-this' });
  ok('  · signs in', r.status === 200, r.text.slice(0, 120));
  let k = 0;
  const heldReport = [];
  for (const [field, course] of BUYERS) {
    const level = field === 'MBA' ? 'MBA' : "Master's";
    for (const [pkgId, n] of PKGS) {
      k++;
      const who = 'b' + k;
      const email = who + '-' + st + '@ex.example';
      const prof = Object.assign(profileFor(field, 8.0, level), { d_course: course });
      r = await req(who, 'POST', '/api/orders', { name: 'Sweep ' + who, email, phone: '+91900016' + String(6000 + k), acceptedTerms: true, packageId: pkgId });
      const placed = r.status === 200;
      await req(who, 'POST', '/api/auth/change', { password: who + '-' + st + '-password' });
      r = await req(who, 'PUT', '/api/profile', { profile: Object.assign({ fullName: 'Sweep ' + who }, prof) });
      const saved = r.status === 200 && r.body.matched;
      const s = (await req(who, 'GET', '/api/state')).body;
      const sid = s.user && s.user.id;
      await req('a', 'PUT', '/api/staff/student/' + sid + '/counsellor', { counsellorId: cId });
      const cPub = (await fitGet('c', sid, 'kind=public')).body;
      const file = (await req('c', 'GET', '/api/staff/student/' + sid)).body;
      const held = file.held || [];
      const list = visible(s);
      const unis = firstUnis((cPub.fits || []).filter(f => !(f.hard || []).length), 1e9);   /* round 178: met rows only */
      const want = Math.min(unis.length, n);
      const expUnis = unis.slice(0, n).map(p => p.university);
      const gotUnis = list.map(x => x.university).concat(held.map(h => h.university));
      const countOk = list.length + held.length === want && (s.matched || {}).held === held.length;
      const namesOk = J(gotUnis.slice().sort()) === J(expUnis.slice().sort());
      const orderOk = J(list.map(x => String(x.id))) === J(unis.slice(0, n).map(p => String(p.id)).filter(id => !held.some(h => String(h.id) === id)));
      /* When the names differ: is it pick()'s score-only order again? */
      const byScoreN = firstUnis(scoreOnly(cPub.fits || []), n).map(p => p.university);
      const explained = !namesOk && J(gotUnis.slice().sort()) === J(byScoreN.slice().sort());
      if (!namesOk) (explained ? findings.pickByScore : findings.pickOdd).push(field + ' bought ' + pkgId);
      const pubOk = list.every(x => x.university && x.isPublic) && new Set(list.map(x => x.university)).size === list.length;
      const heldOk = held.every(h => h.reason);
      ok(field.slice(0, 30).padEnd(31) + pkgId.padEnd(17) + ' → ' + list.length + ' named + ' + held.length + ' held = ' + want + '; first ' + n + ' of the counsellor\'s public ranking',
        placed && saved && countOk && namesOk && orderOk && pubOk && heldOk,
        (placed ? '' : 'order ' + r.status + ' ') + (saved ? '' : 'profile not matched ') + (countOk ? '' : 'count ' + list.length + '+' + held.length + ' matched=' + J(s.matched) + ' ') + (namesOk ? '' : 'names ' + J(gotUnis.map(short)) + ' vs ' + J(expUnis.map(short)) + (explained ? ' — the first ' + n + ' by score alone, so pick() sorted without the clear/ask/soft tier the counsellor\'s list is sorted by ' : ' — not the score-only order either ') ) + (orderOk ? '' : 'order ' + J(list.map(x => short(x.university))) + ' ') + (pubOk ? '' : 'not all public/distinct ') + (heldOk ? '' : 'held without reason'));
      held.forEach(h => heldReport.push(field.slice(0, 24) + '/' + n + ': ' + short(h.university) + ' — ' + h.reason));
    }
  }
  ok('every held pick carries a reason (' + heldReport.length + ' held across the 24)', heldReport.every(x => /— .+/.test(x)));
  heldReport.slice(0, 12).forEach(x => note('held: ' + x));

  /* ------------------------------------------------------------ summary */
  console.log('');
  console.log('  field                                        cgpa  N_all  N_pubU  N_anyU  soft  rel3  top-3 public universities');
  for (const t of table) {
    console.log('  ' + t.field.slice(0, 44).padEnd(45) + String(t.cgpa).padEnd(5) + String(t.nAll).padStart(6) + String(t.nUnis).padStart(8) + String(t.nUnisAny).padStart(8) + String(t.soft).padStart(6) + String(t.rel3).padStart(6) + '  ' + t.top3);
  }
  console.log('');
  note('fields with 0 rows at 8.0: ' + (findings.zero.length ? findings.zero.join(', ') : 'none'));
  note('fields with fewer than 10 public universities at 8.0 (the 10-package cannot be filled from public rows): ' + (findings.under10.length ? findings.under10.join('; ') : 'none'));
  note('lists capped at 500 (counts.fits > the 500 limit — set checks skipped): ' + (findings.capped.length ? findings.capped.join('; ') : 'none'));
  note('plan vs ranked list mismatches: ' + findings.pickMismatch.length + ' (field × kind × cgpa), of which ' + findings.pickByScore.length + ' are exactly the first N by score alone — pick() (server/matches.js ~636) sorts by score, fee, id; screen() (~1014) sorts by relevance, then clear < ask < soft, then score — ' + findings.pickOutside.length + ' pick a row outside the master\'s list (plan() relaxed the level to MBA before the field; RELAX order is term/budget/level/field) — and ' + findings.pickOdd.length + ' are not explained by either' + (findings.pickOdd.length ? ': ' + findings.pickOdd.slice(0, 6).join(', ') : ''));
  findings.pickMismatch.slice(0, 4).forEach(x => note('  e.g. ' + x));
  note('different universities uniKeys() (server/matches.js ~663) folds into one by city + kind, so a package names only one of them: ' + findings.merged.size + (findings.merged.size ? ' — e.g. ' + [...findings.merged].slice(0, 5).join(' || ') : ''));
  note('toggle changed the set: ' + (findings.toggleBad.length ? findings.toggleBad.slice(0, 6).join(' || ') : 'none'));
  note('lower CGPA not a subset: ' + (findings.subsetBad.length ? findings.subsetBad.slice(0, 4).join(' || ') : 'none'));
  note('rows lost to something other than the grade bar: ' + (findings.lostBad.length ? findings.lostBad.slice(0, 4).join(' || ') : 'none'));
  note('a paid private programme above a free public one at the same relevance and tier (score() intends fit + cleared requirements to outweigh the +8 for free tuition): ' + (findings.privAboveFree.length ? findings.privAboveFree.length + ' fields, e.g. ' + findings.privAboveFree.slice(0, 3).join(' || ') : 'none'));
  const tot = table.filter(t => t.cgpa === 8.0);
  note('at 8.0: ' + tot.length + ' fields, ' + tot.reduce((a, t) => a + t.nAll, 0) + ' fits in all, ' + tot.filter(t => t.nUnis >= 10).length + ' fields can fill the 10-package from public universities, ' + tot.filter(t => t.nUnis >= 5 && t.nUnis < 10).length + ' only the 5, ' + tot.filter(t => t.nUnis >= 3 && t.nUnis < 5).length + ' only the 3, ' + tot.filter(t => t.nUnis < 3).length + ' not even the 3');
  note('total ' + Math.round((Date.now() - T0) / 1000) + 's');
  done();
})().catch(e => { console.log('  ✗ crashed: ' + (e && e.stack || e)); fail++; done(); });

function done() { console.log('round166test: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
