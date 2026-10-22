/*
 * 22 Oct — every university page carries an "Official site" chip.
 *
 * Round 169 (WEB-05) worked a university's home page out from the domain
 * most of its course links sit on; 26 universities had links on partner or
 * joint-programme sites only and got no chip, and a few got the wrong one
 * (Reutlingen → its business school, the marine-microbiology MPI → the Max
 * Planck Society). assets/university-websites.json now ships the looked-up
 * home pages, consulted after the office's own address and before the
 * course-link guess (server/unis.js group()).
 *
 *   ./tests/srv.sh 8115
 *   BASE=http://localhost:8115 node tests/round172sitestest.js
 *
 * Loads the German sheets (scratchpad r165 + out/v37, as round169webtest
 * does) when the catalogue is still the 171-row seed.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8115';
const SP = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
const ROOT = path.join(__dirname, '..');
const UNIS = require(path.join(ROOT, 'server', 'unis.js'));
const SHIPPED = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'university-websites.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };

/* Sites that carry other people's programmes — the same idea as the list in
   unis.js, plus the partner sites the German sheet links to. */
const AGGREGATORS = /(^|\.)(daad\.de|mastersportal\.com|studyportals\.com|uni-assist\.de|hochschulkompass\.de|study-in-germany\.de|studycheck\.de|university-in-germany\.com|mygermanuniversity\.com|femp\.org|tubadvancedmasters\.de|mastermercuri\.eu|vinifera-euromaster\.eu|europeannewschool\.eu|imla-campus\.eu|eacea\.ec\.europa\.eu|google\.com|linkedin\.com|facebook\.com|youtube\.com|mpg\.de|esb-business-school\.de|hs-albsig-international\.de)$/i;

const jar = {};
async function req(who, method, p, body) {
  const h = { 'content-type': 'application/json', 'x-forwarded-for': '10.172.1.' + (who === 'a' ? 7 : 9) };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text };
}
const chipOf = html => (/href="([^"]+)" target="_blank" rel="noopener nofollow">Official site/.exec(html) || [])[1] || '';
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

(async () => {
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('the administrator signs in', r.status === 200, r.status);

  /* ------------------------------------------------- the shipped file */
  ok('assets/university-websites.json ships at least the 26 that had no site', Object.keys(SHIPPED).length >= 26, Object.keys(SHIPPED).length);
  ok('every shipped entry is keyed by UNIS.slugOf(name) and is an https address checked on a date',
    Object.entries(SHIPPED).every(([slug, w]) => slug === UNIS.slugOf(w.name) && /^https:\/\/[^\s/]+\.[^\s]+/.test(w.url) && /^\d{4}-\d{2}-\d{2}$/.test(w.checked) && w.source),
    Object.entries(SHIPPED).filter(([slug, w]) => slug !== UNIS.slugOf(w.name)).map(x => x[0]).join(','));
  ok('no shipped address is an aggregator or a partner site', Object.values(SHIPPED).every(w => !AGGREGATORS.test(hostOf(w.url))));

  /* ------------------------------------------------- the catalogue */
  const cat0 = (await req('anon', 'GET', '/api/catalogue')).body.programmes || [];
  /* Both sheets together are ~2,260 rows on the site; a server another suite
     left with only the first sheet gets the second one too. Import skips
     rows it already has. */
  if (cat0.length < 2200) {
    for (const f of [SP + '/r165/live-DE-noid.xlsx', SP + '/out/glovels-germany-v37-new-rows.xlsx']) {
      if (!fs.existsSync(f)) { console.log('    · (no sheet at ' + f + ')'); continue; }
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const up = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a, 'x-forwarded-for': '10.172.1.7' }, body: fd });
      console.log('    · loaded ' + path.basename(f) + ': ' + up.status + ' ' + (await up.text()).slice(0, 90));
    }
  }
  let unis = [];
  for (let page = 1; page < 20; page++) {
    r = await req('a', 'GET', '/api/staff/universities?per=500&page=' + page);
    unis = unis.concat(r.body.universities || []);
    if (!r.body.universities || r.body.universities.length < 500) break;
  }
  ok('the catalogue groups into a few hundred universities', unis.length >= 200, unis.length);

  /* ------------------------------------------------- every page has a chip */
  const missing = [], bad = [];
  for (const u of unis) {
    const html = await (await fetch(BASE + '/university/' + u.slug)).text();
    const chip = chipOf(html);
    if (!chip) missing.push(u.slug);
    else if (AGGREGATORS.test(hostOf(chip)) || !/^https?:\/\//.test(chip)) bad.push(u.slug + ' → ' + chip);
  }
  ok('every university page (' + unis.length + ') has an Official site chip', missing.length === 0, missing.join(', '));
  ok('no chip points at an aggregator, a partner site or the wrong parent', bad.length === 0, bad.join(', '));

  /* The shipped address beats the course-link guess — the derived site the
     office is shown is the shipped one now, and the page prints it. */
  for (const slug of ['reutlingen-university', 'max-planck-institute-for-marine-microbiology', 'albstadt-sigmaringen-university']) {
    if (!unis.some(u => u.slug === slug)) continue;
    r = await req('a', 'GET', '/api/staff/university/' + slug);
    ok(slug + ': the office sees the shipped address as the derived site', r.status === 200 && r.body.derivedWebsite === SHIPPED[slug].url, r.body.derivedWebsite);
  }

  /* ------------------------------------------------- eight by name */
  const spot = [
    ['coventry-university', 'coventry.ac.uk'], ['constructor-university', 'constructor.university'],
    ['gisma-university-of-applied-sciences', 'gisma.com'], ['srh-berlin-university-of-applied-sciences', 'srh-university.de'],
    ['cranfield-university', 'cranfield.ac.uk'], ['humber-college', 'humber.ca'],
    ['kozminski-university', 'kozminski.edu.pl'], ['ie-university', 'ie.edu'],
  ];
  for (const [slug, dom] of spot) {
    ok(slug + ' ships ' + dom, SHIPPED[slug] && hostOf(SHIPPED[slug].url) === dom, SHIPPED[slug] && SHIPPED[slug].url);
    if (unis.some(u => u.slug === slug)) {
      const chip = chipOf(await (await fetch(BASE + '/university/' + slug)).text());
      ok(slug + ': the page\'s chip points at ' + dom, hostOf(chip) === dom, chip);
    } else console.log('    · ' + slug + ' is not in the loaded catalogue; the file entry is checked, the page is not');
  }

  /* ------------------------------------------------- the office still wins */
  const slug = 'kozminski-university';
  if (unis.some(u => u.slug === slug)) {
    r = await req('a', 'GET', '/api/staff/university/' + slug);
    const keep = r.body.extras || {};
    await req('a', 'PUT', '/api/staff/university/' + slug, Object.assign({}, keep, { website: 'https://www.kozminski.edu.pl/en' }));
    let chip = chipOf(await (await fetch(BASE + '/university/' + slug)).text());
    ok('the office\'s own address beats the shipped one', chip === 'https://www.kozminski.edu.pl/en', chip);
    await req('a', 'PUT', '/api/staff/university/' + slug, Object.assign({}, keep, { website: '' }));
    chip = chipOf(await (await fetch(BASE + '/university/' + slug)).text());
    ok('cleared, the shipped one is back', chip === SHIPPED[slug].url, chip);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
