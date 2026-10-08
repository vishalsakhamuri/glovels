/*
 * Patch 150 — "can the counsellor filter like home page".
 * The home page's German grade, tuition per semester, specialisation and
 * publication filters, in the staff matcher (counsellor + admin).
 */
const M = require('../server/matches.js');
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const row = (id, o) => Object.assign({ id, program: 'Computer Science', university: 'U' + id, level: 'master', field: 'Computer Science & IT',
  country: 'DE', isPublic: true, totalInr: 0, intakes: [], reqs: {} }, o);
const cat = [
  row('free'),
  row('bw', { reqs: { tuitionEurSem: 1500 }, totalInr: 600000 }),
  row('priv', { isPublic: false, totalInr: 2000000 }),
  row('emb', { program: 'Embedded Systems' }),
  row('g25', { germanGpa: 2.5 }),
  row('pap', { reqs: { papersRequired: true } }),
];
const P = { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science', d_course: 'B.Tech CSE', d_cgpa: '8', d_max: '10', d_pass: '4' };
const C = { DE: 'Germany', Germany: 'DE' };
const ids = r => r.fits.map(x => x.id).concat(r.near.map(x => x.id));
const fits = r => r.fits.map(x => x.id);

ok('no filters: everything looked at', M.screen(cat, P, C, {}).counts.looked === cat.length);
const t0 = ids(M.screen(cat, P, C, { tuitionMax: '0' }));
ok('"No tuition fee" keeps the free ones', t0.includes('free') && !t0.includes('bw'), t0);
ok('  · and drops a ₹20L private master’s with no per-semester fee entered', !t0.includes('priv'), t0);
const t1 = ids(M.screen(cat, P, C, { tuitionMax: '1500' }));
ok('"Up to €1,500" keeps Baden-Württemberg', t1.includes('bw') && !t1.includes('priv'), t1);
ok('specialisation matches the programme name', JSON.stringify(ids(M.screen(cat, P, C, { spec: 'embedded' }))) === '["emb"]');
const g3 = M.screen(cat, P, C, { ggpa: '3.0' });
ok('a German grade typed in is used', !fits(g3).includes('g25') && g3.near.some(x => x.id === 'g25' && /German 2.5/.test(x.why[0])), JSON.stringify(g3.near));
ok('  · and a good one clears', fits(M.screen(cat, P, C, { ggpa: '1.8' })).includes('g25'));
const np = M.screen(cat, Object.assign({ g_papers: 'No' }, P), C, {});
/* Patch 162: a shortfall ranks the row lower on the list; it is not dropped. */
ok('"Published a paper: No" keeps the programme that requires one, ranked last and saying why',
  fits(np).includes('pap') && fits(np)[fits(np).length - 1] === 'pap' && np.fits.find(x => x.id === 'pap').soft.some(w => /paper/i.test(w)), fits(np));

console.log('round150test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
