/*
 * Patch 159 — /find-university.
 *
 * Node-only checks on server/find.js (parse, student, run, sort, rowHtml),
 * then, with a server on 8099, the page itself: it renders, carries its
 * filters in the title, hides a public university's name, lists in the
 * sitemap, and the browser side filters, sorts, compares and writes the
 * address. Run: node tests/findtest.js  (the browser part needs playwright)
 */
'use strict';
const path = require('path');
const F = require(path.join(__dirname, '..', 'server', 'find.js'));
const R = require(path.join(__dirname, '..', 'server', 'reqs.js'));

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); } };

/* ------------------------------------------------------------- node only */
const rows = [
  { id: 'a', program: 'MSc Computer Science', university: 'TU Test', city: 'Berlin', country: 'DE', level: 'master', field: 'Computer Science & IT', isPublic: false, fit: 80, totalInr: 0, feeModel: 'free', minCgpa: 7,
    intakes: [{ season: 'winter', deadline: '2027-01-15' }], reqs: { tuitionEurSem: 0, moiAccepted: true, greRequired: false, ieltsMin: 6.5 } },
  { id: 'b', country: 'DE', level: 'master', field: 'Computer Science & IT', isPublic: true, fit: 90, totalInr: 0, feeModel: 'package', minCgpa: 8,
    intakes: [{ season: 'summer', deadline: '2026-11-30' }], reqs: { tuitionEurSem: 1500, greRequired: true, restricted: true }, nLen: 20, uLen: 12, uKey: 'x' },
  { id: 'c', program: 'MBA', university: 'Biz School', city: 'Munich', country: 'DE', level: 'mba', field: 'Business & Management', isPublic: false, fit: 60, totalInr: 2500000, feeModel: 'package', minCgpa: null,
    intakes: [], reqs: { tuitionEurSem: 9000, workExpRequired: true, workExpMonths: 24 } },
  { id: 'd', program: 'BSc Nursing', university: 'Dublin Health', city: 'Dublin', country: 'IE', level: 'bachelor', field: 'Nursing & Health', isPublic: false, fit: 70, totalInr: 1800000, feeModel: 'free', minCgpa: 6,
    intakes: [{ season: 'winter', deadline: '2027-05-01' }], reqs: { ieltsMin: 6 } },
];

const f0 = F.parse('?country=DE&level=master&feeModel=free&sort=az&junk=1&view=uni');
check('parse keeps known keys', f0.country === 'DE' && f0.level === 'master' && f0.sort === 'az' && f0.view === 'uni');
check('parse maps feeModel to apply', f0.apply === 'free');
check('parse drops unknown keys', !('junk' in f0));
check('parse drops a bad sort', !F.parse('?sort=nope').sort);
check('toQuery is stable and only what is set', F.toQuery({ level: 'master', country: 'DE', q: 'a b' }) === '?country=DE&level=master&q=a%20b');

const s = F.student({ english: 'ielts:6.5', gre: 'yes', greQuant: '160', work: '12', bachelorYears: '3', cgpa: '7.5', restricted: 'open', papers: 'no' });
check('student reads IELTS', s.ielts === 6.5);
check('student: GRE yes without a total is "taken"', s.gre === 'taken' && s.greQuant === 160);
check('student derives ECTS from years', s.ects === 180 && s.bachelorYears === 3);
check('student reads work, papers, cgpa, open-only', s.workExpMonths === 12 && s.papers === false && s.cgpa === 7.5 && s.restrictedOk === false);
check('student: GRE none drops sections', F.student({ gre: 'none', greQuant: '160' }).gre === false && F.student({ gre: 'none', greQuant: '160' }).greQuant === undefined);
check('nothing said', !F.saidAnything(F.student({ country: 'DE' })));

let r = F.run(rows, F.parse('?country=DE'), R);
check('country filter', r.total === 3 && r.rows.every(p => p.country === 'DE'));
check('universities counted by key', r.unis === 3);
check('facets count what each value would add', r.facets.level.master === 2 && r.facets.level.mba === 1 && r.facets.country.IE === 1 && r.facets.apply.free === 1);
check('no-tuition facet', r.facets.tuition0 === 1 && r.facets.moi === 1 && r.facets.nogre === 2 && r.facets.open === 2);

r = F.run(rows, F.parse('?country=DE&cgpa=7.5'), R);
check('CGPA 7.5 turns down the 8.0 bar', r.total === 2 && r.turned === 1 && !r.rows.some(p => p.id === 'b'));
check('said: verdicts on the rows (MOI row clears English on the letter)', r.said && r.rows.find(p => p.id === 'a')._v.ok === true && r.rows.find(p => p.id === 'a')._v.notes.includes('clears via MOI letter'));
r = F.run(rows, F.parse('?country=IE&cgpa=7.5'), R);
check('said: an IELTS bar with no score is an open question', r.rows.find(p => p.id === 'd')._v.unknown.includes('english'));
r = F.run(rows, F.parse('?country=DE&cgpa=7.5&english=ielts:6.5'), R);
check('IELTS 6.5 clears row a', r.rows.find(p => p.id === 'a')._v.ok === true);
r = F.run(rows, F.parse('?country=DE&work=6'), R);
check('6 months of work fails the MBA that wants 24', !r.rows.some(p => p.id === 'c') && r.turned === 1);
r = F.run(rows, F.parse('?tuition=0'), R);
check('no-tuition keeps only a stated 0', r.total === 1 && r.rows[0].id === 'a');
r = F.run(rows, F.parse('?tuition=1500'), R);
check('tuition cap keeps unknown and under', r.rows.map(p => p.id).sort().join() === 'a,b,d');
r = F.run(rows, F.parse('?moi=1'), R);
check('MOI filter', r.total === 1 && r.rows[0].id === 'a');
r = F.run(rows, F.parse('?nogre=1'), R);
check('no-GRE filter drops the GRE row', !r.rows.some(p => p.id === 'b'));
r = F.run(rows, F.parse('?restricted=open'), R);
check('open admission only drops the restricted row', !r.rows.some(p => p.id === 'b') && r.total === 3);
r = F.run(rows, F.parse('?q=nursing dublin'), R);
check('search box: every word', r.total === 1 && r.rows[0].id === 'd');
r = F.run(rows, F.parse('?sort=cost'), R);
check('sort by cost: no tuition first, dearest last', r.rows[0].id === 'a' && r.rows[r.rows.length - 1].id === 'c');
r = F.run(rows, F.parse('?sort=az'), R);
check('sort A–Z: locked last', r.rows[r.rows.length - 1].id === 'b' && r.rows[0].id === 'd');
r = F.run(rows, F.parse('?sort=deadline'), R);
check('sort by deadline: nearest first, no date last', r.rows[r.rows.length - 1].id === 'c');

const ctx = { countries: { DE: { name: 'Germany', flag: 'DE' }, IE: { name: 'Ireland', flag: 'IE' } }, said: true };
r = F.run(rows, F.parse('?country=DE&cgpa=9&english=ielts:7'), R);
const hb = F.rowHtml(r.rows.find(p => p.id === 'b'), ctx);
check('locked row shows no name', hb.includes('frow locked') && !hb.includes('TU Test') && hb.includes('Public university') && hb.includes('Unlock'));
check('locked row: GRE asked, chances unknown', hb.includes('Chances unknown'));
const ha = F.rowHtml(r.rows.find(p => p.id === 'a'), ctx);
check('named row: title, university link, apply free, clears via MOI/IELTS', ha.includes('MSc Computer Science') && ha.includes('/university/tu-test') && ha.includes('Apply free') && ha.includes('You clear what it asks'));
check('row with nothing stated gets no green chip', !F.rowHtml(Object.assign({}, rows[2], { reqs: {}, minCgpa: null, _v: { fails: [], unknown: [], notes: [] } }), ctx).includes('clear what it asks'));
check('title words', F.title(F.parse('?country=DE&level=master&field=Computer Science %26 IT'), ctx.countries, 12) === 'Master’s in Computer Science & IT in Germany — 12 programmes'.replace('’', "'"));
check('chip labels', F.chipLabel('english', 'ielts:6.5') === 'IELTS 6.5' && F.chipLabel('intake', 'winter-2027') === 'Winter 2027' && F.chipLabel('tuition', '0') === 'No tuition fee');

/* -------------------------------------------------------------- server */
(async () => {
  const BASE = 'http://localhost:8099';
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) {
    console.log('  (no server on ' + BASE + ' — the page checks were skipped; run tests/srv.sh 8099 first to include them)');
    return done();
  }
  const html = await (await fetch(BASE + '/find-university?country=DE&level=master')).text();
  check('page renders', html.includes('id="flist"') && html.includes('id="frail"'));
  check('title carries the filters', /<title>Master's in Germany — [\d,]+ programmes \| Glovels<\/title>/.test(html));
  check('canonical keeps only country/level/field', html.includes('<link rel="canonical" href="') && /canonical" href="[^"]*find-university\?country=DE&amp;level=master"/.test(html));
  check('signed-out page names no public university', !/frow locked[\s\S]*?<h3 class="ftitle">[A-Za-z]/.test(html.split('frow locked')[1] || ''));
  check('scripts served', (await fetch(BASE + '/js/find.js')).ok && (await fetch(BASE + '/js/reqs.js')).ok && (await fetch(BASE + '/js/find-page.js')).ok);
  const sm = await (await fetch(BASE + '/sitemap.xml')).text();
  if (sm.includes('<urlset')) check('sitemap lists the page and a destination address', sm.includes('/find-university</loc>') && sm.includes('/find-university?country=DE</loc>'));
  else console.log('  (indexing off on this server — sitemap check skipped; run with ALLOW_INDEXING=true to include it)');
  const red = await fetch(BASE + '/find-university.html?country=DE', { redirect: 'manual' });
  check('.html spelling redirects with its query', red.status === 301 && (red.headers.get('location') || '').endsWith('/find-university?country=DE'));

  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) { console.log('  (playwright not found — browser checks skipped)'); return done(); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/find-university?country=DE&level=master'); await page.waitForTimeout(1500);
  const st = () => page.evaluate(() => ({ url: location.pathname + location.search, sum: document.querySelector('#fsummary').textContent, rows: document.querySelectorAll('#flist .frow').length, chips: document.querySelectorAll('.fchip').length }));
  let x = await st();
  check('browser took over with rows', x.rows > 0 && x.chips === 2);
  await page.evaluate(() => { const i = document.querySelector('input[name=apply][value=free]'); i.closest('details').open = true; i.click(); }); await page.waitForTimeout(300);
  x = await st();
  check('a rail click writes the address', x.url.includes('apply=free') && x.chips === 3);
  check('summary follows', /^\d+ programmes? at \d+ universit/.test(x.sum));
  await page.selectOption('#fsort', 'az'); await page.waitForTimeout(200);
  check('sort in the address', (await st()).url.includes('sort=az'));
  await page.click('[data-clear="apply"]'); await page.waitForTimeout(300);
  check('a chip removed un-filters', !(await st()).url.includes('apply='));
  const ids = await page.evaluate(() => [...document.querySelectorAll('#flist .frow:not(.locked) [data-cmp]')].slice(0, 2).map(b => b.dataset.cmp));
  if (ids.length === 2) {
    for (const id of ids) await page.click('[data-cmp="' + id + '"]');
    await page.waitForTimeout(200);
    check('compare bar appears at two', await page.evaluate(() => !document.querySelector('#fcmp').hidden && /Comparing 2/.test(document.querySelector('#fcmpText').textContent)));
    await page.click('#fcmpGo'); await page.waitForTimeout(300);
    check('side by side opens with rows', await page.evaluate(() => !document.querySelector('#fmodal').hidden && document.querySelectorAll('#fmodal tbody tr').length > 10));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('Escape closes it', await page.evaluate(() => document.querySelector('#fmodal').hidden));
    await page.click('[data-save="' + ids[0] + '"]'); await page.waitForTimeout(200);
    check('save keeps a local list when signed out', await page.evaluate(id => (JSON.parse(localStorage.getItem('glv-saved') || '[]')).includes(id), ids[0]));
  } else check('two named rows to compare', false, 'found ' + ids.length);
  await page.click('[data-clear="*"]'); await page.waitForTimeout(300);
  check('Clear all', (await st()).chips === 0);
  await page.setViewportSize({ width: 390, height: 800 }); await page.goto(BASE + '/find-university?country=DE'); await page.waitForTimeout(1200);
  check('fits a phone', await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await page.click('#fsheetBtn'); await page.waitForTimeout(200);
  check('filters open as a sheet on a phone', await page.evaluate(() => document.querySelector('#frail').classList.contains('open')));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  done();
})();

function done() { console.log('findtest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
