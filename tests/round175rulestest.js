/*
 * Round 175 — items 2, 6 and 8 of the 27 Oct test report.
 *
 *   2  "Your CGPA" on the Study-in pages did nothing: a blank destination
 *      bar was read as a bar of zero, and 'abc' / 11 / 3 were taken as a
 *      CGPA. Now: a CGPA narrows (via the German grade where a row states
 *      one), a value off the scale is "not given" and never widens, and the
 *      line above the list carries no count ("Showing 50 of 206").
 *   6  Test the matcher: CGPA 15, −3, 'abc' and a scale of 0 are refused
 *      (422, field-level); IELTS 4 "clears via MOI letter" only when an MOI
 *      letter was said (d_moi / the English answer); the level list has
 *      Diploma and PhD; every box has a label.
 *   8  Admin → Catalogue → Programmes: Level "Foundation / Pathway" sends
 *      'foundation' and the server takes 'pathway' too; the Catalogue
 *      screen's Recent changes are catalogue changes only.
 *
 * Port 8119 by default (BASE overrides). Loads the German sheets when the
 * catalogue is small, as round166test does.
 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8119';
const SCR = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };
const note = s => console.log('    · ' + s);
const J = x => JSON.stringify(x);
function done() { console.log('round175rulestest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.175.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, text };
}

/* ---- units: no server needed ---- */
(() => {
  const R = require(path.join(__dirname, '..', 'server', 'reqs.js'));
  const M = require(path.join(__dirname, '..', 'server', 'matches.js'));
  let v = R.check({ ieltsMin: 6.5, moiAccepted: true }, { ielts: 4 });
  ok('unit: MOI accepted + IELTS 4 and NO letter said: a miss, not "clears via MOI"', v.fails.length === 1 && v.fails[0].key === 'english' && !v.notes.some(n => /clears via moi/i.test(n)), J(v));
  ok('  · and a note that a letter would clear it', v.notes.some(n => /MOI letter would clear/i.test(n)), J(v.notes));
  v = R.check({ ieltsMin: 6.5, moiAccepted: true }, { ielts: 4, moi: true });
  ok('  · with the letter: clears via MOI letter', v.fails.length === 0 && v.notes.includes('clears via MOI letter'), J(v));
  v = R.check({ ieltsMin: 6.5, moiAccepted: false }, { ielts: 4, moi: true });
  ok('  · letter where MOI is refused: a miss that says so', v.fails.length === 1 && /MOI not accepted/.test(v.fails[0].want), J(v));
  v = R.check({ ieltsMin: 6.5, moiAccepted: true }, {});
  ok('  · no score, no letter: a question, not a clear', v.fails.length === 0 && v.unknown.includes('english'), J(v));
  const a = M.answersOf({ e_test: 'IELTS', e_score: '4', d_moi: 'yes' });
  ok('unit: d_moi "yes" is read as holding an MOI letter', a.moi === true && a.ielts === 4, J(a));
  ok('  · d_moi "no" is not', M.answersOf({ e_test: 'IELTS', e_score: '4', d_moi: 'no' }).moi !== true);
  const w = M.wants({ g_level: 'Foundation', g_country: 'Germany', g_field: 'Business' });
  ok('unit: the matcher\'s "Foundation" is the catalogue\'s level value (foundation)', w.level === 'foundation', w.level);
  ok('  · PhD and Diploma are levels it knows', M.wants({ g_level: 'PhD' }).level === 'phd' && M.wants({ g_level: 'Diploma / PG Diploma' }).level === 'diploma');
})();

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ' — server checks skipped)'); return done(); }
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.status === 200, r.status);

  /* The German sheets, so the matcher has the 400-odd Data Science rows the
     tester counted (and rows that state a German grade and no CGPA). */
  const total0 = Number((await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.total || 0);
  if (total0 < 1000) {
    const sheets = [SCR + '/r165/live-DE-noid.xlsx', SCR + '/out/glovels-germany-v37-new-rows.xlsx'].filter(f => fs.existsSync(f));
    for (const f of sheets) {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const u = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a, 'x-forwarded-for': ips.a }, body: fd });
      note('loaded ' + path.basename(f) + ': ' + u.status);
    }
  }

  /* ================================================ item 2: the country page */
  const filt = async (code, cgpa) => (await req('g', 'GET', '/api/universities/filter?country=' + code + (cgpa === undefined ? '' : '&cgpa=' + encodeURIComponent(cgpa)))).body;
  for (const code of ['DE', 'CA']) {
    const none = await filt(code), low = await filt(code, '5.5'), top = await filt(code, '9.5');
    ok(code + ': a CGPA below 6 narrows the list (' + low.total + ' < ' + none.total + ')', none.total > 0 && low.total < none.total, J([none.total, low.total]));
    ok('  · 9.0–10.0 is never more than no CGPA', top.total <= none.total, J([none.total, top.total]));
    for (const bad of ['abc', '11', '3', '0', '-2']) {
      const b = await filt(code, bad);
      ok('  · "' + bad + '" is never more than no CGPA', b.total <= none.total, J([none.total, b.total]));
    }
    ok('  · an impossible value is "not given" — "abc" and 11 answer as no CGPA', (await filt(code, 'abc')).total === none.total && (await filt(code, '11')).total === none.total);
  }
  /* The live site's case: Germany's bar is BLANK on the Destinations screen.
     The finder's default (7.5 / 6.0) applies then — the home page's rule —
     so a 5.5 still narrows. */
  {
    const de0 = (await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.countries.find(c => c.code === 'DE') || {};
    const facts0 = Object.assign({}, de0.facts || {});
    r = await req('a', 'PUT', '/api/staff/country', { code: 'DE', name: 'Germany', facts: Object.assign({}, facts0, { minCgpaPublic: null, minCgpaPrivate: null }) });
    ok('Germany\'s CGPA bars can be blanked (the live site\'s state)', r.ok, r.status + ' ' + r.text.slice(0, 160));
    const none = await filt('DE'), low = await filt('DE', '5.5'), mid = await filt('DE', '6.5');
    ok('  · with no bar set, 5.5 still narrows (finder default) — ' + low.total + ' / ' + mid.total + ' / ' + none.total, low.total < none.total && low.total <= mid.total, J([none.total, mid.total, low.total]));
    r = await req('a', 'PUT', '/api/staff/country', { code: 'DE', name: 'Germany', facts: facts0 });
    ok('  · bars put back', r.ok, r.status);
  }
  for (const slug of ['germany', 'canada']) {
    const html = (await req('g', 'GET', '/study-in-' + slug)).text;
    const count = (/<p class="ucount"[^>]*>([^<]*)<\/p>/.exec(html) || [])[1] || '';
    const more = (/<p class="umore"[^>]*>([^<]*)<\/p>/.exec(html) || [])[1] || '';
    ok('/study-in-' + slug + ': the line above the list carries no count', count && !/\d/.test(count) && !/Showing/.test(count), count);
    ok('  · nor does the "more" line', !/And \d+ more/.test(more) && !/\d+ of \d+/.test(more), more);
    const ul = (/<ul class="ulist" id="uList">([\s\S]*?)<\/ul>/.exec(html) || [])[1] || '';
    ok('  · nor the rows ("12 programmes →")', ul.length > 0 && !/\d+ programmes?/.test(ul), ul.slice(0, 200));
    /* The page's scripts are hoisted into /js/<page>.<hash>.js. */
    const js = await Promise.all((html.match(/src="(\/js\/[^"]+)"/g) || []).map(async m => (await req('g', 'GET', /src="([^"]+)"/.exec(m)[1])).text));
    const allJs = js.join('\n');
    ok('  · and the page script draws none either', !/Showing ' \+/.test(allJs) && /Universities that match/.test(allJs), allJs.length + ' bytes of script');
  }

  /* ============================================ item 6: Test the matcher */
  const B = { g_country: 'Germany', g_level: "Master's", g_field: 'Data Science', d_course: 'B.Tech CSE', d_max: '10', limit: 2000 };
  const fit = f => req('a', 'POST', '/api/staff/fit', { profile: {}, filters: Object.assign({}, B, f) });
  const good = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '6.5' });
  ok('a real profile runs (CGPA 7.5, IELTS 6.5): ' + ((good.body.counts || {}).fits || 0) + ' fits', good.ok && (good.body.counts || {}).fits > 0, good.status);
  for (const [f, label] of [[{ d_cgpa: '15' }, 'CGPA 15'], [{ d_cgpa: '-3' }, 'CGPA −3'], [{ d_cgpa: 'abc' }, 'CGPA abc'], [{ d_cgpa: '7', d_max: '0' }, 'a maximum of 0']]) {
    const b = await fit(f);
    ok(label + ' is refused with 422 and names the field', b.status === 422 && Array.isArray(b.body.fields) && b.body.fields.some(x => /^d_(cgpa|max)$/.test(x.field) && x.why), b.status + ' ' + b.text.slice(0, 160));
  }
  {
    const b = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '12', a_test: 'GRE', a_score: '400', ggpa: '5', w_months: '-2' });
    const fields = (b.body.fields || []).map(x => x.field).sort();
    ok('IELTS 12, GRE 400, German grade 5 and −2 months are each refused by name', b.status === 422 && ['a_score', 'e_score', 'ggpa', 'w_months'].every(k => fields.includes(k)), J(fields));
  }
  /* IELTS 4 — on the list still (English only ranks), but no row may say
     "clears via MOI letter" until a letter is said. */
  const rowsOf = b => (b.body.fits || []).concat(b.body.near || []);
  const engClean = b => rowsOf(b).filter(x => !(x.soft || []).concat(x.why || []).some(s => /English test/i.test(s)) && !(x.ask || []).includes('English score')).length;
  const viaMoi = b => rowsOf(b).filter(x => (x.notes || []).some(n => /clears via MOI/i.test(n))).length;
  const low = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '4' });
  const lowMoi = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '4', d_moi: 'yes' });
  ok('IELTS 4 without an MOI letter: no row "clears via MOI letter" (' + viaMoi(low) + ')', low.ok && viaMoi(low) === 0, viaMoi(low));
  ok('  · fewer rows clear English than at 6.5 (' + engClean(low) + ' < ' + engClean(good) + ')', engClean(low) < engClean(good));
  const missed = rowsOf(low).filter(x => (x.soft || []).concat(x.why || []).some(s => /English test.*IELTS 4/i.test(s)));
  ok('  · the short rows say so ("English test: asks …, they have IELTS 4") — ' + missed.length, missed.length > 0);
  ok('  · and are still on the list, not hidden (' + (low.body.counts || {}).fits + ' fits)', (low.body.counts || {}).fits > 0);
  ok('  · with d_moi "yes": rows clear via MOI letter (' + viaMoi(lowMoi) + ')', lowMoi.ok && viaMoi(lowMoi) > 0 && viaMoi(lowMoi) <= rowsOf(lowMoi).length);
  ok('  · and the rows refusing MOI say "MOI not accepted"', rowsOf(lowMoi).some(x => (x.soft || []).concat(x.why || []).some(s => /MOI not accepted/.test(s))));
  const found = await fit({ g_level: 'Foundation', g_field: 'Business', d_cgpa: '7', d_course: '' });
  ok('Foundation finds the foundation rows (' + (found.body.counts || {}).looked + ' looked at)', found.ok && (found.body.counts || {}).looked > 0, found.status + ' ' + J(found.body.counts));

  /* The panel itself, in a browser: the level list, the labels, the error
     beside the box, the MOI box. */
  let browser = null;
  try { browser = await require('playwright').chromium.launch(); } catch (e) { note('playwright not available: ' + e.message); }
  if (browser) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/catalogue.html', { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-t="fit"]');
    await page.waitForSelector('#gfLevel', { timeout: 10000 });
    const levels = await page.$$eval('#gfLevel option', os => os.map(o => o.textContent));
    ok('the level list has Diploma and PhD', levels.some(l => /Diploma/.test(l)) && levels.some(l => /PhD/.test(l)) && levels.some(l => /Foundation/.test(l)), J(levels));
    const unlabelled = await page.$$eval('#fitAdmin input, #fitAdmin select', cs => cs.filter(c => !c.id || !document.querySelector('label[for="' + c.id + '"]')).map(c => c.id || c.outerHTML.slice(0, 60)));
    const n = await page.$$eval('#fitAdmin input, #fitAdmin select', cs => cs.length);
    ok('every one of the ' + n + ' boxes has a <label for> bound to it', n >= 28 && unlabelled.length === 0, J(unlabelled));
    ok('  · an MOI letter box, labelled', await page.$('label[for="gfMoi"]') !== null && await page.$('#gfMoi option[value="yes"]') !== null);
    await page.fill('#gfCgpa', '15');
    await page.click('#gfGo');
    await page.waitForSelector('#gfCgpaErr', { timeout: 10000 }).catch(() => {});
    const errText = await page.$eval('#gfCgpaErr', e => e.textContent).catch(() => '');
    ok('CGPA 15 on the screen: the reason sits beside the box and the box is marked', /scale/.test(errText) && await page.$eval('#gfCgpa', e => e.getAttribute('aria-invalid')) === 'true', errText);
    ok('  · and the summary line says so too', /cannot be right/.test(await page.$eval('#gfOut', e => e.textContent)));
    await page.fill('#gfCgpa', '7.5');
    await page.click('#gfGo');
    await page.waitForFunction(() => /fit/.test((document.querySelector('#gfOut') || {}).textContent || '') && !/Checking every/.test(document.querySelector('#gfOut').textContent), null, { timeout: 30000 }).catch(() => {});
    ok('  · corrected, the mark goes and the run answers', (await page.$('#gfCgpaErr')) === null && !(await page.$eval('#gfCgpa', e => e.getAttribute('aria-invalid'))));
    ok('no script errors on the matcher screen', !errs.length, errs.join(' | '));
    await browser.close();
  }

  /* =========================================== item 8: the admin level filter */
  const byLevel = async lv => (await req('a', 'GET', '/api/staff/catalogue?per=50&status=&level=' + lv)).body;
  const pw = await byLevel('pathway'), fo = await byLevel('foundation');
  ok('level=foundation lists the foundation rows (' + fo.total + ')', fo.total > 0 && fo.programmes.every(p => p.level === 'foundation'), J(fo.total));
  ok('  · and level=pathway lists the same rows', pw.total === fo.total && pw.programmes.every(p => p.level === 'foundation'), J([pw.total, fo.total]));
  const cat = (await req('a', 'GET', '/catalogue.html')).text;
  ok('  · the screen sends "foundation" for Foundation / Pathway', /<option value="foundation">Foundation \/ Pathway<\/option>/.test(cat) && !/<option value="pathway">/.test(cat));
  /* Recent changes on the Catalogue screen: catalogue changes only. */
  r = await req('a', 'POST', '/api/staff/leads', { name: 'R175 Lead', phone: '9000175001', email: 'r175-' + Date.now() + '@example.com', source: 'phone' });
  if (!r.ok) note('lead not logged: ' + r.status + ' ' + r.text.slice(0, 100));
  const logged = r.ok;
  const audit = (await req('a', 'GET', '/api/staff/catalogue?per=1&status=')).body.audit || [];
  ok('the Catalogue screen\'s recent changes are catalogue changes (' + audit.length + ')', audit.length > 0 && audit.every(a => /programme|catalogue|destination|university page|tags imported/i.test(a.what)), J(audit.slice(0, 5).map(a => a.what)));
  if (logged) ok('  · a lead logged just now is not among them', !audit.some(a => /lead/i.test(a.what)));

  done();
})().catch(e => { console.error(e); fail++; done(); });
