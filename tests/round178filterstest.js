/*
 * Round 178 — Part F of the 30 Oct brief (catalogue v43 filters), with the
 * owner's decisions of 30 Oct:
 *
 *   HOME / PUBLIC / STUDENT SIDE HIDES, COUNSELLOR RANKS. On the home finder,
 *   Find University, the Study-in finders and the student's own browse a
 *   programme the student falls short of on a stated requirement is HIDDEN;
 *   "not mentioned" / blank is met (F4). The counsellor's matcher keeps every
 *   row, the short ones in "near" with the reason.
 *
 *   F6.1  tag search: "rost" offers Rostock (City) and University of Rostock
 *         (University); Rostock + Physics → only rows tagged both.
 *   F6.2  ECE + EEE → the union (OR within a descriptive type); + Bavaria →
 *         narrowed (AND across types). Exact tag, not substring.
 *   F6.3  Field (exact), the out-of/pass calculator, Bachelor's length and
 *         GRE combined score are gone from the screens and the logic.
 *   F6.4  German grade 2.8: GPA 4.0 and blank shown, 2.5 hidden; a CGPA
 *         alone is converted (modified Bavarian, pass 4/10); a typed German
 *         grade wins.
 *   F6.5  IELTS 6.0: blank and ≤ 6.0 shown; with an MOI letter, MOI = Yes rows
 *         that ask more are shown too ("Maybe" → badge), MOI = No are not.
 *   F6.6  no GRE: "Not mentioned" / "Recommended" / "Optional…" shown, only
 *         "Yes…" hidden.
 *   F6.7  ECTS 180: 180 rows, 210 + "3 Year Degree Accepted? = Yes", and 210
 *         "Maybe" with a "Maybe – check eligibility" badge; 240 "No" hidden.
 *   F9.1  "Data Science (Master's)" + "Public University" vs "Data Science".
 *   F9.2  "IELTS 6.5" → rows needing 6.5 or less, none needing 7.0.
 *   F9.3  Level: Master's only, the MBAs under it (home, Find University,
 *         counsellor panel, Study-in finders).
 *   F9.4  A non-German destination hides the Germany-only filters (German
 *         grade, German level, ECTS, restricted admission).
 *   F9.5  Export shortlist to Excel: exactly the eight columns, one row per
 *         programme on the student's list.
 *   +     /api/find/locked hides before the cap; the package (pick) fills
 *         only from rows the student meets.
 *
 * Port 8132 by default (BASE overrides). Loads the German sheets itself when
 * the catalogue is small, then imports its own fixture rows (field
 * "R178 Test Field") so every check is exact.
 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8132';
const SCR = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 400) : '')); } };
const note = s => console.log('    · ' + s);
const J = x => JSON.stringify(x);
function done() { console.log('round178filterstest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body, raw) {
  ips[who] = ips[who] || ('10.178.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'x-forwarded-for': ips[who] };
  if (!raw) h['content-type'] = 'application/json';
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: raw || (body === undefined ? undefined : JSON.stringify(body)) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString('utf8'); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, text, buf, headers: r.headers };
}

const F = require(path.join(ROOT, 'server', 'find.js'));
const R = require(path.join(ROOT, 'server', 'reqs.js'));
const T = require(path.join(ROOT, 'server', 'tags.js'));
const M = require(path.join(ROOT, 'server', 'matches.js'));
const SHEET = require(path.join(ROOT, 'server', 'sheet.js'));

/* ------------------------------------------------------------- the fixtures */
const FIELD = 'R178 Test Field';
/* [key, overrides] — every row private, Germany, master's, free to apply,
   named on the public side, winter 2027 intake. */
const FIX = [
  ['phys-rostock', { city: 'Rostock', tags: 'Physics; Rostock; University of Rostock' }],
  ['phys-bremen', { city: 'Bremen', tags: 'Physics; Bremen' }],
  ['chem-rostock', { city: 'Rostock', tags: 'Chemistry; Rostock' }],
  ['ece-munich', { city: 'Munich', tags: 'ECE; Munich; Bavaria' }],
  ['eee-berlin', { city: 'Berlin', tags: 'EEE; Berlin' }],
  ['eee-nuremberg', { city: 'Nuremberg', tags: 'EEE; Nuremberg; Bavaria' }],
  ['it-title', { program: 'R178 IT Security', tags: 'Information Technology; Cyber Security' }],
  ['gpa-40', { germanGpa: '4' }],
  ['gpa-blank', {}],
  ['gpa-25', { germanGpa: '2.5' }],
  ['ielts-blank', {}],
  ['ielts-60', { ielts: '6' }],
  ['ielts-70-moi-yes', { ielts: '7', moi: 'Yes' }],
  ['ielts-70-moi-no', { ielts: '7', moi: 'No' }],
  ['ielts-70-moi-maybe', { ielts: '7', moi: 'Possibly - with a letter from the university' }],
  ['gre-notmentioned', { gre: 'Not mentioned' }],
  ['gre-recommended', { gre: 'Recommended' }],
  ['gre-optional', { gre: 'Optional - for scholarships' }],
  ['gre-yes', { gre: 'Yes, unless waived' }],
  ['ects-180', { ects: '180' }],
  ['ects-210-yes', { ects: '210', three: 'Yes' }],
  ['ects-210-maybe', { ects: '210', three: 'Maybe' }],
  ['ects-240-no', { ects: '240', three: 'No' }],
  ['mba', { level: 'mba', program: 'R178 MBA General Management' }],
  ['ielts-tag-65', { ielts: '6.5', tags: 'IELTS 6.5; IELTS 7.0; IELTS 7.5' }],
  ['ielts-tag-70', { ielts: '7', tags: 'IELTS 7.0; IELTS 7.5' }],
  ['ds-master', { program: 'R178 Data Science MSc', isPublic: 'yes', tags: "Data Science (Master's); Data Science; Public University" }],
  ['ds-bachelor-only', { program: 'R178 Business Analytics', tags: 'Data Science; Business' }],
  ['locked-ielts-60', { isPublic: 'yes', ielts: '6', program: 'R178 Locked Six' }],
  ['locked-ielts-75', { isPublic: 'yes', ielts: '7.5', moi: 'No', program: 'R178 Locked Seven Five' }],
  ['gb-master', { country: 'GB', city: 'London' }],
];
const HEAD = ['programme', 'university', 'city', 'country code', 'level', 'field', 'public university', 'application', 'total tuition inr',
  'course url', 'german gpa', 'intake 1 season', 'intake 1 deadline', 'on the site', 'ielts min', 'moi accepted', 'gre required', 'ects min',
  '3 year degree accepted', 'tags'];
const progName = (k, o) => o.program || ('R178 ' + k);
const uniName = k => 'R178 University ' + k.replace(/[^a-z0-9]+/gi, ' ').trim();
function fixtureCsv() {
  const rows = FIX.map(([k, o]) => [progName(k, o), uniName(k), o.city || 'Aalen', o.country || 'DE', o.level || 'master', FIELD,
    o.isPublic || 'no', o.isPublic === 'yes' ? 'Package' : 'Free', o.isPublic === 'yes' ? 0 : 1500000,
    'https://example.org/r178/' + k, o.germanGpa || '', 'winter', '2027-07-15', 'yes', o.ielts || '', o.moi || '', o.gre || '', o.ects || '',
    o.three || '', o.tags || '']);
  return SHEET.writeCsv(HEAD, rows);
}

(async () => {
  /* ======================================================== units (no server) */
  console.log('units');
  {
    const c = R.clean({ greRequired: 'Yes, unless waived', moiAccepted: 'Possibly - with letter', threeYearOk: 'Maybe', restricted: 'Not mentioned' }).reqs;
    ok('reqs: "Yes, unless waived" is a yes; "Possibly …" is maybe; "Not mentioned" is not stated', c.greRequired === true && c.moiAccepted === 'maybe' && c.threeYearOk === 'maybe' && c.restricted === null, J(c));
    const g = ['Recommended', 'Strongly recommended', 'Optional - if no GATE', 'Scored in selection', 'No'].map(v => R.clean({ greRequired: v }).reqs.greRequired);
    ok('reqs: GRE Recommended / Strongly recommended / Optional… / Scored in selection / No ask for nothing', g.every(v => v === false), J(g));
    ok('reqs: the 3-year column is read under its v43 heading', R.headingsFor(R.BY_KEY.get('threeYearOk')).includes('3 year degree accepted?'));
    const by = R.check({ bachelorYears: 4 }, { bachelorYears: 3, ects: 180 });
    ok('F6.3 logic: the bachelor\'s LENGTH is not checked any more (a 4-year row, a 3-year student)', !by.fails.length && !by.unknown.length, J(by));
    ok('F6.3 logic: no bachelorYears / greScore key on the finder address', !F.KEYS.includes('bachelorYears') && !F.KEYS.includes('greScore'));
    const e = (ects, three) => R.check({ ectsMin: ects, threeYearOk: three }, { ects: 180 });
    ok('F6.7 unit: 180 vs 210 Yes clears; 210 Maybe is a note; 240 No fails', !e(210, true).fails.length && e(210, 'maybe').notes.includes('Maybe – check eligibility')
      && !e(210, 'maybe').fails.length && e(240, false).fails.length === 1 && !e(180, null).fails.length);
    const m = (moi, s) => R.check({ ieltsMin: 7, moiAccepted: moi }, s);
    ok('F6.5 unit: IELTS 6 + MOI letter clears MOI=Yes, is a note on Maybe, misses on No', !m(true, { ielts: 6, moi: true }).fails.length
      && m('maybe', { ielts: 6, moi: true }).notes.includes('MOI possibly accepted') && m(false, { ielts: 6, moi: true }).fails.length === 1
      && m(true, { ielts: 6 }).fails.length === 1);
    ok('F2.4 unit: "GRE taken" (no total) clears a row that only requires the GRE', !R.check({ greRequired: true }, { gre: 'taken' }).fails.length && !R.check({ greRequired: true }, { gre: 'taken' }).unknown.length);
    /* Tags (F1). */
    ok('F6.2 unit: ECE + EEE is the union (Bachelor OR); + Bavaria narrows (State AND)',
      T.match({ tags: ['ECE'] }, ['ECE', 'EEE'], '') && T.match({ tags: ['EEE'] }, ['ECE', 'EEE'], '') && !T.match({ tags: ['Physics'] }, ['ECE', 'EEE'], '')
      && T.match({ tags: ['ECE', 'Bavaria'] }, ['ECE', 'EEE', 'Bavaria'], '') && !T.match({ tags: ['EEE', 'Berlin'] }, ['ECE', 'EEE', 'Bavaria'], ''));
    ok('F1 unit: exact tag — "IT" does not match "Information Technology" nor a title with IT', !T.match({ program: 'IT Security', tags: ['Information Technology'] }, ['IT'], ''));
    ok('F1 unit: AND-types each hold — No German Required + 3-Year Bachelor Accepted', T.match({ tags: ['No German Required', '3-Year Bachelor Accepted'] }, ['No German Required', '3-Year Bachelor Accepted'], '')
      && !T.match({ tags: ['No German Required'] }, ['No German Required', '3-Year Bachelor Accepted'], ''));
    ok('F8 unit: "English Test" is a descriptive type — IELTS 6.5 or PTE 60', T.typeOf('IELTS 6.5') === 'English Test' && T.match({ tags: ['PTE 60'] }, ['IELTS 6.5', 'PTE 60'], ''));
    ok('F9.3 unit: Find University files MBA under Master\'s', F.parse('level=mba').level === 'master'
      && F.run([{ id: 1, country: 'DE', level: 'mba', field: 'X', program: 'MBA', university: 'U', intakes: [] }], { level: 'master' }, R).rows.length === 1);
    ok('F9.4 unit: a non-German destination drops the Germany-only keys', J(F.parse('country=GB&ggpa=2&german=B1&ects=180&restricted=open&cgpa=8')) === J({ country: 'GB', cgpa: '8' }));
    ok('F6.4 unit: CGPA 7.5 → German 2.2 (pass 4/10); typed German wins', F.germanFrom(7.5, 4) === 2.2
      && F.verdict({ germanGpa: 2.0, reqs: {} }, { cgpa: 9.5, germanGrade: 2.8 }, R).fails.length === 1
      && !F.verdict({ germanGpa: 2.5, reqs: {} }, { cgpa: 7.5 }, R).fails.length);
    /* Counsellor ranks: the matcher keeps a short row as near. */
    const cat = [{ id: 'a', program: 'P', university: 'U1', country: 'DE', level: 'master', field: 'Natural Sciences (Physics, Chemistry, Maths)', isPublic: false, totalInr: 100, intakes: [], reqs: { ieltsMin: 7, moiAccepted: false } },
      { id: 'b', program: 'P', university: 'U2', country: 'DE', level: 'mba', field: 'Natural Sciences (Physics, Chemistry, Maths)', isPublic: false, totalInr: 100, intakes: [], reqs: {} }];
    const prof = { g_country: 'Germany', g_level: "Master's", g_field: 'Physics', d_course: 'BSc Physics', d_cgpa: '8', e_test: 'IELTS', e_score: '6' };
    const sc = M.screen(cat, prof, {}, { limit: 10 });
    ok('counsellor RANKS: the IELTS-7 row is near with its reason; the MBA is under Master\'s', sc.near.some(x => x.id === 'a' && /English test/.test(x.why[0])) && sc.fits.some(x => x.id === 'b'), J(sc.counts));
    const pk = M.pick(cat, prof, 5, 'private', [], {});
    ok('package FILLS only from rows the student meets (pick leaves the IELTS-7 row out)', pk.length === 1 && pk[0].id === 'b', J(pk.map(p => p.id)));
    ok('matcher: no pass mark → CGPA out of 10 converted with pass 4', M.germanOf({ d_cgpa: '7.5' }) === 2.2 && M.germanOf({ d_cgpa: '7.5', d_max: '10', d_pass: '5' }) === 2.5);
  }

  /* ============================================================ the server */
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  if (!r.ok) { ok('admin signs in', false, r.status + ' ' + r.text.slice(0, 200)); return done(); }
  let total = (await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.total || 0;
  if (total < 1000) {
    const files = [path.join(SCR, 'r165', 'live-DE-noid.xlsx'), path.join(SCR, 'out', 'glovels-germany-v37-new-rows.xlsx')].filter(f => fs.existsSync(f));
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f)); fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const x = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a }, body: fd });
      note(path.basename(f) + ' → ' + x.status);
    }
    total = (await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.total || 0;
  }
  note('catalogue: ' + total + ' rows');
  /* The fixtures. */
  {
    const fd = new FormData();
    fd.append('file', new Blob([fixtureCsv()], { type: 'text/csv' }), 'r178-fixtures.csv'); fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
    const x = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a }, body: fd });
    const t = await x.text();
    ok('the fixture rows import (' + FIX.length + ')', x.ok, x.status + ' ' + t.slice(0, 300));
  }
  const list = (await req('a', 'GET', '/api/staff/catalogue?per=200&status=&q=R178')).body.programmes || [];
  const ID = {};
  FIX.forEach(([k, o]) => { const hit = list.find(p => p.program === progName(k, o) && p.university === uniName(k)); if (hit) ID[k] = String(hit.id); });
  ok('every fixture row is found by id (' + Object.keys(ID).length + ' of ' + FIX.length + ')', Object.keys(ID).length === FIX.length, J(FIX.map(f => f[0]).filter(k => !ID[k])));
  const key = id => Object.keys(ID).find(k => ID[k] === String(id));

  /* Find University, as a visitor: the rows on the page (named rows carry data-id). */
  const fu = async (qs) => {
    const h = (await req('v', 'GET', '/find-university?country=DE&field=' + encodeURIComponent(FIELD) + (qs ? '&' + qs : ''))).text;
    return new Set((h.match(/class="frow[^"]*" data-id="([^"]+)"/g) || []).map(m => /data-id="([^"]+)"/.exec(m)[1]).map(key).filter(Boolean));
  };
  /* F6.1 — suggestions and the pair. */
  r = await req('v', 'GET', '/api/tags?q=rost&limit=24');
  const sug = (r.body.suggestions || []).map(x => x.value + '·' + x.type);
  ok('F6.1 typing "rost" offers Rostock (City) and University of Rostock (University)', sug.includes('Rostock·City') && sug.includes('University of Rostock·University'), J(sug));
  let got = await fu('tags=' + encodeURIComponent('Rostock;Physics'));
  ok('F6.1 Rostock + Physics → only the Rostock row that lists Physics (Find University)', got.has('phys-rostock') && !got.has('phys-bremen') && !got.has('chem-rostock'), J([...got]));
  /* F6.2. */
  got = await fu('tags=' + encodeURIComponent('ECE;EEE'));
  ok('F6.2 ECE + EEE → the union (Munich, Berlin, Nuremberg)', ['ece-munich', 'eee-berlin', 'eee-nuremberg'].every(k => got.has(k)) && !got.has('phys-rostock'), J([...got]));
  got = await fu('tags=' + encodeURIComponent('ECE;EEE;Bavaria'));
  ok('F6.2 + Bavaria → Bavarian ones only (Munich, Nuremberg; not Berlin)', got.has('ece-munich') && got.has('eee-nuremberg') && !got.has('eee-berlin'), J([...got]));
  got = await fu('tags=IT');
  ok('F1 exact: the tag "IT" does not pick "R178 IT Security" (tagged Information Technology)', !got.has('it-title'), J([...got]));
  /* F6.4. */
  got = await fu('ggpa=2.8');
  ok('F6.4 German grade 2.8: GPA 4.0 and blank shown, GPA 2.5 hidden', got.has('gpa-40') && got.has('gpa-blank') && !got.has('gpa-25'), J([...got].filter(k => /^gpa/.test(k))));
  got = await fu('cgpa=7.5');
  ok('F6.4 CGPA 7.5 alone (≈ German 2.2): the GPA 2.5 row is shown', got.has('gpa-25'), J([...got].filter(k => /^gpa/.test(k))));
  got = await fu('cgpa=9.5&ggpa=2.8');
  ok('F6.4 a typed German grade wins over the CGPA (9.5 + German 2.8 → GPA 2.5 hidden)', !got.has('gpa-25') && got.has('gpa-40'));
  /* F6.5. */
  got = await fu('english=ielts:6');
  ok('F6.5 IELTS 6.0: blank and 6.0 rows shown; 7.0 rows hidden (no letter)', got.has('ielts-blank') && got.has('ielts-60') && !got.has('ielts-70-moi-yes') && !got.has('ielts-70-moi-no'), J([...got].filter(k => /^ielts/.test(k))));
  got = await fu('english=ielts:6&moiLetter=1');
  ok('F6.5 + MOI letter: MOI = Yes (IELTS 7) shown, MOI = No hidden, "Possibly" shown', got.has('ielts-70-moi-yes') && !got.has('ielts-70-moi-no') && got.has('ielts-70-moi-maybe'), J([...got].filter(k => /^ielts/.test(k))));
  {
    const h = (await req('v', 'GET', '/find-university?country=DE&field=' + encodeURIComponent(FIELD) + '&english=ielts:6&moiLetter=1')).text;
    const row = (h.split('data-id="' + ID['ielts-70-moi-maybe'] + '"')[1] || '').split('</article>')[0];
    ok('F4 the "Possibly" row carries the "MOI possibly accepted" badge', /MOI possibly accepted/.test(row), row.slice(0, 200));
  }
  /* F6.6. */
  got = await fu('gre=none');
  ok('F6.6 no GRE: Not mentioned / Recommended / Optional shown; "Yes, unless waived" hidden', ['gre-notmentioned', 'gre-recommended', 'gre-optional'].every(k => got.has(k)) && !got.has('gre-yes'), J([...got].filter(k => /^gre/.test(k))));
  /* F6.7. */
  got = await fu('ects=180');
  ok('F6.7 ECTS 180: 180, 210-Yes and 210-Maybe shown; 240-No hidden', ['ects-180', 'ects-210-yes', 'ects-210-maybe'].every(k => got.has(k)) && !got.has('ects-240-no'), J([...got].filter(k => /^ects/.test(k))));
  {
    const h = (await req('v', 'GET', '/find-university?country=DE&field=' + encodeURIComponent(FIELD) + '&ects=180')).text;
    const row = (h.split('data-id="' + ID['ects-210-maybe'] + '"')[1] || '').split('</article>')[0];
    ok('F6.7 the Maybe row carries "Maybe – check eligibility"', /Maybe – check eligibility/.test(row), row.slice(0, 200));
    ok('public side: the hidden rows are not counted — the strip says "not shown", no number', /are not shown/.test(h) && !/ranked lower, not hidden/.test(h));
  }
  /* F9.2. */
  got = await fu('tags=' + encodeURIComponent('IELTS 6.5'));
  ok('F9.2 "IELTS 6.5" → the 6.5 row, not the 7.0 one', got.has('ielts-tag-65') && !got.has('ielts-tag-70'), J([...got]));
  /* F9.3 on Find University. */
  got = await fu('level=master');
  ok('F9.3 Find University, Master\'s: the MBA row is in it', got.has('mba') && got.has('gpa-blank'));
  {
    const h = (await req('v', 'GET', '/find-university?country=DE')).text;
    ok('F9.3 Find University\'s level rail offers no separate MBA', !/name="level" value="mba"/.test(h) && /name="level" value="master"/.test(h));
    const gb = (await req('v', 'GET', '/find-university?country=GB')).text;
    ok('F9.4 Find University: "Open admission only" (Germany-only) is hidden for the UK, shown for Germany',
      /data-germany-only="1" hidden><input type="checkbox" name="restricted"/.test(gb) && /data-germany-only="1"><input type="checkbox" name="restricted"/.test(h));
  }
  /* The locked set, hidden before the cap (/api/find/locked). */
  {
    const lk = async qs => ((await req('v', 'GET', '/api/find/locked?country=DE&field=' + encodeURIComponent(FIELD) + (qs ? '&' + qs : ''))).body.locked || []);
    const all = await lk(''), six = await lk('english=ielts:6.5');
    ok('/api/find/locked applies the same hiding: IELTS 6.5 keeps the 6.0 row, drops the 7.5 (MOI No) row (' + all.length + ' → ' + six.length + ')', all.length >= 3 && six.length === all.length - 1, J([all.length, six.length]));
    ok('  · and the placeholders still carry no name and no count', all.every(p => !p.university && !p.program) && !('total' in ((await req('v', 'GET', '/api/find/locked?country=DE')).body)));
  }
  /* "Numbers not required": the served home page's finder options carry no counts. */
  {
    const home = (await req('v', 'GET', '/')).text;
    const counted = (home.match(/<option[^>]*>[^<]*\(\d+\)<\/option>/g) || []);
    ok('home: no "(N)" count on any baked finder option label', counted.length === 0, J(counted.slice(0, 5)));
    ok('home: the pre-search block is titled "Popular private universities"', /id="rTitle"[^>]*>Popular private universities</.test(home));
  }
  /* Study-in finder: MBA under Master's. */
  {
    const a = (await req('v', 'GET', '/api/universities/filter?country=DE&level=master&q=r178')).body.universities || [];
    ok('F9.3 Study-in finder: Master\'s includes the MBA university', a.some(u => /mba/i.test(u.name)), J(a.map(u => u.name)).slice(0, 300));
    const page = (await req('v', 'GET', '/study-in-germany')).text;
    ok('F9.3 Study-in level box offers no separate MBA', /id="ufLevel"/.test(page) && !/<option value="mba">/.test(page.split('id="ufLevel"')[1].split('</select>')[0]));
  }

  /* ===================================================== counsellor RANKS */
  {
    const prof = { g_country: 'Germany', g_level: "Master's", g_field: 'Physics', d_course: 'BSc Physics', d_cgpa: '8', d_max: '10' };
    const run = async f => (await req('a', 'POST', '/api/staff/fit', { profile: prof, filters: Object.assign({ tags: '', limit: 2000 }, f) })).body;
    const findIn = (d, k) => (d.fits || []).find(x => String(x.id) === ID[k]) ? 'fit' : (d.near || []).find(x => String(x.id) === ID[k]) ? 'near' : '';
    const d = (await req('a', 'POST', '/api/staff/fit', { profile: Object.assign({}, prof, { g_field: '' }), filters: { q: 'R178', tags: 'Rostock;Physics', limit: 2000 } })).body;
    ok('counsellor: the tag box uses the same rule (Rostock + Physics → the Rostock physics row)', findIn(d, 'phys-rostock') && !findIn(d, 'phys-bremen') && !findIn(d, 'chem-rostock'), J([findIn(d, 'phys-rostock'), findIn(d, 'phys-bremen')]));
    const d3 = await (async () => (await req('a', 'POST', '/api/staff/fit', { profile: Object.assign({}, prof, { g_field: '' }), filters: { q: 'R178 ielts', e_test: 'IELTS', e_score: '6', d_moi: 'no', d_ects: '180', a_test: 'Not taken yet', limit: 2000 } })).body)();
    ok('counsellor RANKS: the IELTS-7 (MOI No) row is "near", with the English reason first', findIn(d3, 'ielts-70-moi-no') === 'near' && /English test/.test(((d3.near || []).find(x => String(x.id) === ID['ielts-70-moi-no']) || { why: [''] }).why[0]), J(d3.counts));
    const d4 = (await req('a', 'POST', '/api/staff/fit', { profile: Object.assign({}, prof, { g_field: '' }), filters: { q: 'R178 ects', d_ects: '180', limit: 2000 } })).body;
    ok('counsellor RANKS: the 240-ECTS row is near, 210-Yes a fit, 210-Maybe a fit with the Maybe note', findIn(d4, 'ects-240-no') === 'near' && findIn(d4, 'ects-210-yes') === 'fit'
      && ((d4.fits || []).find(x => String(x.id) === ID['ects-210-maybe']) || { notes: [] }).notes.includes('Maybe – check eligibility'), J([findIn(d4, 'ects-240-no'), findIn(d4, 'ects-210-yes'), findIn(d4, 'ects-210-maybe')]));
    const d5 = (await req('a', 'POST', '/api/staff/fit', { profile: Object.assign({}, prof, { g_field: '' }), filters: { q: 'R178 MBA', limit: 2000 } })).body;
    ok('F9.3 counsellor: Master\'s takes the MBA row', findIn(d5, 'mba') === 'fit', J(d5.counts));
    /* F9.1 — Data Science (Master's) + Public University, against Data Science alone. */
    const ds = (await req('a', 'POST', '/api/staff/fit', { profile: Object.assign({}, prof, { g_field: '' }), filters: { q: 'R178', tags: "Data Science (Master's);Public University", limit: 2000 } })).body;
    const ds1 = (await req('a', 'POST', '/api/staff/fit', { profile: Object.assign({}, prof, { g_field: '' }), filters: { q: 'R178', tags: 'Data Science', limit: 2000 } })).body;
    ok('F9.1 "Data Science (Master\'s)" + "Public University" → the public Data Science master\'s only; "Data Science" alone adds the row that only accepts that bachelor',
      findIn(ds, 'ds-master') && !findIn(ds, 'ds-bachelor-only') && findIn(ds1, 'ds-master') && findIn(ds1, 'ds-bachelor-only'), J([findIn(ds, 'ds-master'), findIn(ds, 'ds-bachelor-only'), findIn(ds1, 'ds-bachelor-only')]));
    const bad = (await req('a', 'POST', '/api/staff/fit', { profile: prof, filters: { d_cgpa: '15' } }));
    ok('the CGPA box is still checked against its scale of 10 (15 → 422)', bad.status === 422 && /scale \(10\)/.test(bad.body.error || ''), bad.status + ' ' + (bad.body.error || ''));
  }

  /* =========================================== F9.5 export shortlist to Excel */
  {
    const stu = { name: 'Round Seventy Eight', email: 'r178-student-' + Date.now() + '@example.com', phone: '9811178178', password: 'glovels-r178-pass', terms: 'yes' };
    r = await req('s', 'POST', '/api/auth/signup', stu);
    const me = (await req('s', 'GET', '/api/auth/me')).body.user || {};
    ok('a student signs up (' + me.id + ')', !!me.id, r.status + ' ' + r.text.slice(0, 120));
    const picks = ['ielts-60', 'ects-210-yes', 'gpa-25'];
    for (const k of picks) {
      const x = await req('a', 'POST', '/api/staff/student/' + me.id + '/shortlist', { id: ID[k], force: true });
      if (!x.ok) note('add ' + k + ' → ' + x.status + ' ' + x.text.slice(0, 120));
    }
    /* One the student marked themselves — not on the counsellor's export. */
    await req('s', 'POST', '/api/shortlist', { id: ID['gpa-blank'] });
    const x = await req('a', 'GET', '/api/staff/student/' + me.id + '/shortlist.xlsx');
    ok('GET /api/staff/student/:id/shortlist.xlsx answers an Excel file', x.status === 200 && /spreadsheetml/.test(x.headers.get('content-type') || '') && /attachment; filename="glovels-shortlist-/.test(x.headers.get('content-disposition') || ''), x.status + ' ' + x.headers.get('content-type'));
    let rows = [];
    try { rows = SHEET.readXlsx(x.buf); } catch (e) { note('readXlsx: ' + e.message); }
    ok('F9.5 the columns, exactly: ' + J(rows[0]), J(rows[0]) === J(['University', 'Programme', 'Tuition fee', 'IELTS/TOEFL requirement', 'GPA requirement', 'Application start', 'Application end', 'Programme link']));
    const body = rows.slice(1);
    ok('F9.5 one row per programme on their list (' + body.length + ')', body.length === picks.length && picks.every(k => body.some(b => b[7] === 'https://example.org/r178/' + k)), J(body.map(b => b[7])));
    const i6 = body.find(b => b[7] === 'https://example.org/r178/ielts-60') || [];
    const g25 = body.find(b => b[7] === 'https://example.org/r178/gpa-25') || [];
    ok('  · the cells say what the row asks: IELTS 6, German grade 2.5, a deadline, the fee', /IELTS 6/.test(i6[3] || '') && /German grade 2\.5/.test(g25[4] || '') && /Winter: 15 Jul 2027/.test(i6[6] || '') && /₹15,00,000 total/.test(i6[2] || ''), J([i6, g25]));
    const st = await req('s', 'GET', '/api/staff/student/' + me.id + '/shortlist.xlsx');
    ok('  · staff only — the student cannot download it', st.status === 401 || st.status === 403, st.status);
    const cpage = (await req('a', 'GET', '/counsellor.html')).text;
    ok('  · the counsellor file has the "Export to Excel" button', /id="exportList"[^>]*>|id=\\?"exportList/.test(cpage) && /shortlist\.xlsx/.test(cpage) && /Export to Excel/.test(cpage));
  }

  /* ================================================================ the screens */
  let browser = null;
  try { browser = await require('playwright').chromium.launch(); } catch (e) { note('playwright not available: ' + e.message); }
  if (browser) {
    const errs = [];
    /* The counsellor's panel (admin → Catalogue → Find what fits). */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/catalogue.html', { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-t="fit"]');
    await page.waitForSelector('#gfCgpa', { timeout: 15000 }).catch(() => {});
    const gone = await page.evaluate(() => ['gfField', 'gfMax', 'gfPass', 'gfDur', 'gfGreS'].filter(id => document.getElementById(id)));
    ok('F6.3 counsellor panel: no Field (exact), out of / pass, Bachelor\'s length or GRE combined score', gone.length === 0, J(gone));
    const lab = await page.evaluate(() => { const l = document.querySelector('label[for="gfCgpa"]'); return l ? l.textContent : ''; });
    ok('F2.2 two direct inputs: "CGPA (out of 10)" and "German grade (1.0 – 4.0)"', /CGPA \(out of 10\)/.test(lab) && await page.$('#gfGgpa') !== null, lab);
    ok('F2.1 "Their field, in words" stays (it decides the set)', await page.$('#gfWords') !== null);
    const lv = await page.$$eval('#gfLevel option', o => o.map(x => x.value));
    ok('F9.3 counsellor level: Master\'s, no separate MBA', lv.includes("Master's") && !lv.includes('MBA'), J(lv));
    const tl = await page.evaluate(() => (document.querySelector('.gf-tags label') || {}).textContent || '');
    ok('F1 the tag box is relabelled (any of a kind · all across kinds)', /any of a kind/.test(tl) && !/all of these/i.test(tl), tl);
    await page.fill('#gfTagQ', 'rost');
    await page.waitForSelector('#gfTagSug button', { timeout: 8000 }).catch(() => {});
    const sg = await page.$$eval('#gfTagSug button', b => b.map(x => x.textContent));
    ok('F1 the dropdown shows "Tag · Type · count" (Rostock · City · N)', sg.some(t => /^Rostock\s*City · \d+/.test(t)), J(sg));
    await page.keyboard.press('Enter');
    await page.waitForSelector('#gfTagChips .gf-chip', { timeout: 5000 }).catch(() => {});
    const chips1 = await page.$$eval('#gfTagChips .gf-chip', c => c.length);
    await page.focus('#gfTagQ'); await page.keyboard.press('Backspace');
    const chips2 = await page.$$eval('#gfTagChips .gf-chip', c => c.length);
    ok('F1 Enter picks a chip; Backspace in the empty box removes it', chips1 === 1 && chips2 === 0, J([chips1, chips2]));
    const vis = async () => page.evaluate(() => [...document.querySelectorAll('[data-de-only]')].map(b => !b.hidden));
    await page.selectOption('#gfCountry', 'Germany').catch(() => {});
    await page.dispatchEvent('#gfCountry', 'change');
    const de = await vis();
    await page.selectOption('#gfCountry', 'United Kingdom').catch(() => {});
    await page.dispatchEvent('#gfCountry', 'change');
    const uk = await vis();
    ok('F9.4 counsellor: German grade, German level, ECTS and restricted admission show for Germany, hide for the UK', de.length === 4 && de.every(Boolean) && uk.every(x => !x), J([de, uk]));

    /* The home finder. */
    const hp = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    hp.on('pageerror', e => errs.push(String(e)));
    await hp.goto(BASE + '/', { waitUntil: 'load' });
    await hp.waitForFunction(() => document.querySelector('#fField option[value="' + 'R178 Test Field' + '"]'), null, { timeout: 30000 }).catch(() => {});
    const homeGone = await hp.evaluate(() => ['fBachYears', 'fGreS', 'openGg'].filter(id => document.getElementById(id)));
    ok('F6.3 home: no Bachelor\'s length, GRE total or "Work it out" (out of / pass) control', homeGone.length === 0, J(homeGone));
    const hl = await hp.$$eval('#fLevel option', o => o.map(x => x.value));
    ok('F9.3 home level: Master\'s, no MBA option', hl.includes('master') && !hl.includes('mba'), J(hl));
    const kinds = await hp.evaluate(() => [document.getElementById('fCgpa').tagName + ':' + document.getElementById('fCgpa').type, document.getElementById('fGgpa').tagName + ':' + document.getElementById('fGgpa').type]);
    ok('F2.2 home: CGPA and German grade are direct number inputs', J(kinds) === J(['INPUT:number', 'INPUT:number']), J(kinds));
    /* The page's functions are not globals (its scripts are bundled), so
       the boxes are set, a free-text chip narrows to the fixture family
       ("ielts", "ects"…) and the drawn rows are read off the free-to-apply
       tab (data-apply carries the id). */
    const homeRows = async (set, word) => {
      await hp.evaluate(([s, field]) => {
        const box = (id, v) => { const el = document.querySelector(id); if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
        document.querySelectorAll('[data-tagchip]').forEach(b => b.click());
        ['#fCgpa', '#fGgpa', '#fEnglish', '#fGre', '#fEcts', '#fGerman', '#fWork'].forEach(id => box(id, ''));
        box('#fMoiL', false);
        box('#fCountry', 'DE'); box('#fLevel', 'master'); box('#fField', field);
        Object.keys(s).forEach(id => box(id, s[id]));
      }, [set, FIELD]);
      await hp.evaluate(() => { while (document.querySelector('[data-tagchip]')) document.querySelector('[data-tagchip]').click(); });
      await hp.fill('#fSearch', word); await hp.press('#fSearch', 'Enter');
      await hp.click('#fGo'); await hp.waitForTimeout(700);
      await hp.click('.rtab[data-rt="pub"]').catch(() => {}); await hp.waitForTimeout(300);
      return hp.$$eval('#rowsIn [data-apply]', b => b.map(x => x.dataset.apply));
    };
    const hk = async (set, word) => new Set((await homeRows(set, word)).map(key).filter(Boolean));
    let h = await hk({ '#fEnglish': 'ielts:6' }, 'ielts');
    ok('home HIDES: IELTS 6 → blank / 6.0 shown, 7.0 hidden', h.has('ielts-blank') && h.has('ielts-60') && !h.has('ielts-70-moi-yes'), J([...h].filter(k => /^ielts/.test(k))));
    h = await hk({ '#fEnglish': 'ielts:6', '#fMoiL': true }, 'ielts');
    ok('home + MOI letter: MOI = Yes shown, MOI = No hidden', h.has('ielts-70-moi-yes') && !h.has('ielts-70-moi-no'), J([...h].filter(k => /^ielts/.test(k))));
    h = await hk({ '#fEcts': '180' }, 'ects');
    ok('home ECTS 180: 210-Yes and 210-Maybe shown, 240-No hidden', h.has('ects-210-yes') && h.has('ects-210-maybe') && !h.has('ects-240-no'), J([...h].filter(k => /^ects/.test(k))));
    h = await hk({ '#fGgpa': '2.8' }, 'gpa');
    ok('home German grade 2.8: GPA 4.0 / blank shown, 2.5 hidden', h.has('gpa-40') && h.has('gpa-blank') && !h.has('gpa-25'), J([...h].filter(k => /^gpa/.test(k))));
    h = await hk({ '#fGre': 'none' }, 'gre');
    ok('home no GRE: only "Yes, unless waived" hidden', h.has('gre-recommended') && h.has('gre-optional') && h.has('gre-notmentioned') && !h.has('gre-yes'));
    h = await hk({}, 'mba');
    ok('F9.3 home Master\'s includes the MBA row', h.has('mba'));
    const deOnly = await hp.evaluate(() => {
      const c = document.querySelector('#fCountry');
      const vis = () => [...document.querySelectorAll('[data-germany-only]')].map(e => e.id + ':' + !e.hidden);
      c.value = 'DE'; c.dispatchEvent(new Event('change', { bubbles: true })); const a = vis();
      c.value = 'GB'; c.dispatchEvent(new Event('change', { bubbles: true })); const b = vis();
      return [a, b];
    });
    ok('F9.4 home: German grade, German level, ECTS and restricted admission hide for the UK', deOnly[1].length >= 4 && deOnly[1].every(x => /:false$/.test(x)) && deOnly[0].filter(x => /fGgpaWrap|fGermanWrap|fEctsWrap/.test(x)).every(x => /:true$/.test(x)), J(deOnly));
    ok('no page errors on the screens', !errs.length, J(errs.slice(0, 3)));
    await browser.close();
  }
  done();
})().catch(e => { console.log('  ✗ crashed: ' + (e && e.stack || e)); fail++; done(); });
